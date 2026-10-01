/**
 * Mold Lion painter. Tile units, origin at the tile's centre, +Y down; the
 * profile faces +X with the lion's left side nearest the viewer.
 */

import { type Pt, clamp01, deg, lerp, mix, rgba } from './carlArt';
import { hash1 } from './cowArt';
import { withClip } from './softShade';

type Ctx = CanvasRenderingContext2D;

export const TWO_PI = Math.PI * 2;
/** Canvas rejects negative arc radii. */
const MIN_LENGTH = 1e-4;

export const GROUND_Y = 0.4;

const COAT = '#9c8758';
const COAT_PALE = '#c9b384';
const BELLY = '#b9a273';
const MUZZLE = '#d2c094';
const MANE_HAIR = '#6e5530';
const MOLD = '#6f7d4e';
const MOLD_PALE = '#b8c48e';
const MOLD_DARK = '#4a5733';
const MOLD_FUZZ = '#dfe4c4';
const SPORE = '#d6f05a';
const SPORE_CORE = '#f6ffc0';
const INK = '#1b170e';
const NOSE = '#3b2a24';
const MOUTH = '#5a1f1c';
const FANG = '#e8dcb4';
const CLAW = '#e6dcc2';
const EYE_GLOW = '#c8f850';
const EYE_CORE = '#f2ffb8';
const LIGHT_WASH = '#fff3c8';
const SHADOW_WASH = '#1f2410';

const FAR_SIDE_SHADE = 0.42;

function add(a: Pt, b: Pt): Pt {
  return { x: a.x + b.x, y: a.y + b.y };
}

function scalePt(p: Pt, k: number): Pt {
  return { x: p.x * k, y: p.y * k };
}

function fromAngle(angle: number, length: number): Pt {
  return { x: Math.cos(angle) * length, y: Math.sin(angle) * length };
}

function rotatePt(p: Pt, angle: number): Pt {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

function shifted(pts: readonly Pt[], by: Pt): Pt[] {
  return pts.map((p) => add(p, by));
}

interface Frame2 {
  readonly origin: Pt;
  readonly angle: number;
}

function place(frame: Frame2, p: Pt): Pt {
  return add(frame.origin, rotatePt(p, frame.angle));
}

function placeAll(frame: Frame2, pts: readonly Pt[]): Pt[] {
  return pts.map((p) => place(frame, p));
}

function appendSmooth(ctx: Ctx, pts: readonly Pt[]): void {
  if (pts.length < 3) return;
  const last = pts[pts.length - 1];
  const first = pts[0];
  ctx.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2);
  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i];
    const next = pts[(i + 1) % pts.length];
    ctx.quadraticCurveTo(cur.x, cur.y, (cur.x + next.x) / 2, (cur.y + next.y) / 2);
  }
  ctx.closePath();
}

function traceSmooth(ctx: Ctx, pts: readonly Pt[]): void {
  ctx.beginPath();
  appendSmooth(ctx, pts);
}

function fillSmooth(ctx: Ctx, pts: readonly Pt[], color: string): void {
  traceSmooth(ctx, pts);
  ctx.fillStyle = color;
  ctx.fill();
}

const OVAL_STEPS = 24;

function ovalPoints(
  center: Pt,
  rx: number,
  ry: number,
  rot = 0,
  wobble = 0,
  seed = 0,
  steps = OVAL_STEPS,
): Pt[] {
  const LOBES_MAJOR = 3;
  const LOBES_MINOR = 5;
  const MINOR_SEED_RATE = 1.7;
  const MAJOR_SHARE = 0.6;
  const MINOR_SHARE = 0.4;
  const pts: Pt[] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * TWO_PI;
    const k =
      1 +
      wobble *
        (MAJOR_SHARE * Math.sin(a * LOBES_MAJOR + seed) +
          MINOR_SHARE * Math.sin(a * LOBES_MINOR - seed * MINOR_SEED_RATE));
    pts.push(add(center, rotatePt({ x: Math.cos(a) * rx * k, y: Math.sin(a) * ry * k }, rot)));
  }
  return pts;
}

const OUTSIDE_REACH = 3;

const TOWARD_LIGHT: Pt = (() => {
  const LIGHT_FORWARD = 0.35;
  const LIGHT_UP = -1;
  const length = Math.hypot(LIGHT_FORWARD, LIGHT_UP);
  return { x: LIGHT_FORWARD / length, y: LIGHT_UP / length };
})();

interface Banding {
  readonly light: number;
  readonly shadow: number;
  readonly core: number;
  readonly lightAlpha: number;
  readonly shadowAlpha: number;
  readonly coreAlpha: number;
}

const BODY_BANDING: Banding = {
  light: 0.05,
  shadow: 0.085,
  core: 0.15,
  lightAlpha: 0.34,
  shadowAlpha: 0.42,
  coreAlpha: 0.3,
};

const MUSCLE_BANDING: Banding = {
  light: 0.045,
  shadow: 0.06,
  core: 0.11,
  lightAlpha: 0.42,
  shadowAlpha: 0.5,
  coreAlpha: 0.32,
};

const LIMB_BANDING: Banding = {
  light: 0.022,
  shadow: 0.03,
  core: 0.06,
  lightAlpha: 0.32,
  shadowAlpha: 0.42,
  coreAlpha: 0.28,
};

const MANE_BANDING: Banding = {
  light: 0.05,
  shadow: 0.07,
  core: 0.14,
  lightAlpha: 0.3,
  shadowAlpha: 0.48,
  coreAlpha: 0.34,
};

const HEAD_BANDING: Banding = {
  light: 0.028,
  shadow: 0.05,
  core: 0.09,
  lightAlpha: 0.36,
  shadowAlpha: 0.44,
  coreAlpha: 0.3,
};

function fillOutside(ctx: Ctx, pts: readonly Pt[], color: string): void {
  ctx.beginPath();
  ctx.rect(-OUTSIDE_REACH, -OUTSIDE_REACH, OUTSIDE_REACH * 2, OUTSIDE_REACH * 2);
  appendSmooth(ctx, pts);
  ctx.fillStyle = color;
  ctx.fill('evenodd');
}

