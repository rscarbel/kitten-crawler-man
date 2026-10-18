/**
 * A catalog store's counter (the town's General Store, the club's bar and
 * market) as a shop session: its `SHOPS` catalog priced against the shared
 * stock record, its limited lines booked off that record, and a Sell tab
 * priced by the same engine. The scene restocks the record on its own clock,
 * so the session never touches the restock.
 */

import { catalogLineLabel, catalogLineUnits, shopDef, type ShopId } from '../../../economy/shops';
import { buyFromShop, isSoldOut, type ShopStock } from '../../../economy/shopStock';
import { SOLD_OUT_LABEL, catalogLinePricing } from '../../../systems/market/vendorMenu';
import type { ShopMenu, ShopRow, ShopSession } from './shopSession';

const NOT_ENOUGH_COINS_LINE = 'Not enough coins!';
const STORE_BARK = 'Have a look around.';

export interface StoreCounter {
  readonly shop: ShopId;
  readonly stock: ShopStock;
  /** Runs after every purchase or sale that went through, for the host's sound. */
  readonly onTraded: () => void;
}

function storeMenu(counter: StoreCounter): ShopMenu {
  const { shop, stock } = counter;
  const def = shopDef(shop);
  const options: ShopRow[] = def.catalog.map((line) => {
    const soldOut = isSoldOut(stock, shop, line.item, catalogLineUnits(line));
    return {
      key: line.item,
      label: catalogLineLabel(line),
      desc: line.desc ?? '',
      ...catalogLinePricing(shop, line, stock),
      icon: { kind: 'item', item: line.item },
      ...(soldOut ? { unavailable: SOLD_OUT_LABEL } : {}),
    };
  });
  return { title: def.name, bark: STORE_BARK, options };
}

/** Opens `session` on the store's counter. */
export function openStoreCounter(session: ShopSession, counter: StoreCounter): void {
  const { shop, stock } = counter;
  session.open(
    () => storeMenu(counter),
    (option, player) => {
      const line = shopDef(shop).catalog.find((candidate) => candidate.item === option.key);
      if (line === undefined) return { ok: false, line: '' };
      const units = catalogLineUnits(line);
      if (!buyFromShop(stock, shop, line.item, units)) return { ok: false, line: SOLD_OUT_LABEL };
      player.inventory.addItem(line.item, units);
      counter.onTraded();
      return { ok: true, line: `Bought ${catalogLineLabel(line)}!` };
    },
    {
      blockedLine: (option) =>
        option.unavailable !== undefined ? SOLD_OUT_LABEL : NOT_ENOUGH_COINS_LINE,
      liveRows: true,
      ...(shopDef(shop).buysFromPlayer ? { sell: { shop, stock, onSold: counter.onTraded } } : {}),
    },
  );
}
