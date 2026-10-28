import { crawlerName, PLAYER_CHARACTERS } from '../../characters/characters';
import type { CrawlerKind } from '../../core/skills/SkillManager';
import { createMergePatch, type JsonObject } from './json';
import type { CrawlerName, CrawlerState, LiveInput } from './types';

/** The server keeps up with one snapshot a second; anything faster is wasted bandwidth. */
export const SNAPSHOT_MIN_INTERVAL_MS = 1_000;

export interface StateSnapshotPayload {
  full?: JsonObject;
  patch?: JsonObject;
}

/** Which crawler goes by `name`. */
export function crawlerKindNamed(name: CrawlerName): CrawlerKind {
  return name === crawlerName('human') ? 'human' : 'cat';
}

/** The live state of the crawler that goes by `name`. */
export function liveCrawlerNamed(live: LiveInput, name: CrawlerName): CrawlerState {
  return live.crawlers[crawlerKindNamed(name)];
}

function crawlerJson(crawler: CrawlerState): JsonObject {
  return {
    hp: crawler.hp,
    maxHp: crawler.maxHp,
    level: crawler.level,
    xp: crawler.xp,
    coins: crawler.coins,
    isActive: crawler.isActive,
    knockedOut: crawler.knockedOut,
    statusEffects: [...crawler.statusEffects],
    equipped: { ...crawler.equipped },
    notableItems: { ...crawler.notableItems },
    healthPotions: crawler.healthPotions,
    tile: { x: crawler.tileX, y: crawler.tileY },
  };
}

/** The live state as the AI sees it. Absent fields are left out rather than nulled (see `json.ts`). */
export function buildLiveState(live: LiveInput): JsonObject {
  const location: JsonObject = {
    kind: live.location.kind,
    label: live.location.label,
    inSafeRoom: live.location.inSafeRoom,
    inBossArena: live.location.inBossArena,
  };
  return {
    activePlayer: live.activeCrawler,
    [PLAYER_CHARACTERS.human]: crawlerJson(live.crawlers.human),
    [PLAYER_CHARACTERS.cat]: crawlerJson(live.crawlers.cat),
    location,
    nearbyMobs: live.nearbyMobs.map((mob) => ({
      name: mob.name,
      level: mob.level,
      isBoss: mob.isBoss,
      threat: mob.threat,
      hpPercent: mob.hpPercent,
      distanceTiles: mob.distanceTiles,
    })),
    combatInProgress: live.combatInProgress,
    bossFightActive: live.bossFightActive,
    isPaused: live.isPaused,
    menuOpen: live.menuOpen,
  };
}

/**
 * Turns successive live states into `state_snapshot` payloads: a full state
 * first (and after every `reset`), then RFC 7386 merge patches, never more
 * often than `minIntervalMs` and never when nothing changed.
 */
export class SnapshotDiffer {
  private baseline: JsonObject | null = null;
  private lastSentAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly minIntervalMs: number = SNAPSHOT_MIN_INTERVAL_MS) {}

  /** Forget what the server has, so the next payload is a full state. */
  reset(): void {
    this.baseline = null;
    this.lastSentAt = Number.NEGATIVE_INFINITY;
  }

  next(state: JsonObject, now: number): StateSnapshotPayload | null {
    if (now - this.lastSentAt < this.minIntervalMs) return null;
    if (this.baseline === null) {
      this.baseline = state;
      this.lastSentAt = now;
      return { full: state };
    }
    const patch = createMergePatch(this.baseline, state);
    if (patch === null) return null;
    this.baseline = state;
    this.lastSentAt = now;
    return { patch };
  }
}
