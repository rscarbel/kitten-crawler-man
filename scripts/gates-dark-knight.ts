/**
 * The Dark Knight's art gates.
 *
 * The creature has no baked sheet to inspect any more, so every invariant the
 * old bake enforced by throwing before it wrote a PNG is enforced here instead:
 * the pose-stream gates measure the rig itself, and the pixel gates measure
 * cells painted from `DARK_KNIGHT_FIGURE` exactly the way the runtime cache
 * bakes them — supersampled and downsampled — so what is measured is what the
 * game blits.
 *
 * Failures accumulate rather than throwing one at a time, so one run reports
 * everything that is wrong. A gate that cannot find the row or state it names
 * fails loudly, and so does one whose filtered loop examined nothing: a lookup
 * that quietly returns nothing turns a whole gate module green while measuring
 * nothing at all.
 *
 * Run by the review harness: `npm run render:dark-knight`.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createCanvas } from 'canvas';

import { bakeFigureCell } from './figureSheet.js';
import {
  distinctFrameFailures as sharedDistinctFrameFailures,
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
} from './figureGates.js';
import { asGameContext } from './nodeGameContext.js';
import {
  ARM_LENGTH,
  FIGURE_HEIGHT,
  LEG_REACH_LIMIT,
  type KnightPose,
  type Pt,
  legReach,
  macePosition,
} from '../src/sprites/art/darkKnightArt.js';
import { darkKnightGorePieces } from '../src/sprites/art/darkKnightGore.js';
import {
  DARK_KNIGHT_FIGURE,
  DARK_KNIGHT_ROWS,
  GORE_RECENTRE,
  GORE_STATES,
  GORE_UNIT,
  KNIGHT_SCALE,
  POSE_ORIGIN_Y,
  SLAM_IMPACT_FRAME,
  STANCE_SHARE,
  SWEEP_FIRST_LEVEL_FRAME,
  SWEEP_IMPACT_FRAME,
  PUNCH_IMPACT_FRAME,
  TILE_SCALE,
  WALK_FRAMES,
  type RowSpec,
  cyclePhase,
  isDeclaredTipSpike,
} from '../src/sprites/art/darkKnightFigure.js';

const INK_ALPHA_THRESHOLD = 24;
const CHANNELS = 4;
const ALPHA_OFFSET = 3;

const { frameWidth, frameHeight } = DARK_KNIGHT_FIGURE;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

/**
 * Fails a gate whose filtered loop ran zero times.
 *
 * Most gates below narrow before they measure — stance frames only, slam rows
 * only, one entry per painted piece — and a narrowing that matches nothing
 * leaves a green gate that examined nothing. Every filtering loop here counts
 * what it looked at and ends with a call to this.
 */
function failUnlessMeasured(gateId: string, measured: number, what: string): void {
  for (const failure of nothingMeasuredFailures(measured, what)) fail(gateId, failure);
}

function rowNamed(name: string, gateId: string): RowSpec | null {
  const row = DARK_KNIGHT_ROWS.find((candidate) => candidate.name === name);
  if (row === undefined) {
    fail(gateId, `there is no row named "${name}" to measure`);
    return null;
  }
  return row;
}

// ── Painted-cell helpers ─────────────────────────────────────────────────────

const alphaByCell = new Map<string, Uint8ClampedArray>();

/** One cell's alpha channel, baked as the runtime cache bakes it. */
function cellAlpha(state: string, frame: number): Uint8ClampedArray {
  const key = `${state}[${frame}]`;
  const cached = alphaByCell.get(key);
  if (cached !== undefined) return cached;
  const cell = bakeFigureCell(DARK_KNIGHT_FIGURE, state, frame);
  const { data } = cell.getContext('2d').getImageData(0, 0, frameWidth, frameHeight);
  const alpha = new Uint8ClampedArray(frameWidth * frameHeight);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * CHANNELS + ALPHA_OFFSET];
  alphaByCell.set(key, alpha);
  return alpha;
}

const rgbaByCell = new Map<string, Uint8ClampedArray>();

/** One cell's full RGBA, baked as the runtime cache bakes it. */
function cellRgba(state: string, frame: number): Uint8ClampedArray {
  const key = `${state}[${frame}]`;
  const cached = rgbaByCell.get(key);
  if (cached !== undefined) return cached;
  const cell = bakeFigureCell(DARK_KNIGHT_FIGURE, state, frame);
  const { data } = cell.getContext('2d').getImageData(0, 0, frameWidth, frameHeight);
  rgbaByCell.set(key, data);
  return data;
}

interface InkStats {
  readonly count: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

const EMPTY_INK: InkStats = { count: 0, minX: 0, maxX: 0, minY: 0, maxY: 0 };

function inkStatsOf(alpha: Uint8ClampedArray, threshold = INK_ALPHA_THRESHOLD): InkStats {
  let count = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < frameHeight; y++) {
    for (let x = 0; x < frameWidth; x++) {
      if (alpha[y * frameWidth + x] < threshold) continue;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (count === 0) return EMPTY_INK;
  return { count, minX, maxX, minY, maxY };
}

/** Count of pixels whose coverage differs between two frames. */
function coverageDelta(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let differing = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] >= INK_ALPHA_THRESHOLD !== b[i] >= INK_ALPHA_THRESHOLD) differing++;
  }
  return differing;
}

// ── G1 structure ─────────────────────────────────────────────────────────────

/**
 * G1 — the shared structural gates: every declared state paints every declared
 * frame, nothing paints against the cell edge, and the cell is not mostly
 * empty. The gore states are exempt from the fill check: a severed gauntlet is
 * meant to be small inside a cell sized for a 2.28-tile knight.
 */
