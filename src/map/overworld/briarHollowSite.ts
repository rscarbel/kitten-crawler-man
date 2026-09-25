/**
 * Briar Hollow's place on the floor-3 overworld: where the village is sited,
 * and the record every village system reads its geometry from.
 *
 * The record is a pure function of the authored layout (`briarHollowLayout.ts`)
 * and the site's origin, plus a little seeded dressing — all drawn from the
 * world seed — so it is never persisted: a load regenerates the same village
 * from the same seed.
 */

import type { TileGrid } from '../town/tileGrid';
import type { TilePoint, TileRect, TownPlan } from '../town/townPlan';
import type { ElevationField } from './elevation';
import { grownRect, KeepOut, type KeepOutDisc, type KeepOutRect } from './keepOut';
import {
  BELL_TOWER,
  BUILDINGS,
  CLUTTER_PROPS,
  CLUTTER_SPOTS,
  COOKHOUSE_TABLES,
  CROP_FIELDS,
  DISTRICTS,
  doorwayTiles,
  EAST_LANE_APPROACH,
  FLANK_LANE_SPAWN_DISTANCE_TILES,
  NORTH_LANE_APPROACH,
  WEST_LANE_APPROACH,
  FARM_PROPS,
  GATE_APPROACH_TILES,
  GATE_WIDTH_TILES,
  GATE_X0,
  GROVE_TREES,
  HALL_SHELTER_SPOTS,
  LAMP_POSTS,
  LUMBER_YARD,
  LUMBER_YARD_DECALS,
  LUMBER_YARD_PROPS,
  MISC_DECALS,
  MISC_PROPS,
  NOTICE_BOARD,
  OPEN_AIR_ANCHORS,
  PALISADE_CHAMFER_TILES,
  PASTURE,
  PASTURE_FENCE_GATES,
  QUARRY,
  QUARRY_DEPOSITS,
  QUARRY_PROPS,
  QUARRY_SPUR,
  QUARRY_WALL_STUBS,
  RUINS_CENTRE,
  RUINS_RADIUS_TILES,
  SOUTH_LANE_SPAWN_DISTANCE_TILES,
  SOUTH_ROAD,
  SQUARE,
  SQUARE_BENCHES,
  resolveProp,
  VILLAGE_BOUNDS_H,
  VILLAGE_BOUNDS_W,
  WELLS,
  type ClutterPropId,
  type PropPlacement,
  type PropTemplate,
  type VillageBuildingId,
  type VillageDistrictId,
  type VillageFloor,
  type VillagerAnchorKind,
} from './briarHollowLayout';
import { worldRandom } from '../../core/WorldRandom';

export type {
  PropPlacement,
  VillageBuildingId,
  VillageDistrictId,
  VillagerAnchorKind,
} from './briarHollowLayout';

// ── The record ────────────────────────────────────────────────────────────────

/** One run of palisade that shares a tier and one HP pool. */
export interface PalisadeSegmentDef {
  /** Stable across generations of the same layout; the persisted structure state keys on it. */
  readonly id: string;
  readonly index: number;
  /** The run's tiles, in palisade-path order. */
  readonly tiles: readonly TilePoint[];
}

export interface VillageDistrict {
  readonly id: VillageDistrictId;
  /** Minimap label, or `null` for a HUD-only zone. */
  readonly label: string | null;
  readonly rect: TileRect;
  /** Where the label is drawn: the rect's centre. */
  readonly labelTile: TilePoint;
}

export interface VillageBuildingDef {
  readonly id: VillageBuildingId;
  readonly name: string;
  /** Outer footprint, walls included. */
  readonly rect: TileRect;
  /** Threshold tiles — gaps in the wall. Never `buildingEntries`: nothing here is a door to another scene. */
  readonly doorways: readonly TilePoint[];
  /** The walled-in floor: the rect inset by one. */
  readonly interior: TileRect;
  readonly floor: VillageFloor;
  /** Where each occupant stands to work, beside their work prop. */
  readonly occupantAnchors: readonly TilePoint[];
  readonly furniture: readonly PropPlacement[];
}

/** What a crop field is sown with. Seeded dressing. */
export type CropKind = 'grain' | 'cabbage' | 'roots';
const CROP_KINDS: readonly CropKind[] = ['grain', 'cabbage', 'roots'];

/** A household's accent cloth, for flower boxes and quilts. Seeded dressing. */
export type HouseholdColour = 'madder' | 'woad' | 'weld';
const HOUSEHOLD_COLOURS: readonly HouseholdColour[] = ['madder', 'woad', 'weld'];

/** The homes a laundry line can be strung beside. */
const LAUNDRY_HOMES: readonly VillageBuildingId[] = [
  'home_nella',
  'home_cricket',
  'home_midge',
  'home_wicker',
];

/**
 * The village's seeded dressing: the only part of it the world seed may vary.
 * Nothing here moves a wall, a door or a prop's footprint.
 */
