import { ASSET_GROUPS, type AssetGroup } from './assetGroups';
import type { SpriteKey } from './SpriteLoader';

/**
 * A `LevelDef` does not list everything that can appear on its floor.
 * `BountySystem`, `CircusQuestSystem`, `BigTopBossSystem`,
 * `QuillConfrontationSystem`, `MurderMysteryQuestSystem`, `SpiderQuestSystem`,
 * `SkeletonSummonSystem`, `MongoSystem` and `MercenarySystem` all construct
 * creatures no `LevelDef.roomMobs` / `hallwayMobs` / `extraSpawns` /
 * `campSpawns` entry ever names, because each is gated on a map feature
 * (`gameMap.circusCentre`, `gameMap.spiderLabRoom`, a live bounty site, a
 * hired mercenary) rather than on the level def itself. This file is where
 * each such system declares what it can spawn and where, so `verify:assets`
 * can check that coverage too.
 *
 * One entry per system, or per bounty/quest *type* where a system covers more
 * than one distinct encounter — keyed by system/bounty-type/quest-id.
 * `levelIds` is which floors the entry's creatures can actually appear on;
 * `mobTypes` are keys into
 * `MOB_SPRITE_KEYS` (`src/core/assetGroups.ts`) so `verify:assets` can confirm
 * `requiredGroups` actually covers what the system spawns, not just that the
 * author remembered to list *something*.
 */
export interface SystemAssetRequirement {
  /** Stable id: `<system>` or `<system>:<bounty-or-quest-id>`. */
  readonly id: string;
  /** Level ids (`LevelDef.id`) this system/encounter can introduce creatures on. */
  readonly levelIds: readonly string[];
  /** Mob-type keys into `MOB_SPRITE_KEYS` this system/encounter can construct. */
  readonly mobTypes: readonly string[];
  /** Asset groups declared as covering `mobTypes`' sprite needs. */
  readonly requiredGroups: readonly AssetGroup[];
}

const LEVEL3 = ['level3'];
const ALL_LEVELS = ['tutorial', 'level1', 'level2', 'level3'];

