/**
 * Picks, issues and settles construction contracts.
 *
 * A contract is 4–6 spots from one site's pool whose combined bill lands in
 * every material band. Pools are small, so every valid subset is enumerated
 * rather than sampled. The draw comes from a stream seeded by the world seed
 * and the number of contracts already issued, so a save reproduces its next
 * contract and a headless check is deterministic.
 */

import { ownEntry } from '../../core/guards';
import type { ActiveContract, ConstructionContractsState } from '../../core/briarHollowState';
import { mulberry32, subSeed, type Rng } from '../../sprites/person/rng';
import {
  CONTRACT_SITES,
  contractSiteFor,
  contractSiteKey,
  contractSpot,
  type ContractMaterialId,
  type ContractSiteDef,
  type ContractSpotCost,
  type ContractSpotDef,
  type ContractSpotId,
} from './contractCatalog';

export const CONTRACT_MIN_SPOTS = 4;
export const CONTRACT_MAX_SPOTS = 6;

/** Inclusive bounds on each material a whole contract may call for. */
export const CONTRACT_MATERIAL_BANDS = {
  wood_board: { min: 15, max: 20 },
  rope: { min: 3, max: 5 },
  stone: { min: 15, max: 25 },
} as const satisfies Record<ContractMaterialId, { readonly min: number; readonly max: number }>;

export const CONTRACT_COINS_PER_MATERIAL = 7;

/** The fewest distinct valid contracts any pool may offer, so repeats stay rare. */
export const CONTRACT_MIN_DISTINCT_SETS = 8;

/** Keeps the contract stream apart from every other stream forked off the world seed. */
const CONTRACT_STREAM_SALT = 0x0c0417ac;

const CONTRACT_MATERIALS: readonly ContractMaterialId[] = ['wood_board', 'rope', 'stone'];

function emptyCost(): ContractSpotCost {
  return { wood_board: 0, rope: 0, stone: 0 };
}

function sumCosts(spots: readonly ContractSpotDef[]): ContractSpotCost {
  const total = emptyCost();
  for (const spot of spots) {
    for (const material of CONTRACT_MATERIALS) total[material] += spot.cost[material];
  }
  return total;
}

function costWithinBands(cost: ContractSpotCost): boolean {
  return CONTRACT_MATERIALS.every((material) => {
    const band = CONTRACT_MATERIAL_BANDS[material];
    return cost[material] >= band.min && cost[material] <= band.max;
  });
}

function totalMaterials(cost: ContractSpotCost): number {
  return CONTRACT_MATERIALS.reduce((sum, material) => sum + cost[material], 0);
}

/** The spot defs an active contract names, skipping any its site's pool no longer has. */
export function contractSpots(active: ActiveContract): ContractSpotDef[] {
  const site = contractSiteFor(active.site);
  if (site === undefined) return [];
  return active.spotIds.flatMap((id) => {
    const spot = contractSpot(site, id);
    return spot === undefined ? [] : [spot];
  });
}

/** The whole contract's bill of materials, finished spots included. */
export function contractCost(active: ActiveContract): ContractSpotCost {
  return sumCosts(contractSpots(active));
}

/** What the unfinished spots still need. */
export function remainingContractCost(active: ActiveContract): ContractSpotCost {
  const site = contractSiteFor(active.site);
  if (site === undefined) return emptyCost();
  const unfinished = active.spotIds.flatMap((id, index) => {
    const spot = contractSpot(site, id);
    return spot === undefined || active.spotsDone[index] ? [] : [spot];
  });
  return sumCosts(unfinished);
}

/** Every board, rope and stone the contract uses. */
export function materialsIn(active: ActiveContract): number {
  return totalMaterials(contractCost(active));
}

/** Always derived from the spot costs, so the payout can never drift from the work. */
export function contractPayout(active: ActiveContract): number {
  return materialsIn(active) * CONTRACT_COINS_PER_MATERIAL;
}

export function isContractReady(active: ActiveContract): boolean {
  return active.spotsDone.length > 0 && active.spotsDone.every(Boolean);
}

