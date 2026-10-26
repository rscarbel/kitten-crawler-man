/**
 * The Showman's Top Hat on the human crawler: a tall red top hat with a gold
 * band, worn low on his brow at a slight tilt, its crown still dented where a
 * lion sat on it. At the tile it is a red column standing on his head with a
 * gold stripe and a dark brim line; the height and the flat top are the read.
 */

import type { CardinalView } from '../../facingView';
import { type FabricRamp, fabricFill } from '../cat/clothInk';
import { GOLD, metalFill } from '../cat/metalInk';
import { defineGarment } from '../garmentDef';
import { hatUnits, hatViews, type Units } from './headwear';

type Ctx = CanvasRenderingContext2D;

const HALF_TURN = Math.PI;
const FULL_TURN = Math.PI * 2;

/** The cat's hat's red, so the two crawlers' hats are one hat. */
const SHOW_RED: FabricRamp = {
  shadow: '#5a0a12',
  base: '#c4182a',
  light: '#f2525a',
  edge: '#2a0408',
};
const BRIM_UNDERSIDE = '#1e0306';
const DENT_SHADOW = 'rgba(40,4,8,0.55)';
const BAND_SEAM = '#3a2404';

/**
 * Where the brim sits, in head radii: low on the forehead, clear of the brows,
 * so the crown takes in all of his crop above it.
 */
const BRIM_Y = -0.74;
/**
 * The brim's half-width, as a share of the head's: it stands out past the
 * temples but stays inside the hat allowance's margin round the skull.
 */
const BRIM_HALF_WIDTH = 1.54;
/**
 * Edge-on the hat sits back of the skull's centre, so a brim as wide as the
 * head-on one would stand past the back of his head further than the hat
 * allowance's margin; it is held to the depth the back of the skull allows.
 */
const PROFILE_BRIM_HALF_WIDTH = 1.25;
/** The brim is seen a little from above, so its circle flattens to this depth. */
const BRIM_HALF_DEPTH = 0.28;
const BRIM_LIP = 0.1;
/** The crown is wider than his crop at its base and flares a little toward its top. */
const CROWN_BASE_HALF_WIDTH = 1.12;
const CROWN_TOP_HALF_WIDTH = 1.2;
/** How far above the eye line the crown's top sits: tall enough to read as a top hat. */
const CROWN_TOP_Y = -2.42;
const CROWN_TOP_DEPTH = 0.16;
const BAND_HEIGHT = 0.36;
const BAND_SEAM_WIDTH = 0.014;
const BRIM_EDGE_WIDTH = 0.026;
/** The dent is a notch out of the crown's top, on the side the lion sat. */
const DENT_ACROSS = -0.42;
const DENT_HALF_WIDTH = 0.34;
const DENT_DEPTH = 0.26;
/** A crease runs down from the dent, where the felt was folded. */
const DENT_CREASE_DROP = 0.24;
const DENT_CREASE_WIDTH = 0.018;
/** Head-on the hat leans off true toward screen right; edge-on it tips back. */
const HEAD_ON_TILT = 0.07;
const PROFILE_TILT = -0.08;
/** Edge-on his swept front sits forward of the skull's centre, so the hat sits back of it to cover the back of the crop too. */
const PROFILE_CX = -0.14;

/** The fill's key light from the left, its shadow to the right. */
const LIGHT_ACROSS = -1.3;
const SHADOW_ACROSS = 1.3;

interface HatShape {
  readonly units: Units;
  readonly cx: number;
  /** The dent's side, +1 toward screen right. */
  readonly dentSide: number;
  readonly brimHalfWidth: number;
}

function ellipseAt(
  ctx: Ctx,
  shape: HatShape,
  cy: number,
  halfWidth: number,
  halfDepth: number,
  from: number,
  to: number,
): void {
  const { units, cx } = shape;
  ctx.ellipse(cx * units.x, cy * units.y, halfWidth * units.x, halfDepth * units.y, 0, from, to);
}

function redFill(ctx: Ctx, shape: HatShape): CanvasGradient {
  const { units, cx } = shape;
  return fabricFill(
    ctx,
    SHOW_RED,
    { x: (cx + LIGHT_ACROSS) * units.x, y: 0 },
    { x: (cx + SHADOW_ACROSS) * units.x, y: 0 },
  );
}

function paintBrim(ctx: Ctx, shape: HatShape): void {
  ctx.beginPath();
  ellipseAt(ctx, shape, BRIM_Y + BRIM_LIP, shape.brimHalfWidth, BRIM_HALF_DEPTH, 0, FULL_TURN);
  ctx.fillStyle = BRIM_UNDERSIDE;
  ctx.fill();
  ctx.beginPath();
  ellipseAt(ctx, shape, BRIM_Y, shape.brimHalfWidth, BRIM_HALF_DEPTH, 0, FULL_TURN);
  ctx.fillStyle = redFill(ctx, shape);
  ctx.fill();
}

/** The crown's foot meets the brim on an ellipse as flat as the brim's, scaled to the crown. */
const CROWN_BASE_DEPTH = (BRIM_HALF_DEPTH * CROWN_BASE_HALF_WIDTH) / BRIM_HALF_WIDTH;

