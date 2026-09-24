import { isRecord } from './guards';

/** The fixed update rate the scene loop steps at, which is what a played frame is worth. */
const UPDATE_FRAMES_PER_SECOND = 60;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const CLOCK_FIELD_WIDTH = 2;

/**
 * The run's tallies: what the Stats tab shows and what the run-complete screen
 * sums up. One object per run, threaded by reference through every scene the
 * run passes through.
 *
 * Two kinds of counter live here. Most describe the world as it stands — the
 * kills, the gold, the damage — and a checkpoint rewind takes them back with
 * the world, because the mobs they were scored on are standing again. Deaths
 * and time played describe the player's run instead, and nothing rewinds them:
 * a death that undid its own tally would make every death free.
 */
export class GameStats {
  private _killsByType = new Map<string, number>();
  private _potionsUsed = 0;
  private _bossesDefeated = 0;
  private _damageDealt = 0;
  private _damageTaken = 0;
  private _goldEarned = 0;
  private _hirelingsHired = 0;
  private _hirelingsLost = 0;
  private _deaths = 0;
  private _framesPlayed = 0;

  recordKill(displayName: string, isBoss = false): void {
    this._killsByType.set(displayName, (this._killsByType.get(displayName) ?? 0) + 1);
    if (isBoss) this._bossesDefeated++;
  }

  /**
   * Every `mobKilled` goes through here, in every scene, so a kill is counted
   * the same way everywhere.
   *
   * An ally that dies with nobody credited is not a kill: an ink marauder
   * bleeding back into ink when its lifespan runs out raises the same event,
   * and it would otherwise head the "most slain" list of a run that summoned
   * a lot of them.
   */
  recordMobKilled(event: {
    readonly mob: {
      readonly displayName: string;
      readonly countsAsBossKill: boolean;
      readonly isHostile: boolean;
    };
    readonly killer: object | null;
  }): void {
    const { mob, killer } = event;
    if (killer === null && !mob.isHostile) return;
    this.recordKill(mob.displayName, mob.countsAsBossKill);
  }

  recordPotionUsed(): void {
    this._potionsUsed++;
  }

  recordDamageDealt(amount: number): void {
    if (amount > 0) this._damageDealt += amount;
  }

  recordDamageTaken(amount: number): void {
    if (amount > 0) this._damageTaken += amount;
  }

  recordGoldEarned(amount: number): void {
    if (amount > 0) this._goldEarned += amount;
  }

  recordHirelingHired(): void {
    this._hirelingsHired++;
  }

  recordHirelingLost(): void {
    this._hirelingsLost++;
  }

  recordDeath(): void {
    this._deaths++;
  }

  /** One fixed update of play the world was not halted for. */
  recordPlayedFrame(): void {
    this._framesPlayed++;
  }

  get totalKills(): number {
    let total = 0;
    for (const count of this._killsByType.values()) total += count;
    return total;
  }

  get killsByType(): ReadonlyMap<string, number> {
    return this._killsByType;
  }

  /** Kill counts by creature name, most first; ties keep the order they were first killed in. */
  topKills(limit: number): Array<[string, number]> {
    return [...this._killsByType].sort((a, b) => b[1] - a[1]).slice(0, limit);
  }

  get potionsUsed(): number {
    return this._potionsUsed;
  }

  get bossesDefeated(): number {
    return this._bossesDefeated;
  }

  get damageDealt(): number {
    return this._damageDealt;
  }

  get damageTaken(): number {
    return this._damageTaken;
  }

  get goldEarned(): number {
    return this._goldEarned;
  }

  get hirelingsHired(): number {
    return this._hirelingsHired;
  }

  get hirelingsLost(): number {
    return this._hirelingsLost;
  }

  get deaths(): number {
    return this._deaths;
  }

  get framesPlayed(): number {
    return this._framesPlayed;
  }

  /** Point-in-time copy of every tally, for a checkpoint capture or a save. */
  snapshot(): GameStatsSnapshot {
    return {
      killsByType: [...this._killsByType],
      potionsUsed: this._potionsUsed,
      bossesDefeated: this._bossesDefeated,
      damageDealt: this._damageDealt,
      damageTaken: this._damageTaken,
      goldEarned: this._goldEarned,
      hirelingsHired: this._hirelingsHired,
      hirelingsLost: this._hirelingsLost,
      deaths: this._deaths,
      framesPlayed: this._framesPlayed,
    };
  }

