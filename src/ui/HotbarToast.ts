/**
 * Small outlined one-liners stacked just above the hotbar.
 *
 * Deliberately not a `DialogBox`: these fire mid-fight for things the player
 * needs to read without losing sight of the room, so they are text and nothing
 * else. The outline is what carries them over whatever the world draws behind.
 */

import { ToastStack } from './ToastStack';
import { viewportWidth, viewportHeight } from '../core/Viewport';

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

export class HotbarToast {
  private readonly stack = new ToastStack({
    displayTicks: DISPLAY_TICKS,
    fadeTicks: FADE_TICKS,
    maxVisible: MAX_VISIBLE,
    fontSize: FONT_SIZE,
    lineHeight: LINE_HEIGHT,
    color: TEXT_COLOR,
    outline: OUTLINE_COLOR,
    outlineWidth: OUTLINE_WIDTH,
  });

  /**
   * Show a line above the hotbar. Re-showing a line that is already up restarts
   * its timer rather than stacking a second copy of the same words — these are
   * sentences, and the same sentence twice is the same information twice.
   */
  show(text: string): void {
    this.stack.show(text, true);
  }

  update(): void {
    this.stack.update();
  }

  /**
   * @param hotbarBandHeight Height of the screen band the hotbar occupies,
   *   measured up from the bottom of the canvas — see
   *   `InventoryPanel.hotbarBandHeight`, which accounts for the bar shrinking on
   *   narrow canvases.
   */
  render(ctx: CanvasRenderingContext2D, hotbarBandHeight: number): void {
    if (this.stack.isEmpty) return;
    const bottomRowY = viewportHeight() - hotbarBandHeight - GAP_ABOVE_HOTBAR - FONT_SIZE;
    this.stack.render(ctx, viewportWidth() / 2, bottomRowY);
  }

  /** Drop everything on screen — used on scene teardown. */
  clear(): void {
    this.stack.clear();
  }
}
