#!/usr/bin/env tsx
/**
 * The walk-away and hand-off rules as the real `DungeonScene` routes them,
 * driven headless through the same window and canvas listeners a browser
 * delivers keys and touches to.
 *
 *   - Reading a citizen's lines a step outside their talk range, with the
 *     hireling at the party's shoulder, a Space press turns the citizen's page:
 *     it is never handed to the hireling, which would dismiss the box mid-read.
 *     A control press with no box up proves the hireling does answer from
 *     there, so the check cannot pass on a hireling that was out of reach.
 *   - Taps on the citizen's box page through it and close it, without the
 *     same tap reopening it.
 *   - With the doctor's box open, a finger on the floor becomes a move touch —
 *     tap-to-move is the only way a phone player can walk away — and a tap on
 *     Dave, from beside him and still inside the doctor's walk-away range,
 *     hands the press on and opens him.
 *   - While a cutscene owns the party, a held direction key and the interact
 *     press do nothing: the walk-up ends on its own tile, facing its way, and
 *     no one nearby answers. The pause key opens and closes the pause menu
 *     mid-walk and mid-talk, the walk holding still under it and the talk
 *     surviving it. The world halts for the talk; the cutscene runs to its end
 *     (Caroline's message, the guide teleporting out, a wait) and then hands
 *     the keys back.
 *
 * Run: npm run verify:walk-away (after `verify-walk-away.ts`)
 */

import { installBrowserShim, RecordingEventTarget, ShimEvent } from './browserShim.js';

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
const { level3 } = await import('../src/levels/level3.js');
const { Conversation } = await import('../src/dialog/Conversation.js');
const { walkAwayRangeTiles } = await import('../src/dialog/walkAway.js');
const { EventBus } = await import('../src/core/EventBus.js');
const { createMercenaryRoster } = await import('../src/core/party/MercenaryRoster.js');
const { MercenarySystem } = await import('../src/systems/MercenarySystem.js');
const { TownLifeSystem } = await import('../src/systems/TownLifeSystem.js');
const { DoctorSystem, DOCTOR_TALK_DISTANCE_TILES } = await import('../src/systems/DoctorSystem.js');
const { SafeRoomSystem } = await import('../src/systems/SafeRoomSystem.js');
const { DaveGuideSystem, DaveWhereabouts } = await import('../src/systems/DaveGuideSystem.js');
const { safeRoomIdIn } = await import('../src/map/safeRoomId.js');
const { TouchMoveState } = await import('../src/core/input/TouchMoveState.js');
const { safeRoomSpeakerFor } = await import('../src/systems/safeRoomSpeaker.js');
const { stampSafeRoomClinics } = await import('../src/map/safeRoomClinicLayout.js');
const { CITIZEN_TALK_RADIUS_TILES } = await import('../src/creatures/townInteraction.js');
const { CutsceneKit } = await import('../src/systems/kits/CutsceneKit.js');
const { MenusKit } = await import('../src/systems/kits/MenusKit.js');
const { walkUpTo } = await import('../src/systems/cutscene/walkUp.js');
const { WALK_UP_MAX_PATH_TILES } = await import('../src/systems/cutscene/CutsceneDirector.js');
const { carolineLines } = await import('../src/dialog/caroline.js');
const { pixelToTile } = await import('../src/utils.js');
const { useDevPlayerIdentity } = await import('../src/dev/devPlayerIdentity.js');
useDevPlayerIdentity();

type Scene = InstanceType<typeof DungeonScene>;
type Point = { readonly x: number; readonly y: number };

