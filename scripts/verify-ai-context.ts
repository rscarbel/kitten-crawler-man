#!/usr/bin/env tsx
/**
 * Headless checks on what the game tells the AI server.
 *
 * Merge patches must round-trip (RFC 7386, its own examples included), the
 * snapshot differ must send a full state first, then patches, never faster
 * than its interval and never when nothing changed. `context_set` must go out
 * only when the session or its flags change. Kills must arrive rolled up per
 * fight and dodges sampled, Mordecai must perceive only what happens in front
 * of him while the System perceives everything, a party sitting on potions at
 * low HP must be reported, a new floor must raise a reflection-worthy event,
 * and the SDK transport must hand the client the whole state the patches
 * describe.
 *
 *   npx tsx scripts/verify-ai-context.ts
 */

import { crawlerName } from '../src/characters/characters';
import { TILE_SIZE } from '../src/core/constants';
import { EventBus } from '../src/core/EventBus';
import { makePoison } from '../src/core/combat/StatusEffect';
import { PlayerManager } from '../src/core/party/PlayerManager';
import { Mob } from '../src/creatures/Mob';
import type { Player } from '../src/Player';
import { MORDECAI_CHARACTER_NAME, SYSTEM_CHARACTER_NAME } from '../src/ai/characters';
import { AIContextBuilder, type ContextMessage } from '../src/ai/context/AIContextBuilder';
import {
  DODGE_SAMPLE_WINDOW_MS,
  KILL_ROLLUP_QUIET_MS,
  perceiversOf,
} from '../src/ai/context/gameEventStream';
import {
  applyMergePatch,
  createMergePatch,
  jsonEqual,
  type JsonObject,
  type JsonValue,
} from '../src/ai/context/json';
import { IMPORTANCE } from '../src/ai/context/eventImportance';
import { SnapshotDiffer } from '../src/ai/context/liveState';
import type { ContextUpdate } from '@rscarbel/game-server-llm-sdk';
import { SdkContextTransport } from '../src/ai/context/transport';
import type {
  AIContextSource,
  CrawlerName,
  CrawlerState,
  GameEvent,
  LiveInput,
  SessionInput,
} from '../src/ai/context/types';
import { StatusChangeWatcher } from '../src/systems/statusChangeEvents';

const SNAPSHOT_INTERVAL_MS = 1_000;
const HALF_INTERVAL_MS = 500;
const PROFILE_INTERVAL_MS = 60_000;
const START_MS = 1_000_000;
const PARTY_TILE = 5;
const DUMMY_HP = 10;
const DUMMY_SPEED = 0;
const KILLS_IN_FIGHT = 5;
const KILL_SPACING_MS = 400;
const DODGES = 4;
const SECONDS_PER_MINUTE = 60;
/** Far from the low-timer line, so `levelTimerLow` stays false unless a check lowers it. */
const FAKE_LEVEL_TIMER_MINUTES = 40;
const LOW_HP = 5;
const FULL_HP = 100;
const POTIONS_HELD = 3;
const STOCKPILING_WAIT_MS = 9_000;
const BATCH_LIMIT = 3;
const MANY_EVENTS = 7;
/** The safe-room fight, the death and the cat's potion: all Mordecai saw in the witness-scoping run. */
/** The events the witness-scoping test emits: a corridor fight, a safe-room fight, a boss fight, a death. */
const SCOPING_EVENTS = 4;
const WITNESSED_IN_SCOPING_TEST = 3;
const RANDOM_ROUNDS = 300;
const RANDOM_KEYS = ['a', 'b', 'c', 'd'] as const;
const RANDOM_DEPTH = 3;
const RANDOM_LEAF_RANGE = 4;
const RANDOM_BRANCH_CHANCE = 0.3;
const RANDOM_KEEP_CHANCE = 0.7;
const RANDOM_ARRAY_CHANCE = 0.15;

let failures = 0;
let checks = 0;

function check(ok: boolean, message: string): void {
  checks++;
  if (ok) {
    console.log(`  ok   ${message}`);
    return;
  }
  failures++;
  console.error(`  FAIL ${message}`);
}

function section(name: string): void {
  console.log(`\n${name}`);
}

/** A target that stands where it is put and decides nothing. */
class Dummy extends Mob {
  readonly xpValue = 0;
  protected override get eyePlacement(): null {
    return null;
  }

