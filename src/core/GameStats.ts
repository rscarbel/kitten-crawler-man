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
}
