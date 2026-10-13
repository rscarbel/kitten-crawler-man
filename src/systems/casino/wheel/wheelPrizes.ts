/**
 * What every wedge hands the crawler it pays, canvas-free. The wheel screen
 * plays a reveal around each of these; a load that finds a spin committed but
 * never paid out calls the same functions with no reveal at all, so a reload
 * pays exactly what the screen would have.
 */

import type { Player } from '../../../Player';
import { getBoxContents, type BoxTier, type ItemReward } from '../../../core/AchievementManager';
import type { ItemId } from '../../../core/ItemDefs';
import type { WheelCrawler, WheelLedger } from '../../../core/WheelLedger';
import {
  BASE_WHEEL_BOARD,
  FAIRY_REPELLENT_SIGNET_ITEM_ID,
  LEGENDARY_WEAPON_CLAIM_IDS,
  WHEEL_UPGRADES,
  legendaryWeaponItemId,
  legendaryWeaponRecipient,
  platinumRingItemId,
  type WheelPrize,
  type WheelPrizeId,
  type WheelWedge,
} from './wheelBoard';
import {
  applyWheelBloodVomit,
  applyWheelBurn,
  applyWheelFreeze,
  applyWheelPoison,
  applyWheelRobbery,
  applyWheelStab,
} from './wheelPenalties';

/** Every wedge face the wheel can show at any bet, for looking a saved wedge id back up. */
const ALL_WEDGE_FACES: readonly WheelWedge[] = [
  ...BASE_WHEEL_BOARD,
  ...WHEEL_UPGRADES.map((upgrade) => upgrade.to),
];

/** The wedge face a saved id names, or null for an id no board has (a save from another build). */
export function wedgeFaceById(id: string): WheelWedge | null {
  return ALL_WEDGE_FACES.find((wedge) => wedge.id === id) ?? null;
}

/** Everything a prize can reach on the crawler's side of the party. */
export interface WheelPrizeTarget {
  readonly crawler: Player;
  readonly kind: WheelCrawler;
  /** Gives Carl the attack cow, whoever spun. */
  readonly grantAttackCow: () => void;
}

/** What a prize paid, for the reveal to show. */
export interface WheelPrizeEffect {
  /** HP the croupier's knife took. */
  readonly hpLost: number;
  /** Coins Tito took off a robbed crawler. */
  readonly coinsTaken: number;
  /** Coins paid out. */
  readonly coinsWon: number;
  /** Items handed over into the bag. */
  readonly items: ReadonlyArray<ItemReward>;
  /** The rarity an item prize is presented at, or null for a prize with no items. */
  readonly tier: BoxTier | null;
}

const NO_EFFECT: WheelPrizeEffect = {
  hpLost: 0,
  coinsTaken: 0,
  coinsWon: 0,
  items: [],
  tier: null,
};

/** The wheel's own coin and potion rolls for a Gold or Silver prize, tuned apart from boxes. */
const WHEEL_CONTENTS_CATEGORY = 'Wheel';
const ONE = 1;

/** Items straight into the crawler's bag, the moment the wheel lands. */
function grantItems(
  target: WheelPrizeTarget,
  tier: BoxTier,
  items: ReadonlyArray<ItemReward>,
  coins = 0,
): WheelPrizeEffect {
  for (const { id, quantity } of items) target.crawler.inventory.addItem(id, quantity);
  if (coins > 0) target.crawler.earnCoins(coins);
  return { ...NO_EFFECT, items, coinsWon: coins, tier };
}

/** A Gold or Silver prize: the tier's wheel roll of potions and coins, paid at once. */
function grantTierContents(target: WheelPrizeTarget, tier: BoxTier): WheelPrizeEffect {
  const contents = getBoxContents(tier, WHEEL_CONTENTS_CATEGORY);
  const potions = contents.potions ?? 0;
  const items: ItemReward[] = potions > 0 ? [{ id: 'health_potion', quantity: potions }] : [];
  return grantItems(target, tier, items, contents.coins);
}

