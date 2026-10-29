import { settings } from '../input/Settings';
import {
  registerDifficultyChangeGuard,
  type DifficultyChangeConfirmation,
  type DifficultyGuardHandle,
} from './difficultyChangeGuard';
import type { Difficulty } from './difficultyProfiles';

/** The one tier that holds a floor to its time limit. */
const TIMED_DIFFICULTY = 'hard' as const satisfies Difficulty;

/**
 * A floor's clock: how long the party has spent on it, which is counted on
 * every difficulty, and the limit Nightmare holds that time to.
 */
export interface FloorClock {
  readonly elapsedFrames: number;
  /** Absent on a floor with no time limit on any difficulty. */
  readonly nightmareTimeLimitFrames: number | undefined;
}

/**
 * Frames left before Nightmare's time limit runs out on this floor, or null
 * when there is no limit to run out: the floor is untimed or `difficulty` is
 * not Nightmare. Never below zero.
 *
 * The only place that decides whether a floor is on the clock. Every HUD,
 * cue, AI and death site asks here rather than checking the difficulty for
 * itself, so a change of difficulty mid-floor shows and hides the limit
 * everywhere at once. `difficulty` defaults to the live setting; pass another
 * tier to ask what switching to it would leave.
 */
export function nightmareTimeRemaining(
  clock: FloorClock,
  difficulty: Difficulty = settings.difficulty,
): number | null {
  const limit = clock.nightmareTimeLimitFrames;
  if (limit === undefined || difficulty !== TIMED_DIFFICULTY) return null;
  return Math.max(0, limit - clock.elapsedFrames);
}

/** Asked before a switch to Nightmare that would put the floor past its time limit at once. */
const TIME_LIMIT_SWITCH_CONFIRMATION: DifficultyChangeConfirmation = {
  title: 'Switch to Nightmare?',
  body: 'You have already been on this floor longer than Nightmare allows. Switching now ends the floor.',
};

/**
 * Holds a switch to Nightmare that would put the floor past its limit the
 * moment it lands, so the player is told it ends the floor before it does.
 * Any other change goes straight through. `clock` is read at click time, so a
 * scene whose clock is still running hands over a reader of the live one.
 *
 * Returns null, registering nothing, for a floor with no time limit; the
 * caller clears the returned handle when the scene leaves.
 */
export function holdDifficultyForTimeLimit(clock: () => FloorClock): DifficultyGuardHandle | null {
  if (clock().nightmareTimeLimitFrames === undefined) return null;
  return registerDifficultyChangeGuard({
    confirmation: (next) =>
      nightmareTimeRemaining(clock(), next) === 0 ? TIME_LIMIT_SWITCH_CONFIRMATION : null,
    restartWithDifficulty: (next) => settings.setDifficulty(next),
  });
}
