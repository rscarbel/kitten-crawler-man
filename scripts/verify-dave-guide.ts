#!/usr/bin/env tsx
/**
 * Dave in the dungeon and the story he tells, driven through a headless
 * `DungeonScene` on floor 1:
 *
 *   - Dave teleports into each safe room the party newly walks into, and is in
 *     no room it has not; he stays put when the party leaves his room and
 *     walks back in.
 *   - A story beat due on his arrival plays as a cutscene: a held direction
 *     key moves nobody, the pause key opens and closes the pause menu, and the
 *     talk is one Dave story beat at most per arrival. The skipped tutorial's
 *     intro told in a safe room in its place keeps him there.
 *   - Each beat plays once, is in the save the moment it ends, and a director
 *     rebuilt from that save does not play it again.
 *   - Caroline's floor arrival message, opened with two updates run before a
 *     frame is drawn (the scene manager's catch-up), stacks above the
 *     cutscene that opened it and is read to its end with Space alone, and
 *     still is after a pause and resume, and when it waited for another box
 *     that closed between two drawn frames.
 *   - Caroline's intel about an objective shows once, however many rooms are
 *     entered while it is current.
 *   - A death rewound to the last save stands Dave in that save's room.
 *   - A run that skipped the tutorial finds Dave waiting by the start, hears
 *     his intro at once, and is left with him gone.
 *   - His arrival talk waits for the active crawler to be in his room with
 *     him: a party that walked out before he landed is not pulled back in,
 *     and hears it on walking back in.
 *   - Intel queued for an objective finished before it showed is dropped.
 *   - A talk never runs past `MAX_DAVE_TALK_PAGES`, a beat and a debrief with
 *     a bag full of unworn gear included: what does not fit waits for the
 *     talks the player opens, each within the cap, until all is said.
 *   - An arrival walks nobody up to Dave, and Caroline briefs nothing unasked,
 *     once the fortune teller's quest is taken up or while the Journal
 *     follows another quest (the inn regular's lead among them); a side quest
 *     under way and unfollowed does not count. Run over floors 1 to 3 under
 *     each of those, every beat told through Dave is still heard by talking
 *     to him, a floor on which he was never spoken to included.
 *   - The director plays a party that skipped rooms the story in order.
 *   - The post-boss debrief's pure rules (`daveGuide/debriefChecks.ts`).
 *
 *   npm run verify:dave-guide
 */

import { installBrowserShim, ShimEvent } from './browserShim.js';
import { useDevPlayerIdentity } from '../src/dev/devPlayerIdentity';
import type { TrackerEntry } from '../src/systems/questTracker';
import type { ArrivalJournal, ArrivalSteerQuest } from '../src/systems/StoryDelivery';
import type { StoryFloor } from '../src/story/storyTypes';
import type { DebriefBossType } from '../src/core/mobs/debriefBossTypes';
import type { WalkToStep } from '../src/systems/cutscene/cutsceneSteps';

useDevPlayerIdentity();

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
const { level1 } = await import('../src/levels/level1.js');
const { Conversation } = await import('../src/dialog/Conversation.js');
const { speakerLines } = await import('../src/dialog/line.js');
const { DaveGuideSystem } = await import('../src/systems/DaveGuideSystem.js');
const { SafeRoomSystem } = await import('../src/systems/SafeRoomSystem.js');
const { CutsceneKit, CUTSCENE_SURFACE_ID } = await import('../src/systems/kits/CutsceneKit.js');
const { MenusKit } = await import('../src/systems/kits/MenusKit.js');
const { safeRoomIdIn, sameSafeRoom } = await import('../src/map/safeRoomId.js');
const { StoryDirector, storyBeat, storyDirectorFromSave } =
  await import('../src/story/StoryDirector.js');
const { STORY_BEAT_ORDER } = await import('../src/story/storyBeatIds.js');
const { debriefCheckResults } = await import('./daveGuide/debriefChecks.js');
const { StoryDelivery, MAX_DAVE_TALK_PAGES, arrivalFetchesParty } =
  await import('../src/systems/StoryDelivery.js');
const { SPIDER_QUEST_ID } = await import('../src/systems/SpiderQuestSystem.js');
const { MISSING_CATS_QUEST_ID } = await import('../src/systems/missingCats/missingCatsPhase.js');
const { autoPinQuest, createJournalProgress } =
  await import('../src/core/quests/JournalProgress.js');
const { ACTIVE_CRAWLER } = await import('../src/systems/cutscene/cutsceneSteps.js');
const { ANCHOR_QUEST_ID } = await import('../src/systems/AnchorQuestSystem.js');
const { createAnchorQuestProgress } = await import('../src/core/quests/AnchorQuestProgress.js');
const { displayPageCount } = await import('../src/dialog/Conversation.js');
const { Inventory } = await import('../src/core/items/inventory/Inventory.js');
const { ITEM_DEF } = await import('../src/core/items/defs/ItemDefs.js');
const { BossRoomSystem } = await import('../src/systems/BossRoomSystem.js');
const { MobRoster } = await import('../src/systems/kits/SceneWorld.js');
const {
  EMPTY_DEBRIEF_MEMORY,
  debriefHasNews,
  debriefPages,
  debriefTalk,
  rememberDebriefHeard,
  unwornGear,
} = await import('../src/systems/daveDebrief.js');

type Scene = InstanceType<typeof DungeonScene>;
type Point = { readonly x: number; readonly y: number };
type SaveProgress = Parameters<
  NonNullable<ConstructorParameters<typeof DungeonScene>[3]>['saveProgress'] & {}
>[0];
type Script = Parameters<InstanceType<typeof CutsceneKit<never>>['director']['play']>[0];
type BeatId = (typeof STORY_BEAT_ORDER)[number];

