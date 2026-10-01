/**
 * Behaviour gates for the dungeon's sound cues, ambience and small moving
 * things on floors 1 and 2.
 *
 *   npx tsx scripts/verify-dungeon-life.ts
 *
 * - Every `DUNGEON_CUES` entry is a registered sound id or an explicit
 *   silence, and every id it names can actually play where the cue does: a
 *   one-shot's id is preloaded on both floors, a loop's is preloaded or
 *   streamed. Every table that maps something to a cue maps it to a real one,
 *   and every cue a play site names in source exists.
 * - The destruction kit raises cues, never raw ids.
 * - Every breakable prop kind and every wall fixture break resolves to a cue.
 * - A light's emitter is gone from the plan as soon as the light is broken,
 *   on the same frame: a smashed torch or brazier, a broken sconce, a blown
 *   fuse box's tubes.
 * - Critters sit only on walkable tiles, stay on them while they run, and
 *   keep to their per-room cap; every effect list keeps to its cap.
 * - At the performance render preset only drips and splashes draw.
 *
 * The broken-light, critter-ground and preset checks each run against a
 * broken twin they must catch, so a check that can no longer fail turns the
 * gate red.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createCanvas } from 'canvas';

import { loadGameSpritesInNode } from './nodeCanvasGlobals.js';
import { asGameContext } from './nodeGameContext.js';
import { TILE_SIZE } from '../src/core/constants.js';
import { GameMap } from '../src/map/GameMap.js';
import { getLevelDef } from '../src/levels/index.js';
import { dungeonOptionsForLevel } from '../src/levels/dungeonOptions.js';
import { setDungeonFloorTheme, type DungeonFloorThemeId } from '../src/map/dungeon/floorTheme.js';
import { floorSurfaceOf } from '../src/map/dungeon/floorSurface.js';
import { BONE_PILE, FloorTypeValue, PAPER_DRIFT, SLUMPED_SKELETON } from '../src/map/tileTypes.js';
import { ALL_SOUND_IDS, STREAMING_SOUND_IDS, type SoundId } from '../src/audio/sounds.js';
import { SFX_GROUPS } from '../src/audio/sfxGroups.js';
import {
  DungeonLightingSystem,
  STATIC_LIGHT_FIXTURES,
} from '../src/systems/DungeonLightingSystem.js';
import {
  ALL_BREAKABLE_PROPS,
  DestructiblePropSystem,
} from '../src/systems/DestructiblePropSystem.js';
import { LootSystem } from '../src/systems/LootSystem.js';
import { HumanPlayer } from '../src/creatures/HumanPlayer.js';
import {
  MAX_CRITTERS,
  RUN_LIFE_FRAMES,
  type WorldPoint,
} from '../src/systems/critters/ScatterSwarm.js';
import type { Rect } from '../src/map/roomDoorways.js';
import { WALL_FIXTURE_SPECS, type WallFixtureKind } from '../src/map/dungeon/wallFixtures.js';
import type { WallFixtureEventName } from '../src/systems/wallFixtureDamage.js';
import {
  AMBIENCE_BED_CUES,
  AMBIENT_ONE_SHOT_CUES,
  DUNGEON_CUES,
  DUNGEON_LOOP_CUES,
  MATERIAL_BREAK_CUES,
  PROP_BREAK_CUES,
  PROP_STRUCK_CUES,
  WALL_FIXTURE_EVENT_CUES,
  propBreakCues,
  wallFixtureEventCues,
  type DungeonCue,
} from '../src/systems/dungeon/dungeonSoundCues.js';
import {
  FLY_SITE_TILE_TYPES,
  planDungeonEmitters,
  type PlannedEmitter,
  type TilePoint,
} from '../src/systems/dungeon/dungeonEmitters.js';
import {
  DROP_FALL_FRAMES,
  DUNGEON_LIFE_CAPS,
  DungeonLifeSystem,
  type Walker,
} from '../src/systems/dungeon/DungeonLifeSystem.js';

/** Generated floors checked per level, from fixed seeds so a failure replays. */
const SEED_COUNT = 3;
const FIRST_SEED = 3;
const SEED_STRIDE = 4;
const SEEDS = Array.from({ length: SEED_COUNT }, (_, index) => FIRST_SEED + index * SEED_STRIDE);
const HALF = 0.5;
const NEIGHBOURS = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
] as const;
/** A blow from the next tile reaching just past the struck tile's centre, in tiles. */
const SMASH_REACH_TILES = 1.1;
/** Critter rooms the camera visits, spread evenly through the floor's list. */
const COVERAGE_SAMPLES = 20;
/** Share of visited critter rooms that must have critters when the camera arrives. */
const COVERAGE_MIN_SHARE = 0.9;
/** A crawler standing on a group scares everything this close: the swarm's reach. */
const SCARE_RADIUS_TILES = 3;
const SCARE_RADIUS_PX = TILE_SIZE * SCARE_RADIUS_TILES;
/** Fly-site and critter-room views the preset check looks at. */
const PRESET_TARGETS = 4;
/** Tiles a wader walks before and after a puddle tile. */
const WADE_RUN_TILES = 2;
/** A crawler's walking pace, in pixels a frame. */
const WADE_SPEED_PX = 2;
/** Feet sit this far below a walker's centre, as the splash test reads them. */
const FEET_BELOW_CENTRE_PX = 12;
const DRIP_TEST_VOLUME = 0.3;
const FLOORS = [1, 2] as const;
const VIEW_W = 960;
const VIEW_H = 540;
/** Steps through water and paper, far more than any cap allows to live at once. */
const STRESS_STEPS = 400;
/** The crowd sways a whole tile, from one puddle tile to the next. */
const STRESS_STEP_PX = TILE_SIZE;
/** Feet this far into the dry tile below a puddle leave the body over the water. */
const SHORE_FEET_INSET_PX = 4;
/** The paper shuffler steps back and forth inside one drift tile. */
const PAPER_SHUFFLE_PX = 12;
/** How far past the view's edge a room lies as the camera walks toward it, in tiles. */
const APPROACH_GAP_TILES = 2;
const RGBA = 4;
const ALPHA_CHANNEL = 3;

