/**
 * Where each boss room's mood lights hang, and what they are.
 *
 * A boss room is never darkened: its fight was tuned in full light and plays
 * in it. These lights only add colour — a bare bulb over the Trash Gremlin's junk,
 * strip lights over the gym's mirror, the lab's monitors and its broken vat,
 * the shimmer off the pump room's flood.
 * One placement serves both the lighting pass, which adds the glow, and the
 * room's dressing, which paints the fixture the glow comes from. The shimmer
 * has no fixture: the flood itself throws it.
 */

import { TILE_SIZE } from '../../core/constants';
import type { GymLayout } from '../../map/tiles/bossRooms/gymLayout';
import type { LightKind } from '../lighting/lightKinds';
import type { PowerLabLayout } from './powerLabLayout';
import type { TilePoint, TileRect } from './bossRoomLayout';
import type { TileContent } from '../../map/tileTypes';
import { dungeonWaterRevision } from '../../map/tiles/dungeonWaterColumn';

const HALF = 0.5;

/** A mood light as the lighting pass takes it. */
export interface BossRoomMoodLight {
  readonly tileX: number;
  readonly tileY: number;
  readonly kind: LightKind;
  /** Where the pool falls, in world pixels. */
  readonly centre: { readonly x: number; readonly y: number };
  /**
   * Whether what throws the light is still there, read every frame: the
   * light fades out when it turns false and comes back when it turns true.
   * Absent for a light that never goes out.
   */
  readonly powered?: () => boolean;
}

/** What a mood light can be handed to: the lighting pass's mood-light registration. */
export interface MoodLightSink {
  registerMoodLight(light: BossRoomMoodLight): boolean;
}

function tileCentrePx(tile: TilePoint): { x: number; y: number } {
  return { x: (tile.x + HALF) * TILE_SIZE, y: (tile.y + HALF) * TILE_SIZE };
}

// ── The Trash Gremlin's bulb ──────────────────────────────────────────────────────

/** How high over the floor the bulb hangs; it is drawn this far up the screen from its pool. */
const BULB_HANG_TILES = 1.6;

/** The Trash Gremlin's single bare bulb over the middle of its room. */
export interface HangingBulb {
  readonly light: BossRoomMoodLight;
  /** The bulb's glass, in world pixels. */
  readonly bulbX: number;
  readonly bulbY: number;
}

export function trashGremlinBulb(bounds: TileRect): HangingBulb {
  const tile = { x: bounds.x + Math.floor(bounds.w / 2), y: bounds.y + Math.floor(bounds.h / 2) };
  const centre = tileCentrePx(tile);
  return {
    light: { tileX: tile.x, tileY: tile.y, kind: 'hanging_bulb', centre },
    bulbX: centre.x,
    bulbY: centre.y - BULB_HANG_TILES * TILE_SIZE,
  };
}

// ── The gym's strip lights ──────────────────────────────────────────────────

/** Where along the mirror the strips hang, as shares of its length: a quarter in from each end. */
const WEST_STRIP_SHARE = 0.25;
const EAST_STRIP_SHARE = 0.75;
const STRIP_SHARES: readonly number[] = [WEST_STRIP_SHARE, EAST_STRIP_SHARE];
const STRIP_WIDTH_TILES = 1.6;
/** How far above the top of the mirror's tile row the strip's housing sits: on the brick above the glass. */
const STRIP_ABOVE_MIRROR_PX = 9;
/** How far into the room from the wall the strip's pool falls. */
const STRIP_POOL_DEPTH_TILES = 1.5;
/**
 * The tall equipment against the north wall rises over the brick a strip
 * hangs on; a strip keeps this many tiles clear of any of it, either side.
 */
const STRIP_CLEAR_OF_EQUIPMENT_TILES = 2;
/** Equipment standing this close to the north wall reaches up over its face. */
const NORTH_WALL_EQUIPMENT_ROWS = 2;

/** A fluorescent strip on the gym's north wall face. */
export interface StripLight {
  readonly light: BossRoomMoodLight;
  /** The housing's top-left corner, in world pixels. */
  readonly x: number;
  readonly y: number;
  readonly widthPx: number;
}

export function gymStripLights(layout: GymLayout): StripLight[] {
  const run = layout.mirror.tiles;
  if (run.length === 0 || layout.mirror.alongY) return [];
  const againstNorthWall = [...layout.racks, ...layout.squatRacks, ...layout.cableStacks].filter(
    (piece) => piece.y < layout.bounds.y + NORTH_WALL_EQUIPMENT_ROWS,
  );
  const used = new Set<number>();
  const isClear = (index: number): boolean =>
    !used.has(index) &&
    againstNorthWall.every(
      (piece) => Math.abs(piece.x - run[index].x) >= STRIP_CLEAR_OF_EQUIPMENT_TILES,
    );
  const strips: StripLight[] = [];
  for (const share of STRIP_SHARES) {
    const preferred = Math.min(run.length - 1, Math.floor(run.length * share));
    const index = nearestIndex(preferred, run.length, isClear) ?? preferred;
    if (used.has(index)) continue;
    used.add(index);
    const tile = run[index];
    const widthPx = STRIP_WIDTH_TILES * TILE_SIZE;
    const middleX = (tile.x + HALF) * TILE_SIZE;
    strips.push({
      light: {
        tileX: tile.x,
        tileY: tile.y,
        kind: 'strip_light',
        centre: { x: middleX, y: (tile.y + HALF + STRIP_POOL_DEPTH_TILES) * TILE_SIZE },
      },
      x: middleX - widthPx * HALF,
      y: tile.y * TILE_SIZE - STRIP_ABOVE_MIRROR_PX,
      widthPx,
    });
  }
  return strips;
}

