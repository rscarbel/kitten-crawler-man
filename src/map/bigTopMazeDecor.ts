/**
 * What the Big Top's shell is dressed in, tile by tile: which act's drapes a
 * wall hangs, and which baked floor marks lie on a stretch of sawdust.
 *
 * Pure data, no canvas. The painters in `src/sprites/art/bigTop/` read it
 * while the chunk bake draws each tile, and `verify:bigtop` reads the same
 * tables to prove every floor mark sits on walkable ground and that no act
 * leaves a bare 4×4 of sawdust.
 *
 * Held as module state for the same reason the interior wall finish is (see
 * `src/map/town/interiorWallMaterial.ts`): nothing between the chunk bake and
 * the tile painter carries which room is being drawn, and exactly one interior
 * is live at a time. `GameMap.generateInterior` sets it on every entry.
 *
 * Every floor mark is a *feature* in tile units rather than a picture per
 * tile, so a ring six tiles across or a floor cloth over a whole hall is one
 * shape: each tile it covers paints the whole shape clipped to itself, and the
 * pieces meet across tile and chunk borders by construction.
 */

import {
  BIG_TOP_MAZE_ROWS,
  MAZE_CAT_SPAWN_CHAR,
  MAZE_CORRIDORS,
  MAZE_CURTAINS,
  MAZE_FINAL_CHAMBER,
  MAZE_FLOOR_CHAR,
  MAZE_GRIMALDI_TILE,
  MAZE_HEIGHT,
  MAZE_HUMAN_SPAWN_CHAR,
  MAZE_POLE_CHAR,
  MAZE_PROJECTORS,
  MAZE_SECTIONS,
  MAZE_VENTS,
  MAZE_WIDTH,
  MENAGERIE_BLEACHER_ROW,
  MENAGERIE_CAGE_ROWS,
  MENAGERIE_LANES,
  MIRROR_HALL_GLASS_COLUMNS,
  MIRROR_HALL_ROWS,
  rectContains,
  sectionAtRow,
  traceMazeBeam,
  type MazeRect,
  type MazeSectionId,
  type MazeTile,
} from './bigTopMazeLayout';

// ── Which room is live ──────────────────────────────────────────────────────

/** A point in tile units: (2.5, 3) is the middle of the top edge of tile (2, 3). */
export interface TilePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * The two Big Top rooms: the three-act maze, and the plain ring the tent is
 * the rest of the time, whose curb and king pole `GameMap` lays out itself.
 */
export type BigTopDecorLayout =
  | { readonly kind: 'maze' }
  | {
      readonly kind: 'arena';
      readonly ringCentre: TilePoint;
      readonly ringRadius: number;
      /** The king pole's centre: the shared corner of its 2×2 tiles. */
      readonly poleCentre: TilePoint;
    };

let activeLayout: BigTopDecorLayout | null = null;
let mazeIndex: ReadonlyMap<string, ReadonlyArray<FloorFeature>> | null = null;

/** Which Big Top room the tile painters are drawing, or null anywhere else. */
export function setBigTopDecorLayout(layout: BigTopDecorLayout | null): void {
  activeLayout = layout;
}

// ── Drapes ──────────────────────────────────────────────────────────────────

/**
 * The stripe a stretch of sidewall is hung in. Each act of the show has its
 * own; the ring, and the interval rooms that open onto the next act, share
 * the house's own dark-red drapes.
 */
export type BigTopDrapeStyle = 'firewalk' | 'menagerie' | 'mirrors' | 'ring';

function inCurtainRooms(tileX: number, tileY: number): boolean {
  return MAZE_CURTAINS.some(
    (curtain) =>
      rectContains(curtain.humanRoom, tileX, tileY) || rectContains(curtain.catRoom, tileX, tileY),
  );
}

const DRAPE_BY_SECTION: Readonly<Record<MazeSectionId, BigTopDrapeStyle>> = {
  firewalk: 'firewalk',
  menagerie: 'menagerie',
  mirrors: 'mirrors',
  finale: 'ring',
};

/**
 * The drapes that face a floor tile: its act's, or the house's own in the
 * interval rooms.
 */
function drapeStyleFacing(tileX: number, tileY: number): BigTopDrapeStyle {
  if (activeLayout?.kind !== 'maze') return 'ring';
  if (tileY < 0 || tileY >= MAZE_HEIGHT) return 'ring';
  if (inCurtainRooms(tileX, tileY)) return 'ring';
  return DRAPE_BY_SECTION[sectionAtRow(tileY).id];
}

/** Which side of a wall tile its drapes face: the side a corridor is on. */
export type BigTopWallFaceSide = 'north' | 'south' | 'west' | 'east';

/** A wall tile's hung face: which side it looks onto floor, and what it is hung in. */
export interface BigTopWallFace {
  readonly side: BigTopWallFaceSide;
  readonly style: BigTopDrapeStyle;
}

/**
 * The face a Big Top wall tile shows, or null for a tile of the backstage
 * mass with no floor beside it. A wall looking onto floor to its south is a
 * north face (the sidewall hanging behind a corridor); otherwise the first of
 * north, east and west floor gives it a narrow edge fold.
 *
 * The style is read off the floor the face looks onto, never the wall's own
 * row: a face is seen from that floor, and a dividing row belongs to the act
 * below it while its face is the south edge of the room above.
 */
export function bigTopWallFace(
  isFloor: (tileX: number, tileY: number) => boolean,
  tileX: number,
  tileY: number,
): BigTopWallFace | null {
  const faces: ReadonlyArray<readonly [BigTopWallFaceSide, number, number]> = [
    ['north', 0, 1],
    ['south', 0, -1],
    ['west', 1, 0],
    ['east', -1, 0],
  ];
  for (const [side, dx, dy] of faces) {
    if (!isFloor(tileX + dx, tileY + dy)) continue;
    return { side, style: drapeStyleFacing(tileX + dx, tileY + dy) };
  }
  return null;
}

