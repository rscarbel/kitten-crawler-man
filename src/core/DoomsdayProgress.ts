import type { Player } from '../Player';

/**
 * Cross-scene state for "Carl's Doomsday Scenario" (the finale that follows
 * Miss Quill's death): the soul crystal destabilizes where she fell, the
 * player must reach and contain it before a containment countdown expires,
 * then escape to a stairwell before a second, shorter countdown runs out.
 *
 * Both countdowns are wall-clock deadlines (not frame counts) because the
 * beat spans several scene instances (every tower floor, then the overworld)
 * that do not share a frame counter across reconstruction. The timeout check
 * itself (`triggerDoomsdayExplosionIfExpired`) must therefore run from
 * *every* place the player could be standing while a countdown is live —
 * not just the room the crystal is in.
 */
export type DoomsdayStage = 'inactive' | 'containment' | 'escape' | 'complete';

export interface DoomsdayProgress {
  stage: DoomsdayStage;
  /** Wall-clock deadline (ms since epoch) for the active countdown; null when no countdown is running. */
  deadlineAt: number | null;
  /** World-pixel position of the destabilized crystal — where Quill fell. Set once, on death. */
  crystalTile: { x: number; y: number } | null;
}

export function createDoomsdayProgress(): DoomsdayProgress {
  return {
    stage: 'inactive',
    deadlineAt: null,
    crystalTile: null,
  };
}

const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;

/** Seconds remaining until a deadline, floored at 0. */
export function countdownSecondsLeft(deadlineAt: number): number {
  return Math.max(0, Math.ceil((deadlineAt - Date.now()) / MS_PER_SECOND));
}

/** Formats a deadline as `mm:ss` for HUD countdown display. */
export function formatCountdownClock(deadlineAt: number): string {
  const secondsLeft = countdownSecondsLeft(deadlineAt);
  const mm = Math.floor(secondsLeft / SECONDS_PER_MINUTE);
  const ss = String(secondsLeft % SECONDS_PER_MINUTE).padStart(2, '0');
  return `${mm}:${ss}`;
}

/** Red once under a minute remains, amber otherwise — shared urgency threshold for countdown HUDs. */
export function countdownUrgencyColor(deadlineAt: number): string {
  return countdownSecondsLeft(deadlineAt) <= SECONDS_PER_MINUTE ? '#ef4444' : '#fbbf24';
}

/**
 * Kills both players with a bespoke death cause once a containment or escape
 * deadline passes. Called every frame from every place the player could be
 * standing while a countdown is live (inside the tower regardless of floor,
 * and in the overworld) so the timeout can't be dodged by simply walking
 * away from wherever the countdown started.
 *
 * Deliberately has no "already triggered" latch: `takeDamage` is idempotent
 * (clamped at 0 hp) and a no-op while a player is protected, in god mode, or
 * knocked out, so retrying every frame — rather than firing once and giving
 * up — means a player who's merely standing in a safe room when the timer
 * expires still dies the moment they step out, instead of soft-locking the
 * whole sequence.
 */
export function triggerDoomsdayExplosionIfExpired(
  progress: DoomsdayProgress,
  human: Player,
  cat: Player,
): void {
  if (
    (progress.stage !== 'containment' && progress.stage !== 'escape') ||
    progress.deadlineAt === null ||
    Date.now() < progress.deadlineAt
  ) {
    return;
  }
  human.takeDamage(human.hp, { kind: 'doomsday' });
  cat.takeDamage(cat.hp, { kind: 'doomsday' });
}
