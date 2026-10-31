#!/usr/bin/env tsx
/**
 * Writes the scripted AI replay fixtures: short play sessions acted out
 * headlessly through the real AI adapter, context builder and event mapping
 * (a fake SDK client stands in for the socket), recorded at the same seam a
 * browser recording (`?ai-record`) uses. The clock is scripted, so the same
 * code always writes the same files.
 *
 *   npm run ai:replays                   → $AI_SERVER_DIR/bench/replays (default ../game-server-llm)
 *   npm run ai:replays -- --out=<dir>
 *
 * Every fixture is validated against `scripts/aiReplaySchema.ts` before it is
 * written, and `replay.schema.json` is written beside them.
 */
import { partyOwnsGear } from '../src/loot/gearPools';
import { crawlerName } from '../src/characters/characters';
import { mkdirSync, writeFileSync } from 'node:fs';
import * as prettier from 'prettier';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_LIMITS,
  TypedEmitter,
  type ContextUpdate,
  type GameAiClientEvents,
  type GameAiClientOptions,
  type GameEvent,
} from '@rscarbel/game-server-llm-sdk';
import { AIAdapter, type AIClient } from '../src/ai/AIAdapter';
import { ActionGovernor } from '../src/ai/actions/governor';
import type { AISceneContext } from '../src/ai/actions/types';
import { CAROLINE_CHARACTER_NAME } from '../src/ai/characters';
import { describeDamageSource } from '../src/ai/context/eventMapping';
import type {
  AIContextSource,
  CrawlerState,
  LiveInput,
  NearbyMobState,
  SemanticLocation,
  SessionInput,
} from '../src/ai/context/types';
import type { AIReplayExpectation, AIReplayFixture } from '../src/ai/replay/aiReplayFormat';
import { AIInteractionStage } from '../src/ai/interactions/AIInteractionStage';
import { AchievementManager } from '../src/core/progression/AchievementManager';
import { AchievementAwards } from '../src/systems/AchievementAwards';
import { TILE_SIZE, WORLD_TICKS_PER_SECOND } from '../src/core/constants';
import { EventBus } from '../src/core/EventBus';
import { CatPlayer } from '../src/creatures/CatPlayer';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { Mob } from '../src/creatures/Mob';
import { AIReplayRecorder } from '../src/dev/aiReplayRecorder';
import { dungeonOptionsForLevel } from '../src/levels/dungeonOptions';
import { level1 } from '../src/levels/level1';
import type { MobKind } from '../src/levels/mobKinds';
import { GameMap } from '../src/map/GameMap';
import { AIChallengeSystem } from '../src/systems/AIChallengeSystem';
import type { SystemContext } from '../src/systems/GameSystem';
import { SpellSystem } from '../src/systems/SpellSystem';
import { MobRoster } from '../src/systems/kits/SceneWorld';
import { aiReplayFixtureSchema, aiReplayJsonSchema, asSchemaInput } from './aiReplaySchema';
import { PetNameBook } from '../src/core/party/petNames';
import type { CrawlerKind } from '../src/core/skills/SkillManager';
import { useDevPlayerIdentity } from '../src/dev/devPlayerIdentity';
import { cameraAt, UNZOOMED } from '../src/core/rendering/camera.js';

useDevPlayerIdentity();

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_AI_SERVER_DIR = '../game-server-llm';
const REPLAY_SUBDIR = path.join('bench', 'replays');
const SCHEMA_FILE = 'replay.schema.json';

/** A fixed start, so recorded event timestamps never change between runs. */
const SESSION_START_EPOCH_MS = Date.parse('2026-10-19T20:00:00Z');
/** The adapter's context poll in the script; real time, so only short enough not to drag. */
const SCRIPT_CONTEXT_TICK_MS = 1;
/** Real time each step waits for the context poll to send what the step produced. */
const SETTLE_MS = 8;

const HUMAN = crawlerName('human');
const CAT = crawlerName('cat');

const FULL_HP = 100;
const CAT_MAX_HP = 80;
const PARTY_LEVEL = 3;
const START_TILE = 5;
const DUMMY_HP = 10;
const DUMMY_SPEED = 0;
const ROOMS_ON_FLOOR = 24;
const FULL_HP_PERCENT = 100;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const FLOOR_TIMER_MINUTES = 40;
const FLOOR_TIMER_SECONDS = FLOOR_TIMER_MINUTES * SECONDS_PER_MINUTE;

