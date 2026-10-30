/**
 * The curve a route trail is painted along: a tile walk pulled taut where the
 * ground allows, its corners rounded, and resampled at an even spacing so a
 * painter can place marks by distance along it.
 *
 * The taut path is worked out once per walk. The head, where the trail meets
 * the body it leads, is reshaped every frame from wherever the feet are, so
 * the trail never lags a step behind them and never starts by doubling back
 * to the middle of a tile the body has already walked past.
 *
 * Every piece is checked against the map: a straight run must be walkable
 * along its edges as well as its middle, and a rounded corner that would
 * clip a wall is tightened, and at worst left sharp.
 */

import type { MobilityClass } from '../../map/mobility';
import { TILE_SIZE } from '../../core/constants';
import type { GameMap } from '../../map/GameMap';
import { tileCoordKey } from '../../map/tileIndex';
import type { TilePoint } from '../../map/town/townPlan';
import { doorwayKeys } from '../doorwayTiles';
import type { GroundPoint } from './routeOrigin';

/** What a trail reads of the map it is shaped on. */
export type TrailGround = Pick<
  GameMap,
  'isWalkable' | 'isWadeable' | 'isStairwellTile' | 'buildingEntries'
>;

/** Distance between two neighbouring points of a shaped trail, in pixels. */
export const TRAIL_SAMPLE_SPACING_PX = 4;
/** How far a taut run may stray from the walk it replaces, in tiles: the walk's road stays the trail's road. */
const PULL_MAX_DEVIATION_TILES = 1.25;
/** The longest taut run, in tiles. */
const PULL_MAX_SPAN_TILES = 14;
/**
 * How far either side of a taut run's middle must also be open ground, in
 * tiles: under half a tile, so a one-tile corridor still takes a run down
 * its middle, and enough that no run grazes a wall corner.
 */
const PULL_CLEARANCE_TILES = 0.3;
const PULL_CLEARANCE_PX = TILE_SIZE * PULL_CLEARANCE_TILES;
/** How many of the taut path's first points the head may skip ahead to when it can see them. */
const HEAD_LOOKAHEAD_POINTS = 3;
/** Shorter than this, the step from the feet to the route is folded into the route itself. */
const HEAD_JOIN_MIN_PX = 2;
/** The longest straight stretch a rounded corner eats into on either side, in tiles. */
const CORNER_TANGENT_TILES = 2.5;
const CORNER_TANGENT_PX = TILE_SIZE * CORNER_TANGENT_TILES;
/** A corner may use at most this share of either run beside it, so neighbouring corners never overlap. */
const CORNER_SHARE_OF_RUN = 0.5;
/** How many times a corner that clips a wall is tightened before it is left sharp. */
const CORNER_TIGHTEN_TRIES = 3;
const CORNER_TIGHTEN_FACTOR = 0.5;
/** A corner's curve is checked against the map this often along its length. */
const CORNER_CHECK_POINTS = 8;
/** The taut path moving further than this off the last one is a different way, not a step along it, in tiles. */
const ROUTE_CHANGE_TILES = 2;
/** Of the taut path, the points nearest the body, which shift on every step and say nothing about the way ahead. */
const ROUTE_CHANGE_SKIPPED_POINTS = 2;

const TILE_CENTRE = 0.5;
const XY = 2;

/** A trail ready to paint. Its buffers belong to the shaper and are rewritten by the next call. */
export interface TrailShape {
  /**
   * World-pixel points, x then y, one every {@link TRAIL_SAMPLE_SPACING_PX}
   * along the trail from its head; the last may sit closer to the one before.
   */
  readonly points: Float32Array;
  /** How many points of {@link points} are in use. */
  readonly count: number;
  /** The trail's whole length, in pixels. */
  readonly length: number;
  /** Changes when the route ahead takes a different way; stays put while the body walks along it. */
  readonly routeId: number;
}

/** A growable list of x,y pairs that keeps its storage between uses. */
class PointBuffer {
  data = new Float32Array(0);
  count = 0;

  clear(): void {
    this.count = 0;
  }

  push(x: number, y: number): void {
    const needed = (this.count + 1) * XY;
    if (needed > this.data.length) {
      const grown = new Float32Array(Math.max(needed, this.data.length * XY));
      grown.set(this.data);
      this.data = grown;
    }
    this.data[this.count * XY] = x;
    this.data[this.count * XY + 1] = y;
    this.count++;
  }

  x(index: number): number {
    return this.data[index * XY];
  }

