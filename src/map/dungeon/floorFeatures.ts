/**
 * Where each dressed room's one floor feature lies — a puddle, a rug, a
 * mosaic ring, hazard stripes round the boiler — and the decals laid along
 * hallways: a gutter down one side of a cellar drain passage, and a faded walk
 * line down the middle of a long service-level run.
 *
 * Pure placement: every position comes from the finished grid and the region
 * map, hashed from the room's own bounds, so the same map always dresses the
 * same way and no seeded stream is touched. The painters live in
 * `src/map/tiles/floorFeatureArt.ts`.
 *
 * Features are large, quiet and walkable. Each keeps one tile clear of every
 * doorway and lies on walkable floor, except for the prop a scorch mark or a
 * set of hazard stripes is laid around.
 */

import type { TileContent } from '../tileTypes';
import { BOILER, BRAZIER, FloorTypeValue } from '../tileTypes';
import type { Point, Rect } from '../roomDoorways';
import type { RoomRegion } from '../regionMap';
import { MULTI_TILE_PROP_FOOTPRINTS } from '../serviceLevelProps';
import type { FloorFeatureId } from './roomCharacters';
import { UINT32_SPAN } from '../../core/WorldRandom';

/** One ripple in a liquid's rim: the outline swells and pinches `frequency` times round. */
export interface RimWobble {
  readonly frequency: number;
  /** Swell as a share of the radius. */
  readonly amplitude: number;
  readonly phase: number;
}

/**
 * A liquid's shape, in tile units: one tilted ellipse whose rim is pushed in
 * and out by a few ripples. One outline rather than a sum of blobs, because
 * two blobs of similar size read as a bow tie or a dog bone.
 */
export interface LiquidOutline {
  readonly x: number;
  readonly y: number;
  readonly radiusX: number;
  readonly radiusY: number;
  /** Tilt of the ellipse's long axis, in radians. */
  readonly angle: number;
  readonly wobbles: ReadonlyArray<RimWobble>;
}

/** One placed feature. Coordinates are in tile units; a tile's centre is `x + 0.5`. */
export interface PlacedFloorFeature {
  readonly kind: FloorFeatureId;
  /** Region id of the room it lies in. */
  readonly region: number;
  /** The tiles the decal may paint; it fades to nothing at this rect's edge. */
  readonly footprint: Readonly<Rect>;
  readonly centreX: number;
  readonly centreY: number;
  /** Half extents of the decal's body, in tiles. */
  readonly halfWidth: number;
  readonly halfHeight: number;
  /** For a liquid: its outline; null for a solid decal. */
  readonly outline: LiquidOutline | null;
  /** The prop the feature is laid around, which is not walkable; null for a free feature. */
  readonly anchor: Readonly<Rect> | null;
  /** Varies shape details — a scorch's ragged edge, a strand's angle. */
  readonly seed: number;
}

/** How a feature finds its place in a room. */
type Placement = 'off_centre' | 'centred' | 'around_brazier' | 'around_boiler';

/**
 * How ragged a liquid's rim is: a run of ripples starting at three swells
 * round, each swelling less than the last. A two-swell ripple is left out:
 * strong, it pinches the pool into a figure eight.
 */
interface LiquidSpec {
  readonly ripples: number;
  /** The first ripple's swell, as a share of the radius. */
  readonly firstSwell: number;
  /** Each ripple swells this share of the one before. */
  readonly swellFalloff: number;
}

/** Standing water: a broad body with a gently uneven rim. */
const POOL: LiquidSpec = { ripples: 6, firstSwell: 0.07, swellFalloff: 0.75 };
/** A spill: a rim more ragged than water's, where it splashed out. */
const SPLASH: LiquidSpec = { ripples: 6, firstSwell: 0.08, swellFalloff: 0.82 };

interface FeatureSpec {
  /** Footprint in tiles, laid long side along the room's long side. */
  readonly long: number;
  readonly short: number;
  /**
   * The smallest footprint the feature still reads at. A room with no space
   * for the full size takes the largest that fits rather than going without:
   * a character's floor feature is half of what makes it that character.
   */
  readonly minLong: number;
  readonly minShort: number;
  readonly placement: Placement;
  /** Liquid features are drawn as a field of blobs; null for a solid decal. */
  readonly liquid: LiquidSpec | null;
}

