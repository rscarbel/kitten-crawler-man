/**
 * Draws the inventory screen and registers its hit regions. Every decision
 * about what an input does lives on {@link InventoryScreen}; this file only
 * lays out and wires.
 */

import { BAG_SORT_LABELS, BAG_SORT_MODES } from '../../../core/bagSort';
import {
  BAG_PAGE_SLOTS,
  HOTBAR_COUNT,
  ITEM_DEF,
  QUEST_SLOT_IDX,
  isWearable,
  type InventoryItem,
} from '../../../core/ItemDefs';
import { HOTBAR_ACTIONS, keybindings } from '../../../core/Keybindings';
import { describeItemEffects } from '../../itemEffectLines';
import { ITEM_ICONS } from '../../icons/itemIcons';
import {
  centerIn,
  grid,
  inset,
  intersect,
  splitH,
  splitV,
  type Rect,
  type Track,
} from '../../core/geom';
import type { DragHandlers, HitHandlers, HitRegion, Ui } from '../../core/UiRoot';
import type { HotbarSlotArrangement } from '../../hud/hudModel';
import { DESCRIPTION_ACTION, type MenuTarget } from './InventoryActions';
import { drawGlyph } from '../../theme/glyphs';
import { badge, badgeSize } from '../../widgets/badge';
import { button, measureButton } from '../../widgets/button';
import { card } from '../../widgets/card';
import { contextMenu, type ContextMenuItem } from '../../widgets/contextMenu';
import { iconButton, iconButtonSize } from '../../widgets/iconButton';
import { fillRounded, strokeRounded } from '../../widgets/paint';
import { itemSlot } from '../../widgets/itemSlot';
import { listRow } from '../../widgets/listRow';
import { panel, panelBodyWidth } from '../../widgets/panel';
import { scrollGutterWidth, scrollIntoView, scrollView } from '../../widgets/scrollView';
import { searchField } from '../../widgets/searchField';
import { measureTabs, tabs, type TabItem } from '../../widgets/tabs';
import { measureText, tabularNumber, text } from '../../widgets/text';
import { tooltip } from '../../widgets/tooltip';
import {
  FILTER_LABELS,
  buildBagView,
  categoryCounts,
  pageCells,
  pageShowing,
  viewPageCount,
  visibleFilters,
  type BagCell,
  type BagView,
} from './bagView';
import {
  detailPane,
  emptyDetail,
  measureDetail,
  type DetailAction,
  type DetailModel,
} from './detailPane';
import { dollColumn, dollColumnWidth } from './dollColumn';
import { armorDeltas, equipSlotLabel, fitsDollSlot } from './gearRules';
import { hotbarRefusal, type InventoryScreen, type Point } from './InventoryScreen';
import type { BagFilter, InventoryMember, InventoryTab } from './inventoryTypes';

const RAIL_WIDTH = 168;
const DETAIL_WIDTH = 272;
/** Taller screens show this many grid rows before the grid scrolls. */
const MAX_REGULAR_GRID_ROWS = 5;
/**
 * On a phone the pager sits beside the hotbar only while each hotbar slot keeps
 * at least this share of its full size; a narrower phone gives it its own row.
 */
const MIN_INLINE_HOTBAR_SLOT_SHARE = 0.75;
/** Whole grid rows a phone keeps visible. */
const COMPACT_GRID_ROWS = 2;
/** Keeps float rounding from dropping a column `grid()` should fit. */
const CELL_ROUNDING_SLACK = 0.5;
const COMPACT_SEARCH_WIDTH = 148;
/** The phone's detail sheet may take this share of the panel. */
const SHEET_MAX_FRACTION = 0.85;
const GHOST_ALPHA = 0.8;
const SHEET_BORDER_WIDTH = 1;
const TITLE = 'Inventory';
const PANEL_ID = 'inventory';
/** Chip labels short enough for a phone's chip row. */
const SHORT_FILTER_LABELS: Readonly<Record<BagFilter, string>> = {
  all: 'All',
  weapon: 'Weapons',
  armor: 'Armor',
  consumable: 'Use',
  tool: 'Tools',
  material: 'Mats',
  book: 'Books',
  quest: 'Quest',
  kit: 'Kits',
};
const SEARCH_PLACEHOLDER = 'Search bag';
const EMPTY_GRID_MESSAGE = 'Nothing here.';
const EMPTY_DETAIL_MESSAGE = 'Select an item to see what it does.';
const EMPTY_GEAR_MESSAGE = 'Nothing you carry fits here.';
const NEW_BADGE = 'New';
const QUEST_KEYCAP = 'Q';
const HOTBAR_LABEL = 'Hotbar';
const PREVIOUS_PAGE_LABEL = 'Previous page';
const NEXT_PAGE_LABEL = 'Next page';

const TABS_ID = 'tabs';
const TABS: readonly TabItem[] = [
  { id: 'bag', label: 'Bag', icon: 'bag' },
  { id: 'character', label: 'Character', icon: 'users' },
];

export function renderInventory(ui: Ui, screen: InventoryScreen): void {
  const member = screen.member();
  if (member === null) return;
  const compact = ui.size === 'compact';
  const sound = screen.beginFrame(ui.now, ui.openedAt, ui.density === 'touch', compact);
  if (sound !== null) ui.playSound(sound);

  const back = screen.backHandler;
  const p = panel(ui, {
    id: PANEL_ID,
    width: 'xl',
    height: compact ? 'fill' : 'content',
    contentHeight: naturalBodyHeight(ui),
    scrim: false,
    header: (rect) => drawHeader(ui, rect, screen, member),
    onBack: back === null ? undefined : () => screen.goBack(),
    onClose: () => screen.close(),
  });
  screen.geometry.frame = p.frame;
  if (screen.tab === 'bag') drawBagTab(ui, p.body, screen, member);
  else drawCharacterTab(ui, p.body, screen, member);

  if (compact && screen.sheetOpen) drawDetailSheet(ui, p.frame, p.body.y, screen, member);
  drawMenu(ui, screen, member);
  drawDragGhost(ui, screen);
}

