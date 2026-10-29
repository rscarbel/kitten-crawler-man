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

/**
 * CSS pixels per world pixel: 1 at the camera's normal framing, below 1
 * while the camera is zoomed out to keep something in view. The screen keeps
 * its size; the world pass is drawn scaled by this, so the part of the world
 * it shows is {@link worldViewWidth} by {@link worldViewHeight}.
 */
let worldZoom = UNSCALED;

/**
 * Publish the camera's zoom for this frame. Called by the scene that owns the
 * camera before anything reads the world view; a scene leaving the world sets
 * it back to 1 so the next scene never inherits a zoomed view.
 */
export function setWorldZoom(zoom: number): void {
  worldZoom = zoom;
}

/** The zoom last published; see {@link setWorldZoom}. */
export function getWorldZoom(): number {
  return worldZoom;
}

/**
 * Width of the world the camera shows, in world pixels. What world-space
 * culling, camera clamping and anything drawn under the world pass's zoom
 * measure against; screen-space UI keeps {@link viewportWidth}.
 */
export function worldViewWidth(): number {
  return widthCss / worldZoom;
}

/** Height of the world the camera shows, in world pixels; see {@link worldViewWidth}. */
export function worldViewHeight(): number {
  return heightCss / worldZoom;
}
