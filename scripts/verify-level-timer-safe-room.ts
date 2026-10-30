#!/usr/bin/env tsx
/**
 * The floor clock — the time on the floor that Nightmare's time limit is
 * measured against — holds while the controlled crawler stands in a safe
 * room, and runs everywhere else. It is counted on every difficulty, so this
 * runs on whichever one is set.
 *
 * Drives the real `DungeonScene` headless on every floor with a Nightmare time
 * limit, placing the party by hand and ticking `update()`:
 *
 *  - the active crawler outside every safe room: the clock runs;
 *  - the active crawler inside one: the clock does not move;
 *  - the active crawler outside while the other is parked inside: it runs,
 *    because only the character being played counts;
 *  - the active crawler inside while the other is outside: it holds.
 *
 * Run: npm run verify:level-timer-safe-room
 */

import { installBrowserShim, ShimEvent } from './browserShim.js';
import { settleArrival } from './settleArrival.js';

const VIEWPORT = { width: 1280, height: 720, devicePixelRatio: 1 } as const;
const shim = installBrowserShim(VIEWPORT);

const WORLD_SEED = 7;
const { mulberry32 } = await import('../src/sprites/person/rng.js');
Math.random = mulberry32(WORLD_SEED);

const { TILE_SIZE } = await import('../src/core/constants.js');
const { loadSprites } = await import('../src/core/spriteAssets/SpriteLoader.js');
const { SceneManager } = await import('../src/core/Scene.js');
const { InputManager } = await import('../src/core/input/InputManager.js');
const { DungeonScene } = await import('../src/scenes/DungeonScene.js');
const { GameMap } = await import('../src/map/GameMap.js');
const { dungeonOptionsForLevel } = await import('../src/levels/dungeonOptions.js');
const { level1 } = await import('../src/levels/level1.js');
const { level2 } = await import('../src/levels/level2.js');
const { CutsceneKit } = await import('../src/systems/kits/CutsceneKit.js');
const { useDevPlayerIdentity } = await import('../src/dev/devPlayerIdentity.js');
useDevPlayerIdentity();

type LevelDef = typeof level1;
type Scene = InstanceType<typeof DungeonScene>;
type Tile = { readonly x: number; readonly y: number };

/** Frames ticked per case: long enough that a running clock cannot hide in rounding. */
const FRAMES_PER_CASE = 120;
/**
 * The least a running clock may count over a case. Below one frame per update
 * rather than exactly one, so a frame some other rule halts the world on does
 * not read as a paused clock.
 */
const MIN_RUNNING_COUNT = FRAMES_PER_CASE / 2;
/** More presses than any story talk has pages, reveals included. */
const MAX_READ_PRESSES = 40;
/** World ticks run after each press, enough for a walk-up to reach its speaker. */
const TICKS_PER_PRESS = 30;
/** How far from every safe room the "outside" tile must be, in tiles. */
const OUTSIDE_MARGIN_TILES = 6;

