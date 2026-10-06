#!/usr/bin/env tsx
/**
 * The floor's collapse timer holds while the controlled crawler stands in a
 * safe room, and runs everywhere else.
 *
 * Drives the real `DungeonScene` headless on every floor that has a collapse
 * timer, placing the party by hand and ticking `update()`:
 *
 *  - the active crawler outside every safe room: the timer counts down;
 *  - the active crawler inside one: the timer does not move;
 *  - the active crawler outside while the other is parked inside: it runs,
 *    because only the character being played counts;
 *  - the active crawler inside while the other is outside: it holds.
 *
 * Run: npm run verify:level-timer-safe-room
 */

import { installBrowserShim } from './browserShim.js';
import { settleArrival } from './settleArrival.js';

const VIEWPORT = { width: 1280, height: 720, devicePixelRatio: 1 } as const;
installBrowserShim(VIEWPORT);

const WORLD_SEED = 7;
const { mulberry32 } = await import('../src/sprites/person/rng.js');
Math.random = mulberry32(WORLD_SEED);

const { TILE_SIZE } = await import('../src/core/constants.js');
const { loadSprites } = await import('../src/core/SpriteLoader.js');
const { SceneManager } = await import('../src/core/Scene.js');
const { InputManager } = await import('../src/core/InputManager.js');
const { DungeonScene } = await import('../src/scenes/DungeonScene.js');
const { GameMap } = await import('../src/map/GameMap.js');
const { dungeonOptionsForLevel } = await import('../src/levels/dungeonOptions.js');
const { level1 } = await import('../src/levels/level1.js');
const { level2 } = await import('../src/levels/level2.js');

type LevelDef = typeof level1;
type Scene = InstanceType<typeof DungeonScene>;
type Tile = { readonly x: number; readonly y: number };

/** Frames ticked per case: long enough that a running clock cannot hide in rounding. */
const FRAMES_PER_CASE = 120;
/**
 * The least a running clock may lose over a case. Below one frame per update
 * rather than exactly one, so a frame some other rule halts the world on does
 * not read as a paused clock.
 */
const MIN_RUNNING_LOSS = FRAMES_PER_CASE / 2;
/** How far from every safe room the "outside" tile must be, in tiles. */
const OUTSIDE_MARGIN_TILES = 6;

let failures = 0;
function check(ok: boolean, message: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${message}`);
  if (!ok) failures++;
}

await loadSprites('src/images/');

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
      if (map.isWalkable(x, y) && !isNearAnySafeRoom(map, x, y)) return { x, y };
    }
  }
  return null;
}

/**
 * Ticks the scene with the active crawler pinned to `activeTile` and the other
 * to `inactiveTile`, and returns how many frames the timer lost. Re-pinned
 * every frame so neither walking AI nor a shove moves anyone across a wall,
 * and topped up every frame so a mob wandering over cannot end the run: a
 * dead party stops the clock too, which would pass a "holds" case vacuously.
 */
function framesLost(scene: Scene, activeTile: Tile, inactiveTile: Tile): number {
  const before = scene.levelTimerRemainingFrames;
  const startingHp = scene.pm.players().map((player) => player.hp);
  for (let frame = 0; frame < FRAMES_PER_CASE; frame++) {
    scene.pm.players().forEach((player, index) => {
      player.hp = startingHp[index] ?? player.hp;
    });
    placeAt(scene.pm.active(), activeTile);
    placeAt(scene.pm.inactive(), inactiveTile);
    scene.update();
  }
  return before - scene.levelTimerRemainingFrames;
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

  const sceneManager = new SceneManager();
  const scene = new DungeonScene(levelDef, new InputManager(), sceneManager, {
    existingMap: map,
    worldSeed: WORLD_SEED,
    skipIntro: true,
  });
  sceneManager.replace(scene);
  const ctx = sceneManager.canvas.getContext('2d');
  if (ctx === null) throw new Error('the shim canvas has no 2d context');
  check(await settleArrival(scene, ctx), `${name}: the arrival screen finishes`);
  check(scene.levelTimerRemainingFrames > 0, `${name}: the collapse timer starts with time on it`);

  const lostOutside = framesLost(scene, outside, outside);
  check(
    lostOutside >= MIN_RUNNING_LOSS,
    `${name}: the timer runs with the party outside (lost ${lostOutside}/${FRAMES_PER_CASE})`,
  );

  const lostInside = framesLost(scene, inside, inside);
  check(
    lostInside === 0,
    `${name}: the timer holds with the party in the safe room (lost ${lostInside})`,
  );

  const lostActiveOutside = framesLost(scene, outside, inside);
  check(
    lostActiveOutside >= MIN_RUNNING_LOSS,
    `${name}: the timer runs when only the inactive crawler is inside (lost ${lostActiveOutside})`,
  );

  const lostActiveInside = framesLost(scene, inside, outside);
  check(
    lostActiveInside === 0,
    `${name}: the timer holds when the active crawler is inside alone (lost ${lostActiveInside})`,
  );

  // A world that stopped for any other reason would also read as "held".
  const lostAfterLeaving = framesLost(scene, outside, outside);
  check(
    lostAfterLeaving >= MIN_RUNNING_LOSS,
    `${name}: the timer runs again once the party leaves (lost ${lostAfterLeaving})`,
  );

  scene.onExit();
}

const TIMED_FLOORS: ReadonlyArray<readonly [string, LevelDef]> = [
  ['floor 1', level1],
  ['floor 2', level2],
];
for (const [name, levelDef] of TIMED_FLOORS) {
  check(levelDef.hasCollapseTimer === true, `${name}: has a collapse timer`);
  await checkFloor(name, levelDef);
}

console.log(failures === 0 ? '\nAll level-timer checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
