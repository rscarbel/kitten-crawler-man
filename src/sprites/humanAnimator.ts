/**
 * Carl's animator: which row he is drawn in, and how far through it he is.
 *
 * `HumanPlayer` tells it what is happening — how far he actually moved this
 * tick, which way he faces, that a strike or a Smush began, that he was hit,
 * that he levelled up — and `drawHumanSelection` draws whatever it answers.
 * Everything here is tick-driven and seeded, so a replay of the same ticks
 * picks the same rows on the same frames; the art gates replay it exactly that
 * way.
 *
 * Every choice is made over the row table's metadata rather than over row
 * names: a strike family is "the strikes drawn in this view", a travelling
 * strike names the standing one it replaces, a fidget is any row with that
 * role. A new row plugs in by being added to the table.
 *
 * Every cut from a stride to another row is made where the legs already
 * agree: a stride is stopped on the frame its gait's stop begins from, and
 * set off from standing through its gait's start. A blow's impact frame is
 * tied to the tick its hit lands, so a blow thrown on the move cannot wait for
 * the stride either: every travelling blow is painted in several versions,
 * each begun at a different phase of the stride, and the one whose legs begin
 * nearest the stride on screen is thrown. On the move he never throws a
 * standing blow — the standing picture carried over the floor is a frozen
 * slide.
 */

import { progressFrameIndex, walkFrameIndex } from '../core/SpriteRenderer';
import { type CarlView } from './art/carl/rig';
import {
  MAX_GAIT_ADVANCE_PX_PER_TICK,
  RUN_RADIANS_PER_PX,
  RUN_SPEED_ENTER_PX_PER_TICK,
  RUN_SPEED_EXIT_PX_PER_TICK,
  WALK_RADIANS_PER_PX,
} from './art/human/locomotion';
import { groundPxPerFrame, type HumanJointProbe, probeHumanJoints } from './art/human/probe';
import { heldLength, IDLE_FRAME_TICKS, TICKS_PER_SECOND } from './art/human/timing';
import {
  HUMAN_ROWS,
  type HumanGait,
  humanRowOf,
  type HumanRowName,
  type HumanRowRole,
  type RowSpec,
  type StrikeTag,
} from './art/humanFigure';
import { fightReactionSpans } from './humanReactions';
import {
  type HumanRowSelection,
  isGaitCycle,
  rowFrameAtTicks,
  rowLengthInTicks,
  strikeWindUpFrames,
  viewForFacing,
} from './humanSprite';
import { TWO_PI } from './art/carl/geometry';
import { mulberry32, type Rng } from './person/rng';
import { wrapPhase } from './art/human/gaitShared';
import { PHASE_EPSILON } from './art/human/travelling';

// ── Gait pacing ──────────────────────────────────────────────────────────────

const RADIANS_PER_PX: Readonly<Record<HumanGait, number>> = {
  walk: WALK_RADIANS_PER_PX,
  run: RUN_RADIANS_PER_PX,
};

/**
 * Gait phase, in radians, per pixel of ground actually covered. The phase is
 * advanced by distance, never by time, which is the only way a foot in stance
 * can stay where it was put on the floor.
 */
export function gaitRadiansPerPx(gait: HumanGait): number {
  return RADIANS_PER_PX[gait];
}

/**
 * How much of each tick's measured speed the running estimate takes. A few
 * ticks' memory keeps one blocked tick against a wall from dropping him into
 * a walk. It is seeded from the first tick's speed when he sets off from
 * standing, so the gait he sets off in is the one his speed asks for.
 */
const SPEED_SMOOTHING = 0.3;
/** Under this many pixels a tick he did not move. */
const MOTION_EPSILON_PX = 0.05;
/**
 * Within this share above the walk-to-run threshold the walk is warmed: he is
 * slowing toward it (wading, a slowing status) and will be drawn in it soon.
 */
const WALK_PREWARM_HEADROOM = 0.25;

/**
 * A cut between a stride and a row keyed to a phase of it is made only within
 * this many frames of that phase: the jump is then no larger than one frame
 * of the cycle itself, which is motion the eye already accepts every frame.
 */
const HAND_OFF_FRAMES = 1;
/** A cycle phase set half a frame in, so rounding either way lands on the same frame. */
const HALF_FRAME = 0.5;
/**
 * A cycle frame counts as nearest standing when its joints are within this
 * share of the best frame's distance from the standing pose — which lets the
 * mirror-image frame half a cycle on, level with it to within rounding, count
 * too, and halves the wait for one.
 */
const NEAR_BEST_SHARE = 0.05;

// ── Combat and idling timings ────────────────────────────────────────────────

/** How long he holds the guard after the last blow thrown or taken. */
const GUARD_HOLD_TICKS = 3 * TICKS_PER_SECOND;
/** Fidgets are for a quiet moment: none for this long after any damage. */
const FIDGET_SUPPRESS_TICKS = 4 * TICKS_PER_SECOND;
/**
 * A fidget comes after 6 to 12 seconds of standing about. It waits for the
 * idle loop's seam once its delay is up, which can add up to a whole loop, so
 * the roll leaves a loop's worth of room under the ceiling — and none at all,
 * rather than a negative span, should the loop ever outgrow the window.
 */
const FIDGET_DELAY_MIN_TICKS = 6 * TICKS_PER_SECOND;
const FIDGET_DELAY_MAX_TICKS = 12 * TICKS_PER_SECOND;
const FIDGET_DELAY_SPAN_TICKS = Math.max(
  0,
  FIDGET_DELAY_MAX_TICKS - FIDGET_DELAY_MIN_TICKS - heldLength(IDLE_FRAME_TICKS),
);
/**
 * How far ahead of playing it a fidget's row is queued for baking: enough for
 * the prewarm slice to paint a whole row, well inside the cache's
 * `IDLE_FRAMES_BEFORE_RELEASE` window so the warming is not swept unused.
 */
const FIDGET_PREWARM_LEAD_TICKS = 2 * TICKS_PER_SECOND;
/** A blow thrown this soon after the last one ended continues the combo. */
export const COMBO_WINDOW_TICKS = TICKS_PER_SECOND / 2;
/** Past this share of his reach a target is at the edge of it, where kicks reach and fists do not. */
export const FAR_REACH_SHARE = 0.75;

const LOW_TARGET_TAGS: readonly StrikeTag[] = ['punt', 'stomp', 'low'];
const TALL_TARGET_TAGS: readonly StrikeTag[] = ['punch', 'high'];
const FAR_TARGET_TAGS: readonly StrikeTag[] = ['long'];
/** Blows made for an enemy already on the floor: never thrown at one still standing. */
const DOWNED_TARGET_TAGS: readonly StrikeTag[] = ['downed'];

/**
 * Draws from the family's shuffled bag: the bag in hand first, and if nothing
 * allowed is left in it, one freshly shuffled bag — which holds every row of
 * the family, so the second draw always finds one.
 */
const BAG_DRAW_ATTEMPTS = 2;

/** Seed for the fidget order and strike shuffles, so a replay of the same ticks draws the same gestures. */
const ANIMATOR_SEED = 0x6361726c;

// ── Row lookups, built once from the table ───────────────────────────────────

function rowsWithRole(role: HumanRowRole): readonly RowSpec[] {
  return HUMAN_ROWS.filter((row) => row.role === role);
}

function inView(rows: readonly RowSpec[], view: CarlView): readonly RowSpec[] {
  return rows.filter((row) => row.view === view);
}

