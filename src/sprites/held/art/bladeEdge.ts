/**
 * How a flat head reads when it is turned edge-on to the camera: squeezed to
 * a sliver across the haft, with a glint running down the edge so the line
 * still reads as steel.
 */

import { rgba } from '../../art/carlArt';

type Ctx = CanvasRenderingContext2D;

/** How much of a flat head's breadth still shows edge-on: its thickness, not its width. */
export const EDGE_ON_BREADTH_SHARE = 0.3;
const GLINT_WIDTH = 0.012;
const GLINT_ALPHA = 0.9;
/** The glint stops short of both ends of the edge, as a share of its length. */
const GLINT_INSET_SHARE = 0.12;

/** Runs `paint` with item-local +Y squeezed to the head's edge-on thickness. */
export function seenOnEdge(ctx: Ctx, paint: () => void): void {
  ctx.save();
  ctx.scale(1, EDGE_ON_BREADTH_SHARE);
  paint();
  ctx.restore();
}

/** The bright line down an edge-on blade from `fromX` to `toX` along the haft. */
export function paintBladeEdgeGlint(ctx: Ctx, fromX: number, toX: number, colour: string): void {
  const inset = (toX - fromX) * GLINT_INSET_SHARE;
  ctx.save();
  ctx.strokeStyle = rgba(colour, GLINT_ALPHA);
  ctx.lineWidth = GLINT_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(fromX + inset, 0);
  ctx.lineTo(toX - inset, 0);
  ctx.stroke();
  ctx.restore();
}
