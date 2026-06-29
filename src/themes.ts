import type { ITheme } from "@xterm/xterm";

// Settings (idea #3): xterm theme + font, persisted and applied live to every
// pane. Kept tiny and serializable so it round-trips through localStorage.

export interface SkSettings {
  /** Key into THEMES. */
  theme: string;
  fontFamily: string;
  fontSize: number;
  /** macOS notification when an unwatched pane's agent finishes (idea #6). */
  notify: boolean;
  /** Play a short sound when an unwatched pane's agent finishes (idea #6). */
  notifySound: boolean;
  /** Install the semantic Claude Code Stop/Notification hooks (idea #6) so OS
   *  notifications fire reliably AND only on a real turn-end / "needs you",
   *  never on an ambiguous native bell. Edits ~/.claude/settings.json (active
   *  only inside superkitty). Default ON. */
  reinforceAgentDone: boolean;
  /** True once the user has explicitly toggled `reinforceAgentDone` in Settings.
   *  Lets the loader migrate a never-touched setting to the new default-ON
   *  without overriding a deliberate opt-out (idea #6). */
  reinforceAgentDoneUserSet: boolean;
  /** Show a rotating keyboard-shortcut tip in the status bar (idea #22). */
  hintsEnabled: boolean;
  /** UI chrome: the classic violet tabs+grid (v1) or the « Platinum Noir »
   *  project-rail + kitty-windowing direction (v2). Same engine underneath —
   *  v2 only re-skins/re-arranges the already-mounted panes. Toggle is in the
   *  titlebar, the command palette and Settings → Apparence. */
  uiMode: "classic" | "v2";
  /** v2 project rail width state: `full` (the 280px panel) or `mini` (a slim
   *  icon strip — project tiles + the active project's sessions as agent icons
   *  with a status badge, still navigable). Toggled by ⌘B and the rail ‹/›. */
  railMode: "full" | "mini";
  /** v2 project rail: agent launch presets (the icons on a project header). A
   *  click opens a new window in that project and runs `command`. Customizable
   *  in Settings → Agents (e.g. `claude --dangerously-skip-permissions`). */
  agentPresets: AgentPreset[];
}

/** One agent-launch preset shown as an icon on a v2 project header. */
export interface AgentPreset {
  /** Stable id (also selects the built-in logo: claude|codex|gemini|generic). */
  id: string;
  label: string;
  /** Shell command run in the new window (e.g. "claude", "codex", "gemini"). */
  command: string;
  /** Which built-in logo to draw. */
  icon: "claude" | "codex" | "gemini" | "generic";
}

export const DEFAULT_AGENT_PRESETS: AgentPreset[] = [
  { id: "claude", label: "Claude", command: "claude", icon: "claude" },
  { id: "codex", label: "Codex", command: "codex", icon: "codex" },
  { id: "gemini", label: "Gemini", command: "gemini", icon: "gemini" },
];

export const DEFAULT_FONT =
  '"JetBrains Mono", "SF Mono", Menlo, Monaco, "Courier New", monospace';

export const DEFAULT_SETTINGS: SkSettings = {
  theme: "superkitty",
  fontFamily: DEFAULT_FONT,
  fontSize: 14,
  notify: true,
  notifySound: true,
  reinforceAgentDone: true,
  reinforceAgentDoneUserSet: false,
  hintsEnabled: true,
  uiMode: "classic",
  railMode: "full",
  agentPresets: DEFAULT_AGENT_PRESETS,
};

/** A few monospace stacks offered in the Settings font picker. */
export const FONT_CHOICES: { label: string; value: string }[] = [
  { label: "JetBrains Mono", value: DEFAULT_FONT },
  { label: "SF Mono / Menlo", value: '"SF Mono", Menlo, Monaco, monospace' },
  { label: "Fira Code", value: '"Fira Code", "JetBrains Mono", monospace' },
  { label: "Hack", value: '"Hack", "JetBrains Mono", monospace' },
  { label: "Menlo", value: 'Menlo, Monaco, "Courier New", monospace' },
  { label: "Courier", value: '"Courier New", Courier, monospace' },
];

/** Built-in xterm themes (idea #3). Each carries the core colors + a full ANSI
 *  palette so terminals look right across themes. */
