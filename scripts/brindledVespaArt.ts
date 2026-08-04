/**
 * The painter library behind the Brindled Vespa — the final, flying stage of
 * the Brindle Grub lifecycle.
 *
 * Unlike the two grub stages this is a proper hornet: a distinct head, thorax
 * and abdomen, six legs, a curved stinger and a pair of translucent wings kept
 * in a permanent blur, because the creature never lands. What makes the shape
 * read as a *hornet* rather than as a generic flying bug:
 *
 *   - a **banded abdomen** — alternating dark and pale rings, the brindled
 *     pattern the whole lifecycle is named for, carried right through to the
 *     adult;
 *   - a **narrow waist** (the petiole) between thorax and abdomen — remove it
 *     and the two segments read as one fat sac;
 *   - a **curved stinger** at the abdomen's tip, held low and slightly
 *     forward, distinct from the acid-spit mouth at the other end of the
 *     animal;
 *   - **translucent, veined wings** blurred by a fast beat rather than drawn
 *     as solid paddles — a hornet's wings are barely visible in flight, and a
 *     solid wing reads as a moth;
 *   - **six legs** trailing loosely beneath the thorax, never planted — this
 *     animal is always airborne.
 *
 * Skin is painted through `paintChitin` (from `mantidArt.ts`), the same
 * generic directional-gradient engine the Mantid and the grub stages share.
 *
 * Coordinates are tile units, +Y down, origin at the tile centre. The side
 * view faces +X (head foremost); the runtime mirrors it for the other
 * direction.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';
import {
  TWO_PI,
  clamp01,
  deg,
  easeInOut,
  hash1,
  lerp,
  mix,
  paintChitin,
  ramp,
  rgba,
  segmentOutline,
  traceOutline,
  type MantidBuild,
  type Pt,
} from './mantidArt.js';

export {
  TWO_PI,
  clamp01,
  deg,
  easeInOut,
  hash1,
  lerp,
  mix,
  ramp,
  rgba,
  segmentOutline,
  traceOutline,
};
export type { Pt };

// ── Build ────────────────────────────────────────────────────────────────────

export interface VespaPalette {
  readonly base: string;
  readonly dark: string;
  readonly light: string;
  readonly rim: string;
  readonly ink: string;
  readonly band: string;
  readonly wing: string;
  readonly eye: string;
  readonly stinger: string;
}

export interface VespaBuild {
  readonly palette: VespaPalette;
  readonly seed: number;
}

export const BRINDLED_VESPA_BUILD: VespaBuild = {
  palette: {
    base: '#8a3a1c',
    dark: '#2c1208',
    light: '#e0a03c',
    rim: '#f4c878',
    ink: '#180a04',
    band: '#231208',
    wing: '#dce8f0',
    eye: '#150a06',
    stinger: '#120704',
  },
  seed: 14.6,
};

function chitinAdapter(build: VespaBuild): MantidBuild {
  return {
    palette: {
      base: build.palette.base,
      dark: build.palette.dark,
      light: build.palette.light,
      rim: build.palette.rim,
      ink: build.palette.ink,
      sheen: build.palette.light,
      eye: build.palette.eye,
      eyeDark: build.palette.ink,
      membrane: build.palette.wing,
      spine: build.palette.light,
    },
    wingWear: 0,
    scarring: 0,
    heft: 0,
    iridescence: 0,
    seed: build.seed,
  };
}

// ── Anatomy (tile units) ─────────────────────────────────────────────────────

export const GROUND_Y = 0.4;

const HEAD_X = 0.26;
const HEAD_RADIUS = 0.066;
export const THORAX_X = 0.03;
const THORAX_HALF_X = 0.09;
const THORAX_HALF_Y = 0.078;
const WAIST_X = -0.09;
const WAIST_HALF = 0.026;
export const ABDOMEN_TIP_X = -0.44;
const ABDOMEN_ROOT_HALF = 0.1;
const ABDOMEN_MID_HALF = 0.118;
const ABDOMEN_TIP_HALF = 0.012;
const ABDOMEN_BANDS = 5;
export const STINGER_LENGTH = 0.07;

export const WING_ROOT: Pt = { x: 0.05, y: -0.05 };
export const WING_LENGTH = 0.34;
const WING_HALF = 0.13;
const WING_REST_ANGLE = deg(-18);

const LEG_ROOT_Y = 0.05;
const LEG_UPPER = 0.13;
const LEG_LOWER = 0.15;
const LEG_HALF_ROOT = 0.014;
const LEG_HALF_TIP = 0.006;

const MANDIBLE_LENGTH = 0.05;
const EYE_RADIUS = 0.022;

// ── Pose ─────────────────────────────────────────────────────────────────────

export interface LegDangle {
  readonly swing: number;
  readonly tuck: number;
}

export interface VespaPose {
  readonly bob: number;
  readonly sway: number;
  readonly lean: number;
  readonly wingbeat: number;
  /** 0 wings folded flat, 1 fully spread for the beat. */
  readonly wingSpread: number;
  readonly headPitch: number;
  readonly headTurn: number;
  readonly abdomenCurl: number;
  readonly abdomenLift: number;
  readonly mandibleOpen: number;
  readonly legs: readonly [LegDangle, LegDangle, LegDangle];
  readonly time: number;
}

