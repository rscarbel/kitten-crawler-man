/**
 * The two bomber goblins as painted figures: their rows, their choreography,
 * the cells they are baked into, and the `FigureDef`s the runtime cache and the
 * review harness both draw through.
 *
 * They share the goblin rig and its gore with the melee goblins but not their
 * rows. A bomber walks, runs, stands, flinches, lights its fuse, and lobs; the
 * black powder goblin also aims, holding its throw drawn back for the whole
 * lock so the player can read it coming.
 *
 * What a bomber holds changes inside a row: a stick or a bomb leaves the hand
 * on the throw's release frame, a fresh one is pulled from the bandolier or
 * the keg during the recovery, and the black powder goblin passes its bomb
 * between its hands. Each frame therefore says what each hand holds and
 * whether that fuse is burning, alongside its pose.
 *
 * Every figure is drawn facing +X; the runtime mirrors it for the other facing.
 * The art invariants live in `scripts/gates-goblins.ts`: `npm run render:goblins`.
 */

import {
  buildSkeleton,
  clamp01,
  deg,
  drawGoblin,
  easeIn,
  easeInOut,
  easeOut,
  hipJointOffset,
  hump,
  lerp,
  offHandWristAngle,
  offset,
  pt,
  restingPose,
  rotatePt,
  type GoblinBomberArchetype,
  type GoblinOverlay,
  type GoblinPose,
  type GoblinProp,
  type GoblinStyle,
  type Pt,
  type Skeleton,
} from './goblinArt';
import {
  BOMBER_SCALE,
  DYNAMITE_CANDLE_WICK,
  GOBLIN_BOMBER_STYLES,
  drawCandleFlame,
  drawEmber,
  drawFuseSpark,
  drawSmokeWisp,
  drawSparkBurst,
  slowMatchEmberAt,
} from './goblinBomberArt';
import {
  BLACK_POWDER_BOMB_FUSE_TIP,
  DYNAMITE_STICK_FUSE_TIP,
  makeBlackPowderBombProp,
  makeDynamiteStickProp,
} from './goblinWeapons';
import { gorePieces, type GorePiece } from './goblinGore';
import { GOBLIN_GORE_STATES, TILE_SCALE, cyclePhase, type RowSpec } from './goblinFigure';
import { type FigureDef, figureStates } from '../figure/figureDef';

const FULL_CYCLE = Math.PI * 2;
const HALF = 0.5;

// ── Rows ─────────────────────────────────────────────────────────────────────

/** Every row a bomber can be drawn in. Only the black powder goblin aims. */
export type GoblinBomberRow = 'walk' | 'run' | 'idle' | 'flinch' | 'light' | 'aim' | 'throw';

/** The rows a bomber plays as an action rather than as locomotion or rest. */
export type GoblinBomberActionRow = Extract<GoblinBomberRow, 'light' | 'aim' | 'throw'>;

interface BomberRowSpec extends RowSpec {
  readonly name: GoblinBomberRow;
}

const DYNAMITE_ROWS: readonly BomberRowSpec[] = [
  { name: 'walk', frameCount: 12, kind: 'loop' },
  { name: 'run', frameCount: 12, kind: 'loop' },
  { name: 'idle', frameCount: 16, kind: 'loop' },
  { name: 'flinch', frameCount: 5, kind: 'oneShot' },
  { name: 'light', frameCount: 12, kind: 'oneShot' },
  { name: 'throw', frameCount: 12, kind: 'oneShot' },
];

const BLACK_POWDER_ROWS: readonly BomberRowSpec[] = [
  { name: 'walk', frameCount: 12, kind: 'loop' },
  { name: 'run', frameCount: 12, kind: 'loop' },
  { name: 'idle', frameCount: 16, kind: 'loop' },
  { name: 'flinch', frameCount: 5, kind: 'oneShot' },
  { name: 'light', frameCount: 18, kind: 'oneShot' },
  { name: 'aim', frameCount: 10, kind: 'oneShot' },
  { name: 'throw', frameCount: 14, kind: 'oneShot' },
];

export const GOBLIN_BOMBER_ROWS: Readonly<Record<GoblinBomberArchetype, readonly BomberRowSpec[]>> =
  {
    dynamite: DYNAMITE_ROWS,
    black_powder: BLACK_POWDER_ROWS,
  };

/**
 * The sprite frames the two events the runtime keys off land on: the frame of
 * the light row the fuse catches on, and the frame of the throw row the bomb
 * leaves the hand on. The runtime's timing is derived from these, so the fuse
 * hisses and the projectile spawns on the frames the art shows it.
 */
export const GOBLIN_BOMBER_EVENT_FRAMES: Readonly<
  Record<GoblinBomberArchetype, { readonly fuseCatch: number; readonly release: number }>
> = {
  dynamite: { fuseCatch: 5, release: 5 },
  black_powder: { fuseCatch: 6, release: 4 },
};

/** Frames one of a bomber's rows holds. Throws on a row that bomber does not paint. */
export function goblinBomberRowFrameCount(
  archetype: GoblinBomberArchetype,
  row: GoblinBomberRow,
): number {
  return bomberRowByName(archetype, row).frameCount;
}

export function bomberRowByName(archetype: GoblinBomberArchetype, name: string): BomberRowSpec {
  const found = GOBLIN_BOMBER_ROWS[archetype].find((row) => row.name === name);
  if (found === undefined) throw new Error(`goblin_${archetype} paints no row "${name}"`);
  return found;
}

/** A one-shot samples the middle of each frame, so its last frame stops short of 1. */
function shotProgress(frame: number, frameCount: number): number {
  return (frame + HALF) / frameCount;
}

/** The progress the given event frame of a row lands on. */
function eventProgress(
  archetype: GoblinBomberArchetype,
  row: GoblinBomberRow,
  frame: number,
): number {
  return shotProgress(frame, goblinBomberRowFrameCount(archetype, row));
}

// ── What a frame holds ───────────────────────────────────────────────────────

/** What one frame shows beyond the body: what each hand holds and what is burning. */
export interface BomberFrame {
  readonly pose: GoblinPose;
  readonly nearHolds: boolean;
  readonly farHolds: boolean;
  /** Which hand's fuse is lit, if either. */
  readonly litFuse: 'near' | 'far' | null;
  /** 0–1: the flash where a fuse catches, painted on the burning fuse. */
  readonly burst: number;
  /**
   * 0–1 along a loop, driving the slow-match smoke's drift; null on a one-shot.
   * The wisp is drawn only on the loops, where it drifts round a closed cycle:
   * on a one-shot it would jump from the row's end back to the next row's start.
   */
  readonly smokeCycle: number | null;
  /** Seeds this frame's spark spray. */
  readonly sparkSeed: number;
}

// ── Shared geometry ──────────────────────────────────────────────────────────

/** The skeleton of the rest pose, which every hand position here is set off. */
function restSkeleton(style: GoblinStyle): Skeleton {
  return buildSkeleton(style, restingPose(style));
}

function fromShoulder(style: GoblinStyle, dx: number, dy: number): Pt {
  const shoulder = restSkeleton(style).nearShoulder;
  return pt(shoulder.x + dx, shoulder.y + dy);
}

function fromFarShoulder(style: GoblinStyle, dx: number, dy: number): Pt {
  const shoulder = restSkeleton(style).farShoulder;
  return pt(shoulder.x + dx, shoulder.y + dy);
}

