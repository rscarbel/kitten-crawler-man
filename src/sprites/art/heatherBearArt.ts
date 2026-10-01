// Tile units, origin at the tile centre, +Y down; the profile faces +X, left side to the viewer.

import { type Pt, clamp01, lerp, mix, rgba } from './carlArt';
import { drawGroundShadow, hash1 } from './cowArt';
import { withClip } from './softShade';

type Ctx = CanvasRenderingContext2D;
type Poly = readonly Pt[];

const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;
const MIN_LENGTH = 1e-4;

export interface FootPlacement {
  /** Wrist (fore) or ankle (hind). */
  readonly x: number;
  readonly y: number;
  /** 0 is flat; positive curls the toes down and back, negative cocks them up. */
  readonly angle: number;
}

export interface HeatherPose {
  /** The barrel pivots about this point. */
  readonly hip: Pt;
  /** Negative lifts the front end (rearing). */
  readonly pitch: number;
  /** Positive drops the nose. */
  readonly neck: number;
  /** 0 shut, 1 a full roar. */
  readonly jaw: number;
  readonly foreNear: FootPlacement;
  readonly foreFar: FootPlacement;
  readonly hindNear: FootPlacement;
  readonly hindFar: FootPlacement;
  /** -1..1 */
  readonly breathe: number;
  readonly wormPhase: number;
  /** 0..1 */
  readonly swipeTrail: number;
  readonly swipeFrom: number;
}

export const HEATHER_GROUND_Y = 0.42;
export const HEATHER_REST_HIP: Pt = { x: -0.5, y: -0.17 };

/** Barrel frame: hip at the origin, +X toward the head. */
export const HEATHER_SHOULDER_LOCAL: Pt = { x: 0.96, y: -0.06 };
const ATLAS_LOCAL: Pt = { x: 1.26, y: -0.12 };
const FAR_ROOT_OFFSET: Pt = { x: -0.04, y: -0.03 };

const HEAD_REST_ANGLE = 0.32;

const UPPER_ARM = 0.31;
const FOREARM = 0.33;
const THIGH = 0.33;
const SHIN = 0.33;
const WRIST_HEIGHT = 0.065;
const ANKLE_HEIGHT = 0.06;

export const FORE_NEAR_REST: Pt = { x: 0.5, y: HEATHER_GROUND_Y - WRIST_HEIGHT };
export const FORE_FAR_REST: Pt = { x: 0.6, y: HEATHER_GROUND_Y - WRIST_HEIGHT };
export const HIND_NEAR_REST: Pt = { x: -0.58, y: HEATHER_GROUND_Y - ANKLE_HEIGHT };
export const HIND_FAR_REST: Pt = { x: -0.47, y: HEATHER_GROUND_Y - ANKLE_HEIGHT };

/** Toe contact in the foot's frame; a rolling foot pivots on it. */
export const FORE_TOE_LOCAL: Pt = { x: 0.14, y: WRIST_HEIGHT };
export const HIND_TOE_LOCAL: Pt = { x: 0.19, y: ANKLE_HEIGHT };

/** [x, y, shag] — shag is the tuft length at that point. */
const BARREL_OUTLINE: readonly (readonly [number, number, number])[] = [
  [0.74, -0.52, 0.025],
  [0.5, -0.43, 0.025],
  [0.22, -0.34, 0.025],
  [-0.06, -0.37, 0.025],
  [-0.3, -0.25, 0.03],
  [-0.35, -0.04, 0.035],
  [-0.22, 0.14, 0.045],
  [0.1, 0.2, 0.06],
  [0.5, 0.23, 0.065],
  [0.86, 0.21, 0.055],
  [1.1, 0.12, 0.045],
  [1.17, -0.06, 0.035],
  [1.0, -0.36, 0.03],
];

const BREATH_SWELL = 0.012;

/** Head frame: atlas at the origin, +X down the muzzle. [x, y, shag]. */
const SKULL_OUTLINE: readonly (readonly [number, number, number])[] = [
  [-0.05, -0.12, 0.03],
  [0.08, -0.165, 0.015],
  [0.2, -0.15, 0.008],
  [0.28, -0.095, 0.004],
  [0.38, -0.075, 0.002],
  [0.45, -0.058, 0],
  [0.48, -0.015, 0],
  [0.455, 0.03, 0],
  [0.37, 0.05, 0.002],
  [0.24, 0.06, 0.006],
  [0.12, 0.1, 0.03],
  [-0.02, 0.11, 0.04],
  [-0.1, 0.02, 0.035],
];

const JAW_OUTLINE: readonly (readonly [number, number, number])[] = [
  [0.16, 0.05, 0.004],
  [0.32, 0.055, 0],
  [0.4, 0.06, 0],
  [0.39, 0.09, 0.004],
  [0.29, 0.11, 0.012],
  [0.16, 0.115, 0.02],
];
const JAW_HINGE: Pt = { x: 0.16, y: 0.05 };
const JAW_OPEN_MAX = 0.62;

const NECK_BARREL_TOP: Pt = { x: 0.82, y: -0.42 };
const NECK_BARREL_FRONT: Pt = { x: 1.14, y: 0.08 };
const NECK_HEAD_TOP: Pt = { x: -0.02, y: -0.13 };
const NECK_HEAD_THROAT: Pt = { x: 0.1, y: 0.1 };
const NECK_TOP_SHAG = 0.025;
const NECK_THROAT_SHAG = 0.06;

const SHOULDER_MASS_CENTRE: Pt = { x: 0.92, y: -0.14 };
const SHOULDER_MASS_RX = 0.2;
const SHOULDER_MASS_RY = 0.29;
const SHOULDER_MASS_TILT = -0.35;
const SHOULDER_FOLLOW = 0.35;

const HAUNCH_CENTRE: Pt = { x: -0.06, y: -0.04 };
const HAUNCH_RX = 0.27;
const HAUNCH_RY = 0.28;
const HAUNCH_TILT = 0.3;
const HAUNCH_FOLLOW = 0.3;

const EAR_CENTRE: Pt = { x: 0.02, y: -0.18 };
const EAR_RADIUS = 0.064;
const FAR_EAR_OFFSET: Pt = { x: 0.06, y: -0.005 };

interface FurTones {
  readonly highlight: string;
  readonly light: string;
  readonly mid: string;
  readonly shadow: string;
  readonly deep: string;
}

const NEAR_FUR: FurTones = {
  highlight: '#b48a5a',
  light: '#8a643f',
  mid: '#66462a',
  shadow: '#45301d',
  deep: '#2c1e13',
};

const FAR_SIDE_DARKEN = 0.45;
const FAR_FUR: FurTones = {
  highlight: mix(NEAR_FUR.light, NEAR_FUR.deep, FAR_SIDE_DARKEN),
  light: mix(NEAR_FUR.mid, NEAR_FUR.deep, FAR_SIDE_DARKEN),
  mid: mix(NEAR_FUR.shadow, NEAR_FUR.deep, FAR_SIDE_DARKEN),
  shadow: mix(NEAR_FUR.deep, '#000000', FAR_SIDE_DARKEN),
  deep: '#120b07',
};