/**
 * Every room feature id a character may name. The two laid along hallways
 * (`gutter`, `walk_line`) are hallway marks, not placed features.
 */
const ROOM_FEATURE_SPECS: Readonly<
  Record<Exclude<FloorFeatureId, 'gutter' | 'walk_line'>, FeatureSpec>
> = {
  puddle: { long: 5, short: 4, minLong: 3, minShort: 2, placement: 'off_centre', liquid: POOL },
  // Wide water round a floor drain: the flooded pump room's floor reads as
  // standing water, still floor.
  drain_stain: {
    long: 7,
    short: 5,
    minLong: 3,
    minShort: 3,
    placement: 'off_centre',
    liquid: POOL,
  },
  wine_spill: {
    long: 3,
    short: 3,
    minLong: 2,
    minShort: 2,
    placement: 'off_centre',
    liquid: SPLASH,
  },
  oil_spill: {
    long: 3,
    short: 3,
    minLong: 2,
    minShort: 2,
    placement: 'off_centre',
    liquid: SPLASH,
  },
  mosaic_ring: { long: 5, short: 5, minLong: 3, minShort: 3, placement: 'centred', liquid: null },
  worn_rug: { long: 4, short: 3, minLong: 3, minShort: 2, placement: 'off_centre', liquid: null },
  straw_bed: { long: 4, short: 3, minLong: 2, minShort: 2, placement: 'off_centre', liquid: null },
  trapdoor: { long: 2, short: 2, minLong: 2, minShort: 2, placement: 'off_centre', liquid: null },
  scorch_mark: {
    long: 3,
    short: 3,
    minLong: 2,
    minShort: 2,
    placement: 'around_brazier',
    liquid: null,
  },
  hazard_stripes: {
    long: 4,
    short: 4,
    minLong: 4,
    minShort: 4,
    placement: 'around_boiler',
    liquid: null,
  },
};

/** Tiles kept clear between a feature and any doorway tile. */
const DOORWAY_CLEARANCE_TILES = 1;
/**
 * Where an off-centre feature most likes to sit, as a share of the way from the
 * room's middle to its edge: clear of the fighting space in the middle, not
 * jammed against a wall.
 */
const OFF_CENTRE_TARGET = 0.5;
/** How much a candidate's hash may outweigh its distance from the target, so rooms vary. */
const PLACEMENT_JITTER = 0.25;
const HALF = 0.5;
const FULL_TURN = Math.PI * 2;
/**
 * A liquid's radius as a share of its footprint's half size before its rim
 * swells. Small enough that the swollen rim and the damp halo past it have
 * faded out before the footprint's edge: a liquid whose edge is decided by
 * the fade comes out with a straight side.
 */
const OUTLINE_RADIUS_SHARE = 0.58;
/** Each radius is stretched or squeezed by up to this share, so no two pools are one oval. */
const OUTLINE_RADIUS_JITTER = 0.15;
/** How far the outline's middle drifts from the footprint's, as a share of the footprint. */
const OUTLINE_CENTRE_DRIFT = 0.08;
/** Most the ellipse tilts either way, in radians; past this its long axis leaves the footprint's. */
const OUTLINE_MAX_TILT = 0.35;
/** The lowest rim ripple has this many swells round. */
const FIRST_WOBBLE_FREQUENCY = 3;
/** Hash salts for an outline's two radii, its position, its tilt and its ripples. */
const OUTLINE_RADIUS_X_SALT = 1;
const OUTLINE_RADIUS_Y_SALT = 2;
const OUTLINE_X_SALT = 3;
const OUTLINE_Y_SALT = 4;
const OUTLINE_TILT_SALT = 5;
const WOBBLE_PHASE_SALT = 6;
const WOBBLE_AMPLITUDE_SALT = 7;
/** A ripple's swell is its spec's amplitude scaled by a share drawn from this up to one. */
const WOBBLE_AMPLITUDE_MIN_SHARE = 0.5;
/** How much of its footprint a solid decal's body fills, leaving room for its soft edge. */
const BODY_SHARE = 0.36;

