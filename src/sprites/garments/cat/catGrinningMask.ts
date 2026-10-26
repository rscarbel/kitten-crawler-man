/**
 * The Grinning Mask on the cat crawler: a white porcelain face over hers,
 * from brow to chin, with almond eye holes she looks out through and a smile
 * cut far too wide for any face. Her ears, cheek ruffs and whiskers stay
 * outside it, so she still reads as a cat wearing a mask rather than a mask
 * with ears.
 *
 * At the tile the mask is a pale oval with two dark eyes and one thin dark
 * crescent whose corners turn up almost to the eyes: a red or open grin
 * reads as her own mouth screaming, a shallow one as a white muzzle.
 */

import type { CatHeadFrame } from '../../art/catParts';
import { CAT_VIEW_FALLBACK } from '../../catViews';
import { defineGarment, withViewFallback } from '../garmentDef';
import { strokeLine } from './faceWear';

type Ctx = CanvasRenderingContext2D;
type Pt = { readonly x: number; readonly y: number };

const FULL_TURN = Math.PI * 2;

const PORCELAIN_LIGHT = '#ffffff';
const PORCELAIN = '#e9e6ee';
const PORCELAIN_SHADE = '#a8a2b8';
const MASK_EDGE = '#4a4458';
const SMILE_INK = '#16070c';
const STRAP = '#241612';

/** Where the porcelain's lit band ends and its shade begins, down the face. */
const LIT_UNTIL = 0.3;
const SHADE_FROM = 0.75;
const EDGE_WIDTH = 0.012;

/** Head-on: the mask's oval, centred between her eyes and dropped to cover her muzzle. */
const MASK_DROP = 0.06;
const MASK_RX = 0.165;
const MASK_RY = 0.15;
/** The almond eye holes, a little bigger than her eyes so the porcelain frames them. */
const EYE_HOLE_RX = 0.055;
const EYE_HOLE_RY = 0.038;
/** The holes slant up toward her temples: the mask's look of glee. */
const EYE_HOLE_SLANT = 0.3;
/** The grin: a crescent from cheek to cheek, its corners turned up past the muzzle. */
const SMILE_HALF_WIDTH = 0.145;
const SMILE_CORNER_Y = 0.045;
const SMILE_BOTTOM_Y = 0.155;
const SMILE_TOP_Y = 0.125;

/** In profile: the shell over her brow and muzzle, as points round its outline in head units. */
const SIDE_MASK: readonly Pt[] = [
  { x: 0.0, y: -0.1 },
  { x: 0.09, y: -0.095 },
  { x: 0.15, y: -0.02 },
  { x: 0.175, y: 0.05 },
  { x: 0.15, y: 0.12 },
  { x: 0.06, y: 0.135 },
  { x: -0.005, y: 0.08 },
];
const SIDE_EYE_HOLE_RX = 0.03;
const SIDE_EYE_HOLE_RY = 0.036;
/** In profile the grin runs back from the mask's lip toward her cheek and curls up. */
const SIDE_SMILE_FRONT: Pt = { x: 0.165, y: 0.075 };
const SIDE_SMILE_SAG: Pt = { x: 0.1, y: 0.125 };
const SIDE_SMILE_END: Pt = { x: 0.03, y: 0.05 };
const SIDE_SMILE_WIDTH = 0.026;
/** The ribbon that ties the mask on, from its back edge round to behind her ear. */
const SIDE_STRAP_FROM: Pt = { x: 0.0, y: -0.02 };
const SIDE_STRAP_TO: Pt = { x: -0.12, y: -0.04 };
const STRAP_WIDTH = 0.026;
/** From behind: the ribbon across the back of her head, and the porcelain's rim past her cheeks. */
const BACK_STRAP_SPREAD = 0.98;
const BACK_RIM_OUT = 0.03;
const BACK_RIM_RX = 0.022;
const BACK_RIM_RY = 0.07;

function porcelainFill(ctx: Ctx, top: number, bottom: number): CanvasGradient {
  const gradient = ctx.createLinearGradient(0, top, 0, bottom);
  gradient.addColorStop(0, PORCELAIN_LIGHT);
  gradient.addColorStop(LIT_UNTIL, PORCELAIN);
  gradient.addColorStop(SHADE_FROM, PORCELAIN);
  gradient.addColorStop(1, PORCELAIN_SHADE);
  return gradient;
}

function traceOutline(ctx: Ctx, outline: readonly Pt[]): void {
  outline.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.closePath();
}

function traceEyeHole(ctx: Ctx, at: Pt, rx: number, ry: number, slant: number): void {
  ctx.moveTo(at.x + rx * Math.cos(slant), at.y + rx * Math.sin(slant));
  ctx.ellipse(at.x, at.y, rx, ry, slant, 0, FULL_TURN);
}

