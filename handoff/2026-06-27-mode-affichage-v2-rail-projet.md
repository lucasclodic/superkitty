# Mode d'affichage « v2 » — rail projet + fenêtrage kitty (bascule v1 ↔ v2)

- **Date :** 2026-06-27
- **Statut :** ✅ **livré** (2026-06-27) — voir **§11 Résolution** en bas.
- **Zone :** frontend — `src/App.tsx`, `src/App.css`, `src/SessionSidebar.tsx`, `src/themes.ts` (+ `src/layouts.ts` réutilisé). **Aucune** modif backend Rust attendue.
- **Source de vérité du design :** `design/ui-proto-hybride.html` (maquette HTML interactive — ouvre-la dans un navigateur et clique-la, elle EST le cahier des charges). Contexte annexe : `design/ui-proto-chrome.html`, `design/ui-proto-sidebar.html` (explorations A/B), `design/charte-noir-bureau.html` (tokens « Platinum Noir »).

---

## 1. Contexte produit

superkitty est un terminal macOS dédié à Claude Code (Tauri 2 + React/TS). Aujourd'hui l'UI = **onglets + grille de panes kitty** (titlebar, workspace, statusbar) sur une base **violet froid**. On a prototypé une **nouvelle direction visuelle** (« Platinum Noir », sobriété façon Unpeel) avec un **rail projet permanent** à gauche. On ne veut pas remplacer brutalement : on veut **garder l'UI actuelle** et ajouter **un bouton** qui bascule vers la **v2**, pour comparer/itérer en vrai.

## 2. Objectif (comportement attendu)

1. Un **bouton de bascule** dans superkitty : UI **classique (v1)** ↔ UI **v2**. État persistant (relance = on retombe sur le dernier mode choisi).
2. En **v2**, reproduire `design/ui-proto-hybride.html` :
   - **Rail projet permanent à gauche** (~280px) : projets (= onglets), chacun dépliable en ses sessions (= panes), avec pastille de teinte projet, glyphes de statut, horodatage relatif, épingles, nœud « Worktrees » (compteur), « Afficher N de plus », et **boutons de lancement d'agent au survol de l'en-tête de projet** (✻ claude · ◆ codex · ✦ gemini · +).
   - **Zone principale = vue multi-panes** du projet sélectionné, avec **tout le fenêtrage kitty conservé** (dispositions tall/fat/grille/colonnes/lignes/stack via un **bouton ▦** dans la barre du haut — pas une rangée affichée en permanence).
   - **Drill : clic sur une fenêtre → elle s'agrandit en plein** (zoom/découplage), fil d'Ariane `projet › fenêtre`, retour via « ← grille du projet » ou **Esc**.
   - Ambiance **Platinum Noir** (graphite chaud + crème + ruban 6 couleurs), identité **multicolor** gardée en touches.

> ⚠️ **Le point central :** la v2 est un **affichage différent par-dessus le MÊME moteur** (onglets/panes/PTY existants). Ce n'est **pas** un système parallèle. On ne recrée pas de sessions, on **re-skinne + re-dispose** l'état déjà là.

## 3. Périmètre

**Dans le périmètre (à faire) :**
- La bascule v1↔v2 + le rendu v2 fidèle au proto.
- Réutiliser l'état existant : un **projet = un `Tab`**, une **fenêtre = un pane** (paneId) dans ce tab.
- Réutiliser le moteur de disposition (`layoutRects`, `src/layouts.ts`) pour la grille, et le zoom existant pour le plein écran.
- Palette Platinum Noir **scopée à la v2** (la v1 ne bouge pas).