function payCoins(target: WheelPrizeTarget, amount: number): WheelPrizeEffect {
  target.crawler.earnCoins(amount);
  return { ...NO_EFFECT, coinsWon: amount };
}

/**
 * Hands over one wedge's prize or penalty, at once: items go straight into
 * the bag. The Nothing and Spin Again do nothing here: the first is the wipe
 * and the second a free spin, both the host's to run.
 */
export function applyWheelPrize(prize: WheelPrize, target: WheelPrizeTarget): WheelPrizeEffect {
  const { crawler } = target;
  switch (prize.kind) {
    case 'nothing':
    case 'spin_again':
    case 'free_handies':
      return NO_EFFECT;
    case 'stab':
      return { ...NO_EFFECT, hpLost: applyWheelStab(crawler) };
    case 'poison':
      applyWheelPoison(crawler);
      return NO_EFFECT;
    case 'blood_vomit':
      applyWheelBloodVomit(crawler);
      return NO_EFFECT;
    case 'burn':
      applyWheelBurn(crawler);
      return NO_EFFECT;
    case 'freeze':
      applyWheelFreeze(crawler);
      return NO_EFFECT;
    case 'robbed':
      return { ...NO_EFFECT, coinsTaken: applyWheelRobbery(crawler) };
    case 'pet':
      target.grantAttackCow();
      return NO_EFFECT;
    case 'gold':
      return payCoins(target, prize.amount);
    case 'heal_and_gold':
      crawler.hp = crawler.maxHp;
      return payCoins(target, prize.amount);
    case 'legendary_weapon_box':
      return grantItems(target, 'Legendary', [
        { id: legendaryWeaponItemId(target.kind), quantity: ONE },
      ]);
    case 'platinum_box':
      return grantItems(target, 'Platinum', [
        { id: platinumRingItemId(prize.ring), quantity: ONE },
      ]);
    case 'legendary_box':
      return grantItems(target, 'Legendary', [
        { id: FAIRY_REPELLENT_SIGNET_ITEM_ID, quantity: ONE },
      ]);
    case 'gold_box':
      return grantTierContents(target, 'Gold');
    case 'silver_box':
      return grantTierContents(target, 'Silver');
  }
}

/** The crawler a landing pays: the spinner, unless {@link legendaryWeaponRecipient} says otherwise. */
export function wheelPrizeRecipient(
  wedge: WheelWedge,
  spinner: WheelCrawler,
  won: ReadonlyArray<string>,
): WheelCrawler {
  return wedge.prize.kind === 'legendary_weapon_box'
    ? legendaryWeaponRecipient(spinner, won)
    : spinner;
}

const LEGENDARY_WEAPON_WEDGE_ID: WheelPrizeId = 'legendary_weapon_box';
const WHEEL_CRAWLERS: readonly WheelCrawler[] = ['human', 'cat'];

/**
 * Marks the prize a landing pays to `recipient` as won, before the spin is
 * saved. A Legendary Weapon marks that crawler's claim, and the wedge itself
 * only once both crawlers' claims are in. Returns the entries added, so a
 * refused save can take exactly those back out.
 */
export function markWheelPrizeWon(
  ledger: WheelLedger,
  wedge: WheelWedge,
  recipient: WheelCrawler,
): string[] {
  const won = ledger.prizesWon;
  const marked: string[] = [];
  const mark = (entry: string) => {
    if (won.includes(entry)) return;
    won.push(entry);
    marked.push(entry);
  };
  if (wedge.prize.kind === 'legendary_weapon_box') {
    mark(LEGENDARY_WEAPON_CLAIM_IDS[recipient]);
    const bothClaimed =
      won.includes(LEGENDARY_WEAPON_CLAIM_IDS.human) &&
      won.includes(LEGENDARY_WEAPON_CLAIM_IDS.cat);
    if (bothClaimed) mark(LEGENDARY_WEAPON_WEDGE_ID);
  } else if (wedge.prizeId !== null) {
    mark(wedge.prizeId);
  }
  return marked;
}

