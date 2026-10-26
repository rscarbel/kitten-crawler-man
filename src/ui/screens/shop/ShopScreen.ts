/**
 * The one shop screen: every vendor, tavern, temple, forge, stall, the
 * general store, the VIP lounge and the Anchor's destinations draw through
 * it. A header with the counter's name, the seller's line and the party's
 * purse; Buy / Sell tabs when the counter buys back; then a grid of offer
 * cards — two across where there is room, one on a phone held upright.
 *
 * Every card shows the picture of what is sold, its name, its whole
 * description, and every part of its cost as a pill of its own: the coins,
 * and each raw material with how much of it the party holds against how much
 * it takes. A pill turns red while the party is short of it, so the reason a
 * Buy cannot be pressed is on the card rather than behind a tooltip. Selling
 * a stack asks how many first.
 *
 * An item priced by the engine carries a tag when stock is moving its price
 * ("Low stock", "Overstocked") and, selling, when the shop buys that kind of
 * goods at its specialty rate. Under `?prices` the selected card also shows
 * the engine's working, step by step.
 *
 * Halts the world and keeps the keyboard while open; a tap outside it, Close,
 * Escape and ✕ all close it. A bare accept press closes it too, unless an
 * affordable quest offer is on the menu, which then takes that press.
 */

import type { SoundId } from '../../../audio/sounds';
import { partyCoins } from '../../../core/party/partyCoins';
import {
  costShortfall,
  formatCost,
  partyCount,
} from '../../../core/items/gathering/partyResources';
import { ITEM_DEF, type ItemId } from '../../../core/items/defs/ItemDefs';
import { centerIn, inset, splitH, splitV, type Rect } from '../../core/geom';
import { UI_ERROR_SOUND, type Surface, type Ui } from '../../core/UiRoot';
import { UiStateSlot } from '../../core/uiState';
import type { PriceQuote, StockTag } from '../../../economy/pricing';
import { QuantityPickerState } from '../../QuantityPickerState';
import { badge, badgeSize, type BadgeTone } from '../../widgets/badge';
import type { Rarity } from '../../../core/items/defs/rarity';
import { rarityColor } from '../dialogs/canvasChrome';
import { button, buttonHeight, measureButton } from '../../widgets/button';
import { card } from '../../widgets/card';
import { drawGlass, fillRounded, strokeRounded } from '../../widgets/paint';
import { panel, panelBodyMaxHeight, panelBodyWidth, type PanelOptions } from '../../widgets/panel';
import { scrollGutterWidth, scrollView, scrollViewScrolls } from '../../widgets/scrollView';
import { stepper, stepperKey } from '../../widgets/stepper';
import { tabs, type TabItem } from '../../widgets/tabs';
import { lineHeightOf, measureTextHeight, text, tabularNumber } from '../../widgets/text';
import { skinsFor, type ControlSize } from '../../theme/skins';
import type { PanelWidth } from '../../theme/tokens';
import {
  coinPurse,
  costPills,
  measureCoinPurse,
  measureCostPills,
  offerArt,
  refusableButton,
  sellerLine,
  widestCostPill,
  type CostPill,
} from './shopParts';
import {
  costCoins,
  menuTakesCoins,
  offerCost,
  rowQuote,
  shopRowEnabled,
  type SellRow,
  type ShopArt,
  type ShopCost,
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
  /** Whether the selected card shows its price working; a scene passes `priceBreakdownsShown`, the `?prices` dev flag. */
  readonly showPriceBreakdowns: () => boolean;
}

const SHOP_TABS: readonly TabItem[] = [
  { id: 'buy', label: 'Buy' },
  { id: 'sell', label: 'Sell' },
];

/** Room for a grid of cards, two across. */
const SHOP_PANEL_WIDTH = 'lg' as const satisfies PanelWidth;
/** A counter with one offer and nothing to buy back keeps to the narrower frame rather than one card in a wide one. */
const SINGLE_OFFER_PANEL_WIDTH = 'md' as const satisfies PanelWidth;
const BUY_LABEL = 'Buy';
const SELL_LABEL = 'Sell';
const CLOSE_LABEL = 'Close';
const FREE_LABEL = 'Free';
const NOTHING_TO_SELL = "Nothing here you're able to sell.";
/** The seller's line wraps to at most this many lines before it is cut short. */
const SELLER_LINE_MAX_LINES = 2;
/** An offer's name wraps to at most this many lines. */
const TITLE_MAX_LINES = 2;
/** Narrowest a card is laid out at; a list wide enough for two of them shows two across. */
const CARD_MIN_WIDTH = 260;
const MAX_COLUMNS = 2;
/** The offer's picture: big enough to read as the thing itself, smaller on a phone so the words keep their room. */
const ART_SIDE = 64;
const ART_SIDE_COMPACT = 52;
/** A card's Buy is a full-size control, so it is an easy target on a phone. */
const ACTION_SIZE = 'md' as const satisfies ControlSize;

