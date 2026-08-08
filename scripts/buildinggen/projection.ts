/**
 * The one oblique view every building in the town is drawn in.
 *
 * A facade seen straight on is a sticker; the three things that make it a
 * volume are all here and none of them is a material's business:
 *
 * - the **roof plane** is visible from above-front and its ridge is *narrower*
 *   than its eaves, so the roof recedes rather than lying flat against the
 *   frame (the circus tents' roofs have zero convergence, which is exactly why
 *   they read as wallpaper);
 * - a **side return** — a sliver of the right-hand wall, translated up and right
 *   toward the back corner, with the roof hipping over it — which states that
 *   there is a building behind the wall;
 * - the facade's base sits a little above the frame's bottom edge, so the
 *   building is seated in the ground rather than pasted onto it.
 *
 * ## The receding axis
 *
 * One cavalier projection throughout: moving one unit *back* into the picture
 * translates a point by `(+sideWidth, -sideRise)`. Every back-facing corner in
 * this file is its front counterpart plus that vector, which is the only reason
 * the wall, the roof and the hip end agree about where the building's back
 * corner is. A plane whose far edge is derived any other way tears away from its
 * neighbours at exactly the seam a reader looks at first.
 *
 * ## Planes are rectangles until the last moment
 *
 * Materials never see this geometry. Each plane is painted into its own
 * axis-aligned scratch canvas — courses are horizontal, posts are vertical,
 * grime runs straight down — and `drawPlane` warps that canvas onto the plane's
 * quad in frame space. That keeps every material's code in the space its real
 * counterpart is built in, and it is what lets one thatch routine serve both the
 * front slope and the hip end without knowing either is skewed.
 */

import type { Canvas, CanvasRenderingContext2D as NodeCtx } from 'canvas';
import { createCanvas } from 'canvas';
import { BUILDING_TILE_SCALE, type BuildingSpec } from './spec.js';

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A plane's four corners in frame space, top-left → top-right → bottom-right → bottom-left. */
export interface Quad {
  readonly tl: Point;
  readonly tr: Point;
  readonly br: Point;
  readonly bl: Point;
}

/** A scratch canvas a material paints into, in that plane's own flat coordinates. */
export interface Plane {
  readonly canvas: Canvas;
  readonly ctx: NodeCtx;
  /** Plane-space size in pixels. Materials measure everything against these. */
  readonly width: number;
  readonly height: number;
  /** Where this plane lands in frame space. */
  readonly quad: Quad;
}

/**
 * Convergence of the ridge toward the eaves, as a fraction of the front slope's
 * width *per side*. Small — a roof is not a pyramid — but it is the difference
 * between "a box with a roof" and "a rectangle with a stripe on it".
 */
const RIDGE_INSET_FRACTION = 0.06;

/** How far a back corner rises above its front counterpart, per unit of depth. */
const SIDE_RISE_PER_WIDTH = 0.62;

/** How far the hip end's own back corner carries the ridge, as a fraction of depth. */
const HIP_RIDGE_REACH = 0.5;

/** The hip end's ridge corner rises less than its eave corner: it is further up the slope. */
const HIP_RIDGE_RISE_FRACTION = 0.7;

/** Gap between the facade's base course and the frame's bottom edge, in tiles. */
const GROUND_CONTACT_INSET_TILES = 0.15;

export interface Projection {
  readonly scale: number;
  readonly frameWidth: number;
  readonly frameHeight: number;
  /** Y of the line the whole building is seated on. */
  readonly groundY: number;
  /** Y of the facade's own base course. Below `groundY` only for a sunken building. */
  readonly facadeBaseY: number;
  /** Y where the front wall stops and the roof begins. */
  readonly eavesY: number;
  /** Y of the ridge line, which runs horizontally across the front slope. */
  readonly ridgeY: number;
  /** Frame-space X of the front wall's left and right edges. */
  readonly facadeLeft: number;
  readonly facadeRight: number;
  /** Horizontal displacement of the wall head for a settled building. */
  readonly leanPx: number;
  /** Depth of the visible side return, and how far its back edge rises. */
  readonly sideWidth: number;
  readonly sideRise: number;
  /** The front wall. */
  readonly facadeQuad: Quad;
  /** The sliver of right-hand wall that states the building has depth. */
  readonly sideQuad: Quad;
  /** The front roof slope: the plane the roof material mostly lives on. */
  readonly roofQuad: Quad;
  /** The hip end carrying the roof over the side return. */
  readonly roofReturnQuad: Quad;
  /** Frame-space Y where the ground story stops and the upper story begins. */
  readonly storySplitY: number;
}

