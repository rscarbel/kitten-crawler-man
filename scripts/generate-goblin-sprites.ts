#!/usr/bin/env tsx
/**
 * Bakes the four goblin sprite sheets — sword, axe, mace and war hammer.
 *
 * This file is choreography and assembly only: the anatomy lives in
 * `goblinArt.ts`, the weapons in `goblinWeapons.ts` and the wounds in
 * `goblinGore.ts`. What is here is *where the hands and feet go on each frame*,
 * how the frames are packed, and the gates that stop a bad bake reaching disk.
 *
 * Poses are authored as foot and hand **targets**; the rig solves the knees and
 * elbows. That is the single reason a limb stays welded to the body through a
 * 180° swing, and it is why a planted foot can be asserted rather than eyeballed.
 *
 * Every figure is drawn facing +X; the runtime mirrors it for the other facing.
 *
 * Run:    npm run gen:goblins
 * Review: npx tsx scripts/render-goblins.ts --variant=axe
 */

import { createCanvas, type CanvasRenderingContext2D as Ctx } from 'canvas';
import {
  ARCHETYPE_SCALE,
  GOBLIN_ARCHETYPES,
  GOBLIN_STYLES,
  along,
  clamp01,
  deg,
  drawGoblin,
  easeIn,
  easeInOut,
  easeOut,
  hump,
  lerp,
  pt,
  restingPose,
  seededNoise,
  shoulderHeight,
  type GoblinArchetype,
  type GoblinPose,
  type GoblinProp,
  type GoblinStyle,
  type Pt,
} from './goblinArt';
import { WEAPON_FACTORIES } from './goblinWeapons';
import { gorePieces } from './goblinGore';

/** Tile size the art is drawn at; the runtime scales by tileSize / TILE_SCALE. */
export const TILE_SCALE = 64;
/** Frames are rendered at this multiple and downsampled for smoother edges. */
const SUPERSAMPLE = 2;
/** zlib's slowest, smallest setting — these sheets are baked once, offline. */
const MAX_PNG_COMPRESSION = 9;
/**
 * Columns before a long row wraps onto the next physical row of the sheet.
 *
 * Ten rather than twelve. Every row's frame count (12, 12, 18, 14, 18, 5, 9)
 * costs the same 120 cells either way, but ten columns keeps the widest sheet
 * under the 2560-px texture target instead of 32 px over it.
 */
export const COLS_PER_ROW = 10;
/** Clear space kept between the outermost ink and the frame edge, in px. */
const FRAME_PADDING = 6;
/** Frame dimensions round up to this, so the sheet stays on tidy boundaries. */
const FRAME_SIZE_QUANTUM = 8;

const FULL_CYCLE = Math.PI * 2;

// ── Row manifest ─────────────────────────────────────────────────────────────

export type RowKind = 'loop' | 'oneShot' | 'gore';

export interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly kind: RowKind;
}

/**
 * Uniform across all four sheets, so `SpriteStates['goblin_sword']` and
 * `SpriteStates['goblin_warhammer']` are the same union and the runtime needs no
 * per-weapon state mapping — and therefore no casts.
 */
export const ROWS: readonly RowSpec[] = [
  { name: 'walk', frameCount: 12, kind: 'loop' },
  { name: 'idle', frameCount: 12, kind: 'loop' },
  { name: 'idle_break', frameCount: 18, kind: 'oneShot' },
  { name: 'attack_light', frameCount: 14, kind: 'oneShot' },
  { name: 'attack_heavy', frameCount: 18, kind: 'oneShot' },
  { name: 'flinch', frameCount: 5, kind: 'oneShot' },
  { name: 'gore', frameCount: 9, kind: 'gore' },
];

/**
 * Sprite frame each attack connects on. The runtime's `GOBLIN_ATTACKS` table
 * carries the same numbers and gate G13 asserts the two match — if one moves,
 * both move.
 */
export const IMPACT_FRAMES: Record<GoblinArchetype, { light: number; heavy: number }> = {
  sword: { light: 6, heavy: 8 },
  axe: { light: 6, heavy: 9 },
  mace: { light: 7, heavy: 8 },
  warhammer: { light: 7, heavy: 10 },
};

