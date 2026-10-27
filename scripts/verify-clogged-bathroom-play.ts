#!/usr/bin/env tsx
/**
 * The clogged bathroom, played: the real `DungeonScene` on floor 2, headless,
 * driven through the same calls the game's own input reaches.
 *
 *  - The pipe board and its explainer hold the collapse timer for as long as
 *    they are up, and closing the board starts it again.
 *  - Every weapon the party has (melee, smush, missile, slingshot, dynamite,
 *    the shell), fired through its own system, reaches a queue goblin and the
 *    plumber, hurts neither, moves neither, pays nothing and gets an "ow".
 *  - Neither companion ever picks a bathroom goblin to fight.
 *  - Playing the board to its answer through the turn API opens every copy
 *    and the way on to the gateway, and the fixed room then saves the crawler
 *    standing in it, once, on a tile inside the room.
 *  - A stall visit hides and protects the crawler for its whole length, then
 *    leaves him Refreshed; a second visit refreshes rather than stacks, and
 *    the walking boon lasts exactly as long as the status.
 *  - The fix and the explainer survive a checkpoint and a save, a save written
 *    before the bathroom existed loads it broken, and a death after an unsaved
 *    fix comes back to it broken.
 *
 *   npx tsx scripts/verify-clogged-bathroom-play.ts [--seeds=7,1234,98765] [--fault=<name>]
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
const THIRD_SEED = 98765;
const DEFAULT_SEEDS: readonly number[] = [FIRST_SEED, SECOND_SEED, THIRD_SEED];

const FAULTS = [
  /** The board surface stops reporting itself open, so it no longer halts the world. */
  'board-runs-clock',
  /** The explainer stops reporting itself open, so it no longer halts the world. */
  'explainer-runs-clock',
  /** Closing the board does nothing, so the clock never starts again. */
  'close-keeps-halt',
  /** The goblins can be hurt and killed. */
  'goblin-mortal',
  /** A blow on a goblin is paid like a blow on an enemy. */
  'goblin-pays',
  /** A goblin takes a blow in silence. */
  'goblin-silent',
  /** A goblin pushed by a weapon leaves his place in line. */
  'goblin-shoved',
  /** The goblins count as enemies, so companions go for them. */
  'goblin-hostile',
  /** Fixing the plumbing leaves the doorways blocked. */
  'solve-leaves-blocked',
  /** The render pipeline is told nobody is in a stall. */
  'stall-visible',
  /** A crawler in a stall can still be hurt. */
  'stall-harmable',
  /** The visit runs at double speed and ends halfway. */
  'visit-ends-early',
  /** Refreshed lands with twice its duration. */
  'buff-wrong-duration',
  /** A second visit adds a second Refreshed instead of renewing the first. */
  'buff-stacks',
  /** Refreshed does nothing to walking pace. */
  'buff-no-speed',
  /** The walking boon outlives the status. */
  'speed-outlives-buff',
  /** The in-run checkpoint forgets the fix and the explainer. */
  'checkpoint-forgets',
  /** The persisted save leaves the bathroom out. */
  'save-drops-bathroom',
  /** A rewind leaves the bathroom as it is instead of as captured. */
  'restore-ignores-snapshot',
  /** A fixed bathroom never counts as a save point. */
  'fixed-room-never-saves',
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
const { loadSprites } = await import('../src/core/spriteAssets/SpriteLoader.js');
const { SceneManager } = await import('../src/core/Scene.js');
const { InputManager } = await import('../src/core/input/InputManager.js');
const { DungeonScene } = await import('../src/scenes/DungeonScene.js');
const { GameMap } = await import('../src/map/GameMap.js');
const { dungeonOptionsForLevel } = await import('../src/levels/dungeonOptions.js');
const { level2 } = await import('../src/levels/level2.js');
const { AbilityManager } = await import('../src/core/skills/AbilityManager.js');
const { MAGIC_MISSILE_DEF } = await import('../src/abilities/magicMissile.js');
const { PROTECTIVE_SHELL_DEF } = await import('../src/abilities/protectiveShell.js');
const { SMUSH_DEF } = await import('../src/abilities/smush.js');
const { MONGO_DEF } = await import('../src/abilities/mongo.js');
const { GameStats } = await import('../src/core/progression/GameStats.js');
const { BathroomGoblin, OW_THROTTLE_FRAMES } = await import('../src/creatures/BathroomGoblin.js');
const { despawnMob } = await import('../src/creatures/Mob.js');
const { CloggedBathroomSystem, STALL_VISIT_FRAMES, STALL_ENTER_FRAMES } =
  await import('../src/systems/cloggedBathroom/CloggedBathroomSystem.js');
const { traceFlow, answerMasks, currentMask } =
  await import('../src/systems/cloggedBathroom/pipeBoard.js');
const { REFRESHED_STATUS, REFRESHED_DURATION_TICKS, REFRESHED_SPEED_FACTOR } =
  await import('../src/core/combat/StatusEffect.js');
const { sceneSetupFromSave } = await import('../src/scenes/resumeFromSave.js');
const { parsePersistedWorldState } = await import('../src/core/save/PersistedWorldState.js');
const { tileIndex } = await import('../src/map/tileIndex.js');
const { settings } = await import('../src/core/input/Settings.js');
const { DIFFICULTY_ORDER } = await import('../src/core/difficulty/difficultyProfiles.js');

type Scene = InstanceType<typeof DungeonScene>;
type LiveMap = InstanceType<typeof GameMap>;
type Goblin = InstanceType<typeof BathroomGoblin>;
type Crawler = ReturnType<Scene['pm']['active']>;
type Bathroom = Scene['cloggedBathroom'];
type BathroomCopy = Bathroom['copies'][number];
type SaveOptions = NonNullable<ConstructorParameters<typeof DungeonScene>[3]>;
type SavedProgress = Parameters<NonNullable<SaveOptions['saveProgress']>>[0];
type Tile = { readonly x: number; readonly y: number };
type Rect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
type DamageKind = 'melee' | 'catMelee' | 'smush' | 'missile' | 'slingshot' | 'explosion' | 'shell';