export interface BriarHollowDressing {
  /** One per `cropFields` entry, in the same order. */
  readonly cropKinds: readonly CropKind[];
  /** Which home the laundry line hangs beside. */
  readonly laundryHome: VillageBuildingId;
  /** One per clutter spot: which of crate, barrel or sack stands there. */
  readonly clutter: readonly ClutterPropId[];
  /** Accent colour per building, for flower boxes, quilts and signboards. */
  readonly householdColours: ReadonlyMap<VillageBuildingId, HouseholdColour>;
}

/**
 * How far round a lane's spawn tile the assault looks for open ground to
 * raise a body on, and how far the generator's reachability check looks for
 * reachable ground round it.
 */
export const ASSAULT_LANE_SPAWN_SEARCH_TILES = 6;

/** The four sides of the village an assault wave can come from. */
export type AssaultLaneId = 'north' | 'south' | 'east' | 'west';

export interface AssaultLane {
  readonly id: AssaultLaneId;
  /**
   * Where the lane's attackers appear. Nothing spawns there until the assault.
   * The east and south lanes' spawns stand on ground the generator keeps
   * clear; the north and west lanes' are nominal, out in whatever the
   * wilderness grew there, and the assault spawns on the nearest open ground
   * with a way to the wall.
   */
  readonly spawn: TilePoint;
  /** The tile just outside the palisade the lane heads for. */
  readonly approach: TilePoint;
}

