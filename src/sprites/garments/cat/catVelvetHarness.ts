/**
 * The Velvet Harness on the cat crawler: plum velvet straps, one round her
 * barrel just behind her forelegs and one across her chest, joined by little
 * brass rings, with a brass leash ring on top of her back. It is straps, not
 * a coat: her fur shows between them in every view.
 */

import type { CatBodyFrame, CatEllipse } from '../../art/catParts';
import { CAT_VIEW_FALLBACK } from '../../catViews';
import { defineGarment, withViewFallback } from '../garmentDef';
import { clipToOutline, type FabricRamp } from './clothInk';
import { paintRing, paintStrap, type StrapLook } from './harness';
import { BRASS } from './metalInk';

type Ctx = CanvasRenderingContext2D;

/** A bright plum, light enough to stand off a near-black coat and saturated enough to part from a ginger one. */
const PLUM_VELVET: FabricRamp = {
  shadow: '#4a1440',
  base: '#a8378f',
  light: '#e07cc8',
  edge: '#24061f',
};
const STRAP: StrapLook = { fabric: PLUM_VELVET, width: 0.07, edge: 0.014 };
const RING_RADIUS = 0.03;
/** A quadratic strap passes its control point's offset at half strength at its middle. */
const CURVE_MIDPOINT_SHARE = 0.5;
/** Strap ends run past a piece's ellipse by this share, so its clip leaves no gap at the edge. */
const STRAP_REACH = 1.3;

/** In profile the girth rounds her barrel this share of its half-length forward of its middle, behind her forelegs. */
const PROFILE_GIRTH_AT = 0.12;
/** The girth bows toward her tail over her flank's middle. */
const PROFILE_GIRTH_BOW = 0.1;
/** The back strap runs forward from the girth along her spine, this share of the barrel's half-height below its top. */
const SPINE_STRAP_INSET = 0.12;
/** The chest strap crosses her chest this share of its half-height above its middle. */
const CHEST_STRAP_HEIGHT = 0.05;
const CHEST_STRAP_SAG = 0.25;

/** Head-on the girth shows across her barrel this share of its half-height below its middle. */
const FRONT_GIRTH_HEIGHT = 0;
/** Head-on the chest strap's ring sits this share of the ruff's half-height below its middle. */
const FRONT_RING_HEIGHT = 0.15;

/** From behind the girth crosses her back this share of the barrel's half-height below its middle. */
const BACK_GIRTH_HEIGHT = -0.05;
const BACK_GIRTH_SAG = 0.18;

/** A strap straight across `area` at `y`, sagging toward the camera at its middle. */
function strapAcross(ctx: Ctx, area: CatEllipse, y: number, sag: number): void {
  paintStrap(
    ctx,
    STRAP,
    { x: area.cx - area.rx * STRAP_REACH, y },
    { x: area.cx, y: y + area.ry * sag },
    { x: area.cx + area.rx * STRAP_REACH, y },
  );
}

/** A strap straight down the middle of `area` from above it to `bottomY`. */
function strapDown(ctx: Ctx, area: CatEllipse, bottomY: number): void {
  const top = { x: area.cx, y: area.cy - area.ry * STRAP_REACH };
  const bottom = { x: area.cx, y: bottomY };
  paintStrap(ctx, STRAP, top, { x: area.cx, y: (top.y + bottom.y) / 2 }, bottom);
}

/** In profile: the girth round her barrel behind her forelegs, and the back strap forward from it to her neck. */
function paintSideBarrel(ctx: Ctx, frame: CatBodyFrame): void {
  const { shape } = frame;
  const girthX = shape.cx + shape.rx * PROFILE_GIRTH_AT;
  const spineY = shape.cy - shape.ry * (1 - SPINE_STRAP_INSET);
  ctx.save();
  clipToOutline(ctx, frame.envelope);
  paintStrap(
    ctx,
    STRAP,
    { x: girthX, y: shape.cy - shape.ry * STRAP_REACH },
    { x: girthX - shape.rx * PROFILE_GIRTH_BOW, y: shape.cy },
    { x: girthX, y: shape.cy + shape.ry * STRAP_REACH },
  );
  paintStrap(
    ctx,
    STRAP,
    { x: girthX, y: spineY },
    { x: shape.cx + shape.rx * CURVE_MIDPOINT_SHARE, y: spineY },
    { x: shape.cx + shape.rx * STRAP_REACH, y: spineY + shape.ry * SPINE_STRAP_INSET },
  );
  ctx.restore();
  paintRing(ctx, BRASS, { x: girthX, y: spineY }, RING_RADIUS);
}

function paintSide(ctx: Ctx, frame: CatBodyFrame): void {
  if (frame.piece === 'barrel') {
    paintSideBarrel(ctx, frame);
    return;
  }
  if (frame.piece !== 'chest') return;
  const { shape } = frame;
  const strapY = shape.cy - shape.ry * CHEST_STRAP_HEIGHT;
  ctx.save();
  clipToOutline(ctx, frame.envelope);
  strapAcross(ctx, shape, strapY, CHEST_STRAP_SAG);
  ctx.restore();
  paintRing(
    ctx,
    BRASS,
    { x: shape.cx, y: strapY + shape.ry * CHEST_STRAP_SAG * CURVE_MIDPOINT_SHARE },
    RING_RADIUS,
  );
}

function paintFront(ctx: Ctx, frame: CatBodyFrame): void {
  const { shape } = frame;
  if (frame.piece === 'barrel') {
    const girthY = shape.cy + shape.ry * FRONT_GIRTH_HEIGHT;
    const ringY = girthY + shape.ry * CHEST_STRAP_SAG * CURVE_MIDPOINT_SHARE;
    ctx.save();
    clipToOutline(ctx, frame.envelope);
    strapAcross(ctx, shape, girthY, CHEST_STRAP_SAG);
    strapDown(ctx, shape, ringY);
    ctx.restore();
    paintRing(ctx, BRASS, { x: shape.cx, y: ringY }, RING_RADIUS);
    return;
  }
  if (frame.piece !== 'ruff') return;
  const ringY = shape.cy + shape.ry * FRONT_RING_HEIGHT;
  ctx.save();
  clipToOutline(ctx, frame.envelope);
  strapDown(ctx, shape, shape.cy + shape.ry * STRAP_REACH);
  ctx.restore();
  paintRing(ctx, BRASS, { x: shape.cx, y: ringY }, RING_RADIUS);
}

/** From behind: the girth across her back and the back strap running up from it to her neck. */
function paintBack(ctx: Ctx, frame: CatBodyFrame): void {
  if (frame.piece !== 'barrel') return;
  const { shape } = frame;
  const girthY = shape.cy + shape.ry * BACK_GIRTH_HEIGHT;
  const ringY = girthY + shape.ry * BACK_GIRTH_SAG * CURVE_MIDPOINT_SHARE;
  ctx.save();
  clipToOutline(ctx, frame.envelope);
  strapAcross(ctx, shape, girthY, BACK_GIRTH_SAG);
  strapDown(ctx, shape, ringY);
  ctx.restore();
  paintRing(ctx, BRASS, { x: shape.cx, y: ringY }, RING_RADIUS);
}

export const CAT_VELVET_HARNESS = defineGarment({
  id: 'cat_velvet_harness',
  name: 'Velvet Harness',
  wearer: 'cat',
  material: 'cloth',
  layer: 'over',
  region: ['body'],
  paint: {
    body: withViewFallback(
      { front: paintFront, side: paintSide, back: paintBack },
      CAT_VIEW_FALLBACK,
    ),
  },
});
