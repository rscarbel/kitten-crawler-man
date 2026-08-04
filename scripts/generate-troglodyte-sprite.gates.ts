#!/usr/bin/env tsx
/**
 * The bake gate for the Troglodyte sheets, and the entry point `npm run
 * gen:troglodyte` runs — **not** `generate-troglodyte-sprite.ts` itself.
 *
 * A sheet that fails a gate must never reach disk. This module bakes into
 * memory, measures the baked pixels and the pose stream, throws with a numeric
 * message naming what it measured and what the limit was, and only then lets
 * the generator write.
 *
 * Every gate here exists because something on this figure was wrong in a way
 * that `typecheck`, `lint` and reading the drawing code could not see.
 */

import { createCanvas, loadImage, type Canvas } from 'canvas';
import { pathToFileURL } from 'url';

import {
  GORE_STATES,
  LASH_FRAMES,
  LASH_IMPACT_PROGRESS,
  ROWS,
  TILE_SCALE,
  TONGUE_FRAMES,
  bake,
  bakeTongue,
  lashSide,
  walkSide,
  lashMouthAnchorsInTile,
  mouthAnchorsInTile,
  type BakedSheet,
} from './generate-troglodyte-sprite';
import { ARM_LENGTH, solvedArm, type TrogView } from './trogArt';
import { TONGUE_REACH_TILES } from './trogTongue';
import { TROGLODYTE_GORE_PARTS } from '../src/sprites/troglodyteSprite.js';
import {
  TROGLODYTE_LASH_MOUTH_ANCHORS,
  TROGLODYTE_MOUTH_ANCHORS,
  TROGLODYTE_TONGUE_ART_REACH_TILES,
  type TroglodyteView,
} from '../src/sprites/troglodyteTongue.js';

/** Alpha above which a pixel counts as painted. */
const INK_ALPHA_THRESHOLD = 24;
const CHANNELS = 4;
const ALPHA_OFFSET = 3;

interface Grid {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

async function decode(sheet: BakedSheet): Promise<Canvas> {
  const image = await loadImage(sheet.buffer);
  const canvas = createCanvas(image.width, image.height);
  canvas.getContext('2d').drawImage(image, 0, 0);
  return canvas;
}

function gridOf(canvas: Canvas): Grid {
  const ctx = canvas.getContext('2d');
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data };
}

function alphaAt(grid: Grid, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return 0;
  return grid.data[(y * grid.width + x) * CHANNELS + ALPHA_OFFSET];
}

interface Cell {
  readonly col: number;
  readonly row: number;
}

/** Every painted pixel of one cell, as a flat alpha array. */
function cellAlpha(grid: Grid, sheet: BakedSheet, cell: Cell): Uint8ClampedArray {
  const { frameWidth, frameHeight } = sheet.geometry;
  const out = new Uint8ClampedArray(frameWidth * frameHeight);
  for (let y = 0; y < frameHeight; y++) {
    for (let x = 0; x < frameWidth; x++) {
      out[y * frameWidth + x] = alphaAt(
        grid,
        cell.col * frameWidth + x,
        cell.row * frameHeight + y,
      );
    }
  }
  return out;
}

interface InkStats {
  readonly count: number;
  readonly centroidX: number;
  readonly centroidY: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

function inkStatsOf(
  alpha: Uint8ClampedArray,
  width: number,
  threshold = INK_ALPHA_THRESHOLD,
): InkStats {
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] < threshold) continue;
    const x = i % width;
    const y = Math.floor(i / width);
    count++;
    sumX += x;
    sumY += y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return {
    count,
    centroidX: count === 0 ? 0 : sumX / count,
    centroidY: count === 0 ? 0 : sumY / count,
    minX,
    maxX,
    minY,
    maxY,
  };
}