/** Briar Hollow's site on the overworld map, in tile coordinates. */
export interface BriarHollowSite {
  /** Centre of the palisade's bounding rectangle. */
  readonly centre: TilePoint;
  /** Outer rectangle of the palisade ring. */
  readonly palisadeBounds: TileRect;
  /** The inside of the ring: the bounds inset by one. The chamfered corners leave a few ring tiles in it. */
  readonly interior: TileRect;
  /**
   * Every palisade tile, in order: starting at the tile east of the gate and
   * walking away from it — east along the south wall, north up the east wall,
   * west along the north wall, south down the west wall and back east to the
   * tile west of the gate. The gate's own tiles are not in it.
   */
  readonly palisadePath: readonly TilePoint[];
  readonly segments: readonly PalisadeSegmentDef[];
  readonly gate: {
    readonly tiles: readonly TilePoint[];
    /** Two tiles south of the gate's middle tile. */
    readonly outside: TilePoint;
    /** Two tiles north of the gate's middle tile. */
    readonly inside: TilePoint;
    readonly facing: 'south';
  };
  readonly districts: readonly VillageDistrict[];
  readonly buildings: readonly VillageBuildingDef[];
  readonly square: {
    readonly rect: TileRect;
    /** North-west tile of the 2×2 bell tower. */
    readonly bellTile: TilePoint;
    readonly wells: readonly TilePoint[];
  };
  readonly pasture: { readonly rect: TileRect; readonly fenceGates: readonly TilePoint[] };
  readonly cropFields: readonly TileRect[];
  readonly lumberYard: {
    readonly rect: TileRect;
    readonly groveTiles: readonly TilePoint[];
    /** North-west tile of the sawmill machine: the manual processing station. */
    readonly sawmillAnchor: TilePoint;
  };
  readonly quarry: {
    readonly rect: TileRect;
    readonly depositTiles: readonly TilePoint[];
    /**
     * The ruined walls' stubs along the quarry's ruins side, stood up as
     * dressed-stone deposits so the old walls can be mined like the outcrops.
     */
    readonly stubTiles: readonly TilePoint[];
    /** The hut's threshold tile. */
    readonly hutDoor: TilePoint;
  };
  readonly ruins: {
    readonly centre: TilePoint;
    readonly radiusTiles: number;
    readonly necromancerArrival: TilePoint;
  };
  readonly assaultLanes: readonly AssaultLane[];
  readonly villagerAnchors: Readonly<Record<VillagerAnchorKind, readonly TilePoint[]>>;
  /**
   * Every prop stood up outside a building's furniture: the square's, the
   * farm's, the lumber yard's, the quarry's and the clutter. Building furniture
   * is on each `VillageBuildingDef`.
   */
  readonly props: readonly PropPlacement[];
  readonly dressing: BriarHollowDressing;
  /** Ground the other generator passes stay off: the village, its roads, the quarry and the ruins. */
  readonly keepOut: KeepOut;
  /** Where no hostile may be spawned: the palisade bounds grown by `SPAWN_EXCLUSION_MARGIN_TILES`. */
  readonly spawnExclusion: TileRect;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Tiles past the palisade that ambient hostiles are never spawned inside. They may still wander in. */
export const SPAWN_EXCLUSION_MARGIN_TILES = 6;
/** Tiles past the palisade that the natural passes (forest, ruins, boulders, cover, cliffs) keep off. */
const KEEP_OUT_MARGIN_TILES = 4;
/** Tiles past the quarry and the ruins disc that the natural passes keep off. */
const OUTSIDE_KEEP_OUT_MARGIN_TILES = 2;
/** Tiles past the south road and the quarry spur the natural passes keep off, either side. */
const ROAD_KEEP_OUT_MARGIN_TILES = 1;
/** Clear ground required between the palisade bounds and the void border. */
const BORDER_MARGIN_TILES = 3;
/** Tiles past the town's safe radius no palisade or outside-district tile may reach. */
const TOWN_SAFE_ZONE_MARGIN_TILES = 2;

/** Nearest and furthest the village's centre may sit from the map centre, in tiles. */
const SITE_MIN_DISTANCE_TILES = 68;
const SITE_MAX_DISTANCE_TILES = 80;
/** Half-width of the arc, either side of due east, that the site is sampled in. */
const SITE_ARC_HALF_DEGREES = 60;
/** Fallback arc and distance band, tried in turn when the first finds nothing. */
const FALLBACK_ARC_HALF_DEGREES = 90;
const FALLBACK_MIN_DISTANCE_TILES = 64;
const FALLBACK_MAX_DISTANCE_TILES = 84;
/**
 * Candidates tried per band before falling back. Raised alongside the
 * palisade's size: a bigger footprint has fewer usable candidates per band,
 * so it needs more samples to find one as reliably as the old, smaller ring did.
 */
const SITE_ATTEMPTS_PER_BAND = 240;
const DEGREES_PER_HALF_TURN = 180;

/** Every how many tiles the footprint is sampled when scoring a candidate. */
const SCORE_SAMPLE_STEP_TILES = 4;
/** Weight of mean slope against band preference in a candidate's score. */
const SLOPE_PENALTY_WEIGHT = 40;
/** Band preference: lowland is best, meadow nearly as good, uplands poor. */
const LOWLAND_SCORE = 1;
const MEADOW_SCORE = 0.7;
const HIGHLAND_SCORE = 0.2;

/**
 * The segment length the palisade is cut into, and the shortest and longest a
 * run may end up. Four sections' worth per run: the wall's cost is per
 * segment regardless of how many tiles it covers, so cutting the ring into
 * fewer, longer runs is what makes fortifying the whole village affordable.
 */
export const SEGMENT_TILES = 12;
export const SEGMENT_MIN_TILES = SEGMENT_TILES - 1;
export const SEGMENT_MAX_TILES = SEGMENT_TILES + 1;

/**
 * Bumped whenever `segmentLengths` cuts the ring differently — a segment id is
 * only its index, so a saved wall record keyed under the old cut names a
 * different, wrongly-sized run under the new one. `briarHollowState` reads
 * this to drop stale wall records from an older save rather than misapply
 * them to the wrong stretch of wall.
 */
export const PALISADE_SEGMENT_SCHEME_VERSION = 3;

// ── Geometry helpers ──────────────────────────────────────────────────────────

function shiftPoint(origin: TilePoint, point: TilePoint): TilePoint {
  return { x: origin.x + point.x, y: origin.y + point.y };
}

function shiftRect(origin: TilePoint, rect: TileRect): TileRect {
  return { x: origin.x + rect.x, y: origin.y + rect.y, w: rect.w, h: rect.h };
}

/** The middle tile of a rectangle, rounding toward its north-west corner. */
export function rectCentre(rect: TileRect): TilePoint {
  return { x: rect.x + Math.floor(rect.w / 2), y: rect.y + Math.floor(rect.h / 2) };
}

export function rectContains(rect: TileRect, x: number, y: number): boolean {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h;
}

function insetRect(rect: TileRect): TileRect {
  return { x: rect.x + 1, y: rect.y + 1, w: rect.w - 2, h: rect.h - 2 };
}

/** The site's origin (palisade north-west corner) for a given centre. */
function originForCentre(centre: TilePoint): TilePoint {
  return {
    x: centre.x - Math.floor(VILLAGE_BOUNDS_W / 2),
    y: centre.y - Math.floor(VILLAGE_BOUNDS_H / 2),
  };
}

/**
 * How far a tile of the bounding rectangle is from the nearest corner, summed
 * over both axes. The corner triangle below `PALISADE_CHAMFER_TILES` is outside
 * the ring; the two diagonals at the chamfer depth are the stepped wall.
 */
function cornerDistance(x: number, y: number): number {
  const fromWest = x;
  const fromEast = VILLAGE_BOUNDS_W - 1 - x;
  const fromNorth = y;
  const fromSouth = VILLAGE_BOUNDS_H - 1 - y;
  return Math.min(
    fromWest + fromNorth,
    fromEast + fromNorth,
    fromWest + fromSouth,
    fromEast + fromSouth,
  );
}

/**
 * Whether a site-relative tile is on the palisade ring.
 *
 * The chamfer is a staircase two tiles thick on the diagonal (corner distances
 * `C` and `C + 1`), so that the ring is closed to a four-connected walker: a
 * one-tile diagonal would touch only at corners and leak.
 */
export function isRingTile(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= VILLAGE_BOUNDS_W || y >= VILLAGE_BOUNDS_H) return false;
  const corner = cornerDistance(x, y);
  if (corner < PALISADE_CHAMFER_TILES) return false;
  const onEdge = x === 0 || y === 0 || x === VILLAGE_BOUNDS_W - 1 || y === VILLAGE_BOUNDS_H - 1;
  return onEdge || corner <= PALISADE_CHAMFER_TILES + 1;
}

