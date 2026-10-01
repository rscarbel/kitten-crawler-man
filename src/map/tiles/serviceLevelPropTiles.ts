/**
 * Draws the service level's furniture and floor clutter.
 *
 * Solid pieces are drawn twice like every Y-sorted prop: the chunk bake paints
 * only the floor under them, and the overlay pass paints the piece over it, in
 * its wear state, at the variant its tile hashes to. A multi-tile piece's part
 * tiles are baked as bare floor and never drawn in the overlay: their anchor
 * draws the whole piece. The clutter is baked flat into the floor.
 */

import { getManifestEntry, type MapSpriteExtentsPx } from '../../core/SpriteLoader';
import { drawSpriteKey, timeFrameIndex } from '../../core/SpriteRenderer';
import { PROP_VARIANT_COUNT } from '../../sprites/art/propPaint';
import { BOILER_FRAMES } from '../../sprites/art/serviceProps/serviceFurnitureArt';
import type { ServicePropKind } from '../../sprites/art/serviceProps/serviceFurnitureArt';
import { frameTime } from '../../utils';
import { PROP_PART_TILE_TYPES, SERVICE_LEVEL_TILE_TYPES } from '../serviceLevelProps';
import {
  BOILER,
  CABLE_BUNDLE,
  DROPPED_TOWEL,
  FILING_CABINET,
  GAS_CYLINDER,
  LOCKER_BANK,
  LOCKER_BENCH,
  MOP_BUCKET,
  PALLET_STACK,
  PAPER_DRIFT,
  SERVICE_DESK,
  VENDING_MACHINE,
  propSpriteState,
  type TileContent,
} from '../tileTypes';
import { inferFloorType } from './helpers';
import { drawSpecialFloorTile } from './specialFloorTiles';
import { drawTerrainTile } from './terrainTiles';
import { tileHash } from './hollowTileHash';

/** The sheet each breakable piece is drawn from. */
export const SERVICE_PROP_KIND_BY_TILE_TYPE: ReadonlyMap<number, ServicePropKind> = new Map<
  number,
  ServicePropKind
>([
  [GAS_CYLINDER, 'gas_cylinder'],
  [LOCKER_BANK, 'locker_bank'],
  [FILING_CABINET, 'filing_cabinet'],
  [MOP_BUCKET, 'mop_bucket'],
  [PALLET_STACK, 'pallet_stack'],
  [VENDING_MACHINE, 'vending_machine'],
  [SERVICE_DESK, 'service_desk'],
  [LOCKER_BENCH, 'locker_bench'],
]);

const DECAL_ROWS = new Map<number, 'cable' | 'paper' | 'towel'>([
  [CABLE_BUNDLE, 'cable'],
  [PAPER_DRIFT, 'paper'],
  [DROPPED_TOWEL, 'towel'],
]);

/** Salt keeping the variant hash apart from every other per-tile hash. */
const VARIANT_SALT = 0x5e7c;
/** The boiler's fire and steam loop rate. */
const BOILER_FPS = 6;

/** Which of a sheet's seeded looks the piece on this tile wears. */
export function servicePropVariant(tx: number, ty: number): number {
  return tileHash(tx, ty, VARIANT_SALT) % PROP_VARIANT_COUNT;
}

function drawFloorUnder(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const floorType = inferFloorType(structure, tx, ty);
  if (!drawTerrainTile(ctx, structure, floorType, sx, sy, ts, tx, ty)) {
    drawSpecialFloorTile(ctx, structure, floorType, sx, sy, ts, tx, ty);
  }
}

/**
 * Draws a service-level tile, or returns false for any other type. With
 * `baseOnly`, a solid piece draws only the floor it stands on.
 */
export function drawServiceLevelTile(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  type: number,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
  baseOnly: boolean,
): boolean {
  if (!SERVICE_LEVEL_TILE_TYPES.has(type)) return false;
  const decalRow = DECAL_ROWS.get(type);
  if (decalRow !== undefined) {
    drawFloorUnder(ctx, structure, sx, sy, ts, tx, ty);
    drawSpriteKey(ctx, 'service_decals', decalRow, servicePropVariant(tx, ty), sx, sy, ts);
    return true;
  }
  if (baseOnly || PROP_PART_TILE_TYPES.has(type)) {
    drawFloorUnder(ctx, structure, sx, sy, ts, tx, ty);
    return true;
  }
  if (type === BOILER) {
    drawSpriteKey(
      ctx,
      'boiler',
      'idle',
      timeFrameIndex(frameTime, BOILER_FPS, BOILER_FRAMES),
      sx,
      sy,
      ts,
    );
    return true;
  }
  const kind = SERVICE_PROP_KIND_BY_TILE_TYPE.get(type);
  if (kind === undefined) return false;
  drawSpriteKey(
    ctx,
    kind,
    propSpriteState(structure[ty][tx].damageStage),
    servicePropVariant(tx, ty),
    sx,
    sy,
    ts,
  );
  return true;
}

/**
 * How far a service-level piece's art reaches past its anchor tile, read off
 * its sheet's envelope so culling and the sheet cannot disagree.
 */
export function serviceLevelPropExtentsPx(type: number, ts: number): MapSpriteExtentsPx | null {
  const key = type === BOILER ? 'boiler' : SERVICE_PROP_KIND_BY_TILE_TYPE.get(type);
  if (key === undefined) return null;
  const entry = getManifestEntry(key);
  const scale = ts / entry.tileScale;
  return {
    left: entry.tileX * scale,
    up: entry.tileY * scale,
    right: (entry.frameWidth - entry.tileX) * scale - ts,
    down: (entry.frameHeight - entry.tileY) * scale - ts,
  };
}
