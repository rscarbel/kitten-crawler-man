#!/usr/bin/env tsx
/**
 * A building under a dungeon floor, walked into and back out of: floor 2's
 * prison door, through the real `DungeonScene` and the real
 * `BuildingInteriorScene`, headless.
 *
 *  - The floor that comes back is the floor that was left: the same creatures
 *    (the dead still dead), the same crawlers, every system's state as it was
 *    at the door, and no freshly spawned population.
 *  - The party stands on the tile in front of the door.
 *  - The floor clock reads on the way out exactly what it read on the way
 *    in, however long the visit took; indoors the HUD shows Nightmare's time
 *    limit held, and shows none on another difficulty; and the clock runs
 *    again on the first frames outside.
 *  - The save written at the door describes floor 2 with the party in front
 *    of the door, so a reload inside resumes there.
 *
 *   npx tsx scripts/verify-dungeon-interior-return.ts [--seeds=7,1234] [--fault=<name>]
 *
 * Every `--fault=` injects one regression the gate exists to catch and must
 * turn it red.
 */

import { installBrowserShim } from './browserShim.js';
import { settleArrival } from './settleArrival.js';
import type { Difficulty } from '../src/core/difficulty/difficultyProfiles.js';

const VIEWPORT = { width: 1280, height: 720, devicePixelRatio: 1 } as const;
installBrowserShim(VIEWPORT);

const FIRST_SEED = 7;
const SECOND_SEED = 1234;
const DEFAULT_SEEDS: readonly number[] = [FIRST_SEED, SECOND_SEED];

const FAULTS = [
  /** The exit rebuilds the floor around the party the way the overworld does. */
  'regenerate-on-exit',
  /** The exit hands the clock back as if the floor had just begun. */
  'clock-from-zero',
  /** A death on the floor handed back after a defeat indoors does nothing. */
  'defeat-skips-rewind',
] as const;
type Fault = (typeof FAULTS)[number];

function isFault(value: string): value is Fault {
  return FAULTS.some((fault) => fault === value);
}

function parseArgs(): { seeds: readonly number[]; fault: Fault | null } {
  let seeds = DEFAULT_SEEDS;
  let fault: Fault | null = null;
  for (const arg of process.argv.slice(2)) {
    const separator = arg.indexOf('=');
    const name = separator < 0 ? arg : arg.slice(0, separator);
    const value = separator < 0 ? '' : arg.slice(separator + 1);
    if (name === '--seeds') {
      seeds = value.split(',').map(Number);
    } else if (name === '--fault') {
      if (!isFault(value)) {
        console.error(`unknown fault "${value}"; known: ${FAULTS.join(', ')}`);
        process.exit(2);
      }
      fault = value;
    } else {
      console.error(`unknown argument ${arg}`);
      process.exit(2);
    }
  }
  return { seeds, fault };
}

const { seeds, fault } = parseArgs();

const { mulberry32 } = await import('../src/sprites/person/rng.js');
const { TILE_SIZE } = await import('../src/core/constants.js');
const { NecroFairy } = await import('../src/creatures/fairies/NecroFairy.js');
const { RESURRECT_RANGE_TILES } = await import('../src/creatures/fairies/fairyTuning.js');
const { loadSprites } = await import('../src/core/spriteAssets/SpriteLoader.js');
const { SceneManager } = await import('../src/core/Scene.js');
const { InputManager } = await import('../src/core/input/InputManager.js');
const { DungeonScene } = await import('../src/scenes/DungeonScene.js');
const { BuildingInteriorScene } = await import('../src/scenes/BuildingInteriorScene.js');
const { GameMap } = await import('../src/map/GameMap.js');
const { dungeonOptionsForLevel } = await import('../src/levels/dungeonOptions.js');
const { level2 } = await import('../src/levels/level2.js');
const { sceneSetupFromSave } = await import('../src/scenes/resumeFromSave.js');
const { useDevPlayerIdentity } = await import('../src/dev/devPlayerIdentity.js');
const { settings } = await import('../src/core/input/Settings.js');
useDevPlayerIdentity();

