import { TILE_SIZE } from '../core/constants';
import { ITEM_DEF, type ItemId } from '../core/ItemDefs';
import type { Player } from '../Player';
import type { GameSystem } from './GameSystem';
import { drawInteractionPrompt } from '../ui/InteractionPrompt';
import { drawText } from '../ui/TextBox';
import {
  drawBox,
  drawOverlay,
  drawScrollbar,
  beginModalFit,
  endModalFit,
  modalFitPoint,
  MODAL_FIT_NONE,
  type ModalFit,
} from '../ui/Box';
import { fitPanel } from '../ui/panelFit';
import {
  addButton,
  beginMenuFocus,
  endMenuFocus,
  BUTTON_PRESETS,
  setButtonPointerSpace,
  resetButtonPointerSpace,
} from '../ui/Button';
import type { ButtonRect } from '../ui/pause/types';
import type { Townsperson } from '../creatures/Townsperson';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import {
  consumeStock,
  remainingFor,
  heldFor,
  addHeldStock,
  removeHeldStock,
  decayHeldStock,
  type MarketStock,
} from './market/MarketStock';
import { SOLD_OUT_LABEL } from './market/vendorMenu';
import { shopBuyPrice, shopSellPrice, type ShopPricingProfile } from './market/shopPricing';
import { GENERAL_STORE_PRICING } from './market/shopProfiles';
import { sellableHoldings } from './market/sellableInventory';
import { partyCoins, canAffordCoins, spendPartyCoins } from '../core/partyCoins';

const SHOPKEEPER_HALF_TILE = 0.5;
const SHOPKEEPER_INTERACT_RANGE = 3.5;

const FEEDBACK_FADE_FRAMES = 30;
const FEEDBACK_TIMER_FRAMES = 100;
const FEEDBACK_BG_ALPHA = 0.85;
const FEEDBACK_Y_FROM_BOTTOM = 68;
const FEEDBACK_TEXT_Y_FROM_BOTTOM = 48;
const FEEDBACK_TEXT_Y_OFFSET = 10;
const FEEDBACK_BOX_W = 260;
const FEEDBACK_BOX_H = 28;
const FEEDBACK_TEXT_SIZE = 12;

const PANEL_OVERLAY_ALPHA = 0.62;
const PANEL_FILL_COLOR = '#120d04';
const PANEL_BORDER_COLOR = '#c8a840';
const PANEL_BORDER_WIDTH = 2;
const ROW_ENABLED_FILL = '#14400a';
const ROW_DISABLED_FILL = '#281818';
const ROW_ENABLED_BORDER = '#5aaa34';
const ROW_DISABLED_BORDER = '#3a2020';
const ROW_ENABLED_LABEL = '#c8e890';
const ROW_DISABLED_LABEL = '#5a4040';
const PANEL_W = 400;
const PANEL_ITEM_H = 56;
/** Header now carries the Buy/Sell tab row above the divider, on top of the title and coin line. */
const PANEL_HEADER_H = 102;
const PANEL_FOOTER_H = 44;
const PANEL_INNER_INSET = 5;
const PANEL_INNER_SIZE_REDUCTION = 10;
const PANEL_TITLE_Y = 26;
const PANEL_TITLE_BASELINE = 13;
const PANEL_TITLE_SIZE = 16;
const PANEL_SEPARATOR_X_MARGIN = 20;
const PANEL_SEPARATOR_Y = 64;
const PANEL_COINS_Y = 82;
const PANEL_COINS_BASELINE = 10;
const PANEL_COINS_TEXT_SIZE = 12;
const PANEL_FIRST_ROW_Y = 96;
const PANEL_ROW_BG_INSET_X = 8;
const PANEL_ROW_BG_INSET_W = 16;
const PANEL_ROW_BG_INSET_H = 4;
const PANEL_ROW_EVEN_ALPHA = 0.04;
const PANEL_ROW_ALT_ALPHA = 0.18;
const PANEL_ITEM_X_MARGIN = 18;
const PANEL_ITEM_NAME_Y = 20;
const PANEL_ITEM_NAME_BASELINE = 10;
const PANEL_ITEM_NAME_SIZE = 13;
const PANEL_ITEM_DESC_Y = 36;
const PANEL_ITEM_DESC_BASELINE = 8;
const PANEL_DESC_SIZE = 10;
const PANEL_PRICE_X_FROM_RIGHT = 100;
const PANEL_BTN_W = 76;
/** Fills the row so a fingertip can hit it; the row itself is 56 tall. */
const PANEL_BTN_H = 40;
const PANEL_BTN_BORDER_W = 1.5;
const PANEL_BTN_X_MARGIN = 12;
const PANEL_BTN_TEXT_SIZE = 12;
/** The footer's Close button, sized to sit inside PANEL_FOOTER_H with a hair of margin. */
const PANEL_CLOSE_BTN_W = 150;
const PANEL_CLOSE_BTN_H = 34;
const PANEL_CLOSE_BTN_Y_FROM_BOTTOM = 40;
const PANEL_CLOSE_SIZE = 10;

