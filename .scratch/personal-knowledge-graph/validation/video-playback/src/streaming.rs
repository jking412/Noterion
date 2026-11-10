use crate::{Host, now_ms};
use anyhow::{Context, Result, ensure};
use aws_sdk_s3::{
    config::{
        ConfigBag, Intercept, RuntimeComponents,
        interceptors::BeforeDeserializationInterceptorContextRef,
    },
    error::BoxError,
};
use serde_json::json;
use std::{
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::Semaphore,
};

const CORS: &str = "Access-Control-Allow-Origin: http://tauri.localhost\r\nVary: Origin\r\nAccess-Control-Expose-Headers: Content-Range, Accept-Ranges, Content-Length, Content-Type\r\n";

#[derive(Debug)]
struct StatusCapture(Arc<AtomicU64>);

impl Intercept for StatusCapture {
    fn name(&self) -> &'static str {
        "Issue13ResponseStatus"
    }

    fn read_before_deserialization(
        &self,
        context: &BeforeDeserializationInterceptorContextRef<'_>,
        _runtime_components: &RuntimeComponents,
        _cfg: &mut ConfigBag,
    ) -> std::result::Result<(), BoxError> {
        self.0.store(
            context.response().status().as_u16() as u64,
            Ordering::SeqCst,
        );
        Ok(())
    }
}

async fn headers(
    socket: &mut TcpStream,
    status: u16,
    mime: &str,
    length: u64,
    range: Option<&str>,
    accept: bool,
) -> Result<()> {
    let reason = match status {
        200 => "OK",
        206 => "Partial Content",
        403 => "Forbidden",
        404 => "Not Found",
        416 => "Range Not Satisfiable",
        _ => "Bad Gateway",
    };
    let content_range = range
        .map(|r| format!("Content-Range: {r}\r\n"))
        .unwrap_or_default();
    let accepts = if accept {
        "Accept-Ranges: bytes\r\n"
    } else {
        "Accept-Ranges: none\r\n"
    };
    socket.write_all(format!("HTTP/1.1 {status} {reason}\r\nContent-Type: {mime}\r\nContent-Length: {length}\r\n{accepts}{content_range}{CORS}Cache-Control: no-store\r\nConnection: close\r\n\r\n").as_bytes()).await?;
    Ok(())
}

pub async fn serve(listener: std::net::TcpListener, state: Host) {
    let listener = TcpListener::from_std(listener).expect("runtime listener");
    let slots = Arc::new(Semaphore::new(4));
    loop {
        let Ok(permit) = slots.clone().acquire_owned().await else {
            break;
        };
        let Ok((mut socket, _)) = listener.accept().await else {
            break;
        };
        let state = state.clone();
        tauri::async_runtime::spawn(Box::pin(async move {
            let _permit = permit;
            state.0.active.fetch_add(1, Ordering::SeqCst);
            if let Err(error) = transfer(&mut socket, state.clone()).await {
                state.log(json!({"event":"media-connection-error","message":error.to_string(),"atMs":now_ms()}));
            }
            state.0.active.fetch_sub(1, Ordering::SeqCst);
            state.0.completed.fetch_add(1, Ordering::SeqCst);
        }));
    }
}