export const THEMES: Record<string, { label: string; theme: ITheme }> = {
  superkitty: {
    label: "Superkitty",
    theme: {
      background: "#16151a",
      foreground: "#e4e2e8",
      cursor: "#c9a9ff",
      cursorAccent: "#16151a",
      selectionBackground: "#3a3550",
      black: "#26242e",
      red: "#ff6b8b",
      green: "#9ed98a",
      yellow: "#e6c585",
      blue: "#8fb8ff",
      magenta: "#c9a9ff",
      cyan: "#8fe6e0",
      white: "#e4e2e8",
      brightBlack: "#544f63",
      brightRed: "#ff8aa3",
      brightGreen: "#b5e6a4",
      brightYellow: "#f0d6a0",
      brightBlue: "#abc9ff",
      brightMagenta: "#d8bcff",
      brightCyan: "#a8f0ec",
      brightWhite: "#ffffff",
    },
  },
  tokyoNight: {
    label: "Tokyo Night",
    theme: {
      background: "#1a1b26",
      foreground: "#c0caf5",
      cursor: "#c0caf5",
      cursorAccent: "#1a1b26",
      selectionBackground: "#283457",
      black: "#15161e",
      red: "#f7768e",
      green: "#9ece6a",
      yellow: "#e0af68",
      blue: "#7aa2f7",
      magenta: "#bb9af7",
      cyan: "#7dcfff",
      white: "#a9b1d6",
      brightBlack: "#414868",
      brightRed: "#f7768e",
      brightGreen: "#9ece6a",
      brightYellow: "#e0af68",
      brightBlue: "#7aa2f7",
      brightMagenta: "#bb9af7",
      brightCyan: "#7dcfff",
      brightWhite: "#c0caf5",
    },
  },
  solarizedDark: {
    label: "Solarized Dark",
    theme: {
      background: "#002b36",
      foreground: "#839496",
      cursor: "#93a1a1",
      cursorAccent: "#002b36",
      selectionBackground: "#073642",
      black: "#073642",
      red: "#dc322f",
      green: "#859900",
      yellow: "#b58900",
      blue: "#268bd2",
      magenta: "#d33682",
      cyan: "#2aa198",
      white: "#eee8d5",
      brightBlack: "#586e75",
      brightRed: "#cb4b16",
      brightGreen: "#586e75",
      brightYellow: "#657b83",
      brightBlue: "#839496",
      brightMagenta: "#6c71c4",
      brightCyan: "#93a1a1",
      brightWhite: "#fdf6e3",
    },
  },
  solarizedLight: {
    label: "Solarized Light",
    theme: {
      background: "#fdf6e3",
      foreground: "#657b83",
      cursor: "#586e75",
      cursorAccent: "#fdf6e3",
      selectionBackground: "#eee8d5",
      black: "#073642",
      red: "#dc322f",
      green: "#859900",
      yellow: "#b58900",
      blue: "#268bd2",
      magenta: "#d33682",
      cyan: "#2aa198",
      white: "#eee8d5",
      brightBlack: "#002b36",
      brightRed: "#cb4b16",
      brightGreen: "#586e75",
      brightYellow: "#657b83",
      brightBlue: "#839496",
      brightMagenta: "#6c71c4",
      brightCyan: "#93a1a1",
      brightWhite: "#fdf6e3",
    },
  },
  githubLight: {
    label: "GitHub Light",
    theme: {
      background: "#ffffff",
      foreground: "#24292e",
      cursor: "#044289",
      cursorAccent: "#ffffff",
      selectionBackground: "#c8e1ff",
      black: "#24292e",
      red: "#d73a49",
      green: "#28a745",
      yellow: "#dbab09",
      blue: "#0366d6",
      magenta: "#5a32a3",
      cyan: "#0598bc",
      white: "#6a737d",
      brightBlack: "#959da5",
      brightRed: "#cb2431",
      brightGreen: "#22863a",
      brightYellow: "#b08800",
      brightBlue: "#005cc5",
      brightMagenta: "#5a32a3",
      brightCyan: "#3192aa",
      brightWhite: "#d1d5da",
    },
  },
};

