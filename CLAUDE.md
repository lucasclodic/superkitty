# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

superkitty is a **terminal emulator for macOS dedicated to using Claude Code**. It's "a real terminal like kitty" (full PTY, runs any shell program) but built to fix specific frictions the author hit using Claude in kitty:

1. No drag & drop of images.
2. Closing the terminal kills sessions — they don't resume.
3. Everything is raw shell, no clean UI.
4. (kept, liked) the window/pane system.

The project is built friction-first: each milestone removes one pain point. macOS-only for now.

## Commands

All run from the repo root.

- `npm install` — install frontend deps (run once, and after pulling).
- `npm run tauri dev` — **the main dev command**: launches Vite + the native window with hot reload.
- `npm run dev` — frontend only in a browser (no PTY/native APIs; rarely useful here).
- `npm run build` — type-check (`tsc`) + production frontend build.
- `npm run tauri build` — produce a distributable macOS app bundle.

Rust backend (in `src-tauri/`, needs `source "$HOME/.cargo/env"` if cargo isn't on PATH):

- `cargo check` — fast compile check of the Rust backend.
- `cargo build` — full build.

There is no test suite yet.

## Architecture

Tauri 2 app: a **Rust backend** (`src-tauri/`) and a **React + TypeScript + Vite frontend** (`src/`) that talk over Tauri's command/event bridge.

### PTY + persistence (the core trick)

`src-tauri/src/pty.rs` owns all terminal sessions. Each UI terminal is backed by a real PTY (via the `portable-pty` crate) whose command is **`tmux new-session -A -D -s superkitty-<id>`** (attach-or-create, detach-others).

This is what makes sessions survive a window close: the real processes (including a running `claude`) live inside the **tmux server**, not the PTY. Closing the window only drops the PTY (tmux detaches); reopening with the same `id` re-attaches and restores scrollback + the live session. `pty_detach` removes our handle **without** killing tmux — that's the normal close path.

Backend commands (registered in `src-tauri/src/lib.rs`): `pty_spawn`, `pty_write`, `pty_resize`, `pty_detach`. A per-session reader thread streams raw bytes to the frontend via the event `pty://output/<id>`; `pty://exit/<id>` fires when the PTY ends.

`PtyManager` (a `Mutex<HashMap<id, PtyInstance>>`) is Tauri-managed state. The `id` is the stable identity of a session — reusing an id reconnects to the same tmux session, so ids must be chosen deliberately, not randomly per mount.

### Frontend terminal

`src/Terminal.tsx` (`TerminalView`) renders one pane with **xterm.js** (`@xterm/xterm` + fit/web-links addons). On mount it subscribes to `pty://output/<id>`, calls `pty_spawn`, forwards `onData` → `pty_write` and `onResize` → `pty_resize`, and on unmount calls `pty_detach` (never kills tmux). Output is sent as raw bytes (`number[]` → `Uint8Array`) to avoid splitting multi-byte UTF-8 across reads. `active` pulls keyboard focus into xterm and shows the accent border.

### Tabs, panes & shortcuts

`src/App.tsx` owns the whole layout. State is `{ tabs, activeTabId }`; each tab is `{ panes: string[], focused, layout }` — a **flat, ordered list of panes** plus a named **kitty-style layout** (this replaced the old binary pane tree). All tabs stay mounted (inactive ones `display:none`) so switching tabs does NOT detach/reattach PTYs.

Layouts live in `src/layouts.ts`: a layout is a pure function `(n, focusedIndex, opts) → Rect[]` returning one fraction-rectangle (`{x,y,w,h}` in 0..1) per pane, ported from kitty (`kitty/layout/{grid,tall}.py`). Layouts: `tall` (default — one big main column left, rest stacked right), `fat`, `grid`, `horizontal`, `vertical`, `stack`. App renders each pane in an absolutely-positioned `.pane-slot` sized from its rect; `Terminal.tsx`'s `ResizeObserver` re-fits xterm automatically. **Every add/close recomputes all rectangles**, so the arrangement stays balanced and nothing piles up — that's the whole point vs. the old halving tree. `next_layout` (`⌃⇧L`) cycles layouts via `LAYOUT_CYCLE`.

Pane ids (`p1`, `p2`, …) come from a monotonic counter and are the tmux session identity. The layout is persisted to **`localStorage["superkitty.layout.v1"]`** on every change and restored on launch (`loadState`), which reseeds the id counter past all restored ids — this is what makes a full app restart reattach to the same tmux sessions in the same arrangement. `normalizeTab` migrates any old binary-tree (`root`) entries by flattening their leaves into `panes`, so existing saved sessions still reattach.

Two close semantics: `pty_detach` (window/app close — keep tmux alive) vs `pty_kill` (deliberate ⌘W/⌃⇧W — destroy the tmux session). `closeTab` kills every pane in the tab; `closeFocused` kills one.

Keyboard shortcuts (kitty macOS conventions; `kitty_mod` = `⌃⇧` for windows/panes, `⌘` for tabs), bound via a single capture-phase `keydown` listener in `App.tsx`:

| Action | Keys |
|---|---|
| New tab | `⌘T` |
| Close tab | `⌘W` |
| Next / prev tab | `⌘⇧]` / `⌘⇧[`, `⌃Tab` / `⌃⇧Tab` |
| Go to tab N | `⌘1`…`⌘9` |
| New window (added to list, layout rebalances) | `⌘D`, `⌘↵`, `⌃⇧↵` |
| Close window (focused pane) | `⌘⇧D`, `⌃⇧W` |
| Focus neighboring window (spatial) | `⌘←` / `⌘→` / `⌘↑` / `⌘↓` |
| Next / prev window (list order) | `⌃⇧]` / `⌃⇧[` |
| Next layout (`tall`→`fat`→`grid`→`horizontal`→`vertical`→`stack`) | `⌃⇧L` |

The custom app menu in `lib.rs` deliberately omits Window>Close/Minimize so `⌘W`/`⌘M` reach the webview instead of being eaten by native menu accelerators.

### Gotchas

- **No React StrictMode** (`src/main.tsx`): its double-invoked effects would spawn/attach the PTY twice. Keep it off, or guard PTY spawns by id.
- `tmux` must be resolvable on the spawned process's PATH. In `npm run tauri dev` it inherits the launching shell's PATH (Homebrew tmux is fine). A Finder-launched bundle has a minimal PATH — if tmux isn't found in a built app, resolve its absolute path in `pty.rs`.
- Custom titlebar uses `titleBarStyle: "Overlay"` + `data-tauri-drag-region`; the CSS reserves left padding for the macOS traffic lights.

## Idea box (IDEAS.md)

`IDEAS.md` (in French) is the project's feature backlog — a numbered list of friction-first ideas with `[ ]`/`[~]`/`[x]` checkboxes. **Workflow rule:** whenever you ship a real feature, check whether it corresponds to an item in `IDEAS.md`. If it does, mark that item (and its sub-tasks) as done (`[x]`), and update the roadmap below if relevant. Keep the idea box in sync with what's actually built — don't let shipped features sit as `[ ]`.

## Roadmap (friction-first)

- **M0 Skeleton** — Tauri app + one PTY-backed terminal. ✅
- **M1 Persistence** — tmux-backed sessions resume after close. ✅ (built with M0)
- **M3 Panes + kitty shortcuts** — tabs + split panes, kitty-style keyboard shortcuts, layout persisted to localStorage. ✅ (done before M2, at the author's request)
- **M2 Drag & drop images** — drop an image → inject its path into the focused pane as a **bracketed paste** (`ESC[200~ … ESC[201~`) so `claude` recognizes it and shows `[Image #1]`, exactly like Terminal.app/iTerm2/kitty. 🟡 (path injection + drop overlay + multi-file done; remaining: save dropped image to a folder, clipboard `⌘V` image paste — see IDEAS.md #4)
- **M4 Clean "Claude mode"** — polished chrome, theming, a session sidebar listing tmux sessions.

Known gaps to revisit: no draggable resizers yet — layouts are auto-balanced (the `tall`/`fat` `bias` is wired through `layouts.ts` but fixed at 0.5; Phase 2 adds drag handles that adjust + persist a per-tab bias). Spatial pane navigation (`⌘`+arrows) uses `neighbor()` in `layouts.ts`, computed from the layout rectangles; `⌃⇧]`/`⌃⇧[` still cycle in list order.
