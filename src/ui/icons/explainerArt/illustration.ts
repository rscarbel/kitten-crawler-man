/**
 * The contract every explainer illustration is painted to: a band in its own
 * design-sized space, and a frame count since its page was turned to.
 */

export interface IllustrationRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Paints one page's illustration inside `rect`. `frame` counts 60 Hz frames
 * since the page was turned to, so an animation starts from its first beat.
 */
export type IllustrationPainter = (
  ctx: CanvasRenderingContext2D,
  rect: IllustrationRect,
  frame: number,
) => void;
