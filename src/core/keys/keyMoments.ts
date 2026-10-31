/**
 * The ceremonies owed for keys: one per fragment awarded live, and a forge
 * after the fragment that completes its key.
 */

import type { CarolineMessage } from '../../dialog/caroline';
import type { LevelId } from '../../levels/levelIds';
import type { FragmentAward, FragmentDef } from './floorKeys';
import type { FragmentId } from './fragmentIds';
import { keyKindsMatch, type KeyKind } from './keyKinds';
import type { ForgeTicket } from './KeyRing';

/** What one key ceremony shows. */
export type KeyMoment =
  | {
      readonly kind: 'fragment';
      readonly fragment: FragmentDef;
      readonly keyKind: KeyKind;
      /** The piece's place among its key's fragments, which is also where it sits in the key. */
      readonly index: number;
      /** Fragments of the key held with this one. */
      readonly held: number;
      readonly needed: number;
      /** Which of the key's pieces are held with this one, by `index`. */
      readonly heldMask: readonly boolean[];
      /** Whether this piece makes the key whole; a forge moment follows it. */
      readonly completesKey: boolean;
      readonly award: FragmentAward;
      /** Caroline's sentence for this award. */
      readonly issueLine: CarolineMessage;
    }
  | {
      readonly kind: 'forge';
      readonly keyKind: KeyKind;
      readonly levelId: LevelId;
      readonly needed: number;
    };

export type FragmentMoment = Extract<KeyMoment, { kind: 'fragment' }>;
export type ForgeMoment = Extract<KeyMoment, { kind: 'forge' }>;

/**
 * A queued ceremony, with what it needs to happen when it starts.
 *
 * A fragment awarded live is claimed as its deed is done. A fragment carried
 * in from another run (`claimOnBegin`) is claimed only as its ceremony opens:
 * a save written before then, such as the floor's arrival save, must not hold
 * a fragment whose ceremony never played, or a reload would recognise it
 * silently and the ceremony would be lost.
 */
type QueuedKeyMoment =
  | { readonly moment: FragmentMoment; readonly claimOnBegin: boolean }
  | { readonly moment: ForgeMoment; readonly ticket: ForgeTicket };

/** The owed ceremonies in the order they were earned, and the one on screen. */
export class KeyMomentQueue {
  private readonly queued: QueuedKeyMoment[] = [];
  private current: KeyMoment | null = null;
  private revised = 0;
  private stairwellRevealOwed = false;

  enqueue(entry: QueuedKeyMoment): void {
    this.queued.push(entry);
    this.revised++;
  }

  /**
   * Queues a forge of `kind` to open straight after the last fragment of
   * `kind` still owed, or first of all when none is: the key is forged only
   * once every piece of it has had its ceremony.
   */
  enqueueForge(
    kind: KeyKind,
    entry: Extract<QueuedKeyMoment, { readonly ticket: ForgeTicket }>,
  ): void {
    let lastFragment = -1;
    this.queued.forEach((queued, index) => {
      if (queued.moment.kind === 'fragment' && keyKindsMatch(queued.moment.keyKind, kind)) {
        lastFragment = index;
      }
    });
    this.queued.splice(lastFragment + 1, 0, entry);
    this.revised++;
  }

  /** The fragment ceremonies of `kind` still owed, in the order they will open. */
  owedFragmentsOf(kind: KeyKind): readonly FragmentMoment[] {
    return this.queued.flatMap((queued) =>
      queued.moment.kind === 'fragment' && keyKindsMatch(queued.moment.keyKind, kind)
        ? [queued.moment]
        : [],
    );
  }

  /**
   * Replaces the owed fragment ceremonies of `kind`, in order, with `restaged`
   * (one for each, as {@link owedFragmentsOf} listed them), keeping how each
   * is claimed.
   */
  restageFragmentsOf(kind: KeyKind, restaged: readonly FragmentMoment[]): void {
    let next = 0;
    for (let i = 0; i < this.queued.length; i++) {
      const queued = this.queued[i];
      if (!('claimOnBegin' in queued) || !keyKindsMatch(queued.moment.keyKind, kind)) continue;
      const moment = next < restaged.length ? restaged[next] : null;
      next++;
      if (moment !== null) {
        this.queued[i] = { moment, claimOnBegin: queued.claimOnBegin };
        this.revised++;
      }
    }
  }

  /** The next ceremony to open, without taking it. */
  peek(): KeyMoment | null {
    return this.queued[0]?.moment ?? null;
  }

  /** Changes whenever the owed ceremonies do, so work done for one list of them can tell it is stale. */
  get revision(): number {
    return this.revised;
  }

  /** Every ceremony still owed, in the order they will open. */
  owed(): readonly KeyMoment[] {
    return this.queued.map((entry) => entry.moment);
  }

  /** Takes the next ceremony owed off the queue. */
  take(): QueuedKeyMoment | null {
    this.revised++;
    return this.queued.shift() ?? null;
  }

  /** `moment` is now the ceremony on screen. */
  show(moment: KeyMoment): void {
    this.current = moment;
  }

  /** Whether a fragment carried in from another run is still owed its ceremony, unclaimed. */
  owesUnclaimed(id: FragmentId): boolean {
    return this.queued.some(
      (entry) => 'claimOnBegin' in entry && entry.claimOnBegin && entry.moment.fragment.id === id,
    );
  }

  /** Whether any fragment is still owed its ceremony unclaimed. */
  get owesAnyUnclaimed(): boolean {
    return this.queued.some((entry) => 'claimOnBegin' in entry && entry.claimOnBegin);
  }

  /** The ceremony on screen has closed. */
  close(): void {
    this.current = null;
  }

  /** Whether a forge of `kind` is on screen or waiting to open. */
  owesForge(kind: KeyKind): boolean {
    const moments = [this.current, ...this.queued.map((entry) => entry.moment)];
    const forging = new Set(
      moments.flatMap((moment) => (moment?.kind === 'forge' ? [moment.keyKind] : [])),
    );
    return forging.has(kind);
  }

  /** Whether a ceremony is on screen or waiting to open. */
  get pending(): boolean {
    return this.current !== null || this.queued.length > 0;
  }

  /**
   * A key that opens stairwells was forged live. The floor's map owes the
   * party the nearest stairwell, whichever scene the forge played in.
   */
  oweStairwellReveal(): void {
    this.stairwellRevealOwed = true;
  }

  /** Whether a live forge has owed the floor its stairwell since last asked; asking settles it. */
  takeStairwellReveal(): boolean {
    const owed = this.stairwellRevealOwed;
    this.stairwellRevealOwed = false;
    return owed;
  }

  /** Forgets every owed ceremony and any owed reveal, for a ring that has been rewound or left. */
  clear(): void {
    this.queued.length = 0;
    this.revised++;
    this.current = null;
    this.stairwellRevealOwed = false;
  }
}
