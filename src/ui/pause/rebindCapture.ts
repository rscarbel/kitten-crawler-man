/**
 * The "press a key…" state machine behind the Controls screen's chips.
 *
 * It lives apart from the tab that draws it because the keypress it is waiting
 * for is caught by the window-capture listener in `SceneManager`, which must be
 * able to ask whether a capture is armed without importing a pause tab.
 */

import { keybindings, type GameAction, ACTION_LABELS } from '../../core/Keybindings';

/** How long a steal/rejection notice stays on screen. */
const NOTICE_LIFETIME_MS = 4000;

interface ActiveCapture {
  action: GameAction;
  slot: number;
}

/** A one-line explanation of what the last capture did, shown under the rows. */
interface RebindNotice {
  message: string;
  /** The action a steal left short a key, so its row can be called out. */
  robbedAction: GameAction | null;
  postedAtMs: number;
}

let _capture: ActiveCapture | null = null;
let _notice: RebindNotice | null = null;

/** Arm capture for one chip. Re-arming moves the capture rather than stacking. */
export function beginRebindCapture(action: GameAction, slot: number): void {
  _capture = { action, slot };
  _notice = null;
}

export function cancelRebindCapture(): void {
  _capture = null;
}

export function activeRebindCapture(): Readonly<ActiveCapture> | null {
  return _capture;
}

/** True while a chip is listening — the nav keys belong to it, not to the focus ring. */
export function isRebindCaptureActive(): boolean {
  return _capture !== null;
}

/** True when this exact chip is the one listening. */
export function isCapturingChip(action: GameAction, slot: number): boolean {
  return _capture !== null && _capture.action === action && _capture.slot === slot;
}

/**
 * Feed the armed chip a key.
 *
 * @returns true when capture is finished and the chip should return to normal.
 *   A key that can never be bound leaves capture armed so the player can simply
 *   press something else.
 */
export function handleRebindCaptureKey(key: string): boolean {
  const capture = _capture;
  if (capture === null) return false;

  const outcome = keybindings.rebind(capture.action, capture.slot, key);
  if (!outcome.accepted) {
    postNotice(`${keybindings.labelForKey(key)} can't be bound — pick another key.`, null);
    return false;
  }

  _capture = null;
  if (outcome.stolenFrom !== null) {
    postNotice(
      `${keybindings.labelForKey(key)} taken from ${ACTION_LABELS[outcome.stolenFrom]}.`,
      outcome.stolenFrom,
    );
  } else {
    _notice = null;
  }
  return true;
}

function postNotice(message: string, robbedAction: GameAction | null): void {
  _notice = { message, robbedAction, postedAtMs: performance.now() };
}

/** Post a notice from outside a capture — the reset controls use this. */
export function postRebindNotice(message: string): void {
  postNotice(message, null);
}

/** The live notice, or null once it has aged out. */
export function currentRebindNotice(): Readonly<RebindNotice> | null {
  if (_notice === null) return null;
  if (performance.now() - _notice.postedAtMs > NOTICE_LIFETIME_MS) {
    _notice = null;
    return null;
  }
  return _notice;
}

/** Drop all transient state — call when the Controls screen closes. */
export function resetRebindCapture(): void {
  _capture = null;
  _notice = null;
}