/** The Buy/Sell toggle sitting between the title and the divider. */
const TAB_BUTTON_W = 84;
const TAB_BUTTON_H = 26;
const TAB_BUTTON_GAP = 8;
const TAB_BUTTON_Y = 47;
const TAB_LABEL_SIZE = 12;

/**
 * Below this fit scale the shop shows fewer rows and scrolls instead of
 * shrinking further, so its text stays readable on a landscape phone.
 */
const SHOP_COMFORT_SCALE = 0.8;
/** Vertical breathing room the fit keeps above and below the panel (matches fitPanel). */
const SHOP_VERTICAL_MARGIN = 16;
const SHOP_MIN_VISIBLE_ROWS = 3;
const SCROLLBAR_WIDTH = 4;
const SCROLLBAR_X_FROM_RIGHT = 7;
/** Pointer travel, in design px, before a press counts as a scroll drag instead of a tap. */
const DRAG_THRESHOLD = 6;
/** One wheel notch reports ~100; a row per notch feels right for a list this short. */
const WHEEL_NOTCH_DELTA = 100;

const HEALTH_POTION_PRICE = 5;
export const GOBLIN_DYNAMITE_PRICE = 10;
const CONFUSING_FOG_PRICE = 15;

const DEFAULT_SHOP_TITLE = 'General Store';

export interface ShopItem {
  id: ItemId;
  label: string;
  price: number;
  desc: string;
  /** Units available for the whole run. Omit for an unlimited line, the default for every ShopSystem row. */
  stock?: number;
}

/** A shop's catalog and how it prices what it buys back. */
export interface ShopConfig {
  title: string;
  items: ReadonlyArray<ShopItem>;
  pricing: ShopPricingProfile;
}

/**
 * Backs a `ShopSystem`'s limited rows with the same cross-scene counter the
 * overworld market stalls use, so a line bought out at a club counter stays
 * sold out through a checkpoint restore or a reload the same way a market
 * stall does. Also where the shop's held-stock (what the player has sold it)
 * lives, so a sale here survives leaving and re-entering the building.
 */
export interface ShopStockConfig {
  stock: MarketStock;
  vendorId: string;
}

const SHOP_ITEMS: ReadonlyArray<ShopItem> = [
  {
    id: 'health_potion',
    label: 'Health Potion',
    price: HEALTH_POTION_PRICE,
    desc: 'Restores 50% max HP',
  },
  {
    id: 'goblin_dynamite',
    label: 'Goblin Dynamite',
    price: GOBLIN_DYNAMITE_PRICE,
    desc: 'Throw for AoE damage',
  },
  {
    id: 'scroll_of_confusing_fog',
    label: 'Scroll of Confusing Fog',
    price: CONFUSING_FOG_PRICE,
    desc: 'Blinds nearby enemies',
  },
];

/** The town's General Store: the same everyday catalog and pricing personality in every building of this type. */
export const GENERAL_STORE_CONFIG: ShopConfig = {
  title: DEFAULT_SHOP_TITLE,
  items: SHOP_ITEMS,
  pricing: GENERAL_STORE_PRICING,
};

