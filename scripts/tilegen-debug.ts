#!/usr/bin/env tsx
/**
 * Scratch harness for eyeballing generated tiles outside the game.
 *
 *   npx tsx scripts/tilegen-debug.ts materials   -> /tmp/tilegen_materials.png
 *   npx tsx scripts/tilegen-debug.ts transitions -> /tmp/tilegen_transitions.png
 *   npx tsx scripts/tilegen-debug.ts blob        -> /tmp/tilegen_blob.png
 *
 * The in-game `?tiles` route is the reviewable version; this exists so a seam can
 * be checked without a browser.
 *
 * It judges the mask *art*, not the renderer's use of it: the blob view classifies
 * corners on the tile grid, one whole-tile mask per tile, where the game
 * classifies on the dual grid and composites four quarters. Boundaries here sit
 * half a tile off where the game puts them. Use `?tiles` to judge placement.
 */
import { createCanvas, type CanvasRenderingContext2D as NodeCtx } from 'canvas';
import { writeFileSync } from 'fs';
import { Surface, TILE_PX } from './tilegen/raster.js';
import { MATERIALS, getMaterial, paintPatch } from './tilegen/materials.js';
import { slicePatch } from './tilegen/sheet.js';
import {
  buildCornerMask,
  CORNER_MASK_COUNT,
  CORNER_ALL,
  MASK_PATCH_TILES,
} from './tilegen/masks.js';

const REPEAT = 4;
const LABEL_HEIGHT = 18;
const SEED = 424242;

function drawSurface(ctx: NodeCtx, surface: Surface, x: number, y: number): void {
  const image = ctx.createImageData(TILE_PX, TILE_PX);
  image.data.set(surface.toRgba());
  ctx.putImageData(image, x, y);
}

interface TileSet {
  readonly tiles: ReadonlyArray<Surface>;
  readonly patchTiles: number;
  readonly variants: number;
}

/** All frames of a material, in the same order the sheet stores them. */
function paintTiles(materialId: string): TileSet {
  const material = getMaterial(materialId);
  const tiles: Surface[] = [];
  for (let variant = 0; variant < material.variants; variant++) {
    tiles.push(...slicePatch(paintPatch(material, SEED, SEED + variant * 131)));
  }
  return { tiles, patchTiles: material.patchTiles, variants: material.variants };
}

/** The frame a map tile uses: variant chosen by hash, phase fixed by position. */
function frameFor(set: TileSet, tx: number, ty: number): Surface {
  const n = set.patchTiles;
  const variant =
    ((Math.imul(Math.floor(tx / n), 73856093) ^ Math.imul(Math.floor(ty / n), 19349663)) >>> 0) %
    set.variants;
  const phase = (((ty % n) + n) % n) * n + (((tx % n) + n) % n);
  return set.tiles[variant * n * n + phase];
}

/** Every material, each tiled REPEAT x REPEAT with variants shuffled per cell. */
function renderMaterials(): void {
  const cell = TILE_PX * REPEAT;
  const columns = 4;
  const rows = Math.ceil(MATERIALS.length / columns);
  const canvas = createCanvas(columns * cell, rows * (cell + LABEL_HEIGHT));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#12161f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  MATERIALS.forEach((material, index) => {
    const set = paintTiles(material.id);
    const originX = (index % columns) * cell;
    const originY = Math.floor(index / columns) * (cell + LABEL_HEIGHT) + LABEL_HEIGHT;
    for (let ty = 0; ty < REPEAT; ty++) {
      for (let tx = 0; tx < REPEAT; tx++) {
        drawSurface(ctx, frameFor(set, tx, ty), originX + tx * TILE_PX, originY + ty * TILE_PX);
      }
    }
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '13px sans-serif';
    ctx.fillText(material.label, originX + 4, originY - 5);
  });

  writeFileSync('/tmp/tilegen_materials.png', canvas.toBuffer('image/png'));
  console.log('wrote /tmp/tilegen_materials.png');
}

