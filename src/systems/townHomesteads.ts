/**
 * The three working houses of the town: the wheelwright, the mill and the
 * shepherd's cabin.
 *
 * None of them is a shop in the way the plaza is a shop. Each sells the one
 * thing the people who live there actually have — Brann has explosives because
 * he clears stumps, Marta has food because she is the reason the town eats, and
 * Wendell has a hayloft. They are priced against the plaza's versions so no
 * homestead becomes the strictly better place to buy anything.
 *
 * Pure data + effect application; `PricedMenuPanel` owns the UI and
 * `BuildingInteriorScene` owns the sounds and the interaction gating.
 */

import type { Player } from '../Player';
import type { PricedMenu, PricedOption, PricedPurchaseHandler } from '../ui/PricedMenuPanel';
import type { ResidentHost } from './townResidents';
import { giveInventoryItem, rotateLine } from './townServiceUtil';

// -- Cartwright's Workshop --------------------------------------------------

/**
 * The General Store's price, matched rather than undercut. Brann's yard is the
 * long walk from the plaza, so the reason to come here is the bundle — a modest
 * discount for buying three at once, not a cheaper stick for anyone who wanders
 * in. An unlimited cheaper stick would simply retire the store's dynamite line.
 */
const DYNAMITE_PRICE = 10;
const DYNAMITE_BUNDLE_SIZE = 3;
const DYNAMITE_BUNDLE_PRICE = 26;

const DYNAMITE_KEY = 'dynamite';
const DYNAMITE_BUNDLE_KEY = 'dynamite_bundle';

const CARTWRIGHT_BARKS: ReadonlyArray<string> = [
  'Stumps, mostly. I am not going to pretend that is all you want it for.',
  'Goblin-made, which is why it hisses. Do not argue with the hissing.',
  'Buy it, carry it out of my yard, and light it somewhere that is not my yard.',
];

const CARTWRIGHT_LINES: ReadonlyArray<string> = [
  'Short fuse on that one. Shorter than you would like.',
  'Mind the damp. Damp is the only thing that stops it and it does not stop it reliably.',
  'Do not run with it. I have seen where that ends and I had to rebuild the fence.',
];

export function buildCartwrightMenu(turn: number, host: ResidentHost | null): PricedMenu {
  return {
    title: "Cartwright's Workshop",
    bark: host?.line ?? rotateLine(CARTWRIGHT_BARKS, turn),
    byline: host?.name,
    options: [
      {
        key: DYNAMITE_KEY,
        label: 'Stick of Dynamite',
        price: DYNAMITE_PRICE,
        desc: 'Goblin Dynamite, at yard prices',
      },
      {
        key: DYNAMITE_BUNDLE_KEY,
        label: 'Bundle of Three',
        price: DYNAMITE_BUNDLE_PRICE,
        desc: `${DYNAMITE_BUNDLE_SIZE} sticks, for people clearing something large`,
      },
    ],
  };
}

export function sellCartwrightGoods(turn: number): PricedPurchaseHandler {
  return (option, buyer) => {
    const sticks =
      option.key === DYNAMITE_BUNDLE_KEY
        ? DYNAMITE_BUNDLE_SIZE
        : option.key === DYNAMITE_KEY
          ? 1
          : 0;
    if (sticks === 0) return { ok: false, line: 'Brann shrugs at the bench.' };
    if (!giveInventoryItem(buyer, 'goblin_dynamite', sticks)) {
      return { ok: false, line: 'No room in that bag of yours.' };
    }
    return { ok: true, line: rotateLine(CARTWRIGHT_LINES, turn) };
  };
}

// -- Miller's Farm ----------------------------------------------------------

/** Under the club bar's pour, because she bakes them rather than importing them. */
const CRISP_PRICE = 20;
const HOT_PLATE_PRICE = 6;
/** Fraction of max HP a plate off Marta's table puts back. */
const HOT_PLATE_HEAL_FRACTION = 0.25;

const CRISP_KEY = 'crisp';
const HOT_PLATE_KEY = 'hot_plate';

const MILLER_BARKS: ReadonlyArray<string> = [
  'Sit down before you ask me anything. You are swaying.',
  'Flour, bread, and the crisps the club charges a fortune for. Same batch.',
  'I feed a garrison. I can certainly feed one crawler.',
];

