/**
 * The buy panel shown when the player browses a market stall in the town square.
 * Lists the stall's stock (see `townMarket.ts`) with a Buy button per item —
 * disabled when the player can't afford it — the player's coin balance, and a
 * Close button. Built on the shared `Button`/`Box`/`TextBox` utilities so hover,
 * press, and (critically) touch all work: every button is a hit-tested rect, a
 * tap outside the modal closes it, and the close hint adapts to the platform.
 *
 * The owning scene drives open/close, routes Space/Esc/click here through its
 * input-priority chain, and calls `setButtonMouseState` each frame so hover/press
 * state flows in.
 */

import { platform } from '../core/Platform';
import { drawModal, drawOverlay, BOX_PRESETS } from './Box';
import { drawButton, BUTTON_PRESETS, type ButtonResult } from './Button';
import { drawText } from './TextBox';
import type { Player } from '../Player';
import type { StallStock, StallItem } from '../systems/townMarket';

const PANEL_WIDTH = 400;
const PANEL_PADDING = 18;
const TITLE_SIZE = 17;
const BARK_SIZE = 11;
const HEADER_HEIGHT = 58;
const ROW_HEIGHT = 52;
const FOOTER_HEIGHT = 52;
const ITEM_NAME_SIZE = 13;
const ITEM_DESC_SIZE = 10;
const ITEM_DESC_GAP = 16;
const PRICE_SIZE = 12;

const BUY_BTN_WIDTH = 78;
const BUY_BTN_HEIGHT = 30;
const BUY_BTN_Y_LIFT = 2;
const BUY_LABEL_SIZE = 12;
const CLOSE_BTN_WIDTH = 120;
const CLOSE_BTN_HEIGHT = 30;
const CLOSE_LABEL_SIZE = 11;
const BARK_GAP = 6;
const PRICE_BTN_GAP = 12;
const ROW_TEXT_TOP_PAD = 2;

const FEEDBACK_FRAMES = 110;
const FEEDBACK_FADE_FRAMES = 25;
const PANEL_RADIUS = 8;
const OVERLAY_ALPHA = 0.55;

export class MarketStallPanel {
  private stock: StallStock | null = null;
  private feedback = '';
  private feedbackTimer = 0;
  private buyButtons: ButtonResult[] = [];
  private closeButton: ButtonResult | null = null;
  private modalContains: ((px: number, py: number) => boolean) | null = null;

  get isOpen(): boolean {
    return this.stock !== null;
  }

  open(stock: StallStock): void {
    this.stock = stock;
    this.feedback = stock.vendorBark;
    this.feedbackTimer = 0;
  }

  close(): void {
    this.stock = null;
    this.buyButtons = [];
    this.closeButton = null;
    this.modalContains = null;
  }

  update(): void {
    if (this.feedbackTimer > 0) this.feedbackTimer--;
  }

  render(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, active: Player): void {
    const stock = this.stock;
    if (stock === null) return;

    const height = HEADER_HEIGHT + stock.items.length * ROW_HEIGHT + FOOTER_HEIGHT;
    drawOverlay(ctx, {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      alpha: OVERLAY_ALPHA,
    });
    const modal = drawModal(ctx, {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      width: PANEL_WIDTH,
      height,
      radius: PANEL_RADIUS,
      shadow: true,
      ...BOX_PRESETS.modal,
    });
    this.modalContains = (px, py) => modal.contains(px, py);

    const centerX = modal.x + PANEL_WIDTH / 2;
    drawText(ctx, stock.title, {
      x: centerX,
      y: modal.inner.y + PANEL_PADDING,
      size: TITLE_SIZE,
      bold: true,
      color: '#f0d870',
      align: 'center',
      outline: true,
    });
    drawText(ctx, this.feedbackLine(stock), {
      x: centerX,
      y: modal.inner.y + PANEL_PADDING + TITLE_SIZE + BARK_GAP,
      size: BARK_SIZE,
      color: this.feedbackColor(),
      align: 'center',
    });

    drawText(ctx, `Coins: ${active.coins}`, {
      x: modal.x + PANEL_WIDTH - PANEL_PADDING,
      y: modal.inner.y + PANEL_PADDING,
      size: PRICE_SIZE,
      bold: true,
      color: '#d4c070',
      align: 'right',
    });

    this.buyButtons = [];
    const left = modal.inner.x + PANEL_PADDING;
    let rowY = modal.inner.y + HEADER_HEIGHT;
    for (const item of stock.items) {
      this.renderRow(ctx, item, active, left, rowY, modal.x + PANEL_WIDTH - PANEL_PADDING);
      rowY += ROW_HEIGHT;
    }

    const closeHint = platform.isMobile ? 'Close' : 'Close  [Space / Esc]';
    this.closeButton = drawButton(ctx, {
      x: centerX,
      y: modal.y + height - FOOTER_HEIGHT / 2,
      width: CLOSE_BTN_WIDTH,
      height: CLOSE_BTN_HEIGHT,
      alignX: 'center',
      alignY: 'middle',
      label: closeHint,
      labelSize: CLOSE_LABEL_SIZE,
      ...BUTTON_PRESETS.primary,
    });
  }

