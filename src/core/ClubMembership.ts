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

/** A point-in-time copy of the club's cross-scene state. */
export interface ClubMembershipCheckpoint {
  hasDesperadoPass: boolean;
  casinoShoe: ShoeState | null;
  casinoHintsEnabled: boolean | null;
}

/**
 * The card array is copied rather than aliased so the live shoe and the stored
 * one can never be the same array. `Card` is fully readonly, so the elements
 * themselves need no copy.
 */
function copyShoe(shoe: ShoeState | null): ShoeState | null {
  if (shoe === null) return null;
  return { cards: [...shoe.cards], cursor: shoe.cursor };
}

/**
 * Snapshots the club so a death rewinds it along with the coins that paid for
 * it. The shoe is part of that: gambling losses rewind with the player's purse,
 * so a shoe that survived would let a player learn the deck's order across
 * deaths and then bet against a rewound stack of coins with perfect knowledge.
 */
export function captureClubMembership(membership: ClubMembership): ClubMembershipCheckpoint {
  return {
    hasDesperadoPass: membership.hasDesperadoPass,
    casinoShoe: copyShoe(membership.casinoShoe),
    casinoHintsEnabled: membership.casinoHintsEnabled,
  };
}

/**
 * Mutates in place: the same `ClubMembership` object is threaded by reference
 * through every scene, so rebinding a fresh one would strand every holder.
 *
 * The shoe is copied again here because one snapshot is restored once per death
 * — handing the stored array straight to the live field would let the next
 * shuffle mutate the snapshot itself.
 */
export function restoreClubMembership(
  membership: ClubMembership,
  snapshot: ClubMembershipCheckpoint,
): void {
  membership.hasDesperadoPass = snapshot.hasDesperadoPass;
  membership.casinoShoe = copyShoe(snapshot.casinoShoe);
  membership.casinoHintsEnabled = snapshot.casinoHintsEnabled;
}
