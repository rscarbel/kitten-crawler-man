/**
 * Donald standing behind his counter on the club floor. The counter sits one row
 * in front of him and is drawn after him, so it hides everything below the
 * waist; only a hand lifted above its top is ever seen.
 *
 * Coordinates are figure units: the origin is the top centre of the scaled
 * humanoid box, one unit is the box's size, +y down.
 *
 * At rest his arms hang behind the counter. Every few seconds he does one of
 * two gestures — smooths his moustache with a fingertip, or lifts a hand and
 * beckons the room over — and between them his eyes slide to the wheel. The
 * body is cached per gesture step and blink; the breath is a translation.
 */

import { clamp01, hump, lerp, type Pt } from '../bipedArt';
import { BitmapCache, type CacheBox } from '../deuce/bitmapCache';
import {
  type Ctx,
  type FormShading,
  type Trace,
  fillTrace,
  lerpPt,
  outlineTrace,
  paintForm,
  pt,
  strokeLine,
  traceCapsule,
  traceEllipse,
  tracePolygon,
  traceSmoothLoop,
} from '../deuce/paint';
import { RESTING_EXPRESSION, type DonaldExpression, paintDonaldHead } from './head';
import { type ArmBuild, paintHand, paintSleeve } from './limbs';
import { BOW_TIE, GOLD, LAPEL, SHIRT, SKIN, WAISTCOAT } from './palette';

const HEAD_Y = 0.32;
const HEAD_UNIT = 0.118;
const NECK_TOP = 0.42;
const NECK_BOTTOM = 0.5;
const NECK_RADIUS = 0.042;
const SHOULDER_X = 0.21;
const SHOULDER_Y = 0.54;

const ARM: ArmBuild = {
  shoulderRadius: 0.05,
  elbowRadius: 0.042,
  wristRadius: 0.032,
  cuffLength: 0.03,
  handLength: 0.1,
  handWidth: 0.06,
  outlinePixels: 1.5,
  fine: false,
};

/** Half the shirt body, neck to below the counter; mirrored for the other side. */
const TORSO_HALF: readonly Pt[] = [
  pt(0.05, 0.48),
  pt(0.16, 0.5),
  pt(0.24, 0.55),
  pt(0.22, 0.64),
  pt(0.23, 0.8),
  pt(0.23, 0.98),
];
const WAISTCOAT_PANEL: readonly Pt[] = [
  pt(0.055, 0.5),
  pt(0.15, 0.51),
  pt(0.17, 0.59),
  pt(0.21, 0.68),
  pt(0.23, 0.98),
  pt(-0.006, 0.98),
  pt(-0.006, 0.67),
];
const LAPEL_STRIP: readonly Pt[] = [
  pt(0.055, 0.5),
  pt(0.1, 0.52),
  pt(0.05, 0.64),
  pt(-0.006, 0.68),
];
const BOW_WING: readonly Pt[] = [pt(0, 0.505), pt(0.045, 0.488), pt(0.05, 0.525), pt(0, 0.512)];
const BUTTON = { y: [0.72, 0.78], r: 0.011 } as const;
const WATCH_CHAIN: readonly Pt[] = [pt(0.005, 0.72), pt(0.07, 0.745), pt(0.13, 0.715)];
const CARNATION = { at: pt(0.085, 0.565), r: 0.018 } as const;
const CARNATION_RED = '#d42a40';

const OUTLINE_PIXELS = 1.5;
const DETAIL_PIXELS = 1;
const TORSO_SHADING: FormShading = { shadow: 0.02, highlight: 0.008 };
const PANEL_SHADING_NEAR: FormShading = { shadow: 0.012, highlight: 0.006 };
const PANEL_SHADING_FAR: FormShading = { shadow: 0.03, highlight: 0.006 };
const NECK_SHADING: FormShading = { shadow: 0.015 };

/** Below the counter's top his arms are hidden, so a resting arm is drawn only to here. */
const RESTING_ELBOW = pt(0.25, 0.76);
const RESTING_WRIST = pt(0.24, 0.94);

