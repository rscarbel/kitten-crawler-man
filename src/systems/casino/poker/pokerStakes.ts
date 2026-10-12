/**
 * The three Texas Hold'em tables and every amount that derives from them.
 *
 * No other code may hard-code a buy-in, a blind or a chip value: read it from
 * `POKER_STAKES` or one of the helpers here, so retuning a tier is one edit.
 */

/**
 * Every tier sits 50 big blinds deep: enough for real post-flop play, shallow
 * enough that a hand resolves in reasonable time.
 */
export const BUY_IN_BIG_BLINDS = 50;

const WHITE_CHIP = 1;
const RED_CHIP = 5;
const GREEN_CHIP = 25;
const BLACK_CHIP = 100;
/** The smallest table's chip values; the larger tiers scale these by `chipUnit`. */
export const BASE_CHIP_DENOMINATIONS = [WHITE_CHIP, RED_CHIP, GREEN_CHIP, BLACK_CHIP] as const;

export const POKER_STAKES = {
  penny: {
    id: 'penny',
    name: 'Penny Table',
    buyIn: 100,
    smallBlind: 1,
    bigBlind: 2,
    chipUnit: 1,
    flavour: 'Mostly recreational players',
  },
  card_room: {
    id: 'card_room',
    name: 'Card Room',
    buyIn: 1000,
    smallBlind: 10,
    bigBlind: 20,
    chipUnit: 10,
    flavour: 'Regulars and recreational players',
  },
  high_rollers: {
    id: 'high_rollers',
    name: 'High Rollers',
    buyIn: 10000,
    smallBlind: 100,
    bigBlind: 200,
    chipUnit: 100,
    flavour: 'Strong regulars and a whale or two',
  },
} as const;

export type PokerTierId = keyof typeof POKER_STAKES;
export type PokerStakes = (typeof POKER_STAKES)[PokerTierId];

/** Tiers in ascending order of stakes, for pickers and sweeps. */
export const POKER_TIER_IDS = [
  'penny',
  'card_room',
  'high_rollers',
] as const satisfies ReadonlyArray<PokerTierId>;

/** The chip values used at a tier, smallest first. */
export function chipDenominations(tier: PokerTierId): ReadonlyArray<number> {
  const unit = POKER_STAKES[tier].chipUnit;
  return BASE_CHIP_DENOMINATIONS.map((value) => value * unit);
}

/** The smallest chip at a tier: the granularity NPC bet sizing rounds to. */
export function smallestChip(tier: PokerTierId): number {
  return POKER_STAKES[tier].chipUnit;
}

/**
 * A stack of `bigBlinds` big blinds at a tier, rounded to the tier's smallest
 * chip and never below one big blind, so a seat can always post.
 */
export function stackForBigBlinds(tier: PokerTierId, bigBlinds: number): number {
  const stakes = POKER_STAKES[tier];
  const unit = stakes.chipUnit;
  const rounded = Math.round((bigBlinds * stakes.bigBlind) / unit) * unit;
  return Math.max(stakes.bigBlind, rounded);
}