/** More frames than his arrival delay and teleport-in take together. */
const MAX_ARRIVAL_FRAMES = 300;
/** More frames than his teleport-out takes. */
const MAX_DEPARTURE_FRAMES = 120;
/** More drawn frames than floor 1's arrival message takes to come up. */
const MAX_CAROLINE_ARRIVAL_FRAMES = 600;
/** Updates the scene manager runs before one drawn frame after a slow frame. */
const CATCH_UP_UPDATES_PER_DRAW = 2;
/** Drawn frames another box is left up while her arrival message waits behind it. */
const OTHER_BOX_FRAMES = 30;
/** Frames a fight near the room is given to lose interest before Caroline must have spoken. */
const MAX_CALM_FRAMES = 1200;
/** More presses than any talk has pages, reveals included. */
const MAX_READ_PRESSES = 60;
/** Frames ticked between presses, so each page's reveal finishes and the next step starts. */
const FRAMES_PER_PRESS = 3;
/** More frames than the arrival loading screen ever needs. */
const MAX_SETTLE_FRAMES = 3000;
/** Frames a held direction key is held during a cutscene's talk to see that nobody moves. */
const HELD_TICKS = 20;
/** Tiles past a room's wall the party is stood to be outside it. */
const OUTSIDE_ROOM_SEARCH_TILES = 6;
/** Safe-room arrivals the skipped-rooms check walks through on floor 2. */
const FLOOR_TWO_ARRIVALS = 8;

let failures = 0;
function check(ok: boolean, message: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${message}`);
  if (!ok) failures++;
}

await loadSprites('src/images/');

let clockMs = 0;
function holdKey(key: string): void {
  clockMs += 1;
  shim.window.dispatch(new ShimEvent('keydown', key, clockMs));
}
function releaseKey(key: string): void {
  clockMs += 1;
  shim.window.dispatch(new ShimEvent('keyup', key, clockMs));
}
function pressKey(key: string): void {
  holdKey(key);
  releaseKey(key);
}

function lastOf<T>(items: readonly T[]): T | undefined {
  return items.length === 0 ? undefined : items[items.length - 1];
}

/** A private collaborator of the scene, checked against the class it must be. */
function sceneField<T>(scene: Scene, name: string, type: abstract new (...args: never[]) => T): T {
  const value: unknown = Reflect.get(scene, name);
  if (!(value instanceof type)) throw new Error(`the scene's ${name} is not a ${type.name}`);
  return value;
}

function callPrivate(scene: Scene, name: string): void {
  const method: unknown = Reflect.get(scene, name);
  if (typeof method !== 'function') throw new Error(`the scene has no ${name}`);
  Reflect.apply(method, scene, []);
}

async function settleArrival(sceneManager: InstanceType<typeof SceneManager>, scene: Scene) {
  const ctx = sceneManager.canvas.getContext('2d');
  if (ctx === null) throw new Error('the shim canvas has no 2d context');
  for (let frame = 0; frame < MAX_SETTLE_FRAMES; frame++) {
    if (!scene.arrivalLoadingOpen) return true;
    scene.render(ctx);
    await new Promise((resolve) => setImmediate(resolve));
  }
  return false;
}

/** The first paragraph of a beat Dave tells, which a played talk is recognised by. */
function openingOf(id: BeatId): string | null {
  const beat = storyBeat(id);
  return beat.speaker === 'dave' ? beat.lines[0] : null;
}

/** The Dave story beats a cutscene script tells, in order. */
function daveBeatsIn(script: Script): BeatId[] {
  const told: BeatId[] = [];
  for (const step of script) {
    if (step.kind !== 'conversation') continue;
    for (const line of step.request.lines) {
      if (!('paragraphs' in line)) continue;
      const beat = STORY_BEAT_ORDER.find((id) => openingOf(id) === line.paragraphs[0]);
      if (beat !== undefined) told.push(beat);
    }
  }
  return told;
}

function carolineTextsIn(script: Script): string[] {
  return script.flatMap((step) => (step.kind === 'carolineMessage' ? [step.message.text] : []));
}

interface Harness {
  readonly scene: Scene;
  readonly scripts: Script[];
  readonly saves: SaveProgress[];
  readonly dave: InstanceType<typeof DaveGuideSystem>;
  readonly cutscenes: InstanceType<typeof CutsceneKit<never>>;
  readonly conversation: InstanceType<typeof Conversation>;
  readonly story: InstanceType<typeof StoryDirector>;
}

async function openFloorOne(
  options: NonNullable<ConstructorParameters<typeof DungeonScene>[3]>,
): Promise<Harness> {
  const saves: SaveProgress[] = [];
  const sceneManager = new SceneManager();
  const scene = new DungeonScene(level1, new InputManager(), sceneManager, {
    worldSeed: WORLD_SEED,
    skipIntro: true,
    saveProgress: (progress) => {
      saves.push(progress);
      return Promise.resolve('saved');
    },
    ...options,
  });
  sceneManager.replace(scene);
  check(await settleArrival(sceneManager, scene), "floor 1's arrival screen finishes");
  const cutscenes = sceneField(scene, 'cutscenes', CutsceneKit);
  const scripts: Script[] = [];
  const play = cutscenes.director.play.bind(cutscenes.director);
  cutscenes.director.play = (script, onComplete) => {
    scripts.push(script);
    play(script, onComplete);
  };
  return {
    scene,
    scripts,
    saves,
    dave: sceneField(scene, 'dave', DaveGuideSystem),
    cutscenes,
    conversation: sceneField(scene, 'conversation', Conversation),
    story: sceneField(scene, 'storyDirector', StoryDirector),
  };
}

function standParty(scene: Scene, tile: Point): void {
  for (const crawler of [scene.pm.active(), scene.pm.partnerAnywhere()]) {
    crawler.x = tile.x * TILE_SIZE;
    crawler.y = tile.y * TILE_SIZE;
  }
}

