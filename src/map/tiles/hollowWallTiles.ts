/**
 * Placeholder renderers for Briar Hollow's walls, palisade and gate.
 *
 * Flat, honest colour blocks rather than real art: each function paints one
 * tile in a single solid fill so the tile type never falls through to the
 * renderer's unmapped-magenta default. The palisade's tier is read from
 * `wallTier` so a fence, a wood, a stone and a fortified segment are at least
 * visually distinct before real art replaces them.
 */

import type { PalisadeTier, TileContent } from '../tileTypes';

const HOLLOW_WALL_COLOR = '#8a7458';
const HOLLOW_GATE_COLOR = '#6b5636';
const HOLLOW_PALISADE_GAP_COLOR = '#5c5548';

const PALISADE_TIER_COLORS: Record<PalisadeTier, string> = {
  fence: '#9c8054',
  wood: '#7a5c38',
  stone: '#7c7668',
  fortified: '#5c5850',
};

export function drawHollowWallTile(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
): void {
  ctx.fillStyle = HOLLOW_WALL_COLOR;
  ctx.fillRect(sx, sy, ts, ts);
}

export function drawHollowGateTile(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
): void {
  ctx.fillStyle = HOLLOW_GATE_COLOR;
  ctx.fillRect(sx, sy, ts, ts);
}

export function drawHollowPalisadeTile(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const tier = structure[ty]?.[tx]?.wallTier ?? 'fence';
  ctx.fillStyle = PALISADE_TIER_COLORS[tier];
  ctx.fillRect(sx, sy, ts, ts);
}

export function drawHollowPalisadeGapTile(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
): void {
  ctx.fillStyle = HOLLOW_PALISADE_GAP_COLOR;
  ctx.fillRect(sx, sy, ts, ts);
}
