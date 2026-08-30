/**
 * The rock golems' art gates, covering the regular golem, the bounty boss and
 * the two thrown-rock effects.
 *
 * None of the four has a baked sheet to inspect any more, so every invariant
 * the old bake enforced by throwing before it wrote a PNG is enforced here
 * instead: the pose-stream gates measure the rig itself, and the pixel gates
 * measure cells painted from the figures exactly the way the runtime cache
 * bakes them — supersampled and downsampled — so what is measured is what the
 * game blits.
 *
 * Failures accumulate rather than throwing one at a time, so one run reports
 * everything that is wrong. A gate that cannot find the row or state it names
 * fails loudly, and so does one whose filtered loop examined nothing.
 *
 * Run by the review harness: `npm run render:rock-golem`.
 */

import { createCanvas, type Canvas } from 'canvas';

import { bakeFigureCell } from './figureSheet.js';
import {
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
} from './figureGates.js';
import { asGameContext } from './nodeGameContext.js';
import {
  FIST_RADIUS,
  SHIN_REACH,
  THIGH_REACH,
  type GolemVariant,
  golemArmChain,
  golemFootPoint,
  golemHipPoint,
} from '../src/sprites/art/rockGolemArt.js';
import {
  GOLEM_FIGURES,
  GOLEM_ROCK_BURST_FIGURE,
  GOLEM_ROCK_FIGURE,
  GORE_RECENTRE,
  GORE_STATES,
  GORE_UNIT,
  ROCK_EFFECT_STATE,
  ROWS,
  RUBBLE_PIECES,
  TILE_SCALE,
  WALK_FRAMES,
  type RowSpec,
  cyclePhase,
  golemRowsFor,
  walkPose,
} from '../src/sprites/art/rockGolemFigure.js';
import { golemSlamImpactFrame, golemThrowReleaseFrame } from '../src/sprites/rockGolemTiming.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import {
  ROCK_GOLEM_GORE_PARTS,
  rockGolemReachableStates,
  type RockGolemSheet,
} from '../src/sprites/rockGolemSprite.js';

const INK_ALPHA_THRESHOLD = 24;
/**
 * Alpha above which a pixel is the golem itself rather than the soft contact
 * shadow it paints on the ground line. An anchor gate measured against ordinary
 * ink measures the shadow, which lands where the feet ought to be whether or
 * not they are there — and stays green while the figure floats.
 */
const SOLID_ALPHA_THRESHOLD = 200;
/** Clear pixels kept around the cell when measuring where the feet land. */
const GROUND_MEASURE_PAD = 48;
const CHANNELS = 4;
const ALPHA_OFFSET = 3;

const VARIANTS: readonly GolemVariant[] = ['regular', 'boss'];
const EFFECT_FIGURES: readonly FigureDef[] = [GOLEM_ROCK_FIGURE, GOLEM_ROCK_BURST_FIGURE];

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

/**
 * Fails a gate whose filtered loop ran zero times.
 *
 * Most gates below narrow before they measure — planted frames only, loop rows
 * only, frames that hold the boulder only — and a narrowing that matches
 * nothing leaves a green gate that examined nothing. Every filtering loop here
 * counts what it looked at and ends with a call to this.
 */
function failUnlessMeasured(gateId: string, measured: number, what: string): void {
  for (const failure of nothingMeasuredFailures(measured, what)) fail(gateId, failure);
}

// ── Painted-cell helpers ─────────────────────────────────────────────────────

const cellByKey = new Map<string, Canvas>();

function cellOf(def: FigureDef, state: string, frame: number): Canvas {
  const key = `${def.id}:${state}[${frame}]`;
  const cached = cellByKey.get(key);
  if (cached !== undefined) return cached;
  const cell = bakeFigureCell(def, state, frame);
  cellByKey.set(key, cell);
  return cell;
}

function alphaOf(cell: Canvas): Uint8ClampedArray {
  const { data } = cell.getContext('2d').getImageData(0, 0, cell.width, cell.height);
  const alpha = new Uint8ClampedArray(cell.width * cell.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * CHANNELS + ALPHA_OFFSET];
  return alpha;
}

/** Mean absolute alpha difference between two cells, 0..255. */
function frameDelta(def: FigureDef, state: string, a: number, b: number): number {
  const alphaA = alphaOf(cellOf(def, state, a));
  const alphaB = alphaOf(cellOf(def, state, b));
  let total = 0;
  for (let i = 0; i < alphaA.length; i++) total += Math.abs(alphaA[i] - alphaB[i]);
  return total / alphaA.length;
}

function inkCount(alpha: Uint8ClampedArray): number {
  let count = 0;
  for (const value of alpha) if (value >= INK_ALPHA_THRESHOLD) count++;
  return count;
}

function coverageDelta(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let differing = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] >= INK_ALPHA_THRESHOLD !== b[i] >= INK_ALPHA_THRESHOLD) differing++;
  }
  return differing;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)];
}

