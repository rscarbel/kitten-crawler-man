import type { TileContent } from '../tileTypes';
import {
  SAFE_ROOM_FLOOR,
  SAFE_ROOM_THRESHOLD,
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
import { drawGroundTile } from './groundTiles';
import { DUNGEON_GROUND } from '../dungeon/groundMaterials';
import { getSpriteDef } from '../../core/SpriteLoader';

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

/** Tiles per steel plate. The seam between plates is the floor's whole character. */
const ARENA_PLATE_TILES = 2;
/** Divisions of the anti-slip crosshatch inside a plate. */
const ARENA_GRID_DIVISIONS = 4;
const ARENA_RIVET_RADIUS = 1.3;
const ARENA_BASE = '#191b21';
/**
 * The two plate tones, exported because the ball's bake gate measures the boss's
 * contrast against the floor it rolls on and the review harness paints it as a
 * backdrop. Both had a copied hex that this file's own rewrite left behind, so the
 * gate was measuring against a colour the game no longer draws.
 */
export const ARENA_PLATE_LIGHT = '#20232b';
export const ARENA_PLATE_DARK = '#14161b';
const ARENA_HATCH = '#23262e';
const ARENA_SEAM = '#0d0e12';
const ARENA_SEAM_LIT = '#2f343e';
const ARENA_RIVET = '#333944';
const ARENA_RIVET_GLINT = '#4b5563';
const ARENA_SEAM_WIDTH = 2;
/** How far in from a tile's own edge a rivet sits, as a fraction of the tile. */
const ARENA_RIVET_INSET = 0.15;
const ARENA_RIVET_GLINT_OFFSET = 0.4;
const ARENA_RIVET_GLINT_RADIUS = 0.45;
const ARENA_HATCH_ALPHA = 0.55;

/**
 * Drain channels, cut on a stride so they read as a grid of gutters running to the
 * middle of the floor rather than as noise.
 *
 * The arena has to look like somewhere blood is expected. A drain is the cheapest
 * possible way to say that, and it gives an otherwise featureless 26-tile disc
 * something for the eye to measure the ball's line against.
 */
const ARENA_DRAIN_STRIDE = 7;
const ARENA_DRAIN_WIDTH_FRACTION = 0.22;
const ARENA_DRAIN_DARK = '#0a0b0e';
const ARENA_DRAIN_GRATE = '#1d2027';
const ARENA_DRAIN_BARS = 3;

/**
 * Coefficients that decorrelate the gouge and blood strides from each other and from
 * the drains. Their own constants rather than a reused geometry number: retuning the
 * plate size should not silently redistribute every stain on the floor.
 */
const ARENA_GOUGE_HASH_SKEW = 2;
const ARENA_BLOOD_HASH_SKEW = 2;

/** Gouges torn in the plate. Sparse, and never on the same tile as a drain. */
const ARENA_GOUGE_STRIDE = 5;
const ARENA_GOUGE_COUNT = 3;
const ARENA_GOUGE_LENGTH_FRACTION = 0.34;
const ARENA_GOUGE_ALPHA = 0.5;
const ARENA_GOUGE_COLOR = '#2b303a';

/** Dried blood, on its own coarser stride so stains and gouges rarely coincide. */
const ARENA_BLOOD_STRIDE = 6;
const ARENA_BLOOD_BLOTS = 4;
const ARENA_BLOOD_ALPHA = 0.3;
const ARENA_BLOOD_COLOR = '#5d1616';
const ARENA_BLOOD_DARK = '#33090c';
const ARENA_BLOOD_MAX_RADIUS_FRACTION = 0.17;

/**
 * A tile's own random stream.
 *
 * Hashed off the tile coordinate rather than seeded once per frame, so a tile paints
 * the same way every time it is drawn — the chunk cache redraws tiles whenever the
 * camera crosses a boundary, and a per-frame stream makes the whole floor crawl.
 */
function arenaTileNoise(tx: number, ty: number, salt: number): () => number {
  // `Math.imul` throughout: the plain multiply overflows 2^53 and quietly drops the
  // low bits, which is where an LCG keeps what little entropy it has.
  let state = Math.imul(tx, 73856093) ^ Math.imul(ty, 19349663) ^ Math.imul(salt, 83492791);
  return () => {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

function drawArenaFloor(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  // Plates alternate tone in a checker of `ARENA_PLATE_TILES`, which is what makes
  // the seams read as the edges of something rather than as a drawn grid.
  const plateX = Math.floor(tx / ARENA_PLATE_TILES);
  const plateY = Math.floor(ty / ARENA_PLATE_TILES);
  ctx.fillStyle = ARENA_BASE;
  ctx.fillRect(sx, sy, ts, ts);
  ctx.fillStyle = (plateX + plateY) % 2 === 0 ? ARENA_PLATE_LIGHT : ARENA_PLATE_DARK;
  ctx.fillRect(sx, sy, ts, ts);

  ctx.save();
  ctx.globalAlpha = ARENA_HATCH_ALPHA;
  ctx.strokeStyle = ARENA_HATCH;
  ctx.lineWidth = 1;
  const gridStep = ts / ARENA_GRID_DIVISIONS;
  for (let i = 1; i < ARENA_GRID_DIVISIONS; i++) {
    const at = Math.round(i * gridStep);
    ctx.beginPath();
    ctx.moveTo(sx + at + 0.5, sy);
    ctx.lineTo(sx + at + 0.5, sy + ts);
    ctx.moveTo(sx, sy + at + 0.5);
    ctx.lineTo(sx + ts, sy + at + 0.5);
    ctx.stroke();
  }
  ctx.restore();

  // Plate seams: a dark groove on the leading edge and a lit lip on the far side,
  // so the plate reads as sitting slightly above its neighbour.
  if (tx % ARENA_PLATE_TILES === 0) {
    ctx.fillStyle = ARENA_SEAM;
    ctx.fillRect(sx, sy, ARENA_SEAM_WIDTH, ts);
    ctx.fillStyle = ARENA_SEAM_LIT;
    ctx.fillRect(sx + ARENA_SEAM_WIDTH, sy, 1, ts);
  }
  if (ty % ARENA_PLATE_TILES === 0) {
    ctx.fillStyle = ARENA_SEAM;
    ctx.fillRect(sx, sy, ts, ARENA_SEAM_WIDTH);
    ctx.fillStyle = ARENA_SEAM_LIT;
    ctx.fillRect(sx, sy + ARENA_SEAM_WIDTH, ts, 1);
  }

  // One rivet per tile, in whichever of its corners is also a corner of the plate —
  // so a plate ends up bolted at its four corners without any tile having to paint
  // outside its own cell, which the chunk cache would clip.
  const rivetX =
    sx + ts * (tx % ARENA_PLATE_TILES === 0 ? ARENA_RIVET_INSET : 1 - ARENA_RIVET_INSET);
  const rivetY =
    sy + ts * (ty % ARENA_PLATE_TILES === 0 ? ARENA_RIVET_INSET : 1 - ARENA_RIVET_INSET);
  ctx.fillStyle = ARENA_RIVET;
  ctx.beginPath();
  ctx.arc(rivetX, rivetY, ARENA_RIVET_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ARENA_RIVET_GLINT;
  ctx.beginPath();
  ctx.arc(
    rivetX - ARENA_RIVET_RADIUS * ARENA_RIVET_GLINT_OFFSET,
    rivetY - ARENA_RIVET_RADIUS * ARENA_RIVET_GLINT_OFFSET,
    ARENA_RIVET_RADIUS * ARENA_RIVET_GLINT_RADIUS,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  const onDrain = tx % ARENA_DRAIN_STRIDE === 0 || ty % ARENA_DRAIN_STRIDE === 0;
  if (onDrain) {
    const width = ts * ARENA_DRAIN_WIDTH_FRACTION;
    const inset = (ts - width) / 2;
    ctx.fillStyle = ARENA_DRAIN_DARK;
    if (tx % ARENA_DRAIN_STRIDE === 0) ctx.fillRect(sx + inset, sy, width, ts);
    if (ty % ARENA_DRAIN_STRIDE === 0) ctx.fillRect(sx, sy + inset, ts, width);
    ctx.fillStyle = ARENA_DRAIN_GRATE;
    for (let bar = 1; bar <= ARENA_DRAIN_BARS; bar++) {
      const along = (ts * bar) / (ARENA_DRAIN_BARS + 1);
      if (tx % ARENA_DRAIN_STRIDE === 0) ctx.fillRect(sx + inset, sy + along, width, 1);
      if (ty % ARENA_DRAIN_STRIDE === 0) ctx.fillRect(sx + along, sy + inset, 1, width);
    }
  } else if ((tx * ARENA_GOUGE_HASH_SKEW + ty) % ARENA_GOUGE_STRIDE === 0) {
    // Tusk gouges. Skipped on drain tiles, where the drain already owns the eye.
    const noise = arenaTileNoise(tx, ty, 1);
    ctx.save();
    ctx.globalAlpha = ARENA_GOUGE_ALPHA;
    ctx.strokeStyle = ARENA_GOUGE_COLOR;
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    const angle = noise() * Math.PI;
    for (let i = 0; i < ARENA_GOUGE_COUNT; i++) {
      const cx = sx + ts * (0.2 + noise() * 0.6);
      const cy = sy + ts * (0.2 + noise() * 0.6);
      const half = (ts * ARENA_GOUGE_LENGTH_FRACTION) / 2;
      ctx.beginPath();
      ctx.moveTo(cx - Math.cos(angle) * half, cy - Math.sin(angle) * half);
      ctx.lineTo(cx + Math.cos(angle) * half, cy + Math.sin(angle) * half);
      ctx.stroke();
    }
    ctx.restore();
  }

  if ((tx + ty * ARENA_BLOOD_HASH_SKEW) % ARENA_BLOOD_STRIDE === 0) {
    const noise = arenaTileNoise(tx, ty, 2);
    ctx.save();
    ctx.globalAlpha = ARENA_BLOOD_ALPHA;
    for (let i = 0; i < ARENA_BLOOD_BLOTS; i++) {
      const cx = sx + ts * (0.15 + noise() * 0.7);
      const cy = sy + ts * (0.15 + noise() * 0.7);
      const r = ts * ARENA_BLOOD_MAX_RADIUS_FRACTION * (0.3 + noise() * 0.7);
      ctx.fillStyle = i % 2 === 0 ? ARENA_BLOOD_COLOR : ARENA_BLOOD_DARK;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * (0.5 + noise() * 0.5), noise() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
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
    // Safe-room floor and the scuffed traffic band inside its doorways, both
    // resolved through the generated `ground_dungeon` sheet. No `drawWallShadow`
    // here: the ground renderer's own occlusion pass shades the wall contact, and
    // running both stacked two bands of shade against every north wall.
    case SAFE_ROOM_FLOOR:
    case SAFE_ROOM_THRESHOLD: {
      drawGroundTile(ctx, DUNGEON_GROUND, structure, sx, sy, ts, tx, ty);
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

    // Arena floor — riveted steel plate, drained toward the middle, and filthy.
    //
    // The one large floor region in the game that is not a generated ground
    // material, because it is a *plated* surface rather than a granular one:
    // seamless tiling has nothing to add to a floor whose whole character is the
    // seam every two tiles, and its transitions are all against its own wall.
    case ARENA_FLOOR: {
      drawArenaFloor(ctx, sx, sy, ts, tx, ty);
      drawWallShadow(ctx, structure, sx, sy, ts, tx, ty);
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
