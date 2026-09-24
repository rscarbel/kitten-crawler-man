/**
 * A standalone yes/no modal for a single confirmation — "Deposit 40 stone?",
 * "Abandon this repair?". Not owned by any scene. An owner wires:
 *   1. `render(ctx)` every frame while `isOpen`.
 *   2. `handleClick(mx, my)` from the scene's click router, ahead of world clicks.
 *   3. `handleKey(key)` from the scene's keydown chain — Esc answers No, Enter Yes.
 *   4. Push `overlayClaim()` into the scene's `overlayClaims` list.
 *
 * The keyboard focus ring needs no separate wiring: `render()` opens and
 * closes it internally, the same way every other standalone panel does.
 */

import {
  drawModal,
  BOX_PRESETS,
  type ModalFit,
  MODAL_FIT_NONE,
  fitModal,
  beginModalFit,
  endModalFit,
  modalFitPoint,
} from './Box';
import {
  addButton,
  beginMenuFocus,
  clearMenuFocus,
  endMenuFocus,
  setButtonPointerSpace,
  resetButtonPointerSpace,
  playButtonSound,
  BUTTON_PRESETS,
  type ButtonResult,
} from './Button';
import { drawText, measureTextBox, TEXT_PRESETS } from './TextBox';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import type { OverlayInputClaim } from '../systems/kits/OverlayClaims';
import type { AudioManager } from '../audio/AudioManager';

/** The id `render()` declares with `beginMenuFocus` — matched by `verify-menus.ts`. */
const CONFIRM_MODAL_FOCUS_CONTEXT = 'confirm-modal';

const PANEL_WIDTH = 320;
const PANEL_PADDING = 20;
const TITLE_SIZE = 16;
const MESSAGE_SIZE = 13;
const MESSAGE_LINE_HEIGHT = 18;
const TITLE_GAP = 26;
const MESSAGE_TOP_GAP = 8;
const FOOTER_GAP_ABOVE = 20;
const FOOTER_BTN_HEIGHT = 44;
const FOOTER_BTN_WIDTH = 130;
const FOOTER_GAP = 14;

export interface ConfirmModalOptions {
  title?: string;
  message: string;
  yesLabel: string;
  noLabel: string;
  onYes: () => void;
  onNo: () => void;
}

export class ConfirmModal {
  private options: ConfirmModalOptions | null = null;
  private fit: ModalFit = MODAL_FIT_NONE;
  private modalContains: ((px: number, py: number) => boolean) | null = null;
  private yesButton: ButtonResult | null = null;
  private noButton: ButtonResult | null = null;

  constructor(private readonly audio: AudioManager | null) {}

  get isOpen(): boolean {
    return this.options !== null;
  }

  open(options: ConfirmModalOptions): void {
    this.options = options;
    clearMenuFocus();
  }

  close(): void {
    this.options = null;
    this.modalContains = null;
    this.yesButton = null;
    this.noButton = null;
    clearMenuFocus();
  }

  private answerYes(): void {
    const onYes = this.options?.onYes;
    playButtonSound(this.audio);
    this.close();
    onYes?.();
  }

  private answerNo(): void {
    const onNo = this.options?.onNo;
    playButtonSound(this.audio);
    this.close();
    onNo?.();
  }

