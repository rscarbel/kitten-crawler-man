/**
 * The Mantid family's art gates, covering the bounty boss and the crony
 * mantis that escorts him.
 *
 * Neither creature has a baked sheet to inspect any more, so every invariant
 * the old bake enforced by throwing before it wrote a PNG is enforced here
 * instead: the anatomy gates measure the rig's own constants, and the pixel
 * gates measure cells painted from `MANTID_FIGURE` and `MANTIS_FIGURE` exactly
 * the way the runtime cache bakes them — supersampled and downsampled — so what
 * is measured is what the game blits.
 *
 * Both builds are gated, not just the boss: they are drawn by one engine at two
 * scales, and a change that only breaks the small one is exactly the change
 * nobody looks for.
 *
 * Failures accumulate rather than throwing one at a time, so one run reports
 * everything that is wrong. A gate that cannot find the row or state it names
 * fails loudly, and so does one whose filtered loop examined nothing.
 *
 * Run by the review harness: `npm run render:mantid`.
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
  FEMUR_LENGTH,
  FEMUR_SPINES,
  FORELIMB_SOCKET_ALONG,
  HEAD_DEPTH,
  HEAD_WIDTH,
  PRONOTUM_LENGTH,
  THORAX_RX,
  TIBIA_LENGTH,
  TIBIA_SPINES,
  type LegPose,
  restPose,
} from '../src/sprites/art/mantidArt.js';
import { mantidGorePieces } from '../src/sprites/art/mantidGore.js';
import {
  GORE_STATES,
  MANTID_VARIANTS,
  SLASH_COCK_END,
  SLASH_SNAP_END,
  TILE_SCALE,
  type MantidVariant,
  type RowSpec,
  goreUnitOf,
  shotProgress,
} from '../src/sprites/art/mantidFigure.js';
import { mantidFigureOf } from '../src/sprites/art/mantidFigure.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import { MANTID_GORE_PARTS, mantidReachableStates } from '../src/sprites/mantidSprite.js';

const INK_ALPHA_THRESHOLD = 24;
/**
 * Alpha above which a pixel is the creature itself rather than the soft contact
 * shadow it paints on the ground line. An anchor gate measured against ordinary
 * ink measures the shadow, which lands where the feet ought to be whether or
 * not they are there — and stays green while the figure floats.
 */
const SOLID_ALPHA_THRESHOLD = 200;
/** Clear pixels kept around the cell when measuring where the feet land. */
const GROUND_MEASURE_PAD = 64;
const CHANNELS = 4;
const ALPHA_OFFSET = 3;

const failures: string[] = [];

function fail(id: string, message: string): void {
  failures.push(`${id}: ${message}`);
}

/**
 * Fails a gate whose filtered loop ran zero times.
 *
 * Most gates below narrow before they measure — looping rows only, one entry
 * per painted piece, one pair per row — and a narrowing that matches nothing
 * leaves a green gate that examined nothing. Every filtering loop here counts
 * what it looked at and ends with a call to this.
 */
function failUnlessMeasured(gateId: string, measured: number, what: string): void {
  for (const failure of nothingMeasuredFailures(measured, what)) fail(gateId, failure);
}

// ── Painted-cell helpers ─────────────────────────────────────────────────────

const alphaByCell = new Map<string, Uint8ClampedArray>();

/** One cell's alpha channel, baked as the runtime cache bakes it. */
function cellAlpha(def: FigureDef, state: string, frame: number): Uint8ClampedArray {
  const key = `${def.id}:${state}[${frame}]`;
  const cached = alphaByCell.get(key);
  if (cached !== undefined) return cached;
  const cell = bakeFigureCell(def, state, frame);
  const { data } = cell.getContext('2d').getImageData(0, 0, def.frameWidth, def.frameHeight);
  const alpha = new Uint8ClampedArray(def.frameWidth * def.frameHeight);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * CHANNELS + ALPHA_OFFSET];
  alphaByCell.set(key, alpha);
  return alpha;
}

function inkCount(alpha: Uint8ClampedArray): number {
  let count = 0;
  for (const value of alpha) if (value >= INK_ALPHA_THRESHOLD) count++;
  return count;
}

