import type { LevelId } from './levelIds';
import type { CampKind } from '../map/overworld/camps';
import type { BathroomRequest } from '../map/gauntletLayout';
import type { StealthGateRequest } from '../map/spineLayout';
import type { GauntletBossType } from '../map/bossRoomSizes';
import type { FloodedApproachSpec } from '../map/floodedApproach';
import type { MusicTrackId } from '../audio/sounds';
import type { DungeonFloorThemeId } from '../map/dungeon/floorTheme';
import type { XpDiminishingTier } from './xpDiminishing';
import type { AssetGroup } from '../core/spriteAssets/assetGroups';
import type { LevelledCurve } from '../creatures/mobLevelScaling';
import type { Difficulty } from '../core/difficulty/difficultyProfiles';
import type { DefendQuestIntensity } from './defendQuestIntensity';
import type { StandaloneMobKind } from './mobKinds';
import type { SpawnTerrain } from '../map/overworld/spawnTerrain';

/**
 * One entry of a camp's roster: a mob type, a count and a level range.
 *
 * Deliberately **not** a `MobSpawnRule`. That type is for weighted tables where
 * one entry is picked; a camp spawns all of its entries, so a `chance` on one
 * would be a field with no meaning that the spawner silently ignores. `escorts`
 * goes for the same reason and is unnecessary besides — a roster that spawns
 * every entry can simply list the escort as an entry of its own, which is what
 * floor 3's goblin camp does with its archers. `terrain` goes because a camp's
 * ground is the camp, not a classified spawn point.
 */
export type CampSpawnRule = Omit<MobSpawnRule, 'chance' | 'escorts' | 'terrain'>;

/**
 * The level band a spawn rule rolls within, shared by every kind of rule that
 * can produce a levelled mob.
 *
 * Factored out because for a long time only room and hallway rules had one, so
 * boss rooms and `extraSpawns` spawned at base stats forever — a level-1
 * lizardman guarding a floor-1 gauntlet boss, and a gauntlet boss no tougher on
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
  type: StandaloneMobKind;
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
   * Extra mobs spawned into the same room alongside this rule's own, or beside
   * a hallway rule's one body.
   *
   * A weighted table can only pick *one* rule per room or point, so this is how
   * a group is authored. A goblin archer must never be the thing a room is made
   * of: alone it is a slow, fragile plinker the player simply walks down; behind
   * a melee line it is what makes the melee line dangerous. Giant wasps escort
   * their own kind, because a wasp is met as a swarm, never one at a time.
   */
  escorts?: EscortSpawnRule[];
  /**
   * The only terrain this rule may be picked on; absent means every point.
   * Only the overworld classifies its points, so a rule with one never spawns
   * in a dungeon.
   */
  terrain?: SpawnTerrain;
}

/**
 * A mob attached to another rule's spawn, never spawned on its own.
 *
 * See {@link MobSpawnRule.escorts}.
 */
