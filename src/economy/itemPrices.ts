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

import type { ItemId } from '../core/items/defs/ItemDefs';
import type { Rarity } from '../core/items/defs/rarity';
import { GEAR_CATALOGUE } from '../gear/catalogue';

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

/**
 * What a piece of gear of each rarity is worth before its own multiplier: the
 * rarer the piece, the dearer, so a price never undercuts the ladder.
 */
const RARITY_BASE_PRICE: Readonly<Record<Rarity, number>> = {
  Common: 150,
  Uncommon: 400,
  Rare: 1000,
  Epic: 3000,
  Legendary: 9000,
  Divine: 20000,
};

/**
 * A gear piece's price: its rarity's base times `multiplier`, the piece's own
 * worth against others of its rarity. Read off the catalogue, so a piece moved
 * up the ladder is repriced with it.
 */
function gearPrice(id: keyof typeof GEAR_CATALOGUE, multiplier: number): ItemPrice {
  const def = GEAR_CATALOGUE[id];
  const base = Math.round(RARITY_BASE_PRICE[def.rarity] * multiplier);
  return { base, category: def.category === 'weapon' ? 'weapon' : 'armor' };
}

/** A piece that does noticeably more than others of its rarity. */
const STANDOUT_PIECE = 1.2;
/** A piece carrying twice the stat its set's other pieces do. */
const DOUBLE_STAT_PIECE = 1.5;
/** A piece that does a little less than others of its rarity. */
const MODEST_PIECE = 0.8;

