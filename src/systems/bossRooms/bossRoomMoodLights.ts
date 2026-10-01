/**
 * Where each boss room's mood lights hang, and what they are.
 *
 * A boss room is never darkened: its fight was tuned in full light and plays
 * in it. These lights only add colour — a bare bulb over the Hoarder's junk,
 * strip lights over the gym's mirror, the lab's monitors and its broken vat,
 * floodlights on the colosseum's rim. One placement serves both the lighting
 * pass, which adds the glow, and the room's dressing, which paints the fixture
 * where the glow comes from.
 */

import { TILE_SIZE } from '../../core/constants';
import { FloorTypeValue, type TileContent } from '../../map/tileTypes';
import type { GymLayout } from '../../map/tiles/bossRooms/gymLayout';
import { colosseumCapInnerRadius } from '../../map/tiles/bossRooms/colosseumGeometry';
import type { LightKind } from '../lighting/lightKinds';
import type { KrakarenLabLayout } from './krakarenLabLayout';
import type { TilePoint, TileRect } from './bossRoomLayout';

const HALF = 0.5;

/** A mood light as the lighting pass takes it. */
export interface BossRoomMoodLight {
  readonly tileX: number;
  readonly tileY: number;
  readonly kind: LightKind;
  /** Where the pool falls, in world pixels. */
  readonly centre: { readonly x: number; readonly y: number };
}

/** What a mood light can be handed to: the lighting pass's mood-light registration. */
export interface MoodLightSink {
  registerMoodLight(light: BossRoomMoodLight): boolean;
}

function tileCentrePx(tile: TilePoint): { x: number; y: number } {
  return { x: (tile.x + HALF) * TILE_SIZE, y: (tile.y + HALF) * TILE_SIZE };
}

// ── The Hoarder's bulb ──────────────────────────────────────────────────────

/** How high over the floor the bulb hangs; it is drawn this far up the screen from its pool. */
const BULB_HANG_TILES = 1.6;

/** The Hoarder's single bare bulb over the middle of her room. */
export interface HangingBulb {
  readonly light: BossRoomMoodLight;
  /** The bulb's glass, in world pixels. */
  readonly bulbX: number;
  readonly bulbY: number;
}

export function hoarderBulb(bounds: TileRect): HangingBulb {
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

// ── The clone lab ───────────────────────────────────────────────────────────

/**
 * The lab's glows: each console's screen, and the broken vat bed in the
 * middle, which still gives off the specimen fluid's pink. The lab already
 * draws every one of these things.
 */
export function krakarenMoodLights(layout: KrakarenLabLayout): BossRoomMoodLight[] {
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

// ── The colosseum's floodlights ─────────────────────────────────────────────

const DUE_NORTH = -Math.PI * HALF;
/**
 * Each lamp's bearing off due north: in the gap between the top pair of
 * cages and the nearer banners, where nothing else stands on the rim.
 */
const FLOOD_LAMP_SPREAD_RADIANS = 0.35;
/** How far onto the wall's top the lamp stands, past the inner face. */
const FLOOD_LAMP_ON_CAP_TILES = 0.3;
/** How far in from the lamp its light is thrown from, and where its pool falls. */
const FLOOD_EMITTER_IN_TILES = 2;
const FLOOD_POOL_IN_TILES = 5;

/** A floodlight on the colosseum's north rim. */
export interface FloodLamp {
  readonly light: BossRoomMoodLight;
  /** The housing, in world pixels. */
  readonly x: number;
  readonly y: number;
  /** Which way the lens faces, radians with y growing south. */
  readonly aim: number;
}

/** The floodlights over the colosseum whose sand is centred on `centre`. */
export function colosseumFloodLamps(
  centre: TilePoint,
  structure: ReadonlyArray<ReadonlyArray<TileContent>>,
): FloodLamp[] {
  const centrePx = tileCentrePx(centre);
  const lamps: FloodLamp[] = [];
  for (const side of [-1, 1]) {
    const bearing = DUE_NORTH + side * FLOOD_LAMP_SPREAD_RADIANS;
    const along = (tiles: number): { x: number; y: number } => ({
      x: centrePx.x + Math.cos(bearing) * tiles * TILE_SIZE,
      y: centrePx.y + Math.sin(bearing) * tiles * TILE_SIZE,
    });
    const lampRadius = colosseumCapInnerRadius(bearing) + FLOOD_LAMP_ON_CAP_TILES;
    const lamp = along(lampRadius);
    const emitter = along(lampRadius - FLOOD_EMITTER_IN_TILES);
    const tileX = Math.floor(emitter.x / TILE_SIZE);
    const tileY = Math.floor(emitter.y / TILE_SIZE);
    if (structure[tileY]?.[tileX]?.type === FloorTypeValue.wall) continue;
    lamps.push({
      light: { tileX, tileY, kind: 'flood_lamp', centre: along(lampRadius - FLOOD_POOL_IN_TILES) },
      x: lamp.x,
      y: lamp.y,
      aim: bearing + Math.PI,
    });
  }
  return lamps;
}