// ── Sizing ──────────────────────────────────────────────────────────────────

function gridGap(ui: Ui): number {
  return ui.size === 'compact' ? ui.theme.space.xs : ui.theme.space.sm;
}

/**
 * The smallest cell `grid()` may use. On a phone it shrinks (to no less than
 * a compact control) until `COMPACT_GRID_ROWS` whole rows fit the grid's height.
 */
function gridCellFloor(ui: Ui, width: number, height: number): number {
  const slot = ui.theme.size.slot;
  if (ui.size !== 'compact') return slot;
  const gap = gridGap(ui);
  const fitting = (height - gap * (COMPACT_GRID_ROWS - 1)) / COMPACT_GRID_ROWS;
  if (fitting >= slot) return slot;
  const floor = ui.theme.size.control - ui.theme.space.sm;
  const columns = Math.ceil((width + gap) / (Math.max(floor, fitting) + gap));
  return Math.max(floor, (width - gap * (columns - 1)) / columns - CELL_ROUNDING_SLACK);
}

/** Columns a grid `width` wide fits, as `grid()` will lay them. */
function gridColumns(ui: Ui, width: number): number {
  const gap = gridGap(ui);
  return Math.max(1, Math.floor((width + gap) / (ui.theme.size.slot + gap)));
}

/** On a phone the hotbar row shrinks to a control's height so the grid keeps two rows. */
function hotbarRowHeight(ui: Ui): number {
  return ui.size === 'compact' ? ui.theme.size.control : ui.theme.size.slot;
}

function naturalBodyHeight(ui: Ui): number {
  const { space, size } = ui.theme;
  if (ui.size === 'compact') return 0;
  const bodyW = panelBodyWidth(ui, 'xl');
  const centerW = bodyW - RAIL_WIDTH - DETAIL_WIDTH - space.lg * 2 - scrollGutterWidth(ui);
  const columns = gridColumns(ui, centerW);
  const gap = gridGap(ui);
  const cell = (centerW - gap * (columns - 1)) / columns;
  const rows = Math.min(MAX_REGULAR_GRID_ROWS, Math.ceil(BAG_PAGE_SLOTS / columns));
  const gridH = rows * cell + (rows - 1) * gap;
  const bagMain = size.control + space.sm + gridH + space.sm + size.control;
  return bagMain + space.md + hotbarRowHeight(ui);
}

// ── Header ──────────────────────────────────────────────────────────────────

/**
 * The tabs, party switcher and coin count, in the slot the panel leaves
 * between its back chevron and ✕. A row too narrow for them all first
 * drops the title, then shrinks the switcher to its icon, then the tabs.
 */
function drawHeader(ui: Ui, slot: Rect, screen: InventoryScreen, member: InventoryMember): void {
  const { space, size, palette } = ui.theme;
  const rect = centerIn(slot, slot.w, Math.min(slot.h, size.control));
  const party = screen.host.party();
  const coins = screen.host.coins().toLocaleString('en-US');
  const coinsW = size.icon + space.xs + measureText(ui, coins, { role: 'label', tabular: true });
  const switcherLabelW =
    party.length > 1 ? measureButton(ui, { label: member.name, icon: 'users' }) : 0;
  const widestTab = Math.max(...TABS.map((tab) => measureTabs(ui, [tab])));
  const naturalTabsW = Math.min(rect.w / 2, widestTab * TABS.length);
  const naturalTitleW = ui.size === 'compact' ? 0 : measureText(ui, TITLE, { role: 'title' });

  /** The fixed parts with one gap each: with the row's one fill track, every gap the row has. */
  const rowWidth = (parts: readonly number[]): number => {
    const shown = parts.filter((w) => w > 0);
    return shown.reduce((sum, w) => sum + w, 0) + space.sm * shown.length;
  };
  const titleW =
    rowWidth([naturalTitleW, naturalTabsW, switcherLabelW, coinsW]) <= rect.w ? naturalTitleW : 0;
  const switcherIconOnly =
    switcherLabelW > 0 && rowWidth([naturalTabsW, switcherLabelW, coinsW]) > rect.w;
  const switcherW = switcherIconOnly ? size.control : switcherLabelW;
  const roomForTabs = rect.w - rowWidth([titleW, switcherW, coinsW]) - space.sm;
  const tabsW = Math.max(0, Math.min(naturalTabsW, roomForTabs));

  const tracks: Track[] = [];
  if (titleW > 0) tracks.push(titleW);
  tracks.push(tabsW, 'fill');
  if (switcherW > 0) tracks.push(switcherW);
  tracks.push(coinsW);
  const cells = splitH(rect, tracks, space.sm);
  let index = 0;
  const next = (): Rect => cells[index++] ?? rect;

  if (titleW > 0) text(ui, next(), { text: TITLE, role: 'title' });
  tabs(ui, next(), {
    id: TABS_ID,
    items: TABS,
    selected: screen.tab,
    onSelect: (id) => screen.setTab(id === 'character' ? 'character' : 'bag'),
  });
  next();
  if (switcherW > 0) {
    const cell = next();
    const openSwitcher = (): void => {
      screen.menu = { kind: 'party', at: { x: cell.x, y: cell.y + cell.h } };
    };
    if (switcherIconOnly) {
      iconButton(ui, cell, {
        id: 'switcher',
        icon: 'users',
        label: member.name,
        variant: 'ghost',
        onTap: openSwitcher,
      });
    } else {
      button(ui, cell, {
        id: 'switcher',
        label: member.name,
        icon: 'users',
        variant: 'ghost',
        onTap: openSwitcher,
      });
    }
  }
  const coinCell = next();
  const coinState = ui.hit('coins', coinCell, { focusable: false });
  drawGlyph(
    ui.ctx,
    'coin',
    centerIn({ x: coinCell.x, y: coinCell.y, w: size.icon, h: coinCell.h }, size.icon, size.icon),
    { color: palette.accent.base },
  );
  tabularNumber(ui, inset(coinCell, { l: size.icon + space.xs }), {
    value: coins,
    role: 'label',
    color: palette.accent.base,
  });
  const split = screen.host.coinSplit?.() ?? null;
  if (split !== null) {
    tooltip(ui, coinCell, {
      id: 'coins/tip',
      text: split,
      show: coinState.hovered,
      placement: 'below',
    });
  }
}

