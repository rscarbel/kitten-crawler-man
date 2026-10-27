/**
 * Drawing engine for Steve Cartwright, the town's wheelwright: a short upright
 * otter in red trunks with a whistle on a cord and a windlass crossbow in his
 * right paw, which he practises with at a wooden target in his workshop.
 *
 * He has to read as an otter and never as a rat, because rats are enemies and a
 * townsman who reads as vermin has been lied about by the art. The cues that
 * separate the two at a 32 px tile are all silhouette: a flat, broad head wider
 * than it is tall (a rat's is a long wedge), small round ears set low on the
 * sides of the skull (a rat's are big thin discs on top), a blunt muzzle built
 * from two puffy whisker pads round a big dark nose, a thick neck that runs
 * straight into the body, and a heavy furred tail that tapers from a base as
 * wide as a thigh (a rat's is a thin pink cord). Warm glossy chocolate fur with
 * a cream throat, never the rat's speckled grey.
 *
 * Poses are authored in **body space** — `x` toward the figure's own right, `y`
 * down the screen with the ground at 0, `z` the way he faces — and each view
 * projects them. Head-on the figure's right lands on screen left, so a
 * right-handed crossbow stays in the right paw however he turns. In profile he
 * faces +X with his right side toward the camera; the runtime mirrors the cell
 * for a west-facing otter, which keeps the crossbow arm on the near side both
 * ways.
 *
 * The outline is the silhouette only. The body is composed on a scratch surface
 * at whatever density it is being painted at, and that silhouette is dilated
 * into a one-screen-pixel line: an outline stroked round every part turns an
 * arm across the belly into a paper cut-out. Inside the silhouette, parts are
 * separated by value — a soft shade of their own colour — not by ink.
 *
 * Coordinates are tile units. The caller translates to the point between the
 * feet on the ground line and scales by one tile. Light comes from the upper
 * left, matching every other figure.
 */

import { allocCanvas, releaseSurface, surfaceContext } from '../../core/rendering/canvasSurface';
import { clamp01, deg, lerp, mix, rgba, type Pt } from './bipedArt';

type Ctx = CanvasRenderingContext2D;

export const TWO_PI = Math.PI * 2;

// ── Body-space vectors ───────────────────────────────────────────────────────

export interface V3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

function v3(x: number, y: number, z: number): V3 {
  return { x, y, z };
}

function add(a: V3, b: V3): V3 {
  return v3(a.x + b.x, a.y + b.y, a.z + b.z);
}

function scaled(a: V3, k: number): V3 {
  return v3(a.x * k, a.y * k, a.z * k);
}