/** How many pixels differ between two cells of the same row. */
function frameDelta(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let differing = 0;
  for (let i = 0; i < a.length; i++) {
    const inA = a[i] >= INK_ALPHA_THRESHOLD;
    const inB = b[i] >= INK_ALPHA_THRESHOLD;
    if (inA !== inB) differing++;
  }
  return differing;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

// ── Pixel gates ──────────────────────────────────────────────────────────────

/**
 * `G1` — no ink on any cell border.
 *
 * A frame that paints outside its cell is sheared flat by the sheet blit and
 * baked in, and nothing downstream can detect it.
 */
function gateBorderClip(grid: Grid, sheet: BakedSheet): void {
  const { frameWidth, frameHeight } = sheet.geometry;
  ROWS.forEach((row, rowIndex) => {
    for (let col = 0; col < row.frameCount; col++) {
      const alpha = cellAlpha(grid, sheet, { col, row: rowIndex });
      const stats = inkStatsOf(alpha, frameWidth);
      if (stats.count === 0) {
        fail('G1', `${row.name}[${col}] painted nothing at all`);
        continue;
      }
      if (
        stats.minX === 0 ||
        stats.minY === 0 ||
        stats.maxX === frameWidth - 1 ||
        stats.maxY === frameHeight - 1
      ) {
        fail(
          'G1',
          `${row.name}[${col}] paints on its cell border ` +
            `(ink box ${stats.minX}..${stats.maxX} × ${stats.minY}..${stats.maxY} ` +
            `in a ${frameWidth}×${frameHeight} cell)`,
        );
      }
    }
  });
}

/**
 * `G2` — the figure's feet stand where `tileY` claims the ground is.
 *
 * A redraw silently moves the tile anchor, and health bars and aggro markers
 * key off it. Measured on the idle rows, which are the ones standing still.
 *
 * Measured against *solid* ink rather than any ink: the contact shadow is a
 * radial gradient that legitimately spreads a tenth of a tile past the feet,
 * and counting it makes the gate measure the shadow's radius instead of where
 * the creature stands.
 *
 * The tolerance has to clear a splayed toe: head-on, the toe that fans toward
 * the camera is *nearer* than the sole and so draws below the contact line by
 * a couple of pixels. That is correct projection, not a misplaced anchor.
 */
const FOOT_TOLERANCE_PX = 8;
const SOLID_ALPHA_THRESHOLD = 200;

function gateAnchor(grid: Grid, sheet: BakedSheet): void {
  const { frameWidth, tileY } = sheet.geometry;
  const groundY = tileY + GROUND_OFFSET_PX;
  for (const name of ['idle', 'idle_side', 'idle_away']) {
    const rowIndex = ROWS.findIndex((row) => row.name === name);
    if (rowIndex < 0) continue;
    const alpha = cellAlpha(grid, sheet, { col: 0, row: rowIndex });
    const stats = inkStatsOf(alpha, frameWidth, SOLID_ALPHA_THRESHOLD);
    const drop = Math.abs(stats.maxY - groundY);
    if (drop > FOOT_TOLERANCE_PX) {
      fail(
        'G2',
        `${name}[0] has its lowest ink at y=${stats.maxY} against a ground line of ` +
          `${groundY} (tileY ${tileY} + ${GROUND_OFFSET_PX}) — ${drop.toFixed(1)}px off, ` +
          `limit ${FOOT_TOLERANCE_PX}`,
      );
    }
  }
}

/** The ground offset the generator bakes at; duplicated so the gate can measure. */
const GROUND_OFFSET_PX = 58;

/**
 * `G3` — a looping row's last→first delta is no worse than the steps inside it.
 *
 * This is the gate that catches a walk that pops once per cycle, which is
 * invisible on a contact sheet because every individual frame is fine.
 *
 * The comparison is against the median step *and* the largest legitimate step
 * in the cycle. A sine-driven idle is steepest at its own zero crossing, which
 * lands on the seam by construction — measured against the median alone that
 * correct animation fails, and loosening the median limit far enough to let it
 * through stops the gate catching anything.
 */
const LOOP_SEAM_LIMIT = 2.1;
const LOOP_SEAM_VS_WORST_STEP = 1.25;

function gateLoopClosure(grid: Grid, sheet: BakedSheet): void {
  ROWS.forEach((row, rowIndex) => {
    if (row.kind !== 'loop') return;
    const cells = Array.from({ length: row.frameCount }, (_unused, col) =>
      cellAlpha(grid, sheet, { col, row: rowIndex }),
    );
    const steps: number[] = [];
    for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
    const seam = frameDelta(cells[cells.length - 1], cells[0]);
    const typical = median(steps);
    const worst = Math.max(...steps);
    if (typical === 0) return;
    const allowed = Math.max(typical * LOOP_SEAM_LIMIT, worst * LOOP_SEAM_VS_WORST_STEP);
    if (seam > allowed) {
      fail(
        'G3',
        `${row.name} pops across its loop seam: last→first differs by ${seam}px against a ` +
          `median step of ${typical}px and a worst in-cycle step of ${worst}px ` +
          `(allowed ${allowed.toFixed(0)}px)`,
      );
    }
  });
}

/**
 * `G4` — no consecutive-frame step far above the row's own median.
 *
 * Catches a snapped knee, a mid-swing draw-order flip and an IK clamp. The
 * one-shot rows are allowed a bigger spike than the loops, because a strike is
 * *meant* to have one violent frame in it — that is what a strike is.
 */
const LOOP_STEP_LIMIT = 2.6;
const ONE_SHOT_STEP_LIMIT = 4;
/**
 * A step this small is not visible however large its ratio to the row's median.
 *
 * Without a floor the gate is loudest on the rows that move least: a breathing
 * idle whose frames differ by five pixels flags a fifteen-pixel step at 3× the
 * median, and fifteen pixels of an 88×88 cell is two tenths of one percent of it.
 */
const STEP_FLOOR_SHARE = 0.005;

function gateMotionContinuity(grid: Grid, sheet: BakedSheet): void {
  ROWS.forEach((row, rowIndex) => {
    if (row.kind === 'gore') return;
    const limit = row.kind === 'loop' ? LOOP_STEP_LIMIT : ONE_SHOT_STEP_LIMIT;
    const cells = Array.from({ length: row.frameCount }, (_unused, col) =>
      cellAlpha(grid, sheet, { col, row: rowIndex }),
    );
    const steps: number[] = [];
    for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
    const typical = median(steps);
    if (typical === 0) return;
    const floor = sheet.geometry.frameWidth * sheet.geometry.frameHeight * STEP_FLOOR_SHARE;
    steps.forEach((step, i) => {
      const ratio = step / typical;
      if (ratio > limit && step > floor) {
        fail(
          'G4',
          `${row.name} jumps between frames ${i} and ${i + 1}: ${step}px against a median of ` +
            `${typical}px (${ratio.toFixed(2)}×, limit ${limit})`,
        );
      }
    });
  });
}

/**
 * `G5` — a walk cycle does not slide in place.
 *
 * The creature's ink centroid may bob, but over a full loop it must come back
 * to where it started: a centroid that has drifted by the end of the cycle is
 * a figure moonwalking on the spot.
 */
const CENTROID_DRIFT_LIMIT_PX = 2;

function gateCentroidDrift(grid: Grid, sheet: BakedSheet): void {
  const { frameWidth } = sheet.geometry;
  ROWS.forEach((row, rowIndex) => {
    if (row.kind !== 'loop') return;
    const first = inkStatsOf(cellAlpha(grid, sheet, { col: 0, row: rowIndex }), frameWidth);
    const last = inkStatsOf(
      cellAlpha(grid, sheet, { col: row.frameCount - 1, row: rowIndex }),
      frameWidth,
    );
    const drift = Math.hypot(last.centroidX - first.centroidX, last.centroidY - first.centroidY);
    if (drift > CENTROID_DRIFT_LIMIT_PX) {
      fail(
        'G5',
        `${row.name} drifts ${drift.toFixed(2)}px across its loop ` +
          `(limit ${CENTROID_DRIFT_LIMIT_PX})`,
      );
    }
  });
}

/**
 * `G6` — every gore piece is big enough to be identified as it tumbles.
 *
 * A blind naming test could not name a single piece of the first bake at the
 * size they actually render, and the reason was measurable: several were under
 * five pixels across. Measured in *screen* pixels, at the 0.5× the runtime
 * applies, not in sheet pixels.
 */
const IN_GAME_TILE = 32;
const GORE_MIN_SHORT_AXIS_PX = 9;

function gateGoreLegibility(grid: Grid, sheet: BakedSheet): void {
  const { frameWidth } = sheet.geometry;
  const goreRow = ROWS.findIndex((row) => row.kind === 'gore');
  if (goreRow < 0) return;
  const screenScale = IN_GAME_TILE / TILE_SCALE;
  GORE_STATES.forEach((state, col) => {
    const stats = inkStatsOf(cellAlpha(grid, sheet, { col, row: goreRow }), frameWidth);
    if (stats.count === 0) {
      fail('G6', `${state} painted nothing`);
      return;
    }
    const shortAxis = Math.min(stats.maxX - stats.minX, stats.maxY - stats.minY) * screenScale;
    if (shortAxis < GORE_MIN_SHORT_AXIS_PX) {
      fail(
        'G6',
        `${state} is ${shortAxis.toFixed(1)}px across its short axis at the size it renders ` +
          `(limit ${GORE_MIN_SHORT_AXIS_PX}) — nothing that thin can be told from anything else`,
      );
    }
  });
}

/**
 * `G7` — no two gore pieces are the same shape.
 *
 * Compared as small binary masks. Scale is normalised away but **aspect is
 * not**: stretching each piece to fill its own bounding box maps every convex
 * blob onto a filled square and measures the normalisation rather than the art.
 */
const DISTINCT_MASK = 16;
const DISTINCT_IOU_LIMIT = 0.62;

function maskOf(alpha: Uint8ClampedArray, width: number, stats: InkStats): boolean[] {
  const boxW = Math.max(1, stats.maxX - stats.minX);
  const boxH = Math.max(1, stats.maxY - stats.minY);
  const span = Math.max(boxW, boxH);
  const mask: boolean[] = new Array<boolean>(DISTINCT_MASK * DISTINCT_MASK).fill(false);
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] < INK_ALPHA_THRESHOLD) continue;
    const x = (i % width) - stats.minX;
    const y = Math.floor(i / width) - stats.minY;
    const mx = Math.min(DISTINCT_MASK - 1, Math.floor((x / span) * DISTINCT_MASK));
    const my = Math.min(DISTINCT_MASK - 1, Math.floor((y / span) * DISTINCT_MASK));
    mask[my * DISTINCT_MASK + mx] = true;
  }
  return mask;
}

