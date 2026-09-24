/**
 * Puts fairies on a floor: into its rooms at build, beside the overworld's
 * ambient enemies, beside a boss on the hardest difficulty, and into untouched
 * rooms when a boss that upgrades their rates dies.
 *
 * Fairies are always extra to a room's own population. They never count toward
 * `MAX_ROOM_SPAWN_COUNT`, and `rollRoomPopulation` knows nothing of them.
 */

import type { GameMap } from '../map/GameMap';
import type { Mob } from '../creatures/Mob';
import type { Player } from '../Player';
import { Fairy } from '../creatures/fairies/Fairy';
import type { FairyKind } from '../sprites/art/fairyTiming';
import { HealingFairy } from '../creatures/fairies/HealingFairy';
import { bindHealerToBoss } from '../creatures/fairies/bossHealerBond';
import type { LevelledCurve } from '../creatures/mobLevelScaling';
import { TILE_SIZE } from '../core/constants';
import {
  applySpawnDifficulty,
  type Difficulty,
  type DifficultyProfile,
} from '../core/difficultyProfiles';
import { settings } from '../core/Settings';
import { hasRoomToMove } from '../map/findWalkableTile';
import { RUINS_CIRCUS_BUFFER } from '../map/OverworldGenerator';
import { pastSafeRoomTest } from '../map/pastSafeRoom';
import {
  createMob,
  findWalkableSpawnTile,
  pickRule,
  regionLevelBand,
  regionLevelBonusFor,
  resolveAmbientLevel,
  roomSpawnBounds,
  type SpawnBounds,
} from './spawner';
import type {
  FairyRoomRate,
  FairySpawnTable,
  LevelDef,
  MobLevelRange,
  MobSpawnRule,
} from './types';

/**
 * The most non-healer fairies one room may hold, however generous a table's
 * count. A room's healer is extra to it.
 */
export const MAX_FAIRIES_PER_ROOM = 3;

/** A uniform draw in [0, 1). Injectable so a gate can seed the rolls. */
export type FairyRng = () => number;

/** Every fairy a room roll can pick; the healer is rolled on its own. */
export type RegularFairyKind = Exclude<FairyKind, 'healer'>;

/** Picked uniformly and independently per fairy, so a room can hold two of a kind. */
export const REGULAR_FAIRY_KINDS: readonly RegularFairyKind[] = ['shield', 'ice', 'fire', 'necro'];

/** The spawner key each kind is registered under. */
export const FAIRY_SPAWN_KEYS: Readonly<Record<FairyKind, MobSpawnRule['type']>> = {
  shield: 'fairy_shield',
  healer: 'fairy_healer',
  ice: 'fairy_ice',
  fire: 'fairy_fire',
  necro: 'fairy_necro',
};

/**
 * What one room rolled: its counted fairies, separately whether it gets a
 * healer, and whether it gets the guaranteed shield fairy on top of both.
 */
export interface RoomFairyRoll {
  readonly fairies: readonly RegularFairyKind[];
  readonly healer: boolean;
  /** See {@link needsGuaranteedShield}. */
  readonly guaranteedShield: boolean;
}

const NO_ROOM_FAIRIES: RoomFairyRoll = { fairies: [], healer: false, guaranteedShield: false };

/**
 * Whether a spawn point holding `kinds` gets one more fairy, a shield: it holds
 * at least one fairy and none of them is a shield. On every difficulty alike,
 * extra to the rolled count and outside {@link MAX_FAIRIES_PER_ROOM}, because a
 * shield fairy is what makes the rest of a fairy group a fight about who dies
 * first. Never applied to a boss's healer, which is its own encounter.
 */
export function needsGuaranteedShield(kinds: readonly FairyKind[]): boolean {
  return kinds.length > 0 && !kinds.includes('shield');
}

