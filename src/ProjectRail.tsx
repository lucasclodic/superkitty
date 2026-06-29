// Mode d'affichage v2 (« Platinum Noir ») — rail projet permanent + fil
// d'Ariane. C'est de la NAVIGATION re-skinnée par-dessus le moteur existant :
//   · un projet  = un onglet (Tab)
//   · une session = un pane (paneId) dans cet onglet
// Aucune session/PTY n'est créée ici — App fournit les données dérivées de
// l'état déjà monté et reçoit les clics. Voir handoff/2026-06-27-…
import { useEffect, useReducer } from "react";
import type { AgentPreset } from "./themes";

/** Statut harmonisé : UNE pastille, couleur = état.
 *   · busy = en cours (du texte sort EN CE MOMENT)  → orange, spinner braille
 *   · need = t'attend (la cloche a sonné, pas regardé) → orange, anneau clignotant
 *   · idle = au repos                                → creux */
export type SessionStatus = "busy" | "need" | "idle";

// `busy` est rendu par <BusyGlyph/> (spinner animé), pas par cette table.
const ST_GLYPH: Record<SessionStatus, string> = {
  busy: "⠿", // fallback statique (jamais affiché : busy passe par BusyGlyph)
  need: "◌", // anneau pointillé — « te réclame », distinct du creux idle ○
  idle: "○",
};

// ── Spinner braille « façon Claude » ───────────────────────────────────────
// Un SEUL timer pour tous les spinners du rail (synchronisés), démarré au
// premier abonné et arrêté quand il n'y en a plus (ref-count). Aucun re-render
// d'App : seuls les petits <BusyGlyph/> abonnés se redessinent.
const BRAILLE = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
const reduceMotion =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let spinFrame = 0;
let spinTimer: ReturnType<typeof setInterval> | null = null;
const spinSubs = new Set<() => void>();

function spinSubscribe(fn: () => void) {
  spinSubs.add(fn);
  if (spinTimer === null && !reduceMotion) {
    spinTimer = setInterval(() => {
      spinFrame = (spinFrame + 1) % BRAILLE.length;
      spinSubs.forEach((f) => f());
    }, 90);
  }
}

function spinUnsubscribe(fn: () => void) {
  spinSubs.delete(fn);
  if (spinSubs.size === 0 && spinTimer !== null) {
    clearInterval(spinTimer);
    spinTimer = null;
  }
}

/** Glyphe braille animé pour une session « en cours » (figé si reduce-motion). */
function BusyGlyph() {
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    spinSubscribe(force);
    return () => spinUnsubscribe(force);
  }, []);
  return <>{BRAILLE[spinFrame]}</>;
}

export interface RailSession {
  /** paneId. */
  id: string;
  /** Libellé court (titre de fenêtre Claude / `/rename`, sinon « Terminal »). */
  title: string;
  status: SessionStatus;
  /** Quel agent tourne ici → quel logo de marque dessiner (rail réduit). */
  agent: AgentPreset["icon"];
  /** La fenêtre actuellement focalisée du projet actif (mise en avant). */
  selected: boolean;
}

export interface RailProject {
  /** tabId. */
  id: string;
  name: string;
  tint?: string;
  active: boolean;
  /** Replié (false) → ses fenêtres sont masquées dans le rail. */
  expanded: boolean;
  sessions: RailSession[];
}

/** Vrais logos de marque (tracés simple-icons, CC0), rendus en blanc. */
export function AgentIcon({ icon }: { icon: AgentPreset["icon"] }) {
  if (icon === "claude") {
    // Claude — l'éclat (sunburst).
    return (
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path
          fill="#fff"
          d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"
        />
      </svg>
    );
  }
  if (icon === "gemini") {
    // Google Gemini — l'étoile à 4 branches concaves (sparkle).
    return (
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path
          fill="#fff"
          d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81"
        />
      </svg>
    );
  }
  if (icon === "codex") {
    // OpenAI / Codex — la rosace (blossom).
    return (
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path
          fill="#fff"
          d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"
        />
      </svg>
    );
  }
  // generic — invite shell.
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <g
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <path d="M5 7l5 5-5 5" />
        <line x1="12" y1="17" x2="19" y2="17" />
      </g>
    </svg>
  );
}

