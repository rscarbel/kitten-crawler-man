/**
 * Small outlined one-liners stacked just above the hotbar.
 *
 * Deliberately not a `DialogBox`: these fire mid-fight for things the player
 * needs to read without losing sight of the room, so they are text and nothing
 * else. The outline is what carries them over whatever the world draws behind.
 */

import { drawText } from './TextBox';

/** How long a notice stays up — 2.5s at 60 fps, a glance without being a fixture. */
const DISPLAY_TICKS = 150;
/** Ticks spent fading out at the end of a notice's life. */
const FADE_TICKS = 30;
/** Beyond this, the oldest notice is dropped rather than growing the stack up the screen. */
const MAX_VISIBLE = 3;
const GAP_ABOVE_HOTBAR = 10;
const LINE_HEIGHT = 17;
const FONT_SIZE = 13;
const TEXT_COLOR = '#f8fafc';
const OUTLINE_COLOR = 'rgba(0,0,0,0.9)';
const OUTLINE_WIDTH = 4;

interface Notice {
  text: string;
  ticksLeft: number;
}

export class HotbarToast {
  private readonly notices: Notice[] = [];

  /**
   * Show a line above the hotbar. Re-showing a line that is already up restarts
   * its timer rather than stacking a second copy of the same words — and moves
   * it back to the newest row, because `render` reads the array as oldest-first
   * and a refreshed line outliving the one below it would shuffle the rows.
   */
  show(text: string): void {
    const alreadyShowingIndex = this.notices.findIndex((notice) => notice.text === text);
    if (alreadyShowingIndex !== -1) this.notices.splice(alreadyShowingIndex, 1);
    this.notices.push({ text, ticksLeft: DISPLAY_TICKS });
    while (this.notices.length > MAX_VISIBLE) this.notices.shift();
  }

  update(): void {
    for (const notice of this.notices) notice.ticksLeft--;
    const surviving = this.notices.filter((notice) => notice.ticksLeft > 0);
    if (surviving.length === this.notices.length) return;
    this.notices.length = 0;
    this.notices.push(...surviving);
  }

  /**
   * @param hotbarBandHeight Height of the screen band the hotbar occupies,
   *   measured up from the bottom of the canvas — see
   *   `InventoryPanel.hotbarBandHeight`, which accounts for the bar shrinking on
   *   narrow canvases.
   */
  render(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, hotbarBandHeight: number): void {
    if (this.notices.length === 0) return;
    const bottomRowY = canvas.height - hotbarBandHeight - GAP_ABOVE_HOTBAR - FONT_SIZE;
    const centerX = canvas.width / 2;
    const newestIndex = this.notices.length - 1;

    this.notices.forEach((notice, index) => {
      // Newest sits closest to the bar, so an arriving line never shoves the one
      // the player is mid-way through reading.
      const rowsAboveBottom = newestIndex - index;
      const fading = notice.ticksLeft < FADE_TICKS;
      drawText(ctx, notice.text, {
        x: centerX,
        y: bottomRowY - rowsAboveBottom * LINE_HEIGHT,
        size: FONT_SIZE,
        bold: true,
        align: 'center',
        color: TEXT_COLOR,
        outline: OUTLINE_COLOR,
        outlineWidth: OUTLINE_WIDTH,
        alpha: fading ? notice.ticksLeft / FADE_TICKS : 1,
      });
    });
  }

  /** Drop everything on screen — used on scene teardown. */
  clear(): void {
    this.notices.length = 0;
  }
}
