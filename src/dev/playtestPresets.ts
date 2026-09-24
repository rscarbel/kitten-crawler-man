import type { ItemId } from '../core/ItemDefs';
import type { StatName } from '../Player';
import type { SkillId } from '../core/SkillManager';
import type { AbilityId } from '../core/AbilityManager';
import type { MobSpawnRule } from '../levels/types';
import type { Difficulty } from '../core/difficultyProfiles';
import type { DoomsdayStage } from '../core/DoomsdayProgress';
import type { MercenaryTemplateId } from '../core/mercenaryTemplates';
import type { CircusQuestStage } from '../core/CircusQuestProgress';

/**
 * Named starting points for playtesting, each one a floor plus the party that
 * should arrive on it. `npm run playtest -- <id>` opens the game straight into
 * one; nothing here is reachable from a shipped build.
 *
 * Deliberately type-only in its imports so the npm script can import this table
 * under Node to validate an id — every value import in this tree eventually
 * reaches browser-only rendering code.
 */

/** Where a preset drops the party, resolved once the floor's map exists. */
export type PlaytestSpawn =
  /** The floor's own entry point — map centre on a dungeon, the plaza in town. */
  | { readonly kind: 'mapStart' }
  /** The gateway safe room whose only onward exit is this boss's room. */
  | { readonly kind: 'safeRoomBefore'; readonly bossType: MobSpawnRule['type'] }
  /** The corridor tile immediately outside the spider lab's door. */
  | { readonly kind: 'spiderLabEntrance' }
  /** The tile just inside the goblin mother's nursery, by the way in. */
  | { readonly kind: 'questRoomEntrance' };

/** One stack of items placed in a fixed slot. */
export interface PlaytestStack {
  readonly id: ItemId;
  readonly quantity: number;
  /** Worn on arrival. The stack stays where it is — equipment is tracked by id. */
  readonly equipped?: boolean;
}

/** One crawler's state at the moment the preset hands them the controls. */
export interface PlaytestLoadout {
  readonly level: number;
  /**
   * Fraction (0-1) of the way banked toward the next level, not a lifetime
   * total. Converted to an absolute XP amount against the starting level's
   * own requirement, so every preset levels up after the same proportional
   * amount of further XP regardless of how high `level` is.
   */
  readonly xpProgress: number;
  readonly coins: number;
  /** Stat values before equipment. Omitted stats keep the species default. */
  readonly baseStats: Partial<Record<StatName, number>>;
  /** Human only; the cat has no explosives training. */
  readonly explosivesHandling?: number;
  readonly skillLevels: Partial<Record<SkillId, number>>;
  /** Hotbar contents from slot 0 up. */
  readonly hotbar: readonly PlaytestStack[];
  /** Bag contents from slot 0 up. */
  readonly bag: readonly PlaytestStack[];
}

export interface PlaytestPreset {
  readonly id: string;
  /** Printed by the npm script when it lists what can be played. */
  readonly description: string;
  readonly levelId: string;
  readonly spawn: PlaytestSpawn;
  /** Applied to `Settings` before the floor is built. Omitted presets keep the player's own choice. */
  readonly difficulty?: Difficulty;
  /** Ability levels, shared by both crawlers through one AbilityManager. */
  readonly abilityLevels: Partial<Record<AbilityId, number>>;
  readonly human: PlaytestLoadout;
  readonly cat: PlaytestLoadout;
  /**
   * Boss types to skip spawning entirely and mark won before the first frame —
   * for a preset that drops the party past a gauntlet gate it never fought.
   * Its room seals shut on skip like any other win: revealed on the minimap,
   * no chest guard, no hard-mode healer spawned for a boss that was never there.
   */
  readonly preDefeatedBossTypes?: readonly MobSpawnRule['type'][];
  /**
   * Drops the party into the doomsday finale at this stage, with a full
   * countdown and the Krasue Murders closed behind it at the Lich's death.
   */
  readonly doomsdayStage?: Extract<DoomsdayStage, 'containment' | 'escape'>;
  /** A Meat Shields hire already under contract for this floor, standing beside the party. */
  readonly hire?: MercenaryTemplateId;
  /** Mongo already out beside the cat on the first frame, rather than waiting on a summon. */
  readonly mongoOut?: boolean;
  /**
   * "The Show Must Go On" already at this point, with the party put down on the
   * circus grounds instead of at `spawn`.
   */
  readonly circusQuest?: { readonly stage: CircusQuestStage; readonly heatherSlain: boolean };
}

