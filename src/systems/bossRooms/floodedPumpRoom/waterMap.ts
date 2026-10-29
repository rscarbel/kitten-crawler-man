/**
 * The open water of the Kraken's flooded pump room, as the shark sees it.
 *
 * The shark is a point (its fin's centre) that may go anywhere in the room's
 * water and nowhere else: never across a raft, a pump or a wall. Every
 * obstacle is kept {@link FIN_CLEARANCE_TILES} away from the fin, so the free
 * water is the room's interior shrunk by that margin less every obstacle grown
 * by it. Shortest swims through it bend only round the grown obstacles'
 * corners, so a visibility graph over those corners gives exact water-only
 * paths, which both the runtime chase and the headless gate use.
 *
 * Every distance is in tiles.
 */

import type { TileRect } from '../bossRoomLayout';
import type { TileVec } from './platforms';

/**
 * How near a fin's centre comes to a raft, a pump or a wall. Under half a
 * tile, so a crawler wading a one-tile strip of water between a raft and a
 * wall is still somewhere a fin can follow.
 */
const FIN_CLEARANCE_TILES = 0.4;

/** How far past a grown obstacle's corner its path node sits, so the node itself is free. */
const CORNER_NUDGE_TILES = 1e-4;
/** A segment must run this far into an obstacle's interior to count as crossing it. */
const CROSSING_EPSILON = 1e-9;

interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

function grow(rect: TileRect, by: number): Box {
  return { x0: rect.x - by, y0: rect.y - by, x1: rect.x + rect.w + by, y1: rect.y + rect.h + by };
}

function strictlyInside(box: Box, p: TileVec): boolean {
  return p.x > box.x0 && p.x < box.x1 && p.y > box.y0 && p.y < box.y1;
}

/** Whether the segment from `a` to `b` runs through the open interior of `box`. */
function segmentCrosses(box: Box, a: TileVec, b: TileVec): boolean {
  if (Math.max(a.x, b.x) <= box.x0 || Math.min(a.x, b.x) >= box.x1) return false;
  if (Math.max(a.y, b.y) <= box.y0 || Math.min(a.y, b.y) >= box.y1) return false;
  let enter = 0;
  let leave = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0) {
    if (a.x <= box.x0 || a.x >= box.x1) return false;
  } else {
    const t0 = (box.x0 - a.x) / dx;
    const t1 = (box.x1 - a.x) / dx;
    enter = Math.max(enter, Math.min(t0, t1));
    leave = Math.min(leave, Math.max(t0, t1));
  }
  if (dy === 0) {
    if (a.y <= box.y0 || a.y >= box.y1) return false;
  } else {
    const t0 = (box.y0 - a.y) / dy;
    const t1 = (box.y1 - a.y) / dy;
    enter = Math.max(enter, Math.min(t0, t1));
    leave = Math.min(leave, Math.max(t0, t1));
  }
  return leave - enter > CROSSING_EPSILON;
}

