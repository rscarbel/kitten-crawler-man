import type { EventBus } from '../core/EventBus';
import type { Player } from '../Player';

/**
 * Turns each crawler's pending bout of blood vomiting into a `bloodVomitRetch`
 * event, which the scene answers with floor gore and the audio wiring with the
 * retch. Run once a frame after the crawlers' timers tick, in every scene the
 * party plays in, or a bout there comes up silent and leaves no mark.
 */
export function drainBloodVomitRetches(crawlers: ReadonlyArray<Player>, bus: EventBus): void {
  for (const crawler of crawlers) {
    if (!crawler.bloodVomitRetchPending) continue;
    crawler.bloodVomitRetchPending = false;
    bus.emit('bloodVomitRetch', { player: crawler, ...crawler.bloodVomitSplash() });
  }
}