// ── Bag tab ─────────────────────────────────────────────────────────────────

function bagView(screen: InventoryScreen, member: InventoryMember): BagView {
  return buildBagView(member.owner.inventory, {
    filter: screen.filter,
    query: screen.search.value,
    sort: screen.sort,
  });
}

function drawBagTab(ui: Ui, rect: Rect, screen: InventoryScreen, member: InventoryMember): void {
  const { space, size } = ui.theme;
  const view = bagView(screen, member);
  if (ui.size === 'compact') {
    const pages = viewPageCount(view);
    const tidyW = measureButton(ui, { label: 'Tidy', size: 'sm' });
    const pagerW = pages > 1 ? pagerWidth(ui, pages, true) : 0;
    const hotbarBesidePager = rect.w - pagerW - tidyW - space.sm * 2;
    const pagerInline =
      hotbarBesidePager / HOTBAR_COUNT >= hotbarRowHeight(ui) * MIN_INLINE_HOTBAR_SLOT_SHARE;
    const pagerOwnRow = pages > 1 && !pagerInline;
    const [toolbar, gridRect, ...lower] = splitV(
      rect,
      pagerOwnRow
        ? [size.control, 'fill', iconButtonSize(ui, 'sm'), hotbarRowHeight(ui)]
        : [size.control, 'fill', hotbarRowHeight(ui)],
      space.sm,
    );
    const [chips, search, sort] = splitH(
      toolbar,
      ['fill', COMPACT_SEARCH_WIDTH, size.control],
      space.sm,
    );
    drawCategoryChips(ui, chips, screen, member);
    searchField(ui, search, {
      id: 'search',
      input: screen.search,
      placeholder: SEARCH_PLACEHOLDER,
    });
    iconButton(ui, sort, {
      id: 'sort',
      icon: 'sort',
      label: `Sort: ${BAG_SORT_LABELS[screen.sort]}`,
      onTap: () => {
        screen.menu = { kind: 'sort', at: { x: sort.x, y: sort.y + sort.h } };
      },
    });
    drawGrid(ui, gridRect, screen, member, view);
    const bottom = lower[lower.length - 1];
    if (pagerOwnRow) {
      drawPager(ui, lower[0], screen, pages, true);
    }
    if (pages > 1 && pagerInline) {
      const [pager, tidy, hotbar] = splitH(bottom, [pagerW, tidyW, 'fill'], space.sm);
      drawPager(ui, pager, screen, pages, true);
      drawTidy(ui, tidy, screen, 'sm');
      drawHotbarRow(ui, hotbar, screen, member, false);
    } else {
      const [tidy, hotbar] = splitH(bottom, [tidyW, 'fill'], space.sm);
      drawTidy(ui, tidy, screen, 'sm');
      drawHotbarRow(ui, hotbar, screen, member, false);
    }
    return;
  }

  const [top, hotbarRow] = splitV(rect, ['fill', hotbarRowHeight(ui)], space.md);
  const [rail, center, detail] = splitH(top, [RAIL_WIDTH, 'fill', DETAIL_WIDTH], space.lg);
  drawRail(ui, rail, screen, member);
  const [toolbar, gridRect, pagerRow] = splitV(
    center,
    [size.control, 'fill', size.control],
    space.sm,
  );
  const sortLabel = BAG_SORT_LABELS[screen.sort];
  const sortW = measureButton(ui, { label: sortLabel, icon: 'sort' });
  const [search, sort] = splitH(toolbar, ['fill', sortW], space.sm);
  searchField(ui, search, { id: 'search', input: screen.search, placeholder: SEARCH_PLACEHOLDER });
  button(ui, sort, {
    id: 'sort',
    label: sortLabel,
    icon: 'sort',
    variant: 'ghost',
    onTap: () => {
      screen.menu = { kind: 'sort', at: { x: sort.x, y: sort.y + sort.h } };
    },
  });
  drawGrid(ui, gridRect, screen, member, view);
  const tidyW = measureButton(ui, { label: 'Tidy' });
  const [pager, tidy] = splitH(pagerRow, ['fill', tidyW], space.sm);
  drawPager(ui, pager, screen, viewPageCount(view), false);
  drawTidy(ui, tidy, screen, 'md');
  drawDetailCard(ui, detail, screen, member);
  drawHotbarRow(ui, hotbarRow, screen, member, true);
}

function drawRail(ui: Ui, rect: Rect, screen: InventoryScreen, member: InventoryMember): void {
  const counts = categoryCounts(member.owner.inventory);
  const filters = visibleFilters(counts);
  if (!filters.includes(screen.filter)) screen.setFilter('all');
  const rowH = ui.theme.size.row;
  scrollView(ui, rect, {
    id: 'rail',
    contentHeight: filters.length * rowH,
    draw: (content) => {
      const rows = splitV(
        content,
        filters.map(() => rowH),
        0,
      );
      filters.forEach((filter, index) => {
        listRow(ui, rows[index], {
          id: `rail/${filter}`,
          title: FILTER_LABELS[filter],
          trailing: String(counts.get(filter) ?? 0),
          accent: filter === 'all' ? undefined : ui.theme.palette.category[filter],
          selected: screen.filter === filter,
          onTap: () => screen.setFilter(filter),
        });
      });
    },
  });
}

