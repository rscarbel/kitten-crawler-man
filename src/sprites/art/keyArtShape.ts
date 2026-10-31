/**
 * The shape of the keys a party collects floor by floor, and where it breaks.
 *
 * The key lies on its side, bow to the left and bit to the right, inside a box
 * `KEY_ART_ASPECT` as tall as it is wide. Everything here is in key units: 1
 * is the box's width, the origin is its centre, +Y is down.
 *
 * A fragment is the whole key clipped to one band between two jagged cuts, so
 * the pieces of any count drawn together are the whole key again. The cuts sit
 * at quantiles of a weight that mixes the key's length with how much metal
 * each column holds, so the heavy bow does not end up as a sliver and the bare
 * shank does not end up as a whole piece by itself.
 */

import { appendPoints, FULL_TURN, type IconPoint, tracePolyline } from './itemIcons/iconPaint';

type Ctx = CanvasRenderingContext2D;

/** The whole key's box: its height as a share of its width. */
export const KEY_ART_ASPECT = 0.46;
export const KEY_HALF_HEIGHT = KEY_ART_ASPECT / 2;

export const BOW = { x: -0.29, radius: 0.135 } as const;
/** Scallops round the bow's rim. */
export const BOW_LOBES = { count: 12, reach: 0.155, radius: 0.034 } as const;
const BOW_OUTER_REACH = BOW_LOBES.reach + BOW_LOBES.radius;
/** Cut-outs through the bow, set between the scallops so none of them reaches a lobe. */
const BOW_HOLES = { count: 4, reach: 0.08, radius: 0.022, turn: Math.PI / 8 } as const;
const BOW_ENGRAVED_RING = 0.112;
export const GEM = { radius: 0.042, bezel: 0.054 } as const;

export const SHANK = { left: -0.17, right: 0.43, half: 0.03 } as const;
export interface Collar {
  readonly left: number;
  readonly right: number;
  readonly half: number;
}
export const COLLARS: readonly Collar[] = [
  { left: -0.175, right: -0.125, half: 0.058 },
  { left: -0.105, right: -0.085, half: 0.044 },
  { left: 0.115, right: 0.15, half: 0.046 },
];
export const COLLAR_CORNER = 0.01;
export const TIP = { x: 0.44, radius: 0.034 } as const;
const KEY_RIGHT = TIP.x + TIP.radius;
const KEY_LEFT = BOW.x - BOW_OUTER_REACH;

/** The bit hangs below the shank near its end; its teeth are notches cut up from its foot. */
export const BIT = { left: 0.24, right: 0.42, top: 0, bottom: 0.19 } as const;
const BIT_TEETH: ReadonlyArray<{
  readonly left: number;
  readonly right: number;
  readonly top: number;
}> = [
  { left: 0.29, right: 0.32, top: 0.12 },
  { left: 0.355, right: 0.385, top: 0.14 },
];
/** A ward notch cut into the bit's outer edge. */
const BIT_WARD = { top: 0.06, bottom: 0.09, depth: 0.03 } as const;

function traceBow(ctx: Ctx): void {
  ctx.moveTo(BOW.x + BOW.radius, 0);
  ctx.arc(BOW.x, 0, BOW.radius, 0, FULL_TURN);
  for (let i = 0; i < BOW_LOBES.count; i++) {
    const angle = (i * FULL_TURN) / BOW_LOBES.count;
    const lx = BOW.x + Math.cos(angle) * BOW_LOBES.reach;
    const ly = Math.sin(angle) * BOW_LOBES.reach;
    ctx.moveTo(lx + BOW_LOBES.radius, ly);
    ctx.arc(lx, ly, BOW_LOBES.radius, 0, FULL_TURN);
  }
}

/** The centre of each of the bow's scallops, in key units. */
export function bowLobeCentres(): ReadonlyArray<readonly [number, number]> {
  return Array.from({ length: BOW_LOBES.count }, (_, i) => {
    const angle = (i * FULL_TURN) / BOW_LOBES.count;
    return [BOW.x + Math.cos(angle) * BOW_LOBES.reach, Math.sin(angle) * BOW_LOBES.reach] as const;
  });
}

/** Wound against the bow, so a nonzero fill leaves them open. */
function traceBowHoles(ctx: Ctx): void {
  for (let i = 0; i < BOW_HOLES.count; i++) {
    const angle = BOW_HOLES.turn + (i * FULL_TURN) / BOW_HOLES.count;
    const hx = BOW.x + Math.cos(angle) * BOW_HOLES.reach;
    const hy = Math.sin(angle) * BOW_HOLES.reach;
    ctx.moveTo(hx + BOW_HOLES.radius, hy);
    ctx.arc(hx, hy, BOW_HOLES.radius, 0, FULL_TURN, true);
  }
}

