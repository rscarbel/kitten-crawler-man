import type { GameMap } from './GameMap';

/**
 * Finds the walkable tile nearest to the requested tile, scanning outward in
 * square rings (Chebyshev distance) up to `maxRadiusTiles`. Returns null when
 * no walkable tile exists within range — callers should skip the spawn.
 *
 * Quest systems place mobs at fixed offsets from landmarks (e.g. the circus
 * centre); those offsets can land inside tent/building footprints depending on
 * procedural generation, so every scripted spawn must be validated through
 * this helper.
 */
export function findNearbyWalkableTile(
  map: GameMap,
  tileX: number,
  tileY: number,
  maxRadiusTiles: number,
): { x: number; y: number } | null {
  if (map.isWalkable(tileX, tileY)) return { x: tileX, y: tileY };

  for (let radius = 1; radius <= maxRadiusTiles; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const onRing = Math.max(Math.abs(dx), Math.abs(dy)) === radius;
        if (!onRing) continue;
        const x = tileX + dx;
        const y = tileY + dy;
        if (map.isWalkable(x, y)) return { x, y };
      }
    }
  }
  return null;
}
