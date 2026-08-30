/**
 * The Bugaboo's art gates.
 *
 * The creature has no baked sheet to inspect any more, so every invariant the
 * old bake gate enforced against sheet pixels is enforced here against cells
 * painted from `BUGABOO_FIGURE` — baked exactly the way the runtime cache bakes
 * them, supersampled and downsampled, so what is measured is what the game
 * blits. The pose-stream gates measure the rig itself and need no pixels at
 * all.
 *
 * Every gate here exists because something on this figure was wrong in a way
 * that `typecheck`, `lint` and reading the drawing code could not see.
 *
 * Failures accumulate rather than throwing one at a time, so one run reports
 * everything that is wrong. A gate that cannot find the row it names fails
 * loudly: a lookup that quietly returns nothing turns a whole gate module green
 * while measuring nothing.
 *
 * Run by the review harness: `npm run render:bugaboo`.
 */

import { createCanvas } from 'canvas';

import { bakeFigureCell } from './figureSheet.js';
import {
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
} from './figureGates.js';
import { asGameContext } from './nodeGameContext.js';
import {
  BREACH_FRAMES,
  BUGABOO_FIGURE,
  BUGABOO_ROWS,
  FIGURE_SCALE,
  FRAME_PADDING,
  FRAME_SIZE_QUANTUM,
  GROUND_OFFSET_PX,
  SWIPE_IMPACT_FRAME,
  TILE_SCALE,
  breach,
  swipeSide,
  type RowSpec,
} from '../src/sprites/art/bugabooFigure.js';
import {
  ARM_LENGTH,
  BREACH_FLOOR_Y,
  HIP_Y,
  JOINT_SLACK,
  SHIN_LENGTH,
  SUBMERGE_DEPTH,
  THIGH_LENGTH,
  ankleFor,
  solvedArm,
  solvedLegRoot,
  drawBugabooBack,
  drawBugabooFront,
  drawBugabooSide,
  type BugabooPose,
  type BugabooView,
} from '../src/sprites/art/bugabooArt.js';
import {
  BUGABOO_STANDING_INK_TOP,
  BUGABOO_STATES,
  BUGABOO_SWIPE_FRAMES,
} from '../src/sprites/bugabooSprite.js';

/** Alpha above which a pixel counts as painted. */
const INK_ALPHA_THRESHOLD = 24;
/** Alpha above which a pixel counts as *solid* ink rather than a soft edge. */
const SOLID_ALPHA_THRESHOLD = 200;
const CHANNELS = 4;
const ALPHA_OFFSET = 3;
const BYTES_PER_PIXEL = 4;
const BYTES_PER_MEGABYTE = 1024 * 1024;
const DEGREES_PER_RADIAN = 180 / Math.PI;

const { frameWidth, frameHeight } = BUGABOO_FIGURE;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

/**
 * Fails a gate whose filtered loop ran zero times.
 *
 * Most gates below narrow before they measure — loops only, standing rows only,
 * one pair per one-shot — and a narrowing that matches nothing leaves a green
 * gate that examined nothing. Every filtering loop here counts what it looked
 * at and ends with a call to this.
 */
function failUnlessMeasured(gateId: string, measured: number, what: string): void {
  for (const failure of nothingMeasuredFailures(measured, what)) fail(gateId, failure);
}

// ── Painted-cell helpers ─────────────────────────────────────────────────────

const alphaByCell = new Map<string, Uint8ClampedArray>();

/** One cell's alpha channel, baked as the runtime cache bakes it. */
function cellAlpha(state: string, frame: number): Uint8ClampedArray {
  const key = `${state}[${frame}]`;
  const cached = alphaByCell.get(key);
  if (cached !== undefined) return cached;
  const cell = bakeFigureCell(BUGABOO_FIGURE, state, frame);
  const { data } = cell.getContext('2d').getImageData(0, 0, frameWidth, frameHeight);
  const alpha = new Uint8ClampedArray(frameWidth * frameHeight);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * CHANNELS + ALPHA_OFFSET];
  alphaByCell.set(key, alpha);
  return alpha;
}

