/**
 * The idle loop's rare beats: a goblin peeking into the light, a sponsor's
 * word from the System AI, a loot box catching the light, Mongo tearing past.
 *
 * Which beat plays when is drawn from a seeded stream and timed only by the
 * {@link TitleClock}, so a seed and a moment always give the same picture: a
 * review render can freeze any beat halfway through, and the scheduler replays
 * every beat before a frozen moment with the start time it really had.
 */

import { mulberry32, type Rng } from '../../sprites/person/rng';
import type { TitleClock } from './titleClock';

export type TitleEventId = 'goblinPeek' | 'systemQuip' | 'lootGlint' | 'mongoDash';

/** How long each beat plays, the one place it is set; layers time their art against it. */
export const TITLE_EVENT_DURATION_MS: Readonly<Record<TitleEventId, number>> = {
  goblinPeek: 3200,
  systemQuip: 5200,
  lootGlint: 1100,
  mongoDash: 2400,
};

/** One beat as it fires, handed to every layer and to the quip hook. */
export interface TitleEventFire {
  readonly id: TitleEventId;
  /** When it began, on the scene clock (`clock.elapsedMs`). */
  readonly startedAtMs: number;
  readonly durationMs: number;
  /** A draw in [0, 1) of the beat's own, for a layer to vary it by (which side, which way). */
  readonly variant: number;
}

/** A line the System AI says between beats of the show. */
export interface TitleQuip {
  readonly text: string;
  /** When it was said, on the scene clock (`clock.elapsedMs`). */
  readonly startedAtMs: number;
  /** How long it stays up before the line may be cleared. */
  readonly durationMs: number;
}

/** Where a fired beat goes. */
export interface TitleEventSinks {
  /** Every layer's `onEvent`. */
  readonly broadcast: (fire: TitleEventFire) => void;
  /** The System AI line, through the scene's {@link TitleQuipChannel}. */
  readonly quip: (quip: TitleQuip) => void;
}

/** One row of the event table. */
export interface TitleEventDef {
  readonly id: TitleEventId;
  /** Relative chance against the other beats that are off cooldown. */
  readonly weight: number;
  /** The least time between two of this beat's starts. */
  readonly cooldownMs: number;
  /** A beat whose motion crosses the screen; skipped when the player asked for less motion. */
  readonly largeMotion: boolean;
  readonly run: (fire: TitleEventFire, sinks: TitleEventSinks) => void;
}

/**
 * Sponsor breaks in the System AI's voice. Shouted in capitals, because that
 * is how the show's announcer speaks everywhere else.
 */
export const TITLE_QUIPS: readonly string[] = [
  'THIS DUNGEON IS BROUGHT TO YOU BY A SPONSOR WHO WISHES TO REMAIN ANONYMOUS AND LITIGIOUS.',
  'VIEWERS AT HOME MAY NOW BET ON YOUR SURVIVAL. THE ODDS ARE NOT FLATTERING.',
  'A WORD FROM OUR SPONSORS: HAVE YOU CONSIDERED A LOOT BOX? YOU HAVE NOW.',
  'PLEASE KEEP HANDS, PAWS AND TENTACLES INSIDE THE DUNGEON AT ALL TIMES.',
  'RATINGS ARE UP. PLEASE CONTINUE TO PANIC AT YOUR CURRENT RATE.',
  "TODAY'S BLOODSHED IS SPONSORED BY NOBODY YET. BIDDING REMAINS OPEN.",
  'A FRIENDLY REMINDER THAT DEATH IS PERMANENT AND ALSO GREAT FOR ENGAGEMENT.',
  'THE SHOW THANKS ITS SPONSORS. THE CRAWLERS THANK NO ONE. THIS HAS BEEN NOTED.',
];

/** The quip a fire's variant picks. */
export function quipFor(variant: number): string {
  const index = Math.min(TITLE_QUIPS.length - 1, Math.floor(variant * TITLE_QUIPS.length));
  return TITLE_QUIPS[index];
}

const broadcastIt = (fire: TitleEventFire, sinks: TitleEventSinks): void => sinks.broadcast(fire);

/** The beats the idle loop draws from. */
export const TITLE_EVENTS: readonly TitleEventDef[] = [
  { id: 'goblinPeek', weight: 3, cooldownMs: 16000, largeMotion: false, run: broadcastIt },
  {
    id: 'systemQuip',
    weight: 2,
    cooldownMs: 26000,
    largeMotion: false,
    run: (fire, sinks) => {
      sinks.broadcast(fire);
      sinks.quip({
        text: quipFor(fire.variant),
        startedAtMs: fire.startedAtMs,
        durationMs: fire.durationMs,
      });
    },
  },
  { id: 'lootGlint', weight: 3, cooldownMs: 9000, largeMotion: false, run: broadcastIt },
  { id: 'mongoDash', weight: 1, cooldownMs: 38000, largeMotion: true, run: broadcastIt },
];

/** The quiet before the idle loop's first beat, so the reveal has the stage to itself. */
const FIRST_EVENT_AFTER_MS = 3500;
/** The quiet after one beat ends before the next may start. */
const EVENT_GAP_MIN_MS = 4000;
const EVENT_GAP_RANDOM_MS = 6000;

/** One beat in the plan, timed from the start of the idle loop. */
export interface PlannedTitleEvent {
  readonly id: TitleEventId;
  readonly atAliveMs: number;
  readonly variant: number;
}

