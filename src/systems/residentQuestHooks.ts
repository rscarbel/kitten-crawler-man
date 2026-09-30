/**
 * A questline's business with the residents of one room, as
 * `BuildingInteriorScene` sees it: the first refusal on talking to a
 * resident, the glyph over their head, and the conversation it opened.
 *
 * The scene holds an ordered list of these (the Anchor's first, then "The
 * Borrowed Blueprints") and asks each in turn, so a second questline indoors
 * is one more entry in the list rather than another special case threaded
 * through every input and render path.
 */

import type { Player } from '../Player';
import type { NPCMarkerType } from '../creatures/QuestNPC';
import type { ResidentId } from './townResidents';

export interface ResidentQuestHook {
  /** Whether the shared conversation is showing one of this hook's beats right now. */
  readonly isDialogOpen: boolean;
  /**
   * The questline's first refusal on `talker` talking to `residentId`: true
   * when it opened a beat and took the press, false to leave the resident to
   * their own lore, service and small talk.
   */
  tryOpenDialog(residentId: ResidentId, talker: Player): boolean;
  /** The glyph `residentId` should wear, or null when the questline has no opinion about them. */
  markerFor(residentId: ResidentId): NPCMarkerType | null;
  /** Escape on this hook's beat. Returns whether it had one to act on. */
  dismissDialog(): boolean;
  /** A click on this hook's beat. Returns whether it landed. */
  handleClick(mx: number, my: number): boolean;
  /** Once per gameplay frame. */
  update(): void;
}

/** The first hook's marker for `residentId` that is not null, or null when none has one. */
export function firstResidentMarker(
  hooks: readonly ResidentQuestHook[],
  residentId: ResidentId,
): NPCMarkerType | null {
  for (const hook of hooks) {
    const marker = hook.markerFor(residentId);
    if (marker !== null) return marker;
  }
  return null;
}
