/**
 * The Dark Knight, as a painted figure: the choreography, the cell geometry,
 * and the `FigureDef` the runtime cache and the review harness both draw
 * through.
 *
 * This module is choreography and nothing else — one pose function per row, the
 * row table, and the placement of a pose or a gore piece inside its cell. The
 * anatomy, the palette and every stroke of paint live in `darkKnightArt.ts` and
 * `darkKnightGore.ts`; nothing here draws a plate.
 *
 * Rows:
 *    walk / walk_side / walk_away    — toward the camera, profile, and away
 *    idle / idle_side / idle_away
 *    slam / slam_side / slam_away    — overhead two-hand raise, drop, buried
 *    sweep / sweep_side / sweep_away — mace whirled round the helm, then level
 *    punch / punch_side / punch_away — off-hand jab, snappy because undodgeable
 *
 * plus one single-frame state per severed piece, which is how
 * `BodyPartGoreSystem` asks for them.
 *
 * The art invariants live in `scripts/gates-dark-knight.ts`, which the review
 * harness runs: `npm run render:dark-knight`.
 */

import {
  ARM_LENGTH,
  SHOULDER_JOINT_DROP,
  SHOULDER_Y,
  type ArmAngles,
  type KnightPose,
  type KnightView,
  type Pt,
  clamp01,
  deg,
  drawKnightBack,
  drawKnightFront,
  drawKnightSide,
  easeIn,
  easeInOut,
  easeOut,
  lerp,
  makeMacePainter,
  ramp,
  restingPose,
} from './darkKnightArt';
import { type GorePiece, darkKnightGorePieces } from './darkKnightGore';
import { type FigureDef, figureStates } from '../figure/figureDef';

// ── Cell geometry ────────────────────────────────────────────────────────────

/** Art tile size; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;

/**
 * How much of a tile the knight fills. Carl stands at 0.72 of his 2.03 units,
 * i.e. 1.46 tiles; the knight at 0.94 of 2.28 stands 2.14 — half again Carl's
 * height, which is the whole point of him.
 */
export const KNIGHT_SCALE = 0.94;

/** Ground line within the tile, matching where every other biped's feet sit. */
export const GROUND_OFFSET_IN_TILE = 0.9;

/**
 * The cell the poses and the gore pieces are painted into, and where the
 * knight's own tile sits inside it.
 *
 * These four numbers were measured by the bake this figure replaces — the
 * widest pose plus padding, quantised to whole pixels — and
 * `scripts/parity-figure-sheet.ts` is what proved the painter still fills
 * exactly that cell. The gates re-check that nothing paints against the edge,
 * which is what would say a pose has outgrown them.
 */
const FRAME_WIDTH = 164;
const FRAME_HEIGHT = 204;
const TILE_X = 50;
const TILE_Y = 134;

/** Poses are painted with the origin on the ground line, at the cell's centre. */
const POSE_ORIGIN_X = FRAME_WIDTH / 2;
export const POSE_ORIGIN_Y = TILE_Y + TILE_SCALE * GROUND_OFFSET_IN_TILE;

// ── Row lengths ──────────────────────────────────────────────────────────────

export const WALK_FRAMES = 16;
export const IDLE_FRAMES = 8;
export const SLAM_FRAMES = 16;
export const SWEEP_FRAMES = 18;
export const PUNCH_FRAMES = 8;

/**
 * The frame each attack lands on. The creature's own timers are sized from
 * these, so a row whose choreography moved its extreme without moving this
 * number lands the blow on a frame where nothing is happening — which is what
 * the impact gate exists to catch.
 */
export const SLAM_IMPACT_FRAME = 9;
export const SWEEP_IMPACT_FRAME = 13;
export const PUNCH_IMPACT_FRAME = 4;

// ── Pose helpers ─────────────────────────────────────────────────────────────

function pt(x: number, y: number): Pt {
  return { x, y };
}

/** Loops sample the cycle evenly; one-shots sample the middle of each frame. */
export function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

function shotProgress(frame: number, frameCount: number): number {
  return (frame + 0.5) / frameCount;
}

/** Piecewise linear interpolation through a set of (t, value) keys. */
function keyed(t: number, keys: readonly (readonly [number, number])[]): number {
  for (let i = 1; i < keys.length; i++) {
    const [prevT, prevV] = keys[i - 1];
    const [nextT, nextV] = keys[i];
    if (t <= nextT) return lerp(prevV, nextV, (t - prevT) / (nextT - prevT));
  }
  return keys[keys.length - 1][1];
}

// ── The carry ────────────────────────────────────────────────────────────────

/**
 * The knight walks and stands with the mace shouldered rather than swinging at
 * his side. Two reasons, both about the silhouette: a 0.94-tile haft swung from
 * a hanging hand sweeps a quarter of the frame and drags the cell size out for
 * every row, and shouldered it puts a second vertical mass beside the helm,
 * which is what says "armed" at a 32 px tile.
 */
const CARRY_HAND_SPREAD = 0.33;
const CARRY_HAND_DROP = 0.5;
/** How far back from vertical the shouldered haft leans, per view. */
const CARRY_MACE_TILT = deg(26);
/** Straight up in screen terms; the mace leans off this. */
const STRAIGHT_UP = deg(-90);

/** Where a relaxed off-hand hangs: just inside the arm's own reach. */
const HAND_HANG_SPREAD = 0.375;
const ARM_HANG_REACH = ARM_LENGTH * 0.99;
const HAND_HANG_DROP = SHOULDER_JOINT_DROP + ARM_HANG_REACH;

/** Feet stand under the hips; wider angles the thighs out and reads knock-kneed. */
const IDLE_FOOT_SPREAD = 0.16;
/** Edge-on the two feet are only slightly staggered. */
const IDLE_SIDE_FOOT_LEAD = 0.085;

/**
 * Puts the mace on the right shoulder for a locomotion or idle pose.
 *
 * The haft leans *outboard*, away from the helm. Leaned the other way it lies
 * diagonally across the visor and the head sits behind the helm's own corner:
 * from the front the knight then appears to be carrying nothing at all.
 */
/**
 * How far the shouldered mace rocks against the stride, and how far behind the
 * torso's own bob its head lags. Small numbers: it is fifteen pounds of steel
 * braced on a pauldron, not a swinging arm. Without either, the upper body is
 * pixel-identical across all sixteen walk frames and moonwalks over the legs.
 */
const CARRY_ROCK = deg(7);
const CARRY_HAND_BOB = 0.018;

function shoulderTheMace(pose: KnightPose, view: KnightView, rock = 0): void {
  const lean = CARRY_MACE_TILT;
  pose.rightHand = pt(
    CARRY_HAND_SPREAD,
    SHOULDER_Y + CARRY_HAND_DROP + pose.bob + rock * CARRY_HAND_BOB,
  );
  pose.maceAngle = STRAIGHT_UP + lean + rock * CARRY_ROCK;
  // Behind the body only when the shaft would otherwise cross the helm, which
  // is the away view — from there the knight's own back is between them.
  pose.macePropBehind = view === 'back';
}