/** One row of the panel, whichever tab is open — the shape the shared row renderer draws. */
interface PanelRow {
  label: string;
  desc: string;
  /** Right-aligned price/status text, e.g. "5 coins" or "Sold out". */
  priceLabel: string;
  actionLabel: string;
  /** Drives both the row's colour and whether its button can be pressed. */
  enabled: boolean;
  onAction: () => void;
}

export class ShopSystem implements GameSystem {
  shopOpen = false;
  /** Set to true after a successful purchase or sale; consuming scene clears it and plays the sound. */
  purchasePending = false;

  private mode: 'buy' | 'sell' = 'buy';

  /**
   * Keeper Brenna Kestrel's own occupant, the counter's sole owner — this
   * system only reads her position for the interaction prompt and range
   * check; `InteriorOccupantSystem` renders her, the same as any other
   * stationed resident. Set once the scene has built its occupant roster
   * (construction order puts this system together before that roster
   * exists), so it starts `null` and falls back to a fixed spot behind the
   * counter until then.
   */
  private keeper: Pick<Townsperson, 'x' | 'y'> | null = null;
  private readonly fallbackKeeperX: number;
  private readonly fallbackKeeperTileY = 1;

  private feedbackMsg = '';
  private feedbackTimer = 0;
  /** Rebuilt every render, so a click and the row it hits can never drift apart. */
  private panelButtons: ButtonRect[] = [];
  /** Set every render; clicks are mapped back through it before hit-testing. */
  private fit: ModalFit = MODAL_FIT_NONE;
  private scrollY = 0;
  private maxScrollY = 0;
  private listRect = { x: 0, y: 0, w: 0, h: 0 };
  private pressY: number | null = null;
  private pressScrollY = 0;
  /** Latched by a drag so the click that ends it does not also buy the row under the finger. */
  private dragged = false;

  private readonly title: string;
  private readonly items: ReadonlyArray<ShopItem>;
  private readonly pricing: ShopPricingProfile;
  private readonly stockConfig: ShopStockConfig;

  constructor(interiorWidth: number, config: ShopConfig, stockConfig: ShopStockConfig) {
    this.title = config.title;
    this.items = config.items;
    this.pricing = config.pricing;
    this.stockConfig = stockConfig;
    this.fallbackKeeperX = Math.floor(interiorWidth / 2) * TILE_SIZE;
  }

  /** Points this system at Kestrel's own occupant, once the scene has built its roster. */
  setKeeper(keeper: Pick<Townsperson, 'x' | 'y'> | null): void {
    this.keeper = keeper;
  }

  private keeperX(): number {
    return this.keeper?.x ?? this.fallbackKeeperX;
  }

  private keeperY(): number {
    return this.keeper?.y ?? this.fallbackKeeperTileY * TILE_SIZE;
  }

  /** Units left for a row, or `null` when the row is unlimited or this shop has no stock store. */
  private remainingStock(item: ShopItem): number | null {
    return remainingFor(this.stockConfig.stock, this.stockConfig.vendorId, item);
  }

  /** Units of `id` this shop is currently holding because the player sold it some. */
  private heldUnits(id: ItemId): number {
    return heldFor(this.stockConfig.stock.held, this.stockConfig.vendorId, id);
  }

  /** What this shop charges right now for one unit of `id`, honouring its own catalog price when it has one. */
  private buyPriceOf(id: ItemId): number {
    const catalog = this.items.find((line) => line.id === id);
    return shopBuyPrice(id, this.pricing, this.heldUnits(id), catalog?.price);
  }

  /** What this shop pays right now for one unit of `id`. */
  private sellPriceOf(id: ItemId): number {
    const catalog = this.items.find((line) => line.id === id);
    return shopSellPrice(id, this.pricing, this.heldUnits(id), catalog?.price);
  }

  update(): void {
    if (this.feedbackTimer > 0) this.feedbackTimer--;
    decayHeldStock(this.stockConfig.stock.held, this.pricing.heldStockRecoveryPerTick);
  }

