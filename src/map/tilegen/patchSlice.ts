/**
 * Cutting generated patches into tiles, and measuring whether the cut is
 * seamless.
 *
 * Pure `Surface` math with no canvas and no filesystem, so the runtime painter
 * (`src/map/ground/runtimeGroundSheets.ts`) and the offline bakers and gates in
 * `scripts/` all slice and measure identically. `scripts/tilegen/sheet.ts` keeps
 * the node-canvas and file-writing half.
 */

import { Surface, TILE_PX } from './raster';
import { SEAMLESS_RATIO_LIMIT } from './seamLimits';

/**
 * Cuts a patch into its constituent tiles, row-major. The tiles are seamless
 * against each other in the patch's own arrangement, and the patch as a whole
 * wraps — so laying patches edge to edge is seamless too.
 */
export function slicePatch(patch: Surface): Surface[] {
  const tilesAcross = patch.size / TILE_PX;
  const tiles: Surface[] = [];
  for (let ty = 0; ty < tilesAcross; ty++) {
    for (let tx = 0; tx < tilesAcross; tx++) {
      const tile = new Surface(TILE_PX);
      tile.fill((x, y) => patch.get(tx * TILE_PX + x, ty * TILE_PX + y));
      tiles.push(tile);
    }
  }
  return tiles;
}

export interface WrapReport {
  readonly horizontal: number;
  readonly vertical: number;
  readonly interiorHorizontal: number;
  readonly interiorVertical: number;
  /** The single hardest internal cut on each axis — the literal "anything else". */
  readonly strongestHorizontal: number;
  readonly strongestVertical: number;
  /**
   * Joint difference as a multiple of the patch's own strongest internal edges.
   * Below 1 the joint is no sharper than edges the material legitimately
   * contains; above 1 it is the hardest line in the patch, which is what the eye
   * locks onto as a grid.
   */
  readonly ratio: number;
}

function channelDiff(a: readonly number[], b: readonly number[]): number {
  return (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3;
}

const INTERIOR_PERCENTILE = 0.95;

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
}

/**
 * Compares a patch's wrap joints against the strongest edges inside it.
 *
 * Neither absolute difference nor mean interior adjacency is the right yardstick:
 * a structured material *should* have a hard line where two slabs meet, and its
 * patch edge may land on one. What reads as a seam is a joint sharper than
 * anything else in the material, so that is what this measures.
 */
export function measureWrapError(surface: Surface): WrapReport {
  const size = surface.size;
  let horizontal = 0;
  let vertical = 0;
  for (let i = 0; i < size; i++) {
    horizontal += channelDiff(surface.get(size - 1, i), surface.get(0, i));
    vertical += channelDiff(surface.get(i, size - 1), surface.get(i, 0));
  }
  horizontal /= size;
  vertical /= size;

  const columnCuts: number[] = [];
  const rowCuts: number[] = [];
  for (let cut = 0; cut < size - 1; cut++) {
    let columnSum = 0;
    let rowSum = 0;
    for (let i = 0; i < size; i++) {
      columnSum += channelDiff(surface.get(cut, i), surface.get(cut + 1, i));
      rowSum += channelDiff(surface.get(i, cut), surface.get(i, cut + 1));
    }
    columnCuts.push(columnSum / size);
    rowCuts.push(rowSum / size);
  }

  const interiorHorizontal = percentile(columnCuts, INTERIOR_PERCENTILE);
  const interiorVertical = percentile(rowCuts, INTERIOR_PERCENTILE);

  return {
    horizontal,
    vertical,
    interiorHorizontal,
    interiorVertical,
    strongestHorizontal: Math.max(...columnCuts),
    strongestVertical: Math.max(...rowCuts),
    ratio: Math.max(
      horizontal / Math.max(interiorHorizontal, 1),
      vertical / Math.max(interiorVertical, 1),
    ),
  };
}

function axisTears(joint: number, interior: number, strongest: number): boolean {
  if (joint / Math.max(interior, 1) <= SEAMLESS_RATIO_LIMIT) return false;
  // The percentile is a stand-in for "anything else in the material", and it
  // undercounts a material whose hard lines are a sparse grid: a four-cell patch
  // has three internal cell boundaries per axis, barely one percent of its cuts,
  // so the 95th percentile lands in the soft interior of a tile and calls a
  // grout line running along the joint a tear. When the stand-in fires, the
  // literal criterion decides — and a joint no harder than the hardest line the
  // patch already contains is a line the material legitimately has, not a seam.
  return joint > strongest;
}

/**
 * Whether a patch's wrap joint reads as a seam.
 *
 * The one place the two seam criteria are combined, so the review baker and the
 * seed sweep can never disagree about what a tear is.
 */
export function patchTears(report: WrapReport): boolean {
  return (
    axisTears(report.horizontal, report.interiorHorizontal, report.strongestHorizontal) ||
    axisTears(report.vertical, report.interiorVertical, report.strongestVertical)
  );
}