function gateGoreDistinctness(grid: Grid, sheet: BakedSheet): void {
  const { frameWidth } = sheet.geometry;
  const goreRow = ROWS.findIndex((row) => row.kind === 'gore');
  if (goreRow < 0) return;
  const masks = GORE_STATES.map((_unused, col) => {
    const alpha = cellAlpha(grid, sheet, { col, row: goreRow });
    return maskOf(alpha, frameWidth, inkStatsOf(alpha, frameWidth));
  });
  for (let a = 0; a < masks.length; a++) {
    for (let b = a + 1; b < masks.length; b++) {
      let intersection = 0;
      let union = 0;
      for (let i = 0; i < masks[a].length; i++) {
        if (masks[a][i] && masks[b][i]) intersection++;
        if (masks[a][i] || masks[b][i]) union++;
      }
      const iou = union === 0 ? 0 : intersection / union;
      if (iou > DISTINCT_IOU_LIMIT) {
        fail(
          'G7',
          `${GORE_STATES[a]} and ${GORE_STATES[b]} are ${(iou * 100).toFixed(0)}% the same ` +
            `shape (limit ${(DISTINCT_IOU_LIMIT * 100).toFixed(0)}%)`,
        );
      }
    }
  }
}

/**
 * `G8` — the tongue is never drawn detached from its own root.
 *
 * The runtime anchors this sheet at the mouth and rotates it, so ink that does
 * not reach back to the anchor is a tongue hanging in the air beside the
 * creature rather than coming out of it.
 */
