/**
 * The five goblins, as painted figures: the choreography, the cell geometry,
 * and the `FigureDef` the runtime cache and the review harness both draw
 * through.
 *
 * This module is choreography and assembly only: the anatomy lives in
 * `goblinArt.ts`, the weapons in `goblinWeapons.ts` and the wounds in
 * `goblinGore.ts`. What is here is *where the hands and feet go on each frame*
 * and where a pose or a severed piece sits inside its cell.
 *
 * Poses are authored as foot and hand **targets**; the rig solves the knees and
 * elbows. That is the single reason a limb stays welded to the body through a
 * 180° swing, and it is why a planted foot can be asserted rather than eyeballed.
 *
 * Every figure is drawn facing +X; the runtime mirrors it for the other facing.
 *
 * The art invariants live in `scripts/gates-goblins.ts`, which the review
 * harness runs: `npm run render:goblins`.
 */

import {
  ARCHETYPE_SCALE,
  GOBLIN_ARMED_ARCHETYPES,
  GOBLIN_PLUMBER_SCALE,
  GOBLIN_PLUMBER_STYLE,
  GOBLIN_STYLES,
  along,
  clamp01,
  deg,
  drawGoblin,
  easeIn,
  easeInOut,
  easeOut,
  farArmSpan,
  hipJointOffset,
  hump,
  lerp,
  pt,
  restingPose,
  buildSkeleton,
  seededNoise,
  shoulderHeight,
  type GoblinArmedArchetype,
  type GoblinPose,
  type GoblinProp,
  type GoblinStyle,
  type Pt,
} from './goblinArt';
import {
  WEAPON_FACTORIES,
  bowStringPull,
  makePipeWrenchProp,
  setBowDraw,
  type BowDraw,
} from './goblinWeapons';
import { gorePieces, type GorePiece } from './goblinGore';
import { type FigureDef, figureStates } from '../figure/figureDef';

/** Tile size the art is drawn at; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;

const FULL_CYCLE = Math.PI * 2;

// ── Row manifest ─────────────────────────────────────────────────────────────

export type RowKind = 'loop' | 'oneShot';

export interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly kind: RowKind;
}

/**
 * Uniform across all five figures, so the sword's states and the war hammer's
 * are the same names and the runtime needs no per-weapon state mapping — and
 * therefore no casts.
 */
export const ROWS: readonly RowSpec[] = [
  { name: 'walk', frameCount: 12, kind: 'loop' },
  { name: 'idle', frameCount: 16, kind: 'loop' },
  { name: 'idle_break', frameCount: 18, kind: 'oneShot' },
  { name: 'attack_light', frameCount: 14, kind: 'oneShot' },
  { name: 'attack_heavy', frameCount: 18, kind: 'oneShot' },
  { name: 'flinch', frameCount: 5, kind: 'oneShot' },
];

/**
 * Sprite frame each attack connects on. `GOBLIN_ATTACKS` in
 * `src/sprites/goblinSprite.ts` carries the same numbers and an art gate
 * asserts the two match — if one moves, both move.
 */
export const IMPACT_FRAMES: Record<GoblinArmedArchetype, { light: number; heavy: number }> = {
  sword: { light: 6, heavy: 8 },
  axe: { light: 6, heavy: 9 },
  mace: { light: 7, heavy: 8 },
  warhammer: { light: 7, heavy: 10 },
  // The frame the string is released on, not a frame anything is struck on.
  bow: { light: 10, heavy: 13 },
};

/**
 * Loops sample the cycle evenly; one-shots sample the middle of each frame.
 *
 * Exported because the pixels cannot say how much of a cycle a row covers: a
 * gait's pose distance saturates, so a row running one and a half turns wraps
 * by about as much as it steps and reads as an ordinary loop. The loop gate
 * asserts the coverage on this mapping, where the defect is unambiguous.
 */
export function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

/**
 * One-shots sample `(frame + 0.5) / frameCount`. Using `frameCount − 1` for a
 * loop double-draws the seam and makes every cycle hitch once; using it for a
 * one-shot puts the last frame at exactly 1.0 and loses the recovery.
 */
function shotProgress(frame: number, frameCount: number): number {
  return (frame + 0.5) / frameCount;
}

function rowByName(name: string): RowSpec {
  const found = ROWS.find((row) => row.name === name);
  if (found === undefined) throw new Error(`no row named ${name}`);
  return found;
}

/** Frames one animation row holds. Throws on a row the figures do not paint. */
export function goblinRowFrameCount(name: string): number {
  return rowByName(name).frameCount;
}

/** Progress at which an attack's impact frame lands. */
function impactProgress(archetype: GoblinArmedArchetype, kind: 'light' | 'heavy'): number {
  const row = rowByName(kind === 'light' ? 'attack_light' : 'attack_heavy');
  return shotProgress(IMPACT_FRAMES[archetype][kind], row.frameCount);
}

// ── Walk ─────────────────────────────────────────────────────────────────────

/** Fraction of a stride a foot spends planted. High: goblins scuttle. */
const CONTACT_FRACTION = 0.62;
/** Two footfalls per cycle, so the pelvis rises twice as fast as it strides. */
const BOB_PER_CYCLE = 2;
/** Ears trail the head by this many frames of the walk row. */
const EAR_LAG_FRAMES = 2;
const EAR_LAG_PHASE = EAR_LAG_FRAMES / rowByName('walk').frameCount;

interface GaitConfig {
  /** Half the distance between the forward and rear extremes of a stride. */
  readonly stride: number;
  readonly lift: number;
  readonly bob: number;
  readonly leanSwing: number;
  /** Forward/back travel of the free hand as it counter-swings the legs. */
  readonly armSwing: number;
  /** The weapon arm swings less: the weapon's mass damps it. */
  readonly weaponArmDamping: number;
  /** A bird-like forward-and-back head bob, not an up-and-down one. */
  readonly headLead: number;
}

/**
 * Ground one walk cycle covers, in tiles, for a gait drawn at `drawScale`: a
 * planted foot travels the whole stride, twice its half-stride, during the
 * contact share of the cycle. The runtime advances the cycle by ground actually
 * covered at this rate, which is the only pacing that keeps a planted foot
 * still on the floor.
 */
function groundPerCycleTiles(gait: GaitConfig, drawScale: number): number {
  return (2 * gait.stride * drawScale) / CONTACT_FRACTION;
}

/** Ground one of an archetype's walk cycles covers, in tiles. */
export function goblinWalkGroundPerCycleTiles(archetype: GoblinArmedArchetype): number {
  return groundPerCycleTiles(GAITS[archetype], ARCHETYPE_SCALE[archetype]);
}

/** Where a foot sits at `phase` (0–1) of its own stride cycle. */
function footTarget(phase: number, config: GaitConfig): Pt {
  const wrapped = phase - Math.floor(phase);
  const x =
    wrapped < CONTACT_FRACTION
      ? lerp(config.stride, -config.stride, wrapped / CONTACT_FRACTION)
      : lerp(
          -config.stride,
          config.stride,
          easeInOut((wrapped - CONTACT_FRACTION) / (1 - CONTACT_FRACTION)),
        );
  const swing = (wrapped - CONTACT_FRACTION) / (1 - CONTACT_FRACTION);
  const y = wrapped < CONTACT_FRACTION ? 0 : -config.lift * Math.sin(swing * Math.PI);
  return { x, y };
}

const GAITS: Record<GoblinArmedArchetype, GaitConfig> = {
  sword: {
    stride: 0.34,
    lift: 0.13,
    bob: 0.055,
    leanSwing: deg(3),
    armSwing: 0.24,
    weaponArmDamping: 0.45,
    headLead: 0.035,
  },
  axe: {
    stride: 0.32,
    lift: 0.105,
    bob: 0.062,
    leanSwing: deg(3.5),
    armSwing: 0.2,
    weaponArmDamping: 0.3,
    headLead: 0.03,
  },
  mace: {
    stride: 0.3,
    lift: 0.095,
    bob: 0.078,
    leanSwing: deg(4),
    armSwing: 0.19,
    weaponArmDamping: 0.5,
    headLead: 0.026,
  },
  warhammer: {
    stride: 0.32,
    lift: 0.088,
    bob: 0.086,
    leanSwing: deg(3),
    armSwing: 0.15,
    weaponArmDamping: 0.2,
    headLead: 0.02,
  },
  // The longest stride in the set: this one is not scuttling in to swing at
  // anybody, it is repositioning. Without enough bob the head sits at a
  // constant height across all twelve frames and the whole walk reads as a
  // figure on a conveyor — a stride needs the hips to rise and fall, or nothing
  // about it lands.
  bow: {
    stride: 0.36,
    lift: 0.15,
    bob: 0.07,
    leanSwing: deg(3),
    armSwing: 0.3,
    weaponArmDamping: 0.6,
    headLead: 0.045,
  },
};

/**
 * Where an armed goblin's weapon hand sits at rest.
 *
 * Not the unarmed resting hand: that one hangs at full length beside the knee,
 * and a weapon held there points along the ground with both arms stretched out
 * in front, which reads as pushing a lawnmower. A carried weapon is held in
 * close to the hip and a little higher, so the haft crosses the body and the
 * head rests on the floor at a believable angle.
 */
interface CarryConfig {
  /** How far out from the spine the weapon hand rides, in hip half-widths. */
  readonly hipFraction: number;
  /** How high it rides, as a fraction of the goblin's own shoulder height. */
  readonly heightFraction: number;
  /**
   * A carry angle stated outright, instead of solved for ground clearance.
   *
   * {@link carryAngle} answers "how steeply can this hang without the head going
   * through the floor", which is the right question for a weapon with a head.
   * A bow has none — both its ends are tips — and the solve puts it right up
   * against `MAX_CARRY_ANGLE`, where `asin` is nearly vertical: the idle's own
   * breathing bob then swings the stave several degrees a frame, which shows up
   * as a spacing cliff between neighbouring frames. Stating the angle removes
   * the derivative along with the cliff.
   */
  readonly angle?: number;
}

/**
 * Where each archetype's weapon hand sits at rest.
 *
 * Per-archetype rather than one shared pair, and the axe is the reason. The
 * height ends up in {@link carryAngle}, which solves for the steepest angle
 * that still keeps the weapon's tip off the floor — so a low hand on a long
 * weapon *forces* a near-horizontal haft. At a shared low carry height the axe
 * hangs well off level, and a broad bit hanging off a horizontal stick at ankle
 * height reads as a spade however the head itself is drawn: hand height, not
 * the head art, is what sells the silhouette.
 *
 * The two numbers have to move together on a two-handed weapon. Raising the
 * hand alone pulls the butt grip in under the far shoulder, and the off arm —
 * which has only 0.72 of the near arm's length — folds to a third of its span
 * and throws its elbow up behind the shoulder, reading as an arm on upside
 * down, even though the fist stays correctly placed on the haft. Carrying
 * further *out* as well as up keeps the off arm's span past half its reach,
 * which is where it bends like an arm.
 *
 * Note the trap in the other direction: `GoblinProp.headHalfHeight` feeds the
 * same solve, so making the bit *taller* to read better lowers the carry angle
 * and undoes this.
 */
/** How steeply a slung bow hangs from the fist. Near vertical; see {@link CarryConfig.angle}. */
const BOW_CARRY_ANGLE = deg(62);