  y(index: number): number {
    return this.data[index * XY + 1];
  }
}

function tileCentreX(tile: TilePoint): number {
  return (tile.x + TILE_CENTRE) * TILE_SIZE;
}

function tileCentreY(tile: TilePoint): number {
  return (tile.y + TILE_CENTRE) * TILE_SIZE;
}

/** Distance in pixels from (px, py) to the segment (ax, ay)–(bx, by). */
function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abX = bx - ax;
  const abY = by - ay;
  const lengthSq = abX * abX + abY * abY;
  const along =
    lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * abX + (py - ay) * abY) / lengthSq));
  return Math.hypot(px - (ax + abX * along), py - (ay + abY * along));
}

function distanceToPolyline(px: number, py: number, line: PointBuffer): number {
  if (line.count === 1) return Math.hypot(px - line.x(0), py - line.y(0));
  let nearest = Infinity;
  for (let index = 1; index < line.count; index++) {
    nearest = Math.min(
      nearest,
      distanceToSegment(px, py, line.x(index - 1), line.y(index - 1), line.x(index), line.y(index)),
    );
  }
  return nearest;
}

function sameWalk(a: readonly TilePoint[], b: readonly TilePoint[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) {
    if (a[index].x !== b[index].x || a[index].y !== b[index].y) return false;
  }
  return true;
}

/** The point `distancePx` along `shape`, written into `out`; clamped to the trail's ends. */
export function trailPointAt(
  shape: TrailShape,
  distancePx: number,
  out: { x: number; y: number },
): void {
  const points = shape.points;
  const last = shape.count - 1;
  const clamped = Math.max(0, Math.min(shape.length, distancePx));
  const index = Math.min(Math.floor(clamped / TRAIL_SAMPLE_SPACING_PX), Math.max(0, last - 1));
  const next = Math.min(index + 1, last);
  const segmentStart = index * TRAIL_SAMPLE_SPACING_PX;
  const segmentLength = Math.min(TRAIL_SAMPLE_SPACING_PX, shape.length - segmentStart);
  const share = segmentLength <= 0 ? 0 : Math.min(1, (clamped - segmentStart) / segmentLength);
  out.x = points[index * XY] + (points[next * XY] - points[index * XY]) * share;
  out.y = points[index * XY + 1] + (points[next * XY + 1] - points[index * XY + 1]) * share;
}

/**
 * Shapes one trail at a time. {@link setWalk} hands it the tile walk;
 * {@link shape} is asked once a frame with wherever the trail's head is.
 */
export class TrailShaper {
  private map: TrailGround | null = null;
  private walk: readonly TilePoint[] = [];
  /** The walk's own tiles, as `tileCoordKey`s: always trail ground, whatever they are. */
  private readonly walkKeys = new Set<number>();
  private mobility: MobilityClass = 'walker';
  private doorways: ReadonlySet<number> = new Set();
  /** Per point of {@link taut}, the index into the walk it stands on. */
  private readonly tautWalkIndex: number[] = [];
  private readonly taut = new PointBuffer();
  private readonly lastTaut = new PointBuffer();
  private readonly corners = new PointBuffer();
  private readonly dense = new PointBuffer();
  private readonly samples = new PointBuffer();
  private routeId = 0;
  private readonly result: {
    points: Float32Array;
    count: number;
    length: number;
    routeId: number;
  } = { points: new Float32Array(0), count: 0, length: 0, routeId: 0 };

  /** The tile walk the trail follows on `gameMap`, first tile nearest the head. */
  setWalk(gameMap: TrailGround, walk: readonly TilePoint[], mobility: MobilityClass): void {
    if (gameMap === this.map && mobility === this.mobility && sameWalk(walk, this.walk)) return;
    const newMap = gameMap !== this.map;
    this.map = gameMap;
    this.mobility = mobility;
    this.walk = walk;
    this.doorways = doorwayKeys(gameMap);
    this.walkKeys.clear();
    for (const tile of walk) this.walkKeys.add(tileCoordKey(tile.x, tile.y));
    this.lastTaut.clear();
    for (let index = 0; index < this.taut.count; index++) {
      this.lastTaut.push(this.taut.x(index), this.taut.y(index));
    }
    this.pullTaut(gameMap, walk);
    if (newMap || this.takesDifferentWay()) this.routeId++;
  }

  /** Drops the walk: the next {@link shape} is null until another is set. */
  clear(): void {
    this.map = null;
    this.walk = [];
    this.taut.clear();
    this.tautWalkIndex.length = 0;
    this.lastTaut.clear();
    this.walkKeys.clear();
  }

