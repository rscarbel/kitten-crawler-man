#!/usr/bin/env tsx
/**
 * Headless checks on the town's interior content: every building's occupants,
 * its named residents, the service behind its counter, and the things left
 * lying around to read.
 *
 * These are all cross-registry checks, and every one of them guards a failure
 * that is *invisible in the game*. A service keyed to a role nobody in that room
 * has is a counter with nobody behind it — the player walks up and the only
 * thing that happens is nothing. A resident whose home names a building that
 * does not exist simply never appears. None of that throws, none of it logs, and
 * none of it shows up in a screenshot.
 *
 * The rooms are laid out by `createTownPlan`, so the building ids come from
 * the plan rather than being restated here.
 *
 * Run: npx tsx scripts/verify-interiors.ts
 */

import { createCanvas } from 'canvas';

import { loadGameSpritesInNode } from './nodeCanvasGlobals';
import { asGameContext } from './nodeGameContext';
import { createTownPlan } from '../src/map/town/townPlan';
import type { BuildingKind } from '../src/map/town/townPlan';
import type { BuildingId } from '../src/map/buildingIds';
import { GameMap, TOWER_FLOOR_COUNT } from '../src/map/GameMap';
import { findPartyArrivalTiles, hasRoomToMove } from '../src/map/findWalkableTile';
import {
  TOWN_INTERIOR_PROPS,
  townInteriorPropArtRiseTiles,
} from '../src/sprites/art/townInterior/townInteriorProps';
import { townInteriorPropEmitters } from '../src/systems/townInteriorPropAmbience';
import { drawHawkfolkCorpse } from '../src/sprites/featherfallCorpseSprite';
import { TILE_SIZE } from '../src/core/constants';
import { VOID_TYPE } from '../src/map/tileTypes';
import { renderCanvas, renderDecorationsOverlay } from '../src/map/TileRenderer';
import {
  planSafeRoomCounters,
  stampSafeRoomCounters,
  widestFreeSpan,
} from '../src/map/safeRoomCounterLayout';
import { stampSafeRoomDecor } from '../src/map/safeRoomDecorLayout';
import {
  ANCHOR_KINDS,
  ANCHOR_TILE_TYPES,
  InteriorOccupantSystem,
  occupantAnchor,
  scanInteriorFurniture,
} from '../src/systems/InteriorOccupantSystem';
import type { AnchorKind, FurniturePiece } from '../src/systems/InteriorOccupantSystem';
import { BUILDING_OCCUPANTS } from '../src/systems/buildingOccupants';
import { Townsperson } from '../src/creatures/Townsperson';
import {
  BESPOKE_RESIDENT_FIGURES,
  type BespokeResidentFigureId,
} from '../src/creatures/bespokeResidentFigures';
import { DEFAULT_TOWN_SPECIES } from '../src/systems/townSpecies';
import { InteriorReadableSystem } from '../src/systems/InteriorReadableSystem';
import {
  allResidents,
  residentById,
  residentSpecies,
  type ResidentId,
} from '../src/systems/townResidents';
import { partyRoutineBodies, type RoutineBody } from '../src/systems/occupantRoutines';
import type { OccupantRoutineCue } from '../src/systems/occupantRoutineCues';
import { RESIDENT_LINES } from '../src/dialog/scripts/residents';
import {
  CLUB_GATHERINGS,
  CLUB_HOST_MARK,
  CLUB_PATRON_COUNT,
  CLUB_PERFORMER_POSTS,
} from '../src/core/club/clubLayout';
import { CLUB_ANIM_FRAMES_PER_SECOND } from '../src/core/club/clubTiming';
import {
  CROWD_BODY_RADIUS_TILES,
  WAYPOINT_MAX_OFF_LINE_TILES,
  createClubCrowd,
} from '../src/systems/ClubCrowdSystem';
import { ClubGamblerSystem } from '../src/systems/ClubGamblerSystem';
import { REGULAR_IDS } from '../src/systems/casino/poker/npc/regulars';
import { NPC_SEAT_COUNT } from '../src/systems/casino/poker/PokerTable';
import { interiorServicesFor } from '../src/systems/townServices';
import { readableBuildings, readablesFor } from '../src/systems/townReadables';
import { STAT_BOON_BONUSES } from '../src/core/combat/StatusEffect';
import { statusVisual } from '../src/sprites/status/statusEffectVisuals';
import { EventBus } from '../src/core/EventBus';
import { createMurderQuestProgress } from '../src/core/quests/MurderQuestProgress';
import { createDoomsdayProgress } from '../src/core/quests/DoomsdayProgress';
import { QuillConfrontationSystem } from '../src/systems/QuillConfrontationSystem';
import { MISS_QUILL_CAST_RANGE_TILES } from '../src/creatures/MissQuill';
import { CITY_ELF_CULTIST_AGGRO_RANGE_TILES } from '../src/creatures/CityElfCultist';
import { QUEST_BANNER_FRAMES } from '../src/ui/QuestBanners';
import { MobUpdateLoop } from '../src/systems/MobUpdateLoop';
import { MobRoster } from '../src/systems/kits/SceneWorld';
import { SpellSystem } from '../src/systems/SpellSystem';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { CatPlayer } from '../src/creatures/CatPlayer';
import { MIN_STAT_VALUE } from '../src/core/party/crawlerFormulas';
import { partyLevelOf, spawnForLevel } from '../src/levels/spawner';
import { level3 } from '../src/levels/level3';
import { campSiteKey } from '../src/map/overworld/camps';
import {
  captureTownMemory,
  createTownMemory,
  forgetClearedCamps,
  noteCampCasualty,
  restoreTownMemory,
} from '../src/core/state/TownMemory';
import { parseTownMemoryCheckpoint } from '../src/core/save/PersistedWorldState';
import { DIFFICULTY_PROFILES } from '../src/core/difficulty/difficultyProfiles';
import type { Mob } from '../src/creatures/Mob';
import type { SystemContext } from '../src/systems/GameSystem';
import { Conversation } from '../src/dialog/Conversation';
import { setViewportSize } from '../src/core/rendering/Viewport';
import { ShopSystem } from '../src/systems/ShopSystem';
import { createShopStock } from '../src/economy/shopStock';
import { mulberry32 } from '../src/sprites/person/rng';

// The confrontation's office scene paginates its dialog against the live
// viewport; without a size set, DialogBox measures against a zero-width box
// and splits every line into one page per word.
const HARNESS_VIEWPORT_WIDTH = 1280;
const HARNESS_VIEWPORT_HEIGHT = 720;
setViewportSize(HARNESS_VIEWPORT_WIDTH, HARNESS_VIEWPORT_HEIGHT);

/**
 * Matches `level3`'s own `mapSize`: overworld generation always sites Briar
 * Hollow, and the village only fits the map's east side at that size or
 * larger, so a smaller fixture throws before the plan is ever built.
 */
const PLAN_SIZE = 280;

/**
 * Kinds that run their own scripted interior rather than the ambient
 * occupant/service/readable stack — the club has its stations, the tower has
 * its stairs and its boss.
 */
const SCRIPTED_KINDS: ReadonlySet<BuildingKind> = new Set<BuildingKind>(['club', 'tower']);

/** The floor a walk-in gives you; only the tower has any others. */
const TOWER_GROUND_FLOOR = 0;

/** Simulated seconds the club's crowd is run for, long enough for everyone to move on. */
const CROWD_SIM_SECONDS = 600;
/** A fixed seed for the crowd simulation, so its draws repeat run to run. */
const CROWD_SIM_SEED = 5;
/** Waiting is only for a patron with nowhere in reach, so it must stay rare. */
const CROWD_MAX_WAITING_SHARE = 0.1;
/** Company is at least two people. */
const MIN_COMPANY = 2;
/** A shove can turn someone for a moment; nearly everyone else faces in. */
const CROWD_MIN_FACING_IN_SHARE = 0.9;
/**
 * Seeds the capacity check runs the crowd under. An overfull gathering needs
 * two patrons to change plans on the same tick, which only a
 * few seeds in forty ever hit.
 */
const CAPACITY_SIM_SEEDS = 40;

/** A fixed seed for the gambler simulation, so its stool draws repeat run to run. */
const GAMBLER_SIM_SEED = 7;
const GAMBLER_LCG_MULTIPLIER = 1103515245;
const GAMBLER_LCG_INCREMENT = 12345;
const GAMBLER_LCG_MODULUS = 2 ** 31;
/** Long enough for every emptied stool's vacancy to run out. */
const GAMBLER_SETTLE_SECONDS = 60;
/** A blackjack session long enough that every stool's vacancy runs out while the table is open. */
const BLACKJACK_SESSION_SECONDS = 60;

/** Rows of open floor the club keeps above and below each stage. */
const CLUB_STAGE_LANE_TILES = 2;

/** Bytes per pixel in the `ImageData` the hole scan reads. */
const RGBA_STRIDE = 4;
/** Offset of the alpha byte within one such pixel. */
const ALPHA_OFFSET = 3;
/** Tiles square of the canvas a bespoke figure is probed on: room for its art above its own tile. */
const BESPOKE_PROBE_TILES = 3;

function isBespokeResidentFigureId(id: string): id is BespokeResidentFigureId {
  return id in BESPOKE_RESIDENT_FIGURES;
}

/**
 * Painted fraction below which a tile counts as a hole rather than as art.
 *
 * Near-total rather than merely high. A prop that failed to paint its ground is
 * only transparent where its own art does not reach, so a board or a larder that
 * fills most of its tile hides the fault from a lenient threshold while still
 * showing the player a black frame around itself. Every interior tile has ground
 * under it, so full coverage is the real invariant; the slack is for the odd
 * antialiased pixel at a sprite's edge.
 */
const MIN_TILE_COVERAGE = 0.99;

/**
 * How many rows in from each door column must be open floor: the row the
 * player steps onto, and the one they take next. Every walk-in door is cut in
 * a south wall, so "in" is always north.
 */
const DOORWAY_CLEAR_DEPTH_TILES = 2;
/** Alpha below which a body pixel is anti-aliasing fringe rather than the body. */
const BODY_INK_ALPHA_MIN = 24;
/** Open floor kept round the magistrate's body, so nothing crowds the scene. */
const BODY_CLEARANCE_TILES = 0.5;

/** The magistrate's office, and the only storey the Quill confrontation spawns on. */
const TOWER_CONFRONTATION_FLOOR = TOWER_FLOOR_COUNT - 1;
/**
 * How far past its own threat range the confrontation has to spawn from the tile
 * the party climbs in on.
 *
 * Nothing in the room has a windup — every caster in it can loose its first bolt
 * on the frame it acquires a target — and a companion locked to the game's
 * minimum health dies to any one of those bolts, which turns the whole
 * party out of the tower before the fight is visible. So the arrival tile is not
 * allowed to be merely outside the ranges: it has to be outside them by more
 * than the encounter's own guards can drift while they idle.
 */
const ARRIVAL_SAFETY_MARGIN_TILES = 2;
const FRAMES_PER_SECOND = 60;
/** How long the party is left standing on the landing, doing nothing at all. */
const ARRIVAL_VIGIL_SECONDS = 20;
const ARRIVAL_VIGIL_FRAMES = ARRIVAL_VIGIL_SECONDS * FRAMES_PER_SECOND;

