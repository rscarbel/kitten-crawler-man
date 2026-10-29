/**
 * Which objective on this floor is worth raising next, for Dave's tactics and
 * Caroline's intel about it.
 *
 * Pure logic: no canvas, no scene imports, no map access. It is handed a
 * snapshot of what is and is not done and returns the objective, so the
 * scenes stay the only thing that knows how to read the live systems. The
 * prose lives in `src/dialog/scripts/dave.ts` (`DAVE_ADVICE`, how to survive
 * it) and `src/dialog/scripts/caroline.ts` (`CAROLINE_OBJECTIVE_INTEL`, where
 * it is, what it is and whether it is optional), both keyed on
 * {@link AdviceObjectiveId}.
 *
 * Floor advice is deterministic and needs no server, so it answers "what's left
 * to do" reliably; no objective left is what hands a cleared floor back to the
 * AI chat for flavour.
 */

import { cardinalDirection } from '../utils';
import type { AdviceObjectiveId } from '../story/adviceObjectiveIds';
import type { DialogLine } from '../dialog/line';
import type { CarolineMessage } from '../dialog/caroline';
import { DAVE_ADVICE } from '../dialog/scripts/dave';
import { CAROLINE_OBJECTIVE_INTEL } from '../dialog/scripts/caroline';

export interface AdviceObjective {
  readonly id: AdviceObjectiveId;
  readonly complete: boolean;
  /** Tile position the player should head toward. */
  readonly target: { x: number; y: number } | null;
  /**
   * Content the floor never requires of the player.
   *
   * Stepped over while anything the floor *does* require is still outstanding,
   * and raised once nothing is. An optional objective a player is simply not
   * interested in is never completed, and the advice walk stops at the first
   * unfinished entry, so without this one declined side quest would silence
   * every word about the boss beyond it for the rest of the floor.
   *
   * A floor's list therefore stays in walking order to document where the thing
   * *is*; where an optional entry sits in it does not decide when it is raised.
   */
  readonly optional?: boolean;
}

export type AdviceSlot = AdviceObjective;

/**
 * The objective a floor wants raised next, or null when it holds nothing left
 * to point at.
 *
 * Required work first, in list order: a player who has already beaten a
 * higher-priority item simply hears about the next one. Optional work is
 * raised only once none of the required work is outstanding, and then also in
 * list order, which is what stops a side quest the player has no intention of
 * taking from standing in front of everything behind it. See
 * `AdviceObjective.optional`.
 */
export function nextAdviceObjective(
  objectives: ReadonlyArray<AdviceObjective>,
): AdviceObjective | null {
  const unfinished = objectives.filter((objective) => !objective.complete);
  if (unfinished.length === 0) return null;
  return unfinished.find((objective) => objective.optional !== true) ?? unfinished[0];
}

/** Dave's tactics for an objective. */
export function adviceTactics(objective: AdviceObjective): DialogLine {
  return DAVE_ADVICE[objective.id];
}

/**
 * Caroline's intel about an objective, with its bearing taken from
 * `bearingOrigin`: the safe room's own centre in the dungeon, so a floor's
 * safe rooms point different ways at the same boss, and a building's door
 * tile for a safe room inside one, the one position that exists in both that
 * scene and the floor outside.
 */
export function adviceIntel(
  objective: AdviceObjective,
  bearingOrigin: { x: number; y: number },
): CarolineMessage {
  const { target } = objective;
  const direction = target === null ? null : cardinalDirection(bearingOrigin, target);
  return CAROLINE_OBJECTIVE_INTEL[objective.id]({ direction });
}

/** The gateway bosses whose speech is pinned to the safe room guarding them. */
const GATEWAY_ADVICE_IDS = ['trash_gremlin', 'big_rooster', 'kraken', 'electric_goblin'] as const;

/** A boss whose speech belongs to the safe room guarding it. */
export type GatewayAdviceId = (typeof GATEWAY_ADVICE_IDS)[number];

/**
 * Narrows a safe room's `guardsBossType` to the objective whose prose it pins.
 *
 * The tag is a mob type string carried on the map, so the two vocabularies have
 * to be reconciled somewhere; they happen to agree on every gateway boss.
 */
export function gatewayAdviceId(bossType: string | undefined): GatewayAdviceId | null {
  if (bossType === undefined) return null;
  for (const id of GATEWAY_ADVICE_IDS) {
    if (id === bossType) return id;
  }
  return null;
}

/** One objective with its live state. */
export function adviceObjective(
  id: AdviceObjectiveId,
  complete: boolean,
  target: { x: number; y: number } | null,
): AdviceObjective {
  return { id, complete, target };
}

/** Marks an objective as content the floor offers rather than demands. See `optional`. */
export function asOptional(objective: AdviceObjective): AdviceObjective {
  return { ...objective, optional: true };
}
