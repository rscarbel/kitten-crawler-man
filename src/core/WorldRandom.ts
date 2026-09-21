import { mulberry32, type Rng } from '../sprites/person/rng';

const SEED_SPACE = 0x100000000;

let activeRng: Rng | null = null;

/**
 * The random source for anything that shapes a floor's layout.
 *
 * Outside {@link withWorldSeed} it is plain `Math.random`, so gameplay rolls that
 * happen to share a helper (`randomInt`) stay unpredictable. Inside it, the same
 * seed replays the same stream, which is what lets a save rebuild the floor the
 * player left rather than a fresh one.
 */
export function worldRandom(): number {
  return activeRng === null ? Math.random() : activeRng();
}

/** A fresh seed for a floor that has none yet. */
export function drawWorldSeed(): number {
  return Math.floor(Math.random() * SEED_SPACE);
}

/**
 * Runs `build` with {@link worldRandom} replaying `seed`'s stream, restoring the
 * previous source afterwards even if `build` throws — a leaked seeded stream
 * would make every later `randomInt` in the session deterministic.
 */
export function withWorldSeed<T>(seed: number, build: () => T): T {
  const previous = activeRng;
  activeRng = mulberry32(seed);
  try {
    return build();
  } finally {
    activeRng = previous;
  }
}
