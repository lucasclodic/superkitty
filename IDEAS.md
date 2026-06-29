# 💡 Idées & Checklist — superkitty

Backlog des fonctionnalités à construire, dans l'esprit *friction-first* du projet
(chaque item retire une friction concrète d'usage de Claude Code dans un terminal).

Légende : `[ ]` à faire · `[~]` en cours · `[x]` fait

---

## ✅ Livré dans cette session (récap)

Construits d'un coup, fidèles aux mouvements de kitty + idées maison (tout compile : `tsc`, `cargo check`, `vite build`) :

- **#9 Zoom de pane** (`⌃⇧Z` / `⌘⇧↵`, façon `toggle_layout stack`) + bouton ⛶ par pane.
- **Scroll kitty + #14 promote-to-main** : `⌃⇧↑/↓` ligne, `⌃⇧PgUp/PgDn`, `⌃⇧Home/End`, `⌥⌘↑/↓` prompt-à-prompt ; `` ⌃⇧` ``/`⌘⇧M` promote ; `⌃⇧F/B` move-in-list.
- **#10 Numéros d'onglet** + tooltip `⌘N`.
- **#1 Rouvrir le dernier fermé** (`⌘⇧T`, historique persisté, pane **et** onglet).
- **#12 Palette de commandes** (`⌘K`, fuzzy, + sessions tmux).
- **#11 Menu clic droit** (réutilise la palette).
- **#3 Settings** (`⌘,` ou ⚙ titlebar, panneau 2 volets : thèmes xterm live, police, toggle notifs, raccourcis réassignables).
- **#6 Notifications fin d'agent** (BEL → traînée lumineuse autour du pane jusqu'au clic + son `afplay` + notif macOS `osascript`).
- **#7 Nouveau pane = login shell frais** (`$SHELL -l`, ignoré au réattach).
- **#15 Picker de fichiers** (`⌘P`, `git ls-files`) + drag de tout fichier.
- **#4 Coller image** (`⌘V` → sauve dans `~/.superkitty/dropped/` → injecte).
- **#17 Renommer onglets** (double-clic) + **teinte auto par projet** (hash du cwd).
- **#20 Scratchpad par onglet** (`⌃⇧N`, persisté, envoi au pane).
- **#16 Composeur multi-lignes** (`⌘E`, `⌘↵` envoie, paste image inline).
- **#19 Mode Quake** (hotkey global `` ⌃` ``, dropdown choix-projet + prompt).
- **#5 Sandbox par pane** (Seatbelt write-confinement, badge 🔒).
- **Mode d'affichage « v2 » — rail projet « Platinum Noir »** (bascule `✦ v2` / palette `⌘K` / Réglages → Apparence, persisté `uiMode`). Re-skin + re-disposition **par-dessus le même moteur** : projet = onglet, session = pane ; rail à gauche, topbar fine, fil d'Ariane `projet › fenêtre`, drill = zoom existant, fenêtrage kitty entier, statut harmonisé (orange = te réclame uniquement, jamais de cloche → la cloche pilote « terminé » vert fixe). Aucun pane démonté au switch (chaîne `.app > .body > .main-col > .workspace` à index stable). Scopé `.app.ui-v2`, la v1 ne bouge pas. Relié à **#2** (sidebar → rail projet), **#17** (teintes projet réutilisées), **#5/worktrees** (nœud différé). Voir `handoff/2026-06-27-mode-affichage-v2-rail-projet.md` (statut ✅).
  - [x] **Rail réduit (mini).** Le rail a 3 largeurs cyclées par le bouton ⊟ de la topbar et `⌘B` : **complet** (280px) → **réduit** (barre fine ~52px) → **masqué**, persisté (`settings.railMode`, défaut `full`). Le mini-rail garde la navigation : pastilles de teinte des projets (clic → projet, infobulle `⌘1-9`), pastilles de statut des fenêtres du projet actif (clic → drill/zoom), témoin d'activité sur les projets non-actifs. Boutons ‹ (réduire) dans le rail complet, › (déplier) dans le mini.

À affiner plus tard : confinement *lecture* du sandbox, vraie fenêtre Quake redimensionnée descendant du haut, picker `@` déclenché à la frappe, resizers draggables, sortie compressée (#8). **v2 :** brancher le nœud Worktrees (idée #5), l'horodatage par session, les épingles (les presets d'agent sont branchés — clic sur un logo = nouvelle fenêtre + agent lancé directement au spawn, vrais logos en blanc).

---

## 0. Sessions : terminaux **normaux par défaut**, tmux **à la demande** (pivot 2026-06)

> Avant : *chaque* pane était une session tmux. Conséquence : fuite massive — `pty_detach` (le close normal) garde tmux vivant et rien ne nettoie, donc des dizaines de sessions mortes s'accumulaient (constaté : 59 vivantes, 2 attachées). Le but n'est pas d'avoir des sessions tmux partout, c'est de pouvoir en ouvrir une facilement.

- [x] **`PaneKind` (`raw` | `tmux`) par pane**, choisi à la création, stocké dans `AppState.paneKind` (persisté dans le blob layout ; pane restauré sans entrée → migré `tmux`). Backend : `pty_spawn` prend `kind`, `PtyInstance` stocke `kind` + `child_pid`.
- [x] **`raw` = défaut (⌘D)** : PTY qui lance `$SHELL -l` directement (sandbox-exec optionnel), `$SUPERKITTY`/`TERM` via `cmd.env`. Fermer = `SIGHUP` du shell (`raw_hangup`) → éphémère, **zéro accumulation**. N'entre pas dans l'historique `⌘⇧T`, n'apparaît pas dans la sidebar.
- [x] **`tmux` = à la demande** : commande « Nouvelle fenêtre tmux (persistante) » (`⌥⌘D` + palette + clic droit). Garde toute la persistance (survit à la fermeture, sidebar, réattach).
- [x] **Réimplémenté pour les panes raw** (ce que tmux donnait gratis) : scroll via scrollback xterm natif (`scrollback: 50000`, touches kitty → `term.scroll*`), cwd via `tcgetpgrp`+libproc (`proc_pidinfo`), foreground via `proc_pidpath` (claude = `node` → garde-fou #13 OK). Bell (détection `0x07`) et sandbox marchaient déjà en brut.
- [x] **Nettoyage manuel** des 59 résiduelles → tué 23 shells `zsh` idle détachés, gardé les `claude`/attachées (38 restantes).
- [ ] **Phase D — GC tmux** (confort, plus urgent vu que raw stoppe l'accumulation) : commande **« Nettoyer les sessions »** + `tmux_prune` (allowlist sûre : jamais attachée, jamais non-shell type `claude`/`node`, jamais hors-`superkitty-`) + prune au lancement.
- [x] **Relancer l'agent d'un pane raw au redémarrage.** Un pane raw lancé via un preset d'agent du rail v2 (`claude`/`codex`/…) ne repartait qu'en shell nu après un relancement de l'app (la commande vivait dans `spawnCmdRef`/`paneAgent`, non persistés). Désormais `AppState.paneCommand` + `AppState.paneCwd` persistent la commande **brute** + le cwd de lancement par pane raw ; au démarrage on re-sème `spawnCmdRef`/`spawnCwdRef`/`paneAgent` depuis ces champs. Un pane Claude est rejoué en **`claude --continue`** (reprend la dernière conversation **du dossier**) — la transformation « resume » (`RESUME_FLAG`, extensible) est dérivée au re-semis, jamais stockée ; les autres agents rejoués tels quels. Le cwd de lancement = cwd au moment de quitter (claude ne déplace pas le cwd du shell), donc capturer au lancement suffit. Limite assumée : le scrollback brut n'est pas conservé octet pour octet (propre au *raw* — `--continue` redessine la conversation ; pour du byte-for-byte → pane tmux).
- [x] **Pane raw « noir » au redémarrage** (conséquence directe du point ci-dessus). Un pane-agent raw rejoué pouvait revenir **complètement noir** : `pty_redraw` était un no-op pour raw et `tryAttachRedraw` était sauté pour raw → **aucun mécanisme de repaint** quand la première frame de `claude` était perdue/partielle (dessin avant taille finale du slot, `fit()` sur conteneur 0px, rAF throttlé au montage) ; même le secours Cmd-Tab (`redrawAll`) ne faisait rien. Fix : (1) `pty_redraw` raw envoie `SIGWINCH` au process group de premier plan (`raw_repaint`/`raw_fg_pid`/`killpg`, l'équivalent non-tmux de `refresh-client` — claude/Ink/vim repeignent sans reflow) ; (2) `Terminal.tsx` lance `scheduleRawRepaints` (`[200,700,1600,3200]ms`, chaque passe `fit()` + `term.refresh()` + `pty_redraw`) ; (3) `redrawAll` repeint aussi via `paneTerminals.refresh()` au retour au premier plan. Voir CLAUDE.md « Black / frozen pane » (variante raw).
- [x] **Phase D — persister le cwd d'un pane raw** (couvert ci-dessus pour les panes d'agent via `AppState.paneCwd`). Reste à étendre aux panes raw ⌘D simples (sans commande) si on veut qu'un shell nu rouvre aussi dans son dossier.
- ⚠️ **Promotion raw→tmux à chaud : impossible** sur macOS (pas de reptyr/SIP — on ne reparente pas un process en cours dans tmux). Au mieux « re-home » = redémarrer le shell ; à n'offrir qu'avec avertissement.

Voir la mémoire `session-architecture-pivot` et la section « PTY + persistence » de `CLAUDE.md`.

---

## 1. Rouvrir une fenêtre/onglet fermé (façon Chrome ⌘⇧T)

> Quand je ferme un onglet ou un pane par erreur, je veux pouvoir le rouvrir.

- [x] Garder une pile des sessions récemment fermées (id tmux, layout, titre) → `AppState.closed`.
- [x] Raccourci `⌘⇧T` pour rouvrir la dernière fermée (et dépiler à chaque appel).
- [x] Décider du comportement avec tmux :
  - `pty_detach` (close « doux ») → la session tmux vit encore, on réattache (`⌃⇧W`/`⌘⇧D`).
  - `pty_kill` (⌘W) → la session est détruite ; « rouvrir » = recréer le pane/onglet frais au bon cwd.
- [~] Idéal : transformer ⌘W en *detach*. (⌘W reste un kill avec confirmation, mais l'onglet fermé entre **quand même** dans l'historique → « rouvrir » recrée frais ; `⌃⇧W` détache déjà.)
- [x] Persister cet historique dans `localStorage` pour survivre à un restart de l'app.
- [x] **Clic droit** → menu contextuel avec « Rouvrir le dernier fermé », en plus du raccourci `⌘⇧T`.

## 2. Ouvrir / lister les sessions tmux

> Pouvoir voir et rattacher les sessions tmux qui tournent déjà.

- [x] Commande backend pour lister les sessions tmux (`tmux_list_sessions` → `tmux list-sessions`, nom/attaché/fenêtres/dates).
- [x] UI (sidebar `⌘B`) listant les sessions `superkitty-*` **et** externes + leur état (point accent = attaché, « ouverte ici »).
- [x] Cliquer une session → l'ouvrir dans un nouveau pane du tab actif (réattache par `id` ; si déjà ouverte → focus).
- [x] Pouvoir ouvrir une session tmux « brute » (non préfixée) : pane neuf mappé sur son nom (`AppState.sessions`, persisté).
- [x] Bouton pour tuer une session depuis la liste (🗑 → `tmux_kill_session`, retire le pane si ouvert).
- [x] (relié à M4 « session sidebar » du roadmap)

## 3. Settings (thème, raccourcis, etc.)

> Un panneau de réglages pour changer vite l'apparence et les shortcuts.

- [x] Panneau Settings (modale **à 2 volets** : rail de catégories à gauche, contenu à droite), ouvrable via `⌘,` **ou le bouton ⚙ de la barre de titre** (en face des onglets).
- [x] **Thèmes** : choisir un thème xterm (couleurs, fond, curseur), preview en direct.
  - [x] Quelques thèmes intégrés (Superkitty, Tokyo Night, Solarized Dark/Light, GitHub Light).
  - [x] Police + taille de police.
- [x] **Raccourcis** : voir (référence groupée + recherche) **et remapper** — chaque action a des chords réassignables (capture clavier, conflits gérés, réinitialisation), alimentés par une source unique (`src/shortcuts.ts`), persistés dans `localStorage` (`superkitty.keys.v1`).
- [x] Persister les settings dans `localStorage` (`superkitty.settings.v1`).
- [x] Appliquer à chaud sans redémarrer (props `theme/font` → `term.options`, sans recréer le terminal).

## 4. Drag & drop de screenshots dans le chat (= M2 du roadmap)

> Déposer une image → son chemin est injecté dans le pane focus (Claude lit les chemins d'images).

- [x] Zone de drop sur le pane focus (overlay visuel pendant le drag).
- [x] Sauver l'image dans un dossier (`~/.superkitty/dropped/`) — pour les images **collées** (`⌘V`) ; un fichier déposé garde son chemin d'origine (déjà stable).
- [x] Injecter le chemin du fichier dans le PTY focus (`pty_write`) — en **bracketed paste** (`ESC[200~ … ESC[201~`) pour que Claude affiche `[Image #1]` comme un vrai terminal.
- [x] Gérer le coller (`⌘V`) d'une image depuis le presse-papier (event `paste` → `save_image` → injection).
- [x] Gérer plusieurs images d'un coup.

## 5. Sandbox : restreindre Claude au dossier courant

> Lancer Claude dans un bac à sable où il ne voit que le dossier de travail, pas tout le reste du Mac.

- [x] Option par pane : « sandboxé » → **écriture** confinée au `cwd` (lecture laissée libre pour ne pas casser les outils).
- [~] Choisir le mécanisme de confinement :
  - [x] `sandbox-exec` (Seatbelt macOS) avec un profil write-confinement du dossier courant.
  - [ ] Conteneur / VM légère (non retenu).
  - [ ] Permissions natives de Claude Code (non retenu).
- [x] UI : badge 🔒 quand un pane est sandboxé.
- [x] Choisir le dossier racine : le `cwd` hérité au moment de créer le pane.
- [~] Garder l'accès aux binaires système (node, git, claude…) — fait pour l'**écriture** ; bloquer la **lecture** du `$HOME` reste à faire (fragile, casse la config/cache de Claude).
- [x] Bien gérer tmux : le sandbox enveloppe le shell dès le `tmux new-session` → tout l'arbre (claude inclus) hérite.

## 6. Notifications quand un agent a terminé

> Quand Claude finit de bosser dans un pane que je ne regarde pas, je veux être prévenu.

- [x] Détecter la fin d'un run d'agent dans un pane.
  - [x] Piste : guetter la cloche du terminal (`BEL` 0x07) → octet détecté dans le thread lecteur → event `pty://bell/<id>`.
  - [ ] Piste : détecter le retour au prompt / l'inactivité (non nécessaire, le BEL suffit).
- [x] Notification système macOS — via **`tauri-plugin-notification`** (attribuée au bundle superkitty : fiable, vs. l'ancien `osascript` que macOS attribuait à « Script Editor » et silençait/rate-limitait).
- [x] **Fiabilité** : la chaîne reposait sur un seul signal fragile (la cloche du `claude` interne). Durcie sur trois fronts — (1) tmux forcé par session à acheminer le BEL brut (`visual-bell off` + `bell-action any` + `monitor-bell on`, sinon un défaut `bell-action other` n'envoie jamais rien pour une session mono-fenêtre) ; (2) anti-rebond des cues OS + surbrillance toujours posée (découplée du gating) ; (3) **filet opt-in** (Settings → Notifications → « Renforcer la détection de fin d'agent ») : hook `Stop`/`Notification` gardé par `$SUPERKITTY` dans `~/.claude/settings.json`, qui force un BEL à chaque fin de tour — actif uniquement dans superkitty.
- [x] **Sémantique (le faux positif « agent terminé »)** : un BEL nu sonne AUSSI en plein travail (un sous-agent qui finit…) → fausses notifs. Corrigé en rendant le signal **sémantique** : le BEL devient une simple **sonnette**, le *type* voyage via un **fichier marqueur vide par pane et par évènement** que le hook touche AVANT de sonner — `Stop` → `<pane>.stop`, `Notification` → `<pane>.notif` (dans `~/.superkitty/signals/`, 0700). **`SubagentStop` n'est PAS installé** → la fin d'un sous-agent ne notifie jamais. Le thread lecteur consomme le marqueur → `BellPayload { kind }` (`stop` | `notification` | `unknown`). `handleBell` : `stop` → « terminé » (vert), `notification` → « te réclame » (orange, set `need`), **`unknown` (BEL natif/sous-agent) → traînée seule, jamais de notif/son** = le correctif. Hooks **activés par défaut** (« Notifications fiables », réconcilié au lancement, migration OFF→ON sauf opt-out explicite via `reinforceAgentDoneUserSet`) ; commande hook idempotente + `; true` (no-op silencieux hors superkitty), `SUPERKITTY_PANE=<id>` identifie le pane. → réalise enfin l'orange « te réclame » du rail v2.
- [x] Badge visuel sur l'onglet/pane concerné quand il n'est pas focus : **traînée lumineuse aux couleurs du ruban superkitty** qui encadre le pane (conic-gradient animé + halo), persistante **jusqu'à ce que tu engages le pane** — clic/focus (`setFocus`) ou frappe dans le pane (`onInteract`) ; le retour sur l'app (⌘Tab) ne l'efface pas.
- [x] Petit **son** quand un agent termine (commande Rust `play_sound` → `afplay` du son système « Glass »), réglable indépendamment.
- [x] Ne notifier que pour les panes non-actifs (pas celui que je regarde + fenêtre focus).
- [x] Réglage notifications on/off et **son** on/off (dans Settings → Notifications). Pas de passage au premier plan forcé (volontaire).

## 7. Nouveau shell = shell frais (comme kitty)

> Quand j'ouvre un nouveau window/pane, ça doit lancer un shell propre qui recharge tout
> l'environnement (PATH, aliases, `.zshrc`…), pas hériter d'un état figé.

- [x] Un nouveau pane = session tmux neuve qui lance un **login shell** (`exec $SHELL -l`).
- [x] Repartir du `cwd` voulu (dossier du projet, hérité) et d'un env rechargé à chaque ouverture.
- [x] ⚠️ Tension avec la persistance tmux : *réattacher* reprend l'état d'avant ; *créer* démarre frais.
      Bien distingué — tmux ignore la commande de création sur un `-A` (réattach).
- [~] Vérifier le PATH dans un bundle lancé depuis le Finder (le login shell aide ; à valider sur un build).
- [ ] Option « repartir de zéro » pour un pane existant (relancer un shell propre sans changer d'id ?).

## 8. Économiser les tokens en compressant les outputs

> Beaucoup de projets réduisent la conso de tokens de Claude Code en compressant les
> sorties verbeuses avant qu'elles n'entrent dans le contexte. superkitty possède déjà
> le PTY → on est l'endroit idéal pour intercepter et compresser la sortie des commandes.

**Les 4 familles d'approches vues dans l'écosystème :**

1. **Compresseur de sortie de commande** (le plus pertinent pour nous — on a le PTY) :
   - [`chop`](https://github.com/AgusRdz/chop) : compresse la sortie de 52+ commandes (git, docker, kubectl, npm, terraform…) → -50 à -90 %.
   - [`sqz`](https://github.com/ojuschugh1/sqz) : -24 % en moyenne, gros gain via **dédup** (un fichier lu plusieurs fois → envoyé une fois + référence compacte).
   - `rtk` (Rust Token Killer) : proxy CLI qui filtre/compresse la sortie avant le contexte.
2. **Proxy au niveau API** (intercepte les appels Claude, transparent) :
   - [`ClaudeSlim`](https://github.com/apolloraines/claudeslim) : -60 à -85 %, proxy local, zéro modif de Claude Code.
   - [`tamp`](https://github.com/sliday/tamp) : -50 %, « zero behavior change ».
   - [Headroom](https://dev.to/arshtechpro/headroom-cut-your-llm-token-usage-by-up-to-95-without-changing-your-answers-5g06) : route le contenu vers le bon compresseur selon son type, -60 à -95 %.
3. **Style de réponse / config** (le moins technique) :
   - [`caveman`](https://github.com/juliusbrussee/caveman) : skill qui fait parler Claude « comme un homme des cavernes » → -65 %.
   - CLAUDE.md terse, [`claude-token-optimizer`](https://github.com/nadimtuhin/claude-token-optimizer) : prompts pour rendre les réponses concises.
4. **Code graph / knowledge graph** (la plus prometteuse, mais *pas du ressort du terminal*) :
   - [`graphify`](https://github.com/safishamsi/graphify) : indexe le repo via tree-sitter (AST) en un graphe requêtable (fonctions, imports, « qui appelle qui »…). Claude **interroge le graphe** au lieu de lire des fichiers entiers.
   - Constat de fond : un agent gaspille ~80 % de ses tokens juste à *chercher* où sont les choses. Sur une question structurelle, une requête de graphe répond en ~1,7k tokens là où grep+read en brûlait 123k.
   - Bonus qualité : moins de contexte inutile = meilleures réponses (un LLM raisonne moins bien noyé sous l'info non pertinente).
   - Limites : aide à *trouver/comprendre*, pas à *écrire* ; le graphe se désynchronise du code (ré-indexer) ; les « -71x » sont du best case marketing. Cité dans mon thread Reddit (graphify + headroom).

**Repère « est-ce que ça marche ? » (du plus solide au plus gadget pour superkitty) :**
- 🟢 Code graph (graphify) — le plus prometteur sur gros repos, **mais c'est un skill Claude Code**, installable indépendamment du terminal.
- 🟢 Compresseur de sortie (chop/sqz) — solide et sans risque si lossless ; **c'est notre terrain naturel** (on a le PTY).
- 🟡 Proxy API (headroom/claudeslim) — marche mais risqué (confiance + perte d'info silencieuse).
- 🟠 Style caveman/terse — effet réel mais limité, peut nuire à la qualité du raisonnement.

> ⏸️ **Pas prioritaire / pas obligatoire.** Le code graph est surtout un skill que l'utilisateur peut déjà installer lui-même. Question ouverte : superkitty doit-il *faciliter* ça (bouton « indexer le projet ouvert ») ou rester un terminal ? Côté terminal pur, viser d'abord la famille « compresseur de sortie ».

**Pistes concrètes pour superkitty :**
- [ ] Option par pane : « mode économe » qui passe la sortie dans un compresseur (façon `chop`) avant de l'afficher / la laisser lire à Claude.
- [ ] Idée clé = **réversible/lossless** : ne jamais jeter l'original, garder une référence pour que Claude puisse récupérer la version complète si besoin (cf. sqz/Headroom).
- [ ] Dédup des lectures de fichiers répétées dans une session.
- [ ] Afficher un compteur « tokens économisés » (effet wow + utile pour régler).
- [ ] ⚠️ Subtilité : Claude lit la sortie *du terminal*. Compresser ce que l'humain voit ≠ ce que Claude voit. Bien cibler quoi compresser et pour qui.

## 9. Bouton de taille sur chaque fenêtre (toggle plein écran rapide)

> Sur chaque pane, un petit bouton pour changer sa taille en un clic — par ex. passer
> la fenêtre en plein écran (maximisée dans l'onglet) et re-cliquer pour revenir.

- [x] Petit bouton ⛶ dans le pane (visible au survol) pour basculer sa taille.
- [x] Clic → la fenêtre passe en plein écran (occupe tout l'onglet), re-clic → retour au layout normal.
  - [x] Réutiliser le layout `stack` (le flag `zoomed` force `stack` sans toucher le layout réel).
  - [x] Mémoriser le layout précédent → revenir exactement à l'état d'avant (layout réel jamais modifié → restauration exacte, lossless).
- [x] Raccourci clavier équivalent : `⌃⇧Z` (kitty `toggle_layout stack`) et `⌘⇧↵`.
- [ ] Éventuellement d'autres boutons de taille (cycler les layouts depuis le pane).
- [x] Indicateur visuel quand un pane est « zoomé » (le bouton ⛶ devient 🗗 ; les autres panes sont cachés).

## 10. Afficher les raccourcis de navigation des onglets (⌘1…⌘9)

> On peut déjà sauter à l'onglet N avec `⌘1`…`⌘9`, mais rien ne le montre.
> Afficher le numéro sur chaque onglet pour rendre le raccourci découvrable.

- [x] Afficher le numéro de l'onglet (1, 2, 3, 4…) sur chaque onglet de la barre.
- [x] Indiquer clairement que c'est `⌘ + numéro` (tooltip au survol `⌘N`).
- [x] Garder la numérotation cohérente avec l'ordre réel des onglets (index de la liste → re-numéroté automatiquement).
- [ ] Idem côté fenêtres/panes si pertinent : montrer comment focus un pane précis.
- [x] (relié à l'idée 3 « Settings > Raccourcis » : cheat-sheet listant tous les shortcuts.)

## 11. Menu clic droit pour gérer fenêtres/panes (sans raccourci)

> Pouvoir tout faire à la souris : clic droit → ajouter une nouvelle fenêtre/pane,
> en fermer une, réorganiser, plutôt que de devoir connaître les raccourcis clavier.

- [x] Menu contextuel (clic droit sur un pane) avec les actions principales :
  - [x] « Nouvelle fenêtre / pane » (+ « sandboxée »).
  - [x] « Nouvel onglet ».
  - [x] « Fermer cette fenêtre / cet onglet ».
  - [x] « Rouvrir le dernier fermé » (cf. idée 1).
- [x] Toutes les actions clavier accessibles à la souris (le menu + la palette `⌘K`).
- [x] Afficher le raccourci à côté de chaque entrée du menu (apprentissage des shortcuts).
- [x] Éventuellement : changer le layout / zoomer un pane depuis ce même menu.

## 12. Palette de commandes (`⌘K`)

> Un overlay de recherche qui surgit avec `⌘K` (ou `⌘⇧P`) et permet de lancer
> n'importe quelle action en tapant son nom — façon VS Code / Raycast / Spotlight.
> C'est la réponse « clavier » à la même friction que les idées 10 et 11 : la **découvrabilité**.

- [x] Overlay modal centré, ouvert par `⌘K`, fermé par `Esc`.
- [x] Liste filtrable en *fuzzy search* : on tape quelques lettres → la liste se réduit, `↵` exécute, `↑/↓` navigue.
- [x] Référencer toutes les actions : onglet/fenêtre, layout, aller à l'onglet N, fermer, rouvrir, sandboxer, Settings, scroll…
- [x] Afficher le raccourci à côté de chaque action → on apprend les shortcuts en s'en servant.
- [x] Brancher la liste des sessions tmux (idée 2) : taper le nom d'une session pour la rattacher.
- [ ] Éventuellement : actions « projet » (ouvrir un dossier récent, lancer `claude` dans un nouveau pane).
- [x] (chapeaute les idées 10 et 11 : même problème de découvrabilité, résolu au clavier.)

## 13. Confirmer avant de fermer un pane où un agent tourne

> Éviter de tuer un `claude` en plein travail par un `⌘W` / `⌃⇧W` réflexe.

- [x] Détecter qu'un agent tourne dans le pane (commande backend `pty_foreground` → tmux `#{pane_current_command}` ; « occupé » = process en avant-plan qui n'est pas un shell de login).
- [x] Sur `pty_kill` (⌘W = fermer l'onglet), si un agent tourne → demander confirmation avant de détruire. ⚠️ Note : `⌃⇧W`/`⌘⇧D` (fermer un pane) **détachent déjà** (session gardée vivante, réouvrable par `⌘⇧D`), donc seul `⌘W` détruit et a besoin du garde-fou.
- [x] Confirmation légère (modale) avec « Fermer quand même » et `Esc` pour annuler.
- [x] Idéalement proposer **« Détacher plutôt que tuer »** → garde la session tmux vivante (entre dans la pile des fermées, réouvrable par `⌘⇧D`). C'est le défaut sûr (touche `↵`).
- [ ] Réglage on/off dans les Settings (idée 3) pour ceux que la confirmation gêne.

## 14. Déplacer / réorganiser les panes au clavier (comme kitty)

> Ex. : une moitié d'écran avec un shell, l'autre moitié avec deux shells. Je veux pouvoir
> **bouger** une fenêtre d'une position à l'autre facilement (`⌘`+flèches), pas juste la focus.

- [x] Action « déplacer le pane » : échanger/réordonner le pane focus avec son voisin (gauche/droite/haut/bas).
- [x] Raccourci dédié, ex. `⌘⇧`+flèches pour *déplacer* (les `⌘`+flèches actuels gardent le *focus*).
- [x] Réutiliser `neighbor()` de `layouts.ts` pour trouver le voisin dans la direction donnée.
- [x] Déplacer = réordonner la liste `panes` du tab → tout le layout se recalcule (rien ne se casse).
- [x] Promouvoir un pane en « main » (le gros de `tall`/`fat`) via un raccourci `` ⌃⇧` `` / `⌘⇧M`, façon kitty (`move_window_to_top`).
- [x] Persister le nouvel ordre dans `localStorage` (comme le reste du layout).
- [ ] (alternative souris : drag & drop d'un pane sur un autre pour les échanger — relié à idée 11.)

## 15. Drag de n'importe quel fichier + picker `@` (généralise l'idée 4)

> Glisser un fichier (pas que des images) depuis le Finder → son chemin s'injecte dans le
> pane focus, façon `@mention`. Et un picker `@` natif pour les fichiers du projet.

- [x] Étendre le drag & drop de l'idée 4 à **tout type de fichier** (le handler injecte déjà tout chemin déposé).
- [x] Déposer un fichier → injecter son chemin dans le PTY focus (`pty_write`), sans le copier.
- [x] Gérer plusieurs fichiers d'un coup.
- [~] Picker de fichiers du `cwd`, `↵` insère le chemin — fait via **`⌘P`** (déclenchement par raccourci, façon kitty *hints*) plutôt que par la frappe d'`@` (jugée trop intrusive).
  - [x] Réutiliser la même UI de *fuzzy search* que la palette `⌘K` (`fuzzyScore`).
  - [x] Se limiter au `cwd` / respecter `.gitignore` (`git ls-files`).
- [~] Chemin **relatif** au `cwd` injecté (Claude le résout) ; absolu non distingué pour l'instant.

## 16. Composeur de prompt multi-lignes

> Une vraie zone de texte pour écrire un prompt long confortablement, puis l'envoyer au
> pane focus. Fini de se battre avec l'éditeur de ligne du terminal pour les retours à la
> ligne, le déplacement du curseur et la souris.

- [x] Zone de texte dédiée (overlay flottant) avec un vrai éditeur multi-lignes (`⌘E`).
- [x] **Retours à la ligne libres** : `↵` insère une nouvelle ligne, `⌘↵` envoie le prompt.
- [x] **Souris** : édition normale dans la textarea.
- [x] Coller une **image inline** dans la zone → la sauver + insérer son chemin (relié aux idées 4 et 15).
- [~] Confort d'édition : textarea simple (undo/sélection natifs) ; markdown/coloration pas encore.
- [x] À l'envoi : transmettre le texte au PTY focus en **bracketed paste** (bloc unique).
- [ ] Garder un historique des prompts envoyés.
- [ ] Brancher le picker `@` (idée 15) et une bibliothèque de snippets dans cette zone.

## 17. Renommer onglets/fenêtres + code-couleur par projet

> Ne jamais confondre deux projets ouverts côte à côte : chaque repo reçoit une teinte,
> et on peut renommer librement onglets et fenêtres (panes) et choisir leurs couleurs.

- [x] **Renommer un onglet** (double-clic sur le titre, ou palette), titre persistant.
- [ ] **Renommer une fenêtre/pane** de la même façon (remplace les `p1/p2`).
- [~] **Changer la couleur à la main** : onglet ✓ (clic-droit → palette `TabColorPicker`, s'applique à tout l'onglet) ; pane individuel pas encore.
  - [x] Couleur par défaut **distincte par onglet** (palette `TAB_COLORS`, `pickTabColor` évite les doublons) — plus de répétition à l'ouverture.
- [x] **Code-couleur automatique par projet** : teinte dérivée du `cwd` (fallback des onglets legacy sans couleur) ; onglet (point) + bordure du pane focus (`--pane-accent`) la prennent → repérage immédiat.
  - [x] Déduire la couleur du chemin du projet (hash `cwd` → teinte HSL).
- [~] Titre auto par défaut : nom du dossier (`cwd`) ✓ ; + branche git pas encore.
- [x] Persister le titre **et la couleur** dans `localStorage` (couleur assignée stockée sur l'onglet).
- [~] Réglages/édition : double-clic (renommer) ✓ + clic-droit (couleur) ✓ ; depuis Settings pas encore.

## 18. Nouveau pane = même dossier courant (hériter le `cwd`)

> Quand je fais `⌘D` (nouvelle fenêtre/pane), elle doit s'ouvrir **dans le même dossier
> courant** que le pane d'où je viens — pas à `$HOME`. Comme kitty / iTerm.

- [x] À la création d'un pane (`⌘D` / `⌘↵` / `⌃⇧↵`), démarrer la nouvelle session tmux dans le `cwd` du **pane focus**, pas dans le home.
- [x] Récupérer le `cwd` réel du pane source (commande `pty_cwd` → tmux `#{pane_current_path}`), puis le passer au `tmux new-session` (option `-c <path>`).
- [x] Même logique pour un **nouvel onglet** (`⌘T`) : repartir du dossier du pane/onglet actif.
- [x] ⚠️ Cohérent avec l'idée 7 (login shell frais) : shell propre **au bon dossier** — le `-c` place la session, le login shell frais (`exec $SHELL -l`, idée 7) est fait.
- [x] Cas du tout premier pane (aucun parent) : tomber sur `$HOME` ou un dossier par défaut configurable. (pas d'entrée `cwd` → comportement tmux par défaut)

## 19. Mode « Quake » / dropdown global + lanceur rapide de prompt

> Un raccourci système (ex. `⌃\``) qui fait **descendre superkitty par-dessus n'importe quelle
> app**, où que tu sois, pour balancer un prompt à Claude sans changer de fenêtre — puis le re-cache.
> Petite surface : on choisit le projet (onglet), on tape, `↵`, et ça crée le pane et lance la demande.

- [x] **Hotkey global** `` ⌃` `` (via `tauri-plugin-global-shortcut`) invoque/masque superkitty depuis n'importe quelle app.
- [~] Apparence « Quake » : overlay qui **descend du haut** (animation CSS) ; la vraie fenêtre native redimensionnée en bandeau reste à faire.
- [x] **Choix du projet** : afficher mes onglets et me laisser :
  - [x] cliquer celui où je veux travailler, **ou**
  - [x] pré-sélectionner par défaut **le dernier onglet sur lequel j'ai fait une demande** (mémorisé).
  - [x] navigation clavier entre les onglets (`⌘1…9`).
- [x] **Champ de prompt** directement focus : je tape et `↵` envoie.
- [~] À l'envoi : envoyer au **pane focus de l'onglet choisi** + le lancer (`\r`). (réutilise le pane existant ; créer un nouveau pane = option à trancher)
  - [~] Option réutiliser vs créer : on **réutilise** le pane focus pour l'instant.
- [x] Réutiliser le `cwd` hérité (idée 18) — l'onglet a déjà son pane au bon dossier.
- [x] Après envoi : se re-cacher automatiquement (`window.hide()` ; notif de fin via idée 6).
- [ ] Réglages : choix du raccourci, position/taille du dropdown (Settings, idée 3).

## 20. Scratchpad / notes par onglet

> Un petit bloc-notes attaché à chaque projet (onglet) pour noter vite des TODO, un prompt
> en préparation, une URL, un bout de log — sans quitter superkitty ni polluer le terminal.

- [x] Volet bloc-notes ouvrable à côté du pane (toggle `⌃⇧N`), **par onglet/projet**.
- [~] Texte libre + cases à cocher TODO — on peut taper `[ ]`/`[x]` librement ; pas (encore) de cases cliquables.
- [x] Persistant dans `localStorage` (`superkitty.notes.v1`, rattaché à l'id de l'onglet).
- [x] Écrire un **prompt en préparation**, puis « envoyer au pane focus » (`⌘↵` / bouton ➤).
- [~] Markdown léger : texte brut pour l'instant.
- [ ] Éventuellement une note **globale** (pas liée à un projet) en plus des notes par onglet.
- [ ] (option future : stocker dans un fichier `NOTES.md` du projet plutôt qu'en `localStorage`.)

## 21. Sélecteur graphique de layout (menu visuel, pas la commande)

> Aujourd'hui on cycle les layouts au clavier (`⌃⇧L`) à l'aveugle : il faut taper plusieurs
> fois pour tomber sur le bon, sans voir ce que ça donnera. Je veux un **petit menu graphique**
> où chaque layout est dessiné en miniature → je vois d'un coup d'œil comment mes fenêtres
> seront arrangées (en fonction du nombre de panes ouverts) et je clique celui que je veux.

- [x] Menu/popover qui liste les layouts (`tall`, `fat`, `grid`, `horizontal`, `vertical`, `stack`) avec une **vignette de prévisualisation** de chacun (`src/LayoutPicker.tsx`).
- [x] Les vignettes reflètent le **nombre de panes réel** du tab actif : dessiner les rectangles via `layouts.ts` (`layoutRects(name, n, focusedIndex) → Rect[]`) à l'échelle → la preview est exacte, pas générique (le pane focus est teinté accent ; `stack` montre des cartes empilées).
- [x] Cliquer une vignette applique le layout immédiatement (et le persiste comme aujourd'hui, via `setLayout` → `localStorage`).
- [x] Marquer le layout actif dans le menu (surbrillance + bordure accent).
- [x] Ouvrir ce menu facilement : bouton ▦ dans la barre d'onglets (à côté de ☰). (au survol / coin du pane : pas encore)
- [x] Garder `⌃⇧L` (cycle rapide) en complément — le menu visuel est l'alternative découvrable « je vois avant de choisir ».
- [x] (relié à l'idée 11 « menu clic droit » et l'idée 12 « palette `⌘K` » : changer de layout depuis la palette — fait (chaque layout y est listé) ; « Disposition suivante » aussi dans le menu clic-droit.)

## 22. Hints / tips de raccourcis dans l'app (apprendre en s'en servant)

> Afficher des petites astuces contextuelles directement dans l'app pour faire découvrir
> les raccourcis aux nouveaux utilisateurs — qu'on apprenne à se servir de superkitty
> sans avoir à lire une doc. (même friction de **découvrabilité** que les idées 10, 11, 12.)

- [x] **Barre de hint discrète** (en bas à gauche de la status bar `StatusBar`) qui montre une astuce
      à la fois, ex. « Astuce : `⌘D` pour ouvrir une nouvelle fenêtre », et **tourne** (~9 s ; clic = suivante).
      Astuces générées dynamiquement depuis `src/hints.ts` (curatées) + `resolveBindings`/`formatChord`,
      donc elles reflètent les raccourcis **réassignés**. Le `×` de la barre les coupe (= toggle Settings).
- [ ] **Hints contextuels** selon ce que fait l'utilisateur :
  - [ ] un seul pane ouvert depuis longtemps → suggérer `⌘D` / `⌃⇧↵` pour splitter.
  - [ ] plusieurs panes → suggérer `⌘`+flèches (focus) et `⌘⇧`+flèches (déplacer).
  - [ ] plusieurs onglets → suggérer `⌘1…⌘9` pour sauter directement.
  - [ ] après un `⌃⇧L` à l'aveugle → pointer vers le picker visuel ▦ (idée 21).
- [ ] **Écran/overlay d'accueil** au premier lancement : les 4-5 raccourcis essentiels
      (nouvel onglet, nouveau pane, sidebar `⌘B`, changer de layout), avec « ne plus afficher ».
- [ ] **Cheat sheet** complète des raccourcis ouvrable à la demande (ex. `⌘/` ou `?`),
      reprenant le tableau du CLAUDE.md → liste de toutes les actions + leurs touches.
- [~] Ne pas être intrusif : tips **dismissables** (× → off) ✓ ; fréquence réglable et masquage
      « une fois qu'un raccourci a été utilisé » pas encore (tranché : rotation simple sur tout).
- [x] Réglage on/off dans les Settings (idée 3, volet **Raccourcis** → `settings.hintsEnabled`) pour les masquer entièrement.
- [ ] (relié aux idées 10 « numéros d'onglets », 11 « menu clic droit » et 12 « palette `⌘K` » :
      même objectif de découvrabilité ; la palette peut aussi servir de cheat sheet vivante.)

## 23. Zoomer le terminal (`⌘+` / `⌘-` / `⌘0`)

> Aujourd'hui on ne peut pas grossir/réduire la taille du texte à la volée : il faut passer
> par les Settings (idée 3) pour changer la taille de police, et `⌘+` / `⌘-` ne font rien.
> Je veux les raccourcis standards macOS pour zoomer directement, **sinon ça ne marche pas**.

- [x] **`⌘+`** / **`⌘=`** (agrandir) / **`⌘-`** / **`⌘_`** (réduire) ajustent la taille de police xterm
      en direct, sur **tous les panes** (tranché : zoom global, comme Terminal.app/iTerm ; réutilise
      le réglage `fontSize`, bornes 8–32 px).
- [x] **`⌘0`** remet la taille par défaut (14 px, `DEFAULT_SETTINGS.fontSize`).
- [x] Persister la taille choisie (réutilise le réglage `fontSize` des Settings, idée 3 → `superkitty.settings.v1`).
- [x] ⚠️ **AZERTY/QWERTY** : le zoom est résolu par **caractère** (`e.key` = `+`/`-`/`=`/`_`), **pas** par
      position physique (`e.code`) — sinon sur Mac AZERTY la touche « - » (placée au `code` `Equal`)
      inversait le sens. `⌘0` reste sur `e.code === "Digit0"` (la rangée des chiffres réclame Maj sur
      AZERTY), cohérent avec `⌘1–9`. Du coup ces 3 raccourcis ne sont **pas** dans la liste réassignable
      (`ACTIONS`) — la réassignation par position n'a pas de sens pour `+`/`-` multi-claviers — mais
      restent dans la palette `⌘K` (logique dans `App.onKeyDown`).
- [~] (optionnel) un petit contrôle visuel de zoom (boutons +/− quelque part) en complément
      des raccourcis — le **stepper des Settings** (panneau Police) joue déjà ce rôle ; pas de bouton flottant.

## 24. Masquer des shells (icône œil → bandeau à gauche, cloche quand Claude réclame)

> Quand je lance plusieurs agents Claude en parallèle, je n'ai pas besoin de tous les voir
> tout le temps. Je veux un truc **simple** : une **icône œil 👁 sur le pane** pour le **masquer**
> (le sortir de l'affichage **sans le tuer** — la session continue de tourner en arrière-plan).
> Les shells masqués s'empilent dans un **bandeau étroit sur la gauche** ; de là je peux les
> **démasquer** d'un clic. Et quand **Claude a besoin de quelque chose**, une **cloche 🔔**
> apparaît sur l'entrée du bandeau pour me dire « celui-là te réclame ».

- [ ] **Icône œil 👁 sur le pane** (au survol, près du ⛶ #9) → masque le pane : retiré de la grille
      de l'onglet **sans détacher la session tmux** (le process, `claude` inclus, continue ; ≠
      `pty_detach` qui lâche le PTY, ≠ `pty_kill`). Le pane reste **monté mais hors layout** (sorti
      de `Tab.panes`) → l'output continue d'arriver en arrière-plan. Le layout se recalcule (comme
      tout add/close). Aussi accessible via menu clic droit (#11) et palette `⌘K` (#12).
- [ ] **Bandeau étroit à gauche** listant les shells masqués sous forme de pastilles verticales
      (nom + teinte projet #17). Cliquer une pastille = **démasquer** → le pane revient dans le
      layout. (Le bandeau se cache quand il n'y a rien de masqué.)
- [ ] **Cloche 🔔 quand Claude réclame** : réutiliser la détection de fin d'agent (#6, le `BEL`) →
      quand un pane masqué sonne, une cloche s'allume sur sa pastille (+ traînée lumineuse #6 / notif
      macOS + son, comme un pane non-focus). La cloche s'éteint quand on démasque/engage le pane.
  - [ ] Bonus : distinguer « Claude a **fini** » de « Claude **attend une réponse** » (question /
        validation) — le plus urgent à faire remonter (le `Notification` hook de Claude, déjà branché
        #6, peut aider à différencier).
- [ ] Persister la liste des panes masqués dans `localStorage` (`superkitty.layout.v1`) → ils
      restent masqués (et réattachables) après un restart, comme le reste du layout.
- [ ] À trancher : un pane démasqué revient-il à sa place exacte (slot « fantôme ») ou en fin de
      liste ? (cohérence avec le rouvrir-fermé #1.) + raccourci pour masquer/démasquer.
- [ ] (relié à #2 sidebar de sessions ; #6 notifications ; #9 zoom — masquer est l'inverse de
      zoomer, on pousse le pane hors-champ.)

---

## 25. Touche « façon Warp » : barre de contexte + lanceur de commande à suggestions

> J'aime l'interface de Warp : la **barre du bas propre** (version node, dossier, branche git,
> stats de diff) et les **suggestions de commande** (quand tu fais `cd`, il te propose les
> dossiers). C'est plus beau que nous. *(Contrainte : superkitty fait tourner `claude` en plein
> écran → on ne refait PAS le terminal « à blocs » de Warp, on prend juste les deux morceaux qui
> rendent ça beau, sans toucher au moteur PTY/xterm.)*

- [x] **Barre du bas enrichie** (`StatusBar`, les deux modes) : groupe contexte à gauche —
      `⬡ node` · `📁 cwd` · `⎇ branche` · `📄 N • +ajouts −retraits`. Chaque segment se masque si
      indisponible (pas de repo, node absent…). Alimenté par la commande Rust `pane_context`
      (lance `node --version` + `git` dans le cwd de la pane active), pollé ~2,5 s sur la **seule**
      pane focalisée de l'onglet actif.
- [x] **Lanceur de commande à la demande** (`CommandBar`, raccourci réassignable **⌘L**, aussi dans
      la palette `⌘K`) : champ flottant ancré en bas avec suggestions fuzzy (`fuzzyScore` réutilisé).
      Sources : **répertoires** du cwd pour `cd` (`list_dirs`), **historique** du shell
      (`shell_history` lit `$HISTFILE`/`~/.zsh_history`), **fichiers** sur le dernier argument
      (`list_files`). `↑/↓` naviguent, `Tab`/`→` complètent (pour drill `cd a` → `cd a/b`), `↵`
      exécute dans la pane focalisée (`pty_write` + `\r`), `Esc` ferme. Avertit si `claude`/un éditeur
      est au premier plan (la ligne sera tapée dedans, pas au shell).
- [ ] Bonus futur : ghost-text inline dans le champ (auto-complétion à la Warp) ; détecter le runtime
      du projet (Rust/Python…) au lieu de node seul ; suggestions de flags par commande.

---

## Notes / à trancher plus tard

- Resizers de splits draggables (gap connu du roadmap).
- Navigation directionnelle des panes (spatiale plutôt que cyclique).
- Où stocker la config : `localStorage` (simple) vs fichier `~/.superkitty/config.json` (partageable, éditable à la main) ?
