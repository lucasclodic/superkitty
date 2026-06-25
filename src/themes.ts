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
}

export const DEFAULT_FONT =
  '"JetBrains Mono", "SF Mono", Menlo, Monaco, "Courier New", monospace';

export const DEFAULT_SETTINGS: SkSettings = {
  theme: "superkitty",
  fontFamily: DEFAULT_FONT,
  fontSize: 14,
  notify: true,
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
      };
    }
  } catch {
    /* corrupt → defaults */
  }
  return DEFAULT_SETTINGS;
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