let failures = 0;
function check(ok: boolean, message: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${message}`);
  if (!ok) failures++;
}

await loadSprites('src/images/');

/**
 * One manager for both floors, as the page has one: a manager per floor would
 * keep its window listeners and its exited scene, whose open box would go on
 * swallowing the next floor's presses.
 */
const sceneManager = new SceneManager();

let clockMs = 0;
function pressSpace(): void {
  clockMs += 1;
  shim.window.dispatch(new ShimEvent('keydown', ' ', clockMs));
  clockMs += 1;
  shim.window.dispatch(new ShimEvent('keyup', ' ', clockMs));
}

/**
 * Reads whatever story cutscene the last case set off to its end: walking
 * into the safe room is Dave's arrival, and his talk halts the world until it
 * is read, as it does for a player. A case measured under it would read the
 * talk's halt as the clock's own.
 */
function readOutCutscenes(scene: Scene): boolean {
  const cutscenes: unknown = Reflect.get(scene, 'cutscenes');
  if (!(cutscenes instanceof CutsceneKit))
    throw new Error("the scene's cutscenes is not a CutsceneKit");
  for (let press = 0; press < MAX_READ_PRESSES && cutscenes.isActive; press++) {
    for (let tick = 0; tick < TICKS_PER_PRESS; tick++) scene.update();
    pressSpace();
  }
  return !cutscenes.isActive;
}

function placeAt(entity: { x: number; y: number }, tile: Tile): void {
  entity.x = tile.x * TILE_SIZE;
  entity.y = tile.y * TILE_SIZE;
}

function isNearAnySafeRoom(map: InstanceType<typeof GameMap>, x: number, y: number): boolean {
  return map.safeRooms.some(
    (room) =>
      x >= room.bounds.x - OUTSIDE_MARGIN_TILES &&
      x < room.bounds.x + room.bounds.w + OUTSIDE_MARGIN_TILES &&
      y >= room.bounds.y - OUTSIDE_MARGIN_TILES &&
      y < room.bounds.y + room.bounds.h + OUTSIDE_MARGIN_TILES,
  );
}

function findOutsideTile(map: InstanceType<typeof GameMap>): Tile | null {
  for (let y = 0; y < map.structure.length; y++) {
    for (let x = 0; x < map.structure.length; x++) {
      if (map.isWalkable(x, y, 'walker') && !isNearAnySafeRoom(map, x, y)) return { x, y };
    }
  }
  return null;
}

/**
 * Ticks the scene with the active crawler pinned to `activeTile` and the other
 * to `inactiveTile`, and returns how many frames the clock counted. Re-pinned
 * every frame so neither walking AI nor a shove moves anyone across a wall,
 * and topped up every frame so a mob wandering over cannot end the run: a
 * dead party stops the clock too, which would pass a "holds" case vacuously.
 */
function framesCounted(scene: Scene, activeTile: Tile, inactiveTile: Tile): number {
  if (!readOutCutscenes(scene)) throw new Error('a story cutscene never finished');
  const before = scene.floorClockElapsedFrames;
  const startingHp = scene.pm.wholeParty().map((player) => player.hp);
  for (let frame = 0; frame < FRAMES_PER_CASE; frame++) {
    scene.pm.wholeParty().forEach((player, index) => {
      player.hp = startingHp[index] ?? player.hp;
    });
    placeAt(scene.pm.active(), activeTile);
    placeAt(scene.pm.partnerAnywhere(), inactiveTile);
    scene.update();
  }
  return scene.floorClockElapsedFrames - before;
}

async function checkFloor(name: string, levelDef: LevelDef): Promise<void> {
  const map = new GameMap({
    mapSize: levelDef.mapSize,
    tileHeight: TILE_SIZE,
    mapType: 'dungeon',
    dungeon: dungeonOptionsForLevel(levelDef),
    worldSeed: WORLD_SEED,
  });
  const safeRoom = map.safeRooms[0];
  const outside = findOutsideTile(map);
  check(safeRoom !== undefined, `${name}: the floor has a safe room`);
  check(outside !== null, `${name}: the floor has a walkable tile away from every safe room`);
  if (safeRoom === undefined || outside === null) return;
  const inside = safeRoom.centre;

  const scene = new DungeonScene(levelDef, new InputManager(), sceneManager, {
    existingMap: map,
    worldSeed: WORLD_SEED,
    skipIntro: true,
  });
  sceneManager.replace(scene);
  const ctx = sceneManager.canvas.getContext('2d');
  if (ctx === null) throw new Error('the shim canvas has no 2d context');
  check(await settleArrival(scene, ctx), `${name}: the arrival screen finishes`);
  check(
    scene.floorClockElapsedFrames === 0,
    `${name}: a fresh floor starts its clock at zero (${scene.floorClockElapsedFrames})`,
  );

  const countedOutside = framesCounted(scene, outside, outside);
  check(
    countedOutside >= MIN_RUNNING_COUNT,
    `${name}: the clock runs with the party outside (counted ${countedOutside}/${FRAMES_PER_CASE})`,
  );

  const countedInside = framesCounted(scene, inside, inside);
  check(
    countedInside === 0,
    `${name}: the clock holds with the party in the safe room (counted ${countedInside})`,
  );

  const countedActiveOutside = framesCounted(scene, outside, inside);
  check(
    countedActiveOutside >= MIN_RUNNING_COUNT,
    `${name}: the clock runs when only the inactive crawler is inside (counted ${countedActiveOutside})`,
  );

  const countedActiveInside = framesCounted(scene, inside, outside);
  check(
    countedActiveInside === 0,
    `${name}: the clock holds when the active crawler is inside alone (counted ${countedActiveInside})`,
  );

  // A world that stopped for any other reason would also read as "held".
  const countedAfterLeaving = framesCounted(scene, outside, outside);
  check(
    countedAfterLeaving >= MIN_RUNNING_COUNT,
    `${name}: the clock runs again once the party leaves (counted ${countedAfterLeaving})`,
  );

  scene.onExit();
}

const TIMED_FLOORS: ReadonlyArray<readonly [string, LevelDef]> = [
  ['floor 1', level1],
  ['floor 2', level2],
];
for (const [name, levelDef] of TIMED_FLOORS) {
  check(levelDef.nightmareTimeLimitFrames !== undefined, `${name}: has a Nightmare time limit`);
  await checkFloor(name, levelDef);
}

console.log(failures === 0 ? '\nAll floor-clock checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
