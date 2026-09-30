/**
 * Puts "The Borrowed Blueprints" at a preset's step before the scene is
 * built: the Plea won, every plan held, and the side quest's record written
 * directly into a fresh village state the scene is then handed. Seeded
 * before the scene rather than after, so everything the village raises on
 * its first frame — the herd, with or without Midge in it — reads the step
 * the preset asks for. Dev-only, like the rest of `src/dev/`.
 */

import { createBriarHollowState, type BriarHollowState } from '../core/briarHollowState';
import type { PlaytestBlueprintsSetup } from './playtestPresets';
import { unlockEverythingForPlaytest } from './briarHollowFortify';

/** A fresh village state standing at `setup`'s step of the side quest. */
export function blueprintsPlaytestState(setup: PlaytestBlueprintsSetup): BriarHollowState {
  const state = createBriarHollowState();
  unlockEverythingForPlaytest(state.unlocks);
  // Written straight to the record rather than through the Plea's own phase
  // switch: nothing about a won siege should play out on the first frame.
  state.quest.phase = 'complete';
  state.quest.rewardsGranted = true;
  const blueprints = state.blueprints;
  blueprints.phase = setup.phase;
  blueprints.fenceSectionsBuilt.fill(setup.fence === 'built');
  blueprints.grain = setup.grain;
  return state;
}