function lerpPt(from: Pt, to: Pt, t: number): Pt {
  return pt(lerp(from.x, to.x, t), lerp(from.y, to.y, t));
}

/** Where a held thing's fuse burns, for a fist at `hand` turned to `angle`. */
function fuseTipAt(hand: Pt, angle: number, tip: Pt): Pt {
  const turned = rotatePt(tip, angle);
  return offset(hand, turned.x, turned.y);
}

/** A 0→1 ramp over `[from, to]`, eased at both ends. */
function ramp(progress: number, from: number, to: number): number {
  return easeInOut(clamp01((progress - from) / (to - from)));
}

/**
 * A foot that moves only while it is off the ground, stepping out over `out`
 * and home over `home`. A foot left on its stepped mark at the end of a row
 * jumps back to its rest mark on the first idle frame.
 */
function steppedFoot(
  base: number,
  distance: number,
  out: readonly [number, number],
  home: readonly [number, number],
  progress: number,
  lift: number,
): Pt {
  const step = (from: number, by: number, window: readonly [number, number]): Pt => {
    if (progress <= window[0]) return pt(from, 0);
    if (progress >= window[1]) return pt(from + by, 0);
    const t = (progress - window[0]) / (window[1] - window[0]);
    return pt(from + by * easeInOut(t), -lift * Math.sin(t * Math.PI));
  };
  if (progress < home[0]) return step(base, distance, out);
  return step(base + distance, -distance, home);
}

const STEP_LIFT = 0.05;

/** A foot that holds at `fromX` and steps to `toX` over `window`, moving only while it is off the ground. */
function stepTo(
  fromX: number,
  toX: number,
  window: readonly [number, number],
  progress: number,
  lift: number,
): Pt {
  if (progress <= window[0]) return pt(fromX, 0);
  if (progress >= window[1]) return pt(toX, 0);
  const t = (progress - window[0]) / (window[1] - window[0]);
  return pt(lerp(fromX, toX, easeInOut(t)), -lift * Math.sin(t * Math.PI));
}
/** By when a stepped foot is home: short of the last frame, so the hand-off to idle moves no foot. */
const STEP_HOME_BY = 0.95;

// ── Stances ──────────────────────────────────────────────────────────────────

/**
 * How far apart each bomber stands, as a multiple of the rig's own stance.
 * The black powder goblin plants itself wide, as a man braced under a load
 * does; the dynamite goblin stands narrow and up on its toes.
 */
const STANCE_WIDTH: Record<GoblinBomberArchetype, number> = {
  dynamite: 0.85,
  black_powder: 1.5,
};

/**
 * How far each bomber sinks its hips below the rig's stance, in tile units:
 * a stance this wide straightens the knees unless the hips come down with it.
 */
const STANCE_SINK: Record<GoblinBomberArchetype, number> = {
  dynamite: 0,
  black_powder: 0.035,
};

/**
 * Where each bomber's near hand hangs at rest, from its near shoulder. The
 * rig's own rest lets a goblin's long arm hang to its knee; the black powder
 * goblin carries its free hand bent at the hip and back off its belly,
 * where it would otherwise hide the bomb it cradles there.
 */
const NEAR_REST: Record<GoblinBomberArchetype, Pt | null> = {
  dynamite: null,
  black_powder: pt(-0.12, 0.42),
};

/**
 * Whether the near arm is laid under the far one at rest. The black powder
 * goblin cradles its bomb in the far arm across its belly, and its near arm
 * hanging over that would cut the bomb in two: at the tile the bomb is the
 * whole read, so it stays on top.
 */
const NEAR_ARM_UNDER_BOMB: Record<GoblinBomberArchetype, boolean> = {
  dynamite: false,
  black_powder: true,
};

function standingPose(archetype: GoblinBomberArchetype): GoblinPose {
  const style = GOBLIN_BOMBER_STYLES[archetype];
  const rest = restingPose(style);
  const width = STANCE_WIDTH[archetype];
  const nearRest = NEAR_REST[archetype];
  return {
    ...rest,
    nearFoot: pt(rest.nearFoot.x * width, 0),
    farFoot: pt(rest.farFoot.x * width, 0),
    nearHand: nearRest === null ? rest.nearHand : fromShoulder(style, nearRest.x, nearRest.y),
    bob: STANCE_SINK[archetype],
    nearArmUnderHead: NEAR_ARM_UNDER_BOMB[archetype],
    eyeOpen: 1,
  };
}

// ── Where the dynamite goblin holds its stick ────────────────────────────────

/**
 * The stick is held up in front of the chest, fuse up and fizzing by the face:
 * the manic goblin admiring the thing it is about to throw.
 */
const DYNAMITE_HOLD = { dx: 0.52, dy: 0.1, angle: deg(-58) } as const;
/** Ready to throw: the stick cocked beside the head, fuse up. */
const DYNAMITE_READY = { dx: -0.3, dy: -0.42, angle: deg(-100) } as const;
/** Wound back behind the head. */
const DYNAMITE_WOUND = { dx: -0.5, dy: -0.32, angle: deg(-165) } as const;
/** The release: high and out in front, the arm nearly straight. */
const DYNAMITE_RELEASE = { dx: 0.46, dy: -0.4, angle: deg(-35) } as const;
/** The follow-through, down and across in front of the body. */
const DYNAMITE_FOLLOW = { dx: 0.36, dy: 0.24, angle: deg(35) } as const;
/** Where the hand finds a fresh stick on the bandolier across its chest. */
const DYNAMITE_PLUCK = { dx: 0.06, dy: 0.12, angle: deg(-40) } as const;
/** The angle the stick is held at while it is touched to the candle: up and back over the head. */
const DYNAMITE_LIGHTING_ANGLE = deg(-112);

interface HandPlace {
  readonly dx: number;
  readonly dy: number;
  readonly angle: number;
}

function placeHand(style: GoblinStyle, place: HandPlace): Pt {
  return fromShoulder(style, place.dx, place.dy);
}

// ── Where the black powder goblin holds its bomb ─────────────────────────────

/**
 * The bomb cradled in front of the belly in the far hand, ball forward and fuse
 * up, held out clear of the body so its round outline and its fuse read at the
 * tile; the slow-match smoulders in the same fist.
 */
const CRADLE = { dx: 0.56, dy: 0.42, angle: deg(-30) } as const;
/** The free near fist at rest, knuckles down and forward. */
const FREE_HAND_ANGLE = deg(55);
/** Drawn back for the lock: bomb high over the back shoulder. */
const POWDER_DRAWN = { dx: -0.42, dy: -0.62, angle: deg(-120) } as const;
/** How much further back the drawn bomb creeps over the lock, so a held aim never reads as frozen. */
const POWDER_CREEP = pt(-0.05, 0.02);
/** The far arm thrown out at the target for the whole lock, in tile units from the far shoulder. */
const POWDER_POINT = pt(0.6, 0.12);
/** The pointing fist's turn: knuckles forward, near the turn it held the match at. */
const POWDER_POINT_ANGLE = deg(-15);
/** Where the pointing arm hauls down to as the throwing arm comes over: low in front of the belly. */
const POWDER_COUNTER = pt(0.3, 0.42);
/**
 * The black powder goblin's far arm is drawn over its body in every row: it
 * cradles the bomb at the belly, holds the match out, points at the target and
 * hauls down in front, and never once swings behind. A flag that changed
 * between rows would flip the arm through the body on the hand-off frame.
 */
