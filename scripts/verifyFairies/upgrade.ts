/**
 * The Ball of Swine's rate upgrade on a real built floor 2, on the hardest
 * difficulty, where the upgraded table's minimum of two fairies per room makes
 * "this room would have gained" provable rather than a matter of luck.
 *
 * - The upgrade reaches only the rooms past the safe room guarding the Swine —
 *   the arena's beyond pocket. Which rooms those are is re-derived here by a
 *   walk from each room back to the floor's start, never through the
 *   spawner's own test.
 * - Killing the Swine (its `bossDefeated` event, which `FairySystem` listens
 *   for) tops every untouched past room up to the upgraded rate; every
 *   region-1 room before the safe room, the ones between the Krakaren and it
 *   included, gains nothing.
 * - A room with a crawler standing in it, or with a mob already fighting, gains
 *   nothing — and each is a room that provably would have gained otherwise.
 * - A second kill adds nothing.
 * - After the room pass and after the upgrade, every room holding a fairy
 *   holds a shield, and no room ever carries a guaranteed shield beside one
 *   it rolled or gains a second guaranteed one.
 * - The reload path — the dungeon scene's own reading of which upgrade bosses
 *   the restored boss rooms and arena say are dead, and its replay of their
 *   upgrades — yields the upgraded rates for a Swine already dead in the save.
 * - On a hand-built room, fairies that fled in from a fallen room count as the
 *   room's own: toward what the top-up already has, and a shield among them
 *   spares the room its guaranteed one.
 */

import { TILE_SIZE } from '../../src/core/constants';
import { DIFFICULTY_PROFILES, type Difficulty } from '../../src/core/difficultyProfiles';
import { EventBus } from '../../src/core/EventBus';
import { HumanPlayer } from '../../src/creatures/HumanPlayer';
import { CatPlayer } from '../../src/creatures/CatPlayer';
import type { Mob } from '../../src/creatures/Mob';
import { Fairy } from '../../src/creatures/fairies/Fairy';
import { GameMap } from '../../src/map/GameMap';
import type { TileRect } from '../../src/map/pastSafeRoom';
import { dungeonOptionsForLevel } from '../../src/levels/dungeonOptions';
import { level2 } from '../../src/levels/level2';
import type { LevelDef } from '../../src/levels/types';
import type { FairyRoomRate } from '../../src/levels/types';
import { createMob, roomSpawnBounds, spawnForLevel } from '../../src/levels/spawner';
import {
  FAIRY_SPAWN_KEYS,
  FairyRoomLedger,
  MAX_FAIRIES_PER_ROOM,
  REGULAR_FAIRY_KINDS,
  applyFairyRateUpgrade,
  spawnRoomFairies,
  type FairyLedgerRoom,
} from '../../src/levels/fairySpawner';
import type { FairyKind } from '../../src/sprites/art/fairyTiming';
import { FairySystem } from '../../src/systems/FairySystem';
import {
  deadFairyUpgradeBosses,
  replayFairyRateUpgrades,
} from '../../src/systems/fairyUpgradeBosses';
import type { FairyGateReport } from './report';
import { makeArena } from './stage';

const SWINE_BOSS_TYPE = 'ball_of_swine';
const UPGRADE_DIFFICULTY = 'hard';
/** A mid-floor party, well inside floor 2's band. */
const PARTY_LEVEL = 10;
/** Floors built looking for one with rooms to test; each is a fresh random layout. */
const MAX_FLOOR_ATTEMPTS = 40;
/**
 * The fewest counted fairies an untouched past room holds on hard once the
 * Swine is dead. A room holding fewer beforehand is guaranteed to gain if it
 * is offered the upgrade.
 */
const HARD_POST_SWINE_MIN_FAIRIES = 2;
/** Re-offers of an already-taken upgrade tried before calling the second-run guard vacuous. */
const REPEAT_UPGRADE_TRIES = 40;
/** Past rooms that would gain: one occupied, one engaged, and at least one left untouched. */
const NEEDED_TEST_ROOMS = 3;

const NEIGHBOUR_OFFSETS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * The fairies a room's upgrade roll is measured against: neither the healer
 * nor the guaranteed shield, both of which sit outside the count.
 */
function countedFairies(room: FairyLedgerRoom): number {
  return room.fairies.filter((fairy) => fairy.kind !== 'healer' && fairy !== room.guaranteedShield)
    .length;
}

function tileOf(entity: { readonly x: number; readonly y: number }): { x: number; y: number } {
  return {
    x: Math.floor((entity.x + TILE_SIZE / 2) / TILE_SIZE),
    y: Math.floor((entity.y + TILE_SIZE / 2) / TILE_SIZE),
  };
}

function isTileInRect(tileX: number, tileY: number, rect: TileRect): boolean {
  return tileX >= rect.x && tileY >= rect.y && tileX < rect.x + rect.w && tileY < rect.y + rect.h;
}