/** Where Steve Cartwright keeps his range. */
const CARTWRIGHT_HOME = 'taloncrest_crafting_house';
/** The shortest lane from his crossbow to the target that reads as a range, in tiles. */
const MIN_SHOOTING_LANE_TILES = 4;
/** Comfortably longer than one aim, shot and reload, so a cycle always completes inside it. */
const TARGET_PRACTICE_CYCLE_SECONDS = 8;
const TARGET_PRACTICE_CYCLE_FRAMES = TARGET_PRACTICE_CYCLE_SECONDS * FRAMES_PER_SECOND;
/** How long a crawler stands in his lane. */
const TARGET_PRACTICE_HELD_SECONDS = 15;
const TARGET_PRACTICE_HELD_FRAMES = TARGET_PRACTICE_HELD_SECONDS * FRAMES_PER_SECOND;
/** Each pub's janitor, by the building they mop. */
const JANITOR_HOMES: ReadonlyArray<readonly [BuildingId, ResidentId]> = [
  ['taloncrest_pub', 'janitor_puddles'],
  ['taloncrest_flagon_tavern', 'janitor_grout'],
];
/** Long enough for a stroll and several spots worked. */
const JANITOR_WATCH_SECONDS = 90;
const JANITOR_WATCH_FRAMES = JANITOR_WATCH_SECONDS * FRAMES_PER_SECOND;

/** Where Old Lori lives — the town's roaming resident. */
const LORI_HOME = 'taloncrest_old_lady_cottage';
/**
 * How far from the room's centre (Chebyshev tiles) she may be set down. Not
 * zero: the cottage's centre is furniture, and she starts in the widest open
 * floor nearest it, which is the hall the door opens into.
 */
const ROAMER_START_TOLERANCE_TILES = 3;
/** Long enough for several strolls: each pause is at most six seconds. */
const ROAMER_WANDER_SECONDS = 120;
const ROAMER_WANDER_FRAMES = ROAMER_WANDER_SECONDS * FRAMES_PER_SECOND;
/** Distinct tiles she must stand on over the wander — more than a shuffle on the spot. */
const ROAMER_MIN_TILES_VISITED = 4;
/** How far from her start she must get at some point, in tiles. */
const ROAMER_MIN_REACH_TILES = 2;
/** Tiles around each exit she must never stand on. */
const ROAMER_EXIT_KEEP_OFF_TILES = 1;
/** How long to wait for her to be caught mid-stride before the hold is tested. */
const ROAMER_STRIDE_WAIT_SECONDS = 60;
const ROAMER_STRIDE_WAIT_FRAMES = ROAMER_STRIDE_WAIT_SECONDS * FRAMES_PER_SECOND;
/** How long the player stands beside her. */
const ROAMER_HOLD_TEST_SECONDS = 10;
const ROAMER_HOLD_TEST_FRAMES = ROAMER_HOLD_TEST_SECONDS * FRAMES_PER_SECOND;
/** Sub-pixel slack on "did not move" — she is expected to stop dead. */
const ROAMER_HOLD_SLACK_PX = 0.01;
/** How long after the player walks off she has to get moving again. */
const ROAMER_RESUME_SECONDS = 30;
const ROAMER_RESUME_FRAMES = ROAMER_RESUME_SECONDS * FRAMES_PER_SECOND;

/** The floor-3 world seed the camp checks regenerate, standing in for a save. */
const CAMP_WORLD_SEED = 424242;
/** A different seed, whose camps are somewhere else entirely. */
const CAMP_OTHER_WORLD_SEED = 868686;
/** The party that clears the camp, and the stronger one that walks back out. */
const CAMP_CLEARING_PARTY_LEVEL = 10;
const CAMP_RETURNING_PARTY_LEVEL = 14;

let failures = 0;

function check(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ok   ${label}`);
    return;
  }
  console.log(` FAIL  ${label}`);
  failures++;
}

const plan = createTownPlan(PLAN_SIZE);
const buildings = new Map<BuildingId, BuildingKind>(plan.buildings.map((b) => [b.id, b.kind]));
const towerName = plan.tower.id;
buildings.set(towerName, plan.tower.kind);
/** Named rather than derived from a kind, exactly as the town plan states it. */
const safeRoomBuildings = new Set<BuildingId>(
  plan.buildings.filter((b) => b.hasSafeRoom === true).map((b) => b.id),
);

/**
 * A generated interior in the state the player walks into: the room the map
 * builds, plus the safe-room fittings the scene stamps afterwards. A check that
 * skipped the stamping pass would be inspecting a room nobody ever sees.
 */
function buildInterior(name: BuildingId | null, kind: BuildingKind, floor: number): GameMap {
  const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
  const hasSafeRoom = name !== null && safeRoomBuildings.has(name);
  map.generateInterior(kind, floor, name, hasSafeRoom);
  if (hasSafeRoom) {
    stampSafeRoomCounters(map);
    stampSafeRoomDecor(map);
  }
  return map;
}

/** Every storey a walk-in of this kind generates; only the tower has more than one. */
function floorCount(kind: BuildingKind): number {
  return kind === 'tower' ? TOWER_FLOOR_COUNT : 1;
}

function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** The four steps a walker can take between tiles; interiors have no diagonal moves. */
const CARDINAL_STEPS: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

/**
 * Every walkable tile the player cannot walk to from where they spawn, as
 * `x,y` strings.
 *
 * The Bopca's galley strip is excluded, and only the galley strip: it is
 * walkable floor deliberately sealed by the counter's own side returns, which is
 * how the game keeps townsfolk and mobs out of the kitchen without special-casing
 * them anywhere. Everything else that is walkable is meant to be walked to.
 */
function unreachableWalkableTiles(map: GameMap): string[] {
  const sealedByCounter = new Set<string>();
  for (const layout of planSafeRoomCounters(map)) {
    for (const tile of layout.galleyTiles) sealedByCounter.add(tileKey(tile.x, tile.y));
  }

  const height = map.structure.length;
  const width = map.structure[0].length;
  const reached = new Set<string>();
  const start = map.startTile;
  if (map.isWalkable(start.x, start.y)) {
    const frontier = [start];
    reached.add(tileKey(start.x, start.y));
    while (frontier.length > 0) {
      const tile = frontier.pop();
      if (tile === undefined) break;
      for (const step of CARDINAL_STEPS) {
        const nx = tile.x + step.dx;
        const ny = tile.y + step.dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const key = tileKey(nx, ny);
        if (reached.has(key) || !map.isWalkable(nx, ny)) continue;
        reached.add(key);
        frontier.push({ x: nx, y: ny });
      }
    }
  }

  const stranded: string[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!map.isWalkable(x, y)) continue;
      const key = tileKey(x, y);
      if (reached.has(key) || sealedByCounter.has(key)) continue;
      stranded.push(key);
    }
  }
  return stranded;
}

console.log(`\nTown plan: ${buildings.size} buildings\n`);

console.log('\nNamed residents');
for (const resident of allResidents()) {
  check(buildings.has(resident.home), `${resident.name} lives in a building that exists`);
  const roster = BUILDING_OCCUPANTS.get(resident.home) ?? [];
  const spec = roster.find((occupant) => occupant.residentId === resident.id);
  check(spec !== undefined, `${resident.name} is stationed in ${resident.home}`);
  if (spec !== undefined) {
    check(spec.role === resident.role, `${resident.name}'s roster role matches their def`);
  }
  const lines = RESIDENT_LINES[resident.id];
  check(lines.ambient.length > 0, `${resident.name} has ambient lines to fall back on`);
  check(lines.lore.length > 0, `${resident.name} has at least one lore conversation`);
  check(
    lines.lore.every((conversation) => conversation.length > 0),
    `${resident.name}'s lore conversations all have pages`,
  );
}

console.log('\nResident ids used by the rosters');
for (const [name, roster] of BUILDING_OCCUPANTS) {
  for (const occupant of roster) {
    if (occupant.residentId === undefined) continue;
    // Throws rather than returning null on an unknown id, which is what we want
    // to catch here — the roster is the only place an id is written by hand.
    const resident = residentById(occupant.residentId);
    check(resident.home === name, `${resident.name} is rostered in their own home (${name})`);
  }
}

console.log('\nGeneral Store counter');
// `ShopSystem` draws no figure of its own — Keeper Brenna Kestrel is
// a counter-anchored occupant, the counter's one owner, and `ShopSystem` only
// reads her position. A second occupant anchored on `counter` would put two
// figures on the same furniture with no way to tell which one the "Shop"
// prompt belongs to.
{
  const generalStoreRoster = BUILDING_OCCUPANTS.get('taloncrest_general_store') ?? [];
  const counterSpecs = generalStoreRoster.filter(
    (occupant) => occupantAnchor(occupant) === 'counter',
  );
  check(counterSpecs.length === 1, 'exactly one General Store occupant anchors on the counter');
  check(
    counterSpecs[0]?.residentId === 'keeper_brenna_kestrel',
    'the counter occupant is Keeper Brenna Kestrel',
  );

  const map = buildInterior('taloncrest_general_store', 'store', TOWER_GROUND_FLOOR);
  const occupants = InteriorOccupantSystem.forBuilding(map, 'store', 'taloncrest_general_store');
  const kestrel = occupants?.people.find((person) => person.residentId === 'keeper_brenna_kestrel');
  check(kestrel !== undefined, 'the General Store roster actually places Kestrel in the room');

  const mapWidth = map.structure[0]?.length ?? 0;
  const shop = new ShopSystem(mapWidth, 'general_store', createShopStock(), () => false);
  shop.setKeeper(kestrel ?? null);
  if (kestrel !== undefined) {
    const atCounter = new HumanPlayer(
      Math.round(kestrel.x / TILE_SIZE),
      Math.round(kestrel.y / TILE_SIZE),
      TILE_SIZE,
    );
    check(shop.isNearShopkeeper(atCounter), 'the shop still opens from where Kestrel is stood');
  }
}

const readableKeys = readableBuildings();
check(readableKeys.length > 0, 'the readable registry is not empty');

console.log('\nServices');
// A service belongs to the occupant who keeps it, and the talk router asks the
// occupant system for the service of the exact person the player walked up
// to. So every service must be on a named resident (an extra would sell with
// no name, no barks and no story), and the person the room actually places
// for that spec must answer with it — a figure drawn by a bespoke painter
// included, since the router never looks at how someone is drawn.
let servicesSeen = 0;
let bespokeServicesSeen = 0;
for (const [name, roster] of BUILDING_OCCUPANTS) {
  const kind = buildings.get(name);
  if (kind === undefined) continue;
  const staffed = roster.filter((spec) => spec.service !== undefined);
  if (staffed.length === 0) continue;
  check(!SCRIPTED_KINDS.has(kind), `"${name}" is not a scripted interior`);
  const map = buildInterior(name, kind, TOWER_GROUND_FLOOR);
  const system = InteriorOccupantSystem.forBuilding(map, kind, name);
  for (const spec of staffed) {
    servicesSeen++;
    const who = spec.residentId ?? spec.role;
    check(spec.residentId !== undefined, `"${name}"'s ${who} service is kept by a named resident`);
    check((spec.service?.verb.length ?? 0) > 0, `"${name}"'s ${who} service has an interact verb`);
    const placed = system?.placements.find((placement) => placement.spec === spec);
    check(placed !== undefined, `"${name}" places the ${who} who keeps its counter`);
    if (placed === undefined || system === null) continue;
    check(
      system.serviceOf(placed.person) === spec.service,
      `talking to "${name}"'s ${who} opens their own service`,
    );
    if (placed.person.body.kind === 'bespoke') bespokeServicesSeen++;
  }
}
check(servicesSeen > 0, 'some roster occupant keeps a service');
console.log(`  (${bespokeServicesSeen} of them drawn by a bespoke resident painter)`);

