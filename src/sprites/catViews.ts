/**
 * Which of the cat figure's views each facing view is drawn in. Kept apart from her
 * sprite so her garments can borrow the same choice for a facing she has no
 * rows of her own for, without importing the sprite.
 */

import type { CardinalView, FacingView } from './facingView';

/**
 * The facing views the cat figure has no rows of her own for, and the view whose rows
 * each one draws instead: both three-quarter views in profile, east or west.
 * The one place a missing view is filled in; a view that gains its own rows
 * loses its entry here, and `OWN_ROWS` in `catSprite.ts` then has to name her
 * rows for it.
 *
 * A three-quarter row painted from a pose in her own body space does not
 * read: Pumpkin's coat patches break her back and rump into a jumble at the
 * in-game size, and her black left cheek swallows her face (see the
 * `add-sprite` skill's notes on the cat's views).
 */
export const CAT_VIEW_FALLBACK = {
  frontDiagonal: 'side',
  backDiagonal: 'side',
} as const satisfies Partial<Record<FacingView, CardinalView>>;

type CatFallbackView = keyof typeof CAT_VIEW_FALLBACK;

/** A facing view the cat figure has rows of her own for. */
export type CatRowView = Exclude<FacingView, CatFallbackView>;

function catFallsBack(view: FacingView): view is CatFallbackView {
  return view in CAT_VIEW_FALLBACK;
}

/** The view whose rows the cat figure is drawn in for a facing view. */
export function catRowViewOf(view: FacingView): CatRowView {
  return catFallsBack(view) ? CAT_VIEW_FALLBACK[view] : view;
}