function shadeForm(ctx: Ctx, outline: readonly Pt[], banding: Banding, darken = 0): void {
  withClip(
    ctx,
    () => traceSmooth(ctx, outline),
    () => {
      const awayFromLight = scalePt(TOWARD_LIGHT, -banding.light);
      fillOutside(
        ctx,
        shifted(outline, awayFromLight),
        rgba(LIGHT_WASH, banding.lightAlpha * (1 - darken)),
      );
      fillOutside(
        ctx,
        shifted(outline, scalePt(TOWARD_LIGHT, banding.shadow)),
        rgba(SHADOW_WASH, banding.shadowAlpha),
      );
      fillOutside(
        ctx,
        shifted(outline, scalePt(TOWARD_LIGHT, banding.core)),
        rgba(SHADOW_WASH, banding.coreAlpha),
      );
      if (darken > 0) {
        traceSmooth(ctx, outline);
        ctx.fillStyle = rgba(SHADOW_WASH, darken);
        ctx.fill();
      }
    },
  );
}

const INK_WIDTH = 0.032;

/** Stroke before the fills so the group shares one outline. */
function inkAround(ctx: Ctx, pts: readonly Pt[], width = INK_WIDTH): void {
  traceSmooth(ctx, pts);
  ctx.strokeStyle = INK;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function crease(ctx: Ctx, pts: readonly Pt[], width: number, alpha: number, color = INK): void {
  if (pts.length < 2) return;
  const HALO_WIDTH = 2.2;
  const HALO_ALPHA = 0.35;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [scale, share] of [
    [HALO_WIDTH, HALO_ALPHA],
    [1, 1],
  ] as const) {
    ctx.strokeStyle = rgba(color, alpha * share);
    ctx.lineWidth = width * scale;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    if (pts.length === 3) ctx.quadraticCurveTo(pts[1].x, pts[1].y, pts[2].x, pts[2].y);
    else for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
  ctx.restore();
}

function dot(ctx: Ctx, p: Pt, r: number, color: string): void {
  if (r <= MIN_LENGTH) return;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, TWO_PI);
  ctx.fillStyle = color;
  ctx.fill();
}

export interface PawPose {
  readonly dx: number;
  readonly lift: number;
  /** Extra forward reach; also bares the claws. */
  readonly strike?: number;
}

export interface LionPose {
  readonly bodyX: number;
  readonly bodyY: number;
  /** Positive dips the front end. */
  readonly pitch: number;
  readonly headX: number;
  readonly headY: number;
  /** Positive is nose down. */
  readonly headPitch: number;
  readonly jawOpen: number;
  readonly foreNear: PawPose;
  readonly foreFar: PawPose;
  readonly hindNear: PawPose;
  readonly hindFar: PawPose;
  /** -1…1 */
  readonly tailSwing: number;
  readonly tailLift: number;
  /** -1…1 */
  readonly breathe: number;
  readonly maneSwell: number;
  readonly eyeOpen: number;
  readonly sporePhase: number;
}

export function restLionPose(): LionPose {
  const planted: PawPose = { dx: 0, lift: 0 };
  return {
    bodyX: 0,
    bodyY: 0,
    pitch: 0,
    headX: 0,
    headY: 0,
    headPitch: 0,
    jawOpen: 0,
    foreNear: planted,
    foreFar: planted,
    hindNear: planted,
    hindFar: planted,
    tailSwing: 0,
    tailLift: 0.3,
    breathe: 0,
    maneSwell: 0.5,
    eyeOpen: 1,
    sporePhase: 0,
  };
}

const TORSO_OUTLINE: readonly Pt[] = [
  { x: 0.37, y: -0.06 },
  { x: 0.36, y: 0.08 },
  { x: 0.28, y: 0.16 },
  { x: 0.14, y: 0.15 },
  { x: 0.02, y: 0.1 },
  { x: -0.12, y: 0.06 },
  { x: -0.24, y: 0.1 },
  { x: -0.38, y: 0.08 },
  { x: -0.46, y: -0.02 },
  { x: -0.45, y: -0.13 },
  { x: -0.37, y: -0.18 },
  { x: -0.2, y: -0.16 },
  { x: -0.02, y: -0.17 },
  { x: 0.16, y: -0.21 },
  { x: 0.3, y: -0.19 },
];

const SHOULDER_CENTER: Pt = { x: 0.2, y: -0.02 };
const SHOULDER_RX = 0.11;
const SHOULDER_RY = 0.16;
const SHOULDER_TILT = deg(-12);

const HAUNCH_CENTER: Pt = { x: -0.3, y: -0.03 };
const HAUNCH_RX = 0.16;
const HAUNCH_RY = 0.15;
const HAUNCH_TILT = deg(22);

/** Torso frame. */
const FORE_ROOT: Pt = { x: 0.22, y: 0.04 };
const HIND_ROOT: Pt = { x: -0.26, y: 0.1 };
const FAR_LEG_OFFSET: Pt = { x: -0.04, y: -0.015 };

/** World x. */
const FORE_PAW_X = 0.25;
const HIND_PAW_X = -0.29;

const FORE_UPPER = 0.17;
const FORE_LOWER = 0.17;
const HIND_UPPER = 0.15;
const HIND_LOWER = 0.14;
const WRIST_HEIGHT = 0.045;

const FORE_ROOT_HALF_WIDTH = 0.09;
const FORE_JOINT_HALF_WIDTH = 0.064;
const FORE_WRIST_HALF_WIDTH = 0.05;
const HIND_ROOT_HALF_WIDTH = 0.08;
const HIND_JOINT_HALF_WIDTH = 0.046;
const HIND_ANKLE_HALF_WIDTH = 0.038;

const PAW_RX = 0.07;
const PAW_RY = 0.036;

/** Torso frame. */
const NECK_POINT: Pt = { x: 0.36, y: -0.16 };
const TAIL_ROOT: Pt = { x: -0.44, y: -0.12 };

const BREATHE_SWELL = 0.012;

/** Seeds are fixed, never per-frame, so a patch cannot crawl across the hide. */
interface Bloom {
  readonly center: Pt;
  readonly rx: number;
  readonly ry: number;
  readonly seed: number;
}

