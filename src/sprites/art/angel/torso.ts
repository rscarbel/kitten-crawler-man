/**
 * Angel's torso head-on and from behind, and what she wears on it.
 *
 * The torso is two rigid sections — chest and pelvis — joined at the waist, so
 * the hips can drop and swing under shoulders that tilt the other way. Its
 * outline is traced once in rest coordinates and every point is carried
 * through a blend of the two sections' frames, which bends the waist smoothly
 * instead of hinging it; the forms shaded on it ride whichever section they
 * belong to.
 *
 * The forms are carried by stepped value. Each round mass — a breast, a cheek
 * of the seat — is lit as the fill, given a core shadow along its turned-away
 * side as the shape minus itself slid toward the light, a thin light bounced
 * up into the bottom of that shadow, and one fold line no wider than a pixel
 * where it meets the form beneath. Nothing on her skin is darker than a
 * mid-tone over an area: a dark wash at sixty pixels tall reads as a smudge.
 */

import { fillSoftEllipse, strokeSoftCrease, taperedCreaseGradient } from '../softShade';
import { lerp, rgba } from '../bipedArt';
import { fillCrescent, type Ctx } from './paint';
import {
  BRA_COLOR,
  BRA_SHADOW,
  BRA_SHEEN,
  BRA_TRIM,
  SKIN_BASE,
  SKIN_BOUNCE,
  SKIN_CREASE,
  SKIN_DEEP_SHADE,
  SKIN_HALF,
  SKIN_HIGHLIGHT,
  SKIN_LIT,
  SKIN_SHADE,
  THONG_COLOR,
  THONG_SHADOW,
  THONG_SHEEN,
  THONG_TRIM,
} from './palette';
import {
  ARMPIT_HALF_WIDTH,
  ARMPIT_Y,
  BACK_CHEST_HALF_WIDTH,
  BUST_HALF_WIDTH,
  BUST_POINT_X,
  BUST_POINT_Y,
  BUST_WIDEST_Y,
  CROTCH_Y,
  HIP_HALF_WIDTH,
  HIP_JOINT_Y,
  HIP_Y,
  NECK_HALF_WIDTH,
  NECK_TOP_Y,
  RIBCAGE_HALF_WIDTH,
  RIBCAGE_Y,
  SHOULDER_HALF_WIDTH,
  SHOULDER_Y,
  WAIST_HALF_WIDTH,
  WAIST_TO_HIP_CONTROL_RISE,
  WAIST_Y,
} from './proportions';
import { placeInSection, SIDES, type AngelSkeleton, type BodySide, type Pt2 } from './skeleton';

/* ── The bending torso ─────────────────────────────────────────────────── */

/** Anything that accepts path commands: the canvas, or a warp in front of it. */
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
  closePath(): void;
}

interface TorsoWarp {
  map(x: number, y: number): Pt2;
  /** The chest–pelvis blend's turn at height `y`, for shading laid on rigidly there. */
  angleAt(y: number): number;
}

function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/** How much of a point at height `y` belongs to the pelvis rather than the chest. */
function pelvisShare(y: number): number {
  return smoothstep((y - RIBCAGE_Y) / (HIP_Y - RIBCAGE_Y));
}

export function torsoWarp(skeleton: AngelSkeleton): TorsoWarp {
  const { chest, pelvis } = skeleton;
  return {
    map(x: number, y: number): Pt2 {
      const share = pelvisShare(y);
      const onChest = placeInSection(chest, WAIST_Y, { x, y, z: 0 });
      const onPelvis = placeInSection(pelvis, HIP_JOINT_Y, { x, y, z: 0 });
      return { x: lerp(onChest.x, onPelvis.x, share), y: lerp(onChest.y, onPelvis.y, share) };
    },
    angleAt(y: number): number {
      return lerp(chest.roll, pelvis.roll, pelvisShare(y));
    },
  };
}

function warpSink(ctx: Ctx, warp: TorsoWarp): PathSink {
  const at = (x: number, y: number): Pt2 => warp.map(x, y);
  return {
    moveTo(x, y) {
      const p = at(x, y);
      ctx.moveTo(p.x, p.y);
    },
    lineTo(x, y) {
      const p = at(x, y);
      ctx.lineTo(p.x, p.y);
    },
    quadraticCurveTo(cx, cy, x, y) {
      const c = at(cx, cy);
      const p = at(x, y);
      ctx.quadraticCurveTo(c.x, c.y, p.x, p.y);
    },
    bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
      const c1 = at(c1x, c1y);
      const c2 = at(c2x, c2y);
      const p = at(x, y);
      ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p.x, p.y);
    },
    closePath() {
      ctx.closePath();
    },
  };
}

/** Lay the context on the torso rigidly at height `y`, for shading centred there. */
export function onTorsoAt(ctx: Ctx, warp: TorsoWarp, y: number): void {
  const origin = warp.map(0, y);
  ctx.translate(origin.x, origin.y);
  ctx.rotate(warp.angleAt(y));
  ctx.translate(0, -y);
}

/* ── Outline ───────────────────────────────────────────────────────────── */

const ARMPIT_DROP = 0.01;
const BUST_ENTRY_DROP = 0.022;
const BUST_EXIT_DROP = 0.03;
const RIB_APPROACH_RISE = 0.01;
const RIB_FLARE = 0.008;
const WAIST_CONTROL_RISE = 0.03;

/**
 * One side of the chest, shoulder to waist: armpit tuck, breast swell, ribcage
 * tuck. Run as one curve the breasts exist only in the shading.
 */
function pathChestSide(p: PathSink, side: BodySide, chestHalfWidth: number): void {
  if (side < 0) {
    p.quadraticCurveTo(-SHOULDER_HALF_WIDTH, ARMPIT_Y - ARMPIT_DROP, -ARMPIT_HALF_WIDTH, ARMPIT_Y);
    p.bezierCurveTo(
      -chestHalfWidth,
      ARMPIT_Y + BUST_ENTRY_DROP,
      -chestHalfWidth,
      BUST_WIDEST_Y - BUST_ENTRY_DROP,
      -chestHalfWidth,
      BUST_WIDEST_Y,
    );
    p.bezierCurveTo(
      -chestHalfWidth,
      BUST_WIDEST_Y + BUST_EXIT_DROP,
      -RIBCAGE_HALF_WIDTH - RIB_FLARE,
      RIBCAGE_Y - RIB_APPROACH_RISE,
      -RIBCAGE_HALF_WIDTH,
      RIBCAGE_Y,
    );
    p.quadraticCurveTo(
      -WAIST_HALF_WIDTH - RIB_FLARE,
      WAIST_Y - WAIST_CONTROL_RISE,
      -WAIST_HALF_WIDTH,
      WAIST_Y,
    );
    return;
  }
  p.quadraticCurveTo(
    WAIST_HALF_WIDTH + RIB_FLARE,
    WAIST_Y - WAIST_CONTROL_RISE,
    RIBCAGE_HALF_WIDTH,
    RIBCAGE_Y,
  );
  p.bezierCurveTo(
    RIBCAGE_HALF_WIDTH + RIB_FLARE,
    RIBCAGE_Y - RIB_APPROACH_RISE,
    chestHalfWidth,
    BUST_WIDEST_Y + BUST_EXIT_DROP,
    chestHalfWidth,
    BUST_WIDEST_Y,
  );
  p.bezierCurveTo(
    chestHalfWidth,
    BUST_WIDEST_Y - BUST_ENTRY_DROP,
    chestHalfWidth,
    ARMPIT_Y + BUST_ENTRY_DROP,
    ARMPIT_HALF_WIDTH,
    ARMPIT_Y,
  );
  p.quadraticCurveTo(SHOULDER_HALF_WIDTH, ARMPIT_Y - ARMPIT_DROP, SHOULDER_HALF_WIDTH, SHOULDER_Y);
}

