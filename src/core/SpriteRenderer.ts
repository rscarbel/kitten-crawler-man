import {
  getSpriteDef,
  type SpriteKey,
  type SpriteStates,
  type SpriteDef,
  type SpriteStateDef,
} from './SpriteLoader';

/** Default alpha for full opacity. */
const DEFAULT_ALPHA = 1;

/** Tile center offset as a fraction of tile size. */
const TILE_CENTER_OFFSET = 0.5;

/**
 * Resolve the sheet-pixel origin (srcX, srcY) of a frame, wrapping onto
 * subsequent rows once `colsPerRow` is exceeded (see SpriteStateDef.colsPerRow).
 */
function frameOrigin(
  stateDef: SpriteStateDef,
  frameWidth: number,
  frameHeight: number,
  clampedFrame: number,
): { srcX: number; srcY: number } {
  const colOffset = stateDef.colOffset ?? 0;
  const totalCol = colOffset + clampedFrame;
  if (stateDef.colsPerRow === undefined) {
    return { srcX: totalCol * frameWidth, srcY: stateDef.row * frameHeight };
  }
  const row = stateDef.row + Math.floor(totalCol / stateDef.colsPerRow);
  const col = totalCol % stateDef.colsPerRow;
  return { srcX: col * frameWidth, srcY: row * frameHeight };
}

export interface DrawSpriteOpts {
  /** Mirror the sprite horizontally around its tile-horizontal center. */
  flipX?: boolean;
  /** Global alpha override (0–1). Omit or pass 1 for no change. */
  alpha?: number;
  /**
   * When set, treats (x, y) as the anchor/pivot point and rotates the sprite
   * around it before drawing.  Used for directional effects (e.g. missiles).
   * In this mode, x and y are the world-space effect position, and tileX/tileY
   * from the manifest define the offset from that position to the sprite origin.
   */
  rotation?: number;
}

/**
 * Draw a single frame from a sprite sheet.
 *
 * For creatures/tiles: x, y is the tile top-left in screen coordinates.
 * For positioned effects: x, y is the effect anchor in screen coordinates and
 *   opts.rotation should be provided to orient the sprite.
 */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  def: SpriteDef,
  stateDef: SpriteStateDef,
  frame: number,
  x: number,
  y: number,
  tileSize: number,
  opts: DrawSpriteOpts = {},
): void {
  const { flipX = false, alpha, rotation } = opts;
  const { img, frameWidth, frameHeight, tileX, tileY, tileScale } = def;

  const scale = tileSize / tileScale;
  const clampedFrame = Math.max(0, Math.min(Math.floor(frame), stateDef.frameCount - 1));
  const { srcX, srcY } = frameOrigin(stateDef, frameWidth, frameHeight, clampedFrame);
  const dw = frameWidth * scale;
  const dh = frameHeight * scale;

  const needsSave =
    flipX || rotation !== undefined || (alpha !== undefined && alpha !== DEFAULT_ALPHA);
  if (needsSave) ctx.save();
  if (alpha !== undefined && alpha !== DEFAULT_ALPHA) ctx.globalAlpha = alpha;

  if (rotation !== undefined) {
    // Rotate around the anchor point (x, y) then draw with tileX/tileY offset.
    ctx.translate(x, y);
    ctx.rotate(rotation);
    if (flipX) ctx.scale(-1, 1);
    ctx.drawImage(img, srcX, srcY, frameWidth, frameHeight, -tileX * scale, -tileY * scale, dw, dh);
  } else {
    if (flipX) {
      // Flip around the horizontal center of the tile.
      const cx = x + tileSize * TILE_CENTER_OFFSET;
      ctx.translate(cx, 0);
      ctx.scale(-1, 1);
      ctx.translate(-cx, 0);
    }
    ctx.drawImage(
      img,
      srcX,
      srcY,
      frameWidth,
      frameHeight,
      x - tileX * scale,
      y - tileY * scale,
      dw,
      dh,
    );
  }

  if (needsSave) ctx.restore();
}

/**
 * Draw a sprite rotated around its visual center (pivot = center of the rendered frame).
 * sx/sy are the screen-space world coordinates of the part (before camera offset removal).
 * Intended for gore/debris parts that spin freely rather than directional effects.
 */
export function drawSpriteRotatedCenter(
  ctx: CanvasRenderingContext2D,
  def: SpriteDef,
  stateDef: SpriteStateDef,
  sx: number,
  sy: number,
  angle: number,
  tileSize: number,
  alpha: number,
): void {
  const { img, frameWidth, frameHeight, tileX, tileY, tileScale } = def;
  const { srcX, srcY } = frameOrigin(stateDef, frameWidth, frameHeight, 0);
  const scale = tileSize / tileScale;
  const dw = frameWidth * scale;
  const dh = frameHeight * scale;
  const pivotX = sx - tileX * scale + dw / 2;
  const pivotY = sy - tileY * scale + dh / 2;

  ctx.save();
  if (alpha !== DEFAULT_ALPHA) ctx.globalAlpha = alpha;
  ctx.translate(pivotX, pivotY);
  ctx.rotate(angle);
  ctx.drawImage(img, srcX, srcY, frameWidth, frameHeight, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}

/**
 * Look up sprite and state by key, then draw.
 * Returns immediately (no-op) if the sprite or state is not loaded.
 */
export function drawSpriteKey<K extends SpriteKey>(
  ctx: CanvasRenderingContext2D,
  key: K,
  state: SpriteStates[K],
  frame: number,
  x: number,
  y: number,
  tileSize: number,
  opts: DrawSpriteOpts = {},
): void {
  const def = getSpriteDef(key);
  if (!def) return;
  const stateDef = def.states.get(state);
  if (!stateDef) return;
  drawSprite(ctx, def, stateDef, frame, x, y, tileSize, opts);
}

/**
 * Convert a continuous walk angle (0–2π cycle) to a clamped frame index.
 * Safe for negative or multi-revolution values.
 */
export function walkFrameIndex(walkFrame: number, frameCount: number): number {
  const TAU = Math.PI * 2;
  const cycle = ((walkFrame % TAU) + TAU) % TAU;
  return Math.floor((cycle / TAU) * frameCount) % frameCount;
}

/**
 * Convert a normalised 0–1 progress value to a clamped frame index.
 * progress=0 → frame 0;  progress=1 → last frame.
 */
export function progressFrameIndex(progress: number, frameCount: number): number {
  return Math.max(0, Math.min(frameCount - 1, Math.floor(progress * frameCount)));
}

/**
 * Drive a looping animation from elapsed time.
 * @param elapsedSeconds  Monotonic time in seconds (e.g. performance.now() / 1000)
 * @param fps             Desired animation frames-per-second
 * @param frameCount      Number of frames in the animation
 */
export function timeFrameIndex(elapsedSeconds: number, fps: number, frameCount: number): number {
  return Math.floor(elapsedSeconds * fps) % frameCount;
}
