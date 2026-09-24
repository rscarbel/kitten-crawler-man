/**
 * Where a fairy left alone runs to: the next room with a fight still in it on a
 * dungeon floor, the nearest other hostile group in the open, and never back
 * through the party to get there.
 */

import type { GameMap } from '../../map/GameMap';
import { MOB_MAX_PATH_DISTANCE_TILES } from '../../map/GameMap';
import { RUINS_CIRCUS_BUFFER } from '../../map/OverworldGenerator';
import type { Mob } from '../Mob';
import { collectMobsNear } from '../packAlert';
import {
  FAIRY_ALLY_SEARCH_TILES,
  FAIRY_REFUGE_OCCUPIED_BONUS_TILES,
  FAIRY_REFUGE_PARTY_CLEARANCE_TILES,
} from './fairyTuning';

/** A rectangle of tiles. */
export interface TileRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A place a lone fairy is flying to. */
export interface FairyRefuge {
  /** Where it flies, in world pixels, on the same top-left convention as a mob's `x`/`y`. */
  readonly x: number;
  readonly y: number;
  /** The room it is making for, in tiles; null for a group in the open. */
  readonly room: TileRect | null;
  /** The room record or mob this refuge was chosen from, so a failed one can be passed over. */
  readonly source: object;
}

/** Everything a refuge choice reads about the world and the fairy choosing. */
export interface FairyRefugeQuery {
  readonly map: GameMap;
  readonly tileSize: number;
  /** The fairy, top-left in world pixels. */
  readonly fromX: number;
  readonly fromY: number;
  /** Living crawlers (and their allies) the fairy is running from. */
  readonly threats: readonly { readonly x: number; readonly y: number }[];
  /** Refuges already tried and failed. */
  readonly passedOver: WeakSet<object>;
  /** Whether a mob is a body the fairy would support: living, hostile and not a fairy. */
  readonly isSupportable: (mob: Mob) => boolean;
  /** Where the fairy spawned, in world pixels: a refuge past {@link leashRadiusPx} of it is never chosen. */
  readonly leashOriginX: number;
  readonly leashOriginY: number;
  readonly leashRadiusPx: number;
}

/**
 * How far a refuge may lie, in tiles. The path search refuses a goal past this
 * many tiles on either axis, so a room beyond it could never be walked to.
 */
const REFUGE_SEARCH_TILES = MOB_MAX_PATH_DISTANCE_TILES;

/**
 * How much nearer a threat a route tile must come than the fairy stands before
 * the route counts as closing on it, in tiles. A route is walked in whole
 * tiles from the tile under the fairy, so its first step round that tile can
 * read up to a tile nearer a threat without the fairy flying toward it at all.
 */
const ROUTE_GRID_SLACK_TILES = 1;

/** How far from a room's centre, in tiles, a walkable landing tile is looked for. */
const ROOM_LANDING_SEARCH_TILES = 2;

const nearbyScratch: Mob[] = [];

/** The tile under an entity's centre. */
function tileOf(x: number, y: number, tileSize: number): { x: number; y: number } {
  return {
    x: Math.floor((x + tileSize / 2) / tileSize),
    y: Math.floor((y + tileSize / 2) / tileSize),
  };
}

export function isTileInRect(tileX: number, tileY: number, rect: TileRect): boolean {
  return tileX >= rect.x && tileY >= rect.y && tileX < rect.x + rect.w && tileY < rect.y + rect.h;
}

/**
 * Whether a fairy may hover on this tile at all: never inside the town wall or
 * its safe radius, and never on the circus grounds. The same ground a fairy may
 * not be placed on, so one that flees cannot carry a fight into the town.
 */
export function isFairyGroundForbidden(map: GameMap, tileX: number, tileY: number): boolean {
  if (map.isTileInsideTownWall(tileX, tileY)) return true;
  if (map.isInTownSafeZone(tileX * map.tileHeight, tileY * map.tileHeight)) return true;
  const circus = map.circusCentre;
  const circusRadius = map.circusRadiusTiles;
  if (circus !== undefined && circusRadius !== undefined) {
    const reach = circusRadius + RUINS_CIRCUS_BUFFER;
    if (Math.hypot(tileX - circus.x, tileY - circus.y) <= reach) return true;
  }
  return false;
}

