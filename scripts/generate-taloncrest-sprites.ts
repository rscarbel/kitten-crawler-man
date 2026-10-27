#!/usr/bin/env tsx
/**
 * Bakes Taloncrest's own signage for review.
 *
 *   Run: npm run gen:taloncrest
 *
 * The shipped game paints these for itself at town load, from the plans in
 * `src/sprites/sheets/taloncrestSheets.ts`. The arm lengths are a property of the
 * words on them — `drawSignpost` measures each label — so the picture this
 * writes is node-canvas's font, and the game's is the player's browser's. Both
 * fit the same generously-sized frame, which is why the frame is that size.
 */

import { loadGameSpritesInNode } from './nodeCanvasGlobals.js';
import { bakePropFamily } from './propSheetBake.js';
import {
  TALONCREST_GROUNDED_EDGES,
  taloncrestSheetPlans,
} from '../src/sprites/sheets/taloncrestSheets.js';

await loadGameSpritesInNode();

const problems = bakePropFamily('taloncrest', taloncrestSheetPlans(), {
  groundedEdges: TALONCREST_GROUNDED_EDGES,
});
if (problems.length > 0) {
  console.error(`\n[taloncrest] FAIL — ${problems.length} problems`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
