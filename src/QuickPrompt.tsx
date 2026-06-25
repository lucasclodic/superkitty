import { useEffect, useRef, useState } from "react";

/**
 * Quake-mode quick prompt (idea #19). Pops when superkitty is summoned by the
 * global hotkey (⌃`): pick a project (tab), type a request, ↵ sends it to that
 * tab's focused pane and the window re-hides — fire a prompt at Claude from any
 * app without switching windows. ⇧↵ = newline, Esc / outside click dismisses,
 * ⌘1…9 jump between projects.
 */
export function QuickPrompt({
  tabs,
  selected,
  onSelect,
  onSubmit,
  onClose,
}: {
  tabs: { id: string; label: string; tint?: string }[];
  selected: string;
  onSelect: (id: string) => void;
  onSubmit: (text: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div className="quake-backdrop" onMouseDown={onClose}>
      <div className="quake" onMouseDown={(e) => e.stopPropagation()}>
        <div className="quake-tabs">
          {tabs.map((t, i) => (
            <button
              key={t.id}
              className={`quake-tab${t.id === selected ? " active" : ""}`}
              onClick={() => {
                onSelect(t.id);
                ref.current?.focus();
              }}
              title={`⌘${i + 1}`}
            >
              {t.tint && (
                <span className="tab-color" style={{ background: t.tint }} />
              )}
              <span className="quake-tab-num">{i + 1}</span>
              {t.label}
            </button>
          ))}
        </div>
        <textarea
          ref={ref}
          className="quake-text"
          value={text}
          placeholder="Demande à Claude…  ↵ envoyer · ⇧↵ nouvelle ligne · Esc fermer"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            } else if (e.metaKey && e.key >= "1" && e.key <= "9") {
              const t = tabs[Number(e.key) - 1];
              if (t) {
                e.preventDefault();
                onSelect(t.id);
              }
            } else if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (text.trim()) onSubmit(text);
            }
          }}
        />
      </div>
    </div>
  );
}