/**
 * Whether flying straight from `from` to `to` passes within `clearancePx` of
 * `point` on the way. A point behind the start — one the flight leaves rather
 * than approaches — is never passed, however close it stands to the start:
 * backing straight away from a crawler at arm's length is not running into it.
 */
export function flightPasses(
  point: { readonly x: number; readonly y: number },
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
  clearancePx: number,
): boolean {
  const segX = to.x - from.x;
  const segY = to.y - from.y;
  const lengthSq = segX * segX + segY * segY;
  if (lengthSq === 0) return false;
  const rawAlong = ((point.x - from.x) * segX + (point.y - from.y) * segY) / lengthSq;
  if (rawAlong <= 0) return false;
  const along = Math.min(1, rawAlong);
  const offX = point.x - (from.x + segX * along);
  const offY = point.y - (from.y + segY * along);
  return Math.hypot(offX, offY) < clearancePx;
}

/**
 * Whether the route to (x, y) runs into the party to get away from it: some
 * tile of it comes within the clearance of a threat and nearer that threat
 * than the fairy already is, by more than the route's grid slack. Judged along the route the fairy would really
 * fly, so a way round that first leads off past the party's far side is not
 * mistaken for a charge through it, and a tile the fairy only leaves behind
 * never counts — backing away from a crawler at arm's length is not running
 * into it. A refuge with no route at all is no refuge either.
 *
 * Such a refuge is never taken, even when it is the only one: a fairy with
 * nowhere else to go keeps its distance where it is instead.
 */
function routeRunsThroughParty(query: FairyRefugeQuery, x: number, y: number): boolean {
  const ts = query.tileSize;
  const start = tileOf(query.fromX, query.fromY, ts);
  const goal = tileOf(x, y, ts);
  const route = query.map.findPath(start.x, start.y, goal.x, goal.y, REFUGE_SEARCH_TILES);
  if (route.length === 0) return true;
  const clearancePx = ts * FAIRY_REFUGE_PARTY_CLEARANCE_TILES;
  const slackPx = ts * ROUTE_GRID_SLACK_TILES;
  return query.threats.some((threat) => {
    const fairyGapPx = Math.hypot(threat.x - query.fromX, threat.y - query.fromY);
    return route.some((tile) => {
      const gapPx = Math.hypot(threat.x - tile.x * ts, threat.y - tile.y * ts);
      return gapPx < clearancePx && gapPx < fairyGapPx - slackPx;
    });
  });
}

/** Whether (x, y) lies within the fairy's spawn leash, so a refuge never carries it past it. */
function withinSpawnLeash(query: FairyRefugeQuery, x: number, y: number): boolean {
  return Math.hypot(x - query.leashOriginX, y - query.leashOriginY) <= query.leashRadiusPx;
}

interface ScoredRefuge {
  readonly refuge: FairyRefuge;
  readonly score: number;
}

/**
 * The best-scoring candidate whose route keeps clear of the party. Routes
 * are searched best first, so the usual choice costs a single search.
 */
function bestClearRefuge(query: FairyRefugeQuery, candidates: ScoredRefuge[]): FairyRefuge | null {
  candidates.sort((a, b) => a.score - b.score);
  for (const { refuge } of candidates) {
    if (!routeRunsThroughParty(query, refuge.x, refuge.y)) return refuge;
  }
  return null;
}

/** Supportable bodies standing in `room`. */
function countSupportableIn(query: FairyRefugeQuery, room: TileRect): number {
  const ts = query.tileSize;
  const centreX = (room.x + room.w / 2) * ts;
  const centreY = (room.y + room.h / 2) * ts;
  collectMobsNear(centreX, centreY, Math.max(room.w, room.h) * ts, nearbyScratch);
  let count = 0;
  for (const mob of nearbyScratch) {
    if (!query.isSupportable(mob)) continue;
    const tile = tileOf(mob.x, mob.y, ts);
    if (isTileInRect(tile.x, tile.y, room)) count++;
  }
  nearbyScratch.length = 0;
  return count;
}

