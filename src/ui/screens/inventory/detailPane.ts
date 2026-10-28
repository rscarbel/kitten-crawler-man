/**
 * The selected item, in full: a big icon, its name, category and equip slot;
 * its rarity as a tag beside its category; then who can wear it, its effect lines, its set's pips and its
 * awakening's progress; then what wearing it would change, its flavour text in
 * italics, and the actions it offers. Shared by the side pane and the phone's
 * bottom sheet.
 */

import type { InventoryItem, Wearer } from '../../../core/items/defs/ItemDefs';
import type { Rarity } from '../../../core/items/defs/rarity';
import type { SetProgress } from '../../../gear/setProgress';
import { rarityColor } from '../dialogs/canvasChrome';
import { drawGlyph } from '../../theme/glyphs';
import { fillRounded, strokeRounded } from '../../widgets/paint';
import { ITEM_DEF } from '../../../core/items/defs/ItemDefs';
import { inset, splitH, splitV, type Rect } from '../../core/geom';
import type { Ui } from '../../core/UiRoot';
import type { ButtonVariant } from '../../theme/skins';
import type { GlyphId } from '../../theme/glyphs';
import { badge, badgeSize } from '../../widgets/badge';
import { button } from '../../widgets/button';
import { itemSlot } from '../../widgets/itemSlot';
import { meter } from '../../widgets/meter';
import { scrollGutterWidth, scrollView } from '../../widgets/scrollView';
import {
  lineHeightOf,
  measureRichTextHeight,
  measureText,
  measureTextHeight,
  richText,
  text,
} from '../../widgets/text';
import { FILTER_LABELS } from './bagView';
import type { StatDelta } from './gearRules';
import { STAT_DEFS } from '../../../core/party/stats';

export interface DetailAction {
  readonly id: string;
  readonly label: string;
  readonly icon?: GlyphId;
  readonly variant?: ButtonVariant;
  readonly disabled?: boolean | string;
  readonly onTap: () => void;
}

export interface HotbarPickerSlot {
  readonly index: number;
  readonly label: string;
  /** The item already sits in this slot. */
  readonly current: boolean;
  readonly disabled?: boolean | string;
}

export interface DetailModel {
  readonly item: InventoryItem;
  readonly worn: boolean;
  /** The item has awakened for its owner: the big icon shows its awakened look. */
  readonly awakened: boolean;
  readonly slotLabel: string | null;
  /** The piece's rarity; null for an item that has none. */
  readonly rarity: Rarity | null;
  /** Who can wear it; null for an item nobody wears. */
  readonly wearer: Wearer | null;
  readonly effectLines: readonly string[];
  /** Where its owner stands on the piece's set, or null when it belongs to none. */
  readonly set: SetProgress | null;
  /** Kills toward the piece's awakening, or null when it has none still to earn. */
  readonly awakening: { readonly kills: number; readonly target: number } | null;
  readonly deltas: readonly StatDelta[];
  /** Why the last attempt on this item was refused, shown until it fades. */
  readonly notice: string | null;
  /** Standing advice on how the item is used, for items whose use isn't a button here. */
  readonly hint: string | null;
  readonly actions: readonly DetailAction[];
  /** The hotbar's slot buttons, when the player opened them. */
  readonly hotbarPicker: readonly HotbarPickerSlot[] | null;
  readonly onAssignHotbar: (index: number) => void;
}

/** The big icon is this many slot sizes across. */
const ICON_SCALE = 1.25;
/** The narrowest an action button gets before the row wraps to fewer per line. */
const MIN_ACTION_WIDTH = 96;
const MAX_NAME_LINES = 2;
const BONUS_PREFIX = '+';
const UP_ARROW = '▲';
const DOWN_ARROW = '▼';
const MINUS_SIGN = '−';
const PIP_SIZE = 8;
const AWAKENING_METER_H = 6;
const PIP_BORDER_WIDTH = 1;

const WEARER_LABELS: Readonly<Record<Wearer, string>> = {
  human: 'Human',
  cat: 'Cat',
  both: 'Either crawler',
};

function iconSide(ui: Ui): number {
  return Math.round(ui.theme.size.slot * ICON_SCALE);
}

