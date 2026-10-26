/**
 * A catalog store's counter (the town's General Store, the club's bar and
 * market) as a shop session: its `SHOPS` catalog priced against the shared
 * stock record, its limited lines booked off that record, and a Sell tab
 * priced by the same engine. The scene restocks the record on its own clock,
 * so the session never touches the restock.
 */

import { shopDef, type ShopId } from '../../../economy/shops';
import type { ShopStock } from '../../../economy/shopStock';
import {
  SOLD_OUT_LABEL,
  catalogLineRow,
  findCatalogLine,
  handOverCatalogLine,
  type GearOwnership,
} from '../../../systems/market/vendorMenu';
import type { ShopMenu, ShopSession } from './shopSession';

const NOT_ENOUGH_COINS_LINE = 'Not enough coins!';
const STORE_BARK = 'Have a look around.';

export interface StoreCounter {
  readonly shop: ShopId;
  readonly stock: ShopStock;
  /** Runs after every purchase or sale that went through, for the host's sound. */
  readonly onTraded: () => void;
  /** Whether the party already has a piece of gear the store sells. */
  readonly owns: GearOwnership;
}

function storeMenu(counter: StoreCounter): ShopMenu {
  const { shop, stock } = counter;
  const def = shopDef(shop);
  return {
    title: def.name,
    bark: STORE_BARK,
    byline: null,
    emblem: null,
    options: def.catalog.map((line) => catalogLineRow(shop, line, stock, counter.owns)),
  };
}

/** Opens `session` on the store's counter. */
export function openStoreCounter(session: ShopSession, counter: StoreCounter): void {
  const { shop, stock } = counter;
  session.open(
    () => storeMenu(counter),
    (option, player) => {
      const line = findCatalogLine(shop, option.key);
      if (line === undefined) return { ok: false, line: '' };
      if (!handOverCatalogLine(shop, line, stock, player, counter.owns)) {
        return { ok: false, line: SOLD_OUT_LABEL };
      }
      counter.onTraded();
      return { ok: true, line: `Bought ${line.label}!` };
    },
    {
      onBlocked: null,
      blockedLine: (option) =>
        option.offer.status === 'open' ? NOT_ENOUGH_COINS_LINE : SOLD_OUT_LABEL,
      rebuyGuardTicks: 0,
      sell: shopDef(shop).buysFromPlayer ? { shop, stock, onSold: counter.onTraded } : null,
      liveRows: true,
    },
  );
}
