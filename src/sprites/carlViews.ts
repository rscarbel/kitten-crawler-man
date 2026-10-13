/**
 * Which of Carl's views each facing view is drawn in, kept apart from his
 * sprite so his garments can borrow the same choice for a facing he has no
 * rows of his own for without importing the sprite.
 */

import type { CardinalView, FacingView } from './facingView';

/**
 * The facing views Carl has no rows of his own for, and the view whose rows
 * each one draws instead: a south diagonal in profile, a north one from
 * behind. The one place a missing view is filled in. A view that gains its
 * own rows loses its entry here, and every view-keyed row table
 * (`ViewRows` in `humanSprite.ts`) then has to name its rows for that view too.
 */
export const CARL_VIEW_FALLBACK = {
  frontDiagonal: 'side',
  backDiagonal: 'back',
} as const satisfies Partial<Record<FacingView, CardinalView>>;