  render(ctx: CanvasRenderingContext2D): void {
    const options = this.options;
    if (options === null) return;

    const contentWidth = PANEL_WIDTH - PANEL_PADDING * 2;
    const messageLineCount = measureTextBox(ctx, options.message, {
      size: MESSAGE_SIZE,
      width: contentWidth,
      lineHeight: MESSAGE_LINE_HEIGHT,
    }).lineCount;
    const titleHeight = options.title === undefined ? 0 : TITLE_GAP;
    const messageHeight = messageLineCount * MESSAGE_LINE_HEIGHT;
    const height =
      PANEL_PADDING +
      titleHeight +
      MESSAGE_TOP_GAP +
      messageHeight +
      FOOTER_GAP_ABOVE +
      FOOTER_BTN_HEIGHT +
      PANEL_PADDING;

    this.fit = fitModal(height);
    beginModalFit(ctx, this.fit);
    setButtonPointerSpace(this.fit.scale, this.fit.pivotX, this.fit.pivotY);

    const modal = drawModal(ctx, {
      canvasWidth: viewportWidth(),
      canvasHeight: viewportHeight(),
      width: PANEL_WIDTH,
      height,
      radius: 8,
      shadow: true,
      ...BOX_PRESETS.modal,
    });
    this.modalContains = (px, py) => modal.contains(px, py);

    const centerX = modal.x + modal.width / 2;
    const contentLeft = modal.x + PANEL_PADDING;
    let y = modal.y + PANEL_PADDING;

    if (options.title !== undefined) {
      drawText(ctx, options.title, {
        x: centerX,
        y,
        align: 'center',
        ...TEXT_PRESETS.heading,
        size: TITLE_SIZE,
      });
      y += titleHeight;
    }

    drawText(ctx, options.message, {
      x: contentLeft,
      y: y + MESSAGE_TOP_GAP,
      size: MESSAGE_SIZE,
      align: 'center',
      width: contentWidth,
      lineHeight: MESSAGE_LINE_HEIGHT,
      color: '#e2e8f0',
    });
    y += MESSAGE_TOP_GAP + messageHeight + FOOTER_GAP_ABOVE;

    const buttons: Array<{ x: number; y: number; w: number; h: number; action?: () => void }> = [];
    beginMenuFocus(CONFIRM_MODAL_FOCUS_CONTEXT, true);
    const footerLeft = centerX - FOOTER_BTN_WIDTH - FOOTER_GAP / 2;
    const footerRight = centerX + FOOTER_GAP / 2;
    this.noButton = addButton(ctx, buttons, {
      x: footerLeft,
      y,
      width: FOOTER_BTN_WIDTH,
      height: FOOTER_BTN_HEIGHT,
      label: options.noLabel,
      ...BUTTON_PRESETS.primary,
      primaryAction: true,
      action: () => this.answerNo(),
    });
    this.yesButton = addButton(ctx, buttons, {
      x: footerRight,
      y,
      width: FOOTER_BTN_WIDTH,
      height: FOOTER_BTN_HEIGHT,
      label: options.yesLabel,
      ...BUTTON_PRESETS.success,
      action: () => this.answerYes(),
    });
    endMenuFocus();
    endModalFit(ctx);
    resetButtonPointerSpace();
  }

  /**
   * Routes a click/tap. Returns true whenever the modal is open — a stray tap
   * outside it answers No, same as Esc, rather than falling through to the world.
   */
  handleClick(canvasX: number, canvasY: number): boolean {
    if (this.options === null) return false;
    const { x: mx, y: my } = modalFitPoint(this.fit, canvasX, canvasY);
    if (this.yesButton?.contains(mx, my) === true) {
      this.answerYes();
      return true;
    }
    if (this.noButton?.contains(mx, my) === true) {
      this.answerNo();
      return true;
    }
    if (this.modalContains?.(mx, my) === true) return true;
    this.answerNo();
    return true;
  }

  /** Esc = No, Enter = Yes. Returns whether the key was consumed. */
  handleKey(key: string): boolean {
    if (this.options === null) return false;
    if (key === 'Escape') {
      this.answerNo();
      return true;
    }
    if (key === 'Enter') {
      this.answerYes();
      return true;
    }
    return true;
  }

  /** This modal's entry for the scene's `overlayClaims` list. */
  overlayClaim(): OverlayInputClaim {
    return {
      isOpen: this.isOpen,
      space: { kind: 'swallow' },
      locksKeyboard: true,
      haltsWorld: true,
      focusContext: CONFIRM_MODAL_FOCUS_CONTEXT,
    };
  }
}
