/**
 * Composing a painted figure on a scratch surface of its own.
 *
 * Three things a believable figure needs are functions of the *finished*
 * silhouette and cannot be built part by part: the outline round the outside
 * of the whole figure only (drawn per part, every arm over the chest gets an
 * ink ring and the figure reads as a paper doll), the shadow each overlapping
 * part casts on whatever is already painted under it, and the rim light along
 * an edge of the silhouette. A figure that wants them paints its parts into
 * {@link Layer}s here and blits the result down once.
 *
 * The surface has one scratch pixel per pixel of the surface the figure is
 * finally painted into, whatever density that is: composing at any other
 * density only resamples the finished figure once more on the way in. Reading
 * that density off the transform is not reading caller state — it is the
 * scale the figure is being painted at, which a painter drawing straight into
 * its context honours by construction. Every whole-pixel effect is sized in
 * cell pixels and converted by it, so the output is the same figure at any
 * density. A figure composed this way sets `skipSupersample` on its
 * `FigureDef`: its edges are already antialiased, and a supersampled bake
 * would only smear its one-pixel effects.
 */

import type { Pt } from './bipedArt';
import {
  allocCanvas,
  type CanvasSurface,
  releaseSurface,
  surfaceContext,
} from '../../core/canvasSurface';

type Ctx = CanvasRenderingContext2D;

/** Below this the context is not drawing at any real size, and a zero would divide. */
const DEGENERATE_DENSITY = 1e-3;

/** The figure-space rectangle the composing surface covers, and its density. */
export interface LayerBounds {
  readonly minX: number;
  readonly minY: number;
  /** In scratch pixels. */
  readonly width: number;
  readonly height: number;
  /** Scratch pixels per figure unit across. */
  readonly pxPerUnit: number;
  /**
   * Scratch pixels per figure unit down: the same as across, except on a
   * figure drawn stretched — a look narrower or taller than its rig — which
   * is composed at its own density down so the finished surface lands on
   * the target pixel for pixel rather than being resampled into it.
   */
  readonly pxPerUnitY: number;
}

/** How far apart two densities may be and still be one: rounding in a rotated transform. */
const SAME_DENSITY = 1e-9;

/** Points a figure's ink reaches toward, and how far past them it can still run. */
export interface InkReach {
  readonly points: readonly Pt[];
  readonly margin: number;
}

function fraction(value: number): number {
  return value - Math.floor(value);
}

/**
 * The surface round `reaches`, at the density `ctx` is painting at.
 *
 * The surface's pixel grid is laid on the target's own: its origin is snapped
 * to a whole target pixel. Left fractional, it slides a sub-pixel with every
 * hand that moves, every edge of the figure is rasterised a little
 * differently, and a standing idle shimmers from frame to frame.
 */
export function layerBounds(ctx: Ctx, reaches: readonly InkReach[]): LayerBounds {
  const transform = ctx.getTransform();
  const pxPerUnit = Math.max(Math.hypot(transform.a, transform.b), DEGENERATE_DENSITY);
  const downDensity = Math.max(Math.hypot(transform.c, transform.d), DEGENERATE_DENSITY);
  const pxPerUnitY = Math.abs(downDensity - pxPerUnit) < SAME_DENSITY ? pxPerUnit : downDensity;
  const gridX = fraction(transform.e);
  const gridY = fraction(transform.f);
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const { points, margin } of reaches) {
    for (const p of points) {
      left = Math.min(left, p.x - margin);
      top = Math.min(top, p.y - margin);
      right = Math.max(right, p.x + margin);
      bottom = Math.max(bottom, p.y + margin);
    }
  }
  const snap = (value: number, grid: number, density: number): number =>
    (Math.floor(value * density + grid) - grid) / density;
  const minX = snap(left, gridX, pxPerUnit);
  const minY = snap(top, gridY, pxPerUnitY);
  const width = Math.ceil((right - minX) * pxPerUnit);
  const height = Math.ceil((bottom - minY) * pxPerUnitY);
  return { minX, minY, width, height, pxPerUnit, pxPerUnitY };
}

