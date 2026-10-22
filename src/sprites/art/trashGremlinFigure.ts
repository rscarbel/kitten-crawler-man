/**
 * The Trash Gremlin as a painted figure: the choreography, the cell geometry,
 * and the `FigureDef` the runtime cache and the review harness both draw
 * through.
 *
 * This module is choreography and nothing else — one pose function per row, the
 * row table with what the runtime needs to know about each row, and the
 * placement of a pose or a gore piece inside its cell. Anatomy, palette and
 * paint live under `trashGremlinArt.ts`, and the pieces it comes apart into in
 * `trashGremlinGore.ts`.
 *
 * It lives in a crouch: hunched over its pot belly with its knuckles near the
 * floor, its head pushed forward under the bin lid on its back. It only stands
 * to its full height to summon, which is what makes the summon read.
 *
 * The art invariants live in `scripts/gates-trash-gremlin.ts`, which the review
 * harness runs: `npm run render:trash-gremlin`.
 */

import { clamp01, easeInOut, hump, lerp } from './carlArt';
import {
  type GremlinPose,
  type GremlinView,
  type V3,
  type ViewOptions,
  EAR_REST_LIFT,
  buildSkeleton,
  drawTrashGremlinView,
  restingPose,
  v3,
} from './trashGremlinArt';
import { type GorePiece, trashGremlinGorePieces } from './trashGremlinGore';
import { type FigureDef, figureStates } from '../figure/figureDef';
import { BYTES_PER_MEGABYTE } from '../../core/canvasSurface';

// ── Cell geometry ────────────────────────────────────────────────────────────

/** Art tile size; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;
/** Where the floor sits inside the tile, matching the other dungeon mobs. */
export const GROUND_OFFSET_PX = 58;

/**
 * The cell every pose and every gore piece is painted into, and where the
 * gremlin's own tile sits inside it: its widest reach (the ears head-on, the
 * spray and the tail edge-on) and its full summoning height, plus padding. The
 * gates fail any pose that paints against an edge, which is what would say a
 * pose has outgrown it.
 */
const FRAME_WIDTH = 256;
const FRAME_HEIGHT = 240;
const TILE_X = 70;
const TILE_Y = 142;

const POSE_ORIGIN_X = TILE_X + TILE_SCALE / 2;
const POSE_ORIGIN_Y = TILE_Y + GROUND_OFFSET_PX;

/**
 * Figure units to tiles. Applied here rather than to the proportions, so
 * retuning its size never silently redraws the choreography.
 */
export const GREMLIN_SCALE = 1.08;

/** Cell pixels per figure unit: the scale every pose and gore piece is painted at. */
export const FIGURE_UNIT_PX = TILE_SCALE * GREMLIN_SCALE;

// ── Row lengths and event frames ─────────────────────────────────────────────

export const IDLE_FRAMES = 8;
export const SCURRY_FRAMES = 12;
export const VOMIT_FRAMES = 12;
export const SUMMON_FRAMES = 12;

/**
 * The frame the bolus leaves its mouth on. The creature fires the projectile at
 * the progress this frame is showing, so the acid appears the instant the jaw
 * is at full gape.
 */
export const VOMIT_RELEASE_FRAME = 7;

/**
 * The peak of the shriek: head thrown furthest back, mouth widest. The room's
 * piles start to rustle on this frame, so cause and effect read together.
 */
export const SUMMON_EVENT_FRAME = 8;

/** Phase of a looping row, 0 at the start and never reaching 1. */
function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

/**
 * Progress through a one-shot row at the middle of a frame: where the row is
 * sampled, and where the runtime fires a row's event so it lands while that
 * frame is on screen.
 */
export function shotProgress(frame: number, frameCount: number): number {
  return (frame + 0.5) / frameCount;
}

const TURN = Math.PI * 2;

/** Eased (easeInOut) interpolation between (t, value) keys, clamped at both ends. */
function keyed(t: number, keys: readonly (readonly [number, number])[]): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      return lerp(v0, v1, easeInOut((t - t0) / (t1 - t0)));
    }
  }
  return keys[keys.length - 1][1];
}

function mixV3(a: V3, b: V3, t: number): V3 {
  return v3(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t));
}

/** A bell centred on `at` in cycle phase, 1 at its centre and 0 past `width`. */
function bellAt(phase: number, at: number, width: number): number {
  const distance = Math.abs(((phase - at + 1.5) % 1) - 0.5);
  return distance > width ? 0 : hump(0.5 * (1 - distance / width));
}

// ── The crouch every row starts from ─────────────────────────────────────────

const CROUCH_HUNCH = 0.72;
const CROUCH_BOB = 0.2;
const CROUCH_NECK = 0.2;
const CROUCH_HEAD = -0.22;
const CROUCH_FOOT_SPREAD = 0.27;
const CROUCH_FOOT_STAGGER = 0.06;
const CROUCH_HAND_SPREAD = 0.46;
const CROUCH_HAND_Y = -0.55;
const CROUCH_HAND_LEAD = 0.22;
const CROUCH_FIST = 0.8;
/** The trailing foot sits back by half as much as the leading one leads. */
const TRAILING_FOOT_SHARE = 0.5;

