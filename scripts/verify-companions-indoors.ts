/**
 * The party's companions — Mongo and a Meat Shields hire — go wherever the
 * crawlers go: through a building's door, up and down a tower's storeys, and
 * back out again, at the health they went in with.
 *
 * Driven through the real systems the scenes call (`MongoSystem`,
 * `MercenarySystem`, `carryCompanions`) on real generated interiors. The
 * scenes themselves need a DOM, so the order they call those systems in is
 * checked against their source, each fragment found before its order is
 * trusted — a fragment that is not there fails the check rather than passing
 * it by comparing two misses.
 *
 * Mongo:
 * - Out at the door, he is rebuilt beside the cat indoors at the health he left
 *   with; a pet running home, the circus quest's lock and the knockout latch
 *   all keep him out.
 * - A tower storey change moves him out of the storey being left, roster and
 *   grid both, into the one arrived on, beside the cat, and whatever was
 *   chasing him lets go.
 * - Out at the exit, he walks out with the party, health intact.
 * - His off-duty recovery ticks only while he is not out.
 *
 * The hire:
 * - Stands up indoors from the roster at the health it carried in, and the
 *   building does not re-stamp the floor its contract is judged against.
 * - Climbs the stairs with the party; a hire lying downed on the stairs or at
 *   the door is lost there.
 * - Walks back out at the health it had.
 * - The club's desk signing a contract under the same roof stands the hire up
 *   in the room.
 * - A hire left far behind out of sight, or stuck on its way home, is put back
 *   beside its owner — but never out of a fight, and never one on screen that
 *   is merely far.
 *
 *   npx tsx scripts/verify-companions-indoors.ts
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TILE_SIZE } from '../src/core/constants';
import { setViewportSize } from '../src/core/Viewport';
import { createMongoPetState, type MongoPetState } from '../src/core/MongoPetState';
import { createMercenaryRoster, type MercenaryRoster } from '../src/core/MercenaryRoster';
import { getMercenaryTemplate, type MercenaryTemplateId } from '../src/core/mercenaryTemplates';
import { getMongoStats } from '../src/abilities/mongo';
import { CatPlayer } from '../src/creatures/CatPlayer';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import type { Mob } from '../src/creatures/Mob';
import type { Mercenary } from '../src/creatures/Mercenary';
import {
  HIRELING_CATCH_UP_TILES,
  HIRELING_STUCK_FRAMES,
} from '../src/creatures/mercenaries/hirelingCatchUp';
import { createMob } from '../src/levels/spawner';
import { GameMap } from '../src/map/GameMap';
import { hasRoomToMove } from '../src/map/findWalkableTile';
import { FloorTypeValue, type TileContent } from '../src/map/tileTypes';
import type { Player } from '../src/Player';
import {
  carryCompanions,
  type CarriedCompanion,
  type InteriorCompanionArrival,
  type InteriorCompanionDeparture,
} from '../src/systems/companionCarry';
import type { SystemContext } from '../src/systems/GameSystem';
import { MercenarySystem } from '../src/systems/MercenarySystem';
import { QuillConfrontationSystem } from '../src/systems/QuillConfrontationSystem';
import { EventBus } from '../src/core/EventBus';
import { createMurderQuestProgress } from '../src/core/MurderQuestProgress';
import { createDoomsdayProgress } from '../src/core/DoomsdayProgress';
import { settings } from '../src/core/Settings';
import { BOSS_HEALER_DIFFICULTY } from '../src/levels/fairySpawner';
import { HealingFairy } from '../src/creatures/fairies/HealingFairy';
import { RockThrowSystem } from '../src/systems/RockThrowSystem';
import { HirelingBoltSystem } from '../src/systems/HirelingBoltSystem';
import { MongoSystem } from '../src/systems/MongoSystem';
import { MobRoster } from '../src/systems/kits/SceneWorld';
import { SpellSystem } from '../src/systems/SpellSystem';

// ── Reporting ────────────────────────────────────────────────────────────────

let failures = 0;

function check(ok: boolean, message: string): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) failures++;
}

function section(title: string): void {
  console.log(`\n${title}`);
}

// ── Places ───────────────────────────────────────────────────────────────────

const TILE_CENTER = 0.5;
const OUTDOOR_W_TILES = 48;
const OUTDOOR_H_TILES = 20;
const OUTDOOR_PARTY_TILE = { x: 6, y: 10 } as const;
const STORE_NAME = 'Companion Test Store';
const TOWER_NAME = 'Companion Test Tower';
const GROUND_STOREY = 0;
const UPPER_STOREY = 1;

/**
 * A walled rectangle of floor, optionally split by a solid wall at one column,
 * so a body on one side cannot walk to the other.
 */
function makeRoom(widthTiles: number, heightTiles: number, wallColumn?: number): GameMap {
  const lastX = widthTiles - 1;
  const lastY = heightTiles - 1;
  const grid: TileContent[][] = Array.from({ length: heightTiles }, (_, y) =>
    Array.from({ length: widthTiles }, (_, x) => {
      const border = x === 0 || y === 0 || x === lastX || y === lastY;
      const split = wallColumn !== undefined && x === wallColumn;
      return {
        tileId: `${x}#${y}`,
        type: border || split ? FloorTypeValue.wall : FloorTypeValue.tile_floor,
      };
    }),
  );
  return new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: grid });
}

function makeStore(): GameMap {
  const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
  map.generateInterior('store', GROUND_STOREY, STORE_NAME, false);
  return map;
}

function makeTowerStorey(storey: number): GameMap {
  const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
  map.generateInterior('tower', storey, TOWER_NAME, false);
  return map;
}

interface Party {
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
}

function makeParty(map: GameMap, tile: { readonly x: number; readonly y: number }): Party {
  const human = new HumanPlayer(tile.x, tile.y, TILE_SIZE);
  const cat = new CatPlayer(tile.x + 1, tile.y, TILE_SIZE);
  human.isActive = true;
  cat.isActive = false;
  cat.setMap(map);
  return { human, cat };
}

/** Puts both crawlers on a new map the way a storey change or a door does. */
function placeParty(party: Party, map: GameMap, tile: { readonly x: number; readonly y: number }) {
  party.human.x = tile.x * TILE_SIZE;
  party.human.y = tile.y * TILE_SIZE;
  party.cat.x = (tile.x + 1) * TILE_SIZE;
  party.cat.y = tile.y * TILE_SIZE;
  party.cat.setMap(map);
}

/** Where `changeFloor` sets an ascending party down: clear of the stair it came up. */
function arrivalAbove(map: GameMap): { x: number; y: number } {
  const stair = map._interiorStairDownTiles;
  const first = stair[0] ?? map.startTile;
  const bottom = stair.reduce((lowest, tile) => Math.max(lowest, tile.y), first.y);
  const left = stair.reduce((leftmost, tile) => Math.min(leftmost, tile.x), first.x);
  return { x: left, y: bottom + 1 };
}