/** A walkable tile at or near a room's centre, inside the room; null when none is. */
function roomLanding(map: GameMap, centreX: number, centreY: number, room: TileRect) {
  for (let radius = 0; radius <= ROOM_LANDING_SEARCH_TILES; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const tileX = centreX + dx;
        const tileY = centreY + dy;
        if (!isTileInRect(tileX, tileY, room)) continue;
        if (!map.isWalkable(tileX, tileY) || map.isStairwellTile(tileX, tileY)) continue;
        return { x: tileX, y: tileY };
      }
    }
  }
  return null;
}

function isInBossRoom(map: GameMap, tileX: number, tileY: number): boolean {
  return map.bossRooms.some((bossRoom) => isTileInRect(tileX, tileY, bossRoom.bounds));
}

/**
 * Scores one candidate: its distance, less a large bonus when it holds bodies
 * to hide behind. Lower is better.
 */
function refugeScore(query: FairyRefugeQuery, x: number, y: number, occupied: boolean): number {
  const distance = Math.hypot(x - query.fromX, y - query.fromY);
  const occupiedBonus = occupied ? query.tileSize * FAIRY_REFUGE_OCCUPIED_BONUS_TILES : 0;
  return distance - occupiedBonus;
}

/** The best other room of a dungeon floor to run to, or null when none is in reach. */
function chooseRoomRefuge(query: FairyRefugeQuery): FairyRefuge | null {
  const { map, tileSize: ts } = query;
  const here = tileOf(query.fromX, query.fromY, ts);
  const candidates: ScoredRefuge[] = [];
  for (const point of map.mobSpawnPoints) {
    if (query.passedOver.has(point)) continue;
    const room: TileRect = {
      x: point.x - Math.floor(point.w / 2),
      y: point.y - Math.floor(point.h / 2),
      w: point.w,
      h: point.h,
    };
    if (isTileInRect(here.x, here.y, room)) continue;
    const reach = Math.max(Math.abs(point.x - here.x), Math.abs(point.y - here.y));
    if (reach > REFUGE_SEARCH_TILES) continue;
    if (isInBossRoom(map, point.x, point.y)) continue;
    const crawlerInside = query.threats.some((threat) => {
      const tile = tileOf(threat.x, threat.y, ts);
      return isTileInRect(tile.x, tile.y, room);
    });
    if (crawlerInside) continue;
    const landing = roomLanding(map, point.x, point.y, room);
    if (landing === null) continue;
    const x = landing.x * ts;
    const y = landing.y * ts;
    if (!withinSpawnLeash(query, x, y)) continue;
    const score = refugeScore(query, x, y, countSupportableIn(query, room) > 0);
    candidates.push({ refuge: { x, y, room, source: point }, score });
  }
  return bestClearRefuge(query, candidates);
}

/**
 * The best other hostile group in the open to run to, or null. A body within
 * the fairy's own ally search is not "another" group — the fairy would already
 * be supporting it — so only those beyond it count.
 */
function chooseOpenGroundRefuge(query: FairyRefugeQuery): FairyRefuge | null {
  const { map, tileSize: ts } = query;
  collectMobsNear(query.fromX, query.fromY, REFUGE_SEARCH_TILES * ts, nearbyScratch);
  const allyReachPx = FAIRY_ALLY_SEARCH_TILES * ts;
  const candidates: ScoredRefuge[] = [];
  for (const mob of nearbyScratch) {
    if (!query.isSupportable(mob) || query.passedOver.has(mob)) continue;
    if (Math.hypot(mob.x - query.fromX, mob.y - query.fromY) <= allyReachPx) continue;
    if (!withinSpawnLeash(query, mob.x, mob.y)) continue;
    const tile = tileOf(mob.x, mob.y, ts);
    if (!map.isWalkable(tile.x, tile.y) || isFairyGroundForbidden(map, tile.x, tile.y)) continue;
    const score = refugeScore(query, mob.x, mob.y, true);
    candidates.push({ refuge: { x: mob.x, y: mob.y, room: null, source: mob }, score });
  }
  nearbyScratch.length = 0;
  return bestClearRefuge(query, candidates);
}

/**
 * Where a lone fairy should run: another room on a floor built of rooms, the
 * nearest other hostile group on open ground. Null when nothing is in reach
 * that has not already failed and does not lie through the party.
 */
export function chooseFairyRefuge(query: FairyRefugeQuery): FairyRefuge | null {
  return query.map.mobSpawnPoints.length > 0
    ? chooseRoomRefuge(query)
    : chooseOpenGroundRefuge(query);
}