const HASH_PRIME_X = 73856093;
const HASH_PRIME_Y = 19349663;
const HASH_PRIME_SALT = 83492791;
const HASH_SHIFT = 13;

/** The cubic Hermite easing `3t² − 2t³`, written as `t² (3 − 2t)`. */
const HERMITE_SQUARE = 3;
const HERMITE_CUBE = 2;

/** 0 below `edge0`, 1 above `edge1`, and a smooth S-curve between. */
export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (HERMITE_SQUARE - HERMITE_CUBE * t);
}

/** A deterministic 0..1 value from three integers. */
export function featureHash(x: number, y: number, salt: number): number {
  let h =
    Math.imul(x, HASH_PRIME_X) ^ Math.imul(y, HASH_PRIME_Y) ^ Math.imul(salt, HASH_PRIME_SALT);
  h = Math.imul(h ^ (h >>> HASH_SHIFT), HASH_PRIME_X);
  h ^= h >>> HASH_SHIFT;
  return (h >>> 0) / UINT32_SPAN;
}

function isWalkableAt(walkable: Uint8Array, width: number, x: number, y: number): boolean {
  return walkable[y * width + x] === 1;
}

function nearDoorway(doorTiles: ReadonlyArray<Point>, rect: Readonly<Rect>): boolean {
  return doorTiles.some(
    (door) =>
      door.x >= rect.x - DOORWAY_CLEARANCE_TILES &&
      door.x < rect.x + rect.w + DOORWAY_CLEARANCE_TILES &&
      door.y >= rect.y - DOORWAY_CLEARANCE_TILES &&
      door.y < rect.y + rect.h + DOORWAY_CLEARANCE_TILES,
  );
}

function rectInside(inner: Readonly<Rect>, outer: Readonly<Rect>): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

function everyTile(rect: Readonly<Rect>, test: (x: number, y: number) => boolean): boolean {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      if (!test(x, y)) return false;
    }
  }
  return true;
}

/** The best free spot for a footprint of this size, or null when none fits. */
function freeFootprint(
  room: RoomRegion,
  w: number,
  h: number,
  placement: Placement,
  walkable: Uint8Array,
  width: number,
  doorTiles: ReadonlyArray<Point>,
  seed: number,
): Rect | null {
  const { bounds } = room;
  const roomCentreX = bounds.x + bounds.w / 2;
  const roomCentreY = bounds.y + bounds.h / 2;
  const halfSpanX = Math.max(1, bounds.w / 2);
  const halfSpanY = Math.max(1, bounds.h / 2);
  let best: Rect | null = null;
  let bestScore = -Infinity;
  for (let y = bounds.y; y + h <= bounds.y + bounds.h; y++) {
    for (let x = bounds.x; x + w <= bounds.x + bounds.w; x++) {
      const rect = { x, y, w, h };
      if (nearDoorway(doorTiles, rect)) continue;
      if (!everyTile(rect, (tx, ty) => isWalkableAt(walkable, width, tx, ty))) continue;
      const offX = (x + w / 2 - roomCentreX) / halfSpanX;
      const offY = (y + h / 2 - roomCentreY) / halfSpanY;
      const off = Math.hypot(offX, offY);
      const fit = placement === 'centred' ? -off : -Math.abs(off - OFF_CENTRE_TARGET);
      const score = fit + featureHash(x, y, seed) * PLACEMENT_JITTER;
      if (score > bestScore) {
        bestScore = score;
        best = rect;
      }
    }
  }
  return best;
}

/** The first tile of a type inside a room, scanning row by row. */
function firstTileOfType(
  grid: TileContent[][],
  bounds: Readonly<Rect>,
  type: number,
): Point | null {
  for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
    for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
      if (grid[y][x].type === type) return { x, y };
    }
  }
  return null;
}

/** The rect a boiler anchored at (x, y) covers: its anchor is the bottom-left tile. */
function boilerRect(anchor: Point): Rect {
  const footprint = MULTI_TILE_PROP_FOOTPRINTS.get(BOILER);
  const w = footprint?.w ?? 1;
  const h = footprint?.h ?? 1;
  return { x: anchor.x, y: anchor.y - (h - 1), w, h };
}

