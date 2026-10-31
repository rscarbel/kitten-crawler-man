/**
 * Awards a floor's key fragments as their deeds are done, and queues the
 * ceremony each live award is owed.
 *
 * Built by every scene of a floor on the floor's one `KeyRing`, so a quest
 * finished indoors and a boss killed outside fill the same key. The screens
 * that play a moment take it from here with {@link KeyFragmentSystem.beginMoment}
 * and hand it back with {@link KeyFragmentSystem.endMoment}.
 */

import type { EventBus } from '../../core/EventBus';
import {
  fragmentsOnFloor,
  issueLineFor,
  type FragmentAward,
  type FragmentDef,
  type FragmentQuestId,
  type FragmentSource,
  type FragmentSourceKind,
} from '../../core/keys/floorKeys';
import type { ClaimPreview, ForgeTicket, KeyRing, KeyRingView } from '../../core/keys/KeyRing';
import type { ForgeMoment, FragmentMoment, KeyMoment } from '../../core/keys/keyMoments';
import { opensStairwells } from '../../core/keys/keyKinds';
import type { StoryBeatId } from '../../story/storyBeatIds';
import type { GauntletBossType } from '../../map/bossRoomSizes';
import type { GameSystem } from '../GameSystem';
import { ownEntry } from '../../core/util/guards';

/**
 * Where the key system asks whether a fragment's deed is already done, for
 * deeds recorded outside the floor's checkpoint. `questComplete` names every
 * quest some fragment comes from, so a new quest source cannot compile until
 * each scene that reconciles says how to read it.
 */
export interface KeySourceLedger {
  readonly beatSeen: (beat: StoryBeatId) => boolean;
  readonly bossDefeated: (boss: GauntletBossType) => boolean;
  readonly questComplete: Readonly<Record<FragmentQuestId, () => boolean>>;
}

/** A deed the bus announced, in the shape of the source it might satisfy. */
type SourceEvent =
  | { readonly kind: 'storyBeat'; readonly beat: StoryBeatId }
  | { readonly kind: 'bossDefeated'; readonly boss: string }
  | { readonly kind: 'questCompleted'; readonly questId: string };

/**
 * How a deed already done is awarded on a build of a floor whose ring has no
 * record of being built: a fresh arrival, but also every reload of a save
 * that keeps no world (the tutorial's saves, the save taken on the stairs),
 * and every dev boot.
 *
 * A quest's completion is the one deed that can come from another run: a new
 * game keeps the Wayfinder's Anchor, and with it the anchor quest's
 * completion, so the anchor's fragment is issued with its ceremony on the new
 * run's first arrival on floor 3. A beat or a boss already done on such a
 * build was done in this run, before a save that kept no world, and its
 * ceremony has already played; or a dev boot (`?story=`,
 * `preDefeatedBossTypes`) marked it, which must not play a run of
 * ceremonies. Either way it is claimed silently, as on every later build.
 */
const FIRST_BUILD_AWARD = {
  storyBeat: 'silent',
  bossDefeated: 'silent',
  questCompleted: 'live',
} as const satisfies Record<FragmentSourceKind, 'live' | 'silent'>;

function sourceMatches(source: FragmentSource, event: SourceEvent): boolean {
  switch (source.kind) {
    case 'storyBeat':
      return event.kind === 'storyBeat' && event.beat === source.beat;
    case 'bossDefeated':
      return event.kind === 'bossDefeated' && event.boss === source.boss;
    case 'questCompleted':
      return event.kind === 'questCompleted' && event.questId === source.questId;
    default: {
      const unhandled: never = source;
      return unhandled;
    }
  }
}

function sourceSatisfied(source: FragmentSource, ledger: KeySourceLedger): boolean {
  switch (source.kind) {
    case 'storyBeat':
      return ledger.beatSeen(source.beat);
    case 'bossDefeated':
      return ledger.bossDefeated(source.boss);
    case 'questCompleted':
      return ownEntry(ledger.questComplete, source.questId)?.() ?? false;
    default: {
      const unhandled: never = source;
      return unhandled;
    }
  }
}

function fragmentMoment(claim: ClaimPreview, award: FragmentAward): FragmentMoment {
  const { fragment, keyKind, index, heldMask, held, needed, completesKey } = claim;
  return {
    kind: 'fragment',
    fragment,
    keyKind,
    index,
    held,
    needed,
    heldMask,
    completesKey,
    award,
    issueLine: issueLineFor(fragment, award),
  };
}

