#!/usr/bin/env tsx
/**
 * Headless checks on the AI adapter's transport, against a fake SDK client:
 *
 *  - Connection: no token means no client and the AI stays off; the token
 *    provider hands over the token it was primed with before fetching fresh
 *    ones; a connect resynchronizes the context.
 *  - Actions: every `ai_action` is answered with an `action_result`, whether
 *    it ran, was refused by the governor, by the player's AI intensity or for
 *    want of a scene, or expired while the game was paused; the "intervened"
 *    indicator follows its setting.
 *  - Intensity: each setting reaches `context_set` as the agreed multiplier
 *    and severities.
 *  - Chat: player chat goes over the socket while connected; offline the
 *    System answers with a scripted line, a big moment gets one too, and
 *    Mordecai falls back on his usual advice. Streamed replies type out,
 *    reply buttons send the choice id as `replyTo`, and opinion changes flash.
 *  - Status: online, degraded for the notice's retry window, offline after a
 *    disconnect.
 *
 * Run: npm run verify:ai-transport
 */
import { partyOwnsGear } from '../src/loot/gearPools';
import { crawlerName } from '../src/characters/characters';
import {
  DEFAULT_LIMITS,
  TypedEmitter,
  type GameAiClientEvents,
  type GameAiClientOptions,
  type ContextUpdate,
  type GameEvent,
  type WsLimits,
} from '@rscarbel/game-server-llm-sdk';
import { AIAdapter, type AIClient } from '../src/ai/AIAdapter';
import {
  AIChatFeed,
  MAX_DISPLAY_CHARS,
  MAX_HOLD_TICKS,
  TYPEWRITER_CHARS_PER_TICK,
} from '../src/ai/AIChatFeed';
import { AI_INTENSITIES, intensityPolicy, type AIIntensity } from '../src/ai/aiIntensity';
import { ActionGovernor } from '../src/ai/actions/governor';
import type { AISceneContext } from '../src/ai/actions/types';
import { MORDECAI_CHARACTER_NAME, SYSTEM_CHARACTER_NAME } from '../src/ai/characters';
import { SYSTEM_FALLBACK_LINES } from '../src/ai/characters/fallbackLines';
import type {
  AIContextSource,
  CrawlerName,
  CrawlerState,
  LiveInput,
  SessionInput,
} from '../src/ai/context/types';
import { CHALLENGE_TEMPLATE_IDS, type ChallengeSummary } from '../src/ai/show/challenges';
import { AchievementManager } from '../src/core/progression/AchievementManager';
import { AchievementAwards } from '../src/systems/AchievementAwards';
import { TILE_SIZE } from '../src/core/constants';
import { EventBus } from '../src/core/EventBus';
import { CatPlayer } from '../src/creatures/CatPlayer';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import type { Mob } from '../src/creatures/Mob';
import { dungeonOptionsForLevel } from '../src/levels/dungeonOptions';
import { level1 } from '../src/levels/level1';
import { GameMap } from '../src/map/GameMap';

let checks = 0;
let failures = 0;

function check(ok: boolean, message: string): void {
  checks++;
  if (ok) return;
  failures++;
  console.error(`  FAIL ${message}`);
}

function section(name: string): void {
  console.log(`\n${name}`);
}

const START_MS = 5_000_000;
/** Past the builder's one-second rate limit for context and state. */
const PAST_SNAPSHOT_INTERVAL_MS = 1_100;
/** Past the dispatcher's limit on how long a call may wait out a pause. */
const PAST_HELD_ACTION_AGE_MS = 21_000;
/** Real time for the adapter's context timer to fire at least once. */
const CONTEXT_TIMER_WAIT_MS = 300;
const DEGRADED_RETRY_MS = 5_000;
const FULL_HP = 100;
const PARTY_LEVEL = 3;
const PARTY_TILE = 5;
const LIMITS: WsLimits = DEFAULT_LIMITS;
/** Past the reward chest's cooldown, so a second chest is judged on its own. */
const PAST_REWARD_CHEST_COOLDOWN_MS = 91_000;
const LOW_OPINION = 0.1;
const HIGH_OPINION = 0.4;

