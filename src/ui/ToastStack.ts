/**
 * A self-expiring stack of one-line notices, drawn upward from an anchor.
 *
 * Two very different widgets are the same thing underneath: the hotbar's notices
 * and the flags over Mongo's Summon button. Both fire mid-fight for something
 * the player must read without losing sight of the room, both stack rather than
 * overwrite — a notice replaced faster than it can be read tells the player
 * nothing — and both fade on their own so nothing has to dismiss them.
 *
 * What differs is only where they hang and what they look like, so that is all
 * a caller supplies. Anchoring is left to the caller entirely: one of these is
 * pinned to the screen and the other to a button that moves with the layout.
 */

import { drawText } from './TextBox';

export interface ToastStackStyle {
  /** How long a notice stays up, in ticks. */
  readonly displayTicks: number;
  /** Ticks at the end of a notice's life spent fading out. */
  readonly fadeTicks: number;
  /** Beyond this the oldest is dropped rather than growing the stack up-screen. */
  readonly maxVisible: number;
  readonly fontSize: number;
  /** Row pitch. Above the font size, or the rows touch. */
  readonly lineHeight: number;
  readonly color: string;
  /** These are drawn over the world, so the stroke is what carries them. */
  readonly outline: boolean | string;
  readonly outlineWidth?: number;
}

interface Toast {
  readonly text: string;
  /** Multiplier on the stack's font size and row pitch for this one line. */
  readonly scale: number;
  ticksLeft: number;
}

export class ToastStack {
  /** Oldest first. {@link render} puts the newest closest to the anchor. */
  private readonly toasts: Toast[] = [];

  constructor(private readonly style: ToastStackStyle) {}

  get isEmpty(): boolean {
    return this.toasts.length === 0;
  }

  /**
   * Push a line onto the stack.
   *
   * @param mergeDuplicates Restart the timer on a line already showing these
   *   exact words instead of stacking a second copy, and move it back to the
   *   newest row so a refreshed line cannot outlive the one below it and shuffle
   *   the rows. Wrong for a line whose repetition is the information — three
   *   identical `-1.2s` flags mean three kills, and merging them would report
   *   one.
   */
  show(text: string, mergeDuplicates = false, scale = 1): void {
    if (mergeDuplicates) {
      const showingIndex = this.toasts.findIndex((toast) => toast.text === text);
      if (showingIndex !== -1) this.toasts.splice(showingIndex, 1);
    }
    this.toasts.push({ text, scale, ticksLeft: this.style.displayTicks });
    while (this.toasts.length > this.style.maxVisible) this.toasts.shift();
  }

  update(): void {
    // Backwards, because the expired ones are spliced out as we go.
    for (let i = this.toasts.length - 1; i >= 0; i--) {
      const toast = this.toasts[i];
      toast.ticksLeft--;
      if (toast.ticksLeft <= 0) this.toasts.splice(i, 1);
    }
  }

  /**
   * @param centerX      Horizontal centre every row is aligned on.
   * @param bottomRowTopY Top edge of an unscaled bottom (newest) row. Rows
   *   stack upward from its bottom edge, each one `lineHeight` × its own scale
   *   tall, so the stack grows away from whatever this is anchored to rather
   *   than over it — a scaled-up line included.
   */
  render(ctx: CanvasRenderingContext2D, centerX: number, bottomRowTopY: number): void {
    let rowBottomY = bottomRowTopY + this.style.fontSize;
    // Newest closest to the anchor, so an arriving line never shoves the one
    // the player is mid-way through reading.
    for (let index = this.toasts.length - 1; index >= 0; index--) {
      const toast = this.toasts[index];
      const fontSize = this.style.fontSize * toast.scale;
      const fading = toast.ticksLeft < this.style.fadeTicks;
      drawText(ctx, toast.text, {
        x: centerX,
        y: rowBottomY - fontSize,
        size: fontSize,
        bold: true,
        align: 'center',
        color: this.style.color,
        outline: this.style.outline,
        outlineWidth: this.style.outlineWidth,
        alpha: fading ? toast.ticksLeft / this.style.fadeTicks : 1,
      });
      rowBottomY -= this.style.lineHeight * toast.scale;
    }
  }

  /** Drop everything on screen — used on scene teardown. */
  clear(): void {
    this.toasts.length = 0;
  }
}
