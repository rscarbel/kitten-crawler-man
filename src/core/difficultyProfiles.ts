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
import { worldRandom } from './WorldRandom';
import type { Mob } from '../creatures/Mob';
import { COCKROACH_RECHARGE_MS } from './SkillManager';

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
  /**
   * Multiplies every tactics trait's chance before its cap, stamped on the mob
   * with its traits at spawn. Never moves the unlock levels, so a mob below
   * them behaves identically on every profile.
   */
  tacticsChanceScale: number;
  /**
   * Milliseconds cut from Cockroach's remaining recharge when its owner is
   * knocked out — a consolation for the fatal blow it was too cold to catch.
   * Clamped so the recharge never goes negative, so Kitten's relief is simply
   * set larger than any recharge could be, which completes it outright
   * through the same arithmetic rather than as a special case. Nightmare's is
   * a token amount rather than a real relief, kept strictly positive because
   * `verify:difficulty` requires every profile axis to be.
   */
  cockroachKnockoutReliefMs: number;
  /**
   * Share of a blow taken off a mob a shield fairy's ward is holding
   * invulnerable — 1 keeps the ward absolute, as it always was; under 1 lets
   * the rest of the blow through, so easy mode never asks a player to hunt
   * down and kill the fairy before their hits on its allies count for
   * anything.
   */
  wardDamageReduction: number;
}

/** The shipped ambient/boss level ratios, before any difficulty axis existed. */
export const NORMAL_AMBIENT_LEVEL_RATIO = 0.7;
export const NORMAL_BOSS_LEVEL_RATIO = 0.8;

/** Milliseconds cut from a knocked-out crawler's own Cockroach recharge, on Crawler difficulty. */
const COCKROACH_KNOCKOUT_RELIEF_MS_NORMAL = 15_000;
/**
 * Kitten's relief completes the recharge outright: set past the longest
 * recharge the skill can ever hold, so clamping the result at "now" is always
 * what fires, with no separate "completed" case to keep in sync.
 */
const COCKROACH_KNOCKOUT_RELIEF_MS_EASY = COCKROACH_RECHARGE_MS + 1;
/**
 * Nightmare's Cockroach relief is unchanged in every way that matters — the
 * recharge itself runs minutes long — but the field can't be zero because
 * `verify:difficulty` requires every profile axis to be strictly positive.
 */
const COCKROACH_KNOCKOUT_RELIEF_MS_HARD_TOKEN = 1;

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
    tacticsChanceScale: 0.6,
    cockroachKnockoutReliefMs: COCKROACH_KNOCKOUT_RELIEF_MS_EASY,
    wardDamageReduction: 0.75,
  },
  normal: {
    incomingMobDamageScale: 1.0,
    ambientLevelRatio: NORMAL_AMBIENT_LEVEL_RATIO,
    bossLevelRatio: NORMAL_BOSS_LEVEL_RATIO,
    bountyLevelRatio: 1.0,
    rewardXpScale: 1.0,
    rewardCoinScale: 1.0,
    bountyPayoutScale: 1.0,
    tacticsChanceScale: 1.0,
    cockroachKnockoutReliefMs: COCKROACH_KNOCKOUT_RELIEF_MS_NORMAL,
    wardDamageReduction: 1,
  },
  hard: {
    incomingMobDamageScale: 1.3,
    ambientLevelRatio: 0.85,
    bossLevelRatio: 0.95,
    bountyLevelRatio: 1.0,
    rewardXpScale: 1.25,
    rewardCoinScale: 1.25,
    bountyPayoutScale: 1.5,
    tacticsChanceScale: 1.3,
    cockroachKnockoutReliefMs: COCKROACH_KNOCKOUT_RELIEF_MS_HARD_TOKEN,
    wardDamageReduction: 1,
  },
};

/** The active difficulty's profile, read from `Settings`. */
export function activeDifficultyProfile(): DifficultyProfile {
  return DIFFICULTY_PROFILES[settings.difficulty];
}

/**
 * Everything a difficulty profile stamps on a mob at spawn, called straight
 * after `applyMobLevel` at every spawn site: the explicit reward scale, and the
 * tactics traits rolled from the level that call just set.
 *
 * One call rather than two so a spawn site cannot level a mob, scale its
 * rewards and forget its traits. `profile` defaults to the live setting; the
 * floor spawner passes the profile it resolved levels with, so both halves of
 * a spawn read the same one.
 *
 * Traits draw from {@link worldRandom}, the source the spawner's own level
 * rolls use, so whatever makes one reproducible makes the other so too.
 */
export function applySpawnDifficulty(
  mob: Mob,
  profile: DifficultyProfile = activeDifficultyProfile(),
): void {
  mob.applyDifficultyRewards(profile.rewardXpScale, profile.rewardCoinScale);
  mob.rollTactics(profile.tacticsChanceScale, worldRandom);
}
