/**
 * Where every piece of gear comes from, and the pools rolled from it. The
 * record is complete over {@link GearId}, so a piece with no declared source
 * does not compile, and a proving weapon (a `dev_*` id) cannot be given one.
 *
 * Every pool is derived from {@link GEAR_SOURCES} at the moment it is asked
 * for ("the pieces a wooden chest on floor 2 can hold, at Uncommon or below"),
 * never kept as a list of its own, so a new piece joins every pool its
 * sources name by declaring them.
 *
 * Gear is unique per party: a roll that lands on a piece either crawler
 * already has is rerolled once within its rarity, and pays the piece's sell
 * price in coins when that lands on an owned piece too.
 */

import type { AchievementId } from '../core/progression/AchievementManager';
import { ITEM_DEF, wearerAllows, type GearItemId, type ItemId } from '../core/items/defs/ItemDefs';
import type { QuestId } from '../core/quests/QuestManager';
import { RARITIES, rarityRank, type Rarity } from '../core/items/defs/rarity';
import type { CrawlerKind } from '../core/skills/SkillManager';
import { ITEM_PRICES } from '../economy/itemPrices';
import { DEFAULT_BUYBACK, MIN_PRICE_COINS } from '../economy/pricing';
import type { ShopId } from '../economy/shops';
import type { MobKind } from '../levels/mobKinds';
import type { LootDrop } from '../creatures/Mob';
import type { Player } from '../Player';
import type { WheelPrizeId } from '../systems/casino/wheel/wheelBoard';
import type { ChestType } from '../systems/TreasureChestSystem';

/** Every piece of gear a player can come by: armour and weapons, never the dev-only proving weapons. */
export type GearId = Exclude<GearItemId, `dev_${string}`>;

/** One way a piece of gear reaches a crawler. */
export type GearSource =
  | { readonly kind: 'shop'; readonly shop: ShopId }
  /** A boss's signature drop, in its chest on the first kill. */
  | { readonly kind: 'boss'; readonly boss: MobKind; readonly first: true }
  /**
   * A per-kill roll on top of the floor pool. With `creature`, any kill of that
   * kind on a dungeon floor rolls it; without, any kill of a mob on a floor
   * that allows world drops does (`GearKill.allowWorldGearDrop`).
   */
  | {
      readonly kind: 'mobDrop';
      readonly creature?: MobKind;
      readonly chance: number;
    }
  /** What a world treasure chest of `chest` may hold on these dungeon floors. */
  | { readonly kind: 'chest'; readonly chest: ChestType; readonly floors: ReadonlyArray<number> }
  | { readonly kind: 'achievement'; readonly id: AchievementId }
  | { readonly kind: 'quest'; readonly quest: QuestId }
  | { readonly kind: 'wheel'; readonly wedge: WheelPrizeId }
  /**
   * The general roll pool for these dungeon floors: the per-kill floor roll,
   * world chests on those floors, reward chests and the boss pool.
   */
  | { readonly kind: 'pool'; readonly floors: ReadonlyArray<number> };

/** The world-drop chance of the sling, per eligible mob kill on a floor that enables it. */
const SLING_DROP_CHANCE = 0.005;
const FAIRY_PENDANT_DROP_CHANCE = 0.02;
const BOMBER_APRON_DROP_CHANCE = 0.015;
const ARCHER_WARD_STONE_DROP_CHANCE = 0.01;

const FIRST_FLOOR = 1;
const SECOND_FLOOR = 2;
const THIRD_FLOOR = 3;
const FLOOR_ONE = [FIRST_FLOOR] as const;
const FLOOR_TWO = [SECOND_FLOOR] as const;
const FLOOR_THREE = [THIRD_FLOOR] as const;
const FLOORS_ONE_TWO = [FIRST_FLOOR, SECOND_FLOOR] as const;
const FLOORS_TWO_THREE = [SECOND_FLOOR, THIRD_FLOOR] as const;
const EVERY_FLOOR = [FIRST_FLOOR, SECOND_FLOOR, THIRD_FLOOR] as const;

