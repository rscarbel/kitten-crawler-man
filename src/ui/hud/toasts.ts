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
import { prefersReducedMotion } from '../core/reducedMotion';
import {
  carolineCloseAt,
  carolineOpenAt,
  carolineOpenDurationMs,
  carolineRevealAt,
  carolineToast,
  layoutCarolineToast,
  type CarolineToastLayout,
} from '../widgets/carolineFrame';
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
const MS_PER_TICK = MS_PER_SECOND / TICKS_PER_SECOND;
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

/**
 * Who a toast speaks for: an ordinary HUD notice, or Caroline, the System AI,
 * whose notices are drawn in the compact variant of her own frame.
 */
export type ToastVoice = 'hud' | 'caroline';

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
  /**
   * What happens when the stack is already full. `evict` (the default) drops
   * the oldest toast, right for a status that supersedes what came before.
   * `queue` waits for a free row instead, for a burst where every line must be
   * read, such as a room unlocking four songs at once; a queued toast starts
   * its clock only once it is on screen.
   */
  readonly overflow?: ToastOverflow;
  /** Defaults to `hud`. Icon, tone and urgency are the HUD notice's look and do not apply to `caroline`. */
  readonly voice?: ToastVoice;
}

export type ToastOverflow = 'evict' | 'queue';

/** A toast as the renderer sees it. */
export interface ShownToast {
  readonly id: number;
  readonly text: string;
  readonly icon: GlyphId | null;
  readonly tone: ToastTone;
  readonly urgent: boolean;
  readonly voice: ToastVoice;
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
  voice: ToastVoice;
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
  /** Toasts posted with `overflow: 'queue'` while the stack was full, oldest first. */
  private readonly waiting: Toast[] = [];
  /** How many of the oldest toasts the last frame had no room to draw. */
  private unseen = 0;
  private nextId = 0;

  get isEmpty(): boolean {
    return this.toasts.length === 0 && this.waiting.length === 0;
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
      voice: opts.voice ?? 'hud',
      ticksLeft: opts.durationTicks ?? TOAST_DISPLAY_TICKS,
    };
    const key = opts.key ?? null;
    if (key !== null) {
      const keyed =
        this.toasts.find((toast) => toast.key === key) ??
        this.waiting.find((toast) => toast.key === key);
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
    const toast: Toast = { id: this.nextId++, key, age, ...fields };
    const stackFull = this.toasts.length >= MAX_VISIBLE_TOASTS;
    const mustWait = opts.overflow === 'queue' && (stackFull || this.waiting.length > 0);
    if (mustWait) {
      this.waiting.push(toast);
      return;
    }
    this.toasts.push(toast);
    while (this.toasts.length > MAX_VISIBLE_TOASTS) this.toasts.shift();
  }

  /** Whether a toast posted with `key` is still up or waiting for a row. */
  isShowing(key: string): boolean {
    return (
      this.toasts.some((toast) => toast.key === key) ||
      this.waiting.some((toast) => toast.key === key)
    );
  }

  /**
   * The oldest `count` toasts found no room on screen this frame. They keep
   * their time until they are drawn, so a notice is never spent unread.
   */
  holdUnseen(count: number): void {
    this.unseen = count;
  }

  /**
   * The keys of toasts not yet read: waiting for a row, held off screen, or
   * up for fewer than `readTicks` ticks. Oldest first.
   */
  unreadKeys(readTicks: number): string[] {
    const onScreen = this.toasts.filter(
      (toast, index) => index < this.unseen || toast.age < readTicks,
    );
    return [...onScreen, ...this.waiting].map((toast) => toast.key).filter((key) => key !== null);
  }

  /** Call once per game tick. */
  update(): void {
    for (let index = this.toasts.length - 1; index >= this.unseen; index--) {
      const toast = this.toasts[index];
      toast.age++;
      toast.ticksLeft--;
      if (toast.ticksLeft <= 0) this.toasts.splice(index, 1);
    }
    while (this.toasts.length < MAX_VISIBLE_TOASTS) {
      const next = this.waiting.shift();
      if (next === undefined) break;
      this.toasts.push(next);
    }
  }

