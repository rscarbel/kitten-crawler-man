/**
 * The water over the river bed: a translucent column that thickens and darkens
 * with depth, and the bank's shade along the water's northern edge.
 *
 * The `water` ground material is the bed — silt, sand and pebbles — and this is
 * laid over it in the bake, before the bank's fringe is drawn over the edge.
 * Depth comes from each channel tile's recorded `waterDepth`, one sample per
 * tile centre in a small map-sized image, upscaled by the canvas so the depth
 * runs continuously across tiles rather than stepping at their edges: a pale,
 * green shallow margin over a clearly visible bed, darkening to a channel that
 * hides it.
 *
 * Like the macro tone, a tile takes a source rect wide enough that the
 * filter's reach never meets its clamped edge inside the tile, and clips the
 * result to its own square, so a tile drawn alone is identical to the same
 * tile in its chunk's bake.
 *
 * Nothing changes which tiles are water once a map is generated, so the image
 * is built once per map and never invalidated.
 */

import { allocCanvas, surfaceContext, type CanvasSurface } from '../../core/canvasSurface';
import { isRiverChannel, MAX_WATER_DEPTH, VOID_TYPE, type TileContent } from '../tileTypes';

/** Samples a smoothed upscale reads either side of a position: a cubic filter reaches two. */
const FILTER_REACH_SAMPLES = 2;
/** Samples beyond the map on every side, copied from its edge, so no tile's source rect leaves the image. */
const MARGIN_SAMPLES = FILTER_REACH_SAMPLES;
/** The tile's own sample plus the filter's reach either side of it. */
const SOURCE_SPAN_SAMPLES = 1 + FILTER_REACH_SAMPLES * 2;

const RGBA_CHANNELS = 4;
const RED = 0;
const GREEN = 1;
const BLUE = 2;
const ALPHA = 3;
const BYTE_MAX = 255;

interface ColumnTint {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** How much of the bed the water hides, 0..1. */
  readonly opacity: number;
}

/**
 * The water at each `waterDepth`, shallowest first. The margin is pale and
 * green with most of the bed showing through; the channel is dark teal and
 * hides almost all of it. The deep end is a dark, desaturated green, so
 * `WaterAnimationSystem`'s highlights stay the only bright marks on it.
 */
const COLUMN_BY_DEPTH: readonly ColumnTint[] = [
  { r: 44, g: 94, b: 86, opacity: 0.56 },
  { r: 26, g: 68, b: 72, opacity: 0.77 },
  { r: 16, g: 50, b: 58, opacity: 0.88 },
  { r: 10, g: 36, b: 44, opacity: 0.93 },
];

/**
 * What a dry tile contributes to its water neighbour's upscale: shallower than
 * the shallowest water, so the margin keeps thinning right up to the bank
 * rather than levelling off half a tile short of it.
 */
const BANK_SAMPLE: ColumnTint = { r: 52, g: 100, b: 88, opacity: 0.4 };

/** Depth assumed for a water tile with none recorded — one painted outside the generator. */
const UNRECORDED_DEPTH = 1;

/**
 * The bank's shade on the water below it. A dry tile with the river to its
 * south contributes a dark sample instead of a pale one, so the upscale lays a
 * soft dark band across the top of the water beneath it, darkest at the
 * waterline. The bank's fringe is drawn over the top of the tile afterwards,
 * so what shows is the strip just below the waterline, which anchors the water
 * beneath the land. Being part of the same smooth upscale, the band follows
 * the bank along its length rather than stepping at every tile.
 */
const SHADING_BANK_SAMPLE: ColumnTint = { r: 8, g: 20, b: 22, opacity: 0.72 };

interface BuiltColumn {
  readonly samples: CanvasSurface;
}

const built = new WeakMap<TileContent[][], BuiltColumn | null>();

function channelDepth(cell: TileContent): number {
  return Math.min(MAX_WATER_DEPTH, Math.max(0, cell.waterDepth ?? UNRECORDED_DEPTH));
}

/**
 * The depth a void tile stands in for: the deepest channel tile in the nearest
 * ring around it within the filter's reach, or null when none is that close.
 * A river runs deep to the map's edge, so the void past it must carry the
 * channel's depth on, not shoal it like a bank would.
 */