/** Count of pixels whose coverage differs between two frames. */
function coverageDelta(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let differing = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] >= INK_ALPHA_THRESHOLD !== b[i] >= INK_ALPHA_THRESHOLD) differing++;
  }
  return differing;
}

/**
 * The lowest row holding a pixel solid enough to be the animal, measured on a
 * canvas padded well past the cell on every side.
 *
 * Padded because the declared cell clears the widest pose by only a handful of
 * pixels: measured inside it, art that has slipped off its anchor is clipped
 * away before it can be measured, and the ground gate below could only ever
 * report what the clipping gate had already caught. The padding is in the
 * returned row, so the answer is still in cell coordinates.
 */
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

function framesOf(def: FigureDef, state: string, gateId: string): number {
  const declared = def.states.get(state);
  if (declared === undefined) {
    fail(gateId, `${def.id} declares no state "${state}" to measure`);
    return 0;
  }
  return declared.frames;
}

function figureOf(variant: MantidVariant): FigureDef {
  return mantidFigureOf(variant.id);
}

// ── G1 structure ─────────────────────────────────────────────────────────────

function gateStructure(): void {
  for (const variant of MANTID_VARIANTS) {
    for (const failure of figureStructuralFailures(figureOf(variant))) fail('G1', failure);
  }
}

// ── G2 anatomy ───────────────────────────────────────────────────────────────

/**
 * The thresholds the anatomy is held to.
 *
 * These are the only literals in this section on purpose: the *measurements*
 * are imported from `mantidArt.ts`, so moving a socket or shortening the
 * pronotum there fails the gate. Mirroring the measurements as local constants
 * too would quietly make every comparison two compile-time literals that could
 * never disagree.
 */
const MIN_FORELIMB_SOCKET_ALONG = 0.6;
const WALKING_LEG_COUNT = 4;
const MIN_PRONOTUM_TO_THORAX_RATIO = 1.5;
const MIN_HEAD_WIDTH_TO_DEPTH = 1.2;
const MIN_SPINES_PER_SEGMENT = 5;

/** Whether a pose field is a walking leg rather than a scalar or a raptorial. */
function isWalkingLeg(value: unknown): value is LegPose {
  if (typeof value !== 'object' || value === null) return false;
  const candidate: Record<string, unknown> = { ...value };
  return (
    typeof candidate.dx === 'number' &&
    typeof candidate.dy === 'number' &&
    typeof candidate.lift === 'number' &&
    typeof candidate.splay === 'number'
  );
}

/** Counts the walking legs the pose actually carries, so the gate is not a literal. */
function countWalkingLegs(): number {
  return Object.values(restPose()).filter(isWalkingLeg).length;
}

/**
 * G2 — geometric truths about the anatomy constants, checked before a pixel is
 * painted. Cheap, and the only thing standing between a refactor and a mantis
 * whose arms have quietly migrated onto its abdomen.
 */