const REST_LEG: LegDangle = { swing: 0, tuck: 0 };

export function restVespaPose(): VespaPose {
  return {
    bob: 0,
    sway: 0,
    lean: 0,
    wingbeat: 0,
    wingSpread: 1,
    headPitch: 0,
    headTurn: 0,
    abdomenCurl: 0,
    abdomenLift: 0,
    mandibleOpen: 0,
    legs: [REST_LEG, REST_LEG, REST_LEG],
    time: 0,
  };
}

// ── Parts ────────────────────────────────────────────────────────────────────

function drawThorax(ctx: Ctx, build: VespaBuild, pose: VespaPose): void {
  const outline = ellipseOutline(THORAX_X, pose.bob, THORAX_HALF_X, THORAX_HALF_Y, build.seed);
  paintChitin(ctx, { outline, build: chitinAdapter(build), gloss: 0.6 });
}

/** How much the thorax outline narrows head-on, where its long axis foreshortens. */
const FRONT_THORAX_SCALE = 0.88;
/** The away view keeps the thorax closer to full width — it's the wing bases' anchor. */
const AWAY_THORAX_SCALE = 1;

/** The thorax centred on the body's axis for the front/away views, instead of offset along it. */
function drawThoraxAxial(ctx: Ctx, build: VespaBuild, pose: VespaPose, widthScale: number): void {
  const outline = ellipseOutline(
    0,
    pose.bob,
    THORAX_HALF_X * widthScale,
    THORAX_HALF_Y,
    build.seed,
  );
  paintChitin(ctx, { outline, build: chitinAdapter(build), gloss: 0.6 });
}

function ellipseOutline(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  seed: number,
  steps = 24,
): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * TWO_PI;
    const wobble = 1 + Math.sin(angle * 3 + seed) * 0.015;
    pts.push({ x: cx + Math.cos(angle) * rx * wobble, y: cy + Math.sin(angle) * ry * wobble });
  }
  return pts;
}

/** The narrow petiole waist between thorax and abdomen — without it, one fat sac. */
function drawWaist(ctx: Ctx, build: VespaBuild, pose: VespaPose): void {
  const from: Pt = { x: THORAX_X - THORAX_HALF_X * 0.6, y: pose.bob };
  const to: Pt = { x: WAIST_X, y: pose.bob + pose.abdomenLift };
  const outline = segmentOutline(from, to, WAIST_HALF * 1.4, WAIST_HALF, 0.006);
  paintChitin(ctx, { outline, build: chitinAdapter(build), gloss: 0.3, contour: 0.7 });
}

interface AbdomenGeometry {
  readonly root: Pt;
  readonly tip: Pt;
  readonly angle: number;
}

/** The abdomen's rest direction in profile: trailing back behind the waist. */
const SIDE_ABDOMEN_ANGLE = Math.PI;

