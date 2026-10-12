/**
 * Deuce from the chest up, across the felt from the player: the drawing the
 * blackjack panel shows. Painted in portrait units (see `motion.ts`), origin
 * at the felt's far edge under his belly.
 *
 * Draw order is the depth order: neck, shirt and waistcoat, upper arms, then
 * the felt the forearms lie on, the forearms' shadows, the forearms, the
 * hands and what they hold, the head, and finally any arm raised in front of
 * the head.
 *
 * Two levels of detail, chosen by how many device pixels the frame has: the
 * full portrait, and the phone header's bust — framed tight on head and
 * shoulders, with the 12-pixel face's heavier features and no fine lines,
 * which only turn to noise at that size.
 *
 * The torso and the head are the same from frame to frame apart from the
 * breath (a translation) and the expression, so each is painted once into a
 * cached bitmap and blitted; only the arms and what they hold, which move, are
 * painted every frame.
 */

import { mix, type Pt } from '../carlArt';
import { BitmapCache, type CacheBox, quantize } from './bitmapCache';
import { type CardSize, cardCorners, paintCardBack, paintDeck } from './cards';
import { type GripBuild, handPoint, paintGrippingHand } from './grip';
import { type HandPlacement } from './hand';
import { type DeuceExpression, type HeadDetail, paintDeuceHead } from './head';
import { type ArmPose, type DeucePose } from './motion';
import {
  type Ctx,
  type FormShading,
  type Trace,
  devicePixel,
  fillTrace,
  outlineTrace,
  paintForm,
  pt,
  strokeLine,
  traceEllipse,
  tracePolygon,
  traceSmoothLoop,
} from './paint';
import { BOW_TIE, FELT, GOLD, RAIL, SHIRT, SKIN, WAISTCOAT } from './palette';
import { type ArmBuild, type SleeveDetail, armTrace, paintArmSleeve, paintCuff } from './sleeve';

/** Eye line above the felt, and the head's half-height. */
const HEAD_Y = -0.8;
const HEAD_UNIT = 0.205;
const SHOULDER_Y = -0.47;
const SHOULDER_X = 0.355;

const ARM: ArmBuild = {
  shoulderRadius: 0.072,
  blouseRadius: 0.07,
  garterRadius: 0.058,
  elbowRadius: 0.056,
  forearmRadius: 0.058,
  overhangRadius: 0.05,
  wristRadius: 0.04,
  cuffRadius: 0.044,
  cuffLength: 0.045,
  garterThickness: 0.026,
};
const HAND_LENGTH = 0.25;
const CARD: CardSize = { width: 0.11, height: 0.155, deckThickness: 0.026 };

const SHADOW_OFFSET = pt(0.022, 0.03);
const FELT_SHADOW = 'rgba(0, 0, 0, 0.32)';
/** The hand's shadow: an ellipse centred mid-hand, as shares of the hand's length. */
const HAND_SHADOW = { centreX: 0.45, length: 0.42, width: 0.24 } as const;
/** Where the deck sits when he sets it down to shrug. */
const DECK_ON_FELT = pt(0, 0.14);
const DECK_ON_FELT_ANGLE = 0.08;

const OUTLINE_PIXELS = 2;
const PIPING_PIXELS = 1.4;
const ARMHOLE_PIPING_PIXELS = 1.2;
const POCKET_PIXELS = 1.6;
const FOLD_PIXELS = 1.2;
const CHAIN_PIXELS = 1.3;
const CHAIN_SHADOW_PIXELS = 0.8;
const BUTTON_OUTLINE_PIXELS = 1.5;
const ARC_PIXELS = 1.5;

/** The head follows a shrug only partway: the neck sinks into the shoulders. */
const HEAD_SHRUG_FOLLOW = 0.6;
/** Collar and tie ride up a shrug by this share. */
const COLLAR_SHRUG_FOLLOW = 0.4;
/** The waistcoat's shoulder seam rides a shrug by half. */
const SEAM_SHRUG_FOLLOW = 0.5;