/** Whether a site-relative tile is strictly inside the ring. */
export function isInsideRing(x: number, y: number): boolean {
  if (x <= 0 || y <= 0 || x >= VILLAGE_BOUNDS_W - 1 || y >= VILLAGE_BOUNDS_H - 1) return false;
  return cornerDistance(x, y) > PALISADE_CHAMFER_TILES + 1;
}

/** Site-relative gate tiles, west to east. */
function gateTilesRelative(): TilePoint[] {
  const tiles: TilePoint[] = [];
  for (let i = 0; i < GATE_WIDTH_TILES; i++) {
    tiles.push({ x: GATE_X0 + i, y: VILLAGE_BOUNDS_H - 1 });
  }
  return tiles;
}

const CARDINAL_STEPS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, -1],
  [-1, 0],
  [0, 1],
];

/**
 * The palisade's tiles in path order, site-relative.
 *
 * Walks the ring from the gate's east post, stepping first to the east, and
 * always to the one ring neighbour not yet visited — every ring tile has
 * exactly two, which `isRingTile`'s staircase guarantees.
 */
function palisadePathRelative(): TilePoint[] {
  const gate = new Set(gateTilesRelative().map((tile) => `${tile.x},${tile.y}`));
  const isPath = (x: number, y: number) => isRingTile(x, y) && !gate.has(`${x},${y}`);
  const start: TilePoint = { x: GATE_X0 + GATE_WIDTH_TILES, y: VILLAGE_BOUNDS_H - 1 };
  const path: TilePoint[] = [start];
  const visited = new Set<string>([`${start.x},${start.y}`]);
  let current = start;
  for (;;) {
    let next: TilePoint | null = null;
    for (const [dx, dy] of CARDINAL_STEPS) {
      const candidate = { x: current.x + dx, y: current.y + dy };
      if (!isPath(candidate.x, candidate.y)) continue;
      if (visited.has(`${candidate.x},${candidate.y}`)) continue;
      next = candidate;
      break;
    }
    if (next === null) break;
    path.push(next);
    visited.add(`${next.x},${next.y}`);
    current = next;
  }
  return path;
}

/**
 * The palisade's segment lengths, in path order.
 *
 * **This is a save-format contract.** Persisted wall state is keyed by segment
 * id, and an id is only its index, so the same ring must always cut into the
 * same runs. The rule: `pathLength` split into as many runs of `SEGMENT_TILES`
 * as it divides into evenly, with any leftover tiles spread one apiece across
 * the runs starting from the gate's east post, so every run is `SEGMENT_TILES`
 * or one tile longer rather than one run absorbing the whole remainder.
 * Changing this, the ring's shape, or where the path starts orphans every
 * saved wall — `briarHollowState`'s segment-scheme version exists for exactly
 * that.
 */
export function segmentLengths(pathLength: number): number[] {
  if (pathLength <= 0) return [];
  const count = Math.max(1, Math.round(pathLength / SEGMENT_TILES));
  const base = Math.floor(pathLength / count);
  const remainder = pathLength - base * count;
  return Array.from({ length: count }, (_, index) => (index < remainder ? base + 1 : base));
}

/** Stable segment id: a function of its index alone. */
export function palisadeSegmentId(index: number): string {
  return `palisade_${index}`;
}

function cutSegments(path: readonly TilePoint[]): PalisadeSegmentDef[] {
  const segments: PalisadeSegmentDef[] = [];
  let cursor = 0;
  segmentLengths(path.length).forEach((length, index) => {
    segments.push({
      id: palisadeSegmentId(index),
      index,
      tiles: path.slice(cursor, cursor + length),
    });
    cursor += length;
  });
  return segments;
}

// ── Keep-out ──────────────────────────────────────────────────────────────────

/** The ruins disc as a rectangle, for bounds checks. */
function ruinsRect(origin: TilePoint): TileRect {
  const centre = shiftPoint(origin, RUINS_CENTRE);
  return {
    x: centre.x - RUINS_RADIUS_TILES,
    y: centre.y - RUINS_RADIUS_TILES,
    w: RUINS_RADIUS_TILES * 2 + 1,
    h: RUINS_RADIUS_TILES * 2 + 1,
  };
}

/** The shapes the village occupies, before any margin. */
function coreFootprint(origin: TilePoint): {
  bounds: TileRect;
  quarry: TileRect;
  ruins: KeepOutDisc;
  southRoad: TileRect;
  spur: TileRect;
} {
  return {
    bounds: shiftRect(origin, { x: 0, y: 0, w: VILLAGE_BOUNDS_W, h: VILLAGE_BOUNDS_H }),
    quarry: shiftRect(origin, QUARRY),
    ruins: {
      kind: 'disc',
      centre: shiftPoint(origin, RUINS_CENTRE),
      radiusTiles: RUINS_RADIUS_TILES,
    },
    southRoad: shiftRect(origin, SOUTH_ROAD),
    spur: shiftRect(origin, QUARRY_SPUR),
  };
}

