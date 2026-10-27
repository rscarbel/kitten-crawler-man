import type { ItemId } from '../core/items/defs/ItemDefs';
import type { StatName } from '../Player';
import type { SkillId } from '../core/skills/SkillManager';
import type { AbilityId } from '../core/skills/AbilityManager';
import type { MobKind } from '../levels/mobKinds';
import type { Difficulty } from '../core/difficulty/difficultyProfiles';
import type { DoomsdayStage } from '../core/quests/DoomsdayProgress';
import type { MercenaryTemplateId } from '../core/party/mercenaryTemplates';
import type { PartyToolsState } from '../core/items/gathering/PartyTools';
import type { PalisadeTier } from '../map/tileTypes';
import type { BlueprintsQuestPhase } from '../core/quests/blueprintsQuestPhase';
import type { VillageBuildingId } from '../map/overworld/briarHollowLayout';
import { CLOAK_AND_DAGGER_NAME, type TownBuildingName } from '../map/town/townPlan';
import { TOOL_TIER_BASIC, TOOL_TIER_LONG_HAFT } from '../core/items/gathering/toolTiers';
import { buyPrice } from '../economy/pricing';
import { createShopStock } from '../economy/shopStock';

/**
 * Named starting points for playtesting, each one a floor plus the party that
 * should arrive on it. `npm run playtest -- <id>` opens the game straight into
 * one; nothing here is reachable from a shipped build.
 *
 * Its value imports are kept to pure data and pricing modules so the npm
 * script can import this table under Node to validate an id; most of the
 * rest of the tree eventually reaches browser-only rendering code.
 */

/** Where a preset drops the party, resolved once the floor's map exists. */
export type PlaytestSpawn =
  /** The floor's own entry point — map centre on a dungeon, the plaza in town. */
  | { readonly kind: 'mapStart' }
  /** The gateway safe room whose only onward exit is this boss's room. */
  | { readonly kind: 'safeRoomBefore'; readonly bossType: MobKind }
  /** The middle of the spider lab's field station, between its two hallways. */
  | { readonly kind: 'spiderLabStation' }
  /** In the room the spider lab's hallway leaves from, a few tiles short of its mouth. */
  | { readonly kind: 'spiderHallwayHost' }
  /** The tile just inside the goblin mother's nursery, by the way in. */
  | { readonly kind: 'questRoomEntrance' }
  /** A few tiles short of the floor's first stairwell, in the room that holds it. */
  | { readonly kind: 'stairwellApproach' }
  /** The tile just inside the first clogged bathroom, by the way in. */
  | { readonly kind: 'bathroomEntrance' }
  /** Floor 2's stealth gate room, in front of the gate guard, gate still locked. */
  | { readonly kind: 'stealthGateRoom' }
  /** Just inside Briar Hollow's gate, on the main street. */
  | { readonly kind: 'briarHollowGate' }
  /** The street tile just south of a town building's door. */
  | { readonly kind: 'townBuildingDoor'; readonly buildingName: TownBuildingName }
  /** On the threshold of a Briar Hollow building. */
  | { readonly kind: 'briarHollowBuilding'; readonly buildingId: VillageBuildingId };

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
  /** This crawler's own Resourcing level, taught and set. Omitted leaves it unlearned. */
  readonly resourcingLevel?: number;
  /** This crawler's own Construction level, taught and set. Omitted leaves it unlearned. */
  readonly constructionLevel?: number;
  /** Hotbar contents from slot 0 up. */
  readonly hotbar: readonly PlaytestStack[];
  /** Bag contents from slot 0 up. */
  readonly bag: readonly PlaytestStack[];
  /** The reserved quest slot's item, placed directly as a quest grant would. */
  readonly questSlot?: PlaytestStack;
}

/**
 * "The Borrowed Blueprints" already at a step, for the side quest's presets:
 * "Briar Hollow's Plea" is complete (so the offer stands and nothing of the
 * Plea's competes for Fenna or Merrit), every construction plan is held, and
 * the side quest's own record is set to these values.
 */
export interface PlaytestBlueprintsSetup {
  readonly phase: BlueprintsQuestPhase;
  /** Whether Merrit's pasture fence stands rebuilt all round, or not a section of it. */
  readonly fence: 'unbuilt' | 'built';
  readonly grain: number;
}

/**
 * Wendell's construction contracts open: "The Borrowed Blueprints" finished
 * outright (the Plea won, every plan held, both stations upgraded), and,
 * when `lastSpotAt` names a building, a contract already issued there with
 * every spot but its last one done and Wendell's introduction already given.
 */
