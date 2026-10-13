/**
 * The Enchanted Crown of the Sepsis Whore on Carl: the same small gold crown
 * Donut wears — three points, a blood-red stone, pale lemony gold — sized for
 * a man's head and sitting on top of his hair.
 *
 * At his in-game size it is about six pixels wide and four tall, so like hers
 * it is three points and a band in hard gold bands with a glint.
 */

import { pitchedHairY } from '../../art/carl/head';
import type { CarlHeadFrame } from '../../art/carl/carlParts';
import { HEAD_DEPTH, HEAD_RX, HEAD_RY } from '../../art/carl/proportions';
import { GOLD, metalFill, paintGlint } from '../cat/metalInk';
import { defineGarment } from '../garmentDef';
import { carlViews } from './views';

type Ctx = CanvasRenderingContext2D;

const GEM = '#b3123a';
const GEM_DEEP = '#5e0619';
const GEM_GLINT = '#ffd0dc';

/** The crown's half-width head-on, against the head's half-width. */
const HALF_WIDTH = HEAD_RX * 0.8;
const BAND_HEIGHT = HEAD_RY * 0.24;
const POINT_HEIGHT = HEAD_RY * 0.36;
/** The middle point stands this much taller than the outer two. */
const MIDDLE_POINT_GAIN = 1.25;
/**
 * The crown is a ring seen a little from above, so its rim is an ellipse this
 * deep: the front of the band dips toward the brow and the far wall shows
 * between the points. Drawn flat it read as a sticker on his hair.
 */
const RING_DEPTH = HEAD_RY * 0.13;
/**
 * Where the ring's sides sit, down from the head's centre. Low enough that
 * the band's corners rest in the crop where the top of the hair rounds off,
 * rather than overhanging it.
 */
const SEAT_Y = -HEAD_RY * 1.1;
/** How far a turned head slides the crown across the skull, head-on. */
const TURN_SLIDE = HEAD_RX * 0.2;
const TIP_RADIUS = HEAD_RY * 0.045;
const GEM_RADIUS_X = HEAD_RX * 0.17;
const GEM_RADIUS_Y = HEAD_RY * 0.085;
const GEM_GLINT_RADIUS = HEAD_RY * 0.03;
const GLINT_REACH = HEAD_RY * 0.12;
/** The glint sits on the lit side of the band, at the foot of the left point. */
const GLINT_ACROSS = 0.55;
const GLINT_UP = 0.15;
/** The far wall's inside faces the camera but is turned from the light. */
const FAR_WALL = GOLD.shadow;
const FAR_WALL_LIP = GOLD.base;
/** The lower share of the band that sits in its own shadow where it meets his hair. */
const RIM_SHARE = 0.35;
/** The stone's lit face, up toward the light, and the glint on it. */
const GEM_FACE_OFFSET = 0.2;
const GEM_FACE_SHARE = 0.7;
const GEM_GLINT_OFFSET = 0.4;
/** The stone sits a little under halfway down the band's front face. */
const GEM_DOWN_BAND = 0.45;
const FAR_WALL_LIP_WIDTH = HEAD_RY * 0.03;
const FULL_TURN = Math.PI * 2;

/** In profile the band is seen end-on across his head, so it is narrower. */
const PROFILE_HALF_WIDTH = HEAD_DEPTH * 0.7;
/** In profile his crop is swept up at the front, so the crown sits back of its peak. */
const PROFILE_CX = -HEAD_DEPTH * 0.12;
/** In profile the crown tips back on his skull, the way a crown worn on hair does. */
const PROFILE_TILT = -0.12;

interface CrownLook {
  readonly cx: number;
  readonly seatY: number;
  readonly halfWidth: number;
  readonly showGem: boolean;
  /** The key light reaches the side of the crown the camera sees: not from behind. */
  readonly lit: boolean;
}

/** Where the top of the band's front face is, `x` across from the ring's centre. */
function frontTopY(look: CrownLook, x: number): number {
  const across = Math.min(1, Math.abs(x - look.cx) / look.halfWidth);
  return look.seatY - BAND_HEIGHT + RING_DEPTH * Math.sqrt(1 - across * across);
}

/** The near half of the ring at height `y`, from its right end round the front to its left. */
function nearArc(ctx: Ctx, look: CrownLook, y: number): void {
  ctx.ellipse(look.cx, y, look.halfWidth, RING_DEPTH, 0, 0, Math.PI);
}

