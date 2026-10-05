/**
 * The party's purse under the unit frames: a coin glyph and the amount, with
 * the split between the crawlers shown on hover. Swells briefly as each
 * flying coin lands.
 */

import { centerIn, type Rect } from '../core/geom';
import type { Ui } from '../core/UiRoot';
import { drawGlyph } from '../theme/glyphs';
import { skinsFor } from '../theme/skins';
import { drawGlass } from '../widgets/paint';
import { measureText, tabularNumber } from '../widgets/text';
import { tooltip } from '../widgets/tooltip';
import type { CoinModel } from './hudModel';

/** Peak extra scale of the landing swell. */
const PULSE_SCALE = 0.18;

/** Draws the pill from `slot`'s top-left corner, sized to the amount. Returns the drawn pill. */
export function coinPill(ui: Ui, slot: Rect, model: CoinModel): Rect {
  const { ctx, theme } = ui;
  const { space, palette } = theme;
  const icon = theme.size.icon;
  const amount = model.shown.toLocaleString();
  const amountW = measureText(ui, amount, { role: 'label', tabular: true });
  const pill: Rect = {
    x: slot.x,
    y: slot.y,
    w: Math.ceil(space.sm + icon + space.xs + amountW + space.md),
    h: slot.h,
  };
  const state = ui.hit('coins', pill, { focusable: false });
  const scale = 1 + model.pulse * PULSE_SCALE;
  ctx.save();
  if (scale !== 1) {
    const pivotX = pill.x + space.sm + icon / 2;
    const pivotY = pill.y + pill.h / 2;
    ctx.translate(pivotX, pivotY);
    ctx.scale(scale, scale);
    ctx.translate(-pivotX, -pivotY);
  }
  const skin = skinsFor(theme).panel.hud;
  drawGlass(ui, pill, { ...skin, radius: theme.radius.pill });
  drawGlyph(
    ctx,
    'coin',
    centerIn({ x: pill.x + space.sm, y: pill.y, w: icon, h: pill.h }, icon, icon),
    { color: model.pulse > 0 ? palette.accent.hover : palette.accent.base },
  );
  tabularNumber(
    ui,
    { x: pill.x + space.sm + icon + space.xs, y: pill.y, w: amountW + space.xs, h: pill.h },
    { value: amount, role: 'label' },
  );
  ctx.restore();
  tooltip(ui, pill, { id: 'coins/tip', title: 'Coins', text: model.split, show: state.hovered });
  return pill;
}