export interface PlaytestContractsSetup {
  readonly lastSpotAt?: VillageBuildingId;
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
  readonly preDefeatedBossTypes?: readonly MobKind[];
  /**
   * Drops the party into the doomsday finale at this stage, with a full
   * countdown and the Krasue Murders closed behind it at the Lich's death.
   */
  readonly doomsdayStage?: Extract<DoomsdayStage, 'containment' | 'escape'>;
  /** Pest Control already taken up, Dr. Moult at his lab post waiting for the hack. */
  readonly spiderQuestAwaitingHacking?: boolean;
  /** A Barracks hire already under contract for this floor, standing beside the party. */
  readonly hire?: MercenaryTemplateId;
  /** Mongo already out beside the cat on the first frame, rather than waiting on a summon. */
  readonly mongoOut?: boolean;
  /** The party put down on the circus grounds instead of at `spawn`. */
  readonly spawnAtCircus?: boolean;
  /**
   * The party's axe and pickaxe tiers. The tool items in the loadouts are only
   * what the bags hold; this is what says the party owns them, and the scene
   * reconciles the bags to it on entry.
   */
  readonly toolTiers?: PartyToolsState;
  /**
   * Briar Hollow ready for its siege: "Briar Hollow's Plea" already at
   * fortifying, the whole palisade at `wallTier`, and `trebuchets` loaded
   * engines inside it. `?walls=` and `?trebuchets=` on the URL override both
   * (`npm run playtest -- <id> --walls=fortified --trebuchets=4`).
   */
  readonly briarHollowDefences?: {
    readonly wallTier: PalisadeTier;
    readonly trebuchets: number;
  };
  /**
   * Grants every questline unlock (the machines, the militia's orders, every
   * construction plan) without walking the Mayor's, Fenna's and Tikka's own
   * scenes — for a preset built to test building or the militia directly,
   * where the level and stockpile already stand in for having done the quest.
   */
  readonly briarHollowUnlockAll?: boolean;
  /** Fenna's side quest already at a step; see {@link PlaytestBlueprintsSetup}. */
  readonly briarHollowBlueprints?: PlaytestBlueprintsSetup;
  /** Construction contracts unlocked, and optionally one nearly finished; see {@link PlaytestContractsSetup}. */
  readonly constructionContracts?: PlaytestContractsSetup;
}

const TRASH_GREMLIN: PlaytestPreset = {
  id: 'trash_gremlin',
  description: 'Safe room just before the Trash Gremlin',
  levelId: 'level1',
  spawn: { kind: 'safeRoomBefore', bossType: 'trash_gremlin' },
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
      { id: 'goblin_dynamite', quantity: 2 },
      { id: 'lucky_hoodie', quantity: 1, equipped: true },
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

const BIG_ROOSTER: PlaytestPreset = {
  id: 'big_rooster',
  description: 'Safe room just before Big Rooster',
  levelId: 'level1',
  spawn: { kind: 'safeRoomBefore', bossType: 'big_rooster' },
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
      { id: 'goblin_dynamite', quantity: 6 },
      { id: 'lucky_hoodie', quantity: 1, equipped: true },
    ],
    bag: [
      { id: 'scroll_of_confusing_fog', quantity: 3 },
      { id: 'scrapmail_vest', quantity: 1, equipped: true },
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
      { id: 'health_potion', quantity: 22 },
      { id: 'goblin_dynamite', quantity: 10 },
      { id: 'lucky_hoodie', quantity: 1, equipped: true },
      { id: 'rattlestick_sling', quantity: 1 },
    ],
    bag: [
      { id: 'scroll_of_confusing_fog', quantity: 4 },
      { id: 'scrapmail_vest', quantity: 1, equipped: true },
      { id: 'patched_duster', quantity: 1, equipped: true },
      { id: 'riot_kneeguards', quantity: 1, equipped: true },
      { id: 'iron_knuckle_gauntlet', quantity: 1, equipped: true },
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
      { id: 'cockscomb_crest', quantity: 1, equipped: true },
      { id: 'moonmoth_pendant', quantity: 1, equipped: true },
      { id: 'plumed_coat', quantity: 1, equipped: true },
      { id: 'nimble_bangle', quantity: 1, equipped: true },
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
      { id: 'health_potion', quantity: 31 },
      { id: 'goblin_dynamite', quantity: 24 },
      { id: 'lucky_hoodie', quantity: 1, equipped: true },
      { id: 'rattlestick_sling', quantity: 1 },
      { id: 'gym_bench_press', quantity: 2 },
      { id: 'gym_treadmill', quantity: 2 },
    ],
    bag: [
      { id: 'scroll_of_confusing_fog', quantity: 5 },
      { id: 'scrapmail_vest', quantity: 1, equipped: true },
      { id: 'patched_duster', quantity: 1, equipped: true },
      { id: 'riot_kneeguards', quantity: 1, equipped: true },
      { id: 'iron_knuckle_gauntlet', quantity: 1, equipped: true },
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
      { id: 'cockscomb_crest', quantity: 1, equipped: true },
      { id: 'moonmoth_pendant', quantity: 1, equipped: true },
      { id: 'plumed_coat', quantity: 1, equipped: true },
      { id: 'nimble_bangle', quantity: 1, equipped: true },
    ],
  },
};

