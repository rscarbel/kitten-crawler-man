#!/usr/bin/env tsx
/**
 * Bakes the Over City's own signage for review.
 *
 *   Run: npm run gen:over-city
 *
 * The shipped game paints these for itself at town load, from the plans in
 * `src/sprites/sheets/overCitySheets.ts`. The arm lengths are a property of the
 * words on them — `drawSignpost` measures each label — so the picture this
 * writes is node-canvas's font, and the game's is the player's browser's. Both
 * fit the same generously-sized frame, which is why the frame is that size.
 */

import { loadGameSpritesInNode } from './nodeCanvasGlobals.js';
import { bakePropFamily } from './propSheetBake.js';
import {
  OVER_CITY_GROUNDED_EDGES,
  overCitySheetPlans,
} from '../src/sprites/sheets/overCitySheets.js';

await loadGameSpritesInNode();

const problems = bakePropFamily('over_city', overCitySheetPlans(), {
  groundedEdges: OVER_CITY_GROUNDED_EDGES,
});
if (problems.length > 0) {
  console.error(`\n[over-city] FAIL — ${problems.length} problems`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