function depthCarriedIntoVoid(structure: TileContent[][], tx: number, ty: number): number | null {
  for (let ring = 1; ring <= FILTER_REACH_SAMPLES; ring++) {
    let deepest: number | null = null;
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        const onRing = Math.max(Math.abs(dx), Math.abs(dy)) === ring;
        if (!onRing) continue;
        const neighbour = structure[ty + dy]?.[tx + dx];
        if (!isRiverChannel(neighbour)) continue;
        const depth = channelDepth(neighbour);
        deepest = deepest === null ? depth : Math.max(deepest, depth);
      }
    }
    if (deepest !== null) return deepest;
  }
  return null;
}

function columnAt(structure: TileContent[][], tx: number, ty: number): ColumnTint {
  const cell = structure[ty]?.[tx];
  if (isRiverChannel(cell)) {
    return COLUMN_BY_DEPTH[channelDepth(cell)] ?? BANK_SAMPLE;
  }
  if (cell.type === VOID_TYPE) {
    const carried = depthCarriedIntoVoid(structure, tx, ty);
    if (carried !== null) return COLUMN_BY_DEPTH[carried] ?? BANK_SAMPLE;
  }
  const overhangsWater = isRiverChannel(structure[ty + 1]?.[tx]);
  return overhangsWater ? SHADING_BANK_SAMPLE : BANK_SAMPLE;
}

function clampTo(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

function buildSamples(structure: TileContent[][]): CanvasSurface | null {
  const rows = structure.length;
  const cols = structure[0]?.length ?? rows;
  if (rows === 0 || cols === 0) return null;
  let hasWater = false;
  for (const row of structure) {
    if (row.some((cell) => isRiverChannel(cell))) {
      hasWater = true;
      break;
    }
  }
  if (!hasWater) return null;

  const spanX = cols + MARGIN_SAMPLES * 2;
  const spanY = rows + MARGIN_SAMPLES * 2;
  const rgba = new Uint8ClampedArray(spanX * spanY * RGBA_CHANNELS);
  for (let j = 0; j < spanY; j++) {
    const ty = clampTo(j - MARGIN_SAMPLES, 0, rows - 1);
    for (let i = 0; i < spanX; i++) {
      const tx = clampTo(i - MARGIN_SAMPLES, 0, cols - 1);
      const tint = columnAt(structure, tx, ty);
      const at = (j * spanX + i) * RGBA_CHANNELS;
      rgba[at + RED] = tint.r;
      rgba[at + GREEN] = tint.g;
      rgba[at + BLUE] = tint.b;
      rgba[at + ALPHA] = Math.round(tint.opacity * BYTE_MAX);
    }
  }
  const samples = allocCanvas(spanX, spanY);
  const samplesCtx = surfaceContext(samples);
  const image = samplesCtx.createImageData(spanX, spanY);
  image.data.set(rgba);
  samplesCtx.putImageData(image, 0, 0);
  return samples;
}

function columnFor(structure: TileContent[][]): BuiltColumn | null {
  const existing = built.get(structure);
  if (existing !== undefined) return existing;
  const samples = buildSamples(structure);
  const column = samples === null ? null : { samples };
  built.set(structure, column);
  return column;
}

/**
 * Builds the map's depth samples now rather than on its first water tile, so
 * the one-off cost is not charged to a timed chunk bake. A no-op on a map with
 * no river, or once built.
 */
export function warmRiverWaterColumn(structure: TileContent[][]): void {
  columnFor(structure);
}

/**
 * Lays the water column, and the bank's shade, over river bed already drawn in
 * the tile at (tx, ty), confined to the clip rect: the whole tile for a water
 * tile's own bed, one quadrant where the fringe has carried the river into a
 * bank tile. Call before the bank's fringe is composited over it.
 */
export function drawRiverWaterColumn(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
  clipX: number,
  clipY: number,
  clipWidth: number,
  clipHeight: number,
): void {
  const column = columnFor(structure);
  if (column === null) return;
  const { samples } = column;
  // Sample `tile + margin` is the tile's own, and a scaled blit lands its texel
  // exactly on the tile's square.
  const firstSampleX = tx + MARGIN_SAMPLES - FILTER_REACH_SAMPLES;
  const firstSampleY = ty + MARGIN_SAMPLES - FILTER_REACH_SAMPLES;
  const destX = sx + (firstSampleX - MARGIN_SAMPLES - tx) * ts;
  const destY = sy + (firstSampleY - MARGIN_SAMPLES - ty) * ts;
  ctx.save();
  ctx.beginPath();
  ctx.rect(clipX, clipY, clipWidth, clipHeight);
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