function actionColumns(width: number, gap: number, count: number): number {
  const fit = Math.max(1, Math.floor((width + gap) / (MIN_ACTION_WIDTH + gap)));
  return Math.max(1, Math.min(count, fit));
}

function rowsHeight(rows: number, rowH: number, gap: number): number {
  return rows <= 0 ? 0 : rows * rowH + (rows - 1) * gap;
}

function deltaText(delta: StatDelta): string {
  const arrow = delta.delta > 0 ? UP_ARROW : DOWN_ARROW;
  const sign = delta.delta > 0 ? '+' : MINUS_SIGN;
  return `${arrow} ${sign}${Math.abs(delta.delta)} ${STAT_DEFS[delta.stat].code}`;
}

/** Which of the pane's parts a draw covers: everything, the scrolling text, or the pinned buttons. */
type DetailPart = 'all' | 'info' | 'actions';

/** Pinned buttons may take at most this share of a short pane; past it, everything scrolls. */
const MAX_PINNED_ACTIONS_FRACTION = 0.5;

interface DetailLayout {
  readonly headerH: number;
  readonly nameH: number;
  readonly metaH: number;
  readonly descriptionH: number;
  readonly effectHeights: readonly number[];
  readonly setH: number;
  readonly awakeningH: number;
  readonly deltaH: number;
  readonly noticeH: number;
  readonly hintH: number;
  readonly actionRows: number;
  readonly actionColumns: number;
  readonly pickerRows: number;
  readonly pickerColumns: number;
  readonly total: number;
}

function layoutDetail(ui: Ui, width: number, model: DetailModel): DetailLayout {
  const { space, size } = ui.theme;
  const icon = iconSide(ui);
  const textW = Math.max(0, width - icon - space.md);
  const nameH = measureTextHeight(ui, textW, {
    text: model.item.name,
    role: 'title',
    maxLines: MAX_NAME_LINES,
  });
  const tagH = badgeSize(ui, { label: 'tag', kind: 'tag' }).h;
  const slotLineH = model.slotLabel === null ? 0 : lineHeightOf(ui, 'caption');
  const headerH = Math.max(icon, nameH + space.xs + tagH + slotLineH);
  const description = model.item.description ?? '';
  const descriptionH =
    description.length === 0
      ? 0
      : measureRichTextHeight(ui, width, {
          spans: [{ text: description, italic: true }],
          role: 'secondary',
        });
  const metaLines = model.wearer === null ? 0 : 1;
  const metaH = metaLines * lineHeightOf(ui, 'label');
  const setH = model.set === null ? 0 : lineHeightOf(ui, 'label') + PIP_SIZE + space.xs;
  const awakeningH =
    model.awakening === null ? 0 : lineHeightOf(ui, 'caption') + AWAKENING_METER_H + space.xs;
  const effectHeights = model.effectLines.map((line) =>
    measureTextHeight(ui, width, { text: line, role: 'label' }),
  );
  const deltaH = model.deltas.length === 0 ? 0 : lineHeightOf(ui, 'label');
  const noticeH =
    model.notice === null
      ? 0
      : measureTextHeight(ui, width, { text: model.notice, role: 'danger' });
  const hintH =
    model.hint === null ? 0 : measureTextHeight(ui, width, { text: model.hint, role: 'muted' });
  const controlH = size.control;
  const columns = actionColumns(width, space.sm, model.actions.length);
  const actionRows = Math.ceil(model.actions.length / columns);
  const picker = model.hotbarPicker ?? [];
  const pickerColumns = Math.max(
    1,
    Math.min(picker.length, Math.floor((width + space.xs) / (controlH + space.xs))),
  );
  const pickerRows = picker.length === 0 ? 0 : Math.ceil(picker.length / pickerColumns);
  const blocks = [
    headerH,
    metaH,
    ...effectHeights,
    setH,
    awakeningH,
    deltaH,
    descriptionH,
    noticeH,
    hintH,
    rowsHeight(actionRows, controlH, space.sm),
    rowsHeight(pickerRows, controlH, space.xs),
  ].filter((h) => h > 0);
  const total = blocks.reduce((sum, h) => sum + h, 0) + space.md * Math.max(0, blocks.length - 1);
  return {
    headerH,
    nameH,
    metaH,
    descriptionH,
    effectHeights,
    setH,
    awakeningH,
    deltaH,
    noticeH,
    hintH,
    actionRows,
    actionColumns: columns,
    pickerRows,
    pickerColumns,
    total,
  };
}