/** A uniform integer in [min, max] from `rng`. */
function rollIntInclusive(rng: FairyRng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function pickRegularKind(rng: FairyRng): RegularFairyKind {
  const index = Math.floor(rng() * REGULAR_FAIRY_KINDS.length);
  return REGULAR_FAIRY_KINDS[Math.min(index, REGULAR_FAIRY_KINDS.length - 1)];
}

/**
 * The rate a room in `region` rolls at: the region's own, or — once `upgraded`
 * — the upgrade authored for that region, where there is one. Null means the
 * region gets no fairies at all.
 */
export function fairyRoomRate(
  table: FairySpawnTable,
  region: number,
  upgraded: boolean,
): FairyRoomRate | null {
  if (upgraded) {
    const upgrade = table.upgrades?.find((entry) => entry.region === region);
    if (upgrade !== undefined) return upgrade.rate;
  }
  return table.roomRatesByRegion[region] ?? null;
}

/**
 * How many non-healer fairies one roll at `rate` wants: zero when its chance
 * fails, else a uniform count in its range, held under
 * {@link MAX_FAIRIES_PER_ROOM}.
 */
export function rollFairyCount(rate: FairyRoomRate, difficulty: Difficulty, rng: FairyRng): number {
  if (rng() >= rate.chance[difficulty]) return 0;
  const count = rollIntInclusive(rng, rate.minCount[difficulty], rate.maxCount[difficulty]);
  return Math.min(count, MAX_FAIRIES_PER_ROOM);
}

/**
 * One room's fairies, with no map involved so a gate can roll it by the tens
 * of thousands.
 *
 * The healer is rolled independently of the regular roll — whether or not that
 * succeeded — and sits outside its count and its cap: a room can hold only a
 * healer, or a full set of fairies and a healer too.
 */
export function rollRoomFairies(
  table: FairySpawnTable,
  region: number,
  difficulty: Difficulty,
  upgraded: boolean,
  rng: FairyRng = Math.random,
): RoomFairyRoll {
  const rate = fairyRoomRate(table, region, upgraded);
  if (rate === null) return NO_ROOM_FAIRIES;
  const count = rollFairyCount(rate, difficulty, rng);
  const fairies: RegularFairyKind[] = [];
  for (let i = 0; i < count; i++) fairies.push(pickRegularKind(rng));
  const healer = rng() < table.roomHealerChance;
  const rolled: FairyKind[] = healer ? [...fairies, 'healer'] : [...fairies];
  return { fairies, healer, guaranteedShield: needsGuaranteedShield(rolled) };
}

/** One room a fairy pass populated, remembered for a later rate upgrade. */
export interface FairyLedgerRoom {
  /** The room's whole floor, walls excluded, in tiles: `x`/`y` its top-left. */
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** Where its occupants may be dropped. */
  readonly spawnBounds: SpawnBounds;
  readonly region: number;
  /** The band a fairy added to this room is levelled in. */
  readonly band: MobLevelRange;
  /** Every fairy placed here, healer included. Grows on an upgrade, never shrinks. */
  readonly fairies: Fairy[];
  /** Boss types whose upgrade this room has already been offered, taken or not. */
  readonly upgradedBy: Set<string>;
  /**
   * Boss types whose guarding safe room this room lies past, for the upgrades
   * that reach only {@link FairyRateUpgrade.onlyPastItsSafeRoom} rooms.
   */
  readonly pastSafeRoomOf: ReadonlySet<string>;
  /**
   * The shield fairy placed only because nothing the room rolled was one. Not
   * counted against a rate upgrade's roll, which it sits outside of.
   */
  guaranteedShield: Fairy | null;
}

/**
 * The rooms a floor's fairy pass populated, and everything the pass was built
 * with, so a boss that upgrades rates mid-floor places fairies exactly as the
 * build would have — same party level, same difficulty, never re-read live.
 */
export class FairyRoomLedger {
  readonly rooms: FairyLedgerRoom[] = [];

  constructor(
    readonly def: LevelDef,
    readonly partyLevel: number,
    readonly profile: DifficultyProfile,
    readonly difficulty: Difficulty,
  ) {}

  /** Forgets fairies no longer in the scene's roster, as after a checkpoint rewind. */
  pruneMissing(roster: readonly Mob[]): void {
    const present = new Set(roster);
    for (const room of this.rooms) {
      for (let i = room.fairies.length - 1; i >= 0; i--) {
        if (!present.has(room.fairies[i])) room.fairies.splice(i, 1);
      }
    }
  }

  /** Lets every room be offered `bossType`'s upgrade again. */
  forgetUpgrade(bossType: string): void {
    for (const room of this.rooms) room.upgradedBy.delete(bossType);
  }
}

/**
 * Levels and stamps a freshly created fairy, in the order every spawn site
 * uses: host HP, level, difficulty, then the potency the level and difficulty
 * decide.
 */
function finishFairySpawn(
  fairy: Fairy,
  level: number,
  curve: LevelledCurve | undefined,
  profile: DifficultyProfile,
  difficulty: Difficulty,
  hostFloor: number,
): void {
  fairy.setHostFloor(hostFloor);
  fairy.applyMobLevel(level, curve);
  applySpawnDifficulty(fairy, profile);
  fairy.stampPotency(difficulty);
}

/** A fairy of `kind` on the tile, or null if the registry handed back something else. */
function createFairy(kind: FairyKind, tileX: number, tileY: number, map: GameMap): Fairy | null {
  const mob = createMob(FAIRY_SPAWN_KEYS[kind], tileX, tileY, map);
  return mob instanceof Fairy ? mob : null;
}

/** Places one fairy of `kind` in a ledger room, or null when the room has no floor left. */
function placeRoomFairy(
  kind: FairyKind,
  room: FairyLedgerRoom,
  map: GameMap,
  ledger: FairyRoomLedger,
): Fairy | null {
  const tile = findWalkableSpawnTile(map, room.spawnBounds);
  if (tile === null) return null;
  const fairy = createFairy(kind, tile.x, tile.y, map);
  if (fairy === null) return null;
  const { def, partyLevel, profile, difficulty } = ledger;
  finishFairySpawn(
    fairy,
    resolveAmbientLevel(room.band, def, partyLevel, profile),
    def.levelledCurve,
    profile,
    difficulty,
    def.floorNumber,
  );
  fairy.allowSlingshotDrop = def.slingshotDrops === true;
  room.fairies.push(fairy);
  return fairy;
}

/** A band with no rule behind it: level 1, as an unlevelled spawn would be. */
const BASE_LEVEL_BAND: MobLevelRange = {};

/**
 * The band a room's fairies level in: a room rule drawn with the host's own
 * weights, shifted by the region's level bonus. Drawn rather than read back
 * from the host because the host roll has already happened, and this draws
 * from the same distribution the host band came from.
 */
function roomFairyBand(def: LevelDef, region: number): MobLevelRange {
  if (def.roomMobs.length === 0) return BASE_LEVEL_BAND;
  return regionLevelBand(pickRule(def.roomMobs), regionLevelBonusFor(def, region));
}

/**
 * The room pass: rolls and places every room's fairies, recording each room
 * in the ledger. Returns the fairies for the caller to add to the roster.
 *
 * Run directly after `spawnForLevel` with the ledger built from the same party
 * level and profile.
 */
export function spawnRoomFairies(
  map: GameMap,
  ledger: FairyRoomLedger,
  rng: FairyRng = Math.random,
): Fairy[] {
  const placed: Fairy[] = [];
  const table = ledger.def.fairies;
  if (table === undefined) return placed;

  const pastTests: { bossType: string; isPast: (rect: FairyLedgerRoom['rect']) => boolean }[] = [];
  for (const upgrade of table.upgrades ?? []) {
    if (upgrade.onlyPastItsSafeRoom !== true) continue;
    const isPast = pastSafeRoomTest(map, upgrade.bossType);
    if (isPast !== null) pastTests.push({ bossType: upgrade.bossType, isPast });
  }

  for (const point of map.mobSpawnPoints) {
    const roll = rollRoomFairies(table, point.region, ledger.difficulty, false, rng);
    const rect = {
      x: point.x - Math.floor(point.w / 2),
      y: point.y - Math.floor(point.h / 2),
      w: point.w,
      h: point.h,
    };
    const room: FairyLedgerRoom = {
      rect,
      spawnBounds: roomSpawnBounds(point),
      region: point.region,
      band: roomFairyBand(ledger.def, point.region),
      fairies: [],
      upgradedBy: new Set(),
      pastSafeRoomOf: new Set(
        pastTests.filter((test) => test.isPast(rect)).map((test) => test.bossType),
      ),
      guaranteedShield: null,
    };
    ledger.rooms.push(room);
    const kinds: FairyKind[] = [...roll.fairies];
    if (roll.healer) kinds.push('healer');
    for (const kind of kinds) {
      const fairy = placeRoomFairy(kind, room, map, ledger);
      if (fairy !== null) placed.push(fairy);
    }
    if (roll.guaranteedShield) {
      const shield = placeGuaranteedShield(room, room.fairies, map, ledger);
      if (shield !== null) placed.push(shield);
    }
  }
  return placed;
}

/**
 * Adds the room's guaranteed shield fairy when `residents` — the fairies the
 * room holds — are some and none is a shield. Returns it, or null when the
 * room needs none or has no floor left.
 */
function placeGuaranteedShield(
  room: FairyLedgerRoom,
  residents: readonly Fairy[],
  map: GameMap,
  ledger: FairyRoomLedger,
): Fairy | null {
  if (!needsGuaranteedShield(residents.map((fairy) => fairy.kind))) return null;
  const shield = placeRoomFairy('shield', room, map, ledger);
  room.guaranteedShield = shield;
  return shield;
}

function isInsideRect(
  entity: { readonly x: number; readonly y: number },
  rect: FairyLedgerRoom['rect'],
): boolean {
  const tileX = Math.floor((entity.x + TILE_SIZE / 2) / TILE_SIZE);
  const tileY = Math.floor((entity.y + TILE_SIZE / 2) / TILE_SIZE);
  return tileX >= rect.x && tileY >= rect.y && tileX < rect.x + rect.w && tileY < rect.y + rect.h;
}

/**
 * Every living fairy the room holds: those placed in it, and any hostile fairy
 * standing inside it, such as one that fled in from a fallen room. A fairy
 * that fled in fights for this room now, so it counts toward what the room
 * already has.
 */
function roomResidentFairies(room: FairyLedgerRoom, mobs: readonly Mob[]): Fairy[] {
  const residents = room.fairies.filter((fairy) => fairy.isAlive);
  for (const mob of mobs) {
    if (!(mob instanceof Fairy) || !mob.isAlive || !mob.isHostile) continue;
    if (residents.includes(mob) || !isInsideRect(mob, room.rect)) continue;
    residents.push(mob);
  }
  return residents;
}

/**
 * Whether nothing has happened in this room yet: no crawler inside it, and
 * nothing in it dead, hurt or fighting. A room the party is fighting in, or
 * has cleared, keeps what it has.
 */
function isRoomUntouched(
  room: FairyLedgerRoom,
  mobs: readonly Mob[],
  crawlers: readonly Player[],
): boolean {
  if (crawlers.some((crawler) => isInsideRect(crawler, room.rect))) return false;
  for (const mob of mobs) {
    if (!mob.isHostile || !isInsideRect(mob, room.rect)) continue;
    if (!mob.isAlive || mob.hp < mob.maxHp) return false;
    if (mob.currentTarget !== null || mob.wasDamagedByParty) return false;
  }
  return room.fairies.every((fairy) => fairy.isAlive);
}

/**
 * Applies `bossType`'s rate upgrade to every untouched room of its region —
 * only those past the boss's guarding safe room, where the upgrade says so:
 * each re-rolls at the upgraded rate and gains the difference if the roll
 * wants more fairies than it has. Never removes one, never re-rolls the
 * healer, and never offers a room the same upgrade twice.
 *
 * The one implementation behind the boss's death and a reload that finds it
 * already dead. Returns the fairies added, for the caller to put in the roster.
 */
export function applyFairyRateUpgrade(
  ledger: FairyRoomLedger,
  bossType: string,
  map: GameMap,
  mobs: readonly Mob[],
  crawlers: readonly Player[],
  rng: FairyRng = Math.random,
): Fairy[] {
  const added: Fairy[] = [];
  const upgrades = ledger.def.fairies?.upgrades ?? [];
  for (const upgrade of upgrades) {
    if (upgrade.bossType !== bossType) continue;
    for (const room of ledger.rooms) {
      if (room.region !== upgrade.region || room.upgradedBy.has(bossType)) continue;
      const beforeItsSafeRoom =
        upgrade.onlyPastItsSafeRoom === true && !room.pastSafeRoomOf.has(bossType);
      if (beforeItsSafeRoom) continue;
      room.upgradedBy.add(bossType);
      if (!isRoomUntouched(room, mobs, crawlers)) continue;
      const wanted = rollFairyCount(upgrade.rate, ledger.difficulty, rng);
      const residents = roomResidentFairies(room, mobs);
      const existing = residents.filter(
        (fairy) => fairy.kind !== 'healer' && fairy !== room.guaranteedShield,
      ).length;
      const missing = Math.min(wanted, MAX_FAIRIES_PER_ROOM) - existing;
      for (let i = 0; i < missing; i++) {
        const fairy = placeRoomFairy(pickRegularKind(rng), room, map, ledger);
        if (fairy === null) continue;
        added.push(fairy);
        residents.push(fairy);
      }
      const shield = placeGuaranteedShield(room, residents, map, ledger);
      if (shield !== null) added.push(shield);
    }
  }
  return added;
}

/** Tile offsets tried around a scatter point, nearest ring first. */
const SCATTER_MIN_OFFSET_TILES = 1;
const SCATTER_MAX_OFFSET_TILES = 2;

/**
 * Whether a fairy may be placed on this overworld tile: open ground with room
 * to move, outside the town wall and its safe radius, and clear of the circus
 * grounds. Re-asserted here because a scatter point already clear of all
 * three can have a neighbour that is not.
 */
export function isOverworldFairyTileAllowed(map: GameMap, tileX: number, tileY: number): boolean {
  if (!map.isWalkable(tileX, tileY) || !hasRoomToMove(map, tileX, tileY)) return false;
  if (map.isTileInsideTownWall(tileX, tileY)) return false;
  if (map.isInTownSafeZone(tileX * TILE_SIZE, tileY * TILE_SIZE)) return false;
  const circus = map.circusCentre;
  const circusRadius = map.circusRadiusTiles;
  if (circus !== undefined && circusRadius !== undefined) {
    const reach = circusRadius + RUINS_CIRCUS_BUFFER;
    if (Math.hypot(tileX - circus.x, tileY - circus.y) <= reach) return false;
  }
  return true;
}

function findScatterTile(
  map: GameMap,
  origin: { readonly x: number; readonly y: number },
  taken: ReadonlySet<string>,
  rng: FairyRng,
): { x: number; y: number } | null {
  for (let radius = SCATTER_MIN_OFFSET_TILES; radius <= SCATTER_MAX_OFFSET_TILES; radius++) {
    const ring: { x: number; y: number }[] = [];
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const tile = { x: origin.x + dx, y: origin.y + dy };
        if (taken.has(`${tile.x},${tile.y}`)) continue;
        if (isOverworldFairyTileAllowed(map, tile.x, tile.y)) ring.push(tile);
      }
    }
    if (ring.length > 0) return ring[Math.min(Math.floor(rng() * ring.length), ring.length - 1)];
  }
  return null;
}

