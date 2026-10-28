/**
 * The game's one connection to the AI server, through the SDK's
 * `GameAiClient`. It streams what the context builder produces, answers every
 * `ai_action` with an `action_result`, carries player chat over the socket
 * and feeds the AI panel. With the server unreachable, or no one signed in,
 * the game plays on and Caroline falls back to scripted lines.
 */
import {
  GameAiClient,
  type ActionPayload,
  type ChatStreamUpdate,
  type GameAiClientOptions,
} from '@rscarbel/game-server-llm-sdk';
import type { EventBus } from '../core/EventBus';
import { settings } from '../core/input/Settings';
import type { Surface } from '../ui/core/UiRoot';
import { aiPanelSurface } from '../ui/hud/aiPanel';
import { AIChatFeed } from './AIChatFeed';
import { intensityPolicy, intensityRefusal, type AIIntensity } from './aiIntensity';
import { AIActionDispatcher, parseServerAction, type ParsedServerAction } from './actions/dispatch';
import type { ActionGovernor } from './actions/governor';
import {
  endAIActionEffects,
  findAIAction,
  tickAIActions,
  type AIActionOutcome,
} from './actions/registry';
import type { AISceneContext } from './actions/types';
import {
  enabledCharacters,
  DAVE_CHARACTER_NAME,
  renderCharacterPrompt,
  CAROLINE_CHARACTER_NAME,
} from './characters';
import { LineRotation, CAROLINE_FALLBACK_LINES } from './characters/fallbackLines';
import { AIContextBuilder } from './context/AIContextBuilder';
import { rememberForgottenPlayer, takeForgottenPlayerNotice } from './context/forgottenNotice';
import { textForTheServer } from './context/forTheServer';
import { SdkContextTransport } from './context/transport';
import type { AIContextSource } from './context/types';
import type { AIOutboundMessage, AnsweredAction } from './replay/aiReplayFormat';

// Injected at build time from .env via scripts/build.js
declare const __AI_SERVER_URL__: string | undefined;

/** Where the AI server is when nothing was injected: headless harnesses import this module unbundled. */
const FALLBACK_AI_SERVER_URL = 'http://localhost:3001';
const DEFAULT_SERVER_URL =
  typeof __AI_SERVER_URL__ === 'string' ? __AI_SERVER_URL__ : FALLBACK_AI_SERVER_URL;
/**
 * The game server's own endpoint that signs a short-lived player token for
 * the AI server. Same origin, so the session cookie rides along and no AI
 * credential is ever in the bundle.
 */
const PLAYER_TOKEN_PATH = '/api/ai-token';
/** Announced to the server in `hello`, for its session list and logs. */
export const AI_SDK_NAME = 'kitten-crawler';
/**
 * How often the context builder is polled. It rate-limits snapshots itself;
 * this only bounds how stale a flag change (a menu opening) can get.
 */
const DEFAULT_CONTEXT_TICK_MS = 250;
/** Said once after a wipe, on the next page load, in Caroline's voice. */
const FORGOTTEN_PLAYER_LINE = 'Your record is cleared. Observation resumes from zero.';
/** A degraded notice with no `retryAfterMs` keeps the status amber this long. */
const DEFAULT_DEGRADED_MS = 60_000;
/** What the player says on walking up to Dave; the server briefs him from what he witnessed. */
const DAVE_GREETING = 'Hey.';
/** Dave's dialog box waits this long for his reply before he falls back on his usual advice. */
const DAVE_REPLY_TIMEOUT_MS = 30_000;
const DAVE_FALLBACK_LINE =
  'Drink the potion before you need it, not after. Red ground means move. ' +
  "And find the stairs. That's most of it, really.";
const NO_SCENE_DETAIL = 'no gameplay scene is running';

/** The part of the SDK client the adapter uses, so the gates can hand it a fake. */
export type AIClient = Pick<
  GameAiClient,
  | 'on'
  | 'connect'
  | 'close'
  | 'setContext'
  | 'updateState'
  | 'sendEvents'
  | 'sendPlayerMessage'
  | 'sendActionResult'
  | 'limits'
>;

export type AIClientFactory = (options: GameAiClientOptions) => AIClient;

/** Sees every message the adapter sends the AI server, in send order. */
export type AIOutboundListener = (message: AIOutboundMessage) => void;