/**
 * Every 4–6 spot subset of the site's pool whose bill lands in all three
 * bands, each listed in pool order.
 */
export function validSpotSets(site: ContractSiteDef): ContractSpotId[][] {
  const sets: ContractSpotId[][] = [];
  const pool = site.spots;
  const chosen: ContractSpotDef[] = [];
  const visit = (start: number): void => {
    if (chosen.length >= CONTRACT_MIN_SPOTS && costWithinBands(sumCosts(chosen))) {
      sets.push(chosen.map((spot) => spot.id));
    }
    if (chosen.length === CONTRACT_MAX_SPOTS) return;
    for (let index = start; index < pool.length; index++) {
      chosen.push(pool[index]);
      visit(index + 1);
      chosen.pop();
    }
  };
  visit(0);
  return sets;
}

function sameSpotSet(a: readonly ContractSpotId[], b: readonly ContractSpotId[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

/** The dedicated stream the contract numbered `contractsIssued` is drawn from. */
export function contractRng(worldSeed: number, contractsIssued: number): Rng {
  return mulberry32(subSeed(subSeed(worldSeed, CONTRACT_STREAM_SALT), contractsIssued));
}

function pickFrom<T>(rng: Rng, pool: readonly T[]): T | undefined {
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}

export interface ContractPick {
  readonly site: ContractSiteDef;
  readonly spotIds: readonly ContractSpotId[];
}

/**
 * Chooses a site uniformly from the eligible ones (never the last site run),
 * then a valid spot set uniformly from that site's (never its last set).
 * Null when no site is eligible.
 */
export function pickContract(
  state: ConstructionContractsState,
  eligibility: (site: ContractSiteDef) => boolean,
  rng: Rng,
): ContractPick | null {
  const sites = CONTRACT_SITES.filter(
    (site) =>
      site.slug !== state.lastSiteKey && eligibility(site) && validSpotSets(site).length > 0,
  );
  const site = pickFrom(rng, sites);
  if (site === undefined) return null;
  const lastSet = ownEntry(state.lastSpotSetBySite, site.slug);
  const allSets = validSpotSets(site);
  const freshSets =
    lastSet === undefined ? allSets : allSets.filter((set) => !sameSpotSet(set, lastSet));
  const spotIds = pickFrom(rng, freshSets.length > 0 ? freshSets : allSets);
  if (spotIds === undefined) return null;
  return { site, spotIds };
}

/**
 * Draws the next contract from its own stream and makes it the active one.
 * Null, and nothing changed, when no site is eligible or one is already active.
 */
export function issueContract(
  state: ConstructionContractsState,
  eligibility: (site: ContractSiteDef) => boolean,
  worldSeed: number,
): ActiveContract | null {
  if (state.active !== null) return null;
  const pick = pickContract(state, eligibility, contractRng(worldSeed, state.contractsIssued));
  if (pick === null) return null;
  const active: ActiveContract = {
    site: contractSiteKey(pick.site),
    spotIds: [...pick.spotIds],
    spotsDone: pick.spotIds.map(() => false),
  };
  state.active = active;
  state.contractsIssued += 1;
  return active;
}

function retireActive(state: ConstructionContractsState, active: ActiveContract): void {
  state.active = null;
  const site = contractSiteFor(active.site);
  if (site === undefined) return;
  state.lastSiteKey = site.slug;
  state.lastSpotSetBySite[site.slug] = [...active.spotIds];
}

/**
 * Settles a finished contract's bookkeeping and returns its payout; the caller
 * pays the coins. `active` is cleared before anything else, so a re-entrant
 * call finds nothing to settle. Null when no ready contract is held.
 */
export function completeContract(state: ConstructionContractsState): number | null {
  const active = state.active;
  if (active === null || !isContractReady(active)) return null;
  const payout = contractPayout(active);
  retireActive(state, active);
  state.contractsCompleted += 1;
  return payout;
}

/**
 * Abandons the active contract. Recorded like a finished one, so the next
 * contract Wendell offers is a different building.
 */
export function dropContract(state: ConstructionContractsState): void {
  const active = state.active;
  if (active === null) return;
  retireActive(state, active);
}
