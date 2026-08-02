#!/usr/bin/env tsx
/**
 * Bakes the Level 3 wilderness's boulders into `src/images/environment/rocks/`.
 *
 * Two families of eight seeded variants: `boulder_small_*` (a stone that stays
 * under a tile in every direction) and `boulder_large_*` (a broad mass about a
 * tile across and a tile tall). Each family shares one frame envelope,
 * because `SpriteLoader` maps a tile type to exactly one geometry and a variant
 * with its own envelope would overwrite the family's sort anchor and cull
 * extents. Shorter variants simply leave transparent pixels; transparent pixels
 * are free, a clipped baked frame is permanent.
 *
 * `RIVER_ROCK` is deliberately **not** here. A mid-channel stone is three lobes
 * and a waterline at 32 px a tile, and it has to draw *under* the wake
 * `WaterAnimationSystem` rings around it rather than in the Y-sorted pass these
 * boulders use — so it is painted procedurally in `decorationTiles.ts`. It keeps
 * its own ramp there, deliberately darker and bluer than these dry boulders,
 * because a stone standing in a river is wet.
 *
 * Run: npm run gen:rocks
 *
 * Determinism matters: every variant draws from a fixed literal seed, so
 * re-running leaves `git status` clean and a diff in these PNGs always means the
 * art actually changed.
 */

import type { ImageData } from 'canvas';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { drawBoulder, type Lithology, type RockForm, type RockSize } from './rockArt.js';
import { writeSheets, type FramePainter, type SheetRow, type SheetSpec } from './townSheets.js';

/** Matches `TILE_SIZE` in `src/core/constants.ts` — a 1:1 blit, never rescaled. */
const TILE_SCALE = 32;

/** `BOULDER_SMALL` and `BOULDER_LARGE` in `src/map/tileTypes.ts`. */
const BOULDER_SMALL_TILE_TYPE_ID = 87;
const BOULDER_LARGE_TILE_TYPE_ID = 88;

/**
 * Frame envelopes, one per family.
 *
 * Both put the anchor tile's bottom edge exactly one tile above the frame's
 * bottom: `SpriteLoader` reads the visual foot as `frameHeight - tileY`, and a
 * boulder whose foot is not exactly one tile deep would Y-sort against the
 * player from the wrong line. The rest of the cell is headroom and slack. Only
 * the *vertical* slack is used: a boulder may stand taller than its tile, and
 * that overhang is what occludes a player behind it. The horizontal slack is
 * deliberately left empty — `assertBodyFitsBlockedTile` rejects any solid pixel
 * outside the blocked column, because sideways overhang is walkable ground the
 * player would be drawn *inside*.
 */
const SMALL_FRAME_WIDTH = TILE_SCALE * 3;
const SMALL_FRAME_HEIGHT = TILE_SCALE * 2;
const SMALL_TILE_X = TILE_SCALE;
const SMALL_TILE_Y = TILE_SCALE;

const LARGE_FRAME_WIDTH = TILE_SCALE * 3;
const LARGE_FRAME_HEIGHT = TILE_SCALE * 3;
const LARGE_TILE_X = TILE_SCALE;
const LARGE_TILE_Y = TILE_SCALE * 2;

const OUT_DIR = resolve('src/images/environment/rocks');

interface VariantSpec {
  readonly key: string;
  readonly size: RockSize;
  readonly lithology: Lithology;
  readonly form: RockForm;
  readonly seed: number;
}

/**
 * Fixed literal seeds, one per variant. Never derive these from an index: a
 * variant inserted in the middle would then re-roll every rock after it and turn
 * a one-rock change into a sixteen-sheet diff.
 *
 * Eight per size, spanning all four lithologies, because the field the player
 * actually walks across shows several boulders at once — with four variants a
 * scree slope repeated visibly, and repeating *the same grey rock* was what read
 * as fake. Within a size, no lithology appears twice with the same form; the two
 * sizes are picked independently, so a pairing may repeat across them.
 */
