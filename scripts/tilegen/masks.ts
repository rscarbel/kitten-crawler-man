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
 * wrapped and shared by every mask, the perturbation one tile applies at the end
 * of the field is the value its neighbour applies at the start — the same
 * continuity argument as the base textures. So the boundary wanders without ever
 * tearing at a tile edge.
 */

import { TILE_PX } from './raster.js';
import { NoiseField } from './noise.js';

/**
 * Tiles across one mask patch.
 *
 * The classification is per tile, but the *warp* must not be. Wrapped at a single
 * tile it gives every boundary in the world the same 64px profile, so a street
 * edge scallops on a fixed tile rhythm — the grid this tileset exists to remove,
 * and exactly the trap the ground generator's first rule warns about. The warp is
 * therefore sampled from a patch-sized wrapped field and sliced, as the materials
 * are, and a boundary only repeats every `MASK_PATCH_TILES` tiles.
 *
 * Three keeps the sheet one row of 144 frames — 9216px, well inside any canvas
 * dimension limit — and lets the warp carry features up to 48px across, which one
 * tile of wrap cannot hold.
 */
export const MASK_PATCH_TILES = 3;

const MASK_PATCH_PX = MASK_PATCH_TILES * TILE_PX;

/** Frames per corner combination: one per position of a tile within the patch. */
export const MASK_PHASE_COUNT = MASK_PATCH_TILES * MASK_PATCH_TILES;

const maskNoise = new NoiseField(MASK_PATCH_PX);

/** Corner bits. A set bit means that corner belongs to the upper material. */
export const CORNER_NW = 1;
export const CORNER_NE = 2;
export const CORNER_SE = 4;
export const CORNER_SW = 8;

/** Number of distinct corner combinations. */
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

/**
 * How far the noise field may push the boundary, in field units.
 *
 * Raising it eventually pulls a corner whose value is a full 1 back under the
 * threshold, punching holes through a tile that is supposed to be entirely the
 * upper material. Where that happens depends on the realised field — it is not
 * `2 * (COVERAGE_THRESHOLD - EDGE_FEATHER)`, which assumes a warp symmetric about
 * zero, and a mean-centred field is not — so `buildMaskSet`'s own assertion is
 * the check that matters, not arithmetic here.
 *
 * The octave periods must divide the patch size (see noise.ts): 4, 8, 16 and 32
 * all divide 192.
 */
const BOUNDARY_WARP_AMPLITUDE = 0.65;
const BOUNDARY_WARP_OCTAVES = 4;
const BOUNDARY_WARP_BASE_PERIOD = 4;

/**
 * Bilinear interpolation puts a flat 0.5 ridge along the anti-diagonal when the
 * two set corners are opposite, which the warp would then dissolve into noise.
 * Pushing the field down keeps the two corners reading as separate wedges.
 *
 * Applied through `interiorWindow`, never flat: a constant bias would sit the
 * whole diagonal mask 0.18 below a neighbour that shares its two corners, and
 * their shared edge would tear by the full alpha range.
 */
const DIAGONAL_SEPARATION_BIAS = 0.18;

/**
 * Weight that is 1 at the tile centre and 0 all round its border, so anything
 * multiplied by it can shape the tile's interior without moving the boundary
 * where a neighbour has to agree with it.
 */
function interiorWindow(u: number, v: number): number {
  const acrossTile = 4 * u * (1 - u);
  const downTile = 4 * v * (1 - v);
  return acrossTile * downTile;
}

/** One warp field per seed — every combination and every phase shares it. */
const warpFields = new Map<number, Float64Array>();

/**
 * The boundary displacement, per pixel of a whole patch, centred on zero.
 *
 * Centring is not tidiness. `fbm` averages 0.5 across many realisations but not
 * across one finite field, and whatever the realised mean happens to be biases
 * *every* boundary in *every* mask the same way — a systematic erosion of one
 * material rather than a wander. Subtracting the field's own mean removes the
 * dependence on that luck, and because the mean is a single number shared by
 * every frame it cannot reintroduce a seam.
 */
function boundaryWarpField(seed: number): Float64Array {
  const cached = warpFields.get(seed);
  if (cached !== undefined) return cached;

  const field = new Float64Array(MASK_PATCH_PX * MASK_PATCH_PX);
  let total = 0;
  for (let y = 0; y < MASK_PATCH_PX; y++) {
    for (let x = 0; x < MASK_PATCH_PX; x++) {
      const sample = maskNoise.fbm(x, y, seed, BOUNDARY_WARP_OCTAVES, BOUNDARY_WARP_BASE_PERIOD);
      field[y * MASK_PATCH_PX + x] = sample;
      total += sample;
    }
  }

  const mean = total / field.length;
  for (let index = 0; index < field.length; index++) {
    field[index] = (field[index] - mean) * BOUNDARY_WARP_AMPLITUDE;
  }

  warpFields.set(seed, field);
  return field;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = (value - edge0) / (edge1 - edge0);
  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return clamped * clamped * (3 - 2 * clamped);
}