const TONGUE_ROOT_GAP_LIMIT_PX = 6;

function gateTongueRoot(grid: Grid, tongue: BakedSheet): void {
  const { frameWidth, frameHeight, tileX } = tongue.geometry;
  for (let frame = 0; frame < TONGUE_FRAMES; frame++) {
    let leftmost = Infinity;
    for (let x = 0; x < frameWidth; x++) {
      for (let y = 0; y < frameHeight; y++) {
        if (alphaAt(grid, frame * frameWidth + x, y) >= INK_ALPHA_THRESHOLD) {
          leftmost = Math.min(leftmost, x);
          break;
        }
      }
      if (leftmost !== Infinity) break;
    }
    if (leftmost === Infinity) {
      fail('G8', `tongue frame ${frame} painted nothing`);
      continue;
    }
    const gap = leftmost - tileX;
    if (gap > TONGUE_ROOT_GAP_LIMIT_PX) {
      fail(
        'G8',
        `tongue frame ${frame} starts ${gap}px past its own mouth anchor ` +
          `(limit ${TONGUE_ROOT_GAP_LIMIT_PX}) — it would draw detached from the creature`,
      );
    }
  }
}

/**
 * `G9` — the tongue's reach grows monotonically and never shrinks.
 *
 * The row is indexed by extension, so a frame shorter than the one before it
 * makes the strike visibly stutter backward mid-throw.
 */
function gateTongueMonotonic(grid: Grid, tongue: BakedSheet): void {
  const { frameWidth, frameHeight } = tongue.geometry;
  let previous = -Infinity;
  for (let frame = 0; frame < TONGUE_FRAMES; frame++) {
    let rightmost = -Infinity;
    for (let x = frameWidth - 1; x >= 0; x--) {
      for (let y = 0; y < frameHeight; y++) {
        if (alphaAt(grid, frame * frameWidth + x, y) >= INK_ALPHA_THRESHOLD) {
          rightmost = x;
          break;
        }
      }
      if (rightmost !== -Infinity) break;
    }
    if (rightmost <= previous) {
      fail(
        'G9',
        `tongue frame ${frame} reaches x=${rightmost}, no further than frame ${frame - 1}'s ` +
          `${previous} — the strike would stutter backward`,
      );
    }
    previous = rightmost;
  }
}

