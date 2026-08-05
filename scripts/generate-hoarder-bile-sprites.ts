#!/usr/bin/env tsx
/**
 * Bakes the Hoarder's bile sheets into `src/images/bosses/`:
 *
 *   hoarder_bile.png — one row, 8 looping frames of the bolus in flight
 *   hoarder_acid.png — splash / form / pool / fade, the pool's whole life
 *
 * Both sheets are baked into memory, measured, and only written once every gate
 * passes — a sheet that fails a gate must never reach disk.
 *
 * The manifest for `src/images/bosses/` is edited by hand rather than rewritten
 * here, for the reason `generate-vespa-spit-sprites.ts` gives: the directory
 * holds sheets this script knows nothing about. The two entries to paste are
 * printed at the end of a run so a manifest drift is caught by eye.
 *
 * Run: npx tsx scripts/generate-hoarder-bile-sprites.ts
 */

import { createCanvas } from 'canvas';
import type { CanvasRenderingContext2D as Ctx, ImageData } from 'canvas';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  BOLUS_ANCHOR,
  BOLUS_FRAME_COUNT,
  BOLUS_FRAME_SIZE,
  FADE_FRAME_COUNT,
  FORM_FRAME_COUNT,
  GAME_PIXELS_PER_AUTHORED_PIXEL,
  POOL_ANCHOR,
  POOL_FRAME_COUNT,
  POOL_FRAME_SIZE,
  RUNTIME_TILE_SIZE,
  SPLASH_FRAME_COUNT,
  TILE_SCALE,
  drawAcidFade,
  drawAcidForm,
  drawAcidPoolLoop,
  drawAcidSplash,
  drawHoarderBile,
} from './hoarderBileArt.js';

const OUT_DIR = resolve('src/images/bosses');
const BILE_SHEET_FILE = 'hoarder_bile.png';
const ACID_SHEET_FILE = 'hoarder_acid.png';
/** Manifest keys are unchanged from the sheet these replace, so asset groups do not churn. */
const BILE_MANIFEST_KEY = 'hoarder_vomit_arc';
const ACID_MANIFEST_KEY = 'hoarder_vomit_puddle';

const CHANNELS = 4;
const ALPHA_CHANNEL_OFFSET = 3;
const OPAQUE_ALPHA = 255;

// ── Gate limits ──────────────────────────────────────────────────────────────

/**
 * G1 — alpha a frame's outermost pixels may carry before the bake is rejected.
 * Anything above this means the art ran into the cell wall and was cut along a
 * straight line, permanently, in the PNG.
 */
const MAX_EDGE_ALPHA = 6;

/** G2 — a frame carrying fewer visible pixels than this is effectively empty. */
const MIN_INK_PIXELS = 64;
const INK_ALPHA_THRESHOLD = 8;

/** G3 — how far the loop seam may exceed the median consecutive-frame delta. */
const MAX_SEAM_RATIO = 2.2;

/** G4 — slack allowed against a strictly monotonic one-shot, as a fraction. */
const MONOTONIC_SLACK = 0.03;

/**
 * G5 — the pool's drawn radius must match the runtime's `ACID_PUDDLE_RADIUS`.
 * Every game pixel of mismatch is either damage dealt on floor that looks clean
 * or paint on floor that is safe.
 */
const TARGET_POOL_GAME_RADIUS = 64;
/**
 * How far short of the damage radius the art's *thinnest* bearing may fall.
 * Kept tight: this is the number that decides whether a player standing on
 * clean-looking floor takes damage.
 */
const POOL_COVERAGE_TOLERANCE_GAME_PX = 2;
/**
 * How far past the damage radius the art's longest runnel may reach. Paint that
 * promises damage it does not deal is the same lie pointing the other way.
 */
const MAX_POOL_OVERREACH_GAME_PX = 12;
/** Directions the footprint is sampled along. */
const FOOTPRINT_BEARINGS = 360;
/** Alpha at which the corroded rim counts as covering a pixel. */
const FOOTPRINT_ALPHA_THRESHOLD = 64;