function crouch(): GremlinPose {
  const pose = restingPose();
  pose.hunch = CROUCH_HUNCH;
  pose.bob = CROUCH_BOB;
  pose.neckPitch = CROUCH_NECK;
  pose.headPitch = CROUCH_HEAD;
  pose.leftFoot = v3(-CROUCH_FOOT_SPREAD, 0, CROUCH_FOOT_STAGGER);
  pose.rightFoot = v3(CROUCH_FOOT_SPREAD, 0, -CROUCH_FOOT_STAGGER * TRAILING_FOOT_SHARE);
  pose.leftHand = v3(-CROUCH_HAND_SPREAD, CROUCH_HAND_Y, CROUCH_HAND_LEAD);
  pose.rightHand = v3(CROUCH_HAND_SPREAD, CROUCH_HAND_Y, CROUCH_HAND_LEAD);
  pose.leftFist = CROUCH_FIST;
  pose.rightFist = CROUCH_FIST;
  return pose;
}

// ── Idle ─────────────────────────────────────────────────────────────────────

const IDLE_BREATH_HUNCH = 0.035;
const IDLE_WEIGHT_SHIFT = 0.03;
/** A weight shift and a breath are independent, so they sit a quarter turn apart. */
const WEIGHT_SHIFT_QUARTER_TURN = 0.25;
const IDLE_SAC_PULSE = 0.12;
const IDLE_SAC_BASE = 0.1;
const IDLE_GLOW_BASE = 0.3;
const IDLE_GLOW_PULSE = 0.2;
const IDLE_SAC_LAG = 0.4;
/** Each ear twitches on its own beat, never both at once. */
const LEFT_TWITCH_AT = 0.27;
const RIGHT_TWITCH_AT = 0.65;
const TWITCH_WIDTH = 0.13;
const TWITCH_LIFT = 0.38;
const TWITCH_FOLD = 0.2;
const IDLE_BLINK_AT = 0.875;
const BLINK_WIDTH = 0.1;
const IDLE_TAIL_SWING = 0.18;
const IDLE_TAIL_CURL = 0.5;
const IDLE_TAIL_CURL_SWING = 0.25;
const IDLE_TAIL_LAG = 0.15;
const IDLE_HAND_DRIFT = 0.025;
const IDLE_CAN_SWING = 0.15;

function idle(phase: number): GremlinPose {
  const pose = crouch();
  const breath = 0.5 + 0.5 * Math.sin(phase * TURN);
  const shift = Math.sin((phase + WEIGHT_SHIFT_QUARTER_TURN) * TURN);
  pose.breath = breath;
  pose.hunch -= breath * IDLE_BREATH_HUNCH;
  pose.sway = shift * IDLE_WEIGHT_SHIFT;
  const pulse = 0.5 + 0.5 * Math.sin((phase - IDLE_SAC_LAG) * TURN);
  pose.sac = IDLE_SAC_BASE + pulse * IDLE_SAC_PULSE;
  pose.sacGlow = IDLE_GLOW_BASE + pulse * IDLE_GLOW_PULSE;
  const leftTwitch = bellAt(phase, LEFT_TWITCH_AT, TWITCH_WIDTH);
  const rightTwitch = bellAt(phase, RIGHT_TWITCH_AT, TWITCH_WIDTH);
  pose.leftEar = { lift: EAR_REST_LIFT + leftTwitch * TWITCH_LIFT, fold: leftTwitch * TWITCH_FOLD };
  pose.rightEar = {
    lift: EAR_REST_LIFT + rightTwitch * TWITCH_LIFT,
    fold: rightTwitch * TWITCH_FOLD,
  };
  pose.blink = bellAt(phase, IDLE_BLINK_AT, BLINK_WIDTH);
  pose.tailSwing = Math.sin(phase * TURN) * IDLE_TAIL_SWING;
  pose.tailCurl = IDLE_TAIL_CURL + Math.sin((phase - IDLE_TAIL_LAG) * TURN) * IDLE_TAIL_CURL_SWING;
  pose.leftHand = v3(
    pose.leftHand.x + shift * IDLE_HAND_DRIFT,
    pose.leftHand.y - breath * IDLE_HAND_DRIFT,
    pose.leftHand.z,
  );
  pose.rightHand = v3(
    pose.rightHand.x + shift * IDLE_HAND_DRIFT,
    pose.rightHand.y - breath * IDLE_HAND_DRIFT,
    pose.rightHand.z,
  );
  pose.canSwing = -shift * IDLE_CAN_SWING;
  return pose;
}

// ── Scurry ───────────────────────────────────────────────────────────────────

/**
 * Half of one foot's travel under the body during stance, in tiles. Bounded by
 * the leg rather than chosen freely: the scurry's crouch lowers the hip socket
 * toward the ankle, and this is the stride that keeps every planted frame
 * inside the leg's reach with headroom to spare — gate T8 reports how much.
 */
const SCURRY_STRIDE = 0.3;
/**
 * Ground covered by one full scurry cycle: each foot slides back twice its
 * stride while it is planted, and the two feet take turns. The creature
 * advances its phase by this distance so a planted foot holds the floor.
 */
export const SCURRY_GROUND_PER_CYCLE = SCURRY_STRIDE * 4;

