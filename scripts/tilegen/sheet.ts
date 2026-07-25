/**
 * Slices generated patches into tiles, packs them into sheets, and writes the
 * matching manifest entries.
 *
 * The manifest is emitted by the same run that emits the PNG. The previous
 * overworld sheet had drifted out of sync with its manifest — 768x703 declared
 * as 64px rows, so every row below the first was offset by a fraction of a pixel
 * — and generating both together makes that class of bug unrepresentable.
 */

import { createCanvas } from 'canvas';
import { writeFileSync, readFileSync } from 'fs';
import { Surface, TILE_PX } from './raster.js';

export interface SheetRow {
  /** Manifest state name, and the label shown in the `?tiles` review route. */
  readonly state: string;
  readonly frames: ReadonlyArray<Surface>;
  /** Tiles across one patch; frames are grouped in patchTiles^2 blocks. */
  readonly patchTiles: number;
  readonly label: string;
}

export interface SheetSpec {
  readonly key: string;
  /** Path under src/images/, as stored in the manifest. */
  readonly path: string;
  readonly rows: ReadonlyArray<SheetRow>;
}

export interface ManifestStateEntry {
  readonly row: number;
  readonly frameCount: number;
  /**
   * Tiles across one generated patch. Frames are ordered variant-major, then
   * row-major within the patch, so the frame for map tile (tx, ty) is
   * `variant * patchTiles^2 + (ty mod patchTiles) * patchTiles + (tx mod patchTiles)`.
   * Absent or 1 means every frame is an independent tile.
   */
  readonly patchTiles?: number;
  readonly label?: string;
}

export interface ManifestEntry {
  readonly path: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
  readonly tileScale: number;
  readonly states: Record<string, ManifestStateEntry>;
}

/**
 * Cuts a patch into its constituent tiles, row-major. The tiles are seamless
 * against each other in the patch's own arrangement, and the patch as a whole
 * wraps — so laying patches edge to edge is seamless too.
 */
export function slicePatch(patch: Surface): Surface[] {
  const tilesAcross = patch.size / TILE_PX;
  const tiles: Surface[] = [];
  for (let ty = 0; ty < tilesAcross; ty++) {
    for (let tx = 0; tx < tilesAcross; tx++) {
      const tile = new Surface(TILE_PX);
      tile.fill((x, y) => patch.get(tx * TILE_PX + x, ty * TILE_PX + y));
      tiles.push(tile);
    }
  }
  return tiles;
}

/** Writes the sheet PNG and returns the manifest entry describing it. */
export function writeSheet(spec: SheetSpec, imagesRoot: string): ManifestEntry {
  const columns = spec.rows.reduce((widest, row) => Math.max(widest, row.frames.length), 0);
  const canvas = createCanvas(columns * TILE_PX, spec.rows.length * TILE_PX);
  const ctx = canvas.getContext('2d');

  spec.rows.forEach((row, rowIndex) => {
    row.frames.forEach((frame, columnIndex) => {
      const image = ctx.createImageData(TILE_PX, TILE_PX);
      image.data.set(frame.toRgba());
      ctx.putImageData(image, columnIndex * TILE_PX, rowIndex * TILE_PX);
    });
  });

  writeFileSync(`${imagesRoot}/${spec.path}`, canvas.toBuffer('image/png'));

  const states: Record<string, ManifestStateEntry> = {};
  spec.rows.forEach((row, rowIndex) => {
    states[row.state] = {
      row: rowIndex,
      frameCount: row.frames.length,
      patchTiles: row.patchTiles,
      label: row.label,
    };
  });

  return {
    path: spec.path,
    frameWidth: TILE_PX,
    frameHeight: TILE_PX,
    tileX: 0,
    tileY: 0,
    tileScale: TILE_PX,
    states,
  };
}

const RGBA_CHANNELS = 4;
const ALPHA_MAX = 255;