/**
 * Head-on the torso ends at the inguinal creases — the two folds running from
 * the hip bone down and in to the crotch. Below them is thigh.
 */
const INGUINAL_UPPER_CONTROL_X = HIP_HALF_WIDTH * 0.86;
const INGUINAL_UPPER_CONTROL_Y = HIP_Y + 0.026;
const INGUINAL_LOWER_CONTROL_X = HIP_HALF_WIDTH * 0.38;
const INGUINAL_LOWER_CONTROL_Y = CROTCH_Y - 0.012;
const INGUINAL_INNER_X = 0.012;
const INGUINAL_INNER_Y = CROTCH_Y;
const FRONT_HEM_POINT_Y = CROTCH_Y + 0.008;
/**
 * Below the hip line the outer silhouette belongs to the thigh, whose top is
 * shaped to carry the hip's curve on down; the torso turns in along the
 * inguinal fold from just under the hip line, through the leg's own tone.
 */
const INGUINAL_OUTER_X = HIP_HALF_WIDTH * 0.97;
const INGUINAL_OUTER_Y = HIP_Y + 0.01;
/** Head-on: from the hip line in along the inguinal fold to the crotch. */
function traceFrontHipToCrotch(p: PathSink, side: BodySide, inward: boolean): void {
  if (inward) {
    p.quadraticCurveTo(
      side * HIP_HALF_WIDTH,
      INGUINAL_OUTER_Y,
      side * INGUINAL_OUTER_X,
      INGUINAL_OUTER_Y,
    );
    p.bezierCurveTo(
      side * INGUINAL_UPPER_CONTROL_X,
      INGUINAL_UPPER_CONTROL_Y,
      side * INGUINAL_LOWER_CONTROL_X,
      INGUINAL_LOWER_CONTROL_Y,
      side * INGUINAL_INNER_X,
      INGUINAL_INNER_Y,
    );
    return;
  }
  p.bezierCurveTo(
    side * INGUINAL_LOWER_CONTROL_X,
    INGUINAL_LOWER_CONTROL_Y,
    side * INGUINAL_UPPER_CONTROL_X,
    INGUINAL_UPPER_CONTROL_Y,
    side * INGUINAL_OUTER_X,
    INGUINAL_OUTER_Y,
  );
  p.quadraticCurveTo(side * HIP_HALF_WIDTH, INGUINAL_OUTER_Y, side * HIP_HALF_WIDTH, HIP_Y);
}

/**
 * From behind, the hip line runs on into two cheeks that round out past it,
 * tuck under over the thighs and meet in a short notch. Lifted: the lowest
 * point of each cheek is inboard, close to the cleft, and the outer flank runs
 * into the thigh in one curve with no shelf.
 */
/**
 * From behind the hip line runs on into the outside of the thigh, which the
 * leg's own outline carries; the torso turns in under each cheek from there.
 * Its outer turn lies over the thigh in the thigh's own tone, and only the
 * inner part, where the cheek sits down on the thigh, carries a fold. Lifted:
 * each cheek's lowest point is tucked in near the cleft.
 */
const SEAT_SIDE_Y = HIP_Y + 0.03;
const SEAT_TURN_X = HIP_HALF_WIDTH * 0.92;
const SEAT_TURN_Y = CROTCH_Y - 0.004;
const SEAT_UNDER_X = HIP_HALF_WIDTH * 0.55;
const SEAT_UNDER_Y = CROTCH_Y + 0.028;
const SEAT_INNER_X = 0.016;
const SEAT_INNER_BOTTOM_Y = CROTCH_Y + 0.026;
const SEAT_NOTCH_Y = CROTCH_Y + 0.014;

function pathSeatUnderside(p: PathSink): void {
  p.quadraticCurveTo(-HIP_HALF_WIDTH, SEAT_SIDE_Y, -SEAT_TURN_X, SEAT_TURN_Y);
  p.quadraticCurveTo(-SEAT_UNDER_X, SEAT_UNDER_Y, -SEAT_INNER_X, SEAT_INNER_BOTTOM_Y);
  p.quadraticCurveTo(0, SEAT_NOTCH_Y, SEAT_INNER_X, SEAT_INNER_BOTTOM_Y);
  p.quadraticCurveTo(SEAT_UNDER_X, SEAT_UNDER_Y, SEAT_TURN_X, SEAT_TURN_Y);
  p.quadraticCurveTo(HIP_HALF_WIDTH, SEAT_SIDE_Y, HIP_HALF_WIDTH, HIP_Y);
}

const NECK_FLARE = 0.02;

function pathTorso(p: PathSink, back: boolean): void {
  const chestHalfWidth = back ? BACK_CHEST_HALF_WIDTH : BUST_HALF_WIDTH;
  p.moveTo(-SHOULDER_HALF_WIDTH, SHOULDER_Y);
  pathChestSide(p, -1, chestHalfWidth);
  p.quadraticCurveTo(-HIP_HALF_WIDTH, HIP_Y - WAIST_TO_HIP_CONTROL_RISE, -HIP_HALF_WIDTH, HIP_Y);
  if (back) {
    pathSeatUnderside(p);
  } else {
    traceFrontHipToCrotch(p, -1, true);
    p.quadraticCurveTo(0, FRONT_HEM_POINT_Y, INGUINAL_INNER_X, INGUINAL_INNER_Y);
    traceFrontHipToCrotch(p, 1, false);
  }
  p.quadraticCurveTo(HIP_HALF_WIDTH, HIP_Y - WAIST_TO_HIP_CONTROL_RISE, WAIST_HALF_WIDTH, WAIST_Y);
  pathChestSide(p, 1, chestHalfWidth);
  p.quadraticCurveTo(NECK_HALF_WIDTH * 2, SHOULDER_Y - NECK_FLARE, NECK_HALF_WIDTH, NECK_TOP_Y);
  p.lineTo(-NECK_HALF_WIDTH, NECK_TOP_Y);
  p.quadraticCurveTo(
    -NECK_HALF_WIDTH * 2,
    SHOULDER_Y - NECK_FLARE,
    -SHOULDER_HALF_WIDTH,
    SHOULDER_Y,
  );
  p.closePath();
}

/* ── Bust ──────────────────────────────────────────────────────────────── */

/**
 * Each breast is a round mass sitting on the ribs, turned up and out: lit as
 * the fill, a core shadow along its lower outside edge, a narrow bounce light
 * inside the bottom of that shadow, a fold line where it meets the ribs, and a
 * short cast shadow on the ribs below the fold. The bra's cup is laid over
 * the lower part of it afterwards.
 */
const BREAST_CENTER_X = BUST_POINT_X * 1.17;
const BREAST_CENTER_Y = BUST_POINT_Y - 0.002;
const BREAST_RADIUS_X = 0.041;
const BREAST_RADIUS_Y = 0.038;
const BREAST_TILT = -0.22;
/** Slide that leaves the core shadow along the underside and the inner curve. */
const BREAST_HALF_SLIDE_X = 0.012;
const BREAST_HALF_SLIDE_Y = -0.034;
const BREAST_HALF_ALPHA = 0.75;
const BREAST_CORE_SLIDE_X = 0.006;
const BREAST_CORE_SLIDE_Y = -0.016;
const BREAST_CORE_ALPHA = 0.6;
const BREAST_BOUNCE_LIFT = 0.004;
const BREAST_BOUNCE_ALPHA = 0.5;
const BREAST_FOLD_ARC_START = Math.PI * 0.16;
const BREAST_FOLD_ARC_END = Math.PI * 0.8;
const BREAST_FOLD_WIDTH = 0.0035;
const BREAST_FOLD_FADE_IN = 0.25;
const BREAST_FOLD_FADE_OUT = 0.75;
const BREAST_FOLD_ALPHA = 0.75;
const RIB_CAST_DROP = 0.003;
const RIB_CAST_WIDTH = 0.01;
const RIB_CAST_ALPHA = 0.65;
const BREAST_HIGHLIGHT_X = BUST_POINT_X * 1.1;
const BREAST_HIGHLIGHT_Y = BUST_POINT_Y - 0.02;
const BREAST_HIGHLIGHT_RADIUS_X = 0.03;
const BREAST_HIGHLIGHT_RADIUS_Y = 0.022;
const BREAST_HIGHLIGHT_ALPHA = 1;
/** The breast's top edge needs a second value above it to border against. */
const UPPER_CHEST_Y = SHOULDER_Y + 0.036;
const UPPER_CHEST_RADIUS_X = 0.075;
const UPPER_CHEST_RADIUS_Y = 0.03;
const UPPER_CHEST_ALPHA = 0.5;
const CLEAVAGE_TOP_Y = BUST_POINT_Y - 0.032;
const CLEAVAGE_BOTTOM_Y = BUST_POINT_Y + 0.026;
const CLEAVAGE_TOP_HALF_WIDTH = 0.012;
const CLEAVAGE_ALPHA = 0.85;

