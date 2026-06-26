# 🐛 Bugs connus — superkitty

Liste des bugs rencontrés en usage réel, à reproduire et corriger.

Légende : `[ ]` à corriger · `[~]` en cours · `[x]` corrigé

---

- [ ] **`⌃W` ne ferme pas toujours la fenêtre/pane.** Parfois, en appuyant sur
  `⌃W` (close window — `closeFocused`, détache le pane focus), rien ne se ferme.
  Intermittent, à reproduire. Pistes : la touche n'atteint peut-être pas le
  listener global (focus dans un champ, ou capturée par xterm/tmux), ou le pane
  ciblé n'est pas celui qui a le focus.

- [ ] **Deux barres de scroll affichées en même temps.** Il y a actuellement deux
  scrollbars visibles dans un pane (probablement la scrollbar custom de superkitty
  + celle native de xterm/du conteneur). Pas très propre — n'en garder qu'une seule.