function framesOf(def: FigureDef, state: string, gateId: string): number {
  const declared = def.states.get(state);
  if (declared === undefined) {
    fail(gateId, `${def.id} declares no state "${state}" to measure`);
    return 0;
  }
  return declared.frames;
}

// ── G1 structure ─────────────────────────────────────────────────────────────

/**
 * How much of its cell the thrown boulder fills.
 *
 * Its cell is square, centred and hand-declared rather than measured, because
 * the caller passes an impact point straight through and does no offset
 * arithmetic — half a scaled frame is not half a tile. The rock is drawn at a
 * fixed fraction of a tile inside it, so the padding is the price of that
 * anchor, and at 16 KB a cell it is a price worth paying.
 */
const ROCK_EFFECT_MIN_FILL = 0.06;

function gateStructure(): void {
  for (const variant of VARIANTS) {
    for (const failure of figureStructuralFailures(GOLEM_FIGURES[variant])) fail('G1', failure);
  }
  for (const failure of figureStructuralFailures(GOLEM_ROCK_FIGURE, {
    minInkAreaShare: ROCK_EFFECT_MIN_FILL,
  })) {
    fail('G1', failure);
  }
  for (const failure of figureStructuralFailures(GOLEM_ROCK_BURST_FIGURE)) fail('G1', failure);
}

// ── G3 the feet stand on the tile ────────────────────────────────────────────

/**
 * How far a planted frame's lowest solid pixel may sit from the bottom edge of
 * the golem's own tile box, in tiles.
 *
 * Measured against `tileY + tileScale` — the box the runtime hangs a health bar
 * and a name plate off, and the box the Y-sort keys on — rather than against
 * the ground line the painter computes, because a gate whose reference is
 * derived from the constant under test moves both of its sides at once and
 * passes for any value.
 *
 * Measured on a padded canvas rather than inside the cell, because the declared
 * cell clears the widest pose by only a few pixels: measured inside it, art
 * that has slipped off its anchor is clipped away before it can be counted and
 * this gate could only ever repeat what G1 already said.
 */
const GROUND_BAND_TILES = 0.25;

const GROUNDED_ACTIONS: readonly string[] = ['idle', 'walk', 'slam', 'stomp', 'throw'];
const VIEW_SUFFIXES: readonly string[] = ['', '_side', '_away'];

function lowestSolidRowUnclipped(def: FigureDef, state: string, frame: number): number {
  const canvas = createCanvas(
    def.frameWidth + GROUND_MEASURE_PAD * 2,
    def.frameHeight + GROUND_MEASURE_PAD * 2,
  );
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.translate(GROUND_MEASURE_PAD, GROUND_MEASURE_PAD);
  def.paintFrame(asGameContext(ctx), state, frame);
  ctx.restore();
  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * CHANNELS + ALPHA_OFFSET] < SOLID_ALPHA_THRESHOLD) continue;
      return y - GROUND_MEASURE_PAD;
    }
  }
  return Number.NaN;
}

function gateGroundLine(): void {
  let framesMeasured = 0;
  for (const variant of VARIANTS) {
    const def = GOLEM_FIGURES[variant];
    const tileBottom = def.tileY + TILE_SCALE;
    const band = GROUND_BAND_TILES * TILE_SCALE;
    for (const action of GROUNDED_ACTIONS) {
      for (const suffix of VIEW_SUFFIXES) {
        const state = `${action}${suffix}`;
        const frames = framesOf(def, state, 'G3');
        for (let frame = 0; frame < frames; frame++) {
          const lowest = lowestSolidRowUnclipped(def, state, frame);
          if (Number.isNaN(lowest)) {
            fail('G3', `${def.id}.${state}[${frame}] painted no solid pixel at all`);
            continue;
          }
          framesMeasured++;
          if (Math.abs(lowest - tileBottom) <= band) continue;
          fail(
            'G3',
            `${def.id}.${state}[${frame}] has its lowest solid pixel on row ${lowest}, ` +
              `${((lowest - tileBottom) / TILE_SCALE).toFixed(2)} tiles from the bottom of its ` +
              `own tile box at ${tileBottom} — the golem is not standing on the tile it occupies`,
          );
        }
      }
    }
  }
  failUnlessMeasured('G3', framesMeasured, 'planted frames');
}

// ── G4 loops close ───────────────────────────────────────────────────────────

/**
 * How much bigger the seam may be than the loop's *largest* ordinary step.
 *
 * Against the largest step rather than the median, because a walk's steps are
 * all large and a median-relative limit saturates on one: measured with
 * `frameDelta`, these fourteen loop rows top out at seam/median 1.95 while
 * shipped, so a median limit loose enough to pass them is loose enough to pass
 * a row running one and a half cycles. Against the largest step the shipped
 * rows top out at 1.01 (the boss's stunned row) and a 1.5-cycle row measures
 * 2.03, so the two separate cleanly.
 *
 * This is an art-drift limit and nothing more. It catches a pose that has been
 * moved so the seam no longer lines up with the rest of the row; it cannot be
 * relied on to see a wrong *cycle count*, because a stretched cycle raises the
 * ordinary steps faster than it raises the wrap on most rows — half of these
 * fall *below* their shipped ratio under a 1.5-turn mutation. That is what the
 * phase-mapping half of this gate is for.
 */