const CARRIES: Record<GoblinArmedArchetype, CarryConfig> = {
  sword: { hipFraction: 1.25, heightFraction: 0.46 },
  axe: { hipFraction: 1.6, heightFraction: 0.62 },
  mace: { hipFraction: 1.25, heightFraction: 0.46 },
  warhammer: { hipFraction: 1.25, heightFraction: 0.46 },
  // Held high and *well clear of the body*, and the hip fraction is the load
  // bearing half of that. The height sets the carry angle (see `carryAngle`),
  // and near-vertical is what makes a hanging bow read as a bow rather than as
  // a tail. But a near-vertical stave carried at the hip lies straight down the
  // middle of the torso and reads as an ironing board. The stave is 0.5 tiles
  // either side of the fist, so the fist has to sit further out than the
  // shoulder is wide before the bow becomes a separate shape in pure black.
  bow: { hipFraction: 3.6, heightFraction: 0.62, angle: BOW_CARRY_ANGLE },
};

function carryHand(archetype: GoblinArmedArchetype, style: GoblinStyle): Pt {
  const carry = CARRIES[archetype];
  return {
    x: style.proportions.hipHalfWidth * carry.hipFraction,
    y: -shoulderHeight(style.proportions) * carry.heightFraction,
  };
}

/**
 * The steepest a carried weapon may hang. Every resting and walking frame hangs
 * the weapon at whatever angle {@link carryAngle} returns, and this is the limit
 * past which the blade would swing tens of degrees between neighbouring frames.
 */
const MAX_CARRY_ANGLE = deg(70);

/**
 * How far a carried weapon's tip is held clear of the floor, in tile units.
 *
 * A carried weapon's tip resting exactly on the ground plane fails the
 * silhouette test: the axe head and the mace head land in among the feet,
 * merging with them and with the ground shadow into a hunched blob with a lump
 * at the bottom. The weapon has to sit against empty background to be
 * nameable.
 */
const CARRY_GROUND_CLEARANCE = 0.1;

/**
 * The steepest a weapon may point downward before its tip is through the floor.
 *
 * A goblin's weapon is over half its own height, so a swing driven down from
 * chest height buries the head in the ground long before the authored follow
 * angle is reached — the war hammer's finished 18 px below its own feet, which
 * at 32 px reads as a grey puddle under the sprite rather than as a weapon.
 * Capping the angle instead of retuning each swing's keyframes means a retimed
 * attack cannot reintroduce it, and the cap bites smoothly: both the hand height
 * and the authored angle vary continuously, so the tip decelerates into the
 * floor and skids along it, which is what a slam looks like anyway.
 */
function groundLandingAngle(prop: GoblinProp, handY: number): number {
  return Math.asin(clamp01((-handY - groundDrop(prop)) / prop.tipDistance));
}

/** Clearance plus however far the weapon's own head hangs below its axis. */
function groundDrop(prop: GoblinProp): number {
  return CARRY_GROUND_CLEARANCE + prop.headHalfHeight;
}

/** The carry angle for one archetype: its stated one, or the solved one. */
function carryAngleFor(
  archetype: GoblinArmedArchetype,
  style: GoblinStyle,
  prop: GoblinProp,
  handY: number,
): number {
  return CARRIES[archetype].angle ?? carryAngle(style, prop, handY);
}

function carryAngle(style: GoblinStyle, prop: GoblinProp, handY: number): number {
  // Capped short of vertical because `asin` is near-vertical as its argument
  // approaches 1: a hand raised to within a few percent of the weapon's own
  // length would otherwise swing the blade tens of degrees in a single frame,
  // which a player sees as a snap.
  const dropToClearance = -handY - groundDrop(prop);
  const reachRatio = Math.min(
    clamp01(dropToClearance / prop.tipDistance),
    Math.sin(MAX_CARRY_ANGLE),
  );
  return Math.asin(reachRatio);
}

/** Put the off hand on a two-handed haft, or leave it where the pose wants it. */
function gripFarHand(prop: GoblinProp, nearHand: Pt, weaponAngle: number, fallback: Pt): Pt {
  if (prop.offGripDistance === null) return fallback;
  return along(nearHand, weaponAngle, prop.offGripDistance);
}

/**
 * How much higher a walking goblin carries its weapon than a standing one, in
 * tile units: clear of the knees and the floor, riding across the body.
 */
const WALK_CARRY_LIFT = 0.16;
/**
 * How much lower a walking goblin carries its hips than a standing one, in
 * tile units: the sneaking crouch, and the bend that lets a short leg reach a
 * long stride without straightening at contact.
 */
const WALK_CROUCH = 0.06;
/** How far each hand rises at the ends of its swing, as a share of the swing. */
const ARM_SWING_RISE = 0.2;
/** How far the ears trail the head's bob, in radians at the top of each bounce. */
const WALK_EAR_LAG = deg(-8);
/**
 * The free arm's swing as a share of the gait's. It hangs from the far shoulder
 * behind the body, so its back-swing is the only half the camera sees, and at
 * the gait's full swing that half stuck out behind like a reaching arm.
 */
const FREE_ARM_SWING_SHARE = 0.7;
/** The head nods with each step by this much. */
const WALK_HEAD_NOD = deg(2);

function walkPose(
  archetype: GoblinArmedArchetype,
  style: GoblinStyle,
  prop: GoblinProp,
  phase: number,
): GoblinPose {
  const rest = restingPose(style);
  const gait = GAITS[archetype];
  const swingAngle = phase * FULL_CYCLE;
  // Phase 0 is the near foot's contact, where the near leg is furthest forward:
  // a cosine puts the far arm furthest forward on that same frame and the
  // weapon arm furthest back, which is where opposite arms peak in a real gait.
  const armSwing = Math.cos(swingAngle);
  const stepBounce = 0.5 - 0.5 * Math.cos(swingAngle * BOB_PER_CYCLE);
  const near = footTarget(phase, gait);
  const far = footTarget(phase + 0.5, gait);
  // Lowest on each contact frame and highest at mid-stance, as the hips vault
  // over the planted leg.
  const bob = WALK_CROUCH - gait.bob * stepBounce;

  const carry = carryHand(archetype, style);
  const nearHand: Pt = {
    x: carry.x - armSwing * gait.armSwing * gait.weaponArmDamping,
    y:
      carry.y -
      WALK_CARRY_LIFT +
      bob -
      Math.abs(armSwing) * gait.armSwing * gait.weaponArmDamping * ARM_SWING_RISE,
  };
  const weaponAngle = carryAngleFor(archetype, style, prop, nearHand.y);
  const freeHand: Pt = {
    x: rest.farHand.x + armSwing * gait.armSwing * FREE_ARM_SWING_SHARE,
    y: rest.farHand.y + bob - Math.abs(armSwing) * gait.armSwing * ARM_SWING_RISE,
  };

  return {
    ...rest,
    bob,
    lean: gait.leanSwing * (1 - stepBounce),
    // Each leg strides about its own hip joint, or the leg whose hip sits
    // behind reaches further forward and straightens at contact.
    nearFoot: { x: near.x + hipJointOffset(style.proportions), y: near.y },
    farFoot: { x: far.x - hipJointOffset(style.proportions), y: far.y },
    nearHand,
    farHand: gripFarHand(prop, nearHand, weaponAngle, freeHand),
    weaponAngle,
    headLead: gait.headLead * (1 - stepBounce),
    headTilt: WALK_HEAD_NOD * (1 - stepBounce),
    earLag: WALK_EAR_LAG * Math.cos((phase - EAR_LAG_PHASE) * FULL_CYCLE * BOB_PER_CYCLE),
    eyeOpen: 1,
  };
}

// ── Idle ─────────────────────────────────────────────────────────────────────

/**
 * The idle is one slow breath and nothing else that moves the body.
 *
 * Every amplitude here is a fraction of a screen pixel at the 32-px tile, and
 * that is the point: a goblin that bobs, rocks and rolls its head on top of the
 * breath reads as a jitter at in-game size, however smooth the sine under it.
 * The only beats on top are a one-frame blink and one slow ear flick a cycle.
 */
interface IdleConfig {
  /** Frame of the loop the blink lands on. */
  readonly blinkFrame: number;
  /**
   * Frame the slow ear flick starts on; deliberately far from the blink. The
   * flick must end inside the loop, `earFlickFrame + EAR_FLICK_FRAMES` at most
   * the row's frame count: one that wraps lands on frame 0, the rest pose every
   * one-shot hands back to.
   */
  readonly earFlickFrame: number;
}

const IDLES: Record<GoblinArmedArchetype, IdleConfig> = {
  sword: { blinkFrame: 5, earFlickFrame: 11 },
  axe: { blinkFrame: 9, earFlickFrame: 2 },
  mace: { blinkFrame: 7, earFlickFrame: 11 },
  warhammer: { blinkFrame: 12, earFlickFrame: 4 },
  bow: { blinkFrame: 3, earFlickFrame: 9 },
};

/** How far the torso swells on the in-breath, as a share of its length. */
const BREATH_SWELL = 0.02;
/** How far the hips settle on the out-breath, in tile units. */
const BREATH_SETTLE = 0.006;
/** How far the head lifts on the in-breath. */
const BREATH_HEAD_LIFT = deg(0.75);
/** How far the hands ride up with the shoulders on the in-breath, in tile units. */
const BREATH_HAND_RISE = 0.008;
/** How far the ear droops at the bottom of its flick. */
const EAR_FLICK = deg(-6);
/** Frames the ear flick takes from rest, through its droop, back to rest. */
const EAR_FLICK_FRAMES = 5;
const BLINK_FRAMES = 1;

/**
 * A 0→1→0 envelope of `length` frames starting at `start`, eased at both ends
 * so the beat grows out of the loop and settles back into it.
 */
function windowedAt(frame: number, start: number, length: number, frameCount: number): number {
  const since = (frame - start + frameCount) % frameCount;
  return since < length ? smoothHump((since + 0.5) / length) : 0;
}

function idlePose(
  archetype: GoblinArmedArchetype,
  style: GoblinStyle,
  prop: GoblinProp,
  frame: number,
  frameCount: number,
): GoblinPose {
  const rest = restingPose(style);
  const config = IDLES[archetype];
  // Zero at frame 0, because every one-shot row hands back to idle frame 0 and
  // anything non-zero there is a pop at the end of every swing and flinch.
  const breath = Math.sin(cyclePhase(frame, frameCount) * FULL_CYCLE);
  const blink = windowedAt(frame, config.blinkFrame, BLINK_FRAMES, frameCount);
  const earFlick = windowedAt(frame, config.earFlickFrame, EAR_FLICK_FRAMES, frameCount);

  const carry = carryHand(archetype, style);
  const nearHand: Pt = { x: carry.x, y: carry.y - BREATH_HAND_RISE * breath };
  const weaponAngle = carryAngleFor(archetype, style, prop, nearHand.y);

  return {
    ...rest,
    bob: -BREATH_SETTLE * breath,
    torsoSquash: 1 + BREATH_SWELL * breath,
    nearHand,
    farHand: gripFarHand(prop, nearHand, weaponAngle, {
      x: rest.farHand.x,
      y: rest.farHand.y - BREATH_HAND_RISE * breath,
    }),
    weaponAngle,
    headTilt: -BREATH_HEAD_LIFT * breath,
    earLag: EAR_FLICK * earFlick,
    eyeOpen: 1 - blink,
  };
}

// ── Idle break ───────────────────────────────────────────────────────────────