function makeRoster(map: GameMap): MobRoster {
  return new MobRoster(map, new SpellSystem());
}

function contextFor(party: Party, map: GameMap, roster: MobRoster, extras: Player[] = []) {
  const active = party.human.isActive ? party.human : party.cat;
  const inactive = active === party.human ? party.cat : party.human;
  const ctx: SystemContext = {
    human: party.human,
    cat: party.cat,
    active,
    inactive,
    activeIsMoving: false,
    roster,
    gameMap: map,
    extraTargets: extras,
  };
  return ctx;
}

function tilesBetween(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y) / TILE_SIZE;
}

function tileUnder(body: { x: number; y: number }): { x: number; y: number } {
  return {
    x: Math.floor((body.x + TILE_SIZE * TILE_CENTER) / TILE_SIZE),
    y: Math.floor((body.y + TILE_SIZE * TILE_CENTER) / TILE_SIZE),
  };
}

/** A query that reaches only the cell a point is in. */
const OWN_CELL_QUERY_RADIUS_PX = 1;

/** Whether the grid has `mob` filed under the position it stands at now. */
function filedWhereItStands(roster: MobRoster, mob: Mob): boolean {
  return roster.grid.queryCircle(mob.x, mob.y, OWN_CELL_QUERY_RADIUS_PX).has(mob);
}

function inRoster(roster: MobRoster, mob: Mob): boolean {
  return roster.mobs.includes(mob) && roster.grid.has(mob);
}

/**
 * How far from the crawler it follows a companion may be set down: the ring a
 * landing search walks, plus the tile it is measured from.
 */
const LANDING_REACH_TILES = 5;

// ── Mongo ────────────────────────────────────────────────────────────────────

const MONGO_LEVEL = 5;
/** Hit points he is short when the party reaches the door. */
const MONGO_WOUND_HP = 7;
/** Frames watched for off-duty recovery: several of its ticks. */
const REGEN_WATCH_FRAMES = 300;
/** Hit points he is short for the recovery check: deep enough to take several ticks. */
const REGEN_WOUND_HP = 42;

function ignore(): void {
  // Nothing in these checks reads XP or announcements.
}

function makeMongoSystem(petState: MongoPetState, unlocked: boolean): MongoSystem {
  const system = new MongoSystem(
    petState,
    () => MONGO_LEVEL,
    ignore,
    () => 0,
    ignore,
  );
  system.unlocked = unlocked;
  return system;
}

function freshPetState(): MongoPetState {
  const maxHp = getMongoStats(MONGO_LEVEL).maxHp;
  return createMongoPetState(maxHp, maxHp);
}

interface Outdoors {
  readonly map: GameMap;
  readonly roster: MobRoster;
  readonly party: Party;
}

function outdoors(): Outdoors {
  const map = makeRoom(OUTDOOR_W_TILES, OUTDOOR_H_TILES);
  return { map, roster: makeRoster(map), party: makeParty(map, OUTDOOR_PARTY_TILE) };
}

/** What `DungeonScene`'s door callback hands the interior, and the dismiss it runs. */
function walkInThroughDoor(system: MongoSystem, from: MobRoster): InteriorCompanionArrival {
  const arrival = { mongoUnlocked: system.unlocked, mongoWasOut: system.followsThroughDoor };
  system.dismiss(from.mobs, from.grid);
  return arrival;
}

/** What the interior's constructor does with the arrival. */
function arriveInside(
  petState: MongoPetState,
  arrival: InteriorCompanionArrival,
  party: Party,
  map: GameMap,
  roster: MobRoster,
): MongoSystem {
  const system = makeMongoSystem(petState, arrival.mongoUnlocked);
  if (!arrival.mongoWasOut) return system;
  const mongo = system.carryIn(party.cat, map);
  if (mongo !== null) roster.add(mongo);
  return system;
}

function checkMongoThroughTheDoor(): void {
  section('Mongo, out at the door, walks in beside the cat at the health he left with');
  const petState = freshPetState();
  const out = outdoors();
  const system = makeMongoSystem(petState, true);
  const mongo = system.summon(out.party.cat, out.map);
  check(mongo !== null, 'he is summoned outdoors');
  if (mongo === null) return;
  out.roster.add(mongo);
  const woundedHp = mongo.maxHp - MONGO_WOUND_HP;
  mongo.hp = woundedHp;

  const arrival = walkInThroughDoor(system, out.roster);
  check(arrival.mongoWasOut, 'he counts as out at the door');
  check(!inRoster(out.roster, mongo), 'the outdoor roster lets him go at the door');
  check(petState.hp === woundedHp, `his health is written into the pet state (${petState.hp})`);

  const store = makeStore();
  const storeRoster = makeRoster(store);
  const party = makeParty(store, store.startTile);
  const inside = arriveInside(petState, arrival, party, store, storeRoster);
  const indoorMongo = inside.mongo;
  check(indoorMongo !== null, 'he is standing inside');
  if (indoorMongo === null) return;
  check(indoorMongo.hp === woundedHp, `inside at ${indoorMongo.hp} of ${woundedHp}`);
  check(inRoster(storeRoster, indoorMongo), 'inside in the room’s roster and grid');
  const reach = tilesBetween(indoorMongo, party.cat);
  check(reach <= LANDING_REACH_TILES, `beside the cat (${reach.toFixed(1)} tiles)`);
  const tile = tileUnder(indoorMongo);
  check(hasRoomToMove(store, tile.x, tile.y), 'on a tile he can move in');

  section('A Mongo who was not coming stays out');
  const recalled = makeMongoSystem(freshPetState(), true);
  const running = recalled.summon(out.party.cat, out.map);
  if (running !== null) {
    out.roster.add(running);
    running.beginRecall();
  }
  check(running !== null && !recalled.followsThroughDoor, 'a pet running home is put away');
  const unsummoned = makeMongoSystem(freshPetState(), true);
  check(!unsummoned.followsThroughDoor, 'a pet never summoned is not carried');
}

function checkMongoLocks(): void {
  section('The circus lock and the knockout latch still keep him out indoors');
  const store = makeStore();
  const party = makeParty(store, store.startTile);
  const arrival: InteriorCompanionArrival = { mongoUnlocked: true, mongoWasOut: true };

  const locked = freshPetState();
  locked.summonLocked = true;
  const lockedInside = arriveInside(locked, arrival, party, store, makeRoster(store));
  check(lockedInside.mongo === null, 'held by the circus, he does not walk in');

  const resting = freshPetState();
  resting.restingUntilFull = true;
  const restingInside = arriveInside(resting, arrival, party, store, makeRoster(store));
  check(restingInside.mongo === null, 'resting after a knockout, he does not walk in');

  const locker = makeMongoSystem(freshPetState(), true);
  locker.summonLocked = true;
  check(locker.summon(party.cat, store) === null, 'and the Summon key refuses him indoors too');

  const unknown = arriveInside(
    freshPetState(),
    { mongoUnlocked: false, mongoWasOut: true },
    party,
    store,
    makeRoster(store),
  );
  check(unknown.mongo === null, 'a pet the run has not unlocked never appears');
}