function cellsOfRow(row: RowSpec): Uint8ClampedArray[] {
  return Array.from({ length: row.frameCount }, (_unused, frame) => cellAlpha(row.name, frame));
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

const EMPTY_INK: InkStats = {
  count: 0,
  centroidX: 0,
  centroidY: 0,
  minX: 0,
  maxX: 0,
  minY: 0,
  maxY: 0,
};

function inkStatsOf(
  alpha: Uint8ClampedArray,
  width: number,
  threshold = INK_ALPHA_THRESHOLD,
): InkStats {
  const height = alpha.length / width;
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
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
  if (count === 0) return EMPTY_INK;
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

/**
 * The row a gate names, or null after recording a failure.
 *
 * Every one of these names is a string literal written here rather than in
 * `BUGABOO_ROWS`, so renaming a row would otherwise turn its gate into a silent
 * no-op: present, green, and measuring nothing.
 */
function rowNamed(name: string, gateId: string): RowSpec | null {
  const row = BUGABOO_ROWS.find((candidate) => candidate.name === name);
  if (row === undefined) {
    fail(gateId, `no row named "${name}" — a gate is guarding a row that no longer exists`);
    return null;
  }
  return row;
}

// ── Pixel gates ──────────────────────────────────────────────────────────────

/**
 * G1 — the shared structural gates: every declared state paints every declared
 * frame, nothing paints against the cell edge, and the cell is not mostly
 * empty.
 *
 * A frame that paints outside its cell is cropped by the cache's bake and baked
 * in, and nothing downstream can detect it.
 */
function gateStructure(): void {
  for (const failure of figureStructuralFailures(BUGABOO_FIGURE)) fail('G1', failure);
}

/**
 * How far a foot may float above the ground line the frozen tile box declares.
 *
 * Split from the hang tolerance below and deliberately tighter: a contact
 * shadow and a soft sole legitimately spill past the line, while a figure that
 * floats has nothing holding it down. One number covering both has to be
 * loosened until it catches nothing.
 */
const FOOT_FLOAT_TOLERANCE_PX = 3;
const FOOT_HANG_TOLERANCE_PX = 6;
const STANDING_ROWS = ['idle', 'idle_side', 'idle_away'] as const;
/**
 * Space added on every side before an anchor is measured.
 *
 * The cell is padded by `FRAME_PADDING` and no more, so in it any translation
 * big enough to fail this check paints against the edge first and G1 speaks
 * instead — leaving this gate structurally unable to fail. Measured on a canvas
 * with room around it, the two are independent again.
 */
const ANCHOR_MEASURE_PAD_PX = 64;

/** A frame painted into a canvas padded on all four sides, in cell coordinates. */
function paddedInkStats(state: string, frame: number, threshold: number): InkStats {
  const width = frameWidth + ANCHOR_MEASURE_PAD_PX * 2;
  const height = frameHeight + ANCHOR_MEASURE_PAD_PX * 2;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.translate(ANCHOR_MEASURE_PAD_PX, ANCHOR_MEASURE_PAD_PX);
  BUGABOO_FIGURE.paintFrame(asGameContext(ctx), state, frame);
  ctx.restore();
  const { data } = ctx.getImageData(0, 0, width, height);
  const alpha = new Uint8ClampedArray(width * height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * CHANNELS + ALPHA_OFFSET];
  const stats = inkStatsOf(alpha, width, threshold);
  if (stats.count === 0) return stats;
  return {
    ...stats,
    centroidX: stats.centroidX - ANCHOR_MEASURE_PAD_PX,
    centroidY: stats.centroidY - ANCHOR_MEASURE_PAD_PX,
    minX: stats.minX - ANCHOR_MEASURE_PAD_PX,
    maxX: stats.maxX - ANCHOR_MEASURE_PAD_PX,
    minY: stats.minY - ANCHOR_MEASURE_PAD_PX,
    maxY: stats.maxY - ANCHOR_MEASURE_PAD_PX,
  };
}

/**
 * G2 — the creature's feet stand where `tileY` claims the ground is.
 *
 * Health bars and aggro markers key off that anchor, so art that drifts off it
 * takes them with it. Measured against *solid* ink, because the contact shadow
 * is a radial gradient that legitimately spreads past the feet, and on the idle
 * rows only: nothing standing in a hole in the floor has feet on it.
 *
 * This cannot catch a wrong `tileY` — `paintFrame` puts its own origin on the
 * same line — and does not claim to; the parity run against the sheet is what
 * proved those numbers. What it catches is the art drifting off its own anchor.
 */
function gateAnchor(): void {
  const groundY = BUGABOO_FIGURE.tileY + GROUND_OFFSET_PX;
  let rowsMeasured = 0;
  for (const name of STANDING_ROWS) {
    const row = rowNamed(name, 'G2');
    if (row === null) continue;
    const stats = paddedInkStats(name, 0, SOLID_ALPHA_THRESHOLD);
    if (stats.count === 0) {
      fail('G2', `${name}[0] has no solid ink at all to stand on`);
      continue;
    }
    rowsMeasured++;
    const drop = stats.maxY - groundY;
    if (drop < -FOOT_FLOAT_TOLERANCE_PX || drop > FOOT_HANG_TOLERANCE_PX) {
      fail(
        'G2',
        `${name}[0] has its lowest solid ink at y=${stats.maxY} against a ground line of ` +
          `${groundY} (tileY ${BUGABOO_FIGURE.tileY} + ${GROUND_OFFSET_PX}) — ` +
          `${drop.toFixed(1)}px off, allowed ` +
          `${-FOOT_FLOAT_TOLERANCE_PX}..${FOOT_HANG_TOLERANCE_PX}`,
      );
    }
  }
  failUnlessMeasured('G2', rowsMeasured, 'standing rows');
}

/**
 * G3 — a looping row's last→first delta sits in a band, not merely under a cap.
 *
 * This is the gate that catches a walk that pops once per cycle, which is
 * invisible on a contact sheet because every individual frame is fine, and a
 * cycle sampled over anything other than its own length.
 *
 * The floor is the half the sheet-era gate lacked. Sampling a cycle at
 * `frame / (frameCount - 1)` makes the last frame identical to the first, so
 * the seam goes to zero, the row holds still for a whole frame, and a
 * ceiling-only gate stays green through it. It is held against the row's median
 * step rather than its narrowest, because a row may legitimately hold two
 * byte-identical adjacent frames, which would collapse the floor to `seam >= 0`.
 */
/**
 * How far past the row's own largest ordinary step the seam may reach.
 *
 * A closed cycle crosses its seam the way it crosses anywhere else, so the
 * largest in-cycle step is the yardstick. Measured on shipped art: this figure's
 * seven loop rows seam at 0.57–1.03 of their largest step (breach lowest,
 * idle_side highest), and the worst across every painted figure in the repo is
 * 1.076. The limit this replaces also allowed 2.1× the row's *median* step, and
 * on rows whose steps are all large that clause swallowed the whole check. This clause is an art-drift check and cannot see cycle count at
 * all: re-timing a row moves the steps it is judged against along with the
 * seam. The wrap clause is what covers that.
 */
const LOOP_SEAM_CEILING = 1.15;
const LOOP_SEAM_FLOOR = 0.3;
/**
 * How many pixels the frame one past a loop's last may differ from its first.
 *
 * The clause that binds a cycle to exactly one turn, and the only one that can:
 * a seam ratio moves its own denominator when the row is re-timed, so a cycle
 * running one and a half turns can measure *inside* the ceiling. The painter
 * takes a frame index rather than a phase, so a loop can be painted at
 * `frameCount` — one frame past its end — where a closed cycle reproduces frame
 * 0. Not held to exactly zero because the cell is downsampled from twice its
 * size and a pose value landing on 2π rather than 0 rounds independently on each
 * side; all seven of this figure's loop rows measure 0px, and the worst across
 * the seven figures swept with it is 4px.
 */
const LOOP_WRAP_TOLERANCE_PX = 16;
/**
 * The least any interior frame of a loop may differ from its first.
 *
 * The wrap check is satisfied by a row that runs its cycle *twice*, which
 * repeats frame 0 in the middle of the row. Measured: the closest any interior
 * frame comes to frame 0 across these rows is 80px (idle_side), so this sits
 * clear of the art and far from the 0px an exact repeat scores.
 */
const LOOP_INTERIOR_REPEAT_FLOOR_PX = 20;

function gateLoopClosure(): void {
  let rowsMeasured = 0;
  for (const row of BUGABOO_ROWS) {
    if (row.kind !== 'loop') continue;
    const cells = cellsOfRow(row);
    const steps: number[] = [];
    for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
    const seam = frameDelta(cells[cells.length - 1], cells[0]);
    const typical = median(steps);
    rowsMeasured++;
    if (typical === 0) {
      fail('G3', `${row.name} has a median step of 0px — the row is frozen, not looping`);
      continue;
    }

    const wrap = frameDelta(cellAlpha(row.name, row.frameCount), cells[0]);
    if (wrap > LOOP_WRAP_TOLERANCE_PX) {
      fail(
        'G3',
        `${row.name} does not cover exactly one turn: painted at frame ${row.frameCount}, one ` +
          `past its end, it differs from frame 0 by ${wrap}px (allowed ` +
          `${LOOP_WRAP_TOLERANCE_PX}px) — the cycle is sampled over more or less than its own ` +
          'length, so the row plays at the wrong rate and never closes',
      );
    }
    let closestInterior = Infinity;
    let closestFrame = -1;
    for (let frame = 1; frame < row.frameCount; frame++) {
      const distance = frameDelta(cells[frame], cells[0]);
      if (distance >= closestInterior) continue;
      closestInterior = distance;
      closestFrame = frame;
    }
    if (closestInterior < LOOP_INTERIOR_REPEAT_FLOOR_PX) {
      fail(
        'G3',
        `${row.name}[${closestFrame}] comes back to within ${closestInterior}px of frame 0 (at ` +
          `least ${LOOP_INTERIOR_REPEAT_FLOOR_PX}px expected) — the row is running its cycle ` +
          'more than once',
      );
    }

    const largestStep = Math.max(...steps);
    const allowed = largestStep * LOOP_SEAM_CEILING;
    if (seam > allowed) {
      fail(
        'G3',
        `${row.name} pops across its loop seam: last→first differs by ${seam}px against a ` +
          `largest in-cycle step of ${largestStep}px (allowed ${allowed.toFixed(0)}px)`,
      );
    }
    const floor = typical * LOOP_SEAM_FLOOR;
    if (seam < floor) {
      fail(
        'G3',
        `${row.name} holds still across its loop seam: last→first differs by only ${seam}px ` +
          `against a median step of ${typical}px (at least ${floor.toFixed(0)}px expected) — ` +
          'the cycle is being sampled past its own end',
      );
    }
  }
  failUnlessMeasured('G3', rowsMeasured, 'loops that actually move');
}

/**
 * G4 — no consecutive-frame step far above the row's own median.
 *
 * Catches a snapped knee, a mid-swing draw-order flip and an IK clamp. The
 * one-shot rows are allowed a bigger spike than the loops, because a strike is
 * *meant* to have one violent frame in it — that is what a strike is.
 */
const LOOP_STEP_LIMIT = 2.6;
const ONE_SHOT_STEP_LIMIT = 4;
/**
 * A step this small is not visible however large its ratio to the row's median.
 * Without a floor the gate is loudest on the rows that move least.
 */
const STEP_FLOOR_SHARE = 0.005;

function gateMotionContinuity(): void {
  const floor = frameWidth * frameHeight * STEP_FLOOR_SHARE;
  let stepsMeasured = 0;
  for (const row of BUGABOO_ROWS) {
    const limit = row.kind === 'loop' ? LOOP_STEP_LIMIT : ONE_SHOT_STEP_LIMIT;
    const cells = cellsOfRow(row);
    const steps: number[] = [];
    for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
    const typical = median(steps);
    if (typical === 0) continue;
    stepsMeasured += steps.length;
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
  }
  failUnlessMeasured('G4', stepsMeasured, 'frame-to-frame steps');
}

/**
 * G5 — a walk cycle does not slide in place.
 *
 * The creature's ink centroid may bob, but over a full loop it must come back
 * to where it started: a centroid that has drifted by the end of the cycle is a
 * figure moonwalking on the spot.
 *
 * The seam is one step like any other, so it is judged against the steps inside
 * the cycle rather than against a flat pixel count — a flat limit measures how
 * energetic the animation is. The worst-step clause is there because the seam
 * of a walk lands on contact, where the swing leg is travelling fastest.
 */
const CENTROID_SEAM_LIMIT = 1.6;
const CENTROID_SEAM_VS_WORST_STEP = 1.25;
const CENTROID_SEAM_FLOOR_PX = 1;

function gateCentroidDrift(): void {
  let loopsMeasured = 0;
  for (const row of BUGABOO_ROWS) {
    if (row.kind !== 'loop') continue;
    loopsMeasured++;
    const centroids = cellsOfRow(row).map((cell) => inkStatsOf(cell, frameWidth));
    const stepBetween = (a: InkStats, b: InkStats): number =>
      Math.hypot(b.centroidX - a.centroidX, b.centroidY - a.centroidY);
    const steps: number[] = [];
    for (let i = 1; i < centroids.length; i++) {
      steps.push(stepBetween(centroids[i - 1], centroids[i]));
    }
    const seam = stepBetween(centroids[centroids.length - 1], centroids[0]);
    const allowed = Math.max(
      median(steps) * CENTROID_SEAM_LIMIT,
      Math.max(...steps) * CENTROID_SEAM_VS_WORST_STEP,
      CENTROID_SEAM_FLOOR_PX,
    );
    if (seam > allowed) {
      fail(
        'G5',
        `${row.name}'s centroid jumps ${seam.toFixed(2)}px across its loop seam against a median ` +
          `in-cycle step of ${median(steps).toFixed(2)}px (allowed ${allowed.toFixed(2)}px) — it ` +
          'is sliding on the spot',
      );
    }
  }
  failUnlessMeasured('G5', loopsMeasured, 'loop rows');
}

/**
 * G6 — the arm out of a breach is always well clear of the hole's lip.
 *
 * The whole point of that row is a hand coming up out of the floor: on any
 * frame where the arm is down inside the hole there is nothing to see but
 * rubble, and the player standing on a tile that is quietly damaging them has
 * no idea why. Measured as the height of the topmost ink above the floor line.
 */
const BREACH_MIN_REACH_TILES = 0.4;

function gateBreachReach(): void {
  const row = rowNamed('breach', 'G6');
  if (row === null) return;
  // Figure units scale by the tile size *and* the figure's own scale factor;
  // the tile size alone is the trap, and it is only a third of a pixel out
  // today because the floor line happens to sit near the origin.
  const floorY =
    BUGABOO_FIGURE.tileY + GROUND_OFFSET_PX + BREACH_FLOOR_Y * TILE_SCALE * FIGURE_SCALE;
  let framesMeasured = 0;
  for (let frame = 0; frame < row.frameCount; frame++) {
    const stats = inkStatsOf(cellAlpha('breach', frame), frameWidth);
    if (stats.count === 0) {
      fail('G6', `breach[${frame}] painted nothing at all`);
      continue;
    }
    framesMeasured++;
    const reach = (floorY - stats.minY) / TILE_SCALE;
    if (reach < BREACH_MIN_REACH_TILES) {
      fail(
        'G6',
        `breach[${frame}] reaches only ${reach.toFixed(3)} tiles above the floor line ` +
          `(limit ${BREACH_MIN_REACH_TILES}) — on that frame there is nothing out of the hole`,
      );
    }
  }
  failUnlessMeasured('G6', framesMeasured, 'breach frames');
}

/**
 * G7 — an attack row hands back to the stance it was entered from.
 *
 * The runtime plays a swipe and then goes straight back to idling. A row whose
 * first and last frames are still mid-swing pops twice per attack, at the
 * shoulders, which is exactly where the player is already looking.
 */
/**
 * How far a swipe's last frame may sit from the stance it hands back to, as a
 * share of the cell.
 *
 * Re-derived from the art rather than left at the 0.045 it carried, which no
 * plausible defect could reach: the three swipes hand off at 515px, 804px and
 * 515px of this 176×176 cell, so the old limit sat at nearly twice the worst of
 * them and a swipe left visibly mid-recovery — its hand keyed to arrive home
 * half a row late — still measured 1059px and passed. This sits above the
 * shipped rows by about a quarter and under that defect.
 */
const SETTLE_LIMIT_SHARE = 0.0323;
/**
 * The same for the entrance, which is allowed more.
 *
 * `emerge` is the creature climbing out of a hole rather than swinging in
 * place, and it hands off at 902px — the widest of the four, and honestly so,
 * because the pose it arrives in carries the last of the climb.
 */
const ENTRANCE_SETTLE_LIMIT_SHARE = 0.0371;
const ONE_SHOT_SETTLES: ReadonlyArray<readonly [string, string, number]> = [
  ['swipe', 'idle', SETTLE_LIMIT_SHARE],
  ['swipe_side', 'idle_side', SETTLE_LIMIT_SHARE],
  ['swipe_away', 'idle_away', SETTLE_LIMIT_SHARE],
  ['emerge', 'idle', ENTRANCE_SETTLE_LIMIT_SHARE],
];

function gateOneShotSettle(): void {
  let pairsMeasured = 0;
  for (const [shot, stance, share] of ONE_SHOT_SETTLES) {
    const shotRow = rowNamed(shot, 'G7');
    const stanceRow = rowNamed(stance, 'G7');
    if (shotRow === null || stanceRow === null) continue;
    pairsMeasured++;
    const limit = frameWidth * frameHeight * share;
    const delta = frameDelta(cellAlpha(shot, shotRow.frameCount - 1), cellAlpha(stance, 0));
    if (delta > limit) {
      fail(
        'G7',
        `${shot}'s last frame differs from ${stance}[0] by ${delta}px (limit ${limit.toFixed(0)}) ` +
          '— the attack hands off to a different pose than the one it returns to',
      );
    }
  }
  failUnlessMeasured('G7', pairsMeasured, 'one-shot/stance pairs');
}

/**
 * Megabytes the widest single state may occupy once warm.
 *
 * The sheet-era budget was the whole texture, because the whole texture was
 * decoded whether or not anything played. A painted figure is admitted one
 * state at a time and lets go of the states it stops playing, so the number
 * that decides whether it fits is the widest row against the cache's per-figure
 * ceiling. The whole-figure total is reported beside it because this creature
 * is warmed a whole set at a time: it paints too slowly for the direct-paint
 * fallback, so every row it can reach is prewarmed at once and the sum is what
 * a defended grate room actually holds.
 */
const ROW_BUDGET_MEGABYTES = 6;
const ALL_WARM_BUDGET_MEGABYTES = 20;

/** G8 — warm bytes, reported whether or not they pass. */
function gateWarmRowSize(): void {
  const cellBytes = frameWidth * frameHeight * BYTES_PER_PIXEL;
  let widestState = '';
  let widestFrames = 0;
  let statesMeasured = 0;
  let totalFrames = 0;
  for (const [state, declared] of BUGABOO_FIGURE.states) {
    statesMeasured++;
    totalFrames += declared.frames;
    if (declared.frames <= widestFrames) continue;
    widestFrames = declared.frames;
    widestState = state;
  }
  failUnlessMeasured('G8', statesMeasured, 'declared states');
  if (statesMeasured === 0) return;

  const megabytes = (widestFrames * cellBytes) / BYTES_PER_MEGABYTE;
  const allWarmMegabytes = (totalFrames * cellBytes) / BYTES_PER_MEGABYTE;
  console.log(
    `  G8 warm row: ${widestState} is ${megabytes.toFixed(2)} MB of a ` +
      `${ROW_BUDGET_MEGABYTES} MB budget; all ${statesMeasured} states warm at once is ` +
      `${allWarmMegabytes.toFixed(2)} MB of a ${ALL_WARM_BUDGET_MEGABYTES} MB budget`,
  );
  if (megabytes > ROW_BUDGET_MEGABYTES) {
    fail(
      'G8',
      `${widestState} warms to ${megabytes.toFixed(2)} MB against a budget of ` +
        `${ROW_BUDGET_MEGABYTES} MB`,
    );
  }
  if (allWarmMegabytes > ALL_WARM_BUDGET_MEGABYTES) {
    fail(
      'G8',
      `every row warm at once is ${allWarmMegabytes.toFixed(2)} MB against a budget of ` +
        `${ALL_WARM_BUDGET_MEGABYTES} MB, and this figure is prewarmed a whole set at a time`,
    );
  }
}

// ── Pose-stream gates ────────────────────────────────────────────────────────

/**
 * G9 — a planted foot stays planted.
 *
 * The classic moonwalk, and the one defect a contact sheet is completely blind
 * to: every individual frame looks correct. A planted foot sliding *backward*
 * under the body at a constant rate is what a stance phase is; travelling
 * forward is what it must never do.
 */
const FOOT_DOWN_LIMIT = 0.002;

function gateFootSlide(): void {
  const row = rowNamed('walk_side', 'G9');
  if (row === null) return;
  let stepsMeasured = 0;
  let previous: { left: number; right: number; leftDown: boolean; rightDown: boolean } | null =
    null;
  for (let frame = 0; frame < row.frameCount; frame++) {
    const pose = row.pose(frame);
    const current = {
      left: pose.leftFoot.x,
      right: pose.rightFoot.x,
      leftDown: pose.leftFoot.y >= -FOOT_DOWN_LIMIT,
      rightDown: pose.rightFoot.y >= -FOOT_DOWN_LIMIT,
    };
    if (previous !== null) {
      for (const side of ['left', 'right'] as const) {
        const down =
          side === 'left'
            ? current.leftDown && previous.leftDown
            : current.rightDown && previous.rightDown;
        if (!down) continue;
        stepsMeasured++;
        if (current[side] > previous[side]) {
          fail(
            'G9',
            `walk_side's ${side} foot is planted and travels forward between frames ` +
              `${frame - 1} and ${frame} (${previous[side].toFixed(4)} → ` +
              `${current[side].toFixed(4)}) — that is a moonwalk`,
          );
        }
      }
    }
    previous = current;
  }
  failUnlessMeasured('G9', stepsMeasured, 'planted-foot steps');
}

/**
 * G10 — the legs never have to reach further than they are long.
 *
 * A stride that clamps on even one frame reads as a hop: the leg locks dead
 * straight with its foot hanging above the floor, and the next frame's tuck
 * snaps the knee back in. The margin is thin by construction — the legs are
 * within half a percent of the hip height — so this is measured on every frame
 * of every row rather than spot-checked.
 *
 * The subject is the foot *target*, which the choreography writes, not the
 * solved chain the IK clamps: reading the chain could only ever see equality.
 */
const LEG_REACH_LIMIT = THIGH_LENGTH + SHIN_LENGTH - JOINT_SLACK;

function gateLegReach(): void {
  let worst = 0;
  let legsMeasured = 0;
  for (const row of BUGABOO_ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      const pose = row.pose(frame);
      for (const [side, foot, pitch] of [
        ['left', pose.leftFoot, pose.leftFootPitch],
        ['right', pose.rightFoot, pose.rightFootPitch],
      ] as const) {
        legsMeasured++;
        const root = solvedLegRoot(pose, row.view, side);
        const ankle = ankleFor(foot, pitch);
        const reach = Math.hypot(ankle.x - root.x, ankle.y - root.y);
        worst = Math.max(worst, reach);
        if (reach > LEG_REACH_LIMIT) {
          fail(
            'G10',
            `${row.name}[${frame}]'s ${side} leg has to reach ${reach.toFixed(4)} from its root ` +
              `against a leg ${LEG_REACH_LIMIT.toFixed(4)} long — the IK clamps and the step ` +
              'becomes a hop',
          );
        }
      }
    }
  }
  failUnlessMeasured('G10', legsMeasured, 'legs');
  console.log(`  G10 leg reach: worst frame ${worst.toFixed(4)} of ${LEG_REACH_LIMIT.toFixed(4)}`);
}

/**
 * G11 — no arm is clamped, and no elbow is folded flat against itself.
 *
 * Two different faults, and a clamp check alone sees only the first.
 *
 * Unlike Carl's equivalent this does *not* demand a near-straight arm. These
 * arms are more than half the creature's height, so almost every deliberate
 * pose folds them hard — a hand reaching out of a floor hole spans a third of
 * its own arm and is correct. What is never correct is a joint folded past the
 * point where the two segments lie on top of each other, which the solver will
 * happily produce and which reads as an arm with no elbow at all.
 */
const CLAMP_TOLERANCE = 0.0005;
const MIN_ELBOW_DEGREES = 25;

function gateArmReach(): void {
  let elbowsMeasured = 0;
  let targetsMeasured = 0;
  for (const row of BUGABOO_ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      const pose = row.pose(frame);
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
        elbowsMeasured++;
        if (elbow < MIN_ELBOW_DEGREES) {
          fail(
            'G11',
            `${row.name}[${frame}]'s ${side} elbow is folded to ${elbow.toFixed(1)}° ` +
              `(limit ${MIN_ELBOW_DEGREES}°) — the two segments lie along each other and the ` +
              'arm reads as having no joint',
          );
        }
        // Only an arm placed by a hand *target* can clamp; the FK-driven walk
        // and smash arms carry their own length by construction.
        if (angles !== null) continue;
        targetsMeasured++;
        const moved = Math.hypot(chain.end.x - hand.x, chain.end.y - hand.y);
        if (moved > CLAMP_TOLERANCE) {
          fail(
            'G11',
            `${row.name}[${frame}]'s ${side} hand target is beyond an arm ` +
              `${ARM_LENGTH.toFixed(4)} long, so the IK clamped it ${moved.toFixed(4)} short and ` +
              'locked the elbow straight',
          );
        }
      }
    }
  }
  failUnlessMeasured('G11', elbowsMeasured, 'elbows');
  failUnlessMeasured('G11', targetsMeasured, 'IK-placed hands');
}

