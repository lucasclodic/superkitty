# handoff/

Briefs de passation pour des bugs/chantiers qu'on confie à un autre dev (humain ou agent, souvent plus senior) afin qu'il puisse **tout explorer sans repartir de zéro**.

Un brief n'est pas un ticket : c'est un dossier d'enquête. Il dit ce qu'on **voulait**, ce qui **cloche**, ce qu'on a **déjà tenté** (avec le statut de vérification de chaque tentative), et les **pistes** restantes — pour ne pas faire refaire le travail déjà fait.

## Convention de nommage
`AAAA-MM-JJ-sujet-court-en-kebab.md` (date de création du brief).

## Structure d'un brief
Chaque `.md` suit ce squelette (adapter selon le cas) :

1. **Titre + en-tête** — date, statut (`⛔ non résolu` / `🔎 en cours` / `✅ résolu`), zone du code.
2. **Contexte produit** — le minimum pour comprendre l'enjeu sans connaître le repo.
3. **Comportement attendu** — la cible précise (souvent une parité avec un outil de référence).
4. **Bug** — le symptôme exact, et ce qui reste à reconfirmer.
5. **Ce qui a déjà été fait** — chaque tentative **avec son statut** : ✅ vérifié / ❓ non vérifié / ❌ écarté. Le statut est crucial : il évite de refaire ou de re-supposer.
6. **Architecture pertinente** — références exactes `fichier:ligne` du chemin de code concerné.
7. **Pistes à investiguer** — hypothèses ordonnées par suspicion, chacune avec un test concret.
8. **Instrumentation suggérée** — comment obtenir les réponses au prochain essai (logs, devtools…).
9. **Résultat attendu une fois corrigé** — critère de fin + quoi mettre à jour (ce fichier, `IDEAS.md`…).

## Cycle de vie
- À l'ouverture : créer le `.md`, statut `⛔/🔎`.
- Pendant : le dev qui reprend **met à jour** le même fichier (tentatives, statuts, ce qu'il a éliminé).
- À la résolution : statut `✅`, résumé de la cause réelle et du fix, puis répercuter dans `IDEAS.md`/`CLAUDE.md` si pertinent. On garde le fichier comme trace.
