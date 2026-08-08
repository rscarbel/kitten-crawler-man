/**
 * The bake gate for the Juicer sheet, and the entry point `npm run gen:juicer`
 * runs.
 *
 * A sheet that fails a gate must never reach disk. This module bakes into
 * memory, measures the baked pixels and the pose stream, collects every defect
 * it finds with the number it measured and the limit it measured against, and
 * only then lets the generator write. Failures accumulate rather than throwing
 * one at a time, so one run reports everything that is wrong.
 *
 * `--skip-manifest-gate` is the measure → paste → re-run escape hatch: after a
 * pose change the cell geometry moves, so the manifest is knowingly stale for
 * exactly one run.
 */

import { type Canvas, createCanvas, loadImage } from 'canvas';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

import {
  type BakedSheet,
  CARRY_DRIFT_LIMIT_TILES,
  GORE_STATES,
  GROUND_OFFSET_PX,
  ROWS,
  type RowSpec,
  TILE_SCALE,
  bake,
  carryAnchors,
  manifestMismatch,
  throwAnchors,
  worstCarryDrift,
  writeSheet,
} from './generate-juicer-sprite.js';
import {
  JOINT_SLACK,
  type JuicerPose,
  SHIN_LENGTH,
  THIGH_LENGTH,
  ankleFor,
  solvedArm,
  solvedHip,
  solvedLegRoot,
  solvedShoulderCentre,
} from './juicerArt.js';
import {
  JUICER_PUNCH_FRAMES,
  JUICER_PUNCH_IMPACT_PROGRESS,
  JUICER_THROW_FRAMES,
  JUICER_THROW_RELEASE_PROGRESS,
  juicerImpactSpriteFrame,
} from '../src/sprites/juicerAttackTiming.js';
import {
  JUICER_CARRY_HAND_ANCHORS,
  JUICER_THROW_HAND_ANCHORS,
  type JuicerHandView,
  type TileFraction,
} from '../src/sprites/juicerHandAnchor.js';

const SKIP_MANIFEST_GATE = process.argv.includes('--skip-manifest-gate');

const INK_ALPHA_THRESHOLD = 24;
const SOLID_ALPHA_THRESHOLD = 200;
const CHANNELS = 4;
const ALPHA_OFFSET = 3;
const DEGREES_PER_RADIAN = 180 / Math.PI;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

interface Grid {
  width: number;
  height: number;
  data: Uint8ClampedArray;
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

interface Cell {
  readonly col: number;
  readonly row: number;
}

function cellAlpha(grid: Grid, sheet: BakedSheet, cell: Cell): Uint8ClampedArray {
  const { frameWidth, frameHeight } = sheet.geometry;
  const out = new Uint8ClampedArray(frameWidth * frameHeight);
  const baseX = cell.col * frameWidth;
  const baseY = cell.row * frameHeight;
  for (let y = 0; y < frameHeight; y++) {
    for (let x = 0; x < frameWidth; x++) {
      const source = ((baseY + y) * grid.width + baseX + x) * CHANNELS + ALPHA_OFFSET;
      out[y * frameWidth + x] = grid.data[source];
    }
  }
  return out;
}

interface InkStats {
  count: number;
  centroidX: number;
  centroidY: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
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
  const height = alpha.length / width;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x] < threshold) continue;
      count++;
      sumX += x;
      sumY += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (count === 0) {
    return { count: 0, centroidX: 0, centroidY: 0, minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }
  return { count, centroidX: sumX / count, centroidY: sumY / count, minX, maxX, minY, maxY };
}

function frameDelta(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let differing = 0;
  for (let i = 0; i < a.length; i++) {
    const inkedA = a[i] >= INK_ALPHA_THRESHOLD;
    const inkedB = b[i] >= INK_ALPHA_THRESHOLD;
    if (inkedA !== inkedB) differing++;
  }
  return differing;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function cellsOf(
  grid: Grid,
  sheet: BakedSheet,
  rowIndex: number,
  count: number,
): Uint8ClampedArray[] {
  return Array.from({ length: count }, (_unused, col) =>
    cellAlpha(grid, sheet, { col, row: rowIndex }),
  );
}

/**
 * The index of a row a gate names, or −1 after recording a failure.
 *
 * Every one of these names is a string literal written here rather than in
 * `ROWS`, so renaming a row would otherwise turn its gate into a silent no-op:
 * present, green, and measuring nothing. A gate that cannot find its subject
 * must fail, not skip.
 */
function rowIndexOf(name: string): number {
  const index = ROWS.findIndex((row) => row.name === name);
  if (index < 0)
    fail('G0', `no row named "${name}" — a gate is guarding a row that no longer exists`);
  return index;
}

function poseStreamOf(name: string, gateId: string): ((frame: number) => JuicerPose) | null {
  const index = rowIndexOf(name);
  if (index < 0) return null;
  const posed = ROWS[index].pose;
  if (posed === null) {
    fail(gateId, `${name} has no pose stream to measure`);
    return null;
  }
  return posed;
}

// ── Pixel gates ──────────────────────────────────────────────────────────────

/** G1 — no frame may paint on its own cell border, and none may be blank. */
function gateBorderClip(grid: Grid, sheet: BakedSheet): void {
  const { frameWidth, frameHeight } = sheet.geometry;
  ROWS.forEach((row, rowIndex) => {
    for (let col = 0; col < row.frameCount; col++) {
      const stats = inkStatsOf(cellAlpha(grid, sheet, { col, row: rowIndex }), frameWidth);
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
          `${row.name}[${col}] paints on its cell border (ink box ${stats.minX}..${stats.maxX} × ` +
            `${stats.minY}..${stats.maxY} in a ${frameWidth}×${frameHeight} cell)`,
        );
      }
    }
  });
}

