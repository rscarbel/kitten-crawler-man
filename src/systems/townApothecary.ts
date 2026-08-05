/**
 * Herb & Remedy. The shop that had a merchant and nothing to sell.
 *
 * Fen's counter is deliberately not a cheaper General Store: her poultices
 * undercut the store's price but she only has a few made up at a time, and the
 * thing nobody else in town sells is the cure — the only way to get a poison,
 * a burn or a sepsis off a crawler short of waiting it out or dying.
 *
 * The batch is held in `TownMemory`, threaded by reference through the scene
 * constructors, so it does *not* refill by stepping out of the door and back in
 * — the same rule the market stalls' stock plays by, and the only thing keeping
 * a 4-coin health potion from making the General Store's 5-coin one pointless.
 *
 * Pure data + effect application; `PricedMenuPanel` owns the UI and
 * `BuildingInteriorScene` owns the sounds and the interaction gating.
 */

import { AILMENT_STATUSES } from '../core/StatusEffect';
import type { ItemId } from '../core/ItemDefs';
import type { Player } from '../Player';
import type { PricedMenu, PricedOption, PricedPurchaseHandler } from '../ui/PricedMenuPanel';
import type { TownMemory } from '../core/TownMemory';
import type { ResidentHost } from './townResidents';
import { giveInventoryItem, rotateLine } from './townServiceUtil';

/** Undercuts the General Store's price, but only while the batch lasts. */
const POULTICE_PRICE = 4;
const CURE_PRICE = 12;
/** Her ruin-root tonic is the club bar's Jugg Juice at an apothecary's margin. */
const TONIC_PRICE = 26;

const POULTICE_KEY = 'poultice';
const CURE_KEY = 'cure';
const TONIC_KEY = 'tonic';

const POULTICE_ITEM: ItemId = 'health_potion';
const TONIC_ITEM: ItemId = 'jugg_juice';

/**
 * What the antidote lifts: the ailments, minus the hangover. Fen is a healer,
 * not a sobering-up service — the inn upstairs handles that one, and leaving it
 * to them keeps the two purchases from being the same purchase.
 */
const CURED_STATUSES: ReadonlyArray<string> = AILMENT_STATUSES.filter((type) => type !== 'drunk');

const APOTHECARY_BARKS: ReadonlyArray<string> = [
  'Coin on the counter, ailment out loud. I have heard worse than yours.',
  'What is made up is made up. When it is gone you wait for the next batch.',
  'Something on you is still working. I can see it from here. Shall I take it off?',
];

function afflicted(party: ReadonlyArray<Player>): boolean {
  return party.some((member) => CURED_STATUSES.some((type) => member.hasStatus(type)));
}

/** The apothecary's board for this visit. */
export function buildApothecaryMenu(
  party: ReadonlyArray<Player>,
  memory: TownMemory,
  turn: number,
  host: ResidentHost | null,
): PricedMenu {
  const poultice: PricedOption = {
    key: POULTICE_KEY,
    label: 'Marsh Poultice',
    price: POULTICE_PRICE,
    desc: `A health potion, cheap. ${memory.poulticesLeft} left in the batch`,
  };
  if (memory.poulticesLeft <= 0) poultice.unavailable = 'Sold out';

  const cure: PricedOption = {
    key: CURE_KEY,
    label: "Fen's Antidote",
    price: CURE_PRICE,
    desc: 'Draws poison, burn and rot out of you both',
  };
  if (!afflicted(party)) cure.unavailable = 'Unafflicted';

  const tonic: PricedOption = {
    key: TONIC_KEY,
    label: 'Ruin-Root Tonic',
    price: TONIC_PRICE,
    desc: 'Jugg Juice, ground here rather than poured at the club',
  };

  return {
    title: 'Herb & Remedy',
    bark: host?.line ?? rotateLine(APOTHECARY_BARKS, turn),
    byline: host?.name,
    options: [poultice, cure, tonic],
  };
}

/** Serves whichever remedy was bought, against the visit's own batch. */
export function serveRemedy(
  party: ReadonlyArray<Player>,
  memory: TownMemory,
): PricedPurchaseHandler {
  return (option, buyer) => {
    if (option.key === CURE_KEY) {
      let cleared = 0;
      for (const member of party) cleared += member.cureStatuses(CURED_STATUSES);
      if (cleared === 0) return { ok: false, line: 'There is nothing on you worth my stock.' };
      return { ok: true, line: 'Drawn out and burnt. Do not go and collect more of it.' };
    }
    if (option.key === POULTICE_KEY) {
      if (memory.poulticesLeft <= 0) return { ok: false, line: 'That was the last of the batch.' };
      if (!giveInventoryItem(buyer, POULTICE_ITEM))
        return { ok: false, line: 'Your bag is full, crawler.' };
      memory.poulticesLeft--;
      return { ok: true, line: 'Keep it out of the sun. It sours by the week.' };
    }
    if (option.key === TONIC_KEY) {
      if (!giveInventoryItem(buyer, TONIC_ITEM))
        return { ok: false, line: 'Your bag is full, crawler.' };
      return { ok: true, line: 'Root, honey and something I will not name. Down it fast.' };
    }
    return { ok: false, line: 'Fen frowns at the shelf.' };
  };
}
