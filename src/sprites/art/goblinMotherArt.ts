/**
 * The goblin mother of the defend quest, the swaddled infant she carries, and
 * the toddler who comes home to her once the nursery has been held.
 *
 * She is the one goblin in the dungeon the player protects, so everything that
 * names an enemy goblin — the hunched profile, the notched swept-back ears, the
 * weapon, the cold olive and teal skins, the dark sclera — is absent on
 * purpose. She stands upright and head-on, round through the hips and the
 * shoulders, in a headscarf, a knitted shawl and an apron, cradling the baby
 * at her chest. At the 32 px tile three shapes carry her: the red headscarf
 * with two soft ears out of it, the pale bundle at her chest, and a bell of
 * skirt to the floor.
 *
 * The painter knows nothing about animation: it draws one pose. Every
 * measurement is in tile units with the origin on the ground between the feet
 * and +Y down, so heights are negative. Both figures are authored turned
 * toward +X — her baby on that side, the toddler toddling that way — and the
 * runtime mirrors the whole cell to face them the other way.
 */

import { type Pt, clamp01, lerp, mix, rgba } from './carlArt';
import { fillSoftEllipse, withClip } from './softShade';

type Ctx = CanvasRenderingContext2D;

// ── Palette ──────────────────────────────────────────────────────────────────

/** A warm brown-black: the enemy goblins' near-black outline reads colder. */
const OUTLINE = '#2a1a16';
const SHADOW = '#000000';

/**
 * A soft, warm sage lit well above every enemy skin: the war-band ramps are
 * olive, yellow-green, gold, teal and a hard spring green, all darker and more
 * saturated than this.
 */
const SKIN = '#93ae6c';
const SKIN_LIGHT = '#b9d08f';
const SKIN_SHADE = '#627f48';
const SKIN_DEEP = '#4a6236';
const CHEEK = '#d98a74';
const EYE_WHITE = '#f7f1e2';
const IRIS = '#7a4a22';
const PUPIL = '#1e120c';
const MOUTH = '#7a3030';
const MOUTH_INNER = '#4a1a1c';
const EARRING = '#e6b84a';

const SCARF = '#b8483a';
const SCARF_LIGHT = '#dc6c52';
const SCARF_SHADE = '#7e2b24';
const SCARF_DOT = '#f4e4c6';

const SHAWL = '#cf9a45';
const SHAWL_LIGHT = '#ecc06c';
const SHAWL_SHADE = '#91622a';

const DRESS = '#9a526c';
const DRESS_LIGHT = '#bd7590';
const DRESS_SHADE = '#66324a';

const APRON = '#eee2c6';
const APRON_SHADE = '#b9a785';
const SLIPPER = '#5c3626';

const BLANKET = '#dfe6f7';
const BLANKET_LIGHT = '#f8faff';
const BLANKET_SHADE = '#9aa8cf';
const BLANKET_TRIM = '#e99aaa';

const BABY_SKIN = '#a8c87e';
const BABY_SKIN_LIGHT = '#cbe2a2';
const BABY_SKIN_SHADE = '#739452';

const ROMPER = '#d99a3c';
const ROMPER_LIGHT = '#f0bd63';
const ROMPER_SHADE = '#9a6420';
const CAP = SCARF;
const CAP_LIGHT = SCARF_LIGHT;
const CAP_SHADE = SCARF_SHADE;
const CAP_RIM = '#efe3c8';
const BOOTIE = '#8a4a3a';

// ── Line weights ─────────────────────────────────────────────────────────────

/** Heavy enough to survive the halving to a 32 px tile as a real edge. */
const OUTLINE_WIDTH = 0.022;
const DETAIL_WIDTH = 0.014;
const FINE_WIDTH = 0.01;

const TAU = Math.PI * 2;
/** Guards every ellipse radius against a zero that would throw. */
const MIN_RADIUS = 1e-4;

// ── Drawing primitives ───────────────────────────────────────────────────────

function p(x: number, y: number): Pt {
  return { x, y };
}

function addPt(a: Pt, b: Pt): Pt {
  return { x: a.x + b.x, y: a.y + b.y };
}

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