/** The height the pane's content needs at `width`. */
export function measureDetail(ui: Ui, width: number, model: DetailModel): number {
  return layoutDetail(ui, width, model).total;
}

/** The action buttons and hotbar picker stacked, as the pane draws them below the item's text. */
function actionsBlockHeight(ui: Ui, layout: DetailLayout): number {
  const { space, size } = ui.theme;
  const actionsH = rowsHeight(layout.actionRows, size.control, space.sm);
  const pickerH = rowsHeight(layout.pickerRows, size.control, space.xs);
  if (actionsH > 0 && pickerH > 0) return actionsH + space.md + pickerH;
  return actionsH + pickerH;
}

/**
 * Draws the pane's content into `rect`, scrolling when it is taller. A short
 * pane keeps the action buttons pinned under the scrolling text, so what the
 * item can do is never below the fold.
 */
export function detailPane(ui: Ui, rect: Rect, id: string, model: DetailModel): void {
  const { space } = ui.theme;
  const natural = layoutDetail(ui, rect.w, model);
  if (natural.total <= rect.h) {
    drawDetail(ui, rect, id, model, natural, 'all');
    return;
  }
  const pinnedH = actionsBlockHeight(ui, natural);
  const canPin = pinnedH > 0 && pinnedH <= rect.h * MAX_PINNED_ACTIONS_FRACTION;
  if (!canPin) {
    scrollView(ui, rect, {
      id: `${id}/scroll`,
      contentHeight: layoutDetail(ui, rect.w - scrollGutterWidth(ui), model).total,
      draw: (content) =>
        drawDetail(ui, content, id, model, layoutDetail(ui, content.w, model), 'all'),
    });
    return;
  }
  const [infoRect, actionsRect] = splitV(rect, ['fill', pinnedH], space.md);
  const scrolled = layoutDetail(ui, infoRect.w - scrollGutterWidth(ui), model);
  scrollView(ui, infoRect, {
    id: `${id}/scroll`,
    contentHeight: scrolled.total - actionsBlockHeight(ui, scrolled) - space.md,
    draw: (content) =>
      drawDetail(ui, content, id, model, layoutDetail(ui, content.w, model), 'info'),
  });
  drawDetail(ui, actionsRect, id, model, natural, 'actions');
}

function drawDetail(
  ui: Ui,
  rect: Rect,
  id: string,
  model: DetailModel,
  layout: DetailLayout,
  part: DetailPart,
): void {
  if (part !== 'actions') drawInfo(ui, rect, id, model, layout);
  const actionsTop = part === 'actions' ? rect.y : rect.y + infoHeight(ui, layout);
  if (part !== 'info') drawActions(ui, { ...rect, y: actionsTop }, id, model, layout);
}

/** The item's icon, name, text and stat lines, with the gap that follows them. */
function infoHeight(ui: Ui, layout: DetailLayout): number {
  return layout.total - actionsBlockHeight(ui, layout);
}

