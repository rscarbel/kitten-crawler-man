#!/usr/bin/env tsx
/**
 * Headless harness for the AI action registry (`src/ai/actions/`): every
 * action the AI can take, driven through the same validation, governor and
 * executor the live adapter uses, on a real generated floor with real crawlers.
 *
 *  - Registry shape: unique snake_case names, policies inside the contract,
 *    context flags and characters the governor knows, and the mob and item
 *    vocabularies read from the game's own tables.
 *  - Schema against tool definition: for every action, arguments built from
 *    its generated JSON Schema are accepted, and every way of breaking one
 *    argument (wrong type, out of range, off the list, missing, unknown key)
 *    is refused.
 *  - Fuzz through the governor: thousands of random calls, valid and not,
 *    against random scene states (menus open, low HP, boss fights, safe
 *    rooms, fights), on a fake clock. No call may throw, and the fairness
 *    rules must hold after every one: nothing hostile appears or harms while
 *    a menu is up or a crawler is under a quarter of their health, no stat
 *    change stacks, no spawn lands closer than the minimum distance, no HP
 *    action kills, cooldowns and per-floor limits and budgets are never
 *    exceeded.
 *  - A sale never lets a unit be bought and sold back for a profit.
 *  - The show: AI achievements are filed once per title and survive a save,
 *    questions report their answers, the favour meter stays in range and
 *    never punishes, and every challenge template runs its offer, accept,
 *    win and fail paths, refusing offers that could not be won fairly.
 *  - The dispatcher holds calls through a pause and expires stale ones, and
 *    both wire shapes of `ai_action` parse.
 *
 * Run: npm run verify:ai-actions
 */
import { partyOwnsGear } from '../src/loot/gearPools';
import { crawlerName } from '../src/characters/characters';
import { AchievementManager, aiAchievementKey } from '../src/core/progression/AchievementManager';
import { AchievementAwards } from '../src/systems/AchievementAwards';
import { presentationAwardId } from '../src/loot/rewardChest';
import { EventBus, type GameEvents } from '../src/core/EventBus';
import {
  FAVOR_MAX,
  FAVOR_MIN,
  FAVOR_START,
  ViewerFavor,
  favorPerk,
  parseViewerFavor,
} from '../src/core/progression/viewerFavor';
import { AIShowStage } from '../src/ai/show/AIShowStage';
import {
  CHALLENGE_MAX_SECONDS,
  CHALLENGE_TEMPLATE_IDS,
  minStairwellDashSeconds,
} from '../src/ai/show/challenges';
import { AIChallengeSystem } from '../src/systems/AIChallengeSystem';
import type { SystemContext } from '../src/systems/GameSystem';
import { SpellSystem } from '../src/systems/SpellSystem';
import { MobRoster } from '../src/systems/kits/SceneWorld';
import { FAVOR_SWING_MAX } from '../src/ai/actions/show';
import { TILE_SIZE } from '../src/core/constants';
import {
  makeBloodVomit,
  makeBurn,
  makePoison,
  type StatusEffect,
} from '../src/core/combat/StatusEffect';
import { BLOOD_VOMIT_MAX_HP_SHARE } from '../src/core/combat/statusTuning';
import { pendingStatusDamage } from '../src/Player';
import { isItemId, ITEM_DEF, type ItemId } from '../src/core/items/defs/ItemDefs';
import { CatPlayer } from '../src/creatures/CatPlayer';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import type { Mob } from '../src/creatures/Mob';
import {
  PRICE_ADJUSTMENT_MAX_MULTIPLIER,
  PRICE_ADJUSTMENT_MIN_MULTIPLIER,
  buyPrice,
  clearPriceAdjustment,
  sellPrice,
  setPriceAdjustment,
} from '../src/economy/pricing';
import { SHOPS, isShopId } from '../src/economy/shops';
import { buyFromShop, createShopStock } from '../src/economy/shopStock';
import { level1 } from '../src/levels/level1';
import { dungeonOptionsForLevel } from '../src/levels/dungeonOptions';
import { GameMap } from '../src/map/GameMap';
import { aiCameraSpotlight } from '../src/ai/actions/cameraSpotlight';
import {
  MIN_SPAWN_DISTANCE_TILES,
  TIMER_DELTA_LIMIT_SECONDS,
  TIMER_FLOOR_SECONDS,
  aiSpawnableMobTypes,
} from '../src/ai/actions/combat';
import { AIActionDispatcher, parseServerAction } from '../src/ai/actions/dispatch';
import { aiGiftableItemIds } from '../src/ai/actions/economy';
import {
  ActionGovernor,
  FLOOR_BUDGETS,
  HURT_IN_COMBAT_FRACTION,
  LOW_HP_FRACTION,
  LOW_HP_PERCENT,
} from '../src/ai/actions/governor';
import {
  AI_CHARACTER_MORDECAI,
  AI_CHARACTER_SYSTEM,
  AI_CHARACTER_VIEWERS,
  secondsToFrames,
} from '../src/ai/actions/helpers';
import {
  AI_ACTIONS,
  executeAIAction,
  generateAIToolDefinitions,
  tickAIActions,
  toolDefinitionFor,
  type AIActionOutcome,
} from '../src/ai/actions/registry';
import { validateParams, type JsonSchema } from '../src/ai/actions/schema';
import { aiActionTimers } from '../src/ai/actions/timers';
import { TELEPORT_HOSTILE_CLEARANCE_TILES } from '../src/ai/actions/world';
import type { FloorLedgerSnapshot, FloorLedgerStore } from '../src/ai/actions/ledgerStore';
import { tileOf } from '../src/ai/actions/helpers';
import { standaloneMobKinds } from '../src/levels/mobKinds';
import { liveSpawnContext, spawnMob } from '../src/levels/spawnFunnel';
import {
  AI_BUDGET_POOLS,
  AI_CONTEXT_FLAGS,
  type AIActionDef,
  type AILevelTimer,
  type AISceneContext,
  type AIBudgetPool,
  aiFloorKey,
} from '../src/ai/actions/types';
import { COMMENTARY_ACTIONS, intensityRefusal, isCommentaryAction } from '../src/ai/aiIntensity';
import { AI_TOOLS } from '../src/ai/aiTools';
import { SESSION_FLAG_NAMES } from '../src/ai/context/sessionContext';

let checksRun = 0;
let checksFailed = 0;

/** Logs only a failing check, so a full run stays readable; each section prints its count. */
function check(condition: boolean, description: string): void {
  checksRun++;
  if (condition) return;
  checksFailed++;
  console.log(`  FAIL ${description}`);
}

let sectionStartRun = 0;
let sectionStartFailed = 0;
function section(title: string): void {
  sectionStartRun = checksRun;
  sectionStartFailed = checksFailed;
  console.log(`\n${title}`);
}
function endSection(): void {
  if (checksFailed > sectionStartFailed) return;
  console.log(`  ok   ${checksRun - sectionStartRun} checks`);
}

const SNAKE_CASE = /^[a-z][a-z0-9_]*$/;
const KNOWN_CHARACTERS = new Set([
  AI_CHARACTER_SYSTEM,
  AI_CHARACTER_MORDECAI,
  AI_CHARACTER_VIEWERS,
]);
const KNOWN_FLAGS = new Set<string>(AI_CONTEXT_FLAGS);
/** The most attention budget any single action may cost. */
const MAX_ACTION_COST = 10;

/** Fuzz volume: random calls per action, and how far the fake clock may jump between calls. */
const FUZZ_CALLS_PER_ACTION = 400;
const MAX_CLOCK_STEP_MS = 90_000;
/** One in this many fuzzed calls carries deliberately broken arguments. */
const BROKEN_ARGS_ONE_IN = 4;
const LOW_HP_SCENE_CHANCE = 0.3;
const KNOCKED_OUT_SCENE_CHANCE = 0.05;
const PAUSED_SCENE_CHANCE = 0.2;
const BOSS_SCENE_CHANCE = 0.1;
const SAFE_ROOM_SCENE_CHANCE = 0.15;
const COMBAT_SCENE_CHANCE = 0.3;
const MORDECAI_CALL_CHANCE = 0.2;
const RANDOM_TEXT_MAX_EXTRA = 3;
/** Frames ticked after each call, so timed effects get to expire mid-run. */
const FRAMES_PER_STEP = 120;
const COLLAPSE_LIMIT_FRAMES = 36_000;
/** A collapse clock already under the cut floor, and how far a top-up moves it. */
const TIMER_LOW_START_SECONDS = 30;
const TIMER_TOP_UP_SECONDS = 10;
/** Longer than adjust_level_timer's cooldown, so each call is judged on the clock alone. */
const TIMER_CALL_SPACING_MS = 180_000;
/** Room for a small top-up before the clock is full. */
const TIMER_NEAR_FULL_GAP_SECONDS = 5;
const STARTING_COINS = 400;
const VALID_SAMPLE_TEXT = 'Gary, Who Has Had Enough';
/** Units bought out of a line to see what the shop pays as its shelf empties. */
const RESALE_DRAIN_UNITS = 60;
const SALE_MULTIPLIER_MID = 0.8;
/** The burn and poison clocks, as `Player.tickStatusEffects` runs them. */
const BURN_FORECAST_INTERVAL = 60;
const POISON_FORECAST_INTERVAL = 120;
const FORECAST_MAX_HP = 100;
const HURT_TEST_FRACTION = 0.3;
/**
 * Constitution the test human carries past a fresh crawler's, as a crawler a
 * floor into a run does: at a fresh crawler's 10 HP the HP shields' fractions
 * round onto the same whole hit point and every check between them is moot.
 */
