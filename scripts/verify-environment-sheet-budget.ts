#!/usr/bin/env tsx
/**
 * The painted environment sheets a party needs resident anywhere on a floor
 * fit the sheet cache's byte budget, with room to spare.
 *
 * The budget bounds the working set around the party, not the floor: the
 * idle sweep lets go of what nothing has drawn lately, and the floor's
 * resident sets (`EnvironmentSheetResidentSet`) hold each building's sheets
 * only within their ring of the party and let them go a fifth of a second after they
 * pass its release ring (`RELEASED_GRACE_FRAMES`). So a floor may paint more than the budget in all, as long
 * as no position needs more than it at once. A position needs:
 *
 * - every floor-wide sheet: the ground materials and corner masks, every sheet
 *   the resident sets place over the whole map, and what the floor's
 *   interiors paint, since a visit indoors keeps the floor outside resident;
 * - every building's still frame within the facade release ring of a camera
 *   centred there, on a 1080p view, and its life row within the life ring's,
 *   each widened by that grace's walk.
 *
 * Each floor whose groups paint placed sheets has its map generated to find
 * them, with the same placement function the game registers. The scaled city
 * (`scripts/scaledCity.ts`, a grid of floor-3 towns) is measured too, as the
 * game paints it, every block drawing the same facade sheets, and again with
 * every block's facades its own, which is what a bigger floor brings.
 *
 * Sizes come from the sheet plans' dimensions and the manifest, the same
 * numbers the cache allocates by, so nothing is painted. They are
 * full-density sizes: a device that paints at half density holds a quarter of
 * the bytes against at least a third of the budget, so full density is the
 * case that binds.
 *
 *   npm run verify:environment-sheet-budget
 */

import type { AssetGroup } from '../src/core/spriteAssets/assetGroups.js';
import type { SpriteKey } from '../src/core/spriteAssets/SpriteLoader.js';
import type { LevelDef } from '../src/levels/types.js';
import type { TileRect } from '../src/map/town/townPlan.js';
import type { SheetRing } from '../src/systems/EnvironmentSheetResidentSet.js';
import type { ScaledCity, ScaledCityBuilding } from './scaledCity.js';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';

installCanvasGlobals();

const { ASSET_GROUPS } = await import('../src/core/spriteAssets/assetGroups.js');
const { getManifestEntry, sheetSizePx } = await import('../src/core/spriteAssets/SpriteLoader.js');
const { BYTES_PER_MEGABYTE } = await import('../src/core/rendering/canvasSurface.js');
const { TILE_SIZE } = await import('../src/core/constants.js');
const { setViewportSize } = await import('../src/core/rendering/Viewport.js');
const { requiredSpriteKeysForLevel } =
  await import('../src/core/spriteAssets/systemAssetRequirements.js');
const { allLevelDefs, getLevelDef } = await import('../src/levels/index.js');
const { dungeonOptionsForLevel } = await import('../src/levels/dungeonOptions.js');
const { GameMap } = await import('../src/map/GameMap.js');
const { ENVIRONMENT_SHEET_BUDGET_MEGABYTES, RELEASED_GRACE_FRAMES } =
  await import('../src/map/environmentArtCache.js');
const { GROUND_MASK_SHEET_KEY } = await import('../src/map/ground/groundFrames.js');
const { groundSheetKeysAmong } = await import('../src/map/ground/runtimeGroundSheets.js');
const { plannedEnvironmentSheetSizes } = await import('../src/sprites/sheets/environmentSheets.js');
const { environmentSheetPlacements, FACADE_LIFE_RING, FACADE_RING, isPlacedSheetKey } =
  await import('../src/systems/EnvironmentSheetResidentSet.js');
const { buildingLifeKeyOf } = await import('../src/sprites/buildinggen/runtimeBuildingSheets.js');
const { FASTEST_WALK_TILES_PER_SECOND, tilesUntilInView } =
  await import('../src/systems/WorldResidency.js');
const { buildScaledCity, DEFAULT_BLOCKS_PER_SIDE } = await import('./scaledCity.js');

/**
 * Share of the budget a working set may not use. A sheet requested outside
 * any group (a review route, a room's own ground) lands in the same cache.
 */
const REQUIRED_HEADROOM_SHARE = 0.1;
const BYTES_PER_PIXEL = 4;
const PERCENT = 100;
/** How many of an over-budget working set's sheets the failure names, largest first. */
const LARGEST_SHEETS_NAMED = 5;
const MEGABYTE_PLACES = 1;
/** A 1080p screen: the widest view the game is commonly played at, so the most in view at once. */
const VIEW_WIDTH_PX = 1920;
const VIEW_HEIGHT_PX = 1080;
/** Tiles between the camera positions sampled; finer than any building, so none is stepped over. */
const SAMPLE_STRIDE_TILES = 2;
/** The world seed the measured maps are generated from, so a run measures the same floor. */
const MEASURED_WORLD_SEED = 1;

