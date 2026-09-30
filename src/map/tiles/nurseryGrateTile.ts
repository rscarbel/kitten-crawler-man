/**
 * The goblin nursery's floor grates: an iron grille over a shaft into the dark,
 * set in a worn stone collar and ringed by the grime of whatever keeps coming
 * up through it.
 *
 * Baked into the floor chunk like any other floor tile, so it is fully static;
 * the things that move in the dark under it are drawn by the quest at runtime.
 * Everything is a fraction of `ts` so the chunk can bake it at any resolution,
 * and light comes from the upper left like every other prop in the dungeon.
 */

import { mulberry32, range, type Rng } from '../../sprites/person/rng';
import { positionHash } from '../tileTypes';

const HALF = 0.5;
const FULL_TURN = Math.PI * 2;

// ── Grime halo ──────────────────────────────────────────────────────────────
/** Reaches just short of the tile edge so the stain never shows a square seam against the next tile. */
const GRIME_RADIUS = 0.5;
const GRIME_INNER = 'rgba(24,20,12,0.6)';
const GRIME_MID = 'rgba(34,30,18,0.38)';
const GRIME_MID_STOP = 0.72;
const GRIME_OUTER = 'rgba(40,34,20,0)';
const GRIME_BLOTCH_COUNT = 5;
const GRIME_BLOTCH_MIN_RADIUS = 0.04;
const GRIME_BLOTCH_MAX_RADIUS = 0.09;
const GRIME_BLOTCH_REACH = 0.42;
const GRIME_BLOTCH_COLOR = 'rgba(30,36,18,0.35)';

// ── Stone collar ────────────────────────────────────────────────────────────
const COLLAR_INSET = 0.08;
const COLLAR_FILL = '#5a544b';
const COLLAR_LIGHT = 'rgba(214,202,180,0.55)';
const COLLAR_DARK = 'rgba(20,16,12,0.6)';
const COLLAR_BEVEL = 0.03;
const COLLAR_CHIP_COUNT = 4;
const COLLAR_CHIP_SIZE = 0.05;
const COLLAR_CHIP_COLOR = 'rgba(30,26,20,0.55)';

// ── Shaft ───────────────────────────────────────────────────────────────────
const SHAFT_INSET = 0.2;
const SHAFT_TOP = '#17130f';
const SHAFT_BOTTOM = '#040303';
/** How far down the inner walls stay visible before the dark swallows them. */
const SHAFT_WALL_DEPTH = 0.16;
/** The lit inner walls face the light, so they are the south and east ones. */
const SHAFT_LIT_WALL = 'rgba(128,112,90,0.5)';
const SHAFT_SHADED_WALL = 'rgba(0,0,0,0.55)';
const SHAFT_GLINT_COLOR = 'rgba(120,170,160,0.28)';
const SHAFT_GLINT_WIDTH = 0.16;
const SHAFT_GLINT_HEIGHT = 0.04;
const SHAFT_GLINT_Y = 0.64;

// ── Iron grille ─────────────────────────────────────────────────────────────
const FRAME_INSET = 0.17;
const FRAME_WIDTH = 0.07;
const IRON_EDGE = '#15171a';
const IRON_DARK = '#2c3036';
const IRON_MID = '#434a52';
const IRON_LIGHT = '#6d7682';
const IRON_OUTLINE_WIDTH = 0.02;
const BAR_WIDTH = 0.055;
const BAR_SHADOW_OFFSET = 0.03;
const BAR_SHADOW = 'rgba(0,0,0,0.6)';
/** Three bars down, two across: a lattice that reads as a grate, not a vent. */
const VERTICAL_BAR_COUNT = 3;
const HORIZONTAL_BAR_COUNT = 2;
const RIVET_RADIUS = 0.028;
const RIVET_LIGHT = '#9aa4b0';

// ── Rust ────────────────────────────────────────────────────────────────────
const RUST_SPOT_COUNT = 3;
const RUST_SPOT_MIN_RADIUS = 0.012;
const RUST_SPOT_MAX_RADIUS = 0.024;
const RUST_COLOR = 'rgba(132,70,32,0.5)';
const RUST_STREAK_COLOR = 'rgba(122,62,26,0.35)';
const RUST_STREAK_LENGTH = 0.08;
const RUST_STREAK_WIDTH = 0.025;

/**
 * Paints one nursery grate over whatever floor is already under it.
 *
 * The caller paints the floor first, so the stone collar sits on the same
 * material as the rest of the room.
 */