type Scene = InstanceType<typeof DungeonScene>;
type Inside = InstanceType<typeof BuildingInteriorScene>;
type LiveMap = InstanceType<typeof GameMap>;
type Manager = InstanceType<typeof SceneManager>;
type Mob = Scene['world']['roster']['mobs'][number];
type Entry = LiveMap['buildingEntries'][number];
type SaveOptions = NonNullable<ConstructorParameters<typeof DungeonScene>[3]>;
type SavedProgress = Parameters<NonNullable<SaveOptions['saveProgress']>>[0];
type Tile = { readonly x: number; readonly y: number };

/** The one tier that holds a floor to its time limit, so the HUD shows one. */
const NIGHTMARE = 'hard' as const satisfies Difficulty;
/** A tier with no time limit, on which the HUD shows none. */
const UNTIMED_DIFFICULTY = 'normal' as const satisfies Difficulty;
/** What the prison's difficulty picker is answered with; the visits never move inside it. */
const PRISON_DIFFICULTY = 'normal' as const satisfies Difficulty;
/** Creatures killed before the visit, so the way back can be asked about them. */
const KILLED_MOB_COUNT = 5;
/**
 * How far from every Necro Fairy a killed creature must lie: twice its raise
 * range, because a fairy drifts about its post while the party is indoors.
 */
const NECRO_CLEARANCE_TILES = RESURRECT_RANGE_TILES * 2;
/** Frames ticked outside before the visit, so the floor's arrival save is behind us. */
const SETTLE_FRAMES = 30;
/** Frames spent indoors: more than a minute of a running clock. */
const FRAMES_INSIDE = 5000;
/** Frames ticked outside to prove the clock runs. */
const RUNNING_CHECK_FRAMES = 120;
/** The least a running clock may count over a running check, leaving room for a held frame. */
const MIN_RUNNING_COUNT = RUNNING_CHECK_FRAMES / 2;
/** Frames given to a barrier being set down, past its own construct time. */
const BARRIER_FRAMES = 120;
const BARRIER_ITEM = 'gym_dumbbell';
/** The human's health when the party falls indoors: wounded, so a heal at the save shows. */
const WOUNDED_HP = 1;
/** Gold the run earns indoors, which the floor's return must not take back. */
const GOLD_EARNED_INDOORS = 37;
/** How far from the door step the barrier's tile is looked for. */
const SIDE_SEARCH_TILES = 3;

let failures = 0;
let checks = 0;
function check(ok: boolean, message: string): void {
  checks++;
  if (ok) return;
  failures++;
  console.log(`  FAIL: ${message}`);
}

/** Reads `read` with `difficulty` in play for the session, then puts the tier back. */
function onDifficulty<T>(difficulty: Difficulty, read: () => T): T {
  const previous = settings.difficulty;
  settings.setDifficultyForSession(difficulty);
  try {
    return read();
  } finally {
    settings.setDifficultyForSession(previous);
  }
}

// ── Faults ─────────────────────────────────────────────────────────────────

function injectFault(active: Fault | null): void {
  const proto = DungeonScene.prototype;
  switch (active) {
    case null:
      return;
    case 'regenerate-on-exit':
      Object.defineProperty(proto, 'floorRegeneratesAroundBuildings', { get: () => true });
      return;
    case 'defeat-skips-rewind':
      proto['respawnAfterDeath'] = () => undefined;
      return;
    case 'clock-from-zero': {
      const apply: unknown = Reflect.get(proto, 'applyInteriorReturn');
      if (typeof apply !== 'function') throw new Error('DungeonScene has no applyInteriorReturn');
      proto['applyInteriorReturn'] = function (this: Scene, held) {
        Reflect.apply(apply, this, [{ ...held, floorElapsedFrames: 0 }]);
      };
      return;
    }
  }
}

injectFault(fault);

await loadSprites('src/images/');

// ── Helpers ────────────────────────────────────────────────────────────────

