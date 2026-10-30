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
 * must be inside the wall except the Starlight Tent's, out on the circus grounds. A
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
 * Last, the real floor-2 scene, headless, takes its stairs: the save the descent
 * writes, read back from the device's storage, must still hold both crawlers'
 * achievements, since closing the tab on the floor-complete screen resumes
 * from exactly that save.
 *
 * And the party's dungeon kill tally, which is saved with the human's
 * achievements: the kill that crosses Something Hatched queues the chest that
 * brings Deinonychus, but he joins only when that chest is opened, once, even after
 * a save and reload; the tally survives a save, and a kill on the overworld
 * never counts.
 *
 *   npx tsx scripts/verify-town-save.ts
 */

import { TILE_SIZE } from '../src/core/constants.js';
import { GameMap } from '../src/map/GameMap.js';
import { hasRoomToMove } from '../src/map/findWalkableTile.js';
import { mapSourceForLevel } from '../src/levels/dungeonOptions.js';
import { level1 } from '../src/levels/level1.js';
import { level3 } from '../src/levels/level3.js';
import type { LevelDef } from '../src/levels/types.js';
import type { TileRect } from '../src/map/town/townPlan.js';
import type { GameProgressInput } from '../src/auth/AuthClient.js';
import { HumanPlayer } from '../src/creatures/HumanPlayer.js';
import { CatPlayer } from '../src/creatures/CatPlayer.js';
import { snapPlayer } from '../src/core/save/PlayerSnapshot.js';
import {
  carriedSaveRegeneratesFloor,
  FLOOR_RESTART_DEATH_CAUSE,
  owesArrivalSave,
  respawnModeFor,
  respawnRouteFor,
  savePointAfterWrite,
  withFloorClockAtStart,
  type SavePoint,
} from '../src/core/save/SavePoint.js';
import { parseSavedWorld, WORLD_GENERATOR_VERSION } from '../src/core/save/SavedWorld.js';
import { sceneSetupFromSave } from '../src/scenes/resumeFromSave.js';
import type { DungeonSceneOptions } from '../src/scenes/DungeonScene.js';
import { parseTownMemoryCheckpoint } from '../src/core/save/PersistedWorldState.js';
import type { VisitedPlaceId } from '../src/core/state/TownMemory.js';
import {
  AchievementManager,
  DUNGEON_KILLS_SOMETHING_HATCHED,
} from '../src/core/progression/AchievementManager.js';
import { type AchievementId } from '../src/core/progression/achievementSave.js';
import { CHEST_SOURCE_TITLES } from '../src/loot/rewardChest.js';
import { installBrowserShim } from './browserShim.js';
import { settleArrival } from './settleArrival.js';
import { useDevPlayerIdentity } from '../src/dev/devPlayerIdentity.js';

useDevPlayerIdentity();

const MINIMAL_SEED = 1;
const ASCENDING_DIGITS_SEED = 123456789;
const DESCENDING_DIGITS_SEED = 987654321;
const REPEATING_DIGITS_SEED = 424242;
/** The world seed the walk-away and inventory scene harnesses play on. */
const HARNESS_WORLD_SEED = 7;
const SEEDS: ReadonlyArray<number> = [
  MINIMAL_SEED,
  ASCENDING_DIGITS_SEED,
  DESCENDING_DIGITS_SEED,
  REPEATING_DIGITS_SEED,
  HARNESS_WORLD_SEED,
];

