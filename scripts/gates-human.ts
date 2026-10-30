/**
 * The human's art gates.
 *
 * These gates enforce sheet-shape invariants — a pose that fits its cell, a
 * strike that lands on the frame the hit is scored on — directly against
 * cells painted from `undressedHumanFigure(look)`, baked exactly the way the runtime cache
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
import { humanStatusFigureBoxOf, HumanPlayer } from '../src/creatures/HumanPlayer.js';
import { Goblin } from '../src/creatures/Goblin.js';
import { type Mob } from '../src/creatures/Mob.js';
import { Rat } from '../src/creatures/Rat.js';
import { makeStun } from '../src/core/combat/StatusEffect.js';
import {
  figureByteBudgetFor,
  IDLE_FRAMES_BEFORE_RELEASE,
} from '../src/sprites/figure/figureFrameCache.js';
import { getSeismicStompStats, SEISMIC_STOMP_DEF } from '../src/abilities/seismicStomp.js';
import { bakeFigureCell, paintFigureCell } from './figureSheet.js';
import { asGameContext } from './nodeGameContext.js';
import {
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
  storedRowBytes,
} from './figureGates.js';
import {
  GROUND_OFFSET_IN_TILE,
  undressedHumanFigure,
  HUMAN_ROW_BOOK,
  HUMAN_ROW_NAMES,
  HUMAN_ROW_TABLE,
  HUMAN_ROWS,
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
  PLAYER_HUMAN_CELL_PX_PER_UNIT,
  PLAYER_HUMAN_SIZE_OVER_RIG,
  TILE_CENTRE_FRACTION,
  TILE_SCALE,
} from '../src/sprites/art/human/figureScale.js';
import { STOMP_DOWN_IMPACT } from '../src/sprites/art/human/strikesDown.js';
import {
  SEISMIC_STOMP_HOP_PRESS_FRAMES,
  SEISMIC_STOMP_PRESS_FRAMES,
} from '../src/sprites/art/human/stomps.js';
import {
  RUN_FRAMES,
  SEISMIC_STOMP_IMPACT_FRAME,
  TICKS_PER_SECOND,
  WALK_FRAMES,
} from '../src/sprites/art/human/timing.js';
import {
  groundPxPerGaitFrame,
  type HumanJointProbe,
  type ProbedArm,
  type ProbedLeg,
  probeHumanJoints,
  probeRowJoints,
  TRAVEL_DIRECTION,
  floorDriftPerFrameCellPx,
} from '../src/sprites/art/human/probe.js';
import { stampAnchorOf } from '../src/sprites/art/human/sockets.js';
import { type CarriedGrip, carriedGripKey, carryStyleOf } from '../src/sprites/art/human/carry.js';
import { type Pt } from '../src/sprites/art/bipedArt.js';
import { type BareSegment, bareSegmentEdges } from '../src/sprites/art/biped/limbs.js';
import { HEAD_ON_TOE_DROP } from '../src/sprites/art/biped/feet.js';
import {
  CAST_SHADOW_TONE,
  type BipedComposeOptions,
  drawBipedBack,
  drawBipedFront,
  drawBipedSide,
  OUTLINE_PX,
} from '../src/sprites/art/biped/figure.js';
import { DAVE_DENIM } from '../src/sprites/garments/human/daveTrousers.js';
import { DAVE_LOOK } from '../src/sprites/looks/humans/dave.js';
import { BROTHER_ANSELM_LOOK } from '../src/sprites/looks/humans/brotherAnselm.js';
import { MALE_LIGHT_LOOK } from '../src/sprites/looks/humans/maleLight.js';
import type { HumanCrawlerLookId } from '../src/characters/crawlerChoices.js';
import { HUMAN_CRAWLER_LOOKS } from '../src/characters/humanCrawlerLooks.js';
import { BELT_LEATHER, SLATE_CHINO_CLOTH } from '../src/sprites/garments/human/chinos.js';
import { GOLD_WATCH_DEEP, SMARTWATCH_FACE } from '../src/sprites/garments/human/wristwatches.js';
import { STONE_TROUSER_CLOTH } from '../src/sprites/garments/human/taperedTrousers.js';
import { JACKET_BELT_LEATHER } from '../src/sprites/garments/human/beltedJacket.js';
import {
  type HumanLook,
  playerLookAxes,
  playerStatureScale,
  withLookBuild,
} from '../src/sprites/looks/humanLook.js';
import {
  buildSkeleton,
  type BipedPose,
  type Skeleton,
  FULL_UPPER_ARM,
  poseAsDrawn,
  VIEWS,
} from '../src/sprites/art/biped/rig.js';
import {
  type CardinalView,
  FACING_HYSTERESIS_DEGREES,
  FACING_VIEWS,
  type FacingSelection,
  type FacingView,
  selectFacing,
} from '../src/sprites/facingView.js';
import {
  drawHead,
  headAngle,
  profileEyeCentre,
  scaleHeadAboutChin,
} from '../src/sprites/art/biped/head.js';
import {
  defaultOutfitOf,
  humanWornOn,
  stillOutfit,
} from '../src/sprites/garments/human/humanDressing.js';
import { outfitOf, type Outfit, paintOutfitPart } from '../src/sprites/garments/outfit.js';
import { torsoFrame } from '../src/sprites/art/biped/torso.js';
import { FOREARM_LENGTH, HEAD_RY, UPPER_ARM_LENGTH } from '../src/sprites/art/biped/proportions.js';
import {
  alwaysDrawnRows,
  activeHumanLook,
  explosiveHeldDraw,
  HUMAN_ATTACK_ROWS,
  motionSetOfRow,
  type HumanRowSelection,
  rowFrameHolds,
  rowLengthInTicks,
  humanRowView,
  residentViewSpans,
  setHumanLook,
} from '../src/sprites/humanSprite.js';
import {
  ARMED_MOTION_SETS,
  ARMED_SET_GRIP,
  MOTION_SETS,
  motionSetOf,
  type MotionSet,
} from '../src/sprites/art/human/motionSets.js';
import { GRIP_ARCHETYPES } from '../src/sprites/held/gripArchetypes.js';
import { HELD_VISUALS } from '../src/sprites/held/heldVisuals.js';
import { compositeHeldItem, heldTransformAt } from '../src/sprites/held/heldComposite.js';
import { ITEM_DEF, isItemId, type ItemId, weaponStatsOf } from '../src/core/items/defs/ItemDefs.js';
import {
  dressedPose,
  type HumanFigure,
  humanFigureFor,
  humanFigureWearing,
} from '../src/sprites/art/human/appearance.js';
import { type RigFigure, type RigRows, rigRowsOf } from './rigFigure.js';
import { type FigureDef, figureStates } from '../src/sprites/figure/figureDef.js';
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
import { useDevPlayerIdentity } from '../src/dev/devPlayerIdentity.js';

useDevPlayerIdentity();

// The human painter composes each cell on scratch surfaces of its own, which
// `allocCanvas` makes with `document.createElement('canvas')` outside a browser.
installCanvasGlobals();

const INK_ALPHA_THRESHOLD = 24;
const SOLID_ALPHA_THRESHOLD = 200;
const CHANNELS = 4;
const ALPHA_OFFSET = 3;
const OPAQUE_ALPHA = 255;

const { frameWidth, frameHeight } = undressedHumanFigure(MALE_LIGHT_LOOK);

interface GateFailure {
  readonly id: string;
  readonly message: string;
  /** The row the failure is about, when it is about one; what per-row pending keys on. */
  readonly row?: string;
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
 * empty when the human figure is finished: every entry here is a known way the
 * art is still wrong.
 */
export const PENDING_GATES: ReadonlySet<string> = new Set<string>();

