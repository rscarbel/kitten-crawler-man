/**
 * The Rusty Anvil's counter service. The smith will not sell you a weapon —
 * the town's weapons come off the floor — but she will put an edge on the one
 * you brought, which is the one thing a smith can sell a crawler that a crawler
 * actually wants.
 *
 * The edge is a timed status rather than an item, so it rides the player
 * snapshot in and out of buildings like every other buff and needs no inventory
 * slot. Buying it while it is still live is refused by the menu rather than the
 * handler, so nobody is charged for a re-sharpen they cannot use.
 *
 * Pure data + effect application; `PricedMenuPanel` owns the UI and
 * `BuildingInteriorScene` owns the sounds and the interaction gating.
 */

import { makeWhetstone, WHETSTONE_MELEE_DAMAGE_BONUS } from '../core/StatusEffect';
import type { Player } from '../Player';
import type { PricedMenu, PricedOption, PricedPurchaseHandler } from '../ui/PricedMenuPanel';
import type { ResidentHost } from './townResidents';
import { rotateLine } from './townServiceUtil';

const SINGLE_EDGE_PRICE = 18;
/** Both crawlers at once, discounted against buying two singles — she only heats the forge once. */
const PAIR_EDGE_PRICE = 30;

const SINGLE_EDGE_KEY = 'edge';
const PAIR_EDGE_KEY = 'edge_pair';

const WHETSTONE_STATUS = 'whetstone';

const SMITH_BARKS: ReadonlyArray<string> = [
  'Forge is hot. Hand me what you swing and I will make it worth swinging.',
  'You have been hitting things with a blunt thing. I can hear it from here.',
  'An edge is not a favour. It is three minutes of not dying. Priced accordingly.',
];

const EDGE_LINES: ReadonlyArray<string> = [
  'Six passes and a strop. Do not test it on anything you like.',
  'There. Cut something before it dulls on the walk out.',
  'That is my work on your steel now. Try not to embarrass it.',
];

/**
 * The smithy menu. `buyer` is whoever is being steered — the single edge goes on
 * them — and `party` is both crawlers, for the pair.
 */
export function buildSmithyMenu(
  party: ReadonlyArray<Player>,
  buyer: Player,
  turn: number,
  host: ResidentHost | null,
): PricedMenu {
  const single: PricedOption = {
    key: SINGLE_EDGE_KEY,
    label: 'Put an edge on it',
    price: SINGLE_EDGE_PRICE,
    desc: `+${WHETSTONE_MELEE_DAMAGE_BONUS} melee damage for 3 minutes`,
  };
  if (buyer.hasStatus(WHETSTONE_STATUS)) single.unavailable = 'Still sharp';

  const pair: PricedOption = {
    key: PAIR_EDGE_KEY,
    label: 'Edge the pair of you',
    price: PAIR_EDGE_PRICE,
    desc: 'The same edge, for you and your companion',
  };
  if (party.every((member) => member.hasStatus(WHETSTONE_STATUS))) pair.unavailable = 'Still sharp';

  return {
    title: 'The Rusty Anvil',
    bark: host?.line ?? rotateLine(SMITH_BARKS, turn),
    byline: host?.name,
    options: [single, pair],
  };
}

/** Grinds the chosen edge and returns the smith's parting line. */
export function sharpenEdges(party: ReadonlyArray<Player>, turn: number): PricedPurchaseHandler {
  return (option, buyer) => {
    // Both branches re-check the status the menu already disables on. An edge
    // ground onto an edge is coin for nothing, and the menu should not be the
    // only thing standing between the player and that.
    if (option.key === PAIR_EDGE_KEY) {
      if (party.every((member) => member.hasStatus(WHETSTONE_STATUS))) {
        return { ok: false, line: 'Both of those are still sharp. Come back when they are not.' };
      }
      for (const member of party) member.applyStatus(makeWhetstone());
      return { ok: true, line: rotateLine(EDGE_LINES, turn) };
    }
    if (option.key !== SINGLE_EDGE_KEY) {
      return { ok: false, line: 'The smith turns the thing over and hands it back.' };
    }
    if (buyer.hasStatus(WHETSTONE_STATUS)) {
      return { ok: false, line: 'That is still sharp. I am not charging you twice.' };
    }
    buyer.applyStatus(makeWhetstone());
    return { ok: true, line: rotateLine(EDGE_LINES, turn) };
  };
}
