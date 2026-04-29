/**
 * Generic ability leveling system. Abilities gain XP on use and on kills.
 * Fully isolated from any specific ability — register AbilityDefs at startup.
 *
 * XP required to advance from level N → N+1:
 *   baseXpToLevel2 * 1.3^(N-1), except level 14→15 uses 1.8× the previous threshold.
 */

export type AbilityId = 'magic_missile';

export interface AbilityPerkDef {
  level: number;
  description: string;
}

export type AbilityOwner = 'cat' | 'human';

export interface AbilityDef {
  id: AbilityId;
  name: string;
  /** Which player this ability belongs to by default. */
  owner: AbilityOwner;
  equipInstructions: string;
  /** XP needed to advance from level 1 → 2. Later thresholds are derived. */
  baseXpToLevel2: number;
  /** XP granted each time the ability is used. */
  usageXp: number;
  /** XP granted when the ability secures a kill. */
  killXp: number;
  maxLevel: number;
  perks: AbilityPerkDef[];
  /** Draw the ability icon into a square region. Called by UI. */
  renderIcon: (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    level: number,
  ) => void;
}

export interface AbilityState {
  id: AbilityId;
  /** Which player currently owns this ability. Can change when item-granted abilities are traded. */
  owner: AbilityOwner;
  level: number;
  xp: number;
  /** XP needed to reach the next level from the current one. Infinity at max level. */
  xpToNextLevel: number;
}

function computeXpToNextLevel(currentLevel: number, baseXpToLevel2: number): number {
  if (currentLevel >= 15) return Infinity;
  let xp = baseXpToLevel2;
  for (let i = 1; i < currentLevel; i++) {
    // Level 14 → 15 costs 80% more than 13 → 14 (instead of the normal 30% step)
    xp = i === 14 ? Math.round(xp * 1.8) : Math.round(xp * 1.3);
  }
  return xp;
}

export class AbilityManager {
  private readonly defs = new Map<AbilityId, AbilityDef>();
  private readonly states = new Map<AbilityId, AbilityState>();

  /** Called each time any ability levels up. Set by the owning scene. */
  onLevelUp: ((id: AbilityId, newLevel: number) => void) | null = null;

  register(def: AbilityDef): void {
    this.defs.set(def.id, def);
    // Only initialize state on first registration — re-registering (e.g. on level
    // transition) must not wipe accumulated XP and level progress.
    if (!this.states.has(def.id)) {
      this.states.set(def.id, {
        id: def.id,
        owner: def.owner,
        level: 1,
        xp: 0,
        xpToNextLevel: computeXpToNextLevel(1, def.baseXpToLevel2),
      });
    }
  }

  private addXp(id: AbilityId, amount: number): boolean {
    const state = this.states.get(id);
    const def = this.defs.get(id);
    if (!state || !def) return false;
    if (state.level >= def.maxLevel) return false;

    state.xp += amount;
    let leveled = false;

    while (state.level < def.maxLevel && state.xp >= state.xpToNextLevel) {
      state.xp -= state.xpToNextLevel;
      state.level++;
      state.xpToNextLevel = computeXpToNextLevel(state.level, def.baseXpToLevel2);
      this.onLevelUp?.(id, state.level);
      leveled = true;
    }

    if (state.level >= def.maxLevel) {
      state.xp = 0;
      state.xpToNextLevel = Infinity;
    }

    return leveled;
  }

  addUsageXp(id: AbilityId): boolean {
    const def = this.defs.get(id);
    if (!def) return false;
    return this.addXp(id, def.usageXp);
  }

  addKillXp(id: AbilityId): boolean {
    const def = this.defs.get(id);
    if (!def) return false;
    return this.addXp(id, def.killXp);
  }

  getState(id: AbilityId): AbilityState | null {
    return this.states.get(id) ?? null;
  }

  getDef(id: AbilityId): AbilityDef | null {
    return this.defs.get(id) ?? null;
  }

  getLevel(id: AbilityId): number {
    return this.states.get(id)?.level ?? 1;
  }

  getAllRegistered(): AbilityDef[] {
    return [...this.defs.values()];
  }

  /** Return a deep clone of this manager (used to snapshot ability state at floor entry). */
  clone(): AbilityManager {
    const copy = new AbilityManager();
    for (const [id, def] of this.defs) {
      copy.defs.set(id, def);
    }
    for (const [id, state] of this.states) {
      copy.states.set(id, { ...state });
    }
    return copy;
  }
}
