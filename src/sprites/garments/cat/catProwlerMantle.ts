/**
 * The Prowler Mantle on the cat crawler: a short capelet of charcoal felt
 * over her shoulders, closed at her throat by a silver clasp, its hem stitched
 * in silver. It covers only the tops of her shoulders and the front of her
 * back, ending in a round hem high on her flank, so her barrel, belly and rump
 * show below it in every view.
 */

import type { CatBodyFrame, CatEllipse } from '../../art/catParts';
import { CAT_VIEW_FALLBACK } from '../../catViews';
import { defineGarment, withViewFallback } from '../garmentDef';
import { clipToOutline, fabricFill, strokeCurve, type FabricRamp } from './clothInk';
import { paintRing } from './harness';
import { SILVER } from './metalInk';

type Ctx = CanvasRenderingContext2D;
type Pt = { readonly x: number; readonly y: number };

/** A mid charcoal, two steps above a near-black coat so the felt reads as cloth over it. */
const CHARCOAL_FELT: FabricRamp = {
  shadow: '#2e3038',
  base: '#646875',
  light: '#9ca1b0',
  edge: '#141519',
};
const HEM_WIDTH = 0.026;
const STITCH_WIDTH = 0.014;
const STITCH_DASH = [0.025, 0.02];
/** The silver stitching runs this far inside the hem. */
const STITCH_INSET = 0.028;
const CLASP_RADIUS = 0.026;
/** Room past a piece's ellipse every clip gives, as a share of its radii. */
const CLIP_SPREAD = 2;

/** In profile the hem leaves her chest this share of its half-height below its middle. */
const PROFILE_CHEST_HEM = 0.1;
/** It runs back over her barrel to this share of its half-length behind its middle, where it meets her spine. */
const PROFILE_HEM_BACK = -0.3;
/** It dips lowest over her shoulder, this share of the barrel's half-height below its middle. */
const PROFILE_HEM_LOW = 0.3;
/** Where over her barrel's length the hem dips lowest, as a share of its half-length forward of the middle. */
const PROFILE_HEM_LOW_AT = 0.45;

/** From behind the hem crosses her back this share of the barrel's half-height above its middle. */
const BACK_HEM = 0.15;
const BACK_HEM_SAG = 0.4;

/** Head-on the hem crosses her barrel this share of its half-height above its middle. */
const FRONT_BARREL_HEM = 0.2;
/** Head-on the mantle parts down the middle of her chest ruff, this share of its half-width each side. */
const FRONT_OPENING = 0.35;
/** The opening closes at the clasp, this share of the ruff's half-height above its middle. */
const FRONT_CLASP_HEIGHT = 0.55;
/** The fronts fall open to this share of the ruff's half-height below its middle. */
const FRONT_FRONT_HEM = 0.55;

function fillFelt(ctx: Ctx, area: CatEllipse): void {
  ctx.fillStyle = fabricFill(
    ctx,
    CHARCOAL_FELT,
    { x: area.cx, y: area.cy - area.ry },
    { x: area.cx, y: area.cy + area.ry },
  );
  ctx.fillRect(
    area.cx - area.rx * CLIP_SPREAD,
    area.cy - area.ry * CLIP_SPREAD,
    area.rx * CLIP_SPREAD * 2,
    area.ry * CLIP_SPREAD * 2,
  );
}

/** The hem's dark edge, and the silver stitching just above it. */
function hemAlong(ctx: Ctx, from: Pt, control: Pt, to: Pt): void {
  strokeCurve(ctx, from, control, to, CHARCOAL_FELT.edge, HEM_WIDTH);
  ctx.save();
  ctx.setLineDash(STITCH_DASH);
  strokeCurve(
    ctx,
    { x: from.x, y: from.y - STITCH_INSET },
    { x: control.x, y: control.y - STITCH_INSET },
    { x: to.x, y: to.y - STITCH_INSET },
    SILVER.light,
    STITCH_WIDTH,
  );
  ctx.restore();
}

/** Covers `frame` above a hem from `from` through `control` to `to`, which runs left to right across it. */
function coverAbove(ctx: Ctx, frame: CatBodyFrame, from: Pt, control: Pt, to: Pt): void {
  const { shape } = frame;
  const top = shape.cy - shape.ry * CLIP_SPREAD;
  ctx.save();
  clipToOutline(ctx, frame.envelope);
  ctx.beginPath();
  ctx.moveTo(from.x, top);
  ctx.lineTo(from.x, from.y);
  ctx.quadraticCurveTo(control.x, control.y, to.x, to.y);
  ctx.lineTo(to.x, top);
  ctx.closePath();
  ctx.clip();
  fillFelt(ctx, shape);
  hemAlong(ctx, from, control, to);
  ctx.restore();
}

