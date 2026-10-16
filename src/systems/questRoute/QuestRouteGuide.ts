/**
 * Where the objective arrow should point on the way to a destination, and the
 * stretch of route a trail can be painted along.
 *
 * The destination is what the scene picked; the guide only answers how to get
 * there on the map it is handed. It keeps one {@link RouteField} toward the
 * destination, built a slice at a time into a spare buffer while the last one
 * stays in use, so a rebuild never drops the arrow back to a straight line.
 * Each tick it walks downhill from the player only when the tile the player
 * stands on, the field or the destination has changed, so a quiet frame
 * costs a cache read. The player is placed by their feet
 * ({@link crawlerGroundPoint}), never by the top of their sprite.
 *
 * It knows nothing of interiors or the overworld: whatever map it is handed is
 * the space it routes in, and a new map starts it afresh.
 */

import { TILE_SIZE } from '../../core/constants';
import type { GameMap } from '../../map/GameMap';
import { tileCoordKey, tileIndex } from '../../map/tileIndex';
import type { TilePoint } from '../../map/town/townPlan';
import type { TrackerTarget } from '../questTracker';
import {
  downhillChain,
  goalTilesForTarget,
  RouteFieldBuilder,
  routeFieldBuffers,
  type RouteField,
} from './routeField';
import { firstPortalOnChain, routePortals } from './routePortals';
import { standingTileCandidates, type GroundPoint } from './routeOrigin';
import { TrailShaper, type TrailShape } from './trailShape';

/**
 * Tiles priced per update tick while a field builds. Measured headless on a
 * full overworld at about a third of a millisecond per thousand, so a build
 * finishes in well under half a second without costing a frame.
 */
export const QUEST_ROUTE_EXPANSIONS_PER_FRAME = 3000;
/** Longest downhill walk taken from the player, in tiles: longer than any overworld route. */
export const QUEST_ROUTE_CHAIN_MAX_TILES = 600;
/** How much of the route the trail covers, in tiles: about one screen ahead. */
export const QUEST_TRAIL_MAX_TILES = 40;
/**
 * Route tiles nearest the player that are not searched for a gate, so a party
 * standing in a gate is already aimed past it.
 */
export const QUEST_ROUTE_PORTAL_UNDERFOOT_STEPS = 3;
/** How far a character target walks, in tiles, before the field is rebuilt toward where it now is. */
export const QUEST_ROUTE_MOVING_TARGET_REBUILD_TILES = 4;
/** The fewest ticks between two rebuilds that chase a walking character. */
export const QUEST_ROUTE_MIN_REBUILD_FRAMES = 60;
/**
 * Ticks between rebuilds of an unchanged destination, so a door that has
 * opened or a wall built or breached since is routed round within a few
 * seconds without every map mutation having to announce itself.
 */
export const QUEST_ROUTE_REFRESH_FRAMES = 300;
/**
 * A character target that has moved this far since the field was built is
 * somewhere else entirely (a different step's person), not a walk: the old
 * field is dropped at once rather than chased.
 */
const QUEST_ROUTE_TARGET_JUMP_TILES = 24;

const TILE_CENTRE = 0.5;

interface PixelPoint {
  readonly x: number;
  readonly y: number;
}

interface Destination {
  /** Identifies the goal tiles: a change means a different place to route to. */
  readonly key: string;
  readonly tile: TilePoint;
  /** Set for a character, which walks: its field is rebuilt by distance and time, not on every step. */
  readonly moves: boolean;
  readonly centrePx: PixelPoint;
  readonly goals: () => readonly TilePoint[];
}

interface FieldInUse {
  readonly field: RouteField;
  readonly key: string;
  readonly builtToward: TilePoint;
}

interface Build {
  readonly builder: RouteFieldBuilder;
  readonly buffers: RouteField;
  readonly key: string;
  readonly toward: TilePoint;
}

function tileCentrePx(tile: TilePoint): PixelPoint {
  return { x: (tile.x + TILE_CENTRE) * TILE_SIZE, y: (tile.y + TILE_CENTRE) * TILE_SIZE };
}

function targetDestination(gameMap: GameMap, target: TrackerTarget): Destination {
  const width = target.widthTiles ?? 1;
  return {
    key: `${target.x},${target.y},${width}`,
    tile: { x: target.x, y: target.y },
    moves: target.wearsOwnMarker === true,
    centrePx: {
      x: (target.x + width * TILE_CENTRE) * TILE_SIZE,
      y: (target.y + TILE_CENTRE) * TILE_SIZE,
    },
    goals: () => goalTilesForTarget(gameMap, target),
  };
}

