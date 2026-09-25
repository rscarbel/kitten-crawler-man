/**
 * Where a trebuchet or a snare may go, and whether putting one there would
 * trap anybody.
 *
 * A footprint is always placed directly in front of the builder, along the
 * four-way facing the tile grid snaps to. Every footprint tile must be open
 * outdoor ground away from doors, the gate and the palisade, with nothing
 * else built on it. A trebuchet also blocks movement, so before one goes up
 * every body standing where it will stand must have somewhere to be pushed
 * that still reaches the builder, and the ground round it must stay connected
 * — a trebuchet may never seal a doorway, a gap in the wall or the approach
 * to the gate.
 */

import type { GameMap } from '../../map/GameMap';
import type { BriarHollowSite } from '../../map/overworld/briarHollowSite';
import {
  HOLLOW_GATE,
  HOLLOW_PALISADE,
  HOLLOW_PALISADE_GAP,
  HOLLOW_THRESHOLD,
} from '../../map/tileTypes';
import { TILE_SIZE } from '../../core/constants';
import { tileCoordKey } from '../../map/tileIndex';
import type { DefenseStructures, TileFootprint } from './DefenseStructures';
import { TREBUCHET_HEIGHT_TILES, TREBUCHET_WIDTH_TILES } from './structureRules';

/** A body a push-out may have to move: anything standing in the world with a top-left position. */
export interface PlacementBody {
  readonly x: number;
  readonly y: number;
  /**
   * Whether the body will let itself be set down with its top-left at this
   * world pixel. Absent means anywhere open; livestock refuse to leave their pen.
   */
  readonly accepts?: (x: number, y: number) => boolean;
}

/** No footprint tile may be this close to any doorway. */
export const DOORWAY_CLEARANCE_TILES = 2;
/** How far a body may be pushed to clear a trebuchet's footprint. */
export const PUSH_SEARCH_TILES = 3;
/** How far round the builder the trap checks flood before calling ground "cut off". */
export const TRAP_CHECK_RADIUS_TILES = 16;

/** The one refusal every placement failure shows, word for word. */
export const NO_SPACE_MESSAGE = "There isn't enough space to construct that here.";

export type Facing = 'north' | 'east' | 'south' | 'west';

/** The four-way facing the tile grid snaps a crawler's facing to. */
export function snapFacing(facingX: number, facingY: number): Facing {
  if (Math.abs(facingX) >= Math.abs(facingY)) return facingX >= 0 ? 'east' : 'west';
  return facingY >= 0 ? 'south' : 'north';
}

export const FACING_STEP: Readonly<Record<Facing, { readonly dx: number; readonly dy: number }>> = {
  north: { dx: 0, dy: -1 },
  east: { dx: 1, dy: 0 },
  south: { dx: 0, dy: 1 },
  west: { dx: -1, dy: 0 },
};

/** The tile a body's centre stands on. */
export function bodyTile(body: PlacementBody): { x: number; y: number } {
  return {
    x: Math.floor((body.x + TILE_SIZE / 2) / TILE_SIZE),
    y: Math.floor((body.y + TILE_SIZE / 2) / TILE_SIZE),
  };
}

/** A body's footing, inset from its tile-sized box, for "is anybody standing here". */
const BODY_FOOTING_INSET = 0.25;

/** Whether a body's footing overlaps a footprint. */
export function bodyOverlaps(body: PlacementBody, footprint: TileFootprint): boolean {
  const inset = TILE_SIZE * BODY_FOOTING_INSET;
  const left = body.x + inset;
  const right = body.x + TILE_SIZE - inset;
  const top = body.y + inset;
  const bottom = body.y + TILE_SIZE - inset;
  const fLeft = footprint.x * TILE_SIZE;
  const fTop = footprint.y * TILE_SIZE;
  const fRight = fLeft + footprint.w * TILE_SIZE;
  const fBottom = fTop + footprint.h * TILE_SIZE;
  return left < fRight && right > fLeft && top < fBottom && bottom > fTop;
}

function inFootprint(footprint: TileFootprint, x: number, y: number): boolean {
  return (
    x >= footprint.x &&
    y >= footprint.y &&
    x < footprint.x + footprint.w &&
    y < footprint.y + footprint.h
  );
}

/**
 * Trebuchet footprints to try for a builder on (tileX, tileY) facing
 * `facing`, best first: centred on the facing axis with its near edge on the
 * adjacent row or column, then shifted a tile to either side. The art does
 * not rotate, so the rectangle keeps its two-wide, three-deep shape.
 */
