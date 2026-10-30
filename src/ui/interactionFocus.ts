/**
 * Which one of several things in reach an interact press is for.
 *
 * Prompts are raised by dozens of systems that each know only their own
 * object, so a crawler standing among a quest clue, a shelf and a person
 * would otherwise see a keycap over every one of them while a press reached
 * only one. Instead every prompt carries what kind of thing it names, the
 * prompt surface shows only the best of them, and the scene hands the next
 * press to that same one first, so the prompt on screen is always the press.
 *
 * What a press may reach also depends on the fight around the party, its
 * {@link InteractionStance}: the same answer hides prompts and refuses presses,
 * so a prompt is never shown for a press that would swing instead.
 */

/** What a prompt names, for ranking it against the others in reach. */
export type InteractableKind =
  /** A thing an active quest needs: a clue spot, a quest prop, a quest board, contract work. */
  | 'quest'
  /** A person a quest marker or tracker hangs over: quest business reached by talking. */
  | 'questPerson'
  /**
   * A working part of the fight in progress (a pillar to unbind, a cell door
   * to batter), worked with hostiles about, so a hostile in reach never makes
   * its press a swing.
   */
  | 'fightMechanic'
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
 * What an interact press reaches in reach, best first: quest business; then
 * people; then things; then the party's own followers, last because they are
 * always in reach, so anything else nearby is what a press is meant for. A
 * swing outranks every tier while the party is fighting, which is the
 * {@link InteractionStance}'s to decide, not a tier's.
 */
export const PRESS_TIERS = ['quest', 'people', 'things', 'followers'] as const;

/** One step of {@link PRESS_TIERS}. */
export type PressTier = (typeof PRESS_TIERS)[number];

/** Where a kind of interactable stands in the press order. */
interface InteractableStanding {
  readonly tier: PressTier;
  /** A press on it is a conversation, which is never offered while enemies are near. */
  readonly talk: boolean;
  /** Still offered while a hostile is in attack range. */
  readonly worksMidFight: boolean;
}

/** The standing of every kind; a new kind cannot ship without its row. */
export const INTERACTABLES = {
  quest: { tier: 'quest', talk: false, worksMidFight: false },
  questPerson: { tier: 'quest', talk: true, worksMidFight: false },
  fightMechanic: { tier: 'quest', talk: false, worksMidFight: true },
  person: { tier: 'people', talk: true, worksMidFight: false },
  service: { tier: 'people', talk: true, worksMidFight: false },
  pickup: { tier: 'things', talk: false, worksMidFight: false },
  fixture: { tier: 'things', talk: false, worksMidFight: false },
  readable: { tier: 'things', talk: false, worksMidFight: false },
  examine: { tier: 'things', talk: false, worksMidFight: false },
  other: { tier: 'things', talk: false, worksMidFight: false },
  companion: { tier: 'followers', talk: true, worksMidFight: false },
} as const satisfies Record<InteractableKind, InteractableStanding>;

/** Lower ranks win: a kind's place in {@link PRESS_TIERS}. */
export function interactableRank(kind: InteractableKind): number {
  return PRESS_TIERS.indexOf(INTERACTABLES[kind].tier);
}

/**
 * The fight around the steering crawler, as it bears on an interact press.
 *
 * - `fighting`: a hostile is inside the crawler's attack range. The press is
 *   a swing; nothing but a {@link INTERACTABLES} `worksMidFight` kind is
 *   prompted or reached.
 * - `enemiesNear`: no hostile in attack range, but one that knows the party
 *   is there stands within the enemies-near radius. Nothing that is a
 *   conversation is prompted or reached; everything else is.
 * - `clear`: everything in reach is offered.
 */
export type InteractionStance = 'fighting' | 'enemiesNear' | 'clear';

/** Whether `stance` lets a press reach, and a prompt name, a thing of `kind`. */
export function stanceAllows(stance: InteractionStance, kind: InteractableKind): boolean {
  const standing = INTERACTABLES[kind];
  switch (stance) {
    case 'fighting':
      return standing.worksMidFight;
    case 'enemiesNear':
      return !standing.talk;
    case 'clear':
      return true;
    default: {
      const unhandled: never = stance;
      return unhandled;
    }
  }
}

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

/**
 * Offers a press to `owner` when `stance` lets it reach that kind of thing.
 * Every link of a scene's interact chain goes through this or
 * `pressFocusedPrompt`, so a press can never reach what the prompt surface
 * would not have named.
 */
export function offerPress(owner: PromptOwner, stance: InteractionStance): boolean {
  return stanceAllows(stance, owner.kind) && owner.act();
}

/** A queued prompt's standing in the contest for the one prompt shown. */
export interface FocusCandidate {
  readonly kind: InteractableKind;
  /** Distance from the steering crawler, in any unit shared by every candidate. */
  readonly distance: number;
}

/**
 * The index of the candidate to show: of those `stance` allows, the lowest
 * rank, then the nearest, then whichever was raised first. -1 when there
 * are none.
 */
export function chooseFocus(
  candidates: readonly FocusCandidate[],
  stance: InteractionStance,
): number {
  let best = -1;
  let bestRank = Number.POSITIVE_INFINITY;
  let bestDistance = Number.POSITIVE_INFINITY;
  candidates.forEach((candidate, index) => {
    if (!stanceAllows(stance, candidate.kind)) return;
    const rank = interactableRank(candidate.kind);
    const outranks = rank < bestRank || (rank === bestRank && candidate.distance < bestDistance);
    if (!outranks) return;
    best = index;
    bestRank = rank;
    bestDistance = candidate.distance;
  });
  return best;
}
