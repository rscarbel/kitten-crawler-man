import type { CampKind } from '../map/overworld/camps';
import type { SoundId } from '../audio/sounds';
import type { DungeonFloorThemeId } from '../map/dungeon/floorTheme';
import type { XpDiminishingTier } from './xpDiminishing';
import type { AssetGroup } from '../core/assetGroups';

/**
 * One entry of a camp's roster: a mob type, a count and a level range.
 *
 * Deliberately **not** a `MobSpawnRule`. That type is for weighted tables where
 * one entry is picked; a camp spawns all of its entries, so a `chance` on one
 * would be a field with no meaning that the spawner silently ignores. `escorts`
 * goes for the same reason and is unnecessary besides — a roster that spawns
 * every entry can simply list the escort as an entry of its own, which is what
 * floor 3's goblin camp does with its archers.
 */
export type CampSpawnRule = Omit<MobSpawnRule, 'chance' | 'escorts'>;

/**
 * The level band a spawn rule rolls within, shared by every kind of rule that
 * can produce a levelled mob.
 *
 * Factored out because for a long time only room and hallway rules had one, so
 * boss rooms and `extraSpawns` spawned at base stats forever — a level-1
 * troglodyte guarding a floor-1 gauntlet boss, and a Ball of Swine no tougher on
 * the day the party finds it than on the day the floor was authored.
 */
export interface MobLevelRange {
  /** Minimum mob level (default 1). Higher levels scale HP, speed, damage, cadence, XP and coins. */
  minLevel?: number;
  /** Maximum mob level (default `minLevel`). A random level in the band is picked per spawn. */
  maxLevel?: number;
}

/** A single entry in a weighted mob-spawn table. */
export interface MobSpawnRule extends MobLevelRange {
  /** String key resolved by the spawner factory. */
  type:
    | 'goblin'
    | 'llama'
    | 'rock_golem'
    | 'rock_golem_boss'
    | 'mantid'
    | 'mantis'
    | 'rat'
    | 'the_hoarder'
    | 'cockroach'
    | 'juicer'
    | 'troglodyte'
    | 'tuskling'
    | 'ball_of_swine'
    | 'krakaren_clone'
    | 'brindle_grub'
    | 'sky_fowl'
    | 'grotesque_spider'
    | 'small_spider'
    | 'ruins_ghoul'
    | 'krasue'
    | 'circus_lemur'
    | 'stilt_clown'
    | 'fat_clown'
    | 'evil_clown'
    | 'mold_lion'
    | 'terror_the_clown'
    | 'city_elf_cultist'
    | 'skeleton_sword'
    | 'skeleton_archer'
    | 'skeleton_lord'
    | 'the_lich'
    | 'goblin_archer';
  /**
   * Relative weight (0–1). The spawner normalises the list so weights
   * don't have to sum to exactly 1 — just make sure at least one rule exists.
   */
  chance: number;
  /** Minimum number of this mob type to spawn per room (default 1). */
  minCount?: number;
  /** Maximum number of this mob type to spawn per room (default 1). */
  maxCount?: number;
  /**
   * Extra mobs spawned into the same room alongside this rule's own.
   *
   * The mechanism exists for one creature and states its design contract: a
   * goblin archer must never be the thing a room is made of. Alone it is a slow,
   * fragile plinker the player simply walks down; behind a melee line it is what
   * makes the melee line dangerous. A weighted table can only pick *one* rule
   * per room, so without this an archer entry would occasionally fill a whole
   * room with archers and never once produce the mixed group it is for.
   */
  escorts?: EscortSpawnRule[];
  /** Optional per-mob config forwarded to the constructor. */
  config?: Record<string, unknown>;
}

/**
 * A mob attached to another rule's spawn, never spawned on its own.
 *
 * See {@link MobSpawnRule.escorts}.
 */
export interface EscortSpawnRule extends MobLevelRange {
  type: MobSpawnRule['type'];
  /** Minimum number to spawn alongside the host rule (default 1). */
  minCount?: number;
  /** Maximum number to spawn alongside the host rule (default 1). */
  maxCount?: number;
  /**
   * Withheld until the progression region at this index; absent means every
   * region. Floor 1's archers are gated behind the Hoarder this way, so the
   * opening stretch of a first-time crawler's first dungeon is unchanged.
   */
  minRegion?: number;
}

/**
 * One boss room's occupant and the level band it spawns within.
 *
 * The band is a band rather than a single number because the party's own level
 * is folded into it at generation time (see `resolveSpawnLevel`): its floor
 * protects a first encounter from being trivial and its ceiling keeps the
 * encounter's authored tuning intact for a party that comes back over-levelled.
 */