async fn transfer(socket: &mut TcpStream, state: Host) -> Result<()> {
    let start = Instant::now();
    let at_ms = now_ms();
    let mut request = Vec::with_capacity(16384);
    let mut byte = [0u8; 1];
    while !request.ends_with(b"\r\n\r\n") {
        ensure!(request.len() < 16384, "request headers exceed 16 KiB");
        let n = tokio::time::timeout(Duration::from_secs(10), socket.read(&mut byte))
            .await
            .context("header timeout")??;
        ensure!(n != 0, "client closed before complete headers");
        request.push(byte[0]);
    }
    let request = String::from_utf8(request).context("invalid request encoding")?;
    let mut lines = request.split("\r\n");
    let mut first = lines.next().unwrap_or_default().split_whitespace();
    let method = first.next().context("missing HTTP method")?;
    let route = first.next().context("missing route")?;
    let mut origin = None;
    let mut range = None;
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            match name.to_ascii_lowercase().as_str() {
                "range" => range = Some(value.trim().to_owned()),
                "origin" => origin = Some(value.trim().to_owned()),
                _ => {}
            }
        }
    }
    if origin
        .as_deref()
        .is_some_and(|o| o != "http://tauri.localhost")
    {
        headers(socket, 403, "text/plain", 0, None, false).await?;
        return Ok(());
    }
    if method == "OPTIONS" {
        socket.write_all(format!("HTTP/1.1 204 No Content\r\n{CORS}Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: Range\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes()).await?;
        state.log(json!({"event":"media-options","origin":origin,"status":204,"atMs":at_ms}));
        return Ok(());
    }
    let pieces: Vec<&str> = route.split('/').collect();
    if pieces.len() != 4
        || pieces[1] != state.0.token
        || !["range", "no-range"].contains(&pieces[2])
        || !["GET", "HEAD"].contains(&method)
    {
        headers(socket, 404, "text/plain", 0, None, false).await?;
        return Ok(());
    }
    let mode = pieces[2];
    let sample = pieces[3];
    let object = state.object(sample)?;
    let upstream_range = if mode == "no-range" {
        None
    } else {
        range.clone()
    };
    let mut get = state
        .0
        .s3
        .get_object()
        .bucket(&object.bucket)
        .key(&object.object_key);
    if let Some(value) = &upstream_range {
        get = get.range(value);
    }
    let upstream_status = Arc::new(AtomicU64::new(0));
    let response = Box::pin(
        get.customize()
            .interceptor(StatusCapture(upstream_status.clone()))
            .send(),
    )
    .await;
    let response = match response {
        Ok(response) => response,
        Err(error) => {
            let status = error
                .raw_response()
                .map(|r| r.status().as_u16())
                .unwrap_or(502);
            let safe_status = match status {
                403 | 404 | 416 => status,
                _ => 502,
            };
            let content_range = if safe_status == 416 {
                Some(format!("bytes */{}", object.size))
            } else {
                None
            };
            headers(
                socket,
                safe_status,
                "text/plain",
                0,
                content_range.as_deref(),
                true,
            )
            .await?;
            state.log(json!({"event":"media-request","sample":sample,"mode":mode,"method":method,"range":range,"upstreamRange":upstream_range,"upstreamStatus":status,"status":safe_status,"origin":origin,"bytesRead":0,"bytesWritten":0,"atMs":at_ms,"endMs":now_ms(),"elapsedMs":start.elapsed().as_millis()}));
            return Ok(());
        }
    };
    let status = upstream_status.load(Ordering::SeqCst) as u16;
    ensure!(
        matches!(status, 200 | 206),
        "unexpected successful upstream status"
    );
    let declared = response
        .content_length()
        .context("object service omitted Content-Length")?;
    ensure!(
        declared >= 0,
        "object service returned negative Content-Length"
    );
    let declared = declared as u64;
    let content_range = response.content_range().map(str::to_owned);
    ensure!(
        upstream_range.is_none() || status == 206,
        "object service ignored requested Range"
    );
    headers(
        socket,
        status,
        &object.mime,
        declared,
        content_range.as_deref(),
        mode == "range",
    )
    .await?;
    let mut written = 0u64;
    let mut read = 0u64;
    let mut disconnected = false;
    let mut read_failed = false;
    if method != "HEAD" {
        let mut reader = response.body.into_async_read();
        let mut buffer = [0u8; 65536];
        loop {
            let n = match tokio::time::timeout(Duration::from_secs(20), reader.read(&mut buffer))
                .await
            {
                Ok(Ok(n)) => n,
                _ => {
                    read_failed = true;
                    break;
                }
            };
            if n == 0 {
                break;
            }
            read += n as u64;
            match tokio::time::timeout(Duration::from_secs(10), socket.write_all(&buffer[..n]))
                .await
            {
                Ok(Ok(())) => {
                    written += n as u64;
                    state.0.bytes.fetch_add(n as u64, Ordering::SeqCst);
                }
                _ => {
                    disconnected = true;
                    break;
                }
            }
        }
    }
    state.log(json!({"event":"media-request","sample":sample,"mode":mode,"method":method,"range":range,"upstreamRange":upstream_range,"upstreamStatus":status,"status":status,"contentRange":content_range,"declaredLength":declared,"bytesRead":read,"bytesWritten":written,"disconnected":disconnected,"readFailed":read_failed,"origin":origin,"atMs":at_ms,"endMs":now_ms(),"elapsedMs":start.elapsed().as_millis()}));
    let _ = socket.shutdown().await;
    Ok(())
}