const TEST_CRAWLER_EXTRA_CONSTITUTION = 2;
const PERCENT_SCALE = 100;
/** Frames a status is ticked for: past the longest one the AI applies. */
const STATUS_RUN_FRAMES = 2400;
const STAT_CUT_POINTS = 3;
const SET_HP_LOWEST_PERCENT = 25;
const FINE_TEST_PURSE = 200;
const FINE_TEST_AMOUNT = 40;
/** Rats put on the floor for the kill challenges. */
const CHALLENGE_RATS = 4;
const CHALLENGE_KILLS = 2;
const CHALLENGE_SECONDS = 60;
const CHALLENGE_SHORT_SECONDS = 20;
/** One gameplay second, in update frames. */
const UPDATE_FRAMES_PER_SECOND = 60;
const HURT_HP = 1;

// ── Registry shape ──────────────────────────────────────────────────────────

section('registry shape');
{
  const sessionFlags = new Set<string>(SESSION_FLAG_NAMES);
  for (const flag of AI_CONTEXT_FLAGS) {
    check(sessionFlags.has(flag), `policy flag ${flag} is also a context_set session flag`);
  }
  const names = AI_ACTIONS.map((def) => def.name);
  check(new Set(names).size === names.length, 'action names are unique');
  check(AI_TOOLS.length === AI_ACTIONS.length, 'aiTools exports one tool per registered action');
  for (const def of AI_ACTIONS) {
    check(SNAKE_CASE.test(def.name), `${def.name} is snake_case`);
    check(def.description.trim().length > 0, `${def.name} has a description`);
    const { policy } = def;
    check(policy.cost >= 0 && policy.cost <= MAX_ACTION_COST, `${def.name} cost is in range`);
    check(policy.cooldownMs >= 0, `${def.name} cooldown is not negative`);
    check(
      policy.maxPerSession === undefined || policy.maxPerSession > 0,
      `${def.name} maxPerSession is positive when set`,
    );
    for (const flag of [...(policy.requiresContext ?? []), ...(policy.forbidsContext ?? [])]) {
      check(KNOWN_FLAGS.has(flag), `${def.name} names a known context flag (${flag})`);
    }
    for (const character of def.characters ?? []) {
      check(KNOWN_CHARACTERS.has(character), `${def.name} names a known character (${character})`);
    }
    const keys = def.params.map((field) => field.key);
    check(new Set(keys).size === keys.length, `${def.name} parameter keys are unique`);
  }

  for (const name of COMMENTARY_ACTIONS) {
    const def = AI_ACTIONS.find((candidate) => candidate.name === name);
    check(
      def?.policy.severity === 'benign',
      `commentary action ${name} is a registered benign action`,
    );
  }
  for (const tool of generateAIToolDefinitions()) {
    const forbidsCommentary = (tool.policy.forbidsContext ?? []).includes('commentaryOnly');
    check(
      forbidsCommentary !== isCommentaryAction(tool.name),
      `${tool.name} ${isCommentaryAction(tool.name) ? 'runs' : 'is withheld'} under commentaryOnly on the server too`,
    );
    for (const flag of [
      ...(tool.policy.requiresContext ?? []),
      ...(tool.policy.forbidsContext ?? []),
    ]) {
      check(sessionFlags.has(flag), `${tool.name} names a context_set session flag (${flag})`);
    }
  }
  for (const def of AI_ACTIONS) {
    const refusal = intensityRefusal('commentary', {
      name: def.name,
      severity: def.policy.severity,
    });
    check(
      (refusal === null) === isCommentaryAction(def.name),
      `Commentary intensity ${refusal === null ? 'allows' : 'refuses'} ${def.name}`,
    );
  }

  const registered = new Set(standaloneMobKinds());
  const spawnable = aiSpawnableMobTypes();
  check(spawnable.length > 0, 'the AI can name at least one creature');
  check(
    spawnable.every((type) => registered.has(type)),
    'every creature the AI can name is registered with the spawner',
  );
  const giftable = aiGiftableItemIds();
  check(giftable.length > 0, 'the AI can name at least one item');
  check(
    giftable.every((id) => isItemId(id) && ITEM_DEF[id].isQuestItem !== true),
    'no quest item is in the AI item vocabulary',
  );
  const mobTool = generateAIToolDefinitions().find((tool) => tool.name === 'spawn_mob');
  const mobEnum = mobTool?.parameters.properties.mob_type;
  check(
    mobEnum?.type === 'string' && mobEnum.enum?.length === spawnable.length,
    'spawn_mob tool lists exactly the spawnable creatures',
  );
}
endSection();

// ── Schema against tool definition ──────────────────────────────────────────

function sampleValue(schema: JsonSchema): unknown {
  if (schema.type === 'boolean') return true;
  if (schema.type === 'integer') {
    const nonZero = schema.minimum <= 1 && schema.maximum >= 1 ? 1 : schema.minimum;
    return nonZero;
  }
  if (schema.enum !== undefined) return schema.enum[0];
  const minLength = schema.minLength ?? 0;
  const maxLength = schema.maxLength ?? VALID_SAMPLE_TEXT.length;
  return VALID_SAMPLE_TEXT.padEnd(minLength, 'x').slice(0, maxLength);
}

/** Every single-argument way to break a valid call, each with a label for the failure line. */
function brokenVariants(
  schemaKey: string,
  schema: JsonSchema,
  required: boolean,
): { label: string; value: unknown; omit?: boolean }[] {
  const variants: { label: string; value: unknown; omit?: boolean }[] = [];
  if (required) variants.push({ label: 'missing', value: undefined, omit: true });
  variants.push({ label: 'null', value: null });
  variants.push({ label: 'object', value: { nested: schemaKey } });
  if (schema.type === 'integer') {
    variants.push({ label: 'below minimum', value: schema.minimum - 1 });
    variants.push({ label: 'above maximum', value: schema.maximum + 1 });
    variants.push({ label: 'fractional', value: schema.minimum + 1 / 2 });
    variants.push({ label: 'numeric string', value: String(schema.minimum) });
    variants.push({ label: 'NaN', value: Number.NaN });
  } else if (schema.type === 'string') {
    variants.push({ label: 'number', value: 1 });
    if (schema.enum !== undefined) variants.push({ label: 'off the list', value: '__nope__' });
    if (schema.maxLength !== undefined) {
      variants.push({ label: 'too long', value: 'x'.repeat(schema.maxLength + 1) });
    }
    if (schema.minLength !== undefined && schema.minLength > 0) {
      variants.push({ label: 'blank', value: '   ' });
    }
  } else {
    variants.push({ label: 'string', value: 'true' });
  }
  return variants;
}

section('every action accepts its own schema and refuses broken arguments');
{
  for (const def of AI_ACTIONS) {
    const tool = toolDefinitionFor(def);
    const { parameters } = tool;
    check(
      parameters.required.every((key) => key in parameters.properties),
      `${def.name} requires only declared parameters`,
    );
    check(
      Object.keys(parameters.properties).length === def.params.length,
      `${def.name} schema lists every declared parameter`,
    );

    const valid: Record<string, unknown> = {};
    for (const [key, schema] of Object.entries(parameters.properties)) {
      check(schema.description.trim().length > 0, `${def.name}.${key} has a description`);
      if (schema.type === 'string' && schema.enum !== undefined) {
        check(schema.enum.length > 0, `${def.name}.${key} enum is not empty`);
      }
      if (schema.type === 'integer') {
        check(schema.minimum <= schema.maximum, `${def.name}.${key} range is not empty`);
        if (schema.default !== undefined) {
          check(
            schema.default >= schema.minimum && schema.default <= schema.maximum,
            `${def.name}.${key} default is inside its range`,
          );
        }
      }
      valid[key] = sampleValue(schema);
    }
    check(
      validateParams(def.params, valid).ok,
      `${def.name} accepts arguments built from its schema`,
    );
    const requiredOnly: Record<string, unknown> = {};
    for (const key of parameters.required) requiredOnly[key] = valid[key];
    check(
      validateParams(def.params, requiredOnly).ok,
      `${def.name} accepts only its required arguments`,
    );
    check(
      !validateParams(def.params, { ...valid, __unknown__: 1 }).ok,
      `${def.name} refuses an unknown argument`,
    );
    check(!validateParams(def.params, [valid]).ok, `${def.name} refuses an array of arguments`);

    for (const [key, schema] of Object.entries(parameters.properties)) {
      const required = parameters.required.includes(key);
      for (const variant of brokenVariants(key, schema, required)) {
        const broken = Object.fromEntries(
          Object.entries(valid).filter(([other]) => other !== key || variant.omit !== true),
        );
        if (variant.omit !== true) broken[key] = variant.value;
        check(
          !validateParams(def.params, broken).ok,
          `${def.name}.${key} refuses a ${variant.label} value`,
        );
      }
    }
  }
}
endSection();

// ── Fuzz through the governor ───────────────────────────────────────────────

/** What an award changes the moment it is paid: the crawler's purse and the reward screen's queue. */
interface PaidState {
  readonly coins: number;
  readonly presentations: number;
}

function paidState(manager: AchievementManager, crawler: HumanPlayer | CatPlayer): PaidState {
  return { coins: crawler.coins, presentations: manager.presentationCount };
}

/** Every chest pays coins, so a paid award always grows the purse and queues one presentation. */
function paidAtOnce(before: PaidState, after: PaidState): boolean {
  return after.coins > before.coins && after.presentations === before.presentations + 1;
}