function sub(a: V3, b: V3): V3 {
  return v3(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function length3(a: V3): number {
  return Math.hypot(a.x, a.y, a.z);
}

function normalised(a: V3): V3 {
  const size = length3(a);
  return size < DEGENERATE_LENGTH ? v3(0, 0, 1) : scaled(a, 1 / size);
}

function cross(a: V3, b: V3): V3 {
  return v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}

const DEGENERATE_LENGTH = 1e-6;
const HALF = 0.5;

function pt(x: number, y: number): Pt {
  return { x, y };
}

function mid(a: Pt, b: Pt, t = HALF): Pt {
  return pt(lerp(a.x, b.x, t), lerp(a.y, b.y, t));
}

// ── Palette ──────────────────────────────────────────────────────────────────

/**
 * The fur ramp. Warm and a little red all the way down so the shadow side
 * stays chocolate rather than greying into the rat's coat; the sheen step is
 * what says "wet and sleek" rather than "fluffy".
 */
const FUR_DEEP = '#2b170c';
const FUR_SHADOW = '#452814';
const FUR_DARK = '#5a341a';
const FUR_BASE = '#7a4a28';
const FUR_LIGHT = '#9a6236';
const FUR_SHEEN = '#d3a06a';
/** Paws, feet and the tail tip run darker than the body, as a real otter's do. */
const PAW_BASE = '#4a2a15';
const PAW_LIGHT = '#6a4020';

const CREAM_SHADOW = '#b49670';
const CREAM_BASE = '#e3cfa6';
const CREAM_LIGHT = '#f6ead0';

const NOSE = '#1d1210';
const NOSE_SHINE = '#8a7870';
const EYE = '#130b08';
const EYE_GLINT = '#ffffff';
const MOUTH = '#3a1812';
const TONGUE = '#d96a70';
const WHISKER = '#f3ead8';
const EAR_INNER = '#3b2115';

const TRUNKS_DARK = '#8a141a';
const TRUNKS_BASE = '#cf2a2e';
const TRUNKS_LIGHT = '#f06150';
const TRUNKS_TRIM = '#f5efe4';

const CORD = '#f0bf2c';
const WHISTLE_BASE = '#c3cad3';
const WHISTLE_DARK = '#6e7682';
const WHISTLE_LIGHT = '#f4f7fa';

/** Honey-coloured wood, so the stock stands off the chocolate fur that surrounds it. */
const WOOD_DARK = '#5a3312';
const WOOD_BASE = '#c48a44';
const WOOD_LIGHT = '#e8b878';
const STEEL_DARK = '#3f454d';
const STEEL_BASE = '#b9c1ca';
/** The loaded bolt's point: brighter than any other steel on him, so its going is what reads as the shot. */
const BOLT_POINT_STEEL = '#f2f5f8';
const STRING = '#e2d6b4';
const BOLT_SHAFT = '#d9c79c';
const FLETCH = '#d8262c';

/** Plum rather than black: black reads as a hole in a warm figure at the tile. */
const SILHOUETTE_OUTLINE = '#1c0f10';
const SILHOUETTE_OUTLINE_ALPHA = 0.92;
const CONTACT_SHADOW = '#000000';
const CONTACT_SHADOW_ALPHA = 0.3;

/** Where the key light comes from, as a screen direction. */
const LIGHT: Pt = { x: -0.6, y: -0.8 };

// ── Proportions ──────────────────────────────────────────────────────────────

/** Ankle height above the floor; the soles sit this far below the ankle joint. */
export const ANKLE_Y = -0.05;
export const HIP_Y = -0.35;
/** Half the distance between the hip joints; the legs root well inside the rump. */
const HIP_HALF = 0.075;
/** Half the distance between planted feet. */
const STANCE_HALF = 0.075;

/**
 * The bones are a little longer than the standing span, so a standing otter
 * keeps a slight crouch in his knee — which is how the short legs look springy
 * rather than locked, and what buys the stride and the idle bounce their room.
 */
export const THIGH = 0.166;
export const SHIN = 0.166;
/** Headroom kept below full extension so the knee never snaps straight. */
export const LEG_SLACK = 0.004;

const SHOULDER_DY = -0.41;
const SHOULDER_HALF = 0.125;
export const UPPER_ARM = 0.15;
export const FOREARM = 0.13;
/** How much of the torso's pitch a limb hanging from the shoulder carries. */
const ARM_LEAN_SHARE = 0.5;
/** The forearm only takes part of the arm's sideways splay; the elbow gathers it back in. */
const FOREARM_SPREAD_SHARE = 0.5;

const UPPER_ARM_ROOT_WIDTH = 0.046;
const UPPER_ARM_ELBOW_WIDTH = 0.038;
const FOREARM_WRIST_WIDTH = 0.032;
/** A paw clears its wrist by a pixel each side, or the arm reads as ending in a stump. */
const PAW_RADIUS = 0.04;

const THIGH_ROOT_WIDTH = 0.07;
const KNEE_WIDTH = 0.056;
const ANKLE_WIDTH = 0.047;

/** Head centre above the pelvis, and how far forward of the spine it sits. */
const HEAD_DY = -0.65;
const HEAD_FORWARD = 0.02;
const SIDE_HEAD_FORWARD = 0.035;
/**
 * The head is drawn larger than the body's own scale: it is where the otter is
 * read, and a head that stays in proportion is a brown thumb at the tile.
 */
const HEAD_SCALE = 1.1;

const TAIL_ROOT: V3 = v3(0, 0.055, -0.1);
const TAIL_CONTROL: V3 = v3(0, 0.25, -0.3);
const TAIL_TIP: V3 = v3(0, 0.318, -0.52);
/** How far the tail tip swings sideways at full swish. */
const TAIL_SWISH_REACH = 0.42;
const TAIL_ROOT_WIDTH = 0.078;
const TAIL_TIP_WIDTH = 0.014;
const TAIL_SAMPLES = 14;

/**
 * A torso cross-section, stacked from the crotch to the neck. Head-on each is
 * a half-width; in profile a front and a back depth, so the belly can push
 * forward and the rump back — which is most of what makes the profile an
 * otter's long body rather than a plank.
 */
interface TorsoStation {
  readonly dy: number;
  readonly half: number;
  readonly front: number;
  readonly back: number;
}

const TORSO: readonly TorsoStation[] = [
  { dy: 0.075, half: 0.1, front: 0.07, back: 0.085 },
  { dy: 0, half: 0.168, front: 0.1, back: 0.13 },
  { dy: -0.145, half: 0.182, front: 0.142, back: 0.114 },
  { dy: -0.3, half: 0.165, front: 0.128, back: 0.106 },
  { dy: -0.41, half: 0.142, front: 0.108, back: 0.102 },
  { dy: -0.52, half: 0.124, front: 0.094, back: 0.092 },
];
/** How far the rounded bottom of the rump and the top of the neck run past the end stations. */
const TORSO_CAP_BOTTOM = 0.1;
const TORSO_CAP_TOP = 0.05;
const WAIST_DY = -0.1;
const WAIST_HALF = 0.176;
const WAIST_FRONT = 0.118;
const WAIST_BACK = 0.12;
/** How far down the thigh the trunks' leg runs, as a share of the thigh. */
const TRUNK_CUFF_SHARE = 0.42;
const TRUNK_CUFF_SLACK = 1.22;

// ── Views ────────────────────────────────────────────────────────────────────

export type OtterView = 'front' | 'side' | 'away';

/**
 * How much of a point's depth shows as screen height near the floor. The floor
 * is seen from above while the figure stands as if seen level, so a foot a
 * stride ahead draws a little lower — foreshortened, or a planted leg would
 * stretch and shrink through every stance.
 */
const FLOOR_DEPTH_SHARE = 0.3;
/** In profile the near foot sits a touch lower than the far one, which is what separates the pair. */
const SIDE_LATERAL_FLOOR_SHARE = 0.5;

function floorShare(y: number): number {
  return clamp01(1 - y / HIP_Y);
}

/** Projects a body-space point onto the screen for a view. */
export function project(view: OtterView, p: V3): Pt {
  const share = floorShare(p.y) * FLOOR_DEPTH_SHARE;
  if (view === 'front') return pt(-p.x, p.y + p.z * share);
  if (view === 'away') return pt(p.x, p.y - p.z * share);
  return pt(p.z, p.y + p.x * share * SIDE_LATERAL_FLOOR_SHARE);
}

/** How close to the camera a body-space point is; larger is nearer. */
function nearness(view: OtterView, p: V3): number {
  if (view === 'front') return p.z;
  if (view === 'away') return -p.z;
  return p.x;
}

// ── Pose ─────────────────────────────────────────────────────────────────────

/**
 * An arm by its joint angles. A walking arm must be driven this way: placed by
 * its paw, both segments sweep together and the forearm flails.
 *
 * `swing` turns the arm forward from hanging straight down (a quarter turn is
 * straight ahead, a half turn overhead); `spread` lifts it out to the side;
 * `bend` folds the forearm forward and up from the line of the upper arm.
 */
export interface OtterArmPose {
  readonly swing: number;
  readonly spread: number;
  readonly bend: number;
}

/** A foot: how far ahead of the hip it is and how high off the floor. */
export interface OtterLegPose {
  readonly fore: number;
  readonly lift: number;
}

export interface CrossbowPose {
  readonly held: boolean;
  /** Whether a bolt sits in the track; false from the release frame on. */
  readonly loaded: boolean;
  /** 1 with the string drawn back to the latch, 0 slack after a shot. */
  readonly cocked: number;
  /** Extra tilt of the crossbow off the line of the forearm, forward-up positive. */
  readonly pitch: number;
  /** Turn of the crossbow out toward his right, about the vertical. */
  readonly yaw: number;
  /** The windlass crank's turn about its axle, radians; 0 points the handle down the stock. */
  readonly crank: number;
  /** A loose bolt carried in the left paw on its way to the track. */
  readonly boltInLeftPaw: boolean;
  /**
   * Where the crossbow is when it is not simply in his right paw — stood on
   * its stirrup to be wound — or null for the paw's grip and the angles above.
   */
  readonly placed: CrossbowPlacement | null;
}

/** A crossbow placed in body space: its grip and the unit direction it points. */
export interface CrossbowPlacement {
  readonly grip: V3;
  readonly aim: V3;
}

export interface OtterPose {
  /** Pelvis drop, positive down. */
  readonly bob: number;
  /** Pelvis shift toward the figure's right. */
  readonly sway: number;
  /** Forward pitch of the upper body about the pelvis. */
  readonly lean: number;
  /** Sideways tilt of the upper body toward the figure's right — the waddle. */
  readonly roll: number;
  readonly headTilt: number;
  /** Nod, chin down positive. */
  readonly headPitch: number;
  readonly armR: OtterArmPose;
  readonly armL: OtterArmPose;
  readonly legR: OtterLegPose;
  readonly legL: OtterLegPose;
  /** Tail tip sideways, -1..1 toward the figure's right. */
  readonly tailSwish: number;
  /** Tail tip lift off the floor. */
  readonly tailLift: number;
  /** 0 eyes open, 1 shut. */
  readonly blink: number;
  readonly mouthOpen: number;
  readonly crossbow: CrossbowPose;
}

export const REST_ARM_R: OtterArmPose = { swing: deg(22), spread: deg(12), bend: deg(52) };
export const REST_ARM_L: OtterArmPose = { swing: deg(6), spread: deg(15), bend: deg(18) };
/**
 * Carried turned out to his right, so head-on and from behind the stock shows
 * along its length instead of foreshortening to a dot on the paw.
 */
export const REST_CROSSBOW: CrossbowPose = {
  held: true,
  loaded: true,
  cocked: 1,
  pitch: deg(-4),
  yaw: deg(42),
  crank: 0,
  boltInLeftPaw: false,
  placed: null,
};
/** The tail rests off to one side so it shows past the body head-on. */
export const REST_TAIL_SWISH = 0.55;

export function restPose(): OtterPose {
  return {
    bob: 0,
    sway: 0,
    lean: 0,
    roll: 0,
    headTilt: 0,
    headPitch: 0,
    armR: REST_ARM_R,
    armL: REST_ARM_L,
    legR: { fore: 0, lift: 0 },
    legL: { fore: 0, lift: 0 },
    tailSwish: REST_TAIL_SWISH,
    tailLift: 0,
    blink: 0,
    mouthOpen: 0,
    crossbow: REST_CROSSBOW,
  };
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

interface ArmChain {
  readonly shoulder: V3;
  readonly elbow: V3;
  readonly wrist: V3;
  readonly paw: V3;
  readonly forearmDir: V3;
  /** The forearm's swing angle, which the crossbow's aim is measured from. */
  readonly forearmSwing: number;
  readonly spread: number;
}

export interface OtterSkeleton {
  readonly pelvis: V3;
  readonly hipR: V3;
  readonly hipL: V3;
  readonly ankleR: V3;
  readonly ankleL: V3;
  readonly armR: ArmChain;
  readonly armL: ArmChain;
  readonly head: V3;
  readonly lean: number;
  readonly roll: number;
}

/** Rotates an offset from the pelvis by the upper body's lean and roll. */
function upperOffset(offset: V3, lean: number, roll: number): V3 {
  const pitchedY = offset.y * Math.cos(lean) + offset.z * Math.sin(lean);
  const pitchedZ = offset.z * Math.cos(lean) - offset.y * Math.sin(lean);
  const rolledX = offset.x * Math.cos(roll) - pitchedY * Math.sin(roll);
  const rolledY = pitchedY * Math.cos(roll) + offset.x * Math.sin(roll);
  return v3(rolledX, rolledY, pitchedZ);
}

/** A unit direction swung forward from straight down, then splayed sideways. */
function limbDirection(swing: number, spread: number): V3 {
  return v3(
    Math.sin(spread),
    Math.cos(spread) * Math.cos(swing),
    Math.cos(spread) * Math.sin(swing),
  );
}

function armChain(shoulder: V3, arm: OtterArmPose, side: number, lean: number): ArmChain {
  const upperSwing = arm.swing + lean * ARM_LEAN_SHARE;
  const upperDir = limbDirection(upperSwing, arm.spread * side);
  const elbow = add(shoulder, scaled(upperDir, UPPER_ARM));
  const forearmSwing = upperSwing + arm.bend;
  const forearmSpread = arm.spread * side * FOREARM_SPREAD_SHARE;
  const forearmDir = limbDirection(forearmSwing, forearmSpread);
  const wrist = add(elbow, scaled(forearmDir, FOREARM));
  const paw = add(wrist, scaled(forearmDir, PAW_RADIUS * HALF));
  return { shoulder, elbow, wrist, paw, forearmDir, forearmSwing, spread: forearmSpread };
}

export function otterSkeleton(pose: OtterPose): OtterSkeleton {
  const pelvis = v3(pose.sway, HIP_Y + pose.bob, 0);
  const upper = (offset: V3): V3 => add(pelvis, upperOffset(offset, pose.lean, pose.roll));
  const shoulderR = upper(v3(SHOULDER_HALF, SHOULDER_DY, 0));
  const shoulderL = upper(v3(-SHOULDER_HALF, SHOULDER_DY, 0));
  return {
    pelvis,
    hipR: add(pelvis, v3(HIP_HALF, 0, 0)),
    hipL: add(pelvis, v3(-HIP_HALF, 0, 0)),
    ankleR: v3(STANCE_HALF, ANKLE_Y - pose.legR.lift, pose.legR.fore),
    ankleL: v3(-STANCE_HALF, ANKLE_Y - pose.legL.lift, pose.legL.fore),
    armR: armChain(shoulderR, pose.armR, 1, pose.lean),
    armL: armChain(shoulderL, pose.armL, -1, pose.lean),
    head: upper(v3(0, HEAD_DY, HEAD_FORWARD)),
    lean: pose.lean,
    roll: pose.roll,
  };
}

/** Hip-to-ankle span as a share of the leg's full reach; over 1 the IK has clamped. */
export function legReachShare(pose: OtterPose, side: 'R' | 'L'): number {
  const skeleton = otterSkeleton(pose);
  const hip = side === 'R' ? skeleton.hipR : skeleton.hipL;
  const ankle = side === 'R' ? skeleton.ankleR : skeleton.ankleL;
  return length3(sub(ankle, hip)) / (THIGH + SHIN - LEG_SLACK);
}

// ── Drawing primitives ───────────────────────────────────────────────────────

/** A closed Catmull-Rom curve through the points — the smooth outline of a soft form. */
function traceSmoothClosed(ctx: Ctx, points: readonly Pt[]): void {
  ctx.beginPath();
  appendSmoothClosed(ctx, points);
}

/** {@link traceSmoothClosed} added to the current path as one more closed subpath. */
function appendSmoothClosed(ctx: Ctx, points: readonly Pt[]): void {
  const count = points.length;
  const at = (i: number): Pt => points[((i % count) + count) % count];
  ctx.moveTo(at(0).x, at(0).y);
  for (let i = 0; i < count; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    ctx.bezierCurveTo(
      p1.x + (p2.x - p0.x) / 6,
      p1.y + (p2.y - p0.y) / 6,
      p2.x - (p3.x - p1.x) / 6,
      p2.y - (p3.y - p1.y) / 6,
      p2.x,
      p2.y,
    );
  }
  ctx.closePath();
}

/** A tapered capsule from `a` (half-width `wa`) to `b` (half-width `wb`). */
function traceCapsule(ctx: Ctx, a: Pt, b: Pt, wa: number, wb: number): void {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const normal = angle + Math.PI / 2;
  ctx.beginPath();
  ctx.moveTo(a.x + Math.cos(normal) * wa, a.y + Math.sin(normal) * wa);
  ctx.lineTo(b.x + Math.cos(normal) * wb, b.y + Math.sin(normal) * wb);
  ctx.arc(b.x, b.y, wb, normal, normal - Math.PI, true);
  ctx.lineTo(a.x - Math.cos(normal) * wa, a.y - Math.sin(normal) * wa);
  ctx.arc(a.x, a.y, wa, normal + Math.PI, normal, true);
  ctx.closePath();
}

interface Ramp {
  readonly shadow: string;
  readonly base: string;
  readonly light: string;
}

const FUR_RAMP: Ramp = { shadow: FUR_DARK, base: FUR_BASE, light: FUR_LIGHT };
const PAW_RAMP: Ramp = { shadow: FUR_SHADOW, base: PAW_BASE, light: PAW_LIGHT };
const TRUNKS_RAMP: Ramp = { shadow: TRUNKS_DARK, base: TRUNKS_BASE, light: TRUNKS_LIGHT };

/** A receding limb is the same fur in less light, never darker ink. */
function receded(ramp: Ramp, amount: number): Ramp {
  return {
    shadow: mix(ramp.shadow, FUR_DEEP, amount),
    base: mix(ramp.base, ramp.shadow, amount),
    light: mix(ramp.light, ramp.base, amount),
  };
}

/**
 * Fills the current path lit across a form whose extent runs from `from` to
 * `to` on screen: the lit side is whichever end faces the key light.
 */
function fillLitAcross(ctx: Ctx, ramp: Ramp, from: Pt, to: Pt): void {
  const towardLight = (to.x - from.x) * LIGHT.x + (to.y - from.y) * LIGHT.y;
  const lit = towardLight > 0 ? to : from;
  const dark = towardLight > 0 ? from : to;
  const gradient = ctx.createLinearGradient(lit.x, lit.y, dark.x, dark.y);
  gradient.addColorStop(0, ramp.light);
  gradient.addColorStop(0.38, ramp.base);
  gradient.addColorStop(0.78, ramp.base);
  gradient.addColorStop(1, ramp.shadow);
  ctx.fillStyle = gradient;
  ctx.fill();
}

/** Width, in tiles, of the soft same-colour edge that parts one form from the one behind it. */
const SEPARATION_WIDTH = 0.014;
const SEPARATION_ALPHA = 0.75;

function strokeSeparation(ctx: Ctx, ramp: Ramp): void {
  ctx.lineWidth = SEPARATION_WIDTH;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = rgba(mix(ramp.shadow, FUR_DEEP, HALF), SEPARATION_ALPHA);
  ctx.stroke();
}

/** A capsule limb segment, lit across its own axis. */
function paintSegment(ctx: Ctx, a: Pt, b: Pt, wa: number, wb: number, ramp: Ramp): void {
  const angle = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
  const width = Math.max(wa, wb);
  const centre = mid(a, b);
  const edgeA = pt(centre.x + Math.cos(angle) * width, centre.y + Math.sin(angle) * width);
  const edgeB = pt(centre.x - Math.cos(angle) * width, centre.y - Math.sin(angle) * width);
  traceCapsule(ctx, a, b, wa, wb);
  fillLitAcross(ctx, ramp, edgeA, edgeB);
}

/** The glossy streak down the lit side of a limb — the look of sleek wet fur. */
const SHEEN_ALPHA = 0.38;
const SHEEN_WIDTH = 0.012;
const SHEEN_INSET = 0.45;

function paintSheen(ctx: Ctx, a: Pt, b: Pt, wa: number, wb: number): void {
  const angle = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
  const facing = Math.cos(angle) * LIGHT.x + Math.sin(angle) * LIGHT.y > 0 ? 1 : -1;
  const offsetA = wa * SHEEN_INSET * facing;
  const offsetB = wb * SHEEN_INSET * facing;
  ctx.beginPath();
  ctx.moveTo(
    lerp(a.x, b.x, 0.12) + Math.cos(angle) * offsetA,
    lerp(a.y, b.y, 0.12) + Math.sin(angle) * offsetA,
  );
  ctx.lineTo(
    lerp(a.x, b.x, 0.8) + Math.cos(angle) * offsetB,
    lerp(a.y, b.y, 0.8) + Math.sin(angle) * offsetB,
  );
  ctx.lineCap = 'round';
  ctx.lineWidth = SHEEN_WIDTH;
  ctx.strokeStyle = rgba(FUR_SHEEN, SHEEN_ALPHA);
  ctx.stroke();
}

function fillEllipse(ctx: Ctx, c: Pt, rx: number, ry: number, fill: string, rotation = 0): void {
  ctx.beginPath();
  ctx.ellipse(c.x, c.y, Math.abs(rx), Math.abs(ry), rotation, 0, TWO_PI);
  ctx.fillStyle = fill;
  ctx.fill();
}

// ── Legs and feet ────────────────────────────────────────────────────────────

/**
 * Where a knee lands on screen. In profile it is a two-bone solve that always
 * breaks forward — a knee that hinges backward is the single most wrong thing a
 * side walk can do. Head-on and from behind a knee pointed along the line of
 * sight has no angle at all, so it sits on the hip-to-ankle line.
 */
function kneeOf(view: OtterView, hip: Pt, ankle: Pt): Pt {
  if (view !== 'side') return mid(hip, ankle, THIGH / (THIGH + SHIN));
  const span = Math.hypot(ankle.x - hip.x, ankle.y - hip.y);
  const reach = Math.min(span, THIGH + SHIN - LEG_SLACK);
  const cosHip = (THIGH * THIGH + reach * reach - SHIN * SHIN) / (2 * THIGH * reach);
  const hipAngle = Math.acos(Math.max(-1, Math.min(1, cosHip)));
  const toAnkle = Math.atan2(ankle.y - hip.y, ankle.x - hip.x);
  // Screen angles run clockwise, so subtracting swings the knee toward +X.
  const kneeAngle = toAnkle - hipAngle;
  return pt(hip.x + Math.cos(kneeAngle) * THIGH, hip.y + Math.sin(kneeAngle) * THIGH);
}

interface LegPaint {
  readonly hip: Pt;
  readonly knee: Pt;
  readonly ankle: Pt;
  readonly ankle3: V3;
  readonly near: number;
}

function legPaint(view: OtterView, hip3: V3, ankle3: V3): LegPaint {
  const hip = project(view, hip3);
  const ankle = project(view, ankle3);
  return { hip, knee: kneeOf(view, hip, ankle), ankle, ankle3, near: nearness(view, ankle3) };
}

const FOOT_TOE_REACH = 0.1;
const FOOT_HEEL_REACH = 0.035;
const FOOT_HEIGHT = 0.05;
const FOOT_HALF_WIDTH = 0.055;
const FOOT_TOE_DEPTH = 0.028;
const HEEL_HALF_HEIGHT = 0.03;

function paintFoot(ctx: Ctx, view: OtterView, leg: LegPaint, ramp: Ramp): void {
  const soleY = leg.ankle.y - ANKLE_Y;
  if (view === 'side') {
    const heel = pt(leg.ankle.x - FOOT_HEEL_REACH, soleY);
    const toe = pt(leg.ankle.x + FOOT_TOE_REACH, soleY);
    ctx.beginPath();
    ctx.moveTo(heel.x, heel.y);
    ctx.quadraticCurveTo(heel.x - 0.012, soleY - FOOT_HEIGHT, leg.ankle.x, leg.ankle.y - 0.012);
    ctx.quadraticCurveTo(toe.x - 0.03, soleY - FOOT_HEIGHT * 0.8, toe.x, soleY - 0.012);
    // Two shallow bumps along the toe end: the webbed digits, as silhouette
    // rather than as strokes, which at this size read as sandal straps.
    ctx.quadraticCurveTo(toe.x + 0.008, soleY, toe.x - 0.02, soleY);
    ctx.closePath();
    fillLitAcross(ctx, ramp, pt(leg.ankle.x, soleY - FOOT_HEIGHT), pt(leg.ankle.x, soleY));
    return;
  }
  const toward = view === 'front' ? 1 : -1;
  const centre = pt(leg.ankle.x, soleY - FOOT_HEIGHT * HALF + FOOT_TOE_DEPTH * HALF * toward);
  ctx.beginPath();
  ctx.ellipse(
    centre.x,
    centre.y,
    FOOT_HALF_WIDTH,
    view === 'front' ? FOOT_HEIGHT * 0.62 : HEEL_HALF_HEIGHT,
    0,
    0,
    TWO_PI,
  );
  fillLitAcross(
    ctx,
    ramp,
    pt(centre.x - FOOT_HALF_WIDTH, centre.y - FOOT_HEIGHT),
    pt(centre.x + FOOT_HALF_WIDTH, centre.y),
  );
  if (view === 'front') {
    // The digits' tips as a darker scallop along the front of the foot.
    ctx.lineWidth = 0.01;
    ctx.strokeStyle = rgba(FUR_DEEP, 0.55);
    for (let toe = -1; toe <= 1; toe++) {
      ctx.beginPath();
      ctx.moveTo(centre.x + toe * 0.022, centre.y + 0.008);
      ctx.lineTo(centre.x + toe * 0.024, centre.y + 0.026);
      ctx.stroke();
    }
  }
}

function paintLeg(ctx: Ctx, view: OtterView, leg: LegPaint, ramp: Ramp): void {
  paintSegment(ctx, leg.knee, leg.ankle, KNEE_WIDTH, ANKLE_WIDTH, ramp);
  paintSegment(ctx, leg.hip, leg.knee, THIGH_ROOT_WIDTH, KNEE_WIDTH, ramp);
  // Re-lay the shin over the knee so the joint is one form, not two tubes butted together.
  traceCapsule(ctx, mid(leg.knee, leg.ankle, 0.1), leg.ankle, KNEE_WIDTH * 0.96, ANKLE_WIDTH);
  ctx.fillStyle = ramp.base;
  ctx.globalAlpha *= HALF;
  ctx.fill();
  ctx.globalAlpha /= HALF;
  paintFoot(ctx, view, leg, receded(PAW_RAMP, 0));
}

/** The trunks' leg: a band wrapped round the top of its own thigh, following the thigh. */
function paintTrunkCuff(ctx: Ctx, leg: LegPaint): void {
  const hem = mid(leg.hip, leg.knee, TRUNK_CUFF_SHARE);
  const top = pt(leg.hip.x, leg.hip.y - 0.03);
  const width = THIGH_ROOT_WIDTH * TRUNK_CUFF_SLACK;
  paintSegment(ctx, top, hem, width, width * 0.95, TRUNKS_RAMP);
  traceCapsule(ctx, top, hem, width, width * 0.95);
  strokeSeparation(ctx, TRUNKS_RAMP);
}

// ── Tail ─────────────────────────────────────────────────────────────────────

function tailPoints(pose: OtterPose, skeleton: OtterSkeleton): V3[] {
  const points: V3[] = [];
  for (let i = 0; i <= TAIL_SAMPLES; i++) {
    const t = i / TAIL_SAMPLES;
    const u = 1 - t;
    const base = v3(
      u * u * TAIL_ROOT.x + 2 * u * t * TAIL_CONTROL.x + t * t * TAIL_TIP.x,
      u * u * TAIL_ROOT.y + 2 * u * t * TAIL_CONTROL.y + t * t * TAIL_TIP.y,
      u * u * TAIL_ROOT.z + 2 * u * t * TAIL_CONTROL.z + t * t * TAIL_TIP.z,
    );
    const swish = pose.tailSwish * TAIL_SWISH_REACH * t * t;
    const lift = pose.tailLift * t * t * t;
    // Offsets are from the pelvis's rest height, but the tip lies on the floor,
    // so the lower half is pinned to the ground rather than riding the bob.
    const riding = skeleton.pelvis.y * (1 - t) + HIP_Y * t;
    points.push(v3(skeleton.pelvis.x * (1 - t) + swish, riding + base.y - lift, base.z));
  }
  return points;
}

function paintTail(ctx: Ctx, view: OtterView, pose: OtterPose, skeleton: OtterSkeleton): void {
  const spine = tailPoints(pose, skeleton).map((p) => project(view, p));
  const left: Pt[] = [];
  const right: Pt[] = [];
  spine.forEach((p, i) => {
    const prev = spine[Math.max(0, i - 1)];
    const next = spine[Math.min(spine.length - 1, i + 1)];
    const angle = Math.atan2(next.y - prev.y, next.x - prev.x) + Math.PI / 2;
    const t = i / (spine.length - 1);
    // A real otter's tail is thick to two thirds of its length, then points.
    const width = lerp(TAIL_ROOT_WIDTH, TAIL_TIP_WIDTH, t * t);
    left.push(pt(p.x + Math.cos(angle) * width, p.y + Math.sin(angle) * width));
    right.push(pt(p.x - Math.cos(angle) * width, p.y - Math.sin(angle) * width));
  });
  const outline = [...left, ...right.reverse()];
  traceSmoothClosed(ctx, outline);
  const root = spine[0];
  const tip = spine[spine.length - 1];
  const across = Math.atan2(tip.y - root.y, tip.x - root.x) + Math.PI / 2;
  const middle = mid(root, tip);
  fillLitAcross(
    ctx,
    receded(FUR_RAMP, 0.25),
    pt(
      middle.x + Math.cos(across) * TAIL_ROOT_WIDTH,
      middle.y + Math.sin(across) * TAIL_ROOT_WIDTH,
    ),
    pt(
      middle.x - Math.cos(across) * TAIL_ROOT_WIDTH,
      middle.y - Math.sin(across) * TAIL_ROOT_WIDTH,
    ),
  );
  strokeSeparation(ctx, FUR_RAMP);
  paintSheen(ctx, spine[2], spine[spine.length - 4], TAIL_ROOT_WIDTH, TAIL_TIP_WIDTH * 2);
}

// ── Torso ────────────────────────────────────────────────────────────────────

interface TorsoPaint {
  readonly outline: readonly Pt[];
  readonly waistA: Pt;
  readonly waistB: Pt;
  readonly waistMid: Pt;
  readonly chest: Pt;
  readonly neck: Pt;
  readonly spineUp: Pt;
  readonly across: Pt;
}

function torsoPaint(view: OtterView, skeleton: OtterSkeleton): TorsoPaint {
  const { pelvis, lean, roll } = skeleton;
  const at = (offset: V3): Pt => project(view, add(pelvis, upperOffset(offset, lean, roll)));
  const edgeA: Pt[] = [];
  const edgeB: Pt[] = [];
  for (const station of TORSO) {
    if (view === 'side') {
      edgeA.push(at(v3(0, station.dy, station.front)));
      edgeB.push(at(v3(0, station.dy, -station.back)));
    } else {
      edgeA.push(at(v3(station.half, station.dy, 0)));
      edgeB.push(at(v3(-station.half, station.dy, 0)));
    }
  }
  const bottomStation = TORSO[0];
  const topStation = TORSO[TORSO.length - 1];
  const bottom = at(v3(0, bottomStation.dy + TORSO_CAP_BOTTOM * HALF, 0));
  const top = at(v3(0, topStation.dy - TORSO_CAP_TOP, 0));
  const outline = [bottom, ...edgeA, top, ...[...edgeB].reverse()];
  const waistA =
    view === 'side' ? at(v3(0, WAIST_DY, WAIST_FRONT)) : at(v3(WAIST_HALF, WAIST_DY, 0));
  const waistB =
    view === 'side' ? at(v3(0, WAIST_DY, -WAIST_BACK)) : at(v3(-WAIST_HALF, WAIST_DY, 0));
  const waistMid = at(v3(0, WAIST_DY + (view === 'front' ? 0.02 : 0), 0));
  const chest = at(v3(0, TORSO[3].dy, view === 'side' ? TORSO[3].front * HALF : 0));
  const neck = at(v3(0, topStation.dy, 0));
  const up = at(v3(0, -1, 0));
  const base = at(v3(0, 0, 0));
  const right = at(v3(1, 0, 0));
  return {
    outline,
    waistA,
    waistB,
    waistMid,
    chest,
    neck,
    spineUp: pt(up.x - base.x, up.y - base.y),
    across: pt(right.x - base.x, right.y - base.y),
  };
}

function withTorsoClip(ctx: Ctx, torso: TorsoPaint, paint: () => void): void {
  ctx.save();
  try {
    traceSmoothClosed(ctx, torso.outline);
    ctx.clip();
    paint();
  } finally {
    ctx.restore();
  }
}

/** How far the clip round everything but the torso reaches, in tiles: past any limb. */
const OUTSIDE_TORSO_REACH = 2;

/** Paints with the torso's silhouette cut out, so only what shows past his sides is drawn. */
function withOutsideTorsoClip(ctx: Ctx, torso: TorsoPaint, paint: () => void): void {
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(
      -OUTSIDE_TORSO_REACH,
      -OUTSIDE_TORSO_REACH,
      OUTSIDE_TORSO_REACH * 2,
      OUTSIDE_TORSO_REACH * 2,
    );
    appendSmoothClosed(ctx, torso.outline);
    ctx.clip('evenodd');
    paint();
  } finally {
    ctx.restore();
  }
}

function paintTorso(ctx: Ctx, view: OtterView, torso: TorsoPaint): void {
  const xs = torso.outline.map((p) => p.x);
  const ys = torso.outline.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  traceSmoothClosed(ctx, torso.outline);
  fillLitAcross(ctx, FUR_RAMP, pt(minX, minY), pt(maxX, maxY));

  withTorsoClip(ctx, torso, () => {
    const width = maxX - minX;
    const height = maxY - minY;
    // The cream bib: an otter's throat and chest are pale, which is what makes
    // the head read as sitting on a body rather than on a brown column.
    if (view === 'front') {
      fillSoftBlob(ctx, pt(torso.chest.x, torso.chest.y - 0.02), 0.085, 0.16, CREAM_BASE, 0.95);
      fillSoftBlob(
        ctx,
        pt(torso.chest.x - 0.02, torso.chest.y - 0.05),
        0.04,
        0.07,
        CREAM_LIGHT,
        0.6,
      );
    } else if (view === 'side') {
      const front = pt(torso.chest.x + width * 0.28, torso.chest.y - 0.03);
      fillSoftBlob(ctx, front, 0.055, 0.15, CREAM_BASE, 0.9);
    }
    // Shadow under the belly's curve and on the far flank.
    fillSoftBlob(ctx, pt(maxX, maxY), width * 0.55, height * 0.45, FUR_SHADOW, 0.35);
    // Sheen along the lit shoulder.
    fillSoftBlob(
      ctx,
      pt(minX + width * 0.3, minY + height * 0.25),
      width * 0.14,
      height * 0.1,
      FUR_SHEEN,
      0.28,
    );
  });
}

function fillSoftBlob(ctx: Ctx, c: Pt, rx: number, ry: number, color: string, alpha: number): void {
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(0, rgba(color, alpha));
  gradient.addColorStop(0.55, rgba(color, alpha * 0.8));
  gradient.addColorStop(1, rgba(color, 0));
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.scale(Math.max(rx, DEGENERATE_LENGTH), Math.max(ry, DEGENERATE_LENGTH));
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, TWO_PI);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.restore();
}

/** The trunks' seat: everything in the torso below the waistband. */
function paintTrunks(ctx: Ctx, view: OtterView, torso: TorsoPaint): void {
  withTorsoClip(ctx, torso, () => {
    const down = pt(-torso.spineUp.x, -torso.spineUp.y);
    const far = 0.6;
    ctx.beginPath();
    ctx.moveTo(torso.waistA.x, torso.waistA.y);
    ctx.quadraticCurveTo(
      2 * torso.waistMid.x - (torso.waistA.x + torso.waistB.x) * HALF,
      2 * torso.waistMid.y - (torso.waistA.y + torso.waistB.y) * HALF,
      torso.waistB.x,
      torso.waistB.y,
    );
    ctx.lineTo(torso.waistB.x + down.x * far, torso.waistB.y + down.y * far);
    ctx.lineTo(torso.waistA.x + down.x * far, torso.waistA.y + down.y * far);
    ctx.closePath();
    fillLitAcross(ctx, TRUNKS_RAMP, torso.waistA, torso.waistB);

    // The waistband: a pale drawstring hem, the one bit of trim that reads.
    ctx.beginPath();
    ctx.moveTo(torso.waistA.x, torso.waistA.y);
    ctx.quadraticCurveTo(
      2 * torso.waistMid.x - (torso.waistA.x + torso.waistB.x) * HALF,
      2 * torso.waistMid.y - (torso.waistA.y + torso.waistB.y) * HALF,
      torso.waistB.x,
      torso.waistB.y,
    );
    ctx.lineWidth = 0.02;
    ctx.strokeStyle = TRUNKS_TRIM;
    ctx.stroke();
    ctx.lineWidth = 0.008;
    ctx.strokeStyle = rgba(TRUNKS_DARK, 0.8);
    ctx.stroke();

    if (view === 'side') {
      // His trunks carry a pale stripe down the outside of the leg.
      const stripeTop = mid(torso.waistA, torso.waistB, 0.52);
      ctx.beginPath();
      ctx.moveTo(stripeTop.x, stripeTop.y);
      ctx.lineTo(stripeTop.x + down.x * 0.2, stripeTop.y + down.y * 0.2);
      ctx.lineWidth = 0.018;
      ctx.strokeStyle = TRUNKS_TRIM;
      ctx.stroke();
    } else if (view === 'front') {
      // Drawstring ends.
      const knot = pt(torso.waistMid.x, torso.waistMid.y + 0.012);
      ctx.lineWidth = 0.008;
      ctx.strokeStyle = TRUNKS_TRIM;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(knot.x, knot.y);
        ctx.lineTo(knot.x + side * 0.018, knot.y + 0.04);
        ctx.stroke();
      }
    }
  });
}

