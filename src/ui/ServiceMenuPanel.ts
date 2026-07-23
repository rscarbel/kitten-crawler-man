/**
 * A modal menu of priced services offered by an NPC you're standing in front of:
 * the tavern's drinks, the temple's blessing, the tattooist's ink. Each row is a
 * label, a short description, a price and a Buy button — disabled when the player
 * can't afford it or the service is already spent.
 *
 * Unlike `MarketStallPanel`, nothing here goes into the inventory: the panel takes
 * the coins and hands off to the caller's `onPurchase`, which performs the service
 * and returns the line to echo back at the player.
 *
 * Built on the shared `Button`/`Box`/`TextBox` utilities so hover, press, and
 * touch all work: every button is a hit-tested rect, a tap outside the modal
 * closes it, and the close hint adapts to the platform. The owning scene drives
 * open/close, routes Space/Esc/click here through its input-priority chain, and
 * calls `setButtonMouseState` each frame so hover/press state flows in.
 */

import { platform } from '../core/Platform';
import { drawModal, drawOverlay, BOX_PRESETS } from './Box';
import { drawButton, BUTTON_PRESETS, type ButtonResult } from './Button';
import { drawText } from './TextBox';
import type { Player } from '../Player';

export interface ServiceOption {
  /** Stable identifier for the service, so a handler can act on a rebuilt row. */
  key: string;
  label: string;
  price: number;
  desc: string;
  /** When set, the row is disabled and shows this instead of a price (e.g. "Already inked"). */
  unavailable?: string;
}

export interface ServiceMenu {
  title: string;
  /** The NPC's opening line, shown until a purchase replaces it with feedback. */
  bark: string;
  options: ReadonlyArray<ServiceOption>;
}

/** Performs the purchased service. Coins are already deducted; returns the line to echo. */
export type ServicePurchaseHandler = (option: ServiceOption, player: Player) => string;

/** Builds the current menu. Re-run after every purchase so availability stays honest. */
export type ServiceMenuBuilder = () => ServiceMenu;

const PANEL_WIDTH = 400;
const PANEL_PADDING = 18;
const TITLE_SIZE = 17;
const BARK_SIZE = 11;
const HEADER_HEIGHT = 58;
const ROW_HEIGHT = 52;
const FOOTER_HEIGHT = 52;
const OPTION_NAME_SIZE = 13;
const OPTION_DESC_SIZE = 10;
const OPTION_DESC_GAP = 16;
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
/**
 * Width the label/description column gets before word-wrap kicks in — the row's
 * full width minus the price and Buy button on the right. Without the cap, a long
 * description runs underneath the button.
 */
const OPTION_TEXT_MAX_WIDTH = PANEL_WIDTH - PANEL_PADDING * 2 - BUY_BTN_WIDTH - PRICE_BTN_GAP * 2;

const FEEDBACK_FRAMES = 110;
const FEEDBACK_FADE_FRAMES = 25;
const PANEL_RADIUS = 8;
const OVERLAY_ALPHA = 0.55;

export class ServiceMenuPanel {
  private menu: ServiceMenu | null = null;
  private buildMenu: ServiceMenuBuilder | null = null;
  private onPurchase: ServicePurchaseHandler | null = null;
  private feedback = '';
  private feedbackTimer = 0;
  private buyButtons: ButtonResult[] = [];
  private closeButton: ButtonResult | null = null;
  private modalContains: ((px: number, py: number) => boolean) | null = null;

  get isOpen(): boolean {
    return this.menu !== null;
  }

  open(buildMenu: ServiceMenuBuilder, onPurchase: ServicePurchaseHandler): void {
    this.buildMenu = buildMenu;
    this.menu = buildMenu();
    this.onPurchase = onPurchase;
    this.feedbackTimer = 0;
  }

  close(): void {
    this.menu = null;
    this.buildMenu = null;
    this.onPurchase = null;
    this.buyButtons = [];
    this.closeButton = null;
    this.modalContains = null;
  }

  update(): void {
    if (this.feedbackTimer > 0) this.feedbackTimer--;
  }

