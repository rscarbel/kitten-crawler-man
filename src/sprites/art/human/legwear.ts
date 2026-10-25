/**
 * The seat of a pair of trousers for a figure built on the biped rig: over the
 * hips, from the waist to the crotch, so no gap opens between the thighs the
 * trouser legs cover. The cast paints it as the rig's `overLegs` attachment and
 * Dave's jeans on the rig's hips part; both are painted in the same slab, just
 * after the legs. The legs themselves are painted on each leg from the rig's
 * own leg contour (`paintLegCloth`).
 */

import { shadeForm } from '../biped/paint';
import { type GlossRamp } from '../biped/palette';
import { type Skeleton, type ViewSpec } from '../biped/rig';
import { type Pt } from '../bipedArt';
import { bareSegmentEdges, type LimbBuild, RIG_LIMBS } from '../biped/limbs';
import { type BoneChain } from '../biped/rig';

type Ctx = CanvasRenderingContext2D;

/**
 * Loose trousers, a slim trouser cut close to the leg, or stockings that hug
 * it. Trousers carry a seat from the waist to the crotch, wide enough to
 * swallow the rig's hips; stockings under a long hem are slim and have none.
 */
export type LegwearCut = 'trousers' | 'slimTrousers' | 'stockings';

/**
 * Where the light turns to shadow across a slim trouser leg. A slim leg is two
 * pixels across at the tile, and with the terminator far over toward its
 * shadow edge, where a near-vertical leg under a high key light puts it, both
 * pixels average to the lit cloth and the leg reads as a flat dark strip. Set
 * at the middle, one pixel takes the light and the other the shadow.
 */
const SLIM_LEG_TERMINATOR = 0.5;

/**
 * How much fuller than the bare leg each cut stands: loose trousers clear the
 * muscle by a good margin, a slim cut by less, stockings hug it. The margin is
 * in figure units, so the slim ankle is covered as surely as the broad thigh.
 * The legs are cut by it, and so is the top of each leg a `'legs'` seat
 * carries up to the waist, so the two meet at one width.
 */
export const LEG_COVER: Readonly<
  Record<LegwearCut, { grow: number; margin: number; terminator?: number }>
> = {
  trousers: { grow: 1.08, margin: 0.018 },
  slimTrousers: { grow: 1, margin: 0.024, terminator: SLIM_LEG_TERMINATOR },
  stockings: { grow: 1.02, margin: 0.012 },
};

/** Half-width of the seat head-on, before the view's girth. */
const SEAT_HALF = 0.24;
/** Edge-on the seat runs well behind the hip, over the buttocks. */
const SEAT_PROFILE_HALF = 0.25;
const SEAT_DROP_BELOW_HIP = 0.2;
const SEAT_HEM_TAPER = 0.85;
/**
 * Edge-on the seat's hem corners are rounded off by this share of its
 * half-width: the cloth there wraps the buttock, and a square corner reads
 * as a box stuck on the hip once the body bends or kneels.
 */
const SEAT_PROFILE_CORNER_SHARE = 0.8;

interface SeatShape {
  readonly top: Pt;
  readonly bottom: Pt;
  /** Unit vector from the waist toward the hip. */
  readonly down: Pt;
  /** Unit vector across the seat, square to {@link down}. */
  readonly across: Pt;
  readonly half: number;
}

/**
 * The seat runs down the line from the waist through the hip and past it to
 * the crotch, so it turns with the pelvis: a seat stood upright under a body
 * bent double or lying down juts out of it as a box.
 */
function seatShape(skeleton: Skeleton, view: ViewSpec, fit: SeatFit = RIG_SEAT): SeatShape {
  const { waist, hip } = skeleton;
  const spineX = hip.x - waist.x;
  const spineY = hip.y - waist.y;
  const spineLength = Math.hypot(spineX, spineY);
  const down =
    spineLength === 0 ? { x: 0, y: 1 } : { x: spineX / spineLength, y: spineY / spineLength };
  return {
    top: waist,
    bottom: {
      x: hip.x + down.x * SEAT_DROP_BELOW_HIP * fit.drop,
      y: hip.y + down.y * SEAT_DROP_BELOW_HIP * fit.drop,
    },
    down,
    across: { x: down.y, y: -down.x },
    half: view.profile ? SEAT_PROFILE_HALF : SEAT_HALF * view.girth,
  };
}