export const SYSTEM_ASSET_REQUIREMENTS: readonly SystemAssetRequirement[] = [
  // BountySystem — src/systems/bountyDefs.ts. One entry per BountyDef id.
  {
    id: 'bounty:evil_clown',
    levelIds: LEVEL3,
    mobTypes: ['evil_clown', 'stilt_clown', 'fat_clown', 'circus_lemur'],
    requiredGroups: ['bounty_evil_clown'],
  },
  {
    id: 'bounty:mantid',
    levelIds: LEVEL3,
    mobTypes: ['mantid', 'mantis'],
    requiredGroups: ['bounty_mantid'],
  },
  {
    id: 'bounty:skeleton_lord',
    levelIds: LEVEL3,
    mobTypes: ['skeleton_lord', 'skeleton_sword', 'skeleton_archer'],
    requiredGroups: ['bounty_skeleton_lord'],
  },
  {
    id: 'bounty:dark_knight',
    levelIds: LEVEL3,
    mobTypes: ['dark_knight', 'goblin'],
    requiredGroups: ['bounty_dark_knight'],
  },
  {
    id: 'bounty:rock_golem',
    levelIds: LEVEL3,
    mobTypes: ['rock_golem_boss', 'rock_golem'],
    requiredGroups: ['bounty_rock_golem'],
  },

  // SkeletonSummonSystem (src/systems/SkeletonSummonSystem.ts) only fires
  // while a live SkeletonLord exists in `mobs`, which today only happens via
  // the skeleton_lord bounty above — so its coverage is that bounty's group.
  {
    id: 'skeleton_summons',
    levelIds: LEVEL3,
    mobTypes: ['skeleton_sword', 'skeleton_archer'],
    requiredGroups: ['bounty_skeleton_lord'],
  },

  // CircusQuestSystem (src/systems/CircusQuestSystem.ts) and BigTopBossSystem
  // (src/systems/BigTopBossSystem.ts) — both level 3 only (circus tents and
  // the Big Top interior only exist on the overworld map). Nearly every
  // creature in this chain is procedural; only the stilt/fat clowns have art.
  {
    id: 'quest:circus',
    levelIds: LEVEL3,
    mobTypes: [
      'mold_lion',
      'circus_lemur',
      'stilt_clown',
      'fat_clown',
      'terror_the_clown',
      'signet',
      'heather_the_bear',
    ],
    requiredGroups: ['quest_circus'],
  },
  {
    id: 'quest:big_top',
    levelIds: LEVEL3,
    mobTypes: [
      'ringmaster_grimaldi',
      'vine_tendril',
      'circus_lemur',
      'stilt_clown',
      'fat_clown',
      'mold_lion',
      'signet',
    ],
    requiredGroups: ['quest_circus'],
  },

  // QuillConfrontationSystem (src/systems/QuillConfrontationSystem.ts) —
  // level 3 only. Every creature here is procedural, so no sprite group is
  // needed; the entry exists so the mob types are still checked against
  // MOB_SPRITE_KEYS.
  {
    id: 'quest:quill',
    levelIds: LEVEL3,
    mobTypes: ['miss_quill', 'remex', 'city_elf_cultist'],
    requiredGroups: [],
  },

  // MurderMysteryQuestSystem (src/systems/MurderMysteryQuestSystem.ts) —
  // level 3 only. Both creatures are procedural.
  {
    id: 'quest:murder_mystery',
    levelIds: LEVEL3,
    mobTypes: ['gum_gum', 'krasue'],
    requiredGroups: [],
  },

  // SpiderQuestSystem (src/systems/SpiderQuestSystem.ts) — level 2's spider
  // lab. Gated on `gameMap.spiderLabRoom`, which only a level with
  // `hasSpiderLab: true` generates.
  {
    id: 'quest:spider_lab',
    levelIds: ['level2'],
    mobTypes: ['grotesque_spider', 'small_spider'],
    requiredGroups: ['boss_grotesque_spider'],
  },

  // MongoSystem (src/systems/MongoSystem.ts) — Mongo is a persistent pet
  // companion unlockable from level 1 onward, not a spawn-table mob, so he can
  // walk onto any floor once unlocked.
  {
    id: 'companion:mongo',
    levelIds: ALL_LEVELS,
    mobTypes: ['mongo'],
    requiredGroups: ['core'],
  },

  // MercenarySystem (src/systems/MercenarySystem.ts) — a hired mercenary
  // follows the player across floors once recruited at the level 3 club. Only
  // the "bruiser" template needs a sheet (it draws from the rock golem sheet);
  // "enforcer"/"berserker" are procedural (`drawClubNpc`).
  {
    id: 'companion:mercenary',
    levelIds: ALL_LEVELS,
    mobTypes: ['mercenary_bruiser'],
    requiredGroups: ['core'],
  },

  // BossRoomSystem (src/systems/BossRoomSystem.ts) — `spawnHoarderCockroaches`
  // only fires while a live TheHoarder exists, i.e. level 1's first gauntlet
  // boss. The roaches have their own sheet now, and it rides in with hers.
  {
    id: 'boss_room:hoarder_cockroaches',
    levelIds: ['level1'],
    mobTypes: ['cockroach'],
    requiredGroups: ['boss_hoarder'],
  },
];

/**
 * Every sprite key a floor can produce: its own `LevelDef.spriteGroups` plus
 * every `SYSTEM_ASSET_REQUIREMENTS` entry scoped to it — the same union
 * `scripts/verify-assets.ts` cross-checks coverage against. Shared so
 * `releaseSpritesExcept`'s runtime eviction (`DungeonScene`'s floor-change call
 * site) can't drift from the build-time check: "what a floor needs" has
 * exactly one definition.
 *
 * Takes `levelId`/`spriteGroups` rather than a `LevelDef` to avoid a circular
 * import — `src/levels/types.ts` already imports `AssetGroup` from
 * `./assetGroups`, and this file sits alongside it.
 */
export function requiredSpriteKeysForLevel(
  levelId: string,
  spriteGroups: readonly AssetGroup[],
): ReadonlySet<SpriteKey> {
  const groups = new Set<AssetGroup>(spriteGroups);
  for (const req of SYSTEM_ASSET_REQUIREMENTS) {
    if (!req.levelIds.includes(levelId)) continue;
    for (const group of req.requiredGroups) groups.add(group);
  }
  const keys = new Set<SpriteKey>();
  for (const group of groups) {
    for (const key of ASSET_GROUPS[group]) keys.add(key);
  }
  return keys;
}
