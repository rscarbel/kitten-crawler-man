/**
 * Carl's attack cow: a war cow, painted by the cow painter (`cowArt.ts`) through
 * a `CowLook`, so she walks, turns and lies down exactly as the village herd
 * does. What makes her a veteran rather than livestock is layered on:
 *
 * - **A dented iron helmet** riding the poll, its horns pushed out through
 *   holes in the crown and a nasal bar down the face.
 * - **A spiked collar** of black leather round the throat, iron spikes out.
 * - **A scuffed coat**: a grimy black-and-white hide crossed with old claw
 *   rakes and scars, and a smear of dirt along the flank.
 *
 * Every decoration is bold rather than fine: she is drawn at one tile, where a
 * rivet is a pixel and a stitch is nothing.
 */

import { deg, lerp, mix, rgba, type Pt } from './carlArt';
import {
  cowPollPoint,
  hash1,
  type CowDecorations,
  type CowHide,
  type CowLook,
  type CowPose,
  type CowView,
  type HornSpec,
} from './cowArt';
import { ADULT_COW_BUILD } from './cowLooks';

type Ctx = CanvasRenderingContext2D;

const TWO_PI = Math.PI * 2;

function pt(x: number, y: number): Pt {
  return { x, y };
}

// ── Palette ──────────────────────────────────────────────────────────────────

const IRON = '#7c8290';
const IRON_LIGHT = '#c3c9d4';
const IRON_DARK = '#3a3d46';
const IRON_INK = '#15161b';
const LEATHER = '#3d2618';
const LEATHER_LIGHT = '#6a4430';
const SCAR = '#f3e7e1';
const SCAR_PINK = '#a9837c';
const DIRT = '#5a4630';
const HOLE = '#0d0c0e';

/**
 * A Holstein gone grey with dust and old fights. Darker and dirtier than any
 * cow in the village pasture, so she never reads as one of the herd.
 */
const ATTACK_COW_HIDE: CowHide = {
  base: '#cfc8b8',
  shadow: '#77706a',
  light: '#e9e3d4',
  patch: '#221d1f',
  patchCover: 0.5,
  belly: null,
  points: '#a59d8f',
  face: null,
  muzzle: '#c28f8c',
  nostril: '#5b3136',
  muzzleRing: null,
  eyeRing: null,
  earInner: '#c99594',
  horn: '#e8ddc2',
  hornTip: '#3c332c',
  hoof: '#2c2423',
  tailSwitch: '#3a3330',
  udder: '#d79aa0',
  ink: '#120f12',
  eye: '#1a1210',
};

/** Short and upswept, long enough to stand clear of the helmet's crown. */
const ATTACK_COW_HORNS: HornSpec = {
  shape: 'upswept',
  length: 0.17,
  baseHalfWidth: 0.026,
  cracks: 1,
};

/** How much heavier than a dairy cow her neck and chest are: a working animal. */
const WAR_COW_FRONT_SCALE = { neckRoot: 1.1, neckTip: 1.08 } as const;

const ATTACK_COW_BUILD = {
  ...ADULT_COW_BUILD,
  neckRootHalfWidth: ADULT_COW_BUILD.neckRootHalfWidth * WAR_COW_FRONT_SCALE.neckRoot,
  neckTipHalfWidth: ADULT_COW_BUILD.neckTipHalfWidth * WAR_COW_FRONT_SCALE.neckTip,
};

// ── Ink ──────────────────────────────────────────────────────────────────────

const HELMET_INK_WIDTH = 0.016;
const COLLAR_INK_WIDTH = 0.014;
const SCAR_WIDTH = 0.011;
const SCAR_EDGE_WIDTH = 0.02;

function inked(ctx: Ctx, fill: string, width: number): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = IRON_INK;
  ctx.lineWidth = width;
  ctx.stroke();
}

// ── Helmet ───────────────────────────────────────────────────────────────────

/**
 * The profile helmet, in the head's own space (origin at the poll, +X down the
 * face, +Y toward the throat), as fractions of the head's length and depth.
 * The crown wraps the top of the skull from behind the poll to the brow and
 * stops above the eye, which sits at about a quarter of the depth down.
 */