const IDLE_ROWS = rowsWithRole('idle');
const GUARD_ROWS = rowsWithRole('guard');
const FIDGET_ROWS = rowsWithRole('fidget');
const DROP_ROWS = rowsWithRole('drop');
const START_ROWS = rowsWithRole('start');
const STOP_ROWS = rowsWithRole('stop');
const STOMP_ROWS = rowsWithRole('stomp');
const STANDING_STOMPS = STOMP_ROWS.filter((row) => row.locomotion !== 'travelling');
const TRAVELLING_STOMPS = STOMP_ROWS.filter((row) => row.locomotion === 'travelling');
const STRIKE_ROWS = rowsWithRole('strike');
const STANDING_STRIKES = STRIKE_ROWS.filter((row) => row.locomotion !== 'travelling');
const TRAVELLING_STRIKES = STRIKE_ROWS.filter((row) => row.locomotion === 'travelling');
/** Every blow painted on the move, strike or Smush. */
const TRAVELLING_BLOWS = [...TRAVELLING_STRIKES, ...TRAVELLING_STOMPS];
/** The gestures a level-up plays, in the order the table gives them. */
const CELEBRATION_ROWS = FIDGET_ROWS.filter((row) => row.levelUpOrder !== undefined).sort(
  (a, b) => (a.levelUpOrder ?? 0) - (b.levelUpOrder ?? 0),
);
const CYCLE_ROWS = HUMAN_ROWS.filter(isGaitCycle);

/** The rows the melee family of one view can throw, standing. */
function strikeFamily(view: CarlView): readonly RowSpec[] {
  return inView(STANDING_STRIKES, view);
}

/** The versions of a standing strike painted on the move, one per phase of the stride they begin at. */
function travellingVersions(standing: RowSpec): readonly RowSpec[] {
  return TRAVELLING_STRIKES.filter((row) => row.strike?.standing === standing.name);
}

function hasTravellingVersions(row: RowSpec): boolean {
  return travellingVersions(row).length > 0;
}

function firstInView(rows: readonly RowSpec[], view: CarlView): RowSpec | undefined {
  return rows.find((row) => row.view === view);
}

/** The start or stop, of `rows`, that bridges standing and `gait` in a view. */
function bridgeFor(rows: readonly RowSpec[], gait: HumanGait, view: CarlView): RowSpec | undefined {
  return rows.find((row) => row.view === view && row.bridges === gait);
}

/**
 * The locomotion cycle for a gait and view. A gait the figure has no row for
 * falls back to whichever cycle the view does have, so the legs keep moving.
 */
export function cycleRow(gait: HumanGait, view: CarlView): RowSpec | undefined {
  const exact = CYCLE_ROWS.find((row) => row.gait === gait && row.view === view);
  return exact ?? firstInView(CYCLE_ROWS, view);
}

/** Distance between two phases on the unit cycle. */
function cycleDistance(a: number, b: number): number {
  const d = Math.abs(wrapPhase(a - b));
  return Math.min(d, 1 - d);
}

/** The phase, in radians, at the middle of a cycle frame. */
function framePhase(frame: number, frameCount: number): number {
  return ((frame + HALF_FRAME) / frameCount) * TWO_PI;
}

/**
 * Whether cutting from a cycle frame to a row keyed at `phase` (a fraction of
 * the cycle) is within {@link HAND_OFF_FRAMES} of it.
 */
function frameMeetsPhase(frame: number, frameCount: number, phase: number): boolean {
  return cycleDistance(frame / frameCount, phase) <= HAND_OFF_FRAMES / frameCount + PHASE_EPSILON;
}

// ── Where a stride meets standing ────────────────────────────────────────────

/** The furthest any ankle or wrist sits from where another pose has it, in cell pixels. */
function jointJump(a: HumanJointProbe, b: HumanJointProbe): number {
  const pairs = [
    [a.leftLeg.ankle, b.leftLeg.ankle],
    [a.rightLeg.ankle, b.rightLeg.ankle],
    [a.leftArm.wrist, b.leftArm.wrist],
    [a.rightArm.wrist, b.rightArm.wrist],
  ] as const;
  return Math.max(...pairs.map(([p, q]) => Math.hypot(p.x - q.x, p.y - q.y)));
}

const nearestStandingCache = new Map<string, readonly number[]>();

/**
 * The frames of a cycle whose legs and arms are nearest a standing row's first
 * frame: where a stride with no stop row of its own cuts to standing, and
 * where one set off from standing begins. Read off the solved rig, once per
 * pair, so it follows the art.
 */
function framesNearestStanding(cycle: RowSpec, standing: RowSpec): readonly number[] {
  const key = `${cycle.name}>${standing.name}`;
  const cached = nearestStandingCache.get(key);
  if (cached !== undefined) return cached;
  const rest = probeHumanJoints(standing.name, 0);
  const jumps = Array.from({ length: cycle.frameCount }, (_unused, frame) =>
    jointJump(probeHumanJoints(cycle.name, frame), rest),
  );
  const best = Math.min(...jumps);
  const frames = jumps
    .map((jump, frame) => ({ jump, frame }))
    .filter(({ jump }) => jump <= best * (1 + NEAR_BEST_SHARE))
    .map(({ frame }) => frame);
  nearestStandingCache.set(key, frames);
  return frames;
}

/** The furthest either ankle sits from where another pose has it, in cell pixels. */
function ankleJump(a: HumanJointProbe, b: HumanJointProbe): number {
  return Math.max(
    Math.hypot(a.leftLeg.ankle.x - b.leftLeg.ankle.x, a.leftLeg.ankle.y - b.leftLeg.ankle.y),
    Math.hypot(a.rightLeg.ankle.x - b.rightLeg.ankle.x, a.rightLeg.ankle.y - b.rightLeg.ankle.y),
  );
}

const nearestVersionCache = new Map<string, RowSpec>();

/**
 * Of a travelling blow's versions, the one whose first frame's legs are
 * nearest the cell on screen: the cut into it then jumps the feet least.
 * Read off the solved rig, once per cell and blow, so it follows the art —
 * whatever stride, start or walk the cell is from.
 */
function nearestVersion(
  drawn: HumanRowSelection,
  versions: readonly RowSpec[],
): RowSpec | undefined {
  if (versions.length === 0) return undefined;
  const first = versions[0];
  const key = `${drawn.row}[${drawn.frame}]>${first.name}`;
  const cached = nearestVersionCache.get(key);
  if (cached !== undefined) return cached;
  const onScreen = probeHumanJoints(drawn.row, drawn.frame);
  let best = first;
  let bestJump = Number.POSITIVE_INFINITY;
  for (const version of versions) {
    const jump = ankleJump(onScreen, probeHumanJoints(version.name, 0));
    if (jump >= bestJump) continue;
    best = version;
    bestJump = jump;
  }
  nearestVersionCache.set(key, best);
  return best;
}

// ── Seeded randomness ────────────────────────────────────────────────────────

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const held = out[i];
    out[i] = out[j];
    out[j] = held;
  }
  return out;
}

// ── Public shapes ────────────────────────────────────────────────────────────

/** What the strike is thrown at, as far as choosing a blow goes. */
export interface StrikeTargetContext {
  /** Knee-high: a rat, a grub, a tuskling. Favours punts and stomps. */
  readonly lowProfile: boolean;
  /**
   * Stunned or pinned — on the floor or as good as. Favours punts and stomps,
   * and is the only target a blow made for the floor is thrown at.
   */
  readonly downed: boolean;
  /** Much taller than a man. Favours punches and high kicks. */
  readonly tall: boolean;
  /** Distance to the target as a share of his melee reach. */
  readonly reachShare: number;
}

/** The player's strike and Smush timers, which set how far through a blow he is. */
export interface HumanStrikeClock {
  readonly attackTimer: number;
  readonly attackFrames: number;
  readonly smushTimer: number;
  readonly smushFrames: number;
}

