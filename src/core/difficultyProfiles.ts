/**
 * The difficulty toggle's tuning table.
 *
 * Pure and side-effect-free so `scripts/verify-difficulty.ts` and
 * `scripts/verify-bounty.ts` can import it directly and assert against the
 * real numbers rather than a copy of them. `activeDifficultyProfile()` is the
 * only thing here that touches `Settings` — everything else stays importable
 * from a headless script with no `localStorage`.
 *
 * Normal is identity: every axis is 1.0 except the two level ratios, which
 * equal the shipped `MOB_LEVEL_PARTY_RATIO`/`BOSS_LEVEL_PARTY_RATIO`. A player
 * who never opens Settings gets exactly the game the difficulty rebalance
 * shipped — `verify:difficulty` asserts this.
 */

import { settings } from './Settings';
import type { Mob } from '../creatures/Mob';

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface DifficultyProfile {
  /** Multiplies mob-inflicted damage in `Player.takeDamage`. Read live. */
  incomingMobDamageScale: number;
  /** Replaces `MOB_LEVEL_PARTY_RATIO` (0.7 today) in `earnedLevelFloor`. */
  ambientLevelRatio: number;
  /** Replaces `BOSS_LEVEL_PARTY_RATIO` (0.8 today) in `resolveBossLevel`. */
  bossLevelRatio: number;
  /** Fraction of party level a bounty escort spawns at (1.0 today). */
  bountyLevelRatio: number;
  /** Explicit XP/coin scale, stamped on the mob at spawn. */
  rewardXpScale: number;
  rewardCoinScale: number;
  /** Multiplies Shady's coin payout, captured at kill time. */
  bountyPayoutScale: number;
}

/** The shipped ambient/boss level ratios, before any difficulty axis existed. */
export const NORMAL_AMBIENT_LEVEL_RATIO = 0.7;
export const NORMAL_BOSS_LEVEL_RATIO = 0.8;

/**
 * UI labels for each tier, per the Dungeon Crawler Carl framing. The single
 * source both the Settings tab's toggle and the `?difficulty` overlay read,
 * so the two can never drift out of sync with each other.
 */
export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: 'Kitten',
  normal: 'Crawler',
  hard: 'Nightmare',
};

export const DIFFICULTY_PROFILES: Record<Difficulty, DifficultyProfile> = {
  easy: {
    incomingMobDamageScale: 0.7,
    ambientLevelRatio: 0.55,
    bossLevelRatio: 0.65,
    bountyLevelRatio: 0.75,
    rewardXpScale: 1.0,
    rewardCoinScale: 1.0,
    bountyPayoutScale: 0.85,
  },
  normal: {
    incomingMobDamageScale: 1.0,
    ambientLevelRatio: NORMAL_AMBIENT_LEVEL_RATIO,
    bossLevelRatio: NORMAL_BOSS_LEVEL_RATIO,
    bountyLevelRatio: 1.0,
    rewardXpScale: 1.0,
    rewardCoinScale: 1.0,
    bountyPayoutScale: 1.0,
  },
  hard: {
    incomingMobDamageScale: 1.3,
    ambientLevelRatio: 0.85,
    bossLevelRatio: 0.95,
    bountyLevelRatio: 1.0,
    rewardXpScale: 1.25,
    rewardCoinScale: 1.25,
    bountyPayoutScale: 1.5,
  },
};

/** The active difficulty's profile, read from `Settings`. */
export function activeDifficultyProfile(): DifficultyProfile {
  return DIFFICULTY_PROFILES[settings.difficulty];
}

/**
 * Applies the active difficulty's reward scale to a mob, alongside
 * `applyMobLevel` at every spawn site. The one-liner every such site wants —
 * `mob.applyDifficultyRewards(profile.rewardXpScale, profile.rewardCoinScale)`
 * off a freshly read `activeDifficultyProfile()` — so a third reward axis is a
 * one-line change here instead of an edit at every call site.
 */
export function applyActiveDifficultyRewards(mob: Mob): void {
  const profile = activeDifficultyProfile();
  mob.applyDifficultyRewards(profile.rewardXpScale, profile.rewardCoinScale);
}
