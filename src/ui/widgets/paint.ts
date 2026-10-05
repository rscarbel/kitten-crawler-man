/**
 * Drawing primitives the widgets share: rounded shapes, the glass panel body,
 * the focus ring, and the hover/press treatment every control gets. Feature
 * code never calls these; it calls widgets.
 */

import type { Rect } from '../core/geom';
import type { HitState, Ui } from '../core/UiRoot';
import { withAlpha } from '../theme/color';
import { skinsFor, type ButtonSkin, type ControlColors, type PanelSkin } from '../theme/skins';

/**
 * What a painter needs to draw: a context and the resolved theme. A `Ui`
 * satisfies it, and so does a bare context paired with a theme, for chrome a
 * caller paints outside a surface.
 */
export type PaintTarget = Pick<Ui, 'ctx' | 'theme'>;

/** Per-corner radii, for shapes that round only some corners (a bottom sheet's top edge). */
export interface CornerRadii {
  readonly tl: number;
  readonly tr: number;
  readonly br: number;
  readonly bl: number;
}

export function corners(radius: number): CornerRadii {
  return { tl: radius, tr: radius, br: radius, bl: radius };
}

const HALF = 0.5;

/** Traces a rounded rectangle; each radius is clamped to half the shorter side. */
export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  radius: number | CornerRadii,
): void {
  const radii = typeof radius === 'number' ? corners(radius) : radius;
  const limit = Math.max(0, Math.min(r.w, r.h) * HALF);
  const tl = Math.min(radii.tl, limit);
  const tr = Math.min(radii.tr, limit);
  const br = Math.min(radii.br, limit);
  const bl = Math.min(radii.bl, limit);
  const right = r.x + r.w;
  const bottom = r.y + r.h;
  ctx.beginPath();
  ctx.moveTo(r.x + tl, r.y);
  ctx.lineTo(right - tr, r.y);
  ctx.arcTo(right, r.y, right, r.y + tr, tr);
  ctx.lineTo(right, bottom - br);
  ctx.arcTo(right, bottom, right - br, bottom, br);
  ctx.lineTo(r.x + bl, bottom);
  ctx.arcTo(r.x, bottom, r.x, bottom - bl, bl);
  ctx.lineTo(r.x, r.y + tl);
  ctx.arcTo(r.x, r.y, r.x + tl, r.y, tl);
  ctx.closePath();
}

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
  ctx.save();
  if (skin.shadow !== null) {
    ctx.shadowColor = skin.shadow.color;
    ctx.shadowBlur = skin.shadow.blur;
    ctx.shadowOffsetY = skin.shadow.offsetY;
  }
  fillRounded(ctx, r, radius, skin.fill);
  ctx.restore();
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
