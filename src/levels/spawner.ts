import { type GameMap } from '../map/GameMap';
import { type Mob } from '../creatures/Mob';
import type { TreasureRoomData } from '../map/DungeonGenerator';
import { Goblin } from '../creatures/Goblin';
import type { GoblinWeapon } from '../sprites/goblinSprite';
import { Llama } from '../creatures/Llama';
import { RockGolem } from '../creatures/RockGolem';
import { RockGolemBoss } from '../creatures/RockGolemBoss';
import { Mantid } from '../creatures/Mantid';
import { SkeletonLord } from '../creatures/SkeletonLord';
import { SkeletonWarrior } from '../creatures/SkeletonWarrior';
import { SkeletonArcher } from '../creatures/SkeletonArcher';
import { MantisCrony } from '../creatures/MantisCrony';
import { Rat } from '../creatures/Rat';
import { TheHoarder } from '../creatures/TheHoarder';
import { Cockroach } from '../creatures/Cockroach';
import { Juicer } from '../creatures/Juicer';
import { Troglodyte } from '../creatures/Troglodyte';
import { Tuskling } from '../creatures/Tuskling';
import { BallOfSwine } from '../creatures/BallOfSwine';
import { SkyFowl } from '../creatures/SkyFowl';
import { KrakarenClone } from '../creatures/KrakarenClone';
import { BrindleGrub } from '../creatures/BrindleGrub';
import { Bugaboo } from '../creatures/Bugaboo';
import { GrotesqueSpider } from '../creatures/GrotesqueSpider';
import { SmallSpider } from '../creatures/SmallSpider';
import { RuinsGhoul } from '../creatures/RuinsGhoul';
import { Krasue } from '../creatures/Krasue';
import { CircusLemur } from '../creatures/CircusLemur';
import { StiltClown } from '../creatures/StiltClown';
import { FatClown } from '../creatures/FatClown';
import { EvilClown } from '../creatures/EvilClown';
import { MoldLion } from '../creatures/MoldLion';
import { TerrorTheClown } from '../creatures/TerrorTheClown';
import { RingmasterGrimaldi } from '../creatures/RingmasterGrimaldi';
import { CityElfCultist } from '../creatures/CityElfCultist';
import { GoblinArcher } from '../creatures/GoblinArcher';
import { clamp, randomInt } from '../utils';
import { hasRoomToMove } from '../map/findWalkableTile';
import { TILE_SIZE } from '../core/constants';
import type { EscortSpawnRule, MobLevelRange, MobSpawnRule, LevelDef } from './types';

type GoblinVariant = { readonly weapon: GoblinWeapon; readonly weight: number };

/** Maximum attempts to find a walkable spawn position. */
const MAX_SPAWN_ATTEMPTS = 20;

/** Extra mobs spawned in treasure rooms for difficulty. */
const TREASURE_ROOM_EXTRA_MOBS = 3;

/** Treasure room mob level boost. */
const TREASURE_ROOM_LEVEL_BOOST = 1;

/** Maximum mob level cap. */
export const MAX_MOB_LEVEL = 20;

/**
 * Hard ceiling on the mobs one room may spawn, after a region bonus is added to
 * the rolled count.
 *
 * The bonus and the roll are both ranges, so their worst cases compound: a room
 * rolling five goblins in the post-Juicer region would otherwise open with
 * seven of them in a doorway, which is a wall of bodies rather than a fight.
 */
