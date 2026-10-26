/**
 * What the cat's footwear shares: a bootie over each of her four paws and up
 * the bottom of the leg piece that ends at it, lit and shaded with the leg.
 * Each pair differs in its fabric, how far up the leg its shaft rises, the
 * cuff at its top and the sole under it.
 *
 * Painted over each paw and leg piece as it is painted, clipped to the
 * piece's own outline, so the bootie follows her silhouette and whatever is
 * painted later (the near leg over the far one) covers it.
 */

import type { CatLegFrame } from '../../art/catParts';
import { CAT_VIEW_FALLBACK } from '../../catViews';
import { withViewFallback } from '../garmentDef';
import { clipToOutline, fabricFill, shadeOver, type FabricRamp } from './clothInk';

type Ctx = CanvasRenderingContext2D;

const FULL_TURN = Math.PI * 2;

/** A sole across the bottom of the paw: its colour, and where it starts down the paw. */
export interface BootieSole {
  readonly colour: string;
  /** The sole covers the paw below this share of its half-height under its centre. */
  readonly from: number;
  /** Studs along the sole, catching the light: none for a soft sole. */
  readonly studs: {
    readonly colour: string;
    readonly count: number;
    readonly radius: number;
  } | null;
}

export interface BootieLook {
  readonly fabric: FabricRamp;
  /** How far up the leg piece that ends at the paw the shaft rises, as a share of its length. */
  readonly shaftShare: number;
  /** The rolled cuff at the shaft's top, in the fabric's edge colour; 0 for none. */
  readonly cuffWidth: number;
  /**
   * How far the cuff stands out past the leg each side, in tile units. A
   * bootie in a colour of her own still reads as a sock marking at the tile;
   * a cuff that bulges the leg's silhouette is something fur never does.
   */
  readonly cuffFlare: number;
  readonly sole: BootieSole | null;
}

/** Room past a piece's radii the fill and clips give, as a share of them. */
const SPREAD = 2;
/** The studs sit halfway down the sole. */
const STUD_DEPTH = 1 / 2;

function paintFoot(ctx: Ctx, look: BootieLook, frame: CatLegFrame & { piece: 'paw' }): void {
  const { radiusX: rx, radiusY: ry, shade } = frame;
  ctx.save();
  clipToOutline(ctx, frame.envelope);
  ctx.fillStyle = fabricFill(ctx, look.fabric, { x: -rx, y: -ry }, { x: rx, y: ry });
  ctx.fillRect(-rx * SPREAD, -ry * SPREAD, rx * SPREAD * 2, ry * SPREAD * 2);
  const { sole } = look;
  if (sole !== null) {
    ctx.fillStyle = sole.colour;
    ctx.fillRect(-rx * SPREAD, ry * sole.from, rx * SPREAD * 2, ry * SPREAD);
  }
  shadeOver(ctx, shade, -rx * SPREAD, -ry * SPREAD, rx * SPREAD * 2, ry * SPREAD * 2);
  const studs = sole?.studs ?? null;
  if (sole !== null && studs !== null) {
    const studY = ry * (sole.from + (1 - sole.from) * STUD_DEPTH);
    ctx.fillStyle = studs.colour;
    for (let stud = 0; stud < studs.count; stud++) {
      const x = rx * ((stud + 1) / (studs.count + 1) - 1 / 2) * SPREAD;
      ctx.beginPath();
      ctx.arc(x, studY, studs.radius, 0, FULL_TURN);
      ctx.fill();
    }
  }
  ctx.restore();
}

/**
 * The shaft over the bottom of the leg piece that ends at the paw: a column,
 * a lower leg, or a hock bone — never the shank above a hock, or a hocked leg
 * would wear two cuffs.
 */
function paintShaft(ctx: Ctx, look: BootieLook, frame: CatLegFrame): void {
  if (frame.piece === 'paw' || frame.piece === 'upper' || frame.piece === 'shank') return;
  const top = frame.length * (1 - look.shaftShare);
  const half = frame.halfWidth * SPREAD;
  ctx.save();
  clipToOutline(ctx, frame.envelope);
  ctx.fillStyle = fabricFill(ctx, look.fabric, { x: -half, y: top }, { x: half, y: frame.length });
  ctx.fillRect(-half, top, half * 2, frame.length * SPREAD);
  shadeOver(ctx, frame.shade, -half, top, half * 2, frame.length * SPREAD);
  ctx.restore();
  if (look.cuffWidth > 0) paintCuff(ctx, look, frame.halfWidth, top, frame.shade);
}

/** The cuff, painted past the leg's outline so it bulges her silhouette, shaded with the leg. */
function paintCuff(
  ctx: Ctx,
  look: BootieLook,
  legHalfWidth: number,
  top: number,
  shade: number,
): void {
  const half = legHalfWidth + look.cuffFlare;
  ctx.beginPath();
  ctx.roundRect(-half, top, half * 2, look.cuffWidth, look.cuffWidth / 2);
  ctx.fillStyle = look.fabric.edge;
  ctx.fill();
  ctx.save();
  ctx.clip();
  shadeOver(ctx, shade, -half, top, half * 2, look.cuffWidth);
  ctx.restore();
}

/** A painter for every view of either leg pair, wearing `look`. */
export function bootiePainters(look: BootieLook) {
  const paintLeg = (ctx: Ctx, frame: CatLegFrame): void => {
    if (frame.piece === 'paw') paintFoot(ctx, look, frame);
    else paintShaft(ctx, look, frame);
  };
  return withViewFallback({ front: paintLeg, side: paintLeg, back: paintLeg }, CAT_VIEW_FALLBACK);
}
