import type { AwardDef } from '../core/progression/AchievementManager';
import type { ItemId } from '../core/items/defs/ItemDefs';
import type { Rarity } from '../core/items/defs/rarity';
import type { CrawlerKind } from '../core/skills/SkillManager';
import { randomIntFrom } from '../utils';
import { rollGearFromPool, type GearId } from './gearPools';

/**
 * One thing an award has already put into a crawler's bag or purse. The
 * reward screen only pictures these; it never grants anything itself.
 */
export type GrantedLine =
  | { readonly kind: 'item'; readonly id: ItemId; readonly quantity: number }
  | { readonly kind: 'coins'; readonly amount: number }
  | { readonly kind: 'companion'; readonly id: 'deinonychus' }
  /** A rolled piece of gear the party already owned, paid out at its sell price. */
  | { readonly kind: 'duplicate'; readonly id: ItemId; readonly coins: number };

/** Where a chest that is not an achievement came from, named on its header. */
export type ChestSource = 'caroline' | 'challenge' | 'wheel' | 'bossRepeat' | 'quest';

/**
 * What a presentation pays for: an achievement (built-in or the AI's), or a
 * chest from a gift, a prize, a challenge or a repeat boss kill.
 */
export type PresentationOrigin =
  | { readonly kind: 'award'; readonly award: AwardDef }
  | { readonly kind: 'chest'; readonly source: ChestSource };

/**
 * One award waiting to be shown on the reward screen. Everything in
 * `rewards` is already in the crawler's inventory or coins.
 */
export interface RewardPresentation {
  readonly origin: PresentationOrigin;
  readonly title: string;
  readonly subtitle: string;
  readonly crawler: CrawlerKind;
  readonly rarity: Rarity;
  readonly rewards: readonly GrantedLine[];
}

/** The id of the achievement `presentation` pays for, or null for a chest no achievement earned. */
export function presentationAwardId(presentation: RewardPresentation | null): string | null {
  return presentation?.origin.kind === 'award' ? presentation.origin.award.id : null;
}

/** The header a chest that is not an achievement carries, by where it came from. */
export const CHEST_SOURCE_TITLES: Readonly<Record<ChestSource, string>> = {
  caroline: 'A gift from Caroline',
  challenge: 'Challenge won',
  wheel: 'Prize wheel',
  bossRepeat: 'Boss defeated again',
  quest: 'Quest reward',
};

/** An inclusive whole-number range. */
interface CountRange {
  readonly min: number;
  readonly max: number;
}

/**
 * One chance at a piece of gear: with probability `chance`, a piece of
 * rarity `upper` (with probability `upperChance`) or otherwise `lower`.
 */
interface GearRoll {
  readonly chance: number;
  readonly lower: Rarity;
  readonly upper: Rarity;
  readonly upperChance: number;
}

interface ChestContentsRow {
  readonly coins: CountRange;
  readonly potions: CountRange;
  readonly gear: readonly GearRoll[];
}

const CERTAIN = 1;
const COMMON_GEAR_CHANCE = 0.1;
const UNCOMMON_GEAR_CHANCE = 0.35;
/** The share of an Uncommon chest's gear that is Uncommon rather than Common. */
const UNCOMMON_GEAR_UNCOMMON_SHARE = 0.5;
const RARE_GEAR_RARE_SHARE = 0.4;
const EPIC_GEAR_EPIC_SHARE = 0.35;
const LEGENDARY_GEAR_LEGENDARY_SHARE = 0.3;
const DIVINE_POTION_COUNT = 8;

const COMMON_GEAR: GearRoll = {
  chance: COMMON_GEAR_CHANCE,
  lower: 'Common',
  upper: 'Common',
  upperChance: CERTAIN,
};
const UNCOMMON_GEAR: GearRoll = {
  chance: UNCOMMON_GEAR_CHANCE,
  lower: 'Common',
  upper: 'Uncommon',
  upperChance: UNCOMMON_GEAR_UNCOMMON_SHARE,
};
const RARE_GEAR: GearRoll = {
  chance: CERTAIN,
  lower: 'Uncommon',
  upper: 'Rare',
  upperChance: RARE_GEAR_RARE_SHARE,
};
const EPIC_GEAR: GearRoll = {
  chance: CERTAIN,
  lower: 'Rare',
  upper: 'Epic',
  upperChance: EPIC_GEAR_EPIC_SHARE,
};
const LEGENDARY_GEAR: GearRoll = {
  chance: CERTAIN,
  lower: 'Epic',
  upper: 'Legendary',
  upperChance: LEGENDARY_GEAR_LEGENDARY_SHARE,
};
const SURE_LEGENDARY_GEAR: GearRoll = {
  chance: CERTAIN,
  lower: 'Legendary',
  upper: 'Legendary',
  upperChance: CERTAIN,
};

