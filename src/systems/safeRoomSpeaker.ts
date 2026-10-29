/**
 * Which of a safe room's two speakers — the doctor in the corner or Dave —
 * an interact press is meant for.
 *
 * Both hear a press from about two and a half tiles, and Dave ambles within
 * a couple of tiles of a home that can be only a few tiles from the doctor,
 * so the two ranges can overlap. Asking each in a fixed
 * order handed every press in the overlap to whichever came first; the nearer
 * one is who the player has walked up to.
 */

import type { DoctorSystem } from './DoctorSystem';
import type { DaveGuideSystem } from './DaveGuideSystem';

/** What the rule asks of Dave: how far off he is, and whether his box is the one open. */
type DaveListener = Pick<DaveGuideSystem, 'talkDistanceTiles' | 'dialogOpen'>;

export type SafeRoomSpeaker = 'doctor' | 'dave';

/** The speaker nearest `active` of those in reach of it, or null when neither is. A tie goes to the doctor. */
export function safeRoomSpeakerFor(
  doctor: DoctorSystem | null,
  dave: DaveListener | null,
  active: { x: number; y: number },
): SafeRoomSpeaker | null {
  const doctorTiles = doctor?.interactionDistanceTiles(active) ?? null;
  const daveTiles = dave?.talkDistanceTiles(active) ?? null;
  if (doctorTiles === null) return daveTiles === null ? null : 'dave';
  if (daveTiles === null) return 'doctor';
  return daveTiles < doctorTiles ? 'dave' : 'doctor';
}

/**
 * Whether a press from `active` is for the other of the two speakers than the
 * one whose conversation is open — the case `Conversation.handOff` cannot see
 * by distance alone, because the player is still inside the first one's range.
 */
export function safeRoomPressLeavesSpeaker(
  doctor: DoctorSystem | null,
  dave: DaveListener | null,
  active: { x: number; y: number },
): boolean {
  const speaker = safeRoomSpeakerFor(doctor, dave, active);
  if (speaker === 'dave') return doctor?.isDialogOpen === true;
  if (speaker === 'doctor') return dave?.dialogOpen === true;
  return false;
}