const POWDER_FAR_ARM_IN_FRONT = true;
const POWDER_RELEASE = { dx: 0.5, dy: -0.42, angle: deg(-30) } as const;
const POWDER_FOLLOW = { dx: 0.42, dy: 0.24, angle: deg(40) } as const;
/** The near hand reaches back over its shoulder into the keg's mouth for the next bomb. */
const POWDER_KEG_REACH = { dx: -0.38, dy: -0.45, angle: deg(-150) } as const;

function cradleHand(style: GoblinStyle): Pt {
  return fromFarShoulder(style, CRADLE.dx, CRADLE.dy);
}

// ── Gaits ────────────────────────────────────────────────────────────────────

interface GaitConfig {
  /** Half the distance between the forward and rear extremes of a stride. */
  readonly stride: number;
  readonly lift: number;
  readonly bob: number;
  /** Share of the cycle each foot is planted; under a half there is a flight phase. */
  readonly contact: number;
  /** Phase at which the hips sit lowest: contact for a walk, mid-stance for a run. */
  readonly lowAt: number;
  /** Extra forward lean of the whole spine. */
  readonly lean: number;
  readonly armSwing: number;
  /** How much lower the hips ride than at rest, in tile units. */
  readonly crouch: number;
  readonly headLead: number;
}

const GAITS: Record<GoblinBomberArchetype, Record<'walk' | 'run', GaitConfig>> = {
  dynamite: {
    walk: {
      stride: 0.3,
      lift: 0.12,
      bob: 0.05,
      contact: 0.62,
      lowAt: 0,
      lean: deg(4),
      armSwing: 0.2,
      crouch: 0.06,
      headLead: 0.035,
    },
    // A scurry: a long flight phase, the knees snatched high, the hunch thrown
    // forward over the feet.
    run: {
      stride: 0.34,
      lift: 0.2,
      bob: 0.06,
      contact: 0.38,
      lowAt: 0.19,
      lean: deg(14),
      armSwing: 0.3,
      crouch: 0.1,
      headLead: 0.05,
    },
  },
  black_powder: {
    // A short, heavy, flat-footed tread under the keg's weight.
    walk: {
      stride: 0.28,
      lift: 0.085,
      bob: 0.06,
      contact: 0.65,
      lowAt: 0,
      lean: deg(3),
      armSwing: 0.16,
      crouch: 0.05,
      headLead: 0.025,
    },
    run: {
      stride: 0.3,
      lift: 0.14,
      bob: 0.06,
      contact: 0.42,
      lowAt: 0.25,
      lean: deg(12),
      armSwing: 0.22,
      crouch: 0.1,
      headLead: 0.04,
    },
  },
};

/**
 * Ground one cycle of a gait covers, in tiles: a planted foot travels the whole
 * stride during its contact share of the cycle. The runtime advances the cycle
 * by ground actually covered at this rate, which is the only pacing that keeps
 * a planted foot still on the floor.
 */
export function goblinBomberGroundPerCycleTiles(
  archetype: GoblinBomberArchetype,
  gait: 'walk' | 'run',
): number {
  const config = GAITS[archetype][gait];
  return (2 * config.stride * BOMBER_SCALE[archetype]) / config.contact;
}

/** A run snatches the trailing foot up behind it early in the swing; a walk lifts evenly. */
const RUN_KICK_EXPONENT = 0.7;
/**
 * How much of a run's swing is eased at its ends. A run's foot leaves and
 * lands at speed, and a fully eased swing parks it on the frames either side
 * of contact, which reads as the stride stalling four times a cycle.
 */
const RUN_SWING_EASE = 0.15;

function footTarget(phase: number, gait: GaitConfig, kick: number, ease: number): Pt {
  const wrapped = phase - Math.floor(phase);
  if (wrapped < gait.contact) {
    return pt(lerp(gait.stride, -gait.stride, wrapped / gait.contact), 0);
  }
  const swing = (wrapped - gait.contact) / (1 - gait.contact);
  return pt(
    lerp(-gait.stride, gait.stride, lerp(swing, easeInOut(swing), ease)),
    -gait.lift * Math.sin(swing ** kick * Math.PI),
  );
}

/** Two footfalls per cycle, so the hips bounce twice per stride. */
const BOUNCES_PER_CYCLE = 2;
/** How far ahead of the body the free arm's forward swing rises, as a share of the swing. */
const ARM_RISE = 0.25;
/** Ears trail the head's bounce by this share of a bounce. */
const EAR_LAG_SHARE = 0.15;
const LOCOMOTION_EAR_LAG = deg(-9);
/** A running arm is bent and pumps from the shoulder: the fist rides this high. */
const RUN_FIST_LIFT = 0.12;

function locomotionPose(
  archetype: GoblinBomberArchetype,
  gaitName: 'walk' | 'run',
  phase: number,
): BomberFrame {
  const style = GOBLIN_BOMBER_STYLES[archetype];
  const base = standingPose(archetype);
  const gait = GAITS[archetype][gaitName];
  const running = gaitName === 'run';
  const swingAngle = phase * FULL_CYCLE;
  const armSwing = Math.cos(swingAngle);
  const bounce = HALF - HALF * Math.cos((phase - gait.lowAt) * FULL_CYCLE * BOUNCES_PER_CYCLE);
  const kick = running ? RUN_KICK_EXPONENT : 1;
  const ease = running ? RUN_SWING_EASE : 1;
  const near = footTarget(phase, gait, kick, ease);
  const far = footTarget(phase + HALF, gait, kick, ease);
  const bob = gait.crouch - gait.bob * bounce;
  const hip = hipJointOffset(style.proportions);
  const runLift = running ? RUN_FIST_LIFT : 0;

  // The free far arm counter-swings the near leg.
  const freeFar = pt(
    base.farHand.x + armSwing * gait.armSwing,
    base.farHand.y + bob - Math.abs(armSwing) * gait.armSwing * ARM_RISE - runLift,
  );

  let nearHand: Pt;
  let nearAngle: number;
  let farHand: Pt;
  let farAngle: number | undefined;
  if (archetype === 'dynamite') {
    // The stick hand stays up at the chest and pumps a little against the stride.
    const hold = placeHand(style, DYNAMITE_HOLD);
    const pump = gait.armSwing * HALF * HALF;
    nearHand = pt(hold.x - armSwing * pump, hold.y + bob - Math.abs(armSwing) * pump * ARM_RISE);
    nearAngle = DYNAMITE_HOLD.angle + armSwing * STICK_STRIDE_ROCK;
    farHand = freeFar;
    farAngle = undefined;
  } else {
    // The near arm swings free; the far hand never lets go of the bomb at its
    // belly, nor of the slow-match smouldering in the same fist.
    nearHand = pt(
      base.nearHand.x - armSwing * gait.armSwing,
      base.nearHand.y + bob - Math.abs(armSwing) * gait.armSwing * ARM_RISE - runLift,
    );
    nearAngle = FREE_HAND_ANGLE - armSwing * FREE_FIST_STRIDE_ROCK;
    const cradle = cradleHand(style);
    farHand = pt(cradle.x, cradle.y + bob);
    farAngle = CRADLE.angle;
  }

  const pose: GoblinPose = {
    ...base,
    bob,
    lean: gait.lean + STRIDE_LEAN * (1 - bounce),
    nearFoot: pt(near.x + hip, near.y),
    farFoot: pt(far.x - hip, far.y),
    nearHand,
    farHand,
    weaponAngle: nearAngle,
    offHandAngle: farAngle,
    offHandInFront: archetype === 'black_powder' && POWDER_FAR_ARM_IN_FRONT,
    headLead: gait.headLead * (1 - bounce),
    headTilt: STRIDE_NOD * (1 - bounce),
    earLag:
      LOCOMOTION_EAR_LAG *
      Math.cos((phase - EAR_LAG_SHARE / BOUNCES_PER_CYCLE) * FULL_CYCLE * BOUNCES_PER_CYCLE),
    mouthOpen: archetype === 'dynamite' ? DYNAMITE_GRIN : 0,
  };
  return {
    pose,
    nearHolds: archetype === 'dynamite',
    farHolds: archetype === 'black_powder',
    litFuse: archetype === 'dynamite' ? 'near' : null,
    burst: 0,
    smokeCycle: phase,
    sparkSeed: 0,
  };
}