interface HumanAnimatorTick {
  /**
   * Ground covered this tick, in world pixels, measured from his position —
   * not from `isMoving`, which means only that he tried to walk.
   */
  readonly groundPx: number;
  readonly facingX: number;
  readonly facingY: number;
  readonly knockedOut: boolean;
  readonly clock: HumanStrikeClock;
}

interface HumanAnimatorOptions {
  /**
   * Asks the frame cache to bake a row ahead of its first draw — the whole of
   * it, or only its first `frames` frames. The animator calls it for the rows
   * it knows it is about to need.
   */
  readonly warmRow?: (row: HumanRowName, frames?: number) => void;
}

/**
 * - `idle` / `guard`: standing, in the relaxed or the combat-ready loop.
 * - `fidget`: a one-shot gesture from and back to the idle's first frame.
 * - `drop`: the guard lowered to the idle, a one-shot from the guard's first frame.
 * - `start`: the run's start, paced by the ground he covers.
 * - `unstart`: stopped part-way into the start, which plays back to standing.
 * - `cycle`: a walk or run cycle, paced by the ground he covers.
 * - `settle`: stopped, the legs finishing the stride to a frame a stop can take over from.
 * - `stop`: the run's stop, played off its own clock.
 */
type BaseMode =
  'idle' | 'guard' | 'drop' | 'fidget' | 'start' | 'unstart' | 'cycle' | 'settle' | 'stop';

interface Latch {
  readonly row: RowSpec;
  readonly facingX: number;
  readonly facingY: number;
  readonly flipX: boolean;
}

/**
 * Why an action or reaction stopped playing:
 * - `finished`: a one-shot played its last frame through.
 * - `stopped`: `stopAction` / `stopReaction` ended it.
 * - `moved`: he moved, and it was cancelled by movement.
 * - `interrupted`: something that outranks it began — a blow, a reaction, a
 *   knockout, a reset — or another of its kind replaced it.
 * - `defeated`: the world stopped under a defeat. Whatever gameplay the row
 *   was holding back must not happen now: the death screen is up, and what
 *   follows it rewinds or rebuilds the world anyway.
 */
type HumanActionEndReason = 'finished' | 'stopped' | 'moved' | 'interrupted' | 'defeated';

/** A callback run on the tick a frame of a playing action is first drawn. */
export interface HumanActionFrameEvent {
  readonly frame: number;
  readonly run: () => void;
}

/**
 * How to play an action or reaction row. Every callback runs inside the
 * animator's tick, so it is as deterministic as the tick itself.
 */
export interface HumanActionOptions {
  /** Loop the row until it is stopped, rather than playing it once. */
  readonly loop?: boolean;
  /**
   * Hold a one-shot on its last frame until it is stopped, rather than handing
   * back to standing — a pose held while a bar fills, say.
   */
  readonly holdLastFrame?: boolean;
  /**
   * The facing to draw it in: which way a profile row is mirrored. Absent,
   * his facing when it starts.
   */
  readonly faceX?: number;
  readonly faceY?: number;
  /**
   * End it the first tick he covers ground, handing back to the stride.
   * Defaults to true for an action and false for a reaction — a flinch plays
   * out even as he runs on.
   */
  readonly cancelOnMove?: boolean;
  /** Called on the tick each listed frame is first drawn, in frame order. */
  readonly onFrame?: readonly HumanActionFrameEvent[];
  /** Called once when it stops playing, for whatever reason. */
  readonly onEnd?: (reason: HumanActionEndReason) => void;
  /**
   * Paces a one-shot off something other than the clock: how much of the row
   * has played, 0 to 1, read once a tick. A stumble is paced by how far the
   * shove has carried him, so it stops where he is stopped. It finishes on 1.
   */
  readonly progress?: () => number;
}

export interface HumanReactionOptions extends HumanActionOptions {
  /**
   * Plays over a blow in flight: a knockdown, a death. Without it a reaction
   * is refused while he is mid-blow — a flinch never cancels his own punch.
   */
  readonly overridesBlows?: boolean;
}

/**
 * The layers a scripted row can play in, from lowest to highest: an action
 * (hammering a board, pulling a lever) outranks only standing and moving; a
 * reaction (a flinch, a knockback) outranks an action; a blow outranks both,
 * except a reaction that overrides blows.
 */
type ScriptedLayer = 'action' | 'reaction';

interface Scripted {
  readonly row: RowSpec;
  readonly options: HumanActionOptions;
  readonly flipX: boolean;
  readonly cancelOnMove: boolean;
  readonly overridesBlows: boolean;
  /** Ticks it has been drawn for, counted from its first frame. */
  ticks: number;
  /** Started during this tick's update, so this tick draws its first frame rather than advancing it. */
  fresh: boolean;
  /** The last frame whose `onFrame` callbacks have run, -1 before any. */
  firedThrough: number;
  /** The frame a row paced by `progress` last settled on, or null for one paced by the clock. */
  pacedFrame: number | null;
}

// ── The animator ─────────────────────────────────────────────────────────────

export class HumanAnimator {
  private readonly random: Rng;
  private readonly warmRow: (row: HumanRowName, frames?: number) => void;

  private tickCount = 0;
  private facingX = 1;
  private view: CarlView = 'side';

  private mode: BaseMode = 'idle';
  /** The row a one-shot base mode (start, unstart, stop, fidget) is playing. */
  private oneShot: RowSpec | null = null;
  /** Ticks into a one-shot played off its own clock (stop, fidget). */
  private oneShotTicks = 0;
  /** Frames into a one-shot paced by ground (start, unstart), fractional. */
  private oneShotFrames = 0;
  /** Ticks into the idle or guard loop, from its first frame. */
  private loopTicks = 0;

  private phase = 0;
  private gait: HumanGait = 'walk';
  private smoothedSpeed = 0;
  /** Whether he is slow enough that the walk has been warmed, so it is asked for once per approach. */
  private nearWalk = false;
  /** The cycle frames a settle may leave from, and the stop it hands to (null: standing). */
  private settleExits: readonly number[] = [];
  private settleTo: RowSpec | null = null;

  private strike: Latch | null = null;
  private smush: Latch | null = null;
  private action: Scripted | null = null;
  private reaction: Scripted | null = null;
  private knockedOut = false;
  private lastStrike: HumanRowName | null = null;
  private lastStrikeView: CarlView | null = null;
  private lastStrikeEndTick = Number.NEGATIVE_INFINITY;
  private comboStep = 0;
  private comboClosed = false;
  private readonly strikeBags = new Map<CarlView, HumanRowName[]>();

  private guardTicks = 0;
  private suppressTicks = 0;
  private idleTicks = 0;
  private fidgetDelay: number;
  private fidgetBag: HumanRowName[] = [];
  private lastFidget: HumanRowName | null = null;
  private warmedFidget: HumanRowName | null = null;
  private pendingCelebration = false;
  /** The rest of a level-up's gestures, after the one playing. */
  private celebrationQueue: RowSpec[] = [];

  constructor(options: HumanAnimatorOptions = {}) {
    this.random = mulberry32(ANIMATOR_SEED);
    this.warmRow = options.warmRow ?? ((): void => undefined);
    this.fidgetDelay = this.rollFidgetDelay();
  }

  /** The gait phase in radians, 0 at right-foot contact. */
  get gaitPhase(): number {
    return this.phase;
  }

  /** The gait the legs are cycling in, when they are. */
  get currentGait(): HumanGait {
    return this.gait;
  }

