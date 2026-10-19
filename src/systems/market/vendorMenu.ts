/**
 * Turns a `VendorDef` into the rows the shop screen draws, and the
 * handler that actually hands the goods over. The market's counterpart to
 * `buildTavernMenu` / `serveDrink`, with two differences: what's bought lands in
 * the inventory rather than being consumed on the spot, and a stall can run out.
 */

import type { VendorDef } from './vendorDefs';
import {
  catalogLineUnits,
  shopDef,
  type CatalogLine,
  type ShopId,
  type VendorLineGate,
} from '../../economy/shops';
import { lineQuote } from '../../economy/pricing';
import {
  buyFromShop,
  currentStock,
  isLimitedLine,
  isSoldOut,
  type ShopStock,
} from '../../economy/shopStock';
import type { AudioManager } from '../../audio/AudioManager';
import type { Player } from '../../Player';
import {
  offerUnless,
  type ShopCost,
  type ShopMenu,
  type ShopRow,
  type ShopPurchaseHandler,
} from '../../ui/screens/shop/shopSession';

export const SOLD_OUT_LABEL = 'Sold out';

/**
 * Shown on a vendor's everyday stock while one of their lines is a live
 * quest errand — Voss sends the player here for exactly one thing, so the
 * rest of the counter is closed until that line is bought.
 */
export const GATE_LOCKED_LABEL = 'Not for sale right now';

/**
 * The pouch reads as a texture layer under `purchase_success` rather than a
 * second sting competing with it.
 */
const COIN_POUCH_VOLUME = 0.55;

const BUNDLE_KEY_SEPARATOR = '_x';

/**
 * The row key a catalog line answers to: its item id, with the pack size
 * appended for a bundle, so a counter selling both the single and the pack
 * of one item can tell which row was bought.
 */
export function catalogLineKey(line: CatalogLine): string {
  if (line.bundle === null) return line.item;
  return `${line.item}${BUNDLE_KEY_SEPARATOR}${line.bundle.quantity}`;
}

/** The shop's line a row was built from, or undefined for a row that is not one of its catalog lines. */
export function findCatalogLine(shop: ShopId, key: string): CatalogLine | undefined {
  return shopDef(shop).catalog.find((line) => catalogLineKey(line) === key);
}

/** A catalog line's Buy-side cost: the engine's price for the shop's current stock, and its working. */
export function catalogLineCost(shop: ShopId, line: CatalogLine, stock: ShopStock): ShopCost {
  return { kind: 'quoted', quote: lineQuote(shop, line, stock, 'buy') };
}

/**
 * One catalog line as a Buy row: priced against the shop's current stock,
 * with a limited line's count in its description and a short line marked
 * sold out.
 */
export function catalogLineRow(shop: ShopId, line: CatalogLine, stock: ShopStock): ShopRow {
  const soldOut = isSoldOut(stock, shop, line.item, catalogLineUnits(line));
  return {
    key: catalogLineKey(line),
    label: line.label,
    desc: isLimitedLine(shop, line.item)
      ? `${line.desc} (${currentStock(stock, shop, line.item)} left)`
      : line.desc,
    art: { kind: 'item', item: line.item },
    offer: offerUnless(soldOut ? SOLD_OUT_LABEL : null, catalogLineCost(shop, line, stock)),
    questErrand: false,
  };
}

/**
 * Takes one row's units off the shop's shelf and puts them in the buyer's
 * bag. Refuses, handing nothing over, when a limited line is short: the row
 * is already disabled then, so this is the stock invariant's last line of
 * defence against a stale panel selling the same last unit twice.
 */
export function handOverCatalogLine(
  shop: ShopId,
  line: CatalogLine,
  stock: ShopStock,
  buyer: Player,
): boolean {
  const units = catalogLineUnits(line);
  if (!buyFromShop(stock, shop, line.item, units)) return false;
  buyer.inventory.addItem(line.item, units);
  return true;
}

function vendorBark(def: VendorDef, visits: number): string {
  const count = def.barks.length;
  return def.barks[((visits % count) + count) % count];
}

/**
 * Answers whether a gated line is on the counter right now. Supplied by the
 * scene, which is the only thing that can see the questlines and the party's
 * bags. An ungated line never asks.
 */
export type VendorGateCheck = (gate: VendorLineGate) => boolean;

/** This vendor's current offer. Rebuilt after every purchase so sold-out rows go dead. */
export function buildVendorMenu(
  def: VendorDef,
  stock: ShopStock,
  visits: number,
  isGateOpen: VendorGateCheck,
): ShopMenu {
  // While a gated line is on the counter, it is the one thing the player was
  // sent here for — the rest of the stock is genuinely closed rather than
  // merely present-and-tempting, so a mid-errand player can't wander off and
  // spend the coins Voss is waiting on.
  const catalog = shopDef(def.id).catalog;
  const errandInProgress = catalog.some((line) => line.gate !== null && isGateOpen(line.gate));
  return {
    title: def.stallName,
    bark: vendorBark(def, visits),
    byline: def.vendorName,
    emblem: null,
    // A closed gate drops the row entirely rather than disabling it — see
    // `VendorLineGate`. Because the panel rebuilds its rows after every
    // purchase, the shard's row vanishes the moment it is bought.
    options: catalog
      .filter((line) => line.gate === null || isGateOpen(line.gate))
      .map((line): ShopRow => {
        const row = catalogLineRow(def.id, line, stock);
        // A gate is always a questline's condition — that is what `VendorLineGate`
        // is for — so a gated line is exactly the row that earns the panel's
        // quest treatment and its accept key.
        if (line.gate !== null) return { ...row, questErrand: true };
        if (row.offer.status !== 'open' || !errandInProgress) return row;
        return { ...row, offer: offerUnless(GATE_LOCKED_LABEL, row.offer.cost) };
      }),
  };
}

/**
 * Hands over one unit of the chosen line. Bound to a vendor because the sale has
 * to book stock against that vendor and play the market's own purchase sounds —
 * the pouch jingle is stall-only, so it lives here and not in the shared panel,
 * where the tavern and temple would inherit it.
 */
export function createVendorPurchase(
  def: VendorDef,
  stock: ShopStock,
  getAudio: () => AudioManager | null,
): ShopPurchaseHandler {
  return (option, buyer) => {
    const line = findCatalogLine(def.id, option.key);
    if (line === undefined) return { ok: false, line: 'The vendor shrugs.' };
    if (!handOverCatalogLine(def.id, line, stock, buyer)) {
      return { ok: false, line: `${line.label} is sold out.` };
    }
    const audio = getAudio();
    audio?.play('purchase_success');
    audio?.play('coin_pouch', { volume: COIN_POUCH_VOLUME });
    return { ok: true, line: `Bought ${line.label}!` };
  };
}
