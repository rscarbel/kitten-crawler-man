#!/usr/bin/env tsx
/**
 * Generates the game's ground tilesets.
 *
 * Outputs to src/images/environment/tilesets/:
 *   ground_overworld.png   town and field materials
 *   ground_dungeon.png     dungeon materials
 *   ground_masks.png       the corner-transition masks, shared by every pair
 * and merges the manifest entries for all three.
 *
 * Run: npx tsx scripts/generate-ground-tileset.ts
 *
 * Materials are generated as multi-tile **patches** sampled from a torus-wrapped
 * lattice, then sliced. See scripts/tilegen/noise.ts for why that makes them
 * seamless, scripts/tilegen/materials.ts for the three rules a painter must
 * follow, and docs/town.md for how the town consumes the result.
 *
 * Seeds are fixed constants below: sheets are reproducible, and tuning a
 * material means editing materials.ts and re-running, not editing pixels.
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { paintPatch, getMaterial } from './tilegen/materials.js';
import {
  auditMaskSeams,
  buildMaskSet,
  CORNER_MASK_COUNT,
  MASK_PATCH_TILES,
} from './tilegen/masks.js';
import {
  writeSheet,
  writeMaskSheet,
  updateManifest,
  measureWrapError,
  slicePatch,
  type SheetRow,
  type SheetSpec,
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
 * A mask joint must never be a harder line than the masks' own interiors. Written
 * as `!(ratio <= limit)` at the call site so a NaN ratio — an all-flat mask set,
 * which would divide by a zero interior — fails rather than slipping through.
 */
const MASK_SEAM_RATIO_LIMIT = 1;

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
  /**
   * Seed slot of this sheet's first material; the rest run consecutively from
   * it, and the slot is all that decides a material's structure seed.
   *
   * Written down rather than derived from the sheet's position in this array,
   * which is what it used to be. Splitting the dungeon's materials across three
   * sheets moved every Bopca material to a different position and so regenerated
   * the safe room's floor — art that had already been reviewed — for no reason
   * other than that a sheet had been added above it. Slots are wide apart so a
   * sheet can grow without colliding with the next.
   */
  readonly seedSlotBase: number;
}

const SHEETS: ReadonlyArray<SheetConfig> = [
  {
    key: 'ground_overworld',
    file: 'ground_overworld.png',
    materials: ['grass', 'verge', 'dirt', 'gravel', 'lane', 'cobble', 'plaza'],
    seedSlotBase: 0,
  },
  // Shared by both dungeon floors: a Bopca station is the same waystation
  // wherever it is found, so it keeps its own sheet rather than being duplicated
  // into each floor's. Its slots are the ones it held when the sheet also
  // carried seven generic dungeon materials, so the station's floor is byte for
  // byte the art that was reviewed.
  {
    key: 'ground_dungeon',
    file: 'ground_dungeon.png',
    materials: ['bopca_scuff', 'bopca_hearth', 'bopca_tile'],
    seedSlotBase: 107,
  },
  {
    key: 'ground_floor1',
    file: 'ground_floor1.png',
    materials: ['f1_cinder', 'f1_flagstone', 'f1_flags', 'f1_timber', 'f1_wall'],
    seedSlotBase: 200,
  },
  {
    key: 'ground_floor2',
    file: 'ground_floor2.png',
    materials: ['f2_concrete', 'f2_vinyl', 'f2_terrazzo', 'f2_plate', 'f2_wall'],
    seedSlotBase: 300,
  },
  // The town's building interiors — a shop, a house and the tower seen from
  // inside. Their own sheet rather than rows on the overworld's, because they
  // are never drawn in the same frame as a street.
  {
    key: 'ground_interior',
    file: 'ground_interior.png',
    materials: ['interior_boards', 'interior_stone', 'interior_plaster', 'interior_counter'],
    seedSlotBase: 400,
  },
];

const manifestEntries: Record<string, ManifestEntry> = {};
const sheetPlans: SheetSpec[] = [];
let worstRatio = 0;
let worstRatioLabel = '';

for (const config of SHEETS) {
  const rows: SheetRow[] = [];
  console.log(`\n${config.file}`);

  config.materials.forEach((materialId, materialIndex) => {
    const material = getMaterial(materialId);
    const structure = SEED_BASE + (config.seedSlotBase + materialIndex) * MATERIAL_SEED_STRIDE;

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

  sheetPlans.push({ key: config.key, path: `${TILESET_DIR}/${config.file}`, rows });
}

// Nothing is written until every patch has passed. A gate that runs after the
// write leaves a torn sheet and a refreshed manifest on disk describing it.
if (!(worstRatio <= SEAMLESS_RATIO_LIMIT)) {
  console.error(
    `\nFAIL: a patch joint is more than ${SEAMLESS_RATIO_LIMIT}x the patch's own strongest\n` +
      `internal edge, which means a visible seam. Something in a painter is sampling an\n` +
      `unwrapped coordinate — check every Math.floor and % against a warped position, and\n` +
      `make sure geometry uses ctx.structure rather than ctx.detail.`,
  );
  console.error(`worst joint-to-interior ratio: ${worstRatio.toFixed(2)} (${worstRatioLabel})`);
  process.exit(1);
}

for (const plan of sheetPlans) {
  manifestEntries[plan.key] = writeSheet(plan, IMAGES_ROOT);
}

const masks = buildMaskSet(MASK_SEED);
const maskSeams = auditMaskSeams(masks);
if (!(maskSeams.ratio <= MASK_SEAM_RATIO_LIMIT)) {
  throw new Error(
    `corner masks tear: joint-to-interior ratio ${maskSeams.ratio.toFixed(2)} exceeds ${MASK_SEAM_RATIO_LIMIT}`,
  );
}
writeMaskSheet(masks, `${IMAGES_ROOT}/${TILESET_DIR}/${MASK_FILE}`);
manifestEntries.ground_masks = {
  path: `${TILESET_DIR}/${MASK_FILE}`,
  frameWidth: 64,
  frameHeight: 64,
  tileX: 0,
  tileY: 0,
  tileScale: 64,
  states: {
    corner: {
      row: 0,
      frameCount: masks.length,
      patchTiles: MASK_PATCH_TILES,
      label: 'Corner transition masks',
    },
  },
};
console.log(
  `\n${MASK_FILE}  ${CORNER_MASK_COUNT} corner masks x ${MASK_PATCH_TILES}x${MASK_PATCH_TILES} patch phases = ${masks.length} frames` +
    `  joint-to-interior ${maskSeams.ratio.toFixed(2)}`,
);

updateManifest(MANIFEST_PATH, manifestEntries);
console.log(`\nmanifest updated: ${MANIFEST_PATH}`);
console.log(`worst joint-to-interior ratio: ${worstRatio.toFixed(2)} (${worstRatioLabel})`);
