import type { TileContent } from '../tileTypes';
import {
  SAFE_ROOM_FLOOR,
  HORDER_BOSS_ROOM_FLOOR,
  JUICER_BOSS_ROOM_FLOOR,
  KRAKAREN_BOSS_ROOM_FLOOR,
  ARENA_FLOOR,
  FLOOR_GRATE,
  SPIDER_LAB_FLOOR,
  CLUB_FLOOR,
  DANCE_FLOOR,
} from '../tileTypes';
import { drawWallShadow } from './helpers';
import { getSpriteDef } from '../../core/SpriteLoader';

const SAFE_ROOM_GLOW_TILE_STRIDE = 4;
const SAFE_ROOM_GLOW_RADIUS_FRACTION = 0.3;

const GYM_RUBBER_DOT_TILE_STRIDE = 3;
const GYM_RUBBER_DOT_ALPHA = 0.04;
const GYM_RUBBER_DOT_RADIUS_FRACTION = 0.18;
const GYM_RUBBER_DOT_CENTER_FRACTION = 0.5;
const GYM_LINE_TILE_STRIDE = 4;
const GYM_LINE_ALPHA = 0.18;

const KRAKAREN_WET_SHEEN_HASH_X = 7;
const KRAKAREN_WET_SHEEN_HASH_Y = 13;
const KRAKAREN_WET_SHEEN_STRIDE = 5;
const KRAKAREN_ELLIPSE_MAJOR_FRACTION = 0.35;
const KRAKAREN_ELLIPSE_MINOR_FRACTION = 0.25;
const KRAKAREN_CRACK_HASH_X = 1;
const KRAKAREN_CRACK_HASH_Y = 3;
const KRAKAREN_CRACK_STRIDE = 7;
const KRAKAREN_CRACK_START_X_FRACTION = 0.2;
const KRAKAREN_CRACK_START_Y_FRACTION = 0.3;
const KRAKAREN_CRACK_END_X_FRACTION = 0.8;
const KRAKAREN_CRACK_END_Y_FRACTION = 0.7;
const KRAKAREN_SLIME_HASH_X = 11;
const KRAKAREN_SLIME_HASH_Y = 5;
const KRAKAREN_SLIME_STRIDE = 9;
const KRAKAREN_SLIME_CENTER_X_FRACTION = 0.6;
const KRAKAREN_SLIME_CENTER_Y_FRACTION = 0.4;
const KRAKAREN_SLIME_MAJOR_FRACTION = 0.12;
const KRAKAREN_SLIME_MINOR_FRACTION = 0.08;

const ARENA_GRID_DIVISIONS = 4;
const ARENA_HASH_X = 7;
const ARENA_RIVET_RADIUS = 1.2;
const ARENA_BLOOD_MODULUS = 3571;
const ARENA_BLOOD_Y_MODULUS = 1237;
const ARENA_BLOOD_SEED_MASK = 0xffff;
const ARENA_BLOOD_TILE_STRIDE = 11;
const ARENA_BLOOD_ALPHA_BASE = 0.18;
const ARENA_BLOOD_ALPHA_SCALE = 0.03;
const ARENA_BLOOD_SEED_MODULUS_7 = 7;
const ARENA_BLOOD_POSITION_OFFSET = 4;
const ARENA_BLOOD_SHIFT_BITS = 4;
const ARENA_BLOOD_MAJOR_BASE = 0.2;
const ARENA_BLOOD_MAJOR_SCALE = 0.04;
const ARENA_BLOOD_MAJOR_MODULUS = 5;
const ARENA_BLOOD_MINOR_BASE = 0.12;
const ARENA_BLOOD_MINOR_SCALE = 0.03;
const ARENA_BLOOD_MINOR_MODULUS = 4;
const ARENA_BLOOD_ROTATION_MODULUS = 16;
const ARENA_BLOOD_ROTATION_SCALE = 0.4;

