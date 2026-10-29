/**
 * The electric goblin as a painted figure: choreography, the row table, cell
 * geometry and the `FigureDef` the runtime cache and the review harness draw
 * through. The anatomy is the goblin rig's (`goblinArt.ts`); his kit and his
 * electricity are `electricGoblinArt.ts`.
 *
 * Every pose states both rods' angles outright, so the light painted over the
 * figure, the cables and the anchors the runtime reads all agree on where the
 * balls are without re-deriving a wrist.
 *
 * Every frame is drawn facing +X; the runtime mirrors it for the other facing.
 * The art invariants live in `scripts/gates-electric-goblin.ts`:
 * `npm run render:electric-goblin`.
 */

import {
  buildSkeleton,
  clamp01,
  deg,
  drawGoblin,
  easeIn,
  easeInOut,
  easeOut,
  lerp,
  mixPt,
  pt,
  restingPose,
  type GoblinPose,
  type Pt,
} from './goblinArt';
import {
  ELECTRIC_GOBLIN_SCALE,
  NO_ELECTRIC_EFFECTS,
  drawElectricGoblinLight,
  electricGoblinStyle,
  makeShockRodProp,
  rodBallPoint,
  type ElectricEffects,
  type GeneratorState,
  type RodBalls,
} from './electricGoblinArt';
import { type FigureDef, figureStates } from '../figure/figureDef';
import { GOBLIN_GORE_STATES } from './goblinFigure';
import { gorePieces } from './goblinGore';

/** Cell pixels per tile. */
export const TILE_SCALE = 64;

const FULL_CYCLE = Math.PI * 2;
/** A stride cycle lands each foot once. */
const FOOTFALLS_PER_CYCLE = 2;
const HALF = 0.5;

// ── Row table ────────────────────────────────────────────────────────────────

export type ElectricGoblinRow =
  | 'idle'
  | 'walk'
  | 'run'
  | 'grenade_toss'
  | 'plunge_tell'
  | 'plunge'
  | 'swipe'
  | 'slam_tell'
  | 'slam'
  | 'block'
  | 'hurt'
  | 'death';

/**
 * How the runtime plays a row.
 *
 * - `gait`: a loop paced by ground covered, one cycle per `groundPerCycleTiles`.
 * - `loop`: a loop at `fps`.
 * - `tell`: plays `0 … loopFrom − 1` once to raise the rods, then loops
 *   `loopFrom … frames − 1` for as long as the attack's tell lasts.
 * - `strike`: plays once; `eventFrame` is the frame the attack lands or lets go.
 * - `reaction`: plays once and hands back to whatever was playing.
 * - `final`: plays once and holds its last frame.
 */
type ElectricGoblinRowSpec =
  | { readonly kind: 'gait'; readonly frames: number; readonly groundPerCycleTiles: number }
  | { readonly kind: 'loop'; readonly frames: number; readonly fps: number }
  | {
      readonly kind: 'tell';
      readonly frames: number;
      readonly loopFrom: number;
      readonly fps: number;
    }
  | {
      readonly kind: 'strike';
      readonly frames: number;
      readonly eventFrame: number;
      readonly fps: number;
    }
  | {
      readonly kind: 'reaction';
      readonly frames: number;
      readonly eventFrame: number;
      readonly fps: number;
    }
  | { readonly kind: 'final'; readonly frames: number; readonly fps: number };

// ── Walk ─────────────────────────────────────────────────────────────────────

interface Gait {
  readonly frames: number;
  /** Half the distance a foot travels back under him while it is planted. */
  readonly stride: number;
  /** Share of the cycle each foot is planted; under a half is a run's flight. */
  readonly contact: number;
  readonly lift: number;
  /** Pelvis drop at each contact, where the legs are spread widest. */
  readonly drop: number;
  /** Pelvis rise in a run's flight, when neither foot is down. */
  readonly flightRise: number;
  readonly lean: number;
  readonly leanBob: number;
  /** Fore-and-aft swing of each fist, counter to its own side's leg. */
  readonly armSwing: number;
  /** Lift of the fists from the rest carry. */
  readonly carryLift: number;
  /** How far each rod tips with its fist's swing. */
  readonly rodSwing: number;
  /** How far forward of each hip joint the stride is centred. */
  readonly footBias: number;
}

/**
 * A heavy man's walk: a long stance, a short low step, the pelvis sinking onto
 * each landing foot, and the rods swinging a little with the fists.
 */
const WALK: Gait = {
  frames: 16,
  stride: 0.2,
  contact: 0.62,
  lift: 0.085,
  drop: 0.035,
  flightRise: 0,
  lean: deg(4),
  leanBob: deg(1.5),
  armSwing: 0.07,
  carryLift: 0,
  rodSwing: deg(5),
  footBias: 0.04,
};

/** Running clear: a forward lean, a flight phase, fists pumping high with the rods up. */
const RUN: Gait = {
  frames: 12,
  stride: 0.26,
  contact: 0.4,
  lift: 0.17,
  drop: 0.045,
  flightRise: 0.05,
  lean: deg(10),
  leanBob: deg(2),
  armSwing: 0.16,
  carryLift: 0.18,
  rodSwing: deg(10),
  footBias: 0.05,
};

/** Ground one cycle covers, in tiles: a planted foot slides the whole stride during its contact. */
function groundPerCycleTiles(gait: Gait): number {
  return ((2 * gait.stride) / gait.contact) * ELECTRIC_GOBLIN_SCALE;
}

/** Where a foot is at `phase` of its own cycle, relative to the centre of its stride. */
function footAt(phase: number, gait: Gait): Pt {
  const wrapped = phase - Math.floor(phase);
  if (wrapped < gait.contact) {
    return pt(lerp(gait.stride, -gait.stride, wrapped / gait.contact), 0);
  }
  const swing = (wrapped - gait.contact) / (1 - gait.contact);
  return pt(
    lerp(-gait.stride, gait.stride, easeInOut(swing)),
    -gait.lift * Math.sin(swing * Math.PI),
  );
}