  /**
   * The facing a blow in flight was thrown along, or null between blows. The
   * hit is resolved along this, so the fist you see is where the damage goes
   * even if the stick is swung the other way mid-swing.
   */
  get latchedFacing(): { readonly x: number; readonly y: number } | null {
    const latch = this.smush ?? this.strike;
    return latch === null ? null : { x: latch.facingX, y: latch.facingY };
  }

  /** Whether an action row is playing. */
  get isActing(): boolean {
    return this.action !== null;
  }

  /**
   * Plays a row as an action: a gesture a system asks for — hammering a board,
   * pulling a lever, drinking a potion. Refused (false) while a blow or a
   * reaction is playing or he is out cold; otherwise it replaces any action
   * already playing, which ends as `interrupted`. By default moving cancels it.
   */
  playAction(row: HumanRowName, options: HumanActionOptions = {}): boolean {
    const blowInFlight = this.strike !== null || this.smush !== null;
    if (blowInFlight || this.reaction !== null || this.knockedOut) return false;
    this.endScripted('action', 'interrupted');
    this.action = this.scripted('action', row, options, false);
    this.restartIdleClock();
    return true;
  }

  /**
   * Plays a row as a reaction: something done to him — a flinch, a knockback,
   * a knockdown. It ends any action (`interrupted`) and replaces any reaction.
   * Refused (false) while a blow is in flight unless `overridesBlows` is set;
   * one that is set plays over the blow and over a knockout.
   */
  playReaction(row: HumanRowName, options: HumanReactionOptions = {}): boolean {
    const overridesBlows = options.overridesBlows ?? false;
    const blowInFlight = this.strike !== null || this.smush !== null;
    if (blowInFlight && !overridesBlows) return false;
    this.endScripted('action', 'interrupted');
    this.endScripted('reaction', 'interrupted');
    this.reaction = this.scripted('reaction', row, options, overridesBlows);
    this.restartIdleClock();
    return true;
  }

  /** Ends the playing action, if any, as `stopped`. */
  stopAction(): void {
    this.endScripted('action', 'stopped');
  }

  /** Ends the playing reaction, if any, as `stopped`. */
  stopReaction(): void {
    this.endScripted('reaction', 'stopped');
  }

  /**
   * Ends the playing action, if any, as `defeated`, without running any of
   * its frames still to come — for the tick the world stops under a defeat.
   */
  abandonActionForDefeat(): void {
    this.endScripted('action', 'defeated');
  }

  /**
   * Advances only the playing reaction — the fall he died in — for a world
   * stopped under the death screen. Nothing else moves on: no action, no
   * blow, no stride.
   */
  tickReactionOnly(): void {
    this.tickScripted('reaction', false);
  }

  /**
   * Drops everything in flight — a checkpoint restore, a revive. The seeded
   * orders (strike bags, fidget bag) carry on: they are what keeps a long
   * session from repeating itself, and nothing about a restore calls for the
   * same blows again.
   */
  reset(): void {
    this.endScripted('action', 'interrupted');
    this.endScripted('reaction', 'interrupted');
    this.knockedOut = false;
    this.mode = 'idle';
    this.oneShot = null;
    this.oneShotTicks = 0;
    this.oneShotFrames = 0;
    this.loopTicks = 0;
    this.phase = 0;
    this.gait = 'walk';
    this.smoothedSpeed = 0;
    this.nearWalk = false;
    this.settleExits = [];
    this.settleTo = null;
    this.strike = null;
    this.smush = null;
    this.lastStrike = null;
    this.lastStrikeView = null;
    this.lastStrikeEndTick = Number.NEGATIVE_INFINITY;
    this.comboStep = 0;
    this.comboClosed = false;
    this.guardTicks = 0;
    this.suppressTicks = 0;
    this.pendingCelebration = false;
    this.celebrationQueue = [];
    this.restartIdleClock();
  }

  /**
   * Forgets which rows it has already asked to have warmed, so each is asked
   * for again when next due — for when the figure those requests went to is
   * swapped for another. The blows he could throw from the stride he is in,
   * and a fight's rows while his guard is up, are asked for at once: nothing
   * else asks for them again until he stops, turns or trades a blow.
   */
  forgetWarmRequests(): void {
    this.nearWalk = false;
    this.warmedFidget = null;
    if (this.isStriding()) this.warmTravellingBlows(this.view);
    if (this.guardTicks > 0) this.warmCombatRows(this.view);
  }

  /**
   * Chooses the blow for a strike thrown along a facing, latches that facing
   * until the blow is over, and returns the row. Null when the view has no
   * strikes to throw.
   */
  beginStrike(
    facingX: number,
    facingY: number,
    target: StrikeTargetContext | null,
  ): HumanRowName | null {
    const view = viewForFacing(facingX, facingY);
    const family = strikeFamily(view);
    if (family.length === 0) return null;

    // A chain is thrown at one thing: turned to face another way, he starts over.
    const continuesCombo =
      !this.comboClosed &&
      this.lastStrikeView === view &&
      this.tickCount - this.lastStrikeEndTick <= COMBO_WINDOW_TICKS;
    this.comboStep = continuesCombo ? this.comboStep + 1 : 0;
    this.comboClosed = false;

    const striding = this.isStriding();
    const chosen = this.chooseStrike(view, family, target, striding);
    if (chosen.strike?.tags.includes('finisher') === true) this.comboClosed = true;
    this.lastStrike = chosen.name;
    this.lastStrikeView = view;
    const versions = striding ? travellingVersions(chosen) : [];
    const drawn = nearestVersion(this.baseSelection(), versions) ?? chosen;
    this.interruptScriptedForBlow();
    this.strike = latchOf(drawn, facingX, facingY);
    this.warmCombatRows(view);
    this.noteCombat(true);
    return drawn.name;
  }

  /**
   * Latches the facing a Smush is stamped along and picks its row. On the move
   * he hops into the stamp, in the version of the hop whose legs begin nearest
   * the stride on screen; standing still he stamps standing. A view with no
   * Smush of its own stamps in whichever view has one.
   */
  beginSmush(facingX: number, facingY: number): HumanRowName | null {
    const view = viewForFacing(facingX, facingY);
    const fallback = STANDING_STOMPS.length > 0 ? STANDING_STOMPS[0] : undefined;
    const standing = firstInView(STANDING_STOMPS, view) ?? fallback;
    const hops = this.isStriding() ? inView(TRAVELLING_STOMPS, view) : [];
    const hop = nearestVersion(this.baseSelection(), hops);
    const row = hop ?? standing;
    if (row === undefined) return null;
    this.interruptScriptedForBlow();
    this.smush = latchOf(row, facingX, facingY);
    this.warmCombatRows(view);
    this.noteCombat(true);
    return row.name;
  }

  /**
   * Damage dealt or taken. Fidgets are suppressed for a while after either;
   * with `guard` he also raises his hands for a few seconds.
   */
  noteCombat(guard: boolean): void {
    this.celebrationQueue = [];
    this.suppressTicks = FIDGET_SUPPRESS_TICKS;
    this.restartIdleClock();
    if (guard) {
      this.guardTicks = GUARD_HOLD_TICKS;
      this.warmCombatRows(this.view);
    }
    if (this.mode === 'fidget') this.endOneShotToRest();
  }

  /**
   * A level gained: a clench of the fist and a look up at the ceiling, played
   * the next time he is standing — out of the relaxed idle or straight out of
   * the guard a killing blow leaves him in, never over a stride or a blow. If
   * he moves before he gets the chance, it is dropped.
   */
  celebrateLevelUp(): void {
    this.pendingCelebration = true;
  }

