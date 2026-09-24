import type { Player } from '../Player';
import { isRecord } from './guards';

/**
 * Cross-scene state for "Carl's Doomsday Scenario" (the finale that follows
 * the Lich's death): the soul crystal destabilizes where Miss Quill fell, and
 * one countdown starts. The party must reach and contain the crystal, then get
 * down the escape stairwell by the tower door, before that same clock runs
 * out — containing the crystal changes the objective, not the deadline.
 *
 * The countdown is a wall-clock deadline (not a frame count) because the beat
 * spans several scene instances (every tower floor, then the overworld) that do
 * not share a frame counter across reconstruction. The timeout check itself
 * (`triggerDoomsdayExplosionIfExpired`) must therefore run from *every* place
 * the player could be standing while the countdown is live — not just the room
 * the crystal is in.
 */
export type DoomsdayStage = 'inactive' | 'containment' | 'escape' | 'complete';

export const DOOMSDAY_STAGES: readonly DoomsdayStage[] = [
  'inactive',
  'containment',
  'escape',
  'complete',
];

export interface DoomsdayProgress {
  stage: DoomsdayStage;
  /** Wall-clock deadline (ms since epoch) for the countdown; null when no countdown is running. */
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
const MS_PER_MINUTE = SECONDS_PER_MINUTE * MS_PER_SECOND;
const DOOMSDAY_COUNTDOWN_MINUTES = 7;
/** The whole window to contain the crystal and reach the stairwell before the city goes up. */
export const DOOMSDAY_COUNTDOWN_MS = DOOMSDAY_COUNTDOWN_MINUTES * MS_PER_MINUTE;

/** The containment objective, worded the same in the Journal outdoors and on the HUD inside the tower. */
export const DOOMSDAY_CONTAIN_OBJECTIVE = 'Contain the soul crystal — top of the tower';

/** Whether the countdown is running: the party is either racing to the crystal or to the stairs. */
export function isDoomsdayCountdownLive(progress: DoomsdayProgress): boolean {
  return progress.stage === 'containment' || progress.stage === 'escape';
}

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
 * Kills both players with a bespoke death cause once the deadline passes.
 * Called every frame from every place the player could be standing while the
 * countdown is live (inside the tower regardless of floor, and in the
 * overworld) so the timeout can't be dodged by walking away from wherever the
 * countdown started.
 *
 * Deliberately has no "already fired" latch: `takeDamage` is a no-op while a
 * player is protected, warded, in god mode or knocked out, so retrying every
 * frame — rather than firing once and giving up — means a crawler who outlasts
 * the first blast, or a companion revived after it, is caught the moment they
 * can be hit. What stops it killing the party again after the respawn is
 * {@link rearmExpiredDoomsday}, run on the respawn itself.
 */
export function triggerDoomsdayExplosionIfExpired(
  progress: DoomsdayProgress,
  human: Player,
  cat: Player,
): void {
  if (!isDoomsdayCountdownLive(progress) || progress.deadlineAt === null) return;
  if (Date.now() < progress.deadlineAt) return;
  human.takeDamage(human.hp, { kind: 'doomsday' });
  cat.takeDamage(cat.hp, { kind: 'doomsday' });
}

/**
 * Called on the respawn after a party death. A countdown that ran out gives
 * the party a full new one on the stage they failed; without it they would
 * respawn into a deadline already past and die again on the first frame,
 * forever. A countdown still running is left alone, so dying to anything else
 * never buys back time. Returns whether it re-armed.
 */
export function rearmExpiredDoomsday(progress: DoomsdayProgress, now: number): boolean {
  if (!isDoomsdayCountdownLive(progress) || progress.deadlineAt === null) return false;
  if (now < progress.deadlineAt) return false;
  progress.deadlineAt = now + DOOMSDAY_COUNTDOWN_MS;
  return true;
}

/**
 * The countdown as a save stores it: the time *left*, not the wall-clock
 * deadline, so a save reloaded a day later resumes with the minutes it was
 * saved with instead of detonating on the first frame.
 */
export interface PersistedDoomsdayProgress {
  readonly stage: DoomsdayStage;
  readonly remainingMs: number | null;
  readonly crystalTile: { readonly x: number; readonly y: number } | null;
}

export function capturePersistedDoomsday(
  progress: DoomsdayProgress,
  now: number,
): PersistedDoomsdayProgress {
  return {
    stage: progress.stage,
    remainingMs: progress.deadlineAt === null ? null : Math.max(0, progress.deadlineAt - now),
    crystalTile: progress.crystalTile === null ? null : { ...progress.crystalTile },
  };
}

/**
 * Loads saved doomsday state into the live object, in place — every scene of
 * the run holds this same object by reference.
 *
 * Only into a finale that has not started. A death that respawns from a save
 * hands the new scene the live progress, whose countdown kept running through
 * the death; loading the save's older `remainingMs` over it would make dying a
 * way to buy back time.
 */
export function restoreDoomsdayProgress(
  target: DoomsdayProgress,
  saved: PersistedDoomsdayProgress,
  now: number,
): void {
  if (target.stage !== 'inactive') return;
  target.stage = saved.stage;
  target.deadlineAt = saved.remainingMs === null ? null : now + saved.remainingMs;
  target.crystalTile = saved.crystalTile === null ? null : { ...saved.crystalTile };
}

function parseCrystalTile(value: unknown): { x: number; y: number } | null {
  if (!isRecord(value)) return null;
  const { x, y } = value;
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/**
 * Defensive parse of a saved {@link PersistedDoomsdayProgress}. Anything
 * unreadable comes back undefined, which loads as a finale that never started.
 * A live stage whose time did not survive is given a full countdown rather than
 * none: an unkillable countdown would never end the stage it guards.
 */
export function parsePersistedDoomsday(value: unknown): PersistedDoomsdayProgress | undefined {
  if (!isRecord(value)) return undefined;
  const stage = DOOMSDAY_STAGES.find((candidate) => candidate === value.stage);
  if (stage === undefined) return undefined;
  const rawRemaining = value.remainingMs;
  const savedRemaining =
    typeof rawRemaining === 'number' && Number.isFinite(rawRemaining)
      ? Math.min(DOOMSDAY_COUNTDOWN_MS, Math.max(0, rawRemaining))
      : null;
  const countdownLive = stage === 'containment' || stage === 'escape';
  const remainingMs = countdownLive ? (savedRemaining ?? DOOMSDAY_COUNTDOWN_MS) : null;
  return { stage, remainingMs, crystalTile: parseCrystalTile(value.crystalTile) };
}
