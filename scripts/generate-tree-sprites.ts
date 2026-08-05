#!/usr/bin/env tsx
/**
 * Bakes the Level 3 forest: twelve tree sheets plus one shared remains decal
 * into `src/images/environment/trees/`.
 *
 * Three species × four variants, all painted by `scripts/treeArt.ts` from one
 * palette and one canopy engine. Every tree sheet shares an identical frame
 * envelope — 3 tiles wide, 4 tiles tall, anchored on the middle column's bottom
 * tile — because `SpriteLoader` maps a tile type to exactly one geometry and a
 * variant with its own envelope would overwrite the family's sort anchor and
 * cull extents. Shorter species simply leave transparent pixels; transparent
 * pixels are free, a clipped baked frame is permanent.
 *
 * Run: npm run gen:trees
 *
 * Determinism matters: every variant draws from a fixed literal seed, so
 * re-running leaves `git status` clean and a diff in these PNGs always means the
 * art actually changed.
 */

import type { ImageData } from 'canvas';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { drawTree, drawTreeRemains, type TreeSpecies, type TreeState } from './treeArt.js';
import { writeSheets, type FramePainter, type SheetRow, type SheetSpec } from './townSheets.js';

/** Matches `TILE_SIZE` in `src/core/constants.ts` — a 1:1 blit, never rescaled. */
const TILE_SCALE = 32;

/** 3 tiles: one tile of canopy overhang each side of the anchor column. */
const FRAME_WIDTH = TILE_SCALE * 3;
/** 4 tiles: the anchor tile plus three tiles of trunk and canopy above it. */
const FRAME_HEIGHT = TILE_SCALE * 4;
/** The anchor tile is the middle column. */
const TILE_X = TILE_SCALE;
/** Top edge of the anchor tile — three tiles down from the top of the frame. */
const TILE_Y = TILE_SCALE * 3;

/** `TREE` in `src/map/tileTypes.ts`. Exactly one sheet may declare this tile type. */
const TREE_TILE_TYPE_ID = 13;

/**
 * The remains decal is boxed rather than towering: what is left of a felled tree
 * is a stump and a scatter of ash, which needs a little room around its tile and
 * none above it.
 */
const REMAINS_FRAME_WIDTH = TILE_SCALE * 2;
const REMAINS_FRAME_HEIGHT = TILE_SCALE * 2;
const REMAINS_TILE_X = TILE_SCALE / 2;
const REMAINS_TILE_Y = TILE_SCALE;

const BURN_FRAME_COUNT = 6;
const FELLING_FRAME_COUNT = 6;

const OUT_DIR = resolve('src/images/environment/trees');

interface VariantSpec {
  readonly key: string;
  readonly species: TreeSpecies;
  readonly seed: number;
}

/**
 * Fixed literal seeds, one per variant. Never derive these from an index: a
 * variant inserted in the middle would then re-roll every tree after it and
 * turn a one-tree change into a twelve-sheet diff.
 */
const VARIANTS: readonly VariantSpec[] = [
  { key: 'tree_oak_a', species: 'oak', seed: 0x0a17d3 },
  { key: 'tree_oak_b', species: 'oak', seed: 0x51c92e },
  { key: 'tree_oak_c', species: 'oak', seed: 0x2f7b41 },
  { key: 'tree_oak_d', species: 'oak', seed: 0x9d3c68 },
  { key: 'tree_birch_a', species: 'birch', seed: 0x4e21b7 },
  { key: 'tree_birch_b', species: 'birch', seed: 0xb70f52 },
  { key: 'tree_birch_c', species: 'birch', seed: 0x1c845a },
  { key: 'tree_birch_d', species: 'birch', seed: 0x63ae09 },
  { key: 'tree_pine_a', species: 'pine', seed: 0x7a5e14 },
  { key: 'tree_pine_b', species: 'pine', seed: 0x08d2c6 },
  { key: 'tree_pine_c', species: 'pine', seed: 0xe4193b },
  { key: 'tree_pine_d', species: 'pine', seed: 0x35f7a2 },
];

/** Rows, in sheet order. `frames` is the row's width. */
const STATE_ROWS: ReadonlyArray<{ readonly state: TreeState; readonly frames: number }> = [
  { state: 'idle', frames: 1 },
  { state: 'damaged', frames: 1 },
  { state: 'burning', frames: BURN_FRAME_COUNT },
  { state: 'burning_late', frames: BURN_FRAME_COUNT },
  { state: 'charred', frames: 1 },
  { state: 'felling', frames: FELLING_FRAME_COUNT },
  { state: 'felling_charred', frames: FELLING_FRAME_COUNT },
];

function rowsFor(variant: VariantSpec): SheetRow[] {
  return STATE_ROWS.map(({ state, frames: frameCount }) => {
    const frames: FramePainter[] = [];
    for (let frame = 0; frame < frameCount; frame++) {
      frames.push((ctx, originX, originY) => {
        drawTree(ctx, variant.species, variant.seed, state, frame, frameCount, {
          originX,
          originY,
          // `originY` is the anchor tile's top edge inside the cell, so the
          // cell's own edges are that many pixels either side of it.
          topY: originY - TILE_Y,
          bottomY: originY + (FRAME_HEIGHT - TILE_Y),
          leftX: originX - TILE_X,
          rightX: originX + (FRAME_WIDTH - TILE_X),
          tileScale: TILE_SCALE,
        });
      });
    }
    return { state, frames };
  });
}