  /** Advances one fixed update. Call once per tick, after movement. */
  tick(input: HumanAnimatorTick): void {
    this.tickCount++;
    if (this.guardTicks > 0) this.guardTicks--;
    if (this.suppressTicks > 0) this.suppressTicks--;
    this.facingX = input.facingX;
    const view = viewForFacing(input.facingX, input.facingY);
    if (view !== this.view) this.changeView(view);

    const groundPx = Math.min(Math.max(0, input.groundPx), MAX_GAIT_ADVANCE_PX_PER_TICK);
    const moving = groundPx > MOTION_EPSILON_PX;
    // Setting off from standing, the gait is the one this tick's speed asks
    // for: an estimate rising from zero would draw a stride of walk before
    // every run.
    const settingOff = moving && this.isStanding();
    if (settingOff) this.smoothedSpeed = groundPx;
    else this.smoothedSpeed += (groundPx - this.smoothedSpeed) * SPEED_SMOOTHING;
    if (settingOff) this.gait = this.smoothedSpeed >= RUN_SPEED_ENTER_PX_PER_TICK ? 'run' : 'walk';
    if (moving) this.chooseGait();

    this.knockedOut = input.knockedOut;
    if (this.knockedOut) {
      this.endScripted('action', 'interrupted');
      if (this.reaction !== null && !this.reaction.overridesBlows) {
        this.endScripted('reaction', 'interrupted');
      }
    }
    this.tickScripted('reaction', moving);
    this.tickScripted('action', moving);

    this.finishBlows(input.clock, moving);
    if (this.strike !== null || this.smush !== null) {
      // The legs of a travelling blow are keyed to the same distance as the
      // run, so the phase keeps turning under it; and what he is doing with
      // his feet is kept up to date, so the blow ends into it.
      this.advancePhase(groundPx);
      this.trackFeetUnderBlow(moving);
      return;
    }

    if (input.knockedOut) {
      // Out cold is not on guard.
      this.guardTicks = 0;
      this.enterRest();
      this.restartIdleClock();
      this.pendingCelebration = false;
      return;
    }

    if (moving) this.tickMoving(groundPx);
    else this.tickStanding();
  }

  /** The row, frame and mirroring to draw on this tick. */
  select(clock: HumanStrikeClock): HumanRowSelection {
    const overriding = this.reaction?.overridesBlows === true ? this.reaction : null;
    if (overriding !== null) return scriptedFrame(overriding);
    if (this.smush !== null && clock.smushTimer > 0) {
      return latchedFrame(this.smush, clock.smushTimer, clock.smushFrames);
    }
    if (this.strike !== null && clock.attackTimer > 0) {
      return latchedFrame(this.strike, clock.attackTimer, clock.attackFrames);
    }
    if (this.reaction !== null) return scriptedFrame(this.reaction);
    if (this.action !== null) return scriptedFrame(this.action);
    return this.baseSelection();
  }

  /** The row, frame and mirroring of the base mode — the stride, start, stop, fidget or rest. */
  private baseSelection(): HumanRowSelection {
    const flip = this.facingX < 0;
    const pick = (row: RowSpec, frame: number): HumanRowSelection => ({
      row: row.name,
      frame,
      flipX: row.mirrorable && flip,
    });

    if (this.oneShot !== null) {
      const pacedByGround = this.mode === 'start' || this.mode === 'unstart';
      const paced = pacedByGround
        ? Math.floor(this.oneShotFrames)
        : rowFrameAtTicks(this.oneShot, this.oneShotTicks);
      const frame = Math.max(0, Math.min(paced, this.oneShot.frameCount - 1));
      return pick(this.oneShot, frame);
    }
    if (this.mode === 'cycle' || this.mode === 'settle') {
      const row = cycleRow(this.gait, this.view);
      if (row !== undefined) return pick(row, walkFrameIndex(this.phase, row.frameCount));
    }
    const rest = this.restRow();
    const frame = rowFrameAtTicks(rest, this.loopTicks % rowLengthInTicks(rest));
    return pick(rest, frame);
  }

  // ── Actions and reactions ──────────────────────────────────────────────────

  private scripted(
    layer: ScriptedLayer,
    name: HumanRowName,
    options: HumanActionOptions,
    overridesBlows: boolean,
  ): Scripted {
    const row = humanRowOf(name) ?? HUMAN_ROWS[0];
    const faceX = options.faceX ?? this.facingX;
    return {
      row,
      options,
      flipX: row.mirrorable && faceX < 0,
      cancelOnMove: options.cancelOnMove ?? layer === 'action',
      overridesBlows,
      ticks: 0,
      fresh: true,
      firedThrough: -1,
      pacedFrame: null,
    };
  }

  private playing(layer: ScriptedLayer): Scripted | null {
    return layer === 'action' ? this.action : this.reaction;
  }

  private endScripted(layer: ScriptedLayer, reason: HumanActionEndReason): void {
    const playing = this.playing(layer);
    if (playing === null) return;
    if (layer === 'action') this.action = null;
    else this.reaction = null;
    // A scripted row is authored to end on the standing loop's first frame, and
    // the loop's clock kept running underneath it: picking the loop up where
    // that clock had got to pops him from the row's last pose to a mid-breath
    // one.
    const handsBackToRest = this.mode === 'idle' || this.mode === 'guard';
    if (handsBackToRest && reason !== 'moved') this.loopTicks = 0;
    playing.options.onEnd?.(reason);
  }

  /** A blow outranks an action and any reaction that does not override blows. */
  private interruptScriptedForBlow(): void {
    this.endScripted('action', 'interrupted');
    if (this.reaction !== null && !this.reaction.overridesBlows) {
      this.endScripted('reaction', 'interrupted');
    }
  }

  /**
   * One tick of a playing action or reaction: cancelled by movement if it
   * asked to be, advanced a tick (unless it started this tick), its newly
   * drawn frames' callbacks run, and ended, looped or held at its last frame.
   */
  private tickScripted(layer: ScriptedLayer, moving: boolean): void {
    const playing = this.playing(layer);
    if (playing === null) return;
    if (moving && playing.cancelOnMove) {
      this.endScripted(layer, 'moved');
      return;
    }
    if (playing.fresh) playing.fresh = false;
    else playing.ticks++;
    if (playing.options.progress !== undefined) {
      this.tickPaced(layer, playing, playing.options.progress());
      return;
    }
    const length = rowLengthInTicks(playing.row);
    if (playing.options.loop === true && playing.ticks >= length) {
      playing.ticks %= length;
      playing.firedThrough = -1;
    }
    const drawn = rowFrameAtTicks(playing.row, playing.ticks);
    if (!this.runFrameEvents(layer, playing, drawn)) return;
    const oneShotDone = playing.options.loop !== true && playing.ticks >= length;
    if (oneShotDone && playing.options.holdLastFrame !== true) this.endScripted(layer, 'finished');
  }

  /** One tick of a row paced by `progress` rather than by the clock. */
  private tickPaced(layer: ScriptedLayer, playing: Scripted, progress: number): void {
    const share = Math.min(Math.max(progress, 0), 1);
    const drawn = Math.min(Math.floor(share * playing.row.frameCount), playing.row.frameCount - 1);
    playing.pacedFrame = Math.max(playing.pacedFrame ?? 0, drawn);
    if (!this.runFrameEvents(layer, playing, playing.pacedFrame)) return;
    if (share >= 1 && playing.options.holdLastFrame !== true) this.endScripted(layer, 'finished');
  }

  /**
   * Runs the `onFrame` callbacks of every frame newly drawn through `drawn`,
   * and reports whether `playing` is still the row playing in its layer. A
   * callback may start another action or stop this one; the row it replaced
   * is over, so neither its later callbacks nor its ending may then reach the
   * row that took its place.
   */
  private runFrameEvents(layer: ScriptedLayer, playing: Scripted, drawn: number): boolean {
    for (const event of playing.options.onFrame ?? []) {
      if (event.frame <= playing.firedThrough || event.frame > drawn) continue;
      event.run();
      if (this.playing(layer) !== playing) return false;
    }
    playing.firedThrough = Math.max(playing.firedThrough, drawn);
    return true;
  }

