import { PLAYER_SPEED, TILE_SIZE } from '../core/constants';
import { intoxicatedHeadwayShare, intoxicationOf } from '../core/combat/Intoxication';
import type { GameMap } from '../map/GameMap';
import { footingFactorAt } from '../map/tileSpeed';
import type { Player } from '../Player';

type Walker = Pick<
  Player,
  'x' | 'y' | 'mobility' | 'hasStatus' | 'canAct' | 'isCrossingFooting' | 'speedMultiplier'
>;

interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

const HALF_TILE_PX = TILE_SIZE / 2;

/** Whether a crawler may take a step of its own this frame. */
export function crawlerCanWalk(crawler: Walker): boolean {
  return !crawler.hasStatus('stuck') && crawler.canAct && !crawler.isCrossingFooting;
}

/**
 * How far a crawler walks in one frame on ordinary ground right now, in world
 * pixels: its potions, chills and other slows included, and none at all while
 * it cannot take a step. The ground underfoot scales it further
 * (`footingFactorAt`).
 */
export function crawlerWalkPacePx(crawler: Walker): number {
  return crawlerCanWalk(crawler) ? PLAYER_SPEED * crawler.speedMultiplier : 0;
}

function tileCentre(tile: WorldPoint): WorldPoint {
  return { x: tile.x * TILE_SIZE + HALF_TILE_PX, y: tile.y * TILE_SIZE + HALF_TILE_PX };
}

function tileOf(point: WorldPoint): WorldPoint {
  return { x: Math.floor(point.x / TILE_SIZE), y: Math.floor(point.y / TILE_SIZE) };
}

/**
 * Frames `crawler` needs to walk from its centre to `goal` at its pace now,
 * along the map's own path search and slowed by each tile's footing on the
 * way; `Infinity` when it cannot move, or no route reaches the goal inside
 * `budgetFrames`. The trip runs through every tile centre of the path and a
 * drunk crawler is counted at its widest veer, so it never comes out shorter
 * than the walk really is.
 */
export function crawlerWalkFramesTo(
  gameMap: Pick<GameMap, 'findPath' | 'isWadeable' | 'structure'>,
  crawler: Walker,
  goal: WorldPoint,
  budgetFrames: number,
): number {
  const start = { x: crawler.x + HALF_TILE_PX, y: crawler.y + HALF_TILE_PX };
  const pace = crawlerWalkPacePx(crawler) * intoxicatedHeadwayShare(intoxicationOf(crawler));
  if (pace <= 0) return Infinity;
  const from = tileOf(start);
  const to = tileOf(goal);
  const budgetTiles = Math.ceil((pace * budgetFrames) / TILE_SIZE);
  const path = gameMap.findPath(from.x, from.y, to.x, to.y, crawler.mobility, budgetTiles);
  if (path.length === 0) return Infinity;
  const last = path[path.length - 1];
  if (last.x !== to.x || last.y !== to.y) return Infinity;

  let frames = 0;
  let at = start;
  let atTile = from;
  const legs = [
    ...path.map((tile) => ({ tile, point: tileCentre(tile) })),
    { tile: to, point: goal },
  ];
  for (const leg of legs) {
    const lengthPx = Math.hypot(leg.point.x - at.x, leg.point.y - at.y);
    const footing = Math.min(
      footingFactorAt(gameMap, atTile.x, atTile.y),
      footingFactorAt(gameMap, leg.tile.x, leg.tile.y),
    );
    frames += lengthPx / (pace * footing);
    at = leg.point;
    atTile = leg.tile;
  }
  return frames;
}
