import type { JsonObject } from './json';
import type { LiveInput } from './types';

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
/** A potion drunk above this share of max HP counts as a cautious, early drink. */
const CAUTIOUS_POTION_HP_FRACTION = 0.5;
/** Beyond this many tiles apart, Carl has left Donut behind (or she him). */
const PARTY_SPLIT_TILES = 12;
/**
 * How long after a piece of Mordecai's advice progress still counts as having
 * acted on it. Advice points the party at the floor's next objective, so real
 * progress (a quest taken, an objective met, a boss down) inside this window is
 * the best signal the game has that the advice was taken.
 */
const ADVICE_FOLLOW_WINDOW_MINUTES = 10;
const ADVICE_FOLLOW_WINDOW_MS = ADVICE_FOLLOW_WINDOW_MINUTES * MS_PER_MINUTE;
const RATIO_DECIMALS = 100;

function round2(value: number): number {
  return Math.round(value * RATIO_DECIMALS) / RATIO_DECIMALS;
}

function ratio(part: number, whole: number): number {
  return whole > 0 ? round2(part / whole) : 0;
}

/**
 * Derived play-style statistics. Raw counts accumulate from game events and
 * sampled live state; `summary()` turns them into the rates the AI reasons
 * about ("this crawler is a trashGremlin", "this crawler leaves the cat behind").
 */
export class PlayerProfileTracker {
  private readonly startedAt: number;
  private kills = 0;
  private potionsHighHp = 0;
  private potionsLowHp = 0;
  private stockpilingMoments = 0;
  private coinsGained = 0;
  private purchases = 0;
  private boxesOpened = 0;
  private systemChats = 0;
  private mordecaiChats = 0;
  private adviceGiven = 0;
  private adviceFollowed = 0;
  private pendingAdviceAt: number | null = null;
  private splitSamples = 0;
  private liveSamples = 0;
  private donutKnockouts = 0;
  private carlKnockouts = 0;
  private lastCoins: number | null = null;
  private readonly roomsSeen = new Set<string>();
  private roomCount = 0;
  private floorKey = '';

  constructor(now: number) {
    this.startedAt = now;
  }

  recordKills(count: number): void {
    this.kills += count;
  }

  recordPotion(hpBeforeFraction: number): void {
    if (hpBeforeFraction >= CAUTIOUS_POTION_HP_FRACTION) this.potionsHighHp++;
    else this.potionsLowHp++;
  }

  recordStockpiling(): void {
    this.stockpilingMoments++;
  }

  recordPurchase(): void {
    this.purchases++;
  }

  recordBoxOpened(): void {
    this.boxesOpened++;
  }

  recordChat(characterName: string): void {
    if (characterName === 'Mordecai') this.mordecaiChats++;
    else this.systemChats++;
  }

  recordKnockout(crawler: 'Carl' | 'Donut'): void {
    if (crawler === 'Donut') this.donutKnockouts++;
    else this.carlKnockouts++;
  }

  recordAdvice(now: number): void {
    this.adviceGiven++;
    this.pendingAdviceAt = now;
  }

  /** Any real progress: a quest taken or finished, an objective met, a boss down, a floor cleared. */
  recordProgress(now: number): void {
    if (this.pendingAdviceAt !== null && now - this.pendingAdviceAt <= ADVICE_FOLLOW_WINDOW_MS) {
      this.adviceFollowed++;
    }
    this.pendingAdviceAt = null;
  }

  /** Samples the live state; call at the snapshot cadence, not every frame. */
  sampleLive(live: LiveInput, floorKey: string, roomCount: number | undefined): void {
    if (floorKey !== this.floorKey) {
      this.floorKey = floorKey;
      this.roomsSeen.clear();
    }
    this.roomCount = roomCount ?? 0;
    if (live.location.roomIndex !== undefined) {
      this.roomsSeen.add(`${floorKey}:${live.location.roomIndex}`);
    }
    if (live.isPaused) return;
    this.liveSamples++;
    const apart = Math.hypot(
      live.carl.tileX - live.donut.tileX,
      live.carl.tileY - live.donut.tileY,
    );
    if (apart > PARTY_SPLIT_TILES) this.splitSamples++;
    const coins = live.carl.coins + live.donut.coins;
    if (this.lastCoins !== null && coins > this.lastCoins)
      this.coinsGained += coins - this.lastCoins;
    this.lastCoins = coins;
  }

  summary(now: number): JsonObject {
    const minutes = Math.max(1, (now - this.startedAt) / MS_PER_MINUTE);
    const hours = Math.max(1 / (MS_PER_HOUR / MS_PER_MINUTE), (now - this.startedAt) / MS_PER_HOUR);
    const potionsTotal = this.potionsHighHp + this.potionsLowHp;
    return {
      aggression: { killsPerMinute: round2(this.kills / minutes) },
      caution: {
        potionsDrunk: potionsTotal,
        shareDrunkAboveHalfHp: ratio(this.potionsHighHp, potionsTotal),
        timesSatOnPotionsAtLowHp: this.stockpilingMoments,
      },
      lootGreed: {
        coinsPerMinute: round2(this.coinsGained / minutes),
        purchases: this.purchases,
        boxesOpened: this.boxesOpened,
      },
      exploration: {
        roomsSeen: this.roomsSeen.size,
        shareOfFloorExplored: ratio(this.roomsSeen.size, this.roomCount),
      },
      chat: {
        withSystemPerHour: round2(this.systemChats / hours),
        withMordecai: this.mordecaiChats,
      },
      advice: {
        given: this.adviceGiven,
        followedShare: ratio(this.adviceFollowed, this.adviceGiven),
      },
      treatmentOfDonut: {
        shareOfTimeSplitUp: ratio(this.splitSamples, this.liveSamples),
        donutKnockouts: this.donutKnockouts,
        carlKnockouts: this.carlKnockouts,
      },
    };
  }
}
