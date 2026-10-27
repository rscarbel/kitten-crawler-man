/**
 * Old Lori, the hedge witch who tells fortunes out of her cottage: an old,
 * short, stooped dwarf woman who gets about on a cane.
 *
 * The painter knows nothing about animation: it draws one pose in one of three
 * views — head-on, in profile (mirrored for the other side) and from behind.
 *
 * Every measurement is in tile units with the origin on the ground between her
 * feet and +Y down, so heights are negative. Limbs are placed in a small body
 * space — `l` lateral (+ toward her left, the cane side), `y` height, `d` depth
 * (+ the way she faces) — and each view projects that space, so an arm solved
 * once lands in the same place from every side.
 */

import { type Pt, clamp01, lerp, mix, rgba } from './bipedArt';
import { fillSoftEllipse, withClip } from './softShade';

type Ctx = CanvasRenderingContext2D;

// ── Palette ──────────────────────────────────────────────────────────────────

const OUTLINE = '#24161a';
const SKIN = '#e6b99a';
const SKIN_SHADE = '#b98265';
const SKIN_LIGHT = '#f6d6bd';
const ROSY = '#d97a68';
const HAIR = '#aeaaa6';
const HAIR_LIGHT = '#dedad4';
const HAIR_SHADE = '#6f6b69';
const BROW = '#8a8680';
const EYE = '#1a1214';
const MOUTH = '#6a2a2a';
const CARDIGAN = '#3f7a68';
const CARDIGAN_LIGHT = '#62a08a';
const CARDIGAN_SHADE = '#244a40';
const COLLAR = '#efe9dc';
const BUTTON = '#d9b75a';
const SKIRT = '#6a2f52';
const SKIRT_SHADE = '#431c33';
const SKIRT_LIGHT = '#8c4a70';
const APRON = '#ddd0b2';
const APRON_SHADE = '#a8977a';
const APRON_STAIN = '#b8a07a';
const RIBBON = '#e06040';
const BOOT = '#2e2220';
const BOOT_SHINE = '#6a5048';
const CANE = '#6b4526';
const CANE_LIGHT = '#9a6c40';
const CANE_TIP = '#1a1414';
const SHADOW = '#000000';
const COIN = '#f2c440';

// ── Line weights ─────────────────────────────────────────────────────────────

/** Heavy enough to survive the halving to a 32 px tile as a real edge. */
const OUTLINE_WIDTH = 0.022;
const DETAIL_WIDTH = 0.014;
const FINE_WIDTH = 0.01;

// ── Proportions ──────────────────────────────────────────────────────────────

/**
 * She stands a little under one tile to the crown of her hair — about half of
 * the human crawler's two tiles, which puts her at a tall man's waist. The stoop takes the
 * rest: upright she would be a head taller.
 */
const WAIST_Y = -0.47;
const SHOULDER_Y = -0.62;
/** The rounded upper back rises past the shoulder points; head-on it frames the sunken head. */
const SHOULDER_HUMP_Y = -0.72;
const SHOULDER_HALF = 0.215;
const NECK_HALF = 0.07;
const WAIST_HALF = 0.205;
const BELLY_HALF = 0.235;
const CARDIGAN_HEM_Y = -0.3;
const SKIRT_HEM_Y = -0.035;
const SKIRT_HEM_HALF = 0.25;
const SKIRT_WAIST_HALF = 0.2;

/** Head-on the head is a broad oval sunk between the shoulders: the chin sits on the collar. */
const HEAD_Y = -0.73;
const HEAD_RX = 0.114;
const HEAD_RY = 0.123;
/** In profile the head is pushed forward of the chest by the curve of the spine. */
const SIDE_HEAD_D = 0.17;
const SIDE_HEAD_Y = -0.74;
const SIDE_HEAD_RD = 0.118;

const UPPER_ARM = 0.18;
const FOREARM = 0.16;
const SLEEVE_WIDTH = 0.085;
const HAND_RADIUS = 0.042;

const CANE_LENGTH = 0.4;
const CANE_WIDTH = 0.026;
const CANE_CROOK_RADIUS = 0.045;

/** The right shoulder joint, in body space, before any twist. */
const RIGHT_SHOULDER: Vec3 = { l: -0.19, y: -0.6, d: 0.02 };
const LEFT_SHOULDER: Vec3 = { l: 0.19, y: -0.6, d: 0.02 };
/** Elbow poles: the free elbow swings out and back, the cane elbow out and down. */
const RIGHT_ELBOW_POLE: Vec3 = { l: -0.7, y: 0.45, d: -0.55 };
const LEFT_ELBOW_POLE: Vec3 = { l: 0.75, y: 0.35, d: -0.5 };

/**
 * Head-on, something nearer the camera draws a little lower on the floor: the
 * floor is seen from above while she is drawn as if seen level. Only what
 * stands on the floor — the cane's foot and her boots — takes it; a hand in the
 * air does not.
 */
const FLOOR_DEPTH_DROP = 0.15;

const TAU = Math.PI * 2;

// ── Pose ─────────────────────────────────────────────────────────────────────

/** A point in her body space: `l` toward her left (cane side), `y` down, `d` the way she faces. */
export interface Vec3 {
  readonly l: number;
  readonly y: number;
  readonly d: number;
}

/** One boot under the skirt. */
export interface FootPose {
  /** How far forward of her centre the boot is, + the way she faces. */
  readonly d: number;
  /** Height of the sole off the floor. */
  readonly lift: number;
  /** Rock of the boot, + heel up (rolling off the toe), − toe up (landing on the heel). */
  readonly pitch: number;
}

export interface LoriPose {
  /** Whole-body sideways shift toward the cane (+) or away (−). */
  readonly bodyL: number;
  /** How far the body has sunk, + down. */
  readonly dip: number;
  /** The torso's turn about the vertical: + brings the right shoulder back. */
  readonly twist: number;
  /** Extra head offsets on top of the body's. */
  readonly headL: number;
  readonly headDip: number;
  /** Head roll, + toward the cane side. */
  readonly headTilt: number;
  /** Profile only: how far the head juts forward, + out. */
  readonly headForward: number;
  /** Where the free (right) hand is. */
  readonly rightHand: Vec3;
  /** Where the cane's foot is planted. */
  readonly caneFoot: Vec3;
  /** How far the cane is lifted off the floor. */
  readonly caneLift: number;
  /** The cane's lean in the walking plane, + its top ahead of its foot. */
  readonly canePitch: number;
  /** The bad leg. */
  readonly rightFoot: FootPose;
  readonly leftFoot: FootPose;
  /** How far the skirt's hem is pushed ahead of her (+) by a striding leg. */
  readonly hemForward: number;
  /** How far the hem trails sideways from the waist, + toward the cane side. */
  readonly hemLateral: number;
  /** 0 open-eyed, 1 eyes shut. */
  readonly squint: number;
  /** Breath in the chest, 0–1. */
  readonly breath: number;
}

const RESTING_RIGHT_HAND: Vec3 = { l: -0.1, y: -0.38, d: 0.18 };
export const RESTING_CANE_FOOT: Vec3 = { l: 0.34, y: 0, d: 0.3 };
/** Where each boot stands at rest: the good foot a half-step ahead of the bad one. */
export const RESTING_RIGHT_FOOT_D = 0.08;
export const RESTING_LEFT_FOOT_D = 0.13;

export function restingPose(): LoriPose {
  return {
    bodyL: 0,
    dip: 0,
    twist: 0,
    headL: 0,
    headDip: 0,
    headTilt: 0,
    headForward: 0,
    rightHand: RESTING_RIGHT_HAND,
    caneFoot: RESTING_CANE_FOOT,
    caneLift: 0,
    canePitch: 0,
    rightFoot: { d: RESTING_RIGHT_FOOT_D, lift: 0, pitch: 0 },
    leftFoot: { d: RESTING_LEFT_FOOT_D, lift: 0, pitch: 0 },
    hemForward: 0,
    hemLateral: 0,
    squint: 0,
    breath: 0,
  };
}

// ── Vector helpers ───────────────────────────────────────────────────────────

function v3(l: number, y: number, d: number): Vec3 {
  return { l, y, d };
}

function add3(a: Vec3, b: Vec3): Vec3 {
  return v3(a.l + b.l, a.y + b.y, a.d + b.d);
}

function sub3(a: Vec3, b: Vec3): Vec3 {
  return v3(a.l - b.l, a.y - b.y, a.d - b.d);
}

function scale3(a: Vec3, k: number): Vec3 {
  return v3(a.l * k, a.y * k, a.d * k);
}

function dot3(a: Vec3, b: Vec3): number {
  return a.l * b.l + a.y * b.y + a.d * b.d;
}

function len3(a: Vec3): number {
  return Math.sqrt(dot3(a, a));
}

/** Guards every normalisation against a zero-length axis. */
const MIN_AXIS = 1e-6;

function norm3(a: Vec3): Vec3 {
  const length = Math.max(MIN_AXIS, len3(a));
  return scale3(a, 1 / length);
}

/** A hair short of full reach, so a straight arm never locks into a hinge with no elbow. */
const ARM_REACH_SLACK = 0.995;

/**
 * Two-bone solve in body space: the elbow lies on the circle the two segments
 * allow, on the side the pole points to. Solving in 3D and then projecting is
 * what keeps an arm thrown toward the camera foreshortened head-on and full
 * length in profile.
 */
function solveElbow(shoulder: Vec3, hand: Vec3, pole: Vec3): { elbow: Vec3; hand: Vec3 } {
  const reach = (UPPER_ARM + FOREARM) * ARM_REACH_SLACK;
  const toHand = sub3(hand, shoulder);
  const distance = Math.min(reach, Math.max(MIN_AXIS, len3(toHand)));
  const axis = norm3(toHand);
  const reached = add3(shoulder, scale3(axis, distance));
  const along = (distance * distance + UPPER_ARM * UPPER_ARM - FOREARM * FOREARM) / (2 * distance);
  const lift = Math.sqrt(Math.max(0, UPPER_ARM * UPPER_ARM - along * along));
  const poleOff = sub3(pole, scale3(axis, dot3(pole, axis)));
  const bend = norm3(poleOff);
  return { elbow: add3(add3(shoulder, scale3(axis, along)), scale3(bend, lift)), hand: reached };
}

