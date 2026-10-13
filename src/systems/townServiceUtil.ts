/**
 * Rotates a town service's line pool by how many times the player has talked
 * to someone.
 */

/**
 * Deterministically pick from a pool, advancing with each conversation so
 * repeats vary. Negative-safe, so a caller may pass any turn count, and
 * empty-safe, so a pool that loses its last line degrades to silence rather
 * than to the word "undefined".
 */
export function rotateLine(pool: ReadonlyArray<string>, turn: number): string {
  // An empty pool would make the modulo NaN and hand back `undefined` under a
  // `string` signature — which surfaces as the literal word "undefined" in an
  // NPC's mouth rather than as an error anybody would notice.
  if (pool.length === 0) return '';
  const index = ((turn % pool.length) + pool.length) % pool.length;
  return pool[index] ?? '';
}
