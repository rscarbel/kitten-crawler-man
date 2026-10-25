/**
 * The Enchanted BigBoi Boxers on the cat crawler: self-sizing white cotton
 * shorts scattered with red hearts, sized down round her hindquarters with
 * her tail out over the waistband. They cover her rump and the tops of her
 * haunches, so they show most from behind and in profile; head-on only their
 * edges show past her flanks.
 *
 * Painted onto her haunches and the back of her barrel as each is painted,
 * clipped to each piece's own outline, under anything worn over them.
 */

import type { CatBodyFrame, CatEllipse } from '../../art/catParts';
import { CAT_VIEW_FALLBACK } from '../../catViews';
import { hash1, hash2 } from '../../art/catArt';
import { defineGarment, withViewFallback } from '../garmentDef';
import { clipToOutline, fabricFill, strokeCurve, type FabricRamp } from './clothInk';

type Ctx = CanvasRenderingContext2D;
type Pt = { readonly x: number; readonly y: number };

const COTTON: FabricRamp = {
  shadow: '#a8a6b4',
  base: '#e8e6ee',
  light: '#ffffff',
  edge: '#8c8a98',
};
const HEART = '#d8263c';
/** A heart's half-width, tile units, and how many each piece carries. */
const HEART_SIZE = 0.022;
const HEARTS_PER_PIECE = 5;
const HEART_SEED = 17;
/** Where a heart's lobes and point sit, as shares of its half-width. */
const HEART_LOBE_DROP = 0.3;
const HEART_POINT = 1.1;
/** How far out each lobe swells, and how high its top rises, as shares of the heart's half-width. */
const HEART_LOBE_WIDTH = 2;
const HEART_LOBE_TOP = 1.2;
const WAISTBAND = '#c9c7d4';
const WAISTBAND_WIDTH = 0.03;
const HEM_WIDTH = 0.018;
const HEM_SAG = 0.12;
/** Room past a piece's radii every clip rectangle gives, as a share of them. */
const SPREAD = 2;

/** From behind the waistband crosses her barrel this share of its half-height below its middle. */
const BACK_WAISTBAND = 0.05;
/** The leg hems cross each haunch this share of its half-height below its middle. */
const HAUNCH_HEM = 0.35;
/** Head-on only the tops of her haunches show past her flanks, down to this share. */
const FRONT_HIP_HEM = -0.15;
/** In profile the waistband is this share of her barrel's half-length behind its middle, bowing back. */
const PROFILE_WAISTBAND = -0.35;
const PROFILE_WAISTBAND_BOW = 0.1;
const PROFILE_EDGE_REACH = 1.3;

function paintHeart(ctx: Ctx, at: Pt, size: number): void {
  ctx.beginPath();
  ctx.moveTo(at.x, at.y + size * HEART_POINT);
  ctx.bezierCurveTo(
    at.x - size * HEART_LOBE_WIDTH,
    at.y,
    at.x - size,
    at.y - size * HEART_LOBE_TOP,
    at.x,
    at.y - size * HEART_LOBE_DROP,
  );
  ctx.bezierCurveTo(
    at.x + size,
    at.y - size * HEART_LOBE_TOP,
    at.x + size * HEART_LOBE_WIDTH,
    at.y,
    at.x,
    at.y + size * HEART_POINT,
  );
  ctx.fillStyle = HEART;
  ctx.fill();
}

function paintCotton(ctx: Ctx, area: CatEllipse, seed: number): void {
  ctx.fillStyle = fabricFill(
    ctx,
    COTTON,
    { x: area.cx - area.rx, y: area.cy - area.ry },
    { x: area.cx + area.rx, y: area.cy + area.ry },
  );
  ctx.fillRect(
    area.cx - area.rx * SPREAD,
    area.cy - area.ry * SPREAD,
    area.rx * SPREAD * 2,
    area.ry * SPREAD * 2,
  );
  for (let heart = 0; heart < HEARTS_PER_PIECE; heart++) {
    paintHeart(
      ctx,
      {
        x: area.cx + (hash1(seed + heart) * 2 - 1) * area.rx,
        y: area.cy + (hash2(seed, heart) * 2 - 1) * area.ry,
      },
      HEART_SIZE,
    );
  }
}

