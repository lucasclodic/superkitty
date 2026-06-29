import { useEffect, useRef, useState } from "react";

/** Une conversation qui t'attend (la cloche a sonné, pas encore regardée). */
export interface NotifItem {
  /** paneId. */
  paneId: string;
  /** tabId du projet qui la contient. */
  tabId: string;
  project: string;
  title: string;
  tint?: string;
}

/**
 * Centre de notifications (idea #6, v2) : une cloche dans la topbar. Plutôt
 * qu'une pastille « te réclame » par session dans le rail, on regroupe TOUTES
 * les conversations en attente ici. La cloche s'allume dès qu'il y en a une ;
 * cliquer ouvre la liste ; cliquer un item va droit à la conversation
 * (`onOpenItem` → drillPane, ce qui efface aussi son attente).
 */
export function NotificationCenter({
  items,
  onOpenItem,
}: {
  items: NotifItem[];
  onOpenItem: (tabId: string, paneId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const count = items.length;

  // Ferme sur Esc ou clic dehors (l'ancre contient le déclencheur, donc cliquer
  // la cloche bascule au lieu de double-déclencher fermer→ouvrir).
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

  // Quand la dernière attente est traitée, on referme tout seul.
  useEffect(() => {
    if (count === 0) setOpen(false);
  }, [count]);

  return (
    <div className="pop-anchor" ref={ref}>
      <button
        className={`icon-btn notif-bell${count ? " has-need" : ""}${open ? " active" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title={
          count
            ? `${count} conversation${count > 1 ? "s" : ""} en attente`
            : "Aucune conversation en attente"
        }
        aria-label="Centre de notifications"
      >
        <BellIcon />
        {count > 0 && <span className="notif-badge">{count}</span>}
      </button>
      {open && (
        <div className="notif-pop" role="menu">
          <div className="notif-head">
            {count
              ? `${count} conversation${count > 1 ? "s" : ""} en attente`
              : "Rien en attente"}
          </div>
          {count === 0 ? (
            <div className="notif-empty">Aucune conversation ne te réclame.</div>
          ) : (
            items.map((it) => (
              <button
                key={it.paneId}
                role="menuitem"
                className="notif-item"
                onClick={() => {
                  onOpenItem(it.tabId, it.paneId);
                  setOpen(false);
                }}
                title={`${it.project} › ${it.title}`}
              >
                <span
                  className="notif-dot"
                  style={{ ["--tint" as string]: it.tint ?? "var(--rb-orange)" }}
                />
                <span className="notif-text">
                  <span className="notif-proj">{it.project}</span>
                  <span className="notif-sess">{it.title}</span>
                </span>
                <span className="notif-go">→</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** Cloche (tracé simple, rendu en currentColor). */
function BellIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}