export const GEAR_SOURCES: Readonly<Record<GearId, ReadonlyArray<GearSource>>> = {
  // Human only.
  lucky_hoodie: [{ kind: 'achievement', id: 'first_kill' }],
  scrappers_wraps: [{ kind: 'achievement', id: 'down_the_hatch' }],
  hobnail_boots: [
    { kind: 'achievement', id: 'flat_out' },
    { kind: 'chest', chest: 'wooden', floors: FLOOR_ONE },
    { kind: 'pool', floors: FLOOR_ONE },
  ],
  riot_kneeguards: [{ kind: 'achievement', id: 'wrecking_ball' }],
  iron_knuckle_gauntlet: [{ kind: 'achievement', id: 'pecking_order' }],
  patched_duster: [{ kind: 'quest', quest: 'borrowed_blueprints' }],
  hazard_goggles: [{ kind: 'achievement', id: 'two_birds_one_stick' }],
  demolition_apron: [
    { kind: 'mobDrop', creature: 'goblin_dynamiter', chance: BOMBER_APRON_DROP_CHANCE },
    { kind: 'mobDrop', creature: 'goblin_bombardier', chance: BOMBER_APRON_DROP_CHANCE },
    { kind: 'pool', floors: FLOOR_THREE },
  ],
  foremans_hardhat: [{ kind: 'quest', quest: 'construction_contract' }],
  silkspinner_gloves: [
    { kind: 'boss', boss: 'grotesque_spider', first: true },
    { kind: 'pool', floors: FLOOR_THREE },
  ],
  hamhock_boots: [{ kind: 'boss', boss: 'ball_of_swine', first: true }],

  // Human weapons.
  rebar_shiv: [{ kind: 'pool', floors: FLOOR_ONE }],
  pipe_wrench: [
    { kind: 'chest', chest: 'wooden', floors: FLOORS_ONE_TWO },
    { kind: 'pool', floors: FLOOR_TWO },
  ],
  rattlestick_sling: [{ kind: 'mobDrop', chance: SLING_DROP_CHANCE }],
  fire_axe: [{ kind: 'boss', boss: 'trash_gremlin', first: true }],
  gravediggers_spade: [{ kind: 'boss', boss: 'skeleton_lord', first: true }],
  stormcaller: [{ kind: 'wheel', wedge: 'legendary_weapon' }],
  the_last_word: [{ kind: 'achievement', id: 'dungeon_kills_1000' }],
  pot_lid_buckler: [{ kind: 'chest', chest: 'wooden', floors: FLOORS_ONE_TWO }],

  // Cat only.
  velvet_harness: [{ kind: 'achievement', id: 'down_the_hatch' }],
  mousehide_booties: [
    { kind: 'chest', chest: 'wooden', floors: FLOOR_ONE },
    { kind: 'pool', floors: FLOOR_ONE },
  ],
  plumed_coat: [{ kind: 'boss', boss: 'big_rooster', first: true }],
  stargazers_cap: [{ kind: 'achievement', id: 'spark_to_flame' }],
  moonmoth_pendant: [
    { kind: 'mobDrop', creature: 'fairy_shield', chance: FAIRY_PENDANT_DROP_CHANCE },
    { kind: 'mobDrop', creature: 'fairy_healer', chance: FAIRY_PENDANT_DROP_CHANCE },
    { kind: 'mobDrop', creature: 'fairy_ice', chance: FAIRY_PENDANT_DROP_CHANCE },
    { kind: 'mobDrop', creature: 'fairy_fire', chance: FAIRY_PENDANT_DROP_CHANCE },
    { kind: 'mobDrop', creature: 'fairy_necro', chance: FAIRY_PENDANT_DROP_CHANCE },
  ],
  kaleidoscope_specs: [{ kind: 'wheel', wedge: 'legendary_weapon' }],
  halo_of_the_ninth_life: [{ kind: 'achievement', id: 'not_a_scratch' }],
  prowler_hood: [{ kind: 'achievement', id: 'night_shift' }],
  prowler_mantle: [{ kind: 'quest', quest: 'stealth_key_snatch' }],
  prowler_booties: [{ kind: 'pool', floors: FLOOR_TWO }],
  tin_claw_caps: [{ kind: 'pool', floors: FLOOR_ONE }],
  venom_claws: [{ kind: 'pool', floors: FLOOR_TWO }],
  frostbite_claws: [{ kind: 'quest', quest: 'grotesque_spider' }],
  prowler_claws: [{ kind: 'pool', floors: FLOOR_THREE }],
  ink_dipped_claws: [{ kind: 'boss', boss: 'krakaren_clone', first: true }],
  sunsteel_talons: [
    { kind: 'achievement', id: 'dungeon_kills_500' },
    { kind: 'pool', floors: FLOOR_THREE },
  ],

  // Shared.
  hearthguard_cap: [{ kind: 'shop', shop: 'armoury' }],
  hearthguard_quilted_vest: [{ kind: 'shop', shop: 'armoury' }],
  hearthguard_bracers: [{ kind: 'shop', shop: 'armoury' }],
  hearthguard_boots: [{ kind: 'shop', shop: 'armoury' }],
  scrapmail_vest: [{ kind: 'boss', boss: 'trash_gremlin', first: true }],
  cockscomb_crest: [{ kind: 'boss', boss: 'big_rooster', first: true }],
  stoneheart_amulet: [{ kind: 'boss', boss: 'rock_golem_boss', first: true }],
  sun_locket: [{ kind: 'achievement', id: 'quest_defend_npc' }],
  moon_locket: [{ kind: 'achievement', id: 'quest_defend_npc' }],
  showmans_top_hat: [{ kind: 'quest', quest: 'the_show_must_go_on' }],
  sequin_tailcoat: [{ kind: 'quest', quest: 'the_show_must_go_on' }],
  gilded_monocle: [{ kind: 'achievement', id: 'casino_jackpot' }],
  grinning_mask: [{ kind: 'quest', quest: 'krasue_murders' }],
  nimble_bangle: [{ kind: 'shop', shop: 'armoury' }],
  lucky_penny: [
    { kind: 'achievement', id: 'bartenders_choice' },
    { kind: 'shop', shop: 'club_market' },
    { kind: 'chest', chest: 'wooden', floors: EVERY_FLOOR },
    { kind: 'pool', floors: FLOOR_ONE },
  ],
  fang_charm: [{ kind: 'pool', floors: FLOORS_TWO_THREE }],
  frostward_charm: [{ kind: 'wheel', wedge: 'epic_charm_frost' }],
  emberward_charm: [{ kind: 'wheel', wedge: 'epic_charm_ember' }],
  fae_iron_charm: [{ kind: 'wheel', wedge: 'legendary_charm' }],
  hourglass_charm: [
    { kind: 'achievement', id: 'disaster_averted' },
    { kind: 'boss', boss: 'the_lich', first: true },
    { kind: 'pool', floors: FLOOR_THREE },
  ],
  ember_wisp: [
    { kind: 'chest', chest: 'wooden', floors: FLOORS_TWO_THREE },
    { kind: 'chest', chest: 'silver', floors: FLOORS_TWO_THREE },
  ],
  ward_stone: [
    { kind: 'mobDrop', creature: 'goblin_archer', chance: ARCHER_WARD_STONE_DROP_CHANCE },
  ],
  sproutling_seed: [
    { kind: 'quest', quest: 'briar_hollow_plea' },
    { kind: 'pool', floors: FLOOR_THREE },
  ],
};

