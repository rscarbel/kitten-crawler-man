/**
 * A hold on the player's difficulty setting while something is running that a
 * difficulty change would invalidate part-way through.
 *
 * A system that is mid-run registers a guard; the Settings tab asks
 * {@link activeDifficultyChangeGuard} at click time and, when one is active
 * and its {@link DifficultyChangeGuard.confirmation} has something to say
 * about the new tier, asks the player to confirm before handing the tier to
 * the guard. The question is asked at click time, never when the tab is
 * built, so a guard registered after the pause menu was constructed is still
 * honoured.
 *
 * Only one guard is held at a time: the latest registration wins.
 */

import type { Difficulty } from './difficultyProfiles';

/** What the player is asked before a guarded difficulty change goes ahead. */
export interface DifficultyChangeConfirmation {
  readonly title: string;
  readonly body: string;
}

export interface DifficultyChangeGuard {
  /**
   * What to ask before changing to `next`, or null when that change disturbs
   * nothing this guard protects and goes straight through as an ordinary
   * change. Asked only for a tier that differs from the current one.
   */
  readonly confirmation: (next: Difficulty) => DifficultyChangeConfirmation | null;
  /**
   * Performs a confirmed difficulty change. Called at most once per
   * confirmation, only with a tier that differs from the current one, and only
   * after the player has agreed to restart.
   *
   * The guard owns the whole change: it must call `settings.setDifficulty(next)`
   * itself and then restart whatever it protects. The Settings tab does not
   * apply the tier on the guard's behalf, so the restart can order the two
   * steps however it needs to.
   */
  readonly restartWithDifficulty: (next: Difficulty) => void;
}

/**
 * Proof of one registration. Clearing needs it so that a stale owner's dispose
 * cannot remove a guard somebody registered after it.
 */
export interface DifficultyGuardHandle {
  readonly registration: number;
}

let active: {
  readonly handle: DifficultyGuardHandle;
  readonly guard: DifficultyChangeGuard;
} | null = null;
let nextRegistration = 1;

/** Holds difficulty changes behind `guard` until the returned handle is cleared. */
export function registerDifficultyChangeGuard(guard: DifficultyChangeGuard): DifficultyGuardHandle {
  const handle: DifficultyGuardHandle = { registration: nextRegistration };
  nextRegistration += 1;
  active = { handle, guard };
  return handle;
}

/** Releases the guard `handle` registered; a no-op when a newer guard has replaced it. */
export function clearDifficultyChangeGuard(handle: DifficultyGuardHandle): void {
  if (active?.handle === handle) active = null;
}

/** The guard a difficulty change must go through right now, if any. */
export function activeDifficultyChangeGuard(): DifficultyChangeGuard | null {
  return active?.guard ?? null;
}
