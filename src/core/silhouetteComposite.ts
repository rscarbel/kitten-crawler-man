/**
 * Paints extra colour *through a character's own alpha*.
 *
 * A creature's art has no fixed relationship to the tile it occupies — sheet
 * sprites are anchored by their manifest, the procedural figures draw at twice
 * tile scale anchored on the feet, and a boss can reach four tiles past its
 * own. Anything painted on the tile therefore lands wherever the tile happens
 * to be rather than on the thing the player is looking at. Instead the entity
 * is drawn once into a scratch surface and each layer is masked by that
 * surface's alpha, so a hit flash or a coat of fire is exactly the shape of the
 * character, whatever that shape is.
 *
 * Two clients: {@link ../core/hitFlash} for damage feedback and
 * {@link ../sprites/status/statusEffectVisuals} for status effects. They share
 * one pass, because compositing the same entity twice would double the cost and
 * let the second pass overwrite the first.
 */

import { allocCanvas, surfaceContext, type CanvasSurface } from './canvasSurface';

/** Screen-space box, in CSS pixels, that a composited entity draws inside. */
export interface ScreenBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * One coat of paint applied to a character's silhouette.
 *
 * `paint` draws in the same CSS screen coordinates the caller uses — the
 * scratch surface carries a matching transform — and whatever it draws is then
 * clipped to the character's own alpha before being composited on top. The box
 * it is handed is the grid-snapped version of the caller's `bounds`, which is
 * what a layer wanting to cover the whole silhouette should fill.
 */
export interface SilhouetteLayer {
  /** Draws the layer's colour. Omit for a layer that only contributes a rim. */
  readonly paint?: (target: CanvasRenderingContext2D, box: ScreenBounds) => void;
  /**
   * How the clipped paint combines with the art beneath it. Defaults to
   * `source-atop`, which tints without disturbing the silhouette's own alpha.
   */
  readonly blend?: GlobalCompositeOperation;
  /** Opacity of the clipped paint. */
  readonly alpha?: number;
  /** Colour of the halo drawn just *outside* the silhouette, if any. */
  readonly rimColor?: string;
  /** Opacity of that halo. Ignored without a `rimColor`. */
  readonly rimAlpha?: number;
}

/** Rim thickness in CSS pixels — one outline weight at any render scale. */
const RIM_WIDTH_PX = 2;

/** Directions the silhouette is smeared in to build the rim. */
const RIM_OFFSETS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const;

let bodySurface: CanvasSurface | null = null;
let bodyContext: CanvasRenderingContext2D | null = null;
let overlaySurface: CanvasSurface | null = null;
let overlayContext: CanvasRenderingContext2D | null = null;
let rimSurface: CanvasSurface | null = null;
let rimContext: CanvasRenderingContext2D | null = null;
let pristineSurface: CanvasSurface | null = null;
let pristineContext: CanvasRenderingContext2D | null = null;
let surfaceWidth = 0;
let surfaceHeight = 0;

/**
 * Guards against a composited entity whose own draw composites another one: the
 * scratch surfaces are shared, so the inner pass would erase the outer one
 * mid-composite.
 */
let compositing = false;

interface Surfaces {
  body: CanvasSurface;
  bodyCtx: CanvasRenderingContext2D;
  overlay: CanvasSurface;
  overlayCtx: CanvasRenderingContext2D;
  rim: CanvasSurface;
  rimCtx: CanvasRenderingContext2D;
  /**
   * The entity's silhouette as it drew it, before any layer touched it. The rim
   * is traced from this rather than from `body`, because a layer blended with
   * `lighter` or `multiply` raises alpha on every anti-aliased edge pixel — an
   * edge at 0.4 comes out near 0.7 — and a rim built after that hugs a
   * silhouette a little fatter than the character actually is.
   */
  pristine: CanvasSurface;
  pristineCtx: CanvasRenderingContext2D;
}

function acquireSurfaces(deviceWidth: number, deviceHeight: number): Surfaces {
  const needsRealloc =
    bodySurface === null ||
    bodyContext === null ||
    overlaySurface === null ||
    overlayContext === null ||
    rimSurface === null ||
    rimContext === null ||
    pristineSurface === null ||
    pristineContext === null ||
    surfaceWidth < deviceWidth ||
    surfaceHeight < deviceHeight;

  if (needsRealloc) {
    surfaceWidth = Math.max(surfaceWidth, deviceWidth);
    surfaceHeight = Math.max(surfaceHeight, deviceHeight);
    bodySurface = allocCanvas(surfaceWidth, surfaceHeight);
    bodyContext = surfaceContext(bodySurface);
    overlaySurface = allocCanvas(surfaceWidth, surfaceHeight);
    overlayContext = surfaceContext(overlaySurface);
    rimSurface = allocCanvas(surfaceWidth, surfaceHeight);
    rimContext = surfaceContext(rimSurface);
    pristineSurface = allocCanvas(surfaceWidth, surfaceHeight);
    pristineContext = surfaceContext(pristineSurface);
  }

  const body = bodySurface;
  const bodyCtx = bodyContext;
  const overlay = overlaySurface;
  const overlayCtx = overlayContext;
  const rim = rimSurface;
  const rimCtx = rimContext;
  const pristine = pristineSurface;
  const pristineCtx = pristineContext;
  if (
    body === null ||
    bodyCtx === null ||
    overlay === null ||
    overlayCtx === null ||
    rim === null ||
    rimCtx === null ||
    pristine === null ||
    pristineCtx === null
  ) {
    throw new Error('Silhouette scratch surfaces failed to initialise');
  }
  return { body, bodyCtx, overlay, overlayCtx, rim, rimCtx, pristine, pristineCtx };
}

