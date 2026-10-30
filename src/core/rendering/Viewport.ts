/**
 * Viewport size in CSS pixels, decoupled from the canvas backing store.
 *
 * `canvas.width`/`canvas.height` are the backing store, which is CSS size
 * multiplied by {@link getRenderScale} so the game can render at a higher
 * device-pixel density. Every consumer that means "how big is the visible
 * area" on the screen — camera framing, UI layout — wants CSS pixels and
 * must read {@link viewportWidth}/{@link viewportHeight} instead. World-space
 * code measures the part of the world on screen with the frame's `Camera`
 * (`src/core/rendering/camera.ts`), which divides this by the camera's zoom.
 */

declare const screenPxBrand: unique symbol;

/**
 * A length on the screen in CSS pixels. Branded so that the screen's size can
 * never stand in for the camera's view of the world, which differs from it by
 * the camera's zoom: world cullers take a `Camera` or `WorldPx` sizes, so one
 * handed {@link viewportWidth} fails to compile.
 */
export type ScreenPx = number & { readonly [screenPxBrand]: true };

function isScreenPx(value: number): value is ScreenPx {
  return Number.isFinite(value) && value >= 0;
}

/** `value` CSS pixels as a screen length. */
function screenPx(value: number): ScreenPx {
  if (!isScreenPx(value)) throw new RangeError(`Not a screen length: ${value}`);
  return value;
}

/** Scale of 1 means the backing store matches the CSS size exactly. */
const UNSCALED = 1;

let widthCss = screenPx(0);
let heightCss = screenPx(0);
let renderScale = UNSCALED;

/** Called by SceneManager whenever the canvas is sized or resized. */
export function setViewportSize(width: number, height: number): void {
  widthCss = screenPx(width);
  heightCss = screenPx(height);
}

/** Visible width in CSS pixels. */
export function viewportWidth(): ScreenPx {
  return widthCss;
}

/** Visible height in CSS pixels. */
export function viewportHeight(): ScreenPx {
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
