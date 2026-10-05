/**
 * The one stack of short notices above the hotbar: pill toasts with a
 * tone-tinted glyph, stacked upward from an anchor with the newest nearest it
 * and the oldest dropped off the top once the stack is full.
 *
 * Toasts fire mid-fight for something the player must read without losing
 * sight of the room, and fade on their own so nothing has to dismiss them.
 * Their clock is the scene's update tick rather than wall time: a toast ages
 * once per update, including updates that halt the world for a dialog.
 */

import { centerIn, type Rect } from '../core/geom';
import type { Ui } from '../core/UiRoot';
import { withAlpha } from '../theme/color';
import { drawGlyph, type GlyphId } from '../theme/glyphs';
import { skinsFor, type TextRole } from '../theme/skins';
import { motion, type Theme } from '../theme/tokens';
import { drawGlass, fillRounded } from '../widgets/paint';
import { lineHeightOf, measureText, measureTextHeight, text } from '../widgets/text';

/** Beyond this, the oldest toast is dropped rather than growing the stack up the screen. */
export const MAX_VISIBLE_TOASTS = 4;

/** How long a toast stays up: 2.5s at 60 ticks a second, a glance without being a fixture. */
export const TOAST_DISPLAY_TICKS = 150;

/** Ticks at the end of a toast's life spent fading out, so it never simply blinks out. */
export const TOAST_FADE_TICKS = 30;

const TICKS_PER_SECOND = 60;
const MS_PER_SECOND = 1000;
const TOAST_ENTER_TICKS = Math.max(1, Math.round((motion.base * TICKS_PER_SECOND) / MS_PER_SECOND));
const EASE_OUT_POWER = 3;

/** The widest a toast is drawn even in a wide lane, so a long line stays a glance. */
const MAX_TOAST_WIDTH = 520;
/** A longer message wraps onto a second line; past that it ends in an ellipsis. */
const MAX_TOAST_LINES = 2;

const BORDER_TINT_ALPHA = 0.35;
const URGENT_BORDER_TINT_ALPHA = 0.85;
const URGENT_FILL_TINT_ALPHA = 0.14;
const URGENT_GLOW_ALPHA = 0.45;
/** An urgent toast's glyph against a normal one's, to be seen over a busy screen. */
const URGENT_ICON_SCALE = 1.4;

export type ToastTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

export interface ToastOptions {
  /** Drawn on the left, tinted with the tone. Tones other than `neutral` show a default glyph. */
  readonly icon?: GlyphId;
  readonly tone?: ToastTone;
  /** Larger, tinted and outlined in the tone, for a notice that must win over a busy screen. */
  readonly urgent?: boolean;
  /**
   * Restart a toast already showing these exact words instead of stacking a
   * second copy, moving it back to the newest row so a refreshed line cannot
   * outlive the one below it and shuffle the rows. Defaults to true: the same
   * sentence twice is the same information twice. Wrong for a line whose
   * repetition is the information, such as three identical kill flags.
   */
  readonly merge?: boolean;
  /**
   * A toast posted with the key of one already showing replaces it in its row
   * without sliding in again, so a status that changes ("Saving..." to "Game
   * Saved") reads as one toast.
   */
  readonly key?: string;
  /** Ticks the toast stays up, fade included. Defaults to {@link TOAST_DISPLAY_TICKS}. */
  readonly durationTicks?: number;
}

/** A toast as the renderer sees it. */
export interface ShownToast {
  readonly id: number;
  readonly text: string;
  readonly icon: GlyphId | null;
  readonly tone: ToastTone;
  readonly urgent: boolean;
  /** Ticks since the toast first appeared. */
  readonly age: number;
  readonly ticksLeft: number;
}

interface Toast {
  readonly id: number;
  text: string;
  icon: GlyphId | null;
  tone: ToastTone;
  urgent: boolean;
  key: string | null;
  age: number;
  ticksLeft: number;
}

const DEFAULT_TONE_ICONS: Readonly<Record<ToastTone, GlyphId | null>> = {
  neutral: null,
  success: 'check',
  warning: 'alert',
  danger: 'alert',
  info: 'info',
  accent: 'sparkle',
};

export class HudToasts {
  /** Oldest first. */
  private readonly toasts: Toast[] = [];
  private nextId = 0;

  get isEmpty(): boolean {
    return this.toasts.length === 0;
  }

  /** Oldest first; the renderer puts the newest nearest the anchor. */
  get shown(): readonly ShownToast[] {
    return this.toasts;
  }

  post(text: string, opts: ToastOptions = {}): void {
    const tone = opts.tone ?? 'neutral';
    const fields = {
      text,
      icon: opts.icon ?? DEFAULT_TONE_ICONS[tone],
      tone,
      urgent: opts.urgent === true,
      ticksLeft: opts.durationTicks ?? TOAST_DISPLAY_TICKS,
    };
    const key = opts.key ?? null;
    if (key !== null) {
      const keyed = this.toasts.find((toast) => toast.key === key);
      if (keyed !== undefined) {
        Object.assign(keyed, fields);
        return;
      }
    }
    let age = 0;
    if (opts.merge !== false) {
      const showingIndex = this.toasts.findIndex(
        (toast) => toast.key === null && toast.text === text,
      );
      if (showingIndex !== -1) {
        age = this.toasts[showingIndex].age;
        this.toasts.splice(showingIndex, 1);
      }
    }
    this.toasts.push({ id: this.nextId++, key, age, ...fields });
    while (this.toasts.length > MAX_VISIBLE_TOASTS) this.toasts.shift();
  }