/**
 * Half the width of the open ground kept from the north and west walls out to
 * their lanes' spawns, so no forest, cliff or river the wilderness grows can
 * shut a wave in where it rises.
 */
const FLANK_LANE_HALF_WIDTH_TILES = 2;

/** The north and west lanes' corridors, from each lane's spawn in to its wall. */
function flankLaneCorridors(origin: TilePoint): TileRect[] {
  const corridorWidth = FLANK_LANE_HALF_WIDTH_TILES * 2 + 1;
  const corridorLength = FLANK_LANE_SPAWN_DISTANCE_TILES + FLANK_LANE_HALF_WIDTH_TILES + 1;
  const north = shiftRect(origin, {
    x: NORTH_LANE_APPROACH.x - FLANK_LANE_HALF_WIDTH_TILES,
    y: -FLANK_LANE_SPAWN_DISTANCE_TILES - FLANK_LANE_HALF_WIDTH_TILES,
    w: corridorWidth,
    h: corridorLength,
  });
  const west = shiftRect(origin, {
    x: -FLANK_LANE_SPAWN_DISTANCE_TILES - FLANK_LANE_HALF_WIDTH_TILES,
    y: WEST_LANE_APPROACH.y - FLANK_LANE_HALF_WIDTH_TILES,
    w: corridorLength,
    h: corridorWidth,
  });
  return [north, west];
}

function keepOutFor(origin: TilePoint): KeepOut {
  const core = coreFootprint(origin);
  return new KeepOut([
    { kind: 'rect', rect: grownRect(core.bounds, KEEP_OUT_MARGIN_TILES) },
    { kind: 'rect', rect: grownRect(core.quarry, OUTSIDE_KEEP_OUT_MARGIN_TILES) },
    {
      kind: 'disc',
      centre: shiftPoint(origin, RUINS_CENTRE),
      radiusTiles: RUINS_RADIUS_TILES + OUTSIDE_KEEP_OUT_MARGIN_TILES,
    },
    { kind: 'rect', rect: grownRect(core.southRoad, ROAD_KEEP_OUT_MARGIN_TILES) },
    { kind: 'rect', rect: grownRect(core.spur, ROAD_KEEP_OUT_MARGIN_TILES) },
    ...flankLaneCorridors(origin).map((rect): KeepOutRect => ({ kind: 'rect', rect })),
  ]);
}

// ── Siting ────────────────────────────────────────────────────────────────────

interface SiteBand {
  readonly arcHalfDegrees: number;
  readonly minDistance: number;
  readonly maxDistance: number;
}

const SITE_BANDS: readonly SiteBand[] = [
  {
    arcHalfDegrees: SITE_ARC_HALF_DEGREES,
    minDistance: SITE_MIN_DISTANCE_TILES,
    maxDistance: SITE_MAX_DISTANCE_TILES,
  },
  {
    arcHalfDegrees: FALLBACK_ARC_HALF_DEGREES,
    minDistance: SITE_MIN_DISTANCE_TILES,
    maxDistance: SITE_MAX_DISTANCE_TILES,
  },
  {
    arcHalfDegrees: FALLBACK_ARC_HALF_DEGREES,
    minDistance: FALLBACK_MIN_DISTANCE_TILES,
    maxDistance: FALLBACK_MAX_DISTANCE_TILES,
  },
];

function forEachTile(rect: TileRect, visit: (x: number, y: number) => boolean): boolean {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      if (!visit(x, y)) return false;
    }
  }
  return true;
}

/**
 * Whether a candidate origin can hold the village.
 *
 * Checked against the grid as it stands when the site is picked — the town, its
 * wall and the gate highways, and nothing of the wilderness yet — so what it
 * rejects is the void border, the town's safe zone, and a highway or the wall
 * running through the footprint. Rivers are not here to reject: they are carved
 * later and steered around the village's keep-out instead.
 */
