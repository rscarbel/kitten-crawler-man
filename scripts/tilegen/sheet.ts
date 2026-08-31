/**
 * Packs generated patches into review sheets and writes them.
 *
 * The node-canvas and filesystem half of the ground tileset pipeline, and the
 * only part of it the shipped game does not run: the game paints these sheets
 * for itself from the same painters. Nothing here writes a manifest — the
 * tileset manifest entries are checked-in data now, and the geometry a painter
 * must match is proved against them at registration rather than emitted
 * alongside the pixels.
 */

import { createCanvas } from 'canvas';
import { writeFileSync } from 'fs';
import { TILE_PX, type Surface } from '../../src/map/tilegen/raster.js';

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
const ALPHA_CHANNEL = 3;
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
      image.data[p * RGBA_CHANNELS + ALPHA_CHANNEL] = Math.round(mask[p] * ALPHA_MAX);
    }
    ctx.putImageData(image, index * TILE_PX, 0);
  });
  writeFileSync(filePath, canvas.toBuffer('image/png'));
}
