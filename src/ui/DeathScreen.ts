import { drawText } from './TextBox';
import { drawOverlay } from './Box';
import { drawButton, BUTTON_PRESETS } from './Button';
import type { AudioManager } from '../audio/AudioManager';

const ALPHA_VISIBILITY_THRESHOLD = 0.5;
const ALPHA_MAX = 0.82;
const ALPHA_INCREMENT_PER_FRAME = 0.018;
const TEXT_ALPHA_START_THRESHOLD = 0.45;
const TEXT_ALPHA_FADE_RANGE = 0.37;
const YOU_DIED_OFFSET_Y_1 = 52;
const YOU_DIED_OFFSET_Y_2 = 58;
const SUBTITLE_MAX_WIDTH = 400;
const SUBTITLE_PADDING = 32;
const SUBTITLE_Y_OFFSET_1 = 8;
const SUBTITLE_Y_OFFSET_2 = 12;
const SUBTITLE_FONT_SIZE = 15;
const SUBTITLE_LINE_HEIGHT = 20;
const BUTTON_WIDTH = 210;
const BUTTON_HEIGHT = 48;
const BUTTON_Y_OFFSET = 44;
const BUTTON_LABEL_SIZE = 17;
const YOU_DIED_FONT_SIZE = 72;

/**
 * Manages the "YOU DIED" overlay: fade-in alpha, rendering, and restart
 * button hit-testing. The caller is responsible for calling tick() each frame
 * (can be done inside render()) and checking handleClick() on canvas clicks.
 */
export class DeathScreen {
  private alpha = 0;
  private _active = false;
  private _btnResult: { x: number; y: number; width: number; height: number } | null = null;
  audio: AudioManager | null = null;

  /** Activate the death screen — begins the fade-in from alpha 0. */
  activate(): void {
    this._active = true;
    this.alpha = 0;
  }

  /** Reset to inactive state (call on game restart). */
  reset(): void {
    this._active = false;
    this.alpha = 0;
  }

  get isActive(): boolean {
    return this._active;
  }

  /** True once the overlay is opaque enough to show interactive elements. */
  get isVisible(): boolean {
    return this._active && this.alpha >= ALPHA_VISIBILITY_THRESHOLD;
  }

  /** Advance the fade-in alpha by one frame. */
  tick(): void {
    if (!this._active) return;
    if (this.alpha < ALPHA_MAX)
      this.alpha = Math.min(ALPHA_MAX, this.alpha + ALPHA_INCREMENT_PER_FRAME);
  }

  render(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    if (!this._active) return;

    this.tick();

    const w = canvas.width;
    const h = canvas.height;

    drawOverlay(ctx, { canvasWidth: w, canvasHeight: h, alpha: this.alpha });

    if (this.alpha < TEXT_ALPHA_START_THRESHOLD) return;
    const textAlpha = Math.min(
      1,
      (this.alpha - TEXT_ALPHA_START_THRESHOLD) / TEXT_ALPHA_FADE_RANGE,
    );

    // "YOU DIED"
    drawText(ctx, 'YOU DIED', {
      x: w / 2,
      y: h / 2 - YOU_DIED_OFFSET_Y_1 - YOU_DIED_OFFSET_Y_2,
      bold: true,
      size: YOU_DIED_FONT_SIZE,
      color: '#dc2626',
      align: 'center',
      alpha: textAlpha,
    });

    // Subtitle
    const subtitleW = Math.min(SUBTITLE_MAX_WIDTH, w - SUBTITLE_PADDING);
    drawText(ctx, 'Respawning at floor start — progress from previous floors kept.', {
      x: w / 2 - subtitleW / 2,
      y: h / 2 + SUBTITLE_Y_OFFSET_1 - SUBTITLE_Y_OFFSET_2,
      size: SUBTITLE_FONT_SIZE,
      color: '#94a3b8',
      align: 'center',
      width: subtitleW,
      lineHeight: SUBTITLE_LINE_HEIGHT,
      alpha: textAlpha,
    });

    // Restart button
    const btnW = BUTTON_WIDTH;
    const btnH = BUTTON_HEIGHT;
    const btnX = w / 2 - btnW / 2;
    const btnY = h / 2 + BUTTON_Y_OFFSET;
    this._btnResult = drawButton(ctx, {
      x: btnX,
      y: btnY,
      width: btnW,
      height: btnH,
      label: 'Restart Level',
      ...BUTTON_PRESETS.danger,
      labelSize: BUTTON_LABEL_SIZE,
      alpha: textAlpha,
    });
  }

  /**
   * Returns true if the click landed on the restart button.
   * Only meaningful when isVisible === true.
   */
  handleClick(mx: number, my: number): boolean {
    if (!this.isVisible) return false;
    const btn = this._btnResult;
    if (btn && mx >= btn.x && mx <= btn.x + btn.width && my >= btn.y && my <= btn.y + btn.height) {
      return true;
    }
    return false;
  }

  /** Space bar counts as clicking the restart button once the screen is visible. */
  handleSpaceBar(): boolean {
    return this.isVisible;
  }
}
