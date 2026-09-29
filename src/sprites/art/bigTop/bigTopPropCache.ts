/**
 * The Big Top's prop frame cache: every painted maze prop is baked once per
 * `(prop, state, frame)` to an offscreen canvas and blitted from there, the
 * way `drawTownInteriorProp` caches the town's furniture.
 *
 * A painter is plain canvas code written against a tile of `size` pixels whose
 * top-left corner is `(originX, originY)` — the same signature the live maze
 * painters use — and the cache decides where on its surface that tile sits.
 * The frame box says how far the art may reach beyond that tile; anything
 * painted outside the box is clipped, and `gates:bigtop-art` checks that no
 * frame inks its own border.
 *
 * Frames are baked at the device resolution the prop is shown at (read off the
 * context's transform), snapped up to `BAKE_RESOLUTION_STEP_PX` so a pinch of
 * zoom does not bake a new set, and the cache holds at most
 * `BIG_TOP_PROP_CACHE_BUDGET_BYTES`, evicting the frame drawn longest ago.
 *
 * Everything a painter's picture depends on must be in its key. An animated
 * prop quantises its motion to a small frame count (at least four frames per
 * cycle, so the loop does not alias into a freeze or a strobe) and passes the
 * frame index; a continuous value such as a lean is quantised into the state.
 */

import { allocCanvas, surfaceContext, type CanvasSurface } from '../../../core/canvasSurface';

type Ctx = CanvasRenderingContext2D;

/** What a cached frame shows. Two draws with equal keys show the same picture. */
export interface BigTopPropKey {
  /** The prop's painter, e.g. `'fireGrate'`. */
  readonly prop: string;
  /** Everything else the picture depends on that is not an animation frame, e.g. `'kindled'`. */
  readonly state: string;
  /** The animation frame, `0` for a still prop. */
  readonly frame: number;
}

/**
 * The frame's extent in tiles, relative to the top-left corner of the tile the
 * prop is drawn at: `left`/`top` are how far it reaches west and north of that
 * corner (zero or negative), `width`/`height` its whole size.
 */
export interface BigTopPropBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** A one-tile frame with nothing hanging over. */
export const ONE_TILE_BOX: BigTopPropBox = { left: 0, top: 0, width: 1, height: 1 };

/** Paints one frame. `(originX, originY)` is the top-left of the prop's own tile. */
export type BigTopPropPainter = (ctx: Ctx, originX: number, originY: number, size: number) => void;

/** A side of a frame's box. */
export type BigTopPropEdge = 'top' | 'bottom' | 'left' | 'right';

/**
 * One picture a module can ask the cache for, listed so the art gate can
 * paint every one on its own. `openEdges` names the sides whose art rightly
 * runs on into the next tile — a barrier filling its doorway, a rope climbing
 * into the rigging — and every other side must stay clear of ink.
 */
export interface BigTopPropCatalogueEntry {
  readonly key: BigTopPropKey;
  readonly box: BigTopPropBox;
  readonly painter: BigTopPropPainter;
  readonly openEdges?: ReadonlyArray<BigTopPropEdge>;
}

/** Every side, for art that fills its tile edge to edge. */
export const EVERY_EDGE: ReadonlyArray<BigTopPropEdge> = ['top', 'bottom', 'left', 'right'];

/**
 * Called around every bake so a gate can hold the painters to the strict
 * canvas and read each finished frame. Never set in the game.
 */
export interface BigTopPropBakeObserver {
  beforePaint(ctx: Ctx, key: BigTopPropKey): void;
  afterPaint(ctx: Ctx, key: BigTopPropKey, surface: CanvasSurface): void;
}

interface CachedFrame {
  readonly surface: CanvasSurface;
  readonly bytes: number;
  readonly pxPerTile: number;
  readonly box: BigTopPropBox;
}

const BYTES_PER_PIXEL = 4;
const BYTES_PER_MEGABYTE = 1024 * 1024;
/** The whole cache's ceiling; a fire-walk screen's props at 64 px a tile fit in a fraction of it. */
const CACHE_BUDGET_MEGABYTES = 6;
export const BIG_TOP_PROP_CACHE_BUDGET_BYTES = CACHE_BUDGET_MEGABYTES * BYTES_PER_MEGABYTE;
/** Bake resolutions are multiples of this many device pixels per tile. */
const BAKE_RESOLUTION_STEP_PX = 16;
const MIN_BAKE_PX_PER_TILE = 16;
/** Past this a prop is upscaled rather than baked bigger, bounding one frame's bytes. */
const MAX_BAKE_PX_PER_TILE = 128;

