import { useEffect } from "react";
import { FONT_CHOICES, SkSettings, THEMES } from "./themes";

/** Keyboard reference, also shown here so all shortcuts are discoverable
 *  (ideas #3 + #10). Display-only — the real bindings live in App.tsx. */
const SHORTCUTS: { group: string; items: [string, string][] }[] = [
  {
    group: "Onglets",
    items: [
      ["⌘T", "Nouvel onglet"],
      ["⌘W", "Fermer l'onglet"],
      ["⌘⇧T", "Rouvrir le dernier fermé"],
      ["⌘1…9", "Aller à l'onglet N"],
      ["⌘⇧] / ⌘⇧[", "Onglet suivant / précédent"],
    ],
  },
  {
    group: "Fenêtres (panes)",
    items: [
      ["⌘D / ⌘↵", "Nouvelle fenêtre"],
      ["⌃⇧W / ⌘⇧D", "Fermer la fenêtre"],
      ["⌘ + flèches", "Focus voisin"],
      ["⌘⇧ + flèches", "Déplacer (échanger)"],
      ["⌃⇧] / ⌃⇧[", "Fenêtre suivante / précédente"],
      ["⌃⇧F / ⌃⇧B", "Déplacer dans la liste"],
      ["⌃⇧`", "Promouvoir en principale"],
      ["⌃⇧Z / ⌘⇧↵", "Agrandir / réduire (zoom)"],
    ],
  },
  {
    group: "Dispositions & défilement",
    items: [
      ["⌃⇧L", "Disposition suivante"],
      ["⌃⇧↑ / ⌃⇧↓", "Défiler d'une ligne"],
      ["⌃⇧PgUp / PgDn", "Défiler d'une page"],
      ["⌃⇧Home / End", "Haut / bas du scrollback"],
      ["⌥⌘↑ / ⌥⌘↓", "Prompt précédent / suivant"],
    ],
  },
  {
    group: "Général",
    items: [
      ["⌘K", "Palette de commandes"],
      ["⌘,", "Réglages"],
      ["⌘B", "Sessions tmux"],
    ],
  },
];

/**
 * Settings panel (idea #3): pick an xterm theme, font family + size (live
 * preview, applied to every pane instantly via App state), and a read-only
 * keyboard reference. Opened with ⌘, ; closed with Esc / outside click.
 */
export function Settings({
  settings,
  onChange,
  onClose,
}: {
  settings: SkSettings;
  onChange: (s: SkSettings) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="settings"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="settings-head">
          <h2 className="modal-title">Réglages</h2>
          <button className="icon-btn" title="Fermer (Esc)" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="settings-body">
          <section className="settings-section">
            <h3 className="settings-h3">Thème</h3>
            <div className="theme-grid">
              {Object.entries(THEMES).map(([key, t]) => (
                <button
                  key={key}
                  className={`theme-card${settings.theme === key ? " active" : ""}`}
                  onClick={() => onChange({ ...settings, theme: key })}
                  style={{
                    background: t.theme.background,
                    color: t.theme.foreground,
                  }}
                >
                  <span className="theme-name">{t.label}</span>
                  <span className="theme-swatches">
                    {[t.theme.red, t.theme.green, t.theme.blue, t.theme.cursor].map(
                      (c, i) => (
                        <i key={i} style={{ background: c }} />
                      ),
                    )}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="settings-section">
            <h3 className="settings-h3">Police</h3>
            <div className="settings-row">
              <label>Famille</label>
              <select
                value={settings.fontFamily}
                onChange={(e) =>
                  onChange({ ...settings, fontFamily: e.target.value })
                }
              >
                {FONT_CHOICES.map((f) => (
                  <option key={f.label} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="settings-row">
              <label>Taille</label>
              <div className="stepper">
                <button
                  onClick={() =>
                    onChange({
                      ...settings,
                      fontSize: Math.max(8, settings.fontSize - 1),
                    })
                  }
                >
                  −
                </button>
                <span>{settings.fontSize} px</span>
                <button
                  onClick={() =>
                    onChange({
                      ...settings,
                      fontSize: Math.min(32, settings.fontSize + 1),
                    })
                  }
                >
                  +
                </button>
              </div>
            </div>
            <div
              className="font-preview"
              style={{
                fontFamily: settings.fontFamily,
                fontSize: settings.fontSize,
              }}
            >
              ~/superkitty $ claude --resume ✦ [Image #1]
            </div>
          </section>

          <section className="settings-section">
            <h3 className="settings-h3">Notifications</h3>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.notify}
                onChange={(e) =>
                  onChange({ ...settings, notify: e.target.checked })
                }
              />
              <span>
                Notifier (macOS) quand un agent termine dans une fenêtre non
                regardée
              </span>
            </label>
          </section>

          <section className="settings-section">
            <h3 className="settings-h3">Raccourcis clavier</h3>
            <div className="shortcut-cols">
              {SHORTCUTS.map((g) => (
                <div key={g.group} className="shortcut-group">
                  <h4 className="shortcut-h4">{g.group}</h4>
                  {g.items.map(([chord, action]) => (
                    <div key={action} className="shortcut-row">
                      <span className="shortcut-action">{action}</span>
                      <kbd className="shortcut-kbd">{chord}</kbd>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