/** Traces the seat of a pair of trousers over the skeleton's hips as a closed path. */
export function traceTrouserSeat(
  ctx: Ctx,
  skeleton: Skeleton,
  view: ViewSpec,
  fit: SeatFit = RIG_SEAT,
): void {
  const { top, bottom, across, down, half } = seatShape(skeleton, view, fit);
  const hemHalf = half * SEAT_HEM_TAPER;
  const corner = view.profile ? hemHalf * SEAT_PROFILE_CORNER_SHARE : 0;
  /** A point `sideways` across the seat from `base` and `up` back toward the waist. */
  const offset = (base: Pt, sideways: number, up: number): Pt => ({
    x: base.x + across.x * sideways - down.x * up,
    y: base.y + across.y * sideways - down.y * up,
  });
  const topLeft = offset(top, -half, 0);
  const topRight = offset(top, half, 0);
  const rightCornerStart = offset(bottom, hemHalf, corner);
  const rightCorner = offset(bottom, hemHalf, 0);
  const rightCornerEnd = offset(bottom, hemHalf - corner, 0);
  const leftCornerStart = offset(bottom, corner - hemHalf, 0);
  const leftCorner = offset(bottom, -hemHalf, 0);
  const leftCornerEnd = offset(bottom, -hemHalf, corner);
  ctx.beginPath();
  ctx.moveTo(topLeft.x, topLeft.y);
  ctx.lineTo(topRight.x, topRight.y);
  ctx.lineTo(rightCornerStart.x, rightCornerStart.y);
  ctx.quadraticCurveTo(rightCorner.x, rightCorner.y, rightCornerEnd.x, rightCornerEnd.y);
  ctx.lineTo(leftCornerStart.x, leftCornerStart.y);
  ctx.quadraticCurveTo(leftCorner.x, leftCorner.y, leftCornerEnd.x, leftCornerEnd.y);
  ctx.closePath();
}

/**
 * How a seat is cut against the rig's heavy one: its width head-on, its depth
 * edge-on, and whether head-on and from behind it is a panel of its own or
 * the tops of the two trouser legs.
 */
export interface SeatFit {
  readonly across: number;
  readonly depth: number;
  /** How far below the hip it reaches, against the rig's seat. */
  readonly drop: number;
  readonly style: SeatStyle;
}

/**
 * `'panel'`: one form across the hips, hemmed straight across. `'legs'`: the
 * two trouser legs of `cut` carried on up to the waist and joined at the
 * crotch, each half shaded as the top of its own leg at that leg's width, so
 * the seat and the legs read as one cloth — a panel shaded on its own reads
 * as shorts over the trousers.
 */
export type SeatStyle =
  { readonly kind: 'panel' } | { readonly kind: 'legs'; readonly cut: LegwearCut };

/** The rig's own seat. */
export const RIG_SEAT: SeatFit = { across: 1, depth: 1, drop: 1, style: { kind: 'panel' } };
/**
 * The seat takes the same soft sheen the trouser legs do: shaded without it,
 * it is a flat darker panel between the legs and reads as shorts worn over
 * the trousers.
 */
const SEAT_SPECULAR = 0.25;

/**
 * Paints the seat of a pair of trousers in `cloth` over the skeleton's hips.
 * `fit` draws it narrower head-on, or shallower front to back edge-on, than
 * the rig's heavy seat, about the hip, for a leaner build.
 */
export function paintTrouserSeat(
  ctx: Ctx,
  skeleton: Skeleton,
  view: ViewSpec,
  cloth: GlossRamp,
  fit: SeatFit = RIG_SEAT,
  build: LimbBuild = RIG_LIMBS,
): void {
  if (fit.style.kind === 'legs' && !view.profile) {
    paintLegsSeat(ctx, skeleton, view, cloth, fit, fit.style.cut, build);
    return;
  }
  const { top, bottom, half } = seatShape(skeleton, view, fit);
  const squeeze = view.profile ? fit.depth : fit.across;
  ctx.save();
  if (fit !== RIG_SEAT) {
    ctx.translate(skeleton.hip.x, 0);
    ctx.scale(squeeze, 1);
    ctx.translate(-skeleton.hip.x, 0);
  }
  shadeForm(
    ctx,
    () => traceTrouserSeat(ctx, skeleton, view, fit),
    { from: top, to: bottom },
    cloth,
    {
      halfWidth: half,
      specular: SEAT_SPECULAR,
    },
  );
  ctx.restore();
}