/** A hostile standing on `map`, holding `body` as its target. */
function hostileChasing(map: GameMap, roster: MobRoster, body: Mob, at: { x: number; y: number }) {
  const hostile = createMob('goblin', at.x, at.y, map);
  roster.add(hostile);
  hostile.currentTarget = body;
  hostile.retaliateMob = body;
  return hostile;
}

function checkStoreyCarry(): void {
  section('A storey change carries Mongo and the hire to the new storey, roster and grid');
  const ground = makeTowerStorey(GROUND_STOREY);
  const upper = makeTowerStorey(UPPER_STOREY);
  const groundRoster = makeRoster(ground);
  const upperRoster = makeRoster(upper);
  const party = makeParty(ground, ground.startTile);

  const mongoSystem = makeMongoSystem(freshPetState(), true);
  const mongo = mongoSystem.carryIn(party.cat, ground);
  check(mongo !== null, 'Mongo is out on the ground storey');
  if (mongo === null) return;
  groundRoster.add(mongo);
  mongo.hp = mongo.maxHp - MONGO_WOUND_HP;
  const mongoHp = mongo.hp;

  const roster = hireRoster('sledge');
  const mercSystem = new MercenarySystem(roster, null);
  mercSystem.update(contextFor(party, ground, groundRoster));
  const merc = mercSystem.activeMerc;
  check(merc !== null, 'the hire stands on the ground storey');
  if (merc === null) return;
  const mercHp = merc.hp;

  const chaser = hostileChasing(ground, groundRoster, mongo, ground.startTile);

  placeParty(party, upper, arrivalAbove(upper));
  const companions: CarriedCompanion[] = [
    mongoSystem.asCarriedCompanion(party.cat),
    mercSystem.asCarriedCompanion(),
  ];
  mercSystem.leaveStorey(groundRoster.mobs, groundRoster.grid);
  carryCompanions(companions, groundRoster, upperRoster, upper);

  for (const [name, body, hp] of [
    ['Mongo', mongo, mongoHp],
    ['the hire', merc, mercHp],
  ] as const) {
    check(!groundRoster.mobs.includes(body), `${name} has left the ground storey’s roster`);
    check(!groundRoster.grid.has(body), `${name} has left the ground storey’s grid`);
    check(inRoster(upperRoster, body), `${name} is in the upper storey’s roster and grid`);
    check(filedWhereItStands(upperRoster, body), `${name} is filed where it stands`);
    const follows = body === mongo ? party.cat : party.human;
    const reach = tilesBetween(body, follows);
    check(reach <= LANDING_REACH_TILES, `${name} lands beside the party (${reach.toFixed(1)})`);
    check(body.hp === hp, `${name} keeps its health (${body.hp} of ${hp})`);
  }
  check(
    chaser.currentTarget === null && chaser.retaliateMob === null,
    'the storey left behind lets go of him',
  );
  check(mongo.allMobs === upperRoster.mobs, 'Mongo reads the new storey’s mobs at once');
  check(merc.allMobs === upperRoster.mobs, 'the hire reads the new storey’s mobs at once');

  section('A script resetting the party on one storey takes the companions along');
  const faraway = { x: mongo.x, y: mongo.y };
  const partyBack = arrivalAbove(upper);
  const openTile = findOpenTileAway(upper, partyBack);
  if (openTile !== null) {
    placeParty(party, upper, openTile);
  }
  carryCompanions(companions, upperRoster, upperRoster, upper);
  const moved = Math.hypot(mongo.x - faraway.x, mongo.y - faraway.y) > 0;
  check(openTile !== null && moved, 'Mongo is moved to the party’s new mark');
  check(filedWhereItStands(upperRoster, mongo), 'and re-filed in the grid where he now stands');
  check(upperRoster.mobs.filter((mob) => mob === mongo).length === 1, 'and listed once, not twice');
}

/** The walkable tile furthest from `from` that has room to move, for a reset mark. */
function findOpenTileAway(map: GameMap, from: { x: number; y: number }) {
  let best: { x: number; y: number } | null = null;
  let bestDistance = 0;
  for (let y = 0; y < map.structure.length; y++) {
    const row = map.structure[y];
    for (let x = 0; x < row.length; x++) {
      if (!map.isWalkable(x, y) || !hasRoomToMove(map, x, y) || !map.isWalkable(x + 1, y)) {
        continue;
      }
      const distance = Math.hypot(x - from.x, y - from.y);
      if (distance > bestDistance) {
        bestDistance = distance;
        best = { x, y };
      }
    }
  }
  return best;
}

function checkMongoWalksOut(): void {
  section('Out at the exit, Mongo walks out with the party, health intact');
  const petState = freshPetState();
  const store = makeStore();
  const storeRoster = makeRoster(store);
  const party = makeParty(store, store.startTile);
  const inside = makeMongoSystem(petState, true);
  const mongo = inside.carryIn(party.cat, store);
  check(mongo !== null, 'he is out indoors');
  if (mongo === null) return;
  storeRoster.add(mongo);
  mongo.hp = mongo.maxHp - MONGO_WOUND_HP;
  const woundedHp = mongo.hp;

  // What the interior's `doExit` hands back, and the dismiss it runs.
  const departure: InteriorCompanionDeparture = { mongoWasOut: inside.followsThroughDoor };
  inside.dismiss(storeRoster.mobs, storeRoster.grid);

  const out = outdoors();
  const outside = makeMongoSystem(petState, true);
  const back = departure.mongoWasOut ? outside.carryIn(out.party.cat, out.map) : null;
  check(departure.mongoWasOut, 'he counts as out at the exit');
  check(back !== null && back.hp === woundedHp, `outside at ${back?.hp ?? 0} of ${woundedHp}`);
}

function checkRegenOnlyOffDuty(): void {
  section('His recovery ticks while he is put away indoors, never while he is out');
  const petState = freshPetState();
  const maxHp = petState.hp;
  petState.hp = maxHp - REGEN_WOUND_HP;
  const store = makeStore();
  const roster = makeRoster(store);
  const party = makeParty(store, store.startTile);
  const system = makeMongoSystem(petState, true);
  const mongo = system.carryIn(party.cat, store);
  check(mongo !== null, 'he is out indoors');
  if (mongo === null) return;
  roster.add(mongo);
  const liveHp = mongo.hp;
  const storedHp = petState.hp;
  const ctx = contextFor(party, store, roster);
  for (let f = 0; f < REGEN_WATCH_FRAMES; f++) system.update(ctx);
  check(petState.hp === storedHp, `out: the stored health does not move (${petState.hp})`);
  check(mongo.hp === liveHp, `out: nor does his own (${mongo.hp})`);

  system.dismiss(roster.mobs, roster.grid);
  const putAwayHp = petState.hp;
  for (let f = 0; f < REGEN_WATCH_FRAMES; f++) system.update(ctx);
  check(petState.hp > putAwayHp, `put away: he recovers (${putAwayHp} → ${petState.hp})`);
}

