/**
 * The camera a scene draws a frame with: where its view of the world starts,
 * how much of the world it shows and how far it is zoomed.
 *
 * Built by the scene that owns the camera and handed to world code through
 * `RenderContext.camera` and `SystemContext.camera`, so every culler and
 * every screen-to-world conversion measures the view the frame is actually
 * drawn with. Under a zoom the world view is larger than the screen; the
 * screen's own size ({@link viewportWidth}) is for screen chrome only.
 */

import type { Rect } from '../../ui/core/geom';
import { viewportHeight, viewportWidth, type ScreenPx } from './Viewport';

declare const worldPxBrand: unique symbol;

/**
 * A length across the camera's view of the world, in world pixels. Branded so
 * that a screen length ({@link ScreenPx}) cannot be passed where the world
 * view's size is meant: the two differ by the camera's zoom.
 */
export type WorldPx = number & { readonly [worldPxBrand]: true };

function isWorldPx(value: number): value is WorldPx {
  return Number.isFinite(value) && value >= 0;
}

/** `value` world pixels as a length across the world view. */
export function worldPx(value: number): WorldPx {
  if (!isWorldPx(value)) throw new RangeError(`Not a world view length: ${value}`);
  return value;
}

/** The camera's zoom when nothing has asked it to frame anything. */
export const UNZOOMED = 1;

export interface Camera {
  /** World x of the view's top-left corner. */
  readonly x: number;
  /** World y of the view's top-left corner. */
  readonly y: number;
  /** Width of the world the camera shows. */
  readonly viewWidth: WorldPx;
  /** Height of the world the camera shows. */
  readonly viewHeight: WorldPx;
  /** CSS pixels per world pixel: 1 at normal framing, below 1 while zoomed out. */
  readonly zoom: number;
}

/** A screen length in the world view's units under a zoom of `zoom`. */
function screenToWorldLength(length: ScreenPx, zoom: number): WorldPx {
  return worldPx(length / zoom);
}

/** The world view a camera zoomed by `zoom` shows of the current screen. */
export function worldViewSize(zoom: number): { width: WorldPx; height: WorldPx } {
  return {
    width: screenToWorldLength(viewportWidth(), zoom),
    height: screenToWorldLength(viewportHeight(), zoom),
  };
}

/** A camera whose view starts at `topLeft` and is zoomed by `zoom`, on the current screen. */
export function cameraAt(
  topLeft: { readonly x: number; readonly y: number },
  zoom: number,
): Camera {
  const view = worldViewSize(zoom);
  return { x: topLeft.x, y: topLeft.y, viewWidth: view.width, viewHeight: view.height, zoom };
}

/**
 * The screen point (`screenX`, `screenY`), in CSS pixels, in the world view's
 * units: offset from the camera's top-left in world pixels.
 */
export function screenToWorldView(
  camera: Pick<Camera, 'zoom'>,
  screenX: number,
  screenY: number,
): { x: number; y: number } {
  return { x: screenX / camera.zoom, y: screenY / camera.zoom };
}

/** The world point under the screen point (`screenX`, `screenY`), both in CSS pixels. */
export function screenToWorld(
  camera: Camera,
  screenX: number,
  screenY: number,
): { x: number; y: number } {
  return { x: screenX / camera.zoom + camera.x, y: screenY / camera.zoom + camera.y };
}

/** The screen point, in CSS pixels, the world point (`worldX`, `worldY`) is drawn at. */
export function worldToScreen(
  camera: Camera,
  worldX: number,
  worldY: number,
): { x: number; y: number } {
  return { x: (worldX - camera.x) * camera.zoom, y: (worldY - camera.y) * camera.zoom };
}

/** The screen rect, in CSS pixels, the world rect `rect` is drawn over. */
export function worldToScreenRect(camera: Camera, rect: Rect): Rect {
  const topLeft = worldToScreen(camera, rect.x, rect.y);
  return { x: topLeft.x, y: topLeft.y, w: rect.w * camera.zoom, h: rect.h * camera.zoom };
}

/** `rect` on the screen, in the world view's units: what world chrome drawn under the camera's zoom measures against. */
export function toWorldViewRect(rect: Rect, camera: Pick<Camera, 'zoom'>): Rect {
  const zoom = camera.zoom;
  return { x: rect.x / zoom, y: rect.y / zoom, w: rect.w / zoom, h: rect.h / zoom };
}