const BIT_OUTLINE: readonly IconPoint[] = [
  [BIT.left, BIT.top],
  [BIT.right, BIT.top],
  [BIT.right, BIT_WARD.top],
  [BIT.right - BIT_WARD.depth, BIT_WARD.top],
  [BIT.right - BIT_WARD.depth, BIT_WARD.bottom],
  [BIT.right, BIT_WARD.bottom],
  [BIT.right, BIT.bottom],
  ...[...BIT_TEETH].reverse().flatMap((tooth): IconPoint[] => [
    [tooth.right, BIT.bottom],
    [tooth.right, tooth.top],
    [tooth.left, tooth.top],
    [tooth.left, BIT.bottom],
  ]),
  [BIT.left, BIT.bottom],
];

function traceShankAndBit(ctx: Ctx): void {
  ctx.rect(SHANK.left, -SHANK.half, SHANK.right - SHANK.left, SHANK.half * 2);
  for (const collar of COLLARS) {
    ctx.roundRect(
      collar.left,
      -collar.half,
      collar.right - collar.left,
      collar.half * 2,
      COLLAR_CORNER,
    );
  }
  appendPoints(ctx, BIT_OUTLINE);
  ctx.moveTo(TIP.x + TIP.radius, 0);
  ctx.arc(TIP.x, 0, TIP.radius, 0, FULL_TURN);
}

/** The whole key's silhouette as a fresh path, holes open under a nonzero fill. */
export function traceKey(ctx: Ctx): void {
  ctx.beginPath();
  traceBow(ctx);
  traceShankAndBit(ctx);
  traceBowHoles(ctx);
}

/** The scrollwork engraved round the bow's ring: one short arc between each pair of scallops. */
const SCROLL_REACH = 0.124;
const SCROLL_SPAN = 0.32;
/** A border engraved round the bit's plate, this far in from its edges. */
const BIT_BORDER_INSET = 0.022;
/** The bit's border stops short of the first tooth's notch. */
const BIT_BORDER_FOOT = 0.1;

/**
 * Strokes every engraved line of the key with the context's current stroke
 * style and width: the ring and scrollwork round the bow, the collars' rings
 * and a border round the bit.
 */
export function strokeEngraving(ctx: Ctx): void {
  ctx.beginPath();
  ctx.arc(BOW.x, 0, BOW_ENGRAVED_RING, 0, FULL_TURN);
  ctx.stroke();
  for (let i = 0; i < BOW_LOBES.count; i++) {
    const angle = ((i + 1 / 2) * FULL_TURN) / BOW_LOBES.count;
    ctx.beginPath();
    ctx.arc(BOW.x, 0, SCROLL_REACH, angle - SCROLL_SPAN / 2, angle + SCROLL_SPAN / 2);
    ctx.stroke();
  }
  for (const collar of COLLARS) {
    tracePolyline(ctx, [
      [collar.left + COLLAR_CORNER, -collar.half],
      [collar.left + COLLAR_CORNER, collar.half],
    ]);
    ctx.stroke();
  }
  tracePolyline(ctx, [
    [BIT.left + BIT_BORDER_INSET, SHANK.half + BIT_BORDER_INSET / 2],
    [BIT.left + BIT_BORDER_INSET, BIT_BORDER_FOOT],
    [BIT.right - BIT_WARD.depth - BIT_BORDER_INSET, BIT_BORDER_FOOT],
    [BIT.right - BIT_WARD.depth - BIT_BORDER_INSET, SHANK.half + BIT_BORDER_INSET / 2],
  ]);
  ctx.stroke();
}

// ── Where the cuts fall ──────────────────────────────────────────────────────

/** How finely the key's length is sampled to place the cuts. */
const PROFILE_COLUMNS = 240;
/** How much of a cut's weight is plain length rather than metal, so no piece is a sliver of shank. */
const LENGTH_WEIGHT_SHARE = 0.45;
/** How far a cut's zigzag strays either side of its line, at most. */
export const CUT_JAG = 0.024;
/** The zigzag's points down the cut, top to bottom. */
const CUT_STEPS = 9;
/** Each leg of the zigzag is broken into this many shorter, finer splinters. */
const SPLINTERS_PER_STEP = 3;
/** How far a splinter strays from its leg, as a share of {@link CUT_JAG}. */
const SPLINTER_SHARE = 0.32;
/** A cut runs a little past the key's top and bottom, so its ends never clip metal. */
const CUT_OVERRUN = 0.06;
/** Outer pieces end this far past the key, so their outer outline is never clipped. */
const OUTER_EDGE = 0.6;
/** Each zigzag step strays between this share of {@link CUT_JAG} and all of it. */
const MIN_JAG_SHARE = 0.45;
/** Two large primes, so neighbouring cuts' zigzags land far apart. */
const HASH_A = 2654435761;
const HASH_B = 40503;
const HASH_SPAN = 4294967296;
/** Keeps a splinter's hash stream apart from the zigzag's. */
const SPLINTER_STREAM = 7919;