/**
 * Eases a finished attack back toward the pose the knight stands in.
 *
 * Without this an attack row ends wherever its follow-through left the arms —
 * the slam ended in a T-pose with the mace at half-mast — and the runtime then
 * cuts straight from that to the idle's shouldered carry. A one-shot has to
 * hand off to the pose that follows it, or every attack ends in a pop.
 */
function settleTowardCarry(pose: KnightPose, view: KnightView, amount: number): void {
  if (amount <= 0) return;
  // The row's own idle, not a bare resting pose: the idle is what the runtime
  // actually cuts to, and it is also the only stance whose foot spread is known
  // to be inside the leg's reach for this view.
  const carry = idleFor(view);
  const t = clamp01(amount);
  pose.rightHand = pt(
    lerp(pose.rightHand.x, carry.rightHand.x, t),
    lerp(pose.rightHand.y, carry.rightHand.y, t),
  );
  pose.leftHand = pt(
    lerp(pose.leftHand.x, carry.leftHand.x, t),
    lerp(pose.leftHand.y, carry.leftHand.y, t),
  );
  // Toward the *nearest* equivalent of the carry angle. A sweep ends two whole
  // turns past where it started, and a plain lerp to −72° would unwind those
  // turns during the settle — the mace spinning backwards for four frames.
  pose.maceAngle = lerp(pose.maceAngle, nearestEquivalentAngle(carry.maceAngle, pose.maceAngle), t);
  pose.crouch = lerp(pose.crouch, carry.crouch, t);
  pose.lean = lerp(pose.lean, carry.lean, t);
  pose.twist = lerp(pose.twist, carry.twist, t);
  pose.skirtFlare = lerp(pose.skirtFlare, carry.skirtFlare, t);
  pose.cloakSway = lerp(pose.cloakSway, carry.cloakSway, t);
  pose.headTilt = lerp(pose.headTilt, carry.headTilt, t);
  pose.leftFoot = pt(
    lerp(pose.leftFoot.x, carry.leftFoot.x, t),
    lerp(pose.leftFoot.y, carry.leftFoot.y, t),
  );
  pose.rightFoot = pt(
    lerp(pose.rightFoot.x, carry.rightFoot.x, t),
    lerp(pose.rightFoot.y, carry.rightFoot.y, t),
  );
}

/** `target`, shifted by whole turns so it is within half a turn of `near`. */
function nearestEquivalentAngle(target: number, near: number): number {
  const turn = Math.PI * 2;
  return target + Math.round((near - target) / turn) * turn;
}

/** The standing pose an attack in this view hands back to. */
function idleFor(view: KnightView): KnightPose {
  if (view === 'side') return idleSide(0);
  if (view === 'back') return idleBack(0);
  return idleFront(0);
}

// ── Idle ─────────────────────────────────────────────────────────────────────

/**
 * Standing still has to read as *alive* without reading as swaying. A knight in
 * plate does not breathe visibly through his chest, so the tell is the shoulder
 * line rising and the helm settling — deliberately near the threshold of
 * visibility at a 32 px tile.
 */
const BREATH_RISE = 0.011;
const BREATH_LEAN = deg(0.7);
const IDLE_SWAY = 0.008;
const IDLE_HEAD_TURN = 0.06;
/** How far the helm stays turned toward the camera while standing in profile. */
const SIDE_HEAD_TURN = 0.22;
const IDLE_VISOR_PULSE = 0.18;
const IDLE_ARM_DRIFT = 0.06;
const IDLE_SKIRT_FLARE = 0.1;

/**
 * How far the helm's turn trails the weight shift under it, in cycle turns.
 *
 * A great helm is a lump of steel carried on the gorget, not steered with the
 * hips: the shoulders take the weight across first and the head arrives after,
 * which is why a knight standing at ease reads as a heavy thing settling rather
 * than a mannequin swaying in one piece. A quarter turn is the whole of that
 * drag — the helm is still finishing the last shift when the next one starts.
 *
 * It is also what keeps the idle from being one oscillator. Breath, lean, visor
 * glow, sway and arm drift all ride the same sine, and a sine sampled either
 * side of a turning point paints the same picture twice: the eight-frame idle
 * showed five pictures in all three views.
 */
const HELM_DRAG_TURNS = 0.25;

/** The helm's own clock: the idle sway, a quarter turn late. */
function helmDrag(phase: number): number {
  return Math.sin((phase - HELM_DRAG_TURNS) * Math.PI * 2);
}

function idleBase(phase: number): KnightPose {
  const breath = Math.sin(phase * Math.PI * 2);
  const pose = restingPose();
  // The breath *settles* rather than lifts. A standing figure's leg is already
  // within half a percent of full extension, so raising the hip at all pushes
  // the ankle out of reach and the solver locks the leg — and a knight whose
  // weight sinks on the out-breath reads heavier anyway.
  pose.bob = BREATH_RISE * (breath * 0.5 + 0.5);
  pose.lean = BREATH_LEAN * breath;
  pose.visorGlow = 0.55 + IDLE_VISOR_PULSE * breath;
  pose.skirtFlare = IDLE_SKIRT_FLARE;
  return pose;
}

function idleFront(phase: number): KnightPose {
  const pose = idleBase(phase);
  const sway = Math.sin(phase * Math.PI * 2);
  pose.sway = sway * IDLE_SWAY;
  pose.headTurn = helmDrag(phase) * IDLE_HEAD_TURN;
  pose.leftArmAngles = facingArmAngles(LEFT_ARM, sway * IDLE_ARM_DRIFT, 0, 0);
  pose.leftFoot = pt(-IDLE_FOOT_SPREAD, 0);
  pose.rightFoot = pt(IDLE_FOOT_SPREAD, 0);
  // Straight columns, matching the head-on walk, so standing up out of a step
  // does not pop the knees into a bow.
  pose.leftForeshorten = 1;
  pose.rightForeshorten = 1;
  shoulderTheMace(pose, 'front');
  return pose;
}

function idleSide(phase: number): KnightPose {
  const pose = idleBase(phase);
  pose.leftHand = pt(-SIDE_HAND_BEHIND, SHOULDER_Y + HAND_HANG_DROP + pose.bob);
  pose.leftFoot = pt(-IDLE_SIDE_FOOT_LEAD, 0);
  pose.rightFoot = pt(IDLE_SIDE_FOOT_LEAD, 0);
  pose.headTurn = SIDE_HEAD_TURN + helmDrag(phase) * IDLE_HEAD_TURN;
  // Edge-on the elbow has to break backward; forward it swings the forearm
  // across the knight's own front.
  pose.elbowFlare = -0.35;
  shoulderTheMace(pose, 'side');
  return pose;
}

