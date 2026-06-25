import { useEffect, useRef, useState } from "react";

/**
 * Multi-line prompt composer (idea #16): a real text area to write a long prompt
 * comfortably — free newlines (↵), mouse editing, inline image paste — then send
 * it to the focused pane as one bracketed paste (⌘↵). Esc closes. Solves the
 * pain of fighting the terminal's line editor for long, multi-line prompts.
 */
export function PromptComposer({
  onSend,
  onClose,
  saveImage,
}: {
  onSend: (text: string) => void;
  onClose: () => void;
  // Save a pasted image blob and return its path, to insert inline (idea #4).
  saveImage: (blob: File) => Promise<string | null>;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const insertAtCursor = (s: string) => {
    const el = ref.current;
    if (!el) {
      setText((t) => t + s);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    setText((t) => t.slice(0, start) + s + t.slice(end));
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = start + s.length;
    });
  };

  const submit = () => {
    if (text.trim()) onSend(text);
  };

  return (
    <div className="composer">
      <div className="composer-head">
        <span>Composer un prompt</span>
        <span className="composer-hint">⌘↵ envoyer · Esc fermer</span>
      </div>
      <textarea
        ref={ref}
        className="composer-text"
        value={text}
        placeholder="Écris ton prompt… ↵ nouvelle ligne, ⌘↵ pour l'envoyer au pane focus. Tu peux coller une image."
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        onPaste={async (e) => {
          const items = e.clipboardData?.items;
          const img =
            items &&
            Array.from(items).find((it) => it.type.startsWith("image/"));
          if (!img) return; // normal text paste
          const blob = img.getAsFile();
          if (!blob) return;
          e.preventDefault();
          const path = await saveImage(blob);
          if (path) insertAtCursor(path + " ");
        }}
      />
      <div className="composer-foot">
        <button className="btn btn-ghost" onClick={onClose}>
          Annuler <kbd>Esc</kbd>
        </button>
        <button className="btn btn-primary" onClick={submit}>
          Envoyer <kbd>⌘↵</kbd>
        </button>
      </div>
    </div>
  );
}
