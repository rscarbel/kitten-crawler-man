/**
 * The floor surface pass of the ground renderer: each room's floor feature
 * (painted by `floorFeatureArt.ts`), the hallway decals, the painted edge line
 * along the service level's hallways, and over them a broad tonal wash —
 * lighter and softer where people walk, darker and dustier where nobody does.
 *
 * All of it is read off the map's `FloorSurface` and baked into the tile chunks with
 * the rest of the ground, so they cost nothing per frame. Each tile paints only
 * inside its own rect.
 *
 * The wash is interpolated across each tile from the four grid vertices around
 * it, and two tiles sharing an edge share those vertices, so the field runs on
 * continuously rather than stepping tile by tile.
 */

import { allocCanvas, surfaceContext, type CanvasSurface } from '../../core/canvasSurface';
import type { TileContent } from '../tileTypes';
import {
  EDGE_LINE_EAST,
  EDGE_LINE_NORTH,
  EDGE_LINE_SOUTH,
  EDGE_LINE_TURN_NE,
  EDGE_LINE_TURN_NW,
  EDGE_LINE_TURN_SE,
  EDGE_LINE_TURN_SW,
  EDGE_LINE_WEST,
  floorSurfaceOf,
  type FloorSurface,
} from '../dungeon/floorSurface';
import { drawFeatureTile, drawHallwayMarks } from './floorFeatureArt';
import { blitAtDevice, fillSnapped, snappedDeviceRect } from './deviceSnap';

/**
 * Steps per unit of wash a vertex is rounded to before a tile's wash surface is
 * looked up. A step is a quarter of the wash's full strength — under three
 * percent opacity, a luminance step of about two levels — which a wash this
 * faint cannot show, and it leaves a whole floor-1 level sharing well under a
 * thousand surfaces. Rounding cannot open a seam: both tiles at an edge round
 * the same vertex values.
 */
const WASH_LEVELS = 4;

/**
 * Peak opacity of the lift and of the dust. The lift colour sits about 70 levels
 * above a mid-value floor and the dust about 60 below, so these come to a
 * luminance shift of roughly 5–8% at the extremes — felt more than seen.
 */
const LIFT_ALPHA = 0.1;
const DUST_ALPHA = 0.12;
/** A pale neutral: worn stone and steel go lighter and greyer, and lose texture. */
const LIFT_RGB: readonly [number, number, number] = [192, 190, 186];
/** A dark warm grey: settled dust darkens and desaturates whatever it lies on. */
const DUST_RGB: readonly [number, number, number] = [58, 54, 49];

const RGBA_CHANNELS = 4;
const OPAQUE = 255;
/** A pixel samples the field at its centre, half a pixel in from its edge. */
const PIXEL_CENTRE = 0.5;

const WASH_CACHE_MAX_ENTRIES = 2000;

/** Inset of the painted hallway line from the wall, as a share of the tile. */
const EDGE_LINE_INSET = 0.17;
/** Width of the painted line, as a share of the tile. */
const EDGE_LINE_WIDTH = 0.07;
/** Worn safety yellow: painted once, scuffed since, and never repainted. */
const EDGE_LINE_COLOR = 'rgba(196, 168, 74, 0.34)';

const washCache = new Map<string, CanvasSurface>();

function cachedWash(key: string): CanvasSurface | undefined {
  const surface = washCache.get(key);
  if (surface === undefined) return undefined;
  washCache.delete(key);
  washCache.set(key, surface);
  return surface;
}

function storeWash(key: string, surface: CanvasSurface): void {
  washCache.set(key, surface);
  while (washCache.size > WASH_CACHE_MAX_ENTRIES) {
    const oldest = washCache.keys().next();
    if (oldest.done === true) break;
    washCache.delete(oldest.value);
  }
}

/** The four vertex washes of a tile, rounded to {@link WASH_LEVELS}. */
interface TileCorners {
  readonly northWest: number;
  readonly northEast: number;
  readonly southWest: number;
  readonly southEast: number;
}

function roundedCorners(surface: FloorSurface, tx: number, ty: number): TileCorners {
  const level = (value: number): number => Math.round(value * WASH_LEVELS);
  return {
    northWest: level(surface.washAtVertex(tx, ty)),
    northEast: level(surface.washAtVertex(tx + 1, ty)),
    southWest: level(surface.washAtVertex(tx, ty + 1)),
    southEast: level(surface.washAtVertex(tx + 1, ty + 1)),
  };
}

function buildWash(corners: TileCorners, width: number, height: number): CanvasSurface {
  const surface = allocCanvas(width, height);
  const ctx = surfaceContext(surface);
  const image = ctx.createImageData(width, height);
  const { northWest, northEast, southWest, southEast } = corners;
  for (let py = 0; py < height; py++) {
    const v = (py + PIXEL_CENTRE) / height;
    for (let px = 0; px < width; px++) {
      const u = (px + PIXEL_CENTRE) / width;
      const north = northWest + (northEast - northWest) * u;
      const south = southWest + (southEast - southWest) * u;
      const value = (north + (south - north) * v) / WASH_LEVELS;
      const lifting = value > 0;
      const rgb = lifting ? LIFT_RGB : DUST_RGB;
      const alpha = Math.abs(value) * (lifting ? LIFT_ALPHA : DUST_ALPHA);
      const offset = (py * width + px) * RGBA_CHANNELS;
      image.data[offset] = rgb[0];
      image.data[offset + 1] = rgb[1];
      image.data[offset + 2] = rgb[2];
      image.data[offset + 3] = Math.round(alpha * OPAQUE);
    }
  }
  ctx.putImageData(image, 0, 0);
  return surface;
}

