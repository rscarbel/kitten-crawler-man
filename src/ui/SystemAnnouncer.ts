/**
 * The System's own voice: a queued, self-dismissing notice box.
 *
 * Shares `DialogBox`'s look with the AI adapter's messages (`AIMessageDisplay`)
 * because in-fiction they are the same speaker — but this one is driven purely by
 * gameplay, so skill unlocks still announce themselves in a session with the AI
 * server switched off.
 */

import { DialogBox } from './DialogBox';
import type { AudioManager } from '../audio/AudioManager';

/** Floor on display time, so a two-word notice is still readable. */
const MIN_DISPLAY_TICKS = 260;
/** Reading pace: ~4 words per second at 60 fps. */
const TICKS_PER_WORD = 15;
/** Ticks spent fading out at the end of a notice's life. */
const FADE_TICKS = 45;
/** Beyond this, older queued notices are dropped rather than backing up for a minute. */
const MAX_QUEUED = 4;
/**
 * Lifts the System box clear of the conversation box below it. Every `DialogBox`
 * lands on the same rectangle just above the hotbar, so without this a skill
 * announcement fired mid-conversation would render exactly on top of the AI
 * adapter's message, a Bopca, or Mordecai.
 */
const SYSTEM_BOX_Y_OFFSET = 186;

function displayTicksFor(text: string): number {
  const wordCount = text.trim().split(/\s+/).length;
  return Math.max(MIN_DISPLAY_TICKS, wordCount * TICKS_PER_WORD);
}

export class SystemAnnouncer {
  private readonly queue: string[] = [];
  private ticksLeft = 0;
  private readonly dialogBox: DialogBox;

  constructor(audio: AudioManager | null) {
    this.dialogBox = new DialogBox(audio, {
      speakerName: '⚙ System AI',
      revealMode: 'sentence',
      showFooterHint: false,
      yOffset: SYSTEM_BOX_Y_OFFSET,
    });
  }

  /** Queue a notice. Shown as soon as the current one finishes. */
  announce(text: string): void {
    this.queue.push(text);
    while (this.queue.length > MAX_QUEUED) this.queue.shift();
  }

  get isShowing(): boolean {
    return this.ticksLeft > 0;
  }

  update(): void {
    if (this.ticksLeft > 0) {
      this.ticksLeft--;
      if (this.ticksLeft === 0) this.dialogBox.hide();
    }
    if (this.ticksLeft === 0 && this.queue.length > 0) {
      const next = this.queue.shift();
      if (next !== undefined) {
        this.ticksLeft = displayTicksFor(next);
        this.dialogBox.show(next);
      }
    }
    this.dialogBox.update();
  }

  render(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    if (this.ticksLeft === 0) return;
    const alpha = this.ticksLeft < FADE_TICKS ? this.ticksLeft / FADE_TICKS : 1;
    this.dialogBox.render(ctx, canvas, alpha);
  }

  /** Drop everything pending — used on scene teardown. */
  clear(): void {
    this.queue.length = 0;
    this.ticksLeft = 0;
    this.dialogBox.hide();
  }
}
