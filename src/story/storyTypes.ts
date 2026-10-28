import type { CarolineMessage } from '../dialog/caroline';
import type { DungeonFloorNumber } from '../levels/levelIds';
import type { DebriefBossType } from '../core/mobs/debriefBossTypes';

/** A floor the story has beats on. */
export type StoryFloor = DungeonFloorNumber;

/**
 * When a Dave beat plays. Every kind is a moment Dave is standing in front of
 * the party, so a Dave beat cannot be given a trigger he would miss.
 */
export type DaveTrigger =
  | { readonly kind: 'tutorialSafeRoomArrival' }
  | { readonly kind: 'tutorialCatArrived' }
  | { readonly kind: 'skippedTutorialStart' }
  | {
      readonly kind: 'safeRoomArrival';
      readonly floor: StoryFloor;
      /** Holds the beat back until this boss is dead; any later safe room on the floor then plays it. */
      readonly afterBossDefeated?: DebriefBossType;
    };

/** When a Caroline beat is shown. `Id` is the story's own beat-id union. */
export type CarolineTrigger<Id extends string> =
  | { readonly kind: 'floorArrival'; readonly floor: StoryFloor }
  | { readonly kind: 'bossDefeated'; readonly boss: DebriefBossType }
  | { readonly kind: 'firstAchievement' }
  | { readonly kind: 'afterBeat'; readonly beat: Id };

/**
 * One talk's paragraphs: at most four, because Dave never gives more than four
 * short pages at once. Each paragraph starts a page.
 */
export type DaveLines =
  | readonly [string]
  | readonly [string, string]
  | readonly [string, string, string]
  | readonly [string, string, string, string];

interface StoryBeatBase<Id extends string> {
  /**
   * Beats that must already be seen before this one plays. A Dave beat whose
   * requirement is still unseen plays that requirement first, so a skipped
   * safe room never reorders the story.
   */
  readonly requires: readonly Id[];
  /** Beats this one tells in their place: finishing it marks them seen too. */
  readonly covers?: readonly Id[];
}

/**
 * One beat of the story. `Id` is the union of every beat's key, so `requires`,
 * `covers` and an `afterBeat` trigger can only name beats that exist.
 *
 * Caroline's beat is one `CarolineMessage`, made by `carolineLines`, so her
 * text can never carry the "System AI message:" label or her name: the
 * renderer adds both.
 */
export type StoryBeat<Id extends string> =
  | (StoryBeatBase<Id> & {
      readonly speaker: 'dave';
      readonly trigger: DaveTrigger;
      readonly lines: DaveLines;
    })
  | (StoryBeatBase<Id> & {
      readonly speaker: 'caroline';
      readonly trigger: CarolineTrigger<Id>;
      readonly message: CarolineMessage;
    });

/** Who tells a beat. */
export type StorySpeaker = StoryBeat<string>['speaker'];

/**
 * Checks a table of beats against the story's id list: the table has an entry
 * for every id and no other, and every id a beat names is one of them.
 * Returns the table unchanged, with its literal types.
 */
export function defineStoryBeats<Id extends string>() {
  return <const Beats extends Readonly<Record<Id, StoryBeat<Id>>>>(
    beats: Beats & Record<Exclude<keyof Beats, Id>, never>,
  ): Beats => beats;
}
