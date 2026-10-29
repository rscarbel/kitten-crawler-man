/**
 * Trainable crawler skills.
 *
 * Modelled on {@link AbilityManager}, with two deliberate differences:
 * skills are **not granted** — every one starts locked and has to be
 * found in the dungeon (skill book, tattoo, quest reward) — and they progress by
 * **use count** rather than XP, so a skill improves because you leaned on it.
 *
 * Acquisition channels all funnel through {@link SkillManager.unlockSkill}, which
 * doubles as the duplicate-book rule: unlocking a skill you already know raises
 * its level instead of wasting the drop.
 */

import {
  PROFICIENCY_BASE_USES,
  PROFICIENCY_MAX_LEVEL,
  PROFICIENCY_USES_EXPONENT,
  proficiencyEffect,
  type ProficiencySkillId,
} from './proficiency';

/** Uses needed to reach level 2. */
export const SKILL_BASE_USES_TO_LEVEL = 10;
/** Geometric growth applied to the use threshold at each level. */
export const SKILL_USES_GROWTH_RATE = 1.6;
/** Ceiling shared by every skill that is not a proficiency. */
export const SKILL_MAX_LEVEL = 5;

/** The skills that train on a short geometric curve to {@link SKILL_MAX_LEVEL}. */
export type StandardSkillId =
  'nine_lives' | 'warp_speed' | 'pugilism' | 'iron_stomach' | 'powerful_strike';

export type SkillId = StandardSkillId | ProficiencySkillId;

/** The two playable crawlers, for skill eligibility. */
export type CrawlerKind = 'cat' | 'human';

/** Both crawlers, the human first. */
export const CRAWLER_KINDS = ['human', 'cat'] as const satisfies readonly CrawlerKind[];

/** Which crawler a skill can be used by. */
export type SkillOwner = CrawlerKind | 'both';

interface SkillDefBase<Id extends SkillId> {
  readonly id: Id;
  readonly name: string;
  /** In-fiction blurb, shown on the Skills tab card. */
  readonly flavor: string;
  /** What the skill does right now, given its current level. */
  readonly describeEffect: (level: number) => string;
  readonly eligibleFor: SkillOwner;
}

interface StandardSkillDef<Id extends SkillId = StandardSkillId> extends SkillDefBase<Id> {
  readonly progression: 'standard';
  readonly maxLevel: typeof SKILL_MAX_LEVEL;
}

interface ProficiencySkillDef<Id extends SkillId = ProficiencySkillId> extends SkillDefBase<Id> {
  readonly progression: 'proficiency';
  readonly maxLevel: typeof PROFICIENCY_MAX_LEVEL;
}

export type SkillDef = StandardSkillDef<SkillId> | ProficiencySkillDef<SkillId>;

/** Each skill's definition, its progression fixed by which kind of skill it is. */
type SkillDefTable = {
  readonly [Id in SkillId]: Id extends ProficiencySkillId
    ? ProficiencySkillDef<Id>
    : StandardSkillDef<Id>;
};

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

/** Wall-clock recharge between 9 Lives saves at level 1. */
export const NINE_LIVES_RECHARGE_MS = 240_000;
/** Each level shaves this much off the recharge. */
export const NINE_LIVES_RECHARGE_REDUCTION_PER_LEVEL_MS = 30_000;
/** Recharge never drops below this, however many levels are banked. */
export const NINE_LIVES_MIN_RECHARGE_MS = 120_000;
/** Invulnerability after a 9 Lives save, so the next frame's hit can't finish the job. */
export const NINE_LIVES_IFRAME_FRAMES = 90;

/** Flat dodge chance Warp Speed adds per level, on top of the evasiveness curve. */
export const WARP_SPEED_DODGE_BONUS_PER_LEVEL = 0.02;

/** Melee damage Pugilism adds per level. */
export const PUGILISM_DAMAGE_PER_LEVEL = 1;

/** Fraction shaved off the potion cooldown per Iron Stomach level. */
export const IRON_STOMACH_COOLDOWN_REDUCTION_PER_LEVEL = 0.1;

/** Chance per Powerful Strike level that a melee hit lands for double. */
export const POWERFUL_STRIKE_CHANCE_PER_LEVEL = 0.04;
/** What a Powerful Strike multiplies the blow by when it fires. */
export const POWERFUL_STRIKE_DAMAGE_MULTIPLIER = 2;

