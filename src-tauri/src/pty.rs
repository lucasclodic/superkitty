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

/// A live PTY: its writer (stdin side), the master handle (for resize) and the
/// name of the tmux session it drives.
struct PtyInstance {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    /// The tmux session this PTY is attached to. Usually `superkitty-<id>`, but
    /// can be an adopted external/raw session name (idea #2).
    session_name: String,
}

/// One tmux session as reported by `tmux list-sessions` (idea #2).
#[derive(serde::Serialize)]
pub struct TmuxSession {
    name: String,
    /// True when at least one client is attached to the session.
    attached: bool,
    windows: u32,
    /// Unix timestamps from tmux (`#{session_created}` / `#{session_activity}`).
    created: i64,
    activity: i64,
    /// True when the name carries our `superkitty-` prefix (created by us).
    superkitty: bool,
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

/// Resolve the tmux session name a pane id drives: the stored one if we have a
/// live PTY (handles adopted raw sessions), else the default `superkitty-<id>`.
fn resolved_session_name(state: &State<PtyManager>, id: &str) -> String {
    state
        .sessions
        .lock()
        .unwrap()
        .get(id)
        .map(|i| i.session_name.clone())
        .unwrap_or_else(|| tmux_session_name(id))
}

#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    state: State<PtyManager>,
    id: String,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    // Adopt a specific tmux session by name (idea #2). When omitted we use our
    // own `superkitty-<id>`. Lets the session sidebar re-attach an external/raw
    // session under a fresh pane id.
    session: Option<String>,
    // When true, wrap the freshly-created shell in a Seatbelt sandbox confining
    // writes to the project dir (idea #5). Ignored on `-A` re-attach.
    sandbox: Option<bool>,
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

    let session_name = session.unwrap_or_else(|| tmux_session_name(&id));

    // Best-effort: raise the scrollback so the (draggable) scrollbar has room to
    // work. Each superkitty pane is a single-window tmux session, so a
    // `history-limit` chained *after* new-session would never apply to that
    // pane — it has to be the server default *before* the pane is created. This
    // fails harmlessly when no server is running yet (the very first session
    // then boots with tmux's default 2000); every session created afterwards
    // inherits the larger limit.
    let _ = std::process::Command::new("tmux")
        .args(["set-option", "-g", "history-limit", "50000"])
        .status();