/** The moustache smooth: his right hand (screen left) up to the lip. */
const SMOOTH_ELBOW = pt(-0.27, 0.6);
const SMOOTH_WRIST = pt(-0.13, 0.4);
const SMOOTH_HAND_ANGLE = -0.1;
/** The fingertip runs along the moustache and back. */
const SMOOTH_STROKE_X = 0.05;
/** The beckon: his left hand (screen right) up beside the shoulder, palm toward the room. */
const BECKON_ELBOW = pt(0.3, 0.62);
const BECKON_WRIST = pt(0.27, 0.46);
const BECKON_ANGLE = -1.75;
const BECKON_CURL = 0.55;
const BECKON_CURLS = 3;

const GESTURE_CYCLE_MS = 6400;
const GESTURE_MS = 1800;
const GESTURE_STEPS = 18;
/** The hand is up for the middle of the gesture, not only its peak. */
const GESTURE_HOLD_GAIN = 2;
const BLINK_CYCLE_MS = 4300;
const BLINK_MS = 150;
const GLANCE_CYCLE_MS = 9100;
const GLANCE_MS = 1300;
const GLANCE_LOOK_X = -0.8;
const BREATH_PERIOD_MS = 4800;
const BREATH_AMOUNT = 0.004;
/** On the club floor his resting smile is pushed wider, or the mouth is a dot at twelve pixels. */
const WORLD_GRIN = 0.7;
const BODY_BOX: CacheBox = { x: -0.4, y: 0.12, w: 0.8, h: 0.9 };
const BODY_CACHE_ENTRIES = GESTURE_STEPS * 2 + 8;
const bodyCache = new BitmapCache(BODY_CACHE_ENTRIES);

type Gesture = 'none' | 'smooth' | 'beckon';

interface WorldBeat {
  gesture: Gesture;
  step: number;
  blinking: boolean;
  glancing: boolean;
}

function beatAt(timeMs: number): WorldBeat {
  const cycle = Math.floor(timeMs / GESTURE_CYCLE_MS);
  const into = timeMs % GESTURE_CYCLE_MS;
  const gesturing = into < GESTURE_MS;
  const gesture: Gesture = !gesturing ? 'none' : cycle % 2 === 0 ? 'smooth' : 'beckon';
  return {
    gesture,
    step: gesturing
      ? Math.min(GESTURE_STEPS - 1, Math.floor((into / GESTURE_MS) * GESTURE_STEPS))
      : 0,
    blinking: timeMs % BLINK_CYCLE_MS < BLINK_MS,
    glancing: !gesturing && timeMs % GLANCE_CYCLE_MS > GLANCE_CYCLE_MS - GLANCE_MS,
  };
}

function breathAt(timeMs: number): number {
  return Math.sin(((timeMs % BREATH_PERIOD_MS) / BREATH_PERIOD_MS) * Math.PI * 2) * BREATH_AMOUNT;
}

function mirrored(points: readonly Pt[], side: number): Pt[] {
  return points.map((p) => pt(p.x * side, p.y));
}

function expressionFor(beat: WorldBeat): DonaldExpression {
  const lift = beat.gesture === 'none' ? 0 : hump(beat.step / (GESTURE_STEPS - 1));
  return {
    ...RESTING_EXPRESSION,
    grin: lerp(WORLD_GRIN, 1, lift),
    lidOpen: beat.blinking ? 0 : RESTING_EXPRESSION.lidOpen,
    browSkew: lerp(RESTING_EXPRESSION.browSkew, 1, lift),
    lookX: beat.glancing ? GLANCE_LOOK_X : 0,
  };
}