// ── Idle ─────────────────────────────────────────────────────────────────────

/** How far the held stick rocks with each stride of the walk and run. */
const STICK_STRIDE_ROCK = deg(6);
/** How far the free near fist rocks with each stride. */
const FREE_FIST_STRIDE_ROCK = deg(10);
/** The extra lean, and the nod, a stride puts on at the bottom of each bounce. */
const STRIDE_LEAN = deg(2);
const STRIDE_NOD = deg(2);

/** The dynamite goblin's permanent grin, half a gape: the giggle it is holding in. */
const DYNAMITE_GRIN = 0.3;
const BREATH_SWELL = 0.02;
const BREATH_SETTLE = 0.006;
const BREATH_HAND_RISE = 0.008;
const BREATH_HEAD_LIFT = deg(0.75);
/** The dynamite goblin twiddles its stick twice a breath; the turn is small enough to never read as a throw. */
const TWIDDLE_TURNS = 2;
const TWIDDLE = deg(2.5);
const BLINK_FRAME = 9;

function idlePose(
  archetype: GoblinBomberArchetype,
  frame: number,
  frameCount: number,
): BomberFrame {
  const style = GOBLIN_BOMBER_STYLES[archetype];
  const base = standingPose(archetype);
  const phase = cyclePhase(frame, frameCount);
  // Zero at frame 0, because every one-shot hands back to idle frame 0.
  const breath = Math.sin(phase * FULL_CYCLE);
  const blink = frame === BLINK_FRAME ? 1 : 0;
  const common = {
    ...base,
    bob: base.bob - BREATH_SETTLE * breath,
    torsoSquash: 1 + BREATH_SWELL * breath,
    headTilt: -BREATH_HEAD_LIFT * breath,
    eyeOpen: 1 - blink,
  };
  if (archetype === 'dynamite') {
    const hold = placeHand(style, DYNAMITE_HOLD);
    return {
      pose: {
        ...common,
        nearHand: pt(hold.x, hold.y - BREATH_HAND_RISE * breath),
        weaponAngle: DYNAMITE_HOLD.angle + TWIDDLE * Math.sin(phase * FULL_CYCLE * TWIDDLE_TURNS),
        mouthOpen: DYNAMITE_GRIN,
      },
      nearHolds: true,
      farHolds: false,
      litFuse: 'near',
      burst: 0,
      smokeCycle: phase,
      sparkSeed: frame,
    };
  }
  const cradle = cradleHand(style);
  return {
    pose: {
      ...common,
      nearHand: pt(base.nearHand.x, base.nearHand.y - BREATH_HAND_RISE * breath),
      weaponAngle: FREE_HAND_ANGLE,
      farHand: pt(cradle.x, cradle.y - BREATH_HAND_RISE * breath),
      offHandAngle: CRADLE.angle,
      offHandInFront: POWDER_FAR_ARM_IN_FRONT,
    },
    nearHolds: false,
    farHolds: true,
    litFuse: null,
    burst: 0,
    smokeCycle: phase,
    sparkSeed: frame,
  };
}

// ── Flinch ───────────────────────────────────────────────────────────────────

const FLINCH_SNAP_END = 0.1;
const FLINCH_RECOIL = {
  handBack: 0.1,
  handDrop: 0.06,
  lean: deg(-24),
  bob: 0.03,
  sway: -0.08,
  torsoSquash: 0.07,
  headTilt: deg(-30),
  headLead: -0.08,
  earLag: deg(36),
  eyeClose: 0.75,
  stagger: -0.08,
  staggerEnd: 0.5,
  staggerLift: 0.02,
} as const;

function flinchPose(archetype: GoblinBomberArchetype, progress: number): BomberFrame {
  const rest = idlePose(archetype, 0, bomberRowByName(archetype, 'idle').frameCount);
  const recoil =
    progress <= FLINCH_SNAP_END
      ? 1
      : 1 - easeInOut((progress - FLINCH_SNAP_END) / (1 - FLINCH_SNAP_END));
  const r = FLINCH_RECOIL;
  const pose = rest.pose;
  return {
    ...rest,
    pose: {
      ...pose,
      lean: r.lean * recoil,
      bob: pose.bob + r.bob * recoil,
      sway: r.sway * recoil,
      torsoSquash: 1 - r.torsoSquash * recoil,
      farFoot: steppedFoot(
        pose.farFoot.x,
        r.stagger,
        [FLINCH_SNAP_END, r.staggerEnd],
        [r.staggerEnd, STEP_HOME_BY],
        progress,
        r.staggerLift,
      ),
      nearHand: pt(pose.nearHand.x - r.handBack * recoil, pose.nearHand.y + r.handDrop * recoil),
      farHand: pt(
        pose.farHand.x - r.handBack * recoil * HALF,
        pose.farHand.y + r.handDrop * recoil,
      ),
      headTilt: r.headTilt * recoil,
      headLead: r.headLead * recoil,
      earLag: r.earLag * recoil,
      mouthOpen: Math.max(pose.mouthOpen, recoil),
      eyeOpen: 1 - recoil * r.eyeClose,
    },
    smokeCycle: null,
    sparkSeed: Math.round(progress * SPARK_SEEDS_PER_ROW),
  };
}

/** Distinct spark sprays a one-shot row cycles through. */
const SPARK_SEEDS_PER_ROW = 16;

// ── Light ────────────────────────────────────────────────────────────────────

/** Frames either side of the catch that carry the flash, and how strongly. */
const BURST_FALLOFF = [1, 0.55] as const;

function burstAt(frame: number, catchFrame: number): number {
  const distance = frame - catchFrame;
  if (distance < 0 || distance >= BURST_FALLOFF.length) return 0;
  return BURST_FALLOFF[distance];
}

/** The light row's beats, as progress: reach the flame, hold on it, and come away ready. */
const DYNAMITE_LIGHT = {
  reachEnd: 0.4,
  holdEnd: 0.56,
  ducks: deg(10),
  headLead: 0.04,
  earsUp: deg(18),
  giggle: 0.75,
} as const;