  constructor(name: string, boss = false) {
    super(PARTY_TILE, PARTY_TILE, TILE_SIZE, DUMMY_HP, DUMMY_SPEED);
    this.displayName = name;
    this.isBoss = boss;
  }

  override updateAI(): void {
    // Placed by hand; never moves.
  }

  protected override drawSelf(): void {
    // Nothing here is ever rendered.
  }
}

// ── Merge patches ──────────────────────────────────────────────────────────

/** RFC 7386 appendix A, as [target, patch, result]. */
const RFC_EXAMPLES: Array<[JsonValue, JsonValue, JsonValue]> = [
  [{ a: 'b' }, { a: 'c' }, { a: 'c' }],
  [{ a: 'b' }, { b: 'c' }, { a: 'b', b: 'c' }],
  [{ a: 'b' }, { a: null }, {}],
  [{ a: 'b', b: 'c' }, { a: null }, { b: 'c' }],
  [{ a: ['b'] }, { a: 'c' }, { a: 'c' }],
  [{ a: 'c' }, { a: ['b'] }, { a: ['b'] }],
  [{ a: { b: 'c' } }, { a: { b: 'd', c: null } }, { a: { b: 'd' } }],
  [{ a: [{ b: 'c' }] }, { a: [1] }, { a: [1] }],
  [
    ['a', 'b'],
    ['c', 'd'],
    ['c', 'd'],
  ],
  [{ a: 'b' }, ['c'], ['c']],
  [{ a: 'foo' }, 'bar', 'bar'],
  [{ e: null }, { a: 1 }, { e: null, a: 1 }],
  [[1, 2], { a: 'b', c: null }, { a: 'b' }],
  [{}, { a: { bb: { ccc: null } } }, { a: { bb: {} } }],
];

/** A deterministic generator, so a failing round can be replayed. */
function seededRandom(seed: number): () => number {
  let state = seed;
  const MODULUS = 2_147_483_647;
  const MULTIPLIER = 48_271;
  return () => {
    state = (state * MULTIPLIER) % MODULUS;
    return state / MODULUS;
  };
}

function randomObject(random: () => number, depth: number): JsonObject {
  const out: JsonObject = {};
  for (const key of RANDOM_KEYS) {
    if (random() > RANDOM_KEEP_CHANCE) continue;
    if (depth > 0 && random() < RANDOM_BRANCH_CHANCE) {
      out[key] = randomObject(random, depth - 1);
    } else if (random() < RANDOM_ARRAY_CHANCE) {
      out[key] = [Math.floor(random() * RANDOM_LEAF_RANGE)];
    } else {
      out[key] = Math.floor(random() * RANDOM_LEAF_RANGE);
    }
  }
  return out;
}

function verifyMergePatches(): void {
  section('merge patches');
  RFC_EXAMPLES.forEach(([target, patch, result], i) => {
    check(jsonEqual(applyMergePatch(target, patch), result), `RFC 7386 example ${i + 1} applies`);
  });

  const random = seededRandom(1);
  let roundTrips = 0;
  let minimal = 0;
  for (let round = 0; round < RANDOM_ROUNDS; round++) {
    const prev = randomObject(random, RANDOM_DEPTH);
    const next = randomObject(random, RANDOM_DEPTH);
    const patch = createMergePatch(prev, next);
    const applied = patch === null ? prev : applyMergePatch(prev, patch);
    if (jsonEqual(applied, next)) roundTrips++;
    if ((patch === null) === jsonEqual(prev, next)) minimal++;
  }
  check(roundTrips === RANDOM_ROUNDS, `${roundTrips}/${RANDOM_ROUNDS} random patches round-trip`);
  check(minimal === RANDOM_ROUNDS, 'a patch is null exactly when nothing changed');

  const original: JsonObject = { a: { b: 1 } };
  applyMergePatch(original, { a: { b: 2 } });
  check(jsonEqual(original, { a: { b: 1 } }), 'applying a patch leaves the target untouched');
}

// ── Snapshot differ ────────────────────────────────────────────────────────

