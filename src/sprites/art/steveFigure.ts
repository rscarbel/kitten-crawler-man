/**
 * Steve Cartwright as painted figures: his choreography, his cell geometry, and
 * the two \`FigureDef\`s the runtime cache and the review harness draw through —
 * the otter himself and his crossbow bolt, in flight and stuck in the target.
 *
 * This module is choreography and nothing else: one pose function per row, the
 * row table, and where a pose sits in its cell. Anatomy, palette and every
 * stroke of paint live in \`steveArt.ts\`.
 *
 * Rows, each in three views (\`<row>\`, \`<row>_side\`, \`<row>_away\`):
 *    idle    a bouncy, sociable stance: two hops on his toes a cycle
 *    walk    a waddle-trot, the body rolling over each stance foot
 *    aim     the crossbow shouldered and levelled, held steady through his breathing
 *    shoot   the squeeze, the release and the kick, settling back onto the line empty
 *    reload  the crossbow lowered, the windlass cranked to draw the string, a
 *            bolt fetched from his belt and seated, and the crossbow back up on aim
 *
 * Aim, shoot and reload chain without a pop: shoot starts on the aim line and
 * settles back onto it, reload starts there and ends on the aim.
 *
 * The art invariants live in \`scripts/gates-steve.ts\`, which the review
 * harness runs: \`npm run render:steve\`.
 */

import {
  CROSSBOW_STOCK_BACK,
  REST_ARM_L,
  REST_ARM_R,
  REST_CROSSBOW,
  REST_TAIL_SWISH,
  THIGH,
  SHIN,
  LEG_SLACK,
  HIP_Y,
  ANKLE_Y,
  TWO_PI,
  type OtterArmPose,
  type OtterLegPose,
  type OtterPose,
  type OtterView,
  type V3,
  armReaching,
  belowWindlassAt,
  boltSeatAt,
  boltTipAt,
  crankHandleAt,
  crossbowPlacementOf,
  crossbowPointOnScreen,
  crossbowStoodAt,
  drawBolt,
  drawOtter,
  drawStuckBolt,
  foreStockAt,
  otterSkeleton,
  restPose,
} from './steveArt';
import { clamp01, deg, easeInOut, easeOut, hump, lerp } from './bipedArt';
import { type FigureDef, figureStates } from '../figure/figureDef';
import {
  STEVE_AIM_FRAMES,
  STEVE_BOLT_FRAMES,
  STEVE_IDLE_FRAMES,
  STEVE_RELOAD_FRAMES,
  STEVE_SHOOT_FRAMES,
  STEVE_SHOOT_RELEASE_FRAME,
  STEVE_SHOOT_RELEASE_PROGRESS,
  STEVE_WALK_FRAMES,
} from '../steveTiming';

// ── Cell geometry ────────────────────────────────────────────────────────────

/** Cell pixels per tile; the runtime scales by `tileSize / TILE_SCALE`. */
export const TILE_SCALE = 64;

/**
 * The otter's cell and where his tile sits in it. Wide enough for the
 * crossbow levelled at full reach and the tail trailing behind him; the ground
 * line is the tile's bottom edge, with a quarter tile below it for the tail and
 * the feet seen against the floor.
 */
const OTTER_FRAME_WIDTH = 160;
const OTTER_FRAME_HEIGHT = 112;
export const OTTER_TILE_X = 48;
export const OTTER_TILE_Y = 32;

/**
 * The share of his authored size he is drawn at. Scaled about the point between
 * his feet, so he stays standing on his tile: a shade over a tile tall, which
 * is how "short" reads next to the human crawler's two.
 */
const OTTER_BODY_SCALE = 0.88;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Loops sample the cycle evenly; one-shots sample the middle of each frame. */
export function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

export function shotProgress(frame: number, frameCount: number): number {
  return (frame + HALF) / frameCount;
}

const HALF = 0.5;

/** 0 before `start`, 1 after `end`, linear between. */
function window01(value: number, start: number, end: number): number {
  return clamp01((value - start) / (end - start));
}