// ── Views ────────────────────────────────────────────────────────────────────

export type LoriView = 'front' | 'side' | 'away';

/**
 * Which way her own left (+l) runs across the screen in a head-on view: to the
 * viewer's right when she faces the camera, to the viewer's left from behind.
 */
function lateralSign(view: 'front' | 'away'): number {
  return view === 'front' ? 1 : -1;
}

/** Body space to the cell's tile-unit plane for one view. */
function project(view: LoriView, p: Vec3): Pt {
  if (view === 'side') return { x: p.d, y: p.y };
  return { x: lateralSign(view) * p.l, y: p.y };
}

/**
 * A point on the floor. Head-on and from behind, whatever is nearer the camera
 * draws a little lower; in profile depth is the screen's own x.
 */
function projectOnFloor(view: LoriView, p: Vec3): Pt {
  if (view === 'side') return { x: p.d, y: p.y };
  const towardCamera = view === 'front' ? p.d : -p.d;
  return { x: lateralSign(view) * p.l, y: p.y + towardCamera * FLOOR_DEPTH_DROP };
}

/** The shoulders after the body's sway, sink and twist. */
function shoulders(pose: LoriPose): { right: Vec3; left: Vec3 } {
  const offset = v3(pose.bodyL, pose.dip, 0);
  const twistBack = Math.sin(pose.twist) * SHOULDER_HALF;
  return {
    right: add3(add3(RIGHT_SHOULDER, offset), v3(0, 0, -twistBack)),
    left: add3(add3(LEFT_SHOULDER, offset), v3(0, 0, twistBack)),
  };
}

interface Arms {
  readonly rightShoulder: Vec3;
  readonly rightElbow: Vec3;
  readonly rightHand: Vec3;
  readonly leftShoulder: Vec3;
  readonly leftElbow: Vec3;
  readonly leftHand: Vec3;
  readonly caneFoot: Vec3;
  readonly caneTop: Vec3;
}

/** How far the cane leans in toward her at the top. */
const CANE_LEAN_IN = 0.04;
/** The crook's grip sits this far along from the shaft's top toward her. */
const CANE_GRIP_IN = 0.03;
/** The cane's foot follows half of her sideways sway: the hand moves it, the floor holds it. */
const CANE_FOOT_SWAY_SHARE = 0.5;

/** Where the cane's foot is, lifted and swayed. */
export function caneFootOf(pose: LoriPose): Vec3 {
  return add3(pose.caneFoot, v3(pose.bodyL * CANE_FOOT_SWAY_SHARE, -pose.caneLift, 0));
}

function caneTopOf(pose: LoriPose, foot: Vec3): Vec3 {
  const rise = CANE_LENGTH * Math.cos(pose.canePitch);
  const reach = CANE_LENGTH * Math.sin(pose.canePitch);
  return add3(foot, v3(-CANE_LEAN_IN, -rise, reach - CANE_LEAN_IN / 2));
}

/**
 * The pitch that puts the cane's top at depth `topD` when its foot is at
 * `footD`: a planted cane pivots on its ferrule while the hand on it travels
 * with her.
 */
export function canePitchToReach(footD: number, topD: number): number {
  const along = (topD + CANE_LEAN_IN / 2 - footD) / CANE_LENGTH;
  return Math.asin(Math.max(-1, Math.min(1, along)));
}

function solveArms(pose: LoriPose): Arms {
  const { right, left } = shoulders(pose);
  const caneFoot = caneFootOf(pose);
  const caneTop = caneTopOf(pose, caneFoot);
  const caneGrip = add3(caneTop, v3(-CANE_GRIP_IN, 0, 0));
  const rightArm = solveElbow(right, pose.rightHand, RIGHT_ELBOW_POLE);
  const leftArm = solveElbow(left, caneGrip, LEFT_ELBOW_POLE);
  return {
    rightShoulder: right,
    rightElbow: rightArm.elbow,
    rightHand: rightArm.hand,
    leftShoulder: left,
    leftElbow: leftArm.elbow,
    leftHand: leftArm.hand,
    caneFoot,
    caneTop,
  };
}

/** Where the cane's ferrule is drawn, in the view's tile plane (origin between her feet). */
export function loriCaneTipPoint(view: LoriView, pose: LoriPose): Pt {
  return projectOnFloor(view, caneFootOf(pose));
}

// ── Drawing primitives ───────────────────────────────────────────────────────

/** A closed path through `points` whose corners are rounded by midpoint quadratics. */
function smoothClosed(ctx: Ctx, points: readonly Pt[]): void {
  const count = points.length;
  if (count < 3) return;
  const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const start = mid(points[count - 1], points[0]);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  for (let i = 0; i < count; i++) {
    const corner = points[i];
    const next = mid(corner, points[(i + 1) % count]);
    ctx.quadraticCurveTo(corner.x, corner.y, next.x, next.y);
  }
  ctx.closePath();
}

function fillOutlined(ctx: Ctx, fill: string | CanvasGradient, width = OUTLINE_WIDTH): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function ellipsePath(ctx: Ctx, x: number, y: number, rx: number, ry: number, rot = 0): void {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(MIN_AXIS, rx), Math.max(MIN_AXIS, ry), rot, 0, TAU);
}