function verifySnapshotDiffer(): void {
  section('state snapshots');
  const differ = new SnapshotDiffer(SNAPSHOT_INTERVAL_MS);
  const first = differ.next({ hp: 10, pos: { x: 1, y: 1 } }, START_MS);
  check(first?.full !== undefined && first.patch === undefined, 'the first snapshot is full');
  check(
    differ.next({ hp: 9, pos: { x: 1, y: 1 } }, START_MS + HALF_INTERVAL_MS) === null,
    'a change inside the interval waits',
  );
  const later = differ.next({ hp: 9, pos: { x: 1, y: 1 } }, START_MS + SNAPSHOT_INTERVAL_MS);
  check(jsonEqual(later?.patch, { hp: 9 }), 'after the interval only the changed field is sent');
  check(
    differ.next({ hp: 9, pos: { x: 1, y: 1 } }, START_MS + 2 * SNAPSHOT_INTERVAL_MS) === null,
    'nothing is sent when nothing changed',
  );
  const moved = differ.next({ hp: 9, pos: { x: 2, y: 1 } }, START_MS + 2 * SNAPSHOT_INTERVAL_MS);
  check(jsonEqual(moved?.patch, { pos: { x: 2 } }), 'nested changes patch only the leaf');
  differ.reset();
  const resent = differ.next({ hp: 9 }, START_MS + 2 * SNAPSHOT_INTERVAL_MS);
  check(resent?.full !== undefined, 'after a reset the next snapshot is full again');
}

// ── A scriptable scene ─────────────────────────────────────────────────────

function crawler(name: CrawlerName, active: boolean): CrawlerState {
  return {
    name,
    hp: FULL_HP,
    maxHp: FULL_HP,
    level: 3,
    xp: 0,
    coins: 0,
    isActive: active,
    knockedOut: false,
    statusEffects: [],
    equipped: {},
    notableItems: {},
    healthPotions: 0,
    tileX: PARTY_TILE,
    tileY: PARTY_TILE,
  };
}

class FakeScene implements AIContextSource {
  session: SessionInput = {
    floorNumber: 1,
    levelId: 'level1',
    floorName: 'The Dungeon',
    levelTimerSeconds: FAKE_LEVEL_TIMER_MINUTES * SECONDS_PER_MINUTE,
    levelTimerRunning: true,
    difficulty: 'Normal',
    secondsPlayed: 0,
    deaths: 0,
    activeQuests: [],
    companions: [],
    indoors: false,
  };
  live: LiveInput = {
    activeCrawler: crawlerName('human'),
    crawlers: {
      human: crawler(crawlerName('human'), true),
      cat: crawler(crawlerName('cat'), false),
    },
    location: { kind: 'corridor', label: 'dark corridor', inSafeRoom: false, inBossArena: false },
    nearbyMobs: [],
    combatInProgress: false,
    bossFightActive: false,
    isPaused: false,
    menuOpen: false,
  };

  constructor(private readonly human: Player) {}

  readSession(): SessionInput {
    return { ...this.session };
  }

  readLive(): LiveInput {
    const { human, cat } = this.live.crawlers;
    return { ...this.live, crawlers: { human: { ...human }, cat: { ...cat } } };
  }

  /** Where the cat stands, apart from the active crawler (the human). */
  catInSafeRoom = false;

  isPartyInSafeRoom(): boolean {
    return this.live.location.inSafeRoom;
  }

  isCrawlerInSafeRoom(crawler: CrawlerName): boolean {
    return crawler === crawlerName('human') ? this.live.location.inSafeRoom : this.catInSafeRoom;
  }

  crawlerNameOf(player: Player): CrawlerName | null {
    return player === this.human ? crawlerName('human') : crawlerName('cat');
  }

  enterSafeRoom(inside: boolean): void {
    this.live.location = inside
      ? { kind: 'safeRoom', label: 'safe room', inSafeRoom: true, inBossArena: false }
      : { kind: 'corridor', label: 'dark corridor', inSafeRoom: false, inBossArena: false };
  }
}

interface Rig {
  bus: EventBus;
  scene: FakeScene;
  builder: AIContextBuilder;
  pm: PlayerManager;
  advance: (ms: number) => void;
}

