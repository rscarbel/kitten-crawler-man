#!/usr/bin/env tsx
/**
 * Bakes preview PNGs of the game's ground tilesets.
 *
 * The shipped game paints these sheets at runtime
 * (`src/map/ground/runtimeGroundSheets.ts`) from the same painters and the same
 * table of sheet configs, so this script is a review harness: it writes
 * `preview/tilesets/*.png` for the eye and re-runs the seam gate for the machine.
 *
 * Run: npx tsx scripts/generate-ground-tileset.ts [artSeed]
 *
 * Materials are generated as multi-tile **patches** sampled from a torus-wrapped
 * lattice, then sliced. See `src/map/tilegen/noise.ts` for why that makes them
 * seamless, `src/map/tilegen/materials.ts` for the three rules a painter must
 * follow, and docs/town.md for how the town consumes the result.
 */

import { mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { paintPatch, getMaterial } from '../src/map/tilegen/materials.js';
import {
  auditMaskSeams,
  buildMaskSet,
  CORNER_MASK_COUNT,
  MASK_PATCH_TILES,
} from '../src/map/tilegen/masks.js';
import { slicePatch, measureWrapError, patchTears } from '../src/map/tilegen/patchSlice.js';
import {
  GROUND_SHEETS,
  GROUND_SEED_BASE,
  MASK_SEED_OFFSET,
  materialStructureSeed,
  variantDetailSeed,
} from '../src/map/tilegen/sheetConfigs.js';
import { GROUND_STRUCTURE_SALT } from '../src/map/ground/floorArtSeed.js';
import { subSeed } from '../src/sprites/person/rng.js';
import { MASK_SEAM_RATIO_LIMIT } from '../src/map/tilegen/seamLimits.js';
import { writeSheet, writeMaskSheet, type SheetRow, type SheetSpec } from './tilegen/sheet.js';

const PREVIEW_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../preview/tilesets');
const MASK_FILE = 'ground_masks.png';
/** Width the material name is padded to so the report's columns line up. */
const MATERIAL_NAME_COLUMN = 18;

const SEED_ARGUMENT_INDEX = 2;
const SEED_RADIX = 10;
const seedArgument =
  process.argv.length > SEED_ARGUMENT_INDEX ? process.argv[SEED_ARGUMENT_INDEX] : '0';
const artSeed = Number.parseInt(seedArgument, SEED_RADIX);
if (!Number.isFinite(artSeed)) {
  throw new Error(`art seed must be a number, got "${seedArgument}"`);
}
const structureTerm = artSeed === 0 ? 0 : subSeed(artSeed, GROUND_STRUCTURE_SALT);

mkdirSync(PREVIEW_ROOT, { recursive: true });

const sheetPlans: SheetSpec[] = [];
let worstRatio = 0;
let worstRatioLabel = '';
const tears: string[] = [];

for (const config of GROUND_SHEETS) {
  const rows: SheetRow[] = [];
  console.log(`\n${config.file}`);

  config.materials.forEach((materialId, materialIndex) => {
    const material = getMaterial(materialId);
    const structure = materialStructureSeed(config, materialIndex, structureTerm);

    const frames = [];
    for (let variant = 0; variant < material.variants; variant++) {
      const patch = paintPatch(material, structure, variantDetailSeed(structure, variant));
      const report = measureWrapError(patch);
      if (report.ratio > worstRatio) {
        worstRatio = report.ratio;
        worstRatioLabel = `${materialId} variant ${variant}`;
      }
      if (patchTears(report)) tears.push(`${materialId} variant ${variant}`);
      frames.push(...slicePatch(patch));
    }

    rows.push({
      state: materialId,
      frames,
      patchTiles: material.patchTiles,
      label: material.label,
    });

    const tilesBeforeRepeat = material.patchTiles * Math.sqrt(material.variants);
    console.log(
      `  ${materialId.padEnd(MATERIAL_NAME_COLUMN)} patch ${material.patchTiles}x${material.patchTiles}  ` +
        `${material.variants} variants  ${frames.length} frames  ` +
        `~${tilesBeforeRepeat.toFixed(1)} tiles before the eye can find a repeat`,
    );
  });

  sheetPlans.push({ key: config.key, path: config.file, rows });
}

// Nothing is written until every patch has passed. A gate that runs after the
// write leaves a torn sheet on disk for review.
if (tears.length > 0) {
  console.error(
    `\nFAIL: a patch joint is the hardest line in its own patch, which means a visible\n` +
      `seam. Something in a painter is sampling an unwrapped coordinate — check every\n` +
      `Math.floor and % against a warped position, and make sure geometry uses\n` +
      `ctx.structure rather than ctx.detail.`,
  );
  for (const tear of tears) console.error(`  ${tear}`);
  console.error(`worst joint-to-interior ratio: ${worstRatio.toFixed(2)} (${worstRatioLabel})`);
  process.exit(1);
}

for (const plan of sheetPlans) {
  writeSheet(plan, PREVIEW_ROOT);
}

const masks = buildMaskSet(GROUND_SEED_BASE + MASK_SEED_OFFSET);
const maskSeams = auditMaskSeams(masks);
if (!(maskSeams.ratio <= MASK_SEAM_RATIO_LIMIT)) {
  throw new Error(
    `corner masks tear: joint-to-interior ratio ${maskSeams.ratio.toFixed(2)} exceeds ${MASK_SEAM_RATIO_LIMIT}`,
  );
}
writeMaskSheet(masks, `${PREVIEW_ROOT}/${MASK_FILE}`);
console.log(
  `\n${MASK_FILE}  ${CORNER_MASK_COUNT} corner masks x ${MASK_PATCH_TILES}x${MASK_PATCH_TILES} patch phases = ${masks.length} frames` +
    `  joint-to-interior ${maskSeams.ratio.toFixed(2)}`,
);

console.log(`\npreview sheets written to ${PREVIEW_ROOT} (art seed ${artSeed})`);
console.log(`worst joint-to-interior ratio: ${worstRatio.toFixed(2)} (${worstRatioLabel})`);
