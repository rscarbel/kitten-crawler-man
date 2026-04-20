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
      // XOR-mixed hash avoids the linear aliasing that creates visible stripes/lines
      const wallHash = ((tx * 374761393) ^ (ty * 1103515245)) & 0xff;
      // Subtle per-tile brick color variation
      const brickColors = ['#2e2420', '#2c2220', '#302618', '#2a2018'] as const;
      ctx.fillStyle = brickColors[wallHash % 4];
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
      // Jagged crack (~4% of tiles)
      if (wallHash % 25 === 1) {
        const w2 = ((tx * 2246822519) ^ (ty * 668265263)) & 0xff;
        ctx.strokeStyle = 'rgba(0,0,0,0.50)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        const cx0 = sx + ts * (0.3 + (wallHash % 5) * 0.08);
        const seg = ts / 6;
        // Each jag offset is independent — keeps crack within tile width
        const j = (b: number) => ((b % 5) - 2) * ts * 0.07;
        ctx.moveTo(cx0, sy + ts * 0.04);
        ctx.lineTo(cx0 + j(wallHash >> 2), sy + seg);
        ctx.lineTo(cx0 + j(w2), sy + seg * 2);
        ctx.lineTo(cx0 + j(wallHash >> 4), sy + seg * 3);
        ctx.lineTo(cx0 + j(w2 >> 3), sy + seg * 4);
        ctx.lineTo(cx0 + j(w2 >> 1), sy + seg * 5);
        ctx.lineTo(cx0 + j(wallHash), sy + ts * 0.96);
        ctx.stroke();
        // Short branch off mid-crack (2 out of 3 tiles)
        if (w2 % 3 !== 2) {
          ctx.beginPath();
          const branchX = cx0 + j(wallHash >> 4);
          ctx.moveTo(branchX, sy + seg * 3);
          ctx.lineTo(branchX + j(w2 >> 2) + ts * 0.1, sy + seg * 3.8);
          ctx.stroke();
        }
      }
      // Water stain / mineral streak (~1% of tiles)
      if (wallHash % 100 === 7) {
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        const stainX = sx + ts * (0.2 + (wallHash % 6) * 0.1);
        ctx.fillRect(stainX, sy + ts * 0.25, 1, ts * 0.55);
        ctx.fillRect(stainX + 2, sy + ts * 0.35, 1, ts * 0.4);
        ctx.fillRect(stainX + 4, sy + ts * 0.42, 1, ts * 0.3);
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
      // XOR-mixed hash avoids the linear aliasing that creates visible stripes/lines
      const chash = ((tx * 374761393) ^ (ty * 1103515245)) & 0xff;
      // Jagged hairline crack (~4% of tiles)
      if (chash % 25 === 0) {
        const ch2 = ((tx * 2246822519) ^ (ty * 668265263)) & 0xff;
        ctx.strokeStyle = 'rgba(70,66,60,0.55)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        const cx0 = sx + ts * (0.25 + (chash % 6) * 0.08);
        const seg = ts / 5;
        const j = (b: number) => ((b % 5) - 2) * ts * 0.06;
        ctx.moveTo(cx0, sy + ts * 0.05);
        ctx.lineTo(cx0 + j(chash >> 2), sy + seg);
        ctx.lineTo(cx0 + j(ch2), sy + seg * 2);
        ctx.lineTo(cx0 + j(chash >> 4), sy + seg * 3);
        ctx.lineTo(cx0 + j(ch2 >> 3), sy + seg * 4);
        ctx.lineTo(cx0 + j(ch2 >> 1), sy + ts * 0.95);
        ctx.stroke();
      }
      // Dirt stain (~1% of tiles)
      if (chash % 100 === 13) {
        ctx.fillStyle = 'rgba(55,50,44,0.20)';
        ctx.beginPath();
        ctx.ellipse(
          sx + ts * (0.38 + (chash % 5) * 0.06),
          sy + ts * (0.42 + (chash % 3) * 0.08),
          ts * 0.28,
          ts * 0.18,
          (chash % 6) * 0.5,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
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