const frames = new Map<string, CachedFrame>();
let residentBytes = 0;
let evictions = 0;
let observer: BigTopPropBakeObserver | null = null;

function keyString(key: BigTopPropKey, pxPerTile: number): string {
  return `${key.prop}|${key.state}|${key.frame}|${pxPerTile}`;
}

/** Device pixels one tile of `size` covers on `ctx`, snapped for baking. */
function bakeResolution(ctx: Ctx, size: number): number {
  const transform = ctx.getTransform();
  const deviceScale = Math.hypot(transform.a, transform.b);
  const devicePx = size * (Number.isFinite(deviceScale) && deviceScale > 0 ? deviceScale : 1);
  const snapped = Math.ceil(devicePx / BAKE_RESOLUTION_STEP_PX) * BAKE_RESOLUTION_STEP_PX;
  return Math.min(MAX_BAKE_PX_PER_TILE, Math.max(MIN_BAKE_PX_PER_TILE, snapped));
}

/**
 * Paints one frame onto a fresh surface. A painter that throws loses only its
 * own surface — nothing it saved can leak into a later frame, because no
 * later frame is painted there.
 */
export function bakeBigTopPropFrame(
  key: BigTopPropKey,
  box: BigTopPropBox,
  painter: BigTopPropPainter,
  pxPerTile: number,
): CanvasSurface {
  const width = Math.max(1, Math.ceil(box.width * pxPerTile));
  const height = Math.max(1, Math.ceil(box.height * pxPerTile));
  const surface = allocCanvas(width, height);
  const ctx = surfaceContext(surface);
  observer?.beforePaint(ctx, key);
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();
    painter(ctx, -box.left * pxPerTile, -box.top * pxPerTile, pxPerTile);
  } finally {
    ctx.restore();
  }
  observer?.afterPaint(ctx, key, surface);
  return surface;
}

function evictUntilFits(incomingBytes: number): void {
  for (const [id, frame] of frames) {
    if (residentBytes + incomingBytes <= BIG_TOP_PROP_CACHE_BUDGET_BYTES) return;
    frames.delete(id);
    residentBytes -= frame.bytes;
    evictions++;
  }
}

function cachedFrame(
  key: BigTopPropKey,
  box: BigTopPropBox,
  painter: BigTopPropPainter,
  pxPerTile: number,
): CachedFrame {
  const id = keyString(key, pxPerTile);
  const existing = frames.get(id);
  if (existing !== undefined) {
    // Re-inserting keeps the map in least-recently-drawn order for eviction.
    frames.delete(id);
    frames.set(id, existing);
    return existing;
  }
  const surface = bakeBigTopPropFrame(key, box, painter, pxPerTile);
  const bytes = surface.width * surface.height * BYTES_PER_PIXEL;
  evictUntilFits(bytes);
  const baked: CachedFrame = { surface, bytes, pxPerTile, box };
  frames.set(id, baked);
  residentBytes += bytes;
  return baked;
}

/**
 * Draws one prop frame with its own tile's top-left at `(sx, sy)`, baking it
 * on first use. One `drawImage` per call.
 */
export function drawBigTopProp(
  ctx: Ctx,
  key: BigTopPropKey,
  box: BigTopPropBox,
  painter: BigTopPropPainter,
  sx: number,
  sy: number,
  size: number,
): void {
  const frame = cachedFrame(key, box, painter, bakeResolution(ctx, size));
  ctx.drawImage(
    frame.surface,
    sx + box.left * size,
    sy + box.top * size,
    box.width * size,
    box.height * size,
  );
}

/** Bytes of canvas the cache holds now. */
export function bigTopPropCacheBytes(): number {
  return residentBytes;
}

/** How many frames the cache holds now. */
export function bigTopPropCacheFrameCount(): number {
  return frames.size;
}

/** Frames dropped to stay under the budget since the cache was last cleared. */
export function bigTopPropCacheEvictions(): number {
  return evictions;
}

/** Drops every baked frame, e.g. when the party leaves the tent. */
export function clearBigTopPropCache(): void {
  frames.clear();
  residentBytes = 0;
  evictions = 0;
}

/** Installs (or with `null` removes) the bake observer. For gates only. */
export function observeBigTopPropBakes(next: BigTopPropBakeObserver | null): void {
  observer = next;
}
