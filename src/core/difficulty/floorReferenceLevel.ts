/**
 * The party level the floor being played is balanced around: the level an
 * on-schedule party arrives at, as `recommendedPartyLevelFor` reads it off the
 * floor's own spawn bands on the normal profile.
 *
 * Published by the scene that enters a floor and read by blows whose size is
 * keyed to the floor rather than to the level of the mob dealing them — a
 * bomber goblin's blast cannot be dodged once a crawler is caught inside it,
 * so it must not grow with the thrower's level (P2 in
 * `docs/difficulty-fairness-rules.md`). Held here rather than threaded through
 * every spawn site because a mob can arrive by many paths — a floor's tables,
 * a siege wave, the AI's spawns — and every one of them is on the floor the
 * scene entered.
 */

/** The first floor's arrival level, and the answer before any floor has been entered. */
const FIRST_FLOOR_REFERENCE_PARTY_LEVEL = 1;

let referencePartyLevel = FIRST_FLOOR_REFERENCE_PARTY_LEVEL;

/** Sets the party level the floor now being played is balanced around. */
export function setFloorReferencePartyLevel(partyLevel: number): void {
  referencePartyLevel = Math.max(FIRST_FLOOR_REFERENCE_PARTY_LEVEL, Math.round(partyLevel));
}

/** The party level the floor being played is balanced around. */
export function floorReferencePartyLevel(): number {
  return referencePartyLevel;
}