/** A walkable tile a few tiles outside `bounds`, for standing the party out of the room. */
function tileOutside(
  map: InstanceType<typeof GameMap>,
  bounds: { x: number; y: number; w: number; h: number },
): Point | null {
  for (let reach = 1; reach <= OUTSIDE_ROOM_SEARCH_TILES; reach++) {
    const candidates: Point[] = [
      { x: bounds.x - reach, y: bounds.y + Math.floor(bounds.h / 2) },
      { x: bounds.x + bounds.w - 1 + reach, y: bounds.y + Math.floor(bounds.h / 2) },
      { x: bounds.x + Math.floor(bounds.w / 2), y: bounds.y - reach },
      { x: bounds.x + Math.floor(bounds.w / 2), y: bounds.y + bounds.h - 1 + reach },
    ];
    const found = candidates.find((tile) => map.isWalkable(tile.x, tile.y, 'walker'));
    if (found !== undefined) return found;
  }
  return null;
}

/** Pages through whatever cutscenes are playing until none is. Returns whether they all ended. */
function readThrough(harness: Harness): boolean {
  for (let press = 0; press < MAX_READ_PRESSES && harness.cutscenes.isActive; press++) {
    pressKey(' ');
    for (let tick = 0; tick < FRAMES_PER_PRESS; tick++) frame(harness);
  }
  return !harness.cutscenes.isActive;
}

/**
 * One frame as the browser runs it: the update, then the surface stack
 * settling as a drawn frame settles it, so a box opened this frame stacks
 * above the cutscene that opened it.
 */
function frame(harness: Harness): void {
  harness.scene.update();
  harness.scene.ui.focusSurfaceId();
}

function tickUntil(harness: Harness, done: () => boolean, maxFrames: number): boolean {
  for (let tick = 0; tick < maxFrames && !done(); tick++) frame(harness);
  return done();
}

// ── Dave follows the party from room to room ─────────────────────────────