  // ── Strike choice ──────────────────────────────────────────────────────────

  /**
   * Context first, then the combo position, then no immediate repeat; what is
   * left is drawn from a seeded shuffle of the family, so a long fight works
   * through every blow the view has before it repeats an order.
   *
   * On the move only the blows painted on the move are thrown, and the same
   * rules choose between them: a knee-high target still draws the punt. A
   * context none of them suits leaves them all in play, so what is thrown is
   * still whichever the combo and the shuffle allow.
   */
  private chooseStrike(
    view: CarlView,
    family: readonly RowSpec[],
    target: StrikeTargetContext | null,
    striding: boolean,
  ): RowSpec {
    const downed = target?.downed ?? false;
    const throwable = striding ? preferWhere(family, hasTravellingVersions) : family;
    let candidates = downed ? throwable : preferWithoutTags(throwable, DOWNED_TARGET_TAGS);
    if (target !== null) {
      if (target.lowProfile || target.downed) candidates = preferTags(candidates, LOW_TARGET_TAGS);
      else if (target.tall) candidates = preferTags(candidates, TALL_TARGET_TAGS);
      if (target.reachShare >= FAR_REACH_SHARE) {
        candidates = preferTags(candidates, FAR_TARGET_TAGS);
      }
    }
    candidates = preferWhere(candidates, (row) => this.fitsComboSlot(row));
    candidates = preferWhere(
      candidates,
      (row) => !(row.strike?.tags.includes('finisher') ?? false) || this.comboStep > 0,
    );
    // After the combo rules, so a floor blow that is a finisher still waits
    // for its place in the chain.
    if (downed) candidates = preferTags(candidates, DOWNED_TARGET_TAGS);
    if (candidates.length > 1) {
      candidates = candidates.filter((row) => row.name !== this.lastStrike);
    }
    return this.drawFromBag(view, family, candidates);
  }

  private fitsComboSlot(row: RowSpec): boolean {
    const slots = row.strike?.comboSlots;
    return slots === undefined || slots.includes(this.comboStep);
  }

  private drawFromBag(
    view: CarlView,
    family: readonly RowSpec[],
    candidates: readonly RowSpec[],
  ): RowSpec {
    const allowed = new Set(candidates.map((row) => row.name));
    for (let attempt = 0; attempt < BAG_DRAW_ATTEMPTS; attempt++) {
      const bag = this.strikeBags.get(view) ?? [];
      const index = bag.findIndex((name) => allowed.has(name));
      if (index >= 0) {
        const [name] = bag.splice(index, 1);
        this.strikeBags.set(view, bag);
        const row = candidates.find((candidate) => candidate.name === name);
        if (row !== undefined) return row;
      }
      this.strikeBags.set(
        view,
        shuffled(
          family.map((row) => row.name),
          this.random,
        ),
      );
    }
    return candidates[0];
  }

  /** Ends any blow whose timer has run out, handing the legs back if it travelled. */
  private finishBlows(clock: HumanStrikeClock, moving: boolean): void {
    if (this.strike !== null && clock.attackTimer <= 0) {
      this.handBackLegs(this.strike.row, moving);
      this.strike = null;
      this.lastStrikeEndTick = this.tickCount;
      this.guardTicks = GUARD_HOLD_TICKS;
    }
    if (this.smush !== null && clock.smushTimer <= 0) {
      this.handBackLegs(this.smush.row, moving);
      this.smush = null;
      this.guardTicks = GUARD_HOLD_TICKS;
    }
  }

  private handBackLegs(row: RowSpec, moving: boolean): void {
    if (moving && row.exitFootPhase !== undefined) this.phase = row.exitFootPhase * TWO_PI;
  }

  /**
   * During a blow the base mode follows his feet, so the blow ends into
   * whatever he is doing by then: still running, straight into the stride with
   * no start; stood still, straight into standing with no stop. The start and
   * the stop bridge a standing figure and a stride, and a blow is neither.
   */
  private trackFeetUnderBlow(moving: boolean): void {
    this.oneShot = null;
    this.settleTo = null;
    this.settleExits = [];
    if (moving) {
      this.pendingCelebration = false;
      this.celebrationQueue = [];
      this.restartIdleClock();
      this.mode = 'cycle';
      return;
    }
    if (this.mode !== 'idle' && this.mode !== 'guard') {
      this.mode = this.restMode();
      this.loopTicks = 0;
    }
  }

  /**
   * Every strike's wind-up is warmed at scene start; once a fight is on, the
   * rest of this view's family, whole, and the guard it ends in — and the
   * flinch and the stumble up to the end of their recoil, which a fight can
   * call for on any tick. Asked again on every blow thrown or taken, which is
   * also what keeps them from being released as idle while the fight lasts.
   */
  private warmCombatRows(view: CarlView): void {
    const guard = firstInView(GUARD_ROWS, view);
    if (guard !== undefined) this.warmRow(guard.name);
    for (const row of inView(STRIKE_ROWS, view)) this.warmRow(row.name);
    for (const span of fightReactionSpans(view)) this.warmRow(span.row, span.frames);
  }

  /**
   * Every blow this view can throw on the move, up to its impact frame: warmed
   * as he sets off, so the first one thrown on the run does not bake on the
   * tick it lands. Only the view he is running in, so a floor's worth of
   * running does not hold every view's versions warm at once.
   */
  private warmTravellingBlows(view: CarlView): void {
    for (const row of inView(TRAVELLING_BLOWS, view)) {
      this.warmRow(row.name, strikeWindUpFrames(row));
    }
  }

  // ── Locomotion ─────────────────────────────────────────────────────────────

  /** No stride under way: setting off from here is setting off from standing. */
  private isStanding(): boolean {
    return this.mode !== 'cycle' && this.mode !== 'start' && this.mode !== 'settle';
  }

  /** Covering ground: a blow thrown now is thrown on the move. */
  private isStriding(): boolean {
    return this.mode === 'cycle' || this.mode === 'start';
  }

  private chooseGait(): void {
    if (this.gait === 'walk' && this.smoothedSpeed >= RUN_SPEED_ENTER_PX_PER_TICK) {
      this.gait = 'run';
    } else if (this.gait === 'run' && this.smoothedSpeed < RUN_SPEED_EXIT_PX_PER_TICK) {
      this.gait = 'walk';
    }
    const near = this.smoothedSpeed < RUN_SPEED_ENTER_PX_PER_TICK * (1 + WALK_PREWARM_HEADROOM);
    if (near && !this.nearWalk) this.warmWalk();
    this.nearWalk = near;
  }

  /** The walk and the start and stop that bridge it, in the view he is in. */
  private warmWalk(): void {
    const walk = CYCLE_ROWS.find((row) => row.gait === 'walk' && row.view === this.view);
    if (walk !== undefined) this.warmRow(walk.name);
    for (const bridges of [START_ROWS, STOP_ROWS]) {
      const bridge = bridgeFor(bridges, 'walk', this.view);
      if (bridge !== undefined) this.warmRow(bridge.name);
    }
  }

  /**
   * Adds, never scales: a wrapped phase multiplied by a non-integer skips
   * frames at the wrap. Never more than one frame of the drawn cycle a tick —
   * past that the row is undersampled, skipping poses, and reads as vibration.
   */
  private advancePhase(groundPx: number): void {
    const cycle = cycleRow(this.gait, this.view);
    const oneFrame = cycle === undefined ? TWO_PI : TWO_PI / cycle.frameCount;
    const advance = Math.min(groundPx * gaitRadiansPerPx(this.gait), oneFrame);
    this.phase = (this.phase + advance) % TWO_PI;
  }

