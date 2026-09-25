/**
 * The Raised Ratkin as painted figures: the rows, the cell, and one
 * `FigureDef` per look (`raised_ratkin_smock`, `_jack`, `_shroud`).
 *
 * The rig and the gait are Mordecai's, edited: a dead ratkin walks on the same
 * legs, badly. What makes it read as dead rather than as a villager having a
 * bad day is structural, and every row carries it:
 *
 * - **The hunch.** The spine pitched well forward and the knees bent, so the
 *   head hangs out in front of the chest at shoulder height.
 * - **The dragging foot.** The far foot never lifts: it is hauled along the
 *   ground on its knuckles through its whole swing, so the gait lurches, one
 *   good step and one drag.
 * - **The arms.** Hanging forward and loose, claws open, swinging late behind
 *   the body's lurch like dead weight.
 *
 * Rows:
 *    shamble / shamble_side / shamble_away   16 frames
 *    idle / idle_side / idle_away             8 frames
 *    claw / claw_side / claw_away             8 frames, `eventFrames.impact`
 *    rise                                    16 frames, head-on, out of the ground
 *    hurt / hurt_side / hurt_away             4 frames
 *    death                                   12 frames, head-on, the last held
 *
 * The art invariants live in `scripts/gates-raised-ratkin.ts`:
 * `npm run render:raised-ratkin`.
 */

import { clamp01, deg, easeInOut, easeOut, lerp } from './carlArt';
import {
  GROUND_Y,
  toeContactHeight,
  type ArmAngles,
  type FootPose,
  type RatKinPose,
  type RatKinView,
  drawRatkin,
} from './ratKinArt';
import {
  GROUND_OFFSET_IN_TILE,
  RAT_KIN_SCALE,
  cyclePhase,
  idleFacing,
  idleSide,
  pulseAt,
  walkFacing,
  walkSide,
  wave,
} from './ratKinFigure';
import { RATKIN_BUILDS } from './ratkin/outfit';
import {
  RAISED_OUTFITS,
  RAISED_RATKIN_LOOKS,
  drawBonePile,
  drawGraveBreach,
  type RaisedRatkinLook,
} from './raisedRatkinArt';
import { type FigureDef, figureStates } from '../figure/figureDef';
import { RAT_KIN_TILES_PER_WALK_CYCLE } from '../ratKinSprite';
import { SKELETON_RISE_FRAMES } from '../skeletonTiming';

type Ctx = CanvasRenderingContext2D;

// ── Cell geometry ────────────────────────────────────────────────────────────

/** Tile size the art is drawn at; the runtime scales by tileSize / TILE_SCALE. */
export const RAISED_RATKIN_TILE_SCALE = 64;

/** The cast's cell, so a raised ratkin and a villager on one tile share a ground line. */
const FRAME_WIDTH = 128;
const FRAME_HEIGHT = 128;
const TILE_X = (FRAME_WIDTH - RAISED_RATKIN_TILE_SCALE) / 2;
const GROUND_MARGIN = 13.4;
export const RAISED_ORIGIN_X = FRAME_WIDTH / 2;
export const RAISED_ORIGIN_Y = FRAME_HEIGHT - GROUND_MARGIN;
const TILE_Y = Math.round(RAISED_ORIGIN_Y - RAISED_RATKIN_TILE_SCALE * GROUND_OFFSET_IN_TILE);

export const SHAMBLE_FRAMES = 16;
export const IDLE_FRAMES = 8;
export const CLAW_FRAMES = 8;
export const RISE_FRAMES = 16;
export const HURT_FRAMES = 4;
export const DEATH_FRAMES = 12;

/** The claw's frame of contact: the swipe at the bottom of its arc. */
export const CLAW_IMPACT_FRAME = 4;

const TAU = Math.PI * 2;
/** The middle of a frame, for one-shots sampled there. */
const MIDFRAME = 0.5;

// ── The dead carriage ────────────────────────────────────────────────────────

