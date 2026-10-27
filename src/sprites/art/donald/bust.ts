/**
 * Donald from the chest up behind his counter: the drawing the wheel screen
 * shows. Bust units: origin at the top centre of the square, one unit = its
 * side, +y down.
 *
 * Draw order is depth order: the body (neck, shirt, waistcoat, head), then the
 * counter's near edge across the bottom, then the arms, which lie on the
 * counter or reach over it toward the viewer.
 *
 * The body is painted once per pose step into a cached bitmap and blitted with
 * the breath as a translation; the counter is one cached bitmap. Only the arms,
 * a handful of shapes, are painted each frame.
 */

import { type Pt } from '../bipedArt';
import { BitmapCache, type CacheBox } from '../deuce/bitmapCache';
import {
  type Ctx,
  type FormShading,
  type Trace,
  fillTrace,
  outlineTrace,
  paintForm,
  pt,
  strokeLine,
  traceCapsule,
  traceEllipse,
  tracePolygon,
  traceSmoothLoop,
} from '../deuce/paint';
import { paintDonaldHead } from './head';
import { type ArmBuild, paintHand, paintSleeve } from './limbs';
import {
  type BustArm,
  type BustPose,
  type DonaldBustPose,
  LEAN_PIVOT,
  STEPS_PER_POSE,
  breathAt,
  bustPoseAt,
  idleBeatAt,
  poseStep,
} from './motion';
import {
  BOW_TIE,
  BRASS,
  COUNTER_FRONT,
  COUNTER_TOP,
  GOLD,
  LAPEL,
  SHIRT,
  SKIN,
  WAISTCOAT,
} from './palette';

const HEAD_Y = 0.35;
const HEAD_UNIT = 0.17;
const NECK_TOP = 0.5;
const NECK_BOTTOM = 0.62;
const NECK_RADIUS = 0.058;
const NECK_BASE_FLARE = 1.1;
const SHOULDER = pt(0.38, 0.71);

const ARM: ArmBuild = {
  shoulderRadius: 0.064,
  elbowRadius: 0.052,
  wristRadius: 0.038,
  cuffLength: 0.04,
  handLength: 0.14,
  handWidth: 0.07,
  outlinePixels: 2,
  fine: true,
};

/** The counter's near edge: the lit top surface, then the lacquered front. */
const COUNTER = {
  top: 0.9,
  surfaceDepth: 0.045,
  railY: 0.965,
  railHeight: 0.012,
  lipPixels: 2,
} as const;

/** Half the shirt's silhouette, neck to below the counter; mirrored for the other side. */
const SHIRT_HALF: readonly Pt[] = [
  pt(0.06, 0.585),
  pt(0.2, 0.62),
  pt(0.36, 0.655),
  pt(0.45, 0.73),
  pt(0.47, 0.86),
  pt(0.48, 1.05),
];
const WAISTCOAT_PANEL: readonly Pt[] = [
  pt(0.065, 0.6),
  pt(0.2, 0.635),
  pt(0.29, 0.66),
  pt(0.31, 0.74),
  pt(0.35, 0.82),
  pt(0.38, 1.05),
  pt(-0.004, 1.05),
  pt(-0.004, 0.8),
];
const LAPEL_STRIP: readonly Pt[] = [
  pt(0.065, 0.6),
  pt(0.135, 0.625),
  pt(0.085, 0.78),
  pt(-0.004, 0.83),
  pt(-0.004, 0.8),
];
const COLLAR_WING: readonly Pt[] = [
  pt(0.012, 0.6),
  pt(0.07, 0.565),
  pt(0.085, 0.615),
  pt(0.03, 0.628),
];
const BOW_WING: readonly Pt[] = [pt(0, 0.61), pt(0.065, 0.585), pt(0.07, 0.64), pt(0, 0.618)];
const BOW_KNOT = { y: 0.613, r: 0.017 } as const;
const PLACKET: readonly Pt[] = [pt(0, 0.64), pt(0, 0.8)];
const BUTTON = { y: [0.845, 0.89], r: 0.012 } as const;
const WATCH_CHAIN: readonly Pt[] = [pt(0.008, 0.845), pt(0.1, 0.875), pt(0.2, 0.85)];
const ARMHOLE_FOLD: readonly Pt[] = [pt(0.31, 0.74), pt(0.38, 0.8)];
const CARNATION = { at: pt(0.13, 0.69), r: 0.022, petals: 6, petalShare: 0.6 } as const;
const CARNATION_RED: FormShading = { shadow: 0.008 };
const CARNATION_COLOURS = {
  light: '#ff6a7a',
  base: '#d42a40',
  shade: '#8e1426',
  deep: '#4a0812',
} as const;
const NECK_SHADOW_COLOR = 'rgba(70, 30, 14, 0.45)';
const JAW_SHADOW = { y: 0.54, rx: 0.07, ry: 0.025 } as const;

