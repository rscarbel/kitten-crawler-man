/**
 * QuestDialog — shared paged modal dialog for quest systems. Owns pagination,
 * the advance button, and rendering; callers supply pages and a completion
 * callback. Extracted from CircusQuestSystem so every questline renders
 * dialog the same way.
 */

import { pointInRect } from '../utils';
import type { AudioManager } from '../audio/AudioManager';
import { drawText } from './TextBox';
import { drawButton, playButtonSound, BUTTON_PRESETS } from './Button';
import { drawModal, BOX_PRESETS } from './Box';

/** One page of quest dialog: a speaker/heading, body lines, and a button label. */
export interface DialogPage {
  title: string;
  lines: string[];
  /** Label for the advance button on this page. */
  button: string;
}

const DIALOG_WIDTH = 460;
const DIALOG_CANVAS_PADDING = 40;
const DIALOG_BASE_HEIGHT = 72;
const DIALOG_BUTTON_AREA_HEIGHT = 52;
const DIALOG_LINE_SPACING = 17;
const DIALOG_PAD_X = 18;
const DIALOG_TITLE_Y_OFFSET = 14;
const DIALOG_TITLE_SIZE = 14;
const DIALOG_LINE_START_Y = 40;
const DIALOG_LINE_SIZE = 12;
const DIALOG_BTN_W = 150;
const DIALOG_BTN_H = 30;
const DIALOG_BTN_Y_FROM_BOTTOM = 42;
const DIALOG_BTN_LABEL_SIZE = 12;
const DIALOG_PAGE_COUNTER_SIZE = 10;

export class QuestDialog {
  private pages: ReadonlyArray<DialogPage> = [];
  private pageIndex = 0;
  private onComplete: (() => void) | null = null;
  private buttonRect: { x: number; y: number; w: number; h: number } | null = null;

  constructor(private readonly audio: AudioManager | null) {}

  get isOpen(): boolean {
    return this.pages.length > 0;
  }

  /** Opens the dialog on its first page. `onComplete` fires when the last page is advanced. */
  open(pages: ReadonlyArray<DialogPage>, onComplete: () => void): void {
    if (pages.length === 0) {
      onComplete();
      return;
    }
    this.pages = pages;
    this.pageIndex = 0;
    this.onComplete = onComplete;
  }

  /** Esc: closes without firing `onComplete`. Returns true if a dialog was open. */
  dismiss(): boolean {
    if (!this.isOpen) return false;
    this.close();
    return true;
  }

  private close(): void {
    this.pages = [];
    this.pageIndex = 0;
    this.onComplete = null;
    this.buttonRect = null;
  }

  /** Returns true when the click was consumed — dialogs are modal while open. */
  handleClick(mx: number, my: number): boolean {
    if (!this.isOpen) return false;
    if (this.buttonRect && pointInRect(mx, my, this.buttonRect)) {
      playButtonSound(this.audio);
      if (this.pageIndex < this.pages.length - 1) {
        this.pageIndex++;
      } else {
        const done = this.onComplete;
        this.close();
        done?.();
      }
    }
    return true;
  }

  render(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    if (!this.isOpen) return;
    const page = this.pages[this.pageIndex];
    const dw = Math.min(DIALOG_WIDTH, canvas.width - DIALOG_CANVAS_PADDING);
    const dh =
      DIALOG_BASE_HEIGHT + page.lines.length * DIALOG_LINE_SPACING + DIALOG_BUTTON_AREA_HEIGHT;

    const box = drawModal(ctx, {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      width: dw,
      height: dh,
      ...BOX_PRESETS.modal,
    });

    drawText(ctx, page.title, {
      x: box.x + DIALOG_PAD_X,
      y: box.y + DIALOG_TITLE_Y_OFFSET,
      size: DIALOG_TITLE_SIZE,
      bold: true,
      color: '#8ae0d0',
    });

    for (let i = 0; i < page.lines.length; i++) {
      drawText(ctx, page.lines[i], {
        x: box.x + DIALOG_PAD_X,
        y: box.y + DIALOG_LINE_START_Y + i * DIALOG_LINE_SPACING,
        size: DIALOG_LINE_SIZE,
        color: '#e2e8f0',
      });
    }

    if (this.pages.length > 1) {
      drawText(ctx, `${this.pageIndex + 1} / ${this.pages.length}`, {
        x: box.x + dw - DIALOG_PAD_X,
        y: box.y + DIALOG_TITLE_Y_OFFSET,
        size: DIALOG_PAGE_COUNTER_SIZE,
        color: 'rgba(200,200,200,0.6)',
        align: 'right',
      });
    }

    const btnX = box.x + dw / 2 - DIALOG_BTN_W / 2;
    const btnY = box.y + dh - DIALOG_BTN_Y_FROM_BOTTOM;
    drawButton(ctx, {
      x: btnX,
      y: btnY,
      width: DIALOG_BTN_W,
      height: DIALOG_BTN_H,
      label: page.button,
      ...BUTTON_PRESETS.primary,
      labelSize: DIALOG_BTN_LABEL_SIZE,
    });
    this.buttonRect = { x: btnX, y: btnY, w: DIALOG_BTN_W, h: DIALOG_BTN_H };
  }
}