const MAX_SEAM_VS_LARGEST_STEP = 1.15;
/**
 * How small the seam may be relative to the loop's *median* step.
 *
 * The other half of the same defect: a cycle sampled at
 * `frame / (frameCount - 1)` makes the last frame identical to the first, so
 * the seam goes to nothing and the loop spends a frame of its budget standing
 * still. That reads as a hitch rather than a pop, and nothing else here catches
 * it.
 *
 * The denominator is the median and never the narrowest step, because a row may
 * legitimately hold two adjacent frames nearly still — the golem's side idle
 * breathes over a silhouette that barely changes — and a narrowest-step
 * denominator near zero collapses the floor into `seam >= 0`. The shipped rows
 * sit at 0.95 and above of their median.
 */
const MIN_SEAM_VS_MEDIAN_STEP = 0.4;

function loopRowsOf(variant: GolemVariant): readonly RowSpec[] {
  return golemRowsFor(variant).filter((row) => row.kind === 'loop');
}

/** Floating-point slack on a phase span that has to be exactly one turn. */
const PHASE_EPSILON = 1e-9;
const ONE_TURN = 1;

/**
 * The ceiling, in the units the defect is actually in.
 *
 * A row that covers more or less than one turn pops once per cycle, and the
 * pixels cannot be trusted to say so — see `MAX_SEAM_VS_LARGEST_STEP`. What is
 * checkable without a threshold to tune is the mapping every loop row is
 * sampled through: it has to advance in equal steps and land exactly one turn
 * on from where it started.
 */
function failUnlessOneEvenTurn(id: string, frameCount: number): void {
  const span = cyclePhase(frameCount, frameCount) - cyclePhase(0, frameCount);
  if (Math.abs(span - ONE_TURN) > PHASE_EPSILON) {
    fail(
      'G4',
      `${id} spends ${span.toFixed(4)} of a turn over its ${frameCount} frames rather than ` +
        'exactly one, so the frame after the last does not land on the first',
    );
  }
  const firstStep = cyclePhase(1, frameCount) - cyclePhase(0, frameCount);
  let stepsMeasured = 0;
  for (let frame = 1; frame < frameCount; frame++) {
    stepsMeasured++;
    const step = cyclePhase(frame, frameCount) - cyclePhase(frame - 1, frameCount);
    if (Math.abs(step - firstStep) <= PHASE_EPSILON) continue;
    fail(
      'G4',
      `${id} advances ${step.toFixed(4)} of a turn into frame ${frame} against ` +
        `${firstStep.toFixed(4)} at the start of the row; an unevenly sampled loop stutters`,
    );
  }
  failUnlessMeasured('G4', stepsMeasured, `phase steps of ${id}`);
}

function gateLoopClosure(): void {
  let loopsMeasured = 0;
  for (const variant of VARIANTS) {
    const def = GOLEM_FIGURES[variant];
    for (const row of loopRowsOf(variant)) {
      if (row.frameCount < 3) continue;
      loopsMeasured++;
      failUnlessOneEvenTurn(`${def.id}.${row.name}`, row.frameCount);
      const steps: number[] = [];
      for (let frame = 1; frame < row.frameCount; frame++) {
        steps.push(frameDelta(def, row.name, frame - 1, frame));
      }
      const seam = frameDelta(def, row.name, row.frameCount - 1, 0);
      const typical = median(steps);
      const largest = Math.max(...steps);
      if (largest <= 0 || typical <= 0) {
        fail('G4', `${def.id}.${row.name} does not move at all between any two frames`);
        continue;
      }
      if (seam > largest * MAX_SEAM_VS_LARGEST_STEP) {
        fail(
          'G4',
          `${def.id}.${row.name} does not close: the seam step is ${seam.toFixed(1)} against a ` +
            `largest in-cycle step of ${largest.toFixed(1)} ` +
            `(${(seam / largest).toFixed(2)}×, limit ${MAX_SEAM_VS_LARGEST_STEP}×)`,
        );
        continue;
      }
      if (seam >= typical * MIN_SEAM_VS_MEDIAN_STEP) continue;
      fail(
        'G4',
        `${def.id}.${row.name} moves only ${seam.toFixed(1)} across its seam against a median ` +
          `in-cycle step of ${typical.toFixed(1)} ` +
          `(${(seam / typical).toFixed(2)}×, floor ${MIN_SEAM_VS_MEDIAN_STEP}×) — the row ends ` +
          'on a repeat of the frame it starts on and spends a frame of the cycle held still',
      );
    }
  }
  failUnlessMeasured('G4', loopsMeasured, 'looping rows');
}

// ── G5 nothing snaps ─────────────────────────────────────────────────────────

/** A step far above the row's median is a snapped joint or a draw-order flip. */
const CONTINUITY_RATIO = 3.8;