const SPIDER: PlaytestPreset = {
  id: 'spider',
  description: "In the spider lab's station, Dr. Moult waiting at his terminal",
  levelId: 'level2',
  spawn: { kind: 'spiderLabStation' },
  spiderQuestAwaitingHacking: true,
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
      { id: 'goblin_dynamite', quantity: 14 },
      { id: 'health_potion', quantity: 34 },
      { id: 'lucky_hoodie', quantity: 1, equipped: true },
      { id: 'rattlestick_sling', quantity: 1 },
      { id: 'gym_bench_press', quantity: 2 },
      { id: 'gym_treadmill', quantity: 2 },
    ],
    bag: [
      { id: 'scroll_of_confusing_fog', quantity: 5 },
      { id: 'scrapmail_vest', quantity: 1, equipped: true },
      { id: 'patched_duster', quantity: 1, equipped: true },
      { id: 'riot_kneeguards', quantity: 1, equipped: true },
      { id: 'iron_knuckle_gauntlet', quantity: 1, equipped: true },
      { id: 'jugg_juice', quantity: 1 },
      { id: 'speed_fizz', quantity: 1 },
    ],
  },
  cat: {
    level: 20,
    xpProgress: 0.5,
    coins: 1903,
    baseStats: { strength: 5, intelligence: 21, constitution: 2, dexterity: 22 },
    skillLevels: { cockroach: 1, iron_stomach: 1 },
    hotbar: [
      { id: 'magic_missile_tome', quantity: 1 },
      { id: 'health_potion', quantity: 28 },
      { id: 'scroll_of_confusing_fog', quantity: 7 },
    ],
    bag: [
      { id: 'goblin_dynamite', quantity: 7 },
      { id: 'cockscomb_crest', quantity: 1, equipped: true },
      { id: 'moonmoth_pendant', quantity: 1, equipped: true },
      { id: 'plumed_coat', quantity: 1, equipped: true },
      { id: 'nimble_bangle', quantity: 1, equipped: true },
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
      { id: 'goblin_dynamite', quantity: 18 },
      { id: 'health_potion', quantity: 38 },
      { id: 'lucky_hoodie', quantity: 1, equipped: true },
      { id: 'rattlestick_sling', quantity: 1 },
      { id: 'gym_bench_press', quantity: 2 },
      { id: 'gym_treadmill', quantity: 2 },
    ],
    bag: [
      { id: 'scroll_of_confusing_fog', quantity: 5 },
      { id: 'scrapmail_vest', quantity: 1, equipped: true },
      { id: 'patched_duster', quantity: 1, equipped: true },
      { id: 'riot_kneeguards', quantity: 1, equipped: true },
      { id: 'iron_knuckle_gauntlet', quantity: 1, equipped: true },
      { id: 'jugg_juice', quantity: 1 },
      { id: 'speed_fizz', quantity: 1 },
    ],
  },
  cat: {
    level: 28,
    xpProgress: 0.5,
    coins: 2327,
    baseStats: { strength: 5, intelligence: 28, constitution: 2, dexterity: 34 },
    skillLevels: { cockroach: 1, iron_stomach: 1 },
    hotbar: [
      { id: 'magic_missile_tome', quantity: 1 },
      { id: 'health_potion', quantity: 34 },
      { id: 'scroll_of_confusing_fog', quantity: 8 },
    ],
    bag: [
      { id: 'goblin_dynamite', quantity: 7 },
      { id: 'cockscomb_crest', quantity: 1, equipped: true },
      { id: 'moonmoth_pendant', quantity: 1, equipped: true },
      { id: 'plumed_coat', quantity: 1, equipped: true },
      { id: 'nimble_bangle', quantity: 1, equipped: true },
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
      { id: 'rattlestick_sling', quantity: 1 },
      { id: 'health_potion', quantity: 30 },
      { id: 'lucky_hoodie', quantity: 1, equipped: true },
      { id: 'gym_bench_press', quantity: 4 },
    ],
    bag: [
      { id: 'scrapmail_vest', quantity: 1, equipped: true },
      { id: 'patched_duster', quantity: 1, equipped: true },
      { id: 'riot_kneeguards', quantity: 1, equipped: true },
      { id: 'iron_knuckle_gauntlet', quantity: 1, equipped: true },
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
      { id: 'cockscomb_crest', quantity: 1, equipped: true },
      { id: 'moonmoth_pendant', quantity: 1, equipped: true },
      { id: 'plumed_coat', quantity: 1, equipped: true },
      { id: 'nimble_bangle', quantity: 1, equipped: true },
      { id: 'gym_bench_press', quantity: 4 },
    ],
  },
};

/**
 * Third floor town with both crawlers already carrying the full enchanted
 * gear set, so every new piece — plus the slingshot — can be equipped, compared
 * in the Equipment tab, and tooltip-checked in one boot without farming drops.
 */
