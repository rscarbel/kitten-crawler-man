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
 *
 * Every room:
 * - Through every town building's door, and onto every tower storey from each
 *   of its stairs, both crawlers, Mongo and the hire are set down on open floor
 *   clear of every prop, with room to move, reachable from the landing; each
 *   crawler can walk off its tile, and the follower sets off after a leader who
 *   walks away.
 * - The temple's vermin, the cult's hideout and the tower's stair guards stand
 *   on reachable open floor; the vermin also in plain view, not behind a pew's
 *   back or in a far corner.
 *
 *   npx tsx scripts/verify-companions-indoors.ts
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TILE_SIZE } from '../src/core/constants';
import { level3 } from '../src/levels/level3';
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
import { findPartyArrivalTiles, hasRoomToMove } from '../src/map/findWalkableTile';
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
import { Conversation } from '../src/dialog/Conversation';
import { createTownPlan, type BuildingKind } from '../src/map/town/townPlan';
import { TOWER_FLOOR_COUNT } from '../src/map/GameMap';
import { stampSafeRoomCounters } from '../src/map/safeRoomCounterLayout';
import { stampSafeRoomDecor } from '../src/map/safeRoomDecorLayout';
import { BIG_TOP_ENTRY_NAME, BIG_TOP_ENTRY_KIND } from '../src/map/OverworldGenerator';
import {
  MAZE_CAT_SPAWN_TILE,
  MAZE_HUMAN_SPAWN_TILE,
  type MazeTile,
} from '../src/map/bigTopMazeLayout';
import { TOWN_INTERIOR_PROPS } from '../src/sprites/art/townInterior/townInteriorProps';
import { AnchorInteriorSystem, SKY_TEMPLE_NAME } from '../src/systems/AnchorInteriorSystem';
import { createAnchorQuestProgress } from '../src/core/AnchorQuestProgress';
import { CultHideoutSystem } from '../src/systems/CultHideoutSystem';
import { interiorHostilesFor } from '../src/systems/interiorHostiles';
import { createTownMemory } from '../src/core/TownMemory';
import { applyMovement } from '../src/systems/GameLoopPhases';
import { CompanionSystem } from '../src/systems/CompanionSystem';
import { interiorHudLayout } from '../src/scenes/interiorHudLayout';

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
/** A portrait phone, for checking where the phone HUD stacks Summon. */
const PHONE_LAYOUT_WIDTH = 390;
const PHONE_LAYOUT_HEIGHT = 844;
const PHONE_LAYOUT_HOTBAR_BAND = 64;
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
    undefined,
    new Conversation(null),
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
      merc.takePendingHirelingShots();
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

// ── Every room, through its own door ─────────────────────────────────────────

/** Frames a crawler is walked in each direction to show it can leave its tile. */
const WALK_PROBE_FRAMES = 30;
/** How far a crawler has to get in one of those walks: half a tile clears its own. */
const MIN_WALK_PX = TILE_SIZE / 2;
/** Frames the companion crawler is given to start after a leader who walked away. */
const FOLLOW_PROBE_FRAMES = 240;
/** How far it has to have come by then. */
const MIN_FOLLOW_TILES = 1;
/**
 * Rows and columns in from the walls that count as a room's far corner: a rat
 * there is at the edge of the camera and behind whatever stands along the wall.
 */
const CORNER_BAND_TILES = 2;
/**
 * How much of a tile a prop's art has to cover before the body on it is hidden:
 * the whole of a rat's sprite fits in its lower half.
 */
const HIDING_COVER_FRACTION = 0.5;

const WALK_DIRECTIONS: ReadonlyArray<{ dx: number; dy: number; name: string }> = [
  { dx: 0, dy: -1, name: 'north' },
  { dx: 0, dy: 1, name: 'south' },
  { dx: -1, dy: 0, name: 'west' },
  { dx: 1, dy: 0, name: 'east' },
];

interface RoomArrival {
  readonly label: string;
  readonly buildingName: string;
  readonly kind: BuildingKind;
  readonly storey: number;
  readonly map: GameMap;
  /** The tile the party is set down on: the door, or the foot of a stair. */
  readonly landing: { readonly x: number; readonly y: number };
  /** Fixed marks for a room whose two crawlers come in through two doors. */
  readonly fixedMarks?: { readonly human: MazeTile; readonly cat: MazeTile };
}