/**
 * G12 — the strike peaks on the frame the mob deals its damage.
 *
 * `Bugaboo` fires its hit on `SWIPE_IMPACT_FRAME`. A timing table that drifted
 * from the choreography puts the claws at full reach two frames after the
 * player has already been clawed.
 */
function gateImpactIsThePeak(): void {
  const row = rowNamed('swipe_side', 'G12');
  if (row === null) return;
  let peakFrame = 0;
  let furthest = -Infinity;
  let framesMeasured = 0;
  for (let frame = 0; frame < row.frameCount; frame++) {
    framesMeasured++;
    const reach = swipeSide(frame / (row.frameCount - 1)).rightHand.x;
    if (reach > furthest) {
      furthest = reach;
      peakFrame = frame;
    }
  }
  failUnlessMeasured('G12', framesMeasured, 'swipe frames');
  if (peakFrame !== SWIPE_IMPACT_FRAME) {
    fail(
      'G12',
      `swipe_side reaches furthest on frame ${peakFrame} but the mob deals damage on frame ` +
        `${SWIPE_IMPACT_FRAME} — the timing table and the choreography have drifted apart`,
    );
  }
  if (BUGABOO_SWIPE_FRAMES !== row.frameCount) {
    fail(
      'G12',
      `the choreography gives a swipe ${row.frameCount} frames but BUGABOO_SWIPE_FRAMES is ` +
        `${BUGABOO_SWIPE_FRAMES} — the mob would time its blow against the wrong length of swing`,
    );
  }
}

