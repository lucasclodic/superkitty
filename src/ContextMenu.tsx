import { useEffect, useRef } from "react";
import { Command } from "./CommandPalette";

/**
 * Right-click context menu for panes/tabs (idea #11). Reuses the same `Command`
 * shape as the palette so every mouse action also shows its keyboard shortcut —
 * you learn the shortcuts by using the menu. Closes on Esc or an outside click.
 */
export function ContextMenu({
  x,
  y,
  commands,
  onClose,
}: {
  x: number;
  y: number;
  commands: Command[];
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

  // Keep the menu fully on-screen (flip away from the right/bottom edges).
  const style: React.CSSProperties = {
    left: Math.min(x, window.innerWidth - 240),
    top: Math.min(y, window.innerHeight - (commands.length * 32 + 14)),
  };

  return (
    <div className="ctx-menu" ref={ref} style={style} role="menu">
      {commands.map((c) => (
        <button
          key={c.id}
          className="ctx-item"
          role="menuitem"
          onClick={() => {
            onClose();
            c.run();
          }}
        >
          <span className="ctx-label">{c.title}</span>
          {c.hint && <kbd className="ctx-hint">{c.hint}</kbd>}
        </button>
      ))}
    </div>
  );
}