/** G6 — sheet area above this is reported as a budget concern rather than a pass. */
const TEXTURE_BUDGET_MEGAPIXELS = 3;

// ── Pixel helpers ────────────────────────────────────────────────────────────

interface FrameRegion {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

function frameRegion(frameSize: number, column: number, row: number): FrameRegion {
  return { left: column * frameSize, top: row * frameSize, width: frameSize, height: frameSize };
}

function alphaAt(pixels: ImageData, x: number, y: number): number {
  return pixels.data[(y * pixels.width + x) * CHANNELS + ALPHA_CHANNEL_OFFSET];
}

/** The frame's alpha channel, flattened row-major, for frame-to-frame comparison. */
function frameAlpha(pixels: ImageData, region: FrameRegion): Float64Array {
  const out = new Float64Array(region.width * region.height);
  for (let y = 0; y < region.height; y++) {
    for (let x = 0; x < region.width; x++) {
      out[y * region.width + x] = alphaAt(pixels, region.left + x, region.top + y);
    }
  }
  return out;
}

function meanAbsoluteDifference(a: Float64Array, b: Float64Array): number {
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function inkPixelCount(pixels: ImageData, region: FrameRegion): number {
  let count = 0;
  for (let y = 0; y < region.height; y++) {
    for (let x = 0; x < region.width; x++) {
      if (alphaAt(pixels, region.left + x, region.top + y) >= INK_ALPHA_THRESHOLD) count++;
    }
  }
  return count;
}

/**
 * Total coverage in the frame, as a sum of alpha.
 *
 * The one-shot rows are gated on this rather than on a pixel count: a fading
 * pool keeps its area and loses its opacity, so a thresholded count reports it
 * as unchanged right up to the frame it disappears.
 */
function inkMass(pixels: ImageData, region: FrameRegion): number {
  let total = 0;
  for (let y = 0; y < region.height; y++) {
    for (let x = 0; x < region.width; x++) {
      total += alphaAt(pixels, region.left + x, region.top + y);
    }
  }
  return total / OPAQUE_ALPHA;
}

interface FootprintProfile {
  /** Furthest visible pixel from the anchor, in authored pixels. */
  readonly widest: number;
  /** Typical reach around the perimeter, in authored pixels. */
  readonly typical: number;
  /** Shortest reach in any direction, in authored pixels. */
  readonly shortest: number;
}

/**
 * How far the frame's ink reaches from its anchor, per direction.
 *
 * All three numbers matter, and the *shortest* matters most: a shape can touch
 * the damage radius with one spike while the rest of it sits far inside, which
 * passes a max-only check while the player stands on clean-looking floor and
 * takes damage.
 */
function footprintProfile(
  pixels: ImageData,
  region: FrameRegion,
  anchor: number,
): FootprintProfile {
  const reachByBearing = new Float64Array(FOOTPRINT_BEARINGS);
  let widestSquared = 0;
  for (let y = 0; y < region.height; y++) {
    for (let x = 0; x < region.width; x++) {
      if (alphaAt(pixels, region.left + x, region.top + y) < FOOTPRINT_ALPHA_THRESHOLD) continue;
      const dx = x + 0.5 - anchor;
      const dy = y + 0.5 - anchor;
      const distanceSquared = dx * dx + dy * dy;
      widestSquared = Math.max(widestSquared, distanceSquared);
      const bearing = Math.atan2(dy, dx);
      const bucket =
        Math.floor(((bearing + Math.PI) / (Math.PI * 2)) * FOOTPRINT_BEARINGS) % FOOTPRINT_BEARINGS;
      reachByBearing[bucket] = Math.max(reachByBearing[bucket], Math.sqrt(distanceSquared));
    }
  }
  const reaches = [...reachByBearing];
  return {
    widest: Math.sqrt(widestSquared),
    typical: median(reaches),
    shortest: Math.min(...reaches),
  };
}

// ── Gates ────────────────────────────────────────────────────────────────────

function gateEdgeBleed(
  pixels: ImageData,
  frameSize: number,
  columns: number,
  rows: number,
  label: string,
): void {
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const { left, top } = frameRegion(frameSize, column, row);
      const right = left + frameSize - 1;
      const bottom = top + frameSize - 1;
      let worst = 0;
      for (let x = left; x <= right; x++) {
        worst = Math.max(worst, alphaAt(pixels, x, top), alphaAt(pixels, x, bottom));
      }
      for (let y = top; y <= bottom; y++) {
        worst = Math.max(worst, alphaAt(pixels, left, y), alphaAt(pixels, right, y));
      }
      if (worst > MAX_EDGE_ALPHA) {
        throw new Error(
          `G1 ${label}: frame (row ${row}, column ${column}) paints its own border at alpha ` +
            `${worst}, limit ${MAX_EDGE_ALPHA}. The art is clipped by the frame — shrink the ` +
            `layer or grow the frame envelope.`,
        );
      }
    }
  }
}