const FOOT_TOLERANCE_PX = 6;
const STANDING_ROWS = ['idle', 'idle_side', 'idle_away'] as const;

/**
 * G2 — the feet stand where `tileY` claims the ground is.
 *
 * Measured against the solid-alpha threshold, so the soft contact shadow under
 * him does not count as the lowest ink and quietly satisfy the gate.
 */
function gateAnchor(grid: Grid, sheet: BakedSheet): void {
  const { frameWidth, tileY } = sheet.geometry;
  const groundY = tileY + GROUND_OFFSET_PX;
  for (const name of STANDING_ROWS) {
    const rowIndex = rowIndexOf(name);
    if (rowIndex < 0) continue;
    const stats = inkStatsOf(
      cellAlpha(grid, sheet, { col: 0, row: rowIndex }),
      frameWidth,
      SOLID_ALPHA_THRESHOLD,
    );
    const drop = Math.abs(stats.maxY - groundY);
    if (drop > FOOT_TOLERANCE_PX) {
      fail(
        'G2',
        `${name}[0] has its lowest solid ink at y=${stats.maxY} against a ground line of ` +
          `${groundY} (tileY ${tileY} + ${GROUND_OFFSET_PX}) — ${drop.toFixed(1)}px off, ` +
          `limit ${FOOT_TOLERANCE_PX}`,
      );
    }
  }
}

const LOOP_SEAM_LIMIT = 2.1;
const LOOP_SEAM_VS_WORST_STEP = 1.25;

/** G3 — a loop must not pop across its seam. */
function gateLoopClosure(grid: Grid, sheet: BakedSheet): void {
  ROWS.forEach((row, rowIndex) => {
    if (row.kind !== 'loop') return;
    const cells = cellsOf(grid, sheet, rowIndex, row.frameCount);
    const steps: number[] = [];
    for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
    const seam = frameDelta(cells[cells.length - 1], cells[0]);
    const typical = median(steps);
    if (typical === 0) return;
    const allowed = Math.max(
      typical * LOOP_SEAM_LIMIT,
      Math.max(...steps) * LOOP_SEAM_VS_WORST_STEP,
    );
    if (seam > allowed) {
      fail(
        'G3',
        `${row.name} pops across its loop seam: last→first differs by ${seam}px against a median ` +
          `step of ${typical}px (allowed ${allowed.toFixed(0)}px)`,
      );
    }
  });
}

const LOOP_STEP_LIMIT = 2.6;
const ONE_SHOT_STEP_LIMIT = 4;
const STEP_FLOOR_SHARE = 0.005;
/**
 * How far the worst step may exceed the *second* worst.
 *
 * Any cycle driven off a sine has a bimodal step distribution — a handful of
 * fast steps around the zero crossings and a handful of slow ones at the
 * extremes — so its median is the slow step and a perfectly smooth row scores
 * several times it. What actually distinguishes a snap is that it is a *lone*
 * outlier: real motion that is fast somewhere is fast in several places.
 */
const STEP_VS_RUNNER_UP = 1.35;
/**
 * The slam is a declared spike. Both punch rows fold him from standing to
 * fists-on-the-floor across the two frames either side of impact, and that is
 * the attack — flattening it to pass a continuity threshold would remove the
 * only frames the player reads as a blow.
 */