function gateAnatomy(): void {
  // The single cue that sells the animal: the raptorial sockets sit on the far
  // end of the pronotum, right behind the head — not on the thorax with the
  // walking legs, and never on the abdomen.
  if (FORELIMB_SOCKET_ALONG < MIN_FORELIMB_SOCKET_ALONG) {
    fail(
      'G2',
      `the raptorial forelimbs socket ${FORELIMB_SOCKET_ALONG.toFixed(2)} along the pronotum; ` +
        `they belong past ${MIN_FORELIMB_SOCKET_ALONG}, just behind the head`,
    );
  }
  // Four walking legs, and only four. The forelimbs are not walking legs and
  // must never plant, so this counts the *pose*'s legs rather than a literal.
  const walkingLegCount = countWalkingLegs();
  if (walkingLegCount !== WALKING_LEG_COUNT) {
    fail('G2', `a mantis has ${WALKING_LEG_COUNT} walking legs, not ${walkingLegCount}`);
  }
  // The pronotum has to be long. It is the posture; a short one is a grasshopper.
  const pronotumToThorax = PRONOTUM_LENGTH / (THORAX_RX * 2);
  if (pronotumToThorax < MIN_PRONOTUM_TO_THORAX_RATIO) {
    fail(
      'G2',
      `the pronotum is only ${pronotumToThorax.toFixed(2)}x the leg-bearing thorax; a mantis ` +
        `carries at least ${MIN_PRONOTUM_TO_THORAX_RATIO}x`,
    );
  }
  // The head must be wider than it is deep or the triangle stops reading.
  const headWidthToDepth = HEAD_WIDTH / HEAD_DEPTH;
  if (headWidthToDepth < MIN_HEAD_WIDTH_TO_DEPTH) {
    fail(
      'G2',
      `the head is ${headWidthToDepth.toFixed(2)}x wider than deep; the mantis triangle needs ` +
        `at least ${MIN_HEAD_WIDTH_TO_DEPTH}x`,
    );
  }
  // The femur is the heavy segment and must out-mass the tibia that folds on it.
  if (FEMUR_LENGTH <= TIBIA_LENGTH) {
    fail('G2', 'the raptorial femur must be longer than the tibia that folds back along it');
  }
  // Spines on both closing edges, or the arms are just sticks.
  if (FEMUR_SPINES < MIN_SPINES_PER_SEGMENT || TIBIA_SPINES < MIN_SPINES_PER_SEGMENT) {
    fail(
      'G2',
      `both raptorial segments need at least ${MIN_SPINES_PER_SEGMENT} grasping spines ` +
        `(femur ${FEMUR_SPINES}, tibia ${TIBIA_SPINES})`,
    );
  }
}

// ── G3 the feet stand on the tile ────────────────────────────────────────────

/**
 * How far a planted frame's lowest solid pixel may sit from the bottom edge of
 * the creature's own tile box, in tiles.
 *
 * Measured against `tileY + tileScale` — the box the runtime hangs a health bar
 * and a name plate off — rather than against the ground line the painter
 * computes, because a gate whose reference is derived from the constant under
 * test moves both of its sides at once and passes for any value.
 *
 * The band is wide enough for a raised foot mid-stride and for the boss's
 * lunge, and far narrower than the half tile it takes for a creature to look
 * like it is standing in front of its own tile rather than on it.
 */
const GROUND_BAND_TILES = 0.25;

/** The rows whose feet are on the floor for every frame of them. */
const GROUNDED_ACTIONS: readonly string[] = ['idle', 'walk', 'slash'];
const VIEW_SUFFIXES: readonly string[] = ['', '_side', '_away'];

function groundedStates(): readonly string[] {
  return GROUNDED_ACTIONS.flatMap((action) => VIEW_SUFFIXES.map((suffix) => `${action}${suffix}`));
}

function gateGroundLine(): void {
  let framesMeasured = 0;
  for (const variant of MANTID_VARIANTS) {
    const def = figureOf(variant);
    const tileBottom = def.tileY + TILE_SCALE;
    const band = GROUND_BAND_TILES * TILE_SCALE;
    for (const state of groundedStates()) {
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
            `${((lowest - tileBottom) / TILE_SCALE).toFixed(2)} tiles from the bottom of its own ` +
            `tile box at ${tileBottom} — the animal is not standing on the tile it occupies`,
        );
      }
    }
  }
  failUnlessMeasured('G3', framesMeasured, 'planted frames');
}

// ── G4 loops close ───────────────────────────────────────────────────────────

/**
 * How much bigger the wrap from a loop's last frame to its first may be than
 * the largest step inside the loop.
 *
 * A cycle sampled at `frame / frameCount` closes by construction; one sampled
 * at `frame / (frameCount - 1)` repeats a frame and jolts. The comparison is
 * against the loop's own largest step rather than a pixel count, because the
 * two builds differ in size by a factor of three, and against the largest
 * rather than the median because these cycles are sinusoidal and their steps
 * are bimodal by nature.
 *
 * The sixteen shipped loops seam at 0.50 to 1.01 of their own widest step, so
 * this clears the art by a seventh. What it cannot see whatever it is set to is
 * a row running more than one cycle: over-running raises the ordinary steps by
 * the same factor as the seam, which takes the worst mutated row to 1.08 —
 * indistinguishable from the shipped 1.01. The phase check below is what holds
 * the cycle count.
 */
