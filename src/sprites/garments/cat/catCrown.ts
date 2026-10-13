/**
 * The Enchanted Crown of the Sepsis Whore on Donut: a small gold crown of
 * three points with a blood-red stone, sitting on the top of her head between
 * her ears. Painted once the whole head is on, so it sits over the roots of
 * her ears the way a crown worn between them would.
 *
 * At her in-game size it is about five pixels wide and three tall, so it is
 * three points and a band, filled in hard gold bands with a glint: anything
 * finer turns to a yellow smudge.
 */

import type { CatHeadFrame, CatHeadLandmarks } from '../../art/catParts';
import { CAT_VIEW_FALLBACK } from '../../catViews';
import { defineGarment, type GarmentFrameContext, withViewFallback } from '../garmentDef';
import { lyingTipBack } from './headwear';
import { GOLD, metalFill, paintGlint } from './metalInk';

type Ctx = CanvasRenderingContext2D;

const GEM = '#b3123a';
const GEM_DEEP = '#5e0619';
const GEM_GLINT = '#ffd0dc';

/** The crown's half-width and height, head-on, in head units. */
const HALF_WIDTH = 0.13;
const BAND_HEIGHT = 0.05;
const POINT_HEIGHT = 0.1;
/** The middle point stands this much taller than the outer two. */
const MIDDLE_POINT_GAIN = 1.25;
/** How far below the top of her skull the band's lower edge sits, so it rests on her head. */
const SEAT_DEPTH = 0.02;
/** How far the band's lower edge sags at its middle: the curve that says it goes round her head. */
const BAND_SAG = 0.018;
/** How far a turned head slides the crown across the skull, head-on. */
const TURN_SLIDE = 0.04;
const TIP_RADIUS = 0.016;
const GEM_RADIUS_X = 0.024;
const GEM_RADIUS_Y = 0.018;
const GEM_GLINT_RADIUS = 0.007;
const GLINT_REACH = 0.03;
/**
 * From behind it is narrower, sitting clear between her ears: the backs of
 * her ears are dark, and their tips between the crown's points broke it up
 * into a dark-and-gold fringe.
 */
const BACK_HALF_WIDTH = 0.12;
/** The glint sits on the lit side of the band, at the foot of the left point. */
const GLINT_ACROSS = 0.55;
const GLINT_UP = 0.15;
/** The lower share of the band that sits in its own shadow where it meets her fur. */
const RIM_SHARE = 0.35;
/** The stone's lit face, up toward the light, and the glint on it. */
const GEM_FACE_OFFSET = 0.2;
const GEM_FACE_SHARE = 0.7;
const GEM_GLINT_OFFSET = 0.4;
const FULL_TURN = Math.PI * 2;

/** In profile the band is seen end-on across her head, so it is narrower. */
const PROFILE_WIDTH_SHARE = 0.78;
/** In profile the near point stands in front of the middle one, and the far one is half hidden. */
const PROFILE_TILT = -0.12;

interface CrownLook {
  readonly cx: number;
  readonly seatY: number;
  readonly halfWidth: number;
  readonly showGem: boolean;
  /** The key light reaches the side of the crown the camera sees: not from behind. */
  readonly lit: boolean;
}

function crownOutline(ctx: Ctx, look: CrownLook): void {
  const { cx, seatY, halfWidth } = look;
  const bandTop = seatY - BAND_HEIGHT;
  const outerTip = bandTop - POINT_HEIGHT;
  const middleTip = bandTop - POINT_HEIGHT * MIDDLE_POINT_GAIN;
  const left = cx - halfWidth;
  const right = cx + halfWidth;
  const quarter = halfWidth / 2;
  ctx.beginPath();
  ctx.moveTo(left, seatY);
  ctx.lineTo(left, outerTip);
  ctx.lineTo(cx - quarter, bandTop);
  ctx.lineTo(cx, middleTip);
  ctx.lineTo(cx + quarter, bandTop);
  ctx.lineTo(right, outerTip);
  ctx.lineTo(right, seatY);
  ctx.quadraticCurveTo(cx, seatY + BAND_SAG * 2, left, seatY);
  ctx.closePath();
}

