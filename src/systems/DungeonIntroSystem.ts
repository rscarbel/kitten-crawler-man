import { drawOverlay } from '../ui/Box';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { getSpriteDefByKey } from '../core/SpriteLoader';

const HOLD_FRAMES = 125;
const FADE_OUT_FRAMES = 80;
const TOTAL_FRAMES = HOLD_FRAMES + FADE_OUT_FRAMES;

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

  render(ctx: CanvasRenderingContext2D): void {
    if (!this.isActive) return;
    // Routed through SpriteLoader (Phase 5 of docs/asset-management-plan.md)
    // instead of a standalone `new Image()` — undefined until the `core`
    // group has loaded it, in which case this frame (and maybe the next
    // couple) just shows no banner, same as any other sprite miss.
    const img = getSpriteDefByKey('find-the-stairwell')?.img;
    // `img` only ever reaches `_defs` (and so is only ever returned here) after
    // `ensureLoading`'s onload finished populating it — a Phase 8 downscale, if
    // one happened, is drawn synchronously before that point too — so by the
    // time this getter returns something, it is always ready to draw. The
    // width check alone (rather than `<img>`-only `.complete`/`.naturalWidth`,
    // which a Phase 8 `<canvas>` doesn't have) guards the one degenerate case:
    // a 0×0 source, which `drawImage` would otherwise throw on.
    if (img === undefined || img.width === 0) return;

    const cw = viewportWidth();
    const ch = viewportHeight();

    const alpha = this.frame < HOLD_FRAMES ? 1 : 1 - (this.frame - HOLD_FRAMES) / FADE_OUT_FRAMES;

    const OVERLAY_ALPHA_MULT = 0.52;
    drawOverlay(ctx, {
      canvasWidth: cw,
      canvasHeight: ch,
      color: '#000',
      alpha: alpha * OVERLAY_ALPHA_MULT,
    });

    const aspectRatio = img.height / img.width;
    const widthCappedH = Math.round(cw * aspectRatio);
    const imgW = widthCappedH <= ch ? cw : Math.round(ch / aspectRatio);
    const imgH = Math.round(imgW * aspectRatio);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, Math.round((cw - imgW) / 2), Math.round((ch - imgH) / 2), imgW, imgH);
    ctx.restore();
  }
}
