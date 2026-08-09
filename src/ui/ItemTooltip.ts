/**
 * The hover card every equipment surface shows for a single item.
 *
 * Shared by the G-key gear screen and the pause menu's Equipment tab so an item
 * that gains an effect reads the same on both, and so neither has to hand-write
 * the effect lines {@link describeItemEffects} already knows how to produce.
 */

import type { InventoryItem } from '../core/ItemDefs';
import { describeItemEffects } from './itemEffectLines';
import { drawText, wrapText } from './TextBox';
import { drawBox, BOX_PRESETS } from './Box';
import { viewportWidth, viewportHeight } from '../core/Viewport';

const TOOLTIP_WIDTH = 230;
const TOOLTIP_LINE_HEIGHT = 14;
const TOOLTIP_PAD = 12;
const TOOLTIP_X_OFFSET = 10;
const TOOLTIP_MIN_Y = 4;
const TOOLTIP_SCREEN_MARGIN = 4;
const TOOLTIP_CLIP_INSET = 2;
const TOOLTIP_TEXT_INDENT = 6;
const TOOLTIP_TITLE_BASELINE_LIFT = 8;
const TOOLTIP_TITLE_SIZE = 10;
const TOOLTIP_BODY_SIZE = 10;

/** Characters per line the description is wrapped at to fit the card. */
const DESC_WRAP_CHARS = 34;

const TITLE_COLOR = '#e2e8f0';
const BONUS_COLOR = '#4ade80';
const ABILITY_COLOR = '#c084fc';
const FOOTER_COLOR = '#64748b';
const BODY_COLOR = '#94a3b8';

const BONUS_LINE_PREFIX = '+';
const ABILITY_LINE_PREFIX = 'Ability:';
const FOOTER_LINE_PREFIX = '[';

function wrapDescription(description: string): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of description.split(' ')) {
    const joined = `${current} ${word}`.trim();
    if (joined.length <= DESC_WRAP_CHARS) {
      current = joined;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function bodyLineColor(line: string): string {
  if (line.startsWith(BONUS_LINE_PREFIX)) return BONUS_COLOR;
  if (line.startsWith(ABILITY_LINE_PREFIX)) return ABILITY_COLOR;
  if (line.startsWith(FOOTER_LINE_PREFIX)) return FOOTER_COLOR;
  return BODY_COLOR;
}

/** The lines the card will show, so a caller can size around it if it needs to. */
export function itemTooltipLines(item: InventoryItem, footer: string | null): string[] {
  const lines: string[] = [item.name, ...describeItemEffects(item)];
  lines.push('');
  if (item.description) lines.push(...wrapDescription(item.description));
  if (footer !== null) {
    lines.push('');
    lines.push(footer);
  }
  return lines;
}

/**
 * Draw the card near (mx, my), pulled back on screen when it would overhang.
 *
 * `footer` is the one line the host owns — what a click on the thing under the
 * cursor will do — because that differs per surface.
 */
export function drawItemTooltip(
  ctx: CanvasRenderingContext2D,
  item: InventoryItem,
  mx: number,
  my: number,
  footer: string | null,
): void {
  const lines = itemTooltipLines(item, footer);
  const width = TOOLTIP_WIDTH;
  const titleMaxWidth = width - TOOLTIP_TEXT_INDENT * 2;

  // A source-material item name can run long enough to need its own wrap,
  // separate from the char-count wrap the description below already uses.
  ctx.save();
  ctx.font = `bold ${TOOLTIP_TITLE_SIZE}px monospace`;
  const titleLines = wrapText(ctx, lines[0] ?? '', titleMaxWidth);
  ctx.restore();
  const bodyLines = lines.slice(1);

  const height = (titleLines.length + bodyLines.length) * TOOLTIP_LINE_HEIGHT + TOOLTIP_PAD;
  const x = Math.min(mx + TOOLTIP_X_OFFSET, viewportWidth() - width - TOOLTIP_SCREEN_MARGIN);
  const clampedY = Math.min(my - height / 2, viewportHeight() - height - TOOLTIP_SCREEN_MARGIN);
  const y = Math.max(clampedY, TOOLTIP_MIN_Y);

  ctx.save();
  drawBox(ctx, { x, y, width, height, ...BOX_PRESETS.tooltip });

  // Clipped rather than trusted to fit: an item whose description runs long
  // would otherwise spill its last line out through the bottom border.
  ctx.beginPath();
  ctx.rect(
    x + TOOLTIP_CLIP_INSET,
    y + TOOLTIP_CLIP_INSET,
    width - TOOLTIP_CLIP_INSET * 2,
    height - TOOLTIP_CLIP_INSET * 2,
  );
  ctx.clip();

  let lineIndex = 0;
  for (const titleLine of titleLines) {
    drawText(ctx, titleLine, {
      x: x + TOOLTIP_TEXT_INDENT,
      y: y + TOOLTIP_LINE_HEIGHT * (lineIndex + 1) - TOOLTIP_TITLE_BASELINE_LIFT,
      size: TOOLTIP_TITLE_SIZE,
      bold: true,
      color: TITLE_COLOR,
    });
    lineIndex++;
  }

  for (const line of bodyLines) {
    drawText(ctx, line, {
      x: x + TOOLTIP_TEXT_INDENT,
      y: y + TOOLTIP_LINE_HEIGHT * (lineIndex + 1) - TOOLTIP_TITLE_BASELINE_LIFT,
      size: TOOLTIP_BODY_SIZE,
      color: bodyLineColor(line),
    });
    lineIndex++;
  }
  ctx.restore();
}