function drawCategoryChips(
  ui: Ui,
  rect: Rect,
  screen: InventoryScreen,
  member: InventoryMember,
): void {
  const counts = categoryCounts(member.owner.inventory);
  const filters = visibleFilters(counts);
  if (!filters.includes(screen.filter)) screen.setFilter('all');
  tabs(ui, rect, {
    id: 'chips',
    variant: 'underline',
    items: filters.map((filter) => ({ id: filter, label: SHORT_FILTER_LABELS[filter] })),
    selected: screen.filter,
    onSelect: (id) => {
      const filter = filters.find((candidate) => candidate === id);
      if (filter !== undefined) screen.setFilter(filter);
    },
  });
}

function pagerLabel(page: number, pages: number, short: boolean): string {
  return short ? `${page + 1}/${pages}` : `Page ${page + 1} of ${pages}`;
}

/** The width the pager takes: a turn button either side of the widest page label. */
function pagerWidth(ui: Ui, pages: number, short: boolean): number {
  const side = iconButtonSize(ui, 'sm');
  const labelW = measureText(ui, pagerLabel(pages - 1, pages, short), {
    role: 'label',
    tabular: true,
  });
  return side * 2 + labelW + ui.theme.space.xs * 2;
}

/**
 * Back and forward through the grid's pages, with the page shown between. A
 * stack dragged onto either button goes to the first empty slot of the page
 * it turns to. Nothing is drawn while the view fits on one page.
 */
function drawPager(
  ui: Ui,
  rect: Rect,
  screen: InventoryScreen,
  pages: number,
  short: boolean,
): void {
  if (pages <= 1) return;
  const side = iconButtonSize(ui, 'sm');
  const width = Math.min(rect.w, pagerWidth(ui, pages, short));
  const row = centerIn(rect, width, Math.min(rect.h, side));
  const [backCell, labelCell, nextCell] = splitH(row, [side, 'fill', side], ui.theme.space.xs);
  const page = screen.page;
  const turn = (cell: Rect, target: number, icon: 'back' | 'chevronRight', label: string): void => {
    const exists = target >= 0 && target < pages;
    if (exists) screen.geometry.pageButtons.set(target, cell);
    iconButton(ui, cell, {
      id: icon === 'back' ? 'page/back' : 'page/next',
      icon,
      label,
      size: 'sm',
      selected: exists && screen.drag !== null && pointerOver(screen, cell),
      disabled: !exists,
      onTap: () => screen.showPage(target),
    });
  };
  turn(backCell, page - 1, 'back', PREVIOUS_PAGE_LABEL);
  tabularNumber(ui, labelCell, {
    value: pagerLabel(page, pages, short),
    role: 'label',
    align: 'center',
  });
  turn(nextCell, page + 1, 'chevronRight', NEXT_PAGE_LABEL);
}

function drawTidy(ui: Ui, rect: Rect, screen: InventoryScreen, size: 'sm' | 'md'): void {
  const r = screen.restrictions();
  const steered = (r.allowedSource ?? null) !== null || (r.allowedHotbarTarget ?? null) !== null;
  button(
    ui,
    centerIn(rect, rect.w, ui.theme.size.control - (size === 'sm' ? ui.theme.space.sm : 0)),
    {
      id: 'tidy',
      label: 'Tidy',
      size,
      variant: 'secondary',
      disabled: steered ? 'Not right now.' : false,
      onTap: () => screen.tidy(),
    },
  );
}

// ── Grid ────────────────────────────────────────────────────────────────────

function gridId(screen: InventoryScreen): string {
  return `${screen.tab}-grid`;
}

function drawGrid(
  ui: Ui,
  rect: Rect,
  screen: InventoryScreen,
  member: InventoryMember,
  view: BagView,
): void {
  screen.noteView(
    [screen.tab, screen.filter, screen.sort, screen.search.value.trim(), screen.dollKey].join('|'),
  );
  const reveal = screen.reveal;
  const revealPage = reveal === null ? null : pageShowing(view, reveal);
  // Turned without `showPage`'s scroll to the top: the reveal below scrolls
  // the revealed cell into view, and a reset after it would undo that.
  if (revealPage !== null) screen.page = revealPage;
  screen.page = Math.min(screen.page, viewPageCount(view) - 1);
  const cells = pageCells(view, screen.page);

  const gap = gridGap(ui);
  const innerW = Math.max(0, rect.w - scrollGutterWidth(ui));
  const local = grid({ x: 0, y: 0, w: innerW, h: 0 }, cells.length, {
    minCell: gridCellFloor(ui, innerW, rect.h),
    gap,
  });
  const columns = local.filter((cell) => cell.y === 0).length;
  const contentHeight =
    local.length === 0 ? 0 : local[local.length - 1].y + local[local.length - 1].h;
  const geometry = screen.geometry;
  geometry.grid = rect;
  geometry.columns = Math.max(1, columns);
  geometry.order = view.cells.map((cell) => cell.slotIdx);
  const id = gridId(screen);

  if (reveal !== null) {
    const at = cells.findIndex((cell) => cell.slotIdx === reveal);
    if (at !== -1) {
      const target = local[at];
      scrollIntoView(ui, id, target.y, target.y + target.h, rect.h);
    }
    screen.reveal = null;
  }
  const scrollTo = screen.scrollTarget;
  if (scrollTo !== null) {
    scrollIntoView(ui, id, scrollTo, scrollTo + rect.h, rect.h);
    screen.scrollTarget = null;
  }

  if (view.cells.length === 0) {
    text(ui, rect, {
      text: screen.tab === 'character' ? EMPTY_GEAR_MESSAGE : EMPTY_GRID_MESSAGE,
      role: 'muted',
      align: 'center',
    });
    return;
  }
  const scrolled = scrollView(ui, rect, {
    id,
    contentHeight,
    draw: (content) => {
      cells.forEach((cell, index) => {
        const at = local[index];
        drawBagCell(
          ui,
          { ...at, x: content.x + at.x, y: content.y + at.y },
          cell,
          screen,
          member,
          view,
        );
      });
    },
  });
  screen.gridOffset = scrolled.offset;

  const notice = screen.notice;
  if (notice !== null) {
    tooltip(
      ui,
      { x: rect.x, y: rect.y + rect.h, w: rect.w, h: 0 },
      {
        id: 'notice',
        text: notice.text,
        show: true,
        immediate: true,
        placement: 'above',
      },
    );
  }
}

