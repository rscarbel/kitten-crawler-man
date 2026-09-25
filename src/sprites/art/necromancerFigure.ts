/**
 * Vordrick Boneharrow as a painted figure: the choreography, the row table,
 * the lantern's rim light and the fraying, and the `FigureDef` the runtime
 * cache and the review harness both draw through.
 *
 * Anatomy, palette and every stroke of paint live in `necromancerArt.ts`. The
 * art invariants live in `scripts/gates-necromancer.ts`, which the review
 * harness runs: `npm run render:necromancer`.
 *
 * Views. Locomotion, the idle and every attack aimed at something (the bolt,
 * the pulse) and the flinch are painted in all three views, because the
 * creature faces what it is doing. The raise, the blink and the death are
 * front-only: none of them is aimed, and the raise and the death are the two
 * moments the player most needs to see his face.
 */

import { allocCanvas, surfaceContext, type CanvasSurface } from '../../core/canvasSurface';
import { type FigureDef, figureStates } from '../figure/figureDef';
import { clamp01, deg, easeInOut, easeOut, hump, lerp, ramp, rgba, type Pt } from './carlArt';
import {
  NECROMANCER_RIM,
  SIDE_FREE_HAND,
  SIDE_STAFF_HAND,
  drawNecromancerBody,
  drawNecromancerGlow,
  drawNecromancerGround,
  hash01,
  paintedLanternPoint,
  restingPose,
  type NecromancerPose,
  type NecromancerView,
} from './necromancerArt';
import { hollowSoulPalette } from '../soulPalette';

type Ctx = CanvasRenderingContext2D;

const TWO_PI = Math.PI * 2;

function pt(x: number, y: number): Pt {
  return { x, y };
}

// ── Cell geometry ────────────────────────────────────────────────────────────

/** Tile size the art is drawn at; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;

/**
 * The cell. Wide enough for the lantern thrust forward in profile and the
 * glow round it; tall enough for the staff raised over his head in the raise.
 * The gates fail any pose whose ink reaches an edge.
 */
const FRAME_WIDTH = 224;
const FRAME_HEIGHT = 304;
/** Where his tile's top-left sits in the cell. */
const TILE_X = (FRAME_WIDTH - TILE_SCALE) / 2;
/** How far down the tile the ground line runs, matching the other bosses. */
export const GROUND_OFFSET_PX = 58;
/** Cell left clear below the ground line, for what is painted on the ground round his feet. */
const GROUND_MARGIN_PX = 20;
const TILE_Y = FRAME_HEIGHT - GROUND_MARGIN_PX - GROUND_OFFSET_PX;

export const POSE_ORIGIN_X = FRAME_WIDTH / 2;
export const POSE_ORIGIN_Y = TILE_Y + GROUND_OFFSET_PX;

/**
 * The rim light and the fraying are composed on scratch surfaces at the
 * density the cell is being painted at — read off the caller's transform, the
 * one thing a painter may read there — so the cache's bake (at the cell's own
 * size, or half on a low-end device) and a supersampled review sheet each do
 * the work their density needs, and the rim, sized in tiles, is the same light
 * at every density. Clamped so a degenerate
 * transform cannot allocate nothing or a wall of pixels.
 */
const MIN_DENSITY = 0.25;
const MAX_DENSITY = 4;

function densityOf(ctx: Ctx): number {
  const m = ctx.getTransform();
  const scale = Math.hypot(m.a, m.b);
  return Math.min(MAX_DENSITY, Math.max(MIN_DENSITY, Number.isFinite(scale) ? scale : 1));
}

// ── Row timing ───────────────────────────────────────────────────────────────

export const DRIFT_FRAMES = 12;
export const IDLE_FRAMES = 12;
export const CAST_RAISE_FRAMES = 16;
export const CAST_BOLT_FRAMES = 10;
export const CAST_PULSE_FRAMES = 14;
export const BLINK_FRAMES = 8;
export const HURT_FRAMES = 4;
export const DEATH_FRAMES = 20;

/** How far through the raise the dead are called up: the lantern's flare. */
export const CAST_RAISE_RELEASE_PROGRESS = 0.7;
/** How far through the bolt cast the volley leaves the lantern: the end of the thrust. */
export const CAST_BOLT_RELEASE_PROGRESS = 0.5;
/** How far through the pulse the staff foot strikes the ground. */
export const CAST_PULSE_PLANT_PROGRESS = 0.43;
/**
 * The pulse's channel hold: the frames from here to the end of the row loop
 * seamlessly for as long as the channel lasts, so the runtime can hold the
 * pose for any duration without a freeze.
 */
export const CAST_PULSE_CHANNEL_FROM = 8;

/** Named frames a system synchronises to. */
export type NecromancerRowEvent = 'release' | 'plant';

function eventFrame(frameCount: number, progress: number): number {
  return Math.min(frameCount - 1, Math.round(frameCount * progress));
}

/**
 * How far he drifts per loop of the drift row, in tiles. The runtime advances
 * the row by ground covered, so the hem ripples at the pace he actually moves.
 */
export const NECROMANCER_TILES_PER_DRIFT_CYCLE = 1.6;
/**
 * The least the drift row advances per tick while he is moving, in frames. A
 * nearly stationary drift would otherwise freeze the hem mid-ripple, which
 * reads as a statue sliding rather than cloth floating.
 */
export const NECROMANCER_MIN_DRIFT_FRAMES_PER_TICK = 0.08;
/**
 * The most, so a shove from the separation pass cannot spin the row past one
 * frame per tick and strobe.
 */
export const NECROMANCER_MAX_DRIFT_FRAMES_PER_TICK = 0.5;

/**
 * Advances the drift row's frame by the pixels he covered this tick.
 * Distance-driven, with a floor so the robe never freezes and a ceiling so it
 * never strobes.
 */
export function advanceDriftFrame(frame: number, pixelsMoved: number, tileSize: number): number {
  const tiles = pixelsMoved / tileSize;
  const raw = (tiles / NECROMANCER_TILES_PER_DRIFT_CYCLE) * DRIFT_FRAMES;
  const step = Math.min(
    NECROMANCER_MAX_DRIFT_FRAMES_PER_TICK,
    Math.max(NECROMANCER_MIN_DRIFT_FRAMES_PER_TICK, raw),
  );
  return (frame + step) % DRIFT_FRAMES;
}

// ── Choreography ─────────────────────────────────────────────────────────────

function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

function shotProgress(frame: number, frameCount: number): number {
  return (frame + 0.5) / frameCount;
}

/** Progress that lands exactly on 1 at the last frame, for a row whose last frame is held. */
function heldProgress(frame: number, frameCount: number): number {
  return frame / (frameCount - 1);
}

/** In profile the staff leans forward, ahead of him, rather than standing upright at his side. */
const SIDE_STAFF_LEAN = deg(6);
/** The staff's resting lean seen from the front or from behind. */
const FACING_STAFF_LEAN = deg(3);

function viewBase(view: NecromancerView): NecromancerPose {
  const pose = restingPose();
  if (view === 'side') {
    pose.staffHand = SIDE_STAFF_HAND;
    pose.freeHand = SIDE_FREE_HAND;
    pose.staffAngle = SIDE_STAFF_LEAN;
  }
  pose.staffGrip = plantedGrip(pose);
  return pose;
}

/** The grip that stands the staff's foot on the ground from where the hand holds it. */
function plantedGrip(pose: NecromancerPose): number {
  return -pose.staffHand.y / Math.cos(pose.staffAngle);
}