function dynamiteLightPose(frame: number, frameCount: number): BomberFrame {
  const style = GOBLIN_BOMBER_STYLES.dynamite;
  const progress = shotProgress(frame, frameCount);
  const idle = idlePose('dynamite', 0, bomberRowByName('dynamite', 'idle').frameCount).pose;
  const L = DYNAMITE_LIGHT;
  const reach = ramp(progress, 0, L.reachEnd);
  const away = ramp(progress, L.holdEnd, 1);
  const ducking = reach * (1 - away);
  const headed: GoblinPose = {
    ...idle,
    headTilt: L.ducks * ducking,
    headLead: L.headLead * ducking,
  };
  const wick = goblinDynamiteWickAt(buildSkeleton(style, headed));
  const tipOffset = rotatePt(DYNAMITE_STICK_FUSE_TIP, DYNAMITE_LIGHTING_ANGLE);
  const atFlame = pt(wick.x - tipOffset.x, wick.y - tipOffset.y);
  const hold = idle.nearHand;
  const ready = placeHand(style, DYNAMITE_READY);
  const nearHand = lerpPt(lerpPt(hold, atFlame, reach), ready, away);
  const weaponAngle = lerp(
    lerp(idle.weaponAngle ?? DYNAMITE_HOLD.angle, DYNAMITE_LIGHTING_ANGLE, reach),
    DYNAMITE_READY.angle,
    away,
  );
  const catchFrame = GOBLIN_BOMBER_EVENT_FRAMES.dynamite.fuseCatch;
  return {
    pose: {
      ...headed,
      nearHand,
      weaponAngle,
      earLag: L.earsUp * hump(progress),
      mouthOpen: lerp(DYNAMITE_GRIN, L.giggle, hump(progress)),
      nearArmUnderHead: away > HALF,
      eyeOpen: 1,
    },
    nearHolds: true,
    farHolds: false,
    litFuse: 'near',
    burst: burstAt(frame, catchFrame),
    smokeCycle: null,
    sparkSeed: frame,
  };
}

/**
 * The black powder goblin's light, as progress: the near hand takes the bomb
 * from the cradle, brings its fuse up under the smouldering slow-match the far
 * fist holds out, and once it catches draws the bomb back for the throw.
 */
const POWDER_LIGHT = {
  graspAt: 0.24,
  meetEnd: 0.34,
  holdEnd: 0.46,
  readyEnd: 0.95,
  /** The far hand lifts the bomb a little toward the near hand coming for it. */
  liftBomb: pt(-0.08, -0.08),
  /** Where the far fist holds the match out, from the far shoulder, and how it is turned. */
  matchAt: pt(0.5, 0.02),
  matchAngle: deg(-20),
  /** The bomb is held ball-down, fuse up, while its fuse is put to the match. */
  bombAngle: deg(-100),
  headDown: deg(12),
} as const;

function blackPowderLightPose(frame: number, frameCount: number): BomberFrame {
  const style = GOBLIN_BOMBER_STYLES.black_powder;
  const progress = shotProgress(frame, frameCount);
  const idle = idlePose('black_powder', 0, bomberRowByName('black_powder', 'idle').frameCount).pose;
  const L = POWDER_LIGHT;
  const reach = ramp(progress, 0, L.graspAt);
  const meet = ramp(progress, L.graspAt, L.meetEnd);
  // Half eased: the draw-back is the longest move in the row, and fully eased
  // its middle frames jump where its ends crawl.
  const readyLinear = clamp01((progress - L.holdEnd) / (L.readyEnd - L.holdEnd));
  const ready = lerp(readyLinear, easeInOut(readyLinear), HALF);
  const cradle = cradleHand(style);
  const lifted = offset(cradle, L.liftBomb.x * reach, L.liftBomb.y * reach);
  const matchHand = fromFarShoulder(style, L.matchAt.x, L.matchAt.y);
  const farHand = lerpPt(lifted, matchHand, meet);
  const farAngle = lerp(CRADLE.angle, L.matchAngle, meet);
  const ember = slowMatchEmberAt(matchHand, L.matchAngle);
  const fuseOffset = rotatePt(BLACK_POWDER_BOMB_FUSE_TIP, L.bombAngle);
  const atMatch = pt(ember.x - fuseOffset.x, ember.y - fuseOffset.y);
  const handed = progress >= L.graspAt;

  const nearHand = lerpPt(lerpPt(idle.nearHand, lifted, reach), atMatch, meet);
  const nearAngle = lerp(lerp(FREE_HAND_ANGLE, CRADLE.angle, reach), L.bombAngle, meet);
  const lighting: GoblinPose = {
    ...idle,
    nearHand,
    weaponAngle: nearAngle,
    farHand,
    offHandAngle: farAngle,
    offHandInFront: POWDER_FAR_ARM_IN_FRONT,
    headTilt: L.headDown * meet,
    eyeOpen: 1,
  };
  const catchFrame = GOBLIN_BOMBER_EVENT_FRAMES.black_powder.fuseCatch;
  const lit = frame >= catchFrame;
  return {
    pose: steppingInto(blendPose(lighting, aimPose(0), ready), ready),
    nearHolds: handed,
    farHolds: !handed,
    litFuse: lit ? (handed ? 'near' : 'far') : null,
    burst: burstAt(frame, catchFrame),
    smokeCycle: null,
    sparkSeed: frame,
  };
}

// ── Aim ──────────────────────────────────────────────────────────────────────

const AIM = {
  lean: deg(-6),
  sway: -0.04,
  step: 0.05,
  brace: -0.03,
  headTilt: deg(-5),
  headLead: 0.03,
  earLag: deg(-16),
  eyeOpen: 0.7,
  snarl: 0.35,
} as const;

/**
 * The aim at a share `creep` of the way through the lock. It is fully drawn
 * from its first frame: the light row ends on the draw, so the warning reads
 * from the lock's first frame rather than at its end. The bomb creeps a little
 * further back over the lock, so a held aim never reads as a frozen frame.
 */
function aimPose(creep: number): GoblinPose {
  const style = GOBLIN_BOMBER_STYLES.black_powder;
  const base = standingPose('black_powder');
  return {
    ...base,
    lean: AIM.lean,
    sway: AIM.sway,
    nearFoot: pt(base.nearFoot.x + AIM.step, 0),
    farFoot: pt(base.farFoot.x + AIM.brace, 0),
    nearHand: offset(
      placeHand(style, POWDER_DRAWN),
      POWDER_CREEP.x * creep,
      POWDER_CREEP.y * creep,
    ),
    weaponAngle: POWDER_DRAWN.angle,
    farHand: fromFarShoulder(style, POWDER_POINT.x, POWDER_POINT.y),
    offHandAngle: POWDER_POINT_ANGLE,
    offHandInFront: POWDER_FAR_ARM_IN_FRONT,
    nearArmUnderHead: true,
    headTilt: AIM.headTilt,
    headLead: AIM.headLead,
    earLag: AIM.earLag,
    eyeOpen: AIM.eyeOpen,
    mouthOpen: AIM.snarl,
  };
}

/** Lifts both feet off the floor while a blend carries them to a new stance, so neither slides. */
function steppingInto(pose: GoblinPose, share: number): GoblinPose {
  const lift = Math.sin(clamp01(share) * Math.PI);
  return {
    ...pose,
    nearFoot: pt(pose.nearFoot.x, -STEP_LIFT * lift),
    farFoot: pt(pose.farFoot.x, -STEP_LIFT * HALF * lift),
  };
}

