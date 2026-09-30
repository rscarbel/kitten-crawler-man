#!/usr/bin/env tsx
/**
 * The interact key in Briar Hollow's paddock, as the real `DungeonScene`
 * routes it, driven headless through the same window and canvas listeners a
 * browser delivers keys and touches to. Every way a press reaches the world
 * must ask the village before it swings:
 *
 *   - Space beside a cow, nothing hostile near: the cow is petted and nothing
 *     is swung at. With a hostile in the attack range the press is the
 *     swing, and no cow is petted.
 *   - Space while a street box the player has stepped out of talk range of is
 *     up (the walk-away hand-off): beside a cow the press pets it and
 *     dismisses the box, never swinging. With a hostile in range it is not
 *     handed to the world at all: it turns the box's page, and nothing is
 *     petted or swung at.
 *   - A tap on a cow in reach, nothing hostile near: the cow is petted and
 *     nothing is swung at.
 *
 * Run: npm run verify:cows (after `verify-cows.ts`)
 */

import { installBrowserShim, RecordingEventTarget, ShimEvent } from './browserShim.js';

const VIEWPORT = { width: 1280, height: 720, devicePixelRatio: 1 } as const;
const shim = installBrowserShim(VIEWPORT);

const RNG_SEED = 1;
const { mulberry32 } = await import('../src/sprites/person/rng.js');
Math.random = mulberry32(RNG_SEED);

const { TILE_SIZE } = await import('../src/core/constants.js');
const { loadSprites } = await import('../src/core/SpriteLoader.js');
const { SceneManager } = await import('../src/core/Scene.js');
const { InputManager } = await import('../src/core/InputManager.js');
const { EventBus } = await import('../src/core/EventBus.js');
const { DungeonScene } = await import('../src/scenes/DungeonScene.js');
const { GameMap } = await import('../src/map/GameMap.js');
const { level3 } = await import('../src/levels/level3.js');
const { Conversation } = await import('../src/dialog/Conversation.js');
const { speakerLines } = await import('../src/dialog/line.js');
const { walkAwayRangeTiles } = await import('../src/dialog/walkAway.js');
const { BriarHollowKit } = await import('../src/systems/briarHollow/BriarHollowKit.js');
const { MobRoster } = await import('../src/systems/kits/SceneWorld.js');
const { createMob } = await import('../src/levels/spawner.js');
const { LoadingOverlay } = await import('../src/ui/LoadingScreen.js');

type Scene = InstanceType<typeof DungeonScene>;
type Point = { readonly x: number; readonly y: number };
type ConversationRequest = Parameters<InstanceType<typeof Conversation>['open']>[0];

/** World seeds searched, in order, for an overworld with Briar Hollow on it. */
const CANDIDATE_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
/** More frames than the town's arrival screen ever needs to finish its work. */
const MAX_ARRIVAL_FRAMES = 3000;
/** Frames ticked after arrival so the herd and the village settle. */
const SETTLE_FRAMES = 30;
/** How far beside a cow the crawler stands to press: well inside petting reach. */
const BESIDE_COW_TILES = 1;
/**
 * The sides of a cow the crawler may stand on, in the order tried. Penned cows
 * graze a tile or two apart, so on some sides a neighbour is as near as the
 * cow itself and a press would pet the neighbour instead.
 */
const SIDES_OF_A_COW: readonly Point[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];
/**
 * The street box's speaker stands this far from the crawler, with a talk range
 * of `STREET_BOX_TALK_RANGE_TILES`: out of talk range, inside walk-away, so
 * the press may be handed to the world.
 */
const STREET_BOX_SPEAKER_TILES = 1.5;
const STREET_BOX_TALK_RANGE_TILES = 1;
/** Where the hostile is set down, from the crawler's tile: inside any crawler's attack range. */
const HOSTILE_OFFSET_TILES = 1;
const HALF = 0.5;