/** One planted foot's share of being down at `phase`: 1 planted, 0 in the air. */
function planted(phase: number, gait: Gait): number {
  const wrapped = phase - Math.floor(phase);
  return wrapped < gait.contact ? 1 : 0;
}

// ── Frames ───────────────────────────────────────────────────────────────────

/** Everything one frame paints: the rig pose with both rods' angles stated, and the generator. */
interface ElectricGoblinFrame {
  readonly pose: GoblinPose;
  readonly nearRodAngle: number;
  readonly farRodAngle: number;
  readonly generator: GeneratorState;
  readonly effects: ElectricEffects;
  /** A shock grenade is clamped to the near rod's ball. */
  readonly grenade: boolean;
}

const STYLE_AT_REST = electricGoblinStyle({ spin: 0, charge: 0 });
const BASE_POSE = restingPose(STYLE_AT_REST);

/** The fists carry the rods forward and down, balls hovering just off the floor ahead. */
const REST_NEAR_HAND = pt(0.66, -0.45);
const REST_FAR_HAND = pt(0.12, -0.45);
const REST_NEAR_ROD = deg(22);
const REST_FAR_ROD = deg(18);
/** The generator idles at a low hum; an attack runs it up to full. */
const IDLE_CHARGE = 0.3;
/** Flywheel turn per frame at an idle hum; attacks spin it faster. */
const IDLE_SPIN_PER_FRAME = deg(11.25);

function hand(pose: GoblinPose, near: Pt, far: Pt): GoblinPose {
  return { ...pose, nearHand: near, farHand: far };
}

function frameOf(
  pose: GoblinPose,
  nearRodAngle: number,
  farRodAngle: number,
  generator: GeneratorState,
  effects: ElectricEffects = NO_ELECTRIC_EFFECTS,
  grenade = false,
): ElectricGoblinFrame {
  return {
    pose: { ...pose, weaponAngle: nearRodAngle, offHandAngle: farRodAngle },
    nearRodAngle,
    farRodAngle,
    generator,
    effects,
    grenade,
  };
}

/** How fast the flywheel turns, in multiples of its idle hum. */
const SPIN_RATE = { hum: 1, walking: 2, working: 3, flatOut: 4 } as const;

function generatorAt(frame: number, rate: number, charge: number): GeneratorState {
  return { spin: frame * IDLE_SPIN_PER_FRAME * rate, charge };
}

function hum(frame: number): GeneratorState {
  return generatorAt(frame, SPIN_RATE.hum, IDLE_CHARGE);
}

/** His face on the beats of a row: how wide the eyes are and how far the jaw drops. */
const FACE = {
  rest: { eyeOpen: 0.9, mouthOpen: 0 },
  effort: { eyeOpen: 1, mouthOpen: 0.4 },
  strain: { eyeOpen: 1, mouthOpen: 0.6 },
  roar: { eyeOpen: 1.1, mouthOpen: 1 },
  wince: { eyeOpen: 0.5, mouthOpen: 0.3 },
} as const satisfies Record<string, Pick<GoblinPose, 'eyeOpen' | 'mouthOpen'>>;

/** How hard each beat crackles, as strengths for the light painter. */
const CRACKLE = {
  release: 1,
  plungeImpact: 1.4,
  plungeHold: 1,
  plungeHoldCrawl: 0.8,
  plungeHoldCoils: 0.6,
  swipeFlash: 1.5,
  slamImpact: 1.6,
  slamSwingCrawl: 0.7,
  slamAftershock: 0.6,
  blockFlash: 1.3,
  hurtCoils: 0.8,
  dyingSparks: HALF,
} as const;

const RESTING = hand({ ...BASE_POSE, ...FACE.rest }, REST_NEAR_HAND, REST_FAR_HAND);

// ── Idle ─────────────────────────────────────────────────────────────────────

const IDLE_FRAMES = 16;
/** 3.2 s a breath: a big man at rest, slow enough that he never reads as bobbing. */
const ELECTRIC_GOBLIN_IDLE_FPS = 5;
/** Torso swell at the top of a breath, as a share of its length. */
const BREATH_SWELL = 0.018;
/** The jaw falls open a crack on each breath out. */
const BREATH_JAW = 0.1;
const IDLE_BLINK_FRAME = 11;

function idleFrame(frame: number): ElectricGoblinFrame {
  const phase = frame / IDLE_FRAMES;
  const breath = HALF - HALF * Math.cos(phase * FULL_CYCLE);
  return frameOf(
    {
      ...RESTING,
      torsoSquash: 1 + BREATH_SWELL * breath,
      mouthOpen: BREATH_JAW * breath,
      eyeOpen: frame === IDLE_BLINK_FRAME ? 0 : RESTING.eyeOpen,
    },
    REST_NEAR_ROD,
    REST_FAR_ROD,
    hum(frame),
  );
}

// ── Walk and run ─────────────────────────────────────────────────────────────

/** Where each stride is centred, in tiles either side of the pelvis: under its own hip. */
const NEAR_HIP_X = 0.155;
const FAR_HIP_X = -NEAR_HIP_X;
/** The ears flop behind the head's bob by up to this much. */
const GAIT_EAR_LAG = deg(6);
/**
 * Running clear, he carries both rods levelled out in front rather than at the
 * walking slope, so their balls swing clear of his knees.
 */
const RUN_ROD_LIFT = deg(40);

