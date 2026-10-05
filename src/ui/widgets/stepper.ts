/**
 * The quantity picker's body: −10 −1 [value] +1 +10 Max around a
 * {@link QuantityPickerState}, which stays the pure model. Typed digits reach
 * the model through {@link stepperKey}, called from the owning surface's
 * `onKey`.
 */

import { splitH, type Rect, type Track } from '../core/geom';
import type { Ui } from '../core/UiRoot';
import { UiStateSlot } from '../core/uiState';
import {
  QUANTITY_STEP_LARGE,
  QUANTITY_STEP_SMALL,
  type QuantityPickerState,
} from '../QuantityPickerState';
import type { GlyphId } from '../theme/glyphs';
import { button, measureButton } from './button';
import { drawFocusRing, fillRounded, strokeRounded } from './paint';
import { tabularNumber } from './text';

export interface StepperOptions {
  readonly id: string;
  readonly state: QuantityPickerState;
  /** Show the ±10 buttons when there's room. Defaults to true. */
  readonly large?: boolean;
  /** Show the Max button. Defaults to true. */
  readonly max?: boolean;
}

/** Narrowest the value field gets; the ±10 buttons are dropped before it shrinks below this. */
const MIN_VALUE_WIDTH = 96;
/** ±10 and Max carry longer labels than ±1, so they get wider buttons. */
const WIDE_STEP_SCALE = 1.5;
const BORDER_WIDTH = 1;
/** The caret is on for half of each blink period while the value field has the keyboard. */
const CARET_BLINK_MS = 1000;
const CARET_WIDTH = 1.5;
const CARET_GAP = 2;
/** Holding a step button repeats it: first after this long, then at this interval (24 and 6 frames at 60 fps). */
const HOLD_REPEAT_DELAY_MS = 400;
const HOLD_REPEAT_INTERVAL_MS = 100;

const HOLD = new UiStateSlot<{ since: number | null; repeats: number }>('stepperHold', () => ({
  since: null,
  repeats: 0,
}));
const FOCUSED_BORDER_WIDTH = 1.5;

/**
 * Feeds one key to the picker: digits type, Backspace erases, `+`/`-` step.
 * Returns whether the key was used.
 */
export function stepperKey(state: QuantityPickerState, key: string): boolean {
  if (/^[0-9]$/.test(key)) {
    state.typeDigit(key);
    return true;
  }
  if (key === 'Backspace') {
    state.backspace();
    return true;
  }
  if (key === '+' || key === '=') {
    state.stepBy(QUANTITY_STEP_SMALL);
    return true;
  }
  if (key === '-') {
    state.stepBy(-QUANTITY_STEP_SMALL);
    return true;
  }
  return false;
}

interface StepButton {
  readonly id: string;
  readonly label: string;
  readonly icon?: GlyphId;
  readonly delta: number | 'max';
}

function stepButtons(
  large: boolean,
  withMax: boolean,
): { before: StepButton[]; after: StepButton[] } {
  return {
    before: [
      ...(large
        ? [{ id: 'minus10', label: `−${QUANTITY_STEP_LARGE}`, delta: -QUANTITY_STEP_LARGE }]
        : []),
      { id: 'minus1', label: '', icon: 'minus', delta: -QUANTITY_STEP_SMALL },
    ],
    after: [
      { id: 'plus1', label: '', icon: 'plus', delta: QUANTITY_STEP_SMALL },
      ...(large
        ? [{ id: 'plus10', label: `+${QUANTITY_STEP_LARGE}`, delta: QUANTITY_STEP_LARGE }]
        : []),
      ...(withMax ? [{ id: 'max', label: 'Max', delta: 'max' as const }] : []),
    ],
  };
}