console.log('\nReadables');
for (const name of readableKeys) {
  // Driven from the registry rather than from every building, so the section
  // reports on the rooms that actually hold something instead of printing a
  // reassuring ok for each of the dozen that hold nothing.
  const readables = readablesFor(name);
  const ids = new Set(readables.map((readable) => readable.id));
  check(ids.size === readables.length, `"${name}"'s readables have distinct ids`);
  for (const readable of readables) {
    check(readable.body.length > 0, `"${readable.title}" has something written on it`);
  }
}

console.log('\nReadables fit in the rooms they are authored for');
// The registry saying a building has a letter is not the same as the generated
// room having somewhere to put it: `InteriorReadableSystem` drops a readable it
// cannot seat, silently, and the room simply has nothing in it. This is the only
// check here that builds a real interior.
for (const name of readableKeys) {
  const kind = buildings.get(name);
  if (kind === undefined) continue;
  const map = buildInterior(name, kind, TOWER_GROUND_FLOOR);
  const occupants = InteriorOccupantSystem.forBuilding(map, kind, name);
  const system = InteriorReadableSystem.forBuilding(
    map,
    name,
    occupants?.occupiedFurniture ?? new Set(),
  );
  check(system !== null, `"${name}" has furniture its readables can sit on`);
  check(
    system?.placedCount === readablesFor(name).length,
    `"${name}" seats every readable it is authored`,
  );
}

console.log("\nOld Lori roams her cottage's open floor");
// Stationed occupants are placed and tested above; a roamer's whole placement
// is runtime movement, which none of those checks can see. She must start
// where the player walking in will find her, never stroll onto furniture, a
// doorstep or a pocket the player cannot reach, and stand still for a player
// beside her — otherwise walking up to her ends with her strolling out of reach.
{
  const kind = buildings.get(LORI_HOME);
  check(kind !== undefined, `"${LORI_HOME}" is a real building`);
  if (kind !== undefined) {
    const map = buildInterior(LORI_HOME, kind, TOWER_GROUND_FLOOR);
    let focus: { x: number; y: number } | null = null;
    const occupants = InteriorOccupantSystem.forBuilding(map, kind, LORI_HOME, () => focus);
    const lori = occupants?.people.find((person) => person.residentId === 'old_lori');
    check(lori !== undefined, 'Old Lori is placed in her cottage');

    // An independent flood fill, rather than the system's own, so a mistake in
    // its reachability cannot also approve itself.
    const arrival = findPartyArrivalTiles(map, map.startTile).leader;
    const reachable = new Set<string>([`${arrival.x},${arrival.y}`]);
    const frontier = [arrival];
    for (const tile of frontier) {
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const next = { x: tile.x + dx, y: tile.y + dy };
        const key = `${next.x},${next.y}`;
        if (reachable.has(key) || !map.isWalkable(next.x, next.y)) continue;
        reachable.add(key);
        frontier.push(next);
      }
    }
    const tileUnder = (person: { x: number; y: number }): { x: number; y: number } => ({
      x: Math.floor((person.x + TILE_SIZE / 2) / TILE_SIZE),
      y: Math.floor((person.y + TILE_SIZE / 2) / TILE_SIZE),
    });
    const besideExit = (tile: { x: number; y: number }): boolean =>
      map._interiorExitTiles.some(
        (exit) =>
          Math.max(Math.abs(exit.x - tile.x), Math.abs(exit.y - tile.y)) <=
          ROAMER_EXIT_KEEP_OFF_TILES,
      );
    const onOpenFloor = (tile: { x: number; y: number }): boolean =>
      map.isWalkable(tile.x, tile.y) && reachable.has(`${tile.x},${tile.y}`) && !besideExit(tile);

    if (occupants !== null && lori !== undefined) {
      const start = tileUnder(lori);
      const centreX = Math.floor((1 + (map.structure[0]?.length ?? 0) - 2) / 2);
      const centreY = Math.floor((1 + map.structure.length - 2) / 2);
      const fromCentre = Math.max(Math.abs(start.x - centreX), Math.abs(start.y - centreY));
      check(
        fromCentre <= ROAMER_START_TOLERANCE_TILES,
        `she starts within ${ROAMER_START_TOLERANCE_TILES} tiles of the room's centre (${fromCentre})`,
      );
      check(onOpenFloor(start), 'she starts on open floor the player can reach, off the doorstep');
      check(hasRoomToMove(map, start.x, start.y), 'she starts somewhere with room to move');

      const visited = new Set<string>();
      let offFloorFrames = 0;
      let farthestPx = 0;
      const startX = lori.x;
      const startY = lori.y;
      for (let frame = 0; frame < ROAMER_WANDER_FRAMES; frame++) {
        occupants.update();
        const tile = tileUnder(lori);
        visited.add(`${tile.x},${tile.y}`);
        if (!onOpenFloor(tile)) offFloorFrames++;
        farthestPx = Math.max(farthestPx, Math.hypot(lori.x - startX, lori.y - startY));
      }
      check(
        offFloorFrames === 0,
        `she never leaves reachable open floor (${offFloorFrames} frames off it)`,
      );
      check(
        visited.size >= ROAMER_MIN_TILES_VISITED,
        `she wanders the room rather than shuffling in place (${visited.size} tiles)`,
      );
      check(
        farthestPx >= ROAMER_MIN_REACH_TILES * TILE_SIZE,
        `she gets at least ${ROAMER_MIN_REACH_TILES} tiles from where she started`,
      );

      // Caught mid-stride, so her stopping is the hold's doing and not a pause
      // she happened to be in anyway.
      let strideWait = 0;
      while (!lori.moving && strideWait < ROAMER_STRIDE_WAIT_FRAMES) {
        occupants.update();
        strideWait++;
      }
      check(lori.moving, 'she is caught mid-stride before the player steps up');
      focus = { x: lori.x + TILE_SIZE, y: lori.y };
      const heldX = lori.x;
      const heldY = lori.y;
      let driftPx = 0;
      for (let frame = 0; frame < ROAMER_HOLD_TEST_FRAMES; frame++) {
        occupants.update();
        driftPx = Math.max(driftPx, Math.hypot(lori.x - heldX, lori.y - heldY));
      }
      check(driftPx <= ROAMER_HOLD_SLACK_PX, `she stands still beside the player (${driftPx}px)`);
      check(lori.facing === 'right', 'and turns to face them');

      focus = null;
      let resumed = false;
      for (let frame = 0; frame < ROAMER_RESUME_FRAMES && !resumed; frame++) {
        occupants.update();
        resumed = Math.hypot(lori.x - heldX, lori.y - heldY) > ROAMER_HOLD_SLACK_PX;
      }
      check(resumed, 'she strolls on once the player walks off');
    }
  }
}

