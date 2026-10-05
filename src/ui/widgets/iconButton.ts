/**
 * A square button showing one glyph: close, back, the HUD dock buttons. Its
 * label is never drawn on the button; it shows as a tooltip on hover.
 */

import type { SoundId } from '../../audio/sounds';
import { centerIn, type Rect } from '../core/geom';
import type { HitState, Ui } from '../core/UiRoot';
import { drawGlyph, type GlyphId } from '../theme/glyphs';
import { skinsFor, type ButtonVariant, type ControlSize } from '../theme/skins';
import { badge, badgeSize } from './badge';
import { disabledReason, isDisabled, paintControl } from './paint';
import { tooltip } from './tooltip';

export interface IconButtonOptions {
  readonly id: string;
  readonly icon: GlyphId;
  /** What it does, shown as its tooltip. */
  readonly label: string;
  readonly variant?: ButtonVariant;
  readonly size?: ControlSize;
  readonly selected?: boolean;
  readonly disabled?: boolean | string;
  /** A count or tag pinned to the top-right corner. */
  readonly badge?: string;
  /** Show the label as a tooltip on hover. Defaults to true. */
  readonly tooltip?: boolean;
  readonly primary?: boolean;
  readonly sound?: SoundId | null;
  readonly onTap: () => void;
}

/** The side of the square an icon button of `size` takes. */
export function iconButtonSize(ui: Ui, size: ControlSize = 'md'): number {
  return skinsFor(ui.theme).controlSize[size].height;
}

/** Draws the button as the largest square centred in `rect`. */
export function iconButton(ui: Ui, rect: Rect, opts: IconButtonOptions): HitState {
  const skins = skinsFor(ui.theme);
  const sizeSkin = skins.controlSize[opts.size ?? 'md'];
  const side = Math.min(rect.w, rect.h);
  const square = centerIn(rect, side, side);
  const disabled = isDisabled(opts.disabled);
  const state = ui.hit(opts.id, square, {
    onTap: () => opts.onTap(),
    disabled,
    primary: opts.primary,
    sound: opts.sound,
  });
  const skin = opts.selected === true ? skins.selected : skins.button[opts.variant ?? 'quiet'];
  const painted = paintControl(ui, square, skin, state, {
    id: opts.id,
    radius: sizeSkin.radius,
    disabled,
  });
  drawGlyph(ui.ctx, opts.icon, centerIn(painted.rect, sizeSkin.icon, sizeSkin.icon), {
    color: painted.text,
  });
  if (opts.badge !== undefined) {
    const pill = badgeSize(ui, { label: opts.badge });
    const centreX = square.x + square.w - ui.theme.space.xxs;
    const centreY = square.y + ui.theme.space.xxs;
    badge(
      ui,
      { x: centreX - pill.w / 2, y: centreY - pill.h / 2, w: pill.w, h: pill.h },
      {
        label: opts.badge,
      },
    );
  }
  const reason = disabledReason(opts.disabled);
  tooltip(ui, square, {
    id: `${opts.id}/tip`,
    text: reason ?? opts.label,
    title: reason === null ? undefined : opts.label,
    show: opts.tooltip !== false && (state.hovered || (reason !== null && state.pressed)),
    immediate: state.pressed,
  });
  return state;
}
