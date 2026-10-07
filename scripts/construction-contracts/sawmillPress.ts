/**
 * Space at the sawmill while Fenna stands beside it, for
 * `verify:construction-contracts`.
 *
 * Fenna is both the sawmill's contract client and the villager who offers
 * "The Borrowed Blueprints", so a glyph over her head must never steal a
 * press from the machine it was meant for: with her offer's `!` up and the
 * saw nearer, Space starts the cut and opens no conversation (her offer's
 * Space default is accept, so a stolen press would take the side quest by
 * accident). A cut in progress keeps every press. Once she owes the party
 * for a finished contract, a press where she stands nearer than the saw
 * still reaches her and pays out.
 */

import { buildSiegeRig, standAt, type SiegeRig } from '../villageSiegeHarness';
import { createBriarHollowState } from '../../src/core/briarHollowState';
import { TILE_SIZE } from '../../src/core/constants';
import { TIKKA_PLANS_UNLOCKS, grantConstructionUnlocks } from '../../src/core/villageUnlocks';
import {
  contractPayout,
  issueContract,
} from '../../src/systems/constructionContracts/contractGenerator';
import type { Check } from './shared';

const RIG_SEED = 7919;
const ASSAULT_LEVEL = 6;
/** Frames for the village to settle its routines and markers before any press. */
const SETTLE_FRAMES = 120;
/** Frames for the markers to catch up after a quest state is changed by hand. */
const MARKER_FRAMES = 3;
/** Enough wood for several cuts. */
const WOOD_HELD = 10;
/** How far around Fenna the stand-in tiles are searched. */
const SEARCH_RADIUS_TILES = 3;
/** More presses than any thanks line has pages. */
const MAX_PAGE_PRESSES = 2000;
const SAWMILL_SITE_SLUG = 'sawmill';
/** Longer than any one cut takes. */
const MAX_CUT_FRAMES = 3000;

type Stand = 'machine_nearer' | 'fenna_nearer';

function fennaOf(rig: SiegeRig) {
  const fenna = rig.kit.villagers?.villagerFor('fenna') ?? null;
  if (fenna === null) throw new Error('the village has no Fenna');
  return fenna;
}

function sawmillOf(rig: SiegeRig) {
  const sawmill = rig.kit.services?.sawmill ?? null;
  if (sawmill === null) throw new Error('the village has no sawmill');
  return sawmill;
}

/**
 * Stands the human on a tile from which a press would reach Fenna and,
 * for `machine_nearer`, a machine nearer than her; for `fenna_nearer`, no
 * machine as near as she is. Returns whether such a tile was found.
 */
function standBesideFenna(rig: SiegeRig, stand: Stand): boolean {
  const fenna = fennaOf(rig);
  const sawmill = sawmillOf(rig);
  const villagers = rig.kit.villagers;
  const fx = Math.round(fenna.x / TILE_SIZE);
  const fy = Math.round(fenna.y / TILE_SIZE);
  for (let dy = -SEARCH_RADIUS_TILES; dy <= SEARCH_RADIUS_TILES; dy++) {
    for (let dx = -SEARCH_RADIUS_TILES; dx <= SEARCH_RADIUS_TILES; dx++) {
      if (!rig.map.isWalkable(fx + dx, fy + dy)) continue;
      standAt(rig.human, fx + dx, fy + dy);
      if (villagers?.talkTarget(rig.human) !== fenna) continue;
      const fennaTiles = Math.hypot(fenna.x - rig.human.x, fenna.y - rig.human.y) / TILE_SIZE;
      const machineInReach = sawmill.stationFor(rig.human) !== null;
      const machineNearer = machineInReach && sawmill.tilesToStation(rig.human) <= fennaTiles;
      if (stand === 'machine_nearer' ? machineNearer : !machineNearer) return true;
    }
  }
  return false;
}

function readThrough(rig: SiegeRig): void {
  const conversation = rig.kit.villagers?.conversation;
  if (conversation === undefined) return;
  for (let press = 0; press < MAX_PAGE_PRESSES && conversation.isOpen; press++) {
    conversation.update(null);
    if (!conversation.isOpen) break;
    conversation.advance();
  }
}

