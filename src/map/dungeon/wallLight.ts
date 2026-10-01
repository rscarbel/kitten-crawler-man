/**
 * How much light reaches each point of a dungeon wall's top: full at the edge of
 * what the player can see, dying away into black with distance from it.
 *
 * "What the player can see" is every open tile, plus the face standing above any
 * open tile that has wall to its north — the face rises a little under two tiles
 * up the screen, and the wall top begins at its cap, so light is measured from the
 * cap rather than from the foot of the face. The light also gives out toward the
 * edge of the map, so a wall top never runs lit into the end of the world.
 *
 * Distance is a smooth minimum over every lit rectangle in reach rather than the
 * plain nearest one. The plain minimum folds where two rooms' light meets, and a
 * fold in a field the eye reads as brightness shows as a dark ridge drawn midway
 * between the rooms; the smooth minimum rounds the fold away.
 *
 * A tile's light is sampled on a fixed grid of world points. Points on a shared
 * tile edge are the same world points for both tiles, so the darkness is seamless
 * across tile and chunk boundaries while each tile still paints only inside itself.
 *
 * Built once per tile per map and remembered, so a chunk that is evicted and
 * re-baked costs nothing here. Nothing on floors 1 or 2 turns a wall into floor or
 * back at runtime; a system that ever does must call {@link forgetWallLight}.
 *
 * Pure geometry, no canvas: the painter and the wall gate read the same numbers.
 */

import type { TileContent } from '../tileTypes';
import { isDrawnWall, isWallClosed } from './wallShape';

/**
 * Distance, in tiles, over which a wall top falls from lit to pure black. Far
 * enough that the dark reads as the light giving out rather than as an outline
 * drawn round the rooms; near enough that most of the rock between rooms is still
 * the black of the unexplored map.
 */
export const WALL_FADE_TILES = 3;

/**
 * How far a full face rises above the floor it stands on, in tiles, to the top
 * of its cap. A one-tile-thick wall's face is squeezed into the one tile.
 */
export const WALL_FACE_RISE_TILES = 1.72;
const COMPRESSED_FACE_RISE_TILES = 1;

/** Light samples per tile edge, corners included. Four steps of a quarter tile. */
export const WALL_LIGHT_SAMPLES = 5;
const SAMPLE_STEP = 1 / (WALL_LIGHT_SAMPLES - 1);

/** Tiles searched around a wall tile: the fade distance plus the rise of a face. */
const SEARCH_RADIUS = Math.ceil(WALL_FADE_TILES + WALL_FACE_RISE_TILES);

/**
 * How soft the smooth minimum is, in tiles. Big enough to round the fold between
 * two rooms' light; small enough that a long wall of lit tiles, all counted
 * together, brightens the top beside it by only a fraction of a tile.
 */
const SOFT_MIN_TILES = 0.3;

/** Tiles in from the edge of the map over which the light gives out entirely. */
const MAP_EDGE_FADE_TILES = 2;

interface LitRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** Per map: which tiles are open, where each one's light starts, and every tile's light once worked out. */
interface MapLight {
  readonly width: number;
  readonly height: number;
  /** 1 for an open tile. */
  readonly open: Uint8Array;
  /** For an open tile, the top of its lit rectangle: the cap of the face above it, if any. */
  readonly litTop: Float32Array;
  readonly tiles: Map<number, Float32Array | null>;
}

const mapLights = new WeakMap<TileContent[][], MapLight>();

function riseAbove(structure: TileContent[][], ox: number, oy: number): number {
  if (!isWallClosed(structure, ox, oy - 1)) return 0;
  const hasUpperTile =
    isDrawnWall(structure, ox, oy - 1) &&
    isWallClosed(structure, ox, oy - 2) &&
    isDrawnWall(structure, ox, oy - 2);
  return hasUpperTile ? WALL_FACE_RISE_TILES : COMPRESSED_FACE_RISE_TILES;
}

function mapLightFor(structure: TileContent[][]): MapLight {
  const cached = mapLights.get(structure);
  if (cached !== undefined) return cached;
  const height = structure.length;
  const width = structure[0]?.length ?? 0;
  const open = new Uint8Array(width * height);
  const litTop = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isWallClosed(structure, x, y)) continue;
      open[y * width + x] = 1;
      litTop[y * width + x] = y - riseAbove(structure, x, y);
    }
  }
  const built: MapLight = { width, height, open, litTop, tiles: new Map() };
  mapLights.set(structure, built);
  return built;
}

/** Drops a map's remembered light, for a system that turns wall into floor or back. */
export function forgetWallLight(structure: TileContent[][]): void {
  mapLights.delete(structure);
}