/** Every number and point of two poses, `t` of the way from `from` to `to`. */
function blendPose(from: GoblinPose, to: GoblinPose, t: number): GoblinPose {
  const angle = (a: number | null, b: number | null): number | null =>
    a === null || b === null ? (t < HALF ? a : b) : lerp(a, b, t);
  const offAngle = angle(from.offHandAngle ?? null, to.offHandAngle ?? null);
  return {
    ...(t < HALF ? from : to),
    bob: lerp(from.bob, to.bob, t),
    sway: lerp(from.sway, to.sway, t),
    lean: lerp(from.lean, to.lean, t),
    nearFoot: lerpPt(from.nearFoot, to.nearFoot, t),
    farFoot: lerpPt(from.farFoot, to.farFoot, t),
    nearHand: lerpPt(from.nearHand, to.nearHand, t),
    farHand: lerpPt(from.farHand, to.farHand, t),
    wristTwist: lerp(from.wristTwist, to.wristTwist, t),
    weaponAngle: angle(from.weaponAngle, to.weaponAngle),
    headTilt: lerp(from.headTilt, to.headTilt, t),
    headLead: lerp(from.headLead, to.headLead, t),
    earLag: lerp(from.earLag, to.earLag, t),
    mouthOpen: lerp(from.mouthOpen, to.mouthOpen, t),
    eyeOpen: lerp(from.eyeOpen, to.eyeOpen, t),
    torsoSquash: lerp(from.torsoSquash, to.torsoSquash, t),
    offHandAngle: offAngle ?? undefined,
  };
}

function blackPowderAimFrame(frame: number, frameCount: number): BomberFrame {
  const progress = shotProgress(frame, frameCount);
  return {
    pose: aimPose(progress),
    nearHolds: true,
    farHolds: false,
    litFuse: 'near',
    burst: 0,
    smokeCycle: null,
    sparkSeed: frame,
  };
}

// ── Throw ────────────────────────────────────────────────────────────────────

const THROW_BODY = {
  windLean: deg(-8),
  driveLean: deg(20),
  followLean: deg(26),
  windSway: -0.04,
  driveSway: 0.07,
  headTilt: deg(10),
  headLead: 0.05,
  earDrive: deg(-10),
  mouthDrive: 0.8,
} as const;
/** The fist bows up and over the shoulder on its way forward, rather than through the head. */
const THROW_ARC = pt(0.06, -0.22);

/**
 * The dynamite goblin's free hand through the throw, in tile units: it comes
 * forward and up for balance as the stick winds back, then is hauled back as
 * the throwing arm drives through.
 */
const DYNAMITE_FREE_HAND = { windForward: 0.12, driveBack: 0.1, windRise: 0.1 } as const;
/** The ears prick up as the stick winds back. */
const DYNAMITE_WIND_EARS = deg(14);

function dynamiteThrowFrame(frame: number, frameCount: number): BomberFrame {
  const style = GOBLIN_BOMBER_STYLES.dynamite;
  const progress = shotProgress(frame, frameCount);
  const base = standingPose('dynamite');
  const idle = idlePose('dynamite', 0, bomberRowByName('dynamite', 'idle').frameCount).pose;
  const releaseAt = eventProgress('dynamite', 'throw', GOBLIN_BOMBER_EVENT_FRAMES.dynamite.release);
  const WIND_END = 0.24;
  const FOLLOW_END = 0.66;
  const PLUCK_AT = 0.84;
  const wind = ramp(progress, 0, WIND_END);
  const drive = easeIn(clamp01((progress - WIND_END) / (releaseAt - WIND_END)));
  const follow = easeOut(clamp01((progress - releaseAt) / (FOLLOW_END - releaseAt)));
  const pluck = ramp(progress, FOLLOW_END, PLUCK_AT);
  const home = ramp(progress, PLUCK_AT, 1);

  const ready = placeHand(style, DYNAMITE_READY);
  const wound = placeHand(style, DYNAMITE_WOUND);
  const release = placeHand(style, DYNAMITE_RELEASE);
  const followed = placeHand(style, DYNAMITE_FOLLOW);
  const plucked = placeHand(style, DYNAMITE_PLUCK);
  const arcing = hump(drive) * (1 - follow);
  const staged = lerpPt(
    lerpPt(
      lerpPt(lerpPt(lerpPt(ready, wound, wind), release, drive), followed, follow),
      plucked,
      pluck,
    ),
    idle.nearHand,
    home,
  );
  const nearHand = offset(staged, THROW_ARC.x * arcing, THROW_ARC.y * arcing);
  const weaponAngle = lerp(
    lerp(
      lerp(
        lerp(lerp(DYNAMITE_READY.angle, DYNAMITE_WOUND.angle, wind), DYNAMITE_RELEASE.angle, drive),
        DYNAMITE_FOLLOW.angle,
        follow,
      ),
      DYNAMITE_PLUCK.angle,
      pluck,
    ),
    idle.weaponAngle ?? DYNAMITE_HOLD.angle,
    home,
  );
  const settle = 1 - ramp(progress, FOLLOW_END, 1);
  const holding = progress < releaseAt || progress >= (FOLLOW_END + PLUCK_AT) / 2;
  const STEP = 0.16;
  return {
    pose: {
      ...base,
      lean:
        lerp(
          lerp(THROW_BODY.windLean * wind, THROW_BODY.driveLean, drive),
          THROW_BODY.followLean,
          follow,
        ) * settle,
      sway: lerp(THROW_BODY.windSway * wind, THROW_BODY.driveSway, drive) * settle,
      nearFoot: steppedFoot(
        base.nearFoot.x,
        STEP,
        [WIND_END, releaseAt],
        [PLUCK_AT, STEP_HOME_BY],
        progress,
        STEP_LIFT,
      ),
      nearHand,
      weaponAngle,
      farHand: pt(
        base.farHand.x +
          DYNAMITE_FREE_HAND.windForward * wind * (1 - drive) -
          DYNAMITE_FREE_HAND.driveBack * drive * settle,
        base.farHand.y - DYNAMITE_FREE_HAND.windRise * wind * settle,
      ),
      headTilt: THROW_BODY.headTilt * drive * settle,
      headLead: THROW_BODY.headLead * drive * settle,
      earLag: lerp(DYNAMITE_WIND_EARS * wind, THROW_BODY.earDrive, drive) * settle,
      mouthOpen: lerp(DYNAMITE_GRIN, THROW_BODY.mouthDrive, hump(clamp01(progress / FOLLOW_END))),
      nearArmUnderHead: drive < HALF,
      eyeOpen: 1,
    },
    nearHolds: holding,
    farHolds: false,
    litFuse: holding ? 'near' : null,
    burst: 0,
    smokeCycle: null,
    sparkSeed: frame,
  };
}