function pointerOver(screen: InventoryScreen, rect: Rect): boolean {
  const drag = screen.drag;
  if (drag === null) return false;
  return (
    drag.x >= rect.x && drag.x < rect.x + rect.w && drag.y >= rect.y && drag.y < rect.y + rect.h
  );
}

/** Drag handlers for a stack; on touch a quick swipe across the grid scrolls it instead. */
function dragHandlers(
  screen: InventoryScreen,
  from: 'inv' | 'hotbar' | 'doll',
  slotIdx: number,
  dollKey: string | null,
  item: InventoryItem,
  regionId: string,
): DragHandlers {
  return {
    onStart: (p) => {
      const held = screen.heldForPickup(regionId);
      if (screen.touch && !held) {
        if (from === 'inv') screen.scrollDrag = { from: screen.gridOffset };
        return;
      }
      screen.beginDrag(from, slotIdx, dollKey, item, { x: p.x, y: p.y });
    },
    onMove: (p) => {
      const scroll = screen.scrollDrag;
      if (scroll !== null) {
        screen.scrollTarget = scroll.from - p.dy;
        return;
      }
      screen.moveDrag({ x: p.x, y: p.y });
    },
    onEnd: (p, cancelled) => {
      if (screen.scrollDrag !== null) {
        screen.scrollDrag = null;
        return;
      }
      screen.endDrag({ x: p.x, y: p.y }, cancelled);
    },
  };
}

function pressHandlers(
  screen: InventoryScreen,
  regionId: string,
  target: MenuTarget | null,
): Pick<HitHandlers, 'onSecondaryTap' | 'onDown' | 'onRelease'> {
  return {
    onDown: (e) => screen.pressDown(regionId, { x: e.x, y: e.y }),
    onRelease: (e, info) => screen.pressUp({ x: e.x, y: e.y }, info.cancelled || info.covered),
    onSecondaryTap:
      target === null ? undefined : (e) => screen.openItemMenu(target, { x: e.x, y: e.y }),
  };
}

function recordVisible(ui: Ui, map: Map<number, Rect>, key: number, rect: Rect): void {
  const clip = ui.clipRect;
  const visible = clip === null ? null : intersect(rect, clip);
  if (visible !== null) map.set(key, visible);
}

function drawBagCell(
  ui: Ui,
  rect: Rect,
  cell: BagCell,
  screen: InventoryScreen,
  member: InventoryMember,
  view: BagView,
): void {
  const geometry = screen.geometry;
  recordVisible(ui, geometry.bagCells, cell.slotIdx, rect);
  const regionId = `bag/${cell.slotIdx}`;
  const selection = screen.selection;
  const isSelected = selection?.source === 'inv' && selection.slotIdx === cell.slotIdx;
  const drag = screen.drag;
  const over = pointerOver(screen, rect);
  const item = cell.item;
  if (item === null) {
    itemSlot(ui, rect, {
      id: regionId,
      item: null,
      selected: isSelected,
      dropTarget: over && view.rearrangeable && drag?.from !== 'doll',
      onTap: () => screen.tapEmpty(cell.slotIdx),
    });
    return;
  }
  const inventory = member.owner.inventory;
  const target: MenuTarget = { source: 'inv', slotIdx: cell.slotIdx, item };
  const worn = inventory.hasEquipped(item.id);
  const lifted = drag?.from === 'inv' && drag.slotIdx === cell.slotIdx;
  const state = itemSlot(ui, rect, {
    id: regionId,
    item: item.id,
    quantity: item.quantity,
    selected: isSelected,
    dragging: lifted,
    dropTarget: over && !lifted && view.rearrangeable,
    equipped: worn,
    onTap: () => screen.tapStack({ source: 'inv', slotIdx: cell.slotIdx, id: item.id }, item),
    onDrag: dragHandlers(screen, 'inv', cell.slotIdx, null, item, regionId),
    handlers: pressHandlers(screen, regionId, target),
  });
  if (state.pressed) screen.checkLongPress(regionId, target);
  drawNewBadge(ui, rect, screen, item, worn);
  if (!screen.touch) {
    tooltip(ui, rect, {
      id: `${regionId}/tip`,
      title: item.name,
      accent: ui.theme.palette.category[ITEM_DEF[item.id].category],
      text: item.description ?? FILTER_LABELS[ITEM_DEF[item.id].category],
      lines: describeItemEffects(item).map((line) => ({ text: line, role: 'label' as const })),
      show: state.hovered && screen.drag === null && screen.menu === null,
    });
  }
}

function drawNewBadge(
  ui: Ui,
  rect: Rect,
  screen: InventoryScreen,
  item: InventoryItem,
  worn: boolean,
): void {
  if (worn || !screen.freshUpgrades.has(item.id)) return;
  const pill = badgeSize(ui, { label: NEW_BADGE, kind: 'tag' });
  const pad = ui.theme.space.xxs;
  badge(
    ui,
    { x: rect.x + rect.w - pill.w - pad, y: rect.y + pad, w: pill.w, h: pill.h },
    {
      label: NEW_BADGE,
      kind: 'tag',
      variant: 'solid',
      tone: 'accent',
    },
  );
}

