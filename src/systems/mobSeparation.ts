/**
 * The push-apart force that keeps mobs from standing inside one another, and
 * the two ways of gathering it.
 *
 * Split out of `MobUpdateLoop` so the strategy that replaced the all-pairs loop
 * can be measured (`npm run bench:separation`) and checked against the loop it
 * replaced (`npm run verify:separation`) without standing up a scene. Written
 * against a structural `SeparationBody` rather than `Mob` for the same reason:
 * the harnesses need to place bodies at exact coordinates, which real mobs do
 * not let them do.
 */

import { TILE_SIZE } from '../core/constants';
import type { SeparationGrid } from '../core/SeparationGrid';
import { perfMonitor } from '../core/PerfMonitor';

/** Anything that takes part in separation: a position and a weight. */
export interface SeparationBody {
  readonly x: number;
  readonly y: number;
  readonly mass: number;
}

/**
 * Contact radius for push-apart: mobs closer than one tile are in each other's
 * way. `SeparationGrid` takes this as its `build` argument and sizes its cells
 * from what it is passed, so there is one definition and nothing to keep in step.
 */
export const SEPARATION_RADIUS = TILE_SIZE;
export const SEPARATION_RADIUS_SQ = SEPARATION_RADIUS * SEPARATION_RADIUS;

/** Fraction of the measured overlap a single frame corrects. */
const SEPARATION_BASE_MULTIPLIER = 0.3;

/**
 * Distance below which two bodies are treated as exactly coincident, leaving no
 * direction to push them apart along.
 */
export const SEPARATION_POSITION_TOLERANCE = 0;

/**
 * Overlap, in pixels, that is tolerated before anything is pushed at all.
 *
 * Without a deadband two mobs resting at exactly `SEPARATION_RADIUS` trade
 * sub-pixel corrections forever. Mobs settle a few pixels inside contact and
 * stay there.
 */
const SEPARATION_DEADBAND_PX = 3;

/**
 * Mobs in a pass at or above which separation switches from comparing all pairs
 * to building and querying a grid.
 *
 * Neither shape wins everywhere. The pair loop is a flat array walk over data it
 * already has, so while the roster is short its k²/2 comparisons cost less than
 * building an index does; past the crossover the quadratic term takes over while
 * the grid's cost tracks how tightly mobs are actually packed. `bench-separation`
 * puts that crossover between 32 and 64 mobs depending on crowding, so this sits
 * in the middle of that band: below it the two shapes are within a microsecond
 * of each other either way, and above it the gap grows without limit — 3x by 192
 * mobs, and still widening.
 */
export const SEPARATION_GRID_MIN_MOBS = 48;

/**
 * Push scale for two bodies `distSq` apart (squared, to keep the square root
 * off the overwhelming majority of candidates that are out of range), or 0 when
 * they are not overlapping enough to be pushed at all.
 *
 * Multiply by the separation vector and by the pushed body's share of the
 * pair's mass to get its displacement. Shared by both strategies below so they
 * cannot drift into computing different forces.
 */
export function separationPushScale(distSq: number): number {
  if (distSq >= SEPARATION_RADIUS_SQ) return 0;
  const dist = Math.sqrt(distSq);
  if (dist <= SEPARATION_POSITION_TOLERANCE) return 0;
  const overlap = SEPARATION_RADIUS - dist - SEPARATION_DEADBAND_PX;
  if (overlap <= 0) return 0;
  return (overlap * SEPARATION_BASE_MULTIPLIER) / dist;
}

/**
 * Every pair of `bodies` compared once, each comparison pushing both of its
 * members. Forces are added to `outDx`/`outDy`, which the caller sizes and
 * zeroes.
 *
 * The shape the separation pass had before the fine grid existed, kept for
 * short rosters where its flat array walk still beats a hashed neighbour query.
 */
export function accumulateFromAllPairs(
  bodies: readonly SeparationBody[],
  outDx: number[],
  outDy: number[],
): void {
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const scale = separationPushScale(dx * dx + dy * dy);
      if (scale === 0) continue;
      const totalMass = a.mass + b.mass;
      // Heavier body moves less — force is proportional to the other's share of total mass.
      const aShare = b.mass / totalMass;
      const bShare = a.mass / totalMass;
      outDx[i] += dx * scale * aShare;
      outDy[i] += dy * scale * aShare;
      outDx[j] -= dx * scale * bShare;
      outDy[j] -= dy * scale * bShare;
    }
  }
  const comparisons = (bodies.length * (bodies.length - 1)) / 2;
  perfMonitor.count('separationChecks', comparisons);
}

/**
 * The same forces as {@link accumulateFromAllPairs}, gathered per body from a
 * grid of the roster rather than by comparing every pair.
 *
 * Each body is pushed only by what its own lookup found, so a pair is evaluated
 * from both sides instead of once from one — twice the force arithmetic for a
 * pair actually in contact, against a candidate count that stops growing with
 * the roster and starts tracking how tightly bodies are physically packed. The
 * two sides agree because the force is antisymmetric in the separation vector
 * and each body's share of the pair's mass is the *other* body's mass: read
 * from b, `dx` flips sign and the share becomes a's, which is exactly the term
 * the all-pairs loop subtracts from b.
 *
 * `grid` must have been built from `bodies` this frame.
 */
export function accumulateFromGrid<T extends SeparationBody>(
  bodies: readonly T[],
  outDx: number[],
  outDy: number[],
  grid: SeparationGrid<T>,
): void {
  let comparisons = 0;
  const candidates = grid.candidates;
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    const candidateCount = grid.collectCandidates(i);
    comparisons += candidateCount;
    let pushX = 0;
    let pushY = 0;
    for (let c = 0; c < candidateCount; c++) {
      const b = bodies[candidates[c]];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const scale = separationPushScale(dx * dx + dy * dy);
      if (scale === 0) continue;
      const aShare = b.mass / (a.mass + b.mass);
      pushX += dx * scale * aShare;
      pushY += dy * scale * aShare;
    }
    outDx[i] += pushX;
    outDy[i] += pushY;
  }
  perfMonitor.count('separationChecks', comparisons);
}

/**
 * Gathers separation forces with whichever strategy suits the roster's size.
 * The two produce the same forces; only their cost curves differ.
 */
export function accumulateSeparationForces<T extends SeparationBody>(
  bodies: readonly T[],
  outDx: number[],
  outDy: number[],
  grid: SeparationGrid<T>,
): void {
  perfMonitor.count('separationMobs', bodies.length);
  if (bodies.length < SEPARATION_GRID_MIN_MOBS) {
    accumulateFromAllPairs(bodies, outDx, outDy);
    return;
  }
  grid.build(bodies, SEPARATION_RADIUS);
  accumulateFromGrid(bodies, outDx, outDy, grid);
}