const COLLARBONE_INNER_X = 0.012;
const COLLARBONE_OUTER_X = SHOULDER_HALF_WIDTH * 0.84;
const COLLARBONE_Y = SHOULDER_Y + 0.012;
const COLLARBONE_DIP = 0.012;
const COLLARBONE_RIDGE_RISE = 0.007;
const COLLARBONE_RIDGE_ALPHA = 0.7;
const COLLARBONE_FADE_STOP = 0.72;
const COLLARBONE_LINE_WIDTH = 0.0035;
const COLLARBONE_ALPHA = 0.55;
const NOTCH_Y = SHOULDER_Y + 0.004;
const NOTCH_RADIUS_X = 0.012;
const NOTCH_RADIUS_Y = 0.007;
const NOTCH_ALPHA = 0.4;

/** Forms are lit from her right of screen; their lights sit a touch toward it, and the far side's lights are dimmer. */
const LIT_SIDE_NUDGE = 0.004;
const SHADOW_SIDE_LIGHT_SHARE = 0.65;
const CLEAVAGE_FADE_STOP = 0.6;
const CLEAVAGE_WAIST_SHARE = 0.3;
const NECK_CORD_FADE_STOP = 0.6;
const MIDLINE_FADE_STOP = 0.5;
const NAVEL_CORE_FRACTION = 0.6;
const INGUINAL_FOLD_TUCK = 0.8;
const PANEL_TOP_DIP = 0.002;
const PANEL_GUSSET_ROUND = 0.003;
const PANEL_EDGE_ALPHA = 0.7;
const BAND_EDGE_WIDTH = 0.0028;
const BAND_EDGE_ALPHA = 0.8;
const STRING_FLARE_DROP = 0.012;
const STRING_TIP_SHARE = 0.6;
const FOLD_SAG = 0.004;
const DIMPLE_CORE_FRACTION = 0.5;
const CLEFT_SHADE_DROP = 0.01;
const CLEFT_FADE_STOP = 0.35;
const BLADE_LIGHT_RISE = 0.01;
const BLADE_FADE_STOP = 0.5;
const SPINE_FADE_STOP = 0.4;
const SPINE_BOTTOM_Y = HIP_Y - 0.01;

const TIGHT_LAYERS = [
  { widthScale: 2, alpha: 0.1 },
  { widthScale: 1.4, alpha: 0.22 },
  { widthScale: 1, alpha: 0.55 },
] as const;

function pathBreast(ctx: Ctx, side: BodySide): void {
  ctx.ellipse(
    side * BREAST_CENTER_X,
    BREAST_CENTER_Y,
    BREAST_RADIUS_X,
    BREAST_RADIUS_Y,
    side * BREAST_TILT,
    0,
    Math.PI * 2,
  );
}

function drawBust(ctx: Ctx): void {
  fillSoftEllipse(
    ctx,
    0,
    UPPER_CHEST_Y,
    UPPER_CHEST_RADIUS_X,
    UPPER_CHEST_RADIUS_Y,
    SKIN_BASE,
    UPPER_CHEST_ALPHA,
  );
  drawCollarbones(ctx);

  for (const side of SIDES) {
    ctx.save();
    ctx.beginPath();
    pathBreast(ctx, side);
    ctx.clip();
    fillSoftEllipse(
      ctx,
      side * BREAST_HIGHLIGHT_X,
      BREAST_HIGHLIGHT_Y,
      BREAST_HIGHLIGHT_RADIUS_X,
      BREAST_HIGHLIGHT_RADIUS_Y,
      SKIN_HIGHLIGHT,
      BREAST_HIGHLIGHT_ALPHA,
      side * BREAST_TILT,
    );
    // Each breast's core shadow is cut by sliding it up and outward, so the
    // shadow lies along its underside and inner curve: the part that carries
    // the form at game size.
    const slideX = (dx: number): number => dx * side;
    fillCrescent(
      ctx,
      () => pathBreast(ctx, side),
      slideX(BREAST_HALF_SLIDE_X),
      BREAST_HALF_SLIDE_Y,
      SKIN_DEEP_SHADE,
      BREAST_HALF_ALPHA,
    );
    fillCrescent(
      ctx,
      () => pathBreast(ctx, side),
      slideX(BREAST_CORE_SLIDE_X),
      BREAST_CORE_SLIDE_Y,
      SKIN_CREASE,
      BREAST_CORE_ALPHA,
    );
    // Light off the ribs, back up into the bottom of the shadow.
    ctx.save();
    ctx.globalAlpha *= BREAST_BOUNCE_ALPHA;
    ctx.strokeStyle = SKIN_BOUNCE;
    ctx.lineWidth = BREAST_FOLD_WIDTH;
    ctx.beginPath();
    ctx.ellipse(
      side * BREAST_CENTER_X,
      BREAST_CENTER_Y - BREAST_BOUNCE_LIFT,
      BREAST_RADIUS_X - BREAST_BOUNCE_LIFT,
      BREAST_RADIUS_Y - BREAST_BOUNCE_LIFT,
      side * BREAST_TILT,
      BREAST_FOLD_ARC_START,
      BREAST_FOLD_ARC_END,
    );
    ctx.stroke();
    ctx.restore();
    ctx.restore();

    // The cast shadow on the ribs: outside the breast, just under its fold.
    ctx.save();
    ctx.beginPath();
    ctx.rect(-1, -1, 2, 2);
    pathBreast(ctx, side);
    ctx.clip('evenodd');
    ctx.globalAlpha *= RIB_CAST_ALPHA;
    ctx.strokeStyle = SKIN_SHADE;
    ctx.lineWidth = RIB_CAST_WIDTH;
    ctx.beginPath();
    ctx.ellipse(
      side * BREAST_CENTER_X,
      BREAST_CENTER_Y + RIB_CAST_DROP,
      BREAST_RADIUS_X,
      BREAST_RADIUS_Y,
      side * BREAST_TILT,
      BREAST_FOLD_ARC_START,
      BREAST_FOLD_ARC_END,
    );
    ctx.stroke();
    ctx.restore();

    const arcPoint = (angle: number): Pt2 => {
      const c = Math.cos(side * BREAST_TILT);
      const s = Math.sin(side * BREAST_TILT);
      const ex = BREAST_RADIUS_X * Math.cos(angle);
      const ey = BREAST_RADIUS_Y * Math.sin(angle);
      return { x: side * BREAST_CENTER_X + ex * c - ey * s, y: BREAST_CENTER_Y + ex * s + ey * c };
    };
    const from = arcPoint(BREAST_FOLD_ARC_START);
    const to = arcPoint(BREAST_FOLD_ARC_END);
    const fold = taperedCreaseGradient(
      ctx,
      from.x,
      from.y,
      to.x,
      to.y,
      SKIN_CREASE,
      BREAST_FOLD_FADE_IN,
      BREAST_FOLD_FADE_OUT,
    );
    strokeSoftCrease(
      ctx,
      BREAST_FOLD_WIDTH,
      fold,
      () =>
        ctx.ellipse(
          side * BREAST_CENTER_X,
          BREAST_CENTER_Y,
          BREAST_RADIUS_X,
          BREAST_RADIUS_Y,
          side * BREAST_TILT,
          BREAST_FOLD_ARC_START,
          BREAST_FOLD_ARC_END,
        ),
      BREAST_FOLD_ALPHA,
      TIGHT_LAYERS,
    );
  }

  // The valley between them, narrowing as they close on each other going down.
  const valley = ctx.createLinearGradient(0, CLEAVAGE_TOP_Y, 0, CLEAVAGE_BOTTOM_Y);
  valley.addColorStop(0, rgba(SKIN_SHADE, 0));
  valley.addColorStop(CLEAVAGE_FADE_STOP, SKIN_SHADE);
  valley.addColorStop(1, SKIN_CREASE);
  ctx.save();
  ctx.globalAlpha *= CLEAVAGE_ALPHA;
  ctx.fillStyle = valley;
  ctx.beginPath();
  ctx.moveTo(0, CLEAVAGE_BOTTOM_Y);
  ctx.quadraticCurveTo(
    CLEAVAGE_TOP_HALF_WIDTH * CLEAVAGE_WAIST_SHARE,
    (CLEAVAGE_TOP_Y + CLEAVAGE_BOTTOM_Y) / 2,
    CLEAVAGE_TOP_HALF_WIDTH,
    CLEAVAGE_TOP_Y,
  );
  ctx.lineTo(-CLEAVAGE_TOP_HALF_WIDTH, CLEAVAGE_TOP_Y);
  ctx.quadraticCurveTo(
    -CLEAVAGE_TOP_HALF_WIDTH * CLEAVAGE_WAIST_SHARE,
    (CLEAVAGE_TOP_Y + CLEAVAGE_BOTTOM_Y) / 2,
    0,
    CLEAVAGE_BOTTOM_Y,
  );
  ctx.fill();
  ctx.restore();
}

