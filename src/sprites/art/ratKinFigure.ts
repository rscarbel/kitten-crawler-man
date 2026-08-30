/**
 * Mordecai in his rodent form, as a painted figure: the choreography, the cell
 * geometry, and the `FigureDef` the runtime cache and the review harness both
 * draw through.
 *
 * This module is choreography and nothing else — the gait, the arm swing, the
 * tail lag, the row table, and the placement of a pose inside its cell. Anatomy,
 * palette and every stroke of paint live in `ratKinArt.ts`.
 *
 * Rows:
 *    walk       — toward the camera
 *    walk_side  — profile, painted facing +X and mirrored at runtime
 *    walk_away  — away from the camera, tail toward the viewer
 *    idle / idle_side / idle_away
 *
 * There is no attack row: Mordecai wanders his safe room and talks, and never
 * fights.
 *
 * The art invariants live in `scripts/gates-rat-kin.ts`, which the review
 * harness runs: `npm run render:rat-kin`.
 */

import { clamp01, deg, easeInOut, hump, lerp, type Pt } from './carlArt';
import {
  GROUND_Y,
  ballLiftForRoll,
  type ArmAngles,
  type FootPose,
  type RatKinPose,
  type RatKinView,
  drawRatKinAway,
  drawRatKinFront,
  drawRatKinSide,
  REST_FOOT_PITCH,
  REST_TAIL_BASE,
  REST_TAIL_CURL,
  restingPose,
} from './ratKinArt';
import { type FigureDef, figureStates } from '../figure/figureDef';

// ── Cell geometry ───────────────────────────────────────────────

/** Tile size the art is drawn at; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;
/**
 * How far down its own tile a figure's feet sit. Matched to Carl and the cat: a
 * floor-standing creature belongs near the *bottom* of the tile it occupies, and
 * anchoring the soles on the tile's centre instead floats him half a tile above
 * the floor everything else stands on.
 */
export const GROUND_OFFSET_IN_TILE = 0.9;

/**
 * The cell the poses are painted into, and where his own tile sits inside it.
 *
 * These four numbers were measured by the bake this figure replaces — the widest
 * pose plus padding, quantised — and `scripts/parity-figure-sheet.ts` is what
 * proved the painter still fills exactly that cell. The gates re-check that
 * nothing paints against the edge, which is what would say a pose has outgrown
 * them.
 */
const FRAME_WIDTH = 96;
const FRAME_HEIGHT = 104;
const TILE_X = 16;
const TILE_Y = 33;

/** Poses are painted with the ground line under the cell's centre. */
export const ORIGIN_X = FRAME_WIDTH / 2;
export const ORIGIN_Y = TILE_Y + TILE_SCALE * GROUND_OFFSET_IN_TILE;

/**
 * How much of a tile he fills, scaled about his own ground line so his feet stay
 * on the tile they belong to.
 *
 * Set just under the player's own height: Mordecai is a hunched advisor the
 * player walks up to and talks down to slightly, and a safe-room NPC that towers
 * over the crawler reads as a boss.
 */
export const RAT_KIN_SCALE = 0.66;

export const WALK_FRAMES = 16;
export const IDLE_FRAMES = 8;

// ── Pose helpers ─────────────────────────────────────────────────────────────

