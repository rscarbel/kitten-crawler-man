/**
 * Vordrick Boneharrow, the necromancer of the ruins — the painter only.
 *
 * A tall, stooped, gaunt figure in layered grave-cloth that trails on the
 * ground, so like Shady it has no gait to get wrong: everything it says, it
 * says with the stoop, the hood, the rat-skull mask, the hands and the bone
 * staff with the caged blue soul-lantern hanging from its crook.
 *
 * Three things carry the read at a 32 px tile, in this order:
 *
 * - **The lantern is the brightest point on the figure**, and the only
 *   saturated one. Everything else is near-black cloth, dull linen and ivory.
 * - **The mask pokes out of the hood.** A rat's skull is a long narrow snout
 *   with two long yellowed incisors at its tip; seen head-on and stooped, that
 *   is a pale wedge pointing down out of a black hood, which no other creature
 *   in the game has.
 * - **Height is heads, not a bigger head.** The hood is smaller than a ratkin's
 *   head while the figure stands twice as tall, so it reads as a tall man and
 *   not as a big one.
 *
 * The robes are near-black, so the silhouette needs a rim; that rim is the
 * lantern's own cold bounce light and is laid on by the figure module round the
 * finished alpha, not painted per form here — per form, it would light every
 * internal seam and the creature would read as a wireframe.
 *
 * Coordinates are tile units with the origin on the ground under the figure
 * and +Y down the screen, so heights are negative. The caller scales one tile
 * to one unit. Three views read the same pose: `front` (toward the camera),
 * `away`, and `side` (profile, always facing +X so the runtime can mirror it).
 * Poses are authored with the staff hand at +X as seen from behind, and the
 * front view reflects the whole drawing so the staff stays in the same hand
 * when he turns round.
 */

import { clamp01, deg, lerp, mix, rgba, type Pt } from './carlArt';
import { hollowSoulPalette } from '../soulPalette';

type Ctx = CanvasRenderingContext2D;

export type NecromancerView = 'front' | 'side' | 'away';

const TWO_PI = Math.PI * 2;

function pt(x: number, y: number): Pt {
  return { x, y };
}

function add(a: Pt, b: Pt): Pt {
  return pt(a.x + b.x, a.y + b.y);
}

function scaled(a: Pt, k: number): Pt {
  return pt(a.x * k, a.y * k);
}

function mixPt(a: Pt, b: Pt, t: number): Pt {
  return pt(lerp(a.x, b.x, t), lerp(a.y, b.y, t));
}

function rotate(p: Pt, angle: number): Pt {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return pt(p.x * cos - p.y * sin, p.x * sin + p.y * cos);
}

/**
 * The classic shader sine-hash constants: a large irrational-looking scale on
 * a sine makes neighbouring seeds land far apart in the fractional part.
 */
const HASH = { frequency: 127.1, phase: 311.7, scale: 43758.5453 } as const;

/** A stable pseudo-random value in [0, 1) for an integer seed — never `Math.random`. */
export function hash01(seed: number): number {
  const s = Math.sin(seed * HASH.frequency + HASH.phase) * HASH.scale;
  return s - Math.floor(s);
}

function rgbString(rgb: readonly [number, number, number], alpha: number): string {
  const [r, g, b] = rgb;
  return rgba(`rgb(${r}, ${g}, ${b})`, alpha);
}

// ── Palette ──────────────────────────────────────────────────────────────────

/**
 * Grave-cloth gone black. A violet cast rather than the Lich's blue-green, and
 * never a true black: a fold has to be able to go darker than the plane beside
 * it, and against the village's grass the mid value still has to separate from
 * the shadow under him.
 */
const ROBE_DEEP = '#0c0a10';
const ROBE_MID = '#1a1620';
const ROBE_LIGHT = '#2b2533';
/** The shoulder layers sit a step lighter than the robe under them, so the layering reads. */
const LAYER_MID = '#231e2b';
const LAYER_LIGHT = '#373042';
/**
 * The burial linen: wrappings, the under-layer at the front opening, the cord.
 * Dull and dim — it is there to break the black mass into garments, never to
 * compete with the lantern.
 */
const LINEN_DARK = '#3b352d';
const LINEN_MID = '#5e5648';
const LINEN_LIGHT = '#7a7060';
/** Old ivory. The staff and the mask share it, so they read as one material. */
const BONE_LIGHT = '#eee4c8';
const BONE_MID = '#d1c29c';
const BONE_SHADOW = '#9a8766';
const BONE_DEEP = '#6a5a42';
/** A rat's incisors are orange-yellow; on the mask that is the cue that it is a rat. */
const INCISOR = '#eab04a';
const INCISOR_SHADE = '#b67a2a';
/** Dead grey skin, cool enough that the hands never read as a living man's. */
const HAND_MID = '#8e8a93';
const HAND_SHADOW = '#5d5963';
const OUTLINE = '#050407';
const VOID = '#020203';
/** The lantern's iron hook and chain. */
const IRON = '#3a3d48';

const SOUL = hollowSoulPalette;

/** The rim colour the figure module lays round the silhouette. */
export const NECROMANCER_RIM = SOUL.mid;

// ── Proportions ──────────────────────────────────────────────────────────────

/**
 * Crown of the hood above the ground, standing in his usual stoop.
 *
 * Twice a ratkin's standing height. The hood is smaller than a ratkin's head —
 * about six and a half heads tall against a ratkin's two and a half — because
 * a figure's size is read by counting heads, and a big head on a big body only
 * reads as a big child.
 */
export const NECROMANCER_CROWN_HEIGHT = 2.55;

const SHOULDER_Y = -1.98;
const CHEST_Y = -1.68;
const WAIST_Y = -1.2;
const KNEE_Y = -0.62;
const MANTLE_HEM_Y = -1.52;

const SHOULDER_HALF = 0.27;
const CHEST_HALF = 0.25;
const WAIST_HALF = 0.2;
const KNEE_HALF = 0.27;
/** The hem pools out on the ground; wide enough to read as trailing, not as a bell. */
const HEM_HALF = 0.4;
/** How far a pooled hem spreads toward the camera below the ground line, head-on. */
const HEM_POOL = 0.03;
const MANTLE_HALF = 0.28;

/** The head sits low between hunched shoulders, head-on. */
const HEAD_FRONT_Y = -2.29;
/** From behind the hood drops further: the hump of his back is what rises. */
const HEAD_AWAY_Y = -2.17;
const HOOD_RX = 0.155;
const HOOD_RY = 0.18;
const HOOD_PEAK = 0.045;
/** The hood's full height, crown to chin: the head a head count is measured in. */
export const NECROMANCER_HEAD_HEIGHT = HOOD_RY * 2 + HOOD_PEAK;

/** Profile: where the stoop puts the head, forward of and below the hump. */
const SIDE_HEAD = pt(0.25, -2.2);
const SIDE_HUMP = pt(-0.1, -2.12);
const SIDE_SHOULDER = pt(0.03, -1.95);

const UPPER_ARM = 0.47;
const FOREARM = 0.44;
const SHOULDER_JOINT_DROP = 0.07;
const ARM_ROOT_HALF = 0.2;

const SLEEVE_ROOT = 0.062;
const SLEEVE_ELBOW = 0.075;
/** Bell sleeves: the cuff flares wider than the elbow, and hangs ragged. */
const SLEEVE_CUFF = 0.115;
const HAND_LENGTH = 0.15;

export const STAFF_LENGTH = 2.72;
const STAFF_HALF_WIDTH = 0.026;
/** Where the knuckle-bulges sit along the shaft, as fractions from the foot. */
const STAFF_KNOBS: readonly number[] = [0.04, 0.36, 0.64, 0.97];
const STAFF_KNOB_RADIUS = 0.042;
/** The crook the cage hangs from, in the staff's own frame (along, outward). */
const CROOK_REACH = 0.13;
const CROOK_RISE = 0.07;
const CHAIN_LENGTH = 0.05;
/** The hook sits just below the crook's tip, so the chain hangs from inside the curl. */
const HOOK_DROP = 0.01;
const CAGE_RX = 0.085;
const CAGE_RY = 0.115;
const CAGE_BARS = 5;
const FLAME_RX = 0.045;
const FLAME_RY = 0.07;

/** The soft glow painted into the cell round the lantern; the big halo is the runtime's. */
export const LANTERN_GLOW_RADIUS = 0.3;
/** How bright the bursting cage flashes, against the lantern's resting 1. */
const BURST_FLASH = 2.2;
/** How much of the glow is gone when the body has frayed away entirely. */
const FRAY_GLOW_LOSS = 0.85;

const OUTLINE_WIDTH = 0.018;

// ── Pose ─────────────────────────────────────────────────────────────────────

/**
 * Every row is written as edits to {@link restingPose}. Hands are IK targets;
 * the staff is placed by where its hand grips it.
 */
export interface NecromancerPose {
  /** Whole-body vertical offset; negative lifts him. */
  bob: number;
  /** Shoulders and head slide along X; the robe hangs after them. */
  sway: number;
  /** Extra stoop, 0–1: the head and shoulders pitch forward and down. */
  stoop: number;
  /** Head roll in radians. */
  headTilt: number;
  /** −1…1: slides the mask across the hood's opening, head-on. */
  headTurn: number;
  /** 0–1 position of the travelling ripple along the hem. */
  hemPhase: number;
  /** How far the ripple lifts the hem, 0–1. */
  hemRipple: number;
  /** −1…1: the hem trailing the body's motion. */
  hemTrail: number;
  /** Where the staff hand grips the shaft. */
  staffHand: Pt;
  /** The staff's lean in radians from vertical; positive tips its top toward +X. */
  staffAngle: number;
  /** How far up the shaft the hand grips, from the foot, in tiles. */
  staffGrip: number;
  /** 0–1: the shaft shortened on screen because it points at the camera. */
  staffForeshorten: number;
  freeHand: Pt;
  /** 0 a curled claw, 1 splayed fingers. */
  freeHandSpread: number;
  /** Profile only: the free arm swung in front of the body rather than behind it. */
  freeArmInFront: boolean;
  /** The cage's pendulum swing on its crook, radians. */
  lanternSwing: number;
  /** 1 its resting burn, above 1 a flare, 0 out. */
  lanternGlow: number;
  /** The cage drawn larger, for a lantern thrust at the camera. */
  lanternScale: number;
  /** 0–1: the robes sinking into an empty heap. */
  collapse: number;
  /** 0–1: the mask falling from the hood to the ground. */
  maskDrop: number;
  /** 0–1: the cage bars flying apart. */
  cageBurst: number;
  /** 0–1: the snapped staff's pieces falling to the ground. */
  staffFall: number;
  /** 0–1: the ground cracks radiating from the planted staff foot. */
  cracks: number;
  /** 0–1: the body fraying into motes. */
  fray: number;
}

/** Where the relaxed staff hand grips, beside the body at hip height. */
const REST_STAFF_HAND = pt(0.4, -1.5);
const REST_STAFF_GRIP = 1.5;
const REST_FREE_HAND = pt(-0.04, -1.38);
/** A slight downward nod: head-on a level hood reads as staring, not brooding. */
const REST_HEAD_TILT = deg(-4);
const REST_HEM_RIPPLE = 0.4;
/** The staff leans a touch away from him, so it reads as held rather than planted beside him. */
const REST_STAFF_ANGLE = deg(3);
/** A loose, half-curled free hand. */
const REST_FREE_HAND_SPREAD = 0.2;

export function restingPose(): NecromancerPose {
  return {
    bob: 0,
    sway: 0,
    stoop: 0,
    headTilt: REST_HEAD_TILT,
    headTurn: 0,
    hemPhase: 0,
    hemRipple: REST_HEM_RIPPLE,
    hemTrail: 0,
    staffHand: REST_STAFF_HAND,
    staffAngle: REST_STAFF_ANGLE,
    staffGrip: REST_STAFF_GRIP,
    staffForeshorten: 0,
    freeHand: REST_FREE_HAND,
    freeHandSpread: REST_FREE_HAND_SPREAD,
    freeArmInFront: false,
    lanternSwing: 0,
    lanternGlow: 1,
    lanternScale: 1,
    collapse: 0,
    maskDrop: 0,
    cageBurst: 0,
    staffFall: 0,
    cracks: 0,
    fray: 0,
  };
}

/** The relaxed staff-hand position in profile, forward of the body. */
export const SIDE_STAFF_HAND = pt(0.6, -1.32);
export const SIDE_FREE_HAND = pt(0.16, -1.2);

// ── Rig ──────────────────────────────────────────────────────────────────────

/** How much of his height a full collapse takes away: a heap about knee-high. */
const COLLAPSE_SHRINK = 0.84;
/** How much wider the heap spreads than the standing robe. */
const COLLAPSE_SPREAD = 0.4;
/** How far a full stoop pitches the head forward and down, in tiles. */
const STOOP_DROP = 0.12;
const STOOP_FORWARD = 0.1;
/**
 * In profile the staff shoulder is the near one, a touch forward of the spine,
 * and the free shoulder the far one, back and a little higher.
 */
const SIDE_STAFF_SHOULDER_FORWARD = 0.02;
const SIDE_FREE_SHOULDER_BACK = 0.04;
const SIDE_FREE_SHOULDER_RISE = 0.01;
/** The head overshoots the shoulders' sway, so a sway reads as a lean and not a slide. */
const HEAD_SWAY_GAIN = 1.2;

interface Rig {
  /** Multiplies every height: 1 standing, near 0 collapsed. */
  readonly k: number;
  readonly spread: number;
  readonly lift: number;
  readonly shoulder: Pt;
  readonly head: Pt;
  readonly staffShoulder: Pt;
  readonly freeShoulder: Pt;
}

function rigOf(view: NecromancerView, pose: NecromancerPose): Rig {
  const k = 1 - pose.collapse * COLLAPSE_SHRINK;
  const spread = 1 + pose.collapse * COLLAPSE_SPREAD;
  const lift = pose.bob;
  if (view === 'side') {
    const shoulder = pt(SIDE_SHOULDER.x + pose.sway, SIDE_SHOULDER.y * k + lift);
    const head = pt(
      SIDE_HEAD.x + pose.sway + pose.stoop * STOOP_FORWARD,
      SIDE_HEAD.y * k + lift + pose.stoop * STOOP_DROP,
    );
    const staffShoulder = pt(
      shoulder.x + SIDE_STAFF_SHOULDER_FORWARD,
      shoulder.y + SHOULDER_JOINT_DROP,
    );
    const freeShoulder = pt(
      shoulder.x - SIDE_FREE_SHOULDER_BACK,
      shoulder.y + SHOULDER_JOINT_DROP - SIDE_FREE_SHOULDER_RISE,
    );
    return { k, spread, lift, shoulder, head, staffShoulder, freeShoulder };
  }
  const headY = view === 'front' ? HEAD_FRONT_Y : HEAD_AWAY_Y;
  const shoulder = pt(pose.sway, SHOULDER_Y * k + lift);
  const head = pt(pose.sway * HEAD_SWAY_GAIN, headY * k + lift + pose.stoop * STOOP_DROP);
  const staffShoulder = pt(shoulder.x + ARM_ROOT_HALF, shoulder.y + SHOULDER_JOINT_DROP);
  const freeShoulder = pt(shoulder.x - ARM_ROOT_HALF, shoulder.y + SHOULDER_JOINT_DROP);
  return { k, spread, lift, shoulder, head, staffShoulder, freeShoulder };
}