interface FakeWorld {
  readonly scene: AISceneContext;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly mobs: Mob[];
  readonly map: GameMap;
  readonly toasts: string[];
  readonly musicClaims: Set<string>;
  readonly bus: EventBus;
  readonly favor: ViewerFavor;
  readonly challenges: AIChallengeSystem;
  readonly show: AIShowStage;
  readonly achievements: { readonly human: AchievementManager; readonly cat: AchievementManager };
  flags: { paused: boolean; boss: boolean; safeRoom: boolean; combat: boolean };
  timerFrames: number;
}

function buildWorld(): FakeWorld {
  const map = new GameMap({
    mapSize: level1.mapSize,
    tileHeight: TILE_SIZE,
    mapType: 'dungeon',
    dungeon: dungeonOptionsForLevel(level1),
  });
  // A room spawn point: open ground away from any safe room, where a fair spawn is possible.
  const firstRoom = map.mobSpawnPoints.length > 0 ? map.mobSpawnPoints[0] : null;
  const start = firstRoom ?? { x: 1, y: 1 };
  const human = new HumanPlayer(start.x, start.y, TILE_SIZE);
  const cat = new CatPlayer(start.x + 1, start.y, TILE_SIZE);
  human.isActive = true;
  human.applyPermanentStat('constitution', TEST_CRAWLER_EXTRA_CONSTITUTION);
  human.hp = human.maxHp;
  const mobs: Mob[] = [];
  const toasts: string[] = [];
  const musicClaims = new Set<string>();
  const humanAchievements = new AchievementManager();
  const catAchievements = new AchievementManager();
  const bus = new EventBus();
  const favor = new ViewerFavor();
  const awards = new AchievementAwards({
    humanAchievements,
    catAchievements,
    human,
    cat,
    bus,
    activeCrawler: () => (cat.isActive ? 'cat' : 'human'),
    owns: (id) => partyOwnsGear([human, cat], id),
  });
  const postToast = (text: string): void => void toasts.push(text);
  const challenges = new AIChallengeSystem({
    bus,
    gameMap: map,
    human,
    cat,
    postToast,
    grantReward: (side, rarity) =>
      void awards.grantChest(side === 'Human' ? 'human' : 'cat', { rarity, source: 'challenge' }),
  });
  const show = new AIShowStage({ bus, favor, challenges, postToast });
  const world: FakeWorld = {
    human,
    cat,
    mobs,
    map,
    toasts,
    musicClaims,
    bus,
    favor,
    challenges,
    show,
    achievements: { human: humanAchievements, cat: catAchievements },
    flags: { paused: false, boss: false, safeRoom: false, combat: false },
    timerFrames: COLLAPSE_LIMIT_FRAMES,
    scene: {
      getHuman: () => human,
      getCat: () => cat,
      getMobs: () => mobs,
      getGameMap: () => map,
      getLevelId: () => level1.id,
      spawnMob: (mob) => mobs.push(mob),
      isBossFightActive: () => world.flags.boss,
      isPaused: () => world.flags.paused,
      isInSafeRoom: () => world.flags.safeRoom,
      isInCombat: () => world.flags.combat,
      postToast: (text) => toasts.push(text),
      getAwards: () => awards,
      getAudio: () => null,
      getAudioScope: () => ({
        claimMusic: (claim) => musicClaims.add(claim.owner),
        releaseMusic: (owner) => musicClaims.delete(owner),
        isMusicClaimed: (owner) => musicClaims.has(owner),
      }),
      getLevelTimer: (): AILevelTimer => ({
        remainingFrames: world.timerFrames,
        limitFrames: COLLAPSE_LIMIT_FRAMES,
        setRemainingFrames: (frames) => {
          world.timerFrames = frames;
        },
      }),
      spotlight: (point, frames) => aiCameraSpotlight.start(point, frames),
      getShow: () => show,
    },
  };
  return world;
}

/** The frame a system is updated with: only what the challenge system reads is real. */
function systemContextOf(world: FakeWorld): SystemContext {
  const active = world.human.isActive ? world.human : world.cat;
  return {
    human: world.human,
    cat: world.cat,
    active,
    inactive: active === world.human ? world.cat : world.human,
    activeIsMoving: false,
    roster: new MobRoster(world.map, new SpellSystem()),
    gameMap: world.map,
  };
}

/**
 * Plays the player's part between fuzzed calls: answers or waves away a
 * question, sits through or skips an advert, takes or turns down an offer,
 * and lets a running challenge's clock run, so each show action keeps
 * getting a free stage to run on.
 */
function pumpShow(world: FakeWorld): void {
  const { show } = world;
  if (show.pendingQuestion !== null) {
    if (Math.random() < 1 / 2) show.answer(0);
    else show.dismissQuestion();
  }
  if (show.sponsorBreak !== null) show.endSponsorBreak(Math.random() < 1 / 2);
  if (show.challengeOffer !== null) {
    if (Math.random() < 1 / 2) show.acceptChallenge();
    else show.declineChallenge();
  }
  const running = (): boolean => world.challenges.current !== null;
  const ctx = systemContextOf(world);
  for (let frame = 0; frame < FRAMES_PER_STEP * UPDATE_FRAMES_PER_SECOND && running(); frame++) {
    world.challenges.update(ctx);
  }
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function pick<T>(values: readonly T[]): T | undefined {
  return values[randomInt(0, values.length - 1)];
}

function randomValue(schema: JsonSchema): unknown {
  if (schema.type === 'boolean') return Math.random() < 1 / 2;
  if (schema.type === 'integer') return randomInt(schema.minimum, schema.maximum);
  if (schema.enum !== undefined) return pick(schema.enum);
  const length = randomInt(schema.minLength ?? 0, schema.maxLength ?? RANDOM_TEXT_MAX_EXTRA);
  return 'z'.repeat(length);
}

function randomArgs(def: AIActionDef): unknown {
  const { properties, required } = toolDefinitionFor(def).parameters;
  const args: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(properties)) {
    if (!required.includes(key) && Math.random() < 1 / 2) continue;
    args[key] = randomValue(schema);
  }
  if (randomInt(1, BROKEN_ARGS_ONE_IN) === 1) {
    const key = pick(Object.keys(properties)) ?? 'junk';
    args[key] = pick([null, -1, Number.MAX_SAFE_INTEGER, '', 'nope', { a: 1 }, [1, 2]]);
  }
  return args;
}

function randomiseScene(world: FakeWorld): void {
  const lowHp = Math.random() < LOW_HP_SCENE_CHANCE;
  for (const crawler of [world.human, world.cat]) {
    crawler.isKnockedOut = Math.random() < KNOCKED_OUT_SCENE_CHANCE;
    const share = lowHp ? Math.random() * LOW_HP_FRACTION : LOW_HP_FRACTION + Math.random();
    crawler.hp = Math.max(1, Math.min(crawler.maxHp, Math.round(crawler.maxHp * share)));
  }
  world.flags = {
    paused: Math.random() < PAUSED_SCENE_CHANCE,
    boss: Math.random() < BOSS_SCENE_CHANCE,
    safeRoom: Math.random() < SAFE_ROOM_SCENE_CHANCE,
    combat: Math.random() < COMBAT_SCENE_CHANCE,
  };
  for (const crawler of [world.human, world.cat]) {
    if (Math.random() < 1 / 2) crawler.applyStatus(makeBurn());
    if (Math.random() < 1 / 2) crawler.applyStatus(makePoison());
  }
  world.human.coins = randomInt(0, STARTING_COINS);
  world.cat.coins = randomInt(0, STARTING_COINS);
  if (Math.random() < 1 / 2) {
    world.human.tempStatMods.length = 0;
    world.cat.tempStatMods.length = 0;
  }
}