function placeAt(entity: { x: number; y: number }, tile: Tile): void {
  entity.x = tile.x * TILE_SIZE;
  entity.y = tile.y * TILE_SIZE;
}

function tileOf(entity: { readonly x: number; readonly y: number }): Tile {
  return { x: Math.round(entity.x / TILE_SIZE), y: Math.round(entity.y / TILE_SIZE) };
}

function sameTile(a: Tile | null | undefined, b: Tile): boolean {
  return a?.x === b.x && a.y === b.y;
}

function currentScene(manager: Manager): unknown {
  return manager['current'];
}

/** Ticks `frames` frames with both crawlers pinned and topped up, so a stray blow cannot end the run. */
function tickPinned(scene: Scene | Inside, frames: number): void {
  const [human, cat] = scene.pm.wholeParty();
  const humanAt = { x: human.x, y: human.y };
  const catAt = { x: cat.x, y: cat.y };
  for (let frame = 0; frame < frames; frame++) {
    human.hp = human.maxHp;
    cat.hp = cat.maxHp;
    human.x = humanAt.x;
    human.y = humanAt.y;
    cat.x = catAt.x;
    cat.y = catAt.y;
    scene.update();
  }
}

/** Walks through the prison door the way its difficulty picker does once answered. */
function enterPrison(scene: Scene, entry: Entry): void {
  scene['enterBuilding'](entry, PRISON_DIFFICULTY);
}

/** An open tile near the door step but off it, for the barrier: the scene's props are down by now. */
function chooseSideTile(map: LiveMap, returnTile: Tile): Tile | null {
  for (let dy = -SIDE_SEARCH_TILES; dy <= SIDE_SEARCH_TILES; dy++) {
    for (let dx = -SIDE_SEARCH_TILES; dx <= SIDE_SEARCH_TILES; dx++) {
      if (dx === 0 && dy <= 0) continue;
      const tile = { x: returnTile.x + dx, y: returnTile.y + dy };
      if (map.isWalkable(tile.x, tile.y, 'walker')) return tile;
    }
  }
  return null;
}

/**
 * Kills every hostile close enough to the active crawler to hold off the door
 * save. A goblin from the next corridor can wander or chase into that radius
 * while the party stands pinned at the door, and the scene is right to refuse
 * a save then; the walk-in under test is the uncontested one, and
 * `verifyNoSaveMidFight` covers the contested one.
 */
function quietTheDoorStep(scene: Scene, label: string): void {
  const active = scene.pm.active();
  const engagementRadiusPx = DungeonScene.STAIRWELL_SAVE_ENGAGEMENT_RADIUS_TILES * TILE_SIZE;
  const threats = scene['world'].roster.mobs.filter(
    (mob) =>
      mob.isHostile &&
      mob.isAlive &&
      Math.hypot(mob.x - active.x, mob.y - active.y) <= engagementRadiusPx,
  );
  const bosses = threats.filter((mob) => mob.isBoss);
  check(bosses.length === 0, `${label}: no boss stands at the test door (${bosses.length})`);
  for (const mob of threats) if (!mob.isBoss) mob.killOutright();
  scene['world'].roster.rebuildGrid();
}

interface FloorState {
  readonly barriers: number;
  readonly openedChest: unknown;
  readonly bathroomSolved: boolean;
  readonly plumbing: string;
  readonly krakenKilled: boolean;
}

function revealedFog(scene: Scene): Uint8Array {
  return Uint8Array.from(scene['miniMap']['fogOfWar']);
}

/** Tiles explored before that are dark again; exploring more on the way out is fine. */
function fogForgotten(before: Uint8Array, scene: Scene): number {
  const now = scene['miniMap']['fogOfWar'];
  let forgotten = 0;
  for (let i = 0; i < before.length; i++) if (before[i] !== 0 && now[i] === 0) forgotten++;
  return forgotten;
}

