/**
 * Herb & Remedy. The shop that had a merchant and nothing to sell.
 *
 * Fen's counter is deliberately not a cheaper General Store: her poultices
 * undercut the store's price but she only has a few made up at a time, and the
 * thing nobody else in town sells is the cure — the only way to get a poison,
 * a burn or a sepsis off a crawler short of waiting it out or dying.
 *
 * What she sells and at what margin lives on `SHOPS.apothecary`; the batch is
 * that line's stock in the shared `ShopStock`, threaded by reference through
 * the scenes, so it does *not* refill by stepping out of the door and back in.
 * It comes back only at the slow global restock rate, which is what keeps a
 * cheaper health potion from making the General Store's pointless.
 *
 * Pure data + effect application; the shop screen owns the UI and
 * `BuildingInteriorScene` owns the sounds and the interaction gating.
 */

import { CURABLE_AILMENT_STATUSES } from '../core/StatusEffect';
import type { ItemId } from '../core/ItemDefs';
import type { Player } from '../Player';
import {
  offerUnless,
  type ShopMenu,
  type ShopRow,
  type ShopPurchaseHandler,
} from '../ui/screens/shop/shopSession';
import { hostByline, type ResidentHost } from './townResidents';
import { rotateLine } from './townServiceUtil';
import { SERVICE_PRICES } from '../economy/servicePrices';
import { SHOPS, type ShopId } from '../economy/shops';
import type { ShopStock } from '../economy/shopStock';
import { catalogLineRow, findCatalogLine, handOverCatalogLine } from './market/vendorMenu';

const APOTHECARY_SHOP = 'apothecary' as const satisfies ShopId;
const CURE_KEY = 'cure';

type ApothecaryItem = (typeof SHOPS.apothecary.catalog)[number]['item'];

/** What Fen says as each remedy goes over the counter. */
const HANDED_OVER_LINES: Readonly<Record<ApothecaryItem, string>> = {
  health_potion: 'Keep it out of the sun. It sours by the week.',
  jugg_juice: 'Root, honey and something I will not name. Down it fast.',
};

const APOTHECARY_BARKS: ReadonlyArray<string> = [
  'Coin on the counter, ailment out loud. I have heard worse than yours.',
  'What is made up is made up. When it is gone you wait for the next batch.',
  'Something on you is still working. I can see it from here. Shall I take it off?',
];

function handedOverLine(item: ItemId): string {
  const lines: Partial<Record<ItemId, string>> = HANDED_OVER_LINES;
  return lines[item] ?? 'Mind how you carry it.';
}

function afflicted(party: ReadonlyArray<Player>): boolean {
  return party.some((member) => CURABLE_AILMENT_STATUSES.some((type) => member.hasStatus(type)));
}

/** The apothecary's board for this visit: her shelf, then the cure. */
export function buildApothecaryMenu(
  party: ReadonlyArray<Player>,
  stock: ShopStock,
  turn: number,
  host: ResidentHost | null,
): ShopMenu {
  const shelf = SHOPS.apothecary.catalog.map((line) =>
    catalogLineRow(APOTHECARY_SHOP, line, stock),
  );

  const cure: ShopRow = {
    key: CURE_KEY,
    label: "Fen's Antidote",
    desc: 'Draws poison, burn and rot out of you both',
    art: { kind: 'service', service: 'antidote' },
    offer: offerUnless(afflicted(party) ? null : 'Unafflicted', {
      kind: 'coins',
      coins: SERVICE_PRICES.apothecary.cure,
    }),
    questErrand: false,
  };

  return {
    title: 'Herb & Remedy',
    bark: host?.line ?? rotateLine(APOTHECARY_BARKS, turn),
    byline: hostByline(host),
    emblem: null,
    options: [...shelf, cure],
  };
}

/** Serves whichever remedy was bought, against the shop's own stock. */
export function serveRemedy(party: ReadonlyArray<Player>, stock: ShopStock): ShopPurchaseHandler {
  return (option, buyer) => {
    if (option.key === CURE_KEY) {
      let cleared = 0;
      for (const member of party) cleared += member.cureStatuses(CURABLE_AILMENT_STATUSES);
      if (cleared === 0) return { ok: false, line: 'There is nothing on you worth my stock.' };
      return { ok: true, line: 'Drawn out and burnt. Do not go and collect more of it.' };
    }
    const line = findCatalogLine(APOTHECARY_SHOP, option.key);
    if (line === undefined) return { ok: false, line: 'Fen frowns at the shelf.' };
    if (!handOverCatalogLine(APOTHECARY_SHOP, line, stock, buyer)) {
      return { ok: false, line: 'That was the last of the batch.' };
    }
    return { ok: true, line: handedOverLine(line.item) };
  };
}