function tilesDestination(goals: readonly TilePoint[]): Destination | null {
  if (goals.length === 0) return null;
  const middle = goals[Math.floor(goals.length * TILE_CENTRE)];
  return {
    key: goals.map((tile) => tileCoordKey(tile.x, tile.y)).join(','),
    tile: middle,
    moves: false,
    centrePx: tileCentrePx(middle),
    goals: () => goals,
  };
}

export class QuestRouteGuide {
  private map: GameMap | null = null;
  private inUse: FieldInUse | null = null;
  private build: Build | null = null;
  /** Buffer sets free for the next build; one is held whenever a field is in use and none is building. */
  private readonly spares: RouteField[] = [];
  private ticksSinceBuildStarted = 0;
  private fieldStamp = 0;
  private chainBlocked = false;

  private cachedFor: { player: number; stamp: number; key: string } | null = null;
  private cachedAim: PixelPoint | null = null;
  private cachedTrail: readonly TilePoint[] = [];
  private readonly shaper = new TrailShaper();

  /**
   * Once per update tick on the overworld or a dungeon floor: routes toward
   * `target` on `gameMap`, or lets everything go when `target` is null.
   */
  update(gameMap: GameMap, ground: GroundPoint, target: TrackerTarget | null): void {
    if (target === null) {
      this.release();
      return;
    }
    this.advance(
      gameMap,
      ground,
      targetDestination(gameMap, target),
      QUEST_ROUTE_EXPANSIONS_PER_FRAME,
    );
  }

  /**
   * Once per update tick toward a set of tiles rather than a Journal target,
   * built whole on the tick it is needed: for a room small enough that a
   * field costs nothing, where the way out is the destination.
   */
  updateToTiles(gameMap: GameMap, ground: GroundPoint, goals: readonly TilePoint[]): void {
    const destination = tilesDestination(goals);
    if (destination === null) {
      this.release();
      return;
    }
    this.advance(gameMap, ground, destination, Infinity);
  }

  /**
   * The world-pixel point the arrow should face: the first wall gate on the
   * route, or the destination itself. Straight at the destination while no
   * route is known, so the arrow never vanishes for want of one; null only
   * when there is no destination.
   */
  aim(): PixelPoint | null {
    return this.cachedAim;
  }

  /**
   * The route's first {@link QUEST_TRAIL_MAX_TILES} tiles from the player,
   * the tile they stand on first; empty when no route is known.
   */
  trail(): readonly TilePoint[] {
    return this.cachedTrail;
  }

  /**
   * The trail to paint this frame, its head at `ground` (the feet the route
   * was last updated from, or wherever they have moved to since); null when
   * there is none.
   */
  trailShape(ground: GroundPoint): TrailShape | null {
    const gameMap = this.map;
    if (gameMap === null || this.cachedTrail.length < 2) return null;
    this.shaper.setWalk(gameMap, this.cachedTrail);
    return this.shaper.shape(ground);
  }

  dispose(): void {
    this.release();
  }

  private release(): void {
    this.map = null;
    this.inUse = null;
    this.build = null;
    this.spares.length = 0;
    this.cachedFor = null;
    this.cachedAim = null;
    this.cachedTrail = [];
    this.shaper.clear();
    this.chainBlocked = false;
  }

  private advance(
    gameMap: GameMap,
    ground: GroundPoint,
    destination: Destination,
    budget: number,
  ): void {
    if (gameMap !== this.map) {
      this.map = gameMap;
      this.inUse = null;
      this.build = null;
      this.fieldStamp++;
    }
    this.ticksSinceBuildStarted++;
    if (this.needsBuild(destination)) this.startBuild(gameMap, destination);
    this.stepBuild(budget);
    this.refreshRoute(gameMap, this.standingTile(ground), destination);
  }

  private needsBuild(destination: Destination): boolean {
    if (this.build === null && this.inUse === null) return true;
    const latestKey = this.build?.key ?? this.inUse?.key;
    const latestToward = this.build?.toward ?? this.inUse?.builtToward ?? destination.tile;
    const refreshDue =
      this.build === null && this.ticksSinceBuildStarted >= QUEST_ROUTE_REFRESH_FRAMES;
    const blocked = this.chainBlocked;
    this.chainBlocked = false;
    if (latestKey !== destination.key) {
      if (!destination.moves) {
        this.dropFieldInUse();
        return true;
      }
      const moved = Math.hypot(
        destination.tile.x - latestToward.x,
        destination.tile.y - latestToward.y,
      );
      if (moved >= QUEST_ROUTE_TARGET_JUMP_TILES) {
        this.dropFieldInUse();
        return true;
      }
      const chaseDue =
        moved >= QUEST_ROUTE_MOVING_TARGET_REBUILD_TILES &&
        this.ticksSinceBuildStarted >= QUEST_ROUTE_MIN_REBUILD_FRAMES;
      return chaseDue || blocked || refreshDue;
    }
    return blocked || refreshDue;
  }

