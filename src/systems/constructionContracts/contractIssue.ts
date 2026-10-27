/**
 * Issuing a construction contract, and what the work-order posting says
 * about the contracts, shared by every place a contract can come from:
 * Wendell at Plumbline Farm and the notice boards in Taloncrest and Briar
 * Hollow. Both draw from the same per-world stream, so a contract taken off
 * a board is the one Wendell would have handed over.
 */

import type { ActiveContract, BriarHollowState } from '../../core/quests/briarHollowState';
import { formatCost } from '../../core/items/gathering/partyResources';
import type { WorkOrderNoticeState } from '../townNotices';
import type { QuestMarkerState } from '../../sprites/questNPCSprite';
import { contractSiteFor, contractSpot, type ContractSiteDef } from './contractCatalog';
import { contractContactName } from './contractContacts';
import { contractSiteEligible, type ContractWorld } from './contractEligibility';
import { contractCost, dropContract, isContractReady, issueContract } from './contractGenerator';
import { contractsUnlocked } from './contractQuest';

/** A contract just issued, with its catalogue entry and its bill written out. */
export interface IssuedContract {
  readonly active: ActiveContract;
  readonly site: ContractSiteDef;
  readonly costText: string;
}

/**
 * Draws and holds the next contract. Null, with nothing held, when no site
 * is eligible or a contract is already held. A held contract whose site the
 * catalogue no longer carries is let go first, so it never blocks the next.
 */
export function issueNextContract(
  state: BriarHollowState['contracts'],
  world: ContractWorld,
  worldSeed: number,
): IssuedContract | null {
  const held = state.active;
  if (held !== null && contractSiteFor(held.site) === undefined) dropContract(state);
  const active = issueContract(state, (site) => contractSiteEligible(site, world), worldSeed);
  if (active === null) return null;
  const site = contractSiteFor(active.site);
  if (site === undefined) return null;
  return { active, site, costText: formatCost(contractCost(active)) };
}

/** The labels of a held contract's unfinished spots, in the order they were issued. */
export function remainingSpotLabels(active: ActiveContract, site: ContractSiteDef): string[] {
  return active.spotIds.flatMap((id, index) => {
    if (active.spotsDone[index]) return [];
    const spot = contractSpot(site, id);
    return spot === undefined ? [] : [spot.label];
  });
}

/** What the notice boards' work-order posting says about the contracts right now. */
export function workOrderStateFor(state: BriarHollowState): WorkOrderNoticeState {
  if (!contractsUnlocked(state)) return { kind: 'locked' };
  const active = state.contracts.active;
  const site = active === null ? undefined : contractSiteFor(active.site);
  if (active === null || site === undefined) return { kind: 'open' };
  if (isContractReady(active)) return { kind: 'ready', contactName: contractContactName(site) };
  return { kind: 'held', siteName: site.name, remaining: remainingSpotLabels(active, site) };
}

/**
 * The overhead marker a notice board wears: `!` while a contract is waiting to
 * be taken off it, nothing while one is held, ready to collect, or contracts
 * are still locked. The same branch `workOrderStateFor` gives the board's
 * "take contract" action, so the marker never promises a posting the board
 * will not hand over.
 */
export function noticeBoardMarkerFor(state: BriarHollowState): QuestMarkerState {
  return workOrderStateFor(state).kind === 'open' ? 'exclamation' : 'none';
}