function treeSheet(variant: VariantSpec, declaresTileType: boolean): SheetSpec {
  return {
    key: variant.key,
    file: `${variant.key}.png`,
    frameWidth: FRAME_WIDTH,
    frameHeight: FRAME_HEIGHT,
    tileX: TILE_X,
    tileY: TILE_Y,
    ...(declaresTileType ? { tileTypeId: TREE_TILE_TYPE_ID } : {}),
    rows: rowsFor(variant),
  };
}

const REMAINS_SHEET: SheetSpec = {
  key: 'tree_remains',
  file: 'tree_remains.png',
  frameWidth: REMAINS_FRAME_WIDTH,
  frameHeight: REMAINS_FRAME_HEIGHT,
  tileX: REMAINS_TILE_X,
  tileY: REMAINS_TILE_Y,
  rows: [
    {
      state: 'idle',
      frames: [
        (ctx, originX, originY) => {
          drawTreeRemains(
            ctx,
            originX,
            originY,
            TILE_SCALE,
            originY + (REMAINS_FRAME_HEIGHT - REMAINS_TILE_Y),
          );
        },
      ],
    },
  ],
};

function assertEnvelope(): void {
  // Both invariants are load-bearing rather than cosmetic. The first is the
  // sort anchor: `SpriteLoader` reads the visual foot as `frameHeight - tileY`,
  // and a tree whose foot is not exactly one tile deep would Y-sort against
  // players from the wrong line. The second is the sideways overhang, which the
  // cull margin is derived from.
  const footDepth = FRAME_HEIGHT - TILE_Y;
  if (footDepth !== TILE_SCALE) {
    throw new Error(`frameHeight - tileY must equal ${TILE_SCALE}, got ${footDepth}`);
  }
  const rightReach = FRAME_WIDTH - TILE_X;
  if (rightReach !== TILE_SCALE * 2) {
    throw new Error(`frameWidth - tileX must equal ${TILE_SCALE * 2}, got ${rightReach}`);
  }
  const remainsFootDepth = REMAINS_FRAME_HEIGHT - REMAINS_TILE_Y;
  if (remainsFootDepth !== TILE_SCALE) {
    throw new Error(
      `remains frameHeight - tileY must equal ${TILE_SCALE}, got ${remainsFootDepth}`,
    );
  }
}

/**
 * Alpha at or below which a border pixel counts as empty. Not zero: a shape
 * clamped to land exactly on the edge still antialiases a whisper of colour
 * into the last row.
 */
const FRAME_EDGE_ALPHA_TOLERANCE = 24;
const ALPHA_CHANNEL_OFFSET = 3;
const CHANNELS_PER_PIXEL = 4;

/**
 * Rejects a sheet if any frame has ink on its border.
 *
 * `renderSheet` clips every frame to its own cell, so art that reaches past the
 * cell is not merely invisible — it is sheared off along a straight line and
 * baked in. That has already happened three times here (pine flame tips against
 * the top edge, collapse dust against the bottom, the conifer skirt hanging
 * below the ground line), and none of it showed up in a typecheck, a lint or a
 * glance at the sheet.
 *
 * Runs as `writeSheets`' verifier rather than as a pass over the finished files,
 * so a failure stops the bake before anything reaches the disk.
 */
function assertNothingClipped(spec: SheetSpec, pixels: ImageData): void {
  const alphaAt = (x: number, y: number): number =>
    pixels.data[(y * pixels.width + x) * CHANNELS_PER_PIXEL + ALPHA_CHANNEL_OFFSET];

  const columns = Math.max(...spec.rows.map((row) => row.frames.length));
  for (let row = 0; row < spec.rows.length; row++) {
    for (let column = 0; column < columns; column++) {
      const left = column * spec.frameWidth;
      const top = row * spec.frameHeight;
      const right = left + spec.frameWidth - 1;
      const bottom = top + spec.frameHeight - 1;
      const clipped = (edge: string): never => {
        throw new Error(
          `${spec.key} ${spec.rows[row].state} frame ${column} is clipped at its ${edge} edge — ` +
            `the painter drew outside the ${spec.frameWidth}x${spec.frameHeight} cell`,
        );
      };
      for (let x = left; x <= right; x++) {
        if (alphaAt(x, top) > FRAME_EDGE_ALPHA_TOLERANCE) clipped('top');
        if (alphaAt(x, bottom) > FRAME_EDGE_ALPHA_TOLERANCE) clipped('bottom');
      }
      for (let y = top; y <= bottom; y++) {
        if (alphaAt(left, y) > FRAME_EDGE_ALPHA_TOLERANCE) clipped('left');
        if (alphaAt(right, y) > FRAME_EDGE_ALPHA_TOLERANCE) clipped('right');
      }
    }
  }
}

assertEnvelope();
mkdirSync(OUT_DIR, { recursive: true });

// Only the first variant declares the tile type: `_tileSortYAnchorPx` and
// friends are keyed by tile-type id and are last-write-wins, so twelve
// declarations would be eleven redundant overwrites of the same numbers and one
// more place to get out of step.
const sheets: SheetSpec[] = [
  ...VARIANTS.map((variant, index) => treeSheet(variant, index === 0)),
  REMAINS_SHEET,
];

writeSheets(OUT_DIR, TILE_SCALE, sheets, assertNothingClipped);
console.log(`verified ${sheets.length} sheet(s): no frame draws outside its cell`);
