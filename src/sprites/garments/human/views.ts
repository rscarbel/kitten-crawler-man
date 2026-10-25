/**
 * Painters per facing view for the human figure's garments: its three-quarter
 * facings draw the cardinal view the figure draws for them (`HUMAN_VIEW_FALLBACK`).
 */

import { HUMAN_VIEW_FALLBACK } from '../../humanViews';
import type { CardinalView, FacingView } from '../../facingView';
import { withViewFallback } from '../garmentDef';

/** One painter per cardinal view, each three-quarter view borrowing the one his figure draws. */
export function humanViews<P>(
  cardinal: Readonly<Record<CardinalView, P>>,
): Readonly<Record<FacingView, P>> {
  return withViewFallback(cardinal, HUMAN_VIEW_FALLBACK);
}

/** One painter for every view: the frame already carries the view's shapes. */
export function humanEveryView<P>(painter: P): Readonly<Record<FacingView, P>> {
  return humanViews({ front: painter, side: painter, back: painter });
}
