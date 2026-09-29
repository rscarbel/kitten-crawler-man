#!/usr/bin/env tsx
/**
 * Bakes the town's street furniture for review.
 *
 *   Run: npm run gen:townscape [-- --write-manifest]
 *
 * The shipped game paints these sheets for itself at town load, from the same
 * plans in `src/sprites/sheets/townscapeSheets.ts`. Nothing written here is
 * loaded by anything — this is the eye's copy, plus the two checks a picture
 * cannot make for itself: that each plan agrees with the manifest entry every
 * draw site reads, and that no painter draws outside its own cell.
 *
 * `--write-manifest` rewrites `src/images/environment/townscape/manifest.json`
 * from the plans — run it after adding a sheet or changing a prop's variant
 * count, then bake again without the flag (the manifest is what the plans are
 * checked against, so the process that just wrote it still holds the old one).
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadGameSpritesInNode } from './nodeCanvasGlobals.js';
import { bakePropFamily } from './propSheetBake.js';
import { townscapeSheetPlans } from '../src/sprites/sheets/townscapeSheets.js';
import type { PropSheetPlan } from '../src/sprites/sheets/propSheetPlan.js';

const MANIFEST_PATH = resolve('src/images/environment/townscape/manifest.json');
const JSON_INDENT = 2;

const writeManifest = process.argv.includes('--write-manifest');

function manifestEntry(plan: PropSheetPlan): object {
  return {
    frameWidth: plan.frameWidth,
    frameHeight: plan.frameHeight,
    tileX: plan.tileX,
    tileY: plan.tileY,
    tileScale: plan.tileScale,
    states: Object.fromEntries(
      plan.rows.map((row, index) => [row.state, { row: index, frameCount: row.frames.length }]),
    ),
  };
}

const plans = townscapeSheetPlans();
if (writeManifest) {
  const manifest = Object.fromEntries(plans.map((plan) => [plan.key, manifestEntry(plan)]));
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, JSON_INDENT)}\n`);
  console.log(`wrote ${MANIFEST_PATH}`);
  console.log('manifest rewritten — run again without --write-manifest to bake');
  process.exit(0);
}

// The stall's counter stacks the game's own crate and barrel sheets, so those
// have to be loaded before anything is painted or they bake as blank counters.
await loadGameSpritesInNode();

const problems = bakePropFamily('townscape', plans);
if (problems.length > 0) {
  console.error(`\n[townscape] FAIL — ${problems.length} problems`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