/** How far the drift's lantern swings, and how far behind the body it trails. */
const DRIFT_LANTERN_SWING = deg(16);
const DRIFT_LANTERN_LAG = 0.18;
const DRIFT_BOB = 0.035;
const DRIFT_SWAY = 0.03;
/** He carries the staff just clear of the ground while he drifts. */
const DRIFT_STAFF_LIFT = 0.06;
/** How far behind the body's sway the hem swings, in radians of the cycle. */
const DRIFT_HEM_LAG = 0.9;
/** The hem rests trailing a little behind him, and swings about that. */
const DRIFT_HEM_TRAIL_REST = -0.3;
const DRIFT_HEM_TRAIL_SWING = 0.9;
const DRIFT_STAFF_ROCK = deg(5);
const DRIFT_STOOP_SIDE = 0.55;
const DRIFT_STOOP_FACING = 0.3;
const DRIFT_HEAD_NOD = deg(2);
const DRIFT_FREE_HAND_SWING = 0.02;

function driftPose(view: NecromancerView, t: number): NecromancerPose {
  const pose = viewBase(view);
  const phase = t * TWO_PI;
  pose.hemPhase = t;
  pose.hemRipple = 1;
  pose.hemTrail = DRIFT_HEM_TRAIL_REST + Math.sin(phase - DRIFT_HEM_LAG) * DRIFT_HEM_TRAIL_SWING;
  // A glide rises and settles twice a loop; a walk's bob would put feet under him.
  pose.bob = -DRIFT_BOB * (0.5 + 0.5 * Math.cos(phase * 2));
  pose.sway = Math.sin(phase) * DRIFT_SWAY;
  pose.lanternSwing = Math.sin((t - DRIFT_LANTERN_LAG) * TWO_PI) * DRIFT_LANTERN_SWING;
  pose.staffGrip -= DRIFT_STAFF_LIFT;
  pose.staffAngle += Math.sin(phase) * DRIFT_STAFF_ROCK;
  pose.stoop = view === 'side' ? DRIFT_STOOP_SIDE : DRIFT_STOOP_FACING;
  pose.headTilt += Math.sin(phase) * DRIFT_HEAD_NOD;
  pose.freeHand = pt(pose.freeHand.x + Math.sin(phase) * DRIFT_FREE_HAND_SWING, pose.freeHand.y);
  return pose;
}

const IDLE_BREATH = 0.28;
const IDLE_HEAD_TILT = deg(6);
const IDLE_LANTERN_SWING = deg(4);

/**
 * Where in its own cycle the idle row starts. Every term is periodic, so the
 * loop closes wherever it starts; starting it on the breath's turning point
 * puts the seam on the slowest step rather than the fastest.
 */
const IDLE_START_PHASE = 0.25;

/**
 * The idle's slower terms. Each runs at its own phase offset (in radians) from
 * the breath, so no two peak together and the loop never reads as one pendulum.
 */
const IDLE_MOTION = {
  headTiltPhase: 1.1,
  headTurn: 0.3,
  headTurnPhase: 0.4,
  bob: 0.006,
  stoopRest: 0.15,
  stoopSwing: 0.12,
  stoopPhase: 0.5,
  hemRipple: 0.25,
  lanternPhase: 0.6,
  freeHandSpreadRest: 0.2,
  /** Once a loop the free hand opens a little, then closes again. */
  freeHandSpreadGesture: 0.4,
  gestureFrom: 0.45,
  gestureTo: 0.8,
} as const;

function idlePose(view: NecromancerView, t: number): NecromancerPose {
  const pose = viewBase(view);
  const phase = (t + IDLE_START_PHASE) * TWO_PI;
  pose.lanternGlow = 1 + Math.sin(phase) * IDLE_BREATH;
  // The head tilts on its own slow beat, off the lantern's, so the loop never
  // settles into one pendulum.
  pose.headTilt += Math.sin(phase + IDLE_MOTION.headTiltPhase) * IDLE_HEAD_TILT;
  pose.headTurn = Math.sin(phase * 2 + IDLE_MOTION.headTurnPhase) * IDLE_MOTION.headTurn;
  pose.bob = Math.sin(phase) * IDLE_MOTION.bob;
  pose.stoop =
    IDLE_MOTION.stoopRest + Math.sin(phase + IDLE_MOTION.stoopPhase) * IDLE_MOTION.stoopSwing;
  pose.hemPhase = t;
  pose.hemRipple = IDLE_MOTION.hemRipple;
  pose.lanternSwing = Math.sin(phase - IDLE_MOTION.lanternPhase) * IDLE_LANTERN_SWING;
  pose.freeHandSpread =
    IDLE_MOTION.freeHandSpreadRest +
    hump(ramp(t, IDLE_MOTION.gestureFrom, IDLE_MOTION.gestureTo)) *
      IDLE_MOTION.freeHandSpreadGesture;
  return pose;
}

/** The raised staff hand: over his head, the staff held high. */
const RAISE_STAFF_HAND = pt(0.44, -2.66);
const RAISE_SWEEP_FROM = pt(-0.62, -0.95);
const RAISE_SWEEP_TO = pt(-0.1, -0.72);
/** Where the free hand comes to rest once the dead are up. */
const RAISE_SETTLE_HAND = pt(-0.2, -1.2);

/** The raise's timing windows, as row progress, and its pose extremes. */
const CAST_RAISE = {
  liftFrom: 0.05,
  liftTo: 0.45,
  settleFrom: 0.85,
  /** How much of the lift he gives back as he settles; the staff stays partly raised. */
  settleDrop: 0.6,
  staffAngleRaised: deg(-8),
  stoopRaised: -0.9,
  bobRaised: -0.05,
  reachFrom: 0.1,
  reachTo: 0.4,
  /** The sweep finishes just after the release, so the dead rise under a moving hand. */
  sweepOverrun: 0.05,
  spreadRest: 0.3,
  spreadGesture: 0.7,
  spreadFrom: 0.1,
  spreadTo: 0.95,
  flareLead: 0.25,
  flareTail: 0.2,
  flareGlow: 1.2,
  lanternSwingCycles: 1.5,
  lanternSwing: deg(14),
  hemRippleRest: 0.5,
  hemTrailPerFlare: 0.5,
  headTiltLowered: deg(-4),
  headTiltRaised: deg(6),
} as const;

