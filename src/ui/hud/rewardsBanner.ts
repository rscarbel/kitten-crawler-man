/**
 * The safe room's banner for rewards waiting: a wide, glowing bar in the top
 * band that opens the Reward Chest screen when tapped. It never opens the
 * screen by itself, and the dock's rewards chip opens the same screen
 * anywhere; the banner only makes the call louder while the party is safe.
 */

import { centerIn, inset, type Rect } from '../core/geom';
import { tapVerb } from '../core/inputMode';
import type { Ui } from '../core/UiRoot';
import { drawGlyph } from '../theme/glyphs';
import { skinsFor } from '../theme/skins';
import { strokeRounded } from '../widgets/paint';
import { text } from '../widgets/text';
import { topBandCard, topBandCardPadding, type TopBandEntry } from './topBand';
import { TOP_BAND_WIDTH } from './topBandStack';

const PULSE_MS = 1400;
const GLOW_MIN = 0.4;
const FULL_TURN = Math.PI * 2;
const GLOW_EDGE_WIDTH = 1.5;
const HALF = 0.5;

/** The banner's top-band entry id, unique in the band. */
const REWARDS_BANNER_ENTRY_ID = 'rewards-banner';

/** What the banner shows and does. */
export interface RewardsBannerModel {
  /** Rewards waiting, across both crawlers. */
  readonly count: number;
  onTap(): void;
}

export function rewardsBannerEntry(model: RewardsBannerModel): TopBandEntry {
  return {
    id: REWARDS_BANNER_ENTRY_ID,
    priority: 'banner',
    maxWidth: TOP_BAND_WIDTH.regular,
    height: (ui) => topBandCardPadding(ui) + ui.theme.size.control,
    render: (ui, rect) => renderRewardsBanner(ui, rect, model),
  };
}

function renderRewardsBanner(ui: Ui, rect: Rect, model: RewardsBannerModel): void {
  const { ctx, theme } = ui;
  const { palette, space } = theme;
  const state = ui.hit('rewards-banner', rect, { onTap: () => model.onTap(), focusable: false });
  const edge = state.hovered ? palette.accent.hover : palette.accent.base;
  const body = topBandCard(ui, rect, { accent: edge });
  const beat = (Math.sin((ui.now / PULSE_MS) * FULL_TURN) + 1) * HALF;
  ctx.save();
  ctx.shadowColor = palette.accent.base;
  ctx.shadowBlur = space.lg * (GLOW_MIN + beat);
  strokeRounded(ctx, rect, skinsFor(theme).panel.hud.radius, edge, GLOW_EDGE_WIDTH);
  ctx.restore();
  const glyph = Math.min(body.h, theme.size.icon + space.sm);
  drawGlyph(ctx, 'trophy', centerIn({ ...body, w: glyph }, glyph, glyph), {
    color: palette.accent.base,
  });
  const words = inset(body, { l: glyph + space.sm });
  const titleRow: Rect = { ...words, h: words.h * HALF };
  const detailRow: Rect = { ...words, y: words.y + words.h * HALF, h: words.h * HALF };
  const noun = model.count === 1 ? 'reward' : 'rewards';
  text(ui, titleRow, { text: `${model.count} ${noun} waiting — open`, role: 'accent' });
  text(ui, detailRow, {
    text: `${tapVerb(ui.density)} to open your reward chest`,
    role: 'caption',
  });
}