function mod1(value: number): number {
  return ((value % 1) + 1) % 1;
}

function withArm(arm: OtterArmPose, extra: Partial<OtterArmPose>): OtterArmPose {
  return {
    swing: arm.swing + (extra.swing ?? 0),
    spread: arm.spread + (extra.spread ?? 0),
    bend: arm.bend + (extra.bend ?? 0),
  };
}

/** The leg's full reach, less the headroom the knee keeps. */
const LEG_REACH = THIGH + SHIN - LEG_SLACK;

// ── Walk ─────────────────────────────────────────────────────────────────────

/**
 * Share of the stride a foot is planted. Over half, so there is a moment of
 * double support every step: a walk, however quick the waddle.
 */
const WALK_STANCE_SHARE = 0.58;
/** How far ahead of the hip a foot lands. Short legs, short steps. */
export const WALK_REACH = 0.09;
const WALK_LIFT = 0.045;
/**
 * The reach the walking pelvis rides on: a little short of full so the knee is
 * never locked through stance, which is what keeps the trot springy.
 */
const WALK_LEG_SPAN = LEG_REACH * 0.95;
/** The extra drop onto each footfall — the trot's bounce. */
const WALK_LAND_DROP = 0.03;
/** The trot's lift over the planted foot between footfalls. */
const WALK_MID_RISE = 0.014;
const WALK_LAND_DECAY = 0.3;
/** The waddle: the body rolls over whichever foot is planted. */
const WALK_ROLL = deg(7);
const WALK_SWAY = 0.016;
const WALK_LEAN = deg(7);
const WALK_ARM_SWING_FREE = deg(26);
/** The crossbow arm barely swings; the weapon is carried, not flung about. */
const WALK_ARM_SWING_CARRY = deg(7);
const WALK_TAIL_WAG = 0.8;
/** Centred, so the wag shows past alternate hips rather than popping out on one side only. */
const WALK_TAIL_REST_SHARE = 0;

export function gaitFoot(phase: number): OtterLegPose {
  const cycle = mod1(phase);
  if (cycle < WALK_STANCE_SHARE) {
    // A planted foot slides back through the cell at a constant rate, which is
    // the body being carried forward over it.
    return { fore: lerp(WALK_REACH, -WALK_REACH, cycle / WALK_STANCE_SHARE), lift: 0 };
  }
  const swing = (cycle - WALK_STANCE_SHARE) / (1 - WALK_STANCE_SHARE);
  return { fore: lerp(-WALK_REACH, WALK_REACH, easeInOut(swing)), lift: hump(swing) * WALK_LIFT };
}

/**
 * Ground one walk cycle covers, in tiles. A planted foot slides back through
 * the stance at exactly the rate the body is carried over it, so this falls out
 * of the stride — twice the reach, over the share of the cycle a foot is down —
 * at the size he is drawn. The runtime advances the walk phase by ground
 * covered against it, which is what keeps the planted foot from skating.
 */
export const STEVE_TILES_PER_WALK_CYCLE = ((2 * WALK_REACH) / WALK_STANCE_SHARE) * OTTER_BODY_SCALE;

function landPulse(phase: number, at: number): number {
  // A bell rather than a step: the weight sinks into the landing over a
  // couple of frames instead of dropping all at once on the contact frame.
  const since = mod1(phase - at);
  return since < WALK_LAND_DECAY ? hump(since / WALK_LAND_DECAY) : 0;
}

/**
 * How far the pelvis has to drop for a planted foot to stay reachable: it
 * vaults over the stance leg, lowest at contact when the foot is furthest
 * ahead — which is what a real pelvis does, and why a stride never clamps.
 */
function stanceDrop(foot: OtterLegPose): number {
  if (foot.lift > 0) return 0;
  const standingHeight = Math.sqrt(Math.max(0, WALK_LEG_SPAN ** 2 - foot.fore ** 2));
  return Math.max(0, -HIP_Y + ANKLE_Y - standingHeight);
}

