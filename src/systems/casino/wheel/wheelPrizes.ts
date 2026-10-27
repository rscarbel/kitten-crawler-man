/**
 * What every wedge hands the crawler it pays, canvas-free. The wheel screen
 * plays a reveal around each of these; a load that finds a spin committed but
 * never paid out calls the same functions with no reveal at all, so a reload
 * pays exactly what the screen would have.
 */

import { partyOwnsGear } from '../../../loot/gearPools';
import type { Player } from '../../../Player';
import { worldRandom } from '../../../core/world/WorldRandom';
import { rollRewardChest } from '../../../loot/rewardChest';
import { coinBonusFor } from '../../../gear/gearHooks';
import type { Rarity } from '../../../core/items/defs/rarity';
import type { ItemId } from '../../../core/items/defs/ItemDefs';
import type { WheelCrawler, WheelLedger } from '../../../core/save/WheelLedger';
import {
  BASE_WHEEL_BOARD,
  FAE_IRON_CHARM_ITEM_ID,
  LEGENDARY_WEAPON_CLAIM_IDS,
  TAPED_PERMANENT_DEATH,
  WHEEL_UPGRADES,
  legendaryWeaponItemId,
  legendaryWeaponRecipient,
  epicCharmItemId,
  type WheelPrize,
  type WheelPrizeId,
  type WheelWedge,
} from './wheelBoard';
import {
  applyWheelBurn,
  applyWheelDamage,
  applyWheelDoubleDamage,
  applyWheelFreeze,
  applyWheelPoison,
  applyWheelRobbery,
} from './wheelPenalties';

/** Every wedge face the wheel can show at any bet, for looking a saved wedge id back up. */
const ALL_WEDGE_FACES: readonly WheelWedge[] = [
  ...BASE_WHEEL_BOARD,
  ...WHEEL_UPGRADES.map((upgrade) => upgrade.to),
  TAPED_PERMANENT_DEATH,
];

/** The wedge face a saved id names, or null for an id no board has (a save from another build). */
export function wedgeFaceById(id: string): WheelWedge | null {
  return ALL_WEDGE_FACES.find((wedge) => wedge.id === id) ?? null;
}

/** One item a prize puts in the bag. */
export interface PrizeItem {
  readonly id: ItemId;
  readonly quantity: number;
}

/** Everything a prize can reach on the crawler's side of the party. */
export interface WheelPrizeTarget {
  readonly crawler: Player;
  readonly kind: WheelCrawler;
  /** Both crawlers, for what the party already owns: gear is one of a kind per party. */
  readonly party: ReadonlyArray<Player>;
  /** Gives the human crawler the attack cow, whoever spun. */
  readonly grantAttackCow: () => void;
}

/** What a prize paid, for the reveal to show. */
export interface WheelPrizeEffect {
  /** HP Take Damage cost. */
  readonly hpLost: number;
  /** Coins Donald took off a robbed crawler. */
  readonly coinsTaken: number;
  /** Coins paid out. */
  readonly coinsWon: number;
  /** Items handed over into the bag. */
  readonly items: ReadonlyArray<PrizeItem>;
  /** The rarity an item prize is presented at, or null for a prize with no items. */
  readonly rarity: Rarity | null;
}

const NO_EFFECT: WheelPrizeEffect = {
  hpLost: 0,
  coinsTaken: 0,
  coinsWon: 0,
  items: [],
  rarity: null,
};

const ONE = 1;
/** A wheel prize's coins are the wheel's own, never scaled by the viewers' favour. */
const WHEEL_COIN_MULTIPLIER = 1;

/** Items straight into the crawler's bag, the moment the wheel lands. */
function grantItems(
  target: WheelPrizeTarget,
  rarity: Rarity,
  items: ReadonlyArray<PrizeItem>,
  coins = 0,
): WheelPrizeEffect {
  for (const { id, quantity } of items) target.crawler.inventory.addItem(id, quantity);
  if (coins > 0) target.crawler.earnCoins(coins);
  return { ...NO_EFFECT, items, coinsWon: coins, rarity };
}