/**
 * The two neck muscles running from behind the ears down to the pit of the
 * throat, as faint lines converging in a V. Without them the neck is a plain
 * column with nothing to say where it turns.
 */
const NECK_CORD_TOP_X = NECK_HALF_WIDTH * 0.85;
const NECK_CORD_TOP_Y = NECK_TOP_Y + 0.008;
const NECK_CORD_BOTTOM_X = 0.006;
const NECK_CORD_BOTTOM_Y = SHOULDER_Y + 0.002;
const NECK_CORD_WIDTH = 0.003;
const NECK_CORD_ALPHA = 0.45;

function drawCollarbones(ctx: Ctx): void {
  for (const side of SIDES) {
    const cord = taperedCreaseGradient(
      ctx,
      side * NECK_CORD_TOP_X,
      NECK_CORD_TOP_Y,
      side * NECK_CORD_BOTTOM_X,
      NECK_CORD_BOTTOM_Y,
      SKIN_HALF,
      NECK_CORD_FADE_STOP,
    );
    strokeSoftCrease(
      ctx,
      NECK_CORD_WIDTH,
      cord,
      () => {
        ctx.moveTo(side * NECK_CORD_TOP_X, NECK_CORD_TOP_Y);
        ctx.lineTo(side * NECK_CORD_BOTTOM_X, NECK_CORD_BOTTOM_Y);
      },
      NECK_CORD_ALPHA,
      TIGHT_LAYERS,
    );
  }
  fillSoftEllipse(ctx, 0, NOTCH_Y, NOTCH_RADIUS_X, NOTCH_RADIUS_Y, SKIN_SHADE, NOTCH_ALPHA);
  for (const side of SIDES) {
    const innerX = side * COLLARBONE_INNER_X;
    const outerX = side * COLLARBONE_OUTER_X;
    const midX = (innerX + outerX) / 2;
    fillSoftEllipse(
      ctx,
      midX,
      COLLARBONE_Y + COLLARBONE_DIP / 2 - COLLARBONE_RIDGE_RISE,
      Math.abs(outerX - innerX) / 2,
      COLLARBONE_RIDGE_RISE,
      SKIN_HIGHLIGHT,
      COLLARBONE_RIDGE_ALPHA,
    );
    const bone = taperedCreaseGradient(
      ctx,
      innerX,
      COLLARBONE_Y,
      outerX,
      COLLARBONE_Y,
      SKIN_SHADE,
      COLLARBONE_FADE_STOP,
    );
    strokeSoftCrease(
      ctx,
      COLLARBONE_LINE_WIDTH,
      bone,
      () => {
        ctx.moveTo(innerX, COLLARBONE_Y);
        ctx.quadraticCurveTo(midX, COLLARBONE_Y + COLLARBONE_DIP, outerX, COLLARBONE_Y);
      },
      COLLARBONE_ALPHA,
      TIGHT_LAYERS,
    );
  }
}

/* ── Abdomen and pelvis, head-on ───────────────────────────────────────── */

const NAVEL_Y = WAIST_Y - 0.004;
const NAVEL_RADIUS_X = 0.0042;
const NAVEL_RADIUS_Y = 0.0068;
const NAVEL_LIP_DROP = 0.006;
const NAVEL_LIP_RADIUS_X = 0.007;
const NAVEL_LIP_RADIUS_Y = 0.004;
const NAVEL_ALPHA = 0.85;
const MIDLINE_TOP_Y = BUST_POINT_Y + 0.05;
const MIDLINE_WIDTH = 0.004;
const MIDLINE_ALPHA = 0.35;
/** The abdominal wall's two lit planes either side of the midline, upper and lower. */
const UPPER_ABS_Y = WAIST_Y - 0.045;
const UPPER_ABS_X = 0.02;
const UPPER_ABS_RADIUS_X = 0.022;
const UPPER_ABS_RADIUS_Y = 0.026;
const UPPER_ABS_ALPHA = 0.6;
const LOWER_BELLY_Y = HIP_Y - 0.03;
const LOWER_BELLY_RADIUS_X = 0.04;
const LOWER_BELLY_RADIUS_Y = 0.034;
const LOWER_BELLY_ALPHA = 0.7;

/** The front of each hip bone: a lit point, with the groin hollowing away under and inside it. */
const HIP_POINT_X = HIP_HALF_WIDTH * 0.76;
const HIP_POINT_Y = HIP_Y - 0.012;
const HIP_POINT_RADIUS_X = 0.012;
const HIP_POINT_RADIUS_Y = 0.016;
const HIP_POINT_ALPHA = 0.6;
const GROIN_HOLLOW_X = HIP_HALF_WIDTH * 0.6;
const GROIN_HOLLOW_Y = HIP_Y + 0.02;
const GROIN_HOLLOW_RADIUS_X = 0.016;
const GROIN_HOLLOW_RADIUS_Y = 0.026;
const GROIN_HOLLOW_ALPHA = 0.32;
const GROIN_HOLLOW_TILT = 0.55;
/** The fold itself: a mid-tone line along the torso's lower edge, deepest low and inboard. */
const INGUINAL_CREASE_WIDTH = 0.0035;
const INGUINAL_FADE_IN = 0.35;
const INGUINAL_FADE_OUT = 0.85;
const INGUINAL_ALPHA = 0.6;
const INGUINAL_START_DROP = 0.012;