/** Recharge in milliseconds between 9 Lives saves at the given skill level. */
export function nineLivesRechargeMs(level: number): number {
  const reduced = NINE_LIVES_RECHARGE_MS - (level - 1) * NINE_LIVES_RECHARGE_REDUCTION_PER_LEVEL_MS;
  return Math.max(NINE_LIVES_MIN_RECHARGE_MS, reduced);
}

/** A proficiency's effect at `level`, as a whole percentage for a card or a toast. */
function proficiencyPercent(level: number): number {
  return Math.round(proficiencyEffect(level) * PERCENT);
}

const STANDARD = { progression: 'standard', maxLevel: SKILL_MAX_LEVEL } as const;
const PROFICIENCY = { progression: 'proficiency', maxLevel: PROFICIENCY_MAX_LEVEL } as const;

const SKILL_DEFS: SkillDefTable = {
  nine_lives: {
    id: 'nine_lives',
    name: '9 Lives',
    flavor: 'A cat is owed nine. Nobody said they come back quickly.',
    describeEffect: (level) =>
      `Survive one fatal blow at 1 HP, then recharge for ${Math.round(nineLivesRechargeMs(level) / MS_PER_SECOND)}s.`,
    ...STANDARD,
    eligibleFor: 'cat',
  },
  warp_speed: {
    id: 'warp_speed',
    name: 'Warp Speed',
    flavor: 'Caroline logged the movement as a rendering error and let it stand.',
    describeEffect: (level) =>
      `+${Math.round(WARP_SPEED_DODGE_BONUS_PER_LEVEL * level * PERCENT)}% dodge chance.`,
    ...STANDARD,
    eligibleFor: 'cat',
  },
  pugilism: {
    id: 'pugilism',
    name: 'Pugilism',
    flavor: 'Formalised hitting. The paperwork is the fist.',
    describeEffect: (level) => `+${PUGILISM_DAMAGE_PER_LEVEL * level} melee damage.`,
    ...STANDARD,
    eligibleFor: 'human',
  },
  powerful_strike: {
    id: 'powerful_strike',
    name: 'Powerful Strike',
    flavor: 'Every so often the whole arm agrees with itself.',
    describeEffect: (level) =>
      `${Math.round(POWERFUL_STRIKE_CHANCE_PER_LEVEL * level * PERCENT)}% chance for a melee hit to land double damage.`,
    ...STANDARD,
    eligibleFor: 'human',
  },
  iron_stomach: {
    id: 'iron_stomach',
    name: 'Iron Stomach',
    flavor: 'You have eaten worse. Caroline keeps a record.',
    describeEffect: (level) =>
      `Potions recharge ${Math.round(IRON_STOMACH_COOLDOWN_REDUCTION_PER_LEVEL * level * PERCENT)}% faster, and drink sooner wears off.`,
    ...STANDARD,
    eligibleFor: 'both',
  },
  swordsmanship: {
    id: 'swordsmanship',
    name: 'Swordsmanship',
    flavor: 'The pointy end goes in the other one. Everything after that is refinement.',
    describeEffect: (level) => `+${proficiencyPercent(level)}% damage with swords.`,
    ...PROFICIENCY,
    eligibleFor: 'human',
  },
  archery: {
    id: 'archery',
    name: 'Archery',
    flavor: 'Pull, breathe, let go. The breathing is optional. The letting go is not.',
    describeEffect: (level) =>
      `+${proficiencyPercent(level)}% damage with slings, bows and crossbows.`,
    ...PROFICIENCY,
    eligibleFor: 'both',
  },
  clawmanship: {
    id: 'clawmanship',
    name: 'Clawmanship',
    flavor: 'Eighteen claws, and a growing sense of what each one is for.',
    describeEffect: (level) => `+${proficiencyPercent(level)}% damage with worn claws.`,
    ...PROFICIENCY,
    eligibleFor: 'cat',
  },
  magic_eye: {
    id: 'magic_eye',
    name: 'Magic Eye',
    flavor: 'You start to see where a spell wants to go, and you let it.',
    describeEffect: (level) => `+${proficiencyPercent(level)}% magic damage.`,
    ...PROFICIENCY,
    eligibleFor: 'both',
  },
  mechanical_fist: {
    id: 'mechanical_fist',
    name: 'Mechanical Fist',
    flavor: 'The gauntlet knows the technique. You are the delivery mechanism.',
    describeEffect: (level) => `+${proficiencyPercent(level)}% damage with gauntlets.`,
    ...PROFICIENCY,
    eligibleFor: 'human',
  },
  blunt_proficiency: {
    id: 'blunt_proficiency',
    name: 'Blunt Proficiency',
    flavor: 'No edge to keep and no point to lose. Just the heavy end, and where it lands.',
    describeEffect: (level) =>
      `+${proficiencyPercent(level)}% physical damage with staves and blunt weapons.`,
    ...PROFICIENCY,
    eligibleFor: 'both',
  },
  pyros_touch: {
    id: 'pyros_touch',
    name: "Pyro's Touch",
    flavor: 'Fire stops being something that happens to you and starts being something you do.',
    describeEffect: (level) =>
      `+${proficiencyPercent(level)}% fire damage, and burns on you end ${proficiencyPercent(level)}% sooner.`,
    ...PROFICIENCY,
    eligibleFor: 'both',
  },
  demolitionist: {
    id: 'demolitionist',
    name: 'Demolitionist',
    flavor: 'Stand where the blast is not. Then make the blast bigger.',
    describeEffect: (level) =>
      `+${proficiencyPercent(level)}% explosion damage, and your own blasts hurt your party ${proficiencyPercent(level)}% less.`,
    ...PROFICIENCY,
    eligibleFor: 'both',
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
  switch (def.progression) {
    case 'standard':
      return Math.round(SKILL_BASE_USES_TO_LEVEL * SKILL_USES_GROWTH_RATE ** (level - 1));
    case 'proficiency':
      return Math.round(PROFICIENCY_BASE_USES * level ** PROFICIENCY_USES_EXPONENT);
    default: {
      const unhandled: never = def;
      return unhandled;
    }
  }
}

/** True if `owner` is allowed to carry the skill at all. */
export function isEligible(def: SkillDef, owner: CrawlerKind): boolean {
  return def.eligibleFor === 'both' || def.eligibleFor === owner;
}

export class SkillManager {
  /** Only unlocked skills have an entry — an absent key means "not discovered". */
  private readonly states = new Map<SkillId, SkillState>();

  /**
   * When > 0, `isUnlocked`/`getLevel` report every eligible skill as unlocked
   * and at min(godModeMinLevel, that skill's own maxLevel). Real state is
   * untouched, so turning this back to 0 (god mode off) reverts every skill to
   * whatever the crawler actually earned. Mirrors `AbilityManager`'s overlay.
   */
  private godModeMinLevel = 0;

  /**
   * Which crawler this manager belongs to, or null for anything that isn't a
   * crawler (mobs and NPCs also extend `Player`). Eligibility is enforced here
   * rather than at each acquisition channel so a channel added later — a quest
   * reward, a reward chest — cannot forget the check.
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
    return this.states.has(id) || this.godModeOverlayLevel(id) > 0;
  }

  /** Current level, or 0 when the skill is still locked. Includes the god-mode overlay, if any. */
  getLevel(id: SkillId): number {
    return Math.max(this.getRealLevel(id), this.godModeOverlayLevel(id));
  }

  /**
   * The stored level, ignoring the god-mode overlay — what the crawler actually
   * earned. Anything that pays out for reaching a level has to read this, or a
   * cheat hands out the reward.
   */
  getRealLevel(id: SkillId): number {
    return this.states.get(id)?.level ?? 0;
  }

  private godModeOverlayLevel(id: SkillId): number {
    if (this.godModeMinLevel <= 0) return 0;
    if (this.owner === null || !isEligible(SKILL_DEFS[id], this.owner)) return 0;
    return Math.min(this.godModeMinLevel, SKILL_DEFS[id].maxLevel);
  }

  /** Override the effective level floor for every eligible skill (god mode). Pass 0 to clear. */
  setGodModeMinLevel(minLevel: number): void {
    this.godModeMinLevel = minLevel;
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

  /** Announce a skill firing (e.g. 9 Lives catching a fatal blow). */
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
   * that doesn't come from {@link unlockSkill}. A snapshot naming a cat-only
   * skill must not hand it to the human.
   */
  restoreStates(states: ReadonlyArray<SkillState>): void {
    this.states.clear();
    for (const saved of states) {
      const def = SKILL_DEFS[saved.id];
      if (this.owner === null || !isEligible(def, this.owner)) continue;
      this.states.set(saved.id, {
        id: saved.id,
        level: Math.min(saved.level, def.maxLevel),
        usesTowardNext: saved.usesTowardNext,
      });
    }
  }
}
