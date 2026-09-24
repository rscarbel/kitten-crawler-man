import type { GameMap } from '../../map/GameMap';
import { roomDoorways, type RoomDoorway, type RoomWall } from '../../map/roomDoorways';
import { placeProp, type TileContent } from '../../map/tileTypes';
import { isWalkableTileType } from '../../map/walkability';

/**
 * Which wall of a boss room a doorway breaks through. The same four words
 * `roomDoorways` uses, so a doorway found there needs no translation.
 */
export type DoorSide = RoomWall;

export interface TileRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TilePoint {
  x: number;
  y: number;
}

/** One doorway into a boss room, with the side a layout template is keyed to. */
export interface BossRoomDoorway {
  side: DoorSide;
  /** Middle tile of the opening, on the room's own perimeter. */
  tile: TilePoint;
  /** Every perimeter tile of the opening; a corridor two tiles wide has two. */
  tiles: TilePoint[];
}

/**
 * Every doorway into a room, widest first.
 *
 * A thin wrapper over `roomDoorways` rather than a scan of its own: that module
 * walks the perimeter as one ring so a corridor arriving at a corner is one
 * opening rather than two, and a second definition here would drift from it.
 * Widest first because the main corridor is the widest one, and it is the side
 * a template should be authored against; a gateway room's far door comes after.
 */
export function findBossRoomDoorways(grid: TileContent[][], bounds: TileRect): BossRoomDoorway[] {
  return roomDoorways(grid, bounds)
    .slice()
    .sort((a, b) => b.tiles.length - a.tiles.length)
    .map((doorway: RoomDoorway) => ({
      side: doorway.wall,
      tile: { x: doorway.tile.x, y: doorway.tile.y },
      tiles: doorway.tiles.map((t) => ({ x: t.x, y: t.y })),
    }));
}

/** The side a room's layout template is keyed to: its widest doorway's, or south when it has none. */
export function primaryDoorSide(grid: TileContent[][], bounds: TileRect): DoorSide {
  const doorways = findBossRoomDoorways(grid, bounds);
  return doorways.length === 0 ? 'south' : doorways[0].side;
}

/**
 * A tile position in a template, in the frame of a crawler standing in the
 * doorway and looking into the room.
 *
 * `depth` counts tiles inward from the doorway's wall row (0 is the room's own
 * edge row). `along` is signed, measured from the middle of that wall, positive
 * to the crawler's right. Authoring in this frame rather than in room x/y is
 * what lets one template serve all four sides: a boss room is not square, so a
 * layout written in x/y for a south door has no sensible reading for an east one.
 */
export interface TemplateOffset {
  along: number;
  depth: number;
}

/**
 * Maps authored doorway-frame offsets into world tiles for a room whose doorway
 * is on `side`, keeping whatever else each entry carries.
 *
 * Entries that land outside the room's bounds are dropped rather than clamped:
 * a room's east-west span differs from its north-south one, so a template
 * authored deep enough for the long axis runs past the far wall on the short
 * one, and clamping would pile those props against that wall.
 */
export function rotateTemplate<T extends TemplateOffset>(
  template: ReadonlyArray<T>,
  side: DoorSide,
  bounds: TileRect,
): Array<Omit<T, keyof TemplateOffset> & TilePoint> {
  const lastX = bounds.x + bounds.w - 1;
  const lastY = bounds.y + bounds.h - 1;
  const midX = bounds.x + Math.floor(bounds.w / 2);
  const midY = bounds.y + Math.floor(bounds.h / 2);
  const placed: Array<Omit<T, keyof TemplateOffset> & TilePoint> = [];
  for (const entry of template) {
    const { along, depth, ...rest } = entry;
    const world = doorFrameToWorld(along, depth, side, { lastX, lastY, midX, midY, bounds });
    if (!isInsideRect(world, bounds)) continue;
    placed.push({ ...rest, x: world.x, y: world.y });
  }
  return placed;
}

interface RoomFrame {
  lastX: number;
  lastY: number;
  midX: number;
  midY: number;
  bounds: TileRect;
}

function doorFrameToWorld(
  along: number,
  depth: number,
  side: DoorSide,
  frame: RoomFrame,
): TilePoint {
  switch (side) {
    case 'south':
      return { x: frame.midX + along, y: frame.lastY - depth };
    case 'north':
      return { x: frame.midX - along, y: frame.bounds.y + depth };
    case 'east':
      return { x: frame.lastX - depth, y: frame.midY - along };
    case 'west':
      return { x: frame.bounds.x + depth, y: frame.midY + along };
  }
}

