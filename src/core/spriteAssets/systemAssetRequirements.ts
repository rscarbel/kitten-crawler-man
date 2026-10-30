import { LEVEL_IDS, type LevelId } from '../../levels/levelIds';
import { ASSET_GROUPS, type AssetGroup, type CreatureKind } from './assetGroups';
import type { SpriteKey } from './SpriteLoader';

/**
 * A `LevelDef` does not list everything that can appear on its floor.
 * `BountySystem`, `StarlightTentMazeSystem`, `LichBattleSystem`, `SpiderQuestSystem`,
 * `SkeletonSummonSystem`, `DeinonychusSystem` and `MercenarySystem` all construct
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
 * `mobTypes` are creature kinds whose sprite needs `MOB_SPRITE_KEYS` and
 * `FRIENDLY_CREATURE_SPRITE_KEYS` (`src/core/spriteAssets/assetGroups.ts`) declare, so
 * `verify:assets` can confirm
 * `requiredGroups` actually covers what the system spawns, not just that the
 * author remembered to list *something*.
 */
export interface SystemAssetRequirement {
  /** Stable id: `<system>` or `<system>:<bounty-or-quest-id>`. */
  readonly id: string;
  /** Level ids (`LevelDef.id`) this system/encounter can introduce creatures on. */
  readonly levelIds: readonly LevelId[];
  /** The creature kinds this system/encounter can construct. */
  readonly mobTypes: readonly CreatureKind[];
  /** Asset groups declared as covering `mobTypes`' sprite needs. */
  readonly requiredGroups: readonly AssetGroup[];
}

const LEVEL3: readonly LevelId[] = ['level3'];
const ALL_LEVELS = LEVEL_IDS;
/** Every floor whose `LevelDef.fairies` table or boss fights can produce a fairy. */
const FAIRY_LEVELS: readonly LevelId[] = ['level1', 'level2', 'level3'];

