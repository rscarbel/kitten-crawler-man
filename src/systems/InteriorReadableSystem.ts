/**
 * Puts a building's readables (see `townReadables.ts`) on real furniture.
 *
 * Anchors are *derived* from the generated interior exactly as
 * `InteriorOccupantSystem`'s are: the system scans the finished grid for
 * shelves, tables and crates and sits each authored piece on one of them, so
 * re-arranging a room moves the reading along with the furniture. A readable
 * whose preferred furniture is missing falls back to any other, because a room
 * without a bookshelf should still hold its letter.
 *
 * Owned by `BuildingInteriorScene`, which shows the prompt and drives the panel.
 */

import { TILE_SIZE } from '../core/constants';
import type { GameMap } from '../map/GameMap';
import { BOOKSHELF, TABLE, CRATE, BARREL } from '../map/tileTypes';
import { readablesFor, type Readable, type ReadableAnchor } from './townReadables';

/** The furniture tile types each anchor kind can sit on, in preference order. */
const ANCHOR_TILE_TYPES: ReadonlyArray<{ kind: ReadableAnchor; types: ReadonlyArray<number> }> = [
  { kind: 'shelf', types: [BOOKSHELF] },
  { kind: 'table', types: [TABLE] },
  { kind: 'crate', types: [CRATE, BARREL] },
];

/** A readable within this range of the player shows a Read prompt / is readable. */
const READ_RADIUS_TILES = 1.4;
const READ_RADIUS = TILE_SIZE * READ_RADIUS_TILES;

interface TileXY {
  x: number;
  y: number;
}

/**
 * One authored readable, resolved onto a tile of this room. `x`/`y` are the
 * furniture tile's world-pixel origin, matching how every other interactable in
 * the scene reports its position to `drawInteractionPrompt`.
 */
export interface PlacedReadable {
  readonly readable: Readable;
  readonly x: number;
  readonly y: number;
}

/**
 * Deliberately not a `GameSystem`: a readable never moves and never animates, so
 * there is nothing to tick. It is placed once at construction and then only
 * queried.
 */
export class InteriorReadableSystem {
  private readonly placed: PlacedReadable[] = [];
  /** Tiles this room's readables already sit on, so two can never share one. */
  private readonly usedTiles = new Set<string>();

  /**
   * Builds the readable system for a building, or `null` when nothing was
   * authored for it or nothing could be placed.
   */
  static forBuilding(
    map: GameMap,
    name: string,
    occupiedFurniture: ReadonlySet<string>,
  ): InteriorReadableSystem | null {
    const readables = readablesFor(name);
    if (readables.length === 0) return null;
    const system = new InteriorReadableSystem(map, readables, occupiedFurniture);
    return system.placed.length > 0 ? system : null;
  }

  private constructor(
    map: GameMap,
    readables: ReadonlyArray<Readable>,
    occupiedFurniture: ReadonlySet<string>,
  ) {
    const furniture = scanFurniture(map);
    // Two passes, and the order is the whole point.
    //
    // The first avoids the occupants' furniture, because a book on the shelf
    // somebody is browsing can never be read — the same press talks to them
    // instead. The second gives up that preference rather than the readable: a
    // small room where every table is taken would otherwise drop its letter
    // silently, and a letter that is sometimes hard to reach still beats a
    // building with nothing in it. Occupants drift within their wander radius,
    // so "hard to reach" is not the same as "never".
    const stillLooking: Readable[] = [];
    for (const readable of readables) {
      if (!this.tryPlace(readable, furniture, occupiedFurniture)) stillLooking.push(readable);
    }
    // The fallback pass blocks nothing but the tiles this room's own readables
    // have already taken.
    const nothingBlocked: ReadonlySet<string> = new Set();
    for (const readable of stillLooking) this.tryPlace(readable, furniture, nothingBlocked);
  }

  /**
   * Sits `readable` on the first furniture tile that is in neither `blocked` nor
   * this room's already-used tiles. Returns whether it found a home.
   */
  private tryPlace(
    readable: Readable,
    furniture: ReadonlyMap<ReadableAnchor, TileXY[]>,
    blocked: ReadonlySet<string>,
  ): boolean {
    const tile = pickTile(readable.anchor, furniture, union(blocked, this.usedTiles));
    if (tile === null) return false;
    this.usedTiles.add(tileKey(tile.x, tile.y));
    this.placed.push({ readable, x: tile.x * TILE_SIZE, y: tile.y * TILE_SIZE });
    return true;
  }

  /** How many of this room's authored readables actually found furniture. */
  get placedCount(): number {
    return this.placed.length;
  }

  /** The nearest readable the player (at world origin `x`,`y`) can reach, or `null`. */
  findReadTarget(x: number, y: number): PlacedReadable | null {
    let best: PlacedReadable | null = null;
    let bestDistance = READ_RADIUS;
    for (const candidate of this.placed) {
      const distance = Math.hypot(candidate.x - x, candidate.y - y);
      if (distance > bestDistance) continue;
      best = candidate;
      bestDistance = distance;
    }
    return best;
  }
}

/** Group every interior furniture tile by the anchor kind it can host. */
function scanFurniture(map: GameMap): Map<ReadableAnchor, TileXY[]> {
  const groups = new Map<ReadableAnchor, TileXY[]>();
  const structure = map.structure;
  for (let y = 1; y < structure.length - 1; y++) {
    const row = structure[y];
    for (let x = 1; x < row.length - 1; x++) {
      const type = row[x].type;
      for (const { kind, types } of ANCHOR_TILE_TYPES) {
        if (!types.includes(type)) continue;
        const list = groups.get(kind) ?? [];
        list.push({ x, y });
        groups.set(kind, list);
      }
    }
  }
  return groups;
}

/** The preferred anchor's first free tile, else any other kind's. */
function pickTile(
  preferred: ReadableAnchor,
  furniture: ReadonlyMap<ReadableAnchor, TileXY[]>,
  usedTiles: ReadonlySet<string>,
): TileXY | null {
  const order: ReadableAnchor[] = [preferred];
  for (const { kind } of ANCHOR_TILE_TYPES) {
    if (kind !== preferred) order.push(kind);
  }
  for (const kind of order) {
    const tiles = furniture.get(kind);
    if (tiles === undefined) continue;
    for (const tile of tiles) {
      if (!usedTiles.has(tileKey(tile.x, tile.y))) return tile;
    }
  }
  return null;
}

function tileKey(tx: number, ty: number): string {
  return `${tx},${ty}`;
}

function union(a: ReadonlySet<string>, b: ReadonlySet<string>): ReadonlySet<string> {
  if (a.size === 0) return b;
  if (b.size === 0) return a;
  const merged = new Set(a);
  for (const key of b) merged.add(key);
  return merged;
}
