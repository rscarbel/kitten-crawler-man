import type { TileContent } from '../../tileTypes';
import { GYM_RACK, GYM_SQUAT_RACK, GYM_CABLE_STACK, GYM_TREADMILL_BELT } from '../../tileTypes';
import { drawGymBeltTile } from '../../../sprites/art/gymRoomArt';
import {
  drawGymCableStackSprite,
  drawGymRackSprite,
  drawGymSquatRackSprite,
} from '../../../sprites/gymRoomSprites';
import { gymLayoutOf, type GymLayout, type GymWallRun } from './gymLayout';
import { gymRackFill, gymSquatRackLoaded } from './gymPropState';

/**
 * Paints the boss-room tile types of the Juicer's gym. Returns false for any other type.
 *
 * A solid prop is Y-sorted: the chunk bake has already drawn the floor beneath
 * it, so its case blits only the prop, from the gym's painted sheets. The belt
 * is a flat decal baked into the chunk with its floor, idle; the room system
 * draws it running on top while the treadmill is powered.
 */
export function drawGymTile(
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
    case GYM_RACK:
      drawGymRackSprite(ctx, sx, sy, ts, gymRackFill(tx, ty));
      return true;
    case GYM_SQUAT_RACK:
      drawGymSquatRackSprite(ctx, sx, sy, ts, gymSquatRackLoaded(tx, ty));
      return true;
    case GYM_CABLE_STACK:
      drawGymCableStackSprite(ctx, sx, sy, ts);
      return true;
    case GYM_TREADMILL_BELT:
      drawGymBeltDecal(ctx, structure, sx, sy, ts, tx, ty);
      return true;
    default:
      return false;
  }
}

const HALF = 0.5;
const QUARTER_TURN = Math.PI / 2;

/** A small integer hash of a tile and a salt, for stable per-tile variation. */
function tileHash(tx: number, ty: number, salt: number): number {
  let h = (tx * HASH_X + ty * HASH_Y + salt * HASH_SALT) | 0;
  h = Math.imul(h ^ (h >>> HASH_SHIFT_A), HASH_MIX_A);
  h = Math.imul(h ^ (h >>> HASH_SHIFT_B), HASH_MIX_B);
  return (h ^ (h >>> HASH_SHIFT_A)) >>> 0;
}
const HASH_X = 374761393;
const HASH_Y = 668265263;
const HASH_SALT = 2246822519;
const HASH_SHIFT_A = 15;
const HASH_SHIFT_B = 13;
const HASH_MIX_A = 0x85ebca6b;
const HASH_MIX_B = 0xc2b2ae35;
const HASH_RANGE = 0x100000000;

/** A stable float in [0, 1) for a tile and salt. */
function tileRandom(tx: number, ty: number, salt: number): number {
  return tileHash(tx, ty, salt) / HASH_RANGE;
}

const inRect = (
  tx: number,
  ty: number,
  rect: { x: number; y: number; w: number; h: number },
): boolean => tx >= rect.x && ty >= rect.y && tx < rect.x + rect.w && ty < rect.y + rect.h;

// ── Floor ────────────────────────────────────────────────────────────────────

const MAT_BASE = '#141518';
const MAT_BEVEL_LIGHT = 'rgba(255,255,255,0.05)';
const MAT_SEAM = '#07080a';
const MAT_FLECKS = ['#2b2e33', '#34383e', '#23262a', '#3a2a2a', '#26303a'];
const MAT_FLECKS_PER_TILE = 14;
const MAT_FLECK_PX = 1;
const MAT_SCUFF = 'rgba(255,255,255,0.035)';
const SWEAT_STAIN = 'rgba(0,0,0,0.28)';
const SWEAT_STAIN_CHANCE = 0.12;
const SCUFF_CHANCE = 0.3;
const SCUFF_LENGTH_SHARE = 0.5;
const SCUFF_THICKNESS_PX = 1;
const STAIN_RADIUS_SHARE = 0.28;
const STAIN_SQUASH = 0.6;