console.log('\nSteve Cartwright shoots at his target, and holds fire for anyone in the lane');
// The routine's whole job is runtime behaviour: a bolt that never leaves, or
// one loosed through a crawler standing in the lane, is invisible to every
// placement check above.
{
  const kind = buildings.get(CARTWRIGHT_HOME);
  check(kind !== undefined, `"${CARTWRIGHT_HOME}" is a real building`);
  if (kind !== undefined) {
    const map = buildInterior(CARTWRIGHT_HOME, kind, TOWER_GROUND_FLOOR);
    const inLane: RoutineBody[] = [];
    const cues: OccupantRoutineCue[] = [];
    const occupants = InteriorOccupantSystem.forBuilding(
      map,
      kind,
      CARTWRIGHT_HOME,
      () => null,
      () => inLane,
      (cue) => cues.push(cue),
    );
    const placed = occupants?.placements.find(
      (placement) => placement.spec.residentId === 'steve_cartwright',
    );
    const routine = placed?.spec.routine;
    const targetProp = routine?.kind === 'target_practice' ? routine.targetProp : null;
    const target =
      targetProp === null
        ? undefined
        : map.placedInteriorProps.find((prop) => prop.propId === targetProp);
    check(placed !== undefined, 'Steve is placed in his workshop');
    check(
      placed?.person.species === residentSpecies(residentById('steve_cartwright')),
      `his figure carries his resident species (${placed?.person.species ?? 'none'}) into his dialog`,
    );
    check(targetProp !== null, 'Steve runs a target practice');
    check(target !== undefined, `the workshop places his ${targetProp ?? 'target'}`);
    if (occupants !== null && placed !== undefined && targetProp !== null && target !== undefined) {
      const footprint = TOWN_INTERIOR_PROPS[targetProp].footprint;
      // The open tiles between his stand and the target's nearest edge, along
      // whichever row or column he shares with it.
      const sharesRow =
        placed.stand.y >= target.tile.y && placed.stand.y < target.tile.y + footprint.h;
      const sharesColumn =
        placed.stand.x >= target.tile.x && placed.stand.x < target.tile.x + footprint.w;
      const lane: Array<{ x: number; y: number }> = [];
      if (sharesRow) {
        const step = Math.sign(target.tile.x - placed.stand.x);
        const edge = step > 0 ? target.tile.x : target.tile.x + footprint.w - 1;
        for (let x = placed.stand.x + step; x !== edge; x += step)
          lane.push({ x, y: placed.stand.y });
      } else if (sharesColumn) {
        const step = Math.sign(target.tile.y - placed.stand.y);
        const edge = step > 0 ? target.tile.y : target.tile.y + footprint.h - 1;
        for (let y = placed.stand.y + step; y !== edge; y += step)
          lane.push({ x: placed.stand.x, y });
      }
      const shootingDistance = lane.length + 1;
      check(
        (sharesRow || sharesColumn) && shootingDistance >= MIN_SHOOTING_LANE_TILES,
        `he stands square to the target, ${MIN_SHOOTING_LANE_TILES} or more tiles back (${shootingDistance})`,
      );
      check(
        lane.every((tile) => map.isWalkable(tile.x, tile.y)),
        'the lane between him and the target is open floor',
      );

      const releases = (): number => cues.filter((cue) => cue === 'crossbowRelease').length;
      for (let frame = 0; frame < TARGET_PRACTICE_CYCLE_FRAMES; frame++) occupants.update();
      check(releases() > 0, `he looses a bolt within ${TARGET_PRACTICE_CYCLE_FRAMES} frames`);
      check(cues.includes('boltThunk'), 'and the bolt strikes the target');

      const midLane = lane[Math.floor(lane.length / 2)] ?? placed.stand;
      const midLanePx = { x: midLane.x * TILE_SIZE, y: midLane.y * TILE_SIZE };
      const runFrames = (frames: number): void => {
        for (let frame = 0; frame < frames; frame++) occupants.update();
      };
      const holdsFireFor = (
        who: string,
        bodies: ReadonlyArray<RoutineBody>,
        stepOut: () => void = () => undefined,
      ): void => {
        inLane.push(...bodies);
        // One cycle to let a shot already loosed or a reload under way play out.
        runFrames(TARGET_PRACTICE_CYCLE_FRAMES);
        const heldFrom = releases();
        runFrames(TARGET_PRACTICE_HELD_FRAMES);
        check(
          releases() === heldFrom,
          `he looses nothing while ${who} stands in the lane (${releases() - heldFrom} shots)`,
        );
        inLane.length = 0;
        stepOut();
        runFrames(TARGET_PRACTICE_CYCLE_FRAMES);
        check(releases() > heldFrom, `he resumes once ${who} is out of the lane`);
      };
      const noParty = {
        crawlers: [],
        pet: { deinonychus: null },
        hire: { activeMerc: null, downedMerc: null },
        cow: { cow: null },
      };
      holdsFireFor('a crawler', partyRoutineBodies({ ...noParty, crawlers: [midLanePx] }));
      holdsFireFor(
        'a downed hire',
        partyRoutineBodies({ ...noParty, hire: { activeMerc: null, downedMerc: midLanePx } }),
      );
      holdsFireFor(
        'a cow not on her feet',
        partyRoutineBodies({ ...noParty, cow: { cow: midLanePx } }),
      );
      holdsFireFor(
        'a recalling Deinonychus',
        partyRoutineBodies({ ...noParty, pet: { deinonychus: midLanePx } }),
      );

      const shooter = placed.person;
      const other = occupants.people.find((person) => person !== shooter);
      check(other !== undefined, 'his workshop has another occupant to step into the lane');
      if (other !== undefined) {
        const otherHome = { x: other.x, y: other.y };
        other.x = midLanePx.x;
        other.y = midLanePx.y;
        other.frozen = true;
        holdsFireFor('another occupant', [], () => {
          other.x = otherHome.x;
          other.y = otherHome.y;
          other.frozen = false;
        });
      }

      // A body stepping into the lane after the bolt has left: the bolt in
      // flight must not be drawn on through them into the target.
      const thunks = (): number => cues.filter((cue) => cue === 'boltThunk').length;
      const releasedBefore = releases();
      let released = false;
      for (let frame = 0; frame < TARGET_PRACTICE_CYCLE_FRAMES && !released; frame++) {
        occupants.update();
        released = releases() > releasedBefore;
      }
      check(released, 'he looses a bolt with the lane clear');
      const thunksAtRelease = thunks();
      inLane.push({ ...midLanePx, w: TILE_SIZE, h: TILE_SIZE });
      runFrames(TARGET_PRACTICE_CYCLE_FRAMES);
      check(
        thunks() === thunksAtRelease,
        `a bolt in flight stops at a body that steps into its path (${thunks() - thunksAtRelease} struck)`,
      );
      inLane.length = 0;
      runFrames(TARGET_PRACTICE_CYCLE_FRAMES);

      // Served: his menu halts the world, so no update runs to clear a pose the
      // routine left set. Whatever he was doing, he is drawn attending.
      let aiming = false;
      for (let frame = 0; frame < TARGET_PRACTICE_CYCLE_FRAMES && !aiming; frame++) {
        occupants.update();
        aiming = shooter.shownRoutinePose?.id === 'aim';
      }
      check(aiming, 'he is caught mid-aim before he is served');
      let menuOpen = true;
      // The customer walks up from below, square across his lane to the target.
      shooter.faceToward(shooter.x, shooter.y + TILE_SIZE);
      occupants.serve(shooter, () => menuOpen);
      check(shooter.shownRoutinePose === null, 'serving him draws him attending, not aiming');
      runFrames(TARGET_PRACTICE_CYCLE_FRAMES);
      check(
        shooter.shownRoutinePose === null && shooter.facing === 'down',
        'and he stays turned to the customer for as long as the menu is up',
      );
      menuOpen = false;
      let backAtIt = false;
      for (let frame = 0; frame < TARGET_PRACTICE_CYCLE_FRAMES && !backAtIt; frame++) {
        occupants.update();
        backAtIt = shooter.shownRoutinePose !== null;
      }
      check(backAtIt, 'he goes back to the target once the menu closes');
    }
  }
}

console.log('\nThe pub janitors mop their rooms');
for (const [home, residentId] of JANITOR_HOMES) {
  const kind = buildings.get(home);
  check(kind !== undefined, `"${home}" is a real building`);
  if (kind === undefined) continue;
  const map = buildInterior(home, kind, TOWER_GROUND_FLOOR);
  const cues: OccupantRoutineCue[] = [];
  const occupants = InteriorOccupantSystem.forBuilding(
    map,
    kind,
    home,
    () => null,
    () => [],
    (cue) => cues.push(cue),
  );
  const janitor = occupants?.people.find((person) => person.residentId === residentId);
  check(janitor !== undefined, `${residentId} is placed in "${home}"`);
  if (occupants === null || janitor === undefined) continue;
  check(janitor.body.kind === 'bespoke', `${residentId} is drawn by the janitor painter`);
  const posesSeen = new Set<string>();
  let walked = false;
  for (let frame = 0; frame < JANITOR_WATCH_FRAMES; frame++) {
    occupants.update();
    if (janitor.routinePose !== null) posesSeen.add(janitor.routinePose.id);
    walked ||= janitor.moving;
  }
  check(posesSeen.has('mop') && posesSeen.has('wring'), `${residentId} mops and wrings the mop`);
  check(walked, `${residentId} moves on between spots`);
  check(cues.includes('mopSwish'), `${residentId}'s strokes are heard`);
}

console.log('\nNo interior tile renders as a hole');
// A prop paints the floor it was stamped over before it paints itself, and the
// palette it paints that floor through is chosen per tile type. A palette with
// no material for the floor type underneath draws *nothing at all* and leaves a
// transparent tile, which the game draws as a solid black square behind the
// prop. Nothing throws and nothing logs, so the only way to catch it is to
// render the room and look at the pixels.
//
// The safe-room buildings matter most — their furnishings were authored against
// the dungeon's palette and now stand on town floors — but every room is cheap
// to check and any of them can grow the same fault.
await loadGameSpritesInNode();
for (const [name, kind] of buildings) {
  const map = buildInterior(name, kind, TOWER_GROUND_FLOOR);

  const tilesW = map.structure[0].length;
  const tilesH = map.structure.length;
  const canvas = createCanvas(tilesW * TILE_SIZE, tilesH * TILE_SIZE);
  const ctx = asGameContext(canvas.getContext('2d'));
  const viewW = tilesW * TILE_SIZE;
  const viewH = tilesH * TILE_SIZE;
  renderCanvas(ctx, map.structure, TILE_SIZE, 0, 0, viewW, viewH);
  renderDecorationsOverlay(ctx, map.structure, TILE_SIZE, 0, 0, viewW, viewH);

  const pixels = canvas.getContext('2d').getImageData(0, 0, viewW, viewH).data;
  const holes: string[] = [];
  for (let ty = 0; ty < tilesH; ty++) {
    for (let tx = 0; tx < tilesW; tx++) {
      const type = map.structure[ty][tx].type;
      if (type === VOID_TYPE) continue;
      let painted = 0;
      for (let py = 0; py < TILE_SIZE; py++) {
        const rowStart = ((ty * TILE_SIZE + py) * viewW + tx * TILE_SIZE) * RGBA_STRIDE;
        for (let px = 0; px < TILE_SIZE; px++) {
          if (pixels[rowStart + px * RGBA_STRIDE + ALPHA_OFFSET] > 0) painted++;
        }
      }
      const coverage = painted / (TILE_SIZE * TILE_SIZE);
      if (coverage < MIN_TILE_COVERAGE) holes.push(`${tx},${ty} (type ${type})`);
    }
  }
  check(holes.length === 0, `"${name}" paints ground under every tile — ${holes.join(' ')}`);
}

console.log('\nEvery walkable tile is reachable from the spawn');
// The single most important check here. A partition wall that seals a wing
// produces no error, no log and no visible symptom at all — just a room the
// player can see across and never walk into. Nothing else in the game measures
// this, and every hand-authored interior is one misplaced wall away from it.
for (const [name, kind] of buildings) {
  for (let floor = 0; floor < floorCount(kind); floor++) {
    const map = buildInterior(name, kind, floor);
    const stranded = unreachableWalkableTiles(map);
    const where = kind === 'tower' ? `"${name}" floor ${floor}` : `"${name}"`;
    check(stranded.length === 0, `${where} reaches every walkable tile — ${stranded.join(' ')}`);
  }
}

console.log('\nEvery door opens onto clear floor');
// Reachability alone passes a room whose doorway is half-plugged: the second
// door column still lets the player in, so nothing is stranded, yet a prop
// parked just inside one column snags the player on every entry and exit. The
// walk-in spawn sits between the two columns, so this is also the first
// collision anyone meets in the room. Checked for every storey with a door,
// against both the live movement test and the authored prop footprints, so a
// prop whose blocking flag failed to land is still caught. A tower's upper
// storeys are reached by stairs and have no door, so there is nothing to check
// there; every ground floor must have one, or the check would pass on nothing.
for (const [name, kind] of buildings) {
  for (let floor = 0; floor < floorCount(kind); floor++) {
    const map = buildInterior(name, kind, floor);
    const where = kind === 'tower' ? `"${name}" floor ${floor}` : `"${name}"`;
    const exitCount = map._interiorExitTiles.length;
    const isGroundFloor = floor === 0;
    if (isGroundFloor) {
      check(exitCount > 0, `${where} has a door to check (${exitCount} exit tile(s))`);
    }
    if (exitCount === 0) continue;
    const blockingFootprint = new Set(
      map
        .placedInteriorPropFootprintTiles()
        .filter((tile) => tile.blocksMovement)
        .map((tile) => tileKey(tile.x, tile.y)),
    );
    const plugged: string[] = [];
    for (const exit of map._interiorExitTiles) {
      for (let depth = 1; depth <= DOORWAY_CLEAR_DEPTH_TILES; depth++) {
        const x = exit.x;
        const y = exit.y - depth;
        const key = tileKey(x, y);
        if (!map.isWalkable(x, y) || blockingFootprint.has(key)) {
          const propHere = map.placedInteriorProps.find((placed) => {
            const footprint = TOWN_INTERIOR_PROPS[placed.propId].footprint;
            const coversX = x >= placed.tile.x && x < placed.tile.x + footprint.w;
            const coversY = y >= placed.tile.y && y < placed.tile.y + footprint.h;
            return coversX && coversY;
          });
          const blocker = propHere?.propId ?? `tile type ${map.structure[y][x].type}`;
          plugged.push(`${key} (${blocker})`);
        }
      }
    }
    check(plugged.length === 0, `${where} has clear floor inside its door — ${plugged.join(' ')}`);
  }
}