  private tickMoving(groundPx: number): void {
    this.pendingCelebration = false;
    this.celebrationQueue = [];
    this.restartIdleClock();
    if (this.mode === 'settle') this.mode = 'cycle';
    if (this.mode !== 'cycle' && this.mode !== 'start') this.beginMoving();
    // The gait changed part-way into a start: that start bridges the other
    // gait, so the new gait's cycle takes over from its nearest-standing frame.
    if (this.mode === 'start' && this.oneShot?.bridges !== this.gait) {
      this.enterCycleFromStanding();
    }
    if (this.mode === 'start' && this.oneShot !== null) {
      this.advanceStart(this.oneShot, groundPx);
      return;
    }
    this.advancePhase(groundPx);
  }

  /** A start is paced by ground: one of its frames to each frame of its gait's ground covered. */
  private advanceStart(start: RowSpec, groundPx: number): void {
    const perFrame = groundPxPerFrame(start.name);
    this.oneShotFrames += perFrame > 0 ? groundPx / perFrame : 1;
    if (this.oneShotFrames < start.frameCount) return;
    // The start's last frame is the run's own pose at its exit phase; the
    // ground covered past it carries the stride on from there.
    const lastFrame = start.frameCount - 1;
    const pastLastFramePx = (this.oneShotFrames - lastFrame) * perFrame;
    const exitRadians = (start.exitFootPhase ?? 0) * TWO_PI;
    this.mode = 'cycle';
    this.oneShot = null;
    const gait = start.bridges ?? this.gait;
    this.phase = (exitRadians + pastLastFramePx * gaitRadiansPerPx(gait)) % TWO_PI;
  }

  private beginMoving(): void {
    this.warmTravellingBlows(this.view);
    const stopping = this.mode === 'stop' ? this.oneShot : null;
    // Caught on the first frame of a stop, the legs are still the run's own
    // at the stop's entry phase, and the stride carries on from there.
    if (stopping !== null && rowFrameAtTicks(stopping, this.oneShotTicks) === 0) {
      this.mode = 'cycle';
      this.oneShot = null;
      this.phase = this.framePhaseAt(stopping.entryFootPhase ?? 0);
      return;
    }
    if (this.mode === 'unstart' && this.oneShot !== null) {
      this.mode = 'start';
      return;
    }
    const start = bridgeFor(START_ROWS, this.gait, this.view);
    if (start !== undefined) {
      this.mode = 'start';
      this.oneShot = start;
      this.oneShotFrames = 0;
      return;
    }
    this.enterCycleFromStanding();
  }

  /** Into the cycle on the frame nearest standing, so setting off does not pop the legs. */
  private enterCycleFromStanding(): void {
    this.mode = 'cycle';
    this.oneShot = null;
    const cycle = cycleRow(this.gait, this.view);
    const standing = firstInView(IDLE_ROWS, this.view);
    if (cycle === undefined || standing === undefined) return;
    const [nearest] = framesNearestStanding(cycle, standing);
    this.phase = framePhase(nearest, cycle.frameCount);
  }

  /** The phase, in radians, in the middle of the current cycle's frame a cycle fraction falls in. */
  private framePhaseAt(fraction: number): number {
    const cycle = cycleRow(this.gait, this.view);
    if (cycle === undefined) return fraction * TWO_PI;
    const wrapped = wrapPhase(fraction);
    return framePhase(Math.floor(wrapped * cycle.frameCount), cycle.frameCount);
  }

  private tickStanding(): void {
    if (this.mode === 'cycle') this.beginStopping();
    if (this.mode === 'start') this.mode = 'unstart';

    if (this.mode === 'settle') {
      this.tickSettle();
      return;
    }
    if (this.mode === 'unstart') {
      // Played back to standing at one frame a tick, the fastest a row can go
      // without skipping a pose.
      this.oneShotFrames = Math.floor(this.oneShotFrames) - 1;
      if (this.oneShotFrames < 0) this.enterRest();
      return;
    }
    if (this.mode === 'stop' || this.mode === 'fidget' || this.mode === 'drop') {
      this.oneShotTicks++;
      if (this.oneShot === null || this.oneShotTicks >= rowLengthInTicks(this.oneShot)) {
        this.endOneShotToRest();
      }
      return;
    }

    // A level-up cuts into the guard a killing blow leaves him in: held for
    // the guard to drop, it would play seconds after the kill that earned it.
    // It waits for an action or reaction to finish rather than cutting it off.
    const scriptedPlaying = this.action !== null || this.reaction !== null;
    if (this.pendingCelebration && !scriptedPlaying) {
      this.pendingCelebration = false;
      if (this.playCelebration()) return;
    }
    const wanted = this.restMode();
    if (this.mode === 'guard' && wanted === 'idle') {
      if (this.tickGuardOut()) return;
    } else if (wanted !== this.mode) {
      this.enterRest();
    }
    if (this.mode === 'idle' && this.tickIdle()) return;
    this.loopTicks++;
  }

  /**
   * He has stopped moving; the legs have not. A gait with a stop row keeps its
   * stride turning until a frame the stop can begin from is on screen, then
   * plays the stop. Anything else — the walk, a view with no stop — turns on
   * to the frame nearest standing and stands. Either way the cut is made where
   * the legs already agree, never from wherever the stride happened to be.
   */
  private beginStopping(): void {
    const cycle = cycleRow(this.gait, this.view);
    if (cycle === undefined) {
      this.enterRest();
      return;
    }
    const stop = bridgeFor(STOP_ROWS, this.gait, this.view);
    const entry = stop?.entryFootPhase;
    if (stop !== undefined && entry !== undefined) {
      this.settleTo = stop;
      this.settleExits = cycleFrames(cycle).filter((frame) =>
        frameMeetsPhase(frame, cycle.frameCount, entry),
      );
    } else {
      this.settleTo = null;
      const standing = firstInView(IDLE_ROWS, this.view);
      this.settleExits = standing === undefined ? [] : framesNearestStanding(cycle, standing);
    }
    if (this.settleExits.length === 0) {
      this.enterRest();
      return;
    }
    // Held in the middle of the frame on screen, so each tick of the settle
    // steps exactly one frame on.
    const drawn = walkFrameIndex(this.phase, cycle.frameCount);
    this.phase = framePhase(drawn, cycle.frameCount);
    this.mode = 'settle';
  }

  /**
   * One frame a tick, the fastest the cycle can be played without skipping a
   * pose: every tick spent here is a stride turning over a sprite that has
   * stopped, so it is spent as quickly as the row allows.
   */
  private tickSettle(): void {
    const cycle = cycleRow(this.gait, this.view);
    if (cycle === undefined) {
      this.enterRest();
      return;
    }
    const drawn = walkFrameIndex(this.phase, cycle.frameCount);
    if (this.settleExits.includes(drawn)) {
      this.leaveSettle();
      return;
    }
    this.phase = (this.phase + TWO_PI / cycle.frameCount) % TWO_PI;
  }

  private leaveSettle(): void {
    const stop = this.settleTo;
    if (stop === null) {
      this.enterRest();
      return;
    }
    this.settleTo = null;
    this.settleExits = [];
    this.mode = 'stop';
    this.oneShot = stop;
    this.oneShotTicks = 0;
  }

