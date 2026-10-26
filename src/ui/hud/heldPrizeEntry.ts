/**
 * A top-band card that keeps saying a prize is in the party's hands (the
 * prison key) for as long as it is: the prize's icon, a gold headline and
 * where it has to go. The celebration flies the prize into the icon's slot,
 * so the slot stays empty until it lands and glows as it does.
 */

import type { ItemId } from '../../core/items/defs/ItemDefs';
import { centerIn, inset, type Rect } from '../core/geom';
import type { Ui } from '../core/UiRoot';
import { rewardIconPainter } from '../questReward/rewardLines';
import { skinsFor } from '../theme/skins';
import { strokeRounded } from '../widgets/paint';
import { text } from '../widgets/text';
import { topBandCard, topBandCardPadding, type TopBandEntry } from './topBand';
import { TOP_BAND_WIDTH } from './topBandStack';

const GLOW_EDGE_WIDTH = 2;

export interface HeldPrizeOptions {
  readonly id: string;
  readonly item: ItemId;
  readonly title: string;
  readonly detail: string;
  /** False while the prize is still flying to the card, so it lands in an empty slot. */
  readonly showIcon: boolean;
  /** 0–1: how strongly the card glows, highest the moment the prize lands. */
  readonly glow: number;
  /** Hears where the icon slot was drawn this frame, in UI units, so the prize can fly to it. */
  readonly onIconSlot: (rect: Rect, now: number) => void;
}

export function heldPrizeBandEntry(opts: HeldPrizeOptions): TopBandEntry {
  return {
    id: opts.id,
    priority: 'banner',
    maxWidth: TOP_BAND_WIDTH.regular,
    height: (ui) => topBandCardPadding(ui) + ui.theme.size.control + ui.theme.space.sm,
    render: (ui, rect) => renderHeldPrize(ui, rect, opts),
  };
}

function renderHeldPrize(ui: Ui, rect: Rect, opts: HeldPrizeOptions): void {
  const { ctx, theme } = ui;
  const { palette, space } = theme;
  const edge = palette.accent.base;
  const body = topBandCard(ui, rect, { accent: edge });
  if (opts.glow > 0) {
    ctx.save();
    ctx.globalAlpha *= opts.glow;
    ctx.shadowColor = edge;
    ctx.shadowBlur = space.xl;
    strokeRounded(ctx, rect, skinsFor(theme).panel.hud.radius, edge, GLOW_EDGE_WIDTH);
    ctx.restore();
  }
  const slot = centerIn({ ...body, w: body.h }, body.h, body.h);
  opts.onIconSlot(slot, ui.now);
  if (opts.showIcon) rewardIconPainter(opts.item)(ctx, slot);
  const words = inset(body, { l: slot.w + space.sm });
  const titleRow: Rect = { ...words, h: words.h / 2 };
  const detailRow: Rect = { ...words, y: words.y + words.h / 2, h: words.h / 2 };
  text(ui, titleRow, { text: opts.title, role: 'accent' });
  text(ui, detailRow, { text: opts.detail, role: 'success' });
}