function buildRoom(name: string, kind: BuildingKind, storey: number, hasSafeRoom: boolean) {
  const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
  map.generateInterior(kind, storey, name, hasSafeRoom);
  // The scene stamps these after the map is built; a room checked without
  // them is not the room anyone walks into.
  if (hasSafeRoom) {
    stampSafeRoomCounters(map);
    stampSafeRoomDecor(map);
  }
  return map;
}

/** Where the scene's storey change sets a party down: clear of the whole stair block. */
function footOfStair(stairs: ReadonlyArray<{ x: number; y: number }>, map: GameMap) {
  const first = stairs[0] ?? map.startTile;
  const bottom = stairs.reduce((lowest, tile) => Math.max(lowest, tile.y), first.y);
  const left = stairs.reduce((leftmost, tile) => Math.min(leftmost, tile.x), first.x);
  return { x: left, y: bottom + 1 };
}

/** Every way into every town room: each building's door, and each tower storey from both stairs. */
function everyRoomArrival(): RoomArrival[] {
  const plan = createTownPlan(level3.mapSize);
  const arrivals: RoomArrival[] = [];
  const buildings: Array<{ name: string; kind: BuildingKind; hasSafeRoom: boolean }> = [
    ...plan.buildings.map((b) => ({
      name: b.name,
      kind: b.kind,
      hasSafeRoom: b.hasSafeRoom === true,
    })),
    { name: plan.tower.name, kind: plan.tower.kind, hasSafeRoom: false },
    { name: BIG_TOP_ENTRY_NAME, kind: BIG_TOP_ENTRY_KIND, hasSafeRoom: false },
  ];
  for (const { name, kind, hasSafeRoom } of buildings) {
    const storeys = kind === 'tower' ? TOWER_FLOOR_COUNT : 1;
    for (let storey = 0; storey < storeys; storey++) {
      const map = buildRoom(name, kind, storey, hasSafeRoom);
      const base = { buildingName: name, kind, storey, map };
      if (storey === 0) arrivals.push({ ...base, label: `${name}, door`, landing: map.startTile });
      if (map._interiorStairDownTiles.length > 0) {
        arrivals.push({
          ...base,
          label: `${name} storey ${storey}, up from below`,
          landing: footOfStair(map._interiorStairDownTiles, map),
        });
      }
      if (map._interiorStairUpTiles.length > 0) {
        arrivals.push({
          ...base,
          label: `${name} storey ${storey}, down from above`,
          landing: footOfStair(map._interiorStairUpTiles, map),
        });
      }
    }
  }
  const maze = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
  maze.generateInterior(BIG_TOP_ENTRY_KIND, 0, BIG_TOP_ENTRY_NAME, false, 'bigtop_maze');
  arrivals.push({
    label: `${BIG_TOP_ENTRY_NAME} maze, two flaps`,
    buildingName: BIG_TOP_ENTRY_NAME,
    kind: BIG_TOP_ENTRY_KIND,
    storey: 0,
    map: maze,
    landing: MAZE_HUMAN_SPAWN_TILE,
    fixedMarks: { human: MAZE_HUMAN_SPAWN_TILE, cat: MAZE_CAT_SPAWN_TILE },
  });
  return arrivals;
}

/** Sets the party down the way the interior scene does on this arrival. */
function arriveAsTheSceneDoes(arrival: RoomArrival, party: Party): void {
  const marks = arrival.fixedMarks;
  if (marks !== undefined) {
    party.human.x = marks.human.x * TILE_SIZE;
    party.human.y = marks.human.y * TILE_SIZE;
    party.cat.x = marks.cat.x * TILE_SIZE;
    party.cat.y = marks.cat.y * TILE_SIZE;
    return;
  }
  const { leader, follower } = findPartyArrivalTiles(arrival.map, arrival.landing);
  const driven = party.human.isActive ? party.human : party.cat;
  const other = driven === party.human ? party.cat : party.human;
  driven.x = leader.x * TILE_SIZE;
  driven.y = leader.y * TILE_SIZE;
  other.x = follower.x * TILE_SIZE;
  other.y = follower.y * TILE_SIZE;
}

/** Tiles a prop stands on and stops movement on. */
function blockingPropTiles(map: GameMap): Set<string> {
  const tiles = new Set<string>();
  for (const tile of map.placedInteriorPropFootprintTiles()) {
    if (tile.blocksMovement) tiles.add(`${tile.x},${tile.y}`);
  }
  return tiles;
}