// ── Proportion tables, in portrait units ────────────────────────────────────
// A point's `lift` is how much of a shrug it rides: 1 for the shoulder line,
// a share for the neckline, 0 for anything below the chest.

interface ShrugPoint {
  x: number;
  y: number;
  lift: number;
}

function shrugPoints(points: readonly ShrugPoint[], shrug: number, side = 1): Pt[] {
  return points.map((p) => pt(p.x * side, p.y - shrug * p.lift));
}

/** The shirt body: neck, sloping shoulders, armpit, a belly carried low. */
const TORSO_HALF: readonly ShrugPoint[] = [
  { x: 0.13, y: -0.6, lift: COLLAR_SHRUG_FOLLOW },
  { x: 0.27, y: -0.56, lift: 1 },
  { x: 0.39, y: -0.5, lift: 1 },
  { x: 0.31, y: -0.33, lift: 0 },
  { x: 0.37, y: 0.05, lift: 0 },
  { x: 0.37, y: 0.4, lift: 0 },
];
/** One waistcoat front, his-right side; the left is its mirror. */
const WAISTCOAT_PANEL: readonly ShrugPoint[] = [
  { x: 0.14, y: -0.58, lift: SEAM_SHRUG_FOLLOW },
  { x: 0.23, y: -0.55, lift: 1 },
  { x: 0.26, y: -0.44, lift: 0 },
  { x: 0.29, y: -0.32, lift: 0 },
  { x: 0.36, y: -0.15, lift: 0 },
  { x: 0.38, y: 0.4, lift: 0 },
  { x: -0.012, y: 0.4, lift: 0 },
  { x: -0.012, y: -0.26, lift: 0 },
];
/** The front edge's piping: the V's side and on down the button line. */
const FRONT_PIPING: readonly ShrugPoint[] = [
  { x: 0.14, y: -0.58, lift: SEAM_SHRUG_FOLLOW },
  { x: 0.012, y: -0.26, lift: 0 },
  { x: 0.012, y: 0.02, lift: 0 },
];
/** The armhole's piping, from the shoulder seam round under the arm. */
const ARMHOLE_PIPING: readonly ShrugPoint[] = WAISTCOAT_PANEL.slice(1, 5);
const WELT_POCKET: readonly Pt[] = [pt(0.15, -0.135), pt(0.27, -0.15)];
const BUTTON_Y: readonly number[] = [-0.21, -0.12, -0.03];
const BUTTON_RADIUS = 0.016;
/** The belly pulls each button: a stress fold radiating out to either side. */
const STRESS_FOLD: readonly Pt[] = [pt(0.03, 0), pt(0.08, -0.018), pt(0.13, -0.012)];
const WATCH_CHAIN: readonly Pt[] = [pt(0.01, -0.12), pt(0.12, -0.075), pt(0.22, -0.14)];
/** The chain's shaded underside, a hair below it. */
const WATCH_CHAIN_DROP = 0.005;

const NECK: readonly Pt[] = [pt(-0.11, -0.72), pt(0.11, -0.72), pt(0.15, -0.55), pt(-0.15, -0.55)];
const COLLAR_POINT: readonly Pt[] = [
  pt(0.02, -0.6),
  pt(0.13, -0.64),
  pt(0.15, -0.53),
  pt(0.06, -0.5),
];
const TIE_Y = -0.565;
/** One bow-tie wing, relative to the knot's height. */
const TIE_WING: readonly Pt[] = [pt(0.02, -0.02), pt(0.1, -0.045), pt(0.115, 0.04), pt(0.02, 0.02)];
const TIE_KNOT = { rx: 0.028, ry: 0.03 } as const;

const NECK_SHADING: FormShading = { shadow: 0.05 };
const TORSO_SHADING: FormShading = { shadow: 0.06, highlight: 0.02 };
/** The waistcoat's far side (screen right) turns further from the key. */
const PANEL_SHADING_NEAR: FormShading = { shadow: 0.035, highlight: 0.015 };
const PANEL_SHADING_FAR: FormShading = { shadow: 0.08, highlight: 0.015 };
const BUTTON_SHADING: FormShading = { shadow: 0.006, highlight: 0.004 };
const COLLAR_SHADING: FormShading = { shadow: 0.015 };
const TIE_SHADING: FormShading = { shadow: 0.015, highlight: 0.008 };
const KNOT_SHADING: FormShading = { shadow: 0.01 };

