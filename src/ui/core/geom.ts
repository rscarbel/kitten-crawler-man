/**
 * The one rectangle type the UI uses, and the layout helpers built on it.
 *
 * All values are UI units. Padding and spacing come from `theme.space` through
 * `inset` or a `gap` argument; layout code never adds raw numbers to `x`/`y`.
 */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Per-side padding; a missing side is zero. */
export type Insets = Partial<Record<'t' | 'r' | 'b' | 'l', number>>;

/**
 * Shrinks `r` by `pad` on every side (a number) or on the named sides.
 * Never returns a negative width or height.
 */
export function inset(r: Rect, pad: number | Insets): Rect {
  const sides = typeof pad === 'number' ? { t: pad, r: pad, b: pad, l: pad } : pad;
  const top = sides.t ?? 0;
  const right = sides.r ?? 0;
  const bottom = sides.b ?? 0;
  const left = sides.l ?? 0;
  return {
    x: r.x + left,
    y: r.y + top,
    w: Math.max(0, r.w - left - right),
    h: Math.max(0, r.h - top - bottom),
  };
}

/** Whether the point lies inside `r`. The right and bottom edges are exclusive. */
export function contains(r: Rect, px: number, py: number): boolean {
  return px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h;
}

/** The overlapping part of `a` and `b`, or `null` when they share no area. */
export function intersect(a: Rect, b: Rect): Rect | null {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** Whether `a` and `b` share any area. Touching edges do not overlap. */
export function overlaps(a: Rect, b: Rect): boolean {
  return intersect(a, b) !== null;
}

/** A track size: a fixed length in UI units, or `'fill'` to share what the fixed tracks leave. */
export type Track = number | 'fill';

function splitLengths(total: number, tracks: readonly Track[], gap: number): number[] {
  const gaps = gap * Math.max(0, tracks.length - 1);
  let fixed = 0;
  let fillCount = 0;
  for (const track of tracks) {
    if (track === 'fill') fillCount++;
    else fixed += track;
  }
  const fillLength = fillCount > 0 ? Math.max(0, total - gaps - fixed) / fillCount : 0;
  return tracks.map((track) => (track === 'fill' ? fillLength : track));
}

/**
 * Splits `r` into rows stacked top to bottom, one per track, separated by
 * `gap`. Every row spans the full width.
 */
export function splitV(r: Rect, tracks: readonly Track[], gap: number): Rect[] {
  const lengths = splitLengths(r.h, tracks, gap);
  const rows: Rect[] = [];
  let y = r.y;
  for (const h of lengths) {
    rows.push({ x: r.x, y, w: r.w, h });
    y += h + gap;
  }
  return rows;
}

/**
 * Splits `r` into columns laid left to right, one per track, separated by
 * `gap`. Every column spans the full height.
 */
export function splitH(r: Rect, tracks: readonly Track[], gap: number): Rect[] {
  const lengths = splitLengths(r.w, tracks, gap);
  const columns: Rect[] = [];
  let x = r.x;
  for (const w of lengths) {
    columns.push({ x, y: r.y, w, h: r.h });
    x += w + gap;
  }
  return columns;
}

export interface GridOptions {
  /** Narrowest a cell may be; the grid fits as many columns of at least this width as it can. */
  readonly minCell: number;
  readonly gap: number;
  /** Cell width ÷ height. Square when omitted. */
  readonly aspect?: number;
}

/**
 * `count` cells laid out row-major, as many columns of at least
 * `opts.minCell` as fit across `r` (always at least one). Cells stretch to use
 * the full width; rows continue past the bottom of `r` when there are more
 * cells than fit, so the caller can scroll them.
 */
export function grid(r: Rect, count: number, opts: GridOptions): Rect[] {
  const columns = Math.max(1, Math.floor((r.w + opts.gap) / (opts.minCell + opts.gap)));
  const cellW = (r.w - opts.gap * (columns - 1)) / columns;
  const cellH = cellW / (opts.aspect ?? 1);
  const cells: Rect[] = [];
  for (let index = 0; index < count; index++) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    cells.push({
      x: r.x + column * (cellW + opts.gap),
      y: r.y + row * (cellH + opts.gap),
      w: cellW,
      h: cellH,
    });
  }
  return cells;
}

/** A `w`×`h` rect centred in `outer`. It may overhang `outer` when larger. */
export function centerIn(outer: Rect, w: number, h: number): Rect {
  return { x: outer.x + (outer.w - w) / 2, y: outer.y + (outer.h - h) / 2, w, h };
}