function paintTorso(ctx: Ctx): void {
  const neck: Trace = (c) =>
    traceCapsule(c, pt(0, NECK_TOP), pt(0, NECK_BOTTOM), NECK_RADIUS, NECK_RADIUS);
  outlineTrace(ctx, neck, OUTLINE_PIXELS);
  paintForm(ctx, neck, SKIN, NECK_SHADING);
  const torso: Trace = (c) =>
    traceSmoothLoop(c, [...mirrored(TORSO_HALF, -1), ...mirrored(TORSO_HALF, 1).reverse()]);
  outlineTrace(ctx, torso, OUTLINE_PIXELS);
  paintForm(ctx, torso, SHIRT, TORSO_SHADING);
  for (const side of [-1, 1]) {
    const panel: Trace = (c) => tracePolygon(c, mirrored(WAISTCOAT_PANEL, side));
    outlineTrace(ctx, panel, OUTLINE_PIXELS);
    paintForm(ctx, panel, WAISTCOAT, side < 0 ? PANEL_SHADING_NEAR : PANEL_SHADING_FAR);
    fillTrace(ctx, (c) => tracePolygon(c, mirrored(LAPEL_STRIP, side)), LAPEL.base);
  }
  for (const y of BUTTON.y) {
    fillTrace(ctx, (c) => traceEllipse(c, 0, y, BUTTON.r, BUTTON.r), GOLD.base);
  }
  strokeLine(ctx, WATCH_CHAIN, GOLD.light ?? GOLD.base, DETAIL_PIXELS, true);
  for (const side of [-1, 1]) {
    const wing: Trace = (c) => tracePolygon(c, mirrored(BOW_WING, side));
    outlineTrace(ctx, wing, DETAIL_PIXELS);
    fillTrace(ctx, wing, BOW_TIE.base);
  }
  fillTrace(
    ctx,
    (c) => traceEllipse(c, CARNATION.at.x, CARNATION.at.y, CARNATION.r, CARNATION.r),
    CARNATION_RED,
  );
}

function paintRestingArm(ctx: Ctx, side: number): void {
  paintSleeve(
    ctx,
    ARM,
    pt(SHOULDER_X * side, SHOULDER_Y),
    pt(RESTING_ELBOW.x * side, RESTING_ELBOW.y),
    pt(RESTING_WRIST.x * side, RESTING_WRIST.y),
  );
}

function paintGestureArm(ctx: Ctx, beat: WorldBeat): void {
  const t = beat.step / (GESTURE_STEPS - 1);
  const raise = clamp01(hump(t) * GESTURE_HOLD_GAIN);
  if (beat.gesture === 'smooth') {
    const stroke = Math.sin(t * Math.PI * 2) * SMOOTH_STROKE_X * raise;
    const wrist = lerpPt(
      pt(-RESTING_WRIST.x, RESTING_WRIST.y),
      pt(SMOOTH_WRIST.x + stroke, SMOOTH_WRIST.y),
      raise,
    );
    const elbow = lerpPt(pt(-RESTING_ELBOW.x, RESTING_ELBOW.y), SMOOTH_ELBOW, raise);
    paintSleeve(ctx, ARM, pt(-SHOULDER_X, SHOULDER_Y), elbow, wrist);
    paintHand(ctx, ARM, {
      wrist,
      angle: lerp(-Math.PI / 2, SMOOTH_HAND_ANGLE, raise),
      thumbSide: -1,
    });
    return;
  }
  const curl = Math.abs(Math.sin(t * BECKON_CURLS * Math.PI)) * BECKON_CURL * raise;
  const wrist = lerpPt(RESTING_WRIST, BECKON_WRIST, raise);
  const elbow = lerpPt(RESTING_ELBOW, BECKON_ELBOW, raise);
  paintSleeve(ctx, ARM, pt(SHOULDER_X, SHOULDER_Y), elbow, wrist);
  paintHand(ctx, ARM, {
    wrist,
    angle: lerp(-Math.PI / 2, BECKON_ANGLE, raise) - curl,
    thumbSide: 1,
  });
}

function paintBody(ctx: Ctx, beat: WorldBeat): void {
  if (beat.gesture !== 'smooth') paintRestingArm(ctx, -1);
  if (beat.gesture !== 'beckon') paintRestingArm(ctx, 1);
  paintTorso(ctx);
  ctx.save();
  ctx.translate(0, HEAD_Y);
  ctx.scale(HEAD_UNIT, HEAD_UNIT);
  paintDonaldHead(ctx, expressionFor(beat), 'world');
  ctx.restore();
  if (beat.gesture !== 'none') paintGestureArm(ctx, beat);
}

/** Donald's body and head behind the counter, at the scaled humanoid box (sx, sy, size). */
export function paintDonaldWorld(
  ctx: Ctx,
  sx: number,
  sy: number,
  size: number,
  timeMs: number,
): void {
  const beat = beatAt(timeMs);
  const key = `${beat.gesture},${beat.step},${beat.blinking},${beat.glancing}`;
  ctx.save();
  ctx.translate(sx + size / 2, sy + breathAt(timeMs) * size);
  ctx.scale(size, size);
  try {
    bodyCache.draw(ctx, key, BODY_BOX, (target) => paintBody(target, beat));
  } finally {
    ctx.restore();
  }
}