/**
 * A 0→1→0 envelope whose ends are flat.
 *
 * A raw `hump` has its steepest slope at t=0, so a flourish built on one leaves
 * the idle pose at full speed and the first two frames jump. Easing the input
 * first flattens both ends, so the break grows out of the idle and settles back
 * into it.
 */
function smoothHump(t: number): number {
  return hump(easeInOut(t));
}

/**
 * A 0→1 ramp over the opening `rampShare` of a beat, a hold, and a 1→0 ramp
 * over its closing `rampShare`, eased at every corner.
 */
function plateau(progress: number, rampShare: number): number {
  const rampIn = easeInOut(clamp01(progress / rampShare));
  const rampOut = easeInOut(clamp01((progress - (1 - rampShare)) / rampShare));
  return rampIn * (1 - rampOut);
}

/** Share of a fidget spent reaching into it, and again easing out of it. */
const FIDGET_RAMP = 0.4;
/**
 * Where the fist sits on a planted sword's pommel, from its carry, in tile
 * units: forward and up, so the blade stands steeply with its point on the
 * floor.
 */
const PLANTED_POMMEL_FORWARD = 0.1;
const PLANTED_POMMEL_RISE = 0.22;
/** How far the stretching fist reaches above the far shoulder, in far-arm spans. */
const STRETCH_REACH = 0.95;
/** How far back of the shoulder the stretch leans, in far-arm spans. */
const STRETCH_BACK = 0.15;
const SNIFFS = 3;
const SNIFF_PUSH = 0.014;
/** How far a goblin lets its weapon sag while its attention is elsewhere. */
const FIDGET_WEAPON_SAG = 0.02;

/**
 * Each archetype's fidget, at its fullest: lengths in tile units, the rest
 * angles, eye closure and mouth opening as shares of shut and of a full gape.
 */
const SWORD_FIDGET = {
  lean: deg(4),
  headRoll: deg(10),
  earRoll: deg(-10),
  eyeClose: 0.5,
  mouthOpen: 0.15,
} as const;
const AXE_FIDGET = {
  crouch: 0.008,
  chinUp: deg(-7),
  noseReach: 0.02,
  earsBack: deg(-12),
  eyeClose: 0.3,
  sniffMouth: 0.1,
} as const;
const MACE_FIDGET = {
  /** The yawn starts this far into the fidget and lasts this share of it. */
  yawnStart: 0.2,
  yawnLength: 0.6,
  leanBack: deg(-4),
  chestSwell: 0.04,
  headBack: deg(-14),
  earsUp: deg(14),
  eyeClose: 0.85,
} as const;
const WARHAMMER_FIDGET = {
  shoulderSwell: 0.04,
  headRoll: deg(12),
  headReach: 0.025,
  earRoll: deg(-12),
  eyeClose: 0.6,
  mouthOpen: 0.25,
} as const;
const BOW_FIDGET = {
  /** The pluck takes the opening share of the fidget; the scan starts partway through it. */
  pluckLength: 0.6,
  scanStart: 0.35,
  scanLength: 0.65,
  pluckForward: 0.1,
  /** How far the thumb rises up the string, as a share of the whole arm. */
  pluckRise: 0.25,
  pluckHeadTilt: deg(6),
  scanHeadTilt: deg(8),
  pluckHeadLead: 0.02,
  scanEars: deg(12),
} as const;

/**
 * The occasional fidget that gives each archetype its personality.
 *
 * Every one is unmistakably *not* an attack: the weapon stays at its carry,
 * sagging if anything, and never comes up or points forward, so the attack
 * telegraphs keep their meaning. Every one starts and ends on idle frame 0, so
 * it can be dropped on top of the loop.
 */
function idleBreakPose(
  archetype: GoblinArmedArchetype,
  style: GoblinStyle,
  prop: GoblinProp,
  progress: number,
): GoblinPose {
  const p = style.proportions;
  const base = idlePose(archetype, style, prop, 0, rowByName('idle').frameCount);
  const skeleton = buildSkeleton(style, base);
  const into = plateau(progress, FIDGET_RAMP);
  const sagged: Pt = { x: base.nearHand.x, y: base.nearHand.y + FIDGET_WEAPON_SAG * into };
  const saggedAngle = carryAngleFor(archetype, style, prop, sagged.y);
  const carried = {
    nearHand: sagged,
    weaponAngle: saggedAngle,
    farHand: gripFarHand(prop, sagged, saggedAngle, base.farHand),
  };

  switch (archetype) {
    case 'sword': {
      // Plants its point on the floor, leans on the pommel and rolls its neck.
      // The blade only ever turns further down from its carry.
      const leaning: Pt = {
        x: lerp(base.nearHand.x, base.nearHand.x + PLANTED_POMMEL_FORWARD, into),
        y: lerp(base.nearHand.y, base.nearHand.y - PLANTED_POMMEL_RISE, into),
      };
      const roll = Math.sin(clamp01((progress - FIDGET_RAMP) / (1 - 2 * FIDGET_RAMP)) * FULL_CYCLE);
      return {
        ...base,
        nearHand: leaning,
        weaponAngle: groundLandingAngle(prop, leaning.y),
        lean: SWORD_FIDGET.lean * into,
        headTilt: SWORD_FIDGET.headRoll * roll * into,
        earLag: SWORD_FIDGET.earRoll * roll * into,
        eyeOpen: 1 - SWORD_FIDGET.eyeClose * into,
        mouthOpen: SWORD_FIDGET.mouthOpen * into,
      };
    }
    case 'axe': {
      // Both fists are on the haft, so the fidget is all head: the chin comes
      // up and the nose tests the air three times.
      const sniff = (0.5 - 0.5 * Math.cos(progress * FULL_CYCLE * SNIFFS)) * into;
      return {
        ...base,
        ...carried,
        bob: base.bob - AXE_FIDGET.crouch * into,
        headTilt: AXE_FIDGET.chinUp * into,
        headLead: base.headLead + AXE_FIDGET.noseReach * into + SNIFF_PUSH * sniff,
        earLag: AXE_FIDGET.earsBack * into,
        eyeOpen: 1 - AXE_FIDGET.eyeClose * into,
        mouthOpen: AXE_FIDGET.sniffMouth * sniff,
      };
    }
    case 'mace': {
      // Stretches the free arm up over its head and yawns.
      const span = farArmSpan(p);
      const overhead: Pt = {
        x: skeleton.farShoulder.x - span * STRETCH_BACK,
        y: skeleton.farShoulder.y - span * STRETCH_REACH,
      };
      const yawn = smoothHump(clamp01((progress - MACE_FIDGET.yawnStart) / MACE_FIDGET.yawnLength));
      return {
        ...base,
        ...carried,
        farHand: {
          x: lerp(base.farHand.x, overhead.x, into),
          y: lerp(base.farHand.y, overhead.y, into),
        },
        lean: MACE_FIDGET.leanBack * yawn,
        torsoSquash: base.torsoSquash + MACE_FIDGET.chestSwell * yawn,
        headTilt: MACE_FIDGET.headBack * yawn,
        earLag: MACE_FIDGET.earsUp * yawn,
        mouthOpen: yawn,
        eyeOpen: 1 - MACE_FIDGET.eyeClose * yawn,
      };
    }
    case 'warhammer': {
      // Rolls its neck down, round and back up, and its shoulders with it.
      const roll = Math.sin(progress * FULL_CYCLE) * into;
      const shrug = smoothHump(progress);
      return {
        ...base,
        ...carried,
        torsoSquash: base.torsoSquash + WARHAMMER_FIDGET.shoulderSwell * shrug,
        headTilt: WARHAMMER_FIDGET.headRoll * roll,
        headLead: base.headLead + WARHAMMER_FIDGET.headReach * roll,
        earLag: WARHAMMER_FIDGET.earRoll * roll,
        eyeOpen: 1 - WARHAMMER_FIDGET.eyeClose * into,
        mouthOpen: WARHAMMER_FIDGET.mouthOpen * shrug,
      };
    }
    case 'bow': {
      // Thumbs the string, then looks the room over once. Neither beat raises
      // the bow: an idling archer must never read as one about to shoot.
      const armLength = p.upperArmLength + p.forearmLength;
      const pluck = smoothHump(clamp01(progress / BOW_FIDGET.pluckLength));
      const scanProgress = clamp01((progress - BOW_FIDGET.scanStart) / BOW_FIDGET.scanLength);
      const scan = Math.sin(scanProgress * FULL_CYCLE) * into;
      return {
        ...base,
        ...carried,
        farHand: {
          x: base.farHand.x + BOW_FIDGET.pluckForward * pluck,
          y: base.farHand.y - armLength * BOW_FIDGET.pluckRise * pluck,
        },
        headTilt: BOW_FIDGET.pluckHeadTilt * pluck + BOW_FIDGET.scanHeadTilt * scan,
        headLead: base.headLead + BOW_FIDGET.pluckHeadLead * pluck,
        earLag: BOW_FIDGET.scanEars * scan,
        eyeOpen: 1,
      };
    }
  }
}

// ── Attacks ──────────────────────────────────────────────────────────────────

/**
 * One swing, described as the four beats every weapon strike shares.
 *
 * Hand positions are in figure space. Angles are the weapon's own axis. Each
 * beat is eased differently on purpose: the wind is `easeInOut` so it settles,
 * the drive is `easeIn` so it accelerates into the hit, and the follow-through
 * is `easeOut` so it decays. A linear sweep across the row reads as a robot arm.
 */
interface SwingSpec {
  /** Progress at which the wind is fully loaded. */
  readonly windEnd: number;
  /**
   * Progress the loaded pose is held until before the drive starts. The hold
   * is the telegraph: the weapon creeps a little further back through it, so
   * it reads as a coiled pause rather than a dropped frame.
   */
  readonly holdEnd: number;
  /** How far the wound weapon creeps back through the hold, in radians. */
  readonly holdCreep: number;
  /** How deep the anticipation crouch sinks the hips, held until the drive. */
  readonly crouch: number;
  /**
   * A point the fist bows through on its way to the wind, behind the hip, so
   * the weapon turns up behind the body instead of in front of the face.
   */
  readonly windVia: Pt;
  /** How far the strike drives the hips down into the blow. */
  readonly impactBob: number;
  /**
   * How far the fist bows forward and up off the straight line mid-drive. A
   * fist driven straight from behind the skull to the target passes through
   * the face; the bow carries it round in front of it.
   */
  readonly driveArc: Pt;
  /** Progress the weapon connects on — always derived from the timing table. */
  readonly impactAt: number;
  /** Progress the follow-through has fully played out. */
  readonly followEnd: number;
  readonly windHand: Pt;
  readonly impactHand: Pt;
  readonly followHand: Pt;
  readonly windAngle: number;
  readonly impactAngle: number;
  readonly followAngle: number;
  readonly windLean: number;
  readonly impactLean: number;
  readonly followLean: number;
  readonly windSway: number;
  readonly impactSway: number;
  /** How far the lead foot steps, and over what part of the drive. */
  readonly step: number;
  readonly stepFrom: number;
  readonly stepTo: number;
  /** Rear foot slides back by this much during the wind, then holds. */
  readonly rearBrace: number;
  /** Progress range over which the prop is drawn behind the body. */
  readonly behindFrom: number;
  readonly behindTo: number;
  readonly windSquash: number;
  readonly impactSquash: number;
  /** Whether the free hand counterweights or grips the haft. */
  readonly freeHandWind: Pt;
  readonly freeHandImpact: Pt;
}

