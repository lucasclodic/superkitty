import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { fuzzyScore } from "./CommandPalette";

/**
 * Fuzzy file picker (idea #15). Opened with ⌘P, it lists the focused pane's
 * working directory (via the `list_files` backend — git-aware, .gitignore
 * respected) and inserts the chosen path into that pane. Same UI/keys as the
 * command palette: ↑/↓ navigate, ↵ inserts, Esc / outside click closes.
 */
export function FilePicker({
  cwd,
  onPick,
  onClose,
}: {
  cwd: string | null;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const [files, setFiles] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const f = cwd ? await invoke<string[]>("list_files", { dir: cwd }) : [];
        if (!cancelled) setFiles(f);
      } catch {
        if (!cancelled) setFiles([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  const results = useMemo(() => {
    if (!query.trim()) return files.slice(0, 200);
    return files
      .map((f) => ({ f, s: fuzzyScore(query, f) }))
      .filter((r) => r.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 200)
      .map((r) => r.f);
  }, [query, files]);

  useEffect(() => {
    setSel((s) => Math.max(0, Math.min(s, results.length - 1)));
  }, [results.length]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${sel}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const exec = (i: number) => {
    const f = results[i];
    if (f === undefined) return;
    onClose();
    onPick(f);
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
          placeholder={cwd ? "Fichier à insérer…" : "Aucun dossier"}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSel(0);
          }}
          onKeyDown={onKey}
        />
        <div className="palette-list" ref={listRef}>
          {loading ? (
            <div className="palette-empty">Chargement…</div>
          ) : results.length === 0 ? (
            <div className="palette-empty">Aucun fichier</div>
          ) : (
            results.map((f, i) => (
              <div
                key={f}
                data-idx={i}
                className={`palette-item${i === sel ? " sel" : ""}`}
                onMouseMove={() => setSel(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  exec(i);
                }}
              >
                <span className="palette-title">{f}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