/** Every tile a walker can reach from `from`, four-connected. */
function reachableFrom(map: GameMap, from: { x: number; y: number }): Set<string> {
  const reached = new Set<string>();
  if (!map.isWalkable(from.x, from.y)) return reached;
  const frontier = [{ x: from.x, y: from.y }];
  reached.add(`${from.x},${from.y}`);
  for (const tile of frontier) {
    for (const { dx, dy } of WALK_DIRECTIONS) {
      const x = tile.x + dx;
      const y = tile.y + dy;
      const key = `${x},${y}`;
      if (reached.has(key) || !map.isWalkable(x, y)) continue;
      reached.add(key);
      frontier.push({ x, y });
    }
  }
  return reached;
}

/**
 * Tiles a prop's art covers enough of to hide what stands there — the rows
 * above a tall prop's footprint, which the prop is drawn over.
 */
function tilesHiddenByProps(map: GameMap): Set<string> {
  const hidden = new Set<string>();
  for (const placed of map.placedInteriorProps) {
    const def = TOWN_INTERIOR_PROPS[placed.propId];
    for (let rowsUp = 1; rowsUp - HIDING_COVER_FRACTION < def.artHeightTiles; rowsUp++) {
      for (let dx = 0; dx < def.footprint.w; dx++) {
        hidden.add(`${placed.tile.x + dx},${placed.tile.y - rowsUp}`);
      }
    }
  }
  return hidden;
}

interface RoomFacts {
  readonly blocked: Set<string>;
  readonly reachable: Set<string>;
}

/** Everything wrong with a tile as somewhere to stand: open floor, clear of props, with room, reachable. */
function standingFaults(map: GameMap, facts: RoomFacts, tile: { x: number; y: number }): string[] {
  const key = `${tile.x},${tile.y}`;
  return [
    map.isWalkable(tile.x, tile.y) ? '' : 'not walkable',
    facts.blocked.has(key) ? 'inside a prop' : '',
    hasRoomToMove(map, tile.x, tile.y) ? '' : 'no room to move',
    facts.reachable.has(key) ? '' : 'cut off from the way in',
  ].filter((fault) => fault !== '');
}

function checkStandsFree(
  map: GameMap,
  facts: RoomFacts,
  body: { x: number; y: number },
  label: string,
): boolean {
  const tile = tileUnder(body);
  const faults = standingFaults(map, facts, tile);
  const detail = faults.length > 0 ? `: ${faults.join(', ')}` : '';
  check(faults.length === 0, `${label} at (${tile.x},${tile.y})${detail}`);
  return faults.length === 0;
}

/** The furthest walked distance, in pixels, a crawler gets in any one direction. */
function bestWalkPx(player: Player, map: GameMap): number {
  const startX = player.x;
  const startY = player.y;
  let best = 0;
  for (const { dx, dy } of WALK_DIRECTIONS) {
    player.x = startX;
    player.y = startY;
    for (let f = 0; f < WALK_PROBE_FRAMES; f++) {
      applyMovement(player, { dx, dy, isMobile: false }, map, 'sole');
    }
    best = Math.max(best, Math.hypot(player.x - startX, player.y - startY));
  }
  player.x = startX;
  player.y = startY;
  player.isMoving = false;
  return best;
}

/** The reachable tile with room to move that is furthest from `from`. */
function furthestRoomyTile(map: GameMap, facts: RoomFacts, from: { x: number; y: number }) {
  let best: { x: number; y: number } | null = null;
  let bestDistance = 0;
  for (let y = 0; y < map.structure.length; y++) {
    for (let x = 0; x < map.structure[y].length; x++) {
      if (!facts.reachable.has(`${x},${y}`) || !hasRoomToMove(map, x, y)) continue;
      const distance = Math.hypot(x - from.x, y - from.y);
      if (distance > bestDistance) {
        bestDistance = distance;
        best = { x, y };
      }
    }
  }
  return best;
}

/**
 * The companion crawler, driven by the real follow system, sets off after a
 * leader who has walked to the far side of the room.
 */