/** Rows one gate is not yet held to, and why. */
interface PendingRows {
  readonly roles: readonly HumanRowRole[];
  readonly names: readonly string[];
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
 * when the human figure is finished. An entry whose rows have all gone green
 * prints a notice to take it out.
 */
export const PENDING_ROWS: ReadonlyMap<string, PendingRows> = new Map<string, PendingRows>();

function isPendingRow(id: string, row: string | undefined): boolean {
  const pending = PENDING_ROWS.get(id);
  if (pending === undefined || row === undefined) return false;
  const role = gateRows.rowOf(row)?.role;
  return pending.names.includes(row) || (role !== undefined && pending.roles.includes(role));
}

/** Decimal places a reported reach or tile position is printed to. */
const REACH_DIGITS = 3;
const TILE_DIGITS = 4;

function fail(id: string, message: string, row?: string): void {
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
 * The outfit the pixel gates paint the human figure in, and its figure: the default
 * unless a run names another. Every outfit is a figure of its own, and each
 * one's cells must hold to the same gates.
 */
let gateLook: HumanLook = MALE_LIGHT_LOOK;
let gateOutfit: Outfit<'human'> = defaultOutfitOf(gateLook);
/**
 * The clothes G27 measures the chest of: the crawler's own base clothes, which
 * every outfit of his is worn over, or the whole outfit of a figure on the rig
 * whose base garments are hidden under its own.
 */
let gateTorsoOutfit: Outfit<'human'> = outfitOf(gateLook, []);
/** The crawler's rows, which every gate holds his looks to. */
const CRAWLER_RIG_ROWS: RigRows = rigRowsOf(HUMAN_ROW_BOOK, humanFigureFor);

/** The row book the gates paint from, and the rows of it the per-row gates measure. */
let gateRows: RigRows = CRAWLER_RIG_ROWS;
let gatedRows: readonly RowSpec<string>[] = gateRows.rows;

const gateFigures = new Map<string, RigFigure>();

/** The gated look in `outfit`, painted from the gated book; built once per book, look, outfit and grip. */
function gateFigureFor(outfit: Outfit<'human'>, held: CarriedGrip | null = null): RigFigure {
  const grip = held === null ? 'empty' : carriedGripKey(held);
  const key = `${gateRows.id}:${gateLook.id}:${outfit.key}:${grip}`;
  const known = gateFigures.get(key);
  if (known !== undefined) return known;
  const built = gateRows.figureFor(gateLook, outfit, held);
  gateFigures.set(key, built);
  return built;
}

let gateFigure: FigureDef = gateFigureFor(gateOutfit).def;

/** The look's figure in the outfit every row was authored in. */
function authoredFigure(): RigFigure {
  return gateFigureFor(defaultOutfitOf(gateLook));
}

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

function rowNamed(name: string, gateId: string): RowSpec<string> | null {
  const row = gateRows.rowOf(name);
  if (row === undefined) {
    fail(gateId, `there is no row named "${name}" — the gate below it measured nothing`);
    return null;
  }
  return row;
}

// ── G1: structure ────────────────────────────────────────────────────────────

function gateStructure(): void {
  const frames: Record<string, number> = {};
  for (const row of gatedRows) frames[row.name] = row.frameCount;
  const gated = { ...gateFigure, states: figureStates(frames) };
  for (const failure of figureStructuralFailures(gated)) fail('G1', failure);
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
  // Head-on his toes run down the screen past the sole line toward the camera,
  // by a drop that grows with the size he is drawn at; it is the art's own,
  // not drift, so his lowest ink is held to the line plus it.
  const toeDropPx = (view: CardinalView): number =>
    view === 'front' ? HEAD_ON_TOE_DROP * cellPxPerUnitDown(view) : 0;
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
    const toeDrop = toeDropPx(row.view);
    const drop = Math.abs(solid.maxY - groundY - toeDrop);
    if (drop > GROUND_TOLERANCE_PX) {
      fail(
        'G2',
        `${name}[0] has its lowest solid ink at y=${solid.maxY} against a ground line of ` +
          `${groundY} (tileY ${TILE_Y} + ${GROUND_OFFSET_IN_TILE} of a ${TILE_SCALE}px tile) ` +
          `and a head-on toe drop of ${toeDrop.toFixed(1)}px — ` +
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
 * and the cat's dance at frame 6 of 12, because those rows run two whole turns of
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
 * which would collapse the floor into `seam >= 0`. Every look's shipped loops
 * wrap well clear of 0.5 of their median step, bar a row a look's gate spec
 * names with a floor of its own (`loopSeamFloors`), and a collapsed seam
 * measures near zero, so 0.5 still fires the moment one collapses.
 */
const LOOP_SEAM_FLOOR = 0.5;

/** G3's seam ceiling: the wrap may not jump further than the row's largest step. */
function failOnSeamPop(
  rowName: string,
  cells: readonly Uint8ClampedArray[],
  dressedIn: string,
): void {
  const steps: number[] = [];
  for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
  const seam = frameDelta(cells[cells.length - 1], cells[0]);
  const largestStep = Math.max(...steps);
  const ceiling = largestStep * LOOP_SEAM_CEILING;
  if (seam <= ceiling) return;
  fail(
    'G3',
    `${rowName} pops across its loop seam in ${dressedIn}: last→first differs by ${seam}px ` +
      `against a largest in-cycle step of ${largestStep}px (ceiling ${ceiling.toFixed(0)}px) — ` +
      'the cycle does not end where it began',
  );
}

/**
 * G3 — a loop must close: not a pop across its seam, and not a held frame.
 *
 * The held-frame floor is measured on the look in its base clothes: a garment
 * hung behind him would fill the background his arms gesture against, and the
 * motion it hides is hidden at the seam and in the steps by different amounts,
 * so a seam that is fine reads as held. A pop only grows under a garment, so
 * the seam ceiling is held on the base clothes and on the outfit under test,
 * and whether the row closes is measured on the outfit, since a garment's own
 * motion has to close as well.
 */
function gateLoopClosure(): void {
  let loopsMeasured = 0;
  const baseFigure = gateFigureFor(outfitOf(gateLook, [])).def;
  for (const row of gatedRows) {
    if (row.kind !== 'loop') continue;
    loopsMeasured++;
    const cells = Array.from({ length: row.frameCount }, (_unused, frame) =>
      cellAlpha(row.name, frame, baseFigure),
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
    failOnSeamPop(row.name, cells, 'base clothes');
    if (gateFigure.id !== baseFigure.id) {
      const worn = Array.from({ length: row.frameCount }, (_unused, frame) =>
        cellAlpha(row.name, frame),
      );
      failOnSeamPop(row.name, worn, gateOutfit.key);
    }
    const floor = typical * (gateSpec().loopSeamFloors.get(row.name) ?? LOOP_SEAM_FLOOR);
    if (seam < floor) {
      fail(
        'G3',
        `${row.name} barely moves across its loop seam: last→first differs by ${seam}px against ` +
          `a median step of ${typical}px (floor ${floor.toFixed(0)}px) — the row holds still for ` +
          'a frame at the wrap, which is what sampling the cycle over frameCount-1 does',
      );
    }

    const closure = frameDelta(cellAlpha(row.name, 0), cellAlpha(row.name, row.frameCount));
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
 * one frame and back on the next and so produces *two* huge steps, one after
 * the other. Uncapped, the defect would then be sizing its own allowance. Two
 * large steps are the two fast phases of one smooth cycle — a breath in and
 * out — only when the cycle runs between them, and then the runner-up still
 * sizes the allowance.
 */
const STEP_VS_RUNNER_UP = 1.35;
/** A loop's two fast phases fall half a turn apart, give or take a frame. */
const HALF_TURN_DIVISOR = 2;
const HALF_TURN_SLACK_FRAMES = 1;

/**
 * A cell's ink as it moves on screen: the baked cell, and on a frame his fist
 * closes on an explosive, the stick composited there as the runtime draws it.
 * The explosive is part of the motion a reader follows — the arm drawing a
 * stick back past his head — and without it a throw's steps are measured on
 * an empty fist.
 */
function motionCellAlpha(row: string, frame: number): Uint8ClampedArray {
  const crawlerRow = HUMAN_ROW_BOOK.rowOf(row)?.name;
  const held =
    crawlerRow === undefined
      ? null
      : explosiveHeldDraw(HELD_VISUALS.prop_dynamite, { row: crawlerRow, frame, flipX: false });
  const authored = authoredFigure();
  if (held === null) return cellAlpha(row, frame, authored.def);
  const cell = bakeFigureCell(authored.def, row, frame);
  const frames = authored.socketsAt(row, frame);
  if (frames === null) return cellAlpha(row, frame, authored.def);
  const socket = frames.sockets.mainHand;
  const ctx = asGameContext(cell.getContext('2d'));
  compositeHeldItem(
    ctx,
    held.look,
    heldTransformAt(socket, authored.heldPxPerUnit, held.phase),
    'painted',
  );
  const { data } = cell.getContext('2d').getImageData(0, 0, frameWidth, frameHeight);
  const alpha = new Uint8ClampedArray(frameWidth * frameHeight);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * CHANNELS + ALPHA_OFFSET];
  return alpha;
}

/**
 * A step this small a share of the row's largest is a hold, not one of the
 * row's moving steps: a one-shot that settles into a pose and holds it for a
 * few frames makes steps of a handful of pixels — the breath, a blink.
 */
const HOLD_STEP_SHARE = 0.15;

/**
 * The row's typical step: the median of its moving steps, its holds left
 * out. A row that holds still for some frames and then moves fast would
 * otherwise have the median of its holds, and every ordinary step of its
 * movement would read as a snap against it. Garments that never stop moving
 * hide this — a hem that flutters on every frame turns a hold into a small
 * step — so without it the gate would pass or fail a row by what the figure
 * wears rather than how its body moves.
 */
function typicalMovingStep(steps: readonly number[]): number {
  const hold = holdThreshold(steps);
  return median(steps.filter((step) => step >= hold));
}

/**
 * The step under which a step is a hold: a share of the row's *runner-up*
 * step. Taken from the largest, a lone snap would set the bar itself — a
 * uniform row with one flung frame would count its ordinary steps as holds,
 * leave only the snap as the row's motion, and size its own allowance.
 */
function holdThreshold(steps: readonly number[]): number {
  const [, runnerUp = 0] = [...steps].sort((a, b) => b - a);
  return runnerUp * HOLD_STEP_SHARE;
}

/**
 * Two cells with not one alpha value apart. A dead frame is the same picture
 * twice; a step that changes no silhouette pixel can still be motion inside
 * the figure, or at its edges below the ink threshold, on a slim build whose
 * small moves round inside the pixels they started in.
 */
function isPixelIdentical(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  return a.every((alpha, index) => alpha === b[index]);
}

/**
 * The stamp is a declared spike. Both stomp rows drive a foot from over his own
 * waist to flat on the floor across the impact frame, and that single step is
 * the whole blow — flattening it to satisfy a continuity threshold would remove
 * the only frames a player reads as an impact. G6 is what holds the spike to
 * exactly that step.
 */
function isDeclaredSpike(row: string, step: number): boolean {
  const stomp = STOMP_ROWS.find((candidate) => candidate.row === row);
  if (stomp !== undefined && step === stomp.impact - 1) return true;
  return gateSpec().declaredSpikes.some((spike) => spike.row === row && spike.step === step);
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
 * is what the Seismic Stomp stamp moving 0.1 tiles off its stance does. The dead-frame
 * clause below has no such blind spot, and on loops the joint-spike clause
 * after it sees the snaps this silhouette step cannot.
 *
 * Measured on his body in the default outfit, whatever outfit the run gates:
 * the step is counted in silhouette pixels, and a garment hung behind him
 * would swallow every arm movement made in front of it — a drink raised over
 * it changes no silhouette pixel at all — so the same motion would read as a
 * dead frame followed by a snap. Gear moves only as the pose it is laid on
 * moves, so the body's steps are the steps to hold.
 */
function gateMotionContinuity(): void {
  let stepsMeasured = 0;
  for (const row of gatedRows) {
    const cells = Array.from({ length: row.frameCount }, (_unused, frame) =>
      motionCellAlpha(row.name, frame),
    );
    const steps: number[] = [];
    for (let i = 1; i < cells.length; i++) steps.push(frameDelta(cells[i - 1], cells[i]));
    if (steps.length === 0) {
      fail('G4', `${row.name} has no frame-to-frame step to measure`);
      continue;
    }
    stepsMeasured += steps.length;
    const typical = typicalMovingStep(steps);
    const byDescending = steps.map((_step, index) => index).sort((a, b) => steps[b] - steps[a]);
    const largestAt = byDescending[0];
    const runnerUpAt = byDescending.length > 1 ? byDescending[1] : null;
    const runnerUp = runnerUpAt === null ? 0 : steps[runnerUpAt];
    const limitShare = row.kind === 'loop' ? LOOP_STEP_LIMIT : ONE_SHOT_STEP_LIMIT;
    const ordinaryStepLimit = typical * limitShare;
    const apart = runnerUpAt === null ? 0 : Math.abs(largestAt - runnerUpAt);
    const between =
      runnerUpAt === null
        ? []
        : steps.slice(Math.min(largestAt, runnerUpAt) + 1, Math.max(largestAt, runnerUpAt));
    const hold = holdThreshold(steps);
    // Two large steps are one smooth cycle's two fast phases only when the
    // cycle runs between them: half a turn apart on a loop, or with the row
    // moving on every step between them on a one-shot. A wrong key held for
    // a frame or two makes two large steps with a hold between them.
    const twoFastPhases =
      apart > 1 &&
      (row.kind === 'loop'
        ? Math.abs(apart - row.frameCount / HALF_TURN_DIVISOR) <= HALF_TURN_SLACK_FRAMES
        : between.every((step) => step >= hold));
    const runnerUpIsOrdinary = runnerUp <= ordinaryStepLimit || twoFastPhases;
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
      if (isPixelIdentical(cells[index], cells[index + 1])) {
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
  for (const row of gatedRows) {
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

function authoredPosesOf(row: RowSpec<string>): BipedPose[] {
  return Array.from({ length: row.frameCount }, (_unused, frame) => row.pose(frame));
}

function posesOf(row: RowSpec<string>): BipedPose[] {
  return Array.from({ length: row.frameCount }, (_unused, frame) =>
    withLookBuild(row.pose(frame), gateLook),
  );
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
function fistReach(pose: BipedPose, side: LegSide, view: CardinalView): number {
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
function strikeReach(pose: BipedPose, limb: StrikeReachLimb, view: CardinalView): number {
  switch (limb) {
    case 'weapon':
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
function strikeHeight(pose: BipedPose, limb: StrikeReachLimb, view: CardinalView): number {
  const skeleton = buildSkeleton(pose, VIEWS[view]);
  switch (limb) {
    case 'weapon':
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
 * the picture shows landing the blow.
 */
function gateStrikePeaksOnImpact(): void {
  let rowsMeasured = 0;
  for (const row of gatedRows) {
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
    // The blow's timing is the choreography's, authored on the rig's own
    // shoulders: a look that roots its arms closer together moves where
    // each fist is measured from, not when the blow lands.
    const poses = authoredPosesOf(row);
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
    // A weapon blow is driven by the main arm's reach; the other fist may be on the haft beside it.
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
 * family's stamp, and every Seismic Stomp row — any row that declares where its heel
 * lands.
 */
const STOMP_ROWS: ReadonlyArray<{ readonly row: string; readonly impact: number }> = [
  { row: 'stomp_down', impact: STOMP_DOWN_IMPACT },
  ...HUMAN_ROWS.filter((row) => stampAnchorOf(row, gateLook) !== null).map((row) => ({
    row: row.name,
    impact: row.impactFrames[0] ?? SEISMIC_STOMP_IMPACT_FRAME,
  })),
];

/** How high a pose holds one foot off the floor, in figure units. */
function footLift(pose: BipedPose, side: LegSide): number {
  return -(side === 'left' ? pose.leftFoot.y : pose.rightFoot.y);
}

/**
 * The foot a stomp stamps with: the one raised higher on the frame before
 * impact. Read from the pose, not from a declaration, so a row cannot name one
 * foot and stamp with the other.
 */
function stampingSide(row: RowSpec<string>, impact: number): LegSide {
  const apex = row.pose(Math.max(0, impact - 1));
  return footLift(apex, 'left') > footLift(apex, 'right') ? 'left' : 'right';
}

/**
 * G6 — a stomp is at its apex the frame before impact and on the floor from
 * impact on: through the rest of the row, or through the press on a Seismic Stomp row,
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
      stampAnchorOf(row, gateLook) === null
        ? row.frameCount - impact
        : hops
          ? SEISMIC_STOMP_HOP_PRESS_FRAMES
          : SEISMIC_STOMP_PRESS_FRAMES;
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
 * A stamp row's anchor (`stampAnchorOf`) is where the runtime spawns the shockwave for that row
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
    const anchor = stampAnchorOf(row, gateLook);
    if (anchor === null) continue;
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
    ...MOTION_SETS.map(
      (set) => [`humanSprite's always-drawn rows for ${set}`, alwaysDrawnRows(set)] as const,
    ),
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
 * stay well inside the cache's per-figure ceiling, because the human crawler is on
 * screen continuously with several of his rows warm at once.
 */
const ROW_BUDGET_MEGABYTES = 3;

/**
 * The rows that must be warm together, besides the always-drawn set: every
 * strike in the busiest family (the rows one facing can throw with `set` in
 * hand) and the stomp.
 */
function strikeFamilies(set: MotionSet): Map<CardinalView, HumanRowName[]> {
  const families = new Map<CardinalView, HumanRowName[]>();
  for (const name of HUMAN_ATTACK_ROWS) {
    const meta = HUMAN_ROW_TABLE[name];
    if (motionSetOfRow(meta) !== set) continue;
    families.set(meta.view, [...(families.get(meta.view) ?? []), name]);
  }
  return families;
}

/**
 * How many views' Seismic Stomp rows can be warm at once. A Seismic Stomp row is admitted when
 * it is stamped and released once it has gone unplayed for the cache's release
 * window; at the shortest cooldown the ability reaches, this many stamps can
 * fall inside one window, and each can be in a different view.
 */
function seismicStompViewsWarmAtOnce(): number {
  const shortestCooldown = getSeismicStompStats(SEISMIC_STOMP_DEF.maxLevel).cooldownFrames;
  return Math.floor(IDLE_FRAMES_BEFORE_RELEASE / shortestCooldown) + 1;
}

/**
 * The Seismic Stomp rows a fight can hold warm together: the standing stamp and the
 * hop of as many views as {@link seismicStompViewsWarmAtOnce}, taking the heaviest.
 */
function warmStompRows(): HumanRowName[] {
  const byView = new Map<CardinalView, HumanRowName[]>();
  for (const row of HUMAN_ROWS) {
    if (stampAnchorOf(row, gateLook) === null) continue;
    byView.set(row.view, [...(byView.get(row.view) ?? []), row.name]);
  }
  const framesOf = (names: readonly HumanRowName[]): number =>
    names.reduce((sum, name) => sum + HUMAN_ROW_TABLE[name].frameCount, 0);
  const heaviestFirst = [...byView.values()].sort((a, b) => framesOf(b) - framesOf(a));
  return heaviestFirst.slice(0, seismicStompViewsWarmAtOnce()).flat();
}

/**
 * The Energy Shield cast of a view, up to the frame the dome goes up — the
 * span `standByForShieldCast` holds warm while the spell is ready.
 */
function shieldCastSpans(view: CardinalView): HumanWarmSpan[] {
  return HUMAN_ROWS.flatMap((row) => {
    const cast = row.eventFrames?.cast?.[0];
    return row.view === view && cast !== undefined ? [{ row: row.name, frames: cast + 1 }] : [];
  });
}

/**
 * G9b — the working set fits the human figure's own per-figure budget.
 *
 * Rows are admitted on use and released when stale, so what has to fit is not
 * every row at once but the rows a fight holds warm together: what is held
 * warm in every view for as long as he is on screen (`residentViewSpans`:
 * everything he is drawn in continuously, and the wind-up of every blow a
 * fight can open with from standing, up to each one's impact frame), the whole of
 * the largest family of strikes one facing can throw — standing, and every
 * version painted on the move, whose wind-ups are warmed as he sets off in
 * that view — and the Seismic Stomp rows, standing and every hop version, of as many
 * views as can be stamped inside one release window. On top of those, the
 * rows held on stand-by for a moment that can come on any tick, in the view
 * the fight is fought in, each only up to the frame it is held to: the flinch
 * and the stumble to the end of their recoil, the Energy Shield cast to the
 * frame the dome goes up, and the falls to him reaching the floor. Measured
 * against `undressedHumanFigure(look)`'s own `budgetMegabytes` rather than the cache's fleet
 * default, since he declares an override.
 */
function gateWorkingSet(): void {
  const figureBudget = figureByteBudgetFor(gateFigure);
  let bareBytes = 0;
  for (const set of MOTION_SETS) bareBytes = Math.max(bareBytes, gateWorkingSetOf(set));
  // A comparison that can never see the other side of itself is not a gate —
  // proves the check above is reachable rather than trivially true, by running
  // the identical comparison against a figure whose declared budget cannot
  // possibly cover the same measured bytes.
  const starvedBudget = figureByteBudgetFor({ ...gateFigure, budgetMegabytes: 0 });
  if (!(bareBytes > starvedBudget) || figureBudget <= starvedBudget) {
    fail(
      'G9b',
      `the working-set check does not fail against a starved 0 MB budget, so it can never fail ` +
        'against the real one either',
    );
  }
}

/**
 * The grips the working set of `set` is measured carrying: bare hands carry
 * a slingshot in a low fist; an armed set, its archetype's thickest handle —
 * the fist that crops largest.
 */
function measuredGrips(set: MotionSet): readonly CarriedGrip[] {
  if (set === 'unarmed') return [{ handle: 'standard', style: 'low', motionSet: set }];
  const radii = GRIP_ARCHETYPES[ARMED_SET_GRIP[set].archetype].radii;
  const thickest = radii[radii.length - 1];
  return [{ handle: thickest, style: carryStyleOf(set), motionSet: set }];
}

/** G9b for one set in his hand; returns the bytes of its cells without front layers. */
function gateWorkingSetOf(set: MotionSet): number {
  const cellBytes = frameWidth * frameHeight * BYTES_PER_PIXEL;
  const framesOf = (names: readonly HumanRowName[]): number =>
    names.reduce((sum, name) => sum + HUMAN_ROW_TABLE[name].frameCount, 0);
  let busiestFamily: HumanRowName[] = [];
  for (const family of strikeFamilies(set).values()) {
    if (framesOf(family) > framesOf(busiestFamily)) busiestFamily = family;
  }
  const resident = residentViewSpans(set);
  const stomps = warmStompRows();
  const residentWhole = resident
    .filter((span) => span.frames === HUMAN_ROW_TABLE[span.row].frameCount)
    .map((span) => span.row);
  const rows = [...new Set([...residentWhole, ...busiestFamily, ...stomps])];
  const windUpSpans = resident.filter((span) => !rows.includes(span.row));
  const windUps = windUpSpans.map((span) => span.row);
  const windUpFrames = windUpSpans.reduce((sum, span) => sum + span.frames, 0);
  const fightView: CardinalView | undefined =
    busiestFamily.length > 0 ? HUMAN_ROW_TABLE[busiestFamily[0]].view : undefined;
  const fightReactions = fightView === undefined ? [] : fightReactionSpans(fightView);
  const shieldCast = fightView === undefined ? [] : shieldCastSpans(fightView);
  const standby = [...fightReactions, ...shieldCast, ...FALL_SPANS].filter(
    (span) => !rows.includes(span.row),
  );
  const standbyFrames = standby.reduce((sum, span) => sum + span.frames, 0);
  failUnlessMeasured('G9b', busiestFamily.length, `strike rows in any family (${set})`);
  failUnlessMeasured('G9b', stomps.length, 'stomp rows');
  failUnlessMeasured('G9b', residentWhole.length, `rows held warm in every view (${set})`);
  failUnlessMeasured('G9b', fightReactions.length, 'fight reaction rows');
  failUnlessMeasured('G9b', shieldCast.length, 'Energy Shield cast rows');
  failUnlessMeasured('G9b', standbyFrames, 'stand-by frames');
  const cells = framesOf(rows) + windUpFrames + standbyFrames;
  const workingSpans = [
    ...rows.map((row) => ({ row, frames: HUMAN_ROW_TABLE[row].frameCount })),
    ...windUpSpans,
    ...standby,
  ];
  const bytes = storedSpansBytes(gateFigure, workingSpans);
  const megabytes = bytes / BYTES_PER_MEGABYTE;
  const wholeCellMegabytes = (cells * cellBytes) / BYTES_PER_MEGABYTE;
  const figureBudget = figureByteBudgetFor(gateFigure);
  const budgetMegabytes = figureBudget / BYTES_PER_MEGABYTE;
  console.log(
    `  G9b working set (${set}): ${rows.length} rows, ${windUps.length} wind-ups and ` +
      `${standby.length} stand-by spans, ${cells} cells, ` +
      `${megabytes.toFixed(2)} MB stored (${wholeCellMegabytes.toFixed(2)} MB as whole cells) ` +
      `of the ${budgetMegabytes} MB per-figure budget (strike family: ${busiestFamily.join(', ')})`,
  );
  if (bytes > figureBudget) {
    fail(
      'G9b',
      `the working set with ${set} in hand (${rows.join(', ')}, the wind-ups of ` +
        `${windUps.join(', ')}, and the stand-by spans of ` +
        `${standby.map((span) => span.row).join(', ')}) warms to ${megabytes.toFixed(2)} MB ` +
        `against the cache's ${budgetMegabytes} MB per-figure budget`,
    );
  }
  for (const grip of measuredGrips(set)) {
    const carrying = humanFigureFor(gateLook, gateOutfit, grip);
    const layered = layeredCellCount(carrying, workingSpans);
    const armedBytes = storedSpansBytes(carrying.def, workingSpans);
    const armedMegabytes = armedBytes / BYTES_PER_MEGABYTE;
    console.log(
      `  G9b carrying (${grip.handle}, ${grip.style}, ${set}): ${layered} layered cells, ` +
        `${armedMegabytes.toFixed(2)} MB stored with their front layers, of the ` +
        `${budgetMegabytes} MB per-figure budget`,
    );
    failUnlessMeasured('G9b', layered, `layered cells carrying (${grip.handle}, ${set})`);
    if (armedBytes > figureByteBudgetFor(carrying.def)) {
      fail(
        'G9b',
        `carrying (${grip.handle}, ${grip.style}, ${set}) the working set warms to ` +
          `${armedMegabytes.toFixed(2)} MB with its front layers, against the ${budgetMegabytes} MB budget`,
      );
    }
  }
  return bytes;
}

/** How many of the cells over a set of spans bake a front layer. */
function layeredCellCount(figure: HumanFigure, spans: readonly HumanWarmSpan[]): number {
  const layers = figure.def.heldLayers;
  if (layers === undefined) return 0;
  let layered = 0;
  for (const span of spans) {
    for (let frame = 0; frame < span.frames; frame++) {
      if (layers.layered(span.row, frame)) layered++;
    }
  }
  return layered;
}

/** {@link storedRowBytes} per figure and row, since the sets' working sets share most of their rows. */
const storedBytesByRow = new Map<string, readonly number[]>();

/** The first `frames` frames of a row, by the row's state name. */
type StoredSpan = Pick<HumanWarmSpan, 'frames'> & { readonly row: string };

/** What the cache stores for the first `frames` frames of each span, front layers included. */
function storedSpansBytes(def: FigureDef, spans: readonly StoredSpan[]): number {
  let total = 0;
  for (const span of spans) {
    const key = `${def.id}|${span.row}`;
    const perFrame = storedBytesByRow.get(key) ?? storedRowBytes(def, span.row);
    storedBytesByRow.set(key, perFrame);
    for (let frame = 0; frame < span.frames; frame++) total += perFrame[frame] ?? 0;
  }
  return total;
}

/**
 * G9 — the heaviest warm row's memory, reported whether or not it passes.
 *
 * A row's whole cells are the most its ink crops can take, so a row whose
 * whole cells fit the ceiling fits it however it crops; only a row they
 * would not is baked through the cache and measured as stored.
 */
function gateWarmRowSize(): void {
  const cellBytes = frameWidth * frameHeight * BYTES_PER_PIXEL;
  const rowBudgetBytes = ROW_BUDGET_MEGABYTES * BYTES_PER_MEGABYTE;
  let heaviestState = '';
  let heaviestBytes = 0;
  let statesMeasured = 0;
  let rowsBaked = 0;
  let totalFrames = 0;
  for (const [state, declared] of gateFigure.states) {
    statesMeasured++;
    totalFrames += declared.frames;
    const wholeCellBytes = declared.frames * cellBytes;
    const fitsWhole = wholeCellBytes <= rowBudgetBytes;
    if (!fitsWhole) rowsBaked++;
    const bytes = fitsWhole
      ? wholeCellBytes
      : storedSpansBytes(gateFigure, [{ row: state, frames: declared.frames }]);
    if (bytes <= heaviestBytes) continue;
    heaviestBytes = bytes;
    heaviestState = state;
  }
  failUnlessMeasured('G9', statesMeasured, 'declared states');
  if (statesMeasured === 0) return;

  const megabytes = heaviestBytes / BYTES_PER_MEGABYTE;
  const allWarmMegabytes = (totalFrames * cellBytes) / BYTES_PER_MEGABYTE;
  console.log(
    `  G9 warm row: ${heaviestState} is at most ${megabytes.toFixed(2)} MB of a ` +
      `${ROW_BUDGET_MEGABYTES} MB budget (${rowsBaked} rows past it as whole cells measured as ` +
      `stored); all ${statesMeasured} states warm at once would be at most ` +
      `${allWarmMegabytes.toFixed(2)} MB`,
  );
  if (megabytes > ROW_BUDGET_MEGABYTES) {
    fail(
      'G9',
      `${heaviestState} warms to ${megabytes.toFixed(2)} MB against a budget of ` +
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
 * stepping without letting a hovering foot count as planted. Measured on the
 * rig at its own height; a look drawn taller draws those heights taller too.
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
  return point.y >= groundY - SOLE_CONTACT_TOLERANCE_PX * playerStatureScale(gateLook);
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

/** Probed joints by look and row: the looks solve the same row to different joints. */
const probesByLookRow = new Map<string, HumanJointProbe[]>();

function probesOf(row: RowSpec<string>): HumanJointProbe[] {
  const key = `${gateLook.id}/${row.name}`;
  const cached = probesByLookRow.get(key);
  if (cached !== undefined) return cached;
  const probes = Array.from({ length: row.frameCount }, (_unused, frame) =>
    probeRowJoints(row, frame, gateLook),
  );
  probesByLookRow.set(key, probes);
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
 * The gait phase, in radians, the runtime advances the human's legs by per game
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

/** Each look's gait at base speed: the runtime picks a walk or a run by the look's height. */
const runtimeGaitByLook = new Map<string, ReturnType<typeof runtimeGait>>();

function runtimeGaitAtBaseSpeed(): ReturnType<typeof runtimeGait> {
  const known = runtimeGaitByLook.get(gateLook.id);
  if (known !== undefined) return known;
  const measured = runtimeGait();
  runtimeGaitByLook.set(gateLook.id, measured);
  return measured;
}

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
 * foreshortened (`HEAD_ON_FLOOR_FORESHORTENING` in `biped/rig.ts`), because an
 * upright figure stood on a floor seen from above would otherwise have its
 * legs stretched between the two projections; the floor under a head-on foot
 * therefore moves back by that share of the ground covered, and the foot is
 * held to it (`floorDriftPerFrameCellPx`). A planted row covers no ground, so
 * its feet simply may not move. The drift is the furthest the tracked point
 * strays from where the stance began.
 */
/** G10, its premise: the crawler's runtime paces his gait by the distance the slip check carries the floor by. */
function gateRuntimeGaitPacing(): void {
  const { radiansPerTick, gait } = runtimeGaitAtBaseSpeed();
  const expected = PLAYER_SPEED * gaitRadiansPerPx(gait);
  if (!(radiansPerTick > 0) || Math.abs(radiansPerTick - expected) > GAIT_RATE_TOLERANCE) {
    fail(
      'G10',
      `the runtime advanced the ${gait} by ${radiansPerTick} rad in a tick at base speed, where ` +
        `its distance pacing gives ${expected} — the travel this gate adds is not the runtime's`,
    );
  }
}

function gateFootSlip(): void {
  let stepsMeasured = 0;
  for (const row of gatedRows) {
    if (row.locomotion === 'none') continue;
    const probes = probesOf(row);
    const travel = floorDriftPerFrameCellPx(row);
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
  for (const row of gatedRows) {
    // A gait cycle only: a start or stop begins or ends on a standing frame,
    // where the arms hang and nothing lands.
    if (row.view !== 'side' || row.locomotion !== 'travelling' || row.kind !== 'loop') continue;
    const probes = probesOf(row);
    const gripping = row.pose(0);
    for (const side of LEG_SIDES) {
      // An arm closed on a weapon carries it rather than swinging free.
      const shape = side === 'right' ? gripping.rightHandShape : gripping.leftHandShape;
      if (shape === 'grip') continue;
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
        const otherShape = side === 'right' ? gripping.leftHandShape : gripping.rightHandShape;
        if (otherShape !== 'grip' && opposite[contact] <= 0) {
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
 * A resting man blinks every three or four seconds. A clock-driven loop much
 * shorter than that — the guard's bounce — cannot carry a blink every cycle
 * without fluttering, and is never held long enough for its lack to stare.
 */
const SHORTEST_BLINKING_LOOP_TICKS = 2 * TICKS_PER_SECOND;

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
function gateBlink(): void {
  let blinksMeasured = 0;
  for (const row of gatedRows) {
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
  for (const row of gatedRows) {
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
 * With no row marked as a run it fails rather than passing: at base speed
 * the human covers ground only a run can, so the absence of a run row is the
 * defect, not an exemption.
 */
function gateWalkFootDown(): void {
  let walksMeasured = 0;
  for (const row of gatedRows) {
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
}

/** G14, the run: the crawler's run cycles hold a flight phase in band. */
function gateRunFlight(): void {
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
  2 *
  Math.max(
    ...MOTION_SETS.flatMap((set) =>
      [...strikeFamilies(set).values()].map((family) => family.length),
    ),
  );
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

/**
 * A weapon item whose grip and weight play `set`, read off the item table so
 * no gate names a weapon; null for bare hands.
 */
function weaponPlaying(set: MotionSet): ItemId | null {
  if (set === 'unarmed') return null;
  const found = Object.keys(ITEM_DEF)
    .filter(isItemId)
    .find((id) => {
      const weapon = weaponStatsOf(id);
      return weapon !== null && motionSetOf(HELD_VISUALS[weapon.heldVisual]) === set;
    });
  if (found === undefined) fail('G15', `no weapon item plays the ${set} rows`);
  return found ?? null;
}

/**
 * A player built facing along `facing`, with the animator told so, and with
 * a weapon of `set` drawn in his hand unless it is bare hands.
 */
function playerFacing(facing: Pt, set: MotionSet = 'unarmed'): HumanPlayer {
  const player = new HumanPlayer(0, 0, TILE_SIZE);
  const weapon = weaponPlaying(set);
  if (weapon !== null) {
    player.inventory.addItem(weapon, 1);
    player.holdWithoutGesture(weapon);
  }
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
 * Stamps one Seismic Stomp through to its end, running on along the facing throughout
 * when `moving`, and records the cell drawn on the tick the blast fires.
 * Returns the number of ticks it fired on, or null if it would not trigger.
 *
 * Also fails a row whose stamp frame is already on screen the tick before the
 * blast: the frame shown at the blast has to be the one the heel lands on,
 * and it has to be *new* on that tick, or the heel sits on the floor with
 * nothing happening until the blast catches up.
 */
function stampSeismicStomp(
  player: HumanPlayer,
  moving: boolean,
  seen: Map<HumanRowName, Set<number>>,
): number | null {
  if (!player.triggerSeismicStomp()) return null;
  let stamps = 0;
  let previous = player.spriteSelection();
  while (player.seismicStompTimer > 0) {
    if (moving) {
      player.isMoving = true;
      player.x += player.facingX * PLAYER_SPEED;
      player.y += player.facingY * PLAYER_SPEED;
    }
    player.updateAttack();
    const chosen = player.spriteSelection();
    if (player.isSeismicStompPeak()) {
      stamps++;
      recordFrame(seen, chosen.row, chosen.frame);
      const stampedEarly =
        previous.row === chosen.row &&
        HUMAN_ROW_TABLE[chosen.row].impactFrames.includes(previous.frame);
      if (stampedEarly) {
        fail(
          'G15',
          `${chosen.row} already shows its stamp frame ${previous.frame} the tick before the ` +
            'blast fires — the heel lands before the Seismic Stomp does',
        );
      }
    }
    previous = chosen;
    player.tickTimers();
  }
  return stamps;
}

/** How many places along the seeded order of blows the chains on the run are begun from. */
const BAG_SHIFTS = 4;

/**
 * Throws whole chains with a weapon of `set` drawn, standing and on the move,
 * at every facing and target kind, recording the cell drawn on each hit's
 * tick; returns the swings thrown.
 */
function replaySwings(
  set: MotionSet,
  strikeFrames: Map<HumanRowName, Set<number>>,
  targets: ReadonlyMap<TargetKind, Mob | null>,
): number {
  const stander = playerFacing(sweptFacing(0), set);
  const runner = playerFacing(sweptFacing(0), set);
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
      standFor(stander, COMBO_WINDOW_TICKS + 1);
      for (let swing = 0; swing < SWINGS_PER_CHAIN; swing++) {
        // Offset by the facing as well: a pair of blows the chain alternates
        // between would otherwise each meet only every other stride offset.
        walkFor(runner, (swing + index) % STRIDE_OFFSET_TICKS);
        for (const [swinger, moving] of [
          [stander, false],
          [runner, true],
        ] as const) {
          swingsThrown++;
          const peaks = throwSwing(swinger, moving, strikeFrames, target, reachShare);
          if (peaks === 1) continue;
          fail(
            'G15',
            `a swing with ${set} in hand ${moving ? 'on the move' : 'standing'} at a ${kind} ` +
              `target, facing ${index}/${FACING_SWEEP}, peaked on ${peaks} ticks, not 1`,
          );
        }
      }
    }
  }
  // A version of a blow on the move is only drawn from the run frame its legs
  // begin at, so chains are also thrown from a fresh stride at every tick of
  // one full cycle, in every view.
  const runCycleTicks = Math.ceil(RUN_GROUND_PER_CYCLE_PX / PLAYER_SPEED);
  for (const [, facing] of VIEW_FACINGS) {
    for (let offset = 0; offset < runCycleTicks * BAG_SHIFTS; offset++) {
      const fresh = playerFacing(facing, set);
      // Every player draws its blows from the same seeded order: blows thrown
      // first, standing and out of the combo window, shift where in that order
      // the chain on the run begins.
      for (let shift = 0; shift < Math.floor(offset / runCycleTicks); shift++) {
        throwSwing(fresh, false, new Map());
        standFor(fresh, COMBO_WINDOW_TICKS + 1);
      }
      walkFor(fresh, WALK_IN_TICKS + (offset % runCycleTicks));
      for (let swing = 0; swing < SWINGS_PER_CHAIN; swing++) {
        swingsThrown++;
        if (throwSwing(fresh, true, strikeFrames) === 1) continue;
        fail('G15', `a swing with ${set} in hand on the run peaked on more or fewer ticks than 1`);
      }
    }
  }
  return swingsThrown;
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
 * On the tick `isAttackPeak` / `isSeismicStompPeak` fires the frame is read from
 * `HumanPlayer.spriteSelection`, the cell `drawSelf` paints. A row that never
 * turns up is a row the runtime can never pick, and fails by name.
 */
function gateImpactTiming(): void {
  const strikeFrames = new Map<HumanRowName, Set<number>>();
  const stampFrames = new Map<HumanRowName, Set<number>>();
  const targets = new Map(TARGET_KINDS.map((kind) => [kind, targetMob(kind)] as const));
  let swingsThrown = 0;
  for (const set of ARMED_MOTION_SETS) {
    swingsThrown += replaySwings(set, strikeFrames, targets);
  }
  const stander = playerFacing(sweptFacing(0));
  const runner = playerFacing(sweptFacing(0));
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
      stamper.seismicStompCooldown = 0;
      const how = moving ? 'on the run' : 'standing';
      const stamps = stampSeismicStomp(stamper, moving, stampFrames);
      if (stamps === null) {
        fail('G15', `Seismic Stomp would not trigger ${how} at facing ${index}/${FACING_SWEEP}`);
      } else if (stamps !== 1) {
        fail(
          'G15',
          `a Seismic Stomp ${how} at facing ${index}/${FACING_SWEEP} stamped on ${stamps} ticks, not 1`,
        );
      }
    }
  }
  failUnlessMeasured('G15', swingsThrown, 'swings thrown');

  // A hop is only drawn from the run frame its legs begin at, and the runner
  // above reaches each view's facings at whatever phase his running total of
  // ticks happens to leave him in — a handful of phases, not the stride. So
  // the Seismic Stomp on the run is also stamped from a fresh stride at every tick of
  // one full cycle, in every view.
  const runCycleTicks = Math.ceil(RUN_GROUND_PER_CYCLE_PX / PLAYER_SPEED);
  let hopsStamped = 0;
  for (const [, facing] of VIEW_FACINGS) {
    for (let offset = 0; offset < runCycleTicks; offset++) {
      const hopper = playerFacing(facing);
      walkFor(hopper, WALK_IN_TICKS + offset);
      if (stampSeismicStomp(hopper, true, stampFrames) !== null) hopsStamped++;
    }
  }
  failUnlessMeasured('G15', hopsStamped, 'Seismic Stomps stamped at every phase of a stride');

  const checks: ReadonlyArray<
    readonly [string, readonly HumanRowName[], Map<HumanRowName, Set<number>>]
  > = [
    ['strike', HUMAN_ATTACK_ROWS, strikeFrames],
    [
      'stomp',
      HUMAN_ROWS.filter((row) => stampAnchorOf(row, gateLook) !== null).map((row) => row.name),
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
 * G16 — one facing, one view. The selector cuts the circle into eight 45°
 * sectors — east in profile, the south diagonals front-diagonal, south
 * head-on, the north diagonals back-diagonal, north from behind, the west
 * half mirrored — and holds a view until the facing is its hysteresis margin
 * past the sector's edge, so a stick wobbling across an edge never flickers
 * him between two views. The strike the runtime draws for a facing, standing
 * or on the run, is in the view his facing selection draws through the
 * fallback table, and so are the stride, the idle and the Seismic Stomp, each
 * mirrored exactly when the selection is and the row is mirrorable. And once
 * a blow is thrown its row and its mirroring hold for the whole swing,
 * however the facing is steered after it.
 *
 * Otherwise a diagonal walks in the profile view and strikes head-on, and the
 * figure pops between views on the frame the attack starts — or a punch flips
 * to the other side of him mid-swing because the stick was pulled back.
 */
function gateViewConsistency(): void {
  gateSetChangeWhileStopping();
  gateFacingSectors();
  gateFacingHysteresis();
  gateWobbleHoldsTheDrawnRow();
  let mismatches = 0;
  let latchBreaks = 0;
  let latchTicks = 0;
  const examples: string[] = [];
  let facingsMeasured = 0;
  for (const set of MOTION_SETS) {
    for (let index = 0; index < FACING_SWEEP; index++) {
      const facing = sweptFacing(index);
      const standingPlayer = playerFacing(facing, set);
      const selection = standingPlayer.facing.current;
      const expected = humanRowView(selection.view);
      const standing = standingPlayer.spriteSelection();
      const walker = playerFacing(facing, set);
      walkFor(walker, WALK_IN_TICKS);
      const walking = walker.spriteSelection();
      const striker = playerFacing(facing, set);
      striker.triggerAttack();
      const striking = striker.spriteSelection();
      const standingLatch = swingLatchBreaks(striker, striking);
      latchBreaks += standingLatch.breaks;
      latchTicks += standingLatch.ticks;
      // On the run, at every phase of the stride in turn, so a travelling blow
      // is thrown as often as a standing one.
      const runningStriker = playerFacing(facing, set);
      walkFor(runningStriker, WALK_IN_TICKS + (index % STRIDE_OFFSET_TICKS));
      runningStriker.triggerAttack();
      const runningStrike = runningStriker.spriteSelection();
      const runningLatch = swingLatchBreaks(runningStriker, runningStrike);
      latchBreaks += runningLatch.breaks;
      latchTicks += runningLatch.ticks;
      const stomper = playerFacing(facing, set);
      stomper.triggerSeismicStomp();
      const stamping = stomper.spriteSelection();
      const hopper = playerFacing(facing, set);
      walkFor(hopper, WALK_IN_TICKS);
      hopper.triggerSeismicStomp();
      const hopping = hopper.spriteSelection();
      facingsMeasured++;
      for (const chosen of [striking, runningStrike, walking, standing, stamping, hopping]) {
        const row = HUMAN_ROW_TABLE[chosen.row];
        const expectedFlip = row.mirrorable && selection.flipX;
        if (row.view === expected && chosen.flipX === expectedFlip) continue;
        mismatches++;
        if (examples.length < VIEW_EXAMPLES) {
          const degrees = (index / FACING_SWEEP) * DEGREES_PER_TURN;
          examples.push(
            `${degrees.toFixed(1)}° draws ${chosen.row} (${row.view}, ` +
              `${chosen.flipX ? 'mirrored' : 'unmirrored'}) in a ${selection.view} facing ` +
              `that draws ${expected} ${expectedFlip ? 'mirrored' : 'unmirrored'}`,
          );
        }
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
        `the facing selection, e.g. ${examples.join('; ')}`,
    );
  }
}

/** Puts a weapon of `set` out in his hand with no gesture, or empties it for bare hands. */
function holdSet(player: HumanPlayer, set: MotionSet): void {
  const weapon = weaponPlaying(set);
  if (weapon === null) {
    player.holdWithoutGesture(null);
    return;
  }
  player.inventory.addItem(weapon, 1);
  player.holdWithoutGesture(weapon);
}

/** Long enough for a stride stopped in any frame to settle, play its stop and stand. */
const STOP_WATCH_TICKS = 60;

/**
 * G16, a weapon changed while he pulls up: the stride settling toward one
 * set's stop, the weapon swapped (dropped, restored, put away under a
 * reaction) — every row drawn from then on is the new set's own, or a
 * bare-handed row the new set falls back on, never another armed set's.
 */
function gateSetChangeWhileStopping(): void {
  let changesMeasured = 0;
  let strays = 0;
  const examples: string[] = [];
  for (const from of MOTION_SETS) {
    for (const to of MOTION_SETS) {
      if (from === to) continue;
      for (let offset = 0; offset < RUN_FRAMES; offset++) {
        const player = playerFacing(sweptFacing(0), from);
        walkFor(player, WALK_IN_TICKS + offset);
        standFor(player, 1);
        holdSet(player, to);
        changesMeasured++;
        for (let tick = 0; tick < STOP_WATCH_TICKS; tick++) {
          const drawn = player.spriteSelection().row;
          const drawnSet = motionSetOfRow(HUMAN_ROW_TABLE[drawn]);
          if (drawnSet === 'unarmed' || drawnSet === to) {
            standFor(player, 1);
            continue;
          }
          strays++;
          if (examples.length < VIEW_EXAMPLES) {
            examples.push(`${from} → ${to} at stride offset ${offset} draws ${drawn}`);
          }
          break;
        }
      }
    }
  }
  failUnlessMeasured('G16', changesMeasured, 'weapon changes while stopping');
  if (strays > 0) {
    fail(
      'G16',
      `${strays} weapon changes made while he pulls up go on drawing the old set's rows, ` +
        `e.g. ${examples.join('; ')}`,
    );
  }
}

/** Compass headings in order clockwise from east, 45° apart, and the selection each must give. */
const COMPASS_SELECTIONS: ReadonlyArray<readonly [string, FacingSelection]> = [
  ['east', { view: 'side', flipX: false }],
  ['south-east', { view: 'frontDiagonal', flipX: false }],
  ['south', { view: 'front', flipX: false }],
  ['south-west', { view: 'frontDiagonal', flipX: true }],
  ['west', { view: 'side', flipX: true }],
  ['north-west', { view: 'backDiagonal', flipX: true }],
  ['north', { view: 'back', flipX: false }],
  ['north-east', { view: 'backDiagonal', flipX: false }],
];
const COMPASS_STEP_DEGREES = 45;
const HALF_COMPASS_STEP_DEGREES = COMPASS_STEP_DEGREES / 2;
/** How far inside a sector, short of its hysteresis band, a heading is said to sit squarely in it. */
const INSIDE_SECTOR_DEGREES = HALF_COMPASS_STEP_DEGREES - 1;
/** A wobble across a sector edge kept this share inside the hysteresis margin. */
const WOBBLE_SHARE_OF_MARGIN = 0.75;
/** Overshoot past the margin that must turn the view. */
const PAST_MARGIN_DEGREES = 0.5;
const WOBBLE_TICKS = 40;

function headingFacing(degrees: number): Pt {
  const radians = (degrees / DEGREES_PER_TURN) * FULL_TURN;
  return { x: Math.cos(radians), y: Math.sin(radians) };
}

function sameSelection(a: FacingSelection, b: FacingSelection): boolean {
  return a.view === b.view && a.flipX === b.flipX;
}

function describeSelection(selection: FacingSelection): string {
  return `${selection.view}${selection.flipX ? ' mirrored' : ''}`;
}

/** Every compass heading, and either side of its centre, picks its own sector from scratch. */
function gateFacingSectors(): void {
  let measured = 0;
  const viewsSeen = new Set<FacingView>();
  for (const [step, [name, wanted]] of COMPASS_SELECTIONS.entries()) {
    const centre = step * COMPASS_STEP_DEGREES;
    for (const offset of [-INSIDE_SECTOR_DEGREES, 0, INSIDE_SECTOR_DEGREES]) {
      const facing = headingFacing(centre + offset);
      const got = selectFacing(facing.x, facing.y);
      measured++;
      viewsSeen.add(got.view);
      if (sameSelection(got, wanted)) continue;
      fail(
        'G16',
        `facing ${name}${offset === 0 ? '' : ` ${offset > 0 ? '+' : ''}${offset}°`} selects ` +
          `${describeSelection(got)}, not ${describeSelection(wanted)}`,
      );
    }
  }
  failUnlessMeasured('G16', measured, 'compass headings');
  if (viewsSeen.size !== FACING_VIEWS.length) {
    fail(
      'G16',
      `the selector reaches ${viewsSeen.size} of the ${FACING_VIEWS.length} facing views round ` +
        'the circle',
    );
  }
}

/** Each sector edge, as the degrees it sits at and the sectors either side of it. */
function sectorEdges(): ReadonlyArray<{
  readonly degrees: number;
  readonly before: FacingSelection;
  readonly after: FacingSelection;
}> {
  return COMPASS_SELECTIONS.map(([, before], step) => ({
    degrees: step * COMPASS_STEP_DEGREES + HALF_COMPASS_STEP_DEGREES,
    before,
    after: COMPASS_SELECTIONS[(step + 1) % COMPASS_SELECTIONS.length][1],
  }));
}

/**
 * Coming from either side of every edge, a facing inside the margin keeps the
 * view it came from and one past the margin takes the new one; and a held
 * facing fed back its own answer gives the same answer.
 */
function gateFacingHysteresis(): void {
  const held = FACING_HYSTERESIS_DEGREES * WOBBLE_SHARE_OF_MARGIN;
  const past = FACING_HYSTERESIS_DEGREES + PAST_MARGIN_DEGREES;
  let measured = 0;
  for (const edge of sectorEdges()) {
    const cases = [
      { from: edge.before, offset: held, wanted: edge.before },
      { from: edge.before, offset: past, wanted: edge.after },
      { from: edge.after, offset: -held, wanted: edge.after },
      { from: edge.after, offset: -past, wanted: edge.before },
    ];
    for (const { from, offset, wanted } of cases) {
      const facing = headingFacing(edge.degrees + offset);
      const got = selectFacing(facing.x, facing.y, from);
      const again = selectFacing(facing.x, facing.y, got);
      measured++;
      if (!sameSelection(got, wanted)) {
        fail(
          'G16',
          `from ${describeSelection(from)}, a facing ${offset.toFixed(1)}° off the edge at ` +
            `${edge.degrees}° selects ${describeSelection(got)}, not ${describeSelection(wanted)}`,
        );
      }
      if (!sameSelection(again, got)) {
        fail(
          'G16',
          `a facing held at ${(edge.degrees + offset).toFixed(1)}° flips from ` +
            `${describeSelection(got)} to ${describeSelection(again)} fed its own answer`,
        );
      }
    }
  }
  failUnlessMeasured('G16', measured, 'sector edge crossings');
}

/**
 * A stick wobbling across every sector edge, inside the margin, standing and
 * on the move: the view and mirroring he is drawn in never change from the
 * tick the wobble starts. The walking start may hand over to the stride, so
 * the row itself is free to change.
 */
function gateWobbleHoldsTheDrawnRow(): void {
  const wobble = FACING_HYSTERESIS_DEGREES * WOBBLE_SHARE_OF_MARGIN;
  let ticksMeasured = 0;
  for (const edge of sectorEdges()) {
    for (const moving of [false, true]) {
      const player = playerFacing(headingFacing(edge.degrees - wobble));
      const first = player.spriteSelection();
      const firstView = HUMAN_ROW_TABLE[first.row].view;
      let flickers = 0;
      for (let tick = 0; tick < WOBBLE_TICKS; tick++) {
        const side = tick % 2 === 0 ? 1 : -1;
        const facing = headingFacing(edge.degrees + side * wobble);
        player.facingX = facing.x;
        player.facingY = facing.y;
        if (moving) walkFor(player, 1);
        else turnTo(player, facing);
        const now = player.spriteSelection();
        ticksMeasured++;
        if (HUMAN_ROW_TABLE[now.row].view !== firstView || now.flipX !== first.flipX) flickers++;
      }
      if (flickers === 0) continue;
      fail(
        'G16',
        `a facing wobbling ${wobble.toFixed(1)}° either side of the edge at ${edge.degrees}° ` +
          `${moving ? 'on the move' : 'standing'} changes the view he is drawn in on ` +
          `${flickers} of ${WOBBLE_TICKS} ticks`,
      );
    }
  }
  failUnlessMeasured('G16', ticksMeasured, 'wobbling ticks');
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
function inGameRaster(state: string, frame: number, figure: FigureDef = gateFigure): Raster {
  const baked = bakeFigureCell(figure, state, frame);
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
 * cross-sections are centred: the thigh below the seat and above the
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
 * its dark ramp — on Dave's skin `#e7b287` to `#a06546`, about 74 levels — and
 * a limb carrying two fifths of that across its width reads as round at the
 * tile. Every look is held to it: a lean man's limb turns from light to shade
 * just as a heavy man's does, only across fewer pixels.
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
 * so nothing laid against it (the seat, the jacket, the other leg) can
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
  const pxPerUnit = HUMAN_CELL_PX_PER_UNIT * PLAYER_HUMAN_SIZE_OVER_RIG * rasterScale;
  const edges = bareSegmentEdges(crop.part, along, profile, gateLook.limbs);
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
 * hips, and a cross-section there measures the seat laid over it, where
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
  readonly raster: (row: string, frame: number, figure: FigureDef) => Raster;
}> = [
  { name: 'full bake', raster: inGameRaster },
  {
    name: 'low-end bake',
    raster: (row, frame, figure) =>
      rasterOf(paintFigureCell(figure, row, frame, IN_GAME_PX_PER_CELL_PX)),
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
 * modelled width: a flat limb lying against the seat or the jacket cannot
 * borrow their contrast. A crop reads as form when at least half of its three
 * cross-sections do, so one sheen stripe cannot carry it.
 */
function gateMuscleRead(): void {
  let cropsMeasured = 0;
  let thinCrops = 0;
  const weakest = new Map<string, { range: number; where: string }>();
  for (const { name, raster: rasterFor } of MUSCLE_RASTERS) {
    for (const { row, frame, sides } of MUSCLE_FRAMES) {
      const raster = rasterFor(row, frame, gateFigure);
      const probe = probeHumanJoints(row, frame, gateLook);
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
          const core = median(sections.map((s) => s.core));
          if (core < MIN_MEASURABLE_CORE_PX && gateSpec().slimLimbsAtTile) {
            thinCrops++;
            continue;
          }
          cropsMeasured++;
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
          if (readingSections * 2 >= sections.length) continue;
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
  failUnlessMeasured('G17', cropsMeasured, 'limb crops judged');
  if (thinCrops > 0) {
    console.log(`  G17: ${thinCrops} limb crops a pixel thin at the tile, too slim to show form`);
  }
  for (const [name, { range, where }] of weakest) {
    console.log(
      `  G17 ${name}: flattest limb ${where}, ${range.toFixed(1)} levels ` +
        `(need ${MIN_FORM_LUMA_RANGE})`,
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
 * deepest step of the garment, the skin and whatever else the look wears
 * there, and the shadow every overlap casts. Mixing any of them with each
 * other, or laying the shadow over them at part strength, only ever lands
 * between two of these, so a pixel darker than all of them is ink no material
 * there paints — a drawn line.
 */
function darkestMaterialLuma(): number {
  const tones = [
    gateLook.garment.deep,
    gateLook.skin.deep,
    ...gateSpec().besideArmDeepTones,
    CAST_SHADOW_TONE,
  ];
  return Math.min(...tones.map(hexLuma));
}
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
  const bare = rasterOf(composedCell(row, frame, { look: gateLook, silhouetteOutline: false }));
  const probe = probeRowJoints(row, frame, gateLook);
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
        if (inFigure && lumaAt(bare, x, y) < darkestMaterialLuma() - LUMA_ROUNDING) partInk++;
      }
    }
  }
  failUnlessMeasured('G19', examined, 'pixels between arm and torso');
  console.log(
    `  G19 outline policy: ${examined} px between arms and torso, ${outlineInside} inked by the ` +
      `outline pass, ${partInk} darker than the darkest material (luma ` +
      `${darkestMaterialLuma().toFixed(1)})`,
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
        `there (luma under ${darkestMaterialLuma().toFixed(1)}) — a part is drawing its own line`,
    );
  }
}

// ── G20: every cut into or out of a stride keeps the legs where they were ────

/** How far a hand-off frame's ankles may sit from the run's at the declared phase, in in-game px. */
const HAND_OFF_TOLERANCE_IN_GAME_PX = 1;
/** Rounding allowance on a measured jump against a limit measured the same way. */
const JUMP_EPSILON_PX = 1e-6;

/** A view, and a facing that draws it unmirrored. */
const VIEW_FACINGS: ReadonlyArray<readonly [CardinalView, Pt]> = [
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

/**
 * How much more of a cut's jump a look drawn taller than the rig may make. The
 * stride's own step runs across the picture edge-on, where a taller drawing
 * of the same rows is no wider; a cut's jump runs partly down it, where it is
 * taller. Never less than the rig's: a shorter look's cuts are held as hard.
 */
function statureStretch(): number {
  return Math.max(1, playerStatureScale(gateLook));
}

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
  if (jump <= limit * statureStretch() + JUMP_EPSILON_PX) return;
  const responsible = isBlowRow(before.row)
    ? before.row
    : isBlowRow(after.row) || !isRestRow(after.row)
      ? after.row
      : before.row;
  fail(
    'G20',
    `${what}: ${at} jumps an ankle ${jump.toFixed(PIXEL_DIGITS)} in-game px, more than the ` +
      `${(limit * statureStretch()).toFixed(PIXEL_DIGITS)} px the stride itself moves it in a frame`,
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
 * Runs `ticks` into a stride, throws a blow (or stamps a Seismic Stomp), runs on
 * through it, and checks the cut into the blow and back out of it. On the run
 * every blow drawn must be one painted on the move: a standing blow there is
 * the frozen slide this gate exists to catch, whatever its cuts measure.
 */
function replayBlowOnTheRun(
  facing: Pt,
  ticks: number,
  seismicStomp: boolean,
  limit: number,
  report: CutReport,
): void {
  const player = playerFacing(facing);
  walkFor(player, ticks);
  let previous = player.spriteSelection();
  if (seismicStomp) player.triggerSeismicStomp();
  else player.triggerAttack();
  const what = `${seismicStomp ? 'a Seismic Stomp' : 'a blow'} thrown ${ticks} ticks into a run`;
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
  const blowTicks = seismicStomp ? player.SEISMIC_STOMP_FRAMES : player.ATTACK_FRAMES;
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
function replayGuardDrop(view: CardinalView, facing: Pt): void {
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
 * of ticks across two strides, running and wading; and a blow and a Seismic Stomp
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
  for (const row of gatedRows) {
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
      const own = probeRowJoints(row, frame, gateLook);
      const target = probeRowJoints(run, phase * run.frameCount, gateLook);
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
    for (const seismicStomp of [false, true]) {
      const report = newReport();
      for (let offset = 0; offset < runTicksPerCycle; offset++) {
        replayBlowOnTheRun(facing, WALK_IN_TICKS + offset, seismicStomp, runLimit, report);
      }
      const kind = seismicStomp ? 'Seismic Stomp' : 'strike';
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
 * G21 — the look's status box (`humanStatusFigureBoxOf` in `HumanPlayer`) still wraps his standing
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
 * the box wraps him, not his clothes, and gear standing off him lies outside
 * it by design, the same in every outfit.
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
      const body = cellAlpha(row.name, frame, authoredFigure().def);
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
  const box = humanStatusFigureBoxOf(gateLook);
  const inkTop = (topY - TILE_Y) / TILE_SCALE;
  const inkSole = (soleY + 1 - TILE_Y) / TILE_SCALE;
  if (box.top > inkTop || inkTop - box.top > STATUS_BOX_TOP_HEADROOM_TILES) {
    fail(
      'G21',
      `the status box's top is ${box.top.toFixed(TILE_DIGITS)} of a tile but his hair tops out at ` +
        `${inkTop.toFixed(TILE_DIGITS)} — re-measure the look's figureExtent.spriteTopAboveTilePx in its look file`,
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
        `${headOnHalfWidth.toFixed(TILE_DIGITS)} head-on — re-measure the look's figureExtent.halfWidthTiles in its look file`,
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
const RIGHT_SHOULDER_SCREEN_SIDE: Readonly<Partial<Record<CardinalView, number>>> = {
  front: -1,
  back: 1,
};

/**
 * G22 — every head-on frame is drawn with his own right side where that view
 * puts it.
 *
 * A figure drawn with his right on the viewer's right from both front and
 * back is one of them in a mirror: the right-handed throw, the shield centred
 * on his right hand and the sling's fork in his left all swap hands as he
 * turns round, and no other gate sees it, because every one of them is
 * symmetric under a reflection. Measured on the probe, which names each limb
 * by his own side, so it is the probe's labelling and the painter's picture
 * that are checked together.
 */
function gateHandedness(): void {
  let framesMeasured = 0;
  for (const row of gatedRows) {
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
  gateMainHandSide();
}

/**
 * G22, its sockets: head-on, the main-hand socket of a frame he carries
 * something in is his right hand's — nearer his right hand than his left on
 * the drawn cell, measured to each hand from wrist to knuckles — so a carried weapon swaps neither hand nor side as he
 * turns round. Measured on the carrying figure, whose main hand is closed on
 * the carried item wherever a row leaves it free.
 */
function gateMainHandSide(): void {
  const carrying = gateFigureFor(outfitOf(gateLook, []), {
    handle: 'standard',
    style: 'low',
    motionSet: 'unarmed',
  });
  let framesMeasured = 0;
  for (const row of gatedRows) {
    if (RIGHT_SHOULDER_SCREEN_SIDE[row.view] === undefined) continue;
    probesOf(row).forEach((probe, frame) => {
      const main = carrying.socketsAt(row.name, frame)?.sockets.mainHand;
      if (main?.occupied !== true) return;
      framesMeasured++;
      // Measured to each whole hand, wrist to knuckles: the socket is in the
      // fist, and with the hands brought together one fist's knuckles can
      // lie nearer the other's wrist than its own.
      const toRight = distanceToSegment(main.centre, probe.rightArm.wrist, probe.rightArm.handTip);
      const toLeft = distanceToSegment(main.centre, probe.leftArm.wrist, probe.leftArm.handTip);
      if (toRight < toLeft) return;
      fail(
        'G22',
        `${row.name}[${frame}] puts his main hand's socket ${toLeft.toFixed(TILE_DIGITS)} px from ` +
          `his left wrist and ${toRight.toFixed(TILE_DIGITS)} px from his right in the ${row.view} view`,
        row.name,
      );
    });
  }
  failUnlessMeasured('G22', framesMeasured, 'head-on frames carrying an item');
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
 * An alpha shortfall past rounding noise. Ink cut off at the surface's edge
 * is lost outright, and nothing lies under it there to keep the pixel inked.
 *
 * Only alpha is compared. The two surfaces share one pixel grid but not one
 * origin, and the rasteriser's fixed-point coordinates are counted from the
 * surface's origin: a pixel centred on the edge of a narrow shading band
 * lands on one side of it on one surface and the other on the other, and
 * comes out a band lighter or darker with its ink intact. For the same reason
 * only a pixel that is ink on the whole-cell surface is judged: the faint
 * fringe of a soft edge shifts by a few levels of alpha between the two.
 */
const CLIPPED_ALPHA_DELTA = 8;

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

/** Cell pixels per figure unit down, for the gate look in `view`. */
function cellPxPerUnitDown(view: CardinalView): number {
  return TILE_SCALE * HUMAN_SCALE * playerLookAxes(gateLook, VIEWS[view].profile).y;
}

/** The cell's own transform for the gate look in `view`, as the figure lays it on. */
function scaleIntoCell(ctx: CanvasRenderingContext2D, view: CardinalView): void {
  const axes = playerLookAxes(gateLook, VIEWS[view].profile);
  ctx.translate(ORIGIN_X, ORIGIN_Y);
  ctx.scale(TILE_SCALE, TILE_SCALE);
  ctx.scale(HUMAN_SCALE * axes.x, HUMAN_SCALE * axes.y);
}

const DRAW_VIEW: Readonly<Record<CardinalView, typeof drawBipedFront>> = {
  front: drawBipedFront,
  back: drawBipedBack,
  side: drawBipedSide,
};

/**
 * One cell painted as the gate outfit's figure paints it, composed with
 * `options`. Built from the same transform and dressed pose as
 * `paintDressedHumanFrame`, so with no options it matches the shipped cell.
 */
function composedCell(row: RowSpec<string>, frame: number, options: BipedComposeOptions): Canvas {
  const cell = createCanvas(frameWidth, frameHeight);
  const ctx = asGameContext(cell.getContext('2d'));
  scaleIntoCell(ctx, row.view);
  const pose = withLookBuild(dressedPose(gateOutfit, row.pose(frame), row, frame), gateLook);
  DRAW_VIEW[row.view](ctx, pose, { cellPxPerUnit: PLAYER_HUMAN_CELL_PX_PER_UNIT, ...options });
  return cell;
}

function unboundedCell(row: RowSpec<string>, frame: number): Uint8ClampedArray {
  return composedCell(row, frame, { look: gateLook, layerMargin: UNBOUNDED_LAYER_MARGIN })
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
  for (const row of gatedRows) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      const shipped = bakeFigureCell(gateFigure, row.name, frame)
        .getContext('2d')
        .getImageData(0, 0, frameWidth, frameHeight).data;
      const unbounded = unboundedCell(row, frame);
      cellsCompared++;
      let clipped = 0;
      for (let i = 0; i < shipped.length; i += CHANNELS) {
        const inked = unbounded[i + ALPHA_OFFSET] >= INK_ALPHA_THRESHOLD;
        const lostAlpha = unbounded[i + ALPHA_OFFSET] - shipped[i + ALPHA_OFFSET];
        if (inked && lostAlpha > CLIPPED_ALPHA_DELTA) clipped++;
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

// ── G25: edge-on, the face is never hidden behind the near arm ───────────────

/**
 * How far the near arm's bones must pass from the profile eye on the rig, in
 * its head radii. The rig's sleeved arm is about 0.3 of a head radius from
 * its bone to its edge ({@link RIG_ARM_EDGE_HEAD_RADII}), so this keeps the
 * eye itself clear of it. Every frame that read as the back of his head
 * measured 0.37 or less (the arm across the face, only the hair and the ear
 * left showing); the nearest a readable face comes is 0.72, a throw's release
 * passing under the eye.
 *
 * A look holds the margin past its own arm's edge to the same share of its
 * own head: a slimmer arm covers less, and a smaller face is hidden by less.
 */
const PROFILE_EYE_CLEARANCE_HEAD_RADII = 0.5;
const RIG_ARM_EDGE_HEAD_RADII = 0.3;
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
  for (const row of gatedRows) {
    if (row.view !== 'side') continue;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const pose = poseAsDrawn(withLookBuild(row.pose(frame), gateLook), VIEWS.side);
      const skeleton = buildSkeleton(pose, VIEWS.side);
      const headRise = (skeleton.shoulderCentre.y - skeleton.headCentre.y) / HEAD_RY;
      if (headRise < UPRIGHT_HEAD_RISE_HEAD_RADII) continue;
      framesMeasured++;
      const eye = profileEyeCentre(skeleton, pose, gateLook);
      const nearArm = skeleton.rightArm;
      const boneDistance =
        Math.min(
          distanceToSegment(eye, nearArm.root, nearArm.joint),
          distanceToSegment(eye, nearArm.joint, nearArm.end),
        ) / HEAD_RY;
      const armEdge = RIG_ARM_EDGE_HEAD_RADII * gateLook.limbs.upperArmGirth;
      const margin = (boneDistance - armEdge) / gateLook.headScale;
      const clearance = RIG_ARM_EDGE_HEAD_RADII + margin;
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
 * How far past a look's deepest measured profile head G27 lets a frame go:
 * a hair of slack so a repaint of the hair's edge does not trip it, and far
 * too little to let a head grow a size.
 */
const PROFILE_HEAD_DEPTH_SLACK = 0.01;
/** Decimal places a head-to-chest share is printed to. */
const SHARE_DIGITS = 3;
/**
 * The most Dave's profile head — back of the hair to the tip of the nose —
 * may measure against the jacket's chest depth. His head is drawn larger than
 * life so his face reads at the tile, and his chest a heavily muscled man's,
 * about a seventh of his height deep: his deepest upright profile frame
 * measures 0.899 of the chest (`cross_side`), and the limit is that and the
 * slack.
 */
const DAVE_DEEPEST_PROFILE_HEAD_SHARE = 0.899;
const DAVE_PROFILE_HEAD_TO_CHEST_LIMIT = DAVE_DEEPEST_PROFILE_HEAD_SHARE + PROFILE_HEAD_DEPTH_SLACK;
/**
 * Brother Anselm's tonsure is cropped close to the skull, so edge-on his head
 * is far shallower than the habit's chest: the deepest of the profile frames
 * he plays measures 0.622 of it (`death_side`), and the limit is that and the
 * slack.
 */
const ANSELM_DEEPEST_PROFILE_HEAD_SHARE = 0.622;
const ANSELM_PROFILE_HEAD_TO_CHEST_LIMIT =
  ANSELM_DEEPEST_PROFILE_HEAD_SHARE + PROFILE_HEAD_DEPTH_SLACK;
/**
 * The male crawler is drawn to a real lean man's proportions: his head, hair and beard
 * about an eighth of his height deep, his chest the same, so edge-on his head
 * is about as deep as his chest. His deepest upright profile frame measures
 * 0.911 of the chest (`idle_side`), and the limit is that and the slack.
 */
const MALE_CRAWLER_DEEPEST_PROFILE_HEAD_SHARE = 0.911;
const MALE_CRAWLER_PROFILE_HEAD_TO_CHEST_LIMIT =
  MALE_CRAWLER_DEEPEST_PROFILE_HEAD_SHARE + PROFILE_HEAD_DEPTH_SLACK;
/**
 * The female crawler's chest stands deeper edge-on for her bust, and her head
 * carries a ponytail or braid hanging behind it. Her deepest upright profile
 * frame measures 0.873 of the chest (`barge_side`, with the braid swung out
 * behind), and the limit is that and the slack.
 */
const FEMALE_DEEPEST_PROFILE_HEAD_SHARE = 0.873;
const FEMALE_CRAWLER_PROFILE_HEAD_TO_CHEST_LIMIT =
  FEMALE_DEEPEST_PROFILE_HEAD_SHARE + PROFILE_HEAD_DEPTH_SLACK;
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

/** The torso pieces his base garments paint, in the compositor's order. */
const TORSO_PIECES = ['jacket', 'collar', 'collarRim'] as const;

/**
 * The torso garment of {@link gateTorsoOutfit} alone — the jacket, a shirt, a
 * habit, whatever is worn over the torso — painted through the outfit as the
 * compositor paints it.
 */
function paintTorsoGarment(
  ctx: CanvasRenderingContext2D,
  skeleton: Skeleton,
  pose: BipedPose,
): void {
  const view = VIEWS.side;
  const base = gateTorsoOutfit;
  const dressed = { ...pose, outfit: stillOutfit(base) };
  const { context } = humanWornOn(dressed, view, gateLook);
  const torso = torsoFrame(skeleton, dressed, gateLook);
  for (const piece of TORSO_PIECES) {
    paintOutfitPart(
      ctx,
      base,
      'torso',
      { piece, skeleton, view, look: gateLook, torso, envelope: null },
      context,
    );
  }
}

/**
 * G27 — on every upright profile frame the head is no deeper than
 * the look's `profileHeadToChestLimit` of the chest.
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
  for (const row of gatedRows) {
    if (row.view !== 'side') continue;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const pose = poseAsDrawn(withLookBuild(row.pose(frame), gateLook), view);
      const skeleton = buildSkeleton(pose, view);
      const headRise = (skeleton.shoulderCentre.y - skeleton.headCentre.y) / HEAD_RY;
      if (headRise < UPRIGHT_HEAD_RISE_HEAD_RADII) continue;
      framesMeasured++;
      const headAngleNow = headAngle(pose);
      const head = paintPartUpright(skeleton.headCentre, headAngleNow, (ctx) => {
        ctx.translate(skeleton.headCentre.x, skeleton.headCentre.y);
        ctx.rotate(headAngleNow);
        scaleHeadAboutChin(ctx, gateLook);
        drawHead(ctx, pose, view, gateLook);
      });
      const toWaist = {
        x: skeleton.waist.x - skeleton.shoulderCentre.x,
        y: skeleton.waist.y - skeleton.shoulderCentre.y,
      };
      const spineTilt = Math.atan2(toWaist.y, toWaist.x) - Math.PI / 2;
      const jacket = paintPartUpright(skeleton.shoulderCentre, spineTilt, (ctx) =>
        paintTorsoGarment(ctx, skeleton, pose),
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
      if (share <= gateSpec().profileHeadToChestLimit) continue;
      fail(
        'G27',
        `${row.name}[${frame}] draws the head ${share.toFixed(SHARE_DIGITS)} of the chest's depth ` +
          `(limit ${gateSpec().profileHeadToChestLimit}) — edge-on it reads as big as his torso`,
        row.name,
      );
    }
  }
  failUnlessMeasured('G27', framesMeasured, 'upright profile frames');
  console.log(
    `  G27 profile head depth: worst ${worst.toFixed(SHARE_DIGITS)} of the chest at ${worstAt}`,
  );
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
  const standing = probeHumanJoints('idle', 0, gateLook);
  const standingLeg =
    LEG_SIDES.reduce((sum, side) => {
      const leg = legOf(standing, side);
      return sum + drawnLength(leg.hip, leg.ankle);
    }, 0) / LEG_SIDES.length;
  let legsMeasured = 0;
  let plantedMeasured = 0;
  let worstGrowth = Number.NEGATIVE_INFINITY;
  let worstStretch = 0;
  for (const row of gatedRows) {
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

/**
 * What the gates hold one look to where the measure is the look's own — its
 * proportions, the materials it is painted in —
 * rather than the rig's. Every look the gates run on has an entry.
 */
interface HumanLookGateSpec {
  /**
   * G17: whether the look's limbs may be a pixel thin at the tile — a slim
   * man's forearm or thigh three pixels across, its one interior pixel with
   * no partner to show form against. Those crops are counted and skipped,
   * and every crop wide enough is still held to the range.
   */
  readonly slimLimbsAtTile: boolean;
  /** G27: the most the profile head may measure against the chest's depth. */
  readonly profileHeadToChestLimit: number;
  /** G19: the deepest tone of each material, past skin and garment, between the arms and the body. */
  readonly besideArmDeepTones: readonly string[];
  /**
   * G3: a loop whose seam on this look sits under {@link LOOP_SEAM_FLOOR} of
   * its median step for a reason of the look's own, with the floor it is held
   * to instead.
   */
  readonly loopSeamFloors: ReadonlyMap<string, number>;
  /**
   * G4: single steps that on this look exceed their row's allowance for a
   * reason of the look's own, each held exempt like the stomp's impact step:
   * `step` is the index of the frame the step leaves.
   */
  readonly declaredSpikes: readonly DeclaredSpike[];
}

/** One frame-to-frame step of one row that G4 lets past its allowance. */
interface DeclaredSpike {
  readonly row: string;
  readonly step: number;
}

const NO_SEAM_FLOORS: ReadonlyMap<string, number> = new Map();

const MALE_CRAWLER_GATE_SPEC: HumanLookGateSpec = {
  slimLimbsAtTile: true,
  profileHeadToChestLimit: MALE_CRAWLER_PROFILE_HEAD_TO_CHEST_LIMIT,
  besideArmDeepTones: [SLATE_CHINO_CLOTH.cloth.deep, BELT_LEATHER, SMARTWATCH_FACE],
  loopSeamFloors: NO_SEAM_FLOORS,
  declaredSpikes: [],
};

/**
 * The female crawler's rows that measure differently from the male
 * crawler's on the same motion. Props and the palm's glow are painted in the
 * figure's own units and scale with her, so what differs is her build and
 * clothes: her jacket's sleeves run to the wrist, so an arm sweeping out
 * changes more of the silhouette than a rolled sleeve does.
 *
 * `build_side` wraps at 0.474 of its median step, so its floor is that with
 * a little room; a seam collapsed to a held frame still measures near zero.
 */
const FEMALE_BUILD_SIDE_SEAM_FLOOR = 0.42;

const FEMALE_CRAWLER_GATE_SPEC: HumanLookGateSpec = {
  ...MALE_CRAWLER_GATE_SPEC,
  besideArmDeepTones: [STONE_TROUSER_CLOTH.cloth.deep, JACKET_BELT_LEATHER, GOLD_WATCH_DEEP],
  profileHeadToChestLimit: FEMALE_CRAWLER_PROFILE_HEAD_TO_CHEST_LIMIT,
  loopSeamFloors: new Map([['build_side', FEMALE_BUILD_SIDE_SEAM_FLOOR]]),
};

const CRAWLER_LOOK_GATE_SPECS: Readonly<Record<HumanCrawlerLookId, HumanLookGateSpec>> = {
  male_light: MALE_CRAWLER_GATE_SPEC,
  male_dark: MALE_CRAWLER_GATE_SPEC,
  female_light: FEMALE_CRAWLER_GATE_SPEC,
  female_dark: FEMALE_CRAWLER_GATE_SPEC,
};

const LOOK_GATE_SPECS: ReadonlyMap<string, HumanLookGateSpec> = new Map([
  [
    DAVE_LOOK.id,
    {
      slimLimbsAtTile: false,
      profileHeadToChestLimit: DAVE_PROFILE_HEAD_TO_CHEST_LIMIT,
      besideArmDeepTones: [DAVE_DENIM.cloth.deep],
      loopSeamFloors: NO_SEAM_FLOORS,
      declaredSpikes: [],
    },
  ],
  [
    BROTHER_ANSELM_LOOK.id,
    {
      slimLimbsAtTile: false,
      profileHeadToChestLimit: ANSELM_PROFILE_HEAD_TO_CHEST_LIMIT,
      besideArmDeepTones: [],
      loopSeamFloors: NO_SEAM_FLOORS,
      declaredSpikes: [],
    },
  ],
  ...Object.values(HUMAN_CRAWLER_LOOKS).map((look): [string, HumanLookGateSpec] => [
    look.id,
    CRAWLER_LOOK_GATE_SPECS[look.id],
  ]),
]);

function gateSpec(): HumanLookGateSpec {
  const spec = LOOK_GATE_SPECS.get(gateLook.id);
  if (spec === undefined) {
    throw new Error(`no gate thresholds for look "${gateLook.id}": add it to LOOK_GATE_SPECS`);
  }
  return spec;
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
  ['G10', gateRuntimeGaitPacing],
  ['G10', gateFootSlip],
  ['G11', gateArmPhase],
  ['G12', gateBlink],
  ['G13', gateLegReach],
  ['G14', gateWalkFootDown],
  ['G14', gateRunFlight],
  ['G15', gateImpactTiming],
  ['G16', gateViewConsistency],
  ['G17', gateMuscleRead],
  ['G19', gateOutlinePolicy],
  ['G20', gateHandOff],
  ['G21', gateStatusFigureBox],
  ['G22', gateHandedness],
  ['G23', gateLayerHoldsInk],
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
  look: HumanLook,
  outfit: Outfit<'human'> = defaultOutfitOf(look),
): string[] {
  gateLook = look;
  gateOutfit = outfit;
  gateTorsoOutfit = outfitOf(look, []);
  gateRows = CRAWLER_RIG_ROWS;
  gatedRows = gateRows.rows;
  gateFigure = humanFigureWearing(look, outfit);
  // The gates that drive a HumanPlayer or the animator measure whichever look
  // the human crawler is painted as, so it is the gated one for the run.
  const playerLook = activeHumanLook();
  setHumanLook(look);
  try {
    return gateFailuresOf(GATES);
  } finally {
    setHumanLook(playerLook);
  }
}

/**
 * The gates on a figure's own art, for a figure on the rig that is not the
 * crawler: every one that measures its rows alone, none that drives the
 * crawler's animator or sizes his working set.
 */
const RIG_FIGURE_GATES: ReadonlyArray<readonly [string, () => void]> = [
  ['G1', gateStructure],
  ['G3', gateLoopClosure],
  ['G4', gateMotionContinuity],
  ['G5', gateStrikePeaksOnImpact],
  ['G10', gateFootSlip],
  ['G11', gateArmPhase],
  ['G12', gateBlink],
  ['G13', gateLegReach],
  ['G14', gateWalkFootDown],
  ['G22', gateHandedness],
  ['G23', gateLayerHoldsInk],
  ['G25', gateProfileFaceShows],
  ['G26', gateHeadOnLegLength],
  ['G27', gateProfileHeadDepth],
];

/**
 * Runs the gates on a figure's own art on `played`, the rows of `rows` the
 * figure plays, painted in `look` and `outfit`, and returns one message per
 * failure that should fail the run.
 */
export function rigFigureGateFailures(
  rows: RigRows,
  look: HumanLook,
  outfit: Outfit<'human'>,
  played: ReadonlySet<string>,
): string[] {
  const previous = { gateLook, gateOutfit, gateTorsoOutfit, gateRows, gatedRows, gateFigure };
  gateLook = look;
  gateOutfit = outfit;
  gateTorsoOutfit = outfit;
  gateRows = rows;
  gatedRows = rows.rows.filter((row) => played.has(row.name));
  gateFigure = gateFigureFor(outfit).def;
  try {
    const unknown = [...played].filter((name) => rows.rowOf(name) === undefined);
    return [
      ...unknown.map((name) => `G1: ${look.id} plays "${name}", which its rows do not hold`),
      ...gateFailuresOf(RIG_FIGURE_GATES),
    ];
  } finally {
    ({ gateLook, gateOutfit, gateTorsoOutfit, gateRows, gatedRows, gateFigure } = previous);
  }
}

function gateFailuresOf(gates: ReadonlyArray<readonly [string, () => void]>): string[] {
  alphaByCell.clear();
  failures.length = 0;
  const known = new Set(gates.map(([id]) => id));
  for (const id of PENDING_GATES) {
    if (!known.has(id))
      failures.push({ id, message: `PENDING_GATES names ${id}, which is no gate` });
  }
  for (const [, run] of gates) run();

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
