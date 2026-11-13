#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod ai;
mod media;
mod store;
use std::sync::{Arc, Mutex};

fn main() {
    let media = media::MediaHost::new().expect("start local file reader");
    tauri::Builder::default()
        .manage(Arc::new(Mutex::new(store::Store::new())))
        .manage(media)
        .manage(ai::AiHost::default())
        .invoke_handler(tauri::generate_handler![
            store::app_load,
            store::directory_select,
            store::point_save,
            store::delete_preview,
            store::point_delete,
            store::resource_add_link,
            store::resource_associate,
            store::resource_remove,
            store::point_move,
            store::ai_records,
            ai::ai_settings,
            ai::ai_configure,
            ai::ai_check,
            ai::ai_start,
            ai::ai_cancel,
            ai::ai_adopt,
            ai::ai_read_text,
            media::choose_file,
            media::choose_directory,
            media::resource_add_file,
            media::copy_cancel,
            media::media_open,
            media::media_close,
            media::resource_external
        ])
        .setup(|app| {
            let mut window = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("Noterion · 个人知识图谱")
            .inner_size(1600.0, 1000.0)
            .min_inner_size(1000.0, 700.0);
            if let Some(path) = std::env::var_os("NOTERION_WEBVIEW_DIR") {
                window = window.data_directory(path.into());
            }
            #[cfg(debug_assertions)]
            if std::env::var("NOTERION_GRAPH_FAIL_ONCE").as_deref() == Ok("1") {
                window =
                    window.initialization_script("window.__NOTERION_GRAPH_FAIL_ONCE__ = true;");
            }
            window.build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("run Noterion");
}
