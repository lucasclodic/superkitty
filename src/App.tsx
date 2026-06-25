import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { TerminalView } from "./Terminal";
import {
  Direction,
  LayoutName,
  isLayoutName,
  layoutRects,
  neighbor,
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
}

interface AppState {
  tabs: Tab[];
  activeTabId: string;
}

// Monotonic id source. tmux session names derive from pane ids, so they must be
// unique within a run; reusing one would attach to the wrong session.
let _seq = 0;
const newId = (prefix: string) => `${prefix}${++_seq}`;

function makeInitialState(): AppState {
  const pid = newId("p");
  const tid = newId("t");
  return {
    tabs: [{ id: tid, panes: [pid], focused: pid, layout: "tall" }],
    activeTabId: tid,
  };
}

const STORAGE_KEY = "superkitty.layout.v1";

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
  return { id: raw.id, panes, focused, layout };
}

/** Restore the saved layout so reopening the app reattaches to the same tmux
 *  sessions (same pane ids) in the same arrangement. Falls back to a fresh
 *  single-pane tab. */
function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as { tabs?: any[]; activeTabId?: string };
      const tabs = (saved.tabs ?? [])
        .map(normalizeTab)
        .filter((t): t is Tab => t !== null);
      if (tabs.length) {
        // Reseed the id counter past every restored id so new panes/tabs never
        // collide with (and hijack the tmux session of) a restored one.
        const ids: string[] = [];
        tabs.forEach((t) => {
          ids.push(t.id, ...t.panes);
        });
        const maxNum = ids.reduce((m, id) => {
          const n = parseInt(id.replace(/\D/g, ""), 10);
          return Number.isNaN(n) ? m : Math.max(m, n);
        }, 0);
        _seq = Math.max(_seq, maxNum);

        let activeTabId = saved.activeTabId ?? tabs[0].id;
        if (!tabs.some((t) => t.id === activeTabId)) activeTabId = tabs[0].id;
        return { tabs, activeTabId };
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

  // Stack of recently closed pane ids. Their tmux sessions are kept alive
  // (detached, not killed), so ⌘⇧D can reopen the last one with its running
  // session + scrollback restored.
  const closedPanesRef = useRef<string[]>([]);

  // Persist layout on every change so a restart restores tabs/panes + their
  // tmux sessions.
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  // ---- operations (all stable: they only call setState / read the DOM) ----

  const updateActiveTab = (fn: (t: Tab) => Tab) =>
    setState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) => (t.id === prev.activeTabId ? fn(t) : t)),
    }));

  const newTab = () =>
    setState((prev) => {
      const pid = newId("p");
      const tid = newId("t");
      return {
        tabs: [
          ...prev.tabs,
          { id: tid, panes: [pid], focused: pid, layout: "tall" as LayoutName },
        ],
        activeTabId: tid,
      };
    });

  // new_window: add a pane after the focused one; the layout rebalances all of
  // them. There is no per-pane split direction (kitty has none outside `splits`).
  const addWindow = () =>
    updateActiveTab((t) => {
      const pid = newId("p");
      const i = t.panes.indexOf(t.focused);
      const panes = [...t.panes];
      panes.splice(i < 0 ? panes.length : i + 1, 0, pid);
      return { ...t, panes, focused: pid };
    });

  // Close the whole active tab (kills every pane's tmux session). ⌘W.
  const closeTab = () =>
    setState((prev) => {
      const t = prev.tabs.find((x) => x.id === prev.activeTabId);
      if (!t) return prev;
      t.panes.forEach((id) => invoke("pty_kill", { id }));
      const remaining = prev.tabs.filter((x) => x.id !== t.id);
      if (remaining.length === 0) return makeInitialState();
      const idx = prev.tabs.findIndex((x) => x.id === t.id);
      const next = remaining[Math.min(idx, remaining.length - 1)];
      return { tabs: remaining, activeTabId: next.id };
    });

  // Close only the focused pane (kills its tmux session). ⌃⇧W.
  const closeFocused = () =>
    setState((prev) => {
      const t = prev.tabs.find((x) => x.id === prev.activeTabId);
      if (!t) return prev;
      // Keep the tmux session alive: removing the pane unmounts its Terminal,
      // which calls pty_detach (not kill). Remember the id so ⌘⇧D can reopen it.
      closedPanesRef.current.push(t.focused);

      const i = t.panes.indexOf(t.focused);
      const panes = t.panes.filter((id) => id !== t.focused);
      if (panes.length) {
        const focused = panes[Math.min(i, panes.length - 1)];
        return {
          ...prev,
          tabs: prev.tabs.map((x) =>
            x.id === t.id ? { ...x, panes, focused } : x,
          ),
        };
      }

      // The tab is now empty: drop it.
      const remaining = prev.tabs.filter((x) => x.id !== t.id);
      if (remaining.length === 0) return makeInitialState();
      const idx = prev.tabs.findIndex((x) => x.id === t.id);
      const next = remaining[Math.min(idx, remaining.length - 1)];
      return { tabs: remaining, activeTabId: next.id };
    });

  // Reopen the most recently closed pane, reattaching to its still-alive tmux
  // session (running claude + scrollback restored). Falls back to a fresh pane
  // when nothing was closed. ⌘⇧D.
  const reopenPane = () => {
    const id = closedPanesRef.current.pop();
    if (!id) return addWindow();
    updateActiveTab((t) => {
      if (t.panes.includes(id)) return t; // already open — nothing to do
      const i = t.panes.indexOf(t.focused);
      const panes = [...t.panes];
      panes.splice(i < 0 ? panes.length : i + 1, 0, id);
      return { ...t, panes, focused: id };
    });
  };

  const focusSibling = (delta: 1 | -1) =>
    updateActiveTab((t) => {
      const i = t.panes.indexOf(t.focused);
      const j = (i + delta + t.panes.length) % t.panes.length;
      return { ...t, focused: t.panes[j] };
    });

  // Move focus to the spatially-neighboring pane (⌘ + arrows), kitty-style.
  const focusDirection = (dir: Direction) =>
    updateActiveTab((t) => {
      const i = Math.max(0, t.panes.indexOf(t.focused));
      const rects = layoutRects(t.layout, t.panes.length, i);
      const j = neighbor(rects, i, dir);
      return j < 0 ? t : { ...t, focused: t.panes[j] };
    });

  const cycleLayout = (delta: 1 | -1) =>
    updateActiveTab((t) => ({
      ...t,
      layout: delta === 1 ? nextLayout(t.layout) : prevLayout(t.layout),
    }));

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

  const setFocus = (paneId: string) =>
    updateActiveTab((t) => ({ ...t, focused: paneId }));

  // ---- kitty-style keyboard shortcuts (macOS defaults) ----
  useEffect(() => {
    const done = (e: KeyboardEvent, action: () => void) => {
      e.preventDefault();
      e.stopPropagation();
      action();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const { metaKey: meta, ctrlKey: ctrl, shiftKey: shift, key } = e;
      const lower = key.toLowerCase();
      const isRightBracket = key === "]" || key === "}";
      const isLeftBracket = key === "[" || key === "{";

      // kitty_mod (⌃⇧) → window/pane operations
      if (ctrl && shift && !meta) {
        if (lower === "w") return done(e, closeFocused); // close_window
        if (lower === "l") return done(e, () => cycleLayout(1)); // next_layout
        if (key === "Enter") return done(e, addWindow); // new_window
        if (isRightBracket) return done(e, () => focusSibling(1)); // next_window
        if (isLeftBracket) return done(e, () => focusSibling(-1)); // previous_window
        return;
      }

      // ⌃Tab / ⌃⇧Tab → tab navigation
      if (ctrl && !meta && key === "Tab") {
        return done(e, () => cycleTab(shift ? -1 : 1));
      }

      if (!meta) return;

      // ⌘⇧ → tab navigation + next_layout
      if (shift) {
        if (isRightBracket) return done(e, () => cycleTab(1)); // next_tab
        if (isLeftBracket) return done(e, () => cycleTab(-1)); // previous_tab
        if (lower === "w") return done(e, closeFocused); // close_window
        if (lower === "d") return done(e, reopenPane); // reopen closed window
        return;
      }

      // ⌘ → tabs + new window
      switch (key) {
        case "t":
          return done(e, newTab); // new_tab
        case "w":
          return done(e, closeTab); // close_tab
        case "Enter":
          return done(e, addWindow); // new_window
        case "d":
          return done(e, addWindow); // new_window (convenience)
        case "ArrowLeft":
          return done(e, () => focusDirection("left")); // neighboring_window
        case "ArrowRight":
          return done(e, () => focusDirection("right"));
        case "ArrowUp":
          return done(e, () => focusDirection("up"));
        case "ArrowDown":
          return done(e, () => focusDirection("down"));
        default:
          if (key >= "1" && key <= "9") {
            return done(e, () => gotoTab(Number(key) - 1)); // goto_tab
          }
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

    // Backslash-escape shell-special chars so a path with spaces (e.g.
    // "Screenshot 2026-06-25 at 14.30.00.png") lands as a single argument.
    const esc = (p: string) => p.replace(/([ "'\\()$&;|<>`*?[\]{}])/g, "\\$1");

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
        // Frame each path as a bracketed paste (ESC[200~ … ESC[201~) so
        // `claude`'s paste handler recognizes a dropped image path and shows
        // "[Image #1]" — exactly like Terminal.app/iTerm2/kitty. Raw-typed
        // paths are never detected as images.
        const data =
          p.paths.map((path) => `\x1b[200~${esc(path)}\x1b[201~`).join(" ") +
          " ";
        invoke("pty_write", { id: paneId, data });
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

  return (
    <div className="app">
      <div className="titlebar">
        <div className="tabs">
          {state.tabs.map((t, i) => (
            <button
              key={t.id}
              className={`tab${t.id === state.activeTabId ? " active" : ""}`}
              onClick={() => gotoTab(i)}
            >
              {i + 1}
            </button>
          ))}
          <button className="tab tab-new" onClick={newTab} title="New tab (⌘T)">
            +
          </button>
        </div>
        <div className="drag-spacer" data-tauri-drag-region />
      </div>
      <div className="workspace">
        {state.tabs.map((t) => {
          const focusedIndex = Math.max(0, t.panes.indexOf(t.focused));
          const rects = layoutRects(t.layout, t.panes.length, focusedIndex);
          return (
            <div
              key={t.id}
              className="tab-root"
              style={{ display: t.id === state.activeTabId ? "block" : "none" }}
            >
              {t.panes.map((id, i) => {
                const r = rects[i];
                const hidden = r.w === 0 || r.h === 0;
                return (
                  <div
                    key={id}
                    className={`pane-slot${
                      id === dropTargetId ? " dropTarget" : ""
                    }`}
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
                      active={id === t.focused}
                      onFocus={() => setFocus(id)}
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default App;
