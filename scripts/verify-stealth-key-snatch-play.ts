#!/usr/bin/env tsx
/**
 * The stealth gate's key quest, played headless on the real floor-2
 * `DungeonScene`, with the real prison door and `BuildingInteriorScene`:
 *
 *  - before the briefing: the guard wears '!', the gate is shut and rattles
 *    when walked into, and the prison door refuses the party;
 *  - talking to the guard briefs the party: the quest starts, the marker goes,
 *    the tracker points at the prison door and the door opens;
 *  - inside, the interior sees the quest through its floor context, marks the
 *    explainer read and takes the key; both come back out with the party;
 *  - the phase follows the key in the inventory, both ways;
 *  - handing the key over opens the gate, completes the quest, takes the key
 *    and pays; Big Rooster's gateway can then be reached and could not before;
 *  - Space at the gate with the key does the same;
 *  - the guard is not hurt, moved or held by anything the party does;
 *  - a save at every phase reloads into that phase with the gate to match,
 *    and a save without the quest reloads it unmet and locked.
 *
 *   npx tsx scripts/verify-stealth-key-snatch-play.ts [--seeds=7,1234] [--fault=<name>]
 *
 * Every `--fault=` injects one regression the gate exists to catch and must
 * turn it red.
 */

import { installBrowserShim } from './browserShim.js';
import { settleArrival } from './settleArrival.js';
import { useDevPlayerIdentity } from '../src/dev/devPlayerIdentity';
import { harnessHit } from './crawlerHitHarness';

useDevPlayerIdentity();

const VIEWPORT = { width: 1280, height: 720, devicePixelRatio: 1 } as const;
installBrowserShim(VIEWPORT);

const FIRST_SEED = 7;
const SECOND_SEED = 1234;
const DEFAULT_SEEDS: readonly number[] = [FIRST_SEED, SECOND_SEED];

