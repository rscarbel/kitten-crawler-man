/**
 * Pure quantity-selection state for {@link QuantityPicker} — no canvas, no
 * DOM, no rendering. Kept separate so the clamping, stepping and typed-digit
 * rules can be driven from a headless test (`scripts/verify-quantity-picker.ts`)
 * without a browser.
 */

/** ±1 and ±10 step sizes, named so a step call always reads as "which button". */
export const QUANTITY_STEP_SMALL = 1;
export const QUANTITY_STEP_LARGE = 10;

/**
 * Longest digit run a typed entry will accumulate before further digits are
 * ignored. Six digits covers any quantity this game will ever ask for and
 * stops an idle finger on a number key from building an unbounded string.
 */
const MAX_TYPED_DIGITS = 6;

export interface QuantityPickerStateConfig {
  /** Highest quantity selectable. Values below 1 collapse the range to 0..0. */
  readonly max: number;
  /** Starting quantity, clamped into range. */
  readonly initial: number;
  /** Coin cost of one unit. Omit for a picker with no price attached. */
  readonly costPerUnit?: number;
  /**
   * Currency the player currently holds, checked against `costPerUnit × qty`
   * for {@link QuantityPickerState.canAfford}. Omit when there is no cost, or
   * when the caller means to judge affordability itself.
   */
  readonly available?: number;
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

/**
 * Tracks the selected quantity for a `QuantityPicker`, plus the raw digits of
 * an in-progress typed entry.
 *
 * The minimum is 1 whenever at least one unit is selectable: confirming a
 * quantity of 0 does nothing that Cancel doesn't already do, so 0 is never a
 * reachable value except when `max` itself is 0 (nothing to pick).
 */
export class QuantityPickerState {
  readonly max: number;
  readonly min: number;
  readonly costPerUnit: number | undefined;
  readonly available: number | undefined;

  private _value: number;
  /** Raw digits of the entry in progress, or null while nothing is being typed. */
  private _typedDigits: string | null = null;

  constructor(config: QuantityPickerStateConfig) {
    this.max = Math.max(0, Math.floor(config.max));
    this.min = this.max > 0 ? 1 : 0;
    this.costPerUnit = config.costPerUnit;
    this.available = config.available;
    this._value = clamp(Math.floor(config.initial), this.min, this.max);
  }

  get value(): number {
    return this._value;
  }

  /** Whether a typed entry is in progress (digits typed since the last step/Max). */
  get isTyping(): boolean {
    return this._typedDigits !== null;
  }

  /** Total cost of the current quantity, or undefined when this picker has no price. */
  get cost(): number | undefined {
    return this.costPerUnit === undefined ? undefined : this.costPerUnit * this._value;
  }

  /**
   * True when this picker has no price, no known balance, or the current
   * quantity's cost is within that balance. A picker with a price but no
   * `available` figure is always reported affordable — the caller asked this
   * state to track quantity, not to judge the wallet.
   */
  get canAfford(): boolean {
    if (this.costPerUnit === undefined || this.available === undefined) return true;
    const cost = this.cost;
    return cost !== undefined && cost <= this.available;
  }

  private setValue(next: number): void {
    this._value = clamp(next, this.min, this.max);
    this._typedDigits = null;
  }

  /** −10 / −1 / +1 / +10. A step abandons any in-progress typed entry. */
  stepBy(delta: number): void {
    this.setValue(this._value + delta);
  }

  /** Jump straight to the maximum. */
  setToMax(): void {
    this.setValue(this.max);
  }

  /**
   * Append one typed digit, recomputing the value from every digit typed so
   * far. A digit that pushes the parsed number past `max` clamps immediately
   * — typing "1" then "5" against a max of 10 lands on 10, the same place
   * confirming 15 outright would.
   */
  typeDigit(digit: string): void {
    if (!/^[0-9]$/.test(digit)) return;
    if (this.max <= 0) return;
    const nextDigits = ((this._typedDigits ?? '') + digit).slice(0, MAX_TYPED_DIGITS);
    this._typedDigits = nextDigits;
    this._value = clamp(parseInt(nextDigits, 10), this.min, this.max);
  }

  /**
   * Drop the last typed digit. Starting fresh from the shown value (rather
   * than requiring a digit to have been typed first) lets a player backspace
   * into a value that arrived via Max or a step button, not just one they
   * typed themselves.
   */
  backspace(): void {
    const digits = this._typedDigits ?? String(this._value);
    const next = digits.slice(0, -1);
    this._typedDigits = next;
    this._value = next === '' ? this.min : clamp(parseInt(next, 10), this.min, this.max);
  }
}
