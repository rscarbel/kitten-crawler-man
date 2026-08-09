/**
 * Turns a `VendorDef` into the rows the shared `PricedMenuPanel` draws, and the
 * handler that actually hands the goods over. The market's counterpart to
 * `buildTavernMenu` / `serveDrink`, with two differences: what's bought lands in
 * the inventory rather than being consumed on the spot, and a stall can run out.
 */

import { consumeStock, remainingFor, type MarketStock } from './MarketStock';
import type { VendorDef, VendorLineGate, VendorStockLine } from './vendorDefs';
import type { Player } from '../../Player';
import type { AudioManager } from '../../audio/AudioManager';
import type { PricedMenu, PricedOption, PricedPurchaseHandler } from '../../ui/PricedMenuPanel';

const SOLD_OUT_LABEL = 'Sold out';

/**
 * The pouch reads as a texture layer under `purchase_success` rather than a
 * second sting competing with it.
 */
const COIN_POUCH_VOLUME = 0.55;

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
  stock: MarketStock,
  visits: number,
  isGateOpen: VendorGateCheck,
): PricedMenu {
  return {
    title: def.stallName,
    bark: vendorBark(def, visits),
    byline: def.vendorName,
    // A closed gate drops the row entirely rather than disabling it — see
    // `VendorLineGate`. Because the panel rebuilds its rows after every
    // purchase, the shard's row vanishes the moment it is bought.
    options: def.items
      .filter((line) => line.gate === undefined || isGateOpen(line.gate))
      .map((line) => {
        const option: PricedOption = {
          key: line.id,
          label: line.label,
          price: line.price,
          desc: line.desc,
          // A gate is always a questline's condition — that is what `VendorLineGate`
          // is for — so a gated line is exactly the row that earns the panel's
          // quest treatment and its accept key.
          isQuestItem: line.gate !== undefined,
        };
        if (remainingFor(stock, def.id, line) === 0) option.unavailable = SOLD_OUT_LABEL;
        return option;
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
  stock: MarketStock,
  getAudio: () => AudioManager | null,
): PricedPurchaseHandler {
  return (option, buyer) => {
    const line = def.items.find((item) => item.id === option.key);
    if (line === undefined) return { ok: false, line: 'The vendor shrugs.' };
    // A sold-out row is already disabled by `buildVendorMenu`, so this is the
    // stock invariant's last line of defence rather than a path players hit —
    // without it, a caller that skipped that marking could sell the same last
    // unit forever, since `consumeStock` won't count past zero.
    if (remainingFor(stock, def.id, line) === 0) {
      return { ok: false, line: `${line.label} is sold out.` };
    }
    if (!giveItem(buyer, line)) {
      getAudio()?.play('error_taking_action');
      return { ok: false, line: 'Inventory is full!' };
    }
    consumeStock(stock, def.id, line);
    const audio = getAudio();
    audio?.play('purchase_success');
    audio?.play('coin_pouch', { volume: COIN_POUCH_VOLUME });
    return { ok: true, line: `Bought ${line.label}!` };
  };
}

/**
 * `addItem` is silent about a full inventory, so the count is checked either
 * side of it. Without this the player pays for goods they never receive.
 */
function giveItem(buyer: Player, line: VendorStockLine): boolean {
  const before = buyer.inventory.countOf(line.id);
  buyer.inventory.addItem(line.id, 1);
  return buyer.inventory.countOf(line.id) > before;
}
