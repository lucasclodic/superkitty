import { useEffect } from "react";

/** One tmux session as reported by the backend `tmux_list_sessions` (idea #2). */
export interface TmuxSession {
  name: string;
  attached: boolean;
  windows: number;
  created: number;
  activity: number;
  superkitty: boolean;
}

/** Strip the `superkitty-` prefix for a friendlier display name. */
function displayName(s: TmuxSession): string {
  return s.superkitty ? s.name.slice("superkitty-".length) : s.name;
}

/** "il y a 3 min" style relative time from a unix timestamp (seconds). */
function relTime(unixSeconds: number): string {
  if (!unixSeconds) return "";
  const diff = Math.max(0, Math.floor(Date.now() / 1000 - unixSeconds));
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  return `il y a ${Math.floor(diff / 86400)} j`;
}

/**
 * Sidebar listing every tmux session known to the server (idea #2). Lets you
 * re-attach a session into a new pane or kill it. Sessions opened by superkitty
 * carry the `superkitty-` prefix; others are shown as "externe".
 */
export function SessionSidebar({
  open,
  sessions,
  openNames,
  onOpenSession,
  onKillSession,
  onRefresh,
  onClose,
}: {
  open: boolean;
  sessions: TmuxSession[];
  // tmux session names currently mounted in a pane of this app.
  openNames: Set<string>;
  onOpenSession: (name: string) => void;
  onKillSession: (name: string) => void;
  onRefresh: () => void;
  onClose: () => void;
}) {
  // Refresh the list whenever the sidebar becomes visible, then poll while it
  // stays open so the attached/detached state stays roughly live.
  useEffect(() => {
    if (!open) return;
    onRefresh();
    const t = setInterval(onRefresh, 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  // superkitty sessions first, then externals; alphabetical within each group.
  const sorted = [...sessions].sort((a, b) => {
    if (a.superkitty !== b.superkitty) return a.superkitty ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span className="sidebar-title">Sessions tmux</span>
        <div className="sidebar-head-actions">
          <button
            className="icon-btn"
            title="Rafraîchir"
            onClick={onRefresh}
          >
            ⟳
          </button>
          <button
            className="icon-btn"
            title="Fermer (⌘B)"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="sidebar-empty">Aucune session tmux en cours.</p>
      ) : (
        <ul className="session-list">
          {sorted.map((s) => {
            const here = openNames.has(s.name);
            return (
              <li
                key={s.name}
                className={`session-item${here ? " open" : ""}`}
                onClick={() => onOpenSession(s.name)}
                title={`Rattacher « ${s.name} »`}
              >
                <span
                  className={`session-dot${s.attached ? " attached" : ""}`}
                  title={s.attached ? "attachée" : "détachée"}
                />
                <div className="session-info">
                  <span className="session-name">{displayName(s)}</span>
                  <span className="session-meta">
                    {s.superkitty ? "" : "externe · "}
                    {s.windows} fen. · {relTime(s.activity)}
                    {here ? " · ouverte ici" : ""}
                  </span>
                </div>
                <button
                  className="icon-btn session-kill"
                  title="Tuer la session"
                  onClick={(e) => {
                    e.stopPropagation();
                    onKillSession(s.name);
                  }}
                >
                  🗑
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
