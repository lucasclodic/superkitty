import { useEffect, useRef, useState } from "react";
import { LAYOUT_CYCLE, LayoutName, layoutRects } from "./layouts";

/** Friendly labels for the layout thumbnails (idea #21). */
const LAYOUT_LABELS: Record<LayoutName, string> = {
  tall: "Tall",
  fat: "Fat",
  grid: "Grid",
  horizontal: "Colonnes",
  vertical: "Lignes",
  stack: "Stack",
};

/**
 * Visual layout picker (idea #21). A popover that draws every layout as a
 * miniature, scaled from the *real* pane count of the active tab via the same
 * `layoutRects` the workspace uses — so the preview shows exactly how the panes
 * will be arranged before you commit, instead of cycling `⌃⇧L` blind.
 */
export function LayoutPicker({
  current,
  paneCount,
  focusedIndex,
  onPick,
}: {
  current: LayoutName;
  paneCount: number;
  focusedIndex: number;
  onPick: (name: LayoutName) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on Esc or a click outside the anchor (which contains the trigger, so
  // clicking the trigger toggles rather than double-fires close→open).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  // Preview at least 2 panes so a single-pane tab still shows each layout's
  // shape (a 1-pane layout is always just one full rectangle).
  const n = Math.max(2, paneCount);
  const focus = Math.min(Math.max(0, focusedIndex), n - 1);

  return (
    <div className="pop-anchor" ref={ref}>
      <button
        className={`icon-btn${open ? " active" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title="Disposition des fenêtres (⌃⇧L)"
      >
        ▦
      </button>
      {open && (
        <div className="layout-pop" role="menu">
          {LAYOUT_CYCLE.map((name) => {
            const rects = layoutRects(name, n, focus);
            return (
              <button
                key={name}
                role="menuitemradio"
                aria-checked={name === current}
                className={`layout-card${name === current ? " active" : ""}`}
                onClick={() => {
                  onPick(name);
                  setOpen(false);
                }}
                title={`Disposition ${LAYOUT_LABELS[name]}`}
              >
                <div className="layout-thumb">
                  {/* stack shows one pane at a time: hint the hidden ones with
                      two offset ghost cards behind the visible (focused) one. */}
                  {name === "stack" && (
                    <>
                      <div
                        className="layout-cell ghost"
                        style={{ left: "9%", top: "13%", width: "82%", height: "74%" }}
                      />
                      <div
                        className="layout-cell ghost"
                        style={{ left: "5%", top: "7%", width: "82%", height: "74%" }}
                      />
                    </>
                  )}
                  {rects.map((r, i) =>
                    r.w === 0 || r.h === 0 ? null : (
                      <div
                        key={i}
                        className={`layout-cell${i === focus ? " focus" : ""}`}
                        style={{
                          left: `${r.x * 100}%`,
                          top: `${r.y * 100}%`,
                          width: `${r.w * 100}%`,
                          height: `${r.h * 100}%`,
                        }}
                      />
                    ),
                  )}
                </div>
                <span className="layout-label">{LAYOUT_LABELS[name]}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