const LOOP_WRAP_TOLERANCE = 1.15;

/**
 * How small the wrap may be relative to the loop's *median* step.
 *
 * The other half of the same defect: sampling at `frame / (frameCount - 1)`
 * makes the last frame identical to the first, so the wrap goes to nothing and
 * the cycle spends a frame of its budget standing still.
 *
 * Measured against the median step rather than the narrowest one. A row may
 * legitimately hold two adjacent frames at the same coverage — a sibling figure
 * seen end-on has exactly that — and a narrowest step of zero collapses this
 * floor into `wrap >= 0`, which is true of every row there is. The rage pause is
 * the tightest shipped row at 0.78 of its own median step; the rest run 0.83 to
 * 1.88.
 */
const MIN_LOOP_WRAP_SHARE = 0.5;

/**
 * The float epsilon a loop row's sampled phases are held to.
 *
 * Every shipped row samples exact rationals, so this guards against binary
 * rounding rather than allowing the choreography any slack.
 */
const LOOP_PHASE_EPSILON = 1e-9;

/**
 * The failures for a loop row that does not sample exactly one turn of its cycle
 * in evenly spaced steps.
 *
 * This is the half of loop closure no pixel measurement can reach. A row whose
 * phase mapping runs a cycle and a half still seams cleanly by every ratio above,
 * because over-running scales the seam and the ordinary steps together. The cycle
 * count only exists in the phase the choreography samples at, which every loop
 * pose carries as its `time`.
 *
 * @param phaseAt The phase a frame is sampled at, straight off the row's pose.
 */