// ── Whistle ──────────────────────────────────────────────────────────────────

function paintWhistle(ctx: Ctx, view: OtterView, torso: TorsoPaint): void {
  const neck = torso.neck;
  const hang = pt(torso.chest.x, torso.chest.y + 0.005);
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.011;
  ctx.strokeStyle = CORD;
  if (view === 'side') {
    const back = pt(neck.x - 0.07, neck.y + 0.01);
    const front = pt(neck.x + 0.08, neck.y + 0.03);
    const whistle = pt(front.x + 0.03, hang.y - 0.02);
    ctx.beginPath();
    ctx.moveTo(back.x, back.y);
    ctx.quadraticCurveTo(neck.x, neck.y + 0.07, front.x, front.y);
    ctx.lineTo(whistle.x, whistle.y);
    ctx.stroke();
    paintWhistleBody(ctx, whistle, deg(80));
    return;
  }
  const across = Math.hypot(torso.across.x, torso.across.y) > 0 ? torso.across : pt(1, 0);
  const sideA = pt(neck.x + across.x * 0.085, neck.y + across.y * 0.085 + 0.02);
  const sideB = pt(neck.x - across.x * 0.085, neck.y - across.y * 0.085 + 0.02);
  if (view === 'away') {
    ctx.beginPath();
    ctx.moveTo(sideA.x, sideA.y);
    ctx.quadraticCurveTo(neck.x, neck.y + 0.045, sideB.x, sideB.y);
    ctx.stroke();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(sideA.x, sideA.y);
  ctx.lineTo(hang.x, hang.y);
  ctx.lineTo(sideB.x, sideB.y);
  ctx.stroke();
  paintWhistleBody(ctx, pt(hang.x + 0.012, hang.y + 0.018), deg(18));
}

function paintWhistleBody(ctx: Ctx, at: Pt, rotation: number): void {
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(rotation);
  ctx.beginPath();
  ctx.ellipse(0, 0, 0.034, 0.024, 0, 0, TWO_PI);
  ctx.rect(-0.052, -0.022, 0.04, 0.02);
  ctx.fillStyle = WHISTLE_BASE;
  ctx.fill();
  ctx.lineWidth = 0.007;
  ctx.strokeStyle = WHISTLE_DARK;
  ctx.stroke();
  fillEllipse(ctx, pt(-0.008, -0.009), 0.012, 0.006, WHISTLE_LIGHT);
  fillEllipse(ctx, pt(0.004, 0.004), 0.008, 0.008, WHISTLE_DARK);
  ctx.restore();
}

// ── Arms and crossbow ────────────────────────────────────────────────────────

interface ArmPaint {
  readonly shoulder: Pt;
  readonly elbow: Pt;
  readonly wrist: Pt;
  readonly paw: Pt;
  readonly chain: ArmChain;
  readonly near: number;
}

function armPaint(view: OtterView, chain: ArmChain): ArmPaint {
  return {
    shoulder: project(view, chain.shoulder),
    elbow: project(view, chain.elbow),
    wrist: project(view, chain.wrist),
    paw: project(view, chain.paw),
    chain,
    near: nearness(view, chain.paw),
  };
}

function paintForearm(ctx: Ctx, arm: ArmPaint, ramp: Ramp): void {
  paintSegment(ctx, arm.elbow, arm.wrist, UPPER_ARM_ELBOW_WIDTH, FOREARM_WRIST_WIDTH, ramp);
  traceCapsule(ctx, arm.elbow, arm.wrist, UPPER_ARM_ELBOW_WIDTH, FOREARM_WRIST_WIDTH);
  strokeSeparation(ctx, ramp);
}

function paintUpperArm(ctx: Ctx, arm: ArmPaint, ramp: Ramp): void {
  paintSegment(ctx, arm.shoulder, arm.elbow, UPPER_ARM_ROOT_WIDTH, UPPER_ARM_ELBOW_WIDTH, ramp);
  traceCapsule(ctx, arm.shoulder, arm.elbow, UPPER_ARM_ROOT_WIDTH, UPPER_ARM_ELBOW_WIDTH);
  strokeSeparation(ctx, ramp);
  paintSheen(ctx, arm.shoulder, arm.elbow, UPPER_ARM_ROOT_WIDTH, UPPER_ARM_ELBOW_WIDTH);
}

function paintArm(ctx: Ctx, arm: ArmPaint, ramp: Ramp): void {
  paintForearm(ctx, arm, ramp);
  paintUpperArm(ctx, arm, ramp);
}

function paintPaw(ctx: Ctx, arm: ArmPaint): void {
  const along = Math.atan2(arm.paw.y - arm.wrist.y, arm.paw.x - arm.wrist.x);
  ctx.beginPath();
  ctx.ellipse(arm.paw.x, arm.paw.y, PAW_RADIUS * 1.05, PAW_RADIUS * 0.88, along, 0, TWO_PI);
  fillLitAcross(
    ctx,
    PAW_RAMP,
    pt(arm.paw.x - PAW_RADIUS, arm.paw.y - PAW_RADIUS),
    pt(arm.paw.x + PAW_RADIUS, arm.paw.y + PAW_RADIUS),
  );
  strokeSeparation(ctx, PAW_RAMP);
}

/**
 * Crossbow dimensions along its own track, measured from the grip. The stock
 * runs back far enough to sit in his shoulder when he aims; the windlass drum
 * sits across the butt, its crank on his left so the free paw can turn it.
 */
/** How far the butt runs back from the grip; a pose that shoulders the crossbow beds it in there. */
export const CROSSBOW_STOCK_BACK = 0.2;
const STOCK_FRONT = 0.34;
const PROD_AT = 0.31;
const PROD_HALF_SPAN = 0.3;
const PROD_SWEEP = 0.05;
/** How much further back the limbs sweep while the string is drawn to the latch: a shot visibly snaps them forward. */
const PROD_DRAWN_SWEEP = 0.04;
const STRING_LATCH = 0.005;
const BOLT_OVERHANG = 0.17;
const BOLT_LENGTH = STOCK_FRONT + BOLT_OVERHANG - STRING_LATCH;
/** In profile the prod is edge-on; this much of its span still shows as its thickness. */
const SIDE_PROD_SHOW = 0.45;
/**
 * How much of a crossbow point's depth shows as screen height in each view.
 * From behind the floor ahead of him is further up the screen, and lifting the
 * levelled prod that much puts its tips beside his head rather than hidden
 * behind his shoulders.
 */
const CROSSBOW_DEPTH_SHARE: Readonly<Record<OtterView, number>> = {
  front: 0.3,
  side: 0,
  away: -0.5,
};
/** Where the windlass axle crosses the stock, back from the grip. */
const WINDLASS_AT = -0.16;
/** How far the drum stands out each side of the stock. */
const WINDLASS_HALF_SPAN = 0.06;
/** The crank arm's length from the axle to the handle. */
const CRANK_ARM = 0.11;
/** The cord the windlass winds runs from the drum to the string's claw. */
const WINDLASS_CORD = '#d9c79c';
/** Where the free paw steadies the fore-stock, forward of the grip. */
const FORESTOCK_AT = 0.03;
/**
 * The stirrup at the front of the stock: an open iron ring he stands in to
 * hold the crossbow down while he winds it. A ring rather than a bar, set
 * across the stock and tipped up off it, so in every view it shows its hole and
 * never reads as a point.
 */
const STIRRUP_RADIUS = 0.055;
const STIRRUP_REACH = STIRRUP_RADIUS * 2;
const STIRRUP_STROKE = 0.02;
/** How far the ring is tipped up out of the plane across the stock: enough to show it open in profile. */
const STIRRUP_TIP = 0.7;
const STIRRUP_SAMPLES = 16;
/** Where along the track a seated bolt's middle sits. */
const BOLT_SEAT_AT = STRING_LATCH + BOLT_LENGTH * HALF;

/** The crossbow's aim: the forearm's own line, tilted by the pose's pitch. */
export function crossbowAim(pose: OtterPose, skeleton: OtterSkeleton): V3 {
  const placed = pose.crossbow.placed;
  if (placed !== null) return normalised(placed.aim);
  const chain = skeleton.armR;
  const aim = limbDirection(chain.forearmSwing + pose.crossbow.pitch, chain.spread * HALF);
  const yaw = pose.crossbow.yaw;
  return v3(
    aim.x * Math.cos(yaw) + aim.z * Math.sin(yaw),
    aim.y,
    aim.z * Math.cos(yaw) - aim.x * Math.sin(yaw),
  );
}

/** The crossbow's own frame: along the track, out to his right, and up off the track. */
interface CrossbowFrame {
  readonly grip: V3;
  readonly aim: V3;
  readonly lateral: V3;
  readonly up: V3;
}

function crossbowFrame(pose: OtterPose, skeleton: OtterSkeleton): CrossbowFrame {
  const aim = crossbowAim(pose, skeleton);
  const lateral = normalised(cross(aim, v3(0, -1, 0)));
  const grip = pose.crossbow.placed?.grip ?? skeleton.armR.paw;
  return { grip, aim, lateral, up: normalised(cross(lateral, aim)) };
}

/** Where the crossbow is and which way it points, however it is held. */
export function crossbowPlacementOf(pose: OtterPose, skeleton: OtterSkeleton): CrossbowPlacement {
  const frame = crossbowFrame(pose, skeleton);
  return { grip: frame.grip, aim: frame.aim };
}

/**
 * The crossbow stood on its stirrup on the floor: the far side of the
 * stirrup's ring on `stirrup` and the stock running up from it, tilted `tilt` from straight
 * down toward him.
 */
export function crossbowStoodAt(stirrup: V3, tilt: number): CrossbowPlacement {
  const aim = v3(0, Math.cos(tilt), Math.sin(tilt));
  return { grip: sub(stirrup, scaled(aim, STOCK_FRONT + STIRRUP_REACH)), aim };
}

/** The far side of the stirrup's ring, where a foot holds the crossbow down against the floor. */
export function stirrupAt(pose: OtterPose, skeleton: OtterSkeleton): V3 {
  return alongTrack(crossbowFrame(pose, skeleton), STOCK_FRONT + STIRRUP_REACH);
}

function alongTrack(frame: CrossbowFrame, share: number): V3 {
  return add(frame.grip, scaled(frame.aim, share));
}

/** The point of a loaded bolt, in body space: where a loosed bolt starts its flight. */
export function boltTipAt(pose: OtterPose, skeleton: OtterSkeleton): V3 {
  return alongTrack(crossbowFrame(pose, skeleton), STOCK_FRONT + BOLT_OVERHANG);
}

/** Where the free paw closes on the fore-stock to steady the aim. */
export function foreStockAt(pose: OtterPose, skeleton: OtterSkeleton): V3 {
  return alongTrack(crossbowFrame(pose, skeleton), FORESTOCK_AT);
}

/** A point on the stock `share` forward of the windlass, where a steadying paw holds it. */
export function belowWindlassAt(pose: OtterPose, skeleton: OtterSkeleton, share: number): V3 {
  return alongTrack(crossbowFrame(pose, skeleton), WINDLASS_AT + share);
}

/** Where a bolt laid in the track is held by its middle. */
export function boltSeatAt(pose: OtterPose, skeleton: OtterSkeleton): V3 {
  return alongTrack(crossbowFrame(pose, skeleton), BOLT_SEAT_AT);
}

function windlassAxle(frame: CrossbowFrame): V3 {
  return alongTrack(frame, WINDLASS_AT);
}

type CrankSide = 'left' | 'right';
const CRANK_SIDE_SIGN: Readonly<Record<CrankSide, number>> = { left: -1, right: 1 };

/**
 * A windlass has a crank on each end of its drum, set opposite each other so
 * one is always up; he turns the one on his left. Each swings round the axle
 * by the pose's crank angle in the plane of the stock.
 */
function crankAt(frame: CrossbowFrame, turn: number, side: CrankSide): { hub: V3; handle: V3 } {
  const sign = CRANK_SIDE_SIGN[side];
  const hub = add(windlassAxle(frame), scaled(frame.lateral, sign * WINDLASS_HALF_SPAN));
  const angle = side === 'left' ? turn : turn + Math.PI;
  const arm = add(scaled(frame.aim, -Math.cos(angle)), scaled(frame.up, Math.sin(angle)));
  return { hub, handle: add(hub, scaled(arm, CRANK_ARM)) };
}

/** The handle of the crank he turns, on his left of the drum. */
export function crankHandleAt(pose: OtterPose, skeleton: OtterSkeleton): V3 {
  return crankAt(crossbowFrame(pose, skeleton), pose.crossbow.crank, 'left').handle;
}

/**
 * Projects a point on the crossbow. The camera looks down on the floor, so a
 * crossbow aimed at or away from it shows its length as a little screen
 * height; drawn by the rig's level projection alone it would shrink to a dot
 * on the paw head-on.
 */
function projectCrossbowPoint(view: OtterView, p: V3, grip: V3): Pt {
  const flat = project(view, p);
  const lift = CROSSBOW_DEPTH_SHARE[view];
  return pt(flat.x, flat.y + (p.z - grip.z) * lift);
}

/** A point on the crossbow as it is painted on the screen, in tile units about the feet. */
export function crossbowPointOnScreen(view: OtterView, skeleton: OtterSkeleton, p: V3): Pt {
  return projectCrossbowPoint(view, p, skeleton.armR.paw);
}

// ── Arm reach ────────────────────────────────────────────────────────────────

const REACH_ITERATIONS = 60;
const REACH_STEP = 1e-4;
const REACH_DAMPING = 1e-4;
const REACH_MAX_BEND = deg(150);
const REACH_MAX_SPREAD = deg(80);

function pawFor(pose: OtterPose, side: 'R' | 'L', arm: OtterArmPose): V3 {
  const skeleton = otterSkeleton(pose);
  const shoulder = side === 'R' ? skeleton.armR.shoulder : skeleton.armL.shoulder;
  return armChain(shoulder, arm, side === 'R' ? 1 : -1, pose.lean).paw;
}

function clampArm(arm: OtterArmPose): OtterArmPose {
  return {
    swing: arm.swing,
    spread: Math.max(-REACH_MAX_SPREAD, Math.min(REACH_MAX_SPREAD, arm.spread)),
    bend: Math.max(0, Math.min(REACH_MAX_BEND, arm.bend)),
  };
}

/** Solves a 3×3 system by Cramer's rule; a singular one moves nothing. */
function solve3(m: readonly (readonly number[])[], r: readonly number[]): readonly number[] {
  const det = (a: readonly (readonly number[])[]): number =>
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
    a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
    a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const whole = det(m);
  if (Math.abs(whole) < DEGENERATE_LENGTH ** 2) return [0, 0, 0];
  return [0, 1, 2].map(
    (column) =>
      det(m.map((row, i) => row.map((value, j) => (j === column ? r[i] : value)))) / whole,
  );
}

/**
 * The arm angles that put a paw on a body-space point, solved from `seed` by
 * damped Gauss-Newton. A paw that holds onto something — the crossbow's stock,
 * its crank — has to be placed by where that thing is; the angles are what the
 * rest of the rig draws from. An unreachable point leaves the paw as near as the
 * arm allows, which `pawMissAt` measures.
 */
export function armReaching(
  pose: OtterPose,
  side: 'R' | 'L',
  target: V3,
  seed: OtterArmPose,
): OtterArmPose {
  let arm = clampArm(seed);
  for (let i = 0; i < REACH_ITERATIONS; i++) {
    const paw = pawFor(pose, side, arm);
    const miss = sub(target, paw);
    const nudged = [
      { ...arm, swing: arm.swing + REACH_STEP },
      { ...arm, spread: arm.spread + REACH_STEP },
      { ...arm, bend: arm.bend + REACH_STEP },
    ].map((moved) => scaled(sub(pawFor(pose, side, moved), paw), 1 / REACH_STEP));
    const normal = nudged.map((a, row) =>
      nudged.map(
        (b, column) => a.x * b.x + a.y * b.y + a.z * b.z + (row === column ? REACH_DAMPING : 0),
      ),
    );
    const rhs = nudged.map((a) => a.x * miss.x + a.y * miss.y + a.z * miss.z);
    const [dSwing, dSpread, dBend] = solve3(normal, rhs);
    arm = clampArm({
      swing: arm.swing + dSwing,
      spread: arm.spread + dSpread,
      bend: arm.bend + dBend,
    });
  }
  return arm;
}

/** How far a pose's paw is from a body-space point, in tiles. */
export function pawMissAt(pose: OtterPose, side: 'R' | 'L', target: V3): number {
  const skeleton = otterSkeleton(pose);
  return length3(sub(target, side === 'R' ? skeleton.armR.paw : skeleton.armL.paw));
}

// ── Crossbow paint ───────────────────────────────────────────────────────────

const BOLT_STROKE = 0.011;
const BOLT_POINT_RADIUS = 0.014;
const BOLT_HEAD_LENGTH = 0.06;
const BOLT_HEAD_HALF_WIDTH = 0.026;
const BOLT_HEAD_EDGE = 0.006;
const FLETCH_RADIUS = 0.014;
const FLETCH_SHARE = 0.12;

/** A bolt laid from its nock to its point: the shaft, a steel point and a red fletch. */
function paintBoltBetween(ctx: Ctx, nock: Pt, tip: Pt): void {
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(nock.x, nock.y);
  ctx.lineTo(tip.x, tip.y);
  ctx.lineWidth = BOLT_STROKE;
  ctx.strokeStyle = BOLT_SHAFT;
  ctx.stroke();
  const length = Math.max(Math.hypot(tip.x - nock.x, tip.y - nock.y), DEGENERATE_LENGTH);
  const dx = (tip.x - nock.x) / length;
  const dy = (tip.y - nock.y) / length;
  const headLength = Math.min(BOLT_HEAD_LENGTH, length);
  const baseX = tip.x - dx * headLength;
  const baseY = tip.y - dy * headLength;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(baseX - dy * BOLT_HEAD_HALF_WIDTH, baseY + dx * BOLT_HEAD_HALF_WIDTH);
  ctx.lineTo(baseX + dy * BOLT_HEAD_HALF_WIDTH, baseY - dx * BOLT_HEAD_HALF_WIDTH);
  ctx.closePath();
  ctx.fillStyle = BOLT_POINT_STEEL;
  ctx.fill();
  ctx.lineWidth = BOLT_HEAD_EDGE;
  ctx.strokeStyle = STEEL_DARK;
  ctx.stroke();
  fillEllipse(ctx, tip, BOLT_POINT_RADIUS, BOLT_POINT_RADIUS, BOLT_POINT_STEEL);
  fillEllipse(ctx, mid(nock, tip, FLETCH_SHARE), FLETCH_RADIUS, FLETCH_RADIUS, FLETCH);
}

const STOCK_OUTER_STROKE = 0.06;
const STOCK_INNER_STROKE = 0.04;
const PROD_OUTER_STROKE = 0.052;
const PROD_INNER_STROKE = 0.03;
const DRUM_STROKE = 0.045;
const DRUM_CORE_STROKE = 0.028;
const CRANK_STROKE = 0.016;
/** A dark edge round the bright crank, so it reads against the fur behind it. */
const CRANK_EDGE = 0.006;
const CRANK_KNOB_RADIUS = 0.024;
const CORD_STROKE = 0.009;

function paintCrank(
  ctx: Ctx,
  view: OtterView,
  frame: CrossbowFrame,
  turn: number,
  side: CrankSide,
): void {
  const { hub, handle } = crankAt(frame, turn, side);
  const from = projectCrossbowPoint(view, hub, frame.grip);
  const to = projectCrossbowPoint(view, handle, frame.grip);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.lineWidth = CRANK_STROKE + CRANK_EDGE * 2;
  ctx.strokeStyle = STEEL_DARK;
  ctx.stroke();
  ctx.lineWidth = CRANK_STROKE;
  ctx.strokeStyle = STEEL_BASE;
  ctx.stroke();
  fillEllipse(ctx, to, CRANK_KNOB_RADIUS + CRANK_EDGE, CRANK_KNOB_RADIUS + CRANK_EDGE, WOOD_DARK);
  fillEllipse(ctx, to, CRANK_KNOB_RADIUS, CRANK_KNOB_RADIUS, WOOD_LIGHT);
}

/** The cranks in the order they overlap from this view: the far one first. */
function cranksFarToNear(view: OtterView, frame: CrossbowFrame): readonly CrankSide[] {
  const leftNearer =
    nearness(view, crankAt(frame, 0, 'left').hub) > nearness(view, crankAt(frame, 0, 'right').hub);
  return leftNearer ? ['right', 'left'] : ['left', 'right'];
}

/**
 * The windlass across the butt: the far crank, the drum, the cord it winds
 * while the string is being drawn, and the near crank.
 */
function paintWindlass(
  ctx: Ctx,
  view: OtterView,
  pose: OtterPose,
  skeleton: OtterSkeleton,
  nock: Pt,
): void {
  const frame = crossbowFrame(pose, skeleton);
  const P = (p: V3): Pt => projectCrossbowPoint(view, p, frame.grip);
  const axle = windlassAxle(frame);
  const drumRight = P(add(axle, scaled(frame.lateral, WINDLASS_HALF_SPAN)));
  const drumLeft = P(add(axle, scaled(frame.lateral, -WINDLASS_HALF_SPAN)));
  const [far, near] = cranksFarToNear(view, frame);
  paintCrank(ctx, view, frame, pose.crossbow.crank, far);
  const winding = pose.crossbow.cocked > 0 && pose.crossbow.cocked < 1 && !pose.crossbow.loaded;
  if (winding) {
    const drum = P(axle);
    ctx.beginPath();
    ctx.moveTo(drum.x, drum.y);
    ctx.lineTo(nock.x, nock.y);
    ctx.lineWidth = CORD_STROKE;
    ctx.strokeStyle = WINDLASS_CORD;
    ctx.stroke();
  }
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(drumRight.x, drumRight.y);
  ctx.lineTo(drumLeft.x, drumLeft.y);
  ctx.lineWidth = DRUM_STROKE;
  ctx.strokeStyle = STEEL_DARK;
  ctx.stroke();
  ctx.lineWidth = DRUM_CORE_STROKE;
  ctx.strokeStyle = WOOD_BASE;
  ctx.stroke();
  paintCrank(ctx, view, frame, pose.crossbow.crank, near);
}

function paintStirrup(ctx: Ctx, frame: CrossbowFrame, P: (p: V3) => Pt): void {
  const centre = alongTrack(frame, STOCK_FRONT + STIRRUP_RADIUS);
  ctx.beginPath();
  for (let i = 0; i <= STIRRUP_SAMPLES; i++) {
    const angle = (i / STIRRUP_SAMPLES) * TWO_PI;
    const across = scaled(frame.lateral, Math.sin(angle) * STIRRUP_RADIUS);
    const along = scaled(frame.aim, -Math.cos(angle) * STIRRUP_RADIUS);
    const tipped = add(
      scaled(along, Math.sqrt(1 - STIRRUP_TIP ** 2)),
      scaled(frame.up, -Math.cos(angle) * STIRRUP_RADIUS * STIRRUP_TIP),
    );
    const point = P(add(add(centre, across), tipped));
    if (i === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  }
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = STIRRUP_STROKE;
  ctx.strokeStyle = STEEL_DARK;
  ctx.stroke();
  ctx.lineWidth = STIRRUP_STROKE * HALF;
  ctx.strokeStyle = STEEL_BASE;
  ctx.stroke();
}

function paintCrossbow(ctx: Ctx, view: OtterView, pose: OtterPose, skeleton: OtterSkeleton): void {
  if (!pose.crossbow.held) return;
  const frame = crossbowFrame(pose, skeleton);
  const { aim, lateral } = frame;
  const along = (share: number): V3 => alongTrack(frame, share);
  const P = (p: V3): Pt => projectCrossbowPoint(view, p, frame.grip);

  const butt = P(along(-CROSSBOW_STOCK_BACK));
  const front = P(along(STOCK_FRONT));
  const prodCentre3 = along(PROD_AT);
  const prodCentre = P(prodCentre3);
  const sweep = PROD_SWEEP + PROD_DRAWN_SWEEP * pose.crossbow.cocked;
  const limbTip = (sign: number): Pt => {
    if (view === 'side') {
      const back = P(add(prodCentre3, scaled(aim, -sweep)));
      const across = P(add(prodCentre3, frame.up));
      const upX = across.x - prodCentre.x;
      const upY = across.y - prodCentre.y;
      const upLength = Math.max(Math.hypot(upX, upY), DEGENERATE_LENGTH);
      const show = sign * PROD_HALF_SPAN * SIDE_PROD_SHOW;
      return pt(back.x + (upX / upLength) * show, back.y + (upY / upLength) * show);
    }
    return P(add(add(prodCentre3, scaled(lateral, sign * PROD_HALF_SPAN)), scaled(aim, -sweep)));
  };
  const tipA = limbTip(1);
  const tipB = limbTip(-1);
  const drawShare = lerp(PROD_AT - PROD_SWEEP, STRING_LATCH, pose.crossbow.cocked);
  const nock = P(along(drawShare));

  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(butt.x, butt.y);
  ctx.lineTo(front.x, front.y);
  ctx.lineWidth = STOCK_OUTER_STROKE;
  ctx.strokeStyle = WOOD_DARK;
  ctx.stroke();
  ctx.lineWidth = STOCK_INNER_STROKE;
  ctx.strokeStyle = WOOD_BASE;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(lerp(butt.x, front.x, 0.1), lerp(butt.y, front.y, 0.1) - 0.006);
  ctx.lineTo(lerp(butt.x, front.x, 0.85), lerp(butt.y, front.y, 0.85) - 0.006);
  ctx.lineWidth = 0.007;
  ctx.strokeStyle = WOOD_LIGHT;
  ctx.stroke();

  paintWindlass(ctx, view, pose, skeleton, nock);
  paintStirrup(ctx, frame, P);

  // String, drawn before the prod so the limbs sit over its ends.
  ctx.beginPath();
  ctx.moveTo(tipA.x, tipA.y);
  ctx.lineTo(nock.x, nock.y);
  ctx.lineTo(tipB.x, tipB.y);
  ctx.lineWidth = 0.007;
  ctx.strokeStyle = STRING;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(tipA.x, tipA.y);
  ctx.quadraticCurveTo(
    prodCentre.x + (prodCentre.x - mid(tipA, tipB).x) * 0.6,
    prodCentre.y + (prodCentre.y - mid(tipA, tipB).y) * 0.6,
    tipB.x,
    tipB.y,
  );
  ctx.lineWidth = PROD_OUTER_STROKE;
  ctx.strokeStyle = STEEL_DARK;
  ctx.stroke();
  ctx.lineWidth = PROD_INNER_STROKE;
  ctx.strokeStyle = STEEL_BASE;
  ctx.stroke();

  if (pose.crossbow.loaded) {
    paintBoltBetween(ctx, nock, P(along(STOCK_FRONT + BOLT_OVERHANG)));
  }
}

/** The loose bolt in his left paw, held by its middle and laid the way the track runs. */
function paintLooseBolt(ctx: Ctx, view: OtterView, pose: OtterPose, skeleton: OtterSkeleton): void {
  if (!pose.crossbow.boltInLeftPaw) return;
  const frame = crossbowFrame(pose, skeleton);
  const middle = skeleton.armL.paw;
  const half = scaled(frame.aim, BOLT_LENGTH * HALF);
  paintBoltBetween(
    ctx,
    projectCrossbowPoint(view, sub(middle, half), frame.grip),
    projectCrossbowPoint(view, add(middle, half), frame.grip),
  );
}

// ── Head ─────────────────────────────────────────────────────────────────────

/**
 * The head-on skull, as points round it in head units. Wider than tall and
 * flat on top, widest low at the cheeks: an otter's head is a broad flat wedge
 * seen from the front, never the rat's narrow dome.
 */
const FRONT_SKULL: readonly Pt[] = [
  pt(0, -0.128),
  pt(0.1, -0.122),
  pt(0.163, -0.088),
  pt(0.196, -0.02),
  pt(0.192, 0.045),
  pt(0.145, 0.098),
  pt(0.065, 0.126),
  pt(0, 0.13),
  pt(-0.065, 0.126),
  pt(-0.145, 0.098),
  pt(-0.192, 0.045),
  pt(-0.196, -0.02),
  pt(-0.163, -0.088),
  pt(-0.1, -0.122),
];

/**
 * The profile skull, facing +X. The top runs flat from the ear straight down
 * the short muzzle to the nose — no forehead stop and no long snout — and the
 * throat is as thick as the head, so it runs into the neck without a notch.
 */
const SIDE_SKULL: readonly Pt[] = [
  pt(-0.155, 0.02),
  pt(-0.136, -0.09),
  pt(-0.045, -0.14),
  pt(0.07, -0.13),
  pt(0.15, -0.092),
  pt(0.2, -0.058),
  pt(0.222, -0.018),
  pt(0.227, 0.035),
  pt(0.2, 0.088),
  pt(0.12, 0.12),
  pt(0.03, 0.134),
  pt(-0.06, 0.132),
  pt(-0.14, 0.09),
];

const EAR_RADIUS = 0.042;
/**
 * The back of the head is rounder over the crown than the face is: seen from
 * behind, the flat brow that makes the face an otter's is out of sight, and a
 * flat top there reads as a box.
 */
const AWAY_SKULL: readonly Pt[] = [
  pt(0, -0.136),
  pt(0.085, -0.128),
  pt(0.15, -0.098),
  pt(0.188, -0.04),
  pt(0.192, 0.035),
  pt(0.148, 0.096),
  pt(0.068, 0.126),
  pt(0, 0.13),
  pt(-0.068, 0.126),
  pt(-0.148, 0.096),
  pt(-0.192, 0.035),
  pt(-0.188, -0.04),
  pt(-0.15, -0.098),
  pt(-0.085, -0.128),
];
const AWAY_EAR: Pt = pt(0.172, -0.086);
const FRONT_EAR: Pt = pt(0.168, -0.082);
const SIDE_EAR: Pt = pt(-0.085, -0.078);
const FRONT_EYE: Pt = pt(0.084, -0.04);
const SIDE_EYE: Pt = pt(0.072, -0.058);
const EYE_RADIUS = 0.026;
const FRONT_NOSE: Pt = pt(0, 0.012);
const SIDE_NOSE: Pt = pt(0.212, -0.022);
const MUZZLE_LOBE: Pt = pt(0.052, 0.048);
const MUZZLE_LOBE_RX = 0.064;
const MUZZLE_LOBE_RY = 0.05;

function paintEar(ctx: Ctx, at: Pt, showInner: boolean, outward: number): void {
  ctx.beginPath();
  ctx.arc(at.x, at.y, EAR_RADIUS, 0, TWO_PI);
  fillLitAcross(
    ctx,
    FUR_RAMP,
    pt(at.x - EAR_RADIUS, at.y - EAR_RADIUS),
    pt(at.x + EAR_RADIUS, at.y + EAR_RADIUS),
  );
  if (showInner) {
    fillEllipse(
      ctx,
      pt(at.x + outward * 0.008, at.y + 0.004),
      EAR_RADIUS * 0.52,
      EAR_RADIUS * 0.5,
      EAR_INNER,
    );
  }
}

function paintEye(ctx: Ctx, at: Pt, pose: OtterPose): void {
  if (pose.blink > HALF) {
    ctx.beginPath();
    ctx.moveTo(at.x - EYE_RADIUS * 1.1, at.y);
    ctx.quadraticCurveTo(at.x, at.y + EYE_RADIUS * 0.9, at.x + EYE_RADIUS * 1.1, at.y);
    ctx.lineWidth = 0.014;
    ctx.lineCap = 'round';
    ctx.strokeStyle = EYE;
    ctx.stroke();
    return;
  }
  fillEllipse(ctx, at, EYE_RADIUS, EYE_RADIUS * 1.08, EYE);
  fillEllipse(
    ctx,
    pt(at.x - EYE_RADIUS * 0.35, at.y - EYE_RADIUS * 0.38),
    EYE_RADIUS * 0.38,
    EYE_RADIUS * 0.38,
    EYE_GLINT,
  );
}

/** Mirrors a head-unit point to the other side when `side` is -1. */
function sided(p: Pt, side: number): Pt {
  return pt(p.x * side, p.y);
}

function paintFrontHead(ctx: Ctx, pose: OtterPose): void {
  for (const side of [-1, 1]) paintEar(ctx, sided(FRONT_EAR, side), true, side);
  traceSmoothClosed(ctx, FRONT_SKULL);
  fillLitAcross(ctx, FUR_RAMP, pt(-0.2, -0.13), pt(0.2, 0.13));
  ctx.save();
  try {
    traceSmoothClosed(ctx, FRONT_SKULL);
    ctx.clip();
    // Pale lower cheeks and chin, and the two puffy whisker pads over them.
    for (const side of [-1, 1]) {
      fillSoftBlob(ctx, pt(side * 0.12, 0.085), 0.085, 0.06, CREAM_SHADOW, 0.7);
    }
    fillEllipse(ctx, pt(0, 0.1), 0.075, 0.04, CREAM_SHADOW);
    for (const side of [-1, 1]) {
      const lobe = sided(MUZZLE_LOBE, side);
      fillEllipse(ctx, lobe, MUZZLE_LOBE_RX, MUZZLE_LOBE_RY, CREAM_BASE);
      fillSoftBlob(ctx, pt(lobe.x - 0.012, lobe.y - 0.014), 0.035, 0.024, CREAM_LIGHT, 0.9);
      // Whisker roots.
      for (let i = 0; i < 3; i++) {
        fillEllipse(
          ctx,
          pt(lobe.x + side * (0.012 + i * 0.014), lobe.y + 0.004 - i * 0.004),
          0.0045,
          0.0045,
          rgba(FUR_DEEP, 0.7),
        );
      }
    }
    // A darker brow band over the eyes, and the sheen across the crown.
    fillSoftBlob(ctx, pt(0, -0.07), 0.16, 0.05, FUR_DARK, 0.35);
    fillSoftBlob(ctx, pt(-0.06, -0.1), 0.07, 0.022, FUR_SHEEN, 0.5);
  } finally {
    ctx.restore();
  }
  for (const side of [-1, 1]) paintEye(ctx, sided(FRONT_EYE, side), pose);

  if (pose.mouthOpen > 0) {
    const open = 0.012 + 0.03 * pose.mouthOpen;
    fillEllipse(ctx, pt(0, 0.082 + open * 0.3), 0.028, open, MOUTH);
    fillEllipse(ctx, pt(0, 0.086 + open * 0.7), 0.018, open * 0.45, TONGUE);
  }
  // The split under the nose that curls into a grin along each pad.
  ctx.beginPath();
  ctx.moveTo(0, FRONT_NOSE.y + 0.02);
  ctx.lineTo(0, 0.07);
  ctx.moveTo(-0.05, 0.078);
  ctx.quadraticCurveTo(-0.02, 0.09, 0, 0.07);
  ctx.quadraticCurveTo(0.02, 0.09, 0.05, 0.078);
  ctx.lineWidth = 0.009;
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(MOUTH, 0.85);
  ctx.stroke();
  // The big nose: a broad rounded triangle, the darkest mark on the face.
  ctx.beginPath();
  ctx.moveTo(FRONT_NOSE.x - 0.042, FRONT_NOSE.y - 0.018);
  ctx.quadraticCurveTo(
    FRONT_NOSE.x,
    FRONT_NOSE.y - 0.03,
    FRONT_NOSE.x + 0.042,
    FRONT_NOSE.y - 0.018,
  );
  ctx.quadraticCurveTo(
    FRONT_NOSE.x + 0.034,
    FRONT_NOSE.y + 0.022,
    FRONT_NOSE.x,
    FRONT_NOSE.y + 0.03,
  );
  ctx.quadraticCurveTo(
    FRONT_NOSE.x - 0.034,
    FRONT_NOSE.y + 0.022,
    FRONT_NOSE.x - 0.042,
    FRONT_NOSE.y - 0.018,
  );
  ctx.closePath();
  ctx.fillStyle = NOSE;
  ctx.fill();
  fillEllipse(ctx, pt(FRONT_NOSE.x - 0.014, FRONT_NOSE.y - 0.012), 0.012, 0.006, NOSE_SHINE);
}

function paintSideHead(ctx: Ctx, pose: OtterPose): void {
  traceSmoothClosed(ctx, SIDE_SKULL);
  fillLitAcross(ctx, FUR_RAMP, pt(-0.15, -0.13), pt(0.24, 0.13));
  ctx.save();
  try {
    traceSmoothClosed(ctx, SIDE_SKULL);
    ctx.clip();
    fillEllipse(ctx, pt(0.1, 0.12), 0.14, 0.05, CREAM_SHADOW);
    fillEllipse(ctx, pt(0.165, 0.04), 0.075, MUZZLE_LOBE_RY * 1.1, CREAM_BASE);
    fillSoftBlob(ctx, pt(0.165, 0.028), 0.035, 0.022, CREAM_LIGHT, 0.9);
    for (let i = 0; i < 3; i++) {
      fillEllipse(ctx, pt(0.16 + i * 0.016, 0.04 - i * 0.004), 0.0045, 0.0045, rgba(FUR_DEEP, 0.7));
    }
    fillSoftBlob(ctx, pt(-0.02, -0.1), 0.09, 0.025, FUR_SHEEN, 0.5);
  } finally {
    ctx.restore();
  }
  paintEar(ctx, SIDE_EAR, true, -1);
  paintEye(ctx, SIDE_EYE, pose);
  // Mouth line along the bottom of the pad.
  ctx.beginPath();
  ctx.moveTo(0.212, 0.03);
  ctx.quadraticCurveTo(0.18, 0.076 + pose.mouthOpen * 0.03, 0.12, 0.07);
  ctx.lineWidth = 0.009;
  ctx.strokeStyle = rgba(MOUTH, 0.85);
  ctx.stroke();
  if (pose.mouthOpen > 0) {
    ctx.beginPath();
    ctx.moveTo(0.21, 0.032);
    ctx.quadraticCurveTo(0.17, 0.08 + pose.mouthOpen * 0.04, 0.13, 0.07);
    ctx.quadraticCurveTo(0.17, 0.052, 0.21, 0.032);
    ctx.fillStyle = MOUTH;
    ctx.fill();
  }
  fillEllipse(ctx, SIDE_NOSE, 0.029, 0.03, NOSE);
  fillEllipse(ctx, pt(SIDE_NOSE.x - 0.004, SIDE_NOSE.y - 0.012), 0.009, 0.005, NOSE_SHINE);
}

function paintAwayHead(ctx: Ctx): void {
  // Behind the skull, so only their outer rims show on the upper curve of the
  // back of the head — set on the corners they turn the head into a box.
  for (const side of [-1, 1]) paintEar(ctx, sided(AWAY_EAR, side), false, side);
  traceSmoothClosed(ctx, AWAY_SKULL);
  fillLitAcross(ctx, FUR_RAMP, pt(-0.2, -0.13), pt(0.2, 0.13));
  ctx.save();
  try {
    traceSmoothClosed(ctx, AWAY_SKULL);
    ctx.clip();
    // Just the pale edge of each cheek shows round the back of the head.
    for (const side of [-1, 1]) {
      fillSoftBlob(ctx, pt(side * 0.2, 0.07), 0.045, 0.05, CREAM_BASE, 0.8);
    }
    fillSoftBlob(ctx, pt(-0.05, -0.08), 0.08, 0.04, FUR_SHEEN, 0.45);
    fillSoftBlob(ctx, pt(0, 0.12), 0.14, 0.05, FUR_SHADOW, 0.5);
  } finally {
    ctx.restore();
  }
}

const WHISKER_WIDTH = 0.006;
const WHISKER_ALPHA = 0.85;

/**
 * Whiskers go on after the outline: they run past the silhouette, and dilated
 * with it they would turn into three black spokes a pixel thick.
 */
function paintWhiskers(ctx: Ctx, view: OtterView): void {
  ctx.lineCap = 'round';
  ctx.lineWidth = WHISKER_WIDTH;
  ctx.strokeStyle = rgba(WHISKER, WHISKER_ALPHA);
  if (view === 'side') {
    for (let i = 0; i < 3; i++) {
      const root = pt(0.18 + i * 0.012, 0.045 - i * 0.004);
      ctx.beginPath();
      ctx.moveTo(root.x, root.y);
      ctx.quadraticCurveTo(
        root.x + 0.06,
        root.y - 0.02 + i * 0.02,
        root.x + 0.1,
        root.y - 0.01 + i * 0.035,
      );
      ctx.stroke();
    }
    return;
  }
  const front = view === 'front';
  const rootY = front ? MUZZLE_LOBE.y : 0.07;
  const rootX = front ? MUZZLE_LOBE.x + 0.03 : 0.185;
  // From behind only the tips show past the cheeks; any longer they read as antennae.
  const reach = front ? 0.12 : 0.05;
  const count = front ? 3 : 2;
  for (const side of [-1, 1]) {
    for (let i = 0; i < count; i++) {
      const root = pt(side * rootX, rootY - 0.01 + i * 0.012);
      const tip = pt(side * (rootX + reach), root.y - 0.035 + i * 0.03);
      ctx.beginPath();
      ctx.moveTo(root.x, root.y);
      ctx.quadraticCurveTo(side * (rootX + reach * HALF), root.y - 0.012 + i * 0.01, tip.x, tip.y);
      ctx.stroke();
    }
  }
}

function withHeadSpace(
  ctx: Ctx,
  view: OtterView,
  pose: OtterPose,
  skeleton: OtterSkeleton,
  paint: () => void,
): void {
  const centre3 =
    view === 'side'
      ? add(skeleton.head, v3(0, 0, SIDE_HEAD_FORWARD - HEAD_FORWARD))
      : skeleton.head;
  const centre = project(view, centre3);
  ctx.save();
  try {
    ctx.translate(centre.x, centre.y);
    ctx.scale(HEAD_SCALE, HEAD_SCALE);
    if (view === 'side') {
      ctx.rotate(pose.headPitch + skeleton.lean * HALF);
    } else {
      const rollOnScreen = view === 'front' ? -skeleton.roll : skeleton.roll;
      ctx.rotate(pose.headTilt + rollOnScreen * HALF);
      // A nod shows head-on as the face sliding down its own skull.
      ctx.translate(0, pose.headPitch * 0.04);
    }
    paint();
  } finally {
    ctx.restore();
  }
}

function paintHead(ctx: Ctx, view: OtterView, pose: OtterPose, skeleton: OtterSkeleton): void {
  withHeadSpace(ctx, view, pose, skeleton, () => {
    if (view === 'front') paintFrontHead(ctx, pose);
    else if (view === 'side') paintSideHead(ctx, pose);
    else paintAwayHead(ctx);
  });
}

// ── Composition ──────────────────────────────────────────────────────────────

/** A figure painted back to front: the order each view's parts overlap in. */
function paintBody(ctx: Ctx, view: OtterView, pose: OtterPose, skeleton: OtterSkeleton): void {
  const legR = legPaint(view, skeleton.hipR, skeleton.ankleR);
  const legL = legPaint(view, skeleton.hipL, skeleton.ankleL);
  const [farLeg, nearLeg] = legR.near >= legL.near ? [legL, legR] : [legR, legL];
  const armR = armPaint(view, skeleton.armR);
  const armL = armPaint(view, skeleton.armL);
  const torso = torsoPaint(view, skeleton);

  const drawLegs = (): void => {
    const farRamp = view === 'side' ? receded(FUR_RAMP, 0.35) : FUR_RAMP;
    paintLeg(ctx, view, farLeg, farRamp);
    paintLeg(ctx, view, nearLeg, FUR_RAMP);
    paintTrunkCuff(ctx, farLeg);
    paintTrunkCuff(ctx, nearLeg);
  };
  const drawTorso = (): void => {
    paintTorso(ctx, view, torso);
    paintTrunks(ctx, view, torso);
    paintWhistle(ctx, view, torso);
  };
  const drawArmR = (ramp: Ramp): void => {
    paintArm(ctx, armR, ramp);
    paintCrossbow(ctx, view, pose, skeleton);
    paintPaw(ctx, armR);
  };
  const drawArmL = (ramp: Ramp): void => {
    paintArm(ctx, armL, ramp);
    paintLooseBolt(ctx, view, pose, skeleton);
    paintPaw(ctx, armL);
  };

  if (view === 'side') {
    const farArmRamp = receded(FUR_RAMP, FAR_ARM_RECEDE);
    paintTail(ctx, view, pose, skeleton);
    drawArmL(farArmRamp);
    drawLegs();
    drawTorso();
    paintHead(ctx, view, pose, skeleton);
    // A far paw working out in front of his chest — on the crank, carrying a
    // bolt — shows past the body: its forearm comes back over the torso.
    if (skeleton.armL.paw.z > SIDE_FAR_PAW_CLEARS_CHEST) {
      paintForearm(ctx, armL, farArmRamp);
      paintLooseBolt(ctx, view, pose, skeleton);
      paintPaw(ctx, armL);
    }
    drawArmR(FUR_RAMP);
    return;
  }

  if (view === 'front') {
    paintTail(ctx, view, pose, skeleton);
    // Head-on both arms belong in front of the torso unless one is posed
    // well behind it — drawing the far arm first makes a one-armed figure.
    const behind = (arm: ArmPaint): boolean => arm.near < -ARM_BEHIND_DEPTH;
    if (behind(armL)) drawArmL(FUR_RAMP);
    if (behind(armR)) drawArmR(FUR_RAMP);
    drawLegs();
    drawTorso();
    paintHead(ctx, view, pose, skeleton);
    if (!behind(armL)) drawArmL(FUR_RAMP);
    if (!behind(armR)) drawArmR(FUR_RAMP);
    return;
  }

  // From behind the arms are hidden by the back unless swung back past it.
  const inFront = (arm: ArmPaint): boolean => arm.near > ARM_BEHIND_DEPTH;
  if (!inFront(armL)) drawArmL(FUR_RAMP);
  if (!inFront(armR)) drawArmR(FUR_RAMP);
  drawLegs();
  drawTorso();
  // The back of each upper arm shows at the shoulder from behind even while
  // the forearm is out of sight in front of him, or the arms vanish into the
  // back. An arm reaching forward to the crossbow goes away from the camera
  // past his side: only the elbow flaring out past the torso shows, never a
  // limb laid across the middle of his back.
  for (const arm of [armL, armR]) {
    if (inFront(arm)) continue;
    if (arm.chain.paw.z > ARM_REACHES_FORWARD_DEPTH) {
      withOutsideTorsoClip(ctx, torso, () => {
        paintUpperArm(ctx, arm, FUR_RAMP);
      });
    } else if (arm.chain.elbow.z < UPPER_ARM_SHOWS_DEPTH) {
      paintUpperArm(ctx, arm, FUR_RAMP);
    }
  }
  paintHead(ctx, view, pose, skeleton);
  paintTail(ctx, view, pose, skeleton);
  if (inFront(armL)) drawArmL(FUR_RAMP);
  if (inFront(armR)) drawArmR(FUR_RAMP);
}

const FAR_ARM_RECEDE = 0.4;
/** How far forward of the spine the far paw must be, in profile, before it is out in front of the chest. */
const SIDE_FAR_PAW_CLEARS_CHEST = 0.16;

/** How far ahead of the spine a paw is when the arm is reaching out in front of him, not hanging. */
const ARM_REACHES_FORWARD_DEPTH = 0.12;

/** How far forward an elbow may reach before the upper arm is hidden behind the back. */
const UPPER_ARM_SHOWS_DEPTH = 0.1;

/** How far past the body's plane a paw must be before it changes sides of the torso. */
const ARM_BEHIND_DEPTH = 0.06;

/** Painted after the outline: fine strands, which must not be inked. */
function paintOverlay(ctx: Ctx, view: OtterView, pose: OtterPose, skeleton: OtterSkeleton): void {
  withHeadSpace(ctx, view, pose, skeleton, () => {
    paintWhiskers(ctx, view);
  });
}

// ── Silhouette outline ───────────────────────────────────────────────────────

/**
 * The box, in tiles about the figure origin, that a pose's ink can reach —
 * standing and reaching. The scratch surface is
 * sized to it, so ink outside it is lost.
 */
const LAYER_MIN_X = -1.3;
const LAYER_MAX_X = 1.3;
const LAYER_MIN_Y = -1.45;
const LAYER_MAX_Y = 0.2;
/** Outline thickness in cell pixels at the figure's authored 64 px tile: one screen pixel at 32 px. */
const OUTLINE_CELL_PX = 2;
const AUTHORED_PX_PER_TILE = 64;
const OUTLINE_SAMPLES = 8;
const DEGENERATE_DENSITY = 1e-3;

const STANDING_SHADOW_HALF_WIDTH: Readonly<Record<OtterView, number>> = {
  side: 0.27,
  front: 0.22,
  away: 0.22,
};
const SHADOW_HALF_HEIGHT = 0.07;
const SHADOW_DROP = 0.005;

function paintContactShadow(ctx: Ctx, view: OtterView): void {
  fillSoftBlob(
    ctx,
    pt(0, SHADOW_DROP),
    STANDING_SHADOW_HALF_WIDTH[view],
    SHADOW_HALF_HEIGHT,
    CONTACT_SHADOW,
    CONTACT_SHADOW_ALPHA,
  );
}

/**
 * Paints the otter in a pose, origin between the feet on the ground line and
 * one unit to the tile.
 */
export function drawOtter(ctx: Ctx, view: OtterView, pose: OtterPose): void {
  const skeleton = otterSkeleton(pose);
  const outerAlpha = ctx.globalAlpha;
  paintContactShadow(ctx, view);

  const transform = ctx.getTransform();
  const pxPerUnit = Math.max(Math.hypot(transform.a, transform.b), DEGENERATE_DENSITY);
  const width = Math.ceil((LAYER_MAX_X - LAYER_MIN_X) * pxPerUnit);
  const height = Math.ceil((LAYER_MAX_Y - LAYER_MIN_Y) * pxPerUnit);
  const body = allocCanvas('creatureArt', width, height);
  const outlined = allocCanvas('creatureArt', width, height);
  try {
    const bodyCtx = surfaceContext(body);
    bodyCtx.save();
    bodyCtx.scale(pxPerUnit, pxPerUnit);
    bodyCtx.translate(-LAYER_MIN_X, -LAYER_MIN_Y);
    paintBody(bodyCtx, view, pose, skeleton);
    bodyCtx.restore();

    const outCtx = surfaceContext(outlined);
    const outlinePx = Math.max(1, Math.round((OUTLINE_CELL_PX * pxPerUnit) / AUTHORED_PX_PER_TILE));
    for (let i = 0; i < OUTLINE_SAMPLES; i++) {
      const angle = (i / OUTLINE_SAMPLES) * TWO_PI;
      outCtx.drawImage(
        body,
        Math.round(Math.cos(angle) * outlinePx),
        Math.round(Math.sin(angle) * outlinePx),
      );
    }
    outCtx.globalCompositeOperation = 'source-in';
    outCtx.fillStyle = rgba(SILHOUETTE_OUTLINE, SILHOUETTE_OUTLINE_ALPHA);
    outCtx.fillRect(0, 0, width, height);
    outCtx.globalCompositeOperation = 'source-over';
    outCtx.drawImage(body, 0, 0);

    ctx.save();
    try {
      ctx.globalAlpha = outerAlpha;
      ctx.translate(LAYER_MIN_X, LAYER_MIN_Y);
      ctx.scale(1 / pxPerUnit, 1 / pxPerUnit);
      ctx.drawImage(outlined, 0, 0);
    } finally {
      ctx.restore();
    }
  } finally {
    releaseSurface(body);
    releaseSurface(outlined);
  }

  paintOverlay(ctx, view, pose, skeleton);
}

// ── Loosed bolt ──────────────────────────────────────────────────────────────

const LOOSED_HEAD_LENGTH = 0.085;
const LOOSED_HEAD_HALF_WIDTH = 0.034;
const LOOSED_SHAFT_HALF_WIDTH = 0.011;
const LOOSED_FLETCH_LENGTH = 0.12;
const LOOSED_FLETCH_HALF_WIDTH = 0.05;
const LOOSED_OUTLINE = 0.012;
const LOOSED_HEAD_NOTCH_SHARE = 0.78;
const LOOSED_FLETCH_NOTCH = 0.02;
const NOCK_RADIUS_SHARE = 1.1;
const HEAD_GLINT_INSET = 0.01;
const HEAD_GLINT_LIFT = 0.004;
const HEAD_GLINT_REACH = 0.85;
const HEAD_GLINT_SPREAD = 0.6;
const HEAD_GLINT_WIDTH = 0.008;
const SHAFT_DARK = '#6a5030';
const FLETCH_DARK = '#7c1015';
const NOCK = '#f5efe4';
const STREAK = '#f6f1e2';
const STREAKS = 3;
const STREAK_SPACING = 0.022;
const STREAK_LENGTH = 0.2;
const STREAK_WIDTH = 0.012;
const STREAK_GAP = 0.01;
const STREAK_MIN_REACH = 0.6;
const STREAK_BASE_ALPHA = 0.25;
const STREAK_FLICKER_ALPHA = 0.2;
const STREAK_REACH_SPREAD = 0.37;

function disc(ctx: Ctx, c: Pt, r: number, fill: string): void {
  ctx.beginPath();
  ctx.arc(c.x, c.y, Math.max(r, 0), 0, TWO_PI);
  ctx.fillStyle = fill;
  ctx.fill();
}

function fract(value: number): number {
  return value - Math.floor(value);
}

/** The bolt's body from its point at the origin back to its nock at -`length`, along +X. */
function paintLoosedBoltBody(ctx: Ctx, length: number): void {
  const tail = -length;
  ctx.beginPath();
  ctx.moveTo(tail + LOOSED_FLETCH_LENGTH, 0);
  ctx.lineTo(tail, -LOOSED_FLETCH_HALF_WIDTH);
  ctx.lineTo(tail + LOOSED_FLETCH_NOTCH, 0);
  ctx.lineTo(tail, LOOSED_FLETCH_HALF_WIDTH);
  ctx.closePath();
  ctx.fillStyle = FLETCH;
  ctx.fill();
  ctx.lineWidth = LOOSED_OUTLINE * HALF;
  ctx.strokeStyle = FLETCH_DARK;
  ctx.stroke();

  // Outlined so it survives on a pale floor.
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(tail, 0);
  ctx.lineTo(-LOOSED_HEAD_LENGTH * HALF, 0);
  ctx.lineWidth = LOOSED_SHAFT_HALF_WIDTH * 2 + LOOSED_OUTLINE;
  ctx.strokeStyle = SHAFT_DARK;
  ctx.stroke();
  ctx.lineWidth = LOOSED_SHAFT_HALF_WIDTH * 2;
  ctx.strokeStyle = BOLT_SHAFT;
  ctx.stroke();
  disc(ctx, pt(tail, 0), LOOSED_SHAFT_HALF_WIDTH * NOCK_RADIUS_SHARE, NOCK);

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-LOOSED_HEAD_LENGTH, -LOOSED_HEAD_HALF_WIDTH);
  ctx.lineTo(-LOOSED_HEAD_LENGTH * LOOSED_HEAD_NOTCH_SHARE, 0);
  ctx.lineTo(-LOOSED_HEAD_LENGTH, LOOSED_HEAD_HALF_WIDTH);
  ctx.closePath();
  ctx.fillStyle = STEEL_BASE;
  ctx.fill();
  ctx.lineWidth = LOOSED_OUTLINE * HALF;
  ctx.strokeStyle = STEEL_DARK;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-HEAD_GLINT_INSET, -HEAD_GLINT_LIFT);
  ctx.lineTo(-LOOSED_HEAD_LENGTH * HEAD_GLINT_REACH, -LOOSED_HEAD_HALF_WIDTH * HEAD_GLINT_SPREAD);
  ctx.lineWidth = HEAD_GLINT_WIDTH;
  ctx.strokeStyle = STRING;
  ctx.stroke();
}

