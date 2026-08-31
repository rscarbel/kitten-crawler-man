/**
 * Paints the generated ground tilesets at runtime, from the floor's art seed.
 *
 * These sheets used to ship as PNGs baked by `scripts/generate-ground-tileset.ts`.
 * The painters were always pure `Surface` maths (`src/map/tilegen/`), so the
 * conversion is: run the same painters, blit the same sliced tiles into a canvas
 * in the same order, and publish it under the same manifest key. Every draw site
 * — `groundTiles.ts`, the `?tiles` review route, `TileChunkCache` — is unchanged,
 * because the manifest entry that describes the sheet is unchanged too.
 *
 * What is new is the seed. A material's structure seed now carries a per-floor
 * term, so each generation of a floor gets its own grain and joint layout inside
 * the reviewed envelope. The corner masks stay unseeded: mask geometry is what
 * makes two materials meet without a visible edge, and it is gated as a set
 * rather than per floor.
 */

import {
  getManifestEntry,
  sheetSizePx,
  type SpriteKey,
  type SpriteStateDef,
} from '../../core/SpriteLoader';
import { allocCanvas, surfaceContext } from '../../core/canvasSurface';
import { getMaterial, paintPatch } from '../tilegen/materials';
import { buildMaskSet } from '../tilegen/masks';
import { slicePatch } from '../tilegen/patchSlice';
import { TILE_PX, type Surface } from '../tilegen/raster';
import {
  GROUND_SEED_BASE,
  MASK_SEED_OFFSET,
  groundSheetConfig,
  materialStructureSeed,
  variantDetailSeed,
  type GroundSheetConfig,
} from '../tilegen/sheetConfigs';
import { floorArtSubSeed, GROUND_STRUCTURE_SALT } from './floorArtSeed';
import { GROUND_MASK_SHEET_KEY, GROUND_MASK_STATE } from './groundFrames';
import {
  requestEnvironmentSheet,
  stagingSurfaceOfAtLeast,
  type EnvironmentSheetPlan,
  type PaintStep,
} from '../environmentArtCache';

const RGBA_CHANNELS = 4;
const ALPHA_CHANNEL = 3;
/** Full-scale value of one 8-bit channel. */
const CHANNEL_MAX = 255;

/**
 * Blits a sliced patch into a sheet through a scratch canvas rather than
 * straight with `putImageData`.
 *
 * `putImageData` ignores the context transform, and the sheet context carries
 * the low-end-device downscale as a transform — writing pixels through it would
 * put full-size tiles into a half-size sheet and tear every row.
 */
function blitTiles(
  ctx: CanvasRenderingContext2D,
  tiles: ReadonlyArray<Surface>,
  patchPx: number,
  destColumn: number,
  destRow: number,
): void {
  const scratch = stagingSurfaceOfAtLeast(patchPx, patchPx);
  const scratchCtx = surfaceContext(scratch);
  const image = scratchCtx.createImageData(patchPx, patchPx);
  const tilesAcross = patchPx / TILE_PX;
  for (let index = 0; index < tiles.length; index++) {
    const rgba = tiles[index].toRgba();
    const originX = (index % tilesAcross) * TILE_PX;
    const originY = Math.floor(index / tilesAcross) * TILE_PX;
    for (let y = 0; y < TILE_PX; y++) {
      const sourceRow = y * TILE_PX * RGBA_CHANNELS;
      const destRowStart = ((originY + y) * patchPx + originX) * RGBA_CHANNELS;
      image.data.set(rgba.subarray(sourceRow, sourceRow + TILE_PX * RGBA_CHANNELS), destRowStart);
    }
  }
  scratchCtx.putImageData(image, 0, 0);
  for (let index = 0; index < tiles.length; index++) {
    const sourceX = (index % tilesAcross) * TILE_PX;
    const sourceY = Math.floor(index / tilesAcross) * TILE_PX;
    ctx.drawImage(
      scratch,
      sourceX,
      sourceY,
      TILE_PX,
      TILE_PX,
      (destColumn + index) * TILE_PX,
      destRow * TILE_PX,
      TILE_PX,
      TILE_PX,
    );
  }
}

function stateFor(key: SpriteKey, name: string): SpriteStateDef {
  const states: Readonly<Record<string, SpriteStateDef | undefined>> = getManifestEntry(key).states;
  const state = states[name];
  if (state === undefined) {
    throw new Error(`Sheet "${key}" declares no row for "${name}"`);
  }
  return state;
}

