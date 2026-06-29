import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { fuzzyScore } from "./CommandPalette";

/**
 * Warp-style command launcher (idea #24). Opened on demand with ⌘L, it's a
 * floating bottom-anchored input with live fuzzy suggestions — directories for
 * `cd`, shell history otherwise, plus file completion on the last argument. It
 * never replaces the terminal: pick a command, it's sent to the focused pane
 * with a trailing Enter and the launcher closes. So it coexists with a
 * full-screen `claude` instead of fighting it for keystrokes.
 *
 * Keys: ↑/↓ navigate, Tab/→ complete the selection into the input (to drill
 * `cd a` → `cd a/b`), ↵ runs (the selected suggestion, or the typed line when
 * there's none), Esc / outside-click closes.
 */
export function CommandBar({
  cwd,
  foreground,
  onRun,
  onClose,
}: {
  cwd: string | null;
  /** Foreground command of the target pane (e.g. "node" for claude, "-zsh"). */
  foreground?: string | null;
  onRun: (text: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [dirs, setDirs] = useState<string[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // History is cwd-independent; dirs/files come from the pane's folder.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const h = await invoke<string[]>("shell_history", { limit: 300 });
        if (!cancelled) setHistory(h);
      } catch {
        /* no history → just no suggestions */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cwd) {
        setDirs([]);
        setFiles([]);
        return;
      }
      try {
        const [d, f] = await Promise.all([
          invoke<string[]>("list_dirs", { dir: cwd }),
          invoke<string[]>("list_files", { dir: cwd }),
        ]);
        if (!cancelled) {
          setDirs(d);
          setFiles(f);
        }
      } catch {
        if (!cancelled) {
          setDirs([]);
          setFiles([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  // The foreground process is a login/interactive shell → `cd` actually changes
  // the pane's directory. Otherwise (claude/node/an editor) the line is typed
  // into that program, so directory completion would be misleading.
  const atShell = !foreground || /^-?(zsh|bash|fish|sh)$/.test(foreground);

  type Suggestion = { text: string; display: string; badge: string };

  const suggestions = useMemo<Suggestion[]>(() => {
    const tokens = query.split(/\s+/);
    const first = tokens[0] ?? "";

    // `cd` mode — suggest directories of the cwd (only when it'd really cd).
    if (first === "cd" && atShell) {
      const arg = query.replace(/^cd\s*/, "");
      return dirs
        .map((d) => ({ d, s: fuzzyScore(arg, d) }))
        .filter((r) => r.s >= 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 200)
        .map((r) => ({ text: `cd ${r.d}`, display: r.d, badge: "répertoire" }));
    }

    // Otherwise: shell history (fuzzy on the whole line) …
    const hist: Suggestion[] = history
      .map((h) => ({ h, s: fuzzyScore(query, h) }))
      .filter((r) => r.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 50)
      .map((r) => ({ text: r.h, display: r.h, badge: "historique" }));

    // … plus file completion on the last argument (not the command word).
    let fileSugg: Suggestion[] = [];
    const last = tokens[tokens.length - 1] ?? "";
    if (tokens.length > 1 && last) {
      const prefix = query.slice(0, query.length - last.length);
      fileSugg = files
        .map((f) => ({ f, s: fuzzyScore(last, f) }))
        .filter((r) => r.s >= 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 30)
        .map((r) => ({ text: prefix + r.f, display: r.f, badge: "fichier" }));
    }
    return [...hist, ...fileSugg];
  }, [query, dirs, files, history, atShell]);

  useEffect(() => {
    setSel((s) => Math.max(0, Math.min(s, suggestions.length - 1)));
  }, [suggestions.length]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${sel}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const run = (text: string) => {
    const t = text.trim();
    if (!t) return;
    onClose();
    onRun(t);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Tab" || (e.key === "ArrowRight" && suggestions[sel])) {
      // Complete the selection into the input without running (drill cd, etc.).
      const s = suggestions[sel];
      if (s) {
        e.preventDefault();
        setQuery(s.text);
        setSel(0);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(suggestions[sel]?.text ?? query);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const shortCwd = cwd ? cwd.replace(/^\/Users\/[^/]+/, "~") : null;

  return (
    <div className="modal-backdrop cmdbar-backdrop" onMouseDown={onClose}>
      <div
        className="palette cmdbar"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {suggestions.length > 0 && (
          <div className="palette-list cmdbar-list" ref={listRef}>
            {suggestions.map((s, i) => (
              <div
                key={`${s.badge}:${s.text}:${i}`}
                data-idx={i}
                className={`palette-item${i === sel ? " sel" : ""}`}
                onMouseMove={() => setSel(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  run(s.text);
                }}
              >
                <span className="palette-title">{s.display}</span>
                <span className="cmdbar-badge">{s.badge}</span>
              </div>
            ))}
          </div>
        )}
        <div className="cmdbar-input-row">
          <span className="cmdbar-prompt">›</span>
          <input
            ref={inputRef}
            className="palette-input cmdbar-input"
            placeholder="Commande…  (cd, git, npm…)"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSel(0);
            }}
            onKeyDown={onKey}
          />
          {shortCwd && <span className="cmdbar-cwd">{shortCwd}</span>}
        </div>
        {!atShell && foreground && (
          <div className="cmdbar-note">
            ⚠ « {foreground} » est au premier plan — la commande sera tapée dedans.
          </div>
        )}
      </div>
    </div>
  );
}