function followerTilesMoved(arrival: RoomArrival, party: Party, facts: RoomFacts): number {
  const map = arrival.map;
  const roster = makeRoster(map);
  const companion = new CompanionSystem(map, arrival.landing.x, arrival.landing.y);
  companion.setMap(map, party.human, party.cat);
  const leaderStart = tileUnder(party.human);
  const away = furthestRoomyTile(map, facts, leaderStart);
  if (away === null) return 0;
  party.human.x = away.x * TILE_SIZE;
  party.human.y = away.y * TILE_SIZE;
  const catStart = { x: party.cat.x, y: party.cat.y };
  const ctx = contextFor(party, map, roster);
  for (let f = 0; f < FOLLOW_PROBE_FRAMES; f++) companion.update(ctx);
  return tilesBetween(party.cat, catStart);
}

function checkPartyInEveryRoom(arrival: RoomArrival): void {
  const map = arrival.map;
  const facts: RoomFacts = {
    blocked: blockingPropTiles(map),
    reachable: reachableFrom(map, arrival.landing),
  };
  const party = makeParty(map, arrival.landing);
  arriveAsTheSceneDoes(arrival, party);
  // The maze's two flaps open onto two sealed halves, each reachable only from its own.
  const catFacts =
    arrival.fixedMarks === undefined
      ? facts
      : { blocked: facts.blocked, reachable: reachableFrom(map, arrival.fixedMarks.cat) };
  const humanOk = checkStandsFree(map, facts, party.human, `${arrival.label}: Carl`);
  const catOk = checkStandsFree(map, catFacts, party.cat, `${arrival.label}: the cat`);

  for (const [name, crawler] of [
    ['Carl', party.human],
    ['the cat', party.cat],
  ] as const) {
    const walked = bestWalkPx(crawler, map);
    check(
      walked >= MIN_WALK_PX,
      `${arrival.label}: ${name}, driven, walks off (${walked.toFixed(0)} px)`,
    );
  }

  if (arrival.fixedMarks === undefined && humanOk && catOk) {
    const followed = followerTilesMoved(arrival, party, facts);
    check(
      followed >= MIN_FOLLOW_TILES,
      `${arrival.label}: the cat follows Carl across the room (${followed.toFixed(1)} tiles)`,
    );
  }
  arriveAsTheSceneDoes(arrival, party);

  const roster = makeRoster(map);
  const mongo = makeMongoSystem(freshPetState(), true).carryIn(party.cat, map);
  check(mongo !== null, `${arrival.label}: Mongo walks in`);
  if (mongo !== null) checkStandsFree(map, catFacts, mongo, `${arrival.label}: Mongo`);

  const hires = new MercenarySystem(hireRoster('sledge'), null);
  hires.update(contextFor(party, map, roster));
  const merc = hires.activeMerc;
  check(merc !== null, `${arrival.label}: the hire walks in`);
  if (merc !== null) checkStandsFree(map, facts, merc, `${arrival.label}: the hire`);
}

/** Temple vermin: open, reachable floor in the nave, in plain view. */
function checkTempleVermin(): void {
  section('The temple’s vermin are put where the party can find them');
  const plan = createTownPlan(level3.mapSize);
  const temple = plan.buildings.find((building) => building.name === SKY_TEMPLE_NAME);
  check(temple !== undefined, 'the town has its temple');
  if (temple === undefined) return;
  const map = buildRoom(temple.name, temple.kind, GROUND_STOREY, temple.hasSafeRoom === true);
  const progress = createAnchorQuestProgress();
  progress.status = 'active';
  progress.temple = 'in_progress';
  progress.templeVerminRemaining = TEMPLE_VERMIN_ASKED;
  const party = makeParty(map, map.startTile);
  const vermin: Mob[] = [];
  AnchorInteriorSystem.forBuilding(
    temple.name,
    GROUND_STOREY,
    progress,
    map,
    () => [party.human, party.cat],
    (mob) => vermin.push(mob),
    ignore,
    new Conversation(null),
    null,
  );
  check(vermin.length === TEMPLE_VERMIN_ASKED, `every rat asked for is placed (${vermin.length})`);
  const facts: RoomFacts = {
    blocked: blockingPropTiles(map),
    reachable: reachableFrom(map, map.startTile),
  };
  const hidden = tilesHiddenByProps(map);
  const pew = map.placedInteriorProps.find((placed) => placed.propId === 'pew');
  check(
    pew !== undefined && hidden.has(`${pew.tile.x},${pew.tile.y - 1}`),
    'negative: a rat just north of a pew is caught out of view',
  );
  const lastColumn = (map.structure[0]?.length ?? 0) - 1;
  const lastRow = map.structure.length - 1;
  for (const [index, rat] of vermin.entries()) {
    const label = `rat ${index + 1}`;
    checkStandsFree(map, facts, rat, label);
    const tile = tileUnder(rat);
    check(!hidden.has(`${tile.x},${tile.y}`), `${label} is in view, not behind a pew or a shelf`);
    const inWestOrEastBand =
      tile.x <= CORNER_BAND_TILES || tile.x >= lastColumn - CORNER_BAND_TILES;
    const inNorthOrSouthBand = tile.y <= CORNER_BAND_TILES || tile.y >= lastRow - CORNER_BAND_TILES;
    check(!(inWestOrEastBand && inNorthOrSouthBand), `${label} is not in a far corner`);
  }
}