/**
 * G13 — the breach's groping hand actually goes round.
 *
 * "Reaching around" is a circle, and a hand that only rocks side to side is a
 * wave. Checked as the hand's own travel: its horizontal *and* vertical spans
 * both have to be real, because a flat sweep passes any single-axis check.
 *
 * The limits are in real tiles, like every other threshold in this file. The
 * pose stream is in *figure* units, which are `FIGURE_SCALE` of a tile, so
 * anyone budgeting this against a tile allowance without the conversion sets it
 * a third too tight.
 */
const GROPE_MIN_SPAN_X_TILES = 0.36;
const GROPE_MIN_SPAN_Y_TILES = 0.15;

function gateGropeSweep(): void {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let framesMeasured = 0;
  for (let frame = 0; frame < BREACH_FRAMES; frame++) {
    framesMeasured++;
    const pose = breach(frame / BREACH_FRAMES);
    // Back into screen space. `breach()` writes this hand as a screen position
    // with its own submergence already taken off, because the hole does not
    // sink with the body — read raw, the body's heave is added back in, and it
    // is *in phase* with the sweep, so the two compound and the gate reports
    // half again the travel that is actually drawn.
    const handY = pose.rightHand.y + pose.submerged * SUBMERGE_DEPTH;
    minX = Math.min(minX, pose.rightHand.x);
    maxX = Math.max(maxX, pose.rightHand.x);
    minY = Math.min(minY, handY);
    maxY = Math.max(maxY, handY);
  }
  failUnlessMeasured('G13', framesMeasured, 'breach frames');
  if (framesMeasured === 0) return;
  const acrossTiles = (maxX - minX) * FIGURE_SCALE;
  const upDownTiles = (maxY - minY) * FIGURE_SCALE;
  if (acrossTiles < GROPE_MIN_SPAN_X_TILES) {
    fail(
      'G13',
      `the breach hand sweeps only ${acrossTiles.toFixed(3)} tiles across ` +
        `(limit ${GROPE_MIN_SPAN_X_TILES})`,
    );
  }
  if (upDownTiles < GROPE_MIN_SPAN_Y_TILES) {
    fail(
      'G13',
      `the breach hand sweeps only ${upDownTiles.toFixed(3)} tiles up and down ` +
        `(limit ${GROPE_MIN_SPAN_Y_TILES}) — a flat sweep is a wave, not a grope`,
    );
  }
}