/**
 * How far out a Big Top wall tile must be clear of floor before it may show
 * backstage clutter: deep enough in the mass that nobody could take the shape
 * for something standing in a corridor.
 */
export const BACKSTAGE_CLUTTER_CLEARANCE_TILES = 2;

// ── Floor features ──────────────────────────────────────────────────────────

/** The act a scattered mark belongs to, which decides what it is a mark of. */
export type ScatterStyle = MazeSectionId;

/**
 * One baked mark on the sawdust. Coordinates are tile units; a rectangle is
 * inclusive tile indices.
 */
export type FloorFeature =
  | { readonly kind: 'scorch'; readonly centre: TilePoint; readonly radius: number }
  | {
      readonly kind: 'sootDrag';
      readonly x0: number;
      readonly x1: number;
      readonly row: number;
      readonly seed: number;
    }
  | { readonly kind: 'ironPlate'; readonly tile: MazeTile; readonly seed: number }
  | {
      readonly kind: 'strawDrift';
      readonly x0: number;
      readonly x1: number;
      readonly row: number;
      readonly seed: number;
    }
  | { readonly kind: 'pawTrail'; readonly points: ReadonlyArray<TilePoint>; readonly seed: number }
  | { readonly kind: 'whipCoil'; readonly centre: TilePoint; readonly seed: number }
  | { readonly kind: 'troughSpill'; readonly centre: TilePoint; readonly seed: number }
  | { readonly kind: 'practiceRing'; readonly centre: TilePoint; readonly radius: number }
  | { readonly kind: 'hoop'; readonly centre: TilePoint; readonly seed: number }
  | { readonly kind: 'harlequinCloth'; readonly rect: MazeRect }
  | { readonly kind: 'burnLane'; readonly x0: number; readonly x1: number; readonly row: number }
  | { readonly kind: 'stanchion'; readonly centre: TilePoint; readonly ropeTo: TilePoint | null }
  | { readonly kind: 'ringCurb'; readonly centre: TilePoint; readonly radius: number }
  | { readonly kind: 'spotMark'; readonly centre: TilePoint; readonly radius: number }
  | {
      readonly kind: 'vineRoots';
      readonly origin: TilePoint;
      readonly toward: TilePoint;
      readonly seed: number;
    }
  | { readonly kind: 'guyShadow'; readonly from: TilePoint; readonly to: TilePoint }
  | { readonly kind: 'poleFoot'; readonly shadow: PoleFootShadow }
  | { readonly kind: 'runner'; readonly column: number; readonly y0: number; readonly y1: number }
  | { readonly kind: 'holdMark'; readonly centre: TilePoint }
  | {
      readonly kind: 'scatter';
      readonly tile: MazeTile;
      readonly style: ScatterStyle;
      readonly seed: number;
    };

export type FloorFeatureKind = FloorFeature['kind'];

/**
 * Paint order, lowest first. Cloths and runners are laid before anything
 * spills or burns on them; the ring's paint goes down before the roots crack
 * through it.
 */
export const FLOOR_FEATURE_LAYER: Readonly<Record<FloorFeatureKind, number>> = {
  harlequinCloth: 0,
  runner: 0,
  practiceRing: 1,
  ringCurb: 1,
  spotMark: 1,
  guyShadow: 2,
  poleFoot: 2,
  scorch: 2,
  sootDrag: 2,
  burnLane: 3,
  troughSpill: 3,
  strawDrift: 4,
  pawTrail: 4,
  ironPlate: 4,
  vineRoots: 5,
  whipCoil: 6,
  hoop: 6,
  stanchion: 6,
  holdMark: 6,
  scatter: 7,
};

/** From a tile's edge to its middle, in tiles. */
export const TILE_MIDDLE = 0.5;
/** The middle of a 0–1 hash, for jitter either side of a point. */
const HASH_MIDPOINT = 0.5;

// Sizes every covering test and every painter agree on, in tiles.
export const SCORCH_RADIUS_TILES = 0.9;
export const RING_CURB_HALF_WIDTH_TILES = 0.22;
export const PRACTICE_RING_HALF_WIDTH_TILES = 0.12;
export const SPOT_MARK_HALF_WIDTH_TILES = 0.08;
export const STRAW_DRIFT_DEPTH_TILES = 0.45;
export const SOOT_DRAG_HALF_HEIGHT_TILES = 0.3;
export const BURN_LANE_HALF_HEIGHT_TILES = 0.42;
export const WHIP_COIL_RADIUS_TILES = 0.34;
export const TROUGH_SPILL_RADIUS_TILES = 0.6;
export const HOOP_RADIUS_TILES = 0.5;
export const STANCHION_BASE_RADIUS_TILES = 0.16;
export const HOLD_MARK_RADIUS_TILES = 0.44;
export const RUNNER_HALF_WIDTH_TILES = 0.36;
export const VINE_ROOT_REACH_TILES = 4.5;
export const GUY_SHADOW_HALF_WIDTH_TILES = 0.08;
export const PAW_PRINT_REACH_TILES = 0.25;

/**
 * The contact shadow round a tent pole's foot. It spreads past the pole's own
 * tiles onto the sawdust, so the pole painter and the floor marks both draw it
 * from this one shape, each clipped to its own tiles.
 */
export interface PoleFootShadow {
  readonly centre: TilePoint;
  readonly radiusX: number;
  readonly radiusY: number;
}