const SCURRY_HUNCH = 0.72;
const SCURRY_BOB = 0.2;
const SCURRY_BOB_DIP = 0.05;
const SCURRY_NECK = 0.12;
const SCURRY_HEAD = -0.3;
const SCURRY_HIP_FORWARD = 0.06;
const SCURRY_FOOT_SPREAD = 0.2;
const SCURRY_LATERAL_DRIFT = 0.03;
const TOE_LIFT = 0.05;
const TUCK_LIFT = 0.16;
const PASS_LIFT = 0.12;
const REACH_LIFT = 0.03;
const TOE_LIFT_AT = 0.12;
const TUCK_AT = 0.32;
const PASS_AT = 0.55;
const REACH_AT = 0.8;
const HEEL_STRIKE_PITCH = -0.12;
const TOE_OFF_PITCH = 0.3;
const SWING_PITCH = -0.05;
/** The arms swing hard, the hand travelling further forward than back. */
const SCURRY_ARM_SWING = 0.55;
const SCURRY_ARM_FORWARD_SHARE = 0.6;
const SCURRY_ARM_SPREAD = 0.42;
const SCURRY_ELBOW = 0.4;
const SCURRY_ELBOW_PUMP = 0.75;
const SCURRY_FIST = 0.85;
const SCURRY_SWAY = 0.03;
const SCURRY_EAR_LIFT = -0.05;
const SCURRY_EAR_FLAP = 0.12;
const SCURRY_EAR_FOLD = 0.3;
const SCURRY_EAR_LAG = 0.15;
const SCURRY_CAN_SWING = 0.55;
const SCURRY_CAN_LAG = 0.18;
const SCURRY_CAN_LIFT = 0.035;
const SCURRY_TAIL_SWING = -0.95;
const SCURRY_TAIL_WAG = 0.22;
const SCURRY_TAIL_CURL = 0.15;
const SCURRY_JAW = 0.12;

interface GaitFoot {
  readonly forward: number;
  readonly lift: number;
  readonly pitch: number;
}

/**
 * One foot through a stride. During stance it is planted and slides back under
 * the body at a constant rate — the body is what moves; during swing it tucks,
 * passes and reaches.
 */
function gaitFoot(phase: number): GaitFoot {
  const cycle = ((phase % 1) + 1) % 1;
  const stance = cycle < 0.5;
  const t = stance ? cycle / 0.5 : (cycle - 0.5) / 0.5;
  if (stance) {
    return {
      forward: lerp(SCURRY_STRIDE, -SCURRY_STRIDE, t),
      lift: 0,
      pitch: linearKeys(t, [
        [0, HEEL_STRIKE_PITCH],
        [0.2, 0],
        [0.75, 0],
        [1, TOE_OFF_PITCH],
      ]),
    };
  }
  return {
    forward: linearKeys(t, [
      [0, -SCURRY_STRIDE],
      [TUCK_AT, -SCURRY_STRIDE * 0.7],
      [PASS_AT, 0],
      [REACH_AT, SCURRY_STRIDE * 0.8],
      [1, SCURRY_STRIDE],
    ]),
    lift: linearKeys(t, [
      [0, 0],
      [TOE_LIFT_AT, TOE_LIFT],
      [TUCK_AT, TUCK_LIFT],
      [PASS_AT, PASS_LIFT],
      [REACH_AT, REACH_LIFT],
      [1, 0],
    ]),
    pitch: linearKeys(t, [
      [0, TOE_OFF_PITCH],
      [PASS_AT, SWING_PITCH],
      [1, HEEL_STRIKE_PITCH],
    ]),
  };
}

/** Piecewise-linear keys: a planted foot slides at a constant rate, so no easing. */
function linearKeys(t: number, keys: readonly (readonly [number, number])[]): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      return lerp(v0, v1, (t - t0) / (t1 - t0));
    }
  }
  return keys[keys.length - 1][1];
}

function scurry(phase: number): GremlinPose {
  const pose = crouch();
  const right = gaitFoot(phase);
  const left = gaitFoot(phase + 0.5);
  const rock = Math.sin(phase * TURN);
  pose.hunch = SCURRY_HUNCH;
  pose.neckPitch = SCURRY_NECK;
  pose.headPitch = SCURRY_HEAD;
  // The pelvis drops at contact rather than rising at mid-stance: a foot planted
  // a stride ahead is only in reach from a hip that has come down to meet it.
  pose.bob = SCURRY_BOB + SCURRY_BOB_DIP * (0.5 + 0.5 * Math.cos(phase * TURN * 2));
  pose.hipForward = SCURRY_HIP_FORWARD;
  pose.sway = rock * SCURRY_SWAY;
  pose.rightFoot = v3(
    SCURRY_FOOT_SPREAD + rock * SCURRY_LATERAL_DRIFT,
    -right.lift,
    right.forward + SCURRY_HIP_FORWARD,
  );
  pose.leftFoot = v3(
    -SCURRY_FOOT_SPREAD + rock * SCURRY_LATERAL_DRIFT,
    -left.lift,
    left.forward + SCURRY_HIP_FORWARD,
  );
  pose.rightFootPitch = right.pitch;
  pose.leftFootPitch = left.pitch;
  // Phase 0 is the right foot's contact, when the same-side arm is furthest back.
  const rightSwing = -Math.cos(phase * TURN);
  const armAngle = (swing: number): number =>
    swing >= 0
      ? swing * SCURRY_ARM_SWING * SCURRY_ARM_FORWARD_SHARE * 2
      : swing * SCURRY_ARM_SWING * (1 - SCURRY_ARM_FORWARD_SHARE) * 2;
  pose.rightArm = {
    swing: armAngle(rightSwing),
    spread: SCURRY_ARM_SPREAD,
    elbow: SCURRY_ELBOW + SCURRY_ELBOW_PUMP * clamp01(rightSwing),
  };
  pose.leftArm = {
    swing: armAngle(-rightSwing),
    spread: SCURRY_ARM_SPREAD,
    elbow: SCURRY_ELBOW + SCURRY_ELBOW_PUMP * clamp01(-rightSwing),
  };
  pose.rightFist = SCURRY_FIST;
  pose.leftFist = SCURRY_FIST;
  const flap = Math.sin((phase * 2 - SCURRY_EAR_LAG) * TURN);
  pose.leftEar = {
    lift: EAR_REST_LIFT + SCURRY_EAR_LIFT + flap * SCURRY_EAR_FLAP,
    fold: SCURRY_EAR_FOLD,
  };
  pose.rightEar = {
    lift: EAR_REST_LIFT + SCURRY_EAR_LIFT - flap * SCURRY_EAR_FLAP,
    fold: SCURRY_EAR_FOLD,
  };
  pose.canSwing = Math.sin((phase - SCURRY_CAN_LAG) * TURN) * SCURRY_CAN_SWING;
  pose.canLift = SCURRY_CAN_LIFT * Math.max(0, Math.sin((phase - SCURRY_CAN_LAG) * TURN * 2));
  pose.tailSwing = SCURRY_TAIL_SWING + Math.sin(phase * TURN) * SCURRY_TAIL_WAG;
  pose.tailCurl = SCURRY_TAIL_CURL;
  pose.jaw = SCURRY_JAW;
  pose.breath = 0.5 + 0.5 * Math.cos(phase * TURN * 2);
  return pose;
}