/** A foot that moves only while it is off the ground; G7 asserts exactly this. */
function steppingFoot(
  base: number,
  distance: number,
  from: number,
  to: number,
  progress: number,
  lift: number,
): Pt {
  if (progress <= from) return { x: base, y: 0 };
  if (progress >= to) return { x: base + distance, y: 0 };
  const t = (progress - from) / (to - from);
  return { x: base + distance * easeInOut(t), y: -lift * Math.sin(t * Math.PI) };
}

const STEP_LIFT = 0.05;

/**
 * Progress by which a stepped foot is back on its rest mark. Short of the last
 * frame's sample, so the last frame stands where idle frame 0 does and the
 * hand-off to idle moves no foot.
 */
const STEP_HOME_BY = 0.95;
/** How far into a swing's recovery its feet start home. */
const STEP_HOME_FROM_SHARE = 0.3;

/** A progress window: a step taken out, or a step taken home. */
interface StepWindow {
  readonly from: number;
  readonly to: number;
}

/**
 * A foot that steps out over `out` and steps home again over `home`, moving
 * only while it is off the ground. A foot left on its stepped mark at the end
 * of a row jumps back to its rest mark on the first idle frame.
 */
function steppingOutAndHome(
  base: number,
  distance: number,
  out: StepWindow,
  home: StepWindow,
  progress: number,
  lift: number,
): Pt {
  if (progress < home.from) return steppingFoot(base, distance, out.from, out.to, progress, lift);
  return steppingFoot(base + distance, -distance, home.from, home.to, progress, lift);
}

function lerpPt(from: Pt, to: Pt, t: number): Pt {
  return { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) };
}

/** A point `t` of the way along the quadratic curve from `from` to `to` bowed toward `via`. */
function quadraticAt(from: Pt, via: Pt, to: Pt, t: number): Pt {
  return lerpPt(lerpPt(from, via, t), lerpPt(via, to, t), t);
}

/**
 * The band of elevations in which a weapon points up over the goblin's own
 * skull. Angles run 0 forward and negative upward; a weapon pointing back at
 * about level is not overhead, it is behind the body.
 */
const OVERHEAD_FROM = deg(-80);
const OVERHEAD_TO = deg(-160);

function pointsOverhead(weaponAngle: number): boolean {
  return weaponAngle < OVERHEAD_FROM && weaponAngle > OVERHEAD_TO;
}

/**
 * Where the head, ears and jaw sit at the end of each swing stage. They lag the
 * torso, so nothing arrives at its extreme on the same frame as the body does.
 */
const SWING_HEAD_LAG = {
  windTilt: deg(-10),
  driveTilt: deg(12),
  followTilt: deg(6),
  windLead: -0.02,
  driveLead: 0.05,
  followLead: 0.02,
  windEar: deg(16),
  driveEar: deg(-26),
  followEar: deg(-8),
} as const;

/** The share of the impact sway still held through the follow-through. */
const SWING_FOLLOW_SWAY_SHARE = 0.5;
/** The torso stays a touch stretched as the weapon carries past impact. */
const SWING_FOLLOW_STRETCH = 1.02;
/** The rear foot only shuffles back to brace, so it barely leaves the floor. */
const REAR_BRACE_LIFT_SHARE = 0.4;
/** The jaw opens a little in the wind-up and bares its fangs on the drive. */
const SWING_WIND_SNARL = 0.4;
/** How far the jaw closes again over the follow-through. */
const SWING_FOLLOW_JAW_CLOSE = 0.5;

function swingPose(
  archetype: GoblinArmedArchetype,
  style: GoblinStyle,
  prop: GoblinProp,
  spec: SwingSpec,
  progress: number,
): GoblinPose {
  const rest = restingPose(style);
  const carry = carryHand(archetype, style);
  const restAngle = carryAngleFor(archetype, style, prop, carry.y);

  const wind = easeInOut(clamp01(progress / spec.windEnd));
  const held = easeInOut(clamp01((progress - spec.windEnd) / (spec.holdEnd - spec.windEnd)));
  const drive = easeIn(clamp01((progress - spec.holdEnd) / (spec.impactAt - spec.holdEnd)));
  const follow = easeOut(clamp01((progress - spec.impactAt) / (spec.followEnd - spec.impactAt)));
  /**
   * Where the recovery starts, as a fraction of the way from impact to the end
   * of the follow-through.
   *
   * Not zero and not one. Back to back, `follow`'s ease-out and `recover`'s
   * ease-in are both flat at the boundary, so the weapon stalls for a frame and
   * then leaps; overlapped by half, the recovery cancels most of the
   * follow-through. A late overlap keeps something moving on every frame and
   * lets the strike carry past contact before it is undone.
   */
  const RECOVERY_OVERLAP = 0.82;
  const recoverStart = lerp(spec.impactAt, spec.followEnd, RECOVERY_OVERLAP);
  const recover = easeInOut(clamp01((progress - recoverStart) / (1 - recoverStart)));

  /** Chain four keyed values through the four beats. */
  const stage = (base: number, atWind: number, atImpact: number, atFollow: number): number => {
    const wound = lerp(base, atWind, wind);
    const driven = lerp(wound, atImpact, drive);
    const followed = lerp(driven, atFollow, follow);
    return lerp(followed, base, recover);
  };
  const stagePt = (base: Pt, atWind: Pt, atImpact: Pt, atFollow: Pt): Pt => ({
    x: stage(base.x, atWind.x, atImpact.x, atFollow.x),
    y: stage(base.y, atWind.y, atImpact.y, atFollow.y),
  });

  const loaded = held * (1 - drive);
  const arcing = hump(drive) * (1 - follow);
  const wound = quadraticAt(carry, spec.windVia, spec.windHand, wind);
  const staged = lerpPt(
    lerpPt(lerpPt(wound, spec.impactHand, drive), spec.followHand, follow),
    carry,
    recover,
  );
  const nearHand: Pt = {
    x: staged.x + spec.driveArc.x * arcing,
    y: staged.y + spec.driveArc.y * arcing,
  };
  const swungAngle =
    lerp(
      lerp(
        lerp(lerp(restAngle, spec.windAngle, wind), spec.impactAngle, drive),
        spec.followAngle,
        follow,
      ),
      restAngle,
      recover,
    ) +
    spec.holdCreep * loaded;
  const weaponAngle = Math.min(swungAngle, groundLandingAngle(prop, nearHand.y));
  const freeHand = stagePt(rest.farHand, spec.freeHandWind, spec.freeHandImpact, rest.farHand);

  const stepHome: StepWindow = {
    from: lerp(recoverStart, 1, STEP_HOME_FROM_SHARE),
    to: STEP_HOME_BY,
  };
  const coiled = wind * (1 - drive) * spec.crouch;
  const slammed = drive * (1 - recover) * spec.impactBob;

  return {
    ...rest,
    lean: stage(0, spec.windLean, spec.impactLean, spec.followLean),
    sway: stage(0, spec.windSway, spec.impactSway, spec.impactSway * SWING_FOLLOW_SWAY_SHARE),
    torsoSquash: stage(1, spec.windSquash, spec.impactSquash, SWING_FOLLOW_STRETCH),
    bob: coiled + slammed,
    nearFoot: steppingOutAndHome(
      rest.nearFoot.x,
      spec.step,
      { from: spec.stepFrom, to: spec.stepTo },
      stepHome,
      progress,
      STEP_LIFT,
    ),
    farFoot: steppingOutAndHome(
      rest.farFoot.x,
      spec.rearBrace,
      { from: 0, to: spec.windEnd },
      stepHome,
      progress,
      STEP_LIFT * REAR_BRACE_LIFT_SHARE,
    ),
    nearHand,
    farHand: gripFarHand(prop, nearHand, weaponAngle, freeHand),
    weaponAngle,
    // Never behind while the weapon is overhead. The authored window says when a
    // wound-up weapon is tucked behind the hip, but it runs on past the point
    // the swing lifts the weapon over the skull — and a weapon drawn behind the
    // body there is occluded by the head, which severs the haft and leaves the
    // blade sitting on the scalp like a bucket.
    propBehind:
      progress >= spec.behindFrom && progress < spec.behindTo && !pointsOverhead(weaponAngle),
    headTilt: stage(
      0,
      SWING_HEAD_LAG.windTilt,
      SWING_HEAD_LAG.driveTilt,
      SWING_HEAD_LAG.followTilt,
    ),
    headLead: stage(
      0,
      SWING_HEAD_LAG.windLead,
      SWING_HEAD_LAG.driveLead,
      SWING_HEAD_LAG.followLead,
    ),
    earLag: stage(0, SWING_HEAD_LAG.windEar, SWING_HEAD_LAG.driveEar, SWING_HEAD_LAG.followEar),
    mouthOpen: Math.max(wind * SWING_WIND_SNARL, drive * (1 - follow * SWING_FOLLOW_JAW_CLOSE)),
    eyeOpen: 1,
  };
}

/** How far the hips sink as the stab coils, and stay sunk into the lunge, in tile units. */
const THRUST_COIL = 0.06;
const THRUST_DRIVE_DROP = 0.04;

/** Progress at which the stab's anticipation is fully loaded. */
const THRUST_WIND_END = 0.32;

/**
 * The sword's stab, which cannot be a swing: the blade translates along its own
 * axis and must not rotate, or the "thrust" reads as a slap.
 */
function thrustPose(
  archetype: GoblinArmedArchetype,
  style: GoblinStyle,
  prop: GoblinProp,
  progress: number,
  impactAt: number,
): GoblinPose {
  const rest = restingPose(style);
  const carry = carryHand(archetype, style);
  const p = style.proportions;
  const armLength = p.upperArmLength + p.forearmLength;
  const shoulderY = -shoulderHeight(p);
  const WIND_END = THRUST_WIND_END;
  /**
   * The lunge settles for one frame and the recovery takes the rest of the
   * row, six frames and a half: held longer at full reach the stab reads as a
   * pose, and with fewer than six recovery frames `easeInOut` gives a middle
   * step several times its end steps, so the blade snaps back to guard
   * instead of retracting.
   */
  const SETTLE_END = 0.53;
  const LEVELLED_ANGLE = deg(-3);
  const LUNGE = 0.28;
  const OVERSHOOT = 1.06;
  const PULL_BACK = 0.85;

  const thrustHome: StepWindow = {
    from: lerp(SETTLE_END, 1, STEP_HOME_FROM_SHARE),
    to: STEP_HOME_BY,
  };
  const wind = easeInOut(clamp01(progress / WIND_END));
  const driveRaw = clamp01((progress - WIND_END) / (impactAt - WIND_END));
  const drive = easeIn(driveRaw);
  const settle = easeInOut(clamp01((progress - impactAt) / (SETTLE_END - impactAt)));
  const recover = easeInOut(clamp01((progress - SETTLE_END) / (1 - SETTLE_END)));

  const drawnBackX = p.hipHalfWidth * 0.2 - armLength * 0.22;
  const drawnBackY = shoulderY + armLength * 0.4;
  const extendedX = armLength * 1.02;
  const extendedY = shoulderY + armLength * 0.34;

  // The reach overshoots by 6% on the impact frame and pulls back 15% after it,
  // which is what sells a thrust as an impact rather than as an extension.
  const reach = drive * (progress < impactAt ? 1 : OVERSHOOT) * (1 - settle * (1 - PULL_BACK));
  const nearHand: Pt = {
    x: lerp(lerp(carry.x, drawnBackX, wind), extendedX, reach) * (1 - recover) + carry.x * recover,
    y: lerp(lerp(carry.y, drawnBackY, wind), extendedY, reach) * (1 - recover) + carry.y * recover,
  };

  return {
    ...rest,
    lean: (deg(-8) * wind + deg(18) * drive) * (1 - recover),
    sway: (-0.04 * wind + 0.09 * drive) * (1 - recover),
    torsoSquash: 1 + 0.03 * wind - 0.02 * drive,
    bob: (THRUST_COIL * wind * (1 - drive) + THRUST_DRIVE_DROP * drive) * (1 - recover),
    nearFoot: steppingOutAndHome(
      rest.nearFoot.x,
      LUNGE,
      { from: WIND_END, to: impactAt },
      thrustHome,
      progress,
      STEP_LIFT * 0.8,
    ),
    // The rear foot must leave the ground to brace back, or it is dragging
    // rather than stepping.
    farFoot: steppingOutAndHome(
      rest.farFoot.x,
      -0.1,
      { from: 0, to: WIND_END },
      thrustHome,
      progress,
      STEP_LIFT * 0.35,
    ),
    nearHand,
    // Off hand thrown back and out for balance.
    farHand: {
      x: rest.farHand.x - 0.14 * drive * (1 - recover),
      y: rest.farHand.y - armLength * 0.3 * drive * (1 - recover),
    },
    weaponAngle: lerp(
      carryAngleFor(archetype, style, prop, nearHand.y),
      LEVELLED_ANGLE,
      Math.max(wind, drive),
    ),
    headTilt: (deg(-6) * wind + deg(9) * drive) * (1 - recover),
    headLead: 0.05 * drive * (1 - recover),
    earLag: (deg(12) * wind - deg(20) * drive) * (1 - recover),
    mouthOpen: Math.max(wind * 0.3, drive),
    eyeOpen: 1,
  };
}