/**
 * One scatter point's fairies, with no map involved so a gate can roll it by
 * the tens of thousands: one non-healer fairy at the table's chance and,
 * rolled apart from it, a healer, plus the guaranteed shield when either came
 * up and neither is one. A table without scatter rates rolls nothing.
 */
export function rollScatterFairies(
  table: FairySpawnTable,
  difficulty: Difficulty,
  rng: FairyRng = Math.random,
): RoomFairyRoll {
  const scatterChance = table.scatterChance;
  if (scatterChance === undefined) return NO_ROOM_FAIRIES;
  const fairies: RegularFairyKind[] = [];
  if (rng() < scatterChance[difficulty]) fairies.push(pickRegularKind(rng));
  const healer = rng() < (table.scatterHealerChance ?? 0);
  const rolled: FairyKind[] = healer ? [...fairies, 'healer'] : [...fairies];
  return { fairies, healer, guaranteedShield: needsGuaranteedShield(rolled) };
}

/**
 * The overworld pass: {@link rollScatterFairies} at each ambient scatter
 * point, every fairy standing where the ambient enemy does so each has
 * someone to support. Levelled in the point's hallway band as the floor
 * tracks it.
 */
export function spawnOverworldFairies(
  map: GameMap,
  ledger: FairyRoomLedger,
  rng: FairyRng = Math.random,
): Fairy[] {
  const placed: Fairy[] = [];
  const { def, partyLevel, profile, difficulty } = ledger;
  const table = def.fairies;
  if (table?.scatterChance === undefined) return placed;

  for (const point of map.hallwaySpawnPoints) {
    const roll = rollScatterFairies(table, difficulty, rng);
    const kinds: FairyKind[] = [...roll.fairies];
    if (roll.healer) kinds.push('healer');
    if (roll.guaranteedShield) kinds.push('shield');
    if (kinds.length === 0) continue;
    const band: MobLevelRange =
      def.hallwayMobs.length > 0 ? pickRule(def.hallwayMobs) : BASE_LEVEL_BAND;
    const taken = new Set<string>();
    for (const kind of kinds) {
      const tile = findScatterTile(map, point, taken, rng);
      if (tile === null) continue;
      const fairy = createFairy(kind, tile.x, tile.y, map);
      if (fairy === null) continue;
      taken.add(`${tile.x},${tile.y}`);
      finishFairySpawn(
        fairy,
        resolveAmbientLevel(band, def, partyLevel, profile),
        def.levelledCurve,
        profile,
        difficulty,
        def.floorNumber,
      );
      fairy.allowSlingshotDrop = def.slingshotDrops === true;
      placed.push(fairy);
    }
  }
  return placed;
}

