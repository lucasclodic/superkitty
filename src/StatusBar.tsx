import { useEffect, useState } from "react";

/**
 * Thin bottom status bar (« Platinum Noir » house style). Right-aligned: the
 * sandbox flag of the focused pane (when set), a ⌘K palette shortcut and a live
 * clock. The tabs/brand/agent-light moved elsewhere — the tabs live only in the
 * titlebar, and the rainbow wordmark sits top-right.
 */
export function StatusBar({
  sandbox,
  onOpenPalette,
}: {
  sandbox: boolean;
  onOpenPalette: () => void;
}) {
  // Live clock (HH:MM), refreshed every 30s so it stays roughly accurate
  // without a per-second tick.
  const [clock, setClock] = useState(formatClock);
  useEffect(() => {
    const iv = setInterval(() => setClock(formatClock()), 30_000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="statusbar">
      <div className="sb-spacer" data-tauri-drag-region />
      {sandbox && (
        <div
          className="seg sb-sandbox"
          title="La fenêtre active tourne en sandbox (écriture confinée)"
        >
          🔒 sandbox
        </div>
      )}
      <button className="seg sb-palette" onClick={onOpenPalette}>
        ⌘K palette
      </button>
      <div className="seg sb-clock">{clock}</div>
    </div>
  );
}

function formatClock(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}
