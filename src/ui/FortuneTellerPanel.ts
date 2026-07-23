/**
 * The fortune teller's panel. The player pays a coin per reading: three face-down
 * cards are shown, tapping one flips it and reveals a fortune (see
 * `townFortunes.ts`), then they can Draw Again (another coin) or Close. Built on
 * the shared Button/Box/TextBox utilities so mouse and touch both work — cards
 * and buttons are hit-tested rects, a tap outside the modal closes it, and the
 * close hint adapts to the platform.
 *
 * The owning scene drives open/close, routes Space/Esc/click here through its
 * input-priority chain, and calls `setButtonMouseState` each frame.
 */

import { platform } from '../core/Platform';
import { drawModal, drawOverlay, BOX_PRESETS } from './Box';
import { drawButton, BUTTON_PRESETS, type ButtonResult } from './Button';
import { drawText } from './TextBox';
import { drawFortune } from '../systems/townFortunes';
import type { Player } from '../Player';
import type { TownDialogContext } from '../systems/townDialog';

const FORTUNE_COST = 3;

const PANEL_WIDTH = 420;
const PANEL_HEIGHT = 240;
const PANEL_PADDING = 20;
const PANEL_RADIUS = 8;
const OVERLAY_ALPHA = 0.55;

const TITLE_SIZE = 17;
const PROMPT_SIZE = 12;
const COINS_SIZE = 12;
const FORTUNE_SIZE = 13;
const FORTUNE_LINE_HEIGHT = 19;

const CARD_COUNT = 3;
const CARD_WIDTH = 64;
const CARD_HEIGHT = 88;
const CARD_GAP = 20;
const CARD_LABEL_SIZE = 30;
const CARD_ROW_TOP = 70;

const FOOTER_BTN_WIDTH = 130;
const FOOTER_BTN_HEIGHT = 30;
const FOOTER_BTN_GAP = 12;
const FOOTER_LABEL_SIZE = 11;
const FORTUNE_TEXT_TOP = 58;

const CARD_PRESET = { fill: '#2a2140', border: '#a855f7', borderWidth: 2, radius: 6 } as const;

export class FortuneTellerPanel {
  private open = false;
  private context: TownDialogContext | null = null;
  private fortune: string | null = null;
  private cardButtons: ButtonResult[] = [];
  private actionButtons: ButtonResult[] = [];
  private closeButton: ButtonResult | null = null;
  private modalContains: ((px: number, py: number) => boolean) | null = null;

  get isOpen(): boolean {
    return this.open;
  }

  openWith(context: TownDialogContext): void {
    this.open = true;
    this.context = context;
    this.fortune = null;
  }

  close(): void {
    this.open = false;
    this.context = null;
    this.fortune = null;
    this.cardButtons = [];
    this.actionButtons = [];
    this.closeButton = null;
    this.modalContains = null;
  }

  render(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, active: Player): void {
    if (!this.open) return;

    drawOverlay(ctx, {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      alpha: OVERLAY_ALPHA,
    });
    const modal = drawModal(ctx, {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      width: PANEL_WIDTH,
      height: PANEL_HEIGHT,
      radius: PANEL_RADIUS,
      shadow: true,
      ...BOX_PRESETS.modal,
    });
    this.modalContains = (px, py) => modal.contains(px, py);

    const centerX = modal.x + PANEL_WIDTH / 2;
    drawText(ctx, 'Madame Voss, Seer', {
      x: centerX,
      y: modal.inner.y + PANEL_PADDING,
      size: TITLE_SIZE,
      bold: true,
      color: '#d8b4fe',
      align: 'center',
      outline: true,
    });
    drawText(ctx, `Coins: ${active.coins}`, {
      x: modal.x + PANEL_WIDTH - PANEL_PADDING,
      y: modal.inner.y + PANEL_PADDING,
      size: COINS_SIZE,
      bold: true,
      color: '#d4c070',
      align: 'right',
    });

    const canAfford = active.coins >= FORTUNE_COST;
    if (this.fortune === null) {
      this.renderCards(ctx, modal.inner.y, centerX, canAfford);
    } else {
      this.renderFortune(ctx, modal.x, modal.inner.y);
    }

    this.renderFooter(ctx, modal.y, centerX, canAfford);
  }