/** A short pill under an offer's name, saying something about it ("Low stock", "Quest"). */
interface NoteTag {
  readonly kind?: 'note';
  readonly label: string;
  readonly tone: BadgeTone;
}

/** A piece of gear's rarity, named and set in the rarity's own colour. */
interface RarityTag {
  readonly kind: 'rarity';
  readonly rarity: Rarity;
}

type OfferTag = NoteTag | RarityTag;

/** How a tag draws: its words and its colour. */
function tagLook(ui: Ui, tag: OfferTag): { label: string; tone?: BadgeTone; color?: string } {
  return tag.kind === 'rarity'
    ? { label: tag.rarity, color: rarityColor(ui.theme, tag.rarity) }
    : { label: tag.label, tone: tag.tone };
}

const STOCK_TAGS = {
  low_stock: { label: 'Low stock', tone: 'warning' },
  overstocked: { label: 'Overstocked', tone: 'info' },
} as const satisfies Record<StockTag, NoteTag>;
const SPECIALTY_TAG = { label: 'Specialty', tone: 'success' } as const satisfies NoteTag;
const QUEST_TAG = { label: 'Quest', tone: 'accent' } as const satisfies NoteTag;
/** The tone a shut offer's reason reads in, and one with nothing left to sell. */
const CLOSED_TONE = 'neutral' as const satisfies BadgeTone;
const SPENT_TONE = 'success' as const satisfies BadgeTone;
/** How many decimals a breakdown's multipliers and running totals show. */
const BREAKDOWN_DECIMALS = 2;
/** The quest offer's frame is drawn this thick, in quest gold. */
const QUEST_BORDER_WIDTH = 1.5;
const DIVIDER_WIDTH = 1;

/** Which card's working `?prices` shows, per tab; null until a card is tapped, which shows the first. */
const PRICE_SELECTION = new UiStateSlot<string | null>('shop-price-selection', () => null);

interface QuantityPrompt {
  readonly id: ItemId;
  readonly picker: QuantityPickerState;
}

/** What a card's action slot holds: a button to press, or why there is none. */
type OfferAction =
  | {
      readonly kind: 'button';
      readonly id: string;
      readonly label: string;
      /** Why it cannot be pressed, or null when it can. */
      readonly refusal: string | null;
      readonly primary: boolean;
      /** Played when a refused press lands; null when the session sounds its own refusal. */
      readonly sound: SoundId | null;
      readonly onTap: () => void;
    }
  | { readonly kind: 'status'; readonly label: string; readonly tone: BadgeTone };

/** One card as the grid draws it, for a Buy offer and a Sell stack alike. */
interface OfferCard {
  /** The key `?prices` selects it by. */
  readonly key: string;
  /** Region id of the card itself. */
  readonly regionId: string;
  readonly art: ShopArt;
  readonly title: string;
  readonly desc: string;
  readonly tags: readonly OfferTag[];
  readonly quest: boolean;
  /** A shut offer's picture is faded. */
  readonly faded: boolean;
  readonly costs: readonly CostPill[];
  readonly action: OfferAction;
  readonly quote: PriceQuote | null;
}

function formatCoins(coins: number): string {
  return coins === 0 ? FREE_LABEL : coins.toLocaleString('en-US');
}

function coinPill(coins: number, affordable: boolean, muted: boolean): CostPill {
  return {
    icon: { kind: 'coin' },
    name: null,
    amount: formatCoins(coins),
    tone: muted ? 'muted' : affordable ? 'price' : 'short',
  };
}

/** Every part of `cost`, against what the party holds, as pills. */
function costPillsFor(cost: ShopCost, party: ShopParty, muted: boolean): CostPill[] {
  if (cost.kind === 'free') return [];
  const coins = costCoins(cost);
  const purse = partyCoins(party.active, party.companion);
  const coinsPill = coinPill(coins, purse >= coins, muted);
  if (cost.kind !== 'coinsAndMaterials') return [coinsPill];
  const materialPills = cost.materials.map((line): CostPill => {
    const held = partyCount(party.active, party.companion, line.resource);
    const tone = muted ? 'muted' : held >= line.amount ? 'met' : 'short';
    return {
      icon: { kind: 'item', item: line.resource },
      name: ITEM_DEF[line.resource].name,
      amount: `${Math.min(held, line.amount)}/${line.amount}`,
      tone,
    };
  });
  return coins > 0 ? [coinsPill, ...materialPills] : materialPills;
}