const failures: string[] = [];
const notes: string[] = [];

/** A list's first entry, or undefined for an empty one. */
function firstOf<T>(list: ReadonlyArray<T>): T | undefined {
  return list.length > 0 ? list[0] : undefined;
}

function check(ok: boolean, message: string): void {
  if (!ok) failures.push(message);
}

function buildFloor(level: number, seed: number): GameMap {
  const levelDef = getLevelDef(`level${level}`);
  setDungeonFloorTheme(levelDef.groundTheme ?? 'cellars');
  return new GameMap({
    mapSize: levelDef.mapSize,
    tileHeight: TILE_SIZE,
    mapType: 'dungeon',
    dungeon: dungeonOptionsForLevel(levelDef),
    worldSeed: seed,
  });
}

function floorTheme(level: number): DungeonFloorThemeId {
  return level === 1 ? 'cellars' : 'service_level';
}

// ── Cues ────────────────────────────────────────────────────────────────────

function isCue(name: string): name is DungeonCue {
  return name in DUNGEON_CUES;
}

function checkCueTable(): void {
  const registered = new Set<SoundId>(ALL_SOUND_IDS);
  const level1 = new Set<SoundId>(SFX_GROUPS.level1);
  const level2 = new Set<SoundId>(SFX_GROUPS.level2);
  const universal = new Set<SoundId>(SFX_GROUPS.universal);
  const onBothFloors = (id: SoundId): boolean =>
    universal.has(id) || (level1.has(id) && level2.has(id));
  const silent: string[] = [];
  for (const [cue, takes] of Object.entries(DUNGEON_CUES)) {
    const ids: readonly SoundId[] = takes;
    if (ids.length === 0) {
      silent.push(cue);
      continue;
    }
    const loops = isCue(cue) && DUNGEON_LOOP_CUES.has(cue);
    for (const id of ids) {
      check(registered.has(id), `cue ${cue}: ${id} is not a registered sound id`);
      if (loops) {
        check(
          STREAMING_SOUND_IDS.has(id) || onBothFloors(id),
          `loop cue ${cue}: ${id} is neither streamed nor preloaded on both floors`,
        );
      } else {
        check(
          !STREAMING_SOUND_IDS.has(id),
          `one-shot cue ${cue}: ${id} is streamed, so play() is silent`,
        );
        check(onBothFloors(id), `one-shot cue ${cue}: ${id} is not preloaded on both floors`);
      }
    }
  }
  notes.push(`silent cues (no stand-in, waiting on a file): ${silent.join(', ')}`);

  const mapped: Array<[string, string]> = [
    ...Object.entries(AMBIENCE_BED_CUES),
    ...Object.entries(AMBIENT_ONE_SHOT_CUES),
    ...Object.entries(MATERIAL_BREAK_CUES),
  ];
  for (const kind of ALL_BREAKABLE_PROPS) {
    const struck = PROP_STRUCK_CUES[kind];
    if (struck !== undefined) mapped.push([kind, struck]);
    for (const cue of PROP_BREAK_CUES[kind] ?? []) mapped.push([kind, cue]);
  }
  const eventNames: WallFixtureEventName[] = [
    'struck',
    'broken',
    'swung',
    'torn',
    'hissed',
    'power_down',
  ];
  for (const kind of FIXTURE_KINDS) {
    const table: Readonly<Partial<Record<WallFixtureEventName, readonly DungeonCue[]>>> =
      WALL_FIXTURE_EVENT_CUES[kind];
    for (const name of eventNames) for (const cue of table[name] ?? []) mapped.push([kind, cue]);
  }
  for (const loop of DUNGEON_LOOP_CUES) mapped.push(['loop set', loop]);
  for (const [key, cue] of mapped) check(isCue(cue), `${key} maps to unknown cue "${cue}"`);
}