/**
 * A fragment claimed as its ceremony opens, with the key's other ceremonies
 * still owed behind it, retold in the order the player will see them.
 *
 * Those owed behind it were claimed first, so as each was queued it counted
 * fewer pieces than the ring holds now, and the piece claimed last may be the
 * one that makes the key whole. Shown as queued, the key would be called whole
 * and then go back to "2 of 3". Retold, each ceremony counts the pieces whose
 * ceremonies have played by then, so the count climbs one at a time and the
 * last to play is the one that makes the key whole, with the forge after it.
 */
function restagedInShowingOrder(
  shown: FragmentMoment,
  behind: readonly FragmentMoment[],
): readonly [FragmentMoment, ...FragmentMoment[]] {
  const inOrder = [shown, ...behind];
  const lastPlace = inOrder.length - 1;
  const retell = (moment: FragmentMoment, place: number): FragmentMoment => {
    const stillToPlay = new Set(inOrder.slice(place + 1).map((later) => later.index));
    const heldMask = shown.heldMask.map((held, index) => held && !stillToPlay.has(index));
    const held = heldMask.filter((isHeld) => isHeld).length;
    const completesKey = place === lastPlace && held === moment.needed;
    return { ...moment, heldMask, held, completesKey };
  };
  return [retell(shown, 0), ...behind.map((moment, i) => retell(moment, i + 1))];
}

export class KeyFragmentSystem implements GameSystem {
  private readonly unsubscribes: readonly (() => void)[];

  constructor(
    private readonly bus: EventBus,
    private readonly ring: KeyRing,
  ) {
    this.unsubscribes = [
      bus.on('bossDefeated', ({ bossType }) =>
        this.awardFor({ kind: 'bossDefeated', boss: bossType }),
      ),
      bus.on('questCompleted', ({ questId }) => this.awardFor({ kind: 'questCompleted', questId })),
      bus.on('storyBeatFinished', ({ beat }) => this.awardFor({ kind: 'storyBeat', beat })),
    ];
  }

  private fragmentFor(event: SourceEvent): FragmentDef | null {
    const onFloor = fragmentsOnFloor(this.ring.levelId);
    return onFloor.find((fragment) => sourceMatches(fragment.source, event)) ?? null;
  }

  private awardFor(event: SourceEvent): void {
    const fragment = this.fragmentFor(event);
    if (fragment !== null) this.claimLive(fragment);
  }

  private claimLive(fragment: FragmentDef): void {
    const outcome = this.ring.claim(fragment.id);
    if (outcome.kind !== 'claimed') return;
    this.ring.moments.enqueue({ moment: fragmentMoment(outcome, 'live'), claimOnBegin: false });
    if (outcome.completesKey) {
      this.ring.moments.enqueue({ moment: this.forgeMoment(outcome), ticket: outcome.ticket });
    }
    this.announceClaim(outcome);
  }

  /** Owes a carried-in fragment its ceremony, claiming it only as the ceremony opens. */
  private oweCarriedIn(fragment: FragmentDef): void {
    if (this.ring.moments.owesUnclaimed(fragment.id)) return;
    const preview = this.ring.previewClaim(fragment.id);
    if (preview === null) return;
    this.ring.moments.enqueue({ moment: fragmentMoment(preview, 'carriedIn'), claimOnBegin: true });
  }

  private forgeMoment(claim: ClaimPreview): ForgeMoment {
    const { keyKind, needed } = claim;
    return { kind: 'forge', keyKind, levelId: this.ring.levelId, needed };
  }

  private announceClaim(claim: ClaimPreview): void {
    const { fragment, keyKind: kind, held, needed } = claim;
    this.bus.emit('keyFragmentClaimed', { fragmentId: fragment.id, kind, held, needed });
  }

  private claimSilently(fragment: FragmentDef): void {
    const outcome = this.ring.claim(fragment.id);
    if (outcome.kind === 'claimed' && outcome.completesKey) this.ring.forge(outcome.ticket);
  }