export function trebuchetCandidates(tileX: number, tileY: number, facing: Facing): TileFootprint[] {
  const w = TREBUCHET_WIDTH_TILES;
  const h = TREBUCHET_HEIGHT_TILES;
  const vertical = facing === 'north' || facing === 'south';
  const candidates: TileFootprint[] = [];
  if (vertical) {
    const y = facing === 'south' ? tileY + 1 : tileY - h;
    const centredX = tileX - Math.floor((w - 1) / 2);
    for (const shift of [0, 1, -1]) candidates.push({ x: centredX + shift, y, w, h });
    return candidates;
  }
  const x = facing === 'east' ? tileX + 1 : tileX - w;
  const centredY = tileY - Math.floor((h - 1) / 2);
  for (const shift of [0, 1, -1]) candidates.push({ x, y: centredY + shift, w, h });
  return candidates;
}

/** The snare tile for a builder on (tileX, tileY) facing `facing`. */
export function snareFootprint(tileX: number, tileY: number, facing: Facing): TileFootprint {
  const step = FACING_STEP[facing];
  return { x: tileX + step.dx, y: tileY + step.dy, w: 1, h: 1 };
}

export interface PlacementWorld {
  readonly gameMap: GameMap;
  readonly site: BriarHollowSite | null;
  readonly defense: DefenseStructures | null;
  /** Tiles villagers are anchored to (a service NPC's post), by `tileCoordKey`. */
  readonly anchorTiles: ReadonlySet<number>;
}

/** Every doorway on the map a footprint must keep clear of: town doors, village doorways, the quarry hut. */
export function doorwayTiles(
  gameMap: GameMap,
  site: BriarHollowSite | null,
): Array<{ x: number; y: number }> {
  const doors: Array<{ x: number; y: number }> = gameMap.buildingEntries.map(
    (entry) => entry.doorTile,
  );
  if (site !== null) {
    for (const building of site.buildings) doors.push(...building.doorways);
    doors.push(site.quarry.hutDoor);
  }
  return doors;
}

/** Villager anchor tiles, keyed, for the "not on a service NPC's post" rule. */
export function villagerAnchorKeys(site: BriarHollowSite | null): Set<number> {
  const keys = new Set<number>();
  if (site === null) return keys;
  for (const anchors of Object.values(site.villagerAnchors)) {
    for (const tile of anchors) keys.add(tileCoordKey(tile.x, tile.y));
  }
  for (const building of site.buildings) {
    for (const tile of building.occupantAnchors) keys.add(tileCoordKey(tile.x, tile.y));
  }
  return keys;
}

/**
 * Why a single tile cannot hold a construction, or null when it can.
 * Checks everything that is a property of the tile itself; bodies and the
 * trap checks are the caller's.
 */
export function tileRefusal(
  world: PlacementWorld,
  doors: ReadonlyArray<{ x: number; y: number }>,
  tileX: number,
  tileY: number,
  forTrebuchet: boolean,
): string | null {
  const { gameMap, defense } = world;
  if (gameMap.isTileInsideTownWall(tileX, tileY)) return 'inside the town wall';
  if (!gameMap.isWalkable(tileX, tileY)) return 'blocked';
  if (gameMap.isWadeable(tileX, tileY)) return 'water';
  const type = gameMap.structure[tileY]?.[tileX]?.type;
  if (type === HOLLOW_THRESHOLD) return 'a doorway';
  if (type === HOLLOW_GATE || type === HOLLOW_PALISADE || type === HOLLOW_PALISADE_GAP)
    return 'the palisade';
  if (defense !== null) {
    if (defense.segmentAtTile(tileX, tileY) !== null || defense.isGateTile(tileX, tileY))
      return 'the palisade';
    if (defense.at(tileX, tileY) !== null || defense.isReserved(tileX, tileY))
      return 'already built on';
  }
  for (const door of doors) {
    const near =
      Math.max(Math.abs(door.x - tileX), Math.abs(door.y - tileY)) <= DOORWAY_CLEARANCE_TILES;
    if (near) return 'too close to a doorway';
  }
  if (forTrebuchet && world.anchorTiles.has(tileCoordKey(tileX, tileY))) return "a villager's post";
  return null;
}

/** Whether every tile of a footprint passes {@link tileRefusal}. */
export function footprintTilesValid(
  world: PlacementWorld,
  footprint: TileFootprint,
  forTrebuchet: boolean,
): boolean {
  const doors = doorwayTiles(world.gameMap, world.site);
  for (let dy = 0; dy < footprint.h; dy++) {
    for (let dx = 0; dx < footprint.w; dx++) {
      if (tileRefusal(world, doors, footprint.x + dx, footprint.y + dy, forTrebuchet) !== null)
        return false;
    }
  }
  return true;
}

// ── Flood fills ─────────────────────────────────────────────────────────────

/**
 * Tiles reachable from `start` over walkable ground with `blocked` treated as
 * walls, four-connected, never further than `radius` tiles (Chebyshev) from
 * `centre`. Returned as `tileCoordKey`s.
 */
