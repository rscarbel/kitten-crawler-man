import { isNonNegativeFinite, isRecord, parseEvery } from '../util/guards';

/** A saved kill tally is a `[displayName, count]` pair. */
const KILL_ENTRY_LENGTH = 2;

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
 * a death that undid its own tally would make every death free. Whether the
 * party has heard the shield-fairy ward explainer is run history too: a
 * one-time hint that a death replayed would no longer be one-time. So is every
 * pet given to Deinonychus or a cow: the player did it, and no rewind takes it back.
 * The current floor's time played is run history for the same reason as the
 * total: only taking the stairs to a new floor starts it again.
 */
export class GameStats {
  private _killsByType = new Map<string, number>();
  private _potionsUsed = 0;
  private _bossesDefeated = 0;
  private _damageDealt = 0;
  private _damageTaken = 0;
  private _goldEarned = 0;
  private _mercenariesHired = 0;
  private _mercenariesLost = 0;
  private _deaths = 0;
  private _framesPlayed = 0;
  private _floorFramesPlayed = 0;
  private _wardExplainerHeard = false;
  private _deinonychusPets = 0;
  private _cowPets = 0;
  private _midgePets = 0;

  recordKill(displayName: string, isBoss = false): void {
    this._killsByType.set(displayName, (this._killsByType.get(displayName) ?? 0) + 1);
    if (isBoss) this._bossesDefeated++;
  }