/**
 * The footprint round a prop: the prop's rect grown by a tile, kept inside the
 * room, with any side that reaches a doorway's clearance pulled back until it
 * does not. Null only when the prop itself stands within that clearance.
 */
function anchoredFootprint(
  anchor: Readonly<Rect>,
  room: RoomRegion,
  doorTiles: ReadonlyArray<Point>,
): Rect | null {
  let left = Math.max(room.bounds.x, anchor.x - 1);
  let top = Math.max(room.bounds.y, anchor.y - 1);
  let right = Math.min(room.bounds.x + room.bounds.w, anchor.x + anchor.w + 1);
  let bottom = Math.min(room.bounds.y + room.bounds.h, anchor.y + anchor.h + 1);
  const reach = DOORWAY_CLEARANCE_TILES + 1;
  for (const door of doorTiles) {
    const rect = { x: left, y: top, w: right - left, h: bottom - top };
    if (!nearDoorway([door], rect)) continue;
    // Each side the door lies beyond, pulled in just far enough to clear it;
    // the one that gives up least floor wins, and no side may cut the prop.
    const options: Array<{ cost: number; apply: () => void }> = [];
    if (door.x + reach <= anchor.x) {
      options.push({ cost: door.x + reach - left, apply: () => (left = door.x + reach) });
    }
    if (door.x - reach + 1 >= anchor.x + anchor.w) {
      options.push({
        cost: right - (door.x - reach + 1),
        apply: () => (right = door.x - reach + 1),
      });
    }
    if (door.y + reach <= anchor.y) {
      options.push({ cost: door.y + reach - top, apply: () => (top = door.y + reach) });
    }
    if (door.y - reach + 1 >= anchor.y + anchor.h) {
      options.push({
        cost: bottom - (door.y - reach + 1),
        apply: () => (bottom = door.y - reach + 1),
      });
    }
    if (options.length === 0) return null;
    options.sort((a, b) => a.cost - b.cost)[0].apply();
  }
  const rect = { x: left, y: top, w: right - left, h: bottom - top };
  return nearDoorway(doorTiles, rect) ? null : rect;
}

/**
 * The largest free footprint the room can hold, from the spec's full size down
 * to its minimum, trying both orientations at each size.
 */
function shrinkingFreeFootprint(
  room: RoomRegion,
  spec: FeatureSpec,
  walkable: Uint8Array,
  width: number,
  doorTiles: ReadonlyArray<Point>,
  seed: number,
): Rect | null {
  const placement: Placement = spec.placement === 'centred' ? 'centred' : 'off_centre';
  const wide = room.bounds.w >= room.bounds.h;
  for (let long = spec.long; long >= spec.minLong; long--) {
    for (let short = Math.min(spec.short, long); short >= spec.minShort; short--) {
      const along = wide ? { w: long, h: short } : { w: short, h: long };
      const across = { w: along.h, h: along.w };
      for (const size of [along, across]) {
        const found = freeFootprint(
          room,
          size.w,
          size.h,
          placement,
          walkable,
          width,
          doorTiles,
          seed,
        );
        if (found !== null) return found;
      }
    }
  }
  return null;
}

function liquidOutline(footprint: Readonly<Rect>, liquid: LiquidSpec, seed: number): LiquidOutline {
  const signed = (salt: number, index: number) => (featureHash(index, salt, seed) - HALF) * 2;
  const radiusX =
    footprint.w *
    HALF *
    OUTLINE_RADIUS_SHARE *
    (1 + signed(OUTLINE_RADIUS_X_SALT, 0) * OUTLINE_RADIUS_JITTER);
  const radiusY =
    footprint.h *
    HALF *
    OUTLINE_RADIUS_SHARE *
    (1 + signed(OUTLINE_RADIUS_Y_SALT, 0) * OUTLINE_RADIUS_JITTER);
  const wobbles = Array.from({ length: liquid.ripples }, (_, index) => {
    const amplitude = liquid.firstSwell * liquid.swellFalloff ** index;
    const share =
      WOBBLE_AMPLITUDE_MIN_SHARE +
      featureHash(index, WOBBLE_AMPLITUDE_SALT, seed) * (1 - WOBBLE_AMPLITUDE_MIN_SHARE);
    return {
      frequency: FIRST_WOBBLE_FREQUENCY + index,
      amplitude: amplitude * share,
      phase: featureHash(index, WOBBLE_PHASE_SALT, seed) * FULL_TURN,
    };
  });
  return {
    x:
      footprint.x +
      footprint.w * HALF +
      signed(OUTLINE_X_SALT, 0) * footprint.w * OUTLINE_CENTRE_DRIFT,
    y:
      footprint.y +
      footprint.h * HALF +
      signed(OUTLINE_Y_SALT, 0) * footprint.h * OUTLINE_CENTRE_DRIFT,
    radiusX,
    radiusY,
    angle: signed(OUTLINE_TILT_SALT, 0) * OUTLINE_MAX_TILT,
    wobbles,
  };
}

