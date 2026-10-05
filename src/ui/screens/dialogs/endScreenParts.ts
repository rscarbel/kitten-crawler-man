/**
 * Pieces the end screens share: the celebration effects (fireworks, confetti,
 * light rays, pulsing corner runes), the oversized headline, a backdrop that
 * fades in on the screen's own timeline, and the body sizing that decides
 * whether a panel's content must scroll.
 *
 * Every effect advances one step per call to `tick`, which the screens make
 * once per render frame, matching the timelines they run on.
 */

import type { Rect } from '../../core/geom';
import type { Ui } from '../../core/UiRoot';
import { withAlpha } from '../../theme/color';
import type { Theme, TypeStyle } from '../../theme/tokens';
import { panelBodyMaxHeight, panelBodyWidth, type PanelOptions } from '../../widgets/panel';
import { scrollGutterWidth } from '../../widgets/scrollView';
import { measureText, text, type TextAlign } from '../../widgets/text';

const FULL_TURN = Math.PI * 2;
const HALF = 0.5;
const MS_PER_SECOND = 1000;

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Seconds on the UI clock, for pulses and twinkles. */
export function seconds(ui: Ui): number {
  return ui.now / MS_PER_SECOND;
}

function pick(colors: readonly string[], fallback: string): string {
  return colors[Math.floor(Math.random() * colors.length)] ?? fallback;
}

/** The firework colours: golds first, then the cooler accents that keep it festive. */
export function sparkleColors(theme: Theme): readonly string[] {
  const { palette } = theme;
  return [
    palette.accent.base,
    palette.material.brassLight,
    palette.accent.hover,
    palette.accent.press,
    palette.category.book,
    palette.meter.xp,
    palette.state.info,
    palette.state.success,
  ];
}

/** The confetti colours. */
export function confettiColors(theme: Theme): readonly string[] {
  const { palette } = theme;
  return [
    palette.accent.base,
    palette.meter.boss,
    palette.state.info,
    palette.state.success,
    palette.category.book,
    palette.crawler.cat,
  ];
}

const SPARKLE_MIN_SPEED = 1.5;
const SPARKLE_SPEED_RANGE = 5.5;
const SPARKLE_MIN_LIFE = 80;
const SPARKLE_LIFE_RANGE = 80;
const SPARKLE_SPAWN_JITTER = 60;
const SPARKLE_MIN_SIZE = 1.5;
const SPARKLE_SIZE_RANGE = 3.5;
const SPARKLE_GRAVITY = 0.06;
const SPARKLE_DRAG = 0.98;
const SPARKLE_GLOW_MULTIPLIER = 4;
const TWINKLE_BASE = 0.55;
const TWINKLE_RANGE = 0.45;
const TWINKLE_FREQ = 6;

interface Sparkle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  readonly maxLife: number;
  readonly size: number;
  readonly color: string;
  readonly twinkleOffset: number;
}

/** Glowing sparks thrown out in bursts that arc down under gravity and twinkle out. */
export class Sparkles {
  private items: Sparkle[] = [];

  clear(): void {
    this.items = [];
  }

  burst(cx: number, cy: number, count: number, colors: readonly string[]): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * FULL_TURN;
      const speed = SPARKLE_MIN_SPEED + Math.random() * SPARKLE_SPEED_RANGE;
      const maxLife = SPARKLE_MIN_LIFE + Math.floor(Math.random() * SPARKLE_LIFE_RANGE);
      this.items.push({
        x: cx + (Math.random() - HALF) * SPARKLE_SPAWN_JITTER,
        y: cy + (Math.random() - HALF) * SPARKLE_SPAWN_JITTER,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - SPARKLE_MIN_SPEED,
        life: maxLife,
        maxLife,
        size: SPARKLE_MIN_SIZE + Math.random() * SPARKLE_SIZE_RANGE,
        color: pick(colors, ''),
        twinkleOffset: Math.random() * FULL_TURN,
      });
    }
  }

  /** A burst somewhere on a ring round (`cx`, `cy`), so it never goes off behind the panel's text. */
  burstAround(
    cx: number,
    cy: number,
    ring: { readonly min: number; readonly range: number },
    count: number,
    colors: readonly string[],
  ): void {
    const angle = Math.random() * FULL_TURN;
    const r = ring.min + Math.random() * ring.range;
    this.burst(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r, count, colors);
  }

  tick(): void {
    for (const s of this.items) {
      s.x += s.vx;
      s.y += s.vy;
      s.vy += SPARKLE_GRAVITY;
      s.vx *= SPARKLE_DRAG;
      s.life--;
    }
    this.items = this.items.filter((s) => s.life > 0);
  }

  draw(ctx: CanvasRenderingContext2D, alpha: number, nowSeconds: number): void {
    ctx.save();
    const base = ctx.globalAlpha;
    for (const s of this.items) {
      if (s.color === '') continue;
      const lifeRatio = s.life / s.maxLife;
      const twinkle =
        TWINKLE_BASE + TWINKLE_RANGE * Math.sin(nowSeconds * TWINKLE_FREQ + s.twinkleOffset);
      ctx.globalAlpha = base * clamp01(lifeRatio * twinkle * alpha);
      ctx.shadowColor = s.color;
      ctx.shadowBlur = s.size * SPARKLE_GLOW_MULTIPLIER;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size * lifeRatio, 0, FULL_TURN);
      ctx.fill();
    }
    ctx.restore();
  }
}