const FAULTS = [
  /** The phase stops following the inventory. */
  'phase-ignores-key',
  /** The checkpoint forgets the phase. */
  'checkpoint-drops-phase',
  /** The door lets an unbriefed party in. */
  'door-always-open',
  /** The guard can be shoved. */
  'guard-shoves',
  /** A restored phase leaves the gate as the map had it. */
  'restore-skips-gate',
  /** Stepping onto the pedestal's front tile lifts nothing. */
  'pickup-ignored',
  /** The way out hands the clock back as if the floor had just begun. */
  'clock-from-zero',
  /** The save written on walking in puts the party at the floor's start, not at the door. */
  'door-save-elsewhere',
  /** The hire follows the party into the prison's held floor instead of being dismissed. */
  'hire-not-dismissed',
  /** The companions come back at the party's heels instead of at the waiting tiles. */
  'companions-not-seated',
  /** The companions stand where they were left for good. */
  'companions-stay-put',
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
const { BuildingInteriorScene } = await import('../src/scenes/BuildingInteriorScene.js');
const { GameMap } = await import('../src/map/GameMap.js');
const { dungeonOptionsForLevel } = await import('../src/levels/dungeonOptions.js');
const { level2 } = await import('../src/levels/level2.js');
const { sceneSetupFromSave } = await import('../src/scenes/resumeFromSave.js');
const { parsePersistedWorldState } = await import('../src/core/save/PersistedWorldState.js');
const { StealthKeySnatchSystem } =
  await import('../src/systems/stealthKeySnatch/StealthKeySnatchSystem.js');
const { PRISON_KEY_ITEM } =
  await import('../src/systems/stealthKeySnatch/stealthKeySnatchVisit.js');
const { PRISON_DOOR_UNBRIEFED_REFUSAL } =
  await import('../src/systems/stealthKeySnatch/prisonDoorGate.js');
const { GATE_LOCKED_BARK } = await import('../src/dialog/scripts/scenes/stealthKeySnatch.js');
const { PrisonGoblin } = await import('../src/creatures/PrisonGoblin.js');
const { Deinonychus } = await import('../src/creatures/Deinonychus.js');
const { Mercenary } = await import('../src/creatures/Mercenary.js');
const { MercenarySystem } = await import('../src/systems/MercenarySystem.js');
const { createMercenaryRoster } = await import('../src/core/party/MercenaryRoster.js');
const { getMercenaryTemplate } = await import('../src/core/party/mercenaryTemplates.js');
const { PrisonKeySystem } = await import('../src/systems/stealthKeySnatch/PrisonKeySystem.js');
const { GoblinPrisonSystem } =
  await import('../src/systems/stealthKeySnatch/GoblinPrisonSystem.js');
const { settings } = await import('../src/core/input/Settings.js');
const { DIFFICULTY_ORDER } = await import('../src/core/difficulty/difficultyProfiles.js');
const { PetNameBook, parsePetName } = await import('../src/core/party/petNames.js');

type Scene = InstanceType<typeof DungeonScene>;
type LiveMap = InstanceType<typeof GameMap>;
type Manager = InstanceType<typeof SceneManager>;
type Entry = LiveMap['buildingEntries'][number];
type Room = NonNullable<LiveMap['stealthGateRoom']>;
type Crawler = ReturnType<Scene['pm']['active']>;
type SaveOptions = NonNullable<ConstructorParameters<typeof DungeonScene>[3]>;
type SavedProgress = Parameters<NonNullable<SaveOptions['saveProgress']>>[0];
type Tile = { readonly x: number; readonly y: number };
type Phase = InstanceType<typeof StealthKeySnatchSystem>['phase'];

/** Frames ticked after the arrival screen so the floor's arrival save is behind us. */
const SETTLE_FRAMES = 30;
/** Presses given to a conversation to reach its end, well past any line count. */
const MAX_ADVANCES = 200;
/** Frames a pressed-against gate is given to rattle. */
const BUMP_FRAMES = 3;
/** Frames waited out so a second rattle is not still on cooldown. */
const RATTLE_COOLDOWN_WAIT_FRAMES = 120;
const SHOVE_PX = TILE_SIZE * 2;
const KNOCKBACK_FRAMES = 20;
const BLOW_DAMAGE = 50;
/** The boss whose safe room lies past the stealth gate. */
const BOSS_PAST_GATE = 'big_rooster';
/** Frames spent inside the prison after the capture: more than a minute of a running clock. */
const FRAMES_INSIDE = 4000;
/** More frames than a whole capture takes. */
const CAPTURE_WAIT_FRAMES = 600;
/** Frames the companions are given to come back to the party. */
const REJOIN_FRAMES = 600;
/** How close, in tiles, a companion must come to count as back with the party. */
const REJOIN_REACH_TILES = 4;
const HIRE_ID = 'crush';
/** The one tier that holds a floor to its time limit, so the HUD shows one. */
const NIGHTMARE = 'hard' as const;

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
  const proto = StealthKeySnatchSystem.prototype;
  switch (active) {
    case null:
      return;
    case 'phase-ignores-key':
      proto.syncWithInventories = () => undefined;
      return;
    case 'checkpoint-drops-phase':
      proto.captureCheckpoint = function () {
        return { phase: 'unmet', explainerSeen: this.explainerSeen };
      };
      return;
    case 'door-always-open':
      Object.defineProperty(proto, 'isGuardBriefed', { get: () => true });
      return;
    case 'guard-shoves':
      PrisonGoblin.prototype['acceptsShove'] = () => true;
      return;
    case 'pickup-ignored':
      PrisonKeySystem.prototype.update = () => undefined;
      return;
    case 'clock-from-zero': {
      const sceneProto = DungeonScene.prototype;
      const apply: unknown = Reflect.get(sceneProto, 'applyInteriorReturn');
      if (typeof apply !== 'function') throw new Error('DungeonScene has no applyInteriorReturn');
      sceneProto['applyInteriorReturn'] = function (this: Scene, held) {
        Reflect.apply(apply, this, [{ ...held, floorElapsedFrames: 0 }]);
      };
      return;
    }
    case 'door-save-elsewhere': {
      const sceneProto = DungeonScene.prototype;
      const save: unknown = Reflect.get(sceneProto, 'captureSavePoint');
      if (typeof save !== 'function') throw new Error('DungeonScene has no captureSavePoint');
      sceneProto['captureSavePoint'] = function (this: Scene, tile) {
        const room = this['gameMap'].stealthGateRoom;
        const atPrisonDoor = room !== null && tile.y === room.prisonDoor.approachRow + 1;
        Reflect.apply(save, this, [atPrisonDoor ? this['gameMap'].startTile : tile]);
      };
      return;
    }
    case 'hire-not-dismissed':
      MercenarySystem.prototype.dismissForTransition = () => undefined;
      return;
    case 'companions-not-seated':
      DungeonScene.prototype['seatCompanionsAtPrisonDoor'] = () => undefined;
      return;
    case 'companions-stay-put':
      Deinonychus.prototype.updateAI = () => undefined;
      Mercenary.prototype.updateAI = () => undefined;
      return;
    case 'restore-skips-gate': {
      const restore: unknown = Reflect.get(proto, 'restoreCheckpoint');
      if (typeof restore !== 'function') throw new Error('the quest has no restoreCheckpoint');
      proto.restoreCheckpoint = function (snapshot) {
        const gate = this['deps'].gameMap.stealthGateState();
        Reflect.apply(restore, this, [snapshot]);
        this['deps'].gameMap.setStealthGate(gate);
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

function currentScene(manager: Manager): unknown {
  return manager['current'];
}

function placeParty(scene: Scene, tile: Tile): void {
  for (const crawler of scene.pm.wholeParty()) placeAt(crawler, tile);
}

function tick(scene: Scene, frames: number): void {
  for (let frame = 0; frame < frames; frame++) {
    for (const crawler of scene.pm.wholeParty()) crawler.hp = crawler.maxHp;
    scene.update();
  }
}

/** Presses Space at the scene's interact chain from where the active crawler stands. */
function press(scene: Scene): boolean {
  return scene['tryWalkedUpToInteraction'](scene.pm.active(), false, scene['interactionStance']());
}

/** Pages through whatever conversation is open until it closes. */
function finishConversation(scene: Scene): boolean {
  const conversation = scene['conversation'];
  for (let step = 0; step < MAX_ADVANCES && conversation.isOpen; step++) {
    conversation.update(null);
    conversation.advance();
  }
  return !conversation.isOpen;
}

/** A floor tile inside the gate room beside a gate tile, as far from the guard as the gate allows. */
function insideBesideGate(room: Room, map: LiveMap): { stand: Tile; gate: Tile } | null {
  const inRoom = (tile: Tile): boolean =>
    tile.x >= room.bounds.x &&
    tile.y >= room.bounds.y &&
    tile.x < room.bounds.x + room.bounds.w &&
    tile.y < room.bounds.y + room.bounds.h;
  let best: { stand: Tile; gate: Tile; distance: number } | null = null;
  for (const gate of room.gateTiles) {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const stand = { x: gate.x + dx, y: gate.y + dy };
      if (!inRoom(stand) || !map.isWalkable(stand.x, stand.y, 'walker')) continue;
      if (map.isStealthGateTile(stand.x, stand.y)) continue;
      const distance = Math.hypot(stand.x - room.guardTile.x, stand.y - room.guardTile.y);
      if (best === null || distance > best.distance) best = { stand, gate, distance };
    }
  }
  return best === null ? null : { stand: best.stand, gate: best.gate };
}

/**
 * Whether the gateway safe room before Big Rooster's gym can be walked to from `from`, with the
 * nursery's exit and the bathroom queue out of the question: only the gate
 * is being asked about.
 */
function gatewayReachable(map: LiveMap, from: Tile): boolean {
  const gateway = map.safeRooms.find((room) => room.guardsBossType === BOSS_PAST_GATE);
  if (gateway === undefined) return false;
  const questExit = map.captureCheckpoint().questExitDoorState;
  map.setQuestExitDoorState('smashed');
  const seen = new Set<number>();
  const width = map.structure[0]?.length ?? 0;
  const queue: Tile[] = [from];
  seen.add(from.y * width + from.x);
  let reached = false;
  const { bounds } = gateway;
  while (queue.length > 0) {
    const tile = queue.shift();
    if (tile === undefined) break;
    if (
      tile.x >= bounds.x &&
      tile.y >= bounds.y &&
      tile.x < bounds.x + bounds.w &&
      tile.y < bounds.y + bounds.h
    ) {
      reached = true;
      break;
    }
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const next = { x: tile.x + dx, y: tile.y + dy };
      const key = next.y * width + next.x;
      if (seen.has(key) || !map.isWalkableIgnoringBathroomQueue(next.x, next.y, 'walker')) continue;
      seen.add(key);
      queue.push(next);
    }
  }
  map.setQuestExitDoorState(questExit);
  return reached;
}

function tileOf(body: { readonly x: number; readonly y: number }): Tile {
  return { x: Math.round(body.x / TILE_SIZE), y: Math.round(body.y / TILE_SIZE) };
}

function sameTile(a: Tile, b: Tile): boolean {
  return a.x === b.x && a.y === b.y;
}

/**
 * The names of a run whose Deinonychus has joined: he is named as he joins,
 * and an unnamed one would hold the floor behind the naming prompt.
 */
function namedPets(): InstanceType<typeof PetNameBook> {
  const book = new PetNameBook();
  const name = parsePetName('Talon');
  if (name === null) throw new Error('the test pet name is not a legal name');
  book.give('deinonychus', name);
  return book;
}

/** A Barracks hire already under contract for floor 2. */
function hireRoster(): ReturnType<typeof createMercenaryRoster> {
  const roster = createMercenaryRoster();
  roster.floorLevelId = level2.id;
  roster.active = {
    id: HIRE_ID,
    name: getMercenaryTemplate(HIRE_ID).name,
    terms: 'paid',
    contractLevelId: level2.id,
    introduced: true,
  };
  return roster;
}

function companionsOf(scene: Scene): {
  deinonychus: Scene['world']['roster']['mobs'][number] | null;
  hire: Scene['world']['roster']['mobs'][number] | null;
} {
  return {
    deinonychus: scene['deinonychusSystem'].deinonychus,
    hire: scene['mercenarySystem'].activeMerc,
  };
}

/**
 * With the party walked off, both companions come back to it.
 *
 * The floor's own hostiles are cleared first: the companions wait at the edge
 * of the gate room, and a pack spawned in the room next door picks a fight
 * with them, which a hire rightly answers instead of walking back. This
 * measures the walk back, not that fight.
 */
function verifyCompanionsRejoin(scene: Scene, partyTile: Tile, label: string): void {
  const roster = scene['world'].roster;
  roster.replaceAll(roster.mobs.filter((mob) => !mob.isHostileTarget));
  placeParty(scene, partyTile);
  const party = scene.pm.active();
  for (let frame = 0; frame < REJOIN_FRAMES; frame++) {
    for (const crawler of scene.pm.wholeParty()) {
      crawler.hp = crawler.maxHp;
      placeAt(crawler, partyTile);
    }
    scene.update();
  }
  const { deinonychus, hire } = companionsOf(scene);
  for (const [name, companion] of [
    ['Deinonychus', deinonychus],
    ['the hire', hire],
  ] as const) {
    const reach =
      companion === null
        ? Number.POSITIVE_INFINITY
        : Math.hypot(companion.x - party.x, companion.y - party.y) / TILE_SIZE;
    check(
      reach <= REJOIN_REACH_TILES,
      `${label}: ${name} rejoins the party after the prison (${reach.toFixed(1)} tiles off)`,
    );
  }
}

/** The save written at the prison door is what a reload inside the prison resumes from. */
function verifyReloadInside(save: SavedProgress, doorStep: Tile, label: string): void {
  const { levelDef, options } = sceneSetupFromSave({ skipIntro: true }, structuredClone(save));
  const reloaded = new DungeonScene(levelDef, new InputManager(), new SceneManager(), options);
  check(levelDef.id === level2.id, `${label}: a reload inside the prison resumes on floor 2`);
  const at = tileOf(reloaded.pm.active());
  check(
    Math.abs(at.x - doorStep.x) <= 1 && Math.abs(at.y - doorStep.y) <= 1,
    `${label}: a reload inside the prison resumes outside its door (${JSON.stringify(at)} vs ${JSON.stringify(doorStep)})`,
  );
  check(
    reloaded.stealthKeySnatch.phase === 'briefed',
    `${label}: a reload inside the prison keeps the phase at the door (${reloaded.stealthKeySnatch.phase})`,
  );
  check(
    reloaded['gameMap'].stealthGateState() === 'locked',
    `${label}: a reload inside the prison keeps the gate locked`,
  );
  reloaded.onExit();
}

function guardMarker(scene: Scene): string {
  return scene.stealthKeySnatch.guard?.marker ?? 'no guard';
}

/** Writes a save where the party stands and returns it, or undefined when none was written. */
function writeSave(scene: Scene, saves: SavedProgress[]): SavedProgress | undefined {
  const tile = {
    x: Math.round(scene.pm.active().x / TILE_SIZE),
    y: Math.round(scene.pm.active().y / TILE_SIZE),
  };
  const before = saves.length;
  scene['captureSavePoint'](tile);
  return saves.length > before ? saves[saves.length - 1] : undefined;
}

/** Saves where the party stands, reloads the save the way a page reload does, and returns the reloaded scene. */
function saveAndReload(scene: Scene, saves: SavedProgress[]): Scene | null {
  const save = writeSave(scene, saves);
  if (save === undefined) return null;
  const { levelDef, options } = sceneSetupFromSave({ skipIntro: true }, structuredClone(save));
  return new DungeonScene(levelDef, new InputManager(), new SceneManager(), options);
}

function verifyReload(scene: Scene, saves: SavedProgress[], expected: Phase, label: string): void {
  const reloaded = saveAndReload(scene, saves);
  check(reloaded !== null, `${label}: a save is written`);
  if (reloaded === null) return;
  const phase = reloaded.stealthKeySnatch.phase;
  check(phase === expected, `${label}: reloads ${expected} (reloads ${phase})`);
  const gate = reloaded['gameMap'].stealthGateState();
  const expectedGate = expected === 'opened' ? 'open' : 'locked';
  check(gate === expectedGate, `${label}: the gate reloads ${expectedGate} (reloads ${gate})`);
  reloaded.onExit();
}

/** A stored save missing the stealth gate quest fails validation instead of loading it unmet. */
function verifySaveWithoutQuestRejected(scene: Scene, saves: SavedProgress[], label: string): void {
  const persisted = writeSave(scene, saves)?.world?.persisted;
  check(persisted !== undefined, `${label}: a save with a persisted world is written`);
  if (persisted === undefined) return;
  const { stealthKeySnatch: _dropped, ...withoutQuest } = persisted;
  const stored: unknown = JSON.parse(JSON.stringify(withoutQuest));
  check(
    parsePersistedWorldState(stored) === undefined,
    `${label}: a save without the quest passes validation`,
  );
}

/** Nothing the party does hurts, moves or holds the gate guard. */
function verifyGuardImmovable(scene: Scene, label: string): void {
  const guard = scene.stealthKeySnatch.guard;
  if (guard === null) return;
  const at = { x: guard.x, y: guard.y };
  const hp = guard.hp;
  const human = scene.pm.human;
  guard.shoveTo(guard.x + SHOVE_PX, guard.y);
  guard.applyKnockback(1, 0, SHOVE_PX, KNOCKBACK_FRAMES);
  for (let frame = 0; frame < KNOCKBACK_FRAMES; frame++) guard.advanceKnockback();
  guard.applyHitSlow();
  guard.takeHit(harnessHit(human, BLOW_DAMAGE, 'melee'));
  guard.takeHit(harnessHit(human, BLOW_DAMAGE, 'explosion'));
  check(
    guard.x === at.x && guard.y === at.y,
    `${label}: the guard stays put under a shove, a knockback and blows`,
  );
  check(guard.hp === hp && guard.isAlive, `${label}: the guard takes no damage`);
  check(!guard.isSlowed, `${label}: the guard takes no slow`);
  check(guard.takeStrikes() > 0, `${label}: the blows reached the guard and were counted`);
  check(guard.speech.current !== null, `${label}: a blow makes the guard bark`);
  check(
    !guard.isHostile && !guard.isPetAttackable && !guard.countsTowardRoomClear,
    `${label}: the guard is nobody's enemy`,
  );
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
  const room = map.stealthGateRoom;
  check(room !== null, `${label}: floor 2 has a stealth gate room`);
  if (room === null) return;
  const entry: Entry | undefined = map.buildingEntries.find((e) => e.type === 'prison');
  check(entry !== undefined, `${label}: the gate room has a prison door`);
  if (entry === undefined) return;

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
    deinonychusUnlocked: true,
    deinonychusWasOut: true,
    petNames: namedPets(),
    mercenaryRoster: hireRoster(),
  });
  sceneManager.replace(outside);
  const ctx = sceneManager.canvas.getContext('2d');
  if (ctx === null) throw new Error('the shim canvas has no 2d context');
  check(await settleArrival(outside, ctx), `${label}: the floor's arrival screen finishes`);
  const hasTalkTile = room.guardTalkTiles.length > 0;
  check(hasTalkTile, `${label}: the guard has a talk tile`);
  if (!hasTalkTile) return;
  const talkTile = room.guardTalkTiles[0];
  placeParty(outside, talkTile);
  tick(outside, SETTLE_FRAMES);

  const quest = outside.stealthKeySnatch;
  const guard = quest.guard;
  check(guard !== null, `${label}: the gate guard is standing`);
  if (guard === null) return;
  check(outside['world'].roster.mobs.includes(guard), `${label}: the guard is in the roster`);

  // ── Unmet ──
  check(quest.phase === 'unmet', `${label}: the quest starts unmet (${quest.phase})`);
  check(guardMarker(outside) === 'exclamation', `${label}: the guard wears '!'`);
  check(map.stealthGateState() === 'locked', `${label}: the gate starts locked`);
  check(
    room.gateTiles.every((tile) => !map.isWalkable(tile.x, tile.y, 'walker')),
    `${label}: the locked gate cannot be walked through`,
  );
  check(
    !gatewayReachable(map, talkTile),
    `${label}: Big Rooster's gateway cannot be reached while the gate is locked`,
  );
  check(
    outside['sealedBuildingMessage'](entry) === PRISON_DOOR_UNBRIEFED_REFUSAL,
    `${label}: the prison door refuses an unbriefed party`,
  );
  check(
    quest.trackerEntries()[0]?.target === room.guardTile,
    `${label}: the tracker points at the guard while unmet`,
  );
  check(
    quest.questMarkers.length === 1,
    `${label}: the minimap shows the guard's marker while unmet`,
  );
  verifyReload(outside, saves, 'unmet', `${label} unmet`);
  verifyGuardImmovable(outside, label);

  const beside = insideBesideGate(room, map);
  check(beside !== null, `${label}: there is floor inside the room beside the gate`);
  if (beside !== null) {
    tick(outside, RATTLE_COOLDOWN_WAIT_FRAMES);
    guard.speech.clear();
    const active = outside.pm.active();
    placeParty(outside, beside.stand);
    for (let frame = 0; frame < BUMP_FRAMES; frame++) {
      active.facingX = Math.sign(beside.gate.x - beside.stand.x);
      active.facingY = Math.sign(beside.gate.y - beside.stand.y);
      active.isMoving = true;
      quest.update(outside['buildSystemContext']());
    }
    check(
      guard.speech.current === GATE_LOCKED_BARK.paragraphs[0],
      `${label}: walking into the locked gate draws the guard's bark (${String(guard.speech.current)})`,
    );
    active.isMoving = false;
  }

  // ── Briefed ──
  placeParty(outside, talkTile);
  check(press(outside), `${label}: Space by the guard talks to him`);
  check(quest.isDialogOpen, `${label}: the guard's briefing opens`);
  check(finishConversation(outside), `${label}: the briefing can be read to the end`);
  check(quest.phase === 'briefed', `${label}: the briefing briefs (${quest.phase})`);
  check(quest.questStatus === 'active', `${label}: the quest is active after the briefing`);
  outside.update();
  check(guardMarker(outside) === 'none', `${label}: the guard's marker goes after the briefing`);
  check(
    room.prisonDoor.approachTiles.some((tile) => tile === quest.trackerEntries()[0]?.target),
    `${label}: the tracker points at the prison door while briefed`,
  );
  check(
    outside['sealedBuildingMessage'](entry) === null,
    `${label}: the prison door opens once briefed`,
  );
  if (beside !== null) {
    guard.speech.clear();
    placeParty(outside, beside.stand);
    check(press(outside), `${label}: Space at the gate is taken`);
    check(
      map.stealthGateState() === 'locked',
      `${label}: Space at the gate without a key opens nothing`,
    );
    check(
      guard.speech.current === GATE_LOCKED_BARK.paragraphs[0],
      `${label}: Space at the gate without a key draws the bark`,
    );
  }
  verifyReload(outside, saves, 'briefed', `${label} briefed`);

  // ── Into the prison and out with the key ──
  const companionsOut = companionsOf(outside);
  check(
    companionsOut.deinonychus !== null && companionsOut.hire !== null,
    `${label}: Deinonychus and the hire are out before the prison`,
  );
  const doorStep = room.prisonDoor.approachTiles[0] ?? talkTile;
  placeParty(outside, doorStep);
  const clockAtDoor = outside.floorClockElapsedFrames;
  const timeLeftAtDoor = (level2.nightmareTimeLimitFrames ?? 0) - clockAtDoor;
  const building = outside['building'];
  check(building !== null, `${label}: the floor builds the door system`);
  if (building === null) return;
  const savesBeforeEntry = saves.length;
  building['onEnterBuilding'](entry);
  check(
    currentScene(sceneManager) === outside && outside['prisonDifficulty'].isPickerOpen,
    `${label}: the prison door asks for a difficulty before it opens`,
  );
  const worldDifficulty = settings.difficulty;
  const pickedDifficulty = DIFFICULTY_ORDER.find((tier) => tier !== worldDifficulty) ?? 'hard';
  outside['prisonDifficulty'].choose(pickedDifficulty);
  const doorSave: SavedProgress | undefined =
    saves.length > savesBeforeEntry ? saves[saves.length - 1] : undefined;
  check(doorSave !== undefined, `${label}: walking into the prison writes a save at the door`);
  const outsideMobs = outside['world'].roster.mobs;
  check(
    (companionsOut.deinonychus === null || !outsideMobs.includes(companionsOut.deinonychus)) &&
      (companionsOut.hire === null || !outsideMobs.includes(companionsOut.hire)),
    `${label}: Deinonychus and the hire are dismissed at the prison door`,
  );
  const inside = currentScene(sceneManager);
  check(inside instanceof BuildingInteriorScene, `${label}: the prison door leads inside`);
  if (!(inside instanceof BuildingInteriorScene)) return;
  const prisonVariant = inside['floor'].variant;
  check(
    typeof prisonVariant === 'object' &&
      prisonVariant.kind === 'goblin_prison' &&
      prisonVariant.plan.difficulty === pickedDifficulty,
    `${label}: the prison is planned at the picked difficulty`,
  );
  check(
    settings.difficulty === worldDifficulty,
    `${label}: picking the prison's difficulty leaves the world difficulty alone`,
  );
  check(await settleArrival(inside, ctx), `${label}: the prison's arrival screen finishes`);
  check(
    inside['deinonychusSystem'].deinonychus === null &&
      inside['mercenarySystem'].activeMerc === null,
    `${label}: no companion comes into the prison`,
  );
  const visit = inside['floor'].stealthKeySnatch;
  const prisonKey = inside['prisonKey'];
  const encounter = inside['encounter'];
  const prison = encounter instanceof GoblinPrisonSystem ? encounter : null;
  check(visit !== undefined, `${label}: the prison sees the quest through its floor context`);
  check(prisonKey !== null && prison !== null, `${label}: the prison runs its key and guards`);
  if (visit === undefined || prisonKey === null || prison === null) return;
  check(visit.phase === 'briefed', `${label}: the prison reads the quest briefed`);
  check(prisonKey.isPrisonExplainerOpen, `${label}: the first visit opens the explainer`);
  prisonKey.finishPrisonExplainer();
  check(visit.explainerSeen, `${label}: reading the explainer marks it read`);

  const leader = inside.pm.active();
  const front = prisonKey.pedestalFront;
  placeAt(leader, { x: front.x, y: front.y + 1 });
  inside.update();
  placeAt(leader, front);
  inside.update();
  const [insideHuman, insideCat] = inside.pm.wholeParty();
  const keysInside =
    insideHuman.inventory.countOf(PRISON_KEY_ITEM) + insideCat.inventory.countOf(PRISON_KEY_ITEM);
  check(keysInside === 1, `${label}: walking up within a tile of the pedestal lifts the key`);
  check(
    visit.phase === 'keyHeld',
    `${label}: lifting the key inside reads keyHeld (${visit.phase})`,
  );
  prison.capture();
  for (let frame = 0; frame < CAPTURE_WAIT_FRAMES && prison.isCapturing; frame++) inside.update();
  check(!prison.isCapturing, `${label}: a capture inside runs to its end`);
  for (let frame = 0; frame < FRAMES_INSIDE; frame++) inside.update();
  const worldTier = settings.difficulty;
  settings.setDifficultyForSession(NIGHTMARE);
  const heldClock = inside['hudModel']().levelTimer;
  settings.setDifficultyForSession(worldTier);
  check(
    heldClock !== null && heldClock.frames === timeLeftAtDoor && heldClock.paused,
    `${label}: Nightmare's time limit indoors reads ${timeLeftAtDoor}, paused, after a capture and ${FRAMES_INSIDE} frames (${JSON.stringify(heldClock)})`,
  );
  if (doorSave !== undefined) verifyReloadInside(doorSave, doorStep, label);

  inside['doExit']();
  const back = currentScene(sceneManager);
  check(back instanceof DungeonScene && back !== outside, `${label}: the door leads back out`);
  if (!(back instanceof DungeonScene)) return;
  check(
    back.floorClockElapsedFrames === clockAtDoor,
    `${label}: the clock reads ${clockAtDoor} on the way out (${back.floorClockElapsedFrames})`,
  );
  check(await settleArrival(back, ctx), `${label}: the floor's arrival finishes on the way out`);
  back.update();
  const companionsBack = companionsOf(back);
  check(
    companionsBack.deinonychus !== null && companionsBack.hire !== null,
    `${label}: Deinonychus and the hire are back on the floor after the prison`,
  );
  check(
    companionsBack.deinonychus !== null &&
      sameTile(tileOf(companionsBack.deinonychus), room.waitingTiles.deinonychus),
    `${label}: Deinonychus waits on his gate-room tile (${JSON.stringify(companionsBack.deinonychus === null ? null : tileOf(companionsBack.deinonychus))} vs ${JSON.stringify(room.waitingTiles.deinonychus)})`,
  );
  check(
    companionsBack.hire !== null &&
      sameTile(tileOf(companionsBack.hire), room.waitingTiles.hireling),
    `${label}: the hire waits on its gate-room tile`,
  );
  const clockOut = back.floorClockElapsedFrames;
  verifyCompanionsRejoin(back, talkTile, label);
  check(
    back.floorClockElapsedFrames > clockOut,
    `${label}: the clock runs again outside the prison`,
  );
  const backQuest = back.stealthKeySnatch;
  check(backQuest.phase === 'keyHeld', `${label}: the key comes back out (${backQuest.phase})`);
  check(backQuest.explainerSeen, `${label}: the explainer stays read after the visit`);
  back.update();
  check(guardMarker(back) === 'question', `${label}: the guard wears '?' with the key held`);
  check(
    backQuest.trackerEntries()[0]?.target === room.guardTile,
    `${label}: the tracker points at the guard with the key held`,
  );
  verifyReload(back, saves, 'keyHeld', `${label} keyHeld`);

  // ── The phase follows the key ──
  const human = back.pm.human;
  const cat = back.pm.cat;
  human.inventory.clearQuestItem(PRISON_KEY_ITEM);
  back.update();
  check(backQuest.phase === 'briefed', `${label}: losing the key drops back to briefed`);
  cat.inventory.addItem(PRISON_KEY_ITEM, 1);
  back.update();
  check(backQuest.phase === 'keyHeld', `${label}: the cat carrying the key reads keyHeld`);

  // ── Hand it over ──
  const humanBefore = { level: human.level, xp: human.xp };
  placeParty(back, talkTile);
  check(press(back), `${label}: Space by the guard with the key talks to him`);
  check(finishConversation(back), `${label}: the hand-over can be read to the end`);
  check(backQuest.phase === 'opened', `${label}: handing the key over opens (${backQuest.phase})`);
  check(map.stealthGateState() === 'open', `${label}: the gate is open after the hand-over`);
  check(backQuest.questStatus === 'completed', `${label}: the quest completes`);
  check(
    human.inventory.countOf(PRISON_KEY_ITEM) === 0 && cat.inventory.countOf(PRISON_KEY_ITEM) === 0,
    `${label}: the guard takes the key`,
  );
  const humanGained =
    human.level > humanBefore.level ||
    (human.level === humanBefore.level && human.xp > humanBefore.xp);
  check(humanGained, `${label}: the quest pays XP`);
  check(
    room.gateTiles.every((tile) => map.isWalkable(tile.x, tile.y, 'walker')),
    `${label}: the open gate can be walked through`,
  );
  check(
    gatewayReachable(map, talkTile),
    `${label}: Big Rooster's gateway can be reached once the gate is open`,
  );
  back.update();
  check(guardMarker(back) === 'none', `${label}: the guard's marker goes once the gate is open`);
  verifyReload(back, saves, 'opened', `${label} opened`);
  verifySaveWithoutQuestRejected(back, saves, `${label} save without the quest`);
  back.onExit();

  await verifyGateUnlock(worldSeed, ctx, label);
  console.log(`${label}: done`);
}