let failures = 0;
function check(ok: boolean, message: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${message}`);
  if (!ok) failures++;
}

await loadSprites('src/images/');

let clockMs = 0;
let nextTouchId = 1;

function pressSpace(): void {
  clockMs += 1;
  shim.window.dispatch(new ShimEvent('keydown', ' ', clockMs));
  shim.window.dispatch(new ShimEvent('keyup', ' ', clockMs));
}

function canvasEvents(sceneManager: InstanceType<typeof SceneManager>): RecordingEventTarget {
  const events: unknown = Reflect.get(sceneManager.canvas, 'events');
  if (!(events instanceof RecordingEventTarget))
    throw new Error('the shim canvas records no events');
  return events;
}

function tap(events: RecordingEventTarget, at: Point): void {
  const identifier = nextTouchId++;
  const finger = [{ identifier, clientX: at.x, clientY: at.y }];
  clockMs += 1;
  events.dispatch(new ShimEvent('touchstart', '', clockMs, at, finger));
  clockMs += 1;
  events.dispatch(new ShimEvent('touchend', '', clockMs, at, finger));
}

/** A private collaborator of the scene, checked against the class it must be. */
function sceneField<T>(scene: Scene, name: string, type: abstract new (...args: never[]) => T): T {
  const value: unknown = Reflect.get(scene, name);
  if (!(value instanceof type)) throw new Error(`the scene's ${name} is not a ${type.name}`);
  return value;
}

function sceneRoster(scene: Scene): InstanceType<typeof MobRoster> {
  const world: unknown = Reflect.get(scene, 'world');
  if (typeof world !== 'object' || world === null) throw new Error('the scene has no world');
  const roster: unknown = Reflect.get(world, 'roster');
  if (!(roster instanceof MobRoster)) throw new Error("the scene's world has no roster");
  return roster;
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
    const loading: unknown = Reflect.get(scene, 'arrivalLoading');
    if (!(loading instanceof LoadingOverlay) || !loading.isOpen) return true;
    scene.render(ctx);
    await new Promise((resolve) => setImmediate(resolve));
  }
  return false;
}

function briarHollowMap(): { seed: number; map: InstanceType<typeof GameMap> } | null {
  for (const seed of CANDIDATE_SEEDS) {
    const map = new GameMap({
      mapSize: level3.mapSize,
      tileHeight: TILE_SIZE,
      mapType: 'overworld',
      worldSeed: seed,
    });
    if (map.briarHollow !== null) return { seed, map };
  }
  return null;
}

const say = speakerLines('narrator');

function streetBox(speaker: Point): ConversationRequest {
  return {
    // Two pages, so a press that turns a page leaves the box up and cannot be
    // mistaken for one that dismissed it.
    lines: [
      say.line('A passing remark, long enough to stand and read for a while.'),
      say.line('And a second page of it, for the press that turns the first.'),
    ],
    reward: null,
    questRelated: false,
    ending: { kind: 'close', onClosed: () => undefined },
    dismiss: { kind: 'allowed', onDismissed: () => undefined },
    haltsWorld: false,
    anchor: { position: () => speaker, talkRangeTiles: STREET_BOX_TALK_RANGE_TILES },
    locksKeyboard: true,
  };
}

