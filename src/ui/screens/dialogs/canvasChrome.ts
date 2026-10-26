/**
 * Theme-drawn chrome for the conversation box and the big modal moments
 * (loading screen, reward chest) that still render onto a
 * bare context. Every helper takes a {@link PaintTarget}, which a `Ui` also
 * satisfies, so a surface rendering with `ui` calls the same painters.
 */

import type { Rarity } from '../../../core/items/defs/rarity';
import { ITEM_DEF, type ItemId } from '../../../core/items/defs/ItemDefs';
import { inset, type Rect } from '../../core/geom';
import { ITEM_ICONS } from '../../icons/itemIcons';
import { withAlpha } from '../../theme/color';
import { resolveTheme, type Theme } from '../../theme/tokens';
import { fillRounded, roundRectPath, strokeRounded, type PaintTarget } from '../../widgets/paint';
import type { TooltipLine } from '../../widgets/tooltip';

/**
 * Chrome painted outside a surface has no density of its own to resolve; the
 * colours, type and radii it reads are the same at either density.
 */
const CHROME_DENSITY = 'pointer';

/** The theme chrome painted outside a surface is drawn from. */
export function chromeTheme(): Theme {
  return resolveTheme(CHROME_DENSITY);
}

/** `ctx` paired with the theme, for painters called from a plain `render(ctx)`. */
export function chromeTarget(ctx: CanvasRenderingContext2D): PaintTarget {
  return { ctx, theme: chromeTheme() };
}

const RARITY_FRAME_WIDTH = 2;
const RARITY_GLOW_ALPHA = 0.6;
const RARITY_GLOW_BLUR = 8;
/** The corner gem's size as a share of the frame's width, never under `space.sm`. */
const RARITY_GEM_SHARE = 0.18;
const RARITY_GEM_HIGHLIGHT_SHARE = 0.45;
const RARITY_GEM_EDGE_WIDTH = 1;

/**
 * The rarity frame every item cell wears where its item has a rarity: the
 * border in the rarity's colour with a soft glow of it, and a small cut gem
 * of the colour in the bottom-left corner.
 */
export function drawRarityFrame(
  target: PaintTarget,
  rect: Rect,
  corner: number,
  rarity: Rarity,
): void {
  const { ctx, theme } = target;
  const color = rarityColor(theme, rarity);
  ctx.save();
  ctx.shadowColor = withAlpha(rarityColor(theme, rarity, 'glow'), RARITY_GLOW_ALPHA);
  ctx.shadowBlur = RARITY_GLOW_BLUR;
  strokeRounded(ctx, rect, corner, color, RARITY_FRAME_WIDTH);
  ctx.restore();
  const size = Math.max(theme.space.sm, rect.w * RARITY_GEM_SHARE);
  const cx = rect.x + theme.space.xs + size * HALF;
  const cy = rect.y + rect.h - theme.space.xs - size * HALF;
  const half = size * HALF;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, cy - half);
  ctx.lineTo(cx + half, cy);
  ctx.lineTo(cx, cy + half);
  ctx.lineTo(cx - half, cy);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = rarityColor(theme, rarity, 'deep');
  ctx.lineWidth = RARITY_GEM_EDGE_WIDTH;
  ctx.stroke();
  const shine = half * RARITY_GEM_HIGHLIGHT_SHARE;
  ctx.beginPath();
  ctx.moveTo(cx, cy - half);
  ctx.lineTo(cx + shine, cy - half + shine);
  ctx.lineTo(cx, cy);
  ctx.lineTo(cx - shine, cy - half + shine);
  ctx.closePath();
  ctx.fillStyle = rarityColor(theme, rarity, 'light');
  ctx.fill();
  ctx.restore();
}

/**
 * An item's rarity as a tooltip line in the rarity's colour, so the name is
 * there in words wherever its frame is; empty for an item with no rarity.
 */
export function rarityTooltipLines(theme: Theme, item: ItemId): TooltipLine[] {
  const rarity = ITEM_DEF[item].rarity;
  return rarity === undefined
    ? []
    : [{ text: rarity, role: 'label', color: rarityColor(theme, rarity) }];
}

/** One shade of a rarity's colour record. */
export type RarityShade = keyof Theme['palette']['rarity']['common'];

/** A rarity's colour, in the requested shade: the one mapping from the ladder to the palette. */
export function rarityColor(theme: Theme, rarity: Rarity, shade: RarityShade = 'base'): string {
  const shades = theme.palette.rarity;
  const byRarity: Record<Rarity, Readonly<Record<RarityShade, string>>> = {
    Common: shades.common,
    Uncommon: shades.uncommon,
    Rare: shades.rare,
    Epic: shades.epic,
    Legendary: shades.legendary,
    Divine: shades.divine,
  };
  return byRarity[rarity][shade];
}

const CATEGORY_TINT_ALPHA = 0.12;
const CATEGORY_EDGE_ALPHA = 0.85;
const CATEGORY_EDGE_HEIGHT = 2;
const CATEGORY_EDGE_INSET_RATIO = 0.3;
const ICON_INSET_RATIO = 0.14;
const FRAME_BORDER_WIDTH = 1;