console.log("\nThe club's stages are solid, and the lanes past them open");
// A stage is the dancer's alone, so every tile of it must refuse the party;
// and the walk from the bar side to the tables passes above and below each
// platform, so the rows either side of it must stay clear the whole way across.
{
  const map = buildInterior('taloncrest_nightclub', 'club', TOWER_GROUND_FLOOR);
  for (const post of CLUB_PERFORMER_POSTS) {
    const open: string[] = [];
    const blockedLane: string[] = [];
    for (let ty = post.stage.y0; ty <= post.stage.y1; ty++) {
      for (let tx = post.stage.x0; tx <= post.stage.x1; tx++) {
        if (map.isWalkable(tx, ty)) open.push(`${tx},${ty}`);
      }
    }
    const laneRows = [
      ...Array.from({ length: CLUB_STAGE_LANE_TILES }, (_, i) => post.stage.y0 - 1 - i),
      ...Array.from({ length: CLUB_STAGE_LANE_TILES }, (_, i) => post.stage.y1 + 1 + i),
    ];
    for (const ty of laneRows) {
      for (let tx = post.stage.x0; tx <= post.stage.x1; tx++) {
        if (!map.isWalkable(tx, ty)) blockedLane.push(`${tx},${ty}`);
      }
    }
    check(open.length === 0, `${post.performer}'s stage refuses the party — ${open.join(' ')}`);
    check(
      blockedLane.length === 0,
      `the lanes past ${post.performer}'s stage stay open — ${blockedLane.join(' ')}`,
    );
  }
  const host = InteriorOccupantSystem.forBuilding(map, 'club', 'taloncrest_nightclub');
  const brandon = host?.placements.find((placement) => placement.spec.residentId === 'brandon');
  check(
    brandon?.stand.x === CLUB_HOST_MARK.x && brandon.stand.y === CLUB_HOST_MARK.y,
    `Brandon stands on his mark behind the host stand (${brandon?.stand.x},${brandon?.stand.y})`,
  );
}

console.log("\nThe club's crowd stands in company, not wandering");
// Patrons are meant to stand in knots facing each other, at the high-top
// tables, or in front of a stage — and move between those, never stroll for
// the sake of it. Measured over ten simulated minutes, sampled once a second.
{
  const map = buildInterior('taloncrest_nightclub', 'club', TOWER_GROUND_FLOOR);
  const crowd = createClubCrowd(map, mulberry32(CROWD_SIM_SEED));
  // Two gatherings whose rings come within two bodies of each other leave
  // their members shoving each other off their places forever.
  const ringClash: string[] = [];
  const minRingGapPx = 2 * CROWD_BODY_RADIUS_TILES * TILE_SIZE;
  CLUB_GATHERINGS.forEach((_, a) => {
    CLUB_GATHERINGS.forEach((__, b) => {
      if (b <= a) return;
      for (const p of crowd.openRingPoints(a)) {
        for (const q of crowd.openRingPoints(b)) {
          if (Math.hypot(p.x - q.x, p.y - q.y) < minRingGapPx) ringClash.push(`${a}/${b}`);
        }
      }
    });
  });
  check(
    ringClash.length === 0,
    `no two gatherings stand their people within two bodies of each other — ${[...new Set(ringClash)].join(' ')}`,
  );
  const sampleEvery = CLUB_ANIM_FRAMES_PER_SECOND;
  const totalTicks = CROWD_SIM_SECONDS * CLUB_ANIM_FRAMES_PER_SECOND;
  const peakCompany = CLUB_GATHERINGS.map(() => 0);
  let patronSamples = 0;
  let waiting = 0;
  let settledGathered = 0;
  let facingIn = 0;
  let crowdedTalk = 0;
  let intentChanges = 0;
  let pausedOnWaypoint = 0;
  let worstWaypointOffLine = 0;
  let lastIntents: string[] = [];
  for (let tick = 1; tick <= totalTicks; tick++) {
    crowd.update([]);
    if (tick % sampleEvery !== 0) continue;
    const readings = crowd.readings();
    const intents = readings.map((reading) => JSON.stringify(reading.intent));
    intentChanges += intents.filter(
      (intent, i) => lastIntents[i] !== undefined && lastIntents[i] !== intent,
    ).length;
    lastIntents = intents;
    const settledByGathering = CLUB_GATHERINGS.map(() => 0);
    const talkersByGathering = CLUB_GATHERINGS.map(() => 0);
    for (const reading of readings) {
      patronSamples++;
      if (reading.pausedOnWaypoint) pausedOnWaypoint++;
      if (reading.waypointOffLineTiles !== null) {
        worstWaypointOffLine = Math.max(worstWaypointOffLine, reading.waypointOffLineTiles);
      }
      if (reading.intent.kind === 'wait') waiting++;
      if (reading.intent.kind !== 'gather' || !reading.settled) continue;
      const index = reading.intent.gathering;
      const gathering = CLUB_GATHERINGS[index];
      settledByGathering[index]++;
      if (reading.talking) talkersByGathering[index]++;
      settledGathered++;
      const towardX = gathering.centre.x * TILE_SIZE - reading.cx;
      const towardY = gathering.centre.y * TILE_SIZE - reading.cy;
      if (towardX * reading.facingX + towardY * reading.facingY > 0) facingIn++;
    }
    settledByGathering.forEach((count, index) => {
      peakCompany[index] = Math.max(peakCompany[index], count);
      if (talkersByGathering[index] > 1) crowdedTalk++;
    });
  }
  check(
    waiting / patronSamples < CROWD_MAX_WAITING_SHARE,
    `patrons almost always have somewhere to be (${waiting} of ${patronSamples} samples waiting)`,
  );
  check(
    peakCompany.every((peak) => peak >= MIN_COMPANY),
    `every table and circle draws company at some point — peaks ${peakCompany.join(' ')}`,
  );
  check(
    settledGathered > 0 && facingIn / settledGathered >= CROWD_MIN_FACING_IN_SHARE,
    `people standing in company face its middle (${facingIn} of ${settledGathered})`,
  );
  check(
    crowdedTalk === 0,
    `one member of a group talks at a time (${crowdedTalk} samples with more)`,
  );
  check(pausedOnWaypoint === 0, `nobody stops on a waypoint (${pausedOnWaypoint} samples)`);
  check(
    worstWaypointOffLine <= WAYPOINT_MAX_OFF_LINE_TILES,
    `every waypoint lies near the straight walk (worst ${worstWaypointOffLine.toFixed(2)} tiles off it)`,
  );
  check(
    intentChanges >= CLUB_PATRON_COUNT,
    `patrons move on between groups and stages (${intentChanges} moves in ${CROWD_SIM_SECONDS} s)`,
  );
}

console.log("\nThe club's gatherings never take more people than they have room for");
// Counted every tick from intents, not from who has settled: a patron walking
// to a full group is already one too many, and the overfill only happens when
// two patrons change plans on the same tick, so several seeds are run.
{
  const map = buildInterior('taloncrest_nightclub', 'club', TOWER_GROUND_FLOOR);
  const totalTicks = CROWD_SIM_SECONDS * CLUB_ANIM_FRAMES_PER_SECOND;
  const overfullSeeds: string[] = [];
  for (let seed = 1; seed <= CAPACITY_SIM_SEEDS; seed++) {
    const crowd = createClubCrowd(map, mulberry32(seed));
    let overfullTicks = 0;
    for (let tick = 1; tick <= totalTicks; tick++) {
      crowd.update([]);
      const members = CLUB_GATHERINGS.map(() => 0);
      for (const reading of crowd.readings()) {
        if (reading.intent.kind === 'gather') members[reading.intent.gathering]++;
      }
      if (members.some((count, index) => count > CLUB_GATHERINGS[index].capacity)) overfullTicks++;
    }
    if (overfullTicks > 0) overfullSeeds.push(`seed ${seed}: ${overfullTicks} ticks`);
  }
  check(
    overfullSeeds.length === 0,
    `no gathering ever counts more members than its capacity — ${overfullSeeds.join(', ')}`,
  );
}

console.log("\nThe club's gamblers follow the tables");
// Blackjack is played one-on-one with Deuce, so its stools empty while the
// table is open; once it closes they fill again only after a while, not on
// the tick the panel shuts. The poker stools hold exactly the regulars the
// poker screen deals, and the player's own stool stays empty.
{
  const seededRandom = (() => {
    let state = GAMBLER_SIM_SEED;
    return (): number => {
      state = (state * GAMBLER_LCG_MULTIPLIER + GAMBLER_LCG_INCREMENT) % GAMBLER_LCG_MODULUS;
      return state / GAMBLER_LCG_MODULUS;
    };
  })();
  const gamblers = new ClubGamblerSystem(seededRandom);
  const settleTicks = GAMBLER_SETTLE_SECONDS * CLUB_ANIM_FRAMES_PER_SECOND;
  const blackjackHeld = (): number =>
    gamblers.occupiedSeats().filter((seat) => seat.fixture.game === 'blackjack').length;
  let tick = 0;
  const run = (ticks: number, view: Parameters<ClubGamblerSystem['update']>[1]): void => {
    for (let i = 0; i < ticks; i++) gamblers.update(++tick, view);
  };
  const closed = { blackjackOpen: false, pokerSeats: null };
  run(settleTicks, closed);
  run(BLACKJACK_SESSION_SECONDS * CLUB_ANIM_FRAMES_PER_SECOND, {
    blackjackOpen: true,
    pokerSeats: null,
  });
  check(blackjackHeld() === 0, 'blackjack stools empty while the table is open');
  run(1, closed);
  check(blackjackHeld() === 0, 'blackjack stools stay empty the tick the table closes');
  run(settleTicks, closed);
  check(blackjackHeld() > 0, `blackjack stools fill again a while after (${blackjackHeld()} held)`);

  const [, ...dealt] = REGULAR_IDS;
  const seats = [null, ...dealt.slice(0, NPC_SEAT_COUNT)].map((occupantId) => ({ occupantId }));
  run(1, { blackjackOpen: false, pokerSeats: seats });
  const pokerSeated = gamblers.occupiedSeats().filter((seat) => seat.fixture.game === 'poker');
  const matches = pokerSeated.every(
    (seat) =>
      seat.fixture.game === 'poker' && seats[seat.fixture.pokerSeat]?.occupantId === seat.regular,
  );
  check(
    pokerSeated.length === NPC_SEAT_COUNT && matches,
    `the poker stools hold exactly the dealt regulars (${pokerSeated.length} seated)`,
  );
}

