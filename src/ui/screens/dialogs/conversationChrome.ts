/**
 * The conversation panel's look, drawn from the theme: the choice row's
 * `dialogChoice` skin, the custom-advance footer button, the footer hints and
 * the reward strip under the box. Layout, hit regions and input stay with
 * `Conversation`; this only paints.
 */

import type { DialogReward } from '../../../dialog/request';
import type { Rect } from '../../core/geom';
import type { HitState, Ui } from '../../core/UiRoot';
import { drawQuestIcon } from '../../QuestIcon';
import { withAlpha } from '../../theme/color';
import { skinsFor, type DialogChoiceSkin } from '../../theme/skins';
import type { Theme, TypeStyle } from '../../theme/tokens';
import {
  drawGlass,
  fillRounded,
  hoverAmount,
  paintControl,
  strokeRounded,
  type PaintTarget,
} from '../../widgets/paint';
import { measureText, measureTextHeight, text } from '../../widgets/text';
import { drawItemFrame } from './canvasChrome';

export type ChoiceTone = 'normal' | 'quest' | 'exit';

const CHOICE_BORDER_WIDTH = 1;
const SELECTED_BORDER_WIDTH = 2;
const SELECTED_GLOW_ALPHA = 0.35;
/** The selected choice's label is set heavier, so selection reads without colour. */
const SELECTED_LABEL_WEIGHT = 700;
/** Room kept clear either side of a choice label before it is shrunk to fit. */
const CHOICE_LABEL_SIDE_PAD = 10;
/** The smallest a long choice label is shrunk to; past this it may overflow its button. */
const MIN_CHOICE_LABEL_SIZE = 8;
/** The quest badge on a quest choice, as a fraction of the button's shorter side. */
const QUEST_BADGE_SIZE_RATIO = 0.4;
/** How far in from the button's top-right corner the badge's centre sits, in badge widths. */
const QUEST_BADGE_CORNER_INSET = 0.5;

/** The label style a choice is set in at `width`: the skin's, shrunk until it fits the button, but never below the floor. */
function choiceLabelStyle(
  target: PaintTarget,
  label: string,
  width: number,
  selected: boolean,
): TypeStyle {
  const skin = skinsFor(target.theme).dialogChoice;
  const base: TypeStyle = selected ? { ...skin.text, weight: SELECTED_LABEL_WEIGHT } : skin.text;
  const room = width - CHOICE_LABEL_SIDE_PAD * 2;
  const natural = measureText(target, label, { style: base });
  if (room <= 0 || natural <= room) return base;
  const size = Math.max(MIN_CHOICE_LABEL_SIZE, Math.floor(base.size * (room / natural)));
  return { ...base, size };
}

/**
 * Whether `label`, shrunk the way a choice button shrinks it and set in its
 * heavier selected weight, fits a choice button `width` wide — false when even
 * the smallest size still runs past the button's padding.
 */
export function choiceLabelFits(target: PaintTarget, label: string, width: number): boolean {
  const style = choiceLabelStyle(target, label, width, true);
  return measureText(target, label, { style }) <= width - CHOICE_LABEL_SIDE_PAD * 2;
}

function toneColor(skin: DialogChoiceSkin, tone: ChoiceTone): string {
  const byTone: Record<ChoiceTone, string> = {
    normal: skin.rest.text,
    quest: skin.questText,
    exit: skin.exitText,
  };
  return byTone[tone];
}

export interface ChoiceButtonPaint {
  /** The region id the choice registered, which keys its hover tween. */
  readonly id: string;
  readonly label: string;
  readonly tone: ChoiceTone;
  /** Wears the selected look: what Space will take. */
  readonly selected: boolean;
  /** Whether hover brightens it; off where the selected look is what follows the pointer. */
  readonly hoverable: boolean;
  readonly state: HitState;
}