/** How far the spine pitches forward past a living ratkin's, and how far the knees give. */
const HUNCH_LEAN = deg(34);
const HUNCH_CROUCH = 0.4;
/** The head hangs forward off the hunched shoulders, nose down. */
const HUNCH_HEAD_REACH = 0.05;
const HUNCH_HEAD_PITCH = deg(16);
const FACING_EXTRA_HUNCH = deg(22);
const FACING_HEAD_COCK = deg(20);
/** How much of a head-on knee's bend is left showing: bowed, not straight. */
const FACING_KNEE_GIVE = 0.35;
/** The jaw hangs slack. */
const SLACK_JAW = 0.4;
/** Ears laid back and limp. */
const LIMP_EARS = deg(34);
/** A dead tail drags rather than curling up off the ground. */
const DEAD_TAIL_CURL = deg(-40);
const DEAD_TAIL_DROP = deg(34);
/** Open claws, not a relaxed curl. */
const OPEN_CLAWS = 0.08;

function hunch(pose: RatKinPose, view: RatKinView): void {
  pose.lean += HUNCH_LEAN;
  pose.crouch += HUNCH_CROUCH;
  if (view === 'side') {
    // Edge-on the tail drags low along the ground behind it instead of curling
    // up off the floor. Head-on the rig sweeps the tail out past one hip, and
    // re-aiming it there throws it up behind the shoulder.
    pose.tail = { ...pose.tail, base: pose.tail.base + DEAD_TAIL_DROP, curl: DEAD_TAIL_CURL };
    pose.headReach += HUNCH_HEAD_REACH;
    pose.headPitch += HUNCH_HEAD_PITCH;
  } else {
    // Head-on a lean only shows as the spine getting shorter, so it is pushed
    // much further: the head sinks down between the shoulders, and the head
    // hangs cocked to one side — a living villager holds it level.
    pose.lean += FACING_EXTRA_HUNCH;
    pose.headRoll = FACING_HEAD_COCK;
    // The knees give outward, where a living ratkin's legs stand as columns.
    pose.nearFoot = { ...pose.nearFoot, foreshorten: FACING_KNEE_GIVE };
    pose.farFoot = { ...pose.farFoot, foreshorten: FACING_KNEE_GIVE };
  }
  pose.sniff = Math.max(pose.sniff, SLACK_JAW);
  pose.earNear = LIMP_EARS;
  pose.earFar = LIMP_EARS;
  pose.blink = 0;
  pose.nearPaw = OPEN_CLAWS;
  pose.farPaw = OPEN_CLAWS;
}

/**
 * Dead arms, as joint angles: hanging forward of the body, the elbow barely
 * bent, swinging as a pendulum that lags the body by `lag` of a cycle.
 */
const DEAD_ARM_UPPER = deg(26);
const DEAD_ARM_FORE = deg(34);
const DEAD_ARM_SWING = deg(9);
/**
 * Head-on, dead arms hang long and straight down to the knees. A living ratkin
 * carries its paws folded up in front of the belly; hanging limp is the tell.
 */
const FACING_DEAD_UPPER = deg(7);
const FACING_DEAD_FORE = deg(1);
const FACING_DEAD_FORE_SCALE = 1;
/** One arm hangs further forward than the other; a symmetric pair is a marionette. */
const REACHING_ARM_EXTRA = deg(12);
/** Head-on, the share of the reaching arm's extra swing that straightens its forearm. */
const FACING_REACH_FORE_SHARE = 0.4;
/** Head-on, the reaching forearm foreshortens as it swings toward the viewer. */
const FACING_REACH_FORE_SHORTEN = 0.1;