/** Ring of tiles around a boss searched for somewhere to put its healer. */
const BOSS_HEALER_MIN_RADIUS_TILES = 3;
const BOSS_HEALER_MAX_RADIUS_TILES = 5;

/** Where a fight allows its healer to be placed, by tile. */
export type BossHealerTileFilter = (tileX: number, tileY: number) => boolean;

const ANY_BOSS_HEALER_TILE: BossHealerTileFilter = () => true;

/**
 * Open ground 3–5 tiles from the boss that the boss can see and `isAllowed`
 * accepts. Searched ring by ring from the inside, picking at random within a
 * ring, preferring room to move — the rules `SkeletonSummonSystem` places its
 * risen by — and requiring sight so a healer never lands on the far side of a
 * wall.
 */
function findBossHealerTile(
  boss: Mob,
  map: GameMap,
  isAllowed: BossHealerTileFilter,
): { x: number; y: number } | null {
  const ts = TILE_SIZE;
  const bossCentreX = boss.x + ts / 2;
  const bossCentreY = boss.y + ts / 2;
  const centreTileX = Math.floor(bossCentreX / ts);
  const centreTileY = Math.floor(bossCentreY / ts);
  const cramped: { x: number; y: number }[] = [];
  for (
    let radius = BOSS_HEALER_MIN_RADIUS_TILES;
    radius <= BOSS_HEALER_MAX_RADIUS_TILES;
    radius++
  ) {
    const roomy: { x: number; y: number }[] = [];
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const tileX = centreTileX + dx;
        const tileY = centreTileY + dy;
        if (!map.isWalkable(tileX, tileY) || map.isStairwellTile(tileX, tileY)) continue;
        if (!isAllowed(tileX, tileY)) continue;
        const tileCentreX = tileX * ts + ts / 2;
        const tileCentreY = tileY * ts + ts / 2;
        if (!map.hasLineOfSight(bossCentreX, bossCentreY, tileCentreX, tileCentreY)) continue;
        if (hasRoomToMove(map, tileX, tileY)) roomy.push({ x: tileX, y: tileY });
        else cramped.push({ x: tileX, y: tileY });
      }
    }
    if (roomy.length > 0) return roomy[Math.floor(Math.random() * roomy.length)];
  }
  if (cramped.length > 0) return cramped[Math.floor(Math.random() * cramped.length)];
  return null;
}