export interface EscortSpawnRule extends MobLevelRange {
  type: StandaloneMobKind;
  /** Minimum number to spawn alongside the host rule (default 1). */
  minCount?: number;
  /** Maximum number to spawn alongside the host rule (default 1). */
  maxCount?: number;
  /**
   * Withheld until the progression region at this index; absent means every
   * region. Floor 1's archers are gated behind the Trash Gremlin this way, so the
   * opening stretch of a first-time crawler's first dungeon is unchanged. A
   * hallway point belongs to no region, so an escort with one set never joins
   * a hallway rule.
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
  type: GauntletBossType;
}

/** The landmark an {@link ExtraSpawnRule}'s offsets are measured from. */
export type ExtraSpawnOrigin =
  /** The centre of the room this floor seats for `bossType`. */
  | { readonly kind: 'bossRoom'; readonly bossType: GauntletBossType }
  /** (mapSize/2, mapSize/2). */
  | { readonly kind: 'mapCenter' };

/**
 * Describes mobs that should be spawned at positions relative to a map
 * landmark (a boss room or the map centre) rather than at generic room/hallway
 * spawn points.
 */
export interface ExtraSpawnRule extends MobLevelRange {
  type: StandaloneMobKind;
  origin: ExtraSpawnOrigin;
  /** Tile offsets from the origin. One mob is spawned per offset. */
  offsets: [number, number][];
}

/**
 * Describes mobs that should spawn reactively when another mob is killed.
 * Evaluated by the EventBus `mobKilled` handler.
 */
export interface OnMobKilledSpawn {
  /** Mob type to spawn. */
  type: StandaloneMobKind;
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
 * Branching room chains leaving a common entry, all converging on a gauntlet's
 * gateway safe room. Branches are parallel, so no branch room is a forced
 * crossing.
 */
export interface BranchesRoute {
  kind: 'branches';
  branchCount: { min: number; max: number };
  /** Rooms per branch, exclusive of the entry room and the gateway safe room. */
  branchRooms: { min: number; max: number };
  /**
   * Seats a clogged bathroom of this size halfway along every branch. Its
   * onward doorways stay blocked by the queue until the plumbing is fixed, and
   * one fix opens every copy, so whichever branch the player takes, the way to
   * the gateway runs through a bathroom.
   */
  bathroomChoke?: BathroomRequest;
}

/**
 * A single forced chain of rooms from the previous gauntlet's exit safe room to
 * this gauntlet's gateway safe room. Only a gauntlet after the first can be
 * reached this way, since the first has no previous exit to leave from.
 *
 * The journey's length comes from winding rather than from separation: the two
 * endpoints may be only a few dozen tiles apart, so `rooms` is a contract about
 * the *walk*, not about the distance.
 */
export interface SpineRoute {
  kind: 'spine';
  /** Rooms seated along the chain, endpoints exclusive. The quest room is one of them. */
  rooms: { min: number; max: number };
  /** Chain positions that fork into a second, reconverging lane. */
  splits: { min: number; max: number };
  /**
   * Seats a room of this size at the chain's halfway index whose onward
   * doorway is shut by a locked gate, with the prison door in its side wall.
   * Every chain room is a cut vertex, so the gate is on every route through.
   */
  stealthGate?: StealthGateRequest;
}

/** How a gauntlet's gateway safe room is reached. */
export type GauntletRoute = BranchesRoute | SpineRoute;

/**
 * What every gauntlet carries, whichever boss guards it.
 */
interface GauntletDefCommon {
  route: GauntletRoute;
  /**
   * Seats the defense quest's room as a mandatory choke on this gauntlet: on
   * the sealed stem out of the previous boss room, on the approach between the
   * gateway safe room and this gauntlet's own boss, or, on a spine route, as a
   * room of the chain. Which of the first two is drawn per map; a gauntlet with
   * a flooded `approach` only ever takes the stem.
   */
  questChoke?: boolean;
}

/**
 * One forced-progression unit on a floor: a route converging on a single
 * gateway safe room whose only onward exit is the named boss's room. Nothing
 * beyond that boss room is reachable without clearing it.
 *
 * `bossType` pairs with the same-index `bossRooms` entry. Only the Kraken's
 * gauntlet has a flooded corridor from its gateway safe room to the boss room
 * door, since its fight is staged from that water; every other boss is
 * reached by an ordinary corridor.
 */
export type GauntletDef =
  | (GauntletDefCommon & {
      bossType: 'kraken';
      approach: FloodedApproachSpec;
    })
  | (GauntletDefCommon & {
      bossType: Exclude<GauntletBossType, 'kraken'>;
      approach?: never;
    });

/**
 * The band the defense quest's Fuzzy Nightmare wave rolls its level in on this floor.
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
   * The minimum count of extra safe rooms the free region must carry, beyond its
   * gateway safe rooms. Meaningful only on a floor with {@link outskirtsSafeRoomHops}
   * set, where it is the floor the hop rule's own promotion pass is held to —
   * that pass may seat more than this to satisfy the rule, never fewer.
   */
  scatterSafeRooms?: number;
  /**
   * Spaces the free region's own safe rooms by room hops rather than by plain
   * distance: every one of them, the last gateway's exit safe room included,
   * keeps its nearest other safe room between 4 and 9 hops away. Stated by the
   * floor rather than inferred: a free region small enough to be mostly
   * stairwell rooms has no room to space safe rooms that far apart.
   */
  outskirtsSafeRoomHops?: boolean;
  /**
   * Ordinary rooms the free region past the last gauntlet grows to. Absent
   * fills the map, as a floor whose free region is a long hunt for the stairs
   * wants; a floor that wants only a short stretch past its last boss caps it.
   */
  freeRegionRooms?: number;
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
  readonly bossType: StandaloneMobKind;
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

/**
 * What an environment's loading screen says while the player waits. Every
 * environment declares its own, so the screen is never bare of advice.
 */
export interface ArrivalLoadingScreen {
  readonly tips: readonly [string, ...string[]];
  /** The small line over the title, for an environment that is not a numbered floor. */
  readonly kicker?: string;
}

/** Data-only description of a dungeon level. No game-logic dependencies. */
export interface LevelDef {
  id: LevelId;
  name: string;
  /** Dungeon depth, 1-based. Drives depth-scaled rewards such as smashed-prop coins. */
  floorNumber: number;
  /** Default background music for this level, and what music resumes after boss fights/quests. */
  music: MusicTrackId;
  /** Side length of the square tile grid this floor is generated on. */
  mapSize: number;
  /**
   * The sprite groups (`src/core/spriteAssets/assetGroups.ts`) this floor's *base* content
   * needs: `roomMobs`, `hallwayMobs`, `extraSpawns`, `campSpawns`, `bossRooms`
   * and the ground/wall theme. Does NOT include creatures introduced by
   * bounty/quest/companion systems that never touch this def — those are
   * declared separately in `SYSTEM_ASSET_REQUIREMENTS`
   * (`src/core/spriteAssets/systemAssetRequirements.ts`) and unioned in by floor id at
   * `verify:assets` time. See that file's header for why: a floor's `LevelDef`
   * does not list everything that can appear on it.
   */
  spriteGroups: readonly AssetGroup[];
  /**
   * Groups drawn only inside this floor's buildings, never on the floor
   * itself. They are left out of the floor's arrival, so the floor does not
   * hold them in memory, and every `BuildingInteriorScene` on it asks for them
   * before its loading card goes up, so the card does not lift until they are
   * painted. A group listed here must not also be in `spriteGroups`; that would
   * paint it on arrival anyway, and `verify:assets` fails on it.
   */
  interiorSpriteGroups: readonly AssetGroup[];
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
  nextLevelId?: LevelId;
  /**
   * Diminishing returns on XP earned here — kills, bosses and quest rewards
   * alike — so an early floor can't be farmed into trivialising the ones below
   * it. Absent means uncapped. Applied per level bought (`Player.gainXp`), so a
   * large award cannot carry a crawler past a tier at full value.
   */
  xpDiminishingTiers?: XpDiminishingTier[];
  /**
   * How long Nightmare lets the party spend on this floor, in frames at 60fps.
   * Having it is what makes a floor timed. The time on the floor is counted on
   * every difficulty, but only Nightmare holds it to this limit: when it runs
   * out, Caroline ends the party and the floor starts over. Absent means the
   * floor is untimed on every difficulty.
   */
  nightmareTimeLimitFrames?: number;
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
   * What the loading screen says while this floor's painted art, its figures
   * and the first screenful of ground are prepared. Every floor arrives behind
   * one, so required: a floor without tips does not typecheck. Shown only when
   * the arrival actually owes that work — walking out of a building usually
   * does not. Building interiors on this floor show the same tips.
   */
  arrivalLoadingScreen: ArrivalLoadingScreen;
  /**
   * Which materials this floor's generic walls and floors are drawn in.
   *
   * Two floors generated by the same `DungeonGenerator` carry the same five tile
   * types, so this is the only thing that makes them look different — see
   * `src/map/dungeon/floorTheme.ts`. Absent on an overworld level, which has its
   * own palette and never reaches the dungeon renderer.
   */
  groundTheme?: DungeonFloorThemeId;
  /**
   * Whether this level has a spider lab room with the Grotesque Spider quest.
   * The lab hangs off a spine route, so a floor with one needs one.
   */
  hasSpiderLab?: boolean;
  /**
   * Level band the defense quest's Fuzzy Nightmare wave rolls in on this floor. Absent
   * means the wave spawns at base stats, which is right only for a floor where
   * the encounter is optional side content.
   */
  defendQuestWave?: DefendQuestWaveDef;
  /**
   * How many grates the nursery carries and how hard its wave presses. Absent
   * means `BASE_DEFEND_QUEST_INTENSITY`.
   */
  defendQuestIntensity?: DefendQuestIntensity;
  /** Whether mobs on this floor may roll the rare world gear drops no one creature carries. */
  worldGearDrops?: boolean;
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
   * Forces the order a floor's bosses are met in. When present the generator replaces free
   * room placement with the declared gauntlets — spawn at map centre, branch
   * chains, gateway safe room, gateway boss room, repeated per gauntlet — and
   * only then generates a free-roam region. Absent means the classic free-roam
   * layout from the first room.
   */
  progression?: ProgressionDef;
}