export function walkPose(phase: number): OtterPose {
  const legR = gaitFoot(phase);
  const legL = gaitFoot(phase + HALF);
  const land = Math.max(landPulse(phase, 0), landPulse(phase, HALF));
  // Right foot plants at phase 0, so its mid-stance is half the stance share later.
  const rollWave = Math.cos(TWO_PI * (phase - WALK_STANCE_SHARE * HALF));
  // Same-side arm furthest back at its own foot's contact.
  const armWave = Math.cos(TWO_PI * phase);
  const rest = restPose();
  return {
    ...rest,
    bob:
      Math.max(stanceDrop(legR), stanceDrop(legL)) +
      WALK_LAND_DROP * land -
      WALK_MID_RISE * (1 - land) * Math.abs(rollWave),
    sway: WALK_SWAY * rollWave,
    roll: WALK_ROLL * rollWave,
    lean: WALK_LEAN,
    headTilt: -WALK_ROLL * rollWave * HALF,
    headPitch: deg(3) * land,
    armR: withArm(REST_ARM_R, { swing: -WALK_ARM_SWING_CARRY * armWave }),
    armL: withArm(REST_ARM_L, { swing: WALK_ARM_SWING_FREE * armWave }),
    legR,
    legL,
    // The tail counterweights the waddle, swinging across behind him each step.
    tailSwish: REST_TAIL_SWISH * WALK_TAIL_REST_SHARE - WALK_TAIL_WAG * rollWave,
    tailLift: 0.02 * land,
    mouthOpen: 0.12,
  };
}

// ── Idle ─────────────────────────────────────────────────────────────────────

/** The hop onto his toes. Two per cycle; bounded by the leg's reach at full stretch. */
const IDLE_BOUNCE = 0.014;
const IDLE_HOPS_PER_CYCLE = 2;
/**
 * The dip into the knees between hops. The rise is capped by the leg's reach,
 * so most of the bounce is this sink, which is free.
 */
const IDLE_DIP = 0.03;
const IDLE_HEAD_TILT = deg(9);
const IDLE_TAIL_WAG = 0.28;
/** The frame the eyes are shut on; the frames either side are half-lidded. */
const IDLE_BLINK_PHASE = 0.75;
const IDLE_BLINK_HALF_WIDTH = 1.5 / STEVE_IDLE_FRAMES;

function idlePose(phase: number): OtterPose {
  const angle = phase * TWO_PI;
  const hop = Math.abs(Math.sin((angle * IDLE_HOPS_PER_CYCLE) / 2));
  const settle = (1 - hop) ** 2;
  const rest = restPose();
  const blinkDistance = Math.abs(phase - IDLE_BLINK_PHASE);
  return {
    ...rest,
    bob: -IDLE_BOUNCE * hop + IDLE_DIP * settle,
    headTilt: IDLE_HEAD_TILT * Math.sin(angle),
    headPitch: deg(-3) * hop,
    lean: deg(2) * Math.sin(angle),
    armL: withArm(REST_ARM_L, { swing: deg(6) * hop, spread: deg(4) * hop }),
    armR: withArm(REST_ARM_R, { swing: deg(3) * hop }),
    tailSwish: REST_TAIL_SWISH + IDLE_TAIL_WAG * Math.sin(angle + 1),
    tailLift: 0.03 * hop,
    blink:
      blinkDistance < IDLE_BLINK_HALF_WIDTH
        ? hump(HALF * (1 - blinkDistance / IDLE_BLINK_HALF_WIDTH))
        : 0,
    mouthOpen: 0.12,
  };
}

// ── Aim ──────────────────────────────────────────────────────────────────────

/** Squared up on the target, braced with the left foot forward. */
const AIM_LEAN = deg(8);
const AIM_LEAD_FOOT = 0.035;
const AIM_BACK_FOOT = -0.025;
/** Chin down onto the stock, cheek toward it. */
const AIM_HEAD_PITCH = deg(7);
const AIM_HEAD_TILT = deg(-7);
/**
 * Turned a hair outward, so head-on the stock shows as a short stub behind a
 * prod squared across his chest rather than vanishing into his paw.
 */
