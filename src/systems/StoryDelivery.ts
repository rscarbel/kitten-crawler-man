/**
 * Plays the story to the party: Dave's talks when he is with them, Caroline's
 * messages at calm moments, and her intel about each objective once. The
 * `StoryDirector` decides what is due; this decides when and how it is shown,
 * through the scene's cutscene director, so the dungeon and a building's safe
 * room deliver it the same way.
 */

import type { CarolineMessage } from '../dialog/caroline';
import type { DialogLine } from '../dialog/line';
import { displayPageCount } from '../dialog/Conversation';
import { daveStoryLine } from '../dialog/scripts/dave';
import type { StoryBeatId } from '../story/storyBeatIds';
import {
  MAX_BEATS_PER_ARRIVAL,
  storyBeat,
  type StoryDirector,
  type StoryEvent,
} from '../story/StoryDirector';
import type { StoryFloor } from '../story/storyTypes';
import type { LevelId } from '../levels/levelIds';
import type { Mob } from '../creatures/Mob';
import type { Player } from '../Player';
import type { AdviceObjectiveId } from '../story/adviceObjectiveIds';
import type { CutsceneDirector } from './cutscene/CutsceneDirector';
import type { CutsceneScript, CutsceneStep, WalkToStep } from './cutscene/cutsceneSteps';

/** A moment Dave is standing in front of the party for. */
export type DaveStoryEvent = Extract<
  StoryEvent,
  {
    kind:
      'tutorialSafeRoomArrival' | 'tutorialCatArrived' | 'skippedTutorialStart' | 'safeRoomArrival';
  }
>;

/** A moment only Caroline speaks at, including the end of another beat. */
export type CarolineStoryEvent = Extract<
  StoryEvent,
  { kind: 'floorArrival' | 'bossDefeated' | 'firstAchievement' | 'beatFinished' }
>;

/** Something Dave says after his story beat, in the same conversation: the debrief behind a boss. */
export interface DaveTalkExtra {
  readonly line: DialogLine;
  /** Runs once the line has been read to its end. */
  readonly onHeard: () => void;
}

/** The most pages Dave says in one talk, beat and debrief together. */
export const MAX_DAVE_TALK_PAGES = 4;

/** One moment with Dave: what happened, and how his talk is staged. */
export interface DaveMoment {
  readonly event: DaveStoryEvent;
  /** The walk up to him, built as his talk starts: he may have moved since the moment began. */
  readonly walkUp: () => WalkToStep | null;
  /**
   * What he says after his beat in the same conversation, or on its own when
   * no beat is due: as much of it as fits in `pageBudget` pages, or null when
   * nothing does. What is left waits behind his `!` for a talk the player
   * opens.
   */
  readonly extra: (pageBudget: number) => DaveTalkExtra | null;
  /** Whether he teleports out once his talk ends: true only where he stands outside a safe room. */
  readonly leavesAfter: boolean;
  /** Runs once everything due has been heard, or straight away when nothing is. */
  readonly onDone: () => void;
}

export interface StoryDeliveryDeps {
  readonly director: StoryDirector;
  readonly cutscenes: Pick<CutsceneDirector, 'isActive' | 'play'>;
  /** Writes the director's seen beats and briefings to storage now, outside the checkpoint. */
  readonly persist: () => void;
  /**
   * Whether Caroline may speak now: nothing hostile is fighting the party and
   * nothing else holds the screen. Her messages wait until it is true.
   */
  readonly calm: () => boolean;
}

/** One message waiting for a calm moment. */
interface QueuedMessage {
  /** Names what the message is, so the same beat or briefing is never queued twice. */
  readonly key: `beat:${StoryBeatId}` | `intel:${AdviceObjectiveId}`;
  /**
   * The message as it stands when its turn comes, or null when it is no
   * longer worth showing: it is then dropped, never counted as shown.
   */
  readonly message: () => CarolineMessage | null;
  /** Her answer to the beat just heard, shown straight after it rather than after a quiet spell. */
  readonly answersBeat: boolean;
  readonly onShown: () => void;
}

