import type { GameProgress, GameProgressInput } from '../auth/AuthClient';
import { stampGameProgress } from './saveFormat';

/**
 * A page-lifetime switch that, once engaged, turns every save write into a
 * no-op. It never disengages: the only way back to a page that saves is a
 * reload, which is exactly what a wipe ends in.
 *
 * Engaged before a wipe deletes anything, so that a save fired on the way out
 * of the wiped game — a scene teardown, a floor change, a door — cannot write
 * the run back after the delete has landed.
 */
export interface SaveLatch {
  readonly engaged: boolean;
  engage(): void;
}

export function createSaveLatch(): SaveLatch {
  let engaged = false;
  return {
    get engaged() {
      return engaged;
    },
    engage() {
      engaged = true;
    },
  };
}

/**
 * The latch every real write path on this page checks: `writeLocalProgress`,
 * `AuthClient.saveProgress`, and the {@link ProgressPersistence} the game boots
 * with. A gate builds its own with {@link createSaveLatch} instead, so a wipe
 * it rehearses cannot stop the rest of the process from saving.
 */
export const PAGE_SAVE_LATCH: SaveLatch = createSaveLatch();

/**
 * Where the one save slot lives: the device's own storage in a static build,
 * the server row in a backend build. Each call rejects when the write or delete
 * did not happen, which is what the wipe's retry loop listens for.
 */
export interface ProgressStorage {
  write(progress: GameProgress): Promise<void>;
  remove(): Promise<void>;
}

/** What became of one save request. */
export type SaveWriteOutcome =
  /** The storage accepted it. */
  | 'saved'
  /** The storage refused it; the previous save is still the one a reload resumes. */
  | 'failed'
  /** A wipe has started on this page, so nothing is written ever again. */
  | 'latched'
  /** This scene was built without a save callback (dev routes, harnesses). */
  | 'disabled';

/** Whether a caller that must not run ahead of storage may proceed. */
export function saveOutcomeCommitted(outcome: SaveWriteOutcome): boolean {
  return outcome === 'saved' || outcome === 'disabled';
}

/** The first wait between failed deletes. */
export const WIPE_RETRY_INITIAL_DELAY_MS = 500;
/** Each failed delete multiplies the wait by this much. */
export const WIPE_RETRY_BACKOFF_FACTOR = 2;
/**
 * The wait never grows past this, so a server that comes back after a long
 * outage is noticed within a few seconds rather than minutes.
 */
export const WIPE_RETRY_MAX_DELAY_MS = 8000;

export interface WipeRetryPolicy {
  initialDelayMs: number;
  backoffFactor: number;
  maxDelayMs: number;
}

export const DEFAULT_WIPE_RETRY_POLICY: WipeRetryPolicy = {
  initialDelayMs: WIPE_RETRY_INITIAL_DELAY_MS,
  backoffFactor: WIPE_RETRY_BACKOFF_FACTOR,
  maxDelayMs: WIPE_RETRY_MAX_DELAY_MS,
};

/** Where a wipe stands, for a screen holding the player while it finishes. */
export type WipeStatus =
  | 'idle'
  /** Waiting on saves already sent, then deleting. */
  | 'erasing'
  /** A delete failed and the next attempt is waiting out its backoff. */
  | 'retrying'
  /** The storage refused the delete until the player signs in again. */
  | 'signInRequired'
  | 'wiped';

/** The signed-in account a save slot belongs to. */
export interface WipeAccount {
  readonly id: string;
  /** What the sign-in screen already shows for it: the username. */
  readonly label: string;
}

/**
 * A wipe the page started and has not finished. Kept outside the page, in
 * storage that outlives it: the latch dies with the tab, so a wipe still
 * retrying when the tab closes would otherwise leave the save to be resumed
 * on the next load.
 */
export interface OwedWipe {
  /** The account whose save is owed the delete; null where saves need no sign-in. */
  readonly account: WipeAccount | null;
}

/** Where an {@link OwedWipe} is recorded. Every call is best-effort and never throws. */
export interface WipeMarkerStore {
  read(): OwedWipe | null;
  write(owed: OwedWipe): void;
  clear(): void;
}

export interface ProgressPersistenceOptions {
  latch?: SaveLatch;
  retry?: WipeRetryPolicy;
  /** Injected so a gate can run the retry loop without real time passing. */
  wait?: (ms: number) => Promise<void>;
  /** Told about each failed delete before the next attempt. */
  onWipeRetry?: (attempt: number, error: unknown) => void;
  /**
   * Whether a failed delete can only succeed after the player signs in again.
   * Retrying such a failure on a timer would loop forever, so the wipe asks
   * {@link reauthenticate} instead.
   */
  isAuthFailure?: (error: unknown) => boolean;
  /** Signs the player back in; resolves with the account they signed in as. */
  reauthenticate?: () => Promise<WipeAccount>;
  /** Ends a session signed in as the wrong account, so the next sign-in starts clean. */
  signOut?: () => Promise<unknown>;
  /** The account signed in on this page right now; null when unknown. */
  account?: () => WipeAccount | null;
  /**
   * Asks the server who the session belongs to, rejecting when it cannot say.
   * Used when {@link account} is unknown and the wipe is owed to a known
   * account, so the delete never runs as a session nobody has identified.
   */
  identify?: () => Promise<WipeAccount>;
  /**
   * Whose save a wipe erases. Given when finishing a wipe a previous page
   * owed; otherwise it is whoever {@link account} names when the wipe starts.
   */
  owedAccount?: WipeAccount | null;
  /** Records the wipe before its first delete and clears it once the delete lands. */
  marker?: WipeMarkerStore;
}