/** Everything {@link placeRoomFeature} reads. */
export interface FeaturePlacementInput {
  readonly grid: TileContent[][];
  readonly walkable: Uint8Array;
  readonly room: RoomRegion;
  readonly kind: FloorFeatureId;
}

/** Places a room's feature, or returns null when the room has no spot for it. */
export function placeRoomFeature(input: FeaturePlacementInput): PlacedFloorFeature | null {
  const { grid, walkable, room, kind } = input;
  if (kind === 'gutter' || kind === 'walk_line') return null;
  const spec = ROOM_FEATURE_SPECS[kind];
  const width = grid.length === 0 ? 0 : grid[0].length;
  const doorTiles = room.doorways.flatMap((doorway) => doorway.tiles);
  const seed = Math.floor(
    featureHash(room.bounds.x, room.bounds.y, room.bounds.w * room.bounds.h) * UINT32_SPAN,
  );

  let footprint: Rect | null = null;
  let anchor: Rect | null = null;
  const anchorType =
    spec.placement === 'around_brazier'
      ? BRAZIER
      : spec.placement === 'around_boiler'
        ? BOILER
        : null;
  const found = anchorType === null ? null : firstTileOfType(grid, room.bounds, anchorType);
  // Hazard stripes mean nothing without the boiler they warn of; a scorch mark
  // with no brazier over it is where one used to stand, and lies free.
  if (anchorType === BOILER && found === null) return null;
  if (found !== null) {
    anchor = anchorType === BOILER ? boilerRect(found) : { x: found.x, y: found.y, w: 1, h: 1 };
    footprint = anchoredFootprint(anchor, room, doorTiles);
  }
  // A brazier too close to a doorway to scorch round still leaves its mark
  // somewhere else in the room.
  if (footprint === null && anchorType !== BOILER) {
    anchor = null;
    footprint = shrinkingFreeFootprint(room, spec, walkable, width, doorTiles, seed);
  }
  if (footprint === null || !rectInside(footprint, room.bounds)) return null;

  const centreX = anchor === null ? footprint.x + footprint.w / 2 : anchor.x + anchor.w / 2;
  const centreY = anchor === null ? footprint.y + footprint.h / 2 : anchor.y + anchor.h / 2;
  return {
    kind,
    region: room.id,
    footprint,
    centreX,
    centreY,
    halfWidth: footprint.w * BODY_SHARE,
    halfHeight: footprint.h * BODY_SHARE,
    outline: spec.liquid === null ? null : liquidOutline(footprint, spec.liquid, seed),
    anchor,
    seed,
  };
}

/**
 * Whether a tile of a feature's footprint is one the decal may paint: any
 * tile in it but a wall. A prop standing on a feature has the feature painted
 * under it, so smashing the prop leaves the floor whole rather than a hole.
 */
export function featurePaintsTile(
  feature: PlacedFloorFeature,
  grid: TileContent[][],
  x: number,
  y: number,
): boolean {
  const { footprint } = feature;
  if (x < footprint.x || y < footprint.y) return false;
  if (x >= footprint.x + footprint.w || y >= footprint.y + footprint.h) return false;
  return !wallAt(grid, x, y);
}

// ── Liquids ─────────────────────────────────────────────────────────────────

/** A liquid's field at its outline. */
export const LIQUID_EDGE_FIELD = 0.5;
/**
 * A liquid's field at its middle. Well above the edge's, so the deeper middle
 * the painters shade has room to grade in.
 */