const AIM_YAW = deg(5);
/** The butt beds into the pocket of the shoulder, at the joint's own depth, under the cheek. */
const AIM_BUTT_CLEARANCE = -0.01;
const AIM_GRIP_DROP = -0.05;
/** The butt beds on the inside of the shoulder, under the cheek, not out on its point. */
const AIM_GRIP_INWARD = 0.15;
/** Starting angles for the paws' reach: elbows down and out, as a shouldered crossbow holds them. */
const AIM_SEED_R: OtterArmPose = { swing: deg(15), spread: deg(30), bend: deg(110) };
const SUPPORT_SEED_L: OtterArmPose = { swing: deg(45), spread: deg(-10), bend: deg(70) };
/** Breathing while he holds the aim: small enough that the bolt's point stays on the target. */
const AIM_BREATH_BOB = 0.005;
const AIM_BREATH_LEAN = deg(0.6);
const AIM_TAIL_SWAY = 0.08;
const QUARTER_TURN = deg(90);

function aimBase(breath: number): OtterPose {
  const rest = restPose();
  return {
    ...rest,
    bob: AIM_BREATH_BOB * breath,
    lean: AIM_LEAN + AIM_BREATH_LEAN * breath,
    headPitch: AIM_HEAD_PITCH,
    headTilt: AIM_HEAD_TILT,
    legL: { fore: AIM_LEAD_FOOT, lift: 0 },
    legR: { fore: AIM_BACK_FOOT, lift: 0 },
    tailSwish: REST_TAIL_SWISH + AIM_TAIL_SWAY * breath,
  };
}

/** The trigger paw on the grip, the stock levelled out of the shoulder along the line of fire. */
function shoulderCrossbow(base: OtterPose): OtterPose {
  const shoulder = otterSkeleton(base).armR.shoulder;
  const line: V3 = { x: Math.sin(AIM_YAW), y: 0, z: Math.cos(AIM_YAW) };
  const reach = CROSSBOW_STOCK_BACK + AIM_BUTT_CLEARANCE;
  const grip: V3 = {
    x: shoulder.x - AIM_GRIP_INWARD + line.x * reach,
    y: shoulder.y + AIM_GRIP_DROP,
    z: shoulder.z + line.z * reach,
  };
  const armR = armReaching(base, 'R', grip, AIM_SEED_R);
  const held = { ...base, armR };
  const level = QUARTER_TURN - otterSkeleton(held).armR.forearmSwing;
  return { ...held, crossbow: { ...REST_CROSSBOW, pitch: level, yaw: AIM_YAW } };
}

/** The left paw closed on a point, solved after everything it holds has been placed. */
function leftPawTo(pose: OtterPose, target: V3): OtterPose {
  return { ...pose, armL: armReaching(pose, 'L', target, SUPPORT_SEED_L) };
}

function steadied(pose: OtterPose): OtterPose {
  return leftPawTo(pose, foreStockAt(pose, otterSkeleton(pose)));
}

function aimPose(phase: number): OtterPose {
  return steadied(shoulderCrossbow(aimBase(Math.sin(phase * TWO_PI))));
}

// ── Shoot ────────────────────────────────────────────────────────────────────

/** The kick starts the frame after the release: the bolt is away before the crossbow jumps. */
const SHOOT_KICK_START = 0.33;
const SHOOT_KICK_PEAK = 0.45;
const SHOOT_KICK_END = 0.85;
const SHOOT_KICK_PITCH = deg(12);
const SHOOT_KICK_SWING = deg(8);
const SHOOT_KICK_LEAN = deg(-9);
const SHOOT_KICK_HEAD = deg(-12);
/** Head-on and from behind the kick shows as the shoulders and head jolting sideways. */
const SHOOT_KICK_ROLL = deg(5);
const SHOOT_KICK_HEAD_TILT = deg(9);
/** From behind the kick shows as his shoulders jolting up: the knees take the shove. */
const SHOOT_KICK_RISE = 0.025;

function kickAt(progress: number): number {
  if (progress < SHOOT_KICK_PEAK)
    return easeOut(window01(progress, SHOOT_KICK_START, SHOOT_KICK_PEAK));
  return 1 - easeInOut(window01(progress, SHOOT_KICK_PEAK, SHOOT_KICK_END));
}

