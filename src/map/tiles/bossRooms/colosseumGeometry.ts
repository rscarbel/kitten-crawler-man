/**
 * The Iron Colosseum's painted shape, shared by its tile painters and its live
 * dressing so the two can never place the same thing in two places.
 *
 * Everything here is measured from the centre of the arena's centre tile, in
 * tiles, with y growing south. A tile's own centre therefore sits at a whole
 * offset from it, and every tile of the carved disc is at a squared distance
 * that is a whole number — which is what fixes the painted radii below.
 */

import {
  ARENA_ANTECHAMBER_MIN_DEPTH,
  ARENA_ANTECHAMBER_MIN_WIDTH,
  ARENA_CONCOURSE_LINK_INNER_DX,
  ARENA_CONCOURSE_LINK_OUTER_DX,
  ARENA_CONCOURSE_REACH,
  ARENA_DOOR_COLUMN_OFFSETS,
  ARENA_INTERIOR_RADIUS_TILES,
  ARENA_RADIUS,
  ARENA_WALL_THICKNESS,
} from '../../arenaGeometry';
import { hashLattice } from '../../tilegen/noise';
import { ARENA_CAGE, ARENA_FLOOR, ARENA_MUD, type TileContent } from '../../tileTypes';

const HALF_TILE = 0.5;

/**
 * Half the gap between two neighbouring whole squared distances.
 *
 * The generator keeps a tile as floor when its centre's squared distance is at
 * most R² and makes it wall from R² + 1. A painted edge at √(R² + ½) is the one
 * circle every floor centre is inside and every wall centre is outside, so the
 * picture of the ring agrees with the tiles at every tile's centre.
 */
const HALF_SQUARED_STEP = 0.5;

/** Where the sand meets the iron: the inside of the wall, as drawn. */
export const COLOSSEUM_SAND_RADIUS_TILES = Math.sqrt(
  ARENA_INTERIOR_RADIUS_TILES ** 2 + HALF_SQUARED_STEP,
);
/** Where the iron meets the concourse: the outside of the wall, as drawn. */
export const COLOSSEUM_OUTER_RADIUS_TILES = Math.sqrt(ARENA_RADIUS ** 2 + HALF_SQUARED_STEP);

/** How far past the outer radius the iron's shadow on the concourse still reaches. */
export const COLOSSEUM_OUTER_SHADOW_DEPTH_TILES = 0.55;

/**
 * How far from the arena centre the rim's iron and shadow may still be painted.
 *
 * Shared with the walkability pass: a concourse tile whose nearest corner falls
 * inside this reach gets iron or shadow painted over some of it, so it is blocked
 * for movement the same way the wall itself is — see `colosseumNearRadius`.
 */
export const COLOSSEUM_RIM_PAINT_REACH_TILES =
  COLOSSEUM_OUTER_RADIUS_TILES + COLOSSEUM_OUTER_SHADOW_DEPTH_TILES;

/**
 * The closest the square tile at `(dx, dy)` tile-offsets from the arena centre
 * ever comes to that centre — distance from a point to an axis-aligned box,
 * with the box being the tile's own 1×1 footprint. This is what a tile painter
 * asks to decide whether a continuous circle reaches into a square cell at all.
 */
export function colosseumNearRadius(dx: number, dy: number): number {
  const clampedX = Math.max(dx - HALF_TILE, Math.min(dx + HALF_TILE, 0));
  const clampedY = Math.max(dy - HALF_TILE, Math.min(dy + HALF_TILE, 0));
  return Math.hypot(clampedX, clampedY);
}

/**
 * Whether `(dx, dy)` sits in the doorway's mouth — the swath south of the door
 * that `clipAwayDoorway` (the tile painter) cuts the iron and its shadow away
 * from entirely, all the way out past the rim's reach, so the entrance stays
 * clear ground however wide the rim's paint runs elsewhere.
 */
