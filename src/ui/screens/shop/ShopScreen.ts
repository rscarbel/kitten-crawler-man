/**
 * The one shop screen: every vendor, tavern, temple, stall, the general store
 * and the Anchor's destinations draw through it. A header with the counter's
 * name, the seller's line and the party's purse; Buy / Sell tabs when the
 * counter buys back; a scrolling list of rows, each with its picture, a
 * one-line description, a price chip and a Buy button that says why when it
 * cannot be pressed. Selling a stack asks how many first.
 *
 * Halts the world and keeps the keyboard while open; a tap outside it, Close,
 * Escape and ✕ all close it. A bare accept press closes it too, unless an
 * affordable quest row is on the menu, which then takes that press.
 */

import { partyCoins } from '../../../core/partyCoins';
import { ITEM_DEF, isItemId, type ItemId } from '../../../core/ItemDefs';
import { centerIn, inset, splitH, splitV, type Rect } from '../../core/geom';
import { UI_ERROR_SOUND, type Surface, type Ui } from '../../core/UiRoot';
import { QuantityPickerState } from '../../QuantityPickerState';
import { button, buttonHeight, measureButton } from '../../widgets/button';
import { listRow, listRowHeight, type RowLeading } from '../../widgets/listRow';
import { drawGlass } from '../../widgets/paint';
import { panel } from '../../widgets/panel';
import { scrollView } from '../../widgets/scrollView';
import { stepper, stepperKey } from '../../widgets/stepper';
import { tabs, type TabItem } from '../../widgets/tabs';
import { lineHeightOf, text, tabularNumber } from '../../widgets/text';
import { skinsFor } from '../../theme/skins';
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
}

const SHOP_TABS: readonly TabItem[] = [
  { id: 'buy', label: 'Buy' },
  { id: 'sell', label: 'Sell' },
];

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

/** Why a row's Buy cannot be pressed, or null when it can. */
function buyRefusal(row: ShopRow, unpriced: boolean, party: ShopParty): string | null {
  if (row.unavailable !== undefined) return row.unavailable;
  if (shopRowEnabled(row, unpriced, party)) return null;
  const short = row.price - partyCoins(party.active, party.companion);
  return `${short.toLocaleString('en-US')} more coins needed`;
}

/**
 * The shop screen as a surface. Mount it once per scene; it is open while
 * the session is.
 */
export function shopScreenSurface(opts: ShopScreenOptions): Surface {
  const { session } = opts;
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
  readonly onSellRow: (row: SellRow) => void;
}

