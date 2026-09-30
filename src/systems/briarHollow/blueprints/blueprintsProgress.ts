/**
 * The two things every scene touching "The Borrowed Blueprints" needs,
 * whether it is the village overworld (`BlueprintsQuestSystem`) or Wendell's
 * room indoors (`WendellBlueprintsHook`): moving the phase with the right
 * events, and reading or handing over the two quest items.
 *
 * Held items are never recorded in `BlueprintsQuestState`; they are read off
 * both crawlers' inventories every time, so a scythe or a set of blueprints
 * evicted from the quest slot cannot leave the quest believing it is held.
 */

import type { EventBus } from '../../../core/EventBus';
import type { BlueprintsQuestState } from '../../../core/briarHollowState';
import {
  hasAcceptedBlueprintsQuest,
  type BlueprintsQuestPhase,
} from '../../../core/blueprintsQuestPhase';
import { ITEM_DEF, type InventoryItem, type ItemId } from '../../../core/ItemDefs';
import type { Inventory } from '../../../core/Inventory';

export const BLUEPRINTS_QUEST_ID = 'borrowed_blueprints';
export const BLUEPRINTS_QUEST_NAME = 'The Borrowed Blueprints';

/** Wendell's house in the Over City, where the blueprints are kept. */
export const PLUMBLINE_FARM_NAME = 'Plumbline Farm';
/** The yard behind Plumbline Farm that Wendell prepared as a pasture, where Midge ends up. */
export const WENDELL_PASTURE_YARD_NAME = 'Garrison Green';

/** The two items this quest ever puts in a quest slot. */
export type BlueprintsQuestItemId = 'quest_scythe' | 'quest_blueprints';

/** Whether `id` is one of this quest's two items. */
export function isBlueprintsQuestItem(id: ItemId): id is BlueprintsQuestItemId {
  return id === 'quest_scythe' || id === 'quest_blueprints';
}

/** Anything holding an inventory: either crawler. */
export interface BlueprintsItemHolder {
  readonly inventory: Inventory;
}

/**
 * Moves the quest to `phase` and tells everyone listening. Crossing into the
 * accepted phases emits `questStarted` (which pins the quest in the Journal);
 * reaching `complete` emits `questCompleted`. Returns whether the phase moved.
 */
export function moveBlueprintsPhase(
  quest: BlueprintsQuestState,
  phase: BlueprintsQuestPhase,
  bus: EventBus,
): boolean {
  const previous = quest.phase;
  if (previous === phase) return false;
  quest.phase = phase;
  bus.emit('blueprintsQuestPhaseChanged', { phase });
  const justAccepted = !hasAcceptedBlueprintsQuest(previous) && hasAcceptedBlueprintsQuest(phase);
  if (justAccepted) bus.emit('questStarted', { questId: BLUEPRINTS_QUEST_ID });
  if (phase === 'complete') bus.emit('questCompleted', { questId: BLUEPRINTS_QUEST_ID });
  return true;
}

/** The first of `holders` carrying `item`, or null when neither does. */
export function holderOf<T extends BlueprintsItemHolder>(
  holders: readonly T[],
  item: BlueprintsQuestItemId,
): T | null {
  return holders.find((holder) => holder.inventory.countOf(item) > 0) ?? null;
}

/** Whether any of `holders` carries `item`. */
export function isHeld(
  holders: readonly BlueprintsItemHolder[],
  item: BlueprintsQuestItemId,
): boolean {
  return holderOf(holders, item) !== null;
}

/**
 * Puts one `item` in `holder`'s quest slot. Whatever quest item held the slot
 * before is evicted (and reported as `questItemEvicted` by the running
 * scene), which is the design: carrying one quest's item costs another's.
 *
 * @returns the evicted stack, or null when the slot was free.
 */
export function grantBlueprintsItem(
  holder: BlueprintsItemHolder,
  item: BlueprintsQuestItemId,
): InventoryItem | null {
  return holder.inventory.replaceQuestSlot({ ...ITEM_DEF[item], quantity: 1 });
}

/** Takes every `item` off every holder: the scythe going back on its wall, the blueprints retired. */
export function takeBlueprintsItem(
  holders: readonly BlueprintsItemHolder[],
  item: BlueprintsQuestItemId,
): void {
  for (const holder of holders) {
    const held = holder.inventory.countOf(item);
    if (held > 0) holder.inventory.removeItems(item, held);
  }
}
