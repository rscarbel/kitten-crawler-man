#!/usr/bin/env tsx
/**
 * Bakes the town's street furniture for review.
 *
 *   Run: npm run gen:townscape
 *
 * The shipped game paints these sheets for itself at town load, from the same
 * plans in `src/sprites/sheets/townscapeSheets.ts`. Nothing written here is
 * loaded by anything — this is the eye's copy, plus the two checks a picture
 * cannot make for itself: that each plan agrees with the manifest entry every
 * draw site reads, and that no painter draws outside its own cell.
 */

import { loadGameSpritesInNode } from './nodeCanvasGlobals.js';
import { bakePropFamily } from './propSheetBake.js';
import { townscapeSheetPlans } from '../src/sprites/sheets/townscapeSheets.js';

// The stall's counter stacks the game's own crate and barrel sheets, so those
// have to be loaded before anything is painted or they bake as blank counters.
await loadGameSpritesInNode();

const problems = bakePropFamily('townscape', townscapeSheetPlans());
if (problems.length > 0) {
  console.error(`\n[townscape] FAIL — ${problems.length} problems`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