function loopPhaseFailures(
  label: string,
  frameCount: number,
  phaseAt: (frame: number) => number,
): string[] {
  const messages: string[] = [];
  const step = phaseAt(1) - phaseAt(0);
  for (let frame = 2; frame < frameCount; frame++) {
    const thisStep = phaseAt(frame) - phaseAt(frame - 1);
    if (Math.abs(thisStep - step) <= LOOP_PHASE_EPSILON) continue;
    messages.push(
      `${label} advances ${thisStep} of a cycle into frame ${frame} but ${step} into frame 1 — ` +
        'the loop is sampled unevenly, so it plays fast in one place and slow in another',
    );
    break;
  }
  const turnsCovered = step * frameCount;
  if (Math.abs(turnsCovered - 1) > LOOP_PHASE_EPSILON) {
    messages.push(
      `${label} covers ${turnsCovered} turns of its cycle over ${frameCount} frames rather than ` +
        'exactly one — a row that over-runs its cycle seams as cleanly as one that closes, so ' +
        'no pixel measurement can see this',
    );
  }
  return messages;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * The rows of a build that are authored as cycles.
 *
 * Taken off the variant's own row table by its declared kind rather than by
 * composing names and keeping the ones the figure happens to declare: a
 * name-composing filter drops a renamed row silently, which turns every gate
 * downstream of it green on a row nobody is measuring any more.
 */
function loopRowsOf(variant: MantidVariant): readonly RowSpec[] {
  return variant.rows.filter((row) => row.kind === 'loop');
}

function gateLoopClosure(): void {
  let loopsMeasured = 0;
  for (const variant of MANTID_VARIANTS) {
    const def = figureOf(variant);
    for (const row of loopRowsOf(variant)) {
      const frames = framesOf(def, row.name, 'G4');
      if (frames < 2) {
        fail('G4', `${def.id}.${row.name} declares ${frames} frames, which cannot be a loop`);
        continue;
      }
      loopsMeasured++;
      for (const failure of loopPhaseFailures(
        `${def.id}.${row.name}`,
        frames,
        (frame) => row.pose(frame).time,
      )) {
        fail('G4', failure);
      }
      const steps: number[] = [];
      for (let frame = 1; frame < frames; frame++) {
        steps.push(
          coverageDelta(cellAlpha(def, row.name, frame - 1), cellAlpha(def, row.name, frame)),
        );
      }
      const widestStep = Math.max(...steps);
      const typicalStep = median(steps);
      const wrap = coverageDelta(cellAlpha(def, row.name, frames - 1), cellAlpha(def, row.name, 0));
      if (wrap > widestStep * LOOP_WRAP_TOLERANCE) {
        fail(
          'G4',
          `${def.id}.${row.name} jumps ${wrap} px of coverage from its last frame back to its ` +
            `first, against a widest in-cycle step of ${widestStep} — the loop does not close`,
        );
        continue;
      }
      if (wrap >= typicalStep * MIN_LOOP_WRAP_SHARE) continue;
      fail(
        'G4',
        `${def.id}.${row.name} moves only ${wrap} px of coverage from its last frame back to ` +
          `its first, against a median in-cycle step of ${typicalStep} — the row ends on a ` +
          'repeat of the frame it starts on and spends a frame of the cycle held still',
      );
    }
  }
  failUnlessMeasured('G4', loopsMeasured, 'looping rows');
}

// ── G5 nothing is frozen ─────────────────────────────────────────────────────

/**
 * The share of a frame's own ink that must change between two adjacent frames
 * of a loop.
 *
 * Animation over the frame budget aliases: an oscillation sampled at or past
 * its own frequency comes out as a freeze or a strobe, and neither is visible
 * in the code that produced it. A loop with a pair of near-identical frames is
 * that failure caught in pixels.
 */
const MIN_LOOP_STEP_SHARE = 0.05;

/**
 * The share of a one-shot's ink its widest step must reach.
 *
 * A strike is mostly wind-up and recovery, so its *smallest* step is
 * legitimately tiny; what must exist is the snap. Measured on the widest step
 * for that reason.
 *
 * Re-derived from the shipped art rather than inherited: the six slash rows
 * peak at 0.51 to 0.68 of their ink, and a slash whose snap has been taken out
 * altogether — leaving nothing but the wind-up, which is the defect this is
 * about — still peaks at 0.22. The old 0.2 limit sat *under* that, so it passed
 * a strike with no strike in it; the wind-up was simply the louder neighbour.
 */
const MIN_SHOT_PEAK_SHARE = 0.4;

/**
 * The frames of a one-shot row whose step carries the snap.
 *
 * A share alone says the row moves a lot somewhere, which a big wind-up
 * satisfies on its own. The strike is a *moment*, and where that moment falls
 * is authored: the pose function eases through its snap window between
 * `SLASH_COCK_END` and `SLASH_SNAP_END` of the row's progress. So the widest
 * step has to be the step into a frame sampled inside that window.
 */
function snapFrames(frameCount: number): readonly number[] {
  const frames: number[] = [];
  for (let frame = 1; frame < frameCount; frame++) {
    const progress = shotProgress(frame, frameCount);
    if (progress > SLASH_COCK_END && progress <= SLASH_SNAP_END) frames.push(frame);
  }
  return frames;
}

function gateMotion(): void {
  let rowsMeasured = 0;
  let shotsMeasured = 0;
  for (const variant of MANTID_VARIANTS) {
    const def = figureOf(variant);
    for (const row of variant.rows) {
      const frames = framesOf(def, row.name, 'G5');
      if (frames < 2) continue;
      rowsMeasured++;
      const reference = inkCount(cellAlpha(def, row.name, 0));
      let widestStep = 0;
      let widestFrame = 0;
      let narrowestStep = Infinity;
      for (let frame = 1; frame < frames; frame++) {
        const step = coverageDelta(
          cellAlpha(def, row.name, frame - 1),
          cellAlpha(def, row.name, frame),
        );
        if (step > widestStep) {
          widestStep = step;
          widestFrame = frame;
        }
        narrowestStep = Math.min(narrowestStep, step);
      }
      if (row.kind === 'loop') {
        const share = narrowestStep / reference;
        if (share >= MIN_LOOP_STEP_SHARE) continue;
        fail(
          'G5',
          `${def.id}.${row.name} has two adjacent frames differing by only ` +
            `${(share * 100).toFixed(1)}% of its ink, under the ${MIN_LOOP_STEP_SHARE * 100}% a ` +
            'moving animal shows — the cycle has aliased into a hold',
        );
        continue;
      }
      const strikeFrames = snapFrames(frames);
      if (strikeFrames.length === 0) {
        fail(
          'G5',
          `${def.id}.${row.name} samples no frame inside its own snap window, so there is no ` +
            'frame for the strike to land on',
        );
        continue;
      }
      shotsMeasured++;
      const share = widestStep / reference;
      if (share < MIN_SHOT_PEAK_SHARE) {
        fail(
          'G5',
          `${def.id}.${row.name} never moves more than ${(share * 100).toFixed(1)}% of its ink ` +
            `between frames, under the ${MIN_SHOT_PEAK_SHARE * 100}% a raptorial snap shows — ` +
            'there is no strike in the strike',
        );
        continue;
      }
      if (strikeFrames.includes(widestFrame)) continue;
      fail(
        'G5',
        `${def.id}.${row.name} moves most into frame ${widestFrame}, outside the snap window ` +
          `(frames ${strikeFrames.join(', ')}) — the biggest moment in the row is not the ` +
          'strike',
      );
    }
  }
  failUnlessMeasured('G5', rowsMeasured, 'animation rows');
  failUnlessMeasured('G5', shotsMeasured, 'one-shot rows');
}

// ── G6 the rage pause is a warning ───────────────────────────────────────────

/**
 * How much of the idle's ink the rage pause must differ from it by.
 *
 * The one-second pause is the player's only warning before the flurry, and a
 * warning that looks like the idle is not a warning. The boss rears, throws his
 * wing cases up and opens both arms, so the two poses share very little.
 */
const MIN_RAGE_DISTINCTION_SHARE = 0.3;

function gateRageReadsApart(): void {
  let comparisons = 0;
  for (const variant of MANTID_VARIANTS) {
    const def = figureOf(variant);
    if (!def.states.has('rage_pause')) continue;
    const rageFrames = framesOf(def, 'rage_pause', 'G6');
    const idleFrames = framesOf(def, 'idle', 'G6');
    if (rageFrames === 0 || idleFrames === 0) continue;
    let closest = Infinity;
    let reference = 0;
    for (let rage = 0; rage < rageFrames; rage++) {
      for (let idle = 0; idle < idleFrames; idle++) {
        comparisons++;
        const delta = coverageDelta(
          cellAlpha(def, 'rage_pause', rage),
          cellAlpha(def, 'idle', idle),
        );
        if (delta >= closest) continue;
        closest = delta;
        reference = inkCount(cellAlpha(def, 'idle', idle));
      }
    }
    const share = closest / reference;
    if (share >= MIN_RAGE_DISTINCTION_SHARE) continue;
    fail(
      'G6',
      `${def.id}'s rage pause comes within ${(share * 100).toFixed(1)}% of an idle frame, ` +
        `under the ${MIN_RAGE_DISTINCTION_SHARE * 100}% it takes to read as a warning`,
    );
  }
  failUnlessMeasured('G6', comparisons, 'rage-against-idle frame pairs');
}

// ── G7 the pieces are told apart ─────────────────────────────────────────────

/**
 * How much of the smaller piece's ink two severed pieces must differ by.
 *
 * The exit criterion for the set is naming all eight from the in-game strip, and
 * two pieces that cover the same pixels cannot be named apart at 32 px whatever
 * their colouring.
 */
const MIN_PIECE_DISTINCTION_SHARE = 0.4;

function gateGoreDistinctness(): void {
  let pairsMeasured = 0;
  for (const variant of MANTID_VARIANTS) {
    const def = figureOf(variant);
    for (let a = 0; a < GORE_STATES.length; a++) {
      for (let b = a + 1; b < GORE_STATES.length; b++) {
        const first = cellAlpha(def, GORE_STATES[a], 0);
        const second = cellAlpha(def, GORE_STATES[b], 0);
        pairsMeasured++;
        const smaller = Math.min(inkCount(first), inkCount(second));
        if (smaller === 0) {
          fail('G7', `${def.id}.${GORE_STATES[a]} or ${GORE_STATES[b]} painted nothing`);
          continue;
        }
        const share = coverageDelta(first, second) / smaller;
        if (share >= MIN_PIECE_DISTINCTION_SHARE) continue;
        fail(
          'G7',
          `${def.id}'s ${GORE_STATES[a]} and ${GORE_STATES[b]} differ by only ` +
            `${(share * 100).toFixed(1)}% of the smaller piece's ink — they cannot be told ` +
            'apart at the size they render',
        );
      }
    }
  }
  failUnlessMeasured('G7', pairsMeasured, 'gore piece pairs');
}

// ── G8 the pieces can spin ───────────────────────────────────────────────────

/**
 * A gore piece is spun about the centre of its own cell by `BodyPartGoreSystem`,
 * so it sweeps the cell's *inscribed* circle. A cell wide enough but not tall
 * enough still shears the piece halfway through its tumble — a defect that only
 * shows in play, on one frame out of a spin, which is why it is measured here
 * rather than looked for.
 */
function gateGoreRotationClearance(): void {
  let piecesMeasured = 0;
  for (const variant of MANTID_VARIANTS) {
    const def = figureOf(variant);
    const centreX = def.frameWidth / 2;
    const centreY = def.frameHeight / 2;
    const radius = Math.min(centreX, centreY);
    for (const state of GORE_STATES) {
      const alpha = cellAlpha(def, state, 0);
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
        fail('G8', `${def.id}.${state} painted nothing to measure`);
        continue;
      }
      piecesMeasured++;
      if (worst <= radius) continue;
      fail(
        'G8',
        `${def.id}.${state} reaches ${worst.toFixed(1)} px from its cell's centre, past the ` +
          `${radius.toFixed(1)} px it may spin through — it is sheared partway round a tumble`,
      );
    }
  }
  failUnlessMeasured('G8', piecesMeasured, 'gore pieces');
}