function waitWithTimer(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * The page's one door to the save slot: every save and the wipe go through it,
 * so the latch it shares with the low-level writers is checked on every path.
 */
export class ProgressPersistence {
  private readonly latch: SaveLatch;
  private readonly retry: WipeRetryPolicy;
  private readonly wait: (ms: number) => Promise<void>;
  private readonly onWipeRetry: ((attempt: number, error: unknown) => void) | null;
  private readonly isAuthFailure: (error: unknown) => boolean;
  private readonly reauthenticate: (() => Promise<WipeAccount>) | null;
  private readonly signOut: (() => Promise<unknown>) | null;
  private readonly account: () => WipeAccount | null;
  private readonly identify: (() => Promise<WipeAccount>) | null;
  /**
   * Whose save the wipe is erasing, fixed when it starts. A sign-in the wipe
   * asks for must come back as this account, or the delete would erase
   * somebody else's run.
   */
  private wipeAccount: WipeAccount | null;
  private readonly wipeAccountFixed: boolean;
  private readonly marker: WipeMarkerStore | null;
  private wrongAccountRefused = false;
  /**
   * Writes already handed to storage. A wipe waits for every one of them to
   * settle before deleting, because a save sent a moment before the wipe can
   * otherwise reach the server after the delete and bring the run back.
   */
  private readonly writesInFlight = new Set<Promise<void>>();
  private wipeInFlight: Promise<void> | null = null;
  private wipeState: WipeStatus = 'idle';

  constructor(
    private readonly storage: ProgressStorage,
    options: ProgressPersistenceOptions = {},
  ) {
    this.latch = options.latch ?? PAGE_SAVE_LATCH;
    this.retry = options.retry ?? DEFAULT_WIPE_RETRY_POLICY;
    this.wait = options.wait ?? waitWithTimer;
    this.onWipeRetry = options.onWipeRetry ?? null;
    this.isAuthFailure = options.isAuthFailure ?? (() => false);
    this.reauthenticate = options.reauthenticate ?? null;
    this.signOut = options.signOut ?? null;
    this.account = options.account ?? (() => null);
    this.identify = options.identify ?? null;
    this.wipeAccount = options.owedAccount ?? null;
    this.wipeAccountFixed = options.owedAccount !== undefined;
    this.marker = options.marker ?? null;
  }

  get writesBlocked(): boolean {
    return this.latch.engaged;
  }

  /** True once a wipe has removed the save; false before one starts and while it retries. */
  get wipeComplete(): boolean {
    return this.wipeState === 'wiped';
  }

  get wipeStatus(): WipeStatus {
    return this.wipeState;
  }

  /** The account whose save is being erased, for a screen asking it to sign in. */
  get wipeAccountLabel(): string | null {
    return this.wipeAccount?.label ?? null;
  }

  /** True once a sign-in came back as a different account and was turned away. */
  get refusedOtherAccount(): boolean {
    return this.wrongAccountRefused;
  }

  async save(data: GameProgressInput): Promise<SaveWriteOutcome> {
    if (this.latch.engaged) return 'latched';
    const write = this.storage.write(stampGameProgress(data));
    this.writesInFlight.add(write);
    try {
      await write;
      return 'saved';
    } catch {
      return 'failed';
    } finally {
      this.writesInFlight.delete(write);
    }
  }

  /**
   * Engages the latch, then deletes the save, retrying with backoff until the
   * delete succeeds. Every call returns the same promise, so the reset button
   * and the wheel can both await one wipe. Settings and AI credentials are not
   * in the save slot and are left alone.
   */
  wipe(): Promise<void> {
    this.latch.engage();
    if (this.wipeInFlight === null) {
      if (!this.wipeAccountFixed) this.wipeAccount = this.account();
      this.marker?.write({ account: this.wipeAccount });
    }
    this.wipeInFlight ??= this.drainThenRemove();
    return this.wipeInFlight;
  }

  private async drainThenRemove(): Promise<void> {
    this.wipeState = 'erasing';
    await Promise.allSettled([...this.writesInFlight]);
    await this.removeUntilGone();
    this.marker?.clear();
    this.wipeState = 'wiped';
  }

  /** Asks for a sign-in until it comes back as the account the wipe started on. */
  private async signInAsWipedAccount(reauthenticate: () => Promise<WipeAccount>): Promise<void> {
    for (;;) {
      const signedIn = await reauthenticate();
      if (this.wipeAccount === null || signedIn.id === this.wipeAccount.id) return;
      this.wrongAccountRefused = true;
      await this.signOut?.().catch(() => undefined);
    }
  }

  /**
   * A session already signed in as somebody else must not be the one that
   * deletes: a wipe owed by a previous page can find a different player at
   * the keyboard. They are signed out and asked to sign in as the owner.
   */
  private async refuseOtherSession(): Promise<void> {
    const owner = this.wipeAccount;
    if (owner === null) return;
    const current = await this.identifiedSession(owner);
    if (current === null || current.id === owner.id) return;
    if (this.reauthenticate === null) return;
    this.wrongAccountRefused = true;
    this.wipeState = 'signInRequired';
    await this.signOut?.().catch(() => undefined);
    await this.signInAsWipedAccount(this.reauthenticate);
    this.wipeState = 'erasing';
  }

  /**
   * The session's account, asking the server until it answers when this page
   * does not know it. A session it says has expired is signed back in as
   * `owner`. Null only where there is no way to ask.
   */
  private async identifiedSession(owner: WipeAccount): Promise<WipeAccount | null> {
    const known = this.account();
    if (known !== null || this.identify === null) return known;
    let delayMs = this.retry.initialDelayMs;
    for (;;) {
      try {
        return await this.identify();
      } catch (error: unknown) {
        if (this.reauthenticate !== null && this.isAuthFailure(error)) {
          this.wipeState = 'signInRequired';
          await this.signInAsWipedAccount(this.reauthenticate);
          this.wipeState = 'erasing';
          return owner;
        }
        this.wipeState = 'retrying';
        await this.wait(delayMs);
        delayMs = Math.min(this.retry.maxDelayMs, delayMs * this.retry.backoffFactor);
        this.wipeState = 'erasing';
      }
    }
  }

  private async removeUntilGone(): Promise<void> {
    let delayMs = this.retry.initialDelayMs;
    for (let attempt = 1; ; attempt++) {
      await this.refuseOtherSession();
      try {
        await this.storage.remove();
        return;
      } catch (error: unknown) {
        this.onWipeRetry?.(attempt, error);
        if (this.reauthenticate !== null && this.isAuthFailure(error)) {
          this.wipeState = 'signInRequired';
          await this.signInAsWipedAccount(this.reauthenticate);
        } else {
          this.wipeState = 'retrying';
          await this.wait(delayMs);
          delayMs = Math.min(this.retry.maxDelayMs, delayMs * this.retry.backoffFactor);
        }
        this.wipeState = 'erasing';
      }
    }
  }
}

/** Starts a fresh page so no in-memory state from a wiped run survives. */
export function reloadPage(): void {
  window.location.reload();
}

/** One write path a latch check exercises, labelled for the failure message. */
export interface LatchedWritePath {
  readonly label: string;
  /** Attempts a write; resolves whether anything reached storage. */
  attempt(): Promise<boolean>;
}

/**
 * Proves the save latch: starts a wipe on `persistence`, then fires every write
 * path in `paths` and reports each one that still reached storage. An empty
 * result is a pass. Canvas- and DOM-free, so a gate can run it against fake
 * storage.
 */
export async function writePathsThatEscapeTheLatch(
  persistence: ProgressPersistence,
  paths: ReadonlyArray<LatchedWritePath>,
): Promise<string[]> {
  const wipe = persistence.wipe();
  const escaped: string[] = [];
  for (const path of paths) {
    if (await path.attempt()) escaped.push(path.label);
  }
  await wipe;
  for (const path of paths) {
    if (await path.attempt()) escaped.push(`${path.label} (after the delete)`);
  }
  return escaped;
}

/** What boot found: an owed wipe it finished, or the save to resume. */
export type BootProgress<T> =
  { readonly kind: 'wipeFinished' } | { readonly kind: 'loaded'; readonly progress: T | null };

/**
 * Boot's one way to the save. When a previous page left a wipe owed, the latch
 * is engaged before anything else, the wipe is finished, and nothing is
 * loaded: the caller reloads into a clean page. Otherwise the save is loaded
 * as usual.
 */
export async function bootProgress<T>(deps: {
  readonly marker: WipeMarkerStore;
  readonly latch: SaveLatch;
  /** Builds the persistence that finishes the wipe, for the account it is owed to. */
  readonly finishWith: (owed: OwedWipe) => ProgressPersistence;
  /** Told before the owed wipe starts, so a screen can hold the player on it. */
  readonly onOwedWipe?: (persistence: ProgressPersistence) => void;
  readonly load: () => Promise<T | null>;
}): Promise<BootProgress<T>> {
  const owed = deps.marker.read();
  if (owed === null) return { kind: 'loaded', progress: await deps.load() };
  deps.latch.engage();
  const persistence = deps.finishWith(owed);
  deps.onOwedWipe?.(persistence);
  await persistence.wipe();
  return { kind: 'wipeFinished' };
}