/**
 * Whether anything hostile is fighting the party: a live hostile mob with a
 * crawler for its target who is out where it can be hurt. A mob still eyeing
 * a crawler standing in a safe room is no fight.
 */
export function partyIsEngaged(
  mobs: ReadonlyArray<Pick<Mob, 'isAlive' | 'isHostile' | 'currentTarget'>>,
  party: ReadonlyArray<Player>,
): boolean {
  return mobs.some((mob) => {
    const target = mob.currentTarget;
    return (
      mob.isAlive &&
      mob.isHostile &&
      target !== null &&
      !target.isProtected &&
      party.includes(target)
    );
  });
}

/**
 * About three seconds of play between one story talk and the next message,
 * so two never land back to back. Her answer to a beat is the exception.
 */
const QUIET_AFTER_TALK_FRAMES = 180;

/** The floor each level's story is told on; the tutorial's beats have triggers of their own. */
const LEVEL_STORY_FLOORS = {
  tutorial: null,
  level1: 1,
  level2: 2,
  level3: 3,
} as const satisfies Record<LevelId, StoryFloor | null>;

/** The floor a level's story is told on, or null for a level with no floor of its own. */
export function storyFloorOf(levelId: LevelId): StoryFloor | null {
  return LEVEL_STORY_FLOORS[levelId];
}

export class StoryDelivery {
  private readonly queue: QueuedMessage[] = [];
  private momentsRunning = 0;
  /** Frames of play since the last talk or message ended; starts quiet, so the first can show at once. */
  private framesSinceTalk = QUIET_AFTER_TALK_FRAMES;

  constructor(private readonly deps: StoryDeliveryDeps) {}

  /** Whether a moment with Dave is still playing out; Caroline's queue waits for it. */
  get isTellingDaveMoment(): boolean {
    return this.momentsRunning > 0;
  }

  /**
   * Plays what is due at a moment with Dave: the story beats in play order,
   * at most {@link MAX_BEATS_PER_ARRIVAL} of them his, each Dave beat a
   * cutscene of the walk-up and the talk with as much of `extra` as fits in
   * {@link MAX_DAVE_TALK_PAGES} read straight after his beat in the same
   * conversation. A requirement caught up ahead of the beat
   * the moment triggered is asked about again once it is heard, so the beat
   * it was holding back follows on.
   */
  playDaveMoment(moment: DaveMoment): void {
    this.momentsRunning++;
    let daveBeatsPlayed = 0;
    let extraOffered = false;
    const takeExtra = (pageBudget: number): DaveTalkExtra | null => {
      if (extraOffered) return null;
      extraOffered = true;
      return moment.extra(pageBudget);
    };
    let daveHasLeft = !moment.leavesAfter;
    const daveTalk = (lines: readonly [DialogLine, ...DialogLine[]], onHeard: () => void): void => {
      const leaves = !daveHasLeft;
      daveHasLeft = true;
      this.deps.cutscenes.play(this.daveScript(moment.walkUp(), lines, leaves), onHeard);
    };
    const finish = (): void => {
      if (!daveHasLeft) {
        daveHasLeft = true;
        this.deps.cutscenes.play([{ kind: 'daveTeleportOut' }], finish);
        return;
      }
      this.momentsRunning--;
      this.framesSinceTalk = 0;
      moment.onDone();
    };
    const playExtraAlone = (): void => {
      const extra = takeExtra(MAX_DAVE_TALK_PAGES);
      if (extra === null) {
        finish();
        return;
      }
      daveTalk([extra.line], () => {
        extra.onHeard();
        finish();
      });
    };
    const playNext = (): void => {
      const beatId = this.deps.director
        .dueBeats(moment.event)
        .find(
          (id) => storyBeat(id).speaker === 'caroline' || daveBeatsPlayed < MAX_BEATS_PER_ARRIVAL,
        );
      if (beatId === undefined) {
        playExtraAlone();
        return;
      }
      const beat = storyBeat(beatId);
      if (beat.speaker === 'caroline') {
        this.deps.cutscenes.play(
          [{ kind: 'carolineMessage', message: beat.message, world: 'runs' }],
          () => {
            this.complete(beatId);
            playNext();
          },
        );
        return;
      }
      daveBeatsPlayed++;
      const story = daveStoryLine(beat.lines);
      const extra = takeExtra(MAX_DAVE_TALK_PAGES - displayPageCount(story));
      daveTalk(extra === null ? [story] : [story, extra.line], () => {
        this.complete(beatId);
        extra?.onHeard();
        playNext();
      });
    };
    playNext();
  }