const DECLARED_SPIKES: ReadonlyArray<{ readonly row: string; readonly step: number }> = [
  {
    row: 'punch',
    step: juicerImpactSpriteFrame(JUICER_PUNCH_FRAMES, JUICER_PUNCH_IMPACT_PROGRESS) - 1,
  },
  {
    row: 'punch',
    step: juicerImpactSpriteFrame(JUICER_PUNCH_FRAMES, JUICER_PUNCH_IMPACT_PROGRESS),
  },
  {
    row: 'punch_side',
    step: juicerImpactSpriteFrame(JUICER_PUNCH_FRAMES, JUICER_PUNCH_IMPACT_PROGRESS) - 1,
  },
  {
    row: 'punch_side',
    step: juicerImpactSpriteFrame(JUICER_PUNCH_FRAMES, JUICER_PUNCH_IMPACT_PROGRESS),
  },
  {
    row: 'punch_away',
    step: juicerImpactSpriteFrame(JUICER_PUNCH_FRAMES, JUICER_PUNCH_IMPACT_PROGRESS) - 1,
  },
  {
    row: 'punch_away',
    step: juicerImpactSpriteFrame(JUICER_PUNCH_FRAMES, JUICER_PUNCH_IMPACT_PROGRESS),
  },
];

function isDeclaredSpike(row: string, step: number): boolean {
  return DECLARED_SPIKES.some((spike) => spike.row === row && spike.step === step);
}

/** G4 — no consecutive-frame step far above the row's own median. */
function gateMotionContinuity(grid: Grid, sheet: BakedSheet): void {
  const cellArea = sheet.geometry.frameWidth * sheet.geometry.frameHeight;
  ROWS.forEach((row, rowIndex) => {
    if (row.kind === 'gore') return;
    const cells = cellsOf(grid, sheet, rowIndex, row.frameCount);
    const steps: number[] = [];
    for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
    const typical = median(steps);
    const runnerUp = [...steps].sort((a, b) => b - a)[1] ?? 0;
    const limitShare = row.kind === 'loop' ? LOOP_STEP_LIMIT : ONE_SHOT_STEP_LIMIT;
    const allowed = Math.max(
      typical * limitShare,
      runnerUp * STEP_VS_RUNNER_UP,
      cellArea * STEP_FLOOR_SHARE,
    );
    steps.forEach((step, i) => {
      if (step > allowed && !isDeclaredSpike(row.name, i)) {
        fail(
          'G4',
          `${row.name} snaps between frames ${i} and ${i + 1}: ${step}px changed against a ` +
            `median step of ${typical}px (allowed ${allowed.toFixed(0)}px)`,
        );
      }
    });
  });
}

const CENTROID_SEAM_LIMIT = 1.6;
/**
 * A cycle whose speed is not uniform — anything driven off a sine — has some
 * in-cycle steps much larger than the median, and the seam may legitimately be
 * one of them. Without this clause the gate fires on correct animation.
 */
const CENTROID_SEAM_VS_WORST_STEP = 1.25;
const CENTROID_SEAM_FLOOR_PX = 1;

/** G5 — a loop's ink centroid must come back to where it started. */
function gateCentroidDrift(grid: Grid, sheet: BakedSheet): void {
  const { frameWidth } = sheet.geometry;
  ROWS.forEach((row, rowIndex) => {
    if (row.kind !== 'loop') return;
    const stats = cellsOf(grid, sheet, rowIndex, row.frameCount).map((cell) =>
      inkStatsOf(cell, frameWidth),
    );
    const steps: number[] = [];
    for (let i = 1; i < stats.length; i++) {
      steps.push(
        Math.hypot(
          stats[i].centroidX - stats[i - 1].centroidX,
          stats[i].centroidY - stats[i - 1].centroidY,
        ),
      );
    }
    const last = stats[stats.length - 1];
    const first = stats[0];
    const seam = Math.hypot(last.centroidX - first.centroidX, last.centroidY - first.centroidY);
    const allowed = Math.max(
      median(steps) * CENTROID_SEAM_LIMIT,
      Math.max(...steps) * CENTROID_SEAM_VS_WORST_STEP,
      CENTROID_SEAM_FLOOR_PX,
    );
    if (seam > allowed) {
      fail(
        'G5',
        `${row.name} slides across its loop seam: the ink centroid moves ${seam.toFixed(2)}px ` +
          `against a typical step of ${median(steps).toFixed(2)}px (allowed ${allowed.toFixed(2)}px)`,
      );
    }
  });
}

const SETTLE_LIMIT_SHARE = 0.05;
/**
 * Every one-shot here hands back to the idle of its own view: the throw's
 * follow-through and the punch's recovery both end standing, and there is no
 * third row either of them flows into.
 */
const ONE_SHOT_SETTLES: ReadonlyArray<readonly [string, string]> = [
  ['throw', 'idle'],
  ['throw_side', 'idle_side'],
  ['throw_away', 'idle_away'],
  ['punch', 'idle'],
  ['punch_side', 'idle_side'],
  ['punch_away', 'idle_away'],
];