const BODY_BLOOMS: readonly Bloom[] = [
  { center: { x: -0.08, y: -0.1 }, rx: 0.09, ry: 0.05, seed: 1.3 },
  { center: { x: 0.27, y: -0.1 }, rx: 0.12, ry: 0.1, seed: 3.8 },
  { center: { x: -0.36, y: -0.1 }, rx: 0.06, ry: 0.05, seed: 4.2 },
  { center: { x: 0.08, y: 0.05 }, rx: 0.07, ry: 0.04, seed: 7.7 },
  { center: { x: -0.2, y: 0.03 }, rx: 0.045, ry: 0.035, seed: 2.9 },
  { center: { x: 0.14, y: -0.15 }, rx: 0.05, ry: 0.03, seed: 9.1 },
];

const BLOOM_WOBBLE = 0.35;
const BLOOM_COLONIES = 4;
const BLOOM_COLONY_MIN = 0.45;
const BLOOM_COLONY_RANGE = 0.35;
const BLOOM_SCATTER = 0.7;
const BLOOM_PORES = 4;
const BLOOM_PORE_R = 0.009;
const BLOOM_FLECK_R = 0.007;
const BLOOM_FLECK_STRIDE = 3;

function colonyOutlines(bloom: Bloom): Pt[][] {
  const colonies: Pt[][] = [];
  for (let i = 0; i < BLOOM_COLONIES; i++) {
    const seed = bloom.seed + i * 6.7;
    const center = add(bloom.center, {
      x: (hash1(seed) - 0.5) * bloom.rx * BLOOM_SCATTER,
      y: (hash1(seed + 1.9) - 0.5) * bloom.ry * BLOOM_SCATTER,
    });
    const size = BLOOM_COLONY_MIN + BLOOM_COLONY_RANGE * hash1(seed + 3.3);
    colonies.push(ovalPoints(center, bloom.rx * size, bloom.ry * size, 0, BLOOM_WOBBLE, seed, 14));
  }
  return colonies;
}

function paintBloom(ctx: Ctx, bloom: Bloom, shade: number): void {
  const colonies = colonyOutlines(bloom);
  const BLOOM_EDGE_GROW = 1.12;
  for (const colony of colonies) {
    const center = centroidOf(colony);
    const edge = colony.map((p) => ({
      x: lerp(center.x, p.x, BLOOM_EDGE_GROW),
      y: lerp(center.y, p.y, BLOOM_EDGE_GROW),
    }));
    fillSmooth(ctx, edge, rgba(mix(MOLD_DARK, SHADOW_WASH, shade), 0.55));
  }
  for (const colony of colonies) fillSmooth(ctx, colony, mix(MOLD, SHADOW_WASH, shade));
  for (const colony of colonies) {
    const center = centroidOf(colony);
    for (let i = 0; i < colony.length; i += BLOOM_FLECK_STRIDE) {
      const p = colony[i];
      if (p.y > center.y) continue;
      dot(ctx, p, BLOOM_FLECK_R, mix(MOLD_FUZZ, SHADOW_WASH, shade));
    }
  }
  for (let i = 0; i < BLOOM_PORES; i++) {
    const a = hash1(bloom.seed + i * 3.1) * TWO_PI;
    const r = hash1(bloom.seed + i * 5.3) * 0.6;
    const p = add(bloom.center, { x: Math.cos(a) * bloom.rx * r, y: Math.sin(a) * bloom.ry * r });
    dot(ctx, p, BLOOM_PORE_R, mix(MOLD_DARK, SHADOW_WASH, shade));
  }
}

/** A dead-straight joint has no bend direction and flips between the two. */
const JOINT_LOCK_MARGIN = 0.002;

/** Two-bone solve; the joint always breaks toward -X, as a lion's elbow and hock do. */
function solveJoint(root: Pt, end: Pt, upper: number, lower: number): Pt {
  const dx = end.x - root.x;
  const dy = end.y - root.y;
  const dist = Math.max(
    MIN_LENGTH,
    Math.min(Math.hypot(dx, dy), upper + lower - JOINT_LOCK_MARGIN),
  );
  const base = Math.atan2(dy, dx);
  const cosA = (dist * dist + upper * upper - lower * lower) / (2 * dist * upper);
  const angle = Math.acos(Math.max(-1, Math.min(1, cosA)));
  return add(root, fromAngle(base + angle, upper));
}

