/**
 * Every coin fee charged at a counter for an effect rather than an item: rooms,
 * blessings, drills, sharpening, tattoos, readings, hires, on-the-spot food and
 * drink. The forge's tool upgrades are not here: they cost the tool's own base
 * in `itemPrices.ts`.
 *
 * These live together, beside the item prices, so a rebalancing pass sees every
 * coin sink in one file. Unlike items they carry no stock and nothing buys them
 * back, so their price never moves at runtime: the number here is the number
 * the player pays, or the base a system's own fee formula scales from.
 *
 * Not here, because each is tuned in its own system: casino stakes and payouts,
 * quest rewards, mob coin drops, and construction material costs (which are
 * `ResourceCost`, not coins).
 */
export const SERVICE_PRICES = {
  temple: { blessing: 25 },
  inn: { attic_room: 25, hearth_room: 55, cats_own_room: 90 },
  /**
   * Each point dearer than the last: the cap is meant to be felt as diminishing
   * returns on the way up rather than hit as a wall at the top.
   */
  drill_yard: { first_point: 35, second_point: 75, third_point: 150, fourth_point: 275 },
  /** The pair is discounted against two singles: she only heats the forge once. */
  smithy: { single_edge: 18, pair_edge: 30 },
  /** The skill mark is dearer because it teaches a skill on top of its effect. */
  tattoo_parlor: { stat_tattoo: 1500, skill_tattoo: 3500 },
  apothecary: { cure: 12 },
  pub: {
    ale: 6,
    boozy_milk: 14,
    mead: 12,
    guild_reserve: 22,
    honey_bread: 5,
    stew: 9,
    nightcap: 16,
  },
  mill_farm: { hot_plate: 6 },
  builder_farm: { hayloft: 10 },
  /** The plaza seer charges for the theatre; Lori reads at her own table for less. */
  fortune: { plaza_seer: 3, hedge_witch: 2 },
  /**
   * Tuned against floor-3 coin income: the cheapest hire barely fights, the
   * dearest is the best tank.
   */
  mercenary_guild: {
    brother_anselm: 120,
    ivy_ashgrove: 260,
    tumbledown: 300,
    hammer_hands: 300,
    crush: 350,
  },
  /**
   * Sella's treatment scales with the party's missing health; the per-point rate
   * is a fraction of a coin because a hurt party is only missing a few dozen
   * points. The minimum fee keeps a scratch from being seen to for a coin or
   * two: a graze is something to drink a potion over, not a reason to queue
   * at the infirmary.
   */
  infirmary: { minimum_fee: 5, per_missing_hp: 0.7 },
  /** Fenna runs a batch through the mill for a flat rate per wood fed in. */
  lumber_yard: { processing_per_wood: 8 },
} as const satisfies Record<string, Record<string, number>>;