setViewportSize(VIEW_WIDTH_PX, VIEW_HEIGHT_PX);

const budgetBytes = ENVIRONMENT_SHEET_BUDGET_MEGABYTES * BYTES_PER_MEGABYTE;
const ceilingBytes = budgetBytes * (1 - REQUIRED_HEADROOM_SHARE);
/** Frames per second the idle clock runs at during play. */
const FRAMES_PER_SECOND = 60;
/** How far the fastest walk carries the party past a release ring before the sheet goes. */
const releasedGraceTiles =
  (RELEASED_GRACE_FRAMES / FRAMES_PER_SECOND) * FASTEST_WALK_TILES_PER_SECOND;
const ringReleaseTiles = (ring: SheetRing): number =>
  ring.leadSeconds * FASTEST_WALK_TILES_PER_SECOND +
  ring.releaseHysteresisTiles +
  releasedGraceTiles;
const stillReleaseTiles = ringReleaseTiles(FACADE_RING);
const lifeReleaseTiles = ringReleaseTiles(FACADE_LIFE_RING);
const megabytes = (bytes: number): string => (bytes / BYTES_PER_MEGABYTE).toFixed(MEGABYTE_PLACES);

/** A sheet needed only near where it is placed. Placements sharing an id are one sheet. */
interface PlacedSheet {
  readonly id: string;
  readonly bytes: number;
  readonly area: TileRect;
  /** How far from view it stays resident: its ring's release ring. */
  readonly releaseTiles: number;
}

/** What a floor needs resident everywhere, and what only near where it is placed. */
interface FloorSheets {
  readonly floorWide: ReadonlyMap<string, number>;
  readonly placed: readonly PlacedSheet[];
  readonly bounds: TileRect;
}

interface WorkingSet {
  readonly bytes: number;
  readonly sheets: ReadonlyMap<string, number>;
}

function manifestBytes(key: SpriteKey): number {
  const { widthPx, heightPx } = sheetSizePx(getManifestEntry(key));
  return widthPx * heightPx * BYTES_PER_PIXEL;
}

/** Bytes of every painted sheet the groups plan, by key. */
function plannedBytes(groups: ReadonlyArray<AssetGroup>): Map<string, number> {
  return new Map(
    plannedEnvironmentSheetSizes(groups).map((sheet) => [
      sheet.key,
      sheet.widthPx * sheet.heightPx * BYTES_PER_PIXEL,
    ]),
  );
}

/** The ground sheets, masks and indoor art a floor needs wherever the party is. */
function floorWideBase(def: LevelDef): Map<string, number> {
  const sheets = new Map<string, number>();
  const groundKeys: SpriteKey[] = [
    GROUND_MASK_SHEET_KEY,
    ...groundSheetKeysAmong(requiredSpriteKeysForLevel(def.id, def.spriteGroups)),
    ...groundSheetKeysAmong(def.interiorSpriteGroups.flatMap((group) => ASSET_GROUPS[group])),
  ];
  for (const key of groundKeys) sheets.set(key, manifestBytes(key));
  for (const [key, bytes] of plannedBytes(def.interiorSpriteGroups)) sheets.set(key, bytes);
  return sheets;
}

/**
 * A floor's sheets, split as its resident set places them. A floor that
 * places nothing never has its map built: every sheet it paints is
 * floor-wide.
 */
function floorSheets(def: LevelDef): FloorSheets {
  const floorWide = floorWideBase(def);
  const bytesByKey = plannedBytes(def.spriteGroups);
  if (![...bytesByKey.keys()].some(isPlacedSheetKey)) {
    for (const [key, bytes] of bytesByKey) floorWide.set(key, bytes);
    return { floorWide, placed: [], bounds: { x: 0, y: 0, w: 0, h: 0 } };
  }
  const gameMap = new GameMap({
    mapSize: def.mapSize,
    tileHeight: TILE_SIZE,
    mapType: def.isOverworld ? 'overworld' : 'dungeon',
    dungeon: dungeonOptionsForLevel(def),
    worldSeed: MEASURED_WORLD_SEED,
  });
  const rows = gameMap.structure.length;
  const bounds: TileRect = { x: 0, y: 0, w: gameMap.structure[0]?.length ?? rows, h: rows };
  const placements = environmentSheetPlacements(gameMap.structure, def.spriteGroups);
  const placed: PlacedSheet[] = [];
  for (const placement of placements.still) {
    const bytes = bytesByKey.get(placement.entry) ?? 0;
    const coversFloor =
      placement.area.x <= bounds.x &&
      placement.area.y <= bounds.y &&
      placement.area.w >= bounds.w &&
      placement.area.h >= bounds.h;
    if (coversFloor) floorWide.set(placement.entry, bytes);
    else {
      placed.push({
        id: placement.entry,
        bytes,
        area: placement.area,
        releaseTiles: stillReleaseTiles,
      });
    }
  }
  for (const placement of placements.life) {
    placed.push({
      id: placement.entry,
      bytes: bytesByKey.get(placement.entry) ?? 0,
      area: placement.area,
      releaseTiles: lifeReleaseTiles,
    });
  }
  return { floorWide, placed, bounds };
}