// ── Pose-stream gates ────────────────────────────────────────────────────────

/**
 * `G10` — a planted foot stays planted.
 *
 * The classic moonwalk, and the one defect a contact sheet is completely blind
 * to: every individual frame looks correct.
 */
const FOOT_SLIDE_LIMIT = 0.002;

function gateFootSlide(): void {
  const frames = ROWS.find((row) => row.name === 'walk_side')?.frameCount ?? 0;
  const feet: { left: number; right: number; leftDown: boolean; rightDown: boolean }[] = [];
  for (let frame = 0; frame < frames; frame++) {
    const pose = walkSide(frame / frames);
    feet.push({
      left: pose.leftFoot.x,
      right: pose.rightFoot.x,
      leftDown: pose.leftFoot.y >= -FOOT_SLIDE_LIMIT,
      rightDown: pose.rightFoot.y >= -FOOT_SLIDE_LIMIT,
    });
  }
  // A planted foot slides backward under the body at a constant rate — that is
  // what a stance phase *is*, and it is the body that moves. What must never
  // happen is a planted foot moving *forward*.
  for (let i = 1; i < feet.length; i++) {
    if (feet[i].leftDown && feet[i - 1].leftDown && feet[i].left > feet[i - 1].left) {
      fail(
        'G10',
        `walk_side's left foot is planted and travels forward between frames ${i - 1} and ${i} ` +
          `(${feet[i - 1].left.toFixed(4)} → ${feet[i].left.toFixed(4)}) — that is a moonwalk`,
      );
    }
    if (feet[i].rightDown && feet[i - 1].rightDown && feet[i].right > feet[i - 1].right) {
      fail(
        'G10',
        `walk_side's right foot is planted and travels forward between frames ${i - 1} and ` +
          `${i} (${feet[i - 1].right.toFixed(4)} → ${feet[i].right.toFixed(4)})`,
      );
    }
  }
}

/**
 * `G11` — the IK never has to move a hand to reach its own target.
 *
 * A clamped arm locks dead straight and throws its slack sideways into the
 * elbow, which is what "the arms have a sharp elbow" always turns out to mean.
 *
 * Two things are measured, both on the **solved** arm rather than on the target.
 * Comparing a target against the shoulder it was itself built from is a
 * tautology: whatever the reach share happens to be, that is the answer, and
 * the gate then asserts two constants rather than anything about the figure.
 *
 * 1. The solver did not have to *move* the hand — that is an over-reach, and
 *    the clamped arm locks dead straight.
 * 2. The solved hand is not far *short* of the arm's own length. This is the
 *    one that matters: a target built off the wrong shoulder is usually still
 *    within reach, so nothing clamps — the arm simply has slack, and a
 *    two-bone solver spends slack bowing the elbow out sideways. That is the
 *    bug that made the attack windup read as a figure with its hands on its
 *    hips, and a clamp check alone does not see it.
 */
const CLAMP_TOLERANCE = 0.0005;
/**
 * How much of its own length a solved arm must span.
 *
 * Every target-placed hand in the choreography sits at 0.88 or 0.92 of full
 * reach on purpose — that slack is the visible break at the elbow. Rebuilding
 * the targets off the wrong shoulder drops the span to 0.72. The limit sits
 * between the two with room on both sides rather than a hair under the fault.
 */
const MIN_ARM_EXTENSION = 0.8;