/**
 * One healing fairy beside `boss`, levelled to the boss's own level on the
 * boss's curve, not yet in any roster. Null when there is nowhere to put it.
 * Bound to `boss` (`bossHealerBond`), so the boss's room stays sealed until
 * the healer falls too.
 *
 * `hostFloor` is the floor number the fight is on, which sets the healer's HP
 * against that floor's typical host. `isAllowed` narrows where it may be
 * placed, for a fight whose bounds line of sight alone does not describe.
 */
function createBossHealer(
  boss: Mob,
  map: GameMap,
  hostFloor: number,
  difficulty: Difficulty,
  isAllowed: BossHealerTileFilter = ANY_BOSS_HEALER_TILE,
): HealingFairy | null {
  const tile = findBossHealerTile(boss, map, isAllowed);
  if (tile === null) return null;
  const mob = createMob(FAIRY_SPAWN_KEYS.healer, tile.x, tile.y, map);
  if (!(mob instanceof HealingFairy)) return null;
  mob.setHostFloor(hostFloor);
  mob.applyMobLevel(boss.mobLevel, boss.levelledCurve);
  applySpawnDifficulty(mob);
  mob.stampPotency(difficulty);
  bindHealerToBoss(mob, boss);
  return mob;
}

/**
 * Places one healing fairy beside `boss` and hands it to `addMob`. Returns it,
 * or null when there was nowhere to put it.
 */