/** Both crawlers and how to reach each one's side of a prize. */
export interface WheelParty {
  readonly human: Player;
  readonly cat: Player;
  readonly grantAttackCow: () => void;
}

/** The crawler a spin belongs to, as a prize target. */
export function wheelPrizeTarget(party: WheelParty, kind: WheelCrawler): WheelPrizeTarget {
  return {
    crawler: kind === 'human' ? party.human : party.cat,
    kind,
    grantAttackCow: party.grantAttackCow,
  };
}

/** Puts every prize item the ledger holds for a crawler into that crawler's bag. */
function deliverOwedWheelItems(ledger: WheelLedger, party: WheelParty): void {
  for (const owed of ledger.owedItems) {
    const crawler = owed.crawler === 'human' ? party.human : party.cat;
    crawler.inventory.addItem(owed.id, owed.quantity);
  }
  ledger.owedItems = [];
}

/**
 * Settles what the wheel still owes the party, silently, on every load and
 * floor change: prize items held outside the bags, a spin committed but never
 * paid (the bet and the won-prize mark were saved with it, so only the
 * effect is left, and a Spin Again's free spin is owed again), and a freeze
 * landed but not yet spent. Also splits a legacy whole-party Legendary
 * Weapon claim into a per-crawler one. Returns the pending wedge paid, or null.
 */
export function settleWheelLedger(ledger: WheelLedger, party: WheelParty): WheelWedge | null {
  const paid = settleOwedPrizes(ledger, party);
  splitLegacyWeaponClaim(ledger, party);
  return paid;
}

function partyHoldsItem(party: WheelParty, id: ItemId): boolean {
  const held = (crawler: Player) =>
    crawler.inventory.countOf(id) > 0 || crawler.inventory.hasEquipped(id);
  return held(party.human) || held(party.cat);
}

/**
 * A save from when the Legendary Weapon paid once for the whole party holds
 * the wedge as won with no per-crawler claim. If the party still holds exactly
 * one of the two weapons, that crawler's claim replaces it and the wedge can
 * pay the other weapon; otherwise which one was won is unknowable, so both
 * count as claimed and the wedge stays retired. Runs after a pending spin is
 * paid, so a weapon still in flight is in a bag by then.
 */
function splitLegacyWeaponClaim(ledger: WheelLedger, party: WheelParty): void {
  const won = ledger.prizesWon;
  const claims = Object.values(LEGENDARY_WEAPON_CLAIM_IDS);
  const isLegacy =
    won.includes(LEGENDARY_WEAPON_WEDGE_ID) && !claims.some((claim) => won.includes(claim));
  if (!isLegacy) return;
  const held = WHEEL_CRAWLERS.filter((kind) => partyHoldsItem(party, legendaryWeaponItemId(kind)));
  if (held.length === 1) {
    ledger.prizesWon = won.filter((entry) => entry !== LEGENDARY_WEAPON_WEDGE_ID);
    ledger.prizesWon.push(LEGENDARY_WEAPON_CLAIM_IDS[held[0]]);
    return;
  }
  won.push(...claims);
}

function settleOwedPrizes(ledger: WheelLedger, party: WheelParty): WheelWedge | null {
  deliverOwedWheelItems(ledger, party);
  const pending = ledger.pendingOutcome;
  ledger.pendingOutcome = null;
  const owedFreeze = ledger.owedFreeze;
  ledger.owedFreeze = null;
  if (owedFreeze !== null) {
    applyWheelPrize({ kind: 'freeze' }, wheelPrizeTarget(party, owedFreeze));
  }
  if (pending === null) return null;
  const wedge = wedgeFaceById(pending.wedgeId);
  if (wedge === null) return null;
  if (wedge.prize.kind === 'spin_again') ledger.freeSpinBet = pending.boardBet;
  applyWheelPrize(wedge.prize, wheelPrizeTarget(party, pending.recipient));
  return wedge;
}