interface BoneChain {
  readonly root: Pt;
  readonly joint: Pt;
  readonly end: Pt;
}

/** Kept off full extension so the joint never snaps dead straight and loses its bend side. */
const IK_REACH_SLACK = 1e-3;
/** Keeps the law-of-cosines division away from zero when the target sits on the root. */
const IK_MIN_DISTANCE = 1e-4;

/** Two-bone IK: the end lands on `target`, the joint bows to `bendSign`'s side. */
function solveTwoBone(
  root: Pt,
  target: Pt,
  upper: number,
  lower: number,
  bendSign: number,
  foreshorten = 0,
): BoneChain {
  const dx = target.x - root.x;
  const dy = target.y - root.y;
  const rawDist = Math.hypot(dx, dy);
  const reach = upper + lower - IK_REACH_SLACK;
  const dist = Math.max(IK_MIN_DISTANCE, Math.min(rawDist, reach));
  const ux = rawDist > 0 ? dx / rawDist : 0;
  const uy = rawDist > 0 ? dy / rawDist : 1;
  const end = pt(root.x + ux * dist, root.y + uy * dist);
  const along = Math.max(
    -upper,
    Math.min(upper, (dist * dist + upper * upper - lower * lower) / (2 * dist)),
  );
  const off = Math.sqrt(Math.max(0, upper * upper - along * along)) * (1 - clamp01(foreshorten));
  const joint = pt(
    root.x + ux * along - uy * off * bendSign,
    root.y + uy * along + ux * off * bendSign,
  );
  return { root, joint, end };
}

// ── Staff and lantern geometry ───────────────────────────────────────────────

export interface StaffGeometry {
  readonly foot: Pt;
  readonly top: Pt;
  /** Unit vector from foot toward top, on screen. */
  readonly up: Pt;
  /** Unit vector toward the crook's side. */
  readonly out: Pt;
  readonly hook: Pt;
  readonly cage: Pt;
  readonly cageScale: number;
}

/**
 * The staff placed by the hand that grips it. Poses are authored with the staff
 * on the +X side in every view, so the crook always curls toward +X — away
 * from the body — and the front view's reflection carries it round with him.
 */
function staffGeometry(pose: NecromancerPose, rig: Rig): StaffGeometry {
  const hand = add(pose.staffHand, pt(0, rig.lift));
  const up = pt(Math.sin(pose.staffAngle), -Math.cos(pose.staffAngle));
  const shorten = 1 - clamp01(pose.staffForeshorten);
  // However high the hand grips, the foot never goes through the floor.
  const groundGrip = up.y < 0 ? -hand.y / (-up.y * shorten) : pose.staffGrip;
  const grip = Math.min(pose.staffGrip, groundGrip);
  const foot = add(hand, scaled(up, -grip * shorten));
  const top = add(foot, scaled(up, STAFF_LENGTH * shorten));
  const out = pt(-up.y, up.x);
  const hook = add(add(top, scaled(out, CROOK_REACH * pose.lanternScale)), scaled(up, -HOOK_DROP));
  const hang = rotate(pt(0, (CHAIN_LENGTH + CAGE_RY) * pose.lanternScale), pose.lanternSwing);
  const cage = add(hook, hang);
  return { foot, top, up, out, hook, cage, cageScale: pose.lanternScale };
}

/**
 * Where the lantern hangs in a pose, in tile units before any view reflection.
 * The figure module centres the rim light and the glow on it.
 */
export function lanternPoint(view: NecromancerView, pose: NecromancerPose): Pt {
  const rig = rigOf(view, pose);
  const staff = staffGeometry(pose, rig);
  return staff.cage;
}

// ── Paint helpers ────────────────────────────────────────────────────────────

function outlineAndFill(ctx: Ctx, fill: string): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.stroke();
}

function taperedPath(ctx: Ctx, from: Pt, to: Pt, halfFrom: number, halfTo: number): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  ctx.beginPath();
  ctx.moveTo(from.x + nx * halfFrom, from.y + ny * halfFrom);
  ctx.lineTo(to.x + nx * halfTo, to.y + ny * halfTo);
  ctx.lineTo(to.x - nx * halfTo, to.y - ny * halfTo);
  ctx.lineTo(from.x - nx * halfFrom, from.y - ny * halfFrom);
  ctx.closePath();
}

/** How many ripple wavelengths span one hem. */
const HEM_WAVES = 2;
/** The ripple's lift as a share of the tatter depth. */
const HEM_WAVE_AMPLITUDE = 0.6;
/** The shortest tatter as a share of the full depth; the hash adds up to the rest. */
const TATTER_MIN = 0.45;
const TATTER_VARIANCE = 0.55;
/** The notches between tatters are pinned higher up the cloth, so they ride the ripple less. */
const NOTCH_WAVE_SHARE = 0.4;

/**
 * The points of a ragged hem between two ends, tatters hanging below the line.
 * The tatter lengths are hashed per index so every frame agrees on which strip
 * is long; the ripple travels along them with `phase`.
 */
function raggedHem(
  from: Pt,
  to: Pt,
  count: number,
  depth: number,
  seed: number,
  phase: number,
  ripple: number,
): Pt[] {
  const points: Pt[] = [];
  for (let i = 0; i <= count * 2; i++) {
    const t = i / (count * 2);
    const base = mixPt(from, to, t);
    const wave = Math.sin((t * HEM_WAVES - phase) * TWO_PI) * ripple * depth * HEM_WAVE_AMPLITUDE;
    const isTip = i % 2 === 1;
    const tatter = isTip ? depth * (TATTER_MIN + hash01(seed + i) * TATTER_VARIANCE) : 0;
    points.push(pt(base.x, base.y + tatter + (isTip ? wave : wave * NOTCH_WAVE_SHARE)));
  }
  return points;
}

// ── Robe ─────────────────────────────────────────────────────────────────────

const HEM_TATTERS = 7;
const ROBE_NECK_HALF = 0.12;
const ROBE_NECK_RISE = 0.04;
/** The robe's shoulders fall away from the neck; square ones read as a wardrobe. */
const ROBE_SHOULDER_FALL = 0.14;
const HEM_TATTER_DEPTH = 0.07;
const HEM_TRAIL_TRAVEL = 0.07;
const ROBE_HEM_SEED = 11;
/**
 * The chest bows out past the line from shoulder to waist, so the column has
 * a ribcage in it rather than running straight down.
 */
const ROBE_CHEST_BULGE = 0.02;
/**
 * How much of the shoulders' sway the waist follows: the robe hangs from the
 * shoulders and lags them on the way down.
 */
const WAIST_SWAY_FOLLOW = 0.6;
/** The front opening hangs from a little higher on the chest, so it follows the sway more. */
const OPENING_SWAY_FOLLOW = 0.7;
/** The back seam is lowest on the robe and follows the sway least. */
const SEAM_SWAY_FOLLOW = 0.4;

/**
 * The broad dark band down the robe's shadow side: how far past the shoulder
 * it starts, and where it cuts in across chest, waist and hem as shares of
 * each half-width, ending below the hem so the clip does the edge.
 */
const ROBE_SHADOW_BAND = {
  shoulderOverhang: 0.05,
  chestInset: 0.35,
  waistInset: 0.4,
  hemInset: 0.55,
  belowHem: 0.1,
  hemOverhang: 0.1,
} as const;

/**
 * The shape shared by every facing fold: it starts just under the waist,
 * bows a little wider than its own line at the knee, and swings with the
 * trailing hem more than the hem's own edge does, stopping short of it.
 */
const FACING_FOLD_SHAPE = {
  waistDrop: 0.04,
  kneeFlare: 1.1,
  trailGain: 1.4,
  hemRise: 0.02,
} as const;

/**
 * The strip of burial linen showing down the front opening: narrow at the
 * chest, wider and off-centre toward the lit side at the hem, with a deep
 * edge line down its shadow side.
 */
const FRONT_OPENING = {
  chestDrop: 0.04,
  chestLeft: 0.03,
  chestRight: 0.035,
  hemRight: 0.09,
  hemLeft: 0.05,
  hemDrop: 0.05,
  edgeWidth: 0.022,
  edgeChestLeft: 0.035,
  edgeHemLeft: 0.055,
} as const;

/** From behind: the lit top plane of the hump and the seam down the back. */
const BACK_HUMP = {
  offsetX: 0.05,
  offsetY: 0.06,
  widthShare: 0.75,
  radiusY: 0.1,
} as const;
const BACK_SEAM = {
  width: 0.02,
  startDrop: 0.12,
  hemRise: 0.05,
} as const;

/** The robe head-on or from behind: one near-black column that pools on the ground. */
function drawRobeFacing(ctx: Ctx, view: NecromancerView, pose: NecromancerPose, rig: Rig): void {
  const k = rig.k;
  const w = rig.spread;
  const sx = rig.shoulder.x;
  const trail = pose.hemTrail * HEM_TRAIL_TRAVEL;
  const shoulderY = rig.shoulder.y;
  const chestY = CHEST_Y * k + rig.lift;
  const waistY = WAIST_Y * k + rig.lift;
  const kneeY = KNEE_Y * k;
  const hemY = view === 'front' ? HEM_POOL : 0;
  const hem = raggedHem(
    pt(-HEM_HALF * w + trail, hemY - HEM_TATTER_DEPTH),
    pt(HEM_HALF * w + trail, hemY - HEM_TATTER_DEPTH),
    HEM_TATTERS,
    HEM_TATTER_DEPTH,
    ROBE_HEM_SEED,
    pose.hemPhase,
    pose.hemRipple,
  );

  const trace = (): void => {
    ctx.beginPath();
    ctx.moveTo(sx - ROBE_NECK_HALF, shoulderY - ROBE_NECK_RISE);
    ctx.quadraticCurveTo(
      sx - SHOULDER_HALF * w,
      shoulderY,
      sx - SHOULDER_HALF * w,
      shoulderY + ROBE_SHOULDER_FALL,
    );
    ctx.quadraticCurveTo(
      sx - CHEST_HALF * w - ROBE_CHEST_BULGE,
      chestY,
      sx * WAIST_SWAY_FOLLOW - WAIST_HALF * w,
      waistY,
    );
    ctx.quadraticCurveTo(-KNEE_HALF * w, kneeY, hem[0].x, hem[0].y);
    for (const p of hem) ctx.lineTo(p.x, p.y);
    ctx.quadraticCurveTo(KNEE_HALF * w, kneeY, sx * WAIST_SWAY_FOLLOW + WAIST_HALF * w, waistY);
    ctx.quadraticCurveTo(
      sx + CHEST_HALF * w + ROBE_CHEST_BULGE,
      chestY,
      sx + SHOULDER_HALF * w,
      shoulderY + ROBE_SHOULDER_FALL,
    );
    ctx.quadraticCurveTo(
      sx + SHOULDER_HALF * w,
      shoulderY,
      sx + ROBE_NECK_HALF,
      shoulderY - ROBE_NECK_RISE,
    );
    ctx.closePath();
  };
  trace();
  outlineAndFill(ctx, ROBE_MID);

  ctx.save();
  trace();
  ctx.clip();
  // The shadow side is away from the lantern (−X); a broad dark band there and
  // two deep folds carry the cloth's weight down to the pooled hem.
  ctx.fillStyle = ROBE_DEEP;
  ctx.beginPath();
  ctx.moveTo(sx - SHOULDER_HALF * w - ROBE_SHADOW_BAND.shoulderOverhang, shoulderY);
  ctx.lineTo(sx - CHEST_HALF * ROBE_SHADOW_BAND.chestInset, chestY);
  ctx.lineTo(-WAIST_HALF * ROBE_SHADOW_BAND.waistInset, waistY);
  ctx.lineTo(-HEM_HALF * ROBE_SHADOW_BAND.hemInset * w + trail, hemY + ROBE_SHADOW_BAND.belowHem);
  ctx.lineTo(-HEM_HALF * w - ROBE_SHADOW_BAND.hemOverhang, hemY + ROBE_SHADOW_BAND.belowHem);
  ctx.closePath();
  ctx.fill();

  for (const [offset, colour, width] of FACING_FOLDS) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(
      sx * WAIST_SWAY_FOLLOW + WAIST_HALF * offset * w,
      waistY + FACING_FOLD_SHAPE.waistDrop,
    );
    ctx.quadraticCurveTo(
      KNEE_HALF * offset * FACING_FOLD_SHAPE.kneeFlare * w,
      kneeY,
      HEM_HALF * offset * w + trail * FACING_FOLD_SHAPE.trailGain,
      hemY - FACING_FOLD_SHAPE.hemRise,
    );
    ctx.stroke();
  }

  if (view === 'front') {
    // The robe hangs open down the front over the burial linen underneath.
    ctx.fillStyle = LINEN_DARK;
    ctx.beginPath();
    const openingX = sx * OPENING_SWAY_FOLLOW;
    const openingTopY = chestY + FRONT_OPENING.chestDrop;
    const openingHemY = hemY + FRONT_OPENING.hemDrop;
    ctx.moveTo(openingX - FRONT_OPENING.chestLeft, openingTopY);
    ctx.lineTo(openingX + FRONT_OPENING.chestRight, openingTopY);
    ctx.lineTo(FRONT_OPENING.hemRight * w + trail, openingHemY);
    ctx.lineTo(-FRONT_OPENING.hemLeft * w + trail, openingHemY);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = ROBE_DEEP;
    ctx.lineWidth = FRONT_OPENING.edgeWidth;
    ctx.beginPath();
    ctx.moveTo(openingX - FRONT_OPENING.edgeChestLeft, openingTopY);
    ctx.lineTo(-FRONT_OPENING.edgeHemLeft * w + trail, openingHemY);
    ctx.stroke();
  } else {
    // The hump's top plane, lit, and the seam down the back.
    ctx.fillStyle = ROBE_LIGHT;
    ctx.beginPath();
    ctx.ellipse(
      sx + BACK_HUMP.offsetX,
      shoulderY + BACK_HUMP.offsetY,
      SHOULDER_HALF * BACK_HUMP.widthShare * w,
      BACK_HUMP.radiusY * k,
      0,
      Math.PI,
      TWO_PI,
    );
    ctx.fill();
    ctx.strokeStyle = ROBE_DEEP;
    ctx.lineWidth = BACK_SEAM.width;
    ctx.beginPath();
    ctx.moveTo(sx, shoulderY + BACK_SEAM.startDrop);
    ctx.quadraticCurveTo(sx * SEAM_SWAY_FOLLOW, waistY, trail, hemY - BACK_SEAM.hemRise);
    ctx.stroke();
  }
  ctx.restore();

  drawCord(ctx, view, pose, rig);
}