/** The grin cut through the porcelain: a crescent whose corners turn up toward the eyes. */
function paintFrontSmile(ctx: Ctx, centreX: number): void {
  const left = centreX - SMILE_HALF_WIDTH;
  const right = centreX + SMILE_HALF_WIDTH;
  ctx.beginPath();
  ctx.moveTo(left, SMILE_CORNER_Y);
  ctx.quadraticCurveTo(centreX, SMILE_BOTTOM_Y * 2 - SMILE_CORNER_Y, right, SMILE_CORNER_Y);
  ctx.quadraticCurveTo(centreX, SMILE_TOP_Y * 2 - SMILE_CORNER_Y, left, SMILE_CORNER_Y);
  ctx.closePath();
  ctx.fillStyle = SMILE_INK;
  ctx.fill();
}

function paintFront(ctx: Ctx, frame: CatHeadFrame): void {
  if (frame.piece !== 'features') return;
  const { eyes, eyeLine } = frame.landmarks;
  if (eyes.length < 2) return;
  const [left, right] = eyes;
  const centreX = (left.x + right.x) / 2;
  const centreY = eyeLine + MASK_DROP;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(centreX, centreY, MASK_RX, MASK_RY, 0, 0, FULL_TURN);
  traceEyeHole(ctx, left, EYE_HOLE_RX, EYE_HOLE_RY, -EYE_HOLE_SLANT);
  traceEyeHole(ctx, right, EYE_HOLE_RX, EYE_HOLE_RY, EYE_HOLE_SLANT);
  ctx.fillStyle = porcelainFill(ctx, centreY - MASK_RY, centreY + MASK_RY);
  ctx.fill('evenodd');
  ctx.strokeStyle = MASK_EDGE;
  ctx.lineWidth = EDGE_WIDTH;
  ctx.stroke();
  paintFrontSmile(ctx, centreX);
  ctx.restore();
}

function paintSide(ctx: Ctx, frame: CatHeadFrame): void {
  if (frame.piece !== 'features') return;
  const { eyes } = frame.landmarks;
  if (eyes.length === 0) return;
  const [eye] = eyes;
  ctx.save();
  strokeLine(ctx, SIDE_STRAP_FROM, SIDE_STRAP_TO, STRAP, STRAP_WIDTH);
  const top = Math.min(...SIDE_MASK.map((point) => point.y));
  const bottom = Math.max(...SIDE_MASK.map((point) => point.y));
  ctx.beginPath();
  traceOutline(ctx, SIDE_MASK);
  traceEyeHole(ctx, eye, SIDE_EYE_HOLE_RX, SIDE_EYE_HOLE_RY, 0);
  ctx.fillStyle = porcelainFill(ctx, top, bottom);
  ctx.fill('evenodd');
  ctx.strokeStyle = MASK_EDGE;
  ctx.lineWidth = EDGE_WIDTH;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(SIDE_SMILE_FRONT.x, SIDE_SMILE_FRONT.y);
  ctx.quadraticCurveTo(SIDE_SMILE_SAG.x, SIDE_SMILE_SAG.y, SIDE_SMILE_END.x, SIDE_SMILE_END.y);
  ctx.strokeStyle = SMILE_INK;
  ctx.lineWidth = SIDE_SMILE_WIDTH;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();
}

function paintBack(ctx: Ctx, frame: CatHeadFrame): void {
  if (frame.piece !== 'features') return;
  const { skull, eyeLine } = frame.landmarks;
  const reach = skull.rx * BACK_STRAP_SPREAD;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(
      skull.cx + side * (reach + BACK_RIM_OUT),
      eyeLine + MASK_DROP,
      BACK_RIM_RX,
      BACK_RIM_RY,
      0,
      0,
      FULL_TURN,
    );
    ctx.fillStyle = PORCELAIN;
    ctx.fill();
    ctx.strokeStyle = MASK_EDGE;
    ctx.lineWidth = EDGE_WIDTH;
    ctx.stroke();
  }
  strokeLine(
    ctx,
    { x: skull.cx - reach, y: eyeLine },
    { x: skull.cx + reach, y: eyeLine },
    STRAP,
    STRAP_WIDTH,
  );
}

export const CAT_GRINNING_MASK = defineGarment({
  id: 'cat_grinning_mask',
  name: 'Grinning Mask',
  wearer: 'cat',
  material: 'metal',
  layer: 'outer',
  region: ['head'],
  paint: {
    head: withViewFallback(
      { front: paintFront, side: paintSide, back: paintBack },
      CAT_VIEW_FALLBACK,
    ),
  },
});