// ── Hotbar row ──────────────────────────────────────────────────────────────

function drawHotbarRow(
  ui: Ui,
  rect: Rect,
  screen: InventoryScreen,
  member: InventoryMember,
  labelled: boolean,
): void {
  const { space } = ui.theme;
  const inventory = member.owner.inventory;
  const gap = space.xs;
  const questGap = space.md;
  const labelW = labelled ? measureText(ui, HOTBAR_LABEL, { role: 'overline' }) + space.md : 0;
  const available = rect.w - labelW - gap * (HOTBAR_COUNT - 2) - questGap;
  const side = Math.max(0, Math.min(rect.h, available / HOTBAR_COUNT));
  const rowW = labelW + side * HOTBAR_COUNT + gap * (HOTBAR_COUNT - 2) + questGap;
  let x = rect.x + (rect.w - rowW) / 2;
  const y = rect.y + (rect.h - side) / 2;
  if (labelled) {
    text(ui, { x, y, w: labelW, h: side }, { text: HOTBAR_LABEL, role: 'overline' });
    x += labelW;
  }
  for (let index = 0; index < HOTBAR_COUNT; index++) {
    if (index === QUEST_SLOT_IDX) x += questGap - gap;
    const cell: Rect = { x, y, w: side, h: side };
    x += side + gap;
    screen.geometry.hotbarCells.set(index, cell);
    const item = inventory.actionBar.slots[index] ?? null;
    const isQuest = index === QUEST_SLOT_IDX;
    const regionId = `hotbar/${index}`;
    const cooldown = item === null ? null : (screen.host.cooldownFor?.(item) ?? null);
    const { afterDraw, ...arrangement } = hotbarSlotArrangement(
      screen,
      member,
      index,
      cell,
      regionId,
    );
    const state = itemSlot(ui, cell, {
      id: regionId,
      item: item?.id ?? null,
      quantity: item?.quantity,
      keycap: isQuest ? QUEST_KEYCAP : keybindings.labelFor(HOTBAR_ACTIONS[index]),
      cooldown: cooldown === null || cooldown.max <= 0 ? 0 : cooldown.current / cooldown.max,
      equipped:
        item !== null &&
        (item.id === member.heldItemId ||
          inventory.showsInUse(item.id, member.drawnWeaponId ?? null)),
      ...arrangement,
    });
    afterDraw(state);
  }
}

/**
 * What a hotbar slot does while the inventory is open, wherever that slot is
 * drawn: the screen's own hotbar row and the HUD's bar beneath it share it, so
 * picking up, dropping and assigning work the same on both.
 */
export function hotbarSlotArrangement(
  screen: InventoryScreen,
  member: InventoryMember,
  index: number,
  cell: Rect,
  regionId: string,
): HotbarSlotArrangement {
  const inventory = member.owner.inventory;
  const drag = screen.drag;
  const selected = screen.selectedItem(inventory);
  const picking =
    screen.hotbarPickerOpen && selected !== null && screen.selection?.source === 'inv';
  const item = inventory.actionBar.slots[index] ?? null;
  const isQuest = index === QUEST_SLOT_IDX;
  const deny =
    !isQuest && drag !== null && drag.from === 'inv' && hotbarRefusal(drag.item) !== null;
  const lifted = drag?.from === 'hotbar' && drag.slotIdx === index;
  const target: MenuTarget | null =
    item === null || isQuest ? null : { source: 'hotbar', slotIdx: index, item };
  return {
    selected: screen.selection?.source === 'hotbar' && screen.selection.slotIdx === index,
    dragging: lifted,
    dropTarget: !isQuest && !deny && !lifted && pointerOver(screen, cell),
    disabled: deny,
    onTap: () => {
      const from = screen.selection;
      if (picking && !isQuest && from !== null) {
        screen.assignToHotbar(selected, from, index);
        return;
      }
      if (item !== null) screen.tapStack({ source: 'hotbar', slotIdx: index, id: item.id }, item);
    },
    onDrag:
      item === null || isQuest
        ? undefined
        : dragHandlers(screen, 'hotbar', index, null, item, regionId),
    handlers: pressHandlers(screen, regionId, target),
    afterDraw: (state) => {
      if (state.pressed && target !== null) screen.checkLongPress(regionId, target);
    },
  };
}

// ── Detail ──────────────────────────────────────────────────────────────────

const GENERIC_DANGER_ACTION = 'Drop';

function detailModel(screen: InventoryScreen, member: InventoryMember): DetailModel | null {
  const inventory = member.owner.inventory;
  const item = screen.selectedItem(inventory);
  const selection = screen.selection;
  if (item === null || selection === null) return null;
  const target: MenuTarget = { source: selection.source, slotIdx: selection.slotIdx, item };
  const lead = screen.leadEntry(target, inventory);
  const locked = screen.actionsLockedReason();
  const actions: DetailAction[] = screen
    .entriesFor(target, inventory)
    .filter((entry) => entry.action !== DESCRIPTION_ACTION)
    .map((entry) => ({
      id: entry.action,
      label: entry.label,
      variant:
        lead !== null && entry.action === lead.action
          ? 'primary'
          : entry.action === GENERIC_DANGER_ACTION
            ? 'danger'
            : 'secondary',
      disabled: entry.disabledReason ?? locked ?? false,
      onTap: () => screen.choose(entry.action, target),
    }));
  if (selection.source === 'inv' && screen.tab === 'bag') {
    actions.push({
      id: 'hotbar',
      label: HOTBAR_LABEL,
      icon: screen.hotbarPickerOpen ? 'chevronUp' : 'chevronDown',
      variant: 'secondary',
      disabled: hotbarRefusal(item) ?? false,
      onTap: () => {
        screen.hotbarPickerOpen = !screen.hotbarPickerOpen;
      },
    });
  }
  const picker = screen.hotbarPickerOpen
    ? HOTBAR_ACTIONS.slice(0, QUEST_SLOT_IDX).map((action, index) => ({
        index,
        label: keybindings.labelFor(action),
        current: inventory.actionBar.slots[index]?.id === item.id,
      }))
    : null;
  const notice = screen.notice;
  return {
    item,
    worn: inventory.hasEquipped(item.id),
    slotLabel: equipSlotLabel(item),
    effectLines: describeItemEffects(item),
    deltas: armorDeltas(item, inventory, screen.dollKey),
    notice: notice !== null && notice.id === item.id ? notice.text : null,
    actions,
    hotbarPicker: picker,
    onAssignHotbar: (index) => screen.assignToHotbar(item, selection, index),
  };
}

