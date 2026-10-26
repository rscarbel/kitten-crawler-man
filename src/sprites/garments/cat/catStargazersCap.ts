/**
 * The Stargazer's Cap on the cat crawler: a little indigo pointed cap stitched
 * with silver stars, its brim cut with holes her ears come up through, worn
 * tipped so it slides down over one eye. At the tile it is a dark blue cone
 * leaning off her head with two or three silver specks; the lean and the
 * bent tip are what keep it from reading as a party hat.
 */

import { CAT_VIEW_FALLBACK } from '../../catViews';
import { defineGarment, withViewFallback } from '../garmentDef';
import { type FabricRamp, fabricFill } from './clothInk';
import { type HatSeat, hatPainters } from './headwear';
import { SILVER } from './metalInk';

type Ctx = CanvasRenderingContext2D;
type Pt = { readonly x: number; readonly y: number };

/** Indigo bright enough to stand off Belle's near-black coat. */
const INDIGO: FabricRamp = {
  shadow: '#1c1650',
  base: '#3b30a8',
  light: '#6a62e0',
  edge: '#120d38',
};
const FULL_TURN = Math.PI * 2;

/** The brim's half-width across her skull: out to the roots of her ears. */
const BRIM_HALF_WIDTH = 0.19;
/** How far below the top of her skull the brim rests on the high side, and on the side tipped over her eye. */
const BRIM_HIGH_DROP = 0.03;
const BRIM_LOW_DROP = 0.15;
/** How far the brim's front edge bows down toward the camera. */
const BRIM_SAG = 0.04;
const BRIM_BAND = 0.03;
/** The cone stands this tall above the brim's middle, leaning toward the high side. */
const CONE_HEIGHT = 0.25;
const CONE_LEAN = 0.09;
/** The tip flops over past the cone's peak, the way soft felt does. */
const TIP_FLOP_ACROSS = 0.08;
const TIP_FLOP_DROP = 0.05;
const TIP_RADIUS = 0.022;

/** The stars, as shares of the way from the brim's middle to the peak and across the cone. */
const STARS: readonly { readonly up: number; readonly across: number; readonly size: number }[] = [
  { up: 0.22, across: -0.4, size: 0.045 },
  { up: 0.52, across: 0.3, size: 0.04 },
];
const STAR_POINTS = 5;
const STAR_WAIST = 0.45;

/** In profile the brim tips forward over her brow, its low side over her eye. */
const PROFILE_TILT = 0.3;
const PROFILE_BRIM_HALF_WIDTH = 0.17;
/** From behind the tip falls the other way, so it does not look like a mirror of her front. */
const BACK_SIDE = 1;
const FRONT_SIDE = -1;
const TURN_SLIDE = 0.04;

interface CapGeometry {
  readonly brimLow: Pt;
  readonly brimHigh: Pt;
  readonly peak: Pt;
  readonly tip: Pt;
  readonly middle: Pt;
}

/** `lowSide` is -1 for the brim dipping to screen left, +1 to screen right. */
function capGeometry(seat: HatSeat, halfWidth: number, lowSide: number): CapGeometry {
  const lowY = seat.skullTop + BRIM_LOW_DROP;
  const highY = seat.skullTop + BRIM_HIGH_DROP;
  const brimLow = { x: seat.cx + lowSide * halfWidth, y: lowY };
  const brimHigh = { x: seat.cx - lowSide * halfWidth, y: highY };
  const middle = { x: seat.cx, y: (lowY + highY) / 2 };
  const peak = { x: seat.cx - lowSide * CONE_LEAN, y: middle.y - CONE_HEIGHT };
  const tip = { x: peak.x - lowSide * TIP_FLOP_ACROSS, y: peak.y + TIP_FLOP_DROP };
  return { brimLow, brimHigh, peak, tip, middle };
}

function brimFront(ctx: Ctx, g: CapGeometry, offset: number): void {
  const sagX = (g.brimLow.x + g.brimHigh.x) / 2;
  const sagY = (g.brimLow.y + g.brimHigh.y) / 2 + BRIM_SAG + offset;
  ctx.quadraticCurveTo(sagX, sagY, g.brimLow.x, g.brimLow.y + offset);
}

function paintStar(ctx: Ctx, at: Pt, size: number): void {
  ctx.beginPath();
  for (let point = 0; point < STAR_POINTS * 2; point++) {
    const angle = (point / (STAR_POINTS * 2)) * FULL_TURN - Math.PI / 2;
    const r = point % 2 === 0 ? size : size * STAR_WAIST;
    const x = at.x + Math.cos(angle) * r;
    const y = at.y + Math.sin(angle) * r;
    if (point === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = SILVER.light;
  ctx.fill();
}

function paintCap(ctx: Ctx, g: CapGeometry, showStars: boolean): void {
  ctx.beginPath();
  ctx.moveTo(g.brimLow.x, g.brimLow.y);
  ctx.quadraticCurveTo(
    (g.brimLow.x + g.peak.x) / 2,
    (g.brimLow.y + g.peak.y) / 2,
    g.peak.x,
    g.peak.y,
  );
  ctx.quadraticCurveTo(g.peak.x, g.peak.y, g.brimHigh.x, g.brimHigh.y);
  brimFront(ctx, g, 0);
  ctx.closePath();
  ctx.fillStyle = fabricFill(ctx, INDIGO, g.brimHigh, g.brimLow);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(g.peak.x, g.peak.y);
  ctx.quadraticCurveTo(g.peak.x, g.tip.y, g.tip.x, g.tip.y);
  ctx.strokeStyle = INDIGO.base;
  ctx.lineWidth = TIP_RADIUS * 2;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(g.tip.x, g.tip.y, TIP_RADIUS, 0, FULL_TURN);
  ctx.fillStyle = SILVER.base;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(g.brimHigh.x, g.brimHigh.y);
  brimFront(ctx, g, 0);
  ctx.lineTo(g.brimLow.x, g.brimLow.y - BRIM_BAND);
  ctx.moveTo(g.brimHigh.x, g.brimHigh.y);
  brimFront(ctx, g, -BRIM_BAND);
  ctx.strokeStyle = INDIGO.edge;
  ctx.lineWidth = BRIM_BAND;
  ctx.stroke();

  if (!showStars) return;
  for (const star of STARS) {
    const along = {
      x: g.middle.x + (g.peak.x - g.middle.x) * star.up,
      y: g.middle.y + (g.peak.y - g.middle.y) * star.up,
    };
    const halfAcross = (Math.abs(g.brimLow.x - g.brimHigh.x) / 2) * (1 - star.up);
    paintStar(ctx, { x: along.x + star.across * halfAcross, y: along.y }, star.size);
  }
}

function paintSeat(ctx: Ctx, seat: HatSeat): void {
  const lowSide = seat.view === 'back' ? BACK_SIDE : FRONT_SIDE;
  if (seat.view === 'side') {
    paintCap(ctx, capGeometry(seat, PROFILE_BRIM_HALF_WIDTH, 1), true);
    return;
  }
  paintCap(ctx, capGeometry(seat, BRIM_HALF_WIDTH, lowSide), true);
}

export const CAT_STARGAZERS_CAP = defineGarment({
  id: 'cat_stargazers_cap',
  name: "Stargazer's Cap",
  wearer: 'cat',
  material: 'cloth',
  layer: 'overcoat',
  region: ['head'],
  paint: {
    head: withViewFallback(
      hatPainters({ paint: paintSeat, turnSlide: TURN_SLIDE, profileTilt: PROFILE_TILT }),
      CAT_VIEW_FALLBACK,
    ),
  },
});