// ── Bow ──────────────────────────────────────────────────────────────────────
//
// The archer's two rows are not swings and not a thrust: nothing travels through
// an arc and nothing connects. What the frames have to sell is a *draw* — the
// stave coming up to vertical, the string bending back to a point, and the
// whole thing snapping flat again on release — because that string is the
// player's only warning that a shot is coming.

/** The stave stands vertical when aimed, which points the arrow along +X. */
const BOW_AIM_ANGLE = deg(-90);
/**
 * Progress by which the bow has finished coming up to aim.
 *
 * Half the row, which is much of it — and it has to be. The bow hand travels
 * from the hip to full extension, which at 14 frames is a long way; compressed
 * into the opening quarter it would cover that distance in three frames, which
 * reads as a hitch. Raising and drawing overlap anyway, which is how the
 * motion actually works.
 */
const BOW_RAISE_END = 0.5;
/**
 * How far each shot sits back into its draw. The aimed shot leans back
 * further, which is what tells it from the snap shot at a glance; neither
 * leans far enough to straighten the hunch.
 */
const BOW_DRAW_LEAN: Record<'light' | 'heavy', number> = { light: deg(2), heavy: deg(6) };
/** How far the loose kicks the shoulders back. */
const BOW_LOOSE_KICK = deg(2);
/**
 * How far the stave's turn upright leads the bow fist's rise, as the power of
 * an ease-out: a smooth lead, where a clamped one leaves the stave standing
 * still and then whipping round on the way down.
 */
const BOW_UPRIGHT_LEAD = 2;
/** Progress the string starts moving at. */
const BOW_DRAW_START = 0.12;
/**
 * Where the draw finishes, as a fraction of the way to release.
 *
 * Short of 1 on purpose: the frames between full draw and the loose are the
 * hold, and a hold is what makes a telegraph readable. A draw that arrives
 * exactly on the release frame is a string that snaps back the instant it
 * reaches tension, which at 14 frames the eye never resolves at all.
 *
 * 0.72 rather than 0.82 because the shorter row sets the floor: at 0.82 the
 * 14-frame hurried shot reaches full draw on the single frame before its
 * loose, which is not a hold. Both rows need to hold at full draw for at least
 * a couple of frames before releasing.
 */
const BOW_DRAW_END_FRACTION = 0.72;
/** How far the snap shot pulls, against the aimed shot's full draw. */
const BOW_SNAP_DRAW = 0.68;
/**
 * How far in front of the shoulder the bow fist is held, in arm lengths.
 *
 * Nearly straight, which is both correct form and what puts the two fists far
 * enough apart to read as a draw: at 0.62 the bow arm was bent and the draw hand
 * landed in front of the far shoulder rather than back at the jaw, so both arms
 * pointed forward and the string had nowhere to go.
 */
const BOW_HAND_REACH_FRACTION = 0.82;
/** How high the bow fist is held, as a fraction of shoulder height. */
const BOW_HAND_HEIGHT_FRACTION = 0.92;
/** Progress span after release over which the loose's recoil plays out. */
const BOW_SNAP_BACK_SPAN = 0.18;
/**
 * How far *before* the release the recoil window opens, in progress.
 *
 * A hump whose window starts exactly at the release evaluates to zero on the
 * release frame — the one frame the recoil exists to sell — and peaks two frames
 * later, so the loose reads as a pause followed by a flinch. Roughly half a
 * frame of lead puts the bloom on the frame the arrow leaves.
 */
const BOW_SNAP_BACK_LEAD = 0.03;
/**
 * How far the loose throws each hand back, in tile units — the bow hand a
 * little, the draw hand rather more, since that is the one the string was
 * pulling against.
 */
const BOW_HAND_RECOIL = 0.05;
const BOW_DRAW_HAND_RECOIL = 0.09;

/**
 * The bow's shape on one frame of a named shot row.
 *
 * Exported so the baked draw can be measured directly rather than trusting the
 * table it came from.
 */
export function bowDrawAt(kind: 'light' | 'heavy', frame: number, frameCount: number): BowDraw {
  return bowShotDraw(kind, shotProgress(frame, frameCount), impactProgress('bow', kind));
}

/** The bow's shape on one frame of one shot row. */
function bowShotDraw(kind: 'light' | 'heavy', progress: number, impactAt: number): BowDraw {
  // Past the release the arrow is gone and the string is flat — the frames that
  // follow are recovery, and a string still bent through them would read as a
  // shot that never left.
  if (progress >= impactAt) return { amount: 0, nocked: false };
  const maxDraw = kind === 'light' ? BOW_SNAP_DRAW : 1;
  const drawEnd = impactAt * BOW_DRAW_END_FRACTION;
  const pulled = easeInOut(clamp01((progress - BOW_DRAW_START) / (drawEnd - BOW_DRAW_START)));
  return { amount: maxDraw * pulled, nocked: true };
}

/** Where the string's nocking point sits in figure space at a given draw. */
export function nockPoint(bowHand: Pt, weaponAngle: number, drawAmount: number): Pt {
  const pull = bowStringPull(drawAmount);
  return {
    x: bowHand.x - pull * Math.sin(weaponAngle),
    y: bowHand.y + pull * Math.cos(weaponAngle),
  };
}

function bowShotPose(
  style: GoblinStyle,
  prop: GoblinProp,
  kind: 'light' | 'heavy',
  progress: number,
  impactAt: number,
): GoblinPose {
  const rest = restingPose(style);
  const p = style.proportions;
  const carry = carryHand('bow', style);
  const restAngle = carryAngleFor('bow', style, prop, carry.y);
  const armLength = p.upperArmLength + p.forearmLength;

  const raised = easeInOut(clamp01(progress / BOW_RAISE_END));
  const lowered = easeInOut(clamp01((progress - impactAt) / (1 - impactAt)));
  const aiming = raised * (1 - lowered);
  // A short bloom on the frames straight after the loose: the bow arm kicks back
  // and the draw hand flies off the string. Without it the release is a single
  // frame in which the string simply stops being bent, and reads as a dropped
  // frame rather than as a shot.
  const loosed = hump(
    clamp01((progress - impactAt + BOW_SNAP_BACK_LEAD) / (BOW_SNAP_BACK_SPAN + BOW_SNAP_BACK_LEAD)),
  );

  const aimHand: Pt = {
    x: p.shoulderHalfWidth + armLength * BOW_HAND_REACH_FRACTION,
    y: -shoulderHeight(p) * BOW_HAND_HEIGHT_FRACTION,
  };
  const nearHand: Pt = {
    x: lerp(carry.x, aimHand.x, aiming) - BOW_HAND_RECOIL * loosed,
    y: lerp(carry.y, aimHand.y, aiming),
  };
  // The stave turns upright ahead of the fist, on the way up and on the way
  // down, so it is never held level and pointed like a crossbow.
  const upright = 1 - (1 - aiming) ** BOW_UPRIGHT_LEAD;
  const weaponAngle = lerp(restAngle, BOW_AIM_ANGLE, upright);

  const draw = bowShotDraw(kind, progress, impactAt);
  // The *hand* does not follow the string's snap to zero. The string is released
  // and flat from the release frame on, but the fist it left is still back at
  // the jaw and travels further back from there under the recoil — placing it at
  // the resting nock instead teleports it onto the riser for exactly one frame,
  // which lands on the frame the arrow spawns.
  const releasedDraw = kind === 'light' ? BOW_SNAP_DRAW : 1;
  const handDraw = progress >= impactAt ? releasedDraw : draw.amount;
  const nock = nockPoint(nearHand, weaponAngle, handDraw);
  const drawHand: Pt = {
    x: lerp(rest.farHand.x, nock.x, aiming) - BOW_DRAW_HAND_RECOIL * loosed,
    y: lerp(rest.farHand.y, nock.y, aiming),
  };

  // The stance opens as the bow comes up and closes again as it comes down: an
  // archer that draws with its feet where it was walking reads as a mannequin
  // holding a bow.
  const BRACE_STEP = 0.09;
  const braceOut: StepWindow = { from: 0, to: BOW_RAISE_END };
  const braceHome: StepWindow = {
    from: lerp(impactAt, 1, STEP_HOME_FROM_SHARE),
    to: STEP_HOME_BY,
  };
  return {
    ...rest,
    lean: -BOW_DRAW_LEAN[kind] * aiming - BOW_LOOSE_KICK * loosed,
    sway: -0.03 * aiming,
    torsoSquash: 1 - 0.04 * aiming + 0.05 * loosed,
    bob: -0.015 * aiming,
    nearFoot: steppingOutAndHome(
      rest.nearFoot.x,
      BRACE_STEP,
      braceOut,
      braceHome,
      progress,
      STEP_LIFT * 0.5,
    ),
    farFoot: steppingOutAndHome(
      rest.farFoot.x,
      -BRACE_STEP,
      braceOut,
      braceHome,
      progress,
      STEP_LIFT * 0.5,
    ),
    nearHand,
    farHand: drawHand,
    weaponAngle,
    propBehind: false,
    headTilt: deg(6) * aiming + deg(-10) * loosed,
    headLead: 0.035 * aiming,
    earLag: deg(-14) * aiming + deg(30) * loosed,
    mouthOpen: 0.25 * draw.amount + 0.6 * loosed,
    // Narrowed while sighting down the arrow, wide open on the loose.
    eyeOpen: 1 - 0.4 * aiming * (1 - loosed),
  };
}

/** Melee archetypes: every one whose attack rows are a swing or a thrust. */
type MeleeArchetype = Exclude<GoblinArmedArchetype, 'bow'>;

function isMeleeArchetype(archetype: GoblinArmedArchetype): archetype is MeleeArchetype {
  return archetype !== 'bow';
}

