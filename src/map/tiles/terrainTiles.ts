import {
  FloorTypeValue,
  TileContent,
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
      ctx.fillStyle = '#6de89d';
      ctx.fillRect(sx, sy, ts, ts);
      break;
    }
    case FloorTypeValue.road: {
      ctx.fillStyle = '#bc926b';
      ctx.fillRect(sx, sy, ts, ts);
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
      // Dark brick/concrete base
      ctx.fillStyle = '#2e2420';
      ctx.fillRect(sx, sy, ts, ts);
      // Lit top face — simulates overhead light catching the wall top
      ctx.fillStyle = '#4e3e34';
      ctx.fillRect(sx, sy, ts, 3);
      // Subtle left edge highlight
      ctx.fillStyle = '#3c3028';
      ctx.fillRect(sx, sy, 2, ts);
      // Horizontal mortar seam in the middle
      ctx.fillStyle = '#1c1814';
      ctx.fillRect(sx, sy + Math.floor(ts / 2), ts, 1);
      // Staggered vertical mortar (brick bond pattern)
      const brickOff = ty % 2 === 0 ? 0 : Math.floor(ts / 2);
      const vx = sx + (brickOff % ts);
      if (vx >= sx && vx < sx + ts) {
        ctx.fillRect(vx, sy + 3, 1, Math.floor(ts / 2) - 3);
      }
      break;
    }

    // Dungeon floors

    // Poured concrete — hallways, utility rooms
    case FloorTypeValue.concrete: {
      const shade = (tx + ty) % 2 === 0 ? '#b4b0ab' : '#aaa7a2';
      ctx.fillStyle = shade;
      ctx.fillRect(sx, sy, ts, ts);
      // Expansion-joint seams every 2 tiles
      ctx.fillStyle = '#909088';
      if (tx % 2 === 0) ctx.fillRect(sx, sy, 1, ts);
      if (ty % 2 === 0) ctx.fillRect(sx, sy, ts, 1);
      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);
      break;
    }

    // Ceramic tile — offices, bathrooms
    case FloorTypeValue.tile_floor: {
      const even = (tx + ty) % 2 === 0;
      ctx.fillStyle = even ? '#d8d0b8' : '#cac2aa';
      ctx.fillRect(sx, sy, ts, ts);
      // Grout lines
      ctx.fillStyle = '#9c9078';
      ctx.fillRect(sx + ts - 1, sy, 1, ts);
      ctx.fillRect(sx, sy + ts - 1, ts, 1);
      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);
      break;
    }

    // Carpet — conference rooms, executive offices
    case FloorTypeValue.carpet: {
      const even = (tx + ty) % 2 === 0;
      ctx.fillStyle = even ? '#6e2418' : '#7a2c1e';
      ctx.fillRect(sx, sy, ts, ts);
      // Weave texture: thin cross-lines
      ctx.fillStyle = 'rgba(0,0,0,0.14)';
      ctx.fillRect(sx, sy, 1, ts);
      ctx.fillRect(sx, sy, ts, 1);
      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);
      break;
    }

    // Hardwood — break rooms, reception
    case FloorTypeValue.wood: {
      const plankGroup = Math.floor(ty / 2) % 3;
      const plankColors = ['#9e6e3a', '#8e6030', '#aa7840'] as const;
      ctx.fillStyle = plankColors[plankGroup];
      ctx.fillRect(sx, sy, ts, ts);
      // Left plank seam
      ctx.fillStyle = '#5a3818';
      ctx.fillRect(sx, sy, 1, ts);
      // Horizontal wood grain
      ctx.fillStyle = 'rgba(0,0,0,0.07)';
      for (let g = 6; g < ts; g += 7) {
        ctx.fillRect(sx + 1, sy + g, ts - 1, 1);
      }
      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);
      break;
    }

    default:
      return false;
  }
  return true;
}
