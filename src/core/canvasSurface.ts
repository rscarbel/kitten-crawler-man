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
 * Returns the 2D drawing context of an off-screen surface.
 *
 * OffscreenCanvas yields an OffscreenCanvasRenderingContext2D — a distinct
 * nominal type exposing the identical drawing API. Every renderer in the engine
 * is written against CanvasRenderingContext2D, so the two are unified here once
 * rather than at each of the dozens of call sites.
 */
export function surfaceContext(surface: CanvasSurface): CanvasRenderingContext2D {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const ctx = surface.getContext('2d') as CanvasRenderingContext2D | null;
  if (ctx === null) {
    throw new Error('Failed to acquire a 2D canvas context');
  }
  return ctx;
}