/** G6 — a one-shot's last frame must match frame 0 of the row it hands off to. */
function gateOneShotSettle(grid: Grid, sheet: BakedSheet): void {
  const cellArea = sheet.geometry.frameWidth * sheet.geometry.frameHeight;
  for (const [shot, settle] of ONE_SHOT_SETTLES) {
    const shotIndex = rowIndexOf(shot);
    const settleIndex = rowIndexOf(settle);
    if (shotIndex < 0 || settleIndex < 0) continue;
    const shotRow = ROWS[shotIndex];
    const last = cellAlpha(grid, sheet, { col: shotRow.frameCount - 1, row: shotIndex });
    const target = cellAlpha(grid, sheet, { col: 0, row: settleIndex });
    const delta = frameDelta(last, target);
    const allowed = cellArea * SETTLE_LIMIT_SHARE;
    if (delta > allowed) {
      fail(
        'G6',
        `${shot} does not hand off to ${settle}: its last frame differs from ${settle}[0] by ` +
          `${delta}px (allowed ${allowed.toFixed(0)}px)`,
      );
    }
  }
}

const IN_GAME_TILE = 32;
const GORE_MIN_SHORT_AXIS_PX = 9;

/** G7 — every gore piece must still be a shape at the size it actually renders. */
function gateGoreLegibility(grid: Grid, sheet: BakedSheet): void {
  const rowIndex = ROWS.findIndex((row) => row.kind === 'gore');
  if (rowIndex < 0) {
    fail('G7', 'no gore row in ROWS — the gore gates are measuring nothing');
    return;
  }
  const screenScale = IN_GAME_TILE / TILE_SCALE;
  GORE_STATES.forEach((state, col) => {
    const stats = inkStatsOf(
      cellAlpha(grid, sheet, { col, row: rowIndex }),
      sheet.geometry.frameWidth,
    );
    const shortAxis =
      (Math.min(stats.maxX - stats.minX, stats.maxY - stats.minY) + 1) * screenScale;
    if (shortAxis < GORE_MIN_SHORT_AXIS_PX) {
      fail(
        'G7',
        `${state} is ${shortAxis.toFixed(1)}px across its short axis in game (limit ` +
          `${GORE_MIN_SHORT_AXIS_PX}px) — at that size it is a speck, not a body part`,
      );
    }
  });
}

const DISTINCT_MASK = 16;
const DISTINCT_IOU_LIMIT = 0.62;

function maskOf(grid: Grid, sheet: BakedSheet, cell: Cell): boolean[] {
  const alpha = cellAlpha(grid, sheet, cell);
  const { frameWidth } = sheet.geometry;
  const stats = inkStatsOf(alpha, frameWidth);
  const width = Math.max(1, stats.maxX - stats.minX + 1);
  const height = Math.max(1, stats.maxY - stats.minY + 1);
  // Scale is normalised away but aspect deliberately is not: stretching each
  // piece to fill its own bounding box maps every convex blob onto a filled
  // square and measures the normalisation rather than the art.
  const span = Math.max(width, height);
  const mask: boolean[] = new Array(DISTINCT_MASK * DISTINCT_MASK).fill(false);
  for (let y = 0; y < DISTINCT_MASK; y++) {
    for (let x = 0; x < DISTINCT_MASK; x++) {
      const sourceX = Math.round(
        stats.minX + (width - span) / 2 + ((x + 0.5) / DISTINCT_MASK) * span,
      );
      const sourceY = Math.round(
        stats.minY + (height - span) / 2 + ((y + 0.5) / DISTINCT_MASK) * span,
      );
      if (sourceX < 0 || sourceY < 0 || sourceX >= frameWidth) continue;
      if (sourceY * frameWidth + sourceX >= alpha.length) continue;
      mask[y * DISTINCT_MASK + x] = alpha[sourceY * frameWidth + sourceX] >= INK_ALPHA_THRESHOLD;
    }
  }
  return mask;
}

/** G8 — no two gore pieces may share a silhouette. */
function gateGoreDistinctness(grid: Grid, sheet: BakedSheet): void {
  const rowIndex = ROWS.findIndex((row) => row.kind === 'gore');
  if (rowIndex < 0) return;
  const masks = GORE_STATES.map((_state, col) => maskOf(grid, sheet, { col, row: rowIndex }));
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
          'G8',
          `${GORE_STATES[a]} and ${GORE_STATES[b]} share ${(iou * 100).toFixed(0)}% of their ` +
            `silhouette (limit ${(DISTINCT_IOU_LIMIT * 100).toFixed(0)}%) — they will read as the same piece`,
        );
      }
    }
  }
}

