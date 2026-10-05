/**
 * A standalone "how many?" modal: the stepper, a live cost line, an optional
 * "what you get" line and note, Cancel and Confirm. Used anywhere a player
 * picks a quantity against a cap: dropping or trading part of a stack,
 * Fenna's bulk processing, a trebuchet's ammo deposit.
 *
 * Not owned by any scene. An owner mounts {@link QuantityDialog.surface} on
 * its scene's `UiRoot`, which draws it and routes its taps and keys.
 */

import type { AudioManager } from '../../../audio/AudioManager';
import { splitV, type Rect } from '../../core/geom';
import { UI_TAP_SOUND, type KeyModifiers, type Surface, type Ui } from '../../core/UiRoot';
import { QuantityPickerState } from '../../QuantityPickerState';
import { choiceModalSurface, type ChoiceModalConfig } from '../../widgets/choiceModal';
import { stepper, stepperKey } from '../../widgets/stepper';
import { lineHeightOf, text } from '../../widgets/text';
import type { TextRole } from '../../theme/skins';

export interface QuantityDialogOptions {
  readonly title: string;
  readonly max: number;
  readonly initial: number;
  /** What one unit is called, shown under the stepper. */
  readonly unitLabel: string;
  /** Coin cost of one unit. Omitting it hides the cost line entirely. */
  readonly costPerUnit?: number;
  /** Shown after the cost figure, e.g. "coins". Only used when `costPerUnit` is set. */
  readonly currencyLabel?: string;
  readonly confirmLabel: string;
  /** A live line under the cost describing what this many buys, e.g. "→ 20 Boards". */
  readonly detail?: (qty: number) => string;
  /** A fixed note under everything else: why the cap is lower than the player might expect. */
  readonly note?: string;
  /**
   * Currency the player currently holds. Checked against `costPerUnit × qty`
   * to colour the cost line and disable Confirm when unaffordable. Omit when
   * this dialog has no price, or when affordability shouldn't gate Confirm.
   */
  readonly available?: number;
  readonly onConfirm: (qty: number) => void;
  readonly onCancel: () => void;
}

interface OpenDialog {
  readonly options: QuantityDialogOptions;
  readonly state: QuantityPickerState;
}

const CONFIRM_BUTTON_INDEX = 1;

export class QuantityDialog {
  private current: OpenDialog | null = null;
  /** Run after a confirm or cancel, for a host that drains what the confirm queued. */
  private afterChoice: (() => void) | null = null;

  constructor(private readonly audio: AudioManager | null) {}

  get isOpen(): boolean {
    return this.current !== null;
  }

  open(options: QuantityDialogOptions): void {
    this.current = {
      options,
      state: new QuantityPickerState({
        max: options.max,
        initial: options.initial,
        costPerUnit: options.costPerUnit,
        available: options.available,
      }),
    };
  }

  /** The quantity currently chosen, or 0 while closed. */
  get value(): number {
    return this.current?.state.value ?? 0;
  }

  /** The largest quantity this opening allows, or 0 while closed. */
  get max(): number {
    return this.current?.state.max ?? 0;
  }

  close(): void {
    this.current = null;
  }

  /**
   * Feeds one key: digits type a value directly, Backspace edits it, `+`/`-`
   * step, Enter confirms, Escape cancels. Every key is consumed while open.
   */
  handleKey(key: string, mods: KeyModifiers = {}): boolean {
    const current = this.current;
    if (current === null) return false;
    if (key === 'Escape') {
      this.cancel();
      return true;
    }
    if (key === 'Enter') {
      // A held Enter, or one already down when the dialog appeared, was aimed
      // at whatever came before it.
      if (mods.repeat !== true && mods.predatesSurface !== true) this.confirm();
      return true;
    }
    stepperKey(current.state, key);
    return true;
  }

