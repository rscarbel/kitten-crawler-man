/**
 * The hover card naming the creature or villager under the mouse, drawn in
 * the tooltip skin beside the cursor. It paints onto the world canvas after
 * the world, so it takes a bare paint target rather than a surface's `Ui`.
 */

import type { Rect } from '../core/geom';
import { withAlpha } from '../theme/color';
import { skinsFor, type TextRole } from '../theme/skins';
import { drawGlass, type PaintTarget } from '../widgets/paint';
import { measureText, measureTextHeight, text } from '../widgets/text';
import { TOOLTIP_MAX_WIDTH } from '../widgets/tooltip';

/** What the card says about one hovered entity. */
export interface EntityTooltipContent {
  readonly name: string;
  readonly subtitle?: string;
  readonly description: string;
  /** Edged and named in the danger colour when true, the success colour otherwise. */
  readonly hostile: boolean;
}

interface TooltipBlock {
  readonly text: string;
  readonly role: TextRole;
  readonly color: string;
}

/** How strongly the hostile/friendly accent tints the card's edge. */
const ACCENT_BORDER_ALPHA = 0.85;

/**
 * Draws the card up and to the right of `cursor`, flipping below it when
 * there is no room above, and kept inside `bounds`.
 */
export function paintEntityTooltip(
  target: PaintTarget,
  cursor: { readonly x: number; readonly y: number },
  bounds: Rect,
  content: EntityTooltipContent,
): void {
  const { theme, ctx } = target;
  const { palette, space } = theme;
  const panelSkin = skinsFor(theme).panel.tooltip;
  const pad = panelSkin.padding;
  const accent = content.hostile ? palette.state.danger : palette.state.success;
  const skin = { ...panelSkin, border: withAlpha(accent, ACCENT_BORDER_ALPHA) };

  const maxInner = Math.min(TOOLTIP_MAX_WIDTH, bounds.w) - pad * 2;
  const naturalWidth = Math.max(
    measureText(target, content.name, { role: 'label' }),
    content.subtitle === undefined ? 0 : measureText(target, content.subtitle, { role: 'caption' }),
    content.description === '' ? 0 : measureText(target, content.description, { role: 'caption' }),
  );
  const innerW = Math.max(0, Math.min(maxInner, Math.ceil(naturalWidth)));
  const blocks: TooltipBlock[] = [{ text: content.name, role: 'label', color: accent }];
  if (content.subtitle !== undefined) {
    blocks.push({ text: content.subtitle, role: 'caption', color: palette.text.muted });
  }
  if (content.description !== '') {
    blocks.push({ text: content.description, role: 'caption', color: palette.text.secondary });
  }
  const heights = blocks.map((block) =>
    measureTextHeight(target, innerW, { text: block.text, role: block.role }),
  );
  const gap = space.xxs;
  const innerH = heights.reduce((sum, h) => sum + h, 0) + gap * Math.max(0, blocks.length - 1);
  const w = innerW + pad * 2;
  const h = innerH + pad * 2;

  const right = bounds.x + bounds.w;
  const x = Math.max(bounds.x, Math.min(cursor.x + space.md, right - w));
  const above = cursor.y - space.sm - h;
  const y = above >= bounds.y ? above : cursor.y + space.xl;

  ctx.save();
  drawGlass(target, { x, y, w, h }, skin);
  let lineY = y + pad;
  blocks.forEach((block, index) => {
    const blockH = heights[index] ?? 0;
    text(
      target,
      { x: x + pad, y: lineY, w: innerW, h: blockH },
      { text: block.text, role: block.role, color: block.color, wrap: true },
    );
    lineY += blockH + gap;
  });
  ctx.restore();
}
