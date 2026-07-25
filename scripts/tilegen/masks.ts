/**
 * Corner-indexed transition masks — how one material gives way to another.
 *
 * ## The scheme
 *
 * A tile is classified by which of its four *corners* belong to the upper
 * material, giving 16 combinations. Corners rather than edges is what buys
 * diagonals: a tile with only its north-west corner set draws a curved wedge
 * across that corner, not an axis-aligned half. Any region the map can describe
 * by marking corners is drawable, so boundaries run at whatever angle the region
 * actually has.
 *
 * ## Why the seams still line up
 *
 * The mask field is a bilinear interpolation of the four corner values. Read
 * along the tile's right-hand edge that interpolation depends on the NE and SE
 * corners *only* — the other two drop out. The tile to its right interpolates its
 * own left-hand edge from its NW and SW corners. Those are the same two corners of
 * the shared grid, so both tiles compute an identical profile down the joint. This
 * holds for every edge and every one of the 16 combinations, with no lookup table
 * and no adjacency rules.
 *
 * The organic wobble is added by a torus-wrapped noise field (see noise.ts). Being
 * wrapped and shared by every tile, the perturbation a tile applies at x = 63 is
 * the value its neighbour applies at x = 0 — the same continuity argument as the
 * base textures. So the boundary wanders without ever tearing at a tile edge.
 */

import { TILE_PX } from './raster.js';
import { NoiseField } from './noise.js';

/** Masks are classified per game tile, so they always wrap at one tile. */
const maskNoise = new NoiseField(TILE_PX);

/** Corner bits. A set bit means that corner belongs to the upper material. */
export const CORNER_NW = 1;
export const CORNER_NE = 2;
export const CORNER_SE = 4;
export const CORNER_SW = 8;

/** Number of distinct corner combinations, i.e. frames in a transition row. */
export const CORNER_MASK_COUNT = 16;

/** Every corner set — the upper material covers the tile completely. */
export const CORNER_ALL = CORNER_NW | CORNER_NE | CORNER_SE | CORNER_SW;

/** The two combinations whose set corners are diagonally opposite. */
const DIAGONAL_NW_SE = CORNER_NW | CORNER_SE;
const DIAGONAL_NE_SW = CORNER_NE | CORNER_SW;

/** Field value at which the upper material takes over. */
const COVERAGE_THRESHOLD = 0.5;

/**
 * Width of the blend ramp either side of the threshold, in field units. Narrow
 * enough to read as a real material edge, wide enough to avoid a stair-stepped
 * 1px cut at 64px source resolution.
 */
const EDGE_FEATHER = 0.07;

/** How far the noise field may push the boundary, in field units. */
const BOUNDARY_WARP_AMPLITUDE = 0.34;
const BOUNDARY_WARP_OCTAVES = 3;
const BOUNDARY_WARP_BASE_PERIOD = 2;

/**
 * Bilinear interpolation puts a flat 0.5 ridge along the anti-diagonal when the
 * two set corners are opposite, which the warp would then dissolve into noise.
 * Pushing the field down keeps the two corners reading as separate wedges.
 */
const DIAGONAL_SEPARATION_BIAS = 0.18;

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = (value - edge0) / (edge1 - edge0);
  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return clamped * clamped * (3 - 2 * clamped);
}

function cornerValue(bits: number, corner: number): number {
  return (bits & corner) === 0 ? 0 : 1;
}

/**
 * Builds the per-pixel coverage of the upper material for one corner combination.
 * Returns alpha in [0, 1], row-major, TILE_PX x TILE_PX.
 */
export function buildCornerMask(bits: number, seed: number): Float64Array {
  const mask = new Float64Array(TILE_PX * TILE_PX);

  const northWest = cornerValue(bits, CORNER_NW);
  const northEast = cornerValue(bits, CORNER_NE);
  const southEast = cornerValue(bits, CORNER_SE);
  const southWest = cornerValue(bits, CORNER_SW);

  const isDiagonal = bits === DIAGONAL_NW_SE || bits === DIAGONAL_NE_SW;

  for (let y = 0; y < TILE_PX; y++) {
    // Sample at pixel centres so the field is symmetric across the tile.
    const v = (y + 0.5) / TILE_PX;
    for (let x = 0; x < TILE_PX; x++) {
      const u = (x + 0.5) / TILE_PX;

      const top = northWest + (northEast - northWest) * u;
      const bottom = southWest + (southEast - southWest) * u;
      let field = top + (bottom - top) * v;

      if (isDiagonal) field -= DIAGONAL_SEPARATION_BIAS;

      const warp =
        (maskNoise.fbm(x, y, seed, BOUNDARY_WARP_OCTAVES, BOUNDARY_WARP_BASE_PERIOD) -
          COVERAGE_THRESHOLD) *
        BOUNDARY_WARP_AMPLITUDE;

      mask[y * TILE_PX + x] = smoothstep(
        COVERAGE_THRESHOLD - EDGE_FEATHER,
        COVERAGE_THRESHOLD + EDGE_FEATHER,
        field + warp,
      );
    }
  }

  return mask;
}

/**
 * Per-pixel distance to the transition boundary, derived from a mask: 0 on the
 * boundary, 1 well inside either material. Painters use it to concentrate detail
 * along the joint — grass tufts spilling over a kerb, silt banked against stone —
 * which is what stops a blended edge from reading as a cross-fade.
 */
export function boundaryProximity(mask: Float64Array): Float64Array {
  const proximity = new Float64Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    proximity[i] = Math.abs(mask[i] - COVERAGE_THRESHOLD) / COVERAGE_THRESHOLD;
  }
  return proximity;
}

/**
 * The full mask set, in corner-bit order.
 *
 * Shipped as its own sheet rather than baked into per-pair transition tiles.
 * Baking would need one row per material pair *per patch phase*, which explodes
 * once materials are generated as multi-tile patches — and it would fix at build
 * time which pairs a level is allowed to blend. Compositing at load instead means
 * any material can meet any other, on any floor, at any patch alignment, from
 * sixteen 64x64 frames.
 *
 * Every mask uses a seed derived only from its corner bits: two neighbouring
 * tiles must perturb their shared boundary identically or the edge tears.
 */
export function buildMaskSet(seedBase: number): Float64Array[] {
  const masks: Float64Array[] = [];
  for (let bits = 0; bits < CORNER_MASK_COUNT; bits++) {
    masks.push(buildCornerMask(bits, seedBase + bits));
  }
  return masks;
}