// ── a fake socket ───────────────────────────────────────────────────────────

/** Stands in for `GameAiClient`; the script plays the server through `fire`. */
class FakeClient extends TypedEmitter<GameAiClientEvents> implements AIClient {
  readonly limits = DEFAULT_LIMITS;

  constructor(readonly options: GameAiClientOptions) {
    super();
  }

  fire<K extends keyof GameAiClientEvents>(event: K, payload: GameAiClientEvents[K]): void {
    this.emit(event, payload);
  }

  connect(): Promise<void> {
    return Promise.resolve();
  }

  close(): void {
    // Nothing is open.
  }

  setContext(_update: ContextUpdate): void {
    // Recorded through the adapter's outbound listener.
  }

  updateState(_state: Record<string, unknown>): void {
    // Recorded through the adapter's outbound listener.
  }

  sendEvents(_events: readonly GameEvent[]): void {
    // Recorded through the adapter's outbound listener.
  }

  sendPlayerMessage(_characterName: string, _text: string, _replyTo?: string): void {
    // Recorded through the adapter's outbound listener.
  }

  sendActionResult(_actionId: string, _ok: boolean, _detail?: string): void {
    // Recorded through the adapter's outbound listener.
  }
}

/** A creature that stands where it is put and decides nothing. */
class Dummy extends Mob {
  readonly xpValue = 0;
  protected override get eyePlacement(): null {
    return null;
  }

  constructor(name: string, typeKey: MobKind, boss = false) {
    super(START_TILE, START_TILE, TILE_SIZE, DUMMY_HP, DUMMY_SPEED);
    this.displayName = name;
    this.spawnTypeKey = typeKey;
    this.isBoss = boss;
  }

  override updateAI(): void {
    // Placed by hand; never moves.
  }

  protected override drawSelf(): void {
    // Nothing here is ever rendered.
  }
}

// ── the scripted world ──────────────────────────────────────────────────────

const GOBLIN_CAMP_ROOM_INDEX = 7;
const SAFE_ROOM_INDEX = 3;
const BOSS_ROOM_INDEX = 12;

const CORRIDOR: SemanticLocation = {
  kind: 'corridor',
  label: 'dark corridor',
  inSafeRoom: false,
  inBossArena: false,
};
const GOBLIN_ROOM: SemanticLocation = {
  kind: 'room',
  label: 'goblin camp',
  inSafeRoom: false,
  inBossArena: false,
  roomIndex: GOBLIN_CAMP_ROOM_INDEX,
};
const SAFE_ROOM: SemanticLocation = {
  kind: 'safeRoom',
  label: 'safe room',
  inSafeRoom: true,
  inBossArena: false,
  roomIndex: SAFE_ROOM_INDEX,
};
const BOSS_ARENA: SemanticLocation = {
  kind: 'bossArena',
  label: 'boss arena (the trashGremlin)',
  inSafeRoom: false,
  inBossArena: true,
  roomIndex: BOSS_ROOM_INDEX,
};

function crawlerState(kind: CrawlerKind, maxHp: number, active: boolean): CrawlerState {
  return {
    kind,
    hp: maxHp,
    maxHp,
    level: PARTY_LEVEL,
    xp: 0,
    coins: 0,
    isActive: active,
    knockedOut: false,
    statusEffects: [],
    equipped: {},
    notableItems: {},
    healthPotions: 0,
    tileX: START_TILE,
    tileY: START_TILE,
  };
}

function nearby(name: string, distanceTiles: number, boss = false): NearbyMobState {
  return {
    name,
    level: PARTY_LEVEL,
    isBoss: boss,
    threat: boss ? 'deadly' : 'low',
    hpPercent: FULL_HP_PERCENT,
    distanceTiles,
  };
}