/**
 * Where the abdomen points head-on and from behind: down and slightly back,
 * rather than trailing to one side. Geometrically the abdomen recedes into
 * the screen in both axial views and would project to almost nothing full
 * length; `foreshorten` is what keeps it a visible mass hanging behind the
 * thorax instead of vanishing.
 */
const AXIAL_ABDOMEN_ANGLE = deg(100);

const ABDOMEN_LENGTH = Math.abs(ABDOMEN_TIP_X - WAIST_X);

function abdomenGeometry(pose: VespaPose, baseAngle: number, foreshorten: number): AbdomenGeometry {
  const root: Pt = { x: WAIST_X, y: pose.bob + pose.abdomenLift };
  const angle = baseAngle + pose.abdomenCurl;
  const length = ABDOMEN_LENGTH * foreshorten;
  const tip: Pt = {
    x: root.x + Math.cos(angle) * length,
    y: root.y + Math.sin(angle) * length + pose.abdomenLift * 0.4,
  };
  return { root, tip, angle: Math.atan2(tip.y - root.y, tip.x - root.x) };
}

/** The banded abdomen: the brindled pattern the whole lifecycle is named for. */
function drawAbdomen(
  ctx: Ctx,
  build: VespaBuild,
  pose: VespaPose,
  baseAngle: number,
  foreshorten: number,
): void {
  const { root, tip, angle } = abdomenGeometry(pose, baseAngle, foreshorten);
  // Widen the middle: segmentOutline only tapers linearly, so the belly is
  // pushed out with a second pass sized to the mid half-width.
  const mid: Pt = { x: (root.x + tip.x) / 2, y: (root.y + tip.y) / 2 };
  const bulge = segmentOutline(root, mid, ABDOMEN_ROOT_HALF, ABDOMEN_MID_HALF, 0.015);
  const taper = segmentOutline(mid, tip, ABDOMEN_MID_HALF, ABDOMEN_TIP_HALF, 0.015);
  paintChitin(ctx, { outline: bulge, build: chitinAdapter(build), gloss: 0.6 });
  paintChitin(ctx, { outline: taper, build: chitinAdapter(build), gloss: 0.6 });

  ctx.save();
  traceOutline(ctx, [...bulge, ...taper]);
  ctx.clip();
  for (let b = 1; b <= ABDOMEN_BANDS; b++) {
    const t = b / (ABDOMEN_BANDS + 1);
    const cx = lerp(root.x, tip.x, t);
    const cy = lerp(root.y, tip.y, t);
    const half = lerp(ABDOMEN_ROOT_HALF, ABDOMEN_TIP_HALF, t) * 1.35;
    const nx = -Math.sin(angle);
    const ny = Math.cos(angle);
    ctx.beginPath();
    ctx.moveTo(cx - nx * half, cy - ny * half);
    ctx.lineTo(cx + nx * half, cy + ny * half);
    ctx.strokeStyle = rgba(build.palette.band, 0.8);
    ctx.lineWidth = 0.026;
    ctx.stroke();
  }
  ctx.restore();

  // The stinger: curved, dark, held low off the tip.
  const stingerAngle = angle + deg(24);
  const stingerTip: Pt = {
    x: tip.x + Math.cos(stingerAngle) * STINGER_LENGTH,
    y: tip.y + Math.sin(stingerAngle) * STINGER_LENGTH,
  };
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.quadraticCurveTo(
    tip.x + Math.cos(angle) * STINGER_LENGTH * 0.4,
    tip.y + Math.sin(angle) * STINGER_LENGTH * 0.4,
    stingerTip.x,
    stingerTip.y,
  );
  ctx.strokeStyle = build.palette.stinger;
  ctx.lineWidth = 0.014;
  ctx.lineCap = 'round';
  ctx.stroke();
}

/** The narrow neck between thorax and head — without it the two blend into one blob. */
function drawNeck(ctx: Ctx, build: VespaBuild, pose: VespaPose): void {
  const from: Pt = { x: THORAX_X + THORAX_HALF_X * 0.5, y: pose.bob };
  const to: Pt = { x: HEAD_X - HEAD_RADIUS * 0.55, y: pose.bob + pose.headPitch };
  const outline = segmentOutline(from, to, WAIST_HALF * 1.1, WAIST_HALF * 1.3, 0.004);
  paintChitin(ctx, { outline, build: chitinAdapter(build), gloss: 0.3, contour: 0.7 });
}

