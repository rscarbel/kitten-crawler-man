/**
 * How long a screen a script left black stays black once no script is
 * playing: long enough for the scene change the script handed over to, so
 * the world never flashes back up first.
 */
export const FADE_HOLD_AFTER_SCRIPT_FRAMES = 120;

/** How long a screen left black by a finished script takes to clear on its own. */
export const FADE_RECOVERY_FRAMES = 30;

/** Below this the screen is clear. */
const CLEAR_ALPHA = 0;

interface FadeMove {
  readonly from: number;
  readonly to: number;
  readonly frames: number;
  elapsed: number;
}

/**
 * A cutscene's full-screen fade, eased on world ticks. A screen left dark
 * with no script playing clears itself after a hold, so a script that forgot
 * to fade back can never strand the player behind black.
 */
export class CutsceneFade {
  private value = CLEAR_ALPHA;
  private move: FadeMove | null = null;
  private idleDarkFrames = 0;

  /** How dark the screen is now, 0 clear to 1 black. */
  get alpha(): number {
    return this.value;
  }

  get isMoving(): boolean {
    return this.move !== null;
  }

  /** Eases from where the fade stands to `to` over `frames` ticks; at once when `frames` is not positive. */
  fadeTo(to: number, frames: number): void {
    this.idleDarkFrames = 0;
    if (frames <= 0) {
      this.value = to;
      this.move = null;
      return;
    }
    this.move = { from: this.value, to, frames, elapsed: 0 };
  }

  /** One world tick. `scriptPlaying` keeps a dark screen dark for as long as a script owns it. */
  tick(scriptPlaying: boolean): void {
    const move = this.move;
    if (move !== null) {
      move.elapsed++;
      const share = Math.min(1, move.elapsed / move.frames);
      this.value = move.from + (move.to - move.from) * share;
      if (share >= 1) this.move = null;
      return;
    }
    if (scriptPlaying || this.value <= CLEAR_ALPHA) {
      this.idleDarkFrames = 0;
      return;
    }
    this.idleDarkFrames++;
    if (this.idleDarkFrames > FADE_HOLD_AFTER_SCRIPT_FRAMES) {
      this.fadeTo(CLEAR_ALPHA, FADE_RECOVERY_FRAMES);
    }
  }

  clear(): void {
    this.value = CLEAR_ALPHA;
    this.move = null;
    this.idleDarkFrames = 0;
  }
}
