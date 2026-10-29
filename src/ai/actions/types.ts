import type { LevelId } from '../../levels/levelIds';
import type { AchievementAwards } from '../../systems/AchievementAwards';
import type { AudioManager } from '../../audio/AudioManager';
import type { MusicClaims } from '../../audio/AudioScope';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { ItemId } from '../../core/items/defs/ItemDefs';
import type { Mob } from '../../creatures/Mob';
import type { GameMap } from '../../map/GameMap';
import type { ToastOptions } from '../../ui/hud/toasts';
import type { AIInteractionHost } from '../interactions/types';
import type { ActionParams, JsonObjectSchema, ParamField } from './schema';
import type { SessionFlagName } from '../context/sessionContext';

/**
 * Nightmare's time limit on the floor as an action may read and move it.
 * Moving the time left shifts the floor's elapsed clock, so the limit itself
 * never changes.
 */
export interface AILevelTimer {
  readonly remainingFrames: number;
  readonly limitFrames: number;
  setRemainingFrames(frames: number): void;
}

/**
 * What a scene hands the AI so actions can touch the world. The first block is
 * required of every scene; the optional block is the richer reach a scene may
 * offer, and an action needing a capability a scene left out reports itself
 * unavailable there rather than failing.
 */
export interface AISceneContext {
  getHuman(): HumanPlayer;
  getCat(): CatPlayer;
  getMobs(): Mob[];
  getGameMap(): GameMap;
  getLevelId(): LevelId;
  spawnMob(mob: Mob): void;
  isBossFightActive(): boolean;
  isPaused(): boolean;

  isInSafeRoom?(): boolean;
  isInCombat?(): boolean;
  isIndoors?(): boolean;
  postToast?(text: string, opts?: ToastOptions): void;
  /** The scene's award payer: every chest and achievement the AI grants is paid through it. */
  getAwards?(): AchievementAwards;
  getAudio?(): AudioManager | null;
  getAudioScope?(): MusicClaims | null;
  getLevelTimer?(): AILevelTimer | null;
  /**
   * Which floor of which run the AI's per-floor allowances are charged to.
   * Defaults to {@link aiFloorKey} of the level id and the map's world seed;
   * a scene whose map is not the floor's own (an interior) reports the
   * floor's key instead.
   */
  getFloorKey?(): string;
  /** Pans the camera to a world point (pixels) for `frames` frames. */
  spotlight?(point: { readonly x: number; readonly y: number }, frames: number): void;
  /** The stage the AI puts questions and challenge offers on. */
  getInteractions?(): AIInteractionHost | null;
}

export type AITargetCrawler = 'human' | 'cat';

/** One floor of one run: its level id and the world seed the run rolled. */
export function aiFloorKey(levelId: LevelId, worldSeed: number): string {
  return `${levelId}#${worldSeed}`;
}

/**
 * Flags the server's tool policy and the game's governor both read. Each is
 * also a `context_set` session flag of the same name, so the server judges a
 * policy against what the game reports.
 */
export const AI_CONTEXT_FLAGS = [
  'isPaused',
  'inCombat',
  'inSafeRoom',
  'inBossFight',
  'indoors',
] as const;
export type AIContextFlag = (typeof AI_CONTEXT_FLAGS)[number];
export type AIContextFlags = Readonly<Record<AIContextFlag, boolean>>;

export type ActionSeverity = 'benign' | 'disruptive' | 'harmful';

/** The policy block every tool definition carries to the server. */
export interface AIActionPolicy {
  readonly cost: number;
  readonly cooldownMs: number;
  readonly maxPerSession?: number;
  readonly severity: ActionSeverity;
  readonly requiresContext?: readonly AIContextFlag[];
  readonly forbidsContext?: readonly AIContextFlag[];
}

/**
 * The policy as the server receives it. Its context flags may also name
 * session flags the governor has no use for, such as `commentaryOnly`, which
 * the game enforces through the AI Intensity setting instead.
 */
export interface AIToolPolicy extends Omit<AIActionPolicy, 'requiresContext' | 'forbidsContext'> {
  readonly requiresContext?: readonly SessionFlagName[];
  readonly forbidsContext?: readonly SessionFlagName[];
}

/** The tool definition shape the server accepts for one action. */
export interface AIToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonObjectSchema;
  readonly policy: AIToolPolicy;
  readonly characters?: readonly string[];
}

/** Per-floor pools the governor meters, each capped by floor depth. */
export const AI_BUDGET_POOLS = [
  'mobsSpawned',
  'itemValue',
  'coinsGiven',
  'coinsFined',
  'rewardChestPoints',
  'timerSeconds',
] as const;
export type AIBudgetPool = (typeof AI_BUDGET_POOLS)[number];

export interface AIBudgetDraw {
  readonly pool: AIBudgetPool;
  readonly amount: number;
}

/**
 * How one audience names the crawlers and items a result line mentions: the
 * AI is told `crawlerAIName` names, the screen shows the typed,
 * bidi-isolated ones. Neither audience may ever see the other's.
 */
export interface ResultNamer {
  crawler(crawler: HumanPlayer | CatPlayer): string;
  item(id: ItemId): string;
}

/** A success line, built once per audience so each names things its own way. */
export type ResultLine = (names: ResultNamer) => string;

/** What an executed (or refused) action reports back. A refusal goes only to the AI. */
export type AIActionResult =
  | { readonly ok: true; readonly line: ResultLine }
  | { readonly ok: false; readonly detail: string };

/** Everything an executor and an action's own fairness check can read. */
export interface AIActionCall {
  readonly params: ActionParams;
  readonly scene: AISceneContext;
  readonly characterName: string;
}

/**
 * One action the AI may take. Its fields, policy and executor live together
 * so a tool definition, its validation and what it does cannot disagree.
 */
export interface AIActionDef {
  readonly name: string;
  readonly description: string;
  readonly params: readonly ParamField<unknown>[];
  readonly policy: AIActionPolicy;
  /** Characters allowed to use it; omitted means every character. */
  readonly characters?: readonly string[];
  /** Game-side cap per floor, on top of the server's per-session cap. */
  readonly maxPerFloor?: number;
  /** Puts new hostiles into the world, which the spawn fairness rules govern. */
  readonly spawnsMobs?: boolean;
  /** Whether a call hurts the crawlers; defaults to `severity === 'harmful'`. */
  isHarmful?(call: AIActionCall): boolean;
  /** The per-floor pool a call draws on, checked before and charged after it runs. */
  budget?(call: AIActionCall): AIBudgetDraw | null;
  /** Action-specific refusal (no stacking, nothing to remove…); null to allow. */
  refusal?(call: AIActionCall): string | null;
  /** Whether a successful call shows the "Caroline intervened" indicator. Defaults to true. */
  readonly showsIndicator?: boolean;
  execute(call: AIActionCall): AIActionResult;
}

export function ok(line: ResultLine): AIActionResult {
  return { ok: true, line };
}

export function refused(detail: string): AIActionResult {
  return { ok: false, detail };
}