function gateStructure(): void {
  for (const failure of figureStructuralFailures(DARK_KNIGHT_FIGURE, {
    sparseStates: GORE_STATES,
  })) {
    fail('G1', failure);
  }
}

// ── G2 anchor ────────────────────────────────────────────────────────────────

/**
 * Alpha above which a pixel is the figure himself rather than the soft contact
 * shadow he stands in. Measuring the anchor against ordinary ink measures the
 * shadow's rim, which is painted at the ground line whatever the feet do — so
 * the check would pass a knight hovering a quarter tile above the floor.
 */
const SOLID_ALPHA_THRESHOLD = 200;

/**
 * How far the lowest solid ink may sit from the ground line, in cell pixels.
 * Not zero: the sole's own bottom rank of pixels is antialiased down out of the
 * solid band, so the boot reads a few pixels short of where it stands.
 */
const ANCHOR_TOLERANCE_PX = 5;
const HEIGHT_TOLERANCE_TILES = 0.14;

/**
 * How far above the tile's own floor the soles may stand, in tiles.
 *
 * This is the half of the anchor that is not self-referential. `POSE_ORIGIN_Y`
 * is the origin the painter itself translates to, so a check against it moves
 * with the art and passes for any ground offset; the tile box is what the
 * runtime hangs a health bar, a status marker and every telegraph off, so it is
 * the thing that has to stay true. The knight stands a tenth of a tile up the
 * cell by design — a perspective offset — and reads 10px, 0.16 tiles, above the
 * floor once the sole's bottom rank antialiases out of the solid band. The
 * limit admits that and catches a drift of another tenth of a tile.
 */
const MAX_FLOAT_ABOVE_TILE_FLOOR_TILES = 0.25;
/**
 * And how far below it he may sink. The soles sit above the floor by design, so
 * anything below it is the figure dropping through the tile he stands on; the
 * couple of pixels are the antialiased rim of the boot.
 */
const MAX_SINK_BELOW_TILE_FLOOR_PX = 2;

/**
 * G2 — the knight's feet land on the tile's ground line and he stands as tall
 * as his proportions claim.
 *
 * Every health bar, status marker and telegraph keys off `tileY`, and a redraw
 * that moves the anchor moves all of them with no other gate noticing.
 */
function gateAnchor(): void {
  const row = rowNamed('idle', 'G2');
  if (row === null) return;
  const stats = inkStatsOf(cellAlpha(row.name, 0), SOLID_ALPHA_THRESHOLD);
  if (stats.count === 0) {
    fail('G2', 'idle[0] painted no solid ink at all');
    return;
  }
  const tileFloorY = DARK_KNIGHT_FIGURE.tileY + TILE_SCALE;
  const floatTiles = (tileFloorY - stats.maxY) / TILE_SCALE;
  if (floatTiles > MAX_FLOAT_ABOVE_TILE_FLOOR_TILES) {
    fail(
      'G2',
      `the lowest solid ink stands ${floatTiles.toFixed(3)} tiles above the tile floor at ` +
        `y=${tileFloorY}, past ${MAX_FLOAT_ABOVE_TILE_FLOOR_TILES} — the knight hovers over the ` +
        'tile the game aims at',
    );
  }
  if (stats.maxY - tileFloorY > MAX_SINK_BELOW_TILE_FLOOR_PX) {
    fail(
      'G2',
      `the lowest solid ink sits ${stats.maxY - tileFloorY}px below the tile floor at ` +
        `y=${tileFloorY} — the knight is sunk into the tile he stands on`,
    );
  }
  // Against the painter's own origin this can only catch the art drifting off
  // its own anchor: `POSE_ORIGIN_Y` moves the ink and the expectation together.
  const soleDrop = stats.maxY - POSE_ORIGIN_Y;
  if (Math.abs(soleDrop) > ANCHOR_TOLERANCE_PX) {
    fail(
      'G2',
      `the lowest solid ink sits ${soleDrop.toFixed(1)}px off the ground line at ` +
        `y=${POSE_ORIGIN_Y}, past a ${ANCHOR_TOLERANCE_PX}px tolerance`,
    );
  }
  const heightTiles = (stats.maxY - stats.minY) / TILE_SCALE;
  const expected = FIGURE_HEIGHT * KNIGHT_SCALE;
  if (Math.abs(heightTiles - expected) > HEIGHT_TOLERANCE_TILES) {
    fail(
      'G2',
      `he stands ${heightTiles.toFixed(2)} tiles against an expected ${expected.toFixed(2)} — ` +
        'the proportions and the painter disagree',
    );
  }
  console.log(
    `  G2 anchor: soles ${soleDrop.toFixed(1)}px off the line and ` +
      `${floatTiles.toFixed(3)} tiles above the tile floor, standing ` +
      `${heightTiles.toFixed(2)} tiles`,
  );
}

// ── G3 loop closure ──────────────────────────────────────────────────────────

/**
 * How much larger than the *largest ordinary step* in its own row a loop's seam
 * may be.
 *
 * Measured against the largest rather than the median because a cycle driven by
 * a sine samples unevenly — its own steps already vary two-fold — and a
 * median-based limit fails an honest loop while a limit loose enough to pass it
 * stops catching pops. Re-derived from the shipped rows, which wrap at 1.01×
 * (walk), 0.99× (walk_away), 0.72× (walk_side) and 0.94–1.00× (the three idles)
 * their largest ordinary step; the ceiling sits 14% above the worst of those.
 */
const LOOP_SEAM_LIMIT = 1.15;
/**
 * How far *short* of its row's median step the seam may fall.
 *
 * A ceiling alone is passed by the one mutation that beats every loop gate:
 * sampling at `frame / (frameCount - 1)` makes the last frame identical to the
 * first, so the seam goes to zero while the row holds still for a whole frame
 * every lap. Against the median rather than the narrowest step, because a row
 * may legitimately hold two adjacent frames still, which would collapse the
 * floor into `seam >= 0`. The shipped rows wrap at 1.12× to 2.32× their median
 * step, so a floor at 0.5 clears the worst of them twice over.
 */