function normalOf(a: Pt, b: Pt): Pt {
  const len = Math.max(MIN_LENGTH, Math.hypot(b.x - a.x, b.y - a.y));
  return { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
}

interface LegShape {
  readonly outline: Pt[];
  readonly joint: Pt;
  readonly end: Pt;
  readonly paw: Pt;
}

function legShape(
  root: Pt,
  paw: Pt,
  upper: number,
  lower: number,
  widths: { readonly root: number; readonly joint: number; readonly end: number },
  bulgeBack: number,
): LegShape {
  const end = add(paw, { x: 0, y: -WRIST_HEIGHT });
  const joint = solveJoint(root, end, upper, lower);
  const n1 = normalOf(root, joint);
  const n2 = normalOf(joint, end);
  const nj = scalePt(add(n1, n2), 0.5);
  const upperMid = scalePt(add(root, joint), 0.5);
  const lowerMid = scalePt(add(joint, end), 0.5);
  const BULGE_SPREAD = 0.55;
  const midWidth = lerp(widths.root, widths.joint, BULGE_SPREAD);
  const outline: Pt[] = [
    add(root, scalePt(n1, widths.root)),
    add(upperMid, scalePt(n1, midWidth * (1 - bulgeBack))),
    add(joint, scalePt(nj, widths.joint)),
    add(lowerMid, scalePt(n2, lerp(widths.joint, widths.end, BULGE_SPREAD))),
    add(end, scalePt(n2, widths.end)),
    add(end, { x: 0, y: widths.end }),
    add(end, scalePt(n2, -widths.end)),
    add(lowerMid, scalePt(n2, -lerp(widths.joint, widths.end, BULGE_SPREAD))),
    add(joint, scalePt(nj, -widths.joint * (1 + bulgeBack))),
    add(upperMid, scalePt(n1, -midWidth * (1 + bulgeBack))),
    add(root, scalePt(n1, -widths.root)),
    add(root, { x: 0, y: -widths.root }),
  ];
  return { outline, joint, end, paw };
}

const FORE_WIDTHS = {
  root: FORE_ROOT_HALF_WIDTH,
  joint: FORE_JOINT_HALF_WIDTH,
  end: FORE_WRIST_HALF_WIDTH,
} as const;
const HIND_WIDTHS = {
  root: HIND_ROOT_HALF_WIDTH,
  joint: HIND_JOINT_HALF_WIDTH,
  end: HIND_ANKLE_HALF_WIDTH,
} as const;
const FORE_ELBOW_BULGE = 0.35;
const HIND_GASKIN_BULGE = -0.25;

function pawOutline(paw: Pt, lift: number): Pt[] {
  const CURL = deg(28);
  const CURL_SHORTEN = 0.25;
  const curl = clamp01(lift / PAW_LIFT_FOR_FULL_CURL);
  const center = add(paw, { x: PAW_RX * 0.35, y: -PAW_RY });
  return ovalPoints(center, PAW_RX * (1 - curl * CURL_SHORTEN), PAW_RY, curl * CURL, 0, 0, 16);
}

const PAW_LIFT_FOR_FULL_CURL = 0.06;

function pawToes(ctx: Ctx, paw: Pt, shade: number): void {
  const TOE_SPACING = 0.022;
  const TOE_DEPTH = 0.024;
  const TOE_FRONT = 0.07;
  for (let i = 0; i < 2; i++) {
    const x = paw.x + TOE_FRONT - (i + 1) * TOE_SPACING;
    crease(
      ctx,
      [
        { x, y: paw.y - TOE_DEPTH },
        { x: x + 0.004, y: paw.y - 0.002 },
      ],
      0.008,
      0.55 + shade * 0.3,
    );
  }
}

function paintClaws(ctx: Ctx, paw: Pt, strike: number): void {
  if (strike <= 0) return;
  const CLAW_COUNT = 3;
  const CLAW_LENGTH = 0.045;
  const CLAW_SPACING = 0.018;
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < CLAW_COUNT; i++) {
    const root = { x: paw.x + PAW_RX * 1.1, y: paw.y - PAW_RY * 1.4 + i * CLAW_SPACING };
    const tip = add(root, { x: CLAW_LENGTH * strike, y: CLAW_LENGTH * 0.55 * strike });
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.016;
    ctx.beginPath();
    ctx.moveTo(root.x, root.y);
    ctx.quadraticCurveTo(tip.x, root.y, tip.x, tip.y);
    ctx.stroke();
    ctx.strokeStyle = CLAW;
    ctx.lineWidth = 0.008;
    ctx.stroke();
  }
  ctx.restore();
}

function paintLeg(ctx: Ctx, leg: LegShape, lift: number, strike: number, shade: number): void {
  const paw = pawOutline(leg.paw, lift);
  inkAround(ctx, leg.outline);
  inkAround(ctx, paw);
  const tone = mix(COAT, SHADOW_WASH, shade);
  fillSmooth(ctx, leg.outline, tone);
  fillSmooth(ctx, paw, mix(COAT_PALE, SHADOW_WASH, shade));
  shadeForm(ctx, leg.outline, LIMB_BANDING);
  shadeForm(ctx, paw, LIMB_BANDING);
  pawToes(ctx, leg.paw, shade);
  paintClaws(ctx, leg.paw, strike);
}

const TAIL_SEGMENTS = 10;
const TAIL_LENGTH = 0.5;
const TAIL_ROOT_WIDTH = 0.04;
const TAIL_TIP_WIDTH = 0.022;
const TUFT_RX = 0.05;
const TUFT_RY = 0.06;

function tailPoints(root: Pt, swing: number, lift: number): Pt[] {
  const DROOP = deg(70);
  const CURL_UP = deg(150);
  const SWING_RANGE = deg(18);
  const pts: Pt[] = [root];
  let p = root;
  for (let i = 1; i <= TAIL_SEGMENTS; i++) {
    const t = i / TAIL_SEGMENTS;
    const angle = Math.PI - DROOP + t * t * CURL_UP * (0.4 + lift * 0.6) + swing * SWING_RANGE * t;
    p = add(p, fromAngle(angle, TAIL_LENGTH / TAIL_SEGMENTS));
    pts.push(p);
  }
  return pts;
}

function strokeTail(ctx: Ctx, pts: readonly Pt[], width: number, color: string): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  for (let i = 1; i < pts.length; i++) {
    const t = i / (pts.length - 1);
    ctx.lineWidth = width * lerp(TAIL_ROOT_WIDTH, TAIL_TIP_WIDTH, t);
    ctx.beginPath();
    ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
    ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
  ctx.restore();
}

function paintTail(ctx: Ctx, root: Pt, pose: LionPose): void {
  const pts = tailPoints(root, pose.tailSwing, pose.tailLift);
  const INK_SCALE = 1 + INK_WIDTH / TAIL_TIP_WIDTH;
  const LIGHT_EDGE_SCALE = 0.4;
  const LIGHT_EDGE_LIFT = -0.008;
  strokeTail(ctx, pts, INK_SCALE, INK);
  strokeTail(ctx, pts, 1, mix(COAT, SHADOW_WASH, 0.2));
  strokeTail(
    ctx,
    shifted(pts, { x: 0, y: LIGHT_EDGE_LIFT }),
    LIGHT_EDGE_SCALE,
    rgba(COAT_PALE, 0.8),
  );
  const tip = pts[pts.length - 1];
  const tuft = ovalPoints(tip, TUFT_RX, TUFT_RY, deg(20), 0.22, 3.3, 14);
  paintGrowth(ctx, tuft, 3.3, 0.6, false);
}

function paintGrowth(
  ctx: Ctx,
  outline: readonly Pt[],
  seed: number,
  sporePhase: number,
  withPores: boolean,
): void {
  inkAround(ctx, outline);
  fillSmooth(ctx, outline, MOLD);
  withClip(
    ctx,
    () => traceSmooth(ctx, outline),
    () => {
      paintFuzzRim(ctx, outline, seed);
    },
  );
  shadeForm(ctx, outline, MANE_BANDING);
  if (withPores) paintPores(ctx, outline, seed, sporePhase);
}

