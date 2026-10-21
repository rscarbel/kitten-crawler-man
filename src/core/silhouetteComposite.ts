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

import { allocCanvas, releaseSurface, surfaceContext, type CanvasSurface } from './canvasSurface';
import { renderQuality } from './RenderQuality';
import { cachedCellRim, type PlacedRim } from './cellRimCache';
import {
  recordFigureCellBlits,
  takeRecordedFigureCell,
  type FigureCellBlit,
} from '../sprites/figure/figureFrameCache';
import { frameTime } from '../utils';

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
  /** A hit flash: the one coat reduced detail may trade for a cheaper cue. */
  readonly isHitFlash?: boolean;
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

/**
 * At reduced detail, how many bodies a frame composites a hit flash onto. A
 * wave struck by one boulder flashes all at once, and each composite is
 * several full-box passes; the rest show the hit as a brief fade instead.
 * Status coats and rims last far longer than a flash and are always kept.
 */
const REDUCED_DETAIL_FLASH_COMPOSITES_PER_FRAME = 6;
/** How far a body over that count fades at the peak of its flash, as a share of the flash's own alpha. */
const REDUCED_DETAIL_FLASH_FADE = 0.5;
/**
 * At reduced detail a rim is one tinted copy of the silhouette, scaled out from
 * the box's middle by this many rim widths a side and laid under the body,
 * rather than four offset copies punched out by the body.
 */
const UNDERLAY_RIM_WIDTHS = 1;

