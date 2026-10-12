/**
 * Deuce standing at his table on the club floor, painted in two passes.
 *
 * The table sits one row in front of him and is drawn after him, so it hides
 * everything below his belt. His forearms and hands, though, lie *on* the
 * felt: they are a second pass the club draws after the table. Painting them
 * with the body put them under the table's rim, where a dealer's hands never
 * are.
 *
 * Coordinates are figure units: the origin is the top centre of the scaled
 * humanoid box, one unit is the box's size, +y down.
 *
 * At this size a hand is a handful of pixels, so it is drawn plain: a skin
 * silhouette against the white cuff with a thin dark rim, a thumb standing
 * off it and one lit knuckle line. Both passes are cached as bitmaps — the
 * body per gaze and blink, the hands per step of the deal — since they repeat
 * exactly.
 */

import { lerp, type Pt } from '../carlArt';
import { BitmapCache, type CacheBox, quantize } from './bitmapCache';
import { type CardSize, cardCorners, paintCardBack } from './cards';
import { type Grip, type GripBuild, paintGrippingHand } from './grip';
import { type HandPose, RESTING_HAND } from './hand';
import { type DeuceExpression, paintDeuceHead } from './head';
import { DEAL_PERIOD_MS, dealBeatAt, DECK_HAND, OPEN_PALM_BACK, PINCH_HAND } from './motion';
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
  traceEllipse,
  tracePolygon,
  traceSmoothLoop,
} from './paint';
import { BOW_TIE, GOLD, SHIRT, WAISTCOAT } from './palette';
import { type ArmBuild, armTrace, paintArmSleeve, paintCuff } from './sleeve';

const HEAD_Y = 0.32;
const HEAD_UNIT = 0.118;
const SHOULDER_Y = 0.53;
const SHOULDER_X = 0.215;

const ARM: ArmBuild = {
  shoulderRadius: 0.046,
  blouseRadius: 0.045,
  garterRadius: 0.038,
  elbowRadius: 0.036,
  forearmRadius: 0.037,
  overhangRadius: 0.032,
  wristRadius: 0.026,
  cuffRadius: 0.029,
  cuffLength: 0.03,
  garterThickness: 0.018,
};
/** Long enough that a hand reads as a hand at the 32 px tile, not a dot at the cuff. */
const HAND_LENGTH = 0.15;
const CARD: CardSize = { width: 0.075, height: 0.105, deckThickness: 0.02 };
const GRIP: GripBuild = { handLength: HAND_LENGTH, card: CARD, detail: 'simple' };

const RIGHT_ELBOW = pt(-0.29, 0.78);
const LEFT_ELBOW = pt(0.29, 0.78);
const RIGHT_WRIST_REST = pt(-0.21, 0.96);
const RIGHT_HAND_REST_ANGLE = 0.75;
const LEFT_WRIST = pt(0.2, 0.95);
const LEFT_HAND_ANGLE = Math.PI - 0.8;
const RIGHT_WRIST_AT_DECK = pt(0.04, 0.96);
const RIGHT_HAND_AT_DECK_ANGLE = 0.35;
const RIGHT_WRIST_DEALT = pt(-0.17, 1.03);
const RIGHT_HAND_DEALT_ANGLE = 1.2;
const CARD_RELEASE_AT = pt(-0.1, 1.15);
const CARD_SLIDE_TO = pt(-0.06, 1.24);
/** His eyes follow the card from the deck out to the player's spot. */
const LOOK_AT_DECK = 0.3;
const LOOK_AT_SPOT = -0.5;
const DEALING_LOOK_DOWN = 1;
const RESTING_LOOK_DOWN = 0.4;

const BREATH_PERIOD_MS = 5200;
const BREATH_AMOUNT = 0.004;
const BLINK_CYCLE_MS = 4700;
const BLINK_MS = 140;
const OUTLINE_PIXELS = 2;
const PIPING_PIXELS = 1;
const CHAIN_PIXELS = 1;

/** Steps the deal is cut into for caching: fine enough that the motion stays smooth. */
const DEAL_STEPS = 32;
const LOOK_STEP = 0.1;
const BODY_BOX: CacheBox = { x: -0.38, y: 0.12, w: 0.76, h: 0.9 };
/** The arms pass holds both whole arms, shoulder to fingertips. */
const HANDS_BOX: CacheBox = { x: -0.42, y: 0.42, w: 0.84, h: 0.92 };
/** Where the felt's far rim crosses the figure box, read off the club's table art. */
const TABLE_RIM_Y = 0.83;
const ARM_SHADOW_OFFSET = pt(0.012, 0.016);
const ARM_SHADOW = 'rgba(0, 0, 0, 0.3)';
const BODY_CACHE_ENTRIES = 24;
const HANDS_CACHE_ENTRIES = DEAL_STEPS + 4;
const bodyCache = new BitmapCache(BODY_CACHE_ENTRIES);
const handsCache = new BitmapCache(HANDS_CACHE_ENTRIES);

// ── Proportion tables, in figure units ──────────────────────────────────────

