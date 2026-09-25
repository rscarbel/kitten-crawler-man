/**
 * The walled town is a save point, and "inside the wall" is decided by
 * `GameMap.isInsideTownWall`. Builds the overworld from several seeds and checks
 * that test against the plan's own wall ring: every interior tile is in, every
 * stone of the ring is out, and the tile just outside each gate is out while the
 * tile just inside it is in.
 *
 * It also checks the tiles a town save leans on: the level's start tile and the
 * town square centre — where a floor-3 arrival and a blocked-tile fallback put
 * the party — must be inside the wall with room to move, or the arrival would
 * never save and a respawn could land in a pocket. Every building's exit tile
 * must be inside the wall except the Big Top's, out on the circus grounds. A
 * dungeon floor, which has no town, must answer false everywhere.
 *
 * Then the rule that a death always lands on the last save: the respawn route
 * for each shape of save record, and the scene a save rebuilds when its
 * checkpoint could not cross a scene rebuild — a building exit outside the
 * wall — which must stand the saved party on the saved tile, leave both the
 * save and the caller's options untouched, and carry the save on so a second
 * death comes back to it too. A tutorial save, which cannot be resumed where
 * it was taken, must route a death to the floor restart. A dungeon's start tile, where a floor-arrival
 * save stands the party, must have room to move.
 *
 *   npx tsx scripts/verify-town-save.ts
 */

import { TILE_SIZE } from '../src/core/constants.js';
import { GameMap } from '../src/map/GameMap.js';
import { hasRoomToMove } from '../src/map/findWalkableTile.js';
import { dungeonOptionsForLevel } from '../src/levels/dungeonOptions.js';
import { level1 } from '../src/levels/level1.js';
import { level3 } from '../src/levels/level3.js';
import type { LevelDef } from '../src/levels/types.js';
import { BIG_TOP_ENTRY_NAME } from '../src/map/OverworldGenerator.js';
import type { TileRect } from '../src/map/town/townPlan.js';
import type { GameProgressInput } from '../src/auth/AuthClient.js';
import { HumanPlayer } from '../src/creatures/HumanPlayer.js';
import { CatPlayer } from '../src/creatures/CatPlayer.js';
import { snapPlayer } from '../src/core/PlayerSnapshot.js';
import {
  carriedSaveRegeneratesFloor,
  owesArrivalSave,
  respawnModeFor,
  respawnRouteFor,
  savePointAfterWrite,
  type SavePoint,
} from '../src/core/SavePoint.js';
import { WORLD_GENERATOR_VERSION } from '../src/core/SavedWorld.js';
import { sceneSetupFromSave } from '../src/scenes/resumeFromSave.js';
import type { DungeonSceneOptions } from '../src/scenes/DungeonScene.js';

const SEEDS: ReadonlyArray<number> = [1, 123456789, 987654321, 424242, 7];

/** Any seed: the respawn checks read the save, not the map it describes. */
const RESPAWN_CHECK_SEED = 424242;
/** An art seed distinct from the world seed, so a swapped pair would show. */
const RESPAWN_CHECK_ART_SEED = 99;
/** A saved party worth telling apart from a fresh one. */
const SAVED_PARTY_LEVEL = 7;
const SAVED_PARTY_COINS = 321;
/** Frames left on the saved floor clock. */
const SAVED_LEVEL_TIMER_FRAMES = 5000;

/** Offset from a tile's origin to its centre, as a fraction of a tile. */
const TILE_CENTRE_FRACTION = 0.5;
/** One pixel: the smallest step that crosses a tile edge in world space. */
const ONE_PIXEL = 1;
/**
 * Rows south of a door that a building exit sets the party down on — the
 * `returnTile` the scene's building callback builds from `doorTile`.
 */
const RETURN_TILE_ROWS_SOUTH_OF_DOOR = 1;

let failures = 0;
let checks = 0;

function check(condition: boolean, message: string): void {
  checks++;
  if (condition) return;
  failures++;
  console.error(`FAIL ${message}`);
}

function buildMap(levelDef: LevelDef, worldSeed: number): GameMap {
  return new GameMap({
    mapSize: levelDef.mapSize,
    tileHeight: TILE_SIZE,
    mapType: levelDef.isOverworld ? 'overworld' : 'dungeon',
    dungeon: dungeonOptionsForLevel(levelDef),
    worldSeed,
  });
}

