/**
 * Placeholder renderers for Briar Hollow's floors, ground cover and blocking
 * props.
 *
 * Flat, honest colour blocks rather than real art: each function paints one
 * tile in a single solid fill so the tile type never falls through to the
 * renderer's unmapped-magenta default.
 */

const HOLLOW_PLANK_FLOOR_COLOR = '#8a6a42';
const HOLLOW_THRESHOLD_COLOR = '#7a6248';
const HOLLOW_DECAL_COLOR = '#6e7a3c';
const PASTURE_GRASS_COLOR = '#5c8048';
const CROP_FIELD_COLOR = '#6e5636';
const HOLLOW_PROP_LOW_COLOR = '#9a7850';
const HOLLOW_PROP_TALL_COLOR = '#6a5238';

function fillTile(
  ctx: CanvasRenderingContext2D,
  color: string,
  sx: number,
  sy: number,
  ts: number,
): void {
  ctx.fillStyle = color;
  ctx.fillRect(sx, sy, ts, ts);
}

export function drawHollowPlankFloorTile(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
): void {
  fillTile(ctx, HOLLOW_PLANK_FLOOR_COLOR, sx, sy, ts);
}

export function drawHollowThresholdTile(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
): void {
  fillTile(ctx, HOLLOW_THRESHOLD_COLOR, sx, sy, ts);
}

export function drawHollowDecalTile(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
): void {
  fillTile(ctx, HOLLOW_DECAL_COLOR, sx, sy, ts);
}

export function drawPastureGrassTile(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
): void {
  fillTile(ctx, PASTURE_GRASS_COLOR, sx, sy, ts);
}

export function drawCropFieldTile(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
): void {
  fillTile(ctx, CROP_FIELD_COLOR, sx, sy, ts);
}

export function drawHollowPropLowTile(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
): void {
  fillTile(ctx, HOLLOW_PROP_LOW_COLOR, sx, sy, ts);
}

export function drawHollowPropTallTile(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
): void {
  fillTile(ctx, HOLLOW_PROP_TALL_COLOR, sx, sy, ts);
}