const LOOP_SEAM_FLOOR_VS_MEDIAN = 0.5;
/** Floating-point slack on a phase span that has to be exactly one turn. */
const PHASE_EPSILON = 1e-9;
const ONE_TURN = 1;

function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * The ceiling in the units the defect is actually in: a loop row's phase
 * mapping has to spend exactly one turn over its declared frames, in equal
 * steps, so the frame after the last lands on the first.
 *
 * The pixels cannot say this. A gait's pose distance saturates — half a cycle
 * apart is about as different as two frames can be — so a row running one and a
 * half turns wraps by roughly what it steps and reads as an ordinary loop at
 * any pixel threshold. Asserted on `cyclePhase`, which is what every loop row's
 * pose is sampled through.
 */
function gatePhaseCoverage(row: RowSpec): void {
  const turns = cyclePhase(row.frameCount, row.frameCount) - cyclePhase(0, row.frameCount);
  if (Math.abs(turns - ONE_TURN) > PHASE_EPSILON) {
    fail(
      'G3',
      `${row.name} spends ${turns.toFixed(4)} of a turn over its ${row.frameCount} frames rather ` +
        'than exactly one, so the frame after the last does not land on the first',
    );
  }
  const firstStep = cyclePhase(1, row.frameCount) - cyclePhase(0, row.frameCount);
  let stepsMeasured = 0;
  for (let frame = 1; frame < row.frameCount; frame++) {
    stepsMeasured++;
    const step = cyclePhase(frame, row.frameCount) - cyclePhase(frame - 1, row.frameCount);
    if (Math.abs(step - firstStep) <= PHASE_EPSILON) continue;
    fail(
      'G3',
      `${row.name} advances ${step.toFixed(4)} of a turn into frame ${frame} against ` +
        `${firstStep.toFixed(4)} at the start of the row; an unevenly sampled loop stutters`,
    );
  }
  failUnlessMeasured('G3', stepsMeasured, `phase steps of ${row.name}`);
}

/** G3 — a cycle must cover one turn, and must neither pop nor stall at its seam. */
function gateLoopClosure(): void {
  let rowsMeasured = 0;
  for (const row of DARK_KNIGHT_ROWS) {
    if (row.kind !== 'loop') continue;
    rowsMeasured++;
    gatePhaseCoverage(row);
    const deltas: number[] = [];
    for (let frame = 0; frame < row.frameCount; frame++) {
      deltas.push(
        coverageDelta(
          cellAlpha(row.name, frame),
          cellAlpha(row.name, (frame + 1) % row.frameCount),
        ),
      );
    }
    const seam = deltas[deltas.length - 1];
    const ordinary = deltas.slice(0, -1);
    const largestOrdinary = Math.max(...ordinary);
    const typicalOrdinary = medianOf(ordinary);
    if (largestOrdinary <= 0) {
      fail('G3', `${row.name} does not move between frames at all`);
      continue;
    }
    console.log(
      `  G3 ${row.name}: seam ${(seam / largestOrdinary).toFixed(2)}× the largest ordinary step, ` +
        `${(seam / typicalOrdinary).toFixed(2)}× the median`,
    );
    if (seam > largestOrdinary * LOOP_SEAM_LIMIT) {
      fail(
        'G3',
        `${row.name}'s seam moves ${seam} pixels against a largest ordinary step of ` +
          `${largestOrdinary} — the cycle pops once per lap`,
      );
    }
    if (typicalOrdinary > 0 && seam < typicalOrdinary * LOOP_SEAM_FLOOR_VS_MEDIAN) {
      fail(
        'G3',
        `${row.name}'s seam moves ${seam} pixels against a median ordinary step of ` +
          `${typicalOrdinary} — the last frame repeats the first and the cycle holds still for a ` +
          'whole frame every lap',
      );
    }
  }
  failUnlessMeasured('G3', rowsMeasured, 'looping rows');
}

// ── Pose-stream gates ────────────────────────────────────────────────────────

function poseStream(): Array<{ row: RowSpec; frame: number; pose: KnightPose }> {
  const stream: Array<{ row: RowSpec; frame: number; pose: KnightPose }> = [];
  for (const row of DARK_KNIGHT_ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      stream.push({ row, frame, pose: row.pose(frame) });
    }
  }
  return stream;
}

/**
 * G4 — reach headroom. Hip→ankle must stay inside the leg's own span on every
 * frame of every row. One clamped frame locks the leg straight and the next
 * tuck snaps it back: the hitch that reads as a hop, and the single defect a
 * contact sheet is worst at showing.
 */
function gateLegReach(): void {
  let worst = 0;
  let worstAt = '';
  let spansMeasured = 0;
  for (const { row, frame, pose } of poseStream()) {
    const { left, right } = legReach(pose, row.view);
    for (const [side, span] of [
      ['left', left],
      ['right', right],
    ] as const) {
      spansMeasured++;
      if (span <= worst) continue;
      worst = span;
      worstAt = `${row.name}[${frame}] ${side}`;
    }
  }
  failUnlessMeasured('G4', spansMeasured, 'leg spans');
  if (spansMeasured === 0) return;
  if (worst >= LEG_REACH_LIMIT) {
    fail(
      'G4',
      `${worstAt} spans ${worst.toFixed(4)} against a limit of ${LEG_REACH_LIMIT.toFixed(4)} — ` +
        'the solver clamps and the walk hops',
    );
  }
  console.log(
    `  G4 leg reach: worst ${worst.toFixed(4)} of ${LEG_REACH_LIMIT.toFixed(4)} (${worstAt})`,
  );
}