/** Where the player stands from the citizen they are reading: out of talk range, well inside walk-away. */
const CITIZEN_DRIFT_TILES = 1.5;
/** Where the hireling stands from the player: inside its own talk range, as it does at the party's shoulder. */
const HIRELING_SHOULDER_TILES = 0.8;
/** Frames ticked after arrival so the hireling spawns and the crowd settles. */
const SETTLE_FRAMES = 30;
/** More frames than the town's arrival screen ever needs to finish its work. */
const MAX_ARRIVAL_FRAMES = 3000;
/** Directions tried when stepping the player off a citizen, so one of them lands clear of the crowd. */
const DRIFT_DIRECTIONS = 16;
/** More taps than any citizen's line has pages; a box that is still up after this was reopened. */
const MAX_BOX_TAPS = 12;
/** Seeds whose first floor is searched for a safe room laid out like the one under test. */
const SAFE_ROOM_SEEDS = [7, 7919, 15838, 23757, 31676, 39595, 47514, 55433];
/** A screen point well clear of the dialog box, the hotbar and the HUD: open floor. */
const FLOOR_TAP = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 4 } as const;

let failures = 0;
function check(ok: boolean, message: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${message}`);
  if (!ok) failures++;
}

await loadSprites('src/images/');

/**
 * One manager for every section, as the page has one: each section's scene
 * replaces the last, so a scene left behind never sees the next section's
 * keys. A manager per section would keep its window listeners and its exited
 * scene, whose open boxes would go on swallowing presses.
 */
const sceneManager = new SceneManager();

// ── Driving the scene the way a browser does ─────────────────────────────

let clockMs = 0;
let nextTouchId = 1;

function pressSpace(): void {
  pressKey(' ');
}

function pressKey(key: string): void {
  holdKey(key);
  releaseKey(key);
}

function holdKey(key: string): void {
  clockMs += 1;
  shim.window.dispatch(new ShimEvent('keydown', key, clockMs));
}

function releaseKey(key: string): void {
  clockMs += 1;
  shim.window.dispatch(new ShimEvent('keyup', key, clockMs));
}

function canvasEvents(sceneManager: InstanceType<typeof SceneManager>): RecordingEventTarget {
  const events: unknown = Reflect.get(sceneManager.canvas, 'events');
  if (!(events instanceof RecordingEventTarget))
    throw new Error('the shim canvas records no events');
  return events;
}

/** Puts a finger down at `at`. Returns its identifier, for lifting it again. */
function touchDown(events: RecordingEventTarget, at: Point): number {
  const identifier = nextTouchId++;
  clockMs += 1;
  const finger = [{ identifier, clientX: at.x, clientY: at.y }];
  events.dispatch(new ShimEvent('touchstart', '', clockMs, at, finger));
  return identifier;
}

function touchUp(events: RecordingEventTarget, identifier: number, at: Point): void {
  clockMs += 1;
  const finger = [{ identifier, clientX: at.x, clientY: at.y }];
  events.dispatch(new ShimEvent('touchend', '', clockMs, at, finger));
}

/** A quick tap: down and up on the same spot, well inside the tap window. */
function tap(events: RecordingEventTarget, at: Point): void {
  touchUp(events, touchDown(events, at), at);
}

/** A private collaborator of the scene, checked against the class it must be. */
function sceneField<T>(scene: Scene, name: string, type: abstract new (...args: never[]) => T): T {
  const value: unknown = Reflect.get(scene, name);
  if (!(value instanceof type)) throw new Error(`the scene's ${name} is not a ${type.name}`);
  return value;
}

function sceneCamera(scene: Scene): Point {
  const camera: unknown = Reflect.get(scene, 'camera');
  if (typeof camera !== 'function') throw new Error('the scene has no camera');
  const result: unknown = Reflect.apply(camera, scene, []);
  if (typeof result !== 'object' || result === null) throw new Error('the camera gave no position');
  const x: unknown = Reflect.get(result, 'x');
  const y: unknown = Reflect.get(result, 'y');
  if (typeof x !== 'number' || typeof y !== 'number')
    throw new Error('the camera gave no position');
  return { x, y };
}

function tilesApart(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y) / TILE_SIZE;
}

/**
 * Draws one frame of the scene, which lays the box out (so `hitsSurface`
 * knows where it is drawn) and leaves the scene's surface stack holding the
 * regions the next touch is tested against.
 */
