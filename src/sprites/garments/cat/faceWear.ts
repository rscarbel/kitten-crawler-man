/**
 * What the cat crawler's face pieces share: where a lens sits over each of
 * her eyes in every view, and the thin arm or chain that runs from a rim back
 * to her skull. Painted at her head's `features` moment, in head-local units,
 * so they ride every tilt and turn of her head and her ears still cover them.
 */

import type { CatHeadLandmarks } from '../../art/catParts';

type Ctx = CanvasRenderingContext2D;
type Pt = { readonly x: number; readonly y: number };

/** Bigger than her eye, so a rim sits on the fur round it rather than on the eye itself. */
export const CAT_LENS_RADIUS = 0.088;

/** In profile a lens is seen edge-on, so it narrows to this share of its width. */
export const PROFILE_LENS_SQUASH = 0.5;
/** Tilts a profile lens back with the slope of her brow. */
export const PROFILE_LENS_TILT = -0.18;
/** In profile the lens sits a little forward of her eye, on the slope of her muzzle. */
const PROFILE_LENS_FORWARD = 0.008;

/** Where an arm meets her skull face-on: out at her ear roots, a little above her eyes. */
export const TEMPLE_X = 0.21;
export const TEMPLE_RISE = -0.045;
/** In profile, where the near arm meets her skull in front of her ear. */
export const SIDE_TEMPLE: Pt = { x: -0.06, y: -0.065 };
/** From behind, how far out on her skull an arm shows, as a share of its half-width. */
export const BACK_ARM_SPREAD = 0.95;

/** Where each lens sits: both eyes head-on, the near one in profile, none from behind. */
export function lensCentres(landmarks: CatHeadLandmarks, profile: boolean): readonly Pt[] {
  if (!profile) return landmarks.eyes;
  return landmarks.eyes.map((eye) => ({ x: eye.x + PROFILE_LENS_FORWARD, y: eye.y }));
}

/** The temple point an arm runs back to from a lens on the screen-`side` of her face. */
export function templePoint(landmarks: CatHeadLandmarks, side: -1 | 1): Pt {
  const centreX = landmarks.eyes.reduce((sum, eye) => sum + eye.x, 0) / landmarks.eyes.length;
  return { x: centreX + side * TEMPLE_X, y: landmarks.eyeLine + TEMPLE_RISE };
}

export function strokeLine(ctx: Ctx, from: Pt, to: Pt, colour: string, width: number): void {
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.stroke();
}
