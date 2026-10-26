/**
 * Rims built once per figure cell, for a body that wears an outline every
 * frame of its life — a converted ally's soul-green halo — and is drawn as
 * exactly one cached figure cell. Tracing a rim live costs four smeared
 * copies of the silhouette, a punch-out and a tint on every frame; a cell
 * never changes while the figure cache holds it, so neither does its rim.
 *
 * A rim is keyed by its cell, the size and mirroring the cell lands at on the
 * device grid, the rim's width and its colour. It is built on whole pixels and
 * blitted at the cell's own sub-pixel offset: neither the camera nor a body's
 * position is snapped to the grid, so a key with the phase in it would build
 * a new rim on nearly every frame of a walk, and shifting a soft halo by part
 * of a pixel is invisible. It is dropped with its cell
 * (`onFigureCellDropped`), when the canvases are rebuilt (`canvasGeneration`),
 * and least recently drawn first past {@link RIM_CACHE_BUDGET_BYTES}; an
 * evicted rim's surface is kept for the next rim of its size.
 */

import {
  allocCanvas,
  BYTES_PER_MEGABYTE,
  surfaceContext,
  type CanvasSurface,
  releaseSurface,
} from '../rendering/canvasSurface';
import { canvasGeneration } from '../rendering/canvasRecovery';
import { onFigureCellDropped, type FigureCellBlit } from '../../sprites/figure/figureFrameCache';

/** Rim sizes are keyed to this many steps a pixel, so float noise in a size never splits a key. */
const SIZE_KEY_STEPS_PER_PIXEL = 1000;
/** Evicted rim surfaces kept for reuse, so a miss under pressure rarely allocates. */
const SPARE_SURFACE_LIMIT = 8;
const BYTES_PER_PIXEL = 4;
/** A few dozen allies' rims across their poses and phases. */
const RIM_CACHE_BUDGET_MEGABYTES = 8;
const RIM_CACHE_BUDGET_BYTES = RIM_CACHE_BUDGET_MEGABYTES * BYTES_PER_MEGABYTE;

/** Directions the silhouette is smeared in to build the rim, as in the live trace. */
const RIM_OFFSETS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const;

interface RimEntry {
  readonly cell: CanvasSurface;
  readonly key: string;
  readonly surface: CanvasSurface;
  readonly bytes: number;
}

/** A rim ready to blit: where its top-left lands, in the destination's device pixels. */
export interface PlacedRim {
  readonly surface: CanvasSurface;
  readonly deviceX: number;
  readonly deviceY: number;
}

const rimsByCell = new Map<CanvasSurface, Map<string, RimEntry>>();
/** Every rim held, least recently drawn first. */
const recency = new Set<RimEntry>();
let heldBytes = 0;
let generation = canvasGeneration();
/** Evicted rim surfaces awaiting reuse, by `width×height`. */
const spareSurfaces = new Map<string, CanvasSurface[]>();
let spareCount = 0;
let silhouette: CanvasSurface | null = null;
let silhouetteContext: CanvasRenderingContext2D | null = null;

function sizeKey(width: number, height: number): string {
  return `${width}x${height}`;
}

/** A surface for a rim, reused from an evicted rim of the same size when one is spare. */
function rimSurface(width: number, height: number): CanvasSurface {
  const spares = spareSurfaces.get(sizeKey(width, height));
  const spare = spares?.pop();
  if (spare === undefined) return allocCanvas('rims', width, height);
  spareCount--;
  return spare;
}

function keepSpare(surface: CanvasSurface): void {
  if (spareCount >= SPARE_SURFACE_LIMIT) {
    releaseSurface(surface);
    return;
  }
  const key = sizeKey(surface.width, surface.height);
  const spares = spareSurfaces.get(key) ?? [];
  spares.push(surface);
  spareSurfaces.set(key, spares);
  spareCount++;
}

function releaseSpares(): void {
  for (const spares of spareSurfaces.values())
    for (const surface of spares) releaseSurface(surface);
  spareSurfaces.clear();
  spareCount = 0;
}

function dropEntry(entry: RimEntry, reuse = false): void {
  if (reuse) keepSpare(entry.surface);
  else releaseSurface(entry.surface);
  recency.delete(entry);
  heldBytes -= entry.bytes;
  const rims = rimsByCell.get(entry.cell);
  if (rims === undefined) return;
  rims.delete(entry.key);
  if (rims.size === 0) rimsByCell.delete(entry.cell);
}

function dropCellRims(entry: RimEntry): void {
  dropEntry(entry);
  if (recency.size === 0) releaseSpares();
}

function dropCell(cell: CanvasSurface): void {
  const rims = rimsByCell.get(cell);
  if (rims === undefined) return;
  for (const entry of [...rims.values()]) dropCellRims(entry);
}

onFigureCellDropped(dropCell);

function syncCanvasGeneration(): void {
  const current = canvasGeneration();
  if (generation === current) return;
  generation = current;
  for (const entry of [...recency]) dropEntry(entry);
  releaseSpares();
  if (silhouette !== null) releaseSurface(silhouette);
  silhouette = null;
  silhouetteContext = null;
}

