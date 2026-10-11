/**
 * Draws the overworld's macro field over a ground tile.
 *
 * The field is one sample per tile corner, and it is upscaled by the canvas
 * rather than evaluated per pixel. A tile must not take a tile-sized source
 * rect of the small image: the upscale clamps at the source rect's edges,
 * which seams every tile. So each tile upscales a few samples either side of
 * its own, enough that the filter never reaches the source rect's edge inside
 * the tile, and clips the result to its square. What a tile draws depends on
 * nothing but the tile, so a tile drawn alone — re-baked, or as an overlay
 * entry — comes out identical to the same tile in its chunk's bake.
 */

import { allocCanvas, surfaceContext, type CanvasSurface } from '../../core/canvasSurface';
import { floorArtSubSeed, GROUND_TONE_SALT } from '../ground/floorArtSeed';
import {
  buildMacroField,
  MACRO_MARGIN_SAMPLES,
  type LevelTileMap,
  type MacroField,
} from '../overworld/macroField';
import { BRIDGE, CLIFF, FloorTypeValue, isRiverChannel, type TileContent } from '../tileTypes';
import { CHUNK_TILES } from './chunkTiles';
import { overworldTerrainFor } from './overworldTerrainRegistry';

/**
 * Samples a smoothed upscale reads either side of the position it shades: a
 * cubic filter reaches two. Taking this many beyond the tile's own corners
 * keeps every tap inside the source rect, so its clamped edge is never seen.
 */
const FILTER_REACH_SAMPLES = 2;
/** The tile's own two corners per axis, plus the filter's reach either side of them. */
const TILE_CORNER_SAMPLES = 2;
const SOURCE_SPAN_SAMPLES = TILE_CORNER_SAMPLES + FILTER_REACH_SAMPLES * 2;
/** A scaled `drawImage` centres each texel half a texel into its destination cell. */
const HALF_TEXEL = 0.5;

/** What the bake keeps of a map's macro field: the uploaded samples and which tiles are level. */
interface BuiltMacro {
  readonly toneSeed: number;
  readonly samples: CanvasSurface;
  readonly levelTiles: LevelTileMap;
}

const built = new WeakMap<TileContent[][], BuiltMacro>();

/** The macro field for an overworld map, built once per map and tone seed and kept for the map's life. */
function macroFor(
  structure: TileContent[][],
  periodicToneAt: (cornerX: number, cornerY: number) => number,
): BuiltMacro | undefined {
  const toneSeed = floorArtSubSeed(GROUND_TONE_SALT);
  const existing = built.get(structure);
  if (existing?.toneSeed === toneSeed) return existing;
  if (existing !== undefined) releaseSurface(existing.samples);

  const field = buildOverworldMacroField(structure, periodicToneAt);
  if (field === undefined) return undefined;
  const macro: BuiltMacro = {
    toneSeed,
    samples: uploadSamples(field),
    levelTiles: field.levelTiles,
  };
  built.set(structure, macro);
  return macro;
}

function uploadSamples(field: MacroField): CanvasSurface {
  const samples = allocCanvas(field.spanX, field.spanY);
  const samplesCtx = surfaceContext(samples);
  const image = samplesCtx.createImageData(field.spanX, field.spanY);
  image.data.set(field.rgba);
  samplesCtx.putImageData(image, 0, 0);
  return samples;
}

function releaseSurface(surface: CanvasSurface): void {
  surface.width = 0;
  surface.height = 0;
}

/**
 * Builds the overworld map's macro field now rather than on its first ground
 * tile, so its one-off cost is not charged to the first timed chunk bake. Call
 * once the floor's art seed is set; a no-op off the overworld or when built.
 */
export function warmOverworldMacroTone(
  structure: TileContent[][],
  periodicToneAt: (cornerX: number, cornerY: number) => number,
): void {
  macroFor(structure, periodicToneAt);
}

/**
 * Lays the macro field over the tile at (tx, ty) and returns true, or returns
 * false — drawing nothing — where the caller's own tone applies instead: off
 * the overworld, and on a tile that is level ground on all four corners, which
 * takes the floor's periodic tone.
 */
export function drawOverworldMacroTone(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
  periodicToneAt: (cornerX: number, cornerY: number) => number,
): boolean {
  const macro = macroFor(structure, periodicToneAt);
  if (macro === undefined || macro.levelTiles.isLevel(tx, ty)) return false;
  const { samples } = macro;
  // Sample `corner + margin` holds that corner, and its texel centre lands on
  // the corner's pixel.
  const firstSampleX = clampTo(
    tx + MACRO_MARGIN_SAMPLES - FILTER_REACH_SAMPLES,
    0,
    samples.width - 1,
  );
  const firstSampleY = clampTo(
    ty + MACRO_MARGIN_SAMPLES - FILTER_REACH_SAMPLES,
    0,
    samples.height - 1,
  );
  const spanX = Math.min(SOURCE_SPAN_SAMPLES, samples.width - firstSampleX);
  const spanY = Math.min(SOURCE_SPAN_SAMPLES, samples.height - firstSampleY);
  const destX = sx + (firstSampleX - MACRO_MARGIN_SAMPLES - tx - HALF_TEXEL) * ts;
  const destY = sy + (firstSampleY - MACRO_MARGIN_SAMPLES - ty - HALF_TEXEL) * ts;
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
    spanX,
    spanY,
    destX,
    destY,
    spanX * ts,
    spanY * ts,
  );
  ctx.restore();
  return true;
}

function clampTo(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/**
 * Builds the macro field the bake lays over the overworld map `structure`, or
 * undefined off the overworld. Pure, so a gate can check exactly what the bake
 * would draw without a canvas.
 */
export function buildOverworldMacroField(
  structure: TileContent[][],
  periodicToneAt: (cornerX: number, cornerY: number) => number,
): MacroField | undefined {
  const terrain = overworldTerrainFor(structure);
  if (terrain === undefined) return undefined;
  const rows = structure.length;
  const cols = structure[0]?.length ?? rows;
  return buildMacroField({
    terrain,
    cols,
    rows,
    coverCols: Math.ceil(cols / CHUNK_TILES) * CHUNK_TILES,
    coverRows: Math.ceil(rows / CHUNK_TILES) * CHUNK_TILES,
    toneSeed: floorArtSubSeed(GROUND_TONE_SALT),
    periodicToneAt,
    isWater: (tx, ty) => {
      const type = structure[ty]?.[tx]?.type;
      return type === FloorTypeValue.water || type === BRIDGE;
    },
    isChannel: (tx, ty) => isRiverChannel(structure[ty]?.[tx]),
    isLowland: (tx, ty) =>
      structure[ty]?.[tx]?.type === FloorTypeValue.grass ||
      structure[ty]?.[tx]?.groundType === FloorTypeValue.grass,
    isLedge: (tx, ty) => structure[ty]?.[tx]?.type === CLIFF,
  });
}
