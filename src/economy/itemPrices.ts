/**
 * Every item's base price: what one unit is worth before any shop has an
 * opinion about it. This is the one place to change what something costs
 * everywhere.
 *
 * A price on a shop screen is built in a fixed order, each step a visible
 * multiplier (see `pricing.ts`):
 *
 *  1. **Base**, from this table.
 *  2. **Shop markup**: the counter's shop-wide `markup`, replaced by its
 *     `categoryMarkup` for a category it has a taste for, replaced in turn by
 *     an `itemMarkup` for one item (`shops.ts`).
 *  3. **Stock**: a limited line gets dearer as it runs down below its normal
 *     stock; a line the player has sold into gets cheaper the more the shop
 *     holds above normal (`stockCurves.ts`, `shopStock.ts`). Every shelf drifts
 *     back toward normal at one global rate: 1% of its normal stock every 10
 *     seconds of game time, at least one unit, in both directions.
 *  4. **Bundle**, buying a bundle line only: quantity times the unit price,
 *     less the bundle's discount.
 *  5. **Buyback**, selling only: a shop pays `DEFAULT_BUYBACK` (50%) of its own
 *     price, or `SPECIALTY_BUYBACK` (75%) for a category it specialises in. The
 *     sell price is quoted at the stock the shop will hold after taking the
 *     unit, rounds up, and never exceeds what the shop charges for that unit.
 *  6. **Round and clamp**: a buy price rounds to nearest, and no price is ever
 *     below `MIN_PRICE_COINS`.
 *
 * `category` is the pricing bucket a shop's `categoryMarkup`, `specialties`
 * and `categoryStockCurve` key on. It is not the bag's `ItemCategory` in
 * `ItemDefs.ts`: food and potions share a bag tab but price differently.
 *
 * Whether an item can be sold at all is `unsellable` on its item def, not a
 * price: a base here is still what the item is worth to bag sorting.
 *
 * Edit here, then check with `npm run report:prices` (`-- --shop <id>` or
 * `-- --item <id>` to narrow it), or in game with `?prices`. A coin fee for an
 * effect rather than an item belongs in `servicePrices.ts`, not here.
 */

import type { ItemId } from '../core/ItemDefs';

/** A pricing bucket: how a shop says "I want food" without listing every food. */
export type ItemCategory =
  | 'potion'
  | 'food'
  | 'armor'
  | 'weapon'
  | 'tool'
  | 'resource'
  | 'tome'
  | 'magic_scroll'
  | 'explosive'
  | 'trap'
  | 'environment'
  | 'special'
  | 'quest';

/** One item's worth before any shop has an opinion about it. */
export interface ItemPrice {
  /** Coins for one unit at a shop with no markup, at normal stock. */
  readonly base: number;
  readonly category: ItemCategory;
}