/** The mast's foot stands this far up from the bottom of its tiles. */
export const POLE_FOOT_LIFT_TILES = 0.14;
const POLE_FOOT_SHADOW_WIDTH_SHARE = 0.62;
const POLE_FOOT_SHADOW_DEPTH_PER_TILE = 0.3;

/** The foot shadow of a pole `blockWidth` × `blockHeight` tiles whose centre is `poleCentre`. */
export function poleFootShadow(
  poleCentre: TilePoint,
  blockWidth: number,
  blockHeight: number,
): PoleFootShadow {
  return {
    centre: { x: poleCentre.x, y: poleCentre.y + blockHeight / 2 - POLE_FOOT_LIFT_TILES },
    radiusX: blockWidth * POLE_FOOT_SHADOW_WIDTH_SHARE,
    radiusY: blockHeight * POLE_FOOT_SHADOW_DEPTH_PER_TILE,
  };
}

interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** The part of a tile a shape covers is tested against the tile's own box, [x, x+1) × [y, y+1). */
function tileBox(tileX: number, tileY: number): Box {
  return { x0: tileX, y0: tileY, x1: tileX + 1, y1: tileY + 1 };
}

function boxesOverlap(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

function discBox(centre: TilePoint, radius: number): Box {
  return {
    x0: centre.x - radius,
    y0: centre.y - radius,
    x1: centre.x + radius,
    y1: centre.y + radius,
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Nearest and farthest distance from `centre` to any point of a tile's box. */
function distanceRange(box: Box, centre: TilePoint): { near: number; far: number } {
  const nearX = clamp(centre.x, box.x0, box.x1) - centre.x;
  const nearY = clamp(centre.y, box.y0, box.y1) - centre.y;
  const farX = Math.max(Math.abs(box.x0 - centre.x), Math.abs(box.x1 - centre.x));
  const farY = Math.max(Math.abs(box.y0 - centre.y), Math.abs(box.y1 - centre.y));
  return { near: Math.hypot(nearX, nearY), far: Math.hypot(farX, farY) };
}

function annulusCovers(box: Box, centre: TilePoint, radius: number, halfWidth: number): boolean {
  const { near, far } = distanceRange(box, centre);
  return near <= radius + halfWidth && far >= radius - halfWidth;
}

function segmentBox(from: TilePoint, to: TilePoint, pad: number): Box {
  return {
    x0: Math.min(from.x, to.x) - pad,
    y0: Math.min(from.y, to.y) - pad,
    x1: Math.max(from.x, to.x) + pad,
    y1: Math.max(from.y, to.y) + pad,
  };
}

const SEGMENT_SAMPLES_PER_TILE = 8;

/** Whether a thick line passes over a tile, sampled along its length. */
function segmentCovers(box: Box, from: TilePoint, to: TilePoint, halfWidth: number): boolean {
  if (!boxesOverlap(box, segmentBox(from, to, halfWidth))) return false;
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const samples = Math.max(1, Math.ceil(length * SEGMENT_SAMPLES_PER_TILE));
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const point = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    if (boxesOverlap(box, discBox(point, halfWidth))) return true;
  }
  return false;
}

const FULL_TURN = Math.PI * 2;

const ROOT_COUNT = 9;
const ROOT_SEGMENTS = 10;
const ROOT_MIN_REACH = 1.1;
const ROOT_MIN_WIDTH = 0.04;
const ROOT_EXTRA_WIDTH = 0.12;
const ROOT_WANDER = 0.3;
const ROOT_ANGLE_JITTER = 0.25;
/** The segments a root forks at, counted from the pole. */
const ROOT_FIRST_FORK_SEGMENT = 4;
const ROOT_SECOND_FORK_SEGMENT = 7;
const ROOT_BRANCH_AT: ReadonlyArray<number> = [ROOT_FIRST_FORK_SEGMENT, ROOT_SECOND_FORK_SEGMENT];
/** A branch bends once, at this share of its length. */
const ROOT_BRANCH_ELBOW = 0.5;
const ROOT_BRANCH_SHARE = 0.35;
const ROOT_BRANCH_TURN = 0.7;
const ROOT_SALT = 23;

export interface RootPath {
  readonly points: ReadonlyArray<TilePoint>;
  readonly width: number;
}

/**
 * The king pole's roots, fanned out from its foot. Every root is laid out
 * from the seed alone, so the tiles it crosses all trace the same path; the
 * ones heading toward Grimaldi run furthest and thickest.
 */
export function rootPaths(origin: TilePoint, toward: TilePoint, seed: number): RootPath[] {
  const heading = Math.atan2(toward.y - origin.y, toward.x - origin.x);
  const paths: RootPath[] = [];
  for (let root = 0; root < ROOT_COUNT; root++) {
    const baseAngle =
      (root / ROOT_COUNT) * FULL_TURN +
      (decorHash(root, seed, ROOT_SALT) - HASH_MIDPOINT) * ROOT_ANGLE_JITTER;
    const pull = (1 + Math.cos(baseAngle - heading)) / 2;
    const reach = ROOT_MIN_REACH + pull * (VINE_ROOT_REACH_TILES - ROOT_MIN_REACH);
    const width = ROOT_MIN_WIDTH + pull * ROOT_EXTRA_WIDTH;
    const points: TilePoint[] = [origin];
    let angle = baseAngle;
    let x = origin.x;
    let y = origin.y;
    for (let segment = 1; segment <= ROOT_SEGMENTS; segment++) {
      angle += (decorHash(root, segment, seed + ROOT_SALT) - HASH_MIDPOINT) * ROOT_WANDER;
      x += (Math.cos(angle) * reach) / ROOT_SEGMENTS;
      y += (Math.sin(angle) * reach) / ROOT_SEGMENTS;
      points.push({ x, y });
      if (ROOT_BRANCH_AT.includes(segment)) {
        const side = decorHash(segment, root, ROOT_SALT) < HASH_MIDPOINT ? -1 : 1;
        const branchAngle = angle + side * ROOT_BRANCH_TURN;
        const branchReach = reach * ROOT_BRANCH_SHARE;
        paths.push({
          points: [
            { x, y },
            {
              x: x + Math.cos(branchAngle) * branchReach * ROOT_BRANCH_ELBOW,
              y: y + Math.sin(branchAngle) * branchReach * ROOT_BRANCH_ELBOW,
            },
            {
              x: x + Math.cos(branchAngle + side * ROOT_WANDER) * branchReach,
              y: y + Math.sin(branchAngle + side * ROOT_WANDER) * branchReach,
            },
          ],
          width: width * ROOT_BRANCH_SHARE,
        });
      }
    }
    paths.push({ points, width });
  }
  return paths;
}

/** The painted extent of a feature, generous enough that no pixel of it falls outside. */
export function featureBounds(feature: FloorFeature): Box {
  switch (feature.kind) {
    case 'scorch':
      return discBox(feature.centre, feature.radius);
    case 'sootDrag':
      return {
        x0: feature.x0,
        x1: feature.x1 + 1,
        y0: feature.row + TILE_MIDDLE - SOOT_DRAG_HALF_HEIGHT_TILES,
        y1: feature.row + TILE_MIDDLE + SOOT_DRAG_HALF_HEIGHT_TILES,
      };
    case 'ironPlate':
    case 'scatter':
      return tileBox(feature.tile.x, feature.tile.y);
    case 'strawDrift':
      return {
        x0: feature.x0,
        x1: feature.x1 + 1,
        y0: feature.row,
        y1: feature.row + STRAW_DRIFT_DEPTH_TILES,
      };
    case 'pawTrail': {
      const xs = feature.points.map((point) => point.x);
      const ys = feature.points.map((point) => point.y);
      return {
        x0: Math.min(...xs) - PAW_PRINT_REACH_TILES,
        x1: Math.max(...xs) + PAW_PRINT_REACH_TILES,
        y0: Math.min(...ys) - PAW_PRINT_REACH_TILES,
        y1: Math.max(...ys) + PAW_PRINT_REACH_TILES,
      };
    }
    case 'whipCoil':
      return discBox(feature.centre, WHIP_COIL_RADIUS_TILES * 2);
    case 'troughSpill':
      return discBox(feature.centre, TROUGH_SPILL_RADIUS_TILES);
    case 'practiceRing':
      return discBox(feature.centre, feature.radius + PRACTICE_RING_HALF_WIDTH_TILES);
    case 'hoop':
      return discBox(feature.centre, HOOP_RADIUS_TILES + PRACTICE_RING_HALF_WIDTH_TILES);
    case 'harlequinCloth':
      return {
        x0: feature.rect.x0,
        y0: feature.rect.y0,
        x1: feature.rect.x1 + 1,
        y1: feature.rect.y1 + 1,
      };
    case 'burnLane':
      return {
        x0: feature.x0,
        x1: feature.x1 + 1,
        y0: feature.row + TILE_MIDDLE - BURN_LANE_HALF_HEIGHT_TILES,
        y1: feature.row + TILE_MIDDLE + BURN_LANE_HALF_HEIGHT_TILES,
      };
    case 'stanchion': {
      const base = discBox(feature.centre, STANCHION_BASE_RADIUS_TILES * 2);
      if (feature.ropeTo === null) return base;
      const rope = segmentBox(feature.centre, feature.ropeTo, STANCHION_BASE_RADIUS_TILES);
      return {
        x0: Math.min(base.x0, rope.x0),
        y0: Math.min(base.y0, rope.y0),
        x1: Math.max(base.x1, rope.x1),
        y1: Math.max(base.y1, rope.y1),
      };
    }
    case 'ringCurb':
      return discBox(feature.centre, feature.radius + RING_CURB_HALF_WIDTH_TILES);
    case 'spotMark':
      return discBox(feature.centre, feature.radius + SPOT_MARK_HALF_WIDTH_TILES);
    case 'vineRoots':
      return discBox(feature.origin, VINE_ROOT_REACH_TILES);
    case 'guyShadow':
      return segmentBox(feature.from, feature.to, GUY_SHADOW_HALF_WIDTH_TILES);
    case 'poleFoot':
      return {
        x0: feature.shadow.centre.x - feature.shadow.radiusX,
        x1: feature.shadow.centre.x + feature.shadow.radiusX,
        y0: feature.shadow.centre.y - feature.shadow.radiusY,
        y1: feature.shadow.centre.y + feature.shadow.radiusY,
      };
    case 'runner':
      return {
        x0: feature.column + TILE_MIDDLE - RUNNER_HALF_WIDTH_TILES,
        x1: feature.column + TILE_MIDDLE + RUNNER_HALF_WIDTH_TILES,
        y0: feature.y0,
        y1: feature.y1 + 1,
      };
    case 'holdMark':
      return discBox(feature.centre, HOLD_MARK_RADIUS_TILES);
  }
}

/**
 * Whether a feature actually paints on a tile — tighter than its bounds for
 * the shapes that leave most of their box bare (a ring, a line), because
 * "this tile is dressed" is a claim the density gate counts.
 */
export function featureCovers(feature: FloorFeature, tileX: number, tileY: number): boolean {
  const box = tileBox(tileX, tileY);
  if (!boxesOverlap(box, featureBounds(feature))) return false;
  switch (feature.kind) {
    case 'ringCurb':
      return annulusCovers(box, feature.centre, feature.radius, RING_CURB_HALF_WIDTH_TILES);
    case 'practiceRing':
      return annulusCovers(box, feature.centre, feature.radius, PRACTICE_RING_HALF_WIDTH_TILES);
    case 'spotMark':
      return annulusCovers(box, feature.centre, feature.radius, SPOT_MARK_HALF_WIDTH_TILES);
    case 'scorch':
      return distanceRange(box, feature.centre).near < feature.radius;
    case 'guyShadow':
      return segmentCovers(box, feature.from, feature.to, GUY_SHADOW_HALF_WIDTH_TILES);
    case 'pawTrail':
      return feature.points.some((point) =>
        boxesOverlap(box, discBox(point, PAW_PRINT_REACH_TILES)),
      );
    // Solid shapes that fill their bounds, or small enough that their bounds are the mark.
    case 'sootDrag':
    case 'ironPlate':
    case 'strawDrift':
    case 'whipCoil':
    case 'troughSpill':
    case 'hoop':
    case 'harlequinCloth':
    case 'burnLane':
    case 'stanchion':
    case 'runner':
    case 'holdMark':
    case 'scatter':
    case 'poleFoot':
      return true;
    case 'vineRoots':
      return rootPaths(feature.origin, feature.toward, feature.seed).some((path) =>
        path.points.some((point, index) => {
          const next = path.points[index + 1] ?? point;
          return segmentCovers(box, point, next, path.width);
        }),
      );
  }
}

// ── The maze's features ─────────────────────────────────────────────────────

function isMazeFloorChar(char: string | undefined): boolean {
  return char === MAZE_FLOOR_CHAR || char === MAZE_HUMAN_SPAWN_CHAR || char === MAZE_CAT_SPAWN_CHAR;
}

/** Floor in the authored layout: the tiles a mark may be painted on. Barriers start as wall. */
export function isMazeLayoutFloor(tileX: number, tileY: number): boolean {
  return isMazeFloorChar(BIG_TOP_MAZE_ROWS[tileY]?.[tileX]);
}

/** The king pole's centre: the shared corner of its four tiles. */
function mazeKingPoleCentre(): TilePoint {
  const xs: number[] = [];
  const ys: number[] = [];
  BIG_TOP_MAZE_ROWS.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row.charAt(x) !== MAZE_POLE_CHAR) continue;
      xs.push(x);
      ys.push(y);
    }
  });
  if (xs.length === 0) throw new Error('the Big Top maze has no king pole');
  return {
    x: (Math.min(...xs) + Math.max(...xs) + 1) / 2,
    y: (Math.min(...ys) + Math.max(...ys) + 1) / 2,
  };
}