console.log('\nEvery prop that makes a sound sounds once, from inside its room');
// A fire whose prop declares a crackle but which never gets an emitter is a
// silent hearth, and one that gets two plays nothing louder, only doubled work;
// neither shows in a screenshot. Unnamed houses take the generic layout, so one
// is built alongside the named rooms: its hearth is a prop like every other.
const GENERIC_HOUSE_NAME = null;
const soundingRooms: ReadonlyArray<readonly [BuildingId | null, BuildingKind]> = [
  ...buildings,
  [GENERIC_HOUSE_NAME, 'house'],
];
let soundingPropCount = 0;
for (const [name, kind] of soundingRooms) {
  for (let floor = 0; floor < floorCount(kind); floor++) {
    const map = buildInterior(name, kind, floor);
    const where = kind === 'tower' ? `"${name}" floor ${floor}` : `"${name ?? 'a generic house'}"`;
    const emitters = townInteriorPropEmitters(map.placedInteriorProps, undefined);
    const sounding = map.placedInteriorProps.filter(
      (placed) => TOWN_INTERIOR_PROPS[placed.propId].ambientSound !== undefined,
    );
    soundingPropCount += sounding.length;
    const miscounted = sounding
      .map((placed) => ({
        placed,
        count: emitters.filter((emitter) => emitter.placedId === placed.id).length,
      }))
      .filter(({ count }) => count !== 1)
      .map(({ placed, count }) => `${placed.id} x${count}`);
    check(
      miscounted.length === 0 && emitters.length === sounding.length,
      `${where} plays one loop per sounding prop (${sounding.length}) — ${miscounted.join(' ')}`,
    );
    const outside = emitters
      .filter((emitter) => {
        const tileX = Math.floor(emitter.x);
        const tileY = Math.floor(emitter.y);
        const insideGrid =
          tileY >= 0 &&
          tileY < map.structure.length &&
          tileX >= 0 &&
          tileX < map.structure[tileY].length;
        return !insideGrid || map.structure[tileY][tileX].type === VOID_TYPE;
      })
      .map((emitter) => `${emitter.placedId}@${emitter.x},${emitter.y}`);
    check(
      outside.length === 0,
      `${where} sounds every prop from inside the room — ${outside.join(' ')}`,
    );
    if (sounding.length > 0) {
      const firstSounding = sounding[0];
      const withOneHidden = townInteriorPropEmitters(
        map.placedInteriorProps,
        new Set([firstSounding.id]),
      );
      check(
        withOneHidden.every((emitter) => emitter.placedId !== firstSounding.id),
        `${where} silences ${firstSounding.id} once it is smashed or taken down`,
      );
    }
  }
}
check(soundingPropCount > 0, `the rooms hold sounding props to check (${soundingPropCount})`);
const genericHouse = buildInterior(GENERIC_HOUSE_NAME, 'house', TOWER_GROUND_FLOOR);
check(
  townInteriorPropEmitters(genericHouse.placedInteriorProps, undefined).length > 0,
  'a generic house crackles from its hearth',
);

console.log('\nCounter door avoidance');
// The archway-seal check below is an outcome assertion: it only ever inspects
// the run `planSafeRoomCounters` actually lays on the inn's current geometry,
// so a regression in the avoidance logic itself would pass silently as long as
// that one building's doors happen to sit away from where a naive centring
// would put the run anyway. This exercises `widestFreeSpan` — the function
// that excludes door columns from the candidate span — directly, with bounds
// built so a naive centre-of-the-room run would land squarely on a "door".
{
  const ADVERSARIAL_BOUNDS = { x: 0, y: 0, w: 12, h: 5 };
  // The room's usable span (after the wall margin) is columns 1..10: a naive
  // centring with no door logic at all would put a run across the middle of
  // that span, which is exactly where this column sits.
  const DOOR_COLUMN_AT_NAIVE_CENTRE = 5;
  const WIDER_SPAN_WIDTH = 5;
  const span = widestFreeSpan(ADVERSARIAL_BOUNDS, new Set([DOOR_COLUMN_AT_NAIVE_CENTRE]));
  const spanCoversDoorColumn =
    DOOR_COLUMN_AT_NAIVE_CENTRE >= span.x0 && DOOR_COLUMN_AT_NAIVE_CENTRE < span.x0 + span.width;
  check(span.width > 0, 'widestFreeSpan finds a usable span around a blocked column');
  check(!spanCoversDoorColumn, 'widestFreeSpan excludes a door column from the span it returns');
  // Also pins the "widest", not merely "some", free span: splitting the usable
  // range at column 5 leaves a 4-wide span to its west and a 5-wide span to
  // its east, and the mechanism is supposed to prefer the larger one.
  check(
    span.width === WIDER_SPAN_WIDTH,
    'widestFreeSpan picks the wider of the two spans the block leaves',
  );
}

console.log('\nThe safe room');
check(safeRoomBuildings.size === 1, 'exactly one building hosts the town safe room');
for (const name of safeRoomBuildings) {
  const kind = buildings.get(name);
  if (kind === undefined) {
    check(false, `"${name}" claims the safe room and is a real building`);
    continue;
  }
  const map = buildInterior(name, kind, TOWER_GROUND_FLOOR);
  check(map.safeRooms.length > 0, `"${name}" registers a safe room in its interior`);

  const layouts = planSafeRoomCounters(map);
  check(layouts.length > 0, `"${name}"'s safe room is wide enough for the Bopca's counter`);
  for (const layout of layouts) {
    const bounds = layout.roomBounds;
    const runTiles = [...layout.backTiles, ...layout.counterTiles, ...layout.galleyTiles];
    const escapes = runTiles.filter(
      (tile) =>
        tile.x < bounds.x ||
        tile.x >= bounds.x + bounds.w ||
        tile.y < bounds.y ||
        tile.y >= bounds.y + bounds.h,
    );
    // The wall row carrying the archways is the row immediately north of the
    // bounds, so a run that reaches outside them is standing in the doorway.
    check(
      escapes.length === 0,
      `"${name}"'s counter run stays inside its safe room — ${escapes.map((t) => tileKey(t.x, t.y)).join(' ')}`,
    );

    // The run is solid apart from its galley strip, and it is laid against the
    // bounds' north wall — the same wall the archways to the rest of the
    // building are cut through. A run laid across one of them walls off
    // everything on the far side, and the only symptom is an upstairs the
    // player can never reach.
    const solidRunTiles = new Set(
      [...layout.backTiles, ...layout.counterTiles].map((tile) => tileKey(tile.x, tile.y)),
    );
    const sealedArchways: string[] = [];
    const archwayRow = bounds.y - 1;
    for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
      if (!map.isWalkableIgnoringPermanent(x, archwayRow)) continue;
      if (solidRunTiles.has(tileKey(x, bounds.y))) sealedArchways.push(tileKey(x, archwayRow));
    }
    check(
      sealedArchways.length === 0,
      `"${name}"'s counter run seals no archway into the safe room — ${sealedArchways.join(' ')}`,
    );
  }
}

console.log("\nFurniture scan matches the placer's own border");
// `scanInteriorFurniture` is the exact function `InteriorOccupantSystem` places
// occupants from, reused here rather than re-walked, so the two cannot drift
// apart on where the border sits. This proves the exclusion directly — furniture
// stamped on the outermost ring must not appear in the scan — rather than only
// ever observing it on interiors where no anchor tile happens to reach the wall.
{
  const [sampleName, sampleKind] = [...buildings][0];
  const map = buildInterior(sampleName, sampleKind, TOWER_GROUND_FLOOR);
  const countTiles = (byKind: Map<AnchorKind, FurniturePiece[]>): number =>
    [...byKind.values()].reduce((sum, tiles) => sum + tiles.length, 0);

  const before = countTiles(scanInteriorFurniture(map));
  const borderTile = map.structure[0][0];
  const originalBorderType = borderTile.type;
  borderTile.type = ANCHOR_TILE_TYPES[0].types[0];
  const after = countTiles(scanInteriorFurniture(map));
  borderTile.type = originalBorderType;

  check(after === before, 'furniture stamped on the grid border is not counted by the scan');
}

console.log('\nEvery roster occupant finds furniture to stand at');
// `forBuilding` drops an occupant whose anchor group matched nothing, with no
// warning of any kind: the NPC simply is not in the room. Three taverns have
// lost their innkeepers this way, and a cottage its resident — each found only
// by hand, none by anything automatic.
for (const [name, roster] of BUILDING_OCCUPANTS) {
  const kind = buildings.get(name);
  if (kind === undefined) continue;
  const map = buildInterior(name, kind, TOWER_GROUND_FLOOR);

  // Scanned through the same helper `InteriorOccupantSystem` uses rather than
  // walking `map.structure` directly: the placer excludes the outer ring of
  // border tiles, so a wider scan here would pass furniture stamped on the
  // border that the placer itself will never find.
  const furnitureByKind = new Map<AnchorKind, number>();
  for (const [anchorKind, tiles] of scanInteriorFurniture(map)) {
    furnitureByKind.set(anchorKind, tiles.length);
  }
  const anchorsWanted = new Set(
    roster.flatMap((occupant) => {
      const anchor = occupantAnchor(occupant);
      return anchor === null ? [] : [anchor];
    }),
  );
  for (const anchor of anchorsWanted) {
    check(
      (furnitureByKind.get(anchor) ?? 0) > 0,
      `"${name}" holds ${anchor} furniture for the occupant anchored to it`,
    );
  }

  const system = InteriorOccupantSystem.forBuilding(map, kind, name);
  check(
    system?.people.length === roster.length,
    `"${name}" places all ${roster.length} of its rostered occupants`,
  );
}

console.log('\nPlacements resolve and territories hold their stands');
// A prop placement names one piece of furniture and one side of it; the
// placer centres the stand on that side's middle and gives up on the piece if
// the whole side is solid, taken or reserved. A territory is the only thing
// keeping an occupant near their post, and one that excludes the stand would
// walk them off it on their first stroll and never let them back.
let propPlacementsSeen = 0;
for (const [name] of BUILDING_OCCUPANTS) {
  const kind = buildings.get(name);
  if (kind === undefined) continue;
  const map = buildInterior(name, kind, TOWER_GROUND_FLOOR);
  const system = InteriorOccupantSystem.forBuilding(map, kind, name);
  if (system === null) continue;
  for (const placed of system.placements) {
    const who = placed.spec.residentId ?? placed.spec.role;
    check(placed.territoryHolds(placed.stand), `"${name}"'s ${who} stands inside their territory`);
    const placement = placed.spec.placement;
    if (placement.kind !== 'prop') continue;
    propPlacementsSeen++;
    const { x, y } = placed.stand;
    check(map.isWalkable(x, y), `"${name}"'s ${who} stands on walkable floor`);
    check(
      !system.reservedStandTiles.has(`${x},${y}`),
      `"${name}"'s ${who} stands clear of the door, the spawns and the doorways`,
    );
    const piece = placed.furniture;
    const onProp =
      piece !== null &&
      map.placedInteriorProps.some(
        (prop) =>
          prop.propId === placement.prop && prop.tile.x === piece.x && prop.tile.y === piece.y,
      );
    check(onProp, `"${name}"'s ${who} is stood at a ${placement.prop} the room places`);
    if (piece === null) continue;
    const besideSide = ((): boolean => {
      const withinColumns = x >= piece.x && x < piece.x + piece.w;
      const withinRows = y >= piece.y && y < piece.y + piece.h;
      const distance = placement.distance ?? 1;
      switch (placement.side) {
        case 'north':
          return withinColumns && y === piece.y - distance;
        case 'south':
          return withinColumns && y === piece.y + piece.h - 1 + distance;
        case 'west':
          return withinRows && x === piece.x - distance;
        case 'east':
          return withinRows && x === piece.x + piece.w - 1 + distance;
      }
    })();
    check(
      besideSide,
      `"${name}"'s ${who} stands ${placement.distance ?? 1} tile(s) off the ${placement.side} side of the ${placement.prop}`,
    );
  }
}
check(propPlacementsSeen > 0, 'some roster places an occupant by prop');