function deadArm(view: RatKinView, side: number, swing: number, reaching: boolean): ArmAngles {
  const extra = reaching ? REACHING_ARM_EXTRA : 0;
  if (view === 'side') {
    const upper = DEAD_ARM_UPPER + extra + swing * DEAD_ARM_SWING;
    return { upper, fore: DEAD_ARM_FORE + extra * 0.5, foreScale: 1 };
  }
  return {
    upper: side * (FACING_DEAD_UPPER + swing * DEAD_ARM_SWING * 0.5),
    fore: side * (FACING_DEAD_FORE - extra * FACING_REACH_FORE_SHARE),
    foreScale: FACING_DEAD_FORE_SCALE - (reaching ? FACING_REACH_FORE_SHORTEN : 0),
  };
}

// ── Shamble ──────────────────────────────────────────────────────────────────

/**
 * The dragging foot: rolled over onto its knuckles with the toes curled under,
 * the ball held just clear so the curled toes are what touch the floor.
 */
const DRAG_ROLL = deg(58);
const DRAG_PITCH = deg(62);
/** Toes half curled under: dragged on the knuckles. */
const DRAG_CURL = 0.45;
/** Head-on the drag shows as a foot that never rises and toes that trail. */
const FACING_DRAG_PITCH = deg(20);

function draggedFoot(foot: FootPose, view: RatKinView): FootPose {
  const dragged: FootPose = {
    ...foot,
    ball: { x: foot.ball.x, y: GROUND_Y },
    pitch: view === 'side' ? DRAG_PITCH : FACING_DRAG_PITCH,
    toeRoll: view === 'side' ? DRAG_ROLL : 0,
    toeCurl: DRAG_CURL,
    nearness: 0,
  };
  // Lifted by exactly what keeps the knuckled toes on the floor, so the foot
  // scrapes along it rather than floating clear or sinking through.
  return { ...dragged, ball: { x: foot.ball.x, y: GROUND_Y - toeContactHeight(dragged) } };
}

/** The far foot's contact is half a cycle after the near foot's; before it, it swings. */
const FAR_SWING_ENDS = 0.5;
/** The heavy drop onto the good foot, and the stumble forward off the drag. */
const LURCH_DROP = 0.05;
const LURCH_WIDTH = 0.2;
const LURCH_LEAN = deg(5);
/** Head-on the lurch is a lean toward the dragging side, carried by the head. */
const LURCH_ROLL = deg(9);
/** How far behind the body's lurch the dead arms swing, in cycles. */
const ARM_LAG = 0.18;
/** The far arm, not reaching, swings less than the near one; equal swings read as a march. */
const FAR_ARM_SWING_SHARE = 0.6;

export function shamblePose(view: RatKinView, phase: number): RatKinPose {
  const pose = view === 'side' ? walkSide(phase) : walkFacing(phase, view === 'away');
  hunch(pose, view);
  const cycle = ((phase % 1) + 1) % 1;
  if (cycle < FAR_SWING_ENDS) pose.farFoot = draggedFoot(pose.farFoot, view);
  // All the weight comes down on the good foot at its contact; the drag half
  // of the cycle carries none of the walk's own second drop.
  const onGoodFoot = pulseAt(phase, 0, LURCH_WIDTH);
  pose.bob = pose.bob * 0.5 + onGoodFoot * LURCH_DROP;
  pose.lean += wave(phase) * LURCH_LEAN;
  const swing = wave(phase - ARM_LAG);
  pose.nearArmAngles = deadArm(view, 1, swing, true);
  pose.farArmAngles = deadArm(view, -1, -swing * FAR_ARM_SWING_SHARE, false);
  if (view !== 'side') {
    pose.headRoll = (pose.headRoll ?? 0) + wave(phase) * LURCH_ROLL;
  }
  return pose;
}

// ── Idle ─────────────────────────────────────────────────────────────────────

/** Standing, the dead sway on their feet and the head lolls. */
const IDLE_SWAY_LEAN = deg(4);
const IDLE_LOLL = deg(11);
const IDLE_JAW_WORK = 0.25;
/** The jaw works twice per sway, so it never lines up with the body's rhythm. */
const IDLE_JAW_WORKS_PER_CYCLE = 2;
const IDLE_NEAR_ARM_SWING = 0.6;
const IDLE_FAR_ARM_SWING = 0.4;
/** The loll runs a quarter cycle behind the sway, like a weight on a loose neck. */
const IDLE_LOLL_LAG = 0.25;