  /**
   * The trail from `head` (the feet of the body it leads, or null to start
   * at the walk's first tile) along the walk; null when there is no walk to
   * paint.
   */
  shape(head: GroundPoint | null): TrailShape | null {
    const gameMap = this.map;
    if (gameMap === null || this.taut.count < 2) return null;
    this.placeCorners(gameMap, head);
    this.roundCorners(gameMap);
    this.resample();
    if (this.samples.count < 2) return null;
    this.result.points = this.samples.data;
    this.result.count = this.samples.count;
    this.result.routeId = this.routeId;
    return this.result;
  }

  /** From each run's start, the furthest walk tile a clear run still stands for the walk to. */
  private pullTaut(gameMap: TrailGround, walk: readonly TilePoint[]): void {
    this.taut.clear();
    this.tautWalkIndex.length = 0;
    if (walk.length < 2) return;
    this.taut.push(tileCentreX(walk[0]), tileCentreY(walk[0]));
    this.tautWalkIndex.push(0);
    const last = walk.length - 1;
    let anchor = 0;
    while (anchor < last) {
      let reach = anchor + 1;
      while (reach < last && this.runFollowsWalk(gameMap, anchor, reach + 1)) reach++;
      this.taut.push(tileCentreX(walk[reach]), tileCentreY(walk[reach]));
      this.tautWalkIndex.push(reach);
      anchor = reach;
    }
  }

  private runFollowsWalk(gameMap: TrailGround, from: number, to: number): boolean {
    const a = this.walk[from];
    return this.runStandsForWalk(gameMap, tileCentreX(a), tileCentreY(a), from + 1, to);
  }

  /**
   * Whether a straight run from (ax, ay) to the walk's tile `to` stands for
   * the walk from tile `firstSkipped` up to it: short enough, never further
   * than {@link PULL_MAX_DEVIATION_TILES} off any tile it skips, and on
   * trail ground all the way.
   */
  private runStandsForWalk(
    gameMap: TrailGround,
    ax: number,
    ay: number,
    firstSkipped: number,
    to: number,
  ): boolean {
    const walk = this.walk;
    const bx = tileCentreX(walk[to]);
    const by = tileCentreY(walk[to]);
    if (Math.hypot(bx - ax, by - ay) > PULL_MAX_SPAN_TILES * TILE_SIZE) return false;
    const maxDeviationPx = PULL_MAX_DEVIATION_TILES * TILE_SIZE;
    for (let index = firstSkipped; index < to; index++) {
      const tile = walk[index];
      const off = distanceToSegment(tileCentreX(tile), tileCentreY(tile), ax, ay, bx, by);
      if (off > maxDeviationPx) return false;
    }
    return this.isClearRun(gameMap, ax, ay, bx, by);
  }

  /**
   * Whether a trail may be painted over (tileX, tileY): any tile of the walk
   * itself, else ground the route would stand on — open, dry, and neither a
   * doorway nor a stairwell, which a step onto would act on.
   */
  private isTrailTile(gameMap: TrailGround, tileX: number, tileY: number): boolean {
    const key = tileCoordKey(tileX, tileY);
    if (this.walkKeys.has(key)) return true;
    return (
      gameMap.isWalkable(tileX, tileY, this.mobility) &&
      !gameMap.isWadeable(tileX, tileY) &&
      !gameMap.isStairwellTile(tileX, tileY) &&
      !this.doorways.has(key)
    );
  }

