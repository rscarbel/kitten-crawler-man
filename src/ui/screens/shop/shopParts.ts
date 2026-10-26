/**
 * Small pieces every counter screen shares: the picture on an offer, the
 * cost pills under it, the party's purse in a header, and the seller's line
 * under the title.
 */

import { ITEM_DEF, type ItemId } from '../../../core/items/defs/ItemDefs';
import { SERVICE_ICONS } from '../../../sprites/art/itemIcons/serviceIcons';
import { centerIn, inset, type Rect } from '../../core/geom';
import type { SoundId } from '../../../audio/sounds';
import type { Ui } from '../../core/UiRoot';
import type { ButtonVariant, ControlSize } from '../../theme/skins';
import { button, buttonHeight } from '../../widgets/button';
import { ITEM_ICONS } from '../../icons/itemIcons';
import { drawRarityFrame } from '../dialogs/canvasChrome';
import { tooltip } from '../../widgets/tooltip';
import { withAlpha } from '../../theme/color';
import { drawGlyph } from '../../theme/glyphs';
import { fillRounded, strokeRounded } from '../../widgets/paint';
import { lineHeightOf, measureText, text, tabularNumber } from '../../widgets/text';
import type { Theme } from '../../theme/tokens';
import type { ShopArt } from './shopSession';

const PURSE_FILL_ALPHA = 0.12;
const PURSE_BORDER_ALPHA = 0.35;
const CHIP_BORDER_WIDTH = 1;

function purseLabel(coins: number): string {
  return coins.toLocaleString('en-US');
}

/** The width {@link coinPurse} draws at for `coins`. */
export function measureCoinPurse(ui: Ui, coins: number): number {
  const { space, size } = ui.theme;
  const label = measureText(ui, purseLabel(coins), { role: 'label', tabular: true });
  return Math.ceil(label + size.icon + space.xs + space.sm * 2);
}

