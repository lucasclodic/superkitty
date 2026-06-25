mod pty;

use pty::PtyManager;
use tauri::menu::{AboutMetadata, MenuBuilder, SubmenuBuilder};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(PtyManager::default())
        // Custom menu: deliberately omits the default Window > Close (⌘W) and
        // Minimize (⌘M) so those key combos reach the webview, where ⌘W means
        // "close the focused pane". Keeps Quit + clipboard items.
        .menu(|handle| {
            let app_menu = SubmenuBuilder::new(handle, "superkitty")
                .about(Some(AboutMetadata::default()))
                .separator()
                .quit()
                .build()?;
            let edit_menu = SubmenuBuilder::new(handle, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;
            MenuBuilder::new(handle)
                .items(&[&app_menu, &edit_menu])
                .build()
        })
        .invoke_handler(tauri::generate_handler![
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_detach,
            pty::pty_kill,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