function gaitFrame(frame: number, gait: Gait, charge: number): ElectricGoblinFrame {
  const phase = frame / gait.frames;
  const nearFoot = footAt(phase, gait);
  const farFoot = footAt(phase + HALF, gait);
  const doubleBeat = Math.cos(phase * FULL_CYCLE * FOOTFALLS_PER_CYCLE);
  const bothDown = planted(phase, gait) + planted(phase + HALF, gait);
  const flight = bothDown === 0 ? 1 : 0;
  const drop = gait.drop * (HALF + HALF * doubleBeat);
  // Contact is phase 0 for the near foot, when it is furthest forward: its own
  // arm is then furthest back, so the swing is a cosine of the gait phase.
  const swing = Math.cos(phase * FULL_CYCLE);
  const nearHand = pt(
    REST_NEAR_HAND.x - gait.armSwing * swing,
    REST_NEAR_HAND.y - gait.carryLift - gait.armSwing * HALF * Math.abs(swing),
  );
  const farHand = pt(
    REST_FAR_HAND.x + gait.armSwing * swing,
    REST_FAR_HAND.y - gait.carryLift - gait.armSwing * HALF * Math.abs(swing),
  );
  const pose: GoblinPose = {
    ...RESTING,
    bob: drop - gait.flightRise * flight,
    lean: gait.lean + gait.leanBob * doubleBeat,
    nearFoot: pt(NEAR_HIP_X + gait.footBias + nearFoot.x, nearFoot.y),
    farFoot: pt(FAR_HIP_X + gait.footBias + farFoot.x, farFoot.y),
    nearHand,
    farHand,
    headTilt: -gait.lean * HALF,
    earLag: GAIT_EAR_LAG * (HALF + HALF * doubleBeat),
  };
  const runLift = gait.carryLift > 0 ? -RUN_ROD_LIFT : 0;
  return frameOf(
    pose,
    REST_NEAR_ROD + runLift + gait.rodSwing * swing,
    REST_FAR_ROD + runLift - gait.rodSwing * swing,
    generatorAt(frame, SPIN_RATE.walking, charge),
  );
}

/** Ground one walk cycle covers, in tiles; the runtime advances the walk by distance at this rate. */
const ELECTRIC_GOBLIN_WALK_GROUND_PER_CYCLE_TILES = groundPerCycleTiles(WALK);
/** Ground one run cycle covers, in tiles. */
const ELECTRIC_GOBLIN_RUN_GROUND_PER_CYCLE_TILES = groundPerCycleTiles(RUN);

// ── Keyframes ────────────────────────────────────────────────────────────────

/** One keyframe of an action: where both fists are and how the body is set. */
interface Key {
  readonly near: Pt;
  readonly far: Pt;
  readonly nearRod: number;
  readonly farRod: number;
  readonly lean: number;
  readonly bob: number;
  readonly sway: number;
  readonly headTilt: number;
}

const REST_KEY: Key = {
  near: REST_NEAR_HAND,
  far: REST_FAR_HAND,
  nearRod: REST_NEAR_ROD,
  farRod: REST_FAR_ROD,
  lean: 0,
  bob: 0,
  sway: 0,
  headTilt: 0,
};

function blend(a: Key, b: Key, t: number): Key {
  return {
    near: mixPt(a.near, b.near, t),
    far: mixPt(a.far, b.far, t),
    nearRod: lerp(a.nearRod, b.nearRod, t),
    farRod: lerp(a.farRod, b.farRod, t),
    lean: lerp(a.lean, b.lean, t),
    bob: lerp(a.bob, b.bob, t),
    sway: lerp(a.sway, b.sway, t),
    headTilt: lerp(a.headTilt, b.headTilt, t),
  };
}

function poseOfKey(key: Key, extra: Partial<GoblinPose> = {}): GoblinPose {
  return {
    ...RESTING,
    nearHand: key.near,
    farHand: key.far,
    lean: key.lean,
    bob: key.bob,
    sway: key.sway,
    headTilt: key.headTilt,
    ...extra,
  };
}

/** Progress through a one-shot row, sampled mid-frame so the last frame is short of 1. */
function shot(frame: number, frames: number): number {
  return (frame + HALF) / frames;
}

/** Which segment of a keyed timeline `t` is in, and how far through it. */
function segment(
  t: number,
  stops: readonly number[],
): { readonly index: number; readonly local: number } {
  for (let i = 0; i < stops.length - 1; i++) {
    if (t < stops[i + 1]) return { index: i, local: (t - stops[i]) / (stops[i + 1] - stops[i]) };
  }
  return { index: stops.length - 2, local: 1 };
}

// ── Grenade toss ─────────────────────────────────────────────────────────────

const TOSS_FRAMES = 14;
/** The frame the grenade leaves the near rod's ball. */
export const GRENADE_RELEASE_FRAME = 8;

/** Wound back: the near rod pointing back behind him, the grenade on its ball. */
const TOSS_COCK: Key = {
  near: pt(-0.15, -0.95),
  far: pt(0.35, -0.72),
  nearRod: deg(-165),
  farRod: deg(15),
  lean: deg(-8),
  bob: 0.04,
  sway: -0.06,
  headTilt: deg(-6),
};
/** Released: the rod flung forward and up over his head. */
const TOSS_RELEASE: Key = {
  near: pt(0.6, -1.32),
  far: pt(-0.05, -0.55),
  nearRod: deg(-55),
  farRod: deg(55),
  lean: deg(10),
  bob: 0.02,
  sway: 0.07,
  headTilt: deg(-12),
};
const TOSS_FOLLOW: Key = {
  near: pt(0.62, -0.75),
  far: pt(0.0, -0.5),
  nearRod: deg(20),
  farRod: deg(40),
  lean: deg(12),
  bob: 0.03,
  sway: 0.06,
  headTilt: 0,
};
/** Share of the row each beat ends at: wind, throw (ending on the release), follow, settle. */
const TOSS_WOUND_FRAME = 5;
const TOSS_FOLLOWED_FRAME = 11;
const TOSS_STOPS = [
  0,
  TOSS_WOUND_FRAME / TOSS_FRAMES,
  (GRENADE_RELEASE_FRAME + HALF) / TOSS_FRAMES,
  TOSS_FOLLOWED_FRAME / TOSS_FRAMES,
  1,
];
const TOSS_THROW_BEAT = 1;
/** The release flash lasts the release frame and the one after it. */
const TOSS_FLASH_FRAMES = 2;