function isInRoom(
  entity: { readonly x: number; readonly y: number },
  room: FairyLedgerRoom,
): boolean {
  const tile = tileOf(entity);
  return isTileInRect(tile.x, tile.y, room.rect);
}

interface BuiltFloor {
  readonly map: GameMap;
  readonly ledger: FairyRoomLedger;
  readonly mobs: Mob[];
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly bus: EventBus;
  readonly fairies: FairySystem;
}

/** Floor 2 as `DungeonScene` builds it: the map, the host spawn, then the fairy room pass. */
function buildFloor2(): BuiltFloor {
  const map = new GameMap({
    mapSize: level2.mapSize,
    tileHeight: TILE_SIZE,
    mapType: 'dungeon',
    dungeon: dungeonOptionsForLevel(level2),
  });
  const profile = DIFFICULTY_PROFILES[UPGRADE_DIFFICULTY];
  const mobs = spawnForLevel(level2, map, PARTY_LEVEL, profile, new Set());
  const ledger = new FairyRoomLedger(level2, PARTY_LEVEL, profile, UPGRADE_DIFFICULTY);
  mobs.push(...spawnRoomFairies(map, ledger));
  const human = new HumanPlayer(map.startTile.x, map.startTile.y, TILE_SIZE);
  const cat = new CatPlayer(map.startTile.x, map.startTile.y, TILE_SIZE);
  const bus = new EventBus();
  const fairies = new FairySystem({
    bus,
    gameMap: map,
    ledger,
    getMobs: () => mobs,
    getCrawlers: () => [human, cat],
    addMob: (mob) => mobs.push(mob),
  });
  return { map, ledger, mobs, human, cat, bus, fairies };
}

function upgradeRegions(): Set<number> {
  return new Set(
    (level2.fairies?.upgrades ?? [])
      .filter((upgrade) => upgrade.bossType === SWINE_BOSS_TYPE)
      .map((upgrade) => upgrade.region),
  );
}

function upgradeRooms(ledger: FairyRoomLedger): FairyLedgerRoom[] {
  const regions = upgradeRegions();
  return ledger.rooms.filter((room) => regions.has(room.region));
}

function isPastSwineSafeRoom(room: FairyLedgerRoom): boolean {
  return room.pastSafeRoomOf.has(SWINE_BOSS_TYPE);
}

function pastRooms(ledger: FairyRoomLedger): FairyLedgerRoom[] {
  return upgradeRooms(ledger).filter(isPastSwineSafeRoom);
}

function beforeRooms(ledger: FairyRoomLedger): FairyLedgerRoom[] {
  return upgradeRooms(ledger).filter((room) => !isPastSwineSafeRoom(room));
}

/** Past rooms the upgrade must top up if left alone: under the minimum, no crawler in them. */
function roomsThatWouldGain(floor: BuiltFloor): FairyLedgerRoom[] {
  return pastRooms(floor.ledger).filter(
    (room) =>
      countedFairies(room) < HARD_POST_SWINE_MIN_FAIRIES &&
      ![floor.human, floor.cat].some((crawler) => isInRoom(crawler, room)),
  );
}

function hostileIn(floor: BuiltFloor, room: FairyLedgerRoom): Mob | undefined {
  return floor.mobs.find((mob) => mob.isHostile && !mob.isBoss && isInRoom(mob, room));
}

/**
 * A copy of the ledger nothing has upgraded, for a run against a broken rule,
 * optionally under a different level definition.
 */
function cloneLedger(ledger: FairyRoomLedger, def: LevelDef = ledger.def): FairyRoomLedger {
  const copy = new FairyRoomLedger(def, ledger.partyLevel, ledger.profile, ledger.difficulty);
  for (const room of ledger.rooms) {
    copy.rooms.push({
      ...room,
      fairies: [...room.fairies],
      upgradedBy: new Set(),
      pastSafeRoomOf: new Set(room.pastSafeRoomOf),
      guaranteedShield: room.guaranteedShield,
    });
  }
  return copy;
}

function roomIndex(ledger: FairyRoomLedger, room: FairyLedgerRoom): number {
  return ledger.rooms.indexOf(room);
}

/** Floor 2 with the Swine's upgrade reaching every region-1 room, safe room or not. */
function everyRoomUpgradeDef(): LevelDef {
  const table = level2.fairies;
  if (table === undefined) throw new Error('level2 has no fairy table');
  return {
    ...level2,
    fairies: {
      ...table,
      upgrades: (table.upgrades ?? []).map((upgrade) => ({
        ...upgrade,
        onlyPastItsSafeRoom: false,
      })),
    },
  };
}

/**
 * Whether any walkable tile of `room` can walk to the floor's start without
 * setting foot in `blocked`. Walked from the room outward, the opposite
 * direction to the spawner's flood, so the two share no code.
 */