export function shootPose(progress: number): OtterPose {
  const released = progress >= STEVE_SHOOT_RELEASE_PROGRESS;
  const kick = kickAt(progress);
  const base = aimBase(0);
  const shouldered = shoulderCrossbow({
    ...base,
    bob: base.bob - SHOOT_KICK_RISE * kick,
    lean: base.lean + SHOOT_KICK_LEAN * kick,
    roll: SHOOT_KICK_ROLL * kick,
    headPitch: base.headPitch + SHOOT_KICK_HEAD * kick,
    headTilt: base.headTilt + SHOOT_KICK_HEAD_TILT * kick,
  });
  const kicked: OtterPose = {
    ...shouldered,
    armR: { ...shouldered.armR, swing: shouldered.armR.swing + SHOOT_KICK_SWING * kick },
    crossbow: {
      ...shouldered.crossbow,
      pitch: shouldered.crossbow.pitch + SHOOT_KICK_PITCH * kick - SHOOT_KICK_SWING * kick,
      loaded: !released,
      cocked: released ? 0 : 1,
    },
    mouthOpen: released ? kick : 0,
  };
  return steadied(kicked);
}

// ── Reload ───────────────────────────────────────────────────────────────────

/** Held on the aim line long enough that the first frame is the shot's last. */
const RELOAD_LOWER_START = 0.04;
const RELOAD_PLANTED = 0.27;
/** The left foot steps up into the stirrup as the crossbow comes down onto it. */
const RELOAD_STEP_ON_START = 0.12;
const RELOAD_STEP_ON_END = 0.28;
const RELOAD_TO_CRANK_END = 0.31;
const RELOAD_CRANK_END = 0.63;
const RELOAD_TO_BELT_END = 0.68;
const RELOAD_STEP_OFF_START = 0.64;
const RELOAD_STEP_OFF_END = 0.76;
const RELOAD_SEAT_AT = 0.84;
const RELOAD_RAISE_START = 0.72;
/** Back on the aim line before the last frame, so it hands to the aim without a pop. */
const RELOAD_RAISE_END = 0.95;
const RELOAD_TO_STOCK_END = 0.92;
/** Turns of the crank to wind the string back to the latch. */
const CRANK_TURNS = 2;
/**
 * The crossbow stood on its stirrup in front of his left foot, leaning a touch
 * away from him so the windlass at the top clears his chest.
 */
const STIRRUP_ON_FLOOR: V3 = { x: -0.075, y: 0, z: 0.17 };
const STOOD_TILT = deg(-4);
/** How high the foot in the stirrup rides off the floor: the stirrup's own thickness. */
const STIRRUP_STEP_LIFT = 0.02;
/** How high the foot lifts on its way into and out of the stirrup. */
const STIRRUP_STEP_ARC = 0.05;
/** Bent over the work, his weight down into his knees. */
const WINDING_LEAN = deg(18);
const WINDING_BOB = 0.035;
const WINDING_HEAD_PITCH = deg(20);
/** His shoulders and head work with each turn of the crank, which is what shows the cranking from behind. */
const CRANK_BODY_ROLL = deg(4);
const CRANK_HEAD_NOD = deg(5);
/** He bends further over the bow on each pull of the crank. */
const CRANK_LEAN_PUMP = deg(4);
/** The right paw steadies the stock just below the windlass while the left one turns it. */
const STEADY_SHARE_BELOW_WINDLASS = 0.04;
const WINDING_SEED_R: OtterArmPose = { swing: deg(40), spread: deg(10), bend: deg(70) };
/** Where he keeps his bolts: tucked in the waistband of his trunks on his left, toward the front. */
const BELT_POUCH: V3 = { x: -0.13, y: -0.02, z: 0.09 };

function blend3(a: V3, b: V3, t: number): V3 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