// ── G9 the frozen recentring offsets ─────────────────────────────────────────

/** Distance a re-measured offset may sit from the frozen one, in piece units. */
const GORE_RECENTRE_TOLERANCE = 0.005;
/** Scratch canvas for measuring a piece about its own origin. */
const GORE_MEASURE_SPAN = 1024;
const GORE_MEASURE_ORIGIN = GORE_MEASURE_SPAN / 2;

/**
 * G9 — the offsets that pull each piece's ink to the centre of its cell.
 *
 * They are the one number in these figures that cannot be computed where it is
 * used: `BodyPartGoreSystem` spins a piece about the centre of its ink, and
 * finding that centre means painting the piece and reading the pixels back.
 * They are frozen in the figure module and re-measured here, once per variant
 * because the two builds do not draw the same shapes, so a redrawn piece cannot
 * silently start orbiting.
 *
 * Checked in both directions. A frozen offset with no piece left to own it is a
 * dead entry that reads like a maintained measurement, and the next agent to
 * add a piece by that name inherits a number measured off art that is gone.
 */
function gateGoreRecentre(): void {
  const canvas = createCanvas(GORE_MEASURE_SPAN, GORE_MEASURE_SPAN);
  const ctx = canvas.getContext('2d');
  const pieces = mantidGorePieces();
  const paintedStates = new Set(pieces.map((piece) => piece.state));
  let piecesMeasured = 0;

  for (const variant of MANTID_VARIANTS) {
    const goreUnit = goreUnitOf(variant);
    for (const frozenState of variant.goreRecentre.keys()) {
      if (paintedStates.has(frozenState)) continue;
      fail(
        'G9',
        `${variant.id} freezes a recentring offset for "${frozenState}", which nothing paints ` +
          'any more',
      );
    }
    for (const piece of pieces) {
      piecesMeasured++;
      ctx.clearRect(0, 0, GORE_MEASURE_SPAN, GORE_MEASURE_SPAN);
      ctx.save();
      ctx.translate(GORE_MEASURE_ORIGIN, GORE_MEASURE_ORIGIN);
      ctx.scale(goreUnit, goreUnit);
      piece.paint(asGameContext(ctx), variant.build);
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
        fail(
          'G9',
          `${variant.id}'s ${piece.state} painted nothing at all when measured about its own ` +
            'centre',
        );
        continue;
      }
      const measuredX = (GORE_MEASURE_ORIGIN - (minX + maxX) / 2) / goreUnit;
      const measuredY = (GORE_MEASURE_ORIGIN - (minY + maxY) / 2) / goreUnit;
      const frozen = variant.goreRecentre.get(piece.state);
      if (frozen === undefined) {
        fail('G9', `${variant.id} freezes no recentring offset for ${piece.state}`);
        continue;
      }
      const gap = Math.hypot(measuredX - frozen.x, measuredY - frozen.y);
      if (gap <= GORE_RECENTRE_TOLERANCE) continue;
      fail(
        'G9',
        `${variant.id}'s ${piece.state} ink centres at (${measuredX}, ${measuredY}) but the ` +
          `figure freezes (${frozen.x}, ${frozen.y}) — the piece will orbit rather than ` +
          'tumble; paste the measured pair',
      );
    }
  }
  failUnlessMeasured('G9', piecesMeasured, 'gore pieces');
}