/** The head: mandibles, compound eyes, antennae. */
function drawHead(ctx: Ctx, build: VespaBuild, pose: VespaPose): void {
  const cx = HEAD_X + Math.cos(pose.headTurn) * 0.01;
  const cy = pose.bob + pose.headPitch;
  drawNeck(ctx, build, pose);
  const outline = ellipseOutline(cx, cy, HEAD_RADIUS, HEAD_RADIUS * 0.86, build.seed + 4.1);
  paintChitin(ctx, { outline, build: chitinAdapter(build), gloss: 0.7 });

  for (const sign of [-1, 1]) {
    const ex = cx + sign * HEAD_RADIUS * 0.55;
    const ey = cy - HEAD_RADIUS * 0.1;
    ctx.beginPath();
    ctx.ellipse(ex, ey, EYE_RADIUS, EYE_RADIUS * 1.15, 0, 0, TWO_PI);
    ctx.fillStyle = build.palette.eye;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex - EYE_RADIUS * 0.3, ey - EYE_RADIUS * 0.35, EYE_RADIUS * 0.25, 0, TWO_PI);
    ctx.fillStyle = rgba(build.palette.rim, 0.75);
    ctx.fill();
  }

  const spread = pose.mandibleOpen;
  for (const sign of [-1, 1]) {
    const hookAngle = sign * (deg(14) + spread * deg(30));
    const tipX = cx + HEAD_RADIUS * 0.9 + Math.cos(hookAngle) * MANDIBLE_LENGTH;
    const tipY = cy + Math.sin(hookAngle) * MANDIBLE_LENGTH + HEAD_RADIUS * 0.35 * sign * 0.2;
    ctx.beginPath();
    ctx.moveTo(cx + HEAD_RADIUS * 0.75, cy + HEAD_RADIUS * 0.3);
    ctx.lineTo(tipX, tipY);
    ctx.strokeStyle = build.palette.ink;
    ctx.lineWidth = 0.01;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  for (const sign of [-1, 1]) {
    const baseX = cx + HEAD_RADIUS * 0.3;
    const baseY = cy - HEAD_RADIUS * 0.7;
    const sweep = Math.sin(pose.time * TWO_PI + sign) * deg(10);
    const tipAngle = deg(-60) * sign + sweep;
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.quadraticCurveTo(
      baseX + Math.cos(tipAngle) * 0.08,
      baseY + Math.sin(tipAngle) * 0.08 - 0.04,
      baseX + Math.cos(tipAngle) * 0.14,
      baseY + Math.sin(tipAngle) * 0.14 - 0.06,
    );
    ctx.strokeStyle = rgba(build.palette.ink, 0.85);
    ctx.lineWidth = 0.007;
    ctx.stroke();
  }
}

/** How far above the thorax's centre the head sits in the axial views. */
const AXIAL_HEAD_RISE = 0.16;
/** How wide the front-view mandibles spread apart, hinged rather than swept to one side. */
const FRONT_MANDIBLE_SPREAD = deg(24);

/** The neck for the front/away views: short and centred, not the side's forward reach. */
function drawNeckAxial(ctx: Ctx, build: VespaBuild, pose: VespaPose, headCy: number): void {
  const from: Pt = { x: 0, y: pose.bob - THORAX_HALF_Y * 0.7 };
  const to: Pt = { x: 0, y: headCy + HEAD_RADIUS * 0.6 };
  const outline = segmentOutline(from, to, WAIST_HALF * 1.1, WAIST_HALF * 1.3, 0);
  paintChitin(ctx, { outline, build: chitinAdapter(build), gloss: 0.3, contour: 0.7 });
}

/**
 * The head seen from the front: both compound eyes fully on-model rather than
 * one foreshortened by turn, and the mandibles hinged open toward the viewer
 * instead of swept back along one side of a profile skull.
 */
