/**
 * Off-screen drawing surfaces shared by the tile caches and the pre-rendered
 * sprite compositions.
 */
export type CanvasSurface = OffscreenCanvas | HTMLCanvasElement;

/**
 * Allocates an OffscreenCanvas when available, falling back to a regular
 * HTMLCanvasElement for environments that don't support OffscreenCanvas.
 * OffscreenCanvas avoids layout-tree involvement and is generally faster.
 */
export function allocCanvas(w: number, h: number): CanvasSurface {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(w, h);
  }
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
 * Returns the 2D drawing context of an off-screen surface.
 *
 * OffscreenCanvas yields an OffscreenCanvasRenderingContext2D — a distinct
 * nominal type exposing the identical drawing API. Every renderer in the engine
 * is written against CanvasRenderingContext2D, so the two are unified here once
 * rather than at each of the dozens of call sites.
 */
export function surfaceContext(surface: CanvasSurface): CanvasRenderingContext2D {
  const settings = readFrequently.has(surface) ? { willReadFrequently: true } : undefined;
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const ctx = surface.getContext('2d', settings) as CanvasRenderingContext2D | null;
  if (ctx === null) {
    throw new Error('Failed to acquire a 2D canvas context');
  }
  return ctx;
}
