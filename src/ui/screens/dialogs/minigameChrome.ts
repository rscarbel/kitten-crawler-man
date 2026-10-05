/**
 * Theme-drawn chrome for the two mini-games that keep their own layouts: the
 * Desperado Club's blackjack table and the keyboard-hero board. Every painter
 * takes a {@link PaintTarget}, so the bare-context renders and a future
 * `render(ui)` surface share them.
 */

import type { Rect } from '../../core/geom';
import { darken, withAlpha } from '../../theme/color';
import { skinsFor, type ButtonSkin, type ControlColors, type MeterSkin } from '../../theme/skins';
import type { Theme, TypeStyle } from '../../theme/tokens';
import { drawFocusRing, fillRounded, strokeRounded, type PaintTarget } from '../../widgets/paint';
import { text, type TextOptions, type TextResult } from '../../widgets/text';

/** What a control looks like this frame, however the caller learned it. */
export interface ControlLook {
  readonly hovered: boolean;
  readonly pressed: boolean;
  readonly focused: boolean;
}

export interface SkinnedControlOptions {
  readonly label: string;
  readonly skin: ButtonSkin;
  readonly look: ControlLook;
  readonly disabled: boolean;
  readonly radius: number;
  readonly textStyle: TypeStyle;
}

/**
 * A button face in a skin's colours: rest, hover, press and disabled, plus the
 * focus ring. Hover switches rather than tweens, because a bare-context render
 * has no tween clock to ease it with.
 */
export function paintSkinnedControl(
  target: PaintTarget,
  rect: Rect,
  opts: SkinnedControlOptions,
): void {
  const { ctx } = target;
  const skins = skinsFor(target.theme);
  const pressed = opts.look.pressed && !opts.disabled;
  const drawn: Rect = pressed ? { ...rect, y: rect.y + skins.pressDrop } : rect;
  const colors = controlColors(opts.skin, opts.look, opts.disabled);
  if (opts.skin.glow !== null && !opts.disabled && !pressed) {
    ctx.save();
    ctx.shadowColor = opts.skin.glow;
    ctx.shadowBlur = target.theme.space.md;
    fillRounded(ctx, drawn, opts.radius, colors.fill);
    ctx.restore();
  }
  fillRounded(ctx, drawn, opts.radius, colors.fill);
  strokeRounded(ctx, drawn, opts.radius, colors.border, opts.skin.borderWidth);
  if (opts.look.focused && !opts.disabled) drawFocusRing(target, drawn, opts.radius);
  if (opts.label === '') return;
  text(target, drawn, {
    text: opts.label,
    style: opts.textStyle,
    color: colors.text,
    align: 'center',
    valign: 'middle',
  });
}

function controlColors(skin: ButtonSkin, look: ControlLook, disabled: boolean): ControlColors {
  if (disabled) return skin.disabled;
  if (look.pressed) return skin.press;
  if (look.hovered) return skin.hover;
  return skin.rest;
}

export interface GlowTextOptions extends TextOptions {
  /** A soft glow behind the glyphs, or none. */
  readonly glow?: string;
  readonly glowBlur?: number;
  /** Opacity the whole string is drawn at. */
  readonly alpha?: number;
}

/** Text with an optional glow and fade, for game-feel moments: judgements, stamps, outcomes. */
export function glowText(target: PaintTarget, rect: Rect, opts: GlowTextOptions): TextResult {
  const { ctx } = target;
  ctx.save();
  ctx.globalAlpha *= Math.max(0, Math.min(1, opts.alpha ?? 1));
  if (opts.glow !== undefined) {
    ctx.shadowColor = opts.glow;
    ctx.shadowBlur = opts.glowBlur ?? target.theme.space.md;
  }
  const result = text(target, rect, opts);
  ctx.restore();
  return result;
}