/** The index nearest `preferred` that passes `accept`, searching out both ways; null when none does. */
function nearestIndex(
  preferred: number,
  length: number,
  accept: (index: number) => boolean,
): number | null {
  for (let step = 0; step < length; step++) {
    for (const index of [preferred + step, preferred - step]) {
      if (index >= 0 && index < length && accept(index)) return index;
    }
  }
  return null;
}

// ── The power lab ───────────────────────────────────────────────────────────

/**
 * The lab's glows: each console's screen, and the broken vat bed in the
 * middle, which still gives off the specimen fluid's pink. The lab already
 * draws every one of these things.
 */
export function powerLabMoodLights(layout: PowerLabLayout): BossRoomMoodLight[] {
  const lights: BossRoomMoodLight[] = layout.consoles.map((tile) => ({
    tileX: tile.x,
    tileY: tile.y,
    kind: 'monitor_glow',
    centre: tileCentrePx(tile),
  }));
  lights.push({
    tileX: layout.centre.x,
    tileY: layout.centre.y,
    kind: 'vat_glow',
    centre: tileCentrePx(layout.centre),
  });
  return lights;
}

// ── The flooded pump room ───────────────────────────────────────────────────

/**
 * Where the shimmer pools fall, as shares of the room's width and height: the
 * middle and a quarter in from each corner, so the cold sway is spread over
 * the whole flood without one pool standing out.
 */
const FLOOD_SHIMMER_NEAR_SHARE = 0.25;
const FLOOD_SHIMMER_FAR_SHARE = 0.75;
const FLOOD_SHIMMER_SHARES: ReadonlyArray<readonly [number, number]> = [
  [HALF, HALF],
  [FLOOD_SHIMMER_NEAR_SHARE, FLOOD_SHIMMER_NEAR_SHARE],
  [FLOOD_SHIMMER_FAR_SHARE, FLOOD_SHIMMER_NEAR_SHARE],
  [FLOOD_SHIMMER_NEAR_SHARE, FLOOD_SHIMMER_FAR_SHARE],
  [FLOOD_SHIMMER_FAR_SHARE, FLOOD_SHIMMER_FAR_SHARE],
];

/** What the shimmer reads the flood off: the map's standing water. */
export interface StandingWater {
  readonly structure: TileContent[][];
  dungeonWaterDepthAt(tileX: number, tileY: number): number;
}

/**
 * Whether any tile of `bounds` still holds water. The answer is kept until
 * the map's water next moves, since every light in the room asks every frame
 * and a drained room would otherwise be read through each time.
 */
function roomHoldsWater(water: StandingWater, bounds: TileRect): () => boolean {
  let answered: {
    readonly structure: TileContent[][];
    readonly revision: number;
    readonly wet: boolean;
  } | null = null;
  return () => {
    const structure = water.structure;
    const revision = dungeonWaterRevision(structure);
    const stillCurrent =
      answered !== null && answered.structure === structure && answered.revision === revision;
    if (answered !== null && stillCurrent) return answered.wet;
    const wet = anyTileWet(water, bounds);
    answered = { structure, revision, wet };
    return wet;
  };
}

function anyTileWet(water: StandingWater, bounds: TileRect): boolean {
  for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
    for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
      if (water.dungeonWaterDepthAt(x, y) > 0) return true;
    }
  }
  return false;
}

/**
 * The pump room's glows: light thrown back off the flood, fading once the
 * room drains and back whenever a restore floods it again. Placed from the
 * room's bounds alone, since the water fills the whole floor and nothing in
 * the room's layout decides where it shines.
 */
export function floodedPumpRoomMoodLights(
  bounds: TileRect,
  water: StandingWater,
): BossRoomMoodLight[] {
  const powered = roomHoldsWater(water, bounds);
  return FLOOD_SHIMMER_SHARES.map(([alongX, alongY]) => {
    const tile = {
      x: bounds.x + Math.floor(bounds.w * alongX),
      y: bounds.y + Math.floor(bounds.h * alongY),
    };
    return {
      tileX: tile.x,
      tileY: tile.y,
      kind: 'flood_shimmer',
      centre: tileCentrePx(tile),
      powered,
    };
  });
}