function paintFuzzRim(ctx: Ctx, outline: readonly Pt[], seed: number): void {
  const FUZZ_INSET = 0.012;
  const FUZZ_ALPHA = 0.85;
  const away = scalePt(TOWARD_LIGHT, -FUZZ_INSET * 2);
  fillOutside(ctx, shifted(outline, away), rgba(MOLD_FUZZ, FUZZ_ALPHA));
  const FLECKS = 10;
  const FLECK_R = 0.008;
  for (let i = 0; i < FLECKS; i++) {
    const p = outline[Math.floor(hash1(seed + i * 1.7) * outline.length)];
    dot(ctx, add(p, scalePt(TOWARD_LIGHT, -FUZZ_INSET)), FLECK_R, rgba(MOLD_FUZZ, 0.9));
  }
}

function centroidOf(pts: readonly Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
}

function paintPores(ctx: Ctx, outline: readonly Pt[], seed: number, sporePhase: number): void {
  const PORES = 7;
  const PORE_R = 0.013;
  const PORE_REACH = 0.7;
  const GLOW_SCALE = 1.9;
  const center = centroidOf(outline);
  for (let i = 0; i < PORES; i++) {
    const edge = outline[Math.floor(hash1(seed + i * 2.3) * outline.length)];
    const reach = lerp(0.2, PORE_REACH, hash1(seed + i * 4.9));
    const p = { x: lerp(center.x, edge.x, reach), y: lerp(center.y, edge.y, reach) };
    const own = (sporePhase + i / PORES) % 1;
    const glint = Math.max(0, Math.cos(own * TWO_PI));
    dot(ctx, p, PORE_R * 1.25, rgba(MOLD_DARK, 0.9));
    dot(ctx, p, PORE_R * GLOW_SCALE * glint, rgba(SPORE, 0.35 * glint));
    dot(ctx, p, PORE_R * (0.55 + 0.35 * glint), SPORE);
    dot(ctx, p, PORE_R * 0.35, SPORE_CORE);
  }
}

const MANE_CENTER: Pt = { x: -0.08, y: 0.05 };
const MANE_RX = 0.29;
const MANE_RY = 0.31;
const MANE_LOCKS = 11;
const MANE_LOCK_DEPTH = 0.2;
const MANE_SWEEP = deg(16);

function maneOutline(swell: number): Pt[] {
  const SWELL_RANGE = 0.05;
  const k = 1 + (swell - 0.5) * SWELL_RANGE;
  const FACE_CUT_START = -deg(60);
  const FACE_CUT_END = deg(55);
  const FACE_CUT_DEPTH = 0.9;
  const pts: Pt[] = [];
  for (let i = 0; i < MANE_LOCKS * 2; i++) {
    const isTip = i % 2 === 0;
    const a = (i / (MANE_LOCKS * 2)) * TWO_PI;
    const jitter = hash1(i * 7.13) * 0.08;
    let r = isTip ? 1 + jitter : 1 - MANE_LOCK_DEPTH + jitter * 0.5;
    if (a > TWO_PI + FACE_CUT_START || a < FACE_CUT_END) r *= FACE_CUT_DEPTH + (isTip ? 0.1 : 0);
    const sweep = isTip ? MANE_SWEEP : 0;
    const angle = a + (Math.sin(a) >= 0 ? sweep : -sweep) * (Math.cos(a) > 0 ? 1 : -1);
    pts.push(
      add(MANE_CENTER, {
        x: Math.cos(angle) * MANE_RX * r * k,
        y: Math.sin(angle) * MANE_RY * r * k,
      }),
    );
  }
  return pts;
}

function maneStrands(ctx: Ctx, outline: readonly Pt[]): void {
  const STRAND_FROM = 0.35;
  const STRAND_TO = 0.88;
  for (let i = 1; i < outline.length; i += 2) {
    const valley = outline[i];
    const from = {
      x: lerp(MANE_CENTER.x, valley.x, STRAND_FROM),
      y: lerp(MANE_CENTER.y, valley.y, STRAND_FROM),
    };
    const to = {
      x: lerp(MANE_CENTER.x, valley.x, STRAND_TO),
      y: lerp(MANE_CENTER.y, valley.y, STRAND_TO),
    };
    crease(ctx, [from, to], 0.012, 0.5, MANE_HAIR);
  }
}

const MANE_BLOOMS: readonly Bloom[] = [
  { center: { x: -0.06, y: -0.1 }, rx: 0.08, ry: 0.05, seed: 11.2 },
  { center: { x: -0.2, y: 0.02 }, rx: 0.06, ry: 0.07, seed: 13.9 },
  { center: { x: 0.02, y: 0.18 }, rx: 0.06, ry: 0.05, seed: 17.4 },
];

const FRUITING_BODIES: readonly {
  readonly at: Pt;
  readonly size: number;
  readonly lean: number;
}[] = [
  { at: { x: -0.05, y: -0.16 }, size: 1, lean: deg(-12) },
  { at: { x: -0.15, y: -0.12 }, size: 0.75, lean: deg(-28) },
  { at: { x: 0.03, y: -0.15 }, size: 0.6, lean: deg(10) },
];

function paintFruitingBody(ctx: Ctx, at: Pt, size: number, lean: number, swell: number): void {
  const STALK = 0.05;
  const CAP_RX = 0.03;
  const CAP_RY = 0.016;
  const SWELL_RANGE = 0.15;
  const k = size * (1 + (swell - 0.5) * SWELL_RANGE);
  const top = add(at, fromAngle(-Math.PI / 2 + lean, STALK * k));
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.022 * k;
  ctx.beginPath();
  ctx.moveTo(at.x, at.y);
  ctx.lineTo(top.x, top.y);
  ctx.stroke();
  ctx.strokeStyle = MOLD_PALE;
  ctx.lineWidth = 0.01 * k;
  ctx.stroke();
  ctx.restore();
  const cap = ovalPoints(add(top, { x: 0, y: CAP_RY * 0.3 * k }), CAP_RX * k, CAP_RY * k, lean);
  inkAround(ctx, cap, INK_WIDTH * 0.7);
  fillSmooth(ctx, cap, SPORE);
  withClip(
    ctx,
    () => traceSmooth(ctx, cap),
    () => {
      fillOutside(
        ctx,
        shifted(cap, scalePt(TOWARD_LIGHT, CAP_RY * 0.9 * k)),
        rgba(MOLD_DARK, 0.75),
      );
    },
  );
  dot(ctx, add(top, { x: -CAP_RX * 0.35 * k, y: -CAP_RY * 0.2 * k }), 0.006 * k, SPORE_CORE);
}

