/**
 * The seat of a pair of trousers for a figure built on Carl's rig, painted as
 * the rig's `overLegs` attachment: over the hips, from the waist to the
 * crotch, so no gap opens between the thighs the trouser legs cover. The legs
 * themselves are the `townsfolk_trousers` garment, painted on each leg from
 * the rig's own leg contour.
 */

import { shadeForm } from '../carl/paint';
import { type GlossRamp } from '../carl/palette';
import { type Skeleton, type ViewSpec } from '../carl/rig';

type Ctx = CanvasRenderingContext2D;

/**
 * Trousers carry a seat from the waist to the crotch, wide enough to swallow
 * the rig's hips; stockings under a long hem are slim and have none.
 */
export type LegwearCut = 'trousers' | 'stockings';

/** Half-width of the seat head-on, before the view's girth. */
const SEAT_HALF = 0.24;
/** Edge-on the seat runs well behind the hip, over the buttocks. */
const SEAT_PROFILE_HALF = 0.25;
const SEAT_DROP_BELOW_HIP = 0.2;
const SEAT_HEM_TAPER = 0.85;

/** Paints the seat of a pair of trousers in `cloth` over the skeleton's hips. */
export function paintTrouserSeat(
  ctx: Ctx,
  skeleton: Skeleton,
  view: ViewSpec,
  cloth: GlossRamp,
): void {
  const half = view.profile ? SEAT_PROFILE_HALF : SEAT_HALF * view.girth;
  const top = skeleton.waist.y;
  const bottom = skeleton.hip.y + SEAT_DROP_BELOW_HIP;
  const centreX = skeleton.hip.x;
  const trace = (): void => {
    ctx.beginPath();
    ctx.moveTo(centreX - half, top);
    ctx.lineTo(centreX + half, top);
    ctx.lineTo(centreX + half * SEAT_HEM_TAPER, bottom);
    ctx.lineTo(centreX - half * SEAT_HEM_TAPER, bottom);
    ctx.closePath();
  };
  shadeForm(ctx, trace, { from: { x: centreX, y: top }, to: { x: centreX, y: bottom } }, cloth, {
    halfWidth: half,
  });
}