  private isTrailPoint(gameMap: TrailGround, x: number, y: number): boolean {
    return this.isTrailTile(gameMap, Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE));
  }

  /** Whether every tile the segment (ax, ay)–(bx, by) passes through is trail ground. */
  private isTrailLine(
    gameMap: TrailGround,
    ax: number,
    ay: number,
    bx: number,
    by: number,
  ): boolean {
    let tileX = Math.floor(ax / TILE_SIZE);
    let tileY = Math.floor(ay / TILE_SIZE);
    const endX = Math.floor(bx / TILE_SIZE);
    const endY = Math.floor(by / TILE_SIZE);
    if (!this.isTrailTile(gameMap, tileX, tileY)) return false;
    const dx = bx - ax;
    const dy = by - ay;
    const stepX = Math.sign(dx);
    const stepY = Math.sign(dy);
    const tPerTileX = stepX === 0 ? Infinity : TILE_SIZE / Math.abs(dx);
    const tPerTileY = stepY === 0 ? Infinity : TILE_SIZE / Math.abs(dy);
    const firstEdgeX = stepX > 0 ? (tileX + 1) * TILE_SIZE : tileX * TILE_SIZE;
    const firstEdgeY = stepY > 0 ? (tileY + 1) * TILE_SIZE : tileY * TILE_SIZE;
    let nextX = stepX === 0 ? Infinity : Math.abs(firstEdgeX - ax) / Math.abs(dx);
    let nextY = stepY === 0 ? Infinity : Math.abs(firstEdgeY - ay) / Math.abs(dy);
    while (tileX !== endX || tileY !== endY) {
      if (nextX < nextY) {
        if (nextX > 1) break;
        tileX += stepX;
        nextX += tPerTileX;
      } else {
        if (nextY > 1) break;
        tileY += stepY;
        nextY += tPerTileY;
      }
      if (!this.isTrailTile(gameMap, tileX, tileY)) return false;
    }
    return true;
  }

  /** Whether a straight run from (ax, ay) to (bx, by) is on trail ground down its middle and along both edges. */
  private isClearRun(
    gameMap: TrailGround,
    ax: number,
    ay: number,
    bx: number,
    by: number,
  ): boolean {
    if (!this.isTrailLine(gameMap, ax, ay, bx, by)) return false;
    const length = Math.hypot(bx - ax, by - ay);
    if (length === 0) return true;
    const sideX = (-(by - ay) / length) * PULL_CLEARANCE_PX;
    const sideY = ((bx - ax) / length) * PULL_CLEARANCE_PX;
    return (
      this.isTrailLine(gameMap, ax + sideX, ay + sideY, bx + sideX, by + sideY) &&
      this.isTrailLine(gameMap, ax - sideX, ay - sideY, bx - sideX, by - sideY)
    );
  }

  private takesDifferentWay(): boolean {
    if (this.lastTaut.count === 0 || this.taut.count === 0) return true;
    const limitPx = ROUTE_CHANGE_TILES * TILE_SIZE;
    for (let index = ROUTE_CHANGE_SKIPPED_POINTS; index < this.taut.count; index++) {
      if (distanceToPolyline(this.taut.x(index), this.taut.y(index), this.lastTaut) > limitPx) {
        return true;
      }
    }
    return false;
  }

  /**
   * The polyline the curve is rounded from: the head, then the taut path
   * from the furthest of its first few points the head can walk straight
   * to without straying off the walk it skips, the same test a taut run
   * passes. Where the head sees none of them past the first and that first lies
   * behind it, the head joins the path's first run square on instead.
   */
  private placeCorners(gameMap: TrailGround, head: GroundPoint | null): void {
    const taut = this.taut;
    const corners = this.corners;
    corners.clear();
    if (head === null) {
      for (let index = 0; index < taut.count; index++) corners.push(taut.x(index), taut.y(index));
      return;
    }
    corners.push(head.x, head.y);
    let joinAt = 0;
    const furthest = Math.min(HEAD_LOOKAHEAD_POINTS, taut.count - 1);
    for (let index = furthest; index >= 1; index--) {
      const walkIndex = this.tautWalkIndex[index];
      if (this.runStandsForWalk(gameMap, head.x, head.y, 0, walkIndex)) {
        joinAt = index;
        break;
      }
    }
    if (joinAt === 0) {
      const firstX = taut.x(0);
      const firstY = taut.y(0);
      const runX = taut.x(1) - firstX;
      const runY = taut.y(1) - firstY;
      const firstIsBehind = (firstX - head.x) * runX + (firstY - head.y) * runY < 0;
      if (firstIsBehind) {
        const runLengthSq = runX * runX + runY * runY;
        const along = Math.max(
          0,
          Math.min(1, ((head.x - firstX) * runX + (head.y - firstY) * runY) / runLengthSq),
        );
        const joinX = firstX + runX * along;
        const joinY = firstY + runY * along;
        if (Math.hypot(joinX - head.x, joinY - head.y) >= HEAD_JOIN_MIN_PX) {
          corners.push(joinX, joinY);
        }
        joinAt = 1;
      }
    }
    for (let index = joinAt; index < taut.count; index++) {
      const x = taut.x(index);
      const y = taut.y(index);
      const prev = corners.count - 1;
      if (Math.hypot(x - corners.x(prev), y - corners.y(prev)) < HEAD_JOIN_MIN_PX) continue;
      corners.push(x, y);
    }
  }

  /** The corner polyline with each inner corner rounded, as a dense line of short steps. */
  private roundCorners(gameMap: TrailGround): void {
    const corners = this.corners;
    const dense = this.dense;
    dense.clear();
    if (corners.count === 0) return;
    dense.push(corners.x(0), corners.y(0));
    for (let index = 1; index < corners.count - 1; index++) {
      this.roundCorner(gameMap, index);
    }
    const last = corners.count - 1;
    dense.push(corners.x(last), corners.y(last));
  }

  private roundCorner(gameMap: TrailGround, index: number): void {
    const corners = this.corners;
    const cx = corners.x(index);
    const cy = corners.y(index);
    const inX = cx - corners.x(index - 1);
    const inY = cy - corners.y(index - 1);
    const outX = corners.x(index + 1) - cx;
    const outY = corners.y(index + 1) - cy;
    const inLength = Math.hypot(inX, inY);
    const outLength = Math.hypot(outX, outY);
    let tangent = Math.min(
      CORNER_TANGENT_PX,
      inLength * CORNER_SHARE_OF_RUN,
      outLength * CORNER_SHARE_OF_RUN,
    );
    const inUnitX = inX / inLength;
    const inUnitY = inY / inLength;
    const outUnitX = outX / outLength;
    const outUnitY = outY / outLength;
    for (let attempt = 0; attempt <= CORNER_TIGHTEN_TRIES; attempt++) {
      if (attempt === CORNER_TIGHTEN_TRIES) tangent = 0;
      const startX = cx - inUnitX * tangent;
      const startY = cy - inUnitY * tangent;
      const endX = cx + outUnitX * tangent;
      const endY = cy + outUnitY * tangent;
      if (tangent === 0 || this.curveStaysOpen(gameMap, startX, startY, cx, cy, endX, endY)) {
        this.pushCurve(startX, startY, cx, cy, endX, endY, tangent);
        return;
      }
      tangent *= CORNER_TIGHTEN_FACTOR;
    }
  }

  private curveStaysOpen(
    gameMap: TrailGround,
    startX: number,
    startY: number,
    controlX: number,
    controlY: number,
    endX: number,
    endY: number,
  ): boolean {
    for (let step = 1; step < CORNER_CHECK_POINTS; step++) {
      const t = step / CORNER_CHECK_POINTS;
      const x = quadratic(startX, controlX, endX, t);
      const y = quadratic(startY, controlY, endY, t);
      if (!this.isTrailPoint(gameMap, x, y)) return false;
    }
    return true;
  }

  private pushCurve(
    startX: number,
    startY: number,
    controlX: number,
    controlY: number,
    endX: number,
    endY: number,
    tangent: number,
  ): void {
    const dense = this.dense;
    if (tangent === 0) {
      dense.push(controlX, controlY);
      return;
    }
    dense.push(startX, startY);
    const steps = Math.max(1, Math.ceil((tangent * 2) / TRAIL_SAMPLE_SPACING_PX));
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      dense.push(quadratic(startX, controlX, endX, t), quadratic(startY, controlY, endY, t));
    }
  }

  /** {@link dense} walked by length, one sample every {@link TRAIL_SAMPLE_SPACING_PX}. */
  private resample(): void {
    const dense = this.dense;
    const samples = this.samples;
    samples.clear();
    this.result.length = 0;
    if (dense.count === 0) return;
    samples.push(dense.x(0), dense.y(0));
    let travelled = 0;
    let nextAt = TRAIL_SAMPLE_SPACING_PX;
    for (let index = 1; index < dense.count; index++) {
      const fromX = dense.x(index - 1);
      const fromY = dense.y(index - 1);
      const stepX = dense.x(index) - fromX;
      const stepY = dense.y(index) - fromY;
      const stepLength = Math.hypot(stepX, stepY);
      if (stepLength === 0) continue;
      while (nextAt <= travelled + stepLength) {
        const share = (nextAt - travelled) / stepLength;
        samples.push(fromX + stepX * share, fromY + stepY * share);
        nextAt += TRAIL_SAMPLE_SPACING_PX;
      }
      travelled += stepLength;
    }
    const last = dense.count - 1;
    const lastSample = samples.count - 1;
    const tailPx = Math.hypot(
      dense.x(last) - samples.x(lastSample),
      dense.y(last) - samples.y(lastSample),
    );
    if (tailPx > 0) samples.push(dense.x(last), dense.y(last));
    this.result.length = travelled;
  }
}

function quadratic(start: number, control: number, end: number, t: number): number {
  const inverse = 1 - t;
  return inverse * inverse * start + 2 * inverse * t * control + t * t * end;
}
