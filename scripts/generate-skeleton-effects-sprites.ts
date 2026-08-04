#!/usr/bin/env tsx
/**
 * Bakes the Skeleton Lord's four effect sheets into `src/images/effects/`.
 *
 *   skeleton_soul_bolt.png      — the projectile in flight, one looping row
 *   skeleton_soul_burst.png     — the impact, one one-shot row
 *   skeleton_bone_arrow.png     — one frame, pointing along +X
 *   skeleton_grasping_hands.png — the ground eruption, one looping row
 *
 * The painting lives in `scripts/skeletonEffectsArt.ts`; this file is the frame
 * geometry, the bake and the gates.
 *
 * The manifest for `src/images/effects/` is checked rather than rewritten: that
 * directory also holds the shell, blood, missile, lava and icon sheets this
 * script knows nothing about, and a programmatic rewrite of a shared file
 * clobbers other agents' edits.
 *
 * Run: npm run gen:skeleton-effects
 */

import { createCanvas, type CanvasRenderingContext2D as Ctx, type ImageData } from 'canvas';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  ARROW_HALF_HEIGHT,
  ARROW_HALF_LENGTH,
  BOLT_REACH,
  BURST_REACH,
  HANDS_GROUND_Y,
  HANDS_PATCH_HALF_WIDTH,
  drawBoneArrow,
  drawGraspingHands,
  drawSoulBolt,
  drawSoulBurst,
} from './skeletonEffectsArt.js';

/** Tile size the art is drawn at; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;
/** Frames are rendered at this multiple and downsampled for smoother edges. */
const SUPERSAMPLE = 2;
const MAX_PNG_COMPRESSION = 9;

/**
 * Alpha a pixel may carry before it counts as ink.
 *
 * Downsampling a supersampled cell leaves a haze of near-zero alpha around
 * everything, and a gate that counted that haze would measure the antialiaser
 * rather than the art.
 */
const INK_ALPHA = 6;

const ALPHA_OFFSET = 3;
const CHANNELS = 4;

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
  /** `--only=` selector for the review harness. */
  readonly alias: string;
  readonly paint: (ctx: Ctx, frame: number) => void;
}

const BOLT_FRAMES = 8;
const BURST_FRAMES = 10;
const HANDS_FRAMES = 8;
const ARROW_FRAMES = 1;

/**
 * Cell sizes.
 *
 * Each is the art's own reach, doubled, plus a margin — measured from the tile
 * units the painter declares rather than picked by eye, so retuning an effect's
 * reach cannot silently start clipping it against the cell wall.
 */
const CELL_MARGIN_TILES = 0.16;
function cellSpan(halfExtentTiles: number): number {
  return Math.ceil(((halfExtentTiles + CELL_MARGIN_TILES) * 2 * TILE_SCALE) / 2) * 2;
}

const BOLT_CELL = cellSpan(BOLT_REACH);
/** Wisps are flung past the ring at up to this multiple of the burst's reach. */
const BURST_WISP_OVERREACH = 1.4;
const BURST_CELL = cellSpan(BURST_REACH * BURST_WISP_OVERREACH);
const ARROW_CELL_WIDTH = cellSpan(ARROW_HALF_LENGTH);
const ARROW_CELL_HEIGHT = cellSpan(ARROW_HALF_HEIGHT);
/** A hand reaches further above the soil than the patch is wide. */
const HANDS_HALF_EXTENT = 0.76;
const HANDS_CELL = cellSpan(Math.max(HANDS_HALF_EXTENT, HANDS_PATCH_HALF_WIDTH));

/** Loops sample the cycle evenly; one-shots sample the middle of each frame. */
function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

function shotProgress(frame: number, frameCount: number): number {
  return (frame + 0.5) / frameCount;
}

