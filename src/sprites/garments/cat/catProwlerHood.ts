/**
 * The Prowler Hood on the cat crawler: a charcoal felt hood over her skull
 * and the back of her head, open round her face, with her ears up through
 * holes ringed in silver stitching. At the tile it is a grey cowl framing her
 * face; on a near-black cat the felt is held a step lighter than her coat and
 * the silver rings mark where it ends round her ears.
 */

import { CAT_VIEW_FALLBACK } from '../../catViews';
import { defineGarment, withViewFallback } from '../garmentDef';
import { type FabricRamp, fabricFill } from './clothInk';
import { type HatSeat, hatPainters } from './headwear';
import { SILVER } from './metalInk';

type Ctx = CanvasRenderingContext2D;

const FULL_TURN = Math.PI * 2;
const HALF_TURN = Math.PI;

const CHARCOAL_FELT: FabricRamp = {
  shadow: '#3a3d45',
  base: '#5e626d',
  light: '#8c919e',
  edge: '#17181c',
};
const STITCH_WIDTH = 0.014;
const STITCH_DASH = [0.022, 0.016] as const;
const HEM_WIDTH = 0.022;

interface Oval {
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
}

/** Head-on, in the fitted frame about her skull's centre. */
const HEAD_ON_COWL: Oval = { cx: 0, cy: 0.01, rx: 0.28, ry: 0.27 };
const HEAD_ON_FACE: Oval = { cx: 0, cy: 0.08, rx: 0.2, ry: 0.21 };
/** From behind the hood is closed, and runs down onto her nape. */
const BACK_COWL: Oval = { cx: 0, cy: 0.02, rx: 0.26, ry: 0.25 };
/** In profile the cowl sits back over her skull, the face cut away toward her nose. */
const PROFILE_COWL: Oval = { cx: -0.03, cy: 0.01, rx: 0.21, ry: 0.24 };
const PROFILE_FACE: Oval = { cx: 0.13, cy: 0.07, rx: 0.16, ry: 0.22 };
/** Where the ear holes sit: below the top of her skull, out at her ear roots. */
const EAR_HOLE_DROP = 0.07;
const EAR_HOLE_ACROSS = 0.19;
const EAR_HOLE_HALF_WIDTH = 0.075;
const EAR_HOLE_HALF_DEPTH = 0.03;
const PROFILE_EAR_HOLE_ACROSS = 0;
const TURN_SLIDE = 0.04;

function ovalPath(ctx: Ctx, cx: number, oval: Oval): void {
  ctx.ellipse(cx + oval.cx, oval.cy, oval.rx, oval.ry, 0, 0, FULL_TURN);
}

function paintEarHole(ctx: Ctx, x: number, y: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, EAR_HOLE_HALF_WIDTH, EAR_HOLE_HALF_DEPTH, 0, HALF_TURN, FULL_TURN);
  ctx.strokeStyle = SILVER.light;
  ctx.lineWidth = STITCH_WIDTH;
  ctx.setLineDash(STITCH_DASH);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** The hood's tail: where it gathers below the back of her head onto her nape. */
interface Drape {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly point: { readonly x: number; readonly y: number };
}

/** From behind it runs to a point at her nape; in profile it hangs off the back of her skull. */
const BACK_DRAPE: Drape = { left: -0.17, right: 0.17, top: 0.1, point: { x: 0, y: 0.24 } };
const PROFILE_DRAPE: Drape = { left: -0.22, right: -0.04, top: 0.06, point: { x: -0.17, y: 0.22 } };
/** From behind a seam runs up the middle of the hood, the one line that says sewn felt rather than fur. */
const BACK_SEAM_FROM = -0.24;
const SEAM_WIDTH = 0.016;
/** Wide enough to take in everything the hood can cover, so the face can be cut out of it. */
const CUT_REACH = 1;

function paintDrape(ctx: Ctx, cx: number, drape: Drape): void {
  ctx.beginPath();
  ctx.moveTo(cx + drape.left, drape.top);
  ctx.quadraticCurveTo(cx + drape.left, drape.point.y, cx + drape.point.x, drape.point.y);
  ctx.quadraticCurveTo(cx + drape.right, drape.point.y, cx + drape.right, drape.top);
  ctx.closePath();
  ctx.fillStyle = CHARCOAL_FELT.shadow;
  ctx.fill();
}

function paintHood(ctx: Ctx, seat: HatSeat): void {
  const { cx } = seat;
  const cowl =
    seat.view === 'side' ? PROFILE_COWL : seat.view === 'back' ? BACK_COWL : HEAD_ON_COWL;
  const face = seat.view === 'side' ? PROFILE_FACE : seat.view === 'back' ? null : HEAD_ON_FACE;
  const drape = seat.view === 'side' ? PROFILE_DRAPE : seat.view === 'back' ? BACK_DRAPE : null;
  if (drape !== null) paintDrape(ctx, cx, drape);

  ctx.save();
  ctx.beginPath();
  ovalPath(ctx, cx, cowl);
  ctx.clip();
  ctx.beginPath();
  ctx.rect(cx - CUT_REACH, -CUT_REACH, CUT_REACH * 2, CUT_REACH * 2);
  if (face !== null) ovalPath(ctx, cx, face);
  ctx.fillStyle = fabricFill(
    ctx,
    CHARCOAL_FELT,
    { x: cx + cowl.cx - cowl.rx, y: cowl.cy - cowl.ry },
    { x: cx + cowl.cx + cowl.rx, y: cowl.cy + cowl.ry },
  );
  ctx.fill('evenodd');
  if (face !== null) {
    ctx.beginPath();
    ovalPath(ctx, cx, face);
    ctx.strokeStyle = CHARCOAL_FELT.edge;
    ctx.lineWidth = HEM_WIDTH;
    ctx.stroke();
  }
  if (seat.view === 'back') {
    ctx.beginPath();
    ctx.moveTo(cx, BACK_SEAM_FROM);
    ctx.lineTo(cx, cowl.cy + cowl.ry);
    ctx.strokeStyle = CHARCOAL_FELT.edge;
    ctx.lineWidth = SEAM_WIDTH;
    ctx.stroke();
  }
  ctx.restore();

  const holeY = seat.skullTop + EAR_HOLE_DROP;
  if (seat.view === 'side') {
    paintEarHole(ctx, cx + PROFILE_EAR_HOLE_ACROSS, holeY);
    return;
  }
  for (const side of [-1, 1]) paintEarHole(ctx, cx + side * EAR_HOLE_ACROSS, holeY);
}

export const CAT_PROWLER_HOOD = defineGarment({
  id: 'cat_prowler_hood',
  name: 'Prowler Hood',
  wearer: 'cat',
  material: 'cloth',
  layer: 'overcoat',
  region: ['head'],
  paint: {
    head: withViewFallback(
      hatPainters({ paint: paintHood, turnSlide: TURN_SLIDE, profileTilt: 0 }),
      CAT_VIEW_FALLBACK,
    ),
  },
});