function drawHeadFront(ctx: Ctx, build: VespaBuild, pose: VespaPose): void {
  const cx = 0;
  const cy = pose.bob - AXIAL_HEAD_RISE + pose.headPitch;
  drawNeckAxial(ctx, build, pose, cy);
  const outline = ellipseOutline(cx, cy, HEAD_RADIUS, HEAD_RADIUS * 0.86, build.seed + 4.1);
  paintChitin(ctx, { outline, build: chitinAdapter(build), gloss: 0.7 });

  for (const sign of [-1, 1]) {
    const ex = cx + sign * HEAD_RADIUS * 0.55;
    const ey = cy - HEAD_RADIUS * 0.1;
    ctx.beginPath();
    ctx.ellipse(ex, ey, EYE_RADIUS, EYE_RADIUS * 1.15, 0, 0, TWO_PI);
    ctx.fillStyle = build.palette.eye;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex - sign * EYE_RADIUS * 0.3, ey - EYE_RADIUS * 0.35, EYE_RADIUS * 0.25, 0, TWO_PI);
    ctx.fillStyle = rgba(build.palette.rim, 0.75);
    ctx.fill();
  }

  const spread = pose.mandibleOpen;
  for (const sign of [-1, 1]) {
    const baseX = cx + sign * HEAD_RADIUS * 0.35;
    const baseY = cy + HEAD_RADIUS * 0.55;
    const hookAngle = deg(90) + sign * (FRONT_MANDIBLE_SPREAD * 0.5 + spread * deg(20));
    const tipX = baseX + Math.cos(hookAngle) * MANDIBLE_LENGTH;
    const tipY = baseY + Math.sin(hookAngle) * MANDIBLE_LENGTH;
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.lineTo(tipX, tipY);
    ctx.strokeStyle = build.palette.ink;
    ctx.lineWidth = 0.01;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  for (const sign of [-1, 1]) {
    const baseX = cx + sign * HEAD_RADIUS * 0.3;
    const baseY = cy - HEAD_RADIUS * 0.7;
    const sweep = Math.sin(pose.time * TWO_PI + sign) * deg(10);
    const tipAngle = deg(-90) + sign * deg(30) + sweep;
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.quadraticCurveTo(
      baseX + Math.cos(tipAngle) * 0.08,
      baseY + Math.sin(tipAngle) * 0.08 - 0.04,
      baseX + Math.cos(tipAngle) * 0.14,
      baseY + Math.sin(tipAngle) * 0.14 - 0.06,
    );
    ctx.strokeStyle = rgba(build.palette.ink, 0.85);
    ctx.lineWidth = 0.007;
    ctx.stroke();
  }
}

/**
 * One dangling leg — never planted, this animal is always airborne. `fan`
 * spreads the near/far leg of a pair apart so all six read distinctly instead
 * of overlapping into three.
 */
function drawLeg(ctx: Ctx, build: VespaBuild, rootX: number, dangle: LegDangle, fan: number): void {
  const root: Pt = { x: rootX, y: LEG_ROOT_Y };
  const kneeAngle = deg(80) + dangle.swing + fan;
  const knee: Pt = {
    x: root.x + Math.cos(kneeAngle) * LEG_UPPER * (1 - dangle.tuck * 0.3),
    y: root.y + Math.sin(kneeAngle) * LEG_UPPER * (1 - dangle.tuck * 0.3),
  };
  const footAngle = kneeAngle + deg(35) + dangle.swing * 0.6;
  const foot: Pt = {
    x: knee.x + Math.cos(footAngle) * LEG_LOWER * (1 - dangle.tuck * 0.5),
    y: knee.y + Math.sin(footAngle) * LEG_LOWER * (1 - dangle.tuck * 0.5),
  };
  const upper = segmentOutline(root, knee, LEG_HALF_ROOT, LEG_HALF_ROOT * 0.65, 0.008);
  const lower = segmentOutline(knee, foot, LEG_HALF_ROOT * 0.6, LEG_HALF_TIP, -0.006);
  paintChitin(ctx, { outline: upper, build: chitinAdapter(build), gloss: 0.3, contour: 0.7 });
  paintChitin(ctx, { outline: lower, build: chitinAdapter(build), gloss: 0.3, contour: 0.7 });
}