// ── The hire ─────────────────────────────────────────────────────────────────

const HIRE_FLOOR = 'level3';
const OTHER_FLOOR = 'level2';
/** Hit points the hire is short when the party reaches the door. */
const HIRE_WOUND_HP = 11;
/** Far more than any single blow a hire can take: puts it straight down. */
const LETHAL_DAMAGE = 100_000;

function hireRoster(id: MercenaryTemplateId, hp?: number): MercenaryRoster {
  const roster = createMercenaryRoster();
  roster.floorLevelId = HIRE_FLOOR;
  roster.active = {
    id,
    name: getMercenaryTemplate(id).name,
    contractLevelId: HIRE_FLOOR,
    introduced: true,
    hp,
  };
  return roster;
}

function knockDown(system: MercenarySystem, merc: Mercenary): void {
  merc.takeDamage(LETHAL_DAMAGE);
  system.checkHealth();
}

function checkHireThroughTheDoor(): void {
  section('The hire walks in, stands up beside the party, and walks back out');
  const out = outdoors();
  const roster = hireRoster('sledge');
  const outside = new MercenarySystem(roster, HIRE_FLOOR);
  outside.update(contextFor(out.party, out.map, out.roster));
  const merc = outside.activeMerc;
  check(merc !== null, 'the hire stands outdoors');
  if (merc === null) return;
  const woundedHp = merc.maxHp - HIRE_WOUND_HP;
  merc.hp = woundedHp;
  outside.dismissForTransition(out.roster.mobs, out.roster.grid);
  check(!inRoster(out.roster, merc), 'the outdoor roster lets it go at the door');
  check(roster.active?.hp === woundedHp, `its health rides the roster (${roster.active?.hp})`);

  const store = makeStore();
  const storeRoster = makeRoster(store);
  const party = makeParty(store, store.startTile);
  const inside = new MercenarySystem(roster, null);
  inside.update(contextFor(party, store, storeRoster));
  const indoor = inside.activeMerc;
  check(indoor !== null, 'it stands inside');
  check(indoor?.hp === woundedHp, `inside at ${indoor?.hp ?? 0} of ${woundedHp}`);
  check(roster.floorLevelId === HIRE_FLOOR, 'the building leaves the floor stamp alone');
  const reach = indoor === null ? Infinity : tilesBetween(indoor, party.human);
  check(reach <= LANDING_REACH_TILES, `beside its owner (${reach.toFixed(1)} tiles)`);

  const stamped = hireRoster('sledge');
  new MercenarySystem(stamped, OTHER_FLOOR).update(contextFor(party, store, makeRoster(store)));
  check(
    stamped.active === null,
    'negative: a building that stamped a floor of its own is caught losing the contract',
  );

  if (indoor === null) return;
  indoor.hp = woundedHp - HIRE_WOUND_HP;
  const exitHp = indoor.hp;
  inside.dismissForTransition(storeRoster.mobs, storeRoster.grid);
  const back = new MercenarySystem(roster, HIRE_FLOOR);
  back.update(contextFor(out.party, out.map, makeRoster(out.map)));
  check(
    back.activeMerc?.hp === exitHp,
    `outside again at ${back.activeMerc?.hp ?? 0} of ${exitHp}`,
  );
}

function checkDownedHireIsLost(): void {
  section('A hire lying downed at the stairs or the door is lost there');
  const ground = makeTowerStorey(GROUND_STOREY);
  const upper = makeTowerStorey(UPPER_STOREY);
  const groundRoster = makeRoster(ground);
  const upperRoster = makeRoster(upper);
  const party = makeParty(ground, ground.startTile);
  const roster = hireRoster('sledge');
  const hireName = roster.active?.name ?? '';
  const system = new MercenarySystem(roster, null);
  system.update(contextFor(party, ground, groundRoster));
  const merc = system.activeMerc;
  check(merc !== null, 'the hire stands on the ground storey');
  if (merc === null) return;
  knockDown(system, merc);
  check(system.downedMerc === merc, 'it is down');

  placeParty(party, upper, arrivalAbove(upper));
  system.leaveStorey(groundRoster.mobs, groundRoster.grid);
  carryCompanions([system.asCarriedCompanion()], groundRoster, upperRoster, upper);
  check(roster.active === null, 'on the stairs: its contract is over');
  check(roster.lastDeceased === hireName, 'and the desk will hear of it');
  check(!inRoster(groundRoster, merc) && !inRoster(upperRoster, merc), 'and no body is carried');

  const doorRoster = hireRoster('sledge');
  const store = makeStore();
  const storeRoster = makeRoster(store);
  const storeParty = makeParty(store, store.startTile);
  const doorSystem = new MercenarySystem(doorRoster, null);
  doorSystem.update(contextFor(storeParty, store, storeRoster));
  const doorMerc = doorSystem.activeMerc;
  if (doorMerc !== null) knockDown(doorSystem, doorMerc);
  doorSystem.dismissForTransition(storeRoster.mobs, storeRoster.grid);
  check(doorMerc !== null && doorRoster.active === null, 'at the door: its contract is over');
}

function checkDeskUnderTheSameRoof(): void {
  section('A contract signed at the desk stands its hire up in the room');
  const store = makeStore();
  const roster = makeRoster(store);
  const party = makeParty(store, store.startTile);
  const hires = createMercenaryRoster();
  hires.floorLevelId = HIRE_FLOOR;
  const system = new MercenarySystem(hires, null);
  const ctx = contextFor(party, store, roster);
  system.update(ctx);
  check(system.activeMerc === null, 'nobody stands for an empty roster');
  hires.active = hireRoster('bomo').active;
  // What the interior does on the frame it sees the roster change.
  system.onContractChanged(roster.mobs, roster.grid);
  system.update(ctx);
  check(system.activeMerc !== null, 'the new hire is standing in the room');
  const first = system.activeMerc;
  hires.active = null;
  system.onContractChanged(roster.mobs, roster.grid);
  system.update(ctx);
  check(
    system.activeMerc === null && (first === null || !roster.mobs.includes(first)),
    'a contract ended at the desk takes its hire out of the room',
  );
}

// ── Catch-up ─────────────────────────────────────────────────────────────────