  /** Whether a toast posted with `key` is still up. */
  isShowing(key: string): boolean {
    return this.toasts.some((toast) => toast.key === key);
  }

  /** Call once per game tick. */
  update(): void {
    for (let index = this.toasts.length - 1; index >= 0; index--) {
      const toast = this.toasts[index];
      toast.age++;
      toast.ticksLeft--;
      if (toast.ticksLeft <= 0) this.toasts.splice(index, 1);
    }
  }

  /** Drops everything on screen, for scene teardown. */
  clear(): void {
    this.toasts.length = 0;
  }
}

function toneColor(theme: Theme, tone: ToastTone): string {
  const { palette } = theme;
  switch (tone) {
    case 'neutral':
      return palette.text.secondary;
    case 'accent':
      return palette.accent.base;
    case 'success':
      return palette.state.success;
    case 'warning':
      return palette.state.warning;
    case 'danger':
      return palette.state.danger;
    case 'info':
      return palette.state.info;
  }
}

interface ToastMetrics {
  readonly role: TextRole;
  readonly iconSize: number;
  readonly padX: number;
  readonly padY: number;
  readonly gap: number;
}

function metricsFor(ui: Ui, urgent: boolean): ToastMetrics {
  const { space, size } = ui.theme;
  const role: TextRole = urgent ? 'title' : 'label';
  const iconSize = urgent ? Math.round(size.icon * URGENT_ICON_SCALE) : size.icon;
  const padX = urgent ? space.lg : space.md;
  const padY = urgent ? space.sm : space.xs + space.xxs;
  return { role, iconSize, padX, padY, gap: space.sm };
}

function easeOut(linear: number): number {
  return 1 - Math.pow(1 - linear, EASE_OUT_POWER);
}

function drawToast(ui: Ui, toast: ShownToast, anchor: ToastAnchor, bottom: number): number {
  const { theme, ctx } = ui;
  const metrics = metricsFor(ui, toast.urgent);
  const color = toneColor(theme, toast.tone);
  const enter = easeOut(Math.min(1, toast.age / TOAST_ENTER_TICKS));
  const fade = toast.ticksLeft < TOAST_FADE_TICKS ? toast.ticksLeft / TOAST_FADE_TICKS : 1;
  const alpha = Math.max(0, enter * fade);
  const iconSpan = toast.icon === null ? 0 : metrics.iconSize + metrics.gap;
  const available = Math.min(MAX_TOAST_WIDTH, anchor.maxWidth);
  const textRoom = Math.max(0, available - metrics.padX * 2 - iconSpan);
  const textWidth = Math.min(
    Math.ceil(measureText(ui, toast.text, { role: metrics.role })),
    textRoom,
  );
  const textHeight = measureTextHeight(ui, textWidth, {
    text: toast.text,
    role: metrics.role,
    maxLines: MAX_TOAST_LINES,
  });
  const height = Math.max(metrics.iconSize, textHeight) + metrics.padY * 2;
  const isSingleLine = textHeight <= lineHeightOf(ui, metrics.role);
  const cornerRadius = isSingleLine ? theme.radius.pill : theme.radius.lg;
  const width = metrics.padX * 2 + iconSpan + textWidth;
  const slide = (1 - enter) * theme.space.sm;
  const pill: Rect = {
    x: anchor.x - width / 2,
    y: bottom - height + slide,
    w: width,
    h: height,
  };
  if (alpha <= 0) return height;

  const hudSkin = skinsFor(theme).panel.hud;
  const borderAlpha = toast.urgent ? URGENT_BORDER_TINT_ALPHA : BORDER_TINT_ALPHA;
  const skin = {
    ...hudSkin,
    border: withAlpha(color, borderAlpha),
    shadow:
      toast.urgent && hudSkin.shadow !== null
        ? { ...hudSkin.shadow, color: withAlpha(color, URGENT_GLOW_ALPHA) }
        : hudSkin.shadow,
  };
  ctx.save();
  ctx.globalAlpha *= alpha;
  drawGlass(ui, pill, skin, cornerRadius);
  if (toast.urgent) {
    fillRounded(ctx, pill, cornerRadius, withAlpha(color, URGENT_FILL_TINT_ALPHA));
  }
  let textX = pill.x + metrics.padX;
  if (toast.icon !== null) {
    const iconBox: Rect = { x: textX, y: pill.y, w: metrics.iconSize, h: pill.h };
    drawGlyph(ctx, toast.icon, centerIn(iconBox, metrics.iconSize, metrics.iconSize), { color });
    textX += iconSpan;
  }
  text(
    ui,
    { x: textX, y: pill.y + (pill.h - textHeight) / 2, w: textWidth, h: textHeight },
    {
      text: toast.text,
      role: metrics.role,
      color: theme.palette.text.primary,
      wrap: true,
      maxLines: MAX_TOAST_LINES,
    },
  );
  ctx.restore();
  return height;
}

/** Where the stack sits: centred on `x`, growing up from `bottom`, no toast wider than `maxWidth`. */
export interface ToastAnchor {
  readonly x: number;
  readonly bottom: number;
  readonly maxWidth: number;
}

/**
 * Draws the stack centred on `anchor.x`, growing upward from `anchor.bottom`
 * with the newest toast nearest it. A message wider than `anchor.maxWidth`
 * wraps to a second line. Toasts take no input.
 */
export function renderToasts(ui: Ui, toasts: HudToasts, anchor: ToastAnchor): void {
  const shown = toasts.shown;
  let bottom = anchor.bottom;
  for (let index = shown.length - 1; index >= 0; index--) {
    const height = drawToast(ui, shown[index], anchor, bottom);
    bottom -= height + ui.theme.space.xs;
  }
}