const OUTLINE_PIXELS = 2;
const PANEL_OUTLINE_PIXELS = 1.5;
const DETAIL_PIXELS = 1.2;
const TORSO_SHADING: FormShading = { shadow: 0.025, highlight: 0.01 };
const PANEL_SHADING_NEAR: FormShading = { shadow: 0.014, highlight: 0.008 };
const PANEL_SHADING_FAR: FormShading = { shadow: 0.035, highlight: 0.008 };
const NECK_SHADING: FormShading = { shadow: 0.02 };

const BOX: CacheBox = { x: -0.5, y: 0, w: 1, h: 1 };
/** Room above the counter's top for its lit lip line. */
const COUNTER_LIP_ROOM = 0.01;
const COUNTER_BOX: CacheBox = {
  x: BOX.x,
  y: COUNTER.top - COUNTER_LIP_ROOM,
  w: BOX.w,
  h: BOX.h - COUNTER.top + COUNTER_LIP_ROOM,
};
/** The idle pose's one step, cached once per blink × glance combination. */
const IDLE_BEAT_VARIANTS = 4;
const POSE_STEPS_TOTAL = Object.values(STEPS_PER_POSE).reduce((sum, steps) => sum + steps, 0);
/** Every step of every pose plus the idle beats, at one size. */
const BODY_CACHE_ENTRIES = POSE_STEPS_TOTAL - STEPS_PER_POSE.idle + IDLE_BEAT_VARIANTS;
const COUNTER_CACHE_ENTRIES = 3;
const bodyCache = new BitmapCache(BODY_CACHE_ENTRIES);
const counterCache = new BitmapCache(COUNTER_CACHE_ENTRIES);

function mirrored(points: readonly Pt[], side: number): Pt[] {
  return points.map((p) => pt(p.x * side, p.y));
}

/** Applies the pose's lean and bob: the space the body and the arms are both drawn in. */
function applyLean(ctx: Ctx, pose: BustPose): void {
  ctx.translate(LEAN_PIVOT.x, LEAN_PIVOT.y);
  ctx.scale(pose.lean.scale, pose.lean.scale);
  ctx.rotate(pose.lean.tilt);
  ctx.translate(-LEAN_PIVOT.x, -LEAN_PIVOT.y + pose.lean.dy + pose.bob);
}

function paintTorso(ctx: Ctx): void {
  const shirt: Trace = (c) =>
    traceSmoothLoop(c, [...mirrored(SHIRT_HALF, -1), ...mirrored(SHIRT_HALF, 1).reverse()]);
  outlineTrace(ctx, shirt, OUTLINE_PIXELS);
  paintForm(ctx, shirt, SHIRT, TORSO_SHADING);
  for (const side of [-1, 1]) {
    strokeLine(ctx, mirrored(ARMHOLE_FOLD, side), SHIRT.shade, DETAIL_PIXELS);
    const panel: Trace = (c) => tracePolygon(c, mirrored(WAISTCOAT_PANEL, side));
    outlineTrace(ctx, panel, PANEL_OUTLINE_PIXELS);
    paintForm(ctx, panel, WAISTCOAT, side < 0 ? PANEL_SHADING_NEAR : PANEL_SHADING_FAR);
    const lapel: Trace = (c) => tracePolygon(c, mirrored(LAPEL_STRIP, side));
    paintForm(ctx, lapel, LAPEL, PANEL_SHADING_NEAR);
  }
  strokeLine(ctx, PLACKET, SHIRT.shade, DETAIL_PIXELS);
  for (const y of BUTTON.y) {
    fillTrace(ctx, (c) => traceEllipse(c, 0, y, BUTTON.r, BUTTON.r), GOLD.base);
  }
  strokeLine(ctx, WATCH_CHAIN, GOLD.light ?? GOLD.base, DETAIL_PIXELS, true);
  for (const side of [-1, 1]) {
    const wing: Trace = (c) => tracePolygon(c, mirrored(COLLAR_WING, side));
    outlineTrace(ctx, wing, PANEL_OUTLINE_PIXELS);
    fillTrace(ctx, wing, SHIRT.light ?? SHIRT.base);
  }
  for (const side of [-1, 1]) {
    const bow: Trace = (c) => tracePolygon(c, mirrored(BOW_WING, side));
    outlineTrace(ctx, bow, PANEL_OUTLINE_PIXELS);
    paintForm(ctx, bow, BOW_TIE, PANEL_SHADING_NEAR);
  }
  fillTrace(ctx, (c) => traceEllipse(c, 0, BOW_KNOT.y, BOW_KNOT.r, BOW_KNOT.r), BOW_TIE.base);
  for (let i = 0; i < CARNATION.petals; i++) {
    const angle = (i / CARNATION.petals) * Math.PI * 2;
    const petalRadius = CARNATION.r * CARNATION.petalShare;
    const petal: Trace = (c) =>
      traceEllipse(
        c,
        CARNATION.at.x + Math.cos(angle) * petalRadius,
        CARNATION.at.y + Math.sin(angle) * petalRadius,
        petalRadius,
        petalRadius,
      );
    paintForm(ctx, petal, CARNATION_COLOURS, CARNATION_RED);
  }
}