export function reloadPose(progress: number): OtterPose {
  const ease = (start: number, end: number): number => easeInOut(window01(progress, start, end));
  const plant =
    ease(RELOAD_LOWER_START, RELOAD_PLANTED) * (1 - ease(RELOAD_RAISE_START, RELOAD_RAISE_END));
  const footOn =
    ease(RELOAD_STEP_ON_START, RELOAD_STEP_ON_END) *
    (1 - ease(RELOAD_STEP_OFF_START, RELOAD_STEP_OFF_END));
  const footArc =
    hump(window01(progress, RELOAD_STEP_ON_START, RELOAD_STEP_ON_END)) +
    hump(window01(progress, RELOAD_STEP_OFF_START, RELOAD_STEP_OFF_END));
  const winding = window01(progress, RELOAD_TO_CRANK_END, RELOAD_CRANK_END);
  const seated = progress >= RELOAD_SEAT_AT;
  const crankWork = Math.sin(winding * CRANK_TURNS * TWO_PI);
  const crankPull = HALF * (1 - Math.cos(winding * CRANK_TURNS * TWO_PI));

  const aimBody = aimBase(0);
  const aimed = shoulderCrossbow(aimBody);
  const aimedAt = crossbowPlacementOf(aimed, otterSkeleton(aimed));
  const stood = crossbowStoodAt(STIRRUP_ON_FLOOR, STOOD_TILT);
  const body: OtterPose = {
    ...aimBody,
    bob: lerp(aimBody.bob, WINDING_BOB, plant),
    lean: lerp(aimBody.lean, WINDING_LEAN, plant) + CRANK_LEAN_PUMP * crankPull,
    roll: CRANK_BODY_ROLL * crankWork,
    headPitch: lerp(aimBody.headPitch, WINDING_HEAD_PITCH, plant) + CRANK_HEAD_NOD * crankWork,
    headTilt: lerp(aimBody.headTilt, 0, plant),
    legL: {
      fore: lerp(aimBody.legL.fore, STIRRUP_ON_FLOOR.z, footOn),
      lift: STIRRUP_STEP_LIFT * footOn + STIRRUP_STEP_ARC * footArc,
    },
    crossbow: {
      ...aimed.crossbow,
      placed: {
        grip: blend3(aimedAt.grip, stood.grip, plant),
        aim: blend3(aimedAt.aim, stood.aim, plant),
      },
      loaded: seated,
      cocked: winding,
      crank: winding * CRANK_TURNS * TWO_PI,
      boltInLeftPaw: progress >= RELOAD_TO_BELT_END && !seated,
    },
  };
  const skeleton = otterSkeleton(body);
  const grip = crossbowPlacementOf(body, skeleton).grip;
  const steadyPoint = belowWindlassAt(body, skeleton, STEADY_SHARE_BELOW_WINDLASS);
  const toWinding =
    ease(RELOAD_PLANTED, RELOAD_TO_CRANK_END) * (1 - ease(RELOAD_CRANK_END, RELOAD_TO_BELT_END));
  const rightTarget = blend3(grip, steadyPoint, toWinding);
  const armed: OtterPose = {
    ...body,
    armR: armReaching(body, 'R', rightTarget, plant > 0 ? WINDING_SEED_R : aimed.armR),
  };

  const held = otterSkeleton(armed);
  const stock = foreStockAt(armed, held);
  const crank = crankHandleAt(armed, held);
  const belt: V3 = {
    x: held.pelvis.x + BELT_POUCH.x,
    y: held.pelvis.y + BELT_POUCH.y,
    z: held.pelvis.z + BELT_POUCH.z,
  };
  const seat = boltSeatAt(armed, held);
  let target: V3;
  if (progress < RELOAD_PLANTED) target = stock;
  else if (progress < RELOAD_TO_CRANK_END)
    target = blend3(stock, crank, ease(RELOAD_PLANTED, RELOAD_TO_CRANK_END));
  else if (progress < RELOAD_CRANK_END) target = crank;
  else if (progress < RELOAD_TO_BELT_END)
    target = blend3(crank, belt, ease(RELOAD_CRANK_END, RELOAD_TO_BELT_END));
  else if (progress < RELOAD_SEAT_AT)
    target = blend3(belt, seat, ease(RELOAD_TO_BELT_END, RELOAD_SEAT_AT));
  else target = blend3(seat, stock, ease(RELOAD_SEAT_AT, RELOAD_TO_STOCK_END));
  return leftPawTo(armed, target);
}

