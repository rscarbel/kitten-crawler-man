/**
 * The defend quest's marks painted into the nursery itself, in world space:
 * the guide gold on open grates, the spark flash off a struck barrier, the
 * stakes round a spiked one and the cross over a fallen goblin mother.
 */

/** The quest guide's gold — the same colour the Borrowed Blueprints marks its fence and harvest spots in. */
export const NURSERY_GUIDE_COLOR = '#facc15';

/** The warm flash a blow throws off the boards; additive, so it reads as sparks off the wood rather than a red box. */
const BARRIER_HIT_FLASH_COLOR = '#ff9a4a';

/** A struck barrier's spark flash over its tile, at `alpha`. */
export function paintBarrierHitFlash(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ts: number,
  alpha: number,
): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = alpha;
  ctx.fillStyle = BARRIER_HIT_FLASH_COLOR;
  ctx.fillRect(x, y, ts, ts);
  ctx.restore();
}

const DEAD_CROSS_COLOR = '#ef4444';
const DEAD_CROSS_LINE_WIDTH = 4;
const DEAD_CROSS_NEAR_FRACTION = 0.2;
const DEAD_CROSS_FAR_FRACTION = 0.8;

/** A red cross over the tile of an NPC the quest failed to keep alive. */
export function paintDeadNpcCross(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ts: number,
): void {
  const near = ts * DEAD_CROSS_NEAR_FRACTION;
  const far = ts * DEAD_CROSS_FAR_FRACTION;
  ctx.save();
  ctx.strokeStyle = DEAD_CROSS_COLOR;
  ctx.lineWidth = DEAD_CROSS_LINE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(x + near, y + near);
  ctx.lineTo(x + far, y + far);
  ctx.moveTo(x + far, y + near);
  ctx.lineTo(x + near, y + far);
  ctx.stroke();
  ctx.restore();
}

/** Sharpened stakes nailed round a boarded grate, points out. */
const BARRIER_SPIKE_COUNT = 8;
const BARRIER_SPIKE_RING = 0.46;
const BARRIER_SPIKE_LENGTH = 0.2;
const BARRIER_SPIKE_WIDTH = 0.06;
const BARRIER_SPIKE_FILL = '#d8b27a';
const BARRIER_SPIKE_INK = '#2a1a10';
const BARRIER_SPIKE_INK_WIDTH = 1;
const TILE_CENTER = 0.5;

/** The ring of stakes round a spiked barrier on the tile at (`x`, `y`). */
export function paintBarrierSpikes(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ts: number,
): void {
  const cx = x + ts * TILE_CENTER;
  const cy = y + ts * TILE_CENTER;
  ctx.save();
  ctx.fillStyle = BARRIER_SPIKE_FILL;
  ctx.strokeStyle = BARRIER_SPIKE_INK;
  ctx.lineWidth = BARRIER_SPIKE_INK_WIDTH;
  for (let spike = 0; spike < BARRIER_SPIKE_COUNT; spike++) {
    const angle = (spike / BARRIER_SPIKE_COUNT) * Math.PI * 2;
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    const rootX = cx + dirX * ts * (BARRIER_SPIKE_RING - BARRIER_SPIKE_LENGTH);
    const rootY = cy + dirY * ts * (BARRIER_SPIKE_RING - BARRIER_SPIKE_LENGTH);
    const tipX = cx + dirX * ts * BARRIER_SPIKE_RING;
    const tipY = cy + dirY * ts * BARRIER_SPIKE_RING;
    const sideX = -dirY * ts * BARRIER_SPIKE_WIDTH;
    const sideY = dirX * ts * BARRIER_SPIKE_WIDTH;
    ctx.beginPath();
    ctx.moveTo(rootX + sideX, rootY + sideY);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(rootX - sideX, rootY - sideY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}