// prettier-ignore
export const ITEM_PRICES = {
  // potion
  catnip_tuna_water:            { base:    15, category: 'potion' },
  health_potion:                { base:    15, category: 'potion' },
  speed_fizz:                   { base:   120, category: 'potion' },
  jugg_juice:                   { base:   220, category: 'potion' },
  cooldown_crisp:               { base:   150, category: 'potion' },
  stat_boost_potion:            { base:  1500, category: 'potion' },
  // food
  hamburger:                    { base:     8, category: 'food' },
  hollow_stew:                  { base:     5, category: 'food' },
  // armor
  lucky_hoodie:             gearPrice('lucky_hoodie', 1),
  scrappers_wraps:          gearPrice('scrappers_wraps', 1),
  hobnail_boots:            gearPrice('hobnail_boots', 1),
  riot_kneeguards:          gearPrice('riot_kneeguards', 1),
  iron_knuckle_gauntlet:    gearPrice('iron_knuckle_gauntlet', STANDOUT_PIECE),
  patched_duster:           gearPrice('patched_duster', 1),
  hazard_goggles:           gearPrice('hazard_goggles', 1),
  demolition_apron:         gearPrice('demolition_apron', 1),
  foremans_hardhat:         gearPrice('foremans_hardhat', 1),
  silkspinner_gloves:       gearPrice('silkspinner_gloves', 1),
  hamhock_boots:            gearPrice('hamhock_boots', 1),
  pot_lid_buckler:          gearPrice('pot_lid_buckler', 1),
  velvet_harness:           gearPrice('velvet_harness', 1),
  mousehide_booties:        gearPrice('mousehide_booties', 1),
  plumed_coat:           gearPrice('plumed_coat', 1),
  stargazers_cap:           gearPrice('stargazers_cap', 1),
  moonmoth_pendant:         gearPrice('moonmoth_pendant', 1),
  kaleidoscope_specs:       gearPrice('kaleidoscope_specs', 1),
  halo_of_the_ninth_life:   gearPrice('halo_of_the_ninth_life', 1),
  prowler_hood:             gearPrice('prowler_hood', 1),
  prowler_mantle:           gearPrice('prowler_mantle', 1),
  prowler_booties:          gearPrice('prowler_booties', 1),
  hearthguard_cap:          gearPrice('hearthguard_cap', 1),
  hearthguard_quilted_vest: gearPrice('hearthguard_quilted_vest', DOUBLE_STAT_PIECE),
  hearthguard_bracers:      gearPrice('hearthguard_bracers', 1),
  hearthguard_boots:        gearPrice('hearthguard_boots', 1),
  scrapmail_vest:           gearPrice('scrapmail_vest', 1),
  cockscomb_crest:          gearPrice('cockscomb_crest', 1),
  stoneheart_amulet:        gearPrice('stoneheart_amulet', 1),
  sun_locket:               gearPrice('sun_locket', 1),
  moon_locket:              gearPrice('moon_locket', 1),
  showmans_top_hat:         gearPrice('showmans_top_hat', 1),
  sequin_tailcoat:          gearPrice('sequin_tailcoat', 1),
  gilded_monocle:           gearPrice('gilded_monocle', 1),
  grinning_mask:            gearPrice('grinning_mask', 1),
  nimble_bangle:            gearPrice('nimble_bangle', 1),
  lucky_penny:              gearPrice('lucky_penny', 1),
  fang_charm:               gearPrice('fang_charm', 1),
  frostward_charm:          gearPrice('frostward_charm', 1),
  emberward_charm:          gearPrice('emberward_charm', 1),
  fae_iron_charm:           gearPrice('fae_iron_charm', 1),
  hourglass_charm:          gearPrice('hourglass_charm', 1),
  ember_wisp:               gearPrice('ember_wisp', STANDOUT_PIECE),
  ward_stone:               gearPrice('ward_stone', STANDOUT_PIECE),
  sproutling_seed:          gearPrice('sproutling_seed', STANDOUT_PIECE),
  // weapon
  rebar_shiv:               gearPrice('rebar_shiv', 1),
  pipe_wrench:              gearPrice('pipe_wrench', 1),
  rattlestick_sling:        gearPrice('rattlestick_sling', MODEST_PIECE),
  fire_axe:                 gearPrice('fire_axe', STANDOUT_PIECE),
  gravediggers_spade:       gearPrice('gravediggers_spade', STANDOUT_PIECE),
  stormcaller:              gearPrice('stormcaller', 1),
  the_last_word:            gearPrice('the_last_word', 1),
  tin_claw_caps:            gearPrice('tin_claw_caps', 1),
  venom_claws:              gearPrice('venom_claws', 1),
  frostbite_claws:          gearPrice('frostbite_claws', 1),
  prowler_claws:            gearPrice('prowler_claws', 1),
  ink_dipped_claws:         gearPrice('ink_dipped_claws', 1),
  sunsteel_talons:          gearPrice('sunsteel_talons', 1),
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
  seismic_stomp_tome:                   { base:  1000, category: 'tome' },
  explosives_handling_tome:     { base:   400, category: 'tome' },
  skill_book_nine_lives:         { base:   400, category: 'tome' },
  skill_book_cat_reflexes:      { base:   400, category: 'tome' },
  skill_book_pugilism:          { base:  1400, category: 'tome' },
  skill_book_iron_stomach:      { base:   400, category: 'tome' },
  skill_book_swordsmanship:     { base:   900, category: 'tome' },
  skill_book_archery:           { base:   900, category: 'tome' },
  skill_book_clawmanship:       { base:   900, category: 'tome' },
  skill_book_magic_eye:         { base:   900, category: 'tome' },
  skill_book_mechanical_fist:   { base:   900, category: 'tome' },
  skill_book_blunt_proficiency: { base:   900, category: 'tome' },
  skill_book_pyros_touch:       { base:   900, category: 'tome' },
  skill_book_demolitionist:     { base:   900, category: 'tome' },
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
  anchor_shard_lori:           { base:    20, category: 'quest' },
  anchor_shard_temple:          { base:    20, category: 'quest' },
  magistrates_writ:             { base:     0, category: 'quest' },
  unreadable_letter:            { base:     0, category: 'quest' },
  doomsday_scenario:            { base:     0, category: 'quest' },
  quest_scythe:                 { base:     0, category: 'quest' },
  quest_blueprints:             { base:     0, category: 'quest' },
  quest_prison_key:             { base:     0, category: 'quest' },
} as const satisfies Record<ItemId, ItemPrice>;