const HOARDER: PlaytestPreset = {
  id: 'hoarder',
  description: 'Safe room just before the Hoarder',
  levelId: 'level1',
  spawn: { kind: 'safeRoomBefore', bossType: 'the_hoarder' },
  abilityLevels: { smush: 3, magic_missile: 3, protective_shell: 3 },
  human: {
    level: 4,
    xpProgress: 0.5,
    coins: 270,
    baseStats: { strength: 4, constitution: 3, dexterity: 2 },
    explosivesHandling: 1,
    skillLevels: {},
    hotbar: [
      { id: 'smush_tome', quantity: 1 },
      { id: 'health_potion', quantity: 13 },
      { id: 'enchanted_bigboi_boxers', quantity: 1, equipped: true },
      { id: 'goblin_dynamite', quantity: 2 },
    ],
    bag: [{ id: 'scroll_of_confusing_fog', quantity: 1 }],
  },
  cat: {
    level: 4,
    xpProgress: 0.5,
    coins: 270,
    baseStats: { strength: 1, intelligence: 4, constitution: 2, dexterity: 11 },
    skillLevels: {},
    hotbar: [
      { id: 'magic_missile_tome', quantity: 1 },
      { id: 'health_potion', quantity: 14 },
      { id: 'scroll_of_confusing_fog', quantity: 1 },
    ],
    bag: [{ id: 'goblin_dynamite', quantity: 1 }],
  },
};

const JUICER: PlaytestPreset = {
  id: 'juicer',
  description: 'Safe room just before the Juicer',
  levelId: 'level1',
  spawn: { kind: 'safeRoomBefore', bossType: 'juicer' },
  abilityLevels: { smush: 4, magic_missile: 4, protective_shell: 3 },
  human: {
    level: 11,
    xpProgress: 0.5,
    coins: 630,
    baseStats: { strength: 7, constitution: 10, dexterity: 2 },
    explosivesHandling: 1,
    skillLevels: {},
    hotbar: [
      { id: 'smush_tome', quantity: 1 },
      { id: 'health_potion', quantity: 17 },
      { id: 'enchanted_bigboi_boxers', quantity: 1, equipped: true },
      { id: 'goblin_dynamite', quantity: 6 },
    ],
    bag: [
      { id: 'scroll_of_confusing_fog', quantity: 3 },
      { id: 'trollskin_shirt', quantity: 1, equipped: true },
    ],
  },
  cat: {
    level: 7,
    xpProgress: 0.5,
    coins: 630,
    baseStats: { strength: 2, intelligence: 6, constitution: 2, dexterity: 14 },
    skillLevels: { cockroach: 1 },
    hotbar: [
      { id: 'magic_missile_tome', quantity: 1 },
      { id: 'health_potion', quantity: 16 },
      { id: 'scroll_of_confusing_fog', quantity: 2 },
    ],
    bag: [{ id: 'goblin_dynamite', quantity: 2 }],
  },
};

