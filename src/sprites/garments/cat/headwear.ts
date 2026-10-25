/**
 * What the cat crawler's hats share: how they sit when she is lying down.
 */

import type { CatHeadLandmarks } from '../../art/catParts';
import type { GarmentFrameContext } from '../garmentDef';

/** A roll past this is her lying on her side. */
const LYING_ROLL = 0.2;

/**
 * Lying on her side her head is turned down onto the floor, and a hat that
 * turned with it covered her face. Down, a hat rides back on her skull
 * instead: this is the turn, back against her head's own tilt, to give it.
 */
export function lyingTipBack(context: GarmentFrameContext<'cat'>): number {
  return context.pose.roll > LYING_ROLL ? context.pose.headTilt : 0;
}

/**
 * The skull half-widths, head-on and in profile, that the cat's hats are
 * drawn in head units for: the broad head they were first drawn on. A cat
 * with another skull wears them scaled by her own skull's share of these, so
 * a hat sized for a broad head does not swallow a narrow one's face. Fixed
 * numbers rather than any look's live proportions: the hats' own measurements
 * are in these units, and a look's head can change without redrawing them.
 */
const FITTED_SKULL_HALF_WIDTH = {
  headOn: 0.25,
  profile: 0.2,
} as const;

type HatView = keyof typeof FITTED_SKULL_HALF_WIDTH;

/** How a hat drawn for {@link FITTED_SKULL_HALF_WIDTH} sits on this skull. */
export interface HatFit {
  /** The scale about the skull's centre that fits the hat to it. */
  readonly scale: number;
  /** The top of the skull in the fitted frame, where a hat's seat is measured from. */
  readonly skullTop: number;
}

export function hatFitFor(landmarks: CatHeadLandmarks, view: HatView): HatFit {
  const { cy, rx, ry } = landmarks.skull;
  const scale = rx / FITTED_SKULL_HALF_WIDTH[view];
  return { scale, skullTop: cy - ry / scale };
}

/**
 * Scales the context about the skull's centre by the fit: what puts a hat
 * drawn for the reference skull onto this one. A fit of 1 leaves the context
 * untouched.
 */
export function fitHatToSkull(
  ctx: CanvasRenderingContext2D,
  landmarks: CatHeadLandmarks,
  fit: HatFit,
): void {
  if (fit.scale === 1) return;
  const { cx, cy } = landmarks.skull;
  ctx.translate(cx, cy);
  ctx.scale(fit.scale, fit.scale);
  ctx.translate(-cx, -cy);
}
