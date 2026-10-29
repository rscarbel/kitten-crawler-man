/**
 * The water over a flooded dungeon floor: a column laid over the floor it
 * drowned, darkening with depth and opaque past the shallowest step. The chop
 * that moves on it is `dungeonWaterSurface.ts`, drawn per frame on top.
 *
 * The same construction as the river's column (`riverWaterColumn.ts`): one
 * sample per tile in a small map-sized image, upscaled by the canvas so depth
 * runs continuously across tiles, each tile taking a source rect wide enough
 * that the filter never meets its clamped edge and clipping to its own square,
 * so a tile drawn alone matches the same tile in its chunk's bake. Only the
 * tints differ — they come from the floor's `DungeonWaterPlan` — and the bed is
 * the floor itself rather than silt.
 *
 * Unlike the river, dungeon water drains, so the samples carry a revision: a
 * map that changes any water depth calls {@link invalidateDungeonWaterColumn},
 * and the next draw rebuilds them.
 */

import {
  allocCanvas,
  releaseSurface,
  surfaceContext,
  type CanvasSurface,
} from '../../core/rendering/canvasSurface';
import { canvasGeneration } from '../../core/rendering/canvasRecovery';
import {
  FloorTypeValue,
  isDungeonWater,
  MAX_WATER_DEPTH,
  VOID_TYPE,
  type TileContent,
} from '../tileTypes';
import { dungeonFloorTheme, type DungeonFloorThemeId } from '../dungeon/floorTheme';
import {
  DUNGEON_WATER_PLANS,
  type DungeonWaterPlan,
  type WaterColumnTint,
} from '../../sprites/sheets/dungeonWaterSheets';
import { hashLattice } from '../tilegen/noise';
import { dungeonWaterDepth } from '../dungeonWater';
import { releaseDungeonWaterSurface, warmDungeonWaterSurface } from './dungeonWaterSurface';

/** Samples a smoothed upscale reads either side of a position: a cubic filter reaches two. */
const FILTER_REACH_SAMPLES = 2;
/** Samples beyond the map on every side, copied from its edge, so no tile's source rect leaves the image. */
const MARGIN_SAMPLES = FILTER_REACH_SAMPLES;
/** The tile's own sample plus the filter's reach either side of it. */
const SOURCE_SPAN_SAMPLES = 1 + FILTER_REACH_SAMPLES * 2;
/** How far from a wall or a float the water's depth is carried into its sample. */
const CARRIED_DEPTH_REACH_TILES = FILTER_REACH_SAMPLES;
/**
 * How many tiles away a change in depth still shows in a tile's own column:
 * the filter reads samples beside the tile, and a wall's or a float's sample
 * carries the depth of water further out.
 */
export const DUNGEON_WATER_COLUMN_REACH_TILES = FILTER_REACH_SAMPLES + CARRIED_DEPTH_REACH_TILES;

const RGBA_CHANNELS = 4;
const RED = 0;
const GREEN = 1;
const BLUE = 2;
const ALPHA = 3;
const BYTE_MAX = 255;

/**
 * Each water tile's colour is lifted or dropped by up to this many levels, so
 * the smoothed column carries soft blotches of murk a tile or two across and a
 * wide stretch of deep water is not one flat tone under the chop.
 */
const MURK_MOTTLE_LEVELS = 7;
const MURK_MOTTLE_SEED = 4093;

interface BuiltColumn {
  /** Null on a map with no dungeon water. */
  readonly samples: CanvasSurface | null;
  readonly generation: number;
  readonly revision: number;
  readonly theme: DungeonFloorThemeId;
}

const built = new WeakMap<TileContent[][], BuiltColumn>();
const revisions = new WeakMap<TileContent[][], number>();

/** Bumped by {@link invalidateDungeonWaterColumn}: anything cached from the map's water depths is stale once it moves. */
export function dungeonWaterRevision(structure: TileContent[][]): number {
  return revisionOf(structure);
}

function revisionOf(structure: TileContent[][]): number {
  return revisions.get(structure) ?? 0;
}

/** Call after any water depth on `structure` changes, so its column is rebuilt before it is drawn again. */
export function invalidateDungeonWaterColumn(structure: TileContent[][]): void {
  revisions.set(structure, revisionOf(structure) + 1);
}

function depthOf(cell: TileContent): number {
  return Math.min(MAX_WATER_DEPTH, Math.max(0, Math.round(dungeonWaterDepth(cell))));
}

/**
 * The deepest water within the filter's reach of a wall or a float, or null
 * with none that close. Water runs right up to a wall and under a float, so
 * either carries the water's depth on rather than thinning it like a dry
 * floor edge would.
 */
