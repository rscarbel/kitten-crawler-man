/**
 * The one shop screen: every vendor, tavern, temple, stall, the general store
 * and the Anchor's destinations draw through it. A header with the counter's
 * name, the seller's line and the party's purse; Buy / Sell tabs when the
 * counter buys back; a scrolling list of rows, each with its picture, a
 * one-line description, a price chip and a Buy button that says why when it
 * cannot be pressed. Selling a stack asks how many first.
 *
 * An item row priced by the engine carries a tag beside its price when stock
 * is moving it ("Low stock", "Overstocked") and, selling, when the shop buys
 * that kind of goods at its specialty rate. Under `?prices` the selected row
 * also shows the engine's working, step by step.
 *
 * Halts the world and keeps the keyboard while open; a tap outside it, Close,
 * Escape and ✕ all close it. A bare accept press closes it too, unless an
 * affordable quest row is on the menu, which then takes that press.
 */

import { partyCoins } from '../../../core/partyCoins';
import { costShortfall, formatCost } from '../../../core/partyResources';
import { ITEM_DEF, isItemId, type ItemId } from '../../../core/ItemDefs';
import { centerIn, inset, splitH, splitV, type Rect } from '../../core/geom';
import { UI_ERROR_SOUND, type Surface, type Ui } from '../../core/UiRoot';
import { UiStateSlot } from '../../core/uiState';
import type { PriceQuote, StockTag } from '../../../economy/pricing';
import { QuantityPickerState } from '../../QuantityPickerState';
import { button, buttonHeight, measureButton } from '../../widgets/button';
import {
  listRow,
  listRowHeight,
  listRowTextWidth,
  listRowTagLineHeight,
  listRowTagLines,
  listRowTrailingMax,
  type RowLeading,
  type RowTag,
} from '../../widgets/listRow';
import { drawGlass } from '../../widgets/paint';
import { panel, panelBodyMaxHeight, panelBodyWidth, type PanelOptions } from '../../widgets/panel';
import { scrollGutterWidth, scrollView, scrollViewScrolls } from '../../widgets/scrollView';
import { stepper, stepperKey } from '../../widgets/stepper';
import { tabs, type TabItem } from '../../widgets/tabs';
import { lineHeightOf, measureTextHeight, text, tabularNumber } from '../../widgets/text';
import { priceBreakdownsShown } from './priceBreakdowns';
import { skinsFor } from '../../theme/skins';
import type { PanelWidth } from '../../theme/tokens';
import {
  coinPurse,
  measureCoinPurse,
  measurePriceChip,
  priceChip,
  refusableButton,
  sellerLine,
  type PriceTone,
} from './shopParts';
import {
  shopRowEnabled,
  type SellRow,
  type ShopMenu,
  type ShopMode,
  type ShopParty,
  type ShopRow,
  type ShopSession,
} from './shopSession';

export interface ShopScreenOptions {
  /** Unique per scene. */
  readonly id: string;
  readonly session: ShopSession;
  /** Who pays and who stands beside them, read every frame. */
  readonly party: () => ShopParty;
  /** Runs after the session closes, for a host that tidies up after the counter. */
  readonly onClose?: () => void;
  /** Whether the selected row shows its price working; the `?prices` dev flag when omitted. */
  readonly showPriceBreakdowns?: () => boolean;
}

const SHOP_TABS: readonly TabItem[] = [
  { id: 'buy', label: 'Buy' },
  { id: 'sell', label: 'Sell' },
];

const SHOP_PANEL_WIDTH = 'md' as const satisfies PanelWidth;
const BUY_LABEL = 'Buy';
const SELL_LABEL = 'Sell';
const CLOSE_LABEL = 'Close';
const NOTHING_TO_SELL = "Nothing here you're able to sell.";
/** The seller's line wraps to at most this many lines before it is cut short. */
const SELLER_LINE_MAX_LINES = 2;
/** The longest price a row is laid out for, so every row's chip and button line up. */
const PRICE_LAYOUT_SAMPLE = '9,999';
/** Any one of these makes a row the widest it gets; they size the shared Buy column. */
const ACTION_LABEL_SAMPLES = [BUY_LABEL, SELL_LABEL] as const;

