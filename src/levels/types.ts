import type { CampKind } from '../map/overworld/camps';
import type { SoundId } from '../audio/sounds';
import type { DungeonFloorThemeId } from '../map/dungeon/floorTheme';
import type { XpDiminishingTier } from './xpDiminishing';
import type { AssetGroup } from '../core/assetGroups';
import type { LevelledCurve } from '../creatures/mobLevelScaling';
import type { Difficulty } from '../core/difficultyProfiles';

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
    | 'goblin_archer'
    | 'fairy_shield'
    | 'fairy_healer'
    | 'fairy_ice'
    | 'fairy_fire'
    | 'fairy_necro'
    | 'cow'
    | 'calf'
    | 'necromancer'
    | 'raised_ratkin'
    | 'grave_bull';
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

/** How far a floor's ambient bands may follow a party past their authored tops. */
export interface AmbientTracking {
  /** The highest level any ambient mob on the floor may be slid up to. */
  readonly maxLevel: number;
  /** Levels a slid band's rolls sit under the party's earned level. */
  readonly levelsBehind: number;
}

/** How a floor's rooms grow once a party's earned level has passed their bands. */
export interface OverLevelReinforcement {
  /** Levels the earned level must pass a room's band top by for each extra body. */
  readonly levelsPerBody: number;
  /** The most extra bodies one room gains, however far ahead the party is. */
  readonly maxBodies: number;
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
  /**
   * Seats the defense quest's room as a mandatory choke on this gauntlet: either
   * on the sealed stem out of the previous boss room, or on the approach between
   * the gateway safe room and this gauntlet's own boss. Which of the two is
   * drawn per map.
   *
   * Branches are parallel, so a branch room can never be a forced crossing —
   * those two stems are the only points on a gauntlet every player provably
   * walks through.
   */
  questChoke?: boolean;
}

/**
 * A single forced chain of rooms between two fixed landmarks, replacing the
 * free-region sprawl on a floor that declares one.
 *
 * The journey's length comes from winding rather than from separation: the two
 * endpoints may be only a few dozen tiles apart, so `rooms` is a contract about
 * the *walk*, not about the distance.
 */
export interface SpineDef {
  /** Rooms seated along the chain, endpoints exclusive. The quest room is one of them. */
  rooms: { min: number; max: number };
  /** Chain positions that fork into a second, reconverging lane. */
  splits: { min: number; max: number };
}

/**
 * The band the defense quest's bugaboo wave rolls its level in on this floor.
 *
 * Per floor rather than fixed on the creature, because the encounter is now a
 * mandatory choke that floor 1 meets mid-run and floor 2 meets again much later:
 * one body cannot be the right fight for both.
 */
export type DefendQuestWaveDef = MobLevelRange;

export interface ProgressionDef {
  /** In order. `gauntlets[i].bossType` must equal `bossRooms[i].type`. */
  gauntlets: GauntletDef[];
  /**
   * Replaces the free region past the last gateway boss with one forced,
   * winding chain of rooms ending at the arena's antechamber. Only meaningful
   * on a floor that has an arena, which is what supplies the far endpoint.
   */
  spine?: SpineDef;
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

/**
 * How likely one room is to hold fairies, and how many, per difficulty. Counts
 * are of the non-healer fairies only: a room's healer is rolled apart from them
 * and never counts toward them.
 */
export interface FairyRoomRate {
  /** Chance a room gets any non-healer fairies at all. */
  readonly chance: Readonly<Record<Difficulty, number>>;
  /** Inclusive count range once the chance succeeds, drawn uniformly. */
  readonly minCount: Readonly<Record<Difficulty, number>>;
  readonly maxCount: Readonly<Record<Difficulty, number>>;
}

/** Rates that replace one region's once a named boss is dead. */
export interface FairyRateUpgrade {
  readonly bossType: string;
  readonly region: number;
  readonly rate: FairyRoomRate;
  /**
   * Narrows the upgrade to the rooms of `region` lying past the safe room that
   * guards `bossType`: those the floor's start cannot reach without crossing
   * it. Every other room of the region keeps its base rate for good.
   */
  readonly onlyPastItsSafeRoom?: boolean;
}

/**
 * Where a floor's fairies come from. Fairies are always extra to a room's own
 * population: they never count against `MAX_ROOM_SPAWN_COUNT`.
 */
export interface FairySpawnTable {
  /** Indexed by progression region; null (or a missing entry) means no fairies there. */
  readonly roomRatesByRegion: readonly (FairyRoomRate | null)[];
  /** Independent per-room healer roll, the same on every difficulty; 0 disables. */
  readonly roomHealerChance: number;
  /** Region rates replaced once a named boss is dead, applied to rooms nobody has touched. */
  readonly upgrades?: readonly FairyRateUpgrade[];
  /** Chance per ambient scatter point of one non-healer fairy beside it. */
  readonly scatterChance?: Readonly<Record<Difficulty, number>>;
  /** Independent per-point healer roll, extra to the scatter fairy; 0 disables. */
  readonly scatterHealerChance?: number;
  /**
   * Keeps the guaranteed shield fairy (`needsGuaranteedShield`) to nightmare
   * (`hard`) only: on easy and normal a group with no shield in it stays that
   * way. Unset (or false) guarantees on every difficulty, the original rule.
   */
  readonly guaranteedShieldNightmareOnly?: boolean;
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
   * Diminishing returns on XP earned here — kills, bosses and quest rewards
   * alike — so an early floor can't be farmed into trivialising the ones below
   * it. Absent means uncapped. Applied per level bought (`Player.gainXp`), so a
   * large award cannot carry a crawler past a tier at full value.
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
   * Extra bodies every room gains once the party has out-levelled that room's
   * band. Absent means rooms spawn their authored counts at any party level, as
   * the learning floor does. See `overLevelReinforcementBodies`.
   */
  overLevelReinforcement?: OverLevelReinforcement;
  /**
   * How this floor's ambient mobs keep pace with a party that has out-levelled
   * their authored bands. Absent means the bands are hard ceilings, as on the
   * learning floor. See `partyTrackedBand`.
   */
  ambientTracking?: AmbientTracking;
  /**
   * The HP and damage curve every mob this floor levels is levelled on — rooms,
   * hallways, treasure guards, extra spawns, bosses and the defend-quest wave.
   * Absent means `SHARED_LEVELLED_CURVE`. Level-1 mobs are the same under every
   * curve. See `LevelledCurve`.
   */
  levelledCurve?: LevelledCurve;
  /**
   * Suppresses the stairwell menu's "Recommended level" advice entirely — no
   * number, and no underlevelled warning.
   *
   * For a floor that exists to teach rather than to gate: the tutorial's party
   * cannot reach the level its successor's mob bands imply, so advertising that
   * number could only ever tell a new crawler they are behind before they have
   * had a chance to be anything else.
   */
  suppressDescentAdvice?: true;
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
  /**
   * Level band the defense quest's bugaboo wave rolls in on this floor. Absent
   * means the wave spawns at base stats, which is right only for a floor where
   * the encounter is optional side content.
   */
  defendQuestWave?: DefendQuestWaveDef;
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
   * Fairies spawned on top of this floor's own population: per room by
   * progression region, and per ambient scatter point on the overworld. Absent
   * means none.
   */
  fairies?: FairySpawnTable;
  /**
   * Forces an early-floor boss order. When present the generator replaces free
   * room placement with the declared gauntlets — spawn at map centre, branch
   * chains, gateway safe room, gateway boss room, repeated per gauntlet — and
   * only then generates a free-roam region. Absent means the classic free-roam
   * layout from the first room.
   */
  progression?: ProgressionDef;
}
