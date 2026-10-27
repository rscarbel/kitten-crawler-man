/**
 * The Starlight Tent's prop frame cache: every painted maze prop is baked once per
 * `(prop, state, frame)` to an offscreen canvas and blitted from there, the
 * way `drawTownInteriorProp` caches the town's furniture.
 *
 * A painter is plain canvas code written against a tile of `size` pixels whose
 * top-left corner is `(originX, originY)` — the same signature the live maze
 * painters use — and the cache decides where on its surface that tile sits.
 * The frame box says how far the art may reach beyond that tile; anything
 * painted outside the box is clipped, and `gates:starlight-tent-art` checks that no
 * frame inks its own border.
 *
 * Frames are baked at the device resolution the prop is shown at (read off the
 * context's transform), snapped up to `BAKE_RESOLUTION_STEP_PX` so a pinch of
 * zoom does not bake a new set, and the cache holds at most
 * `STARLIGHT_TENT_PROP_CACHE_BUDGET_BYTES`, evicting the frame drawn longest ago.
 *
 * Everything a painter's picture depends on must be in its key. An animated
 * prop quantises its motion to a small frame count (at least four frames per
 * cycle, so the loop does not alias into a freeze or a strobe) and passes the
 * frame index; a continuous value such as a lean is quantised into the state.
 */

import {
  allocCanvas,
  BYTES_PER_MEGABYTE,
  releaseSurface,
  surfaceContext,
  type CanvasSurface,
} from '../../../core/rendering/canvasSurface';
import { onCanvasRecovery } from '../../../core/rendering/canvasRecovery';
import { reportArtTop } from '../../../ui/world/overheadStack';

type Ctx = CanvasRenderingContext2D;

