/**
 * Being caught in the tower, as the screen shows it: a beat frozen where the
 * watcher saw enough, the screen going dark, the party walked back while it
 * is dark, and the screen coming back. The owner says what being caught
 * means; this only keeps the beats and says when the party is to be moved.
 */

/** The beat after a watcher has seen enough, before the screen goes dark. */
const FREEZE_FRAMES = 40;
const FADE_OUT_FRAMES = 30;
/** Held dark while the party is walked back. */
const HOLD_FRAMES = 48;
const FADE_IN_FRAMES = 30;

type CapturePhase = 'idle' | 'freeze' | 'fadeOut' | 'hold' | 'fadeIn';

/** What one step of a capture asks of its owner. */
export type CaptureStep =
  | { readonly kind: 'none' }
  /** The screen has gone dark: move the party and reset whatever caught it. */
  | { readonly kind: 'reset' }
  /** The screen is coming back: tell the player what happened. */
  | { readonly kind: 'returning' };

const NONE: CaptureStep = { kind: 'none' };

export class CaptureFade {
  private phase: CapturePhase = 'idle';
  private frame = 0;

  /** Whether a capture is under way, which holds the party's input. */
  get active(): boolean {
    return this.phase !== 'idle';
  }

  /** How dark the screen is, 0 to 1. */
  get alpha(): number {
    switch (this.phase) {
      case 'idle':
      case 'freeze':
        return 0;
      case 'fadeOut':
        return Math.min(1, this.frame / FADE_OUT_FRAMES);
      case 'hold':
        return 1;
      case 'fadeIn':
        return Math.max(0, 1 - this.frame / FADE_IN_FRAMES);
      default: {
        const unhandled: never = this.phase;
        throw new Error(`unhandled capture phase ${String(unhandled)}`);
      }
    }
  }

  begin(): void {
    this.enter('freeze');
  }

  /** Drops a capture part-way, for a party that has left the storey it happened on. */
  cancel(): void {
    this.enter('idle');
  }

  /** Once a frame while {@link active}. */
  step(): CaptureStep {
    this.frame++;
    switch (this.phase) {
      case 'idle':
        return NONE;
      case 'freeze':
        if (this.frame >= FREEZE_FRAMES) this.enter('fadeOut');
        return NONE;
      case 'fadeOut':
        if (this.frame < FADE_OUT_FRAMES) return NONE;
        this.enter('hold');
        return { kind: 'reset' };
      case 'hold':
        if (this.frame < HOLD_FRAMES) return NONE;
        this.enter('fadeIn');
        return { kind: 'returning' };
      case 'fadeIn':
        if (this.frame >= FADE_IN_FRAMES) this.enter('idle');
        return NONE;
      default: {
        const unhandled: never = this.phase;
        throw new Error(`unhandled capture phase ${String(unhandled)}`);
      }
    }
  }

  private enter(phase: CapturePhase): void {
    this.phase = phase;
    this.frame = 0;
  }
}