const LIQUID_PEAK_FIELD = 1.6;
/** How sharply the field falls off across the outline: chosen so it is exactly the edge field there. */
const OUTLINE_FALLOFF = Math.log(LIQUID_PEAK_FIELD / LIQUID_EDGE_FIELD);
/** Distance from a footprint's edge, in tiles, over which every decal fades out. */
export const FOOTPRINT_FADE_TILES = 0.7;

/** Fades a decal to nothing at its footprint's edge, so it never ends on a tile boundary. */
export function footprintWindow(feature: PlacedFloorFeature, wx: number, wy: number): number {
  const { footprint } = feature;
  const inset = Math.min(
    wx - footprint.x,
    wy - footprint.y,
    footprint.x + footprint.w - wx,
    footprint.y + footprint.h - wy,
  );
  return smoothstep(0, FOOTPRINT_FADE_TILES, inset);
}

/**
 * A liquid's field at a point: {@link LIQUID_EDGE_FIELD} on its outline,
 * rising to its middle and falling away outside, faded at its footprint's
 * edge. Zero for a solid decal.
 */
export function liquidField(feature: PlacedFloorFeature, wx: number, wy: number): number {
  const outline = feature.outline;
  if (outline === null) return 0;
  const cos = Math.cos(outline.angle);
  const sin = Math.sin(outline.angle);
  const offX = wx - outline.x;
  const offY = wy - outline.y;
  const along = (offX * cos + offY * sin) / outline.radiusX;
  const across = (offY * cos - offX * sin) / outline.radiusY;
  const theta = Math.atan2(across, along);
  let rim = 1;
  for (const wobble of outline.wobbles) {
    rim += Math.sin(theta * wobble.frequency + wobble.phase) * wobble.amplitude;
  }
  const reach = Math.hypot(along, across) / rim;
  return (
    LIQUID_PEAK_FIELD *
    Math.exp(-reach * reach * OUTLINE_FALLOFF) *
    footprintWindow(feature, wx, wy)
  );
}

/** Features that leave standing water a light can glint on and a foot can ripple. */
export const WATER_FEATURES: ReadonlySet<FloorFeatureId> = new Set<FloorFeatureId>([
  'puddle',
  'drain_stain',
]);

// ── Hallway decals ──────────────────────────────────────────────────────────

/** A gutter channel along a tile's south side. */
export const GUTTER_SOUTH = 1;
/** A gutter channel along a tile's east side. */
export const GUTTER_EAST = 2;
/** A walk line from a tile's centre out through each side it continues across. */
export const WALK_LINE_NORTH = 4;
export const WALK_LINE_EAST = 8;
export const WALK_LINE_SOUTH = 16;
export const WALK_LINE_WEST = 32;

/**
 * Tiles a hallway segment must hold before it gets a walk line. A line down a
 * three-tile stub between two doorways is a road marking to nowhere.
 */
export const WALK_LINE_MIN_TILES = 12;
/** Tiles a straight stretch of walk line must run before it is painted at all. */
const WALK_LINE_MIN_RUN = 3;

function wallAt(grid: TileContent[][], x: number, y: number): boolean {
  if (y < 0 || y >= grid.length) return false;
  const row = grid[y];
  if (x < 0 || x >= row.length) return false;
  return row[x].type === FloorTypeValue.wall;
}

/**
 * Lays a gutter down one side of a hallway segment: the south side of a run
 * that mostly goes east–west, the east side of one that mostly goes north–south.
 * The south and east are the sides the camera sees whole; a gutter at the foot
 * of a north wall would sit in its contact shadow.
 */
export function layGutter(
  grid: TileContent[][],
  tiles: ReadonlyArray<Point>,
  width: number,
  marks: Uint8Array,
): void {
  const southCount = tiles.filter((tile) => wallAt(grid, tile.x, tile.y + 1)).length;
  const eastCount = tiles.filter((tile) => wallAt(grid, tile.x + 1, tile.y)).length;
  const alongSouth = southCount >= eastCount;
  for (const tile of tiles) {
    const index = tile.y * width + tile.x;
    if (alongSouth && wallAt(grid, tile.x, tile.y + 1)) marks[index] |= GUTTER_SOUTH;
    if (!alongSouth && wallAt(grid, tile.x + 1, tile.y)) marks[index] |= GUTTER_EAST;
  }
}

