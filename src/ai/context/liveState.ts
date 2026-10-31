import { createMergePatch, type JsonObject } from './json';
import type { CrawlerState, KeyState, LiveInput } from './types';

/** The server keeps up with one snapshot a second; anything faster is wasted bandwidth. */
export const SNAPSHOT_MIN_INTERVAL_MS = 1_000;

export interface StateSnapshotPayload {
  full?: JsonObject;
  patch?: JsonObject;
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

function keyJson(key: KeyState): JsonObject {
  return {
    name: key.name,
    fragmentsHeld: [...key.fragmentsHeld],
    fragmentsNeeded: key.fragmentsNeeded,
    forged: key.forged,
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
    human: crawlerJson(live.crawlers.human),
    cat: crawlerJson(live.crawlers.cat),
    location,
    nearbyMobs: live.nearbyMobs.map((mob) => ({
      name: mob.name,
      level: mob.level,
      isBoss: mob.isBoss,
      threat: mob.threat,
      hpPercent: mob.hpPercent,
      distanceTiles: mob.distanceTiles,
    })),
    keys: live.keys.map(keyJson),
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
