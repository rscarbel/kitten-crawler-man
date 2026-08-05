/**
 * Trainable crawler skills.
 *
 * Modelled on {@link AbilityManager}, with two deliberate differences drawn from
 * the books: skills are **not granted** — every one starts locked and has to be
 * found in the dungeon (skill book, tattoo, quest reward) — and they progress by
 * **use count** rather than XP, so a skill improves because you leaned on it.
 *
 * Acquisition channels all funnel through {@link SkillManager.unlockSkill}, which
 * doubles as the duplicate-book rule: unlocking a skill you already know raises
 * its level instead of wasting the drop.
 */

/** Uses needed to reach level 2. */
export const SKILL_BASE_USES_TO_LEVEL = 10;
/** Geometric growth applied to the use threshold at each level. */
export const SKILL_USES_GROWTH_RATE = 1.6;
/** Ceiling shared by the whole initial roster. */
export const SKILL_MAX_LEVEL = 5;

export type SkillId = 'cockroach' | 'cat_reflexes' | 'pugilism' | 'iron_stomach' | 'night_vision';

/** The two playable crawlers, for skill eligibility. */
export type CrawlerKind = 'cat' | 'human';

/** Which crawler a skill can be used by. */
export type SkillOwner = CrawlerKind | 'both';

export interface SkillDef {
  id: SkillId;
  name: string;
  /** In-fiction blurb, shown on the Skills tab card. */
  flavor: string;
  /** What the skill does right now, given its current level. */
  describeEffect: (level: number) => string;
  maxLevel: number;
  eligibleFor: SkillOwner;
}

export interface SkillState {
  id: SkillId;
  level: number;
  usesTowardNext: number;
}

/** Outcome of pointing an acquisition channel at a skill. */
export type SkillUnlockResult = 'unlocked' | 'leveled' | 'already_max' | 'not_eligible';

/** Something worth announcing that happened to a skill. */
export interface SkillEvent {
  kind: 'unlocked' | 'leveled' | 'triggered';
  id: SkillId;
  level: number;
}

/** Ceiling on undrained events, so a scene that never drains them can't leak. */
const MAX_PENDING_EVENTS = 8;

// ── Per-skill tuning ─────────────────────────────────────────────────────────

const MS_PER_SECOND = 1000;
/** Turns a 0–1 fraction into a percentage for display. */
const PERCENT = 100;

/** Wall-clock recharge between Cockroach saves at level 1. */
export const COCKROACH_RECHARGE_MS = 240_000;
/** Each level shaves this much off the recharge. */
export const COCKROACH_RECHARGE_REDUCTION_PER_LEVEL_MS = 30_000;
/** Recharge never drops below this, however many levels are banked. */
export const COCKROACH_MIN_RECHARGE_MS = 120_000;
/** Invulnerability after a Cockroach save, so the next frame's hit can't finish the job. */
export const COCKROACH_IFRAME_FRAMES = 90;

/** Flat dodge chance Cat-like Reflexes adds per level, on top of the dexterity curve. */
export const CAT_REFLEXES_DODGE_BONUS_PER_LEVEL = 0.02;

/** Melee damage Pugilism adds per level. */
export const PUGILISM_DAMAGE_PER_LEVEL = 1;

/** Fraction shaved off the potion cooldown per Iron Stomach level. */
export const IRON_STOMACH_COOLDOWN_REDUCTION_PER_LEVEL = 0.1;

/** Extra fog radius Night Vision grants at level 1. */
export const NIGHT_VISION_BONUS_TILES = 8;
/** Each level past the first widens the view by one more tile. */
export const NIGHT_VISION_BONUS_TILES_PER_EXTRA_LEVEL = 1;
/** Night Vision levels slowly (one use per floor cleared), so it tops out early. */
export const NIGHT_VISION_MAX_LEVEL = 3;

/** Recharge in milliseconds between Cockroach saves at the given skill level. */
export function cockroachRechargeMs(level: number): number {
  const reduced = COCKROACH_RECHARGE_MS - (level - 1) * COCKROACH_RECHARGE_REDUCTION_PER_LEVEL_MS;
  return Math.max(COCKROACH_MIN_RECHARGE_MS, reduced);
}