function gateArmReach(): void {
  for (const row of ROWS) {
    const { pose: poseAt, view } = row;
    if (poseAt === null) continue;
    for (let frame = 0; frame < row.frameCount; frame++) {
      // The row's own pose function, given the row's own frame index: exactly
      // what the bake paints, with no second copy of the phase convention here
      // to drift from it.
      const pose = poseAt(frame);
      // Only arms placed by a hand *target* can clamp; the FK-driven walk arms
      // carry their own length by construction.
      for (const [side, hand, angles] of [
        ['left', pose.leftHand, pose.leftArmAngles],
        ['right', pose.rightHand, pose.rightArmAngles],
      ] as const) {
        if (angles !== null) continue;
        const chain = solvedArm(pose, view, side);
        const moved = Math.hypot(chain.end.x - hand.x, chain.end.y - hand.y);
        const spanned = Math.hypot(chain.end.x - chain.root.x, chain.end.y - chain.root.y);
        if (moved > CLAMP_TOLERANCE) {
          fail(
            'G11',
            `${row.name}[${frame}]'s ${side} hand target is beyond an arm ` +
              `${ARM_LENGTH.toFixed(4)} long, so the IK clamped it ${moved.toFixed(4)} short ` +
              `and locked the elbow straight`,
          );
        } else if (spanned < ARM_LENGTH * MIN_ARM_EXTENSION) {
          fail(
            'G11',
            `${row.name}[${frame}]'s ${side} arm spans only ${spanned.toFixed(4)} of its own ` +
              `${ARM_LENGTH.toFixed(4)} — ${((spanned / ARM_LENGTH) * 100).toFixed(0)}%, under ` +
              `${(MIN_ARM_EXTENSION * 100).toFixed(0)}% — so the solver has slack to spend and ` +
              `will throw the elbow out sideways`,
          );
        }
      }
    }
  }
}

/**
 * `G12` — the lash's thrust peaks on the frame the mob deals its damage.
 *
 * `Troglodyte` fires its hit at the middle of the strike. A timing table that
 * drifted from the choreography puts the tongue at full reach two frames after
 * the player has already been poisoned.
 */
function gateImpactIsThePeak(): void {
  let peakFrame = 0;
  let peakStoop = -Infinity;
  for (let frame = 0; frame < LASH_FRAMES; frame++) {
    const pose = lashSide((frame + 0.5) / LASH_FRAMES);
    if (pose.stoop > peakStoop) {
      peakStoop = pose.stoop;
      peakFrame = frame;
    }
  }
  const impactFrame = Math.floor(LASH_IMPACT_PROGRESS * LASH_FRAMES);
  if (Math.abs(peakFrame - impactFrame) > 1) {
    fail(
      'G12',
      `lash_side reaches its furthest thrust on frame ${peakFrame} but the mob deals damage on ` +
        `frame ${impactFrame} — the two have drifted apart`,
    );
  }
}

/**
 * `G13` — the mouth anchors the runtime carries match the ones the rig
 * measures.
 *
 * `src/sprites/troglodyteSprite.ts` cannot import from `scripts/` (rootDir is
 * `src/`), so the numbers are duplicated. A redraw moves the head and this is
 * the only thing that notices.
 */
const MOUTH_ANCHOR_TOLERANCE = 0.004;

/** The generator names the away view `back`; the runtime names it `away`. */
const RUNTIME_VIEW_OF: Record<TrogView, TroglodyteView> = {
  front: 'front',
  side: 'side',
  back: 'away',
};

function gateMouthAnchors(): void {
  let printedTable = false;
  const measured = mouthAnchorsInTile();
  for (const view of ['front', 'side', 'back'] as const) {
    const want = measured[view];
    const have = TROGLODYTE_MOUTH_ANCHORS[RUNTIME_VIEW_OF[view]];
    const off = Math.hypot(want.x - have.x, want.y - have.y);
    if (off > MOUTH_ANCHOR_TOLERANCE) {
      fail(
        'G13',
        `the ${view} mouth anchor has moved to (${want.x.toFixed(4)}, ${want.y.toFixed(4)}) ` +
          `but the runtime still carries (${have.x.toFixed(4)}, ${have.y.toFixed(4)}) — ` +
          `${off.toFixed(4)} off, limit ${MOUTH_ANCHOR_TOLERANCE}. Paste the printed anchors ` +
          `into TROGLODYTE_MOUTH_ANCHORS in src/sprites/troglodyteTongue.ts.`,
      );
    }
  }

  // And the per-frame table, which is what actually positions the tongue. A
  // single anchor cannot follow a head that is thrown forward through the
  // strike; this is the gate that notices when the two fall out of step.
  const perFrame = lashMouthAnchorsInTile();
  for (const view of ['front', 'side', 'back'] as const) {
    const want = perFrame[view];
    const have = TROGLODYTE_LASH_MOUTH_ANCHORS[RUNTIME_VIEW_OF[view]];
    if (have.length !== want.length) {
      fail(
        'G17',
        `the ${view} lash has ${want.length} frames but the runtime carries ` +
          `${have.length} mouth anchors for it. Paste the printed table into ` +
          `TROGLODYTE_LASH_MOUTH_ANCHORS in src/sprites/troglodyteTongue.ts.`,
      );
      printedTable = printedTable || (printLashAnchorTable(), true);
      continue;
    }
    for (let frame = 0; frame < want.length; frame++) {
      const off = Math.hypot(want[frame].x - have[frame].x, want[frame].y - have[frame].y);
      if (off > MOUTH_ANCHOR_TOLERANCE) {
        printedTable = printedTable || (printLashAnchorTable(), true);
        fail(
          'G17',
          `the ${view} lash mouth anchor on frame ${frame} has moved to ` +
            `(${want[frame].x.toFixed(4)}, ${want[frame].y.toFixed(4)}) but the runtime carries ` +
            `(${have[frame].x.toFixed(4)}, ${have[frame].y.toFixed(4)}) — ${off.toFixed(4)} off, ` +
            `limit ${MOUTH_ANCHOR_TOLERANCE}. Paste the printed table into ` +
            `TROGLODYTE_LASH_MOUTH_ANCHORS in src/sprites/troglodyteTongue.ts.`,
        );
      }
    }
  }
}