function blackPowderThrowFrame(frame: number, frameCount: number): BomberFrame {
  const style = GOBLIN_BOMBER_STYLES.black_powder;
  const progress = shotProgress(frame, frameCount);
  const base = standingPose('black_powder');
  const idle = idlePose('black_powder', 0, bomberRowByName('black_powder', 'idle').frameCount).pose;
  const aimFrames = bomberRowByName('black_powder', 'aim').frameCount;
  // The throw picks up exactly where the aim's last frame left the arm, and
  // its own first frame is that pose: the drive starts from rest, not mid-swing.
  const aimed = aimPose(shotProgress(aimFrames - 1, aimFrames));
  const firstFrame = shotProgress(0, frameCount);
  const releaseAt = eventProgress(
    'black_powder',
    'throw',
    GOBLIN_BOMBER_EVENT_FRAMES.black_powder.release,
  );
  const FOLLOW_END = 0.5;
  const KEG_AT = 0.66;
  const HANDOFF_AT = 0.84;
  const drive = easeIn(clamp01((progress - firstFrame) / (releaseAt - firstFrame)));
  const follow = easeOut(clamp01((progress - releaseAt) / (FOLLOW_END - releaseAt)));
  const reachKeg = ramp(progress, FOLLOW_END, KEG_AT);
  const toBelly = ramp(progress, KEG_AT, HANDOFF_AT);
  const drop = ramp(progress, HANDOFF_AT, 1);

  const release = placeHand(style, POWDER_RELEASE);
  const followed = placeHand(style, POWDER_FOLLOW);
  const keg = placeHand(style, POWDER_KEG_REACH);
  const cradle = cradleHand(style);
  const arcing = hump(drive) * (1 - follow);
  const staged = lerpPt(
    lerpPt(
      lerpPt(lerpPt(lerpPt(aimed.nearHand, release, drive), followed, follow), keg, reachKeg),
      cradle,
      toBelly,
    ),
    idle.nearHand,
    drop,
  );
  const nearHand = offset(staged, THROW_ARC.x * arcing, THROW_ARC.y * arcing);
  const weaponAngle = lerp(
    lerp(
      lerp(
        lerp(
          lerp(aimed.weaponAngle ?? POWDER_DRAWN.angle, POWDER_RELEASE.angle, drive),
          POWDER_FOLLOW.angle,
          follow,
        ),
        POWDER_KEG_REACH.angle,
        reachKeg,
      ),
      CRADLE.angle,
      toBelly,
    ),
    FREE_HAND_ANGLE,
    drop,
  );
  // The pointing arm hauls back down as the throwing arm comes over, then
  // comes round to the belly to take the next bomb.
  const counter = fromFarShoulder(style, POWDER_COUNTER.x, POWDER_COUNTER.y);
  const farHand = lerpPt(lerpPt(aimed.farHand, counter, drive), cradle, toBelly);
  const settle = 1 - ramp(progress, FOLLOW_END, STEP_HOME_BY);
  const withBomb =
    progress < releaseAt || (progress >= (FOLLOW_END + KEG_AT) / 2 && progress < HANDOFF_AT);
  const farHasBomb = progress >= HANDOFF_AT;
  return {
    pose: {
      ...base,
      lean:
        lerp(lerp(aimed.lean, THROW_BODY.driveLean, drive), THROW_BODY.followLean, follow) * settle,
      sway: lerp(aimed.sway, THROW_BODY.driveSway, drive) * settle,
      nearFoot: stepTo(
        aimed.nearFoot.x,
        base.nearFoot.x,
        [FOLLOW_END, STEP_HOME_BY],
        progress,
        STEP_LIFT,
      ),
      farFoot: stepTo(
        aimed.farFoot.x,
        base.farFoot.x,
        [FOLLOW_END, STEP_HOME_BY],
        progress,
        STEP_LIFT * HALF,
      ),
      nearHand,
      weaponAngle,
      farHand,
      offHandAngle: lerp(aimed.offHandAngle ?? POWDER_POINT_ANGLE, CRADLE.angle, toBelly),
      offHandInFront: POWDER_FAR_ARM_IN_FRONT,
      nearArmUnderHead: drive < HALF || (reachKeg > HALF && toBelly < HALF),
      headTilt: lerp(aimed.headTilt, THROW_BODY.headTilt, drive) * settle,
      headLead: lerp(aimed.headLead, THROW_BODY.headLead, drive) * settle,
      earLag: lerp(aimed.earLag, THROW_BODY.earDrive, drive) * settle,
      mouthOpen: lerp(aimed.mouthOpen, THROW_BODY.mouthDrive, drive) * settle,
      eyeOpen: lerp(aimed.eyeOpen, 1, drive),
    },
    nearHolds: withBomb,
    farHolds: farHasBomb,
    litFuse: progress < releaseAt ? 'near' : null,
    burst: 0,
    smokeCycle: null,
    sparkSeed: frame,
  };
}

// ── Frame production ─────────────────────────────────────────────────────────

/** One frame of one of a bomber's rows: its pose, what it holds and what is burning. */
export function goblinBomberFrame(
  archetype: GoblinBomberArchetype,
  rowName: string,
  frame: number,
): BomberFrame {
  const row = bomberRowByName(archetype, rowName);
  switch (row.name) {
    case 'walk':
    case 'run':
      return locomotionPose(archetype, row.name, cyclePhase(frame, row.frameCount));
    case 'idle':
      return idlePose(archetype, frame, row.frameCount);
    case 'flinch':
      return flinchPose(archetype, shotProgress(frame, row.frameCount));
    case 'light':
      return archetype === 'dynamite'
        ? dynamiteLightPose(frame, row.frameCount)
        : blackPowderLightPose(frame, row.frameCount);
    case 'aim':
      return blackPowderAimFrame(frame, row.frameCount);
    case 'throw':
      return archetype === 'dynamite'
        ? dynamiteThrowFrame(frame, row.frameCount)
        : blackPowderThrowFrame(frame, row.frameCount);
  }
}

/** The pose one frame of one of a bomber's rows resolves to, for the pose gates. */
export function goblinBomberPose(
  archetype: GoblinBomberArchetype,
  rowName: string,
  frame: number,
): GoblinPose {
  return goblinBomberFrame(archetype, rowName, frame).pose;
}

const BOMBER_PROPS: Record<GoblinBomberArchetype, GoblinProp> = {
  dynamite: makeDynamiteStickProp(GOBLIN_BOMBER_STYLES.dynamite.palette),
  black_powder: makeBlackPowderBombProp(GOBLIN_BOMBER_STYLES.black_powder.palette),
};

const FUSE_TIPS: Record<GoblinBomberArchetype, Pt> = {
  dynamite: DYNAMITE_STICK_FUSE_TIP,
  black_powder: BLACK_POWDER_BOMB_FUSE_TIP,
};

/**
 * Where the lit fuse burns on a frame, in figure units, or null when no fuse
 * is lit. Exported so the light row's catch can be asserted to land on the
 * flame it is held to.
 */
export function goblinBomberFuseAt(
  archetype: GoblinBomberArchetype,
  frame: BomberFrame,
  skeleton: Skeleton,
): Pt | null {
  if (frame.litFuse === null) return null;
  const tip = FUSE_TIPS[archetype];
  if (frame.litFuse === 'near') {
    return fuseTipAt(skeleton.nearArm.end, frame.pose.weaponAngle ?? 0, tip);
  }
  return fuseTipAt(skeleton.farArm.end, offHandWristAngle(skeleton, frame.pose), tip);
}