function castRaisePose(p: number): NecromancerPose {
  const pose = viewBase('front');
  const lift =
    easeInOut(ramp(p, CAST_RAISE.liftFrom, CAST_RAISE.liftTo)) *
    (1 - easeInOut(ramp(p, CAST_RAISE.settleFrom, 1)) * CAST_RAISE.settleDrop);
  pose.staffHand = pt(
    lerp(pose.staffHand.x, RAISE_STAFF_HAND.x, lift),
    lerp(pose.staffHand.y, RAISE_STAFF_HAND.y, lift),
  );
  pose.staffAngle = lerp(FACING_STAFF_LEAN, CAST_RAISE.staffAngleRaised, lift);
  pose.stoop = lerp(0, CAST_RAISE.stoopRaised, lift);
  pose.bob = CAST_RAISE.bobRaised * lift;
  // The free hand drops out wide, then sweeps low across in front, palm down:
  // calling the dead up out of the ground rather than pointing at the sky.
  const reach = easeInOut(ramp(p, CAST_RAISE.reachFrom, CAST_RAISE.reachTo));
  const sweep = easeInOut(
    ramp(p, CAST_RAISE.reachTo, CAST_RAISE_RELEASE_PROGRESS + CAST_RAISE.sweepOverrun),
  );
  const out = pt(
    lerp(pose.freeHand.x, RAISE_SWEEP_FROM.x, reach),
    lerp(pose.freeHand.y, RAISE_SWEEP_FROM.y, reach),
  );
  pose.freeHand = pt(lerp(out.x, RAISE_SWEEP_TO.x, sweep), lerp(out.y, RAISE_SWEEP_TO.y, sweep));
  const settle = easeInOut(ramp(p, CAST_RAISE.settleFrom, 1));
  pose.freeHand = pt(
    lerp(pose.freeHand.x, RAISE_SETTLE_HAND.x, settle),
    lerp(pose.freeHand.y, RAISE_SETTLE_HAND.y, settle),
  );
  pose.freeHandSpread =
    CAST_RAISE.spreadRest +
    CAST_RAISE.spreadGesture * hump(ramp(p, CAST_RAISE.spreadFrom, CAST_RAISE.spreadTo));
  const flare = hump(
    ramp(
      p,
      CAST_RAISE_RELEASE_PROGRESS - CAST_RAISE.flareLead,
      CAST_RAISE_RELEASE_PROGRESS + CAST_RAISE.flareTail,
    ),
  );
  pose.lanternGlow = 1 + flare * CAST_RAISE.flareGlow;
  pose.lanternSwing =
    Math.sin(p * TWO_PI * CAST_RAISE.lanternSwingCycles) * CAST_RAISE.lanternSwing * (1 - p);
  pose.hemPhase = p;
  pose.hemRipple = CAST_RAISE.hemRippleRest + flare;
  pose.hemTrail = -flare * CAST_RAISE.hemTrailPerFlare;
  pose.headTilt = lerp(CAST_RAISE.headTiltLowered, CAST_RAISE.headTiltRaised, lift);
  return pose;
}

/** The bolt's timing, as row progress either side of the release, shared by every view. */
const CAST_BOLT = {
  /** The thrust is this short a snap before the release; the draw is everything before it. */
  thrustLead: 0.12,
  recoverDelay: 0.12,
  flareLead: 0.15,
  flareTail: 0.25,
  flareGlow: 0.7,
  hemRippleRest: 0.4,
  hemRipplePerThrust: 0.5,
} as const;

/** The bolt in profile: drawn back and up, then thrust forward toward the target. */
const CAST_BOLT_SIDE = {
  handRestX: 0.52,
  handDrawnX: 0.42,
  handThrustX: 0.12,
  handRestY: -1.32,
  handDrawnY: -1.5,
  handThrustY: 0.05,
  staffDrawLean: deg(8),
  staffThrustLean: deg(40),
  staffGrip: 1.95,
  stoopRest: 0.2,
  stoopPerThrust: 0.5,
  stoopPerDraw: 0.3,
  lanternThrustSwing: deg(25),
  lanternDrawSwing: deg(10),
  freeHandRestX: 0.05,
  freeHandDrawX: 0.08,
  freeHandY: -1.18,
  hemTrailPerThrust: 0.6,
} as const;

/** The bolt seen from the front: thrust at the camera. */
const CAST_BOLT_FRONT = {
  handRestX: 0.4,
  handDrawnX: 0.46,
  handThrustX: 0.22,
  handRestY: -1.5,
  handDrawnY: -1.8,
  handThrustY: 0.25,
  staffDrawLean: deg(10),
  staffThrustLean: deg(14),
  foreshortenPerThrust: 0.42,
  lanternGrowth: 0.45,
  stoopPerThrust: 0.9,
  stoopPerDraw: 0.6,
  bobPerDraw: 0.03,
  lanternDrawSwing: deg(12),
  lanternThrustSwing: deg(6),
  pointingHand: pt(-0.3, -1.62),
  spreadRest: 0.2,
  spreadPerThrust: 0.8,
} as const;

/** The bolt seen from behind: thrust away from the camera. */
const CAST_BOLT_AWAY = {
  handRestX: 0.4,
  handDrawnX: 0.46,
  handThrustX: 0.1,
  handRestY: -1.5,
  handDrawnY: -1.62,
  handThrustY: 0.3,
  staffDrawLean: deg(12),
  staffThrustLean: deg(10),
  foreshortenPerThrust: 0.3,
  lanternShrink: 0.22,
  stoopPerThrust: 0.9,
  stoopPerDraw: 0.5,
  swayPerThrust: 0.04,
  lanternDrawSwing: deg(12),
} as const;

function castBoltPose(view: NecromancerView, p: number): NecromancerPose {
  const pose = viewBase(view);
  const release = CAST_BOLT_RELEASE_PROGRESS;
  const draw =
    easeInOut(ramp(p, 0, release - CAST_BOLT.thrustLead)) *
    (1 - easeOut(ramp(p, release - CAST_BOLT.thrustLead, release)));
  const thrust =
    easeOut(ramp(p, release - CAST_BOLT.thrustLead, release)) *
    (1 - easeInOut(ramp(p, release + CAST_BOLT.recoverDelay, 1)));
  const flare = hump(ramp(p, release - CAST_BOLT.flareLead, release + CAST_BOLT.flareTail));
  pose.lanternGlow = 1 + flare * CAST_BOLT.flareGlow;
  pose.hemPhase = p;
  pose.hemRipple = CAST_BOLT.hemRippleRest + thrust * CAST_BOLT.hemRipplePerThrust;
  if (view === 'side') {
    const side = CAST_BOLT_SIDE;
    pose.staffHand = pt(
      lerp(side.handRestX, side.handDrawnX, draw) + thrust * side.handThrustX,
      lerp(side.handRestY, side.handDrawnY, draw) - thrust * side.handThrustY,
    );
    pose.staffAngle = SIDE_STAFF_LEAN - draw * side.staffDrawLean + thrust * side.staffThrustLean;
    pose.staffGrip = lerp(pose.staffGrip, side.staffGrip, Math.max(draw, thrust));
    pose.stoop = side.stoopRest + thrust * side.stoopPerThrust - draw * side.stoopPerDraw;
    pose.lanternSwing = -thrust * side.lanternThrustSwing + draw * side.lanternDrawSwing;
    pose.freeHand = pt(side.freeHandRestX - draw * side.freeHandDrawX, side.freeHandY);
    pose.hemTrail = -thrust * side.hemTrailPerThrust;
  } else if (view === 'front') {
    const front = CAST_BOLT_FRONT;
    // The staff tips toward the camera, so it shortens on screen and the
    // lantern comes down and grows.
    pose.staffHand = pt(
      lerp(front.handRestX, front.handDrawnX, draw) - thrust * front.handThrustX,
      lerp(front.handRestY, front.handDrawnY, draw) + thrust * front.handThrustY,
    );
    pose.staffAngle =
      FACING_STAFF_LEAN + draw * front.staffDrawLean - thrust * front.staffThrustLean;
    pose.staffForeshorten = thrust * front.foreshortenPerThrust;
    pose.lanternScale = 1 + thrust * front.lanternGrowth;
    pose.stoop = thrust * front.stoopPerThrust - draw * front.stoopPerDraw;
    pose.bob = -draw * front.bobPerDraw;
    pose.lanternSwing = draw * front.lanternDrawSwing - thrust * front.lanternThrustSwing;
    // The free hand points after the volley.
    pose.freeHand = pt(
      lerp(pose.freeHand.x, front.pointingHand.x, thrust),
      lerp(pose.freeHand.y, front.pointingHand.y, thrust),
    );
    pose.freeHandSpread = front.spreadRest + thrust * front.spreadPerThrust;
  } else {
    const away = CAST_BOLT_AWAY;
    // The staff rises and shrinks away from the camera, and the shoulders
    // hunch forward into it.
    pose.staffHand = pt(
      lerp(away.handRestX, away.handDrawnX, draw) - thrust * away.handThrustX,
      lerp(away.handRestY, away.handDrawnY, draw) - thrust * away.handThrustY,
    );
    pose.staffAngle = FACING_STAFF_LEAN + draw * away.staffDrawLean - thrust * away.staffThrustLean;
    pose.staffForeshorten = thrust * away.foreshortenPerThrust;
    pose.lanternScale = 1 - thrust * away.lanternShrink;
    pose.stoop = thrust * away.stoopPerThrust - draw * away.stoopPerDraw;
    pose.sway = thrust * away.swayPerThrust;
    pose.lanternSwing = draw * away.lanternDrawSwing;
  }
  return pose;
}