export function idlePose(view: RatKinView, phase: number): RatKinPose {
  const pose = view === 'side' ? idleSide(phase) : idleFacing(phase, view === 'away');
  hunch(pose, view);
  const sway = wave(phase);
  pose.lean += sway * IDLE_SWAY_LEAN;
  pose.sniff = SLACK_JAW + Math.max(0, wave(phase * IDLE_JAW_WORKS_PER_CYCLE)) * IDLE_JAW_WORK;
  pose.nearArmAngles = deadArm(view, 1, wave(phase - ARM_LAG) * IDLE_NEAR_ARM_SWING, true);
  pose.farArmAngles = deadArm(view, -1, -wave(phase - ARM_LAG) * IDLE_FAR_ARM_SWING, false);
  if (view === 'side') pose.headPitch += wave(phase + IDLE_LOLL_LAG) * IDLE_LOLL * 0.5;
  else pose.headRoll = (pose.headRoll ?? 0) + wave(phase + IDLE_LOLL_LAG) * IDLE_LOLL;
  return pose;
}

// ── Claw ─────────────────────────────────────────────────────────────────────

/** The raised claw at the top of the wind-up, and the arm at the bottom of the swipe. */
const CLAW_UP_UPPER = deg(150);
const CLAW_UP_FORE = deg(175);
const CLAW_DOWN_UPPER = deg(82);
const CLAW_DOWN_FORE = deg(96);
const FACING_CLAW_UP_UPPER = deg(120);
const FACING_CLAW_UP_FORE = deg(150);
const FACING_CLAW_DOWN_UPPER = deg(-26);
const FACING_CLAW_DOWN_FORE = deg(-95);
/** He rears back into the wind-up and lunges into the swipe. */
const CLAW_REAR = deg(12);
const CLAW_LUNGE = deg(14);
const CLAW_LUNGE_REACH = 0.05;
/** The share of the row the swipe takes, ending on the impact frame: a fast snap. */
const CLAW_SWIPE_SPAN = 0.14;

/** 0 at rest, 1 at the top of the wind-up; then the swipe; then the settle. */
function clawBeats(frame: number): { up: number; down: number; settle: number } {
  // Sampled at the middle of each frame, so the row neither starts nor ends
  // on the bare idle pose: the first frame is already rearing back and the
  // last is still settling.
  const t = (frame + MIDFRAME) / CLAW_FRAMES;
  const impact = (CLAW_IMPACT_FRAME + MIDFRAME) / CLAW_FRAMES;
  const up = easeInOut(clamp01(t / (impact - CLAW_SWIPE_SPAN)));
  const down = easeOut(clamp01((t - (impact - CLAW_SWIPE_SPAN)) / CLAW_SWIPE_SPAN));
  const settle = easeInOut(clamp01((t - impact) / (1 - impact)));
  return { up, down, settle };
}

export function clawPose(view: RatKinView, frame: number): RatKinPose {
  const pose = idlePose(view, 0);
  const { up, down, settle } = clawBeats(frame);
  const raised = up * (1 - down);
  const swiped = down * (1 - settle);
  const rest = deadArm(view, 1, 0, true);
  const side = view === 'side';
  const upUpper = side ? CLAW_UP_UPPER : FACING_CLAW_UP_UPPER;
  const upFore = side ? CLAW_UP_FORE : FACING_CLAW_UP_FORE;
  const downUpper = side ? CLAW_DOWN_UPPER : FACING_CLAW_DOWN_UPPER;
  const downFore = side ? CLAW_DOWN_FORE : FACING_CLAW_DOWN_FORE;
  const upperMag = lerp(lerp(Math.abs(rest.upper), upUpper, raised), downUpper, swiped);
  const foreMag = lerp(lerp(Math.abs(rest.fore), upFore, raised), downFore, swiped);
  pose.nearArmAngles = side
    ? { upper: upperMag, fore: foreMag, foreScale: 1 }
    : { upper: upperMag, fore: foreMag, foreScale: lerp(rest.foreScale, 1, raised) };
  pose.nearPaw = OPEN_CLAWS;
  pose.lean += -raised * CLAW_REAR + swiped * CLAW_LUNGE;
  if (side) pose.headReach += swiped * CLAW_LUNGE_REACH;
  pose.sniff = SLACK_JAW + raised * 0.5;
  // Reaching over its own head from behind, the claw is behind the back.
  if (view === 'away') pose.nearArmBehind = raised < 0.5;
  return pose;
}

