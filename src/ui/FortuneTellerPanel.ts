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
import {
  beginMenuFocus,
  drawButton,
  endMenuFocus,
  BUTTON_PRESETS,
  type ButtonResult,
} from './Button';
import { drawText } from './TextBox';
import { drawFortune, drawHildaReading } from '../systems/townFortunes';
import type { Player } from '../Player';
import type { TownDialogContext } from '../systems/townDialog';
import { viewportWidth, viewportHeight } from '../core/Viewport';

/**
 * Who is doing the reading. The panel is one surface with two acts behind it:
 * the plaza's card-flipping seer and the hedge witch in her own kitchen, who
 * charges less and does not own a deck.
 */
export interface FortuneReader {
  /** Shown as the panel's title. */
  readonly name: string;
  /** Coins per reading. */
  readonly cost: number;
  /** The line under the title, before a card is turned. */
  readonly invitation: string;
  readonly draw: (context: TownDialogContext) => string;
}

const PLAZA_SEER_COST = 3;
/** Hilda reads at her own table for less; the plaza pays for the theatre. */
const HEDGE_WITCH_COST = 2;

export const PLAZA_SEER: FortuneReader = {
  name: 'Madame Voss, Seer',
  cost: PLAZA_SEER_COST,
  invitation: `Cross my palm with silver — ${PLAZA_SEER_COST} coins a reading.`,
  draw: drawFortune,
};

export const HEDGE_WITCH: FortuneReader = {
  name: 'Old Hilda',
  cost: HEDGE_WITCH_COST,
  invitation: `${HEDGE_WITCH_COST} coins, and I will tell you what I actually see.`,
  draw: drawHildaReading,
};

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
  private reader: FortuneReader = PLAZA_SEER;
  private context: TownDialogContext | null = null;
  private fortune: string | null = null;
  private cardButtons: ButtonResult[] = [];
  private actionButtons: ButtonResult[] = [];
  private closeButton: ButtonResult | null = null;
  private modalContains: ((px: number, py: number) => boolean) | null = null;

  get isOpen(): boolean {
    return this.open;
  }

  openWith(context: TownDialogContext, reader: FortuneReader = PLAZA_SEER): void {
    this.open = true;
    this.reader = reader;
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

  render(ctx: CanvasRenderingContext2D, active: Player): void {
    if (!this.open) return;

    drawOverlay(ctx, {
      canvasWidth: viewportWidth(),
      canvasHeight: viewportHeight(),
      alpha: OVERLAY_ALPHA,
    });
    const modal = drawModal(ctx, {
      canvasWidth: viewportWidth(),
      canvasHeight: viewportHeight(),
      width: PANEL_WIDTH,
      height: PANEL_HEIGHT,
      radius: PANEL_RADIUS,
      shadow: true,
      ...BOX_PRESETS.modal,
    });
    this.modalContains = (px, py) => modal.contains(px, py);

    const centerX = modal.x + PANEL_WIDTH / 2;
    drawText(ctx, this.reader.name, {
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

    const canAfford = active.coins >= this.reader.cost;
    beginMenuFocus('fortune-teller');
    if (this.fortune === null) {
      this.renderCards(ctx, modal.inner.y, centerX, canAfford);
    } else {
      this.renderFortune(ctx, modal.x, modal.inner.y);
    }

    this.renderFooter(ctx, modal.y, centerX, canAfford);
    endMenuFocus();
  }

  private renderCards(
    ctx: CanvasRenderingContext2D,
    innerY: number,
    centerX: number,
    canAfford: boolean,
  ): void {
    drawText(ctx, this.reader.invitation, {
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
        primaryAction: true,
      });
      return;
    }

    const totalWidth = FOOTER_BTN_WIDTH * 2 + FOOTER_BTN_GAP;
    const drawAgain = drawButton(ctx, {
      x: centerX - totalWidth / 2,
      y: footerY,
      width: FOOTER_BTN_WIDTH,
      height: FOOTER_BTN_HEIGHT,
      label: `Draw Again (${this.reader.cost}c)`,
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
      primaryAction: true,
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
    if (active.coins < this.reader.cost || this.context === null) return;
    active.coins -= this.reader.cost;
    this.fortune = this.reader.draw(this.context);
  }
}