/**
 * G14 — the breached creature stays under its own floor line.
 *
 * `submerged` is the only thing in the rig that changes *what* is drawn rather
 * than where, and it is easy to author a "submerged" frame that in fact stands
 * the creature in the hole. Measured at the hips rather than the shoulders: a
 * couple of hundredths of shoulder showing above the rubble is the hump that
 * makes the hole read as occupied, but hips at the floor means it is standing.
 */
const BREACH_MIN_HIP_DEPTH_TILES = 0.22;

function gateBreachDepth(): void {
  let framesMeasured = 0;
  for (let frame = 0; frame < BREACH_FRAMES; frame++) {
    framesMeasured++;
    const pose = breach(frame / BREACH_FRAMES);
    const depth = (HIP_Y + pose.submerged * SUBMERGE_DEPTH - BREACH_FLOOR_Y) * FIGURE_SCALE;
    if (depth < BREACH_MIN_HIP_DEPTH_TILES) {
      fail(
        'G14',
        `breach[${frame}] is only ${pose.submerged.toFixed(3)} submerged, which leaves its hips ` +
          `${depth.toFixed(3)} tiles below the floor (limit ${BREACH_MIN_HIP_DEPTH_TILES}) — the ` +
          'creature is standing in the hole rather than still stuck under it',
      );
    }
  }
  failUnlessMeasured('G14', framesMeasured, 'breach frames');
}