const LEVEL2: PlaytestPreset = {
  id: 'level2',
  description: 'Start of the second floor',
  levelId: 'level2',
  spawn: { kind: 'mapStart' },
  abilityLevels: { smush: 5, magic_missile: 6, protective_shell: 3 },
  human: {
    level: 12,
    xpProgress: 0.5,
    coins: 1173,
    baseStats: { strength: 8, constitution: 10, dexterity: 2 },
    explosivesHandling: 1,
    skillLevels: { pugilism: 2 },
    hotbar: [
      { id: 'smush_tome', quantity: 1 },
      { id: 'slingshot', quantity: 1 },
      { id: 'health_potion', quantity: 22 },
      { id: 'enchanted_bigboi_boxers', quantity: 1, equipped: true },
      { id: 'goblin_dynamite', quantity: 10 },
    ],
    bag: [
      { id: 'scroll_of_confusing_fog', quantity: 4 },
      { id: 'trollskin_shirt', quantity: 1, equipped: true },
      { id: 'nightgaunt_cloak', quantity: 1, equipped: true },
      { id: 'splatter_skunk_toe_ring', quantity: 1, equipped: true },
      { id: 'shade_gnoll_kneepads', quantity: 1, equipped: true },
      { id: 'grull_war_gauntlet', quantity: 1, equipped: true },
      { id: 'gym_bench_press', quantity: 2 },
      { id: 'gym_treadmill', quantity: 2 },
      { id: 'jugg_juice', quantity: 1 },
      { id: 'speed_fizz', quantity: 1 },
    ],
  },
  cat: {
    level: 13,
    xpProgress: 0.5,
    coins: 1173,
    baseStats: { strength: 2, intelligence: 17, constitution: 2, dexterity: 20 },
    skillLevels: { cockroach: 1 },
    hotbar: [
      { id: 'magic_missile_tome', quantity: 1 },
      { id: 'health_potion', quantity: 28 },
      { id: 'scroll_of_confusing_fog', quantity: 7 },
    ],
    bag: [
      { id: 'goblin_dynamite', quantity: 7 },
      { id: 'gym_bench_press', quantity: 1 },
      { id: 'enchanted_crown_sepsis_whore', quantity: 1, equipped: true },
      { id: 'slate_butterfly_talisman', quantity: 1, equipped: true },
      { id: 'fae_scale_crupper', quantity: 1, equipped: true },
      { id: 'bracelet_of_dex', quantity: 1, equipped: true },
    ],
  },
};

const KRAKAREN: PlaytestPreset = {
  id: 'krakaren',
  description: 'Safe room just before the Krakaren Clone',
  levelId: 'level2',
  spawn: { kind: 'safeRoomBefore', bossType: 'krakaren_clone' },
  abilityLevels: { smush: 6, magic_missile: 6, protective_shell: 3 },
  human: {
    level: 17,
    xpProgress: 0.5,
    coins: 1488,
    baseStats: { strength: 12, constitution: 11, dexterity: 2 },
    explosivesHandling: 1,
    skillLevels: { pugilism: 2 },
    hotbar: [
      { id: 'smush_tome', quantity: 1 },
      { id: 'slingshot', quantity: 1 },
      { id: 'health_potion', quantity: 31 },
      { id: 'enchanted_bigboi_boxers', quantity: 1, equipped: true },
      { id: 'goblin_dynamite', quantity: 10 },
      { id: 'gym_bench_press', quantity: 2 },
      { id: 'gym_treadmill', quantity: 2 },
    ],
    bag: [
      { id: 'scroll_of_confusing_fog', quantity: 5 },
      { id: 'trollskin_shirt', quantity: 1, equipped: true },
      { id: 'nightgaunt_cloak', quantity: 1, equipped: true },
      { id: 'splatter_skunk_toe_ring', quantity: 1, equipped: true },
      { id: 'shade_gnoll_kneepads', quantity: 1, equipped: true },
      { id: 'grull_war_gauntlet', quantity: 1, equipped: true },
      { id: 'jugg_juice', quantity: 1 },
      { id: 'speed_fizz', quantity: 1 },
    ],
  },
  cat: {
    level: 15,
    xpProgress: 0.5,
    coins: 1488,
    baseStats: { strength: 2, intelligence: 19, constitution: 2, dexterity: 22 },
    skillLevels: { cockroach: 1 },
    hotbar: [
      { id: 'magic_missile_tome', quantity: 1 },
      { id: 'health_potion', quantity: 28 },
      { id: 'scroll_of_confusing_fog', quantity: 7 },
    ],
    bag: [
      { id: 'goblin_dynamite', quantity: 7 },
      { id: 'gym_bench_press', quantity: 1 },
      { id: 'enchanted_crown_sepsis_whore', quantity: 1, equipped: true },
      { id: 'slate_butterfly_talisman', quantity: 1, equipped: true },
      { id: 'fae_scale_crupper', quantity: 1, equipped: true },
      { id: 'bracelet_of_dex', quantity: 1, equipped: true },
    ],
  },
};

