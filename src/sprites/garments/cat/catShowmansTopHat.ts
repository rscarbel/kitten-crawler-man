/**
 * The Showman's Top Hat on the cat crawler: a small, tall red top hat with a
 * gold band, perched between her ears at a jaunty tilt, its crown still
 * dented where a lion sat on it. At the tile it is a red column with a gold
 * stripe and a dark brim line; the height and the flat top are the read.
 */

import { CAT_VIEW_FALLBACK } from '../../catViews';
import { defineGarment, withViewFallback } from '../garmentDef';
import { type FabricRamp, fabricFill } from './clothInk';
import { type HatSeat, hatPainters } from './headwear';
import { GOLD, metalFill } from './metalInk';

type Ctx = CanvasRenderingContext2D;

const FULL_TURN = Math.PI * 2;

const SHOW_RED: FabricRamp = {
  shadow: '#5a0a12',
  base: '#c4182a',
  light: '#f2525a',
  edge: '#2a0408',
};
const BRIM_UNDERSIDE = '#1e0306';
const DENT_SHADOW = 'rgba(40,4,8,0.75)';

/** The brim rests this far below the top of her skull, between her ears. */
const SEAT_DEPTH = 0.03;
const BRIM_HALF_WIDTH = 0.14;
const BRIM_HALF_DEPTH = 0.03;
const BRIM_LIP = 0.018;
/** The crown flares a little toward its top, as a top hat's does. */
const CROWN_BASE_HALF_WIDTH = 0.08;
const CROWN_TOP_HALF_WIDTH = 0.092;
const CROWN_HEIGHT = 0.26;
const CROWN_TOP_DEPTH = 0.02;
const BAND_HEIGHT = 0.045;
/** The dent is a notch out of the crown's top, on the side the lion sat. */
const DENT_ACROSS = 0.035;
const DENT_DEPTH = 0.03;
const DENT_HALF_WIDTH = 0.03;
/** Head-on the hat leans off-true, toward screen right; in profile it tips back. */
const HEAD_ON_TILT = 0.14;
const PROFILE_TILT = -0.12;
const PROFILE_BACK = 0.03;
const TURN_SLIDE = 0.04;

function paintTopHat(ctx: Ctx, seat: HatSeat): void {
  const profile = seat.view === 'side';
  const cx = profile ? seat.cx - PROFILE_BACK : seat.cx;
  const brimY = seat.skullTop + SEAT_DEPTH;
  ctx.save();
  if (!profile) {
    ctx.translate(cx, brimY);
    ctx.rotate(seat.view === 'back' ? -HEAD_ON_TILT : HEAD_ON_TILT);
    ctx.translate(-cx, -brimY);
  }

  ctx.beginPath();
  ctx.ellipse(cx, brimY + BRIM_LIP, BRIM_HALF_WIDTH, BRIM_HALF_DEPTH, 0, 0, FULL_TURN);
  ctx.fillStyle = BRIM_UNDERSIDE;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, brimY, BRIM_HALF_WIDTH, BRIM_HALF_DEPTH, 0, 0, FULL_TURN);
  ctx.fillStyle = SHOW_RED.base;
  ctx.fill();

  const topY = brimY - CROWN_HEIGHT;
  const left = cx - CROWN_BASE_HALF_WIDTH;
  const right = cx + CROWN_BASE_HALF_WIDTH;
  const dentX = cx - DENT_ACROSS;
  ctx.beginPath();
  ctx.moveTo(left, brimY);
  ctx.lineTo(cx - CROWN_TOP_HALF_WIDTH, topY);
  ctx.lineTo(dentX - DENT_HALF_WIDTH, topY);
  ctx.lineTo(dentX, topY + DENT_DEPTH);
  ctx.lineTo(dentX + DENT_HALF_WIDTH, topY);
  ctx.lineTo(cx + CROWN_TOP_HALF_WIDTH, topY);
  ctx.lineTo(right, brimY);
  ctx.closePath();
  ctx.fillStyle = fabricFill(ctx, SHOW_RED, { x: left, y: topY }, { x: right, y: brimY });
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(dentX - DENT_HALF_WIDTH, topY);
  ctx.lineTo(dentX, topY + DENT_DEPTH);
  ctx.lineTo(dentX + DENT_HALF_WIDTH, topY);
  ctx.strokeStyle = DENT_SHADOW;
  ctx.lineWidth = CROWN_TOP_DEPTH;
  ctx.stroke();

  const bandTop = brimY - BAND_HEIGHT;
  ctx.beginPath();
  ctx.rect(left, bandTop, right - left, BAND_HEIGHT);
  ctx.fillStyle = metalFill(ctx, GOLD, left, bandTop, right, brimY);
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(cx, brimY, BRIM_HALF_WIDTH, BRIM_HALF_DEPTH, 0, 0, Math.PI);
  ctx.strokeStyle = SHOW_RED.edge;
  ctx.lineWidth = BRIM_LIP;
  ctx.stroke();
  ctx.restore();
}

export const CAT_SHOWMANS_TOP_HAT = defineGarment({
  id: 'cat_showmans_top_hat',
  name: "Showman's Top Hat",
  wearer: 'cat',
  material: 'cloth',
  layer: 'overcoat',
  region: ['head'],
  paint: {
    head: withViewFallback(
      hatPainters({ paint: paintTopHat, turnSlide: TURN_SLIDE, profileTilt: PROFILE_TILT }),
      CAT_VIEW_FALLBACK,
    ),
  },
});