const DOT_STATUSES: ReadonlySet<string> = new Set(['burn', 'poison', 'electrified']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function targetOf(world: FakeWorld, target: unknown): HumanPlayer | CatPlayer {
  if (target === 'Human') return world.human;
  if (target === 'Cat') return world.cat;
  return world.human.isActive ? world.human : world.cat;
}

function anyHurt(world: FakeWorld): boolean {
  return (
    anyVulnerable(world) ||
    [world.human, world.cat].some((crawler) => crawler.hp / crawler.maxHp < HURT_IN_COMBAT_FRACTION)
  );
}

function anyVulnerable(world: FakeWorld): boolean {
  return [world.human, world.cat].some(
    (crawler) =>
      crawler.isKnockedOut || !crawler.isAlive || crawler.hp / crawler.maxHp < LOW_HP_FRACTION,
  );
}

section('fuzzed calls through the governor keep the fairness rules');
{
  let clockMs = 0;
  const world = buildWorld();
  const lastSuccessAt = new Map<string, number>();
  const floorSuccesses = new Map<string, number>();
  let threw = 0;
  let succeeded = 0;

  for (const def of AI_ACTIONS) {
    // A governor per action, so one action spending a shared pool cannot starve the next.
    const governor = new ActionGovernor(() => clockMs);
    const spent = new Map<AIBudgetPool, number>();
    for (let call = 0; call < FUZZ_CALLS_PER_ACTION; call++) {
      clockMs += randomInt(0, MAX_CLOCK_STEP_MS);
      randomiseScene(world);
      // A price change runs on the wall clock, which this loop's fake clock does not move.
      if (Math.random() < 1 / 2) clearPriceAdjustment();
      const characterName =
        Math.random() < MORDECAI_CALL_CHANCE ? AI_CHARACTER_MORDECAI : AI_CHARACTER_SYSTEM;
      pumpShow(world);
      const vulnerableBefore = anyVulnerable(world);
      const hurtInFightBefore = world.flags.combat && anyHurt(world);
      const pausedBefore = world.flags.paused;
      const combatBefore = world.flags.combat;
      const mobsBefore = world.mobs.length;
      const args = randomArgs(def);
      const budgetBefore = AI_BUDGET_POOLS.map((pool) =>
        governor.remainingBudget(world.scene, pool),
      );

      let outcome: AIActionOutcome;
      try {
        outcome = executeAIAction(
          { name: def.name, params: args, characterName },
          world.scene,
          governor,
        );
      } catch (error: unknown) {
        threw++;
        check(false, `${def.name} threw: ${String(error)}`);
        continue;
      }
      check(
        !outcome.detail.includes(' failed: '),
        `${def.name} executor raised: ${outcome.detail}`,
      );

      for (const crawler of [world.human, world.cat]) {
        check(crawler.hp >= 1, `${def.name} left a crawler at ${crawler.hp} HP`);
        check(crawler.tempStatMods.length <= 1, `${def.name} stacked temporary stat changes`);
      }

      if (!outcome.ok) continue;
      succeeded++;

      if (def.name === 'apply_status' && isRecord(args) && DOT_STATUSES.has(String(args.status))) {
        const target = targetOf(world, args.target_player);
        const projected = target.hp - pendingStatusDamage(target.statusEffects, target.maxHp);
        check(
          projected >= Math.ceil(target.maxHp * LOW_HP_FRACTION),
          `apply_status ${String(args.status)} will carry a crawler under 25% HP`,
        );
      }

      if (def.characters !== undefined) {
        check(def.characters.includes(characterName), `${def.name} ran for ${characterName}`);
      }
      if (characterName === AI_CHARACTER_MORDECAI) {
        check(world.flags.safeRoom, `${def.name} ran for Mordecai outside a safe room`);
        check(
          !world.flags.combat && !pausedBefore,
          `${def.name} ran for Mordecai mid-fight or paused`,
        );
      }
      check(
        !pausedBefore || def.policy.severity === 'benign',
        `${def.name} (${def.policy.severity}) ran while paused`,
      );
      for (const flag of def.policy.forbidsContext ?? []) {
        const active =
          (flag === 'isPaused' && pausedBefore) ||
          (flag === 'inBossFight' && world.flags.boss) ||
          (flag === 'inSafeRoom' && world.flags.safeRoom) ||
          (flag === 'inCombat' && world.flags.combat);
        check(!active, `${def.name} ran while ${flag}`);
      }
      if (def.spawnsMobs === true) {
        check(!vulnerableBefore, `${def.name} spawned while a crawler was under 25% HP`);
        check(!hurtInFightBefore, `${def.name} spawned mid-fight on a crawler under 40% HP`);
        check(!pausedBefore && !world.flags.boss, `${def.name} spawned in a menu or boss fight`);
        const added = world.mobs.slice(mobsBefore);
        check(added.length > 0, `${def.name} reported success with nothing spawned`);
        for (const mob of added) {
          const nearest = Math.min(
            ...[world.human, world.cat].map((crawler) =>
              Math.hypot(mob.x - crawler.x, mob.y - crawler.y),
            ),
          );
          check(mob.mobLevel >= 1, `${def.name} spawned an unlevelled mob`);
          // Measured from the nearer crawler, who may stand a tile off the one targeted.
          const fairDistancePx = (MIN_SPAWN_DISTANCE_TILES - 1) * TILE_SIZE;
          check(
            nearest >= fairDistancePx,
            `${def.name} spawned a mob ${Math.round(nearest / TILE_SIZE)} tiles from a crawler`,
          );
        }
      }

      if (def.name === 'offer_challenge') {
        check(!vulnerableBefore, 'offer_challenge ran while a crawler was under 25% HP');
        check(!combatBefore, 'offer_challenge ran mid-fight');
        check(world.challenges.offer !== null, 'offer_challenge reported success with no offer up');
      }
      if (def.name === 'ask_player') {
        check(
          world.show.pendingQuestion !== null,
          'ask_player reported success with no question up',
        );
      }
      if (def.name === 'viewer_reaction') {
        check(
          world.favor.value >= FAVOR_MIN && world.favor.value <= FAVOR_MAX,
          `viewer_reaction left favour at ${world.favor.value}`,
        );
      }

      if (def.name === 'teleport_player') {
        for (const crawler of [world.human, world.cat]) {
          const nearestHostile = Math.min(
            Number.POSITIVE_INFINITY,
            ...world.mobs
              .filter((mob) => mob.isAlive && mob.isHostile)
              .map((mob) => Math.hypot(mob.x - crawler.x, mob.y - crawler.y)),
          );
          check(
            nearestHostile > TELEPORT_HOSTILE_CLEARANCE_TILES * TILE_SIZE,
            'teleport_player set a crawler down beside a hostile',
          );
          const tile = tileOf(crawler);
          check(
            !world.map.bossRooms.some(
              ({ bounds }) =>
                tile.x >= bounds.x &&
                tile.x < bounds.x + bounds.w &&
                tile.y >= bounds.y &&
                tile.y < bounds.y + bounds.h,
            ),
            'teleport_player set a crawler down in a boss room',
          );
        }
      }

      const last = lastSuccessAt.get(def.name);
      check(
        last === undefined || clockMs - last >= def.policy.cooldownMs,
        `${def.name} ran inside its cooldown`,
      );
      lastSuccessAt.set(def.name, clockMs);
      const count = (floorSuccesses.get(def.name) ?? 0) + 1;
      floorSuccesses.set(def.name, count);
      check(
        def.maxPerFloor === undefined || count <= def.maxPerFloor,
        `${def.name} ran ${count} times on one floor (cap ${def.maxPerFloor})`,
      );

      AI_BUDGET_POOLS.forEach((pool, index) => {
        const before = budgetBefore[index] ?? 0;
        const after = governor.remainingBudget(world.scene, pool);
        check(after >= 0, `${pool} allowance went negative`);
        spent.set(pool, (spent.get(pool) ?? 0) + (before - after));
      });

      for (let frame = 0; frame < FRAMES_PER_STEP; frame++) tickAIActions();
    }
    for (const pool of AI_BUDGET_POOLS) {
      const allowance = FLOOR_BUDGETS[pool];
      const cap = allowance.perFloor * (allowance.scalesWithDepth ? level1.floorNumber : 1);
      const used = spent.get(pool) ?? 0;
      check(used <= cap, `${def.name} spent ${used} of a ${cap} ${pool} allowance`);
    }
  }

  check(threw === 0, 'no fuzzed call threw out of executeAIAction');
  check(succeeded > 0, 'at least some fuzzed calls succeeded');
  check(
    AI_ACTIONS.every((def) => lastSuccessAt.has(def.name) || def.name === 'play_sound'),
    `every action except the audio-only one ran at least once (missing: ${AI_ACTIONS.filter(
      (def) => !lastSuccessAt.has(def.name),
    )
      .map((def) => def.name)
      .join(', ')})`,
  );

  aiActionTimers.flush();
  aiCameraSpotlight.clear();
  check(!world.musicClaims.has('ai_director'), 'every music sting released its claim');
  check(aiCameraSpotlight.focus() === null, 'the spotlight is clear after its effects end');
  console.log(`  ${succeeded} of ${AI_ACTIONS.length * FUZZ_CALLS_PER_ACTION} fuzzed calls ran`);
}
endSection();

section('the governor refuses what the fairness rules forbid');
{
  let clockMs = 0;
  const governor = new ActionGovernor(() => clockMs);
  const world = buildWorld();
  const spawn = {
    name: 'spawn_mob',
    params: { mob_type: 'rat' },
    characterName: AI_CHARACTER_SYSTEM,
  };
  const ratIsNative =
    level1.roomMobs.some((rule) => rule.type === 'rat') ||
    level1.hallwayMobs.some((rule) => rule.type === 'rat');

  world.human.hp = Math.max(1, Math.floor(world.human.maxHp * LOW_HP_FRACTION) - 1);
  check(
    !executeAIAction(spawn, world.scene, governor).ok,
    `no spawn while a crawler is under ${LOW_HP_PERCENT}% HP`,
  );
  world.human.hp = world.human.maxHp;

  world.flags.paused = true;
  check(!executeAIAction(spawn, world.scene, governor).ok, 'no spawn while a menu is open');
  world.flags.paused = false;

  world.flags.boss = true;
  check(!executeAIAction(spawn, world.scene, governor).ok, 'no spawn during a boss fight');
  world.flags.boss = false;

  if (ratIsNative) {
    const first = executeAIAction(spawn, world.scene, governor);
    check(first.ok, `a native spawn runs on a fair scene (${first.detail})`);
    check(
      !executeAIAction(spawn, world.scene, governor).ok,
      'a second spawn inside the cooldown is refused',
    );
  }
  clockMs += MAX_CLOCK_STEP_MS;

  const stat = {
    name: 'modify_stat',
    params: { stat: 'strength', delta: 2, reason: 'testing' },
    characterName: AI_CHARACTER_SYSTEM,
  };
  check(executeAIAction(stat, world.scene, governor).ok, 'a first stat change runs');
  clockMs += MAX_CLOCK_STEP_MS;
  check(!executeAIAction(stat, world.scene, governor).ok, 'a second stat change never stacks');

  const mordecaiGift = {
    name: 'give_item',
    params: { item_id: 'health_potion' },
    characterName: AI_CHARACTER_MORDECAI,
  };
  check(
    !executeAIAction(mordecaiGift, world.scene, governor).ok,
    'Mordecai does not act outside a safe room',
  );
  world.flags.safeRoom = true;
  check(
    executeAIAction(mordecaiGift, world.scene, governor).ok,
    'Mordecai gives a potion in a safe room',
  );
  check(
    !executeAIAction(
      { ...mordecaiGift, name: 'spawn_mob', params: { mob_type: 'rat' } },
      world.scene,
      governor,
    ).ok,
    'Mordecai may not spawn',
  );

  const setHp = { name: 'set_hp', params: { hp_percent: 1 }, characterName: AI_CHARACTER_SYSTEM };
  check(!executeAIAction(setHp, world.scene, governor).ok, 'set_hp refuses a lethal share');
  check(
    !executeAIAction(
      { name: 'no_such_action', params: {}, characterName: AI_CHARACTER_SYSTEM },
      world.scene,
      governor,
    ).ok,
    'an unknown action is refused',
  );
}
endSection();

section(
  'downed crawlers, lethal statuses, worn gear, hostile landings, fines and stored allowances',
);
{
  let clockMs = 0;
  const step = (): void => {
    clockMs += TIMER_CALL_SPACING_MS;
  };
  const world = buildWorld();
  const governor = new ActionGovernor(() => clockMs);
  const system = (name: string, params: Record<string, unknown>) =>
    executeAIAction({ name, params, characterName: AI_CHARACTER_SYSTEM }, world.scene, governor);
  const shield = (crawler: HumanPlayer | CatPlayer): number =>
    Math.ceil(crawler.maxHp * LOW_HP_FRACTION);

  world.cat.isKnockedOut = true;
  check(!system('spawn_mob', { mob_type: 'rat' }).ok, 'no spawn while a crawler is knocked out');
  check(
    !system('apply_status', { status: 'burn', target_player: 'Human' }).ok,
    'nothing harmful while a crawler is knocked out',
  );
  check(
    !system('teleport_player', { tile_x: 1, tile_y: 1 }).ok,
    'no teleport while a crawler is knocked out',
  );
  world.cat.isKnockedOut = false;
  world.cat.hp = 0;
  check(!system('spawn_mob', { mob_type: 'rat' }).ok, 'no spawn while a crawler is dead');
  world.cat.hp = world.cat.maxHp;

  // Poison's whole run against a crawler barely over the line: refused, since it would carry them under.
  world.human.statusEffects = [];
  world.human.hp = shield(world.human) + 1;
  check(
    !system('apply_status', { status: 'poison', target_player: 'Human' }).ok,
    'a damage-over-time status that would end under 25% HP is refused',
  );
  step();
  world.human.hp = world.human.maxHp;
  const burned = system('apply_status', { status: 'burn', target_player: 'Human' });
  check(burned.ok, `burn on a healthy crawler runs (${burned.detail})`);
  for (let frame = 0; frame < STATUS_RUN_FRAMES; frame++) world.human.tickTimers();
  check(
    world.human.hp >= shield(world.human),
    'a burn run to its end leaves the crawler over 25% HP',
  );
  step();

  world.human.tempStatMods.length = 0;
  world.human.syncHpToMaxHp();
  world.human.hp = shield(world.human) + 1;
  const hpBeforeCut = world.human.hp;
  system('modify_stat', {
    stat: 'constitution',
    delta: -STAT_CUT_POINTS,
    reason: 'testing',
    target_player: 'Human',
  });
  check(
    world.human.hp >= Math.min(hpBeforeCut, shield(world.human)),
    'a constitution cut never drops HP under the 25% line',
  );
  world.human.tempStatMods.length = 0;
  world.human.syncHpToMaxHp();
  world.human.hp = world.human.maxHp;
  step();

  for (const percent of [SET_HP_LOWEST_PERCENT, SET_HP_LOWEST_PERCENT + 1]) {
    world.human.statusEffects = [];
    world.human.hp = world.human.maxHp;
    system('set_hp', { hp_percent: percent, target_player: 'Human' });
    check(world.human.hp >= shield(world.human), `set_hp ${percent}% stays at or over the line`);
    step();
  }
  world.human.hp = world.human.maxHp;

  world.human.inventory.addItem('scrapmail_vest', 1);
  world.human.inventory.equipByItemId('scrapmail_vest');
  check(world.human.inventory.equipment.isEquipped('scrapmail_vest'), 'the test shirt is worn');
  check(
    !system('remove_item', { item_id: 'scrapmail_vest', target_player: 'Human' }).ok,
    'worn gear is never confiscated',
  );
  check(world.human.inventory.equipment.isEquipped('scrapmail_vest'), 'the shirt is still worn');
  step();

  const landing = tileOf(world.human);
  const guard = spawnMob(
    'rat',
    { x: landing.x + 2, y: landing.y },
    world.map,
    liveSpawnContext('dev:spawn'),
  );
  world.mobs.push(guard);
  check(
    !system('teleport_player', { tile_x: landing.x, tile_y: landing.y }).ok,
    'no teleport onto ground a hostile stands near',
  );
  world.mobs.length = 0;
  step();

  world.human.coins = FINE_TEST_PURSE;
  const fineBudgetBefore = governor.remainingBudget(world.scene, 'coinsFined');
  const fined = system('fine_coins', {
    amount: FINE_TEST_AMOUNT,
    reason: 'testing',
    target_player: 'Human',
  });
  const taken = FINE_TEST_PURSE - world.human.coins;
  const charged = fineBudgetBefore - governor.remainingBudget(world.scene, 'coinsFined');
  check(fined.ok && taken > 0, `a fine runs (${fined.detail})`);
  check(charged === taken, `a fine charges what it took (${charged} charged, ${taken} taken)`);

  const stored = new Map<string, FloorLedgerSnapshot>();
  const store: FloorLedgerStore = {
    load: (key) => stored.get(key) ?? null,
    save: (key, snapshot) => stored.set(key, snapshot),
  };
  const before = new ActionGovernor(() => clockMs, store);
  const spawned = executeAIAction(
    { name: 'give_coins', params: { amount: 50, reason: 'testing' }, characterName: 'System' },
    world.scene,
    before,
  );
  check(spawned.ok, `a gift runs (${spawned.detail})`);
  const reloaded = new ActionGovernor(() => clockMs, store);
  check(
    reloaded.remainingBudget(world.scene, 'coinsGiven') ===
      before.remainingBudget(world.scene, 'coinsGiven'),
    'a reloaded governor remembers what the floor already spent',
  );
}
endSection();

section('the show: achievements, questions, favour and every challenge template');
{
  let clockMs = 0;
  const step = (): void => {
    clockMs += TIMER_CALL_SPACING_MS;
  };
  const freshGovernor = (): ActionGovernor => new ActionGovernor(() => clockMs);
  let governor = freshGovernor();
  const world = buildWorld();
  const heard: Array<{ type: keyof GameEvents; data: unknown }> = [];
  const record =
    (type: keyof GameEvents) =>
    (data: unknown): void =>
      void heard.push({ type, data });
  world.bus.on('challengeAccepted', record('challengeAccepted'));
  world.bus.on('challengeDeclined', record('challengeDeclined'));
  world.bus.on('challengeCompleted', record('challengeCompleted'));
  world.bus.on('challengeFailed', record('challengeFailed'));
  world.bus.on('playerAnswered', record('playerAnswered'));
  world.bus.on('viewerFavorChanged', record('viewerFavorChanged'));
  world.bus.on('aiAchievementAwarded', record('aiAchievementAwarded'));
  world.bus.on('sponsorBreakEnded', record('sponsorBreakEnded'));
  const lastOf = <T>(items: readonly T[]): T | undefined =>
    items.length === 0 ? undefined : items[items.length - 1];
  let wins = 0;
  let losses = 0;
  /** One more challenge has been won than when last asked. */
  const wonAnother = (): boolean => heardOf('challengeCompleted').length === ++wins;
  const lostAnother = (): boolean => heardOf('challengeFailed').length === ++losses;
  const heardOf = (type: keyof GameEvents): unknown[] =>
    heard.filter((event) => event.type === type).map((event) => event.data);
  const system = (name: string, params: Record<string, unknown>): AIActionOutcome => {
    step();
    return executeAIAction(
      { name, params, characterName: AI_CHARACTER_SYSTEM },
      world.scene,
      governor,
    );
  };
  const healthy = (): void => {
    for (const crawler of [world.human, world.cat]) {
      crawler.statusEffects = [];
      crawler.isKnockedOut = false;
      crawler.hp = crawler.maxHp;
    }
  };
  healthy();

  // Achievements: written, filed once per title, saved and restored.
  const award = {
    title: 'Fled From A Rat',
    description: 'Ran from the weakest thing alive.',
    rarity: 'Uncommon',
  };
  const paidBefore = paidState(world.achievements.human, world.human);
  check(
    system('grant_achievement', { ...award, target_player: 'Human' }).ok,
    'an AI achievement is awarded',
  );
  check(
    world.achievements.human.hasAIAchievement(award.title),
    'it is filed under the AI category',
  );
  check(
    paidAtOnce(paidBefore, paidState(world.achievements.human, world.human)),
    'it pays its chest at once: coins land and one presentation is queued',
  );
  check(
    presentationAwardId(world.achievements.human.peekPresentation()) ===
      aiAchievementKey(award.title),
    'it waits for the reward screen like any other',
  );
  check(heardOf('aiAchievementAwarded').length === 1, 'the award is told to the bus');
  check(
    !system('grant_achievement', {
      ...award,
      title: '  fled from a   RAT ',
      target_player: 'Human',
    }).ok,
    'the same title, however it is spaced or cased, is never awarded twice',
  );
  const restored = AchievementManager.fromSerialized(
    JSON.parse(JSON.stringify(world.achievements.human.serialize())),
  );
  check(restored.hasAIAchievement(award.title), 'an AI achievement survives a save');
  check(
    presentationAwardId(restored.peekPresentation()) === aiAchievementKey(award.title),
    'and so does its unseen presentation',
  );

  const giftBefore = paidState(world.achievements.cat, world.cat);
  check(
    system('grant_reward_chest', { rarity: 'Common', reason: 'For style.', target_player: 'Cat' })
      .ok,
    'the audience can gift a reward chest',
  );
  check(
    paidAtOnce(giftBefore, paidState(world.achievements.cat, world.cat)),
    'a gifted chest pays at once: coins land and one presentation is queued',
  );
  check(
    AchievementManager.fromSerialized({
      aiAchievements: [{ name: 7 }, null, 'junk'],
    }).aiAchievements().length === 0,
    'a tampered AI achievement is dropped on load',
  );

  const messy = system('grant_achievement', {
    title: 'Stair\n\n\u200BMaster\u202E',
    description: 'Line one.\nLine two.\r\n\tLine three.',
    rarity: 'Common',
    target_player: 'Cat',
  });
  check(messy.ok, `a messy achievement is still awarded (${messy.detail})`);
  const filedNames = world.achievements.cat.aiAchievements().map((def) => def.name);
  const filedText = world.achievements.cat
    .aiAchievements()
    .map((def) => `${def.name}${def.description}`)
    .join('');
  check(
    filedNames.includes('Stair Master') && !/[\p{Cc}\p{Cf}]/u.test(filedText),
    `AI text is flattened to one plain line (${JSON.stringify(filedNames)})`,
  );
  check(
    !system('grant_achievement', { ...award, title: 'Stair\u200B Master', target_player: 'Cat' })
      .ok,
    'invisible characters do not get round the one-per-title rule',
  );
  const smuggledNames = AchievementManager.fromSerialized({
    aiAchievements: [
      {
        name: 'Saved\n\nTitle\u2066',
        description: 'From\u0000 a save',
        rarity: 'Common',
        awardedBy: 'System',
        awardedAt: 0,
      },
    ],
  })
    .aiAchievements()
    .map((def) => def.name);
  check(smuggledNames.includes('Saved Title'), 'a saved AI achievement is flattened on load');

  // Questions: the id comes back at once, the answer later as an event.
  const asked = system('ask_player', {
    question: 'Viewers want to know: save the cat or the loot?',
    choice_1: 'The cat',
    choice_2: 'The loot',
  });
  check(
    asked.ok && asked.detail.includes('question-'),
    `ask_player reports its question id (${asked.detail})`,
  );
  check(
    !system('ask_player', {
      question: 'A second question, so soon?',
      choice_1: 'Yes',
      choice_2: 'No',
    }).ok,
    'a second question waits for the first',
  );
  world.show.answer(1);
  const answered = heardOf('playerAnswered')[0];
  check(
    isRecord(answered) &&
      answered.answer === 'The loot' &&
      answered.askedBy === AI_CHARACTER_SYSTEM,
    'the answer is told to the bus with who asked',
  );
  governor = freshGovernor();
  system('ask_player', { question: 'Will you ever answer me?', choice_1: 'Yes', choice_2: 'No' });
  world.show.dismissQuestion();
  const ignored = heardOf('playerAnswered')[1];
  check(isRecord(ignored) && ignored.answer === null, 'waving a question away answers null');
  check(
    !system('ask_player', {
      question: 'Pick one of these two?',
      choice_1: 'Same',
      choice_2: 'same',
    }).ok,
    'two answers that say the same thing are refused',
  );

  // Favour: bounded, saved, and never a penalty.
  for (let swing = 0; swing < FAVOR_MAX; swing++) world.favor.adjust(FAVOR_SWING_MAX, 'cheer');
  check(world.favor.value === FAVOR_MAX, 'favour stops at its top');
  for (let swing = 0; swing < FAVOR_MAX; swing++) world.favor.adjust(-FAVOR_SWING_MAX, 'boo');
  check(world.favor.value === FAVOR_MIN, 'favour stops at its bottom');
  for (let value = FAVOR_MIN; value <= FAVOR_MAX; value++) {
    check(favorPerk(value).chestCoinMultiplier >= 1, `favour ${value} never cuts a chest's coins`);
  }
  check(favorPerk(FAVOR_MIN).chestCoinMultiplier === 1, 'the lowest favour costs nothing');
  check(parseViewerFavor('lots') === undefined, 'a junk saved favour is ignored');
  check(parseViewerFavor(FAVOR_MAX * 2) === FAVOR_MAX, 'a saved favour is clamped');
  const fresh = new ViewerFavor();
  check(fresh.serialize() === undefined && !fresh.engaged, 'an untouched run saves no favour');
  fresh.restore(undefined);
  check(fresh.value === FAVOR_START, 'a save without favour starts at the middle');
  world.favor.adjust(1, 'cheer');
  new AIShowStage({
    bus: world.bus,
    favor: world.favor,
    challenges: null,
    postToast: () => undefined,
  });
  check(world.favor.lastSwing === null, 'a new scene does not replay the last swing');
  governor = freshGovernor();
  const reacted = system('viewer_reaction', {
    reaction: 'cheer',
    delta: FAVOR_SWING_MAX,
    comment: `${crawlerName('cat').toUpperCase()}!`,
  });
  check(reacted.ok, `viewer_reaction runs (${reacted.detail})`);
  check(heardOf('viewerFavorChanged').length === 1, 'a reaction is told to the bus');
  check(
    executeAIAction(
      {
        name: 'viewer_reaction',
        params: { reaction: 'boo', delta: -1 },
        characterName: AI_CHARACTER_VIEWERS,
      },
      world.scene,
      freshGovernor(),
    ).ok,
    'the Viewers may react',
  );

  // Sponsor breaks: never mid-fight, one at a time, skippable.
  world.flags.combat = true;
  check(
    !system('sponsor_message', {
      sponsor: 'Borant Snacks',
      message: 'Pellets: now with fewer screams.',
    }).ok,
    'no sponsor break mid-fight',
  );
  world.flags.combat = false;
  check(
    system('sponsor_message', {
      sponsor: 'Borant Snacks',
      message: 'Pellets: now with fewer screams.',
    }).ok,
    'a sponsor break runs away from a fight',
  );
  world.show.endSponsorBreak(true);
  const skipped = heardOf('sponsorBreakEnded')[0];
  check(isRecord(skipped) && skipped.skipped === true, 'a skipped break is told to the bus');

  // Challenges: refusals first.
  const offer = (template: string, extra: Record<string, unknown> = {}): AIActionOutcome => {
    governor = freshGovernor();
    return system('offer_challenge', {
      template,
      title: `Test ${template}`,
      reward_rarity: 'Common',
      taunt: 'The viewers saw that.',
      ...extra,
    });
  };
  const spawnRats = (count: number): void => {
    const home = tileOf(world.human);
    for (let index = 0; index < count; index++) {
      world.mobs.push(
        spawnMob(
          'rat',
          { x: home.x + index + 1, y: home.y + 1 },
          world.map,
          liveSpawnContext('dev:spawn'),
        ),
      );
    }
  };
  const ctx = systemContextOf(world);
  const runFrames = (frames: number): void => {
    for (let frame = 0; frame < frames; frame++) world.challenges.update(ctx);
  };
  const killRat = (killer: HumanPlayer | CatPlayer): void => {
    const rat = world.mobs.find((mob) => mob.isAlive && mob.spawnTypeKey === 'rat');
    if (rat === undefined) return;
    rat.hp = 0;
    world.bus.emit('mobKilled', { mob: rat, killer, killType: null, topDamageDealer: killer });
  };
  world.mobs.length = 0;
  check(
    !offer('slay', { count: CHALLENGE_KILLS, mob_type: 'rat' }).ok,
    'no kill challenge for creatures the floor does not have',
  );
  spawnRats(CHALLENGE_RATS);
  check(
    !offer('slay', { count: CHALLENGE_RATS, mob_type: 'rat', seconds: CHALLENGE_SHORT_SECONDS }).ok,
    'a kill challenge without time for the kills is refused',
  );
  world.human.hp = HURT_HP;
  check(!offer('untouched').ok, 'no challenge while a crawler is under 25% HP');
  healthy();
  world.flags.combat = true;
  check(!offer('untouched').ok, 'no challenge offered mid-fight');
  world.flags.combat = false;
  check(!offer('no_potion_until_boss').ok, 'no potion fast on a floor without a living boss');
  const stairs = world.map.stairwellTiles;
  const here = tileOf(world.human);
  const nearestStairs = Math.min(
    ...stairs.map((tile) => Math.hypot(tile.x - here.x, tile.y - here.y)),
  );
  if (stairs.length > 0 && minStairwellDashSeconds(nearestStairs) > CHALLENGE_SHORT_SECONDS) {
    check(
      !offer('stairwell_dash', { seconds: CHALLENGE_SHORT_SECONDS }).ok,
      'a stairwell dash too short for the walk is refused',
    );
  }

  // slay: offered, refused while busy, accepted, won.
  const slay = offer('slay', {
    count: CHALLENGE_KILLS,
    mob_type: 'rat',
    seconds: CHALLENGE_SECONDS,
  });
  check(slay.ok, `a winnable slay challenge is offered (${slay.detail})`);
  check(!offer('untouched').ok, 'one challenge at a time');
  world.show.acceptChallenge();
  check(heardOf('challengeAccepted').length === 1, 'accepting is told to the bus');
  const paidBeforeWin = paidState(world.achievements.human, world.human);
  for (let kill = 0; kill < CHALLENGE_KILLS; kill++) killRat(world.human);
  check(wonAnother(), 'winning is told to the bus');
  check(
    paidAtOnce(paidBeforeWin, paidState(world.achievements.human, world.human)),
    'winning pays a chest at once to the crawler being driven',
  );
  check(
    world.challenges.current === null && !world.challenges.busy,
    'a won challenge clears the stage',
  );

  // Declined.
  check(
    offer('untouched', { seconds: CHALLENGE_SHORT_SECONDS }).ok,
    'an untouched challenge is offered',
  );
  world.show.declineChallenge();
  check(heardOf('challengeDeclined').length === 1, 'declining is told to the bus');

  // untouched: won by lasting the clock, lost to a scratch.
  offer('untouched', { seconds: CHALLENGE_SHORT_SECONDS });
  world.show.acceptChallenge();
  runFrames(CHALLENGE_SHORT_SECONDS * UPDATE_FRAMES_PER_SECOND);
  check(wonAnother(), 'lasting the clock wins an untouched challenge');
  offer('untouched', { seconds: CHALLENGE_SHORT_SECONDS });
  world.show.acceptChallenge();
  runFrames(1);
  world.human.hp -= 1;
  runFrames(1);
  check(lostAnother(), 'a scratch fails an untouched challenge');
  const scratched = lastOf(heardOf('challengeFailed'));
  check(
    isRecord(scratched) && scratched.taunt === 'The viewers saw that.',
    'a scratch fails it, with the taunt told to the bus',
  );
  check(
    world.toasts.some((toast) => toast.includes('The viewers saw that.')),
    'the taunt is shown',
  );
  healthy();

  // slay: lost to the clock.
  offer('slay', { count: CHALLENGE_KILLS, mob_type: 'rat', seconds: CHALLENGE_SECONDS });
  world.show.acceptChallenge();
  runFrames(CHALLENGE_SECONDS * UPDATE_FRAMES_PER_SECOND);
  check(lostAnother(), 'running out of time fails a kill challenge');

  // belle_finishes: the human stealing the kill fails it.
  spawnRats(CHALLENGE_RATS);
  offer('belle_finishes', { count: 1, mob_type: 'rat', seconds: CHALLENGE_SECONDS });
  world.show.acceptChallenge();
  killRat(world.human);
  check(lostAnother(), 'a kill by the human fails a cat-finishes challenge');
  offer('belle_finishes', { count: 1, mob_type: 'rat', seconds: CHALLENGE_SECONDS });
  world.show.acceptChallenge();
  killRat(world.cat);
  check(wonAnother(), 'the cat’s kill wins it');

  // slay_untouched: won clean.
  offer('slay_untouched', { count: 1, mob_type: 'rat', seconds: CHALLENGE_SECONDS });
  world.show.acceptChallenge();
  runFrames(1);
  killRat(world.human);
  check(wonAnother(), 'a clean kill wins an untouched slay');

  // no_potion_until_boss: needs a boss, lost to a potion, won by the kill.
  const boss = spawnMob(
    'rat',
    { x: tileOf(world.human).x + 2, y: tileOf(world.human).y },
    world.map,
    liveSpawnContext('dev:spawn'),
  );
  boss.isBoss = true;
  world.mobs.push(boss);
  check(offer('no_potion_until_boss').ok, 'a potion fast is offered with a living boss');
  world.show.acceptChallenge();
  world.bus.emit('healingPotionUsed', { player: 'Human', hpRestored: 1 });
  check(lostAnother(), 'a potion fails the fast');
  offer('no_potion_until_boss');
  world.show.acceptChallenge();
  world.bus.emit('bossDefeated', { bossType: 'rat', mob: boss });
  check(wonAnother(), 'the boss falling wins the fast');

  // stairwell_dash: won on reaching the stairs.
  const firstStair = stairs.length > 0 ? stairs[0] : undefined;
  check(firstStair !== undefined, 'the test floor has a stairwell');
  if (firstStair !== undefined) {
    check(
      offer('stairwell_dash', { seconds: CHALLENGE_MAX_SECONDS }).ok ||
        minStairwellDashSeconds(nearestStairs) > CHALLENGE_MAX_SECONDS,
      'a stairwell dash with time for the walk is offered',
    );
    if (world.challenges.offer !== null) {
      world.show.acceptChallenge();
      world.human.x = firstStair.x * TILE_SIZE;
      world.human.y = firstStair.y * TILE_SIZE;
      runFrames(1);
      check(wonAnother(), 'reaching the stairwell wins the dash');
    }
  }

  // belle_finishes: a kill no crawler made neither counts nor fails it.
  spawnRats(CHALLENGE_RATS);
  offer('belle_finishes', { count: 1, mob_type: 'rat', seconds: CHALLENGE_SECONDS });
  world.show.acceptChallenge();
  const strayRat = world.mobs.find((mob) => mob.isAlive && mob.spawnTypeKey === 'rat');
  if (strayRat !== undefined) {
    strayRat.hp = 0;
    world.bus.emit('mobKilled', {
      mob: strayRat,
      killer: null,
      killType: null,
      topDamageDealer: null,
    });
  }
  check(
    world.challenges.current !== null,
    'a companion’s kill leaves a cat-finishes challenge running',
  );

  // Death ends a running challenge, and so does a checkpoint rewind.
  world.bus.emit('playerDied', { fallen: world.human, cause: 'audit' });
  check(lostAnother(), 'dying fails a running challenge');
  const died = lastOf(heardOf('challengeFailed'));
  check(isRecord(died) && died.reason === 'died', 'the failure says the party died');
  offer('untouched', { seconds: CHALLENGE_SHORT_SECONDS });
  world.show.acceptChallenge();
  world.challenges.endQuietly('the run rewound to a checkpoint');
  check(lostAnother(), 'a checkpoint rewind ends a running challenge');
  const rewound = lastOf(heardOf('challengeFailed'));
  check(isRecord(rewound) && rewound.taunt === '', 'a rewind ends it untaunted');
  check(!world.challenges.busy, 'and leaves the stage free');

  // A challenge left open when the floor goes is failed quietly.
  offer('untouched', { seconds: CHALLENGE_SHORT_SECONDS });
  world.show.acceptChallenge();
  world.challenges.dispose();
  check(lostAnother(), 'leaving the floor ends a running challenge');
  const leftBehind = lastOf(heardOf('challengeFailed'));
  check(
    isRecord(leftBehind) && leftBehind.taunt === '',
    'leaving the floor ends a challenge untaunted',
  );

  check(
    CHALLENGE_TEMPLATE_IDS.every((id) =>
      heard.some((event) => isRecord(event.data) && event.data.template === id),
    ),
    `every challenge template ran its course here (missing: ${CHALLENGE_TEMPLATE_IDS.filter((id) => !heard.some((event) => isRecord(event.data) && event.data.template === id)).join(', ')})`,
  );
}
endSection();

section('a hurt party is not piled on mid-fight');
{
  let clockMs = 0;
  const world = buildWorld();
  const governor = new ActionGovernor(() => clockMs);
  const call = (name: string, params: Record<string, unknown>) => {
    clockMs += TIMER_CALL_SPACING_MS;
    return executeAIAction(
      { name, params, characterName: AI_CHARACTER_SYSTEM },
      world.scene,
      governor,
    );
  };
  const hurtHp = Math.floor(world.human.maxHp * HURT_TEST_FRACTION);
  world.human.hp = Math.max(Math.ceil(world.human.maxHp * LOW_HP_FRACTION) + 1, hurtHp);
  check(
    world.human.hp / world.human.maxHp < HURT_IN_COMBAT_FRACTION &&
      world.human.hp / world.human.maxHp >= LOW_HP_FRACTION,
    'the test crawler sits between the two shields',
  );
  world.flags.combat = true;
  check(!call('spawn_mob', { mob_type: 'rat' }).ok, 'no spawn mid-fight on a hurt crawler');
  check(
    !call('spawn_elite', { mob_type: 'rat', name: 'Gary' }).ok,
    'no elite mid-fight on a hurt crawler',
  );
  check(
    !call('apply_status', { status: 'drunk', target_player: 'Cat' }).ok,
    'nothing harmful mid-fight while a crawler is hurt',
  );
  check(
    call('apply_status', { status: 'speed_fizz', target_player: 'Human' }).ok,
    'help still lands mid-fight',
  );
  world.flags.combat = false;
  const calm = call('spawn_mob', { mob_type: 'rat' });
  check(calm.ok, `out of a fight the wider shield lifts (${calm.detail})`);
  world.human.hp = world.human.maxHp;
  world.flags.combat = true;
  const healthy = call('spawn_elite', { mob_type: 'rat', name: 'Gary' });
  check(healthy.ok, `a healthy party mid-fight can still be challenged (${healthy.detail})`);

  for (const tool of generateAIToolDefinitions()) {
    const def = AI_ACTIONS.find((candidate) => candidate.name === tool.name);
    if (def === undefined) continue;
    const governed =
      def.spawnsMobs === true || def.policy.severity === 'harmful' || def.isHarmful !== undefined;
    if (governed) {
      check(
        tool.description.includes(`${Math.round(HURT_IN_COMBAT_FRACTION * PERCENT_SCALE)}%`),
        `${tool.name} tells the model about the mid-fight shield`,
      );
    }
  }
}
endSection();

section('floor keys, status damage forecasts and indoor spawns');
{
  const outdoors = buildWorld();
  const indoors = buildWorld();
  const outdoorKey = aiFloorKey(level1.id, outdoors.map.worldSeed);
  const interiorScene: AISceneContext = {
    ...indoors.scene,
    isIndoors: () => true,
    getFloorKey: () => outdoorKey,
  };
  const governor = new ActionGovernor(() => 0);
  const gift = executeAIAction(
    { name: 'give_coins', params: { amount: 40, reason: 'testing' }, characterName: 'System' },
    outdoors.scene,
    governor,
  );
  check(gift.ok, `an outdoor gift runs (${gift.detail})`);
  check(
    governor.remainingBudget(interiorScene, 'coinsGiven') ===
      governor.remainingBudget(outdoors.scene, 'coinsGiven'),
    "an interior draws on its floor's allowance, not a fresh one",
  );
  check(
    outdoors.map.worldSeed !== indoors.map.worldSeed,
    'the two test maps were seeded apart, so the shared key is what joined them',
  );
  check(
    !executeAIAction(
      { name: 'spawn_mob', params: { mob_type: 'rat' }, characterName: 'System' },
      interiorScene,
      governor,
    ).ok,
    'no spawn indoors',
  );

  const shape: { make: () => StatusEffect; interval: number }[] = [
    { make: () => makeBurn(), interval: BURN_FORECAST_INTERVAL },
    { make: () => makePoison(), interval: POISON_FORECAST_INTERVAL },
  ];
  for (const { make, interval } of shape) {
    const effect = make();
    for (let remaining = effect.totalTicks; remaining >= 0; remaining--) {
      const probe = { ...effect, ticksRemaining: remaining };
      let bites = 0;
      // The status clock: a bite on every frame whose elapsed count is a positive
      // multiple of the interval, through the frame the effect runs out on.
      for (let left = remaining; left >= 0; left--) {
        const elapsed = probe.totalTicks - left;
        if (elapsed > 0 && elapsed % interval === 0) bites++;
      }
      const forecast = pendingStatusDamage([probe], FORECAST_MAX_HP);
      if (forecast !== bites) {
        check(
          false,
          `${effect.type} with ${remaining} frames left forecasts ${forecast}, bites ${bites}`,
        );
        break;
      }
    }
    check(true, `${effect.type} forecasts match its clock`);
  }
  const vomit = pendingStatusDamage([makeBloodVomit()], FORECAST_MAX_HP);
  check(
    vomit >= Math.round(FORECAST_MAX_HP * BLOOD_VOMIT_MAX_HP_SHARE),
    `blood vomiting is forecast (${vomit} of ${FORECAST_MAX_HP} max HP)`,
  );
  const human = outdoors.human;
  human.statusEffects = [makeBloodVomit()];
  human.hp = human.maxHp;
  check(
    !executeAIAction(
      {
        name: 'apply_status',
        params: { status: 'burn', target_player: 'Human' },
        characterName: 'System',
      },
      outdoors.scene,
      new ActionGovernor(() => 0),
    ).ok,
    'no damage-over-time status on top of blood vomiting that will carry them under 25% HP',
  );
}
endSection();

section('a sale never pays: not at the same counter, not at another shop, not after it ends');
{
  const shops = Object.keys(SHOPS).filter(isShopId);
  /** The most `shop` would pay for one `item` over a range of its own stock levels, glutted to bare. */
  function bestResale(shop: (typeof shops)[number], item: ItemId): number {
    let best = sellPrice(shop, item, createShopStock());
    const draining = createShopStock();
    for (let unit = 0; unit < RESALE_DRAIN_UNITS; unit++) {
      if (!buyFromShop(draining, shop, item)) break;
      best = Math.max(best, sellPrice(shop, item, draining));
    }
    return best;
  }
  const items = new Set<ItemId>();
  for (const shop of shops) for (const line of SHOPS[shop].catalog) items.add(line.item);
  const resaleCeiling = new Map<ItemId, number>();
  for (const item of items) {
    resaleCeiling.set(item, Math.max(...shops.map((shop) => bestResale(shop, item))));
  }

  for (const multiplier of [PRICE_ADJUSTMENT_MIN_MULTIPLIER, SALE_MULTIPLIER_MID]) {
    setPriceAdjustment({ label: 'test', multiplier }, MAX_CLOCK_STEP_MS);
    for (const shop of shops) {
      for (const line of SHOPS[shop].catalog) {
        const paid = buyPrice(shop, line.item, createShopStock());
        const regular = (() => {
          clearPriceAdjustment();
          const price = buyPrice(shop, line.item, createShopStock());
          setPriceAdjustment({ label: 'test', multiplier }, MAX_CLOCK_STEP_MS);
          return price;
        })();
        const ceiling = resaleCeiling.get(line.item) ?? 0;
        check(
          paid >= ceiling,
          `${shop}/${line.item} on sale x${multiplier} costs ${paid}, but a shop pays up to ${ceiling}`,
        );
        check(paid <= regular, `${shop}/${line.item} on sale costs more than without it`);
      }
    }
  }
  clearPriceAdjustment();

  setPriceAdjustment(
    { label: 'test', multiplier: PRICE_ADJUSTMENT_MAX_MULTIPLIER },
    MAX_CLOCK_STEP_MS,
  );
  for (const shop of shops) {
    for (const line of SHOPS[shop].catalog) {
      const stock = createShopStock();
      const paid = buyPrice(shop, line.item, stock);
      if (!buyFromShop(stock, shop, line.item)) continue;
      const refund = sellPrice(shop, line.item, stock);
      check(
        refund <= paid,
        `${shop}/${line.item} under a surge: bought ${paid}, sold back ${refund}`,
      );
    }
  }
  clearPriceAdjustment();
}
endSection();

section('the collapse timer: cuts stop at the floor, top-ups move by their delta');
{
  let clockMs = 0;
  const governor = new ActionGovernor(() => clockMs);
  const world = buildWorld();
  const adjust = (deltaSeconds: number): AIActionOutcome => {
    clockMs += TIMER_CALL_SPACING_MS;
    return executeAIAction(
      {
        name: 'adjust_level_timer',
        params: { delta_seconds: deltaSeconds },
        characterName: AI_CHARACTER_SYSTEM,
      },
      world.scene,
      governor,
    );
  };

  const lowStart = secondsToFrames(TIMER_LOW_START_SECONDS);
  world.timerFrames = lowStart;
  const topUp = adjust(TIMER_TOP_UP_SECONDS);
  check(
    topUp.ok && world.timerFrames === lowStart + secondsToFrames(TIMER_TOP_UP_SECONDS),
    `a top-up on a clock under ${TIMER_FLOOR_SECONDS}s adds only its delta (now ${world.timerFrames} frames)`,
  );
  check(
    !adjust(-TIMER_TOP_UP_SECONDS).ok,
    `no cut on a clock already under ${TIMER_FLOOR_SECONDS}s`,
  );

  const justAboveFloor = secondsToFrames(TIMER_FLOOR_SECONDS + TIMER_TOP_UP_SECONDS);
  world.timerFrames = justAboveFloor;
  check(
    !adjust(-TIMER_DELTA_LIMIT_SECONDS).ok && world.timerFrames === justAboveFloor,
    `a cut that would cross ${TIMER_FLOOR_SECONDS}s is refused and leaves the clock alone`,
  );

  const nearFull = COLLAPSE_LIMIT_FRAMES - secondsToFrames(TIMER_NEAR_FULL_GAP_SECONDS);
  world.timerFrames = nearFull;
  const capped = adjust(TIMER_TOP_UP_SECONDS);
  check(
    capped.ok && world.timerFrames === COLLAPSE_LIMIT_FRAMES,
    'a top-up never carries the clock past its limit',
  );
}
endSection();

section('dispatcher and wire shapes');
{
  const v2 = parseServerAction(
    { actionId: 'a1', characterName: 'Mordecai', type: 'announce', params: { text: 'hi' } },
    AI_CHARACTER_SYSTEM,
  );
  check(
    v2?.actionId === 'a1' &&
      v2.request.characterName === 'Mordecai' &&
      v2.request.name === 'announce',
    'a protocol 2 action parses with its id and character',
  );
  const v1 = parseServerAction({ type: 'announce', text: 'hi' }, AI_CHARACTER_SYSTEM);
  check(
    v1?.actionId === null && validateParams(AI_ACTIONS[0]?.params ?? [], v1.request.params).ok,
    'a protocol 1 action parses its flat arguments',
  );
  check(parseServerAction('nope', AI_CHARACTER_SYSTEM) === null, 'a non-object action is ignored');

  let clockMs = 0;
  const world = buildWorld();
  const outcomes: AIActionOutcome[] = [];
  const dispatcher = new AIActionDispatcher(
    (_parsed, outcome) => outcomes.push(outcome),
    () => clockMs,
  );
  const announce = parseServerAction(
    { type: 'announce', params: { text: 'held' } },
    AI_CHARACTER_SYSTEM,
  );
  if (announce !== null) {
    world.flags.paused = true;
    dispatcher.submit(announce, world.scene);
    check(outcomes.length === 0, 'a call is held while the game is paused');
    dispatcher.drain(world.scene);
    check(outcomes.length === 0, 'a held call waits out the pause');
    world.flags.paused = false;
    dispatcher.drain(world.scene);
    check(outcomes.length === 1 && outcomes[0]?.ok, 'a held call runs once play resumes');

    world.flags.paused = true;
    dispatcher.submit(announce, world.scene);
    clockMs += MAX_CLOCK_STEP_MS;
    world.flags.paused = false;
    dispatcher.drain(world.scene);
    check(outcomes.length === 2 && !(outcomes[1]?.ok ?? true), 'a call held too long expires');
  }
}
endSection();

if (checksFailed > 0) {
  console.log(`\nFAIL ${checksFailed} of ${checksRun} checks`);
  process.exitCode = 1;
} else {
  console.log(`\n${checksRun} checks passed`);
}