/**
 * How many scratch pixels `cellPx` cell pixels are, for a figure whose cell
 * holds `cellPxPerUnit` pixels per figure unit. Never less than one: an effect
 * sized in whole pixels that rounds to none silently disappears.
 */
export function scratchPx(bounds: LayerBounds, cellPx: number, cellPxPerUnit: number): number {
  return Math.max(1, Math.round((cellPx * bounds.pxPerUnit) / cellPxPerUnit));
}

/**
 * `direction` scaled to `distance` scratch pixels and snapped to whole ones.
 * Every layer-to-layer blit lands on the pixel grid: a fractional offset makes
 * the rasteriser resample the whole surface, which in node-canvas cost several
 * times the rest of a painter put together.
 */
export function pixelStep(direction: Pt, distance: number): Pt {
  return { x: Math.round(direction.x * distance), y: Math.round(direction.y * distance) };
}

/** The whole-pixel offsets a silhouette is dilated by, `samples` directions round a circle. */
export function dilationOffsets(radiusPx: number, samples: number): Pt[] {
  return Array.from({ length: samples }, (_unused, i) => {
    const angle = (i / samples) * Math.PI * 2;
    return {
      x: Math.round(Math.cos(angle) * radiusPx),
      y: Math.round(Math.sin(angle) * radiusPx),
    };
  });
}

/** The four axis-aligned whole-pixel offsets of a band `radiusPx` wide. */
export function crossOffsets(radiusPx: number): Pt[] {
  return [
    { x: radiusPx, y: 0 },
    { x: -radiusPx, y: 0 },
    { x: 0, y: radiusPx },
    { x: 0, y: -radiusPx },
  ];
}

export interface Layer {
  readonly surface: CanvasSurface;
  readonly ctx: Ctx;
}

/**
 * The layers made inside each {@link withComposeLayers} under way, innermost
 * last. A painter can compose another figure halfway through its own — a held
 * prop that is itself a painted figure — so each composition owns only the
 * layers made while it is the innermost.
 */
const layerScopes: Layer[][] = [];

/**
 * Runs one composition and gives back the pixels of every layer it made,
 * however it ends. A layer is a throwaway the size of the figure; left to the
 * collector, a crowd's worth of bakes holds hundreds of them at once.
 */
export function withComposeLayers<T>(compose: () => T): T {
  const owned: Layer[] = [];
  layerScopes.push(owned);
  try {
    return compose();
  } finally {
    layerScopes.pop();
    for (const layer of owned) releaseSurface(layer.surface);
  }
}

/** A blank layer, owned by the innermost {@link withComposeLayers} when one is under way. */
export function makeLayer(bounds: LayerBounds): Layer {
  const surface = allocCanvas('figureScratch', bounds.width, bounds.height);
  const layer = { surface, ctx: surfaceContext(surface) };
  const innermost = layerScopes.length > 0 ? layerScopes[layerScopes.length - 1] : undefined;
  innermost?.push(layer);
  return layer;
}

/** Runs `paint` on a layer in figure units, leaving the layer's own state as it found it. */
export function inFigureSpace(layer: Layer, bounds: LayerBounds, paint: (ctx: Ctx) => void): void {
  const { ctx } = layer;
  ctx.save();
  try {
    ctx.scale(bounds.pxPerUnit, bounds.pxPerUnitY);
    ctx.translate(-bounds.minX, -bounds.minY);
    paint(ctx);
  } finally {
    ctx.restore();
  }
}

/** Replaces every pixel's colour with `colour`, multiplying its alpha by the colour's own. */
export function tint(layer: Layer, colour: string): void {
  const { ctx, surface } = layer;
  ctx.save();
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, surface.width, surface.height);
  ctx.restore();
}

/**
 * Clears every pixel of `layer` fainter than `minAlpha` (0–255): what keeps a
 * soft cast shadow on the floor out of a silhouette traced from the layer.
 */
export function keepOpaque(layer: Layer, minAlpha: number): void {
  const { ctx, surface } = layer;
  const image = ctx.getImageData(0, 0, surface.width, surface.height);
  const { data } = image;
  for (let i = ALPHA_CHANNEL; i < data.length; i += RGBA_CHANNELS) {
    if (data[i] < minAlpha) data[i] = 0;
  }
  ctx.putImageData(image, 0, 0);
}

