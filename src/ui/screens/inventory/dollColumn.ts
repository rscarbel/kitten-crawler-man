/**
 * The Character tab's left column: the paper doll, head to foot, then the
 * crawler's stats and what their worn gear adds up to.
 */

import type { InventoryItem } from '../../../core/ItemDefs';
import { ALL_STATS } from '../../../Player';
import { intersect, splitH, type Rect } from '../../core/geom';
import type { DragHandlers, HitHandlers, HitState, Ui } from '../../core/UiRoot';
import { itemSlot } from '../../widgets/itemSlot';
import { scrollGutterWidth, scrollView } from '../../widgets/scrollView';
import { lineHeightOf, measureTextHeight, tabularNumber, text } from '../../widgets/text';
import { tooltip } from '../../widgets/tooltip';
import {
  DOLL_MAX_SECTION_CELLS,
  DOLL_SECTIONS,
  STAT_LABELS,
  shortSubSlotLabel,
  wornGearSummary,
  type DollSlot,
} from './gearRules';
import type { InventoryOwner } from './inventoryTypes';

export interface DollCellInput {
  readonly item: InventoryItem | null;
  readonly selected: boolean;
  readonly dragging: boolean;
  readonly dropTarget: boolean;
  readonly disabled: boolean;
}

export interface DollColumnOptions {
  readonly id: string;
  readonly owner: InventoryOwner;
  readonly cell: (slot: DollSlot, rect: Rect) => DollCellInput;
  readonly onTap: (slot: DollSlot) => void;
  readonly onDrag: (slot: DollSlot) => DragHandlers | undefined;
  readonly handlers: (
    slot: DollSlot,
  ) => Pick<HitHandlers, 'onSecondaryTap' | 'onDown' | 'onRelease'>;
  /** Each drawn cell's visible rect, for resolving drops. */
  readonly record: (slot: DollSlot, rect: Rect) => void;
  /** Whether hover tooltips may show (no drag or menu in flight). */
  readonly tooltips: boolean;
  readonly onState?: (slot: DollSlot, state: HitState) => void;
}

/** The cell side and per-row count that fit `width`, never above the slot token. */
function dollCellSide(ui: Ui, width: number): { side: number; perRow: number } {
  const gap = ui.theme.space.xs;
  const perRow = DOLL_MAX_SECTION_CELLS;
  const side = Math.min(ui.theme.size.slot, (width - gap * (perRow - 1)) / perRow);
  return { side: Math.max(0, side), perRow };
}

/** The doll column's natural width: one full section of cells plus the scrollbar's room. */
export function dollColumnWidth(ui: Ui, cellSide: number): number {
  const gap = ui.theme.space.xs;
  return (
    DOLL_MAX_SECTION_CELLS * cellSide + gap * (DOLL_MAX_SECTION_CELLS - 1) + scrollGutterWidth(ui)
  );
}

function statLines(owner: InventoryOwner): { label: string; value: string; bonus: number }[] {
  const bonuses = owner.inventory.getEquippedStatBonus();
  return ALL_STATS.map((stat) => ({
    label: STAT_LABELS[stat],
    value: String(owner[stat]),
    bonus: bonuses[stat],
  }));
}

function contentHeight(ui: Ui, width: number, owner: InventoryOwner): number {
  const { space } = ui.theme;
  const { side, perRow } = dollCellSide(ui, width);
  const overline = lineHeightOf(ui, 'overline');
  let h = 0;
  for (const section of DOLL_SECTIONS) {
    const rows = Math.ceil(section.cells.length / perRow);
    h += overline + space.xs + rows * side + (rows - 1) * space.xs + space.md;
  }
  h += overline + space.xs + ALL_STATS.length * lineHeightOf(ui, 'label');
  for (const line of wornGearSummary(owner.inventory)) {
    h += space.xs + measureTextHeight(ui, width, { text: line, role: 'caption' });
  }
  return h;
}

