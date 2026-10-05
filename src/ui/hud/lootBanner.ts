/**
 * The safe room's call to come and collect: unread achievements first, then
 * loot boxes waiting to be opened. A tappable bar in the top band, glowing
 * gold so it reads as something waiting for the player.
 */

import { centerIn, inset, type Rect } from '../core/geom';
import type { Ui } from '../core/UiRoot';
import { drawGlyph } from '../theme/glyphs';
import { skinsFor } from '../theme/skins';
import { strokeRounded } from '../widgets/paint';
import { text } from '../widgets/text';
import type { LootBannerModel } from './hudModel';
import { topBandCard, topBandCardPadding, type TopBandEntry } from './topBand';
import { TOP_BAND_WIDTH } from './topBandStack';

const PULSE_MS = 1400;
const GLOW_MIN = 0.4;
const FULL_TURN = Math.PI * 2;
const GLOW_EDGE_WIDTH = 1.5;

export function lootBannerEntry(model: LootBannerModel): TopBandEntry {
  return {
    id: 'loot-banner',
    priority: 'banner',
    maxWidth: TOP_BAND_WIDTH.regular,
    height: (ui) => topBandCardPadding(ui) + ui.theme.size.control,
    render: (ui, rect) => renderLootBanner(ui, rect, model),
  };
}

function renderLootBanner(ui: Ui, rect: Rect, model: LootBannerModel): void {
  const { ctx, theme } = ui;
  const { palette, space } = theme;
  const act = (): void => model.onTap();
  const state = ui.hit('loot-banner', rect, {
    onTap: act,
    focusable: false,
  });
  const edge = state.hovered ? palette.accent.hover : palette.accent.base;
  const body = topBandCard(ui, rect, { accent: edge });
  const beat = (Math.sin((ui.now / PULSE_MS) * FULL_TURN) + 1) / 2;
  ctx.save();
  ctx.shadowColor = palette.accent.base;
  ctx.shadowBlur = space.lg * (GLOW_MIN + beat);
  strokeRounded(ctx, rect, skinsFor(theme).panel.hud.radius, edge, GLOW_EDGE_WIDTH);
  ctx.restore();
  const glyph = Math.min(body.h, theme.size.icon + space.sm);
  drawGlyph(ctx, model.glyph, centerIn({ ...body, w: glyph }, glyph, glyph), {
    color: palette.accent.base,
  });
  const words = inset(body, { l: glyph + space.sm });
  const [titleRow, detailRow] = [
    { ...words, h: words.h / 2 },
    { ...words, y: words.y + words.h / 2, h: words.h / 2 },
  ];
  text(ui, titleRow, { text: model.title, role: 'accent' });
  text(ui, detailRow, { text: model.detail, role: 'caption', tabular: true });
}