export function hash01(a: number, b: number): number {
  const mixed = Math.imul(a * HASH_B + b * HASH_A + 1, HASH_A) >>> 0;
  return mixed / HASH_SPAN;
}

export function itemAt<T>(items: readonly T[], index: number): T | undefined {
  const inRange = Number.isInteger(index) && index >= 0 && index < items.length;
  return inRange ? items[index] : undefined;
}

interface Column {
  readonly x: number;
  readonly top: number;
  readonly bottom: number;
}

function columnAt(x: number): Column | null {
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  const include = (from: number, to: number): void => {
    top = Math.min(top, from);
    bottom = Math.max(bottom, to);
  };
  const fromBow = Math.abs(x - BOW.x);
  if (fromBow <= BOW_OUTER_REACH) {
    const half = Math.sqrt(BOW_OUTER_REACH ** 2 - fromBow ** 2);
    include(-half, half);
  }
  if (x >= SHANK.left && x <= SHANK.right) include(-SHANK.half, SHANK.half);
  for (const collar of COLLARS) {
    if (x >= collar.left && x <= collar.right) include(-collar.half, collar.half);
  }
  if (x >= BIT.left && x <= BIT.right) include(-SHANK.half, BIT.bottom);
  const fromTip = Math.abs(x - TIP.x);
  if (fromTip <= TIP.radius) {
    const half = Math.sqrt(TIP.radius ** 2 - fromTip ** 2);
    include(-half, half);
  }
  return bottom > top ? { x, top, bottom } : null;
}

const PROFILE: readonly Column[] = Array.from({ length: PROFILE_COLUMNS }, (_, i) => {
  const x = KEY_LEFT + ((i + 1 / 2) / PROFILE_COLUMNS) * (KEY_RIGHT - KEY_LEFT);
  return columnAt(x);
}).filter((column): column is Column => column !== null);

const MEAN_METAL =
  PROFILE.reduce((sum, column) => sum + (column.bottom - column.top), 0) /
  Math.max(1, PROFILE.length);