const VARIANTS: readonly VariantSpec[] = [
  { key: 'boulder_small_a', size: 'small', lithology: 'granite', form: 'rounded', seed: 0x2c91f4 },
  { key: 'boulder_small_b', size: 'small', lithology: 'granite', form: 'blocky', seed: 0x7de038 },
  {
    key: 'boulder_small_c',
    size: 'small',
    lithology: 'sandstone',
    form: 'rounded',
    seed: 0xa41b6d,
  },
  { key: 'boulder_small_d', size: 'small', lithology: 'sandstone', form: 'split', seed: 0x0f5ac7 },
  { key: 'boulder_small_e', size: 'small', lithology: 'basalt', form: 'blocky', seed: 0x51c7e2 },
  { key: 'boulder_small_f', size: 'small', lithology: 'basalt', form: 'leaning', seed: 0xb8340a },
  {
    key: 'boulder_small_g',
    size: 'small',
    lithology: 'limestone',
    form: 'rounded',
    seed: 0x2e6f95,
  },
  { key: 'boulder_small_h', size: 'small', lithology: 'limestone', form: 'split', seed: 0xc70d53 },
  { key: 'boulder_large_a', size: 'large', lithology: 'granite', form: 'blocky', seed: 0x93b210 },
  { key: 'boulder_large_b', size: 'large', lithology: 'granite', form: 'split', seed: 0x18e7a9 },
  {
    key: 'boulder_large_c',
    size: 'large',
    lithology: 'sandstone',
    form: 'leaning',
    seed: 0x6b043e,
  },
  { key: 'boulder_large_d', size: 'large', lithology: 'sandstone', form: 'blocky', seed: 0xd25c81 },
  { key: 'boulder_large_e', size: 'large', lithology: 'basalt', form: 'split', seed: 0x4a91d6 },
  { key: 'boulder_large_f', size: 'large', lithology: 'basalt', form: 'rounded', seed: 0xe30b27 },
  {
    key: 'boulder_large_g',
    size: 'large',
    lithology: 'limestone',
    form: 'rounded',
    seed: 0x7f52bc,
  },
  {
    key: 'boulder_large_h',
    size: 'large',
    lithology: 'limestone',
    form: 'leaning',
    seed: 0x0ab6e4,
  },
];

interface Envelope {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
  readonly tileTypeId: number;
}

function envelopeFor(size: RockSize): Envelope {
  return size === 'large'
    ? {
        frameWidth: LARGE_FRAME_WIDTH,
        frameHeight: LARGE_FRAME_HEIGHT,
        tileX: LARGE_TILE_X,
        tileY: LARGE_TILE_Y,
        tileTypeId: BOULDER_LARGE_TILE_TYPE_ID,
      }
    : {
        frameWidth: SMALL_FRAME_WIDTH,
        frameHeight: SMALL_FRAME_HEIGHT,
        tileX: SMALL_TILE_X,
        tileY: SMALL_TILE_Y,
        tileTypeId: BOULDER_SMALL_TILE_TYPE_ID,
      };
}

function rowsFor(variant: VariantSpec, envelope: Envelope): SheetRow[] {
  const paint: FramePainter = (ctx, originX, originY) => {
    const spec = { size: variant.size, lithology: variant.lithology, form: variant.form };
    drawBoulder(ctx, spec, variant.seed, {
      originX,
      originY,
      // `originY` is the anchor tile's top edge inside the cell, so the cell's
      // bottom edge is that many pixels below it.
      bottomY: originY + (envelope.frameHeight - envelope.tileY),
      tileScale: TILE_SCALE,
    });
  };
  return [{ state: 'idle', frames: [paint] }];
}

