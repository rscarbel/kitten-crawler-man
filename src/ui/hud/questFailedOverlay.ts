/**
 * The full-screen "QUEST FAILED" card a quest raises over live play: a dimmed
 * floor, a red cross, the verdict and how to dismiss it.
 */

import type { Rect } from '../core/geom';
import { byInputMode, keyLabel, type InputMode } from '../core/inputMode';
import type { PaintTarget } from '../widgets/paint';
import { text } from '../widgets/text';

const FLOOR_DIM_ALPHA = 0.6;
const CROSS_HALF_SIZE = 60;
const CROSS_RISE_ABOVE_CENTRE = 60;
const CROSS_LINE_WIDTH = 8;
const TITLE_DROP_BELOW_CENTRE = 50;
const HINT_DROP_BELOW_CENTRE = 80;
const TITLE_GLOW_BLUR = 15;
const HALF = 0.5;

const TITLE = 'QUEST FAILED';

/** Paints the card over `screen` at `alpha` (0–1, for its fade in and out). */
export function questFailedOverlay(
  ui: PaintTarget,
  screen: Rect,
  mode: InputMode,
  alpha: number,
): void {
  const { ctx } = ui;
  const { palette, type } = ui.theme;
  const centreX = screen.x + screen.w * HALF;
  const centreY = screen.y + screen.h * HALF;
  const danger = palette.state.danger;

  ctx.save();
  ctx.globalAlpha = alpha * FLOOR_DIM_ALPHA;
  ctx.fillStyle = palette.surface.sunken;
  ctx.fillRect(screen.x, screen.y, screen.w, screen.h);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = alpha;
  const crossY = centreY - CROSS_RISE_ABOVE_CENTRE;
  ctx.strokeStyle = danger;
  ctx.lineWidth = CROSS_LINE_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(centreX - CROSS_HALF_SIZE, crossY - CROSS_HALF_SIZE);
  ctx.lineTo(centreX + CROSS_HALF_SIZE, crossY + CROSS_HALF_SIZE);
  ctx.moveTo(centreX + CROSS_HALF_SIZE, crossY - CROSS_HALF_SIZE);
  ctx.lineTo(centreX - CROSS_HALF_SIZE, crossY + CROSS_HALF_SIZE);
  ctx.stroke();

  const titleStyle = type.display;
  ctx.shadowColor = danger;
  ctx.shadowBlur = TITLE_GLOW_BLUR;
  text(
    ui,
    {
      x: screen.x,
      y: centreY + TITLE_DROP_BELOW_CENTRE - titleStyle.lineHeight,
      w: screen.w,
      h: titleStyle.lineHeight,
    },
    { text: TITLE, role: 'heading', style: titleStyle, color: danger, align: 'center' },
  );
  ctx.shadowBlur = 0;

  const hintStyle = type.caption;
  const dismissHint = byInputMode(mode, {
    touch: 'Tap to dismiss',
    pointer: `${keyLabel('attack')} or click to dismiss`,
  });
  text(
    ui,
    {
      x: screen.x,
      y: centreY + HINT_DROP_BELOW_CENTRE - hintStyle.lineHeight,
      w: screen.w,
      h: hintStyle.lineHeight,
    },
    { text: dismissHint, role: 'caption', color: palette.text.secondary, align: 'center' },
  );
  ctx.restore();
}