function drawWash(
  ctx: CanvasRenderingContext2D,
  surface: FloorSurface,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const corners = roundedCorners(surface, tx, ty);
  const { northWest, northEast, southWest, southEast } = corners;
  if (northWest === 0 && northEast === 0 && southWest === 0 && southEast === 0) return;
  const rect = snappedDeviceRect(ctx, sx, sy, ts, ts);
  if (rect.w <= 0 || rect.h <= 0) return;
  const key = `${rect.w}x${rect.h}:${northWest},${northEast},${southWest},${southEast}`;
  let wash = cachedWash(key);
  if (wash === undefined) {
    wash = buildWash(corners, rect.w, rect.h);
    storeWash(key, wash);
  }
  blitAtDevice(ctx, wash, rect);
}

/**
 * The painted line along a hallway's walls. Each side with a wall gets a line
 * set in from it, shortened where it meets a line along the neighbouring side
 * so an inside corner closes square; where the wall turns away from the tile
 * the line bends round the corner with it.
 */
function drawEdgeLine(
  ctx: CanvasRenderingContext2D,
  bits: number,
  sx: number,
  sy: number,
  ts: number,
): void {
  const inset = ts * EDGE_LINE_INSET;
  const width = Math.max(1, ts * EDGE_LINE_WIDTH);
  const has = (bit: number): boolean => (bits & bit) !== 0;
  const westStart = has(EDGE_LINE_WEST) ? inset : 0;
  const eastEnd = has(EDGE_LINE_EAST) ? ts - inset : ts;
  // The north and south lines own an inside corner's square; the west and east
  // lines stop at it, so a translucent corner is painted once, not twice.
  const northStart = has(EDGE_LINE_NORTH) ? inset + width : 0;
  const southEnd = has(EDGE_LINE_SOUTH) ? ts - inset - width : ts;
  const nearInset = inset;
  const farInset = ts - inset - width;

  ctx.fillStyle = EDGE_LINE_COLOR;
  if (has(EDGE_LINE_NORTH))
    fillSnapped(ctx, sx + westStart, sy + nearInset, eastEnd - westStart, width);
  if (has(EDGE_LINE_SOUTH))
    fillSnapped(ctx, sx + westStart, sy + farInset, eastEnd - westStart, width);
  if (has(EDGE_LINE_WEST))
    fillSnapped(ctx, sx + nearInset, sy + northStart, width, southEnd - northStart);
  if (has(EDGE_LINE_EAST))
    fillSnapped(ctx, sx + farInset, sy + northStart, width, southEnd - northStart);

  // Each turn is an L joining the line arriving along one side of the tile to
  // the line leaving along the other, both stopping at the tile's edge.
  if (has(EDGE_LINE_TURN_NE)) {
    fillSnapped(ctx, sx + farInset, sy + nearInset, ts - farInset, width);
    fillSnapped(ctx, sx + farInset, sy, width, nearInset);
  }
  if (has(EDGE_LINE_TURN_NW)) {
    fillSnapped(ctx, sx, sy + nearInset, nearInset + width, width);
    fillSnapped(ctx, sx + nearInset, sy, width, nearInset);
  }
  if (has(EDGE_LINE_TURN_SE)) {
    fillSnapped(ctx, sx + farInset, sy + farInset, ts - farInset, width);
    fillSnapped(ctx, sx + farInset, sy + farInset + width, width, ts - farInset - width);
  }
  if (has(EDGE_LINE_TURN_SW)) {
    fillSnapped(ctx, sx, sy + farInset, nearInset + width, width);
    fillSnapped(ctx, sx + nearInset, sy + farInset + width, width, ts - farInset - width);
  }
}

/**
 * Paints the floor surface pass for one tile of ground: the slice of any room
 * feature lying on it, the hallway decals and edge line, then the wear wash
 * over all of them, so a rug or a mosaic is worn and dusted like the floor it
 * lies on. Does nothing on a map with no registered floor surface.
 */
export function drawFloorSurface(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const surface = floorSurfaceOf(structure);
  if (surface === undefined) return;
  const feature = surface.featureAt(tx, ty);
  if (feature !== null) drawFeatureTile(ctx, feature, sx, sy, ts, tx, ty);
  const marks = surface.hallwayMarksAt(tx, ty);
  if (marks !== 0) drawHallwayMarks(ctx, marks, sx, sy, ts);
  const lines = surface.edgeLinesAt(tx, ty);
  if (lines !== 0) drawEdgeLine(ctx, lines, sx, sy, ts);
  drawWash(ctx, surface, sx, sy, ts, tx, ty);
}