function floorState(scene: Scene, openedChest: unknown): FloorState {
  const chest = scene['treasureChests'].allChests.find((candidate) => candidate === openedChest);
  return {
    barriers: scene['barriers'].captureCheckpoint().barriers.length,
    openedChest: chest?.state ?? null,
    bathroomSolved: scene.cloggedBathroom.isSolved,
    plumbing: scene['gameMap'].bathroomPlumbingState,
    krakenKilled: scene['krakenKilled'],
  };
}

// ── Run ────────────────────────────────────────────────────────────────────

async function verifySeed(worldSeed: number): Promise<void> {
  const label = `seed ${worldSeed}`;
  Math.random = mulberry32(worldSeed);
  const map = new GameMap({
    mapSize: level2.mapSize,
    tileHeight: TILE_SIZE,
    mapType: 'dungeon',
    dungeon: dungeonOptionsForLevel(level2),
    worldSeed,
  });
  const entry = map.buildingEntries.find((candidate) => candidate.type === 'prison');
  check(entry !== undefined, `${label}: floor 2 has the prison door`);
  if (entry === undefined) return;
  const door = entry.doorTile;
  const returnTile = { x: door.x, y: door.y + 1 };

  const saves: SavedProgress[] = [];
  const sceneManager = new SceneManager();
  const outside = new DungeonScene(level2, new InputManager(), sceneManager, {
    existingMap: map,
    worldSeed,
    skipIntro: true,
    saveProgress: (progress) => {
      saves.push(progress);
      return Promise.resolve('saved');
    },
  });
  sceneManager.replace(outside);
  const ctx = sceneManager.canvas.getContext('2d');
  if (ctx === null) throw new Error('the shim canvas has no 2d context');
  check(await settleArrival(outside, ctx), `${label}: the floor's arrival screen finishes`);
  check(
    map.isWalkable(door.x, door.y, 'walker') &&
      map.isWalkable(returnTile.x, returnTile.y, 'walker'),
    `${label}: the prison door and its step are open floor once the scene is built`,
  );
  // The door opens only to a party the gate guard has briefed.
  const stealth = outside.stealthKeySnatch;
  stealth.restoreCheckpoint({ ...stealth.captureCheckpoint(), phase: 'briefed' });
  const townOnFloor = townSystemsBuilt(outside);
  check(
    townOnFloor.length === 0,
    `${label}: a floor with a building entry builds no town systems (${townOnFloor.join(', ')})`,
  );
  const side = chooseSideTile(map, returnTile);
  check(side !== null, `${label}: there is open floor beside the door step`);
  if (side === null) return;
  const [human, cat] = outside.pm.wholeParty();
  placeAt(human, side);
  placeAt(cat, side);
  tickPinned(outside, SETTLE_FRAMES);

  // ── Change one cheap piece of state per owner ──
  // Never one a Necro Fairy could reach: it raises the dead it can see, which
  // is the game working rather than a door forgetting a kill, and where the
  // fairies hover depends on every random roll the floor made before it.
  const necroFairies = outside['world'].roster.mobs.filter((mob) => mob instanceof NecroFairy);
  const clearOfNecromancy = (mob: Mob): boolean =>
    necroFairies.every(
      (fairy) => Math.hypot(fairy.x - mob.x, fairy.y - mob.y) > NECRO_CLEARANCE_TILES * TILE_SIZE,
    );
  const killed: Mob[] = outside['world'].roster.mobs
    .filter((mob) => mob.isHostile && mob.isAlive && !mob.isBoss && clearOfNecromancy(mob))
    .slice(0, KILLED_MOB_COUNT);
  check(
    killed.length === KILLED_MOB_COUNT,
    `${label}: floor 2 has ${KILLED_MOB_COUNT} mobs to kill`,
  );
  for (const mob of killed) mob.killOutright();

  human.inventory.addItem(BARRIER_ITEM, 1);
  outside['barriers'].beginConstruct(human, 0, BARRIER_ITEM);
  tickPinned(outside, BARRIER_FRAMES);

  const chest = outside['treasureChests'].allChests.find(
    (candidate) => candidate.state !== 'opened',
  );
  if (chest !== undefined) chest.state = 'opened';
  outside['miniMap'].revealAround(door.x, door.y);
  outside.cloggedBathroom.markSolved();
  outside['krakenKilled'] = true;

  const before = floorState(outside, chest);
  const fogBefore = revealedFog(outside);
  check(before.barriers === 1, `${label}: a barrier was set down before the visit`);
  check(chest !== undefined, `${label}: floor 2 has a chest to open`);
  check(before.bathroomSolved, `${label}: the bathroom was fixed before the visit`);

  const systemSpawnedBefore = outside['systemSpawnedMobs'];
  const heldMobs = outside['world'].roster.mobs.filter((mob) => !systemSpawnedBefore.has(mob));

  placeAt(human, returnTile);
  placeAt(cat, returnTile);
  const countedOutside = (() => {
    const start = outside.floorClockElapsedFrames;
    tickPinned(outside, RUNNING_CHECK_FRAMES);
    return outside.floorClockElapsedFrames - start;
  })();
  check(
    countedOutside >= MIN_RUNNING_COUNT,
    `${label}: the clock runs in front of the door (counted ${countedOutside}/${RUNNING_CHECK_FRAMES})`,
  );
  const clockAtDoor = outside.floorClockElapsedFrames;
  const timeLimit = level2.nightmareTimeLimitFrames;
  check(timeLimit !== undefined, `${label}: floor 2 has a Nightmare time limit`);
  const timeLeftAtDoor = (timeLimit ?? 0) - clockAtDoor;

  // ── In ──
  quietTheDoorStep(outside, label);
  const savesBefore = saves.length;
  const building = outside['building'];
  check(building !== null, `${label}: a floor with a building entry builds the door system`);
  if (building === null) return;
  enterPrison(outside, entry);
  const inside = currentScene(sceneManager);
  check(inside instanceof BuildingInteriorScene, `${label}: the door leads into the building`);
  if (!(inside instanceof BuildingInteriorScene)) return;

  const doorSave = saves.length > savesBefore ? saves[saves.length - 1] : undefined;
  check(doorSave !== undefined, `${label}: walking in writes a save at the door`);
  if (doorSave !== undefined) verifyDoorSave(doorSave, returnTile, clockAtDoor, label);

  check(await settleArrival(inside, ctx), `${label}: the building's arrival screen finishes`);
  const heldClock = onDifficulty(NIGHTMARE, () => inside['hudModel']().levelTimer);
  check(
    heldClock !== null && heldClock.frames === timeLeftAtDoor && heldClock.paused,
    `${label}: the HUD indoors shows the time limit held at ${timeLeftAtDoor} (shows ${JSON.stringify(heldClock)})`,
  );
  const untimedClock = onDifficulty(UNTIMED_DIFFICULTY, () => inside['hudModel']().levelTimer);
  check(
    untimedClock === null,
    `${label}: the HUD indoors shows no time limit off Nightmare (shows ${JSON.stringify(untimedClock)})`,
  );
  tickPinned(inside, FRAMES_INSIDE);
  inside['gameStats'].recordGoldEarned(GOLD_EARNED_INDOORS);
  const goldIndoors = inside['gameStats'].snapshot().goldEarned;
  const heldClockLater = onDifficulty(NIGHTMARE, () => inside['hudModel']().levelTimer);
  check(
    heldClockLater?.frames === timeLeftAtDoor,
    `${label}: the time limit indoors still reads ${timeLeftAtDoor} after ${FRAMES_INSIDE} frames`,
  );

  // ── Out ──
  inside['doExit']();
  const back = currentScene(sceneManager);
  check(
    back instanceof DungeonScene && back !== outside,
    `${label}: the door leads back to floor 2`,
  );
  if (!(back instanceof DungeonScene)) return;

  check(
    back.floorClockElapsedFrames === clockAtDoor,
    `${label}: the clock reads ${clockAtDoor} on the way out (reads ${back.floorClockElapsedFrames})`,
  );
  const backMobs = back['world'].roster.mobs;
  const systemSpawnedAfter = back['systemSpawnedMobs'];
  const heldAfter = backMobs.filter((mob) => !systemSpawnedAfter.has(mob));
  check(
    heldAfter.length === heldMobs.length && heldAfter.every((mob, i) => mob === heldMobs[i]),
    `${label}: the floor's creatures come back as they were (${heldAfter.length} of ${heldMobs.length})`,
  );
  const strangers = heldAfter.filter((mob) => !heldMobs.includes(mob));
  check(
    strangers.length === 0,
    `${label}: ${strangers.length} creature(s) spawned anew on the way out`,
  );
  check(
    systemSpawnedAfter.size === systemSpawnedBefore.size,
    `${label}: the systems stand up as many of their own creatures (${systemSpawnedAfter.size} vs ${systemSpawnedBefore.size})`,
  );
  const corpsesIndexed = killed.filter((mob) => back['world'].roster.grid.has(mob));
  check(
    corpsesIndexed.length === 0,
    `${label}: ${corpsesIndexed.length} carried corpse(s) sit in the mob grid on the way out`,
  );
  const revived = killed.filter((mob) => mob.isAlive || !backMobs.includes(mob));
  check(
    revived.length === 0,
    `${label}: ${revived.length} killed mob(s) are not lying dead outside`,
  );
  check(
    back.pm.human === human && back.pm.cat === cat,
    `${label}: the crawlers the floor points at walk back out`,
  );
  check(
    sameTile(tileOf(back.pm.active()), returnTile),
    `${label}: the party stands in front of the door (at ${JSON.stringify(tileOf(back.pm.active()))}, door step ${JSON.stringify(returnTile)})`,
  );

  check(
    await settleArrival(back, ctx),
    `${label}: the floor's arrival screen finishes on the way out`,
  );
  const goldOutside = back['gameStats'].snapshot().goldEarned;
  check(
    goldOutside === goldIndoors,
    `${label}: the run's tallies keep what changed indoors (${goldIndoors} gold earned in, ${goldOutside} out)`,
  );
  const townAfter = townSystemsBuilt(back);
  check(
    townAfter.length === 0,
    `${label}: the floor rebuilt at the door builds no town systems (${townAfter.join(', ')})`,
  );
  const after = floorState(back, chest);
  for (const key of Object.keys(before)) {
    const was: unknown = Reflect.get(before, key);
    const is: unknown = Reflect.get(after, key);
    check(was === is, `${label}: ${key} survives the visit (${String(was)} → ${String(is)})`);
  }

  const forgotten = fogForgotten(fogBefore, back);
  check(
    forgotten === 0,
    `${label}: ${forgotten} explored minimap tile(s) went dark over the visit`,
  );

  const clockOnExit = back.floorClockElapsedFrames;
  tickPinned(back, RUNNING_CHECK_FRAMES);
  const countedAfter = back.floorClockElapsedFrames - clockOnExit;
  check(
    countedAfter >= MIN_RUNNING_COUNT,
    `${label}: the clock runs again outside (counted ${countedAfter}/${RUNNING_CHECK_FRAMES})`,
  );
  const goblinsBeforeDeath = goblinsOnFloor(back);
  check(
    goblinsBeforeDeath > 0,
    `${label}: the bathroom's goblins stand on the floor after the visit`,
  );
  back['respawnAfterDeath']();
  const goblinsAfterDeath = goblinsOnFloor(back);
  check(
    goblinsAfterDeath === goblinsBeforeDeath,
    `${label}: a death after the visit keeps the bathroom's goblins (${goblinsAfterDeath} of ${goblinsBeforeDeath})`,
  );
  const revivedByDeath = killed.filter((mob) => mob.isAlive);
  check(
    revivedByDeath.length === 0,
    `${label}: a death after the visit leaves the mobs killed before the door save dead`,
  );

  await verifyDefeatIndoors(back, sceneManager, entry, returnTile, killed, saves, ctx, label);
  console.log(`${label}: done`);
}