/**
 * The hard ceiling for this sheet. He is a single-instance boss preloaded with
 * floor one, so a large sheet is affordable, but sixteen rows of a 2.3-tile
 * creature at a 2× bake is the largest creature texture in the game and it
 * needs a stated limit rather than whatever falls out.
 */
const TEXTURE_BUDGET_MEGAPIXELS = 8;

/** G9 — the sheet's own size, reported whether or not it passes. */
function gateTextureSize(sheet: BakedSheet): void {
  const megapixels =
    (sheet.columns * sheet.geometry.frameWidth * ROWS.length * sheet.geometry.frameHeight) / 1e6;
  console.log(
    `  G9 texture: ${megapixels.toFixed(2)} MP of a ${TEXTURE_BUDGET_MEGAPIXELS} MP budget`,
  );
  if (megapixels > TEXTURE_BUDGET_MEGAPIXELS) {
    fail(
      'G9',
      `the sheet is ${megapixels.toFixed(2)} MP against a budget of ${TEXTURE_BUDGET_MEGAPIXELS} MP`,
    );
  }
}

// ── Pose-stream gates ────────────────────────────────────────────────────────

function poseStream(): Array<{ row: RowSpec; frame: number; pose: JuicerPose }> {
  const out: Array<{ row: RowSpec; frame: number; pose: JuicerPose }> = [];
  for (const row of ROWS) {
    if (row.pose === null) continue;
    for (let frame = 0; frame < row.frameCount; frame++) {
      out.push({ row, frame, pose: row.pose(frame) });
    }
  }
  return out;
}

const FOOT_DOWN_LIMIT = 0.002;
const CONTACT_ROLL_TOLERANCE = 0.02;
/** Rows that notionally cover ground, so their planted feet must roll backward. */
const TRAVELLING_ROWS = ['walk_side', 'sprint_side'] as const;

/**
 * G10 — a planted foot never slips.
 *
 * A walk cycle plays on the spot with the world scrolling past, so its planted
 * foot has to roll backward at exactly the speed the body is notionally moving
 * forward. "x must be constant" fails every correct walk cycle ever authored;
 * what actually holds is that the foot never moves *forward* while down, and
 * that each backward step is the same size as the last.
 */
function gateFootSlide(): void {
  for (const name of TRAVELLING_ROWS) {
    const posed = poseStreamOf(name, 'G10');
    if (posed === null) continue;
    const row = ROWS[rowIndexOf(name)];
    for (const side of ['leftFoot', 'rightFoot'] as const) {
      let previousStep: number | null = null;
      for (let i = 1; i < row.frameCount; i++) {
        const before = posed(i - 1)[side];
        const now = posed(i)[side];
        if (before.y !== 0 || now.y !== 0) {
          previousStep = null;
          continue;
        }
        const step = now.x - before.x;
        if (step > FOOT_DOWN_LIMIT) {
          fail(
            'G10',
            `${name}'s ${side} moves ${step.toFixed(4)} tile *forward* between frames ${i - 1} ` +
              `and ${i} while planted`,
          );
        }
        if (previousStep !== null && Math.abs(step - previousStep) > CONTACT_ROLL_TOLERANCE) {
          fail(
            'G10',
            `${name}'s ${side} rolls unevenly: ${Math.abs(step).toFixed(4)} tile between frames ` +
              `${i - 1} and ${i} against ${Math.abs(previousStep).toFixed(4)} before it ` +
              `(tolerance ${CONTACT_ROLL_TOLERANCE})`,
          );
        }
        previousStep = step;
      }
    }
  }
}

const LEG_REACH_LIMIT = THIGH_LENGTH + SHIN_LENGTH - JOINT_SLACK;

/**
 * G11 — hip → ankle stays inside the leg's span on *every* frame. One clamped
 * frame locks the leg straight, the next tuck snaps it back, and the result
 * reads as a hop rather than as a walk.
 */
function gateLegReach(): void {
  let worst = 0;
  let worstAt = '';
  for (const { row, frame, pose } of poseStream()) {
    for (const [side, foot, pitch] of [
      ['left', pose.leftFoot, pose.leftFootPitch],
      ['right', pose.rightFoot, pose.rightFootPitch],
    ] as const) {
      const root = solvedLegRoot(pose, row.view, side);
      const ankle = ankleFor(foot, pitch);
      const reach = Math.hypot(ankle.x - root.x, ankle.y - root.y);
      if (reach > worst) {
        worst = reach;
        worstAt = `${row.name}[${frame}] ${side}`;
      }
      if (reach > LEG_REACH_LIMIT) {
        fail(
          'G11',
          `${row.name}[${frame}]'s ${side} leg has to span ${reach.toFixed(4)} from its root ` +
            `against a leg ${LEG_REACH_LIMIT.toFixed(4)} long — the IK clamps and the step ` +
            `becomes a hop`,
        );
      }
    }
  }
  console.log(
    `  G11 leg reach: worst frame spans ${worst.toFixed(4)} of ${LEG_REACH_LIMIT.toFixed(4)} (${worstAt})`,
  );
}