const SPIDER: PlaytestPreset = {
  id: 'spider',
  description: 'Outside the spider lab door, by the scientist',
  levelId: 'level2',
  spawn: { kind: 'spiderLabEntrance' },
  abilityLevels: { smush: 6, magic_missile: 6, protective_shell: 3 },
  human: {
    level: 20,
    xpProgress: 0.5,
    coins: 1903,
    baseStats: { strength: 12, constitution: 14, dexterity: 2 },
    explosivesHandling: 1,
    skillLevels: { pugilism: 4 },
    hotbar: [
      { id: 'smush_tome', quantity: 1 },
      { id: 'slingshot', quantity: 1 },
      { id: 'health_potion', quantity: 34 },
      { id: 'enchanted_bigboi_boxers', quantity: 1, equipped: true },
      { id: 'goblin_dynamite', quantity: 14 },
      { id: 'gym_bench_press', quantity: 2 },
      { id: 'gym_treadmill', quantity: 2 },
    ],
    bag: [
      { id: 'scroll_of_confusing_fog', quantity: 5 },
      { id: 'trollskin_shirt', quantity: 1, equipped: true },
      { id: 'nightgaunt_cloak', quantity: 1, equipped: true },
      { id: 'splatter_skunk_toe_ring', quantity: 1, equipped: true },
      { id: 'shade_gnoll_kneepads', quantity: 1, equipped: true },
      { id: 'grull_war_gauntlet', quantity: 1, equipped: true },
      { id: 'jugg_juice', quantity: 1 },
      { id: 'speed_fizz', quantity: 1 },
    ],
  },
  cat: {
    level: 20,
    xpProgress: 0.5,
    coins: 1903,
    baseStats: { strength: 5, intelligence: 21, constitution: 2, dexterity: 22 },
    skillLevels: { cockroach: 1, iron_stomach: 1, night_vision: 1 },
    hotbar: [
      { id: 'magic_missile_tome', quantity: 1 },
      { id: 'health_potion', quantity: 28 },
      { id: 'scroll_of_confusing_fog', quantity: 7 },
    ],
    bag: [
      { id: 'goblin_dynamite', quantity: 7 },
      { id: 'enchanted_crown_sepsis_whore', quantity: 1, equipped: true },
      { id: 'slate_butterfly_talisman', quantity: 1, equipped: true },
      { id: 'fae_scale_crupper', quantity: 1, equipped: true },
      { id: 'bracelet_of_dex', quantity: 1, equipped: true },
      { id: 'gym_bench_press', quantity: 1 },
    ],
  },
};

const LEVEL3: PlaytestPreset = {
  id: 'level3',
  description: 'Third floor town',
  levelId: 'level3',
  spawn: { kind: 'mapStart' },
  abilityLevels: { smush: 7, magic_missile: 6, protective_shell: 3 },
  human: {
    level: 28,
    xpProgress: 0.5,
    coins: 2327,
    baseStats: { strength: 12, constitution: 16, dexterity: 6 },
    explosivesHandling: 3,
    skillLevels: { pugilism: 5 },
    hotbar: [
      { id: 'smush_tome', quantity: 1 },
      { id: 'slingshot', quantity: 1 },
      { id: 'health_potion', quantity: 38 },
      { id: 'enchanted_bigboi_boxers', quantity: 1, equipped: true },
      { id: 'goblin_dynamite', quantity: 18 },
      { id: 'gym_bench_press', quantity: 2 },
      { id: 'gym_treadmill', quantity: 2 },
    ],
    bag: [
      { id: 'scroll_of_confusing_fog', quantity: 5 },
      { id: 'trollskin_shirt', quantity: 1, equipped: true },
      { id: 'nightgaunt_cloak', quantity: 1, equipped: true },
      { id: 'splatter_skunk_toe_ring', quantity: 1, equipped: true },
      { id: 'shade_gnoll_kneepads', quantity: 1, equipped: true },
      { id: 'grull_war_gauntlet', quantity: 1, equipped: true },
      { id: 'jugg_juice', quantity: 1 },
      { id: 'speed_fizz', quantity: 1 },
    ],
  },
  cat: {
    level: 28,
    xpProgress: 0.5,
    coins: 2327,
    baseStats: { strength: 5, intelligence: 28, constitution: 2, dexterity: 34 },
    skillLevels: { cockroach: 1, iron_stomach: 1, night_vision: 1 },
    hotbar: [
      { id: 'magic_missile_tome', quantity: 1 },
      { id: 'health_potion', quantity: 34 },
      { id: 'scroll_of_confusing_fog', quantity: 8 },
    ],
    bag: [
      { id: 'goblin_dynamite', quantity: 7 },
      { id: 'enchanted_crown_sepsis_whore', quantity: 1, equipped: true },
      { id: 'slate_butterfly_talisman', quantity: 1, equipped: true },
      { id: 'fae_scale_crupper', quantity: 1, equipped: true },
      { id: 'bracelet_of_dex', quantity: 1, equipped: true },
      { id: 'gym_bench_press', quantity: 1 },
    ],
  },
};

