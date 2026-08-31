/**
 * The bridge between node-canvas's 2D context and the one the game is written
 * against.
 *
 * node-canvas implements every call the game's painters make, but it is a
 * structurally distinct type — it lacks `filter`, `createConicGradient` and a
 * handful of others no painter touches. Bridging it once here, rather than at
 * each harness that draws a runtime painter offline, is the same trade
 * `src/core/canvasSurface` makes for `OffscreenCanvas`.
 */

import { createCanvas, type Canvas } from 'canvas';

import type { CanvasSurface } from '../src/core/canvasSurface.js';

export type NodeContext = ReturnType<ReturnType<typeof createCanvas>['getContext']>;

export function asGameContext(ctx: NodeContext): CanvasRenderingContext2D {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return ctx as unknown as CanvasRenderingContext2D;
}

/**
 * The same bridge in the other direction, for a surface a runtime painter
 * allocated for itself.
 *
 * `allocCanvas` falls back to `document.createElement('canvas')`, which the
 * shims in `nodeCanvasGlobals` answer with a real node canvas — so the object
 * already is one, and only its static type says otherwise. A harness that has
 * to encode a PNG or blit the result into a node context needs that type back.
 */
export function asNodeCanvas(surface: CanvasSurface): Canvas {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return surface as unknown as Canvas;
}

/** A node-canvas surface, typed as the game's context, in one call. */
export function gameContext(width: number, height: number): CanvasRenderingContext2D {
  return asGameContext(createCanvas(width, height).getContext('2d'));
}
