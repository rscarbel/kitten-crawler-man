/**
 * One sun for the whole town, and the passes that let a viewer find it.
 *
 * The sun is upper-left, matching the ground pipeline's relief direction, so a
 * building's shading agrees with the terrain it stands on and with the runtime
 * ground occlusion that already darkens tiles at their base.
 *
 * ## Why shading is applied here and not in the ramps
 *
 * Every material is authored at its own *unlit* value and shaded by the plane it
 * lands on. Baking the plane's value into the ramp instead would mean a separate
 * thatch for the front slope and the hip end, a separate stone for the wall and
 * the side return, and a guarantee that the two drift apart the first time one
 * of them is tuned. It is also what makes the plane-separation gate meaningful:
 * the gate can compare a plane's rendered value against its material's own ramp
 * and see the lighting on its own, rather than seeing a colour choice.
 *
 * ## Ambient occlusion is a gradient, never a bar
 *
 * Every AO pass here is a multi-stop gradient. A hard-edged translucent
 * rectangle under an eave is the exact move that makes the circus tents read as
 * flat, and it is worth stating because it is also the cheapest thing to reach
 * for.
 */

import type { CanvasRenderingContext2D as NodeCtx } from 'canvas';
import { NoiseField } from '../tilegen/noise.js';
import type { Plane, Point, Quad } from './projection.js';
import {
  ALPHA,
  isOpaque,
  multiplyPixel,
  pixelIndex,
  readPixels,
  writePixels,
  type PixelBuffer,
} from './pixels.js';
import { getRamp, luminance, rgba, sampleRamp, type RGB } from './ramps.js';

/**
 * Value of each plane relative to an unshaded material, before any local
 * occlusion.
 *
 * The roof faces the sky and gets the most of it; the front wall faces the
 * viewer and takes the sun obliquely; the side return faces away from the sun
 * entirely and is the darkest thing on the building that is not a shadow.
 *
 * The spread between them is wider than a first pass made it, and deliberately
 * so. A roof and a wall painted in materials of similar value — red clay over
 * warm stone, grey slate over grey stone — land within a couple of per cent of
 * each other under a gentle split and read as one flat sheet, whatever the
 * convergence of the roof plane is doing. The light has to do the separating,
 * because the materials cannot be relied on to.
 */
export const ROOF_PLANE_SHADE = 1.26;
export const FACADE_PLANE_SHADE = 0.9;
export const SIDE_RETURN_SHADE = 0.5;
/** The hip end faces further from the sun than the front slope but still skyward. */
export const ROOF_RETURN_SHADE = 0.95;

/** Uniformly scales a plane's colour. Alpha is untouched: shading is not erosion. */
export function shadePlane(plane: Plane, factor: number): void {
  const buffer = readPixels(plane.ctx, plane.width, plane.height);
  for (let i = 0; i < buffer.data.length; i += 4) {
    if (buffer.data[i + ALPHA] === 0) continue;
    multiplyPixel(buffer, i, factor);
  }
  writePixels(plane.ctx, buffer);
}

export type AoEdge = 'top' | 'bottom' | 'left' | 'right';

export interface AoOptions {
  /** Peak darkening at the occluding edge, 0..1. */
  readonly depth: number;
  /** How far the shadow reaches from that edge, in plane pixels. */
  readonly reach: number;
}

/**
 * Soft occlusion running inward from one edge of a rectangle.
 *
 * Three stops rather than two: real contact shadows fall off fast near the
 * contact and slowly further out, and a linear ramp between two stops reads as
 * a gradient effect rather than as shadow.
 */
export function paintEdgeAo(
  ctx: NodeCtx,
  rect: { x: number; y: number; width: number; height: number },
  edge: AoEdge,
  options: AoOptions,
): void {
  const reach = Math.min(
    options.reach,
    edge === 'top' || edge === 'bottom' ? rect.height : rect.width,
  );
  if (reach <= 0 || options.depth <= 0) return;
  const from = aoGradientOrigin(rect, edge);
  const to = aoGradientEnd(rect, edge, reach);
  const gradient = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
  const MID_STOP = 0.35;
  const MID_DEPTH_FRACTION = 0.38;
  gradient.addColorStop(0, rgba(SHADOW_COLOR, options.depth));
  gradient.addColorStop(MID_STOP, rgba(SHADOW_COLOR, options.depth * MID_DEPTH_FRACTION));
  gradient.addColorStop(1, rgba(SHADOW_COLOR, 0));
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = gradient;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
}