  /** Drops everything on screen and waiting, for scene teardown. */
  clear(): void {
    this.toasts.length = 0;
    this.waiting.length = 0;
    this.unseen = 0;
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

/** A toast laid out for drawing: the HUD pill, or Caroline's frame with its own layout. */
type ToastBox = HudToastBox | CarolineToastBox;

interface CarolineToastBox {
  readonly kind: 'caroline';
  readonly layout: CarolineToastLayout;
  readonly height: number;
}

interface HudToastBox {
  readonly kind: 'hud';
  readonly metrics: ToastMetrics;
  readonly iconSpan: number;
  readonly textWidth: number;
  readonly textHeight: number;
  readonly width: number;
  readonly height: number;
}

function layoutToast(ui: Ui, toast: ShownToast, anchor: ToastAnchor): ToastBox {
  if (toast.voice === 'caroline') {
    const maxWidth = Math.min(MAX_TOAST_WIDTH, anchor.maxWidth);
    const layout = layoutCarolineToast(ui, maxWidth, toast.text);
    return { kind: 'caroline', layout, height: layout.h };
  }
  const metrics = metricsFor(ui, toast.urgent);
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
  const width = metrics.padX * 2 + iconSpan + textWidth;
  return { kind: 'hud', metrics, iconSpan, textWidth, textHeight, width, height };
}

/**
 * Caroline's notice: her frame unfolds as it arrives, her text decodes in,
 * and it folds shut over the ticks it would otherwise fade through.
 */
function drawCarolineToast(
  ui: Ui,
  toast: ShownToast,
  anchor: ToastAnchor,
  bottom: number,
  box: CarolineToastBox,
): void {
  const { theme } = ui;
  const reducedMotion = prefersReducedMotion();
  const sinceArrivalMs = toast.age * MS_PER_TICK;
  const closeMs = carolineOpenDurationMs(theme);
  const closingMs = closeMs - toast.ticksLeft * MS_PER_TICK;
  const open =
    closingMs > 0
      ? carolineCloseAt(theme, closingMs, reducedMotion)
      : carolineOpenAt(theme, sinceArrivalMs, reducedMotion);
  const reveal = carolineRevealAt(
    theme,
    toast.text,
    Math.max(0, sinceArrivalMs - closeMs),
    reducedMotion,
  );
  const { layout } = box;
  const at = { x: anchor.x - layout.w / 2, y: bottom - layout.h };
  carolineToast(ui, at, layout, { reveal, nowMs: ui.now, open });
}

function drawToast(
  ui: Ui,
  toast: ShownToast,
  anchor: ToastAnchor,
  bottom: number,
  box: ToastBox,
): void {
  if (box.kind === 'caroline') {
    drawCarolineToast(ui, toast, anchor, bottom, box);
    return;
  }
  const { theme, ctx } = ui;
  const { metrics, iconSpan, textWidth, textHeight, width, height } = box;
  const color = toneColor(theme, toast.tone);
  const enter = easeOut(Math.min(1, toast.age / TOAST_ENTER_TICKS));
  const fade = toast.ticksLeft < TOAST_FADE_TICKS ? toast.ticksLeft / TOAST_FADE_TICKS : 1;
  const alpha = Math.max(0, enter * fade);
  const isSingleLine = textHeight <= lineHeightOf(ui, metrics.role);
  const cornerRadius = isSingleLine ? theme.radius.pill : theme.radius.lg;
  const slide = (1 - enter) * theme.space.sm;
  const pill: Rect = {
    x: anchor.x - width / 2,
    y: bottom - height + slide,
    w: width,
    h: height,
  };
  if (alpha <= 0) return;

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
 *
 * No toast rises above `ceiling`: on a short screen whatever stands above the
 * stack (a song's credit card) stays readable. The oldest toasts that do not
 * fit are held, unaged, until there is room.
 *
 * Returns the top of the stack as drawn, `anchor.bottom` when nothing is.
 */
export function renderToasts(
  ui: Ui,
  toasts: HudToasts,
  anchor: ToastAnchor,
  ceiling = -Infinity,
): number {
  const shown = toasts.shown;
  let bottom = anchor.bottom;
  let top = anchor.bottom;
  for (let index = shown.length - 1; index >= 0; index--) {
    const toast = shown[index];
    const box = layoutToast(ui, toast, anchor);
    if (bottom - box.height < ceiling) {
      toasts.holdUnseen(index + 1);
      return top;
    }
    drawToast(ui, toast, anchor, bottom, box);
    top = bottom - box.height;
    bottom = top - ui.theme.space.xs;
  }
  toasts.holdUnseen(0);
  return top;
}