export function stepper(ui: Ui, rect: Rect, opts: StepperOptions): void {
  const { theme, ctx } = ui;
  const { palette, radius, space, size } = theme;
  const state = opts.state;
  const side = size.control;
  const withMax = opts.max !== false;
  const stepWidth = (b: StepButton): number =>
    b.label === '' ? side : Math.max(side * WIDE_STEP_SCALE, measureButton(ui, { label: b.label }));
  const fixedWidth = (list: readonly StepButton[]): number =>
    list.reduce((sum, b) => sum + stepWidth(b) + space.xs, 0);
  const largeLayout = stepButtons(true, withMax);
  const roomWithLarge = rect.w - fixedWidth([...largeLayout.before, ...largeLayout.after]);
  const showLarge = opts.large !== false && roomWithLarge >= MIN_VALUE_WIDTH;
  const { before, after } = showLarge ? largeLayout : stepButtons(false, withMax);
  const tracks: Track[] = [...before.map(stepWidth), 'fill', ...after.map(stepWidth)];
  const row: Rect = { x: rect.x, y: rect.y + (rect.h - side) / 2, w: rect.w, h: side };
  const cells = splitH(row, tracks, space.xs);
  const stepButton = (b: StepButton, cell: Rect | undefined): void => {
    if (cell === undefined) return;
    const atLimit =
      b.delta === 'max'
        ? state.value >= state.max
        : b.delta < 0
          ? state.value <= state.min
          : state.value >= state.max;
    const hold = ui.state(HOLD, `${opts.id}/${b.id}`);
    const pressed = button(ui, cell, {
      id: `${opts.id}/${b.id}`,
      label: b.label,
      icon: b.icon,
      size: 'md',
      variant: b.delta === 'max' ? 'ghost' : 'secondary',
      disabled: atLimit,
      onTap: () => {
        const alreadyRepeated = hold.repeats > 0;
        hold.repeats = 0;
        hold.since = null;
        if (alreadyRepeated) return;
        if (b.delta === 'max') state.setToMax();
        else state.stepBy(b.delta);
      },
    }).pressed;
    if (!pressed || b.delta === 'max' || atLimit) {
      if (!pressed) {
        hold.since = null;
        hold.repeats = 0;
      }
      return;
    }
    hold.since ??= ui.now;
    const held = ui.now - hold.since;
    const due =
      held < HOLD_REPEAT_DELAY_MS
        ? 0
        : Math.floor((held - HOLD_REPEAT_DELAY_MS) / HOLD_REPEAT_INTERVAL_MS) + 1;
    while (hold.repeats < due) {
      state.stepBy(b.delta);
      hold.repeats++;
    }
  };
  before.forEach((b, index) => stepButton(b, cells[index]));
  const field = cells[before.length];
  after.forEach((b, index) => stepButton(b, cells[before.length + 1 + index]));
  const valueRect = field;
  const fieldState = ui.hit(`${opts.id}/value`, valueRect, {
    onTap: () => state.focus(),
    sound: null,
  });
  fillRounded(ctx, valueRect, radius.md, palette.surface.sunken);
  strokeRounded(
    ctx,
    valueRect,
    radius.md,
    state.focused
      ? palette.accent.base
      : fieldState.hovered
        ? palette.border.strong
        : palette.border.subtle,
    state.focused ? FOCUSED_BORDER_WIDTH : BORDER_WIDTH,
  );
  const drawn = tabularNumber(ui, valueRect, {
    value: state.value,
    role: 'title',
    align: 'center',
  });
  const caretOn = state.focused && Math.floor(ui.now / (CARET_BLINK_MS / 2)) % 2 === 0;
  if (caretOn) {
    const caretH = theme.type.title.lineHeight;
    const caretX = valueRect.x + (valueRect.w + drawn.width) / 2 + CARET_GAP;
    ctx.fillStyle = palette.accent.base;
    ctx.fillRect(caretX, valueRect.y + (valueRect.h - caretH) / 2, CARET_WIDTH, caretH);
  }
  if (fieldState.focused) drawFocusRing(ui, valueRect, radius.md);
}