/** Fold lines on the facing robe: offset across the width, colour, width. */
const FACING_FOLDS: readonly (readonly [number, string, number])[] = [
  [-0.35, ROBE_DEEP, 0.035],
  [0.45, ROBE_LIGHT, 0.028],
  [0.8, ROBE_DEEP, 0.022],
];

/** Below this much height the heap has swallowed the waist, and the cord with it. */
const CORD_GONE_BELOW = 0.55;
const CORD_WIDTH = 0.026;
/** The cord sags at the front between its ends, which sit a little above the waist line. */
const CORD_END_RISE = 0.01;
const CORD_SAG = 0.035;
/**
 * The hanging strip of burial wrap: where its knot sits along the cord, how it
 * swings with the hem, and the ragged outline of its two uneven tails.
 */
const CORD_STRIP = {
  knotAlong: 0.45,
  knotDrop: 0.02,
  trailSwing: 0.04,
  rippleSwing: 0.02,
  topHalf: 0.022,
  tailRightX: 0.02,
  tailRightY: 0.42,
  notchY: 0.38,
  tailLeftX: 0.024,
  tailLeftY: 0.44,
  knotRadiusX: 0.03,
  knotRadiusY: 0.022,
} as const;

/** The linen cord at the waist, with a strip of wrapping hanging from its knot. */
function drawCord(ctx: Ctx, view: NecromancerView, pose: NecromancerPose, rig: Rig): void {
  if (rig.k < CORD_GONE_BELOW) return;
  const waistY = WAIST_Y * rig.k + rig.lift;
  const cx = rig.shoulder.x * WAIST_SWAY_FOLLOW;
  const half = WAIST_HALF * rig.spread;
  ctx.strokeStyle = LINEN_MID;
  ctx.lineWidth = CORD_WIDTH;
  ctx.beginPath();
  ctx.moveTo(cx - half, waistY - CORD_END_RISE);
  ctx.quadraticCurveTo(cx, waistY + CORD_SAG, cx + half, waistY - CORD_END_RISE);
  ctx.stroke();
  if (view === 'away') return;
  const knot = pt(cx - half * CORD_STRIP.knotAlong, waistY + CORD_STRIP.knotDrop);
  const swing =
    pose.hemTrail * CORD_STRIP.trailSwing +
    Math.sin(pose.hemPhase * TWO_PI) * pose.hemRipple * CORD_STRIP.rippleSwing;
  ctx.fillStyle = LINEN_MID;
  ctx.beginPath();
  ctx.moveTo(knot.x - CORD_STRIP.topHalf, knot.y);
  ctx.lineTo(knot.x + CORD_STRIP.topHalf, knot.y);
  ctx.lineTo(knot.x + CORD_STRIP.tailRightX + swing, knot.y + CORD_STRIP.tailRightY);
  ctx.lineTo(knot.x + swing, knot.y + CORD_STRIP.notchY);
  ctx.lineTo(knot.x - CORD_STRIP.tailLeftX + swing, knot.y + CORD_STRIP.tailLeftY);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = LINEN_LIGHT;
  ctx.beginPath();
  ctx.ellipse(knot.x, knot.y, CORD_STRIP.knotRadiusX, CORD_STRIP.knotRadiusY, 0, 0, TWO_PI);
  ctx.fill();
}

const SIDE_ROBE_HEM_SEED = 23;
/** The hump rides the shoulders' sway, but less than the head does. */
const HUMP_SWAY_FOLLOW = 0.7;

/**
 * The profile robe's outline. The front falls nearly straight from the chest
 * to a toe just forward of him; the back bells out through the knee into a
 * train that pools well behind and trails furthest when he moves. The inner
 * Bézier controls sit forward and above each station so the front reads as
 * a stooped chest rather than a board.
 */
const SIDE_ROBE = {
  neckBack: 0.1,
  neckDrop: 0.1,
  chestFront: 0.16,
  chestSway: 0.6,
  waistFront: 0.11,
  waistSway: 0.4,
  toeFront: 0.26,
  toeTrail: 0.5,
  trainBack: 0.56,
  trainTrail: 1.6,
  /** The train's tatters are shorter than the front hem's: they drag rather than hang. */
  tatterShare: 0.6,
  chestControlX: 0.03,
  chestControlRise: 0.12,
  waistControlX: 0.02,
  waistControlRise: 0.2,
  kneeFront: 0.2,
  toeLift: 0.3,
  /** The train pools only half as far toward the camera as the facing hem. */
  poolShare: 0.5,
  kneeBack: 0.34,
  waistBack: 0.22,
  chestBack: 0.24,
  humpControlX: 0.12,
  humpControlRise: 0.06,
} as const;

/**
 * The dark back half of the profile robe: from behind the hump down to the
 * ground, with a far corner well outside the silhouette so the clip makes
 * the edge.
 */
const SIDE_ROBE_SHADOW = {
  humpBack: 0.2,
  controlX: -0.08,
  hemBack: 0.12,
  belowGround: 0.05,
  farX: -0.8,
  aboveHump: 0.2,
} as const;

const SIDE_HUMP_LIGHT = {
  offsetX: 0.02,
  offsetY: 0.05,
  radiusX: 0.13,
  radiusY: 0.08,
  tilt: deg(-20),
} as const;

/** A deep fold down the front of the profile robe, and a lit one just ahead of it. */
const SIDE_DEEP_FOLD = {
  width: 0.03,
  waistBack: 0.1,
  waistDrop: 0.05,
  kneeX: 0.02,
  hemFront: 0.06,
  hemY: -0.03,
} as const;
const SIDE_LIT_FOLD = {
  width: 0.022,
  waistBack: 0.02,
  waistDrop: 0.08,
  kneeFront: 0.14,
  hemFront: 0.18,
  trailShare: 0.6,
  hemY: -0.04,
} as const;
/** The profile cord runs from the back of the waist to just past its front. */
const SIDE_CORD = {
  back: 0.2,
  backRise: 0.02,
  frontOvershoot: 0.01,
  frontDrop: 0.01,
} as const;

/** The profile robe: stooped back, a train pooling behind him, the front falling straight. */
function drawRobeSide(ctx: Ctx, pose: NecromancerPose, rig: Rig): void {
  const k = rig.k;
  const w = rig.spread;
  const trail = pose.hemTrail * HEM_TRAIL_TRAVEL;
  const hump = pt(SIDE_HUMP.x + pose.sway * HUMP_SWAY_FOLLOW, SIDE_HUMP.y * k + rig.lift);
  const neck = pt(rig.head.x - SIDE_ROBE.neckBack, rig.head.y + SIDE_ROBE.neckDrop);
  const chest = pt(
    SIDE_ROBE.chestFront * w + pose.sway * SIDE_ROBE.chestSway,
    CHEST_Y * k + rig.lift,
  );
  const waist = pt(
    SIDE_ROBE.waistFront * w + pose.sway * SIDE_ROBE.waistSway,
    WAIST_Y * k + rig.lift,
  );
  const toe = pt(SIDE_ROBE.toeFront * w + trail * SIDE_ROBE.toeTrail, 0);
  const trainEnd = pt(-SIDE_ROBE.trainBack * w + trail * SIDE_ROBE.trainTrail, 0);
  const hem = raggedHem(
    toe,
    trainEnd,
    HEM_TATTERS,
    HEM_TATTER_DEPTH * SIDE_ROBE.tatterShare,
    SIDE_ROBE_HEM_SEED,
    pose.hemPhase,
    pose.hemRipple,
  );

  const trace = (): void => {
    ctx.beginPath();
    ctx.moveTo(neck.x, neck.y);
    ctx.quadraticCurveTo(
      chest.x + SIDE_ROBE.chestControlX,
      chest.y - SIDE_ROBE.chestControlRise,
      chest.x,
      chest.y,
    );
    ctx.quadraticCurveTo(
      waist.x + SIDE_ROBE.waistControlX,
      waist.y - SIDE_ROBE.waistControlRise,
      waist.x,
      waist.y,
    );
    ctx.quadraticCurveTo(
      SIDE_ROBE.kneeFront * w,
      KNEE_Y * k,
      toe.x,
      toe.y - HEM_TATTER_DEPTH * SIDE_ROBE.toeLift,
    );
    for (const p of hem) ctx.lineTo(p.x, Math.min(p.y, HEM_POOL * SIDE_ROBE.poolShare));
    ctx.quadraticCurveTo(
      -SIDE_ROBE.kneeBack * w + trail,
      KNEE_Y * k,
      -SIDE_ROBE.waistBack * w,
      WAIST_Y * k + rig.lift,
    );
    ctx.quadraticCurveTo(-SIDE_ROBE.chestBack * w, CHEST_Y * k + rig.lift, hump.x, hump.y);
    ctx.quadraticCurveTo(
      hump.x + SIDE_ROBE.humpControlX,
      hump.y - SIDE_ROBE.humpControlRise,
      neck.x,
      neck.y,
    );
    ctx.closePath();
  };
  trace();
  outlineAndFill(ctx, ROBE_MID);
  ctx.save();
  trace();
  ctx.clip();
  // The back is the side away from the lantern he carries forward.
  ctx.fillStyle = ROBE_DEEP;
  ctx.beginPath();
  ctx.moveTo(hump.x - SIDE_ROBE_SHADOW.humpBack, hump.y);
  ctx.quadraticCurveTo(
    SIDE_ROBE_SHADOW.controlX,
    WAIST_Y * k,
    -SIDE_ROBE_SHADOW.hemBack * w + trail,
    SIDE_ROBE_SHADOW.belowGround,
  );
  ctx.lineTo(SIDE_ROBE_SHADOW.farX, SIDE_ROBE_SHADOW.belowGround);
  ctx.lineTo(SIDE_ROBE_SHADOW.farX, hump.y - SIDE_ROBE_SHADOW.aboveHump);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = ROBE_LIGHT;
  ctx.beginPath();
  ctx.ellipse(
    hump.x + SIDE_HUMP_LIGHT.offsetX,
    hump.y + SIDE_HUMP_LIGHT.offsetY,
    SIDE_HUMP_LIGHT.radiusX,
    SIDE_HUMP_LIGHT.radiusY * k,
    SIDE_HUMP_LIGHT.tilt,
    Math.PI,
    TWO_PI,
  );
  ctx.fill();
  ctx.strokeStyle = ROBE_DEEP;
  ctx.lineWidth = SIDE_DEEP_FOLD.width;
  ctx.beginPath();
  ctx.moveTo(waist.x - SIDE_DEEP_FOLD.waistBack, waist.y + SIDE_DEEP_FOLD.waistDrop);
  ctx.quadraticCurveTo(
    SIDE_DEEP_FOLD.kneeX,
    KNEE_Y * k,
    SIDE_DEEP_FOLD.hemFront * w + trail,
    SIDE_DEEP_FOLD.hemY,
  );
  ctx.stroke();
  ctx.strokeStyle = ROBE_LIGHT;
  ctx.lineWidth = SIDE_LIT_FOLD.width;
  ctx.beginPath();
  ctx.moveTo(waist.x - SIDE_LIT_FOLD.waistBack, waist.y + SIDE_LIT_FOLD.waistDrop);
  ctx.quadraticCurveTo(
    SIDE_LIT_FOLD.kneeFront * w,
    KNEE_Y * k,
    SIDE_LIT_FOLD.hemFront * w + trail * SIDE_LIT_FOLD.trailShare,
    SIDE_LIT_FOLD.hemY,
  );
  ctx.stroke();
  ctx.restore();

  if (rig.k >= CORD_GONE_BELOW) {
    ctx.strokeStyle = LINEN_MID;
    ctx.lineWidth = CORD_WIDTH;
    ctx.beginPath();
    ctx.moveTo(-SIDE_CORD.back * w, waist.y - SIDE_CORD.backRise);
    ctx.lineTo(waist.x + SIDE_CORD.frontOvershoot, waist.y + SIDE_CORD.frontDrop);
    ctx.stroke();
  }
}

// ── Mantle ───────────────────────────────────────────────────────────────────

const MANTLE_TATTERS = 5;
const MANTLE_TATTER_DEPTH = 0.1;
const MANTLE_COLLAR = 0.1;
/** The capelet flares a little from the shoulder points to its hem. */
const MANTLE_FLARE = 1.1;
/** How far the mantle falls from the collar to the point of the shoulder. */
const MANTLE_SHOULDER_SLOPE = 0.24;

/**
 * The collar rides above the shoulder line; from behind it rises higher,
 * because there it wraps the back of the hood rather than the throat.
 */
const MANTLE_COLLAR_RISE_FRONT = 0.06;
const MANTLE_COLLAR_RISE_AWAY = 0.14;
/** The hem line the mantle's tatters hang from sits just above its nominal height. */
const MANTLE_HEM_RISE = 0.04;
const MANTLE_SEED_FRONT = 37;
const MANTLE_SEED_AWAY = 41;
const MANTLE_SEED_SIDE = 53;
/**
 * The mantle's ripple lags the robe hem's and moves half as far: it is shorter
 * cloth hanging from higher up.
 */
const MANTLE_RIPPLE_LAG = 0.3;
const MANTLE_RIPPLE_SHARE = 0.5;
/** Where the collar's curve is pulled out toward the shoulder, as a share of the half-width. */
const MANTLE_COLLAR_CONTROL = 0.75;
const MANTLE_COLLAR_CONTROL_DROP = 0.02;

/** The lit top of the mantle, toward the lantern side. */
const MANTLE_LIGHT = {
  offsetX: 0.1,
  offsetY: 0.05,
  widthShare: 0.7,
  radiusY: 0.07,
  tilt: deg(6),
} as const;
/** The mantle's shadow side: a wedge from the collar down past the hem. */
const MANTLE_SHADOW = {
  collarOverhang: 0.02,
  innerTopX: 0.15,
  innerTopDrop: 0.1,
  innerHemX: 0.2,
  belowHem: 0.12,
  hemOverhang: 0.05,
} as const;

/** Below this much height the chest has sunk too far for the wrapping band to show. */
const CHEST_BAND_GONE_BELOW = 0.6;
/**
 * The band of wrapping across the chest, drawn as a broad linen stroke with a
 * thin dark line along its lower edge.
 */
