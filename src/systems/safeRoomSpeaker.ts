/**
 * Which of a safe room's two speakers — the Bopca at the counter or Dave —
 * an interact press is meant for.
 *
 * Both hear a press from about two and a half tiles, and Dave ambles within
 * a couple of tiles of a home that is often only two to four tiles from the
 * counter, so the two ranges overlap in most rooms. Asking each in a fixed
 * order handed every press in the overlap to whichever came first; the nearer
 * one is who the player has walked up to.
 */

import type { BopcaSystem } from './BopcaSystem';
import type { DaveGuideSystem } from './DaveGuideSystem';

/** What the rule asks of Dave: how far off he is, and whether his box is the one open. */
type DaveListener = Pick<DaveGuideSystem, 'talkDistanceTiles' | 'dialogOpen'>;

export type SafeRoomSpeaker = 'bopca' | 'dave';

/** The speaker nearest `active` of those in reach of it, or null when neither is. A tie goes to the Bopca. */
export function safeRoomSpeakerFor(
  bopca: BopcaSystem | null,
  dave: DaveListener | null,
  active: { x: number; y: number },
): SafeRoomSpeaker | null {
  const bopcaTiles = bopca?.interactionDistanceTiles(active) ?? null;
  const daveTiles = dave?.talkDistanceTiles(active) ?? null;
  if (bopcaTiles === null) return daveTiles === null ? null : 'dave';
  if (daveTiles === null) return 'bopca';
  return daveTiles < bopcaTiles ? 'dave' : 'bopca';
}

/**
 * Whether a press from `active` is for the other of the two speakers than the
 * one whose conversation is open — the case `Conversation.handOff` cannot see
 * by distance alone, because the player is still inside the first one's range.
 */
export function safeRoomPressLeavesSpeaker(
  bopca: BopcaSystem | null,
  dave: DaveListener | null,
  active: { x: number; y: number },
): boolean {
  const speaker = safeRoomSpeakerFor(bopca, dave, active);
  if (speaker === 'dave') return bopca?.isDialogOpen === true;
  if (speaker === 'bopca') return dave?.dialogOpen === true;
  return false;
}