function depthCarriedInto(structure: TileContent[][], tx: number, ty: number): number | null {
  for (let ring = 1; ring <= CARRIED_DEPTH_REACH_TILES; ring++) {
    let deepest: number | null = null;
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const neighbour = structure[ty + dy]?.[tx + dx];
        if (!isDungeonWater(neighbour)) continue;
        const depth = depthOf(neighbour);
        deepest = deepest === null ? depth : Math.max(deepest, depth);
      }
    }
    if (deepest !== null) return deepest;
  }
  return null;
}

function columnAt(
  plan: DungeonWaterPlan,
  structure: TileContent[][],
  tx: number,
  ty: number,
): WaterColumnTint {
  const cell = structure[ty][tx];
  if (isDungeonWater(cell)) return mottled(plan.byDepth[depthOf(cell)], tx, ty);
  const isSolid = cell.type === FloorTypeValue.wall || cell.type === VOID_TYPE;
  if (isSolid || cell.underFloat === true) {
    const carried = depthCarriedInto(structure, tx, ty);
    if (carried !== null) return plan.byDepth[carried];
  }
  return plan.dryEdge;
}

function mottled(tint: WaterColumnTint, tx: number, ty: number): WaterColumnTint {
  const shift = (hashLattice(tx, ty, MURK_MOTTLE_SEED) * 2 - 1) * MURK_MOTTLE_LEVELS;
  return { r: tint.r + shift, g: tint.g + shift, b: tint.b + shift, opacity: tint.opacity };
}

function clampTo(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

function buildSamples(structure: TileContent[][], plan: DungeonWaterPlan): CanvasSurface | null {
  const rows = structure.length;
  const cols = structure[0]?.length ?? rows;
  if (rows === 0 || cols === 0) return null;
  if (!structure.some((row) => row.some((cell) => isDungeonWater(cell)))) return null;

  const spanX = cols + MARGIN_SAMPLES * 2;
  const spanY = rows + MARGIN_SAMPLES * 2;
  const rgba = new Uint8ClampedArray(spanX * spanY * RGBA_CHANNELS);
  for (let j = 0; j < spanY; j++) {
    const ty = clampTo(j - MARGIN_SAMPLES, 0, rows - 1);
    for (let i = 0; i < spanX; i++) {
      const tx = clampTo(i - MARGIN_SAMPLES, 0, cols - 1);
      const tint = columnAt(plan, structure, tx, ty);
      const at = (j * spanX + i) * RGBA_CHANNELS;
      rgba[at + RED] = tint.r;
      rgba[at + GREEN] = tint.g;
      rgba[at + BLUE] = tint.b;
      rgba[at + ALPHA] = Math.round(tint.opacity * BYTE_MAX);
    }
  }
  const samples = allocCanvas('groundTileParts', spanX, spanY);
  const samplesCtx = surfaceContext(samples);
  const image = samplesCtx.createImageData(spanX, spanY);
  image.data.set(rgba);
  samplesCtx.putImageData(image, 0, 0);
  return samples;
}

function samplesFor(structure: TileContent[][]): CanvasSurface | null {
  const generation = canvasGeneration();
  const revision = revisionOf(structure);
  const theme = dungeonFloorTheme().id;
  const existing = built.get(structure);
  if (
    existing?.generation === generation &&
    existing.revision === revision &&
    existing.theme === theme
  ) {
    return existing.samples;
  }
  const staleSamples = existing?.samples ?? null;
  if (staleSamples !== null) releaseSurface(staleSamples);
  const samples = buildSamples(structure, DUNGEON_WATER_PLANS[theme]);
  built.set(structure, { samples, generation, revision, theme });
  return samples;
}

/**
 * Builds the map's depth samples and paints its moving surface ahead of its
 * first bake, so neither one-off cost is charged to a timed chunk bake or the
 * first frames in the water. A map with no dungeon water gives the surface back.
 */
export function warmDungeonWaterColumn(structure: TileContent[][]): void {
  if (samplesFor(structure) === null) releaseDungeonWaterSurface();
  else warmDungeonWaterSurface();
}

/**
 * Lays the water over the floor already drawn in the dungeon water tile at
 * (tx, ty), clipped to that tile.
 */
export function drawDungeonWaterColumn(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const samples = samplesFor(structure);
  if (samples === null) return;
  const firstSampleX = tx + MARGIN_SAMPLES - FILTER_REACH_SAMPLES;
  const firstSampleY = ty + MARGIN_SAMPLES - FILTER_REACH_SAMPLES;
  const destX = sx + (firstSampleX - MARGIN_SAMPLES - tx) * ts;
  const destY = sy + (firstSampleY - MARGIN_SAMPLES - ty) * ts;
  ctx.save();
  ctx.beginPath();
  ctx.rect(sx, sy, ts, ts);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    samples,
    firstSampleX,
    firstSampleY,
    SOURCE_SPAN_SAMPLES,
    SOURCE_SPAN_SAMPLES,
    destX,
    destY,
    SOURCE_SPAN_SAMPLES * ts,
    SOURCE_SPAN_SAMPLES * ts,
  );
  ctx.restore();
}
