/**
 * Which one of several things in reach an interact press is for.
 *
 * Prompts are raised by dozens of systems that each know only their own
 * object, so a crawler standing among a quest clue, a shelf and a person
 * would otherwise see a keycap over every one of them while a press reached
 * only one. Instead every prompt carries what kind of thing it names, the
 * prompt surface shows only the best of them, and the scene hands the next
 * press to that same one first, so the prompt on screen is always the press.
 */

/** What a prompt names, for ranking it against the others in reach. */
export type InteractableKind =
  /** Something an active quest needs: a clue, a quest prop, a quest-marked resident, contract work. */
  | 'quest'
  /** Someone to talk to. */
  | 'person'
  /** Someone keeping a counter, a stall or a desk. */
  | 'service'
  | 'pickup'
  /** A door, a mechanism, a bed: room furniture that does something. */
  | 'fixture'
  | 'readable'
  /** A prop to examine, search or use. */
  | 'examine'
  /** Whatever a system raised without saying what it is. */
  | 'other'
  /** The pet or the hireling, who stand at the party's shoulder all the time. */
  | 'companion';

/**
 * Lower ranks win; within a rank the nearer thing wins. Quest business comes
 * first, then people, then everything else; the party's own followers come
 * last because they are always in reach, so anything else nearby is what a
 * press is meant for.
 */
export const INTERACTABLE_RANK = {
  quest: 0,
  person: 1,
  service: 1,
  pickup: 2,
  fixture: 2,
  readable: 2,
  examine: 2,
  other: 2,
  companion: 3,
} as const satisfies Record<InteractableKind, number>;

/**
 * Who a prompt is raised for: what kind of thing it names, and what a press
 * on it does. A scene builds one per link of its interact chain and raises
 * that link's prompts through `raisePromptsFor`.
 */
export interface PromptOwner {
  readonly kind: InteractableKind;
  /**
   * Acts on the thing the prompt names, exactly as the scene's interact chain
   * would. False when it no longer answers, so the press falls through to the
   * rest of the chain.
   */
  readonly act: () => boolean;
}

/** A queued prompt's standing in the contest for the one prompt shown. */
export interface FocusCandidate {
  readonly kind: InteractableKind;
  /** Distance from the steering crawler, in any unit shared by every candidate. */
  readonly distance: number;
}

/**
 * The index of the candidate to show: the lowest rank, then the nearest,
 * then whichever was raised first. -1 when there are none.
 */
export function chooseFocus(candidates: readonly FocusCandidate[]): number {
  let best = -1;
  let bestRank = Number.POSITIVE_INFINITY;
  let bestDistance = Number.POSITIVE_INFINITY;
  candidates.forEach((candidate, index) => {
    const rank = INTERACTABLE_RANK[candidate.kind];
    const outranks = rank < bestRank || (rank === bestRank && candidate.distance < bestDistance);
    if (!outranks) return;
    best = index;
    bestRank = rank;
    bestDistance = candidate.distance;
  });
  return best;
}
