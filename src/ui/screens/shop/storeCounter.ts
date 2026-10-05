/**
 * A catalog store's counter (the town's General Store, the club's bar and
 * market) as a shop session: its catalog priced against what it is holding,
 * its limited lines booked off the shared market stock, and a Sell tab priced
 * by the same engine. The store's own system keeps decaying the held stock
 * every tick it is entered, so the session leaves that alone.
 */

import type { ItemId } from '../../../core/ItemDefs';
import {
  consumeStock,
  heldFor,
  remainingFor,
  removeHeldStock,
} from '../../../systems/market/MarketStock';
import { shopBuyPrice } from '../../../systems/market/shopPricing';
import { SOLD_OUT_LABEL } from '../../../systems/market/vendorMenu';
import type { ShopConfig, ShopItem, ShopStockConfig } from '../../../systems/ShopSystem';
import type { ShopMenu, ShopRow, ShopSession } from './shopSession';

const NOT_ENOUGH_COINS_LINE = 'Not enough coins!';
const BAG_FULL_LINE = 'Inventory is full!';
const STORE_BARK = 'Have a look around.';

export interface StoreCounter {
  readonly config: ShopConfig;
  readonly stock: ShopStockConfig;
  /** Runs after every purchase or sale that went through, for the host's sound. */
  readonly onTraded: () => void;
}

function catalogLine(config: ShopConfig, id: ItemId): ShopItem | undefined {
  return config.items.find((line) => line.id === id);
}

function heldUnits(counter: StoreCounter, id: ItemId): number {
  return heldFor(counter.stock.stock.held, counter.stock.vendorId, id);
}

function storeMenu(counter: StoreCounter): ShopMenu {
  const { config, stock } = counter;
  const options: ShopRow[] = config.items.map((item) => {
    const soldOut = remainingFor(stock.stock, stock.vendorId, item) === 0;
    return {
      key: item.id,
      label: item.label,
      desc: item.desc,
      price: shopBuyPrice(item.id, config.pricing, heldUnits(counter, item.id), item.price),
      icon: { kind: 'item', item: item.id },
      ...(soldOut ? { unavailable: SOLD_OUT_LABEL } : {}),
    };
  });
  return { title: config.title, bark: STORE_BARK, options };
}

/** Opens `session` on the store's counter. */
export function openStoreCounter(session: ShopSession, counter: StoreCounter): void {
  const { config, stock } = counter;
  session.open(
    () => storeMenu(counter),
    (option, player) => {
      const item = config.items.find((line) => line.id === option.key);
      if (item === undefined) return { ok: false, line: '' };
      if (!player.inventory.hasRoomFor(item.id) || !player.inventory.addItem(item.id, 1)) {
        return { ok: false, line: BAG_FULL_LINE };
      }
      consumeStock(stock.stock, stock.vendorId, item);
      if (heldUnits(counter, item.id) > 0) {
        removeHeldStock(stock.stock.held, stock.vendorId, item.id);
      }
      counter.onTraded();
      return { ok: true, line: `Bought ${item.label}!` };
    },
    {
      blockedLine: (option) =>
        option.unavailable !== undefined ? SOLD_OUT_LABEL : NOT_ENOUGH_COINS_LINE,
      liveRows: true,
      sell: {
        pricing: config.pricing,
        heldStock: stock.stock.held,
        vendorId: stock.vendorId,
        catalogPrice: (id) => catalogLine(config, id)?.price,
        decaysWhileOpen: false,
        onSold: counter.onTraded,
      },
    },
  );
}