const FIREWALK: MazeSectionId = 'firewalk';

function sectionRows(id: MazeSectionId): { readonly y0: number; readonly y1: number } {
  const section = MAZE_SECTIONS.find((candidate) => candidate.id === id);
  if (section === undefined) throw new Error(`no Big Top maze section ${id}`);
  return section.rowRange;
}

/** A deterministic 0–1 hash of a few integers, for placement that must never change between runs. */
const HASH_XOR_A = 0x5bd1e995;
const HASH_MUL_A = 0x27d4eb2d;
const HASH_ADD_B = 0x165667b1;
const HASH_MUL_B = 0x85ebca6b;
const HASH_MUL_SALT = 0xc2b2ae35;
const HASH_MIX_MUL = 0x2c1b3c6d;
const HASH_SHIFT_A = 15;
const HASH_SHIFT_B = 13;
const UINT32_RANGE = 0x100000000;

export function decorHash(a: number, b: number, salt: number): number {
  let h = Math.imul(a ^ HASH_XOR_A, HASH_MUL_A) ^ Math.imul(b + HASH_ADD_B, HASH_MUL_B);
  h ^= Math.imul(salt, HASH_MUL_SALT);
  h = Math.imul(h ^ (h >>> HASH_SHIFT_A), HASH_MIX_MUL);
  h ^= h >>> HASH_SHIFT_B;
  return (h >>> 0) / UINT32_RANGE;
}