function makeRig(): Rig {
  let now = START_MS;
  const pm = new PlayerManager(PARTY_TILE, PARTY_TILE, undefined);
  const bus = new EventBus();
  const scene = new FakeScene(pm.human);
  const builder = new AIContextBuilder({
    now: () => now,
    snapshotMinIntervalMs: SNAPSHOT_INTERVAL_MS,
    profileIntervalMs: PROFILE_INTERVAL_MS,
    maxEventsPerBatch: BATCH_LIMIT,
  });
  builder.bind(bus, scene);
  return {
    bus,
    scene,
    builder,
    pm,
    advance: (ms) => {
      now += ms;
    },
  };
}

/** The item at `index`, or undefined past the end; this tsconfig does not add that to indexing. */
function itemAt<T>(items: readonly T[], index: number): T | undefined {
  return index < items.length ? items[index] : undefined;
}

function ofType<T extends ContextMessage['type']>(
  messages: ContextMessage[],
  type: T,
): Array<Extract<ContextMessage, { type: T }>> {
  return messages.filter(
    (message): message is Extract<ContextMessage, { type: T }> => message.type === type,
  );
}

function eventsIn(messages: ContextMessage[]): GameEvent[] {
  return ofType(messages, 'event_log').flatMap((message) => message.payload.events);
}

// ── Session context ────────────────────────────────────────────────────────

function verifyContextChangeDetection(): void {
  section('context_set change detection');
  const { scene, builder, advance } = makeRig();
  /** The next tick a full interval later, so the shared rate limit never decides a check. */
  const later = (): ContextMessage[] => {
    advance(SNAPSHOT_INTERVAL_MS);
    return builder.tick();
  };
  const first = builder.tick();
  const firstContext = ofType(first, 'context_set');
  check(firstContext.length === 1, 'binding sends context_set on the first tick');
  check(ofType(first, 'state_snapshot')[0]?.payload.full !== undefined, 'and a full snapshot');
  check(first[0]?.type === 'context_set', 'context goes out before the state it describes');

  check(ofType(later(), 'context_set').length === 0, 'an unchanged session is not resent');

  scene.session.secondsPlayed = SECONDS_PER_MINUTE - 1;
  check(
    ofType(later(), 'context_set').length === 0,
    'seconds of play inside a minute change nothing',
  );
  scene.session.secondsPlayed = SECONDS_PER_MINUTE;
  check(ofType(later(), 'context_set').length === 1, 'a new minute of play is resent');

  scene.live.isPaused = true;
  scene.live.menuOpen = true;
  const paused = itemAt(ofType(later(), 'context_set'), 0);
  check(
    paused !== undefined && paused.payload.flags.isPaused && paused.payload.flags.inMenu,
    'opening a menu flips isPaused and inMenu at once',
  );
  scene.live.isPaused = false;
  scene.live.menuOpen = false;
  const resumed = itemAt(ofType(later(), 'context_set'), 0);
  check(resumed !== undefined && !resumed.payload.flags.isPaused, 'closing it flips them back');

  scene.enterSafeRoom(true);
  check(
    itemAt(ofType(later(), 'context_set'), 0)?.payload.flags.inSafeRoom === true,
    'inSafeRoom follows the party',
  );
  scene.live.crawlers.human.hp = LOW_HP;
  check(
    itemAt(ofType(later(), 'context_set'), 0)?.payload.flags.lowHp === true,
    'lowHp follows the active crawler',
  );

  scene.live.menuOpen = true;
  advance(HALF_INTERVAL_MS);
  const flickerOpen = builder.tick();
  scene.live.menuOpen = false;
  advance(HALF_INTERVAL_MS / 2);
  const flickerShut = builder.tick();
  check(
    ofType(flickerOpen, 'context_set').length === 0 &&
      ofType(flickerShut, 'context_set').length === 0,
    'context_set shares the snapshot rate limit: a menu flicker inside it sends nothing',
  );
  check(
    ofType(later(), 'context_set').length === 0,
    'and a flicker that settled back is never sent at all',
  );

  // A tick that really sends something, so the window below starts there.
  scene.live.crawlers.human.hp = LOW_HP + 1;
  later();
  advance(HALF_INTERVAL_MS);
  scene.live.isPaused = true;
  const heldBack = builder.tick();
  advance(HALF_INTERVAL_MS);
  const released = itemAt(ofType(builder.tick(), 'context_set'), 0);
  check(
    ofType(heldBack, 'context_set').length === 0 && released?.payload.flags.isPaused === true,
    'a lasting change made inside the window goes out on the first tick after it',
  );
  scene.live.isPaused = false;
  later();

  builder.resynchronize();
  const resync = builder.tick();
  check(
    ofType(resync, 'context_set').length === 1 &&
      ofType(resync, 'state_snapshot')[0]?.payload.full !== undefined,
    'a resynchronize resends context and a full snapshot at once',
  );

  builder.setPolicyMultiplier(0);
  check(
    ofType(later(), 'context_set')[0]?.payload.policyMultiplier === 0,
    'the AI intensity rides on context_set',
  );

  scene.live.crawlers.human.hp = LOW_HP - 1;
  later();
  advance(HALF_INTERVAL_MS);
  scene.live.crawlers.human.hp = LOW_HP - 2;
  check(
    ofType(builder.tick(), 'state_snapshot').length === 0,
    'state patches are held to the snapshot interval',
  );

  builder.recordPlayerMessage(SYSTEM_CHARACTER_NAME);
  advance(PROFILE_INTERVAL_MS);
  const profiled = itemAt(ofType(builder.tick(), 'context_set'), 0);
  check(
    profiled !== undefined && 'playerProfile' in profiled.payload.context,
    'a changed player profile is resent on its interval',
  );
}