const SIDE_HELMET: ReadonlyArray<readonly [number, number]> = [
  [-0.18, -0.32],
  [-0.12, -0.64],
  [0.14, -0.8],
  [0.44, -0.72],
  [0.62, -0.52],
  [0.6, -0.36],
  [0.32, -0.34],
  [0.08, -0.26],
  [-0.12, -0.2],
];
/** The nasal bar: from the brow down the face toward the muzzle. */
const SIDE_NASAL: ReadonlyArray<readonly [number, number]> = [
  [0.48, -0.52],
  [0.78, -0.5],
  [0.8, -0.4],
  [0.5, -0.4],
];
/** The dent: a crescent knocked into the crown, shadowed below, lit above. */
const SIDE_DENT = { along: 0.28, down: -0.62, rx: 0.1, ry: 0.07 } as const;
/** Where the horn comes through, as in `cowArt.ts`'s profile horn base. */
const SIDE_HORN_HOLE = { along: 0.05, down: -0.46 } as const;
const HORN_HOLE_RADIUS = 0.034;
/** Rivets along the brow band, as fractions along the head's length. */
const SIDE_RIVETS: readonly number[] = [-0.04, 0.14, 0.32, 0.5];
const SIDE_RIVET_DOWN = -0.36;
const RIVET_RADIUS = 0.014;
/** The band of light along the crown's top edge. */
const CROWN_SHINE = { from: -0.04, to: 0.4, down: -0.7 } as const;
const CROWN_SHINE_WIDTH = 0.018;

function drawSideHelmet(ctx: Ctx): void {
  const L = ATTACK_COW_BUILD.headLength;
  const D = ATTACK_COW_BUILD.headDepth;
  const at = ([along, down]: readonly [number, number]): Pt => pt(along * L, down * D);
  ctx.save();
  ctx.lineJoin = 'round';

  ctx.beginPath();
  SIDE_NASAL.map(at).forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  inked(ctx, IRON, HELMET_INK_WIDTH);

  ctx.beginPath();
  SIDE_HELMET.map(at).forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  inked(ctx, IRON, HELMET_INK_WIDTH);

  ctx.strokeStyle = IRON_LIGHT;
  ctx.lineWidth = CROWN_SHINE_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(CROWN_SHINE.from * L, CROWN_SHINE.down * D);
  ctx.lineTo(CROWN_SHINE.to * L, CROWN_SHINE.down * D);
  ctx.stroke();

  drawDent(ctx, pt(SIDE_DENT.along * L, SIDE_DENT.down * D), SIDE_DENT.rx * L, SIDE_DENT.ry * D);

  ctx.fillStyle = IRON_DARK;
  for (const along of SIDE_RIVETS) {
    ctx.beginPath();
    ctx.arc(along * L, SIDE_RIVET_DOWN * D, RIVET_RADIUS, 0, TWO_PI);
    ctx.fill();
  }

  drawHornHole(ctx, pt(SIDE_HORN_HOLE.along * L, SIDE_HORN_HOLE.down * D));
  ctx.restore();
}

/** A knock in the iron: a dark crescent where it caves in, a lit lip above it. */
function drawDent(ctx: Ctx, at: Pt, rx: number, ry: number): void {
  ctx.fillStyle = IRON_DARK;
  ctx.beginPath();
  ctx.ellipse(at.x, at.y, rx, ry, deg(-12), 0, Math.PI);
  ctx.fill();
  ctx.strokeStyle = IRON_LIGHT;
  ctx.lineWidth = CROWN_SHINE_WIDTH;
  ctx.beginPath();
  ctx.ellipse(at.x, at.y, rx, ry, deg(-12), Math.PI, TWO_PI);
  ctx.stroke();
}

/** The ring a horn comes through: a dark hole edged with a lip of iron. */
function drawHornHole(ctx: Ctx, at: Pt): void {
  ctx.beginPath();
  ctx.arc(at.x, at.y, HORN_HOLE_RADIUS, 0, TWO_PI);
  ctx.fillStyle = HOLE;
  ctx.fill();
  ctx.strokeStyle = IRON_LIGHT;
  ctx.lineWidth = HELMET_INK_WIDTH;
  ctx.stroke();
}

/**
 * The helmet head-on, in the face's own space: origin at the poll, +Y down
 * the face, as fractions of the face's half-width and height. The crown stops
 * at the brow, above the eyes, and the nasal bar runs down the middle.
 */