/** How far behind the hip the off hand hangs in profile. */
const SIDE_HAND_BEHIND = 0.06;

function idleBack(phase: number): KnightPose {
  const pose = idleFront(phase);
  pose.headTurn = -pose.headTurn;
  // Seen from behind the arms hang on the far side of him, as they do in the
  // walk he steps into from here.
  pose.leftArmBehind = true;
  pose.rightArmBehind = true;
  shoulderTheMace(pose, 'back');
  return pose;
}

// ── Walking ──────────────────────────────────────────────────────────────────

/**
 * A walk cycle keyed the way animators key one: contact → down → passing → up,
 * twice per cycle. Phase 0 is right-foot contact.
 *
 * The stride is short and the bob deep. His leg is very nearly as long as his
 * hip is high, so a foot planted much further out than this is beyond the leg's
 * reach — the solver clamps, the leg locks straight, and the next frame's tuck
 * snaps it back, which is the hitch that reads as a hop. Armour buys nothing
 * here; it only makes the hitch more obvious, because the leg is wider.
 */
const STRIDE = 0.185;
const TUCK_LIFT = 0.185;
const TOE_LIFT = 0.045;
const TOE_LIFT_AT = 0.12;
const PASS_LIFT = 0.13;
const REACH_LIFT = 0.028;
const TUCK_AT = 0.32;
const PASS_AT = 0.55;
const REACH_AT = 0.8;

/**
 * Deeper than a man's. Weight is the whole read of this walk: the pelvis drops
 * hard onto each contact and the shoulders follow, which is what a person in
 * fifty pounds of steel does and a person in a jacket does not.
 */
const WALK_BOB = 0.075;
const WALK_LEAN = deg(4);
const WALK_SWAY = 0.018;
const HEEL_STRIKE_PITCH = deg(-8);
const TOE_OFF_PITCH = deg(12);
const SWING_PITCH = deg(-5);
const WALK_SKIRT_FLARE = 0.55;

/** Where the stance foot is planted, in cycle phase, for the foot-slide gate. */
export const STANCE_SHARE = 0.5;

/**
 * One foot of a profile gait. During stance the foot is planted and slides
 * backward under the body at a constant rate — the body is what moves. During
 * swing it tucks, passes and reaches.
 */
function gaitFootSide(phase: number): { foot: Pt; pitch: number } {
  const cycle = ((phase % 1) + 1) % 1;
  const stance = cycle < STANCE_SHARE;
  const t = stance ? cycle / STANCE_SHARE : (cycle - STANCE_SHARE) / (1 - STANCE_SHARE);

  if (stance) {
    return {
      foot: pt(lerp(STRIDE, -STRIDE, t), 0),
      pitch: keyed(t, [
        [0, HEEL_STRIKE_PITCH],
        [0.2, 0],
        [0.75, 0],
        [1, TOE_OFF_PITCH],
      ]),
    };
  }
  return {
    foot: pt(
      keyed(t, [
        [0, -STRIDE],
        [TUCK_AT, -STRIDE * 0.75],
        [PASS_AT, 0],
        [REACH_AT, STRIDE * 0.8],
        [1, STRIDE],
      ]),
      -keyed(t, [
        [0, 0],
        [TOE_LIFT_AT, TOE_LIFT],
        [TUCK_AT, TUCK_LIFT],
        [PASS_AT, PASS_LIFT],
        [REACH_AT, REACH_LIFT],
        [1, 0],
      ]),
    ),
    pitch: keyed(t, [
      [0, TOE_OFF_PITCH],
      [PASS_AT, SWING_PITCH],
      [1, HEEL_STRIKE_PITCH],
    ]),
  };
}

/**
 * Head-on the step reads only as height, so it takes nearly the full profile
 * lift to be legible at all; the pitch, by contrast, is almost invisible.
 */
const FACING_LIFT_SHARE = 0.95;
const FACING_PITCH_SHARE = 0.5;
const FACING_STRIDE_DRIFT = 0.055;
/** The lift at which the swing leg's shin is drawn at full near-camera width. */
const FULLY_NEAR_LIFT = TUCK_LIFT * FACING_LIFT_SHARE;

/**
 * Walking at the camera. A knee pointed at the viewer does not read as an angle
 * — it hinges away from the camera, not across it — so the swing leg stays a
 * straight column and reports only how foreshortened it is.
 */
function gaitFootFacing(
  phase: number,
  side: number,
): { foot: Pt; pitch: number; nearness: number } {
  const cycle = ((phase % 1) + 1) % 1;
  const stance = cycle < STANCE_SHARE;
  const t = stance ? cycle / STANCE_SHARE : (cycle - STANCE_SHARE) / (1 - STANCE_SHARE);
  const home = side * IDLE_FOOT_SPREAD;

  if (stance) {
    return {
      foot: pt(home + FACING_STRIDE_DRIFT * lerp(1, -1, t), 0),
      pitch: keyed(t, [
        [0, HEEL_STRIKE_PITCH * FACING_PITCH_SHARE],
        [0.2, 0],
        [0.75, 0],
        [1, TOE_OFF_PITCH * FACING_PITCH_SHARE],
      ]),
      nearness: 0,
    };
  }
  const lift = keyed(t, [
    [0, 0],
    [TOE_LIFT_AT, TOE_LIFT * FACING_LIFT_SHARE],
    [TUCK_AT, TUCK_LIFT * FACING_LIFT_SHARE],
    [PASS_AT, PASS_LIFT * FACING_LIFT_SHARE],
    [REACH_AT, REACH_LIFT],
    [1, 0],
  ]);
  return {
    foot: pt(home + FACING_STRIDE_DRIFT * lerp(-1, 1, easeInOut(t)), -lift),
    pitch:
      keyed(t, [
        [0, TOE_OFF_PITCH],
        [PASS_AT, SWING_PITCH],
        [1, HEEL_STRIKE_PITCH],
      ]) * FACING_PITCH_SHARE,
    nearness: clamp01(lift / FULLY_NEAR_LIFT),
  };
}

const LEFT_ARM = -1;
/** Shoulder rotation at the top of the forward swing. */
const ARM_SWING_ANGLE = deg(30);
/** An arm swings further forward than back, so the backswing is scaled down. */
const ARM_BACKSWING_SHARE = 0.55;
/** How much of the shoulder's swing the forearm inherits. */
const FOREARM_FOLLOW = 0.22;
/** The bend a walking elbow simply holds, keeping the forearm ahead of the arm. */
const ELBOW_FLEX = deg(12);
/** How much of its length the forearm loses at the front of a head-on swing. */
const FACING_FOREARM_FORESHORTEN = 0.16;
const WALK_ELBOW_FLEX = deg(7);
/**
 * A relaxed arm carries a little standing flexion at the elbow — the break that
 * gives the arm a readable joint and holds it off the ribs. The upper arm
 * therefore tilts out further than the forearm does.
 */
