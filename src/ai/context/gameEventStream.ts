import { AI_CHARACTERS, type AICharacterDefinition } from '../characters';
import {
  DODGE_IMPORTANCE,
  KILL_IMPORTANCE_BASE,
  KILL_IMPORTANCE_CAP,
  KILL_IMPORTANCE_PER_KILL,
} from './eventImportance';
import type { JsonObject } from './json';
import type { CrawlerName, GameEvent } from './types';

/**
 * Who besides the omniscient characters perceives an event.
 * - `always`: news that reaches every character (a death, a new floor, a public achievement).
 * - `inSafeRoom`: only seen if it happens in a safe room (where the event's subject crawler stands, else the active one).
 * - `never`: only omniscient characters perceive it.
 */
export type Witness = 'always' | 'inSafeRoom' | 'never';

export interface EventDraft {
  type: string;
  data: JsonObject;
  summary: string;
  importance: number;
  witness: Witness;
  /**
   * The crawler the event happened to. A safe-room witness rule is judged on
   * where that crawler stands, not the controlled one: Donut drinking a potion
   * in the safe room is seen there even while Carl explores outside.
   */
  subject?: CrawlerName;
}

/** Kills inside one fight are reported together once the fight goes quiet for this long. */
export const KILL_ROLLUP_QUIET_MS = 3_000;
/** A long fight still reports its kills at least this often. */
export const KILL_ROLLUP_MAX_MS = 15_000;
/** Dodges are reported at most once per window, as a count. */
export const DODGE_SAMPLE_WINDOW_MS = 30_000;
/** Beyond this many buffered events (server unreachable for a long while), the least important are dropped. */
export const MAX_PENDING_EVENTS = 200;
/** How many witnessed events are kept to brief a witnessed-scope character when the player talks to them. */
export const RECENT_WITNESSED_LIMIT = 30;

const MS_PER_SECOND = 1000;

/**
 * The characters that perceive an event: every omniscient one, plus every
 * witnessed-scope one when the event's `witness` rule says they saw it.
 * Returns undefined when only omniscient characters perceive it, which the
 * protocol reads the same way.
 */
export function perceiversOf(
  witness: Witness,
  partyInSafeRoom: boolean,
  characters: readonly AICharacterDefinition[] = AI_CHARACTERS,
): string[] | undefined {
  const witnessedSeesIt = witness === 'always' || (witness === 'inSafeRoom' && partyInSafeRoom);
  if (!witnessedSeesIt) return undefined;
  const enabled = characters.filter((character) => character.enabled);
  if (!enabled.some((character) => character.knowledgeScope === 'witnessed')) return undefined;
  return enabled.map((character) => character.name);
}

interface KillRollup {
  firstAt: number;
  lastAt: number;
  byType: Map<string, number>;
  byKiller: Map<string, number>;
  witnessedInSafeRoom: boolean;
}

interface DodgeSample {
  windowStart: number;
  byCrawler: Map<CrawlerName, number>;
}

function mapToJson(map: ReadonlyMap<string, number>): JsonObject {
  const out: JsonObject = {};
  for (const [key, value] of map) out[key] = value;
  return out;
}