/**
 * G15 — the head clearance the runtime lifts overhead UI by matches the art.
 *
 * `BUGABOO_STANDING_INK_TOP` is how the safe room knows to raise Mordecai's
 * speech bubble and `Talk` prompt clear of a creature that stands most of a
 * tile taller than the anchor suggests. The figure's geometry records where his
 * feet are and nothing else, so a redraw that raises the horns leaves the
 * prompt sitting on his chest with every other gate still green.
 */
const HEAD_CLEARANCE_TOLERANCE_PX = 2;
const OVERHEAD_UI_ROWS = [...STANDING_ROWS, 'walk', 'walk_side', 'walk_away'] as const;

function gateHeadClearanceContract(): void {
  let paintedInkTop = Infinity;
  let framesMeasured = 0;
  for (const name of OVERHEAD_UI_ROWS) {
    const row = rowNamed(name, 'G15');
    if (row === null) continue;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const stats = inkStatsOf(cellAlpha(name, frame), frameWidth);
      if (stats.count === 0) continue;
      framesMeasured++;
      paintedInkTop = Math.min(paintedInkTop, stats.minY);
    }
  }
  failUnlessMeasured('G15', framesMeasured, 'standing frames');
  if (!Number.isFinite(paintedInkTop)) return;
  const drift = Math.abs(paintedInkTop - BUGABOO_STANDING_INK_TOP);
  if (drift > HEAD_CLEARANCE_TOLERANCE_PX) {
    fail(
      'G15',
      `the standing rows reach up to y=${paintedInkTop} but BUGABOO_STANDING_INK_TOP in ` +
        `src/sprites/bugabooSprite.ts is ${BUGABOO_STANDING_INK_TOP} — ${drift}px off, ` +
        `limit ${HEAD_CLEARANCE_TOLERANCE_PX}; overhead UI would sit on his head`,
    );
  }
}