async function verifyPaddockPresses(): Promise<void> {
  console.log('\nthe interact key in the paddock, through the real scene');
  const found = briarHollowMap();
  check(found !== null, 'a searched seed puts Briar Hollow on the overworld');
  if (found === null) return;

  const sceneManager = new SceneManager();
  const scene = new DungeonScene(level3, new InputManager(), sceneManager, {
    existingMap: found.map,
    worldSeed: found.seed,
    skipIntro: true,
  });
  sceneManager.replace(scene);
  check(await settleArrival(sceneManager, scene), "the town's arrival screen finishes");
  for (let frame = 0; frame < SETTLE_FRAMES; frame++) scene.update();

  const kit = sceneField(scene, 'briarHollowKit', BriarHollowKit);
  const bus = sceneField(scene, 'bus', EventBus);
  const conversation = sceneField(scene, 'conversation', Conversation);
  const roster = sceneRoster(scene);
  const livestock = kit.livestock;
  check(livestock !== null, 'the scene raised a herd');
  if (livestock === null) return;

  let pets = 0;
  bus.on('cowPetted', () => {
    pets++;
  });
  const { human, cat } = scene.pm;
  let swings = 0;
  const humanAttack = human.triggerAttack.bind(human);
  human.triggerAttack = (target) => {
    swings++;
    humanAttack(target);
  };
  const catAttack = cat.triggerAttack.bind(cat);
  cat.triggerAttack = () => {
    swings++;
    catAttack();
  };

  const active = scene.pm.active();
  const inactive = scene.pm.inactive();
  const standAt = (at: Point): void => {
    active.x = at.x;
    active.y = at.y;
    inactive.x = at.x;
    inactive.y = at.y;
  };
  type HerdCow = (typeof livestock.herd)[number];
  /**
   * A spot beside `cow` from which a press reaches that cow and no other. A
   * press pets the nearest cow in reach, so from a spot where a neighbour is as
   * near, a case would pet the neighbour — one an earlier case may already have
   * petted, whose cooldown then swallows the pet.
   */
  const spotReachingOnly = (cow: HerdCow): Point | null => {
    for (const side of SIDES_OF_A_COW) {
      const at = {
        x: cow.x + side.x * BESIDE_COW_TILES * TILE_SIZE,
        y: cow.y + side.y * BESIDE_COW_TILES * TILE_SIZE,
      };
      standAt(at);
      if (livestock.petTarget(active) === cow) return at;
    }
    return null;
  };

  // Every case gets a cow of its own, pressed from a spot that reaches only
  // that cow, so no pet cooldown can hide a pet.
  const cows = livestock.herd.flatMap((cow) => {
    if (!cow.isAlive || cow.isCalf) return [];
    const spot = spotReachingOnly(cow);
    return spot === null ? [] : [{ cow, spot }];
  });
  const casesNeedingACow = 4;
  check(
    cows.length >= casesNeedingACow,
    `the herd has a cow per case, each with a spot reaching it alone (${cows.length})`,
  );
  const [plainCase, hostileCase, handOffCase, tapCase] = cows;
  if (
    plainCase === undefined ||
    hostileCase === undefined ||
    handOffCase === undefined ||
    tapCase === undefined
  )
    return;
  const standBeside = (herdCase: { spot: Point }): Point => {
    standAt(herdCase.spot);
    return herdCase.spot;
  };
  const setDownHostile = (): { hp: number } => {
    const goblin = createMob(
      'goblin',
      Math.floor(active.x / TILE_SIZE),
      Math.floor(active.y / TILE_SIZE) + HOSTILE_OFFSET_TILES,
      found.map,
    );
    roster.add(goblin);
    return goblin;
  };
  const clearHostile = (goblin: { hp: number }): void => {
    goblin.hp = 0;
    roster.rebuildGrid();
  };
  const counts = (): string => `${pets} pets, ${swings} swings`;

  // The plain press.
  standBeside(plainCase);
  check(livestock.wouldPet(active), 'the crawler stands in reach of a cow');
  pets = 0;
  swings = 0;
  pressSpace();
  check(
    pets === 1 && swings === 0,
    `Space beside a cow pets it and swings at nothing (${counts()})`,
  );

  standBeside(hostileCase);
  const hostile = setDownHostile();
  pets = 0;
  swings = 0;
  pressSpace();
  check(pets === 0 && swings === 1, `with a hostile in range, Space is the swing (${counts()})`);
  clearHostile(hostile);

  // The walk-away hand-off.
  const handOffAt = standBeside(handOffCase);
  const speaker = { x: handOffAt.x + STREET_BOX_SPEAKER_TILES * TILE_SIZE, y: handOffAt.y };
  check(
    STREET_BOX_SPEAKER_TILES > STREET_BOX_TALK_RANGE_TILES &&
      STREET_BOX_SPEAKER_TILES < walkAwayRangeTiles(STREET_BOX_TALK_RANGE_TILES),
    'the street box is out of talk range but inside walk-away',
  );
  conversation.open(streetBox(speaker));
  pets = 0;
  swings = 0;
  pressSpace();
  check(
    pets === 1 && swings === 0 && !conversation.isOpen,
    `a press handed off from a street box pets the cow and dismisses the box (${counts()})`,
  );

  const handOffHostile = setDownHostile();
  conversation.open(streetBox(speaker));
  pets = 0;
  swings = 0;
  pressSpace();
  check(
    pets === 0 && swings === 0 && conversation.isOpen,
    `with a hostile in range, the press stays with the box: no pet, no swing (${counts()})`,
  );
  conversation.close();
  clearHostile(handOffHostile);

  // The touch form of the press.
  standBeside(tapCase);
  const camera = sceneCamera(scene);
  const onCow = {
    x: tapCase.cow.x + TILE_SIZE * HALF - camera.x,
    y: tapCase.cow.y + TILE_SIZE * HALF - camera.y,
  };
  pets = 0;
  swings = 0;
  tap(canvasEvents(sceneManager), onCow);
  check(
    pets === 1 && swings === 0,
    `a tap on a cow in reach pets it and swings at nothing (${counts()})`,
  );

  scene.onExit();
}

await verifyPaddockPresses();

console.log(failures === 0 ? '\nall paddock press checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