export interface AIAdapterDeps {
  readonly createClient?: AIClientFactory;
  /** A fresh player token for the signed-in account, or null when there is none. */
  readonly fetchToken?: () => Promise<string | null>;
  readonly serverUrl?: string;
  readonly intensity?: () => AIIntensity;
  readonly showInterventions?: () => boolean;
  readonly now?: () => number;
  /** The fairness rules actions are judged by; the session's shared governor by default. */
  readonly governor?: ActionGovernor;
  /** How often the context builder is polled while connected. */
  readonly contextTickMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function fetchPlayerToken(): Promise<string | null> {
  try {
    const response = await fetch(PLAYER_TOKEN_PATH, { credentials: 'include' });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (!isRecord(body)) return null;
    return typeof body.token === 'string' ? body.token : null;
  } catch {
    return null;
  }
}

export class AIAdapter {
  /** What the AI panel shows. */
  readonly feed = new AIChatFeed();

  private readonly createClient: AIClientFactory;
  private readonly fetchToken: () => Promise<string | null>;
  private readonly serverUrl: string;
  private readonly intensity: () => AIIntensity;
  private readonly showInterventions: () => boolean;
  private readonly now: () => number;
  private readonly contextTickMs: number;
  private outboundListener: AIOutboundListener | null = null;

  private client: AIClient | null = null;
  private clientUnsubs: Array<() => void> = [];
  private transport: SdkContextTransport | null = null;
  private connected = false;
  /** The current client has lost (or never made) a connection it tried for. */
  private lostConnection = false;
  private degradedUntil = Number.NEGATIVE_INFINITY;
  /** Whether `initialize` has run; an account change before it has nothing to reconnect. */
  private started = false;
  /**
   * Bumped by every `initialize` and account change, so a token fetch that
   * resolves after a newer one started (a sign-out mid-fetch) is discarded
   * instead of connecting as the old account.
   */
  private connectGeneration = 0;
  /** A conversation box waiting on a character's next reply, by character name. */
  private readonly replyWaiters = new Map<string, (text: string) => void>();
  private readonly fallbackLines = new LineRotation(CAROLINE_FALLBACK_LINES);
  private readonly actionDispatcher: AIActionDispatcher;

  private sceneCtx: AISceneContext | null = null;
  private sceneBus: EventBus | null = null;
  private sceneLeaving: (() => void) | null = null;
  private eventUnsubs: Array<() => void> = [];
  private contextTimer: ReturnType<typeof setInterval> | null = null;
  /** Outlives scenes, so rollups, the player profile and floor changes carry across them. */
  private readonly context: AIContextBuilder;

  constructor(deps: AIAdapterDeps = {}) {
    this.createClient = deps.createClient ?? ((options) => new GameAiClient(options));
    this.fetchToken = deps.fetchToken ?? fetchPlayerToken;
    this.serverUrl = deps.serverUrl ?? DEFAULT_SERVER_URL;
    this.intensity = deps.intensity ?? (() => settings.aiIntensity);
    this.showInterventions = deps.showInterventions ?? (() => settings.aiInterventionIndicators);
    this.now = deps.now ?? Date.now;
    this.contextTickMs = deps.contextTickMs ?? DEFAULT_CONTEXT_TICK_MS;
    this.context = new AIContextBuilder({ now: this.now });
    this.actionDispatcher = new AIActionDispatcher(
      (parsed, outcome) => this.onActionOutcome(parsed, outcome),
      this.now,
      deps.governor,
      (parsed) => this.intensityVeto(parsed),
    );
  }

  /**
   * Hands every message sent from now on to `listener` as well (one at a
   * time; null stops it). Only what actually went over the socket is seen:
   * nothing is sent, or heard, while disconnected.
   */
  setOutboundListener(listener: AIOutboundListener | null): void {
    this.outboundListener = listener;
  }

  /**
   * The gameplay scene bound right now, or null between scenes. Every floor
   * and interior binds on construction, so this follows the party through
   * doors and down stairwells without the reader tracking scene changes.
   */
  get boundScene(): AISceneContext | null {
    return this.sceneCtx;
  }

  /** Whether the server connection is up. */
  get isConnected(): boolean {
    return this.connected;
  }

  /**
   * Connects for the signed-in player. Resolves once the attempt is under
   * way; a signed-out player gets no connection and the AI stays off.
   */
  async initialize(): Promise<void> {
    this.started = true;
    this.connectGeneration += 1;
    const generation = this.connectGeneration;
    this.feed.status = 'connecting';
    const token = await this.fetchToken();
    if (generation !== this.connectGeneration) return;
    if (token === null) {
      this.feed.status = 'disabled';
      return;
    }
    this.openClient(token);
  }