/** What a cached frame shows. Two draws with equal keys show the same picture. */
export interface StarlightTentPropKey {
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
export interface StarlightTentPropBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Tiles are baked at multiples of this many pixels, so a frame box whose
 * edges land on this fraction of a tile is always a whole number of pixels
 * and blits one to one; any other box is resampled, softening its art.
 */
const BOX_GRID_PER_TILE = 16;

/** The smallest box on the bake grid that holds `box`. */
export function gridAlignedBox(box: StarlightTentPropBox): StarlightTentPropBox {
  const left = Math.floor(box.left * BOX_GRID_PER_TILE) / BOX_GRID_PER_TILE;
  const top = Math.floor(box.top * BOX_GRID_PER_TILE) / BOX_GRID_PER_TILE;
  const right = Math.ceil((box.left + box.width) * BOX_GRID_PER_TILE) / BOX_GRID_PER_TILE;
  const bottom = Math.ceil((box.top + box.height) * BOX_GRID_PER_TILE) / BOX_GRID_PER_TILE;
  return { left, top, width: right - left, height: bottom - top };
}

/** A one-tile frame with nothing hanging over. */
export const ONE_TILE_BOX: StarlightTentPropBox = { left: 0, top: 0, width: 1, height: 1 };

/** Paints one frame. `(originX, originY)` is the top-left of the prop's own tile. */
export type StarlightTentPropPainter = (
  ctx: Ctx,
  originX: number,
  originY: number,
  size: number,
) => void;

/** A side of a frame's box. */
export type StarlightTentPropEdge = 'top' | 'bottom' | 'left' | 'right';

/**
 * One picture a module can ask the cache for, listed so the art gate can
 * paint every one on its own. `openEdges` names the sides whose art rightly
 * runs on into the next tile — a barrier filling its doorway, a rope climbing
 * into the rigging — and every other side must stay clear of ink.
 */
export interface StarlightTentPropCatalogueEntry {
  readonly key: StarlightTentPropKey;
  readonly box: StarlightTentPropBox;
  readonly painter: StarlightTentPropPainter;
  readonly openEdges?: ReadonlyArray<StarlightTentPropEdge>;
}

/** Every side, for art that fills its tile edge to edge. */
export const EVERY_EDGE: ReadonlyArray<StarlightTentPropEdge> = ['top', 'bottom', 'left', 'right'];

/**
 * Called around every bake so a gate can hold the painters to the strict
 * canvas and read each finished frame. Never set in the game.
 */
export interface StarlightTentPropBakeObserver {
  beforePaint(ctx: Ctx, key: StarlightTentPropKey): void;
  afterPaint(ctx: Ctx, key: StarlightTentPropKey, surface: CanvasSurface): void;
}

interface CachedFrame {
  readonly surface: CanvasSurface;
  readonly bytes: number;
  readonly pxPerTile: number;
  readonly box: StarlightTentPropBox;
}

const BYTES_PER_PIXEL = 4;
/**
 * The whole cache's ceiling; a fire-walk screen's props at 64 px a tile fit in
 * a fraction of it. Sized so every act's frames, the hall's generated glass,
 * stars, marquees and light included, stay resident at both scales at once
 * with some headroom: an eviction mid-act is a re-bake hitch on screen.
 */
const CACHE_BUDGET_MEGABYTES = 6;
export const STARLIGHT_TENT_PROP_CACHE_BUDGET_BYTES = CACHE_BUDGET_MEGABYTES * BYTES_PER_MEGABYTE;
/** Bake resolutions are multiples of this many device pixels per tile. */
const BAKE_RESOLUTION_STEP_PX = 16;
const MIN_BAKE_PX_PER_TILE = 16;
/** Past this a prop is upscaled rather than baked bigger, bounding one frame's bytes. */
const MAX_BAKE_PX_PER_TILE = 128;

const frames = new Map<string, CachedFrame>();
let residentBytes = 0;
let evictions = 0;
let observer: StarlightTentPropBakeObserver | null = null;

function keyString(key: StarlightTentPropKey, pxPerTile: number): string {
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
export function bakeStarlightTentPropFrame(
  key: StarlightTentPropKey,
  box: StarlightTentPropBox,
  painter: StarlightTentPropPainter,
  pxPerTile: number,
): CanvasSurface {
  const width = Math.max(1, Math.ceil(box.width * pxPerTile));
  const height = Math.max(1, Math.ceil(box.height * pxPerTile));
  const surface = allocCanvas('starlightTentProps', width, height);
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
    if (residentBytes + incomingBytes <= STARLIGHT_TENT_PROP_CACHE_BUDGET_BYTES) return;
    frames.delete(id);
    releaseSurface(frame.surface);
    residentBytes -= frame.bytes;
    evictions++;
  }
}

function cachedFrame(
  key: StarlightTentPropKey,
  box: StarlightTentPropBox,
  painter: StarlightTentPropPainter,
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
  const surface = bakeStarlightTentPropFrame(key, box, painter, pxPerTile);
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
export function drawStarlightTentProp(
  ctx: Ctx,
  key: StarlightTentPropKey,
  box: StarlightTentPropBox,
  painter: StarlightTentPropPainter,
  sx: number,
  sy: number,
  size: number,
): void {
  const frame = cachedFrame(key, box, painter, bakeResolution(ctx, size));
  const left = sx + box.left * size;
  const top = sy + box.top * size;
  const width = box.width * size;
  // A prop's box is drawn to fit its art, so its top is the art's top.
  reportArtTop(ctx, left, left + width, top);
  ctx.drawImage(frame.surface, left, top, width, box.height * size);
}

/**
 * Draws a run of whole tiles cut from one prop frame, full height: `tiles`
 * tiles of it, starting `fromTile` tiles right of the frame's own tile, with
 * that first tile's top-left at `(sx, sy)`. A run reaching past either side
 * of the frame is cut at the frame's edge. One frame of a repeating strip — a row of
 * identical props — can then stand in for every run of it, one `drawImage`
 * per unbroken stretch, instead of a frame baked per run.
 */
export function drawStarlightTentPropSlice(
  ctx: Ctx,
  key: StarlightTentPropKey,
  box: StarlightTentPropBox,
  painter: StarlightTentPropPainter,
  fromTile: number,
  tiles: number,
  sx: number,
  sy: number,
  size: number,
): void {
  const firstTile = Math.max(fromTile, box.left);
  const endTile = Math.min(fromTile + tiles, box.left + box.width);
  if (endTile <= firstTile) return;
  const frame = cachedFrame(key, box, painter, bakeResolution(ctx, size));
  const px = frame.pxPerTile;
  const drawnTiles = endTile - firstTile;
  ctx.drawImage(
    frame.surface,
    (firstTile - box.left) * px,
    0,
    drawnTiles * px,
    frame.surface.height,
    sx + (firstTile - fromTile) * size,
    sy + box.top * size,
    drawnTiles * size,
    box.height * size,
  );
}

/** Bytes of canvas the cache holds now. */
export function starlightTentPropCacheBytes(): number {
  return residentBytes;
}

/** How many frames the cache holds now. */
export function starlightTentPropCacheFrameCount(): number {
  return frames.size;
}

/** Frames dropped to stay under the budget since the cache was last cleared. */
export function starlightTentPropCacheEvictions(): number {
  return evictions;
}

/** Drops every baked frame, e.g. when the party leaves the tent. */
export function clearStarlightTentPropCache(): void {
  for (const frame of frames.values()) releaseSurface(frame.surface);
  frames.clear();
  residentBytes = 0;
  evictions = 0;
}

/** Installs (or with `null` removes) the bake observer. For gates only. */
export function observeStarlightTentPropBakes(next: StarlightTentPropBakeObserver | null): void {
  observer = next;
}

onCanvasRecovery(() => clearStarlightTentPropCache());
