// Kitty-style window layouts.
//
// A tab holds a FLAT, ordered list of panes (terminals) plus a named layout.
// A layout is a pure function (n, focusedIndex, opts) -> Rect[], one rectangle
// per pane (in pane order), expressed in fractions of the tab area (0..1).
// Every add/close recomputes ALL rectangles, so the arrangement stays balanced
// — this is what kitty does, and why nothing "piles up" the way a binary split
// tree does. Ported from kovidgoyal/kitty: kitty/layout/{grid,tall,base}.py.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type LayoutName =
  | "tall"
  | "fat"
  | "grid"
  | "horizontal"
  | "vertical"
  | "stack";

/** Order used by next_layout / prev_layout (⌃⇧L). `tall` is the default. */
export const LAYOUT_CYCLE: LayoutName[] = [
  "tall",
  "fat",
  "grid",
  "horizontal",
  "vertical",
  "stack",
];

export function isLayoutName(v: unknown): v is LayoutName {
  return typeof v === "string" && (LAYOUT_CYCLE as string[]).includes(v);
}

export function nextLayout(name: LayoutName): LayoutName {
  const i = LAYOUT_CYCLE.indexOf(name);
  return LAYOUT_CYCLE[(i + 1) % LAYOUT_CYCLE.length];
}

export function prevLayout(name: LayoutName): LayoutName {
  const i = LAYOUT_CYCLE.indexOf(name);
  return LAYOUT_CYCLE[(i - 1 + LAYOUT_CYCLE.length) % LAYOUT_CYCLE.length];
}

export interface LayoutOpts {
  /** Fraction (0.1–0.9) given to the main column/row in tall/fat. */
  bias?: number;
}

const DEFAULT_BIAS = 0.5;

const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 };
const HIDDEN: Rect = { x: 0, y: 0, w: 0, h: 0 };

/** Split [0,1] into `n` equal columns. */
function equalCols(n: number): Rect[] {
  return Array.from({ length: n }, (_, i) => ({
    x: i / n,
    y: 0,
    w: 1 / n,
    h: 1,
  }));
}

/** Split [0,1] into `n` equal rows. */
function equalRows(n: number): Rect[] {
  return Array.from({ length: n }, (_, i) => ({
    x: 0,
    y: i / n,
    w: 1,
    h: 1 / n,
  }));
}

/** kitty grid.py calc_grid_size: pick a near-square column/row count. */
function calcGridSize(n: number): {
  ncols: number;
  nrows: number;
  specialRows: number;
  specialCol: number;
} {
  let ncols: number;
  if (n <= 5) {
    ncols = n === 1 ? 1 : 2;
  } else {
    ncols = 1;
    while (ncols * ncols < n) ncols++;
  }
  const nrows = Math.floor(n / ncols);
  const specialRows = n - nrows * (ncols - 1);
  const specialCol = specialRows < nrows ? 0 : ncols - 1;
  return { ncols, nrows, specialRows, specialCol };
}

/** kitty `grid`: balanced grid, columns equal width, rows equal within a column.
 *  Panes fill column-major (top→bottom, then left→right). */
function gridLayout(n: number): Rect[] {
  if (n <= 1) return [FULL];
  const { ncols, nrows, specialRows, specialCol } = calcGridSize(n);
  const rects: Rect[] = [];
  for (let c = 0; c < ncols; c++) {
    const rowsInCol = c === specialCol ? specialRows : nrows;
    for (let r = 0; r < rowsInCol; r++) {
      rects.push({
        x: c / ncols,
        y: r / rowsInCol,
        w: 1 / ncols,
        h: 1 / rowsInCol,
      });
    }
  }
  return rects;
}

/** kitty `tall`: one full-height main column (left, width=bias), the rest
 *  stacked equally in the right column. */
function tallLayout(n: number, bias: number): Rect[] {
  if (n <= 1) return [FULL];
  const rest = n - 1;
  const rects: Rect[] = [{ x: 0, y: 0, w: bias, h: 1 }];
  for (let i = 0; i < rest; i++) {
    rects.push({ x: bias, y: i / rest, w: 1 - bias, h: 1 / rest });
  }
  return rects;
}

/** kitty `fat`: transpose of tall — one full-width main row (top, height=bias),
 *  the rest tiled equally side-by-side below. */
function fatLayout(n: number, bias: number): Rect[] {
  if (n <= 1) return [FULL];
  const rest = n - 1;
  const rects: Rect[] = [{ x: 0, y: 0, w: 1, h: bias }];
  for (let i = 0; i < rest; i++) {
    rects.push({ x: i / rest, y: bias, w: 1 / rest, h: 1 - bias });
  }
  return rects;
}

/** kitty `stack`: only the focused pane is visible (full area); others hidden. */
function stackLayout(n: number, focusedIndex: number): Rect[] {
  return Array.from({ length: n }, (_, i) =>
    i === focusedIndex ? FULL : HIDDEN,
  );
}

export type Direction = "left" | "right" | "up" | "down";

/** Index of the spatially-nearest visible pane in `dir` from pane `idx`, or -1
 *  if there is none (kitty `neighboring_window`). Picks the closest center
 *  along the travel axis, preferring panes aligned on the perpendicular axis. */
export function neighbor(rects: Rect[], idx: number, dir: Direction): number {
  const cur = rects[idx];
  if (!cur) return -1;
  const cx = cur.x + cur.w / 2;
  const cy = cur.y + cur.h / 2;
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < rects.length; i++) {
    if (i === idx) continue;
    const r = rects[i];
    if (r.w === 0 || r.h === 0) continue; // hidden (stack layout)
    const dx = r.x + r.w / 2 - cx;
    const dy = r.y + r.h / 2 - cy;
    let primary: number;
    let perp: number;
    if (dir === "left") {
      if (dx >= -1e-6) continue;
      primary = -dx;
      perp = Math.abs(dy);
    } else if (dir === "right") {
      if (dx <= 1e-6) continue;
      primary = dx;
      perp = Math.abs(dy);
    } else if (dir === "up") {
      if (dy >= -1e-6) continue;
      primary = -dy;
      perp = Math.abs(dx);
    } else {
      if (dy <= 1e-6) continue;
      primary = dy;
      perp = Math.abs(dx);
    }
    // Travel distance dominates; perpendicular offset only breaks ties.
    const score = primary + perp * 3;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/** Rectangles (fractions) for every pane, in pane order. */
export function layoutRects(
  name: LayoutName,
  n: number,
  focusedIndex: number,
  opts: LayoutOpts = {},
): Rect[] {
  if (n <= 0) return [];
  const bias = Math.min(0.9, Math.max(0.1, opts.bias ?? DEFAULT_BIAS));
  switch (name) {
    case "stack":
      return stackLayout(n, focusedIndex);
    case "horizontal":
      return equalCols(n);
    case "vertical":
      return equalRows(n);
    case "grid":
      return gridLayout(n);
    case "fat":
      return fatLayout(n, bias);
    case "tall":
    default:
      return tallLayout(n, bias);
  }
}