function materialSteps(sheet: GroundSheetConfig, structureTerm: number): PaintStep[] {
  const key: SpriteKey = asSheetKey(sheet.key);
  const steps: PaintStep[] = [];
  sheet.materials.forEach((materialId, materialIndex) => {
    const material = getMaterial(materialId);
    const row = stateFor(key, materialId);
    const patchFrames = material.patchTiles * material.patchTiles;
    if (row.frameCount !== patchFrames * material.variants) {
      throw new Error(
        `Material "${materialId}" paints ${patchFrames * material.variants} frames, ` +
          `but sheet "${sheet.key}" declares ${row.frameCount}`,
      );
    }
    const structure = materialStructureSeed(sheet, materialIndex, structureTerm);
    for (let variant = 0; variant < material.variants; variant++) {
      const detail = variantDetailSeed(structure, variant);
      steps.push({
        // One class per material: its variants are the same painter over the
        // same patch size, so the first one measured predicts the rest.
        costClass: `ground:${materialId}`,
        paint: (ctx) => {
          const patch = paintPatch(material, structure, detail);
          blitTiles(
            ctx,
            slicePatch(patch),
            material.patchTiles * TILE_PX,
            variant * patchFrames,
            row.row,
          );
        },
      });
    }
  });
  return steps;
}

/**
 * Narrows a sheet config's key to a manifest key.
 *
 * `GROUND_SHEETS` is shared with the offline baker, which has no `SpriteKey` to
 * speak of, so its keys are plain strings. The check turns that back into the
 * manifest key the rest of this module needs, and fails loudly rather than
 * painting a sheet nothing will ever look up.
 */
function asSheetKey(key: string): SpriteKey {
  const entry = GROUND_SHEET_KEYS.find((candidate) => candidate === key);
  if (entry === undefined) throw new Error(`"${key}" names no generated ground sheet`);
  return entry;
}

/**
 * Every generated ground sheet, written out so the compiler checks each one
 * against the manifest rather than trusting a string from the shared table.
 */
export const GROUND_SHEET_KEYS = [
  'ground_overworld',
  'ground_dungeon',
  'ground_floor1',
  'ground_floor2',
  'ground_interior',
] as const satisfies ReadonlyArray<SpriteKey>;

function maskSheetPlan(onReady?: () => void): EnvironmentSheetPlan {
  const key: SpriteKey = GROUND_MASK_SHEET_KEY;
  const row = stateFor(key, GROUND_MASK_STATE);
  return {
    key,
    ...sheetSizePx(getManifestEntry(key)),
    onReady,
    variesWithFloorSeed: false,
    steps: [
      {
        costClass: 'ground:masks',
        paint: (ctx) => {
          // Unseeded, deliberately: the mask set is the geometry that makes any
          // two materials meet without an edge, and it is proved safe as a set.
          // Varying it per floor would put that proof out of reach.
          const masks = buildMaskSet(GROUND_SEED_BASE + MASK_SEED_OFFSET);
          if (masks.length !== row.frameCount) {
            throw new Error(
              `Corner masks paint ${masks.length} frames, but "${key}" declares ${row.frameCount}`,
            );
          }
          const scratch = allocCanvas(TILE_PX, TILE_PX);
          const scratchCtx = surfaceContext(scratch);
          masks.forEach((mask, index) => {
            const image = scratchCtx.createImageData(TILE_PX, TILE_PX);
            for (let p = 0; p < TILE_PX * TILE_PX; p++) {
              image.data[p * RGBA_CHANNELS] = CHANNEL_MAX;
              image.data[p * RGBA_CHANNELS + 1] = CHANNEL_MAX;
              image.data[p * RGBA_CHANNELS + 2] = CHANNEL_MAX;
              image.data[p * RGBA_CHANNELS + ALPHA_CHANNEL] = Math.round(mask[p] * CHANNEL_MAX);
            }
            scratchCtx.putImageData(image, 0, 0);
            ctx.drawImage(scratch, index * TILE_PX, row.row * TILE_PX);
          });
          scratch.width = 0;
          scratch.height = 0;
        },
      },
    ],
  };
}

/**
 * Queues the sheets a floor needs, if they are not already painted.
 *
 * The corner masks come first and are always included: every material pair is
 * composited through them, so a floor whose materials arrive before its masks
 * would bake chunks with no fringe at all.
 */
export function requestGroundSheets(
  keys: ReadonlyArray<SpriteKey>,
  onSheetPainted?: () => void,
): void {
  requestEnvironmentSheet(maskSheetPlan(onSheetPainted));
  const structureTerm = floorArtSubSeed(GROUND_STRUCTURE_SALT);
  for (const key of keys) {
    const sheet = groundSheetConfig(key);
    if (sheet === undefined) continue;
    requestEnvironmentSheet({
      key,
      ...sheetSizePx(getManifestEntry(key)),
      steps: materialSteps(sheet, structureTerm),
      variesWithFloorSeed: true,
      onReady: onSheetPainted,
    });
  }
}

/** The generated ground sheets among an arbitrary set of sprite keys. */
export function groundSheetKeysAmong(keys: Iterable<SpriteKey>): SpriteKey[] {
  const found: SpriteKey[] = [];
  for (const key of keys) {
    if (groundSheetConfig(key) !== undefined) found.push(key);
  }
  return found;
}
