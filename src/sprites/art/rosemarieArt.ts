/**
 * Rosemarie, the elderly dwarf who runs the Meat Shields desk, and Bernie, the
 * blue-heeler-patterned mole who rides her shoulder.
 *
 * The painter knows nothing about animation: it draws one pose in one of two
 * views. She stands behind a desk and never walks, so she has a head-on view
 * and a profile (mirrored for the other side) and nothing from behind.
 *
 * Every measurement is in tile units with the origin on the ground between her
 * feet and +Y down, so heights are negative. Limbs are placed in a small body
 * space — `l` lateral (+ toward her left, the cane side), `y` height, `d` depth
 * (+ the way she faces) — and each view projects that space, so an arm solved
 * once lands in the same place from the front and from the side.
 */

import { type Pt, clamp01, lerp, mix, rgba } from './carlArt';
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
const TOOTH = '#efe6cc';
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
const CANE = '#6b4526';
const CANE_LIGHT = '#9a6c40';
const CANE_TIP = '#1a1414';
const SHADOW = '#000000';
const COIN = '#f2c440';
const COIN_LIGHT = '#fff2b0';
const COIN_EDGE = '#9a6a10';
const FLICK = '#ffe58c';

const BERNIE_FUR = '#eceae6';
const BERNIE_FUR_SHADE = '#b4b6bc';
const BERNIE_TICK = '#6f8aa0';
const BERNIE_PATCH = '#16161a';
const BERNIE_PINK = '#e89aa0';
const BERNIE_PINK_SHADE = '#b86a74';
const BERNIE_CLAW = '#f2ead8';

// ── Line weights ─────────────────────────────────────────────────────────────

/** Heavy enough to survive the halving to a 32 px tile as a real edge. */
const OUTLINE_WIDTH = 0.022;
const DETAIL_WIDTH = 0.014;
const FINE_WIDTH = 0.01;

// ── Proportions ──────────────────────────────────────────────────────────────

/**
 * She stands a little under one tile to the crown of her hair — about half of
 * Carl's two tiles, which puts her at a tall man's waist. The stoop takes the
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
/** Elbow poles: the throwing elbow swings out and back, the cane elbow out and down. */
const RIGHT_ELBOW_POLE: Vec3 = { l: -0.7, y: 0.45, d: -0.55 };
const LEFT_ELBOW_POLE: Vec3 = { l: 0.75, y: 0.35, d: -0.5 };

/**
 * Head-on, something nearer the camera draws a little lower on the floor: the
 * floor is seen from above while she is drawn as if seen level. Only the cane's
 * foot takes it; a hand in the air does not.
 */
const FLOOR_DEPTH_DROP = 0.12;

const TAU = Math.PI * 2;

// ── Pose ─────────────────────────────────────────────────────────────────────

/** A point in her body space: `l` toward her left (cane side), `y` down, `d` the way she faces. */
export interface Vec3 {
  readonly l: number;
  readonly y: number;
  readonly d: number;
}

/** What the throwing hand is doing, which decides how it is drawn. */
export type HandGrip = 'rest' | 'pocket' | 'pinch' | 'open';

export interface RosemariePose {
  /** Whole-body sideways shift toward the cane (+) or away (−). */
  readonly bodyL: number;
  /** How far the body has sunk, + down. */
  readonly dip: number;
  /** The torso's turn about the vertical: + brings the right shoulder back for a wind-up. */
  readonly twist: number;
  /** Extra head offsets on top of the body's. */
  readonly headL: number;
  readonly headDip: number;
  /** Head roll, + toward the cane side. */
  readonly headTilt: number;
  /** Profile only: how far the head juts forward, + out. */
  readonly headForward: number;
  /** Where the throwing (right) hand is. */
  readonly rightHand: Vec3;
  readonly grip: HandGrip;
  /** A coin between the fingers of the throwing hand. */
  readonly holdsCoin: boolean;
  /** The arc the hand has just swept through, 0 when there is none. */
  readonly flick: number;
  /** The hand the flick swept from, for drawing its arc. */
  readonly flickFrom: Vec3;
  /** Where the cane's foot is planted. */
  readonly caneFoot: Vec3;
  /** How far the cane is lifted off the floor. */
  readonly caneLift: number;
  /** The bad (right) foot, eased off the floor under the skirt. */
  readonly badFootLift: number;
  /** 0 open-eyed, 1 squinting down a line of aim. */
  readonly squint: number;
  /** 0 a flat mouth, 1 a wide crooked grin. */
  readonly grin: number;
  /** 0 closed, 1 mouth open in a cackle. */
  readonly cackle: number;
  /** Breath in the chest, 0–1. */
  readonly breath: number;
}