/** Whether `id` is a piece of gear a crawler can come by. */
export function isGearId(id: string): id is GearId {
  return id in GEAR_SOURCES;
}

const GEAR_IDS: readonly GearId[] = Object.keys(GEAR_SOURCES).filter(isGearId);

/** Whether either crawler holds `id` in a bag, on the hotbar or worn. */
export function partyOwnsGear(party: ReadonlyArray<Player>, id: ItemId): boolean {
  return party.some(
    (crawler) => crawler.inventory.countOf(id) > 0 || crawler.inventory.equipment.hasEquipped(id),
  );
}

/** What a shop pays for one of `id` at its base price: a duplicate piece's worth in coins. */
export function duplicateCoins(id: ItemId): number {
  return Math.max(MIN_PRICE_COINS, Math.round(ITEM_PRICES[id].base * DEFAULT_BUYBACK));
}

/** Which of a piece's sources a pool is drawn from. */
export type GearPoolSource =
  { readonly kind: 'pool' } | { readonly kind: 'chest'; readonly chest: ChestType };

/** What a derived pool asks of each piece. Every field narrows; an absent one does not. */
export interface GearPoolQuery {
  readonly source: GearPoolSource;
  /** The dungeon floor rolling it; absent, a piece from any floor qualifies. */
  readonly floor?: number;
  /** Only pieces of exactly this rarity. */
  readonly rarity?: Rarity;
  /** Only pieces of this rarity or below. */
  readonly maxRarity?: Rarity;
  /** Only pieces this crawler can wear. */
  readonly wearer?: CrawlerKind;
}