function isSiteUsable(grid: TileGrid, plan: TownPlan, origin: TilePoint, border: number): boolean {
  const core = coreFootprint(origin);
  const minTile = border + 1;
  const maxTile = grid.size - border - 2;
  const withinBorder = (rect: TileRect) =>
    rect.x >= minTile &&
    rect.y >= minTile &&
    rect.x + rect.w - 1 <= maxTile &&
    rect.y + rect.h - 1 <= maxTile;
  if (!withinBorder(grownRect(core.bounds, BORDER_MARGIN_TILES))) return false;
  if (!withinBorder(core.quarry)) return false;
  if (!withinBorder(ruinsRect(origin))) return false;
  if (!withinBorder(core.southRoad)) return false;

  const safeReach = plan.safeRadiusTiles + TOWN_SAFE_ZONE_MARGIN_TILES;
  const outsideSafeZone = (x: number, y: number) =>
    Math.hypot(x - plan.centre.x, y - plan.centre.y) > safeReach;
  const ruins = ruinsRect(origin);
  for (const rect of [core.bounds, core.quarry, ruins]) {
    if (!forEachTile(rect, outsideSafeZone)) return false;
  }

  // Nothing of the town's may already stand where the village will: not the
  // wall, not a highway. A highway running into the palisade would end at a
  // stockade with no gate in it.
  const clearOfTown = (x: number, y: number) => !grid.isSolid(x, y) && !grid.isPaved(x, y);
  const occupied = [
    grownRect(core.bounds, KEEP_OUT_MARGIN_TILES),
    grownRect(core.quarry, OUTSIDE_KEEP_OUT_MARGIN_TILES),
    grownRect(ruins, OUTSIDE_KEEP_OUT_MARGIN_TILES),
  ];
  for (const rect of occupied) {
    if (!forEachTile(rect, clearOfTown)) return false;
  }
  // The roads may cross a highway — two roads meeting is a junction — but not
  // the town wall.
  for (const rect of [core.southRoad, core.spur]) {
    if (!forEachTile(rect, (x, y) => !grid.isSolid(x, y))) return false;
  }
  // The flank lanes are open ground a wave walks in by, so they may cross a
  // highway, but neither leave the map nor run into the town.
  for (const rect of flankLaneCorridors(origin)) {
    if (!withinBorder(rect)) return false;
    if (!forEachTile(rect, (x, y) => !grid.isSolid(x, y) && outsideSafeZone(x, y))) return false;
  }
  return true;
}

/**
 * How well a candidate suits a village: flat ground, and low rather than high.
 * Farmers settle the valley floor, and the flatter the ground the less the
 * flattening pass has to bend the land around the palisade.
 */
function siteScore(elevation: ElevationField, origin: TilePoint): number {
  const bounds = shiftRect(origin, { x: 0, y: 0, w: VILLAGE_BOUNDS_W, h: VILLAGE_BOUNDS_H });
  let samples = 0;
  let slope = 0;
  let band = 0;
  for (let y = bounds.y; y < bounds.y + bounds.h; y += SCORE_SAMPLE_STEP_TILES) {
    for (let x = bounds.x; x < bounds.x + bounds.w; x += SCORE_SAMPLE_STEP_TILES) {
      samples++;
      slope += elevation.gradientAt(x, y).magnitude;
      const tileBand = elevation.bandAt(x, y);
      if (tileBand === 'lowland') band += LOWLAND_SCORE;
      else if (tileBand === 'meadow') band += MEADOW_SCORE;
      else if (tileBand === 'highland') band += HIGHLAND_SCORE;
    }
  }
  if (samples === 0) return 0;
  return band / samples - (slope / samples) * SLOPE_PENALTY_WEIGHT;
}

/**
 * Picks the village's centre: 68–80 tiles east of the town, within 60° of due
 * east, so "the ruins east of here" and "the southern road" are true on the
 * map. Scores every usable candidate and keeps the best. Widens the arc, then
 * the distance band, before giving up.
 *
 * Throws rather than returning nothing: a floor-3 world without the village has
 * no questline. `verify:briar-hollow-site` shows over hundreds of seeds that the
 * first band always finds a site.
 */
export function pickBriarHollowSite(
  grid: TileGrid,
  plan: TownPlan,
  elevation: ElevationField,
  border: number,
): TilePoint {
  for (const band of SITE_BANDS) {
    let best: TilePoint | null = null;
    let bestScore = -Infinity;
    const arcRadians = (band.arcHalfDegrees * Math.PI) / DEGREES_PER_HALF_TURN;
    for (let attempt = 0; attempt < SITE_ATTEMPTS_PER_BAND; attempt++) {
      const angle = (worldRandom() * 2 - 1) * arcRadians;
      const distance = band.minDistance + worldRandom() * (band.maxDistance - band.minDistance);
      const centre: TilePoint = {
        x: Math.round(plan.centre.x + Math.cos(angle) * distance),
        y: Math.round(plan.centre.y + Math.sin(angle) * distance),
      };
      const origin = originForCentre(centre);
      if (!isSiteUsable(grid, plan, origin, border)) continue;
      const score = siteScore(elevation, origin);
      if (score > bestScore) {
        bestScore = score;
        best = centre;
      }
    }
    if (best !== null) return best;
  }
  throw new Error(
    'Briar Hollow could not be sited: no candidate east of the town fits between the safe ' +
      'zone, the gate highways and the void border',
  );
}

/** The village's keep-out for a picked centre, before the village has been built. */
export function briarHollowKeepOut(centre: TilePoint): KeepOut {
  return keepOutFor(originForCentre(centre));
}

/**
 * Where the land is held flat for the village: the palisade and its margin, the
 * quarry, and the ruins disc. The falloff is where the ground rises back to
 * whatever the wilderness is doing around it.
 */
export function briarHollowFlattenRects(centre: TilePoint): {
  readonly rects: readonly TileRect[];
  readonly ruins: KeepOutDisc;
} {
  const origin = originForCentre(centre);
  const core = coreFootprint(origin);
  return {
    rects: [grownRect(core.bounds, KEEP_OUT_MARGIN_TILES), core.quarry],
    ruins: core.ruins,
  };
}