const CHEST_BAND = {
  width: 0.05,
  edgeWidth: 0.012,
  startX: 0.2,
  startRise: 0.02,
  edgeStartDrop: 0.005,
  endX: 0.2,
  endRise: 0.03,
} as const;

/** The tattered shoulder layer, head-on or from behind. */
function drawMantleFacing(ctx: Ctx, view: NecromancerView, pose: NecromancerPose, rig: Rig): void {
  const w = rig.spread;
  const sx = rig.shoulder.x;
  const topY =
    rig.shoulder.y - (view === 'away' ? MANTLE_COLLAR_RISE_AWAY : MANTLE_COLLAR_RISE_FRONT);
  const hemY = MANTLE_HEM_Y * rig.k + rig.lift;
  const hem = raggedHem(
    pt(sx - MANTLE_HALF * w * MANTLE_FLARE, hemY - MANTLE_HEM_RISE),
    pt(sx + MANTLE_HALF * w * MANTLE_FLARE, hemY - MANTLE_HEM_RISE),
    MANTLE_TATTERS,
    MANTLE_TATTER_DEPTH,
    view === 'away' ? MANTLE_SEED_AWAY : MANTLE_SEED_FRONT,
    pose.hemPhase + MANTLE_RIPPLE_LAG,
    pose.hemRipple * MANTLE_RIPPLE_SHARE,
  );
  // Sloped, not square: from the collar the cloth falls to the shoulder points,
  // which is most of what makes a tall figure read as gaunt and stooped rather
  // than as a wardrobe.
  const shoulderDrop = topY + MANTLE_SHOULDER_SLOPE;
  const trace = (): void => {
    ctx.beginPath();
    ctx.moveTo(sx - MANTLE_COLLAR, topY);
    ctx.quadraticCurveTo(
      sx - MANTLE_HALF * w * MANTLE_COLLAR_CONTROL,
      topY + MANTLE_COLLAR_CONTROL_DROP,
      sx - MANTLE_HALF * w,
      shoulderDrop,
    );
    ctx.lineTo(hem[0].x, hem[0].y);
    for (const p of hem) ctx.lineTo(p.x, p.y);
    ctx.lineTo(sx + MANTLE_HALF * w, shoulderDrop);
    ctx.quadraticCurveTo(
      sx + MANTLE_HALF * w * MANTLE_COLLAR_CONTROL,
      topY + MANTLE_COLLAR_CONTROL_DROP,
      sx + MANTLE_COLLAR,
      topY,
    );
    ctx.closePath();
  };
  trace();
  outlineAndFill(ctx, LAYER_MID);
  ctx.save();
  trace();
  ctx.clip();
  ctx.fillStyle = LAYER_LIGHT;
  ctx.beginPath();
  ctx.ellipse(
    sx + MANTLE_LIGHT.offsetX,
    topY + MANTLE_LIGHT.offsetY,
    MANTLE_HALF * MANTLE_LIGHT.widthShare * w,
    MANTLE_LIGHT.radiusY,
    MANTLE_LIGHT.tilt,
    Math.PI,
    TWO_PI,
  );
  ctx.fill();
  ctx.fillStyle = ROBE_DEEP;
  ctx.beginPath();
  ctx.moveTo(sx - MANTLE_HALF * w - MANTLE_SHADOW.collarOverhang, topY);
  ctx.lineTo(sx - MANTLE_SHADOW.innerTopX, topY + MANTLE_SHADOW.innerTopDrop);
  ctx.lineTo(sx - MANTLE_SHADOW.innerHemX, hemY + MANTLE_SHADOW.belowHem);
  ctx.lineTo(sx - MANTLE_HALF * w - MANTLE_SHADOW.hemOverhang, hemY + MANTLE_SHADOW.belowHem);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  if (view === 'front' && rig.k > CHEST_BAND_GONE_BELOW) {
    // A band of burial wrapping crosses the chest from the free shoulder to the
    // staff hip: the one mark that says grave-cloth rather than a monk's habit.
    ctx.strokeStyle = LINEN_MID;
    ctx.lineWidth = CHEST_BAND.width;
    ctx.beginPath();
    ctx.moveTo(sx - CHEST_BAND.startX, hemY - CHEST_BAND.startRise);
    ctx.lineTo(
      sx * WAIST_SWAY_FOLLOW + CHEST_BAND.endX,
      WAIST_Y * rig.k + rig.lift - CHEST_BAND.endRise,
    );
    ctx.stroke();
    ctx.strokeStyle = LINEN_DARK;
    ctx.lineWidth = CHEST_BAND.edgeWidth;
    ctx.beginPath();
    ctx.moveTo(sx - CHEST_BAND.startX, hemY + CHEST_BAND.edgeStartDrop);
    ctx.lineTo(sx * WAIST_SWAY_FOLLOW + CHEST_BAND.endX, WAIST_Y * rig.k + rig.lift);
    ctx.stroke();
  }
}

/**
 * The mantle in profile: from the neck it falls forward over the chest to a
 * front edge, and its ragged hem runs back and slightly up to the cape's tail
 * behind the hump, which trails with the hem.
 */
const SIDE_MANTLE = {
  neckBack: 0.08,
  neckDrop: 0.08,
  frontX: 0.2,
  frontSway: 0.5,
  frontRise: 0.02,
  tailX: 0.29,
  tailTrail: 0.03,
  tailRise: 0.06,
  chestControlX: 0.22,
  chestControlDrop: 0.12,
  backControlX: -0.3,
  backControlDrop: 0.1,
  humpBack: 0.02,
  humpRise: 0.03,
  humpControlX: 0.14,
  humpControlRise: 0.1,
} as const;
const SIDE_MANTLE_LIGHT = {
  offsetX: 0.06,
  offsetY: 0.02,
  radiusX: 0.16,
  radiusY: 0.07,
  tilt: deg(-18),
} as const;

/** The mantle in profile: a ragged cape over the hump. */
function drawMantleSide(ctx: Ctx, pose: NecromancerPose, rig: Rig): void {
  const hump = pt(SIDE_HUMP.x + pose.sway * HUMP_SWAY_FOLLOW, SIDE_HUMP.y * rig.k + rig.lift);
  const neck = pt(rig.head.x - SIDE_MANTLE.neckBack, rig.head.y + SIDE_MANTLE.neckDrop);
  const hemY = MANTLE_HEM_Y * rig.k + rig.lift;
  const hem = raggedHem(
    pt(
      SIDE_MANTLE.frontX * rig.spread + pose.sway * SIDE_MANTLE.frontSway,
      hemY - SIDE_MANTLE.frontRise,
    ),
    pt(
      -SIDE_MANTLE.tailX * rig.spread + pose.hemTrail * SIDE_MANTLE.tailTrail,
      hemY - SIDE_MANTLE.tailRise,
    ),
    MANTLE_TATTERS - 1,
    MANTLE_TATTER_DEPTH,
    MANTLE_SEED_SIDE,
    pose.hemPhase + MANTLE_RIPPLE_LAG,
    pose.hemRipple * MANTLE_RIPPLE_SHARE,
  );
  const trace = (): void => {
    ctx.beginPath();
    ctx.moveTo(neck.x, neck.y);
    ctx.quadraticCurveTo(
      SIDE_MANTLE.chestControlX,
      neck.y + SIDE_MANTLE.chestControlDrop,
      hem[0].x,
      hem[0].y,
    );
    for (const p of hem) ctx.lineTo(p.x, p.y);
    ctx.quadraticCurveTo(
      SIDE_MANTLE.backControlX,
      hump.y + SIDE_MANTLE.backControlDrop,
      hump.x - SIDE_MANTLE.humpBack,
      hump.y - SIDE_MANTLE.humpRise,
    );
    ctx.quadraticCurveTo(
      hump.x + SIDE_MANTLE.humpControlX,
      hump.y - SIDE_MANTLE.humpControlRise,
      neck.x,
      neck.y,
    );
    ctx.closePath();
  };
  trace();
  outlineAndFill(ctx, LAYER_MID);
  ctx.save();
  trace();
  ctx.clip();
  ctx.fillStyle = LAYER_LIGHT;
  ctx.beginPath();
  ctx.ellipse(
    hump.x + SIDE_MANTLE_LIGHT.offsetX,
    hump.y + SIDE_MANTLE_LIGHT.offsetY,
    SIDE_MANTLE_LIGHT.radiusX,
    SIDE_MANTLE_LIGHT.radiusY,
    SIDE_MANTLE_LIGHT.tilt,
    Math.PI,
    TWO_PI,
  );
  ctx.fill();
  ctx.restore();
}

// ── Hood and mask ────────────────────────────────────────────────────────────

/**
 * The hood shell as shares of its radii. The peak sits off-centre toward −X
 * and the +X side bulges lower, so the hood reads as cloth slumped over a
 * stooped head rather than a symmetric dome; the bottom sags below the radius
 * where it gathers at the throat.
 */
const HOOD_SHELL = {
  chinY: 0.9,
  backControlX: 1.08,
  backControlY: 0.7,
  peakX: 0.2,
  frontControlX: 0.5,
  /** The share of the peak the far slope still carries, so the crown is a point, not a ridge. */
  peakShare: 0.6,
  frontBrowY: 0.4,
  cheekControlX: 1.1,
  cheekControlY: 0.4,
  jawX: 0.95,
  jawY: 0.95,
  throatSag: 1.2,
} as const;

/** The hood's shell, around whatever sits in its opening. */
function traceHoodShell(ctx: Ctx, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.moveTo(-rx, ry * HOOD_SHELL.chinY);
  ctx.quadraticCurveTo(
    -rx * HOOD_SHELL.backControlX,
    -ry * HOOD_SHELL.backControlY,
    -rx * HOOD_SHELL.peakX,
    -ry - HOOD_PEAK,
  );
  ctx.quadraticCurveTo(
    rx * HOOD_SHELL.frontControlX,
    -ry - HOOD_PEAK * HOOD_SHELL.peakShare,
    rx,
    -ry * HOOD_SHELL.frontBrowY,
  );
  ctx.quadraticCurveTo(
    rx * HOOD_SHELL.cheekControlX,
    ry * HOOD_SHELL.cheekControlY,
    rx * HOOD_SHELL.jawX,
    ry * HOOD_SHELL.jawY,
  );
  ctx.quadraticCurveTo(0, ry * HOOD_SHELL.throatSag, -rx, ry * HOOD_SHELL.chinY);
  ctx.closePath();
}

/**
 * How the empty hood slumps as the robes collapse: it flattens fast — fully
 * by three quarters of the collapse — to a bit under half its height, and
 * spreads a little as it does.
 */
const HOOD_FLATTEN_RATE = 1.3;
const HOOD_FLATTEN = 0.6;
const HOOD_COLLAPSE_WIDEN = 0.3;

/** The lit crown of the hood, as shares of its radii. */
const HOOD_LIGHT_FRONT = { x: 0.5, y: 0.5, rx: 0.45, ry: 0.7 } as const;
const HOOD_LIGHT_AWAY = { x: 0.45, y: 0.55, rx: 0.5, ry: 0.6 } as const;
const HOOD_LIGHT_TILT = deg(15);

/**
 * The dark opening head-on, as shares of the hood's radii. It runs below the
 * shell's own chin so it meets the neck shadow.
 */
const HOOD_OPENING = {
  bottomX: 0.68,
  bottomY: 1.05,
  controlX: 0.72,
  controlY: 0.6,
  topY: 0.62,
} as const;

/** The seam down the back of the hood, from just behind the peak to the nape. */
const HOOD_SEAM = { width: 0.02, topX: 0.1, bottomX: 0.05 } as const;

/** How far a full head-turn slides the mask across the opening. */
const MASK_TURN_TRAVEL = 0.04;