const FRONT_CROWN = { top: -0.16, brow: 0.24, halfWidth: 1.02 } as const;
const FRONT_NASAL = { halfWidth: 0.16, bottom: 0.62 } as const;
/** As in `cowArt.ts`'s head-on horn base. */
const FRONT_HORN_HOLE = { across: 0.62, down: 0.02 } as const;
const FRONT_DENT = { across: -0.38, down: 0.06, rx: 0.3, ry: 0.07 } as const;
const FRONT_RIVETS: readonly number[] = [-0.7, -0.35, 0.35, 0.7];
const FRONT_RIVET_DOWN = 0.19;

function drawFrontHelmet(ctx: Ctx, faceHeight: number): void {
  const W = ATTACK_COW_BUILD.headFrontHalfWidth;
  const H = faceHeight;
  const left = -FRONT_CROWN.halfWidth * W;
  const right = FRONT_CROWN.halfWidth * W;
  const top = FRONT_CROWN.top * H;
  const brow = FRONT_CROWN.brow * H;
  ctx.save();
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.moveTo(-FRONT_NASAL.halfWidth * W, brow);
  ctx.lineTo(FRONT_NASAL.halfWidth * W, brow);
  ctx.lineTo(FRONT_NASAL.halfWidth * W * 0.7, FRONT_NASAL.bottom * H);
  ctx.lineTo(-FRONT_NASAL.halfWidth * W * 0.7, FRONT_NASAL.bottom * H);
  ctx.closePath();
  inked(ctx, IRON, HELMET_INK_WIDTH);

  // The crown, with the horns' holes cut through it so the horn bases painted
  // underneath show inside them: the horns come through the iron.
  ctx.beginPath();
  ctx.moveTo(left, brow);
  ctx.quadraticCurveTo(left, top, 0, top);
  ctx.quadraticCurveTo(right, top, right, brow);
  ctx.closePath();
  for (const side of [-1, 1]) {
    const hole = pt(side * FRONT_HORN_HOLE.across * W, FRONT_HORN_HOLE.down * H);
    ctx.moveTo(hole.x + HORN_HOLE_RADIUS, hole.y);
    ctx.arc(hole.x, hole.y, HORN_HOLE_RADIUS, 0, TWO_PI);
  }
  ctx.fillStyle = IRON;
  ctx.fill('evenodd');
  ctx.strokeStyle = IRON_INK;
  ctx.lineWidth = HELMET_INK_WIDTH;
  ctx.stroke();

  ctx.fillStyle = rgba(IRON_LIGHT, 0.55);
  ctx.beginPath();
  ctx.ellipse(W * 0.3, lerp(top, brow, 0.3), W * 0.32, H * 0.06, deg(-8), 0, TWO_PI);
  ctx.fill();

  drawDent(
    ctx,
    pt(FRONT_DENT.across * W, FRONT_DENT.down * H),
    FRONT_DENT.rx * W,
    FRONT_DENT.ry * H,
  );

  ctx.fillStyle = IRON_DARK;
  for (const across of FRONT_RIVETS) {
    ctx.beginPath();
    ctx.arc(across * W, FRONT_RIVET_DOWN * H, RIVET_RADIUS, 0, TWO_PI);
    ctx.fill();
  }
  ctx.restore();
}

/** From behind only the crown shows, between the horns. */
const BACK_HELMET = { halfWidth: 0.52, up: 0.05, down: 0.05 } as const;

function drawBackHelmet(ctx: Ctx, poll: Pt): void {
  const W = ATTACK_COW_BUILD.headFrontHalfWidth * BACK_HELMET.halfWidth;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(poll.x - W, poll.y + BACK_HELMET.down);
  ctx.quadraticCurveTo(poll.x - W, poll.y - BACK_HELMET.up, poll.x, poll.y - BACK_HELMET.up);
  ctx.quadraticCurveTo(poll.x + W, poll.y - BACK_HELMET.up, poll.x + W, poll.y + BACK_HELMET.down);
  ctx.closePath();
  inked(ctx, IRON, HELMET_INK_WIDTH);
  ctx.strokeStyle = IRON_LIGHT;
  ctx.lineWidth = CROWN_SHINE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(poll.x - W * 0.5, poll.y - BACK_HELMET.up * 0.4);
  ctx.lineTo(poll.x + W * 0.3, poll.y - BACK_HELMET.up * 0.6);
  ctx.stroke();
  ctx.restore();
}