/** Frames the board and the explainer are each held open: ten seconds of a running clock. */
const HELD_OPEN_FRAMES = 600;
/** Frames ticked to prove the clock runs; long enough that rounding cannot hide it. */
const RUNNING_CHECK_FRAMES = 120;
/** The least a running clock may lose over a running check, leaving room for a stray halted frame. */
const MIN_RUNNING_LOSS = RUNNING_CHECK_FRAMES / 2;
/** Every ability at its last level, so every rider a weapon has (splash, stun, shockwave) is in play. */
const ABILITY_TEST_LEVEL = 15;
/** Frames a melee swing, a stomp, a missile or a stone is given to land. */
const BLOW_FRAMES = 90;
/** Frames a tapped stick of dynamite is given to burn down and go off. */
const DYNAMITE_FRAMES = 360;
/** Frames between two weapons, so a goblin's "ow" throttle has run out before the next blow. */
const OW_THROTTLE_MARGIN_FRAMES = 15;
const BETWEEN_BLOWS_FRAMES = OW_THROTTLE_FRAMES + OW_THROTTLE_MARGIN_FRAMES;
/** Frames the companions are watched next to the queue. */
const COMPANION_WATCH_FRAMES = 300;
/** Frames ticked after the fix so the copy in view plays its clearing out. */
const AFTER_FIX_FRAMES = 240;
/** Frames waited between the two stall visits, so the second has something to renew. */
const BETWEEN_VISITS_FRAMES = 300;
/** A blow a mob would land on a crawler in a stall. */
const STALL_TEST_BLOW = 10;
/** Speed ratios compare to this many decimal places' worth of error. */
const SPEED_TOLERANCE = 1e-9;
/** Plenty of ticks past a full Refreshed for it to be gone. */
const EXPIRY_SLACK_TICKS = 5;
/** Quarter turns that bring any tile back to where it started. */
const FULL_TURN_QUARTERS = 4;
const DAMAGE_KINDS: readonly DamageKind[] = [
  'melee',
  'catMelee',
  'smush',
  'missile',
  'slingshot',
  'explosion',
  'shell',
];
const NEIGHBOUR_STEPS: readonly Tile[] = [
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

let failures = 0;
let checks = 0;
function check(ok: boolean, message: string): void {
  checks++;
  if (ok) return;
  failures++;
  console.log(`  FAIL: ${message}`);
}

// ── Faults ─────────────────────────────────────────────────────────────────

function injectFault(active: Fault | null): void {
  const bathroomProto = CloggedBathroomSystem.prototype;
  const goblinProto = BathroomGoblin.prototype;
  switch (active) {
    case null:
    case 'goblin-mortal':
    case 'solve-leaves-blocked':
    case 'stall-harmable':
    case 'visit-ends-early':
    case 'buff-wrong-duration':
    case 'buff-stacks':
    case 'buff-no-speed':
    case 'speed-outlives-buff':
    case 'save-drops-bathroom':
      return;
    case 'board-runs-clock':
      Object.defineProperty(bathroomProto, 'isPipeBoardOpen', { get: () => false });
      return;
    case 'explainer-runs-clock':
      Object.defineProperty(bathroomProto, 'isPipeBoardExplainerOpen', { get: () => false });
      return;
    case 'close-keeps-halt':
      bathroomProto.closePipeBoard = () => undefined;
      return;
    case 'goblin-pays':
      Object.defineProperty(goblinProto, 'blowsEarnNothing', { get: () => false });
      return;
    case 'goblin-silent':
      goblinProto['onDamageBlocked'] = () => undefined;
      return;
    case 'goblin-shoved':
      goblinProto['acceptsShove'] = () => true;
      Object.defineProperty(goblinProto, 'separationAnchored', { get: () => false });
      return;
    case 'goblin-hostile':
      Object.defineProperty(goblinProto, 'isHostile', { get: () => true });
      return;
    case 'stall-visible':
      bathroomProto.isCrawlerHidden = () => false;
      return;
    case 'checkpoint-forgets':
      bathroomProto.captureCheckpoint = () => ({ phase: 'unmet', explainerSeen: false });
      return;
    case 'restore-ignores-snapshot':
      bathroomProto.restoreCheckpoint = () => undefined;
      return;
    case 'fixed-room-never-saves':
      bathroomProto.saveTileAt = () => null;
      return;
  }
}

injectFault(fault);

/** The faults that wrap a method, injected on the live scene's own objects so the original stays bound. */
function injectSceneFault(scene: Scene, active: Fault | null): void {
  const bathroom = scene.cloggedBathroom;
  switch (active) {
    case 'solve-leaves-blocked': {
      const map = scene['gameMap'];
      const setPlumbing = map.setBathroomPlumbing.bind(map);
      map.setBathroomPlumbing = (state) => {
        if (state === 'broken') setPlumbing(state);
      };
      return;
    }
    case 'stall-harmable': {
      const startVisit = bathroom.startStallVisit.bind(bathroom);
      bathroom.startStallVisit = (crawler, copy, stall) => {
        const started = startVisit(crawler, copy, stall);
        crawler.concealed = false;
        return started;
      };
      return;
    }
    case 'visit-ends-early': {
      const tickVisit = bathroom['tickVisit'].bind(bathroom);
      bathroom['tickVisit'] = () => {
        tickVisit();
        tickVisit();
      };
      return;
    }
    case 'buff-wrong-duration':
    case 'buff-stacks':
      for (const crawler of scene.pm.players()) {
        const applyStatus = crawler.applyStatus.bind(crawler);
        crawler.applyStatus = (effect) => {
          if (effect.type !== REFRESHED_STATUS) {
            applyStatus(effect);
          } else if (active === 'buff-stacks') {
            crawler.statusEffects.push(effect);
          } else {
            applyStatus({
              ...effect,
              ticksRemaining: effect.ticksRemaining * 2,
              totalTicks: effect.totalTicks * 2,
            });
          }
        };
      }
      return;
    case 'buff-no-speed':
    case 'speed-outlives-buff':
      for (const crawler of scene.pm.players()) {
        const prototype: unknown = Object.getPrototypeOf(crawler);
        if (typeof prototype !== 'object' || prototype === null) continue;
        let everRefreshed = false;
        Object.defineProperty(crawler, 'speedMultiplier', {
          get: (): number => {
            const live: unknown = Reflect.get(prototype, 'speedMultiplier', crawler);
            if (typeof live !== 'number') return 0;
            const refreshed = crawler.hasStatus(REFRESHED_STATUS);
            if (refreshed) everRefreshed = true;
            if (active === 'buff-no-speed') return refreshed ? live / REFRESHED_SPEED_FACTOR : live;
            const lingers = !refreshed && everRefreshed;
            return lingers ? live * REFRESHED_SPEED_FACTOR : live;
          },
          set: (value: number) => {
            Reflect.set(prototype, 'speedMultiplier', value, crawler);
          },
        });
      }
      return;
    case 'save-drops-bathroom': {
      const capture = scene['capturePersistedWorldState'].bind(scene);
      Reflect.set(scene, 'capturePersistedWorldState', () => {
        const { cloggedBathroom: _dropped, ...rest } = capture();
        return rest;
      });
      return;
    }
    case null:
    case 'board-runs-clock':
    case 'explainer-runs-clock':
    case 'close-keeps-halt':
    case 'goblin-mortal':
    case 'goblin-pays':
    case 'goblin-silent':
    case 'goblin-shoved':
    case 'goblin-hostile':
    case 'stall-visible':
    case 'checkpoint-forgets':
    case 'restore-ignores-snapshot':
    case 'fixed-room-never-saves':
      return;
  }
}

await loadSprites('src/images/');

// ── Helpers ────────────────────────────────────────────────────────────────

function placeAt(entity: { x: number; y: number }, tile: Tile): void {
  entity.x = tile.x * TILE_SIZE;
  entity.y = tile.y * TILE_SIZE;
}

function tileOf(entity: { readonly x: number; readonly y: number }): Tile {
  return { x: Math.round(entity.x / TILE_SIZE), y: Math.round(entity.y / TILE_SIZE) };
}

/** Ticks `frames` frames with both crawlers pinned where they stand and topped up, so a stray blow cannot end the run. */
function tickPinned(scene: Scene, frames: number, onFrame?: () => void): void {
  const [human, cat] = scene.pm.players();
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
    onFrame?.();
  }
}

