import { type GameMap } from '../map/GameMap';
import { type Mob } from '../creatures/Mob';
import {
  START_ROOM_HALLWAY_SPAWN_MARGIN_TILES,
  type TreasureRoomData,
} from '../map/DungeonGenerator';
import { campSiteKey } from '../map/overworld/camps';
import { BallOfSwine } from '../creatures/BallOfSwine';
import { clamp, randomIntFrom } from '../utils';
import { spawnMob, type SpawnContext } from './spawnFunnel';
import { floorEncounter } from './encounters';
import { type StandaloneMobKind } from './mobKinds';
import { hasRoomToMove } from '../map/findWalkableTile';
import { TILE_SIZE } from '../core/constants';
import {
  applySpawnDifficulty,
  type DifficultyProfile,
} from '../core/difficulty/difficultyProfiles';
import type { EscortSpawnRule, MobLevelRange, MobSpawnRule, LevelDef } from './types';

/** Maximum attempts to find a walkable spawn position. */
const MAX_SPAWN_ATTEMPTS = 20;

/** Extra mobs spawned in treasure rooms for difficulty. */
const TREASURE_ROOM_EXTRA_MOBS = 3;

/** Treasure room mob level boost. */
const TREASURE_ROOM_LEVEL_BOOST = 1;

/** Maximum mob level cap. */
export const MAX_MOB_LEVEL = 20;

/**
 * Hard ceiling on the mobs one room may spawn: the host rule's roll, its
 * region bonus, any over-level reinforcement and its escorts together.
 *
 * The bonus, the reinforcement and the roll are all ranges, so their worst
 * cases compound into a wall of bodies in a doorway rather than a fight unless
 * something bounds them. Seven is the fewest that still seats a floor-2 goblin
 * room's own melee floor beside its whole back line (both archers and both
 * bombers), so the bombers join a room rather than displacing its goblins.
 */
export const MAX_ROOM_SPAWN_COUNT = 7;

/** Room boundary inset (1 tile from wall). */
const ROOM_BOUNDARY_INSET = 1;

/** Room max bounds offset. */
const ROOM_BOUNDS_OFFSET = 3;

/**
 * Distance back from a room's far edge to its last interior tile: one step for
 * the exclusive edge itself, one more for the wall standing on it.
 */
const ROOM_FAR_EDGE_INSET = 2;

/** An inclusive rectangle of candidate spawn tiles inside a room's walls. */
export interface SpawnBounds {
  minTX: number;
  minTY: number;
  maxTX: number;
  maxTY: number;
}

/**
 * A tile within `bounds` a mob can be dropped on, or null when the room has none.
 *
 * Run twice: first demanding somewhere the occupant can actually operate, then
 * accepting any walkable tile at all. A tile can pass `isWalkable` and still be
 * a one-tile pocket between two props, which spawns a mob that can only shuffle
 * on the spot — but a room that has nothing better is still owed its encounter,
 * so a cramped spawn beats a missing one.
 */
export function findWalkableSpawnTile(
  map: GameMap,
  bounds: SpawnBounds,
  random: () => number,
): { x: number; y: number } | null {
  const roomy = probeSpawnTile(
    map,
    bounds,
    (x, y) => map.isMobSpawnTile(x, y) && hasRoomToMove(map, x, y),
    random,
  );
  if (roomy !== null) return roomy;
  return probeSpawnTile(map, bounds, (x, y) => map.isMobSpawnTile(x, y), random);
}

/**
 * The tiles a room spawn point's occupants may be dropped on: its rectangle,
 * inset from the walls. `x`/`y` are the room's centre tile.
 */
export function roomSpawnBounds(room: {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}): SpawnBounds {
  const minTX = room.x - Math.floor(room.w / 2) + ROOM_BOUNDARY_INSET;
  const minTY = room.y - Math.floor(room.h / 2) + ROOM_BOUNDARY_INSET;
  return {
    minTX,
    minTY,
    maxTX: minTX + room.w - ROOM_BOUNDS_OFFSET,
    maxTY: minTY + room.h - ROOM_BOUNDS_OFFSET,
  };
}

/**
 * Random probes come first so mobs still scatter through the room. The
 * exhaustive scan behind them exists because the old fallback was the room
 * centre chosen sight-unseen — which is exactly where a treasure chest sits, so
 * an unlucky room reliably spawned its guards inside the chest.
 */