/**
 * A defeat indoors is a death like any other: it lands on the last save — here
 * the one written at the door — rather than rebuilding the held floor.
 */
async function verifyDefeatIndoors(
  outside: Scene,
  sceneManager: Manager,
  entry: Entry,
  returnTile: Tile,
  killed: readonly Mob[],
  saves: readonly SavedProgress[],
  ctx: CanvasRenderingContext2D,
  label: string,
): Promise<void> {
  for (const crawler of outside.pm.wholeParty()) placeAt(crawler, returnTile);
  enterPrison(outside, entry);
  const inside = currentScene(sceneManager);
  if (!(inside instanceof BuildingInteriorScene)) {
    check(false, `${label}: the door leads into the building a second time`);
    return;
  }
  check(await settleArrival(inside, ctx), `${label}: the second visit's arrival screen finishes`);
  inside['reviveAndExit']();
  const respawned = currentScene(sceneManager);
  check(
    respawned instanceof DungeonScene && respawned !== outside,
    `${label}: a defeat indoors respawns on floor 2`,
  );
  if (!(respawned instanceof DungeonScene)) return;
  check(
    respawned.pm.human === outside.pm.human,
    `${label}: a defeat indoors hands back the held floor rather than regenerating it`,
  );
  const revived = killed.filter((mob) => mob.isAlive);
  check(
    revived.length === 0,
    `${label}: a defeat indoors leaves ${revived.length} mob(s) killed before the save alive`,
  );
  check(
    sameTile(tileOf(respawned.pm.active()), returnTile),
    `${label}: a defeat indoors lands on the save written at the door`,
  );
  await verifyNoSaveMidFight(respawned, sceneManager, entry, returnTile, saves, ctx, label);
}