/** Half the shirt body, neck to below the table rim; mirrored for the other side. */
const TORSO_HALF: readonly Pt[] = [
  pt(0.08, 0.47),
  pt(0.17, 0.49),
  pt(0.25, 0.54),
  pt(0.2, 0.63),
  pt(0.24, 0.8),
  pt(0.24, 0.98),
];
const WAISTCOAT_PANEL: readonly Pt[] = [
  pt(0.085, 0.49),
  pt(0.15, 0.5),
  pt(0.17, 0.58),
  pt(0.22, 0.68),
  pt(0.24, 0.98),
  pt(-0.006, 0.98),
  pt(-0.006, 0.66),
];
const FRONT_PIPING: readonly Pt[] = [pt(0.085, 0.49), pt(0.006, 0.66)];
const BUTTON_Y: readonly number[] = [0.7, 0.76];
const BUTTON_RADIUS = 0.011;
const WATCH_CHAIN: readonly Pt[] = [pt(0.005, 0.73), pt(0.07, 0.755), pt(0.13, 0.72)];
const TIE_WING: readonly Pt[] = [pt(0, 0.485), pt(0.055, 0.465), pt(0.06, 0.51), pt(0, 0.495)];
const TIE_OUTLINE_PIXELS = 1.5;
const PANEL_OUTLINE_PIXELS = 1.5;

const TORSO_SHADING: FormShading = { shadow: 0.02, highlight: 0.008 };
const PANEL_SHADING_NEAR: FormShading = { shadow: 0.012, highlight: 0.006 };
const PANEL_SHADING_FAR: FormShading = { shadow: 0.03, highlight: 0.006 };

interface WorldArm {
  elbow: Pt;
  wrist: Pt;
  angle: number;
  hand: HandPose;
  thumbSide: 1 | -1;
  grip: Grip;
}

interface WorldPose {
  expression: DeuceExpression;
  right: WorldArm;
  left: WorldArm;
  /** A released card sliding on toward the player, 0→1; null when none is in flight. */
  slide: number | null;
}

const LEFT_ARM: WorldArm = {
  elbow: LEFT_ELBOW,
  wrist: LEFT_WRIST,
  angle: LEFT_HAND_ANGLE,
  hand: DECK_HAND,
  thumbSide: 1,
  grip: 'deck',
};
const RESTING_RIGHT_ARM: WorldArm = {
  elbow: RIGHT_ELBOW,
  wrist: RIGHT_WRIST_REST,
  angle: RIGHT_HAND_REST_ANGLE,
  hand: RESTING_HAND,
  thumbSide: 1,
  grip: 'none',
};

function breathAt(phaseMs: number): number {
  const through = (phaseMs % BREATH_PERIOD_MS) / BREATH_PERIOD_MS;
  return Math.sin(through * Math.PI * 2) * BREATH_AMOUNT;
}

/** The deal's phase snapped to its cache steps. */
function dealStep(phaseMs: number): number {
  const through = (phaseMs % DEAL_PERIOD_MS) / DEAL_PERIOD_MS;
  return Math.floor(through * DEAL_STEPS) % DEAL_STEPS;
}

function worldPoseAt(phaseMs: number, dealing: boolean): WorldPose {
  const blinking = phaseMs % BLINK_CYCLE_MS < BLINK_MS;
  const expression: DeuceExpression = {
    lidOpen: blinking ? 0 : 1,
    browRaise: 0,
    browSkew: 0,
    mouthCurve: 0,
    mouthOpen: 0,
    smirk: 0,
    lookX: 0,
    lookY: dealing ? DEALING_LOOK_DOWN : RESTING_LOOK_DOWN,
  };
  if (!dealing) return { expression, right: RESTING_RIGHT_ARM, left: LEFT_ARM, slide: null };
  const steppedMs = (dealStep(phaseMs) / DEAL_STEPS) * DEAL_PERIOD_MS;
  const beat = dealBeatAt(steppedMs);
  const hand = beat.holding ? PINCH_HAND : beat.slide !== null ? OPEN_PALM_BACK : RESTING_HAND;
  return {
    expression: {
      ...expression,
      lookX: quantize(lerp(LOOK_AT_DECK, LOOK_AT_SPOT, beat.reach), LOOK_STEP),
    },
    right: {
      elbow: RIGHT_ELBOW,
      wrist: lerpPt(RIGHT_WRIST_AT_DECK, RIGHT_WRIST_DEALT, beat.reach),
      angle: lerp(RIGHT_HAND_AT_DECK_ANGLE, RIGHT_HAND_DEALT_ANGLE, beat.reach),
      hand,
      thumbSide: 1,
      grip: beat.holding ? 'card' : 'none',
    },
    left: LEFT_ARM,
    slide: beat.slide,
  };
}

function shoulder(side: number): Pt {
  return pt(side * SHOULDER_X, SHOULDER_Y);
}

function mirrored(points: readonly Pt[], side: number): Pt[] {
  return points.map((p) => pt(p.x * side, p.y));
}