/**
 * Least wall a building may keep once the roof, the chimneys and the ground
 * inset have taken their share of the frame. A spec asking for more roof than it
 * has frame gets a short wall rather than an inverted quad that paints nothing.
 */
const MIN_WALL_TILES = 1.2;

export function project(spec: BuildingSpec): Projection {
  const scale = BUILDING_TILE_SCALE;
  const frameWidth = spec.tilesWide * scale;
  const frameHeight = spec.tilesHigh * scale;

  const sideWidth = spec.sideReturnTiles * scale;
  const sideRise = sideWidth * SIDE_RISE_PER_WIDTH;
  const overhang = spec.roof.overhangTiles * scale;

  // The horizontal budget is spent left to right: the lean, the roof's left
  // overhang, the front wall, the roof's right overhang, then the side return's
  // depth. Solving it here is what keeps every plane inside the frame without a
  // clamp — and a clamp is what would silently flatten the convergence on a
  // narrow building.
  //
  // The lean is part of that budget and was once left out of it, which pushed
  // the two settled buildings' wall heads a few pixels past the frame's right
  // edge while opening an equal empty gutter on the left. Nothing saw it: the
  // silhouette gate reads the base row, and a lean by definition moves only the
  // top.
  const leanPx = spec.facade.leanTiles * scale;
  const facadeLeft = overhang;
  const facadeRight = frameWidth - sideWidth - overhang - leanPx;

  const groundY = frameHeight - GROUND_CONTACT_INSET_TILES * scale;
  const facadeBaseY = groundY - spec.facade.sinkTiles * scale;
  const roofDepth = spec.roof.depthTiles * scale;

  const tallestChimney = spec.roof.chimneys.reduce(
    (tallest, chimney) => Math.max(tallest, chimney.heightTiles * scale),
    0,
  );
  // The topmost ink is the chimney standing on the hip end's raised ridge
  // corner, so that is what the wall height is solved against.
  const headroom = roofDepth + sideRise * HIP_RIDGE_RISE_FRACTION + tallestChimney;
  const wallHeight = Math.max(MIN_WALL_TILES * scale, facadeBaseY - headroom);

  const eavesY = facadeBaseY - wallHeight;
  const ridgeY = eavesY - roofDepth;

  const facadeQuad: Quad = {
    tl: { x: facadeLeft + leanPx, y: eavesY },
    tr: { x: facadeRight + leanPx, y: eavesY },
    br: { x: facadeRight, y: facadeBaseY },
    bl: { x: facadeLeft, y: facadeBaseY },
  };

  const sideQuad: Quad = {
    tl: { x: facadeRight + leanPx, y: eavesY },
    tr: { x: facadeRight + sideWidth + leanPx, y: eavesY - sideRise },
    br: { x: facadeRight + sideWidth, y: facadeBaseY - sideRise },
    bl: { x: facadeRight, y: facadeBaseY },
  };

  const frontEaveLeft = facadeLeft - overhang + leanPx;
  const frontEaveRight = facadeRight + overhang + leanPx;
  const ridgeInset = (frontEaveRight - frontEaveLeft) * RIDGE_INSET_FRACTION;
  const ridgeLeftX = frontEaveLeft + ridgeInset;
  const ridgeRightX = frontEaveRight - ridgeInset;

  const roofQuad: Quad = {
    tl: { x: ridgeLeftX, y: ridgeY },
    tr: { x: ridgeRightX, y: ridgeY },
    br: { x: frontEaveRight, y: eavesY },
    bl: { x: frontEaveLeft, y: eavesY },
  };

  const roofReturnQuad: Quad = {
    tl: { x: ridgeRightX, y: ridgeY },
    tr: {
      x: ridgeRightX + sideWidth * HIP_RIDGE_REACH,
      y: ridgeY - sideRise * HIP_RIDGE_RISE_FRACTION,
    },
    br: { x: frontEaveRight + sideWidth, y: eavesY - sideRise },
    bl: { x: frontEaveRight, y: eavesY },
  };

  const storySplitY =
    spec.stories === 1 ? eavesY : facadeBaseY - spec.facade.groundStoryTiles * scale;

  return {
    scale,
    frameWidth,
    frameHeight,
    groundY,
    facadeBaseY,
    eavesY,
    ridgeY,
    facadeLeft,
    facadeRight,
    leanPx,
    sideWidth,
    sideRise,
    facadeQuad,
    sideQuad,
    roofQuad,
    roofReturnQuad,
    storySplitY,
  };
}