/**
 * Every strike shares one shape: a crouch and a wind, a hold, a fast drive into
 * the most extended pose of the row on the impact frame, and a short recovery.
 *
 * Every wind takes the fist back behind the hip before it climbs, and the
 * weapon turns up behind the body after it, so the weapon never sweeps across
 * the face on the way up. Leans stay small on the wind so the hunch never
 * straightens into an upright stance.
 */
const SWING_SPECS: Record<MeleeArchetype, { light: SwingSpec | null; heavy: SwingSpec }> = {
  sword: {
    // The light attack is the stab, which `thrustPose` handles instead.
    light: null,
    heavy: {
      // Overhead slash: crouch, rise with the blade high behind the skull, hold,
      // and cut down and through.
      windEnd: 0.26,
      holdEnd: 0.36,
      impactAt: 0,
      followEnd: 0.62,
      holdCreep: deg(12),
      crouch: 0.07,
      windVia: pt(-0.35, -0.5),
      impactBob: 0.05,
      driveArc: pt(0.14, -0.12),
      windHand: pt(-0.15, -1.25),
      impactHand: pt(0.6, -0.7),
      followHand: pt(0.5, -0.5),
      windAngle: deg(-125),
      impactAngle: deg(25),
      followAngle: deg(60),
      windLean: 0,
      impactLean: deg(24),
      followLean: deg(26),
      windSway: -0.05,
      impactSway: 0.08,
      step: 0.22,
      stepFrom: 0.36,
      stepTo: 0.5,
      rearBrace: -0.14,
      behindFrom: 0,
      behindTo: 0.36,
      windSquash: 1.04,
      impactSquash: 0.94,
      freeHandWind: pt(-0.3, -0.75),
      freeHandImpact: pt(-0.34, -0.5),
    },
  },
  axe: {
    heavy: {
      /**
       * Overhead chop with both hands on the haft. Both fists stay high
       * through the strike: driving them low hands the swing to
       * {@link groundLandingAngle}, which flattens the chop.
       */
      windEnd: 0.28,
      holdEnd: 0.4,
      impactAt: 0,
      followEnd: 0.66,
      holdCreep: deg(10),
      crouch: 0.08,
      windVia: pt(-0.3, -0.6),
      impactBob: 0.06,
      driveArc: pt(0.1, -0.08),
      windHand: pt(-0.1, -1.38),
      impactHand: pt(0.55, -0.8),
      followHand: pt(0.5, -0.72),
      windAngle: deg(-130),
      impactAngle: deg(35),
      followAngle: deg(15),
      windLean: 0,
      impactLean: deg(26),
      followLean: deg(28),
      windSway: -0.05,
      impactSway: 0.08,
      step: 0.24,
      stepFrom: 0.4,
      stepTo: 0.56,
      rearBrace: -0.16,
      behindFrom: 0,
      behindTo: 0.4,
      windSquash: 1.05,
      impactSquash: 0.92,
      freeHandWind: pt(-0.2, -0.9),
      freeHandImpact: pt(0.24, -0.62),
    },
    light: {
      // Hooking cleave at waist height.
      windEnd: 0.26,
      holdEnd: 0.32,
      impactAt: 0,
      followEnd: 0.64,
      holdCreep: deg(8),
      crouch: 0.04,
      windVia: pt(-0.3, -0.45),
      impactBob: 0.03,
      driveArc: pt(0, 0),
      windHand: pt(-0.25, -0.8),
      impactHand: pt(0.6, -0.6),
      followHand: pt(0.5, -0.5),
      windAngle: deg(-158),
      impactAngle: deg(-8),
      followAngle: deg(40),
      windLean: deg(-4),
      impactLean: deg(18),
      followLean: deg(22),
      windSway: -0.06,
      impactSway: 0.07,
      step: 0.14,
      stepFrom: 0.32,
      stepTo: 0.5,
      rearBrace: -0.06,
      behindFrom: 0,
      behindTo: 0.32,
      windSquash: 1.03,
      impactSquash: 0.97,
      freeHandWind: pt(-0.24, -0.56),
      freeHandImpact: pt(0.18, -0.46),
    },
  },
  mace: {
    light: {
      // Round-arm whirl, swung over into the target.
      windEnd: 0.3,
      holdEnd: 0.38,
      impactAt: 0,
      followEnd: 0.7,
      holdCreep: deg(10),
      crouch: 0.04,
      windVia: pt(-0.3, -0.5),
      impactBob: 0.03,
      driveArc: pt(0.1, -0.1),
      windHand: pt(-0.2, -0.85),
      impactHand: pt(0.55, -0.6),
      followHand: pt(0.42, -0.45),
      windAngle: deg(-158),
      impactAngle: deg(20),
      followAngle: deg(70),
      windLean: deg(-4),
      impactLean: deg(16),
      followLean: deg(18),
      windSway: -0.05,
      impactSway: 0.07,
      step: 0.1,
      stepFrom: 0.38,
      stepTo: 0.56,
      rearBrace: -0.05,
      behindFrom: 0,
      behindTo: 0.38,
      windSquash: 1.02,
      impactSquash: 0.98,
      freeHandWind: pt(-0.22, -0.6),
      freeHandImpact: pt(-0.3, -0.52),
    },
    heavy: {
      // Overhead crush: crouch, rise with the head of the mace high behind the
      // skull, hold, and drive it straight down.
      windEnd: 0.26,
      holdEnd: 0.36,
      impactAt: 0,
      followEnd: 0.62,
      holdCreep: deg(12),
      crouch: 0.08,
      windVia: pt(-0.3, -0.5),
      impactBob: 0.06,
      driveArc: pt(0.14, -0.12),
      windHand: pt(-0.1, -1.25),
      impactHand: pt(0.55, -0.6),
      followHand: pt(0.45, -0.42),
      windAngle: deg(-125),
      impactAngle: deg(60),
      followAngle: deg(85),
      windLean: 0,
      impactLean: deg(26),
      followLean: deg(24),
      windSway: -0.03,
      impactSway: 0.05,
      step: 0.2,
      stepFrom: 0.36,
      stepTo: 0.5,
      rearBrace: -0.14,
      behindFrom: 0,
      behindTo: 0.36,
      windSquash: 1.05,
      impactSquash: 0.9,
      freeHandWind: pt(-0.2, -0.72),
      freeHandImpact: pt(-0.24, -0.4),
    },
  },
  warhammer: {
    light: {
      // Chest-height sweep.
      windEnd: 0.3,
      holdEnd: 0.38,
      impactAt: 0,
      followEnd: 0.72,
      holdCreep: deg(8),
      crouch: 0.05,
      windVia: pt(-0.35, -0.55),
      impactBob: 0.03,
      driveArc: pt(0.08, -0.06),
      windHand: pt(-0.25, -0.9),
      impactHand: pt(0.65, -0.78),
      followHand: pt(0.5, -0.55),
      windAngle: deg(-158),
      impactAngle: deg(-6),
      followAngle: deg(60),
      windLean: deg(-4),
      impactLean: deg(16),
      followLean: deg(22),
      windSway: -0.08,
      impactSway: 0.1,
      step: 0.16,
      stepFrom: 0.38,
      stepTo: 0.58,
      rearBrace: -0.1,
      behindFrom: 0,
      behindTo: 0.38,
      windSquash: 1.03,
      impactSquash: 0.96,
      freeHandWind: pt(-0.3, -0.7),
      freeHandImpact: pt(0.1, -0.68),
    },
    heavy: {
      // The slowest, most telegraphed blow in the set: the deepest crouch, the
      // highest wind and the longest hold before it comes down.
      windEnd: 0.3,
      holdEnd: 0.46,
      impactAt: 0,
      followEnd: 0.72,
      holdCreep: deg(12),
      crouch: 0.09,
      windVia: pt(-0.35, -0.6),
      impactBob: 0.07,
      driveArc: pt(0.16, -0.12),
      windHand: pt(-0.05, -1.55),
      impactHand: pt(0.7, -0.75),
      followHand: pt(0.55, -0.5),
      windAngle: deg(-125),
      impactAngle: deg(55),
      followAngle: deg(80),
      windLean: 0,
      impactLean: deg(26),
      followLean: deg(30),
      windSway: -0.1,
      impactSway: 0.12,
      step: 0.3,
      stepFrom: 0.46,
      stepTo: 0.62,
      rearBrace: -0.2,
      behindFrom: 0,
      behindTo: 0.46,
      windSquash: 1.06,
      impactSquash: 0.9,
      freeHandWind: pt(-0.26, -1.02),
      freeHandImpact: pt(0.26, -0.4),
    },
  },
};

/**
 * Frames over which an attack is *supposed* to accelerate: from the end of its
 * wind through to just past impact.
 *
 * Spacing gates skip this window. That is not a loophole — it is the whole
 * point of the animation. A strike that spaced its frames evenly through the
 * drive would have no anticipation and no impact, which reads as a robot arm
 * rather than a strike. The smear crescent is drawn over the same frames, so
 * what the gates exempt is exactly what the art covers.
 */
export function accelerationWindow(
  archetype: GoblinArmedArchetype,
  kind: 'light' | 'heavy',
): { readonly from: number; readonly to: number } {
  const row = rowByName(kind === 'light' ? 'attack_light' : 'attack_heavy');
  // The bow's whole row is a draw and a release, so the window that the spacing
  // gates skip is the draw itself — the string has to accelerate off the hold.
  const spec = isMeleeArchetype(archetype) ? SWING_SPECS[archetype][kind] : null;
  const windEnd = spec === null ? THRUST_WIND_END : spec.windEnd;
  const FOLLOW_THROUGH_FRAMES = 2;
  return {
    from: Math.floor(windEnd * row.frameCount),
    to: IMPACT_FRAMES[archetype][kind] + FOLLOW_THROUGH_FRAMES,
  };
}

function attackPose(
  archetype: GoblinArmedArchetype,
  style: GoblinStyle,
  prop: GoblinProp,
  kind: 'light' | 'heavy',
  progress: number,
): GoblinPose {
  const impactAt = impactProgress(archetype, kind);
  if (!isMeleeArchetype(archetype)) return bowShotPose(style, prop, kind, progress, impactAt);
  const spec = SWING_SPECS[archetype][kind];
  if (spec === null) return thrustPose(archetype, style, prop, progress, impactAt);
  return swingPose(archetype, style, prop, { ...spec, impactAt }, progress);
}

// ── Flinch ───────────────────────────────────────────────────────────────────

/** Progress through which the flinch holds its full snap: the first frame. */
const FLINCH_SNAP_END = 0.1;
/** The rear foot staggers back this far, in tile units, and then steps home. */
const FLINCH_STAGGER_STEP = -0.08;
const FLINCH_STAGGER_END = 0.5;
const FLINCH_STAGGER_LIFT = 0.02;

/**
 * The flinch's pose at full recoil; every field eases back to rest with the
 * recoil. The body is thrown back and away from the blow while the hands are
 * flung back and the free one up, so the snap frame changes the silhouette
 * rather than reading as a nod.
 */
const FLINCH_RECOIL = {
  handBack: 0.12,
  carryHandDropOfArm: 0.08,
  freeHandRiseOfArm: 0.25,
  weaponTip: deg(14),
  lean: deg(-26),
  bob: 0.03,
  sway: -0.09,
  torsoSquash: 0.07,
  headTilt: deg(-34),
  headLead: -0.09,
  earLag: deg(38),
  eyeClose: 0.75,
} as const;

