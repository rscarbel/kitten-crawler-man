import type { TileContent } from '../tileTypes';
import {
  SAFE_ROOM_FLOOR,
  HORDER_BOSS_ROOM_FLOOR,
  JUICER_BOSS_ROOM_FLOOR,
  KRAKAREN_BOSS_ROOM_FLOOR,
  ARENA_FLOOR,
  FLOOR_GRATE,
} from '../tileTypes';
import { drawWallShadow } from './helpers';

export function drawSpecialFloorTile(
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
    // Safe Room floor — warm sanctuary
    case SAFE_ROOM_FLOOR: {
      // Alternating warm cream tiles
      const safeBase = (tx + ty) % 2 === 0 ? '#f0e4c8' : '#e8d8b8';
      ctx.fillStyle = safeBase;
      ctx.fillRect(sx, sy, ts, ts);
      // Soft golden grout lines
      ctx.fillStyle = '#c8b890';
      ctx.fillRect(sx + ts - 1, sy, 1, ts);
      ctx.fillRect(sx, sy + ts - 1, ts, 1);
      // Subtle warm glow dot at tile corners
      if (tx % 4 === 0 && ty % 4 === 0) {
        ctx.fillStyle = 'rgba(255,200,80,0.25)';
        ctx.beginPath();
        ctx.arc(sx, sy, ts * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);
      break;
    }

    // Boss Room floor — grimy, trash-covered
    case HORDER_BOSS_ROOM_FLOOR: {
      // Dark yellowish-brown base with alternating grime variation
      const bossBase = (tx + ty) % 2 === 0 ? '#2e2010' : '#281c0c';
      ctx.fillStyle = bossBase;
      ctx.fillRect(sx, sy, ts, ts);
      // Dark cracked grout lines
      ctx.fillStyle = '#1a1208';
      ctx.fillRect(sx + ts - 1, sy, 1, ts);
      ctx.fillRect(sx, sy + ts - 1, ts, 1);
      // Puke/grime stain blotches scattered across floor
      if ((tx * 3 + ty * 7) % 5 === 0) {
        ctx.fillStyle = 'rgba(120,140,20,0.28)';
        ctx.beginPath();
        ctx.ellipse(sx + ts * 0.4, sy + ts * 0.5, ts * 0.35, ts * 0.22, 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
      if ((tx * 5 + ty * 3) % 7 === 0) {
        ctx.fillStyle = 'rgba(80,60,10,0.35)';
        ctx.beginPath();
        ctx.ellipse(sx + ts * 0.65, sy + ts * 0.35, ts * 0.2, ts * 0.14, -0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);
      break;
    }

    // Juicer Gym floor — dark rubber mat
    case JUICER_BOSS_ROOM_FLOOR: {
      // Very dark grey rubber base
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(sx, sy, ts, ts);
      // Subtle grid lines every tile
      ctx.fillStyle = '#222';
      ctx.fillRect(sx + ts - 1, sy, 1, ts);
      ctx.fillRect(sx, sy + ts - 1, ts, 1);
      // Rubber texture dots (deterministic pattern)
      if ((tx + ty) % 3 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.beginPath();
        ctx.arc(sx + ts * 0.5, sy + ts * 0.5, ts * 0.18, 0, Math.PI * 2);
        ctx.fill();
      }
      // Orange gym line markings every 4 tiles
      if (tx % 4 === 0) {
        ctx.fillStyle = 'rgba(249,115,22,0.18)';
        ctx.fillRect(sx, sy, 2, ts);
      }
      if (ty % 4 === 0) {
        ctx.fillStyle = 'rgba(249,115,22,0.18)';
        ctx.fillRect(sx, sy, ts, 2);
      }
      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);
      break;
    }

    // Krakaren Clone lair — dark wet cavern floor
    case KRAKAREN_BOSS_ROOM_FLOOR: {
      // Dark blue-grey stone base
      const cavBase = (tx + ty) % 2 === 0 ? '#1a1e24' : '#161a20';
      ctx.fillStyle = cavBase;
      ctx.fillRect(sx, sy, ts, ts);
      // Wet sheen patches
      if ((tx * 7 + ty * 13) % 5 === 0) {
        ctx.fillStyle = 'rgba(100,140,180,0.08)';
        ctx.beginPath();
        ctx.ellipse(
          sx + ts * 0.5,
          sy + ts * 0.5,
          ts * 0.35,
          ts * 0.25,
          (tx + ty) * 0.5,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      // Crack lines
      if ((tx + ty * 3) % 7 === 0) {
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(sx + ts * 0.2, sy + ts * 0.3);
        ctx.lineTo(sx + ts * 0.8, sy + ts * 0.7);
        ctx.stroke();
      }
      // Pink slime drips (hints at the Krakaren)
      if ((tx * 11 + ty * 5) % 9 === 0) {
        ctx.fillStyle = 'rgba(220,100,140,0.15)';
        ctx.beginPath();
        ctx.ellipse(sx + ts * 0.6, sy + ts * 0.4, ts * 0.12, ts * 0.08, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);
      break;
    }

    // Arena floor — dark steel grating with blood-stained centre
    case ARENA_FLOOR: {
      // Base: very dark steel grey
      ctx.fillStyle = '#18191f';
      ctx.fillRect(sx, sy, ts, ts);

      // Grating crosshatch lines
      ctx.strokeStyle = '#23262e';
      ctx.lineWidth = 1;
      const gridStep = Math.floor(ts / 4);
      for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(sx + i * gridStep, sy);
        ctx.lineTo(sx + i * gridStep, sy + ts);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(sx, sy + i * gridStep);
        ctx.lineTo(sx + ts, sy + i * gridStep);
        ctx.stroke();
      }

      // Rivet dots at grid intersections
      const h2 = tx * 7 + ty * 13;
      if ((tx + ty) % 2 === 0) {
        ctx.fillStyle = '#2e323c';
        for (let iy = 1; iy < 4; iy++) {
          for (let ix = 1; ix < 4; ix++) {
            if ((ix + iy) % 2 === 0) {
              ctx.beginPath();
              ctx.arc(sx + ix * gridStep, sy + iy * gridStep, 1.2, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
      }

      // Subtle blood stain on some tiles
      const bloodSeed = (tx * 3571 + ty * 1237) & 0xffff;
      if (bloodSeed % 11 === 0) {
        ctx.globalAlpha = 0.18 + (bloodSeed % 7) * 0.03;
        ctx.fillStyle = '#6b1a1a';
        ctx.beginPath();
        ctx.ellipse(
          sx + ts * 0.5 + ((bloodSeed % 8) - 4),
          sy + ts * 0.5 + (((bloodSeed >> 4) % 8) - 4),
          ts * (0.2 + (bloodSeed % 5) * 0.04),
          ts * (0.12 + (bloodSeed % 4) * 0.03),
          (bloodSeed % 16) * 0.4,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      void h2;
      break;
    }

    // Floor Grate — dark metal grate over dungeon floor
    case FLOOR_GRATE: {
      // Base floor (same as concrete)
      ctx.fillStyle = '#505050';
      ctx.fillRect(sx, sy, ts, ts);
      // Grate bars — horizontal slits
      ctx.fillStyle = '#2a2a2a';
      const barH = Math.max(2, ts * 0.06);
      const gap = ts / 6;
      for (let i = 1; i < 6; i++) {
        ctx.fillRect(sx + ts * 0.1, sy + gap * i - barH / 2, ts * 0.8, barH);
      }
      // Vertical frame bars
      ctx.fillStyle = '#3a3a3a';
      ctx.fillRect(sx + ts * 0.08, sy + ts * 0.08, ts * 0.04, ts * 0.84);
      ctx.fillRect(sx + ts * 0.88, sy + ts * 0.08, ts * 0.04, ts * 0.84);
      // Dark centre void below grate
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(sx + ts * 0.14, sy + ts * 0.14, ts * 0.72, ts * 0.72);
      // Metallic rim highlight
      ctx.strokeStyle = '#6a6a6a';
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + ts * 0.08, sy + ts * 0.08, ts * 0.84, ts * 0.84);
      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);
      break;
    }

    default:
      return false;
  }
  return true;
}
