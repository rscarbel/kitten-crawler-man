/**
 * Every objective Dave has tactics for and Caroline has intel about, as plain
 * ids. Apart from `daveAdvice.ts`, which picks one from the floor's state, so
 * a save's briefed objectives can be checked without loading any dialog.
 */

const ADVICE_OBJECTIVE_IDS = [
  'trash_gremlin',
  'big_rooster',
  'defend_goblin_mother',
  'kraken',
  'electric_goblin',
  'stealth_gate',
  'spider_lab',
  'spider_lab_started',
  'spider_lab_station',
  'shady_bounties',
  'anchor_offer',
  'anchor_stone',
  'speed_fizz_tip',
  'missing_cats_notices',
  'missing_cats_owners',
  'missing_cats_cellar',
  'missing_cats_stakeout',
  'missing_cats_temple',
  'missing_cats_bait',
  'missing_cats_tower_door',
  'missing_cats_drain',
] as const;

/** Every objective Dave has tactics for and Caroline has intel about. */
export type AdviceObjectiveId = (typeof ADVICE_OBJECTIVE_IDS)[number];

/** Narrows an id read from outside the type system, such as a save. */
export function isAdviceObjectiveId(value: unknown): value is AdviceObjectiveId {
  return ADVICE_OBJECTIVE_IDS.some((id) => id === value);
}

/** Every objective, in the order the floors meet them, which is the order a save lists them. */
export const ADVICE_OBJECTIVE_ORDER: ReadonlyArray<AdviceObjectiveId> = ADVICE_OBJECTIVE_IDS;
