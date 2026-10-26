/**
 * A garment worn over the cat crawler's barrel, the way a coat is made for a
 * dog: it covers her chest head-on, her back from behind down to her hips,
 * and in profile her chest and the front of her barrel back to a hem that
 * curves over her flank before her haunch. Her haunches, belly, legs and tail
 * stay bare.
 *
 * Painted onto each piece of her body as it is painted, clipped to the
 * piece's own outline, so it follows her silhouette and her head and legs,
 * painted later, cover it.
 */

import type { CatBodyFrame, CatEllipse } from '../../art/catParts';
import type { CardinalView } from '../../facingView';
import { clipToOutline, fabricFill, strokeCurve, type FabricRamp } from './clothInk';

type Ctx = CanvasRenderingContext2D;

export interface TorsoCoverSpec {
  readonly fabric: FabricRamp;
  readonly hemWidth: number;
  /** Paints the fabric's own detail (seams, a pattern) over a covered piece, inside its clip. */
  readonly detail: (ctx: Ctx, area: CatEllipse, view: CardinalView) => void;
  /** Where its hems fall, when it is cut shorter or longer than a dog's coat. */
  readonly cut?: Partial<TorsoCoverCut>;
}

/** Where a cover's hems fall on her, each as a share of the piece it crosses. */
export interface TorsoCoverCut {
  /** Head-on, below the middle of her chest. */
  readonly frontHem: number;
  /** From behind, below the middle of her barrel. */
  readonly backHem: number;
  /** In profile, the back edge, from the barrel's middle toward her nose. */
  readonly profileBackEdge: number;
}

/** Head-on the hem crosses her chest this share of its half-height below its middle, sagging. */
const FRONT_HEM = 0.72;
/** From behind it ends this share of her barrel's half-height below its middle, above her rump. */
const BACK_HEM = 0.35;
const HEM_SAG = 0.15;
/** In profile it runs back from her chest to this share of her barrel's half-length behind its middle. */
const PROFILE_BACK_EDGE = -0.3;
const DOG_COAT_CUT: TorsoCoverCut = {
  frontHem: FRONT_HEM,
  backHem: BACK_HEM,
  profileBackEdge: PROFILE_BACK_EDGE,
};
/** Its back edge bows toward her tail at the flank's middle. */
const PROFILE_EDGE_BOW = 0.12;
/** The back edge runs past the barrel's top and bottom by this share, so the clip leaves no gap. */
const PROFILE_EDGE_REACH = 1.3;
/** Room past a piece's ellipse every clip rectangle gives, as a share of its radii. */
const CLIP_SPREAD = 2;

function cutOf(spec: TorsoCoverSpec): TorsoCoverCut {
  return { ...DOG_COAT_CUT, ...spec.cut };
}

function fillPiece(ctx: Ctx, spec: TorsoCoverSpec, area: CatEllipse, view: CardinalView): void {
  ctx.fillStyle = fabricFill(
    ctx,
    spec.fabric,
    { x: area.cx - area.rx, y: area.cy - area.ry },
    { x: area.cx + area.rx, y: area.cy + area.ry },
  );
  ctx.fillRect(
    area.cx - area.rx * CLIP_SPREAD,
    area.cy - area.ry * CLIP_SPREAD,
    area.rx * CLIP_SPREAD * 2,
    area.ry * CLIP_SPREAD * 2,
  );
  spec.detail(ctx, area, view);
}

function hemAcross(ctx: Ctx, spec: TorsoCoverSpec, area: CatEllipse, hemY: number): void {
  strokeCurve(
    ctx,
    { x: area.cx - area.rx, y: hemY },
    { x: area.cx, y: hemY + area.ry * HEM_SAG },
    { x: area.cx + area.rx, y: hemY },
    spec.fabric.edge,
    spec.hemWidth,
  );
}

/** Covers `frame` down to `hemShare` of its half-height below its middle. */
function coverDownTo(
  ctx: Ctx,
  spec: TorsoCoverSpec,
  frame: CatBodyFrame,
  hemShare: number,
  view: CardinalView,
): void {
  const { shape } = frame;
  const hemY = shape.cy + shape.ry * hemShare;
  ctx.save();
  clipToOutline(ctx, frame.envelope);
  ctx.beginPath();
  ctx.moveTo(shape.cx - shape.rx * CLIP_SPREAD, shape.cy - shape.ry * CLIP_SPREAD);
  ctx.lineTo(shape.cx + shape.rx * CLIP_SPREAD, shape.cy - shape.ry * CLIP_SPREAD);
  ctx.lineTo(shape.cx + shape.rx * CLIP_SPREAD, hemY);
  ctx.quadraticCurveTo(
    shape.cx,
    hemY + shape.ry * HEM_SAG * 2,
    shape.cx - shape.rx * CLIP_SPREAD,
    hemY,
  );
  ctx.closePath();
  ctx.clip();
  fillPiece(ctx, spec, shape, view);
  hemAcross(ctx, spec, shape, hemY);
  ctx.restore();
}

function paintFront(spec: TorsoCoverSpec) {
  return (ctx: Ctx, frame: CatBodyFrame): void => {
    if (frame.piece !== 'barrel' && frame.piece !== 'blade' && frame.piece !== 'ruff') return;
    coverDownTo(ctx, spec, frame, cutOf(spec).frontHem, 'front');
  };
}

function paintBack(spec: TorsoCoverSpec) {
  return (ctx: Ctx, frame: CatBodyFrame): void => {
    if (frame.piece !== 'barrel') return;
    coverDownTo(ctx, spec, frame, cutOf(spec).backHem, 'back');
  };
}

/**
 * In profile the chest is covered whole, and the barrel forward of a back
 * edge that bows toward her tail. Her belly stays bare under it, the way a
 * coat made for a four-legged animal leaves the underside open.
 */
function paintSide(spec: TorsoCoverSpec) {
  return (ctx: Ctx, frame: CatBodyFrame): void => {
    if (frame.piece === 'chest') {
      ctx.save();
      clipToOutline(ctx, frame.envelope);
      fillPiece(ctx, spec, frame.shape, 'side');
      ctx.restore();
      return;
    }
    if (frame.piece !== 'barrel') return;
    const barrel = frame.shape;
    const edgeX = barrel.cx + barrel.rx * cutOf(spec).profileBackEdge;
    const top = { x: edgeX, y: barrel.cy - barrel.ry * PROFILE_EDGE_REACH };
    const bottom = { x: edgeX, y: barrel.cy + barrel.ry * PROFILE_EDGE_REACH * CLIP_SPREAD };
    const bow = { x: edgeX - barrel.rx * PROFILE_EDGE_BOW, y: barrel.cy };
    ctx.save();
    clipToOutline(ctx, frame.envelope);
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.quadraticCurveTo(bow.x, bow.y, bottom.x, bottom.y);
    ctx.lineTo(barrel.cx + barrel.rx * CLIP_SPREAD, bottom.y);
    ctx.lineTo(barrel.cx + barrel.rx * CLIP_SPREAD, top.y);
    ctx.closePath();
    ctx.clip();
    fillPiece(ctx, spec, frame.shape, 'side');
    strokeCurve(ctx, top, bow, bottom, spec.fabric.edge, spec.hemWidth);
    ctx.restore();
  };
}

/** The painters for each view. */
export function torsoCoverPainters(
  spec: TorsoCoverSpec,
): Readonly<Record<CardinalView, (ctx: Ctx, frame: CatBodyFrame) => void>> {
  return { front: paintFront(spec), side: paintSide(spec), back: paintBack(spec) };
}