// ── Rise ─────────────────────────────────────────────────────────────────────

/** How deep below the ground the body starts, in figure units — deeper than it is tall. */
const RISE_DEPTH = 1.9;
/** When the claws break the surface, and when it is standing. */
const RISE_BREAK = 0.08;
const RISE_STAND = 0.9;
const RISE_REACH_UPPER = deg(158);
const RISE_REACH_FORE = deg(168);
const RISE_ARMS_DROP_FROM = 0.6;
const RISE_ARMS_DROP_SPAN = 0.25;
const RISE_FOLD = deg(150);
/** The reaching claws scrabble at the air, fading out as it stands. */
const RISE_CLAW_BEATS_PER_ROW = 2;
const RISE_CLAW_BEAT = deg(10);
/** The knees start deeply bent and straighten over the row. */
const RISE_START_CROUCH = 0.4;
/** The head wobbles as it climbs, on a rhythm out of step with the claws. */
const RISE_HEAD_ROLL_CYCLES = 1.5;
const RISE_HEAD_ROLL = deg(8);
/** How far below the ground line the rise's clip lets the body show, over the hole's lip. */
const RISE_GROUND_LIP = 0.02;
/** The rise's clip box, in figure units: wide and tall enough for the reaching claws. */
const RISE_CLIP = { left: -2, top: -3, width: 4, height: 3 } as const;
/** The earth is already cracking on the first frame and broken wide open by this share of the row. */
const RISE_BREACH_START = 0.25;
const RISE_BREACH_OPEN = 0.4;
const RISE_BREACH_CLOSE = 0.75;

/** How far below the ground the whole body is, 0 standing, for the frame. */
function riseSink(frame: number): number {
  const t = frame / (RISE_FRAMES - 1);
  return 1 - easeOut(clamp01((t - RISE_BREAK) / (RISE_STAND - RISE_BREAK)));
}

export function risePose(frame: number): RatKinPose {
  const pose = idlePose('front', 0);
  const t = frame / (RISE_FRAMES - 1);
  // Claws up first, reaching; they come down to the dead hang as it climbs out.
  // The arms come down fast once it is out, folding at the elbow on the way so
  // they drop in front of the chest rather than sweeping out through a T.
  const reach = 1 - easeInOut(clamp01((t - RISE_ARMS_DROP_FROM) / RISE_ARMS_DROP_SPAN));
  const fold = Math.sin(clamp01((t - RISE_ARMS_DROP_FROM) / RISE_ARMS_DROP_SPAN) * Math.PI);
  const clawBeat = Math.sin(t * TAU * RISE_CLAW_BEATS_PER_ROW) * (1 - t) * RISE_CLAW_BEAT;
  for (const [slot, side] of [
    ['near', 1],
    ['far', -1],
  ] as const) {
    const rest = deadArm('front', side, 0, slot === 'near');
    const angles: ArmAngles = {
      upper: lerp(rest.upper, side * RISE_REACH_UPPER, reach) + clawBeat * side,
      fore: lerp(rest.fore, side * RISE_REACH_FORE, reach) - side * fold * RISE_FOLD,
      foreScale: lerp(rest.foreScale, 1, reach),
    };
    if (slot === 'near') pose.nearArmAngles = angles;
    else pose.farArmAngles = angles;
  }
  pose.crouch += (1 - t) * RISE_START_CROUCH;
  pose.headRoll = Math.sin(t * TAU * RISE_HEAD_ROLL_CYCLES) * RISE_HEAD_ROLL;
  return pose;
}

