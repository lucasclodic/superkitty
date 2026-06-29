// Reassignable keyboard shortcuts (single source of truth).
//
// A *chord* is a canonical, keyboard-layout-independent string built from a
// KeyboardEvent: modifiers in a fixed order + a key token. For the alphanumeric
// /punctuation block the token comes from the *produced character* (`e.key`),
// so a binding follows the PRINTED key on AZERTY and QWERTY alike; digits,
// arrows, Enter/Tab, F-keys and dead/IME keys keep the physical `e.code`.
// Examples: "M+KeyT", "C+S+KeyW", "S+M+KeyT", "A+M+ArrowUp", "M+Digit1", "C+Tab".
//
// The App owns the `run` functions (they close over component state); this
// module only owns *metadata* (id, label, group, default chords) + the chord
// plumbing + persistence, so the keyboard listener and the Settings editor
// share one description of every binding.

/** Canonical chord string. */
export type Chord = string;

/** Overrides map: actionId → chords. Only non-default actions are stored. */
export type Bindings = Record<string, Chord[]>;

// Fixed modifier order for the canonical form: Ctrl, Alt, Shift, Meta.
function chordParts(
  mods: { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean },
  code: string,
): Chord {
  const parts: string[] = [];
  if (mods.ctrl) parts.push("C");
  if (mods.alt) parts.push("A");
  if (mods.shift) parts.push("S");
  if (mods.meta) parts.push("M");
  parts.push(code);
  return parts.join("+");
}

// Produced character → canonical US-position token. Both members of each US
// shift-pair map to the same token, so the chord stays Shift-immune (⌃] and
// ⌃⇧] both → "BracketRight"). Vocabulary matches CODE_LABEL below.
const CHAR_CODE: Record<string, string> = {
  "`": "Backquote",   "~": "Backquote",
  "-": "Minus",       "_": "Minus",
  "=": "Equal",       "+": "Equal",
  "[": "BracketLeft", "{": "BracketLeft",
  "]": "BracketRight", "}": "BracketRight",
  "\\": "Backslash",  "|": "Backslash",
  ";": "Semicolon",   ":": "Semicolon",
  "'": "Quote",       '"': "Quote",
  ",": "Comma",       "<": "Comma",
  ".": "Period",      ">": "Period",
  "/": "Slash",       "?": "Slash",
};

/**
 * Canonical chord for an event, or `null` when it carries no Ctrl/Alt/Meta
 * modifier — those keystrokes belong to the terminal and must never be
 * swallowed (a bare letter, or Shift+letter, is never a shortcut here).
 */
export function chordFromEvent(e: KeyboardEvent): Chord | null {
  if (!e.ctrlKey && !e.altKey && !e.metaKey) return null;
  // Ignore lone modifier presses (e.code is "MetaLeft", "ShiftRight", …).
  if (/^(Control|Alt|Shift|Meta)(Left|Right)$/.test(e.code)) return null;

  // Default to the physical position (layout-immune): digits stay "DigitN",
  // arrows/Enter/Tab/F-keys and dead/IME keys ("Dead"/"Process", length > 1)
  // keep their e.code. For the alphanum/punctuation block we key off the
  // *produced character* instead, so a binding follows the PRINTED key on any
  // layout (AZERTY: the ',' key has e.code "KeyM" but prints ',' → "Comma").
  // The CHAR_CODE pairs keep it Shift-immune (⌃⇧] and ⌃] both → "BracketRight").
  // Digit/Numpad codes are excluded so ⌘1-9 stay "DigitN" — on AZERTY the digit
  // row prints punctuation unshifted (Digit3 → '"'), which must NOT become
  // "Quote".
  let code = e.code;
  const k = e.key;
  if (k.length === 1 && !/^(Digit|Numpad)/.test(e.code)) {
    if (/^[a-zA-Z]$/.test(k)) {
      code = "Key" + k.toUpperCase();
    } else if (CHAR_CODE[k]) {
      code = CHAR_CODE[k];
    }
  }
  return chordParts(
    { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey },
    code,
  );
}

// Pretty-print a single `e.code` token. Falls back to a cleaned-up code.
const CODE_LABEL: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Enter: "↵",
  NumpadEnter: "↵",
  Space: "Espace",
  Tab: "⇥",
  Backquote: "`",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  Minus: "-",
  Equal: "=",
  PageUp: "PgUp",
  PageDown: "PgDn",
  Home: "Home",
  End: "End",
  Escape: "Esc",
  Backspace: "⌫",
  Delete: "⌦",
};

function labelForCode(code: string): string {
  if (CODE_LABEL[code]) return CODE_LABEL[code];
  const key = code.match(/^Key([A-Z])$/);
  if (key) return key[1];
  const digit = code.match(/^Digit([0-9])$/);
  if (digit) return digit[1];
  const num = code.match(/^Numpad([0-9])$/);
  if (num) return num[1];
  const fn = code.match(/^F([0-9]{1,2})$/);
  if (fn) return code;
  return code;
}