const STOCK_TAGS = {
  low_stock: { label: 'Low stock', tone: 'warning' },
  overstocked: { label: 'Overstocked', tone: 'info' },
} as const satisfies Record<StockTag, RowTag>;
const SPECIALTY_TAG = { label: 'Specialty', tone: 'success' } as const satisfies RowTag;
/** How many decimals a breakdown's multipliers and running totals show. */
const BREAKDOWN_DECIMALS = 2;

/** Which row's working `?prices` shows, per tab; null until a row is tapped, which shows the first. */
const PRICE_SELECTION = new UiStateSlot<string | null>('shop-price-selection', () => null);

interface QuantityPrompt {
  readonly id: ItemId;
  readonly picker: QuantityPickerState;
}

/** What a row's chip says, and how it reads. */
function priceFor(
  row: ShopRow,
  unpriced: boolean,
  affordable: boolean,
): { label: string; tone: PriceTone; withCoin: boolean } | null {
  if (unpriced) return null;
  if (row.unavailable !== undefined)
    return { label: row.unavailable, tone: 'muted', withCoin: false };
  return {
    label: row.price.toLocaleString('en-US'),
    tone: affordable ? 'normal' : 'danger',
    withCoin: true,
  };
}

function leadingFor(menu: ShopMenu, row: ShopRow): RowLeading | undefined {
  if (row.icon !== undefined) {
    return row.icon.kind === 'item'
      ? { kind: 'item', item: row.icon.item }
      : { kind: 'glyph', glyph: row.icon.glyph };
  }
  if (isItemId(row.key)) return { kind: 'item', item: row.key };
  return menu.rowGlyph === undefined ? undefined : { kind: 'glyph', glyph: menu.rowGlyph };
}

/**
 * A row as its leading picture and trailing column see it: without the tag
 * lines reserved under its subtitle, which leave both their usual size.
 */
function untaggedRow(ui: Ui, row: Rect, tagLines: number): Rect {
  return { ...row, h: row.h - listRowTagLineHeight(ui) * tagLines };
}

/** What is left of `cell` under `row`, a strip at its top. */
function cellBelow(cell: Rect, row: Rect): Rect {
  return { ...cell, y: row.y + row.h, h: cell.h - row.h };
}

/** The tags beside a row's price: why stock moves it, then the specialty rate. */
function tagsFor(quote: PriceQuote | undefined): RowTag[] {
  if (quote === undefined) return [];
  const tags: RowTag[] = [];
  if (quote.stockTag !== null) tags.push(STOCK_TAGS[quote.stockTag]);
  if (quote.specialty) tags.push(SPECIALTY_TAG);
  return tags;
}

function formatAmount(amount: number): string {
  return amount.toLocaleString('en-US', { maximumFractionDigits: BREAKDOWN_DECIMALS });
}

/** The engine's working as lines: base, each step with its multiplier and running total, final. */
function breakdownLines(quote: PriceQuote): string[] {
  const { base, steps, final } = quote.breakdown;
  return [
    `Base ${formatAmount(base)}`,
    ...steps.map(
      (step) =>
        `${step.label}  ×${formatAmount(step.multiplier)} → ${formatAmount(step.runningTotal)}`,
    ),
    `Final ${formatAmount(final)}`,
  ];
}

function breakdownHeight(ui: Ui, quote: PriceQuote | undefined): number {
  if (quote === undefined) return 0;
  return lineHeightOf(ui, 'caption') * breakdownLines(quote).length + ui.theme.space.sm;
}

/**
 * Draws the working in `block` (the strip a selected row grows by), lined
 * up under the row's description.
 */