/** Rats the temple step asks for: its full count. */
const TEMPLE_VERMIN_ASKED = 5;
/** A party strong enough that the quest fights are at their own levels. */
const QUEST_FIGHT_PARTY_LEVEL = 10;

/** The questline's own hostiles indoors: the cult's hideout and the tower's stair guards. */
function checkQuestHostilesIndoors(): void {
  section('The questline’s hostiles indoors stand on open, reachable floor');
  for (const arrival of everyRoomArrival()) {
    if (arrival.fixedMarks !== undefined) continue;
    const map = arrival.map;
    const facts: RoomFacts = {
      blocked: blockingPropTiles(map),
      reachable: reachableFrom(map, arrival.landing),
    };
    const spawned: Mob[] = [];
    if (arrival.buildingName === CULT_HIDEOUT_NAME && arrival.storey === GROUND_STOREY) {
      const progress = createMurderQuestProgress();
      progress.stage = 'cult_hideout';
      new CultHideoutSystem(
        map,
        new EventBus(),
        (mob) => spawned.push(mob),
        progress,
        QUEST_FIGHT_PARTY_LEVEL,
      );
    }
    if (arrival.kind === 'tower') {
      const progress = createMurderQuestProgress();
      progress.stage = 'confrontation';
      spawned.push(
        ...interiorHostilesFor({
          buildingName: arrival.buildingName,
          buildingType: arrival.kind,
          floor: arrival.storey,
          map,
          memory: createTownMemory(),
          murderQuest: progress,
          partyLevel: QUEST_FIGHT_PARTY_LEVEL,
        }),
      );
    }
    for (const [index, mob] of spawned.entries()) {
      checkStandsFree(map, facts, mob, `${arrival.label}: hostile ${index + 1}`);
    }
  }
}

/** The house the cult holds its meetings in. */
const CULT_HIDEOUT_NAME = 'Blackwood Lodge';

function checkEveryRoom(): void {
  section('In every room, every body the party brings stands where it can move');
  setViewportSize(HUGE_SCREEN_PX, HUGE_SCREEN_PX);
  const arrivals = everyRoomArrival();
  for (const arrival of arrivals) checkPartyInEveryRoom(arrival);

  // The temple's door is flanked by candle stands, one of them on the tile east
  // of the landing; a party set down blind puts its follower inside it.
  const temple = arrivals.find((arrival) => arrival.buildingName === SKY_TEMPLE_NAME);
  if (temple === undefined) {
    check(false, 'negative: the temple is among the rooms walked into');
    return;
  }
  const blindTile = { x: temple.landing.x + 1, y: temple.landing.y };
  const facts: RoomFacts = {
    blocked: blockingPropTiles(temple.map),
    reachable: reachableFrom(temple.map, temple.landing),
  };
  const blindFaults = standingFaults(temple.map, facts, blindTile);
  check(
    blindFaults.length > 0,
    `negative: the tile east of the temple door is caught (${blindFaults.join(', ')})`,
  );
  const blindCat = new CatPlayer(blindTile.x, blindTile.y, TILE_SIZE);
  const blindWalk = bestWalkPx(blindCat, temple.map);
  check(
    blindWalk < MIN_WALK_PX,
    `negative: a cat set down on it is caught unable to walk (${blindWalk.toFixed(0)} px)`,
  );
}

// ── Outdoors: walking out of every door ──────────────────────────────────────

/** Floors the doorstep check is run on: the town moves with the world seed. */
const OUTDOOR_WORLD_SEEDS: readonly number[] = [1, 7919];
/** The tile the scene sets a party down on when it walks out: one south of the door. */
const DOORSTEP_OFFSET_Y = 1;