export function drawNurseryGrateTile(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const rng = mulberry32(positionHash(tx, ty));
  ctx.save();
  drawGrimeHalo(ctx, sx, sy, ts, rng);
  drawCollar(ctx, sx, sy, ts, rng);
  drawShaft(ctx, sx, sy, ts);
  drawGrille(ctx, sx, sy, ts);
  drawRust(ctx, sx, sy, ts, rng);
  ctx.restore();
}

function drawGrimeHalo(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  rng: Rng,
): void {
  const cx = sx + ts * HALF;
  const cy = sy + ts * HALF;
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, ts * GRIME_RADIUS);
  halo.addColorStop(0, GRIME_INNER);
  halo.addColorStop(GRIME_MID_STOP, GRIME_MID);
  halo.addColorStop(1, GRIME_OUTER);
  ctx.fillStyle = halo;
  ctx.fillRect(sx, sy, ts, ts);

  ctx.fillStyle = GRIME_BLOTCH_COLOR;
  for (let blotch = 0; blotch < GRIME_BLOTCH_COUNT; blotch++) {
    const angle = rng() * FULL_TURN;
    const reach = ts * GRIME_BLOTCH_REACH * range(rng, HALF, 1);
    const radius = ts * range(rng, GRIME_BLOTCH_MIN_RADIUS, GRIME_BLOTCH_MAX_RADIUS);
    ctx.beginPath();
    ctx.arc(cx + Math.cos(angle) * reach, cy + Math.sin(angle) * reach, radius, 0, FULL_TURN);
    ctx.fill();
  }
}

function drawCollar(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  rng: Rng,
): void {
  const inset = ts * COLLAR_INSET;
  const size = ts - inset * 2;
  const left = sx + inset;
  const top = sy + inset;
  const bevel = ts * COLLAR_BEVEL;
  ctx.fillStyle = COLLAR_FILL;
  ctx.fillRect(left, top, size, size);
  ctx.fillStyle = COLLAR_LIGHT;
  ctx.fillRect(left, top, size, bevel);
  ctx.fillRect(left, top, bevel, size);
  ctx.fillStyle = COLLAR_DARK;
  ctx.fillRect(left, top + size - bevel, size, bevel);
  ctx.fillRect(left + size - bevel, top, bevel, size);

  ctx.fillStyle = COLLAR_CHIP_COLOR;
  const chip = ts * COLLAR_CHIP_SIZE;
  for (let index = 0; index < COLLAR_CHIP_COUNT; index++) {
    const along = range(rng, 0, size - chip);
    const side = Math.floor(rng() * 4);
    const x = side === 0 || side === 1 ? left + along : side === 2 ? left : left + size - chip;
    const y = side === 2 || side === 3 ? top + along : side === 0 ? top : top + size - chip;
    ctx.fillRect(x, y, chip, chip);
  }
}

function drawShaft(ctx: CanvasRenderingContext2D, sx: number, sy: number, ts: number): void {
  const inset = ts * SHAFT_INSET;
  const size = ts - inset * 2;
  const left = sx + inset;
  const top = sy + inset;
  const depth = ts * SHAFT_WALL_DEPTH;

  const dark = ctx.createLinearGradient(0, top, 0, top + size);
  dark.addColorStop(0, SHAFT_TOP);
  dark.addColorStop(1, SHAFT_BOTTOM);
  ctx.fillStyle = dark;
  ctx.fillRect(left, top, size, size);

  // The far (north and west) walls are the ones seen face-on from above and
  // they face away from the light; the near ones are foreshortened but lit.
  ctx.fillStyle = SHAFT_SHADED_WALL;
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(left + size, top);
  ctx.lineTo(left + size - depth, top + depth);
  ctx.lineTo(left + depth, top + depth);
  ctx.lineTo(left + depth, top + size - depth);
  ctx.lineTo(left, top + size);
  ctx.closePath();
  ctx.fill();

  const lit = ctx.createLinearGradient(
    left + size,
    top + size,
    left + size - depth,
    top + size - depth,
  );
  lit.addColorStop(0, SHAFT_LIT_WALL);
  lit.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = lit;
  ctx.beginPath();
  ctx.moveTo(left + size, top);
  ctx.lineTo(left + size, top + size);
  ctx.lineTo(left, top + size);
  ctx.lineTo(left + depth, top + size - depth);
  ctx.lineTo(left + size - depth, top + size - depth);
  ctx.lineTo(left + size - depth, top + depth);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = SHAFT_GLINT_COLOR;
  ctx.beginPath();
  ctx.ellipse(
    sx + ts * HALF,
    sy + ts * SHAFT_GLINT_Y,
    ts * SHAFT_GLINT_WIDTH * HALF,
    ts * SHAFT_GLINT_HEIGHT * HALF,
    0,
    0,
    FULL_TURN,
  );
  ctx.fill();
}