function colosseumInDoorSwath(dx: number, dy: number): boolean {
  const door = COLOSSEUM_DOOR_OPENING;
  return dx >= door.left && dx <= door.right && dy >= door.top;
}

/**
 * Whether `(dx, dy)` is one of the two flank links `linkConcourseToAntechamber`
 * (`DungeonGenerator.ts`) punches through the door row's seal to join the
 * concourse ring to the antechamber.
 *
 * Each is a single tile wide with no parallel lane beside it — unlike the ring
 * itself, which is two tiles wide everywhere else — so it is the *only* way
 * through the wall at its bearing. The seal (and the link back through it) only
 * exists at exactly the door's own row, `ARENA_RADIUS` tiles out, which is why
 * this checks that row precisely rather than a wider swath.
 */
function colosseumOnConcourseLink(dx: number, dy: number): boolean {
  if (dy !== ARENA_RADIUS) return false;
  const abs = Math.abs(dx);
  return abs === ARENA_CONCOURSE_LINK_INNER_DX || abs === ARENA_CONCOURSE_LINK_OUTER_DX;
}

// ── Which concourse tiles the ring genuinely needs, near the door ──────────

/**
 * Half the guaranteed-minimum antechamber width, rounded down the same way
 * `DungeonGenerator.ts` rounds it when it plants the antechamber's northern
 * edge under the door column — so the synthetic apron below lines up with
 * where a real antechamber's edge always is, regardless of how much wider a
 * given map's antechamber ends up.
 */
const ANTECHAMBER_HALF_WIDTH_FLOOR = Math.floor(ARENA_ANTECHAMBER_MIN_WIDTH / 2);

/**
 * A synthetic, seed-independent model of what's guaranteed open near an
 * arena's door: the concourse ring, sealed at the door row but for the door's
 * own columns and the two flank links, sitting over a rectangle of antechamber
 * floor no map ever makes narrower or shallower than `ARENA_ANTECHAMBER_MIN_WIDTH`/
 * `_DEPTH`. Every real antechamber is this shape or bigger, so a route this
 * model finds is a route every real map has too.
 *
 * Deliberately ignorant of anything past the door — the beyond pocket's north
 * gate, other rooms — because those never come within the rim's paint reach
 * and can't affect which near-wall tiles need to stay open.
 */
function isRingFloorTemplateTile(dx: number, dy: number): boolean {
  // The door mouth is carved open across both of the wall's rows regardless of
  // the disc radius test below — the generator overwrites the wall there
  // unconditionally.
  if ((dy === ARENA_RADIUS || dy === ARENA_RADIUS - 1) && ARENA_DOOR_COLUMN_OFFSETS.includes(dx)) {
    return true;
  }
  const rad = Math.hypot(dx, dy);
  if (rad > ARENA_RADIUS && rad <= ARENA_CONCOURSE_REACH) {
    if (dy === ARENA_RADIUS) return colosseumOnConcourseLink(dx, dy);
    return true;
  }
  return (
    dy > ARENA_RADIUS &&
    dy <= ARENA_RADIUS + ARENA_ANTECHAMBER_MIN_DEPTH &&
    dx >= -ANTECHAMBER_HALF_WIDTH_FLOOR &&
    dx < ARENA_ANTECHAMBER_MIN_WIDTH - ANTECHAMBER_HALF_WIDTH_FLOOR
  );
}

/** Whether `(dx, dy)` is open ground the rim's paint reaches, and so a tile worth blocking at all. */
function isRingFloorTemplateCandidate(dx: number, dy: number): boolean {
  if (!isRingFloorTemplateTile(dx, dy)) return false;
  if (Math.hypot(dx, dy) <= ARENA_RADIUS) return false;
  if (colosseumInDoorSwath(dx, dy) || colosseumOnConcourseLink(dx, dy)) return false;
  return colosseumNearRadius(dx, dy) <= COLOSSEUM_RIM_PAINT_REACH_TILES;
}