/** Space at the gate with the key opens it without a word with the guard. */
async function verifyGateUnlock(
  worldSeed: number,
  ctx: CanvasRenderingContext2D,
  label: string,
): Promise<void> {
  Math.random = mulberry32(worldSeed);
  const map = new GameMap({
    mapSize: level2.mapSize,
    tileHeight: TILE_SIZE,
    mapType: 'dungeon',
    dungeon: dungeonOptionsForLevel(level2),
    worldSeed,
  });
  const room = map.stealthGateRoom;
  if (room === null) return;
  const scene = new DungeonScene(level2, new InputManager(), new SceneManager(), {
    existingMap: map,
    worldSeed,
    skipIntro: true,
  });
  check(await settleArrival(scene, ctx), `${label}: the second floor's arrival finishes`);
  const quest = scene.stealthKeySnatch;
  quest.restoreCheckpoint({ phase: 'briefed', explainerSeen: false });
  const crawler: Crawler = scene.pm.active();
  crawler.inventory.addItem(PRISON_KEY_ITEM, 1);
  const beside = insideBesideGate(room, map);
  if (beside === null) return;
  placeParty(scene, beside.stand);
  scene.update();
  check(quest.phase === 'keyHeld', `${label}: the key read from the inventory (${quest.phase})`);
  check(press(scene), `${label}: Space at the gate with the key is taken`);
  check(quest.phase === 'opened', `${label}: Space at the gate with the key opens it`);
  check(map.stealthGateState() === 'open', `${label}: the gate is open after Space at it`);
  scene.onExit();
}

for (const worldSeed of seeds) await verifySeed(worldSeed);

const faultNote = fault === null ? '' : ` (fault: ${fault})`;
console.log(
  failures === 0
    ? `\nAll ${checks} stealth-key-snatch checks passed${faultNote}.`
    : `\n${failures} of ${checks} check(s) failed${faultNote}.`,
);
process.exit(failures === 0 ? 0 : 1);