/** A laptop-sized screen: the whole outdoor room does not fit on it. */
const SMALL_SCREEN_W = 640;
const SMALL_SCREEN_H = 480;
/** A screen far bigger than any room here: everything is on it. */
const HUGE_SCREEN_PX = 100_000;
/** Tiles past the catch-up distance the hire is left at. */
const BEYOND_CATCH_UP_TILES = 4;
/** The split room for the stuck check: owner west of the wall, hire east. */
const SPLIT_ROOM_W_TILES = 20;
const SPLIT_ROOM_H_TILES = 12;
const SPLIT_WALL_COLUMN = 10;
const SPLIT_OWNER_TILE = { x: 4, y: 6 } as const;
const SPLIT_HIRE_TILE = { x: 14, y: 6 } as const;
/**
 * Frames the stuck hire is watched for: its walk up to the wall, then the whole
 * stuck window, with room to spare.
 */
const STUCK_WATCH_WINDOWS = 3;
const STUCK_WATCH_FRAMES = HIRELING_STUCK_FRAMES * STUCK_WATCH_WINDOWS;
/**
 * How far from its owner the hire starts its walk home: long enough that the
 * walk outlasts the stuck window several times over, so a stuck test that
 * counted walking frames would jump it.
 */
const LONG_WALK_TILES = 36;
/** Frames the long walk home is watched for any jump. */
const OPEN_WALK_FRAMES = 1500;

interface CatchUpRun {
  readonly movedTiles: number;
  readonly reachAfterTiles: number;
  readonly filed: boolean;
}

/** One frame of a hire's life in these checks: its own AI, then the system. */
function tick(system: MercenarySystem, merc: Mercenary, ctx: SystemContext): void {
  merc.updateAI([]);
  system.update(ctx);
}

function farBehind(screen: 'small' | 'huge', engaged: boolean): CatchUpRun | null {
  if (screen === 'small') setViewportSize(SMALL_SCREEN_W, SMALL_SCREEN_H);
  else setViewportSize(HUGE_SCREEN_PX, HUGE_SCREEN_PX);
  const out = outdoors();
  const system = new MercenarySystem(hireRoster('sledge'), HIRE_FLOOR);
  const ctx = contextFor(out.party, out.map, out.roster);
  system.update(ctx);
  const merc = system.activeMerc;
  if (merc === null) return null;
  const farX = OUTDOOR_PARTY_TILE.x + HIRELING_CATCH_UP_TILES + BEYOND_CATCH_UP_TILES;
  const before = { x: merc.x, y: merc.y };
  merc.x = farX * TILE_SIZE;
  merc.y = OUTDOOR_PARTY_TILE.y * TILE_SIZE;
  out.roster.grid.move(merc, before.x, before.y);
  if (engaged) hostileChasing(out.map, out.roster, merc, { x: farX + 1, y: OUTDOOR_PARTY_TILE.y });
  const left = { x: merc.x, y: merc.y };
  system.update(ctx);
  return {
    movedTiles: tilesBetween(merc, left),
    reachAfterTiles: tilesBetween(merc, out.party.human),
    filed: filedWhereItStands(out.roster, merc),
  };
}

function checkCatchUp(): void {
  section('A hire left far behind out of sight is put back beside its owner');
  const unseen = farBehind('small', false);
  check(
    unseen !== null && unseen.reachAfterTiles <= LANDING_REACH_TILES && unseen.filed,
    `far and off screen: back beside its owner and filed there (${unseen?.reachAfterTiles.toFixed(1)} tiles)`,
  );
  const seen = farBehind('huge', false);
  check(seen !== null && seen.movedTiles === 0, 'far but on screen: left to walk');
  const fighting = farBehind('small', true);
  check(
    fighting !== null && fighting.movedTiles === 0,
    'far and unseen but engaged: left to fight',
  );

  section('A hire stuck on its way home is put back beside its owner, and not a frame early');
  setViewportSize(HUGE_SCREEN_PX, HUGE_SCREEN_PX);
  const map = makeRoom(SPLIT_ROOM_W_TILES, SPLIT_ROOM_H_TILES, SPLIT_WALL_COLUMN);
  const roster = makeRoster(map);
  const party = makeParty(map, SPLIT_OWNER_TILE);
  const system = new MercenarySystem(hireRoster('sledge'), HIRE_FLOOR);
  const ctx = contextFor(party, map, roster);
  system.update(ctx);
  const merc = system.activeMerc;
  check(merc !== null, 'the hire stands');
  if (merc === null) return;
  const before = { x: merc.x, y: merc.y };
  merc.x = SPLIT_HIRE_TILE.x * TILE_SIZE;
  merc.y = SPLIT_HIRE_TILE.y * TILE_SIZE;
  roster.grid.move(merc, before.x, before.y);
  merc.onTeleported();
  const walledOff = tileUnder(merc).x > SPLIT_WALL_COLUMN;
  let crossedAt = -1;
  // Read before each frame: the move that crosses resets it.
  let stuckBeforeCrossing = 0;
  for (let f = 0; f < STUCK_WATCH_FRAMES && crossedAt < 0; f++) {
    stuckBeforeCrossing = merc.followStallFrames;
    tick(system, merc, ctx);
    if (tileUnder(merc).x < SPLIT_WALL_COLUMN) crossedAt = f;
  }
  check(walledOff, 'it starts on the far side of the wall');
  check(crossedAt >= 0, `it is put on the owner’s side (frame ${crossedAt})`);
  // The frame that moves it adds the last stalled frame before the system acts.
  const lastStalledFrame = 1;
  check(
    stuckBeforeCrossing + lastStalledFrame >= HIRELING_STUCK_FRAMES,
    `only once it has been stuck for the window (${stuckBeforeCrossing + lastStalledFrame} of ${HIRELING_STUCK_FRAMES} frames)`,
  );
  check(filedWhereItStands(roster, merc), 'filed in the grid where it now stands');

  section('A hire walking a long way home unhindered is never jumped');
  const open = makeRoom(OUTDOOR_W_TILES, OUTDOOR_H_TILES);
  const openRoster = makeRoster(open);
  const openParty = makeParty(open, OUTDOOR_PARTY_TILE);
  const openSystem = new MercenarySystem(hireRoster('sledge'), HIRE_FLOOR);
  const openCtx = contextFor(openParty, open, openRoster);
  openSystem.update(openCtx);
  const walker = openSystem.activeMerc;
  if (walker === null) {
    check(false, 'the hire stands');
    return;
  }
  const start = { x: walker.x, y: walker.y };
  walker.x = (OUTDOOR_PARTY_TILE.x + LONG_WALK_TILES) * TILE_SIZE;
  walker.y = OUTDOOR_PARTY_TILE.y * TILE_SIZE;
  openRoster.grid.move(walker, start.x, start.y);
  walker.onTeleported();
  let biggestStepTiles = 0;
  for (let f = 0; f < OPEN_WALK_FRAMES; f++) {
    const was = { x: walker.x, y: walker.y };
    tick(openSystem, walker, openCtx);
    biggestStepTiles = Math.max(biggestStepTiles, tilesBetween(walker, was));
  }
  check(biggestStepTiles < 1, `its biggest single step is ${biggestStepTiles.toFixed(2)} tiles`);
  check(
    tilesBetween(walker, openParty.human) <= LANDING_REACH_TILES,
    'and it got home on its own feet',
  );
}

