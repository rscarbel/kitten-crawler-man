import type { EventBus } from '../../core/EventBus';
import type { ActionSeverity } from '../actions/types';
import { EVENT_IMPORTANCE } from './eventImportance';
import { subscribeGameEvents } from './eventMapping';
import { GameEventStream } from './gameEventStream';
import { jsonEqual, type JsonObject } from './json';
import {
  buildLiveState,
  SnapshotDiffer,
  SNAPSHOT_MIN_INTERVAL_MS,
  type StateSnapshotPayload,
} from './liveState';
import { PlayerProfileTracker } from './playerProfile';
import {
  buildSessionContext,
  buildSessionFlags,
  LOW_HP_FRACTION,
  type ContextSetPayload,
  type SessionFlags,
} from './sessionContext';
import type { AIContextSource, CrawlerName, GameEvent, LiveInput, SessionInput } from './types';

/** The player profile is recomputed this often and rides along on the next `context_set`. */
export const PROFILE_INTERVAL_MS = 180_000;
/**
 * The game's own cap on the events one `event_log` message carries, per tick.
 * It sits well under the server's limit (50 by default, the SDK's too), so a
 * burst of events never comes near a batch the server would refuse.
 */
export const MAX_EVENTS_PER_BATCH = 20;
/**
 * How long a crawler can sit below low HP with potions in the bag before the
 * AI hears about it. Long enough that a crawler mid-swing is not "stockpiling".
 */
export const STOCKPILING_GRACE_MS = 8_000;
/** At least this many potions held while dying counts as stockpiling rather than being out. */
export const STOCKPILING_MIN_POTIONS = 2;
const MS_PER_SECOND = 1000;

/** One outbound message in the v2 protocol's shape. */
export type ContextMessage =
  | { type: 'context_set'; payload: ContextSetPayload }
  | { type: 'state_snapshot'; payload: StateSnapshotPayload }
  | { type: 'event_log'; payload: { events: GameEvent[] } };

export interface AIContextBuilderOptions {
  now?: () => number;
  snapshotMinIntervalMs?: number;
  profileIntervalMs?: number;
  maxEventsPerBatch?: number;
}

interface StockpilingWatch {
  crawler: CrawlerName;
  since: number;
}

/**
 * Builds everything the AI server knows about a play session: `context_set`
 * (session facts, flags, player profile), `state_snapshot` (full then merge
 * patches) and `event_log` (mapped, rolled-up, witness-scoped events).
 *
 * It owns no transport. Bind it to a scene's bus and source, call `tick()`
 * regularly, and send what it returns. The instance outlives scenes, so event
 * rollups, the profile and floor-change detection carry across doors and
 * stairwells.
 */
export class AIContextBuilder {
  private readonly now: () => number;
  private readonly differ: SnapshotDiffer;
  private readonly stateIntervalMs: number;
  private lastStateSentAt = Number.NEGATIVE_INFINITY;
  private readonly profileIntervalMs: number;
  private readonly maxEventsPerBatch: number;
  private readonly stream = new GameEventStream();
  private readonly profile: PlayerProfileTracker;
  private source: AIContextSource | null = null;
  private unsubs: Array<() => void> = [];
  private lastContext: JsonObject | null = null;
  private lastFlags: SessionFlags | null = null;
  private profileJson: JsonObject | null = null;
  private profileComputedAt = Number.NEGATIVE_INFINITY;
  private lastProfileSampleAt = Number.NEGATIVE_INFINITY;
  private policyMultiplier: number | undefined;
  private allowedSeverities: readonly ActionSeverity[] | undefined;
  private commentaryOnly = false;
  private forceContext = true;
  private lastDungeonLevelId: string | null = null;
  private stockpiling: StockpilingWatch[] = [];

  constructor(options: AIContextBuilderOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.stateIntervalMs = options.snapshotMinIntervalMs ?? SNAPSHOT_MIN_INTERVAL_MS;
    // The builder gates context and state together (see `tick`), so the differ itself never waits.
    this.differ = new SnapshotDiffer(0);
    this.profileIntervalMs = options.profileIntervalMs ?? PROFILE_INTERVAL_MS;
    this.maxEventsPerBatch = options.maxEventsPerBatch ?? MAX_EVENTS_PER_BATCH;
    this.profile = new PlayerProfileTracker(this.now());
  }

