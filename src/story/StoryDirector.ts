import { ADVICE_OBJECTIVE_ORDER, type AdviceObjectiveId } from '../systems/daveAdvice';
import type { DebriefBossType } from '../systems/daveDebrief';
import { STORY_BEATS, type StoryBeatId } from './storyBeats';
import type {
  CarolineTrigger,
  DaveTrigger,
  StoryBeat,
  StoryFloor,
  StorySpeaker,
} from './storyTypes';

/** At most this many Dave beats play on one arrival, so the party is never given two talks at once. */
export const MAX_BEATS_PER_ARRIVAL = 1;

/** Something that happened in play which a beat's trigger may be waiting for. */
export type StoryEvent =
  | { readonly kind: 'tutorialSafeRoomArrival' }
  | { readonly kind: 'tutorialCatArrived' }
  | { readonly kind: 'skippedTutorialStart' }
  | {
      readonly kind: 'safeRoomArrival';
      readonly floor: StoryFloor;
      /** Every boss on this floor the party has killed so far. */
      readonly defeatedBosses: ReadonlySet<DebriefBossType>;
    }
  | { readonly kind: 'floorArrival'; readonly floor: StoryFloor }
  | { readonly kind: 'bossDefeated'; readonly boss: DebriefBossType }
  | { readonly kind: 'firstAchievement' }
  | { readonly kind: 'beatFinished'; readonly beat: StoryBeatId };

/** Narrows an id read from outside the type system, such as a save or a URL. */
export function isStoryBeatId(value: unknown): value is StoryBeatId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STORY_BEATS, value);
}

/** Every beat, in the order `storyBeats.ts` lists them, which is the order they are played. */
export const STORY_BEAT_ORDER: readonly StoryBeatId[] =
  Object.keys(STORY_BEATS).filter(isStoryBeatId);

/** A beat by id, widened from its literal entry so every optional field can be read. */
export function storyBeat(id: StoryBeatId): StoryBeat<StoryBeatId> {
  const beat: StoryBeat<StoryBeatId> = STORY_BEATS[id];
  return beat;
}

/** Who answers an event: Dave's events are moments he is with the party, the rest are Caroline's. */
export function storyEventSpeaker(event: StoryEvent): StorySpeaker {
  switch (event.kind) {
    case 'tutorialSafeRoomArrival':
    case 'tutorialCatArrived':
    case 'skippedTutorialStart':
    case 'safeRoomArrival':
      return 'dave';
    case 'floorArrival':
    case 'bossDefeated':
    case 'firstAchievement':
    case 'beatFinished':
      return 'caroline';
    default: {
      const unhandled: never = event;
      return unhandled;
    }
  }
}

function triggerMatches(
  trigger: DaveTrigger | CarolineTrigger<StoryBeatId>,
  event: StoryEvent,
): boolean {
  switch (trigger.kind) {
    case 'tutorialSafeRoomArrival':
    case 'tutorialCatArrived':
    case 'skippedTutorialStart':
    case 'firstAchievement':
      return event.kind === trigger.kind;
    case 'safeRoomArrival':
      return (
        event.kind === 'safeRoomArrival' &&
        event.floor === trigger.floor &&
        (trigger.afterBossDefeated === undefined ||
          event.defeatedBosses.has(trigger.afterBossDefeated))
      );
    case 'floorArrival':
      return event.kind === 'floorArrival' && event.floor === trigger.floor;
    case 'bossDefeated':
      return event.kind === 'bossDefeated' && event.boss === trigger.boss;
    case 'afterBeat':
      return event.kind === 'beatFinished' && event.beat === trigger.beat;
    default: {
      const unhandled: never = trigger;
      return unhandled;
    }
  }
}

/**
 * A beat that belongs to one moment and is stale once that moment has passed:
 * "Floor 1" read on floor 2 would be wrong. A missed one is dropped rather
 * than replayed, and never holds up a beat that requires it.
 */
function lapsesWhenMissed(beat: StoryBeat<StoryBeatId>): boolean {
  return beat.trigger.kind === 'floorArrival';
}

/**
 * Decides which story beats play, from what just happened and which beats the
 * run has already seen, and remembers which objectives Caroline has already
 * briefed the party on. Holds no rendering and no scene, so a headless gate
 * can drive it.
 *
 * The caller's contract:
 * 1. On each moment, ask {@link dueBeats} with its event and play what comes
 *    back, in order.
 * 2. Once a beat's last page is read, call {@link finish} with it, and only
 *    then ask {@link dueBeats} with `{ kind: 'beatFinished', beat }`, so a
 *    beat that follows it finds it seen.
 * 3. After finishing a beat that was caught up ahead of the one the moment
 *    triggered, the same event may be asked again: what it triggered is then
 *    ready.
 */
