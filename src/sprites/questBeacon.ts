/**
 * The column of light standing over anyone worth talking to.
 *
 * The overhead `!`/`?` glyph is one head tall. Across the town plaza — sixty
 * tiles of cobble, stalls, bunting, lamps and townsfolk — it is a speck, and a
 * playtester who cannot find the quest giver never starts the quest. A beam is
 * the one thing on the map that reads from further away than the thing it marks.
 *
 * **Drawn by the creature, not by the map.** A beacon has to follow Signet, who
 * walks, so a decoration tile is out; and drawing it behind the body paint in
 * the creature's own render is what gets it Y-sorted with the figure it belongs
 * to for free, rather than as a stripe painted over everything in the overlay
 * pass.
 */

import { drawLightBeam } from './lightBeam';

/** How tall the beam stands above the marked figure's tile, in tiles. */
const BEACON_HEIGHT_TILES = 3.6;
/** The width of lit body the figure stands inside, as a fraction of a tile. */
const BEACON_COVER_WIDTH_FRACTION = 1;
/** The beam's strength at full distance; the shimmer rides on top of it. */
const BEACON_STRENGTH = 0.9;

/**
 * Inside this many tiles of the viewer the beam fades out.
 *
 * Its job is done once the player is standing at the NPC: at conversation range
 * a full-strength column of light sits between the camera and the face that is
 * talking, and during a fight around a marked NPC it is a bar across the middle
 * of the screen.
 */
const BEACON_NEAR_FADE_TILES = 2.2;
/** Beyond this the beam is at full strength; between the two it ramps. */
const BEACON_FULL_STRENGTH_TILES = 4;

/**
 * The active player's position in world pixels, set once per rendered frame.
 *
 * A module-level viewer rather than a parameter threaded through four unrelated
 * creature classes, in the same shape as `setButtonMouseState`: every beacon in
 * a frame fades against the same player, and none of the creatures that draw one
 * otherwise has any business holding a reference to them.
 */
let viewerX = 0;
let viewerY = 0;

/** Call once per rendered frame, before anything draws a beacon. */
export function setQuestBeaconViewer(x: number, y: number): void {
  viewerX = x;
  viewerY = y;
}

function nearnessFade(
  sx: number,
  sy: number,
  tileSize: number,
  camX: number,
  camY: number,
): number {
  const distanceTiles = Math.hypot(sx + camX - viewerX, sy + camY - viewerY) / tileSize;
  if (distanceTiles >= BEACON_FULL_STRENGTH_TILES) return 1;
  if (distanceTiles <= BEACON_NEAR_FADE_TILES) return 0;
  return (
    (distanceTiles - BEACON_NEAR_FADE_TILES) / (BEACON_FULL_STRENGTH_TILES - BEACON_NEAR_FADE_TILES)
  );
}

/**
 * Draws the beacon for a figure whose tile's top-left corner is at screen
 * (`sx`, `sy`).
 *
 * `camX`/`camY` are needed only to turn that screen position back into a world
 * one for the distance fade — the beam itself is drawn entirely in screen space.
 *
 * Call this *before* the figure's own body paint, so the beam stands behind
 * them rather than across their face.
 */
export function drawQuestBeacon(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  camX: number,
  camY: number,
  timeMs: number,
  color: string,
): void {
  const fade = nearnessFade(sx, sy, tileSize, camX, camY);
  if (fade <= 0) return;
  drawLightBeam(ctx, {
    centreX: sx + tileSize / 2,
    groundY: sy + tileSize,
    coverWidth: tileSize * BEACON_COVER_WIDTH_FRACTION,
    height: tileSize * BEACON_HEIGHT_TILES,
    color,
    strength: BEACON_STRENGTH * fade,
    timeMs,
  });
}