/** The party's purse: a coin and the total in a gold pill, right-aligned and centred vertically in `rect`. */
export function coinPurse(ui: Ui, rect: Rect, coins: number): void {
  const { space, size, radius, palette } = ui.theme;
  const color = palette.accent.base;
  const w = Math.min(rect.w, measureCoinPurse(ui, coins));
  const h = lineHeightOf(ui, 'label') + space.xs * 2;
  const pill = centerIn({ ...rect, x: rect.x + rect.w - w, w }, w, h);
  fillRounded(ui.ctx, pill, radius.pill, withAlpha(color, PURSE_FILL_ALPHA));
  strokeRounded(ui.ctx, pill, radius.pill, withAlpha(color, PURSE_BORDER_ALPHA), CHIP_BORDER_WIDTH);
  const content = inset(pill, { l: space.sm, r: space.sm });
  const glyph = Math.min(size.icon, pill.h - space.xxs * 2);
  drawGlyph(ui.ctx, 'coin', centerIn({ ...content, w: glyph }, glyph, glyph), { color });
  tabularNumber(ui, inset(content, { l: glyph + space.xs }), {
    value: purseLabel(coins),
    role: 'label',
    color,
    align: 'right',
  });
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

/** The art tile's wash of its accent colour, over the sunken fill. */
const ART_TINT_FILL_ALPHA = 0.1;
const ART_TINT_BORDER_ALPHA = 0.32;
/** A shut offer's picture keeps this much of its strength, so it reads as on the shelf but out of reach. */
const ART_FADED_ALPHA = 0.4;

function artTint(theme: Theme, art: ShopArt): string {
  return art.kind === 'item'
    ? theme.palette.category[ITEM_DEF[art.item].category]
    : theme.palette.accent.base;
}

/** The picture of what an offer sells, on a tile tinted by its kind. */
export function offerArt(ui: Ui, rect: Rect, art: ShopArt, faded: boolean): void {
  const { ctx, theme } = ui;
  const { radius, palette, space } = theme;
  const tint = artTint(theme, art);
  const rarity = art.kind === 'item' ? ITEM_DEF[art.item].rarity : undefined;
  fillRounded(ctx, rect, radius.md, palette.surface.sunken);
  fillRounded(ctx, rect, radius.md, withAlpha(tint, ART_TINT_FILL_ALPHA));
  if (rarity === undefined) {
    strokeRounded(ctx, rect, radius.md, withAlpha(tint, ART_TINT_BORDER_ALPHA), CHIP_BORDER_WIDTH);
  }
  ctx.save();
  if (faded) ctx.globalAlpha *= ART_FADED_ALPHA;
  const picture = inset(rect, space.xs);
  if (art.kind === 'item') ITEM_ICONS[art.item](ctx, picture);
  else SERVICE_ICONS[art.service](ctx, picture);
  if (rarity !== undefined) drawRarityFrame(ui, rect, radius.md, rarity);
  ctx.restore();
}

/** What a cost pill pictures: coins, or one material out of the party's packs. */
export type CostIcon = { readonly kind: 'coin' } | { readonly kind: 'item'; readonly item: ItemId };

/**
 * How a pill reads: `price` a coin cost the purse covers, `short` one it
 * does not, `met` a material the packs hold enough of, `muted` any part of a
 * cost that cannot be paid today regardless.
 */
export type CostTone = 'price' | 'short' | 'met' | 'muted';

/** One part of an offer's cost: its picture, what it is, and how much. */
export interface CostPill {
  readonly icon: CostIcon;
  /** The material's name; null for coins, whose icon says it. */
  readonly name: string | null;
  readonly amount: string;
  readonly tone: CostTone;
}

const PILL_FILL_ALPHA = 0.14;
const PILL_BORDER_ALPHA = 0.4;

function pillColor(ui: Ui, tone: CostTone): string {
  const { palette } = ui.theme;
  switch (tone) {
    case 'price':
      return palette.accent.base;
    case 'short':
      return palette.state.danger;
    case 'met':
      return palette.state.success;
    case 'muted':
      return palette.text.muted;
  }
}

interface PillMetrics {
  readonly h: number;
  readonly icon: number;
  readonly gap: number;
}

function pillMetrics(ui: Ui): PillMetrics {
  const { type, space } = ui.theme;
  return {
    h: type.title.lineHeight + space.xs * 2,
    icon: type.title.lineHeight - space.xxs,
    gap: space.xs,
  };
}

function pillWidth(ui: Ui, pill: CostPill, m: PillMetrics): number {
  const { space, type } = ui.theme;
  const name =
    pill.name === null ? 0 : measureText(ui, pill.name, { role: 'labelMuted' }) + space.xs;
  const amount = measureText(ui, pill.amount, { style: type.title, tabular: true });
  const tick = pill.tone === 'met' ? m.icon * CHECK_SCALE + space.xxs : 0;
  return Math.ceil(space.sm * 2 + m.icon + space.xs + name + amount + tick);
}

/** The check beside a covered material is this fraction of the pill's icon. */
const CHECK_SCALE = 0.75;

function pillRows(widths: readonly number[], maxWidth: number, gap: number): number[][] {
  const rows: number[][] = [];
  let current: number[] = [];
  let used = 0;
  widths.forEach((w, index) => {
    const needed = current.length === 0 ? w : used + gap + w;
    if (needed > maxWidth && current.length > 0) {
      rows.push(current);
      current = [index];
      used = w;
    } else {
      current.push(index);
      used = needed;
    }
  });
  if (current.length > 0) rows.push(current);
  return rows;
}

/** The height the pills take wrapped to `maxWidth`; 0 for none. */
export function measureCostPills(ui: Ui, pills: readonly CostPill[], maxWidth: number): number {
  if (pills.length === 0) return 0;
  const m = pillMetrics(ui);
  const rows = pillRows(
    pills.map((pill) => pillWidth(ui, pill, m)),
    maxWidth,
    m.gap,
  );
  return rows.length * m.h + (rows.length - 1) * m.gap;
}

/** The narrowest width that keeps the widest single pill whole. */
export function widestCostPill(ui: Ui, pills: readonly CostPill[]): number {
  const m = pillMetrics(ui);
  return Math.max(0, ...pills.map((pill) => pillWidth(ui, pill, m)));
}

function drawPill(ui: Ui, rect: Rect, pill: CostPill, m: PillMetrics): void {
  const { ctx, theme } = ui;
  const { space, radius, type, palette } = theme;
  const color = pillColor(ui, pill.tone);
  fillRounded(ctx, rect, radius.pill, withAlpha(color, PILL_FILL_ALPHA));
  strokeRounded(ctx, rect, radius.pill, withAlpha(color, PILL_BORDER_ALPHA), CHIP_BORDER_WIDTH);
  let cursor = rect.x + space.sm;
  const iconBox = centerIn({ x: cursor, y: rect.y, w: m.icon, h: rect.h }, m.icon, m.icon);
  if (pill.icon.kind === 'coin') drawGlyph(ctx, 'coin', iconBox, { color });
  else ITEM_ICONS[pill.icon.item](ctx, iconBox);
  cursor += m.icon + space.xs;
  if (pill.name !== null) {
    const nameW = measureText(ui, pill.name, { role: 'labelMuted' });
    text(
      ui,
      { x: cursor, y: rect.y, w: nameW, h: rect.h },
      { text: pill.name, role: 'labelMuted' },
    );
    cursor += nameW + space.xs;
  }
  const amountColor = pill.tone === 'muted' ? palette.text.secondary : color;
  const amountW = measureText(ui, pill.amount, { style: type.title, tabular: true });
  tabularNumber(
    ui,
    { x: cursor, y: rect.y, w: amountW, h: rect.h },
    {
      value: pill.amount,
      style: type.title,
      color: amountColor,
    },
  );
  cursor += amountW + space.xxs;
  if (pill.tone === 'met') {
    const side = m.icon * CHECK_SCALE;
    drawGlyph(ctx, 'check', centerIn({ x: cursor, y: rect.y, w: side, h: rect.h }, side, side), {
      color,
    });
  }
}

/** Draws the pills from the top-left of `rect`, wrapping onto new rows as needed. */
export function costPills(ui: Ui, rect: Rect, pills: readonly CostPill[]): void {
  const m = pillMetrics(ui);
  const widths = pills.map((pill) => pillWidth(ui, pill, m));
  const rows = pillRows(widths, rect.w, m.gap);
  rows.forEach((row, rowIndex) => {
    let x = rect.x;
    const y = rect.y + rowIndex * (m.h + m.gap);
    for (const index of row) {
      const w = widths[index];
      drawPill(ui, { x, y, w, h: m.h }, pills[index], m);
      x += w + m.gap;
    }
  });
}
