/**
 * The quest-complete screen's fixed wording and how many staggered steps a
 * spec's rewards reveal over.
 */

import type { QuestRewardSpec } from './types';

/** What the screen says above every quest's title. */
export const QUEST_REWARD_KICKER = 'QUEST COMPLETE';
/** The heading over the XP, coin and item rewards. */
export const QUEST_REWARD_HEADING = 'REWARDS';

/**
 * How many staggered steps `spec`'s rewards fade in over: the chip row is one,
 * and every item line and every unlock card is one more.
 */
export function questRewardRevealSteps(spec: QuestRewardSpec): number {
  let hasChips = false;
  let steps = 0;
  for (const section of spec.sections) {
    if (section.kind === 'xp' || section.kind === 'coins') hasChips = true;
    else if (section.kind === 'items') steps += section.items.length;
    else steps += section.cards.length;
  }
  return steps + (hasChips ? 1 : 0);
}