export function ProjectRail({
  projects,
  presets,
  collapsed,
  onSelectProject,
  onOpenSession,
  onToggleExpand,
  onNewProject,
  onNewWindow,
  onLaunch,
  onSettings,
  onCollapse,
  onExpand,
}: {
  projects: RailProject[];
  /** Presets d'agent (icônes au survol d'un en-tête de projet). */
  presets: AgentPreset[];
  /** Rail réduit : barre fine (pastilles seules) au lieu du panneau complet. */
  collapsed: boolean;
  onSelectProject: (tabId: string) => void;
  /** Drill : ouvrir une fenêtre en grand (zoom) dans son projet. */
  onOpenSession: (tabId: string, paneId: string) => void;
  /** Plier/déplier les fenêtres d'un projet (chevron). */
  onToggleExpand: (tabId: string) => void;
  /** Nouveau projet (= nouvel onglet). */
  onNewProject: () => void;
  /** Nouvelle fenêtre shell dans un projet (bouton +). */
  onNewWindow: (tabId: string) => void;
  /** Lancer un agent : nouvelle fenêtre + exécuter `command` (clic sur un logo). */
  onLaunch: (tabId: string, command: string) => void;
  onSettings: () => void;
  /** Réduire le rail (complet → mini). */
  onCollapse: () => void;
  /** Déplier le rail (mini → complet). */
  onExpand: () => void;
}) {
  const active = projects.find((p) => p.active);

  // Rail réduit : une barre fine, lisible « façon Warp ». On navigue de projet
  // en projet (pastilles de teinte, ⌘1-9) et, dans le projet actif, de fenêtre
  // en fenêtre — chaque session = le LOGO de son agent (Claude/Codex/Gemini)
  // dans une tuile + une petite pastille de statut en coin (orange = en cours),
  // au lieu d'un glyphe minuscule. Nom complet au survol. Même projection d'état
  // que le rail complet.
  if (collapsed) {
    return (
      <aside className="rail rail-mini">
        <div className="rail-mini-head">
          <button
            className="rail-add"
            title="Déplier le rail (⌘B)"
            onClick={onExpand}
          >
            ›
          </button>
          <button
            className="rail-add"
            title="Nouveau projet (⌘T)"
            onClick={onNewProject}
          >
            +
          </button>
        </div>

        <div className="rail-mini-scroll">
          {projects.map((proj, i) => (
            <div
              key={proj.id}
              className={`mini-proj${proj.active ? " active-proj" : ""}`}
              style={{ ["--tint" as string]: proj.tint ?? "var(--cream-faint)" }}
            >
              <button
                className="mini-pdot"
                title={`${proj.name}${i < 9 ? ` — ⌘${i + 1}` : ""}`}
                onClick={() => onSelectProject(proj.id)}
              >
                <span className="pdot" />
                {!proj.active &&
                  proj.sessions.some((s) => s.status !== "idle") && (
                    <span className="mini-badge" />
                  )}
              </button>
              {proj.active &&
                proj.sessions.map((s) => (
                  <button
                    key={s.id}
                    className={`mini-sess st-${s.status}${s.selected ? " sel" : ""}`}
                    title={s.title}
                    onClick={() => onOpenSession(proj.id, s.id)}
                  >
                    <AgentIcon icon={s.agent} />
                    <span className={`mini-st-badge ${s.status}`} />
                  </button>
                ))}
            </div>
          ))}
        </div>

        <div className="rail-mini-foot">
          <button
            className="rail-add"
            title="Nouvelle fenêtre dans le projet actif"
            onClick={() => active && onNewWindow(active.id)}
          >
            ＋
          </button>
          <button className="rail-gear" title="Réglages (⌘,)" onClick={onSettings}>
            ⚙
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="rail">
      <div className="rail-head">
        <span className="rail-ttl">Projets</span>
        <div className="rail-head-actions">
          <button
            className="rail-add"
            title="Nouveau projet (⌘T)"
            onClick={onNewProject}
          >
            +
          </button>
          <button
            className="rail-add"
            title="Réduire le rail (⌘B)"
            onClick={onCollapse}
          >
            ‹
          </button>
        </div>
      </div>

      <div className="rail-scroll">
        {projects.map((proj) => (
          <div
            key={proj.id}
            className={`proj${proj.active ? " active-proj" : ""}`}
            style={{ ["--tint" as string]: proj.tint ?? "var(--cream-faint)" }}
          >
            <div
              className="proj-head"
              onClick={() => onSelectProject(proj.id)}
              title={proj.name}
            >
              <button
                className={`proj-chevron${proj.expanded ? " open" : ""}`}
                title={proj.expanded ? "Masquer les fenêtres" : "Voir les fenêtres"}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleExpand(proj.id);
                }}
              >
                ›
              </button>
              <span className="pdot" />
              <span className="proj-name">{proj.name}</span>
              {/* Slot de droite à largeur stable : le compteur au repos, les
                  logos d'agent en surimpression au survol — JAMAIS de reflow du
                  nom (les `.pacts` sont hors-flux, position:absolute). */}
              <span className="proj-meta">
                <span className="cnt">{proj.sessions.length}</span>
                <span className="pacts" onClick={(e) => e.stopPropagation()}>
                  {presets.map((preset) => (
                    <button
                      key={preset.id}
                      className="pact"
                      title={`Nouvelle fenêtre — ${preset.label} (${preset.command})`}
                      onClick={() => onLaunch(proj.id, preset.command)}
                    >
                      <AgentIcon icon={preset.icon} />
                    </button>
                  ))}
                  <button
                    className="pact add"
                    title="Nouvelle fenêtre (shell)"
                    onClick={() => onNewWindow(proj.id)}
                  >
                    +
                  </button>
                </span>
              </span>
            </div>

            {proj.expanded && (
              <div className="sessions">
                {proj.sessions.map((s) => (
                  <div
                    key={s.id}
                    className={`session ${s.status}${s.selected ? " sel" : ""}`}
                    onClick={() => onOpenSession(proj.id, s.id)}
                    title={s.title}
                  >
                    <span className={`st ${s.status}`}>
                      {s.status === "busy" ? <BusyGlyph /> : ST_GLYPH[s.status]}
                    </span>
                    <span className="ttl">{s.title}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Légende « tableau de bord » (proto) — uniquement les états réellement
          rendus dans le rail. « te réclame » vit dans la cloche (centre de
          notifs), pas comme pastille de session. */}
      <div className="legend">
        <span>
          <i className="busy" /> en cours
        </span>
        <span>
          <i className="idle" /> au repos
        </span>
      </div>

      <div className="rail-foot">
        <button
          className="rail-foot-new"
          title="Nouvelle fenêtre dans le projet actif"
          onClick={() => active && onNewWindow(active.id)}
        >
          ＋ nouvelle session
        </button>
        <button className="rail-gear" title="Réglages (⌘,)" onClick={onSettings}>
          ⚙
        </button>
      </div>
    </aside>
  );
}

/** Fil d'Ariane de la zone principale (v2) : `projet › fenêtre` + retour à la
 *  grille quand une fenêtre est agrandie (zoom). */
export function V2Crumb({
  projectName,
  tint,
  leaf,
  onBackToGrid,
}: {
  projectName: string;
  tint?: string;
  /** Libellé de la fenêtre agrandie, ou null en vue grille. */
  leaf: string | null;
  onBackToGrid: () => void;
}) {
  return (
    <div
      className="crumb"
      style={{ ["--tint" as string]: tint ?? "var(--cream-faint)" }}
    >
      <span className="cdot" />
      <span
        className={`crumb-proj${leaf ? " clickable" : ""}`}
        onClick={leaf ? onBackToGrid : undefined}
        title={leaf ? "Revenir à la grille du projet" : projectName}
      >
        {projectName}
      </span>
      {leaf && (
        <>
          <span className="crumb-sep">›</span>
          <span className="crumb-leaf">{leaf}</span>
          <div className="crumb-right">
            <button className="crumb-back" onClick={onBackToGrid}>
              ← grille du projet
            </button>
          </div>
        </>
      )}
    </div>
  );
}