export function spawnBossHealer(
  boss: Mob,
  map: GameMap,
  addMob: (mob: Mob) => void,
  hostFloor: number,
  difficulty: Difficulty = settings.difficulty,
  isAllowed: BossHealerTileFilter = ANY_BOSS_HEALER_TILE,
): HealingFairy | null {
  const healer = createBossHealer(boss, map, hostFloor, difficulty, isAllowed);
  if (healer !== null) addMob(healer);
  return healer;
}

/** The difficulty on which every boss fight brings a healer. */
export const BOSS_HEALER_DIFFICULTY: Difficulty = 'hard';

/**
 * {@link spawnBossHealer} on the difficulty that calls for one, nothing on the
 * others. The one call each boss's spawn path makes.
 */
export function spawnHardModeBossHealer(
  boss: Mob,
  map: GameMap,
  addMob: (mob: Mob) => void,
  hostFloor: number,
  difficulty: Difficulty = settings.difficulty,
  isAllowed: BossHealerTileFilter = ANY_BOSS_HEALER_TILE,
): HealingFairy | null {
  if (difficulty !== BOSS_HEALER_DIFFICULTY) return null;
  return spawnBossHealer(boss, map, addMob, hostFloor, difficulty, isAllowed);
}

/**
 * Healers for the floor's boss rooms, placed beside each living boss in a room
 * `isRoomDefeated` does not already count as won. Returns the healers, for the
 * caller to add to the roster with the rest of the build.
 */
export function spawnBossRoomHealers(
  ledger: FairyRoomLedger,
  map: GameMap,
  mobs: readonly Mob[],
  isRoomDefeated: (roomIndex: number) => boolean,
): HealingFairy[] {
  const healers: HealingFairy[] = [];
  if (ledger.difficulty !== BOSS_HEALER_DIFFICULTY) return healers;
  const rules = ledger.def.bossRooms ?? [];
  map.bossRooms.forEach((room, index) => {
    if (index >= rules.length || isRoomDefeated(index)) return;
    const bossType = rules[index].type;
    const boss = mobs.find(
      (mob) => mob.isBoss && mob.spawnTypeKey === bossType && isInsideRect(mob, room.bounds),
    );
    if (boss === undefined) return;
    const healer = createBossHealer(boss, map, ledger.def.floorNumber, ledger.difficulty);
    if (healer !== null) healers.push(healer);
  });
  return healers;
}
