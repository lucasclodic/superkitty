import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import type { ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke, Channel } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";

/**
 * One terminal pane backed by a persistent PTY (see src-tauri/src/pty.rs).
 * The `id` is stable: spawning with the same id re-attaches to the same tmux
 * session, so the running process and scrollback survive both a window close
 * and a layout change that remounts this component.
 */
// Live xterm instances by pane id, so the app can drive a RAW pane's native
// scrollback (raw panes have no tmux copy-mode to scroll through the backend).
// Registered on mount, removed on unmount.
export const paneTerminals = new Map<string, Terminal>();

// Map a kitty scroll action onto xterm's native scrollback — used for RAW panes
// only. Prompt navigation needs OSC 133 marks xterm doesn't track here, so it's
// a no-op for raw.
export function scrollXterm(term: Terminal | undefined, action: string) {
  if (!term) return;
  switch (action) {
    case "line-up":
      term.scrollLines(-1);
      break;
    case "line-down":
      term.scrollLines(1);
      break;
    case "page-up":
      term.scrollPages(-1);
      break;
    case "page-down":
      term.scrollPages(1);
      break;
    case "top":
      term.scrollToTop();
      break;
    case "bottom":
      term.scrollToBottom();
      break;
  }
}

export function TerminalView({
  id,
  active,
  onFocus,
  onBell,
  onInteract,
  onTitle,
  onActivity,
  initialCommand,
  cwd,
  session,
  sandbox,
  kind,
  theme,
  fontFamily,
  fontSize,
}: {
  id: string;
  active: boolean;
  onFocus: () => void;
  // Fired when this pane emits a terminal bell (BEL) — Claude Code rings it when
  // it finishes / awaits input (idea #6). The payload's `kind` tells apart a true
  // turn-end ("stop"), Claude asking for you ("notification") and an ambiguous
  // native/sub-agent bell ("unknown" → badge only). Absent on a legacy emit.
  onBell?: (payload?: { kind?: string }) => void;
  // Fired on real user input in this pane (keystrokes/paste) — used to clear the
  // "agent finished" glow as soon as you interact, not merely on window focus (#6).
  onInteract?: () => void;
  // Fired when the program sets the terminal title (OSC 0/2) — Claude Code sets
  // it to the project/session name, and updates it on `/rename` (v2 rail names).
  onTitle?: (title: string) => void;
  // Fired (throttled) whenever output bytes flow — the v2 rail uses it to show a
  // pane as "en cours" only while it's actually producing output (not just open).
  onActivity?: () => void;
  // A shell command the freshly-spawned shell execs immediately (v2 agent
  // presets: clicking the Claude icon opens a window already running `claude`,
  // with no visible shell prompt / typed command). Baked into pty_spawn. Fresh
  // panes only.
  initialCommand?: string;
  // Directory to start a freshly-created session in (inherited from the source
  // pane on ⌘D/⌘T). Ignored when re-attaching an existing tmux session.
  cwd?: string;
  // Adopt a specific tmux session by name instead of our own `superkitty-<id>`
  // (idea #2: re-attaching an external/raw session from the session sidebar).
  session?: string;
  // Confine the freshly-created shell's writes to its project dir (idea #5).
  sandbox?: boolean;
  // "raw" (a normal ephemeral PTY — closing kills it; scroll via xterm) or "tmux"
  // (a persistent session — closing detaches; scroll via tmux copy-mode). Frozen
  // at mount; a pane never changes kind.
  kind?: "raw" | "tmux";
  // Live theme/font (Settings, idea #3): applied on mount and updated in place
  // whenever they change, without recreating the terminal.
  theme: ITheme;
  fontFamily: string;
  fontSize: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  // Kept so the `active` effect can re-fit on tab switch (see below).
  const fitRef = useRef<FitAddon | null>(null);
  // Captured once: the spawn cwd is only meaningful at the initial mount, and
  // never changes for a given pane id — keep the effect keyed on `id` alone.
  const cwdRef = useRef(cwd);
  // Same: the adopted session name is fixed for a given pane id.
  const sessionRef = useRef(session);
  // Same: sandboxing is decided at creation and fixed for a given pane id.
  const sandboxRef = useRef(sandbox);
  // Same: the pane kind (raw|tmux) is fixed for a given pane id.
  const kindRef = useRef(kind);
  // Latest theme/font so the (id-keyed) mount effect picks up the current
  // Settings; live changes go through the dedicated apply effect below.
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const fontFamilyRef = useRef(fontFamily);
  fontFamilyRef.current = fontFamily;
  const fontSizeRef = useRef(fontSize);
  fontSizeRef.current = fontSize;
  // Latest bell handler, read by the id-keyed mount listener.
  const onBellRef = useRef(onBell);
  onBellRef.current = onBell;
  const onTitleRef = useRef(onTitle);
  onTitleRef.current = onTitle;
  const onActivityRef = useRef(onActivity);
  onActivityRef.current = onActivity;
  // Captured once: the initial command is meaningful only at the first spawn.
  const initialCommandRef = useRef(initialCommand);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      fontFamily: fontFamilyRef.current,
      fontSize: fontSizeRef.current,
      cursorBlink: true,
      allowProposedApi: true,
      theme: themeRef.current,
      // A RAW pane owns its scrollback in xterm (no tmux behind it): give it a
      // real buffer so the wheel and the kitty scroll keys work natively. A TMUX
      // pane keeps 0 — tmux owns the alternate-screen scrollback and xterm renders
      // only the live screen (scroll goes through tmux copy-mode).
      scrollback: kindRef.current === "raw" ? 50000 : 0,
    });
    termRef.current = term;
    paneTerminals.set(id, term);
    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(container);
    fit.fit();

    let disposed = false;
    const unlisteners: Array<() => void> = [];

    // PTY output is batched: rather than calling term.write() synchronously for
    // every IPC message (which, under a flood — several Claude sub-agents writing
    // at once — pins the main thread and freezes the whole UI), incoming chunks
    // are queued and flushed at most once per animation frame, gated on xterm
    // finishing the previous write. That single backpressure point keeps the
    // browser free to paint and handle input no matter how fast bytes arrive.
    let pending: Uint8Array[] = [];
    let scheduled = false;
    let draining = false;
    let rafId = 0;
    const flush = () => {
      scheduled = false;
      rafId = 0;
      if (disposed || pending.length === 0) return;
      // Coalesce everything queued into one write (cheaper than N writes).
      let total = 0;
      for (const c of pending) total += c.length;
      const merged = new Uint8Array(total);
      let off = 0;
      for (const c of pending) {
        merged.set(c, off);
        off += c.length;
      }
      pending = [];
      draining = true;
      // The write callback is the backpressure: only schedule the next flush
      // once xterm has drained this one, so we never outrun the renderer.
      term.write(merged, () => {
        draining = false;
        if (!disposed && pending.length > 0 && !scheduled) {
          scheduled = true;
          rafId = requestAnimationFrame(flush);
        }
      });
    };
    // Throttle the "output is flowing" signal to ~3/s — enough for the rail to
    // light a pane as "en cours" while it's producing output, cheap otherwise.
    let lastActivityFire = 0;
    const enqueue = (buf: ArrayBuffer) => {
      if (disposed) return;
      pending.push(new Uint8Array(buf));
      const now = performance.now();
      if (now - lastActivityFire > 350) {
        lastActivityFire = now;
        onActivityRef.current?.();
      }
      if (!scheduled && !draining) {
        scheduled = true;
        rafId = requestAnimationFrame(flush);
      }
    };
    // Raw-bytes channel instead of a global event: chunks ride a binary IPC body
    // (no JSON number-array expansion). See pty_spawn in src-tauri/src/pty.rs.
    const outputChannel = new Channel<ArrayBuffer>();
    outputChannel.onmessage = enqueue;
    const cancelOutput = () => {
      outputChannel.onmessage = () => {};
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      pending = [];
    };

    // After (re)attaching, force a full tmux redraw: on a relaunch every pane
    // reattaches to its existing session at once, and tmux's redraw to the
    // freshly-attached client can land partial/lost — the pane then stays blank
    // ("black screen") until something else repaints it. The tmux client
    // attaches *asynchronously* after pty_spawn returns, so an early redraw runs
    // before any client exists. pty_redraw returns false in that case; we keep
    // retrying on a growing backoff until it succeeds (a client was found and
    // refreshed), then fire one extra redraw as belt-and-suspenders. This is
    // what fixes the intermittent blank pane: fixed delays could *both* land
    // before the client attached on a loaded machine, leaving it blank forever.
    const attachRedrawTimers: number[] = [];
    const redrawBackoff = [120, 250, 500, 900, 1500, 2400, 3500];
    let redrawStep = 0;
    const tryAttachRedraw = () => {
      if (disposed) return;
      invoke<boolean>("pty_redraw", { id })
        .then((done) => {
          if (disposed) return;
          if (done) {
            // Client is attached and was refreshed; one more after a beat
            // catches any still-partial first paint.
            attachRedrawTimers.push(
              window.setTimeout(() => {
                if (!disposed) invoke("pty_redraw", { id }).catch(() => {});
              }, 300),
            );
            return;
          }
          if (redrawStep < redrawBackoff.length) {
            attachRedrawTimers.push(
              window.setTimeout(tryAttachRedraw, redrawBackoff[redrawStep++]),
            );
          }
        })
        .catch(() => {});
    };

    // Raw panes have no server-side screen to re-request, so a lost/partial first
    // paint (claude drawing before the slot had its final size, fit() on a 0px
    // container, an rAF throttled at mount) leaves the pane permanently black —
    // tmux's refresh-client trick can't apply. We instead run a few staggered
    // repaint passes: re-fit (re-asserts the real size once the layout settled),
    // term.refresh (repaints xterm's own buffer if bytes arrived but weren't
    // drawn), and pty_redraw (SIGWINCH → claude redraws itself). claude takes
    // 1-3s to draw its first frame, so a single immediate redraw is too early;
    // the schedule is bounded (no retry-until — the foreground pid always exists).
    const scheduleRawRepaints = () => {
      const rawRepaintDelays = [200, 700, 1600, 3200];
      for (const d of rawRepaintDelays) {
        attachRedrawTimers.push(
          window.setTimeout(() => {
            if (disposed) return;
            try {
              fit.fit();
            } catch {
              /* container not measurable yet */
            }
            try {
              term.refresh(0, term.rows - 1);
            } catch {
              /* terminal disposed */
            }
            invoke("pty_redraw", { id }).catch(() => {});
          }, d),
        );
      }
    };

    (async () => {
      const offExit = await listen(`pty://exit/${id}`, () => {
        term.write("\r\n\x1b[2m[session ended]\x1b[0m\r\n");
      });
      const offBell = await listen<{ kind?: string } | undefined>(
        `pty://bell/${id}`,
        (e) => {
          onBellRef.current?.(e.payload);
        },
      );
      if (disposed) {
        offExit();
        offBell();
        return;
      }
      unlisteners.push(offExit, offBell);
      await invoke("pty_spawn", {
        id,
        cols: term.cols,
        rows: term.rows,
        cwd: cwdRef.current,
        session: sessionRef.current,
        sandbox: sandboxRef.current,
        kind: kindRef.current,
        // v2 agent preset: the shell execs this command straight away (the agent
        // shows up immediately, never a prompt with the command typed into it).
        // Baked into the spawn — see pty_spawn in src-tauri/src/pty.rs.
        initialCommand: initialCommandRef.current,
        onOutput: outputChannel,
      });
      if (disposed) return;
      // tmux retries until its client attaches (refresh-client); raw runs its own
      // staggered SIGWINCH/refresh passes (no client/server to wait on). Both
      // rescue a black pane whose first paint was lost on relaunch.
      if (kindRef.current === "raw") {
        scheduleRawRepaints();
      } else {
        attachRedrawTimers.push(window.setTimeout(tryAttachRedraw, redrawBackoff[redrawStep++]));
      }
    })();

    const dataDisposable = term.onData((data) => {
      onInteract?.();
      invoke("pty_write", { id, data });
    });
    // The program's title (OSC 0/2) → the v2 rail's project/session name. Claude
    // Code sets it and updates it on `/rename`.
    const titleDisposable = term.onTitleChange((t) => onTitleRef.current?.(t));
    let redrawTimer = 0;
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      invoke("pty_resize", { id, cols, rows });
      // After the resize burst settles, force a full tmux redraw: a grow's
      // SIGWINCH redraw can land partial, leaving a blank strip until copy-mode
      // (scroll) repaints. Debounced so it runs once, after the LAST resize and
      // after tmux has processed the SIGWINCH at the final size.
      if (kindRef.current !== "raw") {
        if (redrawTimer) clearTimeout(redrawTimer);
        redrawTimer = window.setTimeout(() => {
          redrawTimer = 0;
          invoke("pty_redraw", { id }).catch(() => {});
        }, 120);
      }
    });

    // Coalesce resize bursts into a single fit, run on the NEXT frame — i.e.
    // OUTSIDE the ResizeObserver's synchronous delivery. fit() resizes xterm's
    // DOM, which would re-enter the observer in the same pass; the browser then
    // reports a "ResizeObserver loop" and SILENTLY DROPS that notification. If
    // the dropped one carried the final size, xterm stays stuck at the wrong
    // row count, onResize never fires, tmux/the inner app never learn the real
    // height — and the bottom rows show up as an unpainted black strip. The rAF
    // hop breaks that loop and fixes the intermittent display glitch.
    let raf = 0;
    const resizeObserver = new ResizeObserver(() => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = 0;
        try {
          fit.fit();
        } catch {
          /* container not measurable yet */
        }
      });
    });
    resizeObserver.observe(container);

    return () => {
      disposed = true;
      cancelOutput();
      if (raf) cancelAnimationFrame(raf);
      if (redrawTimer) clearTimeout(redrawTimer);
      attachRedrawTimers.forEach(clearTimeout);
      resizeObserver.disconnect();
      dataDisposable.dispose();
      titleDisposable.dispose();
      resizeDisposable.dispose();
      unlisteners.forEach((off) => off());
      paneTerminals.delete(id);
      // A RAW pane is ephemeral: unmount = close = kill its shell. A TMUX pane
      // detaches (keeps its session alive); deliberate tmux kills go through
      // pty_kill from App before this component unmounts.
      if (kindRef.current === "raw") {
        invoke("pty_kill", { id });
      } else {
        invoke("pty_detach", { id });
      }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [id]);

  // Pull keyboard focus into xterm when this pane becomes the active one, and
  // re-fit: while this pane's tab was hidden (display:none), fit() was a no-op,
  // so an OS-window resize during that time left xterm at a stale size.
  useEffect(() => {
    if (!active) return;
    termRef.current?.focus();
    try {
      fitRef.current?.fit();
    } catch {
      /* container not measurable yet */
    }
  }, [active]);

  // Apply theme/font changes (Settings, idea #3) to the live terminal without
  // recreating it, then refit since the cell size may have changed.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = theme;
    term.options.fontFamily = fontFamily;
    term.options.fontSize = fontSize;
    try {
      fitRef.current?.fit();
    } catch {
      /* container not measurable yet */
    }
  }, [theme, fontFamily, fontSize]);

  return (
    <div
      className={`terminal-pane${active ? " active" : ""}`}
      data-pane-id={id}
      onMouseDown={onFocus}
    >
      <div className="terminal-mount" ref={containerRef} />
    </div>
  );
}