function renderBreakdown(
  ui: Ui,
  rowRect: Rect,
  block: Rect,
  leading: RowLeading | undefined,
  quote: PriceQuote,
): void {
  const { space } = ui.theme;
  const textW = listRowTextWidth(ui, rowRect, { leading });
  const left = rowRect.x + rowRect.w - space.md - textW;
  const lines = breakdownLines(quote);
  const lineH = lineHeightOf(ui, 'caption');
  const area: Rect = { x: left, y: block.y, w: textW, h: lineH * lines.length };
  const cells = splitV(
    area,
    lines.map(() => lineH),
    0,
  );
  lines.forEach((line, index) => {
    text(ui, cells[index], {
      text: line,
      role: index === lines.length - 1 ? 'caption' : 'muted',
      tabular: true,
    });
  });
}

/** Why a row's Buy cannot be pressed, or null when it can. */
function buyRefusal(row: ShopRow, unpriced: boolean, party: ShopParty): string | null {
  if (row.unavailable !== undefined) return row.unavailable;
  if (shopRowEnabled(row, unpriced, party)) return null;
  const coinsShort = row.price - partyCoins(party.active, party.companion);
  if (coinsShort > 0 || row.materials === undefined) {
    return `${coinsShort.toLocaleString('en-US')} more coins needed`;
  }
  const materialsShort = costShortfall(party.active, party.companion, row.materials);
  return `${formatCost(materialsShort)} more needed`;
}

/**
 * The shop screen as a surface. Mount it once per scene; it is open while
 * the session is.
 */
export function shopScreenSurface(opts: ShopScreenOptions): Surface {
  const { session } = opts;
  const breakdownsShown = opts.showPriceBreakdowns ?? priceBreakdownsShown;
  let prompt: QuantityPrompt | null = null;
  let promptGeneration = -1;

  const close = (): void => {
    prompt = null;
    session.close();
    opts.onClose?.();
  };

  const currentPrompt = (): QuantityPrompt | null => {
    if (promptGeneration !== session.generation || session.mode !== 'sell') prompt = null;
    return prompt;
  };

  const askQuantity = (row: SellRow): void => {
    promptGeneration = session.generation;
    prompt = {
      id: row.id,
      picker: new QuantityPickerState({ max: row.held, initial: 1 }),
    };
  };

  const sellNow = (id: ItemId, quantity: number): void => {
    session.sell(id, quantity, opts.party().active);
    prompt = null;
  };

  return {
    id: opts.id,
    band: 'modal',
    haltsWorld: true,
    locksKeyboard: true,
    isOpen: () => session.isOpen,
    close,
    onKey: (key) => {
      const open = currentPrompt();
      if (open === null) return false;
      return stepperKey(open.picker, key);
    },
    render: (ui) => {
      const menu = session.currentMenu;
      if (menu === null) return;
      const party = opts.party();
      renderShop(ui, {
        id: opts.id,
        session,
        menu,
        party,
        close,
        breakdowns: breakdownsShown(),
        onSellRow: (row) => {
          if (row.held > 1) askQuantity(row);
          else sellNow(row.id, 1);
        },
      });
      const open = currentPrompt();
      if (open !== null) {
        renderQuantityPrompt(ui, {
          id: `${opts.id}/qty`,
          prompt: open,
          quote: (quantity) => session.sellQuote(open.id, quantity),
          onCancel: () => {
            prompt = null;
          },
          onConfirm: () => sellNow(open.id, open.picker.value),
        });
      }
    },
  };
}

interface RenderShopArgs {
  readonly id: string;
  readonly session: ShopSession;
  readonly menu: ShopMenu;
  readonly party: ShopParty;
  readonly close: () => void;
  readonly breakdowns: boolean;
  readonly onSellRow: (row: SellRow) => void;
}

/** A row as `?prices` sees it: the key it is selected by and the working it shows. */
interface PricedRow {
  readonly key: string;
  readonly quote?: PriceQuote;
}

function selectionId(args: RenderShopArgs, mode: ShopMode): string {
  return `${args.id}/price-${mode}`;
}