export const MAX_ROOM_SPAWN_COUNT = 6;

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
interface SpawnBounds {
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
function findWalkableSpawnTile(map: GameMap, bounds: SpawnBounds): { x: number; y: number } | null {
  const roomy = probeSpawnTile(
    map,
    bounds,
    (x, y) => map.isWalkable(x, y) && hasRoomToMove(map, x, y),
  );
  if (roomy !== null) return roomy;
  return probeSpawnTile(map, bounds, (x, y) => map.isWalkable(x, y));
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
): { x: number; y: number } | null {
  const { minTX, minTY, maxTX, maxTY } = bounds;
  for (let attempt = 0; attempt < MAX_SPAWN_ATTEMPTS; attempt++) {
    const cx = randomInt(minTX, maxTX);
    const cy = randomInt(minTY, maxTY);
    if (isUsable(cx, cy)) return { x: cx, y: cy };
  }
  for (let cy = minTY; cy <= maxTY; cy++) {
    for (let cx = minTX; cx <= maxTX; cx++) {
      if (isUsable(cx, cy)) return { x: cx, y: cy };
    }
  }
  return null;
}

/**
 * How often each archetype turns up.
 *
 * Weighted rather than uniform: a war-hammer brute is the biggest, slowest and
 * most telegraphed of the four, and one in every four goblins being one would
 * make it ordinary. The sword skirmisher is the common grunt.
 */
export const GOBLIN_VARIANTS: readonly GoblinVariant[] = [
  { weapon: 'sword', weight: 4 },
  { weapon: 'axe', weight: 3 },
  { weapon: 'mace', weight: 2 },
  { weapon: 'warhammer', weight: 1 },
];

function pickGoblinWeapon(): GoblinWeapon {
  const total = GOBLIN_VARIANTS.reduce((sum, variant) => sum + variant.weight, 0);
  let roll = Math.random() * total;
  for (const variant of GOBLIN_VARIANTS) {
    roll -= variant.weight;
    if (roll <= 0) return variant.weapon;
  }
  return GOBLIN_VARIANTS[GOBLIN_VARIANTS.length - 1].weapon;
}

/** Pick a rule from a weighted list. Weights need not sum to 1. */
function pickRule(rules: MobSpawnRule[]): MobSpawnRule {
  const total = rules.reduce((sum, r) => sum + r.chance, 0);
  let roll = Math.random() * total;
  for (const rule of rules) {
    roll -= rule.chance;
    if (roll <= 0) return rule;
  }
  return rules[rules.length - 1];
}

/**
 * How much of the party's own level an ordinary mob is levelled toward.
 *
 * Deliberately under 1. Matching the party exactly would erase the reward for
 * getting stronger — every fight would feel identical at level 3 and at level
 * 15 — while ignoring the party entirely is what made a floor revisited later
 * a walk. Under 1, an on-schedule party always out-levels what it meets, and
 * the gap it has earned is what it feels.
 */
const MOB_LEVEL_PARTY_RATIO = 0.7;

/**
 * The same, for bosses. Higher than the ordinary ratio because a boss is meant
 * to be the fight of its stretch of floor, not another room.
 */
const BOSS_LEVEL_PARTY_RATIO = 0.8;

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
export function resolveSpawnLevel(band: MobLevelRange, partyLevel: number): number {
  const min = band.minLevel ?? 1;
  const max = band.maxLevel ?? min;
  return randomInt(earnedLevelFloor(band, partyLevel), max);
}

/**
 * The bottom of the range {@link resolveSpawnLevel} rolls in: the party-relative
 * point, held inside the band.
 *
 * Split out so `scripts/verify-difficulty.ts` can assert the one guarantee the
 * roll itself hides — that the *floor* is always under what the party has
 * earned, which is what makes levelling up feel like it bought something.
 */
export function earnedLevelFloor(band: MobLevelRange, partyLevel: number): number {
  const min = band.minLevel ?? 1;
  const max = band.maxLevel ?? min;
  return clamp(Math.round(partyLevel * MOB_LEVEL_PARTY_RATIO), min, max);
}

/**
 * A boss's level: the party-relative point in its band, not a roll around it.
 *
 * Unrolled deliberately — a boss is an authored encounter, and two runs meeting
 * the same boss at the same party level should meet the same fight.
 */
export function resolveBossLevel(band: MobLevelRange, partyLevel: number): number {
  const min = band.minLevel ?? 1;
  const max = band.maxLevel ?? min;
  return clamp(Math.round(partyLevel * BOSS_LEVEL_PARTY_RATIO), min, max);
}

/** Whichever of the two rules above suits what was actually spawned. */
function levelForMob(mob: Mob, band: MobLevelRange, partyLevel: number): number {
  return mob.isBoss ? resolveBossLevel(band, partyLevel) : resolveSpawnLevel(band, partyLevel);
}

/**
 * The escort mobs one room actually gets: every eligible escort rule, expanded
 * to one entry per body so the caller can simply count them.
 */
function rollEscorts(rule: MobSpawnRule, region: number): EscortSpawnRule[] {
  const rolled: EscortSpawnRule[] = [];
  for (const escort of rule.escorts ?? []) {
    if (escort.minRegion !== undefined && region < escort.minRegion) continue;
    const count = randomInt(escort.minCount ?? 1, escort.maxCount ?? 1);
    for (let i = 0; i < count; i++) rolled.push(escort);
  }
  // Truncated here rather than only reserved against, because the cap is stated
  // as a hard guarantee: reserving alone bounds the *host* rule while leaving
  // the escort loop free to spawn as many bodies as it was authored with, so a
  // generous future roster would breach the ceiling with nothing to stop it.
  rolled.length = Math.min(rolled.length, MAX_ROOM_SPAWN_COUNT);
  return rolled;
}

type MobFactory = (tileX: number, tileY: number) => Mob;

const MOB_REGISTRY = new Map<string, MobFactory>();

/** Register a mob type so it can be spawned by name. */
export function registerMob(type: string, factory: MobFactory): void {
  MOB_REGISTRY.set(type, factory);
}

/**
 * Every mob type actually spawnable via `createMob`, straight from the
 * registry rather than from `MobSpawnRule['type']`.
 *
 * That union is one entry narrower than this registry (`bugaboo` is
 * registered but was never added to the union), so anything deriving "what
 * can a floor spawn" from the typed union alone silently misses it —
 * `scripts/verify-assets.ts` uses this instead for exactly that reason.
 */
export function getRegisteredMobTypes(): readonly string[] {
  return Array.from(MOB_REGISTRY.keys());
}

registerMob('llama', (x, y) => new Llama(x, y, TILE_SIZE));
registerMob('rock_golem', (x, y) => new RockGolem(x, y, TILE_SIZE));
registerMob('rock_golem_boss', (x, y) => new RockGolemBoss(x, y, TILE_SIZE));
registerMob('rat', (x, y) => new Rat(x, y, TILE_SIZE));
registerMob('mantid', (x, y) => new Mantid(x, y, TILE_SIZE));
registerMob('mantis', (x, y) => new MantisCrony(x, y, TILE_SIZE));
registerMob('the_hoarder', (x, y) => new TheHoarder(x, y, TILE_SIZE));
registerMob('cockroach', (x, y) => new Cockroach(x, y, TILE_SIZE));
registerMob('juicer', (x, y) => new Juicer(x, y, TILE_SIZE));
registerMob('troglodyte', (x, y) => new Troglodyte(x, y, TILE_SIZE));
registerMob('tuskling', (x, y) => new Tuskling(x, y, TILE_SIZE));
registerMob('sky_fowl', (x, y) => new SkyFowl(x, y, TILE_SIZE));
registerMob('ball_of_swine', (x, y) => new BallOfSwine(x, y, TILE_SIZE));
registerMob('krakaren_clone', (x, y) => new KrakarenClone(x, y, TILE_SIZE));
registerMob('brindle_grub', (x, y) => new BrindleGrub(x, y, TILE_SIZE));
registerMob('bugaboo', (x, y) => new Bugaboo(x, y, TILE_SIZE));
registerMob('grotesque_spider', (x, y) => new GrotesqueSpider(x, y, TILE_SIZE));
registerMob('small_spider', (x, y) => new SmallSpider(x, y, TILE_SIZE));
registerMob('ruins_ghoul', (x, y) => new RuinsGhoul(x, y, TILE_SIZE));
registerMob('krasue', (x, y) => new Krasue(x, y, TILE_SIZE));
registerMob('circus_lemur', (x, y) => new CircusLemur(x, y, TILE_SIZE));
registerMob('stilt_clown', (x, y) => new StiltClown(x, y, TILE_SIZE));
registerMob('fat_clown', (x, y) => new FatClown(x, y, TILE_SIZE));
registerMob('evil_clown', (x, y) => new EvilClown(x, y, TILE_SIZE));
registerMob('mold_lion', (x, y) => new MoldLion(x, y, TILE_SIZE));
registerMob('terror_the_clown', (x, y) => new TerrorTheClown(x, y, TILE_SIZE));
registerMob('ringmaster_grimaldi', (x, y) => new RingmasterGrimaldi(x, y, TILE_SIZE));
registerMob('city_elf_cultist', (x, y) => new CityElfCultist(x, y, TILE_SIZE));
registerMob('skeleton_sword', (x, y) => new SkeletonWarrior(x, y, TILE_SIZE));
registerMob('skeleton_archer', (x, y) => new SkeletonArcher(x, y, TILE_SIZE));
registerMob('skeleton_lord', (x, y) => new SkeletonLord(x, y, TILE_SIZE));
registerMob('goblin_archer', (x, y) => new GoblinArcher(x, y, TILE_SIZE));
registerMob('goblin', (x, y) => {
  return new Goblin(x, y, TILE_SIZE, pickGoblinWeapon());
});

// An unknown mob type otherwise falls back to a Goblin with zero console output —
// a typo'd spawn-rule type silently spawns the wrong creature forever. Logged
// once per type so a floor full of the same typo doesn't spam every spawn.
const _unknownMobTypesLogged = new Set<string>();

export function createMob(type: string, tileX: number, tileY: number, map: GameMap): Mob {
  const factory = MOB_REGISTRY.get(type);
  if (factory === undefined && !_unknownMobTypesLogged.has(type)) {
    _unknownMobTypesLogged.add(type);
    console.warn(`[spawner] Unknown mob type "${type}" — falling back to Goblin`);
  }
  const resolvedFactory = factory ?? MOB_REGISTRY.get('goblin');
  if (!resolvedFactory) throw new Error(`Unknown mob type: ${type}`);
  const mob = resolvedFactory(tileX, tileY);
  mob.setMap(map);
  // The key that was *asked for*, which for a typo'd rule is not the key of the
  // Goblin that came back. That is the right answer for the one question this
  // field exists to serve — how many of a rule's own spawns are alive — and the
  // mismatch has already been reported above.
  mob.spawnTypeKey = type;
  return mob;
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
 * beyond what `createMob` provides (e.g. BallOfSwine needs arena binding).
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
export function spawnExtraMobs(def: LevelDef, map: GameMap, partyLevel: number): Mob[] {
  const mobs: Mob[] = [];
  if (!def.extraSpawns) return mobs;

  for (const rule of def.extraSpawns) {
    const origin = resolveOrigin(rule.origin, map, def);
    if (!origin) continue;

    for (const [dx, dy] of rule.offsets) {
      const mob = createMob(rule.type, origin.x + dx, origin.y + dy, map);
      mob.applyMobLevel(levelForMob(mob, rule, partyLevel));
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
 */
function spawnCampResidents(def: LevelDef, map: GameMap, partyLevel: number): Mob[] {
  const mobs: Mob[] = [];
  const rosters = def.campSpawns;
  if (rosters === undefined) return mobs;

  for (const camp of map.camps) {
    const roster = rosters[camp.kind];
    if (roster === undefined || roster.length === 0) continue;
    for (const rule of roster) {
      const count = randomInt(rule.minCount ?? 1, rule.maxCount ?? 1);
      for (let spawned = 0; spawned < count; spawned++) {
        const tile = findWalkableTileInCamp(map, camp.centre, camp.radiusTiles);
        if (tile === null) continue;
        const mob = createMob(rule.type, tile.x, tile.y, map);
        mob.applyMobLevel(resolveSpawnLevel(rule, partyLevel));
        // Its own spawn tile, **not** the camp's centre. The centre is a
        // `CAMPFIRE` — solid — and `followTargetAStar` would be asked to path to
        // a tile nothing can stand on, which is a resident that never walks home
        // rather than one that walks home slowly. A spawn tile is walkable by
        // construction and is inside the camp, which is all the leash needs.
        mob.homePoint = { x: mob.x, y: mob.y };
        mob.leashRadiusTiles = CAMP_LEASH_RADIUS_TILES;
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
): { x: number; y: number } | null {
  for (let attempt = 0; attempt < CAMP_SPAWN_ATTEMPTS; attempt++) {
    const angle = Math.random() * Math.PI * 2;
    // Square-rooted so the draws are uniform over the disc's *area* rather than
    // piling up at its centre, which is where the fire is.
    const reach = Math.sqrt(Math.random()) * radiusTiles;
    const tx = Math.round(centre.x + Math.cos(angle) * reach);
    const ty = Math.round(centre.y + Math.sin(angle) * reach);
    if (map.isWalkable(tx, ty)) return { x: tx, y: ty };
  }
  return null;
}

/**
 * Instantiate all mobs for a level. Room spawn points draw from
 * `def.roomMobs`; hallway points draw from `def.hallwayMobs`.
 * If `def.bossRoom` is set and the map has a boss room centre, spawns the boss there.
 */
export function spawnForLevel(def: LevelDef, map: GameMap, partyLevel: number): Mob[] {
  const mobs: Mob[] = [];

  if (def.roomMobs.length > 0) {
    const regionBonuses = def.progression?.regionSpawnBonus ?? [];
    for (const { x, y, w, h, region } of map.mobSpawnPoints) {
      const rule = pickRule(def.roomMobs);
      const min = rule.minCount ?? 1;
      const max = rule.maxCount ?? 1;
      // Escorts are rolled first and their places *reserved*, so a room that
      // would otherwise fill its whole allowance with the host rule still has
      // room for the archer that makes it a mixed group.
      const escorts = rollEscorts(rule, region);
      const count = Math.max(
        0,
        Math.min(
          MAX_ROOM_SPAWN_COUNT - escorts.length,
          randomInt(min, max) + (regionBonuses[region] ?? 0),
        ),
      );
      // Interior tile range: 1-tile inset from walls on each side
      const minTX = x - Math.floor(w / 2) + ROOM_BOUNDARY_INSET;
      const minTY = y - Math.floor(h / 2) + ROOM_BOUNDARY_INSET;
      const maxTX = minTX + w - ROOM_BOUNDS_OFFSET;
      const maxTY = minTY + h - ROOM_BOUNDS_OFFSET;
      const spawnInRoom = (band: MobLevelRange, type: MobSpawnRule['type']): void => {
        const tile = findWalkableSpawnTile(map, { minTX, minTY, maxTX, maxTY });
        if (tile === null) return;
        const mob = createMob(type, tile.x, tile.y, map);
        mob.applyMobLevel(resolveSpawnLevel(band, partyLevel));
        mobs.push(mob);
      };
      for (let i = 0; i < count; i++) spawnInRoom(rule, rule.type);
      for (const escort of escorts) spawnInRoom(escort, escort.type);
    }
  }

  if (def.hallwayMobs.length > 0) {
    for (const { x, y } of map.hallwaySpawnPoints) {
      const rule = pickRule(def.hallwayMobs);
      const mob = createMob(rule.type, x, y, map);
      mob.applyMobLevel(resolveSpawnLevel(rule, partyLevel));
      mobs.push(mob);
    }
  }

  mobs.push(...spawnCampResidents(def, map, partyLevel));

  const bossRooms = def.bossRooms ?? [];
  for (let i = 0; i < bossRooms.length; i++) {
    const bossEntry = bossRooms[i];
    if (i >= map.bossRooms.length) continue;
    const brData = map.bossRooms[i];
    const boss = createMob(bossEntry.type, brData.centre.x, brData.centre.y, map);
    boss.applyMobLevel(resolveBossLevel(bossEntry, partyLevel));
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
): Mob[] {
  const mobs: Mob[] = [];
  if (def.roomMobs.length === 0) return mobs;

  // Escorts are deliberately not honoured here. A treasure room's guards are a
  // fixed count at the top of their band — a second, additive mechanism on top
  // of that is how a chest ends up behind eleven bodies.
  for (const room of treasureRooms) {
    const { x, y, w, h } = room.bounds;
    const minTX = x + ROOM_BOUNDARY_INSET;
    const minTY = y + ROOM_BOUNDARY_INSET;
    const maxTX = x + w - ROOM_FAR_EDGE_INSET;
    const maxTY = y + h - ROOM_FAR_EDGE_INSET;

    for (let i = 0; i < TREASURE_ROOM_EXTRA_MOBS; i++) {
      const rule = pickRule(def.roomMobs);
      const tile = findWalkableSpawnTile(map, { minTX, minTY, maxTX, maxTY });
      if (tile === null) continue;
      const mob = createMob(rule.type, tile.x, tile.y, map);
      const maxLevel = rule.maxLevel ?? rule.minLevel ?? 1;
      mob.applyMobLevel(Math.min(maxLevel + TREASURE_ROOM_LEVEL_BOOST, MAX_MOB_LEVEL));
      mobs.push(mob);
    }
  }

  return mobs;
}