// ── Events: witnesses, rollups, derived ────────────────────────────────────

function verifyWitnessScoping(): void {
  section('witness scoping');
  check(
    perceiversOf('never', true) === undefined,
    'a never-witnessed event is the omniscient System’s alone',
  );
  check(
    perceiversOf('inSafeRoom', false) === undefined,
    'outside a safe room Mordecai sees nothing',
  );
  const inside = perceiversOf('inSafeRoom', true) ?? [];
  check(
    inside.includes(MORDECAI_CHARACTER_NAME) && inside.includes(SYSTEM_CHARACTER_NAME),
    'inside one he and the System both do',
  );

  const { bus, scene, builder, pm } = makeRig();
  builder.tick();
  bus.emit('combatStarted', { attacker: 'Human', mobType: 'Goblin' });
  scene.enterSafeRoom(true);
  bus.emit('combatStarted', { attacker: 'Human', mobType: 'Goblin' });
  bus.emit('bossFightInitiated', { bossType: 'trash_gremlin' });
  scene.enterSafeRoom(false);
  bus.emit('playerDied', { fallen: pm.human, cause: 'goblin' });
  const events = eventsIn(builder.tick());
  const [outside, inSafe, boss, died] = Array.from({ length: SCOPING_EVENTS }, (_, index) =>
    itemAt(events, index),
  );
  check(outside?.witnessedBy === undefined, 'a fight in a corridor is not witnessed by Mordecai');
  check(
    inSafe?.witnessedBy?.includes(MORDECAI_CHARACTER_NAME) === true,
    'the same event in a safe room is',
  );
  check(boss?.witnessedBy === undefined, 'a boss fight is never his to see');
  check(
    died?.witnessedBy?.includes(MORDECAI_CHARACTER_NAME) === true,
    'a death always reaches him',
  );
  check(
    events.every(
      (event) =>
        event.summary !== undefined &&
        (event.importance ?? -1) >= 0 &&
        (event.importance ?? 2) <= 1,
    ),
    'every mapped event carries a summary and a 0..1 importance',
  );

  scene.catInSafeRoom = true;
  bus.emit('healingPotionUsed', { player: 'Cat', hpRestored: 1 });
  bus.emit('healingPotionUsed', { player: 'Human', hpRestored: 1 });
  const drinks = eventsIn(builder.tick());
  const catDrank = itemAt(drinks, 0);
  const humanDrank = itemAt(drinks, 1);
  check(
    catDrank?.witnessedBy?.includes(MORDECAI_CHARACTER_NAME) === true &&
      humanDrank?.witnessedBy === undefined,
    'witnessing follows the crawler it happened to, not the one being driven',
  );
  const briefing = builder.witnessedHighlights(MORDECAI_CHARACTER_NAME, MANY_EVENTS);
  check(
    itemAt(briefing, 0)?.summary === catDrank?.summary &&
      briefing.length === WITNESSED_IN_SCOPING_TEST &&
      briefing.every((line) => line.summary !== humanDrank?.summary),
    'Mordecai is briefed only on what he witnessed, newest first',
  );
}

