/**
 * How much of each village resource the party has gained during the current
 * harvesting session — crawler and thrall harvests, lucky drops, and any
 * processing output. Spending never reduces it.
 *
 * Module state on purpose: the tally belongs to whichever `ResourceHud`
 * showing is currently up, not to a scene or a save, and survives door visits
 * and floor changes for free while that showing continues. `ResourceHud`
 * clears it once its strip has fully faded out, so the next showing counts
 * only what is gained after it reappears.
 */

import type { ItemId } from './ItemDefs';

const tally = new Map<ItemId, number>();

/** Adds `amount` of `id` gained this session. Non-positive amounts are ignored. */
export function addToSessionTally(id: ItemId, amount: number): void {
  if (amount <= 0) return;
  tally.set(id, (tally.get(id) ?? 0) + amount);
}

/** Total of `id` gained since the current session began. */
export function sessionTallyOf(id: ItemId): number {
  return tally.get(id) ?? 0;
}

/** Clears every count. Called once a session's display has fully faded out, and by headless verification. */
export function resetSessionTally(): void {
  tally.clear();
}