/** The printed arc every blackjack layout carries. */
const LAYOUT_ARC = { centreY: -0.25, radiusX: 0.75, radiusY: 0.55, inset: 0.35 } as const;
const LAYOUT_ARC_TINT = 0.55;
/** The padded rail on the dealer's side of the felt, under his belly. */
const RAIL_TOP = -0.025;
const RAIL_DEPTH = 0.045;
const RAIL_UNDERSIDE_TOP = 0.008;
const RAIL_UNDERSIDE_DEPTH = 0.012;
const RAIL_TRIM_PIXELS = 1.5;

// ── Framing and level of detail ─────────────────────────────────────────────

/** The figure is sized off the shorter axis so a tall column and a square bust frame him alike. */
const PORTRAIT_ASPECT = 0.72;
/** Where the felt's far edge crosses the frame, as a share of its height. */
const FELT_LINE_OF_HEIGHT = 0.8;
/**
 * Below this many device pixels to a portrait unit the frame is a phone
 * header's bust: framed tight, drawn plainer.
 */
const BUST_LOD_UNIT_PIXELS = 170;
/** The bust's window in portrait units: crown to just under the hands' roots. */
const BUST_WINDOW = { top: -1.08, bottom: -0.08, halfWidth: 0.46 } as const;
/**
 * In the bust the head is drawn a size larger, the way a caricature at stamp
 * size exaggerates the face: it is the part that has to read.
 */
const BUST_HEAD_SCALE = 1.15;
/** Below this many device pixels of head height, the face takes its heavy, plain features. */
const PLAIN_FACE_HEAD_PIXELS = 30;

/** The cached torso layer's extent, in portrait units, with room for a shrug. */
const TORSO_BOX: CacheBox = { x: -0.5, y: -0.8, w: 1, h: 1.25 };
/** The cached head's extent, in head units: brim to double chin, ear to ear. */
const HEAD_BOX: CacheBox = { x: -1.25, y: -1.35, w: 2.5, h: 2.6 };
const TORSO_CACHE_ENTRIES = 6;
const HEAD_CACHE_ENTRIES = 48;
/** Expression values are cached at these steps; finer changes are not visible. */
const LOOK_STEP = 0.1;
const FACE_STEP = 0.05;

const torsoCache = new BitmapCache(TORSO_CACHE_ENTRIES);
const headCache = new BitmapCache(HEAD_CACHE_ENTRIES);

type PortraitDetail = 'full' | 'bust';

// ── Torso ───────────────────────────────────────────────────────────────────

function shoulderPoint(side: number, shrug: number, breath: number): Pt {
  return pt(side * SHOULDER_X, SHOULDER_Y - shrug + breath);
}

function torsoTrace(shrug: number): Trace {
  const right = shrugPoints(TORSO_HALF, shrug, -1);
  const left = shrugPoints(TORSO_HALF, shrug, 1).reverse();
  return (ctx) => traceSmoothLoop(ctx, [...right, ...left]);
}

function paintNeck(ctx: Ctx): void {
  const neck: Trace = (c) => tracePolygon(c, NECK);
  outlineTrace(ctx, neck, OUTLINE_PIXELS);
  paintForm(ctx, neck, { ...SKIN, base: SKIN.shade, shade: SKIN.deep }, NECK_SHADING);
}

