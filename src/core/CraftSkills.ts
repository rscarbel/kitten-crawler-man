/**
 * Per-crawler craft progression: Resourcing (harvesting wood and stone) and
 * Construction (building and repairing village structures).
 *
 * Modelled on {@link SkillManager}: each crawler owns its own instance, XP
 * earned by one never touches the other's state, and a skill has to be taught
 * before it does anything. Unlike the trainable skills, both craft skills are
 * taught to both crawlers in the same moment — {@link teachBoth} is the only
 * caller of {@link CraftSkills.learn} — and afterward each crawler's level
 * tracks only the XP that crawler personally earned.
 */

import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { CrawlerKind } from './SkillManager';
import { isRecord } from './guards';
import { computeXpToNextLevel } from './xpCurve';

export type CraftSkillId = 'resourcing' | 'construction';

const CRAFT_SKILL_IDS: readonly CraftSkillId[] = ['resourcing', 'construction'];

export function isCraftSkillId(value: string): value is CraftSkillId {
  return CRAFT_SKILL_IDS.some((id) => id === value);
}

export interface CraftSkillState {
  learned: boolean;
  level: number;
  xp: number;
}

export type CraftSkillsSnapshot = Record<CraftSkillId, CraftSkillState>;

/** Ceiling shared by both craft skills. */
export const MAX_CRAFT_LEVEL = 15;

/** Fraction of a harvest's XP a summoner earns when a thrall performs it. */
export const THRALL_XP_FRACTION = 0.25;

// ── XP tuning ──────────────────────────────────────────────────────────────
//
// Both curves reuse the shared geometric threshold curve (`computeXpToNextLevel`)
// with a per-skill base and growth rate, the same way `AbilityDef` lets each
// ability tune its own curve. The constants below were fit so that a crawler
// who does all the qualifying actions themselves lands on the requested level
// landmarks within about 20%:
//   Resourcing:   L5 ≈ 250 basic-tool harvests, L10 ≈ 1,500, L15 ≈ 6,000.
//   Construction: L5 ≈ 12 wooden-wall builds,   L10 ≈ 80,    L15 ≈ 300.

const RESOURCING_XP_BASE = 1000;
const RESOURCING_XP_GROWTH_RATE = 1.33;
const RESOURCING_XP_FINAL_MULTIPLIER = 1.1;

const CONSTRUCTION_XP_BASE = 1000;
const CONSTRUCTION_XP_GROWTH_RATE = 1.34;
const CONSTRUCTION_XP_FINAL_MULTIPLIER = 1.05;

interface CraftSkillCurve {
  base: number;
  growthRate: number;
  finalMultiplier: number;
}

const CRAFT_SKILL_CURVES: Record<CraftSkillId, CraftSkillCurve> = {
  resourcing: {
    base: RESOURCING_XP_BASE,
    growthRate: RESOURCING_XP_GROWTH_RATE,
    finalMultiplier: RESOURCING_XP_FINAL_MULTIPLIER,
  },
  construction: {
    base: CONSTRUCTION_XP_BASE,
    growthRate: CONSTRUCTION_XP_GROWTH_RATE,
    finalMultiplier: CONSTRUCTION_XP_FINAL_MULTIPLIER,
  },
};

function xpToNextLevel(id: CraftSkillId, currentLevel: number): number {
  const curve = CRAFT_SKILL_CURVES[id];
  return computeXpToNextLevel(
    currentLevel,
    curve.base,
    curve.growthRate,
    curve.finalMultiplier,
    MAX_CRAFT_LEVEL,
  );
}

/** XP a basic-tool (tier 0) harvest grants toward Resourcing. Higher tiers scale up from this. */
export const RESOURCING_XP_PER_BASIC_HARVEST = 26;

/** XP granted toward Construction per wooden-wall segment's worth of build progress. */
export const CONSTRUCTION_XP_PER_WOODEN_WALL = 545;

/** Something worth announcing that happened to a craft skill, awaiting pickup. */
export interface CraftSkillEvent {
  kind: 'learned' | 'leveled';
  id: CraftSkillId;
  level: number;
}

/** Ceiling on undrained events, so a scene that never drains them can't leak. */
const MAX_PENDING_EVENTS = 8;

function emptyState(): CraftSkillState {
  return { learned: false, level: 0, xp: 0 };
}

export class CraftSkills {
  private readonly states = new Map<CraftSkillId, CraftSkillState>([
    ['resourcing', emptyState()],
    ['construction', emptyState()],
  ]);

  /**
   * Craft-skill happenings awaiting pickup by the scene's notice system.
   * Queued rather than emitted directly: `CraftSkills` belongs to a `Player`,
   * which has no event bus in scope.
   */
  readonly pendingEvents: CraftSkillEvent[] = [];

  /**
   * When > 0, `isLearned`/`getLevel` report both craft skills as learned and at
   * min(godModeMinLevel, {@link MAX_CRAFT_LEVEL}). Real state is untouched, so
   * turning this back to 0 (god mode off) reverts to whatever was actually
   * taught. Mirrors `AbilityManager`'s overlay.
   */
  private godModeMinLevel = 0;

