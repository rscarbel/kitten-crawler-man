/**
 * Opens Wendell's construction contracts for a preset before the scene is
 * built: "The Borrowed Blueprints" written straight to `complete`, and
 * optionally a contract already issued and worked down to its last spot.
 * Dev-only, like the rest of `src/dev/`.
 */

import { BLUEPRINTS_GRAIN_TARGET } from '../core/blueprintsQuestPhase';
import type { BriarHollowState } from '../core/briarHollowState';
import type { VillageBuildingId } from '../map/overworld/briarHollowLayout';
import { issueContract } from '../systems/constructionContracts/contractGenerator';
import { blueprintsPlaytestState } from './blueprintsPlaytest';
import type { PlaytestContractsSetup } from './playtestPresets';

/**
 * Any seed draws a valid contract; a fixed one keeps the preset's spot set the
 * same from run to run.
 */
const PLAYTEST_CONTRACT_SEED = 1;

/** A fresh village state with the contracts unlocked as `setup` asks. */
export function contractsPlaytestState(setup: PlaytestContractsSetup): BriarHollowState {
  const state = blueprintsPlaytestState({
    phase: 'complete',
    fence: 'built',
    grain: BLUEPRINTS_GRAIN_TARGET,
  });
  state.blueprints.stationsUpgraded = { saw: true, ropeWalk: true };
  state.blueprints.completionScreenSeen = true;
  if (setup.lastSpotAt !== undefined) issueAlmostFinished(state, setup.lastSpotAt);
  return state;
}

function issueAlmostFinished(state: BriarHollowState, buildingId: VillageBuildingId): void {
  const contracts = state.contracts;
  contracts.introSeen = true;
  const active = issueContract(
    contracts,
    (site) => site.town === 'briar_hollow' && site.buildingId === buildingId,
    PLAYTEST_CONTRACT_SEED,
  );
  if (active === null) {
    console.error(`No contract could be issued at "${buildingId}"; contracts left open instead`);
    return;
  }
  const lastIndex = active.spotsDone.length - 1;
  active.spotsDone.fill(true);
  active.spotsDone[lastIndex] = false;
}