const MILLER_LINES: ReadonlyArray<string> = [
  'Eat it here. I am not having you drop it in the ruins.',
  'There. That is what a person is supposed to feel like.',
  'Come back when you are hungry rather than when you are dying.',
];

export function buildMillerMenu(
  buyer: Player,
  turn: number,
  host: ResidentHost | null,
): PricedMenu {
  const plate: PricedOption = {
    key: HOT_PLATE_KEY,
    label: 'A Hot Plate',
    price: HOT_PLATE_PRICE,
    desc: 'Bread, dripping and whatever is in the pot. Mends a little',
  };
  if (buyer.hp >= buyer.maxHp) plate.unavailable = 'Unhurt';

  return {
    title: "Miller's Farm",
    bark: host?.line ?? rotateLine(MILLER_BARKS, turn),
    byline: host?.name,
    options: [
      plate,
      {
        key: CRISP_KEY,
        label: 'Bag of Crisps',
        price: CRISP_PRICE,
        desc: 'Cooldown Crisps, off the tray rather than off the bar',
      },
    ],
  };
}

export function serveMillerGoods(turn: number): PricedPurchaseHandler {
  return (option, buyer) => {
    if (option.key === HOT_PLATE_KEY) {
      // Re-checked rather than trusting the menu's `Unhurt`: the guard the
      // player's coin depends on should not live in the UI alone.
      if (buyer.hp >= buyer.maxHp) {
        return { ok: false, line: 'Sit down when you actually need it.' };
      }
      const healed = buyer.hp + Math.round(buyer.maxHp * HOT_PLATE_HEAL_FRACTION);
      buyer.hp = Math.min(buyer.maxHp, healed);
      return { ok: true, line: rotateLine(MILLER_LINES, turn) };
    }
    if (option.key !== CRISP_KEY) return { ok: false, line: 'Marta wipes her hands and waits.' };
    if (!giveInventoryItem(buyer, 'cooldown_crisp')) {
      return { ok: false, line: 'Nowhere to put them. Eat something first.' };
    }
    return { ok: true, line: 'Straight off the tray. Do not let them go soft.' };
  };
}

// -- Shepherd's Cabin -------------------------------------------------------

const HAYLOFT_PRICE = 10;
/** A loft is not an inn: it mends most of you, and it will not touch what ails you. */
const HAYLOFT_HEAL_FRACTION = 0.6;

const HAYLOFT_KEY = 'hayloft';

const SHEPHERD_BARKS: ReadonlyArray<string> = [
  'Loft is dry and the dog does not bite. That is the whole of the offer.',
  'You can sleep here. I would not sleep out there and I have a wall.',
  'Ten coins and you can lie down. I will wake you if the dog does.',
];

const SHEPHERD_LINES: ReadonlyArray<string> = [
  'Straw in your hair. Leave it, it suits you.',
  'Dog sat on you for an hour. He does that with people he approves of.',
  'You slept through the counting. Forty-one, still.',
];

export function buildShepherdMenu(
  party: ReadonlyArray<Player>,
  turn: number,
  host: ResidentHost | null,
): PricedMenu {
  const loft: PricedOption = {
    key: HAYLOFT_KEY,
    label: 'An hour in the loft',
    price: HAYLOFT_PRICE,
    desc: 'Mends most of you both. Does not touch poison or drink',
  };
  if (party.every((member) => member.hp >= member.maxHp)) loft.unavailable = 'Unhurt';

  return {
    title: "Shepherd's Cabin",
    bark: host?.line ?? rotateLine(SHEPHERD_BARKS, turn),
    byline: host?.name,
    options: [loft],
  };
}

export function serveShepherdRest(
  party: ReadonlyArray<Player>,
  turn: number,
): PricedPurchaseHandler {
  return (option) => {
    if (option.key !== HAYLOFT_KEY) return { ok: false, line: 'Wendell scratches his head.' };
    // Same reason as the mill's plate: the refusal is the handler's job too.
    if (party.every((member) => member.hp >= member.maxHp)) {
      return { ok: false, line: 'Neither of you needs it. Keep your coin.' };
    }
    for (const member of party) {
      const healed = member.hp + Math.round(member.maxHp * HAYLOFT_HEAL_FRACTION);
      member.hp = Math.min(member.maxHp, healed);
    }
    return { ok: true, line: rotateLine(SHEPHERD_LINES, turn) };
  };
}
