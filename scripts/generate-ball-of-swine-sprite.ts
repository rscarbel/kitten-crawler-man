/**
 * Bakes the Ball of Swine sheet.
 *
 * This module is choreography, frame geometry and tiling. Every stroke of paint
 * lives in `scripts/ballOfSwineArt.ts`, and every frame count in
 * `src/sprites/ballOfSwineSheet.ts`.
 *
 * Two things here are unlike the other creature sheets, and both come from the
 * same fact — the ball is drawn *rotated to its travel heading*:
 *
 *  - Every row is baked **concentric on the frame centre**, and the manifest
 *    anchor is that centre rather than a ground line. A rotation pivots on the
 *    anchor, so an anchor anywhere else would swing the ball around a point off
 *    its own axis and make it wobble as it rolled.
 *  - The lighting is a separate one-frame `shade` row, and the ground shadow a
 *    separate `shadow` row, both drawn unrotated. Baked into the roll frames
 *    they would carry the sun and the shadow around the arena with the ball.
 *
 * Run through the gates, never directly: `npm run gen:ball-of-swine`.
 */

import { createCanvas, type CanvasRenderingContext2D as Ctx } from 'canvas';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  BODY_REACH,
  drawBallBurst,
  drawBallRoll,
  drawBallShade,
  drawBallShadow,
  drawBallSlam,
  drawBallSpinup,
  drawBallWallow,
} from './ballOfSwineArt.js';
import {
  BOS_BURST_FRAMES,
  BOS_ROLL_FRAMES,
  BOS_SLAM_FRAMES,
  BOS_SPINUP_FRAMES,
  BOS_WALLOW_FRAMES,
} from '../src/sprites/ballOfSwineSheet.js';

// ── Sheet geometry ───────────────────────────────────────────────────────────

/** Art tile size; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;
/** Frames are rendered at this multiple and downsampled for smoother edges. */
const SUPERSAMPLE = 2;
/** Clear pixels kept between the widest ink and the cell wall. */
const FRAME_PADDING = 4;
/** Frame sizes are rounded up to this, so the sheet tiles on tidy numbers. */
const FRAME_SIZE_QUANTUM = 8;
const MAX_PNG_COMPRESSION = 9;

export const SHEET_PATH = 'src/images/bosses/ball_of_swine.png';
const SHEET_RELATIVE_PATH = 'bosses/ball_of_swine.png';
const MANIFEST_PATH = 'src/images/bosses/manifest.json';
const SPRITE_KEY = 'ball_of_swine';

const TAU = Math.PI * 2;

// ── Rows ─────────────────────────────────────────────────────────────────────

export type RowKind = 'loop' | 'oneShot' | 'overlay';

export interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly kind: RowKind;
  /**
   * Whether the runtime draws this row rotated about the manifest anchor.
   *
   * Declared on the row rather than inferred, because it is what the
   * concentricity gate measures: a rotated row's ink has to sit on the pivot, and
   * an unrotated one is free to sag onto the floor or spread sideways. Getting
   * this wrong in either direction is a defect the gate can then catch — a
   * rotated row that wobbles, or an unrotated one held to a constraint it has no
   * reason to meet.
   */
  readonly rotated: boolean;
  /** Which sheet row this state's cells live on. States may share one. */
  readonly sheetRow: number;
  /** First column of this state's run within its sheet row. */
  readonly colOffset: number;
  /** Paints one frame into a context already centred on the ball and in tile units. */
  readonly paint: (ctx: Ctx, frame: number) => void;
}

/** Loops sample the cycle evenly; one-shots sample the middle of each frame. */
function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

function shotProgress(frame: number, frameCount: number): number {
  return (frame + 0.5) / frameCount;
}

/**
 * The seven states, packed onto four sheet rows.
 *
 * Packed rather than one state per row because the cells here are large — the
 * ball needs a square cell wide enough for it to be rotated inside — and a sheet
 * is a rectangle, so every row is as wide as the *longest* one. One state per row
 * left half the sheet paid for and empty: 84 cells to hold 40. Every sprite sheet
 * in the game is preloaded at boot and stays resident for the session, so that
 * waste is permanent, and this rebuild had to not be a memory regression on top
 * of everything else it is.
 *
 * The packing is written out rather than solved for: a bin-packer would be free
 * to move a state between runs, and the manifest that names these rows is
 * hand-edited.
 */
const SHEET_COLUMNS = BOS_ROLL_FRAMES;

