#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod keyring_plugin;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            keyring_plugin::keyring_get,
            keyring_plugin::keyring_set,
            keyring_plugin::keyring_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