/** The largest set any sampled camera position needs resident. */
function largestWorkingSet(sheets: FloorSheets): WorkingSet {
  let floorWideBytes = 0;
  for (const bytes of sheets.floorWide.values()) floorWideBytes += bytes;
  let largest: WorkingSet = { bytes: floorWideBytes, sheets: sheets.floorWide };
  if (sheets.placed.length === 0) return largest;
  const { bounds } = sheets;
  for (let y = bounds.y; y <= bounds.y + bounds.h; y += SAMPLE_STRIDE_TILES) {
    for (let x = bounds.x; x <= bounds.x + bounds.w; x += SAMPLE_STRIDE_TILES) {
      const focus = { x: x * TILE_SIZE, y: y * TILE_SIZE };
      const near = new Map<string, number>();
      let bytes = floorWideBytes;
      for (const sheet of sheets.placed) {
        if (near.has(sheet.id) || tilesUntilInView(focus, sheet.area) > sheet.releaseTiles) {
          continue;
        }
        near.set(sheet.id, sheet.bytes);
        bytes += sheet.bytes;
      }
      if (bytes > largest.bytes) {
        largest = { bytes, sheets: new Map([...sheets.floorWide, ...near]) };
      }
    }
  }
  return largest;
}

/** The scaled city's sheets: floor 3's floor-wide set, and each building's two sheets. */
function scaledCitySheets(
  city: ScaledCity,
  facadeId: (building: ScaledCityBuilding) => string,
): FloorSheets {
  const floor = getLevelDef('level3');
  const base = floorSheets(floor);
  const bytesByKey = plannedBytes(floor.spriteGroups);
  const placed = city.buildings.flatMap((building): PlacedSheet[] => {
    const lifeKey = buildingLifeKeyOf(building.sheetKey);
    const still: PlacedSheet = {
      id: facadeId(building),
      bytes: bytesByKey.get(building.sheetKey) ?? 0,
      area: building.area,
      releaseTiles: stillReleaseTiles,
    };
    if (lifeKey === undefined) return [still];
    const life: PlacedSheet = {
      id: `${facadeId(building)} life`,
      bytes: bytesByKey.get(lifeKey) ?? 0,
      area: building.area,
      releaseTiles: lifeReleaseTiles,
    };
    return [still, life];
  });
  return { floorWide: base.floorWide, placed, bounds: city.bounds };
}

const failures: string[] = [];
const summaries: string[] = [];

function measure(label: string, sheets: FloorSheets): void {
  const workingSet = largestWorkingSet(sheets);
  summaries.push(`${label} ${megabytes(workingSet.bytes)}`);
  if (workingSet.bytes <= ceilingBytes) return;
  const largest = [...workingSet.sheets]
    .sort(([, a], [, b]) => b - a)
    .slice(0, LARGEST_SHEETS_NAMED)
    .map(([key, bytes]) => `${key} ${megabytes(bytes)}`)
    .join(', ');
  failures.push(
    `${label}: ${workingSet.sheets.size} sheets resident at once, ${megabytes(workingSet.bytes)} MB, ` +
      `over ${megabytes(ceilingBytes)} MB (the ${ENVIRONMENT_SHEET_BUDGET_MEGABYTES} MB sheet ` +
      `budget less ${REQUIRED_HEADROOM_SHARE * PERCENT}% headroom); largest: ${largest}`,
  );
}

for (const def of allLevelDefs()) measure(def.id, floorSheets(def));

const city = buildScaledCity({ blocksPerSide: DEFAULT_BLOCKS_PER_SIDE });
const cityLabel = `scaled city ${DEFAULT_BLOCKS_PER_SIDE}×${DEFAULT_BLOCKS_PER_SIDE}`;
measure(
  cityLabel,
  scaledCitySheets(city, (building) => building.sheetKey),
);
measure(
  `${cityLabel} with every block's facades its own`,
  scaledCitySheets(city, (building) => building.distinctSheetId),
);

if (failures.length > 0) {
  console.error('FAIL verify:environment-sheet-budget');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(
  `PASS verify:environment-sheet-budget — largest working set, MB (ceiling ` +
    `${megabytes(ceilingBytes)}): ${summaries.join(', ')}`,
);
process.exit(0);