export const ROWS: readonly RowSpec[] = [
  {
    name: 'roll',
    frameCount: BOS_ROLL_FRAMES,
    kind: 'loop',
    rotated: true,
    sheetRow: 0,
    colOffset: 0,
    paint: (ctx, frame) => {
      drawBallRoll(ctx, cyclePhase(frame, BOS_ROLL_FRAMES) * TAU);
    },
  },
  {
    name: 'wallow',
    frameCount: BOS_WALLOW_FRAMES,
    kind: 'loop',
    rotated: false,
    sheetRow: 1,
    colOffset: 0,
    paint: (ctx, frame) => {
      drawBallWallow(ctx, cyclePhase(frame, BOS_WALLOW_FRAMES));
    },
  },
  {
    name: 'shade',
    frameCount: 1,
    kind: 'overlay',
    rotated: false,
    sheetRow: 1,
    colOffset: BOS_WALLOW_FRAMES,
    paint: (ctx) => {
      drawBallShade(ctx);
    },
  },
  {
    name: 'shadow',
    frameCount: 1,
    kind: 'overlay',
    rotated: false,
    sheetRow: 1,
    colOffset: BOS_WALLOW_FRAMES + 1,
    paint: (ctx) => {
      drawBallShadow(ctx);
    },
  },
  {
    name: 'burst',
    frameCount: BOS_BURST_FRAMES,
    kind: 'oneShot',
    rotated: false,
    sheetRow: 2,
    colOffset: 0,
    paint: (ctx, frame) => {
      drawBallBurst(ctx, shotProgress(frame, BOS_BURST_FRAMES));
    },
  },
  {
    name: 'slam',
    frameCount: BOS_SLAM_FRAMES,
    kind: 'oneShot',
    rotated: true,
    sheetRow: 2,
    colOffset: BOS_BURST_FRAMES,
    paint: (ctx, frame) => {
      drawBallSlam(ctx, shotProgress(frame, BOS_SLAM_FRAMES));
    },
  },
  {
    name: 'spinup',
    frameCount: BOS_SPINUP_FRAMES,
    kind: 'oneShot',
    rotated: false,
    sheetRow: 3,
    colOffset: 0,
    paint: (ctx, frame) => {
      drawBallSpinup(ctx, shotProgress(frame, BOS_SPINUP_FRAMES));
    },
  },
];

/** Sheet rows in use, which is one past the highest `sheetRow` any state claims. */
export const SHEET_ROWS = Math.max(...ROWS.map((row) => row.sheetRow)) + 1;

// ── Bake ─────────────────────────────────────────────────────────────────────

export interface SheetGeometry {
  /** Cells are square: a row drawn rotated has no meaningful width or height. */
  readonly frameSize: number;
  /** Offset from the cell's top-left to the ball's centre — always the middle. */
  readonly anchor: number;
}

export interface BakedSheet {
  readonly buffer: Buffer;
  readonly geometry: SheetGeometry;
  readonly columns: number;
}

/**
 * Widest the art strays from the ball's centre, in pixels, measured rather than
 * assumed.
 *
 * `BODY_REACH` is what the art module *promises*; this is what it painted. A
 * frame envelope derived from the promise would clip the first time a spray
 * particle was thrown a little further, and the clip would be baked in.
 */
function measureReach(): number {
  const scratchHalf = Math.ceil(BODY_REACH * TILE_SCALE * 2);
  const scratch = createCanvas(scratchHalf * 2, scratchHalf * 2);
  const ctx = scratch.getContext('2d');
  const INK_ALPHA_THRESHOLD = 8;
  const CHANNELS = 4;
  const ALPHA_OFFSET = 3;

  let reach = 0;
  for (const row of ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      ctx.clearRect(0, 0, scratch.width, scratch.height);
      ctx.save();
      ctx.translate(scratchHalf, scratchHalf);
      ctx.scale(TILE_SCALE, TILE_SCALE);
      row.paint(ctx, frame);
      ctx.restore();

      const pixels = ctx.getImageData(0, 0, scratch.width, scratch.height);
      let painted = false;
      for (let y = 0; y < scratch.height; y++) {
        for (let x = 0; x < scratch.width; x++) {
          const alpha = pixels.data[(y * scratch.width + x) * CHANNELS + ALPHA_OFFSET];
          if (alpha < INK_ALPHA_THRESHOLD) continue;
          painted = true;
          reach = Math.max(reach, Math.abs(x - scratchHalf) + 1, Math.abs(y - scratchHalf) + 1);
        }
      }
      if (!painted) {
        throw new Error(
          `${row.name}[${frame}] painted nothing at all, which almost always means a NaN in the art`,
        );
      }
    }
  }
  return reach;
}

function geometryFor(reachPx: number): SheetGeometry {
  const half = reachPx + FRAME_PADDING;
  const frameSize =
    Math.ceil((half * 2) / (FRAME_SIZE_QUANTUM * 2)) * FRAME_SIZE_QUANTUM * 2;
  return { frameSize, anchor: frameSize / 2 };
}

