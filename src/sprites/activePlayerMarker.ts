/**
 * The small violet orb floating over whichever player the input is driving.
 *
 * Both players draw the identical orb, and it never changes, so it is baked
 * once into a texture rather than rebuilding a radial gradient every frame for
 * every player — a gradient object per frame for a sixteen-pixel blob.
 */

import { allocCanvas, surfaceContext, type CanvasSurface } from '../core/canvasSurface';

/**
 * Texture resolution. Generously above the orb's on-screen size so the blit
 * only ever downscales, which stays smooth at any render scale.
 */
const TEXTURE_PX = 64;

/** Offset of the specular highlight from centre, as a fraction of the radius. */
const HIGHLIGHT_OFFSET_FRACTION = 0.3;

/** Inner radius of the gradient, as a fraction of the orb radius. */
const INNER_RADIUS_FRACTION = 0.1;

/** Where the mid-tone sits along the gradient. */
const MID_STOP = 0.4;

const CORE_COLOR = '#e9d5ff';
const MID_COLOR = '#a855f7';
const EDGE_COLOR = '#6b21a8';

/** The orb reads as a marker, not an object, so it stays half-transparent. */
const MARKER_ALPHA = 0.5;

let texture: CanvasSurface | null = null;

function getTexture(): CanvasSurface {
  if (texture !== null) return texture;
  const surface = allocCanvas(TEXTURE_PX, TEXTURE_PX);
  const ctx = surfaceContext(surface);
  const radius = TEXTURE_PX / 2;
  const highlightOffset = radius * HIGHLIGHT_OFFSET_FRACTION;
  const gradient = ctx.createRadialGradient(
    radius - highlightOffset,
    radius - highlightOffset,
    radius * INNER_RADIUS_FRACTION,
    radius,
    radius,
    radius,
  );
  gradient.addColorStop(0, CORE_COLOR);
  gradient.addColorStop(MID_STOP, MID_COLOR);
  gradient.addColorStop(1, EDGE_COLOR);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(radius, radius, radius, 0, Math.PI * 2);
  ctx.fill();
  texture = surface;
  return surface;
}

/** Draws the active-player orb centred on (cx, cy) at the given radius. */
export function drawActivePlayerMarker(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
): void {
  ctx.save();
  ctx.globalAlpha = MARKER_ALPHA;
  const diameter = radius * 2;
  ctx.drawImage(getTexture(), cx - radius, cy - radius, diameter, diameter);
  ctx.restore();
}
