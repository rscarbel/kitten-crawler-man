/**
 * A hand together with whatever it holds, layered the way the fingers and the
 * object really overlap.
 *
 * - The deck lies in the left palm. The palm and the roots of the fingers are
 *   under it; the fingers come up its outer edge and their curled tips fold
 *   over onto the top card, nails showing; the thumb lies along the top.
 * - A dealt card is pinched by its near edge: index and middle fingers under
 *   it, their length showing up to where the card begins, the thumb on top.
 */

import { type Pt } from '../carlArt';
import { type CardSize, cardCorners, paintCardBack, paintDeck, paintTurningCard } from './cards';
import { BitmapCache, quantize } from './bitmapCache';
import {
  type HandDetail,
  type HandPaintOptions,
  type HandPlacement,
  type HandPose,
  paintHand,
} from './hand';
import { type Ctx, pt } from './paint';

export type Grip = 'none' | 'deck' | 'card' | 'flip';

export interface GripBuild {
  handLength: number;
  card: CardSize;
  detail: HandDetail;
}

// Where held things sit in a hand's own frame (see `hand.ts`): wrist at the
// origin, knuckles near x 0.5, thumb side +y.
/** The deck's near half lies over the palm, its far edge across the finger roots. */
const DECK_IN_PALM = pt(0.44, -0.02);
/** A pinched card begins at the middle joints of index and middle and runs on past the tips. */
const PINCHED_CARD_IN_HAND = pt(0.86, 0.1);
const PINCHED_CARD_TILT = 0.35;
const FLIP_CARD_IN_HAND = pt(0.78, 0.16);
const FLIP_CARD_TILT = 0.3;

/**
 * A hand is the costliest thing Deuce paints — a palm and fifteen shaded
 * digits — and it moves through the same few poses over and over, so each
 * pose is painted once at its angle and blitted after. Angle and pose values
 * are snapped to steps finer than anything visible.
 */
const HAND_CACHE_ENTRIES = 96;
const handCache = new BitmapCache(HAND_CACHE_ENTRIES);
const ANGLE_STEP = 0.02;
const POSE_STEP = 0.04;
/** The cached square round a wrist reaches past the fingertips, whichever way the hand points. */
const HAND_REACH = 1.1;

function cachedHand(
  ctx: Ctx,
  placement: HandPlacement,
  hand: HandPose,
  options: HandPaintOptions,
): void {
  const step = (value: number): number => quantize(value, POSE_STEP);
  const snapped: HandPose = {
    view: hand.view,
    curls: [step(hand.curls[0]), step(hand.curls[1]), step(hand.curls[2]), step(hand.curls[3])],
    spread: step(hand.spread),
    thumbOut: step(hand.thumbOut),
    thumbBend: step(hand.thumbBend),
  };
  const angle = quantize(placement.angle, ANGLE_STEP);
  const key = [
    options.layer ?? 'all',
    options.thumbWithFingertips ?? false,
    options.detail ?? 'full',
    snapped.view,
    ...snapped.curls,
    snapped.spread,
    snapped.thumbOut,
    snapped.thumbBend,
    angle,
    placement.thumbSide,
    placement.length,
  ].join(',');
  const reach = placement.length * HAND_REACH;
  ctx.save();
  ctx.translate(placement.wrist.x, placement.wrist.y);
  handCache.draw(ctx, key, { x: -reach, y: -reach, w: reach * 2, h: reach * 2 }, (target) =>
    paintHand(target, { ...placement, wrist: pt(0, 0), angle }, snapped, options),
  );
  ctx.restore();
}

/** Maps a point in a hand's own frame (see `hand.ts`) into the caller's space. */
export function handPoint(placement: HandPlacement, local: Pt): Pt {
  const c = Math.cos(placement.angle);
  const s = Math.sin(placement.angle);
  const x = local.x * placement.length;
  const y = local.y * placement.length * -placement.thumbSide;
  return pt(placement.wrist.x + x * c - y * s, placement.wrist.y + x * s + y * c);
}

/** Paints `hand` at `placement` holding what `grip` says; `flip` turns a lifted card. */
export function paintGrippingHand(
  ctx: Ctx,
  build: GripBuild,
  placement: HandPlacement,
  hand: HandPose,
  grip: Grip,
  flip: number,
): void {
  const detail = build.detail;
  if (grip === 'deck') {
    cachedHand(ctx, placement, hand, { layer: 'body', detail });
    // The deck's short side runs along the fingers, so its far edge sits
    // across the finger roots and the curled tips land just over that edge.
    paintDeck(ctx, build.card, handPoint(placement, DECK_IN_PALM), placement.angle);
    cachedHand(ctx, placement, hand, { layer: 'fingertips', thumbWithFingertips: true, detail });
    return;
  }
  if (grip === 'card' || grip === 'flip') {
    cachedHand(ctx, placement, hand, { layer: 'fingertips', detail });
    if (grip === 'flip') {
      const centre = handPoint(placement, FLIP_CARD_IN_HAND);
      paintTurningCard(ctx, build.card, centre, placement.angle - FLIP_CARD_TILT, flip);
    } else {
      const centre = handPoint(placement, PINCHED_CARD_IN_HAND);
      const angle = placement.angle - PINCHED_CARD_TILT;
      paintCardBack(ctx, cardCorners(centre, angle, build.card.width, build.card.height));
    }
    cachedHand(ctx, placement, hand, { layer: 'body', detail });
    return;
  }
  cachedHand(ctx, placement, hand, { detail });
}