function floodFrom(
  gameMap: GameMap,
  start: { x: number; y: number },
  blocked: TileFootprint,
  centre: { x: number; y: number },
  radius: number,
): Set<number> {
  const reached = new Set<number>();
  const open = (x: number, y: number): boolean =>
    Math.max(Math.abs(x - centre.x), Math.abs(y - centre.y)) <= radius &&
    !inFootprint(blocked, x, y) &&
    gameMap.isWalkable(x, y);
  if (!open(start.x, start.y)) return reached;
  const queue: Array<{ x: number; y: number }> = [start];
  reached.add(tileCoordKey(start.x, start.y));
  // A for-of over an array visits what is pushed onto it mid-loop, which is the flood.
  for (const current of queue) {
    for (const step of Object.values(FACING_STEP)) {
      const nx = current.x + step.dx;
      const ny = current.y + step.dy;
      const key = tileCoordKey(nx, ny);
      if (reached.has(key) || !open(nx, ny)) continue;
      reached.add(key);
      queue.push({ x: nx, y: ny });
    }
  }
  return reached;
}

/**
 * The nearest tile outside `footprint` a body on `from` can be pushed to —
 * walkable, within {@link PUSH_SEARCH_TILES}, and still connected to the
 * builder with the footprint walled off — or null when there is none.
 */
export function pushOutTile(
  gameMap: GameMap,
  from: { x: number; y: number },
  footprint: TileFootprint,
  builderTile: { x: number; y: number },
  accepts: (tileX: number, tileY: number) => boolean = () => true,
): { x: number; y: number } | null {
  const reachesBuilder = floodFrom(
    gameMap,
    builderTile,
    footprint,
    builderTile,
    TRAP_CHECK_RADIUS_TILES,
  );
  const seen = new Set<number>([tileCoordKey(from.x, from.y)]);
  const queue: Array<{ x: number; y: number; d: number }> = [{ ...from, d: 0 }];
  for (const current of queue) {
    const outside = !inFootprint(footprint, current.x, current.y);
    const fits = outside && reachesBuilder.has(tileCoordKey(current.x, current.y));
    if (fits && accepts(current.x, current.y)) {
      return { x: current.x, y: current.y };
    }
    if (current.d >= PUSH_SEARCH_TILES) continue;
    for (const step of Object.values(FACING_STEP)) {
      const nx = current.x + step.dx;
      const ny = current.y + step.dy;
      const key = tileCoordKey(nx, ny);
      if (seen.has(key)) continue;
      seen.add(key);
      // A body inside the footprint crosses it on its way out; outside it, only open ground counts.
      if (!inFootprint(footprint, nx, ny) && !gameMap.isWalkable(nx, ny)) continue;
      queue.push({ x: nx, y: ny, d: current.d + 1 });
    }
  }
  return null;
}

/**
 * Whether walling off `footprint` keeps every walkable tile round it
 * connected to every other one within the check radius: the test that stops a
 * trebuchet sealing a corridor, a doorway, a gap in the palisade or the gate.
 */
export function corridorStaysOpen(
  gameMap: GameMap,
  footprint: TileFootprint,
  builderTile: { x: number; y: number },
): boolean {
  const ring: Array<{ x: number; y: number }> = [];
  for (let y = footprint.y - 1; y <= footprint.y + footprint.h; y++) {
    for (let x = footprint.x - 1; x <= footprint.x + footprint.w; x++) {
      if (inFootprint(footprint, x, y)) continue;
      if (gameMap.isWalkable(x, y)) ring.push({ x, y });
    }
  }
  if (ring.length === 0) return true;
  const first = ring[0];
  const reached = floodFrom(gameMap, first, footprint, builderTile, TRAP_CHECK_RADIUS_TILES);
  return ring.every((tile) => reached.has(tileCoordKey(tile.x, tile.y)));
}

export interface PushOut<B extends PlacementBody> {
  readonly body: B;
  readonly to: { x: number; y: number };
}

/**
 * The whole trebuchet check, run when a build starts: every body in the way
 * has a push-out tile that still reaches the builder, and the footprint
 * seals nothing. Returns the pushes to make, or null when the build must be
 * refused.
 */
export function planTrebuchetPushOut<B extends PlacementBody>(
  gameMap: GameMap,
  footprint: TileFootprint,
  builderTile: { x: number; y: number },
  bodies: ReadonlyArray<B>,
  options: { skipCorridorCheck?: boolean } = {},
): Array<PushOut<B>> | null {
  if (inFootprint(footprint, builderTile.x, builderTile.y)) return null;
  const pushes: Array<PushOut<B>> = [];
  for (const body of bodies) {
    if (!bodyOverlaps(body, footprint)) continue;
    const accepts = body.accepts;
    const to = pushOutTile(
      gameMap,
      bodyTile(body),
      footprint,
      builderTile,
      accepts === undefined
        ? undefined
        : (tileX, tileY) => accepts(tileX * TILE_SIZE, tileY * TILE_SIZE),
    );
    if (to === null) return null;
    pushes.push({ body, to });
  }
  if (options.skipCorridorCheck !== true && !corridorStaysOpen(gameMap, footprint, builderTile)) {
    return null;
  }
  return pushes;
}