function distance(a: TileVec, b: TileVec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** A water-only swim: its points from start to end, and its length. */
export interface WaterPath {
  readonly points: readonly TileVec[];
  readonly lengthTiles: number;
}

function boxCorners(box: Box): TileVec[] {
  const n = CORNER_NUDGE_TILES;
  return [
    { x: box.x0 - n, y: box.y0 - n },
    { x: box.x1 + n, y: box.y0 - n },
    { x: box.x1 + n, y: box.y1 + n },
    { x: box.x0 - n, y: box.y1 + n },
  ];
}

/**
 * Shortest path from `a` to `b` through the given nodes, `a` and `b` included,
 * with `visible` deciding which pairs see each other. Dense Dijkstra: the
 * node sets here are a few dozen at most.
 */
function shortestThrough(
  nodes: readonly TileVec[],
  visible: (i: number, j: number) => boolean,
  from: number,
  to: number,
): number[] | null {
  const count = nodes.length;
  const best = new Float64Array(count).fill(Infinity);
  const previous = new Int32Array(count).fill(-1);
  const done = new Uint8Array(count);
  best[from] = 0;
  for (let round = 0; round < count; round++) {
    let current = -1;
    for (let i = 0; i < count; i++) {
      if (!done[i] && (current < 0 || best[i] < best[current])) current = i;
    }
    if (current < 0 || best[current] === Infinity) return null;
    if (current === to) break;
    done[current] = 1;
    for (let next = 0; next < count; next++) {
      if (done[next] || !visible(current, next)) continue;
      const through = best[current] + distance(nodes[current], nodes[next]);
      if (through < best[next]) {
        best[next] = through;
        previous[next] = current;
      }
    }
  }
  if (best[to] === Infinity) return null;
  const order: number[] = [];
  for (let at = to; at >= 0; at = previous[at]) order.push(at);
  return order.reverse();
}

function pathOf(nodes: readonly TileVec[], order: readonly number[]): WaterPath {
  const points = order.map((index) => nodes[index]);
  let lengthTiles = 0;
  for (let i = 1; i < points.length; i++) lengthTiles += distance(points[i - 1], points[i]);
  return { points, lengthTiles };
}

/**
 * The room's water. Built once per layout; every query after that is pure.
 */
export class WaterMap {
  readonly bounds: TileRect;
  /** The tile rectangles that are not water: rafts, pumps. */
  readonly obstacles: readonly TileRect[];
  private readonly grown: readonly Box[];
  private readonly inner: Box;
  private readonly nodes: readonly TileVec[];
  /** Pairwise visibility between {@link nodes}, row-major. */
  private readonly sees: Uint8Array;

  constructor(bounds: TileRect, obstacles: readonly TileRect[]) {
    this.bounds = bounds;
    this.obstacles = obstacles;
    this.grown = obstacles.map((rect) => grow(rect, FIN_CLEARANCE_TILES));
    this.inner = grow(bounds, -FIN_CLEARANCE_TILES);
    this.nodes = this.grown.flatMap(boxCorners).filter((corner) => this.isFree(corner));
    const count = this.nodes.length;
    this.sees = new Uint8Array(count * count);
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const clear = this.isClear(this.nodes[i], this.nodes[j]) ? 1 : 0;
        this.sees[i * count + j] = clear;
        this.sees[j * count + i] = clear;
      }
    }
  }

  /** Whether a fin's centre may be at `p`, `margin` further from everything than it must. */
  isFree(p: TileVec, margin = 0): boolean {
    const { inner } = this;
    if (p.x < inner.x0 + margin || p.x > inner.x1 - margin) return false;
    if (p.y < inner.y0 + margin || p.y > inner.y1 - margin) return false;
    for (const box of this.grown) {
      if (
        p.x > box.x0 - margin &&
        p.x < box.x1 + margin &&
        p.y > box.y0 - margin &&
        p.y < box.y1 + margin
      ) {
        return false;
      }
    }
    return true;
  }

  /**
   * Whether the straight line from `a` to `b` runs across a raft or a pump
   * itself, rather than only through the margin a fin keeps from them: a fin
   * rounding a corner in one frame's step cuts that margin, never the float.
   */
  crossesSolid(a: TileVec, b: TileVec): boolean {
    return this.obstacles.some((rect) => segmentCrosses(grow(rect, 0), a, b));
  }

  /** Whether a fin can swim straight from free `a` to free `b` without touching anything. */
  isClear(a: TileVec, b: TileVec): boolean {
    for (const box of this.grown) if (segmentCrosses(box, a, b)) return false;
    return true;
  }

  /**
   * The free point nearest `p`: `p` itself in open water, otherwise the
   * nearest spot just clear of whatever it stands too close to. Where a
   * crawler wading beside a raft is reached from.
   */
  nearestFree(p: TileVec): TileVec {
    if (this.isFree(p)) return p;
    const candidates = this.pushesOut(p).flatMap((first) =>
      this.isFree(first) ? [first] : this.pushesOut(first),
    );
    let best: TileVec | null = null;
    for (const candidate of candidates) {
      if (!this.isFree(candidate)) continue;
      if (best === null || distance(p, candidate) < distance(p, best)) best = candidate;
    }
    if (best !== null) return best;
    let nearestNode = this.nodes[0] ?? p;
    for (const node of this.nodes) {
      if (distance(p, node) < distance(p, nearestNode)) nearestNode = node;
    }
    return nearestNode;
  }

  private pushesOut(p: TileVec): TileVec[] {
    const n = CORNER_NUDGE_TILES;
    const { inner } = this;
    const clamped = {
      x: Math.min(inner.x1, Math.max(inner.x0, p.x)),
      y: Math.min(inner.y1, Math.max(inner.y0, p.y)),
    };
    const out: TileVec[] = [clamped];
    for (const box of this.grown) {
      if (!strictlyInside(box, p)) continue;
      out.push(
        { x: box.x0 - n, y: p.y },
        { x: box.x1 + n, y: p.y },
        { x: p.x, y: box.y0 - n },
        { x: p.x, y: box.y1 + n },
      );
    }
    return out;
  }

  /**
   * The shortest water-only path between two free points. Tries the straight
   * line, then the way round only the obstacles that line hits, and takes that
   * when it is clear of everything else: a path that is shortest among fewer
   * obstacles and still clear is shortest among them all. Otherwise searches
   * every corner in the room.
   */
  path(a: TileVec, b: TileVec): WaterPath {
    if (this.isClear(a, b)) return { points: [a, b], lengthTiles: distance(a, b) };
    const hit = this.grown.filter((box) => segmentCrosses(box, a, b));
    const local = this.pathAmong(a, b, hit);
    const localIsClear = local?.points.every(
      (p, i) => i === 0 || this.isClear(local.points[i - 1], p),
    );
    if (local !== null && localIsClear === true) return local;
    return this.pathThroughRoom(a, b);
  }

  /**
   * The shortest path from `a` to `b` going round only `around`, a lower
   * bound on the true water path that never looks at anything else in the
   * room: what the shark solver searches with, before the exact check.
   */
  pathAround(a: TileVec, b: TileVec, around: TileRect): WaterPath {
    return (
      this.pathAmong(a, b, [grow(around, FIN_CLEARANCE_TILES)]) ?? {
        points: [a, b],
        lengthTiles: distance(a, b),
      }
    );
  }

  private pathAmong(a: TileVec, b: TileVec, boxes: readonly Box[]): WaterPath | null {
    const nodes: TileVec[] = [a, b, ...boxes.flatMap(boxCorners)];
    const visible = (i: number, j: number): boolean =>
      boxes.every((box) => !segmentCrosses(box, nodes[i], nodes[j]));
    const order = shortestThrough(nodes, visible, 0, 1);
    return order === null ? null : pathOf(nodes, order);
  }

  private pathThroughRoom(a: TileVec, b: TileVec): WaterPath {
    const count = this.nodes.length;
    const nodes = [a, b, ...this.nodes];
    const seesA = this.nodes.map((node) => this.isClear(a, node));
    const seesB = this.nodes.map((node) => this.isClear(b, node));
    const visible = (i: number, j: number): boolean => {
      if (i > j) return visible(j, i);
      if (i === 0 && j === 1) return false;
      if (i === 0) return seesA[j - 2];
      if (i === 1) return seesB[j - 2];
      return this.sees[(i - 2) * count + (j - 2)] === 1;
    };
    const order = shortestThrough(nodes, visible, 0, 1);
    return order === null ? { points: [a, b], lengthTiles: Infinity } : pathOf(nodes, order);
  }

  /**
   * How far a fin at free `from` must swim to reach a crawler at `to`: the
   * water path to the free point nearest them, then the last reach across the
   * margin a fin keeps from what they stand beside.
   */
  reachTiles(from: TileVec, to: TileVec): number {
    const target = this.nearestFree(to);
    return this.path(from, target).lengthTiles + distance(target, to);
  }

  /** {@link reachTiles} going round only `around`: never more than the true reach. */
  reachAroundTiles(from: TileVec, to: TileVec, around: TileRect): number {
    const target = this.nearestFree(to);
    return this.pathAround(from, target, around).lengthTiles + distance(target, to);
  }
}

/**
 * The point `stepTiles` along `path` from its start, or its end when the path
 * is shorter.
 */
export function pointAlong(path: WaterPath, stepTiles: number): TileVec {
  let left = stepTiles;
  for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1];
    const b = path.points[i];
    const leg = distance(a, b);
    if (left <= leg) {
      const share = leg === 0 ? 0 : left / leg;
      return { x: a.x + (b.x - a.x) * share, y: a.y + (b.y - a.y) * share };
    }
    left -= leg;
  }
  return path.points[path.points.length - 1];
}