interface SentResult {
  readonly actionId: string;
  readonly ok: boolean;
  readonly detail: string | undefined;
}

interface SentMessage {
  readonly characterName: string;
  readonly text: string;
  readonly replyTo: string | undefined;
}

/** Stands in for `GameAiClient`: records what the adapter sends and lets the script play the server. */
class FakeClient extends TypedEmitter<GameAiClientEvents> implements AIClient {
  readonly contexts: ContextUpdate[] = [];
  readonly states: Record<string, unknown>[] = [];
  readonly events: GameEvent[] = [];
  readonly messages: SentMessage[] = [];
  readonly results: SentResult[] = [];
  closed = false;
  readonly limits = LIMITS;

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
    this.closed = true;
  }

  setContext(update: ContextUpdate): void {
    this.contexts.push(update);
  }

  updateState(state: Record<string, unknown>): void {
    this.states.push(state);
  }

  sendEvents(events: readonly GameEvent[]): void {
    this.events.push(...events);
  }

  sendPlayerMessage(characterName: string, text: string, replyTo?: string): void {
    this.messages.push({ characterName, text, replyTo });
  }

  sendActionResult(actionId: string, ok: boolean, detail?: string): void {
    this.results.push({ actionId, ok, detail });
  }

  resultFor(actionId: string): SentResult | undefined {
    return this.results.find((result) => result.actionId === actionId);
  }
}