function onFloor(floors: ReadonlyArray<number>, floor: number | undefined): boolean {
  return floor === undefined ? floors.length > 0 : floors.includes(floor);
}

function isPoolPiece(sources: ReadonlyArray<GearSource>, floor: number | undefined): boolean {
  return sources.some((source) => source.kind === 'pool' && onFloor(source.floors, floor));
}

/**
 * Whether one of `sources` puts its piece in this pool. A chest also holds the
 * floor's general pool, so a world chest is never poorer than a kill.
 */
function sourcedFrom(
  sources: ReadonlyArray<GearSource>,
  pool: GearPoolSource,
  floor: number | undefined,
): boolean {
  if (isPoolPiece(sources, floor)) return true;
  if (pool.kind === 'pool') return false;
  return sources.some(
    (source) =>
      source.kind === 'chest' && source.chest === pool.chest && onFloor(source.floors, floor),
  );
}

/** Every piece the query admits, in catalogue order. */
function gearPool(query: GearPoolQuery): GearId[] {
  return GEAR_IDS.filter((id) => {
    if (!sourcedFrom(GEAR_SOURCES[id], query.source, query.floor)) return false;
    const def = ITEM_DEF[id];
    const rarity = def.rarity;
    if (rarity === undefined) return false;
    if (query.rarity !== undefined && rarity !== query.rarity) return false;
    if (query.maxRarity !== undefined && rarityRank(rarity) > rarityRank(query.maxRarity)) {
      return false;
    }
    return query.wearer === undefined || wearerAllows(def.wearer, query.wearer);
  });
}

/** A weight per rarity a roll may land on; a rarity left out is never rolled. */
export type RarityWeights = Readonly<Partial<Record<Rarity, number>>>;

/** One rarity drawn from `weights`, or null when they are all zero. */
export function rollRarity(weights: RarityWeights, rng: () => number): Rarity | null {
  const total = RARITIES.reduce((sum, rarity) => sum + (weights[rarity] ?? 0), 0);
  if (total <= 0) return null;
  let left = rng() * total;
  for (const rarity of RARITIES) {
    const weight = weights[rarity] ?? 0;
    if (weight <= 0) continue;
    if (left < weight) return rarity;
    left -= weight;
  }
  return null;
}

/** What one gear roll paid: a piece, or a piece already owned paid out as coins. */
export type GearRollResult =
  | { readonly kind: 'item'; readonly id: GearId }
  | { readonly kind: 'duplicate'; readonly id: GearId; readonly coins: number };

function pick<T>(pool: readonly T[], rng: () => number): T | undefined {
  return pool[Math.floor(rng() * pool.length)];
}

/**
 * The pool at `rarity`, or at the nearest rarity that still has a piece the
 * party lacks: first below it, so a floor with no piece that rare pays the
 * best it has, then above it, so a floor with nothing that plain pays its
 * least piece. When the party owns every piece in reach, the nearest
 * non-empty pool, whose roll then pays as a duplicate.
 */
function poolNearest(
  query: Omit<GearPoolQuery, 'rarity' | 'maxRarity'>,
  rarity: Rarity,
  owns: (id: GearId) => boolean,
): GearId[] {
  const rolled = rarityRank(rarity);
  const below = RARITIES.slice(0, rolled + 1).reverse();
  const above = RARITIES.slice(rolled + 1);
  const tiers = [...below, ...above].map((candidate) => gearPool({ ...query, rarity: candidate }));
  const withSomethingLeft = tiers.find((pool) => pool.some((id) => !owns(id)));
  return withSomethingLeft ?? tiers.find((pool) => pool.length > 0) ?? [];
}

