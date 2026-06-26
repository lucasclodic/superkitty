import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { TerminalView } from "./Terminal";
import { Logo } from "./Logo";
import { SessionSidebar, TmuxSession } from "./SessionSidebar";
import { StatusBar } from "./StatusBar";
import { LayoutPicker } from "./LayoutPicker";
import { CommandPalette, Command } from "./CommandPalette";
import { ContextMenu } from "./ContextMenu";
import { TabColorPicker } from "./TabColorPicker";
import { Settings } from "./Settings";
import { FilePicker } from "./FilePicker";
import { Scratchpad } from "./Scratchpad";
import { PromptComposer } from "./PromptComposer";
import { QuickPrompt } from "./QuickPrompt";
import { SkSettings, loadSettings, saveSettings, themeOf, DEFAULT_SETTINGS } from "./themes";
import {
  Bindings,
  buildLookup,
  chordFromEvent,
  loadBindings,
  resolveBindings,
  saveBindings,
} from "./shortcuts";
import {
  Direction,
  LAYOUT_CYCLE,
  LayoutName,
  isLayoutName,
  layoutRects,
  neighborsForWindow,
  nextLayout,
  prevLayout,
} from "./layouts";
import "./App.css";

interface Tab {
  id: string;
  // Flat, ordered list of panes (kitty model). The id is the tmux session
  // identity — reusing one reattaches to the same session.
  panes: string[];
  focused: string;
  layout: LayoutName;
  // kitty `toggle_layout stack` (zoom): when true the focused pane fills the
  // tab and the real `layout` is preserved, so un-zooming (⌃⇧Z) is exact.
  zoomed?: boolean;
  // Manual tab name (idea #17). Falls back to the project folder, then the
  // number. The per-project tint is derived from the cwd, not stored.
  title?: string;
  // Tab colour (idea #17). Assigned a distinct palette colour at creation (so two
  // tabs never share one by default) and overridable by right-clicking the tab.
  // When unset (legacy tabs), the tint falls back to the cwd hash.
  color?: string;
}

/** A pane snapshot kept in the closed-items history, enough to reopen it. */
interface ClosedPane {
  id: string;
  // Adopted raw tmux session name, if this pane drove one (idea #2).
  session?: string;
  // Last known cwd, captured when a tab is killed so a fresh reopen lands in the
  // right folder (reattached live panes keep their own cwd, so it's unused there).
  cwd?: string;
}

/** One entry in the reopen-closed history (⌘⇧T): a single pane or a whole tab. */
type ClosedItem =
  | { kind: "pane"; pane: ClosedPane }
  | {
      kind: "tab";
      layout: LayoutName;
      focused: string;
      panes: ClosedPane[];
      // Custom tab name (idea #17), so a renamed-then-reopened tab keeps it.
      title?: string;
      // Custom tab colour (idea #17), so a recoloured-then-reopened tab keeps it.
      color?: string;
    };

interface AppState {
  tabs: Tab[];
  activeTabId: string;
  // tmux session name per pane id, ONLY when it differs from the default
  // `superkitty-<id>` — i.e. an adopted external/raw session (idea #2). Panes
  // without an entry use the default and reattach naturally on restart.
  sessions: Record<string, string>;
  // Recently closed panes/tabs, oldest→newest, capped. ⌘⇧T pops the last one
  // (idea #1). Persisted so the history survives an app restart.
  closed: ClosedItem[];
}

const SK_PREFIX = "superkitty-";

/** Friendly layout names for the command palette (idea #12). */
const LAYOUT_LABEL: Record<LayoutName, string> = {
  tall: "Tall",
  fat: "Fat",
  grid: "Grid",
  horizontal: "Colonnes",
  vertical: "Lignes",
  stack: "Stack",
};

/** The tmux session name a pane id drives: its adopted name or the default. */
const sessionNameOf = (s: AppState, pid: string): string =>
  s.sessions[pid] ?? `${SK_PREFIX}${pid}`;

/** Cap on the reopen-closed history (idea #1), newest kept at the end. */
const CLOSED_CAP = 25;
const pushClosed = (closed: ClosedItem[], item: ClosedItem): ClosedItem[] =>
  [...closed, item].slice(-CLOSED_CAP);

/** Image file extensions claude turns into an "[Image #N]" attachment. */
const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|tiff?|heic|heif|avif|svg|ico)$/i;

/** Type one or more file paths into a pane so `claude` ingests them like
 *  Terminal.app/iTerm2/kitty. The path is sent **literally** (no shell escaping):
 *  superkitty targets `claude`, which resolves the real file, so a backslash-
 *  escaped path (e.g. "Analyse\ Savage\ Step") would fail to resolve.
 *
 *  Only **image** paths are sent as a bracketed paste (ESC[200~ … ESC[201~): that
 *  is what makes claude attach them and show "[Image #1]". A bracketed paste of a
 *  NON-image path (a folder or other file) makes claude try to attach it and then
 *  silently drop it (directories aren't attachable) — so those go as plain text,
 *  which claude inserts as the literal path. */
function injectPaths(paneId: string, paths: string[]) {
  const data =
    paths
      .map((p) => (IMAGE_RE.test(p) ? `\x1b[200~${p}\x1b[201~` : p))
      .join(" ") + " ";
  invoke("pty_write", { id: paneId, data });
}

/** Stable per-project tint (idea #17): hash a path → a pastel HSL colour, so the
 *  same repo always gets the same tab/pane accent for instant recognition. */