async function verifyRoomsAndBeats(): Promise<void> {
  console.log('\nDave follows the party into safe rooms, and tells the story there');
  const harness = await openFloorOne({});
  const { scene, dave, scripts, story } = harness;
  const map = sceneField(scene, 'gameMap', GameMap);
  const safeRooms = sceneField(scene, 'safeRoom', SafeRoomSystem);
  const pause = sceneField(scene, 'menus', MenusKit).pauseScreen;
  const scope = { kind: 'floor', level: level1.id } as const;
  check(
    map.safeRooms.length >= 2,
    `floor 1 has two safe rooms to walk between (${map.safeRooms.length})`,
  );
  if (map.safeRooms.length < 2) return;
  const [roomA, roomB] = [safeRoomIdIn(scope, 0), safeRoomIdIn(scope, 1)];
  const centreOf = (index: number): Point => map.safeRooms[index].centre;
  const outsideA = tileOutside(map, map.safeRooms[0].bounds);
  check(outsideA !== null, 'a walkable tile outside the first safe room');
  if (outsideA === null) return;

  standParty(scene, outsideA);
  frame(harness);
  check(dave.state.kind === 'absent', 'Dave is in no room before the party has entered one');

  const entered: Array<typeof roomA> = [];
  const strayRooms: string[] = [];
  const watchDave = (): void => {
    const state = dave.state;
    if (state.kind !== 'inRoom') return;
    if (!entered.some((room) => sameSafeRoom(room, state.room))) {
      strayRooms.push(`room ${state.room.index}`);
    }
  };
  const enter = (index: number, room: typeof roomA): boolean => {
    entered.push(room);
    const doorstep = tileOutside(map, map.safeRooms[index].bounds);
    if (doorstep !== null) {
      standParty(scene, doorstep);
      frame(harness);
    }
    standParty(scene, centreOf(index));
    return tickUntil(
      harness,
      () => {
        watchDave();
        const state = dave.state;
        return state.kind === 'inRoom' && sameSafeRoom(state.room, room) && dave.isPresent;
      },
      MAX_ARRIVAL_FRAMES,
    );
  };

  const scriptsBeforeA = scripts.length;
  check(enter(0, roomA), 'walking into the first safe room, Dave teleports in there');
  check(
    dave.state.kind === 'inRoom' && dave.state.phase.kind === 'present',
    'he has finished arriving',
  );
  frame(harness);
  check(harness.cutscenes.isActive, 'a beat due on his arrival starts a cutscene');
  const arrivalA = scripts.slice(scriptsBeforeA);
  const toldInA = arrivalA.flatMap(daveBeatsIn);
  check(
    toldInA.length === 1 && toldInA[0] === 'skipped_tutorial_dave_intro',
    `a run that never heard the tutorial hears the intro in its place (${toldInA.join(', ') || 'nothing'})`,
  );
  check(
    arrivalA.every((script) => script.every((step) => step.kind !== 'daveTeleportOut')),
    'told in a safe room, the intro keeps him there: no teleport out',
  );

  const active = scene.pm.active();
  check(
    tickUntil(harness, () => harness.conversation.isOpen, MAX_ARRIVAL_FRAMES),
    'the walk-up ends in his talk',
  );
  holdKey('ArrowLeft');
  const talkingAt = { x: active.x, y: active.y };
  for (let tick = 0; tick < HELD_TICKS; tick++) frame(harness);
  check(
    active.x === talkingAt.x && active.y === talkingAt.y,
    'a held direction key moves nobody while he talks',
  );
  pressKey('Escape');
  check(pause.isOpen, 'the pause key opens the pause menu mid-talk');
  pressKey('Escape');
  check(!pause.isOpen && harness.cutscenes.isActive, 'and closes it, the talk still running');
  releaseKey('ArrowLeft');

  check(readThrough(harness), 'reading on ends the cutscene');
  const toldOnArrivalA = scripts.slice(scriptsBeforeA).flatMap(daveBeatsIn);
  check(
    toldOnArrivalA.length === 1,
    `one arrival tells one of his beats, never two (${toldOnArrivalA.join(', ')})`,
  );
  check(story.hasSeen('skipped_tutorial_dave_intro'), 'the intro is marked heard');
  check(
    story.hasSeen('tutorial_meets_dave') && story.hasSeen('tutorial_dave_farewell'),
    'and so are the tutorial beats it covers',
  );
  const newestSave = lastOf(harness.saves);
  check(
    (newestSave?.storyBeatsSeen ?? []).includes('skipped_tutorial_dave_intro'),
    'the newest save carries the beat the moment it ends',
  );
  check(dave.isPresent, 'Dave is still in the room after his talk');

  const intelShown = (): number =>
    scripts.flatMap(carolineTextsIn).filter((text) => text.includes('Trash Gremlin')).length;
  check(
    tickUntil(harness, () => intelShown() > 0, MAX_CALM_FRAMES),
    "Caroline's intel about the Trash Gremlin shows after the talk",
  );
  readThrough(harness);
  check(story.hasBriefed('trash_gremlin'), 'and is recorded as given');

  standParty(scene, outsideA);
  tickUntil(harness, () => false, MAX_ARRIVAL_FRAMES);
  check(
    dave.state.kind === 'inRoom' && sameSafeRoom(dave.state.room, roomA),
    'leaving the room leaves him in it',
  );
  const scriptsBeforeReentry = scripts.length;
  standParty(scene, centreOf(0));
  tickUntil(harness, () => false, MAX_ARRIVAL_FRAMES);
  check(
    dave.state.kind === 'inRoom' &&
      sameSafeRoom(dave.state.room, roomA) &&
      dave.state.phase.kind === 'present',
    'walking back in finds him where he was, with no second arrival',
  );
  check(scripts.length === scriptsBeforeReentry, 'and nothing is told again');

  const scriptsBeforeB = scripts.length;
  check(enter(1, roomB), 'walking into the second safe room, he teleports there');
  frame(harness);
  const toldInB = scripts.slice(scriptsBeforeB).flatMap(daveBeatsIn);
  check(
    toldInB.length === 1 && toldInB[0] === 'floor1_dave_how_it_began',
    `the next arrival tells the next beat, one only (${toldInB.join(', ') || 'nothing'})`,
  );
  readThrough(harness);
  tickUntil(harness, () => false, MAX_CALM_FRAMES);
  readThrough(harness);
  check(
    intelShown() === 1,
    `the intel about the same objective shows once (${intelShown()} times)`,
  );
  check(
    strayRooms.length === 0,
    `he is never in a room the party did not enter (${strayRooms.join(', ')})`,
  );

  const told = scripts.flatMap(daveBeatsIn);
  const repeated = told.filter((id, index) => told.indexOf(id) !== index);
  check(
    repeated.length === 0,
    `every beat is told once (${repeated.join(', ') || 'none repeated'})`,
  );

  const save = lastOf(harness.saves);
  check(save !== undefined, 'the run has a save');
  if (save !== undefined) {
    const reloaded = storyDirectorFromSave(save);
    const arrival = {
      kind: 'safeRoomArrival',
      floor: 1,
      defeatedBosses: new Set<never>(),
    } as const;
    const replayed = reloaded.dueBeats(arrival).filter((id) => told.includes(id));
    check(
      reloaded.hasSeen('floor1_dave_how_it_began') && replayed.length === 0,
      `a director rebuilt from the save plays none of the heard beats again (${replayed.join(', ') || 'none'})`,
    );
    check(reloaded.hasBriefed('trash_gremlin'), 'and remembers the intel already given');
  }

  dave.teleportOut();
  tickUntil(harness, () => dave.state.kind === 'absent', MAX_DEPARTURE_FRAMES);
  check(dave.state.kind === 'absent', 'control: he can be sent away');
  callPrivate(scene, 'respawnAfterDeath');
  const respawned = dave.state;
  check(
    respawned.kind === 'inRoom' &&
      sameSafeRoom(respawned.room, roomB) &&
      respawned.phase.kind === 'present',
    'a death rewound to the save made in the second room stands him there',
  );
  check(
    safeRooms.safeRoomAt(scene.pm.active()) !== null,
    'control: the party respawns in a safe room',
  );

  scene.onExit();
}

// ── A run that skipped the tutorial ──────────────────────────────────────

async function verifySkippedTutorial(): Promise<void> {
  console.log('\na run that skipped the tutorial meets Dave at the start');
  const harness = await openFloorOne({ skippedTutorial: true });
  const { scene, dave, scripts, story } = harness;
  frame(harness);
  check(dave.state.kind === 'waiting', 'Dave is already standing near the start, outside any room');
  check(harness.cutscenes.isActive, 'his intro plays at once');
  const intro = scripts.find((script) =>
    daveBeatsIn(script).includes('skipped_tutorial_dave_intro'),
  );
  check(intro !== undefined, 'the cutscene tells the intro');
  check(
    lastOf(intro ?? [])?.kind === 'daveTeleportOut',
    "the intro's cutscene ends with him teleporting out",
  );
  check(readThrough(harness), 'reading on ends it');
  check(
    tickUntil(harness, () => dave.state.kind === 'absent', MAX_DEPARTURE_FRAMES),
    'and he is gone from the map',
  );
  check(story.hasSeen('tutorial_dave_farewell'), 'the tutorial beats it covers are heard');
  scene.onExit();
}

// ── Caroline's arrival message reads with Space after catch-up updates ───

/**
 * One drawn frame after a slow one: the scene manager's catch-up updates run
 * back to back, and only then does the drawn frame settle the surface stack.
 */
function catchUpFrame(harness: Harness): void {
  for (let update = 0; update < CATCH_UP_UPDATES_PER_DRAW; update++) harness.scene.update();
  harness.scene.ui.focusSurfaceId();
}

