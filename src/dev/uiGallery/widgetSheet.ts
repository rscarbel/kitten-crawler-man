/**
 * The widget sheet: every widget, and every input-driven widget in every
 * state (rest, hover, pressed, focused, disabled, selected), laid out top to
 * bottom in whatever width it is given.
 */

import { ITEM_CATEGORIES } from '../../core/ItemDefs';
import { inset, splitH, type Rect } from '../../ui/core/geom';
import type { HitState, Ui } from '../../ui/core/UiRoot';
import { BUTTON_VARIANTS, TEXT_ROLES, type ButtonVariant } from '../../ui/theme/skins';
import { BADGE_TONES, badge, badgeSize } from '../../ui/widgets/badge';
import { button } from '../../ui/widgets/button';
import { card } from '../../ui/widgets/card';
import { costChips, measureCostChips, type CostEntry } from '../../ui/widgets/costChips';
import { iconButton } from '../../ui/widgets/iconButton';
import { itemSlot } from '../../ui/widgets/itemSlot';
import { keycap, keycapSize } from '../../ui/widgets/keycap';
import { listRow, listRowHeight } from '../../ui/widgets/listRow';
import { meter } from '../../ui/widgets/meter';
import { popover } from '../../ui/widgets/popover';
import { searchField } from '../../ui/widgets/searchField';
import { stepper } from '../../ui/widgets/stepper';
import { tabs, type TabItem } from '../../ui/widgets/tabs';
import {
  lineHeightOf,
  measureText,
  measureTextHeight,
  tabularNumber,
  text,
} from '../../ui/widgets/text';
import { tooltip } from '../../ui/widgets/tooltip';
import type { ForcedState, GalleryModel } from './model';

const STATES = ['rest', 'hover', 'pressed', 'focused', 'disabled', 'selected'] as const;
type CellState = (typeof STATES)[number];

const STATE_LABELS: Readonly<Record<CellState, string>> = {
  rest: 'Rest',
  hover: 'Hover',
  pressed: 'Pressed',
  focused: 'Focused',
  disabled: 'Disabled',
  selected: 'Selected',
};

const FORCED: ReadonlySet<CellState> = new Set<CellState>(['hover', 'pressed', 'focused']);

function isForced(state: CellState): state is ForcedState {
  return FORCED.has(state);
}

/** Narrowest a state cell gets before the six states wrap onto more lines. */
const MIN_STATE_CELL = 150;
const MIN_STATE_COLUMNS = 2;
const DISABLED_REASON = 'Not enough coins';
const SECTION_GAP_STEPS = 2;
const METER_TALL = 18;
const POPOVER_W = 220;
const POPOVER_H = 96;
const HP_STEP = 18;
const PROGRESS_VALUE = 7;
const PROGRESS_MAX = 10;
const MANA_VALUE = 34;
const MANA_MAX = 50;
const XP_VALUE = 830;
const XP_MAX = 1000;
const STAMINA_VALUE = 18;
const STAMINA_MAX = 20;
const BOSS_VALUE = 2600;
const BOSS_MAX = 4000;
const HP_LOW_FRACTION = 0.3;
const TABULAR_SAMPLE = '1,240 · 00:59 · 120/120';
/** Sample widths, in multiples of the control size. */
const SEGMENT_CONTROLS = 4;
const METER_CONTROLS = 12;
const METER_BUTTONS_CONTROLS = 6;
const SEARCH_CONTROLS = 9;
const STEPPER_CONTROLS = 13;
const ANCHOR_CONTROLS = 4;
const CARD_SPACING_STEPS = 3;
const UNDERLINE_SAMPLE_CATEGORIES = 5;

interface StateRow {
  readonly key: string;
  readonly title: string;
  readonly height: (ui: Ui) => number;
  /** Draws the cell's widget and returns the state of the region the cell's id names. */
  readonly draw: (
    ui: Ui,
    rect: Rect,
    id: string,
    state: CellState,
    model: GalleryModel,
  ) => HitState;
}

