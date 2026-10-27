/**
 * Which Taloncrest rooms a story state currently owns, and which rooms never
 * hold an ordinary roster at all.
 *
 * Shared between the interior scene (which decides who stands in a room on
 * entry) and anything that must agree with it from outside the room, such as a
 * construction contract being issued for a building nobody can be met in.
 * Pure rules over durable progress records: no scene, no map.
 */

import type { AnchorQuestProgress } from '../core/quests/AnchorQuestProgress';
import { STARLIGHT_TENT_NAME } from '../map/overworld/circusGroundsLayout';
import type { MurderQuestStage } from '../core/quests/MurderQuestProgress';
import { BOOKSHELF, CHAIR, TABLE } from '../map/tileTypes';
import type { BuildingKind, PlannedBuildingName } from '../map/town/townPlan';

export const LORI_COTTAGE_NAME = "Old Lori's Cottage" satisfies PlannedBuildingName;
export const SKY_TEMPLE_NAME = 'Temple of the Sky' satisfies PlannedBuildingName;
export const CULT_HIDEOUT_BUILDING_NAME = 'Blackwood Lodge' satisfies PlannedBuildingName;

/** Her worktable, its chair and one wall shelf, by intact tile type: the anchor-quest wreck. */
export const LORI_REPAIRABLE_TYPES: readonly number[] = [TABLE, CHAIR, BOOKSHELF];

/**
 * False for the rooms that never hold an ambient roster: the tower (whose
 * confrontation can start after entry) and the Starlight Tent.
 */
export function interiorHoldsOccupants(type: BuildingKind, name: string): boolean {
  return type !== 'tower' && name !== STARLIGHT_TENT_NAME;
}

/** Whether the Blackwood Lodge cult-hideout fight is pending or live in `name`. */
export function cultHideoutHoldsRoom(
  name: string,
  murderStage: MurderQuestStage | undefined,
): boolean {
  return name === CULT_HIDEOUT_BUILDING_NAME && murderStage === 'cult_hideout';
}

/** Whether the anchor quest's vermin are loose in the temple nave. */
export function templeVerminHoldRoom(
  name: string,
  anchor: Pick<AnchorQuestProgress, 'temple'>,
): boolean {
  return name === SKY_TEMPLE_NAME && anchor.temple === 'in_progress';
}

/** True once every piece of Lori's wreck is mended, so entering her cottage breaks nothing. */
export function lorisWreckMended(anchor: Pick<AnchorQuestProgress, 'loriRepairedTypes'>): boolean {
  return LORI_REPAIRABLE_TYPES.every((type) => anchor.loriRepairedTypes.includes(type));
}

/** The story records that decide whether a room is owned by a story state. */
export interface InteriorStoryState {
  readonly murderStage: MurderQuestStage | undefined;
  readonly anchor: Pick<AnchorQuestProgress, 'temple' | 'loriRepairedTypes'>;
}

/** Whether a story state (a quest fight, a vermin hunt) owns the room `name` right now. */
export function interiorRoomOwnedByStory(name: string, story: InteriorStoryState): boolean {
  return cultHideoutHoldsRoom(name, story.murderStage) || templeVerminHoldRoom(name, story.anchor);
}