export const DEFAULT_THEME = THEMES.superkitty.theme;

/** Warm graphite + cream xterm theme used by the « Platinum Noir » v2 chrome so
 *  the terminal matches the surrounding ambiance (charte-noir-bureau.html / the
 *  ui-proto). Applied live in v2 regardless of the picked THEME (v1 is
 *  unchanged); the ANSI palette is the six-colour ribbon + cream tones. */
export const PLATINUM_NOIR_THEME: ITheme = {
  background: "#181612",
  foreground: "#eae5d6",
  cursor: "#6fb36a",
  cursorAccent: "#181612",
  selectionBackground: "#38342d",
  black: "#2e2b25",
  red: "#e2685e",
  green: "#6fb36a",
  yellow: "#f0c04e",
  blue: "#54aec0",
  magenta: "#a87fc4",
  cyan: "#54aec0",
  white: "#eae5d6",
  brightBlack: "#8a8474",
  brightRed: "#ee8a80",
  brightGreen: "#8fcf8a",
  brightYellow: "#f4d27a",
  brightBlue: "#7fc9d8",
  brightMagenta: "#c2a0dc",
  brightCyan: "#7fc9d8",
  brightWhite: "#f6f2e6",
};

const SETTINGS_KEY = "superkitty.settings.v1";

export function loadSettings(): SkSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      return {
        theme:
          typeof s.theme === "string" && THEMES[s.theme]
            ? s.theme
            : DEFAULT_SETTINGS.theme,
        fontFamily:
          typeof s.fontFamily === "string" && s.fontFamily
            ? s.fontFamily
            : DEFAULT_SETTINGS.fontFamily,
        fontSize:
          typeof s.fontSize === "number" && s.fontSize >= 8 && s.fontSize <= 32
            ? s.fontSize
            : DEFAULT_SETTINGS.fontSize,
        notify: typeof s.notify === "boolean" ? s.notify : true,
        notifySound: typeof s.notifySound === "boolean" ? s.notifySound : true,
        // Migration (idea #6) : tant que l'utilisateur n'a pas choisi
        // explicitement (UserSet), on force le nouveau défaut ON — les notifs
        // fiables ne marchent QUE via ce hook. Un opt-out délibéré est respecté.
        reinforceAgentDoneUserSet:
          typeof s.reinforceAgentDoneUserSet === "boolean"
            ? s.reinforceAgentDoneUserSet
            : false,
        reinforceAgentDone:
          s.reinforceAgentDoneUserSet === true &&
          typeof s.reinforceAgentDone === "boolean"
            ? s.reinforceAgentDone
            : true,
        hintsEnabled:
          typeof s.hintsEnabled === "boolean" ? s.hintsEnabled : true,
        uiMode: s.uiMode === "v2" ? "v2" : "classic",
        // `hidden` is gone (two modes now) → an old `hidden`/`mini` both land on
        // the slim `mini`; anything else on the full panel.
        railMode: s.railMode === "mini" || s.railMode === "hidden" ? "mini" : "full",
        agentPresets: normalizePresets(s.agentPresets),
      };
    }
  } catch {
    /* corrupt → defaults */
  }
  return DEFAULT_SETTINGS;
}

/** Validate persisted agent presets, falling back to the defaults. */
function normalizePresets(raw: unknown): AgentPreset[] {
  if (!Array.isArray(raw)) return DEFAULT_AGENT_PRESETS;
  const icons = ["claude", "codex", "gemini", "generic"] as const;
  const out: AgentPreset[] = [];
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.command !== "string") continue;
    out.push({
      id: o.id,
      label: typeof o.label === "string" && o.label ? o.label : o.id,
      command: o.command,
      icon: (icons as readonly string[]).includes(o.icon as string)
        ? (o.icon as AgentPreset["icon"])
        : "generic",
    });
  }
  return out.length ? out : DEFAULT_AGENT_PRESETS;
}

export function saveSettings(s: SkSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore quota / disabled storage */
  }
}

/** Resolve the active xterm theme object, falling back to the default. */
export function themeOf(settings: SkSettings): ITheme {
  return THEMES[settings.theme]?.theme ?? DEFAULT_THEME;
}