function drawAbdomen(ctx: Ctx): void {
  for (const side of SIDES) {
    fillSoftEllipse(
      ctx,
      side * UPPER_ABS_X + LIT_SIDE_NUDGE,
      UPPER_ABS_Y,
      UPPER_ABS_RADIUS_X,
      UPPER_ABS_RADIUS_Y,
      SKIN_HIGHLIGHT,
      UPPER_ABS_ALPHA * (side > 0 ? 1 : SHADOW_SIDE_LIGHT_SHARE),
    );
  }
  const midline = ctx.createLinearGradient(0, MIDLINE_TOP_Y, 0, NAVEL_Y);
  midline.addColorStop(0, rgba(SKIN_HALF, 0));
  midline.addColorStop(MIDLINE_FADE_STOP, SKIN_HALF);
  midline.addColorStop(1, SKIN_SHADE);
  ctx.save();
  ctx.globalAlpha *= MIDLINE_ALPHA;
  ctx.strokeStyle = midline;
  ctx.lineWidth = MIDLINE_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, MIDLINE_TOP_Y);
  ctx.lineTo(0, NAVEL_Y);
  ctx.stroke();
  ctx.restore();
  fillSoftEllipse(
    ctx,
    0,
    NAVEL_Y + NAVEL_LIP_DROP,
    NAVEL_LIP_RADIUS_X,
    NAVEL_LIP_RADIUS_Y,
    SKIN_HIGHLIGHT,
    NAVEL_ALPHA,
  );
  fillSoftEllipse(
    ctx,
    0,
    NAVEL_Y,
    NAVEL_RADIUS_X,
    NAVEL_RADIUS_Y,
    SKIN_SHADE,
    1,
    0,
    NAVEL_CORE_FRACTION,
  );
}

function drawPelvisFront(ctx: Ctx): void {
  fillSoftEllipse(
    ctx,
    LIT_SIDE_NUDGE,
    LOWER_BELLY_Y,
    LOWER_BELLY_RADIUS_X,
    LOWER_BELLY_RADIUS_Y,
    SKIN_HIGHLIGHT,
    LOWER_BELLY_ALPHA,
  );
  for (const side of SIDES) {
    fillSoftEllipse(
      ctx,
      side * GROIN_HOLLOW_X,
      GROIN_HOLLOW_Y,
      GROIN_HOLLOW_RADIUS_X,
      GROIN_HOLLOW_RADIUS_Y,
      SKIN_HALF,
      GROIN_HOLLOW_ALPHA,
      side * GROIN_HOLLOW_TILT,
    );
    fillSoftEllipse(
      ctx,
      side * HIP_POINT_X,
      HIP_POINT_Y,
      HIP_POINT_RADIUS_X,
      HIP_POINT_RADIUS_Y,
      SKIN_HIGHLIGHT,
      HIP_POINT_ALPHA,
      side * GROIN_HOLLOW_TILT,
    );
  }
}

function drawInguinalFolds(ctx: Ctx): void {
  for (const side of SIDES) {
    const fold = taperedCreaseGradient(
      ctx,
      side * HIP_POINT_X,
      HIP_POINT_Y,
      side * INGUINAL_INNER_X,
      INGUINAL_INNER_Y,
      SKIN_SHADE,
      INGUINAL_FADE_IN,
      INGUINAL_FADE_OUT,
    );
    strokeSoftCrease(
      ctx,
      INGUINAL_CREASE_WIDTH,
      fold,
      () => {
        ctx.moveTo(side * HIP_POINT_X, HIP_POINT_Y + INGUINAL_START_DROP);
        ctx.bezierCurveTo(
          side * INGUINAL_UPPER_CONTROL_X * INGUINAL_FOLD_TUCK,
          INGUINAL_UPPER_CONTROL_Y,
          side * INGUINAL_LOWER_CONTROL_X,
          INGUINAL_LOWER_CONTROL_Y,
          side * INGUINAL_INNER_X,
          INGUINAL_INNER_Y,
        );
      },
      INGUINAL_ALPHA,
      TIGHT_LAYERS,
    );
  }
}

/* ── Thong ─────────────────────────────────────────────────────────────── */

/**
 * The band rides high over the hip crests and dips to a shallow V at the
 * front; a high-cut panel falls from it, its leg openings following the
 * inguinal folds, narrowing to a gusset that disappears between her thighs.
 * The fabric wraps the low curve of the pelvis, so it carries a sheen high on
 * the centre and darkens as it turns under.
 */
const BAND_FRONT_Y = HIP_Y - 0.004;
const BAND_SIDE_Y = HIP_Y - 0.03;
const BAND_BACK_Y = HIP_Y - 0.018;
const BAND_HALF_HEIGHT = 0.0075;
const BAND_HALF_SPAN = HIP_HALF_WIDTH * 1.12;
const BAND_SAMPLES = 20;
const PANEL_TOP_HALF_WIDTH = HIP_HALF_WIDTH * 0.42;
const PANEL_BOTTOM_HALF_WIDTH = 0.007;
const PANEL_BOTTOM_Y = CROTCH_Y + 0.004;
const PANEL_OPENING_UPPER_X = HIP_HALF_WIDTH * 0.3;
const PANEL_OPENING_UPPER_Y = HIP_Y + 0.03;
const PANEL_OPENING_LOWER_X = 0.014;
const PANEL_OPENING_LOWER_Y = CROTCH_Y - 0.01;
const PANEL_SHEEN_Y = HIP_Y + 0.012;
const PANEL_SHEEN_RADIUS_X = 0.022;
const PANEL_SHEEN_RADIUS_Y = 0.028;
const PANEL_SHEEN_ALPHA = 0.75;
const GUSSET_SHADE_RADIUS_X = 0.022;
const GUSSET_SHADE_RADIUS_Y = 0.03;
const GUSSET_SHADE_ALPHA = 0.85;
const PANEL_EDGE_WIDTH = 0.0035;
const STRING_HALF_WIDTH = 0.0055;
const STRING_BOTTOM_Y = HIP_Y + 0.05;

function bandCenterY(x: number, back: boolean): number {
  const across = Math.min(1, Math.abs(x) / BAND_HALF_SPAN);
  const middleY = back ? BAND_BACK_Y : BAND_FRONT_Y;
  return lerp(middleY, BAND_SIDE_Y, across * across);
}