  /**
   * Call once a gameplay scene is built (dungeon floors and interiors alike)
   * to wire its events and state. Events are mapped from the moment a scene
   * binds; nothing is sent until the server connection is open.
   *
   * `onLeave` runs as the scene is let go of, while its bus is still heard
   * and before the last flush, so events it emits (a challenge ended by
   * leaving the floor) still reach the server. The next scene binds from its
   * constructor, before the old scene's `onExit`, so this is the old scene's
   * last chance to be heard.
   */
  bindScene(
    ctx: AISceneContext,
    bus: EventBus,
    source: AIContextSource,
    onLeave?: () => void,
  ): void {
    this.unbindScene(this.sceneBus ?? undefined);
    this.sceneCtx = ctx;
    this.sceneBus = bus;
    this.sceneLeaving = onLeave ?? null;
    this.context.bind(bus, source);
    this.subscribeToEvents(bus);
    // Only while connected: an interval left running offline would also keep a
    // headless harness that builds a scene from ever exiting.
    if (this.connected) this.startContextTimer();
  }

  /**
   * Call from a scene's `onExit`, before `bus.clear()`, with that scene's bus.
   * The next scene is built (and binds) before the old one exits, so an
   * unbind naming a bus that is no longer bound is ignored.
   */
  unbindScene(bus?: EventBus): void {
    if (bus !== undefined && bus !== this.sceneBus) return;
    const leaving = this.sceneLeaving;
    this.sceneLeaving = null;
    leaving?.();
    this.flushContext();
    this.clearEventSubs();
    this.context.unbind();
    this.stopContextTimer();
    this.actionDispatcher.clear();
    endAIActionEffects();
    this.sceneCtx = null;
    this.sceneBus = null;
  }

  update(): void {
    this.feed.update();
    this.refreshStatus();
    if (!this.sceneCtx) return;
    // Scenes call this while paused too; the AI's timed effects hold with the game.
    if (!this.sceneCtx.isPaused()) tickAIActions();
    this.actionDispatcher.drain(this.sceneCtx);
  }

  /** The AI panel, for a gameplay scene to mount; it hides whenever the scene's HUD does. */
  surfaces(hudVisible: () => boolean): Surface[] {
    return [
      aiPanelSurface({
        feed: this.feed,
        hudVisible,
        onChoice: (choiceId) => this.answerChoice(choiceId),
      }),
    ];
  }

  /**
   * What the player typed to Caroline. Online it goes over the socket and
   * the reply streams into the panel; offline she answers with a
   * scripted line.
   */
  chatWithCaroline(message: string): void {
    this.context.recordPlayerMessage(CAROLINE_CHARACTER_NAME);
    if (!this.sendPlayerText(CAROLINE_CHARACTER_NAME, message)) this.sayScripted();
  }

  /**
   * Opens a conversation with Dave and resolves with his reply. He is
   * briefed by the server only on what he witnessed. Falls back to his usual
   * advice when the server is unreachable or slow.
   */
  chatWithDave(): Promise<string> {
    this.context.recordPlayerMessage(DAVE_CHARACTER_NAME);
    return new Promise((resolve) => {
      this.replyWaiters.get(DAVE_CHARACTER_NAME)?.(DAVE_FALLBACK_LINE);
      const timer = setTimeout(() => finish(DAVE_FALLBACK_LINE), DAVE_REPLY_TIMEOUT_MS);
      const finish = (text: string): void => {
        clearTimeout(timer);
        if (this.replyWaiters.get(DAVE_CHARACTER_NAME) === finish) {
          this.replyWaiters.delete(DAVE_CHARACTER_NAME);
        }
        resolve(text);
      };
      this.replyWaiters.set(DAVE_CHARACTER_NAME, finish);
      if (!this.sendPlayerText(DAVE_CHARACTER_NAME, DAVE_GREETING)) {
        finish(DAVE_FALLBACK_LINE);
      }
    });
  }