interface World {
  readonly adapter: AIAdapter;
  readonly bus: EventBus;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly mobs: Mob[];
  readonly stage: AIInteractionStage;
  readonly session: SessionInput;
  readonly live: LiveInput;
  readonly recorder: AIReplayRecorder;
  readonly expectations: AIReplayExpectation[];
  /** Moves the scripted clock on, lets the step change the world, then lets the adapter send. */
  step(ms: number, change?: () => void): Promise<void>;
  /** Plays the server sending one tool call. */
  serverAction(actionId: string, type: string, params: Record<string, unknown>): Promise<void>;
  /** The player types to Caroline; `recall` makes the reply an eval check. */
  say(text: string, recall?: Omit<AIReplayExpectation, 'messageIndex' | 'characterName'>): void;
  finish(): AIReplayFixture;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function buildWorld(id: string, title: string, description: string): Promise<World> {
  let clock = SESSION_START_EPOCH_MS;
  const now = (): number => clock;
  const map = new GameMap({
    mapSize: level1.mapSize,
    tileHeight: TILE_SIZE,
    mapType: 'dungeon',
    dungeon: dungeonOptionsForLevel(level1),
  });
  const human = new HumanPlayer(START_TILE, START_TILE, TILE_SIZE);
  const cat = new CatPlayer(START_TILE + 1, START_TILE, TILE_SIZE);
  human.isActive = true;
  const mobs: Mob[] = [];
  const bus = new EventBus();
  const achievements = { human: new AchievementManager(), cat: new AchievementManager() };
  const awards = new AchievementAwards({
    humanAchievements: achievements.human,
    catAchievements: achievements.cat,
    human,
    cat,
    bus,
    activeCrawler: () => (cat.isActive ? 'cat' : 'human'),
    owns: (id) => partyOwnsGear([human, cat], id),
  });
  const postToast = (): void => undefined;
  const challenges = new AIChallengeSystem({
    bus,
    gameMap: map,
    human,
    cat,
    postToast,
    grantReward: (side, rarity) =>
      void awards.grantChest(side === 'Human' ? 'human' : 'cat', { rarity, source: 'challenge' }),
  });
  const stage = new AIInteractionStage({ bus, challenges });
  const session: SessionInput = {
    floorNumber: 1,
    levelId: level1.id,
    floorName: level1.name,
    levelTimerSeconds: FLOOR_TIMER_SECONDS,
    levelTimerRunning: true,
    difficulty: 'Normal',
    secondsPlayed: 0,
    deaths: 0,
    activeQuests: [],
    companions: [],
    roomCount: ROOMS_ON_FLOOR,
    indoors: false,
  };
  const live: LiveInput = {
    activeCrawler: 'human',
    crawlers: {
      human: crawlerState('human', FULL_HP, true),
      cat: crawlerState('cat', CAT_MAX_HP, false),
    },
    location: CORRIDOR,
    nearbyMobs: [],
    keys: [],
    combatInProgress: false,
    bossFightActive: false,
    isPaused: false,
    menuOpen: false,
  };
  const created: { client: FakeClient | null } = { client: null };
  const adapter = new AIAdapter({
    createClient: (options) => {
      const client = new FakeClient(options);
      created.client = client;
      return client;
    },
    fetchToken: () => Promise.resolve('scripted-player-token'),
    serverUrl: 'http://ai.replay.test',
    intensity: () => 'classic',
    showInterventions: () => true,
    now,
    governor: new ActionGovernor(now),
    contextTickMs: SCRIPT_CONTEXT_TICK_MS,
  });
  const scene: AISceneContext = {
    getHuman: () => human,
    getCat: () => cat,
    getMobs: () => mobs,
    getGameMap: () => map,
    getLevelId: () => level1.id,
    spawnMob: (mob) => mobs.push(mob),
    isBossFightActive: () => live.bossFightActive,
    isPaused: () => live.isPaused,
    isInSafeRoom: () => live.location.inSafeRoom,
    isInCombat: () => live.combatInProgress,
    postToast,
    getAwards: () => awards,
    getInteractions: () => stage,
  };
  const source: AIContextSource = {
    petNames: new PetNameBook(),
    readSession: () => structuredClone(session),
    readLive: () => structuredClone(live),
    isPartyInSafeRoom: () => live.location.inSafeRoom,
    isCrawlerInSafeRoom: () => live.location.inSafeRoom,
    crawlerKindOf: (player) => (player === human ? 'human' : 'cat'),
  };
  const recorder = new AIReplayRecorder({ id, title, description, source: 'scripted', now });
  adapter.setOutboundListener(recorder.record);
  adapter.bindScene(scene, bus, source);
  await adapter.initialize();
  const client = created.client;
  if (client === null) throw new Error('the adapter created no client');
  client.fire('connected', { sessionId: `replay-${id}`, limits: DEFAULT_LIMITS, resumed: false });

  const frameContext: SystemContext = {
    human,
    cat,
    active: human,
    partner: cat,
    activeIsMoving: false,
    roster: new MobRoster(map, new SpellSystem()),
    gameMap: map,
    camera: cameraAt({ x: 0, y: 0 }, UNZOOMED),
  };
  const expectations: AIReplayExpectation[] = [];
  const settle = (): Promise<void> => sleep(SETTLE_MS);
  return {
    adapter,
    bus,
    human,
    cat,
    mobs,
    stage,
    session,
    live,
    recorder,
    expectations,
    async step(ms, change) {
      clock += ms;
      session.secondsPlayed += ms / MS_PER_SECOND;
      session.secondsPlayed = Math.floor(session.secondsPlayed);
      if (session.levelTimerSeconds !== undefined) {
        session.levelTimerSeconds = Math.max(0, session.levelTimerSeconds - ms / MS_PER_SECOND);
      }
      // The challenge clock runs on frames, so it is stepped through the time that passed.
      const frames = Math.round((ms / MS_PER_SECOND) * WORLD_TICKS_PER_SECOND);
      for (let frame = 0; frame < frames; frame++) challenges.update(frameContext);
      change?.();
      await settle();
    },
    async serverAction(actionId, type, params) {
      client.fire('ai_action', { actionId, characterName: CAROLINE_CHARACTER_NAME, type, params });
      adapter.update();
      await settle();
    },
    say(text, recall) {
      const messageIndex = recorder.nextIndex;
      adapter.chatWithCaroline(text);
      if (recall !== undefined) {
        expectations.push({ ...recall, messageIndex, characterName: CAROLINE_CHARACTER_NAME });
      }
    },
    finish() {
      adapter.unbindScene();
      adapter.setOutboundListener(null);
      adapter.accountChanged();
      return recorder.fixture(expectations);
    },
  };
}

function kill(world: World, mob: Mob, killer: HumanPlayer | CatPlayer): void {
  mob.hp = 0;
  world.bus.emit('mobKilled', { mob, killer, killType: null, topDamageDealer: killer });
}

// ── fixture: combat, the dynamite incident, a boss, then the question ───────

/** How long the scripted beats between things happening last. */
const QUICK_BEAT_MS = 1_500;
const BEAT_MS = 3_000;
const LONG_BEAT_MS = 6_000;
const BOSS_FIGHT_MS = 9_000;
const WALK_MS = 20_000;
const LONG_WALK_MS = 30_000;

const GOBLINS_IN_CAMP = 4;
const FIRST_MOB_DISTANCE_TILES = 3;
const BOSS_DISTANCE_TILES = 4;
/** Where the rest of the camp stands once the first goblin is down. */
const CLOSING_MOB_DISTANCE_TILES = 2;
const HUMAN_HP_AFTER_FIRST_HITS = 74;
const HUMAN_HP_AFTER_BLAST = 21;
const POTION_HP_RESTORED = 40;
const CAT_HP_REVIVED = 24;
const HUMAN_HP_IN_BOSS_FIGHT = 48;
const CAT_HP_IN_BOSS_FIGHT = 15;
const DYNAMITE_HELD = 2;
const XP_AFTER_FIRST_KILL = 30;
const XP_AFTER_BLAST = 120;
const XP_AFTER_BOSS = 420;

/** Placeholder goblins at increasing distance, as the nearby-mob list orders them. */
function nearbyMobs(mobs: readonly Mob[], firstDistance: number): NearbyMobState[] {
  return mobs.map((mob, i) => nearby(mob.displayName, firstDistance + i));
}

async function dynamiteIncident(): Promise<AIReplayFixture> {
  const world = await buildWorld(
    'dynamite-incident',
    'The dynamite incident',
    `Floor 1: a goblin fight ${HUMAN} ends with dynamite that also knocks ${CAT} out, a revive, ` +
      'the Trash Gremlin boss kill, then in a safe room the player asks Caroline whether she remembers the dynamite.',
  );
  const { bus, human, cat, live } = world;
  const goblins = Array.from({ length: GOBLINS_IN_CAMP }, () => new Dummy('Goblin', 'goblin'));
  world.mobs.push(...goblins);
  const first = goblins[0];
  const rest = goblins.slice(1);
  live.crawlers.human.notableItems = { Dynamite: DYNAMITE_HELD };

  await world.step(BEAT_MS, () => {
    live.location = GOBLIN_ROOM;
    live.nearbyMobs = nearbyMobs(goblins, FIRST_MOB_DISTANCE_TILES);
  });
  await world.step(QUICK_BEAT_MS, () => {
    live.combatInProgress = true;
    bus.emit('combatStarted', { attacker: 'Human', mobType: 'Goblin' });
  });
  await world.step(QUICK_BEAT_MS, () => {
    bus.emit('playerDodged', { player: 'Human' });
    live.crawlers.human.hp = HUMAN_HP_AFTER_FIRST_HITS;
  });
  await world.step(QUICK_BEAT_MS, () => {
    kill(world, first, human);
    live.nearbyMobs = nearbyMobs(rest, CLOSING_MOB_DISTANCE_TILES);
    live.crawlers.human.xp = XP_AFTER_FIRST_KILL;
  });
  await world.step(QUICK_BEAT_MS, () => {
    live.crawlers.human.notableItems = { Dynamite: DYNAMITE_HELD - 1 };
    bus.emit('dynamiteUsed', { player: 'Human', item: 'dynamite' });
  });
  await world.step(QUICK_BEAT_MS, () => {
    for (const goblin of rest) kill(world, goblin, human);
    bus.emit('dynamiteKills', { killer: human, kills: rest.length, bossKilled: false });
    cat.lastDamageSource = { kind: 'dynamite' };
    live.crawlers.cat.hp = 0;
    live.crawlers.cat.knockedOut = true;
    bus.emit('crawlerKnockedOut', { player: cat });
    live.crawlers.human.hp = HUMAN_HP_AFTER_BLAST;
    bus.emit('healthLow', { player: 'Human', hp: HUMAN_HP_AFTER_BLAST, maxHp: FULL_HP });
    live.nearbyMobs = [];
    live.combatInProgress = false;
    live.crawlers.human.xp = XP_AFTER_BLAST;
  });
  await world.step(BEAT_MS, () => {
    live.crawlers.human.hp = HUMAN_HP_AFTER_BLAST + POTION_HP_RESTORED;
    bus.emit('healingPotionUsed', { player: 'Human', hpRestored: POTION_HP_RESTORED });
  });
  await world.step(BEAT_MS, () => {
    live.crawlers.cat.hp = CAT_HP_REVIVED;
    live.crawlers.cat.knockedOut = false;
    bus.emit('crawlerRevived', { player: cat });
  });
  await world.step(QUICK_BEAT_MS, () => {
    bus.emit('roomCleared', { roomIndex: GOBLIN_CAMP_ROOM_INDEX });
  });
  await world.serverAction('replay-announce-1', 'announce', {
    text: `Friendly fire is still fire, ${HUMAN}. Recorded.`,
  });
  await world.step(LONG_BEAT_MS, () => {
    live.location = CORRIDOR;
  });

  const trashGremlin = new Dummy('The Trash Gremlin', 'trash_gremlin', true);
  world.mobs.push(trashGremlin);
  await world.step(WALK_MS, () => {
    live.location = BOSS_ARENA;
    live.nearbyMobs = [nearby(trashGremlin.displayName, BOSS_DISTANCE_TILES, true)];
    live.bossFightActive = true;
    live.combatInProgress = true;
    bus.emit('bossFightInitiated', { bossType: 'trash_gremlin' });
  });
  await world.step(LONG_BEAT_MS, () => {
    live.crawlers.human.hp = HUMAN_HP_IN_BOSS_FIGHT;
    live.crawlers.cat.hp = CAT_HP_IN_BOSS_FIGHT;
    bus.emit('healthLow', { player: 'Cat', hp: CAT_HP_IN_BOSS_FIGHT, maxHp: CAT_MAX_HP });
  });
  await world.step(BOSS_FIGHT_MS, () => {
    trashGremlin.hp = 0;
    live.nearbyMobs = [];
    live.bossFightActive = false;
    live.combatInProgress = false;
    live.crawlers.human.xp = XP_AFTER_BOSS;
    live.crawlers.human.level = PARTY_LEVEL + 1;
    bus.emit('bossDefeated', { bossType: 'trash_gremlin', mob: trashGremlin });
    bus.emit('playerLevelUp', { player: human, newLevel: PARTY_LEVEL + 1 });
  });
  await world.step(WALK_MS, () => {
    live.location = SAFE_ROOM;
    bus.emit('safeRoomEntered', { room: { kind: 'floor', level: 'level1', index: 0 } });
    bus.emit('gameSaved', {});
  });
  await world.step(BEAT_MS, () => {
    world.say('Caroline. Remember the dynamite?', {
      kind: 'recall',
      mentionsAny: [
        crawlerName('cat'),
        'knocked',
        'friendly fire',
        'three goblins',
        'blast',
        'blew up',
      ],
      description: `Caroline should bring up ${HUMAN} lighting dynamite that killed three goblins and knocked ${CAT} out.`,
    });
  });
  await world.step(LONG_BEAT_MS);
  return world.finish();
}

// ── fixture: a challenge, a death, then the question ────────────────────────

const MINUTES_PLAYED_BEFORE_CHALLENGE = 15;
const RATS_FOR_CHALLENGE = 3;
const RAT_DISTANCE_TILES = 6;
const CHALLENGE_SECONDS = 60;
const HUMAN_HP_BEFORE_DEATH = 22;
const WAR_BAND_DISTANCE_TILES = 2;

async function challengeAndDeath(): Promise<AIReplayFixture> {
  const world = await buildWorld(
    'challenge-and-death',
    'A challenge, then a death',
    `Floor 1, mid-run: Caroline offers a three-kill challenge the party accepts and wins, then ${HUMAN} ` +
      'wanders into a goblin war band and dies, respawns at the save, and asks what that challenge was.',
  );
  const { bus, human, live, session } = world;
  session.secondsPlayed = MINUTES_PLAYED_BEFORE_CHALLENGE * SECONDS_PER_MINUTE;
  live.crawlers.human.level = PARTY_LEVEL + 1;
  const rats = Array.from({ length: RATS_FOR_CHALLENGE }, () => new Dummy('Rat', 'rat'));
  world.mobs.push(...rats);

  await world.step(BEAT_MS, () => {
    live.nearbyMobs = nearbyMobs(rats, RAT_DISTANCE_TILES);
  });
  await world.serverAction('replay-challenge-1', 'offer_challenge', {
    template: 'slay',
    title: 'Rat Race',
    reward_rarity: 'Common',
    taunt: 'Three rats. Sixty seconds. Not completed.',
    seconds: CHALLENGE_SECONDS,
    count: RATS_FOR_CHALLENGE,
    mob_type: 'any',
    pitch: 'Three kills in sixty seconds. Projected success: 70 percent.',
  });
  await world.step(BEAT_MS, () => {
    world.stage.acceptChallenge();
  });
  await world.step(QUICK_BEAT_MS, () => {
    live.combatInProgress = true;
    bus.emit('combatStarted', { attacker: 'Human', mobType: 'Rat' });
  });
  for (const rat of rats) {
    await world.step(BEAT_MS, () => {
      kill(world, rat, human);
      live.nearbyMobs = live.nearbyMobs.slice(1);
    });
  }
  await world.step(BEAT_MS, () => {
    live.combatInProgress = false;
  });

  await world.step(LONG_WALK_MS, () => {
    live.location = GOBLIN_ROOM;
    live.nearbyMobs = ['Goblin Shaman', 'Goblin', 'Goblin'].map((name) =>
      nearby(name, WAR_BAND_DISTANCE_TILES),
    );
    live.combatInProgress = true;
    bus.emit('combatStarted', { attacker: 'Cat', mobType: 'Goblin Shaman' });
  });
  await world.step(BEAT_MS, () => {
    live.crawlers.human.hp = HUMAN_HP_BEFORE_DEATH;
    bus.emit('healthLow', { player: 'Human', hp: HUMAN_HP_BEFORE_DEATH, maxHp: FULL_HP });
  });
  await world.step(BEAT_MS, () => {
    human.lastDamageSource = { kind: 'mob', mobType: 'Goblin Shaman', attackType: 'fireball' };
    live.crawlers.human.hp = 0;
    session.deaths = 1;
    live.isPaused = true;
    bus.emit('playerDied', { fallen: human, cause: 'goblin shaman' });
  });
  await world.step(LONG_BEAT_MS, () => {
    live.isPaused = false;
    live.combatInProgress = false;
    live.crawlers.human.hp = FULL_HP;
    live.crawlers.cat.hp = CAT_MAX_HP;
    live.location = SAFE_ROOM;
    live.nearbyMobs = [];
  });
  await world.step(BEAT_MS, () => {
    world.say('Ok that shaman cheated. What was that challenge you gave us earlier?', {
      kind: 'recall',
      mentionsAny: ['Rat Race'],
      description:
        'Caroline should recall the "Rat Race" challenge the party won before the death.',
    });
  });
  await world.step(LONG_BEAT_MS);
  return world.finish();
}

// ── output ──────────────────────────────────────────────────────────────────

function outputDir(): string {
  const flag = process.argv.find((arg) => arg.startsWith('--out='));
  if (flag !== undefined) return path.resolve(flag.slice('--out='.length));
  const serverDir = process.env.AI_SERVER_DIR ?? DEFAULT_AI_SERVER_DIR;
  return path.resolve(REPO_ROOT, serverDir, REPLAY_SUBDIR);
}

/** The eval's matching rule for `mentionsAny`: whole words or phrases, any case. */
function mentions(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

/**
 * Problems a schema cannot see: expectations that point at the wrong message,
 * or that a reply echoing the question would already pass.
 */
function fixtureProblems(fixture: AIReplayFixture): string[] {
  const problems: string[] = [];
  for (const expectation of fixture.expectations) {
    const target = fixture.messages.find((_, index) => index === expectation.messageIndex);
    if (target?.type !== 'player_message') {
      problems.push(
        `expectation at ${expectation.messageIndex} does not point at a player_message`,
      );
      continue;
    }
    const echoed = expectation.mentionsAny.filter((term) => mentions(target.payload.text, term));
    if (echoed.length > 0) {
      problems.push(
        `expectation at ${expectation.messageIndex} is met by the question: ${echoed.join(', ')}`,
      );
    }
  }
  if (!fixture.messages.some((message) => message.type === 'action_result')) {
    problems.push('no action_result was recorded');
  }
  return problems;
}

function dynamiteProblems(fixture: AIReplayFixture): string[] {
  const events = fixture.messages.flatMap((message) =>
    message.type === 'event_log' ? message.payload.events : [],
  );
  const problems: string[] = [];
  if (!events.some((event) => event.type === 'dynamiteUsed')) problems.push('no dynamiteUsed');
  const knockout = events.find((event) => event.type === 'crawlerKnockedOut');
  if (knockout?.data.cause !== describeDamageSource({ kind: 'dynamite' })) {
    problems.push(`${CAT}’s knockout is not blamed on the dynamite`);
  }
  return problems;
}

/** Formatted the way the repo it lands in formats JSON, so its format check stays clean. */
async function writeJson(file: string, value: unknown): Promise<void> {
  const config = (await prettier.resolveConfig(file)) ?? {};
  const text = await prettier.format(JSON.stringify(value), { ...config, filepath: file });
  writeFileSync(file, text);
}

async function main(): Promise<void> {
  const dir = outputDir();
  const dynamite = await dynamiteIncident();
  const challenge = await challengeAndDeath();
  const checks: Array<[AIReplayFixture, string[]]> = [
    [dynamite, [...fixtureProblems(dynamite), ...dynamiteProblems(dynamite)]],
    [challenge, fixtureProblems(challenge)],
  ];

  let failed = false;
  for (const [fixture, problems] of checks) {
    const parsed = aiReplayFixtureSchema.safeParse(asSchemaInput(fixture));
    if (!parsed.success) problems.push(parsed.error.message);
    if (problems.length > 0) {
      failed = true;
      console.error(`✗ ${fixture.id}:\n  ${problems.join('\n  ')}`);
    }
  }
  if (failed) process.exit(1);

  mkdirSync(dir, { recursive: true });
  await writeJson(path.join(dir, SCHEMA_FILE), aiReplayJsonSchema());
  for (const [fixture] of checks) {
    const file = path.join(dir, `${fixture.id}.json`);
    await writeJson(file, fixture);
    const counts = new Map<string, number>();
    for (const message of fixture.messages) {
      counts.set(message.type, (counts.get(message.type) ?? 0) + 1);
    }
    const summary = [...counts].map(([type, count]) => `${type} ${count}`).join(', ');
    console.log(`✓ ${path.relative(process.cwd(), file)} (${summary})`);
  }
  console.log(`✓ ${path.relative(process.cwd(), path.join(dir, SCHEMA_FILE))}`);
  // The level map and the adapter leave timers behind that nothing here needs.
  process.exit(0);
}

void main();