export const ROWS: readonly SheetSpec[] = [
  {
    key: 'skeleton_soul_bolt',
    file: 'skeleton_soul_bolt.png',
    state: 'fly',
    alias: 'bolt',
    frameWidth: BOLT_CELL,
    frameHeight: BOLT_CELL,
    tileX: BOLT_CELL / 2,
    tileY: BOLT_CELL / 2,
    frameCount: BOLT_FRAMES,
    paint: (ctx, frame) => {
      ctx.scale(TILE_SCALE, TILE_SCALE);
      drawSoulBolt(ctx, cyclePhase(frame, BOLT_FRAMES));
    },
  },
  {
    key: 'skeleton_soul_burst',
    file: 'skeleton_soul_burst.png',
    state: 'burst',
    alias: 'burst',
    frameWidth: BURST_CELL,
    frameHeight: BURST_CELL,
    tileX: BURST_CELL / 2,
    tileY: BURST_CELL / 2,
    frameCount: BURST_FRAMES,
    paint: (ctx, frame) => {
      ctx.scale(TILE_SCALE, TILE_SCALE);
      drawSoulBurst(ctx, shotProgress(frame, BURST_FRAMES));
    },
  },
  {
    key: 'skeleton_bone_arrow',
    file: 'skeleton_bone_arrow.png',
    state: 'fly',
    alias: 'arrow',
    frameWidth: ARROW_CELL_WIDTH,
    frameHeight: ARROW_CELL_HEIGHT,
    tileX: ARROW_CELL_WIDTH / 2,
    tileY: ARROW_CELL_HEIGHT / 2,
    frameCount: ARROW_FRAMES,
    paint: (ctx) => {
      ctx.scale(TILE_SCALE, TILE_SCALE);
      drawBoneArrow(ctx);
    },
  },
  {
    key: 'skeleton_grasping_hands',
    file: 'skeleton_grasping_hands.png',
    state: 'erupt',
    alias: 'hands',
    frameWidth: HANDS_CELL,
    frameHeight: HANDS_CELL,
    tileX: HANDS_CELL / 2,
    tileY: HANDS_CELL / 2,
    frameCount: HANDS_FRAMES,
    paint: (ctx, frame) => {
      ctx.scale(TILE_SCALE, TILE_SCALE);
      drawGraspingHands(ctx, cyclePhase(frame, HANDS_FRAMES));
    },
  },
];

const OUT_DIR = 'src/images/effects';

/** Where each baked sheet lands, by manifest key — the harness loads these. */
export const SHEET_PATHS: Readonly<Record<string, string>> = Object.fromEntries(
  ROWS.map((row) => [row.key, `${OUT_DIR}/${row.file}`]),
);

export interface BakedSheet {
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

/** Bakes every sheet to memory. Exported so the review harness can reuse it. */
export function bake(): readonly BakedSheet[] {
  return ROWS.map(bakeSheet);
}

function alphaAt(baked: BakedSheet, frame: number, x: number, y: number): number {
  const { pixels, spec } = baked;
  const sx = frame * spec.frameWidth + x;
  return pixels.data[(y * pixels.width + sx) * CHANNELS + ALPHA_OFFSET] ?? 0;
}

interface InkBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly pixels: number;
}

function inkBoundsOf(baked: BakedSheet, frame: number): InkBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let pixels = 0;
  for (let y = 0; y < baked.spec.frameHeight; y++) {
    for (let x = 0; x < baked.spec.frameWidth; x++) {
      if (alphaAt(baked, frame, x, y) <= INK_ALPHA) continue;
      pixels++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, maxX, minY, maxY, pixels };
}

/** G1 — a frame that paints its own border has been clipped by the cell wall. */
function gateEdgeBleed(baked: BakedSheet): void {
  const { spec } = baked;
  for (let frame = 0; frame < spec.frameCount; frame++) {
    const bottom = spec.frameHeight - 1;
    const right = spec.frameWidth - 1;
    let worst = 0;
    for (let x = 0; x <= right; x++) {
      worst = Math.max(worst, alphaAt(baked, frame, x, 0), alphaAt(baked, frame, x, bottom));
    }
    for (let y = 0; y <= bottom; y++) {
      worst = Math.max(worst, alphaAt(baked, frame, 0, y), alphaAt(baked, frame, right, y));
    }
    if (worst > INK_ALPHA) {
      throw new Error(
        `G1: ${spec.key} frame ${frame} paints its own border at alpha ${worst}; the art is ` +
          `clipped by the frame. Grow the cell or shrink the effect.`,
      );
    }
  }
}

/** G2 — a frame that painted nothing is the signature of a NaN in the art. */
function gateBlankFrames(baked: BakedSheet): void {
  for (let frame = 0; frame < baked.spec.frameCount; frame++) {
    if (inkBoundsOf(baked, frame).pixels === 0) {
      throw new Error(`G2: ${baked.spec.key} frame ${frame} painted nothing`);
    }
  }
}