// Fire walk.
/**
 * Iron plates are only laid where a crawler cannot mistake one for a vent
 * grille: at least this far, Chebyshev, from every vent in the act.
 */
const IRON_PLATE_VENT_CLEARANCE_TILES = 3;
const IRON_PLATE_COUNT = 3;
const IRON_PLATE_SALT = 11;

function fireWalkFeatures(): FloorFeature[] {
  const features: FloorFeature[] = [];
  for (const vent of MAZE_VENTS) {
    if (sectionAtRow(vent.tileY).id !== FIREWALK) continue;
    features.push({
      kind: 'scorch',
      centre: { x: vent.tileX + TILE_MIDDLE, y: vent.tileY + TILE_MIDDLE },
      radius: SCORCH_RADIUS_TILES,
    });
  }
  // One drag per run of vents along a corridor row: where the flame lanes
  // throw their soot along the ground in the direction the fire walks.
  for (const corridor of MAZE_CORRIDORS) {
    const rows = new Map<number, number[]>();
    for (const vent of corridor.vents) {
      const xs = rows.get(vent.tileY) ?? [];
      xs.push(vent.tileX);
      rows.set(vent.tileY, xs);
    }
    for (const [row, xs] of rows) {
      if (xs.length < 2) continue;
      features.push({
        kind: 'sootDrag',
        x0: Math.min(...xs),
        x1: Math.max(...xs),
        row,
        seed: row * MAZE_WIDTH + Math.min(...xs),
      });
    }
  }

  const firewalkRows = sectionRows(FIREWALK);
  const clearOfVents = (x: number, y: number): boolean =>
    MAZE_VENTS.every(
      (vent) =>
        Math.max(Math.abs(vent.tileX - x), Math.abs(vent.tileY - y)) >=
        IRON_PLATE_VENT_CLEARANCE_TILES,
    );
  const plateCandidates: MazeTile[] = [];
  for (let y = firewalkRows.y0; y <= firewalkRows.y1; y++) {
    if (sectionAtRow(y).id !== FIREWALK) continue;
    for (let x = 0; x < MAZE_WIDTH; x++) {
      if (isMazeLayoutFloor(x, y) && clearOfVents(x, y)) plateCandidates.push({ x, y });
    }
  }
  plateCandidates.sort(
    (a, b) => decorHash(a.x, a.y, IRON_PLATE_SALT) - decorHash(b.x, b.y, IRON_PLATE_SALT),
  );
  plateCandidates.slice(0, IRON_PLATE_COUNT).forEach((tile, index) => {
    features.push({ kind: 'ironPlate', tile, seed: index });
  });
  return features;
}