const CLAMP_TOLERANCE = 0.0005;
const MIN_ELBOW_DEGREES = 20;

/**
 * G12 — no arm folds implausibly flat, and no IK arm is clamped short.
 *
 * The reach half of this measures the *demand* — where the choreography asked
 * the hand to be against where the solver put it — rather than the solved
 * chain, because the solver clamps and a gate reading its output can only ever
 * see equality.
 */
function gateArmReach(): void {
  for (const { row, frame, pose } of poseStream()) {
    for (const [side, hand, angles] of [
      ['left', pose.leftHand, pose.leftArmAngles],
      ['right', pose.rightHand, pose.rightArmAngles],
    ] as const) {
      const chain = solvedArm(pose, row.view, side);
      const upper = Math.hypot(chain.joint.x - chain.root.x, chain.joint.y - chain.root.y);
      const lower = Math.hypot(chain.end.x - chain.joint.x, chain.end.y - chain.joint.y);
      const span = Math.hypot(chain.end.x - chain.root.x, chain.end.y - chain.root.y);
      const cosine = (upper * upper + lower * lower - span * span) / (2 * upper * lower);
      const elbow = Math.acos(Math.min(1, Math.max(-1, cosine))) * DEGREES_PER_RADIAN;
      if (elbow < MIN_ELBOW_DEGREES) {
        fail(
          'G12',
          `${row.name}[${frame}]'s ${side} elbow folds to ${elbow.toFixed(1)}° (limit ` +
            `${MIN_ELBOW_DEGREES}°) — the forearm doubles back over the upper arm`,
        );
      }
      // Only an arm placed by a hand target can clamp.
      if (angles !== null) continue;
      const moved = Math.hypot(chain.end.x - hand.x, chain.end.y - hand.y);
      if (moved > CLAMP_TOLERANCE) {
        fail(
          'G12',
          `${row.name}[${frame}]'s ${side} hand target is out of reach: the IK clamped it ` +
            `${moved.toFixed(4)} short`,
        );
      }
    }
  }
}

const THROW_ROWS = ['throw', 'throw_side', 'throw_away'] as const;
const PUNCH_ROWS = ['punch', 'punch_side', 'punch_away'] as const;

/**
 * G13 — the declared release and impact frames are the extremes of their rows.
 *
 * A timing table that drifted from the choreography is invisible in every other
 * gate: the row still animates, the damage still lands, and the two simply stop
 * describing the same moment.
 *
 * The throw's peak is the gripping hand's distance from the hip, which is the
 * one measure that works in all three views — edge-on the heave travels along
 * X, head-on it travels almost entirely in height, and full extension away from
 * the body is what both of those have in common. The punch's peak is the hand's
 * lowest point, because a ground punch ends on the floor in every view.
 */
function gateImpactIsThePeak(): void {
  const release = juicerImpactSpriteFrame(JUICER_THROW_FRAMES, JUICER_THROW_RELEASE_PROGRESS);
  for (const name of THROW_ROWS) {
    const posed = poseStreamOf(name, 'G13');
    if (posed === null) continue;
    const row = ROWS[rowIndexOf(name)];
    let peakFrame = 0;
    let peakReach = -Infinity;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const pose = posed(frame);
      const hand = solvedArm(pose, row.view, 'right').end;
      const hip = solvedHip(pose, row.view);
      const reach = Math.hypot(hand.x - hip.x, hand.y - hip.y);
      if (reach > peakReach) {
        peakReach = reach;
        peakFrame = frame;
      }
    }
    if (peakFrame !== release) {
      fail(
        'G13',
        `${name} reaches furthest from the hip on frame ${peakFrame}, but the shared timing puts ` +
          `the release on frame ${release} (progress ${JUICER_THROW_RELEASE_PROGRESS} of ` +
          `${JUICER_THROW_FRAMES} frames)`,
      );
    }
  }

  const impact = juicerImpactSpriteFrame(JUICER_PUNCH_FRAMES, JUICER_PUNCH_IMPACT_PROGRESS);
  for (const name of PUNCH_ROWS) {
    const posed = poseStreamOf(name, 'G13');
    if (posed === null) continue;
    const row = ROWS[rowIndexOf(name)];
    let peakFrame = 0;
    let lowest = -Infinity;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const hand = solvedArm(posed(frame), row.view, 'right').end;
      if (hand.y > lowest) {
        lowest = hand.y;
        peakFrame = frame;
      }
    }
    if (peakFrame !== impact) {
      fail(
        'G13',
        `${name} drives its fist lowest on frame ${peakFrame}, but the shared timing puts the ` +
          `impact on frame ${impact} (progress ${JUICER_PUNCH_IMPACT_PROGRESS} of ` +
          `${JUICER_PUNCH_FRAMES} frames)`,
      );
    }
  }
}