/**
 * G3 — the effect has to actually fill the cell it costs.
 *
 * A frame envelope grown to clear a gate and then never shrunk back is
 * invisible in review and costs memory on every frame of the sheet, so a cell
 * whose art never spans this fraction of its own width is a failure. Judged on
 * the widest frame: a one-shot burst legitimately opens small.
 */
const MIN_INK_SPAN = 0.35;

function gateInkSpan(baked: BakedSheet): void {
  const { spec } = baked;
  let widest = 0;
  for (let frame = 0; frame < spec.frameCount; frame++) {
    const ink = inkBoundsOf(baked, frame);
    if (ink.pixels === 0) continue;
    widest = Math.max(widest, (ink.maxX - ink.minX) / spec.frameWidth);
  }
  if (widest < MIN_INK_SPAN) {
    throw new Error(
      `G3: ${spec.key} never spans more than ${(widest * 100).toFixed(0)}% of its cell width; ` +
        `shrink the frame envelope rather than paying for empty pixels on every frame.`,
    );
  }
}

/**
 * G4 — the bolt loop has to move.
 *
 * The whole point of the bolt sheet is that it does not read as a plain circle,
 * and the runtime rotates nothing: if consecutive frames are near-identical the
 * player sees a static green dot slide across the floor.
 *
 * Measured per pixel rather than on ink area, because the glow's footprint is
 * the same every frame — an area comparison would pass a loop whose only
 * moving parts had been deleted.
 */
const MIN_LOOP_FRAME_CHANGE = 0.06;
/** Alpha difference at which a pixel counts as having changed between frames. */
const FRAME_CHANGE_ALPHA = 24;

function gateLoopMotion(baked: BakedSheet): void {
  const { spec } = baked;
  let worstChange = Infinity;
  for (let frame = 0; frame < spec.frameCount; frame++) {
    const next = (frame + 1) % spec.frameCount;
    let changed = 0;
    let inked = 0;
    for (let y = 0; y < spec.frameHeight; y++) {
      for (let x = 0; x < spec.frameWidth; x++) {
        const a = alphaAt(baked, frame, x, y);
        const b = alphaAt(baked, next, x, y);
        if (a > INK_ALPHA || b > INK_ALPHA) inked++;
        if (Math.abs(a - b) >= FRAME_CHANGE_ALPHA) changed++;
      }
    }
    if (inked === 0) throw new Error(`G4: ${spec.key} frames ${frame}/${next} have no ink`);
    worstChange = Math.min(worstChange, changed / inked);
  }
  if (worstChange < MIN_LOOP_FRAME_CHANGE) {
    throw new Error(
      `G4: ${spec.key} changes only ${(worstChange * 100).toFixed(1)}% of its inked pixels ` +
        `between some pair of consecutive frames; the loop reads as a still.`,
    );
  }
}

/**
 * G5 — a burst has to expand.
 *
 * An impact whose ink is widest on its first frame is a disc shrinking, which
 * is the failure this effect exists to avoid.
 */
const MIN_BURST_GROWTH = 1.4;

function gateBurstExpands(baked: BakedSheet): void {
  const { spec } = baked;
  const first = inkBoundsOf(baked, 0);
  let widest = first.maxX - first.minX;
  let widestFrame = 0;
  for (let frame = 1; frame < spec.frameCount; frame++) {
    const ink = inkBoundsOf(baked, frame);
    if (ink.pixels === 0) continue;
    if (ink.maxX - ink.minX > widest) {
      widest = ink.maxX - ink.minX;
      widestFrame = frame;
    }
  }
  const growth = widest / Math.max(1, first.maxX - first.minX);
  if (widestFrame === 0 || growth < MIN_BURST_GROWTH) {
    throw new Error(
      `G5: ${spec.key} peaks at frame ${widestFrame} with only ${growth.toFixed(2)}× the ink ` +
        `width of frame 0; the burst reads as a shrinking disc rather than a dissipation.`,
    );
  }
}

/**
 * G6 — the arrow has to point along +X.
 *
 * `drawSpriteRotatedCenter` rotates this cell by the projectile's heading, so a
 * frame drawn pointing anywhere else flies permanently sideways.
 */