function drawFrame(sceneManager: InstanceType<typeof SceneManager>, scene: Scene): void {
  const ctx = sceneManager.canvas.getContext('2d');
  if (ctx === null) throw new Error('the shim canvas has no 2d context');
  scene.render(ctx);
}

/**
 * Draws frames until the arrival's loading screen has done its work: the
 * scene ignores every key, touch and update beneath it. Yields between frames
 * so the sheet fetches it waits on can resolve.
 */
async function settleArrival(
  sceneManager: InstanceType<typeof SceneManager>,
  scene: Scene,
): Promise<boolean> {
  const ctx = sceneManager.canvas.getContext('2d');
  if (ctx === null) throw new Error('the shim canvas has no 2d context');
  for (let frame = 0; frame < MAX_ARRIVAL_FRAMES; frame++) {
    if (!scene.arrivalLoadingOpen) return true;
    scene.render(ctx);
    await new Promise((resolve) => setImmediate(resolve));
  }
  return false;
}

/**
 * The middle of the conversation's box, where a tap plainly lands on it: an
 * edge pixel can sit on the box for its own hit test yet outside the region
 * the scene's surface stack registered for it.
 */
function pointOnBox(conversation: InstanceType<typeof Conversation>): Point | null {
  const box = conversation.hitRects()[0];
  if (box === undefined) return null;
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

// ── A citizen's box, with the hireling at the party's shoulder ───────────

/**
 * A citizen the player can walk up to and then drift off from, with nobody
 * else to answer where they drift to: otherwise the press is someone else's.
 */
function findDriftSetup(
  townLife: InstanceType<typeof TownLifeSystem>,
  map: InstanceType<typeof GameMap>,
): { citizen: Point; talkFrom: Point; drift: Point } | null {
  for (const citizen of townLife.people) {
    const talkFrom = { x: citizen.x + TILE_SIZE, y: citizen.y };
    if (townLife.findTalkTarget(talkFrom.x, talkFrom.y) !== citizen) continue;
    for (let step = 0; step < DRIFT_DIRECTIONS; step++) {
      const angle = (step / DRIFT_DIRECTIONS) * Math.PI * 2;
      const drift = {
        x: citizen.x + Math.cos(angle) * CITIZEN_DRIFT_TILES * TILE_SIZE,
        y: citizen.y + Math.sin(angle) * CITIZEN_DRIFT_TILES * TILE_SIZE,
      };
      const driftTileWalkable = map.isWalkable(
        Math.floor(drift.x / TILE_SIZE),
        Math.floor(drift.y / TILE_SIZE),
        'walker',
      );
      if (driftTileWalkable && townLife.findTalkTarget(drift.x, drift.y) === null) {
        return { citizen, talkFrom, drift };
      }
    }
  }
  return null;
}

async function verifyCitizenWithHireling(): Promise<void> {
  console.log('\nreading a citizen with the hireling at your shoulder');
  const map = new GameMap({
    mapSize: level3.mapSize,
    tileHeight: TILE_SIZE,
    mapType: 'overworld',
    worldSeed: WORLD_SEED,
  });
  const mercenaryRoster = createMercenaryRoster();
  mercenaryRoster.active = {
    id: 'crush',
    name: 'Crush',
    terms: 'paid',
    contractLevelId: level3.id,
    introduced: true,
  };
  const scene = new DungeonScene(level3, new InputManager(), sceneManager, {
    existingMap: map,
    worldSeed: WORLD_SEED,
    skipIntro: true,
    mercenaryRoster,
  });
  sceneManager.replace(scene);
  check(await settleArrival(sceneManager, scene), "the town's arrival screen finishes");
  for (let frame = 0; frame < SETTLE_FRAMES; frame++) scene.update();

  const conversation = sceneField(scene, 'conversation', Conversation);
  const townLife = sceneField(scene, 'townLife', TownLifeSystem);
  const mercenarySystem = sceneField(scene, 'mercenarySystem', MercenarySystem);
  const merc = mercenarySystem.activeMerc;
  check(merc !== null, 'the hireling stands in town');
  if (merc === null) return;
  let hirelingTalks = 0;
  const talkTo = merc.talkTo.bind(merc);
  merc.talkTo = (player) => {
    hirelingTalks++;
    talkTo(player);
  };

  const active = scene.pm.active();
  const citizenDialogTarget = (): unknown => Reflect.get(scene, 'citizenDialogTarget');

  const setup = findDriftSetup(townLife, map);
  check(setup !== null, 'a citizen stands clear enough to drift off from');
  if (setup === null) return;
  const { citizen, talkFrom, drift } = setup;

  active.x = talkFrom.x;
  active.y = talkFrom.y;
  pressSpace();
  check(
    conversation.isOpen && citizenDialogTarget() === citizen,
    "Space beside a citizen opens the citizen's box",
  );

  active.x = drift.x;
  active.y = drift.y;
  const awayX = drift.x - citizen.x;
  const awayY = drift.y - citizen.y;
  const awayLength = Math.hypot(awayX, awayY);
  merc.x = drift.x + (awayX / awayLength) * HIRELING_SHOULDER_TILES * TILE_SIZE;
  merc.y = drift.y + (awayY / awayLength) * HIRELING_SHOULDER_TILES * TILE_SIZE;
  const driftTiles = tilesApart(active, citizen);
  check(
    driftTiles > CITIZEN_TALK_RADIUS_TILES &&
      driftTiles < walkAwayRangeTiles(CITIZEN_TALK_RADIUS_TILES),
    `the player stands out of the citizen's talk range but inside walk-away (${driftTiles.toFixed(2)} tiles)`,
  );
  check(
    mercenarySystem.talkTarget(active, []) === merc,
    'the hireling is inside its own talk range of the player',
  );

  const talksBefore = hirelingTalks;
  pressSpace();
  check(
    conversation.isOpen && citizenDialogTarget() === citizen,
    "the press turns the citizen's page instead of dismissing the box",
  );
  check(hirelingTalks === talksBefore, 'the press is never handed to the hireling');

  // Taps on the box page through it to the end and close it, and the tap
  // that closes it does not reopen it — the player is still in range.
  active.x = talkFrom.x;
  active.y = talkFrom.y;
  const events = canvasEvents(sceneManager);
  let taps = 0;
  let missedTheBox = false;
  while (conversation.isOpen && taps < MAX_BOX_TAPS) {
    drawFrame(sceneManager, scene);
    const onBox = pointOnBox(conversation);
    if (onBox === null) {
      missedTheBox = true;
      break;
    }
    tap(events, onBox);
    taps++;
  }
  check(!missedTheBox, "the citizen's box is drawn somewhere a finger can tap it");
  check(
    !conversation.isOpen && citizenDialogTarget() === null,
    `taps on the citizen's box page through and close it without reopening it (${taps} taps)`,
  );

  // The control: with no box up, the same press from the same spot is the
  // hireling's. Without it, the check above would pass on a hireling that
  // could not have been reached anyway.
  active.x = drift.x;
  active.y = drift.y;
  pressSpace();
  check(hirelingTalks > talksBefore, 'with no box up, the same press talks to the hireling');
}

// ── The doctor's box on a phone ───────────────────────────────────────────

interface SafeRoomSetup {
  readonly seed: number;
  readonly map: InstanceType<typeof GameMap>;
  /**
   * Where the player talks to the doctor from: in reach of them, so a walk-up
   * to Dave can start from there.
   */
  readonly talkFrom: Point;
  /** Beside Dave, where a press is his, still inside the doctor's walk-away range. */
  readonly besideDave: Point;
  readonly daveHome: Point;
}

function pixels(tile: Point): Point {
  return { x: tile.x * TILE_SIZE, y: tile.y * TILE_SIZE };
}

function floorOneMap(seed: number): InstanceType<typeof GameMap> {
  return new GameMap({
    mapSize: level1.mapSize,
    tileHeight: TILE_SIZE,
    mapType: 'dungeon',
    dungeon: dungeonOptionsForLevel(level1),
    worldSeed: seed,
  });
}

/**
 * A safe room where the tile beside Dave is still inside the doctor's
 * walk-away range, so their box is legitimately up when the player gets there
 * and the tap has to hand the press on to reach him.
 */
function findSafeRoomSetup(): SafeRoomSetup | null {
  for (const seed of SAFE_ROOM_SEEDS) {
    const probe = floorOneMap(seed);
    const layouts = stampSafeRoomClinics(probe);
    const scope = { kind: 'floor', level: level1.id } as const;
    const doctor = new DoctorSystem(layouts, scope, new EventBus(), new Conversation(null), false);
    const safeRooms = new SafeRoomSystem(probe, scope);
    for (const layout of layouts) {
      const bounds = layout.roomBounds;
      const roomId = safeRoomIdIn(scope, layout.safeRoomIndex);
      const daveHome = safeRooms.guidePlacement(roomId)?.home;
      if (daveHome === undefined) continue;
      const dave = new DaveGuideSystem(
        {
          safeRooms,
          conversation: new Conversation(null),
          whereabouts: new DaveWhereabouts(),
          camera: () => ({ x: 0, y: 0 }),
          audio: null,
        },
        roomId,
      );
      const tiles: Point[] = [];
      for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
        for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
          if (probe.isWalkable(x, y, 'walker')) tiles.push({ x, y });
        }
      }
      const doctorHome = pixels(layout.doctorTile);
      const daveTalkSpot = walkUpTo(probe, daveHome, daveHome).tile;
      const reachesDave = (tile: Point): boolean =>
        probe.findPath(
          tile.x,
          tile.y,
          daveTalkSpot.x,
          daveTalkSpot.y,
          'walker',
          WALK_UP_MAX_PATH_TILES,
        ).length > 0;
      const talkFrom = tiles
        .filter(reachesDave)
        .map(pixels)
        .filter((at) => safeRoomSpeakerFor(doctor, null, at) === 'doctor')
        .sort((a, b) => tilesApart(a, doctorHome) - tilesApart(b, doctorHome))[0];
      const besideDave = tiles
        .filter((tile) => Math.hypot(tile.x - daveHome.x, tile.y - daveHome.y) === 1)
        .map(pixels)
        .filter((at) => safeRoomSpeakerFor(doctor, dave, at) === 'dave')
        .find((at) => tilesApart(at, doctorHome) < walkAwayRangeTiles(DOCTOR_TALK_DISTANCE_TILES));
      if (talkFrom !== undefined && besideDave !== undefined) {
        return { seed, map: floorOneMap(seed), talkFrom, besideDave, daveHome };
      }
    }
  }
  return null;
}

