/**
 * Cross-scene state for Desperado Club membership.
 *
 * Like the questline progress objects (`CircusQuestProgress`,
 * `DoomsdayProgress`, …), this is a plain mutable object threaded by reference
 * through the `DungeonScene` ↔ `BuildingInteriorScene` constructors so the
 * player's membership survives entering and leaving the club. Obtaining the
 * Desperado Pass would (per the books) permanently forfeit any Club Vanquisher
 * membership — pure flavour here, since the rival club is out of scope.
 */
export interface ClubMembership {
  hasDesperadoPass: boolean;
}

export function createClubMembership(): ClubMembership {
  return { hasDesperadoPass: false };
}