function paintCrown(ctx: Ctx, look: CrownLook): void {
  const { cx, seatY, halfWidth } = look;
  const bandTop = seatY - BAND_HEIGHT;
  const top = bandTop - POINT_HEIGHT * MIDDLE_POINT_GAIN;

  crownOutline(ctx, look);
  ctx.fillStyle = metalFill(ctx, GOLD, cx - halfWidth, top, cx + halfWidth, seatY + BAND_SAG);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(cx - halfWidth, seatY - BAND_HEIGHT * RIM_SHARE);
  ctx.quadraticCurveTo(
    cx,
    seatY - BAND_HEIGHT * RIM_SHARE + BAND_SAG * 2,
    cx + halfWidth,
    seatY - BAND_HEIGHT * RIM_SHARE,
  );
  ctx.lineTo(cx + halfWidth, seatY);
  ctx.quadraticCurveTo(cx, seatY + BAND_SAG * 2, cx - halfWidth, seatY);
  ctx.closePath();
  ctx.fillStyle = GOLD.shadow;
  ctx.fill();

  for (const [x, y] of [
    [cx - halfWidth, bandTop - POINT_HEIGHT],
    [cx, top],
    [cx + halfWidth, bandTop - POINT_HEIGHT],
  ]) {
    ctx.beginPath();
    ctx.arc(x, y, TIP_RADIUS, 0, FULL_TURN);
    ctx.fillStyle = GOLD.glint;
    ctx.fill();
  }

  if (look.showGem) {
    const gemY = seatY - BAND_HEIGHT / 2 + BAND_SAG;
    ctx.beginPath();
    ctx.ellipse(cx, gemY, GEM_RADIUS_X, GEM_RADIUS_Y, 0, 0, FULL_TURN);
    ctx.fillStyle = GEM_DEEP;
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(
      cx - GEM_RADIUS_X * GEM_FACE_OFFSET,
      gemY - GEM_RADIUS_Y * GEM_FACE_OFFSET,
      GEM_RADIUS_X * GEM_FACE_SHARE,
      GEM_RADIUS_Y * GEM_FACE_SHARE,
      0,
      0,
      FULL_TURN,
    );
    ctx.fillStyle = GEM;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(
      cx - GEM_RADIUS_X * GEM_GLINT_OFFSET,
      gemY - GEM_RADIUS_Y * GEM_GLINT_OFFSET,
      GEM_GLINT_RADIUS,
      0,
      FULL_TURN,
    );
    ctx.fillStyle = GEM_GLINT;
    ctx.fill();
  }

  if (look.lit) {
    paintGlint(
      ctx,
      GOLD,
      cx - halfWidth * GLINT_ACROSS,
      bandTop - POINT_HEIGHT * GLINT_UP,
      GLINT_REACH,
    );
  }
}

function seatOf(landmarks: CatHeadLandmarks): number {
  return landmarks.skull.cy - landmarks.skull.ry + SEAT_DEPTH;
}

function headOn(fromBehind: boolean) {
  return (ctx: Ctx, frame: CatHeadFrame): void => {
    if (frame.piece !== 'top') return;
    const { landmarks } = frame;
    ctx.save();
    paintCrown(ctx, {
      cx: landmarks.skull.cx + landmarks.turn * TURN_SLIDE,
      seatY: seatOf(landmarks),
      halfWidth: fromBehind ? BACK_HALF_WIDTH : HALF_WIDTH,
      showGem: !fromBehind,
      lit: !fromBehind,
    });
    ctx.restore();
  };
}

function paintProfile(ctx: Ctx, frame: CatHeadFrame, context: GarmentFrameContext<'cat'>): void {
  if (frame.piece !== 'top') return;
  const { landmarks } = frame;
  const cx = landmarks.skull.cx;
  const seatY = seatOf(landmarks);
  ctx.save();
  ctx.translate(cx, seatY);
  ctx.rotate(PROFILE_TILT - lyingTipBack(context));
  ctx.translate(-cx, -seatY);
  paintCrown(ctx, {
    cx,
    seatY,
    halfWidth: HALF_WIDTH * PROFILE_WIDTH_SHARE,
    showGem: false,
    lit: true,
  });
  ctx.restore();
}

export const CAT_CROWN = defineGarment({
  id: 'cat_crown',
  name: 'Crown of the Sepsis Whore',
  wearer: 'cat',
  material: 'jewelry',
  layer: 'outer',
  region: ['head'],
  paint: {
    head: withViewFallback(
      { front: headOn(false), side: paintProfile, back: headOn(true) },
      CAT_VIEW_FALLBACK,
    ),
  },
});