function gateContinuity(): void {
  let rowsMeasured = 0;
  for (const variant of VARIANTS) {
    const def = GOLEM_FIGURES[variant];
    for (const row of golemRowsFor(variant)) {
      if (row.frameCount < 4) continue;
      const steps: number[] = [];
      for (let frame = 1; frame < row.frameCount; frame++) {
        steps.push(frameDelta(def, row.name, frame - 1, frame));
      }
      const typical = median(steps);
      if (typical <= 0) {
        fail('G5', `${def.id}.${row.name} does not move at all between any two frames`);
        continue;
      }
      rowsMeasured++;
      steps.forEach((step, index) => {
        const frame = index + 1;
        if (row.declaredSpikes?.includes(frame) === true) return;
        if (step <= typical * CONTINUITY_RATIO) return;
        fail(
          'G5',
          `${def.id}.${row.name}[${frame}] jumps ${step.toFixed(1)} against a median of ` +
            `${typical.toFixed(1)} (limit ${CONTINUITY_RATIO}×) — a snapped joint, or a spike ` +
            'that belongs in declaredSpikes',
        );
      });
    }
  }
  failUnlessMeasured('G5', rowsMeasured, 'animation rows');
}

// ── G6 the walk does not moonwalk ────────────────────────────────────────────

/**
 * A planted foot must track backward monotonically through stance. A foot that
 * reverses mid-stance is the moonwalk, and it is invisible in a still.
 */
function gateFootSlide(): void {
  let plantedFrames = 0;
  for (const side of [-1, 1]) {
    let previous: number | null = null;
    let planted = 0;
    for (let frame = 0; frame < WALK_FRAMES; frame++) {
      const pose = walkPose(cyclePhase(frame, WALK_FRAMES));
      const legPose = side < 0 ? pose.legL : pose.legR;
      if (legPose.lift > 0) {
        previous = null;
        continue;
      }
      planted++;
      plantedFrames++;
      const foot = golemFootPoint('side', pose, side, 'regular').x;
      if (previous !== null && foot > previous + FOOT_SLIDE_EPSILON) {
        fail(
          'G6',
          `the ${side < 0 ? 'left' : 'right'} foot moves forward at walk frame ${frame} while ` +
            `planted (${previous.toFixed(4)} → ${foot.toFixed(4)}) — that is a moonwalk`,
        );
      }
      previous = foot;
    }
    if (planted < 2) {
      fail('G6', `the walk never plants the ${side < 0 ? 'left' : 'right'} foot for two frames`);
    }
  }
  failUnlessMeasured('G6', plantedFrames, 'planted walk frames');
}

/** Forward drift below this is the solver's own rounding, not a slide. */
const FOOT_SLIDE_EPSILON = 1e-6;

// ── G7 the legs never clamp ──────────────────────────────────────────────────

/**
 * Hip-to-ankle span must stay inside the two bones on every frame. One clamped
 * frame locks the leg straight and the next tuck snaps it back, which is the
 * hop.
 */
const REACH_HEADROOM = 0.995;

function gateLegReach(): void {
  const limit = (THIGH_REACH + SHIN_REACH) * REACH_HEADROOM;
  let framesMeasured = 0;
  for (const row of ROWS) {
    if (row.pose === null) continue;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const pose = row.pose(frame);
      for (const side of [-1, 1]) {
        framesMeasured++;
        const foot = golemFootPoint(row.view, pose, side, 'boss');
        const hip = golemHipPoint(row.view, pose, side, 'boss');
        const span = Math.hypot(foot.x - hip.x, foot.y - hip.y);
        if (span <= limit) continue;
        fail(
          'G7',
          `${row.name}[${frame}] stretches the ${side < 0 ? 'left' : 'right'} leg to ` +
            `${span.toFixed(3)} against a reach of ${limit.toFixed(3)}`,
        );
      }
    }
  }
  failUnlessMeasured('G7', framesMeasured, 'posed legs');
}

// ── G8 the boulder is held ───────────────────────────────────────────────────

/**
 * While the golem is holding a rock, both fists must actually be on it. The
 * painter places the boulder on the fists' midpoint, so this proves the two
 * hands have not drifted so far apart that the rock floats between them.
 *
 * Every view, not just one: the fists are furthest apart head-on and nearly
 * coincident in profile, and the boulder is painted on their midpoint in all
 * three — so checking one view proves nothing about the other two.
 */
function gateGrip(): void {
  let heldFrames = 0;
  const throwRows = ROWS.filter((row) => row.name.startsWith('throw'));
  if (throwRows.length === 0) fail('G8', 'there is no throw row to measure');
  for (const row of throwRows) {
    if (row.pose === null) {
      fail('G8', `${row.name} has no pose`);
      continue;
    }
    let held = 0;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const pose = row.pose(frame);
      if (pose.rockRadius <= 0) continue;
      held++;
      heldFrames++;
      const left = golemArmChain(row.view, pose, -1, 'regular').fist;
      const right = golemArmChain(row.view, pose, 1, 'regular').fist;
      const centre = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
      const gap = Math.hypot(right.x - centre.x, right.y - centre.y);
      if (gap <= pose.rockRadius + FIST_RADIUS) continue;
      fail(
        'G8',
        `${row.name}[${frame}] holds a rock of radius ${pose.rockRadius.toFixed(3)} with fists ` +
          `${gap.toFixed(3)} from its centre — the boulder floats between the hands`,
      );
    }
    if (held < 2) fail('G8', `${row.name} never shows the rock in hand for two frames`);
  }
  failUnlessMeasured('G8', heldFrames, 'frames holding a boulder');
}