function cornerValue(bits: number, corner: number): number {
  return (bits & corner) === 0 ? 0 : 1;
}

/**
 * Builds the per-pixel coverage of the upper material for one corner combination
 * at one position within the warp patch. Returns alpha in [0, 1], row-major,
 * TILE_PX x TILE_PX.
 */
export function buildCornerMask(bits: number, seed: number, phaseX = 0, phaseY = 0): Float64Array {
  const mask = new Float64Array(TILE_PX * TILE_PX);

  const northWest = cornerValue(bits, CORNER_NW);
  const northEast = cornerValue(bits, CORNER_NE);
  const southEast = cornerValue(bits, CORNER_SE);
  const southWest = cornerValue(bits, CORNER_SW);

  const isDiagonal = bits === DIAGONAL_NW_SE || bits === DIAGONAL_NE_SW;
  const warp = boundaryWarpField(seed);

  for (let y = 0; y < TILE_PX; y++) {
    // Sample at pixel centres so the field is symmetric across the tile.
    const v = (y + 0.5) / TILE_PX;
    for (let x = 0; x < TILE_PX; x++) {
      const u = (x + 0.5) / TILE_PX;

      const top = northWest + (northEast - northWest) * u;
      const bottom = southWest + (southEast - southWest) * u;
      let field = top + (bottom - top) * v;

      if (isDiagonal) field -= DIAGONAL_SEPARATION_BIAS * interiorWindow(u, v);

      const warpIndex = (phaseY * TILE_PX + y) * MASK_PATCH_PX + (phaseX * TILE_PX + x);
      mask[y * TILE_PX + x] = smoothstep(
        COVERAGE_THRESHOLD - EDGE_FEATHER,
        COVERAGE_THRESHOLD + EDGE_FEATHER,
        field + warp[warpIndex],
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

/** A mask that should be solid must be solid; anything less shows as a hole. */
const SOLID_ALPHA = 1;

/** Which of a mask's four corners each edge of the tile is interpolated from. */
const EDGE_CORNERS = {
  north: [CORNER_NW, CORNER_NE],
  south: [CORNER_SW, CORNER_SE],
  west: [CORNER_NW, CORNER_SW],
  east: [CORNER_NE, CORNER_SE],
} as const;

function shares(a: number, b: number, cornersA: readonly number[], cornersB: readonly number[]) {
  return cornersA.every((corner, index) => ((a & corner) !== 0) === ((b & cornersB[index]) !== 0));
}

export interface MaskSeamReport {
  /** Worst alpha step across the joint between two masks that can be adjacent. */
  readonly joint: number;
  /** Worst alpha step between neighbouring pixels *inside* a mask. */
  readonly interior: number;
  /** Above 1 the joint is the hardest line in the set, which reads as a tear. */
  readonly ratio: number;
}

/**
 * Measures the joint between every pair of masks that can end up side by side
 * against the masks' own strongest internal step.
 *
 * The absolute step is the wrong yardstick, for the same reason it is on the
 * material patches: a mask legitimately contains a hard line — that is what a
 * material boundary is — and the joint may land on one. What must not happen is
 * the joint being *harder* than anything inside, which is what a discontinuous
 * warp produces. Seeding each combination separately scores far above 1 here;
 * one shared field scores comfortably below it.
 */
export function auditMaskSeams(masks: ReadonlyArray<Float64Array>): MaskSeamReport {
  const frameAt = (bits: number, phaseX: number, phaseY: number): Float64Array => {
    const px = ((phaseX % MASK_PATCH_TILES) + MASK_PATCH_TILES) % MASK_PATCH_TILES;
    const py = ((phaseY % MASK_PATCH_TILES) + MASK_PATCH_TILES) % MASK_PATCH_TILES;
    return masks[bits * MASK_PHASE_COUNT + py * MASK_PATCH_TILES + px];
  };

  // Measured per axis and combined at the end: a vertical joint has to be judged
  // against vertical steps. Mixing them flatters whichever axis is smoother.
  let jointAcross = 0;
  let jointDown = 0;
  let interiorAcross = 0;
  let interiorDown = 0;

  for (let phaseX = 0; phaseX < MASK_PATCH_TILES; phaseX++) {
    for (let phaseY = 0; phaseY < MASK_PATCH_TILES; phaseY++) {
      for (let bits = 0; bits < CORNER_MASK_COUNT; bits++) {
        const frame = frameAt(bits, phaseX, phaseY);
        for (let y = 0; y < TILE_PX; y++) {
          for (let x = 0; x < TILE_PX; x++) {
            if (x < TILE_PX - 1) {
              interiorAcross = Math.max(
                interiorAcross,
                Math.abs(frame[y * TILE_PX + x] - frame[y * TILE_PX + x + 1]),
              );
            }
            if (y < TILE_PX - 1) {
              interiorDown = Math.max(
                interiorDown,
                Math.abs(frame[y * TILE_PX + x] - frame[(y + 1) * TILE_PX + x]),
              );
            }
          }
        }

        for (let other = 0; other < CORNER_MASK_COUNT; other++) {
          if (shares(bits, other, EDGE_CORNERS.east, EDGE_CORNERS.west)) {
            const right = frameAt(other, phaseX + 1, phaseY);
            for (let y = 0; y < TILE_PX; y++) {
              jointAcross = Math.max(
                jointAcross,
                Math.abs(frame[y * TILE_PX + TILE_PX - 1] - right[y * TILE_PX]),
              );
            }
          }
          if (shares(bits, other, EDGE_CORNERS.south, EDGE_CORNERS.north)) {
            const below = frameAt(other, phaseX, phaseY + 1);
            for (let x = 0; x < TILE_PX; x++) {
              jointDown = Math.max(
                jointDown,
                Math.abs(frame[(TILE_PX - 1) * TILE_PX + x] - below[x]),
              );
            }
          }
        }
      }
    }
  }

  const joint = Math.max(jointAcross, jointDown);
  const interior = Math.max(interiorAcross, interiorDown);
  const ratio = Math.max(jointAcross / interiorAcross, jointDown / interiorDown);
  return { joint, interior, ratio };
}

/**
 * The full mask set: every corner combination at every phase of the warp patch.
 *
 * Shipped as its own sheet rather than baked into per-pair transition tiles.
 * Baking would need one row per material pair *per patch phase*, which explodes
 * once materials are generated as multi-tile patches — and it would fix at build
 * time which pairs a level is allowed to blend. Compositing at load instead means
 * any material can meet any other, on any floor, at any patch alignment.
 *
 * Every frame shares one warp field. Two tiles either side of a boundary rarely
 * hold the same corner combination — a straight edge that turns a corner puts a
 * half mask next to a wedge — and the continuity argument above only holds while
 * both perturb their shared edge identically, which a per-combination seed does
 * not do: measured over every adjacent pair on both axes, one seed per mask tears
 * by the full alpha range.
 *
 * Frames are ordered combination-major, then row-major within the patch — the
 * convention the material sheets use, with the sixteen combinations in the role
 * of variants — so the frame for a dual cell at (cx, cy) is
 * `bits * MASK_PHASE_COUNT + (cy mod n) * n + (cx mod n)`.
 */
export function buildMaskSet(seedBase: number): Float64Array[] {
  const masks: Float64Array[] = [];
  for (let bits = 0; bits < CORNER_MASK_COUNT; bits++) {
    for (let phaseY = 0; phaseY < MASK_PATCH_TILES; phaseY++) {
      for (let phaseX = 0; phaseX < MASK_PATCH_TILES; phaseX++) {
        masks.push(buildCornerMask(bits, seedBase, phaseX, phaseY));
      }
    }
  }

  // The warp is centred, not symmetric, so the amplitude's headroom cannot be
  // derived — it has to be checked. A hole in the solid mask would show the
  // lower material through the middle of a region.
  const solidStart = CORNER_ALL * MASK_PHASE_COUNT;
  for (let phase = 0; phase < MASK_PHASE_COUNT; phase++) {
    const solid = masks[solidStart + phase];
    for (const alpha of solid) {
      if (alpha < SOLID_ALPHA) {
        throw new Error(
          `BOUNDARY_WARP_AMPLITUDE ${BOUNDARY_WARP_AMPLITUDE} punches holes in the solid mask`,
        );
      }
    }
    for (const alpha of masks[phase]) {
      if (alpha > 0) {
        throw new Error(
          `BOUNDARY_WARP_AMPLITUDE ${BOUNDARY_WARP_AMPLITUDE} leaks coverage into the empty mask`,
        );
      }
    }
  }

  return masks;
}
