/**
 * Silhouette-accurate hit feedback.
 *
 * A creature's art has no fixed relationship to the tile it occupies — sheet
 * sprites are anchored by their manifest, the procedural figures draw at twice
 * tile scale anchored on the feet, and a boss can reach four tiles past its
 * own. Feedback painted on the tile therefore lands wherever the tile happens
 * to be rather than on the thing that was hit. Instead the entity is drawn once
 * into a scratch surface and the tint is composited *through its own alpha*, so
 * the flash is exactly the shape the player sees, whatever that shape is.
 */

import { allocCanvas, surfaceContext, type CanvasSurface } from './canvasSurface';

/** Screen-space box, in CSS pixels, that a flashing entity draws inside. */
export interface ScreenBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Peak opacity of the tint at the moment of impact. High enough to read at a
 * glance during a melee, low enough that the sprite underneath stays legible.
 */
const FLASH_PEAK_ALPHA = 0.72;

/**
 * Fraction of the flash's life spent as a hot white core before it settles into
 * red. The impact frame reads as a strike; the tail reads as damage.
 */
const WHITE_CORE_FRACTION = 0.2;

const FLASH_CORE_COLOR = '#fff1f1';
const FLASH_TINT_COLOR = '#ff2020';

/**
 * Extra opacity the rim carries over the body tint, so the silhouette keeps a
 * defined edge against a bright floor instead of washing into it.
 */
const RIM_ALPHA_BOOST = 0.35;

/** Rim thickness in CSS pixels — one outline weight at any render scale. */
const RIM_WIDTH_PX = 2;

/** Directions the silhouette is smeared in to build the rim. */
const RIM_OFFSETS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const;

let scratch: CanvasSurface | null = null;
let scratchCtx: CanvasRenderingContext2D | null = null;
let scratchWidth = 0;
let scratchHeight = 0;

let rim: CanvasSurface | null = null;
let rimCtx: CanvasRenderingContext2D | null = null;

/**
 * Guards against a flashing entity whose own draw renders another flashing
 * entity: the scratch surface is shared, so the inner pass would erase the
 * outer one mid-composite.
 */
let compositing = false;

interface Surfaces {
  bodyCtx: CanvasRenderingContext2D;
  rimCtx: CanvasRenderingContext2D;
  body: CanvasSurface;
  rim: CanvasSurface;
}

function acquireSurfaces(deviceWidth: number, deviceHeight: number): Surfaces {
  const needsRealloc =
    scratch === null ||
    scratchCtx === null ||
    rim === null ||
    rimCtx === null ||
    scratchWidth < deviceWidth ||
    scratchHeight < deviceHeight;

  if (needsRealloc) {
    scratchWidth = Math.max(scratchWidth, deviceWidth);
    scratchHeight = Math.max(scratchHeight, deviceHeight);
    scratch = allocCanvas(scratchWidth, scratchHeight);
    scratchCtx = surfaceContext(scratch);
    rim = allocCanvas(scratchWidth, scratchHeight);
    rimCtx = surfaceContext(rim);
  }

  const body = scratch;
  const bodyCtx = scratchCtx;
  const rimSurface = rim;
  const rimContext = rimCtx;
  if (body === null || bodyCtx === null || rimSurface === null || rimContext === null) {
    throw new Error('Hit-flash scratch surfaces failed to initialise');
  }
  return { body, bodyCtx, rim: rimSurface, rimCtx: rimContext };
}

/**
 * Clearing only the box in use is safe despite the surfaces being grown to the
 * largest entity ever flashed: nothing outside the box is ever read back, and
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
 * Draw an entity with a hit flash shaped like the entity itself.
 *
 * @param ctx      the destination context, already carrying the render-scale transform
 * @param bounds   screen-space box the draw stays inside; anything outside is cut off
 * @param progress 1 on the frame of impact, falling to 0 as the flash expires
 * @param draw     the entity's own drawing, which must be side-effect free with
 *                 respect to the context it is handed
 */
export function drawWithHitFlash(
  ctx: CanvasRenderingContext2D,
  bounds: ScreenBounds,
  progress: number,
  draw: (target: CanvasRenderingContext2D) => void,
): void {
  // Capped rather than trusted: an attack that sets a longer-than-standard
  // flash would otherwise ask for an alpha above 1, which the canvas discards —
  // leaving the previous alpha of 1 and a fully opaque red cut-out.
  const flash = Math.min(1, progress);
  if (flash <= 0) {
    draw(ctx);
    return;
  }

  // The scale is read from the destination rather than from the global render
  // scale: the canvas rounds its backing store to whole pixels, so the two
  // differ by a hair, and that hair is the difference between a 1:1 blit and a
  // resample of the sprite the flash is meant to sharpen attention onto.
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

  compositing = true;
  try {
    const surfaces = acquireSurfaces(deviceWidth, deviceHeight);
    const { body, bodyCtx } = surfaces;

    resetSurface(bodyCtx, deviceWidth, deviceHeight);
    // Origin shifted onto the box so the entity's own screen-space maths — every
    // subclass computes `x - camX` for itself — lands inside the scratch.
    bodyCtx.setTransform(scaleX, 0, 0, scaleY, transform.e - deviceX, transform.f - deviceY);
    bodyCtx.save();
    bodyCtx.beginPath();
    bodyCtx.rect(originX, originY, cssWidth, cssHeight);
    bodyCtx.clip();
    draw(bodyCtx);
    bodyCtx.restore();

    const rimAlpha = Math.min(1, flash * (FLASH_PEAK_ALPHA + RIM_ALPHA_BOOST));
    const bodyAlpha = flash * FLASH_PEAK_ALPHA;
    const tintColor = flash > 1 - WHITE_CORE_FRACTION ? FLASH_CORE_COLOR : FLASH_TINT_COLOR;

    const rimSurface = buildRim(surfaces, deviceWidth, deviceHeight, scaleX, tintColor);

    bodyCtx.globalCompositeOperation = 'source-atop';
    bodyCtx.globalAlpha = bodyAlpha;
    bodyCtx.fillStyle = tintColor;
    bodyCtx.fillRect(originX, originY, cssWidth, cssHeight);

    ctx.save();
    ctx.globalAlpha = 1;
    ctx.drawImage(body, 0, 0, deviceWidth, deviceHeight, originX, originY, cssWidth, cssHeight);
    ctx.globalAlpha = rimAlpha;
    ctx.drawImage(
      rimSurface,
      0,
      0,
      deviceWidth,
      deviceHeight,
      originX,
      originY,
      cssWidth,
      cssHeight,
    );
    ctx.restore();
  } finally {
    compositing = false;
  }
}

/**
 * Build the outline that hugs the silhouette: the body smeared one rim width in
 * each direction, then punched through by the body itself so only the halo that
 * spills past the edge survives.
 */
function buildRim(
  surfaces: Surfaces,
  deviceWidth: number,
  deviceHeight: number,
  deviceScale: number,
  color: string,
): CanvasSurface {
  const { body, rim: rimSurface, rimCtx: target } = surfaces;
  const rimDevicePx = RIM_WIDTH_PX * deviceScale;

  resetSurface(target, deviceWidth, deviceHeight);
  for (const [dx, dy] of RIM_OFFSETS) {
    target.drawImage(
      body,
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
  target.drawImage(body, 0, 0, deviceWidth, deviceHeight, 0, 0, deviceWidth, deviceHeight);
  target.globalCompositeOperation = 'source-in';
  target.fillStyle = color;
  target.fillRect(0, 0, deviceWidth, deviceHeight);
  target.globalCompositeOperation = 'source-over';

  return rimSurface;
}