function line(ctx: Ctx, a: Pt, b: Pt, color: string, width: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

/** A tube with an outline: the outline stroke first, the fill stroke over it. */
function tube(ctx: Ctx, points: readonly Pt[], color: string, width: number): void {
  const trace = (): void => {
    ctx.beginPath();
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  trace();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = width + OUTLINE_WIDTH * 2;
  ctx.stroke();
  trace();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function shadowUnder(ctx: Ctx, x: number, halfWidth: number): void {
  fillSoftEllipse(ctx, x, 0, halfWidth, halfWidth * 0.32, SHADOW, 0.42, 0, 0.55);
}

// ── Cane ─────────────────────────────────────────────────────────────────────

function drawCane(ctx: Ctx, view: LoriView, arms: Arms): void {
  const foot = projectOnFloor(view, arms.caneFoot);
  const top = project(view, arms.caneTop);
  // Head-on and in profile the stick is on the +x side of her body; from
  // behind it is on the -x side. Either way the crook curls back toward her,
  // over the gripping hand.
  const towardHer = view === 'away' ? 1 : -1;
  const crookEnd = { x: top.x + towardHer * CANE_CROOK_RADIUS * 1.6, y: top.y + 0.035 };
  const crookPeak = { x: top.x + towardHer * CANE_CROOK_RADIUS * 0.5, y: top.y - 0.05 };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const trace = (): void => {
    ctx.beginPath();
    ctx.moveTo(foot.x, foot.y);
    ctx.lineTo(top.x, top.y);
    ctx.quadraticCurveTo(crookPeak.x + 0.03, crookPeak.y, crookPeak.x, crookPeak.y);
    ctx.quadraticCurveTo(crookEnd.x + 0.005, crookPeak.y, crookEnd.x, crookEnd.y);
  };
  trace();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = CANE_WIDTH + OUTLINE_WIDTH * 1.6;
  ctx.stroke();
  trace();
  ctx.strokeStyle = CANE;
  ctx.lineWidth = CANE_WIDTH;
  ctx.stroke();
  // A lit edge down the shaft keeps it a turned stick rather than a flat strip.
  line(
    ctx,
    { x: foot.x - CANE_WIDTH * 0.2, y: foot.y - 0.03 },
    { x: top.x - CANE_WIDTH * 0.2, y: top.y + 0.02 },
    CANE_LIGHT,
    CANE_WIDTH * 0.35,
  );
  line(
    ctx,
    foot,
    { x: lerp(foot.x, top.x, 0.08), y: lerp(foot.y, top.y, 0.08) },
    CANE_TIP,
    CANE_WIDTH * 1.25,
  );
}

// ── Hands ────────────────────────────────────────────────────────────────────

function drawHand(ctx: Ctx, wrist: Pt, hand: Pt): void {
  const angle = Math.atan2(hand.y - wrist.y, hand.x - wrist.x);
  const along = { x: Math.cos(angle), y: Math.sin(angle) };
  const centre = {
    x: hand.x + along.x * HAND_RADIUS * 0.35,
    y: hand.y + along.y * HAND_RADIUS * 0.35,
  };
  ellipsePath(ctx, centre.x, centre.y, HAND_RADIUS * 1.1, HAND_RADIUS * 0.9, angle);
  fillOutlined(ctx, SKIN, DETAIL_WIDTH);
  // Knuckle line, so the fist reads as fingers folded over rather than a ball.
  ctx.strokeStyle = SKIN_SHADE;
  ctx.lineWidth = FINE_WIDTH;
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, HAND_RADIUS * 0.6, angle - 0.9, angle + 0.9);
  ctx.stroke();
}

// ── Hair ─────────────────────────────────────────────────────────────────────

/** A braid as a rope of overlapping lobes, tied off with a ribbon and a tuft. */
function drawBraid(ctx: Ctx, from: Pt, to: Pt, width: number): void {
  const lobes = 5;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const angle = Math.atan2(dy, dx);
  tube(ctx, [from, to], HAIR, width);
  for (let i = 0; i < lobes; i++) {
    const t = (i + 0.5) / lobes;
    const side = i % 2 === 0 ? 1 : -1;
    const cx = from.x + dx * t;
    const cy = from.y + dy * t;
    const normal = { x: -Math.sin(angle), y: Math.cos(angle) };
    // Each lobe is a short slanted stroke: the chevron is what says "plaited" at 32 px.
    const a = {
      x: cx + normal.x * side * width * 0.45,
      y: cy + normal.y * side * width * 0.45 - dy * 0.05,
    };
    const b = {
      x: cx - normal.x * side * width * 0.1,
      y: cy - normal.y * side * width * 0.1 + dy * 0.06,
    };
    line(ctx, a, b, HAIR_SHADE, FINE_WIDTH);
    line(
      ctx,
      { x: a.x - normal.x * side * width * 0.1, y: a.y - 0.008 },
      { x: b.x - normal.x * side * width * 0.05, y: b.y - 0.01 },
      HAIR_LIGHT,
      FINE_WIDTH * 0.8,
    );
  }
  // The loose end is a short grey brush fanning out under the tie. Long and
  // pale, two of them hanging on her chest read as tusks.
  const tuftTip = {
    x: to.x + Math.cos(angle) * width * 0.8,
    y: to.y + Math.sin(angle) * width * 0.8,
  };
  ctx.beginPath();
  ctx.moveTo(to.x - width * 0.3, to.y);
  ctx.quadraticCurveTo(tuftTip.x - width * 0.6, tuftTip.y, tuftTip.x, tuftTip.y + width * 0.1);
  ctx.quadraticCurveTo(tuftTip.x + width * 0.6, tuftTip.y, to.x + width * 0.3, to.y);
  ctx.closePath();
  fillOutlined(ctx, HAIR, FINE_WIDTH);
  ellipsePath(ctx, to.x, to.y, width * 0.55, width * 0.26, angle + Math.PI / 2);
  fillOutlined(ctx, RIBBON, FINE_WIDTH);
}

// ── Head, front ──────────────────────────────────────────────────────────────

const BRAID_WIDTH = 0.05;
/** How far her mouth turns up at one corner, 0 flat to 1 a wide grin. */
const MOUTH_GRIN = 0.35;

/** An open path through `points` with its interior corners rounded, matching `smoothClosed`. */
function smoothOpen(ctx: Ctx, points: readonly Pt[]): void {
  const count = points.length;
  if (count < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < count - 1; i++) {
    const corner = points[i];
    const next = points[i + 1];
    ctx.quadraticCurveTo(corner.x, corner.y, (corner.x + next.x) / 2, (corner.y + next.y) / 2);
  }
  ctx.lineTo(points[count - 1].x, points[count - 1].y);
}

/**
 * Fills a hair mass and inks only its outer contour. The hairline, where hair
 * meets skin, gets a faint shade line instead: an inked hairline is the rim of
 * a cap, and it is the single thing that most makes grey hair read as a helmet.
 */
function paintHair(ctx: Ctx, outer: readonly Pt[], hairline: readonly Pt[]): void {
  smoothClosed(ctx, [...outer, ...hairline]);
  ctx.fillStyle = HAIR;
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  smoothOpen(ctx, outer);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.stroke();
  smoothOpen(ctx, hairline);
  ctx.strokeStyle = rgba(HAIR_SHADE, 0.7);
  ctx.lineWidth = FINE_WIDTH;
  ctx.stroke();
}

/**
 * The outer edge of her hair head-on, temple to temple over the crown, as a
 * walk of small uneven tufts: a clean arc here reads as a helmet.
 */
const HAIR_CROWN_FRONT: readonly Pt[] = [
  { x: -HEAD_RX * 1.04, y: HEAD_RY * 0.16 },
  { x: -HEAD_RX * 1.1, y: -HEAD_RY * 0.3 },
  { x: -HEAD_RX * 1.0, y: -HEAD_RY * 0.72 },
  { x: -HEAD_RX * 0.78, y: -HEAD_RY * 1.0 },
  { x: -HEAD_RX * 0.5, y: -HEAD_RY * 1.16 },
  { x: -HEAD_RX * 0.2, y: -HEAD_RY * 1.14 },
  { x: 0, y: -HEAD_RY * 1.06 },
  { x: HEAD_RX * 0.22, y: -HEAD_RY * 1.15 },
  { x: HEAD_RX * 0.55, y: -HEAD_RY * 1.12 },
  { x: HEAD_RX * 0.84, y: -HEAD_RY * 0.94 },
  { x: HEAD_RX * 1.06, y: -HEAD_RY * 0.66 },
  { x: HEAD_RX * 1.1, y: -HEAD_RY * 0.26 },
  { x: HEAD_RX * 1.04, y: HEAD_RY * 0.16 },
];

/**
 * The hairline, right temple back to the left: nearly straight with a shallow
 * dip at the parting, and set low because her bowed head shows its crown.
 */
const HAIR_LINE_FRONT: readonly Pt[] = [
  { x: HEAD_RX * 0.92, y: -HEAD_RY * 0.05 },
  { x: HEAD_RX * 0.62, y: -HEAD_RY * 0.34 },
  { x: HEAD_RX * 0.22, y: -HEAD_RY * 0.36 },
  { x: 0, y: -HEAD_RY * 0.28 },
  { x: -HEAD_RX * 0.22, y: -HEAD_RY * 0.36 },
  { x: -HEAD_RX * 0.62, y: -HEAD_RY * 0.34 },
  { x: -HEAD_RX * 0.92, y: -HEAD_RY * 0.05 },
];

function drawHeadFront(ctx: Ctx, pose: LoriPose): void {
  const cx = pose.bodyL + pose.headL;
  const cy = HEAD_Y + pose.dip + pose.headDip;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(pose.headTilt);

  // Ears peek out below the hair, low and big as old ears are.
  for (const side of [-1, 1]) {
    ellipsePath(ctx, side * HEAD_RX * 0.98, 0.02, 0.028, 0.042, side * 0.2);
    fillOutlined(ctx, SKIN_SHADE, DETAIL_WIDTH);
  }

  // Face: broad cheeks holding their width to the mouth, then a soft jowly chin.
  const faceTrace = (): void => {
    smoothClosed(ctx, [
      { x: -HEAD_RX * 0.92, y: -HEAD_RY * 0.55 },
      { x: 0, y: -HEAD_RY * 0.95 },
      { x: HEAD_RX * 0.92, y: -HEAD_RY * 0.55 },
      { x: HEAD_RX * 1.02, y: HEAD_RY * 0.3 },
      { x: HEAD_RX * 0.8, y: HEAD_RY * 0.85 },
      { x: 0, y: HEAD_RY * 1.05 },
      { x: -HEAD_RX * 0.8, y: HEAD_RY * 0.85 },
      { x: -HEAD_RX * 1.02, y: HEAD_RY * 0.3 },
    ]);
  };
  faceTrace();
  fillOutlined(ctx, SKIN);
  withClip(ctx, faceTrace, () => {
    // Light from the upper left; the shadow side follows the jaw on the right.
    fillSoftEllipse(
      ctx,
      HEAD_RX * 0.75,
      HEAD_RY * 0.55,
      HEAD_RX * 0.7,
      HEAD_RY * 0.8,
      SKIN_SHADE,
      0.55,
      -0.4,
    );
    fillSoftEllipse(
      ctx,
      -HEAD_RX * 0.35,
      -HEAD_RY * 0.2,
      HEAD_RX * 0.5,
      HEAD_RY * 0.45,
      SKIN_LIGHT,
      0.5,
      -0.4,
    );
    fillSoftEllipse(
      ctx,
      -HEAD_RX * 0.55,
      HEAD_RY * 0.32,
      HEAD_RX * 0.28,
      HEAD_RY * 0.2,
      ROSY,
      0.55,
    );
    fillSoftEllipse(ctx, HEAD_RX * 0.55, HEAD_RY * 0.32, HEAD_RX * 0.28, HEAD_RY * 0.2, ROSY, 0.45);
  });
  // Eyes: deep-set slits under heavy brows.
  const eyeY = HEAD_RY * 0.08;
  const eyeOpen = lerp(0.011, 0.003, clamp01(pose.squint));
  for (const side of [-1, 1]) {
    const ex = side * HEAD_RX * 0.42;
    ellipsePath(ctx, ex, eyeY, 0.016, eyeOpen, 0);
    ctx.fillStyle = EYE;
    ctx.fill();
    // Bags under the eyes: an old face is mostly in the lids.
    ctx.beginPath();
    ctx.arc(ex, eyeY + 0.004, 0.018, 0.25 * Math.PI, 0.75 * Math.PI);
    ctx.strokeStyle = SKIN_SHADE;
    ctx.lineWidth = FINE_WIDTH;
    ctx.stroke();
    line(
      ctx,
      { x: ex + side * 0.03, y: eyeY },
      { x: ex + side * 0.045, y: eyeY - 0.008 },
      SKIN_SHADE,
      FINE_WIDTH,
    );
    line(
      ctx,
      { x: ex + side * 0.03, y: eyeY + 0.006 },
      { x: ex + side * 0.045, y: eyeY + 0.014 },
      SKIN_SHADE,
      FINE_WIDTH,
    );
    // Bushy grey brow, drooping at its outer end.
    ctx.beginPath();
    ctx.moveTo(ex - side * 0.03, eyeY - 0.03 + pose.squint * 0.006);
    ctx.quadraticCurveTo(ex, eyeY - 0.05, ex + side * 0.042, eyeY - 0.022);
    ctx.strokeStyle = BROW;
    ctx.lineWidth = 0.02;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
  // The nose: a big round dwarf's nose, reddened at the tip.
  const noseY = HEAD_RY * 0.42;
  fillSoftEllipse(ctx, 0.008, noseY + 0.012, 0.05, 0.04, SKIN_SHADE, 0.7);
  ellipsePath(ctx, 0, noseY, 0.044, 0.04, 0);
  ctx.fillStyle = mix(SKIN, ROSY, 0.5);
  ctx.fill();
  fillSoftEllipse(ctx, -0.014, noseY - 0.012, 0.018, 0.014, SKIN_LIGHT, 0.9);
  // Only the underside is inked: the nostrils and the shadow the bulb casts.
  ctx.beginPath();
  ctx.arc(0, noseY, 0.044, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = DETAIL_WIDTH;
  ctx.stroke();
  for (const side of [-1, 1]) {
    ellipsePath(ctx, side * 0.017, noseY + 0.026, 0.009, 0.006, 0);
    ctx.fillStyle = MOUTH;
    ctx.fill();
  }
  // Mouth: a crooked, knowing half-smile.
  const mouthY = HEAD_RY * 0.8;
  const grin = MOUTH_GRIN;
  ctx.beginPath();
  ctx.moveTo(-0.045, mouthY - grin * 0.012);
  ctx.quadraticCurveTo(-0.005, mouthY + 0.012 + grin * 0.01, 0.05, mouthY - grin * 0.022);
  ctx.strokeStyle = MOUTH;
  ctx.lineWidth = DETAIL_WIDTH;
  ctx.stroke();
  // Hair: grey, scraped back from a centre parting and flat across the crown.
  const hairTrace = (): void => {
    smoothClosed(ctx, [...HAIR_CROWN_FRONT, ...HAIR_LINE_FRONT]);
  };
  paintHair(ctx, HAIR_CROWN_FRONT, HAIR_LINE_FRONT);
  withClip(ctx, hairTrace, () => {
    // Each side of the parting is its own swept lobe, lit on its crown; one
    // continuous highlight across the top is what makes a dome a helmet.
    for (const side of [-1, 1]) {
      fillSoftEllipse(
        ctx,
        side * HEAD_RX * 0.48,
        -HEAD_RY * 0.82,
        HEAD_RX * 0.34,
        HEAD_RY * 0.2,
        HAIR_LIGHT,
        side < 0 ? 0.9 : 0.6,
        side * 0.5,
      );
    }
    fillSoftEllipse(
      ctx,
      HEAD_RX * 0.85,
      -HEAD_RY * 0.2,
      HEAD_RX * 0.4,
      HEAD_RY * 0.5,
      HAIR_SHADE,
      0.6,
    );
    // Two combed strands a side, uneven, so it is hair and not the ribs of a helmet.
    for (const side of [-1, 1]) {
      for (const t of side < 0 ? [0.35, 0.72] : [0.28, 0.64]) {
        ctx.beginPath();
        ctx.moveTo(side * 0.012, -HEAD_RY * (0.4 + t * 0.6));
        ctx.quadraticCurveTo(
          side * HEAD_RX * 0.55,
          -HEAD_RY * (0.6 + t * 0.35),
          side * HEAD_RX * (0.9 + t * 0.08),
          -HEAD_RY * (0.15 - t * 0.2),
        );
        ctx.strokeStyle = rgba(HAIR_SHADE, 0.6);
        ctx.lineWidth = FINE_WIDTH * 0.7;
        ctx.stroke();
      }
    }
  });
  line(
    ctx,
    { x: 0, y: -HEAD_RY * 0.34 },
    { x: 0.004, y: -HEAD_RY * 0.95 },
    rgba(HAIR_SHADE, 0.8),
    FINE_WIDTH,
  );
  ctx.restore();
}

// ── Head, profile ────────────────────────────────────────────────────────────

/** Her hair in profile: brow over the crown and down to the nape, flat to the skull. */
const HAIR_CROWN_SIDE: readonly Pt[] = [
  { x: SIDE_HEAD_RD * 0.45, y: -HEAD_RY * 0.66 },
  { x: SIDE_HEAD_RD * 0.52, y: -HEAD_RY * 1.0 },
  { x: SIDE_HEAD_RD * 0.1, y: -HEAD_RY * 1.14 },
  { x: -SIDE_HEAD_RD * 0.55, y: -HEAD_RY * 1.06 },
  { x: -SIDE_HEAD_RD * 0.98, y: -HEAD_RY * 0.55 },
  { x: -SIDE_HEAD_RD * 1.04, y: HEAD_RY * 0.1 },
  { x: -SIDE_HEAD_RD * 0.85, y: HEAD_RY * 0.5 },
];

/** The profile hairline, nape back round the ear to the brow. */
const HAIR_LINE_SIDE: readonly Pt[] = [
  { x: -SIDE_HEAD_RD * 0.55, y: HEAD_RY * 0.42 },
  { x: -SIDE_HEAD_RD * 0.36, y: 0 },
  { x: -SIDE_HEAD_RD * 0.18, y: -HEAD_RY * 0.32 },
  { x: SIDE_HEAD_RD * 0.1, y: -HEAD_RY * 0.52 },
  { x: SIDE_HEAD_RD * 0.3, y: -HEAD_RY * 0.6 },
];

function drawHeadSide(ctx: Ctx, pose: LoriPose): void {
  const cx = SIDE_HEAD_D + pose.headForward;
  const cy = SIDE_HEAD_Y + pose.dip + pose.headDip;
  const rd = SIDE_HEAD_RD;
  const ry = HEAD_RY;
  ctx.save();
  ctx.translate(cx, cy);
  // In profile a roll toward the cane side reads as a nod.
  ctx.rotate(pose.headTilt * 0.6);

  const faceTrace = (): void => {
    ctx.beginPath();
    ctx.moveTo(-rd * 0.9, -ry * 0.5);
    ctx.quadraticCurveTo(-rd * 0.4, -ry * 1.02, rd * 0.35, -ry * 0.92);
    // Brow, then the bridge of the nose.
    ctx.quadraticCurveTo(rd * 0.85, -ry * 0.7, rd * 0.86, -ry * 0.2);
    ctx.quadraticCurveTo(rd * 0.9, -ry * 0.05, rd * 0.95, ry * 0.05);
    // The big nose.
    ctx.quadraticCurveTo(rd * 1.35, ry * 0.2, rd * 1.2, ry * 0.46);
    ctx.quadraticCurveTo(rd * 1.02, ry * 0.58, rd * 0.86, ry * 0.5);
    // Lips, and the chin tucked under them.
    ctx.quadraticCurveTo(rd * 0.9, ry * 0.66, rd * 0.82, ry * 0.76);
    ctx.quadraticCurveTo(rd * 0.9, ry * 0.95, rd * 0.62, ry * 1.08);
    ctx.quadraticCurveTo(rd * 0.1, ry * 1.12, -rd * 0.2, ry * 0.75);
    ctx.quadraticCurveTo(-rd * 0.9, ry * 0.4, -rd * 0.9, -ry * 0.5);
    ctx.closePath();
  };
  faceTrace();
  fillOutlined(ctx, SKIN);
  withClip(ctx, faceTrace, () => {
    fillSoftEllipse(ctx, rd * 0.1, ry * 0.8, rd * 0.7, ry * 0.4, SKIN_SHADE, 0.5, 0.2);
    fillSoftEllipse(ctx, rd * 0.5, -ry * 0.3, rd * 0.35, ry * 0.35, SKIN_LIGHT, 0.55);
    fillSoftEllipse(ctx, rd * 0.45, ry * 0.35, rd * 0.26, ry * 0.2, ROSY, 0.6);
    fillSoftEllipse(ctx, rd * 1.1, ry * 0.3, rd * 0.2, ry * 0.18, ROSY, 0.7);
  });
  const eyeX = rd * 0.58;
  const eyeY = -ry * 0.12;
  ellipsePath(ctx, eyeX, eyeY, 0.016, lerp(0.016, 0.005, clamp01(pose.squint)), 0);
  ctx.fillStyle = EYE;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(eyeX - 0.035, eyeY - 0.03);
  ctx.quadraticCurveTo(eyeX, eyeY - 0.05 + pose.squint * 0.01, eyeX + 0.03, eyeY - 0.03);
  ctx.strokeStyle = BROW;
  ctx.lineWidth = 0.017;
  ctx.lineCap = 'round';
  ctx.stroke();
  line(
    ctx,
    { x: eyeX - 0.03, y: eyeY + 0.004 },
    { x: eyeX - 0.045, y: eyeY + 0.014 },
    SKIN_SHADE,
    FINE_WIDTH,
  );
  const grin = MOUTH_GRIN;
  ctx.beginPath();
  ctx.moveTo(rd * 0.88, ry * 0.66);
  ctx.quadraticCurveTo(rd * 0.7, ry * 0.72, rd * 0.55, ry * (0.62 - grin * 0.1));
  ctx.strokeStyle = MOUTH;
  ctx.lineWidth = DETAIL_WIDTH;
  ctx.stroke();
  ellipsePath(ctx, -rd * 0.14, ry * 0.14, 0.022, 0.034, 0.2);
  fillOutlined(ctx, mix(SKIN, SKIN_SHADE, 0.5), FINE_WIDTH);
  line(
    ctx,
    { x: -rd * 0.12, y: ry * 0.05 },
    { x: -rd * 0.1, y: ry * 0.22 },
    SKIN_SHADE,
    FINE_WIDTH,
  );
  // Hair, pulled back to a knot at the nape where the braid starts.
  const hairTrace = (): void => {
    smoothClosed(ctx, [...HAIR_CROWN_SIDE, ...HAIR_LINE_SIDE]);
  };
  paintHair(ctx, HAIR_CROWN_SIDE, HAIR_LINE_SIDE);
  withClip(ctx, hairTrace, () => {
    fillSoftEllipse(ctx, -rd * 0.1, -ry * 0.95, rd * 0.6, ry * 0.3, HAIR_LIGHT, 0.85, -0.2);
    fillSoftEllipse(ctx, -rd * 0.8, ry * 0.2, rd * 0.35, ry * 0.4, HAIR_SHADE, 0.6);
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      ctx.beginPath();
      ctx.moveTo(rd * (0.35 - t * 0.1), -ry * (0.65 + t * 0.3));
      ctx.quadraticCurveTo(
        -rd * 0.5,
        -ry * (0.9 - t * 0.2),
        -rd * (0.8 - t * 0.1),
        ry * (0.1 + t * 0.2),
      );
      ctx.strokeStyle = HAIR_SHADE;
      ctx.lineWidth = FINE_WIDTH * 0.8;
      ctx.stroke();
    }
  });
  ctx.restore();
}

// ── Body, head-on and from behind ────────────────────────────────────────────

/** How much of a boot's lift its side of the hem rides up by. */
const HEM_RIDE_SHARE = 0.6;
/**
 * Head-on, a boot stepped out ahead of where it stands pushes its side of the
 * hem down toward the camera by this share of the step.
 */
const HEM_STEP_PUSH = 0.3;

/** How far a boot is stepped out ahead of where it stands, never behind. */
function stepAhead(pose: LoriPose, side: 'right' | 'left'): number {
  return side === 'right'
    ? Math.max(0, pose.rightFoot.d - RESTING_RIGHT_FOOT_D)
    : Math.max(0, pose.leftFoot.d - RESTING_LEFT_FOOT_D);
}

function skirtHeadOn(ctx: Ctx, view: 'front' | 'away', pose: LoriPose): void {
  const sign = lateralSign(view);
  const x = sign * pose.bodyL;
  const hemX = x + sign * pose.hemLateral;
  const top = WAIST_Y + pose.dip + 0.03;
  const hem = SKIRT_HEM_Y;
  const midX = lerp(x, hemX, 0.55);
  // Her right foot is under the viewer's left head-on and the viewer's right from behind.
  const screenLeftLift = sign > 0 ? pose.rightFoot.lift : pose.leftFoot.lift;
  const screenRightLift = sign > 0 ? pose.leftFoot.lift : pose.rightFoot.lift;
  const towardCamera = sign > 0 ? 1 : -1;
  const screenLeftPush =
    towardCamera * HEM_STEP_PUSH * stepAhead(pose, sign > 0 ? 'right' : 'left');
  const screenRightPush =
    towardCamera * HEM_STEP_PUSH * stepAhead(pose, sign > 0 ? 'left' : 'right');
  const trace = (): void => {
    ctx.beginPath();
    ctx.moveTo(x - SKIRT_WAIST_HALF, top);
    ctx.quadraticCurveTo(
      midX - SKIRT_HEM_HALF * 1.05,
      lerp(top, hem, 0.55),
      hemX - SKIRT_HEM_HALF,
      hem - screenLeftLift * HEM_RIDE_SHARE + screenLeftPush,
    );
    // The hem waves where the folds meet it, rides up over a boot as it lifts
    // and swings out over one stepping ahead.
    ctx.quadraticCurveTo(
      hemX - SKIRT_HEM_HALF * 0.55,
      hem + 0.02 - screenLeftLift + screenLeftPush,
      hemX - SKIRT_HEM_HALF * 0.2,
      hem,
    );
    ctx.quadraticCurveTo(
      hemX + SKIRT_HEM_HALF * 0.15,
      hem + 0.02,
      hemX + SKIRT_HEM_HALF * 0.45,
      hem - 0.005,
    );
    ctx.quadraticCurveTo(
      hemX + SKIRT_HEM_HALF * 0.8,
      hem + 0.02 - screenRightLift + screenRightPush,
      hemX + SKIRT_HEM_HALF,
      hem - screenRightLift * HEM_RIDE_SHARE + screenRightPush,
    );
    ctx.quadraticCurveTo(
      midX + SKIRT_HEM_HALF * 1.05,
      lerp(top, hem, 0.55),
      x + SKIRT_WAIST_HALF,
      top,
    );
    ctx.closePath();
  };
  trace();
  fillOutlined(ctx, SKIRT);
  withClip(ctx, trace, () => {
    fillSoftEllipse(ctx, hemX + SKIRT_HEM_HALF * 0.8, hem - 0.1, 0.14, 0.2, SKIRT_SHADE, 0.7);
    fillSoftEllipse(ctx, x - SKIRT_HEM_HALF * 0.7, top + 0.12, 0.1, 0.14, SKIRT_LIGHT, 0.55);
    for (const fx of [-0.7, -0.2, 0.45, 0.85]) {
      ctx.beginPath();
      ctx.moveTo(x + SKIRT_WAIST_HALF * fx, top + 0.04);
      ctx.quadraticCurveTo(
        lerp(x, hemX, 0.6) + SKIRT_HEM_HALF * fx * 1.05,
        lerp(top, hem, 0.6),
        hemX + SKIRT_HEM_HALF * fx * 1.1,
        hem,
      );
      ctx.strokeStyle = SKIRT_SHADE;
      ctx.lineWidth = DETAIL_WIDTH;
      ctx.stroke();
    }
  });
}

const BOOT_REST_Y = -0.012;
const BOOT_RX = 0.06;
const BOOT_RY = 0.03;
/** Each boot's distance from her centre line, head-on. */
const BOOT_SPREAD = 0.09;
/** The boots follow this share of her sideways sway; the rest is the body over them. */
const BOOT_SWAY_SHARE = 0.3;

/**
 * Head-on or from behind. The boots are drawn level where they stand at rest;
 * only a step away from that stance takes the floor's depth.
 */
type BootSide = 'right' | 'left';
const BOOT_SIDES: readonly BootSide[] = ['right', 'left'];

function footOf(pose: LoriPose, side: BootSide): FootPose {
  return side === 'right' ? pose.rightFoot : pose.leftFoot;
}

function restingFootD(side: BootSide): number {
  return side === 'right' ? RESTING_RIGHT_FOOT_D : RESTING_LEFT_FOOT_D;
}

function bootCentreHeadOn(view: 'front' | 'away', pose: LoriPose, side: BootSide): Pt {
  const foot = footOf(pose, side);
  const lateral = side === 'right' ? -BOOT_SPREAD : BOOT_SPREAD;
  const restD = restingFootD(side);
  return projectOnFloor(
    view,
    v3(pose.bodyL * BOOT_SWAY_SHARE + lateral, BOOT_REST_Y - foot.lift, foot.d - restD),
  );
}

function bootsHeadOn(ctx: Ctx, view: 'front' | 'away', pose: LoriPose): void {
  for (const side of BOOT_SIDES) {
    const at = bootCentreHeadOn(view, pose, side);
    ellipsePath(ctx, at.x, at.y, BOOT_RX, BOOT_RY, 0);
    fillOutlined(ctx, BOOT, DETAIL_WIDTH);
    bootShine(ctx, at.x, at.y + BOOT_RY * BOOT_SHINE_DROP, BOOT_RX);
  }
}

/** The lit toe cap's place below a boot's centre, as a share of its height: under the hem. */
const BOOT_SHINE_DROP = 0.25;
const BOOT_SHINE_ALPHA = 0.9;

/**
 * A worn leather toe cap catching the light. Without it a dark boot under her
 * dark-outlined hem merges with the outline and the shadow, and the step that
 * slides it back under her goes unseen.
 */
function bootShine(ctx: Ctx, x: number, y: number, rx: number): void {
  fillSoftEllipse(ctx, x, y, rx * 0.55, BOOT_RY * 0.4, BOOT_SHINE, BOOT_SHINE_ALPHA);
}

function shadowHeadOn(ctx: Ctx, view: 'front' | 'away', pose: LoriPose): void {
  shadowUnder(ctx, lateralSign(view) * (pose.bodyL * 0.5 + 0.03), 0.32);
}

function torsoFrontTrace(ctx: Ctx, pose: LoriPose): void {
  const x = pose.bodyL;
  const dip = pose.dip;
  const twistNarrow = Math.cos(pose.twist);
  const shoulderHalf = SHOULDER_HALF * lerp(0.9, 1, twistNarrow);
  const breath = pose.breath * 0.008;
  smoothClosed(ctx, [
    // Her upper back rises behind the sunken head: head-on, that hump showing
    // either side of the skull is what says she is bent forward.
    { x: x - NECK_HALF * 1.6, y: SHOULDER_HUMP_Y + dip - 0.06 },
    { x: x + NECK_HALF * 1.6, y: SHOULDER_HUMP_Y + dip - 0.06 },
    // Rounded, sloping shoulders: an old woman's, carried high around the neck.
    { x: x + shoulderHalf * 0.8, y: SHOULDER_HUMP_Y + dip + 0.03 },
    { x: x + shoulderHalf + 0.03, y: SHOULDER_Y + dip + 0.02 },
    { x: x + WAIST_HALF + breath + 0.01, y: -0.52 + dip },
    { x: x + BELLY_HALF + breath, y: -0.41 + dip },
    { x: x + BELLY_HALF - 0.01, y: CARDIGAN_HEM_Y + dip * 0.5 },
    { x: x - BELLY_HALF + 0.01, y: CARDIGAN_HEM_Y + dip * 0.5 },
    { x: x - BELLY_HALF - breath, y: -0.41 + dip },
    { x: x - WAIST_HALF - breath - 0.01, y: -0.52 + dip },
    { x: x - shoulderHalf - 0.03, y: SHOULDER_Y + dip + 0.02 },
    { x: x - shoulderHalf * 0.8, y: SHOULDER_HUMP_Y + dip + 0.03 },
  ]);
}

function torsoFront(ctx: Ctx, pose: LoriPose): void {
  const x = pose.bodyL;
  const dip = pose.dip;
  torsoFrontTrace(ctx, pose);
  fillOutlined(ctx, CARDIGAN);
  withClip(
    ctx,
    () => torsoFrontTrace(ctx, pose),
    () => {
      fillSoftEllipse(ctx, x - 0.12, -0.6 + dip, 0.12, 0.08, CARDIGAN_LIGHT, 0.7, -0.4);
      fillSoftEllipse(ctx, x + 0.17, -0.42 + dip, 0.1, 0.16, CARDIGAN_SHADE, 0.7);
      // The bosom's shelf: a shadow line under it is most of what shapes the front.
      ctx.beginPath();
      ctx.moveTo(x - 0.16, -0.5 + dip);
      ctx.quadraticCurveTo(x - 0.08, -0.46 + dip, x, -0.49 + dip);
      ctx.quadraticCurveTo(x + 0.08, -0.46 + dip, x + 0.16, -0.5 + dip);
      ctx.strokeStyle = CARDIGAN_SHADE;
      ctx.lineWidth = DETAIL_WIDTH * 1.4;
      ctx.stroke();
      // Knit ribbing at the hem.
      for (let i = -5; i <= 5; i++) {
        line(
          ctx,
          { x: x + i * 0.04, y: CARDIGAN_HEM_Y + dip * 0.5 - 0.035 },
          { x: x + i * 0.04, y: CARDIGAN_HEM_Y + dip * 0.5 },
          CARDIGAN_SHADE,
          FINE_WIDTH * 0.8,
        );
      }
    },
  );
  line(
    ctx,
    { x, y: SHOULDER_HUMP_Y + dip + 0.04 },
    { x, y: CARDIGAN_HEM_Y + dip * 0.5 },
    CARDIGAN_SHADE,
    DETAIL_WIDTH,
  );
  for (const by of [-0.6, -0.53, -0.46]) {
    ellipsePath(ctx, x + 0.012, by + dip, 0.012, 0.011, 0);
    ctx.fillStyle = BUTTON;
    ctx.fill();
  }
  // A white blouse collar peeping out at the neck.
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x, SHOULDER_HUMP_Y + dip + 0.04);
    ctx.lineTo(x + side * NECK_HALF * 1.25, SHOULDER_HUMP_Y + dip - 0.005);
    ctx.lineTo(x + side * NECK_HALF * 1.1, SHOULDER_HUMP_Y + dip + 0.05);
    ctx.closePath();
    fillOutlined(ctx, COLLAR, DETAIL_WIDTH);
  }
}

function apronFront(ctx: Ctx, pose: LoriPose): void {
  const x = pose.bodyL;
  const top = WAIST_Y + pose.dip + 0.02;
  const bottom = -0.1;
  const trace = (): void => {
    smoothClosed(ctx, [
      { x: x - 0.17, y: top },
      { x: x + 0.17, y: top },
      { x: x + 0.19, y: lerp(top, bottom, 0.5) },
      { x: x + 0.18, y: bottom },
      { x: x - 0.18, y: bottom },
      { x: x - 0.19, y: lerp(top, bottom, 0.5) },
    ]);
  };
  trace();
  fillOutlined(ctx, APRON);
  withClip(ctx, trace, () => {
    fillSoftEllipse(ctx, x + 0.16, lerp(top, bottom, 0.6), 0.08, 0.2, APRON_SHADE, 0.6);
    fillSoftEllipse(ctx, x + 0.06, -0.2, 0.03, 0.022, APRON_STAIN, 0.7);
    fillSoftEllipse(ctx, x - 0.1, -0.15, 0.022, 0.016, APRON_STAIN, 0.6);
  });
  // Waistband, and the coin pocket on her right.
  line(ctx, { x: x - 0.18, y: top + 0.012 }, { x: x + 0.18, y: top + 0.012 }, APRON_SHADE, 0.022);
  ctx.beginPath();
  ctx.rect(x - 0.15, -0.34, 0.12, 0.085);
  fillOutlined(ctx, mix(APRON, APRON_SHADE, 0.3), DETAIL_WIDTH);
  line(ctx, { x: x - 0.15, y: -0.325 }, { x: x - 0.03, y: -0.325 }, APRON_SHADE, FINE_WIDTH);
  // A gold rim showing over the pocket's lip says what's inside.
  ellipsePath(ctx, x - 0.085, -0.343, 0.02, 0.008, 0);
  ctx.fillStyle = COIN;
  ctx.fill();
}

function armHeadOn(
  ctx: Ctx,
  view: 'front' | 'away',
  shoulder: Vec3,
  elbow: Vec3,
  hand: Vec3,
): { wrist: Pt; hand: Pt } {
  const s = project(view, shoulder);
  const e = project(view, elbow);
  const h = project(view, hand);
  const wrist = { x: lerp(e.x, h.x, 0.86), y: lerp(e.y, h.y, 0.86) };
  tube(ctx, [s, e, wrist], CARDIGAN, SLEEVE_WIDTH);
  // A lit stripe down the upper arm gives the sleeve a front.
  line(
    ctx,
    { x: lerp(s.x, e.x, 0.2) - 0.01, y: lerp(s.y, e.y, 0.2) },
    { x: lerp(s.x, e.x, 0.8) - 0.01, y: lerp(s.y, e.y, 0.8) },
    rgba(CARDIGAN_LIGHT, 0.55),
    SLEEVE_WIDTH * 0.22,
  );
  const cuffStart = { x: lerp(e.x, wrist.x, 0.75), y: lerp(e.y, wrist.y, 0.75) };
  tube(ctx, [cuffStart, wrist], CARDIGAN_SHADE, SLEEVE_WIDTH * 0.95);
  return { wrist, hand: h };
}

/**
 * Head-on: cane, boots, skirt, cardigan, apron, braids, then the arms in front
 * of the body and the sunken head over the collar.
 */
export function drawLoriFront(ctx: Ctx, pose: LoriPose): void {
  const arms = solveArms(pose);
  shadowHeadOn(ctx, 'front', pose);
  bootsHeadOn(ctx, 'front', pose);
  skirtHeadOn(ctx, 'front', pose);
  torsoFront(ctx, pose);
  apronFront(ctx, pose);

  const headX = pose.bodyL + pose.headL;
  const headY = HEAD_Y + pose.dip + pose.headDip;
  for (const side of [-1, 1]) {
    drawBraid(
      ctx,
      { x: headX + side * HEAD_RX * 0.9, y: headY + 0.02 },
      { x: pose.bodyL + side * 0.115, y: -0.54 + pose.dip },
      BRAID_WIDTH,
    );
  }

  drawCane(ctx, 'front', arms);
  const right = armHeadOn(ctx, 'front', arms.rightShoulder, arms.rightElbow, arms.rightHand);
  const left = armHeadOn(ctx, 'front', arms.leftShoulder, arms.leftElbow, arms.leftHand);

  drawHeadFront(ctx, pose);

  drawHand(ctx, left.wrist, left.hand);
  drawHand(ctx, right.wrist, right.hand);
}

// ── Body, profile ────────────────────────────────────────────────────────────

/** In profile she is deep through the chest and deeper still through the curve of her back. */
const SIDE_BACK_D = -0.15;
const SIDE_FRONT_D = 0.17;

function skirtSide(ctx: Ctx, pose: LoriPose): void {
  const top = WAIST_Y + pose.dip + 0.03;
  const hem = SKIRT_HEM_Y;
  // A striding leg pushes the hem ahead of it; the waist stays where it is.
  const push = pose.hemForward;
  const midPush = push * 0.5;
  const trace = (): void => {
    ctx.beginPath();
    ctx.moveTo(SIDE_BACK_D + 0.01, top);
    ctx.quadraticCurveTo(
      SIDE_BACK_D - 0.06 + midPush,
      lerp(top, hem, 0.5),
      SIDE_BACK_D - 0.04 + push,
      hem,
    );
    ctx.quadraticCurveTo(push, hem + 0.02, SIDE_FRONT_D * 0.5 + push, hem - 0.005);
    ctx.quadraticCurveTo(SIDE_FRONT_D * 0.9 + push, hem + 0.02, SIDE_FRONT_D + 0.04 + push, hem);
    ctx.quadraticCurveTo(
      SIDE_FRONT_D + 0.05 + midPush,
      lerp(top, hem, 0.5),
      SIDE_FRONT_D - 0.01,
      top,
    );
    ctx.closePath();
  };
  trace();
  fillOutlined(ctx, SKIRT);
  withClip(ctx, trace, () => {
    fillSoftEllipse(ctx, SIDE_BACK_D + midPush, hem - 0.12, 0.1, 0.2, SKIRT_SHADE, 0.7);
    fillSoftEllipse(ctx, SIDE_FRONT_D - 0.04, top + 0.1, 0.08, 0.12, SKIRT_LIGHT, 0.5);
    for (const fx of [-0.08, 0.02, 0.1]) {
      ctx.beginPath();
      ctx.moveTo(fx, top + 0.05);
      ctx.quadraticCurveTo(fx * 1.1 + midPush, lerp(top, hem, 0.6), fx * 1.25 + push, hem);
      ctx.strokeStyle = SKIRT_SHADE;
      ctx.lineWidth = DETAIL_WIDTH;
      ctx.stroke();
    }
  });
}

function torsoSideTrace(ctx: Ctx, pose: LoriPose): void {
  const dip = pose.dip;
  const breath = pose.breath * 0.008;
  smoothClosed(ctx, [
    // Back: straight up from the hips, then the dowager's hump.
    { x: SIDE_BACK_D, y: CARDIGAN_HEM_Y + dip * 0.5 },
    { x: SIDE_BACK_D - 0.025, y: -0.5 + dip },
    { x: SIDE_BACK_D - 0.02, y: -0.65 + dip },
    { x: -0.09, y: SHOULDER_HUMP_Y - 0.045 + dip },
    // Neck, carried forward and low off the top of the hump.
    { x: 0.08, y: SHOULDER_HUMP_Y - 0.02 + dip },
    { x: 0.15, y: -0.63 + dip },
    // Bosom and belly, one soft front.
    { x: SIDE_FRONT_D + breath + 0.02, y: -0.55 + dip },
    { x: SIDE_FRONT_D + 0.015, y: -0.45 + dip },
    { x: SIDE_FRONT_D + breath + 0.03, y: -0.38 + dip },
    { x: SIDE_FRONT_D + 0.01, y: CARDIGAN_HEM_Y + dip * 0.5 },
  ]);
}

function torsoSide(ctx: Ctx, pose: LoriPose): void {
  const dip = pose.dip;
  torsoSideTrace(ctx, pose);
  fillOutlined(ctx, CARDIGAN);
  withClip(
    ctx,
    () => torsoSideTrace(ctx, pose),
    () => {
      fillSoftEllipse(ctx, -0.04, -0.66 + dip, 0.12, 0.06, CARDIGAN_LIGHT, 0.8, 0.3);
      fillSoftEllipse(ctx, SIDE_BACK_D, -0.45 + dip, 0.08, 0.16, CARDIGAN_SHADE, 0.7);
      ctx.beginPath();
      ctx.moveTo(0.06, -0.5 + dip);
      ctx.quadraticCurveTo(0.14, -0.46 + dip, SIDE_FRONT_D + 0.02, -0.49 + dip);
      ctx.strokeStyle = CARDIGAN_SHADE;
      ctx.lineWidth = DETAIL_WIDTH * 1.4;
      ctx.stroke();
      for (let i = -4; i <= 4; i++) {
        line(
          ctx,
          { x: i * 0.04, y: CARDIGAN_HEM_Y + dip * 0.5 - 0.035 },
          { x: i * 0.04, y: CARDIGAN_HEM_Y + dip * 0.5 },
          CARDIGAN_SHADE,
          FINE_WIDTH * 0.8,
        );
      }
    },
  );
  ctx.beginPath();
  ctx.moveTo(0.08, SHOULDER_HUMP_Y + dip - 0.015);
  ctx.lineTo(0.165, -0.645 + dip);
  ctx.lineTo(0.1, -0.625 + dip);
  ctx.closePath();
  fillOutlined(ctx, COLLAR, DETAIL_WIDTH);
}

function apronSide(ctx: Ctx, pose: LoriPose): void {
  const top = WAIST_Y + pose.dip + 0.02;
  const bottom = -0.1;
  ctx.beginPath();
  ctx.moveTo(SIDE_FRONT_D - 0.03, top);
  ctx.quadraticCurveTo(SIDE_FRONT_D + 0.07, lerp(top, bottom, 0.5), SIDE_FRONT_D + 0.05, bottom);
  ctx.lineTo(SIDE_FRONT_D - 0.02, bottom + 0.005);
  ctx.quadraticCurveTo(
    SIDE_FRONT_D + 0.02,
    lerp(top, bottom, 0.5),
    SIDE_FRONT_D - 0.08,
    top + 0.01,
  );
  ctx.closePath();
  fillOutlined(ctx, APRON, DETAIL_WIDTH);
  // Waistband round her side, and the bow tied at the back.
  line(
    ctx,
    { x: SIDE_BACK_D, y: top + 0.012 },
    { x: SIDE_FRONT_D, y: top + 0.012 },
    APRON_SHADE,
    0.022,
  );
  for (const side of [-1, 1]) {
    ellipsePath(ctx, SIDE_BACK_D - 0.02, top + 0.012 + side * 0.022, 0.03, 0.017, side * 0.5);
    fillOutlined(ctx, APRON, FINE_WIDTH);
  }
  line(
    ctx,
    { x: SIDE_BACK_D - 0.02, y: top + 0.02 },
    { x: SIDE_BACK_D - 0.05, y: top + 0.09 },
    APRON_SHADE,
    0.014,
  );
}

const SIDE_BOOT_Y = -0.015;
const SIDE_BOOT_RX = 0.07;
const SIDE_BOOT_RY = 0.03;
/** A boot rocks about whichever end is on the floor: the ball as it rolls off, the heel as it lands. */
const BOOT_PIVOT_SHARE = 0.7;

/** The point a profile boot rocks about: its ball, its heel, or its middle when level. */
function bootPivotSide(foot: FootPose): Pt {
  const pivotX = foot.d + Math.sign(foot.pitch) * SIDE_BOOT_RX * BOOT_PIVOT_SHARE;
  return { x: pivotX, y: SIDE_BOOT_Y - foot.lift + SIDE_BOOT_RY };
}

function bootSide(ctx: Ctx, foot: FootPose): void {
  const centreY = SIDE_BOOT_Y - foot.lift;
  const pivot = bootPivotSide(foot);
  ctx.save();
  ctx.translate(pivot.x, pivot.y);
  ctx.rotate(foot.pitch);
  ellipsePath(ctx, foot.d - pivot.x, centreY - pivot.y, SIDE_BOOT_RX, SIDE_BOOT_RY, 0);
  fillOutlined(ctx, BOOT, DETAIL_WIDTH);
  bootShine(
    ctx,
    foot.d - pivot.x + SIDE_BOOT_RX * 0.35,
    centreY - pivot.y + SIDE_BOOT_RY * BOOT_SHINE_DROP,
    SIDE_BOOT_RX * 0.6,
  );
  ctx.restore();
}

/**
 * Where each boot stands, in the view's tile plane: `x` across the screen and
 * `floorY` the height of the floor under it — head-on and from behind a boot
 * stepped ahead stands on floor drawn nearer or further from the camera. The
 * boot's own height is not here: a gate measures how low the painted boot
 * reaches in that column against that floor.
 */
export function loriBootSoles(
  view: LoriView,
  pose: LoriPose,
): ReadonlyArray<{
  readonly side: BootSide;
  readonly x: number;
  readonly floorY: number;
  readonly lift: number;
}> {
  return BOOT_SIDES.map((side) => {
    const foot = footOf(pose, side);
    if (view === 'side') return { side, x: bootPivotSide(foot).x, floorY: 0, lift: foot.lift };
    const floor = projectOnFloor(view, v3(0, 0, foot.d - restingFootD(side)));
    return { side, x: bootCentreHeadOn(view, pose, side).x, floorY: floor.y, lift: foot.lift };
  });
}

/** The far (left) boot first, so the near one overlaps it. */
function bootsSide(ctx: Ctx, pose: LoriPose): void {
  bootSide(ctx, pose.leftFoot);
  bootSide(ctx, pose.rightFoot);
}

function armSide(
  ctx: Ctx,
  shoulder: Vec3,
  elbow: Vec3,
  hand: Vec3,
  far: boolean,
): { wrist: Pt; hand: Pt } {
  const s = project('side', shoulder);
  const e = project('side', elbow);
  const h = project('side', hand);
  const wrist = { x: lerp(e.x, h.x, 0.86), y: lerp(e.y, h.y, 0.86) };
  const sleeve = far ? mix(CARDIGAN, CARDIGAN_SHADE, 0.55) : CARDIGAN;
  tube(ctx, [s, e, wrist], sleeve, SLEEVE_WIDTH);
  if (!far) {
    line(
      ctx,
      { x: lerp(s.x, e.x, 0.15), y: lerp(s.y, e.y, 0.15) - 0.012 },
      { x: lerp(s.x, e.x, 0.75), y: lerp(s.y, e.y, 0.75) - 0.012 },
      rgba(CARDIGAN_LIGHT, 0.55),
      SLEEVE_WIDTH * 0.22,
    );
  }
  const cuffStart = { x: lerp(e.x, wrist.x, 0.75), y: lerp(e.y, wrist.y, 0.75) };
  tube(ctx, [cuffStart, wrist], CARDIGAN_SHADE, SLEEVE_WIDTH * 0.95);
  return { wrist, hand: h };
}

/**
 * In profile, facing +x: the far (cane) arm and the cane first, then the body,
 * the braid, the head, and the near (free) arm over everything.
 */
export function drawLoriSide(ctx: Ctx, pose: LoriPose): void {
  const arms = solveArms(pose);
  shadowUnder(ctx, 0.04, 0.3);
  drawCane(ctx, 'side', arms);
  const far = armSide(ctx, arms.leftShoulder, arms.leftElbow, arms.leftHand, true);
  drawHand(ctx, far.wrist, far.hand);
  bootsSide(ctx, pose);
  skirtSide(ctx, pose);
  torsoSide(ctx, pose);
  apronSide(ctx, pose);

  const headX = SIDE_HEAD_D + pose.headForward;
  const headY = SIDE_HEAD_Y + pose.dip + pose.headDip;
  drawBraid(
    ctx,
    { x: headX - SIDE_HEAD_RD * 0.3, y: headY + HEAD_RY * 0.55 },
    { x: 0.1, y: -0.52 + pose.dip },
    BRAID_WIDTH,
  );
  drawHeadSide(ctx, pose);

  const near = armSide(ctx, arms.rightShoulder, arms.rightElbow, arms.rightHand, false);
  drawHand(ctx, near.wrist, near.hand);
}

// ── From behind ──────────────────────────────────────────────────────────────

/**
 * Her hair from behind closes under the nape, below the crown's tufted edge.
 * The nape is mostly hidden by her hump; it is there so the hair is one mass.
 */
const HAIR_NAPE_AWAY: readonly Pt[] = [
  { x: HEAD_RX * 0.95, y: HEAD_RY * 0.45 },
  { x: HEAD_RX * 0.55, y: HEAD_RY * 0.82 },
  { x: 0, y: HEAD_RY * 0.9 },
  { x: -HEAD_RX * 0.55, y: HEAD_RY * 0.82 },
  { x: -HEAD_RX * 0.95, y: HEAD_RY * 0.45 },
];

/** The knot at her nape, from behind, in the head's own frame. */
const BUN_AWAY: Pt = { x: 0, y: -HEAD_RY * 0.12 };
const BUN_AWAY_RX = HEAD_RX * 0.45;
const BUN_AWAY_RY = HEAD_RY * 0.36;

/**
 * The back of her head: grey hair parted down the middle and combed out to
 * each side, where the braids go round to the front.
 */
function drawHeadAway(ctx: Ctx, pose: LoriPose): void {
  const cx = -(pose.bodyL + pose.headL);
  const cy = HEAD_Y + pose.dip + pose.headDip;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-pose.headTilt);
  for (const side of [-1, 1]) {
    ellipsePath(ctx, side * HEAD_RX * 0.98, 0.02, 0.028, 0.042, -side * 0.2);
    fillOutlined(ctx, SKIN_SHADE, DETAIL_WIDTH);
  }
  const hairTrace = (): void => {
    smoothClosed(ctx, [...HAIR_CROWN_FRONT, ...HAIR_NAPE_AWAY]);
  };
  hairTrace();
  fillOutlined(ctx, HAIR);
  withClip(ctx, hairTrace, () => {
    for (const side of [-1, 1]) {
      fillSoftEllipse(
        ctx,
        side * HEAD_RX * 0.48,
        -HEAD_RY * 0.7,
        HEAD_RX * 0.36,
        HEAD_RY * 0.26,
        HAIR_LIGHT,
        side < 0 ? 0.9 : 0.55,
        side * 0.5,
      );
    }
    fillSoftEllipse(
      ctx,
      HEAD_RX * 0.8,
      HEAD_RY * 0.1,
      HEAD_RX * 0.45,
      HEAD_RY * 0.6,
      HAIR_SHADE,
      0.6,
    );
    fillSoftEllipse(ctx, 0, HEAD_RY * 0.75, HEAD_RX * 0.9, HEAD_RY * 0.3, HAIR_SHADE, 0.5);
    // Combed from the parting out and down toward where each braid starts.
    for (const side of [-1, 1]) {
      for (const t of side < 0 ? [0.2, 0.45, 0.72] : [0.26, 0.52, 0.8]) {
        ctx.beginPath();
        ctx.moveTo(side * 0.008, -HEAD_RY * (1.0 - t * 0.5));
        ctx.quadraticCurveTo(
          side * HEAD_RX * (0.4 + t * 0.3),
          -HEAD_RY * (0.6 - t * 0.5),
          side * HEAD_RX * (0.75 + t * 0.2),
          HEAD_RY * (0.35 + t * 0.2),
        );
        ctx.strokeStyle = rgba(HAIR_SHADE, 0.45);
        ctx.lineWidth = FINE_WIDTH * 0.6;
        ctx.stroke();
      }
    }
  });
  line(
    ctx,
    { x: 0, y: -HEAD_RY * 1.02 },
    { x: 0.004, y: BUN_AWAY.y - BUN_AWAY_RY },
    rgba(HAIR_SHADE, 0.85),
    FINE_WIDTH,
  );
  // The knot at her nape the hair is gathered into before it splits into the
  // braids: a smooth dome without it reads as a cap.
  ellipsePath(ctx, BUN_AWAY.x, BUN_AWAY.y, BUN_AWAY_RX, BUN_AWAY_RY, 0);
  fillOutlined(ctx, HAIR, DETAIL_WIDTH);
  fillSoftEllipse(
    ctx,
    BUN_AWAY.x - BUN_AWAY_RX * 0.35,
    BUN_AWAY.y - BUN_AWAY_RY * 0.35,
    BUN_AWAY_RX * 0.5,
    BUN_AWAY_RY * 0.45,
    HAIR_LIGHT,
    0.85,
  );
  ctx.beginPath();
  ctx.arc(BUN_AWAY.x, BUN_AWAY.y, BUN_AWAY_RY * 0.55, -0.4 * Math.PI, 0.9 * Math.PI);
  ctx.strokeStyle = HAIR_SHADE;
  ctx.lineWidth = FINE_WIDTH;
  ctx.stroke();
  ctx.restore();
}

