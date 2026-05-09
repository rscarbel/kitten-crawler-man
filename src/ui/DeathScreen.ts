import { drawText } from './TextBox';
import { drawOverlay, drawBox, BOX_PRESETS } from './Box';

/**
 * Manages the "YOU DIED" overlay: fade-in alpha, rendering, and restart
 * button hit-testing. The caller is responsible for calling tick() each frame
 * (can be done inside render()) and checking handleClick() on canvas clicks.
 */
export class DeathScreen {
  private alpha = 0;
  private _active = false;

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
    return this._active && this.alpha >= 0.5;
  }

  /** Advance the fade-in alpha by one frame. */
  tick(): void {
    if (!this._active) return;
    if (this.alpha < 0.82) this.alpha = Math.min(0.82, this.alpha + 0.018);
  }

  render(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    if (!this._active) return;

    this.tick();

    const w = canvas.width;
    const h = canvas.height;

    drawOverlay(ctx, { canvasWidth: w, canvasHeight: h, alpha: this.alpha });

    if (this.alpha < 0.45) return;
    const textAlpha = Math.min(1, (this.alpha - 0.45) / 0.37);

    // "YOU DIED"
    drawText(ctx, 'YOU DIED', {
      x: w / 2,
      y: h / 2 - 52 - 58,
      bold: true,
      size: 72,
      color: '#dc2626',
      align: 'center',
      alpha: textAlpha,
    });

    // Subtitle
    drawText(ctx, 'Respawning at floor start — progress from previous floors kept.', {
      x: w / 2,
      y: h / 2 + 8 - 12,
      size: 15,
      color: '#94a3b8',
      align: 'center',
      alpha: textAlpha,
    });

    // Restart button
    const btnW = 210;
    const btnH = 48;
    const btnX = w / 2 - btnW / 2;
    const btnY = h / 2 + 44;
    drawBox(ctx, {
      x: btnX,
      y: btnY,
      width: btnW,
      height: btnH,
      ...BOX_PRESETS.buttonDanger,
      alpha: textAlpha,
    });

    drawText(ctx, 'Restart Level', {
      x: w / 2,
      y: btnY + 30 - 14,
      bold: true,
      size: 17,
      color: '#fff',
      align: 'center',
      alpha: textAlpha,
    });
  }

  /**
   * Returns true if the click landed on the restart button.
   * Only meaningful when isVisible === true.
   */
  handleClick(mx: number, my: number, canvas: HTMLCanvasElement): boolean {
    if (!this.isVisible) return false;
    const w = canvas.width;
    const h = canvas.height;
    const btnW = 210,
      btnH = 48;
    const btnX = w / 2 - btnW / 2;
    const btnY = h / 2 + 44;
    return mx >= btnX && mx <= btnX + btnW && my >= btnY && my <= btnY + btnH;
  }
}
