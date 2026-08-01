/**
 * Baked radial glows.
 *
 * Lamps, auras and item sparkles are all the same shape — a radial falloff
 * centred on a moving point. A `CanvasGradient` bakes its coordinates in, so a
 * glow that follows the camera has to be reallocated every frame for every
 * light. Baking the falloff into a texture instead makes it position-free: one
 * `drawImage` per glow, and the allocation happens once per distinct set of
 * colour stops for the lifetime of the page.
 */

import { allocCanvas, surfaceContext, type CanvasSurface } from '../core/canvasSurface';

/**
 * Texture resolution. Glows are soft by definition, so this is comfortably
 * above the point where a stretched blit is distinguishable from a fresh
 * gradient, while staying small enough that dozens of variants cost little.
 */
const GLOW_TEXTURE_PX = 128;

/** A colour stop, in the same terms as `CanvasGradient.addColorStop`. */
export interface GlowStop {
  offset: number;
  color: string;
}

const texturesByStops = new Map<string, CanvasSurface>();

function stopsKey(stops: ReadonlyArray<GlowStop>, coreFraction: number): string {
  return `${coreFraction}#${stops.map((stop) => `${stop.offset}:${stop.color}`).join('|')}`;
}

function textureFor(stops: ReadonlyArray<GlowStop>, coreFraction: number): CanvasSurface {
  const key = stopsKey(stops, coreFraction);
  const cached = texturesByStops.get(key);
  if (cached !== undefined) return cached;

  const texture = allocCanvas(GLOW_TEXTURE_PX, GLOW_TEXTURE_PX);
  const ctx = surfaceContext(texture);
  const radius = GLOW_TEXTURE_PX / 2;
  const gradient = ctx.createRadialGradient(
    radius,
    radius,
    radius * coreFraction,
    radius,
    radius,
    radius,
  );
  for (const stop of stops) gradient.addColorStop(stop.offset, stop.color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, GLOW_TEXTURE_PX, GLOW_TEXTURE_PX);
  texturesByStops.set(key, texture);
  return texture;
}

/** A glow whose first stop starts at the exact centre. */
const NO_FLAT_CORE = 0;

/**
 * Draws a radial glow of the given stops, centred on (cx, cy).
 *
 * `coreFraction` is where the gradient's first stop sits, as a fraction of the
 * radius — a small value gives the glow a flat bright disc at its centre rather
 * than a single bright point.
 *
 * Callers whose stops vary continuously should quantize them first, so the
 * variant set stays bounded rather than growing without limit.
 */
export function drawRadialGlow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  stops: ReadonlyArray<GlowStop>,
  coreFraction = NO_FLAT_CORE,
): void {
  const diameter = radius * 2;
  ctx.drawImage(textureFor(stops, coreFraction), cx - radius, cy - radius, diameter, diameter);
}