  /** Queues the beats due at a moment only Caroline speaks at; each shows at the next calm moment. */
  noteCarolineMoment(event: CarolineStoryEvent): void {
    for (const id of this.deps.director.dueBeats(event)) this.enqueueBeat(id, event);
  }

  /**
   * Queues Caroline's intel about `objective`, unless she has already given
   * it this run. `compose` writes it when its turn comes, from where the
   * party then is, or answers null when it is stale (the objective done, the
   * party gone from the safe room): it is then dropped unbriefed, to be
   * offered again at the next arrival. It counts as given once shown.
   */
  briefObjective(objective: AdviceObjectiveId, compose: () => CarolineMessage | null): void {
    const director = this.deps.director;
    if (director.hasBriefed(objective)) return;
    this.enqueue({
      key: `intel:${objective}`,
      message: () => (director.hasBriefed(objective) ? null : compose()),
      answersBeat: false,
      onShown: () => {
        if (director.brief(objective)) this.deps.persist();
      },
    });
  }

  /**
   * Once a frame of play: shows the next waiting message once nothing else
   * is playing, the moment is calm and the last talk has had its quiet spell.
   */
  update(): void {
    this.framesSinceTalk++;
    if (this.queue.length === 0 || this.isTellingDaveMoment) return;
    const next = this.queue[0];
    if (this.deps.cutscenes.isActive || !this.deps.calm()) return;
    if (!next.answersBeat && this.framesSinceTalk < QUIET_AFTER_TALK_FRAMES) return;
    this.queue.shift();
    const message = next.message();
    if (message === null) return;
    this.deps.cutscenes.play([{ kind: 'carolineMessage', message, world: 'runs' }], () => {
      this.framesSinceTalk = 0;
      next.onShown();
    });
  }

  private daveScript(
    walkUp: WalkToStep | null,
    lines: readonly [DialogLine, ...DialogLine[]],
    leaves: boolean,
  ): CutsceneScript {
    const talk: CutsceneStep = {
      kind: 'conversation',
      request: { lines, reward: null, questRelated: false },
    };
    const departure: CutsceneStep[] = leaves ? [{ kind: 'daveTeleportOut' }] : [];
    return walkUp === null ? [talk, ...departure] : [walkUp, talk, ...departure];
  }

  /**
   * Marks a beat heard, writes that down at once, and queues the Caroline
   * messages that follow it.
   */
  private complete(id: StoryBeatId): void {
    const director = this.deps.director;
    if (director.finish(id)) this.deps.persist();
    for (const after of director.dueBeats({ kind: 'beatFinished', beat: id })) {
      this.enqueueBeat(after, { kind: 'beatFinished', beat: id });
    }
  }

  /** Queues a Caroline beat; once shown, the moment that raised it is asked again for what it held back. */
  private enqueueBeat(id: StoryBeatId, raisedBy: StoryEvent): void {
    const beat = storyBeat(id);
    if (beat.speaker !== 'caroline') return;
    const director = this.deps.director;
    this.enqueue({
      key: `beat:${id}`,
      message: () => (director.hasSeen(id) ? null : beat.message),
      answersBeat: raisedBy.kind === 'beatFinished',
      onShown: () => {
        this.complete(id);
        for (const next of director.dueBeats(raisedBy)) this.enqueueBeat(next, raisedBy);
      },
    });
  }

  private enqueue(message: QueuedMessage): void {
    if (this.queue.some((queued) => queued.key === message.key)) return;
    this.queue.push(message);
  }
}
