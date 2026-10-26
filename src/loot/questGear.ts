/**
 * Paying a quest's gear reward: the piece goes to the crawler who can wear
 * it (or the one it belongs to), and a piece the party already has is paid as
 * its sell price instead, the same as any other duplicate.
 */

import { crawlerName } from '../characters/characters';
import { ITEM_DEF } from '../core/items/defs/ItemDefs';
import type { CrawlerKind } from '../core/skills/SkillManager';
import type { Player } from '../Player';
import { bagItemRewardLine } from '../ui/questReward/rewardLines';
import type { RewardItemLine } from '../ui/questReward/types';
import { duplicateCoins, partyOwnsGear, type GearId } from './gearPools';

/** Both crawlers, by kind. */
export interface GearParty {
  readonly human: Player;
  readonly cat: Player;
}

/**
 * Who a piece of gear goes to: the crawler it is reserved for, the only one
 * who can wear it, or otherwise `earner`, whoever earned it.
 */
export function gearRecipient(id: GearId, earner: CrawlerKind): CrawlerKind {
  const def = ITEM_DEF[id];
  if (def.lootRecipient !== undefined) return def.lootRecipient;
  if (def.wearer === 'human' || def.wearer === 'cat') return def.wearer;
  return earner;
}

/**
 * Hands `id` to the crawler it belongs to and returns its reward-screen line:
 * the piece itself, or its sell price when the party already owns one.
 */
export function grantQuestGear(party: GearParty, id: GearId, earner: CrawlerKind): RewardItemLine {
  const recipient = gearRecipient(id, earner);
  const owner = party[recipient];
  if (partyOwnsGear([party.human, party.cat], id)) {
    const coins = duplicateCoins(id);
    owner.earnCoins(coins);
    return bagItemRewardLine(id, 1, { flyToBag: false, note: `Duplicate: +${coins} coins` });
  }
  owner.inventory.addItem(id, 1);
  return bagItemRewardLine(id, 1, { note: `For ${crawlerName(recipient)}` });
}
