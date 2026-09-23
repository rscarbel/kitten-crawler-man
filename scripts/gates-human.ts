/**
 * Carl's art gates.
 *
 * These gates enforce sheet-shape invariants — a pose that fits its cell, a
 * strike that lands on the frame the hit is scored on — directly against
 * cells painted from `HUMAN_FIGURE`, baked exactly the way the runtime cache
 * bakes them, plus pose-stream checks that measure the rig itself and need no
 * pixels at all.
 *
 * Failures accumulate rather than throwing one at a time, so one run reports
 * everything that is wrong. A gate that cannot find the row it names fails
 * loudly, and so does one whose filtered loop examined nothing: a lookup that
 * quietly returns nothing turns a whole gate module green while measuring
 * nothing.
 *
 * Run by the review harness: `npm run render:human`.
 */

import { type Canvas, createCanvas } from 'canvas';

import { PLAYER_SPEED, TILE_SIZE, WADE_SPEED_FACTOR } from '../src/core/constants.js';
import { HUMAN_STATUS_FIGURE_BOX, HumanPlayer } from '../src/creatures/HumanPlayer.js';
import { Goblin } from '../src/creatures/Goblin.js';
import { type Mob } from '../src/creatures/Mob.js';
import { Rat } from '../src/creatures/Rat.js';
import { makeStun } from '../src/core/StatusEffect.js';
import {
  figureByteBudgetFor,
  IDLE_FRAMES_BEFORE_RELEASE,
} from '../src/sprites/figure/figureFrameCache.js';
import { getSmushStats, SMUSH_DEF } from '../src/abilities/smush.js';
import { HUMANOID_NPC_SCALE } from '../src/sprites/humanoidScale.js';
import { generatePersonAppearance } from '../src/sprites/person/PersonAppearance.js';
import { drawPerson } from '../src/sprites/person/drawPerson.js';
import { bakeFigureCell, paintFigureCell } from './figureSheet.js';
import { asGameContext } from './nodeGameContext.js';
import {
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
} from './figureGates.js';
import {
  firstImpactFrame,
  GROUND_OFFSET_IN_TILE,
  HUMAN_FIGURE,
  HUMAN_ROW_NAMES,
  HUMAN_ROW_TABLE,
  HUMAN_ROWS,
  humanRowOf,
  type HumanRowName,
  ORIGIN_X,
  ORIGIN_Y,
  TILE_X,
  TILE_Y,
  type HumanGait,
  type HumanRowMeta,
  type HumanRowRole,
  type StrikeReachLimb,
  type RowSpec,
} from '../src/sprites/art/humanFigure.js';
import {
  HUMAN_CELL_PX_PER_UNIT,
  HUMAN_SCALE,
  TILE_CENTRE_FRACTION,
  TILE_SCALE,
} from '../src/sprites/art/human/figureScale.js';
import { STOMP_DOWN_IMPACT } from '../src/sprites/art/human/strikesDown.js';
import { SMUSH_HOP_PRESS_FRAMES, SMUSH_PRESS_FRAMES } from '../src/sprites/art/human/stomps.js';
import {
  RUN_FRAMES,
  SMUSH_IMPACT_FRAME,
  TICKS_PER_SECOND,
  WALK_FRAMES,
} from '../src/sprites/art/human/timing.js';
import {
  groundPxPerGaitFrame,
  type HumanJointProbe,
  type ProbedArm,
  type ProbedLeg,
  probeHumanJoints,
  TRAVEL_DIRECTION,
  floorDriftPerFrameCellPx,
} from '../src/sprites/art/human/probe.js';
import { type Pt } from '../src/sprites/art/carlArt.js';
import { type BareSegment, bareSegmentEdges } from '../src/sprites/art/carl/limbs.js';
import {
  CAST_SHADOW_TONE,
  type CarlComposeOptions,
  drawCarlBack,
  drawCarlFront,
  drawCarlSide,
  OUTLINE_PX,
} from '../src/sprites/art/carl/figure.js';
import { COTTON, LEATHER, SKIN } from '../src/sprites/art/carl/palette.js';
import {
  buildSkeleton,
  type CarlPose,
  type CarlView,
  FULL_UPPER_ARM,
  poseAsDrawn,
  VIEWS,
} from '../src/sprites/art/carl/rig.js';
import { drawHead, headAngle, profileEyeCentre } from '../src/sprites/art/carl/head.js';
import { drawJacket } from '../src/sprites/art/carl/torso.js';
import { FOREARM_LENGTH, HEAD_RY, UPPER_ARM_LENGTH } from '../src/sprites/art/carl/proportions.js';
import {
  ALWAYS_DRAWN_ROWS,
  HUMAN_ATTACK_ROWS,
  type HumanRowSelection,
  OPENING_STRIKE_ROWS,
  rowFrameHolds,
  rowLengthInTicks,
  strikeWindUpFrames,
  viewForFacing,
} from '../src/sprites/humanSprite.js';
import {
  DEFAULT_HUMAN_APPEARANCE,
  dressedPose,
  gauntletFormAt,
  type HumanAppearance,
  humanFigureWearing,
  HUMAN_RIGHT_PUNCH_ROWS,
} from '../src/sprites/art/human/appearance.js';
import { type GauntletForm } from '../src/sprites/art/carl/gear.js';
import { type FigureDef } from '../src/sprites/figure/figureDef.js';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import {
  COMBO_WINDOW_TICKS,
  cycleRow,
  FAR_REACH_SHARE,
  gaitRadiansPerPx,
} from '../src/sprites/humanAnimator.js';
import { RUN_GROUND_PER_CYCLE_PX } from '../src/sprites/art/human/locomotion.js';
import {
  FALL_SPANS,
  fightReactionSpans,
  type HumanWarmSpan,
} from '../src/sprites/humanReactions.js';

// Carl's painter composes each cell on scratch surfaces of its own, which
// `allocCanvas` makes with `document.createElement('canvas')` outside a browser.
installCanvasGlobals();

const INK_ALPHA_THRESHOLD = 24;
const SOLID_ALPHA_THRESHOLD = 200;
const CHANNELS = 4;
const ALPHA_OFFSET = 3;
const OPAQUE_ALPHA = 255;

const { frameWidth, frameHeight } = HUMAN_FIGURE;

interface GateFailure {
  readonly id: string;
  readonly message: string;
  /** The row the failure is about, when it is about one; what per-row pending keys on. */
  readonly row?: HumanRowName;
}

const failures: GateFailure[] = [];

/**
 * Gates that measure a defect the figure still has, by design, until the work
 * that fixes it lands. A failure from one of these is printed loudly as
 * `PENDING` but does not fail the run; a gate in this set that passes prints a
 * notice to take it out, because a pending gate that has gone green is one
 * nobody is watching any more.
 *
 * Each gate leaves this set when its defect is fixed, and the set must be
 * empty when Carl's figure is finished: every entry here is a known way the
 * art is still wrong.
 */
export const PENDING_GATES: ReadonlySet<string> = new Set<string>();

/** Rows one gate is not yet held to, and why. */
interface PendingRows {
  readonly roles: readonly HumanRowRole[];
  readonly names: readonly HumanRowName[];
  readonly why: string;
}

/**
 * Per-row pending: the gate blocks on every row but these, whose failures are
 * printed as `PENDING` instead. Narrower than {@link PENDING_GATES} on
 * purpose — a whole gate made pending for the rows still being authored stops
 * watching the finished ones too, and a regression in the run or the idle
 * would go by as one more pending line.
 *
 * Every entry is a known way the art is still wrong, and the map must be empty
 * when Carl's figure is finished. An entry whose rows have all gone green
 * prints a notice to take it out.
 */
export const PENDING_ROWS: ReadonlyMap<string, PendingRows> = new Map<string, PendingRows>();

function isPendingRow(id: string, row: HumanRowName | undefined): boolean {
  const pending = PENDING_ROWS.get(id);
  if (pending === undefined || row === undefined) return false;
  const { role }: HumanRowMeta = HUMAN_ROW_TABLE[row];
  return pending.names.includes(row) || (role !== undefined && pending.roles.includes(role));
}

/** Decimal places a reported reach or tile position is printed to. */
const REACH_DIGITS = 3;
const TILE_DIGITS = 4;

function fail(id: string, message: string, row?: HumanRowName): void {
  failures.push(row === undefined ? { id, message } : { id, message, row });
}

/**
 * Fails a gate whose filtered loop ran zero times.
 *
 * Most gates below narrow before they measure — standing rows only, looping
 * rows only, the striking limb only — and a narrowing that matches nothing
 * leaves a green gate that examined nothing. Every filtering loop here counts
 * what it looked at and ends with a call to this.
 */
function failUnlessMeasured(gateId: string, measured: number, what: string): void {
  for (const failure of nothingMeasuredFailures(measured, what)) fail(gateId, failure);
}

// ── Painted-cell helpers ─────────────────────────────────────────────────────

/**
 * The outfit the pixel gates paint Carl in, and its figure: the default
 * unless a run names another. Every outfit is a figure of its own, and each
 * one's cells must hold to the same gates.
 */
let gateAppearance: HumanAppearance = DEFAULT_HUMAN_APPEARANCE;
let gateFigure: FigureDef = HUMAN_FIGURE;

const alphaByCell = new Map<string, Uint8ClampedArray>();

/** One cell's alpha channel, baked as the runtime cache bakes it. */
function cellAlpha(
  state: string,
  frame: number,
  figure: FigureDef = gateFigure,
): Uint8ClampedArray {
  const key = `${figure.id}/${state}[${frame}]`;
  const cached = alphaByCell.get(key);
  if (cached !== undefined) return cached;
  const cell = bakeFigureCell(figure, state, frame);
  const { data } = cell.getContext('2d').getImageData(0, 0, frameWidth, frameHeight);
  const alpha = new Uint8ClampedArray(frameWidth * frameHeight);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * CHANNELS + ALPHA_OFFSET];
  alphaByCell.set(key, alpha);
  return alpha;
}