const GRATE_BASE_FILL_FRACTION = 0.06;
const GRATE_GAP_DIVISIONS = 6;
const GRATE_HORIZONTAL_INSET_FRACTION = 0.1;
const GRATE_HORIZONTAL_WIDTH_FRACTION = 0.8;
const GRATE_FRAME_OUTER_FRACTION = 0.08;
const GRATE_FRAME_THICKNESS_FRACTION = 0.04;
const GRATE_FRAME_HEIGHT_FRACTION = 0.84;
const GRATE_VOID_INSET_FRACTION = 0.14;
const GRATE_VOID_SIZE_FRACTION = 0.72;
const GRATE_RIM_OUTER_FRACTION = 0.08;
const GRATE_RIM_SIZE_FRACTION = 0.84;

const SPIDER_WEB_HASH_X = 5;
const SPIDER_WEB_HASH_Y = 7;
const SPIDER_WEB_STRIDE = 9;
const SPIDER_WEB_START_X_FRACTION = 0.2;
const SPIDER_WEB_START_Y_FRACTION = 0.1;
const SPIDER_WEB_END_X_FRACTION = 0.8;
const SPIDER_WEB_END_Y_FRACTION = 0.9;
const SPIDER_WEB_ALT_START_X_FRACTION = 0.8;
const SPIDER_WEB_ALT_END_X_FRACTION = 0.2;

const CLUB_SUNBURST_TILE_STRIDE = 6;
const CLUB_SUNBURST_RAY_COUNT = 8;
const CLUB_SUNBURST_RADIUS_FRACTION = 0.32;
const CLUB_SUNBURST_CENTER_FRACTION = 0.5;
const DANCE_PANEL_INSET_FRACTION = 0.12;
const DANCE_PANEL_SIZE_FRACTION = 0.76;

// Lazily computed bounding box of HORDER_BOSS_ROOM_FLOOR tiles for a given map structure.
// Keyed on the structure array so it's automatically GC'd with the map.
const _hoarderBoundsCache = new WeakMap<
  TileContent[][],
  { minX: number; minY: number; maxX: number; maxY: number } | null
>();