console.log('\nBespoke resident figures draw through a townsperson');
// Drawn here the way an occupant draws one, so a broken walk cadence or
// action mapping on the townsperson path is caught before any room stands the
// figure up.
for (const id of Object.keys(BESPOKE_RESIDENT_FIGURES).filter(isBespokeResidentFigureId)) {
  const person = new Townsperson({
    x: TILE_SIZE,
    y: TILE_SIZE,
    role: 'commoner',
    species: DEFAULT_TOWN_SPECIES,
    seed: 1,
    speed: 1,
    wander: {
      pickTarget: () => ({ x: TILE_SIZE, y: TILE_SIZE }),
      arriveDist: 1,
      pauseMin: 1,
      pauseMax: 2,
    },
    bespokeFigure: id,
  });
  const sizePx = BESPOKE_PROBE_TILES * TILE_SIZE;
  const canvas = createCanvas(sizePx, sizePx);
  const probeCtx = canvas.getContext('2d');
  person.render(asGameContext(probeCtx), 0, 0, TILE_SIZE);
  const pixels = probeCtx.getImageData(0, 0, sizePx, sizePx).data;
  let ink = 0;
  for (let i = ALPHA_OFFSET; i < pixels.length; i += RGBA_STRIDE) if (pixels[i] > 0) ink++;
  check(person.body.kind === 'bespoke', `a townsperson given "${id}" wears the bespoke figure`);
  check(ink > 0, `a townsperson wearing "${id}" draws something`);
}

console.log('\nEvery anchor kind is used by somebody');
// An anchor kind nobody anchors to is furniture the placer will never look for,
// and the loop above can only check the kinds a roster names — so an anchor that
// fell out of every roster would leave both sides of the pairing unmeasured.
for (const anchorKind of ANCHOR_KINDS) {
  const rostered = [...BUILDING_OCCUPANTS.values()].some((roster) =>
    roster.some((occupant) => occupantAnchor(occupant) === anchorKind),
  );
  check(rostered, `some building's roster anchors an occupant to ${anchorKind} furniture`);
}

console.log('\nStat boons present themselves as boons');
// A status with no look falls back to a grey *harmful* pill, so a boon the
// player paid coins for would show in the HUD as though it were a poison.
check(STAT_BOON_BONUSES.size > 0, 'there is at least one stat boon to check');
for (const [type, bonuses] of STAT_BOON_BONUSES) {
  const visual = statusVisual(type);
  check(visual !== null, `the "${type}" boon has a registered status visual`);
  check(visual?.harmful === false, `the "${type}" boon is not painted as something to fear`);
  check(
    Object.values(bonuses).some((amount) => amount !== 0),
    `the "${type}" boon actually moves a stat`,
  );
}

console.log('\nEvery walk-in building has something to do');
for (const [name, kind] of buildings) {
  if (SCRIPTED_KINDS.has(kind)) continue;
  const roster = BUILDING_OCCUPANTS.get(name) ?? [];
  const hasResident = roster.some((occupant) => occupant.residentId !== undefined);
  const hasService = interiorServicesFor(name).length > 0;
  const hasReadable = readablesFor(name).length > 0;
  check(
    hasResident || hasService || hasReadable,
    `"${name}" offers a resident, a service or something to read`,
  );
}

/** Everything `QuillConfrontationSystem` is contracted to put in the office. */
const EXPECTED_CONFRONTATION_MOBS: ReadonlyArray<string> = [
  'Miss Quill',
  'Remex, the Living Capacitor',
];
const CITY_ELF_CULTIST_NAME = 'City Elf Cultist';
/** Quill, Remex and two guards. */
const EXPECTED_CONFRONTATION_MOB_COUNT = 4;
/**
 * How far a guard may be allowed to drift from its post.
 *
 * The arrival-safety margin below is only true while they stay put, so the
 * leash is asserted as a number rather than inferred from whether anybody
 * happened to get shot.
 */
const MAX_GUARD_LEASH_TILES = 2;

console.log('\nThe tower confrontation opens on safe ground');
{
  const map = buildInterior(towerName, plan.tower.kind, TOWER_CONFRONTATION_FLOOR);
  check(map._interiorStairDownTiles.length > 0, 'the office has the stair the party climbs in on');
  const stair = map._interiorStairDownTiles[0];

  // Mirrors how `BuildingInteriorScene` places an ascending party: both crawlers
  // side by side, one row below the stair they arrived on.
  const arrivalRow = stair.y + 1;
  const human = new HumanPlayer(stair.x, arrivalRow, TILE_SIZE);
  const cat = new CatPlayer(stair.x + 1, arrivalRow, TILE_SIZE);
  human.isActive = true;
  cat.isActive = false;
  // The build this fight is hardest on, and the one it was reported broken from:
  // a crawler holding the game's minimum health has a health pool smaller
  // than a single soul bolt.
  cat.setBaseStat('health', MIN_STAT_VALUE);

  const roster = new MobRoster(map, new SpellSystem());
  const spawned: Mob[] = [];
  const progress = createMurderQuestProgress();
  progress.stage = 'confrontation';
  // The re-entry path: a party that already met Miss Quill and died to her walks
  // back into the fight itself. The arrival-safety contract below belongs to the
  // frame the *fight* opens on, and this is the shortest way to reach it. The
  // first-arrival path, with the office scene in front of it, gets its own block.
  progress.officeSceneSeen = true;
  const confrontation = new QuillConfrontationSystem(
    map,
    new EventBus(),
    (mob) => {
      spawned.push(mob);
      roster.add(mob);
    },
    progress,
    null,
    createDoomsdayProgress(),
    partyLevelOf(human.level, cat.level),
    undefined,
    new Conversation(null),
  );

  // By name and by count, not merely "something spawned": `spawnEncounter` skips
  // silently when a tile lookup misses, and a run missing Miss Quill herself
  // would otherwise print three distance lines instead of four and exit 0.
  const spawnedNames = spawned.map((mob) => mob.displayName);
  for (const expected of EXPECTED_CONFRONTATION_MOBS) {
    check(
      spawnedNames.includes(expected),
      `the confrontation puts ${expected} in the room (spawned: ${spawnedNames.join(', ')})`,
    );
  }
  check(
    spawned.length === EXPECTED_CONFRONTATION_MOB_COUNT,
    `the confrontation fills the room with all ${EXPECTED_CONFRONTATION_MOB_COUNT} of its culprits (found ${spawned.length})`,
  );

  // The offsets are only safe for as long as the guards stay on them, and the
  // wander that would carry them off is random — so the posts are asserted
  // directly rather than left to a health check downstream of 1200 frames of
  // RNG, which caught a removed leash on barely half its runs.
  const guards = spawned.filter((mob) => mob.displayName === CITY_ELF_CULTIST_NAME);
  for (const guard of guards) {
    // Present *and* on the guard's own tile: a guard that was never posted has
    // no home point at all, and must fail here rather than pass unmeasured.
    const home = guard.homePoint;
    check(
      home?.x === guard.x && home.y === guard.y,
      'each guard is posted to a home point on the tile the encounter put it on',
    );
    const leash = guard.leashRadiusTiles;
    check(
      leash !== undefined && leash <= MAX_GUARD_LEASH_TILES,
      `each guard is leashed within ${MAX_GUARD_LEASH_TILES} tiles of its post (found ${leash ?? Infinity})`,
    );
  }

  const threatRangeTiles = Math.max(
    MISS_QUILL_CAST_RANGE_TILES,
    CITY_ELF_CULTIST_AGGRO_RANGE_TILES,
  );
  const requiredTiles = threatRangeTiles + ARRIVAL_SAFETY_MARGIN_TILES;
  for (const mob of spawned) {
    const nearestCrawlerTiles =
      Math.min(
        Math.hypot(mob.x - human.x, mob.y - human.y),
        Math.hypot(mob.x - cat.x, mob.y - cat.y),
      ) / TILE_SIZE;
    check(
      nearestCrawlerTiles >= requiredTiles,
      `${mob.displayName} spawns ${nearestCrawlerTiles.toFixed(1)} tiles from the landing (needs ${requiredTiles})`,
    );
  }

  check(
    spawned.every((mob) => mob.aiHeld),
    'the room is frozen while its own intro banner is on screen',
  );

  const context: SystemContext = {
    human,
    cat,
    active: human,
    inactive: cat,
    activeIsMoving: false,
    roster,
    gameMap: map,
  };
  const mobLoop = new MobUpdateLoop();
  const humanStartHp = human.hp;
  const catStartHp = cat.hp;
  let releasedAtFrame = -1;
  for (let frame = 0; frame < ARRIVAL_VIGIL_FRAMES; frame++) {
    confrontation.update(context);
    mobLoop.update(context);
    for (const mob of roster.mobs) mob.tickTimers();
    if (releasedAtFrame < 0 && spawned.every((mob) => !mob.aiHeld)) releasedAtFrame = frame;
  }
  mobLoop.dispose();

  check(
    releasedAtFrame >= 0 && releasedAtFrame <= QUEST_BANNER_FRAMES,
    `the room wakes up when the banner clears (woke at frame ${releasedAtFrame})`,
  );
  // The party never moved and never swung: whatever happened to them here, they
  // had no way to answer, which is the whole complaint the offsets exist to fix.
  check(human.hp === humanStartHp, 'a party that stands still on the landing is not shot at');
  check(cat.hp === catStartHp, 'nor is the companion beside them');
  check(cat.isAlive, 'so the companion is still standing, and the party is not turned out');
}

