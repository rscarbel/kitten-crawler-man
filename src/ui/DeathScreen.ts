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

    ctx.fillStyle = `rgba(0,0,0,${this.alpha})`;
    ctx.fillRect(0, 0, w, h);

    if (this.alpha < 0.45) return;
    const textAlpha = Math.min(1, (this.alpha - 0.45) / 0.37);

    ctx.save();
    ctx.globalAlpha = textAlpha;
    ctx.textAlign = 'center';

    // "YOU DIED"
    ctx.fillStyle = '#dc2626';
    ctx.font = 'bold 72px monospace';
    ctx.fillText('YOU DIED', w / 2, h / 2 - 52);

    // Subtitle
    ctx.fillStyle = '#94a3b8';
    ctx.font = '15px monospace';
    ctx.fillText(
      'Respawning at floor start — progress from previous floors kept.',
      w / 2,
      h / 2 + 8,
    );

    // Restart button
    const btnW = 210;
    const btnH = 48;
    const btnX = w / 2 - btnW / 2;
    const btnY = h / 2 + 44;
    ctx.fillStyle = '#991b1b';
    ctx.fillRect(btnX, btnY, btnW, btnH);
    ctx.strokeStyle = '#f87171';
    ctx.lineWidth = 2;
    ctx.strokeRect(btnX, btnY, btnW, btnH);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 17px monospace';
    ctx.fillText('Restart Level', w / 2, btnY + 30);

    ctx.restore();
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