interface InkStats {
  count: number;
  centroidX: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function inkStatsOf(alpha: Uint8ClampedArray, threshold = INK_ALPHA_THRESHOLD): InkStats {
  let count = 0;
  let sumX = 0;
  let minX = frameWidth;
  let maxX = -1;
  let minY = frameHeight;
  let maxY = -1;
  for (let y = 0; y < frameHeight; y++) {
    for (let x = 0; x < frameWidth; x++) {
      if (alpha[y * frameWidth + x] < threshold) continue;
      count++;
      sumX += x;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { count, centroidX: count === 0 ? 0 : sumX / count, minX, maxX, minY, maxY };
}

/** Pixels that changed between two cells, as a share of the larger cell's ink. */
function frameDelta(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let changed = 0;
  for (let i = 0; i < a.length; i++) {
    const wasInk = a[i] >= INK_ALPHA_THRESHOLD;
    const isInk = b[i] >= INK_ALPHA_THRESHOLD;
    if (wasInk !== isInk) changed++;
  }
  return changed;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function rowNamed(name: string, gateId: string): RowSpec | null {
  const row = humanRowOf(name);
  if (row === undefined) {
    fail(gateId, `there is no row named "${name}" — the gate below it measured nothing`);
    return null;
  }
  return row;
}

// ── G1: structure ────────────────────────────────────────────────────────────

function gateStructure(): void {
  for (const failure of figureStructuralFailures(gateFigure)) fail('G1', failure);
}

// ── G2: the cell geometry still describes the painted figure ─────────────────

/**
 * How far his soles and his centreline may sit from where the cell geometry
 * says they are, in cell pixels. Two or three pixels of a 64-px art tile:
 * loose enough that a downsampling difference between node-canvas builds
 * cannot fire it, far too tight to hide a redraw that moved him in his cell.
 */
const GROUND_TOLERANCE_PX = 4;
const CENTRELINE_TOLERANCE_PX = 6;

const STANDING_ROWS = ['idle', 'idle_side', 'idle_away'] as const;

/**
 * G2 — the art still stands on the ground line the cell geometry declares.
 *
 * It cannot catch a wrong `tileX`, `tileY` or `GROUND_OFFSET_IN_TILE`, and does
 * not claim to: `paintFrame` derives its paint origin from the very same
 * expression this gate builds its ground line from, so both sides move together.
 * Dropping `GROUND_OFFSET_IN_TILE` from 0.9 to 0.7 leaves this green, and moving
 * `tileY` 20px is caught by the clipping gate rather than by this one — his cell
 * is padded tightly enough that any translation big enough to fail an anchor
 * check runs off the edge first. No gate here checks those three numbers
 * directly; only the blind image review does.
 *
 * What it does catch is a redraw that raised his feet or shifted him inside his
 * cell — the art drifting off its own anchor — which is re-measured from painted
 * ink here.
 *
 * The feet are measured against the solid-alpha threshold so the soft contact
 * shadow under him does not count as the lowest ink and quietly satisfy it.
 */
function gateCellGeometry(): void {
  const groundY = TILE_Y + TILE_SCALE * GROUND_OFFSET_IN_TILE;
  const tileCentreX = TILE_X + TILE_SCALE / 2;
  let framesMeasured = 0;
  for (const name of STANDING_ROWS) {
    const row = rowNamed(name, 'G2');
    if (row === null) continue;
    const solid = inkStatsOf(cellAlpha(row.name, 0), SOLID_ALPHA_THRESHOLD);
    if (solid.count === 0) {
      fail('G2', `${name}[0] paints no solid ink at all`);
      continue;
    }
    framesMeasured++;
    const drop = Math.abs(solid.maxY - groundY);
    if (drop > GROUND_TOLERANCE_PX) {
      fail(
        'G2',
        `${name}[0] has its lowest solid ink at y=${solid.maxY} against a ground line of ` +
          `${groundY} (tileY ${TILE_Y} + ${GROUND_OFFSET_IN_TILE} of a ${TILE_SCALE}px tile) — ` +
          `${drop.toFixed(1)}px off, limit ${GROUND_TOLERANCE_PX}`,
      );
    }
    const offCentre = Math.abs(inkStatsOf(cellAlpha(row.name, 0)).centroidX - tileCentreX);
    if (offCentre > CENTRELINE_TOLERANCE_PX) {
      fail(
        'G2',
        `${name}[0] has its ink centred ${offCentre.toFixed(1)}px from the tile centre ` +
          `(tileX ${TILE_X} + half of ${TILE_SCALE}), limit ${CENTRELINE_TOLERANCE_PX}`,
      );
    }
  }
  failUnlessMeasured('G2', framesMeasured, 'standing frames');
}

// ── G3: a loop closes ────────────────────────────────────────────────────────

/**
 * The most a closing loop's seam may exceed the row's own largest ordinary step.
 *
 * A cycle that closes makes the wrap from last frame to first just another step
 * of the same cycle, so the largest step inside the row is the only scale that
 * describes it. Measured over his six loops with the ink threshold this module
 * uses, the shipped seams run 0.720–1.000 of their largest in-cycle step, the
 * three idles sitting exactly at 1.000 because their seam *is* the largest step.
 * 1.15 is that plus 15%, which is all a deterministic painter needs.
 *
 * It is an art-drift check and nothing more: it cannot see how many turns a row
 * covers, because over-running the cycle raises the ordinary steps faster than
 * it raises the seam. `CYCLE_CLOSE_TOLERANCE_PX` below is what holds the cycle
 * count.
 *
 * A ceiling built from the row's *median* step instead of its largest cannot
 * fail: his idles wrap at 2.20–2.38× their own median as shipped, so a cycle
 * sampled over 1.5 turns would still sit comfortably under a 2.1× median
 * ceiling. Against the largest-step ceiling here that same mis-sampling
 * measures up to 1.846, and a cycle stopping short at 0.7 of a turn measures
 * up to 3.967 — both caught by 1.15.
 */
const LOOP_SEAM_CEILING = 1.15;
/**
 * How far the frame *after* a loop's last one may differ from its first, in
 * pixels. Zero: the shipped art closes exactly, so anything at all is a defect.
 *
 * This is the clause that carries the cycle count, and it exists because the
 * seam ratios cannot: over-running a cycle raises the ordinary steps faster than
 * it raises the seam, so a row sampled over 1.5 turns measures a *cleaner* wrap
 * than the shipped art does and no ceiling value separates them. Asking the
 * painter for one frame past the row's end is what settles it instead — the
 * painter takes a frame index, so the frame the row would play next if it kept
 * counting must paint the identical cell. That holds exactly when the phase the
 * row covers is a whole number of turns, which is what makes it a loop; it
 * holds for the two-turn idle bobs as well as the single-turn walks, and it
 * fails on both a cycle running 1.5 turns and one sampled over `frameCount - 1`
 * so its last frame repeats its first.
 *
 * Deliberately weaker than "the pose function is periodic in the frame count":
 * several rows drive a channel at half the row's own frequency — a `sin` of half
 * the cycle angle — so the poses only agree again at the whole turn, which is
 * the only place the row ever wraps.
 */
const CYCLE_CLOSE_TOLERANCE_PX = 0;
/**
 * The fewest frames a loop may spend on one turn of its own cycle.
 *
 * The closure check above pins the row to a *whole* number of turns but says
 * nothing about how many, so doubling every row's phase — `(frame * 2) /
 * frameCount` — still closes and slips through it, through both seam ratios and
 * through the continuity gate. What it actually does is halve the sampling rate,
 * which is the Nyquist failure a frame count is chosen to avoid.
 *
 * Deliberately *not* the sibling form of this check, "no interior frame may
 * reproduce frame 0". That is false of this art: measured over the loop rows
 * here, the head-on and profile idles reproduce frame 0 exactly at frame 4 of 8
 * and Donut's dance at frame 6 of 12, because those rows run two whole turns of
 * their oscillation each. Turn *count* is not the invariant; frames per turn is.
 * Shipped, the first exact repeat lands at 4, 6, 8, 12 or 16 frames, so 4 is the
 * floor the art already sits on, and it is an integer structural quantity rather
 * than a measured one — a row divides its cycle evenly or it does not, and
 * nothing can drift 4 into 3. Under a doubled phase every one of those halves,
 * and the rows sitting at 4 fall to 2.
 */
const MIN_FRAMES_PER_CYCLE_TURN = 4;
/**
 * The least a closing loop's seam may be, against the row's median step.
 *
 * A row sampled at `frame / (frameCount - 1)` instead of `frame / frameCount`
 * paints a last frame identical to its first: the cycle then spends a whole
 * frame held still, the seam goes to exactly zero, and every ceiling-only seam
 * gate stays green on it. The denominator is the median rather than the
 * narrowest step because two adjacent frames can legitimately be byte-identical,
 * which would collapse the floor into `seam >= 0`. His shipped loops wrap at
 * 0.914–2.379 of their median step, so 0.5 is far below any of them and still
 * fires the moment a seam collapses.
 */
const LOOP_SEAM_FLOOR = 0.5;

/** G3 — a loop must close: not a pop across its seam, and not a held frame. */
function gateLoopClosure(): void {
  let loopsMeasured = 0;
  for (const row of HUMAN_ROWS) {
    if (row.kind !== 'loop') continue;
    loopsMeasured++;
    const cells = Array.from({ length: row.frameCount }, (_unused, frame) =>
      cellAlpha(row.name, frame),
    );
    const steps: number[] = [];
    for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
    const seam = frameDelta(cells[cells.length - 1], cells[0]);
    const typical = median(steps);
    if (typical === 0) {
      // A loop whose frames are pixel-identical has aliased into a still — the
      // Nyquist failure a frame count is chosen to avoid — and the seam
      // comparison below has no scale left to measure against.
      fail(
        'G3',
        `${row.name} does not move at all: its median frame-to-frame step is 0px, so the row ` +
          'has aliased into a still',
      );
      continue;
    }
    const largestStep = Math.max(...steps);
    const ceiling = largestStep * LOOP_SEAM_CEILING;
    if (seam > ceiling) {
      fail(
        'G3',
        `${row.name} pops across its loop seam: last→first differs by ${seam}px against a ` +
          `largest in-cycle step of ${largestStep}px (ceiling ${ceiling.toFixed(0)}px) — the ` +
          'cycle does not end where it began',
      );
    }
    const floor = typical * LOOP_SEAM_FLOOR;
    if (seam < floor) {
      fail(
        'G3',
        `${row.name} barely moves across its loop seam: last→first differs by ${seam}px against ` +
          `a median step of ${typical}px (floor ${floor.toFixed(0)}px) — the row holds still for ` +
          'a frame at the wrap, which is what sampling the cycle over frameCount-1 does',
      );
    }

    const closure = frameDelta(cells[0], cellAlpha(row.name, row.frameCount));
    if (closure > CYCLE_CLOSE_TOLERANCE_PX) {
      fail(
        'G3',
        `${row.name} does not close: the frame after its last one paints ${closure}px unlike ` +
          `${row.name}[0] (tolerance ${CYCLE_CLOSE_TOLERANCE_PX}px), so the phase this row ` +
          'covers is not a whole number of turns and the wrap is a jump',
      );
    }

    const framesPerTurn = cells.findIndex(
      (cell, frame) => frame > 0 && frameDelta(cells[0], cell) === 0,
    );
    if (framesPerTurn >= 0 && framesPerTurn < MIN_FRAMES_PER_CYCLE_TURN) {
      fail(
        'G3',
        `${row.name} is back on its first pose by frame ${framesPerTurn}, so it spends ` +
          `${framesPerTurn} frames on a turn of its cycle (floor ${MIN_FRAMES_PER_CYCLE_TURN}) — ` +
          'the row is sampled below its own rate and will strobe rather than animate',
      );
    }
  }
  failUnlessMeasured('G3', loopsMeasured, 'looping rows');
}

// ── G4: motion is continuous ─────────────────────────────────────────────────

const LOOP_STEP_LIMIT = 2.6;
const ONE_SHOT_STEP_LIMIT = 4;
/**
 * How far the worst step may exceed the *second* worst.
 *
 * Any cycle driven off a sine has a bimodal step distribution — fast steps
 * around the zero crossings, slow ones at the extremes — so its median is the
 * slow step and a perfectly smooth row scores several times it. What
 * distinguishes a snap is that it is a *lone* outlier, and the clause is only
 * allowed to speak while the runner-up is itself an ordinary step: the
 * commonest rig defect is a wrong-sign keyframe, which teleports a limb out on
 * one frame and back on the next and so produces *two* huge steps. Uncapped,
 * the defect would then be sizing its own allowance.
 */
const STEP_VS_RUNNER_UP = 1.35;

/**
 * The stamp is a declared spike. Both stomp rows drive a foot from over his own
 * waist to flat on the floor across the impact frame, and that single step is
 * the whole blow — flattening it to satisfy a continuity threshold would remove
 * the only frames a player reads as an impact. G6 is what holds the spike to
 * exactly that step.
 */
function isDeclaredSpike(row: string, step: number): boolean {
  const stomp = STOMP_ROWS.find((candidate) => candidate.row === row);
  return stomp !== undefined && step === stomp.impact - 1;
}

/**
 * G4 — no frame-to-frame jump that reads as a teleport, and no dead frame.
 *
 * A step far larger than the row's typical one is a pose that skipped; a step
 * of zero inside a row that is supposed to be moving is a frame that aliased
 * away. Both are invisible in the code and obvious in the picture.
 *
 * How much it can prove, measured rather than assumed: the allowance is a
 * multiple of the row's own median step, so a row whose ordinary steps are
 * already large buys itself room. Comparing each row's allowance against the
 * largest step any reordering of its own frames could produce, the idles and
 * the profile walk can be failed by a skipped pose, but the head-on walk's
 * skipped frame lifts its own median until the allowance pays for it, and a
 * one-shot strike generally cannot be failed at all: its handful of large steps makes an allowance wider than the
 * furthest apart any two of its own frames are. On a one-shot this clause
 * therefore only catches a limb thrown somewhere no frame of the row goes, which
 * is what the Smush stamp moving 0.1 tiles off its stance does. The dead-frame
 * clause below has no such blind spot, and on loops the joint-spike clause
 * after it sees the snaps this silhouette step cannot.
 *
 * Measured on his body in the default outfit, whatever outfit the run gates:
 * the step is counted in silhouette pixels, and a cloak hung behind him
 * swallows every arm movement made in front of it — a drink raised over the
 * cloak changes no silhouette pixel at all — so the same motion would read as
 * a dead frame followed by a snap. Gear moves only as the pose it is laid on
 * moves — the cloak's hem by the jacket hem's own spring — so the body's steps
 * are the steps to hold.
 */
function gateMotionContinuity(): void {
  let stepsMeasured = 0;
  for (const row of HUMAN_ROWS) {
    const cells = Array.from({ length: row.frameCount }, (_unused, frame) =>
      cellAlpha(row.name, frame, HUMAN_FIGURE),
    );
    const steps: number[] = [];
    for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
    if (steps.length === 0) {
      fail('G4', `${row.name} has no frame-to-frame step to measure`);
      continue;
    }
    stepsMeasured += steps.length;
    const typical = median(steps);
    const runnerUp = [...steps].sort((a, b) => b - a)[1] ?? 0;
    const limitShare = row.kind === 'loop' ? LOOP_STEP_LIMIT : ONE_SHOT_STEP_LIMIT;
    const ordinaryStepLimit = typical * limitShare;
    const runnerUpIsOrdinary = runnerUp <= ordinaryStepLimit;
    const allowed = Math.max(
      ordinaryStepLimit,
      runnerUpIsOrdinary ? runnerUp * STEP_VS_RUNNER_UP : 0,
    );
    steps.forEach((step, index) => {
      if (step > allowed && !isDeclaredSpike(row.name, index)) {
        fail(
          'G4',
          `${row.name} snaps between frames ${index} and ${index + 1}: ${step}px changed ` +
            `against a median step of ${typical}px and a runner-up of ${runnerUp}px ` +
            `(allowed ${allowed.toFixed(0)}px)`,
        );
      }
      if (step === 0) {
        fail(
          'G4',
          `${row.name}[${index}]→[${index + 1}] is pixel-identical: the row has a dead frame`,
        );
      }
    });
  }
  failUnlessMeasured('G4', stepsMeasured, 'frame-to-frame steps');
  gateLoopJointSpikes();
}

/**
 * How far a loop's largest per-frame joint jump may exceed its third largest.
 *
 * The silhouette step above cannot see a limb that snaps across the body: a
 * forearm flung up over the jacket on one walk frame changes few silhouette
 * pixels, and a skipped frame in the head-on walk lifts the row's own median
 * until it pays for itself. The joints can: a wrong keyframe throws a wrist or
 * an ankle out on one frame and back on the next, two steps far larger than
 * any the cycle makes, so the third largest is still an ordinary step. His
 * shipped loops peak at 1.44 of their third-largest step (the struggle); a
 * flung arm in the profile walk measures 3.9, a skipped head-on walk frame
 * 2.8, a flung arm in the idle 14.5. One-shots are not held to this: their
 * blows legitimately run up to 3.2 against the third-largest step, above what
 * a flung arm in a strike measures.
 */
const LOOP_JOINT_SPIKE_RATIO = 2.2;
/** The step a spike is measured against: the third largest, since one wrong keyframe makes the two largest. */
const SPIKE_REFERENCE_INDEX = 2;

function jointJumpPx(before: HumanJointProbe, after: HumanJointProbe): number {
  const joints = (probe: HumanJointProbe): readonly Pt[] => [
    probe.leftArm.wrist,
    probe.rightArm.wrist,
    probe.leftLeg.ankle,
    probe.rightLeg.ankle,
    probe.headCentre,
  ];
  const from = joints(before);
  const to = joints(after);
  return Math.max(...from.map((point, i) => Math.hypot(point.x - to[i].x, point.y - to[i].y)));
}

function gateLoopJointSpikes(): void {
  let loopsMeasured = 0;
  for (const row of HUMAN_ROWS) {
    if (row.kind !== 'loop') continue;
    const probes = probesOf(row);
    const steps = probes.map((probe, frame) =>
      jointJumpPx(probe, probes[(frame + 1) % probes.length]),
    );
    const sorted = [...steps].sort((a, b) => b - a);
    if (sorted.length <= SPIKE_REFERENCE_INDEX || sorted[SPIKE_REFERENCE_INDEX] <= 0) continue;
    loopsMeasured++;
    const largest = sorted[0];
    const limit = sorted[SPIKE_REFERENCE_INDEX] * LOOP_JOINT_SPIKE_RATIO;
    if (largest <= limit) continue;
    const frame = steps.indexOf(largest);
    fail(
      'G4',
      `${row.name} throws a joint ${largest.toFixed(PIXEL_DIGITS)} cell px between frames ${frame} ` +
        `and ${(frame + 1) % row.frameCount}, against ${limit.toFixed(PIXEL_DIGITS)} ` +
        `(${LOOP_JOINT_SPIKE_RATIO}× its third-largest step) — a limb snaps out and back`,
      row.name,
    );
  }
  failUnlessMeasured('G4', loopsMeasured, 'looping rows by their joints');
}

// ── Pose-stream gates ────────────────────────────────────────────────────────

function posesOf(row: RowSpec): CarlPose[] {
  return Array.from({ length: row.frameCount }, (_unused, frame) => row.pose(frame));
}

/** Distance from a body anchor to a limb's target, in tile units. */
function reach(from: Pt, to: Pt): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

/**
 * How much of a bone's true length a foreshortened drawing hides in depth:
 * drawn at `scale` of its length, the rest of it points at or away from the
 * camera.
 */
function hiddenDepthShare(scale: number): number {
  return Math.sqrt(Math.max(0, 1 - scale * scale));
}

/**
 * A fist's reach from its own shoulder joint on the posed skeleton —
 * straight-arm extension, whichever way the body has turned or dropped — so a
 * wide wind-up with the elbow bent reads shorter than the blow it loads. An
 * arm posed by angles and drawn foreshortened also reaches by the length it
 * turns toward or away from the camera: an overhand seen from behind drives
 * its forearm ahead of him, into the picture, and on screen alone it would
 * read shorter than its own wind-up.
 */
function fistReach(pose: CarlPose, side: LegSide, view: CarlView): number {
  const skeleton = buildSkeleton(pose, VIEWS[view]);
  const arm = side === 'right' ? skeleton.rightArm : skeleton.leftArm;
  const angles = side === 'right' ? pose.rightArmAngles : pose.leftArmAngles;
  const upperScale = side === 'right' ? pose.rightUpperArmScale : pose.leftUpperArmScale;
  const depth =
    angles === null
      ? 0
      : UPPER_ARM_LENGTH * hiddenDepthShare(upperScale ?? FULL_UPPER_ARM) +
        FOREARM_LENGTH * hiddenDepthShare(angles.foreScale);
  return Math.hypot(arm.end.x - arm.root.x, arm.end.y - arm.root.y, depth);
}

/**
 * How far a blow's part is driven out from him, in tile units. A foot is
 * measured from the point he stands on, and a head-on foot also reaches ahead
 * of him along its depth: a kick seen from behind extends almost wholly in
 * depth, so that distance counts. A knee is measured from the same point; the
 * lead shoulder by how far ahead of it the barge carries it.
 */
function strikeReach(pose: CarlPose, limb: StrikeReachLimb, view: CarlView): number {
  switch (limb) {
    case 'hand':
      return fistReach(pose, 'right', view);
    case 'leftHand':
      return fistReach(pose, 'left', view);
    case 'foot':
      return Math.hypot(reach({ x: 0, y: 0 }, pose.rightFoot), pose.rightFootDepth ?? 0);
    case 'leftFoot':
      return Math.hypot(reach({ x: 0, y: 0 }, pose.leftFoot), pose.leftFootDepth ?? 0);
    case 'knee':
      return reach({ x: 0, y: 0 }, buildSkeleton(pose, VIEWS[view]).rightLeg.joint);
    case 'leftKnee':
      return reach({ x: 0, y: 0 }, buildSkeleton(pose, VIEWS[view]).leftLeg.joint);
    case 'shoulder':
      return buildSkeleton(pose, VIEWS[view]).leftShoulder.x;
  }
}

/**
 * How high a blow's part is above the floor, in tile units: what a `down`
 * blow drives out of it. A foot the pose calls planted is on the floor
 * whatever its height on screen: head-on, a planted foot slides up the cell
 * with the sprite's travel, so a stamp on the run lands a little above the
 * cell's ground line. G10 holds that flag to the sole — a foot called planted
 * must have its sole on the floor — so trusting it here trusts a gated fact.
 */
function strikeHeight(pose: CarlPose, limb: StrikeReachLimb, view: CarlView): number {
  const skeleton = buildSkeleton(pose, VIEWS[view]);
  switch (limb) {
    case 'hand':
      return -skeleton.rightArm.end.y;
    case 'leftHand':
      return -skeleton.leftArm.end.y;
    case 'foot':
      return pose.rightFootPlanted === true ? 0 : -pose.rightFoot.y;
    case 'leftFoot':
      return pose.leftFootPlanted === true ? 0 : -pose.leftFoot.y;
    case 'knee':
      return -skeleton.rightLeg.joint.y;
    case 'leftKnee':
      return -skeleton.leftLeg.joint.y;
    case 'shoulder':
      return -skeleton.leftShoulder.y;
  }
}

/**
 * Below this, two measures of a blow are the same: a floating-point tie is
 * not a frame reaching further.
 */
const STRIKE_TIE_TILES = 1e-9;
/**
 * On a punch, the fist that lands it is out at least this share of the other
 * fist's reach on the impact frame — a hammer-fist brought down with both
 * hands has both out, and the one it names is still one of them.
 */
const LANDING_FIST_SHARE = 0.9;

/** The frame a blow's part is driven furthest out, the first of any tie. */
function outPeakFrame(reaches: readonly number[]): number {
  let peakFrame = 0;
  reaches.forEach((value, frame) => {
    if (value > reaches[peakFrame] + STRIKE_TIE_TILES) peakFrame = frame;
  });
  return peakFrame;
}

/**
 * The frame a `down` blow's part stops coming down: from the highest it is
 * raised, the last frame of the unbroken fall after it. Not the lowest it
 * comes to in the row — a hammer-fist at a tall enemy's collarbone lands
 * above the guard it recovers to.
 */
function downLandingFrame(heights: readonly number[]): number {
  let frame = outPeakFrame(heights);
  while (frame + 1 < heights.length && heights[frame + 1] < heights[frame] - STRIKE_TIE_TILES) {
    frame++;
  }
  return frame;
}

/**
 * G5 — every strike lands on the frame its striking part is driven furthest.
 *
 * `HumanPlayer` scores the melee hit on the row's impact frame, so a row
 * whose extreme sits a frame either side of it lands its damage on a picture
 * of a fist still travelling. Nothing about the damage would look wrong; only
 * the animation would. Every strike row names the part in `strike.reachLimb`
 * and which way it is driven in `strike.drive`, so a strike added to the
 * table is gated by the type, and one that reaches the table without naming
 * its part fails here rather than passing unmeasured. On a punch the named
 * fist must also be one that is out on the impact frame, since it is the fist
 * the gauntlet's steel is painted round.
 */
function gateStrikePeaksOnImpact(): void {
  let rowsMeasured = 0;
  for (const row of HUMAN_ROWS) {
    if (row.role !== 'strike') continue;
    const limb = row.strike?.reachLimb;
    if (limb === undefined) {
      fail(
        'G5',
        `${row.name} is a strike but names no \`strike.reachLimb\`, so nothing holds its blow ` +
          'to land on the frame it is driven furthest',
      );
      continue;
    }
    if (row.impactFrames.length === 0) {
      fail('G5', `${row.name} is a strike but declares no impact frame`);
      continue;
    }
    if (limb === 'shoulder' && !VIEWS[row.view].profile) {
      fail('G5', `${row.name} lands with the lead shoulder, which is only measured in profile`);
      continue;
    }
    const impact = row.impactFrames[0];
    rowsMeasured++;
    const poses = posesOf(row);
    if (row.strike?.drive === 'down') {
      const heights = poses.map((pose) => strikeHeight(pose, limb, row.view));
      const landing = downLandingFrame(heights);
      if (landing !== impact) {
        fail(
          'G5',
          `${row.name} is still driving its ${limb} down until frame ${landing} ` +
            `(${heights[landing].toFixed(REACH_DIGITS)} tiles up) but the hit is scored on frame ` +
            `${impact} (${heights[impact].toFixed(REACH_DIGITS)} tiles up)`,
        );
      }
      continue;
    }
    const reaches = poses.map((pose) => strikeReach(pose, limb, row.view));
    const peakFrame = outPeakFrame(reaches);
    if (peakFrame !== impact) {
      fail(
        'G5',
        `${row.name} reaches furthest with its ${limb} on frame ${peakFrame} ` +
          `(${reaches[peakFrame].toFixed(REACH_DIGITS)} tiles) but the hit is scored on frame ` +
          `${impact} (${reaches[impact].toFixed(REACH_DIGITS)} tiles)`,
      );
    }
    const otherFist = limb === 'hand' ? 'leftHand' : limb === 'leftHand' ? 'hand' : undefined;
    if (otherFist === undefined) continue;
    const otherReach = strikeReach(poses[impact], otherFist, row.view);
    if (reaches[impact] < otherReach * LANDING_FIST_SHARE) {
      fail(
        'G5',
        `${row.name} names its ${limb} as the fist that lands, but on the impact frame it is out ` +
          `${reaches[impact].toFixed(REACH_DIGITS)} tiles against the ${otherFist}'s ` +
          otherReach.toFixed(REACH_DIGITS),
      );
    }
  }
  failUnlessMeasured('G5', rowsMeasured, 'strike rows');
}

/**
 * The rows that land by driving a raised foot down onto the floor: the down
 * family's stamp, and every Smush row — any row that declares where its heel
 * lands.
 */
const STOMP_ROWS: ReadonlyArray<{ readonly row: string; readonly impact: number }> = [
  { row: 'stomp_down', impact: STOMP_DOWN_IMPACT },
  ...HUMAN_ROWS.filter((row) => row.stampAnchor !== undefined).map((row) => ({
    row: row.name,
    impact: row.impactFrames[0] ?? SMUSH_IMPACT_FRAME,
  })),
];

/** How high a pose holds one foot off the floor, in figure units. */
function footLift(pose: CarlPose, side: LegSide): number {
  return -(side === 'left' ? pose.leftFoot.y : pose.rightFoot.y);
}

/**
 * The foot a stomp stamps with: the one raised higher on the frame before
 * impact. Read from the pose, not from a declaration, so a row cannot name one
 * foot and stamp with the other.
 */
function stampingSide(row: RowSpec, impact: number): LegSide {
  const apex = row.pose(Math.max(0, impact - 1));
  return footLift(apex, 'left') > footLift(apex, 'right') ? 'left' : 'right';
}

/**
 * G6 — a stomp is at its apex the frame before impact and on the floor from
 * impact on: through the rest of the row, or through the press on a Smush row,
 * which then steps back to guard (standing) or runs on (the hop).
 *
 * The apex is the pose's own lift of the stamping foot, looked for over the
 * whole row on a planted stomp and over the approach on a hop, whose stamping
 * foot goes back into the run's swing afterwards. "On the floor" is the probed
 * sole's contact test rather than a lift compared with zero: a lift returning a
 * hair above the floor instead of exactly zero would empty an equality filter
 * and leave this passing while measuring nothing.
 */
function gateStompLandsOnImpact(): void {
  let rowsMeasured = 0;
  for (const { row: name, impact } of STOMP_ROWS) {
    const row = rowNamed(name, 'G6');
    if (row === null) continue;
    rowsMeasured++;
    const side = stampingSide(row, impact);
    const poses = posesOf(row);
    const probes = probesOf(row);
    const hops = row.locomotion === 'travelling';
    const approachEnd = hops ? impact : row.frameCount - 1;
    let apexFrame = 0;
    for (let frame = 0; frame <= approachEnd; frame++) {
      if (footLift(poses[frame], side) > footLift(poses[apexFrame], side)) apexFrame = frame;
    }
    if (apexFrame !== impact - 1) {
      fail(
        'G6',
        `${name} raises its stamping (${side}) foot highest on frame ${apexFrame}, not on frame ` +
          `${impact - 1}, the frame before the sole is supposed to meet the floor`,
      );
    }
    const pressFrames =
      row.stampAnchor === undefined
        ? row.frameCount - impact
        : hops
          ? SMUSH_HOP_PRESS_FRAMES
          : SMUSH_PRESS_FRAMES;
    let plantedFrames = 0;
    for (let frame = impact; frame < Math.min(impact + pressFrames, row.frameCount); frame++) {
      plantedFrames++;
      // The sole itself, not the pose's planted flag: a stamp whose foot is
      // still in the air on the impact frame keeps the flag it was authored
      // with, and trusting the flag is how that frame passes as "on the floor".
      if (soleDown(legOf(probes[frame], side))) continue;
      fail(
        'G6',
        `${name}[${frame}] still holds its stamping (${side}) foot ` +
          `${footLift(poses[frame], side).toFixed(TILE_DIGITS)} tiles off the floor, on or after ` +
          `the impact frame ${impact}`,
      );
    }
    failUnlessMeasured('G6', plantedFrames, `planted frames of ${name}`);
  }
  failUnlessMeasured('G6', rowsMeasured, 'stomping rows');
}

/**
 * How far the re-measured stamp may sit from the frozen one, in tile fractions.
 * Under a twentieth of a tile: nothing an arithmetic difference can reach, far
 * less than the blast radius it would take to hide a foot in the wrong place.
 */
const STAMP_TOLERANCE_TILES = 0.02;
/**
 * How far across the tile from its centre a standing stamp may land: inside
 * his own stance. The damage circle is centred on the tile, and the blast ring
 * drawn from the heel has to read as the same circle.
 */
const STANDING_STAMP_OFF_CENTRE_TILES = 0.2;
/**
 * A hop covers ground at his running speed and the run would plant the foot
 * well ahead of him; the stamp has to be brought back to the damage centre, to
 * within a tenth of a tile — three in-game pixels.
 */
const HOP_STAMP_OFF_CENTRE_TILES = 0.1;

/**
 * G7 — every stomp's blast is spawned under the stamping heel, and the heel
 * lands on the damage centre.
 *
 * A row's `stampAnchor` is where the runtime spawns the shockwave for that row
 * (`stampPointOf` in the sprite module, mirrored with the cell), and nothing at
 * runtime can look at the art to check it. It is built from the
 * choreography's stamp constants, so what can still go wrong is the pose
 * putting the foot somewhere else on the frame the blast is spawned — which
 * puts the explosion beside him with every other gate green. Measured on the
 * probed skeleton: the stamping ankle across the screen, and the floor under
 * its sole down it, which head-on is not the ground line.
 */
function gateStampAnchor(): void {
  let impactsMeasured = 0;
  for (const row of HUMAN_ROWS) {
    const anchor = row.stampAnchor;
    if (anchor === undefined) continue;
    if (row.impactFrames.length === 0) {
      fail('G7', `${row.name} declares a stamp anchor but no impact frame to land it on`);
      continue;
    }
    const offCentreLimit =
      row.locomotion === 'travelling'
        ? HOP_STAMP_OFF_CENTRE_TILES
        : STANDING_STAMP_OFF_CENTRE_TILES;
    const offCentre = Math.abs(anchor.x - TILE_CENTRE_FRACTION);
    if (offCentre > offCentreLimit) {
      fail(
        'G7',
        `${row.name} stamps ${offCentre.toFixed(TILE_DIGITS)} tiles across from the tile centre the ` +
          `damage is measured from (limit ${offCentreLimit})`,
      );
    }
    for (const impact of row.impactFrames) {
      impactsMeasured++;
      const leg = legOf(probesOf(row)[impact], stampingSide(row, impact));
      const floorY = (leg.heelGroundY + leg.toeGroundY) / 2;
      const footInTile: Pt = {
        x: (leg.ankle.x - TILE_X) / TILE_SCALE,
        y: (floorY - TILE_Y) / TILE_SCALE,
      };
      const offAcross = Math.abs(footInTile.x - anchor.x);
      const offGround = Math.abs(footInTile.y - anchor.y);
      console.log(
        `  G7 ${row.name} stamp: foot at (${footInTile.x.toFixed(TILE_DIGITS)}, ${footInTile.y.toFixed(TILE_DIGITS)}) ` +
          `of its tile on frame ${impact} against an anchor of ` +
          `(${anchor.x.toFixed(TILE_DIGITS)}, ${anchor.y.toFixed(TILE_DIGITS)})`,
      );
      if (offAcross > STAMP_TOLERANCE_TILES) {
        fail(
          'G7',
          `on ${row.name}'s impact frame ${impact} his stamping foot stands at ` +
            `x=${footInTile.x.toFixed(TILE_DIGITS)} of its tile but the row's stamp anchor is at ` +
            `x=${anchor.x.toFixed(TILE_DIGITS)} — the blast spawns ${offAcross.toFixed(TILE_DIGITS)} tiles away from ` +
            'the heel that made it',
        );
      }
      if (offGround > STAMP_TOLERANCE_TILES) {
        fail(
          'G7',
          `on ${row.name}'s impact frame ${impact} the floor under his stamping foot is ` +
            `${offGround.toFixed(TILE_DIGITS)} tiles off the line the stamp anchor places the blast on`,
        );
      }
    }
  }
  failUnlessMeasured('G7', impactsMeasured, 'stamp impact frames');
}

// ── G8: the names and counts the runtime asks for ────────────────────────────

/**
 * G8 — every row the runtime can ask for is one the figure paints, with the
 * frame count the row table declares.
 *
 * The runtime's state type is derived from `HUMAN_ROW_NAMES` and the row table
 * is keyed by it, so the compiler already holds the names and the table
 * together. What it cannot see is the `FigureDef` the cache draws from, which is
 * built from the table when the module loads: `drawFigureCached` returns
 * without drawing when handed a name the figure does not declare, and *clamps*
 * a frame index past the row's end, so a mismatch there is an invisible or a
 * frozen player character and neither says a word.
 */
function gateRuntimeStates(): void {
  let rowsMeasured = 0;
  for (const name of HUMAN_ROW_NAMES) {
    rowsMeasured++;
    const declared: HumanRowMeta = HUMAN_ROW_TABLE[name];
    const painted = gateFigure.states.get(name)?.frames;
    if (painted === undefined) {
      fail('G8', `the row table declares "${name}" but ${gateFigure.id} does not paint it`);
      continue;
    }
    if (painted !== declared.frameCount) {
      fail(
        'G8',
        `the row table counts "${name}" as ${declared.frameCount} frames but the figure paints ` +
          `${painted}, so the draw call clamps and the row freezes`,
      );
    }
    for (const impact of declared.impactFrames) {
      if (Number.isInteger(impact) && impact >= 0 && impact < declared.frameCount) continue;
      fail(
        'G8',
        `"${name}" declares an impact on frame ${impact}, which is not one of its ` +
          `${declared.frameCount} frames`,
      );
    }
    // Only the profile rows may be flipped: a mirrored head-on row swaps the
    // jacket's zip and pockets to the other side of him.
    if (declared.mirrorable && declared.view !== 'side') {
      fail('G8', `"${name}" is mirrorable but drawn in the ${declared.view} view`);
    }
  }
  failUnlessMeasured('G8', rowsMeasured, 'row-table entries');

  const named = new Set<string>(HUMAN_ROW_NAMES);
  for (const state of gateFigure.states.keys()) {
    if (!named.has(state)) {
      fail('G8', `${gateFigure.id} paints "${state}", which the row table does not name`);
    }
  }

  const runtimeLists: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["humanSprite's HUMAN_ATTACK_ROWS", HUMAN_ATTACK_ROWS],
    ["humanSprite's ALWAYS_DRAWN_ROWS", ALWAYS_DRAWN_ROWS],
  ];
  for (const [purpose, names] of runtimeLists) {
    for (const failure of missingStateFailures(gateFigure, names, purpose)) fail('G8', failure);
  }
}

// ── G9: warm-row memory ──────────────────────────────────────────────────────

const BYTES_PER_PIXEL = 4;
const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;

/**
 * The hard ceiling for one warm animation row.
 *
 * A painted figure is admitted to the cache a row at a time rather than as one
 * whole-texture budget, so the number that decides whether it fits is the
 * widest row's warm bytes rather than the sum of all of them — and it has to
 * stay well inside the cache's per-figure ceiling, because Carl is on screen
 * continuously with several of his rows warm at once.
 */
const ROW_BUDGET_MEGABYTES = 3;

/**
 * The rows that must be warm together, besides the always-drawn set: every
 * strike in the busiest family (the rows one facing can throw) and the stomp.
 */
function strikeFamilies(): Map<CarlView, HumanRowName[]> {
  const families = new Map<CarlView, HumanRowName[]>();
  for (const name of HUMAN_ATTACK_ROWS) {
    const view = HUMAN_ROW_TABLE[name].view;
    families.set(view, [...(families.get(view) ?? []), name]);
  }
  return families;
}

/**
 * How many views' Smush rows can be warm at once. A Smush row is admitted when
 * it is stamped and released once it has gone unplayed for the cache's release
 * window; at the shortest cooldown the ability reaches, this many stamps can
 * fall inside one window, and each can be in a different view.
 */
function smushViewsWarmAtOnce(): number {
  const shortestCooldown = getSmushStats(SMUSH_DEF.maxLevel).cooldownFrames;
  return Math.floor(IDLE_FRAMES_BEFORE_RELEASE / shortestCooldown) + 1;
}

/**
 * The Smush rows a fight can hold warm together: the standing stamp and the
 * hop of as many views as {@link smushViewsWarmAtOnce}, taking the heaviest.
 */
function warmStompRows(): HumanRowName[] {
  const byView = new Map<CarlView, HumanRowName[]>();
  for (const row of HUMAN_ROWS) {
    if (row.stampAnchor === undefined) continue;
    byView.set(row.view, [...(byView.get(row.view) ?? []), row.name]);
  }
  const framesOf = (names: readonly HumanRowName[]): number =>
    names.reduce((sum, name) => sum + HUMAN_ROW_TABLE[name].frameCount, 0);
  const heaviestFirst = [...byView.values()].sort((a, b) => framesOf(b) - framesOf(a));
  return heaviestFirst.slice(0, smushViewsWarmAtOnce()).flat();
}

/**
 * The Protective Shell cast of a view, up to the frame the dome goes up — the
 * span `standByForShellCast` holds warm while the spell is ready.
 */
function shellCastSpans(view: CarlView): HumanWarmSpan[] {
  return HUMAN_ROWS.flatMap((row) => {
    const cast = row.eventFrames?.cast?.[0];
    return row.view === view && cast !== undefined ? [{ row: row.name, frames: cast + 1 }] : [];
  });
}

/**
 * G9b — the working set fits Carl's own per-figure budget.
 *
 * Rows are admitted on use and released when stale, so what has to fit is not
 * every row at once but the rows a fight holds warm together: everything he
 * is drawn in continuously (`ALWAYS_DRAWN_ROWS`, warmed at scene start), the
 * wind-up of every blow a fight can open with from standing, in every view
 * (also warmed at scene start, up to each one's impact frame), the whole of
 * the largest family of strikes one facing can throw — standing, and every
 * version painted on the move, whose wind-ups are warmed as he sets off in
 * that view — and the Smush rows, standing and every hop version, of as many
 * views as can be stamped inside one release window. On top of those, the
 * rows held on stand-by for a moment that can come on any tick, in the view
 * the fight is fought in, each only up to the frame it is held to: the flinch
 * and the stumble to the end of their recoil, the Protective Shell cast to the
 * frame the dome goes up, and the falls to him reaching the floor. Measured
 * against `HUMAN_FIGURE`'s own `budgetMegabytes` rather than the cache's fleet
 * default, since he declares an override.
 */
function gateWorkingSet(): void {
  const cellBytes = frameWidth * frameHeight * BYTES_PER_PIXEL;
  const framesOf = (names: readonly HumanRowName[]): number =>
    names.reduce((sum, name) => sum + HUMAN_ROW_TABLE[name].frameCount, 0);
  let busiestFamily: HumanRowName[] = [];
  for (const family of strikeFamilies().values()) {
    if (framesOf(family) > framesOf(busiestFamily)) busiestFamily = family;
  }
  const stomps = warmStompRows();
  const rows = [...new Set([...ALWAYS_DRAWN_ROWS, ...busiestFamily, ...stomps])];
  const windUps = OPENING_STRIKE_ROWS.filter((name) => !rows.includes(name));
  const windUpFrames = windUps.reduce(
    (sum, name) => sum + strikeWindUpFrames(HUMAN_ROW_TABLE[name]),
    0,
  );
  const fightView: CarlView | undefined =
    busiestFamily.length > 0 ? HUMAN_ROW_TABLE[busiestFamily[0]].view : undefined;
  const fightReactions = fightView === undefined ? [] : fightReactionSpans(fightView);
  const shellCast = fightView === undefined ? [] : shellCastSpans(fightView);
  const standby = [...fightReactions, ...shellCast, ...FALL_SPANS].filter(
    (span) => !rows.includes(span.row),
  );
  const standbyFrames = standby.reduce((sum, span) => sum + span.frames, 0);
  failUnlessMeasured('G9b', busiestFamily.length, 'strike rows in any family');
  failUnlessMeasured('G9b', stomps.length, 'stomp rows');
  failUnlessMeasured('G9b', ALWAYS_DRAWN_ROWS.length, 'always-drawn rows');
  failUnlessMeasured('G9b', fightReactions.length, 'fight reaction rows');
  failUnlessMeasured('G9b', shellCast.length, 'Protective Shell cast rows');
  failUnlessMeasured('G9b', standbyFrames, 'stand-by frames');
  const cells = framesOf(rows) + windUpFrames + standbyFrames;
  const bytes = cells * cellBytes;
  const megabytes = bytes / BYTES_PER_MEGABYTE;
  const figureBudget = figureByteBudgetFor(gateFigure);
  const budgetMegabytes = figureBudget / BYTES_PER_MEGABYTE;
  console.log(
    `  G9b working set: ${rows.length} rows, ${windUps.length} wind-ups and ` +
      `${standby.length} stand-by spans, ${cells} cells, ` +
      `${megabytes.toFixed(2)} MB of the ${budgetMegabytes} MB per-figure budget ` +
      `(strike family: ${busiestFamily.join(', ')})`,
  );
  if (bytes > figureBudget) {
    fail(
      'G9b',
      `the working set (${rows.join(', ')}, the wind-ups of ${windUps.join(', ')}, and the ` +
        `stand-by spans of ${standby.map((span) => span.row).join(', ')}) warms ` +
        `to ${megabytes.toFixed(2)} MB against the ` +
        `cache's ${budgetMegabytes} MB per-figure budget`,
    );
  }
  // A comparison that can never see the other side of itself is not a gate —
  // proves the check above is reachable rather than trivially true, by running
  // the identical comparison against a figure whose declared budget cannot
  // possibly cover the same measured bytes.
  const starvedBudget = figureByteBudgetFor({ ...gateFigure, budgetMegabytes: 0 });
  if (!(bytes > starvedBudget)) {
    fail(
      'G9b',
      `the working-set check does not fail against a starved 0 MB budget, so it can never fail ` +
        'against the real one either',
    );
  }
}

/** G9 — the widest warm row's memory, reported whether or not it passes. */
function gateWarmRowSize(): void {
  const cellBytes = frameWidth * frameHeight * BYTES_PER_PIXEL;
  let widestState = '';
  let widestFrames = 0;
  let statesMeasured = 0;
  let totalFrames = 0;
  for (const [state, declared] of gateFigure.states) {
    statesMeasured++;
    totalFrames += declared.frames;
    if (declared.frames <= widestFrames) continue;
    widestFrames = declared.frames;
    widestState = state;
  }
  failUnlessMeasured('G9', statesMeasured, 'declared states');
  if (statesMeasured === 0) return;

  const megabytes = (widestFrames * cellBytes) / BYTES_PER_MEGABYTE;
  const allWarmMegabytes = (totalFrames * cellBytes) / BYTES_PER_MEGABYTE;
  console.log(
    `  G9 warm row: ${widestState} is ${megabytes.toFixed(2)} MB of a ` +
      `${ROW_BUDGET_MEGABYTES} MB budget; all ${statesMeasured} states warm at once would be ` +
      `${allWarmMegabytes.toFixed(2)} MB`,
  );
  if (megabytes > ROW_BUDGET_MEGABYTES) {
    fail(
      'G9',
      `${widestState} warms to ${megabytes.toFixed(2)} MB against a budget of ` +
        `${ROW_BUDGET_MEGABYTES} MB`,
    );
  }
}

// ── Motion gates: shared measurement ─────────────────────────────────────────

/** In-game pixels per cell pixel: the 64-px art tile is blitted at `TILE_SIZE`. */
const IN_GAME_PX_PER_CELL_PX = TILE_SIZE / TILE_SCALE;
const FULL_TURN = Math.PI * 2;
const PIXEL_DIGITS = 2;

/**
 * How far above the ground line a sole landmark may sit and still bear weight,
 * in cell pixels. A flat planted sole's heel and toe ride 0.4 px above the
 * ground line — the rounding of the sole itself — while the first frame of a
 * swing already lifts them 0.8 px or more, so 0.6 separates standing from
 * stepping without letting a hovering foot count as planted.
 */
const SOLE_CONTACT_TOLERANCE_PX = 0.6;

const LEG_SIDES = ['left', 'right'] as const;
type LegSide = (typeof LEG_SIDES)[number];

function legOf(probe: HumanJointProbe, side: LegSide): ProbedLeg {
  return side === 'left' ? probe.leftLeg : probe.rightLeg;
}

function armOf(probe: HumanJointProbe, side: LegSide): ProbedArm {
  return side === 'left' ? probe.leftArm : probe.rightArm;
}

function otherSide(side: LegSide): LegSide {
  return side === 'left' ? 'right' : 'left';
}

function soleLandmarkDown(point: Pt, groundY: number): boolean {
  return point.y >= groundY - SOLE_CONTACT_TOLERANCE_PX;
}

/** Either end of the foot's sole is on the floor beneath it. */
function soleDown(leg: ProbedLeg): boolean {
  return soleLandmarkDown(leg.heel, leg.heelGroundY) || soleLandmarkDown(leg.toe, leg.toeGroundY);
}

/**
 * The foot bears weight. A locomotion row says so itself — head-on, a planted
 * foot slides up and down the cell with the sprite's travel, so its height on
 * screen cannot tell standing from stepping — and every other row is read from
 * its sole landmarks. G10 holds a row to its word: a foot it calls planted
 * must have its sole on the floor.
 */
function footDown(probe: HumanJointProbe, side: LegSide): boolean {
  const leg = legOf(probe, side);
  return leg.planted ?? soleDown(leg);
}

const probesByRow = new Map<HumanRowName, HumanJointProbe[]>();

function probesOf(row: RowSpec): HumanJointProbe[] {
  const cached = probesByRow.get(row.name);
  if (cached !== undefined) return cached;
  const probes = Array.from({ length: row.frameCount }, (_unused, frame) =>
    probeHumanJoints(row.name, frame),
  );
  probesByRow.set(row.name, probes);
  return probes;
}

/**
 * The maximal runs of consecutive frames on which `holds` is true, as frame
 * indices in playing order.
 *
 * A loop's run may wrap past its last frame back onto frame 0, because that is
 * how the row plays. A loop on which `holds` never lapses comes back as one
 * run that ends on frame 0 again, so the wrap step is measured too.
 */
function runsWhere(
  frameCount: number,
  loops: boolean,
  holds: (frame: number) => boolean,
): number[][] {
  const flags = Array.from({ length: frameCount }, (_unused, frame) => holds(frame));
  if (loops && flags.every(Boolean)) {
    return [[...Array.from({ length: frameCount }, (_unused, frame) => frame), 0]];
  }
  const firstLapse = loops ? flags.indexOf(false) : -1;
  const start = firstLapse + 1;
  const runs: number[][] = [];
  let current: number[] = [];
  for (let step = 0; step < frameCount; step++) {
    const frame = (start + step) % frameCount;
    if (flags[frame]) {
      current.push(frame);
      continue;
    }
    if (current.length > 0) runs.push(current);
    current = [];
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

/** Ticks of running at base speed before the gait has settled out of its start. */
const GAIT_SETTLE_TICKS = 30;
/** How far a measured phase advance may stray from the pacing it should follow. */
const GAIT_RATE_TOLERANCE = 1e-9;

/**
 * The gait phase, in radians, the runtime advances Carl's legs by per game
 * tick at his base speed, once into his stride — measured by moving a real
 * `HumanPlayer` across the floor and ticking it, rather than copied, so a
 * change to how the player paces his cycle reaches this gate.
 */
function runtimeGait(): { readonly radiansPerTick: number; readonly gait: HumanGait } {
  const player = new HumanPlayer(0, 0, TILE_SIZE);
  player.isMoving = true;
  let radiansPerTick = 0;
  for (let tick = 0; tick < GAIT_SETTLE_TICKS; tick++) {
    const before = player.animator.gaitPhase;
    player.x += PLAYER_SPEED;
    player.tickTimers();
    radiansPerTick = (player.animator.gaitPhase - before + FULL_TURN) % FULL_TURN;
  }
  return { radiansPerTick, gait: player.animator.currentGait };
}

const runtimeGaitAtBaseSpeed = runtimeGait();

/**
 * How far the weight-bearing point of a sole moved between two stance frames,
 * in cell pixels, before the sprite's own travel is added.
 *
 * A rolling foot legitimately hands its weight from heel to toe, so the point
 * tracked is whichever sole landmark is on the floor in *both* frames (the one
 * that moved least, if both are). Across the one step where no landmark is
 * down in both, the point tracked is the one that has just taken the weight.
 */
function soleStep(before: HumanJointProbe, after: HumanJointProbe, side: LegSide): Pt {
  const from = legOf(before, side);
  const to = legOf(after, side);
  const pairs: ReadonlyArray<readonly [Pt, Pt]> = [
    [from.heel, to.heel],
    [from.toe, to.toe],
  ];
  const grounds: ReadonlyArray<readonly [number, number]> = [
    [from.heelGroundY, to.heelGroundY],
    [from.toeGroundY, to.toeGroundY],
  ];
  const indices = [0, 1];
  const sharedAt = indices.filter(
    (i) =>
      soleLandmarkDown(pairs[i][0], grounds[i][0]) && soleLandmarkDown(pairs[i][1], grounds[i][1]),
  );
  const chosen =
    sharedAt.length > 0
      ? sharedAt
      : indices.filter((i) => soleLandmarkDown(pairs[i][1], grounds[i][1]));
  const candidates = chosen.map((i) => pairs[i]);
  let best: Pt = { x: to.ankle.x - from.ankle.x, y: to.ankle.y - from.ankle.y };
  let bestLength = Number.POSITIVE_INFINITY;
  for (const [a, b] of candidates) {
    const step = { x: b.x - a.x, y: b.y - a.y };
    const length = Math.hypot(step.x, step.y);
    if (length >= bestLength) continue;
    best = step;
    bestLength = length;
  }
  return best;
}

// ── G10: a planted foot does not slide across the floor ─────────────────────

/**
 * The most a foot bearing weight may move over the ground, in in-game pixels.
 * Half a pixel: under that a slide is invisible at the tile it is drawn at,
 * and over it the eye reads the foot skating.
 */
const FOOT_SLIP_LIMIT_IN_GAME_PX = 0.5;

/**
 * G10 — a foot on the floor holds its place on the floor.
 *
 * Its ground-plane position is its position in the cell plus the floor that
 * has moved back under him since the stance began: a travelling row's sprite
 * is carried forward by the player's speed, so a stance foot has to slide
 * *backward* in the cell with the floor to stand still on it. In profile that
 * is the whole of the ground covered. Head-on the figure draws the floor
 * foreshortened (`HEAD_ON_FLOOR_FORESHORTENING` in `carl/rig.ts`), because an
 * upright figure stood on a floor seen from above would otherwise have its
 * legs stretched between the two projections; the floor under a head-on foot
 * therefore moves back by that share of the ground covered, and the foot is
 * held to it (`floorDriftPerFrameCellPx`). A planted row covers no ground, so
 * its feet simply may not move. The drift is the furthest the tracked point
 * strays from where the stance began.
 */
function gateFootSlip(): void {
  const { radiansPerTick, gait } = runtimeGaitAtBaseSpeed;
  const expected = PLAYER_SPEED * gaitRadiansPerPx(gait);
  if (!(radiansPerTick > 0) || Math.abs(radiansPerTick - expected) > GAIT_RATE_TOLERANCE) {
    fail(
      'G10',
      `the runtime advanced the ${gait} by ${radiansPerTick} rad in a tick at base speed, where ` +
        `its distance pacing gives ${expected} — the travel this gate adds is not the runtime's`,
    );
    return;
  }
  let stepsMeasured = 0;
  for (const row of HUMAN_ROWS) {
    if (row.locomotion === 'none') continue;
    const probes = probesOf(row);
    const travel = floorDriftPerFrameCellPx(row.name);
    const direction = TRAVEL_DIRECTION[row.view];
    let rowSteps = 0;
    for (const side of LEG_SIDES) {
      let sideSteps = 0;
      probes.forEach((probe, frame) => {
        const leg = legOf(probe, side);
        if (leg.planted !== true || soleDown(leg)) return;
        fail(
          'G10',
          `${row.name}[${frame}] calls the ${side} foot planted, but neither end of its sole is on ` +
            'the floor under it — it hovers',
          row.name,
        );
      });
      const stances = runsWhere(row.frameCount, row.kind === 'loop', (frame) =>
        footDown(probes[frame], side),
      );
      let worstDrift = 0;
      let worstStance = '';
      for (const stance of stances) {
        let groundX = 0;
        let groundY = 0;
        for (let i = 1; i < stance.length; i++) {
          const step = soleStep(probes[stance[i - 1]], probes[stance[i]], side);
          groundX += step.x + travel * direction.x;
          groundY += step.y + travel * direction.y;
          stepsMeasured++;
          sideSteps++;
          const drift = Math.hypot(groundX, groundY) * IN_GAME_PX_PER_CELL_PX;
          if (drift <= worstDrift) continue;
          worstDrift = drift;
          worstStance = `frames ${stance[0]}→${stance[i]}`;
        }
      }
      if (worstDrift > FOOT_SLIP_LIMIT_IN_GAME_PX) {
        fail(
          'G10',
          `${row.name}'s ${side} foot slides ${worstDrift.toFixed(PIXEL_DIGITS)} in-game px over the ` +
            `floor across its stance (${worstStance}; the floor under him moves ` +
            `${(travel * IN_GAME_PX_PER_CELL_PX).toFixed(PIXEL_DIGITS)} px a frame), limit ` +
            `${FOOT_SLIP_LIMIT_IN_GAME_PX}`,
          row.name,
        );
      }
      rowSteps += sideSteps;
      // A travelling cycle carries both feet through a stance, so each side is
      // held to it; a foot that never shows two planted frames in a row is a
      // gate measuring nothing for that leg. A start or a travelling strike may
      // lift a foot straight off its first frame, so only the row is held.
      if (row.locomotion === 'travelling' && row.kind === 'loop') {
        failUnlessMeasured('G10', sideSteps, `stance steps of ${row.name}'s ${side} foot`);
      }
    }
    failUnlessMeasured('G10', rowSteps, `stance steps in ${row.name}`);
  }
  failUnlessMeasured('G10', stepsMeasured, 'stance steps');
}

// ── G11: the arms swing against the legs ─────────────────────────────────────

/** The same-side wrist's offset from its hip, less that offset's mean over the row. */
function armSwingOffsets(probes: readonly HumanJointProbe[], side: LegSide): number[] {
  const offsets = probes.map((probe) => armOf(probe, side).wrist.x - legOf(probe, side).hip.x);
  const mean = offsets.reduce((sum, value) => sum + value, 0) / offsets.length;
  return offsets.map((value) => value - mean);
}

/**
 * G11 — at each foot contact in a profile locomotion row, the arm on that
 * foot's side is swung back, behind its hip, and the other arm is forward.
 *
 * Every limb moving correctly still hides this defect: an arm driven from a
 * sine when the foot path peaks at phase 0 runs a quarter of a stride out of
 * phase, and reads as a shuffle rather than anything obviously broken. Mid-
 * stance is where that sine would peak, so the swing passing through neutral
 * there, rather than peaking, is what tells the two drivers apart.
 */
function gateArmPhase(): void {
  let contactsMeasured = 0;
  for (const row of HUMAN_ROWS) {
    // A gait cycle only: a start or stop begins or ends on a standing frame,
    // where the arms hang and nothing lands.
    if (row.view !== 'side' || row.locomotion !== 'travelling' || row.kind !== 'loop') continue;
    const probes = probesOf(row);
    for (const side of LEG_SIDES) {
      const own = armSwingOffsets(probes, side);
      const opposite = armSwingOffsets(probes, otherSide(side));
      const stances = runsWhere(row.frameCount, true, (frame) => footDown(probes[frame], side));
      for (const stance of stances) {
        if (stance.length > row.frameCount) continue;
        const contact = stance[0];
        const midStance = stance[Math.floor(stance.length / 2)];
        const probe = probes[contact];
        contactsMeasured++;
        if (legOf(probe, side).ankle.x <= legOf(probe, side).hip.x) {
          fail(
            'G11',
            `${row.name}[${contact}]: the ${side} foot lands behind its hip, so "contact" is not ` +
              'where the foot reaches forward and the phase test below means nothing',
          );
          continue;
        }
        const wristBehindHip = armOf(probe, side).wrist.x < legOf(probe, side).hip.x;
        if (!wristBehindHip || own[contact] >= 0) {
          fail(
            'G11',
            `${row.name}[${contact}]: the ${side} foot lands with the ${side} hand ` +
              `${own[contact].toFixed(PIXEL_DIGITS)} px from the middle of its swing and ` +
              `${(armOf(probe, side).wrist.x - legOf(probe, side).hip.x).toFixed(PIXEL_DIGITS)} px ` +
              'from its hip — it must be swung back, behind the hip',
          );
        }
        if (opposite[contact] <= 0) {
          fail(
            'G11',
            `${row.name}[${contact}]: the ${otherSide(side)} arm is ` +
              `${opposite[contact].toFixed(PIXEL_DIGITS)} px from the middle of its swing as the ` +
              `${side} foot lands — it must be leading`,
          );
        }
        if (Math.abs(own[midStance]) > Math.abs(own[contact])) {
          fail(
            'G11',
            `${row.name}: the ${side} arm swings furthest at mid-stance (frame ${midStance}, ` +
              `${own[midStance].toFixed(PIXEL_DIGITS)} px) rather than at contact (frame ${contact}, ` +
              `${own[contact].toFixed(PIXEL_DIGITS)} px) — a quarter-cycle late; the driver is a ` +
              'sine of the cycle where it should be a cosine',
          );
        }
      }
    }
  }
  failUnlessMeasured('G11', contactsMeasured, 'foot contacts in profile locomotion');
}

// ── G12: a blink closes the eye ──────────────────────────────────────────────

/** A pose blink this close to 1 paints a shut eye. */
const EYE_SHUT = 0.99;
/** Below this the lid has not moved at all. */
const EYE_OPEN_EPSILON = 1e-6;

/**
 * G12 — every looping row blinks once per cycle, shut on the blink's centre
 * frame.
 *
 * A bell shaped as `hump(1 - distance / width)` is zero at its own centre, so
 * the eye is wide open at the moment it should be shut and closes half a
 * window either side: two part-blinks, never a closed eye. That is legal on
 * every frame and invisible on a contact sheet, so it is asserted here: one
 * contiguous run of lidded frames per cycle, rising to a shut eye on the run's
 * middle frame and falling after it.
 */
/**
 * A resting man blinks every three or four seconds. A clock-driven loop much
 * shorter than that — the guard's bounce — cannot carry a blink every cycle
 * without fluttering, and is never held long enough for its lack to stare.
 */
const SHORTEST_BLINKING_LOOP_TICKS = 2 * TICKS_PER_SECOND;

function gateBlink(): void {
  let blinksMeasured = 0;
  for (const row of HUMAN_ROWS) {
    if (row.kind !== 'loop') continue;
    const clockPaced = row.ticksPerFrame !== undefined || row.frameTicks !== undefined;
    const loopTicks = clockPaced ? rowLengthInTicks(row) : undefined;
    if (loopTicks !== undefined && loopTicks < SHORTEST_BLINKING_LOOP_TICKS) continue;
    const lids = posesOf(row).map((pose) => pose.blink);
    // A loop he lies in out cold holds his eyes shut on every frame: there is
    // no blink to measure, and no stare for a missing one to become.
    if (lids.every((lid) => lid >= EYE_SHUT)) continue;
    const blinks = runsWhere(row.frameCount, true, (frame) => lids[frame] > EYE_OPEN_EPSILON);
    if (blinks.length === 0) {
      fail(
        'G12',
        `${row.name} never closes its eye: a loop he can stand or walk in for seconds at a ` +
          'time without blinking reads as a stare, and a bell sampled at zero on the only frame ' +
          'inside its window looks exactly like this',
      );
      continue;
    }
    if (blinks.length > 1) {
      fail(
        'G12',
        `${row.name} closes its eye in ${blinks.length} separate runs per cycle ` +
          `(${blinks.map((run) => `frames ${run.join(',')}`).join('; ')}) — one blink has split in two`,
      );
    }
    for (const run of blinks) {
      blinksMeasured++;
      const values = run.map((frame) => lids[frame]);
      const shutIndex = values.indexOf(Math.max(...values));
      const centreIndex = (run.length - 1) / 2;
      if (values[shutIndex] < EYE_SHUT) {
        fail(
          'G12',
          `${row.name}'s blink over frames ${run.join(',')} closes the eye at most ` +
            `${values[shutIndex].toFixed(TILE_DIGITS)} (on frame ${run[shutIndex]}) — it never shuts`,
        );
      }
      if (Math.abs(shutIndex - centreIndex) > 1 / 2) {
        fail(
          'G12',
          `${row.name}'s blink over frames ${run.join(',')} is most closed on frame ` +
            `${run[shutIndex]}, not at the centre of the blink`,
        );
      }
      const rises = values.slice(0, shutIndex + 1).every((v, i, a) => i === 0 || v >= a[i - 1]);
      const falls = values.slice(shutIndex).every((v, i, a) => i === 0 || v <= a[i - 1]);
      if (!rises || !falls) {
        fail(
          'G12',
          `${row.name}'s lid does not close then open over frames ${run.join(',')}: ` +
            values.map((v) => v.toFixed(REACH_DIGITS)).join(', '),
        );
      }
    }
  }
  failUnlessMeasured('G12', blinksMeasured, 'blinks in looping rows');
}

// ── G13: no leg is asked to reach past its own length ────────────────────────

/**
 * G13 — no leg chain is clamped by the IK on any frame with a foot down.
 *
 * A clamped leg locks dead straight with its foot short of its target, and the
 * next frame's tuck snaps the knee back: the hop. The probe reports the chain's
 * own hip→ankle demand against `THIGH + SHIN − JOINT_SLACK`, and the demand
 * must stay strictly under it — reaching the limit exactly is already a locked
 * knee. A run's flight frames, with both feet off the floor, are exempt:
 * nothing is pushing against the ground there, and a run's airborne stride is
 * longer than the leg by design. Only a run's: in any other row a frame with
 * both feet up is a stance leg clamped short of the floor, which is exactly
 * what this gate is for.
 */
function gateLegReach(): void {
  let chainsMeasured = 0;
  let clampedChains = 0;
  for (const row of HUMAN_ROWS) {
    const probes = probesOf(row);
    let rowClamped = 0;
    let worstDemand = 0;
    let worstLimit = 0;
    let worstAt = '';
    probes.forEach((probe, frame) => {
      const inFlight = !footDown(probe, 'left') && !footDown(probe, 'right');
      if (inFlight && row.gait === 'run') return;
      for (const side of LEG_SIDES) {
        const leg = legOf(probe, side);
        chainsMeasured++;
        if (!leg.clamped && leg.reachDemand < leg.reachLimit) continue;
        rowClamped++;
        if (leg.reachDemand <= worstDemand) continue;
        worstDemand = leg.reachDemand;
        worstLimit = leg.reachLimit;
        worstAt = `${side} leg, frame ${frame}`;
      }
    });
    // The total is of the rows the gate holds; a pending row's clamps are
    // reported against that row alone.
    if (!isPendingRow('G13', row.name)) clampedChains += rowClamped;
    if (rowClamped > 0) {
      fail(
        'G13',
        `${row.name} clamps ${rowClamped} leg chain(s) on a frame this gate does not exempt as ` +
          `flight (only a run's airborne frames are); worst asks ` +
          `${worstDemand.toFixed(TILE_DIGITS)} of a ${worstLimit.toFixed(TILE_DIGITS)} reach (${worstAt})`,
        row.name,
      );
    }
  }
  if (clampedChains > 0) {
    fail(
      'G13',
      `${clampedChains} of ${chainsMeasured} leg chains this gate does not exempt as flight are ` +
        'clamped in the rows it holds',
    );
  }
  failUnlessMeasured('G13', chainsMeasured, 'leg chains not exempted as flight');
}

// ── G14: a run leaves the ground ─────────────────────────────────────────────

/**
 * The share of a run cycle spent with both feet off the floor. A runner at his
 * base speed, about six metres a second, is airborne for a third to nearly half
 * of every step: Muybridge's runner photographed at a half-mile racing pace is
 * clear of the floor on two of the six frames of each step, landing and taking
 * off between frames, so between 33% and 45% of it. Below the band the "run"
 * is a jog carried at a sprinter's speed, which needs a cadence no one runs
 * at; above it he bounds.
 */
const FLIGHT_SHARE_MIN = 0.33;
const FLIGHT_SHARE_MAX = 0.45;

/**
 * G14 — every run cycle has a flight phase of the right length, and no walk
 * has one at all.
 *
 * With no row marked as a run it fails rather than passing: at his base speed
 * Carl covers ground only a run can, so the absence of a run row is the
 * defect, not an exemption.
 */
function gateFlight(): void {
  let walksMeasured = 0;
  for (const row of HUMAN_ROWS) {
    if (row.gait !== 'walk') continue;
    walksMeasured++;
    const airborne = probesOf(row)
      .map((probe, frame) => ({ probe, frame }))
      .filter(({ probe }) => !footDown(probe, 'left') && !footDown(probe, 'right'))
      .map(({ frame }) => frame);
    if (airborne.length === 0) continue;
    fail(
      'G14',
      `${row.name} is a walk but has both feet off the floor on frames ${airborne.join(',')} — ` +
        'a walk always has a foot down, so its stance foot is hanging short of the ground',
    );
  }
  failUnlessMeasured('G14', walksMeasured, 'walk rows');
  const runRows = HUMAN_ROWS.filter((row) => row.gait === 'run');
  if (runRows.length === 0) {
    fail(
      'G14',
      'no row is marked `gait: "run"` — at base PLAYER_SPEED he covers ground only a run ' +
        'reaches, and there is no run cycle to measure a flight phase on',
    );
    return;
  }
  for (const row of runRows) {
    const probes = probesOf(row);
    const airborne = probes.filter(
      (probe) => !footDown(probe, 'left') && !footDown(probe, 'right'),
    ).length;
    const share = airborne / row.frameCount;
    if (share < FLIGHT_SHARE_MIN || share > FLIGHT_SHARE_MAX) {
      fail(
        'G14',
        `${row.name} has both feet off the floor on ${airborne} of ${row.frameCount} frames ` +
          `(${share.toFixed(REACH_DIGITS)}), outside ${FLIGHT_SHARE_MIN}–${FLIGHT_SHARE_MAX}`,
      );
    }
  }
}

// ── G15 / G16: the runtime's row and frame choice ────────────────────────────

/** Facing vectors swept around the circle when replaying the runtime's choices. */
const FACING_SWEEP = 64;
/**
 * Swings thrown in one unbroken chain, for each facing and target. The
 * animator works through a family before it repeats a blow, but a row held to
 * a combo slot, or a finisher, only comes up deep in a chain — so the chain
 * runs to twice the largest family the table has, whatever that is.
 */
const SWINGS_PER_CHAIN =
  2 * Math.max(...[...strikeFamilies().values()].map((family) => family.length));
/** Ticks walked before the walking row is read, so the start is behind him. */
const WALK_IN_TICKS = 20;
/**
 * Ticks walked between blows on the move, cycling up to this many, so a chain
 * thrown on the run is triggered at every phase of the stride — travelling
 * blows are only drawn from the phase their legs begin at. Kept inside the
 * combo window so the chain still carries on.
 */
const STRIDE_OFFSET_TICKS = Math.min(RUN_FRAMES, COMBO_WINDOW_TICKS);

function sweptFacing(index: number): Pt {
  const angle = (index / FACING_SWEEP) * FULL_TURN;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

/** A player built facing along `facing`, with the animator told so. */
function playerFacing(facing: Pt): HumanPlayer {
  const player = new HumanPlayer(0, 0, TILE_SIZE);
  player.facingX = facing.x;
  player.facingY = facing.y;
  player.tickTimers();
  return player;
}

/** Turns a player to `facing` and lets the animator see it, standing. */
function turnTo(player: HumanPlayer, facing: Pt): void {
  player.facingX = facing.x;
  player.facingY = facing.y;
  player.isMoving = false;
  player.tickTimers();
}

/** Walks a player along its facing at base speed, as the movement phase moves him. */
function walkFor(player: HumanPlayer, ticks: number): void {
  for (let tick = 0; tick < ticks; tick++) {
    player.isMoving = true;
    player.x += player.facingX * PLAYER_SPEED;
    player.y += player.facingY * PLAYER_SPEED;
    player.tickTimers();
  }
}

/** Stands a player still for `ticks`, as the game ticks him with no input. */
function standFor(player: HumanPlayer, ticks: number): void {
  for (let tick = 0; tick < ticks; tick++) {
    player.isMoving = false;
    player.tickTimers();
  }
}

function recordFrame(seen: Map<HumanRowName, Set<number>>, row: HumanRowName, frame: number): void {
  const frames = seen.get(row) ?? new Set<number>();
  frames.add(frame);
  seen.set(row, frames);
}

/**
 * What a blow can be thrown at, as the runtime reads it off a real mob:
 * nothing at all, a knee-high rat, a boss, a stunned enemy on the floor, and
 * one at the far edge of his reach.
 */
type TargetKind = 'none' | 'low' | 'tall' | 'downed' | 'far';
const TARGET_KINDS: readonly TargetKind[] = ['none', 'low', 'tall', 'downed', 'far'];
/** Where a close target stands, as a share of his reach; a far one stands past `FAR_REACH_SHARE`. */
const CLOSE_TARGET_REACH_SHARE = 0.4;
const FAR_TARGET_REACH_SHARE = (FAR_REACH_SHARE + 1) / 2;
/** Long enough that a stunned target stays stunned through every chain thrown at it. */
const DOWNED_STUN_TICKS = 1_000_000;

function targetMob(kind: TargetKind): Mob | null {
  if (kind === 'none') return null;
  if (kind === 'low') return new Rat(0, 0, TILE_SIZE);
  const goblin = new Goblin(0, 0, TILE_SIZE, 'sword');
  if (kind === 'tall') goblin.isBoss = true;
  if (kind === 'downed') goblin.applyStatus(makeStun(DOWNED_STUN_TICKS));
  return goblin;
}

/** Puts a target in front of the player along his facing, at a share of his reach. */
function placeTarget(player: HumanPlayer, target: Mob, reachShare: number): void {
  const distance = player.getMeleeRange() * reachShare;
  target.x = player.x + player.facingX * distance;
  target.y = player.y + player.facingY * distance;
}

/**
 * Throws one swing and ticks the player through it as the game does — the
 * combat kit's `updateAttack`, then the timers that drive the animator — so
 * a blow ends, and the next one continues the combo, the way it does in play.
 * On the move he keeps walking along his facing at base speed throughout.
 * Returns the number of ticks the hit was scored on.
 */
function throwSwing(
  player: HumanPlayer,
  moving: boolean,
  seen: Map<HumanRowName, Set<number>>,
  target: Mob | null = null,
  reachShare = CLOSE_TARGET_REACH_SHARE,
): number {
  if (target !== null) placeTarget(player, target, reachShare);
  player.triggerAttack(target);
  let peaks = 0;
  while (player.attackTimer > 0) {
    if (moving) {
      player.isMoving = true;
      player.x += player.facingX * PLAYER_SPEED;
      player.y += player.facingY * PLAYER_SPEED;
    } else {
      player.isMoving = false;
    }
    player.updateAttack();
    if (player.isAttackPeak()) {
      peaks++;
      const chosen = player.spriteSelection();
      recordFrame(seen, chosen.row, chosen.frame);
    }
    player.tickTimers();
  }
  return peaks;
}

/**
 * Stamps one Smush through to its end, running on along the facing throughout
 * when `moving`, and records the cell drawn on the tick the blast fires.
 * Returns the number of ticks it fired on, or null if it would not trigger.
 *
 * Also fails a row whose stamp frame is already on screen the tick before the
 * blast: the frame shown at the blast has to be the one the heel lands on,
 * and it has to be *new* on that tick, or the heel sits on the floor with
 * nothing happening until the blast catches up.
 */
function stampSmush(
  player: HumanPlayer,
  moving: boolean,
  seen: Map<HumanRowName, Set<number>>,
): number | null {
  if (!player.triggerSmush()) return null;
  let stamps = 0;
  let previous = player.spriteSelection();
  while (player.smushTimer > 0) {
    if (moving) {
      player.isMoving = true;
      player.x += player.facingX * PLAYER_SPEED;
      player.y += player.facingY * PLAYER_SPEED;
    }
    player.updateAttack();
    const chosen = player.spriteSelection();
    if (player.isSmushPeak()) {
      stamps++;
      recordFrame(seen, chosen.row, chosen.frame);
      const stampedEarly =
        previous.row === chosen.row &&
        HUMAN_ROW_TABLE[chosen.row].impactFrames.includes(previous.frame);
      if (stampedEarly) {
        fail(
          'G15',
          `${chosen.row} already shows its stamp frame ${previous.frame} the tick before the ` +
            'blast fires — the heel lands before the Smush does',
        );
      }
    }
    previous = chosen;
    player.tickTimers();
  }
  return stamps;
}

/**
 * G15 — every strike shows its impact frame on the tick the hit is scored,
 * every stomp shows its stamp frame on the tick its blast goes off, and every
 * strike and stomp row in the table is one the runtime actually picks.
 *
 * Replayed, not recomputed: one standing `HumanPlayer` and one running one are
 * turned to facings all the way round the circle and throw whole combo chains
 * at every kind of target the animator tells apart — none, low, tall, downed
 * and far — ticked through `updateAttack` and `tickTimers` exactly as the
 * combat kit ticks them, the runner triggering at every phase of his stride.
 * On the tick `isAttackPeak` / `isSmushPeak` fires the frame is read from
 * `HumanPlayer.spriteSelection`, the cell `drawSelf` paints. A row that never
 * turns up is a row the runtime can never pick, and fails by name.
 */
function gateImpactTiming(): void {
  const strikeFrames = new Map<HumanRowName, Set<number>>();
  const stampFrames = new Map<HumanRowName, Set<number>>();
  const stander = playerFacing(sweptFacing(0));
  const runner = playerFacing(sweptFacing(0));
  const targets = new Map(TARGET_KINDS.map((kind) => [kind, targetMob(kind)] as const));
  let swingsThrown = 0;
  for (let index = 0; index < FACING_SWEEP; index++) {
    const facing = sweptFacing(index);
    turnTo(stander, facing);
    runner.facingX = facing.x;
    runner.facingY = facing.y;
    walkFor(runner, WALK_IN_TICKS);
    for (const kind of TARGET_KINDS) {
      const target = targets.get(kind) ?? null;
      const reachShare = kind === 'far' ? FAR_TARGET_REACH_SHARE : CLOSE_TARGET_REACH_SHARE;
      // A pause longer than the combo window between targets, so each chain
      // opens afresh.
      standFor(stander, COMBO_WINDOW_TICKS + 1);
      for (let swing = 0; swing < SWINGS_PER_CHAIN; swing++) {
        walkFor(runner, swing % STRIDE_OFFSET_TICKS);
        for (const [swinger, moving] of [
          [stander, false],
          [runner, true],
        ] as const) {
          swingsThrown++;
          const peaks = throwSwing(swinger, moving, strikeFrames, target, reachShare);
          if (peaks === 1) continue;
          const how = moving ? 'on the move' : 'standing';
          fail(
            'G15',
            `a swing ${how} at a ${kind} target, facing ${index}/${FACING_SWEEP}, peaked on ` +
              `${peaks} ticks, not 1`,
          );
        }
      }
    }
    walkFor(runner, index % STRIDE_OFFSET_TICKS);
    for (const [stamper, moving] of [
      [stander, false],
      [runner, true],
    ] as const) {
      stamper.smushCooldown = 0;
      const how = moving ? 'on the run' : 'standing';
      const stamps = stampSmush(stamper, moving, stampFrames);
      if (stamps === null) {
        fail('G15', `Smush would not trigger ${how} at facing ${index}/${FACING_SWEEP}`);
      } else if (stamps !== 1) {
        fail(
          'G15',
          `a Smush ${how} at facing ${index}/${FACING_SWEEP} stamped on ${stamps} ticks, not 1`,
        );
      }
    }
  }
  failUnlessMeasured('G15', swingsThrown, 'swings thrown');

  // A hop is only drawn from the run frame its legs begin at, and the runner
  // above reaches each view's facings at whatever phase his running total of
  // ticks happens to leave him in — a handful of phases, not the stride. So
  // the Smush on the run is also stamped from a fresh stride at every tick of
  // one full cycle, in every view.
  const runCycleTicks = Math.ceil(RUN_GROUND_PER_CYCLE_PX / PLAYER_SPEED);
  let hopsStamped = 0;
  for (const [, facing] of VIEW_FACINGS) {
    for (let offset = 0; offset < runCycleTicks; offset++) {
      const hopper = playerFacing(facing);
      walkFor(hopper, WALK_IN_TICKS + offset);
      if (stampSmush(hopper, true, stampFrames) !== null) hopsStamped++;
    }
  }
  failUnlessMeasured('G15', hopsStamped, 'Smushes stamped at every phase of a stride');

  const checks: ReadonlyArray<
    readonly [string, readonly HumanRowName[], Map<HumanRowName, Set<number>>]
  > = [
    ['strike', HUMAN_ATTACK_ROWS, strikeFrames],
    [
      'stomp',
      HUMAN_ROWS.filter((row) => row.stampAnchor !== undefined).map((row) => row.name),
      stampFrames,
    ],
  ];
  let rowsMeasured = 0;
  for (const [kind, rows, seen] of checks) {
    for (const name of rows) {
      const shown = seen.get(name);
      const impact = HUMAN_ROW_TABLE[name].impactFrames;
      if (shown === undefined) {
        fail(
          'G15',
          `the runtime never picks ${kind} row ${name}: thrown standing and on the run, at every ` +
            `facing, against ${TARGET_KINDS.join('/')} targets, it never lands a blow in it — a ` +
            'row the animator can never choose',
        );
        continue;
      }
      rowsMeasured++;
      for (const frame of shown) {
        if (impact.includes(frame)) continue;
        fail(
          'G15',
          `${name} is on frame ${frame} on the tick the ${kind} lands, but its impact frame is ` +
            impact.join(','),
        );
      }
    }
    for (const name of seen.keys()) {
      if (rows.includes(name)) continue;
      fail('G15', `the runtime lands a ${kind} while drawing ${name}, which is not a ${kind} row`);
    }
  }
  failUnlessMeasured('G15', rowsMeasured, 'strike and stomp rows');
}

/**
 * G16 — one facing, one view: the strike the runtime draws for a facing,
 * standing or on the run, is in the view `viewForFacing` gives it, and so are
 * the stride, the idle and the Smush. And once a
 * blow is thrown its row and its mirroring hold for the whole swing, however
 * the facing is steered after it.
 *
 * Otherwise a diagonal walks in the profile view and strikes head-on, and the
 * figure pops between views on the frame the attack starts — or a punch flips
 * to the other side of him mid-swing because the stick was pulled back.
 */
function gateViewConsistency(): void {
  let mismatches = 0;
  let latchBreaks = 0;
  let latchTicks = 0;
  const examples: string[] = [];
  let facingsMeasured = 0;
  for (let index = 0; index < FACING_SWEEP; index++) {
    const facing = sweptFacing(index);
    const expected = viewForFacing(facing.x, facing.y);
    const standing = playerFacing(facing).spriteSelection();
    const walker = playerFacing(facing);
    walkFor(walker, WALK_IN_TICKS);
    const walking = walker.spriteSelection();
    const striker = playerFacing(facing);
    striker.triggerAttack();
    const striking = striker.spriteSelection();
    const standingLatch = swingLatchBreaks(striker, striking);
    latchBreaks += standingLatch.breaks;
    latchTicks += standingLatch.ticks;
    // On the run, at every phase of the stride in turn, so a travelling blow
    // is thrown as often as a standing one.
    const runningStriker = playerFacing(facing);
    walkFor(runningStriker, WALK_IN_TICKS + (index % STRIDE_OFFSET_TICKS));
    runningStriker.triggerAttack();
    const runningStrike = runningStriker.spriteSelection();
    const runningLatch = swingLatchBreaks(runningStriker, runningStrike);
    latchBreaks += runningLatch.breaks;
    latchTicks += runningLatch.ticks;
    const smusher = playerFacing(facing);
    smusher.triggerSmush();
    const stamping = smusher.spriteSelection();
    const hopper = playerFacing(facing);
    walkFor(hopper, WALK_IN_TICKS);
    hopper.triggerSmush();
    const hopping = hopper.spriteSelection();
    facingsMeasured++;
    for (const chosen of [striking, runningStrike, walking, standing, stamping, hopping]) {
      const drawn = HUMAN_ROW_TABLE[chosen.row].view;
      if (drawn === expected) continue;
      mismatches++;
      if (examples.length < VIEW_EXAMPLES) {
        const degrees = (index / FACING_SWEEP) * DEGREES_PER_TURN;
        examples.push(
          `${degrees.toFixed(1)}° draws ${chosen.row} (${drawn}) in a ${expected} facing`,
        );
      }
    }
  }
  failUnlessMeasured('G16', facingsMeasured, 'facings');
  failUnlessMeasured('G16', latchTicks, 'swing ticks steered against the blow');
  if (latchBreaks > 0) {
    fail(
      'G16',
      `${latchBreaks} ticks of swings thrown round the circle changed row or mirroring when the ` +
        'facing was reversed mid-swing — the blow must stay where it was thrown',
    );
  }
  if (mismatches > 0) {
    fail(
      'G16',
      `${mismatches} of ${facingsMeasured * VIEW_ROWS_PER_FACING} row choices disagree with ` +
        `viewForFacing, e.g. ${examples.join('; ')}`,
    );
  }
}

/**
 * Ticks a swing through with the facing reversed, as input steering the other
 * way would, and counts the ticks examined and those on which the drawn row
 * or its mirroring differ from the frame it was thrown on. The examined count
 * is what keeps the latch clause honest: a swing that ends before its first
 * tick has no breaks because nothing was looked at.
 */
function swingLatchBreaks(
  player: HumanPlayer,
  thrown: HumanRowSelection,
): { readonly ticks: number; readonly breaks: number } {
  let ticks = 0;
  let breaks = 0;
  player.facingX = -player.facingX;
  player.facingY = -player.facingY;
  while (player.attackTimer > 0) {
    player.updateAttack();
    player.tickTimers();
    if (player.attackTimer === 0) break;
    ticks++;
    const now = player.spriteSelection();
    if (now.row !== thrown.row || now.flipX !== thrown.flipX) breaks++;
  }
  return { ticks, breaks };
}

const VIEW_EXAMPLES = 4;
const VIEW_ROWS_PER_FACING = 6;
const DEGREES_PER_TURN = 360;

// ── Pixel helpers at the in-game size ────────────────────────────────────────

/** Rec. 601 luma weights. */
const LUMA_RED = 0.299;
const LUMA_GREEN = 0.587;
const LUMA_BLUE = 0.114;
const RED_OFFSET = 0;
const GREEN_OFFSET = 1;
const BLUE_OFFSET = 2;

interface Raster {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

function rasterOf(canvas: Canvas): Raster {
  const { width, height } = canvas;
  return { width, height, data: canvas.getContext('2d').getImageData(0, 0, width, height).data };
}

/** A cell baked as the cache bakes it, then blitted at the 32-px tile as the game blits it. */
function inGameRaster(state: HumanRowName, frame: number): Raster {
  const baked = bakeFigureCell(gateFigure, state, frame);
  const width = Math.round(frameWidth * IN_GAME_PX_PER_CELL_PX);
  const height = Math.round(frameHeight * IN_GAME_PX_PER_CELL_PX);
  const small = createCanvas(width, height);
  const ctx = small.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(baked, 0, 0, width, height);
  return rasterOf(small);
}

function alphaAt(raster: Raster, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return 0;
  return raster.data[(y * raster.width + x) * CHANNELS + ALPHA_OFFSET];
}

function lumaAt(raster: Raster, x: number, y: number): number {
  const i = (y * raster.width + x) * CHANNELS;
  return (
    raster.data[i + RED_OFFSET] * LUMA_RED +
    raster.data[i + GREEN_OFFSET] * LUMA_GREEN +
    raster.data[i + BLUE_OFFSET] * LUMA_BLUE
  );
}

// ── G17: the limbs read as form at the in-game size ──────────────────────────

/**
 * Along each limb segment, as a share of it from its root, where its
 * cross-sections are centred: the thigh below the boxer hem and above the
 * kneecap, the calf over its belly, the forearm over its fleshy middle.
 */
const THIGH_SAMPLE_CENTRE = 0.8;
const CALF_SAMPLE_CENTRE = 0.35;
const FOREARM_SAMPLE_CENTRE = 0.45;
/** Spacing between a crop's three cross-sections, as a share of the segment. */
const CROSS_SECTION_SPACING = 0.1;

function sampledAround(centre: number): readonly number[] {
  return [centre - CROSS_SECTION_SPACING, centre, centre + CROSS_SECTION_SPACING];
}
/**
 * How far inside the limb's modelled edge a pixel's centre must lie to be
 * wholly limb, in raster px: half a pixel. Anything nearer the edge is a blend
 * of the limb with its outline, the floor, or whatever it lies against.
 */
const CORE_INSET_PX = 0.5;

/**
 * The spread of luminance across a limb, in 8-bit levels, below which it reads
 * as a flat capsule. Form shading on a lit cylinder runs from its light ramp to
 * its dark ramp — on Carl's skin `#e7b287` to `#a06546`, about 74 levels — and
 * a limb carrying two fifths of that across its width reads as round at the
 * tile.
 */
const MIN_FORM_LUMA_RANGE = 30;
/**
 * Fewest pixels a cross-section's core may hold for this gate to judge its
 * form at all: one pixel has no partner to differ from, so its luminance range
 * is zero by construction and every limb that thin would fail as "flat"
 * regardless of how it is painted. A limb under this is reported as too thin
 * to judge, not as flat.
 */
const MIN_MEASURABLE_CORE_PX = 2;
interface CrossSection {
  readonly range: number;
  /** Core pixels measured. */
  readonly core: number;
}

/**
 * A cross-section reads as form when its core carries the spread on its own.
 * No half-tone is asked for: bare limbs are shaded with a hard band on the
 * bone so the band survives the tile, and on a core three pixels wide that
 * band — light against shade — is the whole turn of the form.
 */
function readsAsForm(section: CrossSection): boolean {
  return section.range >= MIN_FORM_LUMA_RANGE;
}

/** A limb segment's bone in cell px, and which segment it is, for its modelled width. */
interface LimbCrop {
  readonly part: BareSegment;
  readonly from: Pt;
  readonly to: Pt;
}

/**
 * The limb across its bone at `along`, in a raster of `rasterScale` raster px
 * per cell px — only the pixels lying wholly inside the limb's modelled width,
 * so nothing laid against it (the boxers' hem, the jacket, the other leg) can
 * supply the contrast. Null when the bone's own pixel is not solid.
 */
function crossSection(
  raster: Raster,
  crop: LimbCrop,
  along: number,
  profile: boolean,
  rasterScale: number,
): CrossSection | null {
  const { from, to } = crop;
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length === 0) return null;
  const centre = {
    x: (from.x + (to.x - from.x) * along) * rasterScale,
    y: (from.y + (to.y - from.y) * along) * rasterScale,
  };
  const normal = { x: -(to.y - from.y) / length, y: (to.x - from.x) / length };
  const pxPerUnit = HUMAN_CELL_PX_PER_UNIT * rasterScale;
  const edges = bareSegmentEdges(crop.part, along, profile);
  const plusPx = Math.max(0, Math.floor(edges.plus * pxPerUnit - CORE_INSET_PX));
  const minusPx = Math.max(0, Math.floor(edges.minus * pxPerUnit - CORE_INSET_PX));
  const pixels: Pt[] = [];
  for (let offset = -minusPx; offset <= plusPx; offset++) {
    const x = Math.floor(centre.x + normal.x * offset);
    const y = Math.floor(centre.y + normal.y * offset);
    if (pixels.some((p) => p.x === x && p.y === y)) continue;
    pixels.push({ x, y });
  }
  if (alphaAt(raster, Math.floor(centre.x), Math.floor(centre.y)) < SOLID_ALPHA_THRESHOLD) {
    return null;
  }
  const lumas = pixels
    .filter((p) => alphaAt(raster, p.x, p.y) >= SOLID_ALPHA_THRESHOLD)
    .map((p) => lumaAt(raster, p.x, p.y));
  return { range: Math.max(...lumas) - Math.min(...lumas), core: lumas.length };
}

/**
 * The profile walk frames the muscle read is taken on: the two foot contacts,
 * where the legs are split so each leg crosses the floor rather than the other
 * leg. Each side is judged on the contact where its arm is at the *front* of
 * its swing — the near (right) side on the left foot's contact, halfway round
 * a cycle that starts on the right's, and the far (left) side on the right
 * foot's. At the back of its swing the far forearm hangs behind the torso and
 * boxers, and a cross-section there measures the boxers laid over it, where
 * nothing in the alpha says where one ends and the other begins.
 */
const WALK_NEAR_LIMBS_CLEAR_FRAME = WALK_FRAMES / 2;
const WALK_FAR_LIMBS_CLEAR_FRAME = 0;

/** The frames the muscle read is judged on, and whose limbs each one judges. */
const MUSCLE_FRAMES: ReadonlyArray<{
  readonly row: HumanRowName;
  readonly frame: number;
  readonly sides: readonly LegSide[];
}> = [
  { row: 'idle', frame: 0, sides: LEG_SIDES },
  { row: 'walk_side', frame: WALK_NEAR_LIMBS_CLEAR_FRAME, sides: ['right'] },
  { row: 'walk_side', frame: WALK_FAR_LIMBS_CLEAR_FRAME, sides: ['left'] },
];

/**
 * The two rasters a player can see a cell as at the 32-px tile: the full bake
 * downsampled into it, and the low-end bake, which paints the cell straight at
 * that density.
 */
const MUSCLE_RASTERS: ReadonlyArray<{
  readonly name: string;
  readonly raster: (row: HumanRowName, frame: number) => Raster;
}> = [
  { name: 'full bake', raster: inGameRaster },
  {
    name: 'low-end bake',
    raster: (row, frame) =>
      rasterOf(paintFigureCell(gateFigure, row, frame, IN_GAME_PX_PER_CELL_PX)),
  },
];

/**
 * G17 — at the 32-px tile, each thigh, calf and forearm shows form: enough
 * luminance spread across its own width.
 *
 * Measured at the in-game size, because that is the only size a player sees
 * and a gradient painted narrower than a pixel there averages away to a flat
 * tone — once from the full bake and once from the low-end one. Crops are
 * placed from the solved joints, so they follow the limb wherever a pose puts
 * it, and each cross-section is confined to the pixels inside the limb's
 * modelled width: a flat limb lying against the boxers or the jacket cannot
 * borrow their contrast. A crop reads as form when most of its three
 * cross-sections do, so one sheen stripe cannot carry it.
 */
function gateMuscleRead(): void {
  let cropsMeasured = 0;
  const weakest = new Map<string, { range: number; where: string }>();
  for (const { name, raster: rasterFor } of MUSCLE_RASTERS) {
    for (const { row, frame, sides } of MUSCLE_FRAMES) {
      const raster = rasterFor(row, frame);
      const probe = probeHumanJoints(row, frame);
      const profile = VIEWS[probe.view].profile;
      for (const side of sides) {
        const leg = legOf(probe, side);
        const arm = armOf(probe, side);
        const crops: ReadonlyArray<readonly [LimbCrop, readonly number[]]> = [
          [{ part: 'thigh', from: leg.hip, to: leg.knee }, sampledAround(THIGH_SAMPLE_CENTRE)],
          [{ part: 'calf', from: leg.knee, to: leg.ankle }, sampledAround(CALF_SAMPLE_CENTRE)],
          [
            { part: 'forearm', from: arm.elbow, to: arm.wrist },
            sampledAround(FOREARM_SAMPLE_CENTRE),
          ],
        ];
        for (const [crop, samples] of crops) {
          const where = `${name} ${row}[${frame}] ${side} ${crop.part}`;
          const sections = samples
            .map((along) => crossSection(raster, crop, along, profile, IN_GAME_PX_PER_CELL_PX))
            .filter((section): section is CrossSection => section !== null);
          if (sections.length === 0) {
            fail('G17', `${where}: no solid limb under the solved bone`);
            continue;
          }
          cropsMeasured++;
          const core = median(sections.map((s) => s.core));
          if (core < MIN_MEASURABLE_CORE_PX) {
            fail(
              'G17',
              `${where} is too thin to judge form at the tile: ${core} px inside its modelled ` +
                `width (need at least ${MIN_MEASURABLE_CORE_PX})`,
            );
            continue;
          }
          const range = median(sections.map((s) => s.range));
          const previous = weakest.get(name);
          if (previous === undefined || range < previous.range) weakest.set(name, { range, where });
          const readingSections = sections.filter(readsAsForm).length;
          if (readingSections * 2 > sections.length) continue;
          fail(
            'G17',
            `${where} reads flat at the tile: ${range.toFixed(1)} levels of luminance across ` +
              `its ${core}-px core (need ${MIN_FORM_LUMA_RANGE}); ${readingSections} of ` +
              `${sections.length} cross-sections read as form`,
          );
        }
      }
    }
  }
  failUnlessMeasured('G17', cropsMeasured, 'limb crops');
  for (const [name, { range, where }] of weakest) {
    console.log(
      `  G17 ${name}: flattest limb ${where}, ${range.toFixed(1)} levels ` +
        `(need ${MIN_FORM_LUMA_RANGE})`,
    );
  }
}

// ── G18: Carl stands bigger than the crowd ───────────────────────────────────

/**
 * How much taller and broader than a townsperson Carl stands. He is 6'3" and
 * built like a linebacker against an average adult, which puts him about a
 * twentieth taller and a good deal wider through the shoulders; less than
 * this and at the tile he is lost in a crowd.
 */
const MIN_HEIGHT_OVER_TOWNSFOLK = 1.05;
const MIN_SHOULDER_OVER_TOWNSFOLK = 1.15;
/**
 * The band of a standing figure's height, measured down from the crown, where
 * the shoulders are its widest point: below a head of about a fifth of
 * standing height and above the elbows.
 */
const SHOULDER_BAND_TOP = 0.2;
const SHOULDER_BAND_BOTTOM = 0.32;
/** Adult commoners measured for the typical townsperson; odd, so the median is one of them. */
const TOWNSFOLK_SAMPLE = 41;
const TOWNSFOLK_SEED_STRIDE = 37;
/** Room around a drawn townsperson, so nothing clips before it is measured. */
const TOWNSFOLK_CANVAS_PAD = 16;

interface StandingSize {
  readonly height: number;
  readonly shoulders: number;
}

function standingSize(raster: Raster): StandingSize | null {
  let top = raster.height;
  let bottom = -1;
  for (let y = 0; y < raster.height; y++) {
    for (let x = 0; x < raster.width; x++) {
      if (alphaAt(raster, x, y) < SOLID_ALPHA_THRESHOLD) continue;
      if (y < top) top = y;
      bottom = y;
    }
  }
  if (bottom < 0) return null;
  const height = bottom - top + 1;
  let shoulders = 0;
  const bandTop = Math.floor(top + height * SHOULDER_BAND_TOP);
  const bandBottom = Math.ceil(top + height * SHOULDER_BAND_BOTTOM);
  for (let y = bandTop; y <= bandBottom; y++) {
    let left = raster.width;
    let right = -1;
    for (let x = 0; x < raster.width; x++) {
      if (alphaAt(raster, x, y) < SOLID_ALPHA_THRESHOLD) continue;
      if (x < left) left = x;
      right = x;
    }
    if (right >= left) shoulders = Math.max(shoulders, right - left + 1);
  }
  return { height, shoulders };
}

function townspersonSize(seed: number): StandingSize | null {
  const size = TILE_SIZE * HUMANOID_NPC_SCALE;
  const side = Math.ceil(size + TOWNSFOLK_CANVAS_PAD * 2);
  const canvas = createCanvas(side, side);
  drawPerson(
    asGameContext(canvas.getContext('2d')),
    TOWNSFOLK_CANVAS_PAD,
    TOWNSFOLK_CANVAS_PAD,
    size,
    generatePersonAppearance(seed, 'commoner'),
    0,
    'down',
    false,
  );
  return standingSize(rasterOf(canvas));
}

/**
 * G18 — Carl, standing head-on at the in-game size, is taller and broader
 * than the typical townsperson drawn at the size the town draws them.
 */
function gateSilhouetteSize(): void {
  const carl = standingSize(inGameRaster('idle', 0));
  if (carl === null) {
    fail('G18', 'idle[0] paints no solid ink to measure');
    return;
  }
  const folk: StandingSize[] = [];
  for (let i = 0; i < TOWNSFOLK_SAMPLE; i++) {
    const size = townspersonSize(1 + i * TOWNSFOLK_SEED_STRIDE);
    if (size !== null) folk.push(size);
  }
  failUnlessMeasured('G18', folk.length, 'townsfolk');
  if (folk.length === 0) return;
  const typicalHeight = median(folk.map((f) => f.height));
  const typicalShoulders = median(folk.map((f) => f.shoulders));
  const heightRatio = carl.height / typicalHeight;
  const shoulderRatio = carl.shoulders / typicalShoulders;
  console.log(
    `  G18 silhouette: Carl ${carl.height} px tall, ${carl.shoulders} px at the shoulders; ` +
      `typical townsperson ${typicalHeight} × ${typicalShoulders} px ` +
      `(×${heightRatio.toFixed(REACH_DIGITS)} tall, ×${shoulderRatio.toFixed(REACH_DIGITS)} broad)`,
  );
  if (heightRatio < MIN_HEIGHT_OVER_TOWNSFOLK) {
    fail(
      'G18',
      `Carl stands ${carl.height} px against a typical townsperson's ${typicalHeight} ` +
        `(×${heightRatio.toFixed(REACH_DIGITS)}, need ×${MIN_HEIGHT_OVER_TOWNSFOLK})`,
    );
  }
  if (shoulderRatio < MIN_SHOULDER_OVER_TOWNSFOLK) {
    fail(
      'G18',
      `Carl is ${carl.shoulders} px across the shoulders against a typical townsperson's ` +
        `${typicalShoulders} (×${shoulderRatio.toFixed(REACH_DIGITS)}, need ×${MIN_SHOULDER_OVER_TOWNSFOLK})`,
    );
  }
}

// ── G19: no outline inside the silhouette ────────────────────────────────────

/** Where the arm's bone line crosses a row of the cell, shoulder→elbow then elbow→wrist. */
function armCentreAt(arm: ProbedArm, y: number): number {
  const [from, to] = y <= arm.elbow.y ? [arm.shoulder, arm.elbow] : [arm.elbow, arm.wrist];
  const along = to.y === from.y ? 0 : (y - from.y) / (to.y - from.y);
  return from.x + (to.x - from.x) * along;
}

const HEX_RADIX = 16;
const HEX_DIGITS_PER_CHANNEL = 2;

/** The luma of a `#rrggbb` colour. */
function hexLuma(hex: string): number {
  const digits = hex.replace('#', '');
  const channel = (offset: number): number =>
    Number.parseInt(
      digits.slice(offset * HEX_DIGITS_PER_CHANNEL, (offset + 1) * HEX_DIGITS_PER_CHANNEL),
      HEX_RADIX,
    );
  return (
    channel(RED_OFFSET) * LUMA_RED +
    channel(GREEN_OFFSET) * LUMA_GREEN +
    channel(BLUE_OFFSET) * LUMA_BLUE
  );
}

/**
 * The darkest tone anything between his arms and his body is made of: the
 * deepest step of the leather, the skin and the cotton, and the shadow every
 * overlap casts. Mixing any of them with each other, or laying the shadow over
 * them at part strength, only ever lands between two of these, so a pixel
 * darker than all of them is ink no material there paints — a drawn line.
 */
const DARKEST_MATERIAL_LUMA = Math.min(
  ...[LEATHER.deep, SKIN.deep, COTTON.deep, CAST_SHADOW_TONE].map(hexLuma),
);
/** Rounding between the palette's exact luma and a pixel's 8-bit channels. */
const LUMA_ROUNDING = 1;
/**
 * The widest gap between an arm and his body that the silhouette outline
 * closes over rather than rings: its dilation reaches in from both sides.
 */
const CLOSED_GAP_PX = OUTLINE_PX * 2;

/**
 * Whether `(x, y)` lies in a gap no wider than {@link CLOSED_GAP_PX} with the
 * figure solid either side of it along the row.
 */
function inClosedGap(raster: Raster, x: number, y: number): boolean {
  const wallAt = (step: number): number | null => {
    for (let distance = 1; distance <= CLOSED_GAP_PX; distance++) {
      if (alphaAt(raster, x + step * distance, y) >= SOLID_ALPHA_THRESHOLD) return distance;
    }
    return null;
  };
  const left = wallAt(-1);
  const right = wallAt(1);
  if (left === null || right === null) return false;
  return left + right - 1 <= CLOSED_GAP_PX;
}

/** A premultiplied channel change past rounding: the outline pass put ink there. */
const OUTLINE_INK_DELTA = 8;

/**
 * G19 — where an arm lies against the torso in the front idle, the two meet
 * without a dark line between them.
 *
 * An outline belongs on the silhouette. Drawn round every part, it rings each
 * arm where it overlaps the jacket and the figure reads as a paper doll of
 * separately cut pieces. The region examined runs from each arm's centreline
 * to the body's, between the shoulder and the wrist.
 *
 * The cell is composed twice, with and without the silhouette outline, and
 * two kinds of line are looked for:
 *
 * - **The outline pass inking inside the figure**: any pixel it changes that
 *   is figure without it, or that lies in a sliver between arm and body
 *   narrow enough for the outline to close over — a sliver it must leave open
 *   to the floor rather than fill with ink.
 * - **A part drawing its own line**: in the figure without the outline, any
 *   solid pixel darker than every material and shadow the region is made of.
 */
function gateOutlinePolicy(): void {
  const row = rowNamed('idle', 'G19');
  if (row === null) return;
  const frame = 0;
  const shipped = rasterOf(bakeFigureCell(gateFigure, row.name, frame));
  const bare = rasterOf(composedCell(row, frame, { silhouetteOutline: false }));
  const probe = probeHumanJoints(row.name, frame);
  let examined = 0;
  let outlineInside = 0;
  let partInk = 0;
  for (const side of LEG_SIDES) {
    const arm = armOf(probe, side);
    const top = Math.round(arm.shoulder.y);
    const bottom = Math.round(arm.wrist.y);
    for (let y = top; y <= bottom; y++) {
      const armX = armCentreAt(arm, y);
      const from = Math.round(Math.min(armX, probe.pelvis.x));
      const to = Math.round(Math.max(armX, probe.pelvis.x));
      for (let x = from; x <= to; x++) {
        examined++;
        const index = (y * shipped.width + x) * CHANNELS;
        const inFigure = alphaAt(bare, x, y) >= SOLID_ALPHA_THRESHOLD;
        const outlined = premultipliedDelta(shipped.data, bare.data, index) > OUTLINE_INK_DELTA;
        if (outlined && (inFigure || inClosedGap(bare, x, y))) outlineInside++;
        if (inFigure && lumaAt(bare, x, y) < DARKEST_MATERIAL_LUMA - LUMA_ROUNDING) partInk++;
      }
    }
  }
  failUnlessMeasured('G19', examined, 'pixels between arm and torso');
  console.log(
    `  G19 outline policy: ${examined} px between arms and torso, ${outlineInside} inked by the ` +
      `outline pass, ${partInk} darker than the darkest material (luma ` +
      `${DARKEST_MATERIAL_LUMA.toFixed(1)})`,
  );
  if (outlineInside > 0) {
    fail(
      'G19',
      `idle[0]: the silhouette outline inks ${outlineInside} px between the arms and the torso — ` +
        'inside the figure, or across a sliver it must leave open — outline belongs on the ' +
        'silhouette only',
    );
  }
  if (partInk > 0) {
    fail(
      'G19',
      `idle[0] paints ${partInk} px between the arms and the torso darker than any material ` +
        `there (luma under ${DARKEST_MATERIAL_LUMA.toFixed(1)}) — a part is drawing its own line`,
    );
  }
}

// ── G20: every cut into or out of a stride keeps the legs where they were ────

/** How far a hand-off frame's ankles may sit from the run's at the declared phase, in in-game px. */
const HAND_OFF_TOLERANCE_IN_GAME_PX = 1;
/** Rounding allowance on a measured jump against a limit measured the same way. */
const JUMP_EPSILON_PX = 1e-6;

/** A view, and a facing that draws it unmirrored. */
const VIEW_FACINGS: ReadonlyArray<readonly [CarlView, Pt]> = [
  ['side', { x: 1, y: 0 }],
  ['front', { x: 0, y: 1 }],
  ['back', { x: 0, y: -1 }],
];
/** Strides of setting-off and stopping replayed per view: every phase, twice over. */
const REPLAYED_CYCLES = 2;
/**
 * The most ticks a stopped figure may take to come to rest before the replay
 * gives up on him: the longest settle is a cycle turned at a frame a tick, and
 * the stop row plays after it.
 */
const REST_WITHIN_TICKS = RUN_FRAMES * 2 + TICKS_PER_SECOND;

function probeOf(selection: HumanRowSelection): HumanJointProbe {
  return probesOf(HUMAN_ROW_TABLE_ROWS.get(selection.row) ?? HUMAN_ROWS[0])[selection.frame];
}

const HUMAN_ROW_TABLE_ROWS: ReadonlyMap<HumanRowName, RowSpec> = new Map(
  HUMAN_ROWS.map((row) => [row.name, row] as const),
);

/** The furthest either ankle jumps between two drawn cells, in in-game pixels. */
function ankleJumpPx(a: HumanRowSelection, b: HumanRowSelection): number {
  const from = probeOf(a);
  const to = probeOf(b);
  return Math.max(
    ...LEG_SIDES.map((side) => {
      const p = legOf(from, side).ankle;
      const q = legOf(to, side).ankle;
      return Math.hypot(p.x - q.x, p.y - q.y) * IN_GAME_PX_PER_CELL_PX;
    }),
  );
}

/**
 * The largest jump either ankle makes between two neighbouring frames of a
 * cycle, in in-game pixels: the motion the eye accepts every frame of that
 * stride, and so the most a cut out of it may move the feet.
 */
function cycleStepPx(cycle: RowSpec): number {
  const steps = Array.from({ length: cycle.frameCount }, (_unused, frame) =>
    ankleJumpPx(
      { row: cycle.name, frame, flipX: false },
      { row: cycle.name, frame: (frame + 1) % cycle.frameCount, flipX: false },
    ),
  );
  return Math.max(...steps);
}

function isBlowRow(name: HumanRowName): boolean {
  const { role }: HumanRowMeta = HUMAN_ROW_TABLE[name];
  return role === 'strike' || role === 'stomp';
}

/** A blow painted standing: carried over the floor on the run, it is a frozen slide. */
function isStandingBlow(name: HumanRowName): boolean {
  const row: HumanRowMeta = HUMAN_ROW_TABLE[name];
  return isBlowRow(name) && row.locomotion !== 'travelling';
}

function isRestRow(name: HumanRowName): boolean {
  const { role }: HumanRowMeta = HUMAN_ROW_TABLE[name];
  return role === 'idle' || role === 'guard';
}

interface CutReport {
  measured: number;
  worst: number;
  worstAt: string;
}

/**
 * Checks one cut between two drawn cells against a limit, and reports it
 * against the row responsible: a blow on either side of the cut, else the row
 * cut into, or when that is standing, the stride cut out of.
 */
function checkCut(
  before: HumanRowSelection,
  after: HumanRowSelection,
  limit: number,
  what: string,
  report: CutReport,
): void {
  if (before.row === after.row) return;
  report.measured++;
  const jump = ankleJumpPx(before, after);
  const at = `${before.row}[${before.frame}] → ${after.row}[${after.frame}]`;
  if (jump > report.worst) {
    report.worst = jump;
    report.worstAt = at;
  }
  if (jump <= limit + JUMP_EPSILON_PX) return;
  const responsible = isBlowRow(before.row)
    ? before.row
    : isBlowRow(after.row) || !isRestRow(after.row)
      ? after.row
      : before.row;
  fail(
    'G20',
    `${what}: ${at} jumps an ankle ${jump.toFixed(PIXEL_DIGITS)} in-game px, more than the ` +
      `${limit.toFixed(PIXEL_DIGITS)} px the stride itself moves it in a frame`,
    responsible,
  );
}

function newReport(): CutReport {
  return { measured: 0, worst: 0, worstAt: 'none' };
}

/**
 * Sets off from standing, covers `ticks` of ground at `speed`, stops, and
 * checks every cut the animator draws until he is standing again.
 */
function replaySetOffAndStop(
  facing: Pt,
  speed: number,
  ticks: number,
  limit: number,
  report: CutReport,
  seenRows: Set<HumanRowName>,
): boolean {
  const player = playerFacing(facing);
  let previous = player.spriteSelection();
  const step = (moving: boolean): HumanRowSelection => {
    player.isMoving = moving;
    if (moving) {
      player.x += facing.x * speed;
      player.y += facing.y * speed;
    }
    player.tickTimers();
    const now = player.spriteSelection();
    seenRows.add(now.row);
    checkCut(previous, now, limit, `setting off and stopping after ${ticks} ticks`, report);
    previous = now;
    return now;
  };
  for (let tick = 0; tick < ticks; tick++) step(true);
  for (let tick = 0; tick < REST_WITHIN_TICKS; tick++) {
    if (isRestRow(step(false).row)) return true;
  }
  return false;
}

/**
 * Runs `ticks` into a stride, throws a blow (or stamps a Smush), runs on
 * through it, and checks the cut into the blow and back out of it. On the run
 * every blow drawn must be one painted on the move: a standing blow there is
 * the frozen slide this gate exists to catch, whatever its cuts measure.
 */
function replayBlowOnTheRun(
  facing: Pt,
  ticks: number,
  smush: boolean,
  limit: number,
  report: CutReport,
): void {
  const player = playerFacing(facing);
  walkFor(player, ticks);
  let previous = player.spriteSelection();
  if (smush) player.triggerSmush();
  else player.triggerAttack();
  const what = `${smush ? 'a Smush' : 'a blow'} thrown ${ticks} ticks into a run`;
  let slid = false;
  const check = (now: HumanRowSelection): void => {
    if (!slid && isStandingBlow(now.row)) {
      slid = true;
      fail(
        'G20',
        `${what} draws ${now.row}[${now.frame}], a blow painted standing, while he runs on: ` +
          'his planted feet are carried over the floor, a frozen slide',
      );
    }
    checkCut(previous, now, limit, what, report);
    previous = now;
  };
  check(player.spriteSelection());
  const blowTicks = smush ? player.SMUSH_FRAMES : player.ATTACK_FRAMES;
  for (let tick = 0; tick <= blowTicks; tick++) {
    player.isMoving = true;
    player.x += facing.x * PLAYER_SPEED;
    player.y += facing.y * PLAYER_SPEED;
    player.updateAttack();
    player.tickTimers();
    check(player.spriteSelection());
  }
}

/** The furthest either wrist jumps between two drawn cells, in in-game pixels. */
function wristJumpPx(a: HumanRowSelection, b: HumanRowSelection): number {
  const from = probeOf(a);
  const to = probeOf(b);
  return Math.max(
    ...LEG_SIDES.map((side) => {
      const p = armOf(from, side).wrist;
      const q = armOf(to, side).wrist;
      return Math.hypot(p.x - q.x, p.y - q.y) * IN_GAME_PX_PER_CELL_PX;
    }),
  );
}

/** The largest jump either wrist makes between neighbouring frames of a cycle, in in-game pixels. */
function cycleWristStepPx(cycle: RowSpec): number {
  const steps = Array.from({ length: cycle.frameCount }, (_unused, frame) =>
    wristJumpPx(
      { row: cycle.name, frame, flipX: false },
      { row: cycle.name, frame: (frame + 1) % cycle.frameCount, flipX: false },
    ),
  );
  return Math.max(...steps);
}

function roleOf(name: HumanRowName): HumanRowRole | undefined {
  const { role }: HumanRowMeta = HUMAN_ROW_TABLE[name];
  return role;
}

function isStandingRow(name: HumanRowName): boolean {
  const { role }: HumanRowMeta = HUMAN_ROW_TABLE[name];
  return role === 'idle' || role === 'guard' || role === 'drop';
}

/** Long enough for any blow, the whole guard hold, its wait for a seam and the drop, in seconds. */
const GUARD_OUT_WITHIN_SECONDS = 6;
const GUARD_OUT_WITHIN_TICKS = GUARD_OUT_WITHIN_SECONDS * TICKS_PER_SECOND;

/**
 * Throws a blow standing, then stands until the guard it raised has dropped
 * back to the idle, and checks every cut between the standing rows on the
 * way — the guard, its drop and the idle — for the hands and the feet alike.
 * The hands are the whole point: the guard holds them at the jaw and the idle
 * at the hips, and a cut straight from one to the other is a pop of half his
 * height. They may move no faster than the run's own arm swing moves them:
 * its largest step in a frame, scaled from the ticks a run frame is shown to
 * the ticks the cell cut out of was shown.
 */
function replayGuardDrop(view: CarlView, facing: Pt): void {
  const run = cycleRow('run', view);
  if (run === undefined) {
    fail('G20', `there is no ${view} run to hold a guard drop's hands to`);
    return;
  }
  const runTicksPerFrame = RUN_GROUND_PER_CYCLE_PX / PLAYER_SPEED / run.frameCount;
  const handPxPerTick = cycleWristStepPx(run) / runTicksPerFrame;
  const footLimit = cycleStepPx(run);
  const player = playerFacing(facing);
  player.triggerAttack();
  let previous = player.spriteSelection();
  let cuts = 0;
  let sawDrop = false;
  let worstHand = 0;
  let worstAt = 'none';
  let worstLimit = 0;
  for (let tick = 0; tick < GUARD_OUT_WITHIN_TICKS; tick++) {
    player.isMoving = false;
    player.updateAttack();
    player.tickTimers();
    const now = player.spriteSelection();
    if (roleOf(now.row) === 'drop') sawDrop = true;
    if (now.row !== previous.row && isStandingRow(previous.row) && isStandingRow(now.row)) {
      cuts++;
      const at = `${previous.row}[${previous.frame}] → ${now.row}[${now.frame}]`;
      const hand = wristJumpPx(previous, now);
      const foot = ankleJumpPx(previous, now);
      const shownTicks = rowFrameHolds(HUMAN_ROW_TABLE[previous.row])[previous.frame];
      const handLimit = handPxPerTick * shownTicks;
      if (hand > worstHand) {
        worstHand = hand;
        worstAt = at;
        worstLimit = handLimit;
      }
      if (hand > handLimit + JUMP_EPSILON_PX) {
        fail(
          'G20',
          `dropping the ${view} guard: ${at} jumps a wrist ${hand.toFixed(PIXEL_DIGITS)} in-game px, ` +
            `more than the ${handLimit.toFixed(PIXEL_DIGITS)} px the run's arm swing moves it in the ` +
            `${shownTicks} ticks ${previous.row}[${previous.frame}] is shown`,
          now.row,
        );
      }
      if (foot > footLimit + JUMP_EPSILON_PX) {
        fail(
          'G20',
          `dropping the ${view} guard: ${at} jumps an ankle ${foot.toFixed(PIXEL_DIGITS)} in-game px, ` +
            `more than the ${footLimit.toFixed(PIXEL_DIGITS)} px the run moves it in a frame`,
          now.row,
        );
      }
    }
    previous = now;
  }
  if (!sawDrop) {
    fail(
      'G20',
      `the ${view} guard never dropped: no drop row was drawn after a blow thrown standing`,
    );
  }
  if (roleOf(previous.row) !== 'idle') {
    fail(
      'G20',
      `${GUARD_OUT_WITHIN_TICKS} ticks after a blow thrown standing he is on ${previous.row}, not the ${view} idle`,
    );
  }
  failUnlessMeasured('G20', cuts, `cuts dropping the ${view} guard`);
  console.log(
    `  G20 ${view} guard drop: ${cuts} cuts, worst wrist ${worstHand.toFixed(PIXEL_DIGITS)} px ` +
      `(${worstAt}), limit there ${worstLimit.toFixed(PIXEL_DIGITS)}`,
  );
}

/**
 * G20 — no cut the animator makes into or out of a stride pops the legs.
 *
 * Statically, every row that declares an entry or exit foot phase starts or
 * ends with its legs where the cycle it hands to has them at that phase: the
 * gait a start or stop bridges, or the run for a blow thrown on the move.
 *
 * Then the animator's own cuts are replayed with a real `HumanPlayer`, in
 * every view: setting off from standing and stopping again after every number
 * of ticks across two strides, running and wading; and a blow and a Smush
 * thrown at every phase of a run. Every change of row is measured as the jump
 * of the ankles between the cell drawn before it and the cell drawn after, at
 * the 32-px tile, and held to the largest step the stride itself makes from
 * one frame to the next.
 *
 * A set-off/stop replay can land exactly on its limit without the limit being
 * derived from the cut. The animator hands a stride to its stop from any
 * frame within `HAND_OFF_FRAMES` of the stop's entry phase, either side of it,
 * so from the frame just past that phase the legs step back by one frame of
 * the stride — and on the run that frame's step is the cycle's largest. A
 * hand-off one frame further out doubles the jump and fails.
 */
function gateHandOff(): void {
  let handOffsMeasured = 0;
  for (const row of HUMAN_ROWS) {
    const ends: ReadonlyArray<readonly [string, number | undefined, number]> = [
      ['entry', row.entryFootPhase, 0],
      ['exit', row.exitFootPhase, row.frameCount - 1],
    ];
    for (const [end, phase, frame] of ends) {
      if (phase === undefined) continue;
      // A start or a stop hands off to the gait it bridges; every other row
      // that declares a phase is thrown on the run.
      const gait = row.bridges ?? 'run';
      const run = cycleRow(gait, row.view);
      if (run === undefined) {
        fail(
          'G20',
          `${row.name} declares an ${end} phase but there is no ${row.view} ${gait} to hand off to`,
        );
        continue;
      }
      handOffsMeasured++;
      const own = probeHumanJoints(row.name, frame);
      const target = probeHumanJoints(run.name, phase * run.frameCount);
      for (const side of LEG_SIDES) {
        const a = legOf(own, side).ankle;
        const b = legOf(target, side).ankle;
        const gap = Math.hypot(a.x - b.x, a.y - b.y) * IN_GAME_PX_PER_CELL_PX;
        if (gap <= HAND_OFF_TOLERANCE_IN_GAME_PX) continue;
        fail(
          'G20',
          `${row.name}[${frame}] puts the ${side} ankle ${gap.toFixed(PIXEL_DIGITS)} in-game px from ` +
            `where ${run.name} has it at its ${end} phase ${phase} (limit ${HAND_OFF_TOLERANCE_IN_GAME_PX})`,
          row.name,
        );
      }
    }
  }
  if (handOffsMeasured === 0) {
    fail(
      'G20',
      'no row declares an entry or exit foot phase against a run, so no strike hands off to ' +
        'running legs, and a strike thrown on the move freezes his legs mid-stride',
    );
  }

  const gaits: ReadonlyArray<readonly [HumanGait, number]> = [
    ['run', PLAYER_SPEED],
    ['walk', PLAYER_SPEED * WADE_SPEED_FACTOR],
  ];
  for (const [view, facing] of VIEW_FACINGS) {
    replayGuardDrop(view, facing);
    const run = cycleRow('run', view);
    if (run === undefined) {
      fail('G20', `there is no ${view} run to replay setting off and stopping in`);
      continue;
    }
    for (const [gait, speed] of gaits) {
      const cycle = cycleRow(gait, view);
      if (cycle === undefined) {
        fail('G20', `there is no ${view} ${gait} to replay setting off and stopping in`);
        continue;
      }
      const limit = cycleStepPx(cycle);
      const ticksPerCycle = Math.ceil(
        (groundPxPerGaitFrame(gait, cycle.frameCount) * cycle.frameCount) / speed,
      );
      const report = newReport();
      const seenRows = new Set<HumanRowName>();
      for (let ticks = 1; ticks <= REPLAYED_CYCLES * ticksPerCycle; ticks++) {
        if (replaySetOffAndStop(facing, speed, ticks, limit, report, seenRows)) continue;
        fail(
          'G20',
          `stopped after ${ticks} ticks of ${view} ${gait}, he is not standing again within ` +
            `${REST_WITHIN_TICKS} ticks`,
        );
      }
      failUnlessMeasured('G20', report.measured, `cuts setting off and stopping a ${view} ${gait}`);
      if (!seenRows.has(cycle.name)) {
        fail(
          'G20',
          `the ${view} ${gait} replay never drew ${cycle.name}, so it measured another gait`,
        );
      }
      console.log(
        `  G20 ${view} ${gait} set-off/stop: ${report.measured} cuts, worst ` +
          `${report.worst.toFixed(PIXEL_DIGITS)} px (${report.worstAt}), limit ${limit.toFixed(PIXEL_DIGITS)}`,
      );
    }
    const runLimit = cycleStepPx(run);
    const runTicksPerCycle = Math.ceil(RUN_GROUND_PER_CYCLE_PX / PLAYER_SPEED);
    for (const smush of [false, true]) {
      const report = newReport();
      for (let offset = 0; offset < runTicksPerCycle; offset++) {
        replayBlowOnTheRun(facing, WALK_IN_TICKS + offset, smush, runLimit, report);
      }
      const kind = smush ? 'Smush' : 'strike';
      failUnlessMeasured(
        'G20',
        report.measured,
        `cuts into and out of a ${view} ${kind} on the run`,
      );
      console.log(
        `  G20 ${view} ${kind} on the run: ${report.measured} cuts, worst ` +
          `${report.worst.toFixed(PIXEL_DIGITS)} px (${report.worstAt}), limit ${runLimit.toFixed(PIXEL_DIGITS)}`,
      );
    }
  }
}

// ── G21: the status box is the art's own box ─────────────────────────────────

/** Cell pixels a status-box measurement may be off by: rounding, not a redraw. */
const STATUS_BOX_TOLERANCE_CELL_PX = 1.5;
/**
 * How far the frozen box may sit from the measured ink, in tile fractions:
 * a cell pixel and a half, under a pixel at the 32 px tile. The ink is
 * measured on whole cell pixels, so a tighter limit only measures rounding.
 */
const STATUS_BOX_TOLERANCE_TILES = STATUS_BOX_TOLERANCE_CELL_PX / TILE_SCALE;
/** In-game pixels the box's top may clear the hair by, so the health bar does not float. */
const STATUS_BOX_TOP_HEADROOM_IN_GAME_PX = 1.5;
const STATUS_BOX_TOP_HEADROOM_TILES = STATUS_BOX_TOP_HEADROOM_IN_GAME_PX / TILE_SIZE;

/**
 * G21 — `HUMAN_STATUS_FIGURE_BOX` in `HumanPlayer` still wraps his standing
 * ink. The health bar, the aggro marker and every status effect's placement
 * hang off that box, and nothing can measure ink at runtime, so it is frozen
 * there and re-measured here from the painted standing rows: the top must
 * clear the hair by no more than a pixel and a half at the 32 px tile, the
 * soles and the head-on half-width must sit within a pixel of the ink.
 *
 * Solid alpha only, so the soft ground and contact shadows under his feet do
 * not count as his soles.
 *
 * Measured on his body in the default outfit, whatever outfit the run gates:
 * the box wraps him, not his clothes, and gear standing off him — a cloak
 * flaring past his arms — lies outside it by design, the same in every outfit.
 */
function gateStatusFigureBox(): void {
  const tileCentreX = TILE_X + TILE_SCALE / 2;
  let topY = Number.POSITIVE_INFINITY;
  let soleY = Number.NEGATIVE_INFINITY;
  let headOnHalfWidth = 0;
  let framesMeasured = 0;
  for (const name of STANDING_ROWS) {
    const row = rowNamed(name, 'G21');
    if (row === null) continue;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const body = cellAlpha(row.name, frame, HUMAN_FIGURE);
      const solid = inkStatsOf(body, SOLID_ALPHA_THRESHOLD);
      if (solid.count === 0) continue;
      framesMeasured++;
      topY = Math.min(topY, solid.minY);
      soleY = Math.max(soleY, solid.maxY);
      if (VIEWS[row.view].profile) continue;
      const halfWidth = Math.max(tileCentreX - solid.minX, solid.maxX + 1 - tileCentreX);
      headOnHalfWidth = Math.max(headOnHalfWidth, halfWidth / TILE_SCALE);
    }
  }
  failUnlessMeasured('G21', framesMeasured, 'standing frames');
  if (framesMeasured === 0) return;
  const box = HUMAN_STATUS_FIGURE_BOX;
  const inkTop = (topY - TILE_Y) / TILE_SCALE;
  const inkSole = (soleY + 1 - TILE_Y) / TILE_SCALE;
  if (box.top > inkTop || inkTop - box.top > STATUS_BOX_TOP_HEADROOM_TILES) {
    fail(
      'G21',
      `the status box's top is ${box.top.toFixed(TILE_DIGITS)} of a tile but his hair tops out at ` +
        `${inkTop.toFixed(TILE_DIGITS)} — re-measure HUMAN_SPRITE_TOP_ABOVE_TILE`,
    );
  }
  if (Math.abs(box.bottom - inkSole) > STATUS_BOX_TOLERANCE_TILES) {
    fail(
      'G21',
      `the status box's bottom is ${box.bottom.toFixed(TILE_DIGITS)} of a tile but his soles reach ` +
        `${inkSole.toFixed(TILE_DIGITS)} — re-measure HUMAN_SOLE_BELOW_TILE_TOP`,
    );
  }
  if (Math.abs(box.halfWidth - headOnHalfWidth) > STATUS_BOX_TOLERANCE_TILES) {
    fail(
      'G21',
      `the status box is ${box.halfWidth.toFixed(TILE_DIGITS)} of a tile either side but he is ` +
        `${headOnHalfWidth.toFixed(TILE_DIGITS)} head-on — re-measure HUMAN_HALF_WIDTH_TILES`,
    );
  }
  console.log(
    `  G21 status box: ink top ${inkTop.toFixed(TILE_DIGITS)}, soles ${inkSole.toFixed(TILE_DIGITS)}, ` +
      `half-width ${headOnHalfWidth.toFixed(TILE_DIGITS)} against box ` +
      `${box.top.toFixed(TILE_DIGITS)} / ${box.bottom.toFixed(TILE_DIGITS)} / ${box.halfWidth.toFixed(TILE_DIGITS)}`,
  );
}

// ── G22: his right side is where the view puts it ────────────────────────────

/**
 * Which way across the screen his right shoulder lies from his left, per
 * head-on view: facing the camera his right side is on the viewer's left,
 * and from behind on the viewer's right. Profile has no lateral answer — his
 * right is the near side — so it has no entry.
 */
const RIGHT_SHOULDER_SCREEN_SIDE: Readonly<Partial<Record<CarlView, number>>> = {
  front: -1,
  back: 1,
};

/**
 * G22 — every head-on frame is drawn with his own right side where that view
 * puts it.
 *
 * A figure drawn with his right on the viewer's right from both front and
 * back is one of them in a mirror: the right-handed throw, the shell centred
 * on his right hand and the sling's fork in his left all swap hands as he
 * turns round, and no other gate sees it, because every one of them is
 * symmetric under a reflection. Measured on the probe, which names each limb
 * by his own side, so it is the probe's labelling and the painter's picture
 * that are checked together.
 */
function gateHandedness(): void {
  let framesMeasured = 0;
  for (const row of HUMAN_ROWS) {
    const expected = RIGHT_SHOULDER_SCREEN_SIDE[row.view];
    if (expected === undefined) continue;
    probesOf(row).forEach((probe, frame) => {
      framesMeasured++;
      const across = probe.rightArm.shoulder.x - probe.leftArm.shoulder.x;
      if (Math.sign(across) === expected) return;
      fail(
        'G22',
        `${row.name}[${frame}] draws his right shoulder ${across.toFixed(TILE_DIGITS)} px across ` +
          `from his left, on the wrong side of him for the ${row.view} view`,
        row.name,
      );
    });
  }
  failUnlessMeasured('G22', framesMeasured, 'head-on frames');
}

/** Gates in running order, by id. */
// ── G23: nothing is cut off at the composing surface's edge ──────────────────

/**
 * A layer margin that reaches every edge of the cell from any point inside it,
 * so the composing surface covers the whole cell and nothing the painter
 * draws there can be lost.
 */
const UNBOUNDED_LAYER_MARGIN = Math.max(frameWidth, frameHeight) / HUMAN_CELL_PX_PER_UNIT;
/**
 * A channel difference past rounding noise. The two paints share one pixel
 * grid and every pass, so an unclipped pixel matches exactly; a clipped one
 * loses its ink outright.
 */
const CLIPPED_CHANNEL_DELTA = 8;

/**
 * The largest channel difference between two pixels, colour weighted by its
 * alpha: a nearly transparent pixel's colour is rounding noise once
 * un-premultiplied, and differs between two paints that agree on what shows.
 */
function premultipliedDelta(a: Uint8ClampedArray, b: Uint8ClampedArray, index: number): number {
  const alphaA = a[index + ALPHA_OFFSET];
  const alphaB = b[index + ALPHA_OFFSET];
  let delta = Math.abs(alphaA - alphaB);
  for (const channel of [RED_OFFSET, GREEN_OFFSET, BLUE_OFFSET]) {
    const weightedA = (a[index + channel] * alphaA) / OPAQUE_ALPHA;
    const weightedB = (b[index + channel] * alphaB) / OPAQUE_ALPHA;
    delta = Math.max(delta, Math.abs(weightedA - weightedB));
  }
  return delta;
}

const DRAW_VIEW: Readonly<Record<CarlView, typeof drawCarlFront>> = {
  front: drawCarlFront,
  back: drawCarlBack,
  side: drawCarlSide,
};

/**
 * One cell painted as the gate outfit's figure paints it, composed with
 * `options`. Built from the same transform and dressed pose as
 * `paintDressedHumanFrame`, so with no options it matches the shipped cell.
 */
function composedCell(row: RowSpec, frame: number, options: CarlComposeOptions): Canvas {
  const cell = createCanvas(frameWidth, frameHeight);
  const ctx = asGameContext(cell.getContext('2d'));
  ctx.translate(ORIGIN_X, ORIGIN_Y);
  ctx.scale(TILE_SCALE, TILE_SCALE);
  ctx.scale(HUMAN_SCALE, HUMAN_SCALE);
  const pose = dressedPose(gateAppearance, row.pose(frame), row, frame);
  DRAW_VIEW[row.view](ctx, pose, options);
  return cell;
}

function unboundedCell(row: RowSpec, frame: number): Uint8ClampedArray {
  return composedCell(row, frame, { layerMargin: UNBOUNDED_LAYER_MARGIN })
    .getContext('2d')
    .getImageData(0, 0, frameWidth, frameHeight).data;
}

/**
 * G23 — the painter's composing surface holds everything painted on it.
 *
 * The surface is sized round the skeleton and whatever each held prop says it
 * reaches, and ink past it is sheared off along a straight line: a board on
 * the floor with its far end missing, a flame without a tip. Every cell is
 * painted again on a surface that covers the whole cell and the two compared;
 * any pixel that differs was cut off in the shipped one.
 */
function gateLayerHoldsInk(): void {
  let cellsCompared = 0;
  for (const row of HUMAN_ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      const shipped = bakeFigureCell(gateFigure, row.name, frame)
        .getContext('2d')
        .getImageData(0, 0, frameWidth, frameHeight).data;
      const unbounded = unboundedCell(row, frame);
      cellsCompared++;
      let clipped = 0;
      for (let i = 0; i < shipped.length; i += CHANNELS) {
        if (premultipliedDelta(shipped, unbounded, i) > CLIPPED_CHANNEL_DELTA) clipped++;
      }
      if (clipped > 0) {
        fail(
          'G23',
          `${row.name}[${frame}] loses ${clipped} px at the composing surface's edge — ` +
            'something painted past the skeleton does not state its reach',
          row.name,
        );
      }
    }
  }
  failUnlessMeasured('G23', cellsCompared, 'cells');
}

// ── G24: the gauntlet turns to steel on the blow ─────────────────────────────

/**
 * What the gauntlet is on each frame of a right-fisted punch, by frames from
 * the one the blow lands on: steel from the frame before to the frame after,
 * the puff it vanishes in, and that puff thinning. Every other frame, and
 * every frame of any other row, it is the bracer.
 */
const STEEL_FRAMES_BEFORE_IMPACT = 1;
const STEEL_FRAMES_AFTER_IMPACT = 1;
const SMOKE_FRAMES_AFTER_IMPACT = 2;
const WISP_FRAMES_AFTER_IMPACT = 3;
const GAUNTLET_TIMELINE: ReadonlyMap<number, GauntletForm> = new Map<number, GauntletForm>([
  [-STEEL_FRAMES_BEFORE_IMPACT, 'spiked'],
  [0, 'spiked'],
  [STEEL_FRAMES_AFTER_IMPACT, 'spiked'],
  [SMOKE_FRAMES_AFTER_IMPACT, 'smoke'],
  [WISP_FRAMES_AFTER_IMPACT, 'wisp'],
]);
/** The blow the gauntlet is best known for; a punch set without it has lost its probe. */
const SIGNATURE_PUNCH_ROW: HumanRowName = 'cross_side';
/** Carl in the gauntlet and nothing else he would not wear by default. */
const GAUNTLET_ONLY: HumanAppearance = { ...DEFAULT_HUMAN_APPEARANCE, gauntlet: true };
/**
 * The fewest pixels the spiked steel may change on a punch's impact frame
 * against the bracer on the same pose. Measured on the shipped art, the
 * smallest punch changes 25 px (the back-view hammer fist, the head in front
 * of the fist); half of that still fires the moment the steel stops being painted at all, which changes none.
 */
const MIN_STEEL_CHANGED_PX = 12;

/** A punch's impact cell in the gauntlet, with the gauntlet forced to `form`. */
function gauntletCell(row: RowSpec, frame: number, form: GauntletForm): Uint8ClampedArray {
  const cell = createCanvas(frameWidth, frameHeight);
  const ctx = asGameContext(cell.getContext('2d'));
  ctx.translate(ORIGIN_X, ORIGIN_Y);
  ctx.scale(TILE_SCALE, TILE_SCALE);
  ctx.scale(HUMAN_SCALE, HUMAN_SCALE);
  const dressed = dressedPose(GAUNTLET_ONLY, row.pose(frame), row, frame);
  DRAW_VIEW[row.view](ctx, { ...dressed, gear: { ...dressed.gear, gauntlet: form } });
  return cell.getContext('2d').getImageData(0, 0, frameWidth, frameHeight).data;
}

/**
 * G24's timeline is read off `gauntletFormAt`, which says what the gauntlet
 * *is* on a frame and never that the painter drew it: a painter that paints
 * the bracer whatever the form passes the timeline on every frame. So on each
 * punch's impact frame the cell is painted with the steel and with the bracer,
 * and the two must differ.
 */
function checkSteelPainted(row: RowSpec, impact: number): void {
  const steel = gauntletCell(row, impact, 'spiked');
  const bracer = gauntletCell(row, impact, 'bracer');
  let changed = 0;
  for (let i = 0; i < steel.length; i += CHANNELS) {
    if (premultipliedDelta(steel, bracer, i) > CLIPPED_CHANNEL_DELTA) changed++;
  }
  if (changed < MIN_STEEL_CHANGED_PX) {
    fail(
      'G24',
      `${row.name}[${impact}] paints the same cell with the gauntlet spiked as with the bracer ` +
        `(${changed} px differ, need ${MIN_STEEL_CHANGED_PX}) — the steel is not painted`,
      row.name,
    );
  }
}

/**
 * The set of punches the steel appears on is read off each strike's
 * `reachLimb`, so a row re-declared to another limb drops out of it silently —
 * and an empty set means the gauntlet never spikes at all while every picture
 * of it still looks right. G5 holds the declared fist to the rig.
 */
function gateGauntletTiming(): void {
  const punches = new Set<HumanRowName>(HUMAN_RIGHT_PUNCH_ROWS);
  if (punches.size === 0) {
    fail('G24', 'no row is a right-fisted punch, so the gauntlet never turns to steel');
  }
  if (!punches.has(SIGNATURE_PUNCH_ROW)) {
    fail('G24', `${SIGNATURE_PUNCH_ROW} is not among the right-fisted punches`);
  }
  let punchRowsTimed = 0;
  for (const row of HUMAN_ROWS) {
    const impact = firstImpactFrame(row);
    const punch = punches.has(row.name) && impact !== undefined;
    if (punch) {
      punchRowsTimed++;
      checkSteelPainted(row, impact);
    }
    for (let frame = 0; frame < row.frameCount; frame++) {
      const fromImpact = impact === undefined ? undefined : frame - impact;
      const timed =
        punch && fromImpact !== undefined ? GAUNTLET_TIMELINE.get(fromImpact) : undefined;
      const expected: GauntletForm = timed ?? 'bracer';
      const actual = gauntletFormAt(row, frame);
      if (actual === expected) continue;
      fail(
        'G24',
        `${row.name}[${frame}] paints the gauntlet as ${actual}; ${fromImpact ?? 'no'} frame(s) ` +
          `from impact it should be ${expected}`,
        row.name,
      );
    }
  }
  failUnlessMeasured('G24', punchRowsTimed, 'right-fisted punch rows');
}

// ── G25: edge-on, the face is never hidden behind the near arm ───────────────

/**
 * How far the near arm's bones must pass from the profile eye, in head radii.
 * A sleeved arm is about 0.3 of a head radius from its bone to its edge, so
 * this keeps the eye itself clear of it. Every frame that read as the back of
 * his head measured 0.37 or less (the arm across the face, only the hair and
 * the ear left showing); the nearest a readable face comes is 0.72, a
 * throw's release passing under the eye.
 */
const PROFILE_EYE_CLEARANCE_HEAD_RADII = 0.5;
/**
 * How far above the shoulders the head must stand for the frame to count as
 * upright. Lying on the floor his arm may fall across his face; standing,
 * crouched or kneeling it may not.
 */
const UPRIGHT_HEAD_RISE_HEAD_RADII = 0.5;

function distanceToSegment(point: Pt, from: Pt, to: Pt): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  const along =
    lengthSquared === 0
      ? 0
      : Math.min(
          1,
          Math.max(0, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared),
        );
  return Math.hypot(point.x - from.x - along * dx, point.y - from.y - along * dy);
}

/**
 * G25 — on every upright profile frame the eye is clear of the near arm.
 *
 * Edge-on his right arm is the near one and is painted over the head. Laid
 * across the face it leaves only the hair and the ear, which is the back of a
 * head: a row whose near arm swings over his face reads as him turning his
 * back on the camera between frames. Nothing else notices — the head painter
 * always paints the face, and every ink gate sees a head-sized blob either
 * way. Measured on the solved skeleton against the eye landmark the head
 * painter draws from.
 */
function gateProfileFaceShows(): void {
  let framesMeasured = 0;
  for (const row of HUMAN_ROWS) {
    if (row.view !== 'side') continue;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const pose = poseAsDrawn(row.pose(frame), VIEWS.side);
      const skeleton = buildSkeleton(pose, VIEWS.side);
      const headRise = (skeleton.shoulderCentre.y - skeleton.headCentre.y) / HEAD_RY;
      if (headRise < UPRIGHT_HEAD_RISE_HEAD_RADII) continue;
      framesMeasured++;
      const eye = profileEyeCentre(skeleton, pose);
      const nearArm = skeleton.rightArm;
      const clearance =
        Math.min(
          distanceToSegment(eye, nearArm.root, nearArm.joint),
          distanceToSegment(eye, nearArm.joint, nearArm.end),
        ) / HEAD_RY;
      if (clearance >= PROFILE_EYE_CLEARANCE_HEAD_RADII) continue;
      fail(
        'G25',
        `${row.name}[${frame}] lays the near arm ${clearance.toFixed(2)} head radii from the eye ` +
          `(need ${PROFILE_EYE_CLEARANCE_HEAD_RADII}) — the face is hidden and the head reads ` +
          'as the back of it',
        row.name,
      );
    }
  }
  failUnlessMeasured('G25', framesMeasured, 'upright profile frames');
}

// ── G27: edge-on, the head is clearly shallower than the chest ───────────────

/**
 * The most the profile head — back of the hair to the tip of the nose — may
 * measure against the jacket's chest depth. A heavy-framed man's head is
 * about 21 cm deep with its hair against a 28–30 cm chest; at 0.8 of it the
 * head read as big as the torso in every edge-on frame, a bobblehead in a
 * profile that is otherwise a heavy man.
 */
const PROFILE_HEAD_TO_CHEST_LIMIT = 0.7;
/** Pixels per rig unit the head and jacket are painted at to be measured. */
const HEAD_DEPTH_GATE_PX_PER_UNIT = 200;
/** Side of the square surface each part is painted on, in rig units. */
const HEAD_DEPTH_GATE_SURFACE_UNITS = 3;
/**
 * The chest band, measured down the spine from the shoulder line in rig
 * units: below the collar and trapezius, above the belly, where the ribcage
 * is deepest.
 */
const CHEST_BAND_TOP = 0.08;
const CHEST_BAND_BOTTOM = 0.3;

interface InkRows {
  /** Leftmost and rightmost solid column of each row, or `null` for an empty row. */
  readonly rows: readonly ({ left: number; right: number } | null)[];
}

function solidRowsOf(canvas: Canvas): InkRows {
  const { width, height } = canvas;
  const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  const rows: ({ left: number; right: number } | null)[] = [];
  for (let y = 0; y < height; y++) {
    let left = -1;
    let right = -1;
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * CHANNELS + ALPHA_OFFSET] < SOLID_ALPHA_THRESHOLD) continue;
      if (left < 0) left = x;
      right = x;
    }
    rows.push(left < 0 ? null : { left, right });
  }
  return { rows };
}