/** A hostile at the door holds off the door save; the floor is still held for the visit. */
async function verifyNoSaveMidFight(
  outside: Scene,
  sceneManager: Manager,
  entry: Entry,
  returnTile: Tile,
  saves: readonly SavedProgress[],
  ctx: CanvasRenderingContext2D,
  label: string,
): Promise<void> {
  check(await settleArrival(outside, ctx), `${label}: the respawned floor's arrival finishes`);
  const hostile = outside['world'].roster.mobs.find(
    (mob) => mob.isHostile && mob.isAlive && !mob.isBoss,
  );
  if (hostile === undefined) {
    check(false, `${label}: floor 2 still has a hostile to stand at the door`);
    return;
  }
  for (const crawler of outside.pm.wholeParty()) placeAt(crawler, returnTile);
  placeAt(hostile, { x: returnTile.x + 1, y: returnTile.y });
  outside['world'].roster.rebuildGrid();
  const savesBefore = saves.length;
  enterPrison(outside, entry);
  check(
    saves.length === savesBefore,
    `${label}: walking in with a hostile at the door saves nothing`,
  );
  const inside = currentScene(sceneManager);
  if (!(inside instanceof BuildingInteriorScene)) {
    check(false, `${label}: the door leads in with a hostile at it`);
    return;
  }
  inside['doExit']();
  const back = currentScene(sceneManager);
  check(
    back instanceof DungeonScene && back.pm.human === outside.pm.human,
    `${label}: the floor is still held for a visit that took no save`,
  );
  if (!(back instanceof DungeonScene)) return;
  await verifyDefeatWithoutDoorSave(back, sceneManager, entry, returnTile, saves, ctx, label);
}