// ── Vomit ────────────────────────────────────────────────────────────────────

/**
 * A one-shot's keys start and end on its first and last frames' samples rather
 * than on 0 and 1, so the first frame is the crouch it starts from and the last
 * the crouch it hands back to.
 */
const VOMIT_FIRST_AT = shotProgress(0, VOMIT_FRAMES);
const VOMIT_LAST_AT = shotProgress(VOMIT_FRAMES - 1, VOMIT_FRAMES);
const VOMIT_RELEASE_AT = shotProgress(VOMIT_RELEASE_FRAME, VOMIT_FRAMES);
const VOMIT_REAR_AT = shotProgress(3, VOMIT_FRAMES);
const VOMIT_HOLD_AT = shotProgress(5, VOMIT_FRAMES);
const VOMIT_LOAD_AT = shotProgress(6, VOMIT_FRAMES);
const VOMIT_AFTER_AT = shotProgress(9, VOMIT_FRAMES);

const VOMIT_HUNCH = [
  [VOMIT_FIRST_AT, CROUCH_HUNCH],
  [VOMIT_REAR_AT, 0.05],
  [VOMIT_HOLD_AT, 0.12],
  [VOMIT_LOAD_AT, 0.32],
  [VOMIT_RELEASE_AT, 0.85],
  [VOMIT_AFTER_AT, 0.85],
  [VOMIT_LAST_AT, CROUCH_HUNCH],
] as const;
const VOMIT_NECK = [
  [VOMIT_FIRST_AT, CROUCH_NECK],
  [VOMIT_REAR_AT, -0.35],
  [VOMIT_HOLD_AT, -0.3],
  [VOMIT_RELEASE_AT, 0.45],
  [VOMIT_AFTER_AT, 0.3],
  [VOMIT_LAST_AT, CROUCH_NECK],
] as const;
const VOMIT_HEAD = [
  [VOMIT_FIRST_AT, CROUCH_HEAD],
  [VOMIT_REAR_AT, -0.35],
  [VOMIT_HOLD_AT, -0.3],
  [VOMIT_RELEASE_AT, 0.05],
  [VOMIT_LAST_AT, CROUCH_HEAD],
] as const;
const VOMIT_BOB = [
  [VOMIT_FIRST_AT, CROUCH_BOB],
  [VOMIT_REAR_AT, 0.07],
  [VOMIT_HOLD_AT, 0.08],
  [VOMIT_RELEASE_AT, 0.17],
  [VOMIT_AFTER_AT, 0.2],
  [VOMIT_LAST_AT, CROUCH_BOB],
] as const;
const VOMIT_HIP_FORWARD = [
  [VOMIT_FIRST_AT, 0],
  [VOMIT_REAR_AT, -0.07],
  [VOMIT_HOLD_AT, -0.06],
  [VOMIT_RELEASE_AT, 0.12],
  [VOMIT_AFTER_AT, 0.08],
  [VOMIT_LAST_AT, 0],
] as const;
const VOMIT_SAC = [
  [VOMIT_FIRST_AT, IDLE_SAC_BASE],
  [VOMIT_REAR_AT, 0.7],
  [VOMIT_HOLD_AT, 1],
  [VOMIT_LOAD_AT, 1],
  [VOMIT_RELEASE_AT, 0.35],
  [VOMIT_AFTER_AT, 0.08],
  [VOMIT_LAST_AT, IDLE_SAC_BASE],
] as const;
const VOMIT_GLOW = [
  [VOMIT_FIRST_AT, IDLE_GLOW_BASE],
  [VOMIT_REAR_AT, 0.75],
  [VOMIT_HOLD_AT, 1],
  [VOMIT_RELEASE_AT, 0.85],
  [VOMIT_AFTER_AT, 0.35],
  [VOMIT_LAST_AT, IDLE_GLOW_BASE],
] as const;
const VOMIT_JAW = [
  [VOMIT_FIRST_AT, 0],
  [VOMIT_REAR_AT, 0.08],
  [VOMIT_HOLD_AT, 0.15],
  [VOMIT_LOAD_AT, 0.4],
  [VOMIT_RELEASE_AT, 1],
  [VOMIT_AFTER_AT, 0.55],
  [VOMIT_LAST_AT, 0],
] as const;
const VOMIT_SPEW = [
  [VOMIT_FIRST_AT, 0],
  [VOMIT_LOAD_AT, 0],
  [VOMIT_RELEASE_AT, 1],
  [shotProgress(8, VOMIT_FRAMES), 0.9],
  [VOMIT_AFTER_AT, 0.6],
  [shotProgress(10, VOMIT_FRAMES), 0.2],
  [shotProgress(11, VOMIT_FRAMES), 0],
] as const;
/** Arms thrown back and out as it rears, then braced forward on the lunge. */
const VOMIT_ARMS_BACK = [
  [VOMIT_FIRST_AT, 0],
  [VOMIT_REAR_AT, 1],
  [VOMIT_HOLD_AT, 1],
  [VOMIT_LOAD_AT, 0.6],
  [VOMIT_RELEASE_AT, -1],
  [VOMIT_AFTER_AT, -0.8],
  [VOMIT_LAST_AT, 0],
] as const;
/** How far the arms are driven by angle rather than resting on the crouch's hands. */
const VOMIT_ARM_DRIVE = [
  [VOMIT_FIRST_AT, 0],
  [VOMIT_REAR_AT, 1],
  [VOMIT_AFTER_AT, 1],
  [VOMIT_LAST_AT, 0],
] as const;
const VOMIT_ARM_REST_SWING = 0.35;
const VOMIT_ARM_THROWN_BACK = 0.9;
const VOMIT_ARM_BRACED_FORWARD = 0.55;
const VOMIT_ARM_REST_SPREAD = 0.25;
const VOMIT_ARM_SPREAD_OUT = 0.35;
const VOMIT_ARM_REST_ELBOW = 0.35;
const VOMIT_ARM_ELBOW_BACK = 0.5;
const VOMIT_ARM_ELBOW_BRACE = 0.2;
const VOMIT_EAR_PIN = [
  [VOMIT_FIRST_AT, 0],
  [VOMIT_REAR_AT, 1],
  [VOMIT_HOLD_AT, 1],
  [VOMIT_RELEASE_AT, -0.6],
  [VOMIT_AFTER_AT, -0.3],
  [VOMIT_LAST_AT, 0],
] as const;
const VOMIT_EAR_PIN_LIFT = 0.35;
const VOMIT_CAN_SWING = 0.3;
const VOMIT_EAR_PIN_FOLD = 0.45;
const VOMIT_SQUINT_FROM = VOMIT_LOAD_AT;
const VOMIT_SQUINT = 0.55;