/** Fan angle separating the near and far leg of each of the three pairs. */
const LEG_PAIR_FAN = deg(22);

function drawLegs(ctx: Ctx, build: VespaBuild, pose: VespaPose): void {
  const roots = [THORAX_X + 0.05, THORAX_X - 0.01, THORAX_X - 0.07];
  pose.legs.forEach((dangle, i) => {
    drawLeg(ctx, build, roots[i], dangle, -LEG_PAIR_FAN);
    drawLeg(ctx, build, roots[i], dangle, LEG_PAIR_FAN);
  });
}

interface AxialLegSpec {
  readonly rootY: number;
  /** Extra outward splay past `AXIAL_LEG_SPLAY`, larger for pairs that read as further back. */
  readonly splayExtra: number;
  /** Lifts the foot toward the body, shortening the leg's apparent reach. */
  readonly rise: number;
  /** Extra darkening for pairs read as receding from the camera. */
  readonly shade: number;
}

/** Half the gap between a mirrored leg pair's hip roots, seen head-on. */
const AXIAL_LEG_HIP_HALF = 0.02;
/** Base outward splay of an axial leg off straight down. */
const AXIAL_LEG_SPLAY = deg(26);

const AXIAL_LEG_FRONT: AxialLegSpec = {
  rootY: LEG_ROOT_Y - 0.02,
  splayExtra: 0,
  rise: 0,
  shade: 0,
};
const AXIAL_LEG_MID: AxialLegSpec = {
  rootY: LEG_ROOT_Y,
  splayExtra: deg(4),
  rise: 0.015,
  shade: 0.2,
};
const AXIAL_LEG_HIND: AxialLegSpec = {
  rootY: LEG_ROOT_Y + 0.02,
  splayExtra: deg(8),
  rise: 0.03,
  shade: 0.4,
};

/** One leg of a mirrored pair for the front/away views, splayed outward from the centreline. */
function drawAxialLeg(
  ctx: Ctx,
  build: VespaBuild,
  spec: AxialLegSpec,
  sign: number,
  dangle: LegDangle,
): void {
  const root: Pt = { x: sign * AXIAL_LEG_HIP_HALF, y: spec.rootY };
  const kneeAngle = Math.PI / 2 - sign * (AXIAL_LEG_SPLAY + spec.splayExtra) + dangle.swing * sign;
  const knee: Pt = {
    x: root.x + Math.cos(kneeAngle) * LEG_UPPER * (1 - dangle.tuck * 0.3),
    y: root.y + Math.sin(kneeAngle) * LEG_UPPER * (1 - dangle.tuck * 0.3) - spec.rise * 0.4,
  };
  const footAngle = kneeAngle + sign * deg(30) + dangle.swing * sign * 0.5;
  const foot: Pt = {
    x: knee.x + Math.cos(footAngle) * LEG_LOWER * (1 - dangle.tuck * 0.5),
    y: knee.y + Math.sin(footAngle) * LEG_LOWER * (1 - dangle.tuck * 0.5) - spec.rise * 0.6,
  };
  const upper = segmentOutline(root, knee, LEG_HALF_ROOT, LEG_HALF_ROOT * 0.65, 0.008 * sign);
  const lower = segmentOutline(knee, foot, LEG_HALF_ROOT * 0.6, LEG_HALF_TIP, -0.006 * sign);
  const adapter = chitinAdapter(build);
  paintChitin(ctx, { outline: upper, build: adapter, shade: spec.shade, gloss: 0.3, contour: 0.7 });
  paintChitin(ctx, { outline: lower, build: adapter, shade: spec.shade, gloss: 0.3, contour: 0.7 });
}

/** All six legs as three mirrored pairs, splayed symmetrically off the centreline. */
function drawLegsAxial(ctx: Ctx, build: VespaBuild, pose: VespaPose): void {
  const [front, mid, hind] = pose.legs;
  for (const sign of [-1, 1]) drawAxialLeg(ctx, build, AXIAL_LEG_FRONT, sign, front);
  for (const sign of [-1, 1]) drawAxialLeg(ctx, build, AXIAL_LEG_MID, sign, mid);
  for (const sign of [-1, 1]) drawAxialLeg(ctx, build, AXIAL_LEG_HIND, sign, hind);
}