/** How far ahead of the hips the shoulders must ride, edge-on, for a sprint. */
const SPRINT_MIN_SHOULDER_LEAD = 0.16;
/** How far below the idle's hips the sprinting hips must sit, head-on. */
const SPRINT_MIN_HIP_DROP = 0.04;

/**
 * G14 — the sprint actually leans.
 *
 * The whole read of the sprint is the shoulders driving out ahead of the hips.
 * A sprint row standing as upright as the walk is a Juicer jogging, and no
 * other gate can tell the difference. Edge-on that lean is a horizontal offset;
 * head-on there is no forward to travel in, so what has to be there instead is
 * the crouch — the hips sitting visibly lower than the idle's.
 */
function gateSprintLeadsWithTheShoulders(): void {
  const sprintRows = ['sprint', 'sprint_side', 'sprint_away'] as const;
  for (const name of sprintRows) {
    const posed = poseStreamOf(name, 'G14');
    if (posed === null) continue;
    const row = ROWS[rowIndexOf(name)];
    const idleName = name.replace('sprint', 'idle');
    const idlePosed = poseStreamOf(idleName, 'G14');
    if (idlePosed === null) continue;
    const idleRow = ROWS[rowIndexOf(idleName)];
    const idleHip = solvedHip(idlePosed(0), idleRow.view);

    for (let frame = 0; frame < row.frameCount; frame++) {
      const pose = posed(frame);
      const hip = solvedHip(pose, row.view);
      if (row.view === 'side') {
        const lead = solvedShoulderCentre(pose, row.view).x - hip.x;
        if (lead < SPRINT_MIN_SHOULDER_LEAD) {
          fail(
            'G14',
            `${name}[${frame}] carries its shoulders only ${lead.toFixed(3)} tile ahead of its ` +
              `hips (limit ${SPRINT_MIN_SHOULDER_LEAD}) — it is jogging, not sprinting`,
          );
        }
        continue;
      }
      const drop = hip.y - idleHip.y;
      if (drop < SPRINT_MIN_HIP_DROP) {
        fail(
          'G14',
          `${name}[${frame}] carries its hips only ${drop.toFixed(3)} tile below where ${idleName} ` +
            `does (limit ${SPRINT_MIN_HIP_DROP}) — head-on the crouch is the whole lean`,
        );
      }
    }
  }
}

/**
 * G15 — the runtime's gore-part list matches the bake, element for element.
 *
 * This one fails by dropping a body part on the floor and saying nothing,
 * because `BodyPartGoreSystem` skips a state it cannot find.
 */
const SPRITE_MODULE_PATH = 'src/sprites/juicerSprite.ts';