/** Where both hands hold the planted staff, and where its foot strikes. */
const PULSE_GRIP_FACING = pt(0.06, -1.5);
/**
 * From behind, the staff is planted beside him rather than in front: in front
 * it would be hidden by his own back, and the cracks with it.
 */
const PULSE_GRIP_AWAY = pt(0.34, -1.5);
const PULSE_GRIP_SIDE = pt(0.42, -1.5);
/** How high the staff is lifted before it is driven down. */
const PULSE_RAISE = 0.6;

/** The pulse's timing, as row progress either side of the plant, and its pose. */
const CAST_PULSE = {
  liftLead: 0.12,
  /** The drive down starts this far before the plant; the free hand joins the shaft over the same beat. */
  driveLead: 0.1,
  holdTail: 0.05,
  raisedTuck: 0.02,
  staffGrip: 1.52,
  sideStaffLean: deg(2),
  facingStaffLean: deg(0),
  freeHandTuckSide: 0.02,
  freeHandTuckFacing: 0.03,
  /** The free hand holds the shaft this far below the staff hand. */
  freeHandBelow: 0.2,
  freeHandSpread: 0.1,
  stoopHeld: 0.7,
  stoopPerLift: 0.5,
  bobPerLift: 0.04,
  bobPerHold: 0.03,
  cracksSpread: 0.2,
  crackFlicker: 0.12,
  glowPerHold: 0.5,
  glowFlicker: 0.25,
  lanternStrikeSwing: deg(14),
  /** How much of the strike's swing the hold damps out. */
  lanternHoldDamping: 0.8,
  lanternFlicker: deg(3),
  hemRippleRest: 0.3,
  hemRipplePerHold: 0.4,
  headFlicker: deg(3),
  /** Radians the head's flicker runs ahead of the lantern's, so the two never move as one. */
  headFlickerPhase: 1,
} as const;

function castPulsePose(view: NecromancerView, frame: number): NecromancerPose {
  const pose = viewBase(view);
  const p = shotProgress(frame, CAST_PULSE_FRAMES);
  const plant = CAST_PULSE_PLANT_PROGRESS;
  const grip =
    view === 'side' ? PULSE_GRIP_SIDE : view === 'away' ? PULSE_GRIP_AWAY : PULSE_GRIP_FACING;
  const lift =
    easeInOut(ramp(p, 0, plant - CAST_PULSE.liftLead)) *
    (1 - ramp(p, plant - CAST_PULSE.driveLead, plant));
  const down = ramp(p, plant - CAST_PULSE.driveLead, plant);
  const raised = pt(grip.x - CAST_PULSE.raisedTuck, grip.y - PULSE_RAISE);
  const planted = pt(grip.x, grip.y);
  const rest = pose.staffHand;
  const toRaised = pt(lerp(rest.x, raised.x, lift), lerp(rest.y, raised.y, lift));
  pose.staffHand =
    down > 0 ? pt(lerp(raised.x, planted.x, down), lerp(raised.y, planted.y, down)) : toRaised;
  pose.staffGrip = lerp(pose.staffGrip, CAST_PULSE.staffGrip, Math.max(lift, down));
  pose.staffAngle = view === 'side' ? CAST_PULSE.sideStaffLean : CAST_PULSE.facingStaffLean;
  // Both hands on the shaft through the channel: the free hand below the other.
  const hold = ramp(p, plant - CAST_PULSE.driveLead, plant + CAST_PULSE.holdTail);
  const freeHandTuck =
    view === 'side' ? CAST_PULSE.freeHandTuckSide : CAST_PULSE.freeHandTuckFacing;
  const onStaff = pt(pose.staffHand.x - freeHandTuck, pose.staffHand.y + CAST_PULSE.freeHandBelow);
  pose.freeHand = pt(
    lerp(pose.freeHand.x, onStaff.x, hold),
    lerp(pose.freeHand.y, onStaff.y, hold),
  );
  pose.freeHandSpread = CAST_PULSE.freeHandSpread;
  pose.freeArmInFront = view === 'side' && hold > 0.5;
  pose.stoop = lerp(0, CAST_PULSE.stoopHeld, hold) - lift * CAST_PULSE.stoopPerLift;
  pose.bob = -lift * CAST_PULSE.bobPerLift + hold * CAST_PULSE.bobPerHold;
  // The channel loops: a flicker whose period is the held frames exactly, so
  // the seam from the last frame back to the loop start is one ordinary step.
  const holdFrames = CAST_PULSE_FRAMES - CAST_PULSE_CHANNEL_FROM;
  const channelPhase =
    frame >= CAST_PULSE_CHANNEL_FROM ? (frame - CAST_PULSE_CHANNEL_FROM) / holdFrames : 0;
  const channel = frame >= CAST_PULSE_CHANNEL_FROM ? 1 : 0;
  pose.cracks =
    ramp(p, plant, plant + CAST_PULSE.cracksSpread) *
    (1 - channel * CAST_PULSE.crackFlicker * (1 - Math.cos(channelPhase * TWO_PI)) * 0.5);
  pose.lanternGlow =
    1 +
    hold * CAST_PULSE.glowPerHold +
    channel * Math.sin(channelPhase * TWO_PI) * CAST_PULSE.glowFlicker;
  pose.lanternSwing =
    -down * CAST_PULSE.lanternStrikeSwing * (1 - hold * CAST_PULSE.lanternHoldDamping) +
    channel * Math.sin(channelPhase * TWO_PI) * CAST_PULSE.lanternFlicker;
  pose.hemPhase = channel > 0 ? channelPhase : p;
  pose.hemRipple = CAST_PULSE.hemRippleRest + hold * CAST_PULSE.hemRipplePerHold;
  pose.headTilt +=
    channel *
    Math.sin(channelPhase * TWO_PI + CAST_PULSE.headFlickerPhase) *
    CAST_PULSE.headFlicker;
  return pose;
}

const BLINK_GLOW_PER_FRAY = 0.8;
const BLINK_HEM_RIPPLE = 0.6;
const BLINK_STOOP = 0.2;