function verifyRollups(): void {
  section('rollups and sampling');
  const { bus, builder, pm, advance } = makeRig();
  builder.tick();
  for (let i = 0; i < KILLS_IN_FIGHT; i++) {
    const name = i % 2 === 0 ? 'Goblin' : 'Rat';
    bus.emit('mobKilled', {
      mob: new Dummy(name),
      killer: pm.human,
      killType: null,
      topDamageDealer: pm.human,
    });
    advance(KILL_SPACING_MS);
  }
  bus.emit('mobKilled', {
    mob: new Dummy('The Trash Gremlin', true),
    killer: pm.human,
    killType: null,
    topDamageDealer: pm.human,
  });
  check(eventsIn(builder.tick()).length === 0, 'kills mid-fight are held back');
  advance(KILL_ROLLUP_QUIET_MS);
  const rolled = eventsIn(builder.tick()).filter((event) => event.type === 'mobsKilled');
  check(rolled.length === 1, 'a quiet spell releases the fight as one event');
  check(
    itemAt(rolled, 0)?.data.count === KILLS_IN_FIGHT,
    `it counts all ${KILLS_IN_FIGHT} kills and leaves the boss to bossDefeated`,
  );
  check(
    jsonEqual(itemAt(rolled, 0)?.data.byType, { Goblin: 3, Rat: 2 }),
    'and breaks them down by type',
  );

  for (let i = 0; i < DODGES; i++) bus.emit('playerDodged', { player: 'Cat' });
  check(eventsIn(builder.tick()).length === 0, 'dodges are sampled, not sent one by one');
  advance(DODGE_SAMPLE_WINDOW_MS);
  const dodged = eventsIn(builder.tick()).filter((event) => event.type === 'playerDodged');
  check(
    dodged.length === 1 && itemAt(dodged, 0)?.data.count === DODGES,
    'one dodge event per window, with the count',
  );

  for (let i = 0; i < MANY_EVENTS; i++) bus.emit('gameSaved', {});
  const batches = ofType(builder.tick(), 'event_log');
  check(
    batches.every((batch) => batch.payload.events.length <= BATCH_LIMIT) &&
      batches.reduce((sum, batch) => sum + batch.payload.events.length, 0) === MANY_EVENTS,
    'event batches respect the batch limit and lose nothing',
  );
}

function verifyDerivedEvents(): void {
  section('derived events');
  const { bus, scene, builder, pm, advance } = makeRig();
  builder.tick();
  scene.live.crawlers.human.hp = LOW_HP;
  scene.live.crawlers.human.healthPotions = POTIONS_HELD;
  bus.emit('healthLow', { player: 'Human', hp: LOW_HP, maxHp: FULL_HP });
  builder.tick();
  advance(STOCKPILING_WAIT_MS);
  const stockpiling = eventsIn(builder.tick()).filter(
    (event) => event.type === 'potionStockpiling',
  );
  check(stockpiling.length === 1, 'sitting on potions at low HP is reported');

  bus.emit('healthLow', { player: 'Human', hp: LOW_HP, maxHp: FULL_HP });
  bus.emit('healingPotionUsed', { player: 'Human', hpRestored: FULL_HP / 2 });
  advance(STOCKPILING_WAIT_MS);
  const drank = eventsIn(builder.tick()).filter((event) => event.type === 'potionStockpiling');
  check(drank.length === 0, 'drinking one in time is not stockpiling');

  const nextFloor = new FakeScene(pm.human);
  nextFloor.session = {
    ...scene.session,
    floorNumber: 2,
    levelId: 'level2',
    floorName: 'The Dungeon, Level 2',
  };
  builder.bind(bus, nextFloor);
  const arrival = builder.tick();
  const floorEntered = eventsIn(arrival).find((event) => event.type === 'floorEntered');
  check(
    floorEntered?.importance === IMPORTANCE.LANDMARK,
    'a new floor raises a landmark floorEntered event',
  );
  check(
    floorEntered?.witnessedBy?.includes(MORDECAI_CHARACTER_NAME) === true,
    'which every character hears',
  );
  const arrivalContext = itemAt(ofType(arrival, 'context_set'), 0);
  check(
    arrivalContext !== undefined && 'floor' in arrivalContext.payload.context,
    'and the new floor goes out in a fresh context_set',
  );
  const interior = new FakeScene(pm.human);
  interior.session = { ...nextFloor.session, indoors: true };
  builder.bind(bus, interior);
  check(
    eventsIn(builder.tick()).every((event) => event.type !== 'floorEntered'),
    'walking indoors is not a new floor',
  );
}