/**
 * Five frames, and disproportionately effective: without it a hit that does not
 * kill produces no reaction at all and the goblin reads as unhittable.
 */
function flinchPose(
  archetype: GoblinArmedArchetype,
  style: GoblinStyle,
  prop: GoblinProp,
  progress: number,
): GoblinPose {
  const rest = restingPose(style);
  const carry = carryHand(archetype, style);
  // At full recoil on the very first frame: the blow has already landed when
  // the row starts, so anything that builds up to the snap reads as a nod.
  const recoil =
    progress <= FLINCH_SNAP_END
      ? 1
      : 1 - easeInOut((progress - FLINCH_SNAP_END) / (1 - FLINCH_SNAP_END));
  const armLength = style.proportions.upperArmLength + style.proportions.forearmLength;
  const nearHand: Pt = {
    x: carry.x - FLINCH_RECOIL.handBack * recoil,
    y: carry.y + armLength * FLINCH_RECOIL.carryHandDropOfArm * recoil,
  };
  const weaponAngle =
    carryAngleFor(archetype, style, prop, nearHand.y) + FLINCH_RECOIL.weaponTip * recoil;

  return {
    ...rest,
    lean: FLINCH_RECOIL.lean * recoil,
    bob: FLINCH_RECOIL.bob * recoil,
    sway: FLINCH_RECOIL.sway * recoil,
    torsoSquash: 1 - FLINCH_RECOIL.torsoSquash * recoil,
    nearFoot: rest.nearFoot,
    farFoot: steppingOutAndHome(
      rest.farFoot.x,
      FLINCH_STAGGER_STEP,
      { from: FLINCH_SNAP_END, to: FLINCH_STAGGER_END },
      { from: FLINCH_STAGGER_END, to: STEP_HOME_BY },
      progress,
      FLINCH_STAGGER_LIFT,
    ),
    nearHand,
    farHand: gripFarHand(prop, nearHand, weaponAngle, {
      x: rest.farHand.x - FLINCH_RECOIL.handBack * recoil,
      y: rest.farHand.y - armLength * FLINCH_RECOIL.freeHandRiseOfArm * recoil,
    }),
    weaponAngle,
    headTilt: FLINCH_RECOIL.headTilt * recoil,
    headLead: FLINCH_RECOIL.headLead * recoil,
    earLag: FLINCH_RECOIL.earLag * recoil,
    mouthOpen: recoil,
    eyeOpen: 1 - recoil * FLINCH_RECOIL.eyeClose,
  };
}

// ── Impact smear ─────────────────────────────────────────────────────────────

/**
 * A tapering crescent along the weapon's arc, drawn on the frames either side of
 * impact. This is what buys perceived smoothness at 14–18 frames: without it the
 * strike frames are simply far apart and the eye sees a jump.
 */
const SMEAR_ALPHA = 0.28;
const SMEAR_SWEEP = deg(52);
const SMEAR_SEGMENTS = 7;