// prettier-ignore
export const ITEM_PRICES = {
  // potion
  dirty_shirley:                { base:    15, category: 'potion' },
  health_potion:                { base:    15, category: 'potion' },
  speed_fizz:                   { base:   120, category: 'potion' },
  jugg_juice:                   { base:   220, category: 'potion' },
  cooldown_crisp:               { base:   150, category: 'potion' },
  stat_boost_potion:            { base:  1500, category: 'potion' },
  // food
  hamburger:                    { base:     8, category: 'food' },
  hollow_stew:                  { base:     5, category: 'food' },
  // armor
  trollskin_shirt:              { base:   480, category: 'armor' },
  enchanted_crown_sepsis_whore: { base:   800, category: 'armor' },
  issue_kettle_helm:            { base:   160, category: 'armor' },
  padded_gambeson:              { base:   240, category: 'armor' },
  riveted_bracers:              { base:   220, category: 'armor' },
  marching_boots:               { base:   280, category: 'armor' },
  enchanted_bigboi_boxers:      { base:   720, category: 'armor' },
  nightgaunt_cloak:             { base:  1000, category: 'armor' },
  slate_butterfly_talisman:     { base:   800, category: 'armor' },
  fae_scale_crupper:            { base:   720, category: 'armor' },
  bracelet_of_dex:              { base:   600, category: 'armor' },
  eyes_of_splatter:             { base:  9400, category: 'armor' },
  splatter_skunk_toe_ring:      { base:   880, category: 'armor' },
  fairy_repellent_signet:       { base: 12000, category: 'armor' },
  ring_of_the_cold_shoulder:    { base:  8000, category: 'armor' },
  ring_of_the_asbestos_knuckle: { base:  8000, category: 'armor' },
  shade_gnoll_kneepads:         { base:    600, category: 'armor' },
  grull_war_gauntlet:           { base:  1040, category: 'armor' },
  // weapon
  slingshot:                    { base:   320, category: 'weapon' },
  fury_of_taranis:              { base: 24000, category: 'weapon' },
  dev_plain_sword:              { base:     0, category: 'weapon' },
  dev_spiked_club:              { base:     0, category: 'weapon' },
  dev_felling_axe:              { base:     0, category: 'weapon' },
  // tool
  basic_axe:                    { base:    10, category: 'tool' },
  hardened_axe:                 { base:   250, category: 'tool' },
  lumberjacks_axe:              { base:   750, category: 'tool' },
  ratkin_forge_axe:             { base:  2000, category: 'tool' },
  deepwood_cleaver:             { base:  5000, category: 'tool' },
  graveyards_bane:              { base: 12000, category: 'tool' },
  basic_pickaxe:                { base:    10, category: 'tool' },
  hardened_pickaxe:             { base:   250, category: 'tool' },
  quarrymans_pick:              { base:   750, category: 'tool' },
  ratkin_forge_pick:            { base:  2000, category: 'tool' },
  stonebreaker:                 { base:  5000, category: 'tool' },
  worldscar_pick:               { base: 12000, category: 'tool' },
  // resource
  wood:                         { base:     1, category: 'resource' },
  stone:                        { base:     2, category: 'resource' },
  wood_board:                   { base:     4, category: 'resource' },
  rope:                         { base:     6, category: 'resource' },
  // tome
  magic_missile_tome:           { base:  1000, category: 'tome' },
  smush_tome:                   { base:  1000, category: 'tome' },
  explosives_handling_tome:     { base:   400, category: 'tome' },
  skill_book_cockroach:         { base:   400, category: 'tome' },
  skill_book_cat_reflexes:      { base:   400, category: 'tome' },
  skill_book_pugilism:          { base:  1400, category: 'tome' },
  skill_book_iron_stomach:      { base:   400, category: 'tome' },
  skill_book_night_vision:      { base:   400, category: 'tome' },
  // magic scroll
  scroll_of_confusing_fog:      { base:   150, category: 'magic_scroll' },
  // explosive
  goblin_dynamite:              { base:    40, category: 'explosive' },
  black_powder_bomb:            { base:    60, category: 'explosive' },
  // trap
  trebuchet_kit:                { base:   300, category: 'trap' },
  snare_kit:                    { base:   100, category: 'trap' },
  // environment
  gym_dumbbell:                 { base:    30, category: 'environment' },
  gym_bench_press:              { base:   180, category: 'environment' },
  gym_treadmill:                { base:   180, category: 'environment' },
  // special
  wayfinders_anchor:            { base:   500, category: 'special' },
  // quest
  quest_wood_board:             { base:     1, category: 'quest' },
  anchor_shard_tinker:          { base:    20, category: 'quest' },
  anchor_shard_hilda:           { base:    20, category: 'quest' },
  anchor_shard_temple:          { base:    20, category: 'quest' },
  magistrates_writ:             { base:     0, category: 'quest' },
  unreadable_letter:            { base:     0, category: 'quest' },
  doomsday_scenario:            { base:     0, category: 'quest' },
  quest_scythe:                 { base:     0, category: 'quest' },
  quest_blueprints:             { base:     0, category: 'quest' },
  quest_prison_key:             { base:     0, category: 'quest' },
} as const satisfies Record<ItemId, ItemPrice>;