function gateGoreContract(): void {
  const source = readFileSync(resolve(SPRITE_MODULE_PATH), 'utf8');
  const declaration = /JUICER_GORE_PARTS[^=]*=\s*\[([^\]]*)\]/.exec(source);
  if (declaration === null) {
    fail('G15', `${SPRITE_MODULE_PATH} does not declare JUICER_GORE_PARTS`);
    return;
  }
  const runtimeParts = [...declaration[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  const baked = [...GORE_STATES];
  if (runtimeParts.length !== baked.length || runtimeParts.some((part, i) => part !== baked[i])) {
    fail(
      'G15',
      `${SPRITE_MODULE_PATH}'s JUICER_GORE_PARTS is [${runtimeParts.join(', ')}] but the bake ` +
        `produces [${baked.join(', ')}] — a state the runtime names and the sheet lacks is ` +
        `silently skipped`,
    );
  }
}

/**
 * How far the runtime's anchor table may sit from the rig, in tile fractions.
 *
 * A dumbbell is most of a third of a tile across, so a tenth of a tile of slop
 * is invisible and anything past it puts the weight outside the fist.
 */
const ANCHOR_TOLERANCE_TILES = 0.1;

function anchorDelta(a: TileFraction, b: TileFraction): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function formatAnchor(a: TileFraction): string {
  return `{ x: ${a.x.toFixed(3)}, y: ${a.y.toFixed(3)} }`;
}

const HAND_VIEWS: ReadonlyArray<JuicerHandView> = ['front', 'side', 'away'];

/**
 * G16 — the held-dumbbell anchors describe the rig that was actually baked.
 *
 * A generator cannot import the sprite module, so the numbers the runtime draws
 * with are a hand-maintained copy of a measurement. This gate is the only thing
 * standing between a redraw that moves the arm and a dumbbell that keeps
 * floating where the hand used to be.
 *
 * It is paired with a drift check: a single carry anchor is only meaningful if
 * no frame the dumbbell is carried through strays far from it.
 */
function gateHandAnchors(): void {
  const rigCarry = carryAnchors();
  const rigThrow = throwAnchors();
  for (const view of HAND_VIEWS) {
    const runtime = JUICER_CARRY_HAND_ANCHORS[view];
    const rig = rigCarry[view];
    const delta = anchorDelta(runtime, rig);
    if (delta > ANCHOR_TOLERANCE_TILES) {
      fail(
        'G16',
        `the ${view} carry anchor is ${formatAnchor(runtime)} but the rig grips at ` +
          `${formatAnchor(rig)} — ${delta.toFixed(3)} tile out (limit ${ANCHOR_TOLERANCE_TILES}); ` +
          `update JUICER_CARRY_HAND_ANCHORS`,
      );
    }
    const drift = worstCarryDrift(view);
    if (drift > CARRY_DRIFT_LIMIT_TILES) {
      fail(
        'G16',
        `the ${view} carry anchor is a mean the rig strays ${drift.toFixed(3)} tile from (limit ` +
          `${CARRY_DRIFT_LIMIT_TILES}) — one point cannot describe that arm; damp the walk swing`,
      );
    }

    const runtimeThrow = JUICER_THROW_HAND_ANCHORS[view];
    const rigThrowFrames = rigThrow[view];
    if (runtimeThrow.length !== rigThrowFrames.length) {
      fail(
        'G16',
        `the ${view} throw anchor table has ${runtimeThrow.length} frames but the throw row bakes ` +
          `${rigThrowFrames.length}`,
      );
      continue;
    }
    rigThrowFrames.forEach((rigFrame, frame) => {
      const gap = anchorDelta(runtimeThrow[frame], rigFrame);
      if (gap > ANCHOR_TOLERANCE_TILES) {
        fail(
          'G16',
          `the ${view} throw anchor for frame ${frame} is ${formatAnchor(runtimeThrow[frame])} ` +
            `but the rig grips at ${formatAnchor(rigFrame)} — ${gap.toFixed(3)} tile out ` +
            `(limit ${ANCHOR_TOLERANCE_TILES}); update JUICER_THROW_HAND_ANCHORS`,
        );
      }
    });
  }
}

/** Prints the anchor tables the rig measures, so a failed G16 can be pasted. */
function printAnchors(): void {
  const carry = carryAnchors();
  const throws = throwAnchors();
  console.log('  measured carry anchors:');
  for (const view of HAND_VIEWS) console.log(`    ${view}: ${formatAnchor(carry[view])}`);
  console.log('  measured throw anchors:');
  for (const view of HAND_VIEWS) {
    console.log(`    ${view}: [${throws[view].map(formatAnchor).join(', ')}]`);
  }
}

/** G17 — the manifest describes the sheet the bake actually produced. */
function gateManifest(sheet: BakedSheet): void {
  const mismatch = manifestMismatch(sheet);
  if (mismatch === null) {
    console.log('  G17 manifest: in sync');
    return;
  }
  if (SKIP_MANIFEST_GATE) {
    console.warn(`  G17 SKIPPED — paste this and re-run without the flag:\n${mismatch}`);
    return;
  }
  fail('G17', mismatch);
}

async function runGates(): Promise<BakedSheet> {
  console.log('Gating the juicer bake…');
  const sheet = bake();
  const grid = gridOf(await decode(sheet));

  gateBorderClip(grid, sheet);
  gateAnchor(grid, sheet);
  gateLoopClosure(grid, sheet);
  gateMotionContinuity(grid, sheet);
  gateCentroidDrift(grid, sheet);
  gateOneShotSettle(grid, sheet);
  gateGoreLegibility(grid, sheet);
  gateGoreDistinctness(grid, sheet);
  gateTextureSize(sheet);
  gateFootSlide();
  gateLegReach();
  gateArmReach();
  gateImpactIsThePeak();
  gateSprintLeadsWithTheShoulders();
  gateGoreContract();
  gateHandAnchors();
  gateManifest(sheet);
  printAnchors();

  if (failures.length > 0) {
    throw new Error(
      `${failures.length} gate${failures.length === 1 ? '' : 's'} failed; nothing was written:\n  ` +
        failures.join('\n  '),
    );
  }
  console.log('  all gates passed');
  return sheet;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  // The gated sheet is the one written. Baking a second time to write would
  // put bytes on disk that nothing measured, and the whole contract of this
  // module is that a sheet which failed a gate never reaches the filesystem.
  runGates()
    .then((sheet) => {
      writeSheet(sheet);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}

export { runGates };