  private renderCards(
    ctx: CanvasRenderingContext2D,
    innerY: number,
    centerX: number,
    canAfford: boolean,
  ): void {
    drawText(ctx, `Cross my palm with silver — ${FORTUNE_COST} coins a reading.`, {
      x: centerX,
      y: innerY + PANEL_PADDING + TITLE_SIZE + PROMPT_SIZE,
      size: PROMPT_SIZE,
      color: canAfford ? '#c4b5e0' : '#9a7fb0',
      align: 'center',
    });

    this.cardButtons = [];
    const rowWidth = CARD_COUNT * CARD_WIDTH + (CARD_COUNT - 1) * CARD_GAP;
    let cardX = centerX - rowWidth / 2;
    const cardY = innerY + CARD_ROW_TOP;
    for (let i = 0; i < CARD_COUNT; i++) {
      const card = drawButton(ctx, {
        x: cardX,
        y: cardY,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        label: '?',
        labelSize: CARD_LABEL_SIZE,
        labelColor: '#e9d5ff',
        disabled: !canAfford,
        ...CARD_PRESET,
      });
      this.cardButtons.push(card);
      cardX += CARD_WIDTH + CARD_GAP;
    }
  }

  private renderFortune(ctx: CanvasRenderingContext2D, modalX: number, innerY: number): void {
    const text = this.fortune ?? '';
    drawText(ctx, `"${text}"`, {
      x: modalX + PANEL_PADDING,
      y: innerY + FORTUNE_TEXT_TOP,
      size: FORTUNE_SIZE,
      color: '#e2d9f0',
      align: 'center',
      width: PANEL_WIDTH - PANEL_PADDING * 2,
      lineHeight: FORTUNE_LINE_HEIGHT,
    });
  }

  private renderFooter(
    ctx: CanvasRenderingContext2D,
    modalY: number,
    centerX: number,
    canAfford: boolean,
  ): void {
    this.actionButtons = [];
    const footerY = modalY + PANEL_HEIGHT - PANEL_PADDING - FOOTER_BTN_HEIGHT;

    if (this.fortune === null) {
      const closeHint = platform.isMobile ? 'Close' : 'Close  [Space / Esc]';
      this.closeButton = drawButton(ctx, {
        x: centerX,
        y: footerY,
        width: FOOTER_BTN_WIDTH,
        height: FOOTER_BTN_HEIGHT,
        alignX: 'center',
        label: closeHint,
        labelSize: FOOTER_LABEL_SIZE,
        ...BUTTON_PRESETS.primary,
      });
      return;
    }

    const totalWidth = FOOTER_BTN_WIDTH * 2 + FOOTER_BTN_GAP;
    const drawAgain = drawButton(ctx, {
      x: centerX - totalWidth / 2,
      y: footerY,
      width: FOOTER_BTN_WIDTH,
      height: FOOTER_BTN_HEIGHT,
      label: `Draw Again (${FORTUNE_COST}c)`,
      labelSize: FOOTER_LABEL_SIZE,
      disabled: !canAfford,
      ...BUTTON_PRESETS.gold,
    });
    this.actionButtons.push(drawAgain);

    this.closeButton = drawButton(ctx, {
      x: centerX + FOOTER_BTN_GAP / 2,
      y: footerY,
      width: FOOTER_BTN_WIDTH,
      height: FOOTER_BTN_HEIGHT,
      label: platform.isMobile ? 'Close' : 'Close  [Esc]',
      labelSize: FOOTER_LABEL_SIZE,
      ...BUTTON_PRESETS.primary,
    });
  }

  /**
   * Routes a click/tap: pays for and reveals a fortune when a face-down card or
   * Draw Again is tapped, closes on the Close button or a tap outside the modal,
   * and swallows other in-modal taps without closing. Returns whether consumed
   * (always true while open, so the tap can't fall through to move/attack).
   */
  handleClick(mx: number, my: number, active: Player): boolean {
    if (!this.open) return false;

    if (this.fortune === null) {
      for (const card of this.cardButtons) {
        if (card.contains(mx, my)) {
          this.payAndReveal(active);
          return true;
        }
      }
    } else {
      for (const btn of this.actionButtons) {
        if (btn.contains(mx, my)) {
          this.payAndReveal(active);
          return true;
        }
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

  private payAndReveal(active: Player): void {
    if (active.coins < FORTUNE_COST || this.context === null) return;
    active.coins -= FORTUNE_COST;
    this.fortune = drawFortune(this.context);
  }
}