// ── A mob a script holds out of the fight ────────────────────────────────────

/** Frames a companion is given beside a held mob: ample time to have bitten it. */
const HELD_WATCH_FRAMES = 600;
const HELD_ROOM_W_TILES = 20;
const HELD_ROOM_H_TILES = 12;
const HELD_PARTY_TILE = { x: 6, y: 6 } as const;
/** Frames between the scratches the cat takes while a held mob stands beside her. */
const CAT_WOUND_EVERY_FRAMES = 30;
/** Tiles from the companion to the held mob: inside every engage radius. */
const HELD_FOE_OFFSET_TILES = 2;

/** HP the held mob loses while a companion stands beside it, held and then let go. */
interface HeldOutcome {
  readonly lostWhileHeld: number;
  readonly lostOnceReleased: number;
}

function heldFoeBeside(
  map: GameMap,
  roster: MobRoster,
  body: { readonly x: number; readonly y: number },
): Mob {
  const tile = tileUnder(body);
  const foe = createMob('goblin', tile.x + HELD_FOE_OFFSET_TILES, tile.y, map);
  roster.add(foe);
  foe.hp = foe.maxHp;
  foe.aiHeld = true;
  foe.offLimitsToAllies = true;
  return foe;
}

/** Runs `frame` beside a held goblin, then again once it is let go. */
function watchHeldFoe(foe: Mob, frame: () => void): HeldOutcome {
  const full = foe.hp;
  for (let f = 0; f < HELD_WATCH_FRAMES; f++) frame();
  const lostWhileHeld = full - foe.hp;
  foe.hp = foe.maxHp;
  foe.aiHeld = false;
  foe.offLimitsToAllies = false;
  for (let f = 0; f < HELD_WATCH_FRAMES && foe.hp === foe.maxHp; f++) frame();
  return { lostWhileHeld, lostOnceReleased: foe.maxHp - foe.hp };
}

function checkHeldMobsAreOffLimits(): void {
  section('A mob a script is holding out of the fight is left alone by the companions');
  const map = makeRoom(HELD_ROOM_W_TILES, HELD_ROOM_H_TILES);
  const roster = makeRoster(map);
  const party = makeParty(map, HELD_PARTY_TILE);
  party.human.isActive = false;
  party.cat.isActive = true;
  const ctx = contextFor(party, map, roster);
  const mongoSystem = makeMongoSystem(freshPetState(), true);
  const mongo = mongoSystem.summon(party.cat, map);
  if (mongo === null) {
    check(false, 'Mongo is out');
  } else {
    roster.add(mongo);
    const foe = heldFoeBeside(map, roster, mongo);
    const outcome = watchHeldFoe(foe, () => {
      mongoSystem.update(ctx);
      mongo.updateAI([]);
    });
    check(outcome.lostWhileHeld === 0, `Mongo leaves it be (${outcome.lostWhileHeld} HP taken)`);
    check(outcome.lostOnceReleased > 0, 'and goes for it once the script lets it go');
    roster.grid.remove(foe);
    roster.mobs.splice(roster.mobs.indexOf(foe), 1);
    mongoSystem.dismiss(roster.mobs, roster.grid);
  }

  party.human.isActive = true;
  party.cat.isActive = false;
  const hireCtx = contextFor(party, map, roster);
  const hire = new MercenarySystem(hireRoster('sledge'), HIRE_FLOOR);
  hire.update(hireCtx);
  const merc = hire.activeMerc;
  if (merc === null) {
    check(false, 'the hire stands');
    return;
  }
  const foe = heldFoeBeside(map, roster, merc);
  const outcome = watchHeldFoe(foe, () => {
    merc.updateAI([]);
    hire.update(hireCtx);
  });
  check(outcome.lostWhileHeld === 0, `the hire leaves it be (${outcome.lostWhileHeld} HP taken)`);
  check(outcome.lostOnceReleased > 0, 'and goes for it once the script lets it go');

  roster.grid.remove(foe);
  roster.mobs.splice(roster.mobs.indexOf(foe), 1);

  // Sledge answers whoever hurts the cat. A held mob beside her when she bleeds
  // is the nearest suspect, and must not be the one he goes for.
  const guardian = new MercenarySystem(hireRoster('sledge'), HIRE_FLOOR);
  const guardCtx = contextFor(party, map, roster);
  hire.dismiss(roster.mobs, roster.grid);
  guardian.update(guardCtx);
  const sledge = guardian.activeMerc;
  if (sledge !== null) {
    const suspect = heldFoeBeside(map, roster, party.cat);
    let frame = 0;
    const suspectOutcome = watchHeldFoe(suspect, () => {
      frame++;
      if (frame % CAT_WOUND_EVERY_FRAMES === 0) party.cat.hp = Math.max(1, party.cat.hp - 1);
      sledge.updateAI([]);
      guardian.update(guardCtx);
    });
    check(
      suspectOutcome.lostWhileHeld === 0,
      `a held mob beside a wounded cat is not taken for her attacker (${suspectOutcome.lostWhileHeld} HP taken)`,
    );
  } else {
    check(false, 'Sledge stands');
  }

  const quill = readFileSync(QUILL_PATH, 'utf8');
  const banner = methodBody(quill, 'private holdRoomForBanner(): void {');
  const release = methodBody(quill, 'private releaseRoom(): void {');
  check(
    banner?.includes('mob.offLimitsToAllies = true;') === true &&
      release?.includes('mob.offLimitsToAllies = false;') === true,
    'the tower’s intro card puts its culprits off limits, and lets them go with the card',
  );
}

// ── The tower's intro card on the hardest difficulty ─────────────────────────

const TOWER_TOP_STOREY = 3;
/** Party level for the confrontation: any level spawns the same room. */
const CONFRONTATION_PARTY_LEVEL = 30;

function checkQuillHealerHeld(): void {
  section('On the hardest difficulty, the boss healer is held off limits with the room');
  const previous = settings.difficulty;
  settings.setDifficultyForSession(BOSS_HEALER_DIFFICULTY);
  const map = makeTowerStorey(TOWER_TOP_STOREY);
  const roster = makeRoster(map);
  const spawned: Mob[] = [];
  const progress = createMurderQuestProgress();
  progress.stage = 'confrontation';
  // The re-entry path, which opens straight onto the fight and its card.
  progress.officeSceneSeen = true;
  new QuillConfrontationSystem(
    map,
    new EventBus(),
    (mob) => {
      spawned.push(mob);
      roster.add(mob);
    },
    progress,
    null,
    createDoomsdayProgress(),
    CONFRONTATION_PARTY_LEVEL,
  );
  settings.setDifficultyForSession(previous);
  const healers = spawned.filter((mob) => mob instanceof HealingFairy);
  check(healers.length > 0, `a healer is in the room (${healers.length})`);
  check(
    healers.every((healer) => healer.aiHeld && healer.offLimitsToAllies),
    'and held out of the fight with everyone else for the card',
  );
}