function probeSpawnTile(
  map: GameMap,
  bounds: SpawnBounds,
  isUsable: (x: number, y: number) => boolean,
  random: () => number,
): { x: number; y: number } | null {
  const { minTX, minTY, maxTX, maxTY } = bounds;
  for (let attempt = 0; attempt < MAX_SPAWN_ATTEMPTS; attempt++) {
    const cx = randomIntFrom(random, minTX, maxTX);
    const cy = randomIntFrom(random, minTY, maxTY);
    if (isUsable(cx, cy)) return { x: cx, y: cy };
  }
  for (let cy = minTY; cy <= maxTY; cy++) {
    for (let cx = minTX; cx <= maxTX; cx++) {
      if (isUsable(cx, cy)) return { x: cx, y: cy };
    }
  }
  return null;
}

/** Pick a rule from a weighted list. Weights need not sum to 1. */
export function pickRule(rules: MobSpawnRule[], random: () => number): MobSpawnRule {
  const total = rules.reduce((sum, r) => sum + r.chance, 0);
  let roll = random() * total;
  for (const rule of rules) {
    roll -= rule.chance;
    if (roll <= 0) return rule;
  }
  return rules[rules.length - 1];
}

/** The stronger of the two crawlers, which is what every level below keys off. */
export function partyLevelOf(humanLevel: number, catLevel: number): number {
  return Math.max(humanLevel, catLevel);
}

/**
 * The level one spawn rolls at: somewhere between what the party has earned and
 * the top of the rule's own band.
 *
 * The band is never left. Its floor keeps a first encounter from being trivial
 * for an over-levelled party's *first* visit; its ceiling is what keeps each
 * floor's identity, so descending stays the way to find real danger and a
 * revisited floor 1 can bite without becoming floor 2.
 *
 * Takes the band alone, so a weighted `MobSpawnRule`, a camp's `CampSpawnRule`,
 * an `ExtraSpawnRule` and a `BossRoomRule` can all be levelled by it.
 */
export function resolveSpawnLevel(
  band: MobLevelRange,
  partyLevel: number,
  profile: DifficultyProfile,
  random: () => number,
): number {
  const min = band.minLevel ?? 1;
  const max = band.maxLevel ?? min;
  return randomIntFrom(random, earnedLevelFloor(band, partyLevel, profile), max);
}

/**
 * The bottom of the range {@link resolveSpawnLevel} rolls in: the party-relative
 * point, held inside the band.
 *
 * Split out so `scripts/verify-difficulty.ts` can assert the one guarantee the
 * roll itself hides — that the *floor* is always under what the party has
 * earned, which is what makes levelling up feel like it bought something.
 *
 * The ratio is `profile.ambientLevelRatio` rather than a flat constant so the
 * difficulty toggle can move it — deliberately under 1 on every profile.
 * Matching the party exactly would erase the reward for getting stronger, while
 * ignoring the party entirely is what made a floor revisited later a walk.
 * Under 1, an on-schedule party always out-levels what it meets.
 */
export function earnedLevelFloor(
  band: MobLevelRange,
  partyLevel: number,
  profile: DifficultyProfile,
): number {
  const min = band.minLevel ?? 1;
  const max = band.maxLevel ?? min;
  return clamp(earnedLevel(partyLevel, profile), min, max);
}

/** The ambient level a party has earned before any band holds it: its level times the profile's ratio. */
function earnedLevel(partyLevel: number, profile: DifficultyProfile): number {
  return Math.round(partyLevel * profile.ambientLevelRatio);
}

/**
 * An ambient band slid up to meet a party that has out-levelled it, on a floor
 * that authors `ambientTracking`; the band unchanged anywhere else.
 *
 * The slide is how far the party's earned level, less the floor's
 * `levelsBehind`, has passed the band's top, so every roll lands a fixed step
 * under the earned level — an over-levelled party meets what an on-schedule one
 * meets at the band's top, never a spread above it. A party whose earned level
 * is still inside the band meets it as authored. The slide stops at the floor's
 * `maxLevel`.
 *
 * Without this a band's ceiling pinned a floor's mobs while the party kept
 * growing, and the whole floor fell further behind with every level it gave.
 */