/** Shadows are a warm near-black; pure black on a warm wall reads as a hole. */
const SHADOW_COLOR: RGB = [18, 13, 12];

function aoGradientOrigin(
  rect: { x: number; y: number; width: number; height: number },
  edge: AoEdge,
): Point {
  switch (edge) {
    case 'top':
      return { x: rect.x, y: rect.y };
    case 'bottom':
      return { x: rect.x, y: rect.y + rect.height };
    case 'left':
      return { x: rect.x, y: rect.y };
    case 'right':
      return { x: rect.x + rect.width, y: rect.y };
  }
}

function aoGradientEnd(
  rect: { x: number; y: number; width: number; height: number },
  edge: AoEdge,
  reach: number,
): Point {
  switch (edge) {
    case 'top':
      return { x: rect.x, y: rect.y + reach };
    case 'bottom':
      return { x: rect.x, y: rect.y + rect.height - reach };
    case 'left':
      return { x: rect.x + reach, y: rect.y };
    case 'right':
      return { x: rect.x + rect.width - reach, y: rect.y };
  }
}

/**
 * Occlusion in a recess — a door reveal, a window reveal, the crease where the
 * facade meets the side return.
 *
 * Deepest at the top and on the sun side, because that is where the reveal's own
 * jamb blocks the most sky. A recess lit evenly on all four sides is a picture
 * of a rectangle rather than of a hole.
 */
export function paintRecessAo(
  ctx: NodeCtx,
  rect: { x: number; y: number; width: number; height: number },
  depth: number,
): void {
  const TOP_REACH_FRACTION = 0.55;
  const SIDE_REACH_FRACTION = 0.35;
  const SIDE_DEPTH_FRACTION = 0.75;
  const BOTTOM_DEPTH_FRACTION = 0.4;
  const BOTTOM_REACH_FRACTION = 0.18;
  paintEdgeAo(ctx, rect, 'top', { depth, reach: rect.height * TOP_REACH_FRACTION });
  paintEdgeAo(ctx, rect, 'left', {
    depth: depth * SIDE_DEPTH_FRACTION,
    reach: rect.width * SIDE_REACH_FRACTION,
  });
  paintEdgeAo(ctx, rect, 'right', {
    depth: depth * SIDE_DEPTH_FRACTION * SIDE_DEPTH_FRACTION,
    reach: rect.width * SIDE_REACH_FRACTION,
  });
  paintEdgeAo(ctx, rect, 'bottom', {
    depth: depth * BOTTOM_DEPTH_FRACTION,
    reach: rect.height * BOTTOM_REACH_FRACTION,
  });
}

/**
 * A warm highlight along a top-left-facing edge.
 *
 * The highest value-per-pixel trick in the art this kit replaces: two pixels of
 * warm light on an eaves line, a sill top or a chimney cap does more to state
 * "solid object in sunlight" than any amount of surface texture.
 */
export function paintEdgeLight(
  ctx: NodeCtx,
  from: Point,
  to: Point,
  color: RGB,
  widthPx: number,
  alpha: number,
): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(color, alpha);
  ctx.lineWidth = widthPx;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.restore();
}

export interface GlowOptions {
  readonly rampId: string;
  /** Peak alpha at the glow's centre. */
  readonly intensity: number;
  /** How far the halo bleeds past the opening, in pixels. */
  readonly bleed: number;
}

/**
 * The warm interior seen through a window: a radial falloff painted *behind* the
 * glazing bars, plus a halo bleeding onto the wall around the opening.
 *
 * The halo is the part that matters. A lit rectangle with a hard edge is a
 * coloured rectangle; the same rectangle with three pixels of light spilling
 * onto the stone beside it is a window with a fire behind it.
 */