  private endOneShotToRest(): void {
    if (this.mode === 'fidget' && this.oneShot !== null) this.lastFidget = this.oneShot.name;
    const next = this.celebrationQueue.shift();
    if (this.mode === 'fidget' && next !== undefined) {
      this.playFidget(next);
      return;
    }
    this.enterRest();
  }

  /**
   * The guard has run out. It is lowered from its own first frame, the pose
   * the drop starts from, so the bounce plays on to its seam first — under a
   * second — and a view with no drop row falls straight to the idle. True
   * while the guard is still on screen.
   */
  private tickGuardOut(): boolean {
    const atSeam = this.loopTicks % rowLengthInTicks(this.restRow()) === 0;
    const drop = firstInView(DROP_ROWS, this.view);
    if (drop === undefined) {
      this.enterRest();
      return false;
    }
    if (!atSeam) {
      this.loopTicks++;
      return true;
    }
    this.mode = 'drop';
    this.oneShot = drop;
    this.oneShotTicks = 0;
    return true;
  }

  private restMode(): 'guard' | 'idle' {
    return this.guardTicks > 0 ? 'guard' : 'idle';
  }

  /** Into the idle or the guard loop, from its first frame — the seam every fidget shares. */
  private enterRest(): void {
    this.mode = this.restMode();
    this.oneShot = null;
    this.loopTicks = 0;
    this.phase = 0;
    this.settleTo = null;
    this.settleExits = [];
  }

  private restRow(): RowSpec {
    const rows = this.mode === 'guard' ? GUARD_ROWS : IDLE_ROWS;
    const row = firstInView(rows, this.view) ?? firstInView(IDLE_ROWS, this.view) ?? IDLE_ROWS[0];
    return row;
  }

  /**
   * The facing turned him into another view. A one-shot painted in the old
   * view cannot carry on in the new one: a gesture or a stop gives way to
   * standing, a start to the stride. The fidget warmed for the old view is
   * for a view he is no longer in.
   */
  private changeView(view: CarlView): void {
    this.view = view;
    this.warmedFidget = null;
    if (this.nearWalk) this.warmWalk();
    if (this.isStriding()) this.warmTravellingBlows(view);
    const stale = this.oneShot !== null && this.oneShot.view !== view;
    if (!stale) return;
    if (this.mode === 'start') {
      this.enterCycleFromStanding();
      return;
    }
    this.celebrationQueue = [];
    this.enterRest();
  }

  // ── Idling ─────────────────────────────────────────────────────────────────

  /**
   * Starts the count toward the next fidget again. Only a count that had
   * started is rolled afresh: this runs every tick he is moving, and a roll a
   * tick would spend the seeded order the strikes are drawn from as well.
   */
  private restartIdleClock(): void {
    const started = this.idleTicks > 0 || this.warmedFidget !== null;
    this.idleTicks = 0;
    this.warmedFidget = null;
    if (started) this.fidgetDelay = this.rollFidgetDelay();
  }

  /** One tick of the relaxed idle; true when it handed over to a fidget. */
  private tickIdle(): boolean {
    const quiet = this.suppressTicks === 0 && this.action === null && this.reaction === null;
    const atSeam = this.loopTicks % rowLengthInTicks(this.restRow()) === 0;
    if (!quiet) {
      this.restartIdleClock();
      return false;
    }
    this.idleTicks++;
    if (
      this.warmedFidget === null &&
      this.idleTicks >= this.fidgetDelay - FIDGET_PREWARM_LEAD_TICKS
    ) {
      const next = this.peekFidget();
      if (next !== undefined) {
        this.warmRow(next.name);
        this.warmedFidget = next.name;
      }
    }
    if (this.idleTicks < this.fidgetDelay || !atSeam) return false;
    const fidget = this.takeFidget();
    this.idleTicks = 0;
    this.warmedFidget = null;
    this.fidgetDelay = this.rollFidgetDelay();
    if (fidget === undefined) return false;
    this.playFidget(fidget);
    return true;
  }

  private playFidget(row: RowSpec): void {
    this.mode = 'fidget';
    this.oneShot = row;
    this.oneShotTicks = 0;
  }

  /**
   * The fist clench, then the look at the ceiling, in the view he is standing
   * in. A view with neither plays nothing; one with only the second plays that.
   */
  private playCelebration(): boolean {
    const sequence = CELEBRATION_ROWS.filter((row) => row.view === this.view);
    const [first, ...rest] = sequence;
    if (sequence.length === 0) return false;
    this.celebrationQueue = rest;
    this.playFidget(first);
    return true;
  }

  private rollFidgetDelay(): number {
    return FIDGET_DELAY_MIN_TICKS + Math.floor(this.random() * FIDGET_DELAY_SPAN_TICKS);
  }

  /**
   * The fidgets of the current view in a seeded order, reshuffled each time the
   * order is used up and never starting a new order on the one just played.
   */
  private refillFidgetBag(): void {
    const names = inView(FIDGET_ROWS, this.view).map((row) => row.name);
    let order = shuffled(names, this.random);
    if (order.length > 1 && order[0] === this.lastFidget) order = [...order.slice(1), order[0]];
    this.fidgetBag = order;
  }

  private peekFidget(): RowSpec | undefined {
    const inCurrentView = (name: HumanRowName): boolean =>
      FIDGET_ROWS.some((row) => row.name === name && row.view === this.view);
    if (!this.fidgetBag.some(inCurrentView)) this.refillFidgetBag();
    const name = this.fidgetBag.find(inCurrentView);
    return FIDGET_ROWS.find((row) => row.name === name);
  }

  private takeFidget(): RowSpec | undefined {
    const next = this.peekFidget();
    if (next !== undefined) {
      this.fidgetBag = this.fidgetBag.filter((name) => name !== next.name);
    }
    return next;
  }
}

function cycleFrames(cycle: RowSpec): number[] {
  return Array.from({ length: cycle.frameCount }, (_unused, frame) => frame);
}

function latchOf(row: RowSpec, facingX: number, facingY: number): Latch {
  return { row, facingX, facingY, flipX: row.mirrorable && facingX < 0 };
}

/** Keeps only the rows carrying any of `tags`, unless none do. */
function preferTags(rows: readonly RowSpec[], tags: readonly StrikeTag[]): readonly RowSpec[] {
  return preferWhere(rows, (row) => carriesAny(row, tags));
}

/** Keeps only the rows carrying none of `tags`, unless every row does. */
function preferWithoutTags(
  rows: readonly RowSpec[],
  tags: readonly StrikeTag[],
): readonly RowSpec[] {
  return preferWhere(rows, (row) => !carriesAny(row, tags));
}

function carriesAny(row: RowSpec, tags: readonly StrikeTag[]): boolean {
  return row.strike?.tags.some((tag) => tags.includes(tag)) ?? false;
}

/** Keeps only the rows passing `test`, unless none do. */
function preferWhere(
  rows: readonly RowSpec[],
  test: (row: RowSpec) => boolean,
): readonly RowSpec[] {
  const kept = rows.filter(test);
  return kept.length > 0 ? kept : rows;
}

/** The frame a playing action or reaction draws: held frames, looped or clamped at the last. */
function scriptedFrame(playing: Scripted): HumanRowSelection {
  const frame = playing.pacedFrame ?? rowFrameAtTicks(playing.row, playing.ticks);
  return {
    row: playing.row.name,
    frame: Math.min(frame, playing.row.frameCount - 1),
    flipX: playing.flipX,
  };
}

/** A blow's frame, from how far its timer has run, in the facing it was latched to. */
function latchedFrame(latch: Latch, timer: number, total: number): HumanRowSelection {
  const progress = 1 - timer / total;
  return {
    row: latch.row.name,
    frame: progressFrameIndex(progress, latch.row.frameCount),
    flipX: latch.flipX,
  };
}