const COMMON_COINS: CountRange = { min: 8, max: 15 };
const COMMON_POTIONS: CountRange = { min: 1, max: 2 };
const UNCOMMON_COINS: CountRange = { min: 20, max: 30 };
const UNCOMMON_POTIONS: CountRange = { min: 2, max: 3 };
const RARE_COINS: CountRange = { min: 35, max: 50 };
const RARE_POTIONS: CountRange = { min: 3, max: 4 };
const EPIC_COINS: CountRange = { min: 60, max: 90 };
const EPIC_POTIONS: CountRange = { min: 4, max: 5 };
const LEGENDARY_COINS: CountRange = { min: 100, max: 140 };
const LEGENDARY_POTIONS: CountRange = { min: 5, max: 6 };
const DIVINE_COINS: CountRange = { min: 180, max: 250 };
const DIVINE_POTIONS: CountRange = { min: DIVINE_POTION_COUNT, max: DIVINE_POTION_COUNT };

/** What a chest of each rarity holds before any fixed rewards are added on top. */
const CHEST_CONTENTS: Readonly<Record<Rarity, ChestContentsRow>> = {
  Common: { coins: COMMON_COINS, potions: COMMON_POTIONS, gear: [COMMON_GEAR] },
  Uncommon: { coins: UNCOMMON_COINS, potions: UNCOMMON_POTIONS, gear: [UNCOMMON_GEAR] },
  Rare: { coins: RARE_COINS, potions: RARE_POTIONS, gear: [RARE_GEAR] },
  Epic: { coins: EPIC_COINS, potions: EPIC_POTIONS, gear: [EPIC_GEAR] },
  Legendary: {
    coins: LEGENDARY_COINS,
    potions: LEGENDARY_POTIONS,
    gear: [LEGENDARY_GEAR, RARE_GEAR],
  },
  Divine: { coins: DIVINE_COINS, potions: DIVINE_POTIONS, gear: [SURE_LEGENDARY_GEAR, EPIC_GEAR] },
};

/** What a roll needs to know about the party beyond the chest itself. */
export interface RewardChestContext {
  /** Whether either crawler already holds this piece, in a bag, on the hotbar or worn. */
  readonly owns: (id: GearId) => boolean;
  /** What the chest's coins are multiplied by: the recipient's worn coin bonus. */
  readonly coinMultiplier: number;
  /** Pieces this same chest already hands over as fixed rewards, which the roll must not repeat. */
  readonly reserved?: readonly ItemId[];
}

/**
 * One gear line from `roll`, or null when the roll misses or no piece fits
 * the crawler at all. The piece is of the rolled rarity, or of the nearest
 * rarity that still has one the party lacks. A piece the party already owns,
 * or that this chest has already handed over, is rerolled once within the
 * same rarity and then paid as coins.
 */
function rollGear(
  roll: GearRoll,
  crawler: CrawlerKind,
  rng: () => number,
  isTaken: (id: GearId) => boolean,
): GrantedLine | null {
  if (rng() >= roll.chance) return null;
  const rarity = rng() < roll.upperChance ? roll.upper : roll.lower;
  const rolled = rollGearFromPool(
    { source: { kind: 'pool' }, wearer: crawler },
    rarity,
    rng,
    isTaken,
  );
  if (rolled === null) return null;
  return rolled.kind === 'item' ? { kind: 'item', id: rolled.id, quantity: 1 } : rolled;
}

/**
 * Rolls what a chest of `rarity` holds for `crawler` at this moment: coins,
 * health potions and up to two pieces of gear she or he can wear. Nothing is
 * granted here; the caller pays every line.
 */
export function rollRewardChest(
  rarity: Rarity,
  crawler: CrawlerKind,
  rng: () => number,
  context: RewardChestContext,
): GrantedLine[] {
  const row = CHEST_CONTENTS[rarity];
  const lines: GrantedLine[] = [];
  const coins = Math.round(
    randomIntFrom(rng, row.coins.min, row.coins.max) * context.coinMultiplier,
  );
  if (coins > 0) lines.push({ kind: 'coins', amount: coins });
  const potions = randomIntFrom(rng, row.potions.min, row.potions.max);
  if (potions > 0) lines.push({ kind: 'item', id: 'health_potion', quantity: potions });
  const picked = new Set<ItemId>(context.reserved ?? []);
  const isTaken = (id: GearId): boolean => picked.has(id) || context.owns(id);
  for (const roll of row.gear) {
    const line = rollGear(roll, crawler, rng, isTaken);
    if (line === null) continue;
    if (line.kind === 'item') picked.add(line.id);
    lines.push(line);
  }
  return lines;
}