/** The leg's specular, which its top on the seat carries on. */
const LEG_TOP_SPECULAR = 0.25;
/**
 * The seat's hem climbs from the crotch, at the seat's own bottom, to the
 * outside of each hip this share of the way down from the hips' line, and the
 * thighs carry on below.
 */
const HIP_SIDE_SHARE = 0.25;

/**
 * Head-on and from behind, the seat as the tops of the two trouser legs: the
 * seat's outline with its hem climbing from the crotch to each hip, each half
 * shaded straight down its own thigh's line at that thigh's own width.
 */
function paintLegsSeat(
  ctx: Ctx,
  skeleton: Skeleton,
  view: ViewSpec,
  cloth: GlossRamp,
  fit: SeatFit,
  cut: LegwearCut,
  build: LimbBuild,
): void {
  const { top, bottom, across, down, half } = seatShape(skeleton, view, fit);
  const seatHalf = half * fit.across;
  const at = (base: Pt, sideways: number, along: number): Pt => ({
    x: base.x + across.x * sideways + down.x * along,
    y: base.y + across.y * sideways + down.y * along,
  });
  const drop = Math.hypot(bottom.x - skeleton.hip.x, bottom.y - skeleton.hip.y);
  const crotch = at(skeleton.hip, 0, drop);
  const traceSeat = (): void => {
    const topLeft = at(top, -seatHalf, 0);
    const topRight = at(top, seatHalf, 0);
    const hipRight = at(skeleton.hip, seatHalf, drop * HIP_SIDE_SHARE);
    const hipLeft = at(skeleton.hip, -seatHalf, drop * HIP_SIDE_SHARE);
    ctx.beginPath();
    ctx.moveTo(topLeft.x, topLeft.y);
    ctx.lineTo(topRight.x, topRight.y);
    ctx.lineTo(hipRight.x, hipRight.y);
    ctx.lineTo(crotch.x, crotch.y);
    ctx.lineTo(hipLeft.x, hipLeft.y);
    ctx.closePath();
  };
  const thighRoot = bareSegmentEdges('thigh', 0, false, build);
  const { grow, margin } = LEG_COVER[cut];
  const legHalf = Math.min(thighRoot.plus, thighRoot.minus) * grow + margin;
  traceSeat();
  ctx.fillStyle = cloth.base;
  ctx.fill();
  for (const leg of [skeleton.leftLeg, skeleton.rightLeg]) {
    const centreSide = leg === skeleton.leftLeg ? -1 : 1;
    const traceHalf = (): void => {
      ctx.beginPath();
      const reach = seatHalf * HALF_REACH;
      const a = at(top, 0, -reach);
      const b = at(top, centreSide * reach, -reach);
      const c = at(crotch, centreSide * reach, reach);
      const d = at(crotch, 0, reach);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.closePath();
    };
    ctx.save();
    traceSeat();
    ctx.clip();
    shadeForm(ctx, traceHalf, thighLine(leg, top), cloth, {
      halfWidth: legHalf,
      specular: LEG_TOP_SPECULAR,
    });
    ctx.restore();
  }
}

/** How far past the seat each half's clip reaches, so the seat's own outline ends it. */
const HALF_REACH = 3;

/**
 * The least a thigh may drop, figure units from hip to knee, for its line to
 * be carried up to the waist along it. A thigh raised near level — a high
 * knee, a kick — would carry the line out sideways by the rise over that drop,
 * far past the seat; such a thigh's top is shaded straight up instead.
 */
const MIN_THIGH_DROP = 0.05;

/** A thigh's own line, carried up from its root to the height of `waist`. */
function thighLine(leg: BoneChain, waist: Pt): { from: Pt; to: Pt } {
  const dx = leg.joint.x - leg.root.x;
  const dy = leg.joint.y - leg.root.y;
  const rise = leg.root.y - waist.y;
  if (dy < MIN_THIGH_DROP) return { from: { x: leg.root.x, y: waist.y }, to: leg.root };
  const back = rise / dy;
  const from = { x: leg.root.x - dx * back, y: leg.root.y - dy * back };
  return { from, to: leg.joint };
}
