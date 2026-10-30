/**
 * What finishing "A Cat Always Comes Back" pays, and the reward screen that
 * says so: experience to both crawlers, coins, and the Warden's grinning
 * mask. Paid once, on the moment Pumpkin walks back in on Dave, which is what
 * completes the questline; it opens nothing and ends nothing.
 */

import type { EventBus } from '../../core/EventBus';
import { awardPartyXp } from '../../core/progression/awardXp';
import {
  MISSING_CATS_QUEST_NAME,
  phaseReached,
  type MissingCatsProgress,
} from '../../core/quests/missingCatsProgress';
import { MISSING_CATS_REWARD_QUOTE } from '../../dialog/scripts/scenes/missingCats';
import type { GearId } from '../../loot/gearPools';
import { grantQuestGear, type GearParty } from '../../loot/questGear';
import { partyXpSections } from '../../ui/questReward/rewardLines';
import type { QuestRewardSpec } from '../../ui/questReward/types';
import { enterMissingCatsPhase } from './missingCatsPhase';

/** Experience each crawler is awarded for the whole questline. */
export const MISSING_CATS_COMPLETION_XP = 1500;
/** Coins paid to the human, who led the way into the tower. */
export const MISSING_CATS_COMPLETION_COINS = 400;
/** The mask the Warden wore to look alive, cracked down its middle. */
const MISSING_CATS_REWARD_GEAR = 'grinning_mask' as const satisfies GearId;

/** Pays the questline's rewards to `party` and returns the screen that shows them. */
function payMissingCatsRewards(party: GearParty, bus: EventBus): QuestRewardSpec {
  const xpApplied = awardPartyXp(party.human, party.cat, MISSING_CATS_COMPLETION_XP, bus);
  party.human.earnCoins(MISSING_CATS_COMPLETION_COINS);
  const mask = grantQuestGear(party, MISSING_CATS_REWARD_GEAR, 'human');
  return {
    questTitle: MISSING_CATS_QUEST_NAME,
    quote: MISSING_CATS_REWARD_QUOTE,
    sections: [
      ...partyXpSections(xpApplied),
      { kind: 'coins', amount: MISSING_CATS_COMPLETION_COINS },
      { kind: 'items', items: [mask] },
    ],
  };
}

/**
 * Completes the questline: the phase moves on to `complete` (which announces
 * it), the rewards are paid to `party`, and their screen is asked for. A
 * questline already complete pays nothing again.
 */
export function completeMissingCats(
  progress: MissingCatsProgress,
  party: GearParty,
  bus: EventBus,
): void {
  if (phaseReached(progress, 'complete')) return;
  enterMissingCatsPhase(progress, 'complete', bus);
  bus.emit('questRewardShown', payMissingCatsRewards(party, bus));
}