/**
 * From behind her hump stands up as two rounded shoulders either side of the
 * spine, with the head sunk between them so only its crown clears the back.
 */
const BACK_HUMP_HALF = NECK_HALF * 1.7;
const BACK_HUMP_TOP_Y = SHOULDER_HUMP_Y - 0.05;
const BACK_NAPE_Y = SHOULDER_HUMP_Y + 0.035;

function torsoAwayTrace(ctx: Ctx, pose: LoriPose): void {
  const x = -pose.bodyL;
  const dip = pose.dip;
  const twistNarrow = Math.cos(pose.twist);
  const shoulderHalf = SHOULDER_HALF * lerp(0.9, 1, twistNarrow);
  const breath = pose.breath * 0.008;
  smoothClosed(ctx, [
    { x: x - BACK_HUMP_HALF, y: BACK_HUMP_TOP_Y + dip },
    { x, y: BACK_NAPE_Y + dip },
    { x: x + BACK_HUMP_HALF, y: BACK_HUMP_TOP_Y + dip },
    { x: x + shoulderHalf * 0.85, y: SHOULDER_HUMP_Y + dip + 0.02 },
    { x: x + shoulderHalf + 0.03, y: SHOULDER_Y + dip + 0.02 },
    { x: x + WAIST_HALF + breath + 0.01, y: -0.52 + dip },
    { x: x + BELLY_HALF + breath, y: -0.41 + dip },
    { x: x + BELLY_HALF - 0.01, y: CARDIGAN_HEM_Y + dip * 0.5 },
    { x: x - BELLY_HALF + 0.01, y: CARDIGAN_HEM_Y + dip * 0.5 },
    { x: x - BELLY_HALF - breath, y: -0.41 + dip },
    { x: x - WAIST_HALF - breath - 0.01, y: -0.52 + dip },
    { x: x - shoulderHalf - 0.03, y: SHOULDER_Y + dip + 0.02 },
    { x: x - shoulderHalf * 0.85, y: SHOULDER_HUMP_Y + dip + 0.02 },
  ]);
}