// ── G9 it reads as stone ─────────────────────────────────────────────────────

/**
 * A golem has to read as an assembly of stones. That is measurable: seams are
 * near-black pixels *inside* the silhouette, and a figure painted as one smooth
 * mass has almost none. This is the gate that stops the next edit quietly
 * turning it back into a grey man.
 */
const SEAM_LUMA_MAX = 60;
const MIN_SEAM_FRACTION = 0.04;
const SEAM_GATE_ROWS: readonly string[] = ['idle', 'idle_side'];
const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;
const BODY_ALPHA_THRESHOLD = 200;

function gateStoneSeams(): void {
  let cellsMeasured = 0;
  for (const variant of VARIANTS) {
    const def = GOLEM_FIGURES[variant];
    for (const state of SEAM_GATE_ROWS) {
      if (framesOf(def, state, 'G9') === 0) continue;
      const cell = cellOf(def, state, 0);
      const { data } = cell.getContext('2d').getImageData(0, 0, cell.width, cell.height);
      let body = 0;
      let seam = 0;
      for (let i = 0; i < data.length; i += CHANNELS) {
        if (data[i + ALPHA_OFFSET] < BODY_ALPHA_THRESHOLD) continue;
        body++;
        if (data[i] * LUMA_R + data[i + 1] * LUMA_G + data[i + 2] * LUMA_B <= SEAM_LUMA_MAX) {
          seam++;
        }
      }
      if (body === 0) {
        fail('G9', `${def.id}.${state}[0] has no solid body pixels to measure`);
        continue;
      }
      cellsMeasured++;
      const fraction = seam / body;
      console.log(
        `  G9 ${def.id}.${state}[0] is ${(fraction * 100).toFixed(1)}% seam pixels of ` +
          `${body} body pixels (floor ${(MIN_SEAM_FRACTION * 100).toFixed(0)}%)`,
      );
      if (fraction >= MIN_SEAM_FRACTION) continue;
      fail(
        'G9',
        `${def.id}.${state}[0] is only ${(fraction * 100).toFixed(1)}% seam pixels (need ` +
          `${(MIN_SEAM_FRACTION * 100).toFixed(0)}%) — the stones have merged into one mass`,
      );
    }
  }
  failUnlessMeasured('G9', cellsMeasured, 'seam-checked cells');
}

// ── G10 the attacks land when the runtime says they do ───────────────────────

/**
 * The impact frame the runtime lands damage on has to be the frame that shows
 * the impact.
 *
 * An earlier version of this gate compared the row table's frame counts against
 * the timing module the row table is *built from*, which is `X !== X` and can
 * never fail. What is checked now: on the declared impact frame both fists are
 * at their lowest of the whole row, and they are within a fist's width of the
 * ground. On the declared release frame the rock has just left the hands.
 */
const SLAM_GROUND_CLEARANCE = FIST_RADIUS * 1.35;

function gateSlamReachesGround(): void {
  const impact = golemSlamImpactFrame();
  let rowsMeasured = 0;
  const slamRows = ROWS.filter((row) => row.name.startsWith('slam'));
  if (slamRows.length === 0) fail('G10', 'there is no slam row to measure');
  for (const row of slamRows) {
    if (row.pose === null) {
      fail('G10', `${row.name} has no pose`);
      continue;
    }
    rowsMeasured++;
    let lowestFrame = 0;
    let lowest = -Infinity;
    for (let frame = 0; frame < row.frameCount; frame++) {
      // Both fists, not one. They happen to share a pose object today, so
      // checking either would pass — but the whole attack is named for driving
      // *both* down, and an asymmetric edit would sail past a one-fist check
      // with a hand still in the air.
      const pose = row.pose(frame);
      const highestOfPair = Math.min(
        golemArmChain(row.view, pose, -1, 'regular').fist.y,
        golemArmChain(row.view, pose, 1, 'regular').fist.y,
      );
      if (highestOfPair <= lowest) continue;
      lowest = highestOfPair;
      lowestFrame = frame;
    }
    if (lowestFrame !== impact) {
      fail(
        'G10',
        `${row.name} drives its fists lowest on frame ${lowestFrame} but the runtime lands the ` +
          `hit on frame ${impact} — the damage and the pose describe different moments`,
      );
    }
    // The ground line is where the feet are; the fist has to arrive there, not
    // at the chest, or the attack is a shove with dust at the ankles.
    const clearance = -lowest;
    if (clearance <= SLAM_GROUND_CLEARANCE) continue;
    fail(
      'G10',
      `${row.name} stops its fists ${clearance.toFixed(3)} tiles above the ground (limit ` +
        `${SLAM_GROUND_CLEARANCE.toFixed(3)}) — that is not a ground slam`,
    );
  }
  failUnlessMeasured('G10', rowsMeasured, 'slam rows');
}