const WALK_LINE_SIDES: ReadonlyArray<{ dx: number; dy: number; bit: number }> = [
  { dx: 0, dy: -1, bit: WALK_LINE_NORTH },
  { dx: 1, dy: 0, bit: WALK_LINE_EAST },
  { dx: 0, dy: 1, bit: WALK_LINE_SOUTH },
  { dx: -1, dy: 0, bit: WALK_LINE_WEST },
];

/** Length of the unbroken run of `kept` tiles through (x, y), stepping by (dx, dy). */
function runLength(
  kept: ReadonlySet<number>,
  x: number,
  y: number,
  dx: number,
  dy: number,
  width: number,
): number {
  let length = 1;
  for (const sign of [1, -1]) {
    let step = 1;
    while (kept.has((y + dy * sign * step) * width + (x + dx * sign * step))) {
      length++;
      step++;
    }
  }
  return length;
}

/**
 * The tiles of a segment's centre line that carry its walk line: one line per
 * run, however wide.
 *
 * A corridor an even number of tiles wide has two centre rows, equally far
 * from either wall. Joining every centre tile to every other would paint two
 * parallel lines with a rung across every tile, so of each such pair only the
 * north row of an east–west run, and the west column of a north–south one, is
 * kept. Where two runs meet at a bend a two-by-two knot can survive that; its
 * south-east tile goes, which leaves the bend a clean corner.
 */
function walkLineTiles(
  tiles: ReadonlyArray<Point>,
  ridges: Uint8Array,
  width: number,
): Set<number> {
  const centre = new Set<number>();
  for (const tile of tiles) {
    const index = tile.y * width + tile.x;
    if (ridges[index] === 1) centre.add(index);
  }
  const runsEastWest = (x: number, y: number): boolean =>
    runLength(centre, x, y, 1, 0, width) > runLength(centre, x, y, 0, 1, width);
  const runsNorthSouth = (x: number, y: number): boolean =>
    runLength(centre, x, y, 0, 1, width) > runLength(centre, x, y, 1, 0, width);

  const kept = new Set<number>();
  for (const index of centre) {
    const x = index % width;
    const y = Math.floor(index / width);
    const northTwin = runsEastWest(x, y) && centre.has(index - width) && runsEastWest(x, y - 1);
    const westTwin = runsNorthSouth(x, y) && centre.has(index - 1) && runsNorthSouth(x - 1, y);
    if (!northTwin && !westTwin) kept.add(index);
  }
  for (const index of [...kept].sort((a, b) => a - b)) {
    const knot = kept.has(index - 1) && kept.has(index - width) && kept.has(index - width - 1);
    if (knot) kept.delete(index);
  }
  // Where a wide junction's centre wanders in a staircase, a line through it
  // zig-zags tile by tile; only tiles on a straight run of some length, or at
  // the corner where two such runs meet, carry paint.
  const straight = new Set<number>();
  for (const index of kept) {
    const x = index % width;
    const y = Math.floor(index / width);
    const eastWest = runLength(kept, x, y, 1, 0, width);
    const northSouth = runLength(kept, x, y, 0, 1, width);
    if (Math.max(eastWest, northSouth) >= WALK_LINE_MIN_RUN) straight.add(index);
  }
  return straight;
}

/**
 * Lays a walk line down a segment's centre line, joining each line tile to
 * every line neighbour so the line runs on through bends and junctions. A
 * line tile with no line neighbour gets none.
 */
export function layWalkLine(
  tiles: ReadonlyArray<Point>,
  ridges: Uint8Array,
  width: number,
  height: number,
  marks: Uint8Array,
): void {
  const line = walkLineTiles(tiles, ridges, width);
  for (const index of line) {
    const x = index % width;
    const y = Math.floor(index / width);
    for (const side of WALK_LINE_SIDES) {
      const nx = x + side.dx;
      const ny = y + side.dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (line.has(ny * width + nx)) marks[index] |= side.bit;
    }
  }
}
