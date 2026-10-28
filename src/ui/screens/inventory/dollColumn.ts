/**
 * The Character tab's left column: the paper doll, head to foot, then the
 * crawler's stats and what their worn gear adds up to.
 */

import { rarityTooltipLines } from '../dialogs/canvasChrome';
import { subSlotLabel, type InventoryItem } from '../../../core/items/defs/ItemDefs';
import type { CrawlerKind } from '../../../core/skills/SkillManager';
import { ALL_STATS, STAT_DEFS } from '../../../core/party/stats';
import { intersect, splitH, type Rect } from '../../core/geom';
import type { DragHandlers, HitHandlers, HitState, Ui } from '../../core/UiRoot';
import { badge, badgeSize } from '../../widgets/badge';
import { itemSlot, slotContent } from '../../widgets/itemSlot';
import { scrollGutterWidth, scrollView } from '../../widgets/scrollView';
import { lineHeightOf, measureTextHeight, tabularNumber, text } from '../../widgets/text';
import { tooltip } from '../../widgets/tooltip';
import {
  DOLL_MAX_SECTION_CELLS,
  DOLL_SECTION_LABELS,
  dollSectionsFor,
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
  /** A cursed piece that cannot come off until the party next reaches a safe room. */
  readonly bound: boolean;
}

const BOUND_CHIP = 'Bound';

export interface DollColumnOptions {
  readonly id: string;
  /** Whose doll this is, which decides the sections it has. */
  readonly kind: CrawlerKind;
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
    label: STAT_DEFS[stat].label,
    value: String(owner.statValue(stat)),
    bonus: bonuses[stat],
  }));
}

function contentHeight(ui: Ui, width: number, kind: CrawlerKind, owner: InventoryOwner): number {
  const { space } = ui.theme;
  const { side, perRow } = dollCellSide(ui, width);
  const overline = lineHeightOf(ui, 'overline');
  let h = 0;
  for (const section of dollSectionsFor(kind)) {
    const rows = Math.ceil(section.cells.length / perRow);
    h += overline + space.xs + rows * side + (rows - 1) * space.xs + space.md;
  }
  h += overline + space.xs + ALL_STATS.length * lineHeightOf(ui, 'label');
  for (const line of wornGearSummary(owner)) {
    h += space.xs + measureTextHeight(ui, width, { text: line, role: 'caption' });
  }
  return h;
}

export function dollColumn(ui: Ui, rect: Rect, opts: DollColumnOptions): void {
  const innerW = rect.w - scrollGutterWidth(ui);
  scrollView(ui, rect, {
    id: `${opts.id}/scroll`,
    contentHeight: contentHeight(ui, innerW, opts.kind, opts.owner),
    draw: (content) => drawDoll(ui, { ...content, w: innerW }, opts),
  });
}

function drawDoll(ui: Ui, content: Rect, opts: DollColumnOptions): void {
  const { space, palette } = ui.theme;
  const { side, perRow } = dollCellSide(ui, content.w);
  const overline = lineHeightOf(ui, 'overline');
  let y = content.y;
  for (const section of dollSectionsFor(opts.kind)) {
    text(
      ui,
      { x: content.x, y, w: content.w, h: overline },
      {
        text: DOLL_SECTION_LABELS[section.slot],
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
  for (const line of wornGearSummary(opts.owner)) {
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
    ...slotContent(
      input.item?.id ?? null,
      input.item !== null && opts.owner.gear.isAwakened(input.item.id),
    ),
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
      text: subSlotLabel(opts.kind, slot.subSlot),
      role: 'caption',
      color: ui.theme.palette.text.muted,
      align: 'center',
    });
  }
  if (input.bound) drawBoundChip(ui, rect);
  tooltip(ui, rect, {
    id: `${opts.id}/${slot.key}/tip`,
    title: subSlotLabel(opts.kind, slot.subSlot),
    text: cellTip(input),
    lines: input.item !== null ? rarityTooltipLines(ui.theme, input.item.id) : undefined,
    show: opts.tooltips && (state.hovered || state.focused),
    immediate: state.focused,
  });
}

function cellTip(input: DollCellInput): string {
  if (input.item === null) return 'Empty. Tap to see what fits.';
  if (input.bound) return `${input.item.name}. Bound: it comes off at the next safe room.`;
  return `${input.item.name}. Tap to take it off.`;
}

/** The red chip along a bound piece's cell foot. */
function drawBoundChip(ui: Ui, rect: Rect): void {
  const pill = badgeSize(ui, { label: BOUND_CHIP, kind: 'tag' });
  const pad = ui.theme.space.xxs;
  badge(
    ui,
    {
      x: rect.x + (rect.w - pill.w) / 2,
      y: rect.y + rect.h - pill.h - pad,
      w: pill.w,
      h: pill.h,
    },
    { label: BOUND_CHIP, kind: 'tag', variant: 'solid', tone: 'danger' },
  );
}
