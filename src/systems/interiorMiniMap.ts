/**
 * A building's minimap: the whole room scaled to fit the HUD's minimap frame,
 * with no fog, the exits marked, and dots for both crawlers. The dungeon's map
 * is `MiniMapSystem`; both colour their tiles from `minimapTileColor`.
 */

import { TILE_SIZE } from '../core/constants';
import type { GameMap } from '../map/GameMap';
import type { Rect } from '../ui/core/geom';
import { MINIMAP_MARKER_COLORS, minimapTileColor } from '../ui/theme/minimapColors';

/** Marker radii as a fraction of a tile, with a floor so a large room's dots stay visible. */
const COMPANION_DOT_TILES = 0.4;
const PLAYER_DOT_TILES = 0.5;
const EXIT_DOT_MIN = 1.5;
const COMPANION_DOT_MIN = 2;
const PLAYER_DOT_MIN = 2.5;
const TILE_CENTRE = 0.5;

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

/** Paints `map` into `rect`, centred, scaled so its longer side fills the frame. */
export function paintInteriorMiniMap(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  map: GameMap,
  active: { readonly x: number; readonly y: number },
  companion: { readonly x: number; readonly y: number },
): void {
  const mapW = map.structure[0]?.length ?? 1;
  const mapH = map.structure.length;
  const side = Math.min(rect.w, rect.h);
  const pxPerTile = side / Math.max(mapW, mapH);
  const originX = rect.x + (rect.w - mapW * pxPerTile) / 2;
  const originY = rect.y + (rect.h - mapH * pxPerTile) / 2;
  const tileSide = Math.ceil(pxPerTile);
  for (let ty = 0; ty < mapH; ty++) {
    for (let tx = 0; tx < mapW; tx++) {
      ctx.fillStyle = minimapTileColor(map.structure[ty][tx].type);
      ctx.fillRect(originX + tx * pxPerTile, originY + ty * pxPerTile, tileSide, tileSide);
    }
  }
  const at = (tileX: number, tileY: number): { x: number; y: number } => ({
    x: originX + tileX * pxPerTile,
    y: originY + tileY * pxPerTile,
  });
  ctx.fillStyle = MINIMAP_MARKER_COLORS.exit;
  for (const exit of map._interiorExitTiles) {
    const p = at(exit.x + TILE_CENTRE, exit.y + TILE_CENTRE);
    dot(ctx, p.x, p.y, Math.max(EXIT_DOT_MIN, pxPerTile * COMPANION_DOT_TILES));
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
