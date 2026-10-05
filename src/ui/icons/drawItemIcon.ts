import type { InventoryItem } from '../../core/ItemDefs';
import { paintIsolated } from '../isolatedPaint';
import { worldText } from '../world/worldText';
import { ITEM_ICONS } from './itemIcons';
import type { Rect } from '../core/geom';
import { iconSquare } from './iconSquare';

const QTY_BADGE_MIN_FONT = 7;
const QTY_BADGE_FONT_SCALE = 0.22;
const QTY_BADGE_MARGIN = 3;
/** Thin outline — a full-weight one at this font size would swallow the digits. */
const QTY_BADGE_OUTLINE_WIDTH = 1.5;
const QTY_BADGE_COLOR = '#fff';

/**
 * The per-item procedural icon, drawn into the largest square centred in
 * `rect`, with its stack count in the corner.
 *
 * Every surface that shows an item outside the widget kit needs the same
 * picture, and a second hand-drawn copy would drift the moment an icon changes.
 *
 * @param alpha Multiplied into the context's own alpha, for drag ghosts.
 */
export function drawItemIcon(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  item: InventoryItem,
  alpha = 1,
): void {
  const { x, y, size } = iconSquare(rect);
  // Every painter scales its radii off `size`, and the canvas throws on a
  // negative radius, so a square with no area has nothing to draw.
  const drawable = size > 0 && Number.isFinite(size) && Number.isFinite(x) && Number.isFinite(y);
  if (!drawable) return;
  paintIsolated(ctx, `item icon "${item.id}"`, () => {
    ctx.save();
    ctx.globalAlpha = ctx.globalAlpha * alpha;
    ITEM_ICONS[item.id](ctx, rect);
    ctx.restore();
    drawQuantityBadge(ctx, item, x, y, size, alpha);
  });
}

/** Bottom-right stack count, shown for any stack the player holds more than one of. */
function drawQuantityBadge(
  ctx: CanvasRenderingContext2D,
  item: InventoryItem,
  x: number,
  y: number,
  size: number,
  alpha: number,
): void {
  if (item.quantity <= 1) return;
  ctx.save();
  ctx.globalAlpha = ctx.globalAlpha * alpha;
  const fontSize = Math.max(QTY_BADGE_MIN_FONT, Math.floor(size * QTY_BADGE_FONT_SCALE));
  worldText(ctx, item.quantity.toString(), {
    x: x + size - QTY_BADGE_MARGIN,
    y: y + size - QTY_BADGE_MARGIN - fontSize,
    size: fontSize,
    bold: true,
    color: QTY_BADGE_COLOR,
    align: 'right',
    outline: true,
    outlineWidth: QTY_BADGE_OUTLINE_WIDTH,
    alpha: ctx.globalAlpha,
  });
  ctx.restore();
}