/** Local packing for the small graph the 0-1 BFS below walks; well clear of its real range. */
const OFFSET_BIAS = 64;
const OFFSET_STRIDE = 128;
const packOffset = (dx: number, dy: number): number =>
  (dy + OFFSET_BIAS) * OFFSET_STRIDE + (dx + OFFSET_BIAS);
const unpackOffsetDx = (key: number): number => (key % OFFSET_STRIDE) - OFFSET_BIAS;
const unpackOffsetDy = (key: number): number => Math.floor(key / OFFSET_STRIDE) - OFFSET_BIAS;

const OFFSET_NEIGHBOUR_STEPS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Every rim-covered tile that a shortest, minimum-candidate-cost route from
 * the door to some tile the ring can't do without needs kept open.
 *
 * A 0-1 BFS over {@link isRingFloorTemplateTile}: crossing a tile the rim would
 * otherwise be free to paint over costs 1, crossing anything else costs 0. For
 * every open tile that isn't itself up for blocking, its cheapest path back to
 * the door is retraced and every rim-covered tile on that path is kept open —
 * the smallest set of exceptions that still lets every tile the ring is
 * carved with stay reachable, rather than reinstating a whole arbitrary
 * detour's worth the way a plain first-found-path walk would.
 */
function computeForcedWalkableOffsets(): ReadonlySet<number> {
  const dist = new Map<number, number>();
  const parent = new Map<number, number>();
  const deque: number[] = [];
  const rootKey = packOffset(0, ARENA_RADIUS);
  dist.set(rootKey, 0);
  deque.push(rootKey);

  while (deque.length > 0) {
    const key = deque.shift();
    if (key === undefined) continue;
    const d = dist.get(key);
    if (d === undefined) continue;
    const dx = unpackOffsetDx(key);
    const dy = unpackOffsetDy(key);
    for (const [stepX, stepY] of OFFSET_NEIGHBOUR_STEPS) {
      const nx = dx + stepX;
      const ny = dy + stepY;
      if (!isRingFloorTemplateTile(nx, ny)) continue;
      const edgeCost = isRingFloorTemplateCandidate(nx, ny) ? 1 : 0;
      const nextDist = d + edgeCost;
      const nKey = packOffset(nx, ny);
      const existing = dist.get(nKey);
      if (existing !== undefined && existing <= nextDist) continue;
      dist.set(nKey, nextDist);
      parent.set(nKey, key);
      if (edgeCost === 0) deque.unshift(nKey);
      else deque.push(nKey);
    }
  }

  const forced = new Set<number>();
  for (const key of dist.keys()) {
    if (isRingFloorTemplateCandidate(unpackOffsetDx(key), unpackOffsetDy(key))) continue;
    let cur: number | undefined = key;
    while (cur !== undefined) {
      if (isRingFloorTemplateCandidate(unpackOffsetDx(cur), unpackOffsetDy(cur))) forced.add(cur);
      cur = parent.get(cur);
    }
  }
  return forced;
}

/**
 * Computed once, lazily: a pure function of fixed geometry, so it never varies
 * by seed and both {@link colosseumRimCoversTile} (walkability) and the rim's
 * own painter can call it and always agree exactly on which tiles are
 * exceptions. Lazy because it reads {@link COLOSSEUM_DOOR_OPENING}, declared
 * later in this module — computing it eagerly here would run into that
 * binding before its own line has executed.
 */
let forcedWalkableOffsetsCache: ReadonlySet<number> | null = null;
function forcedWalkableOffsets(): ReadonlySet<number> {
  forcedWalkableOffsetsCache ??= computeForcedWalkableOffsets();
  return forcedWalkableOffsetsCache;
}

/**
 * Whether `(dx, dy)` is a rim-covered tile the concourse ring genuinely needs
 * kept open — the minimum reinstatement {@link computeForcedWalkableOffsets}
 * found, near the two flank links.
 */