function paintSide(ctx: Ctx, frame: CatBodyFrame): void {
  const { shape } = frame;
  if (frame.piece === 'barrel') {
    const back = {
      x: shape.cx + shape.rx * PROFILE_HEM_BACK,
      y: shape.cy - shape.ry * CLIP_SPREAD,
    };
    const low = {
      x: shape.cx + shape.rx * PROFILE_HEM_LOW_AT,
      y: shape.cy + shape.ry * PROFILE_HEM_LOW,
    };
    const front = { x: shape.cx + shape.rx * CLIP_SPREAD, y: low.y };
    coverAbove(ctx, frame, back, { x: back.x, y: low.y }, low);
    coverAbove(ctx, frame, low, { x: (low.x + front.x) / 2, y: low.y }, front);
    return;
  }
  if (frame.piece !== 'chest') return;
  const hemY = shape.cy + shape.ry * PROFILE_CHEST_HEM;
  coverAbove(
    ctx,
    frame,
    { x: shape.cx - shape.rx * CLIP_SPREAD, y: hemY },
    { x: shape.cx, y: hemY + shape.ry * PROFILE_HEM_LOW },
    { x: shape.cx + shape.rx * CLIP_SPREAD, y: hemY },
  );
}

function hemAcross(area: CatEllipse, share: number, sag: number): readonly [Pt, Pt, Pt] {
  const y = area.cy + area.ry * share;
  return [
    { x: area.cx - area.rx * CLIP_SPREAD, y },
    { x: area.cx, y: y + area.ry * sag },
    { x: area.cx + area.rx * CLIP_SPREAD, y },
  ];
}

function paintBack(ctx: Ctx, frame: CatBodyFrame): void {
  if (frame.piece !== 'barrel') return;
  coverAbove(ctx, frame, ...hemAcross(frame.shape, BACK_HEM, BACK_HEM_SAG));
}

/** Head-on the fronts hang either side of her chest ruff, parted below the clasp. */
function paintRuffFronts(ctx: Ctx, frame: CatBodyFrame): void {
  const { shape } = frame;
  const claspY = shape.cy - shape.ry * FRONT_CLASP_HEIGHT;
  const hemY = shape.cy + shape.ry * FRONT_FRONT_HEM;
  const openHalf = shape.rx * FRONT_OPENING;
  for (const side of [-1, 1]) {
    const opening = { x: shape.cx + side * openHalf, y: hemY };
    const outer = { x: shape.cx + side * shape.rx * CLIP_SPREAD, y: hemY };
    ctx.save();
    clipToOutline(ctx, frame.envelope);
    ctx.beginPath();
    ctx.moveTo(shape.cx, claspY);
    ctx.quadraticCurveTo(opening.x, claspY, opening.x, opening.y);
    ctx.lineTo(outer.x, outer.y);
    ctx.lineTo(outer.x, shape.cy - shape.ry * CLIP_SPREAD);
    ctx.lineTo(shape.cx, shape.cy - shape.ry * CLIP_SPREAD);
    ctx.closePath();
    ctx.clip();
    fillFelt(ctx, shape);
    strokeCurve(
      ctx,
      { x: shape.cx, y: claspY },
      { x: opening.x, y: claspY },
      opening,
      CHARCOAL_FELT.edge,
      HEM_WIDTH,
    );
    hemAlong(ctx, opening, { x: (opening.x + outer.x) / 2, y: hemY }, outer);
    ctx.restore();
  }
  paintRing(ctx, SILVER, { x: shape.cx, y: claspY }, CLASP_RADIUS);
}

function paintFront(ctx: Ctx, frame: CatBodyFrame): void {
  if (frame.piece === 'ruff') {
    paintRuffFronts(ctx, frame);
    return;
  }
  if (frame.piece !== 'barrel' && frame.piece !== 'blade') return;
  coverAbove(ctx, frame, ...hemAcross(frame.shape, FRONT_BARREL_HEM, BACK_HEM_SAG));
}

export const CAT_PROWLER_MANTLE = defineGarment({
  id: 'cat_prowler_mantle',
  name: 'Prowler Mantle',
  wearer: 'cat',
  material: 'cloth',
  layer: 'back',
  region: ['body'],
  paint: {
    body: withViewFallback(
      { front: paintFront, side: paintSide, back: paintBack },
      CAT_VIEW_FALLBACK,
    ),
  },
});