const MIN_ARROW_ASPECT = 2.5;

function gateArrowAimsAlongX(baked: BakedSheet): void {
  const ink = inkBoundsOf(baked, 0);
  const width = ink.maxX - ink.minX;
  const height = ink.maxY - ink.minY;
  const aspect = width / Math.max(1, height);
  if (aspect < MIN_ARROW_ASPECT) {
    throw new Error(
      `G6: ${baked.spec.key} ink is ${width}×${height} (aspect ${aspect.toFixed(2)}); an arrow ` +
        `drawn along +X must be at least ${MIN_ARROW_ASPECT}× wider than it is tall.`,
    );
  }
  // The head must be the widest part *at the front*, or the sprite flies
  // backwards and nobody notices until it is on screen at 32 px.
  const midY = Math.round((ink.minY + ink.maxY) / 2);
  const frontHalfStart = Math.round(ink.minX + width * 0.6);
  let frontInk = 0;
  for (let x = frontHalfStart; x <= ink.maxX; x++) {
    if (alphaAt(baked, 0, x, midY) > INK_ALPHA) frontInk++;
  }
  if (frontInk === 0) {
    throw new Error(`G6: ${baked.spec.key} has no ink on its centre line in the leading 40%`);
  }
}

/**
 * G7 — the grasping-hands patch must not touch its cell wall.
 *
 * The runtime fills a cone with several overlapping copies of this cell. Ink
 * anywhere near the border bakes a rectangular seam grid into the cone, which
 * is the one failure that only shows up once there are many of them.
 */
const HANDS_MIN_INK_MARGIN = 8;

function gateHandsPatchInset(baked: BakedSheet): void {
  const { spec } = baked;
  for (let frame = 0; frame < spec.frameCount; frame++) {
    const ink = inkBoundsOf(baked, frame);
    if (ink.pixels === 0) continue;
    const margin = Math.min(
      ink.minX,
      ink.minY,
      spec.frameWidth - 1 - ink.maxX,
      spec.frameHeight - 1 - ink.maxY,
    );
    if (margin < HANDS_MIN_INK_MARGIN) {
      throw new Error(
        `G7: ${spec.key} frame ${frame} leaves only ${margin}px between its ink and the cell ` +
          `wall (needs ${HANDS_MIN_INK_MARGIN}px); overlapping copies will show a seam grid.`,
      );
    }
  }
}

/**
 * G8 — the fingers have to have daylight between them.
 *
 * Negative space is the whole skeletal read. If the bones bake into one solid
 * mass, a scanline through the hand stops showing separate ink runs.
 *
 * Checked on most of the sheet rather than on its best frame: a hand that
 * closes to a full fist still passes a best-frame check while losing every gap
 * on exactly the frames the attack lands on.
 */
const MIN_FINGER_RUNS = 4;
const MIN_GAPPED_FRAME_FRACTION = 0.5;

function widestRunCount(baked: BakedSheet, frame: number): number {
  const { spec } = baked;
  let best = 0;
  for (let y = 0; y < spec.frameHeight; y++) {
    let runs = 0;
    let inRun = false;
    for (let x = 0; x < spec.frameWidth; x++) {
      const isInk = alphaAt(baked, frame, x, y) > INK_ALPHA;
      if (isInk && !inRun) runs++;
      inRun = isInk;
    }
    best = Math.max(best, runs);
  }
  return best;
}

function gateFingerGaps(baked: BakedSheet): void {
  const { spec } = baked;
  const runsPerFrame: number[] = [];
  for (let frame = 0; frame < spec.frameCount; frame++) {
    runsPerFrame.push(widestRunCount(baked, frame));
  }
  const gapped = runsPerFrame.filter((runs) => runs >= MIN_FINGER_RUNS).length;
  if (gapped < Math.ceil(spec.frameCount * MIN_GAPPED_FRAME_FRACTION)) {
    throw new Error(
      `G8: only ${gapped}/${spec.frameCount} frames of ${spec.key} cross ${MIN_FINGER_RUNS} ` +
        `separate ink runs on any scanline (per frame: ${runsPerFrame.join(',')}); ` +
        `the fingers have merged into one mitten.`,
    );
  }
}

