# Handoff — Collage ⌘V : les fichiers/dossiers du Finder collent « [Image] » au lieu du chemin

**Date :** 2026-06-26
**Statut :** 🟡 correctif appliqué (compile ✅), **validation in-app en attente**
**Zone :** presse-papiers / collage (idea #4)

## ✅ Cause racine identifiée (2026-06-26, investigation multi-agents)

`clipboard_file_paths` renvoyait **vide** dans l'app → le frontend sauvait alors l'aperçu/icône exposé par WKWebView comme une capture → `[Image]` pour tout (image, dossier, fichier).

L'ancienne lecture native faisait deux choses, toutes deux mauvaises pour un vrai ⌘C Finder :
1. `propertyListForType("NSFilenamesPboardType")` — type **legacy** (déprécié depuis 10.14) que le Finder moderne ne remplit plus → `nil`.
2. fallback `stringForType("public.file-url")` **au niveau du presse-papiers** — `NSPasteboard.stringForType` ne lit que le **premier item** ; si l'item 0 du Finder n'expose pas l'URL en string, → `nil`.

Pourquoi le test standalone passait : `osascript 'set the clipboard to (POSIX file …)'` écrit justement le **legacy** `NSFilenamesPboardType` (chemin #1), que le vrai Finder n'utilise plus. **Le test ne reproduisait donc jamais l'entrée réelle.** (Vérifié : un `NSURL` écrit via `writeObjects` synthétise *aussi* le legacy + fait marcher `stringForType` top-level — donc aucun test synthétique simple ne reproduit l'échec ; seule une vraie copie Finder le fait.)

### Correctif appliqué
- **`src-tauri/src/pty.rs` `clipboard_file_paths`** : lecture **moderne** — on itère `pb.pasteboardItems()` et on lit `stringForType("public.file-url")` **par item** (gère mono- et multi-fichiers). Legacy `NSFilenamesPboardType` + `stringForType` top-level conservés en fallbacks. Logs `[clipboard] changeCount/types …` et `[clipboard] returning N path(s)` **(dev build only, `#[cfg(debug_assertions)]`)** visibles dans la sortie `npm run tauri dev`.
- **`src-tauri/Cargo.toml`** : feature `objc2-app-kit` `"NSPasteboardItem"` ajoutée (pour `pasteboardItems()`).
- **`src/App.tsx` `onPaste`** : le `catch {}` silencieux devient `catch (err) { console.error("clipboard_file_paths failed", err); … }` pour distinguer un invoke qui *jette* d'un retour vide. **Pas** de garde `if (hasFiles) return;` : une **capture d'écran** présente aussi `hasFiles=true` (WKWebView l'expose en item `kind:"file"`), donc cette garde casserait le collage de captures — le fallback image existant reste correct.

### Validation à faire (le SEUL vrai test = l'app)
`npm run tauri dev`, surveiller le terminal (logs `[clipboard]`), coller dans un pane :
1. ⌘C **dossier** Finder → ⌘V → doit injecter le **chemin** (pas `[Image]`). Log attendu : `types=[…, public.file-url, …]` puis `returning 1 path(s): ["/…"]`.
2. ⌘C **fichier non-image** → ⌘V → **chemin**.
3. ⌘C **image** → ⌘V → `[Image #N]` (chemin injecté, claude le reconnaît).
4. **Capture** (⌃⇧⌘4) → ⌘V → `[Image]` (octets sauvés ; `returning 0 path(s)` car pas de file-url).

Si le cas 1 échoue encore, la ligne `types=[…]` du log dira **exactement** sous quel type le Finder de cette machine (macOS 26.5.1 Tahoe) écrit l'URL → ajuster la stratégie (au pire, lecteur universel `readObjectsForClasses:[NSURL]`). Une fois validé : passer le statut ✅ et cocher idea #4 dans `IDEAS.md`.

---
## (historique) Première tentative — non concluante

## Contexte produit
**superkitty** est un émulateur de terminal macOS (Tauri 2 + React/xterm.js + tmux) dédié à Claude Code. Quand `claude` reçoit un **chemin de fichier image** collé en *bracketed paste* (`ESC[200~ … ESC[201~`), il affiche `[Image #N]`. Quand il reçoit un chemin de **dossier/fichier non-image**, il affiche le chemin texte. Stack : `npm run tauri dev`, macOS (Darwin 25.5), clavier **AZERTY**.

## Comportement attendu (parité Terminal.app)
- ⌘C sur une **image** dans le Finder → ⌘V dans un pane → `[Image #N]`
- ⌘C sur un **dossier** (ou fichier non-image) → ⌘V → le **chemin** (échappé)
- Capture d'écran (bytes, pas de fichier) dans le presse-papiers → ⌘V → image sauvegardée puis `[Image]`
- Drag & drop d'image → inchangé (**marche déjà**)

## Bug
Dans superkitty, ⌘V depuis le Finder produit `[Image]` pour **tout** (image, dossier, fichier). Après les modifs ci-dessous : **ça ne marche toujours pas** (le testeur n'a pas précisé si c'est encore « [Image] » ou « rien ne se colle » — **à reconfirmer en premier**).

## Ce qui a déjà été fait (et son statut de vérification)
1. **Backend `src-tauri/src/pty.rs` → `clipboard_file_paths`** : réécrit. Avant, il lisait le presse-papiers en spawnant `osascript -l JavaScript` ; en cas d'échec → `Vec::new()` silencieux. Hypothèse : ça échouait dans l'app empaquetée → toujours « pas de fichier » → fallback image. **Maintenant** : lecture native via `objc2` / `NSPasteboard` (in-process), `NSFilenamesPboardType` puis fallback `public.file-url`.
   - ✅ **Vérifié en isolation** : un binaire standalone avec le même code objc2 lit correctement le presse-papiers — dossier → chemin, image → chemin, multi-fichiers → tous, texte → vide. **Donc la lecture native marche hors-app.**
   - ❓ **Non vérifié dans l'app** : on n'a pas confirmé par log runtime que la commande est invoquée ni ce qu'elle renvoie réellement dans le process Tauri.
   - Deps ajoutées dans `src-tauri/Cargo.toml` (`[target.'cfg(target_os = "macos")']`) : `objc2`, `objc2-foundation`, `objc2-app-kit`. `cargo check` OK.
2. **Frontend `src/App.tsx` (handler `onPaste`, ~L1411-1461)** : le gate détecte désormais **tout** élément fichier (`it.kind === "file"`, `dt.files.length`, type `"Files"`), pas seulement les images, pour ne pas ignorer un dossier. `tsc` OK.

## Architecture pertinente (références exactes)
- **Handler de collage** : `src/App.tsx:1411` — `window.addEventListener("paste", onPaste, true)` (capture phase). Logique : gate → `e.preventDefault()` → `invoke("clipboard_file_paths")` → si chemins `injectPaths()`, sinon sauvegarde des bytes image.
- **`injectPaths`** : `src/App.tsx:119` — wrap chaque chemin en bracketed paste, échappe les chars shell, `invoke("pty_write", …)`.
- **Commande Rust** : `src-tauri/src/pty.rs` (`clipboard_file_paths`, version objc2), enregistrée dans `src-tauri/src/lib.rs:89`.
- **Drag & drop (qui MARCHE, pour contraste)** : `src/App.tsx:1376` — utilise `getCurrentWebview().onDragDropEvent` qui fournit **directement** `payload.paths` (vrais chemins OS, sans passer par le presse-papiers).
- **Menu natif Edit** : `src-tauri/src/lib.rs:59-67` — contient un `.paste()` **prédéfini** (accélérateur ⌘V natif). ⚠️ **Suspect majeur** (voir ci-dessous).
- Pas de StrictMode (`src/main.tsx`). xterm.js dans `src/Terminal.tsx` ; sa textarea cachée est dans `.xterm` (le gate `!ae.closest(".xterm")` la laisse passer).

## Pistes à investiguer (par ordre de suspicion)
1. **Le `paste` event JS se déclenche-t-il seulement ?** Le menu natif `.paste()` (lib.rs:65) capture ⌘V via son key-equivalent AppKit et exécute `paste:` sur la WKWebView. Vérifier si ça génère bien un DOM `paste` event qui atteint notre listener capture-phase, ou si ça court-circuite. **Test :** retirer temporairement `.paste()` du menu et voir si le comportement change.
2. **`clipboard_file_paths` est-elle invoquée, et que renvoie-t-elle dans l'app ?** Ajouter un `eprintln!` / `log` au début et avant chaque `return` de la commande Rust, et un `console.log` dans `onPaste` (dumper `dt.types`, `items.map(i=>[i.kind,i.type])`, `dt.files.length`, puis le résultat de l'invoke). Confirmer ou infirmer l'hypothèse objc2-in-app.
3. **Snapshot vs pasteboard async** : `clipboard_file_paths` lit `generalPasteboard` **après** un `await`. Vérifier que la WKWebView ne vide/réécrit pas le pasteboard pendant le `paste:` natif (peu probable mais à exclure).
4. **Double-handling xterm** : `e.preventDefault()` en capture empêche-t-il vraiment xterm (et le `paste:` natif) d'aussi écrire ? Regarder si du contenu est écrit deux fois ou écrasé.
5. **Le gate rejette-t-il à tort ?** Pour un dossier, vérifier ce que contient réellement `dt.types`/`dt.items`/`dt.files` dans cette WKWebView (peut être vide → early-return L1433). Si vide, il faut déclencher le chemin natif autrement (ex. tenter `clipboard_file_paths` même sans signal webview, en ne `preventDefault`-ant que si elle renvoie des chemins — attention à ne pas casser le collage texte).

## Instrumentation suggérée pour démarrer
- DevTools ouverts sur la WKWebView (clic droit → Inspecter, ou via le flag debug Tauri) + logs `onPaste`.
- Logs Rust visibles dans la sortie de `npm run tauri dev`.
- Reproduire les 3 cas : image Finder, dossier Finder, capture d'écran — noter pour chacun : event JS reçu ? gate passé ? invoke appelée ? chemins renvoyés ? ce que claude affiche.

## Détail utile
Le **drop** marche parce qu'il contourne entièrement le presse-papiers (chemins OS natifs via Tauri). Le **paste** dépend de la chaîne `DOM paste event → invoke clipboard_file_paths`. La faille est forcément dans cette chaîne : soit l'event ne vient pas, soit l'invoke renvoie vide en contexte app, soit le gate filtre trop tôt.

## Test objc2 isolé (déjà concluant, pour réutilisation)
Le binaire standalone qui a validé la lecture native lisait le pasteboard ainsi :
```rust
let pb = NSPasteboard::generalPasteboard();
// 1) NSFilenamesPboardType : array de chemins POSIX (multi-fichiers)
let ty = NSString::from_str("NSFilenamesPboardType");
if let Some(obj) = pb.propertyListForType(&ty) {
    if let Ok(arr) = obj.downcast::<NSArray>() {
        for item in arr.iter() {
            if let Ok(s) = item.downcast::<NSString>() { /* push s.to_string() */ }
        }
    }
}
// 2) fallback public.file-url (mono-fichier) via NSURL::URLWithString → isFileURL → path
```
Pour rejouer un état presse-papiers de test :
```bash
osascript -e 'set the clipboard to (POSIX file "/tmp/un dossier")'   # dossier
osascript -e 'set the clipboard to (POSIX file "/tmp/img.png")'      # fichier image
```

## Résultat attendu une fois corrigé
⌘C dossier → ⌘V colle le chemin ; ⌘C image → `[Image]` ; capture → `[Image]` ; drag & drop → toujours OK. Mettre à jour ce fichier (statut ✅) et `IDEAS.md` (idea #4) une fois validé en conditions réelles.
