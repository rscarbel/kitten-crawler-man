#!/usr/bin/env tsx
/**
 * The bake gate for the Rat Kin sheet, and the entry point behind
 * `npm run gen:rat-kin`.
 *
 * The generator itself has no write path on purpose: this file bakes into
 * memory, measures both the baked pixels and the pose stream, throws on anything
 * wrong, and only then writes. A sheet that fails a gate must never reach disk,
 * because almost nothing downstream can detect a bad one — the runtime happily
 * renders a figure whose knee snaps once per cycle.
 *
 * Every gate carries an ID and reports the measured value *and* the limit, so a
 * failure says what to change rather than that something is wrong.
 *
 * Run: npm run gen:rat-kin
 */

import { createCanvas, loadImage, type Image } from 'canvas';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

import {
  MANIFEST_PATH,
  RAT_KIN_SCALE,
  ROWS,
  GROUND_OFFSET_IN_TILE,
  SHEET_PATH,
  TILE_SCALE,
  bake,
  manifestMismatch,
  poseStream,
  type BakedSheet,
  type SheetGeometry,
} from './generate-rat-kin-sprite.js';
import { CONTRALATERAL_PHASE, STANCE_FRACTION } from './generate-rat-kin-sprite.js';
import {
  FLAT_TOE_CONTACT_HEIGHT,
  GROUND_Y,
  LEG_REACH_LIMIT,
  measureLegs,
  toeContactHeight,
} from './ratKinArt.js';

/**
 * The measure→paste→re-run escape hatch: after a pose change the geometry moves,
 * so the manifest is knowingly stale for exactly one run. An explicit flag, not
 * a loosened threshold.
 */
const SKIP_MANIFEST_GATE = process.argv.includes('--skip-manifest-gate');

const ALPHA_OFFSET = 3;
const CHANNELS = 4;
/** Alpha above which a pixel counts as painted. */
const INK_ALPHA_THRESHOLD = 24;
/** Alpha on a cell border above which the frame is judged to have overrun it. */
const BORDER_ALPHA_LIMIT = 8;

interface Cell {
  /** Straight alpha, one entry per pixel, row-major within the cell. */
  readonly alpha: Uint8Array;
  readonly width: number;
  readonly height: number;
}

function readCells(image: Image, sheet: BakedSheet): Map<string, Cell> {
  const { frameWidth, frameHeight } = sheet.geometry;
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, image.width, image.height);

  const cells = new Map<string, Cell>();
  ROWS.forEach((row, rowIndex) => {
    for (let frame = 0; frame < row.frameCount; frame++) {
      const alpha = new Uint8Array(frameWidth * frameHeight);
      for (let y = 0; y < frameHeight; y++) {
        for (let x = 0; x < frameWidth; x++) {
          const sheetX = frame * frameWidth + x;
          const sheetY = rowIndex * frameHeight + y;
          alpha[y * frameWidth + x] =
            data[(sheetY * image.width + sheetX) * CHANNELS + ALPHA_OFFSET];
        }
      }
      cells.set(cellKey(row.name, frame), { alpha, width: frameWidth, height: frameHeight });
    }
  });
  return cells;
}

function cellKey(row: string, frame: number): string {
  return `${row}[${frame}]`;
}

function cellOf(cells: Map<string, Cell>, row: string, frame: number): Cell {
  const cell = cells.get(cellKey(row, frame));
  if (cell === undefined) throw new Error(`no baked cell for ${cellKey(row, frame)}`);
  return cell;
}