  get isBound(): boolean {
    return this.source !== null;
  }

  /** The flags last sent (or about to be), or null before the first tick. */
  get currentFlags(): SessionFlags | null {
    return this.lastFlags;
  }

  /**
   * Starts reading a scene. Entering a new dungeon floor records a
   * `floorEntered` event the server treats as a reflection trigger; the next
   * tick always sends `context_set` and a full snapshot.
   */
  bind(bus: EventBus, source: AIContextSource): void {
    this.unbind();
    this.source = source;
    this.unsubs = subscribeGameEvents(bus, {
      source,
      stream: this.stream,
      profile: this.profile,
      now: () => this.now(),
      watchForStockpiling: (crawler) => this.watchForStockpiling(crawler),
      potionDrunk: (crawler) => {
        this.stockpiling = this.stockpiling.filter((watch) => watch.crawler !== crawler);
      },
    });
    this.noteFloor(source);
    this.forceContext = true;
    this.differ.reset();
    this.lastStateSentAt = Number.NEGATIVE_INFINITY;
  }

  unbind(): void {
    for (const unsub of this.unsubs) unsub();
    this.unsubs = [];
    this.source = null;
    this.stockpiling = [];
  }

  /** The server lost what it had (reconnect): resend context and a full snapshot. */
  resynchronize(): void {
    this.forceContext = true;
    this.differ.reset();
    this.lastStateSentAt = Number.NEGATIVE_INFINITY;
  }

  /** AI intensity, sent with `context_set`; undefined leaves the server's default. */
  setPolicyMultiplier(multiplier: number | undefined): void {
    if (multiplier === this.policyMultiplier) return;
    this.policyMultiplier = multiplier;
    this.forceContext = true;
  }

  /** Severities the AI may use, sent with `context_set`; undefined allows them all. */
  setAllowedSeverities(severities: readonly ActionSeverity[] | undefined): void {
    const unchanged = severities?.join() === this.allowedSeverities?.join();
    if (unchanged) return;
    this.allowedSeverities = severities === undefined ? undefined : [...severities];
    this.forceContext = true;
  }

  /** Whether only commentary actions may run, sent as the `commentaryOnly` flag. */
  setCommentaryOnly(on: boolean): void {
    if (on === this.commentaryOnly) return;
    this.commentaryOnly = on;
    this.forceContext = true;
  }

  /** The player spoke to a character. Feeds the profile's chat frequency. */
  recordPlayerMessage(characterName: string): void {
    this.profile.recordChat(characterName);
  }

  /** The player saw an AI action land; the AI learns its intervention was noticed. */
  recordAIAction(characterName: string, actionType: string, description: string): void {
    const inSafeRoom = this.source?.isPartyInSafeRoom() ?? false;
    this.stream.record(
      {
        type: 'aiActionWitnessed',
        data: { character: characterName, action: actionType, description },
        summary: `The crawlers saw ${characterName}'s intervention: ${description}.`,
        importance: EVENT_IMPORTANCE.aiActionWitnessed,
        witness: 'inSafeRoom',
      },
      this.now(),
      inSafeRoom,
    );
  }

  /** Everything due to send now, context first so flags precede the state they describe. */
  tick(): ContextMessage[] {
    const now = this.now();
    const out: ContextMessage[] = [];
    const source = this.source;
    if (source !== null) {
      const session = source.readSession();
      const live = source.readLive();
      if (now - this.lastProfileSampleAt >= SNAPSHOT_MIN_INTERVAL_MS) {
        this.lastProfileSampleAt = now;
        this.profile.sampleLive(live, session.levelId, session.roomCount);
      }
      if (now - this.profileComputedAt >= this.profileIntervalMs) {
        this.profileComputedAt = now;
        this.profileJson = this.profile.summary(now);
      }
      this.checkStockpiling(now, live);

      if (now - this.lastStateSentAt >= this.stateIntervalMs) {
        const sent = this.collectState(session, live, now, out);
        if (sent) this.lastStateSentAt = now;
      }
    }

    const events = this.stream.flush(now);
    for (let start = 0; start < events.length; start += this.maxEventsPerBatch) {
      out.push({
        type: 'event_log',
        payload: { events: events.slice(start, start + this.maxEventsPerBatch) },
      });
    }
    return out;
  }