/**
 * Clearing only the box in use is safe despite the surfaces being grown to the
 * largest entity ever composited: nothing outside the box is ever read back, and
 * the entity's own draw is clipped to it, so a bigger predecessor's pixels
 * cannot survive anywhere that matters.
 */
function resetSurface(ctx: CanvasRenderingContext2D, deviceWidth: number, deviceHeight: number) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.filter = 'none';
  ctx.clearRect(0, 0, deviceWidth, deviceHeight);
}

/**
 * Draw an entity with every layer clipped to the entity's own shape.
 *
 * @param ctx    the destination context, already carrying the render-scale transform
 * @param bounds screen-space box the draw stays inside; anything outside is cut off
 * @param layers coats of paint, applied in order; an empty list draws the entity plainly
 * @param draw   the entity's own drawing, which must be side-effect free with
 *               respect to the context it is handed
 */
export function drawWithSilhouetteLayers(
  ctx: CanvasRenderingContext2D,
  bounds: ScreenBounds,
  layers: readonly SilhouetteLayer[],
  draw: (target: CanvasRenderingContext2D) => void,
): void {
  if (layers.length === 0) {
    draw(ctx);
    return;
  }

  // The scale is read from the destination rather than from the global render
  // scale: the canvas rounds its backing store to whole pixels, so the two
  // differ by a hair, and that hair is the difference between a 1:1 blit and a
  // resample of the sprite the composite is meant to sharpen attention onto.
  const transform = ctx.getTransform();
  const scaleX = transform.a;
  const scaleY = transform.d;
  const isPlainScale = transform.b === 0 && transform.c === 0 && scaleX > 0 && scaleY > 0;

  if (compositing || !isPlainScale) {
    draw(ctx);
    return;
  }

  // Snapping the origin to the device grid is what keeps the blit 1:1.
  const deviceX = Math.floor(bounds.x * scaleX + transform.e);
  const deviceY = Math.floor(bounds.y * scaleY + transform.f);
  const deviceWidth = Math.ceil((bounds.x + bounds.width) * scaleX + transform.e) - deviceX;
  const deviceHeight = Math.ceil((bounds.y + bounds.height) * scaleY + transform.f) - deviceY;

  if (deviceWidth <= 0 || deviceHeight <= 0) {
    draw(ctx);
    return;
  }

  const originX = (deviceX - transform.e) / scaleX;
  const originY = (deviceY - transform.f) / scaleY;
  const cssWidth = deviceWidth / scaleX;
  const cssHeight = deviceHeight / scaleY;
  // Origin shifted onto the box so the entity's own screen-space maths — every
  // subclass computes `x - camX` for itself — lands inside the scratch.
  const scratchOffsetX = transform.e - deviceX;
  const scratchOffsetY = transform.f - deviceY;
  const paintBox: ScreenBounds = {
    x: originX,
    y: originY,
    width: cssWidth,
    height: cssHeight,
  };

  compositing = true;
  try {
    const surfaces = acquireSurfaces(deviceWidth, deviceHeight);
    const { body, bodyCtx, overlay, overlayCtx } = surfaces;

    resetSurface(bodyCtx, deviceWidth, deviceHeight);
    bodyCtx.setTransform(scaleX, 0, 0, scaleY, scratchOffsetX, scratchOffsetY);
    bodyCtx.save();
    bodyCtx.beginPath();
    bodyCtx.rect(originX, originY, cssWidth, cssHeight);
    bodyCtx.clip();
    draw(bodyCtx);
    bodyCtx.restore();

    // Snapshotted before the layer loop; see `Surfaces.pristine`. Skipped
    // entirely when nothing asks for a rim, which is the common case.
    const wantsRim = layers.some((layer) => layer.rimColor !== undefined);
    if (wantsRim) {
      const target = surfaces.pristineCtx;
      resetSurface(target, deviceWidth, deviceHeight);
      target.drawImage(body, 0, 0, deviceWidth, deviceHeight, 0, 0, deviceWidth, deviceHeight);
    }

    for (const layer of layers) {
      const paint = layer.paint;
      if (paint === undefined) continue;

      resetSurface(overlayCtx, deviceWidth, deviceHeight);
      overlayCtx.setTransform(scaleX, 0, 0, scaleY, scratchOffsetX, scratchOffsetY);
      overlayCtx.save();
      overlayCtx.beginPath();
      overlayCtx.rect(originX, originY, cssWidth, cssHeight);
      overlayCtx.clip();
      paint(overlayCtx, paintBox);
      overlayCtx.restore();

      // Every blit here carries explicit rects. The surfaces are shared and grown
      // to the largest entity ever composited and never shrink, so an unrect'd
      // copy would make a rat pay boss-sized bandwidth once a boss has appeared.
      overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
      overlayCtx.globalAlpha = 1;
      overlayCtx.globalCompositeOperation = 'destination-in';
      overlayCtx.drawImage(body, 0, 0, deviceWidth, deviceHeight, 0, 0, deviceWidth, deviceHeight);

      bodyCtx.setTransform(1, 0, 0, 1, 0, 0);
      bodyCtx.globalAlpha = layer.alpha ?? 1;
      // `source-atop` rather than `source-over` by default: the overlay is
      // already masked to the body, and source-atop leaves the body's alpha
      // exactly as the entity drew it. source-over would raise alpha on every
      // anti-aliased edge pixel, quietly fattening the silhouette the rim is
      // then traced from.
      bodyCtx.globalCompositeOperation = layer.blend ?? 'source-atop';
      bodyCtx.drawImage(overlay, 0, 0, deviceWidth, deviceHeight, 0, 0, deviceWidth, deviceHeight);
      bodyCtx.globalCompositeOperation = 'source-over';
      bodyCtx.globalAlpha = 1;
    }

    ctx.save();
    ctx.globalAlpha = 1;
    ctx.drawImage(body, 0, 0, deviceWidth, deviceHeight, originX, originY, cssWidth, cssHeight);

    if (wantsRim) {
      // The halo's *shape* is the same for every layer that asks for one, since
      // it is smeared from the pristine snapshot rather than from the body the
      // layers have been mutating. Built once; each layer only re-colours it.
      buildRimShape(surfaces, deviceWidth, deviceHeight, scaleX);
      for (const layer of layers) {
        const rimColor = layer.rimColor;
        if (rimColor === undefined) continue;
        const tinted = tintRim(surfaces, deviceWidth, deviceHeight, rimColor);
        ctx.globalAlpha = Math.min(1, layer.rimAlpha ?? 1);
        ctx.drawImage(
          tinted,
          0,
          0,
          deviceWidth,
          deviceHeight,
          originX,
          originY,
          cssWidth,
          cssHeight,
        );
      }
    }
    ctx.restore();
  } finally {
    compositing = false;
  }
}