function traceBand(ctx: Ctx, back: boolean): void {
  for (let i = 0; i <= BAND_SAMPLES; i++) {
    const x = -BAND_HALF_SPAN + (2 * BAND_HALF_SPAN * i) / BAND_SAMPLES;
    const y = bandCenterY(x, back) - BAND_HALF_HEIGHT;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  for (let i = BAND_SAMPLES; i >= 0; i--) {
    const x = -BAND_HALF_SPAN + (2 * BAND_HALF_SPAN * i) / BAND_SAMPLES;
    ctx.lineTo(x, bandCenterY(x, back) + BAND_HALF_HEIGHT);
  }
  ctx.closePath();
}

function tracePanel(ctx: Ctx): void {
  const topY = (x: number): number => bandCenterY(x, false);
  ctx.moveTo(-PANEL_TOP_HALF_WIDTH, topY(PANEL_TOP_HALF_WIDTH));
  ctx.quadraticCurveTo(
    0,
    BAND_FRONT_Y - PANEL_TOP_DIP,
    PANEL_TOP_HALF_WIDTH,
    topY(PANEL_TOP_HALF_WIDTH),
  );
  ctx.bezierCurveTo(
    PANEL_OPENING_UPPER_X,
    PANEL_OPENING_UPPER_Y,
    PANEL_OPENING_LOWER_X,
    PANEL_OPENING_LOWER_Y,
    PANEL_BOTTOM_HALF_WIDTH,
    PANEL_BOTTOM_Y,
  );
  ctx.quadraticCurveTo(
    0,
    PANEL_BOTTOM_Y + PANEL_GUSSET_ROUND,
    -PANEL_BOTTOM_HALF_WIDTH,
    PANEL_BOTTOM_Y,
  );
  ctx.bezierCurveTo(
    -PANEL_OPENING_LOWER_X,
    PANEL_OPENING_LOWER_Y,
    -PANEL_OPENING_UPPER_X,
    PANEL_OPENING_UPPER_Y,
    -PANEL_TOP_HALF_WIDTH,
    topY(PANEL_TOP_HALF_WIDTH),
  );
  ctx.closePath();
}

function drawThong(ctx: Ctx, back: boolean): void {
  if (back) {
    ctx.fillStyle = THONG_COLOR;
    ctx.beginPath();
    const top = bandCenterY(0, true);
    ctx.moveTo(-STRING_HALF_WIDTH * 2, top);
    ctx.lineTo(STRING_HALF_WIDTH * 2, top);
    ctx.quadraticCurveTo(
      STRING_HALF_WIDTH,
      top + STRING_FLARE_DROP,
      STRING_HALF_WIDTH * STRING_TIP_SHARE,
      STRING_BOTTOM_Y,
    );
    ctx.lineTo(-STRING_HALF_WIDTH * STRING_TIP_SHARE, STRING_BOTTOM_Y);
    ctx.quadraticCurveTo(-STRING_HALF_WIDTH, top + STRING_FLARE_DROP, -STRING_HALF_WIDTH * 2, top);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillStyle = THONG_COLOR;
    ctx.beginPath();
    tracePanel(ctx);
    ctx.fill();
    ctx.save();
    ctx.clip();
    fillSoftEllipse(
      ctx,
      LIT_SIDE_NUDGE,
      PANEL_SHEEN_Y,
      PANEL_SHEEN_RADIUS_X,
      PANEL_SHEEN_RADIUS_Y,
      THONG_SHEEN,
      PANEL_SHEEN_ALPHA,
    );
    fillSoftEllipse(
      ctx,
      0,
      PANEL_BOTTOM_Y,
      GUSSET_SHADE_RADIUS_X,
      GUSSET_SHADE_RADIUS_Y,
      THONG_SHADOW,
      GUSSET_SHADE_ALPHA,
    );
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = THONG_TRIM;
    ctx.lineWidth = PANEL_EDGE_WIDTH;
    ctx.globalAlpha *= PANEL_EDGE_ALPHA;
    ctx.beginPath();
    tracePanel(ctx);
    ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = THONG_COLOR;
  ctx.beginPath();
  traceBand(ctx, back);
  ctx.fill();
  ctx.save();
  ctx.strokeStyle = THONG_TRIM;
  ctx.lineWidth = BAND_EDGE_WIDTH;
  ctx.globalAlpha *= BAND_EDGE_ALPHA;
  ctx.beginPath();
  for (let i = 0; i <= BAND_SAMPLES; i++) {
    const x = -BAND_HALF_SPAN + (2 * BAND_HALF_SPAN * i) / BAND_SAMPLES;
    const y = bandCenterY(x, back) - BAND_HALF_HEIGHT;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

/* ── Back ──────────────────────────────────────────────────────────────── */

const BLADE_X = 0.048;
const BLADE_TOP_Y = SHOULDER_Y + 0.03;
const BLADE_BOTTOM_Y = BUST_POINT_Y + 0.025;
const BLADE_FLARE = 0.02;
const BLADE_TIP_SHARE = 0.55;
const BLADE_LINE_WIDTH = 0.004;
const BLADE_ALPHA = 0.4;
const BLADE_LIGHT_RADIUS_X = 0.028;
const BLADE_LIGHT_RADIUS_Y = 0.03;
const BLADE_LIGHT_ALPHA = 0.6;
const SPINE_TOP_Y = SHOULDER_Y + 0.03;
const SPINE_WIDTH = 0.005;
const SPINE_ALPHA = 0.45;
/** The two long muscles either side of the spine, lit, with the groove between them. */
const ERECTOR_X = 0.016;
const ERECTOR_Y = WAIST_Y + 0.01;
const ERECTOR_RADIUS_X = 0.012;
const ERECTOR_RADIUS_Y = 0.05;
const ERECTOR_ALPHA = 0.55;
const DIMPLE_X = 0.026;
const DIMPLE_Y = HIP_Y - 0.026;
const DIMPLE_RADIUS = 0.0065;
const DIMPLE_ALPHA = 0.35;

/* ── Seat ──────────────────────────────────────────────────────────────── */

/**
 * Each cheek is a round, lifted mass: fullest high and toward the outside, its
 * lowest point tucked in near the cleft. Light from above catches the upper
 * outer dome; the underside turns away into a mid-tone core shadow with a band
 * of light bounced up off the thigh inside it; and the fold where it sits on
 * the thigh is one thin line that runs out from the cleft, lifts, and fades
 * before the flank.
 */
const CHEEK_CENTER_X = 0.048;
const CHEEK_CENTER_Y = HIP_Y + 0.05;
const CHEEK_RADIUS_X = 0.05;
const CHEEK_RADIUS_Y = 0.056;
const CHEEK_TILT = -0.22;
const CHEEK_HALF_SLIDE = 0.04;
const CHEEK_HALF_ALPHA = 0.75;
const CHEEK_CORE_SLIDE = 0.018;
const CHEEK_CORE_ALPHA = 0.55;
/** The light comes from up and a little outward on each cheek. */
const CHEEK_LIGHT_ANGLE = 0.38;
const CHEEK_HIGHLIGHT_X = 0.052;
const CHEEK_HIGHLIGHT_Y = HIP_Y + 0.032;
const CHEEK_HIGHLIGHT_RADIUS_X = 0.034;
const CHEEK_HIGHLIGHT_RADIUS_Y = 0.028;
const CHEEK_HIGHLIGHT_ALPHA = 0.78;
const FOLD_INNER_X = 0.006;
const FOLD_INNER_Y = SEAT_INNER_BOTTOM_Y - 0.003;
const FOLD_MID_X = 0.036;
const FOLD_MID_Y = SEAT_INNER_BOTTOM_Y + 0.004;
const FOLD_OUTER_X = 0.064;
const FOLD_OUTER_Y = SEAT_INNER_BOTTOM_Y - 0.006;
const FOLD_WIDTH = 0.0032;
const FOLD_FADE_IN = 0.1;
const FOLD_FADE_OUT = 0.55;
const FOLD_ALPHA = 0.85;
const THIGH_UNDER_FOLD_WIDTH = 0.016;
const THIGH_UNDER_FOLD_ALPHA = 0.45;
const CLEFT_TOP_Y = HIP_Y + 0.006;
const CLEFT_WIDTH = 0.0032;
const CLEFT_ALPHA = 0.9;
const CLEFT_SHADE_RADIUS_X = 0.009;
const CLEFT_SHADE_ALPHA = 0.4;

function pathCheek(ctx: Ctx, side: BodySide): void {
  ctx.ellipse(
    side * CHEEK_CENTER_X,
    CHEEK_CENTER_Y,
    CHEEK_RADIUS_X,
    CHEEK_RADIUS_Y,
    side * CHEEK_TILT,
    0,
    Math.PI * 2,
  );
}

function traceFold(ctx: Ctx, side: BodySide): void {
  ctx.moveTo(side * FOLD_INNER_X, FOLD_INNER_Y);
  ctx.quadraticCurveTo(side * FOLD_MID_X, FOLD_MID_Y + FOLD_SAG, side * FOLD_OUTER_X, FOLD_OUTER_Y);
}

function drawSeat(ctx: Ctx): void {
  for (const side of SIDES) {
    const lightX = side * Math.sin(CHEEK_LIGHT_ANGLE);
    const lightY = -Math.cos(CHEEK_LIGHT_ANGLE);
    ctx.save();
    ctx.beginPath();
    ctx.rect(side > 0 ? 0 : -1, -1, 1, 2);
    ctx.clip();
    ctx.beginPath();
    pathCheek(ctx, side);
    ctx.clip();
    fillSoftEllipse(
      ctx,
      side * CHEEK_HIGHLIGHT_X,
      CHEEK_HIGHLIGHT_Y,
      CHEEK_HIGHLIGHT_RADIUS_X,
      CHEEK_HIGHLIGHT_RADIUS_Y,
      SKIN_HIGHLIGHT,
      CHEEK_HIGHLIGHT_ALPHA,
      side * CHEEK_TILT,
    );
    fillCrescent(
      ctx,
      () => pathCheek(ctx, side),
      lightX * CHEEK_HALF_SLIDE,
      lightY * CHEEK_HALF_SLIDE,
      SKIN_SHADE,
      CHEEK_HALF_ALPHA,
    );
    fillCrescent(
      ctx,
      () => pathCheek(ctx, side),
      lightX * CHEEK_CORE_SLIDE,
      lightY * CHEEK_CORE_SLIDE,
      SKIN_DEEP_SHADE,
      CHEEK_CORE_ALPHA,
    );
    ctx.restore();
  }

  for (const side of SIDES) {
    fillSoftEllipse(
      ctx,
      side * DIMPLE_X,
      DIMPLE_Y,
      DIMPLE_RADIUS,
      DIMPLE_RADIUS,
      SKIN_SHADE,
      DIMPLE_ALPHA,
      0,
      DIMPLE_CORE_FRACTION,
    );
  }
  fillSoftEllipse(
    ctx,
    0,
    (CLEFT_TOP_Y + SEAT_NOTCH_Y) / 2 + CLEFT_SHADE_DROP,
    CLEFT_SHADE_RADIUS_X,
    (SEAT_NOTCH_Y - CLEFT_TOP_Y) / 2,
    SKIN_HALF,
    CLEFT_SHADE_ALPHA,
  );
  const cleft = ctx.createLinearGradient(0, CLEFT_TOP_Y, 0, SEAT_NOTCH_Y);
  cleft.addColorStop(0, rgba(SKIN_CREASE, 0));
  cleft.addColorStop(CLEFT_FADE_STOP, SKIN_CREASE);
  cleft.addColorStop(1, SKIN_CREASE);
  strokeSoftCrease(
    ctx,
    CLEFT_WIDTH,
    cleft,
    () => {
      ctx.moveTo(0, CLEFT_TOP_Y);
      ctx.lineTo(0, SEAT_NOTCH_Y);
    },
    CLEFT_ALPHA,
    TIGHT_LAYERS,
  );

  for (const side of SIDES) {
    const fold = taperedCreaseGradient(
      ctx,
      side * FOLD_INNER_X,
      FOLD_INNER_Y,
      side * FOLD_OUTER_X,
      FOLD_OUTER_Y,
      SKIN_CREASE,
      FOLD_FADE_IN,
      FOLD_FADE_OUT,
    );
    strokeSoftCrease(ctx, FOLD_WIDTH, fold, () => traceFold(ctx, side), FOLD_ALPHA, TIGHT_LAYERS);
  }
}

/** The thigh just below each fold, in the cheek's shadow. Drawn outside the torso. */
function drawUnderSeat(ctx: Ctx, traceTorso: () => void): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(-1, -1, 2, 2);
  traceTorso();
  ctx.clip('evenodd');
  ctx.globalAlpha *= THIGH_UNDER_FOLD_ALPHA;
  ctx.lineWidth = THIGH_UNDER_FOLD_WIDTH;
  ctx.lineCap = 'round';
  for (const side of SIDES) {
    ctx.strokeStyle = taperedCreaseGradient(
      ctx,
      side * FOLD_INNER_X,
      FOLD_INNER_Y,
      side * FOLD_OUTER_X,
      FOLD_OUTER_Y,
      SKIN_SHADE,
      FOLD_FADE_IN,
      FOLD_FADE_OUT,
    );
    ctx.beginPath();
    traceFold(ctx, side);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBack(ctx: Ctx): void {
  for (const side of SIDES) {
    fillSoftEllipse(
      ctx,
      side * BLADE_X,
      (BLADE_TOP_Y + BLADE_BOTTOM_Y) / 2 - BLADE_LIGHT_RISE,
      BLADE_LIGHT_RADIUS_X,
      BLADE_LIGHT_RADIUS_Y,
      SKIN_HIGHLIGHT,
      BLADE_LIGHT_ALPHA * (side > 0 ? 1 : SHADOW_SIDE_LIGHT_SHARE),
    );
    const blade = taperedCreaseGradient(
      ctx,
      side * BLADE_X,
      BLADE_TOP_Y,
      side * BLADE_X * BLADE_TIP_SHARE,
      BLADE_BOTTOM_Y,
      SKIN_SHADE,
      BLADE_FADE_STOP,
    );
    strokeSoftCrease(
      ctx,
      BLADE_LINE_WIDTH,
      blade,
      () => {
        ctx.moveTo(side * BLADE_X, BLADE_TOP_Y);
        ctx.quadraticCurveTo(
          side * (BLADE_X + BLADE_FLARE),
          (BLADE_TOP_Y + BLADE_BOTTOM_Y) / 2,
          side * BLADE_X * BLADE_TIP_SHARE,
          BLADE_BOTTOM_Y,
        );
      },
      BLADE_ALPHA,
      TIGHT_LAYERS,
    );
    fillSoftEllipse(
      ctx,
      side * ERECTOR_X,
      ERECTOR_Y,
      ERECTOR_RADIUS_X,
      ERECTOR_RADIUS_Y,
      SKIN_HIGHLIGHT,
      ERECTOR_ALPHA * (side > 0 ? 1 : SHADOW_SIDE_LIGHT_SHARE),
    );
  }
  const spine = ctx.createLinearGradient(0, SPINE_TOP_Y, 0, HIP_Y);
  spine.addColorStop(0, rgba(SKIN_HALF, 0));
  spine.addColorStop(SPINE_FADE_STOP, SKIN_HALF);
  spine.addColorStop(1, SKIN_SHADE);
  ctx.save();
  ctx.globalAlpha *= SPINE_ALPHA;
  ctx.strokeStyle = spine;
  ctx.lineWidth = SPINE_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, SPINE_TOP_Y);
  ctx.lineTo(0, SPINE_BOTTOM_Y);
  ctx.stroke();
  ctx.restore();
}

/* ── Bra ───────────────────────────────────────────────────────────────── */

/**
 * A black bra: two cups over the lower two-thirds of each breast, a narrow
 * centre gore between them, a band under the bust round the ribs, and a strap
 * from each cup's outer top over the shoulder. The cup is the breast's own
 * form, a little proud of it, cut across the top by the neckline — so it rides
 * every turn of the chest the breast does and can never slide off it.
 */
const CUP_PROUD_SHARE = 1.08;
/** The neckline across each cup, inner end low by the gore and outer end high under the strap. */
const CUP_INNER_TOP: Pt2 = { x: 0.007, y: BUST_POINT_Y - 0.004 };
const CUP_OUTER_TOP: Pt2 = { x: 0.074, y: BUST_POINT_Y - 0.036 };
/** The neckline dips between its ends, following the breast's own curve. */
const CUP_NECKLINE_SAG = 0.008;
const CUP_SHEEN_X = BUST_POINT_X * 1.25;
const CUP_SHEEN_Y = BUST_POINT_Y - 0.004;
const CUP_SHEEN_RADIUS_X = 0.022;
const CUP_SHEEN_RADIUS_Y = 0.016;
const CUP_SHEEN_ALPHA = 0.85;
/** The underside of each cup turns from the light into a near-black core. */
const CUP_SHADOW_SLIDE_Y = -0.02;
const CUP_SHADOW_ALPHA = 0.9;
const CUP_TRIM_WIDTH = 0.004;
const GORE_HALF_WIDTH = 0.007;
const BAND_TOP_Y = BUST_POINT_Y + 0.03;
const BAND_HEIGHT = 0.014;
/** The band runs past the torso's edge so the clip, not a guess, ends it at the flank. */
const BAND_HALF_SPAN_PAST = 0.14;
const STRAP_WIDTH = 0.008;
const STRAP_TOP: Pt2 = { x: 0.062, y: SHOULDER_Y - 0.006 };
/** From behind: the band crosses the back at the shoulder blades' lower tips, straps rise to the shoulders. */
const BACK_BAND_TOP_Y = BUST_POINT_Y + 0.016;
const BACK_BAND_HEIGHT = 0.022;
const BACK_STRAP_BOTTOM_X = 0.05;
const BACK_STRAP_TOP_X = 0.058;
const CLASP_HALF_WIDTH = 0.008;
const CLASP_ALPHA = 0.8;

function pathCup(ctx: Ctx, side: BodySide): void {
  ctx.ellipse(
    side * BREAST_CENTER_X,
    BREAST_CENTER_Y,
    BREAST_RADIUS_X * CUP_PROUD_SHARE,
    BREAST_RADIUS_Y * CUP_PROUD_SHARE,
    side * BREAST_TILT,
    0,
    Math.PI * 2,
  );
}

/** The region under one cup's neckline: everything below the line from its inner to its outer top. */
function pathUnderNeckline(ctx: Ctx, side: BodySide): void {
  const far = 1;
  const midX = (side * (CUP_INNER_TOP.x + CUP_OUTER_TOP.x)) / 2;
  const midY = (CUP_INNER_TOP.y + CUP_OUTER_TOP.y) / 2 + CUP_NECKLINE_SAG;
  ctx.moveTo(side * CUP_INNER_TOP.x, CUP_INNER_TOP.y);
  ctx.quadraticCurveTo(midX, midY, side * CUP_OUTER_TOP.x, CUP_OUTER_TOP.y);
  ctx.lineTo(side * far, CUP_OUTER_TOP.y);
  ctx.lineTo(side * far, far);
  ctx.lineTo(side * CUP_INNER_TOP.x, far);
  ctx.closePath();
}

function drawCup(ctx: Ctx, side: BodySide): void {
  ctx.save();
  ctx.beginPath();
  pathUnderNeckline(ctx, side);
  ctx.clip();
  ctx.beginPath();
  pathCup(ctx, side);
  ctx.fillStyle = BRA_COLOR;
  ctx.fill();
  ctx.clip();
  fillCrescent(ctx, () => pathCup(ctx, side), 0, CUP_SHADOW_SLIDE_Y, BRA_SHADOW, CUP_SHADOW_ALPHA);
  fillSoftEllipse(
    ctx,
    side * CUP_SHEEN_X + LIT_SIDE_NUDGE,
    CUP_SHEEN_Y,
    CUP_SHEEN_RADIUS_X,
    CUP_SHEEN_RADIUS_Y,
    BRA_SHEEN,
    CUP_SHEEN_ALPHA * (side > 0 ? 1 : SHADOW_SIDE_LIGHT_SHARE),
    side * BREAST_TILT,
  );
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  pathCup(ctx, side);
  ctx.clip();
  ctx.strokeStyle = BRA_TRIM;
  ctx.lineWidth = CUP_TRIM_WIDTH;
  ctx.lineCap = 'round';
  const midX = (side * (CUP_INNER_TOP.x + CUP_OUTER_TOP.x)) / 2;
  const midY = (CUP_INNER_TOP.y + CUP_OUTER_TOP.y) / 2 + CUP_NECKLINE_SAG;
  ctx.beginPath();
  ctx.moveTo(side * CUP_INNER_TOP.x, CUP_INNER_TOP.y);
  ctx.quadraticCurveTo(midX, midY, side * CUP_OUTER_TOP.x, CUP_OUTER_TOP.y);
  ctx.stroke();
  ctx.restore();
}

function drawBraFront(ctx: Ctx): void {
  ctx.fillStyle = BRA_COLOR;
  ctx.fillRect(-BAND_HALF_SPAN_PAST, BAND_TOP_Y, BAND_HALF_SPAN_PAST * 2, BAND_HEIGHT);
  ctx.beginPath();
  ctx.moveTo(-GORE_HALF_WIDTH, CUP_INNER_TOP.y);
  ctx.lineTo(GORE_HALF_WIDTH, CUP_INNER_TOP.y);
  ctx.lineTo(GORE_HALF_WIDTH, BAND_TOP_Y + BAND_HEIGHT);
  ctx.lineTo(-GORE_HALF_WIDTH, BAND_TOP_Y + BAND_HEIGHT);
  ctx.closePath();
  ctx.fill();
  for (const side of SIDES) drawCup(ctx, side);
  ctx.strokeStyle = BRA_COLOR;
  ctx.lineWidth = STRAP_WIDTH;
  ctx.lineCap = 'butt';
  for (const side of SIDES) {
    ctx.beginPath();
    ctx.moveTo(side * CUP_OUTER_TOP.x, CUP_OUTER_TOP.y);
    ctx.lineTo(side * STRAP_TOP.x, STRAP_TOP.y);
    ctx.stroke();
  }
}

function drawBraBack(ctx: Ctx): void {
  ctx.fillStyle = BRA_COLOR;
  ctx.fillRect(-BAND_HALF_SPAN_PAST, BACK_BAND_TOP_Y, BAND_HALF_SPAN_PAST * 2, BACK_BAND_HEIGHT);
  ctx.strokeStyle = BRA_COLOR;
  ctx.lineWidth = STRAP_WIDTH;
  ctx.lineCap = 'butt';
  for (const side of SIDES) {
    ctx.beginPath();
    ctx.moveTo(side * BACK_STRAP_BOTTOM_X, BACK_BAND_TOP_Y);
    ctx.lineTo(side * BACK_STRAP_TOP_X, STRAP_TOP.y);
    ctx.stroke();
  }
  ctx.save();
  ctx.globalAlpha *= CLASP_ALPHA;
  ctx.fillStyle = BRA_TRIM;
  ctx.fillRect(-CLASP_HALF_WIDTH, BACK_BAND_TOP_Y, CLASP_HALF_WIDTH * 2, BACK_BAND_HEIGHT);
  ctx.restore();
}

/* ── Paint ─────────────────────────────────────────────────────────────── */

export interface TorsoPaint {
  ctx: Ctx;
  back: boolean;
}

function onSectionOf(ctx: Ctx, warp: TorsoWarp): (y: number, paint: () => void) => void {
  return (y, paint) => {
    ctx.save();
    onTorsoAt(ctx, warp, y);
    paint();
    ctx.restore();
  };
}

/**
 * The torso's fill and its own modelling. Its outline is shaded with the legs
 * as one silhouette afterwards; returns the outline's trace for that pass.
 */
export function drawTorso(tp: TorsoPaint, warp: TorsoWarp): (target: Ctx) => void {
  const { ctx, back } = tp;
  const traceInto = (target: Ctx): void => pathTorso(warpSink(target, warp), back);
  const onSection = onSectionOf(ctx, warp);

  ctx.save();
  ctx.fillStyle = SKIN_LIT;
  ctx.beginPath();
  traceInto(ctx);
  ctx.fill();
  ctx.clip();
  if (back) {
    onSection(SHOULDER_Y, () => drawBack(ctx));
    onSection(HIP_Y, () => drawSeat(ctx));
  } else {
    onSection(BUST_POINT_Y, () => drawBust(ctx));
    onSection(WAIST_Y, () => drawAbdomen(ctx));
    onSection(HIP_Y, () => drawPelvisFront(ctx));
  }
  ctx.restore();
  return traceInto;
}

/** The bra and the thong, laid on after the silhouette is shaded so the shading never greys them. */
export function drawTorsoDetails(tp: TorsoPaint, warp: TorsoWarp): void {
  const { ctx, back } = tp;
  const onSection = onSectionOf(ctx, warp);
  ctx.save();
  ctx.beginPath();
  pathTorso(warpSink(ctx, warp), back);
  ctx.clip();
  onSection(HIP_Y, () => drawThong(ctx, back));
  onSection(BUST_POINT_Y, () => (back ? drawBraBack(ctx) : drawBraFront(ctx)));
  ctx.restore();

  if (back) {
    onSection(HIP_Y, () => drawUnderSeat(ctx, () => pathTorso(ctx, true)));
  } else {
    onSection(HIP_Y, () => drawInguinalFolds(ctx));
  }
}