/** Paints one translucent, veined wing blade between two points already computed by the caller. */
function paintWingBlade(
  ctx: Ctx,
  build: VespaBuild,
  root: Pt,
  tip: Pt,
  taperSign: number,
  alpha: number,
): void {
  const outline = segmentOutline(root, tip, WING_HALF * 0.3, WING_HALF, 0.05 * taperSign);
  ctx.save();
  ctx.globalAlpha = alpha;
  traceOutline(ctx, outline);
  ctx.fillStyle = rgba(build.palette.wing, 0.5);
  ctx.fill();
  ctx.strokeStyle = rgba(build.palette.ink, 0.4);
  ctx.lineWidth = 0.006;
  ctx.stroke();
  // A single vein down the middle, the only thing that stops a translucent
  // blur from reading as a smear of paint.
  ctx.beginPath();
  ctx.moveTo(root.x, root.y);
  ctx.lineTo(tip.x, tip.y);
  ctx.strokeStyle = rgba(build.palette.ink, 0.3);
  ctx.lineWidth = 0.004;
  ctx.stroke();
  ctx.restore();
}

/** One translucent, veined wing, drawn open then trailed by a fainter blur copy. */
function drawWing(
  ctx: Ctx,
  build: VespaBuild,
  pose: VespaPose,
  flapSign: number,
  blurOffset: number,
  alpha: number,
): void {
  const angle = WING_REST_ANGLE + flapSign * pose.wingSpread * deg(50) * (1 + blurOffset * 0.6);
  const root = WING_ROOT;
  const tip: Pt = {
    x: root.x + Math.cos(angle) * WING_LENGTH,
    y: root.y + Math.sin(angle) * WING_LENGTH,
  };
  paintWingBlade(ctx, build, root, tip, 1, alpha);
}

const WING_BLUR_ALPHA = 0.28;
const WING_BLUR_OFFSET = 0.5;

function drawWings(ctx: Ctx, build: VespaBuild, pose: VespaPose): void {
  for (const flapSign of [-1, 1]) {
    drawWing(ctx, build, pose, flapSign, WING_BLUR_OFFSET, WING_BLUR_ALPHA);
    drawWing(ctx, build, pose, flapSign, -WING_BLUR_OFFSET, WING_BLUR_ALPHA);
    drawWing(ctx, build, pose, flapSign, 0, 0.85);
  }
}

/** How far each wing's root sits off the centreline for the front/away views. */
const AXIAL_WING_ROOT_X = 0.05;
/** Rest direction of an axial wing: mostly out to the side, angled slightly up. */
const AXIAL_WING_BASE_ANGLE = deg(-15);
/** How far the beat swings an axial wing off its rest direction. */
const AXIAL_WING_FLUTTER = deg(35);

/**
 * One wing of a mirrored left/right pair for the front/away views. In profile
 * both wing-pairs share a single anchor and only their up/down beat separates
 * them; head-on the two sides no longer overlap; they must flank the body.
 */
function drawWingAxial(
  ctx: Ctx,
  build: VespaBuild,
  pose: VespaPose,
  side: number,
  flapSign: number,
  blurOffset: number,
  alpha: number,
): void {
  const root: Pt = { x: side * AXIAL_WING_ROOT_X, y: WING_ROOT.y };
  const angle =
    AXIAL_WING_BASE_ANGLE +
    flapSign * pose.wingSpread * AXIAL_WING_FLUTTER * (1 + blurOffset * 0.6);
  const tip: Pt = {
    x: root.x + side * Math.cos(angle) * WING_LENGTH,
    y: root.y + Math.sin(angle) * WING_LENGTH,
  };
  paintWingBlade(ctx, build, root, tip, side, alpha);
}

function drawWingsAxial(ctx: Ctx, build: VespaBuild, pose: VespaPose): void {
  for (const side of [-1, 1]) {
    for (const flapSign of [-1, 1]) {
      drawWingAxial(ctx, build, pose, side, flapSign, WING_BLUR_OFFSET, WING_BLUR_ALPHA);
      drawWingAxial(ctx, build, pose, side, flapSign, -WING_BLUR_OFFSET, WING_BLUR_ALPHA);
      drawWingAxial(ctx, build, pose, side, flapSign, 0, 0.85);
    }
  }
}