// ── Collar ───────────────────────────────────────────────────────────────────

/**
 * Where the collar sits along the profile neck, 0 at the shoulder and 1 at the
 * poll: up by the throat latch, clear of the brisket the barrel paints over.
 */
const COLLAR_ALONG = 0.72;
/** The collar's width along the neck, in tiles. */
const COLLAR_BAND = 0.085;
const SPIKE_LENGTH = 0.1;
const SPIKE_HALF_BASE = 0.026;
/** Spikes stand out of the crest only: spiked at the throat too, the collar read as a beard. */
const CREST_SPIKES = 3;
const THROAT_STUDS = 2;
const STUD_RADIUS = 0.016;
/** How far past the neck's silhouette the band wraps, as a share of the neck's width. */
const COLLAR_WRAP = 0.08;
/** The worn shine along the band, as a share of its half-width toward the shoulder. */
const COLLAR_SHINE_OFFSET = 0.4;

/** Indices into the neck outline `cowArt.ts` builds, crest first from the shoulder, then the throat back down. */
const NECK_ROOT_TOP = 0;
const NECK_MID_TOP = 1;
const NECK_TIP_TOP = 2;
const NECK_TIP_BOTTOM = 4;
const NECK_THROAT = 5;
const NECK_ROOT_BOTTOM = 8;
const NECK_OUTLINE_POINTS = 9;
/** How far along the neck the crest's middle point and the throat's first point sit. */
const NECK_MID_ALONG = 0.5;
const NECK_THROAT_ALONG = 0.7;

function lerpPt(a: Pt, b: Pt, t: number): Pt {
  return pt(lerp(a.x, b.x, t), lerp(a.y, b.y, t));
}

function spike(ctx: Ctx, base: Pt, out: Pt, along: Pt): void {
  ctx.beginPath();
  ctx.moveTo(base.x - along.x * SPIKE_HALF_BASE, base.y - along.y * SPIKE_HALF_BASE);
  ctx.lineTo(base.x + out.x * SPIKE_LENGTH, base.y + out.y * SPIKE_LENGTH);
  ctx.lineTo(base.x + along.x * SPIKE_HALF_BASE, base.y + along.y * SPIKE_HALF_BASE);
  ctx.closePath();
  inked(ctx, IRON_LIGHT, COLLAR_INK_WIDTH);
}