/**
 * G5 — foot slide. The profile walk's planted foot must travel backward at a
 * steady rate through stance; a foot that stalls or reverses is a moonwalk.
 */
function gateFootSlide(): void {
  const row = rowNamed('walk_side', 'G5');
  if (row === null) return;
  const planted: number[] = [];
  for (let frame = 0; frame < row.frameCount; frame++) {
    if (cyclePhase(frame, WALK_FRAMES) >= STANCE_SHARE) break;
    planted.push(row.pose(frame).rightFoot.x);
  }
  failUnlessMeasured('G5', Math.max(0, planted.length - 1), 'stance-to-stance steps');
  for (let i = 1; i < planted.length; i++) {
    if (planted[i] < planted[i - 1]) continue;
    fail(
      'G5',
      `the stance foot moves from ${planted[i - 1].toFixed(4)} to ${planted[i].toFixed(4)} ` +
        `between frames ${i - 1} and ${i} — it must slide backward`,
    );
  }
}

/** How much of his own arm's length the off fist may sit from the haft. */
const OFF_GRIP_REACH_SHARE = 0.9;

/**
 * G6 — off-hand grip. On the slam both fists are on the haft, so the off fist
 * must stay within its own arm's reach of the mace hand. A two-handed off hand
 * painting in mid-air is identical on every frame, and therefore invisible to
 * every ratio and continuity gate there is.
 */
function gateOffHandGrip(): void {
  let worst = 0;
  let worstAt = '';
  let framesMeasured = 0;
  for (const row of DARK_KNIGHT_ROWS) {
    if (!row.name.startsWith('slam')) continue;
    // Only up to the blow. Past it the knight is recovering into his one-handed
    // guard, and the off hand is *supposed* to leave the haft.
    for (let frame = 0; frame <= SLAM_IMPACT_FRAME; frame++) {
      const pose = row.pose(frame);
      framesMeasured++;
      const gap = Math.hypot(
        pose.leftHand.x - pose.rightHand.x,
        pose.leftHand.y - pose.rightHand.y,
      );
      if (gap <= worst) continue;
      worst = gap;
      worstAt = `${row.name}[${frame}]`;
    }
  }
  failUnlessMeasured('G6', framesMeasured, 'two-handed slam frames');
  if (framesMeasured === 0) return;
  const limit = ARM_LENGTH * OFF_GRIP_REACH_SHARE;
  if (worst > limit) {
    fail(
      'G6',
      `${worstAt} puts the off fist ${worst.toFixed(4)} from the haft against a reach of ` +
        `${limit.toFixed(4)} — it is painting in mid-air`,
    );
  }
  console.log(`  G6 off-hand grip: worst gap ${worst.toFixed(4)} of ${limit.toFixed(4)}`);
}

const TIP_STEP_SPIKE_LIMIT = 2.6;
/**
 * Below this the "spike" is smaller than a pixel on a painted cell. Without an
 * absolute floor a row where the mace is essentially still — the punch, which
 * only carries it — fails on a tenth-of-a-pixel step being eight times a
 * hundredth-of-a-pixel median.
 */
const MIN_MEANINGFUL_TIP_STEP = 0.05;

/**
 * G7 — mace-tip continuity. The head must trace a smooth arc: a step far above
 * the row's own median is a cornered swing or a draw-order flip, both of which
 * a still frame hides completely.
 */
function gateMaceArc(): void {
  let rowsMeasured = 0;
  for (const row of DARK_KNIGHT_ROWS) {
    const tips: Pt[] = [];
    for (let frame = 0; frame < row.frameCount; frame++) {
      tips.push(macePosition(row.pose(frame), row.view));
    }
    const steps: number[] = [];
    for (let i = 1; i < tips.length; i++) {
      steps.push(Math.hypot(tips[i].x - tips[i - 1].x, tips[i].y - tips[i - 1].y));
    }
    if (steps.length === 0) {
      fail('G7', `${row.name} paints too few frames to trace the mace through`);
      continue;
    }
    const sorted = [...steps].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    // A row whose mace does not move at all in half its frames has no arc to be
    // smooth. Skipping it silently would drop it before it was counted, leaving
    // the gate reporting rows examined while measuring none of them, so it fails
    // instead. The shipped rows move a median of 0.0017 (idle) to 0.04 (walk),
    // both of which are a real arc and neither of which the ratio test judges
    // without `MIN_MEANINGFUL_TIP_STEP` also being cleared.
    if (median <= 0) {
      fail(
        'G7',
        `${row.name} does not move its mace tip at all in half its frames — there is no arc ` +
          'left to judge the smoothness of',
      );
      continue;
    }
    rowsMeasured++;
    let worst = 0;
    let at = 0;
    steps.forEach((step, index) => {
      // The slam's strike is the one step in the fleet that is *meant* to be a
      // spike; measured against the row's own median it would either fail every
      // honest slam or, loosened enough to pass, stop catching cornered swings.
      if (isDeclaredTipSpike(row.name, index)) return;
      if (step <= worst) return;
      worst = step;
      at = index;
    });
    if (worst > MIN_MEANINGFUL_TIP_STEP && worst > median * TIP_STEP_SPIKE_LIMIT) {
      fail(
        'G7',
        `${row.name} steps ${worst.toFixed(4)} between frames ${at} and ${at + 1} against a ` +
          `median of ${median.toFixed(4)} — the swing corners`,
      );
    }
  }
  failUnlessMeasured('G7', rowsMeasured, 'rows whose mace moves at all');
}