/** One iron bar: cast shadow into the shaft, dark body, lit top-left edge, ink outline. */
function drawBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  ts: number,
): void {
  const shadow = ts * BAR_SHADOW_OFFSET;
  ctx.fillStyle = BAR_SHADOW;
  ctx.fillRect(x + shadow, y + shadow, w, h);
  ctx.fillStyle = IRON_MID;
  ctx.fillRect(x, y, w, h);
  const edge = Math.min(w, h) * HALF;
  ctx.fillStyle = IRON_LIGHT;
  if (w < h) ctx.fillRect(x, y, edge * HALF, h);
  else ctx.fillRect(x, y, w, edge * HALF);
  ctx.fillStyle = IRON_DARK;
  if (w < h) ctx.fillRect(x + w - edge * HALF, y, edge * HALF, h);
  else ctx.fillRect(x, y + h - edge * HALF, w, edge * HALF);
  ctx.strokeStyle = IRON_EDGE;
  ctx.lineWidth = ts * IRON_OUTLINE_WIDTH;
  ctx.strokeRect(x, y, w, h);
}

function drawGrille(ctx: CanvasRenderingContext2D, sx: number, sy: number, ts: number): void {
  const frameInset = ts * FRAME_INSET;
  const frameWidth = ts * FRAME_WIDTH;
  const outer = ts - frameInset * 2;
  const left = sx + frameInset;
  const top = sy + frameInset;
  const innerLeft = left + frameWidth;
  const innerTop = top + frameWidth;
  const innerSize = outer - frameWidth * 2;
  const barWidth = ts * BAR_WIDTH;

  for (let bar = 1; bar <= VERTICAL_BAR_COUNT; bar++) {
    const centre = innerLeft + (innerSize * bar) / (VERTICAL_BAR_COUNT + 1);
    drawBar(ctx, centre - barWidth * HALF, innerTop, barWidth, innerSize, ts);
  }
  for (let bar = 1; bar <= HORIZONTAL_BAR_COUNT; bar++) {
    const centre = innerTop + (innerSize * bar) / (HORIZONTAL_BAR_COUNT + 1);
    drawBar(ctx, innerLeft, centre - barWidth * HALF, innerSize, barWidth, ts);
  }

  drawBar(ctx, left, top, outer, frameWidth, ts);
  drawBar(ctx, left, top + outer - frameWidth, outer, frameWidth, ts);
  drawBar(ctx, left, top, frameWidth, outer, ts);
  drawBar(ctx, left + outer - frameWidth, top, frameWidth, outer, ts);

  const rivetRadius = ts * RIVET_RADIUS;
  const corners = [
    [left + frameWidth * HALF, top + frameWidth * HALF],
    [left + outer - frameWidth * HALF, top + frameWidth * HALF],
    [left + frameWidth * HALF, top + outer - frameWidth * HALF],
    [left + outer - frameWidth * HALF, top + outer - frameWidth * HALF],
  ] as const;
  for (const [rx, ry] of corners) {
    ctx.fillStyle = IRON_EDGE;
    ctx.beginPath();
    ctx.arc(rx, ry, rivetRadius, 0, FULL_TURN);
    ctx.fill();
    ctx.fillStyle = RIVET_LIGHT;
    ctx.beginPath();
    ctx.arc(
      rx - rivetRadius * HALF * HALF,
      ry - rivetRadius * HALF * HALF,
      rivetRadius * HALF,
      0,
      FULL_TURN,
    );
    ctx.fill();
  }
}

function drawRust(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  rng: Rng,
): void {
  const frameInset = ts * FRAME_INSET;
  const outer = ts - frameInset * 2;
  for (let spot = 0; spot < RUST_SPOT_COUNT; spot++) {
    const x = sx + frameInset + rng() * outer;
    const y = sy + frameInset + rng() * outer;
    const radius = ts * range(rng, RUST_SPOT_MIN_RADIUS, RUST_SPOT_MAX_RADIUS);
    ctx.fillStyle = RUST_COLOR;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, FULL_TURN);
    ctx.fill();
  }
  // Rust weeps from the bottom rail onto the stone below it.
  ctx.fillStyle = RUST_STREAK_COLOR;
  const railY = sy + ts - frameInset;
  for (let streak = 0; streak < 2; streak++) {
    const x = sx + frameInset + rng() * (outer - ts * RUST_STREAK_WIDTH);
    ctx.fillRect(x, railY, ts * RUST_STREAK_WIDTH, ts * RUST_STREAK_LENGTH * range(rng, HALF, 1));
  }
}