/**
 * An item's icon in the sunken, category-accented cell the item slots use —
 * for reward lines that show an item without being a control.
 */
export function drawItemFrame(target: PaintTarget, rect: Rect, item: ItemId): void {
  const { ctx, theme } = target;
  const { palette, radius, space } = theme;
  const corner = radius.sm;
  const accent = palette.category[ITEM_DEF[item].category];
  fillRounded(ctx, rect, corner, palette.surface.sunken);
  const tint = ctx.createLinearGradient(0, rect.y, 0, rect.y + rect.h);
  tint.addColorStop(0, withAlpha(accent, 0));
  tint.addColorStop(1, withAlpha(accent, CATEGORY_TINT_ALPHA));
  ctx.save();
  ctx.fillStyle = tint;
  roundRectPath(ctx, rect, corner);
  ctx.fill();
  ctx.restore();
  ITEM_ICONS[item](ctx, inset(rect, Math.round(rect.w * ICON_INSET_RATIO)));
  const edgeInset = rect.w * CATEGORY_EDGE_INSET_RATIO;
  fillRounded(
    ctx,
    {
      x: rect.x + edgeInset,
      y: rect.y + rect.h - CATEGORY_EDGE_HEIGHT - space.xxs,
      w: rect.w - edgeInset * 2,
      h: CATEGORY_EDGE_HEIGHT,
    },
    radius.pill,
    withAlpha(accent, CATEGORY_EDGE_ALPHA),
  );
  const rarity = ITEM_DEF[item].rarity;
  if (rarity === undefined) {
    strokeRounded(ctx, rect, corner, palette.border.subtle, FRAME_BORDER_WIDTH);
  } else {
    drawRarityFrame(target, rect, corner, rarity);
  }
}

/** A hairline rule across `width` at `y`, fading out at both ends. */
export function drawRule(
  target: PaintTarget,
  x: number,
  y: number,
  width: number,
  color: string,
): void {
  const { ctx } = target;
  const gradient = ctx.createLinearGradient(x, 0, x + width, 0);
  gradient.addColorStop(0, withAlpha(color, 0));
  gradient.addColorStop(RULE_SOLID_FROM, color);
  gradient.addColorStop(1 - RULE_SOLID_FROM, color);
  gradient.addColorStop(1, withAlpha(color, 0));
  ctx.save();
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, width, RULE_THICKNESS);
  ctx.restore();
}

/** How far in from each end a rule reaches full strength, as a fraction of its width. */
const RULE_SOLID_FROM = 0.2;
const RULE_THICKNESS = 1;

/** How wide the travelling highlight on a filling bar is, as a fraction of the bar. */
const SHIMMER_WIDTH_FRACTION = 0.25;
const SHIMMER_ALPHA = 0.35;
const BAR_GLOW_ALPHA = 0.45;

export interface BarOptions {
  /** 0 to 1. */
  readonly value: number;
  /** A `#RRGGBB` fill colour. */
  readonly fill: string;
  /** Where the travelling highlight is, wrapping every whole number; omit for none. */
  readonly shimmerPhase?: number;
}

/** A pill-shaped meter: a faint track and a glowing fill, with an optional travelling highlight. */
export function drawBar(target: PaintTarget, rect: Rect, opts: BarOptions): void {
  const { ctx, theme } = target;
  const { palette, radius } = theme;
  fillRounded(ctx, rect, radius.pill, palette.meter.track);
  const value = Math.max(0, Math.min(1, opts.value));
  if (value <= 0) return;
  const filled: Rect = { ...rect, w: Math.min(rect.w, Math.max(rect.h, rect.w * value)) };
  ctx.save();
  ctx.shadowColor = withAlpha(opts.fill, BAR_GLOW_ALPHA);
  ctx.shadowBlur = theme.space.md;
  fillRounded(ctx, filled, radius.pill, opts.fill);
  ctx.restore();
  if (opts.shimmerPhase === undefined) return;
  const phase = opts.shimmerPhase - Math.floor(opts.shimmerPhase);
  const shimmerWidth = filled.w * SHIMMER_WIDTH_FRACTION;
  const shimmerX = filled.x - shimmerWidth + phase * (filled.w + shimmerWidth);
  const shimmer = ctx.createLinearGradient(shimmerX, 0, shimmerX + shimmerWidth, 0);
  const highlight = palette.text.primary;
  shimmer.addColorStop(0, withAlpha(highlight, 0));
  shimmer.addColorStop(HALF, withAlpha(highlight, SHIMMER_ALPHA));
  shimmer.addColorStop(1, withAlpha(highlight, 0));
  ctx.save();
  roundRectPath(ctx, filled, radius.pill);
  ctx.clip();
  ctx.fillStyle = shimmer;
  ctx.fillRect(filled.x, filled.y, filled.w, filled.h);
  ctx.restore();
}

const HALF = 0.5;