const CONFETTI_MIN_W = 4;
const CONFETTI_W_RANGE = 4;
const CONFETTI_MIN_H = 6;
const CONFETTI_H_RANGE = 6;
const CONFETTI_MIN_FALL = 1.2;
const CONFETTI_FALL_RANGE = 1.8;
const CONFETTI_DRIFT_RANGE = 1.2;
const CONFETTI_SPIN_RANGE = 0.2;
const CONFETTI_SWAY_AMPLITUDE = 0.6;
const CONFETTI_SWAY_FREQ = 0.05;
const CONFETTI_SPAWN_ABOVE = 20;
const CONFETTI_ALPHA = 0.9;
/** A piece's flip is a squash of its height by the cosine of its spin. */
const CONFETTI_FLIP_RATE = 2;

interface ConfettiPiece {
  x: number;
  y: number;
  readonly vx: number;
  readonly vy: number;
  readonly w: number;
  readonly h: number;
  angle: number;
  readonly spin: number;
  swayPhase: number;
  readonly color: string;
}

/** Paper confetti drifting down from above the top edge, swaying and flipping as it falls. */
export class Confetti {
  private pieces: ConfettiPiece[] = [];

  clear(): void {
    this.pieces = [];
  }

  /** Drops one piece in at a random spot along the top of `area`. */
  spawn(area: Rect, colors: readonly string[]): void {
    this.pieces.push({
      x: area.x + Math.random() * area.w,
      y: area.y - CONFETTI_SPAWN_ABOVE,
      vx: (Math.random() - HALF) * CONFETTI_DRIFT_RANGE,
      vy: CONFETTI_MIN_FALL + Math.random() * CONFETTI_FALL_RANGE,
      w: CONFETTI_MIN_W + Math.random() * CONFETTI_W_RANGE,
      h: CONFETTI_MIN_H + Math.random() * CONFETTI_H_RANGE,
      angle: Math.random() * FULL_TURN,
      spin: (Math.random() - HALF) * CONFETTI_SPIN_RANGE,
      swayPhase: Math.random() * FULL_TURN,
      color: pick(colors, ''),
    });
  }

  /** Moves every piece on; pieces past the bottom of `area` are dropped. */
  tick(area: Rect): void {
    for (const c of this.pieces) {
      c.swayPhase += CONFETTI_SWAY_FREQ;
      c.x += c.vx + Math.sin(c.swayPhase) * CONFETTI_SWAY_AMPLITUDE;
      c.y += c.vy;
      c.angle += c.spin;
    }
    const bottom = area.y + area.h + CONFETTI_SPAWN_ABOVE;
    this.pieces = this.pieces.filter((c) => c.y < bottom);
  }

  draw(ctx: CanvasRenderingContext2D, alpha: number): void {
    ctx.save();
    ctx.globalAlpha *= alpha * CONFETTI_ALPHA;
    for (const c of this.pieces) {
      if (c.color === '') continue;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.angle);
      ctx.fillStyle = c.color;
      const flippedH = c.h * Math.cos(c.angle * CONFETTI_FLIP_RATE);
      ctx.fillRect(-c.w / 2, -flippedH / 2, c.w, flippedH);
      ctx.restore();
    }
    ctx.restore();
  }
}

const RAY_COUNT = 14;
const RAY_SPIN_PER_SECOND = 0.12;
const RAY_ALPHA = 0.1;
const RAY_HALF_WIDTH_RADIANS = 0.09;
const RAY_LENGTH_FRACTION = 0.9;

/** Slowly turning shafts of light fanning out from the middle of `area`. */
export function drawRays(
  ctx: CanvasRenderingContext2D,
  area: Rect,
  color: string,
  alpha: number,
  nowSeconds: number,
): void {
  const cx = area.x + area.w / 2;
  const cy = area.y + area.h / 2;
  const length = Math.max(area.w, area.h) * RAY_LENGTH_FRACTION;
  const spin = nowSeconds * RAY_SPIN_PER_SECOND;
  ctx.save();
  ctx.globalAlpha *= alpha * RAY_ALPHA;
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, length);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = gradient;
  for (let i = 0; i < RAY_COUNT; i++) {
    const angle = spin + (i / RAY_COUNT) * FULL_TURN;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, length, angle - RAY_HALF_WIDTH_RADIANS, angle + RAY_HALF_WIDTH_RADIANS);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

const RUNE_ALPHA_MIN = 0.3;
const RUNE_ALPHA_RANGE = 0.2;
const RUNE_PULSE_FREQ = 1.8;
const RUNE_LINE_WIDTH = 1.5;
const RUNE_CORNER_LEN = 18;
const RUNE_CORNER_INSET = 10;

