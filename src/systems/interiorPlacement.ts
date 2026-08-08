/**
 * The one thing `InteriorOccupantSystem` and `InteriorReadableSystem` have to
 * agree on: where in a list of furniture tiles to start looking.
 *
 * Both walk the finished grid row-major from `(1,1)` and both take the first
 * match, so left alone they put the building's marquee NPC and its readable
 * against the north-westmost matching tile — in every room in town. Nothing
 * chose that; it fell out of scan order.
 *
 * The offset is derived from the building's name rather than drawn at random,
 * because `verify:interiors` builds these rooms headlessly and a placement that
 * moves between runs is a gate that cannot say what it measured.
 */

const NAME_HASH_SEED = 2166136261;
const NAME_HASH_PRIME = 16777619;

/**
 * FNV-1a over the building's name — stable across runs, machines and builds.
 *
 * The multiply has to be `Math.imul`: a plain `*` on a 32-bit accumulator
 * overflows `Number.MAX_SAFE_INTEGER`, and the float result silently zeroes its
 * low bits, so every name ends up congruent to 0 for the small moduli callers
 * take.
 */
function hashBuildingName(name: string): number {
  let hash = NAME_HASH_SEED;
  for (let i = 0; i < name.length; i++) {
    hash = Math.imul(hash ^ name.charCodeAt(i), NAME_HASH_PRIME);
  }
  return hash >>> 0;
}

/**
 * Where in an anchor group of `groupLength` tiles this building starts its
 * search. Returns 0 for an empty group, so a caller can index without a guard.
 */
export function anchorCursorForBuilding(name: string, groupLength: number): number {
  if (groupLength <= 0) return 0;
  return hashBuildingName(name) % groupLength;
}