/** Every `.ts` file under a directory. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (path.endsWith('.ts')) out.push(path);
  }
  return out;
}

const CUE_CALL = /\b(?:raiseCue|playAt|playDungeonCue)\(\s*[^,()]*?,?\s*'([A-Za-z]+)'/g;

function checkPlaySites(): void {
  let calls = 0;
  for (const file of sourceFiles('src')) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(CUE_CALL)) {
      calls++;
      check(isCue(match[1]), `${file}: plays unknown cue "${match[1]}"`);
    }
  }
  check(calls > 0, 'the play-site scan found no cue calls at all, so it scans nothing');
  const kit = readFileSync('src/systems/kits/DestructionKit.ts', 'utf8');
  for (const raw of ['wood_smashing', 'garbage_bag_burst', 'hammer_strike', 'miasma_hiss']) {
    check(!kit.includes(`'${raw}`), `DestructionKit plays the raw id ${raw} instead of a cue`);
  }
}

function checkPropAndFixtureCues(): void {
  for (const floor of ['cellars', 'service_level'] as const) {
    setDungeonFloorTheme(floor);
    for (const kind of ALL_BREAKABLE_PROPS) {
      for (const smash of ['wood', 'iron', 'trash'] as const) {
        const cues = propBreakCues(kind, smash, floor === 'service_level');
        check(cues.length > 0, `${floor} ${kind} breaks with no cue`);
      }
    }
  }
  const names: WallFixtureEventName[] = [
    'struck',
    'broken',
    'swung',
    'torn',
    'hissed',
    'power_down',
  ];
  for (const kind of FIXTURE_KINDS) {
    if (WALL_FIXTURE_SPECS[kind].onHit === 'break') {
      const cues = wallFixtureEventCues({ name: 'broken', kind, x: 0, y: 0 });
      check(cues.length > 0, `a broken ${kind} has no cue`);
    }
    for (const name of names) {
      for (const cue of wallFixtureEventCues({ name, kind, x: 0, y: 0 })) {
        check(isCue(cue), `${kind} ${name} raises unknown cue ${cue}`);
      }
    }
  }
}

const FIXTURE_KINDS: readonly WallFixtureKind[] = [
  'sconce',
  'fluorescent_tube',
  'sodium_lamp',
  'emergency_light',
  'fuse_box',
  'steam_valve',
  'camera_dome',
  'hanging_chains',
  'torn_banner',
  'monitor_bank',
];

// ── Emitters ────────────────────────────────────────────────────────────────

function lightEmittersAt(planned: ReadonlyArray<PlannedEmitter>, x: number, y: number): number {
  return planned.filter((e) => e.source === 'light' && e.tileX === x && e.tileY === y).length;
}

/** Each light's sub-check: whether its emitter was gone, or null when the floor had none to try. */
interface LightChecks {
  readonly prop: boolean | null;
  readonly fixture: boolean | null;
  readonly fuse: boolean | null;
}

/**
 * Puts out one prop light, one wall-fixture light and one fuse box — or, with
 * `breakIt` false, leaves each standing — and reports for each whether its
 * emitter is gone from a plan made on the same frame, before the lighting
 * pass has updated. The map is put back as it was after each sub-check.
 */
function brokenLightChecks(gameMap: GameMap, level: number, breakIt: boolean): LightChecks {
  const lighting = new DungeonLightingSystem({ gameMap, now: () => 0, additiveGlows: () => false });
  lighting.update();
  const lights = lighting.staticLightTiles();
  const plan = (): PlannedEmitter[] =>
    planDungeonEmitters({ gameMap, floor: floorTheme(level), lights });
  const before = plan();

  let prop: boolean | null = null;
  const propLight = lights.find((light) => {
    const type = gameMap.structure[light.y][light.x].type;
    return (
      light.on && STATIC_LIGHT_FIXTURES.has(type) && lightEmittersAt(before, light.x, light.y) > 0
    );
  });
  if (propLight !== undefined) {
    const tile = gameMap.structure[propLight.y][propLight.x];
    const saved = tile.type;
    if (breakIt) tile.type = FloorTypeValue.concrete;
    prop = lightEmittersAt(plan(), propLight.x, propLight.y) === 0;
    tile.type = saved;
  }

  let fixture: boolean | null = null;
  const fixtureLight = gameMap.wallFixtures.find(
    (candidate) =>
      WALL_FIXTURE_SPECS[candidate.kind].light !== null &&
      !candidate.state.broken &&
      lightEmittersAt(before, candidate.tileX, candidate.tileY) > 0,
  );
  if (fixtureLight !== undefined) {
    if (breakIt) fixtureLight.state.broken = true;
    fixture = lightEmittersAt(plan(), fixtureLight.tileX, fixtureLight.tileY) === 0;
    fixtureLight.state.broken = false;
  }

  let fuse: boolean | null = null;
  const fuseBox = gameMap.wallFixtures.find(
    (candidate) =>
      candidate.kind === 'fuse_box' &&
      gameMap.wallFixtures.some(
        (tube) =>
          tube.circuit === candidate.id && lightEmittersAt(before, tube.tileX, tube.tileY) > 0,
      ),
  );
  if (fuseBox !== undefined) {
    if (breakIt) fuseBox.state.broken = true;
    const after = plan();
    const stillHumming = gameMap.wallFixtures.some(
      (tube) => tube.circuit === fuseBox.id && lightEmittersAt(after, tube.tileX, tube.tileY) > 0,
    );
    const boxStillBuzzes = after.some(
      (e) => e.source === 'fixture' && e.tileX === fuseBox.tileX && e.tileY === fuseBox.tileY,
    );
    fuse = !stillHumming && !boxStillBuzzes;
    fuseBox.state.broken = false;
  }
  lighting.dispose();
  return { prop, fixture, fuse };
}

