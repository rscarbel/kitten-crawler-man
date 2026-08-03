#!/usr/bin/env tsx
/**
 * Bakes the Lava Llama's projectile sheets into `src/images/effects/`.
 *
 *   llama_lava_bolt.png  — the ball in flight, one looping row
 *   llama_lava_burst.png — the impact explosion, one one-shot row
 *   llama_lava_flame.png — the fire patch left behind, one looping row
 *
 * The painting lives in `scripts/lavaBallArt.ts`; this file is the frame
 * geometry, the bake and the gates.
 *
 * The manifest for `src/images/effects/` is checked rather than rewritten: that
 * directory also holds the shell, blood, missile and icon sheets this script
 * knows nothing about, and a programmatic rewrite of a shared file clobbers
 * other agents' edits.
 *
 * Run: npm run gen:lava-ball
 */

import { createCanvas, type CanvasRenderingContext2D as Ctx, type ImageData } from 'canvas';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  BOLT_RADIUS,
  BURST_REACH,
  FLAME_RADIUS,
  drawLavaBolt,
  drawLavaBurst,
  drawLavaFlame,
} from './lavaBallArt.js';

/** Tile size the art is drawn at; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;
/** Frames are rendered at this multiple and downsampled for smoother edges. */
const SUPERSAMPLE = 2;
const MAX_PNG_COMPRESSION = 9;

/**
 * Alpha a frame's outermost pixels may carry before the bake is rejected.
 *
 * Anything above this means the art ran into the cell wall and was cut along a
 * straight line — permanently, in the PNG. The bolt is drawn rotated to its
 * heading, so such a cut sweeps around with the ball and is impossible to miss.
 */
const MAX_EDGE_ALPHA = 6;