function pt(x: number, y: number): Pt {
  return { x, y };
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

/**
 * A one-shot hump centred on `at`, expressed in cycle phase — the blink, the
 * sniff and the ear twitch all ride on it.
 *
 * The half is load-bearing. `hump` is a sine over the unit interval, so it is
 * zero at *both* ends: feeding it the raw `1 - distance/width` returns 0 at
 * distance 0, which is the exact centre of the event. The curve then peaks at
 * half the window on either side and the whole thing plays inside out — two
 * flutters with the eye wide open at the moment it should be shut.
 */
function pulseAt(phase: number, at: number, width: number): number {
  const distance = Math.abs(((phase - at + 1.5) % 1) - 0.5);
  return distance > width ? 0 : hump(HUMP_PEAK * (1 - distance / width));
}

/** Where `hump` reaches 1. */
const HUMP_PEAK = 0.5;

/** Loops sample the cycle evenly, so the last frame does not repeat the first. */
function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

function wave(phase: number): number {
  return Math.sin(phase * Math.PI * 2);
}

/**
 * How far forward the near-side arm is, −1 fully back to +1 fully forward.
 *
 * Cosine, not sine, and the difference is a quarter of a cycle. Phase 0 is the
 * near foot's *contact*, where it is furthest forward — and at contact a walker's
 * same-side arm is at its furthest *back*, which is −1. Driven off `wave` the
 * arm sits neutral at contact and peaks at mid-stance instead: the arms then
 * swing 90° out of step with the legs, which reads as a shuffle even though
 * every individual limb is moving correctly.
 */
function armSwingDrive(phase: number): number {
  return -Math.cos(phase * Math.PI * 2);
}

// ── The gait ─────────────────────────────────────────────────────────────────

/**
 * Half the distance the ball of a foot travels while it is planted.
 *
 * Short, and it has to be. His thigh and shank together only just span the hip
 * to a hock set well back by the metatarsus, so a foot planted much further out
 * is beyond the leg's reach: the IK clamps, the leg locks straight, and the next
 * frame's tuck snaps the knee back in — the hitch that reads as a hop. The
 * reach-headroom gate is what keeps this number honest.
 */
const STRIDE = 0.163;

/**
 * The metatarsus' lean through stance. A digitigrade foot lands well up on its
 * toes, settles as the weight comes over it, and rocks back up onto them to push
 * off — so the pitch rises and falls once per stance rather than sweeping one
 * way as a human heel-to-toe roll does.
 */
const CONTACT_PITCH = deg(26);
const MID_STANCE_PITCH = deg(46);
const MID_STANCE_AT = 0.45;
const TOE_OFF_PITCH = deg(12);

/**
 * Negative, and that is the whole tuck: a pitch below zero swings the hock
 * *forward* of the ball, folding the foot up behind the leg the way a scurrying
 * animal's does. Held positive through the swing the hock trails behind him and
 * the leg has to stretch past its own reach to keep up.
 */
const TUCK_PITCH = deg(-26);
const PASS_PITCH = deg(2);
const REACH_PITCH = deg(18);

/**
 * The toe-off roll: how far the toes pitch down about the ball at the end of
 * stance, and where in stance the roll starts.
 *
 * This is what makes the leg read as digitigrade rather than merely as bent. The
 * metatarsus' own pitch swings the hock, but the foot below it stays flat on the
 * floor for the whole stance without this — and a foot that never rocks onto its
 * pads is a plantigrade foot however well the joints above it are drawn.
 */
const TOE_OFF_ROLL = deg(36);
const TOE_ROLL_STARTS_AT = 0.6;
/**
 * How far the ball rises as it rolls. Derived, not authored: it is exactly the
 * lift that keeps the toe pads on the floor while the ball comes up off it, so
 * the contact rolls forward instead of the whole foot leaving the ground.
 */
const TOE_OFF_LIFT = ballLiftForRoll(TOE_OFF_ROLL);
/** How far into the swing the toes unwind from the roll. */
const TOE_ROLL_RELEASE_AT = 0.22;

/** Foot heights through the swing, and where in it each one falls. */
const TOE_LIFT = 0.045;
const TOE_LIFT_AT = 0.12;
const TUCK_LIFT = 0.16;
const TUCK_AT = 0.32;
const PASS_LIFT = 0.11;
const PASS_AT = 0.55;
const REACH_LIFT = 0.03;
const REACH_AT = 0.8;

/** Where the swinging foot sits fore-and-aft at each of those beats. */
const TUCK_TRAIL = 0.72;
const REACH_LEAD = 0.8;

/**
 * The pelvis *drops* at contact rather than rising at mid-stance. His leg is
 * nearly as long as his hip is high, so a foot planted a stride ahead is out of
 * reach from the standing height; dropping the hip is what buys the stride, and
 * it is what a real pelvis does anyway.
 */
const WALK_BOB = 0.055;
/** He leans in a little further when he is actually going somewhere. */
const WALK_LEAN_GAIN = deg(3);
const FOOTFALLS_PER_CYCLE = 2;

/**
 * How much of the cycle a foot spends planted. Exported so the foot-slide gate
 * splits stance from swing the same way the gait does, rather than keeping its
 * own copy and silently measuring swing frames as stance.
 */
export const STANCE_FRACTION = 0.5;

/**
 * How far apart in the cycle the two feet contact.
 *
 * Always half a cycle, whatever the duty factor is — a symmetric biped puts its
 * feet down evenly spaced in time, and only the *overlap* changes when stance
 * gets longer. Reusing `STANCE_FRACTION` here works only because the two happen
 * to be equal today, and would quietly produce a limp the moment they weren't:
 * the foot-slide gate shares the same offset, so its stance windows would agree
 * with the broken pose stream and pass.
 */
export const CONTRALATERAL_PHASE = 0.5;

/** One foot of the profile gait. Phase 0 is this foot's contact. */
function gaitFootSide(phase: number): FootPose {
  const cycle = ((phase % 1) + 1) % 1;
  const stance = cycle < STANCE_FRACTION;
  const t = stance ? cycle / STANCE_FRACTION : (cycle - STANCE_FRACTION) / (1 - STANCE_FRACTION);

  if (stance) {
    // Planted: the pads hold still on the floor and the body travels over them.
    // Late in stance the ball rocks up off the floor and the contact rolls
    // forward onto the toes, which is the push-off.
    const roll = keyed(t, [
      [0, 0],
      [TOE_ROLL_STARTS_AT, 0],
      [1, TOE_OFF_ROLL],
    ]);
    return {
      ball: pt(lerp(STRIDE, -STRIDE, t), GROUND_Y - ballLiftForRoll(roll)),
      pitch: keyed(t, [
        [0, CONTACT_PITCH],
        [MID_STANCE_AT, MID_STANCE_PITCH],
        [1, TOE_OFF_PITCH],
      ]),
      kneeBreak: 1,
      toeCurl: 0,
      toeRoll: roll,
      foreshorten: 0,
      nearness: 0,
    };
  }
  // The swing starts where stance left off: ball already up on the toes, and the
  // roll unwinding over the first fifth of it.
  const lift = keyed(t, [
    [0, TOE_OFF_LIFT],
    [TOE_LIFT_AT, Math.max(TOE_LIFT, TOE_OFF_LIFT)],
    [TUCK_AT, TUCK_LIFT],
    [PASS_AT, PASS_LIFT],
    [REACH_AT, REACH_LIFT],
    [1, 0],
  ]);
  return {
    ball: pt(
      keyed(t, [
        [0, -STRIDE],
        [TUCK_AT, -STRIDE * TUCK_TRAIL],
        [PASS_AT, 0],
        [REACH_AT, STRIDE * REACH_LEAD],
        [1, STRIDE],
      ]),
      -lift,
    ),
    pitch: keyed(t, [
      [0, TOE_OFF_PITCH],
      [TUCK_AT, TUCK_PITCH],
      [PASS_AT, PASS_PITCH],
      [REACH_AT, REACH_PITCH],
      [1, CONTACT_PITCH],
    ]),
    kneeBreak: 1,
    // The toes curl under while the foot is off the floor and open again as it
    // reaches for the next contact.
    toeCurl: keyed(t, [
      [0, 0],
      [TUCK_AT, 1],
      [PASS_AT, 0.7],
      [REACH_AT, 0],
      [1, 0],
    ]),
    toeRoll: keyed(t, [
      [0, TOE_OFF_ROLL],
      [TOE_ROLL_RELEASE_AT, 0],
      [1, 0],
    ]),
    foreshorten: 0,
    nearness: 0,
  };
}

/**
 * Head-on the step reads only as height: almost none of the stride is visible,
 * the pitch is nearly invisible, and the leg has to be sold by the foot rising
 * and the shank widening rather than by any sideways travel.
 */
const FACING_LIFT_SHARE = 0.95;
const FACING_PITCH_SHARE = 0.5;
const FACING_STRIDE_DRIFT = 0.03;
/**
 * Feet stand under the hips. Any wider and the thighs have to angle out to reach
 * them, which reads as knock-kneed however subtle the joint itself is.
 */
const FACING_FOOT_SPREAD = 0.1;
/** The lift at which the swing leg's shank is drawn at full near-camera width. */
const FULLY_NEAR_LIFT = TUCK_LIFT * FACING_LIFT_SHARE;

/**
 * One foot of the head-on gait. `side` is +1 for the foot on the +X side of the
 * drawing and −1 for its pair.
 *
 * Both legs report `foreshorten: 1` — every head-on joint is a straight column.
 * A bow that shows on the planted leg and vanishes on the swinging one flickers
 * once per step and reads as a wiggle rather than as a walk.
 */
function gaitFootFacing(phase: number, side: number): FootPose {
  const cycle = ((phase % 1) + 1) % 1;
  const stance = cycle < STANCE_FRACTION;
  const t = stance ? cycle / STANCE_FRACTION : (cycle - STANCE_FRACTION) / (1 - STANCE_FRACTION);
  const home = side * FACING_FOOT_SPREAD;

  if (stance) {
    return {
      ball: pt(home + FACING_STRIDE_DRIFT * lerp(1, -1, t), GROUND_Y),
      pitch:
        keyed(t, [
          [0, CONTACT_PITCH],
          [MID_STANCE_AT, MID_STANCE_PITCH],
          [1, TOE_OFF_PITCH],
        ]) * FACING_PITCH_SHARE,
      kneeBreak: 1,
      toeCurl: 0,
      // The roll is a fore-aft rock, so head-on it has nothing to show.
      toeRoll: 0,
      foreshorten: 1,
      nearness: 0,
    };
  }
  const lift =
    keyed(t, [
      [0, 0],
      [TOE_LIFT_AT, TOE_LIFT],
      [TUCK_AT, TUCK_LIFT],
      [PASS_AT, PASS_LIFT],
      [REACH_AT, REACH_LIFT],
      [1, 0],
    ]) * FACING_LIFT_SHARE;
  return {
    ball: pt(home + FACING_STRIDE_DRIFT * lerp(-1, 1, easeInOut(t)), -lift),
    pitch:
      keyed(t, [
        [0, TOE_OFF_PITCH],
        [TUCK_AT, TUCK_PITCH],
        [PASS_AT, PASS_PITCH],
        [REACH_AT, REACH_PITCH],
        [1, CONTACT_PITCH],
      ]) * FACING_PITCH_SHARE,
    kneeBreak: 1,
    toeCurl: keyed(t, [
      [0, 0],
      [TUCK_AT, 1],
      [PASS_AT, 0.7],
      [REACH_AT, 0],
      [1, 0],
    ]),
    toeRoll: 0,
    foreshorten: 1,
    nearness: clamp01(lift / FULLY_NEAR_LIFT),
  };
}

// ── The arms ─────────────────────────────────────────────────────────────────

/**
 * Where a relaxed arm hangs, as joint angles rather than as a hand position.
 * Idle and walk both centre on this: different rest shapes make a figure visibly
 * tuck its arms in the moment it starts walking.
 */
const ARM_REST_UPPER = deg(-4);
/**
 * A big standing bend at the elbow, which is a rodent thing rather than a human
 * one — it carries the paws up in front of the belly instead of hanging them at
 * the hip, and it is most of what stops him reading as a small hairy man.
 */
const ARM_REST_FORE = deg(32);
/** Shoulder rotation at the top of the forward swing. */
const ARM_SWING_ANGLE = deg(26);
/** An arm swings further forward than back, so the backswing is scaled down. */
const ARM_BACKSWING_SHARE = 0.55;
/** How much of the shoulder's swing the forearm inherits. */
const FOREARM_FOLLOW = 0.22;
/** Standing, the arms drift by a fraction of the walk's swing. */
const IDLE_ARM_DRIFT = 0.12;

/**
 * One profile arm, driven from its joints. `forward` is −1 at the back of the
 * swing and +1 at the front.
 *
 * Almost all of a walking arm's travel belongs to the shoulder; the elbow keeps
 * a near-constant bend and the forearm barely sweeps. Placed by its hand the arm
 * cannot do that — both segments are forced to swing together and the forearm
 * ends up flailing at the full amplitude of the shoulder.
 */
function sideArmAngles(forward: number): ArmAngles {
  const signedSwing = forward >= 0 ? forward : forward * ARM_BACKSWING_SHARE;
  // Centred on the rest hang, exactly as the head-on swing is. Left uncentred
  // the whole cycle sits forward of where he stands and his arms visibly shift
  // the moment he steps off — the discontinuity both views exist to avoid.
  const swing = signedSwing + (1 - ARM_BACKSWING_SHARE) / 2;
  const upper = ARM_REST_UPPER + swing * ARM_SWING_ANGLE;
  // Edge-on the swing is all in the picture plane, so nothing foreshortens.
  return { upper, fore: upper * FOREARM_FOLLOW + ARM_REST_FORE, foreScale: 1 };
}

/**
 * Where a head-on arm hangs. Elbows out, paws in: the pair of tilts brings each
 * wrist inboard of its own shoulder root and up in front of the belly, which is
 * the rodent carriage and most of what stops him reading as a small hairy man.
 *
 * Two tilts, not one. The break at the elbow is what holds the arm off the ribs,
 * and a single angle either splays the whole arm or pins it to his side.
 */
const FACING_UPPER_TILT = deg(24);
/**
 * Not so far inboard that the two paws meet. Clasped at the belt they merge into
 * one blob, and together with the satchel strap they draw a bold X across his
 * chest that is the loudest thing on him at a 32px tile — louder than anything
 * that says rodent.
 */
const FACING_FOREARM_TILT = deg(-21);
/**
 * Head-on the upper arm is nearly end-on to the viewer and has almost nothing it
 * *can* show, so the forearm carries what visible travel there is — and even
 * that stays small.
 */
/**
 * Bigger than a head-on human's, and deliberately so. Carl's arms hang at his
 * sides, where a few degrees at the shoulder moves the hand a long way; these
 * are folded up in front of the chest, where the same few degrees move it
 * almost nowhere — the first pass had no visible arm swing at all head-on.
 */
const FACING_UPPER_SWING = deg(12);
const FACING_FOREARM_SWING = deg(26);
/** How much of its length the forearm loses at the front of the swing. */
const FACING_FOREARM_FORESHORTEN = 0.16;

/**
 * One head-on arm, as joint angles. `side` is +1 for the arm on the +X side of
 * the drawing; `swing` is positive as that arm comes forward.
 *
 * `forward` runs 0 at the back of the swing to 1 at the front and drives the
 * foreshortening: an arm swung at the camera turns out of the picture plane, so
 * its forearm draws shorter and carries the paw *up* the body. Without that the
 * paw tracks a flat arc at one height, which is the last thing that keeps a
 * head-on walk from looking like a walk.
 *
 * `forward` has to be a *remapped* swing, never a rectified one: folding the
 * negative half back up gives each arm two peaks per stride and the swing reads
 * at double speed however small the amplitude.
 */
function facingArmAngles(side: number, swing: number, forward: number): ArmAngles {
  return {
    upper: side * (FACING_UPPER_TILT + swing * FACING_UPPER_SWING),
    fore: side * (FACING_FOREARM_TILT + swing * FACING_FOREARM_SWING),
    foreScale: 1 - forward * FACING_FOREARM_FORESHORTEN,
  };
}

/** `side` is +1 for the arm that swings forward on the beat and −1 for its pair. */
function facingArmSwing(phase: number, side: number): ArmAngles {
  const own = armSwingDrive(phase) * side;
  const signedSwing = own >= 0 ? own : own * ARM_BACKSWING_SHARE;
  // Centred on the rest hang, so the average of the cycle is where his arms
  // stand. Left uncentred the whole swing sits inboard of the idle and he
  // visibly tucks his arms in the moment he starts walking.
  const swing = signedSwing - (1 - ARM_BACKSWING_SHARE) / 2;
  // 0 at the back of the swing, 1 at the front — one peak per stride. A
  // *rectified* swing would give each arm two peaks and read at double speed.
  const forward = (own + 1) / 2;
  return facingArmAngles(side, swing, forward);
}

/** The average of `forward` over a cycle, which is where a standing arm sits. */
const FACING_SWING_MIDPOINT = 0.5;

/** How tightly the paws are held; a scurrying rodent's are half-curled. */
const WALK_PAW_CURL = 0.55;
const IDLE_PAW_CURL = 0.35;

// ── The tail ─────────────────────────────────────────────────────────────────

// Imported rather than retyped: `drawFigure` re-aims the tail per view by adding
// the pose's *deviation* from this rest, so a copy that drifted would silently
// rotate the tail in every view at once.
const TAIL_BASE = REST_TAIL_BASE;
const TAIL_CURL = REST_TAIL_CURL;
/** How far the tail's root swings with the hips, counter to the near leg. */
const TAIL_STRIDE_SWING = deg(13);
const WALK_TAIL_WAVE = deg(3.4);
/**
 * The idle's secondary motion, and the one that survives the downsample: a body
 * breathing at a percent of its height is sub-pixel at a 32px tile, but a tail
 * tip swinging a few degrees at the end of a long lever is not.
 */
const IDLE_TAIL_WAVE = deg(5);
/**
 * The tail lags the body: its wave runs backward against the stride so the tip
 * is still finishing the last step while the hips start the next. A tail in
 * phase with the hips reads as a rudder bolted on.
 */
const TAIL_LAG_TURNS = -1;

function tailFor(phase: number, waveAmount: number, curl: number) {
  return {
    base: TAIL_BASE - wave(phase) * TAIL_STRIDE_SWING,
    curl,
    wave: waveAmount,
    phase: phase * Math.PI * 2 * TAIL_LAG_TURNS,
  };
}

// ── The head ─────────────────────────────────────────────────────────────────

/**
 * On the sampling grid of both cycles — 16 walk frames step 0.0625 and 8 idle
 * frames step 0.125, and 0.75 is a multiple of each. Off-grid the peak of the
 * blink falls between two frames and is never actually drawn.
 */
const BLINK_AT = 0.75;
const BLINK_WIDTH = 0.08;
const WALK_BLINK_WIDTH = 0.05;
/** He carries his head nose-down while walking, watching the floor ahead. */
const WALK_HEAD_PITCH = deg(4);
const WALK_HEAD_NOD = deg(2.5);
const WALK_HEAD_REACH = 0.02;
/**
 * The ears lag the head by a quarter cycle, so they are still settling from one
 * step as the next lands. Ears that bounce in time with the feet read as pinned.
 */
const EAR_LAG = 0.25;
const WALK_EAR_FLAP = deg(6);
const IDLE_EAR_TWITCH = deg(9);
const EAR_TWITCH_AT = 0.4;
const EAR_TWITCH_WIDTH = 0.11;
/** The far ear moves a shade less, which stops the pair reading as one shape. */
const FAR_EAR_SHARE = 0.7;

/** Everything the two walks share: timing, bob, head, ears, tail, hem. */
function walkBase(phase: number): RatKinPose {
  const pose = restingPose();
  // Two footfalls per cycle, so the drop happens twice — once under each foot.
  // A raised cosine rather than `1 - |sin|`: the rectified sine is flat for
  // several frames around its own peak, so the figure visibly stalls at the top
  // of each step, and it corners at the bottom instead of easing through it.
  pose.bob = (WALK_BOB * (1 + Math.cos(phase * Math.PI * 2 * FOOTFALLS_PER_CYCLE))) / 2;
  pose.lean += WALK_LEAN_GAIN;
  pose.nearPaw = WALK_PAW_CURL;
  pose.farPaw = WALK_PAW_CURL;
  pose.blink = pulseAt(phase, BLINK_AT, WALK_BLINK_WIDTH);
  pose.earNear = wave(phase - EAR_LAG) * WALK_EAR_FLAP;
  pose.earFar = pose.earNear * FAR_EAR_SHARE;
  pose.tail = tailFor(phase, WALK_TAIL_WAVE, TAIL_CURL);
  pose.hemSway = wave(phase);
  return pose;
}

function walkSide(phase: number): RatKinPose {
  const pose = walkBase(phase);
  pose.nearFoot = gaitFootSide(phase);
  pose.farFoot = gaitFootSide(phase + CONTRALATERAL_PHASE);

  const nearForward = armSwingDrive(phase);
  pose.nearArmAngles = sideArmAngles(nearForward);
  pose.farArmAngles = sideArmAngles(-nearForward);

  pose.headPitch = WALK_HEAD_PITCH + wave(phase * 2) * WALK_HEAD_NOD;
  pose.headReach = WALK_HEAD_REACH;
  return pose;
}

function walkFacing(phase: number, away: boolean): RatKinPose {
  const pose = walkBase(phase);
  pose.nearFoot = gaitFootFacing(phase, NEAR_SIDE);
  pose.farFoot = gaitFootFacing(phase + CONTRALATERAL_PHASE, FAR_SIDE);
  pose.nearArmAngles = facingArmSwing(phase, NEAR_SIDE);
  pose.farArmAngles = facingArmSwing(phase, FAR_SIDE);
  // Whole-row, not per-frame: an arm that changes sides partway through the
  // cycle pops at the shoulder. Toward the camera an arm is in front of the
  // chest for the whole swing; away from it, behind the back for the whole swing.
  pose.nearArmBehind = away;
  pose.farArmBehind = away;
  // A nod and a lean are rotations about an axis pointing at the camera here, so
  // neither shows; the head-on step is carried by the legs and the shoulders.
  pose.headPitch = 0;
  pose.headReach = 0;
  return pose;
}

/** Which side of the drawing a limb is on, head-on. */
const NEAR_SIDE = 1;
const FAR_SIDE = -1;

/**
 * Standing still has to read as *alive*, not as swaying: every term here is
 * deliberately near the threshold of visibility at a 32px tile.
 */
/**
 * Small, but not invisible. At a third of this the whole idle measured under one
 * pixel of movement across all eight frames on the baked sheet — a statue, which
 * for a talkative advisor is the second thing a player notices.
 */
const BREATH_RISE = 0.024;
const BREATH_LEAN = deg(1.6);
const IDLE_HEAD_BOB = deg(3.2);
/**
 * Clear of the loop seam. The sniff is the punchiest thing in the idle, and its
 * window is wide — centred near phase 0 it is half-finished when the cycle
 * restarts, and the row pops once per loop.
 */
const SNIFF_AT = 0.3;
const SNIFF_WIDTH = 0.22;
const IDLE_HEAD_REACH = 0.012;

function idlePose(phase: number): RatKinPose {
  const pose = restingPose();
  const breath = wave(phase);
  const sniff = pulseAt(phase, SNIFF_AT, SNIFF_WIDTH);

  pose.bob = -BREATH_RISE * (breath * HUMP_PEAK + HUMP_PEAK);
  pose.lean += BREATH_LEAN * breath;
  pose.breath = breath;
  pose.blink = pulseAt(phase, BLINK_AT, BLINK_WIDTH);
  pose.sniff = sniff;
  pose.headPitch = breath * IDLE_HEAD_BOB - sniff * IDLE_HEAD_BOB;
  pose.headReach = sniff * IDLE_HEAD_REACH;

  const twitch = pulseAt(phase, EAR_TWITCH_AT, EAR_TWITCH_WIDTH);
  pose.earNear = -twitch * IDLE_EAR_TWITCH;
  pose.earFar = -twitch * IDLE_EAR_TWITCH * FAR_EAR_SHARE;

  pose.nearPaw = IDLE_PAW_CURL;
  pose.farPaw = IDLE_PAW_CURL;

  pose.tail = tailFor(phase, IDLE_TAIL_WAVE, TAIL_CURL + breath * IDLE_TAIL_CURL_DRIFT);
  return pose;
}

function idleSide(phase: number): RatKinPose {
  const pose = idlePose(phase);
  const drift = wave(phase) * IDLE_ARM_DRIFT;
  // The same joint angles the walk swings around, so stepping off from standing
  // cannot change the shape of his arms — only how much they move.
  pose.nearArmAngles = sideArmAngles(drift);
  pose.farArmAngles = sideArmAngles(-drift);
  return pose;
}

/**
 * A head-on standing foot. Straight columns, matching the head-on walk, so
 * standing up out of a step cannot pop the knees into a bow — and rooted under
 * the hips, because a wider stance angles the thighs out and reads knock-kneed.
 */
function standingFootFacing(side: number): FootPose {
  return {
    ball: pt(side * FACING_FOOT_SPREAD, GROUND_Y),
    pitch: REST_FOOT_PITCH_FACING,
    kneeBreak: 1,
    toeCurl: 0,
    toeRoll: 0,
    foreshorten: 1,
    nearness: 0,
  };
}

/**
 * Standing, the metatarsus leans at the camera, so only a fraction of its own
 * pitch projects into the picture. Carried over at full value the hock rides
 * visibly back from the toes on a leg that should read as a column.
 */
const REST_FOOT_PITCH_FACING = REST_FOOT_PITCH * FACING_PITCH_SHARE;

function idleFacing(phase: number, away: boolean): RatKinPose {
  const pose = idlePose(phase);
  const drift = wave(phase) * IDLE_ARM_DRIFT;
  pose.nearFoot = standingFootFacing(NEAR_SIDE);
  pose.farFoot = standingFootFacing(FAR_SIDE);
  // The mid-swing foreshortening, not zero: the walk's forearm averages this
  // over its cycle, and handing the idle a full-length forearm pops it 8% longer
  // the instant he stops — the same discontinuity the joint angles avoid.
  pose.nearArmAngles = facingArmAngles(NEAR_SIDE, drift, FACING_SWING_MIDPOINT);
  pose.farArmAngles = facingArmAngles(FAR_SIDE, -drift, FACING_SWING_MIDPOINT);
  pose.nearArmBehind = away;
  pose.farArmBehind = away;
  pose.headPitch = 0;
  pose.headReach = 0;
  return pose;
}

const IDLE_TAIL_CURL_DRIFT = deg(11);

// ── Rows ─────────────────────────────────────────────────────────────────────

export interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly view: RatKinView;
  readonly pose: (frame: number) => RatKinPose;
}