/** A Rare or Uncommon prize: a reward chest of that rarity, rolled and paid at once. */
function grantRarityContents(target: WheelPrizeTarget, rarity: Rarity): WheelPrizeEffect {
  const lines = rollRewardChest(rarity, target.kind, worldRandom, {
    owns: (id) => partyOwnsGear(target.party, id),
    // A chest is a chest wherever it opens: the winner's worn coin bonus pays on it.
    coinMultiplier: WHEEL_COIN_MULTIPLIER * coinBonusFor(target.crawler),
  });
  const items: PrizeItem[] = [];
  let coins = 0;
  for (const line of lines) {
    if (line.kind === 'item') items.push({ id: line.id, quantity: line.quantity });
    else if (line.kind === 'coins') coins += line.amount;
    else if (line.kind === 'duplicate') coins += line.coins;
  }
  return grantItems(target, rarity, items, coins);
}

function payCoins(target: WheelPrizeTarget, amount: number): WheelPrizeEffect {
  target.crawler.earnCoins(amount);
  return { ...NO_EFFECT, coinsWon: amount };
}

/**
 * Hands over one wedge's prize or penalty, at once: items go straight into
 * the bag. Permanent Death and Spin Again do nothing here: the first is the
 * wipe and the second a free spin, both the host's to run.
 */
export function applyWheelPrize(prize: WheelPrize, target: WheelPrizeTarget): WheelPrizeEffect {
  const { crawler } = target;
  switch (prize.kind) {
    case 'permanent_death':
    case 'spin_again':
    case 'free_handies':
      return NO_EFFECT;
    case 'take_damage':
      return { ...NO_EFFECT, hpLost: applyWheelDamage(crawler) };
    case 'poison':
      applyWheelPoison(crawler);
      return NO_EFFECT;
    case 'double_damage':
      applyWheelDoubleDamage(crawler);
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
    case 'legendary_weapon':
      return grantItems(target, 'Legendary', [
        { id: legendaryWeaponItemId(target.kind), quantity: ONE },
      ]);
    case 'epic_charm':
      return grantItems(target, 'Epic', [{ id: epicCharmItemId(prize.charm), quantity: ONE }]);
    case 'legendary_charm':
      return grantItems(target, 'Legendary', [{ id: FAE_IRON_CHARM_ITEM_ID, quantity: ONE }]);
    case 'rare_chest':
      return grantRarityContents(target, 'Rare');
    case 'uncommon_chest':
      return grantRarityContents(target, 'Uncommon');
  }
}

/** The crawler a landing pays: the spinner, unless {@link legendaryWeaponRecipient} says otherwise. */
export function wheelPrizeRecipient(
  wedge: WheelWedge,
  spinner: WheelCrawler,
  won: ReadonlyArray<string>,
): WheelCrawler {
  return wedge.prize.kind === 'legendary_weapon' ? legendaryWeaponRecipient(spinner, won) : spinner;
}

const LEGENDARY_WEAPON_WEDGE_ID: WheelPrizeId = 'legendary_weapon';

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
  if (wedge.prize.kind === 'legendary_weapon') {
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
    party: [party.human, party.cat],
    grantAttackCow: party.grantAttackCow,
  };
}

/**
 * Settles what the wheel still owes the party, silently, on every load and
 * floor change: a spin committed but never paid (the bet and the won-prize mark were saved with it, so only the
 * effect is left, and a Spin Again's free spin is owed again), and a freeze
 * landed but not yet spent. Returns the pending wedge paid, or null.
 */
export function settleWheelLedger(ledger: WheelLedger, party: WheelParty): WheelWedge | null {
  return settleOwedPrizes(ledger, party);
}

function settleOwedPrizes(ledger: WheelLedger, party: WheelParty): WheelWedge | null {
  const pending = ledger.pendingOutcome;
  ledger.pendingOutcome = null;
  const owedFreeze = ledger.owedFreeze;
  ledger.owedFreeze = null;
  if (owedFreeze !== null) {
    applyWheelPrize({ kind: 'freeze' }, wheelPrizeTarget(party, owedFreeze));
  }
  const wedge = pending === null ? null : wedgeFaceById(pending.wedgeId);
  if (pending !== null && wedge?.prize.kind === 'spin_again') {
    ledger.freeSpinBet = pending.boardBet;
  }
  // A taped chain lasts exactly as long as it owes a spin; once nothing is owed it has resolved.
  if (ledger.freeSpinBet === null) ledger.questFreeSpins.tapedChain = false;
  if (pending === null || wedge === null) return null;
  applyWheelPrize(wedge.prize, wheelPrizeTarget(party, pending.recipient));
  return wedge;
}