// Menagerie.
/** The menagerie's two open halls, between the bleachers and the first cage row. */
const MENAGERIE_HALL_ROWS = { y0: 44, y1: 49 } as const;
const PRACTICE_RING_RADIUS_TILES = 1.7;
const PAW_STRIDE_TILES = 0.55;
const PAW_TRAIL_WANDER_TILES = 0.6;
const PAW_TRAIL_SALT = 29;

/** Where along a lane's open hall a mark is laid, as a fraction of the lane's width. */
const HALL_PRACTICE_RING_AT = 0.3;
const HALL_HOOP_AT = 0.72;
const HALL_TROUGH_AT = 0.88;
const HALL_WHIP_AT = 0.55;
/** How far a mark sits in from the hall's north or south wall, in tiles. */
const HALL_HOOP_FROM_NORTH = 1.6;
const HALL_TROUGH_FROM_SOUTH = 0.2;
const HALL_WHIP_FROM_SOUTH = 0.9;
/** The paw trail runs south of the hall's middle, clear of the practice ring's heart. */
const PAW_TRAIL_SOUTH_OF_MID = 1.2;
/** Left and right prints fall either side of the line the beast walks. */
const PAW_GAIT_HALF_SPREAD = 0.12;
const PAW_JITTER_SHARE = 0.4;
/** The trail starts and ends just inside the lane's walls. */
const PAW_TRAIL_START_INSET = 0.6;
const PAW_TRAIL_END_INSET = 0.4;

function laneX(lane: { readonly x0: number; readonly x1: number }, fraction: number): number {
  return lane.x0 + (lane.x1 + 1 - lane.x0) * fraction;
}

function menagerieFeatures(): FloorFeature[] {
  const features: FloorFeature[] = [];
  const hallMid = (MENAGERIE_HALL_ROWS.y0 + MENAGERIE_HALL_ROWS.y1 + 1) / 2;
  MENAGERIE_LANES.forEach((lane, laneIndex) => {
    features.push({
      kind: 'practiceRing',
      centre: { x: laneX(lane, HALL_PRACTICE_RING_AT), y: hallMid },
      radius: PRACTICE_RING_RADIUS_TILES,
    });
    features.push({
      kind: 'hoop',
      centre: { x: laneX(lane, HALL_HOOP_AT), y: MENAGERIE_HALL_ROWS.y0 + HALL_HOOP_FROM_NORTH },
      seed: laneIndex,
    });
    features.push({
      kind: 'troughSpill',
      centre: {
        x: laneX(lane, HALL_TROUGH_AT),
        y: MENAGERIE_HALL_ROWS.y1 - HALL_TROUGH_FROM_SOUTH,
      },
      seed: laneIndex,
    });
    features.push({
      kind: 'whipCoil',
      centre: { x: laneX(lane, HALL_WHIP_AT), y: MENAGERIE_HALL_ROWS.y1 - HALL_WHIP_FROM_SOUTH },
      seed: laneIndex,
    });
    // Straw drifted against the wall the bleachers stand on.
    features.push({
      kind: 'strawDrift',
      x0: lane.x0,
      x1: lane.x1,
      row: MENAGERIE_BLEACHER_ROW + 1,
      seed: laneIndex,
    });
    // A beast's walk across the hall, wall to wall, weaving a little.
    const points: TilePoint[] = [];
    const start = lane.x0 + PAW_TRAIL_START_INSET;
    const end = lane.x1 + PAW_TRAIL_END_INSET;
    const steps = Math.floor((end - start) / PAW_STRIDE_TILES);
    for (let step = 0; step <= steps; step++) {
      const x = start + step * PAW_STRIDE_TILES;
      const weave =
        Math.sin((step / steps) * Math.PI * 2 + laneIndex) * PAW_TRAIL_WANDER_TILES +
        (decorHash(step, laneIndex, PAW_TRAIL_SALT) - HASH_MIDPOINT) *
          PAW_STRIDE_TILES *
          PAW_JITTER_SHARE;
      const side = step % 2 === 0 ? -PAW_GAIT_HALF_SPREAD : PAW_GAIT_HALF_SPREAD;
      points.push({ x, y: hallMid + PAW_TRAIL_SOUTH_OF_MID + weave + side });
    }
    features.push({ kind: 'pawTrail', points, seed: laneIndex });
  });
  // Straw along the foot of every cage wall, where the beasts' bedding is
  // kicked out between the bars.
  for (const cageRow of MENAGERIE_CAGE_ROWS) {
    for (const lane of MENAGERIE_LANES) {
      features.push({
        kind: 'strawDrift',
        x0: lane.x0,
        x1: lane.x1,
        row: cageRow + 1,
        seed: cageRow * 2 + (lane.half === 'human' ? 0 : 1),
      });
    }
  }
  return features;
}