function drawInfo(ui: Ui, rect: Rect, id: string, model: DetailModel, layout: DetailLayout): void {
  const { space, palette } = ui.theme;
  const item = model.item;
  const category = ITEM_DEF[item.id].category;
  const icon = iconSide(ui);
  let y = rect.y;

  itemSlot(
    ui,
    { x: rect.x, y, w: icon, h: icon },
    {
      id: `${id}/icon`,
      item: item.id,
      quantity: item.quantity,
      equipped: model.worn,
      awakened: model.awakened,
    },
  );
  const textX = rect.x + icon + space.md;
  const textW = Math.max(0, rect.w - icon - space.md);
  text(
    ui,
    { x: textX, y, w: textW, h: layout.nameH },
    {
      text: item.name,
      role: 'title',
      wrap: true,
      maxLines: MAX_NAME_LINES,
    },
  );
  const tagY = y + layout.nameH + space.xs;
  const tags: { label: string; color?: string; tone?: 'accent' }[] = [];
  if (model.rarity !== null) {
    tags.push({ label: model.rarity, color: rarityColor(ui.theme, model.rarity) });
  }
  tags.push({ label: FILTER_LABELS[category], color: palette.category[category] });
  if (model.worn) tags.push({ label: 'Worn', tone: 'accent' });
  const tagH = badgeSize(ui, { label: FILTER_LABELS[category], kind: 'tag' }).h;
  // The rarity comes first and always shows; a narrow pane drops the tags after it that do not fit.
  let tagX = textX;
  tags.forEach((entry, index) => {
    const size = badgeSize(ui, { label: entry.label, kind: 'tag' });
    if (index > 0 && tagX + size.w > textX + textW) return;
    badge(
      ui,
      { x: tagX, y: tagY, w: size.w, h: size.h },
      { label: entry.label, kind: 'tag', color: entry.color, tone: entry.tone },
    );
    tagX += size.w + space.xs;
  });
  if (model.slotLabel !== null) {
    text(
      ui,
      { x: textX, y: tagY + tagH, w: textW, h: lineHeightOf(ui, 'caption') },
      {
        text: model.slotLabel,
        role: 'caption',
      },
    );
  }
  y += layout.headerH + space.md;

  if (layout.metaH > 0) {
    y = drawMeta(ui, rect, y, model);
    y += space.md;
  }
  model.effectLines.forEach((line, index) => {
    const h = layout.effectHeights[index] ?? 0;
    text(
      ui,
      { x: rect.x, y, w: rect.w, h },
      {
        text: line,
        role: 'label',
        color: line.startsWith(BONUS_PREFIX) ? palette.state.success : palette.text.secondary,
        wrap: true,
      },
    );
    y += h + space.md;
  });

  if (model.set !== null) {
    drawSetPips(ui, { x: rect.x, y, w: rect.w, h: layout.setH }, model.set);
    y += layout.setH + space.md;
  }

  if (model.awakening !== null) {
    drawAwakening(ui, { x: rect.x, y, w: rect.w, h: layout.awakeningH }, id, model.awakening);
    y += layout.awakeningH + space.md;
  }

  if (layout.deltaH > 0) {
    const cells = splitH(
      { x: rect.x, y, w: rect.w, h: layout.deltaH },
      model.deltas.map((): 'fill' => 'fill'),
      space.sm,
    );
    model.deltas.forEach((delta, index) => {
      text(ui, cells[index], {
        text: deltaText(delta),
        role: 'label',
        color: delta.delta > 0 ? palette.state.success : palette.state.danger,
        tabular: true,
      });
    });
    y += layout.deltaH + space.md;
  }

  const description = item.description ?? '';
  if (layout.descriptionH > 0) {
    richText(
      ui,
      { x: rect.x, y, w: rect.w, h: layout.descriptionH },
      { spans: [{ text: description, italic: true }], role: 'secondary' },
    );
    y += layout.descriptionH + space.md;
  }

  if (model.notice !== null) {
    text(
      ui,
      { x: rect.x, y, w: rect.w, h: layout.noticeH },
      {
        text: model.notice,
        role: 'danger',
        wrap: true,
      },
    );
    y += layout.noticeH + space.md;
  }

  if (model.hint !== null) {
    text(
      ui,
      { x: rect.x, y, w: rect.w, h: layout.hintH },
      {
        text: model.hint,
        role: 'muted',
        wrap: true,
      },
    );
    y += layout.hintH + space.md;
  }
}

/** Who can wear the piece; returns the y below the line. */
function drawMeta(ui: Ui, rect: Rect, top: number, model: DetailModel): number {
  const { palette, space, size } = ui.theme;
  const lineH = lineHeightOf(ui, 'label');
  let y = top;
  if (model.wearer !== null) {
    const label = WEARER_LABELS[model.wearer];
    text(ui, { x: rect.x, y, w: rect.w, h: lineH }, { text: label, role: 'caption' });
    if (model.wearer === 'both') {
      const labelW = measureText(ui, label, { role: 'caption' });
      const glyph = Math.min(size.icon, lineH);
      drawGlyph(
        ui.ctx,
        'swap',
        { x: rect.x + labelW + space.xs, y: y + (lineH - glyph) / 2, w: glyph, h: glyph },
        { color: palette.text.secondary },
      );
    }
    y += lineH;
  }
  return y;
}