/** Prints the per-frame table in the shape the runtime module wants it. */
function printLashAnchorTable(): void {
  const perFrame = lashMouthAnchorsInTile();
  const rows = (['front', 'side', 'back'] as const).map((view) => {
    const frames = perFrame[view]
      .map((p) => `    { x: ${p.x.toFixed(4)}, y: ${p.y.toFixed(4)} },`)
      .join('\n');
    return `  ${RUNTIME_VIEW_OF[view]}: [\n${frames}\n  ],`;
  });
  console.log(
    `\n  lash mouth anchors — paste into TROGLODYTE_LASH_MOUTH_ANCHORS:\n{\n${rows.join('\n')}\n};\n`,
  );
}

/**
 * `G14` — the sheet is not quietly getting expensive.
 *
 * Reported even when it passes: every sheet in this game is preloaded at boot
 * and held decoded, so a row added without thought is memory nobody sees spent.
 */
const TEXTURE_BUDGET_MEGAPIXELS = 2.4;
const BYTES_PER_PIXEL = 4;
const BYTES_PER_MEGABYTE = 1024 * 1024;

function gateTextureSize(sheet: BakedSheet, tongue: BakedSheet): void {
  const bodyPixels =
    sheet.columns * sheet.geometry.frameWidth * ROWS.length * sheet.geometry.frameHeight;
  const tonguePixels = TONGUE_FRAMES * tongue.geometry.frameWidth * tongue.geometry.frameHeight;
  const megapixels = (bodyPixels + tonguePixels) / 1e6;
  const decodedMb = ((bodyPixels + tonguePixels) * BYTES_PER_PIXEL) / BYTES_PER_MEGABYTE;
  console.log(
    `  texture: ${megapixels.toFixed(2)}MP across both sheets, ${decodedMb.toFixed(1)}MB decoded`,
  );
  if (megapixels > TEXTURE_BUDGET_MEGAPIXELS) {
    fail(
      'G14',
      `the two sheets total ${megapixels.toFixed(2)} megapixels against a budget of ` +
        `${TEXTURE_BUDGET_MEGAPIXELS} — they are preloaded and held decoded at boot`,
    );
  }
}

/**
 * `G15` — the runtime's gore part list is the bake's own, in the bake's order.
 *
 * The order runs `trogGorePieces()` → the sheet's columns → the manifest's
 * `colOffset`s → `TROGLODYTE_GORE_PARTS`. Every other link in that chain fails
 * loudly; this one fails by dropping a body part on the floor and saying
 * nothing, because `BodyPartGoreSystem` skips a state it cannot find.
 */
function gateGoreContract(): void {
  if (TROGLODYTE_GORE_PARTS.length !== GORE_STATES.length) {
    fail(
      'G15',
      `the runtime lists ${TROGLODYTE_GORE_PARTS.length} gore parts against the ` +
        `${GORE_STATES.length} the bake produces`,
    );
    return;
  }
  GORE_STATES.forEach((state, index) => {
    if (TROGLODYTE_GORE_PARTS[index] === state) return;
    fail(
      'G15',
      `gore piece ${index} bakes as "${state}" but the runtime spawns ` +
        `"${TROGLODYTE_GORE_PARTS[index]}" in that slot`,
    );
  });
}