// ── G10 warm-row memory ──────────────────────────────────────────────────────

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
 * Read the printed line as the measurement and the limit as a runaway stop: the
 * widest shipped row is the boss's slash at 1.94 MB, so it takes that row
 * growing from 9 frames to 14 before this says anything. It is mutation-tested
 * at 16 frames and does fail there; it is not a tight budget.
 */
const ROW_BUDGET_MEGABYTES = 3;

/**
 * G10 — the widest warm row's memory, reported whether or not it passes.
 *
 * Measured over every state the figure declares rather than over the pose rows
 * alone: the cache does not know a gore piece from a walk cycle, and a gore
 * state that grew frames would otherwise be memory nothing accounts for.
 */
function gateWarmRowSize(): void {
  let statesMeasured = 0;
  for (const variant of MANTID_VARIANTS) {
    const def = figureOf(variant);
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
      `  G10 warm row: ${def.id}.${widestState} is ${megabytes.toFixed(2)} MB of a ` +
        `${ROW_BUDGET_MEGABYTES} MB budget; all ${def.states.size} states warm at once would ` +
        `be ${allWarm.toFixed(2)} MB`,
    );
    if (megabytes <= ROW_BUDGET_MEGABYTES) continue;
    fail(
      'G10',
      `${def.id}.${widestState} warms to ${megabytes.toFixed(2)} MB against a budget of ` +
        `${ROW_BUDGET_MEGABYTES} MB`,
    );
  }
  failUnlessMeasured('G10', statesMeasured, 'declared states');
}

