import type { GameProgressInput } from '../auth/AuthClient';
import type { SaveWriteOutcome } from '../core/save/progressPersistence';
import { isStoryBeatId, StoryDirector } from './StoryDirector';
import type { StoryBeatId } from './storyBeats';
import { isAdviceObjectiveId, type AdviceObjectiveId } from '../systems/daveAdvice';

/**
 * A save's seen beats, or undefined when the field is not a list. Ids this
 * build has no beat for are dropped rather than failing the save, so cutting
 * a beat never costs the player their run.
 */
export function parseStoryBeatsSeen(raw: unknown): StoryBeatId[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen: StoryBeatId[] = [];
  for (const entry of raw) {
    if (isStoryBeatId(entry) && !seen.includes(entry)) seen.push(entry);
  }
  return seen;
}

/**
 * A save's briefed objectives, or undefined when the field is not a list. Ids
 * this build has no objective for are dropped, as unknown beats are.
 */
export function parseObjectivesBriefed(raw: unknown): AdviceObjectiveId[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const briefed: AdviceObjectiveId[] = [];
  for (const entry of raw) {
    if (isAdviceObjectiveId(entry) && !briefed.includes(entry)) briefed.push(entry);
  }
  return briefed;
}

/** The director a save resumes with. */
export function storyDirectorFromSave(progress: GameProgressInput): StoryDirector {
  return new StoryDirector(progress.storyBeatsSeen, progress.objectivesBriefed);
}

/** What {@link persistStoryBeatsSeen} wrote, for the caller to adopt as its newest save. */
export interface StoryBeatsWrite<Progress extends GameProgressInput> {
  readonly progress: Progress;
  readonly outcome: Promise<SaveWriteOutcome>;
}

/**
 * Writes the director's seen beats and briefed objectives into the stored
 * save the moment a beat or a briefing finishes, leaving everything else in
 * it as it was. A beat is not a
 * checkpoint: the party's position, health and the floor stay at the last
 * real save, but a death or a reload can never play the beat again.
 *
 * `newest` must be the newest progress already handed to storage, not merely
 * the newest one adopted as the respawn point: writing an older one would
 * overwrite a save still in flight. The caller adopts the returned progress
 * in its place, keeping whatever checkpoint it paired with. Returns null when
 * there is no save to amend yet; the next save carries the beats on its own.
 */
export function persistStoryBeatsSeen<Progress extends GameProgressInput>(
  director: StoryDirector,
  newest: Progress | null,
  write: (progress: Progress) => Promise<SaveWriteOutcome>,
): StoryBeatsWrite<Progress> | null {
  if (newest === null) return null;
  const progress: Progress = {
    ...newest,
    storyBeatsSeen: director.seenInPlayOrder(),
    objectivesBriefed: director.briefedInOrder(),
  };
  return { progress, outcome: write(progress) };
}