/**
 * `G16` — the *baked* tongue reaches as far as the runtime scales it by.
 *
 * `troglodyteSprite.ts` scales the tongue overlay per view from
 * `TROGLODYTE_TONGUE_ART_REACH_TILES` so the tip lands on the mob's hit
 * boundary. Wrong, and the thing that visibly reaches the player stops being
 * the thing that damages them.
 *
 * Measured on the last frame's ink, not by comparing the two constants. The
 * constants agreed while the sheet did not: sampling the row at cell centres
 * baked the longest frame at 0.91 of full extension, so the art spanned 2.92
 * tiles against a declared 3.2 and every strike landed a quarter of a tile
 * short — invisible to a constant-to-constant check, which passed throughout.
 */
const TONGUE_REACH_SHORTFALL_LIMIT = 0.06;
/**
 * The venom glow and the head's barbs paint past the whip's own tip, so ink
 * legitimately runs beyond the spine's reach.
 */
const TONGUE_REACH_OVERSHOOT_LIMIT = 0.3;

function gateTongueReach(grid: Grid, tongue: BakedSheet): void {
  if (TROGLODYTE_TONGUE_ART_REACH_TILES !== TONGUE_REACH_TILES) {
    fail(
      'G16',
      `the painter reaches ${TONGUE_REACH_TILES} tiles but the runtime scales the overlay ` +
        `against ${TROGLODYTE_TONGUE_ART_REACH_TILES} — update ` +
        `TROGLODYTE_TONGUE_ART_REACH_TILES in src/sprites/troglodyteTongue.ts`,
    );
  }

  const { frameWidth, frameHeight, tileX } = tongue.geometry;
  const lastFrame = TONGUE_FRAMES - 1;
  let rightmost = -Infinity;
  for (let x = frameWidth - 1; x >= 0; x--) {
    for (let y = 0; y < frameHeight; y++) {
      if (alphaAt(grid, lastFrame * frameWidth + x, y) >= INK_ALPHA_THRESHOLD) {
        rightmost = x;
        break;
      }
    }
    if (rightmost !== -Infinity) break;
  }
  if (rightmost === -Infinity) {
    fail('G16', `the tongue's last frame painted nothing`);
    return;
  }

  const baked = (rightmost - tileX) / TILE_SCALE;
  if (baked < TROGLODYTE_TONGUE_ART_REACH_TILES - TONGUE_REACH_SHORTFALL_LIMIT) {
    fail(
      'G16',
      `the baked tongue's furthest frame reaches ${baked.toFixed(3)} tiles from its own root, ` +
        `but the runtime scales it as though it reached ` +
        `${TROGLODYTE_TONGUE_ART_REACH_TILES} — every strike would land ` +
        `${(TROGLODYTE_TONGUE_ART_REACH_TILES - baked).toFixed(3)} tiles short of the range it ` +
        `damages from`,
    );
  }
  if (baked > TROGLODYTE_TONGUE_ART_REACH_TILES + TONGUE_REACH_OVERSHOOT_LIMIT) {
    fail(
      'G16',
      `the baked tongue reaches ${baked.toFixed(3)} tiles against a declared ` +
        `${TROGLODYTE_TONGUE_ART_REACH_TILES} — further than the glow and barbs account for, ` +
        `so it would visibly overshoot the range it damages from`,
    );
  }
}

// ── Runner ───────────────────────────────────────────────────────────────────

async function runGates(): Promise<void> {
  console.log('Gating the troglodyte bake…');
  const body = bake();
  const tongue = bakeTongue();
  const bodyGrid = gridOf(await decode(body));
  const tongueGrid = gridOf(await decode(tongue));

  gateBorderClip(bodyGrid, body);
  gateAnchor(bodyGrid, body);
  gateLoopClosure(bodyGrid, body);
  gateMotionContinuity(bodyGrid, body);
  gateCentroidDrift(bodyGrid, body);
  gateGoreLegibility(bodyGrid, body);
  gateGoreDistinctness(bodyGrid, body);
  gateTongueRoot(tongueGrid, tongue);
  gateTongueMonotonic(tongueGrid, tongue);
  gateFootSlide();
  gateArmReach();
  gateImpactIsThePeak();
  gateMouthAnchors();
  gateGoreContract();
  gateTongueReach(tongueGrid, tongue);
  gateTextureSize(body, tongue);

  if (failures.length > 0) {
    throw new Error(
      `${failures.length} gate${failures.length === 1 ? '' : 's'} failed; nothing was written:\n  ` +
        failures.join('\n  '),
    );
  }
  console.log(`  all gates passed`);
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  runGates()
    .then(async () => {
      const { writeSheets } = await import('./generate-troglodyte-sprite');
      writeSheets();
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}

export { runGates };