  render(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, active: Player): void {
    const menu = this.menu;
    if (menu === null) return;

    const height = HEADER_HEIGHT + menu.options.length * ROW_HEIGHT + FOOTER_HEIGHT;
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
    drawText(ctx, menu.title, {
      x: centerX,
      y: modal.inner.y + PANEL_PADDING,
      size: TITLE_SIZE,
      bold: true,
      color: '#f0d870',
      align: 'center',
      outline: true,
    });
    drawText(ctx, this.feedbackLine(menu), {
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
    for (const option of menu.options) {
      this.renderRow(ctx, option, active, left, rowY, modal.x + PANEL_WIDTH - PANEL_PADDING);
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
    option: ServiceOption,
    active: Player,
    left: number,
    rowY: number,
    right: number,
  ): void {
    drawText(ctx, option.label, {
      x: left,
      y: rowY,
      size: OPTION_NAME_SIZE,
      bold: true,
      color: '#e2e8f0',
    });
    drawText(ctx, option.desc, {
      x: left,
      y: rowY + OPTION_DESC_GAP,
      size: OPTION_DESC_SIZE,
      color: '#94a3b8',
      width: OPTION_TEXT_MAX_WIDTH,
    });

    const canAfford = active.coins >= option.price;
    const blockedReason = option.unavailable;
    const isAvailable = blockedReason === undefined;
    drawText(ctx, blockedReason ?? `${option.price}c`, {
      x: right - BUY_BTN_WIDTH - PRICE_BTN_GAP,
      y: rowY + ROW_TEXT_TOP_PAD,
      size: PRICE_SIZE,
      bold: true,
      color: isAvailable && canAfford ? '#facc15' : '#7f1d1d',
      align: 'right',
    });

    this.buyButtons.push(
      drawButton(ctx, {
        x: right,
        y: rowY - BUY_BTN_Y_LIFT,
        width: BUY_BTN_WIDTH,
        height: BUY_BTN_HEIGHT,
        alignX: 'right',
        label: 'Buy',
        labelSize: BUY_LABEL_SIZE,
        disabled: !canAfford || !isAvailable,
        ...BUTTON_PRESETS.success,
      }),
    );
  }

  /**
   * Routes a click/tap. Buys the option under a Buy button, closes on the Close
   * button or a tap outside the modal, and swallows (without closing) taps that
   * land elsewhere inside the modal — so a stray tap near a Buy button doesn't
   * dismiss a menu the player is mid-order in. Returns whether consumed (always
   * true while open, so the tap can't fall through to move/attack).
   */
  handleClick(mx: number, my: number, active: Player): boolean {
    const menu = this.menu;
    if (menu === null) return false;
    for (let i = 0; i < this.buyButtons.length; i++) {
      if (this.buyButtons[i].contains(mx, my)) {
        this.tryBuy(menu.options[i], active);
        return true;
      }
    }
    if (this.closeButton?.contains(mx, my) === true) {
      this.close();
      return true;
    }
    if (this.modalContains?.(mx, my) === true) return true;
    this.close();
    return true;
  }

  private tryBuy(option: ServiceOption, active: Player): void {
    const purchase = this.onPurchase;
    if (purchase === null) return;
    if (option.unavailable !== undefined) return;
    if (active.coins < option.price) return;
    active.coins -= option.price;
    const line = purchase(option, active);
    // A purchase can change what's still on offer — the last tattoo, the last
    // wound worth healing — so the rows are rebuilt before the next frame draws.
    this.menu = this.buildMenu?.() ?? this.menu;
    this.showFeedback(line);
  }

  private showFeedback(msg: string): void {
    this.feedback = msg;
    this.feedbackTimer = FEEDBACK_FRAMES;
  }

  private feedbackLine(menu: ServiceMenu): string {
    return this.feedbackTimer > 0 ? this.feedback : menu.bark;
  }

  private feedbackColor(): string {
    if (this.feedbackTimer <= 0) return '#b9a06a';
    const fade = Math.min(1, this.feedbackTimer / FEEDBACK_FADE_FRAMES);
    return `rgba(210, 190, 110, ${fade})`;
  }
}