// ── The record ────────────────────────────────────────────────────────────────

function pick<T>(options: readonly T[]): T {
  const index = Math.min(options.length - 1, Math.floor(worldRandom() * options.length));
  return options[index];
}

/** Draws the village's dressing from the world seed. */
function drawDressing(): BriarHollowDressing {
  const cropKinds = CROP_FIELDS.map(() => pick(CROP_KINDS));
  const laundryHome = pick(LAUNDRY_HOMES);
  const clutter = CLUTTER_SPOTS.map(() => pick(CLUTTER_PROPS));
  const householdColours = new Map<VillageBuildingId, HouseholdColour>();
  for (const building of BUILDINGS) householdColours.set(building.id, pick(HOUSEHOLD_COLOURS));
  return { cropKinds, laundryHome, clutter, householdColours };
}

/** Every prop outside the buildings' furniture, in map coordinates. */
function openAirProps(origin: TilePoint, dressing: BriarHollowDressing): PropPlacement[] {
  const templates: PropTemplate[] = [
    { prop: 'bell_tower', ...BELL_TOWER },
    { prop: 'notice_board', ...NOTICE_BOARD },
    ...WELLS.map((tile): PropTemplate => ({ prop: 'well', ...tile })),
    ...LAMP_POSTS.map((tile): PropTemplate => ({ prop: 'lamp_post', ...tile })),
    ...SQUARE_BENCHES.map((tile): PropTemplate => ({ prop: 'bench', ...tile })),
    ...FARM_PROPS,
    ...LUMBER_YARD_PROPS,
    ...LUMBER_YARD_DECALS,
    ...COOKHOUSE_TABLES,
    ...MISC_PROPS,
    ...MISC_DECALS,
    ...QUARRY_PROPS,
    ...CLUTTER_SPOTS.map((tile, index): PropTemplate => ({
      prop: dressing.clutter[index] ?? 'crate',
      ...tile,
    })),
  ];
  return templates.map((template) =>
    resolveProp({ prop: template.prop, ...shiftPoint(origin, template) }),
  );
}

function buildBuildings(origin: TilePoint): VillageBuildingDef[] {
  return BUILDINGS.map((template) => {
    const rect = shiftRect(origin, template.rect);
    const buildingOrigin: TilePoint = { x: rect.x, y: rect.y };
    return {
      id: template.id,
      name: template.name,
      rect,
      doorways: template.doorways.flatMap((spec) => doorwayTiles(rect, spec)),
      interior: insetRect(rect),
      floor: template.floor,
      occupantAnchors: template.occupantAnchors.map((anchor) => shiftPoint(buildingOrigin, anchor)),
      furniture: template.furniture.map((prop) =>
        resolveProp({ prop: prop.prop, ...shiftPoint(buildingOrigin, prop) }),
      ),
    };
  });
}

function buildAnchors(
  origin: TilePoint,
  buildings: readonly VillageBuildingDef[],
): Record<VillagerAnchorKind, readonly TilePoint[]> {
  const byBuilding = (id: VillageBuildingId): readonly TilePoint[] =>
    buildings.find((building) => building.id === id)?.occupantAnchors ?? [];
  const shift = (points: readonly TilePoint[]) => points.map((point) => shiftPoint(origin, point));
  const homes: TilePoint[] = [
    ...byBuilding('home_nella'),
    ...byBuilding('home_cricket'),
    ...byBuilding('home_wicker'),
    ...byBuilding('home_midge'),
  ];
  return {
    hall: byBuilding('hall'),
    forge: byBuilding('forge'),
    cookhouse: byBuilding('cookhouse'),
    infirmary: byBuilding('infirmary'),
    store: byBuilding('store'),
    workshop: byBuilding('workshop'),
    sawmill: byBuilding('sawmill'),
    guardhouse: byBuilding('guardhouse'),
    farmhouse: byBuilding('farmhouse'),
    barn: byBuilding('barn'),
    home_nella: byBuilding('home_nella'),
    home_cricket: byBuilding('home_cricket'),
    home_wicker: byBuilding('home_wicker'),
    home_midge: byBuilding('home_midge'),
    garn_hut: byBuilding('garn_hut'),
    square: shift(OPEN_AIR_ANCHORS.square),
    well: shift(OPEN_AIR_ANCHORS.well),
    bench: shift(OPEN_AIR_ANCHORS.bench),
    notice_board: shift(OPEN_AIR_ANCHORS.notice_board),
    bell: shift(OPEN_AIR_ANCHORS.bell),
    cookhouse_tables: shift(OPEN_AIR_ANCHORS.cookhouse_tables),
    kitchen_garden: shift(OPEN_AIR_ANCHORS.kitchen_garden),
    crop_fields: shift(OPEN_AIR_ANCHORS.crop_fields),
    pasture_fence: shift(OPEN_AIR_ANCHORS.pasture_fence),
    lumber_yard: shift(OPEN_AIR_ANCHORS.lumber_yard),
    quarry: shift(OPEN_AIR_ANCHORS.quarry),
    gate: shift(OPEN_AIR_ANCHORS.gate),
    homes,
    hall_shelter: shift(HALL_SHELTER_SPOTS),
  };
}