/**
 * Build the uncoloured outline that hugs the silhouette: the pristine shape
 * smeared one rim width in each direction, then punched through by itself so
 * only the halo that spills past the edge survives.
 */
function buildRimShape(
  surfaces: Surfaces,
  deviceWidth: number,
  deviceHeight: number,
  deviceScale: number,
): void {
  const { pristine, rimCtx: target } = surfaces;
  const rimDevicePx = RIM_WIDTH_PX * deviceScale;

  resetSurface(target, deviceWidth, deviceHeight);
  for (const [dx, dy] of RIM_OFFSETS) {
    target.drawImage(
      pristine,
      0,
      0,
      deviceWidth,
      deviceHeight,
      dx * rimDevicePx,
      dy * rimDevicePx,
      deviceWidth,
      deviceHeight,
    );
  }
  target.globalCompositeOperation = 'destination-out';
  target.drawImage(pristine, 0, 0, deviceWidth, deviceHeight, 0, 0, deviceWidth, deviceHeight);
  target.globalCompositeOperation = 'source-over';
}

/**
 * Stamp the halo shape in one colour, onto the overlay surface — which is free
 * by this point, and has to be borrowed rather than tinting `rim` in place
 * because `source-in` would consume the shape the next layer still needs.
 */
function tintRim(
  surfaces: Surfaces,
  deviceWidth: number,
  deviceHeight: number,
  color: string,
): CanvasSurface {
  const { rim, overlay, overlayCtx: target } = surfaces;

  resetSurface(target, deviceWidth, deviceHeight);
  target.drawImage(rim, 0, 0, deviceWidth, deviceHeight, 0, 0, deviceWidth, deviceHeight);
  target.globalCompositeOperation = 'source-in';
  target.fillStyle = color;
  target.fillRect(0, 0, deviceWidth, deviceHeight);
  target.globalCompositeOperation = 'source-over';

  return overlay;
}