const RUFF_CENTER: Pt = { x: -0.2, y: 0.0 };
const RUFF_OUTER = 0.285;
const RUFF_VALLEY = 0.235;
const RUFF_INNER = 0.17;
const RUFF_FROM = -deg(42);
const RUFF_TO = deg(46);
const RUFF_LOCKS = 5;
const RUFF_LEAN = deg(7);
const RUFF_SEED = 31.3;

function ruffOutline(swell: number): Pt[] {
  const SWELL_RANGE = 0.04;
  const k = 1 + (swell - 0.5) * SWELL_RANGE;
  const pts: Pt[] = [];
  const steps = RUFF_LOCKS * 2;
  for (let i = 0; i <= steps; i++) {
    const a = lerp(RUFF_FROM, RUFF_TO, i / steps);
    const isTip = i % 2 === 1;
    const r = (isTip ? RUFF_OUTER : RUFF_VALLEY) * k;
    const lean = isTip ? RUFF_LEAN * Math.sign(a) : 0;
    pts.push(add(RUFF_CENTER, fromAngle(a + lean, r)));
  }
  for (let i = steps; i >= 0; i -= 2) {
    pts.push(add(RUFF_CENTER, fromAngle(lerp(RUFF_FROM, RUFF_TO, i / steps), RUFF_INNER)));
  }
  return pts;
}

function strokeOpenSmooth(ctx: Ctx, pts: readonly Pt[], width: number, color: string): void {
  if (pts.length < 2) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const next = pts[i + 1];
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + next.x) / 2, (pts[i].y + next.y) / 2);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
  ctx.restore();
}

/** Outer edge only, in mold dark: an ink line here draws a hood round the face. */
function paintRuff(ctx: Ctx, pose: LionPose): void {
  const outline = ruffOutline(pose.maneSwell);
  const outerEdge = outline.slice(0, RUFF_LOCKS * 2 + 1);
  strokeOpenSmooth(ctx, outerEdge, INK_WIDTH * 2, MOLD_DARK);
  fillSmooth(ctx, outline, mix(MOLD, MANE_HAIR, 0.2));
  withClip(
    ctx,
    () => traceSmooth(ctx, outline),
    () => paintFuzzRim(ctx, outline, RUFF_SEED),
  );
  shadeForm(ctx, outline, MANE_BANDING);
  paintPores(ctx, outline, RUFF_SEED, pose.sporePhase);
}

function paintMane(ctx: Ctx, pose: LionPose): void {
  const outline = maneOutline(pose.maneSwell);
  inkAround(ctx, outline);
  fillSmooth(ctx, outline, mix(MOLD, MANE_HAIR, 0.35));
  withClip(
    ctx,
    () => traceSmooth(ctx, outline),
    () => {
      maneStrands(ctx, outline);
      for (const bloom of MANE_BLOOMS) paintBloom(ctx, bloom, 0);
      paintFuzzRim(ctx, outline, MANE_SEED);
    },
  );
  shadeForm(ctx, outline, MANE_BANDING);
  paintPores(ctx, outline, MANE_SEED, pose.sporePhase);
  for (const body of FRUITING_BODIES) {
    paintFruitingBody(ctx, body.at, body.size, body.lean, pose.maneSwell);
  }
}

const MANE_SEED = 21.7;

const HEAD_OUTLINE: readonly Pt[] = [
  { x: -0.08, y: -0.02 },
  { x: -0.06, y: -0.11 },
  { x: 0.03, y: -0.15 },
  { x: 0.11, y: -0.14 },
  { x: 0.16, y: -0.1 },
  { x: 0.23, y: -0.085 },
  { x: 0.27, y: -0.06 },
  { x: 0.285, y: -0.015 },
  { x: 0.275, y: 0.035 },
  { x: 0.21, y: 0.06 },
  { x: 0.1, y: 0.07 },
  { x: 0.0, y: 0.075 },
  { x: -0.07, y: 0.045 },
];

const JAW_OUTLINE: readonly Pt[] = [
  { x: -0.01, y: 0.045 },
  { x: 0.12, y: 0.05 },
  { x: 0.22, y: 0.055 },
  { x: 0.24, y: 0.085 },
  { x: 0.19, y: 0.115 },
  { x: 0.08, y: 0.12 },
  { x: 0.0, y: 0.1 },
];

const JAW_HINGE: Pt = { x: 0.0, y: 0.05 };
const JAW_MAX_OPEN = deg(34);

const MUZZLE_PAD: readonly Pt[] = [
  { x: 0.15, y: -0.015 },
  { x: 0.23, y: -0.06 },
  { x: 0.285, y: -0.03 },
  { x: 0.285, y: 0.035 },
  { x: 0.21, y: 0.065 },
  { x: 0.14, y: 0.045 },
];

const NOSE_PAD: readonly Pt[] = [
  { x: 0.25, y: -0.075 },
  { x: 0.285, y: -0.055 },
  { x: 0.292, y: -0.015 },
  { x: 0.262, y: -0.025 },
];

const EYE_AT: Pt = { x: 0.13, y: -0.085 };
const EYE_RX = 0.024;
const EYE_RY = 0.014;
const EAR_AT: Pt = { x: -0.035, y: -0.14 };
const EAR_R = 0.034;

const CHEEK_BLOOM: Bloom = { center: { x: 0.04, y: -0.02 }, rx: 0.06, ry: 0.045, seed: 5.6 };

function jawFrame(jawOpen: number): Frame2 {
  return { origin: JAW_HINGE, angle: jawOpen * JAW_MAX_OPEN };
}

