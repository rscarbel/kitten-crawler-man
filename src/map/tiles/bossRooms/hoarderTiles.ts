import { drawSpriteKey, timeFrameIndex } from '../../../core/SpriteRenderer';
import { getSpriteDef } from '../../../core/SpriteLoader';
import {
  FLOOR_DECALS,
  GRIME_EDGE_ORDER,
  HOARD_PILE_VARIANTS,
  LINOLEUM_VARIANTS,
  pileFrame,
  pileFillFrame,
  TOWER_RUBBLE_VARIANTS,
  TOWER_WOBBLE_ART_FRAMES,
} from '../../../sprites/art/hoarderRoomArt';
import { frameTime } from '../../../utils';
import type { TileContent } from '../../tileTypes';
import {
  HOARD_BAG,
  HOARD_PILE,
  HOARD_RUBBLE,
  HOARD_TOWER,
  positionHash,
  propSpriteState,
} from '../../tileTypes';
import { isWalkableTileType } from '../../walkability';
import { drawWallShadow } from '../helpers';

/** How fast a wobbling tower rocks: the shared overlay clock. */
export const TOWER_WOBBLE_FPS = 8;

/**
 * Independent picks from one position hash, each from its own bits, so the
 * linoleum variant, whether a tile carries litter and which litter it is do
 * not move together.
 */
const LINOLEUM_HASH_SHIFT = 0;
const DECAL_ROLL_HASH_SHIFT = 8;
const DECAL_PICK_HASH_SHIFT = 16;
const PILE_VARIANT_HASH_SHIFT = 24;
const HASH_BYTE = 0xff;
const PERCENT = 100;
const FILTH_HASH_SHIFT = 4;
/** The darkest a filthy square is pushed toward the room's brown dark. */
const FILTH_MAX_ALPHA = 0.05;
const FILTH_RGB = '30,20,8';
const LINOLEUM_PICK_RANGE = 16;
/** The variants with nothing wrong with them but dirt. */
const PLAIN_LINOLEUM_VARIANTS: readonly number[] = [0, 6];
/** Share of the lair's floor tiles with a piece of litter baked into them. */
const DECAL_PERCENT = 12;

/** The lair's floor while its sheet is still painting: the linoleum's average, grimed. */
const HOARDER_FLOOR_FALLBACK = '#5e5436';

function hashByte(tx: number, ty: number, shift: number): number {
  return (positionHash(tx, ty) >>> shift) & HASH_BYTE;
}

/**
 * Which linoleum variant a tile gets. Most tiles are one of the plain ones;
 * each damaged variant turns up about one tile in {@link LINOLEUM_PICK_RANGE},
 * so a torn square or a missing one is an incident, not a pattern.
 */
function linoleumVariant(tx: number, ty: number): number {
  const pick = hashByte(tx, ty, LINOLEUM_HASH_SHIFT) % LINOLEUM_PICK_RANGE;
  if (pick < LINOLEUM_VARIANTS) return pick;
  return PLAIN_LINOLEUM_VARIANTS[pick % PLAIN_LINOLEUM_VARIANTS.length];
}

/** The side of a tile a grime frame darkens, as a neighbour offset. */
const GRIME_NEIGHBOURS: Readonly<
  Record<(typeof GRIME_EDGE_ORDER)[number], { dx: number; dy: number }>
> = {
  north: { dx: 0, dy: -1 },
  east: { dx: 1, dy: 0 },
  south: { dx: 0, dy: 1 },
  west: { dx: -1, dy: 0 },
};

/** Filth banks up against anything that cannot be walked through: walls, heaps, bags. */
function banksGrime(structure: TileContent[][], tx: number, ty: number): boolean {
  const row = ty >= 0 && ty < structure.length ? structure[ty] : undefined;
  if (row === undefined || tx < 0 || tx >= row.length) return true;
  return !isWalkableTileType(row[tx]);
}

/**
 * Whether a heap runs on into the tile beside it: another heap, or a wall.
 * Never a tower or a bag, which stand on their own, and never floor — a
 * heap's art may only reach toward tiles nobody can stand on.
 */
function heapRunsOnInto(structure: TileContent[][], tx: number, ty: number): boolean {
  const row = ty >= 0 && ty < structure.length ? structure[ty] : undefined;
  if (row === undefined || tx < 0 || tx >= row.length) return true;
  const tile = row[tx];
  if (tile.type === HOARD_PILE) return true;
  if (tile.type === HOARD_TOWER || tile.type === HOARD_BAG) return false;
  return !isWalkableTileType(tile);
}

