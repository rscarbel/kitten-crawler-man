/**
 * Which pictures the Level 3 wilderness's boulders carry.
 *
 * Two families — `boulder_small_*` and `boulder_large_*`, eight seeded variants
 * each, all painted by one boulder engine (`src/sprites/art/rockArt.ts`) from
 * one master palette per lithology, so a scree slope reads as a slope of
 * different rocks rather than one rock repeated.
 *
 * Both families share the geometry contract every prop sheet here uses:
 * `SpriteLoader` maps a tile type to exactly one geometry, so a variant with its
 * own envelope would overwrite the family's sort anchor and cull extents.
 *
 * `RIVER_ROCK` is deliberately **not** here. A mid-channel stone is three lobes
 * and a waterline at 32 px a tile, and it has to draw *under* the wake
 * `WaterAnimationSystem` rings around it rather than in the Y-sorted pass these
 * boulders use — so it is painted procedurally in `decorationTiles.ts`. It keeps
 * its own ramp there, deliberately darker and bluer than these dry boulders,
 * because a stone standing in a river is wet.
 */

import { drawBoulder, type Lithology, type RockForm, type RockSize } from '../art/rockArt';
import type { PropSheetPlan, PropSheetRow, FramePainter } from './propSheetPlan';
import type { SpriteKey } from '../../core/SpriteLoader';

/** Matches `TILE_SIZE` in `src/core/constants.ts` — a 1:1 blit, never rescaled. */
export const ROCK_TILE_SCALE = 32;

/**
 * Frame envelopes, one per family.
 *
 * Both put the anchor tile's bottom edge exactly one tile above the frame's
 * bottom: `SpriteLoader` reads the visual foot as `frameHeight - tileY`, and a
 * boulder whose foot is not exactly one tile deep would Y-sort against the
 * player from the wrong line. The rest of the cell is headroom and slack. Only
 * the *vertical* slack is used: a boulder may stand taller than its tile, and
 * that overhang is what occludes a player behind it. The horizontal slack is
 * deliberately left empty — `assertBodyFitsBlockedTile` (in `scripts/generate-
 * rock-sprites.ts`) rejects any solid pixel outside the blocked column, because
 * sideways overhang is walkable ground the player would be drawn *inside*.
 */
const SMALL_FRAME_WIDTH = ROCK_TILE_SCALE * 3;
const SMALL_FRAME_HEIGHT = ROCK_TILE_SCALE * 2;
const SMALL_TILE_X = ROCK_TILE_SCALE;
const SMALL_TILE_Y = ROCK_TILE_SCALE;

const LARGE_FRAME_WIDTH = ROCK_TILE_SCALE * 3;
const LARGE_FRAME_HEIGHT = ROCK_TILE_SCALE * 3;
const LARGE_TILE_X = ROCK_TILE_SCALE;
const LARGE_TILE_Y = ROCK_TILE_SCALE * 2;

interface RockVariant {
  readonly key: SpriteKey;
  readonly size: RockSize;
  readonly lithology: Lithology;
  readonly form: RockForm;
  readonly seed: number;
}

/**
 * Fixed literal seeds, one per variant. Never derive these from an index: a
 * variant inserted in the middle would then re-roll every rock after it and turn
 * a one-rock change into a sixteen-sheet diff. A floor's own art seed is *added*
 * to these for the same reason it is added to a ground material's structure
 * seed — the family shifts together, and each variant keeps its identity within
 * it.
 *
 * Eight per size, spanning all four lithologies, because the field the player
 * actually walks across shows several boulders at once — with four variants a
 * scree slope repeated visibly, and repeating *the same grey rock* was what read
 * as fake. Within a size, no lithology appears twice with the same form; the two
 * sizes are picked independently, so a pairing may repeat across them.
 */
const VARIANTS: ReadonlyArray<RockVariant> = [
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
}

function envelopeFor(size: RockSize): Envelope {
  return size === 'large'
    ? {
        frameWidth: LARGE_FRAME_WIDTH,
        frameHeight: LARGE_FRAME_HEIGHT,
        tileX: LARGE_TILE_X,
        tileY: LARGE_TILE_Y,
      }
    : {
        frameWidth: SMALL_FRAME_WIDTH,
        frameHeight: SMALL_FRAME_HEIGHT,
        tileX: SMALL_TILE_X,
        tileY: SMALL_TILE_Y,
      };
}

function rowsFor(variant: RockVariant, envelope: Envelope, seedTerm: number): PropSheetRow[] {
  const paint: FramePainter = (ctx, originX, originY) => {
    const spec = { size: variant.size, lithology: variant.lithology, form: variant.form };
    drawBoulder(ctx, spec, variant.seed + seedTerm, {
      originX,
      originY,
      // `originY` is the anchor tile's top edge inside the cell, so the cell's
      // bottom edge is that many pixels below it.
      bottomY: originY + (envelope.frameHeight - envelope.tileY),
      tileScale: ROCK_TILE_SCALE,
    });
  };
  return [{ state: 'idle', frames: [paint] }];
}

function rockSheet(variant: RockVariant, seedTerm: number): PropSheetPlan {
  const envelope = envelopeFor(variant.size);
  return {
    key: variant.key,
    file: `${variant.key}.png`,
    tileScale: ROCK_TILE_SCALE,
    ...envelope,
    rows: rowsFor(variant, envelope, seedTerm),
  };
}

/**
 * Fails loudly on the sort anchor every boulder depends on.
 *
 * `SpriteLoader` reads a sprite's visual foot as `frameHeight - tileY`, and a
 * boulder whose foot is not exactly one tile deep would Y-sort against the
 * player from the wrong line.
 */
export function assertRockEnvelopes(): void {
  for (const size of ['small', 'large'] as const) {
    const envelope = envelopeFor(size);
    const footDepth = envelope.frameHeight - envelope.tileY;
    if (footDepth !== ROCK_TILE_SCALE) {
      throw new Error(
        `${size} boulder frameHeight - tileY must equal ${ROCK_TILE_SCALE}, got ${footDepth}`,
      );
    }
  }
}

/**
 * Every boulder sheet, painted with `seedTerm` added to each variant's own seed.
 *
 * The term is a parameter rather than read from the floor slot so the seed sweep
 * can paint the whole wilderness at a candidate seed without pretending to be on
 * a floor.
 */
export function rockSheetPlans(seedTerm: number): PropSheetPlan[] {
  assertRockEnvelopes();
  return VARIANTS.map((variant) => rockSheet(variant, seedTerm));
}
