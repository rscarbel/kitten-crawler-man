import type { Surface } from '../../core/UiRoot';
import { choiceModalSurface } from '../../widgets/choiceModal';
import type { WipeStatus } from '../../../core/save/progressPersistence';

/** What a holding screen needs from the page's wipe. `ProgressPersistence` is one. */
export interface ProgressWipe {
  wipe(): Promise<void>;
  readonly wipeStatus: WipeStatus;
  /** The account whose save is being erased, when it is behind a sign-in. */
  readonly wipeAccountLabel?: string | null;
  /** A sign-in came back as some other account and was turned away. */
  readonly refusedOtherAccount?: boolean;
}

const WIPE_STATUS_COPY: Record<WipeStatus, string> = {
  idle: 'Erasing your save. Keep the game open until it is done.',
  erasing: 'Erasing your save. Keep the game open until it is done.',
  retrying:
    "The save server isn't answering, so your save has not been erased yet. Trying again — keep the game open.",
  signInRequired:
    'Your session has expired, so your save has not been erased yet. Sign in to finish erasing it. Nothing is saved in the meantime.',
  wiped: 'Your save is gone. Starting over…',
};

/**
 * Holds the player behind a blocking screen while a wipe finishes, then hands
 * over to whatever comes next. The world is halted and Escape does nothing:
 * every save is already latched off, so play carried on under it would be play
 * that can never be kept.
 *
 * Reset Game mounts one with this copy. Permanent Death can run the same hold with
 * its own picture by reading {@link status} and {@link holding}.
 */
export class WipeHold {
  private wipe: ProgressWipe | null = null;

  get holding(): boolean {
    return this.wipe !== null;
  }

  get status(): WipeStatus {
    return this.wipe?.wipeStatus ?? 'idle';
  }

  /** Starts the wipe, holds until it lands, then calls `onWiped` once. */
  begin(wipe: ProgressWipe, onWiped: () => void): void {
    if (this.wipe !== null) return;
    this.wipe = wipe;
    void wipe.wipe().then(onWiped);
  }

  /**
   * While a sign-in is needed, names the account it must be: erasing is only
   * ever done to the run that asked for it, so another account is turned away.
   */
  body(): string {
    const status = this.status;
    const account = this.wipe?.wipeAccountLabel ?? null;
    if (status !== 'signInRequired' || account === null) return WIPE_STATUS_COPY[status];
    const refused =
      this.wipe?.refusedOtherAccount === true
        ? ' That was a different account, so it was signed out and its save left alone.'
        : '';
    return `Your session has expired, so your save has not been erased yet. Sign in as ${account} to finish erasing it.${refused} Nothing is saved in the meantime.`;
  }

  surface(id: string): Surface {
    return choiceModalSurface({
      id,
      band: 'system',
      isOpen: () => this.holding,
      escape: { kind: 'block' },
      content: () => ({
        id: 'wipe-hold',
        title: 'Erasing…',
        body: this.body(),
        icon: 'hourglass',
        tone: this.status === 'signInRequired' ? 'danger' : 'info',
        buttons: [],
        width: 'sm',
      }),
    });
  }
}