/** Loops sample the cycle evenly; one-shots sample the middle of each frame. */
function cyclePhase(frame: number, frameCount: number): number {
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

/** Progress at which an attack's impact frame lands. */
function impactProgress(archetype: GoblinArchetype, kind: 'light' | 'heavy'): number {
  const row = rowByName(kind === 'light' ? 'attack_light' : 'attack_heavy');
  return shotProgress(IMPACT_FRAMES[archetype][kind], row.frameCount);
}

// ── Walk ─────────────────────────────────────────────────────────────────────

/** Fraction of a stride a foot spends planted. High: goblins scuttle. */
const CONTACT_FRACTION = 0.62;
/** Two footfalls per cycle, so the pelvis rises twice as fast as it strides. */
const BOB_PER_CYCLE = 2;
/** Ears trail the head by this fraction of a cycle. */
const EAR_LAG_PHASE = 2 / 12;

interface GaitConfig {
  /** Half the distance between the forward and rear extremes of a stride. */
  readonly stride: number;
  readonly lift: number;
  readonly bob: number;
  readonly sway: number;
  readonly leanSwing: number;
  /** Forward/back travel of the free hand as it counter-swings the legs. */
  readonly armSwing: number;
  /** The weapon arm swings less: the weapon's mass damps it. */
  readonly weaponArmDamping: number;
  /** Knees splay outward; this is how far the foot tracks outside the hip. */
  readonly splay: number;
  /** A bird-like forward-and-back head bob, not an up-and-down one. */
  readonly headLead: number;
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

const GAITS: Record<GoblinArchetype, GaitConfig> = {
  sword: {
    stride: 0.32,
    lift: 0.13,
    bob: 0.055,
    sway: 0.042,
    leanSwing: deg(3),
    armSwing: 0.24,
    weaponArmDamping: 0.45,
    splay: 0.03,
    headLead: 0.035,
  },
  axe: {
    stride: 0.26,
    lift: 0.105,
    bob: 0.062,
    sway: 0.046,
    leanSwing: deg(3.5),
    armSwing: 0.2,
    weaponArmDamping: 0.3,
    splay: 0.045,
    headLead: 0.03,
  },
  mace: {
    stride: 0.23,
    lift: 0.095,
    bob: 0.078,
    sway: 0.063,
    leanSwing: deg(4),
    armSwing: 0.19,
    weaponArmDamping: 0.5,
    splay: 0.055,
    headLead: 0.026,
  },
  warhammer: {
    stride: 0.25,
    lift: 0.088,
    bob: 0.086,
    sway: 0.075,
    leanSwing: deg(3),
    armSwing: 0.15,
    weaponArmDamping: 0.2,
    splay: 0.06,
    headLead: 0.02,
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
const CARRY_HAND_HIP_FRACTION = 1.25;
const CARRY_HAND_HEIGHT_FRACTION = 0.46;

function carryHand(style: GoblinStyle): Pt {
  return {
    x: style.proportions.hipHalfWidth * CARRY_HAND_HIP_FRACTION,
    y: -shoulderHeight(style.proportions) * CARRY_HAND_HEIGHT_FRACTION,
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
 * The carry angle used to put the tip exactly on the ground plane, which reads
 * nicely at review scale and fails the silhouette test outright: the axe head
 * and the mace head landed in among the feet, merged with them and with the
 * ground shadow, and both archetypes became a hunched blob with a lump at the
 * bottom. The weapon has to sit against empty background to be nameable.
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

function carryAngle(style: GoblinStyle, prop: GoblinProp, handY: number): number {
  // Capped short of vertical because `asin` is near-vertical as its argument
  // approaches 1: a hand raised to within a few percent of the weapon's own
  // length would otherwise swing the blade tens of degrees in a single frame,
  // which gate G8 reports as a cliff and a player sees as a snap.
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

function walkPose(
  archetype: GoblinArchetype,
  style: GoblinStyle,
  prop: GoblinProp,
  phase: number,
): GoblinPose {
  const rest = restingPose(style);
  const gait = GAITS[archetype];
  const swingAngle = phase * FULL_CYCLE;
  const armPhase = Math.sin(swingAngle);
  const near = footTarget(phase, gait);
  const far = footTarget(phase + 0.5, gait);

  // A walking goblin carries its weapon clear of the floor; only a standing one
  // rests the head on it. Without this lift the axe ploughs a furrow.
  const WALK_CARRY_LIFT = 0.12;
  /**
   * The carried weapon rises and falls with the hips, twice per stride.
   *
   * Small on purpose: the hand is already swinging fore-and-aft on a once-per
   * -stride sine, and a large second-harmonic bob on top of it makes the tip
   * lurch where the two are in phase — which gate G8 reports as a cliff.
   */
  const WEAPON_BOB = 0.022;
  const carry = carryHand(style);
  const nearHand: Pt = {
    x: carry.x - armPhase * gait.armSwing * gait.weaponArmDamping,
    y:
      carry.y -
      WALK_CARRY_LIFT -
      Math.abs(armPhase) * gait.armSwing * 0.18 -
      WEAPON_BOB * Math.cos(swingAngle * BOB_PER_CYCLE),
  };
  const weaponAngle = carryAngle(style, prop, nearHand.y);
  const freeHand: Pt = {
    x: rest.farHand.x + armPhase * gait.armSwing,
    y: rest.farHand.y - Math.abs(armPhase) * gait.armSwing * 0.22,
  };

  return {
    ...rest,
    bob: -gait.bob * (0.5 - 0.5 * Math.cos(swingAngle * BOB_PER_CYCLE)),
    sway: gait.sway * Math.sin(swingAngle),
    lean: gait.leanSwing * Math.sin(swingAngle * BOB_PER_CYCLE),
    // Knees splay outward, which is what makes the gait bandy rather than a march.
    nearFoot: { x: near.x + gait.splay, y: near.y },
    farFoot: { x: far.x - gait.splay, y: far.y },
    nearHand,
    farHand: gripFarHand(prop, nearHand, weaponAngle, freeHand),
    weaponAngle,
    headLead: gait.headLead * Math.sin(swingAngle * BOB_PER_CYCLE + Math.PI / 3),
    earLag: deg(-14) * Math.sin((phase - EAR_LAG_PHASE) * FULL_CYCLE * BOB_PER_CYCLE),
    headTilt: -armPhase * deg(2.5),
    eyeOpen: 1,
  };
}

// ── Idle ─────────────────────────────────────────────────────────────────────

interface IdleConfig {
  readonly breathDepth: number;
  readonly bob: number;
  /** A slow weight shift from one foot to the other, once per loop. */
  readonly weightShift: number;
  readonly headRoll: number;
  /** Frame of the loop the two-frame blink starts on. */
  readonly blinkFrame: number;
  /** Frame the ear twitch starts on; deliberately not the blink's. */
  readonly twitchFrame: number;
}

const IDLES: Record<GoblinArchetype, IdleConfig> = {
  sword: { breathDepth: 0.075, bob: 0.055, weightShift: 0.085, headRoll: deg(4), blinkFrame: 3, twitchFrame: 8 },
  axe: { breathDepth: 0.09, bob: 0.05, weightShift: 0.07, headRoll: deg(3), blinkFrame: 7, twitchFrame: 2 },
  mace: { breathDepth: 0.12, bob: 0.065, weightShift: 0.1, headRoll: deg(5), blinkFrame: 5, twitchFrame: 10 },
  warhammer: { breathDepth: 0.115, bob: 0.075, weightShift: 0.06, headRoll: deg(2), blinkFrame: 9, twitchFrame: 4 },
};

/** A blink is two frames of a twelve-frame loop; any longer reads as a doze. */
/** The head's fore-and-aft drift, as a multiple of the idle bob. */
const IDLE_HEAD_LEAD = 1.4;
/** The head rolls twice per breath, so the two never lock into one motion. */
const HEAD_ROLL_PER_CYCLE = 2;
const BLINK_FRAMES = 2;
const TWITCH_FRAMES = 3;

function windowedAt(frame: number, start: number, length: number, frameCount: number): number {
  const since = (frame - start + frameCount) % frameCount;
  return since < length ? hump((since + 0.5) / length) : 0;
}

function idlePose(
  archetype: GoblinArchetype,
  style: GoblinStyle,
  prop: GoblinProp,
  frame: number,
  frameCount: number,
): GoblinPose {
  const rest = restingPose(style);
  const config = IDLES[archetype];
  const phase = cyclePhase(frame, frameCount);
  const breath = Math.sin(phase * FULL_CYCLE);
  /**
   * The weight shift, phased so it is **zero at frame 0**.
   *
   * Every one-shot row ends by handing back to idle frame 0, so any field that
   * is non-zero there is a pop on every swing, blink and flinch — which is
   * exactly what gate G6 measures. A raw `sin(θ − π/2)` sits at −1 on frame 0.
   * Offsetting it makes the goblin lean onto one foot and back rather than
   * rocking between them, which is what a bored scavenger does anyway.
   */
  const shift = (Math.sin(phase * FULL_CYCLE - Math.PI / 2) + 1) / 2;
  const blink = windowedAt(frame, config.blinkFrame, BLINK_FRAMES, frameCount);
  const twitch = windowedAt(frame, config.twitchFrame, TWITCH_FRAMES, frameCount);

  const carry = carryHand(style);
  const nearHand: Pt = { x: carry.x, y: carry.y - config.bob * breath };
  const weaponAngle = carryAngle(style, prop, nearHand.y);

  return {
    ...rest,
    bob: config.bob * breath,
    sway: config.weightShift * shift,
    torsoSquash: 1 + config.breathDepth * breath,
    nearHand,
    farHand: gripFarHand(prop, nearHand, weaponAngle, {
      x: rest.farHand.x,
      y: rest.farHand.y + config.bob * breath * 0.6,
    }),
    weaponAngle,
    // The head leads and trails the breath rather than only rolling, so an idle
    // goblin looks like it is looking around rather than like a still frame.
    headTilt: config.headRoll * Math.sin(phase * FULL_CYCLE * HEAD_ROLL_PER_CYCLE),
    // Phased to be zero at frame 0, because every one-shot row hands back to
    // idle frame 0 and a non-zero value there is a pop on every single swing.
    headLead: config.bob * IDLE_HEAD_LEAD * Math.sin(phase * FULL_CYCLE),
    lean: deg(-2) * breath,
    earLag: deg(-18) * twitch,
    eyeOpen: 1 - blink,
  };
}

// ── Idle break ───────────────────────────────────────────────────────────────

/**
 * A 0→1→0 envelope whose ends are flat.
 *
 * A raw `hump` has its steepest slope at t=0, so a flourish built on one leaves
 * the idle pose at full speed and the first two frames jump — which is what gate
 * G8 measures as a cliff in the tip-spacing chart. Easing the input first flattens
 * both ends, so the break grows out of the idle and settles back into it.
 */
function smoothHump(t: number): number {
  return hump(easeInOut(t));
}

/**
 * The occasional flourish that gives each archetype its personality. Every one
 * starts and ends on the idle pose, so it can be dropped on top of the loop.
 */
function idleBreakPose(
  archetype: GoblinArchetype,
  style: GoblinStyle,
  prop: GoblinProp,
  progress: number,
): GoblinPose {
  const rest = restingPose(style);
  const base = idlePose(archetype, style, prop, 0, rowByName('idle').frameCount);
  const carry = carryHand(style);
  // A single 0→1→0 hump, so the break always returns to where idle frame 0 is.
  const swell = smoothHump(progress);
  const armLength = style.proportions.upperArmLength + style.proportions.forearmLength;

  switch (archetype) {
    case 'sword': {
      // Raises the blade to thumb the edge and levels the point forward in one
      // continuous gesture, then lowers it.
      //
      // The first cut split this into two beats with a gap between them, and the
      // gap was the defect: the blade stalled for a frame and then leapt, which
      // is a spacing cliff rather than a pause. One envelope cannot stall.
      const raise = smoothHump(progress);
      const LEVELLED_ANGLE = deg(-6);
      const nearHand: Pt = {
        x: lerp(carry.x, carry.x + armLength * 0.3, raise),
        y: lerp(carry.y, -shoulderHeight(style.proportions) * 0.82, raise),
      };
      return {
        ...base,
        nearHand,
        weaponAngle: lerp(carryAngle(style, prop, nearHand.y), LEVELLED_ANGLE, raise),
        farHand: {
          x: rest.farHand.x - 0.05 * raise,
          y: rest.farHand.y - armLength * 0.16 * raise,
        },
        lean: deg(-4) * raise,
        headTilt: deg(-8) * raise,
        headLead: 0.03 * raise,
        mouthOpen: raise * 0.7,
        eyeOpen: 1,
      };
    }
    case 'axe': {
      // Hefts the axe up and lets it drop back into the palm, twice.
      const HEFTS = 2;
      const heft = smoothHump((progress * HEFTS) % 1) * swell;
      const nearHand: Pt = {
        x: carry.x + 0.09 * heft,
        y: carry.y - armLength * 0.52 * heft,
      };
      const weaponAngle = carryAngle(style, prop, nearHand.y) - deg(26) * heft;
      return {
        ...base,
        bob: -0.02 * heft,
        nearHand,
        weaponAngle,
        farHand: gripFarHand(prop, nearHand, weaponAngle, rest.farHand),
        headTilt: deg(8) * heft,
        lean: deg(-7) * heft,
      };
    }
    case 'mace': {
      // A lazy one-handed twirl beside the hip.
      // Across the whole row, not 85% of it: clamping the twirl early parks the
      // head for the last three frames while the hand keeps moving, which is a
      // stall followed by a jump rather than a wind-down.
      const twirl = easeInOut(progress) * FULL_CYCLE;
      const nearHand: Pt = {
        x: carry.x + 0.05 * swell,
        y: carry.y - 0.06 * swell,
      };
      return {
        ...base,
        nearHand,
        weaponAngle: carryAngle(style, prop, nearHand.y) - twirl,
        propBehind: Math.sin(twirl) < -0.2,
        headTilt: deg(6) * swell,
        mouthOpen: 0.3 * swell,
      };
    }
    case 'warhammer': {
      // Shoulder roll, neck crack, spits.
      const roll = smoothHump(clamp01(progress / 0.45));
      const crack = smoothHump(clamp01((progress - 0.4) / 0.3));
      const spit = smoothHump(clamp01((progress - 0.7) / 0.3));
      const nearHand: Pt = {
        x: carry.x + 0.07 * roll,
        y: carry.y - 0.12 * roll,
      };
      const weaponAngle = carryAngle(style, prop, nearHand.y);
      return {
        ...base,
        torsoSquash: base.torsoSquash + 0.11 * roll,
        lean: deg(-11) * roll + deg(14) * spit,
        bob: base.bob - 0.05 * roll,
        nearHand,
        weaponAngle,
        farHand: gripFarHand(prop, nearHand, weaponAngle, rest.farHand),
        headTilt: deg(-26) * crack + deg(20) * spit,
        headLead: 0.11 * spit - 0.05 * crack,
        mouthOpen: spit,
        earLag: deg(-22) * crack,
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
 * is `easeOut` so it decays. A linear sweep across the row is what the old
 * goblin did, and it is exactly why that attack read as a robot arm.
 */
interface SwingSpec {
  /** Progress at which the wind is fully loaded. */
  readonly windEnd: number;
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
function steppingFoot(base: number, distance: number, from: number, to: number, progress: number, lift: number): Pt {
  if (progress <= from) return { x: base, y: 0 };
  if (progress >= to) return { x: base + distance, y: 0 };
  const t = (progress - from) / (to - from);
  return { x: base + distance * easeInOut(t), y: -lift * Math.sin(t * Math.PI) };
}

const STEP_LIFT = 0.05;

/**
 * Elevation past which a weapon is over the goblin's own skull. Angles run 0
 * forward and negative upward.
 */
const OVERHEAD_FROM = deg(-45);
/** Past here the weapon has swung all the way over and is descending in front. */
const OVERHEAD_TO = deg(-235);

function pointsOverhead(weaponAngle: number): boolean {
  return weaponAngle < OVERHEAD_FROM && weaponAngle > OVERHEAD_TO;
}

function swingPose(
  style: GoblinStyle,
  prop: GoblinProp,
  spec: SwingSpec,
  progress: number,
): GoblinPose {
  const rest = restingPose(style);
  const carry = carryHand(style);
  const restAngle = carryAngle(style, prop, carry.y);

  const wind = easeInOut(clamp01(progress / spec.windEnd));
  const drive = easeIn(clamp01((progress - spec.windEnd) / (spec.impactAt - spec.windEnd)));
  const follow = easeOut(clamp01((progress - spec.impactAt) / (spec.followEnd - spec.impactAt)));
  /**
   * Where the recovery starts, as a fraction of the way from impact to the end
   * of the follow-through.
   *
   * Not zero and not one. Back to back, `follow`'s ease-out and `recover`'s
   * ease-in are both flat at the boundary, so the weapon stalls for a frame and
   * then leaps. Overlapping them by half, which was the first fix, cancelled
   * most of the follow-through instead: the recovery was already hauling back
   * while the swing was still travelling, and the tip barely moved past the hit.
   * A late overlap keeps something moving at every frame *and* lets the strike
   * carry well past contact before it is undone.
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

  const nearHand = stagePt(carry, spec.windHand, spec.impactHand, spec.followHand);
  const swungAngle = stage(restAngle, spec.windAngle, spec.impactAngle, spec.followAngle);
  const weaponAngle = Math.min(swungAngle, groundLandingAngle(prop, nearHand.y));
  const freeHand = stagePt(rest.farHand, spec.freeHandWind, spec.freeHandImpact, rest.farHand);

  const stanceNear = rest.nearFoot.x;
  const stanceFar = rest.farFoot.x;

  return {
    ...rest,
    lean: stage(0, spec.windLean, spec.impactLean, spec.followLean),
    sway: stage(0, spec.windSway, spec.impactSway, spec.impactSway * 0.5),
    torsoSquash: stage(1, spec.windSquash, spec.impactSquash, 1.02),
    bob: stage(0, -0.02, 0.02, 0.01),
    nearFoot: steppingFoot(stanceNear, spec.step, spec.stepFrom, spec.stepTo, progress, STEP_LIFT),
    farFoot: steppingFoot(stanceFar, spec.rearBrace, 0, spec.windEnd, progress, STEP_LIFT * 0.4),
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
    // Head, ears and jaw all lag the torso: nothing arrives at its extreme on
    // the same frame as the body does.
    headTilt: stage(0, deg(-12), deg(14), deg(8)),
    headLead: stage(0, -0.02, 0.05, 0.02),
    earLag: stage(0, deg(16), deg(-26), deg(-8)),
    mouthOpen: Math.max(wind * 0.4, drive * (1 - follow * 0.5)),
    eyeOpen: 1,
  };
}

/** Progress at which the stab's anticipation is fully loaded. */
const THRUST_WIND_END = 0.32;

/**
 * The sword's stab, which cannot be a swing: the blade translates along its own
 * axis and must not rotate, or the "thrust" reads as a slap.
 */
function thrustPose(style: GoblinStyle, prop: GoblinProp, progress: number, impactAt: number): GoblinPose {
  const rest = restingPose(style);
  const carry = carryHand(style);
  const p = style.proportions;
  const armLength = p.upperArmLength + p.forearmLength;
  const shoulderY = -shoulderHeight(p);
  const WIND_END = THRUST_WIND_END;
  /**
   * The recovery gets the back 42% of the row — six frames.
   *
   * The plan's 0.68 left only four, and a `easeInOut` over four frames has a
   * middle step nearly four times its end steps: the blade snapped back to guard
   * instead of retracting. Six frames keeps the steepest step inside 1.9× its
   * neighbours, which is what gate G8 measures.
   */
  const SETTLE_END = 0.58;
  const LEVELLED_ANGLE = deg(-3);
  const LUNGE = 0.5;
  const OVERSHOOT = 1.06;
  const PULL_BACK = 0.85;

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
    nearFoot: steppingFoot(rest.nearFoot.x, LUNGE, WIND_END, impactAt, progress, STEP_LIFT * 0.8),
    // The rear foot must leave the ground to brace back, or it is dragging
    // rather than stepping — which is exactly what gate G7 measures.
    farFoot: steppingFoot(rest.farFoot.x, -0.1, 0, WIND_END, progress, STEP_LIFT * 0.35),
    nearHand,
    // Off hand thrown back and out for balance.
    farHand: {
      x: rest.farHand.x - 0.14 * drive * (1 - recover),
      y: rest.farHand.y - armLength * 0.3 * drive * (1 - recover),
    },
    weaponAngle: lerp(carryAngle(style, prop, nearHand.y), LEVELLED_ANGLE, Math.max(wind, drive)),
    headTilt: (deg(-6) * wind + deg(9) * drive) * (1 - recover),
    headLead: 0.05 * drive * (1 - recover),
    earLag: (deg(12) * wind - deg(20) * drive) * (1 - recover),
    mouthOpen: Math.max(wind * 0.3, drive),
    eyeOpen: 1,
  };
}

const SWING_SPECS: Record<GoblinArchetype, { light: SwingSpec | null; heavy: SwingSpec }> = {
  sword: {
    // The light attack is the stab, which `thrustPose` handles instead.
    light: null,
    heavy: {
      // Diagonal slash: blade swept up over the far shoulder, cut through ~150°.
      windEnd: 0.3,
      impactAt: 0,
      followEnd: 0.72,
      windHand: pt(-0.16, -1.02),
      impactHand: pt(0.44, -0.62),
      followHand: pt(0.46, -0.1),
      windAngle: deg(-152),
      impactAngle: deg(6),
      followAngle: deg(64),
      windLean: deg(-16),
      impactLean: deg(20),
      followLean: deg(26),
      windSway: -0.07,
      impactSway: 0.09,
      step: 0.26,
      stepFrom: 0.3,
      stepTo: 0.5,
      rearBrace: -0.16,
      behindFrom: 0,
      behindTo: 0.24,
      windSquash: 1.04,
      impactSquash: 0.95,
      freeHandWind: pt(-0.26, -0.72),
      freeHandImpact: pt(-0.34, -0.5),
    },
  },
  axe: {
    heavy: {
      // Overhead chop: haft past vertical, driven down hips-first, head buried
      // at knee height, then levered back out.
      windEnd: 0.34,
      impactAt: 0,
      followEnd: 0.66,
      windHand: pt(-0.16, -1.12),
      impactHand: pt(0.5, -0.46),
      followHand: pt(0.3, -0.2),
      windAngle: deg(-104),
      impactAngle: deg(58),
      followAngle: deg(88),
      windLean: deg(-20),
      impactLean: deg(34),
      followLean: deg(42),
      windSway: -0.06,
      impactSway: 0.08,
      step: 0.28,
      stepFrom: 0.34,
      stepTo: 0.52,
      rearBrace: -0.18,
      behindFrom: 0,
      behindTo: 0.3,
      windSquash: 1.06,
      impactSquash: 0.92,
      freeHandWind: pt(-0.2, -0.9),
      freeHandImpact: pt(0.24, -0.42),
    },
    light: {
      // Hooking cleave: waist-height sweep from the far side that over-rotates
      // the shoulder, so the recovery is a stagger.
      windEnd: 0.3,
      impactAt: 0,
      followEnd: 0.7,
      windHand: pt(-0.3, -0.62),
      impactHand: pt(0.46, -0.52),
      followHand: pt(0.54, -0.3),
      windAngle: deg(-168),
      impactAngle: deg(-12),
      followAngle: deg(72),
      windLean: deg(-13),
      impactLean: deg(16),
      followLean: deg(30),
      windSway: -0.06,
      impactSway: 0.07,
      step: 0.14,
      stepFrom: 0.52,
      stepTo: 0.74,
      rearBrace: -0.06,
      behindFrom: 0,
      behindTo: 0.22,
      windSquash: 1.03,
      impactSquash: 0.97,
      freeHandWind: pt(-0.24, -0.56),
      freeHandImpact: pt(0.18, -0.46),
    },
  },
  mace: {
    light: {
      // Full 360° orbit around the body; the head passes behind the goblin for
      // the back half of the arc or it paints over its own face.
      windEnd: 0.26,
      impactAt: 0,
      followEnd: 0.74,
      windHand: pt(-0.18, -0.78),
      impactHand: pt(0.4, -0.56),
      followHand: pt(0.08, -0.28),
      windAngle: deg(-190),
      impactAngle: deg(20),
      followAngle: deg(150),
      windLean: deg(-10),
      impactLean: deg(15),
      followLean: deg(-6),
      windSway: -0.05,
      impactSway: 0.07,
      step: 0.1,
      stepFrom: 0.6,
      stepTo: 0.8,
      rearBrace: -0.05,
      behindFrom: 0,
      behindTo: 0.34,
      windSquash: 1.02,
      impactSquash: 0.98,
      freeHandWind: pt(-0.22, -0.6),
      freeHandImpact: pt(-0.3, -0.52),
    },
    heavy: {
      // Straight up on a stiff arm with a small hop, then down a short fast arc
      // that buckles the knees on landing.
      windEnd: 0.36,
      impactAt: 0,
      followEnd: 0.62,
      windHand: pt(0.14, -1.16),
      impactHand: pt(0.4, -0.4),
      followHand: pt(0.28, -0.14),
      windAngle: deg(-88),
      impactAngle: deg(74),
      followAngle: deg(96),
      windLean: deg(-14),
      impactLean: deg(28),
      followLean: deg(22),
      windSway: -0.03,
      impactSway: 0.05,
      step: 0.22,
      stepFrom: 0.36,
      stepTo: 0.52,
      rearBrace: -0.16,
      behindFrom: 0,
      behindTo: 0.2,
      windSquash: 1.05,
      impactSquash: 0.88,
      freeHandWind: pt(-0.2, -0.72),
      freeHandImpact: pt(-0.24, -0.4),
    },
  },
  warhammer: {
    light: {
      // Two-handed horizontal sweep at chest height; the mass carries the goblin
      // round so it finishes with its back partly turned.
      windEnd: 0.32,
      impactAt: 0,
      followEnd: 0.72,
      windHand: pt(-0.34, -0.78),
      impactHand: pt(0.4, -0.76),
      followHand: pt(0.56, -0.46),
      windAngle: deg(-186),
      impactAngle: deg(-6),
      followAngle: deg(84),
      windLean: deg(-14),
      impactLean: deg(14),
      followLean: deg(34),
      windSway: -0.08,
      impactSway: 0.1,
      step: 0.16,
      stepFrom: 0.56,
      stepTo: 0.8,
      rearBrace: -0.1,
      behindFrom: 0,
      behindTo: 0.26,
      windSquash: 1.03,
      impactSquash: 0.96,
      freeHandWind: pt(-0.3, -0.7),
      freeHandImpact: pt(0.1, -0.68),
    },
    heavy: {
      // The slowest, most telegraphed animation in the goblin set: the wind eats
      // the first 0.42 of the row so a player can actually react to it.
      windEnd: 0.42,
      impactAt: 0,
      followEnd: 0.72,
      windHand: pt(-0.22, -1.3),
      impactHand: pt(0.5, -0.62),
      followHand: pt(0.32, -0.16),
      windAngle: deg(-98),
      impactAngle: deg(66),
      followAngle: deg(92),
      windLean: deg(-26),
      impactLean: deg(30),
      followLean: deg(46),
      windSway: -0.1,
      impactSway: 0.12,
      step: 0.34,
      stepFrom: 0.42,
      stepTo: 0.6,
      rearBrace: -0.24,
      behindFrom: 0,
      behindTo: 0.36,
      windSquash: 1.08,
      impactSquash: 0.88,
      freeHandWind: pt(-0.26, -1.02),
      freeHandImpact: pt(0.26, -0.4),
    },
  },
};

/**
 * Frames over which an attack is *supposed* to accelerate: from the end of its
 * wind through to just past impact.
 *
 * Gates G4 and G8 skip this window. That is not a loophole — it is the whole
 * point of the animation. A strike that spaced its frames evenly through the
 * drive would have no anticipation and no impact, which is precisely the "linear
 * sweep, reads as a robot arm" failure this rework exists to fix. The smear
 * crescent is drawn over the same frames, so what the gates exempt is exactly
 * what the art covers.
 */
export function accelerationWindow(
  archetype: GoblinArchetype,
  kind: 'light' | 'heavy',
): { readonly from: number; readonly to: number } {
  const row = rowByName(kind === 'light' ? 'attack_light' : 'attack_heavy');
  const spec = SWING_SPECS[archetype][kind];
  const windEnd = spec === null ? THRUST_WIND_END : spec.windEnd;
  const FOLLOW_THROUGH_FRAMES = 2;
  return {
    from: Math.floor(windEnd * row.frameCount),
    to: IMPACT_FRAMES[archetype][kind] + FOLLOW_THROUGH_FRAMES,
  };
}

function attackPose(
  archetype: GoblinArchetype,
  style: GoblinStyle,
  prop: GoblinProp,
  kind: 'light' | 'heavy',
  progress: number,
): GoblinPose {
  const impactAt = impactProgress(archetype, kind);
  const spec = SWING_SPECS[archetype][kind];
  if (spec === null) return thrustPose(style, prop, progress, impactAt);
  return swingPose(style, prop, { ...spec, impactAt }, progress);
}

// ── Flinch ───────────────────────────────────────────────────────────────────

/**
 * Five frames, and disproportionately effective: without it a hit that does not
 * kill produces no reaction at all and the goblin reads as unhittable.
 */
function flinchPose(style: GoblinStyle, prop: GoblinProp, progress: number): GoblinPose {
  const rest = restingPose(style);
  const carry = carryHand(style);
  const snap = smoothHump(clamp01(progress / 0.5));
  const settle = easeInOut(clamp01((progress - 0.4) / 0.6));
  const recoil = snap * (1 - settle * 0.4);
  const armLength = style.proportions.upperArmLength + style.proportions.forearmLength;
  const nearHand: Pt = {
    x: carry.x - 0.11 * recoil,
    y: carry.y + armLength * 0.1 * recoil,
  };
  const weaponAngle = carryAngle(style, prop, nearHand.y) + deg(14) * recoil;

  return {
    ...rest,
    lean: deg(-26) * recoil,
    bob: 0.04 * recoil,
    sway: -0.09 * recoil,
    torsoSquash: 1 - 0.09 * recoil,
    nearFoot: rest.nearFoot,
    farFoot: steppingFoot(rest.farFoot.x, -0.08, 0, 0.5, progress, 0.02),
    nearHand,
    farHand: gripFarHand(prop, nearHand, weaponAngle, {
      x: rest.farHand.x - 0.05 * recoil,
      y: rest.farHand.y - 0.04 * recoil,
    }),
    weaponAngle,
    headTilt: deg(-34) * recoil,
    headLead: -0.09 * recoil,
    earLag: deg(38) * recoil,
    mouthOpen: recoil,
    eyeOpen: 1 - recoil * 0.75,
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
  ctx: Ctx,
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
function smearStrength(archetype: GoblinArchetype, row: RowSpec, frame: number): number {
  if (row.name !== 'attack_light' && row.name !== 'attack_heavy') return 0;
  const kind = row.name === 'attack_light' ? 'light' : 'heavy';
  // The sword's stab does not rotate, so a crescent would be a lie.
  if (archetype === 'sword' && kind === 'light') return 0;
  const distance = Math.abs(frame - IMPACT_FRAMES[archetype][kind]);
  const SMEAR_REACH = 2;
  if (distance > SMEAR_REACH) return 0;
  const FALLOFF = [1, 0.6, 0.3];
  return FALLOFF[distance];
}

// ── Frame production ─────────────────────────────────────────────────────────

/**
 * Where a frame's painter puts its origin.
 *
 * Animation frames are anchored to the ground the goblin stands on. Gore cells
 * are anchored to the **centre of the cell**, because that is the point
 * `drawSpriteRotatedCenter` spins them about: a piece drawn on the ground anchor
 * orbits that centre instead of tumbling in place.
 */
type FrameAnchor = 'ground' | 'cellCentre';

interface FrameJob {
  readonly row: RowSpec;
  readonly frame: number;
  readonly anchor: FrameAnchor;
  /**
   * Shift applied before painting, in tile units.
   *
   * Gore pieces are authored around their own construction origin, which is not
   * where their ink ends up: a severed limb with a wound at one end and a foot at
   * the other has its mass well off that point. The runtime spins a piece about
   * the **cell centre**, so an off-centre piece orbits instead of tumbling —
   * exactly the failure the wound engine's header says it avoids. Every gore job
   * is measured once, then re-painted with the offset that puts its ink centre on
   * the cell centre.
   */
  readonly recentre: Pt;
  readonly paint: (ctx: Ctx, originX: number, originY: number, unit: number) => void;
  /** Null on gore cells, which have no skeleton. */
  readonly pose: GoblinPose | null;
  /** Weapon tip in figure space, for the arc gates. Null on gore cells. */
  readonly tip: Pt | null;
}

const GORE_SEED = 90210;

const NO_RECENTRE: Pt = { x: 0, y: 0 };

/**
 * One construction path for an archetype's weapon, so the geometry the gates
 * assert against is the same object the frames were painted with rather than a
 * second one built from the same table.
 */
function weaponFor(archetype: GoblinArchetype): GoblinProp {
  const style = GOBLIN_STYLES[archetype];
  return WEAPON_FACTORIES[archetype](style.palette, seededNoise(GORE_SEED + archetype.length));
}

function buildJobs(
  archetype: GoblinArchetype,
  goreOffsets?: ReadonlyMap<number, Pt>,
): readonly FrameJob[] {
  const style = GOBLIN_STYLES[archetype];
  const prop = weaponFor(archetype);
  const pieces = gorePieces(style);
  // Everything below is authored at the rig's own size and shrunk here, so the
  // pose, the weapon and the gore all shrink by the same factor. Poses and tips
  // stay in authored units: the arc gates test ratios between them, and a ratio
  // does not care what size the figure is drawn at.
  const drawScale = ARCHETYPE_SCALE[archetype];
  const jobs: FrameJob[] = [];

  for (const row of ROWS) {
    for (let frame = 0; frame < row.frameCount; frame++) {
      if (row.kind === 'gore') {
        const piece = pieces[frame];
        if (piece === undefined) {
          throw new Error(
            `the gore row wants ${row.frameCount} pieces but goblinGore.ts paints ` +
              `${pieces.length} — a rename or a reorder has desynced them`,
          );
        }
        const recentre = goreOffsets?.get(frame) ?? { x: 0, y: 0 };
        jobs.push({
          row,
          frame,
          anchor: 'cellCentre',
          recentre,
          pose: null,
          tip: null,
          paint: (ctx, originX, originY, unit) => {
            ctx.save();
            ctx.translate(originX + recentre.x * unit, originY + recentre.y * unit);
            ctx.scale(unit * drawScale, unit * drawScale);
            piece.paint(ctx, style);
            ctx.restore();
          },
        });
        continue;
      }

      const pose = poseFor(archetype, style, prop, row, frame);
      const smear = smearStrength(archetype, row, frame);
      jobs.push({
        row,
        frame,
        anchor: 'ground',
        recentre: NO_RECENTRE,
        pose,
        tip:
          pose.weaponAngle === null
            ? null
            : along(pose.nearHand, pose.weaponAngle, prop.tipDistance),
        paint: (ctx, originX, originY, unit) => {
          const figureUnit = unit * drawScale;
          drawImpactSmear(ctx, originX, originY, figureUnit, style, pose, prop, smear);
          drawGoblin(ctx, originX, originY, figureUnit, style, pose, prop);
        },
      });
    }
  }
  return jobs;
}

function poseFor(
  archetype: GoblinArchetype,
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
      return flinchPose(style, prop, shotProgress(frame, row.frameCount));
    default:
      throw new Error(`no pose for row ${row.name}`);
  }
}

// ── Geometry measurement ─────────────────────────────────────────────────────

const MEASURE_CANVAS = 640;
const ALPHA_CHANNEL_OFFSET = 3;
const CHANNELS_PER_PIXEL = 4;
/** Alpha at or below this is treated as empty when measuring and when clipping. */
const INK_ALPHA_THRESHOLD = 24;

interface Extents {
  readonly left: number;
  readonly right: number;
  readonly up: number;
  readonly down: number;
  /**
   * Furthest any gore piece reaches from its own ink centre, in tile units. The
   * cell has to hold a circle of this radius or the piece clips at the corners
   * as it spins, and no amount of frame *area* fixes that on its own.
   */
  readonly goreRadius: number;
  /** Shift, in tile units, that puts each gore piece's ink on the cell centre. */
  readonly goreOffsets: ReadonlyMap<number, Pt>;
  /** Rows and frames whose painter produced no ink at all. */
  readonly blankFrames: readonly string[];
}

function roundUpTo(value: number, quantum: number): number {
  return Math.ceil(value / quantum) * quantum;
}

/**
 * Measure how far every frame's ink reaches from the ground origin.
 *
 * The frame size is derived from this rather than guessed, which makes gate G1
 * structurally impossible to fail and removes the "geometry is provisional until
 * the poses exist" hazard entirely — a war hammer hauled overhead is the tallest
 * thing on its sheet and nobody can predict its extent from the proportions.
 */
interface InkBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly found: boolean;
}

function inkBoxOf(pixels: SheetPixels, width: number, height: number): InkBox {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = pixels.data[(y * width + x) * CHANNELS_PER_PIXEL + ALPHA_CHANNEL_OFFSET];
      if (alpha <= INK_ALPHA_THRESHOLD) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { minX, minY, maxX, maxY, found: maxX >= 0 };
}

function measure(jobs: readonly FrameJob[]): Extents {
  const canvas = createCanvas(MEASURE_CANVAS, MEASURE_CANVAS);
  const ctx = canvas.getContext('2d');
  const originX = MEASURE_CANVAS / 2;
  const groundOriginY = MEASURE_CANVAS * 0.82;
  const centreOriginY = MEASURE_CANVAS / 2;
  let left = 0;
  let right = 0;
  let up = 0;
  let down = 0;
  let goreRadius = 0;
  const goreOffsets = new Map<number, Pt>();
  const blankFrames: string[] = [];

  for (const job of jobs) {
    ctx.clearRect(0, 0, MEASURE_CANVAS, MEASURE_CANVAS);
    const anchorY = job.anchor === 'ground' ? groundOriginY : centreOriginY;
    job.paint(ctx, originX, anchorY, TILE_SCALE);
    const pixels = ctx.getImageData(0, 0, MEASURE_CANVAS, MEASURE_CANVAS);
    const box = inkBoxOf(pixels, MEASURE_CANVAS, MEASURE_CANVAS);

    // A frame with no ink is the signature of a NaN pose — a divide-by-zero in a
    // beat boundary, say — and without this check a silently blank sheet passes
    // every pixel gate, because every delta between two empty frames is zero.
    if (!box.found) {
      blankFrames.push(`${job.row.name} frame ${job.frame}`);
      continue;
    }

    if (job.anchor === 'cellCentre') {
      const inkCentreX = (box.minX + box.maxX) / 2;
      const inkCentreY = (box.minY + box.maxY) / 2;
      goreOffsets.set(job.frame, {
        x: job.recentre.x + (originX - inkCentreX) / TILE_SCALE,
        y: job.recentre.y + (anchorY - inkCentreY) / TILE_SCALE,
      });
      const halfWidth = (box.maxX - box.minX) / 2;
      const halfHeight = (box.maxY - box.minY) / 2;
      goreRadius = Math.max(goreRadius, Math.hypot(halfWidth, halfHeight) / TILE_SCALE);
      continue;
    }

    left = Math.max(left, originX - box.minX);
    right = Math.max(right, box.maxX - originX);
    up = Math.max(up, anchorY - box.minY);
    down = Math.max(down, box.maxY - anchorY);
  }
  return { left, right, up, down, goreRadius, goreOffsets, blankFrames };
}

/**
 * The composed sheet's pixels.
 *
 * Declared structurally rather than as the DOM's `ImageData`, because
 * `node-canvas` returns a value without `colorSpace` and the gates only ever
 * read `data`, `width` and `height`.
 */
export interface SheetPixels {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

export interface SheetGeometry {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly groundY: number;
  readonly tileX: number;
  readonly tileY: number;
}

function geometryFor(extents: Extents): SheetGeometry {
  // Both axes have to clear the gore radius: the cell's *inscribed* circle is
  // what a spinning piece sweeps, so a frame that is wide enough and short can
  // still clip a tumbling head at the top and bottom.
  const goreSpan = (extents.goreRadius * TILE_SCALE + FRAME_PADDING) * 2;
  const halfWidth = Math.max(extents.left, extents.right) + FRAME_PADDING;
  const frameWidth = roundUpTo(Math.max(halfWidth * 2, goreSpan), FRAME_SIZE_QUANTUM);
  const groundY = Math.ceil(extents.up + FRAME_PADDING);
  const frameHeight = roundUpTo(
    Math.max(groundY + extents.down + FRAME_PADDING, goreSpan),
    FRAME_SIZE_QUANTUM,
  );
  return {
    frameWidth,
    frameHeight,
    groundY,
    tileX: frameWidth / 2 - TILE_SCALE / 2,
    tileY: groundY - TILE_SCALE,
  };
}

// ── Sheet assembly ───────────────────────────────────────────────────────────

/** Physical sheet row a state's frames start on, given the wrap width. */
function rowOffsets(): Map<string, number> {
  const offsets = new Map<string, number>();
  let physicalRow = 0;
  for (const row of ROWS) {
    offsets.set(row.name, physicalRow);
    physicalRow += Math.ceil(row.frameCount / COLS_PER_ROW);
  }
  return offsets;
}

export function physicalRowCount(): number {
  return ROWS.reduce((total, row) => total + Math.ceil(row.frameCount / COLS_PER_ROW), 0);
}

interface BakedSheet {
  readonly archetype: GoblinArchetype;
  readonly geometry: SheetGeometry;
  /** `node-canvas`'s ImageData, which lacks the DOM's `colorSpace` field. */
  readonly pixels: SheetPixels;
  readonly buffer: Buffer;
  readonly width: number;
  readonly height: number;
  /** Weapon tip per frame, indexed by frame; a hole means a pose with no weapon. */
  readonly tips: ReadonlyMap<string, ReadonlyArray<Pt | undefined>>;
  readonly poses: ReadonlyMap<string, ReadonlyArray<GoblinPose | undefined>>;
  /** Where the off hand is meant to grip, or null for a one-handed weapon. */
  readonly offGripDistance: number | null;
}

function bake(archetype: GoblinArchetype): BakedSheet {
  // Two passes: the first measures where each gore piece's ink actually lands,
  // the second re-paints it centred on that measurement.
  const measured = measure(buildJobs(archetype));
  const jobs = buildJobs(archetype, measured.goreOffsets);
  const extents = measure(jobs);
  if (extents.blankFrames.length > 0) {
    throw new Error(
      `G0 ${archetype}: ${extents.blankFrames.join(', ')} painted nothing — ` +
        `a blank frame is the signature of a NaN pose`,
    );
  }
  // The budget is what the animation already needs, not an arbitrary number.
  // Sizing the cell to whatever the pieces happened to want made gate G10
  // unfailable — the frame grew to fit, so nothing could ever fall outside it —
  // and quietly inflated all twelve rows of the sheet to suit one long limb.
  // Measured against the animation's own cell, an oversized piece is a failure.
  const animationOnly = geometryFor({ ...extents, goreRadius: 0 });
  const goreSpan = (extents.goreRadius * TILE_SCALE + FRAME_PADDING) * 2;
  const animationCell = Math.min(animationOnly.frameWidth, animationOnly.frameHeight);
  if (goreSpan > animationCell) {
    throw new Error(
      `G10 ${archetype}: a gore piece sweeps ${goreSpan.toFixed(0)}px, past the ` +
        `${animationCell}px the animation's own cell provides — it would inflate every frame ` +
        `on the sheet, and the pieces would clip at the corners as they spin`,
    );
  }
  const geometry = geometryFor(extents);
  const offsets = rowOffsets();

  const width = COLS_PER_ROW * geometry.frameWidth;
  const height = physicalRowCount() * geometry.frameHeight;
  const sheet = createCanvas(width, height);
  const sheetCtx = sheet.getContext('2d');

  const frame = createCanvas(geometry.frameWidth * SUPERSAMPLE, geometry.frameHeight * SUPERSAMPLE);
  const frameCtx = frame.getContext('2d');

  const tips = new Map<string, Array<Pt | undefined>>();
  const poses = new Map<string, Array<GoblinPose | undefined>>();

  for (const job of jobs) {
    const rowStart = offsets.get(job.row.name);
    if (rowStart === undefined) throw new Error(`no offset for ${job.row.name}`);
    const physicalRow = rowStart + Math.floor(job.frame / COLS_PER_ROW);
    const column = job.frame % COLS_PER_ROW;

    frameCtx.clearRect(0, 0, frame.width, frame.height);
    const anchorY =
      job.anchor === 'ground' ? geometry.groundY : geometry.frameHeight / 2;
    job.paint(
      frameCtx,
      (geometry.frameWidth / 2) * SUPERSAMPLE,
      anchorY * SUPERSAMPLE,
      TILE_SCALE * SUPERSAMPLE,
    );
    sheetCtx.drawImage(
      frame,
      0,
      0,
      frame.width,
      frame.height,
      column * geometry.frameWidth,
      physicalRow * geometry.frameHeight,
      geometry.frameWidth,
      geometry.frameHeight,
    );

    // Written at the frame's own index rather than appended, so the gates can
    // index these by frame. Appending only the non-null entries silently
    // shifts every later frame's index by the number of nulls before it.
    if (job.tip !== null) {
      const list = tips.get(job.row.name) ?? [];
      list[job.frame] = job.tip;
      tips.set(job.row.name, list);
    }
    if (job.pose !== null) {
      const list = poses.get(job.row.name) ?? [];
      list[job.frame] = job.pose;
      poses.set(job.row.name, list);
    }
  }

  return {
    archetype,
    geometry,
    pixels: sheetCtx.getImageData(0, 0, width, height),
    buffer: sheet.toBuffer('image/png', { compressionLevel: MAX_PNG_COMPRESSION }),
    width,
    height,
    tips,
    poses,
    offGripDistance: weaponFor(archetype).offGripDistance,
  };
}

export const SHEET_DIR = 'src/images/enemies';

export function sheetFileName(archetype: GoblinArchetype): string {
  return `goblin_${archetype}.png`;
}

export function sheetPath(archetype: GoblinArchetype): string {
  return `${SHEET_DIR}/${sheetFileName(archetype)}`;
}

/**
 * Where the per-frame weapon-tip dump goes.
 *
 * Beside the harness rather than beside the sheet: it is review data, and
 * `src/images/` is a shipped asset directory that the build scans.
 */
export const ARC_TRACE_DIR = 'scripts/goblin-arc-traces';

export function arcTracePath(archetype: GoblinArchetype): string {
  return `${ARC_TRACE_DIR}/goblin_${archetype}.json`;
}

export { GOBLIN_ARCHETYPES, GOBLIN_STYLES };
export type { GoblinArchetype };

// The gates and the write step live in `generate-goblin-sprites.gates.ts` so
// this module can be imported by the review harness without baking anything.
export { bake, buildJobs, rowOffsets, geometryFor, measure, INK_ALPHA_THRESHOLD };
export type { BakedSheet, FrameJob, Extents };