  /**
   * Wipes every AI character's memory of this player, for a save wipe. Owes
   * the in-character acknowledgement to the next page load, since a wipe
   * always reloads. Never rejects: a server that cannot be reached simply
   * keeps its memories.
   */
  async forgetPlayer(): Promise<void> {
    const token = await this.fetchToken();
    if (token === null) return;
    rememberForgottenPlayer(FORGOTTEN_PLAYER_LINE);
    // No playerId: the token names the player, and the server refuses a reset for anyone else.
    await Promise.all(
      enabledCharacters().map(async (character) => {
        try {
          await fetch(
            `${this.serverUrl}/api/characters/${encodeURIComponent(character.name)}/reset`,
            {
              method: 'POST',
              // The page reloads straight after a wipe; keepalive lets the request outlive it.
              keepalive: true,
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ scope: 'all', prompt: renderCharacterPrompt(character) }),
            },
          );
        } catch {
          // Unreachable server: nothing to forget there.
        }
      }),
    );
  }

  /**
   * The signed-in account changed (signed out, or signed in again, possibly as
   * someone else). The open connection speaks for the old account, so it is
   * dropped; the adapter reconnects under whichever account the game server
   * now vouches for, and stays off when it vouches for none.
   */
  accountChanged(): void {
    this.connectGeneration += 1;
    this.closeClient();
    this.feed.status = 'disabled';
    if (this.started) void this.initialize();
  }

  // ── connection ────────────────────────────────────────────────────────────

  private openClient(firstToken: string): void {
    this.closeClient();
    let primedToken: string | null = firstToken;
    const client = this.createClient({
      url: this.serverUrl,
      // Called before every connect and when the server warns the token is expiring.
      token: async () => {
        if (primedToken !== null) {
          const token = primedToken;
          primedToken = null;
          return token;
        }
        const fresh = await this.fetchToken();
        if (fresh === null) throw new Error('No player token: the player is signed out');
        return fresh;
      },
      sdk: AI_SDK_NAME,
      // Actions wait out pauses in the dispatcher, so results are sent from there.
      unhandledActions: 'ignore',
    });
    this.client = client;
    this.transport = new SdkContextTransport(client);
    const current = (): boolean => this.client === client;
    this.clientUnsubs = [
      client.on('connected', () => {
        if (current()) this.onConnected();
      }),
      client.on('disconnected', () => {
        if (!current()) return;
        this.lostConnection = true;
        this.onDisconnected();
      }),
      client.on('chat', (update) => {
        if (current()) this.onChat(update);
      }),
      client.on('ai_typing', (payload) => {
        if (current() && !this.replyWaiters.has(payload.characterName)) {
          this.feed.onTyping(payload);
        }
      }),
      client.on('ai_state', (payload) => {
        if (current()) this.feed.onState(payload);
      }),
      client.on('notice', (payload) => {
        if (!current()) return;
        if (payload.kind === 'error' || payload.kind === 'token_expiring') return;
        this.degradedUntil = this.now() + (payload.retryAfterMs ?? DEFAULT_DEGRADED_MS);
        this.refreshStatus();
      }),
      client.on('ai_action', (payload) => {
        if (current()) this.onServerAction(payload);
      }),
      // Transport and token failures surface as a disconnect; the game has nothing to add.
      client.on('error', () => undefined),
    ];
    client.connect().catch(() => undefined);
  }

  private closeClient(): void {
    for (const unsub of this.clientUnsubs) unsub();
    this.clientUnsubs = [];
    this.client?.close();
    this.client = null;
    this.transport = null;
    this.lostConnection = false;
    this.onDisconnected();
  }

  private onConnected(): void {
    this.connected = true;
    this.refreshStatus();
    this.transport?.reset();
    this.context.resynchronize();
    this.flushContext();
    if (this.sceneBus !== null) this.startContextTimer();
    const forgotten = takeForgottenPlayerNotice();
    if (forgotten !== null) this.feed.addScripted(CAROLINE_CHARACTER_NAME, forgotten);
  }

  private onDisconnected(): void {
    this.connected = false;
    this.stopContextTimer();
    this.feed.clearStreaming();
    for (const waiter of [...this.replyWaiters.values()]) waiter(DAVE_FALLBACK_LINE);
    this.refreshStatus();
  }

  /** Without a client the status is whatever `initialize` or `accountChanged` set. */
  private refreshStatus(): void {
    if (this.client === null) return;
    if (!this.connected) {
      this.feed.status = this.lostConnection ? 'offline' : 'connecting';
      return;
    }
    this.feed.status = this.now() < this.degradedUntil ? 'degraded' : 'online';
  }

  /** Sends what the player said; false when there is no connection to send it on. */
  private sendPlayerText(characterName: string, text: string, replyTo?: string): boolean {
    const client = this.client;
    if (client === null || !this.connected) return false;
    try {
      const sentText = text.slice(0, client.limits.maxMessageChars);
      client.sendPlayerMessage(characterName, sentText, replyTo);
      this.outboundListener?.({
        type: 'player_message',
        payload:
          replyTo === undefined
            ? { characterName, text: sentText }
            : { characterName, text: sentText, replyTo },
      });
      return true;
    } catch {
      return false;
    }
  }

  private sayScripted(): void {
    this.feed.addScripted(CAROLINE_CHARACTER_NAME, this.fallbackLines.next());
  }

  private onChat(update: ChatStreamUpdate): void {
    const waiter = this.replyWaiters.get(update.characterName);
    if (waiter === undefined) {
      this.feed.onChat(update);
      return;
    }
    if (update.done) waiter(update.text);
  }

  /** The player tapped a reply button: the label is sent as what they said, the choice id as `replyTo`. */
  answerChoice(choiceId: string): void {
    const reply = this.feed.pickChoice(choiceId);
    if (reply === null) return;
    this.context.recordPlayerMessage(reply.characterName);
    if (!this.sendPlayerText(reply.characterName, reply.text, reply.replyTo)) this.sayScripted();
  }

  // ── actions ───────────────────────────────────────────────────────────────

  /**
   * Every action the server sends is answered with an `action_result`: run,
   * refused by the player's intensity or the governor, or expired while the
   * game was paused.
   */
  private onServerAction(payload: ActionPayload): void {
    const parsed = parseServerAction(payload, payload.characterName);
    if (parsed === null) {
      this.sendActionResult(payload.actionId, false, 'unreadable action', {
        characterName: payload.characterName,
        type: payload.type,
        params: payload.params,
      });
      return;
    }
    const scene = this.sceneCtx;
    if (scene === null) {
      this.reportOutcome(parsed, { ok: false, detail: NO_SCENE_DETAIL, indicator: null });
      return;
    }
    this.actionDispatcher.submit(parsed, scene);
  }

  private intensityVeto(parsed: ParsedServerAction): string | null {
    const def = findAIAction(parsed.request.name);
    if (def === undefined) return null;
    return intensityRefusal(this.intensity(), { name: def.name, severity: def.policy.severity });
  }

  private onActionOutcome(parsed: ParsedServerAction, outcome: AIActionOutcome): void {
    this.reportOutcome(parsed, outcome);
    if (!outcome.ok || outcome.indicator === null) return;
    const characterName = parsed.request.characterName;
    this.context.recordAIAction(characterName, parsed.request.name, outcome.detail);
    if (this.showInterventions()) this.feed.addIntervention(characterName, outcome.indicator);
  }

  private reportOutcome(parsed: ParsedServerAction, outcome: AIActionOutcome): void {
    if (parsed.actionId === null) return;
    const { characterName, name, params } = parsed.request;
    this.sendActionResult(parsed.actionId, outcome.ok, outcome.detail, {
      characterName,
      type: name,
      params,
    });
  }

  private sendActionResult(
    actionId: string,
    ok: boolean,
    detail: string | undefined,
    answers: AnsweredAction,
  ): void {
    const client = this.client;
    if (client === null) return;
    const sentDetail = detail === undefined ? undefined : textForTheServer(detail);
    client.sendActionResult(actionId, ok, sentDetail);
    this.outboundListener?.({
      type: 'action_result',
      payload: sentDetail === undefined ? { actionId, ok } : { actionId, ok, detail: sentDetail },
      answers,
    });
  }

  // ── context ───────────────────────────────────────────────────────────────

  /** Sends whatever the context builder has due; a no-op while disconnected. */
  private flushContext(): void {
    const transport = this.transport;
    if (!this.connected || transport === null) return;
    const policy = intensityPolicy(this.intensity());
    this.context.setPolicyMultiplier(policy.policyMultiplier);
    this.context.setAllowedSeverities(policy.allowedSeverities);
    this.context.setCommentaryOnly(policy.commentaryOnly);
    const messages = this.context.tick();
    transport.send(messages);
    const listener = this.outboundListener;
    if (listener !== null) for (const message of messages) listener(message);
  }

  /**
   * Big moments get a scripted line from Caroline while she is offline.
   * Online, the server hears about them through the event stream and decides
   * for itself whether to react.
   */
  private subscribeToEvents(bus: EventBus): void {
    const reactOffline = (): void => {
      if (!this.connected) this.sayScripted();
    };
    this.eventUnsubs.push(
      bus.on('bossDefeated', reactOffline),
      bus.on('stairwellFound', reactOffline),
    );
  }

  private clearEventSubs(): void {
    for (const unsub of this.eventUnsubs) unsub();
    this.eventUnsubs = [];
  }

  private startContextTimer(): void {
    this.stopContextTimer();
    this.contextTimer = setInterval(() => this.flushContext(), this.contextTickMs);
  }

  private stopContextTimer(): void {
    if (this.contextTimer !== null) {
      clearInterval(this.contextTimer);
      this.contextTimer = null;
    }
  }
}

/** One per page: the connection, the context builder and its history outlive every scene. */
export const aiAdapter = new AIAdapter();
