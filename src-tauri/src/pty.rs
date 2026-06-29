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
use std::sync::{Arc, Mutex};
use std::thread;

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, State};

/// How a pane is backed. `Raw` is the default for ⌘D: a normal, ephemeral PTY
/// running `$SHELL -l` directly — no tmux, dies when the pane is closed. `Tmux`
/// is opened on demand: the pane is a tmux session that survives a window close
/// (the original "core trick"). The kind decides every lifecycle branch — spawn
/// command, scroll, cwd/foreground lookup, and detach (tmux) vs kill (raw).
#[derive(Clone, Copy, PartialEq, Eq)]
enum PaneKind {
    Raw,
    Tmux,
}

/// A live PTY: its writer (stdin side), the master handle (for resize) and the
/// name of the tmux session it drives.
struct PtyInstance {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    /// The tmux session this PTY is attached to (`Tmux` panes). Usually
    /// `superkitty-<id>`, but can be an adopted external/raw session name
    /// (idea #2). For `Raw` panes this is an unused placeholder.
    session_name: String,
    /// Raw | Tmux — see PaneKind.
    kind: PaneKind,
    /// The spawned child's pid: the login shell for a `Raw` pane (used to query
    /// its cwd/foreground and to SIGHUP it on close, since it has no tmux
    /// session), or the tmux client for a `Tmux` pane.
    child_pid: Option<u32>,
    /// The sink the reader thread streams PTY bytes to. Held behind a swappable
    /// slot so a webview reload/remount (which reuses the same `id` but creates a
    /// brand-new `Channel`) can **rewire** the live reader to the new mount's
    /// channel instead of leaving the fresh xterm with no output ("black pane").
    output: Arc<Mutex<Channel<InvokeResponseBody>>>,
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

/// The kind attached to a bell when it reaches the frontend (idea #6). A bare
/// BEL (`0x07`) carries no metadata, so the Claude Code hook leaves a per-pane
/// marker file *before* ringing; the reader consumes it to tell apart a true
/// turn-end (`stop`), Claude asking for you (`notification`), and an ambiguous
/// native/sub-agent bell (`unknown` — badged only, never an OS notification).
#[derive(Clone, serde::Serialize)]
struct BellPayload {
    kind: &'static str,
}

/// Directory of the per-pane agent-signal markers the Claude hooks touch
/// (idea #6): an empty `<id>.stop` / `<id>.notif` per pane per event.
fn signals_dir() -> Option<std::path::PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(std::path::Path::new(&home).join(".superkitty").join("signals"))
}