export interface BossRoomRule extends MobLevelRange {
  type: string;
}

/**
 * Describes mobs that should be spawned at positions relative to a map
 * landmark (boss room, arena centre, map centre, etc.) rather than at
 * generic room/hallway spawn points.
 */
export interface ExtraSpawnRule extends MobLevelRange {
  /** Mob type key (must be registered in the spawner MOB_REGISTRY). */
  type: MobSpawnRule['type'];
  /**
   * Where the origin point comes from:
   * - `bossRoom:<index>` — centre of the Nth boss room (e.g. `bossRoom:1`)
   * - `arena:0`          — centre of the first arena exterior
   * - `mapCenter`        — (mapSize/2, mapSize/2)
   */
  origin: string;
  /** Tile offsets from the origin. One mob is spawned per offset. */
  offsets: [number, number][];
  /** Optional post-spawn callback key for special setup (e.g. 'setupBallOfSwine'). */
  setup?: string;
}

/**
 * Describes mobs that should spawn reactively when another mob is killed.
 * Evaluated by the EventBus `mobKilled` handler.
 */
export interface OnMobKilledSpawn {
  /** Mob type to spawn. */
  type: MobSpawnRule['type'];
  /** Min number to spawn (inclusive). */
  minCount: number;
  /** Max number to spawn (inclusive). */
  maxCount: number;
  /** Max tile offset from the death location for placement attempts. */
  spreadRadius: number;
}

/**
 * One forced-progression unit on a floor: several branching room chains leaving
 * a common entry, all converging on a single gateway safe room whose only onward
 * exit is the named boss's room. Nothing beyond that boss room is reachable
 * without clearing it.
 */
export interface GauntletDef {
  /** Boss guarding this gauntlet's gateway; pairs with the same-index `bossRooms` entry. */
  bossType: MobSpawnRule['type'];
  branchCount: { min: number; max: number };
  /** Rooms per branch, exclusive of the entry room and the gateway safe room. */
  branchRooms: { min: number; max: number };
}

export interface ProgressionDef {
  /** In order. `gauntlets[i].bossType` must equal `bossRooms[i].type`. */
  gauntlets: GauntletDef[];
  /** Extra safe rooms scattered in the free region (gateway safe rooms are additional). */
  scatterSafeRooms: number;
  /**
   * Extra mobs added to each room's rolled count, indexed by progression region
   * — one entry per gauntlet, then one more for the free-roam region beyond the
   * last gateway boss. Missing entries mean no bonus.
   *
   * The count axis is the one that never scaled: spawn tables are fixed at
   * generation and clearing a boss changed nothing, so the last stretch of a
   * floor was as thinly populated as its first. Rooms stay capped at
   * `MAX_ROOM_SPAWN_COUNT` however generous a bonus and a roll combine to be.
   */
  regionSpawnBonus?: number[];
  /**
   * Levels added to a room rule's *band* — floor and ceiling both — before the
   * spawn level is rolled, indexed the same way as {@link regionSpawnBonus}.
   * Missing entries mean no bonus.
   *
   * The count axis alone could not fix a floor going flat: a spawn rolls
   * somewhere between what the party has earned and its band's ceiling, so once
   * the party out-earns that ceiling every later room is the same fight with
   * more bodies in it. Shifting the band is what lets the last stretch of a
   * floor step up toward the numbers the next floor opens with.
   *
   * Applies to a room's own rule, to its escorts so the room stays internally
   * coherent, and to treasure-room guards so a chest is never softer than the
   * hallway outside it. Hallway spawns have no region to key off and are left
   * as ambience.
   */
  regionLevelBonus?: number[];
}