  /**
   * Rewinds the tallies that describe the world to a checkpoint, so kills scored
   * after it stop counting. Deaths and time played are left alone: see the
   * class comment.
   */
  restore(snapshot: GameStatsSnapshot): void {
    this._killsByType = new Map(snapshot.killsByType);
    this._potionsUsed = snapshot.potionsUsed;
    this._bossesDefeated = snapshot.bossesDefeated;
    this._damageDealt = snapshot.damageDealt;
    this._damageTaken = snapshot.damageTaken;
    this._goldEarned = snapshot.goldEarned;
    this._hirelingsHired = snapshot.hirelingsHired;
    this._hirelingsLost = snapshot.hirelingsLost;
  }

  /** A run's tallies exactly as saved, deaths and time included — a page reload starts here. */
  static fromSnapshot(snapshot: GameStatsSnapshot): GameStats {
    const stats = new GameStats();
    stats.restore(snapshot);
    stats._deaths = snapshot.deaths;
    stats._framesPlayed = snapshot.framesPlayed;
    return stats;
  }

  /**
   * Takes the deaths and time played from the run still in progress — for a
   * death that respawns from a save, whose tallies are older than the death
   * that sent the party back to it.
   */
  carryRunHistoryFrom(live: GameStats): void {
    this._deaths = Math.max(this._deaths, live._deaths);
    this._framesPlayed = Math.max(this._framesPlayed, live._framesPlayed);
  }
}

/** Serialisable copy of a {@link GameStats}, captured at a checkpoint and written into a save. */
export interface GameStatsSnapshot {
  killsByType: Array<[string, number]>;
  potionsUsed: number;
  bossesDefeated: number;
  damageDealt: number;
  damageTaken: number;
  goldEarned: number;
  hirelingsHired: number;
  hirelingsLost: number;
  deaths: number;
  framesPlayed: number;
}

function countOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function parseKillEntry(value: unknown): [string, number] | null {
  if (!isUnknownArray(value)) return null;
  const [name, count] = value;
  if (typeof name !== 'string') return null;
  const parsedCount = countOrZero(count);
  return parsedCount > 0 ? [name, parsedCount] : null;
}

/**
 * Reads saved tallies back, or undefined when there are none to read.
 *
 * Lenient field by field: a save written before a counter existed, or with one
 * that arrived damaged, loses that one counter to zero rather than the whole
 * run's record.
 */
export function parseGameStatsSnapshot(value: unknown): GameStatsSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const killsByType: Array<[string, number]> = [];
  if (isUnknownArray(value.killsByType)) {
    for (const entry of value.killsByType) {
      const parsed = parseKillEntry(entry);
      if (parsed !== null) killsByType.push(parsed);
    }
  }
  return {
    killsByType,
    potionsUsed: countOrZero(value.potionsUsed),
    bossesDefeated: countOrZero(value.bossesDefeated),
    damageDealt: countOrZero(value.damageDealt),
    damageTaken: countOrZero(value.damageTaken),
    goldEarned: countOrZero(value.goldEarned),
    hirelingsHired: countOrZero(value.hirelingsHired),
    hirelingsLost: countOrZero(value.hirelingsLost),
    deaths: countOrZero(value.deaths),
    framesPlayed: countOrZero(value.framesPlayed),
  };
}

/** `h:mm:ss` for a count of played frames. */
export function formatPlayTime(frames: number): string {
  const totalSeconds = Math.floor(frames / UPDATE_FRAMES_PER_SECOND);
  const hours = Math.floor(totalSeconds / (SECONDS_PER_MINUTE * MINUTES_PER_HOUR));
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE) % MINUTES_PER_HOUR;
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  const mm = String(minutes).padStart(CLOCK_FIELD_WIDTH, '0');
  const ss = String(seconds).padStart(CLOCK_FIELD_WIDTH, '0');
  return `${hours}:${mm}:${ss}`;
}

/**
 * The tallies the running scene is recording into.
 *
 * A module-level binding rather than a field somebody passes around, because
 * the places that score most of these — a mob's damage door, a crawler's, a
 * coin landing in a purse, a hireling's contract — belong to objects that hold
 * no reference to any scene. Each scene binds its run's `GameStats` as it is
 * entered; every scene of one run holds the same object, so a stale binding
 * between one scene's exit and the next one's entry still points at the run.
 * Headless harnesses that never bind simply record nothing.
 */
let boundRunStats: GameStats | null = null;

export function bindRunStats(stats: GameStats | null): void {
  boundRunStats = stats;
}

export function activeRunStats(): GameStats | null {
  return boundRunStats;
}
