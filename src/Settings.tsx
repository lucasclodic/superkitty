import { useEffect, useMemo, useState } from "react";
import { AgentPreset, FONT_CHOICES, SkSettings, THEMES } from "./themes";
import { AgentIcon } from "./ProjectRail";
import {
  ACTIONS,
  Bindings,
  buildLookup,
  chordFromEvent,
  DEFAULTS,
  formatChord,
  resolveBindings,
  toOverrides,
} from "./shortcuts";

type Category =
  | "apparence"
  | "police"
  | "agents"
  | "notifications"
  | "raccourcis"
  | "apropos";

const CATEGORIES: { id: Category; label: string; icon: string }[] = [
  { id: "apparence", label: "Apparence", icon: "🎨" },
  { id: "police", label: "Police", icon: "🔤" },
  { id: "agents", label: "Agents", icon: "✦" },
  { id: "notifications", label: "Notifications", icon: "🔔" },
  { id: "raccourcis", label: "Raccourcis", icon: "⌨️" },
  { id: "apropos", label: "À propos", icon: "ℹ️" },
];

/**
 * Settings panel (idea #3), redesigned as a two-pane "visual" config: a left
 * category rail + a right content pane. Theme/font/notifications apply live;
 * the Raccourcis pane edits the reassignable bindings (see shortcuts.ts).
 * Opened with ⌘, or the titlebar ⚙ ; closed with Esc / outside click.
 */
export function Settings({
  settings,
  onChange,
  bindings,
  onChangeBindings,
  onClose,
}: {
  settings: SkSettings;
  onChange: (s: SkSettings) => void;
  bindings: Bindings;
  onChangeBindings: (b: Bindings) => void;
  onClose: () => void;
}) {
  const [category, setCategory] = useState<Category>("apparence");

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

        <div className="settings-2pane">
          <nav className="settings-nav">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                className={`settings-nav-item${category === c.id ? " active" : ""}`}
                onClick={() => setCategory(c.id)}
              >
                <span className="settings-nav-icon">{c.icon}</span>
                <span>{c.label}</span>
              </button>
            ))}
          </nav>

          <div className="settings-pane">
            {category === "apparence" && (
              <AppearancePane settings={settings} onChange={onChange} />
            )}
            {category === "police" && (
              <FontPane settings={settings} onChange={onChange} />
            )}
            {category === "agents" && (
              <AgentsPane settings={settings} onChange={onChange} />
            )}
            {category === "notifications" && (
              <NotificationsPane settings={settings} onChange={onChange} />
            )}
            {category === "raccourcis" && (
              <ShortcutsPane
                bindings={bindings}
                onChangeBindings={onChangeBindings}
                settings={settings}
                onChange={onChange}
              />
            )}
            {category === "apropos" && <AboutPane />}
          </div>
        </div>
      </div>
    </div>
  );
}

function AppearancePane({
  settings,
  onChange,
}: {
  settings: SkSettings;
  onChange: (s: SkSettings) => void;
}) {
  return (
    <section className="settings-section">
      <h3 className="settings-h3">Mode d'affichage</h3>
      <div className="ui-mode-grid">
        <button
          className={`ui-mode-card${settings.uiMode !== "v2" ? " active" : ""}`}
          onClick={() => onChange({ ...settings, uiMode: "classic" })}
        >
          <span className="ui-mode-name">Classique</span>
          <span className="ui-mode-desc">Onglets + grille kitty (violet)</span>
        </button>
        <button
          className={`ui-mode-card${settings.uiMode === "v2" ? " active" : ""}`}
          onClick={() => onChange({ ...settings, uiMode: "v2" })}
        >
          <span className="ui-mode-name">v2 — rail projet</span>
          <span className="ui-mode-desc">
            « Platinum Noir » + fenêtrage kitty
          </span>
        </button>
      </div>

      <h3 className="settings-h3" style={{ marginTop: 18 }}>
        Thème
      </h3>
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
  );
}

