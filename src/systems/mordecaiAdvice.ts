/**
 * What Mordecai tells the player is still worth doing on this floor.
 *
 * Pure logic: no canvas, no scene imports, no map access. It is handed a
 * snapshot of what is and is not done and returns the line to speak, so the
 * scenes stay the only thing that knows how to read the live systems. The
 * prose itself, and the direction-substitution it's built with, live in
 * `src/dialog/scripts/mordecai.ts` — this file only decides which objective
 * gets raised, and where it points.
 *
 * The advisor is the middle rank of three sources, in this order:
 *
 *     tutorial (if it handles it) → floor advice (if any objective remains) → AI chat
 *
 * Floor advice is deterministic and needs no server, so it answers "what's left
 * to do" reliably; returning `null` once everything is done is what hands a
 * cleared floor back to the AI chat for flavour.
 */

import { cardinalDirection } from '../utils';
import type { DialogLine } from '../dialog/line';
import { MORDECAI_ADVICE, type MordecaiAdviceArgs } from '../dialog/scripts/mordecai';

export interface AdviceObjective {
  readonly id: string;
  readonly complete: boolean;
  /** Tile position the player should head toward. */
  readonly target: { x: number; y: number } | null;
  /** Produces the `DialogLine` for this objective, given the bearing computed from it. */
  readonly line: (args: MordecaiAdviceArgs) => DialogLine;
  /**
   * Content the floor never requires of the player.
   *
   * Stepped over while anything the floor *does* require is still outstanding,
   * and raised once nothing is. An optional objective a player is simply not
   * interested in is never completed, and the advice walk stops at the first
   * unfinished entry, so without this one declined side quest would silence
   * every word he has about the boss beyond it for the rest of the floor.
   *
   * A floor's list therefore stays in walking order to document where the thing
   * *is*; where an optional entry sits in it does not decide when it is raised.
   */
  readonly optional?: boolean;
}

export type AdviceSlot = AdviceObjective;

export interface AdviceSnapshot {
  readonly floorNumber: number;
  /**
   * The tile every bearing in this snapshot is measured from.
   *
   * The safe room's own centre in the dungeon, so a floor's two safe rooms point
   * in genuinely different directions at the same boss. On floor 3 Mordecai
   * stands inside the town's safe-room building, whose interior grid has its
   * own origin — so it is that building's door tile there, the one position
   * that exists in both that scene and overworld space.
   */
  readonly bearingOrigin: { x: number; y: number };
  readonly objectives: ReadonlyArray<AdviceSlot>;
}

export class MordecaiAdvisor {
  /**
   * The line of the objective the floor wants raised next, or `null` when it
   * holds nothing left to point at.
   *
   * Required work first, in list order: a player who has already beaten a
   * higher-priority item simply hears about the next one. Optional work is
   * raised only once none of the required work is outstanding, and then also in
   * list order — which is what stops a side quest the player has no intention
   * of taking from standing in front of everything behind it. See
   * `AdviceObjective.optional`.
   */
  nextAdvice(snapshot: AdviceSnapshot): DialogLine | null {
    const unfinished = snapshot.objectives.filter((objective) => !objective.complete);
    if (unfinished.length === 0) return null;
    const next = unfinished.find((objective) => objective.optional !== true) ?? unfinished[0];
    return this.render(next, snapshot.bearingOrigin);
  }

  /**
   * Renders one specific objective, bypassing the "first incomplete" walk.
   *
   * A gateway safe room speaks about the boss it guards and nothing else, so it
   * needs to name its objective rather than take whatever is next in the floor's
   * ordering.
   */
  renderObjective(objective: AdviceObjective, bearingOrigin: { x: number; y: number }): DialogLine {
    return this.render(objective, bearingOrigin);
  }

  private render(objective: AdviceObjective, bearingOrigin: { x: number; y: number }): DialogLine {
    const { target } = objective;
    const direction = target === null ? null : cardinalDirection(bearingOrigin, target);
    return objective.line({ direction });
  }
}

/** The four gateway bosses whose speech is pinned to the safe room guarding them. */
const GATEWAY_ADVICE_IDS = ['the_hoarder', 'juicer', 'krakaren_clone', 'ball_of_swine'] as const;

/** A boss whose speech belongs to the safe room guarding it. */
export type GatewayAdviceId = (typeof GATEWAY_ADVICE_IDS)[number];

/** Every objective Mordecai has something to say about. */
export type AdviceObjectiveId =
  | 'the_hoarder'
  | 'juicer'
  | 'defend_goblin_mother'
  | 'krakaren_clone'
  | 'spider_lab'
  | 'ball_of_swine'
  | 'ball_of_swine_distant'
  | 'the_circus'
  | 'krasue_murders'
  | 'shady_bounties'
  | 'anchor_offer'
  | 'anchor_stone'
  | 'speed_fizz_tip';

/**
 * Narrows a safe room's `guardsBossType` to the objective whose prose it pins.
 *
 * The tag is a mob type string carried on the map, so the two vocabularies have
 * to be reconciled somewhere; they happen to agree on all four gateway bosses.
 */
export function gatewayAdviceId(bossType: string | undefined): GatewayAdviceId | null {
  if (bossType === undefined) return null;
  for (const id of GATEWAY_ADVICE_IDS) {
    if (id === bossType) return id;
  }
  return null;
}

/** One objective, with its prose looked up and its live state supplied. */
export function adviceObjective(
  id: AdviceObjectiveId,
  complete: boolean,
  target: { x: number; y: number } | null,
): AdviceObjective {
  return { id, complete, target, line: MORDECAI_ADVICE[id] };
}

/** Marks an objective as content the floor offers rather than demands. See `optional`. */
export function asOptional(objective: AdviceObjective): AdviceObjective {
  return { ...objective, optional: true };
}
