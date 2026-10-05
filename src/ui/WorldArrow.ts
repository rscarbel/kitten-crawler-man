import { TILE_SIZE } from '../core/constants';
import type { Rect } from './core/geom';
import { elevation, palette } from './theme/tokens';

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
/** The right-pointing arrow turned a quarter turn clockwise, to point down. */
const DOWNWARD_RADIANS = Math.PI / 2;

/** The dark edge every arrow is outlined in unless its caller names another. */
const DEFAULT_OUTLINE_COLOR = palette.surface.sunken;

/** Tiles above the player's tile origin where the arrow is drawn. */
const ARROW_VERTICAL_OFFSET_TILES = 1.5;

/** Gap kept between an arrow pushed clear of an avoid rect and that rect's edge. */
const ARROW_AVOID_RECT_CLEARANCE = 6;

/** Half-width of the arrow's on-screen footprint, for the avoid-rect overlap test. */
const ARROW_FOOTPRINT_HALF_WIDTH = ARROW_LENGTH_PIXELS + ARROW_BOUNCE_AMPLITUDE;

/**
 * A world/edge arrow competing for the one arrow slot a frame is allowed to
 * show (see {@link drawTopArrowCandidate}). Lower `priority` wins.
 */
export interface ArrowCandidate {
  readonly priority: number;
  readonly draw: () => void;
}

/**
 * The one ranking every world/edge arrow in the game shares, so a downed
 * companion always wins the slot and every other arrow has a fixed place
 * behind it. Lower runs first.
 */
export const ARROW_PRIORITY = {
  DOWNED_COMPANION: 0,
  CHEAT_REVEAL: 1,
  PINNED_OBJECTIVE: 2,
  BOUNTY: 3,
  SOUL_CRYSTAL: 4,
} as const;

/**
 * Draws only the highest-priority arrow among this frame's candidates —
 * the arbiter every screen with more than one arrow source must call instead
 * of drawing each source directly, so two arrows never appear at once.
 */
export function drawTopArrowCandidate(candidates: ReadonlyArray<ArrowCandidate | null>): void {
  let winner: ArrowCandidate | null = null;
  for (const candidate of candidates) {
    if (candidate !== null && (winner === null || candidate.priority < winner.priority)) {
      winner = candidate;
    }
  }
  winner?.draw();
}

/** Margin kept past the viewport's edge before a target counts as "in view". */
const VIEWPORT_VISIBILITY_MARGIN_PX = TILE_SIZE;

/**
 * Whether a world point is close enough to the visible screen that an arrow
 * pointing at it would be telling the player something they can already see.
 */
export function isWorldPointOnScreen(
  worldX: number,
  worldY: number,
  camX: number,
  camY: number,
  viewportW: number,
  viewportH: number,
  marginPx = VIEWPORT_VISIBILITY_MARGIN_PX,
): boolean {
  const screenX = worldX - camX;
  const screenY = worldY - camY;
  return (
    screenX >= -marginPx &&
    screenY >= -marginPx &&
    screenX <= viewportW + marginPx &&
    screenY <= viewportH + marginPx
  );
}

/**
 * Pushes the arrow's screen Y below `avoidRect` when it would otherwise land
 * inside it — the arrow tracks the active player, who can be scrolled into the
 * HUD's screen corner when the camera clamps at a map edge.
 */
function clampArrowScreenY(screenX: number, screenY: number, avoidRect: Rect | undefined): number {
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
 * @param options.outlineColor - Arrow stroke color; defaults to the theme's darkest surface
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
  options?: { outlineColor?: string; avoidRect?: Rect },
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
 * @param options.outlineColor - Arrow stroke color; defaults to the theme's darkest surface
 * @param options.avoidRect - Screen rect (e.g. the HUD panel) the arrow must not overlap
 */
function drawBearingArrowAbovePlayer(
  ctx: CanvasRenderingContext2D,
  playerWorldX: number,
  playerWorldY: number,
  bearingRadians: number,
  camX: number,
  camY: number,
  color: string,
  options?: { outlineColor?: string; avoidRect?: Rect },
): void {
  const bounce = Math.sin(Date.now() * ARROW_BOUNCE_FREQUENCY) * ARROW_BOUNCE_AMPLITUDE;
  const screenX = playerWorldX - camX + TILE_SIZE / 2;
  const rawScreenY = playerWorldY - camY - TILE_SIZE * ARROW_VERTICAL_OFFSET_TILES + bounce;
  const screenY = clampArrowScreenY(screenX, rawScreenY, options?.avoidRect);

  paintArrow(ctx, screenX, screenY, bearingRadians, color, options?.outlineColor);
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
  outlineColor: string = DEFAULT_OUTLINE_COLOR,
): void {
  const screenX = worldX - camX + TILE_SIZE / 2;
  const screenY = worldY - camY - TILE_SIZE * ARROW_VERTICAL_OFFSET_TILES;
  const bounce = Math.sin(Date.now() * ARROW_BOUNCE_FREQUENCY) * ARROW_BOUNCE_AMPLITUDE;

  paintArrow(ctx, screenX, screenY + bounce, DOWNWARD_RADIANS, color, outlineColor);
}

/**
 * The arrow itself, pointing along `bearingRadians` from (`x`, `y`): a
 * notched dart in `color`, edged in `outlineColor` and lifted off the world by
 * the HUD's soft shadow.
 */
function paintArrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  bearingRadians: number,
  color: string,
  outlineColor: string = DEFAULT_OUTLINE_COLOR,
): void {
  const len = ARROW_LENGTH_PIXELS;
  const shadow = elevation.hud;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(bearingRadians);
  ctx.beginPath();
  ctx.moveTo(len, 0);
  ctx.lineTo(-len * ARROW_HEAD_HALF_WIDTH_RATIO, -len * ARROW_HEAD_HEIGHT_RATIO);
  ctx.lineTo(-len * ARROW_TAIL_NOTCH_RATIO, 0);
  ctx.lineTo(-len * ARROW_HEAD_HALF_WIDTH_RATIO, len * ARROW_HEAD_HEIGHT_RATIO);
  ctx.closePath();
  ctx.save();
  ctx.shadowColor = shadow.color;
  ctx.shadowBlur = shadow.blur;
  ctx.shadowOffsetY = shadow.offsetY;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = outlineColor;
  ctx.lineWidth = ARROW_LINE_WIDTH;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}