function blinkPose(frame: number, out: boolean): NecromancerPose {
  const pose = idlePose('front', 0);
  // Out: whole on the first frame, gone on the last. In: the reverse.
  const p = frame / (BLINK_FRAMES - 1);
  pose.fray = out ? easeInOut(p) : 1 - easeInOut(p);
  pose.lanternGlow = 1 + pose.fray * BLINK_GLOW_PER_FRAY;
  pose.hemRipple = BLINK_HEM_RIPPLE;
  pose.hemPhase = p;
  pose.stoop = BLINK_STOOP;
  return pose;
}

/** Struck on frame 0, furthest back on frame 1, recovering after. */
const HURT_RECOIL_BY_FRAME: readonly number[] = [0.75, 1, 0.55, 0.2];

/** The flinch at full recoil. */
const HURT = {
  stoop: -1.3,
  bob: -0.03,
  swaySide: -0.14,
  swayFacing: -0.09,
  headTilt: deg(-24),
  headTurn: -0.6,
  lanternSwing: deg(28),
  /** The lantern lags the blow, so on the frame he is struck it has swung only this share. */
  lanternStruckShare: 0.6,
  lanternDim: 0.65,
  hemTrail: 0.8,
  hemRipple: 0.6,
  freeHandSpread: 0.9,
  freeHandBackX: 0.08,
  freeHandUpY: 0.15,
} as const;

function hurtPose(view: NecromancerView, frame: number): NecromancerPose {
  const pose = viewBase(view);
  const recoil = HURT_RECOIL_BY_FRAME[frame] ?? 0;
  pose.stoop = HURT.stoop * recoil;
  pose.bob = HURT.bob * recoil;
  pose.sway = (view === 'side' ? HURT.swaySide : HURT.swayFacing) * recoil;
  pose.headTilt += HURT.headTilt * recoil;
  pose.headTurn = HURT.headTurn * recoil;
  pose.lanternSwing = HURT.lanternSwing * recoil * (frame === 0 ? HURT.lanternStruckShare : 1);
  pose.lanternGlow = 1 - HURT.lanternDim * recoil;
  pose.hemTrail = HURT.hemTrail * recoil;
  pose.hemRipple = HURT.hemRipple;
  pose.hemPhase = frame / HURT_FRAMES;
  pose.freeHandSpread = HURT.freeHandSpread * recoil;
  pose.freeHand = pt(
    pose.freeHand.x - HURT.freeHandBackX * recoil,
    pose.freeHand.y - HURT.freeHandUpY * recoil,
  );
  return pose;
}

/**
 * The death's beats, as row progress, each overlapping the next: the recoil,
 * the cage bursting, the staff falling, the body collapsing and the mask
 * dropping last, then the hem stilling for the held final frame.
 */
const DEATH = {
  recoilTo: 0.2,
  stoop: -0.7,
  headTilt: deg(-12),
  glowPerRecoil: 0.8,
  lanternSwing: deg(20),
  burstFrom: 0.1,
  burstTo: 0.32,
  staffFallFrom: 0.18,
  staffFallTo: 0.55,
  collapseFrom: 0.26,
  collapseTo: 0.92,
  maskDropFrom: 0.45,
  maskDropTo: 0.9,
  freeHandX: -0.3,
  freeHandStandingY: -1.2,
  freeHandCollapsedY: -0.4,
  hemRipple: 0.5,
  hemStillFrom: 0.8,
  hemStillTo: 0.95,
} as const;

function deathPose(frame: number): NecromancerPose {
  const pose = viewBase('front');
  const p = heldProgress(frame, DEATH_FRAMES);
  const recoil = hump(ramp(p, 0, DEATH.recoilTo));
  pose.stoop = DEATH.stoop * recoil;
  pose.headTilt += DEATH.headTilt * recoil;
  pose.lanternGlow = 1 + recoil * DEATH.glowPerRecoil;
  pose.lanternSwing = DEATH.lanternSwing * recoil;
  pose.cageBurst = ramp(p, DEATH.burstFrom, DEATH.burstTo);
  pose.staffFall = ramp(p, DEATH.staffFallFrom, DEATH.staffFallTo);
  pose.collapse = easeInOut(ramp(p, DEATH.collapseFrom, DEATH.collapseTo));
  pose.maskDrop = ramp(p, DEATH.maskDropFrom, DEATH.maskDropTo);
  pose.freeHandSpread = 1 - pose.collapse;
  pose.freeHand = pt(
    DEATH.freeHandX,
    lerp(DEATH.freeHandStandingY, DEATH.freeHandCollapsedY, pose.collapse),
  );
  pose.hemRipple = DEATH.hemRipple * (1 - ramp(p, DEATH.hemStillFrom, DEATH.hemStillTo));
  pose.hemPhase = p * 2;
  return pose;
}

// ── Row table ────────────────────────────────────────────────────────────────

export type NecromancerAction =
  | 'drift'
  | 'idle'
  | 'cast_raise'
  | 'cast_bolt'
  | 'cast_pulse'
  | 'blink_out'
  | 'blink_in'
  | 'hurt'
  | 'death';

export type RowKind = 'loop' | 'oneShot' | 'held';

export interface NecromancerRowSpec {
  readonly name: string;
  readonly action: NecromancerAction;
  readonly view: NecromancerView;
  readonly frameCount: number;
  readonly kind: RowKind;
  readonly pose: (frame: number) => NecromancerPose;
  /** Frames a system synchronises to — where the payload of a cast leaves the lantern. */
  readonly eventFrames?: Readonly<Partial<Record<NecromancerRowEvent, number>>>;
  /** For a row whose tail loops while a channel is held: the first looping frame. */
  readonly loopFrom?: number;
}

const VIEW_SUFFIX: Readonly<Record<NecromancerView, string>> = {
  front: '',
  side: '_side',
  away: '_away',
};

/** The state name the runtime asks for, for an action seen from a view. */
export function necromancerStateName(action: NecromancerAction, view: NecromancerView): string {
  return `${action}${VIEW_SUFFIX[view]}`;
}

const ALL_VIEWS: readonly NecromancerView[] = ['front', 'side', 'away'];
const FRONT_ONLY: readonly NecromancerView[] = ['front'];

/** Which views each action is painted in. */
export const NECROMANCER_ACTION_VIEWS: Readonly<
  Record<NecromancerAction, readonly NecromancerView[]>
> = {
  drift: ALL_VIEWS,
  idle: ALL_VIEWS,
  cast_bolt: ALL_VIEWS,
  cast_pulse: ALL_VIEWS,
  hurt: ALL_VIEWS,
  cast_raise: FRONT_ONLY,
  blink_out: FRONT_ONLY,
  blink_in: FRONT_ONLY,
  death: FRONT_ONLY,
};

function rowsFor(
  action: NecromancerAction,
  frameCount: number,
  kind: RowKind,
  pose: (view: NecromancerView, frame: number) => NecromancerPose,
  extras: Pick<NecromancerRowSpec, 'eventFrames' | 'loopFrom'> = {},
): NecromancerRowSpec[] {
  return NECROMANCER_ACTION_VIEWS[action].map((view) => ({
    name: necromancerStateName(action, view),
    action,
    view,
    frameCount,
    kind,
    pose: (frame) => pose(view, frame),
    ...extras,
  }));
}