/** Gold brackets in each corner of `frame`, pulsing gently. */
export function drawRuneCorners(
  ctx: CanvasRenderingContext2D,
  frame: Rect,
  color: string,
  nowSeconds: number,
): void {
  const left = frame.x + RUNE_CORNER_INSET;
  const right = frame.x + frame.w - RUNE_CORNER_INSET;
  const top = frame.y + RUNE_CORNER_INSET;
  const bottom = frame.y + frame.h - RUNE_CORNER_INSET;
  ctx.save();
  ctx.globalAlpha *= RUNE_ALPHA_MIN + RUNE_ALPHA_RANGE * Math.sin(nowSeconds * RUNE_PULSE_FREQ);
  ctx.strokeStyle = color;
  ctx.lineWidth = RUNE_LINE_WIDTH;
  for (const [cx, cy, dx, dy] of [
    [left, top, 1, 1],
    [right, top, -1, 1],
    [left, bottom, 1, -1],
    [right, bottom, -1, -1],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(cx, cy + dy * RUNE_CORNER_LEN);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + dx * RUNE_CORNER_LEN, cy);
    ctx.stroke();
  }
  ctx.restore();
}

/** Fills the whole screen with the deepest surface colour at `alpha`: an end screen's own darkening backdrop. */
export function drawBackdrop(ui: Ui, alpha: number): void {
  const { ctx } = ui;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = ui.theme.palette.surface.sunken;
  ctx.fillRect(ui.screen.x, ui.screen.y, ui.screen.w, ui.screen.h);
  ctx.restore();
}

const DIVIDER_THICKNESS = 1;

/** A thin horizontal rule across the middle of `row`, stopping `inset` short of each end. */
export function drawDivider(ui: Ui, row: Rect, color: string, inset: number): void {
  const { ctx } = ui;
  ctx.save();
  ctx.fillStyle = color;
  ctx.fillRect(
    row.x + inset,
    row.y + (row.h - DIVIDER_THICKNESS) / 2,
    Math.max(0, row.w - inset * 2),
    DIVIDER_THICKNESS,
  );
  ctx.restore();
}

/** How much bigger than the display type an end screen's headline is drawn. */
const HEADLINE_SCALE = 1.6;

/**
 * The end screens' headline style: the display type scaled up, then down
 * again until `content` fits `maxWidth`, but never below the display size
 * itself. A phone keeps the plain display size, since its height is what
 * runs out first.
 */
export function headlineStyle(ui: Ui, content: string, maxWidth: number): TypeStyle {
  const display = ui.theme.type.display;
  if (ui.size === 'compact') return display;
  const big: TypeStyle = {
    ...display,
    size: Math.round(display.size * HEADLINE_SCALE),
    lineHeight: Math.round(display.lineHeight * HEADLINE_SCALE),
  };
  const natural = measureText(ui, content, { style: big });
  if (natural <= maxWidth) return big;
  const shrink = Math.max(display.size / big.size, maxWidth / natural);
  return {
    ...big,
    size: Math.floor(big.size * shrink),
    lineHeight: Math.ceil(big.lineHeight * shrink),
  };
}

export interface GlowTextOptions {
  readonly text: string;
  readonly style: TypeStyle;
  readonly color: string;
  readonly glow: string;
  readonly glowBlur: number;
  readonly align?: TextAlign;
}

/** One line of text with a soft coloured glow behind it. */
export function glowText(ui: Ui, rect: Rect, opts: GlowTextOptions): void {
  const { ctx } = ui;
  ctx.save();
  ctx.shadowColor = opts.glow;
  ctx.shadowBlur = opts.glowBlur;
  text(ui, rect, {
    text: opts.text,
    style: opts.style,
    color: opts.color,
    align: opts.align ?? 'center',
  });
  ctx.restore();
}

/** Whether a panel's body must scroll, and how tall its content is at the width it will be drawn. */
export interface BodyFit {
  readonly contentHeight: number;
  readonly scroll: boolean;
  /** The width the content is laid out at: the body's, less the scrollbar gutter when it scrolls. */
  readonly width: number;
}

/**
 * Measures content laid out by `measure` (height at a given width) against
 * the tallest body the panel can show, re-measuring at the narrower width a
 * scrollbar leaves when it does not fit.
 */
export function fitPanelBody(
  ui: Ui,
  opts: Pick<
    PanelOptions,
    'width' | 'title' | 'subtitle' | 'footer' | 'footerSize' | 'onClose' | 'onBack'
  >,
  measure: (width: number) => number,
): BodyFit {
  const bodyW = panelBodyWidth(ui, opts.width);
  const natural = measure(bodyW);
  if (natural <= panelBodyMaxHeight(ui, opts)) {
    return { contentHeight: natural, scroll: false, width: bodyW };
  }
  const width = bodyW - scrollGutterWidth(ui);
  return { contentHeight: measure(width), scroll: true, width };
}