/** The widest solid span across rows `top..bottom` of an ink map, in pixels. */
function widestSpan(ink: InkRows, top: number, bottom: number): number {
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  for (let y = Math.max(0, top); y <= Math.min(ink.rows.length - 1, bottom); y++) {
    const row = ink.rows[y];
    if (row === null) continue;
    left = Math.min(left, row.left);
    right = Math.max(right, row.right);
  }
  return right < left ? 0 : right - left + 1;
}

/**
 * Paints one part on its own square surface, centred on `centre` and turned
 * by `-angle` so the part is measured upright in its own frame.
 */
function paintPartUpright(
  centre: Pt,
  angle: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
): Canvas {
  const side = HEAD_DEPTH_GATE_SURFACE_UNITS * HEAD_DEPTH_GATE_PX_PER_UNIT;
  const canvas = createCanvas(side, side);
  const ctx = asGameContext(canvas.getContext('2d'));
  ctx.translate(side / 2, side / 2);
  ctx.scale(HEAD_DEPTH_GATE_PX_PER_UNIT, HEAD_DEPTH_GATE_PX_PER_UNIT);
  ctx.rotate(-angle);
  ctx.translate(-centre.x, -centre.y);
  paint(ctx);
  return canvas;
}

/**
 * G27 — on every upright profile frame the head is no deeper than
 * {@link PROFILE_HEAD_TO_CHEST_LIMIT} of the chest.
 *
 * The head and the jacket are each painted alone, upright in their own
 * frames — the head in its own rotation, the jacket along the spine — so an
 * arm laid across either, a lean or a tipped head never widens what is
 * measured. The head's depth is its whole ink: hair, skull, nose and ear.
 */