function countPhrase(map: ReadonlyMap<string, number>): string {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${count} ${name}`)
    .join(', ');
}

/**
 * Buffers game events for the server: stamps time and perceivers, rolls kills
 * up per fight, samples dodges, and hands everything over on `flush`.
 */
export class GameEventStream {
  private pending: GameEvent[] = [];
  private kills: KillRollup | null = null;
  private dodges: DodgeSample | null = null;
  private recentWitnessed: GameEvent[] = [];

  constructor(private readonly characters: readonly AICharacterDefinition[] = AI_CHARACTERS) {}

  record(draft: EventDraft, now: number, partyInSafeRoom: boolean): void {
    const event: GameEvent = {
      ts: now,
      type: draft.type,
      data: draft.data,
      summary: draft.summary,
      importance: draft.importance,
    };
    const witnessedBy = perceiversOf(draft.witness, partyInSafeRoom, this.characters);
    if (witnessedBy !== undefined) event.witnessedBy = witnessedBy;
    this.enqueue(event);
  }

  /** One kill toward the current fight's rollup. `killer` is null for kills no crawler made. */
  recordKill(mobName: string, killer: CrawlerName | null, now: number, inSafeRoom: boolean): void {
    if (this.kills !== null && now - this.kills.lastAt > KILL_ROLLUP_QUIET_MS) {
      this.flushKills();
    }
    const rollup = this.kills ?? {
      firstAt: now,
      lastAt: now,
      byType: new Map<string, number>(),
      byKiller: new Map<string, number>(),
      witnessedInSafeRoom: inSafeRoom,
    };
    this.kills = rollup;
    rollup.lastAt = now;
    rollup.byType.set(mobName, (rollup.byType.get(mobName) ?? 0) + 1);
    const killerName = killer ?? 'something else';
    rollup.byKiller.set(killerName, (rollup.byKiller.get(killerName) ?? 0) + 1);
  }

  recordDodge(crawler: CrawlerName, now: number): void {
    const sample = this.dodges ?? { windowStart: now, byCrawler: new Map<CrawlerName, number>() };
    this.dodges = sample;
    sample.byCrawler.set(crawler, (sample.byCrawler.get(crawler) ?? 0) + 1);
  }

  /** Every event ready to send, oldest first. Rollups whose window has closed are included. */
  flush(now: number): GameEvent[] {
    const kills = this.kills;
    if (
      kills !== null &&
      (now - kills.lastAt >= KILL_ROLLUP_QUIET_MS || now - kills.firstAt >= KILL_ROLLUP_MAX_MS)
    ) {
      this.flushKills();
    }
    const dodges = this.dodges;
    if (dodges !== null && now - dodges.windowStart >= DODGE_SAMPLE_WINDOW_MS) {
      this.flushDodges(now);
    }
    const out = this.pending;
    this.pending = [];
    return out;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  private flushKills(): void {
    const rollup = this.kills;
    this.kills = null;
    if (rollup === null) return;
    const count = [...rollup.byType.values()].reduce((sum, n) => sum + n, 0);
    const seconds = Math.max(1, Math.round((rollup.lastAt - rollup.firstAt) / MS_PER_SECOND));
    const killers = countPhrase(rollup.byKiller);
    const importance = Math.min(
      KILL_IMPORTANCE_CAP,
      KILL_IMPORTANCE_BASE + KILL_IMPORTANCE_PER_KILL * count,
    );
    const event: GameEvent = {
      ts: rollup.lastAt,
      type: 'mobsKilled',
      data: {
        count,
        seconds,
        byType: mapToJson(rollup.byType),
        byKiller: mapToJson(rollup.byKiller),
      },
      summary:
        count === 1
          ? `A ${[...rollup.byType.keys()].join('')} was killed (by ${[...rollup.byKiller.keys()].join('')}).`
          : `${count} enemies killed in ${seconds}s: ${countPhrase(rollup.byType)} (kills: ${killers}).`,
      importance,
    };
    const witnessedBy = perceiversOf('inSafeRoom', rollup.witnessedInSafeRoom, this.characters);
    if (witnessedBy !== undefined) event.witnessedBy = witnessedBy;
    this.enqueue(event);
  }

  private flushDodges(now: number): void {
    const sample = this.dodges;
    this.dodges = null;
    if (sample === null) return;
    const total = [...sample.byCrawler.values()].reduce((sum, n) => sum + n, 0);
    const seconds = Math.round((now - sample.windowStart) / MS_PER_SECOND);
    this.enqueue({
      ts: now,
      type: 'playerDodged',
      data: { count: total, seconds, byCrawler: mapToJson(sample.byCrawler) },
      summary: `Dodged ${total} attack${total === 1 ? '' : 's'} in the last ${seconds}s (${countPhrase(sample.byCrawler)}).`,
      importance: DODGE_IMPORTANCE,
    });
  }

  /** The latest events `characterName` perceived, newest first. */
  recentlyWitnessedBy(characterName: string, limit: number): GameEvent[] {
    return this.recentWitnessed
      .filter((event) => event.witnessedBy?.includes(characterName) === true)
      .slice(-limit)
      .reverse();
  }

  private enqueue(event: GameEvent): void {
    this.pending.push(event);
    if (event.witnessedBy !== undefined) {
      this.recentWitnessed.push(event);
      if (this.recentWitnessed.length > RECENT_WITNESSED_LIMIT) this.recentWitnessed.shift();
    }
    this.trimPending();
  }

  private trimPending(): void {
    while (this.pending.length > MAX_PENDING_EVENTS) {
      let dropAt = 0;
      for (let i = 1; i < this.pending.length; i++) {
        const candidate = this.pending[i]?.importance ?? 0;
        const current = this.pending[dropAt]?.importance ?? 0;
        if (candidate < current) dropAt = i;
      }
      this.pending.splice(dropAt, 1);
    }
  }
}
