/**
 * Small pills: a count on an icon, a "NEW" tag, a category label. Badges take
 * no input.
 */

import { centerIn, type Rect } from '../core/geom';
import type { Ui } from '../core/UiRoot';
import { withAlpha } from '../theme/color';
import type { Theme, TypeStyle } from '../theme/tokens';
import { fillRounded, strokeRounded } from './paint';
import { measureText, text } from './text';

export const BADGE_TONES = ['accent', 'danger', 'success', 'warning', 'info', 'neutral'] as const;

export type BadgeTone = (typeof BADGE_TONES)[number];

export interface BadgeOptions {
  readonly label: string;
  readonly tone?: BadgeTone;
  /** A token colour that overrides the tone, e.g. a category colour. */
  readonly color?: string;
  /** `solid` for counts that must catch the eye; `soft` for tags. */
  readonly variant?: 'solid' | 'soft';
  /** `count` sets a number; `tag` sets small spaced capitals. */
  readonly kind?: 'count' | 'tag';
}

const SOFT_FILL_ALPHA = 0.16;
const SOFT_BORDER_ALPHA = 0.4;
const BORDER_WIDTH = 1;

function toneColor(theme: Theme, tone: BadgeTone): string {
  const { palette } = theme;
  switch (tone) {
    case 'accent':
      return palette.accent.base;
    case 'danger':
      return palette.state.danger;
    case 'success':
      return palette.state.success;
    case 'warning':
      return palette.state.warning;
    case 'info':
      return palette.state.info;
    case 'neutral':
      return palette.text.secondary;
  }
}

function badgeStyle(theme: Theme, kind: 'count' | 'tag'): TypeStyle {
  return kind === 'tag'
    ? theme.type.overline
    : { ...theme.type.caption, weight: theme.type.label.weight };
}

/** The pill a badge needs for `label`. */
export function badgeSize(
  ui: Ui,
  opts: Pick<BadgeOptions, 'label' | 'kind'>,
): { w: number; h: number } {
  const style = badgeStyle(ui.theme, opts.kind ?? 'count');
  const h = style.lineHeight + ui.theme.space.xxs * 2;
  const w = Math.max(h, measureText(ui, opts.label, { style }) + ui.theme.space.sm * 2);
  return { w: Math.ceil(w), h };
}

/** Draws the badge's pill centred in `rect`, at its natural size. Returns the pill. */
export function badge(ui: Ui, rect: Rect, opts: BadgeOptions): Rect {
  const kind = opts.kind ?? 'count';
  const variant = opts.variant ?? (kind === 'count' ? 'solid' : 'soft');
  const { theme } = ui;
  const tone = opts.color ?? toneColor(theme, opts.tone ?? 'accent');
  const size = badgeSize(ui, opts);
  const pill = centerIn(rect, size.w, size.h);
  const { ctx } = ui;
  if (variant === 'solid') {
    fillRounded(ctx, pill, theme.radius.pill, tone);
  } else {
    fillRounded(ctx, pill, theme.radius.pill, withAlpha(tone, SOFT_FILL_ALPHA));
    strokeRounded(ctx, pill, theme.radius.pill, withAlpha(tone, SOFT_BORDER_ALPHA), BORDER_WIDTH);
  }
  text(ui, pill, {
    text: opts.label,
    style: badgeStyle(theme, kind),
    color: variant === 'solid' ? theme.palette.text.inverse : tone,
    align: 'center',
  });
  return pill;
}