  private renderRow(
    ctx: CanvasRenderingContext2D,
    item: StallItem,
    active: Player,
    left: number,
    rowY: number,
    right: number,
  ): void {
    drawText(ctx, item.label, {
      x: left,
      y: rowY,
      size: ITEM_NAME_SIZE,
      bold: true,
      color: '#e2e8f0',
    });
    drawText(ctx, item.desc, {
      x: left,
      y: rowY + ITEM_DESC_GAP,
      size: ITEM_DESC_SIZE,
      color: '#94a3b8',
    });

    const canAfford = active.coins >= item.price;
    drawText(ctx, `${item.price}c`, {
      x: right - BUY_BTN_WIDTH - PRICE_BTN_GAP,
      y: rowY + ROW_TEXT_TOP_PAD,
      size: PRICE_SIZE,
      bold: true,
      color: canAfford ? '#facc15' : '#7f1d1d',
      align: 'right',
    });

    const button = drawButton(ctx, {
      x: right,
      y: rowY - BUY_BTN_Y_LIFT,
      width: BUY_BTN_WIDTH,
      height: BUY_BTN_HEIGHT,
      alignX: 'right',
      label: 'Buy',
      labelSize: BUY_LABEL_SIZE,
      disabled: !canAfford,
      ...BUTTON_PRESETS.success,
    });
    this.buyButtons.push(button);
  }

  /**
   * Routes a click/tap. Buys the item under a Buy button, closes on the Close
   * button or a tap outside the modal, and swallows (without closing) taps that
   * land elsewhere inside the modal — so a stray tap near a Buy button doesn't
   * dismiss a shop the player is mid-purchase in. Returns whether consumed
   * (always true while open, so the tap can't fall through to move/attack).
   */
  handleClick(mx: number, my: number, active: Player): boolean {
    const stock = this.stock;
    if (stock === null) return false;
    for (let i = 0; i < this.buyButtons.length; i++) {
      if (this.buyButtons[i].contains(mx, my)) {
        this.tryBuy(stock.items[i], active);
        return true;
      }
    }
    if (this.closeButton?.contains(mx, my) === true) {
      this.close();
      return true;
    }
    if (this.modalContains?.(mx, my) === true) {
      return true;
    }
    this.close();
    return true;
  }

  private tryBuy(item: StallItem, active: Player): void {
    if (active.coins < item.price) return;
    const before = active.inventory.countOf(item.id);
    active.inventory.addItem(item.id, 1);
    if (active.inventory.countOf(item.id) <= before) {
      this.showFeedback('Inventory is full!');
      return;
    }
    active.coins -= item.price;
    this.showFeedback(`Bought ${item.label}!`);
  }

  private showFeedback(msg: string): void {
    this.feedback = msg;
    this.feedbackTimer = FEEDBACK_FRAMES;
  }

  private feedbackLine(stock: StallStock): string {
    return this.feedbackTimer > 0 ? this.feedback : stock.vendorBark;
  }

  private feedbackColor(): string {
    if (this.feedbackTimer <= 0) return '#b9a06a';
    const fade = Math.min(1, this.feedbackTimer / FEEDBACK_FADE_FRAMES);
    return `rgba(210, 190, 110, ${fade})`;
  }
}