export const NECROMANCER_ROWS: readonly NecromancerRowSpec[] = [
  ...rowsFor('drift', DRIFT_FRAMES, 'loop', (v, f) => driftPose(v, cyclePhase(f, DRIFT_FRAMES))),
  ...rowsFor('idle', IDLE_FRAMES, 'loop', (v, f) => idlePose(v, cyclePhase(f, IDLE_FRAMES))),
  ...rowsFor(
    'cast_raise',
    CAST_RAISE_FRAMES,
    'oneShot',
    (_v, f) => castRaisePose(shotProgress(f, CAST_RAISE_FRAMES)),
    {
      eventFrames: { release: eventFrame(CAST_RAISE_FRAMES, CAST_RAISE_RELEASE_PROGRESS) },
    },
  ),
  ...rowsFor(
    'cast_bolt',
    CAST_BOLT_FRAMES,
    'oneShot',
    (v, f) => castBoltPose(v, shotProgress(f, CAST_BOLT_FRAMES)),
    {
      eventFrames: { release: eventFrame(CAST_BOLT_FRAMES, CAST_BOLT_RELEASE_PROGRESS) },
    },
  ),
  ...rowsFor('cast_pulse', CAST_PULSE_FRAMES, 'oneShot', castPulsePose, {
    eventFrames: { plant: eventFrame(CAST_PULSE_FRAMES, CAST_PULSE_PLANT_PROGRESS) },
    loopFrom: CAST_PULSE_CHANNEL_FROM,
  }),
  ...rowsFor('blink_out', BLINK_FRAMES, 'oneShot', (_v, f) => blinkPose(f, true)),
  ...rowsFor('blink_in', BLINK_FRAMES, 'oneShot', (_v, f) => blinkPose(f, false)),
  ...rowsFor('hurt', HURT_FRAMES, 'oneShot', hurtPose),
  ...rowsFor('death', DEATH_FRAMES, 'held', (_v, f) => deathPose(f)),
];

/**
 * Game ticks each frame of a row is held for. The creature plays the rows at
 * these rates and the preview scene plays them at the same ones, so the
 * harness never shows a speed the game does not. The drift is paced by ground
 * covered instead ({@link advanceDriftFrame}); its entry is the rate at a slow
 * walking pace, for the preview.
 *
 * The casts' wind-ups — every frame before the payload leaves — are the
 * attacks' telegraphs, and `scripts/gates-necromancer.ts` holds each to the
 * locked-telegraph floor.
 */
export const NECROMANCER_TICKS_PER_FRAME: Readonly<Record<NecromancerAction, number>> = {
  drift: 5,
  idle: 6,
  cast_raise: 5,
  cast_bolt: 5,
  cast_pulse: 4,
  blink_out: 4,
  blink_in: 4,
  hurt: 4,
  death: 5,
};

/** Ticks from the start of a row to the frame its event is first drawn on. */
export function necromancerTicksToEvent(
  row: NecromancerRowSpec,
  event: NecromancerRowEvent,
): number | undefined {
  const frame = row.eventFrames?.[event];
  return frame === undefined ? undefined : frame * NECROMANCER_TICKS_PER_FRAME[row.action];
}

export function necromancerRow(state: string): NecromancerRowSpec | undefined {
  return NECROMANCER_ROWS.find((row) => row.name === state);
}

// ── Rim light ────────────────────────────────────────────────────────────────

const CHANNELS = 4;
const ALPHA_OFFSET = 3;
/** Alpha at which a pixel counts as part of the solid silhouette. */
const SOLID_ALPHA = 128;

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

function rgbOf(triple: readonly [number, number, number]): Rgb {
  const [r, g, b] = triple;
  return { r, g, b };
}

const RIM_RGB = rgbOf(NECROMANCER_RIM);

/**
 * How deep the lantern's bounce light reaches in from the silhouette, in
 * tiles. Sized against the game tile: the art is drawn at 64 px a tile and
 * shown at 32, so a rim narrower than this is half a pixel in play and gone.
 */
const RIM_DEPTH_TILES = 0.032;
const RIM_SAMPLES = 8;
const RIM_ALPHA = 0.8;
/** The rim is full strength this close to the lantern… */
const RIM_NEAR_TILES = 0.25;
/** …and fades to its floor this far away, so it reads as a light and not an outline. */
const RIM_FAR_TILES = 1.25;
const RIM_FAR_SHARE = 0;
/** The broad spill of lantern light over the near side of the robes. */
const SPILL_ALPHA = 0.14;
const SPILL_REACH_TILES = 1.2;

function rimRgba(alpha: number): string {
  return `rgba(${RIM_RGB.r}, ${RIM_RGB.g}, ${RIM_RGB.b}, ${alpha})`;
}

/**
 * Lays the lantern's cold bounce light on the finished figure: an inner edge
 * band, strongest nearest the lantern and fading with distance from it, plus a
 * broad spill over the robe on that side. Built from the figure's own solid
 * alpha — eroded and subtracted — so it lands on the silhouette and never on
 * an internal seam.
 */
function applyRimLight(
  figure: CanvasSurface,
  cloth: CanvasSurface,
  lantern: Pt,
  unit: number,
  reach: number,
): void {
  // Both lights fade to nothing within a known distance of the lantern, so all
  // of the work is confined to the square round it — most of a tall cell is
  // out of the lantern's reach.
  const lightReach = Math.max(RIM_FAR_TILES, SPILL_REACH_TILES) * unit * reach;
  const left = Math.max(0, Math.floor(lantern.x - lightReach));
  const top = Math.max(0, Math.floor(lantern.y - lightReach));
  const right = Math.min(figure.width, Math.ceil(lantern.x + lightReach));
  const bottom = Math.min(figure.height, Math.ceil(lantern.y + lightReach));
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return;
  const local = pt(lantern.x - left, lantern.y - top);
  const outline = solidMask(figure, left, top, width, height);
  const clothMask = solidMask(cloth, left, top, width, height);

  // The band just inside the whole figure's outline, kept only where it is
  // cloth: the lantern lights the robe's edge, and neither the ivory nor a
  // hand tucked into a gap in the cloth should pick up a blue ring.
  const edge = allocCanvas(width, height);
  const edgeCtx = surfaceContext(edge);
  edgeCtx.drawImage(outline, 0, 0);
  const depth = RIM_DEPTH_TILES * unit;
  const eroded = allocCanvas(width, height);
  const erodedCtx = surfaceContext(eroded);
  erodedCtx.drawImage(outline, 0, 0);
  erodedCtx.globalCompositeOperation = 'destination-in';
  for (let i = 0; i < RIM_SAMPLES; i++) {
    const angle = (i / RIM_SAMPLES) * TWO_PI;
    erodedCtx.drawImage(outline, Math.cos(angle) * depth, Math.sin(angle) * depth);
  }
  edgeCtx.globalCompositeOperation = 'destination-out';
  edgeCtx.drawImage(eroded, 0, 0);
  edgeCtx.globalCompositeOperation = 'destination-in';
  edgeCtx.drawImage(clothMask, 0, 0);
  const fade = edgeCtx.createRadialGradient(
    local.x,
    local.y,
    RIM_NEAR_TILES * unit * reach,
    local.x,
    local.y,
    RIM_FAR_TILES * unit * reach,
  );
  fade.addColorStop(0, rgba('#ffffff', 1));
  fade.addColorStop(1, rgba('#ffffff', RIM_FAR_SHARE));
  edgeCtx.fillStyle = fade;
  edgeCtx.fillRect(0, 0, width, height);

  // The spill is drawn straight onto the cloth mask, which is then spent.
  const spillCtx = surfaceContext(clothMask);
  const spillGradient = spillCtx.createRadialGradient(
    local.x,
    local.y,
    0,
    local.x,
    local.y,
    SPILL_REACH_TILES * unit * reach,
  );
  spillGradient.addColorStop(0, rimRgba(SPILL_ALPHA));
  spillGradient.addColorStop(1, rimRgba(0));
  spillCtx.globalCompositeOperation = 'source-in';
  spillCtx.fillStyle = spillGradient;
  spillCtx.fillRect(0, 0, width, height);

  const ctx = surfaceContext(figure);
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.drawImage(clothMask, left, top);
  ctx.globalAlpha = RIM_ALPHA;
  ctx.drawImage(edge, left, top);
  ctx.restore();
}