function paintWaistcoatDetail(ctx: Ctx, shrug: number, detail: PortraitDetail): void {
  for (const side of [-1, 1]) {
    strokeLine(ctx, shrugPoints(FRONT_PIPING, shrug, side), GOLD.base, PIPING_PIXELS);
    strokeLine(
      ctx,
      shrugPoints(ARMHOLE_PIPING, shrug, side),
      GOLD.shade,
      ARMHOLE_PIPING_PIXELS,
      true,
    );
    if (detail === 'full') {
      strokeLine(
        ctx,
        WELT_POCKET.map((p) => pt(p.x * side, p.y)),
        GOLD.shade,
        POCKET_PIXELS,
      );
    }
  }
  for (const y of BUTTON_Y) {
    if (detail === 'full') {
      for (const side of [-1, 1]) {
        const fold = STRESS_FOLD.map((p) => pt(p.x * side, y + p.y));
        strokeLine(ctx, fold, WAISTCOAT.deep, FOLD_PIXELS, true);
      }
    }
    const button: Trace = (c) => traceEllipse(c, 0, y, BUTTON_RADIUS, BUTTON_RADIUS);
    outlineTrace(ctx, button, BUTTON_OUTLINE_PIXELS);
    paintForm(ctx, button, GOLD, BUTTON_SHADING);
  }
  if (detail === 'bust') return;
  strokeLine(ctx, WATCH_CHAIN, GOLD.light ?? GOLD.base, CHAIN_PIXELS, true);
  strokeLine(
    ctx,
    WATCH_CHAIN.map((p) => pt(p.x, p.y + WATCH_CHAIN_DROP)),
    GOLD.shade,
    CHAIN_SHADOW_PIXELS,
    true,
  );
}

function paintCollarAndTie(ctx: Ctx, shrug: number): void {
  const lift = shrug * COLLAR_SHRUG_FOLLOW;
  for (const side of [-1, 1]) {
    const point: Trace = (c) =>
      tracePolygon(
        c,
        COLLAR_POINT.map((p) => pt(p.x * side, p.y - lift)),
      );
    outlineTrace(ctx, point, OUTLINE_PIXELS);
    paintForm(ctx, point, SHIRT, COLLAR_SHADING);
  }
  const tieY = TIE_Y - lift;
  for (const side of [-1, 1]) {
    const wing: Trace = (c) =>
      traceSmoothLoop(
        c,
        TIE_WING.map((p) => pt(p.x * side, tieY + p.y)),
      );
    outlineTrace(ctx, wing, OUTLINE_PIXELS);
    paintForm(ctx, wing, BOW_TIE, TIE_SHADING);
  }
  const knot: Trace = (c) => traceEllipse(c, 0, tieY, TIE_KNOT.rx, TIE_KNOT.ry);
  outlineTrace(ctx, knot, OUTLINE_PIXELS);
  paintForm(ctx, knot, BOW_TIE, KNOT_SHADING);
}

function paintTorso(ctx: Ctx, shrug: number, detail: PortraitDetail): void {
  paintNeck(ctx);
  const torso = torsoTrace(shrug);
  outlineTrace(ctx, torso, OUTLINE_PIXELS);
  paintForm(ctx, torso, SHIRT, TORSO_SHADING);
  for (const side of [-1, 1]) {
    const panel: Trace = (c) => tracePolygon(c, shrugPoints(WAISTCOAT_PANEL, shrug, side));
    outlineTrace(ctx, panel, OUTLINE_PIXELS);
    paintForm(ctx, panel, WAISTCOAT, side < 0 ? PANEL_SHADING_NEAR : PANEL_SHADING_FAR);
  }
  paintWaistcoatDetail(ctx, shrug, detail);
  paintCollarAndTie(ctx, shrug);
}

// ── Arms ────────────────────────────────────────────────────────────────────

function handPlacement(arm: ArmPose): HandPlacement {
  return { wrist: arm.wrist, angle: arm.handAngle, length: HAND_LENGTH, thumbSide: arm.thumbSide };
}

/**
 * The arm's shadow on the table: the rail and the felt, never the waistcoat
 * above them, which faces the light and stands well back from the arm.
 */