/**
 * Four beats: it rears back as the sac swells and glows, holds at the top with
 * the sac full and bright, lunges forward and spews with its jaw at full gape on
 * the release frame, then sags back into its crouch.
 *
 * The feet stay planted in the crouch's own stance throughout: the rear and the
 * lunge are carried by the hips and spine, so nothing slides along the floor
 * and the row starts and ends exactly on the idle's feet.
 */
function vomit(progress: number): GremlinPose {
  const pose = crouch();
  pose.hunch = keyed(progress, VOMIT_HUNCH);
  pose.neckPitch = keyed(progress, VOMIT_NECK);
  pose.headPitch = keyed(progress, VOMIT_HEAD);
  pose.bob = keyed(progress, VOMIT_BOB);
  pose.hipForward = keyed(progress, VOMIT_HIP_FORWARD);
  pose.sac = keyed(progress, VOMIT_SAC);
  pose.sacGlow = keyed(progress, VOMIT_GLOW);
  pose.jaw = keyed(progress, VOMIT_JAW);
  pose.spew = keyed(progress, VOMIT_SPEW);
  pose.scowl = 1;
  pose.breath = clamp01(keyed(progress, VOMIT_SAC));
  pose.blink = progress >= VOMIT_SQUINT_FROM && progress <= VOMIT_AFTER_AT ? VOMIT_SQUINT : 0;
  // Through the rear and the lunge the arms are driven from the shoulder: the
  // shoulders travel a long way, and a hand pinned in space would have its arm
  // stretched out of reach or folded up behind it. At either end the hands
  // blend back onto the crouch's own, so the row starts from the idle it
  // interrupts and hands back to it without the arms snapping.
  const arms = keyed(progress, VOMIT_ARMS_BACK);
  const back = Math.max(0, arms);
  const brace = Math.max(0, -arms);
  const armAngles = {
    swing: VOMIT_ARM_REST_SWING - back * VOMIT_ARM_THROWN_BACK + brace * VOMIT_ARM_BRACED_FORWARD,
    spread: VOMIT_ARM_REST_SPREAD + back * VOMIT_ARM_SPREAD_OUT,
    elbow: VOMIT_ARM_REST_ELBOW + back * VOMIT_ARM_ELBOW_BACK - brace * VOMIT_ARM_ELBOW_BRACE,
  };
  const swung = buildSkeleton({ ...pose, leftArm: armAngles, rightArm: armAngles });
  const drive = keyed(progress, VOMIT_ARM_DRIVE);
  const rest = crouch();
  pose.leftHand = mixV3(rest.leftHand, swung.leftArm.end, drive);
  pose.rightHand = mixV3(rest.rightHand, swung.rightArm.end, drive);
  pose.leftFist = lerp(CROUCH_FIST, 1, back);
  pose.rightFist = lerp(CROUCH_FIST, 1, back);
  const pin = keyed(progress, VOMIT_EAR_PIN);
  const ear = {
    lift: EAR_REST_LIFT + pin * VOMIT_EAR_PIN_LIFT,
    fold: Math.max(0, pin) * VOMIT_EAR_PIN_FOLD,
  };
  pose.leftEar = ear;
  pose.rightEar = ear;
  pose.tailCurl = IDLE_TAIL_CURL + back * IDLE_TAIL_CURL_SWING;
  pose.canSwing = -arms * VOMIT_CAN_SWING;
  return pose;
}