async function verifyDoctorOnAPhone(): Promise<void> {
  console.log("\nthe doctor's box on a phone");
  const setup = findSafeRoomSetup();
  check(setup !== null, 'a safe room puts Dave inside the doctor walk-away range');
  if (setup === null) return;

  const scene = new DungeonScene(level1, new InputManager(), sceneManager, {
    existingMap: setup.map,
    worldSeed: setup.seed,
    // Inside the room, so Dave is standing in it from the first frame as on a
    // reload there, rather than teleporting in partway through the checks.
    spawnAt: { x: pixelToTile(setup.talkFrom.x), y: pixelToTile(setup.talkFrom.y) },
    skipIntro: true,
  });
  sceneManager.replace(scene);
  check(await settleArrival(sceneManager, scene), "floor 1's arrival screen finishes");
  scene.update();

  const doctor = sceneField(scene, 'doctor', DoctorSystem);
  const dave = sceneField(scene, 'dave', DaveGuideSystem);
  const touch = sceneField(scene, 'touch', TouchMoveState);
  const events = canvasEvents(sceneManager);
  const active = scene.pm.active();
  const inactive = scene.pm.partnerAnywhere();
  const standAt = (at: Point): void => {
    active.x = at.x;
    active.y = at.y;
    inactive.x = at.x;
    inactive.y = at.y;
  };

  standAt(setup.talkFrom);
  check(
    doctor.tryInteract(active) && doctor.isDialogOpen,
    "the doctor's box opens beside the doctor",
  );

  const floorFinger = touchDown(events, FLOOR_TAP);
  check(
    touch.moveTouchId === floorFinger && touch.moveTarget !== null,
    "with the doctor's box open, a finger on the floor becomes a move touch",
  );
  touchUp(events, floorFinger, FLOOR_TAP);
  check(doctor.isDialogOpen, "a tap on the floor beside the doctor leaves the doctor's box up");

  standAt(setup.besideDave);
  scene.update();
  check(
    doctor.isDialogOpen,
    "the doctor's box is still up beside Dave, inside the doctor's walk-away range",
  );
  const camera = sceneCamera(scene);
  const onDave = {
    x: setup.daveHome.x * TILE_SIZE + TILE_SIZE / 2 - camera.x,
    y: setup.daveHome.y * TILE_SIZE + TILE_SIZE / 2 - camera.y,
  };
  const conversation = sceneField(scene, 'conversation', Conversation);
  drawFrame(sceneManager, scene);
  check(!conversation.hitsSurface(onDave.x, onDave.y), 'Dave is not drawn under the box');
  tap(events, onDave);
  check(dave.dialogOpen && !doctor.isDialogOpen, 'a tap on Dave hands the press on and opens him');
}

