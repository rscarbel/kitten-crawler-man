/**
 * Off-screen drawing surfaces shared by the tile caches and the pre-rendered
 * sprite compositions.
 *
 * A detached `<canvas>` rather than an `OffscreenCanvas`. On the main thread
 * the two are drawn by the same accelerated backend, but only the element's
 * context is a `CanvasRenderingContext2D` — the type every painter in the
 * engine is written against. An `OffscreenCanvas` hands back a distinct
 * context type that could only be passed to those painters by asserting it was
 * something it is not.
 */
export type CanvasSurface = HTMLCanvasElement;

/** Allocates a detached canvas of the given size. */
export function allocCanvas(w: number, h: number): CanvasSurface {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/**
 * Surfaces whose context has been asked for with `willReadFrequently`.
 *
 * The flag is a property of the *context*, and a canvas hands back the same
 * context object on every `getContext` call — so it can only be set on the first
 * one, and `surfaceContext` has to know which surfaces were declared before it
 * fetches theirs. A `WeakSet` because the entry must not keep a released surface
 * alive: the caches here give their pixels back by shrinking a surface to
 * nothing and dropping it.
 */
const readFrequently = new WeakSet();

/**
 * Allocates a surface whose context will be read back pixel by pixel.
 *
 * A canvas the browser has put on the GPU has to be synchronised back to main
 * memory for every `getImageData`, and a painter that filters its own pixels —
 * the building kit's ink and outline passes are the case — does that several
 * times per frame it paints. Declaring the intent up front keeps the surface in
 * software, where those reads are free and the drawing is barely slower.
 *
 * Only for surfaces that are genuinely read back. Everything else wants the GPU.
 */
export function allocReadableCanvas(w: number, h: number): CanvasSurface {
  const surface = allocCanvas(w, h);
  readFrequently.add(surface);
  return surface;
}

/**
 * The browser refused a 2D context for a surface. In practice this is the
 * browser's canvas memory budget running out — iOS enforces one across every
 * canvas on the page — rather than a bug in the caller.
 */
export class CanvasContextUnavailableError extends Error {
  constructor() {
    super('Failed to acquire a 2D canvas context');
    this.name = 'CanvasContextUnavailableError';
  }
}

/** Returns the 2D drawing context of an off-screen surface. */
export function surfaceContext(surface: CanvasSurface): CanvasRenderingContext2D {
  const settings: CanvasRenderingContext2DSettings = {
    willReadFrequently: readFrequently.has(surface),
  };
  const ctx = surface.getContext('2d', settings);
  if (ctx === null) {
    throw new CanvasContextUnavailableError();
  }
  return ctx;
}

/** Gives a surface's pixels back at once rather than at the next collection. */
export function releaseSurface(surface: CanvasSurface): void {
  surface.width = 0;
  surface.height = 0;
}

/**
 * {@link surfaceContext} for a surface just allocated, which is given back if
 * the browser refuses it a context: a caller that throws on would otherwise
 * leave it holding its size until a collection.
 */
export function freshSurfaceContext(surface: CanvasSurface): CanvasRenderingContext2D {
  try {
    return surfaceContext(surface);
  } catch (error) {
    releaseSurface(surface);
    throw error;
  }
}