function drawSideCollar(ctx: Ctx, neck: readonly Pt[]): void {
  if (neck.length !== NECK_OUTLINE_POINTS) return;
  const rootMid = lerpPt(neck[NECK_ROOT_TOP], neck[NECK_ROOT_BOTTOM], 0.5);
  const tipMid = lerpPt(neck[NECK_TIP_TOP], neck[NECK_TIP_BOTTOM], 0.5);
  const length = Math.hypot(tipMid.x - rootMid.x, tipMid.y - rootMid.y);
  if (length <= 0) return;
  const along = pt((tipMid.x - rootMid.x) / length, (tipMid.y - rootMid.y) / length);
  const crestShare = (COLLAR_ALONG - NECK_MID_ALONG) / (1 - NECK_MID_ALONG);
  const top = lerpPt(neck[NECK_MID_TOP], neck[NECK_TIP_TOP], crestShare);
  const throatShare = (1 - COLLAR_ALONG) / (1 - NECK_THROAT_ALONG);
  const bottom = lerpPt(neck[NECK_TIP_BOTTOM], neck[NECK_THROAT], throatShare);
  const half = pt((along.x * COLLAR_BAND) / 2, (along.y * COLLAR_BAND) / 2);
  const up = pt(top.x - bottom.x, top.y - bottom.y);
  const upLength = Math.hypot(up.x, up.y);
  if (upLength <= 0) return;
  const outward = pt(up.x / upLength, up.y / upLength);

  const overshoot = 1 + COLLAR_WRAP;
  const topOut = pt(bottom.x + up.x * overshoot, bottom.y + up.y * overshoot);
  const bottomOut = pt(top.x - up.x * overshoot, top.y - up.y * overshoot);

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(topOut.x - half.x, topOut.y - half.y);
  ctx.lineTo(topOut.x + half.x, topOut.y + half.y);
  ctx.lineTo(bottomOut.x + half.x, bottomOut.y + half.y);
  ctx.lineTo(bottomOut.x - half.x, bottomOut.y - half.y);
  ctx.closePath();
  inked(ctx, LEATHER, COLLAR_INK_WIDTH);
  ctx.strokeStyle = LEATHER_LIGHT;
  ctx.lineWidth = COLLAR_INK_WIDTH;
  ctx.beginPath();
  ctx.moveTo(topOut.x - half.x * COLLAR_SHINE_OFFSET, topOut.y - half.y * COLLAR_SHINE_OFFSET);
  ctx.lineTo(
    bottomOut.x - half.x * COLLAR_SHINE_OFFSET,
    bottomOut.y - half.y * COLLAR_SHINE_OFFSET,
  );
  ctx.stroke();
  for (let i = 0; i < CREST_SPIKES; i++) {
    const t = (i + 1) / (CREST_SPIKES + 1);
    const base = lerpPt(
      pt(topOut.x - half.x, topOut.y - half.y),
      pt(topOut.x + half.x, topOut.y + half.y),
      t,
    );
    spike(ctx, base, outward, along);
  }
  ctx.fillStyle = IRON_LIGHT;
  for (let i = 0; i < THROAT_STUDS; i++) {
    const t = (i + 1) / (THROAT_STUDS + 1);
    const at = lerpPt(topOut, bottomOut, t);
    ctx.beginPath();
    ctx.arc(at.x, at.y, STUD_RADIUS, 0, TWO_PI);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Head-on the collar is the band across the top of the chest, under the
 * face: the head is painted over it, so the spikes along its lower edge are
 * what show either side of the muzzle.
 */
const FRONT_COLLAR = { down: 0.4, halfWidth: 0.52, depth: 0.06, sag: 0.04 } as const;
const FRONT_COLLAR_SPIKES = 5;

function drawFrontCollar(ctx: Ctx, barrel: readonly Pt[]): void {
  const box = boxOf(barrel);
  const cx = (box.minX + box.maxX) / 2;
  const half = ((box.maxX - box.minX) / 2) * FRONT_COLLAR.halfWidth;
  const y = lerp(box.minY, box.maxY, FRONT_COLLAR.down);
  ctx.save();
  ctx.lineJoin = 'round';
  for (let i = 0; i < FRONT_COLLAR_SPIKES; i++) {
    const t = i / (FRONT_COLLAR_SPIKES - 1);
    const x = lerp(cx - half, cx + half, t);
    const sag = Math.sin(t * Math.PI) * FRONT_COLLAR.sag;
    const out = pt((t - 0.5) * 0.8, 1);
    const outLength = Math.hypot(out.x, out.y);
    spike(
      ctx,
      pt(x, y + FRONT_COLLAR.depth + sag),
      pt(out.x / outLength, out.y / outLength),
      pt(1, 0),
    );
  }
  ctx.beginPath();
  ctx.moveTo(cx - half, y);
  ctx.quadraticCurveTo(cx, y + FRONT_COLLAR.sag * 2, cx + half, y);
  ctx.lineTo(cx + half, y + FRONT_COLLAR.depth);
  ctx.quadraticCurveTo(
    cx,
    y + FRONT_COLLAR.depth + FRONT_COLLAR.sag * 2,
    cx - half,
    y + FRONT_COLLAR.depth,
  );
  ctx.closePath();
  inked(ctx, LEATHER, COLLAR_INK_WIDTH);
  ctx.restore();
}

// ── Scuffs ───────────────────────────────────────────────────────────────────

interface Box {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

function boxOf(points: readonly Pt[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

function clipTo(ctx: Ctx, outline: readonly Pt[]): void {
  ctx.beginPath();
  outline.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  ctx.clip();
}

/**
 * A rake of claw marks: parallel pale scars, each with a pink healed edge.
 * Placed as shares of the body's box, so the same marks sit in the same place
 * on every frame and in every pose.
 */
interface Rake {
  readonly across: number;
  readonly down: number;
  readonly length: number;
  readonly angle: number;
  readonly strokes: number;
}

const SIDE_RAKES: readonly Rake[] = [
  { across: 0.42, down: 0.36, length: 0.2, angle: deg(58), strokes: 3 },
  { across: 0.78, down: 0.5, length: 0.12, angle: deg(-40), strokes: 2 },
];
const AXIAL_RAKES: readonly Rake[] = [
  { across: 0.3, down: 0.42, length: 0.14, angle: deg(62), strokes: 3 },
];
const RAKE_SPACING = 0.032;
/** A dusty smear along the lower flank, where she has been down in the dirt. */
const DIRT_SMEAR = {
  across: 0.5,
  down: 0.86,
  halfWidth: 0.34,
  halfHeight: 0.1,
  alpha: 0.35,
} as const;
const DIRT_FLECKS = 9;
const DIRT_FLECK_RADIUS = 0.014;
const DIRT_FLECK_ALPHA = 0.45;
const DIRT_SEED = 431;

function drawRake(ctx: Ctx, box: Box, rake: Rake): void {
  const cx = lerp(box.minX, box.maxX, rake.across);
  const cy = lerp(box.minY, box.maxY, rake.down);
  const dir = pt(Math.cos(rake.angle), Math.sin(rake.angle));
  const across = pt(-dir.y, dir.x);
  ctx.lineCap = 'round';
  for (let i = 0; i < rake.strokes; i++) {
    const offset = (i - (rake.strokes - 1) / 2) * RAKE_SPACING;
    const shorten = 1 - Math.abs(offset) * 4;
    const half = (rake.length * shorten) / 2;
    const mid = pt(cx + across.x * offset, cy + across.y * offset);
    for (const [colour, width] of [
      [SCAR_PINK, SCAR_EDGE_WIDTH],
      [SCAR, SCAR_WIDTH],
    ] as const) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(mid.x - dir.x * half, mid.y - dir.y * half);
      ctx.lineTo(mid.x + dir.x * half, mid.y + dir.y * half);
      ctx.stroke();
    }
  }
}

function drawScuffs(ctx: Ctx, outline: readonly Pt[], view: CowView): void {
  const box = boxOf(outline);
  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;
  ctx.save();
  clipTo(ctx, outline);
  const smearX = lerp(box.minX, box.maxX, DIRT_SMEAR.across);
  const smearY = lerp(box.minY, box.maxY, DIRT_SMEAR.down);
  ctx.fillStyle = rgba(DIRT, DIRT_SMEAR.alpha);
  ctx.beginPath();
  ctx.ellipse(
    smearX,
    smearY,
    width * DIRT_SMEAR.halfWidth,
    height * DIRT_SMEAR.halfHeight,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.fillStyle = rgba(mix(DIRT, IRON_INK, 0.3), DIRT_FLECK_ALPHA);
  for (let i = 0; i < DIRT_FLECKS; i++) {
    const x = lerp(box.minX, box.maxX, hash1(DIRT_SEED + i));
    const y = lerp(box.minY, box.maxY, lerp(0.55, 1, hash1(DIRT_SEED + i * 2 + 1)));
    ctx.beginPath();
    ctx.arc(x, y, DIRT_FLECK_RADIUS, 0, TWO_PI);
    ctx.fill();
  }
  for (const rake of view === 'side' ? SIDE_RAKES : AXIAL_RAKES) drawRake(ctx, box, rake);
  ctx.restore();
}

// ── The look ─────────────────────────────────────────────────────────────────

const ATTACK_COW_DECORATIONS: CowDecorations = {
  body: (ctx, view, outline) => {
    drawScuffs(ctx, outline, view);
    if (view === 'front') drawFrontCollar(ctx, outline);
  },
  neck: (ctx, view, outline) => {
    if (view === 'side') drawSideCollar(ctx, outline);
  },
  head: (ctx, view, outline) => {
    if (view === 'side') {
      drawSideHelmet(ctx);
      return;
    }
    if (view !== 'front') return;
    const box = boxOf(outline);
    drawFrontHelmet(ctx, box.maxY - box.minY);
  },
};

export const ATTACK_COW_LOOK: CowLook = {
  id: 'attack_cow',
  build: ATTACK_COW_BUILD,
  hide: ATTACK_COW_HIDE,
  horns: ATTACK_COW_HORNS,
  shag: 0,
  forelock: 0,
  decorations: ATTACK_COW_DECORATIONS,
};

/**
 * What the cow painter has no hook for: the helmet's crown seen from behind,
 * over the poll between the horns. Painted in the cow painter's space after
 * `drawCow`.
 */
export function drawAttackCowOverlay(ctx: Ctx, view: CowView, pose: CowPose): void {
  if (view !== 'back') return;
  drawBackHelmet(ctx, cowPollPoint(pose, ATTACK_COW_LOOK, view));
}
