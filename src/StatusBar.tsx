import { useEffect, useState } from "react";
import type { Hint } from "./hints";

/** Project context shown left of the status bar — mirrors the Rust `PaneContext`
 * (idea #24). Any field absent (null/0) hides its segment. */
export interface PaneContext {
  node: string | null;
  branch: string | null;
  files: number;
  insertions: number;
  deletions: number;
}

/**
 * Thin bottom status bar (« Platinum Noir » house style). Bottom-left: the
 * Warp-style project context (node · cwd · branch · diff, idea #24) then a
 * rotating keyboard-shortcut tip (idea #22). Right-aligned: the sandbox flag of
 * the focused pane (when set), a ⌘K palette shortcut and a live clock. The
 * tabs/brand/agent-light moved elsewhere — the tabs live only in the titlebar,
 * and the rainbow wordmark sits top-right.
 */
export function StatusBar({
  sandbox,
  onOpenPalette,
  hints,
  onDismissHints,
  cwd,
  context,
}: {
  sandbox: boolean;
  onOpenPalette: () => void;
  /** Rotating tips to teach shortcuts (empty when disabled in Settings). */
  hints: Hint[];
  /** Turn the tips off (the bar's × — flips the persisted setting). */
  onDismissHints: () => void;
  /** Working directory of the active pane (for the 📁 segment). */
  cwd?: string | null;
  /** node/git context of the active pane (for the ⬡/⎇/📄 segments). */
  context?: PaneContext | null;
}) {
  // Live clock (HH:MM), refreshed every 30s so it stays roughly accurate
  // without a per-second tick.
  const [clock, setClock] = useState(formatClock);
  useEffect(() => {
    const iv = setInterval(() => setClock(formatClock()), 30_000);
    return () => clearInterval(iv);
  }, []);

  // Rotate through the tips, one every 3 min — slow enough to read/retain
  // without grabbing the eye. Index is clamped to the current list length so it
  // never points past the end if the list shrinks.
  const [hintIdx, setHintIdx] = useState(0);
  useEffect(() => {
    if (hints.length <= 1) return;
    const iv = setInterval(
      () => setHintIdx((i) => (i + 1) % hints.length),
      180_000,
    );
    return () => clearInterval(iv);
  }, [hints.length]);
  const hint = hints.length ? hints[hintIdx % hints.length] : null;

  const shortCwd = cwd ? cwd.replace(/^\/Users\/[^/]+/, "~") : null;
  const diff = context;
  const hasDiff =
    !!diff && (diff.files > 0 || diff.insertions > 0 || diff.deletions > 0);

  return (
    <div className="statusbar">
      <div className="sb-context">
        {context?.node && (
          <span className="seg sb-ctx" title="Version de Node">
            ⬡ {context.node}
          </span>
        )}
        {shortCwd && (
          <span className="seg sb-ctx sb-ctx-cwd" title={cwd ?? ""}>
            📁 {shortCwd}
          </span>
        )}
        {context?.branch && (
          <span className="seg sb-ctx" title="Branche git">
            ⎇ {context.branch}
          </span>
        )}
        {hasDiff && (
          <span className="seg sb-ctx sb-ctx-diff" title="Modifications (fichiers • +ajouts −retraits)">
            📄 {diff!.files}
            {(diff!.insertions > 0 || diff!.deletions > 0) && (
              <>
                {" • "}
                <span className="sb-ins">+{diff!.insertions}</span>{" "}
                <span className="sb-del">−{diff!.deletions}</span>
              </>
            )}
          </span>
        )}
      </div>
      {hint && (
        <div
          className="seg sb-hint"
          onClick={() =>
            setHintIdx((i) => (hints.length ? (i + 1) % hints.length : 0))
          }
          title="Astuce — cliquer pour la suivante"
        >
          <span className="sb-hint-text">
            💡{" "}
            {hint.keys ? (
              <>
                Astuce : <kbd className="sb-kbd">{hint.keys}</kbd> pour{" "}
                {hint.text}
              </>
            ) : (
              hint.text
            )}
          </span>
          <button
            className="sb-hint-x"
            onClick={(e) => {
              e.stopPropagation();
              onDismissHints();
            }}
            title="Masquer les astuces (réactivable dans Réglages › Raccourcis)"
          >
            ×
          </button>
        </div>
      )}
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