function torsoAway(ctx: Ctx, pose: LoriPose): void {
  const x = -pose.bodyL;
  const dip = pose.dip;
  torsoAwayTrace(ctx, pose);
  fillOutlined(ctx, CARDIGAN);
  withClip(
    ctx,
    () => torsoAwayTrace(ctx, pose),
    () => {
      // The hump catches the light on top and turns away into shadow below:
      // that band under it is what makes the back round rather than flat.
      fillSoftEllipse(ctx, x - 0.07, -0.71 + dip, 0.15, 0.07, CARDIGAN_LIGHT, 0.8, -0.2);
      fillSoftEllipse(ctx, x, -0.56 + dip, 0.24, 0.05, CARDIGAN_SHADE, 0.55);
      fillSoftEllipse(ctx, x + 0.17, -0.42 + dip, 0.1, 0.16, CARDIGAN_SHADE, 0.7);
      for (let i = -5; i <= 5; i++) {
        line(
          ctx,
          { x: x + i * 0.04, y: CARDIGAN_HEM_Y + dip * 0.5 - 0.035 },
          { x: x + i * 0.04, y: CARDIGAN_HEM_Y + dip * 0.5 },
          CARDIGAN_SHADE,
          FINE_WIDTH * 0.8,
        );
      }
    },
  );
  // The spine's groove down the knit, fading out over the hump.
  line(
    ctx,
    { x, y: SHOULDER_HUMP_Y + dip + 0.06 },
    { x, y: CARDIGAN_HEM_Y + dip * 0.5 - 0.04 },
    rgba(CARDIGAN_SHADE, 0.7),
    DETAIL_WIDTH,
  );
}