function roomReachesStart(map: GameMap, room: TileRect, blocked: TileRect | null): boolean {
  const rows = map.structure.length;
  const columns = map.structure[0]?.length ?? rows;
  const isOpen = (x: number, y: number): boolean =>
    x >= 0 &&
    y >= 0 &&
    x < columns &&
    y < rows &&
    map.isWalkable(x, y) &&
    (blocked === null || !isTileInRect(x, y, blocked));
  const seen = new Uint8Array(rows * columns);
  const frontier: { x: number; y: number }[] = [];
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      if (!isOpen(x, y)) continue;
      seen[y * columns + x] = 1;
      frontier.push({ x, y });
    }
  }
  const start = map.startTile;
  // The array iterator re-reads `length`, so tiles pushed below are walked by this same loop.
  for (const tile of frontier) {
    if (tile.x === start.x && tile.y === start.y) return true;
    for (const [dx, dy] of NEIGHBOUR_OFFSETS) {
      const x = tile.x + dx;
      const y = tile.y + dy;
      if (!isOpen(x, y) || seen[y * columns + x] === 1) continue;
      seen[y * columns + x] = 1;
      frontier.push({ x, y });
    }
  }
  return false;
}

interface PastAudit {
  /** Ledger rooms whose recorded past/before verdict disagrees with the walk. */
  readonly mismatches: number;
  /** Rooms marked past that cannot reach the start even with the safe room open. */
  readonly cutOff: number;
  readonly detail: string;
}

/** Holds each room's recorded verdict, however derived, against a walk from the room. */
function auditPastRooms(
  map: GameMap,
  ledger: FairyRoomLedger,
  isMarkedPast: (room: FairyLedgerRoom) => boolean,
): PastAudit {
  const safeRoom = map.safeRoomGuarding(SWINE_BOSS_TYPE);
  if (safeRoom === undefined) return { mismatches: -1, cutOff: 0, detail: 'no Swine safe room' };
  let mismatches = 0;
  let cutOff = 0;
  let walkedPast = 0;
  for (const room of ledger.rooms) {
    const walkedIsPast = !roomReachesStart(map, room.rect, safeRoom.bounds);
    if (walkedIsPast) walkedPast++;
    if (walkedIsPast !== isMarkedPast(room)) mismatches++;
    if (isMarkedPast(room) && !roomReachesStart(map, room.rect, null)) cutOff++;
  }
  return {
    mismatches,
    cutOff,
    detail: `${walkedPast} of ${ledger.rooms.length} rooms walk past it; ${mismatches} disagree`,
  };
}

function isShieldFairy(fairy: Fairy): boolean {
  return fairy.kind === 'shield';
}

interface ShieldAudit {
  /** Rooms holding a fairy and no shield. */
  unshielded: number;
  /** Rooms whose guaranteed shield stands beside a shield the room rolled. */
  guaranteeBesideShield: number;
  /** Rooms whose guaranteed shield is not a shield fairy standing in the room. */
  strayGuarantee: number;
}

function auditShields(ledger: FairyRoomLedger): ShieldAudit {
  const audit: ShieldAudit = { unshielded: 0, guaranteeBesideShield: 0, strayGuarantee: 0 };
  for (const room of ledger.rooms) {
    if (room.fairies.length > 0 && !room.fairies.some(isShieldFairy)) audit.unshielded++;
    const guarantee = room.guaranteedShield;
    if (guarantee === null) continue;
    if (!isShieldFairy(guarantee) || !room.fairies.includes(guarantee)) audit.strayGuarantee++;
    const rolled = room.fairies.filter((fairy) => fairy !== guarantee);
    if (rolled.some(isShieldFairy)) audit.guaranteeBesideShield++;
  }
  return audit;
}

function shieldAuditHolds(audit: ShieldAudit): boolean {
  return audit.unshielded === 0 && audit.guaranteeBesideShield === 0 && audit.strayGuarantee === 0;
}

function describeShieldAudit(audit: ShieldAudit): string {
  return `${audit.unshielded} unshielded, ${audit.guaranteeBesideShield} guarantee beside a rolled shield, ${audit.strayGuarantee} stray`;
}

interface GuaranteeSnapshot {
  readonly guarantee: Fairy | null;
  readonly heldShield: boolean;
}

function snapshotGuarantees(ledger: FairyRoomLedger): GuaranteeSnapshot[] {
  return ledger.rooms.map((room) => ({
    guarantee: room.guaranteedShield,
    heldShield: room.fairies.some(isShieldFairy),
  }));
}

/**
 * Rooms that already held a shield before a top-up — rolled or guaranteed —
 * and came out of it with a different guaranteed shield: a second guarantee.
 */
function secondGuarantees(ledger: FairyRoomLedger, before: readonly GuaranteeSnapshot[]): number {
  return ledger.rooms.filter((room, index) => {
    const snapshot = before[index];
    return snapshot.heldShield && room.guaranteedShield !== snapshot.guarantee;
  }).length;
}

