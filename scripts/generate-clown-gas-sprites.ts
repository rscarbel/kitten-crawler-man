#!/usr/bin/env tsx
/**
 * Bakes the Evil Clown's vial sheets into `src/images/effects/`.
 *
 *   evil_clown_vial.png    — the bottle tumbling through the air, one loop
 *   evil_clown_shatter.png — the impact, one one-shot row
 *   evil_clown_gas.png     — the lingering cloud, one loop
 *
 * The painting lives in `scripts/clownGasArt.ts`; this file is the frame
 * geometry, the bake and the gates.
 *
 * The manifest for `src/images/effects/` is checked rather than rewritten: that
 * directory also holds the shell, blood, missile and lava sheets this script
 * knows nothing about, and a programmatic rewrite of a shared file clobbers
 * other agents' edits.
 *
 * Run: npm run gen:clown-gas
 */

import { createCanvas, type CanvasRenderingContext2D as Ctx, type ImageData } from 'canvas';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  GAS_RADIUS,
  SHATTER_REACH,
  VIAL_HALF_HEIGHT,
  drawClownGas,
  drawClownVial,
  drawClownVialShatter,
} from './clownGasArt.js';

/** Tile size the art is drawn at; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;
/** Frames are rendered at this multiple and downsampled for smoother edges. */
const SUPERSAMPLE = 2;
const MAX_PNG_COMPRESSION = 9;

/**
 * Alpha a frame's outermost pixels may carry before the bake is rejected.
 *
 * The gas cloud fades to nothing at its own rim, so a frame that paints its
 * border has been cut by the cell wall and will show a straight edge on a shape
 * that has none.
 */
const MAX_EDGE_ALPHA = 6;

interface SheetSpec {
  readonly key: string;
  readonly file: string;
  readonly state: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
  /** Offset from the frame's top-left to the point the runtime anchors on. */
  readonly tileX: number;
  readonly tileY: number;
  readonly frameCount: number;
  readonly paint: (ctx: Ctx, frame: number) => void;
}

const VIAL_FRAMES = 8;
const SHATTER_FRAMES = 10;
const GAS_FRAMES = 8;

/** Pixels of clear space kept around each effect's own reach. */
const FRAME_PADDING = 10;

function cellSize(reachTiles: number): number {
  const span = Math.ceil(reachTiles * TILE_SCALE + FRAME_PADDING) * 2;
  // Even sizes only, so the centre anchor lands on a whole pixel.
  return span % 2 === 0 ? span : span + 1;
}

/**
 * The vial trails gas *below* itself, so its cell has to reach further down
 * than the bottle alone does.
 */
const VIAL_TRAIL_REACH = 0.45;
const VIAL_CELL = cellSize(Math.max(VIAL_HALF_HEIGHT, VIAL_TRAIL_REACH));
const SHATTER_CELL = cellSize(SHATTER_REACH);
const GAS_CELL = cellSize(GAS_RADIUS);

/** Loops sample the cycle evenly; one-shots sample the middle of each frame. */
function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

function shotProgress(frame: number, frameCount: number): number {
  return (frame + 0.5) / frameCount;
}

const SHEETS: readonly SheetSpec[] = [
  {
    key: 'evil_clown_vial',
    file: 'evil_clown_vial.png',
    state: 'fly',
    frameWidth: VIAL_CELL,
    frameHeight: VIAL_CELL,
    tileX: VIAL_CELL / 2,
    tileY: VIAL_CELL / 2,
    frameCount: VIAL_FRAMES,
    paint: (ctx, frame) => {
      ctx.scale(TILE_SCALE, TILE_SCALE);
      drawClownVial(ctx, cyclePhase(frame, VIAL_FRAMES));
    },
  },
  {
    key: 'evil_clown_shatter',
    file: 'evil_clown_shatter.png',
    state: 'shatter',
    frameWidth: SHATTER_CELL,
    frameHeight: SHATTER_CELL,
    tileX: SHATTER_CELL / 2,
    tileY: SHATTER_CELL / 2,
    frameCount: SHATTER_FRAMES,
    paint: (ctx, frame) => {
      ctx.scale(TILE_SCALE, TILE_SCALE);
      drawClownVialShatter(ctx, shotProgress(frame, SHATTER_FRAMES));
    },
  },
  {
    key: 'evil_clown_gas',
    file: 'evil_clown_gas.png',
    state: 'billow',
    frameWidth: GAS_CELL,
    frameHeight: GAS_CELL,
    tileX: GAS_CELL / 2,
    tileY: GAS_CELL / 2,
    frameCount: GAS_FRAMES,
    paint: (ctx, frame) => {
      ctx.scale(TILE_SCALE, TILE_SCALE);
      drawClownGas(ctx, cyclePhase(frame, GAS_FRAMES), 1);
    },
  },
];