function gateNoBlankFrames(
  pixels: ImageData,
  frameSize: number,
  columns: number,
  row: number,
  label: string,
): void {
  for (let column = 0; column < columns; column++) {
    const count = inkPixelCount(pixels, frameRegion(frameSize, column, row));
    if (count < MIN_INK_PIXELS) {
      throw new Error(
        `G2 ${label}: frame ${column} carries ${count} visible pixels, minimum ${MIN_INK_PIXELS}. ` +
          `The frame is blank or all but blank.`,
      );
    }
  }
}

function gateLoopCloses(
  pixels: ImageData,
  frameSize: number,
  columns: number,
  row: number,
  label: string,
): void {
  const frames: Float64Array[] = [];
  for (let column = 0; column < columns; column++) {
    frames.push(frameAlpha(pixels, frameRegion(frameSize, column, row)));
  }
  const steps: number[] = [];
  for (let i = 0; i + 1 < frames.length; i++) {
    steps.push(meanAbsoluteDifference(frames[i], frames[i + 1]));
  }
  const seam = meanAbsoluteDifference(frames[frames.length - 1], frames[0]);
  const typical = median(steps);
  const limit = typical * MAX_SEAM_RATIO;
  if (seam > limit) {
    throw new Error(
      `G3 ${label}: the loop seam is ${seam.toFixed(2)} against a median step of ` +
        `${typical.toFixed(2)} (limit ${limit.toFixed(2)}). The row pops once per cycle.`,
    );
  }
  console.log(
    `  G3 ${label} loop seam ${seam.toFixed(2)} vs median step ${typical.toFixed(2)} — pass`,
  );
}

function gateMonotonicMass(
  pixels: ImageData,
  frameSize: number,
  columns: number,
  row: number,
  direction: 'grows' | 'shrinks',
  label: string,
): void {
  const masses: number[] = [];
  for (let column = 0; column < columns; column++) {
    masses.push(inkMass(pixels, frameRegion(frameSize, column, row)));
  }
  for (let i = 0; i + 1 < masses.length; i++) {
    const previous = masses[i];
    const next = masses[i + 1];
    const allowed =
      direction === 'grows' ? previous * (1 - MONOTONIC_SLACK) : previous * (1 + MONOTONIC_SLACK);
    const failed = direction === 'grows' ? next < allowed : next > allowed;
    if (failed) {
      throw new Error(
        `G4 ${label}: the row must ${direction}, but frame ${i} carries ${previous.toFixed(0)} ` +
          `coverage and frame ${i + 1} carries ${next.toFixed(0)} (allowed ${allowed.toFixed(0)} ` +
          `at ${(MONOTONIC_SLACK * 100).toFixed(0)}% slack).`,
      );
    }
  }
  console.log(
    `  G4 ${label} coverage ${masses.map((m) => m.toFixed(0)).join(' → ')} — ${direction}, pass`,
  );
}

