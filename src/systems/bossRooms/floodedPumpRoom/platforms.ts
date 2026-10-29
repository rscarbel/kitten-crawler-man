import type { TileRect } from '../bossRoomLayout';

/**
 * The three walls a pump is mounted on, in the frame of a crawler standing in
 * the entrance looking in: the wall on their left, the one facing them, and
 * the one on their right.
 */
export const PUMP_WALLS = ['left', 'far', 'right'] as const;
export type PumpWall = (typeof PUMP_WALLS)[number];

export type RaftId = `raft_${number}`;
/** The raft moored beside a pump, which a crawler hauls the pump's valve from. */
export type PumpRaftId = `pump_raft_${PumpWall}`;

/** Every float a crawler can stand on in the flooded room. */
export type PlatformId = 'landing' | RaftId | PumpRaftId;

export function raftId(index: number): RaftId {
  return `raft_${index}`;
}

export function pumpRaftId(wall: PumpWall): PumpRaftId {
  return `pump_raft_${wall}`;
}

/**
 * A point in world tile units, continuous: tile (x, y) spans [x, x + 1) on
 * each axis, so a crawler standing in the middle of it is at (x + 0.5, y + 0.5).
 * The room's swimming and chasing are all measured in these units, never in
 * pixels.
 */
export interface TileVec {
  readonly x: number;
  readonly y: number;
}

/** Shortest distance from `point` to any part of `rect`, 0 inside it. */
export function distanceToRect(point: TileVec, rect: TileRect): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.w));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.h));
  return Math.hypot(dx, dy);
}

/** Shortest distance between two rects, 0 when they touch or overlap. */
export function gapBetweenRects(a: TileRect, b: TileRect): number {
  const dx = Math.max(b.x - (a.x + a.w), 0, a.x - (b.x + b.w));
  const dy = Math.max(b.y - (a.y + a.h), 0, a.y - (b.y + b.h));
  return Math.hypot(dx, dy);
}

export function rectContainsTile(rect: TileRect, x: number, y: number): boolean {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h;
}