function fillOutlined(ctx: Ctx, fill: string, width = OUTLINE_WIDTH): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function ellipsePath(ctx: Ctx, x: number, y: number, rx: number, ry: number, rot = 0): void {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(MIN_RADIUS, rx), Math.max(MIN_RADIUS, ry), rot, 0, TAU);
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
    points.forEach((point, i) => {
      if (i === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
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
  fillSoftEllipse(ctx, x, 0, halfWidth, halfWidth * 0.3, SHADOW, 0.4, 0, 0.55);
}

// ── Faces ────────────────────────────────────────────────────────────────────

/**
 * A kind eye: white, a warm brown iris looking along `gaze`, a catch-light,
 * and an inked upper lid that sweeps into a lash at the outer corner. Closed,
 * it is only that lid, curved down. `side` is −1 for the eye on the −X side.
 */
function drawKindEye(
  ctx: Ctx,
  x: number,
  y: number,
  radius: number,
  open: number,
  gaze: Pt,
  side: number,
): void {
  const openness = clamp01(open);
  if (openness < 0.2) {
    ctx.beginPath();
    ctx.moveTo(x - radius, y);
    ctx.quadraticCurveTo(x, y + radius * 0.7, x + radius, y);
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = DETAIL_WIDTH;
    ctx.lineCap = 'round';
    ctx.stroke();
    return;
  }
  const ry = radius * lerp(0.55, 1.05, openness);
  ellipsePath(ctx, x, y, radius, ry);
  ctx.fillStyle = EYE_WHITE;
  ctx.fill();
  withClip(
    ctx,
    () => ellipsePath(ctx, x, y, radius, ry),
    () => {
      const irisX = x + gaze.x * radius * 0.35;
      const irisY = y + gaze.y * radius * 0.3;
      ellipsePath(ctx, irisX, irisY, radius * 0.66, radius * 0.72);
      ctx.fillStyle = IRIS;
      ctx.fill();
      ellipsePath(ctx, irisX, irisY, radius * 0.36, radius * 0.4);
      ctx.fillStyle = PUPIL;
      ctx.fill();
      ellipsePath(ctx, irisX - radius * 0.25, irisY - radius * 0.3, radius * 0.2, radius * 0.2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    },
  );
  // The upper lid is the one line that survives the downscale, so it is heavy.
  ctx.beginPath();
  ctx.moveTo(x - radius * 1.05, y + ry * 0.1);
  ctx.quadraticCurveTo(x, y - ry * 1.45, x + radius * 1.05, y + ry * 0.1);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = DETAIL_WIDTH * 1.2;
  ctx.lineCap = 'round';
  ctx.stroke();
  line(
    ctx,
    p(x + side * radius * 0.95, y - ry * 0.05),
    p(x + side * radius * 1.4, y - ry * 0.45),
    OUTLINE,
    FINE_WIDTH,
  );
}

/**
 * One long soft goblin ear: a smooth leaf, no notches, drooping a little at
 * the tip. `side` is +1 for the ear on +X. The inner hollow is warm, the way
 * lit skin in a thin cartilage glows.
 */
function drawSoftEar(
  ctx: Ctx,
  base: Pt,
  side: number,
  length: number,
  halfWidth: number,
  droop: number,
): void {
  const angle = side > 0 ? -0.22 + droop : Math.PI + 0.22 - droop;
  const tip = p(base.x + Math.cos(angle) * length, base.y + Math.sin(angle) * length);
  const normal = p(-Math.sin(angle), Math.cos(angle));
  const at = (t: number, lift: number): Pt => {
    const width = halfWidth * (1 - t * 0.8);
    return p(
      lerp(base.x, tip.x, t) + normal.x * width * lift,
      lerp(base.y, tip.y, t) + normal.y * width * lift,
    );
  };
  const trace = (): void => {
    const upperStart = at(0, -1);
    const upperMid = at(0.45, -1.35);
    const lowerMid = at(0.5, 1.2);
    const lowerStart = at(0, 1);
    // The tip curls down: the lower edge meets it from underneath.
    const tipDrop = p(tip.x, tip.y + halfWidth * 0.35);
    ctx.beginPath();
    ctx.moveTo(upperStart.x, upperStart.y);
    ctx.quadraticCurveTo(upperMid.x, upperMid.y, tip.x, tip.y);
    ctx.quadraticCurveTo(tipDrop.x, tipDrop.y, lowerMid.x, lowerMid.y);
    ctx.quadraticCurveTo(at(0.2, 1.15).x, at(0.2, 1.15).y, lowerStart.x, lowerStart.y);
    ctx.closePath();
  };
  trace();
  fillOutlined(ctx, SKIN, DETAIL_WIDTH * 1.3);
  withClip(ctx, trace, () => {
    const hollowStart = at(0.12, 0.1);
    const hollowEnd = at(0.72, 0.1);
    ctx.beginPath();
    ctx.moveTo(hollowStart.x, hollowStart.y);
    ctx.quadraticCurveTo(at(0.4, -0.75).x, at(0.4, -0.75).y, hollowEnd.x, hollowEnd.y);
    ctx.quadraticCurveTo(at(0.4, 0.55).x, at(0.4, 0.55).y, hollowStart.x, hollowStart.y);
    ctx.closePath();
    ctx.fillStyle = mix(SKIN_SHADE, CHEEK, 0.45);
    ctx.fill();
    fillSoftEllipse(
      ctx,
      at(0.3, -0.7).x,
      at(0.3, -0.7).y,
      halfWidth,
      halfWidth * 0.4,
      SKIN_LIGHT,
      0.7,
      angle,
    );
  });
}

// ── Mother: proportions ──────────────────────────────────────────────────────

const HEM_Y = -0.03;
const HEM_HALF = 0.25;
const WAIST_Y = -0.39;
const WAIST_HALF = 0.15;
const HIP_Y = -0.3;
const HIP_HALF = 0.2;
const SHOULDER_Y = -0.57;
const SHOULDER_HALF = 0.17;
const NECK_Y = -0.625;
const NECK_HALF = 0.05;

/** A goblin head is large on her as on every goblin; the scarf adds its crown on top. */
const HEAD_Y = -0.73;
const HEAD_RX = 0.125;
const HEAD_RY = 0.112;
/** The point the head rolls about — the top of the neck, not the head's centre. */
const HEAD_PIVOT_Y = -0.64;
/** The top of her scarf, above which a hand raised for help has to show. */
export const MOTHER_CROWN_Y = HEAD_Y - HEAD_RY * 1.34;

const EAR_LENGTH = 0.17;
const EAR_HALF_WIDTH = 0.042;
/** Her ears hang a little below level at rest — relaxed, where a raider's are swept back. */
const EAR_REST_DROOP = 0.5;

const SLEEVE_WIDTH = 0.08;
const HAND_RADIUS = 0.034;

const NEAR_SHOULDER: Pt = { x: 0.15, y: -0.565 };
const FAR_SHOULDER: Pt = { x: -0.15, y: -0.565 };

const BUNDLE_RX = 0.145;
const BUNDLE_RY = 0.08;
const BABY_HEAD_RADIUS = 0.068;

// ── Mother: pose ─────────────────────────────────────────────────────────────

/** The baby's face, which animates on its own terms. */
export interface BabyFace {
  /** 0 asleep, 1 wide awake. */
  readonly eyeOpen: number;
  /** 0 closed, 1 a wide wail. */
  readonly mouthOpen: number;
  /** How far one tiny fist has worked out of the swaddle, 0–1. */
  readonly fist: number;
}

export interface MotherPose {
  /** Whole-body sideways sway, + toward the baby. */
  readonly bodyX: number;
  /** How far the body has sunk, + down. */
  readonly dip: number;
  /** Breath in the chest, 0–1. */
  readonly breath: number;
  /** Head roll about the neck, + toward the baby. */
  readonly headTilt: number;
  /** Where the bundle's centre sits, relative to the body. */
  readonly bundle: Pt;
  /** The bundle's roll: negative lifts the baby's head end. */
  readonly bundleRot: number;
  /** The cradling arm on the baby's side: elbow under the baby's head, hand under its feet. */
  readonly nearElbow: Pt;
  readonly nearHand: Pt;
  /** The other arm: across the bundle at rest, flung up when she calls for help. */
  readonly farElbow: Pt;
  readonly farHand: Pt;
  /** An open, waving hand rather than one laid flat on the blanket. */
  readonly farHandOpen: boolean;
  /** 0 closed, 1 open, past 1 wide with fright. */
  readonly eyeOpen: number;
  /** Where her irises look, each axis −1..1. */
  readonly gaze: Pt;
  /** 0 a calm brow, 1 knotted up in the middle with fear. */
  readonly worry: number;
  readonly smile: number;
  /** 0 closed, 1 calling out. */
  readonly mouthOpen: number;
  /** Extra droop on both ears, radians. */
  readonly earDroop: number;
  readonly baby: BabyFace;
}

export function restingMotherPose(): MotherPose {
  return {
    bodyX: 0,
    dip: 0,
    breath: 0,
    headTilt: 0.14,
    bundle: p(0.04, -0.46),
    bundleRot: -0.32,
    nearElbow: p(0.215, -0.425),
    nearHand: p(-0.075, -0.4),
    farElbow: p(-0.205, -0.43),
    farHand: p(-0.03, -0.49),
    farHandOpen: false,
    eyeOpen: 0.75,
    gaze: p(0.7, 0.6),
    worry: 0,
    smile: 0.8,
    mouthOpen: 0,
    earDroop: 0,
    baby: { eyeOpen: 1, mouthOpen: 0, fist: 0 },
  };
}

// ── Mother: body ─────────────────────────────────────────────────────────────

function slippers(ctx: Ctx, pose: MotherPose): void {
  for (const side of [-1, 1]) {
    ellipsePath(ctx, pose.bodyX * 0.3 + side * 0.085, -0.016, 0.062, 0.028);
    fillOutlined(ctx, SLIPPER, DETAIL_WIDTH);
  }
}

function skirt(ctx: Ctx, pose: MotherPose): void {
  const x = pose.bodyX;
  const top = WAIST_Y + pose.dip;
  const hemShift = pose.bodyX * 0.4;
  const trace = (): void => {
    ctx.beginPath();
    ctx.moveTo(x - WAIST_HALF, top);
    ctx.quadraticCurveTo(x - HIP_HALF - 0.01, HIP_Y + pose.dip, x - HIP_HALF - 0.02, -0.2);
    ctx.quadraticCurveTo(x - HEM_HALF, -0.1, hemShift - HEM_HALF, HEM_Y);
    ctx.quadraticCurveTo(
      hemShift - HEM_HALF * 0.55,
      HEM_Y + 0.02,
      hemShift - HEM_HALF * 0.2,
      HEM_Y,
    );
    ctx.quadraticCurveTo(
      hemShift + HEM_HALF * 0.15,
      HEM_Y + 0.022,
      hemShift + HEM_HALF * 0.5,
      HEM_Y,
    );
    ctx.quadraticCurveTo(hemShift + HEM_HALF * 0.8, HEM_Y + 0.02, hemShift + HEM_HALF, HEM_Y);
    ctx.quadraticCurveTo(x + HEM_HALF, -0.1, x + HIP_HALF + 0.02, -0.2);
    ctx.quadraticCurveTo(x + HIP_HALF + 0.01, HIP_Y + pose.dip, x + WAIST_HALF, top);
    ctx.closePath();
  };
  trace();
  fillOutlined(ctx, DRESS);
  withClip(ctx, trace, () => {
    fillSoftEllipse(ctx, x + HEM_HALF * 0.85, -0.14, 0.13, 0.2, DRESS_SHADE, 0.75);
    fillSoftEllipse(ctx, x - HIP_HALF * 0.8, -0.28, 0.07, 0.12, DRESS_LIGHT, 0.6);
    for (const fx of [-0.85, 0.85]) {
      ctx.beginPath();
      ctx.moveTo(x + WAIST_HALF * fx, top + 0.08);
      ctx.quadraticCurveTo(x + HIP_HALF * fx * 1.05, -0.15, hemShift + HEM_HALF * fx * 0.95, HEM_Y);
      ctx.strokeStyle = DRESS_SHADE;
      ctx.lineWidth = DETAIL_WIDTH;
      ctx.stroke();
    }
  });
}

function apron(ctx: Ctx, pose: MotherPose): void {
  const x = pose.bodyX;
  const top = WAIST_Y + pose.dip + 0.01;
  const bottom = -0.085;
  const hemShift = pose.bodyX * 0.4;
  const trace = (): void => {
    smoothClosed(ctx, [
      p(x - 0.12, top),
      p(x + 0.12, top),
      p(x + 0.15, lerp(top, bottom, 0.5)),
      p(hemShift + 0.155, bottom),
      p(hemShift - 0.155, bottom),
      p(x - 0.15, lerp(top, bottom, 0.5)),
    ]);
  };
  trace();
  fillOutlined(ctx, APRON);
  withClip(ctx, trace, () => {
    fillSoftEllipse(ctx, x + 0.14, lerp(top, bottom, 0.6), 0.07, 0.2, APRON_SHADE, 0.7);
    for (const fx of [-0.07, 0.05]) {
      ctx.beginPath();
      ctx.moveTo(x + fx, top + 0.05);
      ctx.quadraticCurveTo(x + fx * 1.3, -0.2, hemShift + fx * 1.5, bottom);
      ctx.strokeStyle = rgba(APRON_SHADE, 0.8);
      ctx.lineWidth = FINE_WIDTH;
      ctx.stroke();
    }
    // A pocket on the far side, stitched, for everything a mother carries.
    ctx.beginPath();
    ctx.rect(x - 0.11, -0.25, 0.08, 0.07);
    ctx.strokeStyle = APRON_SHADE;
    ctx.lineWidth = FINE_WIDTH;
    ctx.stroke();
  });
  // Waistband, tied off in a small bow at the near hip.
  line(ctx, p(x - 0.15, top + 0.012), p(x + 0.15, top + 0.012), APRON_SHADE, 0.024);
  for (const side of [-1, 1]) {
    ellipsePath(ctx, x + 0.13 + side * 0.022, top + 0.006, 0.02, 0.012, side * 0.5);
    fillOutlined(ctx, APRON, FINE_WIDTH);
  }
  ellipsePath(ctx, x + 0.13, top + 0.01, 0.01, 0.01);
  fillOutlined(ctx, APRON_SHADE, FINE_WIDTH);
}

function torsoTrace(ctx: Ctx, pose: MotherPose): void {
  const x = pose.bodyX;
  const dip = pose.dip;
  const breath = pose.breath * 0.008;
  smoothClosed(ctx, [
    p(x - NECK_HALF, NECK_Y + dip),
    p(x + NECK_HALF, NECK_Y + dip),
    p(x + SHOULDER_HALF * 0.75, SHOULDER_Y + dip - 0.03),
    p(x + SHOULDER_HALF + 0.025, SHOULDER_Y + dip + 0.02),
    p(x + WAIST_HALF + breath + 0.02, -0.47 + dip),
    p(x + WAIST_HALF, WAIST_Y + dip + 0.02),
    p(x - WAIST_HALF, WAIST_Y + dip + 0.02),
    p(x - WAIST_HALF - breath - 0.02, -0.47 + dip),
    p(x - SHOULDER_HALF - 0.025, SHOULDER_Y + dip + 0.02),
    p(x - SHOULDER_HALF * 0.75, SHOULDER_Y + dip - 0.03),
  ]);
}

function torso(ctx: Ctx, pose: MotherPose): void {
  torsoTrace(ctx, pose);
  fillOutlined(ctx, DRESS);
  withClip(
    ctx,
    () => torsoTrace(ctx, pose),
    () => {
      fillSoftEllipse(ctx, pose.bodyX + 0.14, -0.45 + pose.dip, 0.08, 0.12, DRESS_SHADE, 0.7);
    },
  );
}

/**
 * The shawl: a knitted mantle over the shoulders and upper arms whose two
 * front points hang either side of the bundle. It is what rounds her shoulders
 * into a soft dome — the opposite of a goblin's bony hunch.
 */
function shawlTrace(ctx: Ctx, pose: MotherPose): void {
  const x = pose.bodyX;
  const dip = pose.dip;
  smoothClosed(ctx, [
    p(x - NECK_HALF * 1.3, NECK_Y + dip - 0.005),
    p(x + NECK_HALF * 1.3, NECK_Y + dip - 0.005),
    p(x + SHOULDER_HALF * 0.9, SHOULDER_Y + dip - 0.035),
    p(x + SHOULDER_HALF + 0.06, SHOULDER_Y + dip + 0.03),
    p(x + SHOULDER_HALF + 0.055, -0.46 + dip),
    p(x + 0.14, -0.415 + dip),
    p(x + 0.06, -0.5 + dip),
    p(x, -0.52 + dip),
    p(x - 0.06, -0.5 + dip),
    p(x - 0.14, -0.415 + dip),
    p(x - SHOULDER_HALF - 0.055, -0.46 + dip),
    p(x - SHOULDER_HALF - 0.06, SHOULDER_Y + dip + 0.03),
    p(x - SHOULDER_HALF * 0.9, SHOULDER_Y + dip - 0.035),
  ]);
}

function shawl(ctx: Ctx, pose: MotherPose): void {
  const x = pose.bodyX;
  const dip = pose.dip;
  shawlTrace(ctx, pose);
  fillOutlined(ctx, SHAWL);
  withClip(
    ctx,
    () => shawlTrace(ctx, pose),
    () => {
      fillSoftEllipse(ctx, x - 0.13, SHOULDER_Y + dip - 0.01, 0.09, 0.05, SHAWL_LIGHT, 0.85, -0.3);
      fillSoftEllipse(ctx, x + 0.18, -0.47 + dip, 0.07, 0.09, SHAWL_SHADE, 0.75);
      // Knit ribbing running down off the shoulders.
      for (let i = -4; i <= 4; i++) {
        if (i === 0) continue;
        const fx = i / 4;
        line(
          ctx,
          p(x + fx * 0.09, NECK_Y + dip + 0.02),
          p(x + fx * 0.22, -0.46 + dip),
          rgba(SHAWL_SHADE, 0.55),
          FINE_WIDTH * 0.8,
        );
      }
    },
  );
  // Fringe on the two hanging points.
  for (const side of [-1, 1]) {
    const tipX = x + side * 0.14;
    const tipY = -0.415 + dip;
    for (let i = 0; i < 3; i++) {
      const fx = tipX + side * (i - 1) * 0.02;
      line(ctx, p(fx, tipY - 0.005), p(fx + side * 0.006, tipY + 0.03), SHAWL_SHADE, FINE_WIDTH);
    }
  }
}

function arm(ctx: Ctx, shoulder: Pt, elbow: Pt, hand: Pt): Pt {
  const wrist = p(lerp(elbow.x, hand.x, 0.84), lerp(elbow.y, hand.y, 0.84));
  tube(ctx, [shoulder, elbow, wrist], DRESS, SLEEVE_WIDTH);
  line(
    ctx,
    p(lerp(elbow.x, wrist.x, 0.2), lerp(elbow.y, wrist.y, 0.2) - 0.012),
    p(lerp(elbow.x, wrist.x, 0.75), lerp(elbow.y, wrist.y, 0.75) - 0.012),
    rgba(DRESS_LIGHT, 0.6),
    SLEEVE_WIDTH * 0.25,
  );
  return wrist;
}

function hand(ctx: Ctx, wrist: Pt, at: Pt, open: boolean): void {
  const angle = Math.atan2(at.y - wrist.y, at.x - wrist.x);
  if (open) {
    // A spread palm, fingers fanned along the wave: three fingers read at 32 px, five smear.
    for (const spread of [-0.75, 0, 0.75]) {
      const fingerAngle = angle + spread;
      const tip = p(
        at.x + Math.cos(fingerAngle) * HAND_RADIUS * 2.1,
        at.y + Math.sin(fingerAngle) * HAND_RADIUS * 2.1,
      );
      line(ctx, at, tip, OUTLINE, HAND_RADIUS * 0.7 + DETAIL_WIDTH * 2);
      line(ctx, at, tip, SKIN, HAND_RADIUS * 0.7);
    }
  }
  ellipsePath(ctx, at.x, at.y, HAND_RADIUS * 1.1, HAND_RADIUS * 0.85, angle);
  fillOutlined(ctx, SKIN, DETAIL_WIDTH);
  fillSoftEllipse(
    ctx,
    at.x - HAND_RADIUS * 0.3,
    at.y - HAND_RADIUS * 0.3,
    HAND_RADIUS * 0.6,
    HAND_RADIUS * 0.4,
    SKIN_LIGHT,
    0.7,
    angle,
  );
}

// ── Baby ─────────────────────────────────────────────────────────────────────

/** The baby's face sits at the bundle's raised end, just in from its tip. */
const BABY_HEAD_ALONG = 0.78;
const BABY_HEAD_ACROSS = -0.012;

function babyHeadCentre(centre: Pt, rot: number): Pt {
  const u = BUNDLE_RX * BABY_HEAD_ALONG;
  const v = BABY_HEAD_ACROSS;
  return p(
    centre.x + u * Math.cos(rot) - v * Math.sin(rot),
    centre.y + u * Math.sin(rot) + v * Math.cos(rot),
  );
}

/** Where the baby's face is drawn in a pose, in tile units from the ground point between her feet. */
export function babyFacePoint(pose: MotherPose): Pt {
  return babyHeadCentre(addPt(pose.bundle, p(pose.bodyX, pose.dip)), pose.bundleRot);
}

/** Where the blanket bundle's centre is drawn in a pose, in the same units. */
export function bundlePoint(pose: MotherPose): Pt {
  return addPt(pose.bundle, p(pose.bodyX, pose.dip));
}

/** Where her free hand is drawn in a pose, in the same units. */
export function farHandPoint(pose: MotherPose): Pt {
  return addPt(pose.farHand, p(pose.bodyX, pose.dip));
}

/**
 * The swaddled infant: a pale blanket bundle with a hood folded round a tiny
 * green face. The face is almost all eyes — at 32 px it is a green dot with two
 * darker dots in it inside a pale oval, and that is enough to say "baby".
 */
function drawBundle(ctx: Ctx, centre: Pt, rot: number, face: BabyFace): void {
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const toWorld = (u: number, v: number): Pt =>
    p(centre.x + u * cos - v * sin, centre.y + u * sin + v * cos);
  const bundleTrace = (): void => ellipsePath(ctx, centre.x, centre.y, BUNDLE_RX, BUNDLE_RY, rot);
  bundleTrace();
  fillOutlined(ctx, BLANKET);
  withClip(ctx, bundleTrace, () => {
    const lit = toWorld(-0.02, -0.035);
    fillSoftEllipse(ctx, lit.x, lit.y, BUNDLE_RX * 0.8, BUNDLE_RY * 0.45, BLANKET_LIGHT, 0.85, rot);
    const shade = toWorld(0, 0.05);
    fillSoftEllipse(ctx, shade.x, shade.y, BUNDLE_RX, BUNDLE_RY * 0.5, BLANKET_SHADE, 0.7, rot);
    // The wrap's folds cross the bundle diagonally.
    for (const u of [-0.07, -0.01]) {
      const a = toWorld(u, -BUNDLE_RY);
      const b = toWorld(u + 0.05, BUNDLE_RY);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      const bend = toWorld(u + 0.035, 0);
      ctx.quadraticCurveTo(bend.x, bend.y, b.x, b.y);
      ctx.strokeStyle = BLANKET_SHADE;
      ctx.lineWidth = FINE_WIDTH;
      ctx.stroke();
    }
    // A pink trim band across the fold.
    const trimA = toWorld(0.045, -BUNDLE_RY);
    const trimB = toWorld(0.085, BUNDLE_RY);
    line(ctx, trimA, trimB, BLANKET_TRIM, 0.018);
  });

  const headCentre = babyHeadCentre(centre, rot);
  // Hood: a fold of blanket standing proud round the face.
  ellipsePath(
    ctx,
    headCentre.x,
    headCentre.y,
    BABY_HEAD_RADIUS * 1.35,
    BABY_HEAD_RADIUS * 1.3,
    rot,
  );
  fillOutlined(ctx, BLANKET);
  fillSoftEllipse(
    ctx,
    headCentre.x - 0.015,
    headCentre.y - 0.02,
    BABY_HEAD_RADIUS,
    BABY_HEAD_RADIUS * 0.6,
    BLANKET_LIGHT,
    0.8,
  );

  // Two stubby ears tucked out of the hood's sides: the only goblin in it.
  for (const side of [-1, 1]) {
    const earBase = p(headCentre.x + side * BABY_HEAD_RADIUS * 0.85, headCentre.y - 0.004);
    const earTip = p(earBase.x + side * 0.05, earBase.y - 0.022);
    ctx.beginPath();
    ctx.moveTo(earBase.x, earBase.y - 0.016);
    ctx.quadraticCurveTo(earTip.x - side * 0.01, earTip.y - 0.01, earTip.x, earTip.y);
    ctx.quadraticCurveTo(earTip.x - side * 0.012, earTip.y + 0.02, earBase.x, earBase.y + 0.016);
    ctx.closePath();
    fillOutlined(ctx, BABY_SKIN, FINE_WIDTH * 1.2);
  }

  const faceTrace = (): void =>
    ellipsePath(ctx, headCentre.x, headCentre.y + 0.004, BABY_HEAD_RADIUS, BABY_HEAD_RADIUS * 0.92);
  faceTrace();
  fillOutlined(ctx, BABY_SKIN, DETAIL_WIDTH);
  withClip(ctx, faceTrace, () => {
    fillSoftEllipse(
      ctx,
      headCentre.x + 0.02,
      headCentre.y + 0.025,
      BABY_HEAD_RADIUS * 0.8,
      BABY_HEAD_RADIUS * 0.6,
      BABY_SKIN_SHADE,
      0.6,
    );
    fillSoftEllipse(
      ctx,
      headCentre.x - 0.015,
      headCentre.y - 0.018,
      BABY_HEAD_RADIUS * 0.55,
      BABY_HEAD_RADIUS * 0.4,
      BABY_SKIN_LIGHT,
      0.8,
    );
  });

  const eyeY = headCentre.y - 0.002;
  const eyeRadius = BABY_HEAD_RADIUS * 0.3;
  for (const side of [-1, 1]) {
    const ex = headCentre.x + side * BABY_HEAD_RADIUS * 0.42;
    if (face.eyeOpen < 0.3) {
      ctx.beginPath();
      ctx.arc(ex, eyeY - eyeRadius * 0.3, eyeRadius * 0.9, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = FINE_WIDTH;
      ctx.stroke();
      continue;
    }
    ellipsePath(ctx, ex, eyeY, eyeRadius, eyeRadius * 1.1);
    ctx.fillStyle = PUPIL;
    ctx.fill();
    ellipsePath(
      ctx,
      ex - eyeRadius * 0.35,
      eyeY - eyeRadius * 0.4,
      eyeRadius * 0.38,
      eyeRadius * 0.38,
    );
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }
  const mouthY = headCentre.y + BABY_HEAD_RADIUS * 0.5;
  const wail = clamp01(face.mouthOpen);
  if (wail > 0.1) {
    ellipsePath(ctx, headCentre.x, mouthY, 0.011 + wail * 0.006, 0.006 + wail * 0.012);
    ctx.fillStyle = MOUTH_INNER;
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(headCentre.x, mouthY - 0.006, 0.01, 0.2 * Math.PI, 0.8 * Math.PI);
    ctx.strokeStyle = MOUTH;
    ctx.lineWidth = FINE_WIDTH;
    ctx.stroke();
  }
  fillSoftEllipse(
    ctx,
    headCentre.x - BABY_HEAD_RADIUS * 0.62,
    mouthY - 0.012,
    0.012,
    0.008,
    CHEEK,
    0.7,
  );
  fillSoftEllipse(
    ctx,
    headCentre.x + BABY_HEAD_RADIUS * 0.62,
    mouthY - 0.012,
    0.012,
    0.008,
    CHEEK,
    0.7,
  );

  const fist = clamp01(face.fist);
  if (fist > 0.05) {
    const fistAt = toWorld(BUNDLE_RX * 0.3, -BUNDLE_RY * (0.7 + fist * 0.6));
    ellipsePath(ctx, fistAt.x, fistAt.y, 0.019, 0.017);
    fillOutlined(ctx, BABY_SKIN, FINE_WIDTH);
  }
}

// ── Mother: head ─────────────────────────────────────────────────────────────

/** Where the scarf's knot sits and how its two tails splay, in head space. */
const KNOT: Pt = { x: HEAD_RX * 0.45, y: -HEAD_RY * 1.28 };

function scarfTrace(ctx: Ctx): void {
  smoothClosed(ctx, [
    p(-HEAD_RX * 1.02, -HEAD_RY * 0.08),
    p(-HEAD_RX * 1.08, -HEAD_RY * 0.7),
    p(-HEAD_RX * 0.7, -HEAD_RY * 1.2),
    p(0, -HEAD_RY * 1.34),
    p(HEAD_RX * 0.72, -HEAD_RY * 1.22),
    p(HEAD_RX * 1.1, -HEAD_RY * 0.7),
    p(HEAD_RX * 1.04, -HEAD_RY * 0.08),
    // The folded front edge, a soft band across her brow.
    p(HEAD_RX * 0.7, -HEAD_RY * 0.36),
    p(0, -HEAD_RY * 0.46),
    p(-HEAD_RX * 0.7, -HEAD_RY * 0.36),
  ]);
}

function drawScarf(ctx: Ctx): void {
  // The knot's two tails first, so the knot itself sits over their roots.
  for (const [dx, dy] of [
    [0.07, -0.035],
    [0.045, -0.07],
  ]) {
    const tailTip = p(KNOT.x + dx, KNOT.y + dy);
    ctx.beginPath();
    ctx.moveTo(KNOT.x - 0.012, KNOT.y + 0.008);
    ctx.quadraticCurveTo(KNOT.x + dx * 0.4, KNOT.y + dy * 0.9, tailTip.x, tailTip.y);
    ctx.quadraticCurveTo(KNOT.x + dx * 0.7, KNOT.y + dy * 0.2, KNOT.x + 0.012, KNOT.y + 0.012);
    ctx.closePath();
    fillOutlined(ctx, SCARF, DETAIL_WIDTH);
  }
  scarfTrace(ctx);
  fillOutlined(ctx, SCARF);
  withClip(
    ctx,
    () => scarfTrace(ctx),
    () => {
      fillSoftEllipse(
        ctx,
        -HEAD_RX * 0.4,
        -HEAD_RY * 1.0,
        HEAD_RX * 0.6,
        HEAD_RY * 0.3,
        SCARF_LIGHT,
        0.85,
        -0.2,
      );
      fillSoftEllipse(
        ctx,
        HEAD_RX * 0.9,
        -HEAD_RY * 0.5,
        HEAD_RX * 0.35,
        HEAD_RY * 0.5,
        SCARF_SHADE,
        0.75,
      );
      // Cream dots: a printed kerchief, never a war-band colour.
      const dots: readonly Pt[] = [
        p(-0.075, -0.1),
        p(-0.03, -0.125),
        p(0.02, -0.11),
        p(0.065, -0.09),
        p(-0.1, -0.06),
        p(-0.05, -0.075),
        p(0.0, -0.068),
        p(0.05, -0.058),
        p(0.098, -0.055),
      ];
      for (const dot of dots) {
        ellipsePath(ctx, dot.x, dot.y, 0.0085, 0.0085);
        ctx.fillStyle = rgba(SCARF_DOT, 0.9);
        ctx.fill();
      }
      // The fold's own shadow line just above the brow band.
      ctx.beginPath();
      ctx.moveTo(-HEAD_RX * 0.95, -HEAD_RY * 0.22);
      ctx.quadraticCurveTo(0, -HEAD_RY * 0.72, HEAD_RX * 0.95, -HEAD_RY * 0.22);
      ctx.strokeStyle = SCARF_SHADE;
      ctx.lineWidth = DETAIL_WIDTH;
      ctx.stroke();
    },
  );
  ellipsePath(ctx, KNOT.x, KNOT.y, 0.028, 0.022, -0.4);
  fillOutlined(ctx, SCARF_LIGHT, DETAIL_WIDTH);
}

function drawMotherHead(ctx: Ctx, pose: MotherPose): void {
  const pivotX = pose.bodyX;
  const pivotY = HEAD_PIVOT_Y + pose.dip;
  ctx.save();
  ctx.translate(pivotX, pivotY);
  ctx.rotate(pose.headTilt);
  ctx.translate(0, HEAD_Y - HEAD_PIVOT_Y);

  for (const side of [-1, 1]) {
    drawSoftEar(
      ctx,
      p(side * HEAD_RX * 0.86, -HEAD_RY * 0.12),
      side,
      EAR_LENGTH,
      EAR_HALF_WIDTH,
      EAR_REST_DROOP + pose.earDroop,
    );
  }
  // A small gold hoop in the near ear's lobe.
  ctx.beginPath();
  ctx.arc(HEAD_RX * 1.02, HEAD_RY * 0.2, 0.017, 0, TAU);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = FINE_WIDTH * 1.9;
  ctx.stroke();
  ctx.strokeStyle = EARRING;
  ctx.lineWidth = FINE_WIDTH;
  ctx.stroke();

  // Face: full cheeks tapering to a soft rounded chin — round, never the enemy's lantern jaw.
  const faceTrace = (): void => {
    smoothClosed(ctx, [
      p(-HEAD_RX * 0.95, -HEAD_RY * 0.6),
      p(0, -HEAD_RY * 1.0),
      p(HEAD_RX * 0.95, -HEAD_RY * 0.6),
      p(HEAD_RX * 1.05, HEAD_RY * 0.3),
      p(HEAD_RX * 0.62, HEAD_RY * 0.95),
      p(0, HEAD_RY * 1.1),
      p(-HEAD_RX * 0.62, HEAD_RY * 0.95),
      p(-HEAD_RX * 1.05, HEAD_RY * 0.3),
    ]);
  };
  faceTrace();
  fillOutlined(ctx, SKIN);
  withClip(ctx, faceTrace, () => {
    fillSoftEllipse(
      ctx,
      HEAD_RX * 0.75,
      HEAD_RY * 0.5,
      HEAD_RX * 0.6,
      HEAD_RY * 0.8,
      SKIN_SHADE,
      0.6,
      -0.3,
    );
    fillSoftEllipse(
      ctx,
      -HEAD_RX * 0.35,
      -HEAD_RY * 0.2,
      HEAD_RX * 0.55,
      HEAD_RY * 0.45,
      SKIN_LIGHT,
      0.6,
      -0.3,
    );
    fillSoftEllipse(
      ctx,
      -HEAD_RX * 0.58,
      HEAD_RY * 0.38,
      HEAD_RX * 0.26,
      HEAD_RY * 0.18,
      CHEEK,
      0.6,
    );
    fillSoftEllipse(
      ctx,
      HEAD_RX * 0.58,
      HEAD_RY * 0.38,
      HEAD_RX * 0.26,
      HEAD_RY * 0.18,
      CHEEK,
      0.5,
    );
  });

  drawScarf(ctx);

  const eyeY = -HEAD_RY * 0.02;
  const eyeRadius = 0.028;
  const worry = clamp01(pose.worry);
  for (const side of [-1, 1]) {
    const ex = side * HEAD_RX * 0.44;
    drawKindEye(ctx, ex, eyeY, eyeRadius, pose.eyeOpen, pose.gaze, side);
    // Brows: soft arches that knot upward in the middle when she is frightened.
    const innerX = ex - side * eyeRadius * 0.9;
    const outerX = ex + side * eyeRadius * 1.2;
    const browBase = eyeY - eyeRadius * 1.75;
    ctx.beginPath();
    ctx.moveTo(innerX, browBase - worry * 0.02);
    ctx.quadraticCurveTo(ex, browBase - 0.012 - worry * 0.004, outerX, browBase + worry * 0.012);
    ctx.strokeStyle = SKIN_DEEP;
    ctx.lineWidth = DETAIL_WIDTH;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  // The nose: long and soft, drooping to a round bulb — a goblin's, gentled.
  const noseTop = p(0, eyeY + 0.005);
  const noseTip = p(0.012, HEAD_RY * 0.42);
  fillSoftEllipse(ctx, noseTip.x + 0.012, noseTip.y + 0.018, 0.04, 0.02, SKIN_DEEP, 0.55);
  ctx.beginPath();
  ctx.moveTo(noseTop.x - 0.014, noseTop.y);
  ctx.quadraticCurveTo(noseTip.x - 0.035, noseTip.y - 0.01, noseTip.x - 0.028, noseTip.y + 0.012);
  ctx.quadraticCurveTo(noseTip.x, noseTip.y + 0.034, noseTip.x + 0.03, noseTip.y + 0.012);
  ctx.quadraticCurveTo(noseTip.x + 0.034, noseTip.y - 0.012, noseTop.x + 0.014, noseTop.y);
  ctx.closePath();
  ctx.fillStyle = mix(SKIN, CHEEK, 0.18);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(noseTip.x - 0.028, noseTip.y + 0.012);
  ctx.quadraticCurveTo(noseTip.x, noseTip.y + 0.034, noseTip.x + 0.03, noseTip.y + 0.012);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = DETAIL_WIDTH;
  ctx.stroke();
  fillSoftEllipse(ctx, noseTip.x - 0.01, noseTip.y - 0.004, 0.012, 0.01, SKIN_LIGHT, 0.9);

  const mouthY = HEAD_RY * 0.74;
  const open = clamp01(pose.mouthOpen);
  const smile = clamp01(pose.smile);
  if (open > 0.05) {
    ellipsePath(ctx, 0.008, mouthY + open * 0.008, 0.024 - open * 0.004, 0.008 + open * 0.02);
    ctx.fillStyle = MOUTH_INNER;
    ctx.fill();
    ctx.strokeStyle = MOUTH;
    ctx.lineWidth = FINE_WIDTH;
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(-0.03, mouthY - smile * 0.008);
    ctx.quadraticCurveTo(0.008, mouthY + 0.004 + smile * 0.016, 0.044, mouthY - smile * 0.008);
    ctx.strokeStyle = MOUTH;
    ctx.lineWidth = DETAIL_WIDTH;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
  ctx.restore();
}

// ── Mother: composition ──────────────────────────────────────────────────────

/**
 * Head-on, turned a touch toward the baby: slippers, skirt, apron, bodice,
 * the arms, the shawl over their shoulders, the bundle cradled in the near arm
 * with the far hand laid over it, then the head bowed toward it.
 */
export function drawGoblinMother(ctx: Ctx, pose: MotherPose): void {
  const body = p(pose.bodyX, pose.dip);
  const nearShoulder = addPt(NEAR_SHOULDER, body);
  const farShoulder = addPt(FAR_SHOULDER, body);
  const nearElbow = addPt(pose.nearElbow, body);
  const nearHand = addPt(pose.nearHand, body);
  const farElbow = addPt(pose.farElbow, body);
  const farHand = addPt(pose.farHand, body);
  const bundle = addPt(pose.bundle, body);
  const farArmRaised = farHand.y < farShoulder.y;

  shadowUnder(ctx, pose.bodyX * 0.4, 0.3);
  slippers(ctx, pose);
  skirt(ctx, pose);
  apron(ctx, pose);
  torso(ctx, pose);

  const nearWrist = arm(ctx, nearShoulder, nearElbow, nearHand);
  hand(ctx, nearWrist, nearHand, false);
  shawl(ctx, pose);
  drawBundle(ctx, bundle, pose.bundleRot, pose.baby);
  // A raised arm lifts the shawl with it, so its sleeve is drawn over the
  // drape from inside the shoulder; left under the shawl it pinches the knit
  // into a lump that reads as a sack on her back.
  const farRoot = farArmRaised ? p(farShoulder.x + 0.03, farShoulder.y + 0.01) : farShoulder;
  const farWrist = arm(ctx, farRoot, farElbow, farHand);
  hand(ctx, farWrist, farHand, pose.farHandOpen);
  drawMotherHead(ctx, pose);
}

// ── Toddler ──────────────────────────────────────────────────────────────────

const TODDLER_HEAD_Y = -0.35;
const TODDLER_HEAD_RX = 0.11;
const TODDLER_HEAD_RY = 0.108;
const TODDLER_NECK_Y = -0.265;
const TODDLER_HIP_Y = -0.11;
const TODDLER_HIP_HALF = 0.045;
const TODDLER_SHOULDER: Pt = { x: 0.07, y: -0.235 };
const TODDLER_LEG_WIDTH = 0.05;
const TODDLER_ARM_WIDTH = 0.04;
const TODDLER_HAND_RADIUS = 0.022;
const TODDLER_EAR_LENGTH = 0.12;
const TODDLER_EAR_HALF_WIDTH = 0.028;

export interface ToddlerPose {
  /** Sideways shift of everything above the feet, + toward where he is heading. */
  readonly bodyX: number;
  /** Rise of the body off the legs, + up. */
  readonly bob: number;
  /** Roll of the body about the hips, + toward +X. */
  readonly lean: number;
  /** Feet on the ground plane, relative to the origin; y < 0 is a lifted foot. */
  readonly backFoot: Pt;
  readonly frontFoot: Pt;
  /** Hands relative to the origin. */
  readonly backHand: Pt;
  readonly frontHand: Pt;
  /** Head roll, + toward +X. */
  readonly headTilt: number;
  readonly eyeOpen: number;
  readonly mouthOpen: number;
}

export function restingToddlerPose(): ToddlerPose {
  return {
    bodyX: 0,
    bob: 0,
    lean: 0,
    backFoot: p(-0.05, 0),
    frontFoot: p(0.05, 0),
    backHand: p(-0.11, -0.15),
    frontHand: p(0.11, -0.15),
    headTilt: 0.05,
    eyeOpen: 1,
    mouthOpen: 0.3,
  };
}

function bootie(ctx: Ctx, at: Pt): void {
  // Toes point the way he is walking: +X.
  ellipsePath(ctx, at.x + 0.012, at.y - 0.016, 0.038, 0.022);
  fillOutlined(ctx, BOOTIE, DETAIL_WIDTH);
  fillSoftEllipse(ctx, at.x + 0.004, at.y - 0.024, 0.02, 0.008, mix(BOOTIE, '#ffffff', 0.4), 0.7);
}

function toddlerHead(ctx: Ctx, pose: ToddlerPose, neck: Pt): void {
  ctx.save();
  ctx.translate(neck.x, neck.y);
  ctx.rotate(pose.headTilt + pose.lean * 0.5);
  ctx.translate(0, TODDLER_HEAD_Y - TODDLER_NECK_Y);

  for (const side of [-1, 1]) {
    drawSoftEar(
      ctx,
      p(side * TODDLER_HEAD_RX * 0.85, -TODDLER_HEAD_RY * 0.05),
      side,
      TODDLER_EAR_LENGTH,
      TODDLER_EAR_HALF_WIDTH,
      -0.1,
    );
  }
  const faceTrace = (): void => {
    smoothClosed(ctx, [
      p(-TODDLER_HEAD_RX, -TODDLER_HEAD_RY * 0.5),
      p(0, -TODDLER_HEAD_RY * 1.05),
      p(TODDLER_HEAD_RX, -TODDLER_HEAD_RY * 0.5),
      p(TODDLER_HEAD_RX * 1.04, TODDLER_HEAD_RY * 0.45),
      p(0, TODDLER_HEAD_RY * 1.08),
      p(-TODDLER_HEAD_RX * 1.04, TODDLER_HEAD_RY * 0.45),
    ]);
  };
  faceTrace();
  fillOutlined(ctx, BABY_SKIN);
  withClip(ctx, faceTrace, () => {
    fillSoftEllipse(
      ctx,
      TODDLER_HEAD_RX * 0.7,
      TODDLER_HEAD_RY * 0.5,
      TODDLER_HEAD_RX * 0.6,
      TODDLER_HEAD_RY * 0.7,
      BABY_SKIN_SHADE,
      0.6,
    );
    fillSoftEllipse(
      ctx,
      -TODDLER_HEAD_RX * 0.3,
      -TODDLER_HEAD_RY * 0.1,
      TODDLER_HEAD_RX * 0.5,
      TODDLER_HEAD_RY * 0.4,
      BABY_SKIN_LIGHT,
      0.7,
    );
  });

  // A knit cap in his mother's red, rolled cream at the brim, with a pompom.
  const capTrace = (): void => {
    smoothClosed(ctx, [
      p(-TODDLER_HEAD_RX * 1.05, -TODDLER_HEAD_RY * 0.36),
      p(-TODDLER_HEAD_RX * 0.95, -TODDLER_HEAD_RY * 1.05),
      p(0, -TODDLER_HEAD_RY * 1.4),
      p(TODDLER_HEAD_RX * 0.95, -TODDLER_HEAD_RY * 1.05),
      p(TODDLER_HEAD_RX * 1.05, -TODDLER_HEAD_RY * 0.36),
      p(0, -TODDLER_HEAD_RY * 0.52),
    ]);
  };
  capTrace();
  fillOutlined(ctx, CAP);
  withClip(ctx, capTrace, () => {
    fillSoftEllipse(
      ctx,
      -TODDLER_HEAD_RX * 0.35,
      -TODDLER_HEAD_RY * 0.95,
      TODDLER_HEAD_RX * 0.5,
      TODDLER_HEAD_RY * 0.3,
      CAP_LIGHT,
      0.8,
    );
    fillSoftEllipse(
      ctx,
      TODDLER_HEAD_RX * 0.8,
      -TODDLER_HEAD_RY * 0.6,
      TODDLER_HEAD_RX * 0.3,
      TODDLER_HEAD_RY * 0.5,
      CAP_SHADE,
      0.7,
    );
    for (let i = -3; i <= 3; i++) {
      line(
        ctx,
        p(i * 0.024, -TODDLER_HEAD_RY * 1.25),
        p(i * 0.03, -TODDLER_HEAD_RY * 0.45),
        rgba(CAP_SHADE, 0.5),
        FINE_WIDTH * 0.7,
      );
    }
  });
  ctx.beginPath();
  ctx.moveTo(-TODDLER_HEAD_RX * 1.06, -TODDLER_HEAD_RY * 0.48);
  ctx.quadraticCurveTo(0, -TODDLER_HEAD_RY * 0.68, TODDLER_HEAD_RX * 1.06, -TODDLER_HEAD_RY * 0.48);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 0.03 + OUTLINE_WIDTH;
  ctx.stroke();
  ctx.strokeStyle = CAP_RIM;
  ctx.lineWidth = 0.03;
  ctx.stroke();
  ellipsePath(ctx, 0.01, -TODDLER_HEAD_RY * 1.45, 0.026, 0.024);
  fillOutlined(ctx, CAP_RIM, DETAIL_WIDTH);

  // Huge eyes set low, turned toward where he is going.
  const eyeY = TODDLER_HEAD_RY * 0.14;
  const gaze = p(0.8, -0.1);
  for (const side of [-1, 1]) {
    drawKindEye(ctx, side * TODDLER_HEAD_RX * 0.44 + 0.006, eyeY, 0.028, pose.eyeOpen, gaze, side);
  }
  ellipsePath(ctx, 0.012, TODDLER_HEAD_RY * 0.42, 0.016, 0.012);
  ctx.fillStyle = mix(BABY_SKIN, CHEEK, 0.35);
  ctx.fill();
  ctx.strokeStyle = BABY_SKIN_SHADE;
  ctx.lineWidth = FINE_WIDTH;
  ctx.stroke();
  const open = clamp01(pose.mouthOpen);
  const mouthY = TODDLER_HEAD_RY * 0.68;
  ctx.beginPath();
  ctx.moveTo(-0.014, mouthY);
  ctx.quadraticCurveTo(0.012, mouthY + 0.01 + open * 0.02, 0.036, mouthY);
  ctx.closePath();
  ctx.fillStyle = MOUTH_INNER;
  ctx.fill();
  ctx.strokeStyle = MOUTH;
  ctx.lineWidth = FINE_WIDTH;
  ctx.stroke();
  fillSoftEllipse(ctx, -TODDLER_HEAD_RX * 0.62, TODDLER_HEAD_RY * 0.45, 0.018, 0.012, CHEEK, 0.75);
  fillSoftEllipse(ctx, TODDLER_HEAD_RX * 0.66, TODDLER_HEAD_RY * 0.45, 0.018, 0.012, CHEEK, 0.65);
  ctx.restore();
}

/**
 * The toddler: a big head in a knit cap, stubby ears, a round romper in the
 * mustard of his mother's shawl and short bowed legs. He is turned toward +X,
 * so his toes and his eyes point where he is going while his body stays
 * square to the camera — at 32 px that is what says "toddling this way".
 */
export function drawGoblinToddler(ctx: Ctx, pose: ToddlerPose): void {
  const hipCentre = p(pose.bodyX, TODDLER_HIP_Y - pose.bob);
  shadowUnder(ctx, pose.bodyX * 0.5, 0.14);

  const legFor = (foot: Pt, side: number): void => {
    const hip = p(hipCentre.x + side * TODDLER_HIP_HALF, hipCentre.y);
    const ankle = p(foot.x, foot.y - 0.025);
    const knee = p(lerp(hip.x, ankle.x, 0.5) + side * 0.012, lerp(hip.y, ankle.y, 0.5));
    tube(ctx, [hip, knee, ankle], BABY_SKIN, TODDLER_LEG_WIDTH);
    bootie(ctx, foot);
  };
  legFor(pose.backFoot, -1);
  legFor(pose.frontFoot, 1);

  ctx.save();
  ctx.translate(hipCentre.x, hipCentre.y);
  ctx.rotate(pose.lean);
  const neck = p(0, TODDLER_NECK_Y - TODDLER_HIP_Y);
  const shoulderY = TODDLER_SHOULDER.y - TODDLER_HIP_Y;
  const hipsToLocal = (at: Pt): Pt => {
    const dx = at.x - hipCentre.x;
    const dy = at.y - hipCentre.y;
    const cos = Math.cos(-pose.lean);
    const sin = Math.sin(-pose.lean);
    return p(dx * cos - dy * sin, dx * sin + dy * cos);
  };
  const backHand = hipsToLocal(pose.backHand);
  const frontHand = hipsToLocal(pose.frontHand);

  const armFor = (handAt: Pt, side: number): void => {
    const shoulder = p(side * TODDLER_SHOULDER.x, shoulderY);
    const elbow = p(
      lerp(shoulder.x, handAt.x, 0.5) + side * 0.02,
      lerp(shoulder.y, handAt.y, 0.5) + 0.01,
    );
    tube(ctx, [shoulder, elbow, handAt], ROMPER, TODDLER_ARM_WIDTH);
    ellipsePath(ctx, handAt.x, handAt.y, TODDLER_HAND_RADIUS, TODDLER_HAND_RADIUS);
    fillOutlined(ctx, BABY_SKIN, DETAIL_WIDTH);
  };
  armFor(backHand, -1);

  const romperTrace = (): void => {
    smoothClosed(ctx, [
      p(-0.045, neck.y + 0.005),
      p(0.045, neck.y + 0.005),
      p(0.09, shoulderY + 0.01),
      p(0.11, -0.055),
      p(0.085, 0.02),
      p(0.03, 0.035),
      p(-0.03, 0.035),
      p(-0.085, 0.02),
      p(-0.11, -0.055),
      p(-0.09, shoulderY + 0.01),
    ]);
  };
  romperTrace();
  fillOutlined(ctx, ROMPER);
  withClip(ctx, romperTrace, () => {
    fillSoftEllipse(ctx, 0.08, -0.04, 0.06, 0.09, ROMPER_SHADE, 0.7);
    fillSoftEllipse(ctx, -0.045, -0.09, 0.05, 0.04, ROMPER_LIGHT, 0.8);
    // A bib front with two buttons.
    ctx.beginPath();
    ctx.rect(-0.04, shoulderY + 0.03, 0.08, 0.06);
    ctx.strokeStyle = ROMPER_SHADE;
    ctx.lineWidth = FINE_WIDTH;
    ctx.stroke();
    for (const bx of [-0.025, 0.025]) {
      ellipsePath(ctx, bx, shoulderY + 0.04, 0.008, 0.008);
      ctx.fillStyle = CAP_RIM;
      ctx.fill();
    }
  });
  armFor(frontHand, 1);
  toddlerHead(ctx, pose, neck);
  ctx.restore();
}