let flashCompositesFrameTime = Number.NaN;
let flashCompositesThisFrame = 0;
/** The layers left once a hit flash is dropped; reused, since a composite never nests. */
const layersWithoutFlash: SilhouetteLayer[] = [];

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
    const grownWidth = Math.max(surfaceWidth, deviceWidth);
    const grownHeight = Math.max(surfaceHeight, deviceHeight);
    for (const outgrown of [bodySurface, overlaySurface, rimSurface, pristineSurface]) {
      if (outgrown !== null) releaseSurface(outgrown);
    }
    // Cleared before reallocating so a context refused partway leaves the set
    // incomplete, which the next call rebuilds, rather than holding released surfaces.
    bodySurface = overlaySurface = rimSurface = pristineSurface = null;
    bodyContext = overlayContext = rimContext = pristineContext = null;
    surfaceWidth = grownWidth;
    surfaceHeight = grownHeight;
    bodySurface = allocCanvas('figureScratch', surfaceWidth, surfaceHeight);
    bodyContext = surfaceContext(bodySurface);
    overlaySurface = allocCanvas('figureScratch', surfaceWidth, surfaceHeight);
    overlayContext = surfaceContext(overlaySurface);
    rimSurface = allocCanvas('figureScratch', surfaceWidth, surfaceHeight);
    rimContext = surfaceContext(rimSurface);
    pristineSurface = allocCanvas('figureScratch', surfaceWidth, surfaceHeight);
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

  const fullDetail = renderQuality.fullDetail;
  let activeLayers = layers;
  let bodyOpacity = 1;
  const flashAlpha = fullDetail ? null : hitFlashAlpha(layers);
  if (flashAlpha !== null && !claimFlashComposite()) {
    activeLayers = withoutHitFlash(layers);
    bodyOpacity = 1 - flashAlpha * REDUCED_DETAIL_FLASH_FADE;
    if (activeLayers.length === 0) {
      ctx.save();
      ctx.globalAlpha *= bodyOpacity;
      draw(ctx);
      ctx.restore();
      return;
    }
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

    // Snapshotted before the layer loop; see `Surfaces.pristine`. Skipped
    // entirely when nothing asks for a rim, which is the common case.
    const wantsRim = activeLayers.some((layer) => layer.rimColor !== undefined);
    // With no coat to change it, the body is still the silhouette as drawn.
    const pristineIsBody = activeLayers.every((layer) => layer.paint === undefined);
    // A rim and nothing else, as a converted ally wears for its whole life, can
    // come from a rim built once for the figure cell the body is drawn as —
    // when the body is exactly that one cell and nothing besides.
    const rimFromCell = fullDetail && wantsRim && pristineIsBody;

    resetSurface(bodyCtx, deviceWidth, deviceHeight);
    bodyCtx.setTransform(scaleX, 0, 0, scaleY, scratchOffsetX, scratchOffsetY);
    bodyCtx.save();
    bodyCtx.beginPath();
    bodyCtx.rect(originX, originY, cssWidth, cssHeight);
    bodyCtx.clip();
    const loneCell = rimFromCell ? drawRecordingLoneCell(bodyCtx, draw) : null;
    if (!rimFromCell) draw(bodyCtx);
    bodyCtx.restore();
    if (wantsRim && !pristineIsBody) {
      const target = surfaces.pristineCtx;
      resetSurface(target, deviceWidth, deviceHeight);
      target.drawImage(body, 0, 0, deviceWidth, deviceHeight, 0, 0, deviceWidth, deviceHeight);
    }

    for (const layer of activeLayers) {
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
    const pristine = pristineIsBody ? body : surfaces.pristine;
    if (wantsRim && !fullDetail) {
      const underlay = {
        x: originX - RIM_WIDTH_PX * UNDERLAY_RIM_WIDTHS,
        y: originY - RIM_WIDTH_PX * UNDERLAY_RIM_WIDTHS,
        width: cssWidth + RIM_WIDTH_PX * UNDERLAY_RIM_WIDTHS * 2,
        height: cssHeight + RIM_WIDTH_PX * UNDERLAY_RIM_WIDTHS * 2,
      };
      for (const layer of activeLayers) {
        const rimColor = layer.rimColor;
        if (rimColor === undefined) continue;
        const tinted = tintSilhouette(surfaces, pristine, deviceWidth, deviceHeight, rimColor);
        ctx.globalAlpha = Math.min(1, layer.rimAlpha ?? 1);
        ctx.drawImage(
          tinted,
          0,
          0,
          deviceWidth,
          deviceHeight,
          underlay.x,
          underlay.y,
          underlay.width,
          underlay.height,
        );
      }
      ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = bodyOpacity;
    ctx.drawImage(body, 0, 0, deviceWidth, deviceHeight, originX, originY, cssWidth, cssHeight);

    const rimDevicePx = RIM_WIDTH_PX * scaleX;
    const cellRims =
      loneCell === null
        ? null
        : cellRimsFor(loneCell, activeLayers, deviceWidth, deviceHeight, rimDevicePx);
    if (cellRims !== null) {
      for (const { rim, alpha } of cellRims) {
        ctx.globalAlpha = alpha;
        ctx.drawImage(
          rim.surface,
          originX + rim.deviceX / scaleX,
          originY + rim.deviceY / scaleY,
          rim.surface.width / scaleX,
          rim.surface.height / scaleY,
        );
      }
    } else if (wantsRim && fullDetail) {
      // The halo's *shape* is the same for every layer that asks for one, since
      // it is smeared from the pristine snapshot rather than from the body the
      // layers have been mutating. Built once; each layer only re-colours it.
      buildRimShape(surfaces, pristine, deviceWidth, deviceHeight, scaleX);
      for (const layer of activeLayers) {
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
  pristine: CanvasSurface,
  deviceWidth: number,
  deviceHeight: number,
  deviceScale: number,
): void {
  const { rimCtx: target } = surfaces;
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

/**
 * The silhouette in one flat colour, on the rim surface, for the reduced-detail
 * underlay rim: the halo is whatever of it the body, drawn over it, leaves.
 */
function tintSilhouette(
  surfaces: Surfaces,
  silhouette: CanvasSurface,
  deviceWidth: number,
  deviceHeight: number,
  color: string,
): CanvasSurface {
  const { rim, rimCtx: target } = surfaces;
  resetSurface(target, deviceWidth, deviceHeight);
  target.drawImage(silhouette, 0, 0, deviceWidth, deviceHeight, 0, 0, deviceWidth, deviceHeight);
  target.globalCompositeOperation = 'source-in';
  target.fillStyle = color;
  target.fillRect(0, 0, deviceWidth, deviceHeight);
  target.globalCompositeOperation = 'source-over';
  return rim;
}

/** The hit flash's alpha, or null when no layer is one. */
function hitFlashAlpha(layers: readonly SilhouetteLayer[]): number | null {
  for (const layer of layers) {
    if (layer.isHitFlash === true) return layer.alpha ?? 1;
  }
  return null;
}

function withoutHitFlash(layers: readonly SilhouetteLayer[]): readonly SilhouetteLayer[] {
  layersWithoutFlash.length = 0;
  for (const layer of layers) {
    if (layer.isHitFlash !== true) layersWithoutFlash.push(layer);
  }
  return layersWithoutFlash;
}

/** Counts one flash composite against this frame's reduced-detail allowance; false once it is spent. */
function claimFlashComposite(): boolean {
  if (flashCompositesFrameTime !== frameTime) {
    flashCompositesFrameTime = frameTime;
    flashCompositesThisFrame = 0;
  }
  if (flashCompositesThisFrame >= REDUCED_DETAIL_FLASH_COMPOSITES_PER_FRAME) return false;
  flashCompositesThisFrame++;
  return true;
}

/** Ink-laying calls on a context: every way a draw can change its pixels. */
const INK_METHODS: ReadonlySet<string | symbol> = new Set([
  'drawImage',
  'fill',
  'stroke',
  'fillRect',
  'strokeRect',
  'fillText',
  'strokeText',
  'putImageData',
  'clearRect',
]);

/** Ink calls made through {@link countingContext} since it was last zeroed. */
let inkCalls = 0;
const countingContexts = new WeakMap<CanvasRenderingContext2D, CanvasRenderingContext2D>();

/**
 * `target` behind a proxy that counts its ink calls, so a body's draw can be
 * told apart from "one cell blit and nothing else" without the body saying
 * what it draws. One proxy per context, its method wrappers made once each.
 */
function countingContext(target: CanvasRenderingContext2D): CanvasRenderingContext2D {
  const held = countingContexts.get(target);
  if (held !== undefined) return held;
  const wrappers = new Map<string | symbol, (...args: unknown[]) => unknown>();
  const proxy = new Proxy(target, {
    get(context, property) {
      const value: unknown = Reflect.get(context, property, context);
      if (typeof value !== 'function') return value;
      const known = wrappers.get(property);
      if (known !== undefined) return known;
      const counts = INK_METHODS.has(property);
      const wrapper = (...args: unknown[]): unknown => {
        if (counts) inkCalls++;
        return Reflect.apply(value, context, args);
      };
      wrappers.set(property, wrapper);
      return wrapper;
    },
    set(context, property, newValue) {
      return Reflect.set(context, property, newValue, context);
    },
  });
  countingContexts.set(target, proxy);
  return proxy;
}

/**
 * Draws the body into `target` and returns the figure cell it was, when it
 * was exactly one plain cell blit and laid no other ink; null otherwise.
 */
function drawRecordingLoneCell(
  target: CanvasRenderingContext2D,
  draw: (target: CanvasRenderingContext2D) => void,
): FigureCellBlit | null {
  inkCalls = 0;
  recordFigureCellBlits();
  let cell: FigureCellBlit | null = null;
  try {
    draw(countingContext(target));
  } finally {
    cell = takeRecordedFigureCell();
  }
  if (cell === null || !cell.plain || inkCalls !== 1) return null;
  return cell;
}

/**
 * Each rim layer's cached rim of `cell`, or null when any one cannot be
 * cached, so the live trace draws them all and they never disagree.
 */
function cellRimsFor(
  cell: FigureCellBlit,
  layers: readonly SilhouetteLayer[],
  deviceWidth: number,
  deviceHeight: number,
  rimDevicePx: number,
): Array<{ rim: PlacedRim; alpha: number }> | null {
  const rims: Array<{ rim: PlacedRim; alpha: number }> = [];
  for (const layer of layers) {
    const rimColor = layer.rimColor;
    if (rimColor === undefined) continue;
    const rim = cachedCellRim(cell, 0, 0, deviceWidth, deviceHeight, rimDevicePx, rimColor);
    if (rim === null) return null;
    rims.push({ rim, alpha: Math.min(1, layer.rimAlpha ?? 1) });
  }
  return rims;
}