function rockSheet(variant: VariantSpec, declaresTileType: boolean): SheetSpec {
  const envelope = envelopeFor(variant.size);
  return {
    key: variant.key,
    file: `${variant.key}.png`,
    frameWidth: envelope.frameWidth,
    frameHeight: envelope.frameHeight,
    tileX: envelope.tileX,
    tileY: envelope.tileY,
    ...(declaresTileType ? { tileTypeId: envelope.tileTypeId } : {}),
    rows: rowsFor(variant, envelope),
  };
}

function assertEnvelopes(): void {
  // The sort anchor. `SpriteLoader` reads the visual foot as
  // `frameHeight - tileY`, so a family whose foot is not exactly one tile deep
  // Y-sorts against the player from the wrong line.
  for (const size of ['small', 'large'] as const) {
    const envelope = envelopeFor(size);
    const footDepth = envelope.frameHeight - envelope.tileY;
    if (footDepth !== TILE_SCALE) {
      throw new Error(`${size} frameHeight - tileY must equal ${TILE_SCALE}, got ${footDepth}`);
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
 * glance at the sheet. The tree bake was caught by this three separate times.
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

/**
 * Alpha at or above which a pixel counts as the rock's body rather than as the
 * soft shadow it casts. The contact shadow peaks at 0.42 alpha and is *meant* to
 * spill onto the neighbouring tiles — a shadow that stopped dead on a tile
 * boundary would be the more obvious artefact.
 */
const SOLID_ALPHA_THRESHOLD = 200;

/**
 * Rejects a sheet whose body reaches sideways out of the one tile the boulder
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
 * This is a bake-time gate rather than a review note because the half-width
 * budget in `rockArt.ts` is enforced per stone, and a future cluster member or a
 * wider shear could satisfy every constant there and still land ink next door.
 */
function assertBodyFitsBlockedTile(spec: SheetSpec, pixels: ImageData): void {
  const alphaAt = (x: number, y: number): number =>
    pixels.data[(y * pixels.width + x) * CHANNELS_PER_PIXEL + ALPHA_CHANNEL_OFFSET];

  const columns = Math.max(...spec.rows.map((row) => row.frames.length));
  for (let row = 0; row < spec.rows.length; row++) {
    for (let column = 0; column < columns; column++) {
      const cellLeft = column * spec.frameWidth;
      const cellTop = row * spec.frameHeight;
      const tileLeft = cellLeft + spec.tileX;
      const tileRight = tileLeft + TILE_SCALE - 1;
      let escaped = 0;
      for (let y = cellTop; y < cellTop + spec.frameHeight; y++) {
        for (let x = cellLeft; x < cellLeft + spec.frameWidth; x++) {
          if (x >= tileLeft && x <= tileRight) continue;
          if (alphaAt(x, y) >= SOLID_ALPHA_THRESHOLD) escaped++;
        }
      }
      if (escaped > 0) {
        throw new Error(
          `${spec.key} ${spec.rows[row].state} frame ${column} paints ${escaped} solid pixel(s) ` +
            `outside the tile it blocks — the player would be able to stand inside the rock`,
        );
      }
    }
  }
}

function verifyRockSheet(spec: SheetSpec, pixels: ImageData): void {
  assertNothingClipped(spec, pixels);
  assertBodyFitsBlockedTile(spec, pixels);
}

assertEnvelopes();
mkdirSync(OUT_DIR, { recursive: true });

// Exactly one sheet per *family* declares its tile type: `SpriteLoader`'s sort
// anchor and cull extents are keyed by tile-type id and are last-write-wins, so
// the other seven declarations per family would be redundant overwrites of the
// same numbers and seven more places to get out of step.
const sheets: SheetSpec[] = VARIANTS.map((variant, index) =>
  rockSheet(variant, VARIANTS.findIndex((other) => other.size === variant.size) === index),
);

writeSheets(OUT_DIR, TILE_SCALE, sheets, verifyRockSheet);
console.log(
  `verified ${sheets.length} sheet(s): nothing drawn outside its cell, ` +
    `no solid pixel outside the blocked tile`,
);