function paintNeck(ctx: Ctx): void {
  const neck: Trace = (c) =>
    traceCapsule(
      c,
      pt(0, NECK_TOP),
      pt(0, NECK_BOTTOM),
      NECK_RADIUS,
      NECK_RADIUS * NECK_BASE_FLARE,
    );
  outlineTrace(ctx, neck, OUTLINE_PIXELS);
  paintForm(ctx, neck, SKIN, NECK_SHADING);
  fillTrace(
    ctx,
    (c) => traceEllipse(c, 0, JAW_SHADOW.y, JAW_SHADOW.rx, JAW_SHADOW.ry),
    NECK_SHADOW_COLOR,
  );
}

function paintBody(ctx: Ctx, pose: BustPose): void {
  applyLean(ctx, pose);
  paintNeck(ctx);
  paintTorso(ctx);
  ctx.save();
  ctx.translate(0, NECK_BOTTOM);
  ctx.rotate(pose.headTilt);
  ctx.translate(0, HEAD_Y - NECK_BOTTOM);
  ctx.scale(HEAD_UNIT, HEAD_UNIT);
  paintDonaldHead(ctx, pose.expression, 'portrait');
  ctx.restore();
}

function paintCounter(ctx: Ctx): void {
  const surface: Trace = (c) => c.rect(BOX.x, COUNTER.top, BOX.w, COUNTER.surfaceDepth);
  fillTrace(ctx, surface, COUNTER_TOP.base);
  strokeLine(
    ctx,
    [pt(BOX.x, COUNTER.top), pt(BOX.x + BOX.w, COUNTER.top)],
    COUNTER_TOP.light ?? COUNTER_TOP.base,
    COUNTER.lipPixels,
  );
  const frontTop = COUNTER.top + COUNTER.surfaceDepth;
  fillTrace(
    ctx,
    (c) => c.rect(BOX.x, frontTop, BOX.w, BOX.y + BOX.h - frontTop),
    COUNTER_FRONT.base,
  );
  strokeLine(
    ctx,
    [pt(BOX.x, frontTop), pt(BOX.x + BOX.w, frontTop)],
    COUNTER_TOP.deep,
    COUNTER.lipPixels,
  );
  fillTrace(ctx, (c) => c.rect(BOX.x, COUNTER.railY, BOX.w, COUNTER.railHeight), BRASS.base);
  strokeLine(
    ctx,
    [pt(BOX.x, COUNTER.railY), pt(BOX.x + BOX.w, COUNTER.railY)],
    BRASS.light ?? BRASS.base,
    DETAIL_PIXELS,
  );
}

function paintArm(ctx: Ctx, side: number, arm: BustArm): void {
  paintSleeve(ctx, ARM, pt(SHOULDER.x * side, SHOULDER.y), arm.elbow, arm.wrist);
  paintHand(ctx, ARM, { wrist: arm.wrist, angle: arm.handAngle, thumbSide: side > 0 ? 1 : -1 });
}

function paintArms(ctx: Ctx, pose: BustPose): void {
  ctx.save();
  applyLean(ctx, pose);
  paintArm(ctx, 1, pose.left);
  paintArm(ctx, -1, pose.right);
  ctx.restore();
}

function inBustSpace(ctx: Ctx, x: number, y: number, size: number, paint: () => void): void {
  ctx.save();
  ctx.translate(x + size / 2, y);
  ctx.scale(size, size);
  ctx.beginPath();
  ctx.rect(BOX.x, BOX.y, BOX.w, BOX.h);
  ctx.clip();
  try {
    paint();
  } finally {
    ctx.restore();
  }
}

/** Paints Donald's bust into the square (x, y, size). */
export function paintDonaldBust(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  pose: DonaldBustPose,
  poseProgress: number,
  timeMs: number,
): void {
  const step = poseStep(pose, poseProgress);
  const beat = idleBeatAt(timeMs);
  const bust = bustPoseAt(pose, step, beat);
  const beatKey = pose === 'idle' ? `${beat.blinking},${beat.glancing}` : '';
  inBustSpace(ctx, x, y, size, () => {
    ctx.save();
    ctx.translate(0, pose === 'idle' ? breathAt(timeMs) : 0);
    bodyCache.draw(ctx, `${pose},${step},${beatKey}`, BOX, (target) => paintBody(target, bust));
    ctx.restore();
    counterCache.draw(ctx, 'counter', COUNTER_BOX, paintCounter);
    paintArms(ctx, bust);
  });
}