  /**
   * Every `mobKilled` goes through here, in every scene, so a kill is counted
   * the same way everywhere.
   *
   * An ally that dies with nobody credited is not a kill: a converted mob cut
   * down by the side it deserted raises the same event, and it would otherwise
   * count as one the party slew. Nor is a death the mob itself says is no kill at all
   * (`countsAsKill`), like a cow caught in a blast.
   */
  recordMobKilled(event: {
    readonly mob: {
      readonly displayName: string;
      readonly countsAsBossKill: boolean;
      readonly isHostile: boolean;
      readonly countsAsKill: boolean;
    };
    readonly killer: object | null;
  }): void {
    const { mob, killer } = event;
    if (!mob.countsAsKill) return;
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

  recordMercenaryHired(): void {
    this._mercenariesHired++;
  }

  recordMercenaryLost(): void {
    this._mercenariesLost++;
  }

  recordDeath(): void {
    this._deaths++;
  }

  recordDeinonychusPetted(): void {
    this._deinonychusPets++;
  }

  /** Midge is a cow too, so a pet for her counts toward both tallies. */
  recordCowPetted(isMidge: boolean): void {
    this._cowPets++;
    if (isMidge) this._midgePets++;
  }

  recordWardExplainerHeard(): void {
    this._wardExplainerHeard = true;
  }

  /** One fixed update of play the world was not halted for. */
  recordPlayedFrame(): void {
    this._framesPlayed++;
    this._floorFramesPlayed++;
  }

  /** The party has arrived on a new floor, so the floor's clock starts from zero. */
  beginFloor(): void {
    this._floorFramesPlayed = 0;
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

  get mercenariesHired(): number {
    return this._mercenariesHired;
  }

  get mercenariesLost(): number {
    return this._mercenariesLost;
  }

  get deaths(): number {
    return this._deaths;
  }

  get framesPlayed(): number {
    return this._framesPlayed;
  }

  /** Played frames since the party arrived on the floor it is on. */
  get floorFramesPlayed(): number {
    return this._floorFramesPlayed;
  }

  get wardExplainerHeard(): boolean {
    return this._wardExplainerHeard;
  }

  get deinonychusPets(): number {
    return this._deinonychusPets;
  }

  get cowPets(): number {
    return this._cowPets;
  }

  get midgePets(): number {
    return this._midgePets;
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
      mercenariesHired: this._mercenariesHired,
      mercenariesLost: this._mercenariesLost,
      deaths: this._deaths,
      framesPlayed: this._framesPlayed,
      floorFramesPlayed: this._floorFramesPlayed,
      wardExplainerHeard: this._wardExplainerHeard,
      deinonychusPets: this._deinonychusPets,
      cowPets: this._cowPets,
      midgePets: this._midgePets,
    };
  }

  /**
   * Rewinds the tallies that describe the world to a checkpoint, so kills scored
   * after it stop counting. Deaths, time played and pets are left alone: see the
   * class comment.
   */
  restore(snapshot: GameStatsSnapshot): void {
    this._killsByType = new Map(snapshot.killsByType);
    this._potionsUsed = snapshot.potionsUsed;
    this._bossesDefeated = snapshot.bossesDefeated;
    this._damageDealt = snapshot.damageDealt;
    this._damageTaken = snapshot.damageTaken;
    this._goldEarned = snapshot.goldEarned;
    this._mercenariesHired = snapshot.mercenariesHired;
    this._mercenariesLost = snapshot.mercenariesLost;
  }

  /** A run's tallies exactly as saved, deaths and time included — a page reload starts here. */
  static fromSnapshot(snapshot: GameStatsSnapshot): GameStats {
    const stats = new GameStats();
    stats.restore(snapshot);
    stats._deaths = snapshot.deaths;
    stats._framesPlayed = snapshot.framesPlayed;
    stats._floorFramesPlayed = snapshot.floorFramesPlayed;
    stats._wardExplainerHeard = snapshot.wardExplainerHeard;
    stats._deinonychusPets = snapshot.deinonychusPets;
    stats._cowPets = snapshot.cowPets;
    stats._midgePets = snapshot.midgePets;
    return stats;
  }

  /**
   * Takes the deaths, time played (total and on this floor), pets and heard hints from the run still in progress — for a
   * death that respawns from a save, whose tallies are older than the death
   * that sent the party back to it.
   */
  carryRunHistoryFrom(live: GameStats): void {
    this._deaths = Math.max(this._deaths, live._deaths);
    this._framesPlayed = Math.max(this._framesPlayed, live._framesPlayed);
    this._floorFramesPlayed = Math.max(this._floorFramesPlayed, live._floorFramesPlayed);
    this._wardExplainerHeard ||= live._wardExplainerHeard;
    this._deinonychusPets = Math.max(this._deinonychusPets, live._deinonychusPets);
    this._cowPets = Math.max(this._cowPets, live._cowPets);
    this._midgePets = Math.max(this._midgePets, live._midgePets);
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
  mercenariesHired: number;
  mercenariesLost: number;
  deaths: number;
  framesPlayed: number;
  floorFramesPlayed: number;
  wardExplainerHeard: boolean;
  deinonychusPets: number;
  cowPets: number;
  midgePets: number;
}

function parseKillEntry(value: unknown): [string, number] | undefined {
  if (!Array.isArray(value) || value.length !== KILL_ENTRY_LENGTH) return undefined;
  const name: unknown = value[0];
  const count: unknown = value[1];
  if (typeof name !== 'string' || !isNonNegativeFinite(count) || count === 0) return undefined;
  return [name, count];
}

/** Saved tallies read back, or undefined when any one of them is missing or damaged. */
export function parseGameStatsSnapshot(value: unknown): GameStatsSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const killsByType = parseEvery(value.killsByType, parseKillEntry);
  const {
    potionsUsed,
    bossesDefeated,
    damageDealt,
    damageTaken,
    goldEarned,
    mercenariesHired,
    mercenariesLost,
    deaths,
    framesPlayed,
    floorFramesPlayed,
    wardExplainerHeard,
    deinonychusPets,
    cowPets,
    midgePets,
  } = value;
  if (
    killsByType === undefined ||
    !isNonNegativeFinite(potionsUsed) ||
    !isNonNegativeFinite(bossesDefeated) ||
    !isNonNegativeFinite(damageDealt) ||
    !isNonNegativeFinite(damageTaken) ||
    !isNonNegativeFinite(goldEarned) ||
    !isNonNegativeFinite(mercenariesHired) ||
    !isNonNegativeFinite(mercenariesLost) ||
    !isNonNegativeFinite(deaths) ||
    !isNonNegativeFinite(framesPlayed) ||
    !isNonNegativeFinite(floorFramesPlayed) ||
    typeof wardExplainerHeard !== 'boolean' ||
    !isNonNegativeFinite(deinonychusPets) ||
    !isNonNegativeFinite(cowPets) ||
    !isNonNegativeFinite(midgePets)
  ) {
    return undefined;
  }
  return {
    killsByType,
    potionsUsed,
    bossesDefeated,
    damageDealt,
    damageTaken,
    goldEarned,
    mercenariesHired,
    mercenariesLost,
    deaths,
    framesPlayed,
    floorFramesPlayed,
    wardExplainerHeard,
    deinonychusPets,
    cowPets,
    midgePets,
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
 * coin landing in a purse, a mercenary's contract — belong to objects that hold
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