function drawHoodFront(ctx: Ctx, pose: NecromancerPose, rig: Rig, parts: BodyParts): void {
  const flatten = 1 - clamp01(pose.collapse * HOOD_FLATTEN_RATE) * HOOD_FLATTEN;
  ctx.save();
  ctx.translate(rig.head.x, rig.head.y);
  ctx.rotate(pose.headTilt);
  ctx.scale(1 + pose.collapse * HOOD_COLLAPSE_WIDEN, flatten);
  traceHoodShell(ctx, HOOD_RX, HOOD_RY);
  outlineAndFill(ctx, LAYER_MID);
  ctx.save();
  traceHoodShell(ctx, HOOD_RX, HOOD_RY);
  ctx.clip();
  ctx.fillStyle = LAYER_LIGHT;
  ctx.beginPath();
  ctx.ellipse(
    HOOD_RX * HOOD_LIGHT_FRONT.x,
    -HOOD_RY * HOOD_LIGHT_FRONT.y,
    HOOD_RX * HOOD_LIGHT_FRONT.rx,
    HOOD_RY * HOOD_LIGHT_FRONT.ry,
    HOOD_LIGHT_TILT,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.restore();
  // The opening: open at the bottom, so the darkness runs down into the neck
  // shadow instead of reading as a face drawn on a disc.
  const openX = pose.headTurn * MASK_TURN_TRAVEL;
  ctx.fillStyle = VOID;
  ctx.beginPath();
  ctx.moveTo(openX - HOOD_RX * HOOD_OPENING.bottomX, HOOD_RY * HOOD_OPENING.bottomY);
  ctx.quadraticCurveTo(
    openX - HOOD_RX * HOOD_OPENING.controlX,
    -HOOD_RY * HOOD_OPENING.controlY,
    openX,
    -HOOD_RY * HOOD_OPENING.topY,
  );
  ctx.quadraticCurveTo(
    openX + HOOD_RX * HOOD_OPENING.controlX,
    -HOOD_RY * HOOD_OPENING.controlY,
    openX + HOOD_RX * HOOD_OPENING.bottomX,
    HOOD_RY * HOOD_OPENING.bottomY,
  );
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  if (parts === 'all' && pose.maskDrop <= 0)
    drawMaskFront(ctx, pt(rig.head.x + openX, rig.head.y), pose.headTilt, 1);
}

function drawHoodAway(ctx: Ctx, pose: NecromancerPose, rig: Rig): void {
  const flatten = 1 - clamp01(pose.collapse * HOOD_FLATTEN_RATE) * HOOD_FLATTEN;
  ctx.save();
  ctx.translate(rig.head.x, rig.head.y);
  ctx.rotate(pose.headTilt);
  ctx.scale(1 + pose.collapse * HOOD_COLLAPSE_WIDEN, flatten);
  traceHoodShell(ctx, HOOD_RX, HOOD_RY);
  outlineAndFill(ctx, LAYER_MID);
  ctx.save();
  traceHoodShell(ctx, HOOD_RX, HOOD_RY);
  ctx.clip();
  ctx.fillStyle = LAYER_LIGHT;
  ctx.beginPath();
  ctx.ellipse(
    HOOD_RX * HOOD_LIGHT_AWAY.x,
    -HOOD_RY * HOOD_LIGHT_AWAY.y,
    HOOD_RX * HOOD_LIGHT_AWAY.rx,
    HOOD_RY * HOOD_LIGHT_AWAY.ry,
    HOOD_LIGHT_TILT,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.strokeStyle = ROBE_DEEP;
  ctx.lineWidth = HOOD_SEAM.width;
  ctx.beginPath();
  ctx.moveTo(-HOOD_RX * HOOD_SEAM.topX, -HOOD_RY - HOOD_PEAK * HOOD_SHELL.peakShare);
  ctx.quadraticCurveTo(0, 0, HOOD_RX * HOOD_SEAM.bottomX, HOOD_RY);
  ctx.stroke();
  ctx.restore();
  ctx.restore();
}

/**
 * The rat skull head-on. A long pale skull in a hood reads as a bird's beak
 * or a plague doctor's mask; three things make it a rat instead: the face is a short
 * triangle — wide cheekbones tapering fast to a small blunt nose — rather than
 * a long wedge; the nose ends in a dark nose-hole instead of a point; and two
 * separate flat-ended orange incisors hang below it with a gap between them.
 */
function drawMaskFront(ctx: Ctx, at: Pt, tilt: number, glow: number): void {
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(tilt);
  const noseHoleY = FRONT_NOSE_Y - FRONT_NOSE_HOLE.rise;
  const muzzleY = FRONT_NOSE_Y - FRONT_SKULL.muzzleRise;
  const chinY = FRONT_NOSE_Y + FRONT_SKULL.noseDrop;
  drawIncisorPair(ctx, 0, noseHoleY);
  const skull = (): void => {
    ctx.beginPath();
    ctx.moveTo(0, FRONT_SKULL.crownY);
    ctx.quadraticCurveTo(
      FRONT_SKULL.crownControlX,
      FRONT_SKULL.crownY,
      FRONT_SKULL.browX,
      FRONT_SKULL.browY,
    );
    // The cheekbones flare out past the eyes: the widest point of a rat's
    // skull, where a bird's is widest at the crown.
    ctx.quadraticCurveTo(
      FRONT_SKULL.cheekControlX,
      FRONT_SKULL.cheekControlY,
      FRONT_SKULL.cheekX,
      FRONT_SKULL.cheekY,
    );
    ctx.quadraticCurveTo(
      FRONT_SKULL.jawControlX,
      FRONT_SKULL.jawControlY,
      FRONT_SKULL.muzzleX,
      muzzleY,
    );
    ctx.quadraticCurveTo(FRONT_SKULL.noseControlX, chinY, 0, chinY);
    ctx.quadraticCurveTo(-FRONT_SKULL.noseControlX, chinY, -FRONT_SKULL.muzzleX, muzzleY);
    ctx.quadraticCurveTo(
      -FRONT_SKULL.jawControlX,
      FRONT_SKULL.jawControlY,
      -FRONT_SKULL.cheekX,
      FRONT_SKULL.cheekY,
    );
    ctx.quadraticCurveTo(
      -FRONT_SKULL.cheekControlX,
      FRONT_SKULL.cheekControlY,
      -FRONT_SKULL.browX,
      FRONT_SKULL.browY,
    );
    ctx.quadraticCurveTo(-FRONT_SKULL.crownControlX, FRONT_SKULL.crownY, 0, FRONT_SKULL.crownY);
    ctx.closePath();
  };
  skull();
  outlineAndFill(ctx, BONE_MID);
  ctx.save();
  skull();
  ctx.clip();
  ctx.fillStyle = BONE_LIGHT;
  ctx.beginPath();
  ctx.ellipse(
    FRONT_SKULL_LIGHT.x,
    FRONT_SKULL_LIGHT.y,
    FRONT_SKULL_LIGHT.rx,
    FRONT_SKULL_LIGHT.ry,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.fillRect(FRONT_SNOUT_RIDGE.x, FRONT_SNOUT_RIDGE.y, FRONT_SNOUT_RIDGE.width, FRONT_NOSE_Y);
  ctx.fillStyle = BONE_SHADOW;
  ctx.beginPath();
  const shadowBottomY = FRONT_NOSE_Y + FRONT_SKULL_SHADOW.belowNose;
  ctx.moveTo(FRONT_SKULL_SHADOW.outerX, FRONT_SKULL_SHADOW.topY);
  ctx.lineTo(FRONT_SKULL_SHADOW.innerX, FRONT_SKULL_SHADOW.innerY);
  ctx.lineTo(FRONT_SKULL_SHADOW.bottomX, shadowBottomY);
  ctx.lineTo(FRONT_SKULL_SHADOW.outerX, shadowBottomY);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  for (const side of [-1, 1]) {
    ctx.fillStyle = VOID;
    ctx.beginPath();
    ctx.ellipse(
      side * FRONT_EYE_X,
      0,
      FRONT_SOCKET.rx,
      FRONT_SOCKET.ry,
      side * FRONT_SOCKET.slant,
      0,
      TWO_PI,
    );
    ctx.fill();
    ctx.fillStyle = rgbString(SOUL.mid, clamp01(glow) * EYE_GLOW_ALPHA);
    ctx.beginPath();
    ctx.arc(side * FRONT_EYE_X, FRONT_SOCKET.glowDrop, FRONT_SOCKET.glowRadius, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = rgbString(SOUL.core, clamp01(glow));
    ctx.beginPath();
    ctx.arc(side * FRONT_EYE_X, FRONT_SOCKET.glowDrop, FRONT_SOCKET.coreRadius, 0, TWO_PI);
    ctx.fill();
  }
  drawWhiskers(ctx, pt(0, muzzleY), 1, true);
  drawWhiskers(ctx, pt(0, muzzleY), -1, true);
  // The blunt nose: a dark nose-hole at the tip, where a beak would come to a point.
  ctx.fillStyle = VOID;
  ctx.beginPath();
  ctx.ellipse(0, noseHoleY, FRONT_NOSE_HOLE.rx, FRONT_NOSE_HOLE.ry, 0, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

/**
 * The head-on skull outline, +X half (the −X half mirrors it), in the mask's
 * own frame with the eyes on y = 0: a rounded crown, cheekbones flaring
 * widest just below the eyes, then a fast taper to a small blunt muzzle.
 */
const FRONT_SKULL = {
  crownY: -0.1,
  crownControlX: 0.07,
  browX: 0.075,
  browY: -0.05,
  cheekControlX: 0.125,
  cheekControlY: -0.03,
  cheekX: 0.118,
  cheekY: 0.02,
  jawControlX: 0.1,
  jawControlY: 0.07,
  muzzleX: 0.045,
  /** Where the muzzle's sides turn in to the nose, and where the whiskers root. */
  muzzleRise: 0.03,
  noseControlX: 0.04,
  noseDrop: 0.012,
} as const;
/** The lit brow, on the lantern side of the crown. */
const FRONT_SKULL_LIGHT = { x: 0.025, y: -0.06, rx: 0.05, ry: 0.035 } as const;
/** A lit strip down the bridge of the snout, just off the centre line. */
const FRONT_SNOUT_RIDGE = { x: 0.004, y: -0.03, width: 0.02 } as const;
/** The shadowed cheek and jaw on the side away from the lantern. */
const FRONT_SKULL_SHADOW = {
  outerX: -0.13,
  topY: -0.02,
  innerX: -0.03,
  innerY: 0.04,
  bottomX: -0.02,
  belowNose: 0.02,
} as const;
/**
 * The eye sockets slant down toward the centre line, and the soul-light sits
 * a touch low in each so it reads as looking down at whoever he faces.
 */
const FRONT_SOCKET = {
  rx: 0.026,
  ry: 0.024,
  slant: deg(-30),
  glowDrop: 0.002,
  glowRadius: 0.018,
  coreRadius: 0.01,
} as const;
/** How strongly the outer ring of each eye's soul-light burns against the core. */
const EYE_GLOW_ALPHA = 0.7;
/** The nose-hole sits just above the snout's end; the incisors hang from the same line. */
const FRONT_NOSE_HOLE = { rise: 0.012, rx: 0.022, ry: 0.014 } as const;

/** How far below the eyes the head-on snout ends. Short: a long one is a beak. */
const FRONT_NOSE_Y = 0.13;
/**
 * The eye sockets sit out at the edges of the skull, where a rat's do: set
 * close together and facing forward they make a bird's face, or a man's.
 */
const FRONT_EYE_X = 0.082;
const WHISKER_COUNT = 3;
const WHISKER_LENGTH = 0.13;
const WHISKER_WIDTH = 0.009;
const WHISKER = '#d8cdb2';
const WHISKER_FAN_STEP = deg(16);
/** Head-on the whiskers droop only a little; in profile they sweep further down the cheek. */
const WHISKER_DROOP_HEAD_ON = deg(8);
const WHISKER_DROOP_PROFILE = deg(14);
/** Whiskers root just off the snout's centre, each a step below the last. */
const WHISKER_ROOT_OFFSET = 0.02;
const WHISKER_ROOT_STEP = 0.01;
/** A whisker sags at its middle under its own weight. */
const WHISKER_SAG = 0.012;

/**
 * Stiff whiskers left on the mask's snout — the one thing on a skull no bird
 * has. `side` fans them to +X or −X; head-on they fan out and down both ways,
 * in profile they sweep back along the cheek.
 */
function drawWhiskers(ctx: Ctx, root: Pt, side: number, headOn: boolean): void {
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < WHISKER_COUNT; i++) {
    const fan = (i - (WHISKER_COUNT - 1) / 2) * WHISKER_FAN_STEP;
    const base = headOn ? WHISKER_DROOP_HEAD_ON : WHISKER_DROOP_PROFILE;
    const angle = side > 0 ? base + fan : Math.PI - base - fan;
    const start = pt(root.x + side * WHISKER_ROOT_OFFSET, root.y + i * WHISKER_ROOT_STEP);
    const end = add(start, rotate(pt(WHISKER_LENGTH, 0), angle));
    const bend = add(mixPt(start, end, 0.5), pt(0, WHISKER_SAG));
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = WHISKER_WIDTH * 2;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.quadraticCurveTo(bend.x, bend.y, end.x, end.y);
    ctx.stroke();
    ctx.strokeStyle = WHISKER;
    ctx.lineWidth = WHISKER_WIDTH;
    ctx.stroke();
  }
  ctx.restore();
}
const INCISOR_WIDTH = 0.03;
/** The dark gap between the two incisors, which is what makes them read as teeth. */
const INCISOR_GAP = 0.014;

/**
 * Two flat-ended incisors hanging from (x, rootY), side by side with a gap.
 * Drawn before the snout so its outline closes over their roots.
 */
function drawIncisorPair(ctx: Ctx, x: number, rootY: number): void {
  ctx.fillStyle = INCISOR;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = TOOTH_OUTLINE;
  for (const side of [-1, 1]) {
    const left = side > 0 ? x + INCISOR_GAP / 2 : x - INCISOR_GAP / 2 - INCISOR_WIDTH;
    ctx.beginPath();
    ctx.rect(left, rootY, INCISOR_WIDTH, INCISOR_LENGTH);
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = OUTLINE;
  ctx.fillRect(x - INCISOR_GAP / 2, rootY, INCISOR_GAP, INCISOR_LENGTH);
}

/** How far the incisors hang below the snout. */
const INCISOR_LENGTH = 0.1;
/**
 * How far the profile mask pitches nose-down. Kept shallow: pitched further, the
 * long snout reads as a hooked beak.
 */
const MASK_SIDE_PITCH = deg(-2);
/** Thinner than the figure's outline: at a tooth's width a full outline is all there is. */
const TOOTH_OUTLINE = OUTLINE_WIDTH * 0.5;

/**
 * The rat skull in profile. The snout is flat on top and ends in a blunt,
 * rounded nose that does not overhang anything — an overhanging tip is a hooked
 * beak — and from the very front of the upper jaw two flat-ended orange
 * incisors hang straight down, the far one a shade darker behind the near one.
 * The lower jaw is short and plain bone, set well back: anything orange under
 * the snout reads as a bird's lower bill.
 */
function drawMaskSide(ctx: Ctx, at: Pt, tilt: number, glow: number): void {
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(tilt + MASK_SIDE_PITCH);
  const jaw = (): void => {
    ctx.beginPath();
    ctx.moveTo(SIDE_JAW.hinge.x, SIDE_JAW.hinge.y);
    ctx.lineTo(SIDE_JAW.tip.x, SIDE_JAW.tip.y);
    ctx.quadraticCurveTo(
      SIDE_JAW.chinControl.x,
      SIDE_JAW.chinControl.y,
      SIDE_JAW.chin.x,
      SIDE_JAW.chin.y,
    );
    ctx.lineTo(SIDE_JAW.underside.x, SIDE_JAW.underside.y);
    ctx.quadraticCurveTo(
      SIDE_JAW.angleControl.x,
      SIDE_JAW.angleControl.y,
      SIDE_JAW.hinge.x,
      SIDE_JAW.hinge.y,
    );
    ctx.closePath();
  };
  jaw();
  outlineAndFill(ctx, BONE_SHADOW);
  // The far incisor first, a shade darker, just behind the near one.
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = TOOTH_OUTLINE;
  ctx.fillStyle = INCISOR_SHADE;
  ctx.beginPath();
  ctx.rect(
    SIDE_TOOTH_X - INCISOR_WIDTH * FAR_INCISOR_SHIFT,
    SIDE_TOOTH_ROOT_Y,
    INCISOR_WIDTH,
    INCISOR_LENGTH,
  );
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = INCISOR;
  ctx.beginPath();
  ctx.rect(SIDE_TOOTH_X, SIDE_TOOTH_ROOT_Y, INCISOR_WIDTH, INCISOR_LENGTH);
  ctx.fill();
  ctx.stroke();
  const skull = (): void => {
    ctx.beginPath();
    ctx.moveTo(SIDE_SKULL.nape.x, SIDE_SKULL.nape.y);
    ctx.quadraticCurveTo(
      SIDE_SKULL.backControl.x,
      SIDE_SKULL.backControl.y,
      SIDE_SKULL.crown.x,
      SIDE_SKULL.crown.y,
    );
    ctx.quadraticCurveTo(
      SIDE_SKULL.browControl.x,
      SIDE_SKULL.browControl.y,
      SIDE_SKULL.brow.x,
      SIDE_SKULL.brow.y,
    );
    ctx.lineTo(SIDE_NOSE_X - SIDE_NOSE_ROUND, SIDE_SNOUT_TOP_Y);
    // A square-ended muzzle that deepens toward the front, its face vertical:
    // a beak tapers and hooks, a rodent's snout ends in a blunt block.
    ctx.quadraticCurveTo(
      SIDE_NOSE_X,
      SIDE_SNOUT_TOP_Y,
      SIDE_NOSE_X,
      SIDE_SNOUT_TOP_Y + SIDE_NOSE_ROUND,
    );
    ctx.lineTo(SIDE_NOSE_X, SIDE_SNOUT_BOTTOM_Y - SIDE_NOSE_ROUND);
    ctx.quadraticCurveTo(
      SIDE_NOSE_X,
      SIDE_SNOUT_BOTTOM_Y,
      SIDE_NOSE_X - SIDE_NOSE_ROUND,
      SIDE_SNOUT_BOTTOM_Y,
    );
    ctx.lineTo(SIDE_SKULL.upperJaw.x, SIDE_SKULL.upperJaw.y);
    ctx.quadraticCurveTo(
      SIDE_SKULL.jawControl.x,
      SIDE_SKULL.jawControl.y,
      SIDE_SKULL.nape.x,
      SIDE_SKULL.nape.y,
    );
    ctx.closePath();
  };
  skull();
  outlineAndFill(ctx, BONE_MID);
  ctx.save();
  skull();
  ctx.clip();
  ctx.fillStyle = BONE_LIGHT;
  ctx.beginPath();
  ctx.ellipse(
    SIDE_SNOUT_LIGHT.x,
    SIDE_SNOUT_LIGHT.y,
    SIDE_SNOUT_LIGHT.rx,
    SIDE_SNOUT_LIGHT.ry,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.restore();
  drawWhiskers(ctx, pt(SIDE_NOSE_X - SIDE_WHISKER_ROOT.back, SIDE_WHISKER_ROOT.y), 1, false);
  // The cheekbone's arch under the eye, and the nose-hole at the blunt tip.
  ctx.strokeStyle = BONE_DEEP;
  ctx.lineWidth = SIDE_CHEEKBONE.width;
  ctx.beginPath();
  ctx.moveTo(SIDE_CHEEKBONE.back.x, SIDE_CHEEKBONE.back.y);
  ctx.quadraticCurveTo(
    SIDE_CHEEKBONE.control.x,
    SIDE_CHEEKBONE.control.y,
    SIDE_CHEEKBONE.front.x,
    SIDE_CHEEKBONE.front.y,
  );
  ctx.stroke();
  ctx.fillStyle = VOID;
  ctx.beginPath();
  ctx.ellipse(
    SIDE_NOSE_X - SIDE_NOSE_HOLE.back,
    SIDE_NOSE_HOLE.y,
    SIDE_NOSE_HOLE.rx,
    SIDE_NOSE_HOLE.ry,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(SIDE_SOCKET.x, SIDE_SOCKET.y, SIDE_SOCKET.rx, SIDE_SOCKET.ry, 0, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = rgbString(SOUL.mid, clamp01(glow) * EYE_GLOW_ALPHA);
  ctx.beginPath();
  ctx.arc(SIDE_EYE_GLOW.x, SIDE_EYE_GLOW.y, SIDE_EYE_GLOW.glowRadius, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = rgbString(SOUL.core, clamp01(glow));
  ctx.beginPath();
  ctx.arc(SIDE_EYE_GLOW.x, SIDE_EYE_GLOW.y, SIDE_EYE_GLOW.coreRadius, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

/** Where the profile snout's blunt nose ends, and where the teeth hang from just behind it. */
const SIDE_NOSE_X = 0.21;
const SIDE_NOSE_ROUND = 0.014;
/** The teeth root a little behind the nose's face, under the front of the upper jaw. */
const SIDE_TOOTH_BEHIND_NOSE = 0.04;
const SIDE_TOOTH_X = SIDE_NOSE_X - SIDE_TOOTH_BEHIND_NOSE;
const SIDE_TOOTH_ROOT_Y = 0.03;
/** The far incisor peeks out just behind the near one, by about half a tooth. */
const FAR_INCISOR_SHIFT = 0.55;
/** The flat top and bottom of the profile snout; it deepens toward the nose. */
const SIDE_SNOUT_TOP_Y = -0.042;
const SIDE_SNOUT_BOTTOM_Y = 0.04;

/**
 * The profile skull behind the snout, in the mask's frame with the eye near
 * the origin: a rounded cranium sloping down into the flat top of the snout,
 * and an upper jaw line running back to the nape.
 */
const SIDE_SKULL = {
  nape: pt(-0.085, 0.03),
  backControl: pt(-0.105, -0.075),
  crown: pt(0, -0.08),
  browControl: pt(0.06, -0.078),
  brow: pt(0.1, -0.05),
  upperJaw: pt(0.08, 0.05),
  jawControl: pt(-0.03, 0.06),
} as const;
/** The short plain-bone lower jaw, set well back under the snout. */
const SIDE_JAW = {
  hinge: pt(-0.05, 0.03),
  tip: pt(0.1, 0.05),
  chinControl: pt(0.12, 0.07),
  chin: pt(0.11, 0.085),
  underside: pt(0.06, 0.09),
  angleControl: pt(-0.02, 0.085),
} as const;
/** A long thin highlight along the flat top of the snout. */
const SIDE_SNOUT_LIGHT = { x: 0.06, y: -0.058, rx: 0.15, ry: 0.024 } as const;
const SIDE_WHISKER_ROOT = { back: 0.06, y: 0.005 } as const;
const SIDE_CHEEKBONE = {
  width: 0.013,
  back: pt(-0.04, 0.02),
  control: pt(0.03, 0.04),
  front: pt(0.1, 0.012),
} as const;
const SIDE_NOSE_HOLE = { back: 0.008, y: -0.01, rx: 0.012, ry: 0.014 } as const;
const SIDE_SOCKET = { x: 0.035, y: -0.025, rx: 0.036, ry: 0.027 } as const;
/** The soul-light sits toward the front of the socket, looking where he walks. */
const SIDE_EYE_GLOW = { x: 0.04, y: -0.023, glowRadius: 0.02, coreRadius: 0.011 } as const;

/** The profile hood pitches forward with the stoop, its opening facing down and ahead. */
const SIDE_HOOD_PITCH = deg(12);
/**
 * The profile hood shell: a rounded back of the skull, a crown just behind
 * centre, and a front edge that curls round and down under the chin.
 */
const SIDE_HOOD_SHELL = {
  chin: pt(0.1, 0.16),
  napeControl: pt(-0.2, 0.2),
  back: pt(-0.19, -0.02),
  crownControl: pt(-0.17, -0.2),
  crown: pt(0, -0.21),
  browControl: pt(0.15, -0.2),
  brow: pt(0.17, -0.06),
  faceControl: pt(0.2, 0.05),
} as const;
const SIDE_HOOD_LIGHT = { x: -0.03, y: -0.14, rx: 0.14, ry: 0.07, tilt: deg(-10) } as const;
const SIDE_HOOD_OPENING = { x: 0.13, y: 0.03, rx: 0.07, ry: 0.13, tilt: deg(-12) } as const;
/** Where the mask sits in the profile hood's opening, in the pitched head frame. */
const SIDE_MASK_OFFSET = pt(0.08, 0.04);

function drawHoodSide(ctx: Ctx, pose: NecromancerPose, rig: Rig, parts: BodyParts): void {
  const flatten = 1 - clamp01(pose.collapse * HOOD_FLATTEN_RATE) * HOOD_FLATTEN;
  ctx.save();
  ctx.translate(rig.head.x, rig.head.y);
  ctx.rotate(pose.headTilt + SIDE_HOOD_PITCH);
  ctx.scale(1 + pose.collapse * HOOD_COLLAPSE_WIDEN, flatten);
  const shell = (): void => {
    ctx.beginPath();
    const shape = SIDE_HOOD_SHELL;
    ctx.moveTo(shape.chin.x, shape.chin.y);
    ctx.quadraticCurveTo(shape.napeControl.x, shape.napeControl.y, shape.back.x, shape.back.y);
    ctx.quadraticCurveTo(shape.crownControl.x, shape.crownControl.y, shape.crown.x, shape.crown.y);
    ctx.quadraticCurveTo(shape.browControl.x, shape.browControl.y, shape.brow.x, shape.brow.y);
    ctx.quadraticCurveTo(shape.faceControl.x, shape.faceControl.y, shape.chin.x, shape.chin.y);
    ctx.closePath();
  };
  shell();
  outlineAndFill(ctx, LAYER_MID);
  ctx.save();
  shell();
  ctx.clip();
  ctx.fillStyle = LAYER_LIGHT;
  ctx.beginPath();
  ctx.ellipse(
    SIDE_HOOD_LIGHT.x,
    SIDE_HOOD_LIGHT.y,
    SIDE_HOOD_LIGHT.rx,
    SIDE_HOOD_LIGHT.ry,
    SIDE_HOOD_LIGHT.tilt,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.fillStyle = VOID;
  ctx.beginPath();
  ctx.ellipse(
    SIDE_HOOD_OPENING.x,
    SIDE_HOOD_OPENING.y,
    SIDE_HOOD_OPENING.rx,
    SIDE_HOOD_OPENING.ry,
    SIDE_HOOD_OPENING.tilt,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.restore();
  ctx.restore();
  if (parts === 'all' && pose.maskDrop <= 0) {
    const mouth = add(rig.head, rotate(SIDE_MASK_OFFSET, pose.headTilt + SIDE_HOOD_PITCH));
    drawMaskSide(ctx, mouth, pose.headTilt, 1);
  }
}

// ── Arms ─────────────────────────────────────────────────────────────────────

const CUFF_TATTERS = 3;
/** The upper cuff corner still droops, but only this share of the lower one's hang. */
const SLEEVE_HIGH_DROOP = 0.3;
/** How far the elbow's rounding pulls out toward the cuff, as a share of the elbow width. */
const SLEEVE_ELBOW_ROUND = 0.6;
/**
 * The dark inside of the bell: inset from each cuff corner across and up the
 * sleeve, reaching to a point further up the forearm, and following the
 * corners halfway down their droop.
 */
const SLEEVE_INSIDE = {
  across: 0.03,
  up: 0.02,
  depth: 0.07,
  droopShare: 0.5,
} as const;

/** A bell sleeve over an IK arm, the cuff hanging ragged, and a grey hand out of it. */
function drawSleeve(ctx: Ctx, arm: BoneChain, shade: number, seed: number): void {
  const sleeve = mix(LAYER_MID, ROBE_DEEP, shade);
  const fx = arm.end.x - arm.joint.x;
  const fy = arm.end.y - arm.joint.y;
  const flen = Math.hypot(fx, fy) || 1;
  const ux = fx / flen;
  const uy = fy / flen;
  const nx = -uy;
  const ny = ux;
  const bx = arm.joint.x - arm.root.x;
  const by = arm.joint.y - arm.root.y;
  const blen = Math.hypot(bx, by) || 1;
  const unx = -by / blen;
  const uny = bx / blen;
  // The cuff stops short of the wrist so the hand shows below it.
  const cuff = pt(arm.end.x - ux * CUFF_SHORT, arm.end.y - uy * CUFF_SHORT);
  const cuffA = pt(cuff.x + nx * SLEEVE_CUFF, cuff.y + ny * SLEEVE_CUFF);
  const cuffB = pt(cuff.x - nx * SLEEVE_CUFF, cuff.y - ny * SLEEVE_CUFF);
  // A bell sleeve's mouth droops: whichever cuff corner is lower hangs lower still.
  const lowA = cuffA.y >= cuffB.y;
  const droopA = lowA ? SLEEVE_DROOP : SLEEVE_DROOP * SLEEVE_HIGH_DROOP;
  const droopB = lowA ? SLEEVE_DROOP * SLEEVE_HIGH_DROOP : SLEEVE_DROOP;
  const mouth = raggedHem(
    pt(cuffA.x, cuffA.y + droopA),
    pt(cuffB.x, cuffB.y + droopB),
    CUFF_TATTERS,
    CUFF_TATTER_DEPTH,
    seed,
    0,
    0,
  );
  const trace = (): void => {
    ctx.beginPath();
    ctx.moveTo(arm.root.x + unx * SLEEVE_ROOT, arm.root.y + uny * SLEEVE_ROOT);
    ctx.lineTo(arm.joint.x + unx * SLEEVE_ELBOW, arm.joint.y + uny * SLEEVE_ELBOW);
    ctx.quadraticCurveTo(
      arm.joint.x + (unx + nx) * SLEEVE_ELBOW * SLEEVE_ELBOW_ROUND,
      arm.joint.y + (uny + ny) * SLEEVE_ELBOW * SLEEVE_ELBOW_ROUND,
      cuffA.x,
      cuffA.y,
    );
    for (const p of mouth) ctx.lineTo(p.x, p.y);
    ctx.lineTo(cuffB.x, cuffB.y);
    ctx.quadraticCurveTo(
      arm.joint.x - (unx + nx) * SLEEVE_ELBOW * SLEEVE_ELBOW_ROUND,
      arm.joint.y - (uny + ny) * SLEEVE_ELBOW * SLEEVE_ELBOW_ROUND,
      arm.joint.x - unx * SLEEVE_ELBOW,
      arm.joint.y - uny * SLEEVE_ELBOW,
    );
    ctx.lineTo(arm.root.x - unx * SLEEVE_ROOT, arm.root.y - uny * SLEEVE_ROOT);
    ctx.closePath();
  };
  trace();
  outlineAndFill(ctx, sleeve);
  // A round shoulder cap, so the sleeve does not start in a square cut.
  ctx.fillStyle = sleeve;
  ctx.beginPath();
  ctx.arc(arm.root.x, arm.root.y, SLEEVE_ROOT, 0, TWO_PI);
  ctx.fill();
  // The dark inside of the bell, where the forearm disappears into it.
  ctx.fillStyle = ROBE_DEEP;
  ctx.beginPath();
  const { across, up, depth, droopShare } = SLEEVE_INSIDE;
  ctx.moveTo(
    cuffA.x - nx * across - ux * up,
    cuffA.y - ny * across - uy * up + droopA * droopShare,
  );
  ctx.lineTo(cuff.x - ux * depth, cuff.y - uy * depth);
  ctx.lineTo(
    cuffB.x + nx * across - ux * up,
    cuffB.y + ny * across - uy * up + droopB * droopShare,
  );
  ctx.closePath();
  ctx.fill();
}

const CUFF_SHORT = 0.035;
const SLEEVE_DROOP = 0.06;
const CUFF_TATTER_DEPTH = 0.05;

function drawArmHand(
  ctx: Ctx,
  arm: BoneChain,
  spread: number,
  gripping: boolean,
  shade: number,
): void {
  const fx = arm.end.x - arm.joint.x;
  const fy = arm.end.y - arm.joint.y;
  const flen = Math.hypot(fx, fy) || 1;
  drawHand(ctx, arm.end, pt(fx / flen, fy / flen), spread, gripping, shade);
}

const FINGER_COUNT = 4;
const FINGER_MIDDLE = (FINGER_COUNT - 1) / 2;
/**
 * The hand in its own frame, +X down the forearm: a narrow palm centred a
 * little past the wrist, and fingers rooted past its middle in two joints,
 * the far one shorter. Fingers fan wider and straighten as the hand spreads;
 * a grip curls them hard round the shaft.
 */
const HAND = {
  palmCentre: 0.3,
  palmHalfLength: 0.34,
  palmHalfWidth: 0.035,
  knuckle: 0.55,
  fingerSpacing: 0.017,
  proximal: 0.4,
  distal: 0.34,
  fanClosed: 0.12,
  fanSplayed: 0.42,
  curlGrip: deg(80),
  curlClosed: deg(55),
  curlSplayed: deg(8),
  outlineWidth: 0.032,
  fingerWidth: 0.016,
} as const;

/**
 * A gaunt hand: a narrow palm and long fingers. Splayed, the fingers fan out
 * as separate strokes; curled or gripping, they close into a hook.
 */
function drawHand(
  ctx: Ctx,
  wrist: Pt,
  dir: Pt,
  spread: number,
  gripping: boolean,
  shade: number,
): void {
  const colour = mix(HAND_MID, HAND_SHADOW, shade);
  const angle = Math.atan2(dir.y, dir.x);
  ctx.save();
  ctx.translate(wrist.x, wrist.y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.ellipse(
    HAND_LENGTH * HAND.palmCentre,
    0,
    HAND_LENGTH * HAND.palmHalfLength,
    HAND.palmHalfWidth,
    0,
    0,
    TWO_PI,
  );
  outlineAndFill(ctx, colour);
  ctx.lineCap = 'round';
  const fingers = gripping ? 0 : spread;
  for (let i = 0; i < FINGER_COUNT; i++) {
    const fan = (i - FINGER_MIDDLE) * lerp(HAND.fanClosed, HAND.fanSplayed, fingers);
    const curl = gripping ? HAND.curlGrip : lerp(HAND.curlClosed, HAND.curlSplayed, fingers);
    const base = pt(HAND_LENGTH * HAND.knuckle, (i - FINGER_MIDDLE) * HAND.fingerSpacing);
    const mid = add(base, rotate(pt(HAND_LENGTH * HAND.proximal, 0), fan));
    const tip = add(mid, rotate(pt(HAND_LENGTH * HAND.distal, 0), fan + curl));
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = HAND.outlineWidth;
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(mid.x, mid.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    ctx.strokeStyle = colour;
    ctx.lineWidth = HAND.fingerWidth;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Head-on and from behind, most of a bent arm's fold is depth, which a flat
 * image cannot show: solved at full flare the elbows fly out sideways and he
 * stands akimbo. In profile the fold is in the picture plane and shows whole.
 */
const FACING_ARM_FORESHORTEN = 0.6;

function foreshortenOf(view: NecromancerView): number {
  return view === 'side' ? 0 : FACING_ARM_FORESHORTEN;
}

function freeArmOf(view: NecromancerView, pose: NecromancerPose, rig: Rig): BoneChain {
  const target = add(pose.freeHand, pt(0, rig.lift));
  // Head-on the free elbow bows outward (−X); in profile it bows back.
  const bend = view === 'side' ? -1 : 1;
  return solveTwoBone(rig.freeShoulder, target, UPPER_ARM, FOREARM, bend, foreshortenOf(view));
}

function staffArmOf(view: NecromancerView, pose: NecromancerPose, rig: Rig): BoneChain {
  const target = add(pose.staffHand, pt(0, rig.lift));
  // In profile the staff elbow drops below the line to the hand, the way an
  // arm holding a pole out in front hangs from the shoulder; head-on it bows
  // outward like the free one.
  const bend = view === 'side' ? 1 : -1;
  return solveTwoBone(rig.staffShoulder, target, UPPER_ARM, FOREARM, bend, foreshortenOf(view));
}

// ── Staff and lantern ────────────────────────────────────────────────────────

interface StaffPiece {
  readonly from: Pt;
  readonly to: Pt;
}

/** Where the shaft snaps when the cage bursts, as fractions from the foot. */
const SNAP_AT: readonly number[] = [0.38, 0.7];
/** Where each snapped piece comes to rest, relative to the ground under him. */
const FALLEN_PIECES: readonly (readonly [Pt, number])[] = [
  [pt(0.34, -0.03), deg(-6)],
  [pt(0.6, -0.025), deg(12)],
  [pt(0.2, 0.02), deg(-160)],
];

/** Each piece further up the shaft lands this much sooner, so they do not fall in lockstep. */
const FALL_STAGGER = 0.15;

function staffPieces(staff: StaffGeometry, fall: number): StaffPiece[] {
  const stops = [0, ...SNAP_AT, 1];
  const pieces: StaffPiece[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const from = mixPt(staff.foot, staff.top, stops[i]);
    const to = mixPt(staff.foot, staff.top, stops[i + 1]);
    if (fall <= 0) {
      pieces.push({ from, to });
      continue;
    }
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const centre = mixPt(from, to, 0.5);
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const [restCentre, restAngle] = FALLEN_PIECES[i];
    // Gravity: slow off the mark, fast at the end — never a linear slide.
    const drop = clamp01(fall * (1 + i * FALL_STAGGER));
    const eased = drop * drop;
    const c = mixPt(centre, restCentre, eased);
    const a = lerp(angle, restAngle, eased);
    const half = rotate(pt(length / 2, 0), a);
    pieces.push({ from: pt(c.x - half.x, c.y - half.y), to: pt(c.x + half.x, c.y + half.y) });
  }
  return pieces;
}

/** The shaft narrows slightly toward the crook, like the long bone it is. */
const STAFF_TAPER = 0.9;
/** A thin lit line down the shaft, just off its centre toward the crook side. */
const SHAFT_LIGHT_WIDTH = 0.012;
const SHAFT_LIGHT_OFFSET = 0.008;

function drawShaftPiece(ctx: Ctx, piece: StaffPiece): void {
  taperedPath(ctx, piece.from, piece.to, STAFF_HALF_WIDTH, STAFF_HALF_WIDTH * STAFF_TAPER);
  outlineAndFill(ctx, BONE_MID);
  const dx = piece.to.x - piece.from.x;
  const dy = piece.to.y - piece.from.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  ctx.strokeStyle = BONE_LIGHT;
  ctx.lineWidth = SHAFT_LIGHT_WIDTH;
  ctx.beginPath();
  ctx.moveTo(piece.from.x + nx * SHAFT_LIGHT_OFFSET, piece.from.y + ny * SHAFT_LIGHT_OFFSET);
  ctx.lineTo(piece.to.x + nx * SHAFT_LIGHT_OFFSET, piece.to.y + ny * SHAFT_LIGHT_OFFSET);
  ctx.stroke();
}

/** The knuckle-bulges are flattened along the shaft, like the ends of a long bone. */
const STAFF_KNOB_SQUASH = 0.7;
/** Each knob's highlight sits up and toward the crook side, a bit under half its size. */
const STAFF_KNOB_LIGHT_OFFSET = 0.012;
const STAFF_KNOB_LIGHT_SHARE = 0.4;

function drawStaff(
  ctx: Ctx,
  view: NecromancerView,
  pose: NecromancerPose,
  rig: Rig,
): StaffGeometry {
  const staff = staffGeometry(pose, rig);
  const pieces = staffPieces(staff, pose.staffFall);
  for (const piece of pieces) drawShaftPiece(ctx, piece);
  if (pose.staffFall <= 0) {
    for (const at of STAFF_KNOBS) {
      const c = mixPt(staff.foot, staff.top, at);
      ctx.beginPath();
      ctx.ellipse(
        c.x,
        c.y,
        STAFF_KNOB_RADIUS,
        STAFF_KNOB_RADIUS * STAFF_KNOB_SQUASH,
        Math.atan2(staff.up.y, staff.up.x),
        0,
        TWO_PI,
      );
      outlineAndFill(ctx, BONE_MID);
      ctx.fillStyle = BONE_LIGHT;
      ctx.beginPath();
      ctx.arc(
        c.x + staff.out.x * STAFF_KNOB_LIGHT_OFFSET,
        c.y - STAFF_KNOB_LIGHT_OFFSET,
        STAFF_KNOB_RADIUS * STAFF_KNOB_LIGHT_SHARE,
        0,
        TWO_PI,
      );
      ctx.fill();
    }
    drawCrook(ctx, staff);
  }
  if (pose.cageBurst < 1) drawCage(ctx, staff, pose);
  return staff;
}

/**
 * The crook curls up past the shaft's tip, overshooting its rise on the way,
 * then out and down to the hook; it peaks a little over halfway out.
 */
const CROOK_PEAK_REACH = 0.6;
const CROOK_OVERSHOOT = 1.4;
const CROOK_HOOK_CONTROL = 0.04;
/** The crook is bone over an iron core: an outline, then the bone, then a thin iron chain. */
const CROOK_OUTLINE_WIDTH = 0.045;
const CROOK_BONE_WIDTH = 0.025;
const CHAIN_WIDTH = 0.014;

/** The iron crook at the staff's head, and the chain the cage hangs by. */
function drawCrook(ctx: Ctx, staff: StaffGeometry): void {
  const s = staff.cageScale;
  const rise = add(
    add(staff.top, scaled(staff.up, CROOK_RISE * s)),
    scaled(staff.out, CROOK_REACH * CROOK_PEAK_REACH * s),
  );
  ctx.lineCap = 'round';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = CROOK_OUTLINE_WIDTH * s;
  const trace = (): void => {
    ctx.beginPath();
    ctx.moveTo(staff.top.x, staff.top.y);
    ctx.quadraticCurveTo(
      staff.top.x + staff.up.x * CROOK_RISE * CROOK_OVERSHOOT * s,
      staff.top.y + staff.up.y * CROOK_RISE * CROOK_OVERSHOOT * s,
      rise.x,
      rise.y,
    );
    ctx.quadraticCurveTo(
      staff.hook.x + staff.up.x * CROOK_HOOK_CONTROL,
      staff.hook.y + staff.up.y * CROOK_HOOK_CONTROL,
      staff.hook.x,
      staff.hook.y,
    );
  };
  trace();
  ctx.stroke();
  ctx.strokeStyle = BONE_MID;
  ctx.lineWidth = CROOK_BONE_WIDTH * s;
  trace();
  ctx.stroke();
  ctx.strokeStyle = IRON;
  ctx.lineWidth = CHAIN_WIDTH * s;
  const cageTop = add(staff.cage, rotate(pt(0, -CAGE_RY * s), angleOfHang(staff)));
  ctx.beginPath();
  ctx.moveTo(staff.hook.x, staff.hook.y);
  ctx.lineTo(cageTop.x, cageTop.y);
  ctx.stroke();
}

function angleOfHang(staff: StaffGeometry): number {
  return Math.atan2(staff.cage.y - staff.hook.y, staff.cage.x - staff.hook.x) - Math.PI / 2;
}

/**
 * How the cage flies apart as it bursts: each bar travels up to half a tile
 * out on its own side, at a hashed height within the vertical spread, spinning
 * by up to half the spin range either way.
 */
const CAGE_BURST = {
  travel: 0.5,
  spreadLow: -0.4,
  spreadRange: 0.8,
  spinSeed: 7,
  spin: 3,
} as const;
/** The rib bars bow out past the cage's own radius, so the cage reads round. */
const CAGE_BAR_BOW = 1.35;
const CAGE_BAR_OUTLINE_WIDTH = 0.03;
const CAGE_BAR_WIDTH = 0.016;
/**
 * The soul-flame: a dark halo a little larger than the flame, a teardrop
 * flame that reaches above the halo and never fully dims, and a small bright
 * core sitting low in it.
 */
const FLAME = {
  haloAlpha: 0.95,
  haloDrop: 0.01,
  haloRx: 1.25,
  haloRy: 1.1,
  bodyMinAlpha: 0.6,
  tipRise: 1.2,
  bodyBulge: 1.2,
  coreMinAlpha: 0.7,
  coreDrop: 0.25,
  coreShare: 0.5,
} as const;
/** The bone caps top and bottom that the rib bars are lashed to. */
const CAGE_CAP_RX = 0.035;
const CAGE_CAP_RY = 0.018;

/**
 * The cage of rib bones and the soul-flame inside it. The back bars go down
 * first and the front bars over the flame, so the light reads as caged rather
 * than as a ball stuck on a stick.
 */
function drawCage(ctx: Ctx, staff: StaffGeometry, pose: NecromancerPose): void {
  const s = staff.cageScale;
  const burst = clamp01(pose.cageBurst);
  ctx.save();
  ctx.translate(staff.cage.x, staff.cage.y);
  ctx.rotate(angleOfHang(staff));
  ctx.scale(s, s);
  const alpha = ctx.globalAlpha;
  ctx.globalAlpha = alpha * (1 - burst);

  const bar = (i: number, front: boolean): void => {
    const u = (i + 0.5) / CAGE_BARS;
    const x = Math.cos(u * Math.PI) * CAGE_RX;
    const fly = burst * CAGE_BURST.travel;
    const flyDir = rotate(
      pt(x >= 0 ? 1 : -1, CAGE_BURST.spreadLow + hash01(i) * CAGE_BURST.spreadRange),
      0,
    );
    ctx.save();
    ctx.translate(flyDir.x * fly, flyDir.y * fly);
    ctx.rotate(burst * (hash01(i + CAGE_BURST.spinSeed) - 0.5) * CAGE_BURST.spin);
    ctx.lineCap = 'round';
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = CAGE_BAR_OUTLINE_WIDTH;
    ctx.beginPath();
    ctx.moveTo(0, -CAGE_RY);
    ctx.quadraticCurveTo(x * CAGE_BAR_BOW, 0, 0, CAGE_RY);
    ctx.stroke();
    ctx.strokeStyle = front ? BONE_LIGHT : BONE_SHADOW;
    ctx.lineWidth = CAGE_BAR_WIDTH;
    ctx.stroke();
    ctx.restore();
  };
  for (let i = 0; i < CAGE_BARS; i++) if (i % 2 === 1) bar(i, false);

  const glow = clamp01(pose.lanternGlow);
  if (burst <= 0) {
    ctx.fillStyle = rgbString(SOUL.deep, FLAME.haloAlpha);
    ctx.beginPath();
    ctx.ellipse(0, FLAME.haloDrop, FLAME_RX * FLAME.haloRx, FLAME_RY * FLAME.haloRy, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = rgbString(SOUL.mid, lerp(FLAME.bodyMinAlpha, 1, glow));
    ctx.beginPath();
    ctx.moveTo(0, -FLAME_RY * FLAME.tipRise);
    ctx.quadraticCurveTo(FLAME_RX * FLAME.bodyBulge, 0, 0, FLAME_RY);
    ctx.quadraticCurveTo(-FLAME_RX * FLAME.bodyBulge, 0, 0, -FLAME_RY * FLAME.tipRise);
    ctx.fill();
    ctx.fillStyle = rgbString(SOUL.core, lerp(FLAME.coreMinAlpha, 1, glow));
    ctx.beginPath();
    ctx.ellipse(
      0,
      FLAME_RY * FLAME.coreDrop,
      FLAME_RX * FLAME.coreShare,
      FLAME_RY * FLAME.coreShare,
      0,
      0,
      TWO_PI,
    );
    ctx.fill();
  }

  for (let i = 0; i < CAGE_BARS; i++) if (i % 2 === 0) bar(i, true);
  for (const y of [-CAGE_RY, CAGE_RY]) {
    ctx.beginPath();
    ctx.ellipse(0, y, CAGE_CAP_RX, CAGE_CAP_RY, 0, 0, TWO_PI);
    outlineAndFill(ctx, BONE_MID);
  }
  ctx.globalAlpha = alpha;
  ctx.restore();
}

/**
 * The glow keeps most of its reach as the lantern dims and grows with a
 * flare: at a resting burn of 1 the two shares add to the full radius.
 */
const GLOW_RADIUS_FLOOR = 0.6;
const GLOW_RADIUS_GAIN = 0.4;
/** The glow's gradient: a bright core, the soul colour a quarter of the way out, then nothing. */
const GLOW_CORE_ALPHA = 0.55;
const GLOW_MID_STOP = 0.25;
const GLOW_MID_ALPHA = 0.4;

/**
 * The soft light round the lantern, painted additively after everything else.
 * Kept separate from the body so the rim-light mask can leave it out: dilating
 * a glow hands the creature a second bright ring at the glow's own radius.
 */
function glowRadiusFor(strength: number, scale: number): number {
  return (
    LANTERN_GLOW_RADIUS *
    scale *
    (GLOW_RADIUS_FLOOR + GLOW_RADIUS_GAIN * Math.min(strength, BURST_FLASH))
  );
}

/** How far the lantern's in-cell glow reaches in a pose, in tiles. */
export function lanternGlowRadius(pose: NecromancerPose): number {
  return glowRadiusFor(pose.lanternGlow, pose.lanternScale);
}

export function drawLanternGlow(ctx: Ctx, view: NecromancerView, pose: NecromancerPose): void {
  const rig = rigOf(view, pose);
  const staff = staffGeometry(pose, rig);
  const burstFlash = pose.cageBurst > 0 ? Math.sin(clamp01(pose.cageBurst) * Math.PI) : 0;
  const lit = pose.cageBurst > 0 ? burstFlash * BURST_FLASH : pose.lanternGlow;
  // A body frayed into motes takes its lantern with it.
  const strength = lit * (1 - clamp01(pose.fray) * FRAY_GLOW_LOSS);
  if (strength <= 0) return;
  const radius = glowRadiusFor(strength, staff.cageScale);
  const g = ctx.createRadialGradient(
    staff.cage.x,
    staff.cage.y,
    0,
    staff.cage.x,
    staff.cage.y,
    radius,
  );
  g.addColorStop(0, rgbString(SOUL.core, clamp01(GLOW_CORE_ALPHA * strength)));
  g.addColorStop(GLOW_MID_STOP, rgbString(SOUL.mid, clamp01(GLOW_MID_ALPHA * strength)));
  g.addColorStop(1, rgbString(SOUL.deep, 0));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(staff.cage.x, staff.cage.y, radius, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

// ── Ground ───────────────────────────────────────────────────────────────────

const CONTACT_SHADOW_HALF = 0.5;
/** The heap spreads its shadow as it collapses. */
const CONTACT_SHADOW_COLLAPSE_SPREAD = 0.3;
/** In profile the train pools behind him, so the shadow is longer and sits back. */
const CONTACT_SHADOW_SIDE_STRETCH = 1.15;
const CONTACT_SHADOW_SIDE_OFFSET = -0.12;
const CONTACT_SHADOW_ALPHA = 0.45;
/** The ground is seen at a slant, so the shadow is a flat ellipse. */
const CONTACT_SHADOW_SQUASH = 0.32;

export function drawContactShadow(ctx: Ctx, view: NecromancerView, pose: NecromancerPose): void {
  const half =
    CONTACT_SHADOW_HALF *
    (1 + pose.collapse * CONTACT_SHADOW_COLLAPSE_SPREAD) *
    (view === 'side' ? CONTACT_SHADOW_SIDE_STRETCH : 1);
  const offsetX = view === 'side' ? CONTACT_SHADOW_SIDE_OFFSET : 0;
  const g = ctx.createRadialGradient(offsetX, 0, 0, offsetX, 0, half);
  g.addColorStop(0, rgba('#000000', CONTACT_SHADOW_ALPHA * (1 - pose.fray)));
  g.addColorStop(1, rgba('#000000', 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(offsetX, 0, half, half * CONTACT_SHADOW_SQUASH, 0, 0, TWO_PI);
  ctx.fill();
}

const CRACK_COUNT = 6;
const CRACK_REACH = 0.8;
/**
 * Stroke widths of a crack's three passes. The glow is two pixels wide at a
 * 32 px tile: any thinner and the cracks vanish in play.
 */
const CRACK_SHADOW_WIDTH = 0.08;
const CRACK_GLOW_WIDTH = 0.045;
const CRACK_CORE_WIDTH = 0.016;
const CRACK_SHADOW_ALPHA = 0.9;
const CRACK_GLOW_ALPHA = 0.95;
const CRACK_CORE_ALPHA = 0.9;
/** However the staff is posed, the cracks start no further below the ground line than this. */
const CRACK_ORIGIN_MAX_Y = 0.02;
const CRACK_STEPS = 4;
/**
 * Hash offsets and ranges for the crack pattern: each crack's heading wobbles
 * off even spacing, its length runs from 60% to the full reach, and each step
 * jags up to a quarter-radian either way.
 */
const CRACK_HEADING_SEED = 90;
const CRACK_HEADING_WOBBLE = 0.6;
const CRACK_LENGTH_SEED = 40;
const CRACK_LENGTH_MIN = 0.6;
const CRACK_LENGTH_RANGE = 0.4;
const CRACK_JAG_SEED_STRIDE = 11;
const CRACK_JAG = 0.5;
/** The floor is seen at a slant, so a crack's depth is squashed. */
const CRACK_DEPTH_SQUASH = 0.4;

/**
 * Glowing cracks radiating from the planted staff foot, drawn on the floor
 * under the figure. Their length grows with `cracks`; each is a jagged
 * polyline hashed per index, so the pattern is the same every frame.
 */
export function drawGroundCracks(ctx: Ctx, view: NecromancerView, pose: NecromancerPose): void {
  if (pose.cracks <= 0) return;
  const rig = rigOf(view, pose);
  const staff = staffGeometry(pose, rig);
  const origin = pt(staff.foot.x, Math.min(staff.foot.y, CRACK_ORIGIN_MAX_Y));
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 0; i < CRACK_COUNT; i++) {
    const angle =
      (i / CRACK_COUNT) * TWO_PI + hash01(i + CRACK_HEADING_SEED) * CRACK_HEADING_WOBBLE;
    const reach =
      CRACK_REACH *
      (CRACK_LENGTH_MIN + hash01(i + CRACK_LENGTH_SEED) * CRACK_LENGTH_RANGE) *
      clamp01(pose.cracks);
    const points: Pt[] = [origin];
    const steps = CRACK_STEPS;
    for (let s = 1; s <= steps; s++) {
      const r = (reach * s) / steps;
      const jag = (hash01(i * CRACK_JAG_SEED_STRIDE + s) - 0.5) * CRACK_JAG;
      points.push(
        pt(
          origin.x + Math.cos(angle + jag) * r,
          origin.y + Math.sin(angle + jag) * r * CRACK_DEPTH_SQUASH,
        ),
      );
    }
    const trace = (): void => {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (const p of points) ctx.lineTo(p.x, p.y);
    };
    ctx.strokeStyle = rgbString(SOUL.shadow, CRACK_SHADOW_ALPHA);
    ctx.lineWidth = CRACK_SHADOW_WIDTH;
    trace();
    ctx.stroke();
    ctx.strokeStyle = rgbString(SOUL.mid, CRACK_GLOW_ALPHA);
    ctx.lineWidth = CRACK_GLOW_WIDTH;
    trace();
    ctx.stroke();
    ctx.strokeStyle = rgbString(SOUL.core, CRACK_CORE_ALPHA);
    ctx.lineWidth = CRACK_CORE_WIDTH;
    trace();
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * What a body pass paints: everything, or the cloth alone. The cloth pass is
 * the mask the rim light is built from — the lantern lights the robe's edge,
 * and a rim laid round the staff and the hands as well turns the ivory blue.
 */
export type BodyParts = 'all' | 'cloth';

// ── Whole figure ─────────────────────────────────────────────────────────────

/** How much darker the far arm is painted in profile, where it is behind the body. */
const FAR_ARM_SHADE = 0.55;
/** Past this much collapse the sleeves have sunk into the heap. */
const ARMS_GONE_AT = 0.6;

/** Where the fallen mask lands: in front of the heap, just clear of its edge. */
const DROPPED_MASK_REST_SIDE = pt(0.34, -0.06);
const DROPPED_MASK_REST_FACING = pt(-0.08, -0.03);
/** How far the mask turns as it falls; head-on it tumbles further to show it is loose. */
const DROPPED_MASK_SPIN_SIDE = deg(40);
const DROPPED_MASK_SPIN_FACING = deg(-70);

/** The dropped mask, falling from the hood to the ground in front of the heap. */
function drawDroppedMask(ctx: Ctx, view: NecromancerView, pose: NecromancerPose, rig: Rig): void {
  if (pose.maskDrop <= 0) return;
  const t = clamp01(pose.maskDrop);
  const fall = t * t;
  const start = view === 'side' ? add(rig.head, SIDE_MASK_OFFSET) : rig.head;
  const rest = view === 'side' ? DROPPED_MASK_REST_SIDE : DROPPED_MASK_REST_FACING;
  const at = mixPt(start, rest, fall);
  const spin = lerp(0, view === 'side' ? DROPPED_MASK_SPIN_SIDE : DROPPED_MASK_SPIN_FACING, fall);
  if (view === 'side') drawMaskSide(ctx, at, spin, 1 - t);
  else drawMaskFront(ctx, at, spin, 1 - t);
}

/**
 * Paints the whole figure except the additive glow, in tile units. `front` is
 * reflected so the staff stays in the same hand from every side.
 */
export function drawNecromancerBody(
  ctx: Ctx,
  view: NecromancerView,
  pose: NecromancerPose,
  parts: BodyParts = 'all',
): void {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const rig = rigOf(view, pose);
  const armsVisible = pose.collapse < ARMS_GONE_AT;
  const armAlpha = 1 - clamp01(pose.collapse / ARMS_GONE_AT);
  const baseAlpha = ctx.globalAlpha;
  const free = freeArmOf(view, pose, rig);
  const staffArm = staffArmOf(view, pose, rig);
  const hands = parts === 'all';
  const arm = (paint: () => void): void => {
    if (!armsVisible) return;
    ctx.globalAlpha = baseAlpha * armAlpha;
    paint();
    ctx.globalAlpha = baseAlpha;
  };
  const freeWhole = (shade: number): void => {
    arm(() => {
      drawSleeve(ctx, free, shade, FREE_SLEEVE_SEED);
      if (hands) drawArmHand(ctx, free, pose.freeHandSpread, false, shade);
    });
  };
  const staffSleeve = (shade: number): void => {
    arm(() => {
      drawSleeve(ctx, staffArm, shade, STAFF_SLEEVE_SEED);
    });
  };
  const staffHand = (shade: number): void => {
    if (hands) arm(() => drawArmHand(ctx, staffArm, 0, true, shade));
  };
  const staff = (): void => {
    if (parts === 'all') drawStaff(ctx, view, pose, rig);
  };

  if (view === 'side') {
    if (!pose.freeArmInFront) freeWhole(FAR_ARM_SHADE);
    drawRobeSide(ctx, pose, rig);
    staffSleeve(0);
    drawMantleSide(ctx, pose, rig);
    drawHoodSide(ctx, pose, rig, parts);
    staff();
    if (pose.freeArmInFront) freeWhole(NEAR_FREE_ARM_SHADE);
    staffHand(0);
  } else if (view === 'away') {
    // From behind, the free hand is on the far side of the body and hidden.
    freeWhole(FAR_ARM_SHADE);
    staff();
    drawRobeFacing(ctx, view, pose, rig);
    staffSleeve(AWAY_ARM_SHADE);
    drawMantleFacing(ctx, view, pose, rig);
    drawHoodAway(ctx, pose, rig);
    staffHand(AWAY_ARM_SHADE);
  } else {
    ctx.scale(-1, 1);
    drawRobeFacing(ctx, view, pose, rig);
    freeWhole(0);
    staffSleeve(0);
    drawMantleFacing(ctx, view, pose, rig);
    drawHoodFront(ctx, pose, rig, parts);
    staff();
    staffHand(0);
  }
  if (parts === 'all') drawDroppedMask(ctx, view, pose, rig);
  ctx.restore();
}

const FREE_SLEEVE_SEED = 71;
const STAFF_SLEEVE_SEED = 73;
const NEAR_FREE_ARM_SHADE = 0.2;
const AWAY_ARM_SHADE = 0.2;

/** The x-reflection a view is painted under, so callers can place things in its space. */
export function viewMirror(view: NecromancerView): number {
  return view === 'front' ? -1 : 1;
}

/** The lantern's position in the view's painted space, reflection applied. */
export function paintedLanternPoint(view: NecromancerView, pose: NecromancerPose): Pt {
  const p = lanternPoint(view, pose);
  return pt(p.x * viewMirror(view), p.y);
}

/** The additive glow, in the view's painted space. */
export function drawNecromancerGlow(ctx: Ctx, view: NecromancerView, pose: NecromancerPose): void {
  ctx.save();
  ctx.scale(viewMirror(view), 1);
  drawLanternGlow(ctx, view, pose);
  ctx.restore();
}

/** The floor layer under the figure — contact shadow and cracks — in painted space. */
export function drawNecromancerGround(
  ctx: Ctx,
  view: NecromancerView,
  pose: NecromancerPose,
): void {
  ctx.save();
  ctx.scale(viewMirror(view), 1);
  drawContactShadow(ctx, view, pose);
  drawGroundCracks(ctx, view, pose);
  ctx.restore();
}
