/**
 * Which pictures the Level 3 goblin camp's sheets carry.
 *
 * Four seeded hide tents and one campfire, all painted by one camp engine
 * (`src/sprites/art/campArt.ts`) from one palette of scavenged materials.
 *
 * The tents share a frame envelope, for the reason every family here does:
 * `SpriteLoader` maps a tile type to exactly one geometry, and a variant with
 * its own envelope would overwrite the family's sort anchor and cull extents.
 *
 * The campfire's `idle` row is an animation, not a single frame. `drawTile`
 * picks a frame from the shared `frameTime` the way a torch does, and
 * `CAMPFIRE` is deliberately kept out of `CACHEABLE_OVERLAY_TYPES` so it
 * redraws each frame.
 */

import { drawCampfire, drawGoblinTent } from '../art/campArt';
import type { FrameEdge, PropSheetPlan, PropSheetRow, FramePainter } from './propSheetPlan';
import type { SpriteKey } from '../../core/SpriteLoader';

/** Matches `TILE_SIZE` in `src/core/constants.ts` — a 1:1 blit, never rescaled. */
export const CAMP_TILE_SCALE = 32;

/**
 * Both envelopes put the anchor tile's bottom edge exactly one tile above the
 * frame's bottom: `SpriteLoader` reads the visual foot as `frameHeight - tileY`,
 * and a prop whose foot is not one tile deep Y-sorts from the wrong line.
 */
const TENT_FRAME_WIDTH = CAMP_TILE_SCALE * 3;
const TENT_FRAME_HEIGHT = CAMP_TILE_SCALE * 3;
const TENT_TILE_X = CAMP_TILE_SCALE;
const TENT_TILE_Y = CAMP_TILE_SCALE * 2;

const FIRE_FRAME_WIDTH = CAMP_TILE_SCALE * 3;
const FIRE_FRAME_HEIGHT = CAMP_TILE_SCALE * 3;
const FIRE_TILE_X = CAMP_TILE_SCALE;
const FIRE_TILE_Y = CAMP_TILE_SCALE * 2;

/** Frames in the campfire's flame loop. */
const FIRE_FRAME_COUNT = 6;

interface TentVariant {
  readonly key: SpriteKey;
  readonly seed: number;
}

/**
 * Fixed literal seeds. Never derive these from an index: a variant inserted in
 * the middle would re-roll every tent after it and turn a one-tent change into a
 * four-sheet diff. A floor's own art seed is *added* to these for the same
 * reason it is added to a ground material's structure seed — the family shifts
 * together, and each variant keeps its identity within it.
 */
const TENT_VARIANTS: ReadonlyArray<TentVariant> = [
  { key: 'goblin_tent_a', seed: 0x51e07c },
  { key: 'goblin_tent_b', seed: 0xc3a419 },
  { key: 'goblin_tent_c', seed: 0x2b96f5 },
  { key: 'goblin_tent_d', seed: 0x8f10a3 },
];

const CAMPFIRE_SEED = 0x7c2d94;

function tentRows(variant: TentVariant, seedTerm: number): PropSheetRow[] {
  const paint: FramePainter = (ctx, originX, originY) => {
    drawGoblinTent(ctx, variant.seed + seedTerm, {
      originX,
      originY,
      bottomY: originY + (TENT_FRAME_HEIGHT - TENT_TILE_Y),
      tileScale: CAMP_TILE_SCALE,
    });
  };
  return [{ state: 'idle', frames: [paint] }];
}

function tentSheet(variant: TentVariant, seedTerm: number): PropSheetPlan {
  return {
    key: variant.key,
    file: `${variant.key}.png`,
    frameWidth: TENT_FRAME_WIDTH,
    frameHeight: TENT_FRAME_HEIGHT,
    tileX: TENT_TILE_X,
    tileY: TENT_TILE_Y,
    tileScale: CAMP_TILE_SCALE,
    rows: tentRows(variant, seedTerm),
  };
}

function campfireSheet(seedTerm: number): PropSheetPlan {
  return {
    key: 'campfire',
    file: 'campfire.png',
    frameWidth: FIRE_FRAME_WIDTH,
    frameHeight: FIRE_FRAME_HEIGHT,
    tileX: FIRE_TILE_X,
    tileY: FIRE_TILE_Y,
    tileScale: CAMP_TILE_SCALE,
    rows: [
      {
        state: 'idle',
        frames: Array.from(
          { length: FIRE_FRAME_COUNT },
          (_unused, frame): FramePainter =>
            (ctx, originX, originY) => {
              drawCampfire(ctx, CAMPFIRE_SEED + seedTerm, frame, FIRE_FRAME_COUNT, {
                originX,
                originY,
                bottomY: originY + (FIRE_FRAME_HEIGHT - FIRE_TILE_Y),
                tileScale: CAMP_TILE_SCALE,
              });
            },
        ),
      },
    ],
  };
}

/**
 * Fails loudly on the sort anchor every camp prop depends on.
 *
 * `SpriteLoader` reads a sprite's visual foot as `frameHeight - tileY`, so a
 * family whose foot is not exactly one tile deep Y-sorts against the player
 * from the wrong line.
 */
export function assertCampEnvelopes(): void {
  const checks: ReadonlyArray<readonly [string, number, number]> = [
    ['tent', TENT_FRAME_HEIGHT, TENT_TILE_Y],
    ['campfire', FIRE_FRAME_HEIGHT, FIRE_TILE_Y],
  ];
  for (const [name, frameHeight, tileY] of checks) {
    const footDepth = frameHeight - tileY;
    if (footDepth !== CAMP_TILE_SCALE) {
      throw new Error(
        `${name} frameHeight - tileY must equal ${CAMP_TILE_SCALE}, got ${footDepth}`,
      );
    }
  }
}

/**
 * Every camp sheet, painted with `seedTerm` added to each variant's own seed.
 *
 * The term is a parameter rather than read from the floor slot so the seed sweep
 * can paint the whole camp at a candidate seed without pretending to be on a
 * floor.
 */
/**
 * The edges a tent stands on rather than is sheared by.
 *
 * A tent's anchor tile *is* the bottom row of its frame, so its ground shadow
 * pools against that line because there is nowhere below it to pool into. How
 * far the shadow reaches varies with the seed, so a frame that cleared the line
 * at one seed presses against it at another — and there is nothing to clip away,
 * since the row it reaches is the tent's own tile. Every other edge is slack the
 * canvas may not use up.
 */
export const CAMP_GROUNDED_EDGES: ReadonlySet<FrameEdge> = new Set<FrameEdge>(['bottom']);

export function campSheetPlans(seedTerm: number): PropSheetPlan[] {
  assertCampEnvelopes();
  return [...TENT_VARIANTS.map((variant) => tentSheet(variant, seedTerm)), campfireSheet(seedTerm)];
}
