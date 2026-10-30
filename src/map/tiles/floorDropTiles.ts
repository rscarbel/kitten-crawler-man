/**
 * A hole through a storey's floor: dark all the way down, with the broken
 * ends of the boards round its rim. The rim is drawn only on a side whose
 * neighbour is not more hole, so a run of drop tiles reads as one opening;
 * the far (north) rim shows the boards' cut ends and the depth falling away
 * below them, and the near (south) rim is only a lip, its face out of sight.
 *
 * Everything is a share of `ts`; light comes from the upper left.
 */

import { FLOOR_DROP, FLOOR_DROP_SPANNED, type TileContent } from '../tileTypes';

const DEPTH_TOP = '#0d0b0a';
const DEPTH_BOTTOM = '#030303';
/** How far down the far wall of the hole the storey's light still reaches, as a share of a tile. */
const FAR_WALL_SHARE = 0.34;
const FAR_WALL_TOP = 'rgba(70,52,34,0.55)';
const FAR_WALL_BOTTOM = 'rgba(20,14,10,0)';
const BOARD_END = '#6e5434';
const BOARD_END_LIGHT = 'rgba(232,200,150,0.35)';
const BOARD_END_SHARE = 0.08;
/** The broken boards stick out over the hole by different amounts, so the rim is ragged. */
const BOARD_JAG_SHARES = [0.05, 0.11, 0.03, 0.09] as const;
const NEAR_LIP = 'rgba(214,180,128,0.4)';
const NEAR_LIP_SHARE = 0.035;
const SIDE_SHADOW = 'rgba(0,0,0,0.45)';
const SIDE_SHADOW_SHARE = 0.06;

function isHoleType(type: number | undefined): boolean {
  return type === FLOOR_DROP || type === FLOOR_DROP_SPANNED;
}

function isDrop(structure: TileContent[][], tx: number, ty: number): boolean {
  return isHoleType(structure[ty]?.[tx]?.type);
}

function drawFloorDrop(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const depth = ctx.createLinearGradient(0, sy, 0, sy + ts);
  depth.addColorStop(0, DEPTH_TOP);
  depth.addColorStop(1, DEPTH_BOTTOM);
  ctx.fillStyle = depth;
  ctx.fillRect(sx, sy, ts, ts);

  if (!isDrop(structure, tx, ty - 1)) {
    const wallHeight = ts * FAR_WALL_SHARE;
    const wall = ctx.createLinearGradient(0, sy, 0, sy + wallHeight);
    wall.addColorStop(0, FAR_WALL_TOP);
    wall.addColorStop(1, FAR_WALL_BOTTOM);
    ctx.fillStyle = wall;
    ctx.fillRect(sx, sy, ts, wallHeight);
    const boards = BOARD_JAG_SHARES.length;
    const boardWidth = ts / boards;
    for (let board = 0; board < boards; board++) {
      const jag = BOARD_JAG_SHARES[(board + tx) % boards];
      const height = ts * (BOARD_END_SHARE + jag);
      ctx.fillStyle = BOARD_END;
      ctx.fillRect(sx + board * boardWidth, sy, boardWidth - 1, height);
      ctx.fillStyle = BOARD_END_LIGHT;
      ctx.fillRect(sx + board * boardWidth, sy + height - 1, boardWidth - 1, 1);
    }
  }
  if (!isDrop(structure, tx, ty + 1)) {
    ctx.fillStyle = NEAR_LIP;
    ctx.fillRect(sx, sy + ts * (1 - NEAR_LIP_SHARE), ts, ts * NEAR_LIP_SHARE);
  }
  const sideWidth = ts * SIDE_SHADOW_SHARE;
  ctx.fillStyle = SIDE_SHADOW;
  if (!isDrop(structure, tx - 1, ty)) ctx.fillRect(sx, sy, sideWidth, ts);
  if (!isDrop(structure, tx + 1, ty)) ctx.fillRect(sx + ts - sideWidth, sy, sideWidth, ts);
}

/** Paints a hole in the floor, spanned or not; false for any other type. */
export function drawFloorDropTile(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  type: number,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): boolean {
  if (!isHoleType(type)) return false;
  drawFloorDrop(ctx, structure, sx, sy, ts, tx, ty);
  return true;
}
