/**
 * Deterministic seeded randomness for procedural people. A person's entire
 * appearance is derived from one integer seed, so the same seed must always
 * yield the same person across sessions and machines — `Math.random` can't do
 * that. `mulberry32` is a tiny, well-distributed 32-bit PRNG whose stream we
 * draw from once per feature; unlike a modulo hash it stays uniform across the
 * dozens of independent draws a single person needs.
 */

export type Rng = () => number;

const UINT32 = 0x100000000;
const MULBERRY_INC = 0x6d2b79f5;
const MIX_1 = 0x85ebca6b;
const MIX_2 = 0xc2b2ae35;

/** Returns a PRNG producing floats in [0, 1) seeded by `seed`. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + MULBERRY_INC) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32;
  };
}

/** Uniform float in [min, max). */
export function range(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** Uniform integer in [min, max] inclusive. */
export function rangeInt(rng: Rng, min: number, max: number): number {
  return Math.floor(range(rng, min, max + 1));
}

/** A uniformly chosen element of `pool`. */
export function pick<T>(rng: Rng, pool: ReadonlyArray<T>): T {
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}

/** True with probability `p` (0..1). */
export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}

/**
 * Bell-ish value in [min, max] biased toward the middle (average of two draws).
 * Used for body/face proportions so most people cluster near average and
 * extremes are rare, the way a real crowd looks.
 */
export function centered(rng: Rng, min: number, max: number): number {
  return min + ((rng() + rng()) / 2) * (max - min);
}

/** Derives an independent sub-seed so callers can fork a stable stream. */
export function subSeed(seed: number, salt: number): number {
  let h = (seed ^ Math.imul(salt + 1, MULBERRY_INC)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), MIX_1) >>> 0;
  h = Math.imul(h ^ (h >>> 16), MIX_2) >>> 0;
  return h >>> 0;
}
