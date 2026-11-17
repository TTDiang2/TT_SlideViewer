mod commands;
pub mod index;
pub mod slide;

use std::sync::Mutex;

use commands::{AppState, Store};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // single instance must be registered first; a second launch focuses the
    // existing window and exits.
    builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
        }
    }));

    builder
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            store: Mutex::new(Store::default()),
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_slides,
            commands::warm_slides,
            commands::slide_info,
            commands::get_tiles,
            commands::slide_thumb,
            commands::default_root,
            commands::save_export,
            commands::load_annotations,
            commands::save_annotations,
            commands::load_settings,
            commands::save_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

