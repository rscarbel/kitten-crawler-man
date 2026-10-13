/**
 * What every wedge hands the crawler who spun, canvas-free. The wheel screen
 * plays a reveal around each of these; a load that finds a spin committed but
 * never paid out calls the same functions with no reveal at all, so a reload
 * pays exactly what the screen would have.
 */

import type { Player } from '../../../Player';
import { getBoxContents, type BoxTier, type ItemReward } from '../../../core/AchievementManager';
import type { WheelCrawler, WheelLedger } from '../../../core/WheelLedger';
import {
  BASE_WHEEL_BOARD,
  FAIRY_REPELLENT_SIGNET_ITEM_ID,
  WHEEL_UPGRADES,
  legendaryWeaponItemId,
  platinumRingItemId,
  type WheelPrize,
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
  /**
   * The ledger, which holds a won item the crawler's bag has no room for
   * until it has: an item on the floor would be lost to a reload.
   */
  readonly ledger: WheelLedger;
}

/** What a prize paid, for the reveal to show. */
export interface WheelPrizeEffect {
  /** HP the croupier's knife took. */
  readonly hpLost: number;
  /** Coins Tito took off a robbed crawler. */
  readonly coinsTaken: number;
  /** Coins paid out. */
  readonly coinsWon: number;
  /** Items handed over, whether into the bag now or held in the ledger until it has room. */
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

/** Items straight into the crawler's bag, the moment the wheel lands; what does not fit is owed. */
function grantItems(
  target: WheelPrizeTarget,
  tier: BoxTier,
  items: ReadonlyArray<ItemReward>,
  coins = 0,
): WheelPrizeEffect {
  for (const { id, quantity } of items) {
    const fits =
      target.crawler.inventory.hasRoomFor(id) && target.crawler.inventory.addItem(id, quantity);
    if (!fits) target.ledger.owedItems.push({ crawler: target.kind, id, quantity });
  }
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

/** Both crawlers and how to reach each one's side of a prize. */
export interface WheelParty {
  readonly human: Player;
  readonly cat: Player;
  readonly grantAttackCow: () => void;
}

/** The crawler a spin belongs to, as a prize target. */
export function wheelPrizeTarget(
  party: WheelParty,
  kind: WheelCrawler,
  ledger: WheelLedger,
): WheelPrizeTarget {
  return {
    crawler: kind === 'human' ? party.human : party.cat,
    kind,
    grantAttackCow: party.grantAttackCow,
    ledger,
  };
}

/**
 * Moves every owed prize item whose crawler now has bag room into that bag.
 * Returns the items delivered, for a notice.
 */
export function deliverOwedWheelItems(ledger: WheelLedger, party: WheelParty): ItemReward[] {
  const delivered: ItemReward[] = [];
  ledger.owedItems = ledger.owedItems.filter((owed) => {
    const crawler = owed.crawler === 'human' ? party.human : party.cat;
    const landed =
      crawler.inventory.hasRoomFor(owed.id) && crawler.inventory.addItem(owed.id, owed.quantity);
    if (landed) delivered.push({ id: owed.id, quantity: owed.quantity });
    return !landed;
  });
  return delivered;
}

/**
 * Settles what the wheel still owes the party, silently, on every load and
 * floor change: prize items waiting for bag room, a spin committed but never
 * paid (the bet and the won-prize mark were saved with it, so only the
 * effect is left, and a Spin Again's free spin is owed again), and a freeze
 * landed but not yet spent. Returns the pending wedge paid, or null.
 */
export function settleWheelLedger(ledger: WheelLedger, party: WheelParty): WheelWedge | null {
  deliverOwedWheelItems(ledger, party);
  const pending = ledger.pendingOutcome;
  ledger.pendingOutcome = null;
  const owedFreeze = ledger.owedFreeze;
  ledger.owedFreeze = null;
  if (owedFreeze !== null) {
    applyWheelPrize({ kind: 'freeze' }, wheelPrizeTarget(party, owedFreeze, ledger));
  }
  if (pending === null) return null;
  const wedge = wedgeFaceById(pending.wedgeId);
  if (wedge === null) return null;
  if (wedge.prize.kind === 'spin_again') ledger.freeSpinBet = pending.boardBet;
  applyWheelPrize(wedge.prize, wheelPrizeTarget(party, pending.crawler, ledger));
  return wedge;
}
