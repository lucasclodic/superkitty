# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Langue

Toujours répondre à l'utilisateur **en français** (les explications, résumés et messages). Le code, les noms de symboles et les commentaires existants restent dans leur langue d'origine.

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

`src-tauri/src/pty.rs` owns all terminal sessions. Each UI terminal is backed by a real PTY (via the `portable-pty` crate) whose command is **`tmux new-session -A -D -s superkitty-<id>`** (attach-or-create, detach-others). A *newly created* session runs a fresh login shell (`$SHELL -l`, idea #7), optionally wrapped in `sandbox-exec` confining writes to the project dir (idea #5); tmux ignores that trailing command on an `-A` reattach, so reopening resumes the prior live state — the create-vs-reattach split.

This is what makes sessions survive a window close: the real processes (including a running `claude`) live inside the **tmux server**, not the PTY. Closing the window only drops the PTY (tmux detaches); reopening with the same `id` re-attaches and restores scrollback + the live session. `pty_detach` removes our handle **without** killing tmux — that's the normal close path.

Backend commands (registered in `src-tauri/src/lib.rs`): `pty_spawn` (takes optional `cwd`, `session`, `sandbox`, plus an `on_output` Tauri `Channel`), `pty_write`, `pty_resize`, `pty_detach`, `pty_kill`, `pty_cwd`, `pty_foreground`, `pty_scroll_state` / `pty_scroll_to` / `pty_scroll` (custom scrollbar + kitty scroll keys via tmux copy-mode), `tmux_list_sessions` / `tmux_kill_session` (session sidebar, idea #2), `notify` (macOS notification via `osascript`, idea #6), `save_image` (write a pasted clipboard image to `~/.superkitty/dropped/`, idea #4), `list_files` (git-aware file list for the `⌘P` picker, idea #15). A per-session reader thread streams raw output bytes through the per-mount `on_output` **`Channel`** passed to `pty_spawn` (a binary IPC body — chunks ≥1 KiB ride Tauri's fetch path as octet-stream, avoiding the ~4× JSON number-array expansion that froze the UI under heavy concurrent output); it still fires `pty://exit/<id>` when the PTY ends and emits `pty://bell/<id>` on a BEL byte (agent-done detection, idea #6) as ordinary events (rare + tiny). A global Quake hotkey `⌃\`` (`tauri-plugin-global-shortcut`, registered in `lib.rs`) shows/hides the window and emits `quake://shown` (idea #19; needs macOS Accessibility permission to capture system-wide).

`PtyManager` (a `Mutex<HashMap<id, PtyInstance>>`) is Tauri-managed state. The `id` is the stable identity of a session — reusing an id reconnects to the same tmux session, so ids must be chosen deliberately, not randomly per mount. Each `PtyInstance` stores its **`session_name`** (usually `superkitty-<id>`, but an *adopted* external/raw session when the sidebar attaches one) — `pty_spawn` takes an optional `session` name, and `pty_kill`/`pty_cwd`/`pty_foreground` resolve the stored name rather than re-deriving it from the id.

### Session sidebar (idea #2)

`src/SessionSidebar.tsx` is a `⌘B`-toggled panel listing every tmux session from `tmux_list_sessions` (superkitty-prefixed first, then externals), with an attached/detached dot. Clicking a session **attaches** it via `App.openSession`: a `superkitty-<id>` session reattaches by reusing its pane id (`p<id>`, persists naturally); a raw/external session gets a fresh pane id mapped to its name in `AppState.sessions` (a `Record<paneId, tmuxName>` persisted to localStorage and passed to `TerminalView`'s `session` prop). The 🗑 button calls `tmux_kill_session` and drops the pane if it was open. `AppState.sessions` only holds *non-default* mappings; panes without an entry use `superkitty-<id>`.

### Frontend terminal

`src/Terminal.tsx` (`TerminalView`) renders one pane with **xterm.js** (`@xterm/xterm` + fit/web-links addons). On mount it creates a Tauri `Channel<ArrayBuffer>`, calls `pty_spawn` (passing it as `onOutput`), forwards `onData` → `pty_write` and `onResize` → `pty_resize`, and on unmount calls `pty_detach` (never kills tmux). Output chunks arriving on the channel are **batched**: queued and flushed to `term.write()` at most once per animation frame, gated on the write callback (backpressure) — without this, a flood of output (several Claude sub-agents at once) calls `term.write()` synchronously per message and freezes the UI. Bytes stay binary end-to-end (`ArrayBuffer` → `Uint8Array`), so multi-byte UTF-8 is never split across reads. `active` pulls keyboard focus into xterm and shows the accent border.

### Tabs, panes & shortcuts

`src/App.tsx` owns the whole layout. State is `{ tabs, activeTabId }`; each tab is `{ panes: string[], focused, layout }` — a **flat, ordered list of panes** plus a named **kitty-style layout** (this replaced the old binary pane tree). All tabs stay mounted (inactive ones `display:none`) so switching tabs does NOT detach/reattach PTYs.

Layouts live in `src/layouts.ts`: a layout is a pure function `(n, focusedIndex, opts) → Rect[]` returning one fraction-rectangle (`{x,y,w,h}` in 0..1) per pane, ported from kitty (`kitty/layout/{grid,tall}.py`). Layouts: `tall` (default — one big main column left, rest stacked right), `fat`, `grid`, `horizontal`, `vertical`, `stack`. App renders each pane in an absolutely-positioned `.pane-slot` sized from its rect; `Terminal.tsx`'s `ResizeObserver` re-fits xterm automatically. **Every add/close recomputes all rectangles**, so the arrangement stays balanced and nothing piles up — that's the whole point vs. the old halving tree. `next_layout` (`⌃⇧L`) cycles layouts via `LAYOUT_CYCLE`.

`src/LayoutPicker.tsx` (idea #21) is the visual alternative to blind cycling: a ▦ button in the titlebar opens a popover drawing every layout as a thumbnail, scaled from the **active tab's real pane count** via the same `layoutRects()` (focused pane tinted accent; `stack` shown as offset cards). Clicking a thumbnail calls `App.setLayout` (persists like any layout change). It owns its open state and closes on Esc / outside-click.

### Overlays & power-UI (ideas #11/#12/#3/#15/#16/#19/#20)

Several self-contained overlay components are mounted by `App.tsx` and driven by its action functions:

- `src/CommandPalette.tsx` (`⌘K`, idea #12) — fuzzy-searchable list of every action (each row shows its shortcut, so it doubles as a live cheat-sheet) plus the live tmux sessions. `App` builds a `Command[]` registry each render; the palette exports `fuzzyScore` (reused by the file picker).
- `src/ContextMenu.tsx` (right-click, idea #11) — reuses the same `Command` shape; right-clicking a pane focuses it first so the actions target it.
- `src/Settings.tsx` + `src/themes.ts` (`⌘,` or the titlebar ⚙ button, idea #3) — a **two-pane** panel (left category rail: Apparence/Thème, Police, Notifications, Raccourcis, À propos; right content). xterm theme + font + notifications toggle apply **live**: `TerminalView` takes `theme/fontFamily/fontSize` props and updates `term.options` in place (no recreate). Persisted to `localStorage["superkitty.settings.v1"]`. The **Raccourcis** pane edits the reassignable bindings (capture a new chord, remove/reset, conflict-steals), driven by `src/shortcuts.ts`.
- `src/FilePicker.tsx` (`⌘P`, idea #15) — fuzzy file list of the focused pane's cwd (`list_files`), inserts the chosen path as a bracketed paste.
- `src/PromptComposer.tsx` (`⌘E`, idea #16) and `src/Scratchpad.tsx` (`⌃⇧N`, idea #20) — multi-line text → focused pane (bracketed paste; `⌘↵`). Scratchpad is per-tab and persisted (`localStorage["superkitty.notes.v1"]`).
- `src/QuickPrompt.tsx` (idea #19) — the Quake dropdown shown on the `quake://shown` event: pick a project tab, type, `↵` sends + runs in that tab and re-hides the window.

A single capture-phase `keydown` listener in `App.tsx` gates all of these: it **bails when focus is in one of our own text fields** (any `<input>/<textarea>` not inside `.xterm`) so typing never triggers shortcuts, while the terminal's own hidden textarea (inside `.xterm`) still gets them. Bell activity badges (idea #6) live in `activity: Set<paneId>`; per-pane sandbox flags in `localStorage["superkitty.sandbox.v1"]`; per-tab project name/tint (idea #17): each tab is assigned a **distinct colour** from the `TAB_COLORS` palette at creation (`pickTabColor` avoids reusing a sibling's), stored on `Tab.color` and persisted; **right-clicking a tab** opens `src/TabColorPicker.tsx` to recolour it (or "Auto" to clear it). `tabTint(t)` returns the stored colour, falling back to a cwd hash (`autoTint`) for legacy tabs without one; the result is applied to the tab dot and the focused pane border via the `--pane-accent` CSS var.

Pane ids (`p1`, `p2`, …) come from a monotonic counter and are the tmux session identity. The layout is persisted to **`localStorage["superkitty.layout.v1"]`** on every change and restored on launch (`loadState`), which reseeds the id counter past all restored ids — this is what makes a full app restart reattach to the same tmux sessions in the same arrangement. `normalizeTab` migrates any old binary-tree (`root`) entries by flattening their leaves into `panes`, so existing saved sessions still reattach.

Two close semantics: `pty_detach` (keep tmux alive) vs `pty_kill` (destroy it). `closeFocused` (`⌃⇧W` / `⌘⇧D`) **detaches** the focused pane — its session stays alive — and pushes it onto the reopen history; `closeTab` (`⌘W`) kills the whole tab's sessions (with a confirmation when an agent is running, idea #13). Both feed the **`⌘⇧T` reopen history** (`AppState.closed`, persisted, capped): reopening a detached pane reattaches its live session, reopening a killed tab recreates it fresh in the same layout/cwd (idea #1).

Keyboard shortcuts are **reassignable** (idea #3): `src/shortcuts.ts` is the single source of truth — it defines every bindable action (`ACTIONS`: id, label, group, **default chords**), a layout-independent **canonical chord** derived from a `KeyboardEvent` (modifiers in fixed order + `e.code`, so bindings work on AZERTY/QWERTY; `chordFromEvent` returns `null` without a ⌃/⌥/⌘ so terminal keys pass through), `formatChord` for display, and the `superkitty.keys.v1` override persistence. The single capture-phase `keydown` listener in `App.tsx` now **resolves the event's chord through a live lookup** (`lookupRef`, rebuilt when bindings change) to an action id, then runs the matching handler from a per-id `actions` map (the three overlay toggles — palette/settings/file-picker — are special-cased so the same combo also closes them). Defaults below reflect kitty macOS conventions (`kitty_mod` = `⌃⇧` for windows/panes, `⌘` for tabs):

| Action | Keys |
|---|---|
| New tab / close tab | `⌘T` / `⌘W` |
| Rename active tab | double-click the tab (or palette) |
| Next / prev tab | `⌘⇧]` / `⌘⇧[`, `⌃Tab` / `⌃⇧Tab` |
| Go to tab N | `⌘1`…`⌘9` |
| New window (added to list, layout rebalances) | `⌘D`, `⌘↵`, `⌃⇧↵` |
| New **sandboxed** window (write-confined, idea #5) | palette / right-click |
| Close window (focused pane — detaches, keeps tmux) | `⌃⇧W`, `⌘⇧D` |
| Reopen last closed pane/tab (idea #1) | `⌘⇧T` |
| Focus neighboring window (spatial) | `⌘←` / `⌘→` / `⌘↑` / `⌘↓` |
| Move (swap) window with spatial neighbor | `⌘⇧←` / `⌘⇧→` / `⌘⇧↑` / `⌘⇧↓` |
| Next / prev window (list order) | `⌃⇧]` / `⌃⇧[` |
| Move window forward / backward (list order) | `⌃⇧F` / `⌃⇧B` |
| Promote focused window to main (kitty `move_window_to_top`) | `` ⌃⇧` ``, `⌘⇧M` |
| Zoom / un-zoom focused pane (kitty `toggle_layout stack`) | `⌃⇧Z`, `⌘⇧↵` |
| Next layout (`tall`→`fat`→`grid`→`horizontal`→`vertical`→`stack`) | `⌃⇧L` |
| Visual layout picker (titlebar ▦ button, mouse) | — |
| Zoom text (font size: enlarge / shrink / reset, global, idea #23 — matched by **character** `e.key` in `App.onKeyDown`, not e.code, so AZERTY/QWERTY both work; not in the reassignable `ACTIONS`) | `⌘+` (`⌘=`) / `⌘-` / `⌘0` |
| Scroll line / page / top / bottom (tmux copy-mode) | `⌃⇧↑/↓`, `⌃⇧PgUp/PgDn`, `⌃⇧Home`, `⌃⇧End` |
| Scroll to prev / next prompt (needs OSC 133 marks) | `⌥⌘↑` / `⌥⌘↓` |
| Command palette (fuzzy, all actions + tmux sessions) | `⌘K` |
| Settings (theme, font, shortcut reference) | `⌘,` |
| Insert a file path (fuzzy picker of the cwd) | `⌘P` |
| Compose a multi-line prompt → send to focused pane | `⌘E` |
| Per-tab scratchpad / notes | `⌃⇧N` |
| Toggle session sidebar (list/attach tmux sessions) | `⌘B` |
| Quake dropdown (global hotkey, from any app) | `` ⌃` `` |

The custom app menu in `lib.rs` deliberately omits Window>Close/Minimize so `⌘W`/`⌘M` reach the webview instead of being eaten by native menu accelerators.

### Gotchas

- **No React StrictMode** (`src/main.tsx`): its double-invoked effects would spawn/attach the PTY twice. Keep it off, or guard PTY spawns by id.
- `tmux` must be resolvable on the spawned process's PATH. In `npm run tauri dev` it inherits the launching shell's PATH (Homebrew tmux is fine). A Finder-launched bundle has a minimal PATH — if tmux isn't found in a built app, resolve its absolute path in `pty.rs`.
- Custom titlebar uses `titleBarStyle: "Overlay"` + `data-tauri-drag-region`; the CSS reserves left padding for the macOS traffic lights.
- The global Quake hotkey (`⌃\``) needs **macOS Accessibility permission** to capture keys system-wide; until granted (System Settings → Privacy & Security → Accessibility) it silently no-ops. Registration is best-effort in `lib.rs` so a failure never blocks launch.
- The sandbox (idea #5) is **write-confinement** (Seatbelt profile: reads open so node/git/claude work, writes limited to the project dir + temp + a few caches). Stricter read-confinement would likely break Claude's config/cache access, so it's intentionally not the default.

### Clipboard paste of files/folders (idea #4) — hard-won specifics

A ⌘V of a Finder copy was the source of a long debugging saga; the moving parts, so the next person doesn't re-derive them:

- **A real Finder ⌘C puts a *file-reference URL* on the pasteboard, not a path.** `clipboard_file_paths` (`pty.rs`) reads `public.file-url` off each `NSPasteboardItem` (`pasteboardItems()`), but that value is `file:///.file/id=6571367.1542935/` — an opaque node id. `NSURL.path()` only **half-resolves** it (→ `/Users`); you MUST go through **`NSURL.filePathURL()`** to get the true POSIX path. The legacy `NSFilenamesPboardType` is kept only as a *fallback* — modern Finder doesn't populate it; only `osascript 'set the clipboard to (POSIX file …)'` does (which is why the old standalone test "passed" while the app failed). Needs the `NSPasteboardItem` feature on `objc2-app-kit`.
- **The webview's DOM `clipboardData` is useless for the real path** (WebKit exposes only an icon preview / a `"Files"` type with empty `text/plain` + `text/uri-list`). The native NSPasteboard read is the only source of truth; the frontend just gates on "is there any file/image item?" then calls `clipboard_file_paths`.
- **`injectPaths` (`App.tsx`): image paths → bracketed paste (`ESC[200~ … ESC[201~`); everything else → PLAIN text; never shell-escape.** claude renders `[Image #N]` only for an *image* path sent as a bracketed paste (it then attaches the file). A bracketed paste of a **folder / non-image** makes claude try to attach it and **silently drop it** → nothing appears. So non-images go as plain text, which claude inserts as the literal path. And do **not** backslash-escape (`Analyse\ Savage\ Step`): claude wants the literal path; escaping breaks resolution and rendering for names with spaces.
- **The capture-phase `paste` listener must `stopImmediatePropagation()`, not just `preventDefault()`** — otherwise xterm.js's own paste handler ALSO reads the clipboard and double-injects (a single pasted image appeared twice).
- claude **only echoes pasted input when it's idle at the prompt** (and discards/garbles a rapid burst of ⌘V). When verifying, paste once into an *idle* pane.
- **Debugging tip:** `tmux capture-pane -p -t superkitty-<id>` shows what claude *actually* received/renders, independent of the (sometimes blank) xterm draw — the only reliable way to verify paste behavior without a screenshot.

### "Black / frozen pane" after a webview reload or remount

`pty_spawn` used to **early-return if a PTY for the `id` already existed**. On a Vite HMR page reload (or any remount) the Rust backend — and the old `PtyInstance` — stay alive (a page reload skips React cleanup, so `pty_detach` never runs), but the new xterm created a brand-new `Channel`. The early return left that channel **unwired**: the reader thread kept streaming to the dead old channel, the fresh pane got zero bytes, and no `pty_redraw`/`tmux refresh-client` could fix it (the bytes went to the dead channel). Fix: `PtyInstance.output` is a swappable `Arc<Mutex<Channel>>`; on remount `pty_spawn` **rewires** it to the new channel and returns, and the frontend's existing `pty_redraw` (`Terminal.tsx` `tryAttachRedraw` backoff) makes tmux re-send the screen → the pane repaints. A *clean* app restart never hit this (fresh backend → fresh spawn → `tryAttachRedraw`); only reloads/remounts did.

## Idea box (IDEAS.md)

`IDEAS.md` (in French) is the project's feature backlog — a numbered list of friction-first ideas with `[ ]`/`[~]`/`[x]` checkboxes. **Workflow rule:** whenever you ship a real feature, check whether it corresponds to an item in `IDEAS.md`. If it does, mark that item (and its sub-tasks) as done (`[x]`), and update the roadmap below if relevant. Keep the idea box in sync with what's actually built — don't let shipped features sit as `[ ]`.

## Handoff briefs (handoff/)

When a bug or chantier is going to be handed off to another dev (human or a more senior agent) to investigate from scratch, write a **handoff brief** under `handoff/` instead of dumping the context into chat. A brief is an investigation dossier, not a ticket: it states what we *wanted*, what's *broken*, **what's already been tried with each attempt's verification status** (✅ verified / ❓ unverified / ❌ ruled out — this is what stops the next dev re-doing work), the relevant `file:line` references, and the remaining leads. See `handoff/README.md` for the naming convention (`AAAA-MM-JJ-sujet.md`) and the brief skeleton. **Workflow rule:** the dev who picks up a brief updates the *same* file as they go (attempts, statuses, what they eliminated); on resolution, set status `✅`, record the real cause + fix, and propagate anything durable into `IDEAS.md`/this file. Keep solved briefs as a trace.

## Roadmap (friction-first)

- **M0 Skeleton** — Tauri app + one PTY-backed terminal. ✅
- **M1 Persistence** — tmux-backed sessions resume after close. ✅ (built with M0)
- **M3 Panes + kitty shortcuts** — tabs + split panes, kitty-style keyboard shortcuts, layout persisted to localStorage. ✅ (done before M2, at the author's request)
- **M2 Drag & drop images** — drop an image (or any file) → inject its path into the focused pane as a **bracketed paste** (`ESC[200~ … ESC[201~`) so `claude` shows `[Image #1]`. ✅ (drop of any file + multi-file + clipboard `⌘V` image paste saved to `~/.superkitty/dropped/`, ideas #4/#15; the `⌘P` fuzzy file picker generalizes it)
- **M4 Clean "Claude mode"** — polished chrome, theming, session sidebar, discoverability. ✅ (session sidebar `⌘B` #2; Settings with live themes/font `⌘,` #3; command palette `⌘K` #12; right-click menu #11; per-project tab names + tint #17; agent-done notifications #6)

Shipped on top of the roadmap (see IDEAS.md): reopen closed pane/tab `⌘⇧T` (#1), pane zoom `⌃⇧Z` (#9), promote-to-main + list-move + kitty scrollback keys (#14/scroll), tab-number tooltips (#10), fresh login shell per pane (#7), multi-line prompt composer `⌘E` (#16), per-tab scratchpad `⌃⇧N` (#20), Quake global dropdown `⌃\`` (#19), per-pane write-confined sandbox (#5).

Known gaps to revisit: no draggable resizers yet — layouts are auto-balanced (the `tall`/`fat` `bias` is wired through `layouts.ts` but fixed at 0.5; Phase 2 adds drag handles that adjust + persist a per-tab bias). Directional pane navigation (`⌘`+arrows) and swapping (`⌘⇧`+arrows) both go through `neighborsForWindow()` in `layouts.ts` — a per-layout, **topological** neighbor map ported verbatim from kitty's `neighbors_for_window` (tall/fat, grid, vertical/horizontal, stack), NOT a geometric scan of the rendered rectangles. Multi-candidate ties are broken by the most-recently-focused pane (kitty `most_recent_group`), tracked per-tab in `activityRef` (most-recent-last, not persisted). This pairing is what makes `move_window` a true involution: swapping in one direction then the opposite trades the exact same pair back. `⌃⇧]`/`⌃⇧[` still cycle in list order.