/** A fresh shield fairy dropped at a room's top-left, for a mutant ledger. */
function extraShieldIn(map: GameMap, room: FairyLedgerRoom): Fairy {
  const mob = createMob(FAIRY_SPAWN_KEYS.shield, room.rect.x, room.rect.y, map);
  if (!(mob instanceof Fairy)) throw new Error('the shield spawn key made no fairy');
  return mob;
}

/** A ledger whose room pass placed no guaranteed shields. */
function withoutGuarantees(ledger: FairyRoomLedger): FairyRoomLedger {
  const copy = cloneLedger(ledger);
  for (const room of copy.rooms) {
    const guarantee = room.guaranteedShield;
    if (guarantee === null) continue;
    room.fairies.splice(room.fairies.indexOf(guarantee), 1);
    room.guaranteedShield = null;
  }
  return copy;
}

/** A ledger whose room pass guaranteed a shield even to rooms that rolled one. */
function withGuaranteeBesideRolledShield(
  map: GameMap,
  ledger: FairyRoomLedger,
): FairyRoomLedger | null {
  const copy = cloneLedger(ledger);
  const room = copy.rooms.find(
    (candidate) => candidate.guaranteedShield === null && candidate.fairies.some(isShieldFairy),
  );
  if (room === undefined) return null;
  const extra = extraShieldIn(map, room);
  room.fairies.push(extra);
  room.guaranteedShield = extra;
  return copy;
}

interface ReloadOutcome {
  /** Fewest counted fairies in a past room after the replay; -Infinity with no past room. */
  readonly lowestPast: number;
  /** Before rooms whose fairy count changed during the replay. */
  readonly beforeGained: number;
  readonly pastRooms: number;
  /** Whether a past room was under the upgraded minimum before the replay, so the replay had to act. */
  readonly pastUnderMinimum: boolean;
  readonly shields: ShieldAudit;
}

function hasPastRoomUnderMinimum(floor: BuiltFloor): boolean {
  return pastRooms(floor.ledger).some((room) => countedFairies(room) < HARD_POST_SWINE_MIN_FAIRIES);
}

/**
 * A fresh floor 2 — the first built with a past room under the upgraded
 * minimum — with the dungeon scene's reload replay run over the boss rooms
 * and arena given. A missing past pocket leaves `lowestPast` at
 * -Infinity, so it fails the positive rather than passing it.
 */
function reloadFloor(
  bossRoom: Parameters<typeof deadFairyUpgradeBosses>[0],
  arena: Parameters<typeof deadFairyUpgradeBosses>[1],
  pastCounts: number[],
): ReloadOutcome {
  let floor = buildFloor2();
  pastCounts.push(pastRooms(floor.ledger).length);
  for (
    let attempt = 1;
    attempt < MAX_FLOOR_ATTEMPTS && !hasPastRoomUnderMinimum(floor);
    attempt++
  ) {
    floor = buildFloor2();
    pastCounts.push(pastRooms(floor.ledger).length);
  }
  const past = pastRooms(floor.ledger);
  const pastUnderMinimum = hasPastRoomUnderMinimum(floor);
  const before = beforeRooms(floor.ledger);
  const beforeCounts = before.map((room) => room.fairies.length);
  replayFairyRateUpgrades(floor.fairies, deadFairyUpgradeBosses(bossRoom, arena));
  return {
    lowestPast: past.length === 0 ? -Infinity : Math.min(...past.map(countedFairies)),
    beforeGained: before.filter((room, i) => room.fairies.length !== beforeCounts[i]).length,
    pastRooms: past.length,
    pastUnderMinimum,
    shields: auditShields(floor.ledger),
  };
}