const APRON_BOW_LOOP_RX = 0.045;
const APRON_BOW_LOOP_RY = 0.024;
const APRON_BOW_LOOP_TILT = 0.35;
const APRON_TIE_WIDTH = 0.022;
const APRON_TAIL_LENGTH = 0.11;
const APRON_TAIL_SPLAY = 0.03;

/** From behind the apron is only its strings, tied in a bow in the small of her back. */
function apronAway(ctx: Ctx, pose: LoriPose): void {
  const x = -pose.bodyL;
  const tieY = WAIST_Y + pose.dip + 0.032;
  line(
    ctx,
    { x: x - WAIST_HALF, y: tieY },
    { x: x + WAIST_HALF, y: tieY },
    APRON_SHADE,
    APRON_TIE_WIDTH,
  );
  for (const side of [-1, 1]) {
    tube(
      ctx,
      [
        { x, y: tieY },
        { x: x + side * APRON_TAIL_SPLAY, y: tieY + APRON_TAIL_LENGTH },
      ],
      APRON,
      APRON_TIE_WIDTH,
    );
  }
  for (const side of [-1, 1]) {
    ellipsePath(
      ctx,
      x + side * APRON_BOW_LOOP_RX * 0.9,
      tieY - 0.004,
      APRON_BOW_LOOP_RX,
      APRON_BOW_LOOP_RY,
      side * APRON_BOW_LOOP_TILT,
    );
    fillOutlined(ctx, APRON, FINE_WIDTH);
  }
  ellipsePath(ctx, x, tieY, APRON_TIE_WIDTH * 0.8, APRON_TIE_WIDTH * 0.8, 0);
  fillOutlined(ctx, APRON_SHADE, FINE_WIDTH);
}

/**
 * From behind: the cane and both arms first — they reach forward of her, on
 * the far side of her body — then the crown of her head, which the hump half
 * hides, then boots, skirt, the back of the cardigan and the apron's bow.
 */
export function drawLoriAway(ctx: Ctx, pose: LoriPose): void {
  const arms = solveArms(pose);
  shadowHeadOn(ctx, 'away', pose);
  drawCane(ctx, 'away', arms);
  const left = armHeadOn(ctx, 'away', arms.leftShoulder, arms.leftElbow, arms.leftHand);
  drawHand(ctx, left.wrist, left.hand);
  const right = armHeadOn(ctx, 'away', arms.rightShoulder, arms.rightElbow, arms.rightHand);
  drawHand(ctx, right.wrist, right.hand);
  drawHeadAway(ctx, pose);
  bootsHeadOn(ctx, 'away', pose);
  skirtHeadOn(ctx, 'away', pose);
  torsoAway(ctx, pose);
  apronAway(ctx, pose);
}
