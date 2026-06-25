/**
 * Per-tab scratchpad (idea #20): a notes panel (⌃⇧N) attached to the active
 * tab/project for quick TODOs, a prompt-in-progress, a URL, a snippet of log —
 * without leaving superkitty or polluting the terminal. Persisted per tab.
 * ⌘↵ sends the text to the focused pane (bracketed paste); Esc closes.
 */
export function Scratchpad({
  open,
  value,
  onChange,
  onSend,
  onClose,
}: {
  open: boolean;
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <aside className="scratchpad">
      <div className="sidebar-head">
        <span className="sidebar-title">Bloc-notes — onglet</span>
        <div className="sidebar-head-actions">
          <button
            className="icon-btn"
            title="Envoyer au pane focus (⌘↵)"
            onClick={onSend}
          >
            ➤
          </button>
          <button className="icon-btn" title="Fermer (⌃⇧N)" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>
      <textarea
        className="scratchpad-text"
        value={value}
        placeholder={"TODO, prompt en préparation, URL, log…\n[ ] une tâche\n[x] faite"}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSend();
          }
        }}
      />
      <div className="scratchpad-foot">
        <button className="btn btn-ghost" onClick={onSend}>
          Envoyer au pane <kbd>⌘↵</kbd>
        </button>
      </div>
    </aside>
  );
}