// ── Hurt ─────────────────────────────────────────────────────────────────────

/** Struck on 0, furthest back on 1, sagging back into the hunch after. */
const HURT_RECOIL: readonly number[] = [0.75, 1, 0.5, 0.15];
const HURT_LEAN = deg(-22);
const HURT_HEAD = deg(-18);
const HURT_ARM_FLING = deg(26);
/** The blow lifts the body a little off its bent knees. */
const HURT_LIFT = 0.03;
/** Head-on, the head snaps sideways less than it snaps back edge-on. */
const HURT_FACING_HEAD_SHARE = 0.6;
const HURT_JAW_GAPE = 0.4;

export function hurtPose(view: RatKinView, frame: number): RatKinPose {
  const pose = idlePose(view, 0);
  const recoil = HURT_RECOIL[frame] ?? 0;
  pose.lean += recoil * HURT_LEAN;
  pose.bob -= recoil * HURT_LIFT;
  if (view === 'side') pose.headPitch += recoil * HURT_HEAD;
  else pose.headRoll = recoil * HURT_HEAD * HURT_FACING_HEAD_SHARE;
  const fling = recoil * HURT_ARM_FLING;
  const near = pose.nearArmAngles;
  const far = pose.farArmAngles;
  if (near !== null)
    pose.nearArmAngles = { ...near, upper: near.upper + (view === 'side' ? -fling : fling) };
  if (far !== null)
    pose.farArmAngles = { ...far, upper: far.upper - (view === 'side' ? fling : fling) };
  pose.sniff = SLACK_JAW + recoil * HURT_JAW_GAPE;
  return pose;
}

// ── Death ────────────────────────────────────────────────────────────────────

/** How the collapse runs: the knees go, then the body folds into the heap. */
const DEATH_BUCKLE_END = 0.45;
const DEATH_HEAP_FROM = 0.3;
const DEATH_SETTLED_AT = 0.75;
/** How low the folding body is squashed before the heap covers it. */
const DEATH_SQUASH = 0.88;
/** The squashed body spreads sideways as it flattens, so it reads as slumping, not shrinking. */
const DEATH_SPREAD = 0.2;
/** As the knees go, the body drops and the head flops over. */
const DEATH_BUCKLE_CROUCH = 0.8;
const DEATH_BUCKLE_DROP = 0.15;
const DEATH_BUCKLE_HEAD_ROLL = deg(25);

export function deathPose(frame: number): RatKinPose {
  const pose = idlePose('front', 0);
  const t = frame / (DEATH_FRAMES - 1);
  const buckle = easeInOut(clamp01(t / DEATH_BUCKLE_END));
  pose.crouch += buckle * DEATH_BUCKLE_CROUCH;
  pose.bob += buckle * DEATH_BUCKLE_DROP;
  pose.headRoll = buckle * DEATH_BUCKLE_HEAD_ROLL;
  pose.nearArmAngles = deadArm('front', 1, -buckle, false);
  pose.farArmAngles = deadArm('front', -1, buckle, false);
  return pose;
}

function deathProgress(frame: number): { squash: number; heap: number } {
  const t = frame / (DEATH_FRAMES - 1);
  return {
    squash: easeInOut(
      clamp01((t - DEATH_HEAP_FROM * 0.5) / (DEATH_SETTLED_AT - DEATH_HEAP_FROM * 0.5)),
    ),
    heap: clamp01((t - DEATH_HEAP_FROM) / (DEATH_SETTLED_AT - DEATH_HEAP_FROM)),
  };
}

// ── Row table ────────────────────────────────────────────────────────────────

export type RaisedRatkinAction = 'shamble' | 'idle' | 'claw' | 'rise' | 'hurt' | 'death';

export type RaisedRowEvent = 'impact';