function framesLost(scene: Scene, frames: number): number {
  const before = scene.levelTimerRemainingFrames;
  tickPinned(scene, frames);
  return before - scene.levelTimerRemainingFrames;
}

/** Everything walkable from `start` by the map's own walkability, block flags included. */
function reachableTiles(map: LiveMap, start: Tile): Set<number> {
  const size = map.gridSize;
  const seen = new Set<number>();
  if (!map.isWalkable(start.x, start.y)) return seen;
  seen.add(tileIndex(start.x, start.y, size));
  const queue: Tile[] = [start];
  // A for-of over an array visits what is pushed onto it mid-loop, which is the flood.
  for (const tile of queue) {
    for (const step of NEIGHBOUR_STEPS) {
      const next = { x: tile.x + step.x, y: tile.y + step.y };
      const key = tileIndex(next.x, next.y, size);
      if (seen.has(key) || !map.isWalkable(next.x, next.y)) continue;
      seen.add(key);
      queue.push(next);
    }
  }
  return seen;
}

function anyTileReachable(reached: ReadonlySet<number>, size: number, rect: Rect): boolean {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      if (reached.has(tileIndex(x, y, size))) return true;
    }
  }
  return false;
}

function gatewayBounds(map: LiveMap): Rect | null {
  const gauntletIndex = map.progressionLayout?.bathroomGauntletIndex ?? null;
  if (gauntletIndex === null) return null;
  const gauntlet = level2.progression?.gauntlets[gauntletIndex];
  const gateway = map.safeRooms.find(
    (room) => room.guardsBossType === gauntlet?.bossType && room.followsBossType === undefined,
  );
  return gateway?.bounds ?? null;
}

function blockedTilesOf(copy: BathroomCopy): Tile[] {
  const { room } = copy;
  return [
    ...room.blockedDoorways.flatMap((doorway) => doorway.tiles),
    ...room.queueTiles,
    ...room.doorwayKnots.flat(),
  ];
}

function abilityManagerAtTestLevel(): InstanceType<typeof AbilityManager> {
  const manager = new AbilityManager();
  for (const def of [MAGIC_MISSILE_DEF, PROTECTIVE_SHELL_DEF, SMUSH_DEF, MONGO_DEF]) {
    manager.register(def);
  }
  manager.setLevel('magic_missile', ABILITY_TEST_LEVEL);
  manager.setLevel('protective_shell', ABILITY_TEST_LEVEL);
  manager.setLevel('smush', ABILITY_TEST_LEVEL);
  return manager;
}

interface Rig {
  readonly scene: Scene;
  readonly map: LiveMap;
  readonly abilities: InstanceType<typeof AbilityManager>;
  readonly stats: InstanceType<typeof GameStats>;
  readonly saves: SavedProgress[];
  readonly events: Record<string, number>;
  readonly ctx: CanvasRenderingContext2D;
}

/** Bus events whose count is a fight or a kill being recorded. */
const COUNTED_EVENTS = ['combatStarted', 'mobKilled', 'multiKill', 'dynamiteKills'] as const;

async function buildRig(worldSeed: number): Promise<Rig | null> {
  Math.random = mulberry32(worldSeed);
  const map = new GameMap({
    mapSize: level2.mapSize,
    tileHeight: TILE_SIZE,
    mapType: 'dungeon',
    dungeon: dungeonOptionsForLevel(level2),
    worldSeed,
  });
  const abilities = abilityManagerAtTestLevel();
  const stats = new GameStats();
  const saves: SavedProgress[] = [];
  const sceneManager = new SceneManager();
  const scene = new DungeonScene(level2, new InputManager(), sceneManager, {
    existingMap: map,
    worldSeed,
    skipIntro: true,
    abilityManager: abilities,
    gameStats: stats,
    saveProgress: (progress) => {
      saves.push(progress);
      return Promise.resolve('saved');
    },
  });
  injectSceneFault(scene, fault);
  sceneManager.replace(scene);
  const ctx = sceneManager.canvas.getContext('2d');
  if (ctx === null) throw new Error('the shim canvas has no 2d context');
  const settled = await settleArrival(scene, ctx);
  check(settled, `seed ${worldSeed}: the arrival screen finishes`);
  if (!settled) return null;
  const events: Record<string, number> = {};
  for (const name of COUNTED_EVENTS) {
    events[name] = 0;
    scene['bus'].on(name, () => {
      events[name] = (events[name] ?? 0) + 1;
    });
  }
  return { scene, map, abilities, stats, saves, events, ctx };
}