function traceCrown(ctx: Ctx, shape: HatShape): void {
  const { units, cx, dentSide } = shape;
  const x = (share: number): number => (cx + share) * units.x;
  const dentX = DENT_ACROSS * dentSide;
  ctx.beginPath();
  ctx.moveTo(x(-CROWN_BASE_HALF_WIDTH), BRIM_Y * units.y);
  ctx.lineTo(x(-CROWN_TOP_HALF_WIDTH), CROWN_TOP_Y * units.y);
  ctx.lineTo(x(dentX - DENT_HALF_WIDTH), CROWN_TOP_Y * units.y);
  ctx.lineTo(x(dentX), (CROWN_TOP_Y + DENT_DEPTH) * units.y);
  ctx.lineTo(x(dentX + DENT_HALF_WIDTH), CROWN_TOP_Y * units.y);
  ctx.lineTo(x(CROWN_TOP_HALF_WIDTH), CROWN_TOP_Y * units.y);
  ctx.lineTo(x(CROWN_BASE_HALF_WIDTH), BRIM_Y * units.y);
  ellipseAt(ctx, shape, BRIM_Y, CROWN_BASE_HALF_WIDTH, CROWN_BASE_DEPTH, 0, HALF_TURN);
  ctx.closePath();
}

function paintCrown(ctx: Ctx, shape: HatShape): void {
  const { units, cx, dentSide } = shape;
  traceCrown(ctx, shape);
  ctx.fillStyle = redFill(ctx, shape);
  ctx.fill();

  ctx.save();
  ctx.clip();
  const bandTop = (BRIM_Y - BAND_HEIGHT) * units.y;
  const left = (cx - CROWN_TOP_HALF_WIDTH) * units.x;
  const right = (cx + CROWN_TOP_HALF_WIDTH) * units.x;
  const bandBottom = (BRIM_Y + CROWN_BASE_DEPTH) * units.y;
  ctx.fillStyle = metalFill(ctx, GOLD, left, bandTop, right, bandBottom);
  ctx.fillRect(left, bandTop, right - left, bandBottom - bandTop);
  ctx.beginPath();
  ctx.moveTo(left, bandTop);
  ctx.lineTo(right, bandTop);
  ctx.strokeStyle = BAND_SEAM;
  ctx.lineWidth = BAND_SEAM_WIDTH;
  ctx.stroke();

  const dentX = (cx + DENT_ACROSS * dentSide) * units.x;
  ctx.beginPath();
  ctx.moveTo(dentX, (CROWN_TOP_Y + DENT_DEPTH) * units.y);
  ctx.lineTo(dentX, (CROWN_TOP_Y + DENT_DEPTH + DENT_CREASE_DROP) * units.y);
  ctx.strokeStyle = DENT_SHADOW;
  ctx.lineWidth = DENT_CREASE_WIDTH;
  ctx.stroke();
  ctx.restore();

  ctx.beginPath();
  ellipseAt(ctx, shape, CROWN_TOP_Y, CROWN_TOP_HALF_WIDTH, CROWN_TOP_DEPTH, HALF_TURN, FULL_TURN);
  ctx.fillStyle = SHOW_RED.shadow;
  ctx.fill();
}

function paintBrimLip(ctx: Ctx, shape: HatShape): void {
  ctx.beginPath();
  ellipseAt(ctx, shape, BRIM_Y, shape.brimHalfWidth, BRIM_HALF_DEPTH, 0, HALF_TURN);
  ctx.strokeStyle = SHOW_RED.edge;
  ctx.lineWidth = BRIM_EDGE_WIDTH;
  ctx.stroke();
}

function paintTopHat(ctx: Ctx, shape: HatShape, tilt: number): void {
  const pivotX = shape.cx * shape.units.x;
  const pivotY = BRIM_Y * shape.units.y;
  ctx.translate(pivotX, pivotY);
  ctx.rotate(tilt);
  ctx.translate(-pivotX, -pivotY);
  paintBrim(ctx, shape);
  paintCrown(ctx, shape);
  paintBrimLip(ctx, shape);
}

function paintHeadOn(ctx: Ctx, view: CardinalView): void {
  const fromBehind = view === 'back';
  const tilt = fromBehind ? -HEAD_ON_TILT : HEAD_ON_TILT;
  paintTopHat(
    ctx,
    { units: hatUnits(view), cx: 0, dentSide: fromBehind ? 1 : -1, brimHalfWidth: BRIM_HALF_WIDTH },
    tilt,
  );
}

function paintSide(ctx: Ctx, view: CardinalView): void {
  paintTopHat(
    ctx,
    { units: hatUnits(view), cx: PROFILE_CX, dentSide: -1, brimHalfWidth: PROFILE_BRIM_HALF_WIDTH },
    PROFILE_TILT,
  );
}

export const SHOWMANS_TOP_HAT = defineGarment({
  id: 'human_showmans_top_hat',
  name: "Showman's Top Hat",
  wearer: 'human',
  material: 'cloth',
  layer: 'overcoat',
  region: ['head'],
  paint: { head: hatViews({ front: paintHeadOn, side: paintSide, back: paintHeadOn }) },
});