/** A filled bar in a meter skin's colours, the fill clipped to the track's rounded shape. */
export function paintTrackBar(
  target: PaintTarget,
  rect: Rect,
  value: number,
  skin: MeterSkin,
): void {
  const { ctx } = target;
  const radius = Math.min(skin.radius, rect.h / 2);
  fillRounded(ctx, rect, radius, skin.track);
  const filled = Math.max(0, Math.min(1, value)) * rect.w;
  if (filled <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, filled, rect.h);
  ctx.clip();
  fillRounded(ctx, rect, radius, skin.fill);
  ctx.restore();
}

/** A type style at an arbitrary size, for text that scales with a board or a fitted panel. */
export function scaledStyle(base: TypeStyle, size: number): TypeStyle {
  const ratio = size / base.size;
  return { ...base, size, lineHeight: base.lineHeight * ratio };
}

const FELT_ALPHA = 0.55;
const BET_SPOT_DARKEN = 0.45;
const BET_SPOT_ALPHA = 0.6;
const FELT_LINE_ALPHA = 0.35;
const PORTRAIT_ALPHA = 0.7;
const TURNED_AWAY_DARKEN = 0.82;
const TURNED_AWAY_ALPHA = 0.96;
const WIN_HIGHLIGHT_ALPHA = 0.8;
const WELL_ALPHA = 0.75;
const WELL_HOVER_ALPHA = 0.08;
const BET_SPOT_HOVER_ALPHA = 0.06;

/** Every colour the blackjack table paints its chrome with, derived from tokens. */
export interface CasinoTableColors {
  readonly title: string;
  readonly readout: string;
  readonly readoutLive: string;
  readonly label: string;
  readonly muted: string;
  readonly win: string;
  readonly lose: string;
  readonly push: string;
  readonly feedback: string;
  readonly felt: string;
  readonly feltOpaque: string;
  readonly feltLine: string;
  readonly betSpot: string;
  readonly betSpotHover: string;
  readonly portrait: string;
  readonly portraitBorder: string;
  readonly turnedAwayScrim: string;
  readonly turnedAwayTitle: string;
  readonly winHighlight: string;
  readonly coin: string;
  readonly well: string;
  readonly wellHover: string;
  readonly wellRim: string;
}

const tableColorCache = new WeakMap<Theme, CasinoTableColors>();

export function casinoTableColors(theme: Theme): CasinoTableColors {
  const cached = tableColorCache.get(theme);
  if (cached !== undefined) return cached;
  const { palette } = theme;
  const chip = skinsFor(theme).casinoChip;
  const colors: CasinoTableColors = {
    title: palette.accent.base,
    readout: palette.text.secondary,
    readoutLive: palette.accent.base,
    label: palette.text.secondary,
    muted: palette.text.muted,
    win: palette.state.success,
    lose: palette.state.danger,
    push: palette.text.secondary,
    feedback: palette.state.warning,
    felt: withAlpha(chip.felt, FELT_ALPHA),
    feltOpaque: chip.felt,
    feltLine: withAlpha(chip.rim, FELT_LINE_ALPHA),
    betSpot: withAlpha(darken(chip.felt, BET_SPOT_DARKEN), BET_SPOT_ALPHA),
    betSpotHover: withAlpha(palette.text.primary, BET_SPOT_HOVER_ALPHA),
    portrait: withAlpha(palette.surface.sunken, PORTRAIT_ALPHA),
    portraitBorder: palette.border.subtle,
    turnedAwayScrim: withAlpha(darken(palette.state.danger, TURNED_AWAY_DARKEN), TURNED_AWAY_ALPHA),
    turnedAwayTitle: palette.text.primary,
    winHighlight: withAlpha(palette.accent.base, WIN_HIGHLIGHT_ALPHA),
    coin: palette.accent.base,
    well: withAlpha(palette.surface.sunken, WELL_ALPHA),
    wellHover: withAlpha(palette.text.primary, WELL_HOVER_ALPHA),
    wellRim: chip.rim,
  };
  tableColorCache.set(theme, colors);
  return colors;
}
