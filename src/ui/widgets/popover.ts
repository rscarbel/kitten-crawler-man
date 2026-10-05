/**
 * A small floating panel attached to something on screen: a structure's
 * actions, a slot's details. It sits beside its anchor, flips to the other
 * side when there's no room, stays inside the viewport, and points back at
 * the anchor with a caret.
 */

import { inset, type Rect } from '../core/geom';
import type { Ui } from '../core/UiRoot';
import { skinsFor } from '../theme/skins';
import { drawGlass } from './paint';
import { anchorVisible, placeBeside, type TooltipPlacement } from './tooltip';

export type PopoverPlacement = TooltipPlacement;

export interface PopoverOptions {
  readonly id: string;
  readonly anchor: Rect;
  /** Outer size, padding included. */
  readonly w: number;
  readonly h: number;
  readonly placement?: PopoverPlacement;
  /**
   * A tap anywhere outside, or Escape, calls this, and the popover takes the
   * keyboard while it is up. Without it, taps outside pass beneath.
   */
  readonly onDismiss?: () => void;
  /** Fills the popover's padded body. */
  readonly draw: (body: Rect) => void;
}

/** Caret half-width and depth. */
const CARET_SIZE = 6;
const CARET_BORDER_WIDTH = 1;

/**
 * Lays the popover out now and draws it once the surface has finished, above
 * everything else. Returns where it will be, or `null` when its anchor is
 * scrolled out of view and nothing is drawn.
 */
export function popover(ui: Ui, opts: PopoverOptions): Rect | null {
  if (!anchorVisible(ui, opts.anchor)) return null;
  const { theme } = ui;
  const skin = skinsFor(theme).panel.popover;
  const bounds = inset(ui.viewport, theme.space.sm);
  const w = Math.min(opts.w, bounds.w);
  const h = Math.min(opts.h, bounds.h);
  const placed = placeBeside(
    opts.anchor,
    w,
    h,
    CARET_SIZE + theme.space.xs,
    bounds,
    opts.placement ?? 'below',
  );
  const frame = placed.rect;
  ui.defer(() => {
    const onDismiss = opts.onDismiss;
    if (onDismiss !== undefined) {
      ui.layer({ onEscape: () => onDismiss() });
      ui.hit(`${opts.id}/dismiss`, ui.screen, {
        onTap: () => onDismiss(),
        focusable: false,
        sound: null,
      });
    }
    ui.block(frame);
    drawGlass(ui, frame, skin);
    drawCaret(ui, frame, opts.anchor, placed.side, skin.fill, skin.border);
    const body = inset(frame, skin.padding);
    ui.clip(frame, () => opts.draw(body));
  });
  return frame;
}

function drawCaret(
  ui: Ui,
  frame: Rect,
  anchor: Rect,
  side: PopoverPlacement,
  fill: string,
  border: string,
): void {
  const { ctx, theme } = ui;
  const reach = theme.radius.md + CARET_SIZE;
  const clampX = (x: number): number =>
    Math.min(frame.x + frame.w - reach, Math.max(frame.x + reach, x));
  const clampY = (y: number): number =>
    Math.min(frame.y + frame.h - reach, Math.max(frame.y + reach, y));
  const anchorX = clampX(anchor.x + anchor.w / 2);
  const anchorY = clampY(anchor.y + anchor.h / 2);
  let points: readonly (readonly [number, number])[];
  switch (side) {
    case 'below':
      points = [
        [anchorX - CARET_SIZE, frame.y],
        [anchorX, frame.y - CARET_SIZE],
        [anchorX + CARET_SIZE, frame.y],
      ];
      break;
    case 'above': {
      const bottom = frame.y + frame.h;
      points = [
        [anchorX - CARET_SIZE, bottom],
        [anchorX, bottom + CARET_SIZE],
        [anchorX + CARET_SIZE, bottom],
      ];
      break;
    }
    case 'right':
      points = [
        [frame.x, anchorY - CARET_SIZE],
        [frame.x - CARET_SIZE, anchorY],
        [frame.x, anchorY + CARET_SIZE],
      ];
      break;
    case 'left': {
      const right = frame.x + frame.w;
      points = [
        [right, anchorY - CARET_SIZE],
        [right + CARET_SIZE, anchorY],
        [right, anchorY + CARET_SIZE],
      ];
      break;
    }
  }
  ctx.save();
  ctx.beginPath();
  points.forEach(([x, y], index) => {
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = border;
  ctx.lineWidth = CARET_BORDER_WIDTH;
  ctx.stroke();
  ctx.restore();
}