function findHoarderBounds(
  structure: TileContent[][],
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const cached = _hoarderBoundsCache.get(structure);
  if (cached !== undefined) return cached;

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (let y = 0; y < structure.length; y++) {
    const row = structure[y];
    for (let x = 0; x < row.length; x++) {
      if (row[x].type === HORDER_BOSS_ROOM_FLOOR) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const result = isFinite(minX) ? { minX, minY, maxX, maxY } : null;
  _hoarderBoundsCache.set(structure, result);
  return result;
}

const _spiderLabBoundsCache = new WeakMap<
  TileContent[][],
  { minX: number; minY: number; maxX: number; maxY: number } | null
>();

function findSpiderLabBounds(
  structure: TileContent[][],
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const cached = _spiderLabBoundsCache.get(structure);
  if (cached !== undefined) return cached;

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (let y = 0; y < structure.length; y++) {
    const row = structure[y];
    for (let x = 0; x < row.length; x++) {
      if (row[x].type === SPIDER_LAB_FLOOR) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const result = isFinite(minX) ? { minX, minY, maxX, maxY } : null;
  _spiderLabBoundsCache.set(structure, result);
  return result;
}

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
      if (tx % SAFE_ROOM_GLOW_TILE_STRIDE === 0 && ty % SAFE_ROOM_GLOW_TILE_STRIDE === 0) {
        ctx.fillStyle = 'rgba(255,200,80,0.25)';
        ctx.beginPath();
        ctx.arc(sx, sy, ts * SAFE_ROOM_GLOW_RADIUS_FRACTION, 0, Math.PI * 2);
        ctx.fill();
      }
      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);
      break;
    }

    // Hoarder Boss Room floor — single room image UV-mapped across all floor tiles
    case HORDER_BOSS_ROOM_FLOOR: {
      const def = getSpriteDef('hoarders_room');
      const bounds = findHoarderBounds(structure);
      if (def && bounds) {
        const { img } = def;
        const roomW = bounds.maxX - bounds.minX + 1;
        const roomH = bounds.maxY - bounds.minY + 1;
        const srcX = ((tx - bounds.minX) / roomW) * img.width;
        const srcY = ((ty - bounds.minY) / roomH) * img.height;
        const srcW = img.width / roomW;
        const srcH = img.height / roomH;
        ctx.drawImage(img, srcX, srcY, srcW, srcH, sx, sy, ts, ts);
      } else {
        ctx.fillStyle = '#281c0c';
        ctx.fillRect(sx, sy, ts, ts);
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
      if ((tx + ty) % GYM_RUBBER_DOT_TILE_STRIDE === 0) {
        ctx.fillStyle = `rgba(255,255,255,${GYM_RUBBER_DOT_ALPHA})`;
        ctx.beginPath();
        ctx.arc(
          sx + ts * GYM_RUBBER_DOT_CENTER_FRACTION,
          sy + ts * GYM_RUBBER_DOT_CENTER_FRACTION,
          ts * GYM_RUBBER_DOT_RADIUS_FRACTION,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      // Orange gym line markings every 4 tiles
      if (tx % GYM_LINE_TILE_STRIDE === 0) {
        ctx.fillStyle = `rgba(249,115,22,${GYM_LINE_ALPHA})`;
        ctx.fillRect(sx, sy, 2, ts);
      }
      if (ty % GYM_LINE_TILE_STRIDE === 0) {
        ctx.fillStyle = `rgba(249,115,22,${GYM_LINE_ALPHA})`;
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
      if (
        (tx * KRAKAREN_WET_SHEEN_HASH_X + ty * KRAKAREN_WET_SHEEN_HASH_Y) %
          KRAKAREN_WET_SHEEN_STRIDE ===
        0
      ) {
        ctx.fillStyle = 'rgba(100,140,180,0.08)';
        ctx.beginPath();
        ctx.ellipse(
          sx + ts * GYM_RUBBER_DOT_CENTER_FRACTION,
          sy + ts * GYM_RUBBER_DOT_CENTER_FRACTION,
          ts * KRAKAREN_ELLIPSE_MAJOR_FRACTION,
          ts * KRAKAREN_ELLIPSE_MINOR_FRACTION,
          (tx + ty) * GYM_RUBBER_DOT_CENTER_FRACTION,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      // Crack lines
      if ((tx * KRAKAREN_CRACK_HASH_X + ty * KRAKAREN_CRACK_HASH_Y) % KRAKAREN_CRACK_STRIDE === 0) {
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(
          sx + ts * KRAKAREN_CRACK_START_X_FRACTION,
          sy + ts * KRAKAREN_CRACK_START_Y_FRACTION,
        );
        ctx.lineTo(
          sx + ts * KRAKAREN_CRACK_END_X_FRACTION,
          sy + ts * KRAKAREN_CRACK_END_Y_FRACTION,
        );
        ctx.stroke();
      }
      // Pink slime drips (hints at the Krakaren)
      if ((tx * KRAKAREN_SLIME_HASH_X + ty * KRAKAREN_SLIME_HASH_Y) % KRAKAREN_SLIME_STRIDE === 0) {
        ctx.fillStyle = 'rgba(220,100,140,0.15)';
        ctx.beginPath();
        ctx.ellipse(
          sx + ts * KRAKAREN_SLIME_CENTER_X_FRACTION,
          sy + ts * KRAKAREN_SLIME_CENTER_Y_FRACTION,
          ts * KRAKAREN_SLIME_MAJOR_FRACTION,
          ts * KRAKAREN_SLIME_MINOR_FRACTION,
          0,
          0,
          Math.PI * 2,
        );
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
      const gridStep = Math.floor(ts / ARENA_GRID_DIVISIONS);
      for (let i = 1; i < ARENA_GRID_DIVISIONS; i++) {
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
      if ((tx + ty) % 2 === 0) {
        ctx.fillStyle = '#2e323c';
        for (let iy = 1; iy < ARENA_GRID_DIVISIONS; iy++) {
          for (let ix = 1; ix < ARENA_GRID_DIVISIONS; ix++) {
            if ((ix + iy) % 2 === 0) {
              ctx.beginPath();
              ctx.arc(sx + ix * gridStep, sy + iy * gridStep, ARENA_RIVET_RADIUS, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
      }

      // Subtle blood stain on some tiles
      const bloodSeed =
        (tx * ARENA_BLOOD_MODULUS + ty * ARENA_BLOOD_Y_MODULUS) & ARENA_BLOOD_SEED_MASK;
      if (bloodSeed % ARENA_BLOOD_TILE_STRIDE === 0) {
        ctx.globalAlpha =
          ARENA_BLOOD_ALPHA_BASE +
          (bloodSeed % ARENA_BLOOD_SEED_MODULUS_7) * ARENA_BLOOD_ALPHA_SCALE;
        ctx.fillStyle = '#6b1a1a';
        ctx.beginPath();
        ctx.ellipse(
          sx +
            ts * GYM_RUBBER_DOT_CENTER_FRACTION +
            ((bloodSeed % ARENA_HASH_X) - ARENA_BLOOD_POSITION_OFFSET),
          sy +
            ts * GYM_RUBBER_DOT_CENTER_FRACTION +
            (((bloodSeed >> ARENA_BLOOD_SHIFT_BITS) % ARENA_HASH_X) - ARENA_BLOOD_POSITION_OFFSET),
          ts *
            (ARENA_BLOOD_MAJOR_BASE +
              (bloodSeed % ARENA_BLOOD_MAJOR_MODULUS) * ARENA_BLOOD_MAJOR_SCALE),
          ts *
            (ARENA_BLOOD_MINOR_BASE +
              (bloodSeed % ARENA_BLOOD_MINOR_MODULUS) * ARENA_BLOOD_MINOR_SCALE),
          (bloodSeed % ARENA_BLOOD_ROTATION_MODULUS) * ARENA_BLOOD_ROTATION_SCALE,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      break;
    }

    // Floor Grate — dark metal grate over dungeon floor
    case FLOOR_GRATE: {
      // Base floor (same as concrete)
      ctx.fillStyle = '#505050';
      ctx.fillRect(sx, sy, ts, ts);
      // Grate bars — horizontal slits
      ctx.fillStyle = '#2a2a2a';
      const barH = Math.max(2, ts * GRATE_BASE_FILL_FRACTION);
      const gap = ts / GRATE_GAP_DIVISIONS;
      for (let i = 1; i < GRATE_GAP_DIVISIONS; i++) {
        ctx.fillRect(
          sx + ts * GRATE_HORIZONTAL_INSET_FRACTION,
          sy + gap * i - barH / 2,
          ts * GRATE_HORIZONTAL_WIDTH_FRACTION,
          barH,
        );
      }
      // Vertical frame bars
      ctx.fillStyle = '#3a3a3a';
      ctx.fillRect(
        sx + ts * GRATE_FRAME_OUTER_FRACTION,
        sy + ts * GRATE_FRAME_OUTER_FRACTION,
        ts * GRATE_FRAME_THICKNESS_FRACTION,
        ts * GRATE_FRAME_HEIGHT_FRACTION,
      );
      ctx.fillRect(
        sx + ts * (1 - GRATE_FRAME_OUTER_FRACTION - GRATE_FRAME_THICKNESS_FRACTION),
        sy + ts * GRATE_FRAME_OUTER_FRACTION,
        ts * GRATE_FRAME_THICKNESS_FRACTION,
        ts * GRATE_FRAME_HEIGHT_FRACTION,
      );
      // Dark centre void below grate
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(
        sx + ts * GRATE_VOID_INSET_FRACTION,
        sy + ts * GRATE_VOID_INSET_FRACTION,
        ts * GRATE_VOID_SIZE_FRACTION,
        ts * GRATE_VOID_SIZE_FRACTION,
      );
      // Metallic rim highlight
      ctx.strokeStyle = '#6a6a6a';
      ctx.lineWidth = 1;
      ctx.strokeRect(
        sx + ts * GRATE_RIM_OUTER_FRACTION,
        sy + ts * GRATE_RIM_OUTER_FRACTION,
        ts * GRATE_RIM_SIZE_FRACTION,
        ts * GRATE_RIM_SIZE_FRACTION,
      );
      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);
      break;
    }

    // Spider Lab floor — UV-mapped spider_room_floor image across the entire room
    case SPIDER_LAB_FLOOR: {
      const def = getSpriteDef('spider_room_floor');
      const bounds = findSpiderLabBounds(structure);
      if (def && bounds) {
        const { img } = def;
        const roomW = bounds.maxX - bounds.minX + 1;
        const roomH = bounds.maxY - bounds.minY + 1;
        const srcX = ((tx - bounds.minX) / roomW) * img.width;
        const srcY = ((ty - bounds.minY) / roomH) * img.height;
        const srcW = img.width / roomW;
        const srcH = img.height / roomH;
        ctx.drawImage(img, srcX, srcY, srcW, srcH, sx, sy, ts, ts);
      } else {
        // Fallback: dark tiled lab floor with subtle webbing
        const base = (tx + ty) % 2 === 0 ? '#1a1610' : '#161208';
        ctx.fillStyle = base;
        ctx.fillRect(sx, sy, ts, ts);
        ctx.strokeStyle = '#0d0a06';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(sx + ts - 1, sy, 1, ts);
        ctx.strokeRect(sx, sy + ts - 1, ts, 1);
        if ((tx * SPIDER_WEB_HASH_X + ty * SPIDER_WEB_HASH_Y) % SPIDER_WEB_STRIDE === 0) {
          ctx.strokeStyle = 'rgba(80,60,20,0.2)';
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(sx + ts * SPIDER_WEB_START_X_FRACTION, sy + ts * SPIDER_WEB_START_Y_FRACTION);
          ctx.lineTo(sx + ts * SPIDER_WEB_END_X_FRACTION, sy + ts * SPIDER_WEB_END_Y_FRACTION);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(
            sx + ts * SPIDER_WEB_ALT_START_X_FRACTION,
            sy + ts * SPIDER_WEB_START_Y_FRACTION,
          );
          ctx.lineTo(sx + ts * SPIDER_WEB_ALT_END_X_FRACTION, sy + ts * SPIDER_WEB_END_Y_FRACTION);
          ctx.stroke();
        }
      }
      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);
      break;
    }

    // Desperado Club floor — dark polished art-deco stone with gold grout
    case CLUB_FLOOR: {
      const clubBase = (tx + ty) % 2 === 0 ? '#1a1420' : '#161019';
      ctx.fillStyle = clubBase;
      ctx.fillRect(sx, sy, ts, ts);
      ctx.fillStyle = 'rgba(198,168,64,0.28)';
      ctx.fillRect(sx + ts - 1, sy, 1, ts);
      ctx.fillRect(sx, sy + ts - 1, ts, 1);
      // Sparse art-deco sunburst inlay
      if (tx % CLUB_SUNBURST_TILE_STRIDE === 0 && ty % CLUB_SUNBURST_TILE_STRIDE === 0) {
        const cx = sx + ts * CLUB_SUNBURST_CENTER_FRACTION;
        const cy = sy + ts * CLUB_SUNBURST_CENTER_FRACTION;
        ctx.strokeStyle = 'rgba(198,168,64,0.22)';
        ctx.lineWidth = 1;
        for (let r = 0; r < CLUB_SUNBURST_RAY_COUNT; r++) {
          const ang = (r / CLUB_SUNBURST_RAY_COUNT) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(
            cx + Math.cos(ang) * ts * CLUB_SUNBURST_RADIUS_FRACTION,
            cy + Math.sin(ang) * ts * CLUB_SUNBURST_RADIUS_FRACTION,
          );
          ctx.stroke();
        }
      }
      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);
      break;
    }

    // Dance floor — dark reflective panels; the pulsing coloured lights are drawn
    // as a per-frame overlay by DesperadoClubSystem (the static tile cache can't animate).
    case DANCE_FLOOR: {
      ctx.fillStyle = '#0b0810';
      ctx.fillRect(sx, sy, ts, ts);
      ctx.fillStyle = (tx + ty) % 2 === 0 ? '#1d1526' : '#150f1e';
      ctx.fillRect(
        sx + ts * DANCE_PANEL_INSET_FRACTION,
        sy + ts * DANCE_PANEL_INSET_FRACTION,
        ts * DANCE_PANEL_SIZE_FRACTION,
        ts * DANCE_PANEL_SIZE_FRACTION,
      );
      break;
    }

    default:
      return false;
  }
  return true;
}
