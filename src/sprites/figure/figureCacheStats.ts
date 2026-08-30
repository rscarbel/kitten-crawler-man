/**
 * Counters for the figure frame cache, so its behaviour can be read off a
 * screen instead of inferred.
 *
 * Same shape and the same reasoning as the person cache's counters: the whole
 * argument for painting creatures instead of shipping their sheets turns on the
 * hit rate and the resident bytes, and neither is visible from inside the game.
 * Recording stays off unless a dev harness turns it on.
 */

/** Bytes in a megabyte, for readouts that report the cache's size. */
export const BYTES_PER_MEGABYTE = 1024 * 1024;

export interface FigureCacheStats {
  /** Cells served from a baked surface this frame. */
  hits: number;
  /** Cells asked for that were not baked yet. */
  misses: number;
  /** Cells actually baked this frame — a miss the admission policy allowed. */
  bakes: number;
  /** Cells baked ahead of their first use by a prewarm request. */
  prewarmBakes: number;
  /** Cells a miss could not bake, painted straight into the target instead. */
  directDraws: number;
  /** Animation rows dropped this frame to make room for another. */
  evictions: number;
  /** Animation rows dropped this frame simply for going long enough undrawn. */
  releases: number;
  /** Figures currently held. */
  figures: number;
  /** Animation rows currently held across all figures. */
  rows: number;
  /** Bytes of baked cell pixels currently held. */
  bytes: number;
}

const ZEROED: FigureCacheStats = {
  hits: 0,
  misses: 0,
  bakes: 0,
  prewarmBakes: 0,
  directDraws: 0,
  evictions: 0,
  releases: 0,
  figures: 0,
  rows: 0,
  bytes: 0,
};

let recording = false;
const live: FigureCacheStats = { ...ZEROED };

/** Turns recording on or off. Only a dev harness should ever call this. */
export function setFigureCacheStatsRecording(enabled: boolean): void {
  recording = enabled;
  if (!enabled) resetPerFrameCounts();
}

export function isFigureCacheStatsRecording(): boolean {
  return recording;
}

function resetPerFrameCounts(): void {
  live.hits = 0;
  live.misses = 0;
  live.bakes = 0;
  live.prewarmBakes = 0;
  live.directDraws = 0;
  live.evictions = 0;
  live.releases = 0;
}

/**
 * Clears the per-frame counters. The occupancy figures (`figures`, `rows`,
 * `bytes`) are levels rather than rates and survive the reset.
 */
export function beginFigureCacheStatsFrame(): void {
  if (!recording) return;
  resetPerFrameCounts();
}

export function recordFigureCacheHit(): void {
  if (recording) live.hits++;
}

export function recordFigureCacheMiss(): void {
  if (recording) live.misses++;
}

export function recordFigureCacheBake(): void {
  if (recording) live.bakes++;
}

export function recordFigureCachePrewarmBake(): void {
  if (recording) live.prewarmBakes++;
}

export function recordFigureCacheDirectDraw(): void {
  if (recording) live.directDraws++;
}

export function recordFigureCacheEviction(): void {
  if (recording) live.evictions++;
}

/**
 * Counted apart from an eviction on purpose: an eviction means the cache was
 * under pressure, and that is the number worth watching when deciding whether
 * the footprint still fits. A row dropped because its fight ended says nothing
 * about pressure and would drown the signal.
 */
export function recordFigureCacheRelease(): void {
  if (recording) live.releases++;
}

/** Publishes current occupancy; called wherever any of the three changes. */
export function recordFigureCacheOccupancy(figures: number, rows: number, bytes: number): void {
  if (!recording) return;
  live.figures = figures;
  live.rows = rows;
  live.bytes = bytes;
}

/** A snapshot of the counters. Copied, so a caller cannot hold a live view. */
export function getFigureCacheStats(): FigureCacheStats {
  return { ...live };
}