/**
 * The lair's floor: dull yellowed linoleum, one square to a tile in one of
 * several quietly worn variants, darkened along every side that meets a wall
 * or a heap, with a sparse scattering of faded litter. Every choice is a function of the tile's position, so
 * a re-bake paints the same floor.
 */
export function drawHoarderFloor(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  if (getSpriteDef('hoarder_floor') === undefined) {
    ctx.fillStyle = HOARDER_FLOOR_FALLBACK;
    ctx.fillRect(sx, sy, ts, ts);
    drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);
    return;
  }
  drawSpriteKey(ctx, 'hoarder_floor', 'linoleum', linoleumVariant(tx, ty), sx, sy, ts);
  // Some squares are simply filthier than others.
  const filth = (hashByte(tx, ty, FILTH_HASH_SHIFT) / HASH_BYTE) * FILTH_MAX_ALPHA;
  ctx.fillStyle = `rgba(${FILTH_RGB},${filth.toFixed(2)})`;
  ctx.fillRect(sx, sy, ts, ts);
  GRIME_EDGE_ORDER.forEach((edge, frame) => {
    const { dx, dy } = GRIME_NEIGHBOURS[edge];
    if (banksGrime(structure, tx + dx, ty + dy)) {
      drawSpriteKey(ctx, 'hoarder_floor', 'grime', frame, sx, sy, ts);
    }
  });
  if ((hashByte(tx, ty, DECAL_ROLL_HASH_SHIFT) * PERCENT) / (HASH_BYTE + 1) < DECAL_PERCENT) {
    const decal = hashByte(tx, ty, DECAL_PICK_HASH_SHIFT) % FLOOR_DECALS;
    drawSpriteKey(ctx, 'hoarder_floor', 'decal', decal, sx, sy, ts);
  }
  drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);
  drawHeapFill(ctx, structure, sx, sy, ts, tx, ty);
}

/**
 * Under a heap in a column of heaps, the junk packed between it and the next:
 * baked with the floor beneath it, so it costs nothing per frame and the heap
 * drawn over it in the sorted pass stands on it.
 */
function drawHeapFill(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  if (structure[ty][tx].type !== HOARD_PILE) return;
  const joins = {
    left: heapRunsOnInto(structure, tx - 1, ty),
    right: heapRunsOnInto(structure, tx + 1, ty),
    above: heapRunsOnInto(structure, tx, ty - 1),
    below: heapRunsOnInto(structure, tx, ty + 1),
  };
  if (!joins.above && !joins.below) return;
  drawSpriteKey(ctx, 'hoard_pile_fill', 'idle', pileFillFrame(joins), sx, sy, ts);
}

/**
 * Paints the boss-room tile types of the Hoarder's lair. Returns false for any other type.
 *
 * A solid prop is Y-sorted: the chunk bake has already drawn the floor beneath
 * it, so its case paints only the prop. Rubble is a flat decal baked into the
 * chunk and paints its own floor.
 */
export function drawHoarderTile(
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
    case HOARD_PILE: {
      const joins = {
        left: heapRunsOnInto(structure, tx - 1, ty),
        right: heapRunsOnInto(structure, tx + 1, ty),
      };
      drawSpriteKey(
        ctx,
        'hoard_pile',
        'idle',
        pileFrame(hashByte(tx, ty, PILE_VARIANT_HASH_SHIFT) % HOARD_PILE_VARIANTS, joins),
        sx,
        sy,
        ts,
      );
      return true;
    }
    case HOARD_TOWER: {
      // A cracked tower is one that has been set rocking and is about to go.
      const wobbling = propSpriteState(structure[ty][tx].damageStage) === 'damaged';
      if (wobbling) {
        const frame = timeFrameIndex(frameTime, TOWER_WOBBLE_FPS, TOWER_WOBBLE_ART_FRAMES);
        drawSpriteKey(ctx, 'hoard_tower', 'wobble', frame, sx, sy, ts);
      } else {
        drawSpriteKey(ctx, 'hoard_tower', 'idle', 0, sx, sy, ts);
      }
      return true;
    }
    case HOARD_BAG:
      drawSpriteKey(
        ctx,
        'garbage_bag',
        propSpriteState(structure[ty][tx].damageStage),
        0,
        sx,
        sy,
        ts,
      );
      return true;
    case HOARD_RUBBLE:
      drawHoarderFloor(ctx, structure, sx, sy, ts, tx, ty);
      drawSpriteKey(
        ctx,
        'hoard_tower',
        'rubble',
        hashByte(tx, ty, PILE_VARIANT_HASH_SHIFT) % TOWER_RUBBLE_VARIANTS,
        sx,
        sy,
        ts,
      );
      return true;
    default:
      return false;
  }
}