function drawDetailCard(
  ui: Ui,
  rect: Rect,
  screen: InventoryScreen,
  member: InventoryMember,
): void {
  const shown = card(ui, rect, { id: 'detail', kind: 'inset' });
  const model = detailModel(screen, member);
  if (model === null) {
    emptyDetail(ui, shown.body, EMPTY_DETAIL_MESSAGE);
    return;
  }
  detailPane(ui, shown.body, 'detail', model);
}

/**
 * The phone's item detail, slid up over the bag. Its top never rises past
 * `bodyTop`, so the panel's header and ✕ stay uncovered.
 */
function drawDetailSheet(
  ui: Ui,
  frame: Rect,
  bodyTop: number,
  screen: InventoryScreen,
  member: InventoryMember,
): void {
  const model = detailModel(screen, member);
  if (model === null) return;
  ui.defer(() => {
    const { space, palette, radius } = ui.theme;
    const pad = space.md;
    const closeSide = iconButtonSize(ui, 'sm');
    const view = ui.viewport;
    const safeLeft = Math.max(frame.x, view.x);
    const safeRight = Math.min(frame.x + frame.w, view.x + view.w);
    const safeBottom = Math.min(frame.y + frame.h, view.y + view.h);
    const bottomInset = frame.y + frame.h - safeBottom;
    const innerW = safeRight - safeLeft - pad * 2 - closeSide - space.sm;
    const natural = measureDetail(ui, innerW, model) + pad * 2 + bottomInset;
    const belowHeader = frame.y + frame.h - bodyTop;
    const h = Math.min(natural, frame.h * SHEET_MAX_FRACTION, belowHeader);
    const sheet: Rect = { x: frame.x, y: frame.y + frame.h - h, w: frame.w, h };
    const sheetRadius = { tl: radius.lg, tr: radius.lg, br: 0, bl: 0 };
    ui.block(sheet);
    fillRounded(ui.ctx, sheet, sheetRadius, palette.surface.raised);
    strokeRounded(ui.ctx, sheet, sheetRadius, palette.border.strong, SHEET_BORDER_WIDTH);
    const safeSheet: Rect = {
      x: safeLeft,
      y: sheet.y,
      w: safeRight - safeLeft,
      h: Math.max(0, safeBottom - sheet.y),
    };
    const content = inset(safeSheet, pad);
    iconButton(
      ui,
      { x: content.x + content.w - closeSide, y: content.y, w: closeSide, h: closeSide },
      {
        id: 'sheet/close',
        icon: 'chevronDown',
        label: 'Hide details',
        size: 'sm',
        onTap: () => {
          screen.sheetOpen = false;
        },
      },
    );
    const body = inset(content, { r: closeSide + space.sm });
    detailPane(ui, body, 'sheet', model);
  });
}

// ── Character tab ───────────────────────────────────────────────────────────

function drawCharacterTab(
  ui: Ui,
  rect: Rect,
  screen: InventoryScreen,
  member: InventoryMember,
): void {
  const { space, size } = ui.theme;
  const compact = ui.size === 'compact';
  const inventory = member.owner.inventory;
  const minDollCell = compact ? size.control : size.slot;
  const dollW = Math.min(rect.w / 2, dollColumnWidth(ui, minDollCell));
  const tracks: Track[] = compact ? [dollW, 'fill'] : [dollW, 'fill', DETAIL_WIDTH];
  const columns = splitH(rect, tracks, compact ? space.md : space.lg);
  const [dollRect, gridColumn] = columns;
  const detail = compact ? null : columns[2];
  const drag = screen.drag;

  dollColumn(ui, dollRect, {
    id: 'doll',
    kind: member.id,
    owner: member.owner,
    tooltips: !screen.touch && drag === null && screen.menu === null,
    cell: (slot, cellRect) => {
      const over = pointerOver(screen, cellRect);
      const fits = drag !== null && fitsDollSlot(drag.item, slot.key);
      return {
        item: inventory.getEquippedItem(slot.key),
        selected: screen.dollKey === slot.key,
        dragging: drag?.from === 'doll' && drag.dollKey === slot.key,
        dropTarget: over && fits,
        disabled: over && !fits,
      };
    },
    onTap: (slot) => screen.tapDollSlot(slot.key),
    onDrag: (slot) => {
      const item = inventory.getEquippedItem(slot.key);
      return item === null
        ? undefined
        : dragHandlers(screen, 'doll', -1, slot.key, item, `doll/${slot.key}`);
    },
    handlers: (slot) => pressHandlers(screen, `doll/${slot.key}`, null),
    record: (slot, visible) => screen.geometry.dollCells.set(slot.key, visible),
  });

  const dollKey = screen.dollKey;
  const view = buildBagView(inventory, {
    filter: 'all',
    query: screen.search.value,
    sort: 'manual',
    accept: (item) => isWearable(item) && (dollKey === null || fitsDollSlot(item, dollKey)),
  });
  const pages = viewPageCount(view);
  const [toolbar, gridRect, ...pagerRow] = splitV(
    gridColumn,
    pages > 1 ? [size.control, 'fill', iconButtonSize(ui, 'sm')] : [size.control, 'fill'],
    space.sm,
  );
  const filterLabel = dollKey === null ? 'Wearables' : `Fits ${dollKey.replace(':', ' · ')}`;
  const chipW = Math.min(
    toolbar.w / 2,
    measureButton(ui, {
      label: filterLabel,
      icon: dollKey === null ? undefined : 'close',
      size: 'sm',
    }),
  );
  const [chip, search] = splitH(toolbar, [chipW, 'fill'], space.sm);
  if (dollKey === null) {
    text(ui, chip, { text: filterLabel, role: 'overline' });
  } else {
    button(ui, centerIn(chip, chip.w, ui.theme.size.control - space.sm), {
      id: 'doll-filter',
      label: filterLabel,
      icon: 'close',
      size: 'sm',
      variant: 'ghost',
      onTap: () => {
        screen.dollKey = null;
      },
    });
  }
  searchField(ui, search, { id: 'search', input: screen.search, placeholder: SEARCH_PLACEHOLDER });
  drawGrid(ui, gridRect, screen, member, view);
  for (const row of pagerRow) drawPager(ui, row, screen, pages, ui.size === 'compact');
  if (detail !== null) drawDetailCard(ui, detail, screen, member);
}