const FACING_ELBOW_FLEX = deg(8);
/** Head-on the upper arm is nearly end-on and shows very little travel... */
const FACING_UPPER_SWING = deg(5);
/** ...so the forearm carries most of what there is. */
const FACING_FOREARM_SWING = deg(11);

function armSwingAngle(forward: number): number {
  const shortened = forward >= 0 ? forward : forward * ARM_BACKSWING_SHARE;
  return shortened * ARM_SWING_ANGLE;
}

/**
 * A profile arm, driven from its joints rather than from a hand target. Almost
 * all of a walking arm's travel belongs to the shoulder; placed by its hand,
 * both segments are forced to swing together and the forearm flails.
 */
function sideArmAngles(forward: number): ArmAngles {
  const upper = armSwingAngle(forward);
  return { upper, fore: upper * FOREARM_FOLLOW + ELBOW_FLEX, foreScale: 1 };
}

/**
 * The pair of tilts that hold `FACING_ELBOW_FLEX` of bend while still landing
 * the wrist exactly where the idle's hand hangs. Two segments at two angles
 * have no tidy closed form for that, so it is solved by bisection at load.
 */
const TILT_SOLVE_STEPS = 40;

function solveForearmTilt(): number {
  const wristOffset = HAND_HANG_SPREAD - FACING_ARM_ROOT;
  const reach = (fore: number): number =>
    UPPER_ARM * Math.sin(fore + FACING_ELBOW_FLEX) + FOREARM * Math.sin(fore);
  let low = -Math.PI / 2;
  let high = Math.PI / 2;
  for (let i = 0; i < TILT_SOLVE_STEPS; i++) {
    const mid = (low + high) / 2;
    if (reach(mid) < wristOffset) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/** Re-exported proportions the tilt solver needs, named locally for brevity. */
const FACING_ARM_ROOT = 0.345;
const UPPER_ARM = 0.375;
const FOREARM = 0.325;

const FACING_FOREARM_TILT = solveForearmTilt();
const FACING_UPPER_TILT = FACING_FOREARM_TILT + FACING_ELBOW_FLEX;

/**
 * One head-on arm. `swing` is positive as it comes forward and crosses inboard;
 * `forward` runs 0 at the back of the swing to 1 at the front and drives the
 * foreshortening, which is what carries the hand up the body.
 */
function facingArmAngles(side: number, swing: number, forward: number, flex: number): ArmAngles {
  return {
    upper: side * (FACING_UPPER_TILT - swing * FACING_UPPER_SWING),
    fore: side * (FACING_FOREARM_TILT - flex - swing * FACING_FOREARM_SWING),
    foreScale: 1 - forward * FACING_FOREARM_FORESHORTEN,
  };
}

/**
 * The off arm of a head-on walk. The mace arm does not swing — it is holding
 * fifteen pounds of steel against the shoulder — so only this one does, which
 * is exactly what a shouldered-arms march looks like.
 */
function facingOffArmSwing(phase: number, away: boolean): { angles: ArmAngles; behind: boolean } {
  const own = Math.sin(phase * Math.PI * 2) * LEFT_ARM;
  const signedSwing = own >= 0 ? own : own * ARM_BACKSWING_SHARE;
  // Centred on the rest hang, so the average of the cycle is where the arm
  // stands. Uncentred, the whole swing sits inboard of the idle and he visibly
  // tucks his arm in the moment he starts walking.
  const swing = signedSwing - (1 - ARM_BACKSWING_SHARE) / 2;
  // 0 at the back of the swing, 1 at the front — one peak per stride. A
  // *rectified* swing would peak twice and read at double speed.
  const forward = (own + 1) / 2;
  return {
    angles: facingArmAngles(LEFT_ARM, swing, forward, WALK_ELBOW_FLEX),
    // Whole-row, not per-frame: an arm that changes sides partway through the
    // cycle pops at the shoulder.
    behind: away,
  };
}

function walkSide(phase: number): KnightPose {
  const pose = restingPose();
  const right = gaitFootSide(phase);
  const left = gaitFootSide(phase + 0.5);
  const bobPhase = Math.abs(Math.sin(phase * Math.PI * 2));

  // The pelvis *drops* at contact rather than rising at mid-stance, which is
  // what buys the stride and what a real pelvis does anyway.
  pose.bob = WALK_BOB * (1 - bobPhase);
  pose.lean = WALK_LEAN;
  pose.rightFoot = right.foot;
  pose.rightFootPitch = right.pitch;
  pose.leftFoot = left.foot;
  pose.leftFootPitch = left.pitch;
  pose.leftArmAngles = sideArmAngles(Math.sin(phase * Math.PI * 2));
  pose.elbowFlare = -0.5;
  pose.skirtFlare = WALK_SKIRT_FLARE;
  pose.cloakSway = -0.6;
  pose.headTurn = SIDE_HEAD_TURN;
  // Lagged a quarter cycle behind the torso, which is what gives a carried
  // weight its weight: the mace peaks after the shoulder that is carrying it.
  shoulderTheMace(pose, 'side', Math.cos(phase * Math.PI * 2));
  return pose;
}

function walkFacing(phase: number, away: boolean): KnightPose {
  const pose = restingPose();
  const right = gaitFootFacing(phase, 1);
  const left = gaitFootFacing(phase + 0.5, -1);
  const bobPhase = Math.abs(Math.sin(phase * Math.PI * 2));

  // Dropped at contact rather than raised at mid-stance, the same way the
  // profile walk does it. Raising the hip lengthens the span the leg has to
  // cover at exactly the moment a foot is planted, and there is no headroom for
  // that — the solver clamps and the sole lifts off the floor for a frame.
  pose.bob = WALK_BOB * (1 - bobPhase);
  pose.sway = Math.sin(phase * Math.PI * 2) * WALK_SWAY;
  pose.rightFoot = right.foot;
  pose.rightFootPitch = right.pitch;
  pose.leftFoot = left.foot;
  pose.leftFootPitch = left.pitch;
  pose.rightLegNearness = right.nearness;
  pose.leftLegNearness = left.nearness;
  // Both legs, not just the swinging one: a bow that shows on the planted leg
  // and vanishes on the swinging one flickers once per step and reads as a
  // wiggle. Head-on, every knee is a straight column.
  pose.rightForeshorten = 1;
  pose.leftForeshorten = 1;

  const offArm = facingOffArmSwing(phase, away);
  pose.leftArmAngles = offArm.angles;
  pose.leftArmBehind = offArm.behind;
  pose.rightArmBehind = away;
  pose.twist = Math.sin(phase * Math.PI * 2) * 0.1;
  pose.skirtFlare = WALK_SKIRT_FLARE;
  pose.cloakSway = Math.sin(phase * Math.PI * 2) * 0.4;
  pose.headTurn = away ? 0 : Math.sin(phase * Math.PI * 2) * 0.12;
  shoulderTheMace(pose, away ? 'back' : 'front', Math.cos(phase * Math.PI * 2));
  return pose;
}

// ── Slam ─────────────────────────────────────────────────────────────────────

/**
 * The overhead slam: both hands take the haft, it goes up behind the helm, and
 * the whole body drops onto it. The windup is long because the fight's warning
 * circle is on the ground for its whole length — the animation and the
 * telegraph have to agree about how much time the player is being given.
 */
const SLAM_RAISE_ANGLE = deg(-118);
const SLAM_BURIED_ANGLE = deg(58);
/**
 * A wide stance is a *low* stance, and here that is arithmetic rather than
 * taste: the knight's leg is within a few percent of his hip height, so every
 * bit of lateral foot spread has to be paid for by dropping the pelvis or the
 * solver clamps the leg straight and the sole lifts off the floor. Each attack
 * therefore plants itself with a baseline crouch sized to its own stance.
 */
const SLAM_PLANT_CROUCH = 0.16;
const SLAM_CROUCH = 0.48;
const SLAM_LEAN_BACK = deg(-13);
const SLAM_LEAN_INTO = deg(26);
const SLAM_STANCE_SPREAD = 0.235;
/** How far up the raised hands go, measured from the shoulder line. */
const SLAM_HAND_RISE = 0.42;
/** How far forward and down the buried hands end up. */
const SLAM_HAND_REACH = 0.34;
const SLAM_HAND_DROP = 0.5;
const SLAM_FACING_REACH_SHARE = 0.72;
/** The off hand grips the haft this far back from the mace hand. */
const OFF_GRIP_BEHIND = 0.15;

/**
 * The slam's four beats, in row progress. The mace is *buried* on the declared
 * impact frame rather than starting to fall there: a strike whose extreme lands
 * after its damage frame telegraphs the wrong moment, and the ground circle is
 * timed against this.
 */
const SLAM_RAISE_END = 0.34;
const SLAM_IMPACT_T = (SLAM_IMPACT_FRAME + 0.5) / SLAM_FRAMES;
/**
 * A frame of stillness at the bottom of the swing. Without it the mace is at
 * the shoulder one frame, at the ground the next and back up the frame after —
 * the contact is over before the eye finds it.
 */
const SLAM_CONTACT_HOLD = 1 / SLAM_FRAMES;
/**
 * The rebound starts on the frame of contact, not after a beat of stillness:
 * `settle` is eased out, so it moves fastest in the frames right after impact,
 * which is what a follow-through is.
 */
const SLAM_RECOVER_START = SLAM_IMPACT_T + SLAM_CONTACT_HOLD;

/**
 * How far the cloak and the skirt lag the plate they hang from, in frames.
 *
 * Cloth is dragged, not driven: the armour arrives at the bottom of the swing
 * and stops dead, and the cloth keeps coming for a beat before it settles
 * against him. It is also the only thing left moving through
 * {@link SLAM_CONTACT_HOLD} — every body term is at its extreme and pinned
 * there for that beat, so with the cloth on the body's own clock the hold is
 * one picture painted into two cells and the sixteen-frame row shows fifteen.
 */
const CLOTH_DRAG_FRAMES = 1;

function slamPose(t: number, view: KnightView): KnightPose {
  const pose = restingPose();
  const raise = easeInOut(ramp(t, 0, SLAM_RAISE_END));
  // Eased *in*: the mace accelerates the whole way down, which is what gives a
  // heavy weapon its weight. Three frames of travel is the strike, and the
  // mace-arc gate is told to expect that spike rather than have it averaged out.
  const drop = easeIn(ramp(t, SLAM_RAISE_END, SLAM_IMPACT_T));
  // The rebound is the follow-through, not a fifth beat: eased out, so it moves
  // fastest in the frames right after contact.
  const settle = easeOut(ramp(t, SLAM_RECOVER_START, 1)) * SLAM_RECOVERY;

  const clothT = t - CLOTH_DRAG_FRAMES / SLAM_FRAMES;
  const clothRaise = easeInOut(ramp(clothT, 0, SLAM_RAISE_END));
  const clothDrop = easeIn(ramp(clothT, SLAM_RAISE_END, SLAM_IMPACT_T));
  const clothSettle = easeOut(ramp(clothT, SLAM_RECOVER_START, 1)) * SLAM_RECOVERY;

  // Head-on the slam still has to put the head somewhere the player reads as
  // "in front of his feet", so the facing views keep more of the profile's
  // forward reach than a straight foreshortening would give them.
  const lateral = view === 'side' ? 1 : SLAM_FACING_REACH_SHARE;
  const buried = drop;
  pose.crouch = SLAM_PLANT_CROUCH + SLAM_CROUCH * buried;
  pose.lean = lerp(SLAM_LEAN_BACK * raise, SLAM_LEAN_INTO, buried);
  pose.leftFoot = pt(-SLAM_STANCE_SPREAD, 0);
  pose.rightFoot = pt(SLAM_STANCE_SPREAD, 0);
  pose.leftForeshorten = view === 'side' ? 0 : 1;
  pose.rightForeshorten = view === 'side' ? 0 : 1;
  pose.skirtFlare = 0.3 + 0.7 * clothDrop;
  pose.cloakSway = lerp(-0.8 * clothRaise, 0.9, clothDrop) * (1 - clothSettle * 0.6);
  pose.visorGlow = 0.5 + 0.5 * Math.max(raise, drop);

  const handX = lerp(lerp(0.24, -0.1 * lateral, raise), SLAM_HAND_REACH * lateral, buried);
  const handY = SHOULDER_Y + lerp(lerp(0.5, -SLAM_HAND_RISE, raise), SLAM_HAND_DROP, buried);
  pose.rightHand = pt(handX, handY);
  // Both hands on the haft. The off fist has to stay within its own arm's
  // length of the grip or it paints in mid-air — identical on every frame and
  // therefore invisible to every ratio and continuity gate there is.
  pose.leftHand = pt(handX - OFF_GRIP_BEHIND * lateral, handY + OFF_GRIP_BEHIND * 0.35);
  pose.elbowFlare = -0.4;
  pose.maceAngle = lerp(
    lerp(STRAIGHT_UP - CARRY_MACE_TILT, SLAM_RAISE_ANGLE, raise),
    SLAM_BURIED_ANGLE,
    buried,
  );
  // Behind him only in the away view, where his own back is between them.
  // Head-on, hiding the mace for the three frames of the strike takes the
  // signature move off screen entirely — the blow simply never appears.
  pose.macePropBehind = view === 'back' && raise > 0.35 && drop < 0.25;
  pose.leftArmBehind = view === 'back';
  pose.rightArmBehind = view === 'back' && pose.macePropBehind;
  pose.headTurn = view === 'side' ? SIDE_HEAD_TURN : 0;
  pose.headTilt = deg(10) * buried - deg(6) * raise;
  settleTowardCarry(pose, view, settle);
  return pose;
}

/**
 * How far back toward the carry the rebound gets by the last frame. Short of 1
 * on purpose: the knight comes up into his guard, not to attention, and the
 * runtime blends the last few percent when the row hands back to the idle.
 */
const SLAM_RECOVERY = 0.95;

/**
 * True for the one step in a slam row that is *meant* to be a spike: the strike
 * itself. A gate that measured the strike against the row's own median would
 * either fail every honest slam or, loosened enough to pass, stop catching the
 * cornered swings it exists for.
 */
export function isDeclaredTipSpike(rowName: string, fromFrame: number): boolean {
  if (!rowName.startsWith('slam')) return false;
  const from = shotProgress(fromFrame, SLAM_FRAMES);
  const to = shotProgress(fromFrame + 1, SLAM_FRAMES);
  return to > SLAM_RAISE_END && from < SLAM_IMPACT_T;
}

// ── Sweep ────────────────────────────────────────────────────────────────────

/**
 * The arc sweep: the mace is whirled twice round the helm to wind up, then
 * levelled and driven through a full turn at torso height. The whirl is what
 * the ground ring's fade is timed against — it has to be visibly a wind-up and
 * not just a fast swing.
 */
/**
 * One turn round the helm, not two. Two spun the head through ninety degrees
 * per frame, which at any playback rate is a strobe rather than a swing — the
 * eye cannot follow an arc that jumps more than about a sixth of a turn a frame.
 */
const SWEEP_WHIRL_TURNS = 1;
/**
 * How far from the body the *grip* orbits. The head then reaches a further
 * `MACE_REACH` beyond it, so the arc the player has to back out of is the sum
 * of the two. Held small enough that the arm never has to over-reach for it:
 * a clamped arm stops orbiting and the sweep stalls on one side.
 */
/** Where round the orbit the whirl begins, in turns. */
const WHIRL_START_TURN = 0.14;
const SWEEP_WHIRL_RADIUS = 0.2;
const SWEEP_LEVEL_RADIUS = 0.3;
const SWEEP_PLANT_CROUCH = 0.13;
const SWEEP_CROUCH = 0.22;
const SWEEP_STANCE_SPREAD = 0.215;
/** Where the whirl ends and the level sweep begins, in row progress. */
const SWEEP_LEVEL_AT = 0.44;
/**
 * How much the grip's orbit is flattened. Edge-on the swing is nearly in the
 * picture plane; head-on most of it runs toward and away from the camera, and a
 * circular orbit there reads as the knight lifting the mace over his own head
 * twice a turn.
 */
const SWEEP_SIDE_SQUASH = 0.32;
const SWEEP_FACING_SQUASH = 0.22;
/** First frame on which the mace has left the helm and is sweeping at torso height. */
export const SWEEP_FIRST_LEVEL_FRAME = Math.ceil(SWEEP_LEVEL_AT * SWEEP_FRAMES - 0.5);

function sweepPose(t: number, view: KnightView): KnightPose {
  const pose = restingPose();
  const whirl = clamp01(t / SWEEP_LEVEL_AT);
  const level = clamp01((t - SWEEP_LEVEL_AT) / (1 - SWEEP_LEVEL_AT));
  const lateral = view === 'side' ? 1 : 0.55;

  // One continuous angle across both halves, so the haft never jumps: the whirl
  // spins it two turns above the helm and the sweep carries straight on into a
  // third at torso height.
  // Started off the vertical. Dead upright on frame 0 the shaft rises straight
  // out of the top of the helm with the gripping fist hidden behind the head,
  // and the mace reads as a pole growing out of him.
  const spin = WHIRL_START_TURN + easeIn(whirl) * SWEEP_WHIRL_TURNS + easeInOut(level);
  pose.maceAngle = STRAIGHT_UP + spin * Math.PI * 2;

  // The grip leads the head rather than trailing it: put the hand on the far
  // side of the orbit and the mace points back at the knight, so the head only
  // ever reaches `MACE_REACH − radius` from him and the sweep has no reach at
  // all. Hand and head travel the same direction, and their radii add.
  const radius = lerp(SWEEP_WHIRL_RADIUS, SWEEP_LEVEL_RADIUS, level);
  const centreY = SHOULDER_Y + lerp(-0.02, 0.3, level);
  // The whirl orbits nearly round above the helm; the sweep itself runs flat.
  // A circular orbit in the second half carries the head up over his own head
  // twice a turn, which reads as a windmill rather than as a level sweep.
  const flat = view === 'side' ? SWEEP_SIDE_SQUASH : SWEEP_FACING_SQUASH;
  const orbitSquash = lerp(WHIRL_ORBIT_SQUASH, flat, level);
  pose.rightHand = pt(
    Math.cos(pose.maceAngle) * radius * lateral,
    centreY + Math.sin(pose.maceAngle) * radius * orbitSquash,
  );
  pose.leftHand = pt(pose.rightHand.x * 0.3 - 0.2 * lateral, centreY + 0.16);
  pose.elbowFlare = 0.5;

  pose.crouch = SWEEP_PLANT_CROUCH + SWEEP_CROUCH * easeInOut(level);
  pose.lean = deg(7) * level;
  pose.twist = Math.sin(spin * Math.PI * 2) * 0.35;
  pose.leftFoot = pt(-SWEEP_STANCE_SPREAD, 0);
  pose.rightFoot = pt(SWEEP_STANCE_SPREAD, 0);
  pose.leftForeshorten = view === 'side' ? 0 : 1;
  pose.rightForeshorten = view === 'side' ? 0 : 1;
  pose.skirtFlare = 0.35 + 0.65 * level;
  pose.cloakSway = Math.sin(spin * Math.PI * 2) * 0.9;
  pose.visorGlow = 0.6 + 0.4 * level;
  // Never hidden behind the body. Occluded for the far half of each turn the
  // whirl reads as the mace teleporting from one side of him to the other,
  // because three consecutive frames have no weapon in them at all.
  pose.macePropBehind = false;
  pose.leftArmBehind = view === 'back';
  pose.rightArmBehind = view === 'back' && pose.macePropBehind;
  pose.headTurn = view === 'side' ? SIDE_HEAD_TURN : 0;
  settleTowardCarry(pose, view, easeInOut(ramp(t, SWEEP_RECOVER_START, 1)) * SWEEP_RECOVERY);
  return pose;
}

/** The whirl's own orbit, near enough round to read as going over the helm. */
const WHIRL_ORBIT_SQUASH = 0.85;

/** Where the sweep stops spinning and comes back to the guard, in row progress. */
const SWEEP_RECOVER_START = 0.8;
const SWEEP_RECOVERY = 0.95;

// ── Punch ────────────────────────────────────────────────────────────────────

/**
 * The off-hand jab. Short by design: it is mechanically undodgeable, so the
 * only honest thing the animation can do is not pretend otherwise — no windup
 * worth reading, straight out and straight back.
 */
const PUNCH_REACH = 0.66;
/** How far behind the hip the fist is drawn back before the jab. */
const PUNCH_CHAMBER = 0.22;
/**
 * Shoulder rotation through the jab. Small: the twist shifts the pauldrons, and
 * a large one slides a plate sideways with nothing under it driving it.
 */
const PUNCH_TWIST = 0.45;
const PUNCH_PLANT_CROUCH = 0.1;
/** The jab's three beats, in row progress: chamber, extend, retract. */
const PUNCH_CHAMBER_END = 0.3;
const PUNCH_IMPACT_T = (PUNCH_IMPACT_FRAME + 0.5) / PUNCH_FRAMES;

function punchPose(t: number, view: KnightView): KnightPose {
  const pose = restingPose();
  const chamber = easeInOut(ramp(t, 0, PUNCH_CHAMBER_END));
  // Full extension lands *on* the impact frame and comes straight back off it.
  // Reaching furthest at the end of the row instead would put the blow three
  // frames after the damage.
  const extend = easeOut(ramp(t, PUNCH_CHAMBER_END, PUNCH_IMPACT_T));
  const retract = easeInOut(ramp(t, PUNCH_IMPACT_T, 1));
  const thrust = extend * (1 - retract);

  if (view === 'side') {
    // Edge-on the jab is a straight line across the picture, so a hand target
    // says everything.
    const punchOut = chamber * (1 - extend) * -PUNCH_CHAMBER + thrust * PUNCH_REACH;
    pose.leftHand = pt(
      punchOut - (1 - Math.max(chamber, thrust)) * HAND_HANG_SPREAD,
      SHOULDER_Y + lerp(HAND_HANG_DROP, PUNCH_HAND_HEIGHT, Math.max(chamber * 0.7, thrust)),
    );
    pose.elbowFlare = -0.3;
  } else {
    // Head-on a jab travels almost entirely *at the camera*, and a 2D arm has
    // no way to show that except to be drawn shorter. Moving the hand sideways
    // instead — the first attempt — produced an arm raised out to the side and
    // held there, which a reviewer read as no punch at all. So the arm is driven
    // from its joints, swung inboard across the chest, and its forearm
    // foreshortened until the fist sits over the sternum.
    pose.leftArmAngles = {
      upper: LEFT_ARM * (FACING_UPPER_TILT - PUNCH_FACING_UPPER_SWING * thrust),
      fore: LEFT_ARM * (FACING_FOREARM_TILT - PUNCH_FACING_FOREARM_SWING * thrust),
      foreScale: 1 - PUNCH_FACING_FORESHORTEN * thrust,
    };
    pose.offFistScale = 1 + PUNCH_FIST_GROWTH * thrust;
  }

  pose.twist = -PUNCH_TWIST * chamber + PUNCH_TWIST * thrust;
  pose.lean = deg(6) * thrust - deg(3) * chamber;
  pose.leftFoot = pt(-IDLE_FOOT_SPREAD * 1.15, 0);
  pose.rightFoot = pt(IDLE_FOOT_SPREAD * 1.15, 0);
  pose.leftForeshorten = view === 'side' ? 0 : 1;
  pose.rightForeshorten = view === 'side' ? 0 : 1;
  pose.crouch = PUNCH_PLANT_CROUCH + 0.08 * thrust;
  pose.skirtFlare = 0.2 + 0.3 * thrust;
  pose.visorGlow = 0.6 + 0.4 * thrust;
  pose.headTurn = view === 'side' ? SIDE_HEAD_TURN : 0;
  // Never behind the body, in any view. Away-facing it was drawn behind his own
  // back and the row became indistinguishable from the idle.
  pose.leftArmBehind = false;
  pose.rightArmBehind = view === 'back';
  // Edge-on the off arm is the far one and would be painted behind the torso,
  // which hides the entire jab: the silhouette then does not move by a pixel
  // across the row. The one pose that has to override that rule does.
  pose.leftArmInFront = view === 'side';
  // Hauled back and down out of the jab's lane. Left on the shoulder the mace
  // hand sits at 0.33 forward with the shaft rising past it, and the punching
  // fist arrives into that cluster — three review rounds read the result as a
  // guard rather than a strike, because there was no clean space for the fist
  // to be seen arriving in.
  // Driven by the chamber rather than the thrust: the chamber is eased at both
  // ends, so the mace drifts back and returns smoothly. Tied to the thrust it
  // snapped, and the mace-arc gate rightly called that a cornered swing.
  shoulderTheMace(pose, view, -chamber * (1 - retract) * PUNCH_MACE_CLEARANCE);
  settleTowardCarry(pose, view, retract * PUNCH_RECOVERY);
  return pose;
}

/** How far the shouldered mace rocks back to clear the jab, in `rock` units. */
const PUNCH_MACE_CLEARANCE = 2.2;

/** How high the jabbing fist rides, measured from the shoulder line. */
/**
 * How far below the shoulder line the jabbing fist lands. Chest height, not
 * shoulder height: level with the shoulder it arrives on top of the mace hand
 * and the shaft rising past it, and the whole jab disappears into that clutter.
 */
const PUNCH_HAND_HEIGHT = 0.34;
/** Head-on, how far the jab swings the arm inboard across the chest. */
const PUNCH_FACING_UPPER_SWING = deg(52);
const PUNCH_FACING_FOREARM_SWING = deg(96);
/** How much of its length the forearm loses pointing at the camera. */
const PUNCH_FACING_FORESHORTEN = 0.55;
/** How much the fist grows at full extension, coming at the camera. */
const PUNCH_FIST_GROWTH = 0.7;

const PUNCH_RECOVERY = 0.95;

// ── Row table ────────────────────────────────────────────────────────────────

export type RowKind = 'loop' | 'oneShot';

export interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly kind: RowKind;
  readonly view: KnightView;
  /** The frame a one-shot lands on, or null for a loop. */
  readonly impactFrame: number | null;
  readonly pose: (frame: number) => KnightPose;
}

function attackRows(
  base: string,
  frames: number,
  impactFrame: number,
  pose: (t: number, view: KnightView) => KnightPose,
): RowSpec[] {
  const views: ReadonlyArray<readonly [string, KnightView]> = [
    [base, 'front'],
    [`${base}_side`, 'side'],
    [`${base}_away`, 'back'],
  ];
  return views.map(([name, view]) => ({
    name,
    frameCount: frames,
    kind: 'oneShot' as const,
    view,
    impactFrame,
    pose: (frame: number) => pose(shotProgress(frame, frames), view),
  }));
}
export const DARK_KNIGHT_ROWS: readonly RowSpec[] = [
  {
    name: 'walk',
    frameCount: WALK_FRAMES,
    kind: 'loop',
    view: 'front',
    impactFrame: null,
    pose: (f) => walkFacing(cyclePhase(f, WALK_FRAMES), false),
  },
  {
    name: 'walk_side',
    frameCount: WALK_FRAMES,
    kind: 'loop',
    view: 'side',
    impactFrame: null,
    pose: (f) => walkSide(cyclePhase(f, WALK_FRAMES)),
  },
  {
    name: 'walk_away',
    frameCount: WALK_FRAMES,
    kind: 'loop',
    view: 'back',
    impactFrame: null,
    pose: (f) => walkFacing(cyclePhase(f, WALK_FRAMES), true),
  },
  {
    name: 'idle',
    frameCount: IDLE_FRAMES,
    kind: 'loop',
    view: 'front',
    impactFrame: null,
    pose: (f) => idleFront(cyclePhase(f, IDLE_FRAMES)),
  },
  {
    name: 'idle_side',
    frameCount: IDLE_FRAMES,
    kind: 'loop',
    view: 'side',
    impactFrame: null,
    pose: (f) => idleSide(cyclePhase(f, IDLE_FRAMES)),
  },
  {
    name: 'idle_away',
    frameCount: IDLE_FRAMES,
    kind: 'loop',
    view: 'back',
    impactFrame: null,
    pose: (f) => idleBack(cyclePhase(f, IDLE_FRAMES)),
  },
  ...attackRows('slam', SLAM_FRAMES, SLAM_IMPACT_FRAME, slamPose),
  ...attackRows('sweep', SWEEP_FRAMES, SWEEP_IMPACT_FRAME, sweepPose),
  ...attackRows('punch', PUNCH_FRAMES, PUNCH_IMPACT_FRAME, punchPose),
];

/** Pieces are authored at their own tile-unit sizes, not the creature's scale. */
const GORE_PIECES: readonly GorePiece[] = darkKnightGorePieces();

/**
 * Extra scale applied to the gore pieces on top of {@link KNIGHT_SCALE}.
 *
 * The pieces are drawn at their own tile-unit sizes rather than sliced off the
 * figure, so they do not inherit his scale — but they do have to survive the
 * runtime's own 0.5×. Held at 1 they come out around eight screen pixels
 * across, below the size at which one shape can be told from another.
 */
const GORE_PIECE_SCALE = 1.9;

/** Pixels per tile unit a gore piece is painted at. */
export const GORE_UNIT = TILE_SCALE * GORE_PIECE_SCALE;

/** The gore states, in the order `BodyPartGoreSystem` spawns them. */
export const GORE_STATES: readonly string[] = GORE_PIECES.map((piece) => piece.state);

/**
 * How far each gore piece is nudged so that its ink, not its authoring origin,
 * sits at the centre of the cell.
 *
 * `BodyPartGoreSystem` spins a piece about the centre of its own visible
 * pixels, so a piece drawn off-centre in its cell orbits rather than tumbles.
 * The offsets are in the piece's own units, the same ones its `paint` is scaled
 * by, and they were measured from the painted ink of each piece. Measuring is
 * something only an offline pass can do, so the numbers are frozen here and
 * `scripts/gates-dark-knight.ts` re-measures them on every render.
 */
export const GORE_RECENTRE: ReadonlyMap<string, Pt> = new Map([
  ['gore_helm', pt(0.004111842105263158, -0.037006578947368425)],
  ['gore_pauldron', pt(0.012335526315789474, -0.012335526315789474)],
  ['gore_breastplate', pt(0.024671052631578948, 0.004111842105263158)],
  ['gore_gauntlet', pt(0.012335526315789474, 0.004111842105263158)],
  ['gore_arm', pt(-0.012335526315789474, 0.024671052631578948)],
  ['gore_leg', pt(0, 0.05345394736842105)],
  ['gore_mace', pt(0.004111842105263158, 0.008223684210526315)],
]);

function goreRecentreOf(state: string): Pt {
  const offset = GORE_RECENTRE.get(state);
  if (offset === undefined) throw new Error(`no gore recentring offset for "${state}"`);
  return offset;
}

function gorePieceOf(state: string): GorePiece {
  const piece = GORE_PIECES.find((candidate) => candidate.state === state);
  if (piece === undefined) throw new Error(`no gore piece for "${state}"`);
  return piece;
}

function poseRowOf(state: string): RowSpec | undefined {
  return DARK_KNIGHT_ROWS.find((row) => row.name === state);
}

const MACE = makeMacePainter();

function paintView(ctx: CanvasRenderingContext2D, view: KnightView, pose: KnightPose): void {
  if (view === 'front') drawKnightFront(ctx, pose, MACE);
  else if (view === 'back') drawKnightBack(ctx, pose, MACE);
  else drawKnightSide(ctx, pose, MACE);
}

/**
 * Paints one cell of the Dark Knight, in the cell's own pixels.
 *
 * A pose row is anchored at the ground line under the cell's centre, which is
 * what ties the art to the tile the creature stands on. A gore piece is
 * anchored at the cell's centre instead, because the only thing that reads its
 * cell is the spin the gore field applies about that point.
 */
function paintDarkKnightFrame(ctx: CanvasRenderingContext2D, state: string, frame: number): void {
  const row = poseRowOf(state);
  if (row === undefined) {
    const piece = gorePieceOf(state);
    const recentre = goreRecentreOf(state);
    ctx.save();
    ctx.translate(
      FRAME_WIDTH / 2 + recentre.x * GORE_UNIT,
      FRAME_HEIGHT / 2 + recentre.y * GORE_UNIT,
    );
    ctx.scale(GORE_UNIT, GORE_UNIT);
    piece.paint(ctx);
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.translate(POSE_ORIGIN_X, POSE_ORIGIN_Y);
  ctx.scale(TILE_SCALE * KNIGHT_SCALE, TILE_SCALE * KNIGHT_SCALE);
  paintView(ctx, row.view, row.pose(frame));
  ctx.restore();
}

/** Every state the figure declares, pose rows first and then the gore pieces. */
function darkKnightStateFrames(): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const row of DARK_KNIGHT_ROWS) frames[row.name] = row.frameCount;
  for (const state of GORE_STATES) frames[state] = 1;
  return frames;
}

export const DARK_KNIGHT_FIGURE: FigureDef = {
  id: 'dark_knight',
  frameWidth: FRAME_WIDTH,
  frameHeight: FRAME_HEIGHT,
  tileX: TILE_X,
  tileY: TILE_Y,
  tileScale: TILE_SCALE,
  states: figureStates(darkKnightStateFrames()),
  paintFrame: paintDarkKnightFrame,
};
