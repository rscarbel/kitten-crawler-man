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