export function verifyRateUpgrade(report: FairyGateReport): void {
  report.section('Ball of Swine upgrade (real floor 2, hard)');

  const pastCounts: number[] = [];
  let floor: BuiltFloor | null = null;
  let candidates: FairyLedgerRoom[] = [];
  let engagedRoom: FairyLedgerRoom | undefined;
  for (let attempt = 0; attempt < MAX_FLOOR_ATTEMPTS; attempt++) {
    const built = buildFloor2();
    pastCounts.push(pastRooms(built.ledger).length);
    const wouldGain = roomsThatWouldGain(built);
    const engaged = wouldGain.find((room) => hostileIn(built, room) !== undefined);
    floor = built;
    candidates = wouldGain;
    engagedRoom = engaged;
    if (engaged !== undefined && wouldGain.length >= NEEDED_TEST_ROOMS) break;
  }
  report.check(
    floor !== null && engagedRoom !== undefined && candidates.length >= NEEDED_TEST_ROOMS,
    'a built floor 2 has past rooms the upgrade must top up, one of them with a hostile to engage',
    `${candidates.length} past rooms under ${HARD_POST_SWINE_MIN_FAIRIES} counted fairies after ${pastCounts.length} floors`,
  );
  if (floor === null || engagedRoom === undefined || candidates.length < NEEDED_TEST_ROOMS) return;
  const built = floor;
  const engaged = engagedRoom;

  const past = pastRooms(built.ledger);
  const before = beforeRooms(built.ledger);
  report.precondition(
    past.length > 0 && before.length > 0,
    'region 1 has rooms on both sides of the safe room guarding the Swine',
    `${past.length} past, ${before.length} before, of ${upgradeRooms(built.ledger).length}`,
  );

  const pastAudit = auditPastRooms(built.map, built.ledger, isPastSwineSafeRoom);
  report.check(
    pastAudit.mismatches === 0,
    'every ledger room is marked past the Swine safe room exactly when a walk from it to the start must cross that safe room',
    pastAudit.detail,
  );
  report.check(
    pastAudit.cutOff === 0,
    'every past room reaches the start once the safe room is open: beyond it, not cut off',
    `${pastAudit.cutOff} cut off`,
  );
  const upgradeRegion = upgradeRegions();
  const byRegion = auditPastRooms(built.map, built.ledger, (room) =>
    upgradeRegion.has(room.region),
  );
  report.checkCatches(
    byRegion.mismatches === 0,
    'marking every region-1 room past is caught disagreeing with the walk',
    byRegion.detail,
  );

  const passShields = auditShields(built.ledger);
  report.check(
    shieldAuditHolds(passShields),
    'after the room pass every room holding a fairy holds a shield, never a guarantee beside a rolled one',
    `${describeShieldAudit(passShields)}; ${built.ledger.rooms.filter((room) => room.guaranteedShield !== null).length} guaranteed`,
  );
  const stripped = auditShields(withoutGuarantees(built.ledger));
  report.checkCatches(
    shieldAuditHolds(stripped),
    'a room pass without the guarantee is caught leaving rooms unshielded',
    describeShieldAudit(stripped),
  );
  const doubled = withGuaranteeBesideRolledShield(built.map, built.ledger);
  report.precondition(doubled !== null, 'some room rolled its own shield');
  if (doubled !== null) {
    const doubledAudit = auditShields(doubled);
    report.checkCatches(
      shieldAuditHolds(doubledAudit),
      'a guarantee given to a room that rolled a shield is caught',
      describeShieldAudit(doubledAudit),
    );
  }

  const occupiedRoom = candidates.find((room) => room !== engaged);
  if (occupiedRoom === undefined) throw new Error('no second past room to occupy');
  const occupiedBefore = countedFairies(occupiedRoom);
  const engagedBefore = countedFairies(engaged);
  report.check(
    occupiedBefore < HARD_POST_SWINE_MIN_FAIRIES && engagedBefore < HARD_POST_SWINE_MIN_FAIRIES,
    'the occupied and engaged past rooms would each gain if left untouched',
    `occupied ${occupiedBefore}, engaged ${engagedBefore}, upgraded minimum ${HARD_POST_SWINE_MIN_FAIRIES}`,
  );

  built.human.x = (occupiedRoom.rect.x + Math.floor(occupiedRoom.rect.w / 2)) * TILE_SIZE;
  built.human.y = (occupiedRoom.rect.y + Math.floor(occupiedRoom.rect.h / 2)) * TILE_SIZE;
  const engagedMob = hostileIn(built, engaged);
  if (engagedMob === undefined) throw new Error('engaged room lost its hostile');
  engagedMob.currentTarget = built.cat;

  // Each negative runs on a copy of the untouched ledger, so the real kill below
  // still sees every room fresh.
  const crawlerBlind = cloneLedger(built.ledger);
  const crawlerBlindAdded = applyFairyRateUpgrade(
    crawlerBlind,
    SWINE_BOSS_TYPE,
    built.map,
    built.mobs,
    [],
  );
  const crawlerBlindRoom = crawlerBlind.rooms[roomIndex(built.ledger, occupiedRoom)];
  report.checkCatches(
    countedFairies(crawlerBlindRoom) === occupiedBefore,
    'an upgrade that never looks for crawlers is caught topping up the occupied room',
    `${occupiedBefore} → ${countedFairies(crawlerBlindRoom)} (${crawlerBlindAdded.length} added floor-wide)`,
  );
  engagedMob.currentTarget = null;
  const engagementBlind = cloneLedger(built.ledger);
  applyFairyRateUpgrade(engagementBlind, SWINE_BOSS_TYPE, built.map, built.mobs, [
    built.human,
    built.cat,
  ]);
  engagedMob.currentTarget = built.cat;
  const engagementBlindRoom = engagementBlind.rooms[roomIndex(built.ledger, engaged)];
  report.checkCatches(
    countedFairies(engagementBlindRoom) === engagedBefore,
    'an upgrade that never looks at engagement is caught topping up the fought room',
    `${engagedBefore} → ${countedFairies(engagementBlindRoom)}`,
  );

  const crawlers = [built.human, built.cat];
  const beforeWouldGain = before.filter(
    (room) =>
      countedFairies(room) < HARD_POST_SWINE_MIN_FAIRIES &&
      !crawlers.some((crawler) => isInRoom(crawler, room)),
  );
  report.precondition(
    beforeWouldGain.length > 0,
    'some region-1 room before the safe room is under the upgraded minimum, so gaining there is possible',
    `${beforeWouldGain.length} of ${before.length}`,
  );
  const everyRoom = cloneLedger(built.ledger, everyRoomUpgradeDef());
  applyFairyRateUpgrade(everyRoom, SWINE_BOSS_TYPE, built.map, built.mobs, crawlers);
  const everyRoomBeforeGained = before.filter(
    (room) => everyRoom.rooms[roomIndex(built.ledger, room)].fairies.length !== room.fairies.length,
  ).length;
  report.checkCatches(
    everyRoomBeforeGained === 0,
    'an upgrade without onlyPastItsSafeRoom is caught adding to a room before the safe room',
    `${everyRoomBeforeGained} of ${before.length} before rooms gained`,
  );

  const swine = createMob(SWINE_BOSS_TYPE, built.map.startTile.x, built.map.startTile.y, built.map);
  const rosterBefore = built.mobs.length;
  const guaranteesBefore = snapshotGuarantees(built.ledger);
  const untouched = past.filter((room) => room !== occupiedRoom && room !== engaged);
  const untouchedBefore = untouched.map(countedFairies);
  const beforeCounts = before.map((room) => room.fairies.length);
  built.bus.emit('bossDefeated', { bossType: SWINE_BOSS_TYPE, mob: swine });
  const added = built.mobs.length - rosterBefore;
  const untouchedAfter = untouched.map(countedFairies);
  const gainedRooms = untouchedAfter.filter((after, i) => after > untouchedBefore[i]).length;
  const lowestUntouched = Math.min(...untouchedAfter);
  report.check(
    gainedRooms > 0 && lowestUntouched >= HARD_POST_SWINE_MIN_FAIRIES,
    'the Swine kill tops every untouched past room up to the upgraded rate',
    `${gainedRooms}/${untouched.length} rooms gained, ${added} fairies added, fewest now ${lowestUntouched}`,
  );
  const beforeGained = before.filter((room, i) => room.fairies.length !== beforeCounts[i]).length;
  report.check(
    beforeGained === 0,
    'region-1 rooms before the safe room, those between the Krakaren and it included, gain nothing',
    `${beforeGained} of ${before.length} gained (${beforeWouldGain.length} were under the minimum)`,
  );
  report.check(
    countedFairies(occupiedRoom) === occupiedBefore,
    'a room with a crawler inside gains nothing',
    `${occupiedBefore} → ${countedFairies(occupiedRoom)}`,
  );
  report.check(
    countedFairies(engaged) === engagedBefore,
    'a room with an engaged mob gains nothing',
    `${engagedBefore} → ${countedFairies(engaged)}`,
  );
  const upgradedRooms = upgradeRooms(built.ledger);
  const otherRegionsGained = built.ledger.rooms
    .filter((room) => !upgradedRooms.includes(room))
    .some((room) =>
      room.fairies.some((fairy) => !built.mobs.slice(0, rosterBefore).includes(fairy)),
    );
  report.check(!otherRegionsGained, 'rooms outside the upgraded region gain nothing');

  const upgradeShields = auditShields(built.ledger);
  const secondAfterKill = secondGuarantees(built.ledger, guaranteesBefore);
  const newGuarantees = built.ledger.rooms.filter(
    (room, i) => room.guaranteedShield !== null && guaranteesBefore[i].guarantee === null,
  ).length;
  report.check(
    shieldAuditHolds(upgradeShields) && secondAfterKill === 0,
    'after the upgrade every room holding a fairy holds a shield, and none gained a second guaranteed shield',
    `${describeShieldAudit(upgradeShields)}, ${secondAfterKill} second guarantees, ${newGuarantees} rooms newly guaranteed`,
  );
  const reGuaranteed = cloneLedger(built.ledger);
  const reGuaranteedRoom = reGuaranteed.rooms.find((room) => room.guaranteedShield !== null);
  report.precondition(reGuaranteedRoom !== undefined, 'some room carries a guaranteed shield');
  if (reGuaranteedRoom !== undefined) {
    const extra = extraShieldIn(built.map, reGuaranteedRoom);
    reGuaranteedRoom.fairies.push(extra);
    reGuaranteedRoom.guaranteedShield = extra;
    const reGuaranteedCount = secondGuarantees(reGuaranteed, snapshotGuarantees(built.ledger));
    report.checkCatches(
      reGuaranteedCount === 0,
      'a top-up that adds a second guaranteed shield is caught',
      `${reGuaranteedCount} second guarantees`,
    );
  }

  const rosterBeforeSecond = built.mobs.length;
  built.bus.emit('bossDefeated', { bossType: SWINE_BOSS_TYPE, mob: swine });
  const secondAdded = built.mobs.length - rosterBeforeSecond;
  report.check(secondAdded === 0, 'a second Swine kill adds nothing', `${secondAdded} added`);

  // The guard against a second run is what stops a re-offer: forget it, and a
  // room at two of a possible three eventually rolls its third.
  let unguardedAdded = 0;
  for (let i = 0; i < REPEAT_UPGRADE_TRIES && unguardedAdded === 0; i++) {
    unguardedAdded = applyFairyRateUpgrade(
      cloneLedger(built.ledger),
      SWINE_BOSS_TYPE,
      built.map,
      built.mobs,
      crawlers,
    ).length;
  }
  report.checkCatches(
    unguardedAdded === 0,
    'an upgrade offered again without its once-per-room guard is caught adding fairies',
    `${unguardedAdded} added`,
  );

  // The reload path: a save whose arena reached its second phase (the Swine's
  // death) makes the scene replay the upgrade at build, with no kill event in
  // this session. The boss rooms and the arena are read through the same
  // narrow views the scene reads them through.
  const noRoomsWon = { defeatedBossTypes: new Set<string>() };
  const reloaded = reloadFloor(noRoomsWon, { phase2Active: true }, pastCounts);
  report.precondition(
    reloaded.pastUnderMinimum,
    'the reloaded floor has a past room the replay must top up',
  );
  report.check(
    reloaded.lowestPast >= HARD_POST_SWINE_MIN_FAIRIES && reloaded.beforeGained === 0,
    'a reload with the Swine already dead builds the past rooms at the upgraded rates and no other',
    `fewest ${reloaded.lowestPast} over ${reloaded.pastRooms} past rooms, ${reloaded.beforeGained} before rooms changed`,
  );
  report.check(
    shieldAuditHolds(reloaded.shields),
    'a reloaded floor keeps a shield in every room holding a fairy',
    describeShieldAudit(reloaded.shields),
  );
  const swineAlive = reloadFloor(noRoomsWon, { phase2Active: false }, pastCounts);
  report.precondition(
    swineAlive.pastUnderMinimum,
    'the Swine-alive reload has a past room under the upgraded minimum',
  );
  report.checkCatches(
    swineAlive.lowestPast >= HARD_POST_SWINE_MIN_FAIRIES,
    'a reload whose save has the Swine alive is caught building the past rooms at the base rates',
    `fewest ${swineAlive.lowestPast}`,
  );

  report.check(
    pastCounts.every((count) => count > 0),
    'every built floor 2 has rooms past the Swine safe room',
    `past rooms per floor: ${pastCounts.join(', ')}`,
  );
}