export function paintWindowGlow(
  ctx: NodeCtx,
  rect: { x: number; y: number; width: number; height: number },
  options: GlowOptions,
): void {
  const ramp = getRamp(options.rampId);
  const centreX = rect.x + rect.width / 2;
  const centreY = rect.y + rect.height / 2;
  const outerRadius = Math.max(rect.width, rect.height) / 2 + options.bleed;
  const CORE_STOP = 0.35;
  const CORE_RAMP_T = 0.9;
  const MID_RAMP_T = 0.55;
  const MID_STOP = 0.7;
  const MID_ALPHA_FRACTION = 0.45;
  const gradient = ctx.createRadialGradient(centreX, centreY, 0, centreX, centreY, outerRadius);
  gradient.addColorStop(0, rgba(sampleRamp(ramp, 1), options.intensity));
  gradient.addColorStop(CORE_STOP, rgba(sampleRamp(ramp, CORE_RAMP_T), options.intensity));
  gradient.addColorStop(
    MID_STOP,
    rgba(sampleRamp(ramp, MID_RAMP_T), options.intensity * MID_ALPHA_FRACTION),
  );
  gradient.addColorStop(1, rgba(sampleRamp(ramp, 0), 0));
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = gradient;
  ctx.fillRect(centreX - outerRadius, centreY - outerRadius, outerRadius * 2, outerRadius * 2);
  ctx.restore();
}

export interface OutlineOptions {
  readonly seed: number;
  /** Stroke width in bake pixels. */
  readonly widthPx: number;
  readonly alpha: number;
  /** Peak wobble of the stroke's width, in pixels. */
  readonly jitterPx: number;
}

/**
 * Strokes the finished silhouette with a dark warm near-black.
 *
 * Derived from the alpha channel rather than from the geometry, so it follows
 * whatever the building actually turned out to be — every prop, every chimney,
 * every ragged thatch edge — instead of tracing the planes and leaving the
 * clutter unoutlined.
 *
 * The width wobbles on low-frequency noise. A uniform stroke reads as vector
 * art; the current painterly art's outline varies along its length, and that
 * variation is most of why it reads as a brush rather than a pen.
 */
export function paintSilhouetteOutline(
  ctx: NodeCtx,
  width: number,
  height: number,
  options: OutlineOptions,
): void {
  const buffer = readPixels(ctx, width, height);
  const noise = new NoiseField(Math.max(width, height));
  const inkRamp = getRamp('ink_outline');
  const JITTER_PERIOD = 12;
  const maxReach = Math.ceil(options.widthPx + options.jitterPx);
  const outlined = new Uint8ClampedArray(buffer.data.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = pixelIndex(buffer, x, y);
      if (isOpaque(buffer, index)) continue;
      const jitter = (noise.value(x, y, JITTER_PERIOD, options.seed) - 0.5) * 2 * options.jitterPx;
      const reach = Math.max(1, options.widthPx + jitter);
      const distance = nearestOpaqueDistance(buffer, x, y, maxReach);
      if (distance > reach) continue;
      const falloff = 1 - (distance - 1) / Math.max(1, reach);
      const ink = sampleRamp(inkRamp, Math.min(1, distance / Math.max(1, reach)));
      const alpha = options.alpha * Math.min(1, Math.max(0, falloff));
      const target = pixelIndex(buffer, x, y);
      outlined[target] = ink[0];
      outlined[target + 1] = ink[1];
      outlined[target + 2] = ink[2];
      outlined[target + 3] = alpha * 255;
    }
  }

  // Written in a second pass so an outline pixel is never itself treated as
  // opaque by the neighbour still being measured — a one-pass version grows the
  // silhouette outward by however many pixels the scan happens to visit first.
  for (let i = 0; i < outlined.length; i += 4) {
    if (outlined[i + 3] === 0) continue;
    buffer.data[i] = outlined[i];
    buffer.data[i + 1] = outlined[i + 1];
    buffer.data[i + 2] = outlined[i + 2];
    buffer.data[i + 3] = outlined[i + 3];
  }
  writePixels(ctx, buffer);
}

/**
 * Chebyshev distance from a transparent pixel to the nearest opaque one, capped
 * at `maxReach`. Returns `maxReach + 1` when nothing is in range.
 */
