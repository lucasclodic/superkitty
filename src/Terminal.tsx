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
export function TerminalView({
  id,
  active,
  onFocus,
  onBell,
  cwd,
  session,
  sandbox,
  theme,
  fontFamily,
  fontSize,
}: {
  id: string;
  active: boolean;
  onFocus: () => void;
  // Fired when this pane emits a terminal bell (BEL) — Claude Code rings it when
  // it finishes / awaits input (idea #6).
  onBell?: () => void;
  // Directory to start a freshly-created tmux session in (inherited from the
  // source pane on ⌘D/⌘T). Ignored when re-attaching an existing session.
  cwd?: string;
  // Adopt a specific tmux session by name instead of our own `superkitty-<id>`
  // (idea #2: re-attaching an external/raw session from the session sidebar).
  session?: string;
  // Confine the freshly-created shell's writes to its project dir (idea #5).
  sandbox?: boolean;
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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      fontFamily: fontFamilyRef.current,
      fontSize: fontSizeRef.current,
      cursorBlink: true,
      allowProposedApi: true,
      theme: themeRef.current,
      // tmux owns all scrollback (it runs in the alternate screen), so xterm
      // never needs any of its own. With 0, xterm v6 creates no scrollable area
      // and so never renders its built-in (VS Code-style) scrollbar — keeping
      // the pane free of any scrollbar (scroll via wheel / keyboard → tmux).
      scrollback: 0,
    });
    termRef.current = term;
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
    const enqueue = (buf: ArrayBuffer) => {
      if (disposed) return;
      pending.push(new Uint8Array(buf));
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

    (async () => {
      const offExit = await listen(`pty://exit/${id}`, () => {
        term.write("\r\n\x1b[2m[session ended]\x1b[0m\r\n");
      });
      const offBell = await listen(`pty://bell/${id}`, () => {
        onBellRef.current?.();
      });
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
        onOutput: outputChannel,
      });
      if (disposed) return;
      attachRedrawTimers.push(window.setTimeout(tryAttachRedraw, redrawBackoff[redrawStep++]));
    })();

    const dataDisposable = term.onData((data) => {
      invoke("pty_write", { id, data });
    });
    let redrawTimer = 0;
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      invoke("pty_resize", { id, cols, rows });
      // After the resize burst settles, force a full tmux redraw: a grow's
      // SIGWINCH redraw can land partial, leaving a blank strip until copy-mode
      // (scroll) repaints. Debounced so it runs once, after the LAST resize and
      // after tmux has processed the SIGWINCH at the final size.
      if (redrawTimer) clearTimeout(redrawTimer);
      redrawTimer = window.setTimeout(() => {
        redrawTimer = 0;
        invoke("pty_redraw", { id }).catch(() => {});
      }, 120);
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
      resizeDisposable.dispose();
      unlisteners.forEach((off) => off());
      // Detach (keep tmux alive). Deliberate close goes through pty_kill,
      // invoked by App before this component unmounts.
      invoke("pty_detach", { id });
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