// ── The clock ──────────────────────────────────────────────────────────────

function verifyClock(rig: Rig, copy: BathroomCopy, label: string): void {
  const { scene } = rig;
  const bathroom = scene.cloggedBathroom;
  for (const crawler of scene.pm.players()) placeAt(crawler, copy.room.pipeWallStandTile);

  const lostBefore = framesLost(scene, RUNNING_CHECK_FRAMES);
  check(
    lostBefore >= MIN_RUNNING_LOSS,
    `${label}: the clock runs at the pipe wall (lost ${lostBefore}/${RUNNING_CHECK_FRAMES})`,
  );

  bathroom.usePipeWall(copy);
  check(bathroom.difficultyGate.isPickerOpen, `${label}: the wall asks for a difficulty first`);
  const lostToPicker = framesLost(scene, HELD_OPEN_FRAMES);
  check(
    lostToPicker === 0,
    `${label}: the clock holds under the difficulty picker (lost ${lostToPicker}/${HELD_OPEN_FRAMES})`,
  );
  bathroom.difficultyGate.choose(settings.difficulty);
  check(
    !bathroom.difficultyGate.isPickerOpen && bathroom.isPipeBoardExplainerOpen,
    `${label}: the first pick at the wall opens the explainer`,
  );
  const lostToExplainer = framesLost(scene, HELD_OPEN_FRAMES);
  check(
    lostToExplainer === 0,
    `${label}: the clock holds under the explainer (lost ${lostToExplainer}/${HELD_OPEN_FRAMES})`,
  );

  bathroom.finishPipeBoardExplainer();
  check(bathroom.hasSeenExplainer, `${label}: finishing the explainer marks it seen`);
  check(bathroom.isPipeBoardOpen, `${label}: finishing the explainer opens the board`);
  const lostToBoard = framesLost(scene, HELD_OPEN_FRAMES);
  check(
    lostToBoard === 0,
    `${label}: the clock holds under the board (lost ${lostToBoard}/${HELD_OPEN_FRAMES})`,
  );
  check(bathroom.pipeBoard !== null, `${label}: the board finished generating behind the halt`);

  bathroom.closePipeBoard();
  verifyDifficultyPick(rig, copy, label);
  const lostAfterClose = framesLost(scene, RUNNING_CHECK_FRAMES);
  check(
    lostAfterClose >= MIN_RUNNING_LOSS,
    `${label}: the clock runs again once the board closes (lost ${lostAfterClose}/${RUNNING_CHECK_FRAMES})`,
  );
}

// ── Weapons on the goblins ─────────────────────────────────────────────────

interface GoblinState {
  readonly hp: number;
  readonly alive: boolean;
  readonly x: number;
  readonly y: number;
  readonly statuses: number;
  readonly credited: number;
}

function goblinState(goblin: Goblin): GoblinState {
  return {
    hp: goblin.hp,
    alive: goblin.isAlive,
    x: goblin.x,
    y: goblin.y,
    statuses: goblin.statusEffects.length,
    credited: goblin.damageTakenBy.size,
  };
}

/** Every number the party earns or the run counts, as one comparable string. */
function progressSnapshot(rig: Rig): string {
  const { scene } = rig;
  const [human, cat] = scene.pm.players();
  const destruction = scene['destruction'];
  const loot = destruction.loot.captureCheckpoint();
  const { framesPlayed: _framesPlayed, damageTaken: _damageTaken, ...stats } = rig.stats.snapshot();
  return JSON.stringify({
    humanXp: [human.level, human.xp, human.coins],
    catXp: [cat.level, cat.xp, cat.coins],
    abilities: rig.abilities.serializeStates(),
    stats,
    events: rig.events,
    combatCooldown: scene['combatCooldownFrames'],
    loot: loot.pendingLoots.length + loot.floorItems.length,
    pickups: destruction.groundPickups.all.length,
  });
}

/** A tile beside `goblin` the crawlers can stand on, so a blow from there is a fair test. */
/**
 * A tile beside `goblin` a crawler can stand on: open floor if there is any,
 * else a queue tile no other goblin stands on (the plumber is boxed in by the
 * stalls, the walls and his own line).
 */
function standingTileBeside(map: LiveMap, goblin: Goblin, goblins: readonly Goblin[]): Tile | null {
  const at = tileOf(goblin);
  const beside = NEIGHBOUR_STEPS.map((step) => ({ x: at.x + step.x, y: at.y + step.y }));
  const open = beside.find((tile) => map.isWalkable(tile.x, tile.y));
  if (open !== undefined) return open;
  const taken = new Set(
    goblins.map((other) => tileIndex(tileOf(other).x, tileOf(other).y, map.gridSize)),
  );
  return (
    beside.find(
      (tile) =>
        map.isWalkableIgnoringBathroomQueue(tile.x, tile.y) &&
        !taken.has(tileIndex(tile.x, tile.y, map.gridSize)),
    ) ?? null
  );
}

function faceToward(crawler: Crawler, from: Tile, to: Tile): void {
  crawler.facingX = Math.sign(to.x - from.x);
  crawler.facingY = Math.sign(to.y - from.y);
}

