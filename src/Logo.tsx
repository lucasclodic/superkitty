// Le logo « superkitty » : une silhouette de chat (tête + oreilles) remplie du
// ruban six-couleurs maison (cf. design/charte-noir-bureau.html). Isolé ici en
// composant réutilisable pour le titlebar, les overlays, etc.

// Les six bandes du ruban, du haut (oreilles) vers le bas (menton).
const RIBBON = [
  "#6FB36A", // vert
  "#F0C04E", // jaune
  "#EE965A", // orange
  "#E2685E", // rouge
  "#A87FC4", // violet
  "#54AEC0", // bleu
];

// Tête de chat « Platinum Noir », viewBox 0..100. Reprise verbatim du SVG de la charte.
const CAT_PATH =
  "M16 12 L33 38 Q50 29 67 38 L84 12 L89 53 Q86 80 63 91 Q50 97 37 91 Q14 80 11 53 Q11 31 16 12 Z";

let gradSeq = 0;

export function Logo({
  size = 18,
  className,
  title = "superkitty",
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  // Id de dégradé unique par instance (plusieurs logos sur la même page).
  const gradId = `superkitty-ribbon-${gradSeq++}`;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={title}
    >
      <defs>
        <linearGradient
          id={gradId}
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="6"
          x2="0"
          y2="94"
        >
          {RIBBON.map((color, i) => (
            // Bandes franches : chaque couleur occupe 1/6 de la hauteur.
            <g key={color}>
              <stop offset={i / 6} stopColor={color} />
              <stop offset={(i + 1) / 6} stopColor={color} />
            </g>
          ))}
        </linearGradient>
      </defs>
      <path fill={`url(#${gradId})`} d={CAT_PATH} />
    </svg>
  );
}