/** All 16 corner combinations of one transition, laid out 4x4. */
function renderTransitions(): void {
  const pairs = [
    ['grass', 'lane'],
    ['grass', 'dirt'],
    ['lane', 'cobble'],
    ['dungeon_plain', 'dungeon_mossy'],
  ] as const;
  const grid = 4;
  const block = TILE_PX * grid;
  const canvas = createCanvas(pairs.length * (block + 8), block + LABEL_HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#12161f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  pairs.forEach(([baseId, overId], pairIndex) => {
    const base = paintTiles(baseId).tiles[0];
    const over = paintTiles(overId).tiles[0];
    const originX = pairIndex * (block + 8);
    for (let bits = 0; bits < CORNER_MASK_COUNT; bits++) {
      const composed = base.clone();
      if (bits === CORNER_ALL) composed.fill((x, y) => over.get(x, y));
      else if (bits !== 0) composed.compositeMasked(over, buildCornerMask(bits, SEED));
      drawSurface(
        ctx,
        composed,
        originX + (bits % grid) * TILE_PX,
        LABEL_HEIGHT + Math.floor(bits / grid) * TILE_PX,
      );
    }
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '13px sans-serif';
    ctx.fillText(`${baseId} -> ${overId}`, originX + 4, 13);
  });

  writeFileSync('/tmp/tilegen_transitions.png', canvas.toBuffer('image/png'));
  console.log('wrote /tmp/tilegen_transitions.png');
}

/**
 * The real test of the corner scheme: an irregular blob of one material painted
 * across a grid of another, with each tile picking its frame purely from which of
 * its four corners are inside the blob. If the scheme works the boundary reads as
 * one continuous curved edge, not as 16 separate tiles.
 */
function renderBlob(): void {
  const GRID = 14;
  const base = paintTiles('grass');
  const over = paintTiles('lane');

  // Corner lattice is (GRID+1) x (GRID+1); a corner is "inside" the shape when a
  // couple of overlapping ellipses cover it.
  const inside = (cx: number, cy: number): boolean => {
    const a = ((cx - 4.4) / 3.4) ** 2 + ((cy - 4.8) / 2.8) ** 2 < 1;
    const b = ((cx - 8.6) / 3.6) ** 2 + ((cy - 7.2) / 4.0) ** 2 < 1;
    const c = ((cx - 6.6) / 2.0) ** 2 + ((cy - 11.4) / 1.8) ** 2 < 1;
    return a || b || c;
  };

  const canvas = createCanvas(GRID * TILE_PX, GRID * TILE_PX);
  const ctx = canvas.getContext('2d');
  for (let ty = 0; ty < GRID; ty++) {
    for (let tx = 0; tx < GRID; tx++) {
      const nw = inside(tx, ty) ? 1 : 0;
      const ne = inside(tx + 1, ty) ? 2 : 0;
      const se = inside(tx + 1, ty + 1) ? 4 : 0;
      const sw = inside(tx, ty + 1) ? 8 : 0;
      const bits = nw | ne | se | sw;
      const composed = frameFor(base, tx, ty).clone();
      if (bits === CORNER_ALL) {
        const top = frameFor(over, tx, ty);
        composed.fill((x, y) => top.get(x, y));
      } else if (bits !== 0) {
        // One warp seed for every combination, and the patch phase from the tile's
        // position — the two things the shipped masks depend on. Seeding per
        // combination, as this tool used to, tears the boundary wherever two
        // neighbours hold different combinations.
        composed.compositeMasked(
          frameFor(over, tx, ty),
          buildCornerMask(
            bits,
            SEED,
            ((tx % MASK_PATCH_TILES) + MASK_PATCH_TILES) % MASK_PATCH_TILES,
            ((ty % MASK_PATCH_TILES) + MASK_PATCH_TILES) % MASK_PATCH_TILES,
          ),
        );
      }
      drawSurface(ctx, composed, tx * TILE_PX, ty * TILE_PX);
    }
  }
  writeFileSync('/tmp/tilegen_blob.png', canvas.toBuffer('image/png'));
  console.log('wrote /tmp/tilegen_blob.png');
}

const mode = process.argv[2] ?? 'materials';
if (mode === 'materials') renderMaterials();
else if (mode === 'transitions') renderTransitions();
else if (mode === 'blob') renderBlob();
else throw new Error(`Unknown mode '${mode}'`);