function tossFrame(frame: number): ElectricGoblinFrame {
  const t = shot(frame, TOSS_FRAMES);
  const { index, local } = segment(t, TOSS_STOPS);
  const keys = [REST_KEY, TOSS_COCK, TOSS_RELEASE, TOSS_FOLLOW, REST_KEY];
  const throwing = index === TOSS_THROW_BEAT;
  const ease = throwing ? easeIn(local) : index === 0 ? easeInOut(local) : easeOut(local);
  const key = blend(keys[index], keys[index + 1], ease);
  const releaseShare = (GRENADE_RELEASE_FRAME + HALF) / TOSS_FRAMES;
  const charge = lerp(IDLE_CHARGE, 1, clamp01(t / releaseShare));
  const released = frame >= GRENADE_RELEASE_FRAME;
  // The rod passes behind his skull as it winds back over the top.
  const rodBehindHead = index === 0 || (throwing && local < HALF);
  return frameOf(
    poseOfKey(key, {
      ...(throwing ? FACE.roar : FACE.effort),
      nearArmUnderHead: rodBehindHead,
    }),
    key.nearRod,
    key.farRod,
    generatorAt(frame, SPIN_RATE.working, released ? IDLE_CHARGE : charge),
    released && frame < GRENADE_RELEASE_FRAME + TOSS_FLASH_FRAMES
      ? { ...NO_ELECTRIC_EFFECTS, nearSparks: CRACKLE.release, seed: frame }
      : NO_ELECTRIC_EFFECTS,
    !released,
  );
}

// ── Tells: rods raised, then crackling until the strike ──────────────────────

/** Frames spent raising the rods before a tell's crackling loop starts. */
const TELL_RAISE_FRAMES = 4;
const TELL_LOOP_FRAMES = 6;
const TELL_FRAMES = TELL_RAISE_FRAMES + TELL_LOOP_FRAMES;
/** A tell's crackle plays faster than the body moves: lightning, not breath. */
const TELL_FPS = 12;
const TELL_TREMBLE = 0.01;
/** His jaw chatters with the current while he holds a tell. */
const TELL_JAW_CHATTER = 0.25;

/** Both rods straight up over his head, balls high, an arc between them. */
const PLUNGE_OVERHEAD: Key = {
  near: pt(0.42, -1.62),
  far: pt(-0.04, -1.47),
  nearRod: deg(-98),
  farRod: deg(-78),
  lean: deg(-5),
  bob: 0.02,
  sway: 0,
  headTilt: deg(-14),
};

/** Both rods cocked back over his shoulders, balls behind his head. */
const SLAM_COCKED: Key = {
  near: pt(0.18, -1.32),
  far: pt(-0.08, -1.28),
  nearRod: deg(-148),
  farRod: deg(-138),
  lean: deg(-9),
  bob: 0.07,
  sway: -0.04,
  headTilt: deg(-4),
};

function tellFrame(
  frame: number,
  target: Key,
  crackle: Partial<ElectricEffects>,
): ElectricGoblinFrame {
  if (frame < TELL_RAISE_FRAMES) {
    const t = easeInOut((frame + 1) / TELL_RAISE_FRAMES);
    const key = blend(REST_KEY, target, t);
    return frameOf(
      poseOfKey(key, FACE.effort),
      key.nearRod,
      key.farRod,
      generatorAt(frame, SPIN_RATE.working, lerp(IDLE_CHARGE, 1, t)),
    );
  }
  const loop = frame - TELL_RAISE_FRAMES;
  const shudder = loop % 2;
  const tremble = shudder === 0 ? TELL_TREMBLE : -TELL_TREMBLE;
  const key: Key = {
    ...target,
    near: pt(target.near.x + tremble, target.near.y),
    far: pt(target.far.x - tremble, target.far.y),
  };
  return frameOf(
    poseOfKey(key, {
      eyeOpen: FACE.roar.eyeOpen,
      mouthOpen: FACE.roar.mouthOpen - TELL_JAW_CHATTER * (1 - shudder),
    }),
    key.nearRod,
    key.farRod,
    generatorAt(frame, SPIN_RATE.flatOut, 1),
    { ...NO_ELECTRIC_EFFECTS, ...crackle, seed: loop + 1 },
  );
}

// ── Plunge ───────────────────────────────────────────────────────────────────

const PLUNGE_FRAMES = 12;
/** The frame both balls go into the floor. */
export const PLUNGE_IMPACT_FRAME = 3;
/** The last frame the rods stay in the floor before he hauls them out. */
const PLUNGE_HOLD_UNTIL = 8;

/** Rods driven into the floor in front of his boots, crouched over them. */
const PLUNGE_DOWN: Key = {
  near: pt(0.62, -0.68),
  far: pt(0.3, -0.62),
  nearRod: deg(62),
  farRod: deg(72),
  lean: deg(18),
  bob: 0.1,
  sway: 0.03,
  headTilt: deg(-10),
};

function plungeFrame(frame: number): ElectricGoblinFrame {
  if (frame <= PLUNGE_IMPACT_FRAME) {
    const t = easeIn((frame + 1) / (PLUNGE_IMPACT_FRAME + 1));
    const key = blend(PLUNGE_OVERHEAD, PLUNGE_DOWN, t);
    return frameOf(
      poseOfKey(key, FACE.roar),
      key.nearRod,
      key.farRod,
      generatorAt(frame, SPIN_RATE.flatOut, 1),
      frame === PLUNGE_IMPACT_FRAME
        ? {
            ...NO_ELECTRIC_EFFECTS,
            nearSparks: CRACKLE.plungeImpact,
            farSparks: CRACKLE.plungeImpact,
            rodCrawl: 1,
            seed: frame,
          }
        : NO_ELECTRIC_EFFECTS,
    );
  }
  if (frame <= PLUNGE_HOLD_UNTIL) {
    return frameOf(
      poseOfKey(PLUNGE_DOWN, FACE.strain),
      PLUNGE_DOWN.nearRod,
      PLUNGE_DOWN.farRod,
      generatorAt(frame, SPIN_RATE.flatOut, 1),
      {
        ...NO_ELECTRIC_EFFECTS,
        nearSparks: CRACKLE.plungeHold,
        farSparks: CRACKLE.plungeHold,
        rodCrawl: CRACKLE.plungeHoldCrawl,
        coilArc: CRACKLE.plungeHoldCoils,
        seed: frame,
      },
    );
  }
  const t = easeInOut((frame - PLUNGE_HOLD_UNTIL) / (PLUNGE_FRAMES - PLUNGE_HOLD_UNTIL));
  const key = blend(PLUNGE_DOWN, REST_KEY, t);
  return frameOf(
    poseOfKey(key),
    key.nearRod,
    key.farRod,
    generatorAt(frame, SPIN_RATE.walking, lerp(1, IDLE_CHARGE, t)),
  );
}