/** One choice button in the `dialogChoice` skin; `tone` tints an unselected label. */
export function drawChoiceButton(ui: Ui, rect: Rect, paint: ChoiceButtonPaint): void {
  const { ctx, theme } = ui;
  const skin = skinsFor(theme).dialogChoice;
  const pressed = paint.state.pressed;
  const face = paint.selected ? skin.selected : pressed ? skin.press : skin.rest;
  const borderWidth = paint.selected ? SELECTED_BORDER_WIDTH : CHOICE_BORDER_WIDTH;
  if (paint.selected) {
    ctx.save();
    ctx.shadowColor = withAlpha(theme.palette.accent.base, SELECTED_GLOW_ALPHA);
    ctx.shadowBlur = theme.space.md;
    fillRounded(ctx, rect, skin.radius, face.fill);
    ctx.restore();
  }
  fillRounded(ctx, rect, skin.radius, face.fill);
  strokeRounded(ctx, rect, skin.radius, face.border, borderWidth);
  const brightens = paint.hoverable && !paint.selected && !pressed;
  const hover = hoverAmount(ui, paint.id, brightens && paint.state.hovered);
  if (brightens && hover > 0) {
    ctx.save();
    ctx.globalAlpha *= hover;
    fillRounded(ctx, rect, skin.radius, skin.hover.fill);
    strokeRounded(ctx, rect, skin.radius, skin.hover.border, borderWidth);
    ctx.restore();
  }
  text(ui, rect, {
    text: paint.label,
    style: choiceLabelStyle(ui, paint.label, rect.w, paint.selected),
    color: paint.selected ? skin.selected.text : toneColor(skin, paint.tone),
    align: 'center',
  });
  if (paint.tone === 'quest') {
    const badge = Math.min(rect.w, rect.h) * QUEST_BADGE_SIZE_RATIO;
    const inset = badge * QUEST_BADGE_CORNER_INSET;
    drawQuestIcon(ctx, rect.x + rect.w - inset, rect.y + inset, badge);
  }
}

/** Room either side of the custom-advance button's label. */
const FOOTER_BUTTON_LABEL_PADDING = 12;

function footerButtonLabelStyle(theme: Theme): TypeStyle {
  return skinsFor(theme).controlSize.sm.text;
}

/** The width the custom-advance button's label asks for, padding included. */
export function footerButtonNaturalWidth(target: PaintTarget, label: string): number {
  const style = footerButtonLabelStyle(target.theme);
  return measureText(target, label, { style }) + FOOTER_BUTTON_LABEL_PADDING * 2;
}

/** The gold button a line with a custom advance label shows in place of the footer hint. */
export function drawFooterButton(ui: Ui, rect: Rect, label: string, state: HitState): void {
  const skins = skinsFor(ui.theme);
  const painted = paintControl(ui, rect, skins.button.primary, state, {
    id: label,
    radius: ui.theme.radius.sm,
    disabled: false,
  });
  text(ui, painted.rect, {
    text: label,
    style: footerButtonLabelStyle(ui.theme),
    color: painted.text,
    align: 'center',
  });
}

/** A one-line footer hint ("[Space] Close", "2 / 5") along the top of `row`. */
export function drawFooterHint(
  target: PaintTarget,
  row: Rect,
  label: string,
  align: 'left' | 'right',
): void {
  text(target, row, { text: label, role: 'muted', align, valign: 'top', tabular: true });
}

/** How tall one footer hint row is. */
export function footerHintHeight(theme: Theme): number {
  return theme.type.caption.lineHeight;
}

const REWARD_ICON_SIZE = 36;
const REWARD_HEADING_TEXT = 'Reward';

function rewardTextWidth(theme: Theme, stripWidth: number): number {
  return stripWidth - theme.space.md * 2 - REWARD_ICON_SIZE - theme.space.md;
}

function rewardLinesText(reward: DialogReward): string {
  return reward.lines.join('\n');
}

/**
 * How much of the reward the strip spells out: everything, or (when the
 * screen has no room for that beside the box) just the item and its XP on
 * one row.
 */