interface BakedSheet {
  readonly spec: SheetSpec;
  readonly buffer: Buffer;
  readonly pixels: ImageData;
}

function bakeSheet(spec: SheetSpec): BakedSheet {
  const sheet = createCanvas(spec.frameCount * spec.frameWidth, spec.frameHeight);
  const sheetCtx = sheet.getContext('2d');
  const cell = createCanvas(spec.frameWidth * SUPERSAMPLE, spec.frameHeight * SUPERSAMPLE);
  const cellCtx = cell.getContext('2d');

  for (let frame = 0; frame < spec.frameCount; frame++) {
    cellCtx.clearRect(0, 0, cell.width, cell.height);
    cellCtx.save();
    cellCtx.scale(SUPERSAMPLE, SUPERSAMPLE);
    cellCtx.translate(spec.tileX, spec.tileY);
    spec.paint(cellCtx, frame);
    cellCtx.restore();
    sheetCtx.drawImage(
      cell,
      0,
      0,
      cell.width,
      cell.height,
      frame * spec.frameWidth,
      0,
      spec.frameWidth,
      spec.frameHeight,
    );
  }

  return {
    spec,
    buffer: sheet.toBuffer('image/png', { compressionLevel: MAX_PNG_COMPRESSION }),
    pixels: sheetCtx.getImageData(0, 0, sheet.width, sheet.height),
  };
}

const ALPHA_OFFSET = 3;
const CHANNELS = 4;

function alphaAt(pixels: ImageData, x: number, y: number): number {
  return pixels.data[(y * pixels.width + x) * CHANNELS + ALPHA_OFFSET];
}

/** G1 — a frame that paints its own border has been clipped by the cell wall. */
function gateEdgeBleed(baked: BakedSheet): void {
  const { spec, pixels } = baked;
  for (let frame = 0; frame < spec.frameCount; frame++) {
    const left = frame * spec.frameWidth;
    const right = left + spec.frameWidth - 1;
    const bottom = spec.frameHeight - 1;
    let worst = 0;
    for (let x = left; x <= right; x++) {
      worst = Math.max(worst, alphaAt(pixels, x, 0), alphaAt(pixels, x, bottom));
    }
    for (let y = 0; y <= bottom; y++) {
      worst = Math.max(worst, alphaAt(pixels, left, y), alphaAt(pixels, right, y));
    }
    if (worst > MAX_EDGE_ALPHA) {
      throw new Error(
        `G1: ${spec.key} frame ${frame} paints its own border at alpha ${worst}; the art is ` +
          `clipped by the frame. Grow the cell or shrink the effect.`,
      );
    }
  }
}

/** G2 — a frame that painted nothing is the signature of a NaN in the art. */
function gateBlankFrames(baked: BakedSheet): void {
  const { spec, pixels } = baked;
  for (let frame = 0; frame < spec.frameCount; frame++) {
    let painted = false;
    for (let y = 0; y < spec.frameHeight && !painted; y++) {
      for (let x = 0; x < spec.frameWidth; x++) {
        if (alphaAt(pixels, frame * spec.frameWidth + x, y) > MAX_EDGE_ALPHA) {
          painted = true;
          break;
        }
      }
    }
    if (!painted) throw new Error(`G2: ${spec.key} frame ${frame} painted nothing`);
  }
}

