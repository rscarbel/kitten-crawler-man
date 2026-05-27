import { TILE_SIZE } from '../core/constants';

// Arrow geometry ratios (arrow points right along +x; rotated to face target)
const ARROW_HEAD_HALF_WIDTH_RATIO = 0.45;
const ARROW_HEAD_HEIGHT_RATIO = 0.5;
const ARROW_TAIL_NOTCH_RATIO = 0.1;

// Animation
const ARROW_BOUNCE_FREQUENCY = 0.005;
const ARROW_BOUNCE_AMPLITUDE = 4;

// Sizing
const ARROW_LENGTH_PIXELS = 22;
const ARROW_LINE_WIDTH = 1.5;

/** Tiles above the player's tile origin where the arrow is drawn. */
const ARROW_VERTICAL_OFFSET_TILES = 1.5;

/**
 * Draws a directional arrow above the active player pointing toward a world-space target.
 *
 * Mirrors the stairwell-reveal arrow pattern in DungeonScene so it can be reused
 * in TutorialController, DungeonScene, and any future system that needs a world-space
 * objective indicator.
 *
 * @param playerWorldX - Player's pixel X (top-left of tile)
 * @param playerWorldY - Player's pixel Y (top-left of tile)
 * @param targetWorldX - Target's pixel X center
 * @param targetWorldY - Target's pixel Y center
 * @param camX - Camera scroll X
 * @param camY - Camera scroll Y
 * @param color - Arrow fill color (e.g. '#facc15')
 * @param outlineColor - Arrow stroke color (e.g. '#000')
 */
export function drawArrowAbovePlayer(
  ctx: CanvasRenderingContext2D,
  playerWorldX: number,
  playerWorldY: number,
  targetWorldX: number,
  targetWorldY: number,
  camX: number,
  camY: number,
  color: string,
  outlineColor = '#000',
): void {
  const playerCenterX = playerWorldX + TILE_SIZE / 2;
  const playerCenterY = playerWorldY + TILE_SIZE / 2;

  const dx = targetWorldX - playerCenterX;
  const dy = targetWorldY - playerCenterY;
  const angle = Math.atan2(dy, dx);

  const bounce = Math.sin(Date.now() * ARROW_BOUNCE_FREQUENCY) * ARROW_BOUNCE_AMPLITUDE;
  const screenX = playerWorldX - camX + TILE_SIZE / 2;
  const screenY = playerWorldY - camY - TILE_SIZE * ARROW_VERTICAL_OFFSET_TILES + bounce;
  const len = ARROW_LENGTH_PIXELS;

  ctx.save();
  ctx.translate(screenX, screenY);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.strokeStyle = outlineColor;
  ctx.lineWidth = ARROW_LINE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(len, 0);
  ctx.lineTo(-len * ARROW_HEAD_HALF_WIDTH_RATIO, -len * ARROW_HEAD_HEIGHT_RATIO);
  ctx.lineTo(-len * ARROW_TAIL_NOTCH_RATIO, 0);
  ctx.lineTo(-len * ARROW_HEAD_HALF_WIDTH_RATIO, len * ARROW_HEAD_HEIGHT_RATIO);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/**
 * Draws a downward-pointing bouncing arrow directly above a world-space entity.
 * Use for fixed "attack this target" indicators rather than directional navigation.
 *
 * @param worldX - Entity's pixel X (top-left of tile)
 * @param worldY - Entity's pixel Y (top-left of tile)
 * @param camX - Camera scroll X
 * @param camY - Camera scroll Y
 * @param color - Arrow fill color
 * @param outlineColor - Arrow stroke color
 */
export function drawBouncingArrowAboveEntity(
  ctx: CanvasRenderingContext2D,
  worldX: number,
  worldY: number,
  camX: number,
  camY: number,
  color: string,
  outlineColor = '#000',
): void {
  const screenX = worldX - camX + TILE_SIZE / 2;
  const screenY = worldY - camY - TILE_SIZE * ARROW_VERTICAL_OFFSET_TILES;
  const bounce = Math.sin(Date.now() * ARROW_BOUNCE_FREQUENCY) * ARROW_BOUNCE_AMPLITUDE;
  const len = ARROW_LENGTH_PIXELS;

  ctx.save();
  ctx.translate(screenX, screenY + bounce);
  // Rotate 90° so the right-pointing arrow shape becomes downward-pointing
  ctx.rotate(Math.PI / 2);
  ctx.fillStyle = color;
  ctx.strokeStyle = outlineColor;
  ctx.lineWidth = ARROW_LINE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(len, 0);
  ctx.lineTo(-len * ARROW_HEAD_HALF_WIDTH_RATIO, -len * ARROW_HEAD_HEIGHT_RATIO);
  ctx.lineTo(-len * ARROW_TAIL_NOTCH_RATIO, 0);
  ctx.lineTo(-len * ARROW_HEAD_HALF_WIDTH_RATIO, len * ARROW_HEAD_HEIGHT_RATIO);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