  constructor(private readonly owner: CrawlerKind | null) {}

  /** Which crawler this instance belongs to, or null for a non-crawler `Player`. */
  get crawlerKind(): CrawlerKind | null {
    return this.owner;
  }

  private queueEvent(event: CraftSkillEvent): void {
    if (this.pendingEvents.length >= MAX_PENDING_EVENTS) return;
    this.pendingEvents.push(event);
  }

  isLearned(id: CraftSkillId): boolean {
    return (this.states.get(id)?.learned ?? false) || this.godModeMinLevel > 0;
  }

  /** Current level, or 0 when the skill has not been taught yet. Includes the god-mode overlay, if any. */
  getLevel(id: CraftSkillId): number {
    return Math.max(
      this.getRealLevel(id),
      this.godModeMinLevel > 0 ? Math.min(this.godModeMinLevel, MAX_CRAFT_LEVEL) : 0,
    );
  }

  /**
   * The stored level, ignoring the god-mode overlay — what the crawler actually
   * earned. Anything that pays out for reaching a level has to read this, or a
   * cheat hands out the reward.
   */
  getRealLevel(id: CraftSkillId): number {
    return this.states.get(id)?.level ?? 0;
  }

  /** Override the effective level floor for both craft skills (god mode). Pass 0 to clear. */
  setGodModeMinLevel(minLevel: number): void {
    this.godModeMinLevel = minLevel;
  }

  getXp(id: CraftSkillId): number {
    return this.states.get(id)?.xp ?? 0;
  }

  /** XP needed to reach the next level from the current one, or Infinity at the ceiling. */
  xpToNext(id: CraftSkillId): number {
    return xpToNextLevel(id, this.getLevel(id));
  }

  /**
   * Teaches the skill at level 1. Only {@link teachBoth} calls this — a craft
   * skill is never learned by one crawler alone.
   */
  learn(id: CraftSkillId): void {
    const state = this.states.get(id);
    if (state === undefined || state.learned) return;
    state.learned = true;
    state.level = 1;
    state.xp = 0;
    this.queueEvent({ kind: 'learned', id, level: 1 });
  }

  /**
   * Adds XP earned by this crawler's own actions. A no-op if the skill has not
   * been taught yet — XP earned before the explainer means nothing.
   */
  addXp(id: CraftSkillId, amount: number): void {
    const state = this.states.get(id);
    if (state === undefined || !state.learned || amount <= 0) return;
    if (state.level >= MAX_CRAFT_LEVEL) return;
    state.xp += amount;
    let next = xpToNextLevel(id, state.level);
    while (state.level < MAX_CRAFT_LEVEL && state.xp >= next) {
      state.xp -= next;
      state.level++;
      this.queueEvent({ kind: 'leveled', id, level: state.level });
      next = xpToNextLevel(id, state.level);
    }
    // At the ceiling there is no "next level" to bank toward, so any
    // leftover from an oversized grant is discarded rather than parked.
    if (state.level >= MAX_CRAFT_LEVEL) state.xp = 0;
  }

  snapshot(): CraftSkillsSnapshot {
    const resourcing = this.states.get('resourcing') ?? emptyState();
    const construction = this.states.get('construction') ?? emptyState();
    return {
      resourcing: { ...resourcing },
      construction: { ...construction },
    };
  }

  restore(snapshot: CraftSkillsSnapshot): void {
    for (const id of CRAFT_SKILL_IDS) {
      const state = snapshot[id];
      this.states.set(id, {
        learned: state.learned,
        level: Math.max(0, Math.min(MAX_CRAFT_LEVEL, Math.floor(state.level))),
        xp: Math.max(0, state.xp),
      });
    }
  }
}

function parseCraftSkillState(value: unknown): CraftSkillState | undefined {
  if (!isRecord(value)) return undefined;
  const learned = typeof value.learned === 'boolean' ? value.learned : false;
  const level =
    typeof value.level === 'number' && Number.isFinite(value.level)
      ? Math.max(0, Math.min(MAX_CRAFT_LEVEL, Math.floor(value.level)))
      : 0;
  const xp = typeof value.xp === 'number' && Number.isFinite(value.xp) ? Math.max(0, value.xp) : 0;
  return { learned, level, xp };
}

/**
 * Tolerant parse of a `CraftSkillsSnapshot` from an unknown save value. A
 * missing or malformed field falls back to "not learned" rather than failing
 * the whole snapshot, so an old save with no craft progress loads cleanly.
 */
export function parseCraftSkillsSnapshot(value: unknown): CraftSkillsSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  return {
    resourcing: parseCraftSkillState(value.resourcing) ?? emptyState(),
    construction: parseCraftSkillState(value.construction) ?? emptyState(),
  };
}

/**
 * The only way a craft skill is learned: both crawlers are taught at once, at
 * level 1, in the same moment.
 */
export function teachBoth(human: HumanPlayer, cat: CatPlayer, id: CraftSkillId): void {
  human.craftSkills.learn(id);
  cat.craftSkills.learn(id);
}
