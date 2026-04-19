#![windows_subsystem = "windows"]

mod commands;
mod organizer;

use commands::{AppSettings, AppState};
use tauri::Manager;
use tauri_plugin_store::StoreExt;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Восстанавливаем настройки из store при старте
            if let Some(store) = app.get_store("settings") {
                if let Some(val) = store.get("app_settings") {
                    if let Ok(loaded) = serde_json::from_value::<AppSettings>(val) {
                        let state = app.state::<AppState>();
                        if let Ok(mut s) = state.settings.lock() {
                            *s = loaded;
                        }
                    }
                }
            }
            Ok(())
        })
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::save_settings,
            commands::load_photos_without_caption,
            commands::generate_caption,
            commands::save_photo_caption,
            commands::list_lmstudio_models,
            organizer::organizer_list_images,
            organizer::organizer_classify_image,
            organizer::organizer_generate_folders,
            organizer::organizer_move_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