// ── Swipe ────────────────────────────────────────────────────────────────────

const SWIPE_FRAMES = 10;
/** The frame the near rod's ball connects. */
export const SWIPE_IMPACT_FRAME = 4;

const SWIPE_WIND: Key = {
  near: pt(0.12, -1.28),
  far: pt(0.2, -0.7),
  nearRod: deg(-150),
  farRod: deg(20),
  lean: deg(-6),
  bob: 0.03,
  sway: -0.04,
  headTilt: deg(-4),
};
const SWIPE_HIT: Key = {
  near: pt(0.78, -0.82),
  far: pt(-0.08, -0.55),
  nearRod: deg(8),
  farRod: deg(45),
  lean: deg(12),
  bob: 0.05,
  sway: 0.07,
  headTilt: deg(-6),
};
const SWIPE_FOLLOW: Key = {
  near: pt(0.62, -0.58),
  far: pt(-0.06, -0.52),
  nearRod: deg(28),
  farRod: deg(40),
  lean: deg(10),
  bob: 0.04,
  sway: 0.05,
  headTilt: 0,
};
const SWIPE_WOUND_FRAME = 3;
/** The follow-through ends midway through this frame. */
const SWIPE_FOLLOWED_FRAME = 6;
const SWIPE_STOPS = [
  0,
  SWIPE_WOUND_FRAME / SWIPE_FRAMES,
  (SWIPE_IMPACT_FRAME + HALF) / SWIPE_FRAMES,
  (SWIPE_FOLLOWED_FRAME + HALF) / SWIPE_FRAMES,
  1,
];
const SWIPE_STRIKE_BEAT = 1;
const SWIPE_FOLLOW_BEAT = 2;

function swipeFrame(frame: number): ElectricGoblinFrame {
  const t = shot(frame, SWIPE_FRAMES);
  const { index, local } = segment(t, SWIPE_STOPS);
  const keys = [REST_KEY, SWIPE_WIND, SWIPE_HIT, SWIPE_FOLLOW, REST_KEY];
  // The wind-up rotates the rod back over the top; the strike brings it on
  // round the same way, so the angle runs one way through the whole swing.
  const swinging = index === SWIPE_STRIKE_BEAT;
  const ease = swinging ? easeIn(local) : easeInOut(local);
  const key = blend(keys[index], keys[index + 1], ease);
  const live = index === SWIPE_STRIKE_BEAT || index === SWIPE_FOLLOW_BEAT;
  return frameOf(
    poseOfKey(key, { ...(swinging ? FACE.roar : FACE.effort), nearArmUnderHead: index === 0 }),
    key.nearRod,
    key.farRod,
    generatorAt(frame, SPIN_RATE.working, live ? 1 : IDLE_CHARGE),
    frame === SWIPE_IMPACT_FRAME
      ? { ...NO_ELECTRIC_EFFECTS, nearSparks: CRACKLE.swipeFlash, seed: frame }
      : NO_ELECTRIC_EFFECTS,
  );
}

// ── Slam ─────────────────────────────────────────────────────────────────────

const SLAM_FRAMES = 12;
/** The frame both balls hit the floor and the wave sets off. */
export const SLAM_IMPACT_FRAME = 4;
const SLAM_HOLD_UNTIL = 8;

/** Rods brought over the top: both straight up above his head mid-swing. */
const SLAM_OVER: Key = {
  near: pt(0.48, -1.6),
  far: pt(0.15, -1.48),
  nearRod: deg(-88),
  farRod: deg(-82),
  lean: deg(4),
  bob: 0,
  sway: 0.02,
  headTilt: deg(-10),
};
/** Both balls smashed into the floor far out in front, his weight thrown after them. */
const SLAM_DOWN: Key = {
  near: pt(0.74, -0.52),
  far: pt(0.44, -0.5),
  nearRod: deg(32),
  farRod: deg(36),
  lean: deg(26),
  bob: 0.11,
  sway: 0.08,
  headTilt: deg(-14),
};

function slamFrame(frame: number): ElectricGoblinFrame {
  if (frame <= SLAM_IMPACT_FRAME) {
    const t = (frame + 1) / (SLAM_IMPACT_FRAME + 1);
    const key =
      t < HALF
        ? blend(SLAM_COCKED, SLAM_OVER, easeIn(t / HALF))
        : blend(SLAM_OVER, SLAM_DOWN, easeIn((t - HALF) / HALF));
    return frameOf(
      poseOfKey(key, FACE.roar),
      key.nearRod,
      key.farRod,
      generatorAt(frame, SPIN_RATE.flatOut, 1),
      frame === SLAM_IMPACT_FRAME
        ? {
            ...NO_ELECTRIC_EFFECTS,
            nearSparks: CRACKLE.slamImpact,
            farSparks: CRACKLE.slamImpact,
            bridge: 1,
            seed: frame,
          }
        : { ...NO_ELECTRIC_EFFECTS, rodCrawl: CRACKLE.slamSwingCrawl, seed: frame },
    );
  }
  if (frame <= SLAM_HOLD_UNTIL) {
    return frameOf(
      poseOfKey(SLAM_DOWN, FACE.strain),
      SLAM_DOWN.nearRod,
      SLAM_DOWN.farRod,
      generatorAt(
        frame,
        SPIN_RATE.working,
        lerp(1, IDLE_CHARGE, (frame - SLAM_IMPACT_FRAME) / (SLAM_HOLD_UNTIL - SLAM_IMPACT_FRAME)),
      ),
      {
        ...NO_ELECTRIC_EFFECTS,
        nearSparks: CRACKLE.slamAftershock,
        farSparks: CRACKLE.slamAftershock,
        seed: frame,
      },
    );
  }
  const t = easeInOut((frame - SLAM_HOLD_UNTIL) / (SLAM_FRAMES - SLAM_HOLD_UNTIL));
  const key = blend(SLAM_DOWN, REST_KEY, t);
  return frameOf(poseOfKey(key), key.nearRod, key.farRod, hum(frame));
}