/** Where the candle's flame stands on a frame, in figure units. */
export function goblinDynamiteWickAt(skeleton: Skeleton): Pt {
  const style = GOBLIN_BOMBER_STYLES.dynamite;
  const r = style.proportions.headRadius;
  const local = pt(
    DYNAMITE_CANDLE_WICK.x * r * style.proportions.headWidthFactor,
    DYNAMITE_CANDLE_WICK.y * r,
  );
  const turned = rotatePt(local, skeleton.headAngle);
  return offset(skeleton.headCentre, turned.x, turned.y);
}

function overlayFor(archetype: GoblinBomberArchetype, frame: BomberFrame): GoblinOverlay {
  return (ctx, skeleton) => {
    if (archetype === 'dynamite') {
      drawCandleFlame(ctx, goblinDynamiteWickAt(skeleton), frame.sparkSeed);
    } else {
      const ember = slowMatchEmberAt(skeleton.farArm.end, offHandWristAngle(skeleton, frame.pose));
      if (frame.smokeCycle !== null) drawSmokeWisp(ctx, ember, frame.smokeCycle);
      drawEmber(ctx, ember);
    }
    const fuse = goblinBomberFuseAt(archetype, frame, skeleton);
    if (fuse === null) return;
    drawFuseSpark(ctx, fuse, frame.sparkSeed, 1);
    drawSparkBurst(ctx, fuse, frame.burst);
  };
}

// ── Cell geometry and gore ───────────────────────────────────────────────────

interface CellGeometry {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
}

/**
 * Where each bomber's own tile sits inside its cell, and how big the cell is:
 * wide enough for the throw's reach and the follow-through, tall enough for
 * the candle's flame and a bomb held high over the shoulder. The structural
 * gate fails a pose that reaches the edge.
 */
const GEOMETRY: Record<GoblinBomberArchetype, CellGeometry> = {
  dynamite: { frameWidth: 128, frameHeight: 112, tileX: 32, tileY: 40 },
  black_powder: { frameWidth: 144, frameHeight: 120, tileX: 40, tileY: 44 },
};

/**
 * How far each severed piece is nudged so its ink, not its authoring origin,
 * sits at the centre of the cell: the gore field spins a piece about its cell
 * centre. Measured offline from the painted pieces, in tile units before the
 * figure's own scale; `scripts/gates-goblins.ts` re-measures the effect.
 */
export const GOBLIN_BOMBER_GORE_RECENTRE: Readonly<
  Record<GoblinBomberArchetype, ReadonlyMap<string, Pt>>
> = {
  dynamite: new Map([
    ['gore_head', pt(0.0625, -0.0078125)],
    ['gore_torso', pt(0, 0)],
    ['gore_arm_near', pt(0.1015625, 0)],
    ['gore_arm_far', pt(0.09375, -0.0390625)],
    ['gore_leg_near', pt(0.1171875, -0.0234375)],
    ['gore_leg_far', pt(0.03125, -0.0078125)],
    ['gore_ribchunk', pt(0.0078125, 0.0234375)],
    ['gore_entrails', pt(0.0078125, 0.0078125)],
    ['gore_jaw', pt(-0.015625, 0.015625)],
  ]),
  black_powder: new Map([
    ['gore_head', pt(0.0546875, -0.03125)],
    ['gore_torso', pt(0.0078125, -0.0078125)],
    ['gore_arm_near', pt(0.1171875, 0)],
    ['gore_arm_far', pt(0.109375, -0.0390625)],
    ['gore_leg_near', pt(0.1328125, -0.0234375)],
    ['gore_leg_far', pt(0.03125, 0.0078125)],
    ['gore_ribchunk', pt(-0.0078125, 0.03125)],
    ['gore_entrails', pt(0.0078125, 0)],
    ['gore_jaw', pt(-0.015625, 0.0078125)],
  ]),
};

const GORE_PIECES: Record<GoblinBomberArchetype, readonly GorePiece[]> = {
  dynamite: gorePieces(GOBLIN_BOMBER_STYLES.dynamite),
  black_powder: gorePieces(GOBLIN_BOMBER_STYLES.black_powder),
};

function paintBomberFrame(
  archetype: GoblinBomberArchetype,
  ctx: CanvasRenderingContext2D,
  state: string,
  frameIndex: number,
): void {
  const style = GOBLIN_BOMBER_STYLES[archetype];
  const geometry = GEOMETRY[archetype];
  const drawScale = BOMBER_SCALE[archetype];
  const centreX = geometry.frameWidth / 2;
  const isRow = GOBLIN_BOMBER_ROWS[archetype].some((row) => row.name === state);

  if (!isRow) {
    const piece = GORE_PIECES[archetype].find((candidate) => candidate.state === state);
    const recentre = GOBLIN_BOMBER_GORE_RECENTRE[archetype].get(state);
    if (piece === undefined || recentre === undefined) {
      throw new Error(`no gore piece for goblin_${archetype} "${state}"`);
    }
    ctx.save();
    ctx.translate(
      centreX + recentre.x * TILE_SCALE,
      geometry.frameHeight / 2 + recentre.y * TILE_SCALE,
    );
    ctx.scale(TILE_SCALE * drawScale, TILE_SCALE * drawScale);
    piece.paint(ctx, style);
    ctx.restore();
    return;
  }

  const frame = goblinBomberFrame(archetype, state, frameIndex);
  const prop = BOMBER_PROPS[archetype];
  drawGoblin(
    ctx,
    centreX,
    geometry.tileY + TILE_SCALE,
    TILE_SCALE * drawScale,
    style,
    frame.pose,
    frame.nearHolds ? prop : undefined,
    frame.farHolds ? prop : undefined,
    overlayFor(archetype, frame),
  );
}

function bomberStateFrames(archetype: GoblinBomberArchetype): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const row of GOBLIN_BOMBER_ROWS[archetype]) frames[row.name] = row.frameCount;
  for (const state of GOBLIN_GORE_STATES) frames[state] = 1;
  return frames;
}

function bomberFigureOf(archetype: GoblinBomberArchetype): FigureDef {
  const geometry = GEOMETRY[archetype];
  return {
    id: `goblin_${archetype}`,
    frameWidth: geometry.frameWidth,
    frameHeight: geometry.frameHeight,
    tileX: geometry.tileX,
    tileY: geometry.tileY,
    tileScale: TILE_SCALE,
    // The painter composes on a surface of its own at the cell's density; a
    // supersampled bake would only smear its one-pixel outline and rim.
    skipSupersample: true,
    states: figureStates(bomberStateFrames(archetype)),
    paintFrame: (ctx, state, frame) => {
      paintBomberFrame(archetype, ctx, state, frame);
    },
  };
}

export const GOBLIN_DYNAMITE_FIGURE: FigureDef = bomberFigureOf('dynamite');
export const GOBLIN_BLACK_POWDER_FIGURE: FigureDef = bomberFigureOf('black_powder');

export const GOBLIN_BOMBER_FIGURES: Readonly<Record<GoblinBomberArchetype, FigureDef>> = {
  dynamite: GOBLIN_DYNAMITE_FIGURE,
  black_powder: GOBLIN_BLACK_POWDER_FIGURE,
};

/** Skeleton for one frame, for gates and eye placement measured off the rig. */
export function goblinBomberSkeleton(
  archetype: GoblinBomberArchetype,
  rowName: string,
  frame: number,
): Skeleton {
  return buildSkeleton(
    GOBLIN_BOMBER_STYLES[archetype],
    goblinBomberPose(archetype, rowName, frame),
  );
}
