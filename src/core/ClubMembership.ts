/**
 * Cross-scene state for the Desperado Club: membership, and whatever the club's
 * stations must remember between visits.
 *
 * Like the questline progress objects (`CircusQuestProgress`,
 * `DoomsdayProgress`, …), this is a plain mutable object threaded by reference
 * through the `DungeonScene` ↔ `BuildingInteriorScene` constructors so it
 * survives entering and leaving the club. Obtaining the Desperado Pass would
 * (per the books) permanently forfeit any Club Vanquisher membership — pure
 * flavour here, since the rival club is out of scope.
 */

import type { ShoeState } from '../systems/casino/Deck';

export interface ClubMembership {
  hasDesperadoPass: boolean;
  /**
   * The casino's blackjack shoe. Persisted across club visits so walking out
   * cannot reroll a bad deck; null until the player first sits down, so someone
   * who never gambles carries no deck state.
   */
  casinoShoe: ShoeState | null;
  /** Null until the player answers Deuce's offer to stop calling the plays. */
  casinoHintsEnabled: boolean | null;
}

export function createClubMembership(): ClubMembership {
  return { hasDesperadoPass: false, casinoShoe: null, casinoHintsEnabled: null };
}