export type RewardStripSize = 'full' | 'compact';

const COMPACT_ICON_SIZE = 24;

/** Height of the reward strip for `reward` at `width`. */
export function rewardStripHeight(
  target: PaintTarget,
  reward: DialogReward,
  width: number,
  size: RewardStripSize,
): number {
  const { type, space } = target.theme;
  if (size === 'compact') return space.sm * 2 + COMPACT_ICON_SIZE;
  const linesHeight = measureTextHeight(target, rewardTextWidth(target.theme, width), {
    text: rewardLinesText(reward),
    role: 'caption',
  });
  const textHeight =
    type.overline.lineHeight +
    space.xxs +
    type.label.lineHeight +
    linesHeight +
    (reward.xp > 0 ? type.label.lineHeight : 0);
  return space.md * 2 + Math.max(REWARD_ICON_SIZE, textHeight);
}

function drawCompactRewardStrip(target: PaintTarget, reward: DialogReward, strip: Rect): void {
  const { theme } = target;
  const { space, palette, type } = theme;
  const icon: Rect = {
    x: strip.x + space.sm,
    y: strip.y + (strip.h - COMPACT_ICON_SIZE) / 2,
    w: COMPACT_ICON_SIZE,
    h: COMPACT_ICON_SIZE,
  };
  drawItemFrame(target, icon, reward.itemId);
  const row: Rect = {
    x: icon.x + icon.w + space.sm,
    y: strip.y,
    w: strip.x + strip.w - space.md - (icon.x + icon.w + space.sm),
    h: strip.h,
  };
  const xpLabel = reward.xp > 0 ? `+${reward.xp} XP` : null;
  const xpWidth = xpLabel === null ? 0 : measureText(target, xpLabel, { style: type.label });
  text(
    target,
    { ...row, w: Math.max(0, row.w - xpWidth - space.sm) },
    {
      text: `Reward: ${reward.displayName}`,
      role: 'accent',
    },
  );
  if (xpLabel !== null) {
    text(target, row, {
      text: xpLabel,
      style: type.label,
      color: palette.state.success,
      align: 'right',
      tabular: true,
    });
  }
}

/** The strip under the box naming what finishing this conversation pays out. */
export function drawRewardStrip(
  target: PaintTarget,
  reward: DialogReward,
  strip: Rect,
  size: RewardStripSize,
): void {
  const { theme } = target;
  const { type, space, palette } = theme;
  drawGlass(target, strip, skinsFor(theme).panel.raised);
  if (size === 'compact') {
    drawCompactRewardStrip(target, reward, strip);
    return;
  }

  const innerX = strip.x + space.md;
  const innerY = strip.y + space.md;
  drawItemFrame(
    target,
    { x: innerX, y: innerY, w: REWARD_ICON_SIZE, h: REWARD_ICON_SIZE },
    reward.itemId,
  );

  const textX = innerX + REWARD_ICON_SIZE + space.md;
  const textWidth = rewardTextWidth(theme, strip.w);
  let cursorY = innerY;
  text(
    target,
    { x: textX, y: cursorY, w: textWidth, h: type.overline.lineHeight },
    { text: REWARD_HEADING_TEXT, role: 'overline' },
  );
  cursorY += type.overline.lineHeight + space.xxs;
  text(
    target,
    { x: textX, y: cursorY, w: textWidth, h: type.label.lineHeight },
    { text: reward.displayName, role: 'accent' },
  );
  cursorY += type.label.lineHeight;
  const lines = text(
    target,
    { x: textX, y: cursorY, w: textWidth, h: 0 },
    { text: rewardLinesText(reward), role: 'caption', wrap: true },
  );
  cursorY += lines.height;
  if (reward.xp > 0) {
    text(
      target,
      { x: textX, y: cursorY, w: textWidth, h: type.label.lineHeight },
      { text: `+${reward.xp} XP`, style: type.label, color: palette.state.success, tabular: true },
    );
  }
}