  /** The field in use routes somewhere else: no route at all beats a wrong one. */
  private dropFieldInUse(): void {
    if (this.inUse === null) return;
    this.spares.push(this.inUse.field);
    this.inUse = null;
    this.fieldStamp++;
  }

  private startBuild(gameMap: GameMap, destination: Destination): void {
    const reuse = this.build?.buffers ?? this.spares.pop() ?? null;
    const buffers = routeFieldBuffers(gameMap, reuse);
    this.build = {
      builder: new RouteFieldBuilder(gameMap, destination.goals(), buffers),
      buffers,
      key: destination.key,
      toward: destination.tile,
    };
    this.ticksSinceBuildStarted = 0;
  }

  private stepBuild(budget: number): void {
    const build = this.build;
    if (build?.builder.step(budget) !== true) return;
    const field = build.builder.result();
    if (field === null) return;
    if (this.inUse !== null) this.spares.push(this.inUse.field);
    this.inUse = { field, key: build.key, builtToward: build.toward };
    this.build = null;
    this.fieldStamp++;
  }

  /**
   * The tile the route starts from: the first of the feet's
   * {@link standingTileCandidates} the field reaches, else the tile under
   * the soles, which {@link downhillChain} searches round.
   */
  private standingTile(ground: GroundPoint): TilePoint {
    const candidates = standingTileCandidates(ground);
    const field = this.inUse?.field ?? null;
    if (field === null) return candidates[0];
    const reached = candidates.find((tile) => routeCost(field, tile) < Infinity);
    return reached ?? candidates[0];
  }

  private refreshRoute(gameMap: GameMap, playerTile: TilePoint, destination: Destination): void {
    const player = tileCoordKey(playerTile.x, playerTile.y);
    const cached = this.cachedFor;
    if (
      cached?.player === player &&
      cached.stamp === this.fieldStamp &&
      cached.key === destination.key
    ) {
      return;
    }
    this.cachedFor = { player, stamp: this.fieldStamp, key: destination.key };

    if (destination.moves && this.hasStraightWalkTo(gameMap, playerTile, destination)) {
      this.cachedAim = destination.centrePx;
      this.cachedTrail = [playerTile, destination.tile];
      return;
    }

    const field = this.inUse?.field ?? null;
    const chain =
      field === null ? [] : downhillChain(field, gameMap, playerTile, QUEST_ROUTE_CHAIN_MAX_TILES);
    const goalKeys = field?.goalKeys ?? new Set<number>();
    const crossesNewWall = chain.some(
      (tile) => !goalKeys.has(tileCoordKey(tile.x, tile.y)) && !gameMap.isWalkable(tile.x, tile.y),
    );
    // Raised only between builds: a walking player sees the blocked tile on
    // every step, and restarting the build each time would never let the
    // field that routes round it land.
    if (crossesNewWall && this.build === null) this.chainBlocked = true;
    const portal = firstPortalOnChain(
      chain,
      routePortals(gameMap),
      QUEST_ROUTE_PORTAL_UNDERFOOT_STEPS,
    );
    this.cachedAim = portal === null ? destination.centrePx : tileCentrePx(portal.centre);
    this.cachedTrail = trailAlong(chain);
  }

  private hasStraightWalkTo(
    gameMap: GameMap,
    playerTile: TilePoint,
    destination: Destination,
  ): boolean {
    const from = tileCentrePx(playerTile);
    return gameMap.hasWalkableLine(from.x, from.y, destination.centrePx.x, destination.centrePx.y);
  }
}

/** The first {@link QUEST_TRAIL_MAX_TILES} of `chain`. */
function trailAlong(chain: readonly TilePoint[]): readonly TilePoint[] {
  if (chain.length < 2) return [];
  return chain.slice(0, QUEST_TRAIL_MAX_TILES + 1);
}

/** The field's price of walking on from `tile`; `Infinity` off the map or where the field never reached. */
function routeCost(field: RouteField, tile: TilePoint): number {
  const inside = tile.x >= 0 && tile.y >= 0 && tile.x < field.columns && tile.y < field.rows;
  return inside ? field.cost[tileIndex(tile.x, tile.y, field.columns)] : Infinity;
}
