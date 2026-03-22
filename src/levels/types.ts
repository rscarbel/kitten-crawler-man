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
    | 'sky_fowl';
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
  /** If set, only triggers when the killed mob is NOT one of these types. */
  excludeKilledTypes?: string[];
}

/** Data-only description of a dungeon level. No game-logic dependencies. */
export interface LevelDef {
  id: string;
  name: string;
  /** Side-length passed to `new GameMap(mapSize, TILE_SIZE)`. */
  mapSize: number;
  /** Mobs that can spawn at room centres (all non-start, non-special rooms). */
  roomMobs: MobSpawnRule[];
  /** Mobs that can spawn at hallway points. */
  hallwayMobs: MobSpawnRule[];
  /** Boss room configurations — one boss room per entry, placed in rooms[2+]. */
  bossRooms?: Array<{ type: string }>;
  /** ID of the next level in the registry, if any. */
  nextLevelId?: string;
  /** Safe levels have no timer and spawn no enemies. */
  isSafeLevel?: boolean;
  /** Override the auto-calculated stairwell count (default: 1 per 50 regular rooms). */
  numStairwells?: number;
  /** Overworld levels use outdoor map generation instead of dungeon rooms. */
  isOverworld?: boolean;
  /** Whether this level has a circular arena with the Ball of Swine boss. */
  hasArena?: boolean;
  /** Position-relative spawn rules evaluated at level construction time. */
  extraSpawns?: ExtraSpawnRule[];
  /** Mobs to spawn when another mob is killed (event-driven). */
  onMobKilledSpawns?: OnMobKilledSpawn[];
}