/** The row whose working shows: the one last tapped, else the first with any; null when breakdowns are off. */
function selectedPricedRow(
  ui: Ui,
  args: RenderShopArgs,
  mode: ShopMode,
  rows: readonly PricedRow[],
): PricedRow | null {
  if (!args.breakdowns) return null;
  const chosen = ui.state(PRICE_SELECTION, selectionId(args, mode));
  const priced = rows.filter((row) => row.quote !== undefined);
  const first = priced.length > 0 ? priced[0] : null;
  return priced.find((row) => row.key === chosen) ?? first;
}

/** The tap that selects a row for `?prices`, or none when breakdowns are off or the row has no working. */
function selectTap(
  ui: Ui,
  args: RenderShopArgs,
  mode: ShopMode,
  row: PricedRow,
): (() => void) | undefined {
  if (!args.breakdowns || row.quote === undefined) return undefined;
  return () => ui.setState(PRICE_SELECTION, selectionId(args, mode), row.key);
}

/** Each row's height: the shared row height, plus the working's strip under the selected row. */
function rowHeights(
  ui: Ui,
  rows: readonly PricedRow[],
  rowH: number,
  selected: PricedRow | null,
): number[] {
  return rows.map((row) =>
    row.key === selected?.key ? rowH + breakdownHeight(ui, row.quote) : rowH,
  );
}

function sellLeading(row: SellRow): RowLeading {
  return { kind: 'item', item: row.id };
}

/**
 * How many lines of tags every row reserves under its subtitle: none where
 * the tags sit beside the subtitle, else as many as the most-tagged row needs
 * at the width the rows are drawn, so no tag is lost to a narrow screen.
 */
function tagLinesFor(
  ui: Ui,
  args: RenderShopArgs,
  opts: {
    readonly listW: number;
    readonly mode: ShopMode;
    readonly unpriced: boolean;
    readonly baseRowH: number;
    readonly rows: readonly {
      readonly quote: PriceQuote | undefined;
      readonly leading: RowLeading | undefined;
    }[];
  },
): number {
  if (ui.size !== 'compact') return 0;
  const rowRect: Rect = { x: 0, y: 0, w: opts.listW, h: opts.baseRowH };
  const actionLabel =
    opts.mode === 'sell' ? SELL_LABEL : (args.menu.unpriced?.actionLabel ?? BUY_LABEL);
  const statuses =
    opts.mode === 'sell'
      ? []
      : args.menu.options.flatMap((row) =>
          row.unavailable === undefined ? [] : [row.unavailable],
        );
  const trailingWidth = trailingLayout(ui, rowRect, !opts.unpriced, actionLabel, statuses).total;
  const linesPerRow = opts.rows.map((row) =>
    listRowTagLines(
      ui,
      listRowTextWidth(ui, rowRect, { leading: row.leading, trailingWidth }),
      tagsFor(row.quote),
    ),
  );
  return Math.max(0, ...linesPerRow);
}

function sellPricedRows(rows: readonly SellRow[]): PricedRow[] {
  return rows.map((row) => ({ key: row.id, quote: row.quote }));
}

