/**
 * Placeholder renderer for a minable stone outcrop.
 *
 * A flat, honest colour block rather than real art, so the tile type never
 * falls through to the renderer's unmapped-magenta default.
 */

const ROCK_DEPOSIT_COLOR = '#726a5e';

export function drawRockDepositTile(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
): void {
  ctx.fillStyle = ROCK_DEPOSIT_COLOR;
  ctx.fillRect(sx, sy, ts, ts);
}
