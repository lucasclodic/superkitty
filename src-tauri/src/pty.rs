//! PTY session management.
//!
//! Each terminal in the UI is backed by a real PTY whose command is
//! `tmux new-session -A -s <name>` (attach-or-create). This is what gives us
//! persistence "for free": closing the window only drops the PTY (tmux detaches),
//! while the real processes — including a running `claude` — keep living inside
//! the tmux server. Reopening with the same id re-attaches and restores the
//! scrollback and the running session.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use std::thread;

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter, State};

/// A live PTY: its writer (stdin side) and the master handle (for resize).
struct PtyInstance {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
}

#[derive(Default)]
pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtyInstance>>,
}

/// Prefix used for tmux session names so we never collide with the user's own
/// tmux sessions.
fn tmux_session_name(id: &str) -> String {
    format!("superkitty-{id}")
}

#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    state: State<PtyManager>,
    id: String,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> Result<(), String> {
    // If we already have a live PTY for this id, do nothing (avoids double
    // spawns from React effect re-runs).
    if state.sessions.lock().unwrap().contains_key(&id) {
        return Ok(());
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let session_name = tmux_session_name(&id);
    let mut cmd = CommandBuilder::new("tmux");
    // -A: attach if the session exists, otherwise create it.
    // -D: detach any other client already attached, so a single UI owns it.
    cmd.args(["new-session", "-A", "-D", "-s", &session_name]);
    cmd.env("TERM", "xterm-256color");
    if let Some(dir) = cwd {
        cmd.cwd(dir);
    }

    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    // Slave handle is owned by the child now; dropping our copy lets EOF
    // propagate correctly when the child exits.
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    state.sessions.lock().unwrap().insert(
        id.clone(),
        PtyInstance {
            writer,
            master: pair.master,
        },
    );

    // Reader thread: stream raw bytes to the frontend as they arrive.
    let app_for_thread = app.clone();
    let id_for_thread = id.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let _ = app_for_thread
                        .emit(&format!("pty://output/{id_for_thread}"), &buf[..n]);
                }
                Err(_) => break,
            }
        }
        let _ = child.wait();
        let _ = app_for_thread.emit(&format!("pty://exit/{id_for_thread}"), ());
    });

    Ok(())
}

#[tauri::command]
pub fn pty_write(state: State<PtyManager>, id: String, data: String) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    if let Some(inst) = sessions.get_mut(&id) {
        inst.writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        inst.writer.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn pty_resize(
    state: State<PtyManager>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state.sessions.lock().unwrap();
    if let Some(inst) = sessions.get(&id) {
        inst.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Detach the UI from a PTY without killing the tmux session.
/// This is the path when the window/app closes — the session survives so it can
/// be resumed later. Dropping our master handle hangs up the `tmux attach`
/// client; the tmux *server* keeps the real processes alive.
#[tauri::command]
pub fn pty_detach(state: State<PtyManager>, id: String) {
    state.sessions.lock().unwrap().remove(&id);
}

/// Permanently close a session: drop our handle AND kill the tmux session.
/// This is the path when the user deliberately closes a pane/tab (⌘W) — they
/// want that terminal gone, not parked.
#[tauri::command]
pub fn pty_kill(state: State<PtyManager>, id: String) {
    state.sessions.lock().unwrap().remove(&id);
    let session_name = tmux_session_name(&id);
    let _ = std::process::Command::new("tmux")
        .args(["kill-session", "-t", &session_name])
        .status();
}
