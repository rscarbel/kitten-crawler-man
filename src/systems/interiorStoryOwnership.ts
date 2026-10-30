/**
 * Which Taloncrest rooms a story state currently owns, and which rooms never
 * hold an ordinary roster at all.
 *
 * Shared between the interior scene (which decides who stands in a room on
 * entry) and anything that must agree with it from outside the room, such as a
 * construction contract being issued for a building nobody can be met in.
 * Pure rules over durable progress records: no scene, no map.
 */

import { ANCHOR_ERRAND_GIVERS, type AnchorQuestProgress } from '../core/quests/AnchorQuestProgress';
import { BOOKSHELF, CHAIR, TABLE } from '../map/tileTypes';
import type { BuildingKind } from '../map/town/townPlan';
import type { BuildingId } from '../map/buildingIds';
import { lodgeCellarHeld, type MissingCatsProgress } from '../core/quests/missingCatsProgress';

/** The room whose cellar lid the town's stolen-cats questline is fought over. */
const LODGE_CELLAR_BUILDING: BuildingId = 'taloncrest_garrison_lodge';

/** Her worktable, its chair and one wall shelf, by intact tile type: the anchor-quest wreck. */
export const LORI_REPAIRABLE_TYPES: readonly number[] = [TABLE, CHAIR, BOOKSHELF];

/**
 * False for the rooms that never hold an ambient roster: the tower and the
 * Starlight Tent.
 */
export function interiorHoldsOccupants(type: BuildingKind, buildingId: BuildingId): boolean {
  return type !== 'tower' && buildingId !== 'taloncrest_circus_tent';
}

/** Whether the anchor quest's vermin are loose in the temple nave. */
export function templeVerminHoldRoom(
  buildingId: BuildingId,
  anchor: Pick<AnchorQuestProgress, 'temple'>,
): boolean {
  return buildingId === ANCHOR_ERRAND_GIVERS.temple.buildingId && anchor.temple === 'in_progress';
}

/** True once every piece of Lori's wreck is mended, so entering her cottage breaks nothing. */
export function lorisWreckMended(anchor: Pick<AnchorQuestProgress, 'loriRepairedTypes'>): boolean {
  return LORI_REPAIRABLE_TYPES.every((type) => anchor.loriRepairedTypes.includes(type));
}

/**
 * Whether Blackwood Lodge is a fight: the lid is open and the cellar has not
 * yet held through every wave.
 */
function lodgeCellarDefenceHoldsRoom(
  buildingId: BuildingId,
  missingCats: Pick<MissingCatsProgress, 'phase' | 'kesslerShowedFur' | 'cellarWavesHeld'>,
): boolean {
  return (
    buildingId === LODGE_CELLAR_BUILDING &&
    missingCats.phase === 'blame' &&
    missingCats.kesslerShowedFur &&
    !lodgeCellarHeld(missingCats)
  );
}

/** The story records that decide whether a room is owned by a story state. */
export interface InteriorStoryState {
  readonly anchor: Pick<AnchorQuestProgress, 'temple' | 'loriRepairedTypes'>;
  readonly missingCats: Pick<MissingCatsProgress, 'phase' | 'kesslerShowedFur' | 'cellarWavesHeld'>;
}

/** Whether a story state (a quest fight, a vermin hunt) owns the room `buildingId` right now. */
export function interiorRoomOwnedByStory(
  buildingId: BuildingId,
  story: InteriorStoryState,
): boolean {
  return (
    templeVerminHoldRoom(buildingId, story.anchor) ||
    lodgeCellarDefenceHoldsRoom(buildingId, story.missingCats)
  );
}
