import { useEffect, useMemo, useRef, useState } from "react";

/** One entry in the command palette (idea #12). `run` is fired on Enter/click. */
export interface Command {
  id: string;
  title: string;
  /** Shortcut shown on the right (display only), e.g. "⌘T". */
  hint?: string;
  /** Group label shown before the title, e.g. "Onglet", "Fenêtre". */
  group?: string;
  /** Extra search terms not shown but matched. */
  keywords?: string;
  run: () => void;
}

/**
 * Subsequence fuzzy match: every char of `query` must appear in `text` in
 * order. Returns a score (higher = better) or -1 when it doesn't match.
 * Consecutive hits and word-start hits score higher, so "ntab" ranks
 * "Nouvel onglet (tab)" sensibly.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  let qi = 0;
  let score = 0;
  let prev = -2;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      let s = 1;
      if (ti === prev + 1) s += 2; // consecutive
      if (ti === 0 || t[ti - 1] === " " || t[ti - 1] === ":") s += 3; // word start
      score += s;
      prev = ti;
      qi++;
    }
  }
  return qi === q.length ? score : -1;
}

/**
 * Command palette overlay (idea #12). A fuzzy-searchable list of every app
 * action — the keyboard answer to discoverability (also a living cheat-sheet,
 * since each row shows its shortcut). Opened with ⌘K, closed with Esc / outside
 * click, navigated with ↑/↓, run with ↵.
 */
export function CommandPalette({
  commands,
  onClose,
}: {
  commands: Command[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    if (!query.trim()) return commands.map((c) => ({ c, score: 0 }));
    return commands
      .map((c) => ({
        c,
        score: fuzzyScore(query, `${c.group ?? ""} ${c.title} ${c.keywords ?? ""}`),
      }))
      .filter((r) => r.score >= 0)
      .sort((a, b) => b.score - a.score);
  }, [query, commands]);

  // Keep the selection inside the (possibly shrunken) result list.
  useEffect(() => {
    setSel((s) => Math.max(0, Math.min(s, results.length - 1)));
  }, [results.length]);

  // Keep the highlighted row scrolled into view.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${sel}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const exec = (i: number) => {
    const r = results[i];
    if (!r) return;
    onClose();
    r.c.run();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      exec(sel);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Commande, disposition, session tmux…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSel(0);
          }}
          onKeyDown={onKey}
        />
        <div className="palette-list" ref={listRef}>
          {results.length === 0 ? (
            <div className="palette-empty">Aucune commande</div>
          ) : (
            results.map((r, i) => (
              <div
                key={r.c.id}
                data-idx={i}
                className={`palette-item${i === sel ? " sel" : ""}`}
                onMouseMove={() => setSel(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  exec(i);
                }}
              >
                <span className="palette-item-main">
                  {r.c.group && <span className="palette-group">{r.c.group}</span>}
                  <span className="palette-title">{r.c.title}</span>
                </span>
                {r.c.hint && <kbd className="palette-hint">{r.c.hint}</kbd>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