function renderShop(ui: Ui, args: RenderShopArgs): void {
  const { session, menu, party } = args;
  const { space } = ui.theme;
  const sellable = session.sellConfig !== null;
  const mode: ShopMode = sellable ? session.mode : 'buy';
  const unpriced = menu.unpriced !== undefined && mode === 'buy';
  const questRow = session.questDefaultRow(party);
  const sellRows = mode === 'sell' ? session.sellRows(party.active) : [];
  const rowCount =
    mode === 'sell' ? Math.max(1, sellRows.length) : Math.max(1, menu.options.length);
  const pricedRows: readonly PricedRow[] =
    mode === 'sell' ? sellPricedRows(sellRows) : menu.options;
  const selected = selectedPricedRow(ui, args, mode, pricedRows);
  const breakdownH = selected === null ? 0 : breakdownHeight(ui, selected.quote);
  const compact = ui.size === 'compact';
  const lineLines = compact ? 1 : SELLER_LINE_MAX_LINES;
  const lineH = lineHeightOf(ui, 'body') * lineLines;
  const purseBesideTabs = compact && sellable;
  const tabsH = sellable ? ui.theme.size.control : 0;
  const headerTracks: number[] = [lineH, ...(sellable ? [tabsH] : [])];
  const headerH = headerTracks.reduce((sum, h) => sum + h, 0) + space.md * headerTracks.length;
  const tagRows =
    mode === 'sell'
      ? sellRows.map((row) => ({ quote: row.quote, leading: sellLeading(row) }))
      : menu.options.map((row) => ({ quote: row.quote, leading: leadingFor(menu, row) }));
  const rowLayoutAt = (
    listW: number,
  ): { rowH: number; tagLines: number; contentHeight: number } => {
    const baseRowH =
      mode === 'buy' ? buyRowHeight(ui, menu, unpriced, listW) : listRowHeight(ui, true);
    const tagLines = tagLinesFor(ui, args, { listW, mode, unpriced, baseRowH, rows: tagRows });
    const rowH = baseRowH + listRowTagLineHeight(ui) * tagLines;
    return { rowH, tagLines, contentHeight: headerH + rowCount * rowH + breakdownH };
  };

  const frame: Pick<PanelOptions, 'title' | 'subtitle' | 'width' | 'onClose' | 'footer'> = {
    title: menu.title,
    subtitle: menu.byline,
    width: SHOP_PANEL_WIDTH,
    onClose: args.close,
    footer: compact
      ? []
      : [
          {
            id: 'leave',
            label: CLOSE_LABEL,
            variant: 'secondary',
            primary: questRow === null,
            onTap: args.close,
          },
        ],
  };
  // The list's scroll view narrows its rows by a gutter once it scrolls, so
  // wrapping is measured at that narrower width whenever the rows overflow.
  const fullListW = panelBodyWidth(ui, SHOP_PANEL_WIDTH);
  const unscrolled = rowLayoutAt(fullListW);
  const listScrolls = scrollViewScrolls(unscrolled.contentHeight, panelBodyMaxHeight(ui, frame));
  const { rowH, tagLines, contentHeight } = listScrolls
    ? rowLayoutAt(fullListW - scrollGutterWidth(ui))
    : unscrolled;

  const p = panel(ui, {
    ...frame,
    id: args.id,
    height: 'content',
    contentHeight,
    onScrimTap: args.close,
  });

  const [lineRow, ...rest] = splitV(p.body, [...headerTracks, 'fill'], space.md);
  const tabsRect = sellable ? rest[0] : null;
  const listRect = sellable ? rest[1] : rest[0];

  let lineRect = lineRow;
  if (menu.titleIcon !== undefined) {
    const side = Math.min(lineRow.h, ui.theme.size.slot);
    menu.titleIcon(ui.ctx, centerIn({ ...lineRow, w: side }, side, side));
    lineRect = inset(lineRect, { l: side + space.sm });
  }
  let tabsArea = tabsRect ?? null;
  if (menu.unpriced === undefined) {
    const coins = partyCoins(party.active, party.companion);
    const purseW = measureCoinPurse(ui, coins);
    const purseRow = purseBesideTabs && tabsArea !== null ? tabsArea : lineRect;
    coinPurse(ui, { ...purseRow, x: purseRow.x + purseRow.w - purseW, w: purseW }, coins);
    if (purseRow === lineRect) lineRect = inset(lineRect, { r: purseW + space.md });
    else if (tabsArea !== null) tabsArea = inset(tabsArea, { r: purseW + space.md });
  }
  sellerLine(ui, lineRect, {
    line: session.currentLine,
    strength: session.feedbackStrength,
    maxLines: lineLines,
  });

  if (tabsArea !== null) {
    tabs(ui, tabsArea, {
      id: `${args.id}/tabs`,
      items: SHOP_TABS,
      selected: mode,
      onSelect: (tab) => session.setMode(tab === 'sell' ? 'sell' : 'buy'),
    });
  }

  if (mode === 'sell') {
    renderSellList(ui, listRect, args, sellRows, { rowH, selected, tagLines });
  } else {
    renderBuyList(ui, listRect, args, { unpriced, questRow, rowH, selected, tagLines });
  }
}