function paintArmShadow(
  ctx: Ctx,
  shoulder: Pt,
  arm: ArmPose,
  halfWidth: number,
  below: number,
): void {
  if (arm.overHead) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(-halfWidth, RAIL_TOP, halfWidth * 2, below - RAIL_TOP);
  ctx.clip();
  ctx.translate(SHADOW_OFFSET.x, SHADOW_OFFSET.y);
  fillTrace(ctx, armTrace(ARM, shoulder, arm.elbow, arm.wrist), FELT_SHADOW);
  const centre = handPoint(handPlacement(arm), pt(HAND_SHADOW.centreX, 0));
  fillTrace(
    ctx,
    (c) =>
      traceEllipse(
        c,
        centre.x,
        centre.y,
        HAND_LENGTH * HAND_SHADOW.length,
        HAND_LENGTH * HAND_SHADOW.width,
        arm.handAngle,
      ),
    FELT_SHADOW,
  );
  ctx.restore();
}

/** One whole arm, shoulder to fingertips, with whatever the hand holds. */
function paintArm(
  ctx: Ctx,
  shoulder: Pt,
  arm: ArmPose,
  flip: number,
  sleeveDetail: SleeveDetail,
  grip: GripBuild,
): void {
  paintArmSleeve(ctx, ARM, shoulder, arm.elbow, arm.wrist, sleeveDetail);
  paintGrippingHand(ctx, grip, handPlacement(arm), arm.hand, arm.grip, flip);
  paintCuff(ctx, ARM, arm.elbow, arm.wrist, sleeveDetail);
}

// ── Felt ────────────────────────────────────────────────────────────────────

function paintFelt(ctx: Ctx, halfWidth: number, bottom: number): void {
  const px = devicePixel(ctx);
  ctx.fillStyle = FELT.base;
  ctx.fillRect(-halfWidth, 0, halfWidth * 2, bottom);
  ctx.strokeStyle = mix(FELT.base, GOLD.shade, LAYOUT_ARC_TINT);
  ctx.lineWidth = px * ARC_PIXELS;
  ctx.beginPath();
  ctx.ellipse(
    0,
    LAYOUT_ARC.centreY,
    LAYOUT_ARC.radiusX,
    LAYOUT_ARC.radiusY,
    0,
    LAYOUT_ARC.inset,
    Math.PI - LAYOUT_ARC.inset,
  );
  ctx.stroke();
  fillTrace(ctx, (c) => c.rect(-halfWidth, RAIL_TOP, halfWidth * 2, RAIL_DEPTH), RAIL.base);
  fillTrace(
    ctx,
    (c) => c.rect(-halfWidth, RAIL_UNDERSIDE_TOP, halfWidth * 2, RAIL_UNDERSIDE_DEPTH),
    RAIL.shade,
  );
  fillTrace(
    ctx,
    (c) => c.rect(-halfWidth, RAIL_TOP, halfWidth * 2, px * RAIL_TRIM_PIXELS),
    GOLD.base,
  );
}

// ── Head ────────────────────────────────────────────────────────────────────

function expressionKey(expression: DeuceExpression, detail: HeadDetail): string {
  const look = (value: number): number => quantize(value, LOOK_STEP);
  const face = (value: number): number => quantize(value, FACE_STEP);
  return [
    detail,
    face(expression.lidOpen),
    face(expression.browRaise),
    face(expression.browSkew),
    face(expression.mouthCurve),
    face(expression.mouthOpen),
    face(expression.smirk),
    look(expression.lookX),
    look(expression.lookY),
  ].join(',');
}

function paintHead(ctx: Ctx, pose: DeucePose, detail: HeadDetail, scale: number): void {
  ctx.save();
  const shrugLift = pose.shrug * HEAD_SHRUG_FOLLOW;
  ctx.translate(pose.headShift.x, HEAD_Y + pose.breath + pose.headShift.y - shrugLift);
  ctx.rotate(pose.headTilt);
  ctx.scale(HEAD_UNIT * scale, HEAD_UNIT * scale);
  headCache.draw(ctx, expressionKey(pose.expression, detail), HEAD_BOX, (target) =>
    paintDeuceHead(target, pose.expression, detail),
  );
  ctx.restore();
}

// ── Composition ─────────────────────────────────────────────────────────────