export function colosseumRimForcedWalkable(dx: number, dy: number): boolean {
  return forcedWalkableOffsets().has(packOffset(dx, dy));
}

/**
 * Whether the tile at `(dx, dy)` tile-offsets from the arena centre is one the
 * rim's iron or shadow paints over, even partially.
 *
 * Never true for a tile the generator carves as the *only* passage through a
 * sealed stretch of wall — the door's own mouth, a flank link, or one of the
 * tiles a link needs to reach the ring's own two-tile band — because
 * walkability built from this must not block the one way through even where
 * the paint's continuous circle happens to reach that far. The painter honours
 * the same exception (see `colosseumRimCoversTile` callers in
 * `colosseumTiles.ts`), so a tile kept walkable here is never drawn as iron.
 */
export function colosseumRimCoversTile(dx: number, dy: number): boolean {
  if (colosseumInDoorSwath(dx, dy) || colosseumOnConcourseLink(dx, dy)) return false;
  if (colosseumRimForcedWalkable(dx, dy)) return false;
  return colosseumNearRadius(dx, dy) <= COLOSSEUM_RIM_PAINT_REACH_TILES;
}

/**
 * Depth of the wall's inner face where it faces the viewer head-on (due north),
 * and the lip it keeps where it faces away. The drum is seen from the south and
 * above: its far wall shows its whole face, its near wall only the top edge, and
 * the depth between is what makes a flat ring read as a pit.
 */
export const COLOSSEUM_INNER_FACE_MAX_TILES = 1.05;
export const COLOSSEUM_INNER_FACE_LIP_TILES = 0.1;
/** The same for the outer face, which shows on the near (south) side. */
export const COLOSSEUM_OUTER_FACE_MAX_TILES = 0.55;
export const COLOSSEUM_OUTER_FACE_LIP_TILES = 0.06;

/**
 * How tall the inner face is at a bearing, in tiles. `angle` is measured from
 * the arena centre with y growing south, so north is −π/2.
 */
export function colosseumInnerFaceDepth(angle: number): number {
  const facingViewer = Math.max(0, -Math.sin(angle));
  return (
    COLOSSEUM_INNER_FACE_LIP_TILES +
    (COLOSSEUM_INNER_FACE_MAX_TILES - COLOSSEUM_INNER_FACE_LIP_TILES) * facingViewer
  );
}

/** How tall the outer face is at a bearing, in tiles. */
export function colosseumOuterFaceDepth(angle: number): number {
  const facingViewer = Math.max(0, Math.sin(angle));
  return (
    COLOSSEUM_OUTER_FACE_LIP_TILES +
    (COLOSSEUM_OUTER_FACE_MAX_TILES - COLOSSEUM_OUTER_FACE_LIP_TILES) * facingViewer
  );
}

/** The radius at which the wall's top begins, past the inner face. */
export function colosseumCapInnerRadius(angle: number): number {
  return COLOSSEUM_SAND_RADIUS_TILES + colosseumInnerFaceDepth(angle);
}

/** The radius at which the wall's top ends, before the outer face drops away. */
export function colosseumCapOuterRadius(angle: number): number {
  return COLOSSEUM_OUTER_RADIUS_TILES - colosseumOuterFaceDepth(angle);
}

/**
 * How far inside the floor radius a body's centre is held, in tiles.
 *
 * Wide enough that a body pressed against the curve never reaches the rim's
 * stair-stepped tiles: the innermost corner any wall tile pokes toward the
 * middle is about 12.35 tiles out, and a crawler's southward collision probe
 * reaches almost half a tile past its centre. Held inside this, a crawler meets
 * only the curve the art draws, and slides round it instead of snagging.
 */