/** Data-only description of a dungeon level. No game-logic dependencies. */
export interface LevelDef {
  id: string;
  name: string;
  /** Dungeon depth, 1-based. Drives depth-scaled rewards such as smashed-prop coins. */
  floorNumber: number;
  /** Default background music for this level, and what music resumes after boss fights/quests. */
  music: SoundId;
  /** Side length of the square tile grid this floor is generated on. */
  mapSize: number;
  /**
   * The sprite groups (`src/core/assetGroups.ts`) this floor's *base* content
   * needs: `roomMobs`, `hallwayMobs`, `extraSpawns`, `campSpawns`, `bossRooms`
   * and the ground/wall theme. Does NOT include creatures introduced by
   * bounty/quest/companion systems that never touch this def — those are
   * declared separately in `SYSTEM_ASSET_REQUIREMENTS`
   * (`src/core/systemAssetRequirements.ts`) and unioned in by floor id at
   * `verify:assets` time. See that file's header for why: a floor's `LevelDef`
   * does not list everything that can appear on it.
   */
  spriteGroups: readonly AssetGroup[];
  /** Mobs that can spawn at room centres (all non-start, non-special rooms). */
  roomMobs: MobSpawnRule[];
  /** Mobs that can spawn at hallway points. */
  hallwayMobs: MobSpawnRule[];
  /**
   * Boss room configurations, one boss room per entry. Index-aligned with the
   * generated map's `bossRooms`, and — on a progression floor — with
   * `progression.gauntlets`.
   */
  bossRooms?: BossRoomRule[];
  /** ID of the next level in the registry, if any. */
  nextLevelId?: string;
  /**
   * Diminishing returns on combat XP earned here, so an early floor can't be
   * farmed into trivialising the ones below it. Absent means uncapped. Quest
   * rewards ignore this entirely — only mob kills are scaled.
   */
  xpDiminishingTiers?: XpDiminishingTier[];
  /**
   * Runs the floor against a countdown; when it expires the floor collapses and
   * kills the party. Absent means the floor is untimed.
   */
  hasCollapseTimer?: boolean;
  /**
   * Spawns extra mobs guarding treasure rooms. Room, hallway and boss spawns are
   * unaffected. Absent means treasure rooms are unguarded.
   */
  hasTreasureRoomGuards?: boolean;
  /** Override the auto-calculated stairwell count (default: 1 per 50 regular rooms). */
  numStairwells?: number;
  /**
   * Overrides the stairwell menu's "Recommended level" advice for descending
   * onto this floor, in place of the value `recommendedPartyLevelFor` derives
   * from the floor's own ambient mob bands. Set this when the number the
   * bands imply isn't the number worth advertising — raising it the honest
   * way means raising every ambient mob's level cap, which is a much bigger
   * difficulty change than the advice text alone.
   */
  recommendedLevelOverride?: number;
  /**
   * Scales the stairwell count so a floor can stay room-count-driven while still
   * being easier or harder to find a way down on (default 1). Applied after
   * `numStairwells`, so a floor may set either or both.
   */
  stairwellCountMultiplier?: number;
  /** Overworld levels use outdoor map generation instead of dungeon rooms. */
  isOverworld?: boolean;
  /**
   * Which materials this floor's generic walls and floors are drawn in.
   *
   * Two floors generated by the same `DungeonGenerator` carry the same five tile
   * types, so this is the only thing that makes them look different — see
   * `src/map/dungeon/floorTheme.ts`. Absent on an overworld level, which has its
   * own palette and never reaches the dungeon renderer.
   */
  groundTheme?: DungeonFloorThemeId;
  /** Whether this level has a circular arena with the Ball of Swine boss. */
  hasArena?: boolean;
  /** Whether this level has a spider lab room with the Grotesque Spider quest. */
  hasSpiderLab?: boolean;
  /** Whether mobs on this floor may roll the rare Slingshot world drop. */
  slingshotDrops?: boolean;
  /** Position-relative spawn rules evaluated at level construction time. */
  extraSpawns?: ExtraSpawnRule[];
  /**
   * Residents of the wilderness's enemy camps, one roster per kind.
   *
   * Keyed by camp *kind* rather than by index, deliberately: a map may site one
   * camp and not the other, and an index-based rule would then populate the
   * wrong one. `spawnForLevel` walks `map.camps` and looks each up here, so a
   * level with no `campSpawns` — every floor but 3 — spawns nothing extra and
   * takes no new code path.
   *
   * A camp roster spawns **every** entry rather than picking one, so
   * `CampSpawnRule` drops `chance`. Reusing `MobSpawnRule` left a required field
   * the spawner never read, and a future roster written with `chance: 0.5` would
   * have spawned at 100% without a word.
   */
  campSpawns?: Partial<Record<CampKind, CampSpawnRule[]>>;
  /** Mobs to spawn when another mob is killed (event-driven). */
  onMobKilledSpawns?: OnMobKilledSpawn[];
  /**
   * Forces an early-floor boss order. When present the generator replaces free
   * room placement with the declared gauntlets — spawn at map centre, branch
   * chains, gateway safe room, gateway boss room, repeated per gauntlet — and
   * only then generates a free-roam region. Absent means the classic free-roam
   * layout from the first room.
   */
  progression?: ProgressionDef;
}