function checkBrokenLights(gameMap: GameMap, level: number, label: string): void {
  const broken = brokenLightChecks(gameMap, level, true);
  const standing = brokenLightChecks(gameMap, level, false);
  const subChecks = ['prop', 'fixture', 'fuse'] as const;
  for (const name of subChecks) {
    const gone = broken[name];
    if (gone === null) {
      notes.push(`${label}: no ${name} light to break`);
      continue;
    }
    check(gone, `${label}: a broken ${name} light still sounds`);
    check(
      standing[name] === false,
      `${label}: the ${name} check passes with nothing broken, so it cannot fail`,
    );
  }
}

// ── Critters ────────────────────────────────────────────────────────────────

function lifeFor(
  gameMap: GameMap,
  level: number,
  fullDetail: boolean,
  raiseCue: (cue: DungeonCue) => void = () => undefined,
): DungeonLifeSystem {
  return new DungeonLifeSystem({
    gameMap,
    floor: floorTheme(level),
    puddles: floorSurfaceOf(gameMap.structure) ?? null,
    lights: null,
    fullDetail: () => fullDetail,
    raiseCue,
  });
}

/** One frame of life with the camera at (`camX`, `camY`) and `party` walking. */
function tick(
  life: DungeonLifeSystem,
  camX: number,
  camY: number,
  party: ReadonlyArray<Walker> = [],
  others: ReadonlyArray<Walker> = [],
): void {
  life.update({ party, others, camX, camY, viewW: VIEW_W, viewH: VIEW_H });
}

function offFloor(gameMap: GameMap, positions: ReadonlyArray<WorldPoint>): number {
  return positions.filter(
    (p) => !gameMap.isWalkable(Math.floor(p.x / TILE_SIZE), Math.floor(p.y / TILE_SIZE)),
  ).length;
}

function inBounds(p: WorldPoint, bounds: Rect): boolean {
  const tx = Math.floor(p.x / TILE_SIZE);
  const ty = Math.floor(p.y / TILE_SIZE);
  return tx >= bounds.x && tx < bounds.x + bounds.w && ty >= bounds.y && ty < bounds.y + bounds.h;
}

function roomCentre(bounds: Rect): WorldPoint {
  return { x: (bounds.x + bounds.w / 2) * TILE_SIZE, y: (bounds.y + bounds.h / 2) * TILE_SIZE };
}

/**
 * The off-floor test itself must be able to fail: a point on a wall tile
 * counts as off the floor. The broken twin of every critter-ground check.
 */
function checkOffFloorCanFail(gameMap: GameMap, label: string): void {
  for (let y = 0; y < gameMap.structure.length; y++) {
    const x = gameMap.structure[y].findIndex((tile) => tile.type === FloorTypeValue.wall);
    if (x < 0) continue;
    const wall = { x: (x + HALF) * TILE_SIZE, y: (y + HALF) * TILE_SIZE };
    check(offFloor(gameMap, [wall]) === 1, `${label}: the off-floor test passes a wall tile`);
    return;
  }
}

/**
 * Walks the camera through critter rooms spread across the whole floor: each
 * must have its critters by the time the camera has been there a seating
 * check, on floor, within the room's cap, with no more rooms seated at once
 * than the cap allows.
 */