/** A piece's lower edge as a sagging hem across it at `hemY`. */
function hemAcross(ctx: Ctx, area: CatEllipse, hemY: number): void {
  strokeCurve(
    ctx,
    { x: area.cx - area.rx, y: hemY },
    { x: area.cx, y: hemY + area.ry * HEM_SAG },
    { x: area.cx + area.rx, y: hemY },
    COTTON.edge,
    HEM_WIDTH,
  );
}

/** Covers a piece between `topY` and `bottomY`, lining the top with the waistband when it has one. */
function coverBand(
  ctx: Ctx,
  frame: CatBodyFrame,
  topY: number | null,
  bottomY: number,
  seed: number,
): void {
  const { shape } = frame;
  const top = topY ?? shape.cy - shape.ry * SPREAD;
  ctx.save();
  clipToOutline(ctx, frame.envelope);
  ctx.beginPath();
  ctx.rect(shape.cx - shape.rx * SPREAD, top, shape.rx * SPREAD * 2, bottomY - top);
  ctx.clip();
  paintCotton(ctx, shape, seed);
  hemAcross(ctx, shape, bottomY);
  if (topY !== null) {
    strokeCurve(
      ctx,
      { x: shape.cx - shape.rx, y: topY },
      { x: shape.cx, y: topY - shape.ry * HEM_SAG },
      { x: shape.cx + shape.rx, y: topY },
      WAISTBAND,
      WAISTBAND_WIDTH,
    );
  }
  ctx.restore();
}

function seedOf(frame: CatBodyFrame): number {
  return HEART_SEED + (frame.side === 'left' ? 1 : 0) + (frame.piece === 'barrel' ? 2 : 0);
}

function paintBack(ctx: Ctx, frame: CatBodyFrame): void {
  const { shape } = frame;
  if (frame.piece === 'barrel') {
    coverBand(
      ctx,
      frame,
      shape.cy + shape.ry * BACK_WAISTBAND,
      shape.cy + shape.ry * SPREAD,
      seedOf(frame),
    );
    return;
  }
  if (frame.piece === 'haunch') {
    coverBand(ctx, frame, null, shape.cy + shape.ry * HAUNCH_HEM, seedOf(frame));
  }
}

function paintFront(ctx: Ctx, frame: CatBodyFrame): void {
  if (frame.piece !== 'haunch') return;
  const { shape } = frame;
  coverBand(ctx, frame, null, shape.cy + shape.ry * FRONT_HIP_HEM, seedOf(frame));
}

/** In profile: her near haunch to its hem, and her barrel behind a waistband bowed toward her tail. */
function paintSide(ctx: Ctx, frame: CatBodyFrame): void {
  const { shape } = frame;
  if (frame.piece === 'haunch') {
    coverBand(ctx, frame, null, shape.cy + shape.ry * HAUNCH_HEM, seedOf(frame));
    return;
  }
  if (frame.piece !== 'barrel') return;
  const edgeX = shape.cx + shape.rx * PROFILE_WAISTBAND;
  const top = { x: edgeX, y: shape.cy - shape.ry * PROFILE_EDGE_REACH };
  const bottom = { x: edgeX, y: shape.cy + shape.ry * PROFILE_EDGE_REACH };
  const bow = { x: edgeX - shape.rx * PROFILE_WAISTBAND_BOW, y: shape.cy };
  ctx.save();
  clipToOutline(ctx, frame.envelope);
  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.quadraticCurveTo(bow.x, bow.y, bottom.x, bottom.y);
  ctx.lineTo(shape.cx - shape.rx * SPREAD, bottom.y);
  ctx.lineTo(shape.cx - shape.rx * SPREAD, top.y);
  ctx.closePath();
  ctx.clip();
  paintCotton(ctx, shape, seedOf(frame));
  strokeCurve(ctx, top, bow, bottom, WAISTBAND, WAISTBAND_WIDTH);
  ctx.restore();
}

export const CAT_BIGBOI_BOXERS = defineGarment({
  id: 'cat_bigboi_boxers',
  name: 'Enchanted BigBoi Boxers',
  wearer: 'cat',
  material: 'cloth',
  layer: 'under',
  region: ['body'],
  paint: {
    body: withViewFallback(
      { front: paintFront, side: paintSide, back: paintBack },
      CAT_VIEW_FALLBACK,
    ),
  },
});