/**
 * G8 — the slam owns the low ground.
 *
 * Burying the mace is the slam's signature and the thing its warning circle
 * promises; another row that takes the head as low steals the read, and a
 * player who has learnt "head at the floor means step out of the circle" is
 * then punished for a sweep. Stated as an ordering rather than as a height,
 * because the ordering is the design statement and a height is a measurement
 * that goes stale the next time somebody lengthens the haft.
 *
 * Nothing here is an absolute floor check: the head hangs off an arm hanging
 * off a shoulder, so the rig cannot put it near the ground at all without a
 * change to the proportions — an absolute limit would be a rule no mutation of
 * the choreography could ever break.
 */
function gateMaceFloor(): void {
  let lowestSlam = -Infinity;
  let lowestOther = -Infinity;
  let lowestOtherAt = '';
  let slamFramesMeasured = 0;
  let otherFramesMeasured = 0;
  for (const row of DARK_KNIGHT_ROWS) {
    const isSlam = row.name.startsWith('slam');
    for (let frame = 0; frame < row.frameCount; frame++) {
      const { y } = macePosition(row.pose(frame), row.view);
      if (isSlam) {
        slamFramesMeasured++;
        lowestSlam = Math.max(lowestSlam, y);
        continue;
      }
      otherFramesMeasured++;
      if (y <= lowestOther) continue;
      lowestOther = y;
      lowestOtherAt = `${row.name}[${frame}]`;
    }
  }
  failUnlessMeasured('G8', slamFramesMeasured, 'slam frames');
  failUnlessMeasured('G8', otherFramesMeasured, 'non-slam frames');
  if (slamFramesMeasured === 0 || otherFramesMeasured === 0) return;
  if (lowestOther >= lowestSlam) {
    fail(
      'G8',
      `${lowestOtherAt} takes the mace head to ${lowestOther.toFixed(3)}, at or below the ` +
        `${lowestSlam.toFixed(3)} the slam itself reaches — the slam no longer owns the low ground`,
    );
  }
  console.log(
    `  G8 mace floor: the slam reaches ${lowestSlam.toFixed(3)}, the lowest other row ` +
      `${lowestOther.toFixed(3)} (${lowestOtherAt})`,
  );
}

interface ImpactCheck {
  readonly rowName: string;
  readonly impactFrame: number;
  /** What the row's motion is measured by; the impact frame must maximise it. */
  readonly metric: (pose: KnightPose) => number;
  /**
   * First frame the metric is meaningful on. The sweep spends its first half
   * whirling the mace above the helm, where "how far out is the head" answers a
   * question about the wind-up rather than about the blow.
   */
  readonly fromFrame: number;
}

const IMPACT_CHECKS: readonly ImpactCheck[] = [
  {
    rowName: 'slam_side',
    impactFrame: SLAM_IMPACT_FRAME,
    metric: (pose) => macePosition(pose, 'side').y,
    fromFrame: 0,
  },
  {
    rowName: 'sweep_side',
    impactFrame: SWEEP_IMPACT_FRAME,
    metric: (pose) => Math.abs(macePosition(pose, 'side').x),
    fromFrame: SWEEP_FIRST_LEVEL_FRAME,
  },
  {
    rowName: 'punch_side',
    impactFrame: PUNCH_IMPACT_FRAME,
    metric: (pose) => pose.leftHand.x,
    fromFrame: 0,
  },
];

/**
 * How far short of its row's extreme a declared impact frame may sit. Not zero:
 * a one-shot samples the *middle* of each frame, so the true extreme falls
 * between two of them and no frame lands exactly on it.
 */
const IMPACT_PEAK_TOLERANCE = 0.08;
/**
 * How little a strike may move its own metric across its window before the row
 * counts as having no peak at all, in figure units. The shipped strikes move
 * whole tenths of a tile; anything under a thousandth is a metric that has
 * stopped varying, which a shortfall ratio can only answer with a division by
 * zero.
 */
const MIN_MEANINGFUL_IMPACT_SPAN = 0.001;

/**
 * G9 — impact is the peak. The declared impact frame must be the extreme of its
 * own motion, or the creature's timing table has drifted from the choreography
 * and the damage lands on a frame where nothing is happening.
 */
function gateImpactIsThePeak(): void {
  let checksRun = 0;
  for (const check of IMPACT_CHECKS) {
    const row = rowNamed(check.rowName, 'G9');
    if (row === null) continue;
    if (check.impactFrame < check.fromFrame) {
      fail(
        'G9',
        `${check.rowName} declares impact on frame ${check.impactFrame}, before its measurable ` +
          `window opens at ${check.fromFrame}`,
      );
      continue;
    }
    if (check.impactFrame >= row.frameCount) {
      fail(
        'G9',
        `${check.rowName} declares impact on frame ${check.impactFrame}, past the ` +
          `${row.frameCount} frames it paints`,
      );
      continue;
    }
    checksRun++;
    const values: number[] = [];
    for (let frame = check.fromFrame; frame < row.frameCount; frame++) {
      values.push(check.metric(row.pose(frame)));
    }
    const peak = Math.max(...values);
    const span = peak - Math.min(...values);
    // A motionless metric is the flattened choreography this gate exists to
    // catch, so it fails here rather than dividing by zero and reporting no
    // shortfall at all.
    if (span <= MIN_MEANINGFUL_IMPACT_SPAN) {
      fail(
        'G9',
        `${check.rowName} moves its impact metric by ${span.toFixed(4)} over the whole window — ` +
          'the strike has been flattened and no frame is a peak',
      );
      continue;
    }
    const shortfall = (peak - values[check.impactFrame - check.fromFrame]) / span;
    if (shortfall > IMPACT_PEAK_TOLERANCE) {
      fail(
        'G9',
        `${check.rowName} frame ${check.impactFrame} sits ${(shortfall * 100).toFixed(0)}% short ` +
          "of the row's own extreme — the timing table and the choreography disagree",
      );
    }
  }
  failUnlessMeasured('G9', checksRun, 'declared impact frames');
}