// ── Summon ───────────────────────────────────────────────────────────────────

/**
 * It gathers, rears to its full height, beats its fists on its chest one after
 * the other, then flings its arms out and throws its head back to shriek — the
 * shriek's peak is the event frame — and drops back into its crouch.
 */
const SUMMON_EVENT_AT = shotProgress(SUMMON_EVENT_FRAME, SUMMON_FRAMES);
const SUMMON_FIRST_AT = shotProgress(0, SUMMON_FRAMES);
const SUMMON_LAST_AT = shotProgress(SUMMON_FRAMES - 1, SUMMON_FRAMES);
const SUMMON_GATHER_AT = shotProgress(1, SUMMON_FRAMES);
const SUMMON_RISEN_AT = shotProgress(3, SUMMON_FRAMES);
const SUMMON_LAST_BEAT_AT = shotProgress(6, SUMMON_FRAMES);
const SUMMON_RELEASE_AT = shotProgress(10, SUMMON_FRAMES);
/** The chest beats, by frame: which fist is on the chest, right first. */
const BEAT_FRAMES: ReadonlyMap<number, -1 | 1> = new Map<number, -1 | 1>([
  [3, 1],
  [4, -1],
  [5, 1],
  [6, -1],
]);

const SUMMON_HUNCH = [
  [SUMMON_FIRST_AT, CROUCH_HUNCH],
  [SUMMON_GATHER_AT, 0.78],
  [SUMMON_RISEN_AT, 0.02],
  [SUMMON_LAST_BEAT_AT, 0.0],
  [SUMMON_EVENT_AT, -0.12],
  [SUMMON_RELEASE_AT, 0.4],
  [SUMMON_LAST_AT, CROUCH_HUNCH],
] as const;
const SUMMON_BOB = [
  [SUMMON_FIRST_AT, CROUCH_BOB],
  [SUMMON_GATHER_AT, 0.26],
  [SUMMON_RISEN_AT, -0.02],
  [SUMMON_EVENT_AT, -0.04],
  [SUMMON_RELEASE_AT, 0.12],
  [SUMMON_LAST_AT, CROUCH_BOB],
] as const;
const SUMMON_NECK = [
  [SUMMON_FIRST_AT, CROUCH_NECK],
  [SUMMON_GATHER_AT, 0.25],
  [SUMMON_RISEN_AT, -0.1],
  [SUMMON_LAST_BEAT_AT, -0.15],
  [SUMMON_EVENT_AT, -0.55],
  [SUMMON_RELEASE_AT, 0],
  [SUMMON_LAST_AT, CROUCH_NECK],
] as const;
const SUMMON_HEAD = [
  [SUMMON_FIRST_AT, CROUCH_HEAD],
  [SUMMON_RISEN_AT, -0.05],
  [SUMMON_LAST_BEAT_AT, -0.1],
  [SUMMON_EVENT_AT, -0.7],
  [SUMMON_RELEASE_AT, -0.15],
  [SUMMON_LAST_AT, CROUCH_HEAD],
] as const;
const SUMMON_JAW = [
  [SUMMON_FIRST_AT, 0],
  [SUMMON_RISEN_AT, 0.15],
  [SUMMON_LAST_BEAT_AT, 0.35],
  [SUMMON_EVENT_AT, 1],
  [SUMMON_RELEASE_AT, 0.3],
  [SUMMON_LAST_AT, 0],
] as const;
const SUMMON_FLING = [
  [SUMMON_FIRST_AT, 0],
  [SUMMON_LAST_BEAT_AT, 0],
  [SUMMON_EVENT_AT, 1],
  [SUMMON_RELEASE_AT, 0.35],
  [SUMMON_LAST_AT, 0],
] as const;
const SUMMON_EAR_FLARE = [
  [SUMMON_FIRST_AT, 0],
  [SUMMON_RISEN_AT, 0.3],
  [SUMMON_EVENT_AT, 1],
  [SUMMON_RELEASE_AT, 0.2],
  [SUMMON_LAST_AT, 0],
] as const;
const SUMMON_EAR_FLARE_LIFT = 0.45;
const SUMMON_RISE = [
  [SUMMON_FIRST_AT, 0],
  [SUMMON_GATHER_AT, 0],
  [SUMMON_RISEN_AT, 1],
  [SUMMON_EVENT_AT, 1],
  [SUMMON_RELEASE_AT, 0.4],
  [SUMMON_LAST_AT, 0],
] as const;
const BEAT_HAND_ACROSS = 0.08;
const BEAT_HAND_DROP = 0.32;
const BEAT_HAND_FORWARD = 0.24;
const WOUND_HAND_ACROSS = 0.36;
const WOUND_HAND_DROP = 0.2;
const WOUND_HAND_FORWARD = 0.18;
const FLING_HAND_ACROSS = 0.8;
const FLING_HAND_DROP = -0.3;
const FLING_HAND_FORWARD = 0.05;
const SUMMON_SAC = 0.35;
const SUMMON_GLOW = 0.6;
const SUMMON_TAIL_CURL = 1;
const SUMMON_CAN_SWING = 0.45;
const SUMMON_CAN_LIFT = 0.05;
/** The fists are shut by the time it is halfway up. */
const FIST_CLOSES_BY_HALF_RISEN = 2;
/** Flung out to shriek, the hands spring most of the way open. */
const FLING_OPENS_HANDS = 0.6;