  /**
   * Claims every fragment of the floor whose deed is already done, for deeds
   * recorded outside the checkpoint: a beat finished after the last save, a
   * boss marked dead by a preset, a quest completed in another scene, any
   * event missed. Silent, and so is the forge of a key it makes whole, except
   * on a build of a floor with no record of being built (see
   * {@link FIRST_BUILD_AWARD}): there a carried-in fragment is owed its
   * ceremony instead, and the floor is recorded as built only once that
   * ceremony opens, so a save written in between still owes it. Never opens a
   * seal. Run once the floor's own state has been restored: on every build,
   * and after every checkpoint rewind.
   */
  reconcile(ledger: KeySourceLedger): void {
    const firstBuild = !this.ring.floorBuilt;
    const due = fragmentsOnFloor(this.ring.levelId).filter(
      (fragment) => !this.ring.holds(fragment.id) && sourceSatisfied(fragment.source, ledger),
    );
    const issuedLive = (fragment: FragmentDef): boolean =>
      firstBuild && FIRST_BUILD_AWARD[fragment.source.kind] === 'live';
    for (const fragment of due.filter((f) => !issuedLive(f))) this.claimSilently(fragment);
    for (const fragment of due.filter(issuedLive)) this.oweCarriedIn(fragment);
    if (!this.ring.moments.owesAnyUnclaimed) this.ring.markFloorBuilt();
    for (const key of this.ring.keysOnFloor()) {
      if (this.ring.moments.owesForge(key.kind)) continue;
      const ticket = this.ring.unforgedWholeKey(key.kind);
      if (ticket !== null) this.ring.forge(ticket);
    }
  }

  /** The next ceremony owed, without starting it. */
  nextMoment(): KeyMoment | null {
    return this.ring.moments.peek();
  }

  /** Changes whenever the owed ceremonies do. */
  get momentsRevision(): number {
    return this.ring.moments.revision;
  }

  /** Every ceremony still owed, next first, for baking their art before they open. */
  owedMoments(): readonly KeyMoment[] {
    return this.ring.moments.owed();
  }

  /**
   * Starts the next ceremony and returns it, or null when none is owed. A
   * forge moment forges the key here, as its screen opens, and a carried-in
   * fragment is claimed here, so the ring and the screen always agree.
   */
  beginMoment(): KeyMoment | null {
    const moments = this.ring.moments;
    for (let entry = moments.take(); entry !== null; entry = moments.take()) {
      const moment = 'ticket' in entry ? this.beginForge(entry) : this.beginFragment(entry);
      if (moment === null) continue;
      moments.show(moment);
      return moment;
    }
    return null;
  }

  private beginForge(entry: {
    readonly moment: ForgeMoment;
    readonly ticket: ForgeTicket;
  }): ForgeMoment {
    if (this.ring.forge(entry.ticket) === 'forged') {
      const { keyKind, levelId } = entry.moment;
      if (opensStairwells(keyKind)) this.ring.moments.oweStairwellReveal();
      this.bus.emit('keyForged', { kind: keyKind, levelId });
    }
    return entry.moment;
  }

  /** The fragment's ceremony, claiming it now if it was owed unclaimed; null if it can no longer be. */
  private beginFragment(entry: {
    readonly moment: FragmentMoment;
    readonly claimOnBegin: boolean;
  }): FragmentMoment | null {
    if (!entry.claimOnBegin) return entry.moment;
    const outcome = this.ring.claim(entry.moment.fragment.id);
    if (outcome.kind !== 'claimed') return null;
    const moments = this.ring.moments;
    if (!moments.owesAnyUnclaimed) this.ring.markFloorBuilt();
    const [shown, ...behind] = restagedInShowingOrder(
      fragmentMoment(outcome, entry.moment.award),
      moments.owedFragmentsOf(outcome.keyKind),
    );
    moments.restageFragmentsOf(outcome.keyKind, behind);
    if (outcome.completesKey) {
      moments.enqueueForge(outcome.keyKind, {
        moment: this.forgeMoment(outcome),
        ticket: outcome.ticket,
      });
    }
    this.announceClaim(outcome);
    return shown;
  }

  /** The ceremony on screen has closed. */
  endMoment(): void {
    this.ring.moments.close();
  }

  /**
   * Whether the party has seen its stairwell key whole: every piece held and
   * no ceremony still owed. Between the last piece's claim and the forge
   * ceremony, the ring already calls the key whole but the player has not
   * been shown it, so Dave must not say it.
   */
  stairwellKeyKnownWhole(): boolean {
    return this.ring.stairwellKeyIsWhole() && !this.ring.moments.pending;
  }

  /** Whether a ceremony is on screen or waiting to open: what other presentations hold for. */
  hasPendingMoment(): boolean {
    return this.ring.moments.pending;
  }

  keyRingView(): KeyRingView {
    return this.ring.view();
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribes) unsubscribe();
  }
}