console.log('\nThe office scene holds the room until it is read');
{
  const map = buildInterior(towerName, plan.tower.kind, TOWER_CONFRONTATION_FLOOR);
  check(map._interiorStairDownTiles.length > 0, 'the office has the stair the party climbs in on');
  const stair = map._interiorStairDownTiles[0];

  const arrivalRow = stair.y + 1;
  const human = new HumanPlayer(stair.x, arrivalRow, TILE_SIZE);
  const cat = new CatPlayer(stair.x + 1, arrivalRow, TILE_SIZE);
  human.isActive = true;
  cat.isActive = false;

  const roster = new MobRoster(map, new SpellSystem());
  const spawned: Mob[] = [];
  const progress = createMurderQuestProgress();
  progress.stage = 'confrontation';
  const confrontation = new QuillConfrontationSystem(
    map,
    new EventBus(),
    (mob) => {
      spawned.push(mob);
      roster.add(mob);
    },
    progress,
    null,
    createDoomsdayProgress(),
    partyLevelOf(human.level, cat.level),
    undefined,
    new Conversation(null),
  );

  check(confrontation.isDialogOpen, 'arriving fresh opens the office scene');
  check(spawned.length > 0, 'the room is already dressed behind the scene');
  check(
    spawned.every((mob) => mob.aiHeld),
    'nothing in the room moves while the scene plays',
  );

  const context: SystemContext = {
    human,
    cat,
    active: human,
    inactive: cat,
    activeIsMoving: false,
    roster,
    gameMap: map,
  };

  // Well past the banner clock: the hold belongs to the scene, not to a timer,
  // so a player who walks away mid-conversation must not come back to a fight
  // that started without them.
  for (let frame = 0; frame < QUEST_BANNER_FRAMES * 2; frame++) confrontation.update(context);
  check(
    spawned.every((mob) => mob.aiHeld),
    'the room stays frozen for as long as the scene is on screen',
  );
  check(!progress.officeSceneSeen, 'the scene is not marked seen until it has been read through');

  // Escape must not strand the room half-held: the scene's last page is what
  // releases the fight, so there is no other way out of it.
  check(!confrontation.dismissDialog(), 'the office scene refuses to be dismissed');
  check(confrontation.isDialogOpen, 'and is still on screen after the attempt');

  let pagesTurned = 0;
  const PAGE_TURN_CEILING = 32;
  while (confrontation.isDialogOpen && pagesTurned < PAGE_TURN_CEILING) {
    confrontation.advanceDialog();
    pagesTurned++;
  }
  check(!confrontation.isDialogOpen, 'the scene closes when its pages run out');
  check(pagesTurned > 1, 'the scene is more than one page, so turning it is really reading it');
  check(
    progress.officeSceneSeen,
    'reading it through marks it seen, so a death does not replay it',
  );

  const mobLoop = new MobUpdateLoop();
  let releasedAtFrame = -1;
  for (let frame = 0; frame < ARRIVAL_VIGIL_FRAMES; frame++) {
    confrontation.update(context);
    mobLoop.update(context);
    for (const mob of roster.mobs) mob.tickTimers();
    if (releasedAtFrame < 0 && spawned.every((mob) => !mob.aiHeld)) releasedAtFrame = frame;
  }
  mobLoop.dispose();
  check(
    releasedAtFrame >= 0 && releasedAtFrame <= QUEST_BANNER_FRAMES,
    `the fight opens once the scene closes (woke at frame ${releasedAtFrame})`,
  );
}

// The overworld rebuilds its scene on every building exit and reruns the
// spawner, so a camp is exactly as farmable as an interior room unless the town
// remembers it. The scene wires three calls — `noteCampCasualty` from its
// `mobKilled` handler, `spawnForLevel` with the remembered set, and the
// capture/parse/restore of `TownMemory` — and these checks drive those same
// calls through a clear, a doorway, a reload and a rewind.
console.log('\nA cleared camp stays cleared');
{
  const profile = DIFFICULTY_PROFILES.normal;
  const buildFloor = (worldSeed: number): GameMap =>
    new GameMap({
      mapSize: level3.mapSize,
      mapType: 'overworld',
      tileHeight: TILE_SIZE,
      worldSeed,
    });
  const residentsOf = (mobs: readonly Mob[], key: string): Mob[] =>
    mobs.filter((mob) => mob.campKey === key);
  const kill = (mob: Mob): void => {
    mob.hp = 0;
  };

  const floor = buildFloor(CAMP_WORLD_SEED);
  const clearedCamp = floor.camps.find((camp) => camp.kind === 'goblin');
  const standingCamp = floor.camps.find((camp) => camp.kind === 'troglodyte');
  check(
    clearedCamp !== undefined && standingCamp !== undefined,
    'the overworld sites a goblin camp and a troglodyte den to test against',
  );
  if (clearedCamp !== undefined && standingCamp !== undefined) {
    const clearedKey = campSiteKey(clearedCamp);
    const standingKey = campSiteKey(standingCamp);
    const memory = createTownMemory();
    const firstVisit = spawnForLevel(
      level3,
      floor,
      CAMP_CLEARING_PARTY_LEVEL,
      profile,
      memory.clearedCamps,
      Math.random,
    );
    const clearedResidents = residentsOf(firstVisit, clearedKey);
    const standingResidents = residentsOf(firstVisit, standingKey);
    check(
      clearedResidents.length > 1 && standingResidents.length > 1,
      `both camps are populated on first visit (${clearedResidents.length}, ${standingResidents.length})`,
    );
    check(
      firstVisit.every((mob) => mob.campKey === null || mob.homePoint !== undefined),
      'only camp residents carry a camp key',
    );

    const checkpointBeforeClear = captureTownMemory(memory);

    let clearingKill = -1;
    clearedResidents.forEach((mob, index) => {
      kill(mob);
      if (noteCampCasualty(memory, mob, firstVisit)) clearingKill = index;
    });
    check(
      clearingKill === clearedResidents.length - 1,
      `the camp is recorded on its last resident's death, not before (kill ${clearingKill + 1} of ${clearedResidents.length})`,
    );

    // Everyone but one: the survivor may have wandered off or been leashed
    // home, and either way it is still standing.
    const survivor = standingResidents[standingResidents.length - 1];
    for (const mob of standingResidents) {
      if (mob === survivor) continue;
      kill(mob);
      noteCampCasualty(memory, mob, firstVisit);
    }
    check(
      !memory.clearedCamps.has(standingKey),
      'a camp with one resident still standing is not remembered',
    );

    const afterDoorway = spawnForLevel(
      level3,
      floor,
      CAMP_RETURNING_PARTY_LEVEL,
      profile,
      memory.clearedCamps,
      Math.random,
    );
    check(
      residentsOf(afterDoorway, clearedKey).length === 0,
      'leaving a building does not re-stock the cleared camp',
    );
    check(
      residentsOf(afterDoorway, standingKey).length > 0,
      'the half-fought camp is re-stocked after the doorway',
    );

    const savedText = JSON.stringify(captureTownMemory(memory));
    const savedValue: unknown = JSON.parse(savedText);
    const parsed = parseTownMemoryCheckpoint(savedValue);
    check(parsed !== undefined, 'the saved town memory parses back');
    const reloadedMemory = createTownMemory();
    if (parsed !== undefined) restoreTownMemory(reloadedMemory, parsed);
    const afterReload = spawnForLevel(
      level3,
      buildFloor(CAMP_WORLD_SEED),
      CAMP_RETURNING_PARTY_LEVEL,
      profile,
      reloadedMemory.clearedCamps,
      Math.random,
    );
    check(
      residentsOf(afterReload, clearedKey).length === 0,
      'a reload from the same seed keeps the cleared camp empty',
    );
    check(
      residentsOf(afterReload, standingKey).length > 0,
      'and still populates the uncleared one',
    );

    const rewound = createTownMemory();
    restoreTownMemory(rewound, captureTownMemory(memory));
    restoreTownMemory(rewound, checkpointBeforeClear);
    check(
      !rewound.clearedCamps.has(clearedKey),
      'a checkpoint from before the clear rewinds the camp with the residents it revives',
    );

    const seededKeys = new Set(floor.camps.map(campSiteKey));
    const otherFloor = buildFloor(CAMP_OTHER_WORLD_SEED);
    check(
      otherFloor.camps.every((camp) => !seededKeys.has(campSiteKey(camp))),
      "another seed's camps are different camps, not the same kind remembered twice",
    );

    // The same seed again is the worst case for a restart: a regenerated camp
    // landing on a remembered site.
    forgetClearedCamps(memory);
    const restartFloor = buildFloor(CAMP_WORLD_SEED);
    const restarted = spawnForLevel(
      level3,
      restartFloor,
      CAMP_CLEARING_PARTY_LEVEL,
      profile,
      memory.clearedCamps,
      Math.random,
    );
    check(
      restartFloor.camps.every((camp) => residentsOf(restarted, campSiteKey(camp)).length > 0),
      'a floor restart repopulates every camp, even one regenerated on a remembered site',
    );
  }
}

console.log("\nNo furniture stands over the magistrate's body");
// The body is drawn by the confrontation, before the room's sorted furniture,
// so a prop whose footprint or art reaches over it is drawn on top of him. The
// body is measured from the ink it actually paints rather than from its tile,
// because it brings its own desk and chair and spreads well past one tile.
{
  const map = buildInterior(towerName, plan.tower.kind, TOWER_CONFRONTATION_FLOOR);
  const progress = createMurderQuestProgress();
  progress.stage = 'complete';
  const confrontation = new QuillConfrontationSystem(
    map,
    new EventBus(),
    () => undefined,
    progress,
    null,
    createDoomsdayProgress(),
    1,
    undefined,
    new Conversation(null),
  );
  const body = confrontation.bodyTile;
  const widthPx = map.structure[0].length * TILE_SIZE;
  const heightPx = map.structure.length * TILE_SIZE;
  const canvas = createCanvas(widthPx, heightPx);
  const bodyCtx = canvas.getContext('2d');
  drawHawkfolkCorpse(asGameContext(bodyCtx), body.x * TILE_SIZE, body.y * TILE_SIZE, TILE_SIZE);
  const pixels = bodyCtx.getImageData(0, 0, widthPx, heightPx).data;
  let inkLeft = widthPx;
  let inkRight = 0;
  let inkTop = heightPx;
  let inkBottom = 0;
  for (let y = 0; y < heightPx; y++) {
    for (let x = 0; x < widthPx; x++) {
      if (pixels[(y * widthPx + x) * RGBA_STRIDE + ALPHA_OFFSET] < BODY_INK_ALPHA_MIN) continue;
      inkLeft = Math.min(inkLeft, x);
      inkRight = Math.max(inkRight, x + 1);
      inkTop = Math.min(inkTop, y);
      inkBottom = Math.max(inkBottom, y + 1);
    }
  }
  check(inkRight > inkLeft, "the magistrate's body paints something to measure");
  const bodyBox = {
    left: inkLeft / TILE_SIZE - BODY_CLEARANCE_TILES,
    right: inkRight / TILE_SIZE + BODY_CLEARANCE_TILES,
    top: inkTop / TILE_SIZE - BODY_CLEARANCE_TILES,
    bottom: inkBottom / TILE_SIZE + BODY_CLEARANCE_TILES,
  };
  const overBody: string[] = [];
  for (const placed of map.placedInteriorProps) {
    const propDef = TOWN_INTERIOR_PROPS[placed.propId];
    // A rug or a floor stain is ground: it is drawn under the body, never over it.
    if (propDef.walkable) continue;
    const propBox = {
      left: placed.tile.x,
      right: placed.tile.x + propDef.footprint.w,
      top: placed.tile.y - townInteriorPropArtRiseTiles(placed.propId, placed.variant),
      bottom: placed.tile.y + propDef.footprint.h,
    };
    const overlaps =
      propBox.left < bodyBox.right &&
      propBox.right > bodyBox.left &&
      propBox.top < bodyBox.bottom &&
      propBox.bottom > bodyBox.top;
    if (overlaps) overBody.push(`${placed.propId}@${placed.tile.x},${placed.tile.y}`);
  }
  check(
    overBody.length === 0,
    `no prop's footprint or art comes within ${BODY_CLEARANCE_TILES} tiles of the body at ${body.x},${body.y} — ${overBody.join(' ')}`,
  );
}

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED.\n`);
  process.exit(1);
}
console.log('\nAll interior checks passed.\n');