/** Throws one `kind` of blow at `goblin` through the weapon's own system and plays it out. */
function throwBlow(rig: Rig, kind: DamageKind, goblin: Goblin, stand: Tile): void {
  const { scene } = rig;
  const [human, cat] = scene.pm.players();
  const target = tileOf(goblin);
  const attacker = kind === 'catMelee' || kind === 'missile' ? cat : human;
  if (!attacker.isActive) scene.pm.switchActive();
  placeAt(human, stand);
  placeAt(cat, stand);
  faceToward(human, stand, target);
  faceToward(cat, stand, target);
  switch (kind) {
    case 'melee':
      human.triggerAttack(goblin);
      tickPinned(scene, BLOW_FRAMES);
      return;
    case 'catMelee':
      cat.triggerAttack();
      tickPinned(scene, BLOW_FRAMES);
      return;
    case 'smush':
      human.triggerSmush();
      tickPinned(scene, BLOW_FRAMES);
      return;
    case 'missile':
      cat.triggerMissile();
      tickPinned(scene, BLOW_FRAMES);
      return;
    case 'slingshot':
      human.triggerSlingshot();
      tickPinned(scene, BLOW_FRAMES);
      return;
    case 'explosion': {
      const dynamite = scene['destruction'].dynamite;
      human.inventory.addItem('goblin_dynamite', 1);
      // The blast is meant to catch the crawlers too; what it does to them is not under test here.
      human.godMode = true;
      cat.godMode = true;
      dynamite.beginCharge(0, human, 'goblin_dynamite');
      dynamite.release(human);
      tickPinned(scene, DYNAMITE_FRAMES);
      human.godMode = false;
      cat.godMode = false;
      return;
    }
    case 'shell': {
      const spells = scene['combat'].spells;
      // The shell's cooldown outlasts a case, and the second subject needs a fresh cast.
      spells['_shellCooldown'] = 0;
      const cast = spells.triggerProtectiveShell(
        human,
        cat,
        scene['world'].roster.grid,
        ABILITY_TEST_LEVEL,
      );
      check(cast, 'the protective shell went up');
      tickPinned(scene, shellFramesLeft(rig) + BLOW_FRAMES);
      return;
    }
  }
}

/** Frames the shell has left to run, so its parting shockwave lands inside the case. */
function shellFramesLeft(rig: Rig): number {
  const shell = rig.scene['combat'].spells['activeShell'];
  return shell?.framesRemaining ?? 0;
}

/**
 * Takes every mob but the bathroom's off the floor, so a rat wandering in and
 * dying under a stomp cannot read as a bathroom goblin paying out.
 */
function clearFloorOfOtherMobs(scene: Scene): void {
  const { mobs, grid } = scene['world'].roster;
  for (const mob of mobs.filter((candidate) => !(candidate instanceof BathroomGoblin))) {
    despawnMob(mob, mobs, grid);
  }
}

function verifyWeapons(rig: Rig, copy: BathroomCopy, label: string): void {
  const { scene, map } = rig;
  clearFloorOfOtherMobs(scene);
  const bathroom = scene.cloggedBathroom;
  const subjects: Array<{ name: string; goblin: Goblin }> = [];
  const goblins = bathroom.allGoblins();
  const queued = copy.line.find((slot) => standingTileBeside(map, slot.goblin, goblins) !== null);
  if (queued === undefined) {
    check(false, `${label}: no queue goblin has a floor tile beside him to be hit from`);
  } else {
    subjects.push({ name: 'a queue goblin', goblin: queued.goblin });
  }
  subjects.push({ name: 'the plumber', goblin: copy.plumber });
  if (fault === 'goblin-mortal') {
    for (const goblin of bathroom.allGoblins()) goblin.cannotBeKilled = false;
    Object.defineProperty(BathroomGoblin.prototype, 'isDamageImmune', { get: () => false });
  }

  for (const subject of subjects) {
    const stand = standingTileBeside(map, subject.goblin, goblins);
    if (stand === null) {
      check(false, `${label}: ${subject.name} has no floor tile beside him to be hit from`);
      continue;
    }
    for (const kind of DAMAGE_KINDS) {
      const name = `${label}: ${kind} on ${subject.name}`;
      tickPinned(scene, BETWEEN_BLOWS_FRAMES);
      const everyone = bathroom.allGoblins();
      const before = everyone.map(goblinState);
      const progressBefore = progressSnapshot(rig);
      const owBefore = subject.goblin.owBarks;
      throwBlow(rig, kind, subject.goblin, stand);
      const after = everyone.map(goblinState);
      const hurt = everyone.filter(
        (_goblin, index) =>
          after[index].hp !== before[index].hp ||
          after[index].alive !== before[index].alive ||
          after[index].statuses !== before[index].statuses ||
          after[index].credited !== before[index].credited,
      );
      check(
        hurt.length === 0,
        `${name}: ${hurt.length} bathroom goblin(s) hurt, killed or afflicted`,
      );
      const moved = everyone.filter(
        (_goblin, index) =>
          after[index].x !== before[index].x || after[index].y !== before[index].y,
      );
      check(moved.length === 0, `${name}: ${moved.length} goblin(s) pushed out of place`);
      const progressAfter = progressSnapshot(rig);
      check(
        progressAfter === progressBefore,
        `${name}: progress moved\n    before ${progressBefore}\n    after  ${progressAfter}`,
      );
      check(subject.goblin.owBarks > owBefore, `${name}: he said nothing`);
    }
  }
}

// ── Companions ─────────────────────────────────────────────────────────────

function verifyCompanions(rig: Rig, copy: BathroomCopy, label: string): void {
  const { scene, map } = rig;
  const head = copy.line[0]?.goblin ?? copy.plumber;
  const stand =
    standingTileBeside(map, head, scene.cloggedBathroom.allGoblins()) ??
    copy.room.pipeWallStandTile;
  for (const activeIsCat of [true, false]) {
    if (scene.pm.cat.isActive !== activeIsCat) scene.pm.switchActive();
    let picked = 0;
    placeAt(scene.pm.active(), stand);
    placeAt(scene.pm.inactive(), stand);
    for (let frame = 0; frame < COMPANION_WATCH_FRAMES; frame++) {
      scene.update();
      for (const crawler of scene.pm.players()) {
        if (crawler.autoTarget instanceof BathroomGoblin) picked++;
      }
      for (const crawler of scene.pm.players()) {
        crawler.hp = crawler.maxHp;
      }
    }
    const who = activeIsCat ? 'The human as companion' : 'The cat as companion';
    check(picked === 0, `${label}: ${who} targeted a bathroom goblin on ${picked} frame(s)`);
  }
}

// ── The fix ────────────────────────────────────────────────────────────────