  isNearShopkeeper(player: Player): boolean {
    const skPx = this.keeperX() + TILE_SIZE * SHOPKEEPER_HALF_TILE;
    const skPy = this.keeperY() + TILE_SIZE * SHOPKEEPER_HALF_TILE;
    return (
      Math.hypot(
        player.x + TILE_SIZE * SHOPKEEPER_HALF_TILE - skPx,
        player.y + TILE_SIZE * SHOPKEEPER_HALF_TILE - skPy,
      ) <
      TILE_SIZE * SHOPKEEPER_INTERACT_RANGE
    );
  }

  /**
   * Kestrel is drawn by `InteriorOccupantSystem`'s own Y-sorted pass, the
   * same as any other stationed resident — this only places the "Shop"
   * prompt at her own position, so it never floats away from her.
   */
  renderObjects(ctx: CanvasRenderingContext2D, camX: number, camY: number, active: Player): void {
    if (this.shopOpen || !this.isNearShopkeeper(active)) return;
    const ts = TILE_SIZE;
    const sx = this.keeperX() - camX;
    const sy = this.keeperY() - camY;
    drawInteractionPrompt(ctx, sx, sy, ts, 'Shop');
  }

  renderUI(ctx: CanvasRenderingContext2D, _active: Player): void {
    if (this.feedbackTimer > 0) {
      const alpha = Math.min(1, this.feedbackTimer / FEEDBACK_FADE_FRAMES);
      ctx.save();
      ctx.fillStyle = `rgba(10,8,4,${alpha * FEEDBACK_BG_ALPHA})`;
      ctx.fillRect(
        viewportWidth() / 2 - FEEDBACK_BOX_W / 2,
        viewportHeight() - FEEDBACK_Y_FROM_BOTTOM,
        FEEDBACK_BOX_W,
        FEEDBACK_BOX_H,
      );
      ctx.restore();
      drawText(ctx, this.feedbackMsg, {
        x: viewportWidth() / 2,
        y: viewportHeight() - FEEDBACK_TEXT_Y_FROM_BOTTOM - FEEDBACK_TEXT_Y_OFFSET,
        size: FEEDBACK_TEXT_SIZE,
        color: `rgba(220,190,80,${alpha})`,
        align: 'center',
        alpha,
      });
    }
  }

  /** The rows the panel draws right now, built fresh so a sale or purchase is reflected the instant it happens. */
  private currentRows(active: Player, companion: Player): PanelRow[] {
    if (this.mode === 'sell') {
      return sellableHoldings(active).map(({ id, qty }) => {
        const def = ITEM_DEF[id];
        const price = this.sellPriceOf(id);
        return {
          label: def.name,
          desc: `You have ${qty}`,
          priceLabel: `${price} coins`,
          actionLabel: 'Sell',
          enabled: true,
          onAction: () => this.trySell(id, active),
        };
      });
    }
    return this.items.map((item, itemIdx) => {
      const soldOut = this.remainingStock(item) === 0;
      const price = this.buyPriceOf(item.id);
      const canAfford = !soldOut && canAffordCoins(active, companion, price);
      return {
        label: item.label,
        desc: item.desc,
        priceLabel: soldOut ? SOLD_OUT_LABEL : `${price} coins`,
        actionLabel: soldOut ? SOLD_OUT_LABEL : 'Buy',
        enabled: canAfford,
        onAction: () => this.tryBuy(itemIdx, active, companion),
      };
    });
  }

  /** Rows that fit on screen at a legible scale; the rest scroll. */
  private visibleRowCount(rowCount: number): number {
    const maxDesignHeight = (viewportHeight() - SHOP_VERTICAL_MARGIN * 2) / SHOP_COMFORT_SCALE;
    const rowsThatFit = Math.floor(
      (maxDesignHeight - PANEL_HEADER_H - PANEL_FOOTER_H) / PANEL_ITEM_H,
    );
    return Math.min(rowCount, Math.max(SHOP_MIN_VISIBLE_ROWS, rowsThatFit));
  }

  private scrollBy(designPx: number): void {
    this.scrollY = Math.min(this.maxScrollY, Math.max(0, this.scrollY + designPx));
  }

  handleWheel(deltaY: number): void {
    if (!this.shopOpen) return;
    this.scrollBy((deltaY / WHEEL_NOTCH_DELTA) * PANEL_ITEM_H);
  }