/** Any seed: the respawn checks read the save, not the map it describes. */
const RESPAWN_CHECK_SEED = 424242;
/** An art seed distinct from the world seed, so a swapped pair would show. */
const RESPAWN_CHECK_ART_SEED = 99;
/** A saved party worth telling apart from a fresh one. */
const SAVED_PARTY_LEVEL = 7;
const SAVED_PARTY_COINS = 321;
/** Frames the saved floor clock had counted. */
const SAVED_FLOOR_ELAPSED_FRAMES = 5000;

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
    ...mapSourceForLevel(levelDef),
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
  // is what saves; the Starlight Tent stands out on the circus grounds and must not.
  for (const entry of map.buildingEntries) {
    const returnTile = {
      x: entry.doorTile.x,
      y: entry.doorTile.y + RETURN_TILE_ROWS_SOUTH_OF_DOOR,
    };
    const returnsInsideWall = isInsideAtTileCentre(map, returnTile.x, returnTile.y);
    const expectInside = entry.id !== 'taloncrest_circus_tent';
    check(
      returnsInsideWall === expectInside,
      `${label}: ${entry.id} return tile inside the wall is ${returnsInsideWall}, expected ${expectInside}`,
    );
  }
  check(
    map.buildingEntries.some((entry) => entry.id === 'taloncrest_circus_tent'),
    `${label}: no Starlight Tent entry to check`,
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

/**
 * A save the real floor-3 scene writes, on the respawn check's seeds, so every
 * field a save must carry is the one the game writes.
 */
async function writtenTownSave(): Promise<GameProgressInput> {
  installBrowserShim(DESCENT_VIEWPORT);
  const { SceneManager } = await import('../src/core/Scene.js');
  const { InputManager } = await import('../src/core/input/InputManager.js');
  const { DungeonScene } = await import('../src/scenes/DungeonScene.js');
  const saves: GameProgressInput[] = [];
  const sceneManager = new SceneManager();
  const scene = new DungeonScene(level3, new InputManager(), sceneManager, {
    worldSeed: RESPAWN_CHECK_SEED,
    artSeed: RESPAWN_CHECK_ART_SEED,
    skipIntro: true,
    saveProgress: (progress) => {
      saves.push(progress);
      return Promise.resolve('saved');
    },
  });
  sceneManager.replace(scene);
  const ctx = sceneManager.canvas.getContext('2d');
  if (ctx === null) throw new Error('the shim canvas has no 2d context');
  check(await settleArrival(scene, ctx), "the town floor's arrival screen finishes");
  scene['captureSavePoint'](scene['gameMap'].startTile);
  const written = saves.length > 0 ? saves[saves.length - 1] : undefined;
  if (written === undefined) throw new Error('the town floor wrote no save');
  scene.onExit();
  return written;
}

/** The save a town entry writes, with a party that differs from a fresh one. */
function townSave(base: GameProgressInput, tile: { x: number; y: number }): GameProgressInput {
  const baseWorld = base.world;
  if (baseWorld === undefined) throw new Error('the town floor wrote a save with no world');
  const human = new HumanPlayer(tile.x, tile.y, TILE_SIZE);
  const cat = new CatPlayer(tile.x, tile.y, TILE_SIZE);
  human.level = SAVED_PARTY_LEVEL;
  human.coins = SAVED_PARTY_COINS;
  const humanSnap = snapPlayer(human);
  // A crawler saved while downed must still resume on its feet.
  humanSnap.isKnockedOut = true;
  return {
    ...structuredClone(base),
    levelId: level3.id,
    humanSnap,
    catSnap: snapPlayer(cat),
    world: {
      ...structuredClone(baseWorld),
      resumeTile: { ...tile },
      floorElapsedFrames: SAVED_FLOOR_ELAPSED_FRAMES,
    },
  };
}

function checkRespawnRoutes(base: GameProgressInput): void {
  const map = buildMap(level3, RESPAWN_CHECK_SEED);
  const saveTile = map.townSquareCentre ?? map.startTile;
  const save = townSave(base, saveTile);
  const savedJson = JSON.stringify(save);

  const noSaveRoute = respawnRouteFor(null, null);
  check(
    noSaveRoute.kind === 'floorRestart' && noSaveRoute.reason === 'noSaveToReturnTo',
    'a run with no save does not fall back to the floor restart that writes nothing',
  );
  check(
    respawnModeFor(respawnRouteFor(null, null)) === 'floorRestart',
    'a run with no save does not promise a floor restart',
  );

  // The route never looks inside a checkpoint, so a marker stands in for one.
  const checkpointMarker = { capturedWith: 'this save' };
  const pairedRoute = respawnRouteFor({ progress: save, checkpoint: checkpointMarker }, null);
  check(
    pairedRoute.kind === 'checkpoint' && pairedRoute.checkpoint === checkpointMarker,
    'a save with its checkpoint does not rewind in place to that checkpoint',
  );

  // A tutorial save resumes at the start of a restarted script, so a death
  // there must take, and promise, the floor restart instead.
  const tutorialRoute = respawnRouteFor(savePointAfterWrite(save, checkpointMarker, true), null);
  check(
    tutorialRoute.kind === 'floorRestart' && respawnModeFor(tutorialRoute) === 'floorRestart',
    `a tutorial death routes to ${tutorialRoute.kind} rather than the floor restart`,
  );
  const floorRoute = respawnRouteFor(savePointAfterWrite(save, checkpointMarker, false), null);
  check(
    floorRoute.kind === 'checkpoint' && floorRoute.checkpoint === checkpointMarker,
    'a save written outside the tutorial does not keep its checkpoint',
  );

  // Nightmare's time limit forfeits the floor, whatever save stands behind it.
  const timeLimitRoute = respawnRouteFor(
    { progress: save, checkpoint: checkpointMarker },
    FLOOR_RESTART_DEATH_CAUSE,
  );
  check(
    timeLimitRoute.kind === 'floorRestart' &&
      timeLimitRoute.reason === 'timeLimitForfeit' &&
      respawnModeFor(timeLimitRoute) === 'floorRestart',
    `a time-limit death routes to ${timeLimitRoute.kind} rather than the forfeit restart`,
  );
  // The forfeit rebuilds the floor from its arrival save, which must hand the
  // party the whole limit again.
  const restartedSave = withFloorClockAtStart(save);
  check(
    restartedSave.world?.floorElapsedFrames === 0 &&
      save.world?.floorElapsedFrames === SAVED_FLOOR_ELAPSED_FRAMES,
    'the time-limit restart save keeps time on the clock, or edits the save it was built from',
  );

  // What a building exit carries across: the save, never its checkpoint.
  const carried: SavePoint<typeof checkpointMarker> = { progress: save, checkpoint: null };
  const carriedRoute = respawnRouteFor(carried, null);
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
    options.floorElapsedFrames === SAVED_FLOOR_ELAPSED_FRAMES,
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
 * A carried save the floor cannot be rebuilt from — the level-complete save,
 * which carries no world — regenerates the floor from a fresh seed, so the
 * first frame owes an arrival save; without one a death resumes the same save
 * and draws another floor. A save that does rebuild its floor owes none. A
 * stored world from another generator fails validation outright.
 */
function checkArrivalSaves(base: GameProgressInput): void {
  const withWorld = townSave(base, { x: 0, y: 0 });
  const { world: _dropped, ...withoutWorld } = withWorld;
  const otherGeneratorWorld = {
    ...withWorld.world,
    generatorVersion: WORLD_GENERATOR_VERSION + 1,
  };
  check(
    parseSavedWorld(JSON.parse(JSON.stringify(otherGeneratorWorld))) === undefined,
    'a stored world from another generator passes validation',
  );
  check(
    parseSavedWorld(JSON.parse(JSON.stringify(withWorld.world))) !== undefined,
    'a stored world the game wrote fails validation',
  );

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
    owesArrivalSave(withoutWorld, true, false, false),
    'a resume from a stale save owes no arrival save',
  );
  check(
    owesArrivalSave(withoutWorld, true, true, false),
    'a death restart from a stale save owes no arrival save',
  );
  check(
    !owesArrivalSave(withWorld, false, false, false),
    'a resume that rebuilds its saved floor still owes an arrival save',
  );
  check(
    owesArrivalSave(withWorld, true, false, false),
    'a floor rebuilt from a save it must write over owes no arrival save',
  );
  check(owesArrivalSave(undefined, false, false, false), 'a fresh floor owes no arrival save');
  check(
    !owesArrivalSave(undefined, false, true, false),
    'a fresh floor that opted out still owes an arrival save',
  );
  check(!owesArrivalSave(withoutWorld, true, false, true), 'the tutorial owes an arrival save');

  const { options } = sceneSetupFromSave({ skipIntro: true }, withoutWorld);
  check(
    options.worldSeed === undefined && options.spawnAt === undefined,
    'a save with no world pins a seed or a spawn tile',
  );
}

/** A place id no build tracks. */
const UNKNOWN_VISITED_PLACE = 'retired_place';
const KNOWN_VISITED_PLACE = 'circus_grounds' as const satisfies VisitedPlaceId;

/** A town memory naming an unknown visited place fails validation instead of forgetting it. */
function checkUnknownVisitedPlace(): void {
  const memory = {
    residentTalks: [],
    clearedCamps: [],
    paidOutInteriorProps: [],
    settledSewerWorks: [],
  };
  check(
    parseTownMemoryCheckpoint({ ...memory, visitedPlaces: [KNOWN_VISITED_PLACE] }) !== undefined,
    'a town memory with only known visited places fails validation',
  );
  check(
    parseTownMemoryCheckpoint({
      ...memory,
      visitedPlaces: [KNOWN_VISITED_PLACE, UNKNOWN_VISITED_PLACE],
    }) === undefined,
    'a town memory with an unknown visited place passes validation',
  );
}

const DESCENT_VIEWPORT = { width: 1280, height: 720, devicePixelRatio: 1 } as const;
/** One achievement per crawler, neither of which arriving on a floor unlocks. */
const DESCENT_HUMAN_ACHIEVEMENT = 'boss_slayer' as const satisfies AchievementId;
const DESCENT_CAT_ACHIEVEMENT = 'magic_touch' as const satisfies AchievementId;
/** Kills short of Something Hatched, so the next dungeon kill crosses it. */
const KILLS_BEFORE_DEINONYCHUS = DUNGEON_KILLS_SOMETHING_HATCHED - 1;
/** Dungeon kills landed past the threshold, which must not pay Deinonychus again. */
const KILLS_PAST_DEINONYCHUS = 3;

/**
 * Takes the stairs on a real floor and reloads the save that wrote from the
 * device's storage: both crawlers' achievements must cross the floor change.
 */
async function checkDescentSaveKeepsAchievements(): Promise<void> {
  installBrowserShim(DESCENT_VIEWPORT);
  const { SceneManager } = await import('../src/core/Scene.js');
  const { InputManager } = await import('../src/core/input/InputManager.js');
  const { DungeonScene } = await import('../src/scenes/DungeonScene.js');
  const { level2 } = await import('../src/levels/level2.js');
  const { readLocalProgress, writeLocalProgress } =
    await import('../src/core/save/LocalProgress.js');

  const humanAchievements = new AchievementManager();
  const catAchievements = new AchievementManager();
  humanAchievements.recordUnlock(DESCENT_HUMAN_ACHIEVEMENT);
  catAchievements.recordUnlock(DESCENT_CAT_ACHIEVEMENT);

  const sceneManager = new SceneManager();
  const scene = new DungeonScene(level2, new InputManager(), sceneManager, {
    worldSeed: HARNESS_WORLD_SEED,
    skipIntro: true,
    humanAchievements,
    catAchievements,
    saveProgress: (progress) => {
      writeLocalProgress(progress);
      return Promise.resolve('saved');
    },
  });
  sceneManager.replace(scene);
  const ctx = sceneManager.canvas.getContext('2d');
  if (ctx === null) throw new Error('the shim canvas has no 2d context');
  check(await settleArrival(scene, ctx), "the descent floor's arrival screen finishes");

  scene['stairwell'].descend();
  const reloaded = readLocalProgress();
  if (reloaded === null) {
    check(false, 'the descent wrote no save the device can read back');
    return;
  }
  check(
    reloaded.levelId === level2.nextLevelId,
    `the descent save resumes on ${reloaded.levelId}, not ${String(level2.nextLevelId)}`,
  );
  const reloadedHuman = AchievementManager.fromSerialized(reloaded.humanAchievements);
  const reloadedCat = AchievementManager.fromSerialized(reloaded.catAchievements);
  check(
    reloaded.humanAchievements !== undefined && reloadedHuman.isUnlocked(DESCENT_HUMAN_ACHIEVEMENT),
    "the descent save drops the human's achievements",
  );
  check(
    reloaded.catAchievements !== undefined && reloadedCat.isUnlocked(DESCENT_CAT_ACHIEVEMENT),
    "the descent save drops the cat's achievements",
  );
}

/** How many of a crawler's queued, unopened reward chests bring Deinonychus, read without taking any. */
function deinonychusChestsQueued(manager: AchievementManager): number {
  return manager
    .serialize()
    .presentations.filter((presentation) =>
      presentation.rewards.some((line) => line.kind === 'companion'),
    ).length;
}

/** A save and reload of one crawler's achievements, as the device's storage round-trips them. */
function reloadAchievements(manager: AchievementManager): AchievementManager {
  return AchievementManager.fromSerialized(JSON.parse(JSON.stringify(manager.serialize())));
}

/** Far more unopened chests than a floor pays out, so a cap on the queue would show. */
const LONG_CHEST_BACKLOG = 250;
const BACKLOG_CHEST_COINS = 1;

/** Every unopened chest survives a save and reload, however many are waiting. */
function checkLongChestBacklogRoundTrips(): void {
  const manager = new AchievementManager();
  for (let i = 0; i < LONG_CHEST_BACKLOG; i++) {
    manager.queuePresentation({
      origin: { kind: 'chest', source: 'bossRepeat' },
      title: CHEST_SOURCE_TITLES.bossRepeat,
      subtitle: '',
      crawler: 'human',
      rarity: 'Common',
      rewards: [{ kind: 'coins', amount: BACKLOG_CHEST_COINS }],
    });
  }
  const stored: unknown = JSON.parse(JSON.stringify(manager.serialize()));
  const parsed = AchievementManager.parse(stored);
  check(
    parsed?.presentationCount === LONG_CHEST_BACKLOG,
    `a save with ${LONG_CHEST_BACKLOG} unopened chests reads back with ${String(parsed?.presentationCount)}`,
  );
  check(
    reloadAchievements(manager).presentationCount === LONG_CHEST_BACKLOG,
    'a long chest backlog does not survive the resume path',
  );
}

async function checkDungeonKillLadder(): Promise<void> {
  installBrowserShim(DESCENT_VIEWPORT);
  const { SceneManager } = await import('../src/core/Scene.js');
  const { InputManager } = await import('../src/core/input/InputManager.js');
  const { DungeonScene } = await import('../src/scenes/DungeonScene.js');
  const { level2 } = await import('../src/levels/level2.js');
  const { Rat } = await import('../src/creatures/Rat.js');
  const { DEINONYCHUS_DEF } = await import('../src/abilities/deinonychus.js');
  const { presentsDeinonychus } = await import('../src/systems/deinonychusArrival.js');

  const humanAchievements = new AchievementManager();
  const catAchievements = new AchievementManager();
  for (let kill = 0; kill < KILLS_BEFORE_DEINONYCHUS; kill++) {
    humanAchievements.advanceCounter('dungeonKills');
  }
  const dungeon = new DungeonScene(level2, new InputManager(), new SceneManager(), {
    worldSeed: HARNESS_WORLD_SEED,
    skipIntro: true,
    humanAchievements,
    catAchievements,
  });
  const killRat = (scene: typeof dungeon): void => {
    const killer = scene['human'];
    const rat = new Rat(0, 0, TILE_SIZE);
    scene['bus'].emit('mobKilled', {
      mob: rat,
      killer,
      killType: 'melee',
      topDamageDealer: killer,
    });
  };
  check(
    !dungeon['deinonychusSystem'].unlocked,
    'fixture: Deinonychus is unlocked before the ladder is crossed',
  );
  killRat(dungeon);
  check(
    humanAchievements.counter('dungeonKills') === DUNGEON_KILLS_SOMETHING_HATCHED,
    `a dungeon kill does not advance the party's tally (${humanAchievements.counter('dungeonKills')})`,
  );
  check(
    catAchievements.isUnlocked('dungeon_kills_200'),
    'crossing the threshold does not unlock it for the cat',
  );
  check(
    !dungeon['deinonychusSystem'].unlocked,
    'crossing Something Hatched brings Deinonychus before his chest is opened',
  );
  for (let kill = 0; kill < KILLS_PAST_DEINONYCHUS; kill++) killRat(dungeon);
  check(
    deinonychusChestsQueued(catAchievements) === 1,
    `the cat does not hold exactly one unopened chest bringing Deinonychus (${deinonychusChestsQueued(catAchievements)})`,
  );
  check(
    !dungeon['deinonychusSystem'].unlocked,
    'more dungeon kills bring Deinonychus with his chest unopened',
  );

  const reloadedHuman = reloadAchievements(humanAchievements);
  const reloadedCat = reloadAchievements(catAchievements);
  check(
    reloadedHuman.counter('dungeonKills') === humanAchievements.counter('dungeonKills'),
    'the dungeon kill tally does not survive a save',
  );
  check(
    deinonychusChestsQueued(reloadedCat) === 1,
    "Deinonychus's unopened chest does not survive a save",
  );
  const resumed = new DungeonScene(level2, new InputManager(), new SceneManager(), {
    worldSeed: HARNESS_WORLD_SEED,
    skipIntro: true,
    humanAchievements: reloadedHuman,
    catAchievements: reloadedCat,
  });
  check(
    !resumed['deinonychusSystem'].unlocked,
    'a reload with his chest unopened brings Deinonychus',
  );
  let deinonychusIntroductions = 0;
  resumed['bus'].on('rewardGranted', (e) => {
    deinonychusIntroductions += e.rewards.filter(
      (reward) => reward.name === DEINONYCHUS_DEF.name,
    ).length;
  });
  const rewardScreen = resumed['achievementUI'];
  const sceneOpened = rewardScreen.onPresentationOpened;
  let broughtByAnotherChest = false;
  rewardScreen.onPresentationOpened = (presentation) => {
    sceneOpened?.(presentation);
    if (!presentsDeinonychus(presentation) && resumed['deinonychusSystem'].unlocked) {
      broughtByAnotherChest = true;
    }
  };
  while (rewardScreen.openRewards()) rewardScreen.dismiss();
  check(!broughtByAnotherChest, 'opening a chest that does not bring Deinonychus brings him');
  check(
    resumed['deinonychusSystem'].unlocked,
    'opening his chest after a reload does not bring Deinonychus',
  );
  check(
    deinonychusIntroductions === 1,
    `opening his chest does not introduce Deinonychus exactly once (${deinonychusIntroductions})`,
  );
  check(
    deinonychusChestsQueued(reloadedCat) === 0,
    "Deinonychus's chest is still waiting after it was opened",
  );

  const overworldTally = humanAchievements.counter('dungeonKills');
  const overworld = new DungeonScene(level3, new InputManager(), new SceneManager(), {
    worldSeed: HARNESS_WORLD_SEED,
    skipIntro: true,
    humanAchievements,
    catAchievements,
  });
  killRat(overworld);
  check(
    humanAchievements.counter('dungeonKills') === overworldTally,
    'an overworld kill advances the dungeon kill tally',
  );
}

for (const seed of SEEDS) {
  checkOverworld(seed);
  checkDungeon(seed);
}
const writtenSave = await writtenTownSave();
checkRespawnRoutes(writtenSave);
checkArrivalSaves(writtenSave);
checkUnknownVisitedPlace();
checkLongChestBacklogRoundTrips();
await checkDescentSaveKeepsAchievements();
await checkDungeonKillLadder();

console.log(`${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
