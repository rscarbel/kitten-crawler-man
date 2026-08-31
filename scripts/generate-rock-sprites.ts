#!/usr/bin/env tsx
/**
 * Bakes the Level 3 wilderness's boulders for review, at a chosen art seed.
 *
 *   Run: npm run gen:rocks [-- <artSeedIndex>]
 *
 * The shipped game paints these sheets for itself when it enters the floor,
 * from the plans in `src/sprites/sheets/rockSheets.ts`, with the floor's own
 * art seed added to each variant's. This writes what the eye needs and runs the
 * checks a picture cannot make for itself: that no frame is clipped by its own
 * cell, and that no boulder's body escapes the one tile it blocks.
 */

import { loadGameSpritesInNode } from './nodeCanvasGlobals.js';
import { bakePropFamily, type PropSheetCheck } from './propSheetBake.js';
import { rockSheetPlans, ROCK_TILE_SCALE } from '../src/sprites/sheets/rockSheets.js';
import { FLOOR_ART_SEEDS } from '../src/map/ground/artSeedAlphabet.js';
import { floorArtSubSeed, setFloorArtSeed, ROCK_SALT } from '../src/map/ground/floorArtSeed.js';

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

/**
 * Alpha at or above which a pixel counts as the rock's body rather than as the
 * soft shadow it casts. The contact shadow peaks at 0.42 alpha and is *meant* to
 * spill onto the neighbouring tiles — a shadow that stopped dead on a tile
 * boundary would be the more obvious artefact.
 */
const SOLID_ALPHA_THRESHOLD = 200;
const ALPHA_CHANNEL_OFFSET = 3;
const CHANNELS_PER_PIXEL = 4;

/**
 * Reports a sheet whose body reaches sideways out of the one tile the boulder
 * blocks.
 *
 * Only the anchor tile is in `NON_WALKABLE_TILE_TYPES`, so every solid pixel
 * beside it is ground the player can walk onto while being drawn behind the
 * stone — they end up standing *inside* the rock. The first cut's large boulder
 * was nearly two tiles wide and put 380–490 such pixels on its neighbours, which
 * is what made the collision read as wrong rather than merely generous.
 *
 * **Horizontal only, on purpose.** Solid pixels *above* the anchor tile are the
 * point rather than a fault: that is a rock standing tall enough to occlude a
 * player behind it, and `boulder_large_b` has 113 of them. Height is honest
 * because the tile below the overhang is the boulder's own; width is not,
 * because the tile beside it belongs to the meadow.
 *
 * This is a bake-time check rather than a review note because the half-width
 * budget in `rockArt.ts` is enforced per stone, and a future cluster member or a
 * wider shear could satisfy every constant there and still land ink next door.
 */
const assertBodyFitsBlockedTile: PropSheetCheck = (plan, pixels) => {
  const alphaAt = (x: number, y: number): number =>
    pixels.data[(y * pixels.width + x) * CHANNELS_PER_PIXEL + ALPHA_CHANNEL_OFFSET];

  const problems: string[] = [];
  plan.rows.forEach((row, rowIndex) => {
    row.frames.forEach((_frame, columnIndex) => {
      const cellLeft = columnIndex * plan.frameWidth;
      const cellTop = rowIndex * plan.frameHeight;
      const tileLeft = cellLeft + plan.tileX;
      const tileRight = tileLeft + ROCK_TILE_SCALE - 1;
      let escaped = 0;
      for (let y = cellTop; y < cellTop + plan.frameHeight; y++) {
        for (let x = cellLeft; x < cellLeft + plan.frameWidth; x++) {
          if (x >= tileLeft && x <= tileRight) continue;
          if (alphaAt(x, y) >= SOLID_ALPHA_THRESHOLD) escaped++;
        }
      }
      if (escaped > 0) {
        problems.push(
          `${plan.key} ${row.state} frame ${columnIndex} paints ${escaped} solid pixel(s) ` +
            `outside the tile it blocks — the player would be able to stand inside the rock`,
        );
      }
    });
  });
  return problems;
};

const problems = bakePropFamily('rocks', rockSheetPlans(floorArtSubSeed(ROCK_SALT)), {
  extraChecks: [assertBodyFitsBlockedTile],
});
if (problems.length > 0) {
  console.error(`\n[rocks] FAIL — ${problems.length} problems`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