function drawImpactSmear(
  ctx: CanvasRenderingContext2D,
  originX: number,
  originY: number,
  unit: number,
  style: GoblinStyle,
  pose: GoblinPose,
  prop: GoblinProp,
  strength: number,
): void {
  if (strength <= 0 || pose.weaponAngle === null) return;
  ctx.save();
  ctx.translate(originX, originY);
  ctx.scale(unit, unit);
  ctx.globalAlpha = SMEAR_ALPHA * strength;

  const hand = pose.nearHand;
  const from = pose.weaponAngle - SMEAR_SWEEP;
  ctx.fillStyle = style.palette.iron.light;
  ctx.beginPath();
  for (let i = 0; i <= SMEAR_SEGMENTS; i++) {
    const t = i / SMEAR_SEGMENTS;
    const at = along(hand, lerp(from, pose.weaponAngle, t), prop.tipDistance);
    if (i === 0) ctx.moveTo(at.x, at.y);
    else ctx.lineTo(at.x, at.y);
  }
  for (let i = SMEAR_SEGMENTS; i >= 0; i--) {
    const t = i / SMEAR_SEGMENTS;
    // Tip-heavy: the crescent narrows toward the hand, which is where the
    // weapon is barely moving.
    const inner = lerp(prop.tipDistance * 0.35, prop.tipDistance * 0.86, t);
    const at = along(hand, lerp(from, pose.weaponAngle, t), inner);
    ctx.lineTo(at.x, at.y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Frames either side of impact that carry a smear, and how strongly. */
function smearStrength(archetype: GoblinArmedArchetype, row: RowSpec, frame: number): number {
  if (row.name !== 'attack_light' && row.name !== 'attack_heavy') return 0;
  const kind = row.name === 'attack_light' ? 'light' : 'heavy';
  // The sword's stab does not rotate, so a crescent would be a lie. Neither does
  // anything the bow does: an arc smear across a draw is a swing that never
  // happened.
  if (archetype === 'sword' && kind === 'light') return 0;
  if (archetype === 'bow') return 0;
  const distance = Math.abs(frame - IMPACT_FRAMES[archetype][kind]);
  const SMEAR_REACH = 2;
  if (distance > SMEAR_REACH) return 0;
  const FALLOFF = [1, 0.6, 0.3];
  return FALLOFF[distance];
}
// ── Frame production ─────────────────────────────────────────────────────────

/**
 * The seed every weapon and every wound is grown from.
 *
 * One number for the whole family, offset per archetype by its name's length,
 * so the axe's haft grain and the mace's flange nicks are different pieces of
 * the same deterministic noise field rather than two independent rolls.
 */
const GORE_SEED = 90210;

/**
 * One construction path for an archetype's weapon, so the geometry the gates
 * assert against is the same object the frames were painted with rather than a
 * second one built from the same table.
 */
function weaponFor(archetype: GoblinArmedArchetype): GoblinProp {
  const style = GOBLIN_STYLES[archetype];
  return WEAPON_FACTORIES[archetype](style.palette, seededNoise(GORE_SEED + archetype.length));
}

/** No bow shape at all, which is what every non-bow archetype's painter ignores. */
const NO_BOW_DRAW: BowDraw = { amount: 0, nocked: false };

/**
 * How far this frame's string is pulled.
 *
 * Derived from the same progress the pose is, rather than carried on the pose:
 * a bow's draw is a property of the *weapon*, and putting it on `GoblinPose`
 * would give every other archetype a field it can only ever leave at zero.
 */
function bowDrawFor(archetype: GoblinArmedArchetype, row: RowSpec, frame: number): BowDraw {
  if (isMeleeArchetype(archetype)) return NO_BOW_DRAW;
  if (row.name !== 'attack_light' && row.name !== 'attack_heavy') return NO_BOW_DRAW;
  const kind = row.name === 'attack_light' ? 'light' : 'heavy';
  return bowDrawAt(kind, frame, row.frameCount);
}

/**
 * One frame of one of the shared rows, posed for any goblin build carrying any
 * prop with one archetype's movement; the non-combat goblins borrow their walk
 * and idle through it.
 */
export function poseFor(
  archetype: GoblinArmedArchetype,
  style: GoblinStyle,
  prop: GoblinProp,
  row: RowSpec,
  frame: number,
): GoblinPose {
  switch (row.name) {
    case 'walk':
      return walkPose(archetype, style, prop, cyclePhase(frame, row.frameCount));
    case 'idle':
      return idlePose(archetype, style, prop, frame, row.frameCount);
    case 'idle_break':
      return idleBreakPose(archetype, style, prop, shotProgress(frame, row.frameCount));
    case 'attack_light':
      return attackPose(archetype, style, prop, 'light', shotProgress(frame, row.frameCount));
    case 'attack_heavy':
      return attackPose(archetype, style, prop, 'heavy', shotProgress(frame, row.frameCount));
    case 'flinch':
      return flinchPose(archetype, style, prop, shotProgress(frame, row.frameCount));
    default:
      throw new Error(`no pose for row ${row.name}`);
  }
}

// ── Cell geometry ────────────────────────────────────────────────────────────

/**
 * Where the goblin's own tile sits inside its cell, and how big that cell is.
 *
 * These four numbers per archetype are measured from the widest pose plus
 * padding, quantised, and wide enough that a spinning gore piece clears the
 * corners; `scripts/parity-figure-sheet.ts` confirms the painter still fills
 * exactly that cell. The gates re-check that nothing paints against the edge,
 * which is what would say a pose has outgrown them.
 *
 * They differ per archetype because a war hammer hauled overhead is a much
 * taller thing than a mace held at the hip.
 */
interface CellGeometry {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
}

const GEOMETRY: Record<GoblinArmedArchetype, CellGeometry> = {
  sword: { frameWidth: 152, frameHeight: 104, tileX: 44, tileY: 28 },
  axe: { frameWidth: 128, frameHeight: 112, tileX: 32, tileY: 36 },
  mace: { frameWidth: 112, frameHeight: 104, tileX: 24, tileY: 28 },
  warhammer: { frameWidth: 144, frameHeight: 120, tileX: 40, tileY: 44 },
  bow: { frameWidth: 128, frameHeight: 96, tileX: 32, tileY: 20 },
};

/** The cell row the soles stand on: the bottom of the creature's own tile. */
function groundYOf(archetype: GoblinArmedArchetype): number {
  return GEOMETRY[archetype].tileY + TILE_SCALE;
}

// ── Gore placement ───────────────────────────────────────────────────────────

/**
 * The nine pieces a goblin comes apart into, in the order `BodyPartGoreSystem`
 * spawns them. Each is a one-frame state of its own.
 */
export const GOBLIN_GORE_STATES: readonly string[] = [
  'gore_head',
  'gore_torso',
  'gore_arm_near',
  'gore_arm_far',
  'gore_leg_near',
  'gore_leg_far',
  'gore_ribchunk',
  'gore_entrails',
  'gore_jaw',
];

/**
 * How far each severed piece is nudged so that its ink, not its authoring
 * origin, sits at the centre of the cell.
 *
 * `BodyPartGoreSystem` spins a piece about the centre of its own visible
 * pixels, so a piece drawn off-centre in its cell orbits rather than tumbles.
 * The offsets are in tile units, applied before the archetype's own figure
 * scale, and they were measured from the painted ink of each piece. Measuring
 * is something only an offline pass can do, so the numbers are frozen here and
 * `scripts/gates-goblins.ts` re-measures the *effect* — that the ink lands on
 * the cell centre — on every render.
 *
 * Per archetype, not shared: the five builds are different sizes and their
 * pieces are cut from different bodies, so their ink centres do not agree.
 */
export const GORE_RECENTRE: Readonly<Record<GoblinArmedArchetype, ReadonlyMap<string, Pt>>> = {
  sword: new Map([
    ['gore_head', pt(0.0703125, -0.0234375)],
    ['gore_torso', pt(0, 0)],
    ['gore_arm_near', pt(0.1171875, -0.0078125)],
    ['gore_arm_far', pt(0.1015625, -0.0390625)],
    ['gore_leg_near', pt(0.1328125, -0.0234375)],
    ['gore_leg_far', pt(0.0390625, -0.0078125)],
    ['gore_ribchunk', pt(0, 0.0234375)],
    ['gore_entrails', pt(0.0078125, 0.0078125)],
    ['gore_jaw', pt(-0.015625, 0.015625)],
  ]),
  axe: new Map([
    ['gore_head', pt(0.0625, -0.0390625)],
    ['gore_torso', pt(0, -0.0078125)],
    ['gore_arm_near', pt(0.140625, 0)],
    ['gore_arm_far', pt(0.125, -0.0390625)],
    ['gore_leg_near', pt(0.140625, -0.0234375)],
    ['gore_leg_far', pt(0.046875, 0)],
    ['gore_ribchunk', pt(0, 0.03125)],
    ['gore_entrails', pt(0.0078125, 0.0078125)],
    ['gore_jaw', pt(-0.0234375, 0.015625)],
  ]),
  mace: new Map([
    ['gore_head', pt(0.046875, -0.0546875)],
    ['gore_torso', pt(0.0078125, -0.0078125)],
    ['gore_arm_near', pt(0.125, -0.0078125)],
    ['gore_arm_far', pt(0.109375, -0.0390625)],
    ['gore_leg_near', pt(0.1328125, -0.0234375)],
    ['gore_leg_far', pt(0.0390625, -0.0078125)],
    ['gore_ribchunk', pt(-0.0078125, 0.03125)],
    ['gore_entrails', pt(0.0078125, 0.0078125)],
    ['gore_jaw', pt(-0.015625, 0.015625)],
  ]),
  warhammer: new Map([
    ['gore_head', pt(0.0546875, -0.046875)],
    ['gore_torso', pt(0, -0.0078125)],
    ['gore_arm_near', pt(0.1328125, 0.0078125)],
    ['gore_arm_far', pt(0.125, -0.03125)],
    ['gore_leg_near', pt(0.15625, -0.015625)],
    ['gore_leg_far', pt(0.0546875, 0.0078125)],
    ['gore_ribchunk', pt(-0.0078125, 0.03125)],
    ['gore_entrails', pt(0.0078125, 0.0078125)],
    ['gore_jaw', pt(-0.015625, 0.015625)],
  ]),
  bow: new Map([
    ['gore_head', pt(0.0703125, -0.0078125)],
    ['gore_torso', pt(0.0078125, -0.0078125)],
    ['gore_arm_near', pt(0.1328125, -0.015625)],
    ['gore_arm_far', pt(0.1171875, -0.046875)],
    ['gore_leg_near', pt(0.1484375, -0.03125)],
    ['gore_leg_far', pt(0.0390625, -0.0078125)],
    ['gore_ribchunk', pt(0, 0.0234375)],
    ['gore_entrails', pt(0.0078125, 0.0078125)],
    ['gore_jaw', pt(-0.015625, 0.015625)],
  ]),
};

function goreRecentreOf(archetype: GoblinArmedArchetype, state: string): Pt {
  const offset = GORE_RECENTRE[archetype].get(state);
  if (offset === undefined) {
    throw new Error(`no gore recentring offset for goblin_${archetype} "${state}"`);
  }
  return offset;
}

/**
 * The weapon and the wound set per archetype, built once.
 *
 * Both are grown from a seeded noise field, so rebuilding them per painted
 * frame would produce identical art at real cost; the cache paints a cell for
 * every frame of every row of five figures.
 */
const WEAPONS: Record<GoblinArmedArchetype, GoblinProp> = {
  sword: weaponFor('sword'),
  axe: weaponFor('axe'),
  mace: weaponFor('mace'),
  warhammer: weaponFor('warhammer'),
  bow: weaponFor('bow'),
};

const GORE_PIECES: Record<GoblinArmedArchetype, readonly GorePiece[]> = {
  sword: gorePieces(GOBLIN_STYLES.sword),
  axe: gorePieces(GOBLIN_STYLES.axe),
  mace: gorePieces(GOBLIN_STYLES.mace),
  warhammer: gorePieces(GOBLIN_STYLES.warhammer),
  bow: gorePieces(GOBLIN_STYLES.bow),
};

/** The weapon an archetype's frames are painted with, for the arc gates. */
export function goblinWeapon(archetype: GoblinArmedArchetype): GoblinProp {
  return WEAPONS[archetype];
}

/** The pose one frame of one animation row resolves to, for the pose gates. */
export function goblinPose(
  archetype: GoblinArmedArchetype,
  row: RowSpec,
  frame: number,
): GoblinPose {
  return poseFor(archetype, GOBLIN_STYLES[archetype], WEAPONS[archetype], row, frame);
}

/** Where the weapon's tip sits on a frame, in figure units, or null if unarmed. */
export function goblinWeaponTip(pose: GoblinPose, archetype: GoblinArmedArchetype): Pt | null {
  if (pose.weaponAngle === null) return null;
  return along(pose.nearHand, pose.weaponAngle, WEAPONS[archetype].tipDistance);
}

function poseRowOf(state: string): RowSpec | undefined {
  return ROWS.find((row) => row.name === state);
}

function gorePieceOf(archetype: GoblinArmedArchetype, state: string): GorePiece {
  const piece = GORE_PIECES[archetype].find((candidate) => candidate.state === state);
  if (piece === undefined) throw new Error(`no gore piece for goblin_${archetype} "${state}"`);
  return piece;
}

/**
 * Paints one cell of one goblin, in the cell's own pixels.
 *
 * An animation frame is anchored at the ground line under the cell's centre,
 * which is what ties the art to the tile the goblin stands on. A gore piece is
 * anchored at the cell's centre instead, because the only thing that reads its
 * cell is the spin the gore field applies about that point.
 */
function paintGoblinFrame(
  archetype: GoblinArmedArchetype,
  ctx: CanvasRenderingContext2D,
  state: string,
  frame: number,
): void {
  const style = GOBLIN_STYLES[archetype];
  const geometry = GEOMETRY[archetype];
  const drawScale = ARCHETYPE_SCALE[archetype];
  const centreX = geometry.frameWidth / 2;
  const row = poseRowOf(state);

  if (row === undefined) {
    const piece = gorePieceOf(archetype, state);
    const recentre = goreRecentreOf(archetype, state);
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

  const prop = WEAPONS[archetype];
  const pose = poseFor(archetype, style, prop, row, frame);
  const groundY = groundYOf(archetype);
  const figureUnit = TILE_SCALE * drawScale;
  // Published immediately before the figure is painted, because the bow is the
  // one prop whose geometry is not fixed and the painter has no other way to
  // learn how far this frame's string is pulled.
  setBowDraw(bowDrawFor(archetype, row, frame));
  drawImpactSmear(
    ctx,
    centreX,
    groundY,
    figureUnit,
    style,
    pose,
    prop,
    smearStrength(archetype, row, frame),
  );
  drawGoblin(ctx, centreX, groundY, figureUnit, style, pose, prop);
}

/** Every state a goblin figure declares: the animation rows, then the pieces. */
function goblinStateFrames(): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const row of ROWS) frames[row.name] = row.frameCount;
  for (const state of GOBLIN_GORE_STATES) frames[state] = 1;
  return frames;
}

function goblinFigureOf(archetype: GoblinArmedArchetype): FigureDef {
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
    states: figureStates(goblinStateFrames()),
    paintFrame: (ctx, state, frame) => {
      paintGoblinFrame(archetype, ctx, state, frame);
    },
  };
}

export const GOBLIN_SWORD_FIGURE: FigureDef = goblinFigureOf('sword');
export const GOBLIN_AXE_FIGURE: FigureDef = goblinFigureOf('axe');
export const GOBLIN_MACE_FIGURE: FigureDef = goblinFigureOf('mace');
export const GOBLIN_WARHAMMER_FIGURE: FigureDef = goblinFigureOf('warhammer');
export const GOBLIN_BOW_FIGURE: FigureDef = goblinFigureOf('bow');

/** Every goblin figure by archetype — the five sheets this family replaced. */
export const GOBLIN_FIGURES: Record<GoblinArmedArchetype, FigureDef> = {
  sword: GOBLIN_SWORD_FIGURE,
  axe: GOBLIN_AXE_FIGURE,
  mace: GOBLIN_MACE_FIGURE,
  warhammer: GOBLIN_WARHAMMER_FIGURE,
  bow: GOBLIN_BOW_FIGURE,
};

// ── The plumber ──────────────────────────────────────────────────────────────

/**
 * The rows the plumber paints: the ones a goblin that never fights can enter.
 *
 * He stands, fidgets, walks and flinches when struck, which is everything
 * `GoblinAnimator` resolves to when it is never handed an attack.
 */
export const GOBLIN_PLUMBER_ROWS: readonly RowSpec[] = ROWS.filter(
  (row) => row.name !== 'attack_light' && row.name !== 'attack_heavy',
);

/**
 * Whose movement the plumber borrows. The sword goblin's idle break plants the
 * held tool's head on the floor and leans on it while it rolls its neck, which
 * on a wrench reads as a tradesman taking a breather rather than as a threat.
 */
const PLUMBER_CHOREOGRAPHY: GoblinArmedArchetype = 'sword';

/** Ground one of the plumber's walk cycles covers, in tiles. */
export const GOBLIN_PLUMBER_WALK_GROUND_PER_CYCLE_TILES = groundPerCycleTiles(
  GAITS[PLUMBER_CHOREOGRAPHY],
  GOBLIN_PLUMBER_SCALE,
);

const PLUMBER_GEOMETRY: CellGeometry = { frameWidth: 96, frameHeight: 88, tileX: 16, tileY: 12 };

const PLUMBER_WRENCH: GoblinProp = makePipeWrenchProp(GOBLIN_PLUMBER_STYLE.palette);

function plumberRowOf(state: string): RowSpec {
  const row = GOBLIN_PLUMBER_ROWS.find((candidate) => candidate.name === state);
  if (row === undefined) throw new Error(`goblin_plumber paints no row "${state}"`);
  return row;
}

/** The pose one frame of one of the plumber's rows resolves to, for the gates. */
export function goblinPlumberPose(row: RowSpec, frame: number): GoblinPose {
  return poseFor(PLUMBER_CHOREOGRAPHY, GOBLIN_PLUMBER_STYLE, PLUMBER_WRENCH, row, frame);
}

function paintPlumberFrame(ctx: CanvasRenderingContext2D, state: string, frame: number): void {
  const pose = goblinPlumberPose(plumberRowOf(state), frame);
  drawGoblin(
    ctx,
    PLUMBER_GEOMETRY.frameWidth / 2,
    PLUMBER_GEOMETRY.tileY + TILE_SCALE,
    TILE_SCALE * GOBLIN_PLUMBER_SCALE,
    GOBLIN_PLUMBER_STYLE,
    pose,
    PLUMBER_WRENCH,
  );
}

function plumberStateFrames(): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const row of GOBLIN_PLUMBER_ROWS) frames[row.name] = row.frameCount;
  return frames;
}

/**
 * The bathroom plumber: cap, overalls, tool belt, a pipe wrench in hand and a
 * plunger on his back. No attack rows and no gore pieces, because he neither
 * fights nor dies.
 */
export const GOBLIN_PLUMBER_FIGURE: FigureDef = {
  id: 'goblin_plumber',
  frameWidth: PLUMBER_GEOMETRY.frameWidth,
  frameHeight: PLUMBER_GEOMETRY.frameHeight,
  tileX: PLUMBER_GEOMETRY.tileX,
  tileY: PLUMBER_GEOMETRY.tileY,
  tileScale: TILE_SCALE,
  skipSupersample: true,
  states: figureStates(plumberStateFrames()),
  paintFrame: paintPlumberFrame,
};

export { ARCHETYPE_SCALE, GOBLIN_ARMED_ARCHETYPES, GOBLIN_STYLES };
export type { GoblinArmedArchetype };