function autoTint(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++)
    h = (Math.imul(h, 31) + key.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 65%, 68%)`;
}

/** Curated palette of distinct tab colours (idea #17), evenly spaced hues at the
 *  same saturation/lightness as `autoTint` so manual and auto colours match. */
export const TAB_COLORS = [
  "hsl(0, 65%, 68%)",
  "hsl(28, 65%, 68%)",
  "hsl(48, 65%, 68%)",
  "hsl(90, 65%, 68%)",
  "hsl(140, 65%, 68%)",
  "hsl(168, 65%, 68%)",
  "hsl(196, 65%, 68%)",
  "hsl(216, 65%, 68%)",
  "hsl(255, 65%, 68%)",
  "hsl(285, 65%, 68%)",
  "hsl(315, 65%, 68%)",
  "hsl(338, 65%, 68%)",
];

/** Pick a default tab colour avoiding the ones already in use, so a new tab never
 *  repeats a sibling's colour. Falls back to round-robin once all are taken. */
function pickTabColor(used: (string | undefined)[]): string {
  const taken = new Set(used.filter(Boolean));
  return (
    TAB_COLORS.find((c) => !taken.has(c)) ??
    TAB_COLORS[taken.size % TAB_COLORS.length]
  );
}

const basename = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;

/** Save a clipboard/pasted image blob to ~/.superkitty/dropped/ via the backend,
 *  returning its path (ideas #4/#16). Null on failure. */
async function saveImageBlob(blob: File): Promise<string | null> {
  try {
    const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
    const ext = (blob.type.split("/")[1] || "png").toLowerCase();
    return await invoke<string>("save_image", { bytes, ext });
  } catch {
    return null;
  }
}

// Monotonic id source. tmux session names derive from pane ids, so they must be
// unique within a run; reusing one would attach to the wrong session.
let _seq = 0;
const newId = (prefix: string) => `${prefix}${++_seq}`;

function makeInitialState(): AppState {
  const pid = newId("p");
  const tid = newId("t");
  return {
    tabs: [
      { id: tid, panes: [pid], focused: pid, layout: "tall", color: TAB_COLORS[0] },
    ],
    activeTabId: tid,
    sessions: {},
    closed: [],
  };
}

const STORAGE_KEY = "superkitty.layout.v1";

const NOTES_KEY = "superkitty.notes.v1";
/** Per-tab scratchpad text (idea #20), keyed by tab id. */
function loadNotes(): Record<string, string> {
  try {
    const r = localStorage.getItem(NOTES_KEY);
    if (r) {
      const o = JSON.parse(r);
      if (o && typeof o === "object") return o as Record<string, string>;
    }
  } catch {
    /* ignore */
  }
  return {};
}

const SANDBOX_KEY = "superkitty.sandbox.v1";
/** Per-pane sandbox flags (idea #5), kept so the 🔒 badge survives a restart. */
function loadSandbox(): Record<string, boolean> {
  try {
    const r = localStorage.getItem(SANDBOX_KEY);
    if (r) {
      const o = JSON.parse(r);
      if (o && typeof o === "object") return o as Record<string, boolean>;
    }
  } catch {
    /* ignore */
  }
  return {};
}

// Old (binary-tree) persisted shape — kept only so we can migrate it.
type LegacyNode =
  | { kind: "leaf"; id: string }
  | { kind: "split"; a: LegacyNode; b: LegacyNode };

function legacyLeafIds(node: LegacyNode): string[] {
  return node.kind === "leaf"
    ? [node.id]
    : [...legacyLeafIds(node.a), ...legacyLeafIds(node.b)];
}

/** Normalize a persisted tab from either the new (panes) or old (root tree)
 *  shape into the flat-list model. */
function normalizeTab(raw: any): Tab | null {
  if (!raw || typeof raw.id !== "string") return null;
  let panes: string[];
  if (Array.isArray(raw.panes)) {
    panes = raw.panes.filter((x: unknown) => typeof x === "string");
  } else if (raw.root) {
    // Migrate the old binary-tree layout: flatten leaves in order.
    panes = legacyLeafIds(raw.root as LegacyNode);
  } else {
    return null;
  }
  if (panes.length === 0) return null;
  const focused =
    typeof raw.focused === "string" && panes.includes(raw.focused)
      ? raw.focused
      : panes[0];
  const layout = isLayoutName(raw.layout) ? raw.layout : "tall";
  // Only restore a zoom that still makes sense (needs more than one pane).
  const zoomed = raw.zoomed === true && panes.length > 1;
  const title =
    typeof raw.title === "string" && raw.title.trim() ? raw.title : undefined;
  const color =
    typeof raw.color === "string" && raw.color.trim() ? raw.color : undefined;
  return { id: raw.id, panes, focused, layout, zoomed, title, color };
}

/** Validate the persisted closed-items history (idea #1). */
function normalizeClosed(raw: any): ClosedItem[] {
  if (!Array.isArray(raw)) return [];
  const pane = (p: any): ClosedPane | null =>
    p && typeof p.id === "string"
      ? {
          id: p.id,
          session: typeof p.session === "string" ? p.session : undefined,
          cwd: typeof p.cwd === "string" ? p.cwd : undefined,
        }
      : null;
  const out: ClosedItem[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    if (it.kind === "pane") {
      const p = pane(it.pane);
      if (p) out.push({ kind: "pane", pane: p });
    } else if (it.kind === "tab" && Array.isArray(it.panes)) {
      const panes = it.panes
        .map(pane)
        .filter((p: ClosedPane | null): p is ClosedPane => p !== null);
      if (panes.length) {
        out.push({
          kind: "tab",
          layout: isLayoutName(it.layout) ? it.layout : "tall",
          focused: typeof it.focused === "string" ? it.focused : panes[0].id,
          panes,
          title:
            typeof it.title === "string" && it.title.trim() ? it.title : undefined,
        });
      }
    }
  }
  return out.slice(-CLOSED_CAP);
}

/** Restore the saved layout so reopening the app reattaches to the same tmux
 *  sessions (same pane ids) in the same arrangement. Falls back to a fresh
 *  single-pane tab. */
function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as {
        tabs?: any[];
        activeTabId?: string;
        sessions?: Record<string, string>;
        closed?: any[];
      };
      const tabs = (saved.tabs ?? [])
        .map(normalizeTab)
        .filter((t): t is Tab => t !== null);
      if (tabs.length) {
        const closed = normalizeClosed(saved.closed);
        // Reseed the id counter past every restored id — tabs, panes AND the
        // closed history — so new panes/tabs never collide with (and hijack the
        // tmux session of) a restored or reopenable one.
        const ids: string[] = [];
        tabs.forEach((t) => {
          ids.push(t.id, ...t.panes);
        });
        closed.forEach((c) => {
          if (c.kind === "pane") ids.push(c.pane.id);
          else c.panes.forEach((p) => ids.push(p.id));
        });
        const maxNum = ids.reduce((m, id) => {
          const n = parseInt(id.replace(/\D/g, ""), 10);
          return Number.isNaN(n) ? m : Math.max(m, n);
        }, 0);
        _seq = Math.max(_seq, maxNum);

        let activeTabId = saved.activeTabId ?? tabs[0].id;
        if (!tabs.some((t) => t.id === activeTabId)) activeTabId = tabs[0].id;
        // Keep only adopted-session entries whose pane still exists.
        const livePanes = new Set(tabs.flatMap((t) => t.panes));
        const sessions: Record<string, string> = {};
        for (const [pid, name] of Object.entries(saved.sessions ?? {})) {
          if (livePanes.has(pid)) sessions[pid] = name;
        }
        return { tabs, activeTabId, sessions, closed };
      }

      // No restorable tabs, but the closed history (still-detached sessions) may
      // be recoverable — keep it and reseed past its ids so a fresh pane can't
      // hijack a low-id session referenced only by the history (idea #1).
      const recoverable = normalizeClosed(saved.closed);
      if (recoverable.length) {
        const ids: string[] = [];
        recoverable.forEach((c) => {
          if (c.kind === "pane") ids.push(c.pane.id);
          else c.panes.forEach((p) => ids.push(p.id));
        });
        const maxNum = ids.reduce((m, id) => {
          const n = parseInt(id.replace(/\D/g, ""), 10);
          return Number.isNaN(n) ? m : Math.max(m, n);
        }, 0);
        _seq = Math.max(_seq, maxNum);
        return { ...makeInitialState(), closed: recoverable };
      }
    }
  } catch {
    /* corrupt/empty storage → fresh start */
  }
  return makeInitialState();
}

function App() {
  const [state, setState] = useState<AppState>(loadState);
  // Pane currently highlighted as the drop target while a file is dragged over.
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  // Mirror of `state` for event listeners that are registered once and must read
  // the latest panes/focus without re-subscribing.
  const stateRef = useRef(state);
  stateRef.current = state;

  // When ⌘W would destroy a tab whose pane(s) are running an agent, we park the
  // pending kill here and show a confirmation instead of killing on reflex
  // (idea #13). `busy` holds the foreground commands found (e.g. "claude",
  // "node") so the prompt can name what's running; `snapshot` is the tab's
  // closed-history entry so kill OR detach both feed ⌘⇧T.
  const [pendingKill, setPendingKill] = useState<{
    tabId: string;
    busy: string[];
    snapshot: ClosedItem;
  } | null>(null);
  const pendingKillRef = useRef(pendingKill);
  pendingKillRef.current = pendingKill;

  // ---- session sidebar (idea #2) ----
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tmuxSessions, setTmuxSessions] = useState<TmuxSession[]>([]);
  const sidebarOpenRef = useRef(sidebarOpen);
  sidebarOpenRef.current = sidebarOpen;

  // ---- command palette (idea #12) ----
  const [paletteOpen, setPaletteOpen] = useState(false);
  const paletteOpenRef = useRef(paletteOpen);
  paletteOpenRef.current = paletteOpen;

  // ---- right-click context menu (idea #11) ----
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  // Tab colour picker (idea #17): which tab + where to anchor the popover.
  const [colorMenu, setColorMenu] = useState<
    { tabId: string; x: number; y: number } | null
  >(null);

  // Pane ids that rang their bell while unwatched — badged until you look at
  // them (idea #6). Not persisted (transient activity).
  const [activity, setActivity] = useState<Set<string>>(() => new Set());

  // ---- settings: theme, font (idea #3) ----
  const [settings, setSettings] = useState<SkSettings>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsOpenRef = useRef(settingsOpen);
  settingsOpenRef.current = settingsOpen;

  // ---- reassignable keyboard shortcuts (see shortcuts.ts) ----
  // `bindings` holds only the overrides; the live chord→action lookup is kept
  // in a ref so the once-bound keydown listener always reads the latest map.
  const [bindings, setBindings] = useState<Bindings>(loadBindings);
  const lookupRef = useRef(buildLookup(resolveBindings(bindings)));
  useEffect(() => {
    lookupRef.current = buildLookup(resolveBindings(bindings));
    saveBindings(bindings);
  }, [bindings]);

  // ---- file picker (idea #15): null = closed, else the cwd to list ----
  const [filePicker, setFilePicker] = useState<{ cwd: string | null } | null>(
    null,
  );
  const filePickerOpenRef = useRef(false);
  filePickerOpenRef.current = filePicker !== null;

  // ---- per-tab project name/tint + rename (idea #17) ----
  const [tabCwd, setTabCwd] = useState<Record<string, string>>({});
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const renamingRef = useRef(renamingTabId);
  renamingRef.current = renamingTabId;

  // ---- per-tab scratchpad notes (idea #20) ----
  const [notes, setNotes] = useState<Record<string, string>>(loadNotes);
  const [scratchpadOpen, setScratchpadOpen] = useState(false);

  // ---- multi-line prompt composer (idea #16) ----
  const [composerOpen, setComposerOpen] = useState(false);

  // ---- per-pane sandbox flags (idea #5), persisted for the badge ----
  const [sandboxed, setSandboxed] = useState<Record<string, boolean>>(loadSandbox);

  // ---- Quake-mode quick prompt (idea #19) ----
  const [quakeOpen, setQuakeOpen] = useState(false);
  const [quakeTab, setQuakeTab] = useState<string>("");
  const lastQuakeTabRef = useRef<string>("");

  // Pending spawn directories, keyed by new pane id. A new pane (⌘D/⌘T)
  // inherits the current folder of the pane it was opened from (idea #18);
  // TerminalView reads this when it spawns the tmux session. Restored/first
  // panes have no entry and fall back to $HOME.
  const spawnCwdRef = useRef<Record<string, string>>({});

  // Per-tab focus history, most-recent LAST (kitty `active_window_history`).
  // move_window / neighboring_window break a multi-candidate tie by picking the
  // most-recently-focused neighbor (kitty `most_recent_group`) — this is what
  // makes a swap reversible: right after swapping with a window, that window is
  // the most recent, so the opposite move swaps the very same pair back.
  // Not persisted (kitty doesn't persist it either); rebuilt as focus moves.
  const activityRef = useRef<Map<string, string[]>>(new Map());

  // Resolve the working directory of the active tab's focused pane (its live
  // tmux pane), to seed a newly-created sibling/tab. Null when unavailable.
  const sourceCwd = async (): Promise<string | undefined> => {
    const s = stateRef.current;
    const t = s.tabs.find((x) => x.id === s.activeTabId);
    if (!t) return undefined;
    try {
      return (await invoke<string | null>("pty_cwd", { id: t.focused })) ?? undefined;
    } catch {
      return undefined;
    }
  };

  // Persist layout on every change so a restart restores tabs/panes + their
  // tmux sessions.
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  // Persist settings (theme/font) separately so they survive a restart (idea #3).
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  // Persist per-tab scratchpad notes (idea #20).
  useEffect(() => {
    try {
      localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
    } catch {
      /* ignore */
    }
  }, [notes]);

  // Persist per-pane sandbox flags (idea #5).
  useEffect(() => {
    try {
      localStorage.setItem(SANDBOX_KEY, JSON.stringify(sandboxed));
    } catch {
      /* ignore */
    }
  }, [sandboxed]);

  // Keep each tab's cwd fresh (its focused pane) for the project name + tint;
  // re-runs on focus change and polls every 2s so the name follows a live `cd`
  // (idea #17).
  const focusKey = state.tabs.map((t) => `${t.id}:${t.focused}`).join(",");
  useEffect(() => {
    let cancelled = false;
    const fetchCwds = async () => {
      const entries = await Promise.all(
        stateRef.current.tabs.map(async (t) => {
          try {
            return [
              t.id,
              await invoke<string | null>("pty_cwd", { id: t.focused }),
            ] as const;
          } catch {
            return [t.id, null] as const;
          }
        }),
      );
      if (cancelled) return;
      setTabCwd((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const [tid, c] of entries) {
          if (c && next[tid] !== c) {
            next[tid] = c;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    };
    fetchCwds();
    // Panes spawn asynchronously on mount, so cwd isn't available on the first
    // pass; retry shortly after so project names/tints appear without needing a
    // focus change.
    const t = setTimeout(fetchCwds, 1200);
    // Poll periodically so the tab name/tint follow a live `cd` inside a pane
    // (tmux's pane_current_path), not just a focus change.
    const iv = setInterval(fetchCwds, 2000);
    return () => {
      cancelled = true;
      clearTimeout(t);
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  // Record each tab's focused pane into its history whenever it changes, so the
  // most-recently-used tie-break (mostRecentIndex) has data to read.
  useEffect(() => {
    for (const t of state.tabs) {
      const cur = activityRef.current.get(t.id) ?? [];
      if (cur[cur.length - 1] !== t.focused) {
        activityRef.current.set(
          t.id,
          [...cur.filter((id) => id !== t.focused), t.focused].slice(-64),
        );
      }
    }
  }, [state.tabs]);

  // ---- operations (all stable: they only call setState / read the DOM) ----

  const updateActiveTab = (fn: (t: Tab) => Tab) =>
    setState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) => (t.id === prev.activeTabId ? fn(t) : t)),
    }));

  const newTab = async () => {
    // Inherit the current folder of the pane we're leaving (idea #18).
    const cwd = await sourceCwd();
    const pid = newId("p");
    const tid = newId("t");
    if (cwd) spawnCwdRef.current[pid] = cwd;
    setState((prev) => ({
      ...prev,
      tabs: [
        ...prev.tabs,
        {
          id: tid,
          panes: [pid],
          focused: pid,
          layout: "tall" as LayoutName,
          // Distinct colour so a new tab never repeats a sibling's (idea #17).
          color: pickTabColor(prev.tabs.map((t) => t.color)),
        },
      ],
      activeTabId: tid,
    }));
  };

  // new_window: add a pane after the focused one; the layout rebalances all of
  // them. There is no per-pane split direction (kitty has none outside `splits`).
  // The new pane starts in the focused pane's folder (idea #18).
  const addWindow = async () => {
    const cwd = await sourceCwd();
    const pid = newId("p");
    if (cwd) spawnCwdRef.current[pid] = cwd;
    updateActiveTab((t) => {
      const i = t.panes.indexOf(t.focused);
      const panes = [...t.panes];
      panes.splice(i < 0 ? panes.length : i + 1, 0, pid);
      // A new window reveals the layout again (kitty un-zooms on new_window).
      return { ...t, panes, focused: pid, zoomed: false };
    });
  };

  // new_window but sandboxed (idea #5): the new pane's shell is write-confined
  // to its project dir (the focused pane's cwd). Marked so the 🔒 badge shows.
  const addSandboxedWindow = async () => {
    const cwd = await sourceCwd();
    const pid = newId("p");
    if (cwd) spawnCwdRef.current[pid] = cwd;
    setSandboxed((m) => ({ ...m, [pid]: true }));
    updateActiveTab((t) => {
      const i = t.panes.indexOf(t.focused);
      const panes = [...t.panes];
      panes.splice(i < 0 ? panes.length : i + 1, 0, pid);
      return { ...t, panes, focused: pid, zoomed: false };
    });
  };

  // A pane is "busy" when its foreground process isn't a bare login shell —
  // i.e. an agent (claude/node) or an editor is actually running in it. Used to
  // decide whether closing needs a confirmation (idea #13).
  const SHELLS = new Set([
    "zsh",
    "-zsh",
    "bash",
    "-bash",
    "sh",
    "-sh",
    "fish",
    "-fish",
    "login",
    "tmux",
  ]);
  const busyPanes = async (ids: string[]): Promise<string[]> => {
    const cmds = await Promise.all(
      ids.map(async (id) => {
        try {
          return await invoke<string | null>("pty_foreground", { id });
        } catch {
          return null;
        }
      }),
    );
    return cmds.filter((c): c is string => !!c && !SHELLS.has(c));
  };

  // Actually destroy a tab: kill every pane's tmux session (deliberate close).
  // `closedItem` (when given) records the tab so ⌘⇧T can recreate it — fresh
  // panes, since the sessions are gone, in the same layout/cwd.
  const killTab = (tabId: string, closedItem?: ClosedItem) =>
    setState((prev) => {
      const t = prev.tabs.find((x) => x.id === tabId);
      if (!t) return prev;
      t.panes.forEach((id) => invoke("pty_kill", { id }));
      // Forget any adopted-session mappings for the killed panes.
      const sessions = { ...prev.sessions };
      t.panes.forEach((id) => delete sessions[id]);
      const closed = closedItem
        ? pushClosed(prev.closed, closedItem)
        : prev.closed;
      const remaining = prev.tabs.filter((x) => x.id !== tabId);
      if (remaining.length === 0) return { ...makeInitialState(), closed };
      const idx = prev.tabs.findIndex((x) => x.id === tabId);
      const next = remaining[Math.min(idx, remaining.length - 1)];
      return { tabs: remaining, activeTabId: next.id, sessions, closed };
    });

  // Close a tab WITHOUT killing: unmounting each Terminal calls pty_detach, so
  // the tmux sessions (and their running agents) stay alive. `closedItem` lets
  // ⌘⇧T reopen the tab and reattach those live sessions (idea #13 escape hatch).
  const detachTab = (tabId: string, closedItem?: ClosedItem) =>
    setState((prev) => {
      const t = prev.tabs.find((x) => x.id === tabId);
      if (!t) return prev;
      const closed = closedItem
        ? pushClosed(prev.closed, closedItem)
        : prev.closed;
      const remaining = prev.tabs.filter((x) => x.id !== tabId);
      if (remaining.length === 0) return { ...makeInitialState(), closed };
      const idx = prev.tabs.findIndex((x) => x.id === tabId);
      const next = remaining[Math.min(idx, remaining.length - 1)];
      // Keep `sessions` so a ⌘⇧T reopen of a detached raw pane still maps it.
      return {
        tabs: remaining,
        activeTabId: next.id,
        sessions: prev.sessions,
        closed,
      };
    });

  // Close a specific tab by id. ⌘W closes the active one; the tab-bar ✕ button
  // closes any tab. If any pane is running an agent, ask first (kill vs detach
  // vs cancel) instead of destroying it on reflex (idea #13). The tab snapshot
  // is taken up-front so both outcomes feed the ⌘⇧T history.
  const closeTabById = async (tabId: string) => {
    const t = stateRef.current.tabs.find((x) => x.id === tabId);
    if (!t) return;
    const snapshot = await snapshotTab(t);
    const busy = await busyPanes(t.panes);
    if (busy.length) {
      setPendingKill({ tabId: t.id, busy, snapshot });
      return;
    }
    killTab(t.id, snapshot);
  };

  // Close the whole active tab. ⌘W.
  const closeTab = () => closeTabById(stateRef.current.activeTabId);

  // Close only the focused pane (detaches, keeping its tmux session alive).
  // ⌃⇧W / ⌘⇧D. The pane goes into the closed history so ⌘⇧T can reattach it.
  const closeFocused = () =>
    closePane(stateRef.current.tabs.find((x) => x.id === stateRef.current.activeTabId)?.focused);

  // Detach a specific pane by id (keeps its tmux session alive; the per-window
  // ✕ button uses this, ⌃⇧W routes through closeFocused). Pushes it onto the
  // ⌘⇧T history so a reopen reattaches the live session.
  const closePane = (paneId: string | undefined) =>
    setState((prev) => {
      if (!paneId) return prev;
      const t = prev.tabs.find((x) => x.panes.includes(paneId));
      if (!t) return prev;
      // Removing the pane unmounts its Terminal → pty_detach (not kill), so the
      // session keeps running and a ⌘⇧T reopen reattaches it.
      const closed = pushClosed(prev.closed, {
        kind: "pane",
        pane: { id: paneId, session: prev.sessions[paneId] },
      });

      const i = t.panes.indexOf(paneId);
      const panes = t.panes.filter((id) => id !== paneId);
      if (panes.length) {
        // Keep the current focus unless we just closed it.
        const focused =
          t.focused === paneId ? panes[Math.min(i, panes.length - 1)] : t.focused;
        return {
          ...prev,
          closed,
          tabs: prev.tabs.map((x) =>
            x.id === t.id ? { ...x, panes, focused, zoomed: false } : x,
          ),
        };
      }

      // The tab is now empty: drop it.
      const remaining = prev.tabs.filter((x) => x.id !== t.id);
      if (remaining.length === 0) return { ...makeInitialState(), closed };
      const idx = prev.tabs.findIndex((x) => x.id === t.id);
      const next = remaining[Math.min(idx, remaining.length - 1)];
      return {
        tabs: remaining,
        activeTabId: next.id,
        sessions: prev.sessions,
        closed,
      };
    });

  // Snapshot a tab for the closed-items history: its layout/focus plus each
  // pane's adopted session + live cwd (so a killed-then-reopened tab respawns in
  // place). Async because it queries tmux for each pane's cwd.
  const snapshotTab = async (t: Tab): Promise<ClosedItem> => {
    const panes = await Promise.all(
      t.panes.map(async (pid) => {
        let cwd: string | undefined;
        try {
          cwd = (await invoke<string | null>("pty_cwd", { id: pid })) ?? undefined;
        } catch {
          /* session may already be gone */
        }
        return { id: pid, session: stateRef.current.sessions[pid], cwd };
      }),
    );
    return { kind: "tab", layout: t.layout, focused: t.focused, panes, title: t.title, color: t.color };
  };

  // Reopen the most recently closed pane or tab (Chrome-style ⌘⇧T). A closed
  // PANE reattaches its still-alive tmux session (running claude + scrollback);
  // a closed TAB is recreated in its layout — live panes reattach, killed ones
  // spawn fresh in their recorded cwd. No-op when the history is empty.
  const reopenClosed = () =>
    setState((prev) => {
      const item = prev.closed[prev.closed.length - 1];
      if (!item) return prev;
      const closed = prev.closed.slice(0, -1);

      // Reseed the id counter and stage a fresh-spawn cwd for a reopened pane.
      const register = (p: ClosedPane) => {
        if (p.cwd) spawnCwdRef.current[p.id] = p.cwd;
        const n = parseInt(p.id.replace(/\D/g, ""), 10);
        if (!Number.isNaN(n)) _seq = Math.max(_seq, n);
      };

      if (item.kind === "pane") {
        const p = item.pane;
        register(p);
        // Already open somewhere → just focus it.
        for (const t of prev.tabs) {
          if (t.panes.includes(p.id)) {
            return {
              ...prev,
              closed,
              activeTabId: t.id,
              tabs: prev.tabs.map((x) =>
                x.id === t.id ? { ...x, focused: p.id } : x,
              ),
            };
          }
        }
        const sessions = p.session
          ? { ...prev.sessions, [p.id]: p.session }
          : prev.sessions;
        const tabs = prev.tabs.map((t) => {
          if (t.id !== prev.activeTabId) return t;
          const i = t.panes.indexOf(t.focused);
          const panes = [...t.panes];
          panes.splice(i < 0 ? panes.length : i + 1, 0, p.id);
          return { ...t, panes, focused: p.id, zoomed: false };
        });
        return { ...prev, closed, tabs, sessions };
      }

      // kind === "tab": recreate the tab. Skip any pane already mounted in
      // another tab (e.g. re-attached via the sidebar) so an id is never mounted
      // twice — that would share one PtyInstance and break on the first close.
      const open = new Set(prev.tabs.flatMap((t) => t.panes));
      const fresh = item.panes.filter((p) => !open.has(p.id));
      if (fresh.length === 0) return { ...prev, closed };
      fresh.forEach(register);
      const sessions = { ...prev.sessions };
      fresh.forEach((p) => {
        if (p.session) sessions[p.id] = p.session;
      });
      const tid = newId("t");
      const paneIds = fresh.map((p) => p.id);
      const focused = paneIds.includes(item.focused) ? item.focused : paneIds[0];
      return {
        ...prev,
        closed,
        sessions,
        tabs: [
          ...prev.tabs,
          { id: tid, panes: paneIds, focused, layout: item.layout, title: item.title, color: item.color },
        ],
        activeTabId: tid,
      };
    });

  const focusSibling = (delta: 1 | -1) =>
    updateActiveTab((t) => {
      const i = t.panes.indexOf(t.focused);
      const j = (i + delta + t.panes.length) % t.panes.length;
      return { ...t, focused: t.panes[j] };
    });

  // kitty `most_recent_group`: among the neighbor candidates in a direction,
  // pick the pane focused most recently; fall back to the first candidate (the
  // structural fallback kitty uses when none are in the history).
  const pickNeighbor = (t: Tab, dir: Direction): number => {
    const i = Math.max(0, t.panes.indexOf(t.focused));
    const cands = neighborsForWindow(t.layout, t.panes.length, i)[dir];
    if (!cands || cands.length === 0) return -1;
    const hist = activityRef.current.get(t.id) ?? [];
    for (let h = hist.length - 1; h >= 0; h--) {
      const k = cands.find((ci) => t.panes[ci] === hist[h]);
      if (k !== undefined) return k;
    }
    return cands[0];
  };

  // Move focus to the neighboring pane (⌘ + arrows), kitty `neighboring_window`.
  const focusDirection = (dir: Direction) =>
    updateActiveTab((t) => {
      const j = pickNeighbor(t, dir);
      return j < 0 ? t : { ...t, focused: t.panes[j] };
    });

  // Swap the focused pane with its neighbor (⌘⇧ + arrows), kitty `move_window`.
  // Neighbors are topological (the pane's place in the list), not geometric, and
  // ties go to the most-recently-used pane — so the swap is a true involution:
  // reversing the direction trades the same pair back. Reordering the flat
  // `panes` list recomputes the layout; focus follows the moved pane (same id,
  // new index). idea #14.
  //
  // For the involution to hold even when the *reverse* direction is
  // multi-candidate (e.g. secondary→main in tall, whose reverse main→secondary
  // can pick any secondary), we must feed the most-recent history exactly like
  // kitty: `move_window_group` swaps the two panes, then `set_active_group_idx`
  // pushes the DISPLACED partner to the most-recent slot, so the opposite move
  // re-selects that same partner. The focus-history effect re-appends the
  // still-focused pane right after, keeping it most-recent overall.
  const moveDirection = (dir: Direction) => {
    const s = stateRef.current;
    const t = s.tabs.find((x) => x.id === s.activeTabId);
    if (!t) return;
    const i = Math.max(0, t.panes.indexOf(t.focused));
    const j = pickNeighbor(t, dir);
    if (j < 0) return;
    const partner = t.panes[j];
    const hist = activityRef.current.get(t.id) ?? [];
    activityRef.current.set(
      t.id,
      [...hist.filter((id) => id !== partner), partner].slice(-64),
    );
    updateActiveTab((tab) => {
      // Guard against a stale read swapping the wrong pair (no-op in practice).
      if (tab.panes[i] !== t.focused || tab.panes[j] !== partner) return tab;
      const panes = [...tab.panes];
      [panes[i], panes[j]] = [panes[j], panes[i]];
      return { ...tab, panes };
    });
  };

  const cycleLayout = (delta: 1 | -1) =>
    updateActiveTab((t) => ({
      ...t,
      layout: delta === 1 ? nextLayout(t.layout) : prevLayout(t.layout),
      zoomed: false,
    }));

  // Apply a layout chosen directly from the visual picker (idea #21).
  const setLayout = (name: LayoutName) =>
    updateActiveTab((t) => ({ ...t, layout: name, zoomed: false }));

  // kitty `toggle_layout stack` (zoom): blow the focused pane up to fill the
  // tab, toggling back to the exact previous arrangement. The real `layout` is
  // never touched — only the `zoomed` flag — so un-zoom is lossless. No-op with
  // a single pane. ⌃⇧Z.
  const toggleZoom = () =>
    updateActiveTab((t) =>
      t.panes.length <= 1 ? t : { ...t, zoomed: !t.zoomed },
    );

  // Zoom a SPECIFIC pane (the per-pane ⛶ button): focus it and fill the tab, or
  // un-zoom when it's already the zoomed one.
  const zoomPane = (paneId: string) =>
    updateActiveTab((t) => {
      if (t.panes.length <= 1) return t;
      if (t.zoomed && t.focused === paneId) return { ...t, zoomed: false };
      return { ...t, focused: paneId, zoomed: true };
    });

  // kitty `move_window_to_top`: promote the focused pane to index 0 so it becomes
  // the "main" window (the big one in tall/fat). kitty does a SINGLE swap of the
  // active pane with index 0 (move_window_group → one tuple swap), not a
  // splice-to-front — so the pane that held index 0 takes the focused pane's old
  // slot and the others stay put. The layout recomputes around it. ⌘⇧M.
  const promoteToMain = () =>
    updateActiveTab((t) => {
      const i = t.panes.indexOf(t.focused);
      if (i <= 0) return t;
      const panes = [...t.panes];
      [panes[0], panes[i]] = [panes[i], panes[0]];
      return { ...t, panes, zoomed: false };
    });

  // kitty move_window_forward / move_window_backward: swap the focused pane with
  // its neighbor in LIST order (⌃⇧F / ⌃⇧B), no wrap at the ends.
  const moveInList = (delta: 1 | -1) =>
    updateActiveTab((t) => {
      const i = t.panes.indexOf(t.focused);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= t.panes.length) return t;
      const panes = [...t.panes];
      [panes[i], panes[j]] = [panes[j], panes[i]];
      return { ...t, panes, zoomed: false };
    });

  // Drive the focused pane's scrollback through tmux copy-mode (kitty scroll_*
  // actions). The backend `pty_scroll` maps each action to a copy-mode command;
  // the scrollbar overlay (which polls) reflects the new position.
  const scrollPane = (action: string) => {
    const s = stateRef.current;
    const t = s.tabs.find((x) => x.id === s.activeTabId);
    if (t) invoke("pty_scroll", { id: t.focused, action }).catch(() => {});
  };

  const cycleTab = (delta: 1 | -1) =>
    setState((prev) => {
      const i = prev.tabs.findIndex((x) => x.id === prev.activeTabId);
      const j = (i + delta + prev.tabs.length) % prev.tabs.length;
      return { ...prev, activeTabId: prev.tabs[j].id };
    });

  const gotoTab = (i: number) =>
    setState((prev) =>
      prev.tabs[i] ? { ...prev, activeTabId: prev.tabs[i].id } : prev,
    );

  // Clear a pane's "agent finished" glow (idea #6). Called whenever the pane
  // becomes the one you're actually looking at — by click, keyboard nav, tab
  // switch or refocusing the app — mirroring kitty's focus_changed() clear.
  const clearActivity = (paneId: string) => {
    setActivity((prev) => {
      if (!prev.has(paneId)) return prev;
      const n = new Set(prev);
      n.delete(paneId);
      return n;
    });
  };

  const setFocus = (paneId: string) => {
    updateActiveTab((t) => ({ ...t, focused: paneId }));
    clearActivity(paneId);
  };

  // The active pane (active tab + its focused pane) clears its glow as soon as
  // you're looking at it, whatever got you there — keyboard nav, tab switch, or
  // a plain click. Gated on document.hasFocus() so the glow survives while the
  // app is in the background (kitty's focus_changed only fires when focused).
  const activePane = state.tabs.find((t) => t.id === state.activeTabId)?.focused;
  useEffect(() => {
    if (!activePane || !document.hasFocus()) return;
    clearActivity(activePane);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePane, state.activeTabId]);

  // Coming back to the app (⌘Tab, Quake ⌃`, clicking the window) while the
  // active pane is already glowing also counts as "looking at it".
  useEffect(() => {
    const onWinFocus = () => {
      const s = stateRef.current;
      const p = s.tabs.find((x) => x.id === s.activeTabId)?.focused;
      if (p) clearActivity(p);
    };
    window.addEventListener("focus", onWinFocus);
    return () => window.removeEventListener("focus", onWinFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Open the file picker (⌘P) on the focused pane's working directory (idea #15).
  const openFilePicker = async () => {
    const cwd = (await sourceCwd()) ?? null;
    setFilePicker({ cwd });
  };

  // Insert a picked file path into the focused pane (bracketed paste).
  const insertPath = (path: string) => {
    const s = stateRef.current;
    const paneId = s.tabs.find((t) => t.id === s.activeTabId)?.focused;
    if (paneId) injectPaths(paneId, [path]);
  };

  // Send free text (scratchpad / composer) to the focused pane as one bracketed
  // paste, so a multi-line prompt reaches `claude` as a single block (ideas #20/#16).
  const sendToPane = (text: string) => {
    if (!text) return;
    const s = stateRef.current;
    const paneId = s.tabs.find((t) => t.id === s.activeTabId)?.focused;
    if (paneId)
      invoke("pty_write", { id: paneId, data: `\x1b[200~${text}\x1b[201~` });
  };

  // Quake submit (idea #19): send the prompt to the chosen tab's focused pane
  // AND run it (trailing \r), switch to that tab, remember it as the default
  // for next time, and re-hide the window so Claude works in the background.
  const submitQuake = (text: string) => {
    const tabId = quakeTab;
    lastQuakeTabRef.current = tabId;
    const s = stateRef.current;
    const paneId = s.tabs.find((t) => t.id === tabId)?.focused;
    if (paneId)
      invoke("pty_write", { id: paneId, data: `\x1b[200~${text}\x1b[201~\r` });
    setState((prev) =>
      prev.tabs.some((t) => t.id === tabId)
        ? { ...prev, activeTabId: tabId }
        : prev,
    );
    setQuakeOpen(false);
    getCurrentWindow().hide();
  };
  const closeQuake = () => {
    setQuakeOpen(false);
    getCurrentWindow().hide();
  };

  // A pane rang its bell (Claude finished / awaits input). Badge it + fire a
  // macOS notification, unless the user is already watching it (it's the active
  // tab's focused pane and the window is focused). #6.
  const handleBell = (paneId: string) => {
    const s = stateRef.current;
    const t = s.tabs.find((x) => x.id === s.activeTabId);
    if (t?.focused === paneId && document.hasFocus()) return;
    setActivity((prev) => {
      if (prev.has(paneId)) return prev;
      const n = new Set(prev);
      n.add(paneId);
      return n;
    });
    // Audible cue (idea #6) — independent of the macOS notification toggle.
    if (settings.notifySound) {
      invoke("play_sound", { name: "Submarine" }).catch(() => {});
    }
    if (!settings.notify) return;
    const idx = s.tabs.findIndex((x) => x.panes.includes(paneId));
    invoke("notify", {
      title: "superkitty",
      body: `Un agent a terminé — ${idx >= 0 ? `onglet ${idx + 1}` : "une fenêtre"}`,
    }).catch(() => {});
  };

  // ---- session sidebar operations (idea #2) ----

  const refreshSessions = async () => {
    try {
      setTmuxSessions(await invoke<TmuxSession[]>("tmux_list_sessions"));
    } catch {
      setTmuxSessions([]);
    }
  };

  const toggleSidebar = () => setSidebarOpen((o) => !o);

  // ---- Zoom du texte (idée #23) : ⌘+/⌘-/⌘0 ----
  // Réutilise le réglage global `fontSize` (mêmes bornes que loadSettings/FontPane,
  // 8–32). setSettings déclenche la persistance + l'application live dans chaque pane.
  const FONT_MIN = 8;
  const FONT_MAX = 32;
  const zoomFont = (d: number) =>
    setSettings((s) => ({
      ...s,
      fontSize: Math.min(FONT_MAX, Math.max(FONT_MIN, s.fontSize + d)),
    }));
  const resetFont = () =>
    setSettings((s) => ({ ...s, fontSize: DEFAULT_SETTINGS.fontSize }));

  // Locate the pane (if any) currently driving a given tmux session name.
  const paneForSession = (
    s: AppState,
    name: string,
  ): { tabId: string; pid: string } | null => {
    for (const t of s.tabs) {
      for (const pid of t.panes) {
        if (sessionNameOf(s, pid) === name) return { tabId: t.id, pid };
      }
    }
    return null;
  };

  // Insert a pane id after the focused pane of the active tab and focus it.
  const insertPaneIntoActive = (prev: AppState, pid: string): Tab[] =>
    prev.tabs.map((t) => {
      if (t.id !== prev.activeTabId) return t;
      const i = t.panes.indexOf(t.focused);
      const panes = [...t.panes];
      panes.splice(i < 0 ? panes.length : i + 1, 0, pid);
      return { ...t, panes, focused: pid };
    });

  // Attach a tmux session from the sidebar into a pane. If it's already open,
  // just switch to it. `superkitty-<id>` sessions reattach by reusing their pane
  // id (persists naturally); external/raw sessions get a fresh pane id mapped to
  // their name in `sessions`.
  const openSession = (name: string) => {
    const s = stateRef.current;
    const existing = paneForSession(s, name);
    if (existing) {
      setState((prev) => ({
        ...prev,
        activeTabId: existing.tabId,
        tabs: prev.tabs.map((t) =>
          t.id === existing.tabId ? { ...t, focused: existing.pid } : t,
        ),
      }));
      return;
    }

    if (name.startsWith(SK_PREFIX)) {
      const pid = name.slice(SK_PREFIX.length);
      // Guard the rare case where that pane id is already in use for something
      // else (e.g. adopted under a raw name) — don't duplicate the id.
      if (s.tabs.some((t) => t.panes.includes(pid))) return;
      const n = parseInt(pid.replace(/\D/g, ""), 10);
      if (!Number.isNaN(n)) _seq = Math.max(_seq, n);
      setState((prev) => ({ ...prev, tabs: insertPaneIntoActive(prev, pid) }));
    } else {
      const pid = newId("p");
      setState((prev) => ({
        ...prev,
        tabs: insertPaneIntoActive(prev, pid),
        sessions: { ...prev.sessions, [pid]: name },
      }));
    }
  };

  // Remove a pane from whatever tab holds it (its Terminal unmounts → pty_detach,
  // harmless once the session is already dead). Drops the tab if it empties out.
  const removePane = (tabId: string, pid: string) =>
    setState((prev) => {
      const t = prev.tabs.find((x) => x.id === tabId);
      if (!t || !t.panes.includes(pid)) return prev;
      const sessions = { ...prev.sessions };
      delete sessions[pid];
      const i = t.panes.indexOf(pid);
      const panes = t.panes.filter((id) => id !== pid);
      if (panes.length) {
        const focused =
          t.focused === pid ? panes[Math.min(i, panes.length - 1)] : t.focused;
        return {
          ...prev,
          sessions,
          tabs: prev.tabs.map((x) =>
            x.id === t.id ? { ...x, panes, focused } : x,
          ),
        };
      }
      const remaining = prev.tabs.filter((x) => x.id !== t.id);
      if (remaining.length === 0)
        return { ...makeInitialState(), closed: prev.closed };
      const idx = prev.tabs.findIndex((x) => x.id === t.id);
      const next = remaining[Math.min(idx, remaining.length - 1)];
      return {
        tabs: remaining,
        activeTabId: next.id,
        sessions,
        closed: prev.closed,
      };
    });

  // Kill a tmux session from the sidebar, and drop its pane if it's open here.
  const killSession = async (name: string) => {
    const existing = paneForSession(stateRef.current, name);
    if (existing) removePane(existing.tabId, existing.pid);
    try {
      await invoke("tmux_kill_session", { name });
    } catch {
      /* already gone */
    }
    refreshSessions();
  };

  // ---- "agent running" close confirmation (idea #13) ----
  const cancelKill = () => setPendingKill(null);
  const confirmKill = () => {
    const p = pendingKillRef.current;
    if (!p) return;
    setPendingKill(null);
    killTab(p.tabId, p.snapshot);
  };
  const confirmDetach = () => {
    const p = pendingKillRef.current;
    if (!p) return;
    setPendingKill(null);
    detachTab(p.tabId, p.snapshot);
  };

  // ---- kitty-style keyboard shortcuts (macOS defaults) ----
  useEffect(() => {
    const done = (e: KeyboardEvent, action: () => void) => {
      e.preventDefault();
      e.stopPropagation();
      action();
    };

    // Action id → handler. Mirrors the metadata in shortcuts.ts (which owns the
    // labels + default chords). Captured once at mount like the rest of this
    // effect; the chord→id lookup (lookupRef) is what changes when the user
    // rebinds. The three overlay toggles (palette/settings/file-picker) are
    // handled specially inside onKeyDown so they work even while open.
    const actions: Record<string, () => void> = {
      "new-tab": newTab,
      "close-tab": closeTab,
      reopen: reopenClosed,
      "next-tab": () => cycleTab(1),
      "prev-tab": () => cycleTab(-1),
      "new-window": addWindow,
      "close-window": closeFocused,
      zoom: toggleZoom,
      promote: promoteToMain,
      "next-window": () => focusSibling(1),
      "prev-window": () => focusSibling(-1),
      "move-forward": () => moveInList(1),
      "move-backward": () => moveInList(-1),
      "focus-left": () => focusDirection("left"),
      "focus-right": () => focusDirection("right"),
      "focus-up": () => focusDirection("up"),
      "focus-down": () => focusDirection("down"),
      "move-left": () => moveDirection("left"),
      "move-right": () => moveDirection("right"),
      "move-up": () => moveDirection("up"),
      "move-down": () => moveDirection("down"),
      "next-layout": () => cycleLayout(1),
      "scroll-line-up": () => scrollPane("line-up"),
      "scroll-line-down": () => scrollPane("line-down"),
      "scroll-page-up": () => scrollPane("page-up"),
      "scroll-page-down": () => scrollPane("page-down"),
      "scroll-top": () => scrollPane("top"),
      "scroll-bottom": () => scrollPane("bottom"),
      "scroll-prompt-prev": () => scrollPane("prompt-prev"),
      "scroll-prompt-next": () => scrollPane("prompt-next"),
      sidebar: toggleSidebar,
      composer: () => setComposerOpen((o) => !o),
      scratchpad: () => setScratchpadOpen((o) => !o),
    };
    for (let n = 1; n <= 9; n++) {
      actions[`goto-tab-${n}`] = () => gotoTab(n - 1);
    }

    const onKeyDown = (e: KeyboardEvent) => {
      // While the "agent running" confirmation is open, it owns the keyboard:
      // Esc cancels, Enter detaches (the safe default), everything else is
      // swallowed so no shortcut fires behind the modal (idea #13).
      if (pendingKillRef.current) {
        if (e.key === "Escape") return done(e, cancelKill);
        if (e.key === "Enter") return done(e, confirmDetach);
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // While renaming a tab inline, its input owns the keyboard.
      if (renamingRef.current) return;

      // Canonical chord for this event (null without ⌃/⌥/⌘ → never a shortcut,
      // so terminal keystrokes pass through). Resolve it to an action id via the
      // live, reassignable lookup (lookupRef).
      const chord = chordFromEvent(e);
      const id = chord ? lookupRef.current.get(chord) : undefined;

      // The three overlay toggles own their chord even while the overlay is
      // open (so the same combo closes it). Each is followed by its existing
      // "owns the keyboard while open" bail.
      if (id === "palette") {
        return done(e, () =>
          setPaletteOpen((o) => {
            if (!o) refreshSessions();
            return !o;
          }),
        );
      }
      if (paletteOpenRef.current) return;

      if (id === "settings") {
        return done(e, () => setSettingsOpen((o) => !o));
      }
      if (settingsOpenRef.current) return;

      if (id === "file-picker") {
        return done(e, () => openFilePicker());
      }
      if (filePickerOpenRef.current) return;

      // When focus is in one of our own text fields (composer, scratchpad, Quake)
      // — anything but the terminal's hidden textarea — let it handle its keys.
      // Placed AFTER the toggles above so those still close their own overlay
      // (whose input holds focus).
      const ae = document.activeElement as HTMLElement | null;
      if (
        ae &&
        (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA") &&
        !ae.closest(".xterm")
      ) {
        return;
      }

      // Text zoom (idea #23) is matched by CHARACTER (e.key), not physical key
      // (e.code), so it works on AZERTY and QWERTY alike: the "-"/"=" keys sit at
      // different physical positions per layout (on a French Mac the "-" key is
      // at code "Equal"), which is why an e.code binding zoomed the wrong way.
      // ⌘+/⌘= enlarge, ⌘-/⌘_ shrink, ⌘0 resets. ⌘0 uses e.code (digit row needs
      // Shift on AZERTY), consistent with ⌘1–9 tab navigation.
      if (e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.key === "+" || e.key === "=") return done(e, () => zoomFont(1));
        if (e.key === "-" || e.key === "_") return done(e, () => zoomFont(-1));
        if (e.code === "Digit0") return done(e, resetFont);
      }

      // Everything else is dispatched through the (reassignable) binding table.
      // An unbound chord falls through without preventDefault, so the terminal
      // still receives it.
      if (id) {
        const run = actions[id];
        if (run) return done(e, run);
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
    // Bound once; handlers only call the stable setState / read the DOM.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- file drag & drop → inject the path into the dropped-on pane ----
  // Lets you drag a macOS screenshot thumbnail (or any file) onto a pane: its
  // path is typed at that pane's prompt so `claude` can read the image.
  useEffect(() => {
    // Map a webview drop position (physical px) to the pane under the cursor,
    // falling back to the active tab's focused pane.
    const paneAt = (pos: { x: number; y: number }): string | null => {
      // wry reports the drop position in logical (CSS) pixels on macOS — exactly
      // what elementFromPoint expects, so use it as-is. Fall back to the
      // DPR-scaled point only if that misses (in case a platform reports
      // physical pixels instead).
      const hit = (x: number, y: number): string | null => {
        if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight)
          return null;
        const slot = (
          document.elementFromPoint(x, y) as HTMLElement | null
        )?.closest("[data-pane-id]") as HTMLElement | null;
        return slot?.dataset.paneId ?? null;
      };
      const dpr = window.devicePixelRatio || 1;
      const id = hit(pos.x, pos.y) ?? hit(pos.x / dpr, pos.y / dpr);
      if (id) return id;
      const s = stateRef.current;
      return s.tabs.find((t) => t.id === s.activeTabId)?.focused ?? null;
    };

    let disposed = false;
    const un = getCurrentWebview().onDragDropEvent((e) => {
      const p = e.payload;
      if (p.type === "over") {
        setDropTargetId(paneAt(p.position));
      } else if (p.type === "leave") {
        setDropTargetId(null);
      } else if (p.type === "drop") {
        setDropTargetId(null);
        if (!p.paths.length) return;
        const paneId = paneAt(p.position);
        if (!paneId) return;
        setFocus(paneId);
        // Inject the dropped paths as one bracketed paste (idea #4/#15).
        injectPaths(paneId, p.paths);
      }
    });

    return () => {
      disposed = true;
      un.then((f) => {
        if (disposed) f();
      });
    };
    // Bound once; reads live state via stateRef, writes via stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- paste a file or image from the clipboard (⌘V) → inject path (idea #4) --
  // Two cases, in priority order:
  //  1. A real file copied in Finder (⌘C) — the webview only exposes an *image
  //     preview* of it, so we ask the backend for the actual file URLs on the
  //     native pasteboard (`clipboard_file_paths`) and inject those real paths.
  //  2. A pasted screenshot — no file path, so we save its bytes to
  //     ~/.superkitty/dropped/ and inject that path like a drop.
  // Plain-text pastes fall through to the terminal untouched.
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      // Let our own text fields (composer/scratchpad) handle their own paste.
      const ae = document.activeElement as HTMLElement | null;
      if (
        ae &&
        (ae.tagName === "TEXTAREA" || ae.tagName === "INPUT") &&
        !ae.closest(".xterm")
      )
        return;
      const dt = e.clipboardData;
      if (!dt) return;
      // A Finder file/folder copy shows up as a "Files" type (and/or a File item)
      // on the clipboard, even though the only readable preview is an image/icon.
      // Detect *any* file item — not just image ones — so a copied folder or
      // non-image file isn't mistaken for a screenshot and saved as an image.
      const items = Array.from(dt.items || []);
      const hasFiles =
        Array.from(dt.types || []).includes("Files") ||
        (dt.files && dt.files.length > 0) ||
        items.some((it) => it.kind === "file");
      const img = items.find((it) => it.type.startsWith("image/"));
      if (!hasFiles && !img) return; // plain text → terminal
      // We're handling this paste ourselves. preventDefault stops the browser
      // insertion; stopImmediatePropagation stops xterm's OWN paste handler from
      // ALSO reading the clipboard and injecting it (that double-paste made a
      // single pasted image show up twice). Both must run synchronously, before
      // any await.
      e.preventDefault();
      e.stopImmediatePropagation();
      const s = stateRef.current;
      const paneId = s.tabs.find((t) => t.id === s.activeTabId)?.focused;
      if (!paneId) return;
      // Prefer real file paths off the native pasteboard (a copied file beats
      // its image preview).
      let nativePaths: string[] = [];
      try {
        nativePaths = await invoke<string[]>("clipboard_file_paths");
      } catch (err) {
        // Surface the failure instead of silently treating it as "no file" — a
        // thrown command must not be indistinguishable from an empty clipboard.
        console.error("clipboard_file_paths failed", err);
        nativePaths = [];
      }
      if (nativePaths.length) {
        injectPaths(paneId, nativePaths);
        return;
      }
      // No real file (e.g. a screenshot): save the image bytes and inject those.
      if (!img) return;
      const blob = img.getAsFile();
      if (!blob) return;
      const path = await saveImageBlob(blob);
      if (path) injectPaths(paneId, [path]);
    };
    window.addEventListener("paste", onPaste, true);
    return () => window.removeEventListener("paste", onPaste, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pop the Quake quick-prompt when the global hotkey summons the window (#19).
  useEffect(() => {
    let un: (() => void) | undefined;
    let disposed = false;
    listen("quake://shown", () => {
      const s = stateRef.current;
      const last = lastQuakeTabRef.current;
      const def =
        last && s.tabs.some((t) => t.id === last) ? last : s.activeTabId;
      setQuakeTab(def);
      setQuakeOpen(true);
    }).then((f) => {
      if (disposed) f();
      else un = f;
    });
    return () => {
      disposed = true;
      un?.();
    };
  }, []);

  // Repaint every live pane when the window comes back to the foreground.
  // While hidden (Quake ⌃` / minimized / another Space) the webview throttles
  // requestAnimationFrame, so xterm can be left showing a stale/blank frame with
  // nothing to repaint it on return. A tmux refresh-client re-sends the full
  // screen, curing the "frozen black pane" after a show. Best-effort + cheap.
  useEffect(() => {
    const redrawAll = () => {
      for (const t of stateRef.current.tabs)
        for (const pid of t.panes)
          invoke("pty_redraw", { id: pid }).catch(() => {});
    };
    let un: (() => void) | undefined;
    let unShown: (() => void) | undefined;
    let disposed = false;
    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) redrawAll();
      })
      .then((f) => (disposed ? f() : (un = f)));
    listen("quake://shown", redrawAll).then((f) =>
      disposed ? f() : (unShown = f),
    );
    return () => {
      disposed = true;
      un?.();
      unShown?.();
    };
  }, []);

  const activeTab =
    state.tabs.find((t) => t.id === state.activeTabId) ?? state.tabs[0];
  const termTheme = themeOf(settings);

  // The "agent finished" glow (idea #6) is cleared only by clicking the pane
  // (see setFocus) — bringing the window forward must NOT silently dismiss it,
  // so there is deliberately no clear-on-window-focus effect here.

  // Tab name/tint helpers (idea #17): manual title → project folder → number;
  // tint hashed from the cwd so a repo always reads the same colour.
  const tabLabel = (t: Tab): string | null => {
    if (t.title) return t.title;
    const cwd = tabCwd[t.id];
    return cwd ? basename(cwd) : null;
  };
  const tabTint = (t: Tab): string | undefined => {
    // Manual colour wins; otherwise fall back to the cwd hash (legacy tabs).
    if (t.color) return t.color;
    const cwd = tabCwd[t.id];
    return cwd ? autoTint(cwd) : undefined;
  };
  const setTabColor = (tabId: string, color: string | undefined) =>
    setState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) => (t.id === tabId ? { ...t, color } : t)),
    }));
  const commitRename = (tabId: string, value: string) => {
    const title = value.trim();
    setState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) =>
        t.id === tabId ? { ...t, title: title || undefined } : t,
      ),
    }));
    setRenamingTabId(null);
  };

  // Flat list of every action for the command palette (idea #12). Rebuilt each
  // render (cheap) so tmux sessions and layouts stay current; only consumed
  // while the palette is open.
  const paletteCommands: Command[] = [
    { id: "new-tab", group: "Onglet", title: "Nouvel onglet", hint: "⌘T", run: newTab },
    { id: "rename-tab", group: "Onglet", title: "Renommer l'onglet actif", keywords: "nom titre", run: () => setRenamingTabId(stateRef.current.activeTabId) },
    { id: "close-tab", group: "Onglet", title: "Fermer l'onglet", hint: "⌘W", run: closeTab },
    { id: "reopen", group: "Onglet", title: "Rouvrir le dernier fermé", keywords: "undo", hint: "⌘⇧T", run: reopenClosed },
    ...state.tabs.map((t, i) => ({
      id: `goto-tab:${t.id}`,
      group: "Onglet",
      title: `Aller à l'onglet ${i + 1}${tabLabel(t) ? ` — ${tabLabel(t)}` : ""}`,
      keywords: `onglet tab ${i + 1} ${tabLabel(t) ?? ""}`,
      hint: i < 9 ? `⌘${i + 1}` : undefined,
      run: () => gotoTab(i),
    })),
    { id: "new-window", group: "Fenêtre", title: "Nouvelle fenêtre (pane)", hint: "⌘D", run: addWindow },
    { id: "close-window", group: "Fenêtre", title: "Fermer la fenêtre", hint: "⌃⇧W", run: closeFocused },
    { id: "zoom", group: "Fenêtre", title: "Agrandir / réduire (zoom)", keywords: "maximize plein écran stack", hint: "⌃⇧Z", run: toggleZoom },
    { id: "promote", group: "Fenêtre", title: "Promouvoir en fenêtre principale", keywords: "main top", hint: "⌃⇧`", run: promoteToMain },
    { id: "new-sandboxed", group: "Fenêtre", title: "Nouvelle fenêtre sandboxée (écriture confinée)", keywords: "sandbox sécurité seatbelt confiné", run: () => addSandboxedWindow() },
    { id: "next-layout", group: "Disposition", title: "Disposition suivante", hint: "⌃⇧L", run: () => cycleLayout(1) },
    ...LAYOUT_CYCLE.map((name) => ({
      id: `layout:${name}`,
      group: "Disposition",
      title: `Passer en « ${LAYOUT_LABEL[name]} »`,
      keywords: name,
      run: () => setLayout(name),
    })),
    { id: "zoom-in", group: "Affichage", title: "Agrandir le texte", keywords: "zoom police taille font agrandir", hint: "⌘+", run: () => zoomFont(1) },
    { id: "zoom-out", group: "Affichage", title: "Réduire le texte", keywords: "zoom police taille font réduire", hint: "⌘-", run: () => zoomFont(-1) },
    { id: "zoom-reset", group: "Affichage", title: "Taille du texte par défaut", keywords: "zoom police taille font reset défaut", hint: "⌘0", run: resetFont },
    { id: "sidebar", group: "Sessions", title: "Afficher / masquer les sessions tmux", hint: "⌘B", run: toggleSidebar },
    { id: "settings", group: "Général", title: "Réglages (thème, police…)", hint: "⌘,", run: () => setSettingsOpen(true) },
    { id: "file-picker", group: "Fichier", title: "Insérer un chemin de fichier…", keywords: "@ mention path fichier", hint: "⌘P", run: () => openFilePicker() },
    { id: "scratchpad", group: "Général", title: "Bloc-notes de l'onglet", keywords: "notes todo scratchpad", hint: "⌃⇧N", run: () => setScratchpadOpen(true) },
    { id: "composer", group: "Général", title: "Composer un prompt (multi-lignes)", keywords: "prompt composer editor envoyer", hint: "⌘E", run: () => setComposerOpen(true) },
    { id: "scroll-top", group: "Défilement", title: "Aller en haut du scrollback", hint: "⌃⇧Home", run: () => scrollPane("top") },
    { id: "scroll-page-up", group: "Défilement", title: "Défiler d'une page vers le haut", keywords: "page haut scroll", hint: "⌃⇧PgUp", run: () => scrollPane("page-up") },
    { id: "scroll-line-up", group: "Défilement", title: "Défiler d'une ligne vers le haut", keywords: "ligne haut scroll", hint: "⌃⇧↑", run: () => scrollPane("line-up") },
    { id: "scroll-prompt-prev", group: "Défilement", title: "Prompt précédent (OSC 133)", keywords: "prompt précédent saut", hint: "⌥⌘↑", run: () => scrollPane("prompt-prev") },
    { id: "scroll-prompt-next", group: "Défilement", title: "Prompt suivant (OSC 133)", keywords: "prompt suivant saut", hint: "⌥⌘↓", run: () => scrollPane("prompt-next") },
    { id: "scroll-line-down", group: "Défilement", title: "Défiler d'une ligne vers le bas", keywords: "ligne bas scroll", hint: "⌃⇧↓", run: () => scrollPane("line-down") },
    { id: "scroll-page-down", group: "Défilement", title: "Défiler d'une page vers le bas", keywords: "page bas scroll", hint: "⌃⇧PgDn", run: () => scrollPane("page-down") },
    { id: "scroll-bottom", group: "Défilement", title: "Revenir au prompt (bas)", hint: "⌃⇧End", run: () => scrollPane("bottom") },
    ...tmuxSessions.map((s) => ({
      id: `session:${s.name}`,
      group: "Session tmux",
      title: `Attacher : ${s.superkitty ? s.name.slice(SK_PREFIX.length) : s.name}`,
      keywords: s.name,
      run: () => openSession(s.name),
    })),
  ];

  // Curated subset for the right-click menu (idea #11). Right-clicking a pane
  // focuses it first, so these act on the intended target.
  const contextCommands: Command[] = [
    { id: "m-new-window", title: "Nouvelle fenêtre", hint: "⌘D", run: addWindow },
    { id: "m-sandbox", title: "Nouvelle fenêtre sandboxée", run: () => addSandboxedWindow() },
    { id: "m-new-tab", title: "Nouvel onglet", hint: "⌘T", run: newTab },
    { id: "m-zoom", title: "Agrandir / réduire", hint: "⌃⇧Z", run: toggleZoom },
    { id: "m-promote", title: "Fenêtre principale", hint: "⌃⇧`", run: promoteToMain },
    { id: "m-next-layout", title: "Disposition suivante", hint: "⌃⇧L", run: () => cycleLayout(1) },
    { id: "m-close-window", title: "Fermer la fenêtre", hint: "⌃⇧W", run: closeFocused },
    { id: "m-close-tab", title: "Fermer l'onglet", hint: "⌘W", run: closeTab },
    { id: "m-reopen", title: "Rouvrir le dernier fermé", hint: "⌘⇧T", run: reopenClosed },
    {
      id: "m-palette",
      title: "Toutes les commandes…",
      hint: "⌘K",
      run: () => {
        refreshSessions();
        setPaletteOpen(true);
      },
    },
  ];

  return (
    <div className="app">
      <div className="titlebar">
        <Logo className="titlebar-logo" size={20} />
        <div className="tabs">
          {state.tabs.map((t, i) => {
            if (renamingTabId === t.id) {
              return (
                <input
                  key={t.id}
                  className="tab tab-rename"
                  autoFocus
                  defaultValue={tabLabel(t) ?? ""}
                  placeholder={`Onglet ${i + 1}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter")
                      commitRename(t.id, (e.target as HTMLInputElement).value);
                    else if (e.key === "Escape") setRenamingTabId(null);
                  }}
                  onBlur={(e) => commitRename(t.id, e.target.value)}
                />
              );
            }
            const label = tabLabel(t);
            const tint = tabTint(t);
            return (
              <button
                key={t.id}
                className={`tab${t.id === state.activeTabId ? " active" : ""}${
                  t.panes.some((p) => activity.has(p)) ? " has-activity" : ""
                }`}
                onClick={() => gotoTab(i)}
                onDoubleClick={() => setRenamingTabId(t.id)}
                onContextMenu={(e) => {
                  // Right-click a tab → colour picker (idea #17).
                  e.preventDefault();
                  setColorMenu({ tabId: t.id, x: e.clientX, y: e.clientY });
                }}
                title={
                  i < 9
                    ? `${label ?? `Onglet ${i + 1}`} — ⌘${i + 1} (double-clic pour renommer)`
                    : label ?? `Onglet ${i + 1}`
                }
              >
                {tint && (
                  <span className="tab-color" style={{ background: tint }} />
                )}
                <span className="tab-num">{i + 1}</span>
                {label && <span className="tab-name">{label}</span>}
                <span
                  className="tab-close"
                  role="button"
                  aria-label="Fermer l'onglet"
                  title="Fermer l'onglet (⌘W)"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTabById(t.id);
                  }}
                >
                  ✕
                </span>
              </button>
            );
          })}
          <button className="tab tab-new" onClick={newTab} title="New tab (⌘T)">
            +
          </button>
        </div>
        <div className="drag-spacer" data-tauri-drag-region />
        <div className="titlebar-actions">
          {activeTab && (
            <LayoutPicker
              current={activeTab.layout}
              paneCount={activeTab.panes.length}
              focusedIndex={Math.max(0, activeTab.panes.indexOf(activeTab.focused))}
              onPick={setLayout}
            />
          )}
          <button
            className={`tab${settingsOpen ? " active" : ""}`}
            onClick={() => setSettingsOpen(true)}
            title="Réglages (⌘,)"
          >
            ⚙
          </button>
          <button
            className={`tab${sidebarOpen ? " active" : ""}`}
            onClick={toggleSidebar}
            title="Sessions tmux (⌘B)"
          >
            ☰
          </button>
          <button
            className="titlebar-brand"
            onClick={() => {
              refreshSessions();
              setPaletteOpen(true);
            }}
            title="superkitty — toutes les commandes (⌘K)"
          >
            superkitty
          </button>
        </div>
      </div>
      <div className="body">
        <Scratchpad
          open={scratchpadOpen}
          value={notes[state.activeTabId] ?? ""}
          onChange={(v) =>
            setNotes((n) => ({ ...n, [state.activeTabId]: v }))
          }
          onSend={() => sendToPane(notes[state.activeTabId] ?? "")}
          onClose={() => setScratchpadOpen(false)}
        />
      <div
        className="workspace"
        onContextMenu={(e) => {
          // Right-click focuses the pane under the cursor, then opens the menu
          // so its actions target that pane (idea #11).
          const slot = (e.target as HTMLElement).closest(
            "[data-pane-id]",
          ) as HTMLElement | null;
          if (slot?.dataset.paneId) setFocus(slot.dataset.paneId);
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        {state.tabs.map((t) => {
          const focusedIndex = Math.max(0, t.panes.indexOf(t.focused));
          // Zoom forces the stack layout (focused pane only) without losing the
          // tab's real layout (⌃⇧Z / per-pane ⛶ button).
          const rects = layoutRects(
            t.zoomed ? "stack" : t.layout,
            t.panes.length,
            focusedIndex,
          );
          return (
            <div
              key={t.id}
              className="tab-root"
              style={
                {
                  display: t.id === state.activeTabId ? "block" : "none",
                  // Per-project tint for the focused pane's border (idea #17).
                  "--pane-accent": tabTint(t),
                } as React.CSSProperties
              }
            >
              {t.panes.map((id, i) => {
                const r = rects[i];
                const hidden = r.w === 0 || r.h === 0;
                return (
                  <div
                    key={id}
                    className={`pane-slot${
                      id === dropTargetId ? " dropTarget" : ""
                    }${activity.has(id) ? " finished" : ""}`}
                    style={{
                      left: `${r.x * 100}%`,
                      top: `${r.y * 100}%`,
                      width: `${r.w * 100}%`,
                      height: `${r.h * 100}%`,
                      display: hidden ? "none" : "block",
                    }}
                  >
                    <TerminalView
                      id={id}
                      active={t.id === state.activeTabId && id === t.focused}
                      onFocus={() => setFocus(id)}
                      onBell={() => handleBell(id)}
                      cwd={spawnCwdRef.current[id]}
                      session={state.sessions[id]}
                      sandbox={!!sandboxed[id]}
                      theme={termTheme}
                      fontFamily={settings.fontFamily}
                      fontSize={settings.fontSize}
                    />
                    {sandboxed[id] && (
                      <span
                        className="pane-sandbox"
                        title="Sandbox — écriture confinée au dossier du projet (idée #5)"
                      >
                        🔒
                      </span>
                    )}
                    {t.panes.length > 1 && (
                      <button
                        className="pane-zoom"
                        title={
                          t.zoomed
                            ? "Réduire la fenêtre (⌘⇧↵)"
                            : "Agrandir la fenêtre (⌘⇧↵)"
                        }
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          zoomPane(id);
                        }}
                      >
                        {t.zoomed ? "🗗" : "⛶"}
                      </button>
                    )}
                    <button
                      className="pane-close"
                      title="Fermer la fenêtre (⌃⇧W)"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        closePane(id);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
        <SessionSidebar
          open={sidebarOpen}
          sessions={tmuxSessions}
          openNames={
            new Set(
              state.tabs.flatMap((t) =>
                t.panes.map((pid) => sessionNameOf(state, pid)),
              ),
            )
          }
          onOpenSession={openSession}
          onKillSession={killSession}
          onRefresh={refreshSessions}
          onClose={() => setSidebarOpen(false)}
        />
      </div>

      <StatusBar
        sandbox={!!(activeTab && sandboxed[activeTab.focused])}
        onOpenPalette={() => {
          refreshSessions();
          setPaletteOpen(true);
        }}
      />

      {paletteOpen && (
        <CommandPalette
          commands={paletteCommands}
          onClose={() => setPaletteOpen(false)}
        />
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          commands={contextCommands}
          onClose={() => setMenu(null)}
        />
      )}

      {colorMenu && (
        <TabColorPicker
          x={colorMenu.x}
          y={colorMenu.y}
          current={state.tabs.find((t) => t.id === colorMenu.tabId)?.color}
          onPick={(c) => setTabColor(colorMenu.tabId, c)}
          onReset={() => setTabColor(colorMenu.tabId, undefined)}
          onClose={() => setColorMenu(null)}
        />
      )}

      {settingsOpen && (
        <Settings
          settings={settings}
          onChange={setSettings}
          bindings={bindings}
          onChangeBindings={setBindings}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {filePicker && (
        <FilePicker
          cwd={filePicker.cwd}
          onPick={insertPath}
          onClose={() => setFilePicker(null)}
        />
      )}

      {composerOpen && (
        <PromptComposer
          onSend={(text) => {
            sendToPane(text);
            setComposerOpen(false);
          }}
          onClose={() => setComposerOpen(false)}
          saveImage={saveImageBlob}
        />
      )}

      {quakeOpen && (
        <QuickPrompt
          tabs={state.tabs.map((t, i) => ({
            id: t.id,
            label: tabLabel(t) ?? `Onglet ${i + 1}`,
            tint: tabTint(t),
          }))}
          selected={quakeTab}
          onSelect={setQuakeTab}
          onSubmit={submitQuake}
          onClose={closeQuake}
        />
      )}

      {pendingKill && (
        <div className="modal-backdrop" onMouseDown={cancelKill}>
          <div
            className="modal"
            role="alertdialog"
            aria-modal="true"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 className="modal-title">Un agent tourne dans cet onglet</h2>
            <p className="modal-body">
              {pendingKill.busy.length === 1 ? (
                <>
                  <code>{pendingKill.busy[0]}</code> est en cours d'exécution.
                </>
              ) : (
                <>
                  {pendingKill.busy.length} processus tournent (
                  {pendingKill.busy.map((c, i) => (
                    <span key={i}>
                      {i > 0 && ", "}
                      <code>{c}</code>
                    </span>
                  ))}
                  ).
                </>
              )}{" "}
              Le fermer tuera sa session tmux.
            </p>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={cancelKill}>
                Annuler <kbd>Esc</kbd>
              </button>
              <button className="btn btn-danger" onClick={confirmKill}>
                Fermer quand même
              </button>
              <button className="btn btn-primary" onClick={confirmDetach}>
                Détacher (garder en vie) <kbd>↵</kbd>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
