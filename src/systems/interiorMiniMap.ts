/**
 * A building's minimap: the whole room scaled to fit the HUD's minimap frame,
 * with no fog, the exits marked, and dots for both crawlers. The dungeon's map
 * is `MiniMapSystem`; both colour their tiles from `minimapTileColor`.
 */

import { TILE_SIZE } from '../core/constants';
import {
  allocCanvas,
  releaseSurface,
  surfaceContext,
  type CanvasSurface,
} from '../core/canvasSurface';
import type { GameMap } from '../map/GameMap';
import type { Rect } from '../ui/core/geom';
import { MINIMAP_MARKER_COLORS, minimapTileColor } from '../ui/theme/minimapColors';

/** Marker radii as a fraction of a tile, with a floor so a large room's dots stay visible. */
const COMPANION_DOT_TILES = 0.4;
const PLAYER_DOT_TILES = 0.5;
const EXIT_DOT_MIN = 1.5;
const COMPANION_DOT_MIN = 2;
const PLAYER_DOT_MIN = 2.5;
const OBJECTIVE_MARK_TILES = 0.9;
const OBJECTIVE_MARK_MIN = 3.5;
const OBJECTIVE_OUTLINE_WIDTH = 1;
const TILE_CENTRE = 0.5;

/** A map's tiles painted once at one size, reused until a tile or the size changes. */
interface LayoutCache {
  readonly surface: CanvasSurface;
  readonly structure: unknown;
  readonly signature: number;
  readonly pxPerTile: number;
  readonly deviceScale: number;
}

const layoutCaches = new WeakMap<GameMap, LayoutCache>();

const SIGNATURE_PRIME = 31;
const SIGNATURE_SEED = 17;

/**
 * A cheap fingerprint of every tile's type: rebuilt each frame because tile
 * types change in place (a gate opened, a prop broken) without telling
 * anyone, and summing a few thousand integers costs far less than painting
 * them.
 */
function layoutSignature(map: GameMap): number {
  let signature = SIGNATURE_SEED;
  for (const row of map.structure) {
    for (const tile of row) signature = (Math.imul(signature, SIGNATURE_PRIME) + tile.type) | 0;
  }
  return signature;
}

function paintLayout(
  ctx: CanvasRenderingContext2D,
  map: GameMap,
  pxPerTile: number,
  originX: number,
  originY: number,
): void {
  const tileSide = Math.ceil(pxPerTile);
  map.structure.forEach((row, ty) => {
    row.forEach((tile, tx) => {
      ctx.fillStyle = minimapTileColor(tile.type);
      ctx.fillRect(originX + tx * pxPerTile, originY + ty * pxPerTile, tileSide, tileSide);
    });
  });
}

/** The map's tiles at this size, painted now only if they were not already. */
function layoutSurface(map: GameMap, pxPerTile: number, deviceScale: number): CanvasSurface {
  const signature = layoutSignature(map);
  const cached = layoutCaches.get(map);
  const fresh =
    cached?.structure === map.structure &&
    cached.signature === signature &&
    cached.pxPerTile === pxPerTile &&
    cached.deviceScale === deviceScale;
  if (fresh) return cached.surface;
  if (cached !== undefined) releaseSurface(cached.surface);
  const mapW = map.structure[0]?.length ?? 1;
  const mapH = map.structure.length;
  const surface = allocCanvas(
    'minimap',
    Math.max(1, Math.ceil(mapW * pxPerTile * deviceScale)),
    Math.max(1, Math.ceil(mapH * pxPerTile * deviceScale)),
  );
  const bake = surfaceContext(surface);
  bake.scale(deviceScale, deviceScale);
  paintLayout(bake, map, pxPerTile, 0, 0);
  layoutCaches.set(map, { surface, structure: map.structure, signature, pxPerTile, deviceScale });
  return surface;
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - radius);
  ctx.lineTo(x + radius, y);
  ctx.lineTo(x, y + radius);
  ctx.lineTo(x - radius, y);
  ctx.closePath();
  ctx.fillStyle = MINIMAP_MARKER_COLORS.objective;
  ctx.fill();
  ctx.lineWidth = OBJECTIVE_OUTLINE_WIDTH;
  ctx.strokeStyle = MINIMAP_MARKER_COLORS.outline;
  ctx.stroke();
}

/**
 * Paints `map` into `rect`, centred, scaled so its longer side fills the frame.
 * `objective`, when given, is a tile marked with a diamond: the thing the room
 * is built around, such as the prison's key. Creatures are never shown.
 */
export function paintInteriorMiniMap(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  map: GameMap,
  active: { readonly x: number; readonly y: number },
  companion: { readonly x: number; readonly y: number },
  objective: { readonly x: number; readonly y: number } | null = null,
): void {
  const mapW = map.structure[0]?.length ?? 1;
  const mapH = map.structure.length;
  const side = Math.min(rect.w, rect.h);
  const pxPerTile = side / Math.max(mapW, mapH);
  const originX = rect.x + (rect.w - mapW * pxPerTile) / 2;
  const originY = rect.y + (rect.h - mapH * pxPerTile) / 2;
  const transform = ctx.getTransform();
  const deviceScale = Math.hypot(transform.a, transform.b);
  ctx.drawImage(
    layoutSurface(map, pxPerTile, deviceScale),
    originX,
    originY,
    mapW * pxPerTile,
    mapH * pxPerTile,
  );
  const at = (tileX: number, tileY: number): { x: number; y: number } => ({
    x: originX + tileX * pxPerTile,
    y: originY + tileY * pxPerTile,
  });
  ctx.fillStyle = MINIMAP_MARKER_COLORS.exit;
  for (const exit of map._interiorExitTiles) {
    const p = at(exit.x + TILE_CENTRE, exit.y + TILE_CENTRE);
    dot(ctx, p.x, p.y, Math.max(EXIT_DOT_MIN, pxPerTile * COMPANION_DOT_TILES));
  }
  if (objective !== null) {
    const p = at(objective.x + TILE_CENTRE, objective.y + TILE_CENTRE);
    diamond(ctx, p.x, p.y, Math.max(OBJECTIVE_MARK_MIN, pxPerTile * OBJECTIVE_MARK_TILES));
  }
  const tileOf = (entity: { readonly x: number; readonly y: number }): { x: number; y: number } =>
    at(
      (entity.x + TILE_SIZE * TILE_CENTRE) / TILE_SIZE,
      (entity.y + TILE_SIZE * TILE_CENTRE) / TILE_SIZE,
    );
  const companionAt = tileOf(companion);
  ctx.fillStyle = MINIMAP_MARKER_COLORS.companion;
  dot(
    ctx,
    companionAt.x,
    companionAt.y,
    Math.max(COMPANION_DOT_MIN, pxPerTile * COMPANION_DOT_TILES),
  );
  const activeAt = tileOf(active);
  ctx.fillStyle = MINIMAP_MARKER_COLORS.player;
  dot(ctx, activeAt.x, activeAt.y, Math.max(PLAYER_DOT_MIN, pxPerTile * PLAYER_DOT_TILES));
}
