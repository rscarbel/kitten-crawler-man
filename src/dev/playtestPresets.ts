import type { ItemId } from '../core/ItemDefs';
import type { StatName } from '../Player';
import type { SkillId } from '../core/SkillManager';
import type { AbilityId } from '../core/AbilityManager';
import type { MobSpawnRule } from '../levels/types';

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
  | { readonly kind: 'spiderLabEntrance' };

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
  /** XP already banked toward the next level, not a lifetime total. */
  readonly xp: number;
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
  /** Ability levels, shared by both crawlers through one AbilityManager. */
  readonly abilityLevels: Partial<Record<AbilityId, number>>;
  readonly human: PlaytestLoadout;
  readonly cat: PlaytestLoadout;
}

const HOARDER: PlaytestPreset = {
  id: 'hoarder',
  description: 'Safe room just before the Hoarder',
  levelId: 'level1',
  spawn: { kind: 'safeRoomBefore', bossType: 'the_hoarder' },
  abilityLevels: { smush: 3, magic_missile: 3, protective_shell: 3 },
  human: {
    level: 4,
    xp: 32,
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
    xp: 32,
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
    xp: 55,
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
    xp: 55,
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
    xp: 70,
    coins: 1173,
    baseStats: { strength: 8, constitution: 10, dexterity: 2 },
    explosivesHandling: 1,
    skillLevels: { pugilism: 2 },
    hotbar: [
      { id: 'smush_tome', quantity: 1 },
      { id: 'health_potion', quantity: 22 },
      { id: 'enchanted_bigboi_boxers', quantity: 1, equipped: true },
      { id: 'goblin_dynamite', quantity: 10 },
    ],
    bag: [
      { id: 'scroll_of_confusing_fog', quantity: 4 },
      { id: 'trollskin_shirt', quantity: 1, equipped: true },
      { id: 'gym_bench_press', quantity: 2 },
      { id: 'gym_treadmill', quantity: 2 },
      { id: 'jugg_juice', quantity: 1 },
      { id: 'speed_fizz', quantity: 1 },
    ],
  },
  cat: {
    level: 13,
    xp: 70,
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
    xp: 100,
    coins: 1488,
    baseStats: { strength: 12, constitution: 11, dexterity: 2 },
    explosivesHandling: 1,
    skillLevels: { pugilism: 2 },
    hotbar: [
      { id: 'smush_tome', quantity: 1 },
      { id: 'health_potion', quantity: 31 },
      { id: 'enchanted_bigboi_boxers', quantity: 1, equipped: true },
      { id: 'goblin_dynamite', quantity: 10 },
      { id: 'gym_bench_press', quantity: 2 },
      { id: 'gym_treadmill', quantity: 2 },
    ],
    bag: [
      { id: 'scroll_of_confusing_fog', quantity: 5 },
      { id: 'trollskin_shirt', quantity: 1, equipped: true },
      { id: 'jugg_juice', quantity: 1 },
      { id: 'speed_fizz', quantity: 1 },
    ],
  },
  cat: {
    level: 15,
    xp: 100,
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
    xp: 100,
    coins: 1903,
    baseStats: { strength: 12, constitution: 14, dexterity: 2 },
    explosivesHandling: 1,
    skillLevels: { pugilism: 4 },
    hotbar: [
      { id: 'smush_tome', quantity: 1 },
      { id: 'health_potion', quantity: 34 },
      { id: 'enchanted_bigboi_boxers', quantity: 1, equipped: true },
      { id: 'goblin_dynamite', quantity: 14 },
      { id: 'gym_bench_press', quantity: 2 },
      { id: 'gym_treadmill', quantity: 2 },
    ],
    bag: [
      { id: 'scroll_of_confusing_fog', quantity: 5 },
      { id: 'trollskin_shirt', quantity: 1, equipped: true },
      { id: 'jugg_juice', quantity: 1 },
      { id: 'speed_fizz', quantity: 1 },
    ],
  },
  cat: {
    level: 20,
    xp: 100,
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
    xp: 120,
    coins: 2327,
    baseStats: { strength: 12, constitution: 16, dexterity: 6 },
    explosivesHandling: 3,
    skillLevels: { pugilism: 5 },
    hotbar: [
      { id: 'smush_tome', quantity: 1 },
      { id: 'health_potion', quantity: 38 },
      { id: 'enchanted_bigboi_boxers', quantity: 1, equipped: true },
      { id: 'goblin_dynamite', quantity: 18 },
      { id: 'gym_bench_press', quantity: 2 },
      { id: 'gym_treadmill', quantity: 2 },
    ],
    bag: [
      { id: 'scroll_of_confusing_fog', quantity: 5 },
      { id: 'trollskin_shirt', quantity: 1, equipped: true },
      { id: 'jugg_juice', quantity: 1 },
      { id: 'speed_fizz', quantity: 1 },
    ],
  },
  cat: {
    level: 28,
    xp: 120,
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
      { id: 'gym_bench_press', quantity: 1 },
    ],
  },
};

export const PLAYTEST_PRESETS: readonly PlaytestPreset[] = [
  HOARDER,
  JUICER,
  LEVEL2,
  KRAKAREN,
  SPIDER,
  LEVEL3,
];

export function getPlaytestPreset(id: string): PlaytestPreset | null {
  return PLAYTEST_PRESETS.find((preset) => preset.id === id) ?? null;
}
