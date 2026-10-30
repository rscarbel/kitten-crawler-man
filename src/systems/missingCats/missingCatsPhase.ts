/**
 * The one way "A Cat Always Comes Back" changes phase, shared by its town half
 * and its rooms so the same events fire on both sides of a door.
 */

import type { EventBus } from '../../core/EventBus';
import type { QuestId } from '../../core/quests/QuestManager';
import {
  investigationSolved,
  phaseReached,
  type MissingCatsClueId,
  type MissingCatsClueSite,
  type MissingCatsPhase,
  type MissingCatsProgress,
} from '../../core/quests/missingCatsProgress';

export const MISSING_CATS_QUEST_ID = 'taloncrest_missing_cats' as const satisfies QuestId;

/** The Journal id of one clue site's step, listed under the questline's own row. */
export function missingCatsSiteStepId(site: MissingCatsClueSite) {
  return `${MISSING_CATS_QUEST_ID}:${site}` as const;
}

/**
 * Whether the Journal's pin follows a clue site: pinned on the questline
 * itself, or on that site's own step. A pin on another site's step leaves
 * this one's marks dark.
 */
export function missingCatsSiteTracked(
  pinnedTrackerId: string | null,
  site: MissingCatsClueSite,
): boolean {
  return (
    pinnedTrackerId === MISSING_CATS_QUEST_ID || pinnedTrackerId === missingCatsSiteStepId(site)
  );
}

/**
 * Moves the questline on to `phase`. A phase already reached is left alone,
 * so a beat replayed after a rebuild never walks the questline backwards.
 * Leaving `not_started` starts the quest; every later step is an objective
 * done, which is what plays the objective sting.
 */
export function enterMissingCatsPhase(
  progress: MissingCatsProgress,
  phase: MissingCatsPhase,
  bus: EventBus,
): void {
  if (phaseReached(progress, phase)) return;
  const starting = progress.phase === 'not_started';
  progress.phase = phase;
  if (starting) {
    bus.emit('questStarted', { questId: MISSING_CATS_QUEST_ID });
    return;
  }
  if (phase === 'complete') {
    bus.emit('questCompleted', { questId: MISSING_CATS_QUEST_ID });
    return;
  }
  bus.emit('objectiveComplete', { objectiveId: `${MISSING_CATS_QUEST_ID}:${phase}` });
}

/**
 * What finding a clue did: nothing for one already found, or recorded it, or
 * recorded the last one, which the party sums up before the Lodge.
 */
export type ClueFinding = 'already_found' | 'recorded' | 'investigation_solved';

/**
 * Records one clue found, once, and moves the questline on to the town's
 * blaming the elves when it was the last.
 */
export function findMissingCatsClue(
  progress: MissingCatsProgress,
  clue: MissingCatsClueId,
  bus: EventBus,
): ClueFinding {
  if (progress.clues.has(clue)) return 'already_found';
  progress.clues.add(clue);
  bus.emit('objectiveComplete', { objectiveId: `${MISSING_CATS_QUEST_ID}:${clue}` });
  if (progress.phase === 'investigating' && investigationSolved(progress)) {
    enterMissingCatsPhase(progress, 'blame', bus);
    return 'investigation_solved';
  }
  return 'recorded';
}