/// Wipe leftover signal markers at launch: a marker present before any pane has
/// spawned is by definition stale (a crash left it). Pane ids are reused across
/// restarts, so a stale `<id>.stop` would mis-tag that id's first bell. Called
/// once from `lib.rs` setup.
pub fn clear_stale_signals() {
    if let Some(dir) = signals_dir() {
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for e in entries.flatten() {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
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

/// Whether we hold a live RAW pane for this id (vs tmux / nothing). Used to gate
/// the tmux-only scroll/redraw commands into no-ops for raw panes.
fn is_raw_pane(state: &State<PtyManager>, id: &str) -> bool {
    state
        .sessions
        .lock()
        .unwrap()
        .get(id)
        .map(|i| i.kind == PaneKind::Raw)
        .unwrap_or(false)
}

/// (kind, child pid, master fd) for a pane, if we hold a live PTY for it — the
/// inputs the raw cwd/foreground helpers need without re-locking per field.
fn pane_info(
    state: &State<PtyManager>,
    id: &str,
) -> Option<(PaneKind, Option<u32>, Option<std::os::fd::RawFd>)> {
    state
        .sessions
        .lock()
        .unwrap()
        .get(id)
        .map(|i| (i.kind, i.child_pid, i.master.as_raw_fd()))
}

/// Foreground pid of a raw pane: the foreground process group of the slave (what
/// is actually running — `claude`/`node`/an editor/the shell) via the master fd,
/// falling back to the spawned login shell itself. The basis for the non-tmux
/// cwd/foreground/kill below.
#[cfg(target_os = "macos")]
fn raw_fg_pid(master_fd: Option<std::os::fd::RawFd>, child_pid: Option<u32>) -> Option<i32> {
    if let Some(fd) = master_fd {
        let pg = unsafe { libc::tcgetpgrp(fd) };
        if pg > 0 {
            return Some(pg);
        }
    }
    child_pid.map(|p| p as i32)
}

/// cwd of a raw pane's foreground process — the non-tmux equivalent of tmux's
/// `#{pane_current_path}`. macOS has no /proc, so go through libproc
/// (`proc_pidinfo` + `PROC_PIDVNODEPATHINFO`).
#[cfg(target_os = "macos")]
fn raw_cwd(master_fd: Option<std::os::fd::RawFd>, child_pid: Option<u32>) -> Option<String> {
    let pid = raw_fg_pid(master_fd, child_pid)?;
    unsafe {
        let mut info: libc::proc_vnodepathinfo = std::mem::zeroed();
        let sz = std::mem::size_of::<libc::proc_vnodepathinfo>() as libc::c_int;
        let n = libc::proc_pidinfo(
            pid,
            libc::PROC_PIDVNODEPATHINFO,
            0,
            &mut info as *mut _ as *mut libc::c_void,
            sz,
        );
        if n < sz {
            return None;
        }
        // libc models the MAXPATHLEN char array as nested [[c_char; 32]; 32]
        // (a historical workaround for arrays > 32), so as_ptr() yields a pointer
        // to the inner array — cast it down to a plain C-string pointer.
        let path = std::ffi::CStr::from_ptr(info.pvi_cdir.vip_path.as_ptr() as *const libc::c_char)
            .to_string_lossy()
            .into_owned();
        if path.is_empty() {
            None
        } else {
            Some(path)
        }
    }
}

/// Foreground command name of a raw pane — the non-tmux equivalent of
/// `#{pane_current_command}` (basename of the running executable via
/// `proc_pidpath`). `claude` runs as `node`, so the idea-#13 busy check still
/// sees a non-shell and warns before closing.
#[cfg(target_os = "macos")]
fn raw_foreground(master_fd: Option<std::os::fd::RawFd>, child_pid: Option<u32>) -> Option<String> {
    let pid = raw_fg_pid(master_fd, child_pid)?;
    let mut buf = [0u8; 4096];
    let n =
        unsafe { libc::proc_pidpath(pid, buf.as_mut_ptr() as *mut libc::c_void, buf.len() as u32) };
    if n <= 0 {
        return None;
    }
    let path = String::from_utf8_lossy(&buf[..n as usize]).into_owned();
    let name = path.rsplit('/').next().unwrap_or(&path).to_string();
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

/// Full command line of a raw pane's foreground process (e.g. `claude
/// --dangerously-skip-permissions`), so the frontend can detect a *manually*
/// launched agent and persist its exact, replayable command for restart. `ps` is
/// the robust source: claude rewrites its argv to a clean `claude …`, while
/// `proc_pidpath` only yields the versioned binary path and tmux's
/// `pane_current_command` reports the version string. A plain shell returns
/// `-zsh`/`/bin/zsh …`, which the frontend treats as "no agent".
#[cfg(target_os = "macos")]
fn raw_foreground_cmd(
    master_fd: Option<std::os::fd::RawFd>,
    child_pid: Option<u32>,
) -> Option<String> {
    let pid = raw_fg_pid(master_fd, child_pid)?;
    let out = std::process::Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "command="])
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

/// SIGHUP a raw pane's shell (and its process group) so closing the pane tears
/// down everything running in it — the raw equivalent of tmux `kill-session`.
#[cfg(target_os = "macos")]
fn raw_hangup(child_pid: Option<u32>) {
    if let Some(p) = child_pid {
        let pid = p as i32;
        unsafe {
            // The group first (job-control children), then the leader itself.
            libc::killpg(pid, libc::SIGHUP);
            libc::kill(pid, libc::SIGHUP);
        }
    }
}

/// Force a raw pane's foreground program to repaint — the non-tmux equivalent of
/// `refresh-client`. A raw pane has no server-side screen to re-request, so we
/// instead poke the running TUI: `SIGWINCH` makes `claude` (Ink), `vim`, etc.
/// redraw the whole screen, even when the size hasn't actually changed (no
/// reflow, since we don't resize the PTY). Sent to the foreground process group
/// (`raw_fg_pid` → `tcgetpgrp`), so a plain shell prompt — which ignores
/// SIGWINCH — is a harmless no-op. This is what rescues a raw pane whose first
/// paint was lost/partial at restart, where before nothing ever repainted it.
#[cfg(target_os = "macos")]
fn raw_repaint(master_fd: Option<std::os::fd::RawFd>, child_pid: Option<u32>) {
    if let Some(pgid) = raw_fg_pid(master_fd, child_pid) {
        unsafe {
            libc::killpg(pgid, libc::SIGWINCH);
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn raw_cwd(_: Option<std::os::fd::RawFd>, _: Option<u32>) -> Option<String> {
    None
}
#[cfg(not(target_os = "macos"))]
fn raw_foreground(_: Option<std::os::fd::RawFd>, _: Option<u32>) -> Option<String> {
    None
}
#[cfg(not(target_os = "macos"))]
fn raw_foreground_cmd(_: Option<std::os::fd::RawFd>, _: Option<u32>) -> Option<String> {
    None
}
#[cfg(not(target_os = "macos"))]
fn raw_hangup(_: Option<u32>) {}
#[cfg(not(target_os = "macos"))]
fn raw_repaint(_: Option<std::os::fd::RawFd>, _: Option<u32>) {}

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
    // "raw" (a normal ephemeral PTY, the ⌘D default) or "tmux" (a persistent
    // session, opened on demand). Defaults to "tmux" when omitted so an older
    // frontend / a restored pre-feature pane keeps the original behaviour.
    kind: Option<String>,
    // v2 agent preset: a shell command the freshly-created shell execs straight
    // away, then drops into an interactive login shell when it exits. Running it
    // AS the shell's command (not typed in afterwards) means the pane shows the
    // agent immediately — never a prompt with `claude` being typed into it.
    initial_command: Option<String>,
    // High-throughput sink for PTY output bytes. A Tauri Channel (not a global
    // event) so chunks ride a raw binary IPC body instead of being serialized to
    // a JSON number array — the latter ~4×-expands every read and, under a flood
    // of output (several Claude sub-agents at once), pins the webview's main
    // thread and freezes the UI. Each mount creates its own channel, so a stale
    // reader thread can never deliver into a torn-down pane's handler.
    on_output: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    // If a PTY for this id already exists, don't spawn a second one. Instead
    // **rewire** its live reader thread to THIS mount's output channel: a webview
    // reload (Vite HMR) or remount keeps the backend — and the old PtyInstance —
    // alive (a page reload skips React cleanup, so pty_detach never ran), but the
    // new xterm created a brand-new Channel. Without rewiring, the reader keeps
    // streaming to the dead old channel and the fresh pane gets zero bytes → a
    // black screen that no redraw can cure. After swapping, the frontend's
    // pty_redraw makes tmux re-send the screen and the pane repaints. (This also
    // subsumes the old "avoid double spawns from React effect re-runs" guard.)
    {
        let sessions = state.sessions.lock().unwrap();
        if let Some(inst) = sessions.get(&id) {
            *inst.output.lock().unwrap() = on_output;
            return Ok(());
        }
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
    let pane_kind = match kind.as_deref() {
        Some("raw") => PaneKind::Raw,
        _ => PaneKind::Tmux,
    };

    // The dir a freshly-created session/shell starts in (its cwd, or $HOME). Also
    // the sandbox write-confinement root when sandboxed (idea #5: the project dir,
    // or $HOME as a weak fallback when no cwd is known).
    let confine_dir = cwd
        .clone()
        .unwrap_or_else(|| std::env::var("HOME").unwrap_or_else(|_| "/".to_string()));
    // A fresh login shell (`$SHELL -l`) so a new pane reloads PATH/aliases/.zshrc
    // instead of inheriting a frozen env (idea #7).
    let login_shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    // v2 agent preset (e.g. `claude`): the shell execs it FIRST and only drops to
    // an interactive login shell once it exits — `exec` chained after so the pane
    // stays usable. Built as `<cmd>; exec $SHELL -l`, passed to the shell via `-c`,
    // so the agent appears immediately with no prompt/typed command flashing by.
    // None (or whitespace-only) → the plain login shell.
    let run = initial_command
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let run_payload = run.map(|rc| format!("{rc}; exec {} -l", shq(&login_shell)));

    let cmd = if pane_kind == PaneKind::Raw {
        // RAW pane (the ⌘D default): run the login shell directly under the PTY —
        // no tmux, no server-side persistence. Closing the pane SIGHUPs the shell.
        // $SUPERKITTY/TERM go straight via cmd.env: the child IS the shell (not a
        // fork of the shared tmux server daemon), so there is no env-leak concern
        // — the reason the tmux path has to bake them into the pane command. When
        // sandboxed (idea #5), the shell — and so `claude` under it — is wrapped
        // in `sandbox-exec`.
        // `$SHELL -l [-c "<cmd>; exec $SHELL -l"]`. The inner `exec` (when a preset
        // is set) stays inside the same sandbox, so no double sandbox-exec wrap.
        let add_run = |c: &mut CommandBuilder| {
            if let Some(payload) = &run_payload {
                // -i so .zshrc (PATH/aliases) is sourced too — the agent then
                // resolves exactly as in the interactive shell the user runs it in,
                // not just from the login files (-l).
                c.arg("-i");
                c.arg("-c");
                c.arg(payload);
            }
        };
        let mut c = if sandbox.unwrap_or(false) {
            match write_sandbox_profile(&confine_dir, &session_name) {
                Some(p) => {
                    let mut c = CommandBuilder::new("sandbox-exec");
                    c.arg("-f");
                    c.arg(&p);
                    c.arg(&login_shell);
                    c.arg("-l");
                    add_run(&mut c);
                    c
                }
                None => {
                    let mut c = CommandBuilder::new(&login_shell);
                    c.arg("-l");
                    add_run(&mut c);
                    c
                }
            }
        } else {
            let mut c = CommandBuilder::new(&login_shell);
            c.arg("-l");
            add_run(&mut c);
            c
        };
        c.env("TERM", "xterm-256color");
        c.env("SUPERKITTY", "1");
        // Identifies this pane to the agent-done hook (idea #6): the hook touches
        // `~/.superkitty/signals/$SUPERKITTY_PANE.{stop,notif}` so the reader can
        // tag the bell. Raw child IS the shell, so cmd.env reaches it directly.
        c.env("SUPERKITTY_PANE", &id);
        // Start in the inherited folder (idea #18), or $HOME — never the app
        // process's own launch dir.
        c.cwd(&confine_dir);
        c
    } else {
        // TMUX pane (opened on demand): the original attach-or-create path that
        // survives a window close. Best-effort: raise the scrollback so copy-mode
        // has room. Each pane is a single-window session, so a `history-limit`
        // chained *after* new-session would never apply to it — it has to be the
        // server default *before* the pane is created. Harmless when no server is
        // running yet (the very first session then boots with tmux's default
        // 2000); every session created afterwards inherits the larger limit.
        let _ = std::process::Command::new("tmux")
            .args(["set-option", "-g", "history-limit", "50000"])
            .status();

        let mut cmd = CommandBuilder::new("tmux");
        // -A: attach if the session exists, otherwise create it.
        // -D: detach any other client already attached, so a single UI owns it.
        cmd.args(["new-session", "-A", "-D", "-s", &session_name]);
        cmd.env("TERM", "xterm-256color");
        // Start a *newly created* session in `cwd` (the source pane's directory)
        // so ⌘D / ⌘T inherit the current folder instead of $HOME. `-c` is ignored
        // by tmux when -A re-attaches an existing session, which is exactly what
        // we want. Also set the spawned client's cwd as a fallback for the very
        // first session (before any tmux server exists).
        if let Some(dir) = &cwd {
            cmd.arg("-c");
            cmd.arg(dir);
            cmd.cwd(dir);
        }
        // The login shell runs only on a *newly created* session; tmux ignores
        // this command when `-A` re-attaches, so reopening keeps the prior live
        // state — the create-vs-reattach split. Passed as ONE positional string
        // so tmux runs it via `sh -c` (no getopt confusion over `-l`); `exec`
        // replaces that sh with the login shell. `export SUPERKITTY=1` marks this
        // pane's whole child tree (shell → `claude` → its hooks) as inside
        // superkitty. It MUST be set HERE, in the pane command — NOT via cmd.env:
        // tmux forks the pane from the *server* daemon, so a client-side env var
        // would either leak to every session or never reach the pane. The
        // agent-done Claude hook (#6, opt-in) gates on `$SUPERKITTY`.
        // Trailing exec for the pane's shell command. With a v2 preset the shell
        // execs the agent first (`-lc "<cmd>; exec $SHELL -l"`, payload built
        // above), then drops to an interactive login shell when it exits; without,
        // a plain login shell. The agent therefore appears immediately — never a
        // prompt with the command typed into it. Only ever runs on a *newly
        // created* session (tmux ignores this command on an `-A` re-attach).
        let exec_with = |prefix: &str| match &run_payload {
            // -lic: login + interactive (so .zshrc / PATH / aliases load) + command.
            Some(payload) => format!("exec {prefix} -lic {}", shq(payload)),
            None => format!("exec {prefix} -l"),
        };
        // `SUPERKITTY_PANE=<id>` rides alongside `SUPERKITTY` (idea #6): both must
        // be baked into the pane command, NOT cmd.env — tmux forks panes from the
        // server daemon. It marks the pane for the agent-done hook's marker files.
        let plain = format!(
            "export SUPERKITTY=1 SUPERKITTY_PANE={}; {}",
            shq(&id),
            exec_with(&shq(&login_shell))
        );
        let shell_cmd = if sandbox.unwrap_or(false) {
            match write_sandbox_profile(&confine_dir, &session_name) {
                Some(p) => format!(
                    "export SUPERKITTY=1 SUPERKITTY_PANE={}; {}",
                    shq(&id),
                    exec_with(&format!("sandbox-exec -f {} {}", shq(&p), shq(&login_shell)))
                ),
                None => plain,
            }
        } else {
            plain
        };
        cmd.arg(shell_cmd);
        // Enable the mouse for THIS session only (scoped — never touches the
        // user's own tmux sessions on the same server). Without it, tmux runs in
        // the alternate screen with no mouse tracking, so xterm.js translates
        // trackpad scrolling into arrow keys — which recalls the previous
        // shell/Claude prompt. With mouse on, the wheel enters tmux copy-mode and
        // scrolls the real scrollback. The `;` is a tmux command separator (its
        // own arg) so the chained set-option runs after the session is
        // created/attached; idempotent across `-A` re-attaches.
        cmd.args([
            ";", "set-option", "mouse", "on",
            // Bell de fin d'agent (#6) : forcer le triplet qui achemine le BEL
            // 0x07 brut jusqu'au client (notre master PTY), quelle que soit la
            // config tmux de la machine. Scopé session (visual-bell/bell-action) +
            // fenêtre courante (monitor-bell, -w) — jamais -g, donc ne touche pas
            // les sessions perso.
            // visual-bell off : tmux passe le 0x07 (sinon message de statut).
            // bell-action any  : émis même quand le pane est la fenêtre courante.
            // monitor-bell on  : sinon alerts_check_bell() sort tôt, rien n'est émis.
            ";", "set-option", "visual-bell", "off",
            ";", "set-option", "bell-action", "any",
            ";", "set-option", "-w", "monitor-bell", "on",
        ]);

        // Drop any leftover copy-mode on (re)attach. copy-mode is per-pane
        // SERVER-side state that PERSISTS across detach/reattach; if the app is
        // closed while a pane is scrolled up, reopening reattaches it STILL in
        // copy-mode — frozen on a (often blank → black) scrollback region with
        // keystrokes eaten by copy-mode. `-X cancel` returns to the live bottom.
        // A SEPARATE best-effort call (not chained into new-session): on a live
        // pane it errors with "not in a mode" (harmless to this child's discarded
        // stderr). A brand-new session isn't in copy-mode, so it's a no-op then.
        let _ = std::process::Command::new("tmux")
            .args(["send-keys", "-t", &session_name, "-X", "cancel"])
            .output();

        cmd
    };

    // Prepare this pane's agent-signal mailbox (idea #6) BEFORE the shell (and so
    // `claude` + its hooks) starts: ensure the 0700 dir exists and clear any stale
    // `<id>.{stop,notif}` a reused id from a prior run might have left, which would
    // otherwise mis-tag this pane's first bell.
    if let Some(dir) = signals_dir() {
        let _ = std::fs::create_dir_all(&dir);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
        }
        let _ = std::fs::remove_file(dir.join(format!("{id}.stop")));
        let _ = std::fs::remove_file(dir.join(format!("{id}.notif")));
    }

    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    // Capture the child pid before the reader thread takes ownership of `child`:
    // a RAW pane has no tmux session, so its cwd/foreground lookups and its
    // close-time SIGHUP all work off this pid.
    let child_pid = child.process_id();
    // Slave handle is owned by the child now; dropping our copy lets EOF
    // propagate correctly when the child exits.
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    // Swappable sink: the reader thread sends through whatever channel this slot
    // currently holds, so a later remount can rewire it (see the early return).
    let output = Arc::new(Mutex::new(on_output));
    let output_for_thread = Arc::clone(&output);

    state.sessions.lock().unwrap().insert(
        id.clone(),
        PtyInstance {
            writer,
            master: pair.master,
            session_name,
            kind: pane_kind,
            child_pid,
            output,
        },
    );

    // Reader thread: stream raw bytes to the frontend as they arrive.
    let app_for_thread = app.clone();
    let id_for_thread = id.clone();
    // Marker paths for this pane's bell, resolved once (idea #6). On a real BEL
    // the reader consumes whichever the Claude hook just touched to learn the
    // bell's kind; `.notif` (Claude needs you) wins over `.stop` (turn end).
    let notif_marker = signals_dir().map(|d| d.join(format!("{id_for_thread}.notif")));
    let stop_marker = signals_dir().map(|d| d.join(format!("{id_for_thread}.stop")));
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        // BEL-detection state, persisted across reads: a single OSC sequence
        // (ESC ] … BEL/ST) can straddle two 8 KiB chunks, so we can't decide
        // per-chunk. `in_osc` = inside an ESC ] … awaiting its terminator;
        // `prev_esc` = previous byte was ESC (to spot `ESC ]` and the ST `ESC \`).
        let mut in_osc = false;
        let mut prev_esc = false;
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = &buf[..n];
                    // Raw binary body: Tauri ships chunks >= 1 KiB straight through
                    // the fetch IPC channel (octet-stream, no JSON) — exactly the
                    // large reads a flood produces. Bell/exit below stay on global
                    // events: rare and tiny, so their JSON cost is negligible.
                    // Lock the swappable sink each chunk so a remount's rewire takes
                    // effect immediately; the lock is uncontended outside that swap.
                    if let Ok(ch) = output_for_thread.lock() {
                        let _ = ch.send(InvokeResponseBody::Raw(chunk.to_vec()));
                    }
                    // A *bare* terminal bell (BEL, 0x07) is how Claude Code signals
                    // it finished / awaits input (#6). But 0x07 ALSO terminates an
                    // OSC string (ESC ] … BEL) — how shells (oh-my-zsh/p10k/starship)
                    // and claude set the window title/cwd — so a naive contains(0x07)
                    // fired a *false* bell on every fresh prompt (e.g. a brand-new
                    // pane lit the agent-done trail). Walk the bytes with the tiny
                    // state machine above and only flag a BEL that is NOT an OSC
                    // terminator. Robust to either OSC terminator (BEL or ST `ESC \`)
                    // and to a sequence split across two reads.
                    let mut real_bell = false;
                    for &b in chunk {
                        if prev_esc {
                            prev_esc = false;
                            if b == 0x5d {
                                in_osc = true; // ESC ] : enter OSC
                            } else if b == 0x5c && in_osc {
                                in_osc = false; // ESC \ (ST) : end of OSC
                            }
                        } else if b == 0x1b {
                            prev_esc = true; // ESC : maybe starts/ends a sequence
                        } else if b == 0x07 {
                            if in_osc {
                                in_osc = false; // BEL terminates the OSC — not a real bell
                            } else {
                                real_bell = true; // bare BEL — the agent-done signal
                            }
                        }
                    }
                    if real_bell {
                        // Attach a kind by consuming the marker the Claude hook
                        // touched just before ringing (idea #6). The hook writes
                        // its marker, THEN rings — so by the time this bell is read
                        // the marker is already on disk. No marker → an ambiguous
                        // native/sub-agent bell the frontend must NOT escalate to a
                        // cue (the whole point: kills the false "agent terminé").
                        let kind = if notif_marker.as_ref().is_some_and(|p| p.exists()) {
                            if let Some(p) = &notif_marker {
                                let _ = std::fs::remove_file(p);
                            }
                            "notification"
                        } else if stop_marker.as_ref().is_some_and(|p| p.exists()) {
                            if let Some(p) = &stop_marker {
                                let _ = std::fs::remove_file(p);
                            }
                            "stop"
                        } else {
                            "unknown"
                        };
                        let _ = app_for_thread.emit(
                            &format!("pty://bell/{id_for_thread}"),
                            BellPayload { kind },
                        );
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

/// Force tmux to fully repaint the client driving this session. After a pane
/// grows (window/pane close → layout rebalance → SIGWINCH via master.resize),
/// tmux's redraw to the xterm client can land partial/lost, leaving a blank
/// strip where content was — until a full redraw (which scrolling into
/// copy-mode triggers) repaints it. We reproduce that full redraw explicitly:
/// find the single client attached to the session (-D guarantees one) and
/// `refresh-client` it WITHOUT -S (a -S refresh would only redraw the status
/// line). Best-effort: failures are ignored (session gone / tmux busy).
///
/// Returns `true` only when at least one client was actually found and
/// refreshed. The frontend uses this to retry on attach: `pty_spawn` returns
/// *before* the `tmux new-session -A` subprocess has connected its client, so an
/// early redraw finds no client (returns `false`) and is retried until one is
/// attached — otherwise the pane can stay permanently blank ("black screen").
#[tauri::command]
pub fn pty_redraw(state: State<PtyManager>, id: String) -> bool {
    // Raw panes have no tmux client to refresh — but xterm owning the screen
    // doesn't help when the foreground TUI's first paint was lost (the pane stays
    // black). Poke the program with SIGWINCH so it redraws itself, the non-tmux
    // equivalent of `refresh-client`. Returns true (the foreground pid is always
    // available), so the frontend's redraw schedule treats it as "done".
    if let Some((PaneKind::Raw, pid, fd)) = pane_info(&state, &id) {
        raw_repaint(fd, pid);
        return true;
    }
    let session_name = resolved_session_name(&state, &id);
    let Ok(out) = std::process::Command::new("tmux")
        .args(["list-clients", "-t", &session_name, "-F", "#{client_name}"])
        .output()
    else {
        return false;
    };
    if !out.status.success() {
        return false;
    }
    let mut refreshed = false;
    for client in String::from_utf8_lossy(&out.stdout).lines() {
        let client = client.trim();
        if client.is_empty() {
            continue;
        }
        let _ = std::process::Command::new("tmux")
            .args(["refresh-client", "-t", client])
            .status();
        refreshed = true;
    }
    refreshed
}

/// Report the current working directory of a session's active pane, so a new
/// pane/tab can be spawned in the same folder (idea #18). Returns `None` if the
/// session doesn't exist yet or tmux can't answer — the caller then falls back
/// to the default ($HOME).
#[tauri::command]
pub fn pty_cwd(state: State<PtyManager>, id: String) -> Option<String> {
    // Raw pane: no tmux to ask — read the foreground process's cwd via libproc.
    if let Some((PaneKind::Raw, pid, fd)) = pane_info(&state, &id) {
        return raw_cwd(fd, pid);
    }
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
    // Raw pane: resolve the foreground command via libproc (claude → "node", so
    // the idea-#13 busy check still fires).
    if let Some((PaneKind::Raw, pid, fd)) = pane_info(&state, &id) {
        return raw_foreground(fd, pid);
    }
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

/// Full command line of a RAW pane's foreground process (e.g. `claude
/// --dangerously-skip-permissions`). The frontend polls this to detect a
/// manually-launched agent and keep its replayable command + cwd in sync, so a
/// restart re-launches the agent even when it wasn't started via a rail preset.
/// Raw-only: tmux panes persist through tmux, so this returns `None` for them.
#[tauri::command]
pub fn pty_foreground_cmd(state: State<PtyManager>, id: String) -> Option<String> {
    if let Some((PaneKind::Raw, pid, fd)) = pane_info(&state, &id) {
        return raw_foreground_cmd(fd, pid);
    }
    None
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
    // Raw panes scroll through xterm's own buffer, not tmux copy-mode.
    if is_raw_pane(&state, &id) {
        return None;
    }
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
    if is_raw_pane(&state, &id) {
        return;
    }
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
    if is_raw_pane(&state, &id) {
        return;
    }
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
    // A raw pane has no tmux session to park: "detach" means terminate its shell
    // (closing the pane = the terminal is gone). A tmux pane detaches its client
    // so the session — and any running agent — keeps living server-side.
    enum Detach {
        Tmux(String),
        Raw(Option<u32>),
    }
    let what = {
        let mut sessions = state.sessions.lock().unwrap();
        let inst = match sessions.remove(&id) {
            Some(i) => i,
            None => return,
        };
        match inst.kind {
            PaneKind::Raw => Detach::Raw(inst.child_pid),
            PaneKind::Tmux => {
                if let Some(fd) = inst.master.as_raw_fd() {
                    // Disable VEOF on the master so dropping the writer can't emit
                    // Ctrl-D into the still-attached client (which would kill the
                    // session).
                    unsafe {
                        let mut t: libc::termios = std::mem::zeroed();
                        if libc::tcgetattr(fd, &mut t) == 0 {
                            t.c_cc[libc::VEOF] = 0;
                            let _ = libc::tcsetattr(fd, libc::TCSANOW, &t);
                        }
                    }
                }
                Detach::Tmux(inst.session_name.clone())
            }
        }
        // `inst` (master + writer) is dropped here — writer drop is now a no-op.
    };
    match what {
        // Hang up the tmux client cleanly so the reader thread gets EOF and exits.
        Detach::Tmux(name) => {
            let _ = std::process::Command::new("tmux")
                .args(["detach-client", "-s", &name])
                .status();
        }
        // SIGHUP the raw shell + its group; the reader thread then sees EOF.
        Detach::Raw(pid) => raw_hangup(pid),
    }
}

/// Permanently close a session: drop our handle AND kill the tmux session.
/// This is the path when the user deliberately closes a pane/tab (⌘W) — they
/// want that terminal gone, not parked.
#[tauri::command]
pub fn pty_kill(state: State<PtyManager>, id: String) {
    // Raw → SIGHUP the shell; tmux → kill-session. Read the kind off our live
    // handle (adopted raw sessions store a non-default name); when we hold no
    // handle, fall back to killing the default tmux session for this id (the old
    // behaviour — harmless if it doesn't exist).
    enum Kill {
        Tmux(String),
        Raw(Option<u32>),
    }
    let what = {
        let mut sessions = state.sessions.lock().unwrap();
        match sessions.remove(&id) {
            Some(inst) => match inst.kind {
                PaneKind::Raw => Kill::Raw(inst.child_pid),
                PaneKind::Tmux => Kill::Tmux(inst.session_name),
            },
            None => Kill::Tmux(tmux_session_name(&id)),
        }
    };
    match what {
        Kill::Tmux(name) => {
            let _ = std::process::Command::new("tmux")
                .args(["kill-session", "-t", &name])
                .status();
        }
        Kill::Raw(pid) => raw_hangup(pid),
    }
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

/// Project context shown in the Warp-style status bar: the runtime version
/// (`node --version`), the git branch, and the working-tree diff stats. Every
/// field is best-effort — a missing tool or a non-repo cwd yields `None`/0 and
/// the matching segment is simply hidden in the UI (never an error).
#[derive(serde::Serialize)]
pub struct PaneContext {
    node: Option<String>,
    branch: Option<String>,
    files: u32,
    insertions: u32,
    deletions: u32,
}

/// Run a short command in `cwd` and return its trimmed stdout, or `None` on a
/// spawn error / non-zero exit / empty output. PATH is the spawned process's —
/// in `tauri dev` it inherits the launching shell (nvm/Homebrew node resolve);
/// a Finder-launched bundle has a minimal PATH, so `node` may be absent there
/// (the segment then hides), same caveat as tmux.
fn run_in(cwd: &str, cmd: &str, args: &[&str]) -> Option<String> {
    let o = std::process::Command::new(cmd)
        .args(args)
        .current_dir(cwd)
        .output()
        .ok()?;
    if !o.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

/// Parse the leading integer out of a `git diff --shortstat` fragment such as
/// `5271 insertions(+)` → 5271.
fn lead_u32(frag: &str) -> u32 {
    frag.trim()
        .split_whitespace()
        .next()
        .and_then(|n| n.parse().ok())
        .unwrap_or(0)
}

/// Resolve the project context for a pane (status bar). Reuses `pty_cwd` to find
/// the folder, then probes node + git in it. All probes are best-effort.
#[tauri::command]
pub fn pane_context(state: State<PtyManager>, id: String) -> PaneContext {
    let cwd = pty_cwd(state, id);
    let mut ctx = PaneContext {
        node: None,
        branch: None,
        files: 0,
        insertions: 0,
        deletions: 0,
    };
    let cwd = match cwd {
        Some(c) => c,
        None => return ctx,
    };
    ctx.node = run_in(&cwd, "node", &["--version"]);
    // Branch (or short SHA when HEAD is detached). A non-repo cwd fails here and
    // leaves branch=None, files/ins/del=0.
    match run_in(&cwd, "git", &["rev-parse", "--abbrev-ref", "HEAD"]) {
        Some(b) if b == "HEAD" => {
            ctx.branch = run_in(&cwd, "git", &["rev-parse", "--short", "HEAD"]);
        }
        Some(b) => ctx.branch = Some(b),
        None => return ctx,
    }
    // Changed-file count includes untracked (porcelain); +/- are tracked-only
    // (diff vs HEAD), matching how Warp shows "N • +ins -del".
    if let Some(st) = run_in(&cwd, "git", &["status", "--porcelain"]) {
        ctx.files = st.lines().filter(|l| !l.is_empty()).count() as u32;
    }
    if let Some(ss) = run_in(&cwd, "git", &["diff", "--shortstat", "HEAD"]) {
        for part in ss.split(',') {
            if part.contains("insertion") {
                ctx.insertions = lead_u32(part);
            } else if part.contains("deletion") {
                ctx.deletions = lead_u32(part);
            }
        }
    }
    ctx
}

/// List sub-directories under `dir` (relative to it) for the `cd` suggestions in
/// the command launcher (⌘L). Shallow `find`, dot-paths and node_modules hidden,
/// capped like `list_files`.
#[tauri::command]
pub fn list_dirs(dir: String) -> Vec<String> {
    if let Ok(o) = std::process::Command::new("find")
        .args([
            &dir,
            "-maxdepth",
            "4",
            "-type",
            "d",
            "-not",
            "-path",
            "*/.*",
            "-not",
            "-path",
            "*/node_modules/*",
        ])
        .output()
    {
        if o.status.success() {
            let base = format!("{}/", dir.trim_end_matches('/'));
            let mut v: Vec<String> = String::from_utf8_lossy(&o.stdout)
                .lines()
                .filter_map(|s| s.strip_prefix(&base))
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .collect();
            v.truncate(8000);
            return v;
        }
    }
    Vec::new()
}

/// Recent shell history for the command launcher (⌘L), most-recent first and
/// de-duplicated. Reads `$HISTFILE` (fallback `~/.zsh_history`, then
/// `~/.bash_history`), stripping zsh's `: <ts>:<n>;` extended-history prefix.
/// Best-effort: the running shell may not have flushed its in-memory history,
/// so the very last commands can be missing.
#[tauri::command]
pub fn shell_history(limit: usize) -> Vec<String> {
    let home = match std::env::var("HOME") {
        Ok(h) => h,
        Err(_) => return Vec::new(),
    };
    let candidates = [
        std::env::var("HISTFILE").ok(),
        Some(format!("{home}/.zsh_history")),
        Some(format!("{home}/.bash_history")),
    ];
    let path = candidates
        .into_iter()
        .flatten()
        .find(|c| std::path::Path::new(c).exists());
    let path = match path {
        Some(p) => p,
        None => return Vec::new(),
    };
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(_) => return Vec::new(),
    };
    let text = String::from_utf8_lossy(&bytes);
    let mut seen = std::collections::HashSet::new();
    let mut out: Vec<String> = Vec::new();
    for line in text.lines().rev() {
        let l = line.trim_end_matches('\\').trim();
        // zsh extended: ": 1700000000:0;git status" → keep after the first ';'.
        let cmd = if l.starts_with(": ") {
            match l.find(';') {
                Some(i) => l[i + 1..].trim(),
                None => l,
            }
        } else {
            l
        };
        if cmd.is_empty() {
            continue;
        }
        if seen.insert(cmd.to_string()) {
            out.push(cmd.to_string());
            if out.len() >= limit {
                break;
            }
        }
    }
    out
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

/// Read file paths off the macOS clipboard (idea #4). When a file or folder is
/// copied in Finder (⌘C), the pasteboard carries the real file URLs — but the
/// webview only exposes an *icon/image preview* of it, so a plain ⌘V would wrongly
/// save that preview as an image (and even folders/non-image files would show up
/// as "[Image]"). This reads the actual paths straight from `NSPasteboard` and
/// returns them, so the frontend can inject the real paths instead — letting
/// `claude` decide per file whether it's an image (`[Image #N]`) or a plain path.
/// Returns an empty list for a clipboard with no files (e.g. a copied screenshot),
/// letting the image-bytes path take over.
///
/// Reading is done **natively** via objc2 (in-process Cocoa), not by spawning
/// `osascript`: the previous JXA approach failed silently inside the bundled app
/// (any subprocess/permission hiccup fell through to an empty list), which made
/// *every* paste look like a screenshot. Native NSPasteboard access is reliable,
/// has no PATH/permission dependency, and is far faster.
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn clipboard_file_paths() -> Vec<String> {
    use objc2_app_kit::NSPasteboard;
    use objc2_foundation::{NSArray, NSString, NSURL};

    // Parse a `file://` URL string into a POSIX path and add it (deduped — a
    // multi-file copy can expose the same path under several representations).
    fn push_file_url(out: &mut Vec<String>, s: &NSString) {
        let Some(url) = NSURL::URLWithString(s) else {
            return;
        };
        if !url.isFileURL() {
            return;
        }
        // Finder writes file-reference URLs (file:///.file/id=…); NSURL.path only
        // half-resolves the node id (→ "/Users"). filePathURL turns the reference
        // into a real path URL whose `path` is the true POSIX path.
        let resolved = url.filePathURL().unwrap_or(url);
        if let Some(path) = resolved.path() {
            let p = path.to_string();
            if !p.is_empty() && !out.contains(&p) {
                out.push(p);
            }
        }
    }

    let mut out: Vec<String> = Vec::new();
    let pb = NSPasteboard::generalPasteboard();
    let furl = NSString::from_str("public.file-url");

    // 1) Modern read — the one that actually fires for Finder. A real ⌘C in
    //    Finder writes each selected item as a `public.file-url`
    //    (NSPasteboardTypeFileURL); the legacy NSFilenamesPboardType below is no
    //    longer populated on current macOS. Read the file URL off every pasteboard
    //    item (a multi-file copy is one item each).
    if let Some(items) = pb.pasteboardItems() {
        for item in items.iter() {
            if let Some(s) = item.stringForType(&furl) {
                push_file_url(&mut out, &s);
            }
        }
    }

    // 2) Fallback — legacy NSFilenamesPboardType: an array of POSIX paths. This is
    //    what AppleScript (`set the clipboard to (POSIX file …)`) writes, so keep
    //    it for non-Finder sources.
    if out.is_empty() {
        let ty = NSString::from_str("NSFilenamesPboardType");
        if let Some(obj) = pb.propertyListForType(&ty) {
            if let Ok(arr) = obj.downcast::<NSArray>() {
                for item in arr.iter() {
                    if let Ok(s) = item.downcast::<NSString>() {
                        let p = s.to_string();
                        if !p.is_empty() && !out.contains(&p) {
                            out.push(p);
                        }
                    }
                }
            }
        }
    }

    // 3) Last-ditch: a single top-level `public.file-url` (some sources set only
    //    this, on the pasteboard rather than a per-item representation).
    if out.is_empty() {
        if let Some(s) = pb.stringForType(&furl) {
            push_file_url(&mut out, &s);
        }
    }

    out
}

/// Non-macOS stub (superkitty is macOS-only, but keeps the crate buildable).
#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn clipboard_file_paths() -> Vec<String> {
    Vec::new()
}

// ---- Agent-done Claude Code hook (idea #6, the reliable, *semantic* signal) ----
//
// The native `claude` bell is fragile AND ambiguous: it also rings mid-work (a
// sub-agent finishing, etc.), which produced false "agent terminé" notifications.
// So we install per-event hooks that, gated on `$SUPERKITTY`, leave a per-pane
// MARKER file *before* ringing the BEL: `Stop` → `<pane>.stop` (turn really
// ended), `Notification` → `<pane>.notif` (Claude needs you). The marker rides
// the filesystem; the BEL is just the doorbell that travels pts → [tmux] → master
// → reader (proven transport, tmux bell options forced in `pty_spawn`). The reader
// consumes the marker to tag the bell (BellPayload.kind); a bell with NO marker is
// `unknown` → badge-only, never an OS cue. `SubagentStop` is deliberately NOT
// installed, so a sub-agent finishing never signals. Empty files only — no `cwd`/
// `session_id`/`transcript_path` ever hits disk.
//
// Robustness: `; true` forces exit 0 so the hook is a silent no-op in plain
// kitty/iTerm (where `$SUPERKITTY` is empty) instead of surfacing a non-zero
// "error". The trailing `# superkitty-bell` comment is our idempotence/uninstall
// sentinel. The `~/.superkitty/signals` dir is pre-created (0700) per pane in
// `pty_spawn`, so the hook needs no `mkdir`.

const HOOK_COMMAND_STOP: &str =
    "[ -n \"$SUPERKITTY\" ] && { : > \"$HOME/.superkitty/signals/$SUPERKITTY_PANE.stop\"; printf '\\a' > /dev/tty 2>/dev/null; } ; true # superkitty-bell";
const HOOK_COMMAND_NOTIF: &str =
    "[ -n \"$SUPERKITTY\" ] && { : > \"$HOME/.superkitty/signals/$SUPERKITTY_PANE.notif\"; printf '\\a' > /dev/tty 2>/dev/null; } ; true # superkitty-bell";
const HOOK_SENTINEL: &str = "superkitty-bell";

fn claude_settings_path() -> Option<std::path::PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(std::path::Path::new(&home).join(".claude").join("settings.json"))
}

/// True if a hook group already carries our sentinel (so we never double-add).
fn group_has_sentinel(group: &serde_json::Value) -> bool {
    group
        .get("hooks")
        .and_then(|h| h.as_array())
        .map(|hooks| {
            hooks.iter().any(|hk| {
                hk.get("command")
                    .and_then(|c| c.as_str())
                    .map(|s| s.contains(HOOK_SENTINEL))
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

/// Read ~/.claude/settings.json as a JSON object, preserving every unknown key.
/// Missing/empty file → `{}`. A malformed file is an error (never clobbered).
fn read_claude_settings(path: &std::path::Path) -> Result<serde_json::Value, String> {
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    let txt = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    if txt.trim().is_empty() {
        return Ok(serde_json::json!({}));
    }
    let v: serde_json::Value =
        serde_json::from_str(&txt).map_err(|e| format!("~/.claude/settings.json invalide: {e}"))?;
    if !v.is_object() {
        return Err("~/.claude/settings.json n'est pas un objet JSON".into());
    }
    Ok(v)
}

fn write_claude_settings(path: &std::path::Path, root: &serde_json::Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let out = serde_json::to_string_pretty(root).map_err(|e| e.to_string())?;
    std::fs::write(path, out).map_err(|e| e.to_string())
}

/// Install our semantic agent-done hooks: the `.stop` marker command under
/// `Stop`, the `.notif` one under `Notification` (idempotent, append-only, the
/// user's own hooks untouched). Any prior superkitty group (e.g. the legacy bare-
/// BEL command) is replaced, so an upgrade never leaves a stale hook. Returns an
/// error string the UI can surface (#6).
#[tauri::command]
pub fn install_claude_hooks() -> Result<(), String> {
    let path = claude_settings_path().ok_or("HOME introuvable")?;
    let mut root = read_claude_settings(&path)?;
    // Snapshot to skip the write when nothing actually changes: this runs on
    // EVERY launch (reconcile), and rewriting would needlessly reformat/reorder
    // the user's settings.json (serde_json sorts keys), churning their file.
    let before = root.clone();
    let obj = root.as_object_mut().unwrap();
    let hooks = obj
        .entry("hooks")
        .or_insert_with(|| serde_json::json!({}));
    let hooks_obj = hooks.as_object_mut().ok_or("hooks n'est pas un objet")?;
    for (event, command) in [("Stop", HOOK_COMMAND_STOP), ("Notification", HOOK_COMMAND_NOTIF)] {
        let arr = hooks_obj
            .entry(event)
            .or_insert_with(|| serde_json::json!([]));
        let list = arr
            .as_array_mut()
            .ok_or_else(|| format!("hooks.{event} n'est pas un tableau"))?;
        // Drop any prior superkitty group first so we never double-add AND an
        // upgrade from an old command (different string, same sentinel) takes.
        list.retain(|g| !group_has_sentinel(g));
        list.push(serde_json::json!({
            "hooks": [ { "type": "command", "command": command } ]
        }));
    }
    if root == before {
        return Ok(()); // already correct → leave the file untouched
    }
    write_claude_settings(&path, &root)
}

/// Remove our agent-done hook groups (those carrying the sentinel), leaving the
/// user's own hooks untouched. Drops emptied `Stop`/`Notification`/`hooks` keys.
#[tauri::command]
pub fn uninstall_claude_hooks() -> Result<(), String> {
    let path = claude_settings_path().ok_or("HOME introuvable")?;
    if !path.exists() {
        return Ok(());
    }
    let mut root = read_claude_settings(&path)?;
    let before = root.clone();
    let obj = root.as_object_mut().unwrap();
    if let Some(hooks_obj) = obj.get_mut("hooks").and_then(|h| h.as_object_mut()) {
        for event in ["Stop", "Notification"] {
            if let Some(list) = hooks_obj.get_mut(event).and_then(|a| a.as_array_mut()) {
                list.retain(|g| !group_has_sentinel(g));
            }
            let empty = hooks_obj
                .get(event)
                .and_then(|a| a.as_array())
                .map(|a| a.is_empty())
                .unwrap_or(false);
            if empty {
                hooks_obj.remove(event);
            }
        }
        if hooks_obj.is_empty() {
            obj.remove("hooks");
        }
    }
    if root == before {
        return Ok(()); // nothing of ours present → don't touch the file
    }
    write_claude_settings(&path, &root)
}

/// Play a short system sound (idea #6) when an agent finishes. Best-effort:
/// `afplay` is macOS-only and runs detached so it never blocks the UI thread.
/// `name` is a bare macOS system-sound name (e.g. "Glass", "Hero"); we look it
/// up under /System/Library/Sounds and silently no-op if it's missing.
#[tauri::command]
pub fn play_sound(name: String) {
    // Keep it to a known-safe basename so the string can't escape the dir.
    let safe: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect();
    if safe.is_empty() {
        return;
    }
    let path = format!("/System/Library/Sounds/{safe}.aiff");
    if !std::path::Path::new(&path).exists() {
        return;
    }
    let _ = std::process::Command::new("afplay").arg(&path).spawn();
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
