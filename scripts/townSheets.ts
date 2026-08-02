/**
 * Packing and manifest emission shared by the two town sheet generators.
 *
 * Both bake the same way — rows are states, columns are frames, every frame the
 * same size — and both have to emit a manifest whose `tileX`/`tileY` match the
 * origin the art was painted around. Getting those two out of step shifts every
 * prop of that kind by a fixed offset, which reads as "the lamps are all a bit
 * left" rather than as a bug in a packing routine, so the origin is computed
 * once here and used for both the paint and the manifest row.
 */

import { createCanvas, type ImageData } from 'canvas';
import type { CanvasRenderingContext2D as NodeCtx } from 'canvas';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Level 3's `mapSize`. The town plan is derived from it, so the spans are too. */
export const OVERWORLD_MAP_SIZE_TILES = 280;

export const TOWNSCAPE_DIR = resolve('src/images/environment/townscape');
export const OVER_CITY_DIR = resolve('src/images/environment/towns/over_city');

/** Paints one frame with the anchor tile's top-left corner at (originX, originY). */
export type FramePainter = (ctx: NodeCtx, originX: number, originY: number) => void;

export interface SheetRow {
  readonly state: string;
  readonly frames: ReadonlyArray<FramePainter>;
}

export interface SheetSpec {
  /** Manifest key. Must be unique across every manifest `SpriteLoader` merges. */
  readonly key: string;
  readonly file: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
  /**
   * The map tile type this sheet is the art for, when it is one.
   *
   * `SpriteLoader` keys its sort-Y anchor and its cull extents off this, and
   * both tables are last-write-wins per tile type — so at most one sheet in a
   * family of variants may declare it, and the family must share one frame
   * geometry. Omitted for sheets that are not a tile type's art.
   */
  readonly tileTypeId?: number;
  readonly rows: ReadonlyArray<SheetRow>;
}

/**
 * Inspects a sheet's pixels before it reaches disk. Throwing rejects the whole
 * bake — see `writeSheets`.
 */
export type SheetVerifier = (spec: SheetSpec, pixels: ImageData) => void;

function renderSheet(spec: SheetSpec, verify?: SheetVerifier): Buffer {
  const columns = Math.max(...spec.rows.map((row) => row.frames.length));
  const canvas = createCanvas(columns * spec.frameWidth, spec.rows.length * spec.frameHeight);
  const ctx = canvas.getContext('2d');

  spec.rows.forEach((row, rowIndex) => {
    row.frames.forEach((paint, columnIndex) => {
      // Clipped to its own cell: a painter that reaches further than the frame
      // was sized for would otherwise bleed into its neighbour, which looks like
      // a drawing bug in the *next* frame and is very hard to trace back.
      ctx.save();
      ctx.beginPath();
      ctx.rect(
        columnIndex * spec.frameWidth,
        rowIndex * spec.frameHeight,
        spec.frameWidth,
        spec.frameHeight,
      );
      ctx.clip();
      paint(
        ctx,
        columnIndex * spec.frameWidth + spec.tileX,
        rowIndex * spec.frameHeight + spec.tileY,
      );
      ctx.restore();
    });
  });

  // Verified before the buffer is encoded, so a sheet that fails never reaches
  // the disk at all. Checking after the write leaves the bad art — and the
  // manifest that names it — sitting in the working tree for the next commit,
  // which makes the check a report rather than a gate.
  if (verify !== undefined) {
    verify(spec, ctx.getImageData(0, 0, canvas.width, canvas.height));
  }

  return canvas.toBuffer('image/png');
}

function manifestEntry(spec: SheetSpec, tileScale: number, directoryPath: string) {
  const states: Record<string, { row: number; frameCount: number }> = {};
  spec.rows.forEach((row, rowIndex) => {
    states[row.state] = { row: rowIndex, frameCount: row.frames.length };
  });
  const entry = {
    path: `${directoryPath}/${spec.file}`,
    frameWidth: spec.frameWidth,
    frameHeight: spec.frameHeight,
    tileX: spec.tileX,
    tileY: spec.tileY,
    tileScale,
    states,
  };
  // Spread conditionally rather than writing `tileTypeId: undefined`, which
  // `JSON.stringify` drops anyway but which would leave the key visible in the
  // in-memory manifest a caller might verify against.
  return spec.tileTypeId === undefined ? entry : { ...entry, tileTypeId: spec.tileTypeId };
}

/** The manifest `path` prefix for a directory — `SpriteLoader` resolves against `src/images/`. */
function imagesRelativePath(outDir: string): string {
  const marker = `${resolve('src/images')}/`;
  if (!outDir.startsWith(marker)) {
    throw new Error(`Sheet directory must live under src/images/: ${outDir}`);
  }
  return outDir.slice(marker.length);
}

/**
 * Writes every sheet's PNG and rewrites the directory's manifest.
 *
 * The manifest is replaced rather than merged: this generator owns its whole
 * directory, so a key that has disappeared from the spec should disappear from
 * the manifest too. A merge would leave the entry behind pointing at a PNG that
 * is no longer written, and `loadSprites` skips missing files silently — the
 * prop would just stop drawing with nothing to say why.
 */
export function writeSheets(
  outDir: string,
  tileScale: number,
  sheets: ReadonlyArray<SheetSpec>,
  verify?: SheetVerifier,
) {
  const directoryPath = imagesRelativePath(outDir);
  const manifest: Record<string, unknown> = {};
  // Every sheet is rendered and verified before any of them is written, so one
  // bad sheet cannot leave the directory half-updated.
  const rendered = sheets.map((spec) => ({ spec, buffer: renderSheet(spec, verify) }));
  for (const { spec, buffer } of rendered) {
    writeFileSync(resolve(outDir, spec.file), buffer);
    manifest[spec.key] = manifestEntry(spec, tileScale, directoryPath);
  }
  const manifestPath = resolve(outDir, 'manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  reportSheets(manifestPath, sheets);
}

function reportSheets(manifestPath: string, sheets: ReadonlyArray<SheetSpec>): void {
  for (const spec of sheets) {
    const frames = spec.rows.reduce((total, row) => total + row.frames.length, 0);
    console.log(
      `${spec.key.padEnd(28)} ${spec.frameWidth}x${spec.frameHeight} ` +
        `tile@(${spec.tileX},${spec.tileY}) ${spec.rows.length} state(s), ${frames} frame(s)`,
    );
  }
  console.log(`\nwrote ${sheets.length} sheet(s) and ${manifestPath}`);
}
