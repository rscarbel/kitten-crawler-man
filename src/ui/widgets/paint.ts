/**
 * Drawing primitives the widgets share: rounded shapes, the glass panel body,
 * the focus ring, and the hover/press treatment every control gets. Feature
 * code never calls these; it calls widgets.
 */

import type { Rect } from '../core/geom';
import type { HitState, Ui } from '../core/UiRoot';
import { withAlpha } from '../theme/color';
import { skinsFor, type ButtonSkin, type ControlColors, type PanelSkin } from '../theme/skins';
import { corners, roundRectPath, type CornerRadii } from './roundRect';
import { fillShadowedRounded } from './shadowedFill';

/**
 * What a painter needs to draw: a context and the resolved theme. A `Ui`
 * satisfies it, and so does a bare context paired with a theme, for chrome a
 * caller paints outside a surface.
 */
export type PaintTarget = Pick<Ui, 'ctx' | 'theme'>;

const HALF = 0.5;

export function fillRounded(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  radius: number | CornerRadii,
  fill: string,
): void {
  ctx.fillStyle = fill;
  roundRectPath(ctx, r, radius);
  ctx.fill();
}

/** Strokes inside `r`, so a border never grows the shape it outlines. */
export function strokeRounded(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  radius: number | CornerRadii,
  color: string,
  width: number,
): void {
  if (width <= 0) return;
  const half = width * HALF;
  const shrink = (value: number): number => Math.max(0, value - half);
  const radii = typeof radius === 'number' ? corners(radius) : radius;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  roundRectPath(
    ctx,
    { x: r.x + half, y: r.y + half, w: r.w - width, h: r.h - width },
    {
      tl: shrink(radii.tl),
      tr: shrink(radii.tr),
      br: shrink(radii.br),
      bl: shrink(radii.bl),
    },
  );
  ctx.stroke();
}

/** Strength of the light catching a glass panel's top edge. */
const GLASS_SHEEN_ALPHA = 0.045;
/** How far down the panel the sheen fades out, as a fraction of its height. */
const GLASS_SHEEN_DEPTH = 0.35;

/**
 * A panel body in the dark-glass look: soft drop shadow, translucent fill, a
 * faint sheen across the top and a 1-unit light edge.
 */
export function drawGlass(
  ui: PaintTarget,
  r: Rect,
  skin: PanelSkin,
  radius: number | CornerRadii = skin.radius,
): void {
  const { ctx } = ui;
  if (skin.shadow === null) fillRounded(ctx, r, radius, skin.fill);
  else fillShadowedRounded(ctx, r, radius, skin.fill, skin.shadow);
  const sheen = ctx.createLinearGradient(0, r.y, 0, r.y + r.h * GLASS_SHEEN_DEPTH);
  sheen.addColorStop(0, withAlpha(ui.theme.palette.text.primary, GLASS_SHEEN_ALPHA));
  sheen.addColorStop(1, withAlpha(ui.theme.palette.text.primary, 0));
  ctx.save();
  ctx.fillStyle = sheen;
  roundRectPath(ctx, r, radius);
  ctx.fill();
  ctx.restore();
  strokeRounded(ctx, r, radius, skin.border, skin.borderWidth);
}

/** The 2-unit gold ring drawn just outside a focused control, with a soft glow. */
export function drawFocusRing(ui: PaintTarget, r: Rect, radius: number): void {
  const ring = skinsFor(ui.theme).focusRing;
  const grow = ring.gap + ring.width;
  const outer: Rect = { x: r.x - grow, y: r.y - grow, w: r.w + grow * 2, h: r.h + grow * 2 };
  const { ctx } = ui;
  ctx.save();
  ctx.shadowColor = ring.glow;
  ctx.shadowBlur = ring.glowBlur;
  strokeRounded(ctx, outer, radius + grow, ring.color, ring.width);
  ctx.restore();
}

/** `disabled` as a reason string, or `null` when it carries none. */
export function disabledReason(disabled: boolean | string | undefined): string | null {
  return typeof disabled === 'string' && disabled.length > 0 ? disabled : null;
}

export function isDisabled(disabled: boolean | string | undefined): boolean {
  return disabled === true || disabledReason(disabled) !== null;
}

/** How hovered a control looks, 0 to 1, eased over `motion.fast`. */
export function hoverAmount(ui: Ui, id: string, hovered: boolean): number {
  return ui.tween(`${id}/hover`, hovered ? 1 : 0, { ms: ui.theme.motion.fast });
}

const HOVER_TEXT_SWITCH = 0.5;

/** What `paintControl` drew, for laying the label on top. */
export interface PaintedControl {
  /** `rect` moved down by the press drop when pressed. */
  readonly rect: Rect;
  readonly text: string;
}

export interface PaintControlOptions {
  readonly id: string;
  readonly radius: number;
  readonly disabled: boolean;
  /** 0 to 1: a burst of light laid over the control, for a beat it is flashed in time with. */
  readonly flash?: number;
}

/**
 * The fill, border, glow, hover and press treatment of a control. Hover
 * brightens by fading the hover colours over the rest colours; press shows on
 * pointer down, darkened and dropped by `PRESS_DROP`.
 */
export function paintControl(
  ui: Ui,
  rect: Rect,
  skin: ButtonSkin,
  state: HitState,
  opts: PaintControlOptions,
): PaintedControl {
  const { ctx } = ui;
  const skins = skinsFor(ui.theme);
  const hover = hoverAmount(ui, opts.id, state.hovered && !opts.disabled);
  const pressed = state.pressed && !opts.disabled;
  const drawn: Rect = pressed ? { ...rect, y: rect.y + skins.pressDrop } : rect;
  const paint = (colors: ControlColors): void => {
    fillRounded(ctx, drawn, opts.radius, colors.fill);
    strokeRounded(ctx, drawn, opts.radius, colors.border, skin.borderWidth);
  };
  if (opts.disabled) {
    paint(skin.disabled);
    return { rect: drawn, text: skin.disabled.text };
  }
  if (pressed) {
    paint(skin.press);
  } else {
    if (skin.glow !== null) {
      ctx.save();
      ctx.shadowColor = skin.glow;
      ctx.shadowBlur = ui.theme.space.md;
      fillRounded(ctx, drawn, opts.radius, skin.rest.fill);
      ctx.restore();
    }
    paint(skin.rest);
    if (hover > 0) {
      ctx.save();
      ctx.globalAlpha *= hover;
      paint(skin.hover);
      ctx.restore();
    }
  }
  const flash = Math.min(1, opts.flash ?? 0);
  if (flash > 0) {
    const flashSkin = skins.controlFlash;
    ctx.save();
    ctx.globalAlpha *= flash;
    ctx.shadowColor = flashSkin.glow;
    ctx.shadowBlur = flashSkin.glowBlur;
    fillRounded(ctx, drawn, opts.radius, flashSkin.fill);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha *= flash;
    strokeRounded(ctx, drawn, opts.radius, flashSkin.border, skin.borderWidth);
    ctx.restore();
  }
  if (state.focused) drawFocusRing(ui, drawn, opts.radius);
  const text = pressed
    ? skin.press.text
    : hover > HOVER_TEXT_SWITCH
      ? skin.hover.text
      : skin.rest.text;
  return { rect: drawn, text };
}

/** Reveal progress of the rendering surface, 0 to 1, eased over `motion.base` since it opened. */
export function openProgress(ui: Ui): number {
  const elapsed = ui.now - ui.openedAt;
  const linear = Math.min(1, Math.max(0, elapsed / ui.theme.motion.base));
  return 1 - Math.pow(1 - linear, CUBIC);
}

const CUBIC = 3;