export function dollColumn(ui: Ui, rect: Rect, opts: DollColumnOptions): void {
  const innerW = rect.w - scrollGutterWidth(ui);
  scrollView(ui, rect, {
    id: `${opts.id}/scroll`,
    contentHeight: contentHeight(ui, innerW, opts.owner),
    draw: (content) => drawDoll(ui, { ...content, w: innerW }, opts),
  });
}

function drawDoll(ui: Ui, content: Rect, opts: DollColumnOptions): void {
  const { space, palette } = ui.theme;
  const { side, perRow } = dollCellSide(ui, content.w);
  const overline = lineHeightOf(ui, 'overline');
  let y = content.y;
  for (const section of DOLL_SECTIONS) {
    text(
      ui,
      { x: content.x, y, w: content.w, h: overline },
      {
        text: section.slot,
        role: 'overline',
      },
    );
    y += overline + space.xs;
    section.cells.forEach((slot, index) => {
      const column = index % perRow;
      const row = Math.floor(index / perRow);
      const cellRect: Rect = {
        x: content.x + column * (side + space.xs),
        y: y + row * (side + space.xs),
        w: side,
        h: side,
      };
      drawDollCell(ui, cellRect, slot, opts);
    });
    const rows = Math.ceil(section.cells.length / perRow);
    y += rows * side + (rows - 1) * space.xs + space.md;
  }

  text(ui, { x: content.x, y, w: content.w, h: overline }, { text: 'Stats', role: 'overline' });
  y += overline + space.xs;
  const lineH = lineHeightOf(ui, 'label');
  for (const line of statLines(opts.owner)) {
    const [labelCell, valueCell, bonusCell] = splitH(
      { x: content.x, y, w: content.w, h: lineH },
      ['fill', side, side],
      space.xs,
    );
    text(ui, labelCell, { text: line.label, role: 'secondary' });
    tabularNumber(ui, valueCell, { value: line.value, role: 'label', align: 'right' });
    if (line.bonus !== 0) {
      tabularNumber(ui, bonusCell, {
        value: `${line.bonus > 0 ? '+' : ''}${line.bonus}`,
        role: 'label',
        align: 'right',
        color: line.bonus > 0 ? palette.state.success : palette.state.danger,
      });
    }
    y += lineH;
  }
  for (const line of wornGearSummary(opts.owner.inventory)) {
    y += space.xs;
    const h = measureTextHeight(ui, content.w, { text: line, role: 'caption' });
    text(ui, { x: content.x, y, w: content.w, h }, { text: line, role: 'caption', wrap: true });
    y += h;
  }
}

function drawDollCell(ui: Ui, rect: Rect, slot: DollSlot, opts: DollColumnOptions): void {
  const input = opts.cell(slot, rect);
  const visible = ui.clipRect === null ? null : intersect(rect, ui.clipRect);
  if (visible !== null) opts.record(slot, visible);
  const state = itemSlot(ui, rect, {
    id: `${opts.id}/${slot.key}`,
    item: input.item?.id ?? null,
    selected: input.selected,
    dragging: input.dragging,
    dropTarget: input.dropTarget,
    disabled: input.disabled,
    categoryAccent: false,
    onTap: () => opts.onTap(slot),
    onDrag: opts.onDrag(slot),
    handlers: opts.handlers(slot),
  });
  opts.onState?.(slot, state);
  if (input.item === null) {
    text(ui, rect, {
      text: shortSubSlotLabel(slot.subSlot),
      role: 'caption',
      color: ui.theme.palette.text.muted,
      align: 'center',
    });
  }
  tooltip(ui, rect, {
    id: `${opts.id}/${slot.key}/tip`,
    title: slot.subSlot,
    text:
      input.item === null
        ? 'Empty. Tap to see what fits.'
        : `${input.item.name}. Tap to take it off.`,
    show: opts.tooltips && (state.hovered || state.focused),
    immediate: state.focused,
  });
}