/**
 * A window of a surface's silhouette, in the rim colour, keeping its alpha.
 * Built by compositing rather than by reading pixels back: a readback of a
 * cell this size is most of what a cell costs to paint.
 */
function solidMask(
  source: CanvasSurface,
  left: number,
  top: number,
  width: number,
  height: number,
): CanvasSurface {
  const mask = allocCanvas(width, height);
  const maskCtx = surfaceContext(mask);
  maskCtx.drawImage(source, -left, -top);
  maskCtx.globalCompositeOperation = 'source-in';
  maskCtx.fillStyle = rimRgba(1);
  maskCtx.fillRect(0, 0, width, height);
  return mask;
}

// ── Fraying ──────────────────────────────────────────────────────────────────

/** The grid the body frays on, in tiles. Coarse enough that a mote is a visible fleck at 32 px. */
const FRAY_CELL_TILES = 0.06;
/** How much of a fleck's turn is spent as a drifting mote before it fades. */
const MOTE_LIFE = 0.35;
const MOTE_RISE_TILES = 1.1;
const MOTE_RADIUS_TILES = 0.022;
/** Decimal places a mote's alpha is written with in its colour string. */
const MOTE_ALPHA_DECIMALS = 4;
/** How strongly the top of the body frays first; the rest is scatter. */
const FRAY_TOP_BIAS = 0.3;
/** The span of heights the top-first bias is measured over, in tiles. */
const FRAY_HEIGHT_TILES = 3;
/** Where in a fray cell ink is looked for, as fractions of the cell. */
const FRAY_PROBE_NEAR = 0.05;
const FRAY_PROBE_FAR = 0.95;
const FRAY_PROBE_MID = 0.5;
const FRAY_PROBES: readonly (readonly [number, number])[] = [
  [FRAY_PROBE_MID, FRAY_PROBE_MID],
  [FRAY_PROBE_NEAR, FRAY_PROBE_NEAR],
  [FRAY_PROBE_FAR, FRAY_PROBE_NEAR],
  [FRAY_PROBE_NEAR, FRAY_PROBE_FAR],
  [FRAY_PROBE_FAR, FRAY_PROBE_FAR],
  [FRAY_PROBE_MID, FRAY_PROBE_NEAR],
  [FRAY_PROBE_MID, FRAY_PROBE_FAR],
  [FRAY_PROBE_NEAR, FRAY_PROBE_MID],
  [FRAY_PROBE_FAR, FRAY_PROBE_MID],
];
/** Coprime strides that give every fray cell its own hash seed. */
const FRAY_SEED_COLUMN_STRIDE = 977;
const FRAY_SEED_ROW_STRIDE = 131;
/** Each erased cell overlaps its neighbours by this much, so no hairline of ink survives between them. */
const FRAY_ERASE_OVERLAP_PX = 0.5;
/** Hash salts, so a mote's drift and its colour are drawn independently of its turn. */
const MOTE_DRIFT_SALT = 3;
const MOTE_COLOUR_SALT = 5;
/** How far a mote wanders sideways, as a share of how far it has risen. */
const MOTE_DRIFT_SPREAD = 0.4;
/** Motes whose hash clears this take the core colour; the rest take the mid. */
const MOTE_CORE_THRESHOLD = 0.6;

/**
 * Frays the body into motes: each grid cell of solid ink is erased when the
 * fray passes its hashed turn, and drifts upward as a blue mote for a while
 * after. Run backwards (the fray falling) the motes converge and settle — the
 * blink back in. Deterministic: the order is a hash of the cell.
 */
function applyFray(figure: CanvasSurface, fray: number, unit: number, density: number): void {
  if (fray <= 0) return;
  const { width, height } = figure;
  const ctx = surfaceContext(figure);
  const { data } = ctx.getImageData(0, 0, width, height);
  const cell = FRAY_CELL_TILES * unit;
  const originX = POSE_ORIGIN_X * density;
  const originY = POSE_ORIGIN_Y * density;
  const motes: { x: number; y: number; life: number; seed: number }[] = [];
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000000';
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const cx = Math.min(width - 1, Math.floor((i + 0.5) * cell));
      const cy = Math.min(height - 1, Math.floor((j + 0.5) * cell));
      const alphaAt = (x: number, y: number): number =>
        data[
          (Math.min(height - 1, Math.floor(y)) * width + Math.min(width - 1, Math.floor(x))) *
            CHANNELS +
            ALPHA_OFFSET
        ];
      // Any ink at all in the cell frays with it — testing the centre alone
      // leaves the antialiased outline standing as a ghost once the body is gone.
      const inked = FRAY_PROBES.some(([px, py]) => alphaAt((i + px) * cell, (j + py) * cell) > 0);
      if (!inked) continue;
      const solid = alphaAt(cx, cy) >= SOLID_ALPHA;
      const seed = i * FRAY_SEED_COLUMN_STRIDE + j * FRAY_SEED_ROW_STRIDE;
      const heightShare = clamp01((originY - cy) / (FRAY_HEIGHT_TILES * unit));
      const turn = hash01(seed) * (1 - FRAY_TOP_BIAS) + heightShare * FRAY_TOP_BIAS;
      const order = 1 - turn;
      if (fray < order * (1 - MOTE_LIFE * 0.5)) continue;
      ctx.fillRect(i * cell, j * cell, cell + FRAY_ERASE_OVERLAP_PX, cell + FRAY_ERASE_OVERLAP_PX);
      const life = (fray - order * (1 - MOTE_LIFE * 0.5)) / MOTE_LIFE;
      if (solid && life < 1) motes.push({ x: cx - originX, y: cy - originY, life, seed });
    }
  }
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const { core, mid } = hollowSoulPalette;
  for (const mote of motes) {
    const rise = mote.life * MOTE_RISE_TILES * unit;
    const drift = (hash01(mote.seed + MOTE_DRIFT_SALT) - 0.5) * MOTE_DRIFT_SPREAD * rise;
    const x = originX + mote.x + drift;
    const y = originY + mote.y - rise;
    const alpha = clamp01(1 - mote.life);
    const colour = hash01(mote.seed + MOTE_COLOUR_SALT) > MOTE_CORE_THRESHOLD ? core : mid;
    ctx.fillStyle = `rgba(${colour[0]}, ${colour[1]}, ${colour[2]}, ${alpha.toFixed(MOTE_ALPHA_DECIMALS)})`;
    ctx.beginPath();
    ctx.arc(x, y, MOTE_RADIUS_TILES * unit, 0, TWO_PI);
    ctx.fill();
  }
  ctx.restore();
}

// ── Death motes ──────────────────────────────────────────────────────────────

const DEATH_MOTES = 18;