export function partyTrackedBand(
  band: MobLevelRange,
  def: Pick<LevelDef, 'ambientTracking'>,
  partyLevel: number,
  profile: DifficultyProfile,
): MobLevelRange {
  const tracking = def.ambientTracking;
  if (tracking === undefined) return band;
  const min = band.minLevel ?? 1;
  const max = band.maxLevel ?? min;
  const headroom = Math.max(0, Math.min(tracking.maxLevel, MAX_MOB_LEVEL) - max);
  const trackedLevel = earnedLevel(partyLevel, profile) - tracking.levelsBehind;
  const slide = clamp(trackedLevel - max, 0, headroom);
  if (slide === 0) return band;
  return { minLevel: min + slide, maxLevel: max + slide };
}

/**
 * The level one ambient spawn rolls at on `def`: {@link resolveSpawnLevel} over
 * the band as {@link partyTrackedBand} moves it for this party.
 */
export function resolveAmbientLevel(
  band: MobLevelRange,
  def: Pick<LevelDef, 'ambientTracking'>,
  partyLevel: number,
  profile: DifficultyProfile,
  random: () => number,
): number {
  return resolveSpawnLevel(
    partyTrackedBand(band, def, partyLevel, profile),
    partyLevel,
    profile,
    random,
  );
}

/**
 * A spawn rule's band shifted up by its progression region's level bonus, held
 * under {@link MAX_MOB_LEVEL}.
 *
 * Both ends move together so the band keeps its width: a region bonus is meant
 * to say "this stretch of the floor is a level harder", not to widen the spread
 * of what a room can contain. Exported so `scripts/verify-difficulty.ts` can
 * assert the cap against the real arithmetic.
 */
export function regionLevelBand(band: MobLevelRange, bonus: number): MobLevelRange {
  if (bonus <= 0) return band;
  const min = band.minLevel ?? 1;
  const max = band.maxLevel ?? min;
  return {
    minLevel: Math.min(min + bonus, MAX_MOB_LEVEL),
    maxLevel: Math.min(max + bonus, MAX_MOB_LEVEL),
  };
}

/**
 * Every progression region a floor's rooms can be seeded in, in order: one per
 * gauntlet plus the free region past the last, or the single region of a floor
 * that authors no progression.
 */
export function progressionRegions(def: LevelDef): number[] {
  const count = Math.max(
    1,
    def.progression?.regionSpawnBonus?.length ?? 0,
    def.progression?.regionLevelBonus?.length ?? 0,
  );
  return Array.from({ length: count }, (_, region) => region);
}

/** The `regionLevelBonus` earned for a region, or none if the floor authors no bonuses at all. */
export function regionLevelBonusFor(def: LevelDef, region: number): number {
  return (def.progression?.regionLevelBonus ?? [])[region] ?? 0;
}

/**
 * Ceiling on the search {@link recommendedPartyLevelFor} runs.
 *
 * No band can top {@link MAX_MOB_LEVEL}, and even the gentlest shipped ambient
 * ratio reaches that ceiling well inside this many party levels — so reaching
 * the cap means the ratio itself is degenerate (zero or negative), not that the
 * answer is genuinely this high.
 */
const MAX_RECOMMENDED_PARTY_LEVEL = 60;

/**
 * The highest level any *ambient* spawn on a floor can reach: room rules and
 * their escorts, hallway rules, and camp rosters.
 *
 * Boss rooms and `extraSpawns` are deliberately excluded. Those are authored
 * spikes standing behind their own doors — a floor is not "too strong for you"
 * because its boss out-levels you, it is too strong when the rooms between the
 * stairs and that door do.
 *
 * Bands are read as authored, without any `regionLevelBonus`. The advice is
 * about *arriving* on a floor, and a region bonus is earned by clearing that
 * floor's own gauntlets — folding it in would greet a crawler leaving the
 * tutorial with the level floor 1 ends at rather than the one it opens with.
 */
function ambientBandCeiling(def: LevelDef): number {
  let ceiling = 1;
  const consider = (band: MobLevelRange): void => {
    ceiling = Math.max(ceiling, band.maxLevel ?? band.minLevel ?? 1);
  };
  for (const rule of def.roomMobs) {
    consider(rule);
    for (const escort of rule.escorts ?? []) consider(escort);
  }
  for (const rule of def.hallwayMobs) consider(rule);
  for (const roster of Object.values(def.campSpawns ?? {})) {
    for (const rule of roster) consider(rule);
  }
  return ceiling;
}