function paintTorso(ctx: Ctx): void {
  const torso: Trace = (c) =>
    traceSmoothLoop(c, [...mirrored(TORSO_HALF, -1), ...mirrored(TORSO_HALF, 1).reverse()]);
  outlineTrace(ctx, torso, OUTLINE_PIXELS);
  paintForm(ctx, torso, SHIRT, TORSO_SHADING);
  for (const side of [-1, 1]) {
    const panel: Trace = (c) => tracePolygon(c, mirrored(WAISTCOAT_PANEL, side));
    outlineTrace(ctx, panel, PANEL_OUTLINE_PIXELS);
    paintForm(ctx, panel, WAISTCOAT, side < 0 ? PANEL_SHADING_NEAR : PANEL_SHADING_FAR);
    strokeLine(ctx, mirrored(FRONT_PIPING, side), GOLD.base, PIPING_PIXELS);
  }
  for (const y of BUTTON_Y) {
    fillTrace(ctx, (c) => traceEllipse(c, 0, y, BUTTON_RADIUS, BUTTON_RADIUS), GOLD.base);
  }
  strokeLine(ctx, WATCH_CHAIN, GOLD.light ?? GOLD.base, CHAIN_PIXELS, true);
  for (const side of [-1, 1]) {
    const wing: Trace = (c) => tracePolygon(c, mirrored(TIE_WING, side));
    outlineTrace(ctx, wing, TIE_OUTLINE_PIXELS);
    fillTrace(ctx, wing, BOW_TIE.base);
  }
}

function paintBody(ctx: Ctx, pose: WorldPose): void {
  paintTorso(ctx);
  ctx.save();
  ctx.translate(0, HEAD_Y);
  ctx.scale(HEAD_UNIT, HEAD_UNIT);
  paintDeuceHead(ctx, pose.expression, 'world');
  ctx.restore();
}

/** A whole arm, shoulder to fingertips: one limb reaching over the table's rim. */
function paintArm(ctx: Ctx, side: number, arm: WorldArm): void {
  paintArmSleeve(ctx, ARM, shoulder(side), arm.elbow, arm.wrist, 'simple');
  paintGrippingHand(
    ctx,
    GRIP,
    { wrist: arm.wrist, angle: arm.angle, length: HAND_LENGTH, thumbSide: arm.thumbSide },
    arm.hand,
    arm.grip,
    0,
  );
  paintCuff(ctx, ARM, arm.elbow, arm.wrist, 'simple');
}

function paintHands(ctx: Ctx, pose: WorldPose): void {
  const slide = pose.slide;
  if (slide !== null) {
    const centre = lerpPt(CARD_RELEASE_AT, CARD_SLIDE_TO, slide);
    ctx.save();
    ctx.globalAlpha *= 1 - slide;
    const angle = RIGHT_HAND_DEALT_ANGLE - Math.PI / 2;
    paintCardBack(ctx, cardCorners(centre, angle, CARD.width, CARD.height));
    ctx.restore();
  }
  // Shadows land on the rim and felt only: above the rim is the waistcoat.
  ctx.save();
  ctx.beginPath();
  ctx.rect(HANDS_BOX.x, TABLE_RIM_Y, HANDS_BOX.w, HANDS_BOX.y + HANDS_BOX.h - TABLE_RIM_Y);
  ctx.clip();
  ctx.translate(ARM_SHADOW_OFFSET.x, ARM_SHADOW_OFFSET.y);
  for (const [side, arm] of [
    [1, pose.left],
    [-1, pose.right],
  ] as const) {
    fillTrace(ctx, armTrace(ARM, shoulder(side), arm.elbow, arm.wrist), ARM_SHADOW);
  }
  ctx.restore();
  paintArm(ctx, 1, pose.left);
  paintArm(ctx, -1, pose.right);
}

function withFigureSpace(ctx: Ctx, sx: number, sy: number, size: number, paint: () => void): void {
  ctx.save();
  ctx.translate(sx + size / 2, sy);
  ctx.scale(size, size);
  try {
    paint();
  } finally {
    ctx.restore();
  }
}

/** Everything behind the table: torso and head. */
export function paintDeuceWorldBody(
  ctx: Ctx,
  sx: number,
  sy: number,
  size: number,
  phaseMs: number,
  dealing: boolean,
): void {
  const pose = worldPoseAt(phaseMs, dealing);
  const key = `${dealing},${pose.expression.lidOpen},${pose.expression.lookX}`;
  withFigureSpace(ctx, sx, sy, size, () => {
    ctx.translate(0, breathAt(phaseMs));
    bodyCache.draw(ctx, key, BODY_BOX, (target) => paintBody(target, pose));
  });
}

/**
 * The arms, hands, deck and dealt card. Painted after the table: the forearms
 * lie on the felt, and the whole arm is painted here so it stays one limb
 * where it crosses the rim.
 */
export function paintDeuceWorldHands(
  ctx: Ctx,
  sx: number,
  sy: number,
  size: number,
  phaseMs: number,
  dealing: boolean,
): void {
  const pose = worldPoseAt(phaseMs, dealing);
  const key = dealing ? `deal,${dealStep(phaseMs)}` : 'rest';
  withFigureSpace(ctx, sx, sy, size, () => {
    handsCache.draw(ctx, key, HANDS_BOX, (target) => paintHands(target, pose));
  });
}