// ── Row table ────────────────────────────────────────────────────────────────

export type SteveRow = 'idle' | 'walk' | 'aim' | 'shoot' | 'reload';
export type RowKind = 'loop' | 'oneShot';

interface SteveRowBase {
  readonly frameCount: number;
  readonly pose: (t: number) => OtterPose;
}

/** How a row is sampled; only the shot has a release frame, so only its spec carries one. */
type SteveRowSpec =
  | (SteveRowBase & { readonly kind: 'loop' })
  | (SteveRowBase & { readonly kind: 'oneShot'; readonly releaseFrame: number | null });

export const STEVE_ROWS = {
  idle: { frameCount: STEVE_IDLE_FRAMES, kind: 'loop', pose: idlePose },
  walk: { frameCount: STEVE_WALK_FRAMES, kind: 'loop', pose: walkPose },
  aim: { frameCount: STEVE_AIM_FRAMES, kind: 'loop', pose: aimPose },
  shoot: {
    frameCount: STEVE_SHOOT_FRAMES,
    kind: 'oneShot',
    releaseFrame: STEVE_SHOOT_RELEASE_FRAME,
    pose: shootPose,
  },
  reload: {
    frameCount: STEVE_RELOAD_FRAMES,
    kind: 'oneShot',
    releaseFrame: null,
    pose: reloadPose,
  },
} as const satisfies Record<SteveRow, SteveRowSpec>;

function isSteveRow(name: string): name is SteveRow {
  return name in STEVE_ROWS;
}

/** His rows by name, in the table's order. */
export const STEVE_ROW_NAMES: readonly SteveRow[] = Object.keys(STEVE_ROWS).filter(isSteveRow);

export const STEVE_VIEWS: readonly OtterView[] = ['front', 'side', 'away'];

/** The state name a row is painted under in a view. */
export function steveStateName(row: SteveRow, view: OtterView): string {
  if (view === 'side') return `${row}_side`;
  if (view === 'away') return `${row}_away`;
  return row;
}

interface ResolvedState {
  readonly spec: SteveRowSpec;
  readonly view: OtterView;
}

const STATE_TABLE: ReadonlyMap<string, ResolvedState> = new Map(
  STEVE_ROW_NAMES.flatMap((row) =>
    STEVE_VIEWS.map((view): [string, ResolvedState] => [
      steveStateName(row, view),
      { spec: STEVE_ROWS[row], view },
    ]),
  ),
);

/** The pose a state's frame is painted from, for the painter and the gates alike. */
export function stevePoseAt(state: string, frame: number): OtterPose | null {
  const spec = STATE_TABLE.get(state)?.spec;
  if (spec === undefined) return null;
  const t =
    spec.kind === 'loop'
      ? cyclePhase(frame, spec.frameCount)
      : shotProgress(frame, spec.frameCount);
  return spec.pose(t);
}

/** The view a state is painted in, or null for a state the figure does not declare. */
function steveViewOf(state: string): OtterView | null {
  return STATE_TABLE.get(state)?.view ?? null;
}

/** Paints a pose into a cell-sized context the way every one of his cells is painted. */
export function paintStevePose(
  ctx: CanvasRenderingContext2D,
  view: OtterView,
  pose: OtterPose,
): void {
  ctx.save();
  try {
    ctx.translate(OTTER_FRAME_WIDTH / 2, OTTER_TILE_Y + TILE_SCALE);
    ctx.scale(TILE_SCALE * OTTER_BODY_SCALE, TILE_SCALE * OTTER_BODY_SCALE);
    drawOtter(ctx, view, pose);
  } finally {
    ctx.restore();
  }
}

function paintOtterFrame(ctx: CanvasRenderingContext2D, state: string, frame: number): void {
  const view = steveViewOf(state);
  const pose = stevePoseAt(state, frame);
  if (view === null || pose === null) return;
  paintStevePose(ctx, view, pose);
}

