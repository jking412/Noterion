use crate::store::{self, SharedStore, Snapshot};
use serde::Serialize;
use std::{
    collections::HashMap,
    fs::{File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::Emitter;

#[derive(Clone)]
pub struct MediaHost(Arc<Inner>);
struct Inner {
    port: u16,
    streams: Mutex<HashMap<String, Arc<StreamFile>>>,
    jobs: Mutex<HashMap<String, Arc<AtomicBool>>>,
    active: AtomicUsize,
    audit: Mutex<Option<File>>,
}
struct StreamFile {
    path: PathBuf,
    mime: String,
    size: u64,
    cancelled: AtomicBool,
}
impl MediaHost {
    pub fn new() -> Result<Self, String> {
        let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        let audit = std::env::var_os("NOTERION_MEDIA_AUDIT")
            .and_then(|p| OpenOptions::new().create(true).append(true).open(p).ok());
        let host = Self(Arc::new(Inner {
            port: listener.local_addr().unwrap().port(),
            streams: Mutex::new(HashMap::new()),
            jobs: Mutex::new(HashMap::new()),
            active: AtomicUsize::new(0),
            audit: Mutex::new(audit),
        }));
        host.log(serde_json::json!({"event":"process-started","pid":std::process::id(),"exe":std::env::current_exe().ok(),"bufferBytes":65536,"port":host.0.port}));
        let serving = host.clone();
        std::thread::spawn(move || {
            for socket in listener.incoming().flatten() {
                if serving.0.active.fetch_add(1, Ordering::SeqCst) >= 4 {
                    serving.0.active.fetch_sub(1, Ordering::SeqCst);
                    let mut socket = socket;
                    let _ = socket.write_all(
                        b"HTTP/1.1 503 Busy\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                    );
                    continue;
                }
                let host = serving.clone();
                std::thread::spawn(move || {
                    let _ = serve(&host, socket);
                    host.0.active.fetch_sub(1, Ordering::SeqCst);
                });
            }
        });
        Ok(host)
    }
    fn log(&self, value: serde_json::Value) {
        if let Ok(mut audit) = self.0.audit.lock() {
            if let Some(file) = audit.as_mut() {
                let _ = writeln!(file, "{value}");
                let _ = file.flush();
            }
        }
    }
}

// Bounded 64 KiB buffers for both Range and complete reads. A disconnected or
// revoked viewer stops the next read; no whole-file allocation or IPC payload.
fn serve(host: &MediaHost, mut socket: TcpStream) -> std::io::Result<()> {
    socket.set_read_timeout(Some(Duration::from_secs(5)))?;
    socket.set_write_timeout(Some(Duration::from_secs(3)))?;
    let mut request = Vec::with_capacity(2048);
    let mut byte = [0u8; 1];
    while request.len() < 16384 {
        if socket.read(&mut byte)? == 0 {
            return Ok(());
        }
        request.push(byte[0]);
        if request.ends_with(b"\r\n\r\n") {
            break;
        }
    }
    let request = String::from_utf8_lossy(&request);
    let first = request.lines().next().unwrap_or("");
    let words: Vec<_> = first.split_whitespace().collect();
    let method = words.first().copied().unwrap_or("");
    let path = words.get(1).copied().unwrap_or("");
    let token = path.strip_prefix('/').unwrap_or("");
    let file = host.0.streams.lock().unwrap().get(token).cloned();
    let Some(file) = file.filter(|f| !f.cancelled.load(Ordering::SeqCst)) else {
        socket.write_all(
            b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        )?;
        return Ok(());
    };
    if method != "GET" && method != "HEAD" {
        socket.write_all(
            b"HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        )?;
        return Ok(());
    }
    let range = request.lines().find_map(|line| {
        line.split_once(':')
            .filter(|(name, _)| name.eq_ignore_ascii_case("range"))
            .map(|(_, value)| value.trim())
    });
    let parsed = match range {
        Some(value) => parse_range(value, file.size).map(Some),
        None => Ok(None),
    };
    let (start, end, partial) = match parsed {
        Ok(Some((a, b))) => (a, b, true),
        Ok(None) => (0, file.size.saturating_sub(1), false),
        Err(()) => {
            write!(socket,"HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",file.size)?;
            return Ok(());
        }
    };
    let mut source = match File::open(&file.path) {
        Ok(f) => f,
        Err(_) => {
            socket.write_all(
                b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            )?;
            return Ok(());
        }
    };
    if source.metadata()?.len() != file.size {
        socket.write_all(
            b"HTTP/1.1 409 File Changed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        )?;
        return Ok(());
    }
    let length = if file.size == 0 { 0 } else { end - start + 1 };
    let content_range = if partial {
        format!("Content-Range: bytes {start}-{end}/{}\r\n", file.size)
    } else {
        String::new()
    };
    write!(socket, "HTTP/1.1 {}\r\nContent-Type: {}\r\nContent-Length: {length}\r\n{content_range}Accept-Ranges: bytes\r\nAccess-Control-Allow-Origin: http://tauri.localhost\r\nAccess-Control-Expose-Headers: Content-Range, Content-Length\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",if partial {"206 Partial Content"} else {"200 OK"},file.mime)?;
    let mut written = 0;
    let mut read = 0;
    let outcome = (|| -> std::io::Result<()> {
        if method == "HEAD" {
            return Ok(());
        }
        source.seek(SeekFrom::Start(start))?;
        let mut buffer = [0u8; 65536];
        while written < length && !file.cancelled.load(Ordering::SeqCst) {
            let take = (length - written).min(buffer.len() as u64) as usize;
            let n = source.read(&mut buffer[..take])?;
            if n == 0 {
                break;
            }
            read += n as u64;
            socket.write_all(&buffer[..n])?;
            written += n as u64;
        }
        Ok(())
    })();
    host.log(serde_json::json!({"event":"file-read","method":method,"range":range,"start":start,"end":end,"size":file.size,"bytesRead":read,"bytesWritten":written,"bufferBytes":65536,"cancelled":file.cancelled.load(Ordering::SeqCst)||outcome.is_err(),"revoked":file.cancelled.load(Ordering::SeqCst),"disconnected":outcome.is_err(),"complete":written==length,"error":outcome.as_ref().err().map(|e|e.to_string())}));
    outcome
}
fn parse_range(value: &str, size: u64) -> Result<(u64, u64), ()> {
    let value = value.strip_prefix("bytes=").ok_or(())?;
    if value.contains(',') || size == 0 {
        return Err(());
    }
    let (a, b) = value.split_once('-').ok_or(())?;
    if a.is_empty() {
        let n = b.parse::<u64>().map_err(|_| ())?;
        if n == 0 {
            return Err(());
        }
        return Ok((size.saturating_sub(n), size - 1));
    }
    let start = a.parse::<u64>().map_err(|_| ())?;
    let end = if b.is_empty() {
        size - 1
    } else {
        b.parse::<u64>().map_err(|_| ())?.min(size - 1)
    };
    if start >= size || start > end {
        Err(())
    } else {
        Ok((start, end))
    }
}
#[tauri::command]
pub async fn choose_file() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .pick_file()
            .map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn choose_directory() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .pick_folder()
            .map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn copy_cancel(job_id: String, state: tauri::State<'_, MediaHost>) {
    if let Some(cancel) = state.0.jobs.lock().unwrap().get(&job_id) {
        cancel.store(true, Ordering::SeqCst);
    }
}

fn classify(filename: &str) -> (String, String) {
    let ext = std::path::Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let (kind, mime) = match ext.as_str() {
        "pdf" => ("pdf", "application/pdf"),
        "png" => ("image", "image/png"),
        "jpg" | "jpeg" => ("image", "image/jpeg"),
        "webp" => ("image", "image/webp"),
        "gif" => ("image", "image/gif"),
        "bmp" => ("image", "image/bmp"),
        "mp4" | "m4v" => ("video", "video/mp4"),
        "webm" => ("video", "video/webm"),
        "mkv" => ("video", "video/x-matroska"),
        "mov" => ("video", "video/quicktime"),
        "avi" => ("video", "video/x-msvideo"),
        "txt" => ("text", "text/plain; charset=utf-8"),
        "md" | "markdown" => ("markdown", "text/plain; charset=utf-8"),
        _ => ("file", "application/octet-stream"),
    };
    (kind.into(), mime.into())
}
fn ensure_copy_space(directory: &std::path::Path, required: u64) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetDiskFreeSpaceExW(
            directory: *const u16,
            available: *mut u64,
            total: *mut u64,
            free: *mut u64,
        ) -> i32;
    }
    let directory: Vec<u16> = directory.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut available = 0u64;
    if unsafe {
        GetDiskFreeSpaceExW(
            directory.as_ptr(),
            &mut available,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    } == 0
    {
        return Err(format!(
            "无法检查资料目录的可用空间：{}",
            std::io::Error::last_os_error()
        ));
    }
    if required > available {
        return Err(format!(
            "资料目录磁盘空间不足：需要 {required} 字节，可用 {available} 字节。未添加资料。"
        ));
    }
    Ok(())
}
#[tauri::command]
pub async fn resource_add_file(
    path: String,
    title: String,
    point_ids: Vec<String>,
    job_id: String,
    state: tauri::State<'_, SharedStore>,
    media: tauri::State<'_, MediaHost>,
    app: tauri::AppHandle,
) -> Result<Snapshot, String> {
    let store = state.inner().clone();
    let host = media.inner().clone();
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut jobs = host.0.jobs.lock().unwrap();
        if jobs.contains_key(&job_id) {
            return Err("这次复制正在进行。".into());
        }
        jobs.insert(job_id.clone(), cancel.clone());
    }
    let job = job_id.clone();
    let cleanup_host = host.clone();
    let result=tauri::async_runtime::spawn_blocking(move||{
        let source_path=PathBuf::from(path);
        let filename=source_path.file_name().and_then(|n|n.to_str()).ok_or("请选择有效的文件。")?.to_string();
        let mut source=File::open(&source_path).map_err(|e|format!("无法读取源文件：{e}"))?;
        let original=source.metadata().map_err(|e|e.to_string())?;
        if !original.is_file(){return Err("请选择文件，而不是文件夹。".into());}
        let directory=store.lock().map_err(|_|"数据忙，请重启后重试。")?.files_dir()?;
        ensure_copy_space(&directory, original.len())?;
        let id=uuid::Uuid::new_v4().to_string();
        let partial=directory.join(format!("{id}.partial"));
        let final_path=directory.join(store::managed_name(&id,&filename));
        let copy=(||->Result<Snapshot,String>{
            let mut destination=OpenOptions::new().write(true).create_new(true).open(&partial).map_err(|e|format!("无法创建文件副本：{e}"))?;
            let mut buffer=[0u8;131072];let mut total=0u64;let mut last_progress=0;
            loop{
                if cancel.load(Ordering::SeqCst){return Err("复制已取消，未添加资料。".into());}
                let count=source.read(&mut buffer).map_err(|e|format!("读取源文件失败：{e}"))?;
                if count==0{break;}
                destination.write_all(&buffer[..count]).map_err(|e|format!("保存副本失败，请检查权限和磁盘空间：{e}"))?;
                total+=count as u64;
                if total-last_progress>=8*1024*1024{let _=app.emit("copy-progress",serde_json::json!({"jobId":job,"copied":total,"total":original.len()}));last_progress=total;}
            }
            let after=source.metadata().map_err(|e|e.to_string())?;
            if total!=original.len() || after.len()!=original.len() || after.modified().ok()!=original.modified().ok(){return Err("复制过程中源文件发生变化，请重试。".into());}
            destination.sync_all().map_err(|e|format!("副本未完整写入磁盘：{e}"))?;drop(destination);
            let mut data=store.lock().map_err(|_|"数据忙，请重启后重试。")?;
            if data.files_dir()?!=directory{return Err("数据目录已切换，本次复制未提交。".into());}
            if cancel.load(Ordering::SeqCst){return Err("复制已取消，未添加资料。".into());}
            std::fs::rename(&partial,&final_path).map_err(|e|format!("完成副本失败：{e}"))?;
            let (kind,mime)=classify(&filename);
            data.add_copied_file(store::CopiedFile {
                id, filename: filename.clone(),
                title: if title.trim().is_empty(){filename}else{title.trim().into()},
                mime, kind, size: total,
            }, point_ids)
        })();
        if copy.is_err(){let _=std::fs::remove_file(&partial);let _=std::fs::remove_file(&final_path);}
        host.log(serde_json::json!({"event":"file-copy","size":original.len(),"success":copy.is_ok(),"bufferBytes":131072,"error":copy.as_ref().err()}));
        copy
    }).await.map_err(|e|e.to_string()).and_then(|v|v);
    cleanup_host.0.jobs.lock().unwrap().remove(&job_id);
    result
}
#[derive(Serialize)]
pub struct MediaReply {
    url: String,
    mime: String,
    size: u64,
}
#[tauri::command]
pub fn media_open(
    id: String,
    state: tauri::State<'_, SharedStore>,
    media: tauri::State<'_, MediaHost>,
) -> Result<MediaReply, String> {
    let (path, mime, size) = state
        .lock()
        .map_err(|_| "数据忙，请重启后重试。")?
        .resolve_file(&id)?;
    let token = uuid::Uuid::new_v4().to_string();
    media.0.streams.lock().unwrap().insert(
        token.clone(),
        Arc::new(StreamFile {
            path,
            mime: mime.clone(),
            size,
            cancelled: AtomicBool::new(false),
        }),
    );
    Ok(MediaReply {
        url: format!("http://127.0.0.1:{}/{token}", media.0.port),
        mime,
        size,
    })
}
#[tauri::command]
pub fn media_close(url: String, state: tauri::State<'_, MediaHost>) {
    if let Some(token) = url.strip_prefix(&format!("http://127.0.0.1:{}/", state.0.port)) {
        if let Some(stream) = state.0.streams.lock().unwrap().remove(token) {
            stream.cancelled.store(true, Ordering::SeqCst);
        }
    }
}
#[tauri::command]
pub fn resource_external(
    id: String,
    state: tauri::State<'_, SharedStore>,
    media: tauri::State<'_, MediaHost>,
) -> Result<(), String> {
    let data = state.lock().map_err(|_| "数据忙，请重启后重试。")?;
    let snapshot = data.snapshot()?;
    let resource = snapshot
        .resources
        .iter()
        .find(|r| r.id == id)
        .ok_or("资料不存在。")?;
    let target = if resource.kind == "link" {
        resource.url.clone().ok_or("链接不可用。")?
    } else {
        data.resolve_file(&id)?.0.to_string_lossy().into_owned()
    };
    // ShellExecuteW passes the target as a single UTF-16 argument, without a shell.
    let target_path = target.clone();
    let target: Vec<u16> = target.encode_utf16().chain(Some(0)).collect();
    #[link(name = "shell32")]
    unsafe extern "system" {
        fn ShellExecuteW(
            hwnd: isize,
            operation: *const u16,
            file: *const u16,
            parameters: *const u16,
            directory: *const u16,
            show: i32,
        ) -> isize;
    }
    let result = unsafe {
        ShellExecuteW(
            0,
            std::ptr::null(),
            target.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            1,
        )
    };
    media.log(serde_json::json!({"event":"external-open","id":id,"path":target_path,"result":result,"success":result>32}));
    if result <= 32 {
        Err(format!("系统应用打开失败（{result}），请检查文件关联。"))
    } else {
        Ok(())
    }
}
