/**
 * A standalone "how many?" modal: −10 / −1 / value / +1 / +10 / Max, a live
 * cost line, Confirm and Cancel. Used anywhere a player picks a quantity
 * against a cap — Fenna's bulk processing, a trebuchet's ammo deposit.
 *
 * Not owned by any scene. An owner wires exactly five things:
 *   1. `render(ctx)` every frame while `isOpen`.
 *   2. `handleClick(mx, my)` from the scene's click router, ahead of world clicks.
 *   3. `handleKey(key)` from the scene's keydown chain, ahead of gameplay keys.
 *   4. `handlePointerDown(mx, my)` / `handlePointerUp()` for hold-to-repeat on
 *      the step buttons, from the same mouse/touch events that already drive
 *      `setButtonMouseState`.
 *   5. `update()` once per frame — advances the hold-to-repeat timer. Safe to
 *      call even while closed.
 *   6. Push `overlayClaim()` into the scene's `overlayClaims` list so the
 *      keyboard gate and the world-halt test agree with what's on screen.
 *
 * The keyboard focus ring needs no separate wiring: `render()` opens and
 * closes it internally, the same way every other standalone panel does.
 */

import {
  drawBox,
  drawModal,
  beginModalFit,
  endModalFit,
  modalFitPoint,
  BOX_PRESETS,
  type ModalFit,
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
import { drawText, TEXT_PRESETS } from './TextBox';
import { fitPanel } from './panelFit';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import type { OverlayInputClaim } from '../systems/kits/OverlayClaims';
import type { AudioManager } from '../audio/AudioManager';
import {
  QuantityPickerState,
  QUANTITY_STEP_SMALL,
  QUANTITY_STEP_LARGE,
} from './QuantityPickerState';

/** The id `render()` declares with `beginMenuFocus` — matched by `verify-menus.ts`. */
const QUANTITY_PICKER_FOCUS_CONTEXT = 'quantity-picker';

const PANEL_WIDTH = 300;
const PANEL_PADDING = 20;
const TITLE_SIZE = 16;
const TITLE_GAP = 28;

/** Smallest a touch target can be and still land reliably under a fingertip. */
const MIN_TAP_TARGET = 44;
const STEP_BTN_SIZE = MIN_TAP_TARGET;
const STEP_BTN_GAP = 8;
const VALUE_BOX_WIDTH = 76;
const STEP_ROW_HEIGHT = STEP_BTN_SIZE;
const STEP_ROW_GAP_BELOW = 14;
const VALUE_TEXT_SIZE = 22;

const UNIT_LABEL_SIZE = 10;
const UNIT_LABEL_HEIGHT = 16;

const MAX_BTN_WIDTH = 80;
const MAX_BTN_HEIGHT = 34;
const MAX_BTN_GAP_BELOW = 16;

const COST_LINE_SIZE = 12;
const COST_LINE_GAP_BELOW = 16;

const FOOTER_BTN_HEIGHT = 44;
const FOOTER_BTN_WIDTH = 120;
const FOOTER_GAP = 12;

const STEP_LABEL_SIZE = 13;

/** Frames held before a step button starts auto-repeating. */
const HOLD_REPEAT_DELAY_FRAMES = 24;
/** Frames between repeats once the hold has been running past the initial delay. */
const HOLD_REPEAT_INTERVAL_FRAMES = 6;

interface QuantityPickerOptions {
  title: string;
  max: number;
  initial: number;
  unitLabel: string;
  /** Coin cost of one unit. Omitting it hides the cost line entirely. */
  costPerUnit?: number;
  /** Shown after the cost figure, e.g. "coins". Only used when `costPerUnit` is set. */
  currencyLabel?: string;
  confirmLabel: string;
  /**
   * Currency the player currently holds. Checked against `costPerUnit × qty`
   * to colour the cost line and disable Confirm when unaffordable. Omit when
   * this picker has no price, or when affordability shouldn't gate Confirm.
   */
  available?: number;
  onConfirm: (qty: number) => void;
  onCancel: () => void;
}

/** Which step button, if any, is currently being held down: a step delta, "max", or nothing. */
type HeldStep = number | 'max' | null;

export class QuantityPicker {
  private state: QuantityPickerState | null = null;
  private title = '';
  private unitLabel = '';
  private currencyLabel = '';
  private confirmLabel = '';
  private onConfirm: ((qty: number) => void) | null = null;
  private onCancel: (() => void) | null = null;

  private fit: ModalFit = { scale: 1, pivotX: 0, pivotY: 0 };
  private modalContains: ((px: number, py: number) => boolean) | null = null;
  private confirmButton: ButtonResult | null = null;
  private cancelButton: ButtonResult | null = null;
  private maxButton: ButtonResult | null = null;
  private stepButtons: Array<{ delta: number; button: ButtonResult }> = [];

  private heldStep: HeldStep = null;
  private heldFrames = 0;

  constructor(private readonly audio: AudioManager | null) {}

  get isOpen(): boolean {
    return this.state !== null;
  }

  open(options: QuantityPickerOptions): void {
    this.state = new QuantityPickerState({
      max: options.max,
      initial: options.initial,
      costPerUnit: options.costPerUnit,
      available: options.available,
    });
    this.title = options.title;
    this.unitLabel = options.unitLabel;
    this.currencyLabel = options.currencyLabel ?? '';
    this.confirmLabel = options.confirmLabel;
    this.onConfirm = options.onConfirm;
    this.onCancel = options.onCancel;
    this.heldStep = null;
    this.heldFrames = 0;
    // A picker shares one focus context across every use, so a step index left
    // over from the last time one was open would otherwise still be live when
    // a different one opens on a different quantity.
    clearMenuFocus();
  }

  close(): void {
    this.state = null;
    this.onConfirm = null;
    this.onCancel = null;
    this.modalContains = null;
    this.confirmButton = null;
    this.cancelButton = null;
    this.maxButton = null;
    this.stepButtons = [];
    this.heldStep = null;
    clearMenuFocus();
  }

  /** Whether the current quantity is confirmable — at least the minimum, and affordable. */
  private canConfirm(): boolean {
    const state = this.state;
    return state !== null && state.value >= state.min && state.canAfford;
  }

  /**
   * Confirms the current quantity. A no-op while unaffordable or below the
   * minimum, so Enter can't bypass the same guard the Confirm button's
   * `disabled` state enforces for a click.
   */
  private confirm(): void {
    const state = this.state;
    const onConfirm = this.onConfirm;
    if (state === null || onConfirm === null || !this.canConfirm()) return;
    playButtonSound(this.audio);
    const qty = state.value;
    this.close();
    onConfirm(qty);
  }

  private cancel(): void {
    const onCancel = this.onCancel;
    playButtonSound(this.audio);
    this.close();
    onCancel?.();
  }

  /** Advances the hold-to-repeat timer for a held step button. Call every frame, open or not. */
  update(): void {
    if (this.heldStep === null || this.state === null) return;
    this.heldFrames++;
    if (this.heldFrames < HOLD_REPEAT_DELAY_FRAMES) return;
    const framesPastDelay = this.heldFrames - HOLD_REPEAT_DELAY_FRAMES;
    if (framesPastDelay % HOLD_REPEAT_INTERVAL_FRAMES !== 0) return;
    this.applyHeldStep();
  }

  private applyHeldStep(): void {
    const state = this.state;
    if (state === null) return;
    if (this.heldStep === 'max') state.setToMax();
    else if (this.heldStep !== null) state.stepBy(this.heldStep);
  }

  render(ctx: CanvasRenderingContext2D): void {
    const state = this.state;
    if (state === null) return;

    this.fit = fitPanel(PANEL_WIDTH, this.designHeight());
    beginModalFit(ctx, this.fit);
    setButtonPointerSpace(this.fit.scale, this.fit.pivotX, this.fit.pivotY);

    const height = this.designHeight();
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
    let y = modal.y + PANEL_PADDING;

    drawText(ctx, this.title, {
      x: centerX,
      y,
      align: 'center',
      ...TEXT_PRESETS.heading,
      size: TITLE_SIZE,
    });
    y += TITLE_GAP;

    const buttons: Array<{ x: number; y: number; w: number; h: number; action?: () => void }> = [];
    beginMenuFocus(QUANTITY_PICKER_FOCUS_CONTEXT, true);

    // −10 / −1 / value / +1 / +10, evenly spaced across the panel width.
    const stepDeltas = [
      -QUANTITY_STEP_LARGE,
      -QUANTITY_STEP_SMALL,
      QUANTITY_STEP_SMALL,
      QUANTITY_STEP_LARGE,
    ];
    const rowWidth =
      STEP_BTN_SIZE * stepDeltas.length + VALUE_BOX_WIDTH + STEP_BTN_GAP * stepDeltas.length;
    let stepX = centerX - rowWidth / 2;
    this.stepButtons = [];

    // The value box sits in the middle of the row, between the −1 and +1 buttons.
    const valueBoxIndex = stepDeltas.length / 2;
    for (let i = 0; i < stepDeltas.length; i++) {
      if (i === valueBoxIndex) {
        drawBox(ctx, {
          x: stepX,
          y,
          width: VALUE_BOX_WIDTH,
          height: STEP_ROW_HEIGHT,
          radius: 4,
          ...BOX_PRESETS.panel,
        });
        // A trailing caret marks that digits typed so far are still live — the
        // shown number can otherwise look identical to a value reached with the
        // step buttons, with no way to tell whether another digit would append
        // or replace it.
        const valueLabel = state.isTyping ? `${state.value}|` : state.value.toString();
        drawText(ctx, valueLabel, {
          x: stepX + VALUE_BOX_WIDTH / 2,
          y: y + (STEP_ROW_HEIGHT - VALUE_TEXT_SIZE) / 2,
          size: VALUE_TEXT_SIZE,
          bold: true,
          color: '#facc15',
          align: 'center',
        });
        stepX += VALUE_BOX_WIDTH + STEP_BTN_GAP;
      }
      const delta = stepDeltas[i];
      const label = delta > 0 ? `+${delta}` : `${delta}`;
      const atBound = delta > 0 ? state.value >= state.max : state.value <= state.min;
      const button = addButton(ctx, buttons, {
        x: stepX,
        y,
        width: STEP_BTN_SIZE,
        height: STEP_BTN_SIZE,
        label,
        labelSize: STEP_LABEL_SIZE,
        disabled: atBound,
        ...BUTTON_PRESETS.primary,
        action: () => {
          state.stepBy(delta);
        },
      });
      this.stepButtons.push({ delta, button });
      stepX += STEP_BTN_SIZE + STEP_BTN_GAP;
    }
    y += STEP_ROW_HEIGHT + STEP_ROW_GAP_BELOW;

    drawText(ctx, this.unitLabel, {
      x: centerX,
      y,
      size: UNIT_LABEL_SIZE,
      align: 'center',
      color: '#94a3b8',
    });
    y += UNIT_LABEL_HEIGHT;

    this.maxButton = addButton(ctx, buttons, {
      x: centerX,
      y,
      width: MAX_BTN_WIDTH,
      height: MAX_BTN_HEIGHT,
      alignX: 'center',
      label: 'Max',
      ...BUTTON_PRESETS.primary,
      disabled: state.value >= state.max,
      action: () => {
        state.setToMax();
      },
    });
    y += MAX_BTN_HEIGHT + MAX_BTN_GAP_BELOW;

    if (state.costPerUnit !== undefined) {
      const cost = state.cost ?? 0;
      const affordable = state.canAfford;
      drawText(ctx, `Cost: ${cost} ${this.currencyLabel}`.trim(), {
        x: centerX,
        y,
        align: 'center',
        ...(affordable ? TEXT_PRESETS.value : TEXT_PRESETS.danger),
        size: COST_LINE_SIZE,
      });
      y += COST_LINE_GAP_BELOW;
    }

    const footerY = modal.y + height - PANEL_PADDING - FOOTER_BTN_HEIGHT;
    const footerLeft = centerX - FOOTER_BTN_WIDTH - FOOTER_GAP / 2;
    const footerRight = centerX + FOOTER_GAP / 2;

    this.cancelButton = addButton(ctx, buttons, {
      x: footerLeft,
      y: footerY,
      width: FOOTER_BTN_WIDTH,
      height: FOOTER_BTN_HEIGHT,
      label: 'Cancel',
      ...BUTTON_PRESETS.primary,
      action: () => this.cancel(),
    });
    this.confirmButton = addButton(ctx, buttons, {
      x: footerRight,
      y: footerY,
      width: FOOTER_BTN_WIDTH,
      height: FOOTER_BTN_HEIGHT,
      label: this.confirmLabel,
      disabled: !this.canConfirm(),
      ...BUTTON_PRESETS.success,
      primaryAction: true,
      action: () => this.confirm(),
    });

    endMenuFocus();
    endModalFit(ctx);
    resetButtonPointerSpace();
  }

  /** Total design-space height the panel needs, before the mobile shrink `fitPanel` applies. */
  private designHeight(): number {
    const state = this.state;
    const costLineHeight = state?.costPerUnit !== undefined ? COST_LINE_GAP_BELOW : 0;
    return (
      PANEL_PADDING +
      TITLE_GAP +
      STEP_ROW_HEIGHT +
      STEP_ROW_GAP_BELOW +
      UNIT_LABEL_HEIGHT +
      MAX_BTN_HEIGHT +
      MAX_BTN_GAP_BELOW +
      costLineHeight +
      FOOTER_BTN_HEIGHT +
      PANEL_PADDING
    );
  }

  /**
   * Routes a click/tap. Returns true whenever the picker is open, since every
   * pixel while it's up belongs to the modal — a stray tap outside it closes
   * the picker (as Cancel) rather than falling through to the world.
   */
  handleClick(canvasX: number, canvasY: number): boolean {
    const state = this.state;
    if (state === null) return false;
    const { x: mx, y: my } = modalFitPoint(this.fit, canvasX, canvasY);
    if (this.confirmButton?.contains(mx, my) === true) {
      this.confirm();
      return true;
    }
    if (this.cancelButton?.contains(mx, my) === true) {
      this.cancel();
      return true;
    }
    if (this.maxButton?.contains(mx, my) === true) {
      playButtonSound(this.audio);
      state.setToMax();
      return true;
    }
    for (const { delta, button } of this.stepButtons) {
      if (button.contains(mx, my)) {
        playButtonSound(this.audio);
        state.stepBy(delta);
        return true;
      }
    }
    if (this.modalContains?.(mx, my) === true) return true;
    this.cancel();
    return true;
  }

  /**
   * Begins a hold on whichever step button is under (mx, my), for auto-repeat.
   * Call from the same mousedown/touchstart that feeds `setButtonMouseState`.
   * Returns whether a step button was hit, so the caller can still route the
   * press to `handleClick` for the initial single-step activation.
   */
  handlePointerDown(canvasX: number, canvasY: number): boolean {
    if (this.state === null) return false;
    const { x: mx, y: my } = modalFitPoint(this.fit, canvasX, canvasY);
    for (const { delta, button } of this.stepButtons) {
      if (button.contains(mx, my)) {
        this.heldStep = delta;
        this.heldFrames = 0;
        return true;
      }
    }
    if (this.maxButton?.contains(mx, my) === true) {
      this.heldStep = 'max';
      this.heldFrames = 0;
      return true;
    }
    return false;
  }

  handlePointerUp(): void {
    this.heldStep = null;
    this.heldFrames = 0;
  }

  /**
   * Routes a keypress. Digits type a value directly, Backspace edits it,
   * Enter confirms, Esc cancels. Returns whether the key was consumed — always
   * true while open, since the picker locks the keyboard via its overlay claim.
   */
  handleKey(key: string): boolean {
    const state = this.state;
    if (state === null) return false;
    if (key === 'Escape') {
      this.cancel();
      return true;
    }
    if (key === 'Enter') {
      this.confirm();
      return true;
    }
    if (key === 'Backspace') {
      state.backspace();
      return true;
    }
    if (/^[0-9]$/.test(key)) {
      state.typeDigit(key);
      return true;
    }
    return true;
  }

  /**
   * This picker's entry for the scene's `overlayClaims` list. It locks the
   * keyboard so typed digits never also move the player, but leaves the world
   * running: it is opened in places with no safe pause (topping up a
   * trebuchet mid-siege), and its own hold-to-repeat `update()` must keep
   * ticking, which a world-halting claim would starve.
   */
  overlayClaim(): OverlayInputClaim {
    return {
      isOpen: this.isOpen,
      space: { kind: 'swallow' },
      locksKeyboard: true,
      haltsWorld: false,
      focusContext: QUANTITY_PICKER_FOCUS_CONTEXT,
    };
  }
}