/** What happens before her arrival message is read: nothing, a pause and resume, or another box she waits behind. */
type CarolineArrivalCase = 'plain' | 'pauseFirst' | 'afterAnotherBox';

const CAROLINE_ARRIVAL_CASE_TITLES = {
  plain: "\nCaroline's arrival message, opened between two drawn frames, reads with Space",
  pauseFirst: "\nCaroline's arrival message still reads with Space after a pause and resume",
  afterAnotherBox:
    "\nCaroline's arrival message reads with Space after the box she waited behind closes between two drawn frames",
} as const satisfies Record<CarolineArrivalCase, string>;

/**
 * A box the player opened and reads with the world running, as a chat with
 * Dave or the doctor is. Her message waits for it to close; when it closes
 * after one drawn frame and hers opens before the next, the stack never sees
 * the conversation closed, and only a fresh opening puts hers back above the
 * cutscene that holds the party.
 */
function openAnotherBox(
  conversation: Harness['conversation'],
): ReturnType<Harness['conversation']['open']> {
  return conversation.open({
    lines: [speakerLines('narrator').line('A box the player opened.')],
    reward: null,
    questRelated: false,
    ending: { kind: 'close', onClosed: () => undefined },
    dismiss: { kind: 'allowed', onDismissed: () => undefined },
    haltsWorld: false,
    anchor: null,
    locksKeyboard: false,
  });
}

async function verifyCarolineArrivalReads(arrivalCase: CarolineArrivalCase): Promise<void> {
  console.log(CAROLINE_ARRIVAL_CASE_TITLES[arrivalCase]);
  const harness = await openFloorOne({ arrivedOnFloor: true });
  const { scene, conversation, cutscenes } = harness;
  const pause = sceneField(scene, 'menus', MenusKit).pauseScreen;
  if (arrivalCase === 'afterAnotherBox') {
    const other = openAnotherBox(conversation);
    for (let tick = 0; tick < OTHER_BOX_FRAMES; tick++) catchUpFrame(harness);
    check(
      conversation.isActive(other) && !cutscenes.isActive,
      'control: her message waits while the other box is up',
    );
    conversation.close();
  }
  const carolineUp = (): boolean => conversation.isOpen && cutscenes.isActive;
  for (let tick = 0; tick < MAX_CAROLINE_ARRIVAL_FRAMES && !carolineUp(); tick++) {
    catchUpFrame(harness);
  }
  check(carolineUp(), 'her message is up, inside its cutscene');
  const stack = scene.ui.openSurfaceIds();
  check(
    stack.includes(CUTSCENE_SURFACE_ID) &&
      stack.indexOf(CUTSCENE_SURFACE_ID) < stack.indexOf('conversation'),
    `the message stacks above the cutscene holding the party (${stack.join(' < ')})`,
  );
  if (arrivalCase === 'pauseFirst') {
    pressKey('Escape');
    catchUpFrame(harness);
    check(pause.isOpen, 'Escape opens the pause menu over it');
    pressKey('Escape');
    catchUpFrame(harness);
    check(!pause.isOpen, 'and Escape closes it again');
  }
  for (let press = 0; press < MAX_READ_PRESSES && conversation.isOpen; press++) {
    pressKey(' ');
    for (let tick = 0; tick < FRAMES_PER_PRESS; tick++) catchUpFrame(harness);
  }
  check(!conversation.isOpen, 'Space reads it to its end and closes it');
  check(!cutscenes.isActive, 'and the cutscene hands the party back');
  scene.onExit();
}

// ── The director, with rooms skipped ──────────────────────────────────────

function verifySkippedRooms(): void {
  console.log('\nthe story keeps its order when rooms are skipped');
  const story = new StoryDirector([
    'tutorial_meets_dave',
    'tutorial_caroline_first_contact',
    'tutorial_dave_farewell',
  ]);
  const arrival = {
    kind: 'safeRoomArrival',
    floor: 2,
    defeatedBosses: new Set(['kraken'] as const),
  } as const;
  const heard: BeatId[] = [];
  for (let visit = 0; visit < FLOOR_TWO_ARRIVALS; visit++) {
    const due = story.dueBeats(arrival).filter((id) => storyBeat(id).speaker === 'dave');
    check(due.length <= 1, `arrival ${visit + 1} plays at most one of his beats`);
    const next = lastOf(due.slice(0, 1));
    if (next === undefined) continue;
    story.finish(next);
    heard.push(next);
  }
  const expected: BeatId[] = [
    'floor1_dave_how_it_began',
    'floor1_dave_the_morning',
    'floor1_dave_chosen',
    'floor2_dave_his_story',
    'floor2_dave_how_he_knows',
  ];
  check(
    heard.join() === expected.join(),
    `a party that walked past floor 1's rooms hears floor 1's beats first, in order (${heard.join(', ')})`,
  );
  check(
    story
      .dueBeats({ kind: 'beatFinished', beat: 'floor1_dave_chosen' })
      .includes('floor1_caroline_motive'),
    "Caroline's answer follows the beat she answers",
  );
}

// ── His talk waits for the party, and stale intel is dropped ────────────

