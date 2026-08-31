#!/usr/bin/env tsx
/**
 * Bakes the Level 3 forest for review, at a chosen art seed.
 *
 *   Run: npm run gen:trees [-- <artSeedIndex>]
 *
 * The shipped game paints these sheets for itself when it enters the floor, from
 * the plans in `src/sprites/sheets/treeSheets.ts`, with the floor's own art seed
 * added to each variant's. This writes what the eye needs and runs the check a
 * picture cannot make for itself: that no frame is clipped by its own cell —
 * which has already happened three times here, and never showed up in a
 * typecheck.
 */

import { loadGameSpritesInNode } from './nodeCanvasGlobals.js';
import { bakePropFamily } from './propSheetBake.js';
import { treeSheetPlans } from '../src/sprites/sheets/treeSheets.js';
import { FLOOR_ART_SEEDS } from '../src/map/ground/artSeedAlphabet.js';
import { floorArtSubSeed, setFloorArtSeed, TREE_SALT } from '../src/map/ground/floorArtSeed.js';

const SEED_ARGUMENT_INDEX = 2;
const SEED_RADIX = 10;
const seedIndex =
  process.argv.length > SEED_ARGUMENT_INDEX
    ? Number.parseInt(process.argv[SEED_ARGUMENT_INDEX], SEED_RADIX)
    : 0;
if (!Number.isFinite(seedIndex)) {
  throw new Error(`art seed index must be a number, got "${process.argv[SEED_ARGUMENT_INDEX]}"`);
}
setFloorArtSeed(FLOOR_ART_SEEDS[Math.abs(seedIndex) % FLOOR_ART_SEEDS.length]);

await loadGameSpritesInNode();

const problems = bakePropFamily('trees', treeSheetPlans(floorArtSubSeed(TREE_SALT)));
if (problems.length > 0) {
  console.error(`\n[trees] FAIL — ${problems.length} problems`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
