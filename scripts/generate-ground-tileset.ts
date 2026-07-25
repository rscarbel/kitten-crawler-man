#!/usr/bin/env tsx
/**
 * Generates the game's ground tilesets.
 *
 * Outputs to src/images/environment/tilesets/:
 *   ground_overworld.png   town and field materials
 *   ground_dungeon.png     dungeon materials
 *   ground_masks.png       the 16 corner-transition masks, shared by every pair
 * and merges the manifest entries for all three.
 *
 * Run: npx tsx scripts/generate-ground-tileset.ts
 *
 * Materials are generated as multi-tile **patches** sampled from a torus-wrapped
 * lattice, then sliced. See scripts/tilegen/noise.ts for why that makes them
 * seamless, scripts/tilegen/materials.ts for the three rules a painter must
 * follow, and docs/town-redesign.md §7 for the measurements that motivated
 * replacing the previous hand-repaired sheet.
 *
 * Seeds are fixed constants below: sheets are reproducible, and tuning a
 * material means editing materials.ts and re-running, not editing pixels.
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { paintPatch, getMaterial } from './tilegen/materials.js';
import { buildMaskSet, CORNER_MASK_COUNT } from './tilegen/masks.js';
import {
  writeSheet,
  writeMaskSheet,
  updateManifest,
  measureWrapError,
  slicePatch,
  type SheetRow,
  type ManifestEntry,
} from './tilegen/sheet.js';

const IMAGES_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../src/images');
const TILESET_DIR = 'environment/tilesets';
const MANIFEST_PATH = `${IMAGES_ROOT}/${TILESET_DIR}/manifest.json`;
const MASK_FILE = 'ground_masks.png';

const SEED_BASE = 20260725;
const MATERIAL_SEED_STRIDE = 9973;
const VARIANT_SEED_STRIDE = 131;
const MASK_SEED = SEED_BASE + 5501;

/**
 * Largest acceptable ratio of joint difference to the patch's own strongest
 * internal edges. At 1.0 the joint is indistinguishable from the rest of the
 * patch; a little slack absorbs sampling noise without letting a seam through.
 */
const SEAMLESS_RATIO_LIMIT = 1.15;

interface SheetConfig {
  readonly key: string;
  readonly file: string;
  readonly materials: ReadonlyArray<string>;
}

const SHEETS: ReadonlyArray<SheetConfig> = [
  {
    key: 'ground_overworld',
    file: 'ground_overworld.png',
    materials: ['grass', 'verge', 'dirt', 'gravel', 'lane', 'cobble', 'plaza'],
  },
  {
    key: 'ground_dungeon',
    file: 'ground_dungeon.png',
    materials: [
      'dungeon_plain',
      'dungeon_flagstone',
      'dungeon_worn',
      'dungeon_mossy',
      'dungeon_wet',
      'dungeon_rubble',
      'dungeon_wall',
    ],
  },
];

const manifestEntries: Record<string, ManifestEntry> = {};
let worstRatio = 0;
let worstRatioLabel = '';

SHEETS.forEach((config, sheetIndex) => {
  const rows: SheetRow[] = [];
  console.log(`\n${config.file}`);

  config.materials.forEach((materialId, materialIndex) => {
    const material = getMaterial(materialId);
    const structure =
      SEED_BASE + (sheetIndex * 100 + materialIndex) * MATERIAL_SEED_STRIDE;

    const frames = [];
    for (let variant = 0; variant < material.variants; variant++) {
      const patch = paintPatch(material, structure, structure + variant * VARIANT_SEED_STRIDE);
      const report = measureWrapError(patch);
      if (report.ratio > worstRatio) {
        worstRatio = report.ratio;
        worstRatioLabel = `${materialId} variant ${variant}`;
      }
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
      `  ${materialId.padEnd(18)} patch ${material.patchTiles}x${material.patchTiles}  ` +
        `${material.variants} variants  ${frames.length} frames  ` +
        `~${tilesBeforeRepeat.toFixed(1)} tiles before the eye can find a repeat`,
    );
  });

  manifestEntries[config.key] = writeSheet(
    { key: config.key, path: `${TILESET_DIR}/${config.file}`, rows },
    IMAGES_ROOT,
  );
});

const masks = buildMaskSet(MASK_SEED);
writeMaskSheet(masks, `${IMAGES_ROOT}/${TILESET_DIR}/${MASK_FILE}`);
manifestEntries.ground_masks = {
  path: `${TILESET_DIR}/${MASK_FILE}`,
  frameWidth: 64,
  frameHeight: 64,
  tileX: 0,
  tileY: 0,
  tileScale: 64,
  states: { corner: { row: 0, frameCount: CORNER_MASK_COUNT, label: 'Corner transition masks' } },
};
console.log(`\n${MASK_FILE}  ${CORNER_MASK_COUNT} corner masks (shared by every material pair)`);

updateManifest(MANIFEST_PATH, manifestEntries);
console.log(`\nmanifest updated: ${MANIFEST_PATH}`);
console.log(`worst joint-to-interior ratio: ${worstRatio.toFixed(2)} (${worstRatioLabel})`);

if (worstRatio > SEAMLESS_RATIO_LIMIT) {
  console.error(
    `\nFAIL: a patch joint is more than ${SEAMLESS_RATIO_LIMIT}x the patch's own strongest\n` +
      `internal edge, which means a visible seam. Something in a painter is sampling an\n` +
      `unwrapped coordinate — check every Math.floor and % against a warped position, and\n` +
      `make sure geometry uses ctx.structure rather than ctx.detail.`,
  );
  process.exit(1);
}
