/**
 * Which pictures the Level 3 wilderness's boulders carry.
 *
 * Two boulder families — `boulder_small_*` and `boulder_large_*`, eight seeded variants
 * each, all painted by one engine (`src/sprites/art/mineableRockArt.ts`) from
 * one ramp per lithology, so a scree slope reads as a slope of different rocks
 * rather than one rock repeated.
 *
 * Every boulder and outcrop is mineable, so each sheet holds one row per
 * damage stage (`ROCK_DAMAGE_STATES`): the same rock intact, chipped, broken
 * and worn down to a remnant.
 *
 * Both families share the geometry contract every prop sheet here uses:
 * `SpriteLoader` maps a tile type to exactly one geometry, so a variant with its
 * own envelope would overwrite the family's sort anchor and cull extents.
 *
 * The quarry's `rock_deposit_*` sheets ride along: outcrops are painted by the
 * same engine, and the dressed wall stubs by `src/sprites/art/rockDepositArt.ts`,
 * shedding the same rubble as they are worked.
 *
 * `RIVER_ROCK` is deliberately **not** here. A mid-channel stone is three lobes
 * and a waterline at 32 px a tile, and it has to draw *under* the wake
 * `WaterAnimationSystem` rings around it rather than in the Y-sorted pass these
 * boulders use — so it is painted procedurally in `decorationTiles.ts`. It keeps
 * its own ramp there, deliberately darker and bluer than these dry boulders,
 * because a stone standing in a river is wet.
 */

import type { Lithology } from '../art/rockArt';
import { drawRockDeposit } from '../art/rockDepositArt';
import { drawMineableRock, drawRockRubble, type MineableRockKind } from '../art/mineableRockArt';
import { ROCK_DAMAGE_STATES, type RockDamageState } from '../../map/rockDamage';
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

type RockSize = Extract<MineableRockKind, 'small' | 'large'>;

interface RockVariant {
  readonly key: SpriteKey;
  readonly size: RockSize;
  readonly lithology: Lithology;
  /** How far the rock leans off upright; negative leans left. */
  readonly lean: number;
  readonly seed: number;
}

/** Leans, as a share of the half width the crown shifts over. */
const UPRIGHT = 0;
const LEAN_LEFT = -0.22;
const LEAN_RIGHT = 0.22;

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
 * as fake. Two per lithology within a size, told apart by their seeds and
 * mostly by their lean as well.
 */