function summon(frame: number): GremlinPose {
  const progress = shotProgress(frame, SUMMON_FRAMES);
  const pose = crouch();
  pose.hunch = keyed(progress, SUMMON_HUNCH);
  pose.bob = keyed(progress, SUMMON_BOB);
  pose.neckPitch = keyed(progress, SUMMON_NECK);
  pose.headPitch = keyed(progress, SUMMON_HEAD);
  pose.jaw = keyed(progress, SUMMON_JAW);
  pose.scowl = 1;
  pose.blink =
    progress >= SUMMON_LAST_BEAT_AT && progress <= SUMMON_RELEASE_AT
      ? VOMIT_SQUINT * keyed(progress, SUMMON_FLING)
      : 0;
  const flare = keyed(progress, SUMMON_EAR_FLARE);
  pose.leftEar = { lift: EAR_REST_LIFT + flare * SUMMON_EAR_FLARE_LIFT, fold: 0 };
  pose.rightEar = { lift: EAR_REST_LIFT + flare * SUMMON_EAR_FLARE_LIFT, fold: 0 };
  pose.sac = IDLE_SAC_BASE + SUMMON_SAC * keyed(progress, SUMMON_FLING);
  pose.sacGlow = lerp(IDLE_GLOW_BASE, SUMMON_GLOW, keyed(progress, SUMMON_RISE));
  pose.tailCurl = lerp(IDLE_TAIL_CURL, SUMMON_TAIL_CURL, keyed(progress, SUMMON_FLING));
  pose.breath = keyed(progress, SUMMON_RISE);

  const rise = keyed(progress, SUMMON_RISE);
  const fling = keyed(progress, SUMMON_FLING);
  const beating = BEAT_FRAMES.get(frame);
  // Hands are placed from where the shoulders really are on this frame, so a
  // fist beats the chest however far it has risen.
  const shoulderY = buildSkeleton(pose).chest.y;
  for (const side of [-1, 1]) {
    const rest = side < 0 ? crouch().leftHand : crouch().rightHand;
    let hand = v3(
      lerp(rest.x, side * WOUND_HAND_ACROSS, rise),
      lerp(rest.y, shoulderY + WOUND_HAND_DROP, rise),
      lerp(rest.z, WOUND_HAND_FORWARD, rise),
    );
    if (beating !== undefined && beating === side) {
      hand = v3(side * BEAT_HAND_ACROSS, shoulderY + BEAT_HAND_DROP, BEAT_HAND_FORWARD);
    }
    hand = v3(
      lerp(hand.x, side * FLING_HAND_ACROSS, fling),
      lerp(hand.y, shoulderY + FLING_HAND_DROP, fling),
      lerp(hand.z, FLING_HAND_FORWARD, fling),
    );
    if (side < 0) pose.leftHand = hand;
    else pose.rightHand = hand;
  }
  const fistShare = clamp01(rise * FIST_CLOSES_BY_HALF_RISEN) * (1 - fling * FLING_OPENS_HANDS);
  pose.leftFist = lerp(CROUCH_FIST, 1, fistShare);
  pose.rightFist = lerp(CROUCH_FIST, 1, fistShare);
  pose.canSwing = beating === undefined ? fling * SUMMON_CAN_SWING : beating * SUMMON_CAN_SWING;
  pose.canLift = beating === undefined ? 0 : SUMMON_CAN_LIFT;
  return pose;
}

// ── Rows ─────────────────────────────────────────────────────────────────────

export type RowKind = 'loop' | 'oneShot';
type RowAction = 'idle' | 'scurry' | 'vomit' | 'summon';

export interface RowSpec {
  readonly name: string;
  readonly action: RowAction;
  readonly frameCount: number;
  readonly kind: RowKind;
  readonly view: GremlinView;
  /** The frame the runtime acts on — the release or the summon's peak — or null. */
  readonly eventFrame: number | null;
  /** Whether the row is paced by ground covered rather than by time. */
  readonly locomotion: boolean;
  readonly pose: (frame: number) => GremlinPose;
}

const VIEWS: readonly { readonly view: GremlinView; readonly suffix: string }[] = [
  { view: 'front', suffix: '' },
  { view: 'side', suffix: '_side' },
  { view: 'back', suffix: '_back' },
];