function isInsideRect(point: TilePoint, rect: TileRect): boolean {
  return (
    point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.w && point.y < rect.y + rect.h
  );
}

/** One prop to write into the map: a tile type, or a bare collision block. */
export interface PropPlacement extends TilePoint {
  /** The tile type to stamp, or omitted to block the tile without changing its art. */
  type?: number;
  /** Also raise the map's permanent block flag, for a prop whose tile type is walkable. */
  block?: boolean;
}

/** The part of `GameMap` stamping touches, so a harness can stamp a bare grid. */
export type StampTarget = Pick<GameMap, 'structure' | 'markTileDirty' | 'blockTilePermanently'>;

/**
 * Writes props into the map and returns how many were placed.
 *
 * Only onto walkable ground: a template rotated into an odd-shaped room can
 * land an entry on a wall or on another system's fixture, and overwriting
 * either silently changes the room's shape. Each stamped tile is marked dirty so
 * the chunk cache and both decoration registries pick it up on the next frame.
 */
export function stampProps(target: StampTarget, placements: ReadonlyArray<PropPlacement>): number {
  let stamped = 0;
  for (const placement of placements) {
    const insideGrid =
      placement.y >= 0 &&
      placement.y < target.structure.length &&
      placement.x >= 0 &&
      placement.x < target.structure[placement.y].length;
    if (!insideGrid) continue;
    const tile = target.structure[placement.y][placement.x];
    if (!isWalkableTileType(tile)) continue;
    if (placement.type !== undefined) placeProp(tile, placement.type);
    if (placement.block === true) target.blockTilePermanently(placement.x, placement.y);
    target.markTileDirty(placement.x, placement.y);
    stamped++;
  }
  return stamped;
}

/** A doorway's clear approach, by the smallest dimensions a layout may leave. */
export const APPROACH_LANE_MIN_WIDTH_TILES = 3;
export const APPROACH_LANE_MIN_DEPTH_TILES = 4;

/**
 * Every room tile in front of a doorway that a layout must leave open: at least
 * `minWidth` wide (and never narrower than the opening itself), `depth` deep.
 *
 * Measured from the real doorway tiles rather than from the wall's middle,
 * because a corridor can strike a wall anywhere along it.
 */
export function approachLaneTiles(
  doorway: BossRoomDoorway,
  bounds: TileRect,
  minWidth = APPROACH_LANE_MIN_WIDTH_TILES,
  depth = APPROACH_LANE_MIN_DEPTH_TILES,
): TilePoint[] {
  const runsAlongX = doorway.side === 'north' || doorway.side === 'south';
  const alongOf = (t: TilePoint): number => (runsAlongX ? t.x : t.y);
  let alongMin = Math.min(...doorway.tiles.map(alongOf));
  let alongMax = Math.max(...doorway.tiles.map(alongOf));
  while (alongMax - alongMin + 1 < minWidth) {
    alongMin--;
    if (alongMax - alongMin + 1 < minWidth) alongMax++;
  }

  const inward = inwardStep(doorway.side);
  const wallRow = runsAlongX ? doorway.tile.y : doorway.tile.x;
  const lane: TilePoint[] = [];
  for (let step = 0; step < depth; step++) {
    const row = wallRow + step * (runsAlongX ? inward.dy : inward.dx);
    for (let along = alongMin; along <= alongMax; along++) {
      const tile = runsAlongX ? { x: along, y: row } : { x: row, y: along };
      if (isInsideRect(tile, bounds)) lane.push(tile);
    }
  }
  return lane;
}

function inwardStep(side: DoorSide): { dx: number; dy: number } {
  switch (side) {
    case 'south':
      return { dx: 0, dy: -1 };
    case 'north':
      return { dx: 0, dy: 1 };
    case 'east':
      return { dx: -1, dy: 0 };
    case 'west':
      return { dx: 1, dy: 0 };
  }
}

/** The clear ground a layout must leave around where the boss spawns. */
export const SPAWN_CLEAR_RADIUS_TILES = 3;

/** Every tile within `radius` tiles (centre to centre) of the boss's spawn tile. */
export function spawnClearTiles(spawn: TilePoint, radius = SPAWN_CLEAR_RADIUS_TILES): TilePoint[] {
  const tiles: TilePoint[] = [];
  const reach = Math.ceil(radius);
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      if (Math.hypot(dx, dy) > radius) continue;
      tiles.push({ x: spawn.x + dx, y: spawn.y + dy });
    }
  }
  return tiles;
}
