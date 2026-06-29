import { formatChord, type Chord } from "./shortcuts";

// Source of the rotating shortcut tips shown bottom-left in the status bar
// (idea #22 — discoverability). A tip is built either from a reassignable
// action (its current chord is pulled live, so it follows user remaps) or as a
// literal (for features without a rebindable chord: global Quake hotkey, text
// zoom, drag & drop, double-click, right-click…).

export interface HintSpec {
  /** When set, the displayed keys come from the live binding of this action. */
  actionId?: string;
  /** Literal keys to show (used when there is no reassignable actionId). */
  keys?: string;
  /** The teaching phrase, e.g. "ouvrir une nouvelle fenêtre". */
  text: string;
}

/** A tip ready to render: `keys` (optional) + descriptive `text`. */
export interface Hint {
  keys?: string;
  text: string;
}

// Curated — not all 43 actions (we skip the repetitive "Aller à l'onglet N").
export const HINT_SPECS: HintSpec[] = [
  { actionId: "new-window", text: "ouvrir une nouvelle fenêtre" },
  { actionId: "new-tab", text: "ouvrir un nouvel onglet" },
  { actionId: "palette", text: "ouvrir la palette de commandes" },
  { actionId: "next-layout", text: "changer de disposition" },
  { actionId: "zoom", text: "agrandir / réduire une fenêtre" },
  { actionId: "sidebar", text: "afficher les sessions tmux" },
  { actionId: "composer", text: "écrire un prompt multi-lignes" },
  { actionId: "scratchpad", text: "ouvrir le bloc-notes de l'onglet" },
  { actionId: "file-picker", text: "insérer un chemin de fichier" },
  { actionId: "reopen", text: "rouvrir la dernière fenêtre fermée" },
  { actionId: "promote", text: "promouvoir une fenêtre en principale" },
  { actionId: "settings", text: "ouvrir les réglages" },
  // Littérales : fonctions sans raccourci réassignable.
  { keys: "⌃`", text: "faire apparaître superkitty par-dessus tout (Quake)" },
  { keys: "⌘+ / ⌘-", text: "zoomer / dézoomer le texte" },
  { text: "Glisse une image dans une fenêtre pour l'envoyer à Claude" },
  { text: "Double-clique un onglet pour le renommer" },
  { text: "Clic droit sur une fenêtre pour le menu d'actions" },
];

/**
 * Build the displayable tips from the resolved bindings map (actionId → chords).
 * Action-based specs whose action has no current chord are dropped.
 */
export function buildHints(resolved: Record<string, Chord[]>): Hint[] {
  const out: Hint[] = [];
  for (const spec of HINT_SPECS) {
    if (spec.actionId) {
      const chord = resolved[spec.actionId]?.[0];
      if (!chord) continue;
      out.push({ keys: formatChord(chord), text: spec.text });
    } else {
      out.push({ keys: spec.keys, text: spec.text });
    }
  }
  return out;
}
