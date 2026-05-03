import type { TileContent } from '../tileTypes';
import {
  FloorTypeValue,
  VOID_TYPE,
  BUILDING_WALL,
  ROOF_THATCH,
  ROOF_SLATE,
  ROOF_RED,
  ROOF_GREEN,
  ROOF_CIRCUS_RED,
  ROOF_CIRCUS_BLUE,
  ROOF_CIRCUS_PURPLE,
} from '../tileTypes';
import { drawWallShadow } from './helpers';
import { getSpriteDef } from '../../core/SpriteLoader';
import { drawSprite } from '../../core/SpriteRenderer';

export function tileHash2(tx: number, ty: number): number {
  return ((Math.imul(tx, 2246822519) ^ Math.imul(ty, 668265263)) >>> 0) % 65536;
}

// The entire dungeon uses one floor type and one wall type for visual
// consistency. Variety comes from which of the 8 variants is chosen per tile.
function dungeonFloorVariant(tx: number, ty: number): { state: string; frame: number } {
  return { state: 'floor_plain', frame: tileHash2(tx, ty) % 8 };
}

function dungeonWallVariant(tx: number, ty: number): { state: string; frame: number } {
  return { state: 'wall_plain', frame: tileHash2(tx, ty) % 8 };
}

// Weighted frame picker for the overworld tileset — columns 0 and 1 only, ~50/50.
const OVERWORLD_FRAME_TABLE = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1] as const;

export function overworldFrame(tx: number, ty: number): number {
  return OVERWORLD_FRAME_TABLE[tileHash2(tx, ty) % OVERWORLD_FRAME_TABLE.length];
}

// Independent hash for rotation so it doesn't correlate with frame selection.
export function overworldRotation(tx: number, ty: number): number {
  const h = ((Math.imul(tx, 1664525) ^ Math.imul(ty, 1013904223)) >>> 0) % 4;
  return h * (Math.PI / 2);
}

// Draw an overworld tileset sprite, falling back to a solid fill if not yet loaded.
// Rotation (radians) is applied around the tile center; use overworldRotation() for variety.
export function drawOverworldSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  state: string,
  frame: number,
  fallbackColor: string,
  rotation = 0,
): void {
  const def = getSpriteDef('overworld_tileset');
  if (!def) {
    ctx.fillStyle = fallbackColor;
    ctx.fillRect(sx, sy, ts, ts);
    return;
  }
  const stateDef = def.states.get(state);
  if (!stateDef) {
    ctx.fillStyle = fallbackColor;
    ctx.fillRect(sx, sy, ts, ts);
    return;
  }
  const { img, frameWidth, frameHeight, tileScale } = def;
  const scale = ts / tileScale;
  const clampedFrame = Math.max(0, Math.min(Math.floor(frame), stateDef.frameCount - 1));
  const srcX = clampedFrame * frameWidth;
  const srcY = stateDef.row * frameHeight;
  const dw = frameWidth * scale;
  const dh = frameHeight * scale;
  if (rotation === 0) {
    ctx.drawImage(img, srcX, srcY, frameWidth, frameHeight, sx, sy, dw, dh);
  } else {
    ctx.save();
    ctx.translate(sx + ts / 2, sy + ts / 2);
    ctx.rotate(rotation);
    ctx.drawImage(img, srcX, srcY, frameWidth, frameHeight, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  }
}

// Draw a dungeon tileset sprite, falling back to a solid fill if not yet loaded.
function drawDungeonSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  state: string,
  frame: number,
  fallbackColor: string,
): void {
  const def = getSpriteDef('dungeon_tileset');
  if (!def) {
    ctx.fillStyle = fallbackColor;
    ctx.fillRect(sx, sy, ts, ts);
    return;
  }
  const stateDef = def.states.get(state);
  if (!stateDef) {
    ctx.fillStyle = fallbackColor;
    ctx.fillRect(sx, sy, ts, ts);
    return;
  }
  drawSprite(ctx, def, stateDef, frame, sx, sy, ts);
}

export function drawTerrainTile(
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
    // Void (outer border)
    case VOID_TYPE: {
      ctx.fillStyle = '#000000';
      ctx.fillRect(sx, sy, ts, ts);
      break;
    }

    // Outdoors
    case FloorTypeValue.grass: {
      drawOverworldSprite(
        ctx,
        sx,
        sy,
        ts,
        'grass',
        overworldFrame(tx, ty),
        '#6de89d',
        overworldRotation(tx, ty),
      );
      break;
    }
    case FloorTypeValue.road: {
      drawOverworldSprite(
        ctx,
        sx,
        sy,
        ts,
        'village_streets',
        overworldFrame(tx, ty),
        '#bc926b',
        overworldRotation(tx, ty),
      );
      // Door threshold: roof interior immediately north + building wall on either side
      const rdN = structure[ty - 1]?.[tx]?.type;
      const isDoorTile =
        (rdN === ROOF_THATCH ||
          rdN === ROOF_SLATE ||
          rdN === ROOF_RED ||
          rdN === ROOF_GREEN ||
          rdN === ROOF_CIRCUS_RED ||
          rdN === ROOF_CIRCUS_BLUE ||
          rdN === ROOF_CIRCUS_PURPLE) &&
        (structure[ty]?.[tx - 1]?.type === BUILDING_WALL ||
          structure[ty]?.[tx + 1]?.type === BUILDING_WALL);
      if (isDoorTile) {
        // Stone threshold slab
        ctx.fillStyle = '#9a8870';
        ctx.fillRect(sx, sy, ts, ts);
        ctx.fillStyle = '#8a7860';
        ctx.fillRect(sx + 2, sy + 2, ts - 4, ts - 4);
        ctx.fillStyle = '#b0a080'; // step edge highlight
        ctx.fillRect(sx, sy, ts, 2);
        ctx.fillRect(sx, sy, 2, ts);
        ctx.fillStyle = 'rgba(0,0,0,0.24)'; // shadow from overhang above
        ctx.fillRect(sx, sy, ts, 5);
      }
      break;
    }
    case FloorTypeValue.water: {
      ctx.fillStyle = '#2ac6ff';
      ctx.fillRect(sx, sy, ts, ts);
      break;
    }

    // Dungeon wall
    case FloorTypeValue.wall: {
      const { state: wallState, frame: wallFrame } = dungeonWallVariant(tx, ty);
      drawDungeonSprite(ctx, sx, sy, ts, wallState, wallFrame, '#2a2420');
      break;
    }

    // Dungeon floors

    // Dungeon floor — flagstone tiles from tileset
    case FloorTypeValue.concrete: {
      const { state: floorState, frame: floorFrame } = dungeonFloorVariant(tx, ty);
      drawDungeonSprite(ctx, sx, sy, ts, floorState, floorFrame, '#7a8090');
      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);
      break;
    }

    // Light polished stone — cleaner, lighter rooms
    case FloorTypeValue.tile_floor: {
      drawDungeonSprite(ctx, sx, sy, ts, 'floor_worn', tileHash2(tx, ty) % 8, '#b0aaa0');
      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);
      break;
    }

    // Dark stone — atmospheric rooms
    case FloorTypeValue.carpet: {
      drawDungeonSprite(ctx, sx, sy, ts, 'floor_dark', tileHash2(tx, ty) % 8, '#828490');
      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);
      break;
    }

    // Mossy stone — damp, older chambers
    case FloorTypeValue.wood: {
      drawDungeonSprite(ctx, sx, sy, ts, 'floor_mossy', tileHash2(tx, ty) % 8, '#8a9088');
      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);
      break;
    }

    default:
      return false;
  }
  return true;
}