  handlePointerDown(mx: number, my: number): void {
    this.dragged = false;
    const point = modalFitPoint(this.fit, mx, my);
    const r = this.listRect;
    const insideList =
      point.x >= r.x && point.x <= r.x + r.w && point.y >= r.y && point.y <= r.y + r.h;
    this.pressY = insideList ? point.y : null;
    this.pressScrollY = this.scrollY;
  }

  handlePointerMove(mx: number, my: number): void {
    if (this.pressY === null) return;
    const point = modalFitPoint(this.fit, mx, my);
    const travel = this.pressY - point.y;
    if (Math.abs(travel) > DRAG_THRESHOLD) this.dragged = true;
    if (!this.dragged) return;
    this.scrollY = this.pressScrollY;
    this.scrollBy(travel);
  }

  handlePointerUp(): void {
    this.pressY = null;
  }

  renderShopPanel(ctx: CanvasRenderingContext2D, active: Player, inactive: Player): void {
    if (!this.shopOpen) return;
    const cw = viewportWidth();
    const ch = viewportHeight();

    drawOverlay(ctx, { canvasWidth: cw, canvasHeight: ch, alpha: PANEL_OVERLAY_ALPHA });

    const rows = this.currentRows(active, inactive);
    // An empty Sell tab still reserves one row's worth of height, for the
    // "nothing to sell" message — otherwise the panel would shrink to just
    // its header and footer with nowhere to say why the list is bare.
    const visibleRows = this.visibleRowCount(Math.max(1, rows.length));
    const listH = visibleRows * PANEL_ITEM_H;
    const panelH = PANEL_HEADER_H + listH + PANEL_FOOTER_H;
    this.fit = fitPanel(PANEL_W, panelH);
    beginModalFit(ctx, this.fit);
    setButtonPointerSpace(this.fit.scale, this.fit.pivotX, this.fit.pivotY);

    const panelX = cw / 2 - PANEL_W / 2;
    const panelY = ch / 2 - panelH / 2;
    const listTop = panelY + PANEL_FIRST_ROW_Y;
    const listBottom = listTop + listH;
    this.maxScrollY = Math.max(0, (rows.length - visibleRows) * PANEL_ITEM_H);
    this.scrollY = Math.min(this.scrollY, this.maxScrollY);
    this.listRect = { x: panelX, y: listTop, w: PANEL_W, h: listH };

    drawBox(ctx, {
      x: panelX,
      y: panelY,
      width: PANEL_W,
      height: panelH,
      fill: PANEL_FILL_COLOR,
      border: PANEL_BORDER_COLOR,
      borderWidth: PANEL_BORDER_WIDTH,
      radius: 0,
    });

    ctx.strokeStyle = '#6a5420';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      panelX + PANEL_INNER_INSET,
      panelY + PANEL_INNER_INSET,
      PANEL_W - PANEL_INNER_SIZE_REDUCTION,
      panelH - PANEL_INNER_SIZE_REDUCTION,
    );

    drawText(ctx, this.title, {
      x: cw / 2,
      y: panelY + PANEL_TITLE_Y - PANEL_TITLE_BASELINE,
      size: PANEL_TITLE_SIZE,
      bold: true,
      color: '#f0d870',
      align: 'center',
    });

    ctx.strokeStyle = '#6a5420';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(panelX + PANEL_SEPARATOR_X_MARGIN, panelY + PANEL_SEPARATOR_Y);
    ctx.lineTo(panelX + PANEL_W - PANEL_SEPARATOR_X_MARGIN, panelY + PANEL_SEPARATOR_Y);
    ctx.stroke();

    drawText(ctx, `Coins: ${partyCoins(active, inactive)}`, {
      x: cw / 2,
      y: panelY + PANEL_COINS_Y - PANEL_COINS_BASELINE,
      size: PANEL_COINS_TEXT_SIZE,
      color: '#d4c070',
      align: 'center',
    });

    this.panelButtons = [];
    beginMenuFocus('shop');

    this.renderTabs(ctx, cw, panelY);

