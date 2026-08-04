export class GameStats {
  private _killsByType = new Map<string, number>();
  private _potionsUsed = 0;

  recordKill(displayName: string): void {
    this._killsByType.set(displayName, (this._killsByType.get(displayName) ?? 0) + 1);
  }

  recordPotionUsed(): void {
    this._potionsUsed++;
  }

  get totalKills(): number {
    let total = 0;
    for (const count of this._killsByType.values()) total += count;
    return total;
  }

  get killsByType(): ReadonlyMap<string, number> {
    return this._killsByType;
  }

  get potionsUsed(): number {
    return this._potionsUsed;
  }

  /** Point-in-time copy of the tallies, for a checkpoint capture. */
  snapshot(): GameStatsSnapshot {
    return { killsByType: [...this._killsByType], potionsUsed: this._potionsUsed };
  }

  /** Rewinds the tallies so kills scored after a checkpoint stop counting. */
  restore(snapshot: GameStatsSnapshot): void {
    this._killsByType = new Map(snapshot.killsByType);
    this._potionsUsed = snapshot.potionsUsed;
  }
}

/** Serialisable copy of a {@link GameStats}, captured at a checkpoint. */
export interface GameStatsSnapshot {
  killsByType: Array<[string, number]>;
  potionsUsed: number;
}