export const RAT_KIN_ROWS: readonly RowSpec[] = [
  {
    name: 'walk',
    frameCount: WALK_FRAMES,
    view: 'front',
    pose: (f) => walkFacing(cyclePhase(f, WALK_FRAMES), false),
  },
  {
    name: 'walk_side',
    frameCount: WALK_FRAMES,
    view: 'side',
    pose: (f) => walkSide(cyclePhase(f, WALK_FRAMES)),
  },
  {
    name: 'walk_away',
    frameCount: WALK_FRAMES,
    view: 'away',
    pose: (f) => walkFacing(cyclePhase(f, WALK_FRAMES), true),
  },
  {
    name: 'idle',
    frameCount: IDLE_FRAMES,
    view: 'front',
    pose: (f) => idleFacing(cyclePhase(f, IDLE_FRAMES), false),
  },
  {
    name: 'idle_side',
    frameCount: IDLE_FRAMES,
    view: 'side',
    pose: (f) => idleSide(cyclePhase(f, IDLE_FRAMES)),
  },
  {
    name: 'idle_away',
    frameCount: IDLE_FRAMES,
    view: 'away',
    pose: (f) => idleFacing(cyclePhase(f, IDLE_FRAMES), true),
  },
];

/** Every pose the sheet is built from, in row-then-frame order. */
export function poseStream(): { row: RowSpec; frame: number; pose: RatKinPose }[] {
  return RAT_KIN_ROWS.flatMap((row) =>
    Array.from({ length: row.frameCount }, (_unused, frame) => ({
      row,
      frame,
      pose: row.pose(frame),
    })),
  );
}