function variantLabel(variant: ButtonVariant): string {
  return variant.charAt(0).toUpperCase() + variant.slice(1);
}

const STATE_ROWS: readonly StateRow[] = [
  ...BUTTON_VARIANTS.map((variant): StateRow => ({
    key: `button-${variant}`,
    title: `button · ${variant}`,
    height: (ui) => ui.theme.size.control,
    draw: (ui, rect, id, state, model) =>
      button(ui, rect, {
        id,
        label: variantLabel(variant),
        variant,
        icon: variant === 'primary' ? 'check' : undefined,
        selected: state === 'selected',
        disabled: state === 'disabled' ? DISABLED_REASON : false,
        onTap: () => model.record(`button ${variant}`),
      }),
  })),
  {
    key: 'iconButton',
    title: 'iconButton',
    height: (ui) => ui.theme.size.control,
    draw: (ui, rect, id, state, model) => {
      const side = ui.theme.size.control;
      const [quiet, raised] = splitH(
        { ...rect, w: side * 2 + ui.theme.space.sm },
        [side, side],
        ui.theme.space.sm,
      );
      const main = iconButton(ui, quiet, {
        id,
        icon: 'bag',
        label: 'Inventory',
        badge: '3',
        selected: state === 'selected',
        disabled: state === 'disabled' ? DISABLED_REASON : false,
        tooltip: false,
        onTap: () => model.record('icon bag'),
      });
      iconButton(ui, raised, {
        id: `${id}-secondary`,
        icon: 'hammer',
        label: 'Build',
        variant: 'secondary',
        selected: state === 'selected',
        disabled: state === 'disabled',
        tooltip: false,
        onTap: () => model.record('icon hammer'),
      });
      return main;
    },
  },
  {
    key: 'listRow',
    title: 'listRow',
    height: (ui) => listRowHeight(ui, true),
    draw: (ui, rect, id, state, model) =>
      listRow(ui, rect, {
        id,
        title: 'Speed Fizz',
        subtitle: 'Consumable',
        leading: { kind: 'item', item: 'speed_fizz' },
        trailing: '60',
        selected: state === 'selected',
        disabled: state === 'disabled' ? DISABLED_REASON : false,
        onTap: () => model.record('row'),
      }),
  },
  {
    key: 'card',
    title: 'card',
    height: (ui) =>
      lineHeightOf(ui, 'overline') +
      lineHeightOf(ui, 'title') +
      lineHeightOf(ui, 'caption') +
      ui.theme.space.md * CARD_SPACING_STEPS,
    draw: (ui, rect, id, state, model) =>
      card(ui, rect, {
        id,
        overline: 'VIP',
        title: 'Steam room',
        accent: ui.theme.palette.accent.base,
        selected: state === 'selected',
        disabled: state === 'disabled' ? DISABLED_REASON : false,
        onTap: () => model.record('card'),
        content: (body) => {
          text(
            ui,
            { ...body, h: lineHeightOf(ui, 'caption') },
            { text: '+20% regen', role: 'caption' },
          );
        },
      }).state,
  },
  {
    key: 'itemSlot',
    title: 'itemSlot',
    height: (ui) => ui.theme.size.slot,
    draw: (ui, rect, id, state, model) => {
      const side = ui.theme.size.slot;
      return itemSlot(
        ui,
        { x: rect.x, y: rect.y, w: side, h: side },
        {
          id,
          item: 'health_potion',
          quantity: 12,
          keycap: '1',
          selected: state === 'selected',
          disabled: state === 'disabled' ? DISABLED_REASON : false,
          onTap: () => model.record('slot'),
        },
      );
    },
  },
];

function sectionTitle(ui: Ui, x: number, y: number, w: number, title: string): number {
  const h = lineHeightOf(ui, 'overline');
  text(ui, { x, y, w, h }, { text: title, role: 'overline', color: ui.theme.palette.accent.base });
  return h + ui.theme.space.sm;
}