function rectGap(rect: LitRect, x0: number, y0: number, x1: number, y1: number): number {
  const dx = Math.max(rect.x0 - x1, 0, x0 - rect.x1);
  const dy = Math.max(rect.y0 - y1, 0, y0 - rect.y1);
  return Math.hypot(dx, dy);
}

/**
 * Darkness, 0 lit to 1 black, at a distance from lit space. A cosine ease: it
 * leaves the light near the edge almost untouched, falls fastest in the middle and
 * settles into black without a visible end, which reads as light giving out
 * rather than as a gradient band.
 */
export function wallDarknessAt(distance: number): number {
  const t = Math.min(1, Math.max(0, distance / WALL_FADE_TILES));
  return (1 - Math.cos(Math.PI * t)) / 2;
}

function computeTileLight(light: MapLight, tx: number, ty: number): Float32Array | null {
  const { width, height, open, litTop } = light;
  // Open tiles are gathered as runs along each row, and runs stacked with the
  // same span are joined, so a room is a few rectangles rather than one per tile:
  // cheaper to sample, and the smooth minimum counts a room once, not per tile.
  const rows: LitRect[] = [];
  for (let oy = ty - SEARCH_RADIUS; oy <= ty + SEARCH_RADIUS + 1; oy++) {
    if (oy < 0 || oy >= height) continue;
    let runStart = -1;
    let runTop = 0;
    for (let ox = tx - SEARCH_RADIUS; ox <= tx + SEARCH_RADIUS + 1; ox++) {
      const inside = ox >= 0 && ox < width && ox <= tx + SEARCH_RADIUS;
      const index = oy * width + ox;
      const isOpen = inside && open[index] === 1;
      const top = isOpen ? litTop[index] : 0;
      if (runStart >= 0 && (!isOpen || top !== runTop)) {
        rows.push({ x0: runStart, y0: runTop, x1: ox, y1: oy + 1 });
        runStart = -1;
      }
      if (isOpen && runStart < 0) {
        runStart = ox;
        runTop = top;
      }
    }
  }
  const rects: LitRect[] = [];
  for (const row of rows) {
    const above = rects.find(
      (rect) =>
        rect.x0 === row.x0 && rect.x1 === row.x1 && rect.y1 === row.y1 - 1 && row.y0 === row.y1 - 1,
    );
    if (above !== undefined) {
      rects[rects.indexOf(above)] = { ...above, y1: row.y1 };
      continue;
    }
    if (rectGap(row, tx, ty, tx + 1, ty + 1) < WALL_FADE_TILES) rects.push(row);
  }
  if (rects.length === 0) return null;

  const samples = new Float32Array(WALL_LIGHT_SAMPLES * WALL_LIGHT_SAMPLES);
  let anyLit = false;
  for (let j = 0; j < WALL_LIGHT_SAMPLES; j++) {
    for (let i = 0; i < WALL_LIGHT_SAMPLES; i++) {
      const px = tx + i * SAMPLE_STEP;
      const py = ty + j * SAMPLE_STEP;
      let weight = 0;
      for (const rect of rects) {
        const dx = Math.max(rect.x0 - px, 0, px - rect.x1);
        const dy = Math.max(rect.y0 - py, 0, py - rect.y1);
        weight += Math.exp(-Math.hypot(dx, dy) / SOFT_MIN_TILES);
      }
      // The smooth minimum can reach below zero where many rectangles crowd in;
      // inside lit space the distance is simply zero.
      const fromLight = Math.max(0, -SOFT_MIN_TILES * Math.log(weight));
      const toEdge = Math.min(px, py, width - px, height - py);
      const edgeDark = WALL_FADE_TILES * (1 - Math.min(1, toEdge / MAP_EDGE_FADE_TILES));
      const distance = Math.min(WALL_FADE_TILES, Math.max(fromLight, edgeDark));
      samples[j * WALL_LIGHT_SAMPLES + i] = distance;
      if (distance < WALL_FADE_TILES) anyLit = true;
    }
  }
  return anyLit ? samples : null;
}

/**
 * Distance to lit space at each of the tile's sample points, row-major from its
 * north-west corner, each capped at the fade distance — or null for a tile wholly
 * beyond the light, which is drawn pure black.
 */
export function wallTileLight(
  structure: TileContent[][],
  tx: number,
  ty: number,
): Float32Array | null {
  const light = mapLightFor(structure);
  const key = ty * light.width + tx;
  const remembered = light.tiles.get(key);
  if (remembered !== undefined) return remembered;
  const computed = computeTileLight(light, tx, ty);
  light.tiles.set(key, computed);
  return computed;
}