export function clear(layer: Layer): void {
  layer.ctx.clearRect(0, 0, layer.surface.width, layer.surface.height);
}

/**
 * Draws `source` onto `target` only where `target` already has ink.
 *
 * Any fade belongs in `source`'s own alpha (see {@link tint}), not in
 * `globalAlpha`: a masked composite under a global alpha takes node-canvas's
 * slow path and cost more than the whole rest of a figure.
 */
export function drawAtop(target: Layer, source: Layer, dx: number, dy: number): void {
  const { ctx } = target;
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.drawImage(source.surface, dx, dy);
  ctx.restore();
}

/**
 * Lays `part` over `body`, first casting its shadow — `part`'s own shape in
 * `shadow`, offset by `cast` — onto whatever `body` already holds beneath it.
 * `scratch` is free to reuse afterwards.
 */
export function laySlab(body: Layer, part: Layer, scratch: Layer, cast: Pt, shadow: string): void {
  clear(scratch);
  scratch.ctx.drawImage(part.surface, 0, 0);
  tint(scratch, shadow);
  drawAtop(body, scratch, cast.x, cast.y);
  body.ctx.drawImage(part.surface, 0, 0);
}

/**
 * Darkens whatever `body` holds in a thin band all round `part`'s silhouette,
 * before `part` is laid over it: the contact shadow that says one form lies on
 * another, where a cast shadow falling one way only separates one edge.
 */
export function occludeAround(
  body: Layer,
  part: Layer,
  scratch: Layer,
  band: readonly Pt[],
  shadow: string,
): void {
  clear(scratch);
  for (const offset of band) scratch.ctx.drawImage(part.surface, offset.x, offset.y);
  tint(scratch, shadow);
  drawAtop(body, scratch, 0, 0);
}

/**
 * Lights the rim of `body`'s silhouette on one side: every pixel whose
 * neighbour `toward` (whole scratch pixels) is empty takes `colour`.
 * `clearRim` may erase parts of the rim before it is laid, in scratch space;
 * a neighbour inside `occluder` counts as covered, for an edge that runs
 * along something laid against the body after it is finished.
 */
