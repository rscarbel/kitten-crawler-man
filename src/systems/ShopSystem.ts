import { TILE_SIZE } from '../core/constants';
import type { ItemId } from '../core/ItemDefs';
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
import { drawShopkeeper } from '../sprites/shopkeeperSprite';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { consumeStock, remainingFor, type MarketStock } from './market/MarketStock';
import { SOLD_OUT_LABEL } from './market/vendorMenu';

const WANDER_MIN_TILE_OFFSET = 3;
const WANDER_MAX_TILE_INSET = 4;
const WANDER_DIR_CHANGE_INTERVAL = 200;
const WANDER_DIR_FLIP_CHANCE = 0.5;
const WANDER_SPEED = 0.4;
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
const BUY_AFFORDABLE_FILL = '#14400a';
const BUY_UNAFFORDABLE_FILL = '#281818';
const BUY_AFFORDABLE_BORDER = '#5aaa34';
const BUY_UNAFFORDABLE_BORDER = '#3a2020';
const BUY_AFFORDABLE_LABEL = '#c8e890';
const BUY_UNAFFORDABLE_LABEL = '#5a4040';
const PANEL_W = 400;
const PANEL_ITEM_H = 56;
const PANEL_HEADER_H = 72;
const PANEL_FOOTER_H = 44;
const PANEL_INNER_INSET = 5;
const PANEL_INNER_SIZE_REDUCTION = 10;
const PANEL_TITLE_Y = 26;
const PANEL_TITLE_BASELINE = 13;
const PANEL_TITLE_SIZE = 16;
const PANEL_SEPARATOR_X_MARGIN = 20;
const PANEL_SEPARATOR_Y = 34;
const PANEL_COINS_Y = 52;
const PANEL_COINS_BASELINE = 10;
const PANEL_COINS_TEXT_SIZE = 12;
const PANEL_FIRST_ROW_Y = 66;
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

/** Optional overrides that turn the default General Store into a bespoke vendor (bar, market, …). */
export interface ShopConfig {
  title: string;
  items: ReadonlyArray<ShopItem>;
}