/**
 * The party level a floor is worth arriving at: the first level at which
 * {@link earnedLevelFloor} reaches the floor's ambient band ceiling — the point
 * where the floor will show its strongest ordinary self and the party can take
 * it.
 *
 * Computed from the floor's own bands and the live ambient ratio rather than
 * stored on the `LevelDef`, so retuning a band — or moving the difficulty
 * toggle — retunes the advice with no second copy of the number to forget.
 *
 * This is the *floor* of comfortable, not a requirement: descending under it is
 * a legal choice the stairwell menu warns about and never blocks.
 */
export function recommendedPartyLevelFor(def: LevelDef, profile: DifficultyProfile): number {
  if (def.recommendedLevelOverride !== undefined) return def.recommendedLevelOverride;
  const ceiling = ambientBandCeiling(def);
  for (let level = 1; level < MAX_RECOMMENDED_PARTY_LEVEL; level++) {
    if (earnedLevel(level, profile) >= ceiling) return level;
  }
  return MAX_RECOMMENDED_PARTY_LEVEL;
}

/**
 * A boss's level: the party-relative point in its band, not a roll around it.
 *
 * Unrolled deliberately — a boss is an authored encounter, and two runs meeting
 * the same boss at the same party level and difficulty should meet the same
 * fight. Higher ratio than the ambient one on every profile, because a boss is
 * meant to be the fight of its stretch of floor, not another room.
 */
export function resolveBossLevel(
  band: MobLevelRange,
  partyLevel: number,
  profile: DifficultyProfile,
): number {
  const min = band.minLevel ?? 1;
  const max = band.maxLevel ?? min;
  return clamp(Math.round(partyLevel * profile.bossLevelRatio), min, max);
}

/**
 * The escort mobs one room or hallway point actually gets: every eligible
 * escort rule, expanded to one entry per body so the caller can simply count
 * them. A hallway point has no region (`null`), so an escort withheld until a
 * region is never fielded in a hallway: it could otherwise turn up ahead of
 * the boss it waits behind.
 */
function rollEscorts(
  rule: MobSpawnRule,
  region: number | null,
  random: () => number,
): EscortSpawnRule[] {
  const rolled: EscortSpawnRule[] = [];
  for (const escort of rule.escorts ?? []) {
    if (escort.minRegion !== undefined && (region === null || region < escort.minRegion)) continue;
    const count = randomIntFrom(random, escort.minCount ?? 1, escort.maxCount ?? 1);
    for (let i = 0; i < count; i++) rolled.push(escort);
  }
  // Truncated here rather than only reserved against, because the cap is stated
  // as a hard guarantee: reserving alone bounds the *host* rule while leaving
  // the escort loop free to spawn as many bodies as it was authored with, so a
  // generous future roster would breach the ceiling with nothing to stop it.
  rolled.length = Math.min(rolled.length, MAX_ROOM_SPAWN_COUNT);
  return rolled;
}

/** Resolve an ExtraSpawnRule origin string to a tile coordinate, or null if the landmark doesn't exist. */
function resolveOrigin(
  origin: string,
  map: GameMap,
  def: LevelDef,
): { x: number; y: number } | null {
  if (origin === 'mapCenter') {
    const half = Math.floor(def.mapSize / 2);
    return { x: half, y: half };
  }
  const bossMatch = /^bossRoom:(\d+)$/.exec(origin);
  if (bossMatch) {
    const idx = parseInt(bossMatch[1], 10);
    if (idx < 0 || idx >= map.bossRooms.length) return null;
    return map.bossRooms[idx].centre;
  }
  const arenaMatch = /^arena:(\d+)$/.exec(origin);
  if (arenaMatch) {
    const idx = parseInt(arenaMatch[1], 10);
    if (idx < 0 || idx >= map.arenaExteriors.length) return null;
    return map.arenaExteriors[idx].centre;
  }
  return null;
}

/**
 * Post-spawn setup callbacks for mobs that need special initialization
 * beyond what `spawnMob` provides (e.g. BallOfSwine needs arena binding).
 */
