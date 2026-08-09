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

/** Gap kept between an arrow pushed clear of an avoid rect and that rect's edge. */
const ARROW_AVOID_RECT_CLEARANCE = 6;

/** Half-width of the arrow's on-screen footprint, for the avoid-rect overlap test. */
const ARROW_FOOTPRINT_HALF_WIDTH = ARROW_LENGTH_PIXELS + ARROW_BOUNCE_AMPLITUDE;

/** A screen-space rect the arrow must not be drawn inside, e.g. the HUD panel. */
export type ArrowAvoidRect = { x: number; y: number; w: number; h: number };

/**
 * Pushes the arrow's screen Y below `avoidRect` when it would otherwise land
 * inside it — the arrow tracks the active player, who can be scrolled into the
 * HUD's screen corner when the camera clamps at a map edge.
 */
function clampArrowScreenY(
  screenX: number,
  screenY: number,
  avoidRect: ArrowAvoidRect | undefined,
): number {
  if (avoidRect === undefined) return screenY;
  const overlapsHorizontally =
    screenX + ARROW_FOOTPRINT_HALF_WIDTH > avoidRect.x &&
    screenX - ARROW_FOOTPRINT_HALF_WIDTH < avoidRect.x + avoidRect.w;
  if (!overlapsHorizontally) return screenY;
  return Math.max(screenY, avoidRect.y + avoidRect.h + ARROW_AVOID_RECT_CLEARANCE);
}

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
 * @param options.outlineColor - Arrow stroke color (e.g. '#000')
 * @param options.avoidRect - Screen rect (e.g. the HUD panel) the arrow must not overlap
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
  options?: { outlineColor?: string; avoidRect?: ArrowAvoidRect },
): void {
  const playerCenterX = playerWorldX + TILE_SIZE / 2;
  const playerCenterY = playerWorldY + TILE_SIZE / 2;
  const angle = Math.atan2(targetWorldY - playerCenterY, targetWorldX - playerCenterX);
  drawBearingArrowAbovePlayer(ctx, playerWorldX, playerWorldY, angle, camX, camY, color, options);
}

/**
 * The same arrow, aimed by bearing rather than by target.
 *
 * Exists for indicators that deliberately do not point at an exact position —
 * a bearing rounded to a compass direction has no target point to hand a
 * position-taking helper, and inventing one just to be un-invented by
 * `Math.atan2` would be a lie about what the caller knows.
 *
 * @param bearingRadians - Screen-space angle, 0 = east, growing clockwise (canvas y is down)
 * @param options.outlineColor - Arrow stroke color (e.g. '#000')
 * @param options.avoidRect - Screen rect (e.g. the HUD panel) the arrow must not overlap
 */
export function drawBearingArrowAbovePlayer(
  ctx: CanvasRenderingContext2D,
  playerWorldX: number,
  playerWorldY: number,
  bearingRadians: number,
  camX: number,
  camY: number,
  color: string,
  options?: { outlineColor?: string; avoidRect?: ArrowAvoidRect },
): void {
  const bounce = Math.sin(Date.now() * ARROW_BOUNCE_FREQUENCY) * ARROW_BOUNCE_AMPLITUDE;
  const screenX = playerWorldX - camX + TILE_SIZE / 2;
  const rawScreenY = playerWorldY - camY - TILE_SIZE * ARROW_VERTICAL_OFFSET_TILES + bounce;
  const screenY = clampArrowScreenY(screenX, rawScreenY, options?.avoidRect);
  const len = ARROW_LENGTH_PIXELS;

  ctx.save();
  ctx.translate(screenX, screenY);
  ctx.rotate(bearingRadians);
  ctx.fillStyle = color;
  ctx.strokeStyle = options?.outlineColor ?? '#000';
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