/**
 * The antechamber outside the Iron Colosseum, with the party that would plausibly
 * be standing in it.
 *
 * Levelled and kitted past the Krakaren, because that is the only order in which
 * this fight can be reached — the arena is sited in the free region past the
 * gauntlet — and carrying gym barriers, which are the item half of the ball's
 * counterplay and are otherwise several rooms behind on floor 1.
 */
const SWINE: PlaytestPreset = {
  id: 'swine',
  description: 'Antechamber outside the Ball of Swine arena',
  levelId: 'level2',
  spawn: { kind: 'safeRoomBefore', bossType: 'ball_of_swine' },
  abilityLevels: { smush: 7, magic_missile: 7, protective_shell: 4 },
  human: {
    level: 18,
    xpProgress: 0.5,
    coins: 1620,
    baseStats: { strength: 13, constitution: 12, dexterity: 3 },
    explosivesHandling: 1,
    skillLevels: { pugilism: 3 },
    hotbar: [
      { id: 'smush_tome', quantity: 1 },
      { id: 'slingshot', quantity: 1 },
      { id: 'health_potion', quantity: 30 },
      { id: 'enchanted_bigboi_boxers', quantity: 1, equipped: true },
      { id: 'gym_bench_press', quantity: 4 },
    ],
    bag: [
      { id: 'trollskin_shirt', quantity: 1, equipped: true },
      { id: 'nightgaunt_cloak', quantity: 1, equipped: true },
      { id: 'splatter_skunk_toe_ring', quantity: 1, equipped: true },
      { id: 'shade_gnoll_kneepads', quantity: 1, equipped: true },
      { id: 'grull_war_gauntlet', quantity: 1, equipped: true },
      { id: 'gym_treadmill', quantity: 4 },
      { id: 'gym_dumbbell', quantity: 4 },
      { id: 'goblin_dynamite', quantity: 8 },
      { id: 'jugg_juice', quantity: 2 },
      { id: 'speed_fizz', quantity: 2 },
    ],
  },
  cat: {
    level: 19,
    xpProgress: 0.5,
    coins: 1620,
    baseStats: { strength: 3, intelligence: 20, constitution: 2, dexterity: 24 },
    skillLevels: { cockroach: 1 },
    hotbar: [
      { id: 'magic_missile_tome', quantity: 1 },
      { id: 'health_potion', quantity: 30 },
      { id: 'gym_treadmill', quantity: 4 },
    ],
    bag: [
      { id: 'scroll_of_confusing_fog', quantity: 6 },
      { id: 'enchanted_crown_sepsis_whore', quantity: 1, equipped: true },
      { id: 'slate_butterfly_talisman', quantity: 1, equipped: true },
      { id: 'fae_scale_crupper', quantity: 1, equipped: true },
      { id: 'bracelet_of_dex', quantity: 1, equipped: true },
      { id: 'gym_bench_press', quantity: 4 },
    ],
  },
};

/**
 * Third floor town with both crawlers already carrying the full source-material
 * gear set, so every new piece — plus the slingshot — can be equipped, compared
 * in the Equipment tab, and tooltip-checked in one boot without farming drops.
 */
