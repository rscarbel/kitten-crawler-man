/**
 * Which pictures the Level 3 forest's sheets carry.
 *
 * Three species by four variants, all painted by one canopy engine
 * (`src/sprites/art/treeArt.ts`) from one palette, so a forest reads as a single
 * wood rather than twelve unrelated assets.
 *
 * Every tree sheet shares an identical frame envelope — 3 tiles wide, 4 tiles
 * tall, anchored on the middle column's bottom tile — because `SpriteLoader`
 * maps a tile type to exactly one geometry, and a variant with its own envelope
 * would overwrite the family's sort anchor and cull extents. Shorter species
 * simply leave transparent pixels; transparent pixels are free, art clipped by
 * its own cell is not.
 */

import { drawTree, drawTreeRemains, type TreeSpecies, type TreeState } from '../art/treeArt';
import type { PropSheetPlan, PropSheetRow, FramePainter } from './propSheetPlan';
import type { SpriteKey } from '../../core/SpriteLoader';

/** Matches `TILE_SIZE` in `src/core/constants.ts` — a 1:1 blit, never rescaled. */
export const TREE_TILE_SCALE = 32;

/** 3 tiles: one tile of canopy overhang each side of the anchor column. */
const FRAME_WIDTH = TREE_TILE_SCALE * 3;
/** 4 tiles: the anchor tile plus three tiles of trunk and canopy above it. */
const FRAME_HEIGHT = TREE_TILE_SCALE * 4;
/** The anchor tile is the middle column. */
const TILE_X = TREE_TILE_SCALE;
/** Top edge of the anchor tile — three tiles down from the top of the frame. */
const TILE_Y = TREE_TILE_SCALE * 3;

/**
 * The remains decal is boxed rather than towering: what is left of a felled tree
 * is a stump and a scatter of ash, which needs a little room around its tile and
 * none above it.
 */
const REMAINS_FRAME_WIDTH = TREE_TILE_SCALE * 2;
const REMAINS_FRAME_HEIGHT = TREE_TILE_SCALE * 2;
const REMAINS_TILE_X = TREE_TILE_SCALE / 2;
const REMAINS_TILE_Y = TREE_TILE_SCALE;

const BURN_FRAME_COUNT = 6;
const FELLING_FRAME_COUNT = 6;

interface TreeVariant {
  readonly key: SpriteKey;
  readonly species: TreeSpecies;
  readonly seed: number;
}

/**
 * Fixed literal seeds, one per variant. Never derive these from an index: a
 * variant inserted in the middle would then re-roll every tree after it and turn
 * a one-tree change into a twelve-sheet diff. A floor's own art seed is *added*
 * to these for the same reason it is added to a ground material's structure
 * seed — the family shifts together, and each variant keeps its identity within
 * it.
 */
const VARIANTS: ReadonlyArray<TreeVariant> = [
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

/**
 * Rows a tree must have painted before it may be drawn: its idle stance and its
 * damaged one, which are the two a standing tree ever shows. Everything after
 * them is an animation a tree only plays once something sets fire to it or cuts
 * it down, by which time the paint queue has long since finished.
 *
 * Derived from the row order rather than written beside it, so a row inserted
 * ahead of `burning` cannot quietly make this count mean something else.
 */
export const TREE_READY_ROWS =
  STATE_ROWS.findIndex((row) => row.state === 'burning') === -1
    ? STATE_ROWS.length
    : STATE_ROWS.findIndex((row) => row.state === 'burning');

function rowsFor(variant: TreeVariant, seedTerm: number): PropSheetRow[] {
  return STATE_ROWS.map(({ state, frames: frameCount }) => {
    const frames: FramePainter[] = [];
    for (let frame = 0; frame < frameCount; frame++) {
      frames.push((ctx, originX, originY) => {
        drawTree(ctx, variant.species, variant.seed + seedTerm, state, frame, frameCount, {
          originX,
          originY,
          // `originY` is the anchor tile's top edge inside the cell, so the
          // cell's own edges are that many pixels either side of it.
          topY: originY - TILE_Y,
          bottomY: originY + (FRAME_HEIGHT - TILE_Y),
          leftX: originX - TILE_X,
          rightX: originX + (FRAME_WIDTH - TILE_X),
          tileScale: TREE_TILE_SCALE,
        });
      });
    }
    return { state, frames };
  });
}

function treeSheet(variant: TreeVariant, seedTerm: number): PropSheetPlan {
  return {
    key: variant.key,
    file: `${variant.key}.png`,
    frameWidth: FRAME_WIDTH,
    frameHeight: FRAME_HEIGHT,
    tileX: TILE_X,
    tileY: TILE_Y,
    tileScale: TREE_TILE_SCALE,
    rows: rowsFor(variant, seedTerm),
  };
}

const REMAINS_SHEET: PropSheetPlan = {
  key: 'tree_remains',
  file: 'tree_remains.png',
  frameWidth: REMAINS_FRAME_WIDTH,
  frameHeight: REMAINS_FRAME_HEIGHT,
  tileX: REMAINS_TILE_X,
  tileY: REMAINS_TILE_Y,
  tileScale: TREE_TILE_SCALE,
  rows: [
    {
      state: 'idle',
      frames: [
        (ctx, originX, originY) => {
          drawTreeRemains(
            ctx,
            originX,
            originY,
            TREE_TILE_SCALE,
            originY + (REMAINS_FRAME_HEIGHT - REMAINS_TILE_Y),
          );
        },
      ],
    },
  ],
};

/**
 * Fails loudly on the two envelope invariants the whole family depends on.
 *
 * Both are load-bearing rather than cosmetic. The first is the sort anchor:
 * `SpriteLoader` reads a sprite's visual foot as `frameHeight - tileY`, and a
 * tree whose foot is not exactly one tile deep would Y-sort against players from
 * the wrong line. The second is the sideways overhang the cull margin is derived
 * from.
 */
export function assertTreeEnvelope(): void {
  const footDepth = FRAME_HEIGHT - TILE_Y;
  if (footDepth !== TREE_TILE_SCALE) {
    throw new Error(`tree frameHeight - tileY must equal ${TREE_TILE_SCALE}, got ${footDepth}`);
  }
  const rightReach = FRAME_WIDTH - TILE_X;
  if (rightReach !== TREE_TILE_SCALE * 2) {
    throw new Error(`tree frameWidth - tileX must equal ${TREE_TILE_SCALE * 2}, got ${rightReach}`);
  }
  const remainsFootDepth = REMAINS_FRAME_HEIGHT - REMAINS_TILE_Y;
  if (remainsFootDepth !== TREE_TILE_SCALE) {
    throw new Error(
      `tree remains frameHeight - tileY must equal ${TREE_TILE_SCALE}, got ${remainsFootDepth}`,
    );
  }
}

/**
 * Every forest sheet, painted with `seedTerm` added to each variant's own seed.
 *
 * The term is a parameter rather than read from the floor slot so the seed sweep
 * can paint the whole forest at a candidate seed without pretending to be on a
 * floor.
 */
export function treeSheetPlans(seedTerm: number): PropSheetPlan[] {
  assertTreeEnvelope();
  return [...VARIANTS.map((variant) => treeSheet(variant, seedTerm)), REMAINS_SHEET];
}
