/**
 * Counters for the person frame cache, so its behaviour can be read off a
 * screen instead of inferred.
 *
 * The whole performance argument for the crowd turns on one number — the cache
 * hit rate — and that number is invisible from inside the game. Recording is
 * off unless a dev harness turns it on: the counters themselves are integer
 * adds, but leaving a diagnostic live in a shipped build is how diagnostics
 * become permanent.
 */

/** Bytes in a megabyte, for readouts that report the cache's size. */
export const BYTES_PER_MEGABYTE = 1024 * 1024;

export interface PersonCacheStats {
  /** Cells served from a baked surface this frame. */
  hits: number;
  /** Cells asked for that were not baked yet. */
  misses: number;
  /** Cells actually baked this frame — a miss the admission policy allowed. */
  bakes: number;
  /** Cells a miss could not bake, drawn straight through `drawPerson` instead. */
  directDraws: number;
  /** Whole people dropped this frame to make room for someone else. */
  evictions: number;
  /** Whole people dropped this frame simply for going long enough undrawn. */
  releases: number;
  /** People currently held. */
  people: number;
  /** Bytes of baked cell pixels currently held. */
  bytes: number;
}

const ZEROED: PersonCacheStats = {
  hits: 0,
  misses: 0,
  bakes: 0,
  directDraws: 0,
  evictions: 0,
  releases: 0,
  people: 0,
  bytes: 0,
};

let recording = false;
const live: PersonCacheStats = { ...ZEROED };

/** Turns recording on or off. Only a dev harness should ever call this. */
export function setPersonCacheStatsRecording(enabled: boolean): void {
  recording = enabled;
  if (!enabled) resetPerFrameCounts();
}

function resetPerFrameCounts(): void {
  live.hits = 0;
  live.misses = 0;
  live.bakes = 0;
  live.directDraws = 0;
  live.evictions = 0;
  live.releases = 0;
}

/**
 * Clears the per-frame counters. The occupancy figures (`people`, `bytes`) are
 * levels rather than rates and survive the reset.
 */
export function beginPersonCacheStatsFrame(): void {
  if (!recording) return;
  resetPerFrameCounts();
}

export function recordPersonCacheHit(): void {
  if (recording) live.hits++;
}

export function recordPersonCacheMiss(): void {
  if (recording) live.misses++;
}

export function recordPersonCacheBake(): void {
  if (recording) live.bakes++;
}

export function recordPersonCacheDirectDraw(): void {
  if (recording) live.directDraws++;
}

export function recordPersonCacheEviction(): void {
  if (recording) live.evictions++;
}

/**
 * Counted apart from an eviction on purpose: an eviction means the cache was
 * under pressure, and that is the number a later session is told to watch when
 * deciding whether the footprint still fits. A citizen dropped for walking out
 * of the scene says nothing about pressure and would drown the signal.
 */
export function recordPersonCacheRelease(): void {
  if (recording) live.releases++;
}

/** Publishes the cache's current occupancy; called wherever either one changes. */
export function recordPersonCacheOccupancy(people: number, bytes: number): void {
  if (!recording) return;
  live.people = people;
  live.bytes = bytes;
}

/** A snapshot of the counters. Copied, so a caller cannot hold a live view. */
export function getPersonCacheStats(): PersonCacheStats {
  return { ...live };
}