const MUZZLE_FUR: FurTones = {
  highlight: '#c8a77a',
  light: '#a8845a',
  mid: '#87653f',
  shadow: '#5e4329',
  deep: '#3a2818',
};

const INK = '#170e08';
const INK_WIDTH = 0.032;
const NOSE = '#1c1410';
const NOSE_SHINE = '#6f625a';
const MOUTH = '#3a1210';
const TOOTH = '#ece4cf';
const CLAW = '#d9ccb0';
const CLAW_SHADE = '#8f8169';
const PAD = '#2a201c';
const BONE = '#d4c8a8';
const BONE_SHADE = '#9d917a';
const RAW_FLESH = '#3e1813';
const SOCKET = '#120c0a';
const SOCKET_GLINT = '#8a5a2a';
const WORM = '#f3ead8';
const WORM_SHADE = '#b8ae99';
const WORM_HEAD = '#d98f86';
const TRAIL = '#f2ead6';

/** Light comes from the upper left, so lit bands hug the top and back edges. */
interface BandShifts {
  readonly highlight: Pt;
  readonly light: Pt;
  readonly shadow: Pt;
  readonly deep: Pt;
}

const BARREL_BANDS: BandShifts = {
  highlight: { x: 0.02, y: 0.035 },
  light: { x: 0.06, y: 0.13 },
  shadow: { x: -0.05, y: -0.2 },
  deep: { x: -0.02, y: -0.07 },
};

const HAUNCH_SHADOW_SHIFT: Pt = { x: -0.11, y: -0.17 };

const MASS_BANDS: BandShifts = {
  highlight: { x: 0.02, y: 0.03 },
  light: { x: 0.05, y: 0.1 },
  shadow: { x: -0.06, y: -0.15 },
  deep: { x: -0.025, y: -0.05 },
};

const LEG_BANDS: BandShifts = {
  highlight: { x: 0.025, y: 0.015 },
  light: { x: 0.05, y: 0.03 },
  shadow: { x: -0.06, y: -0.02 },
  deep: { x: -0.025, y: -0.01 },
};

const HEAD_BANDS: BandShifts = {
  highlight: { x: 0.015, y: 0.025 },
  light: { x: 0.03, y: 0.065 },
  shadow: { x: -0.02, y: -0.08 },
  deep: { x: -0.01, y: -0.03 },
};

const TUFT_SPACING = 0.022;
const TUFT_LEAN = 0.9;
const BAND_TUFT_SHARE = 0.75;
const SPLINE_STEPS = 8;
const TUFT_JITTER = 0.5;

function add(a: Pt, b: Pt): Pt {
  return { x: a.x + b.x, y: a.y + b.y };
}

function sub(a: Pt, b: Pt): Pt {
  return { x: a.x - b.x, y: a.y - b.y };
}

function scale(p: Pt, k: number): Pt {
  return { x: p.x * k, y: p.y * k };
}