const VARIANTS: ReadonlyArray<RockVariant> = [
  { key: 'boulder_small_a', size: 'small', lithology: 'granite', lean: UPRIGHT, seed: 0x2c91f4 },
  { key: 'boulder_small_b', size: 'small', lithology: 'granite', lean: UPRIGHT, seed: 0x7de038 },
  {
    key: 'boulder_small_c',
    size: 'small',
    lithology: 'sandstone',
    lean: UPRIGHT,
    seed: 0xa41b6d,
  },
  {
    key: 'boulder_small_d',
    size: 'small',
    lithology: 'sandstone',
    lean: LEAN_RIGHT,
    seed: 0x0f5ac7,
  },
  { key: 'boulder_small_e', size: 'small', lithology: 'basalt', lean: UPRIGHT, seed: 0x51c7e2 },
  { key: 'boulder_small_f', size: 'small', lithology: 'basalt', lean: LEAN_LEFT, seed: 0xb8340a },
  {
    key: 'boulder_small_g',
    size: 'small',
    lithology: 'limestone',
    lean: UPRIGHT,
    seed: 0x2e6f95,
  },
  {
    key: 'boulder_small_h',
    size: 'small',
    lithology: 'limestone',
    lean: LEAN_RIGHT,
    seed: 0xc70d53,
  },
  { key: 'boulder_large_a', size: 'large', lithology: 'granite', lean: UPRIGHT, seed: 0x93b210 },
  { key: 'boulder_large_b', size: 'large', lithology: 'granite', lean: LEAN_RIGHT, seed: 0x18e7a9 },
  {
    key: 'boulder_large_c',
    size: 'large',
    lithology: 'sandstone',
    lean: LEAN_LEFT,
    seed: 0x6b043e,
  },
  { key: 'boulder_large_d', size: 'large', lithology: 'sandstone', lean: UPRIGHT, seed: 0xd25c81 },
  { key: 'boulder_large_e', size: 'large', lithology: 'basalt', lean: LEAN_RIGHT, seed: 0x4a91d6 },
  { key: 'boulder_large_f', size: 'large', lithology: 'basalt', lean: UPRIGHT, seed: 0xe30b27 },
  {
    key: 'boulder_large_g',
    size: 'large',
    lithology: 'limestone',
    lean: UPRIGHT,
    seed: 0x7f52bc,
  },
  {
    key: 'boulder_large_h',
    size: 'large',
    lithology: 'limestone',
    lean: LEAN_LEFT,
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

/** One row per damage stage, each painted by `paintStage`. */
function damageRows(paintStage: (stage: RockDamageState) => FramePainter): PropSheetRow[] {
  return ROCK_DAMAGE_STATES.map((stage) => ({ state: stage, frames: [paintStage(stage)] }));
}

function frameAt(originX: number, originY: number, envelope: Envelope) {
  return {
    originX,
    originY,
    // `originY` is the anchor tile's top edge inside the cell, so the cell's
    // bottom edge is that many pixels below it.
    bottomY: originY + (envelope.frameHeight - envelope.tileY),
    tileScale: ROCK_TILE_SCALE,
  };
}

function rowsFor(variant: RockVariant, envelope: Envelope, seedTerm: number): PropSheetRow[] {
  const spec = { kind: variant.size, lithology: variant.lithology, lean: variant.lean };
  return damageRows((stage) => (ctx, originX, originY) => {
    drawMineableRock(
      ctx,
      spec,
      variant.seed + seedTerm,
      frameAt(originX, originY, envelope),
      stage,
    );
  });
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
 * The quarry's minable stone. One envelope for every variant, because
 * `SpriteLoader` maps `ROCK_DEPOSIT` to one geometry: the small boulder's, a
 * tile of headroom over the one tile it blocks. Each sheet carries one row per
 * damage stage, which `drawRockDepositTile` picks by the tile's `damageStage`.
 */
interface DepositVariant {
  readonly key: SpriteKey;
  readonly form: 'outcrop' | 'dressed';
  readonly lithology: Lithology;
  readonly seed: number;
}

/**
 * A dressed wall stub keeps its courses until it is broken, then loses its top
 * course; the rubble at its foot is what tells its chipped stage from intact.
 */
const DRESSED_WORKED_STAGES: ReadonlySet<RockDamageState> = new Set(['broken', 'remnant']);

/**
 * Fixed literal seeds, for the same reason as the boulders'. The quarry stands
 * on grey scree, so its stone is grey: tan sandstone strata, seen in the
 * quarry, read as a stack of planks.
 */
const DEPOSIT_VARIANTS: ReadonlyArray<DepositVariant> = [
  { key: 'rock_deposit_a', form: 'outcrop', lithology: 'granite', seed: 0x5e7a21 },
  { key: 'rock_deposit_b', form: 'outcrop', lithology: 'granite', seed: 0x2b90d4 },
  { key: 'rock_deposit_c', form: 'outcrop', lithology: 'basalt', seed: 0xc4163f },
  { key: 'rock_deposit_dressed_a', form: 'dressed', lithology: 'limestone', seed: 0x71e8b5 },
  { key: 'rock_deposit_dressed_b', form: 'dressed', lithology: 'granite', seed: 0x9d3c62 },
];

function depositSheet(variant: DepositVariant, seedTerm: number): PropSheetPlan {
  const envelope = envelopeFor('small');
  const seed = variant.seed + seedTerm;
  const rows = damageRows((stage) => (ctx, originX, originY) => {
    const frame = frameAt(originX, originY, envelope);
    if (variant.form === 'outcrop') {
      drawMineableRock(
        ctx,
        { kind: 'outcrop', lithology: variant.lithology, lean: UPRIGHT },
        seed,
        frame,
        stage,
      );
      return;
    }
    const worked = DRESSED_WORKED_STAGES.has(stage);
    drawRockDeposit(ctx, { lithology: variant.lithology, worked }, seed, frame);
    drawRockRubble(ctx, variant.lithology, seed, frame, stage);
  });
  return {
    key: variant.key,
    file: `${variant.key}.png`,
    tileScale: ROCK_TILE_SCALE,
    ...envelope,
    rows,
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
  return [
    ...VARIANTS.map((variant) => rockSheet(variant, seedTerm)),
    ...DEPOSIT_VARIANTS.map((variant) => depositSheet(variant, seedTerm)),
  ];
}
