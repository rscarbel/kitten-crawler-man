/**
 * How far down the screen the top band's cards reach, eased, for a camera
 * that keeps the world out from under them. Cards come and go (a boss bar
 * raised, a countdown cleared), and a camera that followed them exactly
 * would jump the room each time; this slides the covered strip's bottom
 * toward the band as drawn a few UI units a tick instead.
 */

import type { Rect } from '../core/geom';

/** How far the covered strip's bottom moves in one update tick, in UI units. */
const REACH_STEP_PER_TICK = 6;

export class TopBandReach {
  private eased = 0;

  /** Steps toward the band as last drawn (`drawn`, UI units). Call once per update tick. */
  tick(drawn: readonly Rect[]): void {
    const target = drawn.reduce((lowest, rect) => Math.max(lowest, rect.y + rect.h), 0);
    const step = Math.max(-REACH_STEP_PER_TICK, Math.min(REACH_STEP_PER_TICK, target - this.eased));
    this.eased += step;
  }

  /** How far down the screen the covered strip reaches, in UI units; 0 while the band is empty. */
  get bottom(): number {
    return this.eased;
  }
}
