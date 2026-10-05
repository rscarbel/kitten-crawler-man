/**
 * Small pieces every counter screen shares: the price chip on a row, the
 * party's purse in a header, and the seller's line under the title.
 */

import { centerIn, inset, type Rect } from '../../core/geom';
import type { SoundId } from '../../../audio/sounds';
import type { Ui } from '../../core/UiRoot';
import type { ButtonVariant, ControlSize } from '../../theme/skins';
import { button, buttonHeight } from '../../widgets/button';
import { tooltip } from '../../widgets/tooltip';
import { withAlpha } from '../../theme/color';
import { drawGlyph } from '../../theme/glyphs';
import { fillRounded, strokeRounded } from '../../widgets/paint';
import { lineHeightOf, measureText, text, tabularNumber } from '../../widgets/text';

export type PriceTone = 'normal' | 'danger' | 'muted';

const CHIP_FILL_ALPHA = 0.12;
const CHIP_BORDER_ALPHA = 0.35;
const CHIP_BORDER_WIDTH = 1;

function chipColor(ui: Ui, tone: PriceTone): string {
  const { palette } = ui.theme;
  switch (tone) {
    case 'normal':
      return palette.accent.base;
    case 'danger':
      return palette.state.danger;
    case 'muted':
      return palette.text.secondary;
  }
}

function chipHeight(ui: Ui): number {
  return lineHeightOf(ui, 'label') + ui.theme.space.xs * 2;
}

/** The width a price chip needs: a coin and the number, or a short status in place of both. */
export function measurePriceChip(ui: Ui, label: string, withCoin: boolean): number {
  const { space, size } = ui.theme;
  const coin = withCoin ? size.icon + space.xs : 0;
  return Math.ceil(measureText(ui, label, { role: 'label', tabular: true }) + coin + space.sm * 2);
}

/**
 * A pill holding a price, centred vertically in `rect` and right-aligned in
 * it. A status (sold out, already done) is drawn without the coin.
 */
export function priceChip(
  ui: Ui,
  rect: Rect,
  opts: { readonly label: string; readonly tone: PriceTone; readonly withCoin: boolean },
): Rect {
  const { space, size, radius } = ui.theme;
  const color = chipColor(ui, opts.tone);
  const w = Math.min(rect.w, measurePriceChip(ui, opts.label, opts.withCoin));
  const h = chipHeight(ui);
  const pill = centerIn({ ...rect, x: rect.x + rect.w - w, w }, w, h);
  fillRounded(ui.ctx, pill, radius.pill, withAlpha(color, CHIP_FILL_ALPHA));
  strokeRounded(ui.ctx, pill, radius.pill, withAlpha(color, CHIP_BORDER_ALPHA), CHIP_BORDER_WIDTH);
  let content = inset(pill, { l: space.sm, r: space.sm });
  if (opts.withCoin) {
    const glyph = Math.min(size.icon, pill.h - space.xxs * 2);
    drawGlyph(ui.ctx, 'coin', centerIn({ ...content, w: glyph }, glyph, glyph), { color });
    content = inset(content, { l: glyph + space.xs });
  }
  tabularNumber(ui, content, { value: opts.label, role: 'label', color, align: 'right' });
  return pill;
}

/** The party's purse: a coin and the total, right-aligned in `rect`. */
export function coinPurse(ui: Ui, rect: Rect, coins: number): void {
  priceChip(ui, rect, { label: coins.toLocaleString('en-US'), tone: 'normal', withCoin: true });
}

/** The width {@link coinPurse} draws at for `coins`. */
export function measureCoinPurse(ui: Ui, coins: number): number {
  return measurePriceChip(ui, coins.toLocaleString('en-US'), true);
}

/**
 * The seller's line, wrapped to at most `maxLines`. A fresh purchase line
 * replaces it in the accent colour and fades back as `strength` runs down.
 */
export function sellerLine(
  ui: Ui,
  rect: Rect,
  opts: { readonly line: string; readonly strength: number; readonly maxLines: number },
): void {
  const { ctx } = ui;
  ctx.save();
  if (opts.strength > 0) ctx.globalAlpha *= opts.strength;
  text(ui, rect, {
    text: opts.line,
    role: opts.strength > 0 ? 'accent' : 'secondary',
    wrap: true,
    maxLines: opts.maxLines,
    valign: 'middle',
  });
  ctx.restore();
}

export interface RefusableButtonOptions {
  readonly id: string;
  readonly label: string;
  /** Why it cannot be pressed, or null when it can. */
  readonly refusal: string | null;
  readonly variant?: ButtonVariant;
  readonly size?: ControlSize;
  readonly primary?: boolean;
  /** Played when a refused press lands; null when `onTap` sounds its own refusal. */
  readonly sound: SoundId | null;
  readonly onTap: () => void;
}

/**
 * A button that looks disabled while it is refused, yet still answers a
 * press, so the seller can say why and the counter's own refusal plays. It
 * explains itself on hover. Drawn at its size's height, centred in `cell`.
 */
export function refusableButton(ui: Ui, cell: Rect, opts: RefusableButtonOptions): void {
  const size = opts.size ?? 'sm';
  const rect = centerIn(cell, cell.w, buttonHeight(ui, size));
  button(ui, rect, {
    id: opts.id,
    label: opts.label,
    size,
    variant: opts.variant ?? 'secondary',
    primary: opts.primary,
    disabled: opts.refusal !== null,
    onTap: opts.onTap,
  });
  const refusal = opts.refusal;
  if (refusal === null) return;
  const state = ui.hit(`${opts.id}/refused`, rect, {
    onTap: () => opts.onTap(),
    focusable: false,
    sound: opts.sound,
  });
  tooltip(ui, rect, {
    id: `${opts.id}/why`,
    text: refusal,
    show: state.hovered || state.pressed,
    immediate: state.pressed,
  });
}