  /**
   * The latest events `characterName` perceived, newest first, as briefing
   * lines for a conversation with them.
   */
  witnessedHighlights(
    characterName: string,
    limit: number,
  ): Array<{ summary: string; secondsAgo: number }> {
    const now = this.now();
    return this.stream.recentlyWitnessedBy(characterName, limit).map((event) => ({
      summary: event.summary ?? event.type,
      secondsAgo: Math.max(0, Math.round((now - event.ts) / MS_PER_SECOND)),
    }));
  }

  /**
   * Context and state share one rate limit: an old server turns each of them
   * into a whole snapshot, and a flag flicker (a menu opened and shut) is not
   * worth more than one message a second. Returns whether anything was added.
   */
  private collectState(
    session: SessionInput,
    live: LiveInput,
    now: number,
    out: ContextMessage[],
  ): boolean {
    let sent = false;
    const context = buildSessionContext(session, this.profileJson);
    const flags = buildSessionFlags(session, live, this.commentaryOnly);
    const contextChanged = this.lastContext === null || !jsonEqual(context, this.lastContext);
    const flagsChanged = this.lastFlags === null || !jsonEqual({ ...flags }, { ...this.lastFlags });
    if (this.forceContext || contextChanged || flagsChanged) {
      this.forceContext = false;
      this.lastContext = context;
      this.lastFlags = flags;
      const payload: ContextSetPayload = { context, flags };
      if (this.policyMultiplier !== undefined) payload.policyMultiplier = this.policyMultiplier;
      if (this.allowedSeverities !== undefined) payload.allowedSeverities = this.allowedSeverities;
      out.push({ type: 'context_set', payload });
      sent = true;
    }
    const snapshot = this.differ.next(buildLiveState(live), now);
    if (snapshot !== null) {
      out.push({ type: 'state_snapshot', payload: snapshot });
      sent = true;
    }
    return sent;
  }

  private noteFloor(source: AIContextSource): void {
    const session = source.readSession();
    if (session.indoors) return;
    const previous = this.lastDungeonLevelId;
    this.lastDungeonLevelId = session.levelId;
    if (previous === null || previous === session.levelId) return;
    this.stream.record(
      {
        type: 'floorEntered',
        data: { floor: session.floorNumber, levelId: session.levelId, name: session.floorName },
        summary: `The crawlers arrived on floor ${session.floorNumber}: ${session.floorName}. Time to recap the last episode.`,
        importance: EVENT_IMPORTANCE.floorEntered,
        witness: 'always',
      },
      this.now(),
      source.isPartyInSafeRoom(),
    );
  }

  private watchForStockpiling(crawler: CrawlerName): void {
    if (this.stockpiling.some((watch) => watch.crawler === crawler)) return;
    this.stockpiling.push({ crawler, since: this.now() });
  }

  private checkStockpiling(now: number, live: LiveInput): void {
    if (this.stockpiling.length === 0 || live.isPaused) return;
    const stillWatching: StockpilingWatch[] = [];
    for (const watch of this.stockpiling) {
      const state = watch.crawler === 'Carl' ? live.carl : live.donut;
      const stillLow = state.maxHp > 0 && state.hp / state.maxHp < LOW_HP_FRACTION;
      if (!stillLow || state.knockedOut) continue;
      if (now - watch.since < STOCKPILING_GRACE_MS) {
        stillWatching.push(watch);
        continue;
      }
      if (state.healthPotions < STOCKPILING_MIN_POTIONS) continue;
      this.profile.recordStockpiling();
      this.stream.record(
        {
          type: 'potionStockpiling',
          data: { crawler: watch.crawler, healthPotions: state.healthPotions, hp: state.hp },
          summary: `${watch.crawler} is nearly dead with ${state.healthPotions} healing potions in the bag and is not drinking any.`,
          importance: EVENT_IMPORTANCE.potionStockpiling,
          witness: 'inSafeRoom',
        },
        now,
        live.location.inSafeRoom,
      );
    }
    this.stockpiling = stillWatching;
  }
}