function freshRig(): SiegeRig {
  const state = createBriarHollowState();
  state.quest.phase = 'fortifying';
  state.unlocks.processingStations = true;
  grantConstructionUnlocks(state.unlocks, TIKKA_PLANS_UNLOCKS);
  const rig = buildSiegeRig({ seed: RIG_SEED, assaultLevel: ASSAULT_LEVEL, state });
  rig.human.craftSkills.learn('construction');
  rig.human.inventory.addItem('wood', WOOD_HELD);
  for (let frame = 0; frame < SETTLE_FRAMES; frame++) rig.step();
  return rig;
}

function stepFrames(rig: SiegeRig, frames: number): void {
  for (let frame = 0; frame < frames; frame++) rig.step();
}

function verifyOfferDoesNotStealTheSaw(check: Check): void {
  const rig = freshRig();
  const villagers = rig.kit.villagers;
  const sawmill = sawmillOf(rig);
  check(fennaOf(rig).marker === 'exclamation', "Fenna wears her side quest's offer `!`");
  if (!standBesideFenna(rig, 'machine_nearer')) {
    check(false, 'a tile reaches both Fenna and a nearer machine');
    return;
  }
  check(rig.kit.services?.wouldInteract(rig.human) === true, 'the prompt names the machine');
  rig.kit.tryInteract(rig.human, false);
  check(
    sawmill.isWorking && villagers?.isConversationOpen === false,
    `Space with the saw nearer starts the cut and opens no conversation (working ${sawmill.isWorking}, conversation ${villagers?.isConversationOpen})`,
  );
  rig.kit.tryInteract(rig.human, false);
  check(
    sawmill.isWorking && villagers?.isConversationOpen === false,
    'Space mid-cut keeps the cut and opens no conversation',
  );
}

function verifyOwedFennaIsPaid(check: Check): void {
  const rig = freshRig();
  const { state } = rig;
  state.blueprints.phase = 'complete';
  const active = issueContract(
    state.contracts,
    (site) => site.slug === SAWMILL_SITE_SLUG,
    RIG_SEED,
  );
  if (active === null) {
    check(false, 'a sawmill contract is issued');
    return;
  }
  for (let index = 0; index < active.spotsDone.length; index++) active.spotsDone[index] = true;
  const payout = contractPayout(active);
  stepFrames(rig, MARKER_FRAMES);
  const villagers = rig.kit.villagers;
  const sawmill = sawmillOf(rig);
  check(fennaOf(rig).marker === 'question', 'Fenna wears the `?` of a payment owed');

  if (standBesideFenna(rig, 'machine_nearer')) {
    rig.kit.tryInteract(rig.human, false);
    check(
      villagers?.isConversationOpen === false,
      'with the saw nearer, Space still goes to the saw, not to the payment',
    );
    rig.kit.tryInteract(rig.human, false);
    check(
      villagers?.isConversationOpen === false && state.contracts.active !== null,
      'Space mid-cut never opens the payment',
    );
    for (let frame = 0; frame < MAX_CUT_FRAMES && sawmill.isWorking; frame++) rig.step();
  }

  if (!standBesideFenna(rig, 'fenna_nearer')) {
    check(false, 'a tile reaches Fenna with no machine nearer');
    return;
  }
  const coins = rig.human.coins;
  rig.kit.tryInteract(rig.human, false);
  check(villagers?.isConversationOpen === true, 'Space with Fenna nearer opens her thanks');
  readThrough(rig);
  check(
    rig.human.coins - coins === payout && state.contracts.active === null,
    `reading her thanks pays ${payout} coins and settles the contract (paid ${rig.human.coins - coins})`,
  );
}

export const sawmillPressSections = [
  { name: "Fenna's offer never takes the saw's press", run: verifyOfferDoesNotStealTheSaw },
  { name: 'Fenna, owed for the sawmill, is paid at her own press', run: verifyOwedFennaIsPaid },
];