function gatePoolFootprint(pixels: ImageData, row: number): void {
  const profiles: FootprintProfile[] = [];
  for (let column = 0; column < POOL_FRAME_COUNT; column++) {
    profiles.push(footprintProfile(pixels, frameRegion(POOL_FRAME_SIZE, column, row), POOL_ANCHOR));
  }
  const toGame = (authored: number): number => authored * GAME_PIXELS_PER_AUTHORED_PIXEL;
  const shortestAuthored = Math.min(...profiles.map((profile) => profile.shortest));
  const typicalAuthored = median(profiles.map((profile) => profile.typical));
  const widestAuthored = Math.max(...profiles.map((profile) => profile.widest));
  const shortestGame = toGame(shortestAuthored);
  const typicalGame = toGame(typicalAuthored);
  const widestGame = toGame(widestAuthored);

  console.log(
    `  G5 pool footprint vs a ${TARGET_POOL_GAME_RADIUS} game px damage radius, at TILE_SIZE ` +
      `${RUNTIME_TILE_SIZE}: shortest reach ${shortestAuthored.toFixed(1)} authored = ` +
      `${shortestGame.toFixed(1)} game px, typical ${typicalAuthored.toFixed(1)} = ` +
      `${typicalGame.toFixed(1)}, widest ${widestAuthored.toFixed(1)} = ${widestGame.toFixed(1)}`,
  );

  if (shortestGame < TARGET_POOL_GAME_RADIUS - POOL_COVERAGE_TOLERANCE_GAME_PX) {
    throw new Error(
      `G5a pool coverage: the pool's shortest reach is ${shortestGame.toFixed(1)} game px but it ` +
        `damages out to ${TARGET_POOL_GAME_RADIUS} game px, so ` +
        `${(TARGET_POOL_GAME_RADIUS - shortestGame).toFixed(1)} px of live hazard is painted as ` +
        `clean floor (tolerance ${POOL_COVERAGE_TOLERANCE_GAME_PX} px). The nominal radius is the ` +
        `FLOOR of the rim profile, never its mean — make the raggedness outward-only.`,
    );
  }
  if (widestGame > TARGET_POOL_GAME_RADIUS + MAX_POOL_OVERREACH_GAME_PX) {
    throw new Error(
      `G5b pool overreach: the pool draws out to ${widestGame.toFixed(1)} game px against a ` +
        `${TARGET_POOL_GAME_RADIUS} px damage radius, ` +
        `${(widestGame - TARGET_POOL_GAME_RADIUS).toFixed(1)} px past it (limit ` +
        `${MAX_POOL_OVERREACH_GAME_PX}). Paint that promises damage it does not deal is the same ` +
        `lie in the other direction.`,
    );
  }
  console.log(
    `  G5 pool footprint: covers ${shortestGame.toFixed(1)} ≥ ` +
      `${TARGET_POOL_GAME_RADIUS - POOL_COVERAGE_TOLERANCE_GAME_PX}, overreaches to ` +
      `${widestGame.toFixed(1)} ≤ ${TARGET_POOL_GAME_RADIUS + MAX_POOL_OVERREACH_GAME_PX} — pass`,
  );
}

function reportTextureSize(width: number, height: number, label: string): void {
  const MEGA = 1_000_000;
  const megapixels = (width * height) / MEGA;
  const verdict = megapixels > TEXTURE_BUDGET_MEGAPIXELS ? 'OVER BUDGET' : 'within budget';
  console.log(
    `  G6 ${label} texture ${width}×${height}px = ${megapixels.toFixed(2)} MP ` +
      `(budget ${TEXTURE_BUDGET_MEGAPIXELS} MP) — ${verdict}`,
  );
}

// ── Baking ───────────────────────────────────────────────────────────────────

type FramePainter = (ctx: Ctx, cx: number, cy: number, frame: number, frameCount: number) => void;

interface SheetRow {
  readonly state: string;
  readonly frameCount: number;
  readonly paint: FramePainter;
}

interface BakedSheet {
  readonly pixels: ImageData;
  readonly buffer: Buffer;
  readonly width: number;
  readonly height: number;
}