/**
 * G16 — every state name the runtime can build is one the figure paints.
 *
 * Both draw paths return silently on an unknown state, so a pose name composed
 * from a base and a view that the figure does not paint is an invisible
 * creature and no log line. The same list is the prewarm list, so a name that
 * has drifted also warms nothing and warns nowhere.
 */
function gateRuntimeStateNames(): void {
  for (const failure of missingStateFailures(
    BUGABOO_FIGURE,
    [...BUGABOO_STATES],
    "bugabooSprite's BUGABOO_STATES",
  )) {
    fail('G16', failure);
  }
  // The other direction: a row the figure paints that no runtime name can reach
  // is art nobody ever sees, and it costs a cell in every accounting.
  const reachable = new Set<string>(BUGABOO_STATES);
  let rowsMeasured = 0;
  for (const row of BUGABOO_ROWS) {
    rowsMeasured++;
    if (reachable.has(row.name)) continue;
    fail('G16', `the figure paints "${row.name}", which no runtime state name can reach`);
  }
  failUnlessMeasured('G16', rowsMeasured, 'painted rows');
}

/**
 * The cell the bake this figure replaces would measure for the art as it stands
 * today, so the five frozen numbers cannot drift away from the poses.
 *
 * The old generator painted every frame onto an oversized canvas, took the
 * furthest reach in each direction from the ground point, added `FRAME_PADDING`
 * and rounded up to `FRAME_SIZE_QUANTUM`. Nothing can do that at runtime, so
 * the answer is frozen in the figure — and this is what re-measures it. A pose
 * that grows is caught by G1 as a clipped cell; a pose that *shrinks* is caught
 * only here, as a cell nobody needs any more.
 */