function tileCentrePx(tile: number): number {
  return (tile + TILE_CENTRE_FRACTION) * TILE_SIZE;
}

function isInsideAtTileCentre(map: GameMap, x: number, y: number): boolean {
  return map.isInsideTownWall(tileCentrePx(x), tileCentrePx(y));
}

function ringTiles(wall: TileRect): Array<{ x: number; y: number }> {
  const tiles: Array<{ x: number; y: number }> = [];
  const right = wall.x + wall.w - 1;
  const bottom = wall.y + wall.h - 1;
  for (let x = wall.x; x <= right; x++) {
    tiles.push({ x, y: wall.y }, { x, y: bottom });
  }
  for (let y = wall.y + 1; y < bottom; y++) {
    tiles.push({ x: wall.x, y }, { x: right, y });
  }
  return tiles;
}

function checkOverworld(worldSeed: number): void {
  const map = buildMap(level3, worldSeed);
  const plan = map.townPlan;
  const label = `seed ${worldSeed}`;
  if (plan === undefined) {
    check(false, `${label}: overworld has no town plan`);
    return;
  }
  const { interior, wall } = plan;

  let interiorMisses = 0;
  for (let y = interior.y; y < interior.y + interior.h; y++) {
    for (let x = interior.x; x < interior.x + interior.w; x++) {
      if (!isInsideAtTileCentre(map, x, y)) interiorMisses++;
    }
  }
  check(interiorMisses === 0, `${label}: ${interiorMisses} interior tiles read as outside`);

  let ringHits = 0;
  for (const tile of ringTiles(wall)) {
    if (isInsideAtTileCentre(map, tile.x, tile.y)) ringHits++;
  }
  check(ringHits === 0, `${label}: ${ringHits} wall-ring tiles read as inside`);

  // Pixel edges: the first pixel of the interior is in, the last pixel of the
  // wall stone before it is out.
  const innerEdgeX = interior.x * TILE_SIZE;
  const innerEdgeY = interior.y * TILE_SIZE;
  check(map.isInsideTownWall(innerEdgeX, innerEdgeY), `${label}: interior's first pixel is out`);
  check(
    !map.isInsideTownWall(innerEdgeX - ONE_PIXEL, innerEdgeY),
    `${label}: wall's last pixel west of the interior is in`,
  );
  check(
    !map.isInsideTownWall(innerEdgeX, innerEdgeY - ONE_PIXEL),
    `${label}: wall's last pixel north of the interior is in`,
  );

  check(plan.gates.length > 0, `${label}: no gates to check`);
  for (const gate of plan.gates) {
    const outside = gate.exit;
    const gateTile = { x: outside.x - gate.outward.dx, y: outside.y - gate.outward.dy };
    const inside = { x: gateTile.x - gate.outward.dx, y: gateTile.y - gate.outward.dy };
    check(
      !isInsideAtTileCentre(map, outside.x, outside.y),
      `${label}: tile outside the ${gate.name} reads as inside`,
    );
    check(
      !isInsideAtTileCentre(map, gateTile.x, gateTile.y),
      `${label}: the ${gate.name}'s own opening reads as inside`,
    );
    check(
      isInsideAtTileCentre(map, inside.x, inside.y),
      `${label}: tile just inside the ${gate.name} reads as outside`,
    );
  }

  // A building exit rebuilds the scene on its return tile, and that first frame
  // is what saves; the Big Top stands out on the circus grounds and must not.
  for (const entry of map.buildingEntries) {
    const returnTile = {
      x: entry.doorTile.x,
      y: entry.doorTile.y + RETURN_TILE_ROWS_SOUTH_OF_DOOR,
    };
    const returnsInsideWall = isInsideAtTileCentre(map, returnTile.x, returnTile.y);
    const expectInside = entry.name !== BIG_TOP_ENTRY_NAME;
    check(
      returnsInsideWall === expectInside,
      `${label}: ${entry.name} return tile inside the wall is ${returnsInsideWall}, expected ${expectInside}`,
    );
  }
  check(
    map.buildingEntries.some((entry) => entry.name === BIG_TOP_ENTRY_NAME),
    `${label}: no Big Top entry to check`,
  );

  const start = map.startTile;
  check(isInsideAtTileCentre(map, start.x, start.y), `${label}: start tile is outside the wall`);
  const square = map.townSquareCentre;
  if (square === undefined) {
    check(false, `${label}: no town square centre`);
  } else {
    check(
      isInsideAtTileCentre(map, square.x, square.y),
      `${label}: town square centre is outside the wall`,
    );
    check(
      hasRoomToMove(map, square.x, square.y),
      `${label}: town square centre has no room to move`,
    );
  }
}