// ── Painting ────────────────────────────────────────────────────

function rowNamed(state: string): RowSpec | undefined {
  return RAT_KIN_ROWS.find((row) => row.name === state);
}

/**
 * Paints one cell of the Rat Kin, in the cell's own pixels, with his ground line
 * on the cell's declared anchor.
 *
 * The figure scale is applied about that ground line rather than about the
 * origin, so shrinking him keeps his feet on the tile they belong to instead of
 * floating him above it.
 */
function paintRatKinFrame(ctx: CanvasRenderingContext2D, state: string, frame: number): void {
  const row = rowNamed(state);
  if (row === undefined) return;
  const pose = row.pose(frame);
  ctx.save();
  ctx.translate(ORIGIN_X, ORIGIN_Y);
  ctx.scale(TILE_SCALE, TILE_SCALE);
  ctx.translate(0, GROUND_Y);
  ctx.scale(RAT_KIN_SCALE, RAT_KIN_SCALE);
  ctx.translate(0, -GROUND_Y);
  if (row.view === 'front') drawRatKinFront(ctx, pose);
  else if (row.view === 'away') drawRatKinAway(ctx, pose);
  else drawRatKinSide(ctx, pose);
  ctx.restore();
}

function ratKinStateFrames(): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const row of RAT_KIN_ROWS) frames[row.name] = row.frameCount;
  return frames;
}

export const RAT_KIN_FIGURE: FigureDef = {
  id: 'rat_kin',
  frameWidth: FRAME_WIDTH,
  frameHeight: FRAME_HEIGHT,
  tileX: TILE_X,
  tileY: TILE_Y,
  tileScale: TILE_SCALE,
  states: figureStates(ratKinStateFrames()),
  paintFrame: paintRatKinFrame,
};
