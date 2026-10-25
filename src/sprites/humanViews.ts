/**
 * Which of the human figure's views each facing view is drawn in, kept apart
 * from its sprite so its garments can borrow the same choice for a facing it
 * has no rows of its own for without importing the sprite.
 */

import type { CardinalView, FacingView } from './facingView';

/**
 * The facing views the human figure has no rows of its own for, and the view whose rows
 * each one draws instead: a south diagonal in profile, a north one from
 * behind. The one place a missing view is filled in. A view that gains its
 * own rows loses its entry here, and every view-keyed row table
 * (`ViewRows` in `humanSprite.ts`) then has to name its rows for that view too.
 */
export const HUMAN_VIEW_FALLBACK = {
  frontDiagonal: 'side',
  backDiagonal: 'back',
} as const satisfies Partial<Record<FacingView, CardinalView>>;