export const COLOSSEUM_BODY_MARGIN_TILES = 1.125;
/** The circle a body's centre is held inside, in tiles from the drum's centre. */
export const COLOSSEUM_BODY_LIMIT_TILES = ARENA_INTERIOR_RADIUS_TILES - COLOSSEUM_BODY_MARGIN_TILES;
/** Half the width of a body's collision box: its side probes sit this far from its centre. */
export const COLOSSEUM_BODY_HALF_WIDTH_TILES = 0.28;
/**
 * Where the iron begins: the sloped footing at the foot of the wall starts
 * exactly where a body held on its circle stops, so the crawler's shoulder
 * meets the iron rather than a strip of sand it can never reach.
 */
export const COLOSSEUM_FOOTING_RADIUS_TILES =
  COLOSSEUM_BODY_LIMIT_TILES + COLOSSEUM_BODY_HALF_WIDTH_TILES;
// ── The door ────────────────────────────────────────────────────────────────

/**
 * The door's opening in arena-local tiles.
 *
 * The door's columns are cut from the wall's outer rows only. On the row inside
 * those, just the centre column is floor — the disc's own edge — so the gap
 * reaches further in there, as a mouth one tile wide.
 */
export const COLOSSEUM_DOOR_OPENING = {
  left: Math.min(...ARENA_DOOR_COLUMN_OFFSETS) - HALF_TILE,
  right: Math.max(...ARENA_DOOR_COLUMN_OFFSETS) + HALF_TILE,
  /** The inner edge of the cut rows. */
  top: ARENA_RADIUS - ARENA_WALL_THICKNESS + HALF_TILE,
  /** The outer edge of the cut rows: where the portcullis stands, facing the antechamber. */
  bottom: ARENA_RADIUS + HALF_TILE,
  mouthLeft: -HALF_TILE,
  mouthRight: HALF_TILE,
  /**
   * Where the one-tile mouth begins: at the iron's footing, so the way out is
   * one run of sand up to the passage rather than a ramp of plate across it.
   */
  mouthTop: COLOSSEUM_FOOTING_RADIUS_TILES,
} as const;

/** Whether an arena-local point lies in the door's opening, where no wall is drawn. */
export function inColosseumDoorway(x: number, y: number): boolean {
  if (y <= 0) return false;
  const door = COLOSSEUM_DOOR_OPENING;
  if (y >= door.top && x >= door.left && x <= door.right) return true;
  return y >= door.mouthTop && x >= door.mouthLeft && x <= door.mouthRight;
}

// ── Finding the arena from a tile ───────────────────────────────────────────

/** A cage set into the wall, where the generator put it. */
export interface ColosseumCageSeat {
  readonly tileX: number;
  readonly tileY: number;
  /** Arena-local bearing and radius of the cage tile's centre. */
  readonly angle: number;
  readonly radius: number;
}

/** A painted spectator on the wall's top. */
export interface ColosseumSpectatorSeat {
  /** Arena-local position of the spectator's feet, in tiles. */
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  /** Which of the crowd's palettes it wears. */
  readonly variant: number;
}

export interface ColosseumLayout {
  /** The arena's centre tile. */
  readonly centreTileX: number;
  readonly centreTileY: number;
  readonly cages: readonly ColosseumCageSeat[];
  readonly spectators: readonly ColosseumSpectatorSeat[];
}

/** A disc this small is not an arena: a stray floor tile, or a test grid. */
const MIN_ARENA_FLOOR_TILES = 100;
/** How far from the centre a tile may be and still belong to the arena's picture. */
const LAYOUT_REACH_TILES = ARENA_CONCOURSE_REACH + 1;

const layoutsByStructure = new WeakMap<TileContent[][], readonly ColosseumLayout[]>();

function isArenaGround(type: number): boolean {
  return type === ARENA_FLOOR || type === ARENA_MUD;
}

/**
 * Every arena on a map, found from its floor.
 *
 * Read off the grid rather than handed in, because a tile painter is given a
 * grid and a position and nothing else. Cached per grid, and safe to cache: the
 * only later edits to an arena's floor are its mud, which is arena ground too.
 */