export interface SheetSpec {
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

const BOLT_FRAMES = 8;
const BURST_FRAMES = 10;
const FLAME_FRAMES = 8;

/**
 * The bolt's cell is long and its anchor sits well to the right of centre: the
 * ball is at the anchor and the whole trail streams out behind it, so a
 * centred anchor would put half the cell in front of a projectile that has
 * nothing to draw there.
 */
const BOLT_FRAME_WIDTH = 112;
const BOLT_FRAME_HEIGHT = 80;
const BOLT_ANCHOR_X = 72;

const BURST_FRAME_SIZE = 128;
const FLAME_FRAME_WIDTH = 96;
const FLAME_FRAME_HEIGHT = 104;
/**
 * The flame's anchor is its base, not its centre: the patch sits on a floor
 * tile and the tongues rise off it, so anchoring at the centre would sink the
 * fire half a tile into the ground as it grew.
 */
const FLAME_ANCHOR_Y = 62;

/** Loops sample the cycle evenly; one-shots sample the middle of each frame. */
function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

function shotProgress(frame: number, frameCount: number): number {
  return (frame + 0.5) / frameCount;
}

export const SHEETS: readonly SheetSpec[] = [
  {
    key: 'llama_lava_bolt',
    file: 'llama_lava_bolt.png',
    state: 'fly',
    frameWidth: BOLT_FRAME_WIDTH,
    frameHeight: BOLT_FRAME_HEIGHT,
    tileX: BOLT_ANCHOR_X,
    tileY: BOLT_FRAME_HEIGHT / 2,
    frameCount: BOLT_FRAMES,
    paint: (ctx, frame) => {
      ctx.scale(TILE_SCALE, TILE_SCALE);
      drawLavaBolt(ctx, cyclePhase(frame, BOLT_FRAMES));
    },
  },
  {
    key: 'llama_lava_burst',
    file: 'llama_lava_burst.png',
    state: 'burst',
    frameWidth: BURST_FRAME_SIZE,
    frameHeight: BURST_FRAME_SIZE,
    tileX: BURST_FRAME_SIZE / 2,
    tileY: BURST_FRAME_SIZE / 2,
    frameCount: BURST_FRAMES,
    paint: (ctx, frame) => {
      ctx.scale(TILE_SCALE, TILE_SCALE);
      drawLavaBurst(ctx, shotProgress(frame, BURST_FRAMES));
    },
  },
  {
    key: 'llama_lava_flame',
    file: 'llama_lava_flame.png',
    state: 'burn',
    frameWidth: FLAME_FRAME_WIDTH,
    frameHeight: FLAME_FRAME_HEIGHT,
    tileX: FLAME_FRAME_WIDTH / 2,
    tileY: FLAME_ANCHOR_Y,
    frameCount: FLAME_FRAMES,
    paint: (ctx, frame) => {
      ctx.scale(TILE_SCALE, TILE_SCALE);
      drawLavaFlame(ctx, cyclePhase(frame, FLAME_FRAMES), 1);
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

/** G1 — a frame that paints its own border has been clipped by the cell wall. */
function gateEdgeBleed(baked: BakedSheet): void {
  const { spec, pixels } = baked;
  const ALPHA_OFFSET = 3;
  const CHANNELS = 4;
  const alphaAt = (x: number, y: number): number =>
    pixels.data[(y * pixels.width + x) * CHANNELS + ALPHA_OFFSET];

  for (let frame = 0; frame < spec.frameCount; frame++) {
    const left = frame * spec.frameWidth;
    const right = left + spec.frameWidth - 1;
    const bottom = spec.frameHeight - 1;
    let worst = 0;
    for (let x = left; x <= right; x++) worst = Math.max(worst, alphaAt(x, 0), alphaAt(x, bottom));
    for (let y = 0; y <= bottom; y++) worst = Math.max(worst, alphaAt(left, y), alphaAt(right, y));
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
  const ALPHA_OFFSET = 3;
  const CHANNELS = 4;
  for (let frame = 0; frame < spec.frameCount; frame++) {
    let painted = false;
    for (let y = 0; y < spec.frameHeight && !painted; y++) {
      for (let x = 0; x < spec.frameWidth; x++) {
        const sx = frame * spec.frameWidth + x;
        if (pixels.data[(y * pixels.width + sx) * CHANNELS + ALPHA_OFFSET] > MAX_EDGE_ALPHA) {
          painted = true;
          break;
        }
      }
    }
    if (!painted) throw new Error(`G2: ${spec.key} frame ${frame} painted nothing`);
  }
}

/**
 * G3 — the effect has to actually fill the cell it costs.
 *
 * A frame envelope grown to clear a gate and then never shrunk back is invisible
 * in review and costs memory on every sheet that shares the geometry, so a cell
 * whose art uses less than this fraction of its own width is a failure.
 */
const MIN_INK_SPAN = 0.35;

function gateInkSpan(baked: BakedSheet): void {
  const { spec, pixels } = baked;
  const ALPHA_OFFSET = 3;
  const CHANNELS = 4;
  // The *widest* frame, not the first: a one-shot burst legitimately opens on a
  // few pixels, and judging the envelope by that frame would reject every
  // explosion ever drawn. What the cell has to be justified by is its peak.
  let widest = 0;
  for (let frame = 0; frame < spec.frameCount; frame++) {
    let minX = Infinity;
    let maxX = -Infinity;
    for (let y = 0; y < spec.frameHeight; y++) {
      for (let x = 0; x < spec.frameWidth; x++) {
        const sx = frame * spec.frameWidth + x;
        if (pixels.data[(y * pixels.width + sx) * CHANNELS + ALPHA_OFFSET] <= MAX_EDGE_ALPHA) {
          continue;
        }
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    if (minX === Infinity) continue;
    widest = Math.max(widest, (maxX - minX) / spec.frameWidth);
  }
  if (widest < MIN_INK_SPAN) {
    throw new Error(
      `G3: ${spec.key} never spans more than ${(widest * 100).toFixed(0)}% of its cell width; ` +
        `shrink the frame envelope rather than paying for empty pixels on every frame.`,
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
  console.log(`Generating lava-ball sheets (tileScale=${TILE_SCALE})…`);
  console.log(
    `  bolt r=${BOLT_RADIUS}  burst reach=${BURST_REACH}  flame r=${FLAME_RADIUS} (tile units)`,
  );
  // Baked to memory and gated before anything reaches disk: a sheet that fails a
  // gate must not be the one sitting in src/images when the run ends.
  const baked = SHEETS.map(bakeSheet);
  for (const sheet of baked) {
    gateEdgeBleed(sheet);
    gateBlankFrames(sheet);
    gateInkSpan(sheet);
  }
  for (const sheet of baked) {
    writeFileSync(resolve(OUT_DIR, sheet.spec.file), sheet.buffer);
    console.log(
      `  → ${OUT_DIR}/${sheet.spec.file}  ` +
        `(${sheet.spec.frameCount} × ${sheet.spec.frameWidth}×${sheet.spec.frameHeight}, ` +
        `anchor ${sheet.spec.tileX},${sheet.spec.tileY})`,
    );
  }
  gateManifest(SHEETS);
}

main();
