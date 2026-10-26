/**
 * What the cat crawler's hats share: how they are fitted to her skull, how
 * they sit when she is lying down, and the painters that put one on her head.
 */

import type { CatHeadFrame, CatHeadLandmarks } from '../../art/catParts';
import type { CardinalView } from '../../facingView';
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

/** Where a hat sits on her head in one view, in the frame {@link hatPainters} fits it into. */
export interface HatSeat {
  readonly view: CardinalView;
  /** The hat's centre across her head: head-on slid with the turn, in profile the skull's centre. */
  readonly cx: number;
  /** The top of the skull, where the hat's seat is measured from. */
  readonly skullTop: number;
  readonly landmarks: CatHeadLandmarks;
}

export interface HatShape {
  /** Paints the hat on its seat; the context is already fitted to her skull. */
  readonly paint: (ctx: CanvasRenderingContext2D, seat: HatSeat) => void;
  /** How far a turned head slides the hat across the skull, head-on. */
  readonly turnSlide: number;
  /** The hat's own tilt in profile, positive toward her nose, about the top of her skull. */
  readonly profileTilt: number;
}

/**
 * The three cardinal painters of a hat painted once her whole head is on:
 * each fits the context to her skull, and in profile tilts the hat about the
 * skull's top and tips it back when she is lying down.
 */
export function hatPainters(shape: HatShape) {
  const headOn =
    (view: Exclude<CardinalView, 'side'>) =>
    (ctx: CanvasRenderingContext2D, frame: CatHeadFrame): void => {
      if (frame.piece !== 'top') return;
      const { landmarks } = frame;
      const fit = hatFitFor(landmarks, 'headOn');
      ctx.save();
      fitHatToSkull(ctx, landmarks, fit);
      const cx = landmarks.skull.cx + landmarks.turn * shape.turnSlide;
      shape.paint(ctx, { view, cx, skullTop: fit.skullTop, landmarks });
      ctx.restore();
    };
  const side = (
    ctx: CanvasRenderingContext2D,
    frame: CatHeadFrame,
    context: GarmentFrameContext<'cat'>,
  ): void => {
    if (frame.piece !== 'top') return;
    const { landmarks } = frame;
    const fit = hatFitFor(landmarks, 'profile');
    const cx = landmarks.skull.cx;
    ctx.save();
    fitHatToSkull(ctx, landmarks, fit);
    ctx.translate(cx, fit.skullTop);
    ctx.rotate(shape.profileTilt - lyingTipBack(context));
    ctx.translate(-cx, -fit.skullTop);
    shape.paint(ctx, { view: 'side', cx, skullTop: fit.skullTop, landmarks });
    ctx.restore();
  };
  return { front: headOn('front'), side, back: headOn('back') };
}