function gateProfileHeadDepth(): void {
  const view = VIEWS.side;
  let framesMeasured = 0;
  let worst = 0;
  let worstAt = '';
  for (const row of HUMAN_ROWS) {
    if (row.view !== 'side') continue;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const pose = poseAsDrawn(row.pose(frame), view);
      const skeleton = buildSkeleton(pose, view);
      const headRise = (skeleton.shoulderCentre.y - skeleton.headCentre.y) / HEAD_RY;
      if (headRise < UPRIGHT_HEAD_RISE_HEAD_RADII) continue;
      framesMeasured++;
      const headAngleNow = headAngle(pose);
      const head = paintPartUpright(skeleton.headCentre, headAngleNow, (ctx) => {
        ctx.translate(skeleton.headCentre.x, skeleton.headCentre.y);
        ctx.rotate(headAngleNow);
        drawHead(ctx, pose, view);
      });
      const toWaist = {
        x: skeleton.waist.x - skeleton.shoulderCentre.x,
        y: skeleton.waist.y - skeleton.shoulderCentre.y,
      };
      const spineTilt = Math.atan2(toWaist.y, toWaist.x) - Math.PI / 2;
      const jacket = paintPartUpright(skeleton.shoulderCentre, spineTilt, (ctx) =>
        drawJacket(ctx, skeleton, pose, view),
      );
      const headInk = solidRowsOf(head);
      const headDepth = widestSpan(headInk, 0, headInk.rows.length - 1);
      const shoulderRow = head.height / 2;
      const chestDepth = widestSpan(
        solidRowsOf(jacket),
        Math.round(shoulderRow + CHEST_BAND_TOP * HEAD_DEPTH_GATE_PX_PER_UNIT),
        Math.round(shoulderRow + CHEST_BAND_BOTTOM * HEAD_DEPTH_GATE_PX_PER_UNIT),
      );
      if (chestDepth === 0) {
        fail('G27', `${row.name}[${frame}] paints no jacket in the chest band`, row.name);
        continue;
      }
      const share = headDepth / chestDepth;
      if (share > worst) {
        worst = share;
        worstAt = `${row.name}[${frame}]`;
      }
      if (share <= PROFILE_HEAD_TO_CHEST_LIMIT) continue;
      fail(
        'G27',
        `${row.name}[${frame}] draws the head ${share.toFixed(2)} of the chest's depth ` +
          `(limit ${PROFILE_HEAD_TO_CHEST_LIMIT}) — edge-on it reads as big as his torso`,
        row.name,
      );
    }
  }
  failUnlessMeasured('G27', framesMeasured, 'upright profile frames');
  console.log(`  G27 profile head depth: worst ${worst.toFixed(2)} of the chest at ${worstAt}`);
}