export interface RaisedRowSpec {
  readonly name: string;
  readonly action: RaisedRatkinAction;
  readonly view: RatKinView;
  readonly frameCount: number;
  readonly loops: boolean;
  readonly eventFrames?: Readonly<Partial<Record<RaisedRowEvent, number>>>;
  readonly pose: (frame: number) => RatKinPose;
}

const VIEW_SUFFIX: Readonly<Record<RatKinView, string>> = {
  front: '',
  side: '_side',
  away: '_away',
};

export function raisedStateName(action: RaisedRatkinAction, view: RatKinView): string {
  return `${action}${VIEW_SUFFIX[view]}`;
}

const ALL_VIEWS: readonly RatKinView[] = ['front', 'side', 'away'];
const FRONT_ONLY: readonly RatKinView[] = ['front'];

/** The views each action is painted in. The rise and the death are unaimed. */
export const RAISED_ACTION_VIEWS: Readonly<Record<RaisedRatkinAction, readonly RatKinView[]>> = {
  shamble: ALL_VIEWS,
  idle: ALL_VIEWS,
  claw: ALL_VIEWS,
  hurt: ALL_VIEWS,
  rise: FRONT_ONLY,
  death: FRONT_ONLY,
};

/**
 * Ground one shamble cycle covers, in tiles. The good foot is Mordecai's, planted
 * and stepping the same stride, so the distance is his walk's at this build's
 * scale; the dragged foot slides that same distance along the ground.
 */
export const RAISED_RATKIN_TILES_PER_SHAMBLE_CYCLE =
  RAT_KIN_TILES_PER_WALK_CYCLE * RATKIN_BUILDS[RAISED_OUTFITS.smock.build].scale;

/**
 * Game ticks each frame of a row is held for. The shamble is paced by ground
 * covered instead ({@link RAISED_RATKIN_TILES_PER_SHAMBLE_CYCLE}); its entry is
 * the rate at the creature's own slow walk, for the preview.
 *
 * The rise is not held at a rate of its own: it is played across the whole of
 * `SKELETON_RISE_FRAMES`, the rising window a raised creature is immune for,
 * so the last frame — standing, the earth closed — lands as the window ends.
 * Drive it with {@link raisedRiseFrame}; its entry here is that window over
 * the row's frames, which is fractional.
 */
export const RAISED_TICKS_PER_FRAME: Readonly<Record<RaisedRatkinAction, number>> = {
  shamble: 4,
  idle: 7,
  claw: 5,
  rise: SKELETON_RISE_FRAMES / RISE_FRAMES,
  hurt: 4,
  death: 5,
};

/** The rise frame for a number of ticks into the rising window. */
export function raisedRiseFrame(ticksRising: number): number {
  const progress = Math.max(0, Math.min(1, ticksRising / SKELETON_RISE_FRAMES));
  return Math.min(RISE_FRAMES - 1, Math.floor(progress * RISE_FRAMES));
}

function rowsFor(
  action: RaisedRatkinAction,
  frameCount: number,
  loops: boolean,
  pose: (view: RatKinView, frame: number) => RatKinPose,
  eventFrames?: Readonly<Partial<Record<RaisedRowEvent, number>>>,
): RaisedRowSpec[] {
  return RAISED_ACTION_VIEWS[action].map((view) => ({
    name: raisedStateName(action, view),
    action,
    view,
    frameCount,
    loops,
    eventFrames,
    pose: (frame) => pose(view, frame),
  }));
}

export const RAISED_ROWS: readonly RaisedRowSpec[] = [
  ...rowsFor('shamble', SHAMBLE_FRAMES, true, (v, f) =>
    shamblePose(v, cyclePhase(f, SHAMBLE_FRAMES)),
  ),
  ...rowsFor('idle', IDLE_FRAMES, true, (v, f) => idlePose(v, cyclePhase(f, IDLE_FRAMES))),
  ...rowsFor('claw', CLAW_FRAMES, false, clawPose, { impact: CLAW_IMPACT_FRAME }),
  ...rowsFor('rise', RISE_FRAMES, false, (_v, f) => risePose(f)),
  ...rowsFor('hurt', HURT_FRAMES, false, hurtPose),
  ...rowsFor('death', DEATH_FRAMES, false, (_v, f) => deathPose(f)),
];