/**
 * A pick lasts only for the board: the same difficulty keeps the board in
 * play, another deals a fresh one, Escape opens nothing, and the world
 * setting never moves.
 */
function verifyDifficultyPick(rig: Rig, copy: BathroomCopy, label: string): void {
  const bathroom = rig.scene.cloggedBathroom;
  const worldDifficulty = settings.difficulty;
  const otherDifficulty = DIFFICULTY_ORDER.find((tier) => tier !== worldDifficulty) ?? 'hard';
  const dealt = bathroom.generateBoardNow(worldDifficulty);

  bathroom.usePipeWall(copy);
  bathroom.difficultyGate.cancel();
  check(
    !bathroom.isPipeBoardOpen && !bathroom.isPipeBoardExplainerOpen,
    `${label}: backing out of the picker opens nothing`,
  );

  bathroom.usePipeWall(copy);
  bathroom.difficultyGate.choose(worldDifficulty);
  check(bathroom.pipeBoard === dealt, `${label}: picking the board's own difficulty keeps it`);
  bathroom.closePipeBoard();

  bathroom.usePipeWall(copy);
  bathroom.difficultyGate.choose(otherDifficulty);
  check(bathroom.pipeBoard !== dealt, `${label}: picking another difficulty deals a fresh board`);
  check(
    settings.difficulty === worldDifficulty,
    `${label}: a pick at the wall leaves the world difficulty alone`,
  );
  check(
    !bathroom.difficultyGate.isConfirmOpen,
    `${label}: switching away from an untouched board asks nothing`,
  );
  bathroom.closePipeBoard();
  verifyDiscardConfirm(bathroom, copy, otherDifficulty, label);
  bathroom.generateBoardNow(worldDifficulty);
}

/**
 * A board with turns on it is never thrown away by a pick alone: its tier is
 * marked in the picker, and a pick at another tier asks first, keeping the
 * board unless the player says to start over.
 */
function verifyDiscardConfirm(
  bathroom: Bathroom,
  copy: BathroomCopy,
  playedAt: Difficulty,
  label: string,
): void {
  const worldDifficulty = settings.difficulty;
  const played = bathroom.generateBoardNow(playedAt);
  const turnable = played.tiles.findIndex((tile) => !tile.decoy && !tile.bolted);
  bathroom.turnPipeTile(turnable, 'clockwise');
  const turnedTo = played.rotations[turnable];
  check(
    bathroom.boardInProgressDifficulty === playedAt,
    `${label}: a turned board is marked in progress at its own tier`,
  );

  bathroom.usePipeWall(copy);
  bathroom.difficultyGate.choose(worldDifficulty);
  check(
    bathroom.difficultyGate.isConfirmOpen && !bathroom.isPipeBoardOpen,
    `${label}: picking another tier over a turned board asks before starting over`,
  );
  check(bathroom.pipeBoard === played, `${label}: the board survives the question`);

  bathroom.difficultyGate.keep();
  check(
    bathroom.isPipeBoardOpen &&
      bathroom.pipeBoard === played &&
      played.rotations[turnable] === turnedTo,
    `${label}: keeping the board opens it with its turns`,
  );
  bathroom.closePipeBoard();

  bathroom.usePipeWall(copy);
  bathroom.difficultyGate.choose(worldDifficulty);
  bathroom.difficultyGate.back();
  check(
    bathroom.difficultyGate.isPickerOpen && bathroom.pipeBoard === played,
    `${label}: Escape on the question goes back to the picker with the board kept`,
  );

  bathroom.difficultyGate.choose(worldDifficulty);
  bathroom.difficultyGate.discard();
  check(
    bathroom.pipeBoard !== played && bathroom.boardInProgressDifficulty === null,
    `${label}: starting over deals a fresh board at the picked tier`,
  );
  bathroom.closePipeBoard();
}

/** Plays the board to its answer through the same turn call the board surface makes. */
function solveBoard(bathroom: Bathroom, copy: BathroomCopy, label: string): void {
  const board = bathroom.generateBoardNow(settings.difficulty);
  bathroom.usePipeWall(copy);
  bathroom.difficultyGate.choose(settings.difficulty);
  check(bathroom.isPipeBoardOpen, `${label}: the wall opens the board once the explainer is seen`);
  const answer = answerMasks(board);
  board.tiles.forEach((tile, cell) => {
    if (tile.decoy || tile.bolted) return;
    for (
      let turn = 0;
      turn < FULL_TURN_QUARTERS && currentMask(board, cell) !== answer[cell];
      turn++
    ) {
      bathroom.turnPipeTile(cell, 'clockwise');
    }
  });
  check(traceFlow(board).won, `${label}: the board's answer, turned in, wins`);
  bathroom.onPipeBoardSolved();
  bathroom.closePipeBoard();
}

function verifySolve(rig: Rig, copy: BathroomCopy, label: string): void {
  const { scene, map } = rig;
  const bathroom = scene.cloggedBathroom;
  const gateway = gatewayBounds(map);
  check(gateway !== null, `${label}: the floor has a gateway past the bathroom gauntlet`);
  const reachBefore = reachableTiles(map, map.startTile);
  check(
    gateway === null || !anyTileReachable(reachBefore, map.gridSize, gateway),
    `${label}: the gateway is reachable before the fix`,
  );
  solveBoard(bathroom, copy, label);
  check(bathroom.isSolved, `${label}: the win fixes the bathroom`);
  check(map.bathroomPlumbingState === 'fixed', `${label}: the win fixes the plumbing`);
  for (const other of bathroom.copies) {
    const stillBlocked = blockedTilesOf(other).filter((tile) => !map.isWalkable(tile.x, tile.y));
    check(
      stillBlocked.length === 0,
      `${label}: copy ${other.index} still has ${stillBlocked.length} blocked tile(s) after the fix`,
    );
  }
  const reachAfter = reachableTiles(map, map.startTile);
  check(
    gateway !== null && anyTileReachable(reachAfter, map.gridSize, gateway),
    `${label}: the gateway is unreachable after the fix`,
  );
  const savesBeforeFix = rig.saves.length;
  tickPinned(scene, AFTER_FIX_FRAMES);
  verifyFixedRoomSaves(rig, copy, savesBeforeFix, label);
}