// ── A cutscene owns the party ────────────────────────────────────────────

/** More world ticks than the walk across a safe room takes, short of its own timeout. */
const MAX_WALK_TICKS = 600;
/** Ticks run under the pause menu or a talk, to see that nothing moves. */
const HELD_TICKS = 20;
/** More presses than the talk has pages, reveals included. */
const MAX_READ_PRESSES = 20;
/** The ticks the closing wait holds the cutscene for. */
const CLOSING_WAIT_FRAMES = 3;
/** How near its tile, as a share of a tile, the walk-up has to end: the steering lets go within a quarter. */
const STAND_TOLERANCE_TILE_FRACTION = 0.25;
const STAND_TOLERANCE_PX = TILE_SIZE * STAND_TOLERANCE_TILE_FRACTION;
/** The key held throughout the walk, whatever way the walk goes. */
const HELD_DIRECTION_KEY = 'ArrowLeft';
const FACING_VECTORS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
} as const;

async function verifyCutsceneOwnsTheParty(): Promise<void> {
  console.log('\na cutscene owns the party');
  const setup = findSafeRoomSetup();
  check(setup !== null, 'a floor-one safe room to play the cutscene in');
  if (setup === null) return;

  const scene = new DungeonScene(level1, new InputManager(), sceneManager, {
    existingMap: setup.map,
    worldSeed: setup.seed,
    // Inside the room, so Dave is standing in it from the first frame as on a
    // reload there, rather than teleporting in partway through the checks.
    spawnAt: { x: pixelToTile(setup.talkFrom.x), y: pixelToTile(setup.talkFrom.y) },
    skipIntro: true,
  });
  sceneManager.replace(scene);
  check(await settleArrival(sceneManager, scene), "floor 1's arrival screen finishes");
  scene.update();

  const cutscenes = sceneField(scene, 'cutscenes', CutsceneKit);
  const conversation = sceneField(scene, 'conversation', Conversation);
  const dave = sceneField(scene, 'dave', DaveGuideSystem);
  const doctor = sceneField(scene, 'doctor', DoctorSystem);
  const pause = sceneField(scene, 'menus', MenusKit).pauseScreen;
  const active = scene.pm.active();
  active.x = setup.talkFrom.x;
  active.y = setup.talkFrom.y;
  scene.pm.partnerAnywhere().x = setup.talkFrom.x;
  scene.pm.partnerAnywhere().y = setup.talkFrom.y;

  const walk = walkUpTo(setup.map, setup.daveHome, {
    x: pixelToTile(active.x),
    y: pixelToTile(active.y),
  });
  const standAt = pixels(walk.tile);
  const distanceToStand = (): number => Math.hypot(active.x - standAt.x, active.y - standAt.y);
  const outcome = { completed: false };
  cutscenes.director.play(
    [
      walk,
      {
        kind: 'conversation',
        request: {
          lines: [carolineLines.message('Hold still while I talk at you.').line],
          reward: null,
          questRelated: false,
        },
      },
      {
        kind: 'carolineMessage',
        message: carolineLines.message('That is all.'),
        world: 'runs',
      },
      { kind: 'daveTeleportOut' },
      { kind: 'wait', frames: CLOSING_WAIT_FRAMES },
    ],
    () => {
      outcome.completed = true;
    },
  );
  check(cutscenes.isActive && scene.ui.keyboardLocked(), 'the cutscene takes the keyboard');

  holdKey(HELD_DIRECTION_KEY);
  scene.update();
  pressSpace();
  scene.update();
  check(
    !conversation.isOpen && !doctor.isDialogOpen && !dave.dialogOpen,
    'mid-walk, the interact press reaches no one',
  );

  pressKey('Escape');
  check(pause.isOpen, 'the pause key opens the pause menu mid-walk');
  const pausedAt = { x: active.x, y: active.y };
  for (let tick = 0; tick < HELD_TICKS; tick++) scene.update();
  check(
    active.x === pausedAt.x && active.y === pausedAt.y,
    'the walk holds still under the pause menu',
  );
  pressKey('Escape');
  check(!pause.isOpen && cutscenes.isActive, 'and closes it again, the cutscene still running');

  let walkTicks = 0;
  while (!conversation.isOpen && walkTicks < MAX_WALK_TICKS) {
    scene.update();
    walkTicks++;
  }
  check(conversation.isOpen, `the talk opens once the walk-up ends (${walkTicks} ticks)`);
  check(
    distanceToStand() <= STAND_TOLERANCE_PX,
    `the walk-up ends on its own tile, the held key ignored (${distanceToStand().toFixed(1)} px off)`,
  );
  const facing = FACING_VECTORS[walk.face];
  check(
    active.facingX === facing.x && active.facingY === facing.y,
    `the crawler turns ${walk.face}, to face the way the walk-up says`,
  );
  check(dave.isNear(active), 'Dave stands within talk range of the talk');

  const talkingAt = { x: active.x, y: active.y };
  for (let tick = 0; tick < HELD_TICKS; tick++) scene.update();
  check(
    scene.ui.worldHalted() && active.x === talkingAt.x && active.y === talkingAt.y,
    'the world halts for the talk',
  );
  pressKey('Escape');
  check(pause.isOpen, 'the pause key opens the pause menu mid-talk');
  pressKey('Escape');
  check(!pause.isOpen && conversation.isOpen, 'and closing it hands the talk back where it was');
  releaseKey(HELD_DIRECTION_KEY);

  let presses = 0;
  while (cutscenes.isActive && presses < MAX_READ_PRESSES) {
    pressSpace();
    for (let tick = 0; tick <= CLOSING_WAIT_FRAMES; tick++) scene.update();
    presses++;
  }
  check(
    outcome.completed && !cutscenes.isActive && !conversation.isOpen,
    `reading on runs the cutscene to its end (${presses} presses)`,
  );
  check(
    !dave.isNear(standAt) && !dave.isPresent,
    'Dave has teleported out: nobody is left to talk to',
  );
  check(!scene.ui.keyboardLocked(), "and the keyboard is the player's again");

  holdKey(HELD_DIRECTION_KEY);
  scene.update();
  const walksAgain = active.isMoving;
  releaseKey(HELD_DIRECTION_KEY);
  check(walksAgain, 'a direction key walks the crawler once the cutscene is over');

  scene.onExit();
}

await verifyCitizenWithHireling();
await verifyDoctorOnAPhone();
await verifyCutsceneOwnsTheParty();

console.log(
  failures === 0 ? '\nall scene walk-away checks passed' : `\n${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
