/**
 * A hover label: appears after a short delay beside its anchor, kept inside
 * the viewport, drawn above everything else the surface drew. Takes no input.
 */

import { inset, intersect, type Rect } from '../core/geom';
import type { Ui } from '../core/UiRoot';
import { UiStateSlot } from '../core/uiState';
import { skinsFor, type TextRole } from '../theme/skins';
import { drawGlass } from './paint';
import { measureText, measureTextHeight, text } from './text';

/** How long the pointer rests on something before its tooltip shows. */
export const TOOLTIP_DELAY_MS = 350;

/** Widest a tooltip grows before its text wraps, in UI units. */
export const TOOLTIP_MAX_WIDTH = 260;

export type TooltipPlacement = 'above' | 'below' | 'left' | 'right';

/** One extra line under the tooltip's text, e.g. an item's effect. */
export interface TooltipLine {
  readonly text: string;
  readonly role?: TextRole;
  readonly color?: string;
}

export interface TooltipOptions {
  readonly id: string;
  /** Whether the anchor is hovered, pressed or focused this frame. The delay runs while it stays true. */
  readonly show: boolean;
  readonly text: string;
  readonly title?: string;
  /** Tints the title: a category colour for an item. */
  readonly accent?: string;
  readonly lines?: readonly TooltipLine[];
  readonly placement?: TooltipPlacement;
  /** Show at once, skipping the delay (keyboard focus, a disabled reason on touch). */
  readonly immediate?: boolean;
}

const SINCE = new UiStateSlot<{ since: number | null }>('tooltip', () => ({ since: null }));

const PLACEMENT_ORDER: Readonly<Record<TooltipPlacement, readonly TooltipPlacement[]>> = {
  above: ['above', 'below', 'right', 'left'],
  below: ['below', 'above', 'right', 'left'],
  right: ['right', 'left', 'above', 'below'],
  left: ['left', 'right', 'above', 'below'],
};

/**
 * Where a `w`×`h` box goes beside `anchor`, trying `placement` first and
 * flipping when it would leave `bounds`, then clamped inside `bounds`.
 */
export function placeBeside(
  anchor: Rect,
  w: number,
  h: number,
  gap: number,
  bounds: Rect,
  placement: TooltipPlacement,
): { rect: Rect; side: TooltipPlacement } {
  const candidates: Record<TooltipPlacement, Rect> = {
    above: { x: anchor.x + (anchor.w - w) / 2, y: anchor.y - gap - h, w, h },
    below: { x: anchor.x + (anchor.w - w) / 2, y: anchor.y + anchor.h + gap, w, h },
    right: { x: anchor.x + anchor.w + gap, y: anchor.y + (anchor.h - h) / 2, w, h },
    left: { x: anchor.x - gap - w, y: anchor.y + (anchor.h - h) / 2, w, h },
  };
  const fits = (r: Rect): boolean =>
    r.x >= bounds.x &&
    r.y >= bounds.y &&
    r.x + r.w <= bounds.x + bounds.w &&
    r.y + r.h <= bounds.y + bounds.h;
  // Too big for every side: keep it off the anchor along whichever side has
  // room on its own axis, and slide it along the other axis to stay on screen.
  const fitsAcross = (candidate: TooltipPlacement): boolean => {
    const r = candidates[candidate];
    const vertical = candidate === 'above' || candidate === 'below';
    return vertical
      ? r.y >= bounds.y && r.y + r.h <= bounds.y + bounds.h
      : r.x >= bounds.x && r.x + r.w <= bounds.x + bounds.w;
  };
  const order = PLACEMENT_ORDER[placement];
  const side =
    order.find((candidate) => fits(candidates[candidate])) ?? order.find(fitsAcross) ?? placement;
  const chosen = candidates[side];
  const x = Math.min(Math.max(chosen.x, bounds.x), bounds.x + bounds.w - w);
  const y = Math.min(Math.max(chosen.y, bounds.y), bounds.y + bounds.h - h);
  return { rect: { x, y, w, h }, side };
}

/**
 * Whether any of `anchor` shows through the active clip. Overlays are drawn
 * unclipped, so one whose anchor has scrolled away must not draw at all.
 */
export function anchorVisible(ui: Ui, anchor: Rect): boolean {
  const clip = ui.clipRect;
  return clip !== null && intersect(anchor, clip) !== null;
}

/** Draws the tooltip (after its delay) and returns whether it is showing. */
export function tooltip(ui: Ui, anchor: Rect, opts: TooltipOptions): boolean {
  const timer = ui.state(SINCE, opts.id);
  if (!opts.show || !anchorVisible(ui, anchor)) {
    timer.since = null;
    return false;
  }
  timer.since ??= ui.now;
  const waited = ui.now - timer.since;
  if (opts.immediate !== true && waited < TOOLTIP_DELAY_MS) return false;
  const { theme } = ui;
  const skin = skinsFor(theme).panel.tooltip;
  const pad = skin.padding;
  const lines = opts.lines ?? [];
  const naturalWidth = Math.max(
    opts.title === undefined ? 0 : measureText(ui, opts.title, { role: 'label' }),
    measureText(ui, opts.text, { role: 'caption' }),
    ...lines.map((line) => measureText(ui, line.text, { role: line.role ?? 'caption' })),
  );
  const innerW = Math.min(TOOLTIP_MAX_WIDTH - pad * 2, naturalWidth);
  const titleH =
    opts.title === undefined
      ? 0
      : measureTextHeight(ui, innerW, { text: opts.title, role: 'label' });
  const textH = measureTextHeight(ui, innerW, { text: opts.text, role: 'caption' });
  const lineHeights = lines.map((line) =>
    measureTextHeight(ui, innerW, { text: line.text, role: line.role ?? 'caption' }),
  );
  const gap = theme.space.xxs;
  const parts = [titleH, textH, ...lineHeights].filter((h) => h > 0);
  const innerH = parts.reduce((sum, h) => sum + h, 0) + gap * Math.max(0, parts.length - 1);
  const bounds = inset(ui.viewport, theme.space.sm);
  const placed = placeBeside(
    anchor,
    innerW + pad * 2,
    innerH + pad * 2,
    theme.space.sm,
    bounds,
    opts.placement ?? 'above',
  );
  const visibleSince = opts.immediate === true ? timer.since : timer.since + TOOLTIP_DELAY_MS;
  const fade = Math.min(1, Math.max(0, (ui.now - visibleSince) / theme.motion.fast));
  ui.defer(() => {
    const { ctx } = ui;
    ctx.save();
    ctx.globalAlpha *= fade;
    drawGlass(ui, placed.rect, skin);
    let y = placed.rect.y + pad;
    const x = placed.rect.x + pad;
    if (opts.title !== undefined) {
      text(
        ui,
        { x, y, w: innerW, h: titleH },
        {
          text: opts.title,
          role: 'label',
          color: opts.accent,
          wrap: true,
        },
      );
      y += titleH + gap;
    }
    text(ui, { x, y, w: innerW, h: textH }, { text: opts.text, role: 'caption', wrap: true });
    y += textH + gap;
    lines.forEach((line, index) => {
      const h = lineHeights[index] ?? 0;
      text(
        ui,
        { x, y, w: innerW, h },
        {
          text: line.text,
          role: line.role ?? 'caption',
          color: line.color,
          wrap: true,
        },
      );
      y += h + gap;
    });
    ctx.restore();
  });
  return true;
}
