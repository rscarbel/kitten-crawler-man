#!/usr/bin/env tsx
/**
 * Every floor's painted environment sheets fit the sheet cache's byte budget,
 * with room to spare.
 *
 * The cache lets the least recently drawn sheets go once it holds more than
 * `ENVIRONMENT_SHEET_BUDGET_MEGABYTES`. That is a ceiling against growth, not a
 * trim: a floor whose own set is larger than the budget evicts its own art and
 * repaints it as the player walks back to it — a building or a stretch of
 * ground missing for the frames the repaint takes. This holds the line for the
 * day a town grows.
 *
 * A floor's set is its arrival (`LevelDef.spriteGroups`, plus the ground sheets
 * and corner masks) together with its indoor-only groups
 * (`LevelDef.interiorSpriteGroups`), since a visit indoors leaves those
 * resident on the way back out. Sizes come from the sheet plans' dimensions and
 * the manifest, the same numbers the cache allocates by, so nothing is painted.
 * They are full-density sizes: a device that paints at half density holds a
 * quarter of the bytes against at least a third of the budget, so full density
 * is the case that binds.
 *
 *   npm run verify:environment-sheet-budget
 */

import type { SpriteKey } from '../src/core/SpriteLoader.js';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';

installCanvasGlobals();

const { ASSET_GROUPS } = await import('../src/core/assetGroups.js');
const { getManifestEntry, sheetSizePx } = await import('../src/core/SpriteLoader.js');
const { BYTES_PER_MEGABYTE } = await import('../src/core/canvasSurface.js');
const { requiredSpriteKeysForLevel } = await import('../src/core/systemAssetRequirements.js');
const { allLevelDefs } = await import('../src/levels/index.js');
const { ENVIRONMENT_SHEET_BUDGET_MEGABYTES } = await import('../src/map/environmentArtCache.js');
const { GROUND_MASK_SHEET_KEY } = await import('../src/map/ground/groundFrames.js');
const { groundSheetKeysAmong } = await import('../src/map/ground/runtimeGroundSheets.js');
const { plannedEnvironmentSheetSizes } = await import('../src/sprites/sheets/environmentSheets.js');

/**
 * Share of the budget a floor's set may not use. Above the busiest floor today
 * with room to keep: a sheet requested outside any group (a review route, a
 * room's own ground) lands in the same cache.
 */
const REQUIRED_HEADROOM_SHARE = 0.1;
const BYTES_PER_PIXEL = 4;
const PERCENT = 100;
/** How many of an over-budget floor's sheets the failure names, largest first. */
const LARGEST_SHEETS_NAMED = 5;
const MEGABYTE_PLACES = 1;

const budgetBytes = ENVIRONMENT_SHEET_BUDGET_MEGABYTES * BYTES_PER_MEGABYTE;
const ceilingBytes = budgetBytes * (1 - REQUIRED_HEADROOM_SHARE);
const megabytes = (bytes: number): string => (bytes / BYTES_PER_MEGABYTE).toFixed(MEGABYTE_PLACES);

const failures: string[] = [];
const summaries: string[] = [];

for (const def of allLevelDefs()) {
  const groups = [...def.spriteGroups, ...def.interiorSpriteGroups];
  const sheetBytes = new Map<string, number>();
  const groundKeys: SpriteKey[] = [
    GROUND_MASK_SHEET_KEY,
    ...groundSheetKeysAmong(requiredSpriteKeysForLevel(def.id, def.spriteGroups)),
    ...groundSheetKeysAmong(def.interiorSpriteGroups.flatMap((group) => ASSET_GROUPS[group])),
  ];
  for (const key of groundKeys) {
    const { widthPx, heightPx } = sheetSizePx(getManifestEntry(key));
    sheetBytes.set(key, widthPx * heightPx * BYTES_PER_PIXEL);
  }
  for (const sheet of plannedEnvironmentSheetSizes(groups)) {
    sheetBytes.set(sheet.key, sheet.widthPx * sheet.heightPx * BYTES_PER_PIXEL);
  }
  let total = 0;
  for (const bytes of sheetBytes.values()) total += bytes;
  summaries.push(`${def.id} ${megabytes(total)}`);
  if (total > ceilingBytes) {
    const largest = [...sheetBytes]
      .sort(([, a], [, b]) => b - a)
      .slice(0, LARGEST_SHEETS_NAMED)
      .map(([key, bytes]) => `${key} ${megabytes(bytes)}`)
      .join(', ');
    failures.push(
      `${def.id}: ${sheetBytes.size} sheets, ${megabytes(total)} MB, over ${megabytes(ceilingBytes)} MB ` +
        `(the ${ENVIRONMENT_SHEET_BUDGET_MEGABYTES} MB sheet budget less ` +
        `${REQUIRED_HEADROOM_SHARE * PERCENT}% headroom); largest: ${largest}`,
    );
  }
}

if (failures.length > 0) {
  console.error('FAIL verify:environment-sheet-budget');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(
  `PASS verify:environment-sheet-budget — MB per floor (ceiling ${megabytes(ceilingBytes)}): ` +
    summaries.join(', '),
);
