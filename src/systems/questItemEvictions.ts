/**
 * Forwards both crawlers' quest-slot evictions onto a scene's event bus.
 *
 * An `Inventory` belongs to its crawler and outlives every scene, while each
 * scene has a bus of its own, so the scene that is running wires the
 * forwarding on entry and takes it down on exit — otherwise an eviction in
 * the next scene would be reported on the previous scene's cleared bus.
 */

import type { EventBus } from '../core/EventBus';
import type { CrawlerKind } from '../core/SkillManager';
import type { Inventory } from '../core/Inventory';

interface EvictingCrawler {
  readonly inventory: Inventory;
}

/** Starts forwarding; call the returned function to stop. */
export function forwardQuestItemEvictions(
  bus: EventBus,
  crawlers: Readonly<Record<CrawlerKind, EvictingCrawler>>,
): () => void {
  const kinds: readonly CrawlerKind[] = ['human', 'cat'];
  for (const crawler of kinds) {
    crawlers[crawler].inventory.setQuestItemEvictionListener((evicted) =>
      bus.emit('questItemEvicted', { itemId: evicted.id, crawler }),
    );
  }
  return () => {
    for (const crawler of kinds) crawlers[crawler].inventory.setQuestItemEvictionListener(null);
  };
}