export function colosseumLayouts(structure: TileContent[][]): readonly ColosseumLayout[] {
  const cached = layoutsByStructure.get(structure);
  if (cached !== undefined) return cached;
  const layouts: ColosseumLayout[] = [];
  const seen = new Set<number>();
  const width = structure[0]?.length ?? 0;
  for (let y = 0; y < structure.length; y++) {
    for (let x = 0; x < width; x++) {
      const key = y * width + x;
      if (seen.has(key) || !isArenaGround(structure[y][x].type)) continue;
      const bounds = floodArenaGround(structure, x, y, seen);
      if (bounds.count < MIN_ARENA_FLOOR_TILES) continue;
      const centreTileX = Math.round((bounds.minX + bounds.maxX) / 2);
      const centreTileY = Math.round((bounds.minY + bounds.maxY) / 2);
      const cages = findCages(structure, centreTileX, centreTileY);
      layouts.push({
        centreTileX,
        centreTileY,
        cages,
        spectators: spectatorSeats(cages),
      });
    }
  }
  layoutsByStructure.set(structure, layouts);
  return layouts;
}

/** The arena whose picture a tile is part of, or null. */
export function colosseumLayoutAt(
  structure: TileContent[][],
  tileX: number,
  tileY: number,
): ColosseumLayout | null {
  for (const layout of colosseumLayouts(structure)) {
    const dx = tileX - layout.centreTileX;
    const dy = tileY - layout.centreTileY;
    if (Math.hypot(dx, dy) <= LAYOUT_REACH_TILES) return layout;
  }
  return null;
}

interface FloodBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  count: number;
}

const NEIGHBOUR_STEPS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function floodArenaGround(
  structure: TileContent[][],
  startX: number,
  startY: number,
  seen: Set<number>,
): FloodBounds {
  const width = structure[0]?.length ?? 0;
  const bounds: FloodBounds = { minX: startX, minY: startY, maxX: startX, maxY: startY, count: 0 };
  const queue: Array<readonly [number, number]> = [[startX, startY]];
  seen.add(startY * width + startX);
  while (queue.length > 0) {
    const next = queue.pop();
    if (next === undefined) break;
    const [x, y] = next;
    bounds.count++;
    bounds.minX = Math.min(bounds.minX, x);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxY = Math.max(bounds.maxY, y);
    for (const [dx, dy] of NEIGHBOUR_STEPS) {
      const nx = x + dx;
      const ny = y + dy;
      if (ny < 0 || ny >= structure.length || nx < 0 || nx >= width) continue;
      const key = ny * width + nx;
      if (seen.has(key) || !isArenaGround(structure[ny][nx].type)) continue;
      seen.add(key);
      queue.push([nx, ny]);
    }
  }
  return bounds;
}

function findCages(
  structure: TileContent[][],
  centreTileX: number,
  centreTileY: number,
): ColosseumCageSeat[] {
  const cages: ColosseumCageSeat[] = [];
  for (let dy = -ARENA_RADIUS; dy <= ARENA_RADIUS; dy++) {
    const rowIndex = centreTileY + dy;
    if (rowIndex < 0 || rowIndex >= structure.length) continue;
    const row = structure[rowIndex];
    for (let dx = -ARENA_RADIUS; dx <= ARENA_RADIUS; dx++) {
      if (row[centreTileX + dx]?.type !== ARENA_CAGE) continue;
      cages.push({
        tileX: centreTileX + dx,
        tileY: centreTileY + dy,
        angle: Math.atan2(dy, dx),
        radius: Math.hypot(dx, dy),
      });
    }
  }
  // By bearing, so a cage's index is stable however the grid is scanned.
  cages.sort((a, b) => a.angle - b.angle);
  return cages;
}

// ── The crowd ───────────────────────────────────────────────────────────────