function rotate(p: Pt, angle: number): Pt {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

function fromAngle(angle: number, length: number): Pt {
  return { x: Math.cos(angle) * length, y: Math.sin(angle) * length };
}

function signedArea(pts: Poly): number {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/** One winding for every polygon, so a nonzero union fills without holes. */
function wound(pts: Poly): Poly {
  return signedArea(pts) >= 0 ? pts : [...pts].reverse();
}

const JOINT_LOCK_MARGIN = 0.002;

/** `bend` +1 breaks clockwise of root→foot (an elbow), -1 counter-clockwise (a knee). */
function solveJoint(root: Pt, foot: Pt, upper: number, lower: number, bend: number): Pt {
  const d = sub(foot, root);
  const dist = Math.max(
    MIN_LENGTH,
    Math.min(Math.hypot(d.x, d.y), upper + lower - JOINT_LOCK_MARGIN),
  );
  const base = Math.atan2(d.y, d.x);
  const cosA = (dist * dist + upper * upper - lower * lower) / (2 * dist * upper);
  const angle = Math.acos(Math.max(-1, Math.min(1, cosA)));
  return add(root, fromAngle(base + angle * bend, upper));
}

interface ShagPt {
  readonly x: number;
  readonly y: number;
  readonly shag: number;
}

function catmull(a: number, b: number, c: number, d: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  const CATMULL_HALF = 0.5;
  return (
    CATMULL_HALF *
    (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
  );
}

function smoothClosed(anchors: readonly ShagPt[]): ShagPt[] {
  const out: ShagPt[] = [];
  const n = anchors.length;
  for (let i = 0; i < n; i++) {
    const p0 = anchors[(i - 1 + n) % n];
    const p1 = anchors[i];
    const p2 = anchors[(i + 1) % n];
    const p3 = anchors[(i + 2) % n];
    for (let s = 0; s < SPLINE_STEPS; s++) {
      const t = s / SPLINE_STEPS;
      out.push({
        x: catmull(p0.x, p1.x, p2.x, p3.x, t),
        y: catmull(p0.y, p1.y, p2.y, p3.y, t),
        shag: lerp(p1.shag, p2.shag, t),
      });
    }
  }
  return out;
}

const MIN_RESAMPLED = 4;

function resample(dense: readonly ShagPt[], spacing: number): ShagPt[] {
  const n = dense.length;
  const lengths: number[] = [0];
  for (let i = 0; i < n; i++) {
    const a = dense[i];
    const b = dense[(i + 1) % n];
    lengths.push(lengths[i] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = lengths[n];
  // An even count keeps the tuft/notch alternation unbroken across the seam.
  const count = Math.max(MIN_RESAMPLED, 2 * Math.round(total / spacing / 2));
  const out: ShagPt[] = [];
  let seg = 0;
  for (let k = 0; k < count; k++) {
    const target = (k / count) * total;
    while (seg < n - 1 && lengths[seg + 1] < target) seg++;
    const span = Math.max(MIN_LENGTH, lengths[seg + 1] - lengths[seg]);
    const t = (target - lengths[seg]) / span;
    const a = dense[seg];
    const b = dense[(seg + 1) % n];
    out.push({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), shag: lerp(a.shag, b.shag, t) });
  }
  return out;
}

const TUFT_SEED_STRIDE = 1.37;

function tufted(curve: readonly ShagPt[], flow: Pt, seed: number, share = 1): Pt[] {
  const n = curve.length;
  const orientation = signedArea(curve) >= 0 ? 1 : -1;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const p = curve[i];
    if (i % 2 === 0 || p.shag <= MIN_LENGTH) {
      out.push({ x: p.x, y: p.y });
      continue;
    }
    const prev = curve[(i - 1 + n) % n];
    const next = curve[(i + 1) % n];
    const tx = next.x - prev.x;
    const ty = next.y - prev.y;
    const tl = Math.max(MIN_LENGTH, Math.hypot(tx, ty));
    const normal = { x: (ty / tl) * orientation, y: (-tx / tl) * orientation };
    const length =
      p.shag * share * (1 - TUFT_JITTER + 2 * TUFT_JITTER * hash1(seed + i * TUFT_SEED_STRIDE));
    out.push(add(p, add(scale(normal, length), scale(flow, length * TUFT_LEAN))));
  }
  return out;
}

function furOutline(anchors: readonly ShagPt[], flow: Pt, seed: number, share = 1): Poly {
  return wound(tufted(resample(smoothClosed(anchors), TUFT_SPACING), flow, seed, share));
}

function tracePoly(ctx: Ctx, pts: Poly): void {
  if (pts.length < 3) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

function traceAll(ctx: Ctx, polys: readonly Poly[], shift: Pt = { x: 0, y: 0 }): void {
  ctx.beginPath();
  for (const poly of polys)
    tracePoly(ctx, shift.x === 0 && shift.y === 0 ? poly : poly.map((p) => add(p, shift)));
}

function fillAll(ctx: Ctx, polys: readonly Poly[], color: string, shift?: Pt): void {
  ctx.fillStyle = color;
  traceAll(ctx, polys, shift);
  ctx.fill();
}

/** Stroked before the fill so only the outer edge survives. */
function inkUnder(ctx: Ctx, polys: readonly Poly[], width = INK_WIDTH): void {
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineWidth = width * 2;
  ctx.lineJoin = 'round';
  traceAll(ctx, polys);
  ctx.stroke();
  ctx.restore();
}

/** Each band is the strip a copy of the mass, shifted by that band's vector, leaves uncovered. */
function paintBands(
  ctx: Ctx,
  mass: readonly Poly[],
  edges: readonly Poly[],
  tones: FurTones,
  shifts: BandShifts,
): void {
  withClip(
    ctx,
    () => traceAll(ctx, mass),
    () => {
      fillAll(ctx, mass, tones.deep);
      fillAll(ctx, edges, tones.shadow, shifts.deep);
      fillAll(ctx, edges, tones.highlight, shifts.shadow);
      withClip(
        ctx,
        () => traceAll(ctx, edges, shifts.shadow),
        () => {
          fillAll(ctx, edges, tones.light, shifts.highlight);
          fillAll(ctx, edges, tones.mid, shifts.light);
        },
      );
    },
  );
}

const CLIP_REACH = 4;

/** One even-odd clip per shape, so overlapping shapes don't toggle back in. */
function clipOutside(ctx: Ctx, polys: readonly Poly[], shift: Pt): void {
  for (const poly of polys) {
    ctx.beginPath();
    ctx.rect(-CLIP_REACH, -CLIP_REACH, CLIP_REACH * 2, CLIP_REACH * 2);
    tracePoly(
      ctx,
      poly.map((p) => add(p, shift)),
    );
    ctx.clip('evenodd');
  }
}

function paintEdgeBand(
  ctx: Ctx,
  mass: readonly Poly[],
  edges: readonly Poly[],
  color: string,
  shift: Pt,
): void {
  withClip(
    ctx,
    () => traceAll(ctx, mass),
    () => {
      clipOutside(ctx, edges, shift);
      ctx.fillStyle = color;
      ctx.fillRect(-CLIP_REACH, -CLIP_REACH, CLIP_REACH * 2, CLIP_REACH * 2);
    },
  );
}

function paintHairs(
  ctx: Ctx,
  polys: readonly Poly[],
  color: string,
  flow: Pt,
  every: number,
  length: number,
  seed: number,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = HAIR_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  withClip(
    ctx,
    () => traceAll(ctx, polys),
    () => {
      ctx.beginPath();
      for (const poly of polys) {
        for (let i = 0; i < poly.length; i += every) {
          const p = poly[i];
          const inset = HAIR_INSET * (1 + hash1(seed + i));
          const a = { x: p.x - flow.y * inset, y: p.y + Math.abs(flow.x) * inset };
          const b = add(
            a,
            scale(flow, length * (HAIR_MIN_SHARE + hash1(seed + i * HAIR_SEED_STRIDE))),
          );
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
      }
      ctx.stroke();
    },
  );
  ctx.restore();
}

const HAIR_SEED_STRIDE = 2.1;
const HAIR_WIDTH = 0.014;
const HAIR_INSET = 0.03;
const HAIR_MIN_SHARE = 0.5;

interface Rig {
  readonly toWorld: (local: Pt) => Pt;
  readonly toHead: (local: Pt) => Pt;
  readonly headAngle: number;
  readonly flow: Pt;
  readonly foreNear: Limb;
  readonly foreFar: Limb;
  readonly hindNear: Limb;
  readonly hindFar: Limb;
}

interface Limb {
  readonly root: Pt;
  readonly joint: Pt;
  readonly end: Pt;
  readonly footAngle: number;
}

const FLOW_FALL = 0.6;
const FLOW_SCALE = 0.6;

function rigOf(pose: HeatherPose): Rig {
  const toWorld = (local: Pt): Pt => add(pose.hip, rotate(local, pose.pitch));
  const headAngle = pose.pitch + HEAD_REST_ANGLE + pose.neck;
  const atlas = toWorld(ATLAS_LOCAL);
  const toHead = (local: Pt): Pt => add(atlas, rotate(local, headAngle));
  const back = rotate({ x: -1, y: 0 }, pose.pitch);
  const flow = scale(add(back, { x: 0, y: FLOW_FALL }), FLOW_SCALE);
  const shoulder = toWorld(HEATHER_SHOULDER_LOCAL);
  const farShoulder = toWorld(add(HEATHER_SHOULDER_LOCAL, FAR_ROOT_OFFSET));
  const farHip = toWorld(FAR_ROOT_OFFSET);
  const ELBOW_BEND = 1;
  const KNEE_BEND = -1;
  const limb = (
    root: Pt,
    foot: FootPlacement,
    upper: number,
    lower: number,
    bend: number,
  ): Limb => {
    const end = { x: foot.x, y: foot.y };
    return { root, joint: solveJoint(root, end, upper, lower, bend), end, footAngle: foot.angle };
  };
  return {
    toWorld,
    toHead,
    headAngle,
    flow,
    foreNear: limb(shoulder, pose.foreNear, UPPER_ARM, FOREARM, ELBOW_BEND),
    foreFar: limb(farShoulder, pose.foreFar, UPPER_ARM, FOREARM, ELBOW_BEND),
    hindNear: limb(pose.hip, pose.hindNear, THIGH, SHIN, KNEE_BEND),
    hindFar: limb(farHip, pose.hindFar, THIGH, SHIN, KNEE_BEND),
  };
}

interface LegBuild {
  readonly rootHalf: number;
  readonly jointHalf: number;
  readonly endHalf: number;
  readonly frontShag: number;
  readonly backShag: number;
}

const FORELEG_BUILD: LegBuild = {
  rootHalf: 0.13,
  jointHalf: 0.095,
  endHalf: 0.07,
  frontShag: 0.012,
  backShag: 0.045,
};

const HINDLEG_BUILD: LegBuild = {
  rootHalf: 0.16,
  jointHalf: 0.1,
  endHalf: 0.065,
  frontShag: 0.015,
  backShag: 0.035,
};

function legOutline(limb: Limb, build: LegBuild, flow: Pt, seed: number): Poly {
  const upperDir = Math.atan2(limb.joint.y - limb.root.y, limb.joint.x - limb.root.x);
  const lowerDir = Math.atan2(limb.end.y - limb.joint.y, limb.end.x - limb.joint.x);
  const jointDir = (upperDir + lowerDir) / 2;
  const side = (dir: number, half: number, s: number): Pt => fromAngle(dir - HALF_PI * s, half);
  // `s` = +1 is the leg's forward edge when it hangs down (toward +X).
  const pts: ShagPt[] = [];
  const push = (p: Pt, shag: number): void => {
    pts.push({ x: p.x, y: p.y, shag });
  };
  push(add(limb.root, side(upperDir, build.rootHalf, 1)), build.frontShag);
  push(add(limb.joint, side(jointDir, build.jointHalf, 1)), build.frontShag);
  push(add(limb.end, side(lowerDir, build.endHalf, 1)), build.frontShag);
  push(add(limb.end, fromAngle(lowerDir, build.endHalf * END_CAP)), 0);
  push(add(limb.end, side(lowerDir, build.endHalf, -1)), build.backShag);
  push(add(limb.joint, side(jointDir, build.jointHalf, -1)), build.backShag);
  push(add(limb.root, side(upperDir, build.rootHalf, -1)), build.backShag);
  push(add(limb.root, fromAngle(upperDir, -build.rootHalf * ROOT_CAP)), 0);
  return furOutline(pts, flow, seed);
}

const END_CAP = 0.6;
const ROOT_CAP = 0.9;

/** Origin at the wrist, +X along the ground. */
const FOREPAW_OUTLINE: Poly = [
  { x: -0.065, y: -0.045 },
  { x: 0.03, y: -0.06 },
  { x: 0.12, y: -0.035 },
  { x: 0.16, y: 0.01 },
  { x: 0.145, y: 0.065 },
  { x: 0.02, y: 0.068 },
  { x: -0.06, y: 0.05 },
  { x: -0.08, y: 0.0 },
];

/** Origin at the ankle, +X along the ground. */
const HINDFOOT_OUTLINE: Poly = [
  { x: -0.06, y: -0.04 },
  { x: 0.06, y: -0.045 },
  { x: 0.17, y: -0.02 },
  { x: 0.215, y: 0.02 },
  { x: 0.2, y: 0.062 },
  { x: 0.0, y: 0.064 },
  { x: -0.07, y: 0.045 },
  { x: -0.085, y: 0.0 },
];

/** [x, y, length] in the foot's frame. */
const FORE_CLAWS: readonly (readonly [number, number, number])[] = [
  [0.15, 0.0, 0.085],
  [0.155, 0.025, 0.08],
  [0.145, 0.04, 0.07],
];
const HIND_CLAWS: readonly (readonly [number, number, number])[] = [
  [0.205, 0.01, 0.045],
  [0.205, 0.035, 0.042],
  [0.19, 0.055, 0.036],
];
const CLAW_HOOK = 0.3;
const CLAW_ROOT_HALF = 0.016;

const CLAW_BEND_ALONG = 0.7;
const CLAW_BEND_RISE = 0.05;
const CLAW_BEND_TAPER = 0.5;
const CLAW_UNDER_ROOT = 0.6;
const CLAW_UNDER_BEND = 0.4;
const CLAW_INK = 0.9;
const CLAW_UNDER_WIDTH = 0.5;
const SOLE_WIDTH = 1.6;

function footPoly(outline: Poly, at: Pt, angle: number): Poly {
  return wound(outline.map((p) => add(at, rotate(p, angle))));
}

function paintClaws(
  ctx: Ctx,
  at: Pt,
  angle: number,
  claws: readonly (readonly [number, number, number])[],
  dim: number,
): void {
  for (const [cx, cy, length] of claws) {
    const root = add(at, rotate({ x: cx, y: cy }, angle));
    const tip = add(at, rotate({ x: cx + length, y: cy + length * CLAW_HOOK }, angle));
    const bend = add(
      at,
      rotate({ x: cx + length * CLAW_BEND_ALONG, y: cy - length * CLAW_BEND_RISE }, angle),
    );
    const across = rotate({ x: 0, y: CLAW_ROOT_HALF }, angle);
    ctx.beginPath();
    ctx.moveTo(root.x - across.x, root.y - across.y);
    ctx.quadraticCurveTo(
      bend.x - across.x * CLAW_BEND_TAPER,
      bend.y - across.y * CLAW_BEND_TAPER,
      tip.x,
      tip.y,
    );
    ctx.quadraticCurveTo(
      bend.x + across.x * CLAW_BEND_TAPER,
      bend.y + across.y * CLAW_BEND_TAPER,
      root.x + across.x,
      root.y + across.y,
    );
    ctx.closePath();
    ctx.strokeStyle = INK;
    ctx.lineWidth = INK_WIDTH * CLAW_INK;
    ctx.stroke();
    ctx.fillStyle = mix(CLAW, CLAW_SHADE, dim);
    ctx.fill();
    ctx.strokeStyle = mix(CLAW_SHADE, INK, dim);
    ctx.lineWidth = INK_WIDTH * CLAW_UNDER_WIDTH;
    ctx.beginPath();
    ctx.moveTo(root.x + across.x * CLAW_UNDER_ROOT, root.y + across.y * CLAW_UNDER_ROOT);
    ctx.quadraticCurveTo(
      bend.x + across.x * CLAW_UNDER_BEND,
      bend.y + across.y * CLAW_UNDER_BEND,
      tip.x,
      tip.y,
    );
    ctx.stroke();
  }
}

function paintSole(ctx: Ctx, outline: Poly, at: Pt, angle: number, show: number): void {
  if (show <= 0) return;
  const sole = outline.filter((p) => p.y > 0).map((p) => add(at, rotate(p, angle)));
  ctx.save();
  ctx.strokeStyle = rgba(PAD, clamp01(show));
  ctx.lineWidth = INK_WIDTH * SOLE_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  sole.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();
  ctx.restore();
}

interface LegMass {
  readonly outline: Poly;
  readonly edge: Poly;
  readonly under: readonly Poly[];
  readonly shadowShift: Pt;
}

interface LegShapes {
  readonly leg: Poly;
  readonly foot: Poly;
}

function legShapes(
  limb: Limb,
  build: LegBuild,
  isFore: boolean,
  flow: Pt,
  seed: number,
): LegShapes {
  return {
    leg: legOutline(limb, build, flow, seed),
    foot: footPoly(isFore ? FOREPAW_OUTLINE : HINDFOOT_OUTLINE, limb.end, limb.footAngle),
  };
}

function stockingQuad(limb: Limb, build: LegBuild): Poly {
  const dir = Math.atan2(limb.end.y - limb.joint.y, limb.end.x - limb.joint.x);
  const along = fromAngle(dir, 1);
  const across = fromAngle(dir + HALF_PI, build.jointHalf * STOCKING_WIDEN);
  const top = sub(limb.joint, scale(along, build.jointHalf * STOCKING_RISE));
  const bottom = add(limb.end, scale(along, STOCKING_PAST_FOOT));
  return [add(top, across), add(bottom, across), sub(bottom, across), sub(top, across)];
}
const STOCKING_WIDEN = 3;
const STOCKING_RISE = 0.6;
const STOCKING_PAST_FOOT = 0.2;
const STOCKING_ALPHA = 0.32;

/** Bands the leg together with its parent mass so the light runs down them as one form. */
function paintLeg(
  ctx: Ctx,
  limb: Limb,
  build: LegBuild,
  isFore: boolean,
  tones: FurTones,
  shapes: LegShapes,
  mass: LegMass | null,
): void {
  const limbParts = [shapes.leg, shapes.foot];
  if (mass === null) {
    fillAll(ctx, limbParts, tones.mid);
    paintBands(ctx, limbParts, limbParts, tones, LEG_BANDS);
  } else {
    // Over the barrel the limb keeps the barrel's light and adds only its own shadow side.
    withClip(
      ctx,
      () => traceAll(ctx, limbParts),
      () => {
        clipOutside(ctx, mass.under, { x: 0, y: 0 });
        fillAll(ctx, limbParts, tones.mid);
        paintBands(ctx, limbParts, limbParts, tones, LEG_BANDS);
      },
    );
    const union = [mass.outline, ...limbParts];
    const unionEdges = [mass.edge, ...limbParts];
    paintEdgeBand(ctx, union, unionEdges, tones.shadow, mass.shadowShift);
    paintEdgeBand(ctx, union, unionEdges, tones.deep, MASS_BANDS.deep);
  }
  withClip(
    ctx,
    () => traceAll(ctx, [shapes.leg, shapes.foot]),
    () => fillAll(ctx, [stockingQuad(limb, build)], rgba(tones.deep, STOCKING_ALPHA)),
  );
  const dim = tones === NEAR_FUR ? 0 : FAR_CLAW_DIM;
  const outline = isFore ? FOREPAW_OUTLINE : HINDFOOT_OUTLINE;
  paintSole(ctx, outline, limb.end, limb.footAngle, limb.footAngle * SOLE_SHOW_RATE);
  paintClaws(ctx, limb.end, limb.footAngle, isFore ? FORE_CLAWS : HIND_CLAWS, dim);
}

const FAR_CLAW_DIM = 0.55;
const SOLE_SHOW_RATE = 1.6;

/** [x, y, length] in the paw's frame. */
const WORMS: readonly (readonly [number, number, number])[] = [
  [0.09, -0.035, 0.16],
  [0.03, -0.05, 0.12],
  [0.13, -0.02, 0.11],
];
const WORM_SEGMENTS = 12;
const WORM_WIDTH = 0.022;
const WORM_WRITHE = 0.03;
const WORM_WAVES = 1.3;
const WORM_SWAY = 0.35;
const WORM_STAGGER = 2.1;
const WORM_HANG = -1.75;

const WORM_INK = 1.4;
const WORM_LIT_OFFSET: Pt = { x: 0.2, y: 0.25 };
const WORM_LIT_SHARE = 0.5;
const WORM_HEAD_SHARE = 0.55;

function paintWorms(ctx: Ctx, paw: Pt, pawAngle: number, phase: number, dim: number): void {
  WORMS.forEach(([wx, wy, length], i) => {
    const root = add(paw, rotate({ x: wx, y: wy }, pawAngle));
    const lean = WORM_HANG + Math.sin(phase + i * WORM_STAGGER) * WORM_SWAY;
    const axis = fromAngle(lean, 1);
    const across = fromAngle(lean + HALF_PI, 1);
    const pts: Pt[] = [];
    for (let k = 0; k <= WORM_SEGMENTS; k++) {
      const u = k / WORM_SEGMENTS;
      const wave = Math.sin(u * WORM_WAVES * TWO_PI - phase - i * WORM_STAGGER) * WORM_WRITHE * u;
      pts.push(add(root, add(scale(axis, u * length), scale(across, wave))));
    }
    const p = pts[pts.length - 1];
    const trace = (): void => {
      ctx.beginPath();
      pts.forEach((q, k) => (k === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y)));
    };
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    trace();
    ctx.strokeStyle = INK;
    ctx.lineWidth = WORM_WIDTH + INK_WIDTH * WORM_INK;
    ctx.stroke();
    trace();
    ctx.strokeStyle = mix(WORM_SHADE, INK, dim);
    ctx.lineWidth = WORM_WIDTH;
    ctx.stroke();
    ctx.translate(-WORM_WIDTH * WORM_LIT_OFFSET.x, -WORM_WIDTH * WORM_LIT_OFFSET.y);
    trace();
    ctx.strokeStyle = mix(WORM, WORM_SHADE, dim);
    ctx.lineWidth = WORM_WIDTH * WORM_LIT_SHARE;
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = mix(WORM_HEAD, INK, dim);
    ctx.beginPath();
    ctx.arc(p.x, p.y, WORM_WIDTH * WORM_HEAD_SHARE, 0, TWO_PI);
    ctx.fill();
  });
}

function headPolys(
  rig: Rig,
  jaw: number,
  flow: Pt,
  seed: number,
  share = 1,
): { skull: Poly; jaw: Poly } {
  const jawAngle = jaw * JAW_OPEN_MAX;
  const skull = SKULL_OUTLINE.map(([x, y, shag]) => ({ ...rig.toHead({ x, y }), shag }));
  const lower = JAW_OUTLINE.map(([x, y, shag]) => {
    const local = add(JAW_HINGE, rotate(sub({ x, y }, JAW_HINGE), jawAngle));
    return { ...rig.toHead(local), shag };
  });
  return {
    skull: furOutline(skull, flow, seed, share),
    jaw: furOutline(lower, flow, seed + 1, share),
  };
}

function earPoly(rig: Rig, centre: Pt, flow: Pt, seed: number): Poly {
  const pts: ShagPt[] = [];
  const EAR_STEPS = 8;
  for (let i = 0; i < EAR_STEPS; i++) {
    const a = (i / EAR_STEPS) * TWO_PI;
    const local = add(centre, {
      x: Math.cos(a) * EAR_RADIUS,
      y: Math.sin(a) * EAR_RADIUS * EAR_SQUASH,
    });
    pts.push({ ...rig.toHead(local), shag: EAR_SHAG });
  }
  return furOutline(pts, flow, seed);
}
const EAR_SQUASH = 0.9;
const EAR_SHAG = 0.012;

const MUZZLE_PATCH: readonly (readonly [number, number])[] = [
  [0.27, -0.1],
  [0.38, -0.08],
  [0.47, -0.05],
  [0.47, 0.02],
  [0.37, 0.055],
  [0.26, 0.06],
  [0.22, 0.0],
];

const SKULL_PATCH: readonly (readonly [number, number])[] = [
  [0.05, -0.125],
  [0.14, -0.14],
  [0.23, -0.12],
  [0.255, -0.075],
  [0.235, -0.035],
  [0.17, -0.02],
  [0.1, 0.0],
  [0.04, -0.03],
  [0.07, -0.08],
];
const SKULL_PATCH_TEAR = 0.014;
const EYE_SOCKET: Pt = { x: 0.195, y: -0.078 };
const EYE_SOCKET_RX = 0.058;
const EYE_SOCKET_RY = 0.044;
const CHEEKBONE_FROM: Pt = { x: 0.06, y: -0.045 };
const CHEEKBONE_TO: Pt = { x: 0.17, y: -0.035 };
const MOLARS: readonly Pt[] = [
  { x: 0.11, y: -0.012 },
  { x: 0.14, y: -0.01 },
];
const MOLAR_SIZE = 0.016;

const NOSE_CENTRE: Pt = { x: 0.455, y: -0.022 };
const NOSE_RX = 0.04;
const NOSE_RY = 0.03;
const NOSTRIL: Pt = { x: 0.468, y: -0.01 };

const FANG_UPPER: Pt = { x: 0.35, y: 0.05 };
const FANG_LOWER: Pt = { x: 0.365, y: 0.06 };
const FANG_LENGTH = 0.05;

const TEAR_SEED_STRIDE = 3.3;
const TEAR_VERTICAL_SHARE = 0.7;

function tearOf(points: readonly (readonly [number, number])[], seed: number): Pt[] {
  return points.map(([x, y], i) => {
    const push = (hash1(seed + i * TEAR_SEED_STRIDE) * 2 - 1) * SKULL_PATCH_TEAR;
    return { x: x + push, y: y + push * TEAR_VERTICAL_SHARE };
  });
}

const GAPE_UPPER_FRONT: Pt = { x: 0.43, y: 0.035 };
const GAPE_LOWER_FRONT: Pt = { x: 0.41, y: 0.055 };
const FANG_RAKE = HALF_PI * 0.9;
const FANG_ROOT_SHARE = 0.3;
const FANG_INK = 0.7;
const INNER_EAR_OFFSET: Pt = { x: 0.012, y: 0.01 };
const INNER_EAR_RX = 0.5;
const INNER_EAR_RY = 0.55;
const NOSE_SHINE_OFFSET: Pt = { x: -0.01, y: -0.014 };
const NOSE_SHINE_RX = 0.45;
const NOSE_SHINE_RY = 0.3;
const NOSTRIL_SHARE = 0.35;
const LIP_FRONT: Pt = { x: 0.44, y: 0.035 };
const LIP_SAG: Pt = { x: 0.3, y: 0.045 };
const LIP_CORNER: Pt = { x: 0.2, y: 0.03 };
const RAW_RIM_WIDTH = 1.5;
const SOCKET_GLINT_OFFSET: Pt = { x: 0.008, y: 0.004 };
const SOCKET_GLINT_SHARE = 0.32;
const CHEEKBONE_WIDTH = 0.8;
const MOLAR_INK = 0.4;
const MOLAR_HEIGHT_SHARE = 1.2;

function paintHead(ctx: Ctx, rig: Rig, pose: HeatherPose): void {
  const { skull, jaw } = headPolys(rig, pose.jaw, rig.flow, SEED_HEAD);
  const edges = headPolys(rig, pose.jaw, rig.flow, SEED_HEAD + EDGE_SEED_OFFSET, BAND_TUFT_SHARE);
  const ear = earPoly(rig, EAR_CENTRE, rig.flow, SEED_EAR);

  if (pose.jaw > MOUTH_SHOWS) {
    const hinge = rig.toHead(JAW_HINGE);
    const upperFront = rig.toHead(GAPE_UPPER_FRONT);
    const lowerFront = rig.toHead(
      add(JAW_HINGE, rotate(sub(GAPE_LOWER_FRONT, JAW_HINGE), pose.jaw * JAW_OPEN_MAX)),
    );
    ctx.fillStyle = MOUTH;
    ctx.beginPath();
    ctx.moveTo(hinge.x, hinge.y);
    ctx.lineTo(upperFront.x, upperFront.y);
    ctx.lineTo(lowerFront.x, lowerFront.y);
    ctx.closePath();
    ctx.fill();
    paintFang(ctx, rig, FANG_UPPER, rig.headAngle + FANG_RAKE);
    paintFang(
      ctx,
      rig,
      add(JAW_HINGE, rotate(sub(FANG_LOWER, JAW_HINGE), pose.jaw * JAW_OPEN_MAX)),
      rig.headAngle + pose.jaw * JAW_OPEN_MAX - FANG_RAKE,
    );
  }

  inkUnder(ctx, [skull, jaw, ear]);
  fillAll(ctx, [ear], NEAR_FUR.mid);
  paintBands(ctx, [ear], [ear], NEAR_FUR, HEAD_BANDS);
  const innerEar = rig.toHead(add(EAR_CENTRE, INNER_EAR_OFFSET));
  ctx.fillStyle = NEAR_FUR.deep;
  ctx.beginPath();
  ctx.ellipse(
    innerEar.x,
    innerEar.y,
    EAR_RADIUS * INNER_EAR_RX,
    EAR_RADIUS * INNER_EAR_RY,
    rig.headAngle,
    0,
    TWO_PI,
  );
  ctx.fill();

  fillAll(ctx, [skull, jaw], NEAR_FUR.mid);
  paintBands(ctx, [skull, jaw], [edges.skull, edges.jaw], NEAR_FUR, HEAD_BANDS);

  const muzzle = wound(MUZZLE_PATCH.map(([x, y]) => rig.toHead({ x, y })));
  withClip(
    ctx,
    () => traceAll(ctx, [skull]),
    () => {
      fillAll(ctx, [muzzle], MUZZLE_FUR.mid);
      paintBands(ctx, [muzzle], [muzzle], MUZZLE_FUR, HEAD_BANDS);
    },
  );
  withClip(
    ctx,
    () => traceAll(ctx, [jaw]),
    () => {
      fillAll(ctx, [jaw], MUZZLE_FUR.shadow);
      fillAll(ctx, [jaw], MUZZLE_FUR.mid, { x: 0, y: JAW_LIT_SHIFT });
    },
  );

  const nose = rig.toHead(NOSE_CENTRE);
  ctx.fillStyle = NOSE;
  ctx.beginPath();
  ctx.ellipse(nose.x, nose.y, NOSE_RX, NOSE_RY, rig.headAngle, 0, TWO_PI);
  ctx.fill();
  const shine = rig.toHead(add(NOSE_CENTRE, NOSE_SHINE_OFFSET));
  ctx.fillStyle = NOSE_SHINE;
  ctx.beginPath();
  ctx.ellipse(
    shine.x,
    shine.y,
    NOSE_RX * NOSE_SHINE_RX,
    NOSE_RY * NOSE_SHINE_RY,
    rig.headAngle,
    0,
    TWO_PI,
  );
  ctx.fill();
  const nostril = rig.toHead(NOSTRIL);
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(nostril.x, nostril.y, NOSE_RY * NOSTRIL_SHARE, 0, TWO_PI);
  ctx.fill();

  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineWidth = INK_WIDTH;
  ctx.lineCap = 'round';
  const lipA = rig.toHead(LIP_FRONT);
  const lipB = rig.toHead(LIP_SAG);
  const lipC = rig.toHead(LIP_CORNER);
  ctx.beginPath();
  ctx.moveTo(lipA.x, lipA.y);
  ctx.quadraticCurveTo(lipB.x, lipB.y, lipC.x, lipC.y);
  ctx.stroke();
  ctx.restore();

  paintSkullPatch(ctx, rig);
}

const MOUTH_SHOWS = 0.05;
const JAW_LIT_SHIFT = -0.03;

function paintFang(ctx: Ctx, rig: Rig, rootLocal: Pt, angle: number): void {
  const root = rig.toHead(rootLocal);
  const tip = add(root, fromAngle(angle, FANG_LENGTH));
  const across = fromAngle(angle + HALF_PI, FANG_LENGTH * FANG_ROOT_SHARE);
  ctx.beginPath();
  ctx.moveTo(root.x - across.x, root.y - across.y);
  ctx.lineTo(tip.x, tip.y);
  ctx.lineTo(root.x + across.x, root.y + across.y);
  ctx.closePath();
  ctx.strokeStyle = INK;
  ctx.lineWidth = INK_WIDTH * FANG_INK;
  ctx.stroke();
  ctx.fillStyle = TOOTH;
  ctx.fill();
}

function paintSkullPatch(ctx: Ctx, rig: Rig): void {
  const torn = tearOf(SKULL_PATCH, SEED_SKULL).map((p) => rig.toHead(p));
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = RAW_FLESH;
  ctx.lineWidth = INK_WIDTH * RAW_RIM_WIDTH;
  ctx.beginPath();
  tracePoly(ctx, torn);
  ctx.stroke();
  ctx.fillStyle = BONE;
  ctx.fill();
  ctx.restore();
  withClip(
    ctx,
    () => {
      ctx.beginPath();
      tracePoly(ctx, torn);
    },
    () => {
      clipOutside(ctx, [torn], rotate(BONE_SHADE_SHIFT, rig.headAngle));
      ctx.fillStyle = BONE_SHADE;
      ctx.fillRect(-CLIP_REACH, -CLIP_REACH, CLIP_REACH * 2, CLIP_REACH * 2);
    },
  );
  const socket = rig.toHead(EYE_SOCKET);
  ctx.fillStyle = SOCKET;
  ctx.beginPath();
  ctx.ellipse(
    socket.x,
    socket.y,
    EYE_SOCKET_RX,
    EYE_SOCKET_RY,
    rig.headAngle - SOCKET_TILT,
    0,
    TWO_PI,
  );
  ctx.fill();
  const glint = rig.toHead(add(EYE_SOCKET, SOCKET_GLINT_OFFSET));
  ctx.fillStyle = SOCKET_GLINT;
  ctx.beginPath();
  ctx.arc(glint.x, glint.y, EYE_SOCKET_RY * SOCKET_GLINT_SHARE, 0, TWO_PI);
  ctx.fill();
  const c0 = rig.toHead(CHEEKBONE_FROM);
  const c1 = rig.toHead(CHEEKBONE_TO);
  ctx.save();
  ctx.strokeStyle = BONE_SHADE;
  ctx.lineWidth = INK_WIDTH * CHEEKBONE_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(c0.x, c0.y);
  ctx.lineTo(c1.x, c1.y);
  ctx.stroke();
  ctx.restore();
  for (const m of MOLARS) {
    const p = rig.toHead(m);
    ctx.fillStyle = TOOTH;
    ctx.strokeStyle = BONE_SHADE;
    ctx.lineWidth = INK_WIDTH * MOLAR_INK;
    ctx.beginPath();
    ctx.rect(
      p.x - MOLAR_SIZE / 2,
      p.y - MOLAR_SIZE / 2,
      MOLAR_SIZE,
      MOLAR_SIZE * MOLAR_HEIGHT_SHARE,
    );
    ctx.fill();
    ctx.stroke();
  }
}
const SOCKET_TILT = 0.3;
const BONE_SHADE_SHIFT: Pt = { x: -0.012, y: -0.03 };

function barrelPoly(rig: Rig, pose: HeatherPose, seed: number, share = 1): Poly {
  const swell = pose.breathe * BREATH_SWELL;
  const pts = BARREL_OUTLINE.map(([x, y, shag]) => ({
    ...rig.toWorld({ x, y: y > 0 ? y + swell : y }),
    shag,
  }));
  return furOutline(pts, rig.flow, seed, share);
}

function neckPoly(rig: Rig, seed: number, share = 1): Poly {
  const pts: ShagPt[] = [
    { ...rig.toWorld(NECK_BARREL_TOP), shag: NECK_TOP_SHAG },
    { ...rig.toHead(NECK_HEAD_TOP), shag: NECK_TOP_SHAG },
    { ...rig.toHead(NECK_HEAD_THROAT), shag: NECK_THROAT_SHAG },
    { ...rig.toWorld(NECK_BARREL_FRONT), shag: NECK_THROAT_SHAG },
  ];
  return furOutline(pts, rig.flow, seed, share);
}

const MASS_SHAG_LOW = 0.5;
const MASS_SHAG_REAR = 0.3;

function massPoly(
  rig: Rig,
  centre: Pt,
  rx: number,
  ry: number,
  tilt: number,
  pivot: Pt,
  swing: number,
  shag: number,
  seed: number,
  share = 1,
): Poly {
  const MASS_STEPS = 10;
  const pts: ShagPt[] = [];
  for (let i = 0; i < MASS_STEPS; i++) {
    const a = (i / MASS_STEPS) * TWO_PI;
    const local = add(centre, rotate({ x: Math.cos(a) * rx, y: Math.sin(a) * ry }, tilt));
    const swung = add(pivot, rotate(sub(local, pivot), swing));
    const rearLow = clamp01(
      Math.sin(a) * MASS_SHAG_LOW + MASS_SHAG_LOW - Math.cos(a) * MASS_SHAG_REAR,
    );
    pts.push({ ...rig.toWorld(swung), shag: shag * rearLow });
  }
  return furOutline(pts, rig.flow, seed, share);
}

function upperSwing(limb: Limb, pitch: number): number {
  return Math.atan2(limb.joint.y - limb.root.y, limb.joint.x - limb.root.x) - pitch - HALF_PI;
}

function shoulderPoly(rig: Rig, pose: HeatherPose, share = 1): Poly {
  return massPoly(
    rig,
    SHOULDER_MASS_CENTRE,
    SHOULDER_MASS_RX,
    SHOULDER_MASS_RY,
    SHOULDER_MASS_TILT,
    HEATHER_SHOULDER_LOCAL,
    upperSwing(rig.foreNear, pose.pitch) * SHOULDER_FOLLOW,
    SHOULDER_SHAG,
    SEED_SHOULDER + (share === 1 ? 0 : 1),
    share,
  );
}

function haunchPoly(rig: Rig, pose: HeatherPose, share = 1): Poly {
  return massPoly(
    rig,
    HAUNCH_CENTRE,
    HAUNCH_RX,
    HAUNCH_RY,
    HAUNCH_TILT,
    { x: 0, y: 0 },
    upperSwing(rig.hindNear, pose.pitch) * HAUNCH_FOLLOW,
    HAUNCH_SHAG,
    SEED_HAUNCH + (share === 1 ? 0 : 1),
    share,
  );
}
const SHOULDER_SHAG = 0.035;
const HAUNCH_SHAG = 0.03;

const TRAIL_RADII: readonly number[] = [0.6, 0.67, 0.74];
const TRAIL_WIDTH = 0.022;

function paintSwipeTrail(ctx: Ctx, rig: Rig, pose: HeatherPose): void {
  if (pose.swipeTrail <= 0) return;
  const shoulder = rig.foreNear.root;
  const to = Math.atan2(rig.foreNear.end.y - shoulder.y, rig.foreNear.end.x - shoulder.x);
  if (to <= pose.swipeFrom) return;
  ctx.save();
  ctx.lineCap = 'round';
  TRAIL_RADII.forEach((r, i) => {
    ctx.strokeStyle = rgba(TRAIL, pose.swipeTrail * (1 - i * TRAIL_FADE_PER_CLAW));
    ctx.lineWidth = TRAIL_WIDTH * (1 - i * TRAIL_FADE_PER_CLAW);
    ctx.beginPath();
    ctx.arc(shoulder.x, shoulder.y, r, pose.swipeFrom, to);
    ctx.stroke();
  });
  ctx.restore();
}
const TRAIL_FADE_PER_CLAW = 0.22;

/** Fixed per part so tufts hold still between frames. */
const SEED_BARREL = 11;
const SEED_NECK = 23;
const SEED_HEAD = 37;
const SEED_EAR = 41;
const SEED_SHOULDER = 53;
const SEED_HAUNCH = 67;
const SEED_LEG_NEAR_FORE = 71;
const SEED_LEG_NEAR_HIND = 79;
const SEED_LEG_FAR_FORE = 83;
const SEED_LEG_FAR_HIND = 89;
const SEED_SKULL = 97;
const EDGE_SEED_OFFSET = 5;

const SHADOW_RX = 1.05;
const SHADOW_RY = 0.13;
const SHADOW_REAR_SHRINK = 0.35;
const SHADOW_REAR_SHIFT = 0.25;
const REAR_FULL_PITCH = 1.1;

const HAIR_EVERY = 5;
const HAIR_LENGTH = 0.05;

export function drawHeatherBear(ctx: Ctx, pose: HeatherPose): void {
  const rig = rigOf(pose);
  const rear = clamp01(-pose.pitch / REAR_FULL_PITCH);
  drawGroundShadow(
    ctx,
    -SHADOW_REAR_SHIFT * rear,
    HEATHER_GROUND_Y,
    SHADOW_RX * (1 - SHADOW_REAR_SHRINK * rear),
    SHADOW_RY,
  );

  const hindFar = legShapes(rig.hindFar, HINDLEG_BUILD, false, rig.flow, SEED_LEG_FAR_HIND);
  const foreFar = legShapes(rig.foreFar, FORELEG_BUILD, true, rig.flow, SEED_LEG_FAR_FORE);
  inkUnder(ctx, [hindFar.leg, hindFar.foot]);
  paintLeg(ctx, rig.hindFar, HINDLEG_BUILD, false, FAR_FUR, hindFar, null);
  inkUnder(ctx, [foreFar.leg, foreFar.foot]);
  paintLeg(ctx, rig.foreFar, FORELEG_BUILD, true, FAR_FUR, foreFar, null);
  paintWorms(
    ctx,
    rig.foreFar.end,
    rig.foreFar.footAngle,
    pose.wormPhase + FAR_WORM_LAG,
    FAR_CLAW_DIM,
  );
  const farEar = earPoly(rig, add(EAR_CENTRE, FAR_EAR_OFFSET), rig.flow, SEED_EAR + 1);
  inkUnder(ctx, [farEar]);
  fillAll(ctx, [farEar], FAR_FUR.mid);

  const barrel = barrelPoly(rig, pose, SEED_BARREL);
  const neck = neckPoly(rig, SEED_NECK);
  const body = [barrel, neck];
  const bodyEdges = [
    barrelPoly(rig, pose, SEED_BARREL + EDGE_SEED_OFFSET, BAND_TUFT_SHARE),
    neckPoly(rig, SEED_NECK + EDGE_SEED_OFFSET, BAND_TUFT_SHARE),
  ];
  const haunch = haunchPoly(rig, pose);
  const shoulder = shoulderPoly(rig, pose);
  const hindNear = legShapes(rig.hindNear, HINDLEG_BUILD, false, rig.flow, SEED_LEG_NEAR_HIND);
  const foreNear = legShapes(rig.foreNear, FORELEG_BUILD, true, rig.flow, SEED_LEG_NEAR_FORE);

  // One ink pass for the whole near silhouette, so parts show no seams.
  inkUnder(ctx, [
    ...body,
    haunch,
    shoulder,
    hindNear.leg,
    hindNear.foot,
    foreNear.leg,
    foreNear.foot,
  ]);
  fillAll(ctx, body, NEAR_FUR.mid);
  paintBands(ctx, body, bodyEdges, NEAR_FUR, BARREL_BANDS);
  paintHairs(ctx, bodyEdges, NEAR_FUR.highlight, rig.flow, HAIR_EVERY, HAIR_LENGTH, SEED_BARREL);

  paintLeg(ctx, rig.hindNear, HINDLEG_BUILD, false, NEAR_FUR, hindNear, {
    outline: haunch,
    edge: haunchPoly(rig, pose, BAND_TUFT_SHARE),
    under: body,
    shadowShift: HAUNCH_SHADOW_SHIFT,
  });

  paintHead(ctx, rig, pose);

  paintLeg(ctx, rig.foreNear, FORELEG_BUILD, true, NEAR_FUR, foreNear, {
    outline: shoulder,
    edge: shoulderPoly(rig, pose, BAND_TUFT_SHARE),
    under: body,
    shadowShift: MASS_BANDS.shadow,
  });
  paintWorms(ctx, rig.foreNear.end, rig.foreNear.footAngle, pose.wormPhase, 0);

  paintSwipeTrail(ctx, rig, pose);
}

const FAR_WORM_LAG = 1.9;