export class StoryDirector {
  private readonly seenBeats: Set<StoryBeatId>;
  private readonly briefedObjectives: Set<AdviceObjectiveId>;

  constructor(seen: Iterable<StoryBeatId> = [], briefed: Iterable<AdviceObjectiveId> = []) {
    this.seenBeats = new Set(seen);
    this.briefedObjectives = new Set(briefed);
  }

  /** Whether Caroline has given her intel about `objective` this run. */
  hasBriefed(objective: AdviceObjectiveId): boolean {
    return this.briefedObjectives.has(objective);
  }

  /** Records her intel about `objective` as given. Returns whether that was news, so a caller only persists a real change. */
  brief(objective: AdviceObjectiveId): boolean {
    if (this.briefedObjectives.has(objective)) return false;
    this.briefedObjectives.add(objective);
    return true;
  }

  /** The briefed objectives in the order the floors meet them, as the save records them. */
  briefedInOrder(): AdviceObjectiveId[] {
    return ADVICE_OBJECTIVE_ORDER.filter((id) => this.briefedObjectives.has(id));
  }

  hasSeen(id: StoryBeatId): boolean {
    return this.seenBeats.has(id);
  }

  /** The seen beats in play order, as the save records them. */
  seenInPlayOrder(): StoryBeatId[] {
    return STORY_BEAT_ORDER.filter((id) => this.seenBeats.has(id));
  }

  /**
   * The beats that play for `event`, in play order. Never marks anything seen.
   *
   * An unseen beat that a triggered beat requires plays ahead of it, whatever
   * its own trigger, so a missed one-shot moment never strands the rest of the
   * story. Dave's beats come back only for a moment Dave is present at, at
   * most {@link MAX_BEATS_PER_ARRIVAL} of them; Caroline's can come back at
   * any moment.
   */
  dueBeats(event: StoryEvent): readonly StoryBeatId[] {
    const daveIsPresent = storyEventSpeaker(event) === 'dave';
    const candidates = new Set<StoryBeatId>();
    for (const id of STORY_BEAT_ORDER) {
      if (this.hasSeen(id) || !triggerMatches(storyBeat(id).trigger, event)) continue;
      candidates.add(id);
      for (const caughtUp of this.catchUpsFor(id)) candidates.add(caughtUp);
    }
    const due: StoryBeatId[] = [];
    let daveBeats = 0;
    for (const id of STORY_BEAT_ORDER) {
      if (!candidates.has(id) || !this.requirementsMet(id)) continue;
      if (storyBeat(id).speaker === 'dave') {
        if (!daveIsPresent || daveBeats >= MAX_BEATS_PER_ARRIVAL) continue;
        daveBeats++;
      }
      due.push(id);
    }
    return due;
  }

  /**
   * Marks a beat read, with every beat it covers. Returns whether that changed
   * the seen set, so a caller only persists a real change.
   */
  finish(id: StoryBeatId): boolean {
    const before = this.seenBeats.size;
    this.seenBeats.add(id);
    for (const covered of storyBeat(id).covers ?? []) this.seenBeats.add(covered);
    return this.seenBeats.size !== before;
  }

  private requirementsMet(id: StoryBeatId): boolean {
    return storyBeat(id).requires.every(
      (required) => this.hasSeen(required) || lapsesWhenMissed(storyBeat(required)),
    );
  }

  /**
   * The unseen beats `id` waits on, directly or through another unseen beat,
   * that are told before it. Where one unseen beat covers a set of them and
   * none of what it covers has been heard yet, it is told in their place.
   */
  private catchUpsFor(id: StoryBeatId): Set<StoryBeatId> {
    const waitingOn = new Set<StoryBeatId>();
    const pending = [...storyBeat(id).requires];
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      if (this.hasSeen(next) || waitingOn.has(next) || lapsesWhenMissed(storyBeat(next))) {
        continue;
      }
      waitingOn.add(next);
      pending.push(...storyBeat(next).requires);
    }
    for (const coveringId of STORY_BEAT_ORDER) {
      const covers = storyBeat(coveringId).covers ?? [];
      const coversSomethingWaitedOn = covers.some((covered) => waitingOn.has(covered));
      const nothingCoveredHeard = covers.every((covered) => !this.hasSeen(covered));
      if (this.hasSeen(coveringId) || !coversSomethingWaitedOn || !nothingCoveredHeard) continue;
      for (const covered of covers) waitingOn.delete(covered);
      waitingOn.add(coveringId);
    }
    return waitingOn;
  }
}