const WOOD_BASE = ['#8c5a2b', '#99652f', '#7f5025', '#94602d'];
const WOOD_SEAM = 'rgba(40,20,5,0.75)';
const WOOD_GRAIN = 'rgba(60,32,10,0.35)';
const WOOD_SHEEN = 'rgba(255,220,160,0.12)';
const WOOD_PLANKS_PER_TILE = 4;
const WOOD_GRAIN_LINES = 2;
const PLATFORM_EDGE = '#f07a12';
const PLATFORM_EDGE_PX = 2;
const PLATFORM_BOLT = '#c9c2b4';
const PLATFORM_BOLT_PX = 2;
const PLATFORM_BOLT_INSET_PX = 3;
const CHALK_DUST = 'rgba(240,240,232,0.22)';
const CHALK_SPECK = 'rgba(245,245,240,0.55)';
const PLATFORM_CHALK_SPECKS = 10;
const CHALK_SPECKS_NEAR_RACK = 6;

const TURF_BASE = '#2c6a2c';
const TURF_BLADES = ['#3d8a36', '#235a24', '#4a9a3e', '#1f4e20'];
const TURF_BLADES_PER_TILE = 34;
const TURF_BLADE_LENGTH_PX = 3;
const TURF_YARD_LINE = 'rgba(245,245,240,0.85)';
const TURF_YARD_LINE_PX = 2;
const TURF_YARD_LINE_STRIDE = 2;
const TURF_EDGE = '#f0b012';
const TURF_EDGE_PX = 2;
const TURF_WEAR = 'rgba(120,110,70,0.18)';
/** Scuffed turf is twice as common as sweat on the mats: the lane takes every sprint. */
const TURF_WEAR_CHANCE = SWEAT_STAIN_CHANCE * 2;
const TURF_WEAR_STRIPE_PX = 2;

/** Paints one tile of the gym floor: rubber mat, lifting platform or turf lane. */
export function drawGymFloorTile(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const layout = gymLayoutOf(structure);
  if (layout !== null && inRect(tx, ty, layout.platform)) {
    drawPlatformTile(ctx, layout, sx, sy, ts, tx, ty);
  } else if (layout?.turf.some((t) => t.x === tx && t.y === ty) === true) {
    drawTurfTile(ctx, layout, sx, sy, ts, tx, ty);
  } else {
    drawMatTile(ctx, sx, sy, ts, tx, ty);
    if (layout !== null && isBesideAny(tx, ty, layout.racks, layout.squatRacks)) {
      drawChalkSpecks(ctx, sx, sy, ts, tx, ty, CHALK_SPECKS_NEAR_RACK);
    }
  }
  drawLightPool(ctx, sx, sy, ts, tx, ty);
}

/** Overhead fluorescents on a fixed grid, each throwing a cold pool on the floor. */
const LIGHT_SPACING_TILES = 6;
const LIGHT_OFFSET_TILES = 3;
const LIGHT_POOL_RADIUS_TILES = 4.2;
const LIGHT_POOL_CORE = 'rgba(205,225,255,0.11)';
const LIGHT_POOL_EDGE = 'rgba(205,225,255,0)';

/**
 * The nearest light's pool, clipped to this tile. The gym is over-lit on
 * purpose: a flat black mat reads as a void, a lit one as a floor.
 */
function drawLightPool(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  // Every light whose pool reaches this tile, summed, so pools blend where they
  // overlap instead of meeting at a hard seam.
  const firstLightX = Math.floor((tx - LIGHT_OFFSET_TILES) / LIGHT_SPACING_TILES);
  const firstLightY = Math.floor((ty - LIGHT_OFFSET_TILES) / LIGHT_SPACING_TILES);
  const radius = ts * LIGHT_POOL_RADIUS_TILES;
  for (let gridY = firstLightY; gridY <= firstLightY + 1; gridY++) {
    for (let gridX = firstLightX; gridX <= firstLightX + 1; gridX++) {
      const lightX = gridX * LIGHT_SPACING_TILES + LIGHT_OFFSET_TILES;
      const lightY = gridY * LIGHT_SPACING_TILES + LIGHT_OFFSET_TILES;
      const cx = sx + (lightX + HALF - tx) * ts;
      const cy = sy + (lightY + HALF - ty) * ts;
      const pool = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      pool.addColorStop(0, LIGHT_POOL_CORE);
      pool.addColorStop(1, LIGHT_POOL_EDGE);
      ctx.fillStyle = pool;
      ctx.fillRect(sx, sy, ts, ts);
    }
  }
}

function isBesideAny(
  tx: number,
  ty: number,
  ...groups: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>
): boolean {
  return groups.some((group) =>
    group.some((t) => Math.abs(t.x - tx) <= 1 && Math.abs(t.y - ty) <= 1),
  );
}

