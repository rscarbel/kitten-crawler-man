#!/usr/bin/env tsx
/**
 * Bakes the Level 3 goblin camp into `src/images/environment/camp/`.
 *
 * Four seeded hide tents and one campfire. The tents share a frame envelope, for
 * the reason every family here does: `SpriteLoader` maps a tile type to exactly
 * one geometry, and a variant with its own envelope would overwrite the family's
 * sort anchor and cull extents.
 *
 * The campfire's `idle` row is an animation, not a single frame. `drawTile` picks
 * a frame from the shared `frameTime` the way a torch does, and `CAMPFIRE` is
 * deliberately kept out of `CACHEABLE_OVERLAY_TYPES` so it redraws each frame.
 *
 * Run: npm run gen:camps
 *
 * Determinism matters: every variant draws from a fixed literal seed, so
 * re-running leaves `git status` clean and a diff in these PNGs always means the
 * art actually changed.
 */

import type { ImageData } from 'canvas';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { drawCampfire, drawGoblinTent } from './campArt.js';
import { writeSheets, type FramePainter, type SheetRow, type SheetSpec } from './townSheets.js';

/** Matches `TILE_SIZE` in `src/core/constants.ts` — a 1:1 blit, never rescaled. */
const TILE_SCALE = 32;

/** `GOBLIN_TENT` and `CAMPFIRE` in `src/map/tileTypes.ts`. */
const GOBLIN_TENT_TILE_TYPE_ID = 91;
const CAMPFIRE_TILE_TYPE_ID = 90;

/**
 * Both envelopes put the anchor tile's bottom edge exactly one tile above the
 * frame's bottom: `SpriteLoader` reads the visual foot as `frameHeight - tileY`,
 * and a prop whose foot is not one tile deep Y-sorts from the wrong line.
 */
const TENT_FRAME_WIDTH = TILE_SCALE * 3;
const TENT_FRAME_HEIGHT = TILE_SCALE * 3;
const TENT_TILE_X = TILE_SCALE;
const TENT_TILE_Y = TILE_SCALE * 2;

const FIRE_FRAME_WIDTH = TILE_SCALE * 3;
const FIRE_FRAME_HEIGHT = TILE_SCALE * 3;
const FIRE_TILE_X = TILE_SCALE;
const FIRE_TILE_Y = TILE_SCALE * 2;

/** Frames in the campfire's flame loop. */
const FIRE_FRAME_COUNT = 6;

const OUT_DIR = resolve('src/images/environment/camp');

interface TentVariant {
  readonly key: string;
  readonly seed: number;
}

/**
 * Fixed literal seeds. Never derive these from an index: a variant inserted in
 * the middle would re-roll every tent after it and turn a one-tent change into a
 * four-sheet diff.
 */
const TENT_VARIANTS: readonly TentVariant[] = [
  { key: 'goblin_tent_a', seed: 0x51e07c },
  { key: 'goblin_tent_b', seed: 0xc3a419 },
  { key: 'goblin_tent_c', seed: 0x2b96f5 },
  { key: 'goblin_tent_d', seed: 0x8f10a3 },
];

const CAMPFIRE_SEED = 0x7c2d94;

function tentRows(variant: TentVariant): SheetRow[] {
  const paint: FramePainter = (ctx, originX, originY) => {
    drawGoblinTent(ctx, variant.seed, {
      originX,
      originY,
      bottomY: originY + (TENT_FRAME_HEIGHT - TENT_TILE_Y),
      tileScale: TILE_SCALE,
    });
  };
  return [{ state: 'idle', frames: [paint] }];
}

function tentSheet(variant: TentVariant, declaresTileType: boolean): SheetSpec {
  return {
    key: variant.key,
    file: `${variant.key}.png`,
    frameWidth: TENT_FRAME_WIDTH,
    frameHeight: TENT_FRAME_HEIGHT,
    tileX: TENT_TILE_X,
    tileY: TENT_TILE_Y,
    ...(declaresTileType ? { tileTypeId: GOBLIN_TENT_TILE_TYPE_ID } : {}),
    rows: tentRows(variant),
  };
}

const CAMPFIRE_SHEET: SheetSpec = {
  key: 'campfire',
  file: 'campfire.png',
  frameWidth: FIRE_FRAME_WIDTH,
  frameHeight: FIRE_FRAME_HEIGHT,
  tileX: FIRE_TILE_X,
  tileY: FIRE_TILE_Y,
  tileTypeId: CAMPFIRE_TILE_TYPE_ID,
  rows: [
    {
      state: 'idle',
      frames: Array.from(
        { length: FIRE_FRAME_COUNT },
        (_, frame): FramePainter =>
          (ctx, originX, originY) => {
            drawCampfire(ctx, CAMPFIRE_SEED, frame, FIRE_FRAME_COUNT, {
              originX,
              originY,
              bottomY: originY + (FIRE_FRAME_HEIGHT - FIRE_TILE_Y),
              tileScale: TILE_SCALE,
            });
          },
      ),
    },
  ],
};

function assertEnvelopes(): void {
  // The sort anchor: `SpriteLoader` reads the visual foot as
  // `frameHeight - tileY`, so a family whose foot is not exactly one tile deep
  // Y-sorts against the player from the wrong line.
  const checks: ReadonlyArray<readonly [string, number, number]> = [
    ['tent', TENT_FRAME_HEIGHT, TENT_TILE_Y],
    ['campfire', FIRE_FRAME_HEIGHT, FIRE_TILE_Y],
  ];
  for (const [name, frameHeight, tileY] of checks) {
    const footDepth = frameHeight - tileY;
    if (footDepth !== TILE_SCALE) {
      throw new Error(`${name} frameHeight - tileY must equal ${TILE_SCALE}, got ${footDepth}`);
    }
  }
}

/**
 * Alpha at or below which a border pixel counts as empty. Not zero: a shape
 * clamped to land exactly on the edge still antialiases a whisper of colour into
 * the last row.
 */
const FRAME_EDGE_ALPHA_TOLERANCE = 24;
const ALPHA_CHANNEL_OFFSET = 3;
const CHANNELS_PER_PIXEL = 4;

/**
 * Rejects a sheet if any frame has ink on its border.
 *
 * `renderSheet` clips every frame to its own cell, so art that reaches past the
 * cell is not merely invisible — it is sheared off along a straight line and
 * baked in permanently, and none of that shows up in a typecheck, a lint or a
 * glance at the sheet. The tree bake was caught by this three separate times,
 * twice by a flame tip against the top edge — which is exactly what the
 * campfire's tallest frame is.
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

assertEnvelopes();
mkdirSync(OUT_DIR, { recursive: true });

// Only the first tent declares the tile type: `SpriteLoader`'s sort anchor and
// cull extents are keyed by tile-type id and are last-write-wins, so four
// declarations would be three redundant overwrites of the same numbers.
const sheets: SheetSpec[] = [
  ...TENT_VARIANTS.map((variant, index) => tentSheet(variant, index === 0)),
  CAMPFIRE_SHEET,
];

writeSheets(OUT_DIR, TILE_SCALE, sheets, assertNothingClipped);
console.log(`verified ${sheets.length} sheet(s): no frame draws outside its cell`);
