/**
 * The selected item, in full: a big icon, its name, category and equip slot,
 * the description, its effect lines, what wearing it would change, and the
 * actions it offers. Shared by the side pane and the phone's bottom sheet.
 */

import type { InventoryItem } from '../../../core/ItemDefs';
import { ITEM_DEF } from '../../../core/ItemDefs';
import { inset, splitH, type Rect } from '../../core/geom';
import type { Ui } from '../../core/UiRoot';
import type { ButtonVariant } from '../../theme/skins';
import type { GlyphId } from '../../theme/glyphs';
import { badge, badgeSize } from '../../widgets/badge';
import { button } from '../../widgets/button';
import { itemSlot } from '../../widgets/itemSlot';
import { scrollGutterWidth, scrollView } from '../../widgets/scrollView';
import { lineHeightOf, measureTextHeight, text } from '../../widgets/text';
import { FILTER_LABELS } from './bagView';
import { STAT_ABBREVIATIONS, type StatDelta } from './gearRules';

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
  readonly slotLabel: string | null;
  readonly effectLines: readonly string[];
  readonly deltas: readonly StatDelta[];
  /** Why the last attempt on this item was refused, shown until it fades. */
  readonly notice: string | null;
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
  return `${arrow} ${sign}${Math.abs(delta.delta)} ${STAT_ABBREVIATIONS[delta.stat]}`;
}

interface DetailLayout {
  readonly headerH: number;
  readonly nameH: number;
  readonly descriptionH: number;
  readonly effectHeights: readonly number[];
  readonly deltaH: number;
  readonly noticeH: number;
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
      : measureTextHeight(ui, width, { text: description, role: 'body' });
  const effectHeights = model.effectLines.map((line) =>
    measureTextHeight(ui, width, { text: line, role: 'label' }),
  );
  const deltaH = model.deltas.length === 0 ? 0 : lineHeightOf(ui, 'label');
  const noticeH =
    model.notice === null
      ? 0
      : measureTextHeight(ui, width, { text: model.notice, role: 'danger' });
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
    descriptionH,
    ...effectHeights,
    deltaH,
    noticeH,
    rowsHeight(actionRows, controlH, space.sm),
    rowsHeight(pickerRows, controlH, space.xs),
  ].filter((h) => h > 0);
  const total = blocks.reduce((sum, h) => sum + h, 0) + space.md * Math.max(0, blocks.length - 1);
  return {
    headerH,
    nameH,
    descriptionH,
    effectHeights,
    deltaH,
    noticeH,
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

/** Draws the pane's content into `rect`, scrolling when it is taller. */
export function detailPane(ui: Ui, rect: Rect, id: string, model: DetailModel): void {
  const naturalW = rect.w;
  const natural = layoutDetail(ui, naturalW, model);
  if (natural.total <= rect.h) {
    drawDetail(ui, rect, id, model, natural);
    return;
  }
  scrollView(ui, rect, {
    id: `${id}/scroll`,
    contentHeight: layoutDetail(ui, rect.w - scrollGutterWidth(ui), model).total,
    draw: (content) => drawDetail(ui, content, id, model, layoutDetail(ui, content.w, model)),
  });
}

function drawDetail(
  ui: Ui,
  rect: Rect,
  id: string,
  model: DetailModel,
  layout: DetailLayout,
): void {
  const { space, palette, size } = ui.theme;
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
  const tagLabel = FILTER_LABELS[category];
  const tag = badgeSize(ui, { label: tagLabel, kind: 'tag' });
  badge(
    ui,
    { x: textX, y: tagY, w: tag.w, h: tag.h },
    {
      label: tagLabel,
      kind: 'tag',
      color: palette.category[category],
    },
  );
  if (model.worn) {
    const worn = badgeSize(ui, { label: 'Worn', kind: 'tag' });
    badge(
      ui,
      { x: textX + tag.w + space.xs, y: tagY, w: worn.w, h: worn.h },
      {
        label: 'Worn',
        kind: 'tag',
        tone: 'accent',
      },
    );
  }
  if (model.slotLabel !== null) {
    text(
      ui,
      { x: textX, y: tagY + tag.h, w: textW, h: lineHeightOf(ui, 'caption') },
      {
        text: model.slotLabel,
        role: 'caption',
      },
    );
  }
  y += layout.headerH + space.md;

  const description = item.description ?? '';
  if (layout.descriptionH > 0) {
    text(
      ui,
      { x: rect.x, y, w: rect.w, h: layout.descriptionH },
      {
        text: description,
        role: 'secondary',
        wrap: true,
      },
    );
    y += layout.descriptionH + space.md;
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
