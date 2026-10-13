/**
 * Which of Donut's views each facing view is drawn in. Kept apart from her
 * sprite so her garments can borrow the same choice for a facing she has no
 * rows of her own for, without importing the sprite.
 */

import type { CardinalView, FacingView } from './facingView';

/**
 * The facing views Donut has no rows of her own for, and the view whose rows
 * each one draws instead: both three-quarter views in profile, east or west.
 * The one place a missing view is filled in; a view that gains its own rows
 * loses its entry here, and `OWN_ROWS` in `catSprite.ts` then has to name her
 * rows for it.
 *
 * Three-quarter rows painted from a pose in her own body space were rejected:
 * her coat patches broke her back and rump into a jumble at the in-game size,
 * and her black left cheek swallowed her face (see the `add-sprite` skill's
 * Donut section).
 */
export const CAT_VIEW_FALLBACK = {
  frontDiagonal: 'side',
  backDiagonal: 'side',
} as const satisfies Partial<Record<FacingView, CardinalView>>;

type CatFallbackView = keyof typeof CAT_VIEW_FALLBACK;

/** A facing view Donut has rows of her own for. */
export type CatRowView = Exclude<FacingView, CatFallbackView>;

function catFallsBack(view: FacingView): view is CatFallbackView {
  return view in CAT_VIEW_FALLBACK;
}

/** The view whose rows Donut is drawn in for a facing view. */
export function catRowViewOf(view: FacingView): CatRowView {
  return catFallsBack(view) ? CAT_VIEW_FALLBACK[view] : view;
}