export function raisedRow(state: string): RaisedRowSpec | undefined {
  return RAISED_ROWS.find((row) => row.name === state);
}

// ── Painting ─────────────────────────────────────────────────────────────────

const FIGURE_SCALE = RAT_KIN_SCALE;

/**
 * Paints one cell. The rise clips the figure at the ground line and sinks it
 * through, with the broken earth under it; the death squashes the folding body
 * down into the heap of cloth and bones that covers it.
 */
function painterFor(look: RaisedRatkinLook) {
  const outfit = RAISED_OUTFITS[look];
  const scale = FIGURE_SCALE * RATKIN_BUILDS[outfit.build].scale;
  return (ctx: Ctx, state: string, frame: number): void => {
    const row = raisedRow(state);
    if (row === undefined) return;
    const pose = row.pose(frame);
    ctx.save();
    ctx.translate(RAISED_ORIGIN_X, RAISED_ORIGIN_Y);
    ctx.scale(RAISED_RATKIN_TILE_SCALE * scale, RAISED_RATKIN_TILE_SCALE * scale);
    if (row.action === 'rise') {
      const sink = riseSink(frame);
      const t = frame / (RISE_FRAMES - 1);
      // The earth opens under it and falls back in once it is out, so the
      // last frame hands over to the idle without a hole popping away.
      const opening = clamp01(t / RISE_BREACH_OPEN);
      const closing = clamp01((t - RISE_BREACH_CLOSE) / (1 - RISE_BREACH_CLOSE));
      drawGraveBreach(ctx, (RISE_BREACH_START + (1 - RISE_BREACH_START) * opening) * (1 - closing));
      ctx.save();
      ctx.beginPath();
      ctx.rect(RISE_CLIP.left, RISE_CLIP.top, RISE_CLIP.width, RISE_CLIP.height + RISE_GROUND_LIP);
      ctx.clip();
      ctx.translate(0, sink * RISE_DEPTH);
      drawRatkin(ctx, row.view, pose, outfit);
      ctx.restore();
    } else if (row.action === 'death') {
      const { squash, heap } = deathProgress(frame);
      ctx.save();
      ctx.scale(1 + squash * DEATH_SPREAD, 1 - squash * DEATH_SQUASH);
      if (squash < 1) drawRatkin(ctx, row.view, pose, outfit);
      ctx.restore();
      if (heap > 0) drawBonePile(ctx, look, heap);
    } else {
      drawRatkin(ctx, row.view, pose, outfit);
    }
    ctx.restore();
  };
}

function raisedFigureOf(look: RaisedRatkinLook): FigureDef {
  const frames: Record<string, number> = {};
  for (const row of RAISED_ROWS) frames[row.name] = row.frameCount;
  return {
    id: `raised_ratkin_${look}`,
    frameWidth: FRAME_WIDTH,
    frameHeight: FRAME_HEIGHT,
    tileX: TILE_X,
    tileY: TILE_Y,
    tileScale: RAISED_RATKIN_TILE_SCALE,
    states: figureStates(frames),
    paintFrame: painterFor(look),
  };
}

/** One figure per look: a look is baked into its cells, never read off a creature. */
export const RAISED_RATKIN_FIGURES: ReadonlyMap<RaisedRatkinLook, FigureDef> = new Map(
  RAISED_RATKIN_LOOKS.map((look) => [look, raisedFigureOf(look)]),
);

export function raisedRatkinFigure(look: RaisedRatkinLook): FigureDef {
  const figure = RAISED_RATKIN_FIGURES.get(look);
  if (figure === undefined) throw new Error(`no raised ratkin figure for "${look}"`);
  return figure;
}