function rowsOf(
  action: RowAction,
  frameCount: number,
  kind: RowKind,
  eventFrame: number | null,
  locomotion: boolean,
  pose: (frame: number) => GremlinPose,
): RowSpec[] {
  return VIEWS.map(({ view, suffix }) => ({
    name: `${action}${suffix}`,
    action,
    frameCount,
    kind,
    view,
    eventFrame,
    locomotion,
    pose,
  }));
}

export const TRASH_GREMLIN_ROWS: readonly RowSpec[] = [
  ...rowsOf('idle', IDLE_FRAMES, 'loop', null, false, (f) => idle(cyclePhase(f, IDLE_FRAMES))),
  ...rowsOf('scurry', SCURRY_FRAMES, 'loop', null, true, (f) =>
    scurry(cyclePhase(f, SCURRY_FRAMES)),
  ),
  ...rowsOf('vomit', VOMIT_FRAMES, 'oneShot', VOMIT_RELEASE_FRAME, false, (f) =>
    vomit(shotProgress(f, VOMIT_FRAMES)),
  ),
  ...rowsOf('summon', SUMMON_FRAMES, 'oneShot', SUMMON_EVENT_FRAME, false, (f) => summon(f)),
];

// ── Gore placement ───────────────────────────────────────────────────────────

const GORE_PIECES: readonly GorePiece[] = trashGremlinGorePieces();

/** The gore states, in the order `BodyPartGoreSystem` spawns them. */
export const GORE_STATES: readonly string[] = GORE_PIECES.map((piece) => piece.state);

function gorePieceOf(state: string): GorePiece {
  const piece = GORE_PIECES.find((candidate) => candidate.state === state);
  if (piece === undefined) throw new Error(`no gore piece for "${state}"`);
  return piece;
}

function poseRowOf(state: string): RowSpec | undefined {
  return TRASH_GREMLIN_ROWS.find((row) => row.name === state);
}

/**
 * Paints one cell of the Trash Gremlin, in the cell's own pixels.
 *
 * A pose row is anchored at the ground line under the tile's centre, which is
 * what ties the art to the tile it stands on. A gore piece is painted about
 * the cell's centre with room to spare on every side: the gore field spins it
 * about the centre of its own ink, measured as it draws, so the piece needs no
 * exact centring — only to stay clear of the cell's edges.
 */
function paintTrashGremlinFrame(ctx: CanvasRenderingContext2D, state: string, frame: number): void {
  const row = poseRowOf(state);
  if (row === undefined) {
    const piece = gorePieceOf(state);
    ctx.save();
    ctx.translate(FRAME_WIDTH / 2, FRAME_HEIGHT / 2);
    ctx.scale(FIGURE_UNIT_PX, FIGURE_UNIT_PX);
    piece.paint(ctx);
    ctx.restore();
    return;
  }
  paintPoseCell(ctx, row, frame);
}

/** One frame of a pose row, anchored on the ground line under the tile's centre. */
export function paintPoseCell(
  ctx: CanvasRenderingContext2D,
  row: RowSpec,
  frame: number,
  options?: ViewOptions,
): void {
  ctx.save();
  ctx.translate(POSE_ORIGIN_X, POSE_ORIGIN_Y);
  ctx.scale(FIGURE_UNIT_PX, FIGURE_UNIT_PX);
  drawTrashGremlinView(ctx, row.view, row.pose(frame), options);
  ctx.restore();
}

function stateFrames(): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const row of TRASH_GREMLIN_ROWS) frames[row.name] = row.frameCount;
  for (const state of GORE_STATES) frames[state] = 1;
  return frames;
}

const TRASH_GREMLIN_STATE_FRAMES = stateFrames();

/** RGBA, as the cache bakes every cell at full density. */
const CELL_BYTES_PER_PIXEL = 4;

/**
 * Its own cache ceiling, above the fleet's 24 MB default: every cell it paints,
 * derived from the row table rather than picked. While its room is sealed every
 * row of the fight is pinned against the idle sweep, and the cache never evicts
 * a pinned row to make room, so a ceiling below the whole set would refuse
 * whichever rows were warmed last for the rest of the fight and leave them to
 * paint cold on every draw. The set is about 32 MB, a sixth of the cache's
 * 188 MB global ceiling, and nothing else on floor one stands near its own.
 */
const TRASH_GREMLIN_BUDGET_MEGABYTES = Math.ceil(
  (Object.values(TRASH_GREMLIN_STATE_FRAMES).reduce((cells, frames) => cells + frames, 0) *
    FRAME_WIDTH *
    FRAME_HEIGHT *
    CELL_BYTES_PER_PIXEL) /
    BYTES_PER_MEGABYTE,
);

export const TRASH_GREMLIN_FIGURE: FigureDef = {
  id: 'trash_gremlin',
  frameWidth: FRAME_WIDTH,
  frameHeight: FRAME_HEIGHT,
  tileX: TILE_X,
  tileY: TILE_Y,
  tileScale: TILE_SCALE,
  states: figureStates(TRASH_GREMLIN_STATE_FRAMES),
  paintFrame: paintTrashGremlinFrame,
  budgetMegabytes: TRASH_GREMLIN_BUDGET_MEGABYTES,
};

/** The ground line inside the cell, for harnesses drawing a guide. */
export const GROUND_Y_IN_CELL = POSE_ORIGIN_Y;
export const POSE_ORIGIN_X_IN_CELL = POSE_ORIGIN_X;
