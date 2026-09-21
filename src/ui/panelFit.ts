import { viewportHeight, viewportWidth } from '../core/Viewport';
import type { ModalFit } from './Box';

/** Breathing room kept between a fitted panel and every viewport edge. */
const PANEL_FIT_MARGIN = 8;

/**
 * Below this a panel is illegible whatever we do; we stop shrinking and let it
 * overflow rather than render text at a few pixels.
 */
const PANEL_FIT_MIN_SCALE = 0.4;

/**
 * Like `fitModal`, but constrains width as well as height. `fitModal` only
 * looks at height, so a 400px-wide panel still hangs off a 360px portrait
 * phone. Use with `beginModalFit` / `modalFitPoint` / `setButtonPointerSpace`.
 */
export function fitPanel(designWidth: number, designHeight: number): ModalFit {
  const availableWidth = viewportWidth() - PANEL_FIT_MARGIN * 2;
  const availableHeight = viewportHeight() - PANEL_FIT_MARGIN * 2;
  const scale = Math.min(1, availableWidth / designWidth, availableHeight / designHeight);
  return {
    scale: Math.max(PANEL_FIT_MIN_SCALE, scale),
    pivotX: viewportWidth() / 2,
    pivotY: viewportHeight() / 2,
  };
}