    ctx.save();
    ctx.beginPath();
    ctx.rect(panelX, listTop, PANEL_W, listH);
    ctx.clip();
    for (let i = 0; i < rows.length; i++) {
      const rowY = listTop + i * PANEL_ITEM_H - this.scrollY;
      if (rowY + PANEL_ITEM_H <= listTop || rowY >= listBottom) continue;
      this.renderRow(ctx, rows[i], panelX, rowY, i, listTop, listBottom);
    }
    ctx.restore();

    drawScrollbar(ctx, {
      x: panelX + PANEL_W - SCROLLBAR_X_FROM_RIGHT,
      trackY: listTop,
      trackH: listH,
      contentH: rows.length * PANEL_ITEM_H,
      scrollY: this.scrollY,
      width: SCROLLBAR_WIDTH,
    });

    if (rows.length === 0) {
      drawText(ctx, "Nothing here you're able to sell.", {
        x: panelX + PANEL_W / 2,
        y: listTop + PANEL_ITEM_H / 2,
        size: PANEL_DESC_SIZE,
        color: '#8a7a50',
        align: 'center',
      });
    }

    addButton(ctx, this.panelButtons, {
      x: cw / 2,
      y: panelY + panelH - PANEL_CLOSE_BTN_Y_FROM_BOTTOM,
      width: PANEL_CLOSE_BTN_W,
      height: PANEL_CLOSE_BTN_H,
      alignX: 'center',
      label: '[Space / Esc]  Close',
      labelSize: PANEL_CLOSE_SIZE,
      ...BUTTON_PRESETS.primary,
      radius: 0,
      primaryAction: true,
      action: () => {
        this.shopOpen = false;
      },
    });
    endMenuFocus();