// ── Gore gates ───────────────────────────────────────────────────────────────

const DISTINCT_MASK = 16;
/**
 * How much of their combined silhouette two gore pieces may share.
 *
 * Re-derived from the shipped art rather than inherited. Measured over five
 * converted gore sets — the knight's seven pieces, the Juicer's eight, the
 * Hoarder's six and the Krakaren's seven and four, 91 pairs in all — the worst
 * honest pair anywhere is the Juicer's head against his thigh at 63%, and the
 * knight's own worst is his helm against his breastplate at 61%. Two pieces
 * that genuinely read as one picture score 100%: the mask is normalised to each
 * piece's own bounding box, so a duplicate is a duplicate whatever size it is
 * painted at.
 *
 * At the 62% it shipped with, the band between the healthiest art in the game
 * and a failure was a single point wide, and the knight sat one point inside
 * it — one redraw of a pauldron away from a red gate that meant nothing. 80%
 * sits roughly halfway between the worst honest pair and an outright copy,
 * which leaves seventeen points of headroom for honest art and still fails
 * anything a player would read as the same piece twice.
 */
const DISTINCT_IOU_LIMIT = 0.8;

function maskOf(state: string): boolean[] {
  const alpha = cellAlpha(state, 0);
  const stats = inkStatsOf(alpha);
  // Scale is normalised away but aspect deliberately is not: stretching each
  // piece to fill its own bounding box maps every convex blob onto a filled
  // square and measures the normalisation rather than the art.
  const span = Math.max(stats.maxX - stats.minX, stats.maxY - stats.minY, 1);
  const centreX = (stats.minX + stats.maxX) / 2;
  const centreY = (stats.minY + stats.maxY) / 2;
  const mask: boolean[] = [];
  for (let y = 0; y < DISTINCT_MASK; y++) {
    for (let x = 0; x < DISTINCT_MASK; x++) {
      const sourceX = Math.round(centreX + ((x + 0.5) / DISTINCT_MASK - 0.5) * span);
      const sourceY = Math.round(centreY + ((y + 0.5) / DISTINCT_MASK - 0.5) * span);
      const inside = sourceX >= 0 && sourceY >= 0 && sourceX < frameWidth && sourceY < frameHeight;
      mask.push(inside && alpha[sourceY * frameWidth + sourceX] >= INK_ALPHA_THRESHOLD);
    }
  }
  return mask;
}

/**
 * G10 — no two gore pieces may share a silhouette. Seven cells tumbling past at
 * 16 px must not read as seven identical grey blobs.
 */
function gateGoreDistinctness(): void {
  const masks = GORE_STATES.map((state) => ({ state, mask: maskOf(state) }));
  let worst = 0;
  let worstPair = '';
  let pairsCompared = 0;
  for (let a = 0; a < masks.length; a++) {
    for (let b = a + 1; b < masks.length; b++) {
      pairsCompared++;
      let intersection = 0;
      let union = 0;
      for (let i = 0; i < masks[a].mask.length; i++) {
        if (masks[a].mask[i] && masks[b].mask[i]) intersection++;
        if (masks[a].mask[i] || masks[b].mask[i]) union++;
      }
      const iou = union === 0 ? 0 : intersection / union;
      if (iou <= worst) continue;
      worst = iou;
      worstPair = `${masks[a].state} vs ${masks[b].state}`;
    }
  }
  failUnlessMeasured('G10', pairsCompared, 'pairs of gore pieces');
  if (pairsCompared === 0) return;
  if (worst > DISTINCT_IOU_LIMIT) {
    fail(
      'G10',
      `${worstPair} overlap ${(worst * 100).toFixed(0)}% against a ` +
        `${(DISTINCT_IOU_LIMIT * 100).toFixed(0)}% limit — they read as the same piece`,
    );
  }
  console.log(
    `  G10 gore distinctness: worst pair ${worstPair} at ${(worst * 100).toFixed(0)}% of ` +
      `${(DISTINCT_IOU_LIMIT * 100).toFixed(0)}%`,
  );
}

/** Clear pixels kept between a spinning piece's furthest ink and the cell edge. */
const GORE_ROTATION_PADDING_PX = 6;

/**
 * G11 — a gore piece fits its cell however it is turned.
 *
 * `BodyPartGoreSystem` spins a piece about the centre of its own ink, so what
 * has to fit is the *inscribed* circle of the cell rather than the cell's box:
 * a piece wide enough but not tall enough is clipped a quarter turn later. The
 * bake used to size the cell around this; the cell is frozen now, so the same
 * invariant becomes a check on the pieces.
 */
function gateGoreRotationClearance(): void {
  const clearance = Math.min(frameWidth, frameHeight) / 2 - GORE_ROTATION_PADDING_PX;
  let worst = 0;
  let worstPiece = '';
  let piecesMeasured = 0;
  for (const state of GORE_STATES) {
    const stats = inkStatsOf(cellAlpha(state, 0));
    if (stats.count === 0) {
      fail('G11', `${state} painted nothing at all`);
      continue;
    }
    piecesMeasured++;
    const radius = Math.hypot((stats.maxX - stats.minX) / 2, (stats.maxY - stats.minY) / 2);
    if (radius <= worst) continue;
    worst = radius;
    worstPiece = state;
  }
  failUnlessMeasured('G11', piecesMeasured, 'gore pieces');
  if (piecesMeasured === 0) return;
  if (worst > clearance) {
    fail(
      'G11',
      `${worstPiece} sweeps a radius of ${worst.toFixed(1)}px against a ${clearance.toFixed(1)}px ` +
        'inscribed clearance — it is clipped partway through its own tumble',
    );
  }
  console.log(
    `  G11 gore rotation: widest sweep ${worstPiece} at ${worst.toFixed(1)}px of ` +
      `${clearance.toFixed(1)}px`,
  );
}

