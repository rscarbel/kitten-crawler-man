/**
 * Says so when an item a crawler earned is lost to a full bag: without it the
 * item simply never arrives, and the player learns their bag was full only by
 * finding it missing later.
 */

import type { Inventory } from '../core/Inventory';
import type { HudToasts } from '../ui/hud/toasts';
import { bagFullNotice } from '../ui/potionNotices';

/** Posts every bag-full loss of either crawler to `toasts`. Returns the call that stops it. */
export function toastBagFullLosses(
  crawlers: readonly { readonly inventory: Inventory }[],
  toasts: HudToasts,
): () => void {
  for (const crawler of crawlers) {
    crawler.inventory.setBagFullListener((id, quantity) =>
      toasts.post(bagFullNotice(id, quantity), { tone: 'warning', icon: 'bag' }),
    );
  }
  return () => {
    for (const crawler of crawlers) crawler.inventory.setBagFullListener(null);
  };
}
