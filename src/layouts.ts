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

/** For one pane, the candidate neighbor pane indices on each side — a direct
 *  port of kitty's per-layout `neighbors_for_window`. This is TOPOLOGICAL (it
 *  reads the pane's position in the flat list, exactly like kitty), NOT a
 *  geometric scan of the rendered rectangles. That distinction is what makes
 *  move_window an involution: swapping in one direction and then back picks the
 *  same partner, because the relation is defined on the list, not on pixels.
 *  When a side lists several candidates, the caller breaks the tie with
 *  most-recently-used (kitty `most_recent_group`). */
export type NeighborsMap = Partial<Record<Direction, number[]>>;

/** Integers [a, b). */
function range(a: number, b: number): number[] {
  const xs: number[] = [];
  for (let i = a; i < b; i++) xs.push(i);
  return xs;
}

/** kitty `neighbors_for_tall_window` (tall: mainIsHorizontal; fat: transposed).
 *  superkitty always runs with one full-size main window. */
function neighborsTall(
  idx: number,
  n: number,
  mainIsHorizontal: boolean,
): NeighborsMap {
  const numFull = 1;
  const prev = idx === 0 ? -1 : idx - 1;
  const nxt = idx === n - 1 ? -1 : idx + 1;
  const mainBefore: Direction = mainIsHorizontal ? "left" : "up";
  const mainAfter: Direction = mainIsHorizontal ? "right" : "down";
  const crossBefore: Direction = mainIsHorizontal ? "up" : "left";
  const crossAfter: Direction = mainIsHorizontal ? "down" : "right";
  const ans: NeighborsMap = {};
  if (prev >= 0) ans[mainBefore] = [prev];
  if (idx < numFull - 1) {
    if (nxt >= 0) ans[mainAfter] = [nxt];
  } else if (idx === numFull - 1) {
    ans[mainAfter] = range(idx + 1, n); // main window: every secondary
  } else {
    ans[mainBefore] = [numFull - 1]; // secondary: the main window
    if (idx > numFull && prev >= 0) ans[crossBefore] = [prev];
    if (nxt >= 0) ans[crossAfter] = [nxt];
  }
  return ans;
}

/** kitty Vertical/Horizontal `neighbors_for_window` — a single line of panes
 *  that WRAPS at both ends (matches kitty's modular arithmetic). */
function neighborsLine(
  idx: number,
  n: number,
  mainIsHorizontal: boolean,
): NeighborsMap {
  if (n <= 1) return {};
  const after = [(idx - 1 + n) % n];
  const before = [(idx + 1) % n];
  const akey: Direction = mainIsHorizontal ? "left" : "up";
  const bkey: Direction = mainIsHorizontal ? "right" : "down";
  return { [akey]: after, [bkey]: before };
}

/** kitty Stack `neighbors_for_window`: prev pane on top/left, next on
 *  bottom/right (no wrap). */
function neighborsStack(idx: number, n: number): NeighborsMap {
  const before = idx === 0 ? [] : [idx - 1];
  const after = idx === n - 1 ? [] : [idx + 1];
  return { up: before, left: before, right: after, down: after };
}

/** kitty Grid `neighbors_for_window`. Falls back to tall for n < 4, then maps
 *  the pane's (row, col) onto the column-major grid, spanning differing column
 *  heights proportionally (kitty's `side` helper). */
function neighborsGrid(idx: number, n: number): NeighborsMap {
  if (n < 4) return neighborsTall(idx, n, true);
  const { ncols, nrows, specialRows, specialCol } = calcGridSize(n);
  // Column-major fill (same order as gridLayout): record each pane's (row,col)
  // and how many rows live in each column.
  const posOf: Array<[number, number]> = [];
  const colCounts: number[] = [];
  let p = 0;
  for (let col = 0; col < ncols; col++) {
    const rows = col === specialCol ? specialRows : nrows;
    for (let row = 0; row < rows; row++) posOf[p++] = [row, col];
    colCounts.push(rows);
  }
  const maxRows = Math.max(nrows, specialRows);
  const matrix: (number | null)[][] = Array.from({ length: maxRows }, () =>
    new Array<number | null>(ncols).fill(null),
  );
  for (let q = 0; q < n; q++) {
    const [r, c] = posOf[q];
    matrix[r][c] = q;
  }
  const [row, col] = posOf[idx];

  const cell = (r: number, c: number): number[] => {
    if (r < 0 || r >= matrix.length || c < 0 || c >= ncols) return [];
    const v = matrix[r][c];
    return v == null ? [] : [v];
  };
  const side = (r: number, c: number, delta: number): number[] => {
    const nc = c + delta;
    const neighborNrows = colCounts[nc];
    const myNrows = colCounts[c];
    if (neighborNrows === myNrows) return cell(r, nc);
    const startRow = Math.floor((neighborNrows * r) / myNrows);
    const endRow = Math.ceil((neighborNrows * (r + 1)) / myNrows);
    const xs: number[] = [];
    for (let nr = startRow; nr < endRow; nr++) xs.push(...cell(nr, nc));
    return xs;
  };

  const ans: NeighborsMap = {};
  if (row) ans.up = cell(row - 1, col);
  const bottom = cell(row + 1, col);
  if (bottom.length) ans.down = bottom;
  if (col) {
    const left = side(row, col, -1);
    if (left.length) ans.left = left;
  }
  if (col < ncols - 1) ans.right = side(row, col, 1);
  return ans;
}

/** Candidate neighbor pane indices on each side of pane `idx`, per layout —
 *  the basis for both `neighboring_window` (focus) and `move_window` (swap). */
export function neighborsForWindow(
  name: LayoutName,
  n: number,
  idx: number,
): NeighborsMap {
  if (idx < 0 || idx >= n) return {};
  switch (name) {
    case "stack":
      return neighborsStack(idx, n);
    case "horizontal":
      return neighborsLine(idx, n, true);
    case "vertical":
      return neighborsLine(idx, n, false);
    case "grid":
      return neighborsGrid(idx, n);
    case "fat":
      return neighborsTall(idx, n, false);
    case "tall":
    default:
      return neighborsTall(idx, n, true);
  }
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