function bakeSheet(rows: readonly SheetRow[], frameSize: number, anchor: number): BakedSheet {
  const columns = Math.max(...rows.map((row) => row.frameCount));
  const canvas = createCanvas(columns * frameSize, rows.length * frameSize);
  const ctx = canvas.getContext('2d');

  rows.forEach((row, rowIndex) => {
    for (let frame = 0; frame < row.frameCount; frame++) {
      const cellX = frame * frameSize;
      const cellY = rowIndex * frameSize;
      ctx.save();
      // Clipping is what stops a long drool or a fume wisp bleeding into the
      // neighbouring cell, which would show in game as a ghost of another frame.
      ctx.beginPath();
      ctx.rect(cellX, cellY, frameSize, frameSize);
      ctx.clip();
      row.paint(ctx, cellX + anchor, cellY + anchor, frame, row.frameCount);
      ctx.restore();
    }
  });

  return {
    pixels: ctx.getImageData(0, 0, canvas.width, canvas.height),
    buffer: canvas.toBuffer('image/png'),
    width: canvas.width,
    height: canvas.height,
  };
}

const BILE_ROWS: readonly SheetRow[] = [
  { state: 'arc', frameCount: BOLUS_FRAME_COUNT, paint: drawHoarderBile },
];

const ACID_ROWS: readonly SheetRow[] = [
  { state: 'splash', frameCount: SPLASH_FRAME_COUNT, paint: drawAcidSplash },
  { state: 'form', frameCount: FORM_FRAME_COUNT, paint: drawAcidForm },
  { state: 'pool', frameCount: POOL_FRAME_COUNT, paint: drawAcidPoolLoop },
  { state: 'fade', frameCount: FADE_FRAME_COUNT, paint: drawAcidFade },
];

const SPLASH_ROW = 0;
const FORM_ROW = 1;
const POOL_ROW = 2;
const FADE_ROW = 3;

function manifestEntry(
  key: string,
  file: string,
  frameSize: number,
  anchor: number,
  rows: readonly SheetRow[],
): string {
  const states = rows
    .map(
      (row, index) =>
        `      "${row.state}": {\n        "row": ${index},\n        "frameCount": ${row.frameCount}\n      }`,
    )
    .join(',\n');
  return (
    `  "${key}": {\n` +
    `    "path": "bosses/${file}",\n` +
    `    "frameWidth": ${frameSize},\n` +
    `    "frameHeight": ${frameSize},\n` +
    `    "tileX": ${anchor},\n` +
    `    "tileY": ${anchor},\n` +
    `    "tileScale": ${TILE_SCALE},\n` +
    `    "states": {\n${states}\n    }\n` +
    `  }`
  );
}

console.log(`${BILE_SHEET_FILE}`);
const bile = bakeSheet(BILE_ROWS, BOLUS_FRAME_SIZE, BOLUS_ANCHOR);
gateEdgeBleed(bile.pixels, BOLUS_FRAME_SIZE, BOLUS_FRAME_COUNT, BILE_ROWS.length, 'hoarder_bile');
gateNoBlankFrames(bile.pixels, BOLUS_FRAME_SIZE, BOLUS_FRAME_COUNT, 0, 'hoarder_bile arc');
gateLoopCloses(bile.pixels, BOLUS_FRAME_SIZE, BOLUS_FRAME_COUNT, 0, 'hoarder_bile arc');
reportTextureSize(bile.width, bile.height, 'hoarder_bile');

/**
 * `G7` — the row lengths the runtime declares are the ones the sheets have.
 *
 * `drawSprite` clamps the frame index, so a row that lost a frame does not
 * error: it freezes on its last cell and the effect quietly stops short. The
 * runtime cannot import from `scripts/`, so the counts are duplicated in
 * `src/sprites/hoarderBileSprite.ts` and this is what holds the two equal.
 */
const RUNTIME_SPRITE_SOURCE = 'src/sprites/hoarderBileSprite.ts';
const RUNTIME_SPRITE_MODULE = '../src/sprites/hoarderBileSprite.js';

const RUNTIME_FRAME_EXPORTS: ReadonlyArray<{ readonly name: string; readonly baked: number }> = [
  { name: 'BILE_ARC_FRAMES', baked: BOLUS_FRAME_COUNT },
  { name: 'ACID_SPLASH_FRAMES', baked: SPLASH_FRAME_COUNT },
  { name: 'ACID_FORM_FRAMES', baked: FORM_FRAME_COUNT },
  { name: 'ACID_POOL_FRAMES', baked: POOL_FRAME_COUNT },
  { name: 'ACID_FADE_FRAMES', baked: FADE_FRAME_COUNT },
];