// ── Block ────────────────────────────────────────────────────────────────────

const BLOCK_FRAMES = 10;
/** The frame the crossed rods throw their sparks: the missile is turned aside. */
const BLOCK_SPARK_FRAME = 2;
const BLOCK_HOLD_UNTIL = 6;

/** The rods crossed in an X in front of his face. */
const BLOCK_CROSSED: Key = {
  near: pt(0.6, -0.98),
  far: pt(0.22, -1.02),
  nearRod: deg(-122),
  farRod: deg(-58),
  lean: deg(-6),
  bob: 0.03,
  sway: -0.04,
  headTilt: deg(8),
};

function blockFrame(frame: number): ElectricGoblinFrame {
  const crossing = frame < BLOCK_SPARK_FRAME;
  const releasing = frame > BLOCK_HOLD_UNTIL;
  const t = crossing
    ? easeOut((frame + 1) / BLOCK_SPARK_FRAME)
    : releasing
      ? 1 - easeInOut((frame - BLOCK_HOLD_UNTIL) / (BLOCK_FRAMES - 1 - BLOCK_HOLD_UNTIL))
      : 1;
  const key = blend(REST_KEY, BLOCK_CROSSED, t);
  const spark =
    frame >= BLOCK_SPARK_FRAME && !releasing
      ? 1 - (frame - BLOCK_SPARK_FRAME) / (BLOCK_HOLD_UNTIL - BLOCK_SPARK_FRAME + 1)
      : 0;
  return frameOf(
    poseOfKey(key, { ...FACE.wince, offHandInFront: t > HALF }),
    key.nearRod,
    key.farRod,
    generatorAt(frame, SPIN_RATE.walking, lerp(IDLE_CHARGE, 1, spark)),
    spark > 0
      ? {
          ...NO_ELECTRIC_EFFECTS,
          nearSparks: CRACKLE.blockFlash * spark,
          farSparks: CRACKLE.blockFlash * spark,
          bridge: spark,
          seed: frame,
        }
      : NO_ELECTRIC_EFFECTS,
  );
}

// ── Hurt ─────────────────────────────────────────────────────────────────────

const HURT_FRAMES = 6;
const HURT_RECOIL: Key = {
  near: pt(0.42, -0.72),
  far: pt(-0.12, -0.62),
  nearRod: deg(20),
  farRod: deg(15),
  lean: deg(-12),
  bob: 0.03,
  sway: -0.06,
  headTilt: deg(-16),
};

/** The frame the hit lands: the recoil's peak, and the generator coughs an arc. */
const HURT_PEAK_FRAME = 1;
const HURT_EYES = 0.15;
const HURT_JAW = 0.9;
const HURT_EAR_FLING = deg(14);

function hurtFrame(frame: number): ElectricGoblinFrame {
  // Snaps to the recoil on the first frame after the hit, then eases back.
  const t =
    frame < HURT_PEAK_FRAME
      ? HALF
      : frame === HURT_PEAK_FRAME
        ? 1
        : 1 - easeInOut((frame - HURT_PEAK_FRAME) / (HURT_FRAMES - 1 - HURT_PEAK_FRAME));
  const key = blend(REST_KEY, HURT_RECOIL, t);
  return frameOf(
    poseOfKey(key, { eyeOpen: HURT_EYES, mouthOpen: HURT_JAW * t, earLag: HURT_EAR_FLING * t }),
    key.nearRod,
    key.farRod,
    hum(frame),
    frame === HURT_PEAK_FRAME
      ? { ...NO_ELECTRIC_EFFECTS, coilArc: CRACKLE.hurtCoils, seed: frame }
      : NO_ELECTRIC_EFFECTS,
  );
}

// ── Death ────────────────────────────────────────────────────────────────────

const DEATH_FRAMES = 18;
const DEATH_RECOILED_FRAME = 4;
const DEATH_KNELT_FRAME = 10;
const DEATH_STOPS = [0, DEATH_RECOILED_FRAME / DEATH_FRAMES, DEATH_KNELT_FRAME / DEATH_FRAMES, 1];
const DEATH_RECOIL_BEAT = 0;
const DEATH_KNEEL_BEAT = 1;
/** The generator's light stutters on one frame in this many as it dies. */
const DEATH_FLICKER_PERIOD = 3;
const DEATH_EAR_DROOP = deg(20);
/** His eyes are half shut as he goes down, and shut once he is down. */
const DEATH_EYES_GOING = 0.5;
const DEATH_JAW_SLACK = 0.5;
const DEATH_RECOIL: Key = { ...HURT_RECOIL, lean: deg(-14), bob: 0.05 };
/** On his knees, the rods' balls dragging on the floor. */
const DEATH_KNEEL: Key = {
  near: pt(0.62, -0.45),
  far: pt(0.25, -0.42),
  nearRod: deg(22),
  farRod: deg(28),
  lean: deg(30),
  bob: 0.26,
  sway: -0.06,
  headTilt: deg(10),
};
/** Slumped forward over his knees, fists on the floor, the rods lying flat. */
const DEATH_SLUMP: Key = {
  near: pt(0.78, -0.12),
  far: pt(0.48, -0.12),
  nearRod: deg(4),
  farRod: deg(-6),
  lean: deg(58),
  bob: 0.3,
  sway: -0.1,
  headTilt: deg(22),
};
const KNEEL_NEAR_FOOT = pt(-0.05, 0);
const KNEEL_FAR_FOOT = pt(-0.35, 0);

