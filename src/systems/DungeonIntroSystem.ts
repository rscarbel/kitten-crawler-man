import interfacesManifest from '../images/interfaces/manifest.json';
import { drawOverlay } from '../ui/Box';

const HOLD_FRAMES = 125;
const FADE_OUT_FRAMES = 80;
const TOTAL_FRAMES = HOLD_FRAMES + FADE_OUT_FRAMES;

// Load once at module level — shared across scene transitions
const _img = new Image();
_img.src = 'src/images/' + interfacesManifest['find-the-stairwell'].path;

export class DungeonIntroSystem {
  private frame = 0;

  get isActive(): boolean {
    return this.frame < TOTAL_FRAMES;
  }

  /** Ends the banner immediately — used when re-entering a level that was already introduced (e.g. leaving a building). */
  skip(): void {
    this.frame = TOTAL_FRAMES;
  }

  tick(): void {
    if (this.isActive) this.frame++;
  }

  render(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    if (!this.isActive || !_img.complete || _img.naturalWidth === 0) return;

    const cw = canvas.width;
    const ch = canvas.height;

    const alpha = this.frame < HOLD_FRAMES ? 1 : 1 - (this.frame - HOLD_FRAMES) / FADE_OUT_FRAMES;

    const OVERLAY_ALPHA_MULT = 0.52;
    drawOverlay(ctx, {
      canvasWidth: cw,
      canvasHeight: ch,
      color: '#000',
      alpha: alpha * OVERLAY_ALPHA_MULT,
    });

    const aspectRatio = _img.naturalHeight / _img.naturalWidth;
    const widthCappedH = Math.round(cw * aspectRatio);
    const imgW = widthCappedH <= ch ? cw : Math.round(ch / aspectRatio);
    const imgH = Math.round(imgW * aspectRatio);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(_img, Math.round((cw - imgW) / 2), Math.round((ch - imgH) / 2), imgW, imgH);
    ctx.restore();
  }
}