async function gateRuntimeContract(): Promise<void> {
  if (!existsSync(resolve(RUNTIME_SPRITE_SOURCE))) {
    console.log(`  G7 ${RUNTIME_SPRITE_SOURCE} does not exist yet — nothing to hold the bake to`);
    return;
  }
  // Held in a variable on purpose: written as a literal this import resolves at
  // compile time, and the whole script stops typechecking on any checkout where
  // the runtime module has not landed.
  const specifier = RUNTIME_SPRITE_MODULE;
  const loaded: unknown = await import(specifier);
  if (typeof loaded !== 'object' || loaded === null) {
    throw new Error(`G7 ${RUNTIME_SPRITE_SOURCE} did not load as a module`);
  }
  const namespace: Record<string, unknown> = { ...loaded };
  for (const { name, baked } of RUNTIME_FRAME_EXPORTS) {
    const declared: unknown = namespace[name];
    if (typeof declared !== 'number') {
      throw new Error(`G7 ${RUNTIME_SPRITE_SOURCE} does not export ${name} as a number`);
    }
    if (declared !== baked) {
      throw new Error(
        `G7 the bake produces ${baked} frames where the runtime's ${name} declares ${declared}; ` +
          `the shorter of the two is the one that freezes`,
      );
    }
  }
  console.log(`  G7 runtime frame counts match the bake — pass`);
}

console.log(`\n${ACID_SHEET_FILE}`);
const acid = bakeSheet(ACID_ROWS, POOL_FRAME_SIZE, POOL_ANCHOR);
// The edge-bleed sweep runs over the full grid, including the short rows' unused
// cells, which are empty and therefore always pass.
gateEdgeBleed(
  acid.pixels,
  POOL_FRAME_SIZE,
  Math.max(...ACID_ROWS.map((row) => row.frameCount)),
  ACID_ROWS.length,
  'hoarder_acid',
);
ACID_ROWS.forEach((row, index) => {
  gateNoBlankFrames(
    acid.pixels,
    POOL_FRAME_SIZE,
    row.frameCount,
    index,
    `hoarder_acid ${row.state}`,
  );
});
gateLoopCloses(acid.pixels, POOL_FRAME_SIZE, POOL_FRAME_COUNT, POOL_ROW, 'hoarder_acid pool');
gateMonotonicMass(
  acid.pixels,
  POOL_FRAME_SIZE,
  FORM_FRAME_COUNT,
  FORM_ROW,
  'grows',
  'hoarder_acid form',
);
gateMonotonicMass(
  acid.pixels,
  POOL_FRAME_SIZE,
  FADE_FRAME_COUNT,
  FADE_ROW,
  'shrinks',
  'hoarder_acid fade',
);
gatePoolFootprint(acid.pixels, POOL_ROW);
reportTextureSize(acid.width, acid.height, 'hoarder_acid');
await gateRuntimeContract();

writeFileSync(resolve(OUT_DIR, BILE_SHEET_FILE), bile.buffer);
writeFileSync(resolve(OUT_DIR, ACID_SHEET_FILE), acid.buffer);
console.log(
  `\nWrote ${BILE_SHEET_FILE} (${bile.width}×${bile.height}) and ${ACID_SHEET_FILE} (${acid.width}×${acid.height})`,
);

console.log(`\nManifest entries for src/images/bosses/manifest.json:\n`);
console.log(
  manifestEntry(BILE_MANIFEST_KEY, BILE_SHEET_FILE, BOLUS_FRAME_SIZE, BOLUS_ANCHOR, BILE_ROWS),
);
console.log(
  manifestEntry(ACID_MANIFEST_KEY, ACID_SHEET_FILE, POOL_FRAME_SIZE, POOL_ANCHOR, ACID_ROWS),
);
console.log(
  `\nSplash row ${SPLASH_ROW}, form row ${FORM_ROW}, pool row ${POOL_ROW}, fade row ${FADE_ROW}.`,
);