// ── G11 the runtime's own names ──────────────────────────────────────────────

/**
 * G11 — every state name the runtime can ask for is one the figure paints.
 *
 * `stateFor` builds its pose names by template literal, `BodyPartGoreSystem`
 * spawns its pieces by name, and the prewarm helpers name whole rows. Every one
 * of those paths answers a name the figure does not declare by returning
 * without drawing anything and saying nothing: a whole facing of the boss, or a
 * body part, simply never appears.
 *
 * The names are imported from the runtime module rather than scraped out of its
 * source, so a rename cannot make this gate quietly stop matching.
 */
function gateRuntimeStateNames(): void {
  let buildsMeasured = 0;
  for (const variant of MANTID_VARIANTS) {
    const def = figureOf(variant);
    buildsMeasured++;
    for (const failure of missingStateFailures(def, MANTID_GORE_PARTS, 'MANTID_GORE_PARTS')) {
      fail('G11', failure);
    }
    for (const failure of missingStateFailures(
      def,
      mantidReachableStates(variant.id),
      `mantidReachableStates('${variant.id}')`,
    )) {
      fail('G11', failure);
    }
  }
  failUnlessMeasured('G11', buildsMeasured, 'builds');
}

/** Runs every gate and returns one message per failure. */
export function mantidGateFailures(): string[] {
  failures.length = 0;
  gateStructure();
  gateAnatomy();
  gateGroundLine();
  gateLoopClosure();
  gateMotion();
  gateRageReadsApart();
  gateGoreDistinctness();
  gateGoreRotationClearance();
  gateGoreRecentre();
  gateWarmRowSize();
  gateRuntimeStateNames();
  return [...failures];
}