const SPAWN_SETUP: Partial<
  Record<string, (mob: Mob, map: GameMap, origin: { x: number; y: number }) => void>
> = {
  setupBallOfSwine(mob, map, origin) {
    if (mob instanceof BallOfSwine) {
      mob.setArena(origin.x, origin.y);
      mob.setMap(map);
    }
  },
};

/**
 * Spawn mobs described by `def.extraSpawns` — position-relative spawns
 * that are tied to map landmarks rather than generic spawn points.
 */
export function spawnExtraMobs(
  def: LevelDef,
  map: GameMap,
  partyLevel: number,
  profile: DifficultyProfile,
  random: () => number,
): Mob[] {
  const mobs: Mob[] = [];
  if (!def.extraSpawns) return mobs;
  const context: SpawnContext = { encounter: floorEncounter(def.floorNumber, 'landmark'), random };

  for (const rule of def.extraSpawns) {
    const origin = resolveOrigin(rule.origin, map, def);
    if (!origin) continue;

    for (const [dx, dy] of rule.offsets) {
      const mob = spawnMob(rule.type, { x: origin.x + dx, y: origin.y + dy }, map, context);
      mob.applyMobLevel(
        mob.isBoss
          ? resolveBossLevel(rule, partyLevel, profile)
          : resolveAmbientLevel(rule, def, partyLevel, profile, random),
        def.levelledCurve,
      );
      applySpawnDifficulty(mob, profile);
      mob.allowWorldGearDrop = def.worldGearDrops === true;
      if (rule.setup) {
        SPAWN_SETUP[rule.setup]?.(mob, map, origin);
      }
      mobs.push(mob);
    }
  }

  return mobs;
}

/** Tiles a camp resident may stray from its camp before it turns back. */
const CAMP_LEASH_RADIUS_TILES = 14;

/**
 * How many spots are sampled inside a camp before one mob is given up on.
 *
 * A camp's disc is mostly cleared ground but its centre is a fire and its ring
 * is tents or boulders, so a fair number of draws land on something solid.
 */
const CAMP_SPAWN_ATTEMPTS = 40;

/**
 * Populates each camp on the map from its kind's roster.
 *
 * Driven off `map.camps` and `def.campSpawns`, so there is no index coupling
 * between the generator and the level definition — a map that sited only one of
 * the two camps populates only that one. A level with no `campSpawns` (every
 * floor but 3) returns immediately.
 *
 * Residents are leashed to their camp. `BountySystem` is the only other writer
 * of `homePoint`/`leashRadiusTiles` and it writes them on floor 3 only, so this
 * remains provably invisible to the goblins and troglodytes on floors 1 and 2.
 *
 * A camp in `clearedCamps` is skipped outright: its ground and props are part
 * of the map and still stand, but nobody lives there any more.
 */
function spawnCampResidents(
  def: LevelDef,
  map: GameMap,
  partyLevel: number,
  profile: DifficultyProfile,
  clearedCamps: ReadonlySet<string>,
  random: () => number,
): Mob[] {
  const mobs: Mob[] = [];
  const rosters = def.campSpawns;
  if (rosters === undefined) return mobs;
  const context: SpawnContext = { encounter: floorEncounter(def.floorNumber, 'camp'), random };

  for (const camp of map.camps) {
    const roster = rosters[camp.kind];
    if (roster === undefined || roster.length === 0) continue;
    const key = campSiteKey(camp);
    if (clearedCamps.has(key)) continue;
    for (const rule of roster) {
      const count = randomIntFrom(random, rule.minCount ?? 1, rule.maxCount ?? 1);
      for (let spawned = 0; spawned < count; spawned++) {
        const tile = findWalkableTileInCamp(map, camp.centre, camp.radiusTiles, random);
        if (tile === null) continue;
        const mob = spawnMob(rule.type, tile, map, context);
        mob.applyMobLevel(
          resolveAmbientLevel(rule, def, partyLevel, profile, random),
          def.levelledCurve,
        );
        applySpawnDifficulty(mob, profile);
        mob.allowWorldGearDrop = def.worldGearDrops === true;
        // Its own spawn tile, **not** the camp's centre. The centre is a
        // `CAMPFIRE` — solid — and `followTargetAStar` would be asked to path to
        // a tile nothing can stand on, which is a resident that never walks home
        // rather than one that walks home slowly. A spawn tile is walkable by
        // construction and is inside the camp, which is all the leash needs.
        mob.homePoint = { x: mob.x, y: mob.y };
        mob.leashRadiusTiles = CAMP_LEASH_RADIUS_TILES;
        mob.campKey = key;
        mobs.push(mob);
      }
    }
  }
  return mobs;
}