function gateThrowReleasesOnTime(): void {
  const release = golemThrowReleaseFrame();
  // A release fraction under half a frame would index frame -1 below, which
  // reads as an empty pose rather than as the nonsense it is.
  if (release < 1) {
    fail('G10', `the throw release resolves to frame ${release}, which has no frame before it`);
    return;
  }
  let rowsMeasured = 0;
  const throwRows = ROWS.filter((row) => row.name.startsWith('throw'));
  if (throwRows.length === 0) fail('G10', 'there is no throw row to measure');
  for (const row of throwRows) {
    if (row.pose === null) {
      fail('G10', `${row.name} has no pose`);
      continue;
    }
    rowsMeasured++;
    if (row.pose(release - 1).rockRadius <= 0) {
      fail(
        'G10',
        `${row.name} is already empty-handed on frame ${release - 1}, the frame before the ` +
          'runtime spawns the projectile — the boulder vanishes before it is thrown',
      );
    }
    if (row.pose(release).rockRadius <= 0) continue;
    fail(
      'G10',
      `${row.name} still holds the boulder on frame ${release}, the frame the runtime spawns ` +
        'the projectile — it would be drawn twice',
    );
  }
  failUnlessMeasured('G10', rowsMeasured, 'throw rows');
}

// ── G11 warm-row memory ──────────────────────────────────────────────────────

const BYTES_PER_PIXEL = 4;
const BYTES_PER_MEGABYTE = 1024 * 1024;

/**
 * The hard ceiling for one warm animation row.
 *
 * The sheets these figures replaced had a whole-texture budget. A painted
 * figure is admitted to the cache a row at a time, so the number that decides
 * whether it fits is the widest row's warm bytes rather than the sum of all of
 * them — and it has to stay well inside the cache's own per-figure ceiling,
 * because the three views of an attack are prewarmed together.
 *
 * Read the printed line as the measurement and the limit as a runaway stop:
 * the widest shipped row is the boss's throw at 0.99 MB, a third of the budget,
 * so it takes the throw growing from 14 frames to about 45 — or the boss cell
 * growing half again in both directions — before this says anything. It is
 * mutation-tested at 64 frames and does fail there; it is not a tight budget.
 */
const ROW_BUDGET_MEGABYTES = 3;

function gateWarmRowSize(): void {
  let statesMeasured = 0;
  for (const def of [GOLEM_FIGURES.regular, GOLEM_FIGURES.boss, ...EFFECT_FIGURES]) {
    const cellBytes = def.frameWidth * def.frameHeight * BYTES_PER_PIXEL;
    let widestState = '';
    let widestFrames = 0;
    let totalFrames = 0;
    for (const [state, declared] of def.states) {
      statesMeasured++;
      totalFrames += declared.frames;
      if (declared.frames <= widestFrames) continue;
      widestFrames = declared.frames;
      widestState = state;
    }
    if (widestFrames === 0) continue;
    const megabytes = (widestFrames * cellBytes) / BYTES_PER_MEGABYTE;
    const allWarm = (totalFrames * cellBytes) / BYTES_PER_MEGABYTE;
    console.log(
      `  G11 warm row: ${def.id}.${widestState} is ${megabytes.toFixed(2)} MB of a ` +
        `${ROW_BUDGET_MEGABYTES} MB budget; all ${def.states.size} states warm at once would ` +
        `be ${allWarm.toFixed(2)} MB`,
    );
    if (megabytes <= ROW_BUDGET_MEGABYTES) continue;
    fail(
      'G11',
      `${def.id}.${widestState} warms to ${megabytes.toFixed(2)} MB against a budget of ` +
        `${ROW_BUDGET_MEGABYTES} MB`,
    );
  }
  failUnlessMeasured('G11', statesMeasured, 'declared states');
}

// ── G12 the frozen recentring offsets ────────────────────────────────────────

/** Distance a re-measured offset may sit from the frozen one, in piece units. */
const GORE_RECENTRE_TOLERANCE = 0.005;
/** Scratch canvas for measuring a piece about its own origin. */
const GORE_MEASURE_SPAN = 512;
const GORE_MEASURE_ORIGIN = GORE_MEASURE_SPAN / 2;

/**
 * The offsets that pull each rubble piece's ink to the centre of its cell.
 *
 * They are the one number in these figures that cannot be computed where it is
 * used: `BodyPartGoreSystem` spins a piece about the centre of its ink, and
 * finding that centre means painting the piece and reading the pixels back.
 * They are frozen in the figure module and re-measured here, once per variant —
 * the table is shared between the two builds, and re-measuring both is what
 * proves that sharing is still true rather than assuming it.
 *
 * Checked in both directions. A frozen offset with no piece left to own it is a
 * dead entry that reads like a maintained measurement, and the next agent to
 * add a piece by that name inherits a number measured off art that is gone.
 */
