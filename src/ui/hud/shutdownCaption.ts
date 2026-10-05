/**
 * The spider lab's shutdown cutscene chrome: the screen dims while it plays,
 * and a glowing caption fades out over its opening beat.
 */

import { viewportHeight, viewportWidth } from '../../core/Viewport';
import { chromeTarget } from '../screens/dialogs/canvasChrome';
import { text } from '../widgets/text';

const CUTSCENE_DIM_ALPHA = 0.35;
const CAPTION_RISE_ABOVE_CENTRE = 20;
const CAPTION_GLOW_BLUR = 10;
const HALF = 0.5;

const CAPTION = 'Initiating Shutdown Sequence...';

/**
 * Dims the screen for the cutscene and, while `captionAlpha` is above zero,
 * draws the shutdown caption at that opacity. Paints onto a CSS-pixel context.
 */
export function paintShutdownCutscene(ctx: CanvasRenderingContext2D, captionAlpha: number): void {
  const target = chromeTarget(ctx);
  const { palette, type } = target.theme;
  const width = viewportWidth();
  const height = viewportHeight();

  if (captionAlpha > 0) {
    const style = type.heading;
    const accent = palette.accent.base;
    ctx.save();
    ctx.globalAlpha = captionAlpha;
    ctx.shadowColor = accent;
    ctx.shadowBlur = CAPTION_GLOW_BLUR;
    text(
      target,
      {
        x: 0,
        y: height * HALF - CAPTION_RISE_ABOVE_CENTRE,
        w: width,
        h: style.lineHeight,
      },
      { text: CAPTION, role: 'heading', color: accent, align: 'center' },
    );
    ctx.restore();
  }

  ctx.save();
  ctx.globalAlpha = CUTSCENE_DIM_ALPHA;
  ctx.fillStyle = palette.surface.sunken;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}