/** A walkable tile inside a camp's disc, or null when the disc is full. */
function findWalkableTileInCamp(
  map: GameMap,
  centre: { x: number; y: number },
  radiusTiles: number,
  random: () => number,
): { x: number; y: number } | null {
  for (let attempt = 0; attempt < CAMP_SPAWN_ATTEMPTS; attempt++) {
    const angle = random() * Math.PI * 2;
    // Square-rooted so the draws are uniform over the disc's *area* rather than
    // piling up at its centre, which is where the fire is.
    const reach = Math.sqrt(random()) * radiusTiles;
    const tx = Math.round(centre.x + Math.cos(angle) * reach);
    const ty = Math.round(centre.y + Math.sin(angle) * reach);
    if (map.isMobSpawnTile(tx, ty)) return { x: tx, y: ty };
  }
  return null;
}

/**
 * The extra bodies a room of `band` gains on a floor with an
 * `overLevelReinforcement`: one for every `levelsPerBody` levels the party's
 * earned level has passed the band's top, never more than `maxBodies`.
 *
 * One of two answers to a party that has out-levelled a floor, the other being
 * {@link partyTrackedBand}. This one leaves every mob at its authored level, so
 * every one-on-one fight stays exactly as authored, while the room still costs
 * more: its cost grows with the number of bodies attacking while the party
 * works through them.
 */
export function overLevelReinforcementBodies(
  def: Pick<LevelDef, 'overLevelReinforcement'>,
  band: MobLevelRange,
  partyLevel: number,
  profile: DifficultyProfile,
): number {
  const reinforcement = def.overLevelReinforcement;
  if (reinforcement === undefined) return 0;
  const bandTop = band.maxLevel ?? band.minLevel ?? 1;
  const levelsAhead = earnedLevel(partyLevel, profile) - bandTop;
  if (levelsAhead <= 0) return 0;
  return Math.min(reinforcement.maxBodies, Math.floor(levelsAhead / reinforcement.levelsPerBody));
}

/** How many of a room's host rule spawn, and which escorts join them. */
interface RoomPopulation {
  readonly hostCount: number;
  readonly escorts: readonly EscortSpawnRule[];
}

/**
 * Rolls how many mobs one room spawns under `rule` in `region`: the host rule's
 * roll plus its region's spawn bonus and any over-level reinforcement, with the
 * escorts' places reserved first and the whole room held under
 * {@link MAX_ROOM_SPAWN_COUNT}.
 *
 * Exported so `scripts/verify-difficulty.ts` reads the rooms the spawner
 * really fills rather than a copy of its arithmetic.
 */
export function rollRoomPopulation(
  def: LevelDef,
  rule: MobSpawnRule,
  region: number,
  partyLevel: number,
  profile: DifficultyProfile,
  random: () => number,
): RoomPopulation {
  // Escorts are rolled first and their places *reserved*, so a room that
  // would otherwise fill its whole allowance with the host rule still has
  // room for the archer that makes it a mixed group.
  const escorts = rollEscorts(rule, region, random);
  const regionSpawnBonus = (def.progression?.regionSpawnBonus ?? [])[region] ?? 0;
  const hostBand = regionLevelBand(rule, regionLevelBonusFor(def, region));
  const reinforcement = overLevelReinforcementBodies(def, hostBand, partyLevel, profile);
  const rolled = randomIntFrom(random, rule.minCount ?? 1, rule.maxCount ?? 1);
  const hostCount = Math.max(
    0,
    Math.min(MAX_ROOM_SPAWN_COUNT - escorts.length, rolled + regionSpawnBonus + reinforcement),
  );
  return { hostCount, escorts };
}

/** How far from a hallway spawn point its escorts may be dropped, in tiles each way. */
const HALLWAY_ESCORT_SPREAD_TILES = 2;
/** Offset from a tile's origin to its centre, as a share of a tile. */
const TILE_CENTRE_SHARE = 0.5;