function drawStateGrid(ui: Ui, area: Rect, y: number, model: GalleryModel): number {
  const { space } = ui.theme;
  const columns = Math.max(
    MIN_STATE_COLUMNS,
    Math.min(STATES.length, Math.floor(area.w / MIN_STATE_CELL)),
  );
  const lines = Math.ceil(STATES.length / columns);
  const captionH = lineHeightOf(ui, 'muted');
  let cursor = y;
  for (const row of STATE_ROWS) {
    cursor += sectionTitle(ui, area.x, cursor, area.w, row.title);
    const cellH = captionH + space.xs + row.height(ui);
    const cellW = (area.w - space.lg * (columns - 1)) / columns;
    const cellAt = (index: number): Rect => ({
      x: area.x + (index % columns) * (cellW + space.lg),
      y: cursor + Math.floor(index / columns) * (cellH + space.lg),
      w: cellW,
      h: cellH,
    });
    STATES.forEach((state, index) => {
      const cell = cellAt(index);
      text(ui, { ...cell, h: captionH }, { text: STATE_LABELS[state], role: 'muted' });
      const widgetRect: Rect = {
        x: cell.x,
        y: cell.y + captionH + space.xs,
        w: cell.w,
        h: row.height(ui),
      };
      const id = `${row.key}-${state}`;
      const hitState = row.draw(ui, widgetRect, id, state, model);
      if (hitState.focused) model.focusedWidget = id;
      if (isForced(state)) model.cells.push({ widgetId: id, state, rect: inset(cell, -space.sm) });
    });
    cursor += lines * cellH + (lines - 1) * space.lg + space.xl;
  }
  return cursor - y;
}

const SEGMENTED_TABS: readonly TabItem[] = [
  { id: 'bag', label: 'Bag', icon: 'bag' },
  { id: 'character', label: 'Character', icon: 'users' },
  { id: 'crafts', label: 'Crafts', icon: 'hammer', badge: '2' },
  { id: 'locked', label: 'Locked', icon: 'lock', disabled: 'Reach floor 3' },
];

const UNDERLINE_TABS: readonly TabItem[] = [
  { id: 'all', label: 'All' },
  ...ITEM_CATEGORIES.slice(0, UNDERLINE_SAMPLE_CATEGORIES).map((category) => ({
    id: category,
    label: category.charAt(0).toUpperCase() + category.slice(1),
  })),
];

const COSTS: readonly CostEntry[] = [
  { label: 'Boards', have: 12, need: 30, item: 'wood_board' },
  { label: 'Rope', have: 15, need: 15, item: 'rope' },
  { label: 'Stone', have: 41, need: 20, item: 'stone' },
  { label: 'Coins', have: 1240, need: 300, glyph: 'coin' },
  { label: 'Gears', have: 0, need: 2 },
];

