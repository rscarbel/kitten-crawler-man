/**
 * The Dark Knight's green bolt, drawn at runtime rather than baked.
 *
 * Deliberately not a sprite sheet. The knight's own sheet is already the largest
 * asset in the game, and a bolt is three circles and a tail — the pixels a sheet
 * would cost buy nothing a gradient does not. It also keeps this feature clear
 * of the manifest while the asset loader is being reworked.
 *
 * Green on purpose, against the red of his ground telegraphs: the two threats
 * are read differently — one is a place to leave, the other is a line to break —
 * so they must not share a colour.
 */

/** Radius of the bolt's solid core, in tiles. */
const CORE_RADIUS_TILES = 0.11;
/** Radius of the glow around it, in tiles. */
const GLOW_RADIUS_TILES = 0.3;
/** How far the tail streams behind the bolt, in tiles. */
const TAIL_LENGTH_TILES = 0.62;
/** Half-width of the tail where it meets the core, in tiles. */
const TAIL_HALF_WIDTH_TILES = 0.075;

const CORE_COLOR = '#eaffd0';
const INNER_COLOR = '#7bf25a';
const OUTER_COLOR = '#1f7a24';
const GLOW_INNER = 'rgba(124, 245, 96, 0.55)';
const GLOW_OUTER = 'rgba(31, 122, 36, 0)';

/**
 * Frames per cycle of the core's flicker, and how much of its radius the
 * flicker moves. Fast and shallow — it should read as unstable magic, not as a
 * pulse the player might try to time something against.
 */
const FLICKER_PERIOD_FRAMES = 7;
const FLICKER_DEPTH = 0.16;

/**
 * Draws one bolt at a screen position, travelling along (`dirX`, `dirY`).
 *
 * @param age frames since it was fired, which drives only the flicker
 */
export function drawKnightMissile(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  dirX: number,
  dirY: number,
  age: number,
): void {
  const flickerPhase = ((age % FLICKER_PERIOD_FRAMES) / FLICKER_PERIOD_FRAMES) * Math.PI * 2;
  const flicker = 1 + Math.sin(flickerPhase) * FLICKER_DEPTH;
  const core = tileSize * CORE_RADIUS_TILES * flicker;
  const glow = tileSize * GLOW_RADIUS_TILES * flicker;

  ctx.save();

  const halo = ctx.createRadialGradient(sx, sy, 0, sx, sy, glow);
  halo.addColorStop(0, GLOW_INNER);
  halo.addColorStop(1, GLOW_OUTER);
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(sx, sy, glow, 0, Math.PI * 2);
  ctx.fill();

  // The tail is a triangle rather than a stroked line so it tapers to a point
  // behind the bolt; a stroke of even width reads as a stick being carried.
  const length = Math.hypot(dirX, dirY);
  if (length > 0) {
    const backX = -dirX / length;
    const backY = -dirY / length;
    const tail = tileSize * TAIL_LENGTH_TILES;
    const half = tileSize * TAIL_HALF_WIDTH_TILES;
    ctx.fillStyle = OUTER_COLOR;
    ctx.beginPath();
    ctx.moveTo(sx + backX * tail, sy + backY * tail);
    ctx.lineTo(sx - backY * half, sy + backX * half);
    ctx.lineTo(sx + backY * half, sy - backX * half);
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = INNER_COLOR;
  ctx.beginPath();
  ctx.arc(sx, sy, core * 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = CORE_COLOR;
  ctx.beginPath();
  ctx.arc(sx, sy, core, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/** Frames the burst plays for when a bolt lands. */
export const KNIGHT_MISSILE_BURST_FRAMES = 12;

/** How far the burst ring expands, in tiles. */
const BURST_MAX_RADIUS_TILES = 0.5;
const BURST_LINE_WIDTH_PX = 2;

/** The small green ring a bolt leaves where it stops. */
export function drawKnightMissileBurst(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  progress: number,
): void {
  const radius = tileSize * BURST_MAX_RADIUS_TILES * progress;
  if (radius <= 0) return;
  ctx.save();
  ctx.globalAlpha = 1 - progress;
  ctx.strokeStyle = INNER_COLOR;
  ctx.lineWidth = BURST_LINE_WIDTH_PX;
  ctx.beginPath();
  ctx.arc(sx, sy, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