function traceFront(ctx: Ctx, look: CrownLook): void {
  const { cx, seatY, halfWidth } = look;
  const left = cx - halfWidth;
  const right = cx + halfWidth;
  const quarter = halfWidth / 2;
  const sideTop = seatY - BAND_HEIGHT;
  ctx.beginPath();
  ctx.moveTo(left, seatY);
  ctx.lineTo(left, sideTop - POINT_HEIGHT);
  ctx.lineTo(cx - quarter, frontTopY(look, cx - quarter));
  ctx.lineTo(cx, frontTopY(look, cx) - POINT_HEIGHT * MIDDLE_POINT_GAIN);
  ctx.lineTo(cx + quarter, frontTopY(look, cx + quarter));
  ctx.lineTo(right, sideTop - POINT_HEIGHT);
  ctx.lineTo(right, seatY);
  nearArc(ctx, look, seatY);
  ctx.closePath();
}

/** The inside of the band's far half, seen over the near half between the points. */
function paintFarWall(ctx: Ctx, look: CrownLook): void {
  const { cx, seatY, halfWidth } = look;
  const rimY = seatY - BAND_HEIGHT;
  ctx.beginPath();
  ctx.ellipse(cx, rimY, halfWidth, RING_DEPTH, 0, Math.PI, FULL_TURN);
  ctx.ellipse(cx, seatY, halfWidth, RING_DEPTH, 0, 0, Math.PI, true);
  ctx.closePath();
  ctx.fillStyle = FAR_WALL;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, rimY, halfWidth, RING_DEPTH, 0, Math.PI, FULL_TURN);
  ctx.strokeStyle = FAR_WALL_LIP;
  ctx.lineWidth = FAR_WALL_LIP_WIDTH;
  ctx.stroke();
}

function paintGem(ctx: Ctx, cx: number, gemY: number): void {
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

function paintCrown(ctx: Ctx, look: CrownLook): void {
  const { cx, seatY, halfWidth } = look;
  const sideTop = seatY - BAND_HEIGHT;
  const middleTipY = frontTopY(look, cx) - POINT_HEIGHT * MIDDLE_POINT_GAIN;
  const outerTipY = sideTop - POINT_HEIGHT;

  paintFarWall(ctx, look);

  traceFront(ctx, look);
  ctx.fillStyle = metalFill(
    ctx,
    GOLD,
    cx - halfWidth,
    middleTipY,
    cx + halfWidth,
    seatY + RING_DEPTH,
  );
  ctx.fill();

  const rimTop = seatY - BAND_HEIGHT * RIM_SHARE;
  ctx.beginPath();
  ctx.moveTo(cx + halfWidth, rimTop);
  nearArc(ctx, look, rimTop);
  ctx.lineTo(cx - halfWidth, seatY);
  ctx.ellipse(cx, seatY, halfWidth, RING_DEPTH, 0, Math.PI, 0, true);
  ctx.closePath();
  ctx.fillStyle = GOLD.shadow;
  ctx.fill();

  for (const [x, y] of [
    [cx - halfWidth, outerTipY],
    [cx, middleTipY],
    [cx + halfWidth, outerTipY],
  ]) {
    ctx.beginPath();
    ctx.arc(x, y, TIP_RADIUS, 0, FULL_TURN);
    ctx.fillStyle = GOLD.glint;
    ctx.fill();
  }

  if (look.showGem) paintGem(ctx, cx, frontTopY(look, cx) + BAND_HEIGHT * GEM_DOWN_BAND);

  if (look.lit) {
    const glintX = cx - halfWidth * GLINT_ACROSS;
    paintGlint(ctx, GOLD, glintX, frontTopY(look, glintX) - POINT_HEIGHT * GLINT_UP, GLINT_REACH);
  }
}

/** Where the band rests head-on, once the crop has been pitched with the head. */
function pitchedSeat(lift: number): number {
  return pitchedHairY(SEAT_Y, lift);
}

function headOn(fromBehind: boolean) {
  return (ctx: Ctx, frame: CarlHeadFrame): void => {
    const turn = fromBehind ? 0 : frame.pose.headTurn;
    const lift = fromBehind ? 0 : (frame.pose.chinLift ?? 0);
    ctx.save();
    paintCrown(ctx, {
      cx: turn * TURN_SLIDE,
      seatY: pitchedSeat(lift),
      halfWidth: HALF_WIDTH,
      showGem: !fromBehind,
      lit: !fromBehind,
    });
    ctx.restore();
  };
}

function paintProfile(ctx: Ctx): void {
  ctx.save();
  ctx.translate(PROFILE_CX, SEAT_Y);
  ctx.rotate(PROFILE_TILT);
  paintCrown(ctx, {
    cx: 0,
    seatY: 0,
    halfWidth: PROFILE_HALF_WIDTH,
    showGem: false,
    lit: true,
  });
  ctx.restore();
}

export const CARL_CROWN = defineGarment({
  id: 'carl_crown',
  name: 'Crown of the Sepsis Whore',
  wearer: 'human',
  material: 'jewelry',
  layer: 'outer',
  region: ['head'],
  paint: { head: carlViews({ front: headOn(false), side: paintProfile, back: headOn(true) }) },
});