/**
 * A loosed crossbow bolt in flight, seen from above: point on the origin,
 * flying along +X, `length` from point to nock. Faint streaks behind it
 * flicker with `phase` so it reads as fast even on a still frame.
 */
export function drawBolt(ctx: Ctx, length: number, phase: number): void {
  const tail = -length;
  ctx.lineCap = 'round';
  for (let i = 0; i < STREAKS; i++) {
    const offset = (i - 1) * STREAK_SPACING;
    const flicker =
      STREAK_BASE_ALPHA +
      STREAK_FLICKER_ALPHA * Math.abs(Math.sin((phase + i / STREAKS) * Math.PI));
    const reach =
      STREAK_LENGTH *
      (STREAK_MIN_REACH + (1 - STREAK_MIN_REACH) * fract(phase + i * STREAK_REACH_SPREAD));
    ctx.beginPath();
    ctx.moveTo(tail + STREAK_GAP, offset);
    ctx.lineTo(tail - reach, offset);
    ctx.lineWidth = STREAK_WIDTH;
    ctx.strokeStyle = rgba(STREAK, flicker);
    ctx.stroke();
  }
  paintLoosedBoltBody(ctx, length);
}

const SPLIT_DARK = '#2a1a0c';
const SPLIT_HALF_LENGTH = 0.05;
const SPLIT_HALF_WIDTH = 0.016;
const SPLINTER_LIGHT = '#e8c890';
const SPLINTER_REACH = 0.04;
const SPLINTER_WIDTH = 0.008;
const SPLINTER_ANGLE = deg(50);