export function lightRim(
  body: Layer,
  scratch: Layer,
  toward: Pt,
  colour: string,
  clearRim?: (layer: Layer) => void,
  occluder?: Layer,
): void {
  clear(scratch);
  const { ctx } = scratch;
  ctx.drawImage(body.surface, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(body.surface, -toward.x, -toward.y);
  if (occluder !== undefined) ctx.drawImage(occluder.surface, -toward.x, -toward.y);
  ctx.restore();
  tint(scratch, colour);
  clearRim?.(scratch);
  drawAtop(body, scratch, 0, 0);
}

/**
 * Builds the finished figure with its outline into `out`: the silhouette
 * dilated by `dilation`, tinted `colour` and faded to the alpha of `opacity`
 * (any colour; only its alpha is used), with the figure laid over
 * it so only the outside ring shows.
 *
 * With `closeGaps` the ring is the dilation minus its own erosion back by the
 * same amount — the silhouette *closed* — rather than minus the silhouette
 * itself, so a sliver of floor between a hanging arm and the body stays open
 * instead of filling with outline: the very ink line between arm and body the
 * outline must never draw. `scratch` is free to reuse afterwards.
 */
export function outlineInto(
  out: Layer,
  body: Layer,
  scratch: Layer,
  dilation: readonly Pt[],
  colour: string,
  opacity: string,
  closeGaps: boolean,
): void {
  clear(out);
  const { ctx } = out;
  for (const offset of dilation) ctx.drawImage(body.surface, offset.x, offset.y);

  if (closeGaps) {
    clear(scratch);
    const closed = scratch.ctx;
    closed.drawImage(out.surface, 0, 0);
    closed.save();
    closed.globalCompositeOperation = 'destination-in';
    for (const offset of dilation) closed.drawImage(out.surface, -offset.x, -offset.y);
    closed.restore();
  }

  tint(out, colour);
  ctx.save();
  if (closeGaps) {
    // The closed sliver's edges are antialiased, so one cut leaves a stipple of
    // part-alpha ink along a gap that narrows to nothing; cutting again takes
    // that residue to below what reads as a mark.
    ctx.globalCompositeOperation = 'destination-out';
    for (let cut = 0; cut < SLIVER_CUTS; cut++) ctx.drawImage(scratch.surface, 0, 0);
  }
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = opacity;
  ctx.fillRect(0, 0, out.surface.width, out.surface.height);
  ctx.restore();
  ctx.drawImage(body.surface, 0, 0);
}

/**
 * Clears the outline from every hole in `body` the floor shows through but
 * the outside cannot reach: a gap enclosed between an arm and the hip it
 * rests on. The outline is the line round the figure; drawn round the rim of
 * a hole too wide for {@link outlineInto} to close, it is a ring of ink lying
 * on the floor between his arm and his side.
 */
export function clearOutlineInHoles(out: Layer, body: Layer): void {
  const { width, height } = out.surface;
  if (width === 0 || height === 0) return;
  const bodyAlpha = body.ctx.getImageData(0, 0, width, height).data;
  const open = (i: number): boolean => bodyAlpha[i * RGBA_CHANNELS + ALPHA_CHANNEL] < HOLE_ALPHA;
  const outside = new Uint8Array(width * height);
  const queue: number[] = [];
  const reach = (i: number): void => {
    if (outside[i] === 1 || !open(i)) return;
    outside[i] = 1;
    queue.push(i);
  };
  for (let x = 0; x < width; x++) {
    reach(x);
    reach((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    reach(y * width);
    reach(y * width + width - 1);
  }
  // The queue grows as it is walked, so it is read by index, not iterated.
  let head = 0;
  while (head < queue.length) {
    const i = queue[head++];
    const x = i % width;
    if (x > 0) reach(i - 1);
    if (x < width - 1) reach(i + 1);
    if (i >= width) reach(i - width);
    if (i < width * (height - 1)) reach(i + width);
  }
  const image = out.ctx.getImageData(0, 0, width, height);
  let cleared = false;
  for (let i = 0; i < outside.length; i++) {
    if (outside[i] === 1 || !open(i)) continue;
    image.data[i * RGBA_CHANNELS + ALPHA_CHANNEL] = 0;
    cleared = true;
  }
  if (cleared) out.ctx.putImageData(image, 0, 0);
}

/** A pixel of the body this transparent or less is floor showing through. */
const HOLE_ALPHA = 8;
const RGBA_CHANNELS = 4;
const ALPHA_CHANNEL = 3;

/** How many times a closed sliver is cut out of the outline: see {@link outlineInto}. */
const SLIVER_CUTS = 3;

/** Blits a finished layer back down into the figure space `ctx` is painting in. */
export function blitLayer(ctx: Ctx, layer: Layer, bounds: LayerBounds): void {
  ctx.drawImage(
    layer.surface,
    bounds.minX,
    bounds.minY,
    bounds.width / bounds.pxPerUnit,
    bounds.height / bounds.pxPerUnitY,
  );
}

/** `out` becomes `source` everywhere `mask` has ink, weighted by the mask's alpha, and empty elsewhere. */
export function maskedCopy(out: Layer, source: Layer, mask: Layer): void {
  clear(out);
  const { ctx } = out;
  ctx.drawImage(mask.surface, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'source-in';
  ctx.drawImage(source.surface, 0, 0);
  ctx.restore();
}

/** `out` becomes `source` dilated by every offset in `dilation`. */
export function dilateInto(out: Layer, source: Layer, dilation: readonly Pt[]): void {
  clear(out);
  for (const offset of dilation) out.ctx.drawImage(source.surface, offset.x, offset.y);
}

/** Erases from `target` everything `eraser` has ink over. */
export function eraseWith(target: Layer, eraser: Layer): void {
  const { ctx } = target;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(eraser.surface, 0, 0);
  ctx.restore();
}

/** Keeps of `target` only what `keep` has ink over. */
export function keepWithin(target: Layer, keep: Layer): void {
  const { ctx } = target;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(keep.surface, 0, 0);
  ctx.restore();
}