/**
 * The site record for a village centred on `centre`.
 *
 * Draws the dressing from the world stream, so it must be called exactly once
 * per generation, at the same point in the pass order, or every later pass's
 * draws shift.
 */
export function buildBriarHollowSite(centre: TilePoint): BriarHollowSite {
  const origin = originForCentre(centre);
  const dressing = drawDressing();
  const palisadeBounds = shiftRect(origin, {
    x: 0,
    y: 0,
    w: VILLAGE_BOUNDS_W,
    h: VILLAGE_BOUNDS_H,
  });
  const palisadePath = palisadePathRelative().map((tile) => shiftPoint(origin, tile));
  const gateTiles = gateTilesRelative().map((tile) => shiftPoint(origin, tile));
  const gateMiddle = gateTiles[Math.floor(gateTiles.length / 2)];
  const gateOutside: TilePoint = { x: gateMiddle.x, y: gateMiddle.y + GATE_APPROACH_TILES };
  const buildings = buildBuildings(origin);
  const sawmill = buildings.find((building) => building.id === 'sawmill');
  const sawmillMachine = sawmill?.furniture.find((prop) => prop.prop === 'sawmill_machine');
  const hut = buildings.find((building) => building.id === 'garn_hut');
  const ruinsCentre = shiftPoint(origin, RUINS_CENTRE);

  return {
    centre,
    palisadeBounds,
    interior: insetRect(palisadeBounds),
    palisadePath,
    segments: cutSegments(palisadePath),
    gate: {
      tiles: gateTiles,
      outside: gateOutside,
      inside: { x: gateMiddle.x, y: gateMiddle.y - GATE_APPROACH_TILES },
      facing: 'south',
    },
    districts: DISTRICTS.map((district) => {
      const rect = shiftRect(origin, district.rect);
      return { id: district.id, label: district.label, rect, labelTile: rectCentre(rect) };
    }),
    buildings,
    square: {
      rect: shiftRect(origin, SQUARE),
      bellTile: shiftPoint(origin, BELL_TOWER),
      wells: WELLS.map((well) => shiftPoint(origin, well)),
    },
    pasture: {
      rect: shiftRect(origin, PASTURE),
      fenceGates: PASTURE_FENCE_GATES.map((gate) => shiftPoint(origin, gate)),
    },
    cropFields: CROP_FIELDS.map((field) => shiftRect(origin, field)),
    lumberYard: {
      rect: shiftRect(origin, LUMBER_YARD),
      groveTiles: GROVE_TREES.map((tree) => shiftPoint(origin, tree)),
      sawmillAnchor:
        sawmillMachine === undefined
          ? shiftPoint(origin, LUMBER_YARD)
          : { x: sawmillMachine.x, y: sawmillMachine.y },
    },
    quarry: {
      rect: shiftRect(origin, QUARRY),
      depositTiles: QUARRY_DEPOSITS.map((deposit) => shiftPoint(origin, deposit)),
      stubTiles: QUARRY_WALL_STUBS.map((stub) => shiftPoint(origin, stub)),
      hutDoor: hut?.doorways[0] ?? shiftPoint(origin, QUARRY),
    },
    ruins: {
      centre: ruinsCentre,
      radiusTiles: RUINS_RADIUS_TILES,
      necromancerArrival: ruinsCentre,
    },
    assaultLanes: [
      {
        id: 'east',
        spawn: { x: ruinsCentre.x + RUINS_RADIUS_TILES - 1, y: ruinsCentre.y },
        approach: shiftPoint(origin, EAST_LANE_APPROACH),
      },
      {
        id: 'south',
        spawn: { x: gateOutside.x, y: gateOutside.y + SOUTH_LANE_SPAWN_DISTANCE_TILES },
        approach: { x: gateOutside.x, y: gateOutside.y + 1 },
      },
      {
        id: 'north',
        spawn: shiftPoint(origin, {
          x: NORTH_LANE_APPROACH.x,
          y: -FLANK_LANE_SPAWN_DISTANCE_TILES,
        }),
        approach: shiftPoint(origin, NORTH_LANE_APPROACH),
      },
      {
        id: 'west',
        spawn: shiftPoint(origin, {
          x: -FLANK_LANE_SPAWN_DISTANCE_TILES,
          y: WEST_LANE_APPROACH.y,
        }),
        approach: shiftPoint(origin, WEST_LANE_APPROACH),
      },
    ],
    villagerAnchors: buildAnchors(origin, buildings),
    props: openAirProps(origin, dressing),
    dressing,
    keepOut: keepOutFor(origin),
    spawnExclusion: grownRect(palisadeBounds, SPAWN_EXCLUSION_MARGIN_TILES),
  };
}