// Hall of mirrors.
const CLOTH_MARGIN_TILES = 1;
const STANCHION_SPACING_TILES = 3;

function mirrorHallFeatures(): FloorFeature[] {
  const features: FloorFeature[] = [];
  const [westWall, dividerX, eastWall] = MIRROR_HALL_GLASS_COLUMNS;
  const halls: ReadonlyArray<MazeRect> = [
    { x0: westWall + 1, y0: MIRROR_HALL_ROWS.y0, x1: dividerX - 1, y1: MIRROR_HALL_ROWS.y1 },
    { x0: dividerX + 1, y0: MIRROR_HALL_ROWS.y0, x1: eastWall - 1, y1: MIRROR_HALL_ROWS.y1 },
  ];
  for (const hall of halls) {
    const cloth: MazeRect = {
      x0: hall.x0 + CLOTH_MARGIN_TILES,
      y0: hall.y0 + CLOTH_MARGIN_TILES,
      x1: hall.x1 - CLOTH_MARGIN_TILES,
      y1: hall.y1 - CLOTH_MARGIN_TILES,
    };
    features.push({ kind: 'harlequinCloth', rect: cloth });
    // Velvet ropes along the cloth's north edge, flat on the floor.
    const row = hall.y0 + TILE_MIDDLE;
    const posts: TilePoint[] = [];
    for (
      let x = cloth.x0 + TILE_MIDDLE;
      x <= cloth.x1 + TILE_MIDDLE;
      x += STANCHION_SPACING_TILES
    ) {
      posts.push({ x, y: row });
    }
    posts.forEach((post, index) => {
      features.push({ kind: 'stanchion', centre: post, ropeTo: posts[index + 1] ?? null });
    });
  }
  // The span of each limelight's beam that burns whatever the mirrors do: the
  // unbent ray, traced with every mirror opaque.
  for (const projector of MAZE_PROJECTORS) {
    const path = traceMazeBeam(projector.half, () => null, isMazeLayoutFloor);
    const hot = path.steps.filter((step) => step.hot).map((step) => step.tile);
    const rows = new Set(hot.map((tile) => tile.y));
    for (const row of rows) {
      const xs = hot.filter((tile) => tile.y === row).map((tile) => tile.x);
      features.push({ kind: 'burnLane', x0: Math.min(...xs), x1: Math.max(...xs), row });
    }
  }
  return features;
}

// Finale.
const RING_RADIUS_TILES = 4;
/** The king pole stands on a 2×2 of tiles in both Big Top rooms. */
const KING_POLE_TILES = 2;
const SPOT_MARK_RADIUS_TILES = 1.6;

function finaleFeatures(): FloorFeature[] {
  const pole = mazeKingPoleCentre();
  const chamber = MAZE_FINAL_CHAMBER;
  const features: FloorFeature[] = [
    { kind: 'poleFoot', shadow: poleFootShadow(pole, KING_POLE_TILES, KING_POLE_TILES) },
    { kind: 'ringCurb', centre: pole, radius: RING_RADIUS_TILES },
    { kind: 'spotMark', centre: pole, radius: SPOT_MARK_RADIUS_TILES },
    {
      kind: 'vineRoots',
      origin: { x: pole.x, y: pole.y + 1 },
      toward: { x: MAZE_GRIMALDI_TILE.x + TILE_MIDDLE, y: MAZE_GRIMALDI_TILE.y + TILE_MIDDLE },
      seed: 1,
    },
  ];
  const corners: ReadonlyArray<TilePoint> = [
    { x: chamber.x0 + TILE_MIDDLE, y: chamber.y0 + TILE_MIDDLE },
    { x: chamber.x1 + TILE_MIDDLE, y: chamber.y0 + TILE_MIDDLE },
    { x: chamber.x0 + TILE_MIDDLE, y: chamber.y1 + TILE_MIDDLE },
    { x: chamber.x1 + TILE_MIDDLE, y: chamber.y1 + TILE_MIDDLE },
  ];
  const foot = poleFootShadow(pole, KING_POLE_TILES, KING_POLE_TILES).centre;
  for (const corner of corners) {
    features.push({ kind: 'guyShadow', from: foot, to: corner });
  }
  return features;
}

// The interval rooms.
const HOLD_MARK_OFFSET_TILES = 1.1;

function curtainRoomFeatures(): FloorFeature[] {
  const features: FloorFeature[] = [];
  for (const curtain of MAZE_CURTAINS) {
    for (const [room, barrier] of [
      [curtain.humanRoom, curtain.humanBarrier],
      [curtain.catRoom, curtain.catBarrier],
    ] as const) {
      features.push({ kind: 'runner', column: barrier.x, y0: room.y0, y1: room.y1 });
      const towardWindow = barrier.x < curtain.windowTile.x ? 1 : -1;
      features.push({
        kind: 'holdMark',
        centre: {
          x: barrier.x + TILE_MIDDLE + towardWindow * HOLD_MARK_OFFSET_TILES,
          y: (room.y0 + room.y1 + 1) / 2,
        },
      });
    }
  }
  return features;
}

// Density.
/** The side of the square of walkable floor no act may leave without a mark. */
export const UNDRESSED_SQUARE_TILES = 4;
const SCATTER_SALT = 47;

/**
 * Every fully walkable square of the given side that contains no dressed tile.
 * Shared by the fill pass below and by the maze's gate, which calls it with the
 * live map's own walkability.
 */