function nearestOpaqueDistance(
  buffer: PixelBuffer,
  x: number,
  y: number,
  maxReach: number,
): number {
  for (let ring = 1; ring <= maxReach; ring++) {
    for (let offsetY = -ring; offsetY <= ring; offsetY++) {
      const sampleY = y + offsetY;
      if (sampleY < 0 || sampleY >= buffer.height) continue;
      const onRingEdgeY = Math.abs(offsetY) === ring;
      for (let offsetX = -ring; offsetX <= ring; offsetX++) {
        if (!onRingEdgeY && Math.abs(offsetX) !== ring) continue;
        const sampleX = x + offsetX;
        if (sampleX < 0 || sampleX >= buffer.width) continue;
        if (isOpaque(buffer, pixelIndex(buffer, sampleX, sampleY))) return ring;
      }
    }
  }
  return maxReach + 1;
}

/**
 * Ink along every interior form boundary, found by looking rather than by being
 * told where they are.
 *
 * The painterly art this kit replaces darkens the edge of everything — window
 * reveals, beams, barrel hoops, the lip of a string course — and that linework
 * is most of what separates "painted" from "rendered". Reproducing it by having
 * each component stroke its own outline would mean every component knowing what
 * it overlaps, and would still miss the boundaries that only exist because two
 * components happened to meet.
 *
 * So it is measured instead: a Sobel gradient over the finished frame, inked
 * where the value changes fastest. That catches every boundary in the picture,
 * including the ones nothing in the code knows about, and it strengthens exactly
 * the forms a viewer is reading at the 32px display tile.
 *
 * Applied before the silhouette stroke and only to already-opaque pixels, so it
 * darkens the building rather than growing it.
 */
export interface InteriorInkOptions {
  /** Peak darkening at the strongest edge in the frame, 0..1. */
  readonly strength: number;
  /** Gradient magnitude, in luminance units, at which the ink reaches full strength. */
  readonly fullStrengthGradient: number;
  /** Gradient below which nothing is inked, so flat surfaces stay clean. */
  readonly threshold: number;
}

export function paintInteriorInk(
  ctx: NodeCtx,
  width: number,
  height: number,
  options: InteriorInkOptions,
): void {
  const buffer = readPixels(ctx, width, height);
  const luminances = new Float32Array(width * height);
  for (let index = 0, pixel = 0; pixel < luminances.length; pixel++, index += 4) {
    luminances[pixel] = isOpaque(buffer, index)
      ? luminance([buffer.data[index], buffer.data[index + 1], buffer.data[index + 2]])
      : Number.NaN;
  }

  const inked = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const centre = y * width + x;
      if (Number.isNaN(luminances[centre])) continue;
      const gradient = sobelMagnitude(luminances, width, x, y);
      if (!(gradient > options.threshold)) continue;
      const reach = (gradient - options.threshold) / options.fullStrengthGradient;
      inked[centre] = options.strength * Math.min(1, reach);
    }
  }

  for (let pixel = 0, index = 0; pixel < inked.length; pixel++, index += 4) {
    if (inked[pixel] === 0) continue;
    multiplyPixel(buffer, index, 1 - inked[pixel]);
  }
  writePixels(ctx, buffer);
}

/**
 * Sobel magnitude, treating a transparent neighbour as equal to the centre.
 *
 * Substituting the centre value is what stops the silhouette's own edge reading
 * as the strongest gradient in the frame and taking the whole ink budget: the
 * outline pass owns that boundary, and inking it twice thickens it into a border.
 */
function sobelMagnitude(luminances: Float32Array, width: number, x: number, y: number): number {
  const centre = luminances[y * width + x];
  const at = (offsetX: number, offsetY: number): number => {
    const value = luminances[(y + offsetY) * width + (x + offsetX)];
    return Number.isNaN(value) ? centre : value;
  };
  const CORNER_WEIGHT = 1;
  const EDGE_WEIGHT = 2;
  const horizontal =
    CORNER_WEIGHT * (at(-1, -1) - at(1, -1)) +
    EDGE_WEIGHT * (at(-1, 0) - at(1, 0)) +
    CORNER_WEIGHT * (at(-1, 1) - at(1, 1));
  const vertical =
    CORNER_WEIGHT * (at(-1, -1) - at(-1, 1)) +
    EDGE_WEIGHT * (at(0, -1) - at(0, 1)) +
    CORNER_WEIGHT * (at(1, -1) - at(1, 1));
  return Math.hypot(horizontal, vertical);
}