async function verifyArrivalTiming(): Promise<void> {
  console.log('\nhis arrival talk waits for the party in his room; stale intel is dropped');
  const harness = await openFloorOne({});
  const { scene, dave, scripts, story } = harness;
  // An empty floor, so nothing fighting the party is what holds his talk back.
  const world: unknown = Reflect.get(scene, 'world');
  const roster: unknown = typeof world === 'object' ? Reflect.get(world ?? {}, 'roster') : null;
  if (!(roster instanceof MobRoster)) throw new Error("the scene's world has no roster");
  roster.replaceAll([]);
  const map = sceneField(scene, 'gameMap', GameMap);
  const outside = tileOutside(map, map.safeRooms[0].bounds);
  check(outside !== null, 'a walkable tile outside the first safe room');
  if (outside === null) return;
  standParty(scene, outside);
  frame(harness);
  standParty(scene, map.safeRooms[0].centre);
  frame(harness);
  standParty(scene, outside);
  check(
    tickUntil(harness, () => dave.isPresent, MAX_ARRIVAL_FRAMES),
    'stepping in and straight out, Dave still arrives in the room',
  );
  tickUntil(harness, () => harness.cutscenes.isActive, MAX_ARRIVAL_FRAMES);
  check(
    !harness.cutscenes.isActive && scripts.length === 0,
    'with the party outside his room, no talk starts and nobody is walked back in',
  );
  standParty(scene, map.safeRooms[0].centre);
  check(
    tickUntil(harness, () => harness.cutscenes.isActive, MAX_ARRIVAL_FRAMES),
    'walking back in, his talk starts',
  );
  check(readThrough(harness), 'and reads to its end');

  const bossRoom = sceneField(scene, 'bossRoom', BossRoomSystem);
  bossRoom.markPreDefeated('trash_gremlin');
  tickUntil(harness, () => false, MAX_CALM_FRAMES);
  readThrough(harness);
  const staleIntel = scripts
    .flatMap(carolineTextsIn)
    .filter((text) => text.includes('Trash Gremlin'));
  check(
    staleIntel.length === 0 && !story.hasBriefed('trash_gremlin'),
    `intel queued about a boss killed before it showed is dropped (${staleIntel.length} shown)`,
  );
  scene.onExit();
}

// ── No talk runs long ─────────────────────────────────────────────────────

/** More talks than the longest debrief needs to be heard out. */
const MAX_TAPPED_TALKS = 10;

function verifyTalkLength(): void {
  console.log('\nno talk runs past its page cap');
  // Every piece of armour in the game, as much as each bag holds: the
  // longest gear list a debrief can be asked to read.
  const human = new Inventory('human');
  const cat = new Inventory('cat');
  for (const item of Object.values(ITEM_DEF)) {
    if (item.type !== 'armor') continue;
    human.addItem(item.id, 1);
    cat.addItem(item.id, 1);
  }
  const state = {
    unworn: [...unwornGear('human', human), ...unwornGear('cat', cat)],
    key: { stairwellKeyKnownWhole: () => false },
  };
  let memory = EMPTY_DEBRIEF_MEMORY;
  const allPages = debriefPages('trash_gremlin', memory, state) ?? [];
  const whole = debriefTalk(allPages, Number.POSITIVE_INFINITY, displayPageCount);
  const wholeDebrief = whole === null ? 0 : displayPageCount(whole.line);
  check(
    wholeDebrief > MAX_DAVE_TALK_PAGES * 2,
    `fixture: the whole debrief alone runs past two talks (${wholeDebrief} pages)`,
  );

  const talks: Script[] = [];
  const delivery = new StoryDelivery({
    director: new StoryDirector([
      'skipped_tutorial_dave_intro',
      'tutorial_meets_dave',
      'tutorial_caroline_first_contact',
      'tutorial_dave_farewell',
      'floor1_dave_how_it_began',
    ]),
    cutscenes: {
      isActive: false,
      play: (script, onComplete) => {
        talks.push(script);
        onComplete?.();
      },
    },
    persist: () => undefined,
    calm: () => true,
    bus: { emit: () => undefined },
  });
  delivery.playDaveMoment({
    event: {
      kind: 'safeRoomArrival',
      floor: 1,
      defeatedBosses: new Set(['trash_gremlin'] as const),
    },
    walkUp: () => null,
    extra: (pageBudget) => {
      const talk = debriefTalk(
        debriefPages('trash_gremlin', memory, state) ?? [],
        pageBudget,
        displayPageCount,
      );
      if (talk === null) return null;
      return {
        line: talk.line,
        onHeard: () => {
          memory = rememberDebriefHeard(memory, talk.heard);
        },
      };
    },
    leavesAfter: false,
    onDone: () => undefined,
  });
  const pagesIn = (script: Script): number =>
    script.reduce(
      (pages, step) =>
        step.kind === 'conversation'
          ? pages +
            step.request.lines.reduce(
              (sum, line) => sum + ('paragraphs' in line ? displayPageCount(line) : 1),
              0,
            )
          : pages,
      0,
    );
  const arrivalPages = talks.map(pagesIn);
  check(
    talks.flatMap(daveBeatsIn).includes('floor1_dave_the_morning'),
    'control: the arrival tells his beat',
  );
  check(
    arrivalPages.every((pages) => pages <= MAX_DAVE_TALK_PAGES),
    `the beat and the debrief share one talk of at most ${MAX_DAVE_TALK_PAGES} pages (${arrivalPages.join(', ')})`,
  );
  check(debriefHasNews(memory, state), 'what did not fit is still news behind his `!`');

  let tapped = 0;
  let longest = 0;
  while (debriefHasNews(memory, state) && tapped < MAX_TAPPED_TALKS) {
    const talk = debriefTalk(
      debriefPages('trash_gremlin', memory, state) ?? [],
      MAX_DAVE_TALK_PAGES,
      displayPageCount,
    );
    if (talk === null) break;
    longest = Math.max(longest, displayPageCount(talk.line));
    memory = rememberDebriefHeard(memory, talk.heard);
    tapped++;
  }
  check(
    longest <= MAX_DAVE_TALK_PAGES,
    `each talk the player opens stays within ${MAX_DAVE_TALK_PAGES} pages (longest ${longest})`,
  );
  check(
    !debriefHasNews(memory, state),
    `the rest is heard out over ${tapped} talks, every item named`,
  );
}

// ── The arrival talk stands down for a party about other business ────────

