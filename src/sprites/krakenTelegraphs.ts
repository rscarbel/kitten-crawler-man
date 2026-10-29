/**
 * The Kraken fight's ground warnings: the ring her ground slam lands in and the
 * square of tiles a raft or pump tentacle's slam covers.
 *
 * Drawn at runtime rather than baked, because each one has to sit exactly on
 * the ground it will hurt: the ring's radius is the slam's kill radius and the
 * square is the tentacle's own footprint. Both are the game's red ground
 * warnings (`dangerTelegraph.ts`).
 */

import type { TileRect } from '../systems/bossRooms/bossRoomLayout';
import { drawDangerCircle, drawDangerRegion, type DangerTile } from './dangerTelegraph';
import { KRAKEN_SLAM_RADIUS_TILES } from './krakenSprite';

/** How strongly a slam warning shows on the frame it appears, before its windup brightens it. */
const SLAM_WARNING_FADE_START = 0.55;
const SLAM_WARNING_FADE_GROWTH = 1 - SLAM_WARNING_FADE_START;

function slamWarningFade(progress: number): number {
  return Math.min(1, SLAM_WARNING_FADE_START + progress * SLAM_WARNING_FADE_GROWTH);
}

/**
 * The ground slam's warning: a red ring at exactly the kill radius whose fill
 * grows to meet it on the impact frame.
 *
 * The outline locks while the tentacle dives: the dive is the moment it goes
 * under, and the ring is where it comes back up, so the warning saying "the aim
 * is fixed" exactly then makes the two read as one movement.
 *
 * @param progress 0–1 through the telegraph window, 1 being the impact frame.
 * @param diveProgress 0–1 through the tentacle's dive, 0 whenever it is not diving.
 */
export function drawSlamShadow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tileSize: number,
  progress: number,
  diveProgress = 0,
): void {
  const radius = tileSize * KRAKEN_SLAM_RADIUS_TILES;
  const isDiving = diveProgress > 0;
  drawDangerCircle(ctx, x, y, radius, slamWarningFade(progress), {
    fillProgress: progress,
    locked: isDiving,
  });
}

/**
 * A raft or pump tentacle's slam warning over the tiles it covers, the fill
 * growing from the footprint's middle to cover it all on the impact frame.
 * The footprint is fixed the moment it appears, so its outline is locked.
 *
 * @param progress 0–1 through the telegraph window, 1 being the impact frame.
 */
export function drawSlamFootprint(
  ctx: CanvasRenderingContext2D,
  footprint: Readonly<TileRect>,
  tileSize: number,
  camX: number,
  camY: number,
  progress: number,
): void {
  const tiles: DangerTile[] = [];
  for (let dy = 0; dy < footprint.h; dy++) {
    for (let dx = 0; dx < footprint.w; dx++) {
      tiles.push({ x: footprint.x + dx, y: footprint.y + dy });
    }
  }
  drawDangerRegion(ctx, tiles, tileSize, camX, camY, slamWarningFade(progress), {
    fillProgress: progress,
    locked: true,
  });
}
