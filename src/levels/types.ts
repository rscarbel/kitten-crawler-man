import type { CampKind } from '../map/overworld/camps';
import type { SoundId } from '../audio/sounds';
import type { DungeonFloorThemeId } from '../map/dungeon/floorTheme';
import type { XpDiminishingTier } from './xpDiminishing';

/**
 * One entry of a camp's roster: a mob type, a count and a level range.
 *
 * Deliberately **not** a `MobSpawnRule`. That type is for weighted tables where
 * one entry is picked; a camp spawns all of its entries, so a `chance` on one
 * would be a field with no meaning that the spawner silently ignores.
 */
export type CampSpawnRule = Omit<MobSpawnRule, 'chance'>;

/** A single entry in a weighted mob-spawn table. */
export interface MobSpawnRule {
  /** String key resolved by the spawner factory. */
  type:
    | 'goblin'
    | 'llama'
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
    | 'mold_lion'
    | 'terror_the_clown'
    | 'ringmaster_grimaldi'
    | 'city_elf_cultist';
  /**
   * Relative weight (0–1). The spawner normalises the list so weights
   * don't have to sum to exactly 1 — just make sure at least one rule exists.
   */
  chance: number;
  /** Minimum number of this mob type to spawn per room (default 1). */
  minCount?: number;
  /** Maximum number of this mob type to spawn per room (default 1). */
  maxCount?: number;
  /** Minimum mob level (default 1). Higher levels scale HP, speed, damage, XP, and coins. */
  minLevel?: number;
  /** Maximum mob level (default 1). A random level in [minLevel, maxLevel] is picked per spawn. */
  maxLevel?: number;
  /** Optional per-mob config forwarded to the constructor. */
  config?: Record<string, unknown>;
}

/**
 * Describes mobs that should be spawned at positions relative to a map
 * landmark (boss room, arena centre, map centre, etc.) rather than at
 * generic room/hallway spawn points.
 */
export interface ExtraSpawnRule {
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
  /** Mobs that can spawn at room centres (all non-start, non-special rooms). */
  roomMobs: MobSpawnRule[];
  /** Mobs that can spawn at hallway points. */
  hallwayMobs: MobSpawnRule[];
  /**
   * Boss room configurations, one boss room per entry. Index-aligned with the
   * generated map's `bossRooms`, and — on a progression floor — with
   * `progression.gauntlets`.
   */
  bossRooms?: Array<{ type: string }>;
  /** ID of the next level in the registry, if any. */
  nextLevelId?: string;
  /**
   * Diminishing returns on combat XP earned here, so an early floor can't be
   * farmed into trivialising the ones below it. Absent means uncapped. Quest
   * rewards ignore this entirely — only mob kills are scaled.
   */
  xpDiminishingTiers?: XpDiminishingTier[];
  /**
   * Runs the floor without a countdown timer, and without the extra mobs that
   * guard treasure rooms. Room, hallway and boss spawns are unaffected — a "safe"
   * level is only safe from the clock.
   */
  isSafeLevel?: boolean;
  /** Override the auto-calculated stairwell count (default: 1 per 50 regular rooms). */
  numStairwells?: number;
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
