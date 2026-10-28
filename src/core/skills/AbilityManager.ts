/**
 * Generic ability leveling system. Abilities gain XP on use and on kills.
 * Fully isolated from any specific ability — register AbilityDefs at startup.
 *
 * XP required to advance from level N → N+1:
 *   baseXpToLevel2 * xpGrowthRate^(N-1),
 *   except the final level transition uses finalLevelMultiplier instead of xpGrowthRate.
 * Both fields have per-ability overrides; defaults are 1.3 and 1.8 respectively.
 */

import type { WeaponDelivery } from '../items/equipment/weapons';
import {
  computeXpToNextLevel,
  DEFAULT_XP_GROWTH_RATE,
  DEFAULT_FINAL_LEVEL_MULTIPLIER,
} from '../progression/xpCurve';
import type { Rect } from '../../ui/core/geom';
import type { PetNames } from '../party/petNames';
import { isFiniteNumber, isRecord, ownEntry, parseEvery } from '../util/guards';

export type AbilityId = 'magic_missile' | 'energy_shield' | 'seismic_stomp' | 'deinonychus';

/**
 * Every `AbilityId`, as a value. Typed as a total `Record` so adding an id to
 * the union without listing it here fails to compile — a missing entry silently
 * hides that ability's tome from the Abilities menu.
 */
const ABILITY_IDS: Record<AbilityId, true> = {
  magic_missile: true,
  energy_shield: true,
  seismic_stomp: true,
  deinonychus: true,
};

/** Narrows an item's free-form `abilityId` to one the manager knows about. */
export function isAbilityId(id: string): id is AbilityId {
  return ownEntry(ABILITY_IDS, id) !== undefined;
}

/**
 * A perk's text: fixed, or read at display time from the run's pet names for
 * an ability that speaks of a pet the player has named.
 */
export type PerkText = string | ((petNames: PetNames) => string);

export interface AbilityPerkDef {
  level: number;
  description: PerkText;
}

/** `text` as the player reads it now. */
export function perkText(text: PerkText, petNames: PetNames): string {
  return typeof text === 'string' ? text : text(petNames);
}

export type AbilityOwner = 'cat' | 'human';

/** Narrows an owner arriving from a save, where the declared type proves nothing. */
export function isAbilityOwner(value: string): value is AbilityOwner {
  return value === 'cat' || value === 'human';
}

