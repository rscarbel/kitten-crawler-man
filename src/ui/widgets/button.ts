/**
 * The text button: one call draws it in its current state and registers its
 * hit region. A disabled button registers a region that only swallows input
 * and plays the error cue; given a reason, it shows that reason as a tooltip.
 */

import type { SoundId } from '../../audio/sounds';
import { inset, type Rect } from '../core/geom';
import type { HitState, Ui } from '../core/UiRoot';
import { drawGlyph, type GlyphId } from '../theme/glyphs';
import { skinsFor, type ButtonVariant, type ControlSize } from '../theme/skins';
import { disabledReason, isDisabled, paintControl } from './paint';
import { measureText, text } from './text';
import { tooltip } from './tooltip';

export interface ButtonOptions {
  /** Unique within the surface. Defaults to the label. */
  readonly id?: string;
  readonly label: string;
  readonly variant?: ButtonVariant;
  readonly size?: ControlSize;
  readonly icon?: GlyphId;
  /** Draw as toggled on (a chosen option), whatever the variant. */
  readonly selected?: boolean;
  /** `true`, or the reason it can't be used, shown as a tooltip. */
  readonly disabled?: boolean | string;
  /** Enter activates it when nothing else is focused. */
  readonly primary?: boolean;
  /** Played when it fires; defaults to the menu click. */
  readonly sound?: SoundId | null;
  readonly onTap: () => void;
}

/** The natural width of a button: label, icon and padding, never below the size's minimum. */
export function measureButton(
  ui: Ui,
  opts: Pick<ButtonOptions, 'label' | 'size' | 'icon'>,
): number {
  const sizeSkin = skinsFor(ui.theme).controlSize[opts.size ?? 'md'];
  const labelW = measureText(ui, opts.label, { style: sizeSkin.text });
  const iconW =
    opts.icon === undefined ? 0 : sizeSkin.icon + (opts.label === '' ? 0 : sizeSkin.gap);
  return Math.max(sizeSkin.minWidth, Math.ceil(labelW + iconW + sizeSkin.padX * 2));
}

/** The height a button of `size` is drawn at. */
export function buttonHeight(ui: Ui, size: ControlSize = 'md'): number {
  return skinsFor(ui.theme).controlSize[size].height;
}

export function button(ui: Ui, rect: Rect, opts: ButtonOptions): HitState {
  const id = opts.id ?? opts.label;
  const skins = skinsFor(ui.theme);
  const sizeSkin = skins.controlSize[opts.size ?? 'md'];
  const disabled = isDisabled(opts.disabled);
  const state = ui.hit(id, rect, {
    onTap: () => opts.onTap(),
    disabled,
    primary: opts.primary,
    sound: opts.sound,
  });
  const skin = opts.selected === true ? skins.selected : skins.button[opts.variant ?? 'secondary'];
  const painted = paintControl(ui, rect, skin, state, { id, radius: sizeSkin.radius, disabled });
  const content = inset(painted.rect, { l: sizeSkin.padX, r: sizeSkin.padX });
  const labelW = Math.min(content.w, measureText(ui, opts.label, { style: sizeSkin.text }));
  const hasIcon = opts.icon !== undefined;
  const iconBlock = hasIcon ? sizeSkin.icon + (opts.label === '' ? 0 : sizeSkin.gap) : 0;
  const groupW = Math.min(content.w, labelW + iconBlock);
  const left = content.x + (content.w - groupW) / 2;
  if (opts.icon !== undefined) {
    const iconRect: Rect = {
      x: left,
      y: painted.rect.y + (painted.rect.h - sizeSkin.icon) / 2,
      w: sizeSkin.icon,
      h: sizeSkin.icon,
    };
    drawGlyph(ui.ctx, opts.icon, iconRect, { color: painted.text });
  }
  if (opts.label !== '') {
    text(
      ui,
      { x: left + iconBlock, y: painted.rect.y, w: groupW - iconBlock, h: painted.rect.h },
      {
        text: opts.label,
        style: sizeSkin.text,
        color: painted.text,
      },
    );
  }
  const reason = disabledReason(opts.disabled);
  if (reason !== null) {
    tooltip(ui, rect, {
      id: `${id}/reason`,
      text: reason,
      show: state.hovered || state.pressed,
      immediate: state.pressed,
    });
  }
  return state;
}