/**
 * Walking out of a building rebuilds the overworld with the party on the
 * doorstep. The companion must land on open ground it can move on and walk to
 * the leader from, never on a door, a wall or a fence post one tile east.
 */
function checkPartyOutdoors(): void {
  section('Walking out of every door, the companion lands on open ground beside the leader');
  for (const worldSeed of OUTDOOR_WORLD_SEEDS) {
    const map = new GameMap({
      mapSize: level3.mapSize,
      mapType: 'overworld',
      tileHeight: TILE_SIZE,
      worldSeed,
    });
    const doorKeys = new Set(map.buildingEntries.map((e) => `${e.doorTile.x},${e.doorTile.y}`));
    const problems: string[] = [];
    let eastOfLeaderStuck = 0;
    for (const entry of map.buildingEntries) {
      const landing = { x: entry.doorTile.x, y: entry.doorTile.y + DOORSTEP_OFFSET_Y };
      const { leader, follower } = findPartyArrivalTiles(map, landing);
      const where = `seed ${worldSeed}, ${entry.name}`;
      const followerKey = `${follower.x},${follower.y}`;
      const cat = new CatPlayer(follower.x, follower.y, TILE_SIZE);
      if (follower.x === leader.x && follower.y === leader.y) {
        problems.push(`${where}: the companion is stacked on the leader`);
      } else if (!map.isWalkable(follower.x, follower.y)) {
        problems.push(`${where}: the companion lands on blocked ground at ${followerKey}`);
      } else if (doorKeys.has(followerKey)) {
        problems.push(`${where}: the companion lands on a door at ${followerKey}`);
      } else if (!hasRoomToMove(map, follower.x, follower.y)) {
        problems.push(`${where}: the companion lands in a pocket at ${followerKey}`);
      } else if (!reachableFrom(map, leader).has(followerKey)) {
        problems.push(`${where}: the companion at ${followerKey} cannot walk to the leader`);
      } else if (bestWalkPx(cat, map) < MIN_WALK_PX) {
        problems.push(`${where}: the companion at ${followerKey} cannot take a step`);
      }
      const eastX = leader.x + 1;
      const eastIsStuck = !map.isWalkable(eastX, leader.y) || !hasRoomToMove(map, eastX, leader.y);
      if (eastIsStuck) eastOfLeaderStuck++;
    }
    check(map.buildingEntries.length > 0, `seed ${worldSeed}: the town has doors to walk out of`);
    check(
      problems.length === 0,
      `seed ${worldSeed}: ${map.buildingEntries.length} doorsteps, every companion free to move` +
        (problems.length === 0 ? '' : ` — ${problems.join('; ')}`),
    );
    console.log(
      `        (${eastOfLeaderStuck} doorstep(s) where the tile east of the leader is blocked or cramped)`,
    );

    // The doorsteps happen to be open to the east, so a landing that is not is
    // sought out: a fixed one-tile-east placement would put the companion
    // inside whatever stands there.
    const walled = firstLandingWalledToTheEast(map);
    check(walled !== null, `seed ${worldSeed}: a landing with an obstacle east of it is found`);
    if (walled === null) continue;
    const { follower } = findPartyArrivalTiles(map, walled);
    const eastCat = new CatPlayer(walled.x + 1, walled.y, TILE_SIZE);
    check(
      bestWalkPx(eastCat, map) < MIN_WALK_PX,
      `negative: a companion one tile east of (${walled.x},${walled.y}) is stuck there`,
    );
    const followerCat = new CatPlayer(follower.x, follower.y, TILE_SIZE);
    check(
      map.isWalkable(follower.x, follower.y) && bestWalkPx(followerCat, map) >= MIN_WALK_PX,
      `the arrival search puts it at (${follower.x},${follower.y}), where it can walk`,
    );
  }
}

/**
 * A tile with room to move whose east neighbour is blocked, and blocked by
 * something a crawler set down inside cannot walk out of — scanning out from
 * the map's centre row.
 */
function firstLandingWalledToTheEast(map: GameMap): { x: number; y: number } | null {
  const rows = map.structure.length;
  const middleRow = Math.floor(rows / 2);
  for (let offset = 0; offset < rows; offset++) {
    const y = offset % 2 === 0 ? middleRow + offset / 2 : middleRow - (offset + 1) / 2;
    const columns = map.structure[y]?.length ?? 0;
    for (let x = 0; x + 1 < columns; x++) {
      if (map.isWalkable(x + 1, y) || !hasRoomToMove(map, x, y)) continue;
      const probe = new CatPlayer(x + 1, y, TILE_SIZE);
      if (bestWalkPx(probe, map) >= MIN_WALK_PX) continue;
      return { x, y };
    }
  }
  return null;
}