interface TrailingLayout {
  readonly chipW: number;
  readonly buttonW: number;
  readonly total: number;
  /** Whether a row's status fits in the chip column; one that does not reads as its subtitle. */
  readonly statusFits: (status: string) => boolean;
}

/**
 * The width a row's trailing chip and button need, shared by every row so the
 * columns line up. The chip column widens for a status only as far as the row
 * can spare, so the button is never pushed past the row's edge on a phone.
 */
function trailingLayout(
  ui: Ui,
  rowRect: Rect,
  withChip: boolean,
  actionLabel: string,
  statuses: readonly string[] = [],
): TrailingLayout {
  const { space } = ui.theme;
  const maxTotal = listRowTrailingMax(ui, rowRect, true);
  const buttonW = Math.max(
    ...[...ACTION_LABEL_SAMPLES, actionLabel].map((label) =>
      measureButton(ui, { label, size: 'sm' }),
    ),
  );
  if (!withChip) {
    return { chipW: 0, buttonW, total: buttonW, statusFits: () => false };
  }
  const gap = space.sm;
  const maxChipW = maxTotal - gap - buttonW;
  const priceW = measurePriceChip(ui, PRICE_LAYOUT_SAMPLE, true);
  const statusWidth = (status: string): number => measurePriceChip(ui, status, false);
  const statusFits = (status: string): boolean => statusWidth(status) <= maxChipW;
  const chipW = Math.max(priceW, ...statuses.filter(statusFits).map(statusWidth));
  return { chipW, buttonW, total: chipW + gap + buttonW, statusFits };
}

/**
 * One height for every buy row: a single line of description, or, for a menu
 * that lets its descriptions wrap, as many lines as the longest one needs at
 * the list's drawn width, up to {@link ShopMenu.descLines}.
 */
function buyRowHeight(ui: Ui, menu: ShopMenu, unpriced: boolean, listW: number): number {
  const maxLines = menu.descLines ?? 1;
  if (maxLines <= 1) return listRowHeight(ui, true);
  const singleLineRow: Rect = { x: 0, y: 0, w: listW, h: listRowHeight(ui, true) };
  const actionLabel = menu.unpriced?.actionLabel ?? BUY_LABEL;
  const statuses = menu.options.flatMap((row) =>
    row.unavailable === undefined ? [] : [row.unavailable],
  );
  const trailingWidth = trailingLayout(ui, singleLineRow, !unpriced, actionLabel, statuses).total;
  const captionH = lineHeightOf(ui, 'caption');
  const linesNeeded = menu.options.map((row) => {
    const width = listRowTextWidth(ui, singleLineRow, {
      leading: leadingFor(menu, row),
      trailingWidth,
    });
    return Math.ceil(measureTextHeight(ui, width, { text: row.desc, role: 'caption' }) / captionH);
  });
  return listRowHeight(ui, true, Math.min(maxLines, Math.max(1, ...linesNeeded)));
}

