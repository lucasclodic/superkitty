# 💡 Idées & Checklist — superkitty

Backlog des fonctionnalités à construire, dans l'esprit *friction-first* du projet
(chaque item retire une friction concrète d'usage de Claude Code dans un terminal).

Légende : `[ ]` à faire · `[~]` en cours · `[x]` fait

---

## 1. Rouvrir une fenêtre/onglet fermé (façon Chrome ⌘⇧T)

> Quand je ferme un onglet ou un pane par erreur, je veux pouvoir le rouvrir.

- [ ] Garder une pile des sessions récemment fermées (id tmux, layout, titre).
- [ ] Raccourci `⌘⇧T` pour rouvrir la dernière fermée (et dépiler à chaque appel).
- [ ] Décider du comportement avec tmux :
  - `pty_detach` (close « doux ») → la session tmux vit encore, on peut juste réattacher.
  - `pty_kill` (⌘W / ⌃⇧W) → la session est détruite ; « rouvrir » = recréer un pane neuf.
- [ ] Idéal : transformer ⌘W en *detach* + entrée dans l'historique, plutôt qu'un kill sec.
- [ ] Persister cet historique dans `localStorage` pour survivre à un restart de l'app.
- [ ] **Clic droit** (sur la barre d'onglets / un pane) → menu contextuel avec « Rouvrir l'onglet fermé » / « Rouvrir la fenêtre fermée », en plus du raccourci `⌘⇧T`.

## 2. Ouvrir / lister les sessions tmux

> Pouvoir voir et rattacher les sessions tmux qui tournent déjà.

- [ ] Commande backend pour lister les sessions tmux (`tmux list-sessions`).
- [ ] UI (sidebar ou palette) listant les sessions `superkitty-*` + leur état (attaché/détaché).
- [ ] Cliquer une session → l'ouvrir dans un nouveau pane/onglet (réattache par `id`).
- [ ] Pouvoir ouvrir une session tmux « brute » (pas forcément créée par superkitty ?).
- [ ] Bouton pour tuer une session depuis la liste.
- [ ] (relié à M4 « session sidebar » du roadmap)

## 3. Settings (thème, raccourcis, etc.)

> Un panneau de réglages pour changer vite l'apparence et les shortcuts.

- [ ] Panneau Settings (modale ou onglet dédié), ouvrable via `⌘,`.
- [ ] **Thèmes** : choisir un thème xterm (couleurs, fond, curseur), preview en direct.
  - [ ] Quelques thèmes intégrés (dark, light, solarized…).
  - [ ] Police + taille de police.
- [ ] **Raccourcis** : voir et remapper les shortcuts (tabs, panes, splits).
- [ ] Persister les settings dans `localStorage` (ou un fichier de config).
- [ ] Appliquer à chaud sans redémarrer (tous les panes xterm se mettent à jour).

## 4. Drag & drop de screenshots dans le chat (= M2 du roadmap)

> Déposer une image → son chemin est injecté dans le pane focus (Claude lit les chemins d'images).

- [x] Zone de drop sur le pane focus (overlay visuel pendant le drag).
- [ ] Sauver l'image déposée dans un dossier (ex : `~/.superkitty/dropped/` ou tmp).
- [x] Injecter le chemin du fichier dans le PTY focus (`pty_write`) — en **bracketed paste** (`ESC[200~ … ESC[201~`) pour que Claude affiche `[Image #1]` comme un vrai terminal.
- [ ] Gérer le coller (`⌘V`) d'une image depuis le presse-papier, pas juste le drop.
- [x] Gérer plusieurs images d'un coup.

## 5. Sandbox : restreindre Claude au dossier courant

> Lancer Claude dans un bac à sable où il ne voit que le dossier de travail, pas tout le reste du Mac.

- [ ] Option par pane/session : « sandboxé » → Claude ne peut lire/écrire que dans `cwd` (et sous-dossiers).
- [ ] Choisir le mécanisme de confinement :
  - [ ] `sandbox-exec` (Seatbelt macOS) avec un profil qui n'autorise que le dossier courant.
  - [ ] Lancer dans un conteneur / VM légère (plus lourd, plus étanche).
  - [ ] S'appuyer sur les permissions natives de Claude Code (allowlist de chemins) — plus simple mais moins « dur ».
- [ ] UI : indicateur visuel quand un pane est sandboxé (badge / couleur de bordure).
- [ ] Choisir le dossier racine du sandbox au moment de créer le pane.
- [ ] Garder l'accès aux binaires système (node, git, claude…) tout en bloquant la lecture du `$HOME` et des autres projets.
- [ ] Bien gérer tmux : la session tourne dans le sandbox dès le `tmux new-session`.

## 6. Notifications quand un agent a terminé

> Quand Claude finit de bosser dans un pane que je ne regarde pas, je veux être prévenu.

- [ ] Détecter la fin d'un run d'agent dans un pane (Claude attend une entrée / a fini sa tâche).
  - [ ] Piste : guetter la cloche du terminal (`BEL` / `\a`) que Claude Code émet déjà.
  - [ ] Piste : détecter le retour au prompt / l'inactivité de sortie après une rafale.
- [ ] Notification système macOS (titre = onglet/pane, clic → focus ce pane).
- [ ] Badge visuel sur l'onglet/pane concerné quand il n'est pas focus.
- [ ] Ne notifier que pour les panes non-actifs (pas celui que je regarde).
- [ ] Réglage : son on/off, notifications on/off (à mettre dans les Settings, idée 3).

## 7. Nouveau shell = shell frais (comme kitty)

> Quand j'ouvre un nouveau window/pane, ça doit lancer un shell propre qui recharge tout
> l'environnement (PATH, aliases, `.zshrc`…), pas hériter d'un état figé.

- [ ] Un nouveau pane = nouvelle session tmux neuve qui lance un **login shell** (`zsh -l`).
- [ ] Repartir du `cwd` voulu (dossier du projet) et d'un env rechargé à chaque ouverture.
- [ ] ⚠️ Tension avec la persistance tmux : *réattacher* une session reprend l'état d'avant ;
      *créer* un nouveau pane doit, lui, démarrer frais. Bien distinguer les deux chemins.
- [ ] Vérifier le PATH dans un bundle lancé depuis le Finder (cf. *Gotchas* du CLAUDE.md :
      env minimal → tmux/binaries introuvables). Un login shell aide ici.
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

- [ ] Petit bouton dans le coin de chaque pane (apparaît au survol ?) pour basculer sa taille.
- [ ] Clic → la fenêtre passe en plein écran (occupe tout l'onglet), re-clic → retour au layout normal.
  - [ ] Réutiliser le layout `stack` / un mode « zoom » (façon tmux `zoom-pane`) plutôt qu'un vrai recalcul.
  - [ ] Mémoriser le layout précédent pour pouvoir revenir exactement à l'état d'avant.
- [ ] Raccourci clavier équivalent (kitty/tmux ont un « zoom » de pane, ex. `⌃⇧Z`).
- [ ] Éventuellement d'autres boutons de taille (cycler les layouts depuis le pane, agrandir/réduire).
- [ ] Indicateur visuel quand un pane est « zoomé » (les autres sont cachés).

## 10. Afficher les raccourcis de navigation des onglets (⌘1…⌘9)

> On peut déjà sauter à l'onglet N avec `⌘1`…`⌘9`, mais rien ne le montre.
> Afficher le numéro sur chaque onglet pour rendre le raccourci découvrable.

- [ ] Afficher le numéro de l'onglet (1, 2, 3, 4…) sur chaque onglet de la barre.
- [ ] Indiquer clairement que c'est `⌘ + numéro` (tooltip au survol, ou badge discret type `⌘1`).
- [ ] Garder la numérotation cohérente avec l'ordre réel des onglets (re-numéroter après close/réorganisation).
- [ ] Idem côté fenêtres/panes si pertinent : montrer comment focus un pane précis.
- [ ] (relié à l'idée 3 « Settings > Raccourcis » : une vue listant tous les shortcuts.)

## 11. Menu clic droit pour gérer fenêtres/panes (sans raccourci)

> Pouvoir tout faire à la souris : clic droit → ajouter une nouvelle fenêtre/pane,
> en fermer une, réorganiser, plutôt que de devoir connaître les raccourcis clavier.

- [ ] Menu contextuel (clic droit sur un pane / la barre d'onglets) avec les actions principales :
  - [ ] « Nouvelle fenêtre / pane » (équiv. `⌘D` / `⌘↵`).
  - [ ] « Nouvel onglet » (équiv. `⌘T`).
  - [ ] « Fermer cette fenêtre / cet onglet ».
  - [ ] « Rouvrir la fenêtre/onglet fermé » (cf. idée 1).
- [ ] Toutes les actions clavier doivent aussi être accessibles à la souris (découvrabilité).
- [ ] Afficher le raccourci à côté de chaque entrée du menu (apprentissage des shortcuts).
- [ ] Éventuellement : changer le layout / zoomer un pane depuis ce même menu.

## 12. Palette de commandes (`⌘K`)

> Un overlay de recherche qui surgit avec `⌘K` (ou `⌘⇧P`) et permet de lancer
> n'importe quelle action en tapant son nom — façon VS Code / Raycast / Spotlight.
> C'est la réponse « clavier » à la même friction que les idées 10 et 11 : la **découvrabilité**.

- [ ] Overlay modal centré, ouvert par `⌘K`, fermé par `Esc`.
- [ ] Liste filtrable en *fuzzy search* : on tape quelques lettres → la liste se réduit, `↵` exécute.
- [ ] Référencer toutes les actions de l'app : nouvel onglet/fenêtre, changer de layout, aller à l'onglet N, fermer, rouvrir l'onglet fermé, sandboxer un pane, ouvrir les Settings…
- [ ] Afficher le raccourci à côté de chaque action → on apprend les shortcuts en s'en servant.
- [ ] Brancher la liste des sessions tmux (idée 2) : taper le nom d'une session pour la rattacher.
- [ ] Éventuellement : actions « projet » (ouvrir un dossier récent, lancer `claude` dans un nouveau pane).
- [ ] (chapeaute les idées 10 et 11 : même problème de découvrabilité, résolu au clavier.)

## 13. Confirmer avant de fermer un pane où un agent tourne

> Éviter de tuer un `claude` en plein travail par un `⌘W` / `⌃⇧W` réflexe.

- [ ] Détecter qu'un agent tourne dans le pane (cf. heuristiques de l'idée 6 : sortie active, pas au prompt).
- [ ] Sur `pty_kill` (⌘W / ⌃⇧W / ⌘⇧D), si un agent tourne → demander confirmation avant de détruire.
- [ ] Confirmation légère (modale / inline), avec « Fermer quand même » et `Esc` pour annuler.
- [ ] Idéalement proposer **« Détacher plutôt que tuer »** → garde la session tmux vivante (relié à idée 1 : entre dans l'historique des fermées, réouvrable par `⌘⇧T`).
- [ ] Réglage on/off dans les Settings (idée 3) pour ceux que la confirmation gêne.

## 14. Déplacer / réorganiser les panes au clavier (comme kitty)

> Ex. : une moitié d'écran avec un shell, l'autre moitié avec deux shells. Je veux pouvoir
> **bouger** une fenêtre d'une position à l'autre facilement (`⌘`+flèches), pas juste la focus.

- [ ] Action « déplacer le pane » : échanger/réordonner le pane focus avec son voisin (gauche/droite/haut/bas).
- [ ] Raccourci dédié, ex. `⌘⇧`+flèches pour *déplacer* (les `⌘`+flèches actuels gardent le *focus*).
- [ ] Réutiliser `neighbor()` de `layouts.ts` pour trouver le voisin dans la direction donnée.
- [ ] Déplacer = réordonner la liste `panes` du tab → tout le layout se recalcule (rien ne se casse).
- [ ] Promouvoir un pane en « main » (le gros de `tall`/`fat`) via un raccourci, façon kitty (`move_window_to_top`).
- [ ] Persister le nouvel ordre dans `localStorage` (comme le reste du layout).
- [ ] (alternative souris : drag & drop d'un pane sur un autre pour les échanger — relié à idée 11.)

## 15. Drag de n'importe quel fichier + picker `@` (généralise l'idée 4)

> Glisser un fichier (pas que des images) depuis le Finder → son chemin s'injecte dans le
> pane focus, façon `@mention`. Et un picker `@` natif pour les fichiers du projet.

- [ ] Étendre le drag & drop de l'idée 4 à **tout type de fichier**, pas seulement les images.
- [ ] Déposer un fichier → injecter son chemin dans le PTY focus (`pty_write`), sans le copier (contrairement aux images qu'on sauve).
- [ ] Gérer plusieurs fichiers d'un coup (chemins séparés par des espaces).
- [ ] Picker `@` : taper `@` dans un pane → liste filtrable des fichiers du projet (cwd), `↵` insère le chemin.
  - [ ] Réutiliser la même UI de *fuzzy search* que la palette `⌘K` (idée 12).
  - [ ] Se limiter au `cwd` / respecter `.gitignore` pour ne pas noyer la liste.
- [ ] Bien distinguer chemin absolu vs relatif au `cwd` selon ce que Claude attend.

## 16. Composeur de prompt multi-lignes

> Une vraie zone de texte pour écrire un prompt long confortablement, puis l'envoyer au
> pane focus. Fini de se battre avec l'éditeur de ligne du terminal pour les retours à la
> ligne, le déplacement du curseur et la souris.

- [ ] Zone de texte dédiée (sous le pane focus ou en overlay) avec un vrai éditeur multi-lignes.
- [ ] **Retours à la ligne libres** : `↵` insère une nouvelle ligne, `⌘↵` (ou `⌃↵`) envoie le prompt — on n'est plus à la merci du comportement de la ligne du terminal.
- [ ] **Souris** : cliquer pour placer le curseur, sélectionner, éditer n'importe où dans le texte (impossible proprement dans un PTY brut).
- [ ] Coller une **image inline** dans la zone → la sauver + injecter son chemin (relié aux idées 4 et 15).
- [ ] Confort d'édition : markdown basique, undo/redo, sélection, peut-être coloration légère.
- [ ] À l'envoi : transmettre le texte au PTY focus (`pty_write`), en gérant proprement le multi-lignes (bracketed paste pour que Claude le reçoive d'un bloc).
- [ ] Garder un historique des prompts envoyés (relié à l'idée « historique de prompts cherchable »).
- [ ] Brancher le picker `@` (idée 15) et la bibliothèque de snippets dans cette zone.

## 17. Renommer onglets/fenêtres + code-couleur par projet

> Ne jamais confondre deux projets ouverts côte à côte : chaque repo reçoit une teinte,
> et on peut renommer librement onglets et fenêtres (panes) et choisir leurs couleurs.

- [ ] **Renommer un onglet** (double-clic sur le titre ou via menu/palette), titre persistant.
- [ ] **Renommer une fenêtre/pane** de la même façon (remplace les `p1/p2` par un nom parlant).
- [ ] **Changer la couleur** d'un onglet / d'un pane à la main (palette de couleurs).
- [ ] **Code-couleur automatique par projet** : chaque repo (cwd / racine git) reçoit une teinte ; bordure du pane + onglet prennent cette couleur → repérage immédiat.
  - [ ] Déduire la couleur du chemin du projet (hash → teinte) par défaut, surchargée par un choix manuel.
- [ ] Titre auto par défaut si non renommé : `cwd` + branche git (au lieu de `p1`).
- [ ] Persister noms + couleurs dans `localStorage` (avec le reste du layout).
- [ ] Réglages dans les Settings (idée 3) ; éventuellement éditable depuis le clic droit (idée 11).

## 18. Nouveau pane = même dossier courant (hériter le `cwd`)

> Quand je fais `⌘D` (nouvelle fenêtre/pane), elle doit s'ouvrir **dans le même dossier
> courant** que le pane d'où je viens — pas à `$HOME`. Comme kitty / iTerm.

- [ ] À la création d'un pane (`⌘D` / `⌘↵` / `⌃⇧↵`), démarrer la nouvelle session tmux dans le `cwd` du **pane focus**, pas dans le home.
- [ ] Récupérer le `cwd` réel du pane source (ex. via tmux `#{pane_current_path}`, ou suivre le `cwd` du process), puis le passer au `tmux new-session` (option `-c <path>`).
- [ ] Même logique pour un **nouvel onglet** (`⌘T`) : repartir du dossier du pane/onglet actif.
- [ ] ⚠️ Cohérent avec l'idée 7 (login shell frais) : on garde un shell propre **mais** au bon dossier — relancer l'env sans repartir à `$HOME`.
- [ ] Cas du tout premier pane (aucun parent) : tomber sur `$HOME` ou un dossier par défaut configurable.

---

## Notes / à trancher plus tard

- Resizers de splits draggables (gap connu du roadmap).
- Navigation directionnelle des panes (spatiale plutôt que cyclique).
- Où stocker la config : `localStorage` (simple) vs fichier `~/.superkitty/config.json` (partageable, éditable à la main) ?
