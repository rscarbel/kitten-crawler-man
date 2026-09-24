#!/usr/bin/env tsx
/**
 * Headless checks for `QuantityPickerState` (clamping, ±1/±10 at the bounds,
 * Max, typed digits, backspace) and for `QuantityPicker`'s open/confirm/cancel
 * dispatch through `handleKey`, none of which touch a canvas.
 *
 * Run: npx tsx scripts/verify-quantity-picker.ts
 */
import { QuantityPickerState } from '../src/ui/QuantityPickerState';
import { QuantityPicker } from '../src/ui/QuantityPicker';

let failures = 0;
function check(ok: boolean, message: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${message}`);
  if (!ok) failures++;
}

// ── Construction clamps the initial value and picks a sensible minimum ──
{
  const MAX = 40;
  const INITIAL = 5;
  const s = new QuantityPickerState({ max: MAX, initial: INITIAL });
  check(s.value === INITIAL, 'initial value is kept when already in range');
  check(s.min === 1, 'a picker with room to pick has a minimum of 1');

  const OVER_MAX_INITIAL = 999;
  const clampedHigh = new QuantityPickerState({ max: MAX, initial: OVER_MAX_INITIAL });
  check(clampedHigh.value === MAX, 'an initial value above max clamps down to max');

  const NEGATIVE_INITIAL = -5;
  const clampedLow = new QuantityPickerState({ max: MAX, initial: NEGATIVE_INITIAL });
  check(clampedLow.value === 1, 'an initial value below min clamps up to min');

  const empty = new QuantityPickerState({ max: 0, initial: INITIAL });
  check(empty.value === 0 && empty.min === 0, 'a picker with nothing to pick collapses to 0..0');
}

// ── stepBy clamps at both bounds ──
{
  const MAX = 15;
  const START = 3;
  const SMALL_STEP = 1;
  const LARGE_STEP = 10;
  const s = new QuantityPickerState({ max: MAX, initial: START });
  s.stepBy(-SMALL_STEP);
  check(s.value === START - SMALL_STEP, '-1 steps down by one');
  s.stepBy(-LARGE_STEP);
  check(s.value === s.min, '-10 near the floor clamps at the minimum rather than going negative');
  s.stepBy(LARGE_STEP);
  check(s.value === s.min + LARGE_STEP, '+10 steps up by ten');
  s.stepBy(LARGE_STEP);
  check(s.value === MAX, '+10 near the ceiling clamps at max rather than overshooting');
  s.stepBy(SMALL_STEP);
  check(s.value === MAX, '+1 already at max stays at max');
}

// ── Max ──
{
  const MAX = 250;
  const s = new QuantityPickerState({ max: MAX, initial: 1 });
  s.setToMax();
  check(s.value === MAX, 'Max jumps straight to the ceiling');
}

// ── Typed digits ──
{
  const MAX = 40;
  const s = new QuantityPickerState({ max: MAX, initial: 1 });
  s.typeDigit('1');
  check(s.value === 1 && s.isTyping, 'typing "1" sets the value to 1 and enters typing mode');
  s.typeDigit('5');
  const TYPED_ONE_FIVE = 15;
  check(s.value === TYPED_ONE_FIVE, 'typing "5" after "1" reads the combined digits as 15');

  const SMALL_MAX = 10;
  const overMax = new QuantityPickerState({ max: SMALL_MAX, initial: 1 });
  overMax.typeDigit('1');
  overMax.typeDigit('5');
  check(overMax.value === SMALL_MAX, 'typed digits that exceed max clamp down to max immediately');

  const ignoresNonDigits = new QuantityPickerState({ max: MAX, initial: 1 });
  ignoresNonDigits.typeDigit('a');
  check(!ignoresNonDigits.isTyping && ignoresNonDigits.value === 1, 'a non-digit key is ignored');
}

// ── Backspace ──
{
  const MAX = 500;
  const s = new QuantityPickerState({ max: MAX, initial: 1 });
  s.typeDigit('2');
  s.typeDigit('5');
  const TYPED_TWO_FIVE = 25;
  check(s.value === TYPED_TWO_FIVE, 'typed "25" reads as 25');
  s.backspace();
  const AFTER_ONE_BACKSPACE = 2;
  check(s.value === AFTER_ONE_BACKSPACE, 'backspace drops the last typed digit');
  s.backspace();
  check(s.value === s.min, 'backspacing to an empty entry falls back to the minimum');

  const STEPPED_INITIAL = 30;
  const AFTER_BACKSPACE_ON_STEPPED = 3;
  const fromStepped = new QuantityPickerState({ max: MAX, initial: STEPPED_INITIAL });
  fromStepped.backspace();
  check(
    fromStepped.value === AFTER_BACKSPACE_ON_STEPPED,
    'backspace on a value reached without typing edits its digits too',
  );
}

// ── canAfford / cost ──
{
  const MAX = 50;
  const COST_PER_UNIT = 3;
  const AVAILABLE = 12;
  const AFFORDABLE_QTY = 4;
  const affordable = new QuantityPickerState({
    max: MAX,
    initial: AFFORDABLE_QTY,
    costPerUnit: COST_PER_UNIT,
    available: AVAILABLE,
  });
  check(affordable.cost === AVAILABLE, 'cost is quantity × costPerUnit');
  check(affordable.canAfford, 'exactly enough currency is affordable');

  const UNAFFORDABLE_QTY = 5;
  const tooExpensive = new QuantityPickerState({
    max: MAX,
    initial: UNAFFORDABLE_QTY,
    costPerUnit: COST_PER_UNIT,
    available: AVAILABLE,
  });
  check(!tooExpensive.canAfford, 'one unit more than the wallet allows is unaffordable');

  const noPrice = new QuantityPickerState({ max: MAX, initial: AFFORDABLE_QTY });
  check(
    noPrice.cost === undefined && noPrice.canAfford,
    'a picker with no costPerUnit has no cost and is always affordable',
  );
}

// ── QuantityPicker: open/confirm/cancel via handleKey, without a canvas ──
{
  const MAX = 25;
  const INITIAL = 5;
  const TYPED_QTY = 9;
  const picker = new QuantityPicker(null);
  const confirmedQtys: number[] = [];
  picker.open({
    title: 'Deposit stone',
    max: MAX,
    initial: INITIAL,
    unitLabel: 'stone',
    confirmLabel: 'Deposit',
    onConfirm: (qty) => {
      confirmedQtys.push(qty);
    },
    onCancel: () => undefined,
  });
  check(picker.isOpen, 'open() opens the picker');
  picker.handleKey(TYPED_QTY.toString());
  picker.handleKey('Enter');
  check(
    confirmedQtys.length === 1 && confirmedQtys[0] === TYPED_QTY,
    'typing "9" then Enter confirms with quantity 9',
  );
  check(!picker.isOpen, 'confirming closes the picker');
}

{
  const MAX = 25;
  const INITIAL = 5;
  const picker = new QuantityPicker(null);
  let cancelled = false;
  picker.open({
    title: 'Deposit stone',
    max: MAX,
    initial: INITIAL,
    unitLabel: 'stone',
    confirmLabel: 'Deposit',
    onConfirm: () => {
      throw new Error('onConfirm must not fire on Escape');
    },
    onCancel: () => {
      cancelled = true;
    },
  });
  picker.handleKey('Escape');
  check(cancelled, 'Esc cancels rather than confirming');
  check(!picker.isOpen, 'cancelling closes the picker');
}

{
  // Unaffordable: Enter must not confirm even though a value is selected.
  const MAX = 20;
  const INITIAL = 10;
  const COST_PER_UNIT = 5;
  const AVAILABLE = 10;
  const picker = new QuantityPicker(null);
  let confirmed = false;
  picker.open({
    title: 'Buy boards',
    max: MAX,
    initial: INITIAL,
    unitLabel: 'boards',
    costPerUnit: COST_PER_UNIT,
    available: AVAILABLE,
    confirmLabel: 'Buy',
    onConfirm: () => {
      confirmed = true;
    },
    onCancel: () => undefined,
  });
  picker.handleKey('Enter');
  check(!confirmed, 'Enter on an unaffordable quantity does not confirm');
  check(picker.isOpen, 'an unaffordable Enter leaves the picker open');
}

console.log(
  failures === 0 ? '\nAll quantity-picker checks passed.' : `\n${failures} check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