export interface AbilityDef {
  id: AbilityId;
  name: string;
  /** Which player this ability belongs to by default. */
  owner: AbilityOwner;
  /** How its damage leaves the caster, which names the stat it grows with; null for none. */
  delivery: WeaponDelivery | null;
  /**
   * Short badge shown beside the owner in the Abilities list, e.g. `PET`.
   *
   * Only for abilities that do not work like the others — the badge exists to
   * warn a player that hunting for this one's tome is wasted effort.
   */
  tag?: string;
  equipInstructions: string;
  /** XP needed to advance from level 1 → 2. Later thresholds are derived. */
  baseXpToLevel2: number;
  /**
   * Multiplier applied to the threshold each level. Defaults to 1.3.
   * Higher = slower leveling at higher levels.
   */
  xpGrowthRate?: number;
  /**
   * Multiplier used for the final level transition (maxLevel-1 → maxLevel)
   * instead of xpGrowthRate. Defaults to 1.8.
   */
  finalLevelMultiplier?: number;
  /** XP granted each time the ability is used. */
  usageXp: number;
  /** XP granted when the ability secures a kill. */
  killXp: number;
  maxLevel: number;
  perks: AbilityPerkDef[];
  /** Draw the ability icon into the largest square centred in `rect`. Called by UI. */
  renderIcon: (ctx: CanvasRenderingContext2D, rect: Rect, level: number) => void;
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

/**
 * {@link AbilityState} as it is written to a save — the JSON-safe subset.
 *
 * Ability progress is shared by both crawlers, so it rides on `GameProgress`
 * rather than on either `PlayerSnapshot`.
 */
export type SerializedAbilityState = Omit<AbilityState, 'xpToNextLevel'>;

function xpToNextLevel(def: AbilityDef, currentLevel: number): number {
  return computeXpToNextLevel(
    currentLevel,
    def.baseXpToLevel2,
    def.xpGrowthRate ?? DEFAULT_XP_GROWTH_RATE,
    def.finalLevelMultiplier ?? DEFAULT_FINAL_LEVEL_MULTIPLIER,
    def.maxLevel,
  );
}

export class AbilityManager {
  private readonly defs = new Map<AbilityId, AbilityDef>();
  private readonly states = new Map<AbilityId, AbilityState>();
  /**
   * When > 0, getLevel() returns max(realLevel, godModeMinLevel). XP and real
   * levels still accumulate normally — this is a display/gameplay overlay only.
   * Set to 0 to remove the overlay (e.g. when god mode is disabled).
   */
  private godModeMinLevel = 0;

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
        xpToNextLevel: xpToNextLevel(def, 1),
      });
    }
  }

  private grantXp(id: AbilityId, amount: number): boolean {
    const state = this.states.get(id);
    const def = this.defs.get(id);
    if (!state || !def) return false;
    if (state.level >= def.maxLevel) return false;

    state.xp += amount;
    let leveled = false;

    while (state.level < def.maxLevel && state.xp >= state.xpToNextLevel) {
      state.xp -= state.xpToNextLevel;
      state.level++;
      state.xpToNextLevel = xpToNextLevel(def, state.level);
      this.onLevelUp?.(id, state.level);
      leveled = true;
    }

    if (state.level >= def.maxLevel) {
      state.xp = 0;
      state.xpToNextLevel = Infinity;
    }

    return leveled;
  }

  /** Add raw XP directly to an ability (e.g. from per-touch or per-frame interactions). */
  addXp(id: AbilityId, amount: number): boolean {
    return this.grantXp(id, amount);
  }

  addUsageXp(id: AbilityId): boolean {
    const def = this.defs.get(id);
    if (!def) return false;
    return this.grantXp(id, def.usageXp);
  }

  addKillXp(id: AbilityId): boolean {
    const def = this.defs.get(id);
    if (!def) return false;
    return this.grantXp(id, def.killXp);
  }

  getState(id: AbilityId): AbilityState | null {
    return this.states.get(id) ?? null;
  }

  getDef(id: AbilityId): AbilityDef | null {
    return this.defs.get(id) ?? null;
  }

  getLevel(id: AbilityId): number {
    return Math.max(this.getRealLevel(id), this.godModeMinLevel);
  }

  /**
   * The stored level, ignoring the god-mode floor — what the player actually
   * earned. Anything that pays out for reaching a level has to read this, or a
   * cheat hands out the reward.
   */
  getRealLevel(id: AbilityId): number {
    return this.states.get(id)?.level ?? 1;
  }

  /** Override the effective level floor for all abilities (god mode). Pass 0 to clear. */
  setGodModeMinLevel(minLevel: number): void {
    this.godModeMinLevel = minLevel;
  }

  getAllRegistered(): AbilityDef[] {
    return [...this.defs.values()];
  }

  /** Directly set ability level, bypassing XP. Does not fire onLevelUp. */
  setLevel(id: AbilityId, level: number): void {
    const state = this.states.get(id);
    const def = this.defs.get(id);
    if (!state || !def) return;
    const clamped = Math.max(1, Math.min(level, def.maxLevel));
    state.level = clamped;
    state.xp = 0;
    state.xpToNextLevel = xpToNextLevel(def, clamped);
  }

  /** Snapshot current ability states for later restoration. */
  snapshotStates(): Map<AbilityId, AbilityState> {
    const snap = new Map<AbilityId, AbilityState>();
    for (const [id, state] of this.states) {
      snap.set(id, { ...state });
    }
    return snap;
  }

  /** Restore ability states from a snapshot produced by snapshotStates(). */
  restoreStates(snap: Map<AbilityId, AbilityState>): void {
    for (const [id, saved] of snap) {
      this.states.set(id, { ...saved });
    }
  }

  /**
   * Ability progress in the flat form the save payload carries.
   *
   * An array rather than {@link snapshotStates}' Map because this one crosses
   * `JSON.stringify`, and a Map serialises to `{}`. `xpToNextLevel` is left out
   * for the same reason — it is `Infinity` at max level, which JSON writes as
   * `null` — so {@link restoreSerializedStates} re-derives it from the def.
   */
  serializeStates(): SerializedAbilityState[] {
    return [...this.states.values()].map(({ id, owner, level, xp }) => ({ id, owner, level, xp }));
  }

  /**
   * Restore progress written by {@link serializeStates}, already validated by
   * {@link parseSerializedAbilityStates}. Registration must have happened
   * first: an ability with no def has no maxLevel to clamp against. An ability
   * the save doesn't mention keeps its level-1 default.
   */
  restoreSerializedStates(states: readonly SerializedAbilityState[]): void {
    for (const saved of states) {
      const def = this.defs.get(saved.id);
      if (def === undefined) continue;
      const clampedLevel = Math.min(saved.level, def.maxLevel);
      this.states.set(saved.id, {
        id: saved.id,
        owner: saved.owner,
        level: clampedLevel,
        xp: clampedLevel >= def.maxLevel ? 0 : saved.xp,
        xpToNextLevel: xpToNextLevel(def, clampedLevel),
      });
    }
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

function parseSerializedAbilityState(value: unknown): SerializedAbilityState | undefined {
  if (!isRecord(value)) return undefined;
  const { id, owner, level, xp } = value;
  if (typeof id !== 'string' || !isAbilityId(id)) return undefined;
  if (typeof owner !== 'string' || !isAbilityOwner(owner)) return undefined;
  if (!isFiniteNumber(level) || level < 1 || !isFiniteNumber(xp) || xp < 0) return undefined;
  return { id, owner, level, xp };
}

/** A save's ability progress, or undefined when any entry is not one this build wrote. */
export function parseSerializedAbilityStates(value: unknown): SerializedAbilityState[] | undefined {
  return parseEvery(value, parseSerializedAbilityState);
}