/** Arc length between neighbouring spectators, in tiles. */
const SPECTATOR_PITCH_TILES = 0.34;
/** Bearing kept clear either side of a cage, so the crowd never sits on its bars. */
const SPECTATOR_CAGE_CLEARANCE_RADIANS = 0.1;
/** Bearing kept clear either side of due south, where the door breaks the wall. */
const SPECTATOR_DOOR_CLEARANCE_RADIANS = 0.14;
/**
 * Where across the wall's top each row of spectators sits, from its inner edge
 * (0) to its outer (1). A top too narrow for two rows seats only the single one.
 */
const SPECTATOR_ROW_SHARES_WIDE: readonly number[] = [0.32, 0.8];
const SPECTATOR_ROW_SHARES_NARROW: readonly number[] = [0.55];
/** The narrowest top that seats two rows, in tiles. */
const SPECTATOR_TWO_ROW_MIN_WIDTH = 0.85;
/** How far a spectator may sit from its row's line, as a share of the pitch. */
const SPECTATOR_JITTER_SHARE = 0.35;
/** How far the back row sits along from the front, as a share of the pitch, so heads stagger. */
const SPECTATOR_BACK_ROW_STAGGER = 0.5;
export const COLOSSEUM_SPECTATOR_VARIANTS = 3;
const SPECTATOR_HASH_SEED = 7741;
const SPECTATOR_JITTER_SEED = 7759;
/** Share of seats left empty, so the crowd has gaps like a real one. */
const SPECTATOR_EMPTY_SHARE = 0.12;
const SPECTATOR_EMPTY_SEED = 7789;
const DUE_SOUTH = Math.PI / 2;

function angularGap(a: number, b: number): number {
  const TURN = Math.PI * 2;
  const raw = Math.abs(a - b) % TURN;
  return raw > Math.PI ? TURN - raw : raw;
}

function spectatorSeats(cages: readonly ColosseumCageSeat[]): ColosseumSpectatorSeat[] {
  const seats: ColosseumSpectatorSeat[] = [];
  const nominalRadius = (COLOSSEUM_SAND_RADIUS_TILES + COLOSSEUM_OUTER_RADIUS_TILES) / 2;
  const count = Math.floor((Math.PI * 2 * nominalRadius) / SPECTATOR_PITCH_TILES);
  const pitch = (Math.PI * 2) / count;
  for (let index = 0; index < count; index++) {
    const baseAngle = -Math.PI + (index + HALF_TILE) * pitch;
    const inner = colosseumCapInnerRadius(baseAngle);
    const outer = colosseumCapOuterRadius(baseAngle);
    const rows =
      outer - inner >= SPECTATOR_TWO_ROW_MIN_WIDTH
        ? SPECTATOR_ROW_SHARES_WIDE
        : SPECTATOR_ROW_SHARES_NARROW;
    rows.forEach((share, row) => {
      const seatKey = index * rows.length + row;
      if (hashLattice(seatKey, row, SPECTATOR_EMPTY_SEED) < SPECTATOR_EMPTY_SHARE) return;
      const stagger = row === 0 ? 0 : SPECTATOR_BACK_ROW_STAGGER;
      const jitter =
        (hashLattice(seatKey, row, SPECTATOR_JITTER_SEED) - HALF_TILE) * SPECTATOR_JITTER_SHARE;
      const angle = baseAngle + (stagger + jitter) * pitch;
      if (angularGap(angle, DUE_SOUTH) < SPECTATOR_DOOR_CLEARANCE_RADIANS) return;
      if (cages.some((cage) => angularGap(cage.angle, angle) < SPECTATOR_CAGE_CLEARANCE_RADIANS)) {
        return;
      }
      const seatInner = colosseumCapInnerRadius(angle);
      const seatOuter = colosseumCapOuterRadius(angle);
      const radius = seatInner + (seatOuter - seatInner) * share;
      seats.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        angle,
        variant: Math.floor(
          hashLattice(seatKey, row, SPECTATOR_HASH_SEED) * COLOSSEUM_SPECTATOR_VARIANTS,
        ),
      });
    });
  }
  return seats;
}
