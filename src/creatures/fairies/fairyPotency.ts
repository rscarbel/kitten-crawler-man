import type { Difficulty } from '../../core/difficultyProfiles';
import { clamp } from '../../utils';
import {
  FAIRY_LEVELS_PER_EXTRA_TARGET,
  FAIRY_MAX_POTENCY,
  FAIRY_MIN_POTENCY,
  NECRO_SKELETON_LEVELS_BELOW_FAIRY,
  SHIELD_EXTRA_WARDS,
} from './fairyTuning';

/** The lowest level a mob can be spawned at. */
const LOWEST_MOB_LEVEL = 1;

/**
 * Extra potency each difficulty adds. Easy takes one away, so an easy fairy on
 * the first floor starts from the lowest potency.
 */
export const FAIRY_DIFFICULTY_POTENCY_BONUS: Readonly<Record<Difficulty, number>> = {
  easy: -1,
  normal: 0,
  hard: 1,
};

/**
 * A fairy's potency: the base of a shield fairy's ward count
 * ({@link shieldWardsAtPotency}). One,
 * plus one per {@link FAIRY_LEVELS_PER_EXTRA_TARGET} levels past the first,
 * plus the difficulty's bonus, held between {@link FAIRY_MIN_POTENCY} and
 * {@link FAIRY_MAX_POTENCY}.
 *
 * Read once at spawn and stamped on the fairy, so a settings flip mid-floor
 * never changes a fairy that already exists.
 */
export function fairyPotencyCount(level: number, difficulty: Difficulty): number {
  const levelsPastFirst = Math.max(0, level - 1);
  const levelSteps = Math.floor(levelsPastFirst / FAIRY_LEVELS_PER_EXTRA_TARGET);
  const raw = 1 + levelSteps + FAIRY_DIFFICULTY_POTENCY_BONUS[difficulty];
  return clamp(raw, FAIRY_MIN_POTENCY, FAIRY_MAX_POTENCY);
}

/**
 * How many allies a shield fairy of `potency` wards at once:
 * {@link SHIELD_EXTRA_WARDS} more than its potency, the potency ceiling
 * included, so a fairy at {@link FAIRY_MAX_POTENCY} wards one more than that.
 */
export function shieldWardsAtPotency(potency: number): number {
  return potency + SHIELD_EXTRA_WARDS;
}

/** How many allies a shield fairy spawned at `level` under `difficulty` wards at once. */
export function shieldWardCount(level: number, difficulty: Difficulty): number {
  return shieldWardsAtPotency(fairyPotencyCount(level, difficulty));
}

/**
 * The level every skeleton a necro fairy of `fairyLevel` raises stands at,
 * summoned in life or left behind on its death:
 * {@link NECRO_SKELETON_LEVELS_BELOW_FAIRY} under the fairy, never under level 1.
 */
export function necroSkeletonLevel(fairyLevel: number): number {
  return Math.max(LOWEST_MOB_LEVEL, fairyLevel - NECRO_SKELETON_LEVELS_BELOW_FAIRY);
}