// ── Fairies that fled in ─────────────────────────────────────────────────────

const FLED_IN_BOSS_TYPE = 'fled_in_probe_boss';
const FLED_IN_REGION = 0;
/** A room in the middle of the test arena, the rect its spawn point describes. */
const FLED_IN_POINT = { x: 12, y: 12, w: 9, h: 9, region: FLED_IN_REGION };
/**
 * The kind every fairy a top-up adds is drawn as. Not a shield, so whether the
 * room ends up shielded is down to the guarantee alone.
 */
const TOP_UP_KIND = 'ice';
/** Where in its slot of the kind table a draw lands: the middle, clear of both edges. */
const SLOT_MIDDLE_SHARE = 0.5;
/** A draw landing in {@link TOP_UP_KIND}'s slot of the kind table. */
const TOP_UP_DRAW =
  (REGULAR_FAIRY_KINDS.indexOf(TOP_UP_KIND) + SLOT_MIDDLE_SHARE) / REGULAR_FAIRY_KINDS.length;
/** Every difficulty alike: the roll always succeeds and always wants a full room. */
const EVERY_DIFFICULTY_FULL: Readonly<Record<Difficulty, number>> = {
  easy: MAX_FAIRIES_PER_ROOM,
  normal: MAX_FAIRIES_PER_ROOM,
  hard: MAX_FAIRIES_PER_ROOM,
};
const EVERY_DIFFICULTY_CERTAIN: Readonly<Record<Difficulty, number>> = {
  easy: 1,
  normal: 1,
  hard: 1,
};
const FULL_ROOM_RATE: FairyRoomRate = {
  chance: EVERY_DIFFICULTY_CERTAIN,
  minCount: EVERY_DIFFICULTY_FULL,
  maxCount: EVERY_DIFFICULTY_FULL,
};