/** A Journal row for a quest the party may be about. */
function questRow(id: string, status: 'available' | 'active'): TrackerEntry {
  return {
    kind: 'single',
    id,
    name: id,
    status,
    objective: `See to ${id}`,
    target: { x: 0, y: 0 },
  };
}

const FORTUNE_TELLER_ROW = questRow(ANCHOR_QUEST_ID, 'available');
const MISSING_CATS_ROW = questRow(MISSING_CATS_QUEST_ID, 'available');
const SPIDER_LAB_ROW = questRow(SPIDER_QUEST_ID, 'active');
const FORTUNE_TELLER_OFFER = { trackerId: ANCHOR_QUEST_ID, started: false } as const;

/** The Journal after the party heard the inn regular, pinned as the street pins a lead it is told about. */
function journalAfterInnRegular(): { entries: TrackerEntry[]; pinnedId: string | null } {
  const entries = [FORTUNE_TELLER_ROW, MISSING_CATS_ROW];
  const progress = createJournalProgress();
  autoPinQuest(progress, MISSING_CATS_QUEST_ID, entries);
  return { entries, pinnedId: progress.pinnedTrackerId };
}

function verifyArrivalRule(): void {
  console.log('\nthe arrival walks the party over only while it has nothing else to follow');
  check(
    arrivalFetchesParty({ entries: [FORTUNE_TELLER_ROW], pinnedId: null }, FORTUNE_TELLER_OFFER),
    'a party with nothing followed is walked up to Dave',
  );
  check(
    arrivalFetchesParty(
      { entries: [FORTUNE_TELLER_ROW], pinnedId: ANCHOR_QUEST_ID },
      FORTUNE_TELLER_OFFER,
    ),
    "following the fortune teller's offer still walks them over",
  );
  check(
    !arrivalFetchesParty(
      { entries: [FORTUNE_TELLER_ROW], pinnedId: null },
      { ...FORTUNE_TELLER_OFFER, started: true },
    ),
    "once the fortune teller's quest is taken up, nobody is walked over",
  );
  check(
    !arrivalFetchesParty(journalAfterInnRegular(), FORTUNE_TELLER_OFFER),
    'having heard the inn regular, the party is not walked over',
  );
  check(
    arrivalFetchesParty(
      { entries: [FORTUNE_TELLER_ROW, SPIDER_LAB_ROW], pinnedId: null },
      FORTUNE_TELLER_OFFER,
    ),
    'a side quest under way that the Journal is not following walks them over all the same',
  );
}

/** Every bodily boss on each floor, dead: every beat a floor can hold back for a boss is open. */
const FLOOR_BOSSES = {
  1: ['trash_gremlin', 'kraken'],
  2: ['electric_goblin', 'big_rooster'],
  3: [],
} as const satisfies Record<StoryFloor, readonly DebriefBossType[]>;
const STORY_FLOORS = [1, 2, 3] as const satisfies readonly StoryFloor[];
/** Safe rooms the party walks into on each floor of the simulation: more than any floor has beats. */
const ARRIVALS_PER_FLOOR = 6;
/** Frames run after each arrival, so Caroline's answer to a beat has had its quiet spell. */
const FRAMES_AFTER_ARRIVAL = 600;
const WALK_UP_SENTINEL = {
  kind: 'walkTo',
  who: ACTIVE_CRAWLER,
  tile: { x: 0, y: 0 },
  pace: 'stroll',
  face: 'down',
  then: 'waitForArrival',
} as const satisfies WalkToStep;

/** One run of floors 1 to 3 under a Journal state that holds for the whole run. */
interface ArrivalCondition {
  readonly label: string;
  readonly journal: ArrivalJournal;
  readonly steersTo: ArrivalSteerQuest;
  /** Whether the walk and the unasked brief should stand down. */
  readonly suppressed: boolean;
  /** Whether the player walks over and talks to Dave on `floor`, in each room he arrives in. */
  readonly talksOn: (floor: StoryFloor) => boolean;
}

const ARRIVAL_CONDITIONS: readonly ArrivalCondition[] = [
  {
    label: 'nothing followed',
    journal: { entries: [FORTUNE_TELLER_ROW], pinnedId: null },
    steersTo: FORTUNE_TELLER_OFFER,
    suppressed: false,
    talksOn: () => true,
  },
  {
    label: 'the inn regular heard',
    journal: journalAfterInnRegular(),
    steersTo: FORTUNE_TELLER_OFFER,
    suppressed: true,
    talksOn: () => true,
  },
  {
    label: "the fortune teller's quest taken up",
    journal: { entries: [questRow(ANCHOR_QUEST_ID, 'active')], pinnedId: ANCHOR_QUEST_ID },
    steersTo: { ...FORTUNE_TELLER_OFFER, started: true },
    suppressed: true,
    talksOn: () => true,
  },
  {
    label: 'the spider lab under way, unfollowed',
    journal: { entries: [FORTUNE_TELLER_ROW, SPIDER_LAB_ROW], pinnedId: null },
    steersTo: FORTUNE_TELLER_OFFER,
    suppressed: false,
    talksOn: () => true,
  },
  {
    label: 'the spider lab followed, Dave never spoken to on floor 2',
    journal: { entries: [FORTUNE_TELLER_ROW, SPIDER_LAB_ROW], pinnedId: SPIDER_QUEST_ID },
    steersTo: FORTUNE_TELLER_OFFER,
    suppressed: true,
    talksOn: (floor) => floor !== 2,
  },
];

/** The beats a run told through Dave: his own, and Caroline's answers to them. */
function toldThroughDave(id: BeatId): boolean {
  const kind = storyBeat(id).trigger.kind;
  return kind === 'safeRoomArrival' || kind === 'afterBeat';
}