/** Extra fog radius, in tiles, granted by Night Vision at the given level. */
export function nightVisionBonusTiles(level: number): number {
  return NIGHT_VISION_BONUS_TILES + (level - 1) * NIGHT_VISION_BONUS_TILES_PER_EXTRA_LEVEL;
}

const SKILL_DEFS: Record<SkillId, SkillDef> = {
  cockroach: {
    id: 'cockroach',
    name: 'Cockroach',
    flavor: 'Hard to kill. Harder to be rid of. The dungeon has tried both.',
    describeEffect: (level) =>
      `Survive one fatal blow at 1 HP, then recharge for ${Math.round(cockroachRechargeMs(level) / MS_PER_SECOND)}s.`,
    maxLevel: SKILL_MAX_LEVEL,
    eligibleFor: 'cat',
  },
  cat_reflexes: {
    id: 'cat_reflexes',
    name: 'Cat-like Reflexes',
    flavor: 'The System filed this under "redundant" and approved it anyway.',
    describeEffect: (level) =>
      `+${Math.round(CAT_REFLEXES_DODGE_BONUS_PER_LEVEL * level * PERCENT)}% dodge chance.`,
    maxLevel: SKILL_MAX_LEVEL,
    eligibleFor: 'cat',
  },
  pugilism: {
    id: 'pugilism',
    name: 'Pugilism',
    flavor: 'Formalised hitting. The paperwork is the fist.',
    describeEffect: (level) => `+${PUGILISM_DAMAGE_PER_LEVEL * level} melee damage.`,
    maxLevel: SKILL_MAX_LEVEL,
    eligibleFor: 'human',
  },
  iron_stomach: {
    id: 'iron_stomach',
    name: 'Iron Stomach',
    flavor: 'You have eaten worse. The System has the footage.',
    describeEffect: (level) =>
      `Potions recharge ${Math.round(IRON_STOMACH_COOLDOWN_REDUCTION_PER_LEVEL * level * PERCENT)}% faster, and drink sooner wears off.`,
    maxLevel: SKILL_MAX_LEVEL,
    eligibleFor: 'both',
  },
  night_vision: {
    id: 'night_vision',
    name: 'Night Vision',
    flavor: 'The dark was never the problem. It was what stood in it.',
    describeEffect: (level) => `See ${nightVisionBonusTiles(level)} tiles further in the dark.`,
    maxLevel: NIGHT_VISION_MAX_LEVEL,
    eligibleFor: 'cat',
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export const SKILL_IDS: ReadonlyArray<SkillId> = Object.keys(SKILL_DEFS).filter(isSkillId);

export function isSkillId(value: string): value is SkillId {
  return Object.prototype.hasOwnProperty.call(SKILL_DEFS, value);
}

export function getSkillDef(id: SkillId): SkillDef {
  return SKILL_DEFS[id];
}

/** Uses needed to advance from `level` to the next, or Infinity at the ceiling. */
export function usesToNextLevel(def: SkillDef, level: number): number {
  if (level >= def.maxLevel) return Infinity;
  return Math.round(SKILL_BASE_USES_TO_LEVEL * Math.pow(SKILL_USES_GROWTH_RATE, level - 1));
}

/** True if `owner` is allowed to carry the skill at all. */
export function isEligible(def: SkillDef, owner: CrawlerKind): boolean {
  return def.eligibleFor === 'both' || def.eligibleFor === owner;
}

export class SkillManager {
  /** Only unlocked skills have an entry — an absent key means "not discovered". */
  private readonly states = new Map<SkillId, SkillState>();

  /**
   * Which crawler this manager belongs to, or null for anything that isn't a
   * crawler (mobs and NPCs also extend `Player`). Eligibility is enforced here
   * rather than at each acquisition channel so a channel added later — a quest
   * reward, a loot box — cannot forget the check.
   */
  constructor(private readonly owner: CrawlerKind | null) {}

  /**
   * Skill happenings awaiting pickup by the scene's notice system. Queued rather
   * than emitted because a `SkillManager` belongs to a `Player`, which has no
   * event bus in scope.
   */
  readonly pendingEvents: SkillEvent[] = [];

  private queueEvent(event: SkillEvent): void {
    if (this.pendingEvents.length >= MAX_PENDING_EVENTS) return;
    this.pendingEvents.push(event);
  }

  /** True once the skill has been found; every effect is gated on this. */
  isUnlocked(id: SkillId): boolean {
    return this.states.has(id);
  }

  /** Current level, or 0 when the skill is still locked. */
  getLevel(id: SkillId): number {
    return this.states.get(id)?.level ?? 0;
  }

  /** Every skill this crawler has discovered, in roster order. */
  unlockedStates(): SkillState[] {
    const result: SkillState[] = [];
    for (const id of SKILL_IDS) {
      const state = this.states.get(id);
      if (state) result.push({ ...state });
    }
    return result;
  }

  /**
   * The single entry point for every acquisition channel (skill book, tattoo,
   * quest reward). A skill already known levels up instead — that is what keeps
   * a duplicate book from being dead loot.
   */
  unlockSkill(id: SkillId): SkillUnlockResult {
    const outcome = this.previewUnlock(id);
    if (outcome === 'not_eligible' || outcome === 'already_max') return outcome;

    const existing = this.states.get(id);
    if (!existing) {
      this.states.set(id, { id, level: 1, usesTowardNext: 0 });
      this.queueEvent({ kind: 'unlocked', id, level: 1 });
      return 'unlocked';
    }
    existing.level++;
    existing.usesTowardNext = 0;
    this.queueEvent({ kind: 'leveled', id, level: existing.level });
    return 'leveled';
  }

  /**
   * What {@link unlockSkill} would return right now, changing nothing.
   * Lets an acquisition channel refuse — and keep its price or its item —
   * before anything is mutated.
   */
  previewUnlock(id: SkillId): SkillUnlockResult {
    const def = SKILL_DEFS[id];
    if (this.owner === null || !isEligible(def, this.owner)) return 'not_eligible';
    const existing = this.states.get(id);
    if (!existing) return 'unlocked';
    return existing.level >= def.maxLevel ? 'already_max' : 'leveled';
  }

  /**
   * Credit one successful use. No-op for a locked skill.
   * @returns whether the use pushed the skill to a new level.
   */
  recordUse(id: SkillId): boolean {
    const state = this.states.get(id);
    if (!state) return false;
    const def = SKILL_DEFS[id];
    if (state.level >= def.maxLevel) return false;

    state.usesTowardNext++;
    let leveled = false;
    while (
      state.level < def.maxLevel &&
      state.usesTowardNext >= usesToNextLevel(def, state.level)
    ) {
      state.usesTowardNext -= usesToNextLevel(def, state.level);
      state.level++;
      this.queueEvent({ kind: 'leveled', id, level: state.level });
      leveled = true;
    }
    if (state.level >= def.maxLevel) state.usesTowardNext = 0;
    return leveled;
  }

  /** Announce a skill firing (e.g. Cockroach catching a fatal blow). */
  recordTrigger(id: SkillId): void {
    const state = this.states.get(id);
    if (!state) return;
    this.queueEvent({ kind: 'triggered', id, level: state.level });
  }

  /** Serialisable state for `PlayerSnapshot`. */
  snapshotStates(): SkillState[] {
    return [...this.states.values()].map((s) => ({ ...s }));
  }

  /**
   * Restore from {@link snapshotStates}, discarding anything already unlocked.
   *
   * Eligibility is re-checked, not assumed: this is the one door into `states`
   * that doesn't come from {@link unlockSkill}, and it is fed by unvalidated save
   * JSON. A snapshot naming a cat-only skill must not hand it to the human.
   */
  restoreStates(states: ReadonlyArray<SkillState>): void {
    this.states.clear();
    for (const saved of states) {
      if (!isSkillId(saved.id)) continue;
      const def = SKILL_DEFS[saved.id];
      if (this.owner === null || !isEligible(def, this.owner)) continue;
      // `Math.min(NaN, …)` is NaN, and a NaN cockroach level yields a NaN
      // recharge deadline that reads as permanently-not-ready — so screen the
      // numerics as well as the id.
      const level = Number.isFinite(saved.level) ? saved.level : 1;
      const uses = Number.isFinite(saved.usesTowardNext) ? saved.usesTowardNext : 0;
      this.states.set(saved.id, {
        id: saved.id,
        level: Math.max(1, Math.min(level, def.maxLevel)),
        usesTowardNext: Math.max(0, uses),
      });
    }
  }
}