// ── G26: a head-on leg keeps its length on the move ─────────────────────────

/**
 * The most a head-on leg may be drawn longer, hip to ankle, than his standing
 * leg, as a share of it. A leg on the move bends and lifts, so it is shorter
 * than it stands; drawn longer, it is being stretched, and the eye reads the
 * leg growing as the body runs up the screen.
 */
const HEAD_ON_LEG_GROWTH_LIMIT = 0.1;
/**
 * The most the floor's depth may lengthen or shorten a planted head-on leg as
 * drawn, against the same leg drawn with no depth at all, as a share of his
 * standing leg. What a bent knee or a heel on its toes takes off the leg is
 * the leg's own; what the projection adds or takes off is a leg telescoping.
 */
const HEAD_ON_LEG_DEPTH_STRETCH_LIMIT = 0.1;
/** Shares are reported as percentages. */
const PERCENT = 100;

function drawnLength(from: Pt, to: Pt): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

/**
 * G26 — head-on, a leg on the move never grows or telescopes.
 *
 * Head-on the floor ahead of him is drawn as screen height, and a planted
 * foot held to the floor while the hips ride with the sprite would draw the
 * leg between them longer and shorter through every stance. Every leg on
 * every head-on travelling frame is held to the standing leg's length, and
 * every planted one to the length it would have with no floor depth drawn.
 */