function verifyStatusWatcher(): void {
  section('status changes');
  const pm = new PlayerManager(PARTY_TILE, PARTY_TILE, undefined);
  const bus = new EventBus();
  const seen: string[] = [];
  bus.on('statusApplied', (e) => seen.push(`+${e.status}`));
  bus.on('statusCured', (e) => seen.push(`-${e.status}`));
  const watcher = new StatusChangeWatcher();
  watcher.update(pm.human, pm.cat, bus);
  pm.human.applyStatus(makePoison());
  watcher.update(pm.human, pm.cat, bus);
  pm.human.applyStatus(makePoison());
  watcher.update(pm.human, pm.cat, bus);
  pm.human.clearStatusEffects();
  watcher.update(pm.human, pm.cat, bus);
  check(
    seen.join(' ') === '+poison -poison',
    `a status is reported once on and once off (${seen.join(' ')})`,
  );
}

const PATCHED_X = 3;
const ORIGINAL_Y = 2;

function isPoint(value: unknown, x: number, y: number): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'x' in value &&
    value.x === x &&
    'y' in value &&
    value.y === y
  );
}

function verifySdkTransport(): void {
  section('SDK transport');
  const contexts: ContextUpdate[] = [];
  const states: Record<string, unknown>[] = [];
  const eventBatches: (readonly unknown[])[] = [];
  const transport = new SdkContextTransport({
    setContext: (update) => contexts.push(update),
    updateState: (state) => states.push(state),
    sendEvents: (events) => eventBatches.push(events),
  });
  transport.send([{ type: 'state_snapshot', payload: { patch: { hp: 1 } } }]);
  check(states.length === 0, 'a patch with no full state to apply to is not sent');
  transport.send([
    { type: 'state_snapshot', payload: { full: { hp: DUMMY_HP, pos: { x: 1, y: ORIGINAL_Y } } } },
  ]);
  transport.send([
    { type: 'state_snapshot', payload: { patch: { pos: { x: PATCHED_X } } } },
    {
      type: 'context_set',
      payload: {
        context: { floor: 1 },
        flags: {
          inCombat: true,
          inSafeRoom: false,
          isPaused: false,
          inMenu: false,
          inBossFight: false,
          lowHp: false,
          crawlerDown: false,
          indoors: false,
          levelTimerLow: false,
          commentaryOnly: false,
        },
        policyMultiplier: 0,
        allowedSeverities: ['benign'],
      },
    },
  ]);
  const last = states.length > 0 ? states[states.length - 1] : undefined;
  check(
    last !== undefined && isPoint(last.pos, PATCHED_X, ORIGINAL_Y) && last.hp === DUMMY_HP,
    'patches are applied to the mirror and the client is handed the whole state',
  );
  check(contexts.length === 1, 'context_set goes to setContext as it is');
  const sentContext = contexts.length > 0 ? contexts[0] : undefined;
  check(
    sentContext?.context.floor === 1 &&
      sentContext.flags?.inCombat === true &&
      sentContext.policyMultiplier === 0 &&
      sentContext.allowedSeverities?.join() === 'benign',
    'context, flags and intensity ride along unchanged',
  );
  const event: GameEvent = { ts: 1, type: 't', data: {}, witnessedBy: ['Mordecai'] };
  transport.send([{ type: 'event_log', payload: { events: [event] } }]);
  check(eventBatches[0]?.[0] === event, 'events pass through unchanged');
  transport.reset();
  const statesBeforeReset = states.length;
  transport.send([{ type: 'state_snapshot', payload: { patch: { hp: PATCHED_X } } }]);
  check(states.length === statesBeforeReset, 'after a reset the mirror waits for a full state');
}

verifyMergePatches();
verifySnapshotDiffer();
verifyContextChangeDetection();
verifyWitnessScoping();
verifyRollups();
verifyDerivedEvents();
verifyStatusWatcher();
verifySdkTransport();

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} failed`);
  process.exit(1);
}
