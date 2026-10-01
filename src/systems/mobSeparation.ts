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
  /**
   * Held where it stands (a rooted mob): it takes none of a push, and whatever
   * it overlaps takes all of it, so the two still come apart.
   */
  readonly separationAnchored?: boolean;
  /**
   * How far from its position this body keeps others; absent means
   * {@link SEPARATION_RADIUS}. Only a body whose drawn footprint is wider than
   * a tile sets it.
   */
  readonly collisionRadiusPx?: number;
  /**
   * Comes up to the ordinary one-tile contact even against a wider body. A
   * party companion's blows are measured centre to centre and reach barely a
   * tile, so holding it out at a wide body's radius would leave it swinging at
   * air; it still cannot walk through the body or move an anchored one.
   */
  readonly closesToOrdinaryContact?: boolean;
}

/**
 * The share of a pair's push that `self` takes: the other body's share of the
 * pair's mass, so the heavier moves less — all of it against an anchored body,
 * none of it when `self` is the anchored one.
 */
function pushShare(self: SeparationBody, other: SeparationBody): number {
  if (self.separationAnchored === true) return 0;
  if (other.separationAnchored === true) return 1;
  return other.mass / (self.mass + other.mass);
}

/**
 * Contact radius for push-apart between two ordinary bodies: mobs closer than
 * one tile are in each other's way. A body wider than that says so through
 * `SeparationBody.collisionRadiusPx`. `SeparationGrid` takes the widest radius
 * in play as its `build` argument and sizes its cells from what it is passed,
 * so there is one definition and nothing to keep in step.
 */
export const SEPARATION_RADIUS = TILE_SIZE;

/**
 * How close two bodies may come before they are pushed apart: the larger of
 * their two collision radii.
 *
 * The larger rather than the sum, because every body's radius is measured
 * centre to centre against an ordinary one-tile neighbour — `SEPARATION_RADIUS`
 * is already a whole contact distance, not half of one. A wide body therefore
 * keeps everything out to its own radius, and two ordinary bodies keep exactly
 * one tile apart.
 */
export function pairContactRadius(radiusA: number, radiusB: number): number {
  return radiusA > radiusB ? radiusA : radiusB;
}

function contactRadiusOf(a: SeparationBody, b: SeparationBody): number {
  if (a.closesToOrdinaryContact === true || b.closesToOrdinaryContact === true) {
    return SEPARATION_RADIUS;
  }
  return pairContactRadius(
    a.collisionRadiusPx ?? SEPARATION_RADIUS,
    b.collisionRadiusPx ?? SEPARATION_RADIUS,
  );
}

/**
 * The widest contact distance any pair among `bodies` can have. Read once per
 * pass so that a roster of ordinary bodies — nearly every pass — skips the
 * per-pair radius lookup entirely.
 */
function widestContactRadius(bodies: readonly SeparationBody[]): number {
  let widest = SEPARATION_RADIUS;
  for (const body of bodies) {
    const radius = body.collisionRadiusPx ?? SEPARATION_RADIUS;
    if (radius > widest) widest = radius;
  }
  return widest;
}

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
 * off the overwhelming majority of candidates that are out of range) whose
 * contact distance is `contactRadius`, or 0 when they are not overlapping
 * enough to be pushed at all.
 *
 * Multiply by the separation vector and by the pushed body's share of the
 * pair's mass to get its displacement. Shared by both strategies below so they
 * cannot drift into computing different forces.
 */
export function separationPushScale(
  distSq: number,
  contactRadius: number = SEPARATION_RADIUS,
): number {
  if (distSq >= contactRadius * contactRadius) return 0;
  const dist = Math.sqrt(distSq);
  if (dist <= SEPARATION_POSITION_TOLERANCE) return 0;
  const overlap = contactRadius - dist - SEPARATION_DEADBAND_PX;
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
  widestRadius: number = widestContactRadius(bodies),
): void {
  const everyPairIsOrdinary = widestRadius === SEPARATION_RADIUS;
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const contactRadius = everyPairIsOrdinary ? SEPARATION_RADIUS : contactRadiusOf(a, b);
      const scale = separationPushScale(dx * dx + dy * dy, contactRadius);
      if (scale === 0) continue;
      const aShare = pushShare(a, b);
      const bShare = pushShare(b, a);
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
 * `grid` must have been built from `bodies` this frame, out to the widest
 * contact radius among them, or a wide body's lookup misses what it touches.
 */
export function accumulateFromGrid<T extends SeparationBody>(
  bodies: readonly T[],
  outDx: number[],
  outDy: number[],
  grid: SeparationGrid<T>,
  widestRadius: number = widestContactRadius(bodies),
): void {
  const everyPairIsOrdinary = widestRadius === SEPARATION_RADIUS;
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
      const contactRadius = everyPairIsOrdinary ? SEPARATION_RADIUS : contactRadiusOf(a, b);
      const scale = separationPushScale(dx * dx + dy * dy, contactRadius);
      if (scale === 0) continue;
      const aShare = pushShare(a, b);
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
  const widestRadius = widestContactRadius(bodies);
  if (bodies.length < SEPARATION_GRID_MIN_MOBS) {
    accumulateFromAllPairs(bodies, outDx, outDy, widestRadius);
    return;
  }
  grid.build(bodies, widestRadius);
  accumulateFromGrid(bodies, outDx, outDy, grid, widestRadius);
}