export function undressedSquares(
  width: number,
  height: number,
  isFloor: (tileX: number, tileY: number) => boolean,
  isDressed: (tileX: number, tileY: number) => boolean,
  side: number = UNDRESSED_SQUARE_TILES,
): MazeTile[] {
  const found: MazeTile[] = [];
  for (let y = 0; y + side <= height; y++) {
    for (let x = 0; x + side <= width; x++) {
      let allFloor = true;
      let dressed = false;
      for (let dy = 0; dy < side && allFloor; dy++) {
        for (let dx = 0; dx < side; dx++) {
          if (!isFloor(x + dx, y + dy)) {
            allFloor = false;
            break;
          }
          if (isDressed(x + dx, y + dy)) dressed = true;
        }
      }
      if (allFloor && !dressed) found.push({ x, y });
    }
  }
  return found;
}

/**
 * Every authored mark, then the fill.
 *
 * The fill counts only these marks, not the ring runners `BigTopMazeSystem`
 * lays live, so the index is the same whether or not the system has been built
 * by the time the first chunk bakes — and the marks alone keep the density rule.
 */
function buildMazeFeatures(): FloorFeature[] {
  const features: FloorFeature[] = [
    ...fireWalkFeatures(),
    ...menagerieFeatures(),
    ...mirrorHallFeatures(),
    ...finaleFeatures(),
    ...curtainRoomFeatures(),
  ];
  const coveredTiles = new Set<string>();
  const cover = (feature: FloorFeature): void => {
    const bounds = featureBounds(feature);
    for (let y = Math.floor(bounds.y0); y < Math.ceil(bounds.y1); y++) {
      for (let x = Math.floor(bounds.x0); x < Math.ceil(bounds.x1); x++) {
        if (isMazeLayoutFloor(x, y) && featureCovers(feature, x, y)) coveredTiles.add(`${x},${y}`);
      }
    }
  };
  features.forEach(cover);
  const isDressed = (x: number, y: number): boolean => coveredTiles.has(`${x},${y}`);

  // Greedy fill: every square still bare gets one small mark of its act, on a
  // hashed tile inside it, until none is left. Each mark dresses every square
  // that holds its tile, so the loop converges in far fewer marks than squares.
  for (;;) {
    const bare = undressedSquares(MAZE_WIDTH, MAZE_HEIGHT, isMazeLayoutFloor, isDressed);
    if (bare.length === 0) break;
    const square = bare[0];
    const pick = Math.floor(
      decorHash(square.x, square.y, SCATTER_SALT) * UNDRESSED_SQUARE_TILES ** 2,
    );
    const tile = {
      x: square.x + (pick % UNDRESSED_SQUARE_TILES),
      y: square.y + Math.floor(pick / UNDRESSED_SQUARE_TILES),
    };
    const scatter: FloorFeature = {
      kind: 'scatter',
      tile,
      style: sectionAtRow(tile.y).id,
      seed: tile.x * MAZE_HEIGHT + tile.y,
    };
    features.push(scatter);
    cover(scatter);
  }
  return features;
}

/**
 * Every baked mark of the maze, listed per floor tile it paints on.
 *
 * Built from the authored layout alone — never from a live map — so the tile
 * painter can answer during any bake without a map in hand.
 */
export function buildBigTopFloorIndex(): ReadonlyMap<string, ReadonlyArray<FloorFeature>> {
  const index = new Map<string, FloorFeature[]>();
  for (const feature of buildMazeFeatures()) {
    const bounds = featureBounds(feature);
    for (let y = Math.floor(bounds.y0); y < Math.ceil(bounds.y1); y++) {
      for (let x = Math.floor(bounds.x0); x < Math.ceil(bounds.x1); x++) {
        if (!isMazeLayoutFloor(x, y) || !featureCovers(feature, x, y)) continue;
        const key = `${x},${y}`;
        const list = index.get(key) ?? [];
        list.push(feature);
        index.set(key, list);
      }
    }
  }
  for (const list of index.values()) {
    list.sort((a, b) => FLOOR_FEATURE_LAYER[a.kind] - FLOOR_FEATURE_LAYER[b.kind]);
  }
  return index;
}

const NO_FEATURES: ReadonlyArray<FloorFeature> = [];

function arenaFeatures(layout: Extract<BigTopDecorLayout, { kind: 'arena' }>): FloorFeature[] {
  const base = poleFootShadow(layout.poleCentre, KING_POLE_TILES, KING_POLE_TILES).centre;
  const reach = layout.ringRadius + 2;
  return [
    {
      kind: 'poleFoot',
      shadow: poleFootShadow(layout.poleCentre, KING_POLE_TILES, KING_POLE_TILES),
    },
    { kind: 'ringCurb', centre: layout.ringCentre, radius: layout.ringRadius },
    { kind: 'spotMark', centre: layout.poleCentre, radius: SPOT_MARK_RADIUS_TILES },
    { kind: 'guyShadow', from: base, to: { x: base.x - reach, y: base.y - reach } },
    { kind: 'guyShadow', from: base, to: { x: base.x + reach, y: base.y - reach } },
    { kind: 'guyShadow', from: base, to: { x: base.x - reach, y: base.y + reach } },
    { kind: 'guyShadow', from: base, to: { x: base.x + reach, y: base.y + reach } },
  ];
}

/** The marks the tile painter lays on one sawdust tile, lowest layer first. */
export function bigTopFloorFeaturesAt(tileX: number, tileY: number): ReadonlyArray<FloorFeature> {
  if (activeLayout === null) return NO_FEATURES;
  if (activeLayout.kind === 'arena') {
    return arenaFeatures(activeLayout)
      .filter((feature) => featureCovers(feature, tileX, tileY))
      .sort((a, b) => FLOOR_FEATURE_LAYER[a.kind] - FLOOR_FEATURE_LAYER[b.kind]);
  }
  mazeIndex ??= buildBigTopFloorIndex();
  return mazeIndex.get(`${tileX},${tileY}`) ?? NO_FEATURES;
}