/**
 * A defeat on a visit that took no door save goes back to the older save, with
 * the party healed there — not out of the door it never walked through.
 */
async function verifyDefeatWithoutDoorSave(
  outside: Scene,
  sceneManager: Manager,
  entry: Entry,
  returnTile: Tile,
  saves: readonly SavedProgress[],
  ctx: CanvasRenderingContext2D,
  label: string,
): Promise<void> {
  check(
    await settleArrival(outside, ctx),
    `${label}: the floor's arrival finishes before the last visit`,
  );
  const savedTile = chooseSideTile(outside['gameMap'], returnTile);
  const hostile = outside['world'].roster.mobs.find(
    (mob) => mob.isHostile && mob.isAlive && !mob.isBoss,
  );
  if (savedTile === null || hostile === undefined) {
    check(false, `${label}: floor 2 has a save tile and a hostile for the last visit`);
    return;
  }
  for (const crawler of outside.pm.wholeParty()) placeAt(crawler, savedTile);
  outside['captureSavePoint'](savedTile);

  for (const crawler of outside.pm.wholeParty()) placeAt(crawler, returnTile);
  placeAt(hostile, { x: returnTile.x + 1, y: returnTile.y });
  outside['world'].roster.rebuildGrid();
  const savesBefore = saves.length;
  enterPrison(outside, entry);
  check(saves.length === savesBefore, `${label}: the last visit takes no door save`);
  const inside = currentScene(sceneManager);
  if (!(inside instanceof BuildingInteriorScene)) {
    check(false, `${label}: the door leads in for the last visit`);
    return;
  }
  check(await settleArrival(inside, ctx), `${label}: the last visit's arrival screen finishes`);
  inside.pm.human.hp = WOUNDED_HP;
  inside['reviveAndExit']();
  const respawned = currentScene(sceneManager);
  if (!(respawned instanceof DungeonScene)) {
    check(false, `${label}: a defeat with no door save respawns on floor 2`);
    return;
  }
  const human = respawned.pm.human;
  check(
    sameTile(tileOf(respawned.pm.active()), savedTile),
    `${label}: a defeat with no door save lands on the older save (at ${JSON.stringify(tileOf(respawned.pm.active()))}, save ${JSON.stringify(savedTile)})`,
  );
  check(
    human.hp === human.maxHp,
    `${label}: a defeat with no door save heals the party at the save (${human.hp}/${human.maxHp})`,
  );
  respawned.onExit();
}