/**
 * G3 — the exponent-alpha trap, caught in the bake rather than in review.
 *
 * node-canvas drops an `rgba()` whose alpha serialises as `5e-17`, which turns
 * a gradient's transparent stop opaque and bakes a solid disc where a soft
 * cloud belongs. A cloud that is fully opaque anywhere is the signature.
 */
const MAX_CLOUD_ALPHA = 250;

function gateNoOpaqueSmear(baked: BakedSheet): void {
  const { spec, pixels } = baked;
  if (spec.key !== 'evil_clown_gas') return;
  let worst = 0;
  for (let y = 0; y < pixels.height; y++) {
    for (let x = 0; x < pixels.width; x++) worst = Math.max(worst, alphaAt(pixels, x, y));
  }
  if (worst > MAX_CLOUD_ALPHA) {
    throw new Error(
      `G3: ${spec.key} reaches alpha ${worst}; the cloud is meant to be see-through everywhere. ` +
        `A fully opaque pixel means a gradient stop lost its alpha — check for exponent-notation ` +
        `alphas reaching rgba().`,
    );
  }
}

const MANIFEST_PATH = 'src/images/effects/manifest.json';
const OUT_DIR = 'src/images/effects';

interface ManifestEntry {
  readonly path: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
  readonly tileScale: number;
  readonly states: Record<string, { readonly row: number; readonly frameCount: number }>;
}

function manifestEntryFor(spec: SheetSpec): ManifestEntry {
  return {
    path: `effects/${spec.file}`,
    frameWidth: spec.frameWidth,
    frameHeight: spec.frameHeight,
    tileX: spec.tileX,
    tileY: spec.tileY,
    tileScale: TILE_SCALE,
    states: { [spec.state]: { row: 0, frameCount: spec.frameCount } },
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

/** G4 — a sheet whose manifest entry does not describe it renders as garbage. */
function gateManifest(specs: readonly SheetSpec[]): void {
  const parsed: unknown = JSON.parse(readFileSync(resolve(MANIFEST_PATH), 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${MANIFEST_PATH} is not an object`);
  }
  const manifest: Record<string, unknown> = { ...parsed };
  const missing: string[] = [];
  for (const spec of specs) {
    const required = manifestEntryFor(spec);
    if (canonicalJson(manifest[spec.key]) !== canonicalJson(required)) {
      missing.push(`"${spec.key}": ${JSON.stringify(required, null, 2)}`);
    }
  }
  if (missing.length > 0) {
    console.error(
      `\n${MANIFEST_PATH} is out of sync with the bake. Set these entries:\n${missing.join(',\n')}\n`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`  manifest: ${MANIFEST_PATH} is in sync`);
}

function main(): void {
  console.log(`Generating Evil Clown vial sheets (tileScale=${TILE_SCALE})…`);
  const baked = SHEETS.map(bakeSheet);
  // Gated before anything reaches disk: a sheet that fails a gate must not be
  // the one sitting in src/images when the run ends.
  for (const sheet of baked) {
    gateEdgeBleed(sheet);
    gateBlankFrames(sheet);
    gateNoOpaqueSmear(sheet);
  }
  // Also before the write, and for the same reason: a sheet whose geometry has
  // drifted from the manifest must not be the one sitting in src/images when the
  // run reports a failure. This gate only reads the manifest, so it can run here.
  gateManifest(SHEETS);
  if (process.exitCode === 1) return;
  for (const sheet of baked) {
    writeFileSync(resolve(OUT_DIR, sheet.spec.file), sheet.buffer);
    console.log(
      `  → ${OUT_DIR}/${sheet.spec.file}  ` +
        `(${sheet.spec.frameCount} × ${sheet.spec.frameWidth}×${sheet.spec.frameHeight}, ` +
        `anchor ${sheet.spec.tileX},${sheet.spec.tileY})`,
    );
  }
}

main();