/**
 * One piece of `rarity` from the pool `query` names, or of the nearest rarity
 * with a piece the party lacks, or null when the pool is empty. A piece `owns`
 * answers true for is rerolled once within the same rarity; landing on an
 * owned piece again pays its sell price instead.
 */
export function rollGearFromPool(
  query: Omit<GearPoolQuery, 'rarity' | 'maxRarity'>,
  rarity: Rarity,
  rng: () => number,
  owns: (id: GearId) => boolean,
): GearRollResult | null {
  return pickWithReroll(poolNearest(query, rarity, owns), rng, owns);
}

/**
 * One piece from `pool`, rerolled once when it lands on an owned piece, and
 * paid as coins when the reroll lands on one too.
 */
function pickWithReroll(
  pool: readonly GearId[],
  rng: () => number,
  owns: (id: GearId) => boolean,
): GearRollResult | null {
  const first = pick(pool, rng);
  if (first === undefined) return null;
  if (!owns(first)) return { kind: 'item', id: first };
  const second = pick(pool, rng) ?? first;
  if (!owns(second)) return { kind: 'item', id: second };
  return { kind: 'duplicate', id: second, coins: duplicateCoins(second) };
}

/** Gear and coins a kill or a chest adds to its loot. */
export interface GearLoot {
  readonly items: GearId[];
  coins: number;
}

function addRoll(loot: GearLoot, result: GearRollResult | null): void {
  if (result === null) return;
  if (result.kind === 'item') loot.items.push(result.id);
  else loot.coins += result.coins;
}

/** The chance any ordinary kill on a dungeon floor rolls that floor's pool. */
const MOB_POOL_DROP_CHANCE = 0.006;

/** How the per-kill floor roll leans by floor: deeper floors hand out rarer pieces. */
const MOB_POOL_RARITY_WEIGHTS: ReadonlyMap<number, RarityWeights> = new Map([
  [FIRST_FLOOR, { Common: 80, Uncommon: 20 }],
  [SECOND_FLOOR, { Common: 45, Uncommon: 40, Rare: 15 }],
  [THIRD_FLOOR, { Uncommon: 55, Rare: 38, Epic: 7 }],
]);

/**
 * The gear an ordinary kill of `kind` on dungeon floor `floor` drops: the
 * floor pool's roll, and on top of it any named drop `kind` carries.
 */
export function rollMobGear(
  kill: Pick<GearKill, 'spawnTypeKey' | 'allowWorldGearDrop'>,
  floor: number,
  rng: () => number,
  owns: (id: GearId) => boolean,
): GearLoot {
  const loot: GearLoot = { items: [], coins: 0 };
  const taken = (id: GearId): boolean => owns(id) || loot.items.includes(id);
  const weights = MOB_POOL_RARITY_WEIGHTS.get(floor);
  if (weights !== undefined && rng() < MOB_POOL_DROP_CHANCE) {
    const rarity = rollRarity(weights, rng);
    if (rarity !== null)
      addRoll(loot, rollGearFromPool({ source: { kind: 'pool' }, floor }, rarity, rng, taken));
  }
  for (const id of GEAR_IDS) {
    for (const source of GEAR_SOURCES[id]) {
      if (source.kind !== 'mobDrop' || !dropsFrom(source, kill)) continue;
      if (rng() >= source.chance) continue;
      if (taken(id)) loot.coins += duplicateCoins(id);
      else loot.items.push(id);
    }
  }
  return loot;
}

/** Whether a `mobDrop` source rolls for this kill. */
function dropsFrom(
  source: Extract<GearSource, { kind: 'mobDrop' }>,
  kill: Pick<GearKill, 'spawnTypeKey' | 'allowWorldGearDrop'>,
): boolean {
  if (source.creature === undefined) return kill.allowWorldGearDrop;
  return source.creature === kill.spawnTypeKey;
}

/** The lowest floor whose bosses also roll the boss pool on every kill. */
const BOSS_POOL_MIN_FLOOR = SECOND_FLOOR;

/** How a boss-pool piece leans: almost always Rare or Epic, now and then Legendary. */
const BOSS_POOL_RARITY_WEIGHTS: RarityWeights = { Rare: 60, Epic: 35, Legendary: 5 };