/** The overworld's own systems, each of which must stay off a dungeon floor. */
function townSystemsBuilt(scene: Scene): string[] {
  const systems: Record<string, unknown> = {
    market: scene['market'],
    townProps: scene['townProps'],
    townDecor: scene['townDecor'],
    townLife: scene['townLife'],
    bounty: scene['bounty'],
    gathering: scene['gathering'],
    noticeBoard: scene['noticeBoard'],
  };
  return Object.entries(systems)
    .filter(([, system]) => system !== null)
    .map(([name]) => name);
}

/** The bathroom's goblins still standing in the scene's roster. */
function goblinsOnFloor(scene: Scene): number {
  const mobs = scene['world'].roster.mobs;
  return scene.cloggedBathroom.allGoblins().filter((goblin) => mobs.includes(goblin)).length;
}

/** The save at the door is what a reload inside the building resumes from. */
function verifyDoorSave(save: SavedProgress, returnTile: Tile, clock: number, label: string): void {
  check(save.levelId === level2.id, `${label}: the door save is on floor 2 (${save.levelId})`);
  check(
    sameTile(save.world?.resumeTile, returnTile),
    `${label}: the door save resumes in front of the door (${JSON.stringify(save.world?.resumeTile)})`,
  );
  check(
    save.world?.floorElapsedFrames === clock,
    `${label}: the door save keeps the clock at ${clock} (${String(save.world?.floorElapsedFrames)})`,
  );
  const { levelDef, options } = sceneSetupFromSave({ skipIntro: true }, save);
  const reloaded = new DungeonScene(levelDef, new InputManager(), new SceneManager(), options);
  check(levelDef.id === level2.id, `${label}: a reload inside the building resumes on floor 2`);
  check(
    sameTile(tileOf(reloaded.pm.active()), returnTile),
    `${label}: a reload inside the building resumes in front of the door`,
  );
  reloaded.onExit();
}

for (const worldSeed of seeds) await verifySeed(worldSeed);

const faultNote = fault === null ? '' : ` (fault: ${fault})`;
console.log(
  failures === 0
    ? `\nAll ${checks} dungeon-interior-return checks passed${faultNote}.`
    : `\n${failures} of ${checks} check(s) failed${faultNote}.`,
);
process.exit(failures === 0 ? 0 : 1);