function checkDungeon(worldSeed: number): void {
  const map = buildMap(level1, worldSeed);
  const label = `level1 seed ${worldSeed}`;
  check(map.townPlan === undefined, `${label}: dungeon has a town plan`);
  const size = map.structure.length;
  let hits = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (isInsideAtTileCentre(map, x, y)) hits++;
    }
  }
  check(hits === 0, `${label}: ${hits} tiles read as inside a town wall`);
  check(
    hasRoomToMove(map, map.startTile.x, map.startTile.y),
    `${label}: start tile, where the arrival save stands the party, has no room to move`,
  );
}

/** The save a town entry writes, with a party that differs from a fresh one. */
function townSave(tile: { x: number; y: number }): GameProgressInput {
  const human = new HumanPlayer(tile.x, tile.y, TILE_SIZE);
  const cat = new CatPlayer(tile.x, tile.y, TILE_SIZE);
  human.level = SAVED_PARTY_LEVEL;
  human.coins = SAVED_PARTY_COINS;
  const humanSnap = snapPlayer(human);
  // A crawler saved while downed must still resume on its feet.
  humanSnap.isKnockedOut = true;
  return {
    levelId: level3.id,
    humanSnap,
    catSnap: snapPlayer(cat),
    world: {
      generatorVersion: WORLD_GENERATOR_VERSION,
      worldSeed: RESPAWN_CHECK_SEED,
      artSeed: RESPAWN_CHECK_ART_SEED,
      safeRoomTile: { ...tile },
      levelTimerFrames: SAVED_LEVEL_TIMER_FRAMES,
    },
  };
}

function checkRespawnRoutes(): void {
  const map = buildMap(level3, RESPAWN_CHECK_SEED);
  const saveTile = map.townSquareCentre ?? map.startTile;
  const save = townSave(saveTile);
  const savedJson = JSON.stringify(save);

  check(
    respawnRouteFor(null).kind === 'floorRestart',
    'a run with no save does not fall back to the floor restart',
  );
  check(
    respawnModeFor(respawnRouteFor(null)) === 'floorRestart',
    'a run with no save does not promise a floor restart',
  );

  // The route never looks inside a checkpoint, so a marker stands in for one.
  const checkpointMarker = { capturedWith: 'this save' };
  const pairedRoute = respawnRouteFor({ progress: save, checkpoint: checkpointMarker });
  check(
    pairedRoute.kind === 'checkpoint' && pairedRoute.checkpoint === checkpointMarker,
    'a save with its checkpoint does not rewind in place to that checkpoint',
  );

  // A tutorial save resumes at the start of a restarted script, so a death
  // there must take, and promise, the floor restart instead.
  const tutorialRoute = respawnRouteFor(savePointAfterWrite(save, checkpointMarker, true));
  check(
    tutorialRoute.kind === 'floorRestart' && respawnModeFor(tutorialRoute) === 'floorRestart',
    `a tutorial death routes to ${tutorialRoute.kind} rather than the floor restart`,
  );
  const floorRoute = respawnRouteFor(savePointAfterWrite(save, checkpointMarker, false));
  check(
    floorRoute.kind === 'checkpoint' && floorRoute.checkpoint === checkpointMarker,
    'a save written outside the tutorial does not keep its checkpoint',
  );

  // What a building exit carries across: the save, never its checkpoint.
  const carried: SavePoint<typeof checkpointMarker> = { progress: save, checkpoint: null };
  const carriedRoute = respawnRouteFor(carried);
  check(
    carriedRoute.kind === 'resumeSave' && carriedRoute.progress === save,
    `a carried save routes a death to ${carriedRoute.kind}, not back to that save`,
  );
  check(
    respawnModeFor(carriedRoute) === 'checkpoint',
    'a carried save promises a floor restart on the death screen',
  );

  const baseOptions: DungeonSceneOptions = { skipIntro: true };
  const { levelDef, options } = sceneSetupFromSave(baseOptions, save);
  check(levelDef.id === level3.id, `the save rebuilds ${levelDef.id}, not ${level3.id}`);
  check(
    options.spawnAt?.x === saveTile.x && options.spawnAt.y === saveTile.y,
    'the rebuilt scene does not stand the party on the saved tile',
  );
  check(
    isInsideAtTileCentre(map, saveTile.x, saveTile.y),
    'the town save tile is outside the wall',
  );
  check(
    options.worldSeed === RESPAWN_CHECK_SEED && options.artSeed === RESPAWN_CHECK_ART_SEED,
    'the rebuilt scene does not regenerate the saved floor',
  );
  check(
    options.levelTimerFrames === SAVED_LEVEL_TIMER_FRAMES,
    'the rebuilt scene does not restore the saved floor clock',
  );
  check(
    options.humanSnap?.level === SAVED_PARTY_LEVEL && options.humanSnap.coins === SAVED_PARTY_COINS,
    'the rebuilt scene does not carry the saved party',
  );
  check(options.humanSnap?.isKnockedOut === false, 'the rebuilt scene resumes a downed crawler');
  check(options.lastSave === save, 'the rebuilt scene does not carry the save for a second death');
  check(
    baseOptions.humanSnap === undefined && baseOptions.lastSave === undefined,
    "rebuilding from a save wrote into the caller's options",
  );

  options.humanSnap?.inventorySlots.push(null);
  if (options.humanSnap !== undefined) options.humanSnap.coins = 0;
  check(
    JSON.stringify(save) === savedJson,
    'the rebuilt scene shares state with the save a later death respawns from',
  );
}

