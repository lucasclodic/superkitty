import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
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
}: {
  id: string;
  active: boolean;
  onFocus: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      fontFamily:
        '"JetBrains Mono", "SF Mono", Menlo, Monaco, "Courier New", monospace',
      fontSize: 14,
      cursorBlink: true,
      allowProposedApi: true,
      theme: {
        background: "#16151a",
        foreground: "#e4e2e8",
        cursor: "#c9a9ff",
        selectionBackground: "#3a3550",
      },
    });
    termRef.current = term;
    const fit = new FitAddon();
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
      if (disposed) {
        offOutput();
        offExit();
        return;
      }
      unlisteners.push(offOutput, offExit);
      await invoke("pty_spawn", { id, cols: term.cols, rows: term.rows });
    })();

    const dataDisposable = term.onData((data) => {
      invoke("pty_write", { id, data });
    });
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      invoke("pty_resize", { id, cols, rows });
    });

    const resizeObserver = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* container not measurable yet */
      }
    });
    resizeObserver.observe(container);

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      dataDisposable.dispose();
      resizeDisposable.dispose();
      unlisteners.forEach((off) => off());
      // Detach (keep tmux alive). Deliberate close goes through pty_kill,
      // invoked by App before this component unmounts.
      invoke("pty_detach", { id });
      term.dispose();
      termRef.current = null;
    };
  }, [id]);

  // Pull keyboard focus into xterm when this pane becomes the active one.
  useEffect(() => {
    if (active) termRef.current?.focus();
  }, [active]);

  return (
    <div
      className={`terminal-pane${active ? " active" : ""}`}
      data-pane-id={id}
      onMouseDown={onFocus}
      ref={containerRef}
    />
  );
}