// ── Composed views ───────────────────────────────────────────────────────────

export type VespaView = 'front' | 'side' | 'away';

/** How much of the abdomen's full length still reads foreshortened head-on. */
const FRONT_ABDOMEN_FORESHORTEN = 0.36;
/** From behind, more of the abdomen's topside is visible than from the front. */
const AWAY_ABDOMEN_FORESHORTEN = 0.68;

function drawVespaSideView(ctx: Ctx, build: VespaBuild, pose: VespaPose): void {
  drawWings(ctx, build, pose);
  drawLegs(ctx, build, pose);
  drawAbdomen(ctx, build, pose, SIDE_ABDOMEN_ANGLE, 1);
  drawWaist(ctx, build, pose);
  drawThorax(ctx, build, pose);
  drawHead(ctx, build, pose);
}

/**
 * The front and away views share a posture: viewed along the body's long
 * axis, the abdomen recedes behind the thorax and foreshortens rather than
 * trailing to one side, and the legs splay as mirrored pairs instead of
 * single file. Only the head (front only) and the thorax's width tell the
 * two apart.
 */
function drawVespaAxialView(
  ctx: Ctx,
  build: VespaBuild,
  pose: VespaPose,
  view: 'front' | 'away',
): void {
  const foreshorten = view === 'front' ? FRONT_ABDOMEN_FORESHORTEN : AWAY_ABDOMEN_FORESHORTEN;
  const thoraxScale = view === 'front' ? FRONT_THORAX_SCALE : AWAY_THORAX_SCALE;

  drawWingsAxial(ctx, build, pose);
  drawLegsAxial(ctx, build, pose);
  drawAbdomen(ctx, build, pose, AXIAL_ABDOMEN_ANGLE, foreshorten);
  drawWaist(ctx, build, pose);
  drawThoraxAxial(ctx, build, pose, thoraxScale);
  // The away view shows the animal's back: the head all but disappears
  // behind the thorax, and no mandibles or eyes should read at all.
  if (view === 'front') drawHeadFront(ctx, build, pose);
}

function drawVespa(ctx: Ctx, build: VespaBuild, pose: VespaPose, view: VespaView): void {
  ctx.save();
  ctx.translate(pose.sway, 0);
  ctx.rotate(pose.lean);

  if (view === 'side') drawVespaSideView(ctx, build, pose);
  else drawVespaAxialView(ctx, build, pose, view);

  ctx.restore();
}

export function drawVespaFront(ctx: Ctx, build: VespaBuild, pose: VespaPose): void {
  drawVespa(ctx, build, pose, 'front');
}

export function drawVespaSide(ctx: Ctx, build: VespaBuild, pose: VespaPose): void {
  drawVespa(ctx, build, pose, 'side');
}

export function drawVespaAway(ctx: Ctx, build: VespaBuild, pose: VespaPose): void {
  drawVespa(ctx, build, pose, 'away');
}

// ── Spit windup phases ───────────────────────────────────────────────────────

const WINDUP_REAR_END = 0.7;

export function windupPose(progress: number): VespaPose {
  const rear = easeInOut(ramp(progress, 0, WINDUP_REAR_END));
  const release = easeInOut(ramp(progress, WINDUP_REAR_END, 1));
  const settle = rear * (1 - release);
  return {
    ...restVespaPose(),
    lean: deg(-8) * settle,
    headPitch: -0.02 * settle,
    headTurn: 0,
    abdomenCurl: deg(18) * settle,
    abdomenLift: -0.015 * settle,
    mandibleOpen: clamp01(settle * 1.2),
    wingbeat: progress,
    wingSpread: 1 + settle * 0.4,
    legs: [
      { swing: deg(6) * settle, tuck: settle * 0.4 },
      { swing: 0, tuck: settle * 0.2 },
      { swing: deg(-6) * settle, tuck: settle * 0.4 },
    ],
    time: progress,
  };
}