/**
 * G9 — a risen hand must still be touching the ground it came out of.
 *
 * The forearm is clipped at the soil line, so a forearm drawn shorter than the
 * hand has risen leaves the arm ending in mid-air with a gap under it: the
 * patch then reads as a prop dropped on the tile rather than as an eruption.
 * The gate is that every frame carrying ink well above the soil also carries
 * ink on the soil row itself.
 */
const GROUND_ROW = Math.round(TILE_SCALE * HANDS_GROUND_Y);
/** How far above the soil line ink has to reach before the arm must connect. */
const RISEN_INK_HEIGHT = 16;

function gateHandsMeetTheGround(baked: BakedSheet): void {
  const { spec } = baked;
  const groundY = spec.tileY + GROUND_ROW - 1;
  const risenY = spec.tileY - RISEN_INK_HEIGHT;
  const rowHasInk = (frame: number, y: number): boolean => {
    for (let x = 0; x < spec.frameWidth; x++) {
      if (alphaAt(baked, frame, x, y) > INK_ALPHA) return true;
    }
    return false;
  };
  for (let frame = 0; frame < spec.frameCount; frame++) {
    if (!rowHasInk(frame, risenY)) continue;
    if (!rowHasInk(frame, groundY)) {
      throw new Error(
        `G9: ${spec.key} frame ${frame} has ink at row ${risenY} but none at the soil row ` +
          `${groundY}; the arm is floating above the ground it erupted from.`,
      );
    }
  }
}

// ── Manifest verification ────────────────────────────────────────────────────

const MANIFEST_PATH = 'src/images/effects/manifest.json';

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

/**
 * G9 — a sheet whose manifest entry does not describe it renders as garbage.
 *
 * Checked rather than rewritten: `manifest.json` is shared with every other
 * effect sheet in the directory, so this prints the block to paste by hand.
 */
function verifyManifest(specs: readonly SheetSpec[]): void {
  const parsed: unknown = JSON.parse(readFileSync(resolve(MANIFEST_PATH), 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${MANIFEST_PATH} is not an object`);
  }
  const manifest: Record<string, unknown> = { ...parsed };
  const stale: string[] = [];
  for (const spec of specs) {
    const required = manifestEntryFor(spec);
    if (canonicalJson(manifest[spec.key]) !== canonicalJson(required)) {
      stale.push(`"${spec.key}": ${JSON.stringify(required, null, 2)}`);
    }
  }
  if (stale.length > 0) {
    console.error(
      `\n${MANIFEST_PATH} is out of sync with the bake. Set these entries:\n${stale.join(',\n')}\n`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`  manifest: ${MANIFEST_PATH} is in sync`);
}

function gatesFor(baked: BakedSheet): void {
  gateEdgeBleed(baked);
  gateBlankFrames(baked);
  gateInkSpan(baked);
  if (baked.spec.alias === 'bolt' || baked.spec.alias === 'hands') gateLoopMotion(baked);
  if (baked.spec.alias === 'burst') gateBurstExpands(baked);
  if (baked.spec.alias === 'arrow') gateArrowAimsAlongX(baked);
  if (baked.spec.alias === 'hands') {
    gateHandsPatchInset(baked);
    gateFingerGaps(baked);
    gateHandsMeetTheGround(baked);
  }
}

function writeSheets(): void {
  console.log(`Generating skeleton effect sheets (tileScale=${TILE_SCALE})…`);
  // Baked to memory and gated before anything reaches disk: a sheet that fails a
  // gate must not be the one sitting in src/images when the run ends.
  const baked = bake();
  for (const sheet of baked) gatesFor(sheet);
  for (const sheet of baked) {
    writeFileSync(resolve(OUT_DIR, sheet.spec.file), sheet.buffer);
    console.log(
      `  → ${OUT_DIR}/${sheet.spec.file}  ` +
        `(${sheet.spec.frameCount} × ${sheet.spec.frameWidth}×${sheet.spec.frameHeight}, ` +
        `anchor ${sheet.spec.tileX},${sheet.spec.tileY})`,
    );
  }
  verifyManifest(ROWS);
}

// The review harness imports ROWS from here, so painting the sheets has to be
// something this module does when run, not when loaded.
const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  writeSheets();
}
