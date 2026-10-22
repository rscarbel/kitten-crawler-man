/**
 * Cross-scene state for the Desperado Club: membership, and whatever the club's
 * stations must remember between visits.
 *
 * Like the questline progress objects (`CircusQuestProgress`,
 * `DoomsdayProgress`, …), this is a plain mutable object threaded by reference
 * through the `DungeonScene` ↔ `BuildingInteriorScene` constructors so it
 * survives entering and leaving the club. Obtaining the Desperado Pass would
 * permanently forfeit any Club Vanquisher membership — pure
 * flavour here, since the rival club is out of scope.
 */

import type { ShoeState } from '../systems/casino/Deck';
import type { PlayerRead } from '../systems/casino/poker/npc/playerRead';
import { REGULAR_IDS, type RegularId } from '../systems/casino/poker/npc/regulars';
import { JACKPOT_FLOOR, normalizeJackpotPool } from '../systems/casino/slots/slotBets';

/** What each poker regular has learned about the player's play this run. */
export type PokerReads = Partial<Record<RegularId, PlayerRead>>;

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
  /**
   * Belongs to the run, like the regulars' rolled personalities: a new run
   * starts with strangers who have never watched the player bluff.
   */
  pokerReads: PokerReads;
  /**
   * The player's own side of the same watching: how each regular has played in
   * front of them, which is all the seat-info card may show.
   */
  pokerNotes: PokerReads;
  /** The poker table's Fast toggle: shorter beats between actions. */
  pokerFast: boolean;
  /** The poker table's Show cards toggle: the player's losing hand is shown rather than mucked. */
  pokerShowCards: boolean;
  /**
   * The floor the VIP lounge's Private Escort was booked on, or null when none
   * is booked. The booking runs until the party is on any other floor, so
   * walking out of the club and back in finds the pair still on duty.
   */
  escortLevelId: string | null;
  /**
   * The slot machine's progressive pool. It may hold a fraction of a coin
   * (see `normalizeJackpotPool`); only whole coins are ever shown or paid.
   */
  slotsJackpotPool: number;
  /** The slot machine's Turbo toggle: shorter reel stops and celebrations. */
  slotsTurbo: boolean;
}

export function createClubMembership(): ClubMembership {
  return {
    hasDesperadoPass: false,
    casinoShoe: null,
    casinoHintsEnabled: null,
    pokerReads: {},
    pokerNotes: {},
    pokerFast: false,
    pokerShowCards: false,
    escortLevelId: null,
    slotsJackpotPool: JACKPOT_FLOOR,
    slotsTurbo: false,
  };
}

/** A point-in-time copy of the club's cross-scene state. */
export interface ClubMembershipCheckpoint {
  hasDesperadoPass: boolean;
  casinoShoe: ShoeState | null;
  casinoHintsEnabled: boolean | null;
  pokerReads: PokerReads;
  pokerNotes: PokerReads;
  pokerFast: boolean;
  pokerShowCards: boolean;
  escortLevelId: string | null;
  slotsJackpotPool: number;
  slotsTurbo: boolean;
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
 * Each read is copied as well as the record holding them, so the live table
 * replacing or rebuilding one never reaches into a stored snapshot.
 */
export function copyPokerReads(reads: PokerReads): PokerReads {
  const copy: PokerReads = {};
  for (const id of REGULAR_IDS) {
    const read = reads[id];
    if (read !== undefined) copy[id] = { ...read };
  }
  return copy;
}

/**
 * Snapshots the club so a death rewinds it along with the coins that paid for
 * it. The shoe is part of that: gambling losses rewind with the player's purse,
 * so a shoe that survived would let a player learn the deck's order across
 * deaths and then bet against a rewound stack of coins with perfect knowledge.
 * The poker reads and notes rewind for the same reason: hands the player died
 * after never happened, so nobody at the table can remember them.
 */
export function captureClubMembership(membership: ClubMembership): ClubMembershipCheckpoint {
  return {
    hasDesperadoPass: membership.hasDesperadoPass,
    casinoShoe: copyShoe(membership.casinoShoe),
    casinoHintsEnabled: membership.casinoHintsEnabled,
    pokerReads: copyPokerReads(membership.pokerReads),
    pokerNotes: copyPokerReads(membership.pokerNotes),
    pokerFast: membership.pokerFast,
    pokerShowCards: membership.pokerShowCards,
    escortLevelId: membership.escortLevelId,
    slotsJackpotPool: membership.slotsJackpotPool,
    slotsTurbo: membership.slotsTurbo,
  };
}

/**
 * Mutates in place: the same `ClubMembership` object is threaded by reference
 * through every scene, so rebinding a fresh one would strand every holder.
 *
 * The shoe and the poker reads are copied again here because one snapshot is
 * restored once per death — handing the stored values straight to the live
 * fields would let the next shuffle or hand mutate the snapshot itself.
 */
export function restoreClubMembership(
  membership: ClubMembership,
  snapshot: ClubMembershipCheckpoint,
): void {
  membership.hasDesperadoPass = snapshot.hasDesperadoPass;
  membership.casinoShoe = copyShoe(snapshot.casinoShoe);
  membership.casinoHintsEnabled = snapshot.casinoHintsEnabled;
  membership.pokerReads = copyPokerReads(snapshot.pokerReads);
  membership.pokerNotes = copyPokerReads(snapshot.pokerNotes);
  membership.pokerFast = snapshot.pokerFast;
  membership.pokerShowCards = snapshot.pokerShowCards;
  membership.escortLevelId = snapshot.escortLevelId;
  membership.slotsJackpotPool = normalizeJackpotPool(snapshot.slotsJackpotPool);
  membership.slotsTurbo = snapshot.slotsTurbo;
}