/** Draws the plan one beat at a time: a pure function of the seed and the table. */
class TitleEventPlanner {
  private readonly random: Rng;
  private readonly lastStartMs = new Map<TitleEventId, number>();
  private nextAtMs = FIRST_EVENT_AFTER_MS;

  constructor(
    seed: number,
    private readonly table: readonly TitleEventDef[],
  ) {
    this.random = mulberry32(seed);
  }

  next(): PlannedTitleEvent | null {
    if (this.table.length === 0) return null;
    const atMs = Math.max(this.nextAtMs, this.earliestReadyMs());
    const ready = this.table.filter((event) => this.readyAt(event) <= atMs);
    const def = this.weightedPick(ready);
    const variant = this.random();
    this.lastStartMs.set(def.id, atMs);
    const gapMs = EVENT_GAP_MIN_MS + this.random() * EVENT_GAP_RANDOM_MS;
    this.nextAtMs = atMs + TITLE_EVENT_DURATION_MS[def.id] + gapMs;
    return { id: def.id, atAliveMs: atMs, variant };
  }

  private readyAt(event: TitleEventDef): number {
    const last = this.lastStartMs.get(event.id);
    return last === undefined ? 0 : last + event.cooldownMs;
  }

  private earliestReadyMs(): number {
    return Math.min(...this.table.map((event) => this.readyAt(event)));
  }

  /** `ready` is never empty: the time asked about is at least the earliest ready time. */
  private weightedPick(ready: readonly TitleEventDef[]): TitleEventDef {
    const total = ready.reduce((sum, event) => sum + event.weight, 0);
    let roll = this.random() * total;
    for (const event of ready) {
      roll -= event.weight;
      if (roll < 0) return event;
    }
    return ready[ready.length - 1];
  }
}

function tableFor(table: readonly TitleEventDef[], reducedMotion: boolean): TitleEventDef[] {
  return table.filter((event) => !(reducedMotion && event.largeMotion));
}

/**
 * Every beat a seed plays in the idle loop's first `untilAliveMs`, in order:
 * the same plan the scheduler follows, for a review render to aim at.
 */
export function planTitleEvents(
  seed: number,
  untilAliveMs: number,
  reducedMotion = false,
  table: readonly TitleEventDef[] = TITLE_EVENTS,
): PlannedTitleEvent[] {
  const planner = new TitleEventPlanner(seed, tableFor(table, reducedMotion));
  const plan: PlannedTitleEvent[] = [];
  for (let next = planner.next(); next !== null; next = planner.next()) {
    if (next.atAliveMs > untilAliveMs) break;
    plan.push(next);
  }
  return plan;
}

/**
 * Fires the idle loop's beats as their time comes. It runs only while the
 * scene is `alive`; time is the clock's alone, so a clock frozen part-way
 * through the loop fires every beat before that moment at once, each with the
 * start time it had.
 */
export class TitleEventScheduler {
  private planner: TitleEventPlanner | null = null;
  private upcoming: PlannedTitleEvent | null = null;

  constructor(
    private readonly sinks: TitleEventSinks,
    private readonly seed: number,
    private readonly table: readonly TitleEventDef[] = TITLE_EVENTS,
  ) {}

  /** Forgets every beat fired, so the plan replays from its start. */
  restart(): void {
    this.planner = null;
    this.upcoming = null;
  }

  update(clock: TitleClock): void {
    if (clock.state !== 'alive') return;
    const planner = this.plannerFor(clock.reducedMotion);
    const aliveMs = clock.stateElapsedMs;
    const aliveStartedAtMs = clock.elapsedMs - aliveMs;
    while (this.upcoming !== null && this.upcoming.atAliveMs <= aliveMs) {
      const due = this.upcoming;
      this.upcoming = planner.next();
      const def = this.table.find((event) => event.id === due.id);
      if (def === undefined) continue;
      def.run(
        {
          id: due.id,
          startedAtMs: aliveStartedAtMs + due.atAliveMs,
          durationMs: TITLE_EVENT_DURATION_MS[due.id],
          variant: due.variant,
        },
        this.sinks,
      );
    }
  }

  private plannerFor(reducedMotion: boolean): TitleEventPlanner {
    const existing = this.planner;
    if (existing !== null) return existing;
    const planner = new TitleEventPlanner(this.seed, tableFor(this.table, reducedMotion));
    this.planner = planner;
    this.upcoming = planner.next();
    return planner;
  }
}

type QuipListener = (quip: TitleQuip) => void;

/**
 * The hook the System AI line listens on. `current` is the latest quip, for a
 * surface that draws from the clock each frame (a frozen moment included);
 * `subscribe` is for one that wants to be told.
 */
export class TitleQuipChannel {
  private latest: TitleQuip | null = null;
  private readonly listeners = new Set<QuipListener>();

  publish(quip: TitleQuip): void {
    this.latest = quip;
    for (const listener of this.listeners) listener(quip);
  }

  /** The latest quip, or null before the first; a caller compares its start time to the clock. */
  current(): TitleQuip | null {
    return this.latest;
  }

  /** Calls `listener` on every quip from now on; the returned function unsubscribes. */
  subscribe(listener: QuipListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  clear(): void {
    this.latest = null;
  }
}

/** Seeds above this are as good as any; it keeps a seed a small positive integer. */
const SEED_RANGE = 0x7fffffff;

/** A fresh seed for a live title, so a returning player does not see the same show twice. */
export function freshTitleEventSeed(): number {
  return Math.floor(Math.random() * SEED_RANGE);
}