const RESTING_RIGHT_HAND: Vec3 = { l: -0.1, y: -0.38, d: 0.18 };
const RESTING_CANE_FOOT: Vec3 = { l: 0.34, y: 0, d: 0.3 };

export function restingPose(): RosemariePose {
  return {
    bodyL: 0,
    dip: 0,
    twist: 0,
    headL: 0,
    headDip: 0,
    headTilt: 0,
    headForward: 0,
    rightHand: RESTING_RIGHT_HAND,
    grip: 'rest',
    holdsCoin: false,
    flick: 0,
    flickFrom: RESTING_RIGHT_HAND,
    caneFoot: RESTING_CANE_FOOT,
    caneLift: 0,
    badFootLift: 0,
    squint: 0,
    grin: 0.35,
    cackle: 0,
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

export type RosemarieView = 'front' | 'side';

/** Body space to the cell's tile-unit plane for one view. */
function project(view: RosemarieView, p: Vec3): Pt {
  if (view === 'front') return { x: p.l, y: p.y };
  return { x: p.d, y: p.y };
}

function projectOnFloor(view: RosemarieView, p: Vec3): Pt {
  if (view === 'front') return { x: p.l, y: p.y + p.d * FLOOR_DEPTH_DROP };
  return { x: p.d, y: p.y };
}

/** The shoulders after the body's sway, sink and twist. */
function shoulders(pose: RosemariePose): { right: Vec3; left: Vec3 } {
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

function solveArms(pose: RosemariePose): Arms {
  const { right, left } = shoulders(pose);
  const caneFoot = add3(pose.caneFoot, v3(pose.bodyL * 0.5, -pose.caneLift, 0));
  const caneTop = add3(caneFoot, v3(-CANE_LEAN_IN, -CANE_LENGTH, -CANE_LEAN_IN * 0.5));
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

/** Where the throwing hand is drawn, in the view's tile plane (origin between her feet). */
export function rosemarieThrowHandPoint(view: RosemarieView, pose: RosemariePose): Pt {
  return project(view, solveArms(pose).rightHand);
}

/** Head-on Bernie sits on the outer slope of her left shoulder. */
const BERNIE_SEAT_FRONT: Vec3 = { l: 0.225, y: -0.645, d: 0 };
/** In profile he rides the top of her hump, behind her head. */
const BERNIE_SEAT_SIDE: Vec3 = { l: 0.1, y: -0.735, d: -0.1 };

/** Where Bernie's feet grip, in the view's tile plane; he rides whatever the shoulder does. */
export function rosemarieBernieSeat(view: RosemarieView, pose: RosemariePose): Pt {
  const seat = view === 'front' ? BERNIE_SEAT_FRONT : BERNIE_SEAT_SIDE;
  const twistBack = Math.sin(pose.twist) * SHOULDER_HALF;
  return project(view, add3(seat, v3(pose.bodyL, pose.dip, twistBack)));
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

function drawCane(ctx: Ctx, view: RosemarieView, arms: Arms): void {
  const foot = projectOnFloor(view, arms.caneFoot);
  const top = project(view, arms.caneTop);
  // Both views hold the stick on the +x side of her body, so the crook curls
  // back toward -x, over the gripping hand.
  const towardHer = -1;
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

function drawHand(ctx: Ctx, wrist: Pt, hand: Pt, grip: HandGrip, holdsCoin: boolean): void {
  const angle = Math.atan2(hand.y - wrist.y, hand.x - wrist.x);
  const along = { x: Math.cos(angle), y: Math.sin(angle) };
  const centre = {
    x: hand.x + along.x * HAND_RADIUS * 0.35,
    y: hand.y + along.y * HAND_RADIUS * 0.35,
  };
  if (grip === 'pocket') {
    // Fingers down in the pocket: only the back of the hand shows.
    ellipsePath(
      ctx,
      centre.x,
      centre.y - HAND_RADIUS * 0.2,
      HAND_RADIUS * 0.95,
      HAND_RADIUS * 0.7,
      0,
    );
    fillOutlined(ctx, SKIN, DETAIL_WIDTH);
    return;
  }
  if (grip === 'open') {
    // A flicked-open hand: palm plus three splayed fingers, fanned along the throw.
    for (const spread of [-0.55, 0, 0.55]) {
      const fingerAngle = angle + spread;
      const tip = {
        x: centre.x + Math.cos(fingerAngle) * HAND_RADIUS * 1.9,
        y: centre.y + Math.sin(fingerAngle) * HAND_RADIUS * 1.9,
      };
      line(ctx, centre, tip, OUTLINE, HAND_RADIUS * 0.75 + DETAIL_WIDTH * 2);
      line(ctx, centre, tip, SKIN, HAND_RADIUS * 0.75);
    }
    ellipsePath(ctx, centre.x, centre.y, HAND_RADIUS, HAND_RADIUS * 0.85, angle);
    fillOutlined(ctx, SKIN, DETAIL_WIDTH);
    return;
  }
  const radius = grip === 'pinch' ? HAND_RADIUS * 0.9 : HAND_RADIUS;
  ellipsePath(ctx, centre.x, centre.y, radius * 1.1, radius * 0.9, angle);
  fillOutlined(ctx, SKIN, DETAIL_WIDTH);
  // Knuckle line, so the fist reads as fingers folded over rather than a ball.
  ctx.strokeStyle = SKIN_SHADE;
  ctx.lineWidth = FINE_WIDTH;
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, radius * 0.6, angle - 0.9, angle + 0.9);
  ctx.stroke();
  if (holdsCoin) {
    const coinAt = {
      x: centre.x + along.x * radius * 1.05,
      y: centre.y + along.y * radius * 1.05 - radius * 0.3,
    };
    drawCoinDisc(ctx, coinAt.x, coinAt.y, COIN_RADIUS, 1);
  }
}

// ── Coin ─────────────────────────────────────────────────────────────────────

/** A coin is about a fifth of her hand's width across — small, but always a bright disc. */
export const COIN_RADIUS = 0.034;

/**
 * A gold coin, `spin` 1 face-on and near 0 edge-on. Painted in whatever
 * units the caller's transform sets.
 */
export function drawCoinDisc(ctx: Ctx, x: number, y: number, radius: number, spin: number): void {
  const faceWidth = Math.max(0.18, Math.abs(spin));
  ctx.beginPath();
  ctx.ellipse(x, y, radius * faceWidth, radius, 0, 0, TAU);
  ctx.fillStyle = COIN;
  ctx.fill();
  ctx.strokeStyle = COIN_EDGE;
  ctx.lineWidth = radius * 0.35;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(
    x - radius * faceWidth * 0.3,
    y - radius * 0.3,
    radius * faceWidth * 0.35,
    radius * 0.3,
    0,
    0,
    TAU,
  );
  ctx.fillStyle = COIN_LIGHT;
  ctx.fill();
}

/** How far along the wrist's sweep the drawn trail begins. */
const FLICK_TRAIL_START = 0.45;

/** The whip of the wrist through the last frame, as a pale arc behind the empty hand. */
function drawFlick(ctx: Ctx, from: Pt, to: Pt, strength: number): void {
  if (strength <= 0) return;
  const control = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 0.06 };
  // Only the stretch of the sweep nearest the hand: drawn whole, the arc starts
  // at the wind-up behind her head and reads as an overhead swing, not a flick.
  const t = FLICK_TRAIL_START;
  const start = {
    x: (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * control.x + t * t * to.x,
    y: (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * control.y + t * t * to.y,
  };
  const mid = { x: lerp(control.x, to.x, t), y: lerp(control.y, to.y, t) };
  const bands: ReadonlyArray<{ width: number; alpha: number }> = [
    { width: 0.085, alpha: 0.2 },
    { width: 0.05, alpha: 0.4 },
    { width: 0.026, alpha: 0.9 },
  ];
  ctx.lineCap = 'round';
  for (const band of bands) {
    ctx.strokeStyle = rgba(FLICK, band.alpha * strength);
    ctx.lineWidth = band.width;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.quadraticCurveTo(mid.x, mid.y, to.x, to.y);
    ctx.stroke();
  }
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

function drawHeadFront(ctx: Ctx, pose: RosemariePose): void {
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
  // Eyes: deep-set slits under heavy brows, squinting harder to aim.
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
  // Mouth: a crooked grin that opens into a cackle.
  const mouthY = HEAD_RY * 0.8;
  const grin = clamp01(pose.grin);
  const open = clamp01(pose.cackle);
  ctx.beginPath();
  ctx.moveTo(-0.045, mouthY - grin * 0.012);
  ctx.quadraticCurveTo(
    -0.005,
    mouthY + 0.012 + grin * 0.01 + open * 0.03,
    0.05,
    mouthY - grin * 0.022,
  );
  if (open > 0.05) {
    ctx.quadraticCurveTo(0.005, mouthY + 0.004, -0.045, mouthY - grin * 0.012);
    ctx.fillStyle = MOUTH;
    ctx.fill();
    // One stubborn tooth.
    ctx.fillStyle = TOOTH;
    ctx.fillRect(0.004, mouthY - 0.002, 0.014, 0.012 * open + 0.004);
  }
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

function drawHeadSide(ctx: Ctx, pose: RosemariePose): void {
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
  const grin = clamp01(pose.grin);
  const open = clamp01(pose.cackle);
  ctx.beginPath();
  ctx.moveTo(rd * 0.88, ry * 0.66);
  ctx.quadraticCurveTo(rd * 0.7, ry * (0.72 + open * 0.12), rd * 0.55, ry * (0.62 - grin * 0.1));
  ctx.strokeStyle = MOUTH;
  ctx.lineWidth = DETAIL_WIDTH + open * 0.012;
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

// ── Body, front ──────────────────────────────────────────────────────────────

function skirtFront(ctx: Ctx, pose: RosemariePose): void {
  const x = pose.bodyL;
  const top = WAIST_Y + pose.dip + 0.03;
  const hem = SKIRT_HEM_Y;
  const lift = pose.badFootLift;
  const trace = (): void => {
    ctx.beginPath();
    ctx.moveTo(x - SKIRT_WAIST_HALF, top);
    ctx.quadraticCurveTo(
      x - SKIRT_HEM_HALF * 1.05,
      lerp(top, hem, 0.55),
      x - SKIRT_HEM_HALF,
      hem - lift * 0.6,
    );
    // The hem waves where the folds meet it; the bad-leg side rides up as that foot eases off.
    ctx.quadraticCurveTo(
      x - SKIRT_HEM_HALF * 0.55,
      hem + 0.02 - lift,
      x - SKIRT_HEM_HALF * 0.2,
      hem,
    );
    ctx.quadraticCurveTo(
      x + SKIRT_HEM_HALF * 0.15,
      hem + 0.02,
      x + SKIRT_HEM_HALF * 0.45,
      hem - 0.005,
    );
    ctx.quadraticCurveTo(x + SKIRT_HEM_HALF * 0.8, hem + 0.02, x + SKIRT_HEM_HALF, hem);
    ctx.quadraticCurveTo(
      x + SKIRT_HEM_HALF * 1.05,
      lerp(top, hem, 0.55),
      x + SKIRT_WAIST_HALF,
      top,
    );
    ctx.closePath();
  };
  trace();
  fillOutlined(ctx, SKIRT);
  withClip(ctx, trace, () => {
    fillSoftEllipse(ctx, x + SKIRT_HEM_HALF * 0.8, hem - 0.1, 0.14, 0.2, SKIRT_SHADE, 0.7);
    fillSoftEllipse(ctx, x - SKIRT_HEM_HALF * 0.7, top + 0.12, 0.1, 0.14, SKIRT_LIGHT, 0.55);
    for (const fx of [-0.7, -0.2, 0.45, 0.85]) {
      ctx.beginPath();
      ctx.moveTo(x + SKIRT_WAIST_HALF * fx, top + 0.04);
      ctx.quadraticCurveTo(
        x + SKIRT_HEM_HALF * fx * 1.05,
        lerp(top, hem, 0.6),
        x + SKIRT_HEM_HALF * fx * 1.1,
        hem,
      );
      ctx.strokeStyle = SKIRT_SHADE;
      ctx.lineWidth = DETAIL_WIDTH;
      ctx.stroke();
    }
  });
}

function bootsFront(ctx: Ctx, pose: RosemariePose): void {
  for (const side of [-1, 1]) {
    const lift = side < 0 ? pose.badFootLift : 0;
    ellipsePath(ctx, pose.bodyL * 0.3 + side * 0.09, -0.012 - lift, 0.06, 0.03, 0);
    fillOutlined(ctx, BOOT, DETAIL_WIDTH);
  }
}

function torsoFrontTrace(ctx: Ctx, pose: RosemariePose): void {
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

function torsoFront(ctx: Ctx, pose: RosemariePose): void {
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

function apronFront(ctx: Ctx, pose: RosemariePose): void {
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
  // Waistband, and the coin pocket on her throwing side.
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

function armFront(ctx: Ctx, shoulder: Vec3, elbow: Vec3, hand: Vec3): { wrist: Pt; hand: Pt } {
  const s = project('front', shoulder);
  const e = project('front', elbow);
  const h = project('front', hand);
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
 * of the body and the sunken head over the collar. Bernie is not painted here;
 * he is a figure of his own with his own clock.
 */
export function drawRosemarieFront(ctx: Ctx, pose: RosemariePose): void {
  const arms = solveArms(pose);
  shadowUnder(ctx, pose.bodyL * 0.5 + 0.03, 0.32);
  bootsFront(ctx, pose);
  skirtFront(ctx, pose);
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
  const right = armFront(ctx, arms.rightShoulder, arms.rightElbow, arms.rightHand);
  const left = armFront(ctx, arms.leftShoulder, arms.leftElbow, arms.leftHand);

  drawHeadFront(ctx, pose);

  drawHand(ctx, left.wrist, left.hand, 'rest', false);
  drawHand(ctx, right.wrist, right.hand, pose.grip, pose.holdsCoin);
  drawFlick(ctx, project('front', pose.flickFrom), right.hand, pose.flick);
}

// ── Body, profile ────────────────────────────────────────────────────────────

/** In profile she is deep through the chest and deeper still through the curve of her back. */
const SIDE_BACK_D = -0.15;
const SIDE_FRONT_D = 0.17;

function skirtSide(ctx: Ctx, pose: RosemariePose): void {
  const top = WAIST_Y + pose.dip + 0.03;
  const hem = SKIRT_HEM_Y;
  const trace = (): void => {
    ctx.beginPath();
    ctx.moveTo(SIDE_BACK_D + 0.01, top);
    ctx.quadraticCurveTo(SIDE_BACK_D - 0.06, lerp(top, hem, 0.5), SIDE_BACK_D - 0.04, hem);
    ctx.quadraticCurveTo(0.0, hem + 0.02, SIDE_FRONT_D * 0.5, hem - 0.005);
    ctx.quadraticCurveTo(SIDE_FRONT_D * 0.9, hem + 0.02, SIDE_FRONT_D + 0.04, hem);
    ctx.quadraticCurveTo(SIDE_FRONT_D + 0.05, lerp(top, hem, 0.5), SIDE_FRONT_D - 0.01, top);
    ctx.closePath();
  };
  trace();
  fillOutlined(ctx, SKIRT);
  withClip(ctx, trace, () => {
    fillSoftEllipse(ctx, SIDE_BACK_D, hem - 0.12, 0.1, 0.2, SKIRT_SHADE, 0.7);
    fillSoftEllipse(ctx, SIDE_FRONT_D - 0.04, top + 0.1, 0.08, 0.12, SKIRT_LIGHT, 0.5);
    for (const fx of [-0.08, 0.02, 0.1]) {
      ctx.beginPath();
      ctx.moveTo(fx, top + 0.05);
      ctx.quadraticCurveTo(fx * 1.1, lerp(top, hem, 0.6), fx * 1.25, hem);
      ctx.strokeStyle = SKIRT_SHADE;
      ctx.lineWidth = DETAIL_WIDTH;
      ctx.stroke();
    }
  });
}

function torsoSideTrace(ctx: Ctx, pose: RosemariePose): void {
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

function torsoSide(ctx: Ctx, pose: RosemariePose): void {
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

function apronSide(ctx: Ctx, pose: RosemariePose): void {
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

function bootsSide(ctx: Ctx, pose: RosemariePose): void {
  for (const offset of [0, 0.05]) {
    const lift = offset === 0 ? pose.badFootLift : 0;
    ellipsePath(ctx, 0.08 + offset, -0.015 - lift, 0.07, 0.03, 0);
    fillOutlined(ctx, BOOT, DETAIL_WIDTH);
  }
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
 * the braid, the head, and the near (throwing) arm over everything.
 */
export function drawRosemarieSide(ctx: Ctx, pose: RosemariePose): void {
  const arms = solveArms(pose);
  shadowUnder(ctx, 0.04, 0.3);
  drawCane(ctx, 'side', arms);
  const far = armSide(ctx, arms.leftShoulder, arms.leftElbow, arms.leftHand, true);
  drawHand(ctx, far.wrist, far.hand, 'rest', false);
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
  drawHand(ctx, near.wrist, near.hand, pose.grip, pose.holdsCoin);
  drawFlick(ctx, project('side', pose.flickFrom), near.hand, pose.flick);
}

// ── Bernie ───────────────────────────────────────────────────────────────────

/**
 * Bernie is about a quarter of a tile nose to tail: a velvet cylinder with no
 * neck, no ears and no eyes to speak of, a bare pink snout, and two enormous
 * pink digging hands. Those are what make a mole a mole and not a rat — a
 * visible eye or ear is the first thing that turns him into one.
 */
const BERNIE_BODY_RX = 0.092;
const BERNIE_BODY_RY = 0.062;
const BERNIE_TUFTS = 24;
/** How far out and in the fuzz tufts alternate, as a share of the body radius. */
const FUZZ_OUT = 1.045;
const FUZZ_IN = 0.985;

/** Fuzz: the body's edge as a ring of small tufts rather than a clean ellipse. */
function fuzzyBody(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, tufts: number): void {
  ctx.beginPath();
  for (let i = 0; i <= tufts * 2; i++) {
    const a = (i / (tufts * 2)) * TAU;
    const out = i % 2 === 0 ? FUZZ_OUT : FUZZ_IN;
    const x = cx + Math.cos(a) * rx * out;
    const y = cy + Math.sin(a) * ry * out;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** How many flecks of ticking cover his coat, and their seed. */
const BERNIE_TICK_COUNT = 45;
const BERNIE_TICK_SEED = 20240917;
const BERNIE_TICK_RADIUS = 0.0035;
/** Park–Miller multiplier and modulus: a tiny, fixed pseudo-random walk. */
const LCG_MULTIPLIER = 48271;
const LCG_MODULUS = 2147483647;

/**
 * A blue heeler's ticking: many fine flecks of slate over the white, not a few
 * large spots — large round spots are a cow's or a Dalmatian's. Generated once
 * from a fixed seed, so he is the same dog-patterned mole on every frame.
 */
function heelerTicking(): readonly Pt[] {
  const flecks: Pt[] = [];
  let state = BERNIE_TICK_SEED;
  const next = (): number => {
    state = (state * LCG_MULTIPLIER) % LCG_MODULUS;
    return state / LCG_MODULUS;
  };
  while (flecks.length < BERNIE_TICK_COUNT) {
    const x = (next() * 2 - 1) * BERNIE_BODY_RX;
    const y = (next() * 2 - 1) * BERNIE_BODY_RY;
    const inside = (x / BERNIE_BODY_RX) ** 2 + (y / BERNIE_BODY_RY) ** 2 < 1;
    if (inside) flecks.push({ x, y });
  }
  return flecks;
}

const BERNIE_TICKS = heelerTicking();

const BERNIE_MOTTLE: readonly Pt[] = [
  { x: -0.05, y: 0.015 },
  { x: 0.02, y: 0.02 },
  { x: 0.045, y: -0.02 },
];

/** His digging hands are wider than his head — the mole's signature. */
const BERNIE_PAW_SIZE = 0.056;

function bernieSpadePaw(ctx: Ctx, x: number, y: number, size: number, turn: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(turn);
  // A broad palm turned outward with a fringe of claws: the digging hand.
  ctx.beginPath();
  ctx.moveTo(-size * 0.5, -size * 0.55);
  ctx.quadraticCurveTo(-size * 0.75, size * 0.2, -size * 0.35, size * 0.55);
  ctx.lineTo(size * 0.55, size * 0.5);
  ctx.quadraticCurveTo(size * 0.75, -size * 0.1, size * 0.3, -size * 0.55);
  ctx.closePath();
  fillOutlined(ctx, BERNIE_PINK, FINE_WIDTH);
  // Pale nails along the digging edge, short and hooked: longer ones read as fingers.
  for (let claw = 0; claw < 4; claw++) {
    const cx = -size * 0.3 + claw * size * 0.26;
    line(
      ctx,
      { x: cx, y: size * 0.5 },
      { x: cx + size * 0.04, y: size * 0.6 },
      BERNIE_CLAW,
      FINE_WIDTH * 0.9,
    );
  }
  ctx.restore();
}

/**
 * Bernie in profile, facing +x, origin where his hands grip her shoulder.
 * `snuffle` 1 is the snout raised and twitching, 0 at rest.
 */
export function drawBernie(ctx: Ctx, snuffle: number): void {
  const up = clamp01(snuffle);
  const bodyY = -BERNIE_BODY_RY * 0.9;
  fillSoftEllipse(ctx, 0, 0.004, BERNIE_BODY_RX * 1.05, 0.02, SHADOW, 0.35);

  // A mole's tail is a nub; anything longer is a rat's.
  ellipsePath(ctx, -BERNIE_BODY_RX * 1.02, bodyY + 0.02, 0.014, 0.01, 0.3);
  fillOutlined(ctx, BERNIE_PINK, FINE_WIDTH);
  ellipsePath(ctx, -0.055, -0.006, 0.022, 0.011, 0);
  fillOutlined(ctx, BERNIE_PINK, FINE_WIDTH);
  // The far digging hand, splayed out beyond his body.
  bernieSpadePaw(ctx, BERNIE_BODY_RX * 0.78, -0.018, BERNIE_PAW_SIZE * 0.85, -0.9 - up * 0.1);

  // The snout: bare pink flesh running out of the fur, lifted on the snuffle.
  const snoutRootX = BERNIE_BODY_RX * 0.85;
  const snoutRootY = bodyY + 0.008;
  // A narrow point about a fifth of his length: blunt is a pig's, long is a shrew's.
  const tipX = snoutRootX + 0.055 + up * 0.004;
  const tipY = snoutRootY + 0.014 - up * 0.032;
  ctx.beginPath();
  ctx.moveTo(snoutRootX - 0.01, snoutRootY - 0.02);
  ctx.quadraticCurveTo(snoutRootX + 0.035, snoutRootY - 0.014 - up * 0.014, tipX, tipY - 0.006);
  ctx.quadraticCurveTo(tipX + 0.01, tipY, tipX, tipY + 0.007);
  ctx.quadraticCurveTo(
    snoutRootX + 0.035,
    snoutRootY + 0.02 - up * 0.008,
    snoutRootX - 0.01,
    snoutRootY + 0.022,
  );
  ctx.closePath();
  fillOutlined(ctx, BERNIE_PINK, FINE_WIDTH * 1.2);
  // Nostril at the tip, and the wrinkles the twitch pushes into the snout.
  ellipsePath(ctx, tipX - 0.002, tipY + 0.001, 0.004, 0.0035, 0);
  ctx.fillStyle = BERNIE_PINK_SHADE;
  ctx.fill();
  for (let wrinkle = 0; wrinkle < 2; wrinkle++) {
    const wx = snoutRootX + 0.012 + wrinkle * 0.014;
    const wy = lerp(snoutRootY, tipY, (wrinkle + 1) * 0.25);
    line(
      ctx,
      { x: wx, y: wy - 0.012 },
      { x: wx + 0.003 + up * 0.003, y: wy + 0.004 },
      BERNIE_PINK_SHADE,
      FINE_WIDTH * 0.8,
    );
  }
  // Whiskers flare as he sniffs.
  for (const spread of [-1, 1]) {
    line(
      ctx,
      { x: tipX - 0.02, y: tipY + 0.004 },
      { x: tipX + 0.012, y: tipY + spread * (0.018 + up * 0.012) + 0.008 },
      rgba(OUTLINE, 0.5),
      FINE_WIDTH * 0.6,
    );
  }

  const bodyTrace = (): void =>
    fuzzyBody(ctx, 0, bodyY, BERNIE_BODY_RX, BERNIE_BODY_RY, BERNIE_TUFTS);
  bodyTrace();
  fillOutlined(ctx, BERNIE_FUR, FINE_WIDTH * 1.4);
  withClip(ctx, bodyTrace, () => {
    fillSoftEllipse(ctx, 0.005, bodyY + 0.048, 0.1, 0.03, BERNIE_FUR_SHADE, 0.85);
    // Blue-grey mottling in soft clouds under the ticking: that roan cast is
    // what makes the pattern a heeler's rather than a cow's.
    for (const cloud of BERNIE_MOTTLE) {
      fillSoftEllipse(ctx, cloud.x, bodyY + cloud.y, 0.03, 0.02, BERNIE_TICK, 0.45);
    }
    for (const tick of BERNIE_TICKS) {
      ellipsePath(ctx, tick.x, bodyY + tick.y, BERNIE_TICK_RADIUS, BERNIE_TICK_RADIUS * 0.8, 0);
      ctx.fillStyle = BERNIE_TICK;
      ctx.fill();
    }
    smoothClosed(ctx, [
      { x: -0.075, y: bodyY - 0.03 },
      { x: -0.05, y: bodyY - 0.07 },
      { x: 0.0, y: bodyY - 0.075 },
      { x: 0.02, y: bodyY - 0.045 },
      { x: -0.01, y: bodyY - 0.03 },
      { x: -0.04, y: bodyY - 0.01 },
    ]);
    ctx.fillStyle = BERNIE_PATCH;
    ctx.fill();
    ellipsePath(ctx, -0.085, bodyY + 0.012, 0.022, 0.018, 0.4);
    ctx.fillStyle = BERNIE_PATCH;
    ctx.fill();
    // The heeler's mask sits where a dog's eye patch would, and covers his eye entirely.
    ctx.beginPath();
    ctx.ellipse(BERNIE_BODY_RX * 0.7, bodyY - 0.012 - up * 0.004, 0.034, 0.03, -0.3, 0, TAU);
    ctx.fillStyle = BERNIE_PATCH;
    ctx.fill();
    fillSoftEllipse(ctx, -0.02, bodyY - 0.035, 0.05, 0.015, BERNIE_FUR, 0.35);
  });

  // The near digging hand, turned palm-out and hooked over her shoulder.
  bernieSpadePaw(ctx, BERNIE_BODY_RX * 0.5, -0.008, BERNIE_PAW_SIZE, -0.55 - up * 0.1);
}
