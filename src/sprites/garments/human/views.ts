/**
 * Painters per facing view for Carl's garments: his three-quarter facings
 * draw the cardinal view his figure draws for them (`CARL_VIEW_FALLBACK`).
 */

import { CARL_VIEW_FALLBACK } from '../../carlViews';
import type { CardinalView, FacingView } from '../../facingView';
import { withViewFallback } from '../garmentDef';

/** One painter per cardinal view, each three-quarter view borrowing the one his figure draws. */
export function carlViews<P>(
  cardinal: Readonly<Record<CardinalView, P>>,
): Readonly<Record<FacingView, P>> {
  return withViewFallback(cardinal, CARL_VIEW_FALLBACK);
}

/** One painter for every view: the frame already carries the view's shapes. */
export function carlEveryView<P>(painter: P): Readonly<Record<FacingView, P>> {
  return carlViews({ front: painter, side: painter, back: painter });
}
