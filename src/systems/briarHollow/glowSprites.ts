/**
 * Baked warm glows for the village's lamps and fires.
 *
 * A radial gradient built per lamp per frame was the bulk of the village's
 * ambience cost. The gradient's only per-frame variable is its peak opacity, and
 * with the outer stop fully transparent that opacity scales every pixel of the
 * gradient alike, so a sprite baked at full strength and blitted with
 * `globalAlpha` paints the same picture.
 *
 * The cache is shared by every `VillageAmbience`, because the village's kit is
 * rebuilt on every door visit and a per-instance cache would orphan its
 * surfaces each time.
 */

import {
  allocCanvas,
  CanvasContextUnavailableError,
  surfaceContext,
  releaseSurface,
} from '../../core/rendering/canvasSurface';
import type { CanvasSurface } from '../../core/rendering/canvasSurface';
import {
  canvasGeneration,
  reportCanvasAllocationFailure,
} from '../../core/rendering/canvasRecovery';

const GLOW_CORE_COLOR = 'rgba(255,190,110,1)';
const GLOW_EDGE_COLOR = 'rgba(255,150,60,0)';
/**
 * Pixels baked per world pixel of radius. Above one so the sprite stays smooth
 * when a high-DPR canvas scales it up; a soft gradient needs no more.
 */
const GLOW_BAKE_SCALE = 2;
/**
 * Distinct radii kept baked. The village draws a handful (two lamp sizes and one
 * per hearth kind), so the cap only matters if a caller starts passing radii
 * that vary frame to frame.
 */
const GLOW_SPRITE_CACHE_LIMIT = 8;

const sprites = new Map<number, CanvasSurface>();
let spritesGeneration = canvasGeneration();

function syncCanvasGeneration(): void {
  const current = canvasGeneration();
  if (spritesGeneration === current) return;
  spritesGeneration = current;
  for (const sprite of sprites.values()) releaseSurface(sprite);
  sprites.clear();
}

function evictOldest(): void {
  const oldest = sprites.entries().next();
  if (oldest.done === true) return;
  const [radius, sprite] = oldest.value;
  releaseSurface(sprite);
  sprites.delete(radius);
}

function bakeGlow(radius: number): CanvasSurface | null {
  const size = Math.max(1, Math.ceil(radius * 2 * GLOW_BAKE_SCALE));
  const centre = size / 2;
  const surface = allocCanvas('effects', size, size);
  try {
    const ctx = surfaceContext(surface);
    const gradient = ctx.createRadialGradient(centre, centre, 0, centre, centre, centre);
    gradient.addColorStop(0, GLOW_CORE_COLOR);
    gradient.addColorStop(1, GLOW_EDGE_COLOR);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(centre, centre, centre, 0, Math.PI * 2);
    ctx.fill();
  } catch (error) {
    releaseSurface(surface);
    if (!(error instanceof CanvasContextUnavailableError)) throw error;
    reportCanvasAllocationFailure();
    return null;
  }
  return surface;
}

function glowSprite(radius: number): CanvasSurface | null {
  syncCanvasGeneration();
  const cached = sprites.get(radius);
  if (cached !== undefined) return cached;
  const baked = bakeGlow(radius);
  if (baked === null) return null;
  if (sprites.size >= GLOW_SPRITE_CACHE_LIMIT) evictOldest();
  sprites.set(radius, baked);
  return baked;
}

/**
 * Draws a warm glow of `radius` centred on (`x`, `y`) at peak opacity
 * `strength`, compositing with whatever operation the caller has set.
 */
export function drawGlowSprite(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  strength: number,
): void {
  const sprite = glowSprite(radius);
  if (sprite === null) return;
  const previousAlpha = ctx.globalAlpha;
  ctx.globalAlpha = previousAlpha * strength;
  const diameter = radius * 2;
  ctx.drawImage(sprite, x - radius, y - radius, diameter, diameter);
  ctx.globalAlpha = previousAlpha;
}