const GEAR: PlaytestPreset = {
  id: 'gear',
  description: 'Third floor town, both crawlers kitted in the new source-material gear',
  levelId: 'level3',
  spawn: { kind: 'mapStart' },
  abilityLevels: { smush: 7, magic_missile: 6, protective_shell: 3 },
  human: {
    level: 28,
    xpProgress: 0.5,
    coins: 2327,
    baseStats: { strength: 12, constitution: 16, dexterity: 6 },
    explosivesHandling: 3,
    skillLevels: { pugilism: 5 },
    hotbar: [
      { id: 'smush_tome', quantity: 1 },
      { id: 'slingshot', quantity: 1 },
      { id: 'health_potion', quantity: 38 },
      { id: 'enchanted_bigboi_boxers', quantity: 1, equipped: true },
      { id: 'goblin_dynamite', quantity: 18 },
    ],
    bag: [
      { id: 'nightgaunt_cloak', quantity: 1, equipped: true },
      { id: 'splatter_skunk_toe_ring', quantity: 1, equipped: true },
      { id: 'shade_gnoll_kneepads', quantity: 1, equipped: true },
      { id: 'grull_war_gauntlet', quantity: 1, equipped: true },
      { id: 'trollskin_shirt', quantity: 1 },
      { id: 'scroll_of_confusing_fog', quantity: 5 },
    ],
  },
  cat: {
    level: 28,
    xpProgress: 0.5,
    coins: 2327,
    baseStats: { strength: 5, intelligence: 28, constitution: 2, dexterity: 34 },
    skillLevels: { cockroach: 1, iron_stomach: 1, night_vision: 1 },
    hotbar: [
      { id: 'magic_missile_tome', quantity: 1 },
      { id: 'health_potion', quantity: 34 },
      { id: 'scroll_of_confusing_fog', quantity: 8 },
    ],
    bag: [
      { id: 'slate_butterfly_talisman', quantity: 1, equipped: true },
      { id: 'fae_scale_crupper', quantity: 1, equipped: true },
      { id: 'bracelet_of_dex', quantity: 1, equipped: true },
      { id: 'enchanted_crown_sepsis_whore', quantity: 1 },
      { id: 'goblin_dynamite', quantity: 7 },
    ],
  },
};

/**
 * The Anchor questline with all three shards already collected, so the assembly
 * at Madame Voss can be played without walking the errand first.
 *
 * The shards are split across the two crawlers on purpose: the party carries two
 * inventories, and every shard check has to sum both. A preset that stacked all
 * three on the human would let a one-bag bug through.
 */
const ANCHOR_SHARDS: PlaytestPreset = {
  ...LEVEL3,
  id: 'anchor-shards',
  description: 'Third floor town, all three Anchor shards in hand (split across both crawlers)',
  human: {
    ...LEVEL3.human,
    bag: [
      ...LEVEL3.human.bag,
      { id: 'anchor_shard_tinker', quantity: 1 },
      { id: 'anchor_shard_hilda', quantity: 1 },
    ],
  },
  cat: {
    ...LEVEL3.cat,
    bag: [...LEVEL3.cat.bag, { id: 'anchor_shard_temple', quantity: 1 }],
  },
};

/**
 * The far side of the questline: the stone assembled and on both hotbars, which
 * is where it lands on assembly. For testing the recall itself, not the errand.
 *
 * The human's row is written out rather than appended to `LEVEL3`'s: these
 * entries fill hotbar slots from zero, and a eighth one would land in the
 * reserved quest slot, where the next quest item picked up would overwrite it.
 */
const ANCHOR_STONE: PlaytestPreset = {
  ...LEVEL3,
  id: 'anchor-stone',
  description: "Third floor town, Wayfinder's Anchor already assembled on both hotbars",
  human: {
    ...LEVEL3.human,
    hotbar: [
      { id: 'smush_tome', quantity: 1 },
      { id: 'slingshot', quantity: 1 },
      { id: 'health_potion', quantity: 38 },
      { id: 'enchanted_bigboi_boxers', quantity: 1, equipped: true },
      { id: 'goblin_dynamite', quantity: 18 },
      { id: 'gym_bench_press', quantity: 2 },
      { id: 'wayfinders_anchor', quantity: 1 },
    ],
  },
  cat: {
    ...LEVEL3.cat,
    hotbar: [...LEVEL3.cat.hotbar, { id: 'wayfinders_anchor', quantity: 1 }],
  },
};

/**
 * Each crawler's coins pared down to exactly one Stat Boost's price. What
 * actually stops a second purchase is the club market's shared stock, not
 * either wallet — the sold-out row shows up after one sale no matter which
 * crawler is holding the controls — so this only keeps a fat purse from
 * masking the point of the preset: a run where the row is worth watching go
 * from "1000 coins" to sold out, not a shopping trip that happens to include it.
 *
 * Kept a literal rather than importing the club's own price constant: this
 * file's imports stay type-only (see the module doc comment) so the id
 * validator can run under Node without pulling in browser rendering code.
 */
const CLUB_STAT_BOOST_PRICE = 1000;

/**
 * The town with just enough gold for the club market's one-per-run Stat
 * Boost, so buying it out and watching the row go sold out doesn't first
 * require a supply run.
 */
