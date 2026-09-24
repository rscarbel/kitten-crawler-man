import { drawSpriteKey } from '../../../core/SpriteRenderer';
import {
  BENCH_SEGMENTS,
  BENCH_VARIANTS,
  SHELF_VARIANTS,
  type BenchSegment,
} from '../../../sprites/art/spiderLabArt';
import {
  benchFrameIndex,
  sideShelfFrameIndex,
  terminalFrameIndex,
} from '../../../sprites/sheets/bossRooms/spiderLabSheets';
import { isWalkableTileType } from '../../walkability';
import { tileCoordKey } from '../../tileIndex';
import type { TileContent } from '../../tileTypes';
import {
  LAB_BENCH,
  LAB_SHELF,
  LAB_WEB,
  PROP_DAMAGE_STAGE_INTACT,
  positionHash,
} from '../../tileTypes';
import { drawLabWeb } from './labFloorPainter';
import { spiderLabFloorPlanFor } from './labFloorPlan';
import { drawFloorBeneath } from './floorBeneath';

/** Salts the glassware and shelf-load pick, so it does not follow the floor's own tile hash. */
const FURNITURE_VARIANT_SALT = 0x3c6ef372;

/**
 * Paints the boss-room tile types of the Grotesque Spider's lab. Returns false for any other type.
 *
 * A solid prop is Y-sorted: the chunk bake has already drawn the floor beneath
 * it, so its case paints only the prop, from the lab's painted sheets. A flat
 * decal is baked into the chunk and paints its own floor.
 */
export function drawLabTile(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  type: number,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): boolean {
  switch (type) {
    case LAB_BENCH:
      drawBenchTile(ctx, structure, sx, sy, ts, tx, ty);
      return true;
    case LAB_SHELF: {
      const variant = ((positionHash(tx, ty) ^ FURNITURE_VARIANT_SALT) >>> 0) % SHELF_VARIANTS;
      const isShelf = (x: number, y: number): boolean => structure[y]?.[x]?.type === LAB_SHELF;
      const runsAlongWall = isShelf(tx, ty - 1) || isShelf(tx, ty + 1);
      if (!runsAlongWall) {
        drawSpriteKey(ctx, 'spider_lab_shelf', 'idle', variant, sx, sy, ts);
        return true;
      }
      // Painted against a west wall; one against an east wall is its mirror.
      const againstEastWall = tx > 0 && isWalkableTileType(structure[ty][tx - 1]);
      const end = !isShelf(tx, ty + 1);
      const frame = sideShelfFrameIndex(variant, end);
      drawSpriteKey(ctx, 'spider_lab_shelf', 'side', frame, sx, sy, ts, { flipX: againstEastWall });
      return true;
    }
    case LAB_WEB:
      drawFloorBeneath(ctx, structure, sx, sy, ts, tx, ty);
      drawLabWeb(ctx, structure, sx, sy, ts, tx, ty);
      return true;
    default:
      return false;
  }
}

function drawBenchTile(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const plan = spiderLabFloorPlanFor(structure);
  const slice = plan?.terminalSlices.get(tileCoordKey(tx, ty));
  if (slice !== undefined) {
    const frame = terminalFrameIndex(slice.col, slice.row);
    drawSpriteKey(ctx, 'spider_lab_terminal', 'slice', frame, sx, sy, ts);
    return;
  }
  const isBench = (x: number, y: number): boolean =>
    structure[y]?.[x]?.type === LAB_BENCH && plan?.terminalSlices.has(tileCoordKey(x, y)) !== true;
  const segment = benchSegment(
    isBench(tx - 1, ty),
    isBench(tx + 1, ty),
    isBench(tx, ty - 1),
    isBench(tx, ty + 1),
  );
  const variant = ((positionHash(tx, ty) ^ FURNITURE_VARIANT_SALT) >>> 0) % BENCH_VARIANTS;
  const frame = benchFrameIndex(BENCH_SEGMENTS.indexOf(segment), variant);
  const intact =
    (structure[ty][tx].damageStage ?? PROP_DAMAGE_STAGE_INTACT) === PROP_DAMAGE_STAGE_INTACT;
  drawSpriteKey(ctx, 'spider_lab_bench', intact ? 'intact' : 'broken', frame, sx, sy, ts);
}

/** Which piece of its run a bench tile is, from which neighbours are bench too. */
function benchSegment(west: boolean, east: boolean, north: boolean, south: boolean): BenchSegment {
  if (west || east) {
    if (west && east) return 'rowMid';
    return west ? 'rowRight' : 'rowLeft';
  }
  if (north || south) {
    if (north && south) return 'colMid';
    return north ? 'colBottom' : 'colTop';
  }
  return 'rowSingle';
}
