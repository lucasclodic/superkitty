import { useEffect, useRef } from "react";
import { TAB_COLORS } from "./App";

/**
 * Right-click colour picker for a tab (idea #17). Shows the curated palette of
 * distinct tab colours plus an "Auto" reset (fall back to the cwd hash). The
 * colour applies to the whole tab — every pane's accent border follows it via
 * the `--pane-accent` CSS var. Closes on Esc or an outside click.
 */
export function TabColorPicker({
  x,
  y,
  current,
  onPick,
  onReset,
  onClose,
}: {
  x: number;
  y: number;
  current?: string;
  onPick: (color: string) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  // Keep the popover on-screen (flip away from the right/bottom edges).
  const style: React.CSSProperties = {
    left: Math.min(x, window.innerWidth - 188),
    top: Math.min(y, window.innerHeight - 110),
  };

  return (
    <div className="tab-colors" ref={ref} style={style} role="menu">
      <div className="tab-colors-grid">
        {TAB_COLORS.map((c) => (
          <button
            key={c}
            className={`tab-swatch${c === current ? " selected" : ""}`}
            style={{ background: c }}
            title={c}
            onClick={() => {
              onPick(c);
              onClose();
            }}
          />
        ))}
      </div>
      <button
        className="tab-colors-auto"
        onClick={() => {
          onReset();
          onClose();
        }}
      >
        ↺ Auto (selon le dossier)
      </button>
    </div>
  );
}