function drawMatTile(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  ctx.fillStyle = MAT_BASE;
  ctx.fillRect(sx, sy, ts, ts);
  for (let fleck = 0; fleck < MAT_FLECKS_PER_TILE; fleck++) {
    const fx = Math.floor(tileRandom(tx, ty, fleck * 2) * ts);
    const fy = Math.floor(tileRandom(tx, ty, fleck * 2 + 1) * ts);
    ctx.fillStyle = MAT_FLECKS[tileHash(tx, ty, fleck + MAT_FLECKS_PER_TILE) % MAT_FLECKS.length];
    ctx.fillRect(sx + fx, sy + fy, MAT_FLECK_PX, MAT_FLECK_PX);
  }
  if (tileRandom(tx, ty, SALT_STAIN) < SWEAT_STAIN_CHANCE) {
    ctx.fillStyle = SWEAT_STAIN;
    ctx.beginPath();
    ctx.ellipse(
      sx + ts * tileRandom(tx, ty, SALT_STAIN + 1),
      sy + ts * tileRandom(tx, ty, SALT_STAIN + 2),
      ts * STAIN_RADIUS_SHARE,
      ts * STAIN_RADIUS_SHARE * STAIN_SQUASH,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  if (tileRandom(tx, ty, SALT_SCUFF) < SCUFF_CHANCE) {
    ctx.fillStyle = MAT_SCUFF;
    const length = ts * SCUFF_LENGTH_SHARE;
    ctx.fillRect(
      sx + (ts - length) * tileRandom(tx, ty, SALT_SCUFF + 1),
      sy + ts * tileRandom(tx, ty, SALT_SCUFF + 2),
      length,
      SCUFF_THICKNESS_PX,
    );
  }
  // Interlocking mat squares: a dark seam on two sides, a lit bevel on the others.
  ctx.fillStyle = MAT_SEAM;
  ctx.fillRect(sx + ts - 1, sy, 1, ts);
  ctx.fillRect(sx, sy + ts - 1, ts, 1);
  ctx.fillStyle = MAT_BEVEL_LIGHT;
  ctx.fillRect(sx, sy, ts - 1, 1);
  ctx.fillRect(sx, sy, 1, ts - 1);
}
const SALT_STAIN = 101;
const SALT_SCUFF = 131;
const SALT_CHALK = 161;
const SALT_WOOD = 191;
const SALT_TURF = 221;

function drawChalkSpecks(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
  count: number,
): void {
  ctx.fillStyle = CHALK_SPECK;
  for (let speck = 0; speck < count; speck++) {
    const px = Math.floor(tileRandom(tx, ty, SALT_CHALK + speck * 2) * ts);
    const py = Math.floor(tileRandom(tx, ty, SALT_CHALK + speck * 2 + 1) * ts);
    ctx.fillRect(sx + px, sy + py, 1, 1);
  }
}

function drawPlatformTile(
  ctx: CanvasRenderingContext2D,
  layout: GymLayout,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const { platform } = layout;
  const plankHeight = ts / WOOD_PLANKS_PER_TILE;
  for (let plank = 0; plank < WOOD_PLANKS_PER_TILE; plank++) {
    const py = sy + plank * plankHeight;
    const plankRow = (ty - platform.y) * WOOD_PLANKS_PER_TILE + plank;
    ctx.fillStyle = WOOD_BASE[tileHash(plankRow, tx, SALT_WOOD) % WOOD_BASE.length];
    ctx.fillRect(sx, py, ts, plankHeight);
    ctx.fillStyle = WOOD_GRAIN;
    for (let line = 0; line < WOOD_GRAIN_LINES; line++) {
      const gy =
        py + 1 + Math.floor(tileRandom(plankRow, tx, SALT_WOOD + line + 1) * (plankHeight - 2));
      const gx = Math.floor(
        tileRandom(plankRow, tx, SALT_WOOD + line + WOOD_GRAIN_LINES) * ts * HALF,
      );
      ctx.fillRect(sx + gx, gy, ts * HALF, 1);
    }
    ctx.fillStyle = WOOD_SEAM;
    ctx.fillRect(sx, py + plankHeight - 1, ts, 1);
    // Butt joints staggered plank to plank so the boards read as long runs.
    if ((plankRow + tx) % PLANK_JOINT_STRIDE === 0) ctx.fillRect(sx, py, 1, plankHeight);
  }
  ctx.fillStyle = WOOD_SHEEN;
  ctx.fillRect(sx, sy, ts, 1);
  // One wide chalk bloom over the middle of the platform, each tile painting
  // its own slice so the bloom crosses the plank seams whole.
  ctx.save();
  ctx.beginPath();
  ctx.rect(sx, sy, ts, ts);
  ctx.clip();
  ctx.fillStyle = CHALK_DUST;
  ctx.beginPath();
  ctx.ellipse(
    sx + (platform.x + platform.w * HALF - tx) * ts,
    sy + (platform.y + platform.h * HALF - ty) * ts,
    ts * CHALK_BLOOM_RX_TILES,
    ts * CHALK_BLOOM_RY_TILES,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();
  drawChalkSpecks(ctx, sx, sy, ts, tx, ty, PLATFORM_CHALK_SPECKS);

  ctx.fillStyle = PLATFORM_EDGE;
  if (tx === platform.x) ctx.fillRect(sx, sy, PLATFORM_EDGE_PX, ts);
  if (tx === platform.x + platform.w - 1)
    ctx.fillRect(sx + ts - PLATFORM_EDGE_PX, sy, PLATFORM_EDGE_PX, ts);
  if (ty === platform.y) ctx.fillRect(sx, sy, ts, PLATFORM_EDGE_PX);
  if (ty === platform.y + platform.h - 1)
    ctx.fillRect(sx, sy + ts - PLATFORM_EDGE_PX, ts, PLATFORM_EDGE_PX);
  const cornerX = tx === platform.x || tx === platform.x + platform.w - 1;
  const cornerY = ty === platform.y || ty === platform.y + platform.h - 1;
  if (cornerX && cornerY) {
    ctx.fillStyle = PLATFORM_BOLT;
    const bx =
      tx === platform.x
        ? sx + PLATFORM_BOLT_INSET_PX
        : sx + ts - PLATFORM_BOLT_INSET_PX - PLATFORM_BOLT_PX;
    const by =
      ty === platform.y
        ? sy + PLATFORM_BOLT_INSET_PX
        : sy + ts - PLATFORM_BOLT_INSET_PX - PLATFORM_BOLT_PX;
    ctx.fillRect(bx, by, PLATFORM_BOLT_PX, PLATFORM_BOLT_PX);
  }
}
const PLANK_JOINT_STRIDE = 3;
const CHALK_BLOOM_RX_TILES = 1.3;
const CHALK_BLOOM_RY_TILES = 0.9;

function drawTurfTile(
  ctx: CanvasRenderingContext2D,
  layout: GymLayout,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  ctx.fillStyle = TURF_BASE;
  ctx.fillRect(sx, sy, ts, ts);
  for (let blade = 0; blade < TURF_BLADES_PER_TILE; blade++) {
    const bx = Math.floor(tileRandom(tx, ty, SALT_TURF + blade * 2) * ts);
    const by = Math.floor(
      tileRandom(tx, ty, SALT_TURF + blade * 2 + 1) * (ts - TURF_BLADE_LENGTH_PX),
    );
    ctx.fillStyle = TURF_BLADES[tileHash(tx, ty, blade) % TURF_BLADES.length];
    ctx.fillRect(sx + bx, sy + by, 1, TURF_BLADE_LENGTH_PX);
  }
  if (tileRandom(tx, ty, SALT_TURF) < TURF_WEAR_CHANCE) {
    const stripeTop = sy + ts * HALF - TURF_WEAR_STRIPE_PX * HALF;
    ctx.fillStyle = TURF_WEAR;
    ctx.fillRect(sx, stripeTop, ts, TURF_WEAR_STRIPE_PX);
  }
  // Yard lines cross the lane every other tile along it.
  ctx.fillStyle = TURF_YARD_LINE;
  if (layout.turfLinesAlongX) {
    if (ty % TURF_YARD_LINE_STRIDE === 0) ctx.fillRect(sx, sy, ts, TURF_YARD_LINE_PX);
  } else if (tx % TURF_YARD_LINE_STRIDE === 0) {
    ctx.fillRect(sx, sy, TURF_YARD_LINE_PX, ts);
  }
  // A safety edge on the lane's room side, which lies back toward the doorway.
  const roomwardX = tx - layout.inward.dx;
  const roomwardY = ty - layout.inward.dy;
  const edgeTile = !layout.turf.some((t) => t.x === roomwardX && t.y === roomwardY);
  if (edgeTile) {
    ctx.fillStyle = TURF_EDGE;
    if (layout.inward.dy < 0) ctx.fillRect(sx, sy + ts - TURF_EDGE_PX, ts, TURF_EDGE_PX);
    if (layout.inward.dy > 0) ctx.fillRect(sx, sy, ts, TURF_EDGE_PX);
    if (layout.inward.dx < 0) ctx.fillRect(sx + ts - TURF_EDGE_PX, sy, TURF_EDGE_PX, ts);
    if (layout.inward.dx > 0) ctx.fillRect(sx, sy, TURF_EDGE_PX, ts);
  }
}

/** The belt at rest: its floor, then the belt turned to run the way it pushes. */
function drawGymBeltDecal(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  drawMatTile(ctx, sx, sy, ts, tx, ty);
  const layout = gymLayoutOf(structure);
  const push = layout?.treadmills[0]?.push ?? { dx: 0, dy: 1 };
  const rotation =
    push.dy > 0 ? 0 : push.dy < 0 ? Math.PI : push.dx > 0 ? -QUARTER_TURN : QUARTER_TURN;
  ctx.save();
  ctx.translate(sx + ts * HALF, sy + ts * HALF);
  ctx.rotate(rotation);
  drawGymBeltTile(ctx, -ts * HALF, -ts * HALF, ts, 0, false);
  ctx.restore();
}

// ── Walls: mirror and whiteboard ─────────────────────────────────────────────

const MIRROR_GLASS_TOP = '#a9bccb';
const MIRROR_GLASS_BOTTOM = '#56697a';
const MIRROR_SHEEN = 'rgba(255,255,255,0.28)';
const MIRROR_SHEEN_FAINT = 'rgba(255,255,255,0.1)';
const MIRROR_FRAME = '#2a2f36';
const MIRROR_FRAME_LIGHT = '#c8d0d8';
const MIRROR_FRAME_PX = 2;
/** Glass inset from the wall tile's outer edge: the frame's own depth. */
const MIRROR_BACK_INSET_PX = 6;
/** World pixels between sheen streaks, so the streaks run on unbroken across tile seams. */
const MIRROR_SHEEN_PERIOD_PX = 70;
const MIRROR_SHEEN_WIDTH_PX = 9;
const MIRROR_SHEEN_FAINT_WIDTH_PX = 4;
const MIRROR_SHEEN_FAINT_OFFSET_PX = 14;
const MIRROR_SEAM = 'rgba(20,30,40,0.5)';
const MIRROR_PANEL_TILES = 3;
const HANDPRINT_CHANCE = 0.3;
const HANDPRINT = 'rgba(250,250,245,0.55)';
const HANDPRINT_PALM_RX = 3;
const HANDPRINT_PALM_RY = 3.5;
const HANDPRINT_FINGER_PX = 1.5;
const HANDPRINT_FINGER_SPREAD_PX = 2;
const HANDPRINT_FINGER_REACH_PX = 5;
const HANDPRINT_FINGERS = 4;

/**
 * Dresses a wall tile of the gym: the mirror along the wall opposite the
 * doorway, the whiteboard on another. Called by the wall painter after the
 * masonry; does nothing for any wall outside the gym.
 */
export function drawGymWallDressing(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const layout = gymLayoutOf(structure);
  if (layout === null) return;
  const mirrorIndex = indexInRun(layout.mirror, tx, ty);
  if (mirrorIndex >= 0) drawMirrorTile(ctx, layout, sx, sy, ts, tx, ty, mirrorIndex);
  const board = layout.whiteboard;
  if (board !== null) {
    const boardIndex = indexInRun(board, tx, ty);
    if (boardIndex >= 0) drawWhiteboardSlice(ctx, sx, sy, ts, boardIndex, board.tiles.length);
  }
}

function indexInRun(run: GymWallRun, tx: number, ty: number): number {
  return run.tiles.findIndex((t) => t.x === tx && t.y === ty);
}

function drawMirrorTile(
  ctx: CanvasRenderingContext2D,
  layout: GymLayout,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
  index: number,
): void {
  // The mirror wall is opposite the doorway, so the room lies back toward the
  // door; the glass hangs on that face and the frame's depth is behind it.
  const roomSide = { dx: -layout.inward.dx, dy: -layout.inward.dy };
  let gx = sx;
  let gy = sy;
  let gw = ts;
  let gh = ts;
  if (roomSide.dy > 0) {
    gy = sy + MIRROR_BACK_INSET_PX;
    gh = ts - MIRROR_BACK_INSET_PX;
  } else if (roomSide.dy < 0) {
    gh = ts - MIRROR_BACK_INSET_PX;
  } else if (roomSide.dx > 0) {
    gx = sx + MIRROR_BACK_INSET_PX;
    gw = ts - MIRROR_BACK_INSET_PX;
  } else {
    gw = ts - MIRROR_BACK_INSET_PX;
  }
  const glass = ctx.createLinearGradient(gx, gy, gx + gw, gy + gh);
  glass.addColorStop(0, MIRROR_GLASS_TOP);
  glass.addColorStop(1, MIRROR_GLASS_BOTTOM);
  ctx.fillStyle = MIRROR_FRAME;
  ctx.fillRect(gx, gy, gw, gh);
  ctx.fillStyle = glass;
  ctx.fillRect(
    gx + MIRROR_FRAME_PX,
    gy + MIRROR_FRAME_PX,
    gw - MIRROR_FRAME_PX * 2,
    gh - MIRROR_FRAME_PX * 2,
  );

  ctx.save();
  ctx.beginPath();
  ctx.rect(
    gx + MIRROR_FRAME_PX,
    gy + MIRROR_FRAME_PX,
    gw - MIRROR_FRAME_PX * 2,
    gh - MIRROR_FRAME_PX * 2,
  );
  ctx.clip();
  // Diagonal streaks placed in world space, so they cross panel seams unbroken.
  const worldX = tx * ts;
  const worldY = ty * ts;
  const phase = (worldX + worldY) % MIRROR_SHEEN_PERIOD_PX;
  for (
    let start = -phase - MIRROR_SHEEN_PERIOD_PX;
    start < ts * 2;
    start += MIRROR_SHEEN_PERIOD_PX
  ) {
    for (const [ink, width, offset] of [
      [MIRROR_SHEEN, MIRROR_SHEEN_WIDTH_PX, 0],
      [MIRROR_SHEEN_FAINT, MIRROR_SHEEN_FAINT_WIDTH_PX, MIRROR_SHEEN_FAINT_OFFSET_PX],
    ] as const) {
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.moveTo(sx + start + offset, sy + ts);
      ctx.lineTo(sx + start + offset + width, sy + ts);
      ctx.lineTo(sx + start + offset + width + ts, sy);
      ctx.lineTo(sx + start + offset + ts, sy);
      ctx.closePath();
      ctx.fill();
    }
  }
  if (tileRandom(tx, ty, SALT_STAIN) < HANDPRINT_CHANCE) {
    const hx =
      gx + gw * (HANDPRINT_MIN_SHARE + tileRandom(tx, ty, SALT_STAIN + 1) * HANDPRINT_SPAN_SHARE);
    const hy =
      gy + gh * (HANDPRINT_MIN_SHARE + tileRandom(tx, ty, SALT_STAIN + 2) * HANDPRINT_SPAN_SHARE);
    ctx.fillStyle = HANDPRINT;
    ctx.beginPath();
    ctx.ellipse(hx, hy, HANDPRINT_PALM_RX, HANDPRINT_PALM_RY, 0, 0, Math.PI * 2);
    ctx.fill();
    for (let finger = 0; finger < HANDPRINT_FINGERS; finger++) {
      const fx = hx + (finger - (HANDPRINT_FINGERS - 1) * HALF) * HANDPRINT_FINGER_SPREAD_PX;
      ctx.beginPath();
      ctx.arc(fx, hy - HANDPRINT_FINGER_REACH_PX, HANDPRINT_FINGER_PX, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  // Panel seams every few tiles and a lit top edge on the frame.
  if (index % MIRROR_PANEL_TILES === 0) {
    ctx.fillStyle = MIRROR_SEAM;
    if (layout.mirror.alongY) ctx.fillRect(gx, sy, gw, 1);
    else ctx.fillRect(sx, gy, 1, gh);
  }
  ctx.fillStyle = MIRROR_FRAME_LIGHT;
  if (layout.mirror.alongY) ctx.fillRect(gx, sy, 1, ts);
  else ctx.fillRect(sx, gy, ts, 1);
}
const HANDPRINT_MIN_SHARE = 0.25;
const HANDPRINT_SPAN_SHARE = 0.5;

const BOARD_FACE = '#eef1ef';
const BOARD_SMUDGE = 'rgba(120,140,150,0.18)';
const BOARD_FRAME = '#9aa3ab';
const BOARD_FRAME_PX = 2;
const BOARD_INSET_Y_PX = 4;
const BOARD_INK = '#1c2a6b';
const BOARD_RED = '#d42a2a';
const BOARD_FONT_PX = 8;
const BOARD_SCRAWL_FONT_PX = 9;
const BOARD_LINE_ONE_Y_SHARE = 0.4;
const BOARD_LINE_TWO_Y_SHARE = 0.8;
const BOARD_STRIKE_PX = 1.5;
const BOARD_SCRAWL_TILT = -0.18;
const BOARD_SCRAWL_X_SHARE = 0.72;
const BOARD_SCRAWL_Y_SHARE = 0.42;
const BOARD_TEXT_X_PX = 5;
const BOARD_STRIKE_Y_OFFSET_PX = 3;
const BOARD_SMUDGE_X_SHARE = 0.55;
const BOARD_SMUDGE_RX_SHARE = 0.25;
const BOARD_SMUDGE_RY_PX = 4;
const LINE_ONE = 'NEVER SKIP';
const LINE_TWO = 'LEG DAY';
const SCRAWL = 'ARMS!!';

/**
 * One tile's slice of the whiteboard. The whole board is painted offset by the
 * slice's position and clipped to its tile, so the lettering runs across tiles.
 */
function drawWhiteboardSlice(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  index: number,
  length: number,
): void {
  const boardX = sx - index * ts;
  const boardW = length * ts;
  const boardY = sy + BOARD_INSET_Y_PX;
  const boardH = ts - BOARD_INSET_Y_PX * 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(sx, sy, ts, ts);
  ctx.clip();
  ctx.fillStyle = BOARD_FRAME;
  ctx.fillRect(boardX, boardY, boardW, boardH);
  ctx.fillStyle = BOARD_FACE;
  ctx.fillRect(
    boardX + BOARD_FRAME_PX,
    boardY + BOARD_FRAME_PX,
    boardW - BOARD_FRAME_PX * 2,
    boardH - BOARD_FRAME_PX * 2,
  );
  ctx.fillStyle = BOARD_SMUDGE;
  ctx.beginPath();
  ctx.ellipse(
    boardX + boardW * BOARD_SMUDGE_X_SHARE,
    boardY + boardH * HALF,
    boardW * BOARD_SMUDGE_RX_SHARE,
    BOARD_SMUDGE_RY_PX,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = `bold ${BOARD_FONT_PX}px sans-serif`;
  ctx.fillStyle = BOARD_INK;
  const textX = boardX + BOARD_TEXT_X_PX;
  ctx.fillText(LINE_ONE, textX, boardY + boardH * BOARD_LINE_ONE_Y_SHARE);
  const lineTwoY = boardY + boardH * BOARD_LINE_TWO_Y_SHARE;
  ctx.fillText(LINE_TWO, textX, lineTwoY);
  const struckWidth = ctx.measureText(LINE_TWO).width;
  ctx.strokeStyle = BOARD_RED;
  ctx.lineWidth = BOARD_STRIKE_PX;
  ctx.beginPath();
  ctx.moveTo(textX - 1, lineTwoY - BOARD_STRIKE_Y_OFFSET_PX);
  ctx.lineTo(textX + struckWidth + 1, lineTwoY - BOARD_STRIKE_Y_OFFSET_PX);
  ctx.stroke();

  ctx.translate(boardX + boardW * BOARD_SCRAWL_X_SHARE, boardY + boardH * BOARD_SCRAWL_Y_SHARE);
  ctx.rotate(BOARD_SCRAWL_TILT);
  ctx.font = `bold italic ${BOARD_SCRAWL_FONT_PX}px sans-serif`;
  ctx.fillStyle = BOARD_RED;
  ctx.fillText(SCRAWL, 0, 0);
  ctx.restore();
}
