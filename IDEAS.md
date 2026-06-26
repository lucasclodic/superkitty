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
- **#6 Notifications fin d'agent** (BEL → badge onglet/pane + notif macOS `osascript`).
- **#7 Nouveau pane = login shell frais** (`$SHELL -l`, ignoré au réattach).
- **#15 Picker de fichiers** (`⌘P`, `git ls-files`) + drag de tout fichier.
- **#4 Coller image** (`⌘V` → sauve dans `~/.superkitty/dropped/` → injecte).
- **#17 Renommer onglets** (double-clic) + **teinte auto par projet** (hash du cwd).
- **#20 Scratchpad par onglet** (`⌃⇧N`, persisté, envoi au pane).
- **#16 Composeur multi-lignes** (`⌘E`, `⌘↵` envoie, paste image inline).
- **#19 Mode Quake** (hotkey global `` ⌃` ``, dropdown choix-projet + prompt).
- **#5 Sandbox par pane** (Seatbelt write-confinement, badge 🔒).

À affiner plus tard : confinement *lecture* du sandbox, vraie fenêtre Quake redimensionnée descendant du haut, picker `@` déclenché à la frappe, resizers draggables, sortie compressée (#8).

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
- [x] Notification système macOS (via `osascript`).
- [x] Badge visuel (point pulsant) sur l'onglet/pane concerné quand il n'est pas focus.
- [x] Ne notifier que pour les panes non-actifs (pas celui que je regarde + fenêtre focus).
- [~] Réglage notifications on/off (fait, dans Settings) ; son on/off pas encore.

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

- [ ] **Barre de hint discrète** (bas de fenêtre / coin) qui montre une astuce à la fois,
      ex. « Astuce : `⌘D` pour ouvrir une nouvelle fenêtre », et tourne entre les tips.
- [ ] **Hints contextuels** selon ce que fait l'utilisateur :
  - [ ] un seul pane ouvert depuis longtemps → suggérer `⌘D` / `⌃⇧↵` pour splitter.
  - [ ] plusieurs panes → suggérer `⌘`+flèches (focus) et `⌘⇧`+flèches (déplacer).
  - [ ] plusieurs onglets → suggérer `⌘1…⌘9` pour sauter directement.
  - [ ] après un `⌃⇧L` à l'aveugle → pointer vers le picker visuel ▦ (idée 21).
- [ ] **Écran/overlay d'accueil** au premier lancement : les 4-5 raccourcis essentiels
      (nouvel onglet, nouveau pane, sidebar `⌘B`, changer de layout), avec « ne plus afficher ».
- [ ] **Cheat sheet** complète des raccourcis ouvrable à la demande (ex. `⌘/` ou `?`),
      reprenant le tableau du CLAUDE.md → liste de toutes les actions + leurs touches.
- [ ] Ne pas être intrusif : tips dismissables, fréquence réglable, et les masquer une fois
      qu'un raccourci a été utilisé (« il connaît, on arrête de lui rappeler »).
- [ ] Réglage on/off dans les Settings (idée 3) pour les masquer entièrement.
- [ ] (relié aux idées 10 « numéros d'onglets », 11 « menu clic droit » et 12 « palette `⌘K` » :
      même objectif de découvrabilité ; la palette peut aussi servir de cheat sheet vivante.)

## 23. Zoomer le terminal (`⌘+` / `⌘-` / `⌘0`)

> Aujourd'hui on ne peut pas grossir/réduire la taille du texte à la volée : il faut passer
> par les Settings (idée 3) pour changer la taille de police, et `⌘+` / `⌘-` ne font rien.
> Je veux les raccourcis standards macOS pour zoomer directement, **sinon ça ne marche pas**.

- [ ] **`⌘+`** (agrandir) / **`⌘-`** (réduire) ajustent la taille de police xterm en direct,
      sur le pane focus (ou tous les panes ? à trancher).
- [ ] **`⌘0`** remet la taille par défaut.
- [ ] Persister la taille choisie (réutiliser le réglage `fontSize` des Settings, idée 3).
- [ ] (optionnel) un petit contrôle visuel de zoom (boutons +/− quelque part) en complément
      des raccourcis.

---

## Notes / à trancher plus tard

- Resizers de splits draggables (gap connu du roadmap).
- Navigation directionnelle des panes (spatiale plutôt que cyclique).
- Où stocker la config : `localStorage` (simple) vs fichier `~/.superkitty/config.json` (partageable, éditable à la main) ?
