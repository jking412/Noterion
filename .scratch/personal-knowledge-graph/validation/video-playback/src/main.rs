#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod storage;
mod streaming;

use anyhow::{Context, Result, ensure};
use aws_sdk_s3::presigning::PresigningConfig;
use serde::Serialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs::{File, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[derive(Clone)]
pub struct Host(Arc<Inner>);
pub struct Inner {
    s3: aws_sdk_s3::Client,
    root: PathBuf,
    evidence: PathBuf,
    objects: Vec<storage::Object>,
    token: String,
    audit: Mutex<File>,
    active: AtomicU64,
    completed: AtomicU64,
    bytes: AtomicU64,
}

impl Host {
    fn object(&self, sample: &str) -> Result<&storage::Object> {
        self.0
            .objects
            .iter()
            .find(|o| o.sample == sample)
            .context("unknown sample")
    }
    fn log(&self, event: Value) {
        let mut audit = self.0.audit.lock().expect("audit mutex");
        writeln!(audit, "{event}").expect("write audit evidence");
        audit.flush().expect("flush audit evidence");
    }
}

pub fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Media {
    url: String,
    sample: String,
    mode: String,
    size: u64,
    mime: String,
}

async fn open_media(sample: String, mode: String, state: Host) -> Result<Media> {
    let object = state.object(&sample)?;
    ensure!(
        ["range", "no-range", "direct"].contains(&mode.as_str()),
        "invalid read mode"
    );
    let url = if mode == "direct" {
        let signed = Box::pin(
            state
                .0
                .s3
                .get_object()
                .bucket(&object.bucket)
                .key(&object.object_key)
                .presigned(PresigningConfig::expires_in(Duration::from_secs(5))?),
        )
        .await
        .map_err(|_| anyhow::anyhow!("presign failed"))?;
        signed.uri().to_owned()
    } else {
        format!(
            "http://127.0.0.1:19310/{}/{}/{}",
            state.0.token, mode, sample
        )
    };
    state.log(json!({"event":"media-open","sample":sample,"mode":mode,"size":object.size,"atMs":now_ms()}));
    Ok(Media {
        url,
        sample,
        mode,
        size: object.size,
        mime: object.mime.clone(),
    })
}

#[tauri::command]
async fn media_open(
    sample: String,
    mode: String,
    state: tauri::State<'_, Host>,
) -> Result<Media, String> {
    Box::pin(open_media(sample, mode, state.inner().clone()))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn diagnostics(state: tauri::State<'_, Host>) -> Value {
    json!({"active":state.0.active.load(Ordering::SeqCst),"completed":state.0.completed.load(Ordering::SeqCst),"bytesWritten":state.0.bytes.load(Ordering::SeqCst),"bufferBytes":65536,"maxConcurrent":4,"pid":std::process::id()})
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct External {
    pid: u32,
    size: u64,
    sha256: String,
    path: String,
}

async fn external(sample: String, state: Host) -> Result<External> {
    let object = state.object(&sample)?;
    let directory = state.0.root.join(".local/view-cache");
    tokio::fs::create_dir_all(&directory).await?;
    let destination = directory.join(&object.file_name);
    let partial = directory.join(format!("{}.partial", object.file_name));
    let response = Box::pin(
        state
            .0
            .s3
            .get_object()
            .bucket(&object.bucket)
            .key(&object.object_key)
            .send(),
    )
    .await
    .map_err(|_| anyhow::anyhow!("external cache object GET failed"))?;
    let mut reader = response.body.into_async_read();
    let mut file = tokio::fs::File::create(&partial).await?;
    let mut buffer = [0u8; 65536];
    let mut size = 0;
    let mut digest = Sha256::new();
    loop {
        let n = reader
            .read(&mut buffer)
            .await
            .context("external cache read")?;
        if n == 0 {
            break;
        }
        file.write_all(&buffer[..n])
            .await
            .context("external cache write")?;
        size += n as u64;
        digest.update(&buffer[..n]);
    }
    file.sync_all().await?;
    drop(file);
    let sha256 = format!("{:x}", digest.finalize());
    ensure!(
        size == object.size && sha256 == object.sha256,
        "external cache failed source SHA256 check"
    );
    if tokio::fs::try_exists(&destination).await? {
        tokio::fs::remove_file(&destination).await?;
    }
    tokio::fs::rename(&partial, &destination).await?;
    let player =
        std::env::var_os("ISSUE13_FFPLAY").context("ISSUE13_FFPLAY external player required")?;
    let stderr = File::create(state.0.evidence.join(format!("external-{sample}.txt")))?;
    let mut command = std::process::Command::new(player);
    command
        .args(["-autoexit", "-volume", "0", "-loglevel", "info", "-stats"])
        .arg(&destination)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(stderr);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let child = command.spawn().context("launch external player")?;
    let pid = child.id();
    state.log(json!({"event":"external-open","sample":sample,"pid":pid,"size":size,"sha256":sha256,"atMs":now_ms(),"cacheFile":object.file_name}));
    Ok(External {
        pid,
        size,
        sha256,
        path: destination.display().to_string(),
    })
}

#[tauri::command]
async fn external_open(sample: String, state: tauri::State<'_, Host>) -> Result<External, String> {
    Box::pin(external(sample, state.inner().clone()))
        .await
        .map_err(|e| e.to_string())
}

fn run() -> Result<()> {
    let root = PathBuf::from(std::env::var_os("ISSUE13_ROOT").context("ISSUE13_ROOT required")?);
    let evidence = PathBuf::from(
        std::env::var_os("ISSUE13_EVIDENCE_DIR").context("ISSUE13_EVIDENCE_DIR required")?,
    );
    ensure!(
        root.is_absolute() && evidence.is_absolute(),
        "paths must be absolute"
    );
    std::fs::create_dir_all(&evidence)?;
    if std::env::args().any(|a| a == "--upload") {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .thread_stack_size(8 * 1024 * 1024)
            .build()?;
        return runtime.block_on(Box::pin(storage::upload(&root, &evidence)));
    }
    let data =
        PathBuf::from(std::env::var_os("ISSUE13_DATA_DIR").context("ISSUE13_DATA_DIR required")?);
    ensure!(data.is_absolute(), "WebView data must be absolute");
    std::fs::create_dir_all(&data)?;
    let objects: Vec<storage::Object> =
        serde_json::from_slice(&std::fs::read(root.join("evidence/objects.json"))?)?;
    let token = format!(
        "{:x}",
        Sha256::digest(
            format!(
                "{}:{}:{}",
                now_ms(),
                std::process::id(),
                std::env::var("ISSUE13_SECRET_KEY")?
            )
            .as_bytes()
        )
    );
    let state = Host(Arc::new(Inner {
        s3: storage::client()?,
        root,
        objects,
        token,
        audit: Mutex::new(
            OpenOptions::new()
                .create(true)
                .append(true)
                .open(evidence.join("rust-events.jsonl"))?,
        ),
        evidence,
        active: AtomicU64::new(0),
        completed: AtomicU64::new(0),
        bytes: AtomicU64::new(0),
    }));
    state.log(json!({"event":"process-started","pid":std::process::id(),"exe":std::env::current_exe()?,"runId":std::env::var("ISSUE13_RUN_ID").unwrap_or_default(),"atMs":now_ms(),"bufferBytes":65536,"maxConcurrent":4}));
    let listener = std::net::TcpListener::bind("127.0.0.1:19310")
        .context("media port 19310 already occupied")?;
    listener.set_nonblocking(true)?;
    let server_state = state.clone();
    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            media_open,
            external_open,
            diagnostics
        ])
        .setup(move |app| {
            tauri::async_runtime::spawn(Box::pin(streaming::serve(listener, server_state)));
            tauri::WebviewWindowBuilder::new(
                app,
                "issue13-main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("Issue13 — Noterion video playback")
            .inner_size(1050.0, 850.0)
            .data_directory(data.clone())
            .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .context("run actual Windows Tauri host")?;
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        // All object operations map SDK errors before reaching this boundary.
        eprintln!("Issue13 failed: {error}");
        std::process::exit(1);
    }
}
