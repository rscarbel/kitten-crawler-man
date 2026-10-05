/**
 * The one on-screen sign that game progress was written: a "Saving..." toast
 * that turns into "Game Saved" in place.
 *
 * `trigger()` restarts the sequence rather than queuing a second run, so a
 * checkpoint and a safe-room save landing on the same frame still show one
 * toast, not two stacked.
 */

import { TOAST_FADE_TICKS, type HudToasts, type ToastOptions } from './hud/toasts';

/** "Saving..." holds for a beat before flipping to the confirmed state. */
const SAVING_PHASE_TICKS = 24;
/** "Game Saved" holds long enough to register at a glance, then fades. */
const SAVED_HOLD_TICKS = 84;

const SAVE_TOAST_KEY = 'save';

const SAVING_TOAST: ToastOptions = {
  key: SAVE_TOAST_KEY,
  icon: 'save',
  tone: 'neutral',
  durationTicks: SAVING_PHASE_TICKS + TOAST_FADE_TICKS,
};

const SAVED_TOAST: ToastOptions = {
  key: SAVE_TOAST_KEY,
  icon: 'save',
  tone: 'success',
  durationTicks: SAVED_HOLD_TICKS,
};

export class SaveIndicator {
  private savingTicksLeft = 0;

  constructor(private toasts: HudToasts | null = null) {}

  /** The stack the save toasts post to; a scene attaches its own on setup. */
  attach(toasts: HudToasts | null): void {
    this.toasts = toasts;
  }

  /** Starts (or restarts) the "Saving... → Game Saved" sequence. */
  trigger(): void {
    this.savingTicksLeft = SAVING_PHASE_TICKS;
    this.toasts?.post('Saving...', SAVING_TOAST);
  }

  update(): void {
    if (this.savingTicksLeft <= 0) return;
    this.savingTicksLeft--;
    if (this.savingTicksLeft === 0) this.toasts?.post('Game Saved', SAVED_TOAST);
  }

  /** Stops a sequence mid-way, for scene teardown; the stack clears its own toasts. */
  clear(): void {
    this.savingTicksLeft = 0;
  }
}