/**
 * The same bolt driven into wood, seen from above with the entry point on the
 * origin: `buried` of its point is in the wood, so only the shaft behind it
 * shows, and a dark split with two pale splinters marks where it went in. No
 * streak — it is not moving.
 */
export function drawStuckBolt(ctx: Ctx, length: number, buried: number): void {
  fillEllipse(ctx, pt(0, 0), SPLIT_HALF_WIDTH, SPLIT_HALF_LENGTH, SPLIT_DARK);
  ctx.lineCap = 'round';
  ctx.lineWidth = SPLINTER_WIDTH;
  ctx.strokeStyle = SPLINTER_LIGHT;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(0, side * SPLIT_HALF_LENGTH * HALF);
    ctx.lineTo(
      -Math.cos(SPLINTER_ANGLE) * SPLINTER_REACH,
      side * (SPLIT_HALF_LENGTH * HALF + Math.sin(SPLINTER_ANGLE) * SPLINTER_REACH),
    );
    ctx.stroke();
  }
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(
      -length - LOOSED_FLETCH_HALF_WIDTH,
      -length,
      length + LOOSED_FLETCH_HALF_WIDTH,
      length * 2,
    );
    ctx.clip();
    ctx.translate(buried, 0);
    paintLoosedBoltBody(ctx, length);
  } finally {
    ctx.restore();
  }
}

// ── Measurements for the gates ───────────────────────────────────────────────

/**
 * The proportions that keep the otter from reading as a rat: how much wider
 * than tall the head is head-on, how thick the tail's root is against a thigh,
 * and how small the ears are against the head.
 */
export function otterSilhouetteRatios(): {
  readonly headWidthToHeight: number;
  readonly tailRootToThigh: number;
  readonly earToHeadHalfWidth: number;
} {
  const xs = FRONT_SKULL.map((p) => p.x);
  const ys = FRONT_SKULL.map((p) => p.y);
  const headWidth = Math.max(...xs) - Math.min(...xs);
  const headHeight = Math.max(...ys) - Math.min(...ys);
  return {
    headWidthToHeight: headWidth / headHeight,
    tailRootToThigh: TAIL_ROOT_WIDTH / THIGH_ROOT_WIDTH,
    earToHeadHalfWidth: EAR_RADIUS / (headWidth * HALF),
  };
}
