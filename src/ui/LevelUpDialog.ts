import type { LevelUpEntry } from '../core/LevelUpEntry';
import type { AudioManager } from '../audio/AudioManager';
type Phase = 'idle' | 'power_up' | 'count_up' | 'done';

/** What the card on screen shows this frame. */
export interface LevelUpView {
  readonly entry: LevelUpEntry;
  /** The icon is still pulsing in. */
  readonly poweringUp: boolean;
  /** 0 to 1 through the pulse. */
  readonly iconPulse: number;
  /** The level number drawn: the old level until the count-up lands. */
  readonly displayedLevel: number;
  /** 0 to 1 through the count-up; 1 once it has landed. */
  readonly countUpProgress: number;
  /** The count-up has landed: the perk line and OK are shown and OK may be pressed. */
  readonly settled: boolean;
}

/**
 * Pausing overlay that plays when an ability or a skill gains a level.
 * Multiple consecutive level-ups are queued and shown one after the other.
 *
 * It knows nothing about either system — a caller resolves its own definition
 * into a {@link LevelUpEntry} first, so both progressions share one ceremony
 * instead of maintaining two near-identical overlays.
 *
 * A scene should:
 *   1. Call enqueue(entry) each time something levels.
 *   2. Skip updateGameplay() while isShowing is true.
 *   3. Call update() every frame regardless of pause state, and mount
 *      `levelUpSurface` to draw the card and take its OK.
 */
export class LevelUpDialog {
  private queue: LevelUpEntry[] = [];
  private current: LevelUpEntry | null = null;
  private phase: Phase = 'idle';
  private frame = 0;

  private displayedLevel = 0;
  private iconPulse = 0;

  private readonly POWER_UP_FRAMES = 60;
  private readonly COUNT_UP_FRAMES = 20;

  audio: AudioManager | null = null;

  /** Returns true while a level-up animation is visible (game should pause). */
  get isShowing(): boolean {
    return this.phase !== 'idle';
  }

  /** Push a new level-up event onto the queue. */
  enqueue(entry: LevelUpEntry): void {
    this.queue.push(entry);
    if (this.phase === 'idle') this.advance();
  }

  private advance(): void {
    const next = this.queue.shift();
    if (!next) {
      this.phase = 'idle';
      this.current = null;
      return;
    }
    this.current = next;
    this.displayedLevel = next.newLevel - 1;
    this.phase = 'power_up';
    this.frame = 0;
    this.iconPulse = 0;
  }

  update(): void {
    if (this.phase === 'idle') return;
    this.frame++;

    if (this.phase === 'power_up') {
      this.iconPulse = this.frame / this.POWER_UP_FRAMES;
      if (this.frame >= this.POWER_UP_FRAMES) {
        this.phase = 'count_up';
        this.frame = 0;
      }
    } else if (this.phase === 'count_up') {
      const progress = this.frame / this.COUNT_UP_FRAMES;
      if (this.current && progress >= 1) {
        this.displayedLevel = this.current.newLevel;
        this.phase = 'done';
      }
    }
  }

  /** The card on screen, or null when none is. */
  get view(): LevelUpView | null {
    const entry = this.current;
    if (this.phase === 'idle' || entry === null) return null;
    return {
      entry,
      poweringUp: this.phase === 'power_up',
      iconPulse: this.iconPulse,
      displayedLevel: this.displayedLevel,
      countUpProgress: this.phase === 'count_up' ? this.frame / this.COUNT_UP_FRAMES : 1,
      settled: this.phase === 'done',
    };
  }

  /** OK: moves on to the next queued level-up, or closes. Ignored until the count-up has landed. */
  acknowledge(): void {
    if (this.phase === 'done') this.advance();
  }
}