/** Human-readable chord, e.g. "M+S+KeyT" → "⇧⌘T". Order: ⌃⌥⇧⌘ + key. */
export function formatChord(chord: Chord): string {
  const tokens = chord.split("+");
  const code = tokens.pop() ?? "";
  const has = (m: string) => tokens.includes(m);
  let out = "";
  if (has("C")) out += "⌃";
  if (has("A")) out += "⌥";
  if (has("S")) out += "⇧";
  if (has("M")) out += "⌘";
  return out + labelForCode(code);
}

/** Metadata for one bindable action. The matching `run` lives in App.tsx. */
export interface ActionMeta {
  id: string;
  label: string;
  group: string;
  defaultChords: Chord[];
}

// Order here drives the order in the Raccourcis editor.
export const ACTIONS: ActionMeta[] = [
  // --- Onglets ---
  { id: "new-tab", group: "Onglets", label: "Nouvel onglet", defaultChords: ["M+KeyT"] },
  { id: "close-tab", group: "Onglets", label: "Fermer l'onglet", defaultChords: ["M+KeyW"] },
  { id: "reopen", group: "Onglets", label: "Rouvrir le dernier fermé", defaultChords: ["S+M+KeyT"] },
  { id: "next-tab", group: "Onglets", label: "Onglet suivant", defaultChords: ["S+M+BracketRight", "C+Tab"] },
  { id: "prev-tab", group: "Onglets", label: "Onglet précédent", defaultChords: ["S+M+BracketLeft", "C+S+Tab"] },
  { id: "goto-tab-1", group: "Onglets", label: "Aller à l'onglet 1", defaultChords: ["M+Digit1"] },
  { id: "goto-tab-2", group: "Onglets", label: "Aller à l'onglet 2", defaultChords: ["M+Digit2"] },
  { id: "goto-tab-3", group: "Onglets", label: "Aller à l'onglet 3", defaultChords: ["M+Digit3"] },
  { id: "goto-tab-4", group: "Onglets", label: "Aller à l'onglet 4", defaultChords: ["M+Digit4"] },
  { id: "goto-tab-5", group: "Onglets", label: "Aller à l'onglet 5", defaultChords: ["M+Digit5"] },
  { id: "goto-tab-6", group: "Onglets", label: "Aller à l'onglet 6", defaultChords: ["M+Digit6"] },
  { id: "goto-tab-7", group: "Onglets", label: "Aller à l'onglet 7", defaultChords: ["M+Digit7"] },
  { id: "goto-tab-8", group: "Onglets", label: "Aller à l'onglet 8", defaultChords: ["M+Digit8"] },
  { id: "goto-tab-9", group: "Onglets", label: "Aller à l'onglet 9", defaultChords: ["M+Digit9"] },

  // --- Fenêtres (panes) ---
  { id: "new-window", group: "Fenêtres", label: "Nouvelle fenêtre (normale)", defaultChords: ["M+KeyD", "M+Enter", "C+S+Enter"] },
  { id: "new-tmux-window", group: "Fenêtres", label: "Nouvelle fenêtre tmux (persistante)", defaultChords: ["A+M+KeyD"] },
  { id: "close-window", group: "Fenêtres", label: "Fermer la fenêtre", defaultChords: ["C+S+KeyW", "S+M+KeyW", "S+M+KeyD"] },
  { id: "zoom", group: "Fenêtres", label: "Agrandir / réduire (zoom)", defaultChords: ["C+S+KeyZ", "S+M+Enter"] },
  { id: "promote", group: "Fenêtres", label: "Promouvoir en fenêtre principale", defaultChords: ["C+S+Backquote", "S+M+KeyM"] },
  { id: "next-window", group: "Fenêtres", label: "Fenêtre suivante (liste)", defaultChords: ["C+S+BracketRight"] },
  { id: "prev-window", group: "Fenêtres", label: "Fenêtre précédente (liste)", defaultChords: ["C+S+BracketLeft"] },
  { id: "move-forward", group: "Fenêtres", label: "Déplacer dans la liste (avant)", defaultChords: ["C+S+KeyF"] },
  { id: "move-backward", group: "Fenêtres", label: "Déplacer dans la liste (arrière)", defaultChords: ["C+S+KeyB"] },
  { id: "focus-left", group: "Fenêtres", label: "Focus fenêtre à gauche", defaultChords: ["M+ArrowLeft"] },
  { id: "focus-right", group: "Fenêtres", label: "Focus fenêtre à droite", defaultChords: ["M+ArrowRight"] },
  { id: "focus-up", group: "Fenêtres", label: "Focus fenêtre au-dessus", defaultChords: ["M+ArrowUp"] },
  { id: "focus-down", group: "Fenêtres", label: "Focus fenêtre en dessous", defaultChords: ["M+ArrowDown"] },
  { id: "move-left", group: "Fenêtres", label: "Déplacer (échanger) à gauche", defaultChords: ["S+M+ArrowLeft"] },
  { id: "move-right", group: "Fenêtres", label: "Déplacer (échanger) à droite", defaultChords: ["S+M+ArrowRight"] },
  { id: "move-up", group: "Fenêtres", label: "Déplacer (échanger) en haut", defaultChords: ["S+M+ArrowUp"] },
  { id: "move-down", group: "Fenêtres", label: "Déplacer (échanger) en bas", defaultChords: ["S+M+ArrowDown"] },

  // --- Disposition ---
  { id: "next-layout", group: "Disposition", label: "Disposition suivante", defaultChords: ["C+S+KeyL"] },

  // Note : le zoom du texte (⌘+/⌘-/⌘0, idée #23) n'est PAS ici : il est résolu
  // par caractère (e.key) et non par position physique (e.code) dans le listener
  // de App.tsx, pour marcher sur AZERTY comme QWERTY (cf. App.onKeyDown).

  // --- Défilement ---
  { id: "scroll-line-up", group: "Défilement", label: "Défiler d'une ligne (haut)", defaultChords: ["C+S+ArrowUp"] },
  { id: "scroll-line-down", group: "Défilement", label: "Défiler d'une ligne (bas)", defaultChords: ["C+S+ArrowDown"] },
  { id: "scroll-page-up", group: "Défilement", label: "Défiler d'une page (haut)", defaultChords: ["C+S+PageUp"] },
  { id: "scroll-page-down", group: "Défilement", label: "Défiler d'une page (bas)", defaultChords: ["C+S+PageDown"] },
  { id: "scroll-top", group: "Défilement", label: "Haut du scrollback", defaultChords: ["C+S+Home"] },
  { id: "scroll-bottom", group: "Défilement", label: "Bas du scrollback (prompt)", defaultChords: ["C+S+End"] },
  { id: "scroll-prompt-prev", group: "Défilement", label: "Prompt précédent (OSC 133)", defaultChords: ["A+M+ArrowUp"] },
  { id: "scroll-prompt-next", group: "Défilement", label: "Prompt suivant (OSC 133)", defaultChords: ["A+M+ArrowDown"] },

  // --- Général ---
  { id: "palette", group: "Général", label: "Palette de commandes", defaultChords: ["M+KeyK"] },
  { id: "command-bar", group: "Général", label: "Lanceur de commande (suggestions)", defaultChords: ["M+KeyL"] },
  { id: "settings", group: "Général", label: "Réglages", defaultChords: ["M+Comma"] },
  { id: "file-picker", group: "Général", label: "Insérer un chemin de fichier", defaultChords: ["M+KeyP"] },
  { id: "sidebar", group: "Général", label: "Sessions tmux", defaultChords: ["M+KeyB"] },
  { id: "composer", group: "Général", label: "Composer un prompt (multi-lignes)", defaultChords: ["M+KeyE"] },
  { id: "scratchpad", group: "Général", label: "Bloc-notes de l'onglet", defaultChords: ["C+S+KeyN"] },
];

