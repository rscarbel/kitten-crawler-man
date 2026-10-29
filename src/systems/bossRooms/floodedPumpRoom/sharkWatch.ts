import { TILE_SIZE } from '../../../core/constants';
import type { WorldRect } from '../../../core/rendering/worldRect';
import { allPlatforms, platformShark, type FloodedPumpRoomLayout } from '../floodedPumpRoomLayout';
import type { PlatformId } from './platforms';

/** Room kept in view past the loop's outermost points: the fin's own art and a little water beyond. */
const WATCH_MARGIN_TILES = 1.5;

/**
 * The world rect a crawler on `platform` has to see to time a hop: the whole
 * of the shark's loop round it and the platform itself, with a margin for the
 * fin's art. It depends only on the platform, so it changes only when the
 * loop the shark guards does.
 */
export function sharkWatchRect(layout: FloodedPumpRoomLayout, platform: PlatformId): WorldRect {
  const { loop } = platformShark(layout, platform);
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const point of loop.points) {
    left = Math.min(left, point.x);
    top = Math.min(top, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }
  const standing = allPlatforms(layout).find((candidate) => candidate.id === platform);
  if (standing !== undefined) {
    const { rect } = standing;
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.w);
    bottom = Math.max(bottom, rect.y + rect.h);
  }
  return {
    left: (left - WATCH_MARGIN_TILES) * TILE_SIZE,
    top: (top - WATCH_MARGIN_TILES) * TILE_SIZE,
    right: (right + WATCH_MARGIN_TILES) * TILE_SIZE,
    bottom: (bottom + WATCH_MARGIN_TILES) * TILE_SIZE,
  };
}
