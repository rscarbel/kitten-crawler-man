/**
 * A raised tile that groups content: a VIP service, a quest summary, a stat
 * block. Optionally tappable and selectable; returns the rect its content
 * goes in.
 */

import type { SoundId } from '../../audio/sounds';
import { inset, type Rect } from '../core/geom';
import type { HitState, Ui } from '../core/UiRoot';
import { withAlpha } from '../theme/color';
import { skinsFor, type PanelKind } from '../theme/skins';
import {
  disabledReason,
  drawFocusRing,
  fillRounded,
  hoverAmount,
  isDisabled,
  strokeRounded,
} from './paint';
import { lineHeightOf, text } from './text';
import { tooltip } from './tooltip';

export interface CardOptions {
  readonly id: string;
  readonly kind?: PanelKind;
  /** Small spaced capitals above the title. */
  readonly overline?: string;
  readonly title?: string;
  /** A token colour for the overline (a category, a tone). */
  readonly accent?: string;
  readonly selected?: boolean;
  readonly disabled?: boolean | string;
  readonly onTap?: () => void;
  /** Played when a tap fires; defaults to the menu click. */
  readonly sound?: SoundId | null;
  /**
   * Draws the card's content into its body, inside the card's disabled
   * dimming. Content drawn into the returned `body` instead is not dimmed.
   */
  readonly content?: (body: Rect) => void;
}

export interface CardResult {
  /** Where content goes, below the title. */
  readonly body: Rect;
  readonly state: HitState;
}

const HOVER_BORDER_SWITCH = 0.5;
const HOVER_LIFT = 0.04;
const BORDER_WIDTH = 1;
const SELECTED_BORDER_WIDTH = 1.5;
const DISABLED_ALPHA = 0.55;

const NO_STATE: HitState = { hovered: false, pressed: false, focused: false };

export function card(ui: Ui, rect: Rect, opts: CardOptions): CardResult {
  const { theme, ctx } = ui;
  const { palette, space } = theme;
  const skin = skinsFor(theme).panel[opts.kind ?? 'raised'];
  const disabled = isDisabled(opts.disabled);
  const onTap = opts.onTap;
  const tappable = onTap !== undefined || disabled;
  const state = tappable
    ? ui.hit(opts.id, rect, {
        onTap: onTap === undefined ? undefined : () => onTap(),
        disabled,
        sound: opts.sound,
      })
    : NO_STATE;
  const hover = hoverAmount(ui, opts.id, state.hovered && !disabled && onTap !== undefined);
  const drawn: Rect =
    state.pressed && !disabled ? { ...rect, y: rect.y + skinsFor(theme).pressDrop } : rect;
  const selected = opts.selected === true;

  ctx.save();
  if (disabled) ctx.globalAlpha *= DISABLED_ALPHA;
  fillRounded(ctx, drawn, skin.radius, skin.fill);
  if (selected) fillRounded(ctx, drawn, skin.radius, palette.accent.soft);
  if (hover > 0) {
    ctx.save();
    ctx.globalAlpha *= hover;
    fillRounded(ctx, drawn, skin.radius, withAlpha(palette.text.primary, HOVER_LIFT));
    ctx.restore();
  }
  strokeRounded(
    ctx,
    drawn,
    skin.radius,
    selected
      ? palette.accent.base
      : hover > HOVER_BORDER_SWITCH
        ? palette.border.strong
        : skin.border,
    selected ? SELECTED_BORDER_WIDTH : BORDER_WIDTH,
  );

  // Titles ride the press drop with the chrome; the body stays put so the
  // content's own hit regions do not move under the finger.
  const drop = drawn.y - rect.y;
  let body = inset(rect, skin.padding);
  if (opts.overline !== undefined) {
    const h = lineHeightOf(ui, 'overline');
    text(
      ui,
      { ...body, y: body.y + drop, h },
      { text: opts.overline, role: 'overline', color: opts.accent },
    );
    body = inset(body, { t: h + space.xxs });
  }
  if (opts.title !== undefined) {
    const h = lineHeightOf(ui, 'title');
    text(ui, { ...body, y: body.y + drop, h }, { text: opts.title, role: 'title' });
    body = inset(body, { t: h + space.sm });
  }
  opts.content?.(body);
  ctx.restore();

  if (state.focused) drawFocusRing(ui, drawn, skin.radius);
  const reason = disabledReason(opts.disabled);
  if (reason !== null) {
    tooltip(ui, rect, {
      id: `${opts.id}/reason`,
      text: reason,
      show: state.hovered || state.pressed,
      immediate: state.pressed,
    });
  }
  return { body, state };
}