function FontPane({
  settings,
  onChange,
}: {
  settings: SkSettings;
  onChange: (s: SkSettings) => void;
}) {
  return (
    <section className="settings-section">
      <h3 className="settings-h3">Police</h3>
      <div className="settings-row">
        <label>Famille</label>
        <select
          value={settings.fontFamily}
          onChange={(e) => onChange({ ...settings, fontFamily: e.target.value })}
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
        style={{ fontFamily: settings.fontFamily, fontSize: settings.fontSize }}
      >
        ~/superkitty $ claude --resume ✦ [Image #1]
      </div>
    </section>
  );
}

function AgentsPane({
  settings,
  onChange,
}: {
  settings: SkSettings;
  onChange: (s: SkSettings) => void;
}) {
  const update = (i: number, patch: Partial<AgentPreset>) =>
    onChange({
      ...settings,
      agentPresets: settings.agentPresets.map((p, j) =>
        j === i ? { ...p, ...patch } : p,
      ),
    });
  return (
    <section className="settings-section">
      <h3 className="settings-h3">Agents (rail v2)</h3>
      <p className="settings-hint" style={{ marginTop: 0, marginBottom: 14 }}>
        Les logos au survol d'un projet (mode v2). Un clic ouvre une nouvelle
        fenêtre et y lance la commande. Personnalise-la — ex.{" "}
        <code>claude --dangerously-skip-permissions</code> pour Claude sans
        confirmation de permissions.
      </p>
      {settings.agentPresets.map((p, i) => (
        <div key={p.id} className="agent-row">
          <span className="agent-icon">
            <AgentIcon icon={p.icon} />
          </span>
          <input
            className="agent-label"
            value={p.label}
            aria-label="Nom"
            onChange={(e) => update(i, { label: e.target.value })}
          />
          <input
            className="agent-cmd"
            value={p.command}
            aria-label="Commande"
            placeholder="commande shell"
            spellCheck={false}
            onChange={(e) => update(i, { command: e.target.value })}
          />
        </div>
      ))}
    </section>
  );
}

function NotificationsPane({
  settings,
  onChange,
}: {
  settings: SkSettings;
  onChange: (s: SkSettings) => void;
}) {
  return (
    <section className="settings-section">
      <h3 className="settings-h3">Notifications</h3>
      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={settings.notify}
          onChange={(e) => onChange({ ...settings, notify: e.target.checked })}
        />
        <span>
          Notifier (macOS) quand un agent termine dans une fenêtre non regardée
        </span>
      </label>
      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={settings.notifySound}
          onChange={(e) =>
            onChange({ ...settings, notifySound: e.target.checked })
          }
        />
        <span>Jouer un petit son quand un agent termine</span>
      </label>
      <p className="settings-hint">
        Le pane concerné s'entoure d'une traînée lumineuse jusqu'à ce que tu
        cliques dedans.
      </p>
      <h3 className="settings-h3" style={{ marginTop: 18 }}>
        Fiabilité
      </h3>
      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={settings.reinforceAgentDone}
          onChange={(e) =>
            onChange({ ...settings, reinforceAgentDone: e.target.checked })
          }
        />
        <span>Notifications fiables (recommandé)</span>
      </label>
      <p className="settings-hint">
        Installe des hooks <code>Stop</code>/<code>Notification</code>{" "}
        sémantiques dans <code>~/.claude/settings.json</code> : tu n'es notifié·e
        que quand l'agent a <strong>vraiment terminé</strong> son tour ou qu'il{" "}
        <strong>te réclame</strong> (autorisation / saisie), jamais sur une cloche
        intermédiaire ou un sous-agent. Activé par défaut ; sans effet hors
        superkitty. Décoche pour retirer les hooks (les notifs deviennent alors
        peu fiables).
      </p>
    </section>
  );
}

function ShortcutsPane({
  bindings,
  onChangeBindings,
  settings,
  onChange,
}: {
  bindings: Bindings;
  onChangeBindings: (b: Bindings) => void;
  settings: SkSettings;
  onChange: (s: SkSettings) => void;
}) {
  const [query, setQuery] = useState("");
  // The action currently waiting for a keypress, or null.
  const [capturing, setCapturing] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);

  const resolved = useMemo(() => resolveBindings(bindings), [bindings]);

  const applyResolved = (next: Record<string, string[]>) =>
    onChangeBindings(toOverrides(next));

  const removeChord = (id: string, chord: string) => {
    applyResolved({ ...resolved, [id]: resolved[id].filter((c) => c !== chord) });
  };

  const resetAction = (id: string) => {
    applyResolved({ ...resolved, [id]: [...DEFAULTS[id]] });
  };

  // Listen for the next chord while capturing for an action.
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setCapturing(null);
        return;
      }
      // Ignore lone modifier presses; wait for a real key.
      if (/^(Control|Alt|Shift|Meta)(Left|Right)$/.test(e.code)) return;
      const chord = chordFromEvent(e);
      if (!chord) {
        setWarn("Ajoutez ⌘ ou ⌃ au raccourci.");
        return;
      }
      // Conflict: steal the chord from whoever holds it.
      const owner = buildLookup(resolved).get(chord);
      const next = { ...resolved };
      for (const other of Object.keys(next)) {
        if (other !== capturing && next[other].includes(chord)) {
          next[other] = next[other].filter((c) => c !== chord);
        }
      }
      if (!next[capturing].includes(chord)) {
        next[capturing] = [...next[capturing], chord];
      }
      applyResolved(next);
      if (owner && owner !== capturing) {
        const label = ACTIONS.find((a) => a.id === owner)?.label ?? owner;
        setNote(`« ${formatChord(chord)} » retiré de « ${label} ».`);
      } else {
        setNote(null);
      }
      setWarn(null);
      setCapturing(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing, bindings]);

  const q = query.trim().toLowerCase();
  // Group actions for display, filtered by the search query.
  const groups: { group: string; items: typeof ACTIONS }[] = [];
  for (const a of ACTIONS) {
    if (q && !a.label.toLowerCase().includes(q) && !a.group.toLowerCase().includes(q))
      continue;
    let g = groups.find((x) => x.group === a.group);
    if (!g) {
      g = { group: a.group, items: [] };
      groups.push(g);
    }
    g.items.push(a);
  }

  return (
    <section className="settings-section">
      <label className="settings-toggle" style={{ marginBottom: 14 }}>
        <input
          type="checkbox"
          checked={settings.hintsEnabled}
          onChange={(e) =>
            onChange({ ...settings, hintsEnabled: e.target.checked })
          }
        />
        <span>Afficher des astuces de raccourcis en bas de la fenêtre</span>
      </label>

      <div className="settings-row" style={{ marginBottom: 14 }}>
        <input
          className="key-search"
          type="text"
          placeholder="Rechercher un raccourci…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>

      {note && <p className="key-note">{note}</p>}

      {groups.map((g) => (
        <div key={g.group} className="key-group">
          <h4 className="shortcut-h4">{g.group}</h4>
          {g.items.map((a) => {
            const chords = resolved[a.id] ?? [];
            const overridden = bindings[a.id] !== undefined;
            const isCapturing = capturing === a.id;
            return (
              <div key={a.id} className="key-row">
                <span className="key-label">{a.label}</span>
                <div className="key-controls">
                  {chords.map((c) => (
                    <span key={c} className="key-chip">
                      {formatChord(c)}
                      <button
                        className="key-chip-x"
                        title="Retirer"
                        onClick={() => removeChord(a.id, c)}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                  {isCapturing ? (
                    <span className="key-capture">
                      {warn ?? "Appuyez sur une touche…"}
                    </span>
                  ) : (
                    <button
                      className="key-add"
                      title="Ajouter un raccourci"
                      onClick={() => {
                        setWarn(null);
                        setCapturing(a.id);
                      }}
                    >
                      ＋
                    </button>
                  )}
                  {overridden && (
                    <button
                      className="key-reset"
                      title="Réinitialiser"
                      onClick={() => resetAction(a.id)}
                    >
                      ↺
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}

function AboutPane() {
  return (
    <section className="settings-section">
      <h3 className="settings-h3">À propos</h3>
      <p className="about-text">
        <strong>superkitty</strong> — un terminal macOS dédié à Claude Code :
        vrai PTY façon kitty, sessions persistantes via tmux, et une UI sans
        friction (drag & drop d'images, panes kitty, palette de commandes).
      </p>
      <p className="about-text">
        Astuces : <kbd className="shortcut-kbd">⌘K</kbd> ouvre la palette de
        commandes, <kbd className="shortcut-kbd">⌃`</kbd> la fenêtre Quake
        globale depuis n'importe quelle app.
      </p>
    </section>
  );
}