/** Mean absolute alpha difference between two cells, 0–255. */
function cellDelta(a: Cell, b: Cell): number {
  let total = 0;
  for (let i = 0; i < a.alpha.length; i++) total += Math.abs(a.alpha[i] - b.alpha[i]);
  return total / a.alpha.length;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

interface Centroid {
  readonly x: number;
  readonly y: number;
}

function inkCentroid(cell: Cell): Centroid {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (let y = 0; y < cell.height; y++) {
    for (let x = 0; x < cell.width; x++) {
      if (cell.alpha[y * cell.width + x] < INK_ALPHA_THRESHOLD) continue;
      sumX += x;
      sumY += y;
      count++;
    }
  }
  if (count === 0) throw new Error('a baked cell holds no ink at all');
  return { x: sumX / count, y: sumY / count };
}

// ── Pixel gates ──────────────────────────────────────────────────────────────

/**
 * G1 — border clip. A frame that paints outside its cell is sheared flat by the
 * sheet blit and baked in, and nothing downstream can detect it.
 */
function gateBorderClip(cells: Map<string, Cell>): void {
  for (const [key, cell] of cells) {
    const at = (x: number, y: number): number => cell.alpha[y * cell.width + x];
    for (let x = 0; x < cell.width; x++) {
      if (at(x, 0) > BORDER_ALPHA_LIMIT) throw new Error(`G1: ${key} paints off its top edge`);
      if (at(x, cell.height - 1) > BORDER_ALPHA_LIMIT) {
        throw new Error(`G1: ${key} paints off its bottom edge`);
      }
    }
    for (let y = 0; y < cell.height; y++) {
      if (at(0, y) > BORDER_ALPHA_LIMIT) throw new Error(`G1: ${key} paints off its left edge`);
      if (at(cell.width - 1, y) > BORDER_ALPHA_LIMIT) {
        throw new Error(`G1: ${key} paints off its right edge`);
      }
    }
  }
}

/**
 * G2 — anchor. The figure's feet must stand on the tile the manifest claims, or
 * the health bar, the talk prompt and the minimap marker all sit somewhere else.
 */
const ANCHOR_TOLERANCE_PX = 2;

function gateAnchor(cells: Map<string, Cell>, sheet: BakedSheet): void {
  // Every row, not just one: the head-on and edge-on feet are painted by
  // different code, and a view that stands a pixel lower than the others is
  // exactly the drift a single-row sample cannot see.
  for (const row of ROWS) gateAnchorRow(cells, sheet, row.name);
}

function gateAnchorRow(cells: Map<string, Cell>, sheet: BakedSheet, row: string): void {
  const cell = cellOf(cells, row, 0);
  const groundY = sheet.geometry.tileY + TILE_SCALE * GROUND_OFFSET_IN_TILE + GROUND_Y;
  let lowestInk = -1;
  for (let y = 0; y < cell.height; y++) {
    for (let x = 0; x < cell.width; x++) {
      if (cell.alpha[y * cell.width + x] >= INK_ALPHA_THRESHOLD) lowestInk = y;
    }
  }
  // Signed, not absolute. The shadow allowance exists only for ink *below* the
  // soles; an absolute test spends it on the other side too and lets a figure
  // float a quarter of a tile above the floor everything else stands on.
  if (lowestInk < groundY - ANCHOR_TOLERANCE_PX) {
    throw new Error(
      `G2: ${row}'s lowest ink is ${(groundY - lowestInk).toFixed(1)}px *above* the tile's ` +
        `ground line — he is floating`,
    );
  }
  if (lowestInk > groundY + SHADOW_SPREAD_PX + ANCHOR_TOLERANCE_PX) {
    throw new Error(
      `G2: ${row}'s lowest ink is ${(lowestInk - groundY).toFixed(1)}px below the tile's ground ` +
        `line (limit ${SHADOW_SPREAD_PX + ANCHOR_TOLERANCE_PX}px) — the manifest's tileY no ` +
        `longer describes where he stands`,
    );
  }
}

/** How far below the soles the contact shadow legitimately reaches. */
const SHADOW_SPREAD_PX = 8;

/**
 * G3 — loop closure. A cycle whose last frame does not lead back into its first
 * pops once per lap, which is invisible on a contact sheet and obvious in motion.
 */
const LOOP_SEAM_LIMIT = 2.2;

/**
 * Floor under both delta gates, as a budget of fully-opaque pixels on the bake.
 *
 * Both gates are ratio tests, and a ratio against a near-zero median means
 * nothing: a head-on idle is *supposed* to sit near the threshold of visibility,
 * so its typical step is a fraction of a pixel's worth of antialiased edge and
 * any transition at all measures several times it. The head-on idle is the row
 * this actually covers — it is not merely guarding against a silly ratio, it is
 * passing a measurement that would otherwise fail on a change nobody can see.
 *
 * Stated in pixels rather than in mean alpha because mean alpha is per-cell: an
 * absolute mean would quietly buy a bigger allowance as the frame grew. At the
 * 32px tile the sheet is halved, so this is ~6 screen pixels of change across
 * the whole figure.
 */
const SEAM_INK_BUDGET_PX = 24;
const MAX_ALPHA = 255;

function deltaLimit(typical: number, factor: number, geometry: SheetGeometry): number {
  const floor = (SEAM_INK_BUDGET_PX * MAX_ALPHA) / (geometry.frameWidth * geometry.frameHeight);
  return Math.max(typical * factor, floor);
}

function gateLoopClosure(cells: Map<string, Cell>, geometry: SheetGeometry): void {
  for (const row of ROWS) {
    const steps: number[] = [];
    for (let frame = 1; frame < row.frameCount; frame++) {
      steps.push(cellDelta(cellOf(cells, row.name, frame - 1), cellOf(cells, row.name, frame)));
    }
    const seam = cellDelta(cellOf(cells, row.name, row.frameCount - 1), cellOf(cells, row.name, 0));
    const typical = median(steps);
    const limit = deltaLimit(typical, LOOP_SEAM_LIMIT, geometry);
    if (seam > limit) {
      throw new Error(
        `G3: ${row.name}'s loop seam is ${seam.toFixed(2)} against a median step of ` +
          `${typical.toFixed(2)} (limit ${limit.toFixed(2)})`,
      );
    }
  }
}

/**
 * G4 — motion continuity. A snapped knee, a mid-swing draw-order flip or an IK
 * clamp all show up as one consecutive-frame delta far above its neighbours.
 */
const CONTINUITY_LIMIT = 2.4;

function gateContinuity(cells: Map<string, Cell>, geometry: SheetGeometry): void {
  for (const row of ROWS) {
    const steps: number[] = [];
    for (let frame = 1; frame < row.frameCount; frame++) {
      steps.push(cellDelta(cellOf(cells, row.name, frame - 1), cellOf(cells, row.name, frame)));
    }
    const typical = median(steps);
    const limit = deltaLimit(typical, CONTINUITY_LIMIT, geometry);
    steps.forEach((step, index) => {
      if (step > limit) {
        throw new Error(
          `G4: ${row.name} jumps ${step.toFixed(2)} between frames ${index} and ${index + 1}, ` +
            `against a median step of ${typical.toFixed(2)} (limit ${limit.toFixed(2)})`,
        );
      }
    });
  }
}

/**
 * G5 — centroid drift. A walk cycle is drawn in place: the body must end the lap
 * where it started it, or he moonwalks along his own path in the safe room.
 */
const CENTROID_DRIFT_LIMIT_PX = 1.5;

function gateCentroidDrift(cells: Map<string, Cell>): void {
  for (const row of ROWS) {
    const first = inkCentroid(cellOf(cells, row.name, 0));
    const last = inkCentroid(cellOf(cells, row.name, row.frameCount - 1));
    const steps: number[] = [];
    for (let frame = 1; frame < row.frameCount; frame++) {
      const before = inkCentroid(cellOf(cells, row.name, frame - 1));
      const after = inkCentroid(cellOf(cells, row.name, frame));
      steps.push(Math.hypot(after.x - before.x, after.y - before.y));
    }
    const seam = Math.hypot(first.x - last.x, first.y - last.y);
    const limit = Math.max(CENTROID_DRIFT_LIMIT_PX, median(steps) * CENTROID_SEAM_SHARE);
    if (seam > limit) {
      throw new Error(
        `G5: ${row.name}'s ink centroid steps ${seam.toFixed(2)}px across the loop seam, ` +
          `against a limit of ${limit.toFixed(2)}px`,
      );
    }
  }
}

/** A seam step may be this much larger than a typical one before it reads. */
const CENTROID_SEAM_SHARE = 2;

// ── Pose-stream gates ────────────────────────────────────────────────────────

/**
 * G6 — reach headroom. Hip→hock must stay inside the thigh and shank's combined
 * span on *every* frame. One clamped frame locks the leg straight, the next
 * tuck snaps it back, and the result reads as a hop rather than as a walk.
 */
const REACH_HEADROOM = 0.004;

function gateReachHeadroom(): void {
  let worst = 0;
  let worstAt = '';
  for (const { row, frame, pose } of poseStream()) {
    const legs = measureLegs(pose, row.view);
    for (const [side, leg] of Object.entries(legs)) {
      if (leg.hipToHock > worst) {
        worst = leg.hipToHock;
        worstAt = `${row.name}[${frame}] ${side}`;
      }
    }
  }
  if (worst > LEG_REACH_LIMIT - REACH_HEADROOM) {
    throw new Error(
      `G6: ${worstAt} asks the leg to span ${worst.toFixed(4)} against a reach of ` +
        `${LEG_REACH_LIMIT.toFixed(4)} — shorten STRIDE or drop the pelvis further at contact`,
    );
  }
  console.log(
    `  G6 reach headroom: worst frame spans ${worst.toFixed(4)} of ${LEG_REACH_LIMIT.toFixed(4)} ` +
      `(${worstAt})`,
  );
}

/**
 * G7 — foot slide. The classic moonwalk.
 *
 * The contact is the *toe pads*, not the ball: late in stance the ball rocks up
 * off the floor and the push-off rolls forward onto the toes, so a gate watching
 * the ball would read that roll as the foot leaving the ground early. What has
 * to hold is that the pads stay at their own contact height and travel backward
 * under the body monotonically.
 *
 * Returns the ground one full cycle covers, in tiles, so G13 can check the
 * runtime against something *measured* rather than against a formula.
 */
const PLANTED_EPSILON = 1e-9;
/** How far the toe pads may wander off their contact plane while planted. */
const CONTACT_HEIGHT_TOLERANCE = 0.002;

function gateFootSlide(): number {
  // Only the profile walk plants a foot and slides it: the head-on gait has
  // almost no stride to show, so its feet barely move by design.
  const walk = ROWS.find((row) => row.name === 'walk_side');
  if (walk === undefined) throw new Error('G7: there is no walk_side row to check');

  const slides: number[] = [];

  for (const side of ['near', 'far'] as const) {
    // Stance comes from the phase, not from the foot's height: once the ball
    // lifts at toe-off, height no longer distinguishes stance from swing.
    const phaseOffset = side === 'near' ? 0 : CONTRALATERAL_PHASE;
    let previous: { x: number; frame: number } | null = null;
    for (let frame = 0; frame < walk.frameCount; frame++) {
      const cycle = (((frame / walk.frameCount + phaseOffset) % 1) + 1) % 1;
      const pose = walk.pose(frame);
      const foot = side === 'near' ? pose.nearFoot : pose.farFoot;
      if (cycle >= STANCE_FRACTION) {
        previous = null;
        continue;
      }

      const contact = toeContactHeight(foot);
      if (Math.abs(contact - FLAT_TOE_CONTACT_HEIGHT) > CONTACT_HEIGHT_TOLERANCE) {
        throw new Error(
          `G7: the ${side} foot's toe pads sit ${contact.toFixed(4)} while planted on walk_side ` +
            `frame ${frame}, against a contact plane of ${FLAT_TOE_CONTACT_HEIGHT} — the roll is ` +
            `lifting the foot off the floor instead of rocking it forward`,
        );
      }
      if (previous !== null && foot.ball.x >= previous.x - PLANTED_EPSILON) {
        throw new Error(
          `G7: the ${side} foot slides forward while planted — x went from ` +
            `${previous.x.toFixed(4)} on frame ${previous.frame} to ${foot.ball.x.toFixed(4)} ` +
            `on frame ${frame}`,
        );
      }
      if (previous !== null) slides.push(previous.x - foot.ball.x);
      previous = { x: foot.ball.x, frame };
    }
  }

  if (slides.length === 0) throw new Error('G7: no frame of walk_side plants a foot');

  // The rate, not the span. A planted foot slides at a constant rate — that is
  // what "the body travels over it" means — so the ground covered per cycle is
  // one frame's slide times the frame count. Measuring the span of the *sampled*
  // frames instead comes up one frame-step short, because the last instant of
  // stance falls between two frames and is never drawn.
  const slowest = Math.min(...slides);
  const fastest = Math.max(...slides);
  if (fastest - slowest > SLIDE_RATE_TOLERANCE) {
    throw new Error(
      `G7: the planted foot slides unevenly — between ${slowest.toFixed(5)} and ` +
        `${fastest.toFixed(5)} per frame (limit ${SLIDE_RATE_TOLERANCE}). A stance that ` +
        `accelerates under him is a skate however monotonic it is`,
    );
  }
  return fastest * walk.frameCount * RAT_KIN_SCALE;
}

/** How much the per-frame slide may vary across a stance before it reads. */
const SLIDE_RATE_TOLERANCE = 1e-9;

/**
 * G8 — both feet never leave the floor. He walks; he does not run or hop, so
 * every frame has at least one foot in contact. A frame with neither is a flight
 * phase, which at this gait reads as a stumble.
 *
 * Measured at the toe pads, for the same reason G7 is: from the moment the ball
 * rocks up at toe-off it is no longer what is touching the ground.
 */
function gateGroundContact(): void {
  for (const { row, frame, pose } of poseStream()) {
    const lowest = Math.max(toeContactHeight(pose.nearFoot), toeContactHeight(pose.farFoot));
    if (lowest < FLAT_TOE_CONTACT_HEIGHT - CONTACT_HEIGHT_TOLERANCE) {
      throw new Error(
        `G8: ${row.name}[${frame}] has both feet off the floor (lowest toe contact at ` +
          `${lowest.toFixed(4)}, floor at ${FLAT_TOE_CONTACT_HEIGHT})`,
      );
    }
  }
}

/**
 * G9 — knee direction, and its head-on counterpart.
 *
 * Edge-on every knee bends forward, and a knee that solves behind the hip→hock
 * line has hinged backward — the most obviously wrong thing a profile walk can
 * do, and something a sign flip produces silently.
 *
 * Head-on that test is meaningless and the opposite rule applies: a real knee
 * hinges *away* from the camera, so it has to stay on the hip→hock line. A knee
 * thrown sideways there flickers once per step and reads as a wiggle. Checking
 * only one of the two leaves the other free to be wrong.
 */
function gateKneeDirection(): void {
  for (const { row, frame, pose } of poseStream()) {
    if (row.view !== 'side') {
      // Head-on, the off-line measure cannot fail: `foreshorten: 1` *assigns* the knee
      // to the straight-leg point any offset would be measured against, so the
      // number is structurally zero. The invariant worth policing is the one a
      // new pose can actually get wrong — declaring the foreshortening at all.
      for (const [side, foot] of Object.entries({ near: pose.nearFoot, far: pose.farFoot })) {
        if (foot.foreshorten !== 1) {
          throw new Error(
            `G9: ${row.name}[${frame}]'s ${side} foot declares foreshorten ${foot.foreshorten} ` +
              `head-on, where every leg must be a straight column (1)`,
          );
        }
      }
      continue;
    }
    const legs = measureLegs(pose, row.view);
    for (const [side, leg] of Object.entries(legs)) {
      {
        // Signed area of hip→hock against hip→knee. Facing +X with +Y down, a
        // knee forward of that line gives a negative cross product.
        const hock = { x: leg.hock.x - leg.hip.x, y: leg.hock.y - leg.hip.y };
        const knee = { x: leg.knee.x - leg.hip.x, y: leg.knee.y - leg.hip.y };
        const cross = hock.x * knee.y - hock.y * knee.x;
        if (cross >= 0) {
          throw new Error(
            `G9: ${row.name}[${frame}]'s ${side} knee sits behind the hip→hock line ` +
              `(cross ${cross.toFixed(5)}) — the leg has hinged backward`,
          );
        }
      }
    }
  }
}

/**
 * G10 — timing table. The row names and frame counts the runtime expects have to
 * match the ones baked here; a row added in one place only is a blank animation.
 */
const EXPECTED_ROWS: ReadonlyArray<readonly [string, number]> = [
  ['walk', 16],
  ['walk_side', 16],
  ['walk_away', 16],
  ['idle', 8],
  ['idle_side', 8],
  ['idle_away', 8],
];

function gateTimingTable(): void {
  if (ROWS.length !== EXPECTED_ROWS.length) {
    throw new Error(`G10: the sheet has ${ROWS.length} rows against ${EXPECTED_ROWS.length}`);
  }
  ROWS.forEach((row, index) => {
    const [name, frameCount] = EXPECTED_ROWS[index];
    if (row.name !== name || row.frameCount !== frameCount) {
      throw new Error(
        `G10: row ${index} is ${row.name}×${row.frameCount}, expected ${name}×${frameCount}`,
      );
    }
  });
}

/**
 * G11 — manifest sync. The single most common wiring bug after a redraw, and the
 * one whose symptom (a sprite drawn from the wrong pixels) looks like an art
 * problem rather than a data one.
 */
function gateManifest(sheet: BakedSheet): void {
  const mismatch = manifestMismatch(sheet);
  if (mismatch === null) {
    console.log(`  G11 manifest: ${MANIFEST_PATH} is in sync`);
    return;
  }
  if (SKIP_MANIFEST_GATE) {
    console.warn(`  G11 SKIPPED — paste this and re-run without the flag:\n${mismatch}`);
    return;
  }
  throw new Error(`G11: ${mismatch}`);
}

/**
 * G13 — stride sync. `src/sprites/ratKinSprite.ts` declares how much ground one
 * walk cycle covers so the runtime can advance the phase by distance travelled;
 * the two numbers live in different roots and cannot import each other, so this
 * reads the constant back out of the source.
 *
 * It is checked against what G7 *measured* off the planted frames, not against a
 * hand-derived formula: a formula agrees with itself even after the keyframes it
 * claims to describe have been edited out from under it.
 *
 * Drift here does not break anything visibly enough to notice — it just makes
 * his feet skate, quietly, forever.
 */
const RUNTIME_SPRITE_PATH = 'src/sprites/ratKinSprite.ts';
const STRIDE_DECLARATION = /RAT_KIN_TILES_PER_WALK_CYCLE\s*=\s*([\d.]+)/;
/** The runtime constant is written to four decimals, so it can differ by half of one. */
const STRIDE_TOLERANCE = 0.00005;

function gateStrideSync(measuredTilesPerCycle: number): void {
  const source = readFileSync(resolve(RUNTIME_SPRITE_PATH), 'utf8');
  const match = STRIDE_DECLARATION.exec(source);
  if (match === null) {
    throw new Error(`G13: ${RUNTIME_SPRITE_PATH} no longer declares RAT_KIN_TILES_PER_WALK_CYCLE`);
  }
  const declared = Number(match[1]);
  if (Math.abs(declared - measuredTilesPerCycle) > STRIDE_TOLERANCE) {
    throw new Error(
      `G13: ${RUNTIME_SPRITE_PATH} says one walk cycle covers ${declared} tiles, but the baked ` +
        `choreography covers ${measuredTilesPerCycle.toFixed(4)} — his feet will skate until ` +
        `they agree`,
    );
  }
  console.log(`  G13 stride sync: one walk cycle covers ${declared} tiles (measured)`);
}

/**
 * G12 — texture size. Reported even when it passes, because quiet asset bloat is
 * the failure mode nobody goes looking for.
 */
const SHEET_BYTE_LIMIT = 400_000;

function gateTextureSize(sheet: BakedSheet): void {
  const bytes = sheet.buffer.byteLength;
  if (bytes > SHEET_BYTE_LIMIT) {
    throw new Error(`G12: the sheet is ${bytes} bytes against a budget of ${SHEET_BYTE_LIMIT}`);
  }
  console.log(
    `  G12 texture size: ${(bytes / 1024).toFixed(1)}kB of a ${SHEET_BYTE_LIMIT / 1024}kB budget`,
  );
}

// ── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`Baking the rat_kin sheet (tileScale=${TILE_SCALE}, scale=${RAT_KIN_SCALE})…`);

  gateTimingTable();
  gateReachHeadroom();
  const measuredTilesPerCycle = gateFootSlide();
  gateGroundContact();
  gateKneeDirection();
  gateStrideSync(measuredTilesPerCycle);

  const sheet = bake();
  const image = await loadImage(sheet.buffer);
  const cells = readCells(image, sheet);

  gateBorderClip(cells);
  gateAnchor(cells, sheet);
  gateLoopClosure(cells, sheet.geometry);
  gateContinuity(cells, sheet.geometry);
  gateCentroidDrift(cells);
  gateTextureSize(sheet);
  gateManifest(sheet);

  writeFileSync(resolve(SHEET_PATH), sheet.buffer);
  console.log(`  → ${SHEET_PATH}`);
  console.log(
    `  → ${sheet.columns * sheet.geometry.frameWidth}×${ROWS.length * sheet.geometry.frameHeight}px ` +
      `(${ROWS.length} rows × ${sheet.columns} cols of ${sheet.geometry.frameWidth}×${sheet.geometry.frameHeight})`,
  );
  ROWS.forEach((row, index) => {
    console.log(`     row ${index}: ${row.name} (${row.frameCount} frames)`);
  });
  console.log(`  tileX=${sheet.geometry.tileX}  tileY=${sheet.geometry.tileY}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