// ── A hire's shots indoors ───────────────────────────────────────────────────

/** Past a fist's reach: damage landing on a foe this far off came through the air. */
const FIST_REACH_TILES = 2;
/** The nearest and furthest a ranged foe is set from the hire. */
const RANGED_FOE_MIN_TILES = 4;
const RANGED_FOE_MAX_TILES = 6;
const RANGED_BUDGET_FRAMES = 600;

/** A tile a shot can reach from `from`: open, in sight, and out of fist reach. */
function rangedFoeTile(map: GameMap, from: { x: number; y: number }) {
  for (let y = 0; y < map.structure.length; y++) {
    for (let x = 0; x < (map.structure[y]?.length ?? 0); x++) {
      const distance = Math.hypot(x - from.x, y - from.y);
      if (distance < RANGED_FOE_MIN_TILES || distance > RANGED_FOE_MAX_TILES) continue;
      if (!map.isWalkable(x, y) || !hasRoomToMove(map, x, y)) continue;
      const inSight = map.hasLineOfSight(
        (from.x + TILE_CENTER) * TILE_SIZE,
        (from.y + TILE_CENTER) * TILE_SIZE,
        (x + TILE_CENTER) * TILE_SIZE,
        (y + TILE_CENTER) * TILE_SIZE,
      );
      if (inSight) return { x, y };
    }
  }
  return null;
}

/**
 * HP a foe out of fist reach loses to a hire standing still in a shop, with the
 * room's frame run the way the interior runs it. `flyShots` false leaves the
 * projectile systems out, which is the room a shot never leaves.
 */
function rangedDamageIndoors(id: MercenaryTemplateId, flyShots: boolean): number {
  const store = makeStore();
  const roster = makeRoster(store);
  const party = makeParty(store, store.startTile);
  const system = new MercenarySystem(hireRoster(id), null);
  const ctx = contextFor(party, store, roster);
  system.update(ctx);
  const merc = system.activeMerc;
  if (merc === null) return 0;
  const post = tileUnder(merc);
  const foeTile = rangedFoeTile(store, post);
  if (foeTile === null) return 0;
  const foe = createMob('goblin', foeTile.x, foeTile.y, store);
  roster.add(foe);
  foe.aiHeld = true;
  const rocks = new RockThrowSystem(store);
  const bolts = new HirelingBoltSystem(store, () => false);
  let lostAtRange = 0;
  for (let f = 0; f < RANGED_BUDGET_FRAMES; f++) {
    const before = { x: merc.x, y: merc.y };
    merc.x = post.x * TILE_SIZE;
    merc.y = post.y * TILE_SIZE;
    roster.grid.move(merc, before.x, before.y);
    const hpBefore = foe.hp;
    merc.updateAI([]);
    system.update(ctx);
    if (flyShots) {
      rocks.update(ctx);
      bolts.update(ctx);
    } else {
      merc.takePendingThrows();
      merc.takePendingShots();
    }
    if (foe.hp < hpBefore && tilesBetween(merc, foe) > FIST_REACH_TILES) {
      lostAtRange += hpBefore - foe.hp;
    }
    foe.hp = foe.maxHp;
  }
  return lostAtRange;
}

function checkHireShotsIndoors(): void {
  section('A water mage’s bolts and a golem’s boulders land indoors');
  for (const [id, name] of [
    ['splash_zone', 'the water mage'],
    ['tumbledown', 'the golem'],
  ] as const) {
    const landed = rangedDamageIndoors(id, true);
    check(landed > 0, `${name} hurts a foe out of fist reach (${landed} HP)`);
    const grounded = rangedDamageIndoors(id, false);
    check(
      grounded === 0,
      `negative: a room that never flies ${name}’s shots is caught (${grounded} HP)`,
    );
  }
}

// ── The scenes call these in the right order ─────────────────────────────────

const SCENES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'scenes');
const INTERIOR_SCENE_PATH = resolve(SCENES_DIR, 'BuildingInteriorScene.ts');
const DUNGEON_SCENE_PATH = resolve(SCENES_DIR, 'DungeonScene.ts');
const INPUT_HANDLER_PATH = resolve(SCENES_DIR, '..', 'systems', 'GameplayInputHandler.ts');
const MERC_SYSTEM_PATH = resolve(SCENES_DIR, '..', 'systems', 'MercenarySystem.ts');
const QUILL_PATH = resolve(SCENES_DIR, '..', 'systems', 'QuillConfrontationSystem.ts');

/** The source of one method, from its signature to the closing brace at method depth. */
function methodBody(source: string, signature: string): string | null {
  const start = source.indexOf(signature);
  if (start < 0) return null;
  const end = source.indexOf('\n  }\n', start);
  return end < 0 ? null : source.slice(start, end);
}

/** The source between the first `from` and the next `to` after it. */
function between(source: string, from: string, to: string): string | null {
  const start = source.indexOf(from);
  if (start < 0) return null;
  const end = source.indexOf(to, start + from.length);
  return end < 0 ? null : source.slice(start, end + to.length);
}

/** Whether `first` and `second` both appear in `text`, `first` ahead of `second`. */
function inOrder(text: string | null, first: string, second: string): boolean {
  if (text === null) return false;
  const a = text.indexOf(first);
  const b = text.indexOf(second, a < 0 ? 0 : a);
  return a >= 0 && b > a;
}