function gateHeadOnLegLength(): void {
  const standing = probeHumanJoints('idle', 0);
  const standingLeg =
    LEG_SIDES.reduce((sum, side) => {
      const leg = legOf(standing, side);
      return sum + drawnLength(leg.hip, leg.ankle);
    }, 0) / LEG_SIDES.length;
  let legsMeasured = 0;
  let plantedMeasured = 0;
  let worstGrowth = Number.NEGATIVE_INFINITY;
  let worstStretch = 0;
  for (const row of HUMAN_ROWS) {
    if (row.view === 'side' || row.locomotion !== 'travelling') continue;
    probesOf(row).forEach((probe, frame) => {
      for (const side of LEG_SIDES) {
        const leg = legOf(probe, side);
        const drawn = drawnLength(leg.hip, leg.ankle);
        const growth = drawn / standingLeg - 1;
        legsMeasured++;
        worstGrowth = Math.max(worstGrowth, growth);
        if (growth > HEAD_ON_LEG_GROWTH_LIMIT) {
          fail(
            'G26',
            `${row.name}[${frame}] draws the ${side} leg ${(growth * PERCENT).toFixed(0)}% longer ` +
              `than he stands (limit ${HEAD_ON_LEG_GROWTH_LIMIT * PERCENT}%) — the leg grows`,
            row.name,
          );
        }
        if (leg.planted !== true || leg.uprightAnkle === undefined) continue;
        plantedMeasured++;
        const stretch = Math.abs(drawn - drawnLength(leg.hip, leg.uprightAnkle)) / standingLeg;
        worstStretch = Math.max(worstStretch, stretch);
        if (stretch <= HEAD_ON_LEG_DEPTH_STRETCH_LIMIT) continue;
        fail(
          'G26',
          `${row.name}[${frame}]'s planted ${side} leg is drawn ` +
            `${(stretch * PERCENT).toFixed(0)}% of a standing leg off its length with no floor ` +
            `depth (limit ${HEAD_ON_LEG_DEPTH_STRETCH_LIMIT * PERCENT}%) — the floor's ` +
            'projection telescopes it',
          row.name,
        );
      }
    });
  }
  failUnlessMeasured('G26', legsMeasured, 'head-on travelling legs');
  failUnlessMeasured('G26', plantedMeasured, 'planted head-on travelling legs');
  console.log(
    `  G26 head-on legs: longest ${(worstGrowth * PERCENT).toFixed(1)}% over standing, ` +
      `planted stretch ${(worstStretch * PERCENT).toFixed(1)}% of a standing leg`,
  );
}