/** Whether `kind` carries a signature drop: the bosses whose kills pay gear. */
export function isGearBoss(kind: MobKind): boolean {
  return GEAR_IDS.some((id) =>
    GEAR_SOURCES[id].some((source) => source.kind === 'boss' && source.boss === kind),
  );
}

/**
 * The gear a kill of the boss `kind` on floor `floor` pays: its signature
 * pieces the party does not own yet, which is what makes them first-kill
 * drops, and from the second floor on one piece from the boss pool.
 */
export function rollBossGear(
  kind: MobKind,
  floor: number,
  rng: () => number,
  owns: (id: GearId) => boolean,
): GearLoot {
  const loot: GearLoot = { items: [], coins: 0 };
  for (const id of GEAR_IDS) {
    const signature = GEAR_SOURCES[id].some(
      (source) => source.kind === 'boss' && source.boss === kind,
    );
    if (signature && !owns(id)) loot.items.push(id);
  }
  if (floor < BOSS_POOL_MIN_FLOOR) return loot;
  const rarity = rollRarity(BOSS_POOL_RARITY_WEIGHTS, rng);
  const taken = (id: GearId): boolean => owns(id) || loot.items.includes(id);
  if (rarity !== null)
    addRoll(loot, rollGearFromPool({ source: { kind: 'pool' } }, rarity, rng, taken));
  return loot;
}

/** How likely a world chest is to hold a piece of gear, and how rare it may be. */
interface ChestGearRule {
  readonly chance: number;
  readonly maxRarity: (floor: number) => Rarity;
}

const WOODEN_CHEST_GEAR_CHANCE = 0.12;
const SILVER_CHEST_GEAR_CHANCE = 0.4;

const CHEST_GEAR_RULES: Readonly<Record<ChestType, ChestGearRule>> = {
  wooden: {
    chance: WOODEN_CHEST_GEAR_CHANCE,
    // The first floor's chests hold only everyday pieces.
    maxRarity: (floor) => (floor <= FIRST_FLOOR ? 'Uncommon' : 'Rare'),
  },
  silver: { chance: SILVER_CHEST_GEAR_CHANCE, maxRarity: () => 'Rare' },
};

/** The piece, if any, a world chest of `chest` on floor `floor` holds. */
export function rollChestGear(
  chest: ChestType,
  floor: number,
  rng: () => number,
  owns: (id: GearId) => boolean,
): GearLoot {
  const loot: GearLoot = { items: [], coins: 0 };
  const rule = CHEST_GEAR_RULES[chest];
  if (rng() >= rule.chance) return loot;
  const pool = gearPool({
    source: { kind: 'chest', chest },
    floor,
    maxRarity: rule.maxRarity(floor),
  });
  addRoll(loot, pickWithReroll(pool, rng, owns));
  return loot;
}

/** What a kill's gear roll needs to know about the mob that died. */
export interface GearKill {
  readonly spawnTypeKey: MobKind | null;
  readonly isBoss: boolean;
  /** A boss's own staged add, which is part of the fight rather than a kill of its own. */
  readonly isBossAdd: boolean;
  /** Whether the floor lets this mob roll the world drops no one creature carries. */
  readonly allowWorldGearDrop: boolean;
}

/**
 * The gear one kill on dungeon floor `floor` pays: a boss with a signature
 * pays its boss roll, any other boss and its adds pay none, and every other
 * kill rolls the floor pool and its own named drops.
 */
export function rollKillGear(
  kill: GearKill,
  floor: number,
  rng: () => number,
  owns: (id: GearId) => boolean,
): GearLoot {
  if (kill.spawnTypeKey !== null && isGearBoss(kill.spawnTypeKey)) {
    return rollBossGear(kill.spawnTypeKey, floor, rng, owns);
  }
  if (kill.isBoss || kill.isBossAdd) return { items: [], coins: 0 };
  return rollMobGear(kill, floor, rng, owns);
}

/** `loot` with `gear` added on top, or null when both are empty. */
export function withGearLoot(loot: LootDrop | null, gear: GearLoot): LootDrop | null {
  if (gear.items.length === 0 && gear.coins === 0) return loot;
  const base = loot ?? { coins: 0, items: [] };
  return {
    ...base,
    coins: base.coins + gear.coins,
    items: [...base.items, ...gear.items.map((id) => ({ id, quantity: 1 }))],
  };
}