function paintMouthInterior(ctx: Ctx, jawOpen: number): void {
  if (jawOpen <= 0) return;
  const jaw = jawFrame(jawOpen);
  const lowerLip = placeAll(jaw, [
    { x: 0.22, y: 0.005 },
    { x: 0.1, y: 0.0 },
  ]);
  const gape: Pt[] = [{ x: 0.04, y: 0.05 }, { x: 0.26, y: 0.04 }, lowerLip[0], lowerLip[1]];
  fillSmooth(ctx, gape, MOUTH);
  const FANG_LENGTH = 0.04;
  const upperFang = { x: 0.225, y: 0.05 };
  const lowerFang = place(jaw, { x: 0.2, y: 0.005 });
  ctx.fillStyle = FANG;
  ctx.beginPath();
  ctx.moveTo(upperFang.x - 0.012, upperFang.y);
  ctx.lineTo(upperFang.x + 0.012, upperFang.y);
  ctx.lineTo(upperFang.x - 0.002, upperFang.y + FANG_LENGTH * jawOpen);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(lowerFang.x - 0.01, lowerFang.y);
  ctx.lineTo(lowerFang.x + 0.01, lowerFang.y);
  ctx.lineTo(lowerFang.x - 0.004, lowerFang.y - FANG_LENGTH * 0.8 * jawOpen);
  ctx.closePath();
  ctx.fill();
}

function paintEye(ctx: Ctx, open: number): void {
  const SOCKET_SCALE = 1.7;
  const socket = ovalPoints(EYE_AT, EYE_RX * SOCKET_SCALE, EYE_RY * SOCKET_SCALE * 1.2, deg(-8));
  fillSmooth(ctx, socket, rgba(INK, 0.6));
  if (open <= 0.05) {
    crease(
      ctx,
      [
        { x: EYE_AT.x - EYE_RX, y: EYE_AT.y },
        { x: EYE_AT.x + EYE_RX, y: EYE_AT.y - 0.004 },
      ],
      0.01,
      0.9,
    );
    return;
  }
  const GLOW_REACH = 2.4;
  const glow = ovalPoints(EYE_AT, EYE_RX * GLOW_REACH, EYE_RY * GLOW_REACH * open, deg(-8));
  fillSmooth(ctx, glow, rgba(EYE_GLOW, 0.22));
  const eye = ovalPoints(EYE_AT, EYE_RX, EYE_RY * open, deg(-8));
  fillSmooth(ctx, eye, EYE_GLOW);
  dot(ctx, add(EYE_AT, { x: EYE_RX * 0.25, y: 0 }), EYE_RY * 0.55 * open, EYE_CORE);
  // A lion's pupil is round, but only a slit survives at 32 px.
  ctx.fillStyle = INK;
  ctx.fillRect(EYE_AT.x - 0.003, EYE_AT.y - EYE_RY * open, 0.006, EYE_RY * 2 * open);
}

function paintHead(ctx: Ctx, pose: LionPose): void {
  const jaw = placeAll(jawFrame(pose.jawOpen), shifted(JAW_OUTLINE, scalePt(JAW_HINGE, -1)));
  inkAround(ctx, jaw);
  inkAround(ctx, HEAD_OUTLINE);
  fillSmooth(ctx, jaw, mix(MUZZLE, SHADOW_WASH, 0.15));
  shadeForm(ctx, jaw, HEAD_BANDING);
  paintMouthInterior(ctx, pose.jawOpen);

  fillSmooth(ctx, HEAD_OUTLINE, COAT);
  withClip(
    ctx,
    () => traceSmooth(ctx, HEAD_OUTLINE),
    () => {
      fillSmooth(ctx, MUZZLE_PAD, MUZZLE);
      paintBloom(ctx, CHEEK_BLOOM, 0);
    },
  );
  shadeForm(ctx, HEAD_OUTLINE, HEAD_BANDING);

  const browRidge: Pt[] = [
    { x: 0.09, y: -0.108 },
    { x: 0.14, y: -0.118 },
    { x: 0.18, y: -0.095 },
  ];
  crease(ctx, browRidge, 0.014, 0.7);
  const whiskerPadUnderside: Pt[] = [
    { x: 0.16, y: 0.045 },
    { x: 0.22, y: 0.06 },
    { x: 0.275, y: 0.035 },
  ];
  crease(ctx, whiskerPadUnderside, 0.01, 0.45);
  fillSmooth(ctx, NOSE_PAD, NOSE);
  dot(ctx, { x: 0.27, y: -0.06 }, 0.007, rgba(LIGHT_WASH, 0.5));
  const WHISKER_DOTS: readonly Pt[] = [
    { x: 0.2, y: 0.005 },
    { x: 0.225, y: 0.018 },
    { x: 0.185, y: 0.025 },
  ];
  for (const p of WHISKER_DOTS) dot(ctx, p, 0.0045, rgba(INK, 0.55));
  paintEye(ctx, pose.eyeOpen);
}

function paintEar(ctx: Ctx): void {
  const ear = ovalPoints(EAR_AT, EAR_R, EAR_R * 0.9, 0, 0.05, 2, 14);
  inkAround(ctx, ear);
  fillSmooth(ctx, ear, COAT);
  dot(ctx, add(EAR_AT, { x: 0.008, y: 0.004 }), EAR_R * 0.5, mix(COAT, SHADOW_WASH, 0.35));
  shadeForm(ctx, ear, HEAD_BANDING);
}

function torsoOutline(breathe: number): Pt[] {
  return TORSO_OUTLINE.map((p) => {
    const ribShare = clamp01((p.x + 0.15) / 0.5);
    const below = p.y > 0 ? 1 : 0;
    return { x: p.x, y: p.y + breathe * BREATHE_SWELL * ribShare * below };
  });
}

function shoulderOutline(lift: number): Pt[] {
  return ovalPoints(
    add(SHOULDER_CENTER, { x: 0, y: -lift }),
    SHOULDER_RX,
    SHOULDER_RY,
    SHOULDER_TILT,
    0.04,
    1.1,
  );
}

function haunchOutline(): Pt[] {
  return ovalPoints(HAUNCH_CENTER, HAUNCH_RX, HAUNCH_RY, HAUNCH_TILT, 0.03, 2.4);
}

