/**
 * Viewport size in CSS pixels, decoupled from the canvas backing store.
 *
 * `canvas.width`/`canvas.height` are the backing store, which is CSS size
 * multiplied by {@link getRenderScale} so the game can render at a higher
 * device-pixel density. Every consumer that means "how big is the visible
 * area" — world-space culling, camera clamping, UI layout — wants CSS pixels
 * and must read {@link viewportWidth}/{@link viewportHeight} instead.
 */

/** Scale of 1 means the backing store matches the CSS size exactly. */
const UNSCALED = 1;

let widthCss = 0;
let heightCss = 0;
let renderScale = UNSCALED;

/** Called by SceneManager whenever the canvas is sized or resized. */
export function setViewportSize(width: number, height: number): void {
  widthCss = width;
  heightCss = height;
}

/** Visible width in CSS pixels. */
export function viewportWidth(): number {
  return widthCss;
}

/** Visible height in CSS pixels. */
export function viewportHeight(): number {
  return heightCss;
}

/** Backing-store pixels per CSS pixel. */
export function getRenderScale(): number {
  return renderScale;
}

/**
 * Store the render scale. Does not resize anything on its own — SceneManager
 * owns the canvas and re-applies the backing store and context transform.
 */
export function setRenderScaleValue(scale: number): void {
  renderScale = scale;
}