/** Floor 2 with one upgrade that fills every room of region 0 the moment the probe boss dies. */
function fullRoomUpgradeDef(): LevelDef {
  const table = level2.fairies;
  if (table === undefined) throw new Error('level2 has no fairy table');
  return {
    ...level2,
    fairies: {
      ...table,
      upgrades: [{ bossType: FLED_IN_BOSS_TYPE, region: FLED_IN_REGION, rate: FULL_ROOM_RATE }],
    },
  };
}

function fairyOn(map: GameMap, kind: FairyKind, tileX: number, tileY: number): Fairy {
  const mob = createMob(FAIRY_SPAWN_KEYS[kind], tileX, tileY, map);
  if (!(mob instanceof Fairy)) throw new Error(`the ${kind} spawn key made no fairy`);
  return mob;
}

interface FledInOutcome {
  /** Fairies the upgrade added that the roll counts: neither the healer nor the guarantee. */
  readonly countedAdded: number;
  readonly guaranteedShield: boolean;
}

/**
 * One room holding `placed` fairies of its own and `fledIn` that flew in from
 * elsewhere, given the full-room upgrade. `blindToFledIn` hands the upgrade
 * only the room's own fairies as the world's mobs — what a spawner that counts
 * `room.fairies` alone sees — so it is the defect under test.
 */