/** Draws the whole sheet into `area` and returns its height. */
export function renderWidgetSheet(ui: Ui, area: Rect, model: GalleryModel): number {
  const { space, size, palette } = ui.theme;
  const sectionGap = space.xl * SECTION_GAP_STEPS;
  model.cells.length = 0;
  model.focusedWidget = null;
  let y = area.y;

  const headingH = lineHeightOf(ui, 'display');
  text(ui, { x: area.x, y, w: area.w, h: headingH }, { text: 'Widget gallery', role: 'display' });
  y += headingH;
  const leadH = measureTextHeight(ui, area.w, {
    text: 'Every widget in every state. Tap anything.',
    role: 'secondary',
  });
  text(
    ui,
    { x: area.x, y, w: area.w, h: leadH },
    {
      text: `Every widget in every state. ${model.lastAction}.`,
      role: 'secondary',
      wrap: true,
    },
  );
  y += leadH + sectionGap / 2;

  y += drawStateGrid(ui, area, y, model);
  y += space.xl;

  y += sectionTitle(ui, area.x, y, area.w, 'tabs');
  const tabW = Math.min(area.w, size.control * SEGMENTED_TABS.length * SEGMENT_CONTROLS);
  tabs(
    ui,
    { x: area.x, y, w: tabW, h: size.control + space.xs },
    {
      id: 'tabs-segmented',
      items: SEGMENTED_TABS,
      selected: model.segmented,
      onSelect: (id) => {
        model.segmented = id;
      },
    },
  );
  y += size.control + space.xs + space.lg;
  tabs(
    ui,
    { x: area.x, y, w: area.w, h: size.control },
    {
      id: 'tabs-underline',
      variant: 'underline',
      items: UNDERLINE_TABS,
      selected: model.underline,
      onSelect: (id) => {
        model.underline = id;
      },
    },
  );
  y += size.control + sectionGap;

  y += sectionTitle(ui, area.x, y, area.w, 'meter');
  const meterW = Math.min(area.w, size.control * METER_CONTROLS);
  const [hitCell, healCell] = splitH(
    { x: area.x, y, w: Math.min(area.w, size.control * METER_BUTTONS_CONTROLS), h: size.control },
    ['fill', 'fill'],
    space.sm,
  );
  button(ui, hitCell, {
    id: 'meter-hit',
    label: 'Take hit',
    variant: 'danger',
    size: 'sm',
    onTap: () => {
      model.hp = Math.max(0, model.hp - HP_STEP);
    },
  });
  button(ui, healCell, {
    id: 'meter-heal',
    label: 'Heal',
    variant: 'success',
    size: 'sm',
    onTap: () => {
      model.hp = Math.min(model.hpMax, model.hp + HP_STEP);
    },
  });
  y += size.control + space.md;
  const meters: readonly (Parameters<typeof meter>[2] & { tall?: boolean })[] = [
    {
      id: 'm-hp',
      kind: 'hp',
      value: model.hp,
      max: model.hpMax,
      lowBelow: HP_LOW_FRACTION,
      label: 'HP',
      valueText: true,
      tall: true,
    },
    {
      id: 'm-mana',
      kind: 'mana',
      value: MANA_VALUE,
      max: MANA_MAX,
      label: 'Mana',
      valueText: true,
      tall: true,
    },
    {
      id: 'm-boss',
      kind: 'boss',
      value: BOSS_VALUE,
      max: BOSS_MAX,
      label: 'The Juicer',
      valueText: '65%',
      tall: true,
    },
    { id: 'm-xp', kind: 'xp', value: XP_VALUE, max: XP_MAX },
    { id: 'm-stamina', kind: 'stamina', value: STAMINA_VALUE, max: STAMINA_MAX },
    { id: 'm-progress', kind: 'progress', value: PROGRESS_VALUE, max: PROGRESS_MAX },
  ];
  for (const m of meters) {
    const h = m.tall === true ? METER_TALL : space.sm;
    meter(ui, { x: area.x, y, w: meterW, h }, m);
    y += h + space.md;
  }
  y += sectionGap - space.md;

  y += sectionTitle(ui, area.x, y, area.w, 'badge · keycap');
  let x = area.x;
  const badgeRowH = size.control;
  const place = (w: number): Rect => {
    if (x + w > area.x + area.w) {
      x = area.x;
      y += badgeRowH;
    }
    const r: Rect = { x, y, w, h: badgeRowH };
    x += w + space.sm;
    return r;
  };
  for (const tone of BADGE_TONES) {
    const label = tone === 'danger' ? '9+' : '3';
    badge(ui, place(badgeSize(ui, { label }).w), { label, tone });
  }
  badge(ui, place(badgeSize(ui, { label: 'New', kind: 'tag' }).w), { label: 'New', kind: 'tag' });
  for (const category of ITEM_CATEGORIES) {
    badge(ui, place(badgeSize(ui, { label: category, kind: 'tag' }).w), {
      label: category,
      kind: 'tag',
      color: palette.category[category],
    });
  }
  for (const key of ['E', 'Space', 'Esc', 'Shift', '1']) {
    keycap(ui, place(keycapSize(ui, { label: key }).w), { label: key });
  }
  keycap(ui, place(keycapSize(ui, { label: 'F' }).w), { label: 'F', pressed: true });
  y += badgeRowH + sectionGap;
  x = area.x;

  y += sectionTitle(ui, area.x, y, area.w, 'costChips');
  const chips = measureCostChips(ui, COSTS, area.w);
  costChips(ui, { x: area.x, y, w: area.w, h: chips.h }, { costs: COSTS });
  y += chips.h + sectionGap;

  y += sectionTitle(ui, area.x, y, area.w, 'searchField · stepper');
  const fieldW = Math.min(area.w, size.control * SEARCH_CONTROLS);
  searchField(
    ui,
    { x: area.x, y, w: fieldW, h: size.control },
    {
      id: 'search-empty',
      input: model.sheetSearch,
      placeholder: 'Search items',
    },
  );
  y += size.control + space.md;
  searchField(
    ui,
    { x: area.x, y, w: fieldW, h: size.control },
    {
      id: 'search-typed',
      input: model.typedSearch,
    },
  );
  y += size.control + space.md;
  stepper(
    ui,
    { x: area.x, y, w: Math.min(area.w, size.control * STEPPER_CONTROLS), h: size.control },
    {
      id: 'stepper',
      state: model.quantity,
    },
  );
  y += size.control + space.xs;
  tabularNumber(
    ui,
    { x: area.x, y, w: area.w, h: lineHeightOf(ui, 'caption') },
    {
      value: `Total ${model.quantity.cost ?? 0} coins`,
      role: 'caption',
    },
  );
  y += lineHeightOf(ui, 'caption') + sectionGap;

  y += sectionTitle(ui, area.x, y, area.w, 'tooltip · popover');
  const anchorW = Math.min(area.w / 2 - space.sm, size.control * ANCHOR_CONTROLS);
  const tipAnchor: Rect = { x: area.x, y: y + POPOVER_H, w: anchorW, h: size.control };
  button(ui, tipAnchor, {
    id: 'tip-anchor',
    label: 'Hover me',
    onTap: () => model.record('tooltip anchor'),
  });
  tooltip(ui, tipAnchor, {
    id: 'tip-forced',
    title: 'Speed Fizz',
    accent: palette.category.consumable,
    text: 'Doubles movement speed for 25 seconds.',
    lines: [{ text: 'Consumable · stack 3', role: 'muted' }],
    placement: 'below',
    show: true,
    immediate: true,
  });
  const popAnchor: Rect = {
    x: area.x + area.w - anchorW,
    y: tipAnchor.y,
    w: anchorW,
    h: size.control,
  };
  button(ui, popAnchor, {
    id: 'pop-anchor',
    label: 'Watchtower',
    icon: 'hammer',
    onTap: () => model.record('popover anchor'),
  });
  popover(ui, {
    id: 'popover',
    anchor: popAnchor,
    w: POPOVER_W,
    h: POPOVER_H,
    placement: 'above',
    draw: (body) => {
      const titleH = lineHeightOf(ui, 'label');
      text(ui, { ...body, h: titleH }, { text: 'Watchtower · Tier 2', role: 'label' });
      button(
        ui,
        { x: body.x, y: body.y + body.h - size.control, w: body.w, h: size.control },
        {
          id: 'popover-upgrade',
          label: 'Upgrade',
          variant: 'primary',
          size: 'sm',
          onTap: () => model.record('popover upgrade'),
        },
      );
    },
  });
  y += POPOVER_H * 2 + size.control + sectionGap;

  y += sectionTitle(ui, area.x, y, area.w, 'text');
  for (const role of TEXT_ROLES.filter((candidate) => candidate !== 'inverse')) {
    const h = lineHeightOf(ui, role);
    const label = `${role} — The crawl is live`;
    text(ui, { x: area.x, y, w: area.w, h }, { text: label, role });
    y += h + space.xs;
  }
  const tabularH = lineHeightOf(ui, 'title');
  tabularNumber(
    ui,
    {
      x: area.x,
      y,
      w: measureText(ui, TABULAR_SAMPLE, { role: 'title', tabular: true }),
      h: tabularH,
    },
    {
      value: TABULAR_SAMPLE,
      role: 'title',
    },
  );
  y += tabularH + space.xl;

  return y - area.y;
}