/**
 * Backs a `ShopSystem`'s limited rows with the same cross-scene counter the
 * overworld market stalls use, so a line bought out at a club counter stays
 * sold out through a checkpoint restore or a reload the same way a market
 * stall does.
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

export class ShopSystem implements GameSystem {
  shopOpen = false;
  /** Set to true after a successful purchase; consuming scene clears it and plays the sound. */
  purchasePending = false;

  private shopkeeperTileY = 1;
  private wanderX: number;
  private wanderDir = 1;
  private wanderTime = 0;
  private wanderMinX: number;
  private wanderMaxX: number;

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
  private readonly stockConfig?: ShopStockConfig;

  constructor(interiorWidth: number, config?: ShopConfig, stockConfig?: ShopStockConfig) {
    this.title = config?.title ?? DEFAULT_SHOP_TITLE;
    this.items = config?.items ?? SHOP_ITEMS;
    this.stockConfig = stockConfig;
    this.wanderX = Math.floor(interiorWidth / 2) * TILE_SIZE;
    this.wanderMinX = WANDER_MIN_TILE_OFFSET * TILE_SIZE;
    this.wanderMaxX = (interiorWidth - WANDER_MAX_TILE_INSET) * TILE_SIZE;
  }

  /** Units left for a row, or `null` when the row is unlimited or this shop has no stock store. */
  private remainingStock(item: ShopItem): number | null {
    if (this.stockConfig === undefined) return null;
    return remainingFor(this.stockConfig.stock, this.stockConfig.vendorId, item);
  }

  update(): void {
    this.wanderTime++;
    if (this.wanderTime % WANDER_DIR_CHANGE_INTERVAL === 0) {
      this.wanderDir = Math.random() < WANDER_DIR_FLIP_CHANCE ? -1 : 1;
    }
    this.wanderX += this.wanderDir * WANDER_SPEED;
    if (this.wanderX < this.wanderMinX) {
      this.wanderX = this.wanderMinX;
      this.wanderDir = 1;
    }
    if (this.wanderX > this.wanderMaxX) {
      this.wanderX = this.wanderMaxX;
      this.wanderDir = -1;
    }
    if (this.feedbackTimer > 0) this.feedbackTimer--;
  }

  isNearShopkeeper(player: Player): boolean {
    const skPx = this.wanderX + TILE_SIZE * SHOPKEEPER_HALF_TILE;
    const skPy = this.shopkeeperTileY * TILE_SIZE + TILE_SIZE * SHOPKEEPER_HALF_TILE;
    return (
      Math.hypot(
        player.x + TILE_SIZE * SHOPKEEPER_HALF_TILE - skPx,
        player.y + TILE_SIZE * SHOPKEEPER_HALF_TILE - skPy,
      ) <
      TILE_SIZE * SHOPKEEPER_INTERACT_RANGE
    );
  }

  renderObjects(ctx: CanvasRenderingContext2D, camX: number, camY: number, active: Player): void {
    const ts = TILE_SIZE;
    const sx = this.wanderX - camX;
    const sy = this.shopkeeperTileY * ts - camY;
    drawShopkeeper(ctx, sx, sy, ts, this.wanderTime, this.wanderDir);

    if (!this.shopOpen && this.isNearShopkeeper(active)) {
      drawInteractionPrompt(ctx, sx, sy, ts, 'Shop');
    }
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

  /** Rows that fit on screen at a legible scale; the rest scroll. */
  private visibleRowCount(): number {
    const maxDesignHeight = (viewportHeight() - SHOP_VERTICAL_MARGIN * 2) / SHOP_COMFORT_SCALE;
    const rowsThatFit = Math.floor(
      (maxDesignHeight - PANEL_HEADER_H - PANEL_FOOTER_H) / PANEL_ITEM_H,
    );
    return Math.min(this.items.length, Math.max(SHOP_MIN_VISIBLE_ROWS, rowsThatFit));
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

  renderShopPanel(ctx: CanvasRenderingContext2D, active: Player): void {
    if (!this.shopOpen) return;
    const cw = viewportWidth();
    const ch = viewportHeight();

    drawOverlay(ctx, { canvasWidth: cw, canvasHeight: ch, alpha: PANEL_OVERLAY_ALPHA });

    const visibleRows = this.visibleRowCount();
    const listH = visibleRows * PANEL_ITEM_H;
    const panelH = PANEL_HEADER_H + listH + PANEL_FOOTER_H;
    this.fit = fitPanel(PANEL_W, panelH);
    beginModalFit(ctx, this.fit);
    setButtonPointerSpace(this.fit.scale, this.fit.pivotX, this.fit.pivotY);

    const panelX = cw / 2 - PANEL_W / 2;
    const panelY = ch / 2 - panelH / 2;
    const listTop = panelY + PANEL_FIRST_ROW_Y;
    const listBottom = listTop + listH;
    this.maxScrollY = Math.max(0, (this.items.length - visibleRows) * PANEL_ITEM_H);
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

    drawText(ctx, `Coins: ${active.coins}`, {
      x: cw / 2,
      y: panelY + PANEL_COINS_Y - PANEL_COINS_BASELINE,
      size: PANEL_COINS_TEXT_SIZE,
      color: '#d4c070',
      align: 'center',
    });

    this.panelButtons = [];
    beginMenuFocus('shop');

    ctx.save();
    ctx.beginPath();
    ctx.rect(panelX, listTop, PANEL_W, listH);
    ctx.clip();
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      const rowY = listTop + i * PANEL_ITEM_H - this.scrollY;
      if (rowY + PANEL_ITEM_H <= listTop || rowY >= listBottom) continue;
      const soldOut = this.remainingStock(item) === 0;
      const canAfford = !soldOut && active.coins >= item.price;

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

      drawText(ctx, item.label, {
        x: panelX + PANEL_ITEM_X_MARGIN,
        y: rowY + PANEL_ITEM_NAME_Y - PANEL_ITEM_NAME_BASELINE,
        size: PANEL_ITEM_NAME_SIZE,
        bold: true,
        color: canAfford ? '#e8d898' : '#6a5a40',
      });

      drawText(ctx, item.desc, {
        x: panelX + PANEL_ITEM_X_MARGIN,
        y: rowY + PANEL_ITEM_DESC_Y - PANEL_ITEM_DESC_BASELINE,
        size: PANEL_DESC_SIZE,
        color: canAfford ? '#8a7a50' : '#4a3a28',
      });

      drawText(ctx, soldOut ? SOLD_OUT_LABEL : `${item.price} coins`, {
        x: panelX + PANEL_W - PANEL_PRICE_X_FROM_RIGHT,
        y: rowY + PANEL_ITEM_NAME_Y - PANEL_ITEM_NAME_BASELINE,
        size: PANEL_ITEM_NAME_SIZE,
        bold: true,
        color: canAfford ? '#f0d040' : '#6a5820',
        align: 'right',
      });

      const btnX = panelX + PANEL_W - PANEL_BTN_W - PANEL_BTN_X_MARGIN;
      const btnY = rowY + (PANEL_ITEM_H - PANEL_BTN_H) / 2;
      // A half-scrolled Buy button would be drawn clipped yet still hittable
      // through the clip edge, so only whole buttons exist.
      const buttonFullyVisible = btnY >= listTop && btnY + PANEL_BTN_H <= listBottom;
      if (!buttonFullyVisible) continue;

      const itemIdx = i;
      addButton(ctx, this.panelButtons, {
        x: btnX,
        y: btnY,
        width: PANEL_BTN_W,
        height: PANEL_BTN_H,
        label: soldOut ? SOLD_OUT_LABEL : 'Buy',
        fill: canAfford ? BUY_AFFORDABLE_FILL : BUY_UNAFFORDABLE_FILL,
        border: canAfford ? BUY_AFFORDABLE_BORDER : BUY_UNAFFORDABLE_BORDER,
        borderWidth: PANEL_BTN_BORDER_W,
        radius: 0,
        labelSize: PANEL_BTN_TEXT_SIZE,
        labelColor: canAfford ? BUY_AFFORDABLE_LABEL : BUY_UNAFFORDABLE_LABEL,
        disabled: soldOut,
        action: () => this.tryBuy(itemIdx, active),
      });
    }
    ctx.restore();

    drawScrollbar(ctx, {
      x: panelX + PANEL_W - SCROLLBAR_X_FROM_RIGHT,
      trackY: listTop,
      trackH: listH,
      contentH: this.items.length * PANEL_ITEM_H,
      scrollY: this.scrollY,
      width: SCROLLBAR_WIDTH,
    });

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

  private tryBuy(itemIdx: number, player: Player): void {
    const item = this.items[itemIdx];
    if (this.remainingStock(item) === 0) {
      this.feedbackMsg = SOLD_OUT_LABEL;
      this.feedbackTimer = FEEDBACK_TIMER_FRAMES;
      return;
    }
    if (player.coins < item.price) {
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
    player.coins -= item.price;
    if (this.stockConfig !== undefined) {
      consumeStock(this.stockConfig.stock, this.stockConfig.vendorId, item);
    }
    this.feedbackMsg = `Bought ${item.label}!`;
    this.feedbackTimer = FEEDBACK_TIMER_FRAMES;
    this.purchasePending = true;
  }
}