function silhouetteFor(width: number, height: number): CanvasRenderingContext2D {
  const fits =
    silhouette !== null &&
    silhouetteContext !== null &&
    silhouette.width >= width &&
    silhouette.height >= height;
  if (fits && silhouetteContext !== null) return silhouetteContext;
  const grownWidth = Math.max(width, silhouette?.width ?? 0);
  const grownHeight = Math.max(height, silhouette?.height ?? 0);
  if (silhouette !== null) releaseSurface(silhouette);
  const grown = allocCanvas('rims', grownWidth, grownHeight);
  silhouette = grown;
  silhouetteContext = surfaceContext(grown);
  return silhouetteContext;
}

/** The cell's footprint on the device grid, or null when the blit was rotated or skewed. */
function deviceRectOf(blit: FigureCellBlit, offsetX: number, offsetY: number) {
  const { a, b, c, d, e, f } = blit.transform;
  if (b !== 0 || c !== 0 || a === 0 || d === 0) return null;
  // Sizes from the scale alone, not from the difference of the two edges,
  // which carries the position's float noise into what the rim is keyed on.
  const width = Math.abs(a) * blit.destWidth;
  const height = Math.abs(d) * blit.destHeight;
  const x0 = a * blit.destX + e + offsetX;
  const y0 = d * blit.destY + f + offsetY;
  return {
    left: a < 0 ? x0 - width : x0,
    top: d < 0 ? y0 - height : y0,
    width,
    height,
    mirroredX: a < 0,
    mirroredY: d < 0,
  };
}

/**
 * The rim of `blit`'s cell in `color`, `rimDevicePx` wide, placed where the
 * cell landed on a surface whose device grid is offset from the
 * blit's own by (`offsetX`, `offsetY`). Null when the blit cannot be keyed
 * (rotated), or when the rim would reach past (`limitWidth`, `limitHeight`),
 * where the live trace is cut off by its box and a whole cached rim is not.
 */
export function cachedCellRim(
  blit: FigureCellBlit,
  offsetX: number,
  offsetY: number,
  limitWidth: number,
  limitHeight: number,
  rimDevicePx: number,
  color: string,
): PlacedRim | null {
  const rect = deviceRectOf(blit, offsetX, offsetY);
  if (rect === null) return null;
  const pad = Math.ceil(rimDevicePx);
  const insideLimit =
    rect.left - pad >= 0 &&
    rect.top - pad >= 0 &&
    rect.left + rect.width + pad <= limitWidth &&
    rect.top + rect.height + pad <= limitHeight;
  if (!insideLimit) return null;

  syncCanvasGeneration();
  const key = [
    Math.round(rect.width * SIZE_KEY_STEPS_PER_PIXEL),
    Math.round(rect.height * SIZE_KEY_STEPS_PER_PIXEL),
    rect.mirroredX ? 'mx' : '',
    rect.mirroredY ? 'my' : '',
    rimDevicePx,
    color,
  ].join('|');
  const placed = (entry: RimEntry): PlacedRim => ({
    surface: entry.surface,
    deviceX: rect.left - pad,
    deviceY: rect.top - pad,
  });
  const held = rimsByCell.get(blit.surface)?.get(key);
  if (held !== undefined) {
    recency.delete(held);
    recency.add(held);
    return placed(held);
  }

  const width = Math.ceil(rect.width) + pad * 2;
  const height = Math.ceil(rect.height) + pad * 2;
  const shape = silhouetteFor(width, height);
  shape.setTransform(1, 0, 0, 1, 0, 0);
  shape.globalCompositeOperation = 'source-over';
  shape.globalAlpha = 1;
  shape.clearRect(0, 0, width, height);
  shape.setTransform(
    rect.mirroredX ? -1 : 1,
    0,
    0,
    rect.mirroredY ? -1 : 1,
    pad + (rect.mirroredX ? rect.width : 0),
    pad + (rect.mirroredY ? rect.height : 0),
  );
  shape.drawImage(blit.surface, 0, 0, rect.width, rect.height);
  shape.setTransform(1, 0, 0, 1, 0, 0);

  const source = silhouette;
  if (source === null) return null;
  const rim = rimSurface(width, height);
  const target = surfaceContext(rim);
  target.setTransform(1, 0, 0, 1, 0, 0);
  target.globalAlpha = 1;
  target.globalCompositeOperation = 'source-over';
  target.clearRect(0, 0, width, height);
  for (const [dx, dy] of RIM_OFFSETS) {
    target.drawImage(
      source,
      0,
      0,
      width,
      height,
      dx * rimDevicePx,
      dy * rimDevicePx,
      width,
      height,
    );
  }
  target.globalCompositeOperation = 'destination-out';
  target.drawImage(source, 0, 0, width, height, 0, 0, width, height);
  target.globalCompositeOperation = 'source-in';
  target.fillStyle = color;
  target.fillRect(0, 0, width, height);
  target.globalCompositeOperation = 'source-over';

  const entry: RimEntry = {
    cell: blit.surface,
    key,
    surface: rim,
    bytes: width * height * BYTES_PER_PIXEL,
  };
  const rims = rimsByCell.get(blit.surface) ?? new Map<string, RimEntry>();
  rims.set(key, entry);
  rimsByCell.set(blit.surface, rims);
  recency.add(entry);
  heldBytes += entry.bytes;
  for (const oldest of recency) {
    if (heldBytes <= RIM_CACHE_BUDGET_BYTES || oldest === entry) break;
    dropEntry(oldest, true);
  }
  return placed(entry);
}