/** Where each of a count's interior cuts crosses the key's centre line. */
function cutPositions(count: number): readonly number[] {
  const weights = PROFILE.map(
    (column) =>
      LENGTH_WEIGHT_SHARE + (1 - LENGTH_WEIGHT_SHARE) * ((column.bottom - column.top) / MEAN_METAL),
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const cuts: number[] = [];
  let running = 0;
  let next = 1;
  PROFILE.forEach((column, i) => {
    running += weights[i];
    while (next < count && running >= (total * next) / count) {
      cuts.push(clearOfEdges(column.x));
      next++;
    }
  });
  return cuts;
}

/**
 * The key's upright edges. A cut whose zigzag straddles one leaves a sliver of
 * metal hanging off the neighbouring piece, so a cut that falls near one is
 * moved clear of it.
 */
const UPRIGHT_EDGES: readonly number[] = [
  SHANK.left,
  BIT.left,
  BIT.right,
  ...COLLARS.flatMap((collar) => [collar.left, collar.right]),
];
/** A cut keeps this much more than its zigzag's reach away from an upright edge. */
const EDGE_CLEARANCE = CUT_JAG * 1.5;

function isClearOfEdges(x: number): boolean {
  return UPRIGHT_EDGES.every((edge) => Math.abs(x - edge) >= EDGE_CLEARANCE);
}

function clearOfEdges(x: number): number {
  const candidates = [
    x,
    ...UPRIGHT_EDGES.flatMap((edge) => [edge - EDGE_CLEARANCE, edge + EDGE_CLEARANCE]),
  ].filter(isClearOfEdges);
  return candidates.reduce(
    (best, candidate) => (Math.abs(candidate - x) < Math.abs(best - x) ? candidate : best),
    candidates[0] ?? x,
  );
}

export interface Piece {
  /** The band's outline: the left cut top to bottom, then the right cut bottom to top. */
  readonly outline: readonly IconPoint[];
  /** The jagged cuts that bound it. */
  readonly cuts: ReadonlyArray<readonly IconPoint[]>;
  readonly centre: { readonly x: number; readonly y: number };
  /** The metal's width and height inside the band, before the zigzag. */
  readonly extent: { readonly w: number; readonly h: number };
  /** The band's reach along the key, zigzag included, clamped to the key. */
  readonly span: { readonly left: number; readonly right: number };
}

/**
 * A cut's zigzag, each leg broken into finer splinters so the break reads as
 * torn metal rather than a drawn line. Both pieces either side share the
 * same points, so they still meet exactly.
 */
function cutLine(x: number, cutIndex: number, count: number): readonly IconPoint[] {
  const top = -KEY_HALF_HEIGHT - CUT_OVERRUN;
  const span = (KEY_HALF_HEIGHT + CUT_OVERRUN) * 2;
  const corners = Array.from({ length: CUT_STEPS + 1 }, (_, step): IconPoint => {
    const ends = step === 0 || step === CUT_STEPS;
    const side = step % 2 === 0 ? -1 : 1;
    const reach = MIN_JAG_SHARE + (1 - MIN_JAG_SHARE) * hash01(count * CUT_STEPS + step, cutIndex);
    const stray = ends ? 0 : side * CUT_JAG * reach;
    return [x + stray, top + (step / CUT_STEPS) * span];
  });
  const points: IconPoint[] = [];
  corners.forEach((corner, step) => {
    points.push(corner);
    const next = itemAt(corners, step + 1);
    if (next === undefined) return;
    for (let splinter = 1; splinter < SPLINTERS_PER_STEP; splinter++) {
      const t = splinter / SPLINTERS_PER_STEP;
      const seed = (count * CUT_STEPS + step) * SPLINTERS_PER_STEP + splinter;
      const stray = (hash01(seed, cutIndex + SPLINTER_STREAM) * 2 - 1) * CUT_JAG * SPLINTER_SHARE;
      points.push([
        corner[0] + (next[0] - corner[0]) * t + stray,
        corner[1] + (next[1] - corner[1]) * t,
      ]);
    }
  });
  return points;
}

function straightEdge(x: number): readonly IconPoint[] {
  const reach = KEY_HALF_HEIGHT + CUT_OVERRUN;
  return [
    [x, -reach],
    [x, reach],
  ];
}

function buildPieces(count: number): readonly Piece[] {
  const cuts = cutPositions(count);
  const lines = cuts.map((x, i) => cutLine(x, i, count));
  return Array.from({ length: count }, (_, index): Piece => {
    const leftCut = itemAt(lines, index - 1);
    const rightCut = itemAt(lines, index);
    const left = leftCut ?? straightEdge(-OUTER_EDGE);
    const right = rightCut ?? straightEdge(OUTER_EDGE);
    const fromX = itemAt(cuts, index - 1) ?? KEY_LEFT;
    const toX = itemAt(cuts, index) ?? KEY_RIGHT;
    const inside = PROFILE.filter((column) => column.x >= fromX && column.x <= toX);
    const metal = inside.reduce((sum, column) => sum + (column.bottom - column.top), 0);
    const middleY =
      metal > 0
        ? inside.reduce(
            (sum, column) =>
              sum + ((column.top + column.bottom) / 2) * (column.bottom - column.top),
            0,
          ) / metal
        : 0;
    return {
      outline: [...left, ...[...right].reverse()],
      cuts: [leftCut, rightCut].filter((line): line is readonly IconPoint[] => line !== undefined),
      centre: { x: (fromX + toX) / 2, y: middleY },
      extent: {
        w: toX - fromX,
        h:
          Math.max(...inside.map((column) => column.bottom)) -
          Math.min(...inside.map((column) => column.top)),
      },
      span: {
        left: Math.max(KEY_LEFT, Math.min(...left.map((point) => point[0]))),
        right: Math.min(KEY_RIGHT, Math.max(...right.map((point) => point[0]))),
      },
    };
  });
}

const PIECES_BY_COUNT = new Map<number, readonly Piece[]>();

/** The pieces the key breaks into for a key of `count` fragments, built once per count. */
export function piecesFor(count: number): readonly Piece[] {
  const whole = Math.max(1, Math.floor(count));
  const known = PIECES_BY_COUNT.get(whole);
  if (known) return known;
  const built = buildPieces(whole);
  PIECES_BY_COUNT.set(whole, built);
  return built;
}

/** The piece's band as a fresh path. */
export function tracePiece(ctx: Ctx, piece: Piece): void {
  ctx.beginPath();
  appendPoints(ctx, piece.outline);
}

/** The interior cuts of a key of `count` fragments, each once. */
export function interiorCuts(count: number): ReadonlyArray<readonly IconPoint[]> {
  return piecesFor(count).flatMap((piece, index) => (index === 0 ? [] : piece.cuts.slice(0, 1)));
}