function checkCritterCoverage(gameMap: GameMap, level: number, label: string): void {
  const life = lifeFor(gameMap, level, true);
  const rooms = [...life.critterRoomBounds()].sort(
    (a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x,
  );
  check(rooms.length > 0, `${label}: no room keeps critters`);
  const stride = Math.max(1, Math.floor(rooms.length / COVERAGE_SAMPLES));
  const perRoomCap = DUNGEON_LIFE_CAPS.critterGroupsPerRoom * DUNGEON_LIFE_CAPS.critterGroupSize;
  let visited = 0;
  let populated = 0;
  let worstOffFloor = 0;
  let worstSeated = 0;
  let worstInRoom = 0;
  for (let index = 0; index < rooms.length; index += stride) {
    const room = rooms[index];
    const centre = roomCentre(room.bounds);
    const camX = centre.x - VIEW_W / 2;
    const camY = centre.y - VIEW_H / 2;
    // Walk in as a player would: the room first lies just past the view's
    // right edge, then the camera arrives on it.
    const approachX = room.bounds.x * TILE_SIZE - VIEW_W - APPROACH_GAP_TILES * TILE_SIZE;
    for (let frame = 0; frame <= DUNGEON_LIFE_CAPS.seatCheckFrames * 2; frame++) {
      const atX = frame <= DUNGEON_LIFE_CAPS.seatCheckFrames ? approachX : camX;
      tick(life, atX, camY);
      const positions = life.critterPositions();
      worstOffFloor = Math.max(worstOffFloor, offFloor(gameMap, positions));
      worstSeated = Math.max(worstSeated, life.counts.seatedRooms);
    }
    visited++;
    const inRoom = life.critterPositions().filter((p) => inBounds(p, room.bounds)).length;
    worstInRoom = Math.max(worstInRoom, inRoom);
    if (inRoom > 0) populated++;
  }
  const share = populated / Math.max(1, visited);
  check(
    share >= COVERAGE_MIN_SHARE,
    `${label}: only ${populated} of ${visited} critter rooms across the floor had critters as the camera reached them`,
  );
  check(worstOffFloor === 0, `${label}: ${worstOffFloor} critters seated off the floor`);
  check(
    worstInRoom <= perRoomCap,
    `${label}: a room held ${worstInRoom} critters, cap ${perRoomCap}`,
  );
  check(
    worstSeated <= DUNGEON_LIFE_CAPS.seatedRooms,
    `${label}: ${worstSeated} rooms seated at once, cap ${DUNGEON_LIFE_CAPS.seatedRooms}`,
  );
  notes.push(
    `${label}: ${rooms.length} critter rooms; ${populated}/${visited} sampled across the floor had critters; at most ${worstSeated} seated at once`,
  );
}

/**
 * A crawler walks up to a seated group and stands there: every critter near
 * it must run and be gone, never leaving the floor on the way, and the room
 * must not fill again while the camera is on it.
 */
function checkCrittersFlee(gameMap: GameMap, level: number, label: string): void {
  const life = lifeFor(gameMap, level, true);
  const room = firstOf(life.critterRoomBounds());
  if (room === undefined) return;
  const centre = roomCentre(room.bounds);
  const camX = centre.x - VIEW_W / 2;
  const camY = centre.y - VIEW_H / 2;
  for (let frame = 0; frame <= DUNGEON_LIFE_CAPS.seatCheckFrames; frame++) tick(life, camX, camY);
  const seated = life.critterPositions().filter((p) => inBounds(p, room.bounds));
  check(seated.length > 0, `${label}: the camera's own room seated no critters to scare`);
  const target = firstOf(seated);
  if (target === undefined) return;
  const walker = { x: target.x - TILE_SIZE / 2, y: target.y - TILE_SIZE / 2 };
  let worstOffFloor = 0;
  for (let frame = 0; frame < RUN_LIFE_FRAMES + DUNGEON_LIFE_CAPS.seatCheckFrames * 2; frame++) {
    tick(life, camX, camY, [walker]);
    worstOffFloor = Math.max(worstOffFloor, offFloor(gameMap, life.critterPositions()));
  }
  const stillNear = life
    .critterPositions()
    .filter((p) => Math.hypot(p.x - target.x, p.y - target.y) < SCARE_RADIUS_PX).length;
  check(
    stillNear === 0,
    `${label}: ${stillNear} critters still sit beside a crawler standing on them`,
  );
  check(worstOffFloor === 0, `${label}: ${worstOffFloor} fleeing critters ran off the floor`);
}

/** Surprise bursts land on floor, stay on it as they run, keep to the budget and are gone in time. */
function checkSurpriseBursts(gameMap: GameMap, level: number, label: string): void {
  const life = lifeFor(gameMap, level, true);
  const room = firstOf(life.critterRoomBounds());
  if (room === undefined) return;
  const at = roomCentre(room.bounds);
  const camX = at.x - VIEW_W / 2;
  const camY = at.y - VIEW_H / 2;
  let anyBurst = false;
  for (let i = 0; i < STRESS_STEPS; i++) anyBurst = life.scatterSurprise(at.x, at.y) || anyBurst;
  const centreIsFloor = gameMap.isWalkable(
    Math.floor(at.x / TILE_SIZE),
    Math.floor(at.y / TILE_SIZE),
  );
  check(!centreIsFloor || anyBurst, `${label}: no surprise burst came out onto open floor`);
  let worstOffFloor = offFloor(gameMap, life.burstPositions());
  const peak = life.burstPositions().length;
  for (let frame = 0; frame <= RUN_LIFE_FRAMES; frame++) {
    tick(life, camX, camY);
    worstOffFloor = Math.max(worstOffFloor, offFloor(gameMap, life.burstPositions()));
  }
  check(worstOffFloor === 0, `${label}: ${worstOffFloor} burst critters off the floor`);
  check(peak <= MAX_CRITTERS, `${label}: ${peak} burst critters alive, budget ${MAX_CRITTERS}`);
  check(
    life.burstPositions().length === 0,
    `${label}: burst critters still running after their run`,
  );

  const quiet = lifeFor(gameMap, level, false);
  check(
    !quiet.scatterSurprise(at.x, at.y),
    `${label}: a surprise burst came out at the performance preset`,
  );

  const sites = life.flySitePositions();
  const perRegion = new Map<number, number>();
  for (const site of sites) {
    const region = gameMap.regionAt(Math.floor(site.x / TILE_SIZE), Math.floor(site.y / TILE_SIZE));
    perRegion.set(region, (perRegion.get(region) ?? 0) + 1);
  }
  for (const [region, count] of perRegion) {
    check(
      count <= DUNGEON_LIFE_CAPS.flySitesPerRegion,
      `${label}: region ${region} has ${count} fly sites`,
    );
  }
}

// ── Water, paper and caps ───────────────────────────────────────────────────

function firstPaperTile(gameMap: GameMap): TilePoint | null {
  for (let y = 0; y < gameMap.structure.length; y++) {
    const x = gameMap.structure[y].findIndex((tile) => tile.type === PAPER_DRIFT);
    if (x >= 0) return { x, y };
  }
  return null;
}

/** Places a walker so its feet, as the splash test reads them, stand at a world point. */
function placeFeet(walker: { x: number; y: number }, feetX: number, feetY: number): void {
  walker.x = feetX - TILE_SIZE / 2;
  walker.y = feetY - FEET_BELOW_CENTRE_PX - TILE_SIZE / 2;
}

/** Walks a crowd back and forth over a puddle and a paper drift, far past every cap. */
function checkEffectCaps(gameMap: GameMap, level: number, label: string): void {
  const life = lifeFor(gameMap, level, true);
  const puddle = puddleWithEastNeighbour(gameMap, life);
  const paper = firstPaperTile(gameMap);
  const crowd: Array<{ x: number; y: number }> = [];
  const crowdSize = puddle === undefined ? 0 : DUNGEON_LIFE_CAPS.rings * 2;
  for (let i = 0; i < crowdSize; i++) crowd.push({ x: 0, y: 0 });
  const shuffler = { x: 0, y: 0 };
  let worst = { drips: 0, rings: 0, paper: 0, dripsRegion: 0, ringsRegion: 0, paperRegion: 0 };
  let ringsOnDryFloor = 0;
  const surface = floorSurfaceOf(gameMap.structure);
  for (let step = 0; step < STRESS_STEPS; step++) {
    const sway = (step % 2) * STRESS_STEP_PX;
    const party: Walker[] = [];
    if (puddle !== undefined) {
      for (const walker of crowd) {
        placeFeet(walker, puddle.x * TILE_SIZE + sway, (puddle.y + HALF) * TILE_SIZE);
        party.push(walker);
      }
      life.spawnDrip(puddle.x, puddle.y);
    }
    if (paper !== null) {
      const shuffle = (step % 2) * PAPER_SHUFFLE_PX;
      placeFeet(shuffler, paper.x * TILE_SIZE + shuffle, (paper.y + HALF) * TILE_SIZE);
      party.push(shuffler);
    }
    tick(life, 0, 0, party, party);
    const counts = life.counts;
    worst = {
      drips: Math.max(worst.drips, counts.drips),
      rings: Math.max(worst.rings, counts.rings),
      paper: Math.max(worst.paper, counts.paper),
      dripsRegion: Math.max(worst.dripsRegion, life.peakPerRegion('drips')),
      ringsRegion: Math.max(worst.ringsRegion, life.peakPerRegion('rings')),
      paperRegion: Math.max(worst.paperRegion, life.peakPerRegion('paper')),
    };
    for (const ring of life.ringPositions()) {
      const tx = Math.floor(ring.x / TILE_SIZE);
      const ty = Math.floor(ring.y / TILE_SIZE);
      if (surface?.isPuddleAt(tx, ty) !== true) ringsOnDryFloor++;
    }
  }
  const caps = DUNGEON_LIFE_CAPS;
  check(worst.drips <= caps.drips, `${label}: ${worst.drips} drips alive, cap ${caps.drips}`);
  check(worst.rings <= caps.rings, `${label}: ${worst.rings} rings alive, cap ${caps.rings}`);
  check(
    worst.paper <= caps.paper,
    `${label}: ${worst.paper} paper scraps alive, cap ${caps.paper}`,
  );
  check(
    worst.dripsRegion <= caps.dripsPerRegion,
    `${label}: ${worst.dripsRegion} drips in one region`,
  );
  check(
    worst.ringsRegion <= caps.ringsPerRegion,
    `${label}: ${worst.ringsRegion} rings in one region`,
  );
  check(
    worst.paperRegion <= caps.paperPerRegion,
    `${label}: ${worst.paperRegion} scraps in one region`,
  );
  check(
    puddle === undefined || worst.rings > 0,
    `${label}: a crowd through a puddle made no rings`,
  );
  check(
    paper === null || worst.paper > 0,
    `${label}: walking through a paper drift lifted no paper`,
  );
  check(ringsOnDryFloor === 0, `${label}: ${ringsOnDryFloor} splash rings drawn on dry floor`);
  notes.push(
    `${label}: puddle tiles ${life.puddles.length}, paper drift ${paper === null ? 'none' : 'yes'}; peak drips ${worst.drips}, rings ${worst.rings} (${worst.ringsRegion} in one region), paper ${worst.paper}`,
  );
}

/** Walks one walker west to east across a puddle at walking pace; returns the rings it left. */
function wadeAcross(
  life: DungeonLifeSystem,
  puddle: TilePoint,
  walker: Walker & { x: number; y: number },
): number {
  let rings = 0;
  const feetY = (puddle.y + HALF) * TILE_SIZE;
  const startX = (puddle.x - WADE_RUN_TILES) * TILE_SIZE;
  const endX = (puddle.x + 1 + WADE_RUN_TILES) * TILE_SIZE;
  for (let feetX = startX; feetX <= endX; feetX += WADE_SPEED_PX) {
    placeFeet(walker, feetX, feetY);
    tick(life, 0, 0, [walker]);
    rings = Math.max(rings, life.counts.rings);
  }
  return rings;
}

/** A puddle tile with another to its east, so a walker can stride from one to the next. */
function puddleWithEastNeighbour(gameMap: GameMap, life: DungeonLifeSystem): TilePoint | undefined {
  const surface = floorSurfaceOf(gameMap.structure);
  return life.puddles.find((tile) => surface?.isPuddleAt(tile.x + 1, tile.y) === true);
}

/** A flying walker never splashes; a walking one does. */
function checkFlyersDoNotSplash(gameMap: GameMap, level: number, label: string): void {
  const puddle = puddleWithEastNeighbour(gameMap, lifeFor(gameMap, level, true));
  if (puddle === undefined) return;
  const flyer = { x: 0, y: 0, isFlying: true };
  const walkerRings = wadeAcross(lifeFor(gameMap, level, true), puddle, { x: 0, y: 0 });
  const flyerRings = wadeAcross(lifeFor(gameMap, level, true), puddle, flyer);
  check(walkerRings > 0, `${label}: a walker wading a puddle made no ring`);
  check(flyerRings === 0, `${label}: a flying walker splashed ${flyerRings} rings`);
}

/**
 * A walker whose body is over a puddle but whose feet are on the dry tile
 * below it leaves no ring: a ring is drawn at the feet, so the feet decide.
 */
function checkRingsStayOnWater(gameMap: GameMap, level: number, label: string): void {
  const surface = floorSurfaceOf(gameMap.structure);
  if (surface === undefined) return;
  const life = lifeFor(gameMap, level, true);
  const shore = life.puddles.find(
    (tile) =>
      surface.isPuddleAt(tile.x + 1, tile.y) &&
      !surface.isPuddleAt(tile.x, tile.y + 1) &&
      !surface.isPuddleAt(tile.x + 1, tile.y + 1),
  );
  if (shore === undefined) {
    notes.push(`${label}: no puddle edge to walk along`);
    return;
  }
  const walker = { x: 0, y: 0 };
  const feetY = (shore.y + 1) * TILE_SIZE + SHORE_FEET_INSET_PX;
  let dryRings = 0;
  for (let feetX = shore.x * TILE_SIZE; feetX < (shore.x + 2) * TILE_SIZE; feetX += WADE_SPEED_PX) {
    placeFeet(walker, feetX, feetY);
    tick(life, 0, 0, [walker]);
    for (const ring of life.ringPositions()) {
      if (!surface.isPuddleAt(Math.floor(ring.x / TILE_SIZE), Math.floor(ring.y / TILE_SIZE))) {
        dryRings++;
      }
    }
  }
  check(
    dryRings === 0,
    `${label}: walking the dry edge below a puddle drew ${dryRings} rings on dry floor`,
  );
}

/**
 * Smashes a bone pile or skeleton that is the only bone site in its region
 * and checks flies still gather over what it left. The twin — the same life
 * told nothing about the wreckage — must lose them, so the check can fail.
 */
function checkFliesOverRemains(gameMap: GameMap, level: number, label: string): void {
  const bones: TilePoint[] = [];
  for (let y = 0; y < gameMap.structure.length; y++) {
    for (let x = 0; x < gameMap.structure[y].length; x++) {
      const type = gameMap.structure[y][x].type;
      if (type === BONE_PILE || type === SLUMPED_SKELETON) bones.push({ x, y });
    }
  }
  const sitesIn = (region: number): number =>
    lifeFor(gameMap, level, true)
      .flySitePositions()
      .filter(
        (p) =>
          gameMap.regionAt(Math.floor(p.x / TILE_SIZE), Math.floor(p.y / TILE_SIZE)) === region,
      ).length;
  const lone = bones.find((tile) => sitesIn(gameMap.regionAt(tile.x, tile.y)) === 1);
  if (lone === undefined) {
    notes.push(`${label}: no lone bone pile to smash`);
    return;
  }
  const props = new DestructiblePropSystem(gameMap, new LootSystem(gameMap), level);
  const crawler = new HumanPlayer(lone.x, lone.y + 1, TILE_SIZE);
  // Struck from a floor tile beside it, as a crawler would, reaching just
  // past the pile's centre.
  for (const [dx, dy] of NEIGHBOURS) {
    if (!gameMap.isWalkable(lone.x + dx, lone.y + dy)) continue;
    const fromX = (lone.x + dx + HALF) * TILE_SIZE;
    const fromY = (lone.y + dy + HALF) * TILE_SIZE;
    props.destroyInRadius(fromX, fromY, TILE_SIZE * SMASH_REACH_TILES, crawler);
    break;
  }
  check(
    !FLY_SITE_TILE_TYPES.has(gameMap.structure[lone.y][lone.x].type),
    `${label}: the bone pile at ${lone.x},${lone.y} did not break`,
  );
  const hasFliesAt = (life: DungeonLifeSystem): boolean =>
    life
      .flySitePositions()
      .some(
        (p) => Math.floor(p.x / TILE_SIZE) === lone.x && Math.floor(p.y / TILE_SIZE) === lone.y,
      );
  const told = new DungeonLifeSystem({
    gameMap,
    floor: floorTheme(level),
    puddles: null,
    lights: null,
    fullDetail: () => true,
    raiseCue: () => undefined,
    wreckage: () => props.wreckage,
  });
  check(hasFliesAt(told), `${label}: a smashed bone pile lost its flies`);
  check(
    !hasFliesAt(lifeFor(gameMap, level, true)),
    `${label}: flies stay over a smashed pile even unseen wreckage, so the check cannot fail`,
  );
}

/** The drip's one-shot is raised on the frame its drop lands, not when it starts to fall. */
function checkDripSoundsOnLanding(gameMap: GameMap, level: number, label: string): void {
  const heardOnFrames: number[] = [];
  let frame = 0;
  const life = lifeFor(gameMap, level, true, (cue) => {
    if (cue === 'waterDrip') heardOnFrames.push(frame);
  });
  const puddle = firstOf(life.puddles);
  if (puddle === undefined) return;
  check(
    life.spawnDrip(puddle.x, puddle.y, DRIP_TEST_VOLUME),
    `${label}: a drip on a puddle was refused`,
  );
  for (frame = 1; frame <= DROP_FALL_FRAMES * 2; frame++) tick(life, 0, 0);
  const heardOn = firstOf(heardOnFrames);
  check(
    heardOnFrames.length === 1 && heardOn === DROP_FALL_FRAMES,
    `${label}: the drip sounded on frames [${heardOnFrames.join(', ')}], the drop lands on ${DROP_FALL_FRAMES}`,
  );
  check(!life.spawnDrip(puddle.x - WADE_RUN_TILES * 2, -1), `${label}: a drip fell off the map`);
}

// ── Render preset ───────────────────────────────────────────────────────────

/** Whether anything at all was drawn onto a fresh canvas. */
function drewAnything(paint: (ctx: CanvasRenderingContext2D) => void): boolean {
  const canvas = createCanvas(VIEW_W, VIEW_H);
  const ctx = canvas.getContext('2d');
  paint(asGameContext(ctx));
  const data = ctx.getImageData(0, 0, VIEW_W, VIEW_H).data;
  for (let i = ALPHA_CHANNEL; i < data.length; i += RGBA) if (data[i] !== 0) return true;
  return false;
}

/**
 * Puts the camera on critter rooms and fly sites and asks whether anything
 * draws. At the performance preset nothing may (no water is walked and no
 * drip has fallen); at full detail something must, the twin that keeps the
 * check honest.
 */
function presetDraws(gameMap: GameMap, level: number, fullDetail: boolean): boolean {
  const life = lifeFor(gameMap, level, fullDetail);
  const targets = [
    ...life.critterRoomBounds().map((room) => roomCentre(room.bounds)),
    ...life.flySitePositions(),
  ];
  let drew = false;
  for (const target of targets.slice(0, PRESET_TARGETS)) {
    const camX = target.x - VIEW_W / 2;
    const camY = target.y - VIEW_H / 2;
    for (let frame = 0; frame <= DUNGEON_LIFE_CAPS.seatCheckFrames; frame++) tick(life, camX, camY);
    drew =
      drew ||
      drewAnything((ctx) => {
        life.renderGround(ctx, camX, camY, VIEW_W, VIEW_H);
        life.renderAir(ctx, camX, camY, VIEW_W, VIEW_H);
      });
  }
  return drew;
}

/** At the performance preset a drip still falls and a wader still splashes. */
function checkPresetKeepsDripsAndSplashes(gameMap: GameMap, level: number, label: string): void {
  const life = lifeFor(gameMap, level, false);
  const puddle = firstOf(life.puddles);
  if (puddle === undefined) {
    notes.push(`${label}: no puddle to drip on`);
    return;
  }
  const rings = wadeAcross(life, puddle, { x: 0, y: 0 });
  check(rings > 0, `${label}: the performance preset dropped the splashes`);
  life.spawnDrip(puddle.x, puddle.y);
  tick(life, 0, 0);
  const camX = puddle.x * TILE_SIZE - VIEW_W / 2;
  const camY = puddle.y * TILE_SIZE - VIEW_H / 2;
  const drewDrop = drewAnything((ctx) => life.renderAir(ctx, camX, camY, VIEW_W, VIEW_H));
  check(drewDrop, `${label}: the performance preset dropped the drip`);
}

// ── Run ─────────────────────────────────────────────────────────────────────

await loadGameSpritesInNode();
checkCueTable();
checkPlaySites();
checkPropAndFixtureCues();

for (const level of FLOORS) {
  for (const seed of SEEDS) {
    const label = `floor ${level} seed ${seed}`;
    const gameMap = buildFloor(level, seed);
    checkBrokenLights(gameMap, level, label);
    checkOffFloorCanFail(gameMap, label);
    checkCritterCoverage(gameMap, level, label);
    checkCrittersFlee(gameMap, level, label);
    checkSurpriseBursts(gameMap, level, label);
    checkEffectCaps(gameMap, level, label);
    checkFlyersDoNotSplash(gameMap, level, label);
    checkRingsStayOnWater(gameMap, level, label);
    checkFliesOverRemains(gameMap, level, label);
    checkDripSoundsOnLanding(gameMap, level, label);
    const sharp = presetDraws(gameMap, level, true);
    const performance = presetDraws(gameMap, level, false);
    check(!performance, `${label}: critters, flies or motes draw at the performance preset`);
    check(sharp, `${label}: nothing draws at full detail either, so the preset check cannot fail`);
    checkPresetKeepsDripsAndSplashes(gameMap, level, label);
  }
}

for (const note of notes) console.log(`  ${note}`);
if (failures.length > 0) {
  console.error(`\nverify-dungeon-life: ${failures.length} failure(s)`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log('\nverify-dungeon-life: all checks passed');
