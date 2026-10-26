/**
 * Forwards both crawlers' equipment changes onto a scene's event bus as
 * `equipmentChanged`.
 *
 * Each crawler's `EquipmentManager` reports every change to its own
 * listeners, which is how the crawler re-dresses; each scene has a bus of its
 * own, so the scene that is running wires the forwarding on entry and takes it
 * down on exit, the same lifetime as the quest-slot eviction forwarding.
 */

import type { EventBus } from '../core/EventBus';
import type { CrawlerKind } from '../core/skills/SkillManager';
import type { Inventory } from '../core/items/inventory/Inventory';

interface EquippedCrawler {
  readonly inventory: Inventory;
}

/** Starts forwarding; call the returned function to stop. */
export function forwardEquipmentChanges(
  bus: EventBus,
  crawlers: Readonly<Record<CrawlerKind, EquippedCrawler>>,
): () => void {
  const kinds: readonly CrawlerKind[] = ['human', 'cat'];
  const stops = kinds.map((crawler) =>
    crawlers[crawler].inventory.equipment.onChange((change) =>
      bus.emit('equipmentChanged', { crawler, ...change }),
    ),
  );
  return () => {
    for (const stop of stops) stop();
  };
}