const CLUB_STAT_BOOST: PlaytestPreset = {
  ...LEVEL3,
  id: 'club-stat-boost',
  description: 'Third floor town, coins for exactly one Stat Boost at the Desperado Club market',
  human: { ...LEVEL3.human, coins: CLUB_STAT_BOOST_PRICE },
  cat: { ...LEVEL3.cat, coins: CLUB_STAT_BOOST_PRICE },
};

/**
 * The nursery, on floor 1, where the defense quest now sits.
 *
 * Its own preset rather than a note to walk there from the `juicer` one: the
 * nursery is a room every crawler walks through between the two bosses, and its
 * whole shape — the grates, the wave the goblin mother offers, the boards that
 * go up only for a party that takes it — is visible only from inside the room.
 * Finding it from the gateway safe room is several minutes of walking every
 * time. The loadout is the `juicer` party, which is who meets it.
 */
const NURSERY: PlaytestPreset = {
  ...JUICER,
  id: 'nursery',
  description: 'Inside the goblin mother’s nursery, between the Hoarder and the Juicer',
  spawn: { kind: 'questRoomEntrance' },
};

/**
 * Floor 2, past the Krakaren, hard difficulty: the fairy encounter band the
 * fairness doc gates against. Reuses the `krakaren` party rather than a fresh
 * one — that gear and level is what a crawler actually has by this point in
 * the floor, and the fairies are meant to be fought with it, not a party
 * built to make them trivial.
 *
 * The Krakaren's own safe room only ever guards the room before it, so
 * "past" it is expressed by the safe room the swine gauntlet keeps at its own
 * gate — the nearest landmark inside the post-Krakaren region — with the
 * Krakaren itself skipped and marked won so its room reads the same as it
 * would to a crawler who actually beat it.
 */
const FAIRIES: PlaytestPreset = {
  ...KRAKAREN,
  id: 'fairies',
  description: 'Floor 2, past the Krakaren, hard difficulty — the fairy encounter band',
  spawn: { kind: 'safeRoomBefore', bossType: 'ball_of_swine' },
  difficulty: 'hard',
  preDefeatedBossTypes: ['krakaren_clone'],
};

/**
 * The countdown after the Lich, with the soul crystal not yet contained: the
 * escape stairwell by the tower door is showing and sealed, and the crystal
 * waits on the tower's top floor. Starts in the town square.
 */
const DOOMSDAY_CONTAINMENT: PlaytestPreset = {
  ...LEVEL3,
  id: 'doomsday-containment',
  description: 'Third floor town, post-Lich countdown running, soul crystal not yet contained',
  doomsdayStage: 'containment',
};

/**
 * The town with both companions already out — Sledge under contract and Mongo
 * at the cat's side — for walking them through shop doors, up the tower's
 * storeys and back out again.
 */
const COMPANIONS_INDOORS: PlaytestPreset = {
  ...LEVEL3,
  id: 'companions-indoors',
  description: 'Third floor town, a hire under contract and Mongo out, for taking both indoors',
  abilityLevels: { ...LEVEL3.abilityLevels, mongo: 5 },
  hire: 'sledge',
  mongoOut: true,
};

/**
 * A hire under contract on the circus grounds, Heather already dead, so the
 * next word with Signet starts the sideshow assault — for following the hire
 * through the assault waves, into the Big Top's maze and back out.
 */
const CIRCUS_HIRE: PlaytestPreset = {
  ...LEVEL3,
  id: 'circus-hire',
  description: 'Circus grounds with a hire under contract, one word with Signet from the assault',
  hire: 'sledge',
  circusQuest: { stage: 'heather_hunt', heatherSlain: true },
};

export const PLAYTEST_PRESETS: readonly PlaytestPreset[] = [
  HOARDER,
  JUICER,
  NURSERY,
  LEVEL2,
  KRAKAREN,
  SWINE,
  SPIDER,
  LEVEL3,
  GEAR,
  ANCHOR_SHARDS,
  ANCHOR_STONE,
  CLUB_STAT_BOOST,
  FAIRIES,
  DOOMSDAY_CONTAINMENT,
  COMPANIONS_INDOORS,
  CIRCUS_HIRE,
];

export function getPlaytestPreset(id: string): PlaytestPreset | null {
  return PLAYTEST_PRESETS.find((preset) => preset.id === id) ?? null;
}