/**
 * A tile near the hallway spawn point (`x`, `y`) for one of its escorts, held
 * to the point's own rules: in the point's hallway segment and in a straight
 * walk of it, never in a room (a boss room, the defence quest's room, a safe
 * room) or the start room's margin, and off the tiles a stealth gate keeps
 * clear. Null when there is none.
 */
function findHallwayEscortTile(
  map: GameMap,
  x: number,
  y: number,
  random: () => number,
): { x: number; y: number } | null {
  const bounds: SpawnBounds = {
    minTX: x - HALLWAY_ESCORT_SPREAD_TILES,
    minTY: y - HALLWAY_ESCORT_SPREAD_TILES,
    maxTX: x + HALLWAY_ESCORT_SPREAD_TILES,
    maxTY: y + HALLWAY_ESCORT_SPREAD_TILES,
  };
  const tileCentre = (tile: number): number => (tile + TILE_CENTRE_SHARE) * TILE_SIZE;
  const segment = map.regionAt(x, y);
  if (map.regionKind(segment) !== 'hallway') return null;
  // A map with hallway segments has rooms, and the first placed is the start room.
  const [firstRoom] = map.roomBounds;
  const start = map.progressionLayout?.startRoom ?? firstRoom;
  const inStartMargin = (tileX: number, tileY: number): boolean =>
    tileX >= start.x - START_ROOM_HALLWAY_SPAWN_MARGIN_TILES &&
    tileX < start.x + start.w + START_ROOM_HALLWAY_SPAWN_MARGIN_TILES &&
    tileY >= start.y - START_ROOM_HALLWAY_SPAWN_MARGIN_TILES &&
    tileY < start.y + start.h + START_ROOM_HALLWAY_SPAWN_MARGIN_TILES;
  const keepClear = map.stealthGateRoom?.keepClearTiles ?? [];
  return probeSpawnTile(
    map,
    bounds,
    (tileX, tileY) =>
      map.isMobSpawnTile(tileX, tileY) &&
      map.regionAt(tileX, tileY) === segment &&
      !inStartMargin(tileX, tileY) &&
      !keepClear.some((tile) => tile.x === tileX && tile.y === tileY) &&
      map.hasWalkableLine(tileCentre(x), tileCentre(y), tileCentre(tileX), tileCentre(tileY)),
    random,
  );
}

/**
 * Instantiate all mobs for a level. Room spawn points draw from
 * `def.roomMobs`; hallway points draw from `def.hallwayMobs`. Both honour a
 * rule's `escorts`.
 * If `def.bossRoom` is set and the map has a boss room centre, spawns the boss there.
 * Camps named in `clearedCamps` (see `TownMemory.clearedCamps`) are left empty.
 * Every roll — which rule, how many, where — draws from `random`.
 */