/** Default chords by action id (frozen reference). */
export const DEFAULTS: Record<string, Chord[]> = Object.fromEntries(
  ACTIONS.map((a) => [a.id, a.defaultChords]),
);

const KEYS_KEY = "superkitty.keys.v1";

export function loadBindings(): Bindings {
  try {
    const raw = localStorage.getItem(KEYS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        const out: Bindings = {};
        for (const id of Object.keys(parsed)) {
          if (DEFAULTS[id] && Array.isArray(parsed[id])) {
            const chords = parsed[id].filter((c: unknown) => typeof c === "string");
            out[id] = chords;
          }
        }
        return out;
      }
    }
  } catch {
    /* corrupt → no overrides */
  }
  return {};
}

export function saveBindings(b: Bindings) {
  try {
    localStorage.setItem(KEYS_KEY, JSON.stringify(b));
  } catch {
    /* ignore quota / disabled storage */
  }
}

/** Merge defaults with overrides → full chords map by action id. */
export function resolveBindings(overrides: Bindings): Record<string, Chord[]> {
  const out: Record<string, Chord[]> = {};
  for (const a of ACTIONS) {
    out[a.id] = overrides[a.id] ? [...overrides[a.id]] : [...a.defaultChords];
  }
  return out;
}

/** Reverse map chord → actionId for the keyboard matcher. */
export function buildLookup(resolved: Record<string, Chord[]>): Map<Chord, string> {
  const m = new Map<Chord, string>();
  for (const id of Object.keys(resolved)) {
    for (const c of resolved[id]) m.set(c, id);
  }
  return m;
}

function sameChords(a: Chord[], b: Chord[]): boolean {
  return a.length === b.length && a.every((c, i) => c === b[i]);
}

/** Strip entries equal to their default → minimal overrides to persist. */
export function toOverrides(resolved: Record<string, Chord[]>): Bindings {
  const out: Bindings = {};
  for (const id of Object.keys(resolved)) {
    const def = DEFAULTS[id];
    if (!def) continue;
    if (!sameChords(resolved[id], def)) out[id] = resolved[id];
  }
  return out;
}
