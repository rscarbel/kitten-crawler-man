#!/usr/bin/env tsx
/**
 * Bakes the Desperado Club's furniture for review, at a chosen art seed.
 *
 *   Run: npx tsx scripts/generate-club-furniture-sprite.ts [<artSeedIndex>]
 *
 * The shipped game paints these sheets for itself from the plans in
 * `src/sprites/sheets/clubFurnitureSheets.ts`, with the floor's own art seed
 * added to each family's. This writes what the eye needs and runs the check a
 * picture cannot make for itself: that nothing is sheared off by the top of its
 * own cell, which is what an awning or a swagged rope that outgrew its headroom
 * would be.
 */

import { loadGameSpritesInNode } from './nodeCanvasGlobals.js';
import { bakePropFamily } from './propSheetBake.js';
import {
  CLUB_GROUNDED_EDGES,
  clubFurnitureSheetPlans,
} from '../src/sprites/sheets/clubFurnitureSheets.js';
import { FLOOR_ART_SEEDS } from '../src/map/ground/artSeedAlphabet.js';
import { floorArtSubSeed, setFloorArtSeed, PROP_SALT } from '../src/map/ground/floorArtSeed.js';

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

const problems = bakePropFamily('club', clubFurnitureSheetPlans(floorArtSubSeed(PROP_SALT)), {
  groundedEdges: CLUB_GROUNDED_EDGES,
});
if (problems.length > 0) {
  console.error(`\n[club] FAIL — ${problems.length} problems`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