/** Allocates a plane sized to its quad, so the warp neither blurs nor wastes pixels. */
export function makePlane(quad: Quad, widthOverride?: number, heightOverride?: number): Plane {
  const width = Math.max(
    1,
    Math.round(widthOverride ?? Math.max(distance(quad.tl, quad.tr), distance(quad.bl, quad.br))),
  );
  const height = Math.max(
    1,
    Math.round(heightOverride ?? Math.max(distance(quad.tl, quad.bl), distance(quad.tr, quad.br))),
  );
  const canvas = createCanvas(width, height);
  return { canvas, ctx: canvas.getContext('2d'), width, height, quad };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function lerpPoint(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function quadPath(ctx: NodeCtx, quad: Quad): void {
  ctx.beginPath();
  ctx.moveTo(quad.tl.x, quad.tl.y);
  ctx.lineTo(quad.tr.x, quad.tr.y);
  ctx.lineTo(quad.br.x, quad.br.y);
  ctx.lineTo(quad.bl.x, quad.bl.y);
  ctx.closePath();
}

/**
 * Overdraw applied to each slice's downhill extent.
 *
 * Slices tile exactly in theory — row `n`'s bottom edge is row `n+1`'s top — but
 * antialiasing along a sloped edge leaves a sub-pixel gap between them that
 * reads as a scanline pattern across the whole roof. Each slice is stretched
 * past its neighbour and the next one is drawn over the excess; the clip to the
 * quad stops the last slice spilling past the eaves.
 */
const SLICE_OVERDRAW = 1.35;

/**
 * Warps a plane's flat pixels onto its quad in frame space.
 *
 * The quad's left and right edges are straight lines, so every horizontal source
 * row maps to a parallelogram and the whole warp is a stack of affine slices —
 * exact for this family of quads, and far cheaper than an inverse bilinear
 * solved per pixel.
 */
export function drawPlane(target: NodeCtx, plane: Plane): void {
  const { quad, width, height } = plane;
  target.save();
  quadPath(target, quad);
  target.clip();
  for (let row = 0; row < height; row++) {
    const v0 = row / height;
    const v1 = (row + 1) / height;
    const left0 = lerpPoint(quad.tl, quad.bl, v0);
    const right0 = lerpPoint(quad.tr, quad.br, v0);
    const left1 = lerpPoint(quad.tl, quad.bl, v1);
    const uX = (right0.x - left0.x) / width;
    const uY = (right0.y - left0.y) / width;
    const vX = (left1.x - left0.x) * SLICE_OVERDRAW;
    const vY = (left1.y - left0.y) * SLICE_OVERDRAW;
    target.setTransform(uX, uY, vX, vY, left0.x, left0.y);
    target.drawImage(plane.canvas, 0, row, width, 1, 0, 0, width, 1);
  }
  target.setTransform(1, 0, 0, 1, 0, 0);
  target.restore();
}

/**
 * Facade-plane X of a tile column's left edge.
 *
 * Tile columns are frame-space measures and the facade plane is inset by the
 * roof's overhang, so a component that reads a spec's `col` and paints at
 * `col * scale` inside the facade plane lands one overhang too far right — which
 * is exactly far enough to put a door's ink outside the gap its blocked regions
 * left for it.
 */
export function tileColumnToPlaneX(projection: Projection, col: number): number {
  return col * projection.scale - projection.facadeLeft;
}

/** Frame-space Y of a feature whose bottom edge stands `tiles` above the ground line. */
export function groundHeightToFrameY(projection: Projection, tiles: number): number {
  return projection.groundY - tiles * projection.scale;
}

/**
 * Facade-plane Y of a frame-space Y.
 *
 * The facade plane's own height is the warped wall's, not the frame's, so a
 * component that scaled a frame-space measure by the plane's height directly
 * would drift further off the taller the roof got.
 */
export function frameYToFacadePlaneY(projection: Projection, plane: Plane, frameY: number): number {
  const wallHeight = projection.facadeBaseY - projection.eavesY;
  if (wallHeight <= 0) return 0;
  return ((frameY - projection.eavesY) / wallHeight) * plane.height;
}
