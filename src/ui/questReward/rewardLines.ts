/**
 * Builders for the pieces quests put on their reward screen, so every quest
 * names, draws and describes the same reward the same way.
 */

import type { PartyXpApplied } from '../../core/awardXp';
import { ITEM_DEF, type ItemId } from '../../core/ItemDefs';
import { CRAWLER_NAMES } from '../../core/SkillManager';
import { drawItemIcon } from '../icons/drawItemIcon';
import type { IconPainter, QuestRewardSection, RewardItemLine } from './types';

/** How a bag item's line reads beyond its name and count. */
export interface BagItemLineOptions {
  /** Draw the item's own description under its name. */
  readonly describe?: boolean;
  readonly note?: string;
  /** Fly the item to the bag when the screen closes; false for items that did not go in. */
  readonly flyToBag?: boolean;
}

/** The icon a bag item wears in the inventory. */
export function itemIconPainter(id: ItemId): IconPainter {
  const item = { ...ITEM_DEF[id], quantity: 1 };
  return (ctx, rect) => drawItemIcon(ctx, rect, item);
}

/** A line for `count` of a bag item, drawn with its inventory icon and name. */
export function bagItemRewardLine(
  id: ItemId,
  count: number,
  options: BagItemLineOptions = {},
): RewardItemLine {
  const def = ITEM_DEF[id];
  return {
    name: def.name,
    count,
    itemId: options.flyToBag === false ? undefined : id,
    renderIcon: itemIconPainter(id),
    description: options.describe === true ? def.description : undefined,
    note: options.note,
  };
}

/** One `xp` section per crawler, each naming who it went to, for an award from `awardPartyXp`. */
export function partyXpSections(applied: PartyXpApplied): QuestRewardSection[] {
  return [
    { kind: 'xp', amount: applied.human, recipient: CRAWLER_NAMES.human },
    { kind: 'xp', amount: applied.cat, recipient: CRAWLER_NAMES.cat },
  ];
}
