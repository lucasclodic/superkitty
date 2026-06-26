mod pty;

use pty::PtyManager;
use tauri::menu::{AboutMetadata, MenuBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};

/// Show+focus the window (and tell the UI to pop the quick-prompt) or hide it,
/// driven by the global Quake hotkey (idea #19). Hides only when already focused
/// so the hotkey raises superkitty from another app on the first press.
fn toggle_quake(app: &tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let visible = win.is_visible().unwrap_or(false);
        let focused = win.is_focused().unwrap_or(false);
        if visible && focused {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.set_focus();
            let _ = app.emit("quake://shown", ());
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

    // Quake-style global hotkey: ⌃` toggles superkitty from any app (idea #19).
    let quake = Shortcut::new(Some(Modifiers::CONTROL), Code::Backquote);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_quake(app);
                    }
                })
                .build(),
        )
        .setup(move |app| {
            use tauri_plugin_global_shortcut::GlobalShortcutExt;
            // Best-effort: a failure (combo taken, no accessibility perms…)
            // must not stop the app from launching.
            let _ = app.global_shortcut().register(quake);
            Ok(())
        })
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
            pty::pty_redraw,
            pty::pty_detach,
            pty::pty_kill,
            pty::pty_cwd,
            pty::pty_foreground,
            pty::pty_scroll_state,
            pty::pty_scroll_to,
            pty::pty_scroll,
            pty::tmux_list_sessions,
            pty::tmux_kill_session,
            pty::notify,
            pty::play_sound,
            pty::save_image,
            pty::clipboard_file_paths,
            pty::list_files,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
