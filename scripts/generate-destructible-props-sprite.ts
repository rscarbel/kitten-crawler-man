#!/usr/bin/env tsx
/**
 * Bakes the dungeon's smashable furniture for review, at a chosen art seed.
 *
 *   Run: npx tsx scripts/generate-destructible-props-sprite.ts [<artSeedIndex>]
 *
 * The shipped game paints these sheets for itself from the plans in
 * `src/sprites/sheets/destructiblePropSheets.ts`. This writes what the eye needs
 * and runs the check a picture cannot make for itself: that no frame is clipped
 * by its own cell, which is exactly what a shatter burst or a flame tip against
 * the top edge would be.
 */

import { loadGameSpritesInNode } from './nodeCanvasGlobals.js';
import { bakePropFamily } from './propSheetBake.js';
import { destructiblePropSheetPlans } from '../src/sprites/sheets/destructiblePropSheets.js';
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

const problems = bakePropFamily('props', destructiblePropSheetPlans(floorArtSubSeed(PROP_SALT)));
if (problems.length > 0) {
  console.error(`\n[props] FAIL — ${problems.length} problems`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