function verifyWholeRunArrivals(condition: ArrivalCondition): void {
  console.log(`\nfloors 1 to 3 with ${condition.label}: every story beat is still told`);
  const story = new StoryDirector([
    'tutorial_meets_dave',
    'tutorial_caroline_first_contact',
    'tutorial_dave_farewell',
  ]);
  const scripts: Script[] = [];
  const delivery = new StoryDelivery({
    director: story,
    cutscenes: {
      isActive: false,
      play: (script, onComplete) => {
        scripts.push(script);
        onComplete?.();
      },
    },
    persist: () => undefined,
    calm: () => true,
    bus: { emit: () => undefined },
  });
  let briefs = 0;
  let walksUp = 0;
  let afterTalks = 0;
  const fetches = arrivalFetchesParty(condition.journal, condition.steersTo);
  check(
    fetches !== condition.suppressed,
    `the arrival ${condition.suppressed ? 'stands down' : 'walks the party over'}`,
  );
  for (const floor of STORY_FLOORS) {
    for (let arrival = 0; arrival < ARRIVALS_PER_FLOOR; arrival++) {
      const scriptsBefore = scripts.length;
      delivery.meetArrival(
        {
          event: () => ({
            kind: 'safeRoomArrival',
            floor,
            defeatedBosses: new Set<DebriefBossType>(FLOOR_BOSSES[floor]),
          }),
          walkUp: () => WALK_UP_SENTINEL,
          extra: () => null,
          afterTalk: () => {
            afterTalks++;
          },
          afterFetchedTalk: () => {
            briefs++;
          },
        },
        fetches ? 'fetch_party' : 'wait_for_player',
      );
      if (!fetches && condition.talksOn(floor)) delivery.tellHeldArrival();
      for (let tick = 0; tick < FRAMES_AFTER_ARRIVAL; tick++) delivery.update();
      const played = scripts.slice(scriptsBefore);
      walksUp += played.filter((script) => script.some((step) => step.kind === 'walkTo')).length;
    }
  }
  if (condition.suppressed) {
    check(walksUp === 0, `nobody is walked up to Dave (${walksUp} walks)`);
    check(briefs === 0, `Caroline briefs nothing unasked (${briefs} briefs)`);
  } else {
    check(walksUp > 0, `the party is walked up to him (${walksUp} walks)`);
    check(
      briefs === STORY_FLOORS.length * ARRIVALS_PER_FLOOR,
      `Caroline briefs after every arrival (${briefs})`,
    );
  }
  check(afterTalks > 0, `what follows his talk runs after the talks told (${afterTalks})`);
  const missed = STORY_BEAT_ORDER.filter((id) => toldThroughDave(id) && !story.hasSeen(id));
  check(
    missed.length === 0,
    `every beat told through Dave is heard (missed: ${missed.join(', ') || 'none'})`,
  );
}

async function verifyArrivalAfterFortuneTeller(): Promise<void> {
  console.log("\nan arrival after the fortune teller's quest is taken up waits for the player");
  const anchorQuestProgress = createAnchorQuestProgress();
  anchorQuestProgress.status = 'active';
  const harness = await openFloorOne({ anchorQuestProgress });
  const { scene, dave, scripts, story } = harness;
  const map = sceneField(scene, 'gameMap', GameMap);
  const delivery = sceneField(scene, 'story', StoryDelivery);
  const room = map.safeRooms[0];
  const outside = tileOutside(map, room.bounds);
  if (outside === null) {
    check(false, 'a walkable tile outside the first safe room');
    return;
  }
  standParty(scene, outside);
  frame(harness);
  standParty(scene, room.centre);
  check(
    tickUntil(harness, () => dave.state.kind === 'inRoom' && dave.isPresent, MAX_ARRIVAL_FRAMES),
    'Dave still teleports into the room',
  );
  tickUntil(harness, () => false, MAX_CALM_FRAMES);
  const told = scripts.flatMap(daveBeatsIn);
  check(told.length === 0, `nobody is walked up to him (${told.join(', ') || 'nothing told'})`);
  const briefed = scripts.flatMap(carolineTextsIn).filter((text) => text.includes('Trash Gremlin'));
  check(briefed.length === 0, `and Caroline briefs nothing (${briefed.length} briefings)`);
  check(delivery.holdsArrivalBeat, 'he waits with his beat behind his `!`');

  const scriptsBefore = scripts.length;
  const talkToDave: unknown = Reflect.get(scene, 'talkToDave');
  if (typeof talkToDave !== 'function') throw new Error('the scene has no talkToDave');
  Reflect.apply(talkToDave, scene, [scene.pm.active()]);
  const talk = scripts.slice(scriptsBefore);
  const heard = talk.flatMap(daveBeatsIn);
  check(
    heard.includes('skipped_tutorial_dave_intro'),
    `talking to him tells the beat he held (${heard.join(', ') || 'nothing told'})`,
  );
  check(
    talk.every((script) => script.every((step) => step.kind !== 'walkTo')),
    'with no walk up: the player came over',
  );
  check(readThrough(harness), 'and reads to its end');
  check(story.hasSeen('skipped_tutorial_dave_intro'), 'the beat is marked heard');
  check(!delivery.holdsArrivalBeat, 'and his `!` for it is gone');
}

await verifyRoomsAndBeats();
await verifyArrivalTiming();
await verifyCarolineArrivalReads('plain');
await verifyCarolineArrivalReads('pauseFirst');
await verifyCarolineArrivalReads('afterAnotherBox');
verifyTalkLength();
verifyArrivalRule();
for (const condition of ARRIVAL_CONDITIONS) verifyWholeRunArrivals(condition);
await verifyArrivalAfterFortuneTeller();
await verifySkippedTutorial();
verifySkippedRooms();

console.log('\nthe post-boss debrief');
const debrief = debriefCheckResults();
for (const failure of debrief.failures) check(false, failure);
check(debrief.failures.length === 0, `all ${debrief.checks} debrief checks pass`);

console.log(failures === 0 ? '\nall Dave guide checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