/** The set's name and one pip per piece, filled for the ones worn. */
function drawSetPips(ui: Ui, rect: Rect, set: SetProgress): void {
  const { palette, space, radius } = ui.theme;
  const lineH = lineHeightOf(ui, 'label');
  text(
    ui,
    { x: rect.x, y: rect.y, w: rect.w, h: lineH },
    {
      text: `${set.name} · ${set.worn}/${set.completeAt}`,
      role: 'label',
      color: set.complete ? palette.state.success : palette.text.secondary,
      tabular: true,
    },
  );
  const pipY = rect.y + lineH + space.xs;
  set.pips.forEach((pip, index) => {
    const pipRect = {
      x: rect.x + index * (PIP_SIZE + space.xs),
      y: pipY,
      w: PIP_SIZE,
      h: PIP_SIZE,
    };
    if (pip.worn) fillRounded(ui.ctx, pipRect, radius.pill, palette.accent.base);
    else strokeRounded(ui.ctx, pipRect, radius.pill, palette.border.strong, PIP_BORDER_WIDTH);
  });
}

/** Kills toward the piece's awakening, on a meter. */
function drawAwakening(
  ui: Ui,
  rect: Rect,
  id: string,
  awakening: { readonly kills: number; readonly target: number },
): void {
  const { space } = ui.theme;
  const lineH = lineHeightOf(ui, 'caption');
  text(
    ui,
    { x: rect.x, y: rect.y, w: rect.w, h: lineH },
    {
      text: `Awakens after ${awakening.target} kills · ${awakening.kills}/${awakening.target}`,
      role: 'caption',
      tabular: true,
    },
  );
  meter(
    ui,
    { x: rect.x, y: rect.y + lineH + space.xs, w: rect.w, h: AWAKENING_METER_H },
    {
      id: `${id}/awakening`,
      value: awakening.kills,
      max: awakening.target,
      ghost: false,
    },
  );
}

function drawActions(
  ui: Ui,
  rect: Rect,
  id: string,
  model: DetailModel,
  layout: DetailLayout,
): void {
  const { space, size } = ui.theme;
  let y = rect.y;
  if (layout.actionRows > 0) {
    const columns = layout.actionColumns;
    const cellW = (rect.w - space.sm * (columns - 1)) / columns;
    model.actions.forEach((action, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      button(
        ui,
        {
          x: rect.x + column * (cellW + space.sm),
          y: y + row * (size.control + space.sm),
          w: cellW,
          h: size.control,
        },
        {
          id: `${id}/action-${action.id}`,
          label: action.label,
          icon: action.icon,
          variant: action.variant,
          disabled: action.disabled,
          onTap: action.onTap,
        },
      );
    });
    y += rowsHeight(layout.actionRows, size.control, space.sm) + space.md;
  }

  const picker = model.hotbarPicker;
  if (picker !== null && layout.pickerRows > 0) {
    const columns = layout.pickerColumns;
    const side = Math.min(size.control, (rect.w - space.xs * (columns - 1)) / columns);
    picker.forEach((slot, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      button(
        ui,
        {
          x: rect.x + column * (side + space.xs),
          y: y + row * (size.control + space.xs),
          w: side,
          h: size.control,
        },
        {
          id: `${id}/hotbar-${slot.index}`,
          label: slot.label,
          selected: slot.current,
          disabled: slot.disabled,
          onTap: () => model.onAssignHotbar(slot.index),
        },
      );
    });
  }
}

/** The pane with nothing selected. */
export function emptyDetail(ui: Ui, rect: Rect, message: string): void {
  text(ui, inset(rect, ui.theme.space.md), {
    text: message,
    role: 'muted',
    align: 'center',
    wrap: true,
    valign: 'middle',
  });
}
