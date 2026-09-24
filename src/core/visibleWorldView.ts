/**
 * The part of the world the player can see this frame, published by the
 * scene that owns the camera.
 *
 * Published rather than threaded through `updateAI` for the same reason as
 * `setPackAlertGrid`: a mob has no reference to the scene it lives in, and a
 * handful of rules — a fairy that must be seen to cast, a sound that must not
 * come from off screen — would otherwise cost every mob a parameter it never
 * reads. The scene publishes the camera it actually drew with, so a camera
 * pinned against a map edge, a cutscene override or a shake is all accounted
 * for; "the crawler plus half a viewport" would be wrong at every map border.
 */

import { viewportHeight, viewportWidth } from './Viewport';

/** A disc outside which the scene draws nothing but fog. */
export interface WorldSight {
  readonly x: number;
  readonly y: number;
  readonly radiusPx: number;
}

/** A world-space rectangle the camera shows, optionally narrowed by fog. */
export interface VisibleWorldView {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /** Where the scene's fog leaves the world clear; null where it draws no fog. */
  readonly sight: WorldSight | null;
}

let published: VisibleWorldView | null = null;

/**
 * Publish this frame's view. Called by a scene before its mobs update; pass
 * null when tearing a scene down so a stale view from another map can never
 * be tested against.
 */
export function setVisibleWorldView(view: VisibleWorldView | null): void {
  published = view;
}

/** The view last published, or null when no scene has published one. */
export function visibleWorldView(): VisibleWorldView | null {
  return published;
}

/**
 * The view a camera whose top-left sits at `camera` shows on the current
 * viewport. `heightPx` is for a scene whose bottom band is covered by opaque UI.
 */
export function cameraWorldView(
  camera: { readonly x: number; readonly y: number },
  sight: WorldSight | null,
  heightPx: number = viewportHeight(),
): VisibleWorldView {
  return { left: camera.x, top: camera.y, width: viewportWidth(), height: heightPx, sight };
}

/**
 * Whether the world point (`x`, `y`) is at least `insetPx` inside the
 * published view and inside its clear sight. With no view published nothing
 * counts as seen: every caller is a rule that holds something back until the
 * player can see it, and holding back is the side that cannot leak a cast or a
 * sound from off screen.
 */
export function isWorldPointInView(x: number, y: number, insetPx: number): boolean {
  const view = published;
  if (view === null) return false;
  const insideX = x >= view.left + insetPx && x <= view.left + view.width - insetPx;
  const insideY = y >= view.top + insetPx && y <= view.top + view.height - insetPx;
  if (!insideX || !insideY) return false;
  const sight = view.sight;
  if (sight === null) return true;
  return Math.hypot(x - sight.x, y - sight.y) <= sight.radiusPx - insetPx;
}