/**
 * Writes the corner-mask set as a single-row RGBA sheet: white pixels whose
 * alpha carries the mask. Stored in alpha so the game can composite with
 * `destination-in` / `source-over` directly, with no per-pixel work at runtime.
 */
export function writeMaskSheet(masks: ReadonlyArray<Float64Array>, filePath: string): void {
  const canvas = createCanvas(masks.length * TILE_PX, TILE_PX);
  const ctx = canvas.getContext('2d');
  masks.forEach((mask, index) => {
    const image = ctx.createImageData(TILE_PX, TILE_PX);
    for (let p = 0; p < TILE_PX * TILE_PX; p++) {
      image.data[p * RGBA_CHANNELS] = ALPHA_MAX;
      image.data[p * RGBA_CHANNELS + 1] = ALPHA_MAX;
      image.data[p * RGBA_CHANNELS + 2] = ALPHA_MAX;
      image.data[p * RGBA_CHANNELS + 3] = Math.round(mask[p] * ALPHA_MAX);
    }
    ctx.putImageData(image, index * TILE_PX, 0);
  });
  writeFileSync(filePath, canvas.toBuffer('image/png'));
}

/** Merges generated entries into an existing manifest file, preserving the rest. */
export function updateManifest(
  manifestPath: string,
  entries: Readonly<Record<string, ManifestEntry>>,
): void {
  const raw = readFileSync(manifestPath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`Manifest at ${manifestPath} is not an object`);
  }
  const merged = { ...(parsed as Record<string, unknown>), ...entries };
  writeFileSync(manifestPath, `${JSON.stringify(merged, null, 2)}\n`);
}

export interface WrapReport {
  readonly horizontal: number;
  readonly vertical: number;
  readonly interiorHorizontal: number;
  readonly interiorVertical: number;
  /**
   * Joint difference as a multiple of the patch's own strongest internal edges.
   * Below 1 the joint is no sharper than edges the material legitimately
   * contains; above 1 it is the hardest line in the patch, which is what the eye
   * locks onto as a grid.
   */
  readonly ratio: number;
}

function channelDiff(a: readonly number[], b: readonly number[]): number {
  return (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3;
}

const INTERIOR_PERCENTILE = 0.95;

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
}

/**
 * Compares a patch's wrap joints against the strongest edges inside it.
 *
 * Neither absolute difference nor mean interior adjacency is the right yardstick:
 * a structured material *should* have a hard line where two slabs meet, and its
 * patch edge may land on one. What reads as a seam is a joint sharper than
 * anything else in the material, so that is what this measures.
 */
export function measureWrapError(surface: Surface): WrapReport {
  const size = surface.size;
  let horizontal = 0;
  let vertical = 0;
  for (let i = 0; i < size; i++) {
    horizontal += channelDiff(surface.get(size - 1, i), surface.get(0, i));
    vertical += channelDiff(surface.get(i, size - 1), surface.get(i, 0));
  }
  horizontal /= size;
  vertical /= size;

  const columnCuts: number[] = [];
  const rowCuts: number[] = [];
  for (let cut = 0; cut < size - 1; cut++) {
    let columnSum = 0;
    let rowSum = 0;
    for (let i = 0; i < size; i++) {
      columnSum += channelDiff(surface.get(cut, i), surface.get(cut + 1, i));
      rowSum += channelDiff(surface.get(i, cut), surface.get(i, cut + 1));
    }
    columnCuts.push(columnSum / size);
    rowCuts.push(rowSum / size);
  }

  const interiorHorizontal = percentile(columnCuts, INTERIOR_PERCENTILE);
  const interiorVertical = percentile(rowCuts, INTERIOR_PERCENTILE);

  return {
    horizontal,
    vertical,
    interiorHorizontal,
    interiorVertical,
    ratio: Math.max(
      horizontal / Math.max(interiorHorizontal, 1),
      vertical / Math.max(interiorVertical, 1),
    ),
  };
}
