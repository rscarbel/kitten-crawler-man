/**
 * A figure the teleport can build when it has no cached cells of its own: one
 * picture of the body, painted once, with its light pictures cut from it.
 *
 * A crawler is drawn from whatever it holds and wears and however it faces,
 * so there is no fixed cell to bake the light pictures from the way Dave's
 * are. It stands still while the world builds it, so one snapshot taken on
 * the first frame serves the whole effect, and its soles, head and middle are
 * read off the snapshot's own ink.
 */

import {
  allocCanvas,
  allocReadableCanvas,
  type CanvasSurface,
  freshSurfaceContext,
  releaseSurface,
} from '../core/rendering/canvasSurface';
import {
  paintTeleportEdgeRing,
  TELEPORT_EDGE_RING_TILES,
  type TeleportFigure,
  type TeleportLayer,
  washInTeleportLight,
} from './teleportEffect';

/** Paints the body alone, with the top-left of the tile it stands on at `(x, y)`. */
export type TeleportBodyPainter = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tileSize: number,
) => void;

/**
 * How much room the snapshot leaves round the body's tile, in tiles: enough
 * for the tallest crawler's hair, a held weapon's reach and a tail.
 */
const ROOM_BESIDE_TILES = 1;
const ROOM_ABOVE_TILES = 2;
const ROOM_BELOW_TILES = 1;
const BOX_WIDTH_TILES = ROOM_BESIDE_TILES * 2 + 1;
const BOX_HEIGHT_TILES = ROOM_ABOVE_TILES + 1 + ROOM_BELOW_TILES;

/** A pixel this opaque or more is the body's ink rather than a soft shadow's fringe. */
const INK_ALPHA_THRESHOLD = 32;
const RGBA_CHANNELS = 4;
const ALPHA_CHANNEL = 3;
const HALF = 1 / 2;
const FULL_OPACITY = 1;

/** Where the body's ink sits in the snapshot, in tiles from its tile's top-left. */
interface InkExtent {
  readonly top: number;
  readonly bottom: number;
  readonly centreX: number;
}

function measureInk(
  surface: CanvasSurface,
  ctx: CanvasRenderingContext2D,
  pxPerTile: number,
): InkExtent | null {
  const { data, width, height } = ctx.getImageData(0, 0, surface.width, surface.height);
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * RGBA_CHANNELS + ALPHA_CHANNEL] ?? 0;
      if (alpha < INK_ALPHA_THRESHOLD) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return null;
  const tilesAcross = (px: number): number => px / pxPerTile - ROOM_BESIDE_TILES;
  const tilesDown = (px: number): number => px / pxPerTile - ROOM_ABOVE_TILES;
  return {
    top: tilesDown(minY),
    bottom: tilesDown(maxY + 1),
    centreX: tilesAcross((minX + maxX + 1) * HALF),
  };
}

/** The three pictures of one body, and where its ink sits among them. */
export class TeleportSnapshot implements TeleportFigure<null> {
  readonly boxLeft = -ROOM_BESIDE_TILES;
  readonly boxTop = -ROOM_ABOVE_TILES;
  readonly boxWidth = BOX_WIDTH_TILES;
  readonly boxBottom = 1 + ROOM_BELOW_TILES;
  readonly soleY: number;
  readonly headY: number;
  readonly centreX: number;

  private constructor(
    private readonly pictures: Readonly<Record<TeleportLayer, CanvasSurface>>,
    ink: InkExtent,
  ) {
    this.soleY = ink.bottom;
    this.headY = ink.top;
    this.centreX = ink.centreX;
  }

  /**
   * Paints the body once at `tileSize` and `density` (surface pixels per
   * screen pixel) and cuts its light pictures from it; null when the body
   * left no ink, as one whose art has not loaded yet does.
   *
   * @throws CanvasContextUnavailableError when the browser refuses one of its
   *   surfaces a context; every surface it allocated is given back first.
   */
  static take(
    paintBody: TeleportBodyPainter,
    tileSize: number,
    density: number,
  ): TeleportSnapshot | null {
    const pxPerTile = tileSize * density;
    const width = Math.ceil(BOX_WIDTH_TILES * pxPerTile);
    const height = Math.ceil(BOX_HEIGHT_TILES * pxPerTile);
    const solid = allocReadableCanvas('effects', width, height);
    const glitch = allocCanvas('effects', width, height);
    const edge = allocCanvas('effects', width, height);
    const releaseAll = (): void => {
      releaseSurface(solid);
      releaseSurface(glitch);
      releaseSurface(edge);
    };
    try {
      const solidCtx = freshSurfaceContext(solid);
      solidCtx.setTransform(density, 0, 0, density, 0, 0);
      paintBody(solidCtx, ROOM_BESIDE_TILES * tileSize, ROOM_ABOVE_TILES * tileSize, tileSize);
      solidCtx.setTransform(1, 0, 0, 1, 0, 0);
      const ink = measureInk(solid, solidCtx, pxPerTile);
      if (ink === null) {
        releaseAll();
        return null;
      }
      freshSurfaceContext(glitch).drawImage(solid, 0, 0);
      washInTeleportLight(glitch);
      paintTeleportEdgeRing(edge, solid, TELEPORT_EDGE_RING_TILES * pxPerTile);
      return new TeleportSnapshot({ solid, glitch, edge }, ink);
    } catch (error) {
      releaseAll();
      throw error;
    }
  }

  drawLayer(
    ctx: CanvasRenderingContext2D,
    layer: TeleportLayer,
    _pose: null,
    sx: number,
    sy: number,
    tileSize: number,
    alpha: number,
  ): void {
    const picture = this.pictures[layer];
    ctx.save();
    // As a cached figure cell takes its alpha, so a snapshot and Dave's cells
    // read alike under the same layout.
    if (alpha !== FULL_OPACITY) ctx.globalAlpha = alpha;
    ctx.drawImage(
      picture,
      sx + this.boxLeft * tileSize,
      sy + this.boxTop * tileSize,
      BOX_WIDTH_TILES * tileSize,
      BOX_HEIGHT_TILES * tileSize,
    );
    ctx.restore();
  }

  /** Gives the pictures' pixels back; the snapshot draws nothing after. */
  release(): void {
    for (const picture of Object.values(this.pictures)) releaseSurface(picture);
  }
}