// ── G12 warm-row budget ──────────────────────────────────────────────────────

const BYTES_PER_PIXEL = 4;
const BYTES_PER_MEGABYTE = 1024 * 1024;

/**
 * The hard ceiling for one warm animation row.
 *
 * The sheet this figure replaced had a whole-texture budget. A painted figure
 * is admitted to the cache a row at a time, so the number that decides whether
 * it fits is the widest row's warm bytes rather than the sum of all of them —
 * and it has to stay well inside the cache's own per-figure ceiling so that the
 * three views of an attack, which are prewarmed together, are warm at once.
 */
const ROW_BUDGET_MEGABYTES = 3;

/**
 * G12 — the widest warm row's memory, reported whether or not it passes.
 *
 * Measured over every state the figure declares rather than over the pose rows
 * alone: the cache does not know a gore piece from a walk cycle, and a gore
 * state that grew frames would otherwise be memory nothing accounts for.
 */
function gateWarmRowSize(): void {
  const cellBytes = frameWidth * frameHeight * BYTES_PER_PIXEL;
  let widestState = '';
  let widestFrames = 0;
  let statesMeasured = 0;
  let totalFrames = 0;
  for (const [state, declared] of DARK_KNIGHT_FIGURE.states) {
    statesMeasured++;
    totalFrames += declared.frames;
    if (declared.frames <= widestFrames) continue;
    widestFrames = declared.frames;
    widestState = state;
  }
  failUnlessMeasured('G12', statesMeasured, 'declared states');
  if (statesMeasured === 0) return;

  const megabytes = (widestFrames * cellBytes) / BYTES_PER_MEGABYTE;
  const allWarmMegabytes = (totalFrames * cellBytes) / BYTES_PER_MEGABYTE;
  console.log(
    `  G12 warm row: ${widestState} is ${megabytes.toFixed(2)} MB of a ` +
      `${ROW_BUDGET_MEGABYTES} MB budget; all ${statesMeasured} states warm at once would be ` +
      `${allWarmMegabytes.toFixed(2)} MB`,
  );
  if (megabytes > ROW_BUDGET_MEGABYTES) {
    fail(
      'G12',
      `${widestState} warms to ${megabytes.toFixed(2)} MB against a budget of ` +
        `${ROW_BUDGET_MEGABYTES} MB`,
    );
  }
}

// ── G13 the runtime's own names ──────────────────────────────────────────────

/**
 * The sprite module is read as source rather than imported: it reaches for
 * browser globals a Node process does not have.
 */
const SPRITE_MODULE_PATH = 'src/sprites/darkKnightSprite.ts';

function spriteModuleSource(): string {
  return readFileSync(resolve(SPRITE_MODULE_PATH), 'utf8');
}