function deathFrame(frame: number): ElectricGoblinFrame {
  const t = shot(frame, DEATH_FRAMES);
  const { index, local } = segment(t, DEATH_STOPS);
  const keys = [REST_KEY, DEATH_RECOIL, DEATH_KNEEL, DEATH_SLUMP];
  const recoiling = index === DEATH_RECOIL_BEAT;
  const key = blend(keys[index], keys[index + 1], recoiling ? easeOut(local) : easeInOut(local));
  const kneel = recoiling ? 0 : index === DEATH_KNEEL_BEAT ? easeInOut(local) : 1;
  const nearFoot = mixPt(RESTING.nearFoot, KNEEL_NEAR_FOOT, kneel);
  const farFoot = mixPt(RESTING.farFoot, KNEEL_FAR_FOOT, kneel);
  const dying = 1 - clamp01(t / (DEATH_KNELT_FRAME / DEATH_FRAMES));
  const flicker = frame % DEATH_FLICKER_PERIOD === 0 ? 1 : HALF;
  return frameOf(
    poseOfKey(key, {
      nearFoot,
      farFoot,
      eyeOpen: recoiling ? FACE.roar.eyeOpen : lerp(DEATH_EYES_GOING, 0, local),
      mouthOpen: recoiling ? FACE.roar.mouthOpen : DEATH_JAW_SLACK,
      earLag: DEATH_EAR_DROOP * kneel,
    }),
    key.nearRod,
    key.farRod,
    generatorAt(frame, SPIN_RATE.hum * dying, dying * flicker),
    dying > 0
      ? {
          ...NO_ELECTRIC_EFFECTS,
          coilArc: dying,
          nearSparks: dying * CRACKLE.dyingSparks,
          farSparks: dying * CRACKLE.dyingSparks,
          seed: frame,
        }
      : NO_ELECTRIC_EFFECTS,
  );
}

// ── Row table and dispatch ───────────────────────────────────────────────────

/** The death row's last frame lasts as long as the corpse does; the rest go by at this pace. */
const DEATH_FPS = 10;
const STRIKE_FPS = 12;
const REACTION_FPS = 14;

export const ELECTRIC_GOBLIN_ROWS = {
  idle: { kind: 'loop', frames: IDLE_FRAMES, fps: ELECTRIC_GOBLIN_IDLE_FPS },
  walk: {
    kind: 'gait',
    frames: WALK.frames,
    groundPerCycleTiles: ELECTRIC_GOBLIN_WALK_GROUND_PER_CYCLE_TILES,
  },
  run: {
    kind: 'gait',
    frames: RUN.frames,
    groundPerCycleTiles: ELECTRIC_GOBLIN_RUN_GROUND_PER_CYCLE_TILES,
  },
  grenade_toss: {
    kind: 'strike',
    frames: TOSS_FRAMES,
    eventFrame: GRENADE_RELEASE_FRAME,
    fps: STRIKE_FPS,
  },
  plunge_tell: { kind: 'tell', frames: TELL_FRAMES, loopFrom: TELL_RAISE_FRAMES, fps: TELL_FPS },
  plunge: {
    kind: 'strike',
    frames: PLUNGE_FRAMES,
    eventFrame: PLUNGE_IMPACT_FRAME,
    fps: STRIKE_FPS,
  },
  swipe: { kind: 'strike', frames: SWIPE_FRAMES, eventFrame: SWIPE_IMPACT_FRAME, fps: STRIKE_FPS },
  slam_tell: { kind: 'tell', frames: TELL_FRAMES, loopFrom: TELL_RAISE_FRAMES, fps: TELL_FPS },
  slam: { kind: 'strike', frames: SLAM_FRAMES, eventFrame: SLAM_IMPACT_FRAME, fps: STRIKE_FPS },
  block: {
    kind: 'reaction',
    frames: BLOCK_FRAMES,
    eventFrame: BLOCK_SPARK_FRAME,
    fps: REACTION_FPS,
  },
  hurt: { kind: 'reaction', frames: HURT_FRAMES, eventFrame: HURT_PEAK_FRAME, fps: REACTION_FPS },
  death: { kind: 'final', frames: DEATH_FRAMES, fps: DEATH_FPS },
} as const satisfies Record<ElectricGoblinRow, ElectricGoblinRowSpec>;

export const ELECTRIC_GOBLIN_ROW_NAMES: readonly ElectricGoblinRow[] = [
  'idle',
  'walk',
  'run',
  'grenade_toss',
  'plunge_tell',
  'plunge',
  'swipe',
  'slam_tell',
  'slam',
  'block',
  'hurt',
  'death',
];

const PLUNGE_TELL_CRACKLE: Partial<ElectricEffects> = {
  bridge: 1,
  nearSparks: 0.7,
  farSparks: 0.7,
  coilArc: 0.8,
};
const SLAM_TELL_CRACKLE: Partial<ElectricEffects> = {
  rodCrawl: 1,
  nearSparks: 0.8,
  farSparks: 0.8,
  coilArc: 0.6,
};

/** Every frame of every row, as the choreography authors it. */
export function electricGoblinFrame(row: ElectricGoblinRow, frame: number): ElectricGoblinFrame {
  switch (row) {
    case 'idle':
      return idleFrame(frame);
    case 'walk':
      return gaitFrame(frame, WALK, IDLE_CHARGE);
    case 'run':
      return gaitFrame(frame, RUN, IDLE_CHARGE);
    case 'grenade_toss':
      return tossFrame(frame);
    case 'plunge_tell':
      return tellFrame(frame, PLUNGE_OVERHEAD, PLUNGE_TELL_CRACKLE);
    case 'plunge':
      return plungeFrame(frame);
    case 'swipe':
      return swipeFrame(frame);
    case 'slam_tell':
      return tellFrame(frame, SLAM_COCKED, SLAM_TELL_CRACKLE);
    case 'slam':
      return slamFrame(frame);
    case 'block':
      return blockFrame(frame);
    case 'hurt':
      return hurtFrame(frame);
    case 'death':
      return deathFrame(frame);
    default: {
      const unhandled: never = row;
      throw new Error(`no electric goblin row ${String(unhandled)}`);
    }
  }
}