export function spawnForLevel(
  def: LevelDef,
  map: GameMap,
  partyLevel: number,
  profile: DifficultyProfile,
  clearedCamps: ReadonlySet<string>,
  random: () => number,
): Mob[] {
  const mobs: Mob[] = [];

  if (def.roomMobs.length > 0) {
    const roomContext: SpawnContext = {
      encounter: floorEncounter(def.floorNumber, 'room'),
      random,
    };
    for (const { x, y, w, h, region } of map.mobSpawnPoints) {
      const levelBonus = regionLevelBonusFor(def, region);
      const rule = pickRule(def.roomMobs, random);
      const { hostCount: count, escorts } = rollRoomPopulation(
        def,
        rule,
        region,
        partyLevel,
        profile,
        random,
      );
      const bounds = roomSpawnBounds({ x, y, w, h });
      const spawnInRoom = (band: MobLevelRange, kind: StandaloneMobKind): void => {
        const tile = findWalkableSpawnTile(map, bounds, random);
        if (tile === null) return;
        const mob = spawnMob(kind, tile, map, roomContext);
        mob.applyMobLevel(
          resolveAmbientLevel(regionLevelBand(band, levelBonus), def, partyLevel, profile, random),
          def.levelledCurve,
        );
        applySpawnDifficulty(mob, profile);
        mob.allowWorldGearDrop = def.worldGearDrops === true;
        mobs.push(mob);
      };
      for (let i = 0; i < count; i++) spawnInRoom(rule, rule.type);
      for (const escort of escorts) spawnInRoom(escort, escort.type);
    }
  }

  if (def.hallwayMobs.length > 0) {
    const hallwayContext: SpawnContext = {
      encounter: floorEncounter(def.floorNumber, 'hallway'),
      random,
    };
    for (const { x, y } of map.hallwaySpawnPoints) {
      const rule = pickRule(def.hallwayMobs, random);
      const spawnAt = (
        band: MobLevelRange,
        kind: StandaloneMobKind,
        tileX: number,
        tileY: number,
      ): void => {
        const mob = spawnMob(kind, { x: tileX, y: tileY }, map, hallwayContext);
        mob.applyMobLevel(
          resolveAmbientLevel(band, def, partyLevel, profile, random),
          def.levelledCurve,
        );
        applySpawnDifficulty(mob, profile);
        mob.allowWorldGearDrop = def.worldGearDrops === true;
        mobs.push(mob);
      };
      spawnAt(rule, rule.type, x, y);
      const escorts = rollEscorts(rule, null, random);
      if (escorts.length === 0) continue;
      for (const escort of escorts) {
        const tile = findHallwayEscortTile(map, x, y, random);
        if (tile !== null) spawnAt(escort, escort.type, tile.x, tile.y);
      }
    }
  }

  mobs.push(...spawnCampResidents(def, map, partyLevel, profile, clearedCamps, random));

  const bossRooms = def.bossRooms ?? [];
  const bossContext: SpawnContext = {
    encounter: floorEncounter(def.floorNumber, 'boss-room'),
    random,
  };
  for (let i = 0; i < bossRooms.length; i++) {
    const bossEntry = bossRooms[i];
    if (i >= map.bossRooms.length) continue;
    const brData = map.bossRooms[i];
    const boss = spawnMob(bossEntry.type, brData.centre, map, bossContext);
    boss.applyMobLevel(resolveBossLevel(bossEntry, partyLevel, profile), def.levelledCurve);
    applySpawnDifficulty(boss, profile);
    boss.allowWorldGearDrop = def.worldGearDrops === true;
    mobs.push(boss);
  }

  return mobs;
}

/**
 * Spawn extra mobs for rooms that contain a treasure chest.
 * These rooms have slightly more enemies (3 extra) at a higher level to make the chest feel earned.
 */
export function spawnTreasureRoomMobs(
  treasureRooms: TreasureRoomData[],
  def: LevelDef,
  map: GameMap,
  partyLevel: number,
  profile: DifficultyProfile,
  random: () => number,
): Mob[] {
  const mobs: Mob[] = [];
  if (def.roomMobs.length === 0) return mobs;
  const context: SpawnContext = { encounter: floorEncounter(def.floorNumber, 'treasure'), random };

  // Escorts are deliberately not honoured here. A treasure room's guards are a
  // fixed count at the top of their band — a second, additive mechanism on top
  // of that is how a chest ends up behind eleven bodies.
  for (const room of treasureRooms) {
    const levelBonus = regionLevelBonusFor(def, room.region);
    const { x, y, w, h } = room.bounds;
    const minTX = x + ROOM_BOUNDARY_INSET;
    const minTY = y + ROOM_BOUNDARY_INSET;
    const maxTX = x + w - ROOM_FAR_EDGE_INSET;
    const maxTY = y + h - ROOM_FAR_EDGE_INSET;

    for (let i = 0; i < TREASURE_ROOM_EXTRA_MOBS; i++) {
      const rule = pickRule(def.roomMobs, random);
      const tile = findWalkableSpawnTile(map, { minTX, minTY, maxTX, maxTY }, random);
      if (tile === null) continue;
      const mob = spawnMob(rule.type, tile, map, context);
      const band = partyTrackedBand(regionLevelBand(rule, levelBonus), def, partyLevel, profile);
      const maxLevel = band.maxLevel ?? band.minLevel ?? 1;
      mob.applyMobLevel(
        Math.min(maxLevel + TREASURE_ROOM_LEVEL_BOOST, MAX_MOB_LEVEL),
        def.levelledCurve,
      );
      applySpawnDifficulty(mob, profile);
      mob.allowWorldGearDrop = def.worldGearDrops === true;
      mobs.push(mob);
    }
  }

  return mobs;
}