function quotedNames(source: string, pattern: RegExp, gateId: string, what: string): string[] {
  const declaration = pattern.exec(source);
  if (declaration === null) {
    fail(gateId, `${SPRITE_MODULE_PATH} does not declare ${what}`);
    return [];
  }
  return [...declaration[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

/**
 * G13 — every state name the runtime can ask for is one the figure paints.
 *
 * `stateFor` builds its pose names by template literal, `BodyPartGoreSystem`
 * spawns its pieces by name, and the prewarm helpers name whole rows. All three
 * draw paths answer a name the figure does not declare by returning without
 * drawing anything and saying nothing: a whole facing of the boss, or a body
 * part, simply never appears.
 */
function gateRuntimeStateNames(): void {
  const source = spriteModuleSource();
  const poseNames = quotedNames(
    source,
    /type DarkKnightState\s*=([^;]*);/,
    'G13',
    'a DarkKnightState union',
  );
  const goreParts = quotedNames(
    source,
    /DARK_KNIGHT_GORE_PARTS[^=]*=\s*\[([^\]]*)\]/,
    'G13',
    'DARK_KNIGHT_GORE_PARTS',
  );
  const walkStates = quotedNames(
    source,
    /DARK_KNIGHT_WALK_STATES[^=]*=\s*\[([^\]]*)\]/,
    'G13',
    'DARK_KNIGHT_WALK_STATES',
  );
  for (const [names, purpose] of [
    [poseNames, `${SPRITE_MODULE_PATH}'s DarkKnightState`],
    [goreParts, `${SPRITE_MODULE_PATH}'s DARK_KNIGHT_GORE_PARTS`],
    [walkStates, `${SPRITE_MODULE_PATH}'s DARK_KNIGHT_WALK_STATES`],
  ] as const) {
    for (const failure of missingStateFailures(DARK_KNIGHT_FIGURE, names, purpose)) {
      fail('G13', failure);
    }
  }

  // The gore list is an *order*, not a set: `BodyPartGoreSystem` walks it and
  // the figure paints its pieces in the same order, so a reordered list hands
  // each piece another piece's spawn.
  const painted = [...GORE_STATES];
  if (goreParts.length !== painted.length || goreParts.some((part, i) => part !== painted[i])) {
    fail(
      'G13',
      `${SPRITE_MODULE_PATH}'s DARK_KNIGHT_GORE_PARTS is [${goreParts.join(', ')}] but the ` +
        `figure paints [${painted.join(', ')}]`,
    );
  }

  // Every pose row the figure paints must also be reachable: a row the runtime
  // can never name is memory and choreography nobody sees.
  const reachable = new Set(poseNames);
  let rowsChecked = 0;
  for (const row of DARK_KNIGHT_ROWS) {
    rowsChecked++;
    if (reachable.has(row.name)) continue;
    fail(
      'G13',
      `the figure paints "${row.name}" but ${SPRITE_MODULE_PATH}'s DarkKnightState cannot name ` +
        'it — the row can never be drawn',
    );
  }
  failUnlessMeasured('G13', rowsChecked, 'pose rows');
}

// ── G14 the frozen gore recentring ───────────────────────────────────────────

/**
 * The canvas the gore pieces are measured on, big enough that no piece painted
 * about its own origin can reach an edge.
 */
const GORE_MEASURE_SPAN = 512;
const GORE_MEASURE_ORIGIN = GORE_MEASURE_SPAN / 2;

/**
 * How far a re-measured offset may sit from the frozen one, in piece units.
 *
 * Zero in principle — the same painter measured the same way — but a sub-pixel
 * band keeps the gate from firing on a rounding difference between node-canvas
 * builds rather than on the art.
 */
const GORE_RECENTRE_TOLERANCE = 1 / GORE_UNIT;

/**
 * G14 — the frozen gore recentring offsets still describe the painted pieces.
 *
 * The offsets are the one number in the figure that cannot be computed where it
 * is used: `BodyPartGoreSystem` spins a piece about the centre of its ink, and
 * finding that centre means painting the piece and reading the pixels back.
 * They are frozen in the figure module and re-measured here, so a redrawn piece
 * cannot silently start orbiting.
 *
 * Checked in both directions. A frozen offset with no piece left to own it is a
 * dead entry that reads like a maintained measurement, and the next agent to
 * add a piece by that name inherits a number measured off art that is gone.
 */
function gateGoreRecentre(): void {
  const canvas = createCanvas(GORE_MEASURE_SPAN, GORE_MEASURE_SPAN);
  const ctx = canvas.getContext('2d');
  const pieces = darkKnightGorePieces();
  const paintedStates = new Set(pieces.map((piece) => piece.state));
  for (const frozenState of GORE_RECENTRE.keys()) {
    if (paintedStates.has(frozenState)) continue;
    fail(
      'G14',
      `GORE_RECENTRE freezes an offset for "${frozenState}", which nothing paints any more`,
    );
  }
  let piecesMeasured = 0;
  for (const piece of pieces) {
    piecesMeasured++;
    ctx.clearRect(0, 0, GORE_MEASURE_SPAN, GORE_MEASURE_SPAN);
    ctx.save();
    ctx.translate(GORE_MEASURE_ORIGIN, GORE_MEASURE_ORIGIN);
    ctx.scale(GORE_UNIT, GORE_UNIT);
    piece.paint(asGameContext(ctx));
    ctx.restore();
    const { data } = ctx.getImageData(0, 0, GORE_MEASURE_SPAN, GORE_MEASURE_SPAN);
    let minX = GORE_MEASURE_SPAN;
    let maxX = -1;
    let minY = GORE_MEASURE_SPAN;
    let maxY = -1;
    for (let y = 0; y < GORE_MEASURE_SPAN; y++) {
      for (let x = 0; x < GORE_MEASURE_SPAN; x++) {
        const alpha = data[(y * GORE_MEASURE_SPAN + x) * CHANNELS + ALPHA_OFFSET];
        if (alpha < INK_ALPHA_THRESHOLD) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) {
      fail('G14', `${piece.state} painted nothing at all when measured about its own centre`);
      continue;
    }
    const measuredX = (GORE_MEASURE_ORIGIN - (minX + maxX) / 2) / GORE_UNIT;
    const measuredY = (GORE_MEASURE_ORIGIN - (minY + maxY) / 2) / GORE_UNIT;
    const frozen = GORE_RECENTRE.get(piece.state);
    if (frozen === undefined) {
      fail('G14', `the figure freezes no recentring offset for ${piece.state}`);
      continue;
    }
    const gap = Math.hypot(measuredX - frozen.x, measuredY - frozen.y);
    if (gap > GORE_RECENTRE_TOLERANCE) {
      fail(
        'G14',
        `${piece.state}'s ink centres at (${measuredX}, ${measuredY}) but GORE_RECENTRE freezes ` +
          `(${frozen.x}, ${frozen.y}) — the piece will orbit rather than tumble; paste the ` +
          'measured pair',
      );
    }
  }
  failUnlessMeasured('G14', piecesMeasured, 'gore pieces');
}

/**
 * G15 — a row paints as many pictures as it declares frames.
 *
 * His idles shipped as five pictures for eight frames in all three views and
 * his slam as fifteen for sixteen, because every term rode one oscillator and
 * the contact beat held its extreme. The helm's drag and the cloth's own clock
 * are what separated them. The floor is perceptual rather than a hash because a
 * hash calls two frames different for a difference nobody can see.
 */
function gateDistinctFrames(): void {
  const report = sharedDistinctFrameFailures(DARK_KNIGHT_FIGURE, cellRgba);
  for (const message of report.failures) fail('G15', message);
  failUnlessMeasured('G15', report.framesMeasured, 'painted frames');
  if (report.closestNote !== null) console.log(`  G15 closest frames: ${report.closestNote}`);
}

/** Runs every gate and returns one message per failure. */
export function darkKnightGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gateAnchor();
  gateLoopClosure();
  gateLegReach();
  gateFootSlide();
  gateOffHandGrip();
  gateMaceArc();
  gateMaceFloor();
  gateImpactIsThePeak();
  gateGoreDistinctness();
  gateGoreRotationClearance();
  gateWarmRowSize();
  gateRuntimeStateNames();
  gateGoreRecentre();
  gateDistinctFrames();
  return [...failures];
}