// ── Overlays ────────────────────────────────────────────────────────────────

function drawMenu(ui: Ui, screen: InventoryScreen, member: InventoryMember): void {
  const menu = screen.menu;
  if (menu === null) return;
  const dismiss = (): void => {
    screen.menu = null;
  };
  if (menu.kind === 'sort') {
    contextMenu(ui, {
      id: 'sort-menu',
      at: menu.at,
      title: 'Sort by',
      onDismiss: dismiss,
      items: BAG_SORT_MODES.map((mode) => ({
        id: mode,
        label: BAG_SORT_LABELS[mode],
        icon: screen.sort === mode ? 'check' : undefined,
        onTap: () => {
          screen.sort = mode;
        },
      })),
    });
    return;
  }
  if (menu.kind === 'party') {
    contextMenu(ui, {
      id: 'party-menu',
      at: menu.at,
      title: 'Show pack',
      onDismiss: dismiss,
      items: screen.host.party().map((candidate) => ({
        id: candidate.id,
        label: candidate.name,
        icon: candidate.id === member.id ? 'check' : undefined,
        onTap: () => screen.switchMember(candidate.id),
      })),
    });
    return;
  }
  const inventory = member.owner.inventory;
  const target = menu.target;
  const live =
    (target.source === 'hotbar' ? inventory.actionBar.slots : inventory.bag.slots)[
      target.slotIdx
    ] ?? null;
  if (live?.id !== target.item.id) {
    screen.menu = null;
    return;
  }
  const items: ContextMenuItem[] = screen.entriesFor(target, inventory).map((entry) => ({
    id: menuItemId(entry.action),
    label: entry.action === DESCRIPTION_ACTION ? 'Details' : entry.label,
    danger: entry.action === GENERIC_DANGER_ACTION,
    disabled: entry.disabledReason ?? screen.actionsLockedReason() ?? false,
    onTap: () => screen.choose(entry.action, target),
  }));
  if (target.source === 'inv') {
    items.push({
      id: 'assign-hotbar',
      label: 'Assign to hotbar',
      disabled: hotbarRefusal(target.item) ?? false,
      onTap: () => screen.openHotbarPicker(target),
    });
  }
  contextMenu(ui, {
    id: ITEM_MENU_ID,
    at: menu.at,
    title: target.item.name,
    items,
    onDismiss: dismiss,
  });
}

/** The context menu's widget id for an entry's action, e.g. `equip`. */
export function menuItemId(action: string): string {
  return action.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

const ITEM_MENU_ID = 'item-menu';
/** Widget ids the context menu registers beside its entries. */
const ITEM_MENU_CHROME: ReadonlySet<string> = new Set(['dismiss', 'rows']);

/**
 * The open item menu's entries as the last frame registered them, keyed by
 * {@link menuItemId}, in UI units: what the tutorial points at.
 */
export function itemMenuEntryRects(
  surfaceId: string,
  regions: readonly HitRegion[],
): { readonly id: string; readonly rect: Rect }[] {
  const prefix = `${surfaceId}/${ITEM_MENU_ID}/`;
  return regions
    .filter((region) => region.id.startsWith(prefix))
    .map((region) => ({ id: region.id.slice(prefix.length), rect: region.rect }))
    .filter((entry) => !ITEM_MENU_CHROME.has(entry.id));
}

/** Where the header drew `tab`'s button last frame, in UI units; null when it was not drawn. */
export function inventoryTabRect(
  surfaceId: string,
  regions: readonly HitRegion[],
  tab: InventoryTab,
): Rect | null {
  const id = `${surfaceId}/${TABS_ID}/${tab}`;
  return regions.find((region) => region.id === id)?.rect ?? null;
}

function drawDragGhost(ui: Ui, screen: InventoryScreen): void {
  const drag = screen.drag;
  if (drag === null) return;
  const item = drag.item;
  ui.overlay(() => {
    const side = ui.theme.size.slot;
    const at: Point = { x: drag.x, y: drag.y };
    const { ctx } = ui;
    ctx.save();
    ctx.globalAlpha *= GHOST_ALPHA;
    ITEM_ICONS[item.id](ctx, { x: at.x - side / 2, y: at.y - side / 2, w: side, h: side });
    ctx.restore();
  });
}