function gateGoreRecentre(): void {
  const canvas = createCanvas(GORE_MEASURE_SPAN, GORE_MEASURE_SPAN);
  const ctx = canvas.getContext('2d');
  const paintedStates = new Set(RUBBLE_PIECES.map((piece) => piece.state));
  for (const frozenState of GORE_RECENTRE.keys()) {
    if (paintedStates.has(frozenState)) continue;
    fail(
      'G12',
      `GORE_RECENTRE freezes an offset for "${frozenState}", which nothing paints any more`,
    );
  }
  let piecesMeasured = 0;
  for (const variant of VARIANTS) {
    for (const piece of RUBBLE_PIECES) {
      piecesMeasured++;
      ctx.clearRect(0, 0, GORE_MEASURE_SPAN, GORE_MEASURE_SPAN);
      ctx.save();
      ctx.translate(GORE_MEASURE_ORIGIN, GORE_MEASURE_ORIGIN);
      ctx.scale(GORE_UNIT, GORE_UNIT);
      piece.paint(asGameContext(ctx), variant);
      ctx.restore();
      const { data } = ctx.getImageData(0, 0, GORE_MEASURE_SPAN, GORE_MEASURE_SPAN);
      let minX = GORE_MEASURE_SPAN;
      let maxX = -1;
      let minY = GORE_MEASURE_SPAN;
      let maxY = -1;
      for (let y = 0; y < GORE_MEASURE_SPAN; y++) {
        for (let x = 0; x < GORE_MEASURE_SPAN; x++) {
          if (data[(y * GORE_MEASURE_SPAN + x) * CHANNELS + ALPHA_OFFSET] < INK_ALPHA_THRESHOLD) {
            continue;
          }
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      if (maxX < 0) {
        fail('G12', `${variant}'s ${piece.state} painted nothing when measured about its centre`);
        continue;
      }
      const measuredX = (GORE_MEASURE_ORIGIN - (minX + maxX) / 2) / GORE_UNIT;
      const measuredY = (GORE_MEASURE_ORIGIN - (minY + maxY) / 2) / GORE_UNIT;
      const frozen = GORE_RECENTRE.get(piece.state);
      if (frozen === undefined) {
        fail('G12', `the figure freezes no recentring offset for ${piece.state}`);
        continue;
      }
      const gap = Math.hypot(measuredX - frozen.x, measuredY - frozen.y);
      if (gap <= GORE_RECENTRE_TOLERANCE) continue;
      fail(
        'G12',
        `${variant}'s ${piece.state} ink centres at (${measuredX}, ${measuredY}) but the figure ` +
          `freezes (${frozen.x}, ${frozen.y}) — the piece will orbit rather than tumble; paste ` +
          'the measured pair',
      );
    }
  }
  failUnlessMeasured('G12', piecesMeasured, 'rubble pieces');
}

// ── G13 the rubble can be told apart and can spin ────────────────────────────

/**
 * How much of the smaller piece's ink two rubble pieces must differ by.
 *
 * Deliberately low, and a duplicate check rather than a legibility one: a
 * shattered golem is eight chunks of the same stone, so unlike a creature's
 * limbs the pieces are *meant* to resemble each other, and the closest real
 * pair sits under a fifth apart. What must never happen is two entries that
 * paint the same shape in the same place, which is a piece nobody can see is
 * missing.
 */
const MIN_PIECE_DISTINCTION_SHARE = 0.1;

function gateGoreDistinctness(): void {
  let pairsMeasured = 0;
  for (const variant of VARIANTS) {
    const def = GOLEM_FIGURES[variant];
    for (let a = 0; a < GORE_STATES.length; a++) {
      for (let b = a + 1; b < GORE_STATES.length; b++) {
        const first = alphaOf(cellOf(def, GORE_STATES[a], 0));
        const second = alphaOf(cellOf(def, GORE_STATES[b], 0));
        pairsMeasured++;
        const smaller = Math.min(inkCount(first), inkCount(second));
        if (smaller === 0) {
          fail('G13', `${def.id}.${GORE_STATES[a]} or ${GORE_STATES[b]} painted nothing`);
          continue;
        }
        const share = coverageDelta(first, second) / smaller;
        if (share >= MIN_PIECE_DISTINCTION_SHARE) continue;
        fail(
          'G13',
          `${def.id}'s ${GORE_STATES[a]} and ${GORE_STATES[b]} differ by only ` +
            `${(share * 100).toFixed(1)}% of the smaller piece's ink — one of them is a ` +
            'duplicate of the other and a body part is silently missing',
        );
      }
    }
  }
  failUnlessMeasured('G13', pairsMeasured, 'rubble piece pairs');
}

/**
 * A rubble piece is spun about the centre of its own cell by
 * `BodyPartGoreSystem`, so it sweeps the cell's *inscribed* circle. A cell wide
 * enough but not tall enough still shears the piece halfway through its tumble
 * — a defect that only shows in play, on one frame out of a spin.
 */
function gateGoreRotationClearance(): void {
  let piecesMeasured = 0;
  for (const variant of VARIANTS) {
    const def = GOLEM_FIGURES[variant];
    const centreX = def.frameWidth / 2;
    const centreY = def.frameHeight / 2;
    const radius = Math.min(centreX, centreY);
    for (const state of GORE_STATES) {
      const alpha = alphaOf(cellOf(def, state, 0));
      let worst = 0;
      let found = false;
      for (let y = 0; y < def.frameHeight; y++) {
        for (let x = 0; x < def.frameWidth; x++) {
          if (alpha[y * def.frameWidth + x] < INK_ALPHA_THRESHOLD) continue;
          found = true;
          worst = Math.max(worst, Math.hypot(x + 0.5 - centreX, y + 0.5 - centreY));
        }
      }
      if (!found) {
        fail('G13', `${def.id}.${state} painted nothing to measure`);
        continue;
      }
      piecesMeasured++;
      if (worst <= radius) continue;
      fail(
        'G13',
        `${def.id}.${state} reaches ${worst.toFixed(1)} px from its cell's centre, past the ` +
          `${radius.toFixed(1)} px it may spin through — it is sheared partway round a tumble`,
      );
    }
  }
  failUnlessMeasured('G13', piecesMeasured, 'rubble pieces');
}

// ── G14 the effects move ─────────────────────────────────────────────────────

/**
 * The share of a frame's own ink an effect must change between adjacent frames.
 *
 * Both effect rows are short loops of a fast thing — a boulder tumbling, a
 * shatter expanding — and an oscillation sampled at or past its own frequency
 * comes out as a freeze or a strobe that is invisible in the code that made it.
 */
const MIN_EFFECT_STEP_SHARE = 0.05;

function gateEffectMotion(): void {
  let stepsMeasured = 0;
  for (const def of EFFECT_FIGURES) {
    const frames = framesOf(def, ROCK_EFFECT_STATE, 'G14');
    if (frames < 2) {
      fail('G14', `${def.id} declares ${frames} frames, which cannot animate`);
      continue;
    }
    const reference = inkCount(alphaOf(cellOf(def, ROCK_EFFECT_STATE, 0)));
    for (let frame = 1; frame < frames; frame++) {
      stepsMeasured++;
      const step = coverageDelta(
        alphaOf(cellOf(def, ROCK_EFFECT_STATE, frame - 1)),
        alphaOf(cellOf(def, ROCK_EFFECT_STATE, frame)),
      );
      const share = step / reference;
      if (share >= MIN_EFFECT_STEP_SHARE) continue;
      fail(
        'G14',
        `${def.id}[${frame}] differs from the frame before it by only ` +
          `${(share * 100).toFixed(1)}% of its ink, under the ` +
          `${MIN_EFFECT_STEP_SHARE * 100}% a moving effect shows`,
      );
    }
  }
  failUnlessMeasured('G14', stepsMeasured, 'effect frame steps');
}

// ── G15 the runtime's own names ──────────────────────────────────────────────

/**
 * Every state name the runtime can ask for is one the figure paints.
 *
 * `stateFor` builds its pose names by template literal, `BodyPartGoreSystem`
 * spawns its rubble by name, and the prewarm helpers name whole rows. Every one
 * of those paths answers a name the figure does not declare by returning
 * without drawing anything and saying nothing: a whole facing of the boss, or a
 * body part, simply never appears.
 *
 * The names are imported from the runtime module rather than scraped out of its
 * source, so a rename cannot make this gate quietly stop matching.
 *
 * The two effect figures are not checked here and cannot be: they declare their
 * single row *from* `ROCK_EFFECT_STATE`, and every caller asks for it by the
 * same import, so a check of one against the other is a constant compared with
 * itself and could not fail whatever the row was called.
 */
const SHEET_OF: Readonly<Record<GolemVariant, RockGolemSheet>> = {
  regular: 'rock_golem',
  boss: 'rock_golem_boss',
};

function gateRuntimeStateNames(): void {
  let buildsMeasured = 0;
  for (const variant of VARIANTS) {
    const def = GOLEM_FIGURES[variant];
    buildsMeasured++;
    for (const failure of missingStateFailures(
      def,
      ROCK_GOLEM_GORE_PARTS,
      'ROCK_GOLEM_GORE_PARTS',
    )) {
      fail('G15', failure);
    }
    for (const failure of missingStateFailures(
      def,
      rockGolemReachableStates(SHEET_OF[variant]),
      `rockGolemReachableStates('${SHEET_OF[variant]}')`,
    )) {
      fail('G15', failure);
    }
  }
  failUnlessMeasured('G15', buildsMeasured, 'builds');
}

/** Runs every gate and returns one message per failure. */
export function rockGolemGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gateGroundLine();
  gateLoopClosure();
  gateContinuity();
  gateFootSlide();
  gateLegReach();
  gateGrip();
  gateStoneSeams();
  gateSlamReachesGround();
  gateThrowReleasesOnTime();
  gateWarmRowSize();
  gateGoreRecentre();
  gateGoreDistinctness();
  gateGoreRotationClearance();
  gateEffectMotion();
  gateRuntimeStateNames();
  return [...failures];
}