/**
 * The frame a tell row shows `elapsed` frames after it started: the raise once,
 * then the crackle round and round until the strike takes over.
 */
export function electricGoblinTellFrame(row: 'plunge_tell' | 'slam_tell', elapsed: number): number {
  const spec = ELECTRIC_GOBLIN_ROWS[row];
  if (elapsed < spec.loopFrom) return Math.max(0, elapsed);
  const loopLength = spec.frames - spec.loopFrom;
  return spec.loopFrom + ((elapsed - spec.loopFrom) % loopLength);
}

// ── Cell and figure ──────────────────────────────────────────────────────────

/**
 * The cell, measured off the art: wide enough for the slam's rods out in
 * front and the generator behind, tall enough for both rods held straight up
 * over his head. The tile sits under his feet.
 */
const CELL = { frameWidth: 224, frameHeight: 212, tileX: 54, tileY: 116 } as const;

function electricGoblinRowOf(state: string): ElectricGoblinRow | null {
  return ELECTRIC_GOBLIN_ROW_NAMES.find((row) => row === state) ?? null;
}

function rodBalls(frame: ElectricGoblinFrame): RodBalls {
  const skeleton = buildSkeleton(STYLE_AT_REST, frame.pose);
  return {
    near: rodBallPoint(skeleton.nearArm.end, frame.nearRodAngle),
    far: rodBallPoint(skeleton.farArm.end, frame.farRodAngle),
    nearAngle: frame.nearRodAngle,
    farAngle: frame.farRodAngle,
  };
}

const ROD = makeShockRodProp(false);
const ROD_WITH_GRENADE = makeShockRodProp(true);

/**
 * The pieces he comes apart into: the goblin rig's own severed pieces in his
 * rubber kit, at his size. Each is drawn about the middle of the cell, where
 * the gore field spins it.
 */
export const ELECTRIC_GOBLIN_GORE_PARTS: readonly string[] = GOBLIN_GORE_STATES;

const GORE_PIECES = gorePieces(STYLE_AT_REST);

function paintGorePiece(ctx: CanvasRenderingContext2D, state: string): void {
  const piece = GORE_PIECES.find((candidate) => candidate.state === state);
  if (piece === undefined) throw new Error(`no gore piece for electric_goblin "${state}"`);
  ctx.save();
  ctx.translate(CELL.frameWidth / 2, CELL.frameHeight / 2);
  ctx.scale(TILE_SCALE * ELECTRIC_GOBLIN_SCALE, TILE_SCALE * ELECTRIC_GOBLIN_SCALE);
  piece.paint(ctx, STYLE_AT_REST);
  ctx.restore();
}

function paintFrame(ctx: CanvasRenderingContext2D, state: string, frameIndex: number): void {
  const row = electricGoblinRowOf(state);
  if (row === null) {
    paintGorePiece(ctx, state);
    return;
  }
  const frame = electricGoblinFrame(row, frameIndex);
  const style = electricGoblinStyle(frame.generator);
  const balls = rodBalls(frame);
  drawGoblin(
    ctx,
    CELL.tileX + TILE_SCALE / 2,
    CELL.tileY + TILE_SCALE,
    TILE_SCALE * ELECTRIC_GOBLIN_SCALE,
    style,
    frame.pose,
    frame.grenade ? ROD_WITH_GRENADE : ROD,
    ROD,
    (layer, skeleton) =>
      drawElectricGoblinLight(layer, skeleton, style, frame.generator, balls, frame.effects),
  );
}

export const ELECTRIC_GOBLIN_FIGURE: FigureDef = {
  id: 'electric_goblin',
  ...CELL,
  tileScale: TILE_SCALE,
  skipSupersample: true,
  states: figureStates({
    ...Object.fromEntries(
      ELECTRIC_GOBLIN_ROW_NAMES.map((row) => [row, ELECTRIC_GOBLIN_ROWS[row].frames]),
    ),
    ...Object.fromEntries(ELECTRIC_GOBLIN_GORE_PARTS.map((part) => [part, 1])),
  }),
  paintFrame,
};

// ── Anchors the runtime reads ────────────────────────────────────────────────

/** A point on the figure, in tiles from the top-left of the tile it stands on. */
interface TileAnchor {
  readonly x: number;
  readonly y: number;
}

const TILE_CENTRE = 0.5;

function rigToTile(point: Pt): TileAnchor {
  return {
    x: TILE_CENTRE + point.x * ELECTRIC_GOBLIN_SCALE,
    y: 1 + point.y * ELECTRIC_GOBLIN_SCALE,
  };
}

/**
 * Where one rod's ball is on one frame of a row, in tiles from the top-left of
 * the tile the sprite stands on, mirrored about the tile's centre for a goblin
 * facing left. A grenade leaves the near ball on `GRENADE_RELEASE_FRAME`; a
 * plunge or slam lands where the balls are on its impact frame.
 */
export function electricGoblinBallAnchor(
  row: ElectricGoblinRow,
  frame: number,
  rod: 'near' | 'far',
  facingX: number,
): TileAnchor {
  const frames = ELECTRIC_GOBLIN_ROWS[row].frames;
  const authored = electricGoblinFrame(row, ((frame % frames) + frames) % frames);
  const balls = rodBalls(authored);
  const anchor = rigToTile(rod === 'near' ? balls.near : balls.far);
  return facingX >= 0 ? anchor : { x: 1 - anchor.x, y: anchor.y };
}