function crawler(name: CrawlerName, active: boolean): CrawlerState {
  return {
    name,
    hp: FULL_HP,
    maxHp: FULL_HP,
    level: PARTY_LEVEL,
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

interface Rig {
  readonly adapter: AIAdapter;
  readonly bus: EventBus;
  readonly clients: FakeClient[];
  readonly world: { paused: boolean; intensity: AIIntensity; indicators: boolean };
  readonly toasts: string[];
  /** The human's achievements, where an award the AI grants him is queued. */
  readonly humanAchievements: AchievementManager;
  readonly human: HumanPlayer;
  tokens: Array<string | null>;
  advance(ms: number): void;
  client(): FakeClient;
  /** Binds the rig's scene again, as a newly built scene does, on `bus`. */
  rebind(bus: EventBus, onLeave?: () => void): void;
}

function buildRig(): Rig {
  const map = new GameMap({
    mapSize: level1.mapSize,
    tileHeight: TILE_SIZE,
    mapType: 'dungeon',
    dungeon: dungeonOptionsForLevel(level1),
  });
  const start = map.mobSpawnPoints.length > 0 ? map.mobSpawnPoints[0] : { x: 1, y: 1 };
  const human = new HumanPlayer(start.x, start.y, TILE_SIZE);
  const cat = new CatPlayer(start.x + 1, start.y, TILE_SIZE);
  human.isActive = true;
  const mobs: Mob[] = [];
  const toasts: string[] = [];
  const achievements = { human: new AchievementManager(), cat: new AchievementManager() };
  const sceneBus = new EventBus();
  const awards = new AchievementAwards({
    humanAchievements: achievements.human,
    catAchievements: achievements.cat,
    human,
    cat,
    bus: sceneBus,
    activeCrawler: () => (cat.isActive ? 'cat' : 'human'),
    owns: (id) => partyOwnsGear([human, cat], id),
  });
  let clock = START_MS;
  const clients: FakeClient[] = [];
  const rig: Rig = {
    bus: sceneBus,
    clients,
    world: { paused: false, intensity: 'classic', indicators: true },
    toasts,
    humanAchievements: achievements.human,
    human,
    tokens: [],
    advance: (ms) => {
      clock += ms;
    },
    client: () => {
      const latest = lastOf(clients);
      if (latest === undefined) throw new Error('no client was created');
      return latest;
    },
    rebind: (bus, onLeave) => {
      rig.adapter.bindScene(scene, bus, source, onLeave);
    },
    adapter: new AIAdapter({
      createClient: (options) => {
        const client = new FakeClient(options);
        clients.push(client);
        return client;
      },
      fetchToken: () => Promise.resolve(rig.tokens.shift() ?? null),
      serverUrl: 'http://ai.test',
      intensity: () => rig.world.intensity,
      showInterventions: () => rig.world.indicators,
      now: () => clock,
      governor: new ActionGovernor(() => clock),
    }),
  };
  const scene: AISceneContext = {
    getHuman: () => human,
    getCat: () => cat,
    getMobs: () => mobs,
    getGameMap: () => map,
    getLevelId: () => level1.id,
    spawnMob: (mob) => mobs.push(mob),
    isBossFightActive: () => false,
    isPaused: () => rig.world.paused,
    isInSafeRoom: () => false,
    isInCombat: () => false,
    postToast: (text) => toasts.push(text),
    getAwards: () => awards,
  };
  const session: SessionInput = {
    floorNumber: 1,
    levelId: level1.id,
    floorName: 'The Dungeon',
    levelTimerRunning: false,
    difficulty: 'Normal',
    secondsPlayed: 0,
    deaths: 0,
    activeQuests: [],
    companions: [],
    indoors: false,
  };
  const live = (): LiveInput => ({
    activeCrawler: crawlerName('human'),
    crawlers: {
      human: crawler(crawlerName('human'), true),
      cat: crawler(crawlerName('cat'), false),
    },
    location: { kind: 'corridor', label: 'dark corridor', inSafeRoom: false, inBossArena: false },
    nearbyMobs: [],
    combatInProgress: false,
    bossFightActive: false,
    isPaused: rig.world.paused,
    menuOpen: false,
  });
  const source: AIContextSource = {
    readSession: () => ({ ...session }),
    readLive: live,
    isPartyInSafeRoom: () => false,
    isCrawlerInSafeRoom: () => false,
    crawlerNameOf: (player) => (player === human ? crawlerName('human') : crawlerName('cat')),
  };
  rig.adapter.bindScene(scene, rig.bus, source);
  return rig;
}

function lastOf<T>(items: readonly T[]): T | undefined {
  return items.length > 0 ? items[items.length - 1] : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A heal well inside the action's own range, so only the intensity can refuse it. */
const HEAL_PERCENT = 20;
const REWARD_CHEST = { rarity: 'Common', reason: 'Good show.' };
const REMEMBER = { fact: `${crawlerName('human')} hums while he fights.`, kind: 'fact' };

function action(
  id: string,
  type: string,
  params: Record<string, unknown>,
): GameAiClientEvents['ai_action'] {
  return { actionId: id, characterName: SYSTEM_CHARACTER_NAME, type, params };
}

/** Lets the context builder's rate limit pass and its timer fire, then returns the newest context sent. */
async function nextContext(rig: Rig): Promise<ContextUpdate | undefined> {
  rig.advance(PAST_SNAPSHOT_INTERVAL_MS);
  await sleep(CONTEXT_TIMER_WAIT_MS);
  return lastOf(rig.client().contexts);
}

async function verifyConnection(): Promise<void> {
  section('connection');
  const signedOut = buildRig();
  await signedOut.adapter.initialize();
  check(signedOut.clients.length === 0, 'no token: no client is created');
  check(signedOut.adapter.feed.status === 'disabled', 'no token: the AI is off');
  signedOut.adapter.unbindScene();

  const rig = buildRig();
  rig.tokens = ['first-token', 'second-token'];
  await rig.adapter.initialize();
  const client = rig.client();
  check(client.options.unhandledActions === 'ignore', 'the adapter answers actions itself');
  const provider = client.options.token;
  if (typeof provider === 'function') {
    check((await provider()) === 'first-token', 'the provider hands over the primed token first');
    check((await provider()) === 'second-token', 'then fetches a fresh one');
  } else {
    check(false, 'the client is given a token provider, not a fixed token');
  }
  check(rig.adapter.feed.status === 'connecting', 'connecting until the handshake');
  client.fire('connected', { sessionId: 's1', limits: LIMITS, resumed: false });
  check(rig.adapter.feed.status === 'online', 'online after the handshake');
  check(client.contexts.length === 1, 'a connect sends context_set at once');
  check(client.states.length === 1, 'and the whole state');
  rig.adapter.accountChanged();
  check(client.closed, 'an account change closes the old connection');
  rig.adapter.unbindScene();
}

async function connectedRig(): Promise<Rig> {
  const rig = buildRig();
  rig.tokens = ['token'];
  await rig.adapter.initialize();
  rig.client().fire('connected', { sessionId: 's1', limits: LIMITS, resumed: false });
  return rig;
}

async function verifyActionResults(): Promise<void> {
  section('action results');
  const rig = await connectedRig();
  const client = rig.client();

  client.fire('ai_action', action('ok-1', 'announce', { text: 'Welcome, crawler.' }));
  check(client.resultFor('ok-1')?.ok === true, 'a run action is answered ok');
  check(rig.toasts.includes('Welcome, crawler.'), 'and it ran');

  client.fire('ai_action', action('cooldown-1', 'announce', { text: 'Again!' }));
  const cooldown = client.resultFor('cooldown-1');
  check(
    cooldown?.ok === false && cooldown.detail !== undefined,
    'a governor refusal is answered with its reason',
  );

  client.fire('ai_action', action('unknown-1', 'summon_dragon', {}));
  check(client.resultFor('unknown-1')?.ok === false, 'an unknown action is answered not ok');

  client.fire('ai_action', action('bad-1', 'announce', { text: 7 }));
  check(client.resultFor('bad-1')?.ok === false, 'invalid parameters are answered not ok');

  rig.world.paused = true;
  client.fire('ai_action', action('held-1', 'remember', REMEMBER));
  check(
    client.resultFor('held-1') === undefined,
    'a call made while paused is held, not answered yet',
  );
  rig.advance(PAST_HELD_ACTION_AGE_MS);
  rig.world.paused = false;
  rig.adapter.update();
  const expired = client.resultFor('held-1');
  check(
    expired?.ok === false && expired.detail?.includes('expired') === true,
    'a held call that went stale is answered expired',
  );

  rig.world.paused = true;
  const coinsBeforeGift = rig.human.coins;
  const presentationsBeforeGift = rig.humanAchievements.presentationCount;
  client.fire('ai_action', action('held-2', 'grant_reward_chest', REWARD_CHEST));
  rig.world.paused = false;
  rig.world.indicators = false;
  rig.adapter.update();
  const resumed = client.resultFor('held-2');
  check(
    resumed?.ok === true,
    `a held call runs once play resumes (${resumed?.detail ?? 'no result'})`,
  );
  check(
    rig.human.coins > coinsBeforeGift &&
      rig.humanAchievements.presentationCount === presentationsBeforeGift + 1,
    'the gifted chest pays at once: coins land and one presentation is queued',
  );
  check(rig.adapter.feed.interventions.length === 0, 'with indicators off, nothing is shown');

  rig.world.indicators = true;
  rig.advance(PAST_REWARD_CHEST_COOLDOWN_MS);
  client.fire('ai_action', action('shown-1', 'grant_reward_chest', REWARD_CHEST));
  const shown = client.resultFor('shown-1');
  check(shown?.ok === true, `a second chest lands (${shown?.detail ?? 'no result'})`);
  check(
    rig.adapter.feed.interventions.length === 1,
    'with indicators on, a landed action is shown',
  );

  rig.world.paused = true;
  client.fire('ai_action', action('held-3', 'announce', { text: 'Later.' }));
  rig.adapter.unbindScene();
  const dropped = client.resultFor('held-3');
  check(dropped?.ok === false, 'a call held when the scene goes away is answered');
  client.fire('ai_action', action('no-scene-1', 'announce', { text: 'Anyone?' }));
  check(
    client.resultFor('no-scene-1')?.ok === false,
    'with no scene bound, a call is answered not ok',
  );
}

async function verifyIntensity(): Promise<void> {
  section('intensity');
  const rig = await connectedRig();
  const client = rig.client();
  for (const intensity of AI_INTENSITIES) {
    rig.world.intensity = intensity;
    const context = await nextContext(rig);
    const expected = intensityPolicy(intensity);
    check(
      context?.policyMultiplier === expected.policyMultiplier,
      `${intensity} sends policyMultiplier ${expected.policyMultiplier.toString()}`,
    );
    check(
      context?.allowedSeverities?.join() === expected.allowedSeverities?.join(),
      `${intensity} sends allowedSeverities ${expected.allowedSeverities?.join() ?? '(all)'}`,
    );
    check(
      context?.flags?.commentaryOnly === expected.commentaryOnly,
      `${intensity} sends commentaryOnly ${String(expected.commentaryOnly)}`,
    );
  }
  check(intensityPolicy('off').policyMultiplier === 0, 'Off is multiplier 0');
  check(
    intensityPolicy('commentary').allowedSeverities?.join() === 'benign',
    'Commentary allows benign only',
  );
  check(intensityPolicy('classic').policyMultiplier === 1, 'Classic is multiplier 1');
  check(intensityPolicy('chaotic').policyMultiplier === 2, 'Chaotic is multiplier 2');

  rig.world.intensity = 'commentary';
  client.fire('ai_action', action('spawn-1', 'spawn_mob', { mob_type: 'goblin', count: 1 }));
  const spawn = client.resultFor('spawn-1');
  check(
    spawn?.ok === false && spawn.detail?.includes('intensity') === true,
    'Commentary refuses a disruptive action',
  );
  client.fire('ai_action', action('say-1', 'remember', REMEMBER));
  check(client.resultFor('say-1')?.ok === true, 'Commentary still runs a commentary action');
  client.fire(
    'ai_action',
    action('heal-1', 'heal', { target_player: 'active', percent: HEAL_PERCENT }),
  );
  const heal = client.resultFor('heal-1');
  check(
    heal?.ok === false && heal.detail?.includes('commentary') === true,
    'Commentary refuses a benign action that would touch the run',
  );
  rig.world.intensity = 'classic';
  rig.world.paused = true;
  client.fire('ai_action', action('held-spawn-1', 'spawn_mob', { mob_type: 'goblin', count: 1 }));
  rig.world.intensity = 'commentary';
  rig.world.paused = false;
  rig.adapter.update();
  const heldSpawn = client.resultFor('held-spawn-1');
  check(
    heldSpawn?.ok === false && heldSpawn.detail?.includes('intensity') === true,
    'a call held through a pause is judged by the intensity set during the pause',
  );
  rig.world.intensity = 'off';
  rig.advance(PAST_HELD_ACTION_AGE_MS);
  client.fire('ai_action', action('say-2', 'announce', { text: 'Hello?' }));
  check(client.resultFor('say-2')?.ok === false, 'Off refuses everything');
  rig.adapter.unbindScene();
}

async function verifyChat(): Promise<void> {
  section('chat and offline fallback');
  const rig = buildRig();
  rig.tokens = ['token'];
  await rig.adapter.initialize();
  const client = rig.client();
  const feed = rig.adapter.feed;

  rig.adapter.chatWithSystem('Hello?');
  check(client.messages.length === 0, 'before the handshake, nothing is sent');
  check(
    feed.message !== null && SYSTEM_FALLBACK_LINES.includes(feed.message.text),
    'the System answers with a scripted line',
  );
  check(
    (await rig.adapter.chatWithMordecai()).length > 0,
    'Mordecai answers offline with his usual advice',
  );

  client.fire('connected', { sessionId: 's1', limits: LIMITS, resumed: false });
  rig.adapter.chatWithSystem('Hello, System.');
  const sent = lastOf(client.messages);
  check(
    sent?.characterName === SYSTEM_CHARACTER_NAME && sent.text === 'Hello, System.',
    'connected, chat goes over the socket as player_message',
  );

  client.fire('ai_typing', { characterName: SYSTEM_CHARACTER_NAME, typing: true });
  check(feed.typingCharacter === SYSTEM_CHARACTER_NAME, 'ai_typing shows the System typing');
  client.fire('chat', {
    messageId: 'm1',
    characterName: SYSTEM_CHARACTER_NAME,
    text: 'Well, ',
    done: false,
  });
  client.fire('chat', {
    messageId: 'm1',
    characterName: SYSTEM_CHARACTER_NAME,
    text: 'Well, crawler.',
    done: false,
  });
  check(feed.message?.text === 'Well, crawler.', 'deltas accumulate');
  rig.adapter.update();
  check(
    feed.message !== null &&
      feed.message.revealed > 0 &&
      feed.message.revealed <= TYPEWRITER_CHARS_PER_TICK,
    'the typewriter reveals a few characters a frame',
  );
  client.fire('chat', {
    messageId: 'm1',
    characterName: SYSTEM_CHARACTER_NAME,
    text: 'Well, crawler. Pick one.',
    done: true,
    choices: [
      { id: 'c-left', label: 'Left' },
      { id: 'c-right', label: 'Right' },
    ],
  });
  check(feed.typingCharacter === null, 'the final message ends the typing indicator');
  check(feed.message?.choices.length === 2, 'reply buttons come from choices');
  rig.adapter.answerChoice('c-right');
  const reply = lastOf(client.messages);
  check(
    reply?.text === 'Right' && reply.replyTo === 'c-right',
    'a reply button sends its label, with the choice id as replyTo',
  );
  check(feed.message?.choices.length === 0, 'an answered question drops its buttons');

  client.fire('ai_state', {
    characterName: SYSTEM_CHARACTER_NAME,
    mood: { label: 'bored', intensity: 1 },
    relationship: { respect: LOW_OPINION },
  });
  client.fire('ai_state', {
    characterName: SYSTEM_CHARACTER_NAME,
    mood: { label: 'amused', intensity: 1 },
    relationship: { respect: HIGH_OPINION },
  });
  check(
    feed.flash?.text === "The System's opinion of you: ▲ Amused",
    `a rising opinion flashes with an up arrow (${feed.flash?.text ?? 'none'})`,
  );
  client.fire('ai_state', {
    characterName: SYSTEM_CHARACTER_NAME,
    mood: { label: 'irritated', intensity: 1 },
    relationship: { respect: HIGH_OPINION, irritation: HIGH_OPINION },
  });
  check(
    feed.flash?.text === "The System's opinion of you: ▼ Irritated",
    `growing irritation flashes with a down arrow (${feed.flash?.text ?? 'none'})`,
  );

  const mordecaiReply = rig.adapter.chatWithMordecai();
  const greeting = lastOf(client.messages);
  check(
    greeting?.characterName === MORDECAI_CHARACTER_NAME,
    'talking to Mordecai sends him a player_message',
  );
  client.fire('chat', {
    messageId: 'm2',
    characterName: MORDECAI_CHARACTER_NAME,
    text: 'Drink a potion, kid.',
    done: true,
  });
  check((await mordecaiReply) === 'Drink a potion, kid.', 'his reply goes to his dialog box');
  check(feed.message?.characterName !== MORDECAI_CHARACTER_NAME, 'and not to the panel');

  client.fire('disconnected', { code: 1006, reason: '', reconnectInMs: 500 });
  check(feed.status === 'offline', 'a dropped connection shows offline');
  const sentBefore = client.messages.length;
  rig.adapter.chatWithSystem('Are you there?');
  check(client.messages.length === sentBefore, 'offline, chat is not queued for later');
  check(
    feed.message !== null && SYSTEM_FALLBACK_LINES.includes(feed.message.text),
    'offline, the System answers from its script',
  );
  const beforeMoment = feed.message?.key;
  rig.bus.emit('stairwellFound', {});
  check(
    feed.message !== null &&
      feed.message.key !== beforeMoment &&
      SYSTEM_FALLBACK_LINES.includes(feed.message.text),
    'offline, a big moment gets a scripted line',
  );
  rig.adapter.unbindScene();
}

function verifyFeedLimits(): void {
  section('feed limits');
  const feed = new AIChatFeed();
  const longReply = 'blah '.repeat(MAX_DISPLAY_CHARS);
  feed.onChat({
    messageId: 'long',
    characterName: SYSTEM_CHARACTER_NAME,
    text: longReply,
    done: true,
  });
  check(
    feed.message !== null && feed.message.text.length <= MAX_DISPLAY_CHARS,
    'a long reply is cut to the display limit',
  );
  check(
    feed.message !== null && feed.message.holdTicks <= MAX_HOLD_TICKS,
    'a long reply is held no longer than the cap',
  );
}

async function verifyRace(): Promise<void> {
  section('account change during a token fetch');
  const rig = buildRig();
  let release: (token: string | null) => void = () => undefined;
  const slowFetch = new Promise<string | null>((resolve) => {
    release = resolve;
  });
  rig.tokens = [];
  const adapter = new AIAdapter({
    createClient: (options) => {
      const client = new FakeClient(options);
      rig.clients.push(client);
      return client;
    },
    fetchToken: () => slowFetch,
    serverUrl: 'http://ai.test',
  });
  const first = adapter.initialize();
  adapter.accountChanged();
  release('stale-token');
  await first;
  await Promise.resolve();
  check(rig.clients.length === 1, 'a stale fetch does not open a second connection');
  rig.adapter.unbindScene();
}

async function verifyStatus(): Promise<void> {
  section('status');
  const rig = await connectedRig();
  const client = rig.client();
  const feed = rig.adapter.feed;
  client.fire('notice', {
    kind: 'degraded',
    message: 'fallback model',
    retryAfterMs: DEGRADED_RETRY_MS,
  });
  check(feed.status === 'degraded', 'a degraded notice turns the dot amber');
  rig.advance(DEGRADED_RETRY_MS + 1);
  rig.adapter.update();
  check(feed.status === 'online', 'it returns to online once the retry window passes');
  client.fire('notice', { kind: 'ai_resting', message: 'resting' });
  check(feed.status === 'degraded', 'a resting AI is degraded too');
  client.fire('notice', { kind: 'rate_limited', message: 'slow down', retryAfterMs: 1 });
  rig.advance(2);
  rig.adapter.update();
  check(feed.status === 'online', 'a rate limit clears after its retry window');
  client.fire('disconnected', { code: 1006, reason: '' });
  check(feed.status === 'offline', 'a disconnect is offline');
  client.fire('connected', { sessionId: 's2', limits: LIMITS, resumed: true });
  check(feed.status === 'online', 'a reconnect is online again');
  rig.adapter.unbindScene();
}

async function verifySceneHandover(): Promise<void> {
  section('scene handover');
  const rig = await connectedRig();
  const nextBus = new EventBus();
  const leftWith: ChallengeSummary = {
    challengeId: 'handover-1',
    title: 'Rat Race',
    template: CHALLENGE_TEMPLATE_IDS[0],
    objective: 'Kill rats',
    rewardRarity: 'Common',
    offeredBy: SYSTEM_CHARACTER_NAME,
  };
  rig.rebind(rig.bus, () => {
    rig.bus.emit('challengeFailed', { ...leftWith, reason: 'left the floor', taunt: '' });
  });
  rig.rebind(nextBus);
  check(
    rig.client().events.some((event) => event.type === 'challengeFailed'),
    'what a scene emits as it is let go of reaches the server before the next scene takes over',
  );
  rig.adapter.unbindScene();
}

await verifyConnection();
await verifyActionResults();
await verifyIntensity();
await verifySceneHandover();
await verifyChat();
await verifyStatus();
verifyFeedLimits();
await verifyRace();

console.log(`\n${(checks - failures).toString()}/${checks.toString()} checks passed`);
if (failures > 0) {
  console.error(`${failures.toString()} failed`);
  process.exit(1);
}
process.exit(0);