function renderShop(ui: Ui, args: RenderShopArgs): void {
  const { session, menu, party } = args;
  const { space } = ui.theme;
  const sellable = session.sellConfig !== null;
  const mode: ShopMode = sellable ? session.mode : 'buy';
  const unpriced = menu.unpriced !== undefined && mode === 'buy';
  const questRow = session.questDefaultRow(party);
  const rowH = listRowHeight(ui, true);
  const sellRows = mode === 'sell' ? session.sellRows(party.active) : [];
  const rowCount =
    mode === 'sell' ? Math.max(1, sellRows.length) : Math.max(1, menu.options.length);
  const compact = ui.size === 'compact';
  const lineLines = compact ? 1 : SELLER_LINE_MAX_LINES;
  const lineH = lineHeightOf(ui, 'body') * lineLines;
  const purseBesideTabs = compact && sellable;
  const tabsH = sellable ? ui.theme.size.control : 0;
  const headerTracks: number[] = [lineH, ...(sellable ? [tabsH] : [])];
  const headerH = headerTracks.reduce((sum, h) => sum + h, 0) + space.md * headerTracks.length;
  const contentHeight = headerH + rowCount * rowH;

  const p = panel(ui, {
    id: args.id,
    title: menu.title,
    subtitle: menu.byline,
    width: 'md',
    height: 'content',
    contentHeight,
    onClose: args.close,
    onScrimTap: args.close,
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
    renderSellList(ui, listRect, args, sellRows, rowH);
  } else {
    renderBuyList(ui, listRect, args, { unpriced, questRow, rowH });
  }
}

/** The width a row's trailing chip and button need, shared by every row so the columns line up. */
function trailingLayout(
  ui: Ui,
  withChip: boolean,
  actionLabel: string,
  statuses: readonly string[] = [],
): { chipW: number; buttonW: number; total: number } {
  const { space } = ui.theme;
  const chipW = withChip
    ? Math.max(
        measurePriceChip(ui, PRICE_LAYOUT_SAMPLE, true),
        ...statuses.map((status) => measurePriceChip(ui, status, false)),
      )
    : 0;
  const buttonW = Math.max(
    ...[...ACTION_LABEL_SAMPLES, actionLabel].map((label) =>
      measureButton(ui, { label, size: 'sm' }),
    ),
  );
  return { chipW, buttonW, total: chipW + (withChip ? space.sm : 0) + buttonW };
}

function renderBuyList(
  ui: Ui,
  rect: Rect,
  args: RenderShopArgs,
  opts: { readonly unpriced: boolean; readonly questRow: ShopRow | null; readonly rowH: number },
): void {
  const { menu, party, session } = args;
  const { palette } = ui.theme;
  const actionLabel = menu.unpriced?.actionLabel ?? BUY_LABEL;
  const rows = menu.options;
  const statuses = rows.flatMap((row) => (row.unavailable === undefined ? [] : [row.unavailable]));
  const layout = trailingLayout(ui, !opts.unpriced, actionLabel, statuses);
  scrollView(ui, rect, {
    id: `${args.id}/rows-buy`,
    contentHeight: rows.length * opts.rowH,
    draw: (content) => {
      const cells = splitV(
        { ...content, h: rows.length * opts.rowH },
        rows.map(() => opts.rowH),
        0,
      );
      rows.forEach((row, index) => {
        const cell = cells[index];
        const refusal = buyRefusal(row, opts.unpriced, party);
        const isQuestDefault = opts.questRow?.key === row.key;
        const subtitle =
          opts.unpriced && row.unavailable !== undefined ? row.unavailable : row.desc;
        listRow(ui, cell, {
          id: `${args.id}/row-${row.key}`,
          title: row.label,
          subtitle,
          leading: leadingFor(menu, row),
          accent: row.isQuestItem === true ? palette.category.quest : undefined,
          trailingWidth: layout.total,
          trailingContent: (trailing) => {
            const [chipCell, buttonCell] = splitH(
              trailing,
              opts.unpriced ? [0, layout.buttonW] : [layout.chipW, layout.buttonW],
              opts.unpriced ? 0 : ui.theme.space.sm,
            );
            const price = priceFor(row, opts.unpriced, refusal === null);
            if (price !== null) priceChip(ui, chipCell, price);
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
      });
    },
  });
}

function renderSellList(
  ui: Ui,
  rect: Rect,
  args: RenderShopArgs,
  rows: readonly SellRow[],
  rowH: number,
): void {
  if (rows.length === 0) {
    text(ui, { ...rect, h: rowH }, { text: NOTHING_TO_SELL, role: 'muted', align: 'center' });
    return;
  }
  const layout = trailingLayout(ui, true, SELL_LABEL);
  scrollView(ui, rect, {
    id: `${args.id}/rows-sell`,
    contentHeight: rows.length * rowH,
    draw: (content) => {
      const cells = splitV(
        { ...content, h: rows.length * rowH },
        rows.map(() => rowH),
        0,
      );
      rows.forEach((row, index) => {
        const cell = cells[index];
        listRow(ui, cell, {
          id: `${args.id}/sell-row-${row.id}`,
          title: ITEM_DEF[row.id].name,
          subtitle: `You have ${row.held}`,
          leading: { kind: 'item', item: row.id },
          trailingWidth: layout.total,
          trailingContent: (trailing) => {
            const [chipCell, buttonCell] = splitH(
              trailing,
              [layout.chipW, layout.buttonW],
              ui.theme.space.sm,
            );
            priceChip(ui, chipCell, {
              label: row.unitPrice.toLocaleString('en-US'),
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
