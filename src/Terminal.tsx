import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import type { ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";

/** Scroll position reported by the backend (tmux copy-mode). */
type ScrollState = {
  position: number;
  history_size: number;
  pane_height: number;
};

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

    (async () => {
      const offOutput = await listen<number[]>(`pty://output/${id}`, (e) => {
        term.write(new Uint8Array(e.payload));
      });
      const offExit = await listen(`pty://exit/${id}`, () => {
        term.write("\r\n\x1b[2m[session ended]\x1b[0m\r\n");
      });
      const offBell = await listen(`pty://bell/${id}`, () => {
        onBellRef.current?.();
      });
      if (disposed) {
        offOutput();
        offExit();
        offBell();
        return;
      }
      unlisteners.push(offOutput, offExit, offBell);
      await invoke("pty_spawn", {
        id,
        cols: term.cols,
        rows: term.rows,
        cwd: cwdRef.current,
        session: sessionRef.current,
        sandbox: sandboxRef.current,
      });
    })();

    const dataDisposable = term.onData((data) => {
      invoke("pty_write", { id, data });
    });
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      invoke("pty_resize", { id, cols, rows });
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
      if (raf) cancelAnimationFrame(raf);
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

  // ---- Custom scrollbar overlay -----------------------------------------
  // tmux owns the alternate screen, so xterm.js's own scrollbar is inert — the
  // real scrollback lives in tmux copy-mode. We poll the backend for the scroll
  // position and render our own draggable thumb that drives copy-mode.
  const [scroll, setScroll] = useState<ScrollState | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const grabOffsetRef = useRef(0); // px between cursor and thumb top while dragging

  // Throttled sender for pty_scroll_to (entering copy-mode + scrolling spawns a
  // few tmux processes, so don't fire on every pointermove frame).
  const pendingPosRef = useRef<number | null>(null);
  const lastSentRef = useRef(0);
  const flushTimerRef = useRef<number | null>(null);
  const sendScroll = (pos: number) => {
    pendingPosRef.current = pos;
    const flush = () => {
      lastSentRef.current = performance.now();
      flushTimerRef.current = null;
      const p = pendingPosRef.current;
      pendingPosRef.current = null;
      if (p != null) invoke("pty_scroll_to", { id, position: p }).catch(() => {});
    };
    const elapsed = performance.now() - lastSentRef.current;
    if (elapsed >= 50) flush();
    else if (flushTimerRef.current == null)
      flushTimerRef.current = window.setTimeout(flush, 50 - elapsed);
  };

  // Poll the scroll position while this pane is focused (the wheel is handled by
  // tmux now, so the frontend never sees it — polling is how we stay in sync).
  // Suspended during an active drag so our optimistic thumb wins.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const poll = async () => {
      if (draggingRef.current) return;
      try {
        const s = await invoke<ScrollState | null>("pty_scroll_state", { id });
        if (!cancelled && !draggingRef.current) setScroll(s);
      } catch {
        /* session gone / tmux busy — keep last known */
      }
    };
    poll();
    const t = window.setInterval(poll, 120);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [active, id]);

  // Geometry: total scrollable lines = scrollback + visible rows.
  const total = scroll ? scroll.history_size + scroll.pane_height : 0;
  const showScrollbar = !!scroll && scroll.history_size > 0 && total > 0;
  const thumbHeightPct = total ? (scroll!.pane_height / total) * 100 : 100;
  const thumbTopPct = total
    ? ((scroll!.history_size - scroll!.position) / total) * 100
    : 0;

  // Map a cursor Y (px, viewport coords) to a scroll position and apply it.
  const applyFromPointer = (clientY: number) => {
    const track = trackRef.current;
    if (!track || !scroll) return;
    const rect = track.getBoundingClientRect();
    const thumbPx = (thumbHeightPct / 100) * rect.height;
    let topPx = clientY - rect.top - grabOffsetRef.current;
    topPx = Math.max(0, Math.min(rect.height - thumbPx, topPx));
    const topFrac = rect.height ? topPx / rect.height : 0;
    const pos = Math.round(scroll.history_size - topFrac * total);
    const clamped = Math.max(0, Math.min(scroll.history_size, pos));
    // Optimistic local update so the thumb tracks the cursor without lag.
    setScroll((prev) => (prev ? { ...prev, position: clamped } : prev));
    sendScroll(clamped);
  };

  const onTrackPointerDown = (e: React.PointerEvent) => {
    if (!scroll || !trackRef.current) return;
    e.preventDefault();
    const rect = trackRef.current.getBoundingClientRect();
    const thumbPx = (thumbHeightPct / 100) * rect.height;
    const thumbTopPx = (thumbTopPct / 100) * rect.height;
    const onThumb =
      e.clientY >= rect.top + thumbTopPx &&
      e.clientY <= rect.top + thumbTopPx + thumbPx;
    // Grabbing the thumb keeps the grip point; clicking the track centers it.
    grabOffsetRef.current = onThumb
      ? e.clientY - (rect.top + thumbTopPx)
      : thumbPx / 2;
    draggingRef.current = true;
    trackRef.current.setPointerCapture(e.pointerId);
    applyFromPointer(e.clientY);
  };

  const onTrackPointerMove = (e: React.PointerEvent) => {
    if (draggingRef.current) applyFromPointer(e.clientY);
  };

  const endDrag = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    trackRef.current?.releasePointerCapture(e.pointerId);
  };

  return (
    <div
      className={`terminal-pane${active ? " active" : ""}`}
      data-pane-id={id}
      onMouseDown={onFocus}
    >
      <div className="terminal-mount" ref={containerRef} />
      {showScrollbar && (
        <div
          className={`pane-scrollbar${draggingRef.current ? " dragging" : ""}`}
          ref={trackRef}
          onPointerDown={onTrackPointerDown}
          onPointerMove={onTrackPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div
            className="pane-scrollbar-thumb"
            style={{
              top: `${thumbTopPct}%`,
              height: `${Math.max(thumbHeightPct, 6)}%`,
            }}
          />
        </div>
      )}
    </div>
  );
}