function checkSceneWiring(): void {
  section('The interior calls the companions where the dungeon does');
  const interior = readFileSync(INTERIOR_SCENE_PATH, 'utf8');
  const combat = methodBody(interior, 'private updateCombat(): void {');
  check(combat !== null, 'the interior’s combat frame is found');
  check(
    inOrder(combat, 'this.mongoSystem.checkHealth()', 'combat.resolveKills()'),
    'Mongo’s lethal hit is intercepted before kills resolve',
  );
  check(
    inOrder(combat, 'this.mercenarySystem.checkHealth(', 'combat.resolveKills()'),
    'the hire’s lethal hit is intercepted before kills resolve',
  );
  check(
    inOrder(combat, 'combat.resolveKills()', 'this.mongoSystem.update(ctx)'),
    'Mongo’s system runs after kills resolve',
  );
  const context = methodBody(interior, 'private buildSystemContext(): SystemContext {');
  check(
    context?.includes('extraTargets: this.companionTargets()') === true,
    'hostiles are handed the companions as targets',
  );
  check(!interior.includes('tickMongoRegen('), 'no second regen tick runs beside his system');
  check(
    interior.includes('mongoSummon: () => this.toggleMongoSummon()'),
    'the Summon key is bound',
  );
  const changeFloor = methodBody(interior, 'private changeFloor(newFloor: number): void {');
  check(
    inOrder(changeFloor, 'this.companion.setMap(', 'carryCompanions('),
    'a storey change carries the companions after the party is placed',
  );
  check(
    inOrder(changeFloor, 'this.mercenarySystem.leaveStorey(', 'carryCompanions('),
    'and settles a downed hire before it carries anyone',
  );
  const doExit = methodBody(interior, 'private doExit(defeated = false): void {');
  check(
    inOrder(doExit, 'this.companionDeparture()', 'this.mongoSystem.dismiss('),
    'the exit reads who walks out before putting Mongo away',
  );
  check(
    inOrder(doExit, 'this.mercenarySystem.dismissForTransition(', 'this.onExitCallback('),
    'the exit writes the hire’s health before the next scene is built',
  );

  section('The overworld door hands Mongo across');
  const dungeon = readFileSync(DUNGEON_SCENE_PATH, 'utf8');
  const door = between(dungeon, 'this.building = new BuildingSystem(', 'blockedMessage:');
  check(door !== null, 'the building door’s callback is found');
  check(
    inOrder(door, 'mongoWasOut: this.mongoSystem.followsThroughDoor', 'this.mongoSystem.dismiss('),
    'the door reads whether he was out before putting him away',
  );
  check(
    inOrder(door, 'this.mongoSystem.dismiss(', 'new BuildingInteriorScene('),
    'and puts him away before the interior is built',
  );
  check(
    door?.includes('mongoWasOut: companionDeparture.mongoWasOut') === true,
    'the rebuilt overworld is told he walked out',
  );
  const gameplay = methodBody(dungeon, 'private updateGameplay(): void {');
  check(
    inOrder(gameplay, 'this.carryMongoIn();', 'this.mongoSystem.update(ctx);'),
    'the rebuilt overworld puts him down on its first frame, ahead of his system',
  );
  const carryIn = methodBody(dungeon, 'private carryMongoIn(): void {');
  check(
    inOrder(carryIn, 'this.mongoSystem.carryIn(', 'this.world.roster.add('),
    'beside the cat, and into the roster',
  );

  section('The interior keeps its companions’ controls and prompts straight');
  const render = methodBody(interior, 'render(ctx: CanvasRenderingContext2D): void {');
  for (const surface of [
    'this.shop.renderObjects(',
    'this.club.renderObjects(',
    'this.safeRoom.renderUI(',
    'this.bopca.renderUI(',
  ]) {
    check(
      inOrder(render, surface, 'this.renderMercenaryPrompt('),
      `the hire’s Talk prompt is drawn after ${surface.slice('this.'.length, -1)}, and so yields to it`,
    );
  }
  check(
    inOrder(render, 'this.mobileHUD.renderButtons(', 'this.renderSummonButton(ctx)'),
    'the Summon button is placed after the Switch button it stacks on',
  );
  const summonButton = methodBody(interior, 'private renderSummonButton(');
  check(
    summonButton?.includes('this.mobileHUD.summonButtonRect') === true,
    'on a phone the Summon button takes the stacked slot, clear of Switch',
  );
  const input = readFileSync(INPUT_HANDLER_PATH, 'utf8');
  const buildSummon = between(input, 'buildSummon: (actions) => {', '},');
  check(
    inOrder(
      buildSummon,
      'if (actions.buildAction?.() === true) return;',
      'actions.mongoSummon?.()',
    ),
    'a press of the build key that built something does not also toggle Mongo',
  );
  const repair = methodBody(interior, 'private triggerAnchorRepair(): boolean {');
  check(
    repair?.includes('return this.anchorInterior?.tryRepair(') === true,
    'and indoors a repair reports that it happened',
  );
  for (const [sceneName, source] of [
    ['the interior', interior],
    ['the overworld', dungeon],
  ] as const) {
    const binding = between(
      methodBody(source, '  constructor(') ?? '',
      'bindAbilityLevelUps({',
      '});',
    );
    check(binding !== null, `${sceneName} binds the ability level-ups to itself as it is built`);
    check(
      binding?.includes('onPetLevelUp: () => this.mongoSystem.onPetLevelUp()') === true &&
        binding.includes('menus: this.menus'),
      `${sceneName}: a pet level rescales his health and its award lands on its own dialog`,
    );
  }

  section('A hire’s shots fly indoors on every storey');
  const floorSetup = between(interior, 'this.floors.push({', '});');
  for (const system of [
    'rockThrows: new RockThrowSystem(',
    'hirelingShots: new HirelingBoltSystem(',
  ]) {
    check(floorSetup?.includes(system) === true, `each storey builds its ${system.split(':')[0]}`);
  }
  for (const [call, label] of [
    ['this.rockThrows.update(ctx)', 'boulders fly in the combat frame'],
    ['this.hirelingShots.update(ctx)', 'bolts and waves fly in the combat frame'],
  ] as const) {
    check(combat?.includes(call) === true, label);
  }
  for (const call of ['this.rockThrows.render(', 'this.hirelingShots.render(']) {
    check(render?.includes(call) === true, `${call.slice('this.'.length, -1)} is drawn`);
  }
  for (const call of [
    'departing.rockThrows.resetForCheckpoint()',
    'departing.hirelingShots.resetForCheckpoint()',
  ]) {
    check(changeFloor?.includes(call) === true, `a storey change grounds ${call.split('.')[1]}`);
  }
  check(
    interior.includes('playHirelingProjectileCues(this.rockThrows, this.hirelingShots'),
    'their sounds play indoors',
  );
  const mercSystem = readFileSync(MERC_SYSTEM_PATH, 'utf8');
  const carried = between(mercSystem, 'asCarriedCompanion(): CarriedCompanion {', '\n  }\n');
  check(
    carried?.includes('merc.clearAirborneAttacks();') === true,
    'a hire carried up the stairs drops the shot it readied below',
  );
}

// ── Run ──────────────────────────────────────────────────────────────────────

checkMongoThroughTheDoor();
checkMongoLocks();
checkStoreyCarry();
checkMongoWalksOut();
checkRegenOnlyOffDuty();
checkHireThroughTheDoor();
checkDownedHireIsLost();
checkDeskUnderTheSameRoof();
checkCatchUp();
checkHeldMobsAreOffLimits();
checkHireShotsIndoors();
checkQuillHealerHeld();
checkSceneWiring();

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED.\n`);
  process.exit(1);
}
console.log('\nAll companions-indoors checks passed.\n');