export function bake(): BakedSheet {
  const geometry = geometryFor(measureReach());
  const columns = Math.max(...ROWS.map((row) => row.colOffset + row.frameCount));
  if (columns > SHEET_COLUMNS) {
    throw new Error(
      `the packing needs ${columns} columns but the sheet is ${SHEET_COLUMNS} wide; move a state ` +
        `to another sheet row`,
    );
  }

  const sheet = createCanvas(SHEET_COLUMNS * geometry.frameSize, SHEET_ROWS * geometry.frameSize);
  const sheetCtx = sheet.getContext('2d');
  const cell = createCanvas(geometry.frameSize * SUPERSAMPLE, geometry.frameSize * SUPERSAMPLE);
  const cellCtx = cell.getContext('2d');

  for (const row of ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      cellCtx.clearRect(0, 0, cell.width, cell.height);
      cellCtx.save();
      cellCtx.scale(SUPERSAMPLE, SUPERSAMPLE);
      cellCtx.translate(geometry.anchor, geometry.anchor);
      cellCtx.scale(TILE_SCALE, TILE_SCALE);
      row.paint(cellCtx, frame);
      cellCtx.restore();

      sheetCtx.drawImage(
        cell,
        0,
        0,
        cell.width,
        cell.height,
        (row.colOffset + frame) * geometry.frameSize,
        row.sheetRow * geometry.frameSize,
        geometry.frameSize,
        geometry.frameSize,
      );
    }
  }

  return {
    buffer: sheet.toBuffer('image/png', { compressionLevel: MAX_PNG_COMPRESSION }),
    geometry,
    columns: SHEET_COLUMNS,
  };
}

// ── Manifest ─────────────────────────────────────────────────────────────────

interface ManifestStateEntry {
  readonly row: number;
  readonly frameCount: number;
  /** Omitted at zero, matching how every other sheet's states are written. */
  readonly colOffset?: number;
}

interface ManifestEntry {
  readonly path: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
  readonly tileScale: number;
  readonly states: Record<string, ManifestStateEntry>;
}

export function manifestEntry(sheet: BakedSheet): ManifestEntry {
  const states: Record<string, ManifestStateEntry> = {};
  for (const row of ROWS) {
    states[row.name] =
      row.colOffset === 0
        ? { row: row.sheetRow, frameCount: row.frameCount }
        : { row: row.sheetRow, colOffset: row.colOffset, frameCount: row.frameCount };
  }
  return {
    path: SHEET_RELATIVE_PATH,
    frameWidth: sheet.geometry.frameSize,
    frameHeight: sheet.geometry.frameSize,
    tileX: sheet.geometry.anchor,
    tileY: sheet.geometry.anchor,
    tileScale: TILE_SCALE,
    states,
  };
}

/** Key order in JSON carries no meaning, so compare on a sorted stringify. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested: unknown) => {
    if (typeof nested !== 'object' || nested === null || Array.isArray(nested)) return nested;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(nested).sort()) {
      sorted[key] = Object.getOwnPropertyDescriptor(nested, key)?.value;
    }
    return sorted;
  });
}

/**
 * Checks manifest.json against the bake rather than rewriting it. That file is
 * shared with every other boss sheet and other agents edit it, so a generator
 * that rewrote it would silently clobber their work.
 */
export function manifestMismatch(sheet: BakedSheet): string | null {
  const parsed: unknown = JSON.parse(readFileSync(resolve(MANIFEST_PATH), 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${MANIFEST_PATH} is not an object`);
  }
  const manifest: Record<string, unknown> = { ...parsed };
  const required = manifestEntry(sheet);
  if (canonicalJson(manifest[SPRITE_KEY]) === canonicalJson(required)) return null;
  return (
    `${MANIFEST_PATH} is out of sync with the bake. Replace its "${SPRITE_KEY}" entry with:\n` +
    `${JSON.stringify(required, null, 2)}`
  );
}

export function writeSheet(sheet: BakedSheet): void {
  writeFileSync(resolve(SHEET_PATH), sheet.buffer);
  const { frameSize } = sheet.geometry;
  const usedCells = ROWS.reduce((total, row) => total + row.frameCount, 0);
  console.log(
    `  → ${SHEET_PATH}  (${sheet.columns} × ${SHEET_ROWS} cells of ${frameSize}×${frameSize}, ` +
      `${usedCells} used, anchor ${sheet.geometry.anchor},${sheet.geometry.anchor})`,
  );
  for (const row of ROWS) {
    console.log(
      `     ${row.name.padEnd(8)} ${String(row.frameCount).padStart(2)} frames  ` +
        `row ${row.sheetRow} col ${row.colOffset}  ${row.kind}${row.rotated ? '  rotated' : ''}`,
    );
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  console.error(
    'Run `npm run gen:ball-of-swine`; a sheet that skipped its gates must not reach disk.',
  );
  process.exitCode = 1;
}