**Hors périmètre pour l'instant (stubber ou simplifier) :**
- Les **boutons de lancement d'agent au survol** : visuel OK, mais le câblage (créer un pane avec preset) peut être branché plus tard sur la création de pane existante — un simple « + nouvelle fenêtre dans ce projet » suffit au départ.
- **Worktrees** (compteur/nœud) : visuel seulement au départ (pas de vraie intégration git worktree — c'est l'idée #5, séparée).
- **Horodatage relatif** par session : il faut une donnée « dernière activité par pane » qui n'existe pas encore → soit l'ajouter (timestamp mis à jour à chaque output/bell), soit stubber (`—`) au début.
- Multi-projets « réels » dans le rail : le rail liste les **onglets existants** comme projets ; pas besoin d'inventer une notion de projet au-delà du tab.

## 4. Décisions de design déjà figées (ne pas re-trancher)

- **Ambiance = Platinum Noir** (validé). Tokens (depuis `charte-noir-bureau.html` / le proto) :
  `--bg #1C1A17`, `--bg-2 #211E1A`, `--panel #26241F`, `--panel-2 #2E2B25`, `--panel-3 #38342D` ;
  texte `--cream #EAE5D6` / `--cream-soft #C4BEAD` / `--cream-faint #8E897A` ;
  terminal `--term-bg #181612` / `--term-fg #EAE5D6` / `--term-dim #8A8474` ; bordures `--edge #34302A`.
- **Ruban 6 couleurs** (identité, wordmark + traînée agent-fini) : `#6FB36A #F0C04E #EE965A #E2685E #A87FC4 #54AEC0`.
- **Accents par projet** : la palette `TAB_COLORS` existante (`src/App.tsx:169`) + `tabTint()` — déjà utilisée pour `--pane-accent`. On la réutilise telle quelle (pastille projet + bordure pane actif).
- **Statut harmonisé** (l'utilisateur a insisté) : **un seul langage de pastilles**, couleur = état. **Orange = « te réclame » UNIQUEMENT**, et **jamais de cloche**.
  | État | Pastille | Couleur | Anim |
  |---|---|---|---|
  | en cours | ● | vert `--rb-green` | pulse |
  | te réclame | ● | **orange** `--rb-orange` | pulse |
  | terminé | ● | vert `--rb-green` | fixe |
  | au repos | ○ (creux) | `--cream-faint` | — |
- **Le switcher de disposition ne s'affiche PAS en rangée** : un seul bouton **▦** (cycle, ou ouvre le `LayoutPicker` visuel existant). L'utilisateur a explicitement demandé de ne pas étaler `◧⬓▦▥☰▢`.
- **Le fenêtrage kitty reste entier** au niveau projet (c'est la différence assumée avec Unpeel, qui est mono-conversation sans panes).
- **Multicolor gardé** en touches (wordmark dégradé, pastilles, bordure pane actif, traînée agent-fini), pas partout.

## 5. Mapping concept proto → architecture superkitty

| Proto (`ui-proto-hybride.html`) | superkitty |
|---|---|
| Projet (rail) | un **`Tab`** (`src/App.tsx:45`), avec `tab.color`/`tabTint(t)` pour la teinte |
| Fenêtre / session (sous un projet) | un **pane** (`paneId`) dans `tab.panes` |
| Vue multi-panes | la grille actuelle via **`layoutRects(...)`** (`src/App.tsx:1956`, `src/layouts.ts`) |
| Switcher ▦ | **`setLayout`** (`src/App.tsx:1038`) + `LayoutPicker` (`src/App.tsx:1896`) |
| Zoom une fenêtre en plein | le **zoom de pane existant** (layout `stack` / action zoom `⌃⇧Z`) — en v2, afficher le pane focalisé seul, plein cadre |
| Glyphes de statut | dériver de l'état existant : `activity: Set<paneId>` (bell/idea #6), état « finished » (traînée), `pty_foreground` (commande en cours) |
| Sélection session | `tab.focused` (le pane focalisé) |
| Bordure/teinte projet | `--pane-accent` déjà posé sur `.tab-root` (`src/App.tsx:1969`) |

## 6. Implémentation suggérée (étapes)

1. **État + persistance du mode.** Ajouter `uiMode: "classic" | "v2"` — le plus simple : dans `SkSettings` (`src/themes.ts:6`, persisté `superkitty.settings.v1`) à côté de `theme/fontFamily/...`. Défaut `"classic"`.
2. **Le bouton.** Un bouton dans la titlebar (`src/App.tsx:1894`, `.titlebar-actions`, à côté du `▦`/`⚙`) qui flippe `uiMode`. Bonus : aussi une commande palette (`⌘K`) et l'entrée Settings → Apparence (`src/Settings.tsx`). L'utilisateur veut **un bouton** clair avant tout.
3. **Palette scopée.** Mettre une classe sur `.app` (`src/App.tsx:1826`), ex. `app ui-v2`, et dans `src/App.css` surcharger les tokens `:root` **seulement** sous `.app.ui-v2 { --bg:#1C1A17; --titlebar-bg:…; --text:var(--cream); … }`. La v1 garde la base violette intacte. (Option : ajouter un thème xterm « Platinum Noir » dans `THEMES` `src/themes.ts:48` et l'activer en v2.)
4. **Rendu conditionnel.** Dans `App()` (rendu `src/App.tsx:1826+`), brancher :
   - `uiMode === "classic"` → arbre actuel (titlebar onglets + `.body` + workspace + sidebar `⌘B` + statusbar). **Inchangé.**
   - `uiMode === "v2"` → barre du haut fine (pastilles + wordmark + ▦ + ⚙) + **rail projet** + **zone principale** (grille du projet actif via `layoutRects`, ou pane focalisé plein si « zoomé »).
5. **⚠️ NE PAS démonter les PTY en basculant.** C'est le piège n°1. Les `TerminalView` (`src/App.tsx:1990`) doivent **rester montés** d'un mode à l'autre, sinon `pty_detach`/`pty_kill` se déclenchent (cf. `src/Terminal.tsx`) et on respawn/perd les sessions. S'inspirer du pattern existant « tous les onglets restent montés en `display:none` » : la v2 doit **repositionner/re-styler les mêmes instances de pane**, pas en créer de nouvelles. Idéalement, garder un seul arbre de panes monté et ne changer que le **chrome autour** + la **disposition** (rects) + la **visibilité** (zoom = focalisé visible, autres masqués mais montés).
6. **Le rail.** Faire évoluer `src/SessionSidebar.tsx` (`:33`, `.sidebar`/`.session-item`) **ou** créer `src/ProjectRail.tsx`. Il liste les **onglets** comme projets, déplie leurs panes comme sessions, applique le markup/CSS du proto (pastilles harmonisées, horodatage, épingles, Worktrees, « afficher plus », presets au survol). Reprendre le CSS du proto presque tel quel.
7. **Drill/zoom.** Clic sur une session (rail) ou une fenêtre (grille) → focaliser ce pane et le passer en **plein** (réutiliser le zoom existant). Fil d'Ariane + Esc/retour comme dans le proto.
8. **▦.** Brancher sur `setLayout`/`LayoutPicker` existants. Au choix de l'utilisateur : cycle simple **ou** mini-sélecteur visuel (le `LayoutPicker` actuel convient — voir question ouverte plus bas).

## 7. Pièges / gotchas

- **Pas de React StrictMode** (`src/main.tsx`) — déjà le cas, ne pas le réactiver (double-spawn PTY).
- **Bascule de mode ≠ fermeture de panes** : aucun `pty_detach`/`pty_kill` au switch. Vérifier qu'un `claude` en cours **survit** au passage v1→v2→v1.
- **Platinum Noir est chaud** (graphite/crème), très différent du violet froid actuel : bien **scoper à `.app.ui-v2`** pour ne pas casser la v1.
- **Statut** : ne **jamais** réintroduire de cloche ; orange réservé à « te réclame » (l'utilisateur l'a explicitement demandé). Réutiliser `activity`/`finished`/foreground pour mapper les états — pas une nouvelle source de vérité.
- **Worktrees / presets / horodatage** : si pas branchés sur du réel, les rendre visuellement mais inertes (ou les masquer) plutôt que d'inventer un backend.

## 8. Architecture pertinente (références exactes)

**`src/App.tsx`** (propriétaire du layout et de l'état) :
- `interface Tab` `:45` · `interface AppState` `:96` · `function App()` `:422`
- multicolor : `autoTint` `:160`, `TAB_COLORS` `:169`, `pickTabColor` `:186`, `tabTint(t)` `:1848`
- persistance : `STORAGE_KEY "superkitty.layout.v1"` `:228`, `loadState()` `:339`
- dispositions : import `layoutRects` `:38`, `setLayout` `:1038`, appel `layoutRects(...)` `:1956`
- clavier : `onKeyDown` `:1444` (listener capture `:1522`)
- **rendu** : `.app` `:1826` · `.titlebar` `:1827` · onglets `:1852` · **`.titlebar-actions`** `:1894` · `LayoutPicker` `:1896` · `.body` `:1929` · `.workspace` `:1940` · `.tab-root` (`--pane-accent`) `:1964/1969` · `.pane-slot` `:1979` · `<TerminalView>` `:1990` · `<SessionSidebar>` `:2047` · `<StatusBar>` `:2064` · `<Settings>` `:2104`

**`src/App.css`** : tokens `:root` `:1` (`--bg` `:2`, `--titlebar-bg` `:3`, ruban `:13`), `.pane-accent` à `:526`.
**`src/themes.ts`** : `SkSettings` `:6`, `DEFAULT_SETTINGS` `:26` (`theme:"superkitty"`), `THEMES` `:48`, `FONT_CHOICES` `:37`.
**`src/SessionSidebar.tsx`** : `SessionSidebar()` `:33`, markup `.sidebar` `:70` / `.session-item` `:100`.
**`src/layouts.ts`** : `Rect` `:10`, `LAYOUT_CYCLE` `:26`, `layoutRects` (la fonction de placement à réutiliser).
**`src/Settings.tsx`** : `CATEGORIES` `:21`, rendu par catégorie `:91+` (pour y loger le toggle si voulu).
**`src/Terminal.tsx`** : `TerminalView` (montage PTY, `pty_detach` au unmount — d'où l'impératif de garder monté).

## 9. Source de vérité & vérification

- **Cahier des charges visuel + interactif :** `design/ui-proto-hybride.html`. L'ouvrir (`open design/ui-proto-hybride.html`), cliquer projets/fenêtres, ▦, Esc. Le rendu v2 doit y correspondre.
- **Test bout-en-bout :** `npm run tauri dev` → cliquer le bouton de bascule → comparer la v2 à la maquette. Vérifier : (a) un agent en cours **survit** au switch v1↔v2 ; (b) le fenêtrage marche en v2 (▦ change la disposition, animé) ; (c) zoom d'une fenêtre + retour Esc ; (d) v1 **strictement inchangée**.
- **À la fin :** mettre à jour `IDEAS.md` (relié à l'idée #2 « sidebar de sessions » qui devient ce rail projet ; #17 teintes projet ; #5 worktrees pour plus tard), `CLAUDE.md` (section UI / nouveau mode), et ce brief en statut `✅` avec la cause/solution réelle. Penser à la mémoire `charte-graphique` (TODO « mock d'interface » levé par ces protos).

## 10. Question ouverte (à confirmer avec l'utilisateur si besoin)

- **▦** : simple cycle aveugle, ou ouvre le **sélecteur visuel** `LayoutPicker` (miniatures) ? (L'utilisateur a évoqué préférer un petit sélecteur visuel — par défaut, brancher `LayoutPicker`.)
  → **Tranché : `LayoutPicker` visuel** (le même composant qu'en v1, réutilisé dans la topbar v2).

---

## 11. Résolution (2026-06-27)

**Livré.** Bascule **v1 ↔ v2** (persistée dans `superkitty.settings.v1`, défaut `classic`),
accessible 3 façons : bouton **`✦ v2`** dans la barre de titre v1, bouton **`Vue classique`**
dans la topbar v2, commande palette `⌘K`, et **Réglages → Apparence** (sélecteur Classique / v2).

**Fichiers touchés (frontend uniquement, comme prévu — aucun backend Rust) :**
- `src/themes.ts` — `SkSettings.uiMode` + `PLATINUM_NOIR_THEME` (thème xterm chaud appliqué *live* en v2, la v1 garde le thème choisi).
- `src/ProjectRail.tsx` *(nouveau)* — `ProjectRail` (rail projet) + `V2Crumb` (fil d'Ariane). Projection pure de l'état (projets = `Tab`, sessions = panes) ; **aucune session/PTY créée** ici.
- `src/App.tsx` — `toggleUiMode`, `selectProject`, `drillPane` (zoom), `backToGrid`, `newWindowInProject`, sondage `pty_foreground` (statut rail, v2 only), projection `railProjects`, override `termTheme`, **restructuration du rendu** (topbar v2 + rail + crumb), commande palette.
- `src/App.css` — tokens « Platinum Noir » + tout le chrome v2, **scopé `.app.ui-v2`** (la v1 ne bouge pas) ; wrapper `.main-col`.
- `src/Settings.tsx` — sélecteur « Mode d'affichage » dans Apparence.

**Invariant n°1 tenu (vérifié).** Basculer de mode **ne démonte aucun pane** : la chaîne
`.app > .body > .main-col > .workspace` reste à un **index de réconciliation stable** dans les
deux modes (les chromes conditionnels — topbar/titlebar, rail, crumb, sidebar, statusbar — sont
des `&&`/ternaires à **position fixe**, jamais des wrappers du workspace). `.tab-root`/`TerminalView`
sont keyés par id, indépendants de `uiMode`. Donc `pty_kill`/`pty_detach` ne se déclenchent pas au
switch → un `claude` en cours **survit** v1→v2→v1. *Confirmé indépendamment par 3 agents de revue.*

**Décisions de design appliquées :** statut harmonisé (une pastille, **orange = te réclame
UNIQUEMENT, jamais de cloche**) → la cloche (`activity`/idée #6) pilote **« terminé » (vert fixe)**,
pas l'orange ; l'orange reste **réservé** à un vrai signal « attend ton input » qu'on ne sait pas
encore détecter de façon fiable. ▦ = `LayoutPicker` visuel. Fenêtrage kitty conservé. Multicolor en touches.

**Écarts assumés (vs proto) — documentés ici exprès (cf. §3) :**
- **Esc** ne dézoome **que si le terminal n'a pas le focus** (sinon Esc va au terminal — `claude`/`vim` en ont besoin ; règle n°1 du projet : ne jamais casser le terminal). Retour fiable : bouton **← grille du projet** ou **⌃⇧Z**.
- **Cliquer le corps d'un pane** focalise (pour taper), il ne zoome pas. Le drill se fait depuis le **rail** (clic session) ou le bouton **⛶** du pane.
- **Worktrees / épingles / « Afficher N de plus » / horodatage** : **non rendus** (pas de donnée réelle — on ne fabrique pas de fausse info). Worktrees = idée #5, séparée. La méta de session affiche l'index de la fenêtre.
- **Presets d'agent** (✻ claude · ◆ codex · ✦ gemini · +) : visuels OK, **tous câblés sur « nouvelle fenêtre dans ce projet »** (pas de lancement auto de l'agent — racerait le spawn du shell).
- **v1 « strictement inchangée »** : vrai au niveau **comportement** ; le seul ajout au chrome v1 est le **bouton de bascule `✦ v2`** (demandé par le brief §6.2).

**Revue adversariale (workflow multi-agents, 4 dimensions × verify) :** 8 findings confirmés sur 17,
tous traités sauf 1 hors-périmètre (cadence des astuces StatusBar `180s` vs `~9s` doc — pré-existant,
idée #22, sans rapport avec la v2). Corrigés : mapping de statut (ci-dessus), Esc-retour, états
interactifs chauds des overlays en v2 (hover/active violets en dur → tokens chauds scopés), alignement
du compteur du rail, garde dans `newWindowInProject`, règle `.body` redondante retirée.

**Vérifié :** `tsc`, `vite build`, `cargo check` passent. **Reste à faire (manuel) :** `npm run tauri dev`
→ clic `✦ v2`, comparer à `design/ui-proto-hybride.html`, et confirmer qu'un agent en cours survit au switch.