const GATES: ReadonlyArray<readonly [string, () => void]> = [
  ['G1', gateStructure],
  ['G2', gateCellGeometry],
  ['G3', gateLoopClosure],
  ['G4', gateMotionContinuity],
  ['G5', gateStrikePeaksOnImpact],
  ['G6', gateStompLandsOnImpact],
  ['G7', gateStampAnchor],
  ['G8', gateRuntimeStates],
  ['G9', gateWarmRowSize],
  ['G9b', gateWorkingSet],
  ['G10', gateFootSlip],
  ['G11', gateArmPhase],
  ['G12', gateBlink],
  ['G13', gateLegReach],
  ['G14', gateFlight],
  ['G15', gateImpactTiming],
  ['G16', gateViewConsistency],
  ['G17', gateMuscleRead],
  ['G18', gateSilhouetteSize],
  ['G19', gateOutlinePolicy],
  ['G20', gateHandOff],
  ['G21', gateStatusFigureBox],
  ['G22', gateHandedness],
  ['G23', gateLayerHoldsInk],
  ['G24', gateGauntletTiming],
  ['G25', gateProfileFaceShows],
  ['G26', gateHeadOnLegLength],
  ['G27', gateProfileHeadDepth],
];

/**
 * Runs every gate and returns one message per failure that should fail the
 * run. Failures from {@link PENDING_GATES} are printed here instead, as is a
 * pending gate that has gone green.
 */