/** The crawler fixed the pipes standing in the room, so the fixed room has saved them there. */
function verifyFixedRoomSaves(
  rig: Rig,
  copy: BathroomCopy,
  savesBeforeFix: number,
  label: string,
): void {
  const fixedRoomSaves = rig.saves.slice(savesBeforeFix);
  check(
    fixedRoomSaves.length === 1,
    `${label}: standing in the fixed room wrote ${fixedRoomSaves.length} save(s), not one`,
  );
  const saved = fixedRoomSaves[fixedRoomSaves.length - 1]?.world;
  check(
    saved?.persisted?.cloggedBathroom?.phase === 'solved',
    `${label}: the fixed room's save does not carry the fix`,
  );
  const resumeTile = saved?.resumeTile ?? null;
  const { bounds } = copy.room;
  const resumesInRoom =
    resumeTile !== null &&
    resumeTile.x >= bounds.x &&
    resumeTile.y >= bounds.y &&
    resumeTile.x < bounds.x + bounds.w &&
    resumeTile.y < bounds.y + bounds.h;
  check(resumesInRoom, `${label}: the fixed room's save resumes outside the room`);
}

// ── The stall ──────────────────────────────────────────────────────────────

function refreshedOf(crawler: Crawler): Array<{ ticksRemaining: number; totalTicks: number }> {
  return crawler.statusEffects.filter((effect) => effect.type === REFRESHED_STATUS);
}

/** Ticks left on the crawler's Refreshed, or -1 with none: rises only when a visit lands it. */
function refreshedTicks(crawler: Crawler): number {
  return Math.max(-1, ...refreshedOf(crawler).map((effect) => effect.ticksRemaining));
}

function approximately(a: number, b: number): boolean {
  return Math.abs(a - b) <= SPEED_TOLERANCE;
}

/** Plays one stall visit out, checking the crawler stays hidden and unharmed throughout. */
function playVisit(rig: Rig, copy: BathroomCopy, crawler: Crawler, label: string): void {
  const { scene, ctx } = rig;
  const bathroom = scene.cloggedBathroom;
  let rendered = 0;
  const render = crawler.render.bind(crawler);
  crawler.render = (...args) => {
    rendered++;
    render(...args);
  };
  check(
    bathroom.startStallVisit(crawler, copy, 0),
    `${label}: a free stall takes the crawler after the fix`,
  );
  let drawnWhileHidden = 0;
  let harmedFrames = 0;
  let notHiddenFrames = 0;
  let buffEarly = 0;
  const ticksAtStart = refreshedTicks(crawler);
  for (let frame = 1; frame < STALL_VISIT_FRAMES; frame++) {
    const hpBefore = crawler.hp;
    const landed = crawler.takeDamage(STALL_TEST_BLOW, { kind: 'mob', mobType: 'goblin' });
    if (landed || crawler.hp !== hpBefore) harmedFrames++;
    scene.update();
    if (frame >= STALL_ENTER_FRAMES) {
      if (!bathroom.isCrawlerHidden(crawler)) notHiddenFrames++;
      rendered = 0;
      scene.render(ctx);
      if (rendered > 0) drawnWhileHidden++;
    }
    if (refreshedTicks(crawler) > ticksAtStart && frame < STALL_VISIT_FRAMES - 1) buffEarly++;
  }
  check(
    harmedFrames === 0,
    `${label}: a blow landed on the crawler in the stall on ${harmedFrames} frame(s)`,
  );
  check(
    notHiddenFrames === 0,
    `${label}: the crawler was out of sight for too few frames (${notHiddenFrames} short)`,
  );
  check(
    drawnWhileHidden === 0,
    `${label}: the crawler was drawn on ${drawnWhileHidden} hidden frame(s)`,
  );
  check(buffEarly === 0, `${label}: Refreshed landed before the visit was over`);
  check(
    bathroom.isStallVisitActive,
    `${label}: the visit was over before ${STALL_VISIT_FRAMES} frames`,
  );
  scene.update();
  check(
    !bathroom.isStallVisitActive,
    `${label}: the visit is still going after ${STALL_VISIT_FRAMES} frames`,
  );
  check(!crawler.concealed, `${label}: the crawler is still concealed after the visit`);
  crawler.render = render;
}

function verifyStall(rig: Rig, copy: BathroomCopy, label: string): void {
  const { scene } = rig;
  const human = scene.pm.human;
  if (!human.isActive) scene.pm.switchActive();
  placeAt(human, copy.room.stallDoorTiles[0]);
  const baseSpeed = human.speedMultiplier;

  playVisit(rig, copy, human, `${label}: first visit`);
  const first = refreshedOf(human);
  check(first.length === 1, `${label}: one Refreshed after the first visit (${first.length})`);
  const firstTicks = first[0]?.ticksRemaining ?? 0;
  check(
    first[0]?.totalTicks === REFRESHED_DURATION_TICKS &&
      firstTicks <= REFRESHED_DURATION_TICKS &&
      firstTicks >= REFRESHED_DURATION_TICKS - 1,
    `${label}: Refreshed lands with ${REFRESHED_DURATION_TICKS} ticks (has ${firstTicks} of ${first[0]?.totalTicks ?? 0})`,
  );
  check(
    approximately(human.speedMultiplier, baseSpeed * REFRESHED_SPEED_FACTOR),
    `${label}: Refreshed walks at ${REFRESHED_SPEED_FACTOR}x (${human.speedMultiplier / baseSpeed}x)`,
  );

  tickPinned(scene, BETWEEN_VISITS_FRAMES);
  const beforeSecond = refreshedOf(human)[0]?.ticksRemaining ?? 0;
  playVisit(rig, copy, human, `${label}: second visit`);
  const second = refreshedOf(human);
  check(
    second.length === 1,
    `${label}: a second visit stacks Refreshed (${second.length} of them)`,
  );
  const secondTicks = second[0]?.ticksRemaining ?? 0;
  check(
    secondTicks > beforeSecond && secondTicks >= REFRESHED_DURATION_TICKS - 1,
    `${label}: a second visit does not renew Refreshed (${beforeSecond} -> ${secondTicks})`,
  );
  check(
    approximately(human.speedMultiplier, baseSpeed * REFRESHED_SPEED_FACTOR),
    `${label}: two visits walk at ${REFRESHED_SPEED_FACTOR}x, not more (${human.speedMultiplier / baseSpeed}x)`,
  );

  // The status runs out on the crawler's own timers, which every scene ticks once a frame.
  for (let tick = 0; tick < REFRESHED_DURATION_TICKS + EXPIRY_SLACK_TICKS; tick++) {
    human.tickTimers();
  }
  check(
    refreshedOf(human).length === 0,
    `${label}: Refreshed outlasts ${REFRESHED_DURATION_TICKS} ticks`,
  );
  check(
    approximately(human.speedMultiplier, baseSpeed),
    `${label}: the walking boon outlives Refreshed (${human.speedMultiplier / baseSpeed}x)`,
  );
}