const GEAR: PlaytestPreset = {
  id: 'gear',
  description: 'Third floor town, both crawlers kitted in the enchanted gear',
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
      { id: 'health_potion', quantity: 38 },
      { id: 'goblin_dynamite', quantity: 18 },
      { id: 'lucky_hoodie', quantity: 1, equipped: true },
      { id: 'rattlestick_sling', quantity: 1 },
    ],
    bag: [
      { id: 'patched_duster', quantity: 1, equipped: true },
      { id: 'riot_kneeguards', quantity: 1, equipped: true },
      { id: 'iron_knuckle_gauntlet', quantity: 1, equipped: true },
      { id: 'scrapmail_vest', quantity: 1 },
      { id: 'scroll_of_confusing_fog', quantity: 5 },
    ],
  },
  cat: {
    level: 28,
    xpProgress: 0.5,
    coins: 2327,
    baseStats: { strength: 5, intelligence: 28, constitution: 2, dexterity: 34 },
    skillLevels: { cockroach: 1, iron_stomach: 1 },
    hotbar: [
      { id: 'magic_missile_tome', quantity: 1 },
      { id: 'health_potion', quantity: 34 },
      { id: 'scroll_of_confusing_fog', quantity: 8 },
    ],
    bag: [
      { id: 'moonmoth_pendant', quantity: 1, equipped: true },
      { id: 'plumed_coat', quantity: 1, equipped: true },
      { id: 'nimble_bangle', quantity: 1, equipped: true },
      { id: 'cockscomb_crest', quantity: 1 },
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
      { id: 'anchor_shard_lori', quantity: 1 },
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
      { id: 'health_potion', quantity: 38 },
      { id: 'goblin_dynamite', quantity: 18 },
      { id: 'lucky_hoodie', quantity: 1, equipped: true },
      { id: 'rattlestick_sling', quantity: 1 },
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
 * limits a second purchase is the club market's shared stock (normal stock 1,
 * restocking one unit every `RESTOCK_INTERVAL_SECONDS` of game time), not
 * either wallet — the row reads sold out after one sale no matter which
 * crawler is holding the controls — so this only keeps a fat purse from
 * masking the point of the preset: a run where the row is worth watching go
 * from its price to sold out, not a shopping trip that happens to include it.
 */
const CLUB_STAT_BOOST_PRICE = buyPrice('club_market', 'stat_boost_potion', createShopStock());

/**
 * The town with just enough gold for the club market's single-unit Stat
 * Boost, so buying it out and watching the row go sold out doesn't first
 * require a supply run.
 */
const CLUB_STAT_BOOST: PlaytestPreset = {
  ...LEVEL3,
  id: 'club-stat-boost',
  description: 'Third floor town, coins for exactly one Stat Boost at the Cloak & Dagger market',
  human: { ...LEVEL3.human, coins: CLUB_STAT_BOOST_PRICE },
  cat: { ...LEVEL3.cat, coins: CLUB_STAT_BOOST_PRICE },
};

/**
 * The nursery, on floor 1, where the defense quest now sits.
 *
 * Its own preset rather than a note to walk there from the `big_rooster` one: the
 * nursery is a room every crawler walks through between the two bosses, and its
 * whole shape — the grates, the wave the goblin mother offers, the boards that
 * go up only for a party that takes it — is visible only from inside the room.
 * Finding it from the gateway safe room is several minutes of walking every
 * time. The loadout is the `big_rooster` party, which is who meets it.
 */
const NURSERY: PlaytestPreset = {
  ...BIG_ROOSTER,
  id: 'nursery',
  description: 'Inside the goblin mother’s nursery, between the Trash Gremlin and Big Rooster',
  spawn: { kind: 'questRoomEntrance' },
};

/**
 * Inside the first clogged bathroom on floor 2, by its way in, with the
 * floor's opening party. The bathrooms sit halfway along the pre-Krakaren
 * branches, a few rooms' walk from the start, and the queue, the plumber and
 * the pipe wall are only visible from inside.
 */
const BATHROOM: PlaytestPreset = {
  ...LEVEL2,
  id: 'bathroom',
  description: 'Inside the clogged bathroom halfway to the Krakaren Clone, plumbing still broken',
  spawn: { kind: 'bathroomEntrance' },
};

/**
 * Floor 2's stealth gate room, standing in front of the gate guard with the
 * gate locked and the prison door in the north wall. The room sits halfway
 * between the Krakaren and the swine gauntlet, so the party is the `krakaren`
 * one with the Krakaren skipped and marked won.
 */
const PRISON: PlaytestPreset = {
  ...KRAKAREN,
  id: 'prison',
  description: 'Stealth gate room past the Krakaren, in front of the gate guard, gate locked',
  spawn: { kind: 'stealthGateRoom' },
  preDefeatedBossTypes: ['krakaren_clone'],
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
 * The town with both companions already out — Crush under contract and Mongo
 * at the cat's side — for walking them through shop doors, up the tower's
 * storeys and back out again.
 */
const COMPANIONS_INDOORS: PlaytestPreset = {
  ...LEVEL3,
  id: 'companions-indoors',
  description: 'Third floor town, a hire under contract and Mongo out, for taking both indoors',
  abilityLevels: { ...LEVEL3.abilityLevels, mongo: 5 },
  hire: 'crush',
  mongoOut: true,
};

/** How many of each raw/refined resource the Briar Hollow preset starts with. */
const BRIAR_HOLLOW_STARTING_RESOURCE_QTY = 50;
/** How many hamburgers the Briar Hollow preset starts with. */
const BRIAR_HOLLOW_STARTING_HAMBURGERS = 5;

/**
 * Third floor town with the starter tools already in hand and a resource
 * stockpile, for jumping straight into gathering, processing and building
 * without a run to the forge and the lumber yard first.
 */
const BRIAR_HOLLOW_KIT: PlaytestPreset = {
  ...LEVEL3,
  id: 'briar-hollow-kit',
  description: 'Third floor town, starter tools and a Briar Hollow resource stockpile',
  toolTiers: { axeTier: TOOL_TIER_BASIC, pickaxeTier: TOOL_TIER_BASIC },
  human: {
    ...LEVEL3.human,
    resourcingLevel: 1,
    bag: [
      ...LEVEL3.human.bag,
      { id: 'basic_axe', quantity: 1 },
      { id: 'basic_pickaxe', quantity: 1 },
      { id: 'wood', quantity: BRIAR_HOLLOW_STARTING_RESOURCE_QTY },
      { id: 'stone', quantity: BRIAR_HOLLOW_STARTING_RESOURCE_QTY },
      { id: 'wood_board', quantity: BRIAR_HOLLOW_STARTING_RESOURCE_QTY },
      { id: 'rope', quantity: BRIAR_HOLLOW_STARTING_RESOURCE_QTY },
      { id: 'hamburger', quantity: BRIAR_HOLLOW_STARTING_HAMBURGERS },
    ],
  },
  cat: {
    ...LEVEL3.cat,
    resourcingLevel: 1,
    bag: [
      ...LEVEL3.cat.bag,
      { id: 'basic_axe', quantity: 1 },
      { id: 'basic_pickaxe', quantity: 1 },
    ],
  },
};

/** The Briar Hollow kit, arriving inside the village's gate rather than in town. */
const BRIAR_HOLLOW_VILLAGE: PlaytestPreset = {
  ...BRIAR_HOLLOW_KIT,
  id: 'briar-hollow-village',
  description: 'Briar Hollow, just inside the gate, with starter tools and a stockpile',
  spawn: { kind: 'briarHollowGate' },
};

/** The human's Construction in the builders preset: the level spikes unlock at. */
const BUILDERS_PRESET_HUMAN_CONSTRUCTION = 5;
/** The cat's: the top level, where her walls double and her trebuchets never run dry. */
const BUILDERS_PRESET_CAT_CONSTRUCTION = 15;

/**
 * Briar Hollow's gate with both crawlers taught Construction at very
 * different levels, a stockpile to spend, and a kit of each trap — for
 * building, upgrading, spiking and loading, and for watching the two
 * crawlers' own costs, times and perks side by side.
 */
const BRIAR_HOLLOW_BUILDERS: PlaytestPreset = {
  ...BRIAR_HOLLOW_VILLAGE,
  id: 'briar-hollow-builders',
  description:
    'Briar Hollow gate, the human at Construction 5 and the cat at 15, with materials and kits',
  briarHollowUnlockAll: true,
  human: {
    ...BRIAR_HOLLOW_VILLAGE.human,
    constructionLevel: BUILDERS_PRESET_HUMAN_CONSTRUCTION,
    bag: [
      ...BRIAR_HOLLOW_VILLAGE.human.bag,
      { id: 'trebuchet_kit', quantity: 1 },
      { id: 'snare_kit', quantity: 1 },
    ],
  },
  cat: { ...BRIAR_HOLLOW_VILLAGE.cat, constructionLevel: BUILDERS_PRESET_CAT_CONSTRUCTION },
};

/** Both crawlers' Construction in the siege preset: the top, for every level-15 extra. */
const SIEGE_PRESET_CONSTRUCTION = 15;

/**
 * Briar Hollow's gate with both crawlers at Construction 15, a stockpile and a
 * kit of each trap — for watching infernal boulders, bottomless ammunition and
 * snares that turn what they catch. The `spawn` cheat brings the hostiles.
 */
const BRIAR_HOLLOW_SIEGE: PlaytestPreset = {
  ...BRIAR_HOLLOW_VILLAGE,
  id: 'briar-hollow-siege',
  description: 'Briar Hollow gate, both crawlers at Construction 15, materials and trap kits',
  briarHollowUnlockAll: true,
  human: {
    ...BRIAR_HOLLOW_VILLAGE.human,
    constructionLevel: SIEGE_PRESET_CONSTRUCTION,
    bag: [
      ...BRIAR_HOLLOW_VILLAGE.human.bag,
      { id: 'trebuchet_kit', quantity: 1 },
      { id: 'snare_kit', quantity: 1 },
    ],
  },
  cat: { ...BRIAR_HOLLOW_VILLAGE.cat, constructionLevel: SIEGE_PRESET_CONSTRUCTION },
};

/** The assault preset's stockpile: enough to rebuild the ring more than once over. */
const ASSAULT_PRESET_WOOD = 400;
const ASSAULT_PRESET_STONE = 400;
const ASSAULT_PRESET_BOARDS = 200;
const ASSAULT_PRESET_ROPE = 200;
const ASSAULT_PRESET_DYNAMITE = 100;
const ASSAULT_PRESET_SPEED_FIZZES = 25;
/** Both crawlers' Construction in the assault preset: past spikes, short of the level-15 doubling. */
const ASSAULT_PRESET_CONSTRUCTION = 5;
/** Two engines behind each wall. */
const ASSAULT_PRESET_TREBUCHETS = 8;

/**
 * `stacks` with each id in `quantities` holding that quantity instead. Only
 * restocks: an id the stacks do not already hold is not added.
 */
function withQuantities(
  stacks: readonly PlaytestStack[],
  quantities: Partial<Record<ItemId, number>>,
): PlaytestStack[] {
  return stacks.map((stack) => ({ ...stack, quantity: quantities[stack.id] ?? stack.quantity }));
}

/**
 * Briar Hollow with the questline done up to the siege — the Mayor's asks
 * met, the bell ready to ring — the ring built to a tier (`--walls`, stone
 * unless told), eight loaded trebuchets, and the human carrying a stockpile and a
 * crate of dynamite for the fight. `&assaultNow` on the URL rings the bell on
 * arrival with a short countdown, so the first wave comes without a word
 * with the Mayor, and `&variety=<0-4>` (`--variety=` to the playtest script)
 * holds the look-variety tier for measuring the siege at each one.
 */
const BRIAR_HOLLOW_ASSAULT: PlaytestPreset = {
  ...BRIAR_HOLLOW_VILLAGE,
  id: 'briar-hollow-assault',
  description:
    'Briar Hollow ready for the siege: walls built (--walls=fence|wood|stone|fortified), trebuchets up, --variety=0-4',
  briarHollowDefences: { wallTier: 'stone', trebuchets: ASSAULT_PRESET_TREBUCHETS },
  human: {
    ...BRIAR_HOLLOW_VILLAGE.human,
    constructionLevel: ASSAULT_PRESET_CONSTRUCTION,
    hotbar: withQuantities(BRIAR_HOLLOW_VILLAGE.human.hotbar, {
      goblin_dynamite: ASSAULT_PRESET_DYNAMITE,
    }),
    bag: withQuantities(BRIAR_HOLLOW_VILLAGE.human.bag, {
      wood: ASSAULT_PRESET_WOOD,
      stone: ASSAULT_PRESET_STONE,
      wood_board: ASSAULT_PRESET_BOARDS,
      rope: ASSAULT_PRESET_ROPE,
      speed_fizz: ASSAULT_PRESET_SPEED_FIZZES,
    }),
  },
  cat: { ...BRIAR_HOLLOW_VILLAGE.cat, constructionLevel: ASSAULT_PRESET_CONSTRUCTION },
};

/** Both crawlers' Construction in the blueprints presets: learned, so the offer is open. */
const BLUEPRINTS_PRESET_CONSTRUCTION = 1;

/**
 * Briar Hollow with the Plea won, both crawlers taught Construction and the
 * kit's stockpile, and Fenna's offer of "The Borrowed Blueprints" standing.
 */
const BLUEPRINTS_OFFER: PlaytestPreset = {
  ...BRIAR_HOLLOW_VILLAGE,
  id: 'blueprints-offer',
  description: "Briar Hollow, the Plea won, Fenna's blueprints offer standing",
  human: { ...BRIAR_HOLLOW_VILLAGE.human, constructionLevel: BLUEPRINTS_PRESET_CONSTRUCTION },
  cat: { ...BRIAR_HOLLOW_VILLAGE.cat, constructionLevel: BLUEPRINTS_PRESET_CONSTRUCTION },
  briarHollowBlueprints: { phase: 'unoffered', fence: 'unbuilt', grain: 0 },
};

/** Merrit's fence to rebuild, no section done yet, with the boards for all of it. */
const BLUEPRINTS_FENCE: PlaytestPreset = {
  ...BLUEPRINTS_OFFER,
  id: 'blueprints-fence',
  description: "Borrowed Blueprints: rebuild Merrit's fence, boards in hand",
  briarHollowBlueprints: { phase: 'build_fence', fence: 'unbuilt', grain: 0 },
};

/** The fence done and the grain to harvest, with Merrit's scythe already in the human's hands. */
const BLUEPRINTS_HARVEST: PlaytestPreset = {
  ...BLUEPRINTS_OFFER,
  id: 'blueprints-harvest',
  description: "Borrowed Blueprints: harvest Merrit's grain, scythe in hand",
  human: { ...BLUEPRINTS_OFFER.human, questSlot: { id: 'quest_scythe', quantity: 1 } },
  briarHollowBlueprints: {
    phase: 'harvest_grain',
    fence: 'built',
    grain: 0,
  },
};

/** The grain in and Midge waiting at Merrit's gate to be led to Wendell's. */
const BLUEPRINTS_ESCORT: PlaytestPreset = {
  ...BLUEPRINTS_OFFER,
  id: 'blueprints-escort',
  description: "Borrowed Blueprints: lead Midge from Merrit's gate to Wendell's pasture",
  briarHollowBlueprints: {
    phase: 'escort_midge',
    fence: 'built',
    grain: 0,
  },
};

/** The blueprints just handed over, with Fenna waiting at the sawmill to set the upgrade job. */
const BLUEPRINTS_SHOW_FENNA: PlaytestPreset = {
  ...BLUEPRINTS_OFFER,
  id: 'blueprints-show-fenna',
  description: 'Borrowed Blueprints: show Fenna the blueprints, fresh from Wendell',
  human: { ...BLUEPRINTS_OFFER.human, questSlot: { id: 'quest_blueprints', quantity: 1 } },
  briarHollowBlueprints: {
    phase: 'show_fenna',
    fence: 'built',
    grain: 0,
  },
};

/** The blueprints in the human's hands and the materials for both upgrades. */
const BLUEPRINTS_STATIONS: PlaytestPreset = {
  ...BLUEPRINTS_OFFER,
  id: 'blueprints-stations',
  description: 'Borrowed Blueprints: upgrade the saw and the rope walk, blueprints in hand',
  human: { ...BLUEPRINTS_OFFER.human, questSlot: { id: 'quest_blueprints', quantity: 1 } },
  briarHollowBlueprints: {
    phase: 'build_stations',
    fence: 'built',
    grain: 0,
  },
};

/** The contracts presets' stockpile: comfortably more than any one contract's bill. */
const CONTRACTS_PRESET_BOARDS = 40;
const CONTRACTS_PRESET_ROPE = 10;
const CONTRACTS_PRESET_STONE = 50;

const CONTRACTS_PRESET_TREADMILLS = 2;
/**
 * The hotbar slot the HUD labels 7 (keys run 1 to 8 over indices 0 to 7). Not
 * the reserved quest slot, which is the eighth: the next quest item picked up
 * would overwrite the stone there.
 */
const CONTRACTS_ANCHOR_HOTBAR_IDX = 6;

/**
 * Outside Plumbline Farm with the Borrowed Blueprints finished, so Wendell
 * offers construction contracts, and the boards, rope and stone to work one.
 * The Plea is complete, so the Wayfinder's Anchor on the human's hotbar can carry
 * the party between the town and Briar Hollow.
 */
const CONTRACTS: PlaytestPreset = {
  ...BRIAR_HOLLOW_VILLAGE,
  id: 'contracts',
  description:
    "Outside Plumbline Farm, Borrowed Blueprints done, Wendell's contracts open, Anchor in hand",
  spawn: { kind: 'townBuildingDoor', buildingName: 'Plumbline Farm' },
  human: {
    ...BRIAR_HOLLOW_VILLAGE.human,
    constructionLevel: BLUEPRINTS_PRESET_CONSTRUCTION,
    hotbar: BRIAR_HOLLOW_VILLAGE.human.hotbar.map((stack, slotIdx) =>
      slotIdx === CONTRACTS_ANCHOR_HOTBAR_IDX ? { id: 'wayfinders_anchor', quantity: 1 } : stack,
    ),
    bag: [
      ...withQuantities(BRIAR_HOLLOW_VILLAGE.human.bag, {
        wood_board: CONTRACTS_PRESET_BOARDS,
        rope: CONTRACTS_PRESET_ROPE,
        stone: CONTRACTS_PRESET_STONE,
      }),
      { id: 'gym_treadmill', quantity: CONTRACTS_PRESET_TREADMILLS },
    ],
  },
  cat: { ...BRIAR_HOLLOW_VILLAGE.cat, constructionLevel: BLUEPRINTS_PRESET_CONSTRUCTION },
  constructionContracts: {},
};

/**
 * A contract at the Mayor's Hall with one spot left to work, the party on the
 * hall's threshold with the materials for it, and the mayor inside to pay out.
 */
const CONTRACTS_LAST_SPOT: PlaytestPreset = {
  ...CONTRACTS,
  id: 'contracts-last-spot',
  description: "Construction contract at the Mayor's Hall, every spot done but one",
  spawn: { kind: 'briarHollowBuilding', buildingId: 'hall' },
  constructionContracts: { lastSpotAt: 'hall' },
};

/** The human's Resourcing in the thralls preset: the level the summon unlocks at. */
const THRALL_PRESET_HUMAN_RESOURCING = 10;
/** The cat's: the top level, which summons three at once. */
const THRALL_PRESET_CAT_RESOURCING = 15;

/**
 * Third floor town with Lumberjack's tools, the human at Resourcing 10 and the cat at
 * 15 — for summoning one thrall and three, and for watching the two crawlers'
 * separate perks and cooldowns side by side.
 */
const RESOURCING_THRALLS: PlaytestPreset = {
  ...LEVEL3,
  id: 'resourcing-thralls',
  description: 'Third floor town, long-haft tools, the human at Resourcing 10 and the cat at 15',
  toolTiers: { axeTier: TOOL_TIER_LONG_HAFT, pickaxeTier: TOOL_TIER_LONG_HAFT },
  human: {
    ...LEVEL3.human,
    resourcingLevel: THRALL_PRESET_HUMAN_RESOURCING,
    bag: [
      ...LEVEL3.human.bag,
      { id: 'lumberjacks_axe', quantity: 1 },
      { id: 'quarrymans_pick', quantity: 1 },
    ],
  },
  cat: {
    ...LEVEL3.cat,
    resourcingLevel: THRALL_PRESET_CAT_RESOURCING,
    bag: [
      ...LEVEL3.cat.bag,
      { id: 'lumberjacks_axe', quantity: 1 },
      { id: 'quarrymans_pick', quantity: 1 },
    ],
  },
};

/**
 * The second floor's start with the Stormcaller in the hotbar beside the
 * slingshot, for trying its wave and chains on the floor's goblin packs.
 * Press its slot to draw it; press again, or the slingshot's, to put it away.
 */
const STORMCALLER: PlaytestPreset = {
  ...LEVEL2,
  id: 'stormcaller',
  description: 'Start of the second floor, the Stormcaller in the hotbar',
  human: {
    ...LEVEL2.human,
    hotbar: [...LEVEL2.human.hotbar, { id: 'stormcaller', quantity: 1 }],
  },
};

/** The host room short of the lab hallway's mouth, Dr. Moult still waiting there to be met. */
const SPIDER_HALLWAY: PlaytestPreset = {
  ...SPIDER,
  id: 'spider-hallway',
  description: "A few tiles short of the spider lab's hallway, Dr. Moult waiting at its mouth",
  spawn: { kind: 'spiderHallwayHost' },
  spiderQuestAwaitingHacking: false,
};

/** Floor 1 from its own start, with the `big_rooster` preset's party to survive what comes. */
const LEVEL1: PlaytestPreset = {
  ...BIG_ROOSTER,
  id: 'level1',
  description: "Start of the first floor, the big_rooster preset's party",
  spawn: { kind: 'mapStart' },
};

/** Floor 1 a few steps short of its stairwell, with the `big_rooster` preset's party, for watching a descent. */
const STAIRWELL: PlaytestPreset = {
  ...BIG_ROOSTER,
  id: 'stairwell',
  description: "A few tiles short of the first floor's stairwell, the big_rooster preset's party",
  spawn: { kind: 'stairwellApproach' },
};

/** The circus grounds and the floor-3 party to walk into the Starlight Tent's maze. */
const STARLIGHT_TENT: PlaytestPreset = {
  ...LEVEL3,
  id: 'starlight-tent',
  description: 'Circus grounds by the Starlight Tent, the floor-3 party',
  spawnAtCircus: true,
};

/** The street outside the Cloak & Dagger, whose casino floor is inside. */
const CASINO_FLOOR: PlaytestPreset = {
  ...LEVEL3,
  id: 'casino-floor',
  description: "Outside the Cloak & Dagger's door, the casino floor one step inside",
  spawn: { kind: 'townBuildingDoor', buildingName: CLOAK_AND_DAGGER_NAME },
};

export const PLAYTEST_PRESETS: readonly PlaytestPreset[] = [
  TRASH_GREMLIN,
  BIG_ROOSTER,
  NURSERY,
  LEVEL2,
  BATHROOM,
  KRAKAREN,
  PRISON,
  SWINE,
  SPIDER,
  SPIDER_HALLWAY,
  LEVEL3,
  GEAR,
  ANCHOR_SHARDS,
  ANCHOR_STONE,
  CLUB_STAT_BOOST,
  FAIRIES,
  DOOMSDAY_CONTAINMENT,
  COMPANIONS_INDOORS,
  BRIAR_HOLLOW_KIT,
  BRIAR_HOLLOW_VILLAGE,
  BRIAR_HOLLOW_BUILDERS,
  BRIAR_HOLLOW_SIEGE,
  BRIAR_HOLLOW_ASSAULT,
  BLUEPRINTS_OFFER,
  BLUEPRINTS_FENCE,
  BLUEPRINTS_HARVEST,
  BLUEPRINTS_ESCORT,
  BLUEPRINTS_SHOW_FENNA,
  BLUEPRINTS_STATIONS,
  CONTRACTS,
  CONTRACTS_LAST_SPOT,
  RESOURCING_THRALLS,
  STORMCALLER,
  LEVEL1,
  STAIRWELL,
  STARLIGHT_TENT,
  CASINO_FLOOR,
];

export function getPlaytestPreset(id: string): PlaytestPreset | null {
  return PLAYTEST_PRESETS.find((preset) => preset.id === id) ?? null;
}