    let mut cmd = CommandBuilder::new("tmux");
    // -A: attach if the session exists, otherwise create it.
    // -D: detach any other client already attached, so a single UI owns it.
    cmd.args(["new-session", "-A", "-D", "-s", &session_name]);
    cmd.env("TERM", "xterm-256color");
    // Start a *newly created* session in `cwd` (the source pane's directory) so
    // ⌘D / ⌘T inherit the current folder instead of $HOME. `-c` is ignored by
    // tmux when -A re-attaches an existing session, which is exactly what we
    // want. Also set the spawned client's cwd as a fallback for the very first
    // session (before any tmux server exists).
    // The directory writes are confined to when sandboxed (the project dir, or
    // $HOME as a weak fallback when no cwd is known).
    let confine_dir = cwd
        .clone()
        .unwrap_or_else(|| std::env::var("HOME").unwrap_or_else(|_| "/".to_string()));
    if let Some(dir) = cwd {
        cmd.arg("-c");
        cmd.arg(&dir);
        cmd.cwd(dir);
    }
    // A *newly created* session runs a fresh login shell (`$SHELL -l`) so a new
    // pane reloads PATH/aliases/.zshrc instead of inheriting a frozen env
    // (idea #7). tmux ignores this command when `-A` re-attaches an existing
    // session, so reopening keeps the prior live state — exactly the
    // create-vs-reattach split we want. Passed as ONE positional string so tmux
    // runs it via `sh -c` (no getopt confusion over the `-l` flag); `exec`
    // replaces that sh with the login shell. Kept before the `;` that chains the
    // mouse option below. When sandboxed (idea #5), the login shell — and so its
    // whole child tree, including `claude` — is wrapped in `sandbox-exec`.
    let login_shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let plain = format!("exec {login_shell} -l");
    let shell_cmd = if sandbox.unwrap_or(false) {
        match write_sandbox_profile(&confine_dir, &session_name) {
            Some(p) => {
                format!("exec sandbox-exec -f {} {} -l", shq(&p), shq(&login_shell))
            }
            None => plain,
        }
    } else {
        plain
    };
    cmd.arg(shell_cmd);
    // Enable the mouse for THIS session only (scoped — never touches the user's
    // own tmux sessions on the same server). Without it, tmux runs in the
    // alternate screen with no mouse tracking, so xterm.js translates trackpad
    // scrolling into arrow keys — which recalls the previous shell/Claude prompt
    // ("the message I just typed comes back"). With mouse on, the wheel enters
    // tmux copy-mode and scrolls the real scrollback instead. The `;` is a tmux
    // command separator (its own arg) so the chained set-option runs after the
    // session is created/attached; idempotent across `-A` re-attaches. Kept after
    // the `-c` block so the cwd stays an argument of `new-session`.
    cmd.args([";", "set-option", "mouse", "on"]);

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
            session_name,
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
                    let chunk = &buf[..n];
                    let _ = app_for_thread
                        .emit(&format!("pty://output/{id_for_thread}"), chunk);
                    // A terminal bell (BEL, 0x07) is how Claude Code signals it
                    // finished / is waiting for input. Forward it so the UI can
                    // badge an unwatched pane + fire a macOS notification (#6).
                    if chunk.contains(&0x07) {
                        let _ = app_for_thread
                            .emit(&format!("pty://bell/{id_for_thread}"), ());
                    }
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

/// Report the current working directory of a session's active pane, so a new
/// pane/tab can be spawned in the same folder (idea #18). Returns `None` if the
/// session doesn't exist yet or tmux can't answer — the caller then falls back
/// to the default ($HOME).
#[tauri::command]
pub fn pty_cwd(state: State<PtyManager>, id: String) -> Option<String> {
    let session_name = resolved_session_name(&state, &id);
    let out = std::process::Command::new("tmux")
        .args([
            "display-message",
            "-p",
            "-t",
            &session_name,
            "#{pane_current_path}",
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if path.is_empty() {
        None
    } else {
        Some(path)
    }
}

/// Report the command currently running in the foreground of a session's pane
/// (tmux `#{pane_current_command}`), so the UI can warn before killing a pane
/// where an agent (`claude`/`node`/an editor…) is working instead of a bare
/// shell (idea #13). Returns `None` if the session is gone or tmux can't answer.
#[tauri::command]
pub fn pty_foreground(state: State<PtyManager>, id: String) -> Option<String> {
    let session_name = resolved_session_name(&state, &id);
    let out = std::process::Command::new("tmux")
        .args([
            "display-message",
            "-p",
            "-t",
            &session_name,
            "#{pane_current_command}",
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let cmd = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if cmd.is_empty() {
        None
    } else {
        Some(cmd)
    }
}

/// Scroll position of a session's active pane, used to drive the custom
/// scrollbar overlay (tmux owns the alternate screen, so xterm.js's own
/// scrollbar is inert — the real scrollback lives in tmux copy-mode).
#[derive(serde::Serialize)]
pub struct ScrollState {
    /// Lines scrolled up from the bottom. 0 = live (at the prompt / not in
    /// copy-mode).
    position: u32,
    /// Number of lines in the scrollback above the visible screen.
    history_size: u32,
    /// Visible rows of the pane.
    pane_height: u32,
}

/// Report where the pane is scrolled, so the overlay scrollbar can size and
/// place its thumb. `#{scroll_position}` is empty when not in copy-mode (live),
/// which we report as 0. Returns `None` if the session is gone / tmux can't
/// answer (overlay then hides).
#[tauri::command]
pub fn pty_scroll_state(state: State<PtyManager>, id: String) -> Option<ScrollState> {
    let session_name = resolved_session_name(&state, &id);
    let out = std::process::Command::new("tmux")
        .args([
            "display-message",
            "-p",
            "-t",
            &session_name,
            "#{scroll_position};#{history_size};#{pane_height}",
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let raw = String::from_utf8_lossy(&out.stdout);
    let mut parts = raw.trim().split(';');
    // scroll_position is empty when not in copy-mode → treat as 0 (at bottom).
    let position = parts.next().unwrap_or("").trim().parse().unwrap_or(0);
    let history_size = parts.next().and_then(|s| s.trim().parse().ok())?;
    let pane_height = parts.next().and_then(|s| s.trim().parse().ok())?;
    Some(ScrollState {
        position,
        history_size,
        pane_height,
    })
}

/// Scroll a session's pane to `position` lines above the bottom (0 = back to
/// the live prompt). Drives the draggable scrollbar overlay. `position == 0`
/// cancels copy-mode (returns to the live bottom); otherwise we enter copy-mode,
/// snap to the bottom, then scroll up exactly `position` lines for a
/// deterministic absolute position (tmux clamps at the top of history). The
/// `-N <n>` repeat count on `send-keys -X` is supported since tmux 2.4.
///
/// All commands are chained into a single `tmux` invocation (`;` separators as
/// their own args) so a drag — which fires this every ~50ms — spawns one process
/// per update instead of three.
#[tauri::command]
pub fn pty_scroll_to(state: State<PtyManager>, id: String, position: u32) {
    let session_name = resolved_session_name(&state, &id);
    if position == 0 {
        // Leave copy-mode → back to the live bottom. `-X cancel` is a no-op when
        // already live.
        let _ = std::process::Command::new("tmux")
            .args(["send-keys", "-t", &session_name, "-X", "cancel"])
            .status();
        return;
    }
    let count = position.to_string();
    let _ = std::process::Command::new("tmux")
        .args([
            // Enter copy-mode (idempotent if already in it),
            "copy-mode", "-t", &session_name, ";",
            // snap to the bottom so the scroll-up below is an absolute position,
            "send-keys", "-t", &session_name, "-X", "history-bottom", ";",
            // then scroll up exactly `position` lines.
            "send-keys", "-t", &session_name, "-X", "-N", &count, "scroll-up",
        ])
        .status();
}

/// Scroll a session's pane through tmux copy-mode, driven by the kitty-style
/// scrollback keyboard shortcuts (⌃⇧↑/↓ line, ⌃⇧PgUp/PgDn page, ⌃⇧Home/End,
/// ⌃⇧Z/X prompt-to-prompt). Each `action` maps to a copy-mode command. We enter
/// copy-mode first (idempotent) for every action except "bottom", which cancels
/// copy-mode to drop back to the live prompt. Prompt navigation relies on shell
/// integration marks (OSC 133); without them tmux simply does nothing.
#[tauri::command]
pub fn pty_scroll(state: State<PtyManager>, id: String, action: String) {
    let session_name = resolved_session_name(&state, &id);
    if action == "bottom" {
        // Back to the live bottom = leave copy-mode (no-op if already live).
        let _ = std::process::Command::new("tmux")
            .args(["send-keys", "-t", &session_name, "-X", "cancel"])
            .status();
        return;
    }
    let cmd = match action.as_str() {
        "line-up" => "scroll-up",
        "line-down" => "scroll-down",
        "page-up" => "page-up",
        "page-down" => "page-down",
        "top" => "history-top",
        "prompt-prev" => "previous-prompt",
        "prompt-next" => "next-prompt",
        _ => return,
    };
    // Enter copy-mode (idempotent if already in it), then dispatch the command.
    // The `;` is its own argument so tmux runs them as two chained commands.
    let _ = std::process::Command::new("tmux")
        .args([
            "copy-mode", "-t", &session_name, ";", "send-keys", "-t",
            &session_name, "-X", cmd,
        ])
        .status();
}

/// Detach the UI from a PTY without killing the tmux session, so it survives to
/// be resumed later. Two hazards to avoid (both confirmed in review):
///  - portable-pty's master *writer* injects "\n" + Ctrl-D (VEOF) when dropped,
///    which the still-attached `tmux` client would forward to the pane and could
///    KILL the session — defeating the whole point of detach. We zero VEOF on
///    the master first so that drop becomes a no-op.
///  - the reader thread holds a *cloned* master fd, so merely dropping our
///    handle never hangs up the tmux client (the thread would leak). We
///    explicitly `tmux detach-client` so the client exits, the slave closes, and
///    the reader sees EOF and finishes.
#[tauri::command]
pub fn pty_detach(state: State<PtyManager>, id: String) {
    let name = {
        let mut sessions = state.sessions.lock().unwrap();
        let inst = match sessions.remove(&id) {
            Some(i) => i,
            None => return,
        };
        if let Some(fd) = inst.master.as_raw_fd() {
            // Disable VEOF on the master so dropping the writer can't emit Ctrl-D
            // into the still-attached client (which would kill the session).
            unsafe {
                let mut t: libc::termios = std::mem::zeroed();
                if libc::tcgetattr(fd, &mut t) == 0 {
                    t.c_cc[libc::VEOF] = 0;
                    let _ = libc::tcsetattr(fd, libc::TCSANOW, &t);
                }
            }
        }
        inst.session_name.clone()
        // `inst` (master + writer) is dropped here — writer drop is now a no-op.
    };
    // Hang up the tmux client cleanly so the reader thread gets EOF and exits.
    let _ = std::process::Command::new("tmux")
        .args(["detach-client", "-s", &name])
        .status();
}

/// Permanently close a session: drop our handle AND kill the tmux session.
/// This is the path when the user deliberately closes a pane/tab (⌘W) — they
/// want that terminal gone, not parked.
#[tauri::command]
pub fn pty_kill(state: State<PtyManager>, id: String) {
    // Resolve the session name *before* removing our handle (adopted raw
    // sessions store a non-default name).
    let session_name = resolved_session_name(&state, &id);
    state.sessions.lock().unwrap().remove(&id);
    let _ = std::process::Command::new("tmux")
        .args(["kill-session", "-t", &session_name])
        .status();
}

/// List files under `dir` for the `⌘P` file picker (idea #15), relative to
/// `dir`. Prefers `git ls-files` (fast, respects .gitignore, tracked + untracked
/// non-ignored) when inside a repo; falls back to a shallow `find` otherwise.
/// Capped so a huge tree can't flood the UI.
#[tauri::command]
pub fn list_files(dir: String) -> Vec<String> {
    if let Ok(o) = std::process::Command::new("git")
        .args([
            "-C",
            &dir,
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
        ])
        .output()
    {
        if o.status.success() {
            let mut v: Vec<String> = String::from_utf8_lossy(&o.stdout)
                .lines()
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .collect();
            if !v.is_empty() {
                v.truncate(8000);
                return v;
            }
        }
    }
    // Not a git repo (or empty): shallow find, hiding dot-paths.
    if let Ok(o) = std::process::Command::new("find")
        .args([&dir, "-maxdepth", "4", "-type", "f", "-not", "-path", "*/.*"])
        .output()
    {
        if o.status.success() {
            let base = format!("{}/", dir.trim_end_matches('/'));
            return String::from_utf8_lossy(&o.stdout)
                .lines()
                .filter(|s| !s.is_empty())
                .map(|s| s.strip_prefix(&base).unwrap_or(s).to_string())
                .take(8000)
                .collect();
        }
    }
    Vec::new()
}

/// Single-quote a string for `sh -c`, escaping any embedded single quotes.
fn shq(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Write a Seatbelt profile that confines file WRITES to `confine_dir` (+ temp
/// and a few caches) while leaving reads open so node/git/claude keep working
/// (idea #5). Returns the profile path, or None on failure (caller then spawns
/// unsandboxed). This is write-confinement — the safe default that doesn't break
/// tooling; stricter read-confinement could be layered on later.
fn write_sandbox_profile(confine_dir: &str, session_name: &str) -> Option<String> {
    let home = std::env::var("HOME").ok()?;
    let dir = std::path::Path::new(&home).join(".superkitty").join("sandbox");
    std::fs::create_dir_all(&dir).ok()?;
    let safe: String = session_name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    // SBPL string literals must escape backslash and double-quote, else a path
    // containing either yields an invalid profile (and the pane shell fails to
    // start). Reads stay open, so this only guards the write list.
    let esc = |s: &str| s.replace('\\', "\\\\").replace('"', "\\\"");
    let confine = esc(confine_dir);
    let home_e = esc(&home);
    let profile = format!(
        "(version 1)\n\
         (allow default)\n\
         (deny file-write*)\n\
         (allow file-write*\n\
         \x20 (subpath \"{confine}\")\n\
         \x20 (subpath \"/tmp\")\n\
         \x20 (subpath \"/private/tmp\")\n\
         \x20 (subpath \"/private/var\")\n\
         \x20 (subpath \"/dev\")\n\
         \x20 (subpath \"{home_e}/.claude\")\n\
         \x20 (subpath \"{home_e}/.cache\")\n\
         \x20 (subpath \"{home_e}/.config\")\n\
         \x20 (subpath \"{home_e}/Library/Caches\"))\n"
    );
    let path = dir.join(format!("{safe}.sb"));
    std::fs::write(&path, profile).ok()?;
    Some(path.to_string_lossy().to_string())
}

/// Save raw image bytes (a pasted clipboard image, idea #4) to
/// `~/.superkitty/dropped/` and return the absolute path, so the frontend can
/// inject it into a pane exactly like a dropped image file. The filename is
/// unique (nanosecond timestamp) and the extension is sanitized.
#[tauri::command]
pub fn save_image(bytes: Vec<u8>, ext: String) -> Result<String, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let dir = std::path::Path::new(&home).join(".superkitty").join("dropped");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let safe: String = ext.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    let safe = if safe.is_empty() { "png".to_string() } else { safe };
    let path = dir.join(format!("paste-{nanos}.{safe}"));
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

/// Show a native macOS notification (idea #6) via `osascript` — no extra plugin
/// or capability needed (superkitty is macOS-only). Best-effort: failures are
/// ignored so a missing/blocked Notification Center never breaks the app.
#[tauri::command]
pub fn notify(title: String, body: String) {
    // Escape backslashes then double-quotes for the AppleScript string literals.
    let esc = |s: &str| s.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!(
        "display notification \"{}\" with title \"{}\"",
        esc(&body),
        esc(&title)
    );
    let _ = std::process::Command::new("osascript")
        .args(["-e", &script])
        .status();
}

/// List every tmux session known to the server (idea #2). Returns an empty list
/// when no tmux server is running (nothing to attach to yet).
#[tauri::command]
pub fn tmux_list_sessions() -> Vec<TmuxSession> {
    let out = std::process::Command::new("tmux")
        .args([
            "list-sessions",
            "-F",
            // Tab-separated so names with spaces survive (tmux forbids tabs in
            // session names).
            "#{session_name}\t#{session_attached}\t#{session_windows}\t#{session_created}\t#{session_activity}",
        ])
        .output();
    let out = match out {
        Ok(o) if o.status.success() => o,
        // No server running / tmux missing → no sessions.
        _ => return Vec::new(),
    };
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('\t');
            let name = parts.next()?.to_string();
            // session_attached is a client count; treat anything non-zero as
            // attached.
            let attached = parts.next().map(|s| s != "0").unwrap_or(false);
            let windows = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            let created = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            let activity = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            let superkitty = name.starts_with("superkitty-");
            Some(TmuxSession {
                name,
                attached,
                windows,
                created,
                activity,
                superkitty,
            })
        })
        .collect()
}

/// Kill a tmux session by its full name (idea #2): the "kill" button in the
/// session list. Unlike `pty_kill` this takes the raw session name (the sidebar
/// may target a session we never attached to).
#[tauri::command]
pub fn tmux_kill_session(name: String) -> Result<(), String> {
    let status = std::process::Command::new("tmux")
        .args(["kill-session", "-t", &name])
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("tmux kill-session failed for '{name}'"))
    }
}