interface Framing {
  unit: number;
  originX: number;
  originY: number;
  detail: PortraitDetail;
}

function framingFor(ctx: Ctx, x: number, y: number, w: number, h: number): Framing {
  const unit = Math.min(w, h * PORTRAIT_ASPECT);
  const unitPixels = unit / devicePixel(ctx);
  if (unitPixels >= BUST_LOD_UNIT_PIXELS) {
    return { unit, originX: x + w / 2, originY: y + h * FELT_LINE_OF_HEIGHT, detail: 'full' };
  }
  const windowHeight = BUST_WINDOW.bottom - BUST_WINDOW.top;
  const bustUnit = Math.min(h / windowHeight, w / (BUST_WINDOW.halfWidth * 2));
  const spareHeight = h - windowHeight * bustUnit;
  return {
    unit: bustUnit,
    originX: x + w / 2,
    originY: y + spareHeight / 2 - BUST_WINDOW.top * bustUnit,
    detail: 'bust',
  };
}

/**
 * Paints the portrait for `pose` into the frame (x, y, w, h), clipped to it.
 * Everything scales off the frame, so the wide panel's tall portrait and the
 * phone header's little bust are the same drawing at two sizes.
 */
export function paintDeucePortrait(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  pose: DeucePose,
): void {
  const framing = framingFor(ctx, x, y, w, h);
  const unit = framing.unit;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.translate(framing.originX, framing.originY);
  ctx.scale(unit, unit);
  const halfWidth = w / unit / 2;
  const below = (y + h - framing.originY) / unit;
  const detail = framing.detail;
  const sleeveDetail: SleeveDetail = detail === 'full' ? 'full' : 'simple';
  const grip: GripBuild = {
    handLength: HAND_LENGTH,
    card: CARD,
    detail: detail === 'full' ? 'full' : 'simple',
  };
  const headPixels = HEAD_UNIT / devicePixel(ctx);
  const headDetail: HeadDetail =
    detail === 'full' && headPixels >= PLAIN_FACE_HEAD_PIXELS ? 'portrait' : 'world';

  // The shoulders ride the breath; elbows and hands stay planted on the
  // table, so each arm stretches between the two as one limb.
  const rightShoulder = shoulderPoint(-1, pose.shrug, pose.breath);
  const leftShoulder = shoulderPoint(1, pose.shrug, pose.breath);
  const flip = pose.card?.flip ?? 0;

  ctx.save();
  ctx.translate(0, pose.breath);
  torsoCache.draw(ctx, `${detail},${pose.shrug}`, TORSO_BOX, (target) =>
    paintTorso(target, pose.shrug, detail),
  );
  ctx.restore();

  // The table goes down before any arm: the arms rest on it and cross its
  // rail, casting their shadows onto it.
  paintFelt(ctx, halfWidth, below);
  if (pose.deckOnFelt) paintDeck(ctx, CARD, DECK_ON_FELT, DECK_ON_FELT_ANGLE);
  paintArmShadow(ctx, rightShoulder, pose.rightArm, halfWidth, below);
  paintArmShadow(ctx, leftShoulder, pose.leftArm, halfWidth, below);
  if (!pose.leftArm.overHead) paintArm(ctx, leftShoulder, pose.leftArm, flip, sleeveDetail, grip);
  if (!pose.rightArm.overHead) {
    paintArm(ctx, rightShoulder, pose.rightArm, flip, sleeveDetail, grip);
  }
  const freeCard = pose.card?.free;
  if (freeCard !== null && freeCard !== undefined) {
    ctx.save();
    ctx.globalAlpha *= freeCard.alpha;
    paintCardBack(ctx, cardCorners(freeCard.centre, freeCard.angle, CARD.width, CARD.height));
    ctx.restore();
  }

  paintHead(ctx, pose, headDetail, detail === 'bust' ? BUST_HEAD_SCALE : 1);

  if (pose.rightArm.overHead) paintArm(ctx, rightShoulder, pose.rightArm, flip, sleeveDetail, grip);
  ctx.restore();
}