function otterStateFrames(): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const [name, { spec }] of STATE_TABLE) frames[name] = spec.frameCount;
  return frames;
}

/**
 * The otter composes himself on a scratch surface at whatever density he is
 * painted at and outlines the finished silhouette one pixel wide, so a
 * supersampled bake would only smear that outline — hence `skipSupersample`.
 */
export const STEVE_FIGURE: FigureDef = {
  id: 'steve',
  frameWidth: OTTER_FRAME_WIDTH,
  frameHeight: OTTER_FRAME_HEIGHT,
  tileX: OTTER_TILE_X,
  tileY: OTTER_TILE_Y,
  tileScale: TILE_SCALE,
  states: figureStates(otterStateFrames()),
  paintFrame: paintOtterFrame,
  skipSupersample: true,
};

// ── The muzzle ───────────────────────────────────────────────────────────────

/**
 * Where a loaded bolt's point is painted on the shoot row's release frame, in
 * cell pixels, unmirrored. The release frame is still on the aim line — the
 * kick follows it — so this is where the loosed bolt starts its flight.
 */
export function steveMuzzleInCell(view: OtterView): { readonly x: number; readonly y: number } {
  const pose = shootPose(shotProgress(STEVE_SHOOT_RELEASE_FRAME, STEVE_SHOOT_FRAMES));
  const skeleton = otterSkeleton(pose);
  const onScreen = crossbowPointOnScreen(view, skeleton, boltTipAt(pose, skeleton));
  const unit = TILE_SCALE * OTTER_BODY_SCALE;
  return {
    x: OTTER_FRAME_WIDTH / 2 + onScreen.x * unit,
    y: OTTER_TILE_Y + TILE_SCALE + onScreen.y * unit,
  };
}

// ── The bolt ─────────────────────────────────────────────────────────────────

/**
 * The bolt is its own figure, painted pointing along +X and rotated by the
 * runtime to its heading. A flying bolt is anchored on its point, so the
 * position a caller passes is where it hits; a stuck one on the point where it
 * went into the wood — the same point the flying bolt's tip reached — so the
 * swap from one to the other does not jump.
 */
export const BOLT_FLY_STATE = 'fly';
export const BOLT_STUCK_STATE = 'stuck';

const BOLT_FRAME_WIDTH = 48;
const BOLT_FRAME_HEIGHT = 16;
/** The anchor sits near the cell's front edge: the shaft and the streak trail behind it. */
const BOLT_ANCHOR_X = 40;
/** The bolt's authored length, point to nock, in tiles. */
const BOLT_LENGTH_TILES = 0.4;
/** How much of the point a stuck bolt has buried in the wood, in tiles. */
export const BOLT_BURIED_TILES = 0.09;

export const STEVE_BOLT_FIGURE: FigureDef = {
  id: 'steve_bolt',
  frameWidth: BOLT_FRAME_WIDTH,
  frameHeight: BOLT_FRAME_HEIGHT,
  tileX: BOLT_ANCHOR_X,
  tileY: BOLT_FRAME_HEIGHT / 2,
  tileScale: TILE_SCALE,
  states: figureStates({ [BOLT_FLY_STATE]: STEVE_BOLT_FRAMES, [BOLT_STUCK_STATE]: 1 }),
  paintFrame: (ctx, state, frame) => {
    const flying = state === BOLT_FLY_STATE;
    if (!flying && state !== BOLT_STUCK_STATE) return;
    ctx.save();
    try {
      ctx.translate(BOLT_ANCHOR_X, BOLT_FRAME_HEIGHT / 2);
      ctx.scale(TILE_SCALE, TILE_SCALE);
      if (flying) drawBolt(ctx, BOLT_LENGTH_TILES, cyclePhase(frame, STEVE_BOLT_FRAMES));
      else drawStuckBolt(ctx, BOLT_LENGTH_TILES, BOLT_BURIED_TILES);
    } finally {
      ctx.restore();
    }
  },
};