/**
 * A carried save the floor cannot be rebuilt from — no world at all (the
 * level-complete save, or one from before saves carried one) or a world from an
 * older generator — regenerates the floor from a fresh seed, so the first frame
 * owes an arrival save; without one a death resumes the same save and draws
 * another floor. A save that does rebuild its floor owes none.
 */
function checkArrivalSaves(): void {
  const withWorld = townSave({ x: 0, y: 0 });
  const { world: _dropped, ...withoutWorld } = withWorld;
  const olderGenerator: GameProgressInput = {
    ...withWorld,
    world: {
      generatorVersion: WORLD_GENERATOR_VERSION - 1,
      worldSeed: RESPAWN_CHECK_SEED,
      artSeed: RESPAWN_CHECK_ART_SEED,
      safeRoomTile: null,
      levelTimerFrames: null,
    },
  };

  check(!carriedSaveRegeneratesFloor(undefined), 'no carried save reads as a regenerated floor');
  check(
    !carriedSaveRegeneratesFloor(withWorld),
    'a save with a current world reads as a regenerated floor',
  );
  check(
    carriedSaveRegeneratesFloor(withoutWorld),
    'a save with no world does not read as a regenerated floor',
  );
  check(
    carriedSaveRegeneratesFloor(olderGenerator),
    'a save from an older generator does not read as a regenerated floor',
  );

  check(
    owesArrivalSave(withoutWorld, false, false),
    'a resume from a save with no world owes no arrival save',
  );
  check(
    owesArrivalSave(withoutWorld, true, false),
    'a death restart from a save with no world owes no arrival save',
  );
  check(
    owesArrivalSave(olderGenerator, false, false),
    'a resume from an older-generator save owes no arrival save',
  );
  check(
    !owesArrivalSave(withWorld, false, false),
    'a resume that rebuilds its saved floor still owes an arrival save',
  );
  check(owesArrivalSave(undefined, false, false), 'a fresh floor owes no arrival save');
  check(
    !owesArrivalSave(undefined, true, false),
    'a fresh floor that opted out still owes an arrival save',
  );
  check(!owesArrivalSave(withoutWorld, false, true), 'the tutorial owes an arrival save');

  const { options } = sceneSetupFromSave({ skipIntro: true }, withoutWorld);
  check(
    options.worldSeed === undefined && options.spawnAt === undefined,
    'a save with no world pins a seed or a spawn tile',
  );
}

for (const seed of SEEDS) {
  checkOverworld(seed);
  checkDungeon(seed);
}
checkRespawnRoutes();
checkArrivalSaves();

console.log(`${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