/**
 * A lighter interior pass along a structural boundary — an eaves line, a corner
 * post, the top of the base course.
 *
 * Distinct from the silhouette stroke in both width and alpha, because a
 * building whose internal divisions are inked as heavily as its outline reads as
 * a diagram of a building.
 */
export const INTERIOR_LINE_ALPHA = 0.4;
export const INTERIOR_LINE_WIDTH_PX = 1;

export function paintStructuralLine(ctx: NodeCtx, from: Point, to: Point): void {
  const ink = sampleRamp(getRamp('ink_outline'), 0.4);
  ctx.save();
  ctx.strokeStyle = rgba(ink, INTERIOR_LINE_ALPHA);
  ctx.lineWidth = INTERIOR_LINE_WIDTH_PX;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.restore();
}

/**
 * How far each quad is shrunk toward its own centre before it is measured.
 *
 * A plane's edges are exactly where its neighbours overlap it: the roof's eaves
 * overhang the top of the wall, the hip end covers the head of the side return,
 * and the props that lean against a building's corner land on both planes at
 * once. Measuring to the quad's edge therefore averages each plane with whatever
 * is drawn over it, which pulled a side return within five per cent of the
 * facade it is supposed to be markedly darker than.
 */
const PLANE_MEASURE_INSET = 0.14;

function insetQuad(quad: Quad): Quad {
  const centreX = (quad.tl.x + quad.tr.x + quad.br.x + quad.bl.x) / 4;
  const centreY = (quad.tl.y + quad.tr.y + quad.br.y + quad.bl.y) / 4;
  const pull = (point: Point): Point => ({
    x: point.x + (centreX - point.x) * PLANE_MEASURE_INSET,
    y: point.y + (centreY - point.y) * PLANE_MEASURE_INSET,
  });
  return { tl: pull(quad.tl), tr: pull(quad.tr), br: pull(quad.br), bl: pull(quad.bl) };
}

/**
 * Mean luminance of the opaque pixels inside a quad, measured clear of its own
 * edges.
 *
 * Used by the plane-separation gate. Measuring inside the quad rather than over
 * a bounding box matters: the roof's bounding box contains most of the wall, and
 * a gate that averaged that would compare each plane against a blend of itself
 * and its neighbour and always find them close.
 */
export function meanLuminanceInQuad(buffer: PixelBuffer, outerQuad: Quad): number {
  const quad = insetQuad(outerQuad);
  let total = 0;
  let count = 0;
  const minX = Math.max(0, Math.floor(Math.min(quad.tl.x, quad.bl.x, quad.tr.x, quad.br.x)));
  const maxX = Math.min(
    buffer.width - 1,
    Math.ceil(Math.max(quad.tl.x, quad.bl.x, quad.tr.x, quad.br.x)),
  );
  const minY = Math.max(0, Math.floor(Math.min(quad.tl.y, quad.tr.y, quad.bl.y, quad.br.y)));
  const maxY = Math.min(
    buffer.height - 1,
    Math.ceil(Math.max(quad.tl.y, quad.tr.y, quad.bl.y, quad.br.y)),
  );
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!pointInQuad(quad, x + 0.5, y + 0.5)) continue;
      const index = pixelIndex(buffer, x, y);
      if (!isOpaque(buffer, index)) continue;
      total += luminance([buffer.data[index], buffer.data[index + 1], buffer.data[index + 2]]);
      count++;
    }
  }
  return count === 0 ? 0 : total / count;
}

export function pointInQuad(quad: Quad, x: number, y: number): boolean {
  const corners = [quad.tl, quad.tr, quad.br, quad.bl];
  let sign = 0;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (cross === 0) continue;
    const thisSign = cross > 0 ? 1 : -1;
    if (sign === 0) sign = thisSign;
    else if (sign !== thisSign) return false;
  }
  return true;
}