export const SYSTEM_ASSET_REQUIREMENTS: readonly SystemAssetRequirement[] = [
  // The fairy passes in `src/levels/fairySpawner.ts` read `LevelDef.fairies`,
  // a table the per-floor coverage does not walk, and hard-mode boss fights add
  // a healer from their own systems. All five are painted.
  {
    id: 'fairies',
    levelIds: FAIRY_LEVELS,
    mobTypes: ['fairy_shield', 'fairy_healer', 'fairy_ice', 'fairy_fire', 'fairy_necro'],
    requiredGroups: [],
  },
  // BountySystem — src/systems/bountyDefs.ts. One entry per BountyDef id.
  {
    id: 'bounty:evil_clown',
    levelIds: LEVEL3,
    mobTypes: ['evil_clown', 'tall_clown', 'fat_clown'],
    requiredGroups: [],
  },
  // Both builds are painted rather than baked, so no sprite group is needed;
  // the entry exists so the mob types are still checked against
  // MOB_SPRITE_KEYS.
  {
    id: 'bounty:mantid',
    levelIds: LEVEL3,
    mobTypes: ['mantid', 'mantis'],
    requiredGroups: [],
  },
  // All three are painted, so the encounter needs no sheet group; the entry
  // exists so the mob types are still checked against MOB_SPRITE_KEYS.
  {
    id: 'bounty:skeleton_lord',
    levelIds: LEVEL3,
    mobTypes: ['skeleton_lord', 'skeleton_sword', 'skeleton_archer'],
    requiredGroups: [],
  },
  // The knight and his ten goblins are all painted, so the encounter needs no
  // sheet group; the entry exists so the mob types are still checked against
  // MOB_SPRITE_KEYS.
  {
    id: 'bounty:dark_knight',
    levelIds: LEVEL3,
    mobTypes: ['dark_knight', 'goblin'],
    requiredGroups: [],
  },
  // Both bodies are painted rather than baked, so no sprite group is needed;
  // the entry exists so the mob types are still checked against
  // MOB_SPRITE_KEYS.
  {
    id: 'bounty:rock_golem',
    levelIds: LEVEL3,
    mobTypes: ['rock_golem_boss', 'rock_golem'],
    requiredGroups: [],
  },

  // SkeletonSummonSystem (src/systems/SkeletonSummonSystem.ts) raises the two
  // warriors, both of which are painted rather than baked. Floors 1 and 2 as
  // well as 3, because a necro fairy raises them wherever it spawns.
  {
    id: 'skeleton_summons',
    levelIds: FAIRY_LEVELS,
    mobTypes: ['skeleton_sword', 'skeleton_archer'],
    requiredGroups: [],
  },

  // StarlightTentMazeSystem (src/systems/StarlightTentMazeSystem.ts) — level 3 only: the
  // Starlight Tent interior only exists on the overworld map. The finale ring's
  // guards are procedural, so no sprite group is needed; the entry exists so
  // the mob types are still checked against MOB_SPRITE_KEYS.
  {
    id: 'starlight_tent',
    levelIds: LEVEL3,
    mobTypes: ['tall_clown', 'fat_clown', 'massive_clown'],
    requiredGroups: [],
  },

  // The lodge cellar's defence (src/systems/missingCats/LodgeCellarDefence.ts):
  // the elves who hold it with the party and what comes up the cistern at
  // them. All painted, so no group is needed; the entry exists so the mob
  // types are still checked against MOB_SPRITE_KEYS.
  {
    id: 'quest:missing_cats_cellar',
    levelIds: LEVEL3,
    mobTypes: ['elf', 'ruins_ghoul', 'raveling'],
    requiredGroups: [],
  },

  // LichBattleSystem (src/systems/LichBattleSystem.ts) — the tower's Lich and
  // the skeletons it raises are all painted, so there is no group to load; the
  // entry exists so the mob types are still checked against MOB_SPRITE_KEYS.
  {
    id: 'lich_battle',
    levelIds: LEVEL3,
    mobTypes: ['the_lich', 'skeleton_sword', 'skeleton_archer'],
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

  // DeinonychusSystem (src/systems/DeinonychusSystem.ts) — Deinonychus is a persistent pet
  // companion unlockable from level 1 onward, not a spawn-table mob, so he can
  // walk onto any floor once unlocked.
  {
    id: 'companion:deinonychus',
    levelIds: ALL_LEVELS,
    mobTypes: ['deinonychus'],
    requiredGroups: ['core'],
  },

  // BriarHollowKit (src/systems/briarHollow/BriarHollowKit.ts) — the ratkin
  // cast is painted at runtime (`RATKIN_CAST_FIGURES`), so it holds no sheet
  // key; the kit's `RatkinCastPrewarm` warms each villager's first rows as the
  // party nears the palisade. Civilians are not mobs, so they add no mob type;
  // village creatures that are mobs join this entry as they are spawned.
  {
    id: 'briar_hollow',
    levelIds: LEVEL3,
    // The assault's undead are painted too — the necromancer, the three raised
    // ratkin looks and the Grave Bull — so they need no group either; the
    // assault warms their figures ahead of each wave (`AssaultWavePrewarm`).
    // The herd (`LivestockSystem`) is painted as well, and warms its own coats
    // as it spawns.
    // The militia (`SoldierSystem`) are ratkin cast figures, warmed with the
    // rest of the cast as the party nears the palisade.
    mobTypes: ['necromancer', 'raised_ratkin', 'grave_bull', 'cow', 'calf', 'ratkin_soldier'],
    requiredGroups: [],
  },

  // MercenarySystem (src/systems/MercenarySystem.ts) — a hired mercenary
  // follows the player once recruited at the level 3 club. Every hire is
  // painted at runtime through `MERCENARY_ART`, so none holds a sheet key;
  // residency is the figure cache's, and `MercenarySystem` warms only the
  // hired figure each time it spawns, never all seven.
  {
    id: 'companion:mercenary',
    levelIds: ALL_LEVELS,
    mobTypes: ['mercenary'],
    requiredGroups: [],
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
  levelId: LevelId,
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