function fledInRun(
  placed: readonly FairyKind[],
  fledIn: readonly FairyKind[],
  blindToFledIn: boolean,
): FledInOutcome {
  const map = makeArena();
  const rect = {
    x: FLED_IN_POINT.x - Math.floor(FLED_IN_POINT.w / 2),
    y: FLED_IN_POINT.y - Math.floor(FLED_IN_POINT.h / 2),
    w: FLED_IN_POINT.w,
    h: FLED_IN_POINT.h,
  };
  const difficulty: Difficulty = 'hard';
  const ledger = new FairyRoomLedger(
    fullRoomUpgradeDef(),
    PARTY_LEVEL,
    DIFFICULTY_PROFILES[difficulty],
    difficulty,
  );
  const room: FairyLedgerRoom = {
    rect,
    spawnBounds: roomSpawnBounds(FLED_IN_POINT),
    region: FLED_IN_REGION,
    band: {},
    fairies: [],
    upgradedBy: new Set(),
    pastSafeRoomOf: new Set(),
    guaranteedShield: null,
  };
  ledger.rooms.push(room);
  const inRoomTile = (index: number) => ({ x: rect.x + 1 + index, y: rect.y + 1 });
  const own = placed.map((kind, index) => {
    const tile = inRoomTile(index);
    return fairyOn(map, kind, tile.x, tile.y);
  });
  room.fairies.push(...own);
  const arrivals = fledIn.map((kind, index) => {
    const tile = inRoomTile(placed.length + index);
    return fairyOn(map, kind, tile.x, tile.y);
  });
  const mobs: Mob[] = blindToFledIn ? [...own] : [...own, ...arrivals];
  const added = applyFairyRateUpgrade(ledger, FLED_IN_BOSS_TYPE, map, mobs, [], () => TOP_UP_DRAW);
  const guarantee = room.guaranteedShield;
  return {
    countedAdded: added.filter((fairy) => fairy.kind !== 'healer' && fairy !== guarantee).length,
    guaranteedShield: guarantee !== null,
  };
}

/** Fairies that fled into a room from a fallen one count as the room's own when it is topped up. */
export function verifyUpgradeCountsFledInFairies(report: FairyGateReport): void {
  report.section("Rate upgrade: fairies that fled in count as the room's own");
  report.precondition(
    REGULAR_FAIRY_KINDS.includes(TOP_UP_KIND),
    'every fairy a top-up adds here is a non-shield kind the table holds',
  );

  const shieldFledIn = fledInRun(['ice'], ['shield'], false);
  report.check(
    !shieldFledIn.guaranteedShield,
    'a room holding a shield fairy that fled in gets no guaranteed shield',
    `guaranteed shield ${shieldFledIn.guaranteedShield ? 'placed' : 'not placed'}`,
  );
  const shieldBlind = fledInRun(['ice'], ['shield'], true);
  report.checkCatches(
    !shieldBlind.guaranteedShield,
    "an upgrade that sees only the room's own fairies is caught guaranteeing a second shield",
    `guaranteed shield ${shieldBlind.guaranteedShield ? 'placed' : 'not placed'}`,
  );

  const fledInCount = 2;
  const expectedTopUp = MAX_FAIRIES_PER_ROOM - fledInCount;
  const topUp = fledInRun([], ['ice', 'fire'], false);
  report.check(
    topUp.countedAdded === expectedTopUp,
    'fairies that fled in count toward what a full-room upgrade tops the room up by',
    `${topUp.countedAdded} added against ${expectedTopUp} expected`,
  );
  const topUpBlind = fledInRun([], ['ice', 'fire'], true);
  report.checkCatches(
    topUpBlind.countedAdded === expectedTopUp,
    "an upgrade that sees only the room's own fairies is caught topping the room up from empty",
    `${topUpBlind.countedAdded} added`,
  );
}