export function humanGateFailures(
  appearance: HumanAppearance = DEFAULT_HUMAN_APPEARANCE,
): string[] {
  gateAppearance = appearance;
  gateFigure = humanFigureWearing(appearance);
  alphaByCell.clear();
  failures.length = 0;
  const known = new Set(GATES.map(([id]) => id));
  for (const id of PENDING_GATES) {
    if (!known.has(id))
      failures.push({ id, message: `PENDING_GATES names ${id}, which is no gate` });
  }
  for (const [, run] of GATES) run();

  const blocking: string[] = [];
  const pendingRed = new Set<string>();
  const pendingRowsRed = new Set<string>();
  for (const { id, message, row } of failures) {
    if (PENDING_GATES.has(id)) {
      pendingRed.add(id);
      console.log(`  PENDING ${id}: ${message}`);
      continue;
    }
    if (isPendingRow(id, row)) {
      pendingRowsRed.add(id);
      console.log(`  PENDING ${id} (${row ?? ''}): ${message}`);
      continue;
    }
    blocking.push(`${id}: ${message}`);
  }
  for (const id of PENDING_GATES) {
    if (!known.has(id) || pendingRed.has(id)) continue;
    console.log(
      `  NOTICE ${id} is now green — remove it from PENDING_GATES in scripts/gates-human.ts`,
    );
  }
  for (const [id, pending] of PENDING_ROWS) {
    if (!known.has(id)) {
      blocking.push(`${id}: PENDING_ROWS names ${id}, which is no gate`);
      continue;
    }
    if (pendingRowsRed.has(id)) {
      console.log(`  PENDING ${id} rows: ${pending.why}`);
      continue;
    }
    console.log(
      `  NOTICE ${id}'s pending rows are all green — remove its PENDING_ROWS entry in ` +
        'scripts/gates-human.ts',
    );
  }
  console.log(`  pending gates: ${[...PENDING_GATES].join(', ') || 'none'}`);
  const pendingRowGates = [...PENDING_ROWS.keys()].join(', ') || 'none';
  console.log(`  gates with pending rows: ${pendingRowGates}`);
  return blocking;
}