const MEASURE_SPAN = 384;
const MEASURE_ORIGIN = MEASURE_SPAN / 2;
const MEASURE_INK_ALPHA = 8;

function paintViewForMeasure(
  ctx: CanvasRenderingContext2D,
  view: BugabooView,
  pose: BugabooPose,
): void {
  if (view === 'front') drawBugabooFront(ctx, pose);
  else if (view === 'back') drawBugabooBack(ctx, pose);
  else drawBugabooSide(ctx, pose);
}

/** G17 — the frozen cell is still the cell the art needs. */
function gateCellGeometry(): void {
  const canvas = createCanvas(MEASURE_SPAN, MEASURE_SPAN);
  const ctx = canvas.getContext('2d');
  let left = 0;
  let right = 0;
  let up = 0;
  let down = 0;
  let framesMeasured = 0;
  for (const row of BUGABOO_ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      framesMeasured++;
      ctx.clearRect(0, 0, MEASURE_SPAN, MEASURE_SPAN);
      ctx.save();
      ctx.translate(MEASURE_ORIGIN, MEASURE_ORIGIN);
      ctx.scale(TILE_SCALE * FIGURE_SCALE, TILE_SCALE * FIGURE_SCALE);
      paintViewForMeasure(asGameContext(ctx), row.view, row.pose(frame));
      ctx.restore();
      const { data } = ctx.getImageData(0, 0, MEASURE_SPAN, MEASURE_SPAN);
      for (let y = 0; y < MEASURE_SPAN; y++) {
        for (let x = 0; x < MEASURE_SPAN; x++) {
          if (data[(y * MEASURE_SPAN + x) * CHANNELS + ALPHA_OFFSET] < MEASURE_INK_ALPHA) continue;
          left = Math.max(left, MEASURE_ORIGIN - x);
          right = Math.max(right, x - MEASURE_ORIGIN);
          up = Math.max(up, MEASURE_ORIGIN - y);
          down = Math.max(down, y - MEASURE_ORIGIN);
        }
      }
    }
  }
  failUnlessMeasured('G17', framesMeasured, 'frames');
  if (framesMeasured === 0) return;

  const roundUpTo = (value: number, quantum: number): number =>
    Math.ceil(value / quantum) * quantum;
  const halfWidth = Math.max(left, right) + FRAME_PADDING;
  const wantedWidth = roundUpTo(halfWidth * 2, FRAME_SIZE_QUANTUM);
  const originY = Math.ceil(up + FRAME_PADDING);
  const wantedHeight = roundUpTo(originY + down + FRAME_PADDING, FRAME_SIZE_QUANTUM);
  const wantedTileX = Math.round(wantedWidth / 2 - TILE_SCALE / 2);
  const wantedTileY = originY - GROUND_OFFSET_PX;

  const frozen = [
    ['frameWidth', BUGABOO_FIGURE.frameWidth, wantedWidth],
    ['frameHeight', BUGABOO_FIGURE.frameHeight, wantedHeight],
    ['tileX', BUGABOO_FIGURE.tileX, wantedTileX],
    ['tileY', BUGABOO_FIGURE.tileY, wantedTileY],
  ] as const;
  for (const [name, held, wanted] of frozen) {
    if (held === wanted) continue;
    fail(
      'G17',
      `the figure freezes ${name} ${held} but the art as painted today wants ${wanted} — ` +
        'the cell and the poses have parted company',
    );
  }
}

/** Runs every gate and returns one message per failure. */
export function bugabooGateFailures(): string[] {
  failures.length = 0;
  alphaByCell.clear();
  gateStructure();
  gateAnchor();
  gateLoopClosure();
  gateMotionContinuity();
  gateCentroidDrift();
  gateBreachReach();
  gateOneShotSettle();
  gateWarmRowSize();
  gateFootSlide();
  gateLegReach();
  gateArmReach();
  gateImpactIsThePeak();
  gateGropeSweep();
  gateBreachDepth();
  gateHeadClearanceContract();
  gateRuntimeStateNames();
  gateCellGeometry();
  return [...failures];
}