  /**
   * This dialog as a surface. It locks the keyboard so typed digits never
   * also move the player, but leaves the world running: it is opened in
   * places with no safe pause (topping up a trebuchet mid-siege).
   *
   * @param afterChoice Run after a confirm or cancel the dialog took, for a
   *   host that drains what the confirm queued.
   */
  surface(id: string, afterChoice?: () => void): Surface {
    this.afterChoice = afterChoice ?? null;
    return choiceModalSurface({
      id,
      isOpen: () => this.isOpen,
      haltsWorld: false,
      locksKeyboard: true,
      escape: { kind: 'close', onEscape: () => this.cancel() },
      onKey: (key, mods) => this.handleKey(key, mods),
      content: (ui) => this.content(ui),
    });
  }

  /** Whether the current quantity is confirmable: at least the minimum, and affordable. */
  private canConfirm(state: QuantityPickerState): boolean {
    return state.value >= state.min && state.canAfford;
  }

  /**
   * Confirms the current quantity. A no-op while unaffordable or below the
   * minimum, so Enter can't bypass the guard the Confirm button's disabled
   * state enforces for a tap.
   */
  private confirm(): void {
    const current = this.current;
    if (current === null || !this.canConfirm(current.state)) return;
    this.audio?.play(UI_TAP_SOUND);
    const qty = current.state.value;
    this.close();
    current.options.onConfirm(qty);
    this.afterChoice?.();
  }

  private cancel(): void {
    const current = this.current;
    if (current === null) return;
    this.audio?.play(UI_TAP_SOUND);
    this.close();
    current.options.onCancel();
    this.afterChoice?.();
  }

  private content(ui: Ui): ChoiceModalConfig {
    const current = this.current;
    if (current === null) return { id: 'quantity', title: '', buttons: [] };
    const { options, state } = current;
    const lines = this.lines(options, state);
    const { size, space } = ui.theme;
    const linesHeight = lines.reduce(
      (sum, line) => sum + lineHeightOf(ui, line.role) + space.xs,
      0,
    );
    return {
      id: 'quantity',
      title: options.title,
      width: 'sm',
      extra: {
        height: size.control + linesHeight,
        draw: (rect) => this.drawBody(ui, rect, state, lines),
      },
      buttons: [
        {
          id: 'cancel',
          label: 'Cancel',
          variant: 'secondary',
          sound: null,
          onTap: () => this.cancel(),
        },
        {
          id: 'confirm',
          label: options.confirmLabel,
          variant: 'primary',
          sound: null,
          disabled: !this.canConfirm(state),
          onTap: () => this.confirm(),
        },
      ],
      defaultButton: CONFIRM_BUTTON_INDEX,
      onScrimTap: () => this.cancel(),
    };
  }

  private lines(
    options: QuantityDialogOptions,
    state: QuantityPickerState,
  ): { readonly text: string; readonly role: TextRole }[] {
    const lines: { text: string; role: TextRole }[] = [{ text: options.unitLabel, role: 'muted' }];
    if (options.costPerUnit !== undefined) {
      const cost = state.cost ?? 0;
      lines.push({
        text: `Cost: ${cost} ${options.currencyLabel ?? ''}`.trim(),
        role: state.canAfford ? 'value' : 'danger',
      });
    }
    if (options.detail !== undefined)
      lines.push({ text: options.detail(state.value), role: 'value' });
    if (options.note !== undefined) lines.push({ text: options.note, role: 'muted' });
    return lines;
  }

  private drawBody(
    ui: Ui,
    rect: Rect,
    state: QuantityPickerState,
    lines: readonly { readonly text: string; readonly role: TextRole }[],
  ): void {
    const { size, space } = ui.theme;
    const [stepRow, ...lineRows] = splitV(
      rect,
      [size.control, ...lines.map((line) => lineHeightOf(ui, line.role))],
      space.xs,
    );
    stepper(ui, stepRow, { id: 'quantity/stepper', state });
    lineRows.forEach((row, index) => {
      const line = lines[index];
      text(ui, row, { text: line.text, role: line.role, align: 'center' });
    });
  }
}