// ── The scenes call these in the right order ─────────────────────────────────

const SCENES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'scenes');
const INTERIOR_SCENE_PATH = resolve(SCENES_DIR, 'BuildingInteriorScene.ts');
const DUNGEON_SCENE_PATH = resolve(SCENES_DIR, 'DungeonScene.ts');
const INPUT_HANDLER_PATH = resolve(SCENES_DIR, '..', 'systems', 'GameplayInputHandler.ts');
const MERC_SYSTEM_PATH = resolve(SCENES_DIR, '..', 'systems', 'MercenarySystem.ts');
const QUILL_PATH = resolve(SCENES_DIR, '..', 'systems', 'QuillConfrontationSystem.ts');
const OCCUPANT_SYSTEM_PATH = resolve(SCENES_DIR, '..', 'systems', 'InteriorOccupantSystem.ts');
const PLAYER_MANAGER_PATH = resolve(SCENES_DIR, '..', 'core', 'PlayerManager.ts');

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
  section('Outdoors, every arrival sets the party down through the arrival search');
  const dungeonSource = readFileSync(DUNGEON_SCENE_PATH, 'utf8');
  check(
    dungeonSource.includes('this.pm.setPartyDown(findPartyArrivalTiles(this.gameMap, spawn));'),
    'arriving on a floor, or walking out of a building, uses it',
  );
  check(
    methodBody(dungeonSource, 'private placePartyAtTile(')?.includes('findPartyArrivalTiles(') ===
      true,
    'a warp or a checkpoint respawn uses it',
  );
  const playerManager = readFileSync(PLAYER_MANAGER_PATH, 'utf8');
  check(
    !playerManager.includes('setPositions('),
    'the party manager has no unchecked one-tile-east placement',
  );

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
  const constructorBody = methodBody(interior, '  constructor(');
  check(
    inOrder(
      constructorBody,
      'stampSafeRoomDecor(this.map);',
      'this.setPartyDown(this.map.startTile);',
    ),
    'the party is set down after the safe room’s fittings are stamped',
  );
  check(
    inOrder(constructorBody, 'this.setPartyDown(this.map.startTile);', 'this.carryMongoIn();'),
    'and before Mongo lands beside the cat',
  );
  const setDown = methodBody(interior, 'private setPartyDown(');
  check(
    setDown?.includes('findPartyArrivalTiles(this.map, landing)') === true,
    'the party is set down on tiles the arrival search picked',
  );
  const occupants = readFileSync(OCCUPANT_SYSTEM_PATH, 'utf8');
  check(
    methodBody(occupants, 'private reservedTiles(')?.includes('findPartyArrivalTiles(') === true,
    'occupants keep off the tiles the party is set down on',
  );
  const changeFloor = methodBody(interior, 'private changeFloor(newFloor: number): void {');
  check(
    inOrder(changeFloor, 'this.setPartyDown(', 'this.companion.setMap('),
    'a storey change sets the party down through the arrival search',
  );
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
  const summonButton = methodBody(interior, 'private renderSummonButton(');
  check(
    summonButton?.includes('layout.summon') === true,
    'the Summon button is drawn where the interior HUD layout puts it',
  );
  const phoneLayout = interiorHudLayout({
    viewportWidth: PHONE_LAYOUT_WIDTH,
    viewportHeight: PHONE_LAYOUT_HEIGHT,
    mobile: true,
    hudCollapsed: true,
    miniMapExpanded: false,
    hotbarBandHeight: PHONE_LAYOUT_HOTBAR_BAND,
    followButton: true,
    summonButton: true,
  });
  const stackedSummon = phoneLayout.summon;
  const phoneSwitch = phoneLayout.switchButton;
  check(
    stackedSummon !== null &&
      phoneSwitch !== null &&
      stackedSummon.x === phoneSwitch.x &&
      stackedSummon.y + stackedSummon.h < phoneSwitch.y,
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
checkEveryRoom();
checkTempleVermin();
checkQuestHostilesIndoors();
checkPartyOutdoors();
checkSceneWiring();

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED.\n`);
  process.exit(1);
}
console.log('\nAll companions-indoors checks passed.\n');