function paintTorso(ctx: Ctx, pose: LionPose, shoulderLift: number): void {
  const torso = torsoOutline(pose.breathe);
  const shoulder = shoulderOutline(shoulderLift);
  const haunch = haunchOutline();
  inkAround(ctx, torso);
  inkAround(ctx, haunch);
  fillSmooth(ctx, torso, COAT);
  withClip(
    ctx,
    () => traceSmooth(ctx, torso),
    () => {
      const belly: Pt[] = [
        { x: 0.36, y: 0.06 },
        { x: 0.2, y: 0.09 },
        { x: -0.02, y: 0.06 },
        { x: -0.2, y: 0.05 },
        { x: -0.3, y: 0.2 },
        { x: 0.3, y: 0.25 },
      ];
      fillSmooth(ctx, belly, BELLY);
      for (const bloom of BODY_BLOOMS) paintBloom(ctx, bloom, 0);
      const RIBS = 3;
      for (let i = 0; i < RIBS; i++) {
        const x = 0.06 - i * 0.055;
        crease(
          ctx,
          [
            { x: x + 0.02, y: -0.06 },
            { x: x - 0.005, y: 0.0 },
            { x: x + 0.005, y: 0.06 },
          ],
          0.009,
          0.28,
        );
      }
    },
  );
  shadeForm(ctx, torso, BODY_BANDING);

  fillSmooth(ctx, haunch, COAT);
  withClip(
    ctx,
    () => traceSmooth(ctx, haunch),
    () => paintBloom(ctx, BODY_BLOOMS[2], 0),
  );
  shadeForm(ctx, haunch, MUSCLE_BANDING);
  crease(
    ctx,
    [
      { x: -0.17, y: -0.1 },
      { x: -0.14, y: 0.0 },
      { x: -0.2, y: 0.1 },
    ],
    0.014,
    0.55,
  );

  withClip(
    ctx,
    () => traceSmooth(ctx, torso),
    () => {
      fillSmooth(ctx, shoulder, COAT);
      shadeForm(ctx, shoulder, MUSCLE_BANDING);
    },
  );
  const back = add(SHOULDER_CENTER, { x: -SHOULDER_RX * 0.9, y: -shoulderLift });
  crease(
    ctx,
    [
      add(back, { x: 0.02, y: -0.1 }),
      add(back, { x: -0.015, y: 0.0 }),
      add(back, { x: 0.03, y: 0.1 }),
    ],
    0.013,
    0.55,
  );
}

const GROUND_SHADOW_RX = 0.5;
const GROUND_SHADOW_RY = 0.075;
const GROUND_SHADOW_ALPHA = 0.32;
/** How far the shoulder blade rides up over a weight-bearing foreleg. */
const SHOULDER_ROLL = 0.018;

function legsOf(
  pose: LionPose,
  torso: Frame2,
): {
  foreNear: LegShape;
  foreFar: LegShape;
  hindNear: LegShape;
  hindFar: LegShape;
} {
  const pawAt = (restX: number, paw: PawPose): Pt => ({
    x: restX + pose.bodyX + paw.dx + (paw.strike ?? 0),
    y: GROUND_Y - paw.lift,
  });
  const foreFarRoot = place(torso, add(FORE_ROOT, FAR_LEG_OFFSET));
  const hindFarRoot = place(torso, add(HIND_ROOT, FAR_LEG_OFFSET));
  return {
    foreNear: legShape(
      place(torso, FORE_ROOT),
      pawAt(FORE_PAW_X, pose.foreNear),
      FORE_UPPER,
      FORE_LOWER,
      FORE_WIDTHS,
      FORE_ELBOW_BULGE,
    ),
    foreFar: legShape(
      foreFarRoot,
      pawAt(FORE_PAW_X + FAR_LEG_OFFSET.x, pose.foreFar),
      FORE_UPPER,
      FORE_LOWER,
      FORE_WIDTHS,
      FORE_ELBOW_BULGE,
    ),
    hindNear: legShape(
      place(torso, HIND_ROOT),
      pawAt(HIND_PAW_X, pose.hindNear),
      HIND_UPPER,
      HIND_LOWER,
      HIND_WIDTHS,
      HIND_GASKIN_BULGE,
    ),
    hindFar: legShape(
      hindFarRoot,
      pawAt(HIND_PAW_X + FAR_LEG_OFFSET.x, pose.hindFar),
      HIND_UPPER,
      HIND_LOWER,
      HIND_WIDTHS,
      HIND_GASKIN_BULGE,
    ),
  };
}

export function drawMoldLionSide(ctx: Ctx, pose: LionPose): void {
  const torso: Frame2 = { origin: { x: pose.bodyX, y: pose.bodyY }, angle: pose.pitch };
  const legs = legsOf(pose, torso);

  ctx.save();
  try {
    ctx.fillStyle = rgba(INK, GROUND_SHADOW_ALPHA);
    ctx.beginPath();
    ctx.ellipse(
      pose.bodyX - 0.02,
      GROUND_Y + 0.005,
      GROUND_SHADOW_RX,
      GROUND_SHADOW_RY,
      0,
      0,
      TWO_PI,
    );
    ctx.fill();

    paintLeg(ctx, legs.hindFar, pose.hindFar.lift, 0, FAR_SIDE_SHADE);
    paintLeg(ctx, legs.foreFar, pose.foreFar.lift, pose.foreFar.strike ?? 0, FAR_SIDE_SHADE);

    paintTail(ctx, place(torso, TAIL_ROOT), pose);

    const foreLoad = pose.foreNear.lift > 0 ? 0 : 1;
    ctx.save();
    ctx.translate(torso.origin.x, torso.origin.y);
    ctx.rotate(torso.angle);
    paintTorso(ctx, pose, foreLoad * SHOULDER_ROLL);
    ctx.restore();

    paintLeg(ctx, legs.hindNear, pose.hindNear.lift, 0, 0);
    paintLeg(ctx, legs.foreNear, pose.foreNear.lift, pose.foreNear.strike ?? 0, 0);

    const neck = place(torso, NECK_POINT);
    ctx.save();
    ctx.translate(neck.x + pose.headX, neck.y + pose.headY);
    ctx.rotate(pose.headPitch + pose.pitch);
    paintMane(ctx, pose);
    paintHead(ctx, pose);
    paintEar(ctx);
    paintRuff(ctx, pose);
    ctx.restore();
  } finally {
    ctx.restore();
  }
}