// ── Checkpoints and saves ──────────────────────────────────────────────────

function verifyCheckpoint(rig: Rig, label: string): void {
  const { scene } = rig;
  const bathroom = scene.cloggedBathroom;
  const tile = tileOf(scene.pm.active());
  const checkpoint = scene['captureLevelCheckpoint'](tile);
  scene['restoreFromCheckpoint'](checkpoint);
  check(bathroom.isSolved, `${label}: a checkpoint taken after the fix restores it broken`);
  check(
    rig.map.bathroomPlumbingState === 'fixed',
    `${label}: a checkpoint restore breaks the pipes`,
  );
  check(bathroom.hasSeenExplainer, `${label}: a checkpoint restore forgets the explainer`);
}

function verifyDeathRewind(rig: Rig, copy: BathroomCopy, label: string): void {
  const { scene, map } = rig;
  const bathroom = scene.cloggedBathroom;
  const human = scene.pm.human;
  scene['respawnAfterDeath']();
  check(!bathroom.isSolved, `${label}: a death after an unsaved fix keeps the fix`);
  check(
    map.bathroomPlumbingState === 'broken',
    `${label}: a death after an unsaved fix leaves the pipes fixed`,
  );
  const open = blockedTilesOf(copy).filter((tile) => map.isWalkable(tile.x, tile.y));
  check(open.length === 0, `${label}: ${open.length} queue tile(s) open after the rewind`);
  const outOfLine = copy.line.filter((slot) => !slot.goblin.holdsPlace);
  check(
    outOfLine.length === 0,
    `${label}: ${outOfLine.length} goblin(s) out of line after the rewind`,
  );
  check(
    bathroom.hasSeenExplainer,
    `${label}: the rewind forgets an explainer seen before the save`,
  );
  check(refreshedOf(human).length === 0, `${label}: Refreshed survives a death rewind`);
}

function freshScene(progress: SavedProgress): Scene {
  const { levelDef, options } = sceneSetupFromSave({ skipIntro: true }, progress);
  return new DungeonScene(levelDef, new InputManager(), new SceneManager(), options);
}

function verifySaves(rig: Rig, copy: BathroomCopy, label: string): void {
  const { scene } = rig;
  const bathroom = scene.cloggedBathroom;
  solveBoard(bathroom, copy, `${label}: re-fix`);
  scene['captureSavePoint'](tileOf(scene.pm.active()));
  const written = rig.saves.pop();
  if (written === undefined) {
    check(false, `${label}: a save point wrote no save`);
    return;
  }
  const writtenWorld = written.world;
  const persistedOnDisk = parsePersistedWorldState(
    JSON.parse(JSON.stringify(writtenWorld?.persisted ?? null)),
  );
  if (writtenWorld === undefined || persistedOnDisk === undefined) {
    check(false, `${label}: the save carries no persisted world that parses back`);
    return;
  }
  const onDisk: SavedProgress = {
    ...written,
    world: { ...writtenWorld, persisted: persistedOnDisk },
  };

  const loaded = freshScene(onDisk);
  check(loaded.cloggedBathroom.isSolved, `${label}: a save written after the fix loads it broken`);
  check(loaded.cloggedBathroom.hasSeenExplainer, `${label}: a loaded save forgets the explainer`);
  const loadedFixed = loaded['gameMap'].bathroomPlumbingState === 'fixed';
  check(loadedFixed, `${label}: a loaded save has broken pipes under a fixed bathroom`);
  loaded.onExit();

  const { cloggedBathroom: _dropped, ...withoutBathroom } = persistedOnDisk;
  check(
    parsePersistedWorldState(withoutBathroom) === undefined,
    `${label}: a save without the bathroom passes validation`,
  );
}

// ── Run ────────────────────────────────────────────────────────────────────

for (const worldSeed of seeds) {
  const label = `seed ${worldSeed}`;
  const rig = await buildRig(worldSeed);
  if (rig === null) continue;
  const bathroom = rig.scene.cloggedBathroom;
  check(bathroom.copies.length > 0, `${label}: floor 2 has a bathroom`);
  if (bathroom.copies.length === 0) continue;
  const copy = bathroom.copies[0];
  check(!bathroom.isSolved, `${label}: the bathroom starts broken`);

  verifyClock(rig, copy, label);
  verifyWeapons(rig, copy, label);
  verifyCompanions(rig, copy, label);
  // The save the death below comes back to: explainer seen, pipes still broken.
  rig.scene['captureSavePoint'](copy.room.pipeWallStandTile);
  const saveBeforeFix = rig.scene['lastSave'];
  verifySolve(rig, copy, label);
  verifyCheckpoint(rig, label);
  verifyStall(rig, copy, label);
  // Stands in for a fix whose room save was refused (a hostile at the
  // crawler's heel), so the death comes back to the save before the fix.
  rig.scene['lastSave'] = saveBeforeFix;
  verifyDeathRewind(rig, copy, label);
  verifySaves(rig, copy, label);
  rig.scene.onExit();
  console.log(`${label}: done`);
}

const faultNote = fault === null ? '' : ` (fault: ${fault})`;
console.log(
  failures === 0
    ? `\nAll ${checks} clogged-bathroom play checks passed${faultNote}.`
    : `\n${failures} of ${checks} check(s) failed${faultNote}.`,
);
process.exit(failures === 0 ? 0 : 1);
