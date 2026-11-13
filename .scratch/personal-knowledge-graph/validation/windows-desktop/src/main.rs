#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::{
    fs::{File, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

struct Audit {
    file: File,
    calls: u32,
    run_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Reply {
    original: String,
    uppercase: String,
    char_count: usize,
    call: u32,
    pid: u32,
    run_id: String,
    rust_unix_ms: u128,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Rejection {
    code: &'static str,
    message: &'static str,
    call: u32,
    pid: u32,
}

#[tauri::command]
fn issue3_roundtrip(
    request: String,
    state: tauri::State<'_, Mutex<Audit>>,
) -> Result<Reply, Rejection> {
    let mut audit = state.lock().expect("audit mutex poisoned");
    audit.calls += 1;
    let pid = std::process::id();
    if request.trim().is_empty() {
        let rejection = Rejection {
            code: "EMPTY_REQUEST",
            message: "Rust 拒绝空白输入",
            call: audit.calls,
            pid,
        };
        let record = serde_json::json!({
            "event": "rust-command-rejected", "command": "issue3_roundtrip",
            "runId": audit.run_id, "request": request, "error": rejection
        });
        writeln!(audit.file, "{record}").expect("write rejection evidence");
        audit.file.sync_all().expect("flush rejection evidence");
        return Err(rejection);
    }
    let reply = Reply {
        uppercase: request.to_uppercase(),
        char_count: request.chars().count(),
        original: request,
        call: audit.calls,
        pid,
        run_id: audit.run_id.clone(),
        rust_unix_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis(),
    };
    let record = serde_json::json!({
        "event": "rust-command-returned", "command": "issue3_roundtrip", "reply": reply
    });
    writeln!(audit.file, "{record}").expect("write command evidence");
    audit.file.sync_all().expect("flush command evidence");
    Ok(reply)
}

fn main() {
    let evidence = PathBuf::from(
        std::env::var_os("ISSUE3_EVIDENCE_DIR")
            .expect("launch with launch.ps1: ISSUE3_EVIDENCE_DIR is required"),
    );
    let data = PathBuf::from(
        std::env::var_os("ISSUE3_DATA_DIR")
            .expect("launch with launch.ps1: ISSUE3_DATA_DIR is required"),
    );
    assert!(
        evidence.is_absolute() && data.is_absolute(),
        "evidence and data paths must be absolute"
    );
    std::fs::create_dir_all(&evidence).expect("create evidence directory");
    std::fs::create_dir_all(&data).expect("create isolated WebView data directory");
    let run_id = std::env::var("ISSUE3_RUN_ID").expect("ISSUE3_RUN_ID is required");
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(evidence.join("rust-events.jsonl"))
        .expect("open audit log");
    writeln!(
        file,
        "{}",
        serde_json::json!({
            "event": "process-started", "pid": std::process::id(), "runId": run_id,
            "exe": std::env::current_exe().unwrap(), "webviewData": data
        })
    )
    .unwrap();
    file.sync_all().unwrap();
    tauri::Builder::default()
        .manage(Mutex::new(Audit {
            file,
            calls: 0,
            run_id,
        }))
        .invoke_handler(tauri::generate_handler![issue3_roundtrip])
        .setup(move |app| {
            tauri::WebviewWindowBuilder::new(
                app,
                "issue3-main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("Issue3 — Noterion Windows / Rust smoke")
            .inner_size(880.0, 640.0)
            .data_directory(data.clone())
            .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("run actual Tauri Windows host");
}
