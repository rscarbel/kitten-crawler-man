/**
 * The "press a key…" state behind the Controls page's key chips: which chip
 * is listening, and the one-line notice explaining what the last change did.
 */

import { ACTION_LABELS, keybindings, type GameAction } from '../../../core/Keybindings';

/** How long a steal or rejection notice stays on screen. */
const NOTICE_LIFETIME_MS = 4000;

interface ActiveCapture {
  readonly action: GameAction;
  readonly slot: number;
}

export interface RebindNotice {
  readonly message: string;
  /** The action a steal left short a key, so its row can be called out. */
  readonly robbedAction: GameAction | null;
  readonly postedAtMs: number;
}

/** Every capture currently listening, across scenes. */
const armed = new Set<RebindCapture>();

/**
 * Whether a key chip anywhere is waiting for a key. The scene manager asks
 * before dropping a modifier chord, so Ctrl, Alt and Meta can be bound.
 */
export function rebindCaptureArmed(): boolean {
  return armed.size > 0;
}

export class RebindCapture {
  private capture: ActiveCapture | null = null;
  private notice: RebindNotice | null = null;

  constructor(private readonly now: () => number = () => performance.now()) {}

  /** Arms one chip. Arming another moves the capture rather than stacking. */
  begin(action: GameAction, slot: number): void {
    this.capture = { action, slot };
    this.notice = null;
    armed.add(this);
  }

  cancel(): void {
    this.capture = null;
    armed.delete(this);
  }

  get active(): boolean {
    return this.capture !== null;
  }

  isCapturing(action: GameAction, slot: number): boolean {
    return this.capture?.action === action && this.capture.slot === slot;
  }

  /**
   * Feeds the armed chip a key. A key that can never be bound leaves the
   * capture armed so the player can simply press something else.
   */
  feed(key: string): void {
    const capture = this.capture;
    if (capture === null) return;
    const outcome = keybindings.rebind(capture.action, capture.slot, key);
    if (!outcome.accepted) {
      this.post(`${keybindings.labelForKey(key)} can't be bound — pick another key.`, null);
      return;
    }
    this.cancel();
    if (outcome.stolenFrom === null) {
      this.notice = null;
      return;
    }
    this.post(
      `${keybindings.labelForKey(key)} taken from ${ACTION_LABELS[outcome.stolenFrom]}.`,
      outcome.stolenFrom,
    );
  }

  post(message: string, robbedAction: GameAction | null = null): void {
    this.notice = { message, robbedAction, postedAtMs: this.now() };
  }

  /** The live notice, or null once it has aged out. */
  currentNotice(): RebindNotice | null {
    if (this.notice === null) return null;
    if (this.now() - this.notice.postedAtMs > NOTICE_LIFETIME_MS) {
      this.notice = null;
      return null;
    }
    return this.notice;
  }

  /** Drops the capture and the notice, so neither greets the next visit. */
  reset(): void {
    this.cancel();
    this.notice = null;
  }
}