/** The death motes, in tiles and row progress. The salts keep each mote's hashes independent. */
const DEATH_MOTE = {
  startSalt: 200,
  angleSalt: 300,
  reachSalt: 400,
  /** The motes leave the cage staggered over this much of the burst. */
  startSpread: 0.3,
  /** How much burst-plus-collapse progress a mote lives through. */
  lifeSpan: 1.2,
  minReach: 0.25,
  reachSpread: 0.35,
  verticalSquash: 0.6,
  rise: 0.6,
  /** One mote in this many is the bright core colour. */
  coreEvery: 3,
  radiusScale: 1.2,
} as const;

/** The soul-light escaping the burst cage, rising and fading before the last frame. */
function paintDeathMotes(ctx: Ctx, pose: NecromancerPose, lantern: Pt): void {
  if (pose.cageBurst <= 0) return;
  const { core, mid } = hollowSoulPalette;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < DEATH_MOTES; i++) {
    const start = hash01(i + DEATH_MOTE.startSalt) * DEATH_MOTE.startSpread;
    const life = clamp01((pose.cageBurst + pose.collapse - start) / DEATH_MOTE.lifeSpan);
    if (life <= 0 || life >= 1) continue;
    const angle = hash01(i + DEATH_MOTE.angleSalt) * TWO_PI;
    const burstOut =
      easeOut(life) *
      (DEATH_MOTE.minReach + hash01(i + DEATH_MOTE.reachSalt) * DEATH_MOTE.reachSpread);
    const x = lantern.x + Math.cos(angle) * burstOut;
    const y =
      lantern.y + Math.sin(angle) * burstOut * DEATH_MOTE.verticalSquash - life * DEATH_MOTE.rise;
    const colour = i % DEATH_MOTE.coreEvery === 0 ? core : mid;
    ctx.fillStyle = `rgba(${colour[0]}, ${colour[1]}, ${colour[2]}, ${clamp01(1 - life).toFixed(MOTE_ALPHA_DECIMALS)})`;
    ctx.beginPath();
    ctx.arc(x, y, MOTE_RADIUS_TILES * DEATH_MOTE.radiusScale, 0, TWO_PI);
    ctx.fill();
  }
  ctx.restore();
}

// ── Painting a cell ──────────────────────────────────────────────────────────

function placeInCell(target: Ctx, density: number): void {
  target.translate(POSE_ORIGIN_X * density, POSE_ORIGIN_Y * density);
  target.scale(TILE_SCALE * density, TILE_SCALE * density);
}

/**
 * Paints one cell. The floor layer goes down first, then the body with its
 * rim and any fraying composed on a scratch surface of its own, then the
 * glow and the motes additively over the top. Composed apart because the rim
 * is built from the body's own alpha, and the floor and the glow must not be
 * part of that alpha.
 */
function paintNecromancerFrame(ctx: Ctx, state: string, frame: number): void {
  const row = necromancerRow(state);
  if (row === undefined) return;
  const pose = row.pose(frame);
  const density = densityOf(ctx);
  const unit = TILE_SCALE * density;
  const width = Math.ceil(FRAME_WIDTH * density);
  const height = Math.ceil(FRAME_HEIGHT * density);
  const lanternTiles = paintedLanternPoint(row.view, pose);
  const lanternPx = pt(
    POSE_ORIGIN_X * density + lanternTiles.x * unit,
    POSE_ORIGIN_Y * density + lanternTiles.y * unit,
  );

  // The floor and the glow go straight into the caller's cell, at its own
  // density; only the body, whose alpha the rim is built from, needs a surface
  // of its own.
  const inCell = (paint: () => void): void => {
    ctx.save();
    try {
      ctx.translate(POSE_ORIGIN_X, POSE_ORIGIN_Y);
      ctx.scale(TILE_SCALE, TILE_SCALE);
      paint();
    } finally {
      ctx.restore();
    }
  };
  inCell(() => {
    ctx.globalAlpha *= 1 - clamp01(pose.fray);
    drawNecromancerGround(ctx, row.view, pose);
  });

  const body = allocCanvas(width, height);
  const bodyCtx = surfaceContext(body);
  bodyCtx.save();
  placeInCell(bodyCtx, density);
  drawNecromancerBody(bodyCtx, row.view, pose);
  bodyCtx.restore();
  if (pose.cageBurst < 1) {
    const cloth = allocCanvas(width, height);
    const clothCtx = surfaceContext(cloth);
    clothCtx.save();
    placeInCell(clothCtx, density);
    drawNecromancerBody(clothCtx, row.view, pose, 'cloth');
    clothCtx.restore();
    applyRimLight(body, cloth, lanternPx, unit, lanternLight(pose));
  }
  applyFray(body, pose.fray, unit, density);
  ctx.drawImage(body, 0, 0, width / density, height / density);

  inCell(() => {
    drawNecromancerGlow(ctx, row.view, pose);
    paintDeathMotes(ctx, pose, lanternTiles);
  });
}

/** The last trace of light left once the cage has burst. */
const BURST_LANTERN_REACH = 0.05;
/** The glow below which the lantern's light reaches no less far. */
const LANTERN_GLOW_REACH_FLOOR = 0.5;
const DIM_LANTERN_REACH = 0.8;
const BRIGHT_LANTERN_REACH = 1.2;

/**
 * How far the lantern's light reaches, as a multiple of its resting reach.
 * Once the cage has burst there is no lantern left to light anything.
 */
function lanternLight(pose: NecromancerPose): number {
  const burst = clamp01(pose.cageBurst);
  const glowShare = clamp01(pose.lanternGlow - LANTERN_GLOW_REACH_FLOOR);
  return (
    lerp(1, BURST_LANTERN_REACH, burst) * lerp(DIM_LANTERN_REACH, BRIGHT_LANTERN_REACH, glowShare)
  );
}

function necromancerStateFrames(): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const row of NECROMANCER_ROWS) frames[row.name] = row.frameCount;
  return frames;
}

/**
 * His own cache ceiling, above the fleet's default. He is the one boss of the
 * assault and on screen for the whole of its last wave, and the rows that must
 * stay warm together through that fight — the drift, the idle and the flinch
 * in all three views, the blink, and the cast under way — come to about 25 MB
 * at his cell size, which the 24 MB default cannot hold without evicting the
 * row he is about to play; the rest is the room a finished cast holds until
 * the next one pushes it out. `scripts/gates-assault-residency.ts` holds each
 * staged set inside this.
 */
const NECROMANCER_BUDGET_MEGABYTES = 32;

export const NECROMANCER_FIGURE: FigureDef = {
  id: 'necromancer',
  frameWidth: FRAME_WIDTH,
  frameHeight: FRAME_HEIGHT,
  tileX: TILE_X,
  tileY: TILE_Y,
  tileScale: TILE_SCALE,
  states: figureStates(necromancerStateFrames()),
  paintFrame: paintNecromancerFrame,
  // The cell composes itself at the density it is painted at, antialiased;
  // a supersampled bake would only multiply that work four times over.
  skipSupersample: true,
  budgetMegabytes: NECROMANCER_BUDGET_MEGABYTES,
};

/** Every pose the figure paints, in row order — for gates that need no pixels. */
export function necromancerPoseStream(): {
  row: NecromancerRowSpec;
  frame: number;
  pose: NecromancerPose;
}[] {
  const stream: { row: NecromancerRowSpec; frame: number; pose: NecromancerPose }[] = [];
  for (const row of NECROMANCER_ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++)
      stream.push({ row, frame, pose: row.pose(frame) });
  }
  return stream;
}