function renderBuyList(
  ui: Ui,
  rect: Rect,
  args: RenderShopArgs,
  opts: {
    readonly unpriced: boolean;
    readonly questRow: ShopRow | null;
    readonly rowH: number;
    readonly selected: PricedRow | null;
    readonly tagLines: number;
  },
): void {
  const { menu, party, session } = args;
  const { palette } = ui.theme;
  const actionLabel = menu.unpriced?.actionLabel ?? BUY_LABEL;
  const rows = menu.options;
  const statuses = rows.flatMap((row) => (row.unavailable === undefined ? [] : [row.unavailable]));
  const heights = rowHeights(ui, rows, opts.rowH, opts.selected);
  const listHeight = heights.reduce((sum, h) => sum + h, 0);
  scrollView(ui, rect, {
    id: `${args.id}/rows-buy`,
    contentHeight: listHeight,
    draw: (content) => {
      const layoutRow = untaggedRow(ui, { ...content, h: opts.rowH }, opts.tagLines);
      const layout = trailingLayout(ui, layoutRow, !opts.unpriced, actionLabel, statuses);
      const cells = splitV({ ...content, h: listHeight }, heights, 0);
      rows.forEach((row, index) => {
        const cell: Rect = { ...cells[index], h: opts.rowH };
        const leading = leadingFor(menu, row);
        const isSelected = row.key === opts.selected?.key;
        const refusal = buyRefusal(row, opts.unpriced, party);
        const isQuestDefault = opts.questRow?.key === row.key;
        const status = row.unavailable;
        const statusInChip = status !== undefined && layout.statusFits(status);
        const subtitle = status !== undefined && !statusInChip ? status : row.desc;
        listRow(ui, cell, {
          id: `${args.id}/row-${row.key}`,
          title: row.label,
          subtitle,
          subtitleLines: menu.descLines,
          leading,
          tags: tagsFor(row.quote),
          tagLines: opts.tagLines,
          selected: isSelected,
          onTap: selectTap(ui, args, 'buy', row),
          accent: row.isQuestItem === true ? palette.category.quest : undefined,
          trailingWidth: layout.total,
          trailingContent: (trailing) => {
            const [chipCell, buttonCell] = splitH(
              trailing,
              opts.unpriced ? [0, layout.buttonW] : [layout.chipW, layout.buttonW],
              opts.unpriced ? 0 : ui.theme.space.sm,
            );
            const coinsCovered = partyCoins(party.active, party.companion) >= row.price;
            const price = priceFor(row, opts.unpriced, coinsCovered);
            const chipShowsPrice = status === undefined || statusInChip;
            if (price !== null && chipShowsPrice) priceChip(ui, chipCell, price);
            refusableButton(ui, buttonCell, {
              id: `${args.id}/buy-${row.key}`,
              label: actionLabel,
              refusal,
              variant: isQuestDefault ? 'primary' : 'secondary',
              primary: isQuestDefault,
              sound: session.soundsOwnRefusal ? null : UI_ERROR_SOUND,
              onTap: () => session.tryBuy(row, party),
            });
          },
        });
        if (isSelected && row.quote !== undefined) {
          renderBreakdown(
            ui,
            { ...cell, h: layoutRow.h },
            cellBelow(cells[index], cell),
            leading,
            row.quote,
          );
        }
      });
    },
  });
}