    endModalFit(ctx);
    resetButtonPointerSpace();
  }

  /** The Buy/Sell toggle. Registered through `addButton` so it joins the same focus ring, click list and render pass as every other row. */
  private renderTabs(ctx: CanvasRenderingContext2D, cw: number, panelY: number): void {
    const totalW = TAB_BUTTON_W * 2 + TAB_BUTTON_GAP;
    const startX = cw / 2 - totalW / 2;
    const y = panelY + TAB_BUTTON_Y;
    (['buy', 'sell'] as const).forEach((tab, i) => {
      const active = this.mode === tab;
      addButton(ctx, this.panelButtons, {
        x: startX + i * (TAB_BUTTON_W + TAB_BUTTON_GAP),
        y,
        width: TAB_BUTTON_W,
        height: TAB_BUTTON_H,
        ...(active ? BUTTON_PRESETS.toggleActive : BUTTON_PRESETS.toggle),
        label: tab === 'buy' ? 'Buy' : 'Sell',
        labelSize: TAB_LABEL_SIZE,
        radius: 0,
        action: () => {
          this.mode = tab;
          this.scrollY = 0;
        },
      });
    });
  }

  private renderRow(
    ctx: CanvasRenderingContext2D,
    row: PanelRow,
    panelX: number,
    rowY: number,
    i: number,
    listTop: number,
    listBottom: number,
  ): void {
    ctx.fillStyle =
      i % 2 === 0
        ? `rgba(255,245,200,${PANEL_ROW_EVEN_ALPHA})`
        : `rgba(0,0,0,${PANEL_ROW_ALT_ALPHA})`;
    ctx.fillRect(
      panelX + PANEL_ROW_BG_INSET_X,
      rowY + 2,
      PANEL_W - PANEL_ROW_BG_INSET_W,
      PANEL_ITEM_H - PANEL_ROW_BG_INSET_H,
    );

    drawText(ctx, row.label, {
      x: panelX + PANEL_ITEM_X_MARGIN,
      y: rowY + PANEL_ITEM_NAME_Y - PANEL_ITEM_NAME_BASELINE,
      size: PANEL_ITEM_NAME_SIZE,
      bold: true,
      color: row.enabled ? '#e8d898' : '#6a5a40',
    });

    drawText(ctx, row.desc, {
      x: panelX + PANEL_ITEM_X_MARGIN,
      y: rowY + PANEL_ITEM_DESC_Y - PANEL_ITEM_DESC_BASELINE,
      size: PANEL_DESC_SIZE,
      color: row.enabled ? '#8a7a50' : '#4a3a28',
    });

    drawText(ctx, row.priceLabel, {
      x: panelX + PANEL_W - PANEL_PRICE_X_FROM_RIGHT,
      y: rowY + PANEL_ITEM_NAME_Y - PANEL_ITEM_NAME_BASELINE,
      size: PANEL_ITEM_NAME_SIZE,
      bold: true,
      color: row.enabled ? '#f0d040' : '#6a5820',
      align: 'right',
    });

    const btnX = panelX + PANEL_W - PANEL_BTN_W - PANEL_BTN_X_MARGIN;
    const btnY = rowY + (PANEL_ITEM_H - PANEL_BTN_H) / 2;
    // A half-scrolled action button would be drawn clipped yet still hittable
    // through the clip edge, so only whole buttons exist.
    const buttonFullyVisible = btnY >= listTop && btnY + PANEL_BTN_H <= listBottom;
    if (!buttonFullyVisible) return;

    addButton(ctx, this.panelButtons, {
      x: btnX,
      y: btnY,
      width: PANEL_BTN_W,
      height: PANEL_BTN_H,
      label: row.actionLabel,
      fill: row.enabled ? ROW_ENABLED_FILL : ROW_DISABLED_FILL,
      border: row.enabled ? ROW_ENABLED_BORDER : ROW_DISABLED_BORDER,
      borderWidth: PANEL_BTN_BORDER_W,
      radius: 0,
      labelSize: PANEL_BTN_TEXT_SIZE,
      labelColor: row.enabled ? ROW_ENABLED_LABEL : ROW_DISABLED_LABEL,
      disabled: !row.enabled,
      action: row.onAction,
    });
  }

  handleClick(mx: number, my: number): void {
    if (!this.shopOpen) return;
    if (this.dragged) {
      this.dragged = false;
      return;
    }
    const point = modalFitPoint(this.fit, mx, my);
    for (const button of this.panelButtons) {
      if (
        point.x >= button.x &&
        point.x <= button.x + button.w &&
        point.y >= button.y &&
        point.y <= button.y + button.h
      ) {
        button.action?.();
        return;
      }
    }
  }

  private tryBuy(itemIdx: number, player: Player, companion: Player): void {
    const item = this.items[itemIdx];
    if (this.remainingStock(item) === 0) {
      this.feedbackMsg = SOLD_OUT_LABEL;
      this.feedbackTimer = FEEDBACK_TIMER_FRAMES;
      return;
    }
    const price = this.buyPriceOf(item.id);
    if (!canAffordCoins(player, companion, price)) {
      this.feedbackMsg = 'Not enough coins!';
      this.feedbackTimer = FEEDBACK_TIMER_FRAMES;
      return;
    }
    const before = player.inventory.countOf(item.id);
    player.inventory.addItem(item.id, 1);
    const after = player.inventory.countOf(item.id);
    if (after <= before) {
      this.feedbackMsg = 'Inventory is full!';
      this.feedbackTimer = FEEDBACK_TIMER_FRAMES;
      return;
    }
    spendPartyCoins(player, companion, price, player);
    consumeStock(this.stockConfig.stock, this.stockConfig.vendorId, item);
    // Buying back a unit the shop is holding because the player sold it here
    // works the price back up toward its normal level.
    if (this.heldUnits(item.id) > 0) {
      removeHeldStock(this.stockConfig.stock.held, this.stockConfig.vendorId, item.id);
    }
    this.feedbackMsg = `Bought ${item.label}!`;
    this.feedbackTimer = FEEDBACK_TIMER_FRAMES;
    this.purchasePending = true;
  }

  private trySell(id: ItemId, player: Player): void {
    const price = this.sellPriceOf(id);
    if (!player.inventory.removeOne(id)) {
      this.feedbackMsg = "You don't have one of those!";
      this.feedbackTimer = FEEDBACK_TIMER_FRAMES;
      return;
    }
    player.earnCoins(price);
    addHeldStock(this.stockConfig.stock.held, this.stockConfig.vendorId, id);
    this.feedbackMsg = `Sold ${ITEM_DEF[id].name} for ${price} coins.`;
    this.feedbackTimer = FEEDBACK_TIMER_FRAMES;
    this.purchasePending = true;
  }
}