/** The tags under an offer's name: why stock moves its price, the specialty rate, a quest errand. */
function tagsFor(quote: PriceQuote | null, quest: boolean, art: ShopArt): OfferTag[] {
  const tags: OfferTag[] = [];
  const rarity = art.kind === 'item' ? ITEM_DEF[art.item].rarity : undefined;
  if (rarity !== undefined) tags.push({ kind: 'rarity', rarity });
  if (quest) tags.push(QUEST_TAG);
  if (quote === null) return tags;
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

/** Why an open offer's Buy cannot be pressed, or null when it can. */
function buyRefusal(row: ShopRow, party: ShopParty): string | null {
  if (row.offer.status !== 'open') return row.offer.reason;
  if (shopRowEnabled(row, party)) return null;
  const { cost } = row.offer;
  const coinsShort = costCoins(cost) - partyCoins(party.active, party.companion);
  if (coinsShort > 0 || cost.kind !== 'coinsAndMaterials') {
    return `${coinsShort.toLocaleString('en-US')} more coins needed`;
  }
  const materials = Object.fromEntries(cost.materials.map((line) => [line.resource, line.amount]));
  return `${formatCost(costShortfall(party.active, party.companion, materials))} more needed`;
}

/**
 * The shop screen as a surface. Mount it once per scene; it is open while
 * the session is.
 */
export function shopScreenSurface(opts: ShopScreenOptions): Surface {
  const { session } = opts;
  const breakdownsShown = opts.showPriceBreakdowns;
  let prompt: QuantityPrompt | null = null;
  let promptGeneration = -1;

  const close = (): void => {
    prompt = null;
    session.close();
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

function buyCards(args: RenderShopArgs): OfferCard[] {
  const { menu, party, session } = args;
  const questRow = session.questDefaultRow(party);
  return menu.options.map((row): OfferCard => {
    const cost = offerCost(row.offer);
    const quote = rowQuote(row);
    const open = row.offer.status === 'open';
    const isQuestDefault = questRow?.key === row.key;
    const action: OfferAction =
      row.offer.status === 'open'
        ? {
            kind: 'button',
            id: `${args.id}/buy-${row.key}`,
            label: row.offer.cost.kind === 'free' ? row.offer.cost.actionLabel : BUY_LABEL,
            refusal: buyRefusal(row, party),
            primary: isQuestDefault,
            sound: session.soundsOwnRefusal ? null : UI_ERROR_SOUND,
            onTap: () => session.tryBuy(row, party),
          }
        : {
            kind: 'status',
            label: row.offer.reason,
            tone: row.offer.status === 'spent' ? SPENT_TONE : CLOSED_TONE,
          };
    return {
      key: row.key,
      regionId: `${args.id}/row-${row.key}`,
      art: row.art,
      title: row.label,
      desc: row.desc,
      tags: tagsFor(quote, row.questErrand, row.art),
      quest: row.questErrand,
      faded: !open,
      costs: cost === null ? [] : costPillsFor(cost, party, !open),
      action,
      quote,
    };
  });
}

function sellCards(args: RenderShopArgs, rows: readonly SellRow[]): OfferCard[] {
  return rows.map((row) => ({
    key: row.id,
    regionId: `${args.id}/sell-row-${row.id}`,
    art: { kind: 'item', item: row.id },
    title: ITEM_DEF[row.id].name,
    desc: `You have ${row.held}`,
    tags: tagsFor(row.quote, false, { kind: 'item', item: row.id }),
    quest: false,
    faded: false,
    costs: [coinPill(row.quote.breakdown.final, true, false)],
    action: {
      kind: 'button',
      id: `${args.id}/sell-${row.id}`,
      label: SELL_LABEL,
      refusal: null,
      primary: false,
      sound: null,
      onTap: () => args.onSellRow(row),
    },
    quote: row.quote,
  }));
}

function selectionId(args: RenderShopArgs, mode: ShopMode): string {
  return `${args.id}/price-${mode}`;
}

/** The card whose working shows: the one last tapped, else the first with any; null when breakdowns are off. */
function selectedKey(
  ui: Ui,
  args: RenderShopArgs,
  mode: ShopMode,
  cards: readonly OfferCard[],
): string | null {
  if (!args.breakdowns) return null;
  const chosen = ui.state(PRICE_SELECTION, selectionId(args, mode));
  const priced = cards.filter((offer) => offer.quote !== null);
  const chosenCard = priced.find((offer) => offer.key === chosen);
  if (chosenCard !== undefined) return chosenCard.key;
  return priced.length > 0 ? priced[0].key : null;
}

/** The pieces of one card, measured at one width. */
interface CardLayout {
  readonly artSide: number;
  readonly textW: number;
  readonly titleH: number;
  readonly tagsH: number;
  /** The art and, beside it, the name and tags. */
  readonly headH: number;
  readonly descH: number;
  readonly breakdownH: number;
  readonly topH: number;
  readonly actionW: number;
  /** Whether the action sits on a line of its own under the pills, which happens when they would not fit beside it. */
  readonly actionBelow: boolean;
  readonly pillsH: number;
  readonly footerH: number;
  readonly height: number;
}

function cardPadding(ui: Ui): number {
  return skinsFor(ui.theme).panel.raised.padding;
}

function actionWidth(ui: Ui, action: OfferAction): number {
  return action.kind === 'button'
    ? measureButton(ui, { label: action.label, size: ACTION_SIZE })
    : badgeSize(ui, { label: action.label }).w;
}

function actionHeight(ui: Ui, action: OfferAction): number {
  return action.kind === 'button'
    ? buttonHeight(ui, ACTION_SIZE)
    : badgeSize(ui, { label: action.label }).h;
}

function cardLayout(ui: Ui, offer: OfferCard, width: number, selected: boolean): CardLayout {
  const { space } = ui.theme;
  const pad = cardPadding(ui);
  const innerW = width - pad * 2;
  const artSide = ui.size === 'compact' ? ART_SIDE_COMPACT : ART_SIDE;
  const textW = innerW - artSide - space.md;
  const titleLines = Math.min(
    TITLE_MAX_LINES,
    Math.ceil(
      measureTextHeight(ui, textW, { text: offer.title, role: 'title' }) /
        lineHeightOf(ui, 'title'),
    ),
  );
  const titleH = titleLines * lineHeightOf(ui, 'title');
  const tagsH =
    offer.tags.length === 0 ? 0 : badgeSize(ui, { label: '', kind: 'tag' }).h + space.xs;
  const descH = measureTextHeight(ui, innerW, { text: offer.desc, role: 'secondary' });
  const breakdownH =
    selected && offer.quote !== null
      ? space.sm + lineHeightOf(ui, 'caption') * breakdownLines(offer.quote).length
      : 0;
  const headH = Math.max(artSide, titleH + tagsH);
  const topH = headH + space.sm + descH + breakdownH;
  const actionW = Math.min(innerW, actionWidth(ui, offer.action));
  const besideW = innerW - actionW - space.sm;
  const actionBelow = offer.costs.length > 0 && besideW < widestCostPill(ui, offer.costs);
  const pillsW = actionBelow ? innerW : besideW;
  const pillsH = measureCostPills(ui, offer.costs, pillsW);
  const actionH = actionHeight(ui, offer.action);
  const footerH = actionBelow ? pillsH + space.sm + actionH : Math.max(pillsH, actionH);
  const height = pad * 2 + topH + space.md * 2 + footerH;
  return {
    artSide,
    textW,
    titleH,
    tagsH,
    headH,
    descH,
    breakdownH,
    topH,
    actionW,
    actionBelow,
    pillsH,
    footerH,
    height,
  };
}

/** How many cards go across a list `width` wide. */
function columnsFor(ui: Ui, width: number): number {
  const gap = gridGap(ui);
  return Math.min(MAX_COLUMNS, Math.max(1, Math.floor((width + gap) / (CARD_MIN_WIDTH + gap))));
}

function gridGap(ui: Ui): number {
  return ui.size === 'compact' ? ui.theme.space.sm : ui.theme.space.md;
}

/** Each card's cell at `width`, rows as tall as their tallest card so footers line up across a row. */
function gridCells(
  ui: Ui,
  width: number,
  cards: readonly OfferCard[],
  selected: string | null,
): { readonly cells: Rect[]; readonly height: number } {
  const gap = gridGap(ui);
  const columns = columnsFor(ui, width);
  const cellW = (width - gap * (columns - 1)) / columns;
  const heights = cards.map((offer) => cardLayout(ui, offer, cellW, offer.key === selected).height);
  const cells: Rect[] = [];
  let y = 0;
  for (let start = 0; start < cards.length; start += columns) {
    const rowH = Math.max(...heights.slice(start, start + columns));
    for (let column = 0; column < columns && start + column < cards.length; column++) {
      cells.push({ x: column * (cellW + gap), y, w: cellW, h: rowH });
    }
    y += rowH + gap;
  }
  return { cells, height: Math.max(0, y - gap) };
}

function renderShop(ui: Ui, args: RenderShopArgs): void {
  const { session, menu, party } = args;
  const { space } = ui.theme;
  const sellable = session.sellConfig !== null;
  const mode: ShopMode = sellable ? session.mode : 'buy';
  const questRow = session.questDefaultRow(party);
  const sellRows = mode === 'sell' ? session.sellRows(party.active) : [];
  const cards = mode === 'sell' ? sellCards(args, sellRows) : buyCards(args);
  const selected = selectedKey(ui, args, mode, cards);
  const compact = ui.size === 'compact';
  const width: PanelWidth =
    menu.options.length <= 1 && !sellable ? SINGLE_OFFER_PANEL_WIDTH : SHOP_PANEL_WIDTH;
  const lineH = lineHeightOf(ui, 'body') * SELLER_LINE_MAX_LINES;
  const purseBesideTabs = compact && sellable;
  const tabsH = sellable ? ui.theme.size.control : 0;
  const headerTracks: number[] = [lineH, ...(sellable ? [tabsH] : [])];
  const headerH = headerTracks.reduce((sum, h) => sum + h, 0) + space.md * headerTracks.length;
  const emptyH = lineHeightOf(ui, 'body') + space.lg * 2;
  const listHeightAt = (listW: number): number =>
    cards.length === 0 ? emptyH : gridCells(ui, listW, cards, selected).height;

  const frame: Pick<PanelOptions, 'title' | 'subtitle' | 'width' | 'onClose' | 'footer'> = {
    title: menu.title,
    ...(menu.byline === null ? {} : { subtitle: menu.byline }),
    width,
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
  // The list's scroll view narrows its cards by a gutter once it scrolls, so
  // wrapping is measured at that narrower width whenever the cards overflow.
  const fullListW = panelBodyWidth(ui, width);
  const unscrolledH = headerH + listHeightAt(fullListW);
  const listScrolls = scrollViewScrolls(unscrolledH, panelBodyMaxHeight(ui, frame));
  const contentHeight = listScrolls
    ? headerH + listHeightAt(fullListW - scrollGutterWidth(ui))
    : unscrolledH;

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
  if (menu.emblem !== null) {
    const side = Math.min(lineRow.h, ui.theme.size.slot);
    menu.emblem(ui.ctx, centerIn({ ...lineRow, w: side }, side, side));
    lineRect = inset(lineRect, { l: side + space.sm });
  }
  let tabsArea = tabsRect;
  if (menuTakesCoins(menu) || sellable) {
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
    maxLines: SELLER_LINE_MAX_LINES,
  });

  if (tabsArea !== null) {
    tabs(ui, tabsArea, {
      id: `${args.id}/tabs`,
      items: SHOP_TABS,
      selected: mode,
      onSelect: (tab) => session.setMode(tab === 'sell' ? 'sell' : 'buy'),
    });
  }

  if (cards.length === 0) {
    text(ui, { ...listRect, h: emptyH }, { text: NOTHING_TO_SELL, role: 'muted', align: 'center' });
    return;
  }
  const listH = listHeightAt(listRect.w - (listScrolls ? scrollGutterWidth(ui) : 0));
  scrollView(ui, listRect, {
    id: `${args.id}/rows-${mode}`,
    contentHeight: listH,
    draw: (content) => {
      const { cells } = gridCells(ui, content.w, cards, selected);
      cards.forEach((offer, index) => {
        const cell = cells[index];
        const placed: Rect = { ...cell, x: content.x + cell.x, y: content.y + cell.y };
        const isSelected = offer.key === selected;
        const onSelect =
          args.breakdowns && offer.quote !== null
            ? () => ui.setState(PRICE_SELECTION, selectionId(args, mode), offer.key)
            : undefined;
        renderCard(ui, placed, offer, isSelected, onSelect);
      });
    },
  });
}

function renderCard(
  ui: Ui,
  rect: Rect,
  offer: OfferCard,
  selected: boolean,
  onSelect: (() => void) | undefined,
): void {
  const { space, palette } = ui.theme;
  const layout = cardLayout(ui, offer, rect.w, selected);
  const { body } = card(ui, rect, {
    id: offer.regionId,
    kind: 'raised',
    selected,
    onTap: onSelect,
  });
  if (offer.quest && !selected) {
    strokeRounded(
      ui.ctx,
      rect,
      skinsFor(ui.theme).panel.raised.radius,
      palette.category.quest,
      QUEST_BORDER_WIDTH,
    );
  }

  const artRect: Rect = { x: body.x, y: body.y, w: layout.artSide, h: layout.artSide };
  offerArt(ui, artRect, offer.art, offer.faded);

  const textX = body.x + layout.artSide + space.md;
  const nameBlockH = layout.titleH + layout.tagsH;
  let y = body.y + (layout.headH - nameBlockH) / 2;
  text(
    ui,
    { x: textX, y, w: layout.textW, h: layout.titleH },
    { text: offer.title, role: 'title', wrap: true, maxLines: TITLE_MAX_LINES },
  );
  y += layout.titleH;
  if (offer.tags.length > 0) {
    let tagX = textX;
    const tagH = layout.tagsH - space.xs;
    for (const tag of offer.tags) {
      const look = tagLook(ui, tag);
      const size = badgeSize(ui, { label: look.label, kind: 'tag' });
      if (tagX + size.w > textX + layout.textW) break;
      badge(
        ui,
        { x: tagX, y: y + space.xs, w: size.w, h: tagH },
        {
          label: look.label,
          tone: look.tone,
          color: look.color,
          kind: 'tag',
        },
      );
      tagX += size.w + space.xs;
    }
  }
  y = body.y + layout.headH + space.sm;
  text(
    ui,
    { x: body.x, y, w: body.w, h: layout.descH },
    { text: offer.desc, role: 'secondary', wrap: true },
  );
  y += layout.descH;
  if (layout.breakdownH > 0 && offer.quote !== null) {
    renderBreakdown(
      ui,
      { x: body.x, y: y + space.sm, w: body.w, h: layout.breakdownH },
      offer.quote,
    );
  }

  const footer: Rect = {
    x: body.x,
    y: rect.y + rect.h - cardPadding(ui) - layout.footerH,
    w: body.w,
    h: layout.footerH,
  };
  const divider: Rect = { x: body.x, y: footer.y - space.md, w: body.w, h: DIVIDER_WIDTH };
  fillRounded(ui.ctx, divider, 0, palette.border.subtle);

  const actionH = actionHeight(ui, offer.action);
  const actionRect: Rect = layout.actionBelow
    ? {
        x: footer.x + footer.w - layout.actionW,
        y: footer.y + footer.h - actionH,
        w: layout.actionW,
        h: actionH,
      }
    : {
        x: footer.x + footer.w - layout.actionW,
        y: footer.y + (footer.h - actionH) / 2,
        w: layout.actionW,
        h: actionH,
      };
  const pillsRect: Rect = layout.actionBelow
    ? { x: footer.x, y: footer.y, w: footer.w, h: layout.pillsH }
    : {
        x: footer.x,
        y: footer.y + (footer.h - layout.pillsH) / 2,
        w: footer.w - layout.actionW - space.sm,
        h: layout.pillsH,
      };
  costPills(ui, pillsRect, offer.costs);
  renderAction(ui, actionRect, offer.action);
}

function renderAction(ui: Ui, rect: Rect, action: OfferAction): void {
  if (action.kind === 'status') {
    badge(ui, rect, { label: action.label, tone: action.tone, variant: 'soft' });
    return;
  }
  refusableButton(ui, rect, {
    id: action.id,
    label: action.label,
    size: ACTION_SIZE,
    refusal: action.refusal,
    variant: action.primary ? 'primary' : 'secondary',
    primary: action.primary,
    sound: action.sound,
    onTap: action.onTap,
  });
}

/** Draws the engine's working in `area`, under the card's description. */
function renderBreakdown(ui: Ui, area: Rect, quote: PriceQuote): void {
  const lines = breakdownLines(quote);
  const lineH = lineHeightOf(ui, 'caption');
  const cells = splitV(
    { ...area, h: lineH * lines.length },
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
    const promptCard = centerIn(ui.viewport, w, innerH + skin.padding * 2);
    ui.block(promptCard);
    drawGlass(ui, promptCard, skin);
    const [titleRow, stepRow, totalRow, buttonRow] = splitV(
      inset(promptCard, skin.padding),
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