function renderSellList(
  ui: Ui,
  rect: Rect,
  args: RenderShopArgs,
  rows: readonly SellRow[],
  opts: {
    readonly rowH: number;
    readonly selected: PricedRow | null;
    readonly tagLines: number;
  },
): void {
  const { rowH } = opts;
  if (rows.length === 0) {
    text(ui, { ...rect, h: rowH }, { text: NOTHING_TO_SELL, role: 'muted', align: 'center' });
    return;
  }
  const pricedRows = sellPricedRows(rows);
  const heights = rowHeights(ui, pricedRows, rowH, opts.selected);
  const listHeight = heights.reduce((sum, h) => sum + h, 0);
  scrollView(ui, rect, {
    id: `${args.id}/rows-sell`,
    contentHeight: listHeight,
    draw: (content) => {
      const layoutRow = untaggedRow(ui, { ...content, h: rowH }, opts.tagLines);
      const layout = trailingLayout(ui, layoutRow, true, SELL_LABEL);
      const cells = splitV({ ...content, h: listHeight }, heights, 0);
      rows.forEach((row, index) => {
        const cell: Rect = { ...cells[index], h: rowH };
        const leading = sellLeading(row);
        const pricedRow = pricedRows[index];
        const isSelected = row.id === opts.selected?.key;
        listRow(ui, cell, {
          id: `${args.id}/sell-row-${row.id}`,
          title: ITEM_DEF[row.id].name,
          subtitle: `You have ${row.held}`,
          leading,
          tags: tagsFor(row.quote),
          tagLines: opts.tagLines,
          selected: isSelected,
          onTap: selectTap(ui, args, 'sell', pricedRow),
          trailingWidth: layout.total,
          trailingContent: (trailing) => {
            const [chipCell, buttonCell] = splitH(
              trailing,
              [layout.chipW, layout.buttonW],
              ui.theme.space.sm,
            );
            priceChip(ui, chipCell, {
              label: row.quote.breakdown.final.toLocaleString('en-US'),
              tone: 'normal',
              withCoin: true,
            });
            button(ui, centerIn(buttonCell, buttonCell.w, buttonHeight(ui, 'sm')), {
              id: `${args.id}/sell-${row.id}`,
              label: SELL_LABEL,
              size: 'sm',
              onTap: () => args.onSellRow(row),
            });
          },
        });
        if (isSelected)
          renderBreakdown(
            ui,
            { ...cell, h: layoutRow.h },
            cellBelow(cells[index], cell),
            leading,
            row.quote,
          );
      });
    },
  });
}

/** Widest the "how many?" card grows, in UI units. */
const QUANTITY_CARD_MAX_WIDTH = 360;
/** The gaps between the card's four rows. */
const PROMPT_GAPS = 3;

/**
 * "How many?" over the shop: a stepper, what that many fetch, Cancel and
 * Sell. A tap outside it or Escape cancels; digits type into the amount.
 */
function renderQuantityPrompt(
  ui: Ui,
  opts: {
    readonly id: string;
    readonly prompt: QuantityPrompt;
    readonly quote: (quantity: number) => number;
    readonly onCancel: () => void;
    readonly onConfirm: () => void;
  },
): void {
  ui.defer(() => {
    const { space, size } = ui.theme;
    const skin = skinsFor(ui.theme).panel.card;
    ui.layer({ onEscape: opts.onCancel });
    ui.hit(`${opts.id}/dismiss`, ui.screen, {
      onTap: opts.onCancel,
      focusable: false,
      sound: null,
    });
    const picker = opts.prompt.picker;
    const name = ITEM_DEF[opts.prompt.id].name;
    const titleH = lineHeightOf(ui, 'title');
    const totalH = lineHeightOf(ui, 'label');
    const buttonsH = buttonHeight(ui, 'md');
    const innerH = titleH + size.control + totalH + buttonsH + space.sm * PROMPT_GAPS;
    const w = Math.min(QUANTITY_CARD_MAX_WIDTH, ui.viewport.w - space.lg * 2);
    const card = centerIn(ui.viewport, w, innerH + skin.padding * 2);
    ui.block(card);
    drawGlass(ui, card, skin);
    const [titleRow, stepRow, totalRow, buttonRow] = splitV(
      inset(card, skin.padding),
      [titleH, size.control, totalH, buttonsH],
      space.sm,
    );
    text(ui, titleRow, { text: `Sell ${name}`, role: 'title' });
    stepper(ui, stepRow, { id: `${opts.id}/stepper`, state: picker });
    const total = opts.quote(picker.value);
    tabularNumber(ui, totalRow, {
      value: `${picker.value} for ${total.toLocaleString('en-US')} coins`,
      role: 'secondary',
      align: 'center',
    });
    const [cancelCell, confirmCell] = splitH(buttonRow, ['fill', 'fill'], space.sm);
    button(ui, cancelCell, { id: `${opts.id}/cancel`, label: 'Cancel', onTap: opts.onCancel });
    button(ui, confirmCell, {
      id: `${opts.id}/confirm`,
      label: `Sell ${picker.value}`,
      variant: 'primary',
      primary: true,
      disabled: picker.value <= 0,
      onTap: opts.onConfirm,
    });
  });
}
