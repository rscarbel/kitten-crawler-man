/**
 * The headless stealth solver behind `npm run verify:prison-stealth`.
 *
 * Every patrol and spotlight in a layout repeats on its `cycleFrames`, so the
 * whole prison is a function of (tile, frame mod cycle). This precomputes,
 * for every moment of the cycle, which tiles a crawler cannot stand on or step
 * through unseen — using the game's own `castPrisonLights` and
 * `lightSeesBody` — and then searches that space breadth-first for a party
 * that moves the way the prison makes it move: the leader one tile at a time
 * at real walking speed, the follower one tile behind on the leader's trail.
 *
 * Time is searched in quanta of {@link SOLVER_QUANTUM_FRAMES}. A step takes
 * whole quanta, rounded up from the real per-tile time, and a tile counts as
 * lit for a quantum if it is lit on any frame of it, both ends included. The
 * route found is therefore walkable by a crawler who is slightly slower than
 * a real one and is seen on no frame at all — zero suspicion grace.
 */

import { PLAYER_SPEED, TILE_SIZE } from '../src/core/constants.js';
import {
  prisonSectionAt,
  isPrisonCrawlerWalkable,
  type PrisonTile,
} from '../src/map/goblinPrisonPlan.js';
import type { PrisonSectionId } from '../src/map/goblinPrisonLayouts.js';
import {
  bodyTouchesGuard,
  lightSeesBody,
  stepSuspicion,
  SUSPICION_CAPTURE,
  type PrisonPoint,
} from '../src/systems/stealthKeySnatch/detection.js';
import {
  castPrisonLights,
  prisonStateAt,
  tileCentrePx,
  type CompiledPrison,
  type PrisonLight,
  type PrisonState,
} from '../src/systems/stealthKeySnatch/prisonPatrols.js';
import { PRISON_TRAIL_SPACING_TILES } from '../src/systems/stealthKeySnatch/prisonTuning.js';

export const SOLVER_QUANTUM_FRAMES = 4;
const FRAMES_PER_TILE = TILE_SIZE / PLAYER_SPEED;
/** Quanta a one-tile step takes, rounded up from the real walking time. */
export const SOLVER_STEP_QUANTA = Math.ceil(FRAMES_PER_TILE / SOLVER_QUANTUM_FRAMES);

/** Neighbour directions; the follower's slot also uses {@link SAME_TILE}. */
const STEPS: ReadonlyArray<PrisonTile> = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];
const SAME_TILE = 4;
const FOLLOWER_SLOTS = 5;
/** For each of {@link STEPS}, the index of the step back the other way. */
const OPPOSITE: ReadonlyArray<number> = STEPS.map((step) =>
  STEPS.findIndex((other) => other.x === -step.x && other.y === -step.y),
);

/** Every frame's state and cast lights for one compiled prison, computed once. */
export interface PrisonTimeline {
  readonly compiled: CompiledPrison;
  readonly states: ReadonlyArray<PrisonState>;
  readonly lights: ReadonlyArray<ReadonlyArray<PrisonLight>>;
}

export function buildTimeline(compiled: CompiledPrison): PrisonTimeline {
  const states: PrisonState[] = [];
  const lights: Array<ReadonlyArray<PrisonLight>> = [];
  for (let frame = 0; frame < compiled.cycleFrames; frame++) {
    const state = prisonStateAt(compiled, frame);
    states.push(state);
    lights.push(castPrisonLights(compiled, state));
  }
  return { compiled, states, lights };
}

/**
 * Which body positions are seen in each quantum. `centre` is a body standing
 * on a tile's centre; `edgeEast` and `edgeSouth` a body halfway to the east or
 * south neighbour — the midpoint every step between those two tiles passes.
 */
export interface LitTables {
  readonly quanta: number;
  readonly tileCount: number;
  readonly centre: Uint8Array;
  readonly edgeEast: Uint8Array;
  readonly edgeSouth: Uint8Array;
}

function centreOf(x: number, y: number): PrisonPoint {
  return tileCentrePx({ x, y });
}

export function buildLitTables(timeline: PrisonTimeline): LitTables {
  const { compiled } = timeline;
  const { grid } = compiled.parsed;
  const cycle = compiled.cycleFrames;
  if (cycle % SOLVER_QUANTUM_FRAMES !== 0) {
    throw new Error(
      `cycle ${cycle} is not a whole number of ${SOLVER_QUANTUM_FRAMES}-frame quanta`,
    );
  }
  const quanta = cycle / SOLVER_QUANTUM_FRAMES;
  const tileCount = grid.width * grid.height;
  const centre = new Uint8Array(quanta * tileCount);
  const edgeEast = new Uint8Array(quanta * tileCount);
  const edgeSouth = new Uint8Array(quanta * tileCount);
  const edgeWeight = compiled.tuning.suspicion.coneEdgeWeight;
  const walkable = (x: number, y: number): boolean => isPrisonCrawlerWalkable(grid, x, y);

  const frameCentre = new Uint8Array(tileCount);
  const frameEast = new Uint8Array(tileCount);
  const frameSouth = new Uint8Array(tileCount);
  for (let frame = 0; frame < cycle; frame++) {
    frameCentre.fill(0);
    frameEast.fill(0);
    frameSouth.fill(0);
    const seen = (
      point: PrisonPoint,
      frameLights: ReadonlyArray<PrisonLight>,
      state: PrisonState,
    ): boolean => {
      for (const light of frameLights) {
        if (lightSeesBody(grid, light.shape, point, edgeWeight) > 0) return true;
      }
      for (const guard of state.guards) {
        if (bodyTouchesGuard(grid, guard, point)) return true;
      }
      return false;
    };
    const frameLights = timeline.lights[frame] ?? [];
    const state = timeline.states[frame];
    const touched = new Set<number>();
    const consider = (minPx: number, minPy: number, maxPx: number, maxPy: number): void => {
      const x0 = Math.max(0, Math.floor(minPx / TILE_SIZE) - 1);
      const y0 = Math.max(0, Math.floor(minPy / TILE_SIZE) - 1);
      const x1 = Math.min(grid.width - 1, Math.floor(maxPx / TILE_SIZE) + 1);
      const y1 = Math.min(grid.height - 1, Math.floor(maxPy / TILE_SIZE) + 1);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) touched.add(y * grid.width + x);
    };
    for (const light of frameLights) {
      const { bounds } = light.shape;
      consider(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY);
    }
    for (const guard of state.guards) {
      consider(guard.x - TILE_SIZE, guard.y - TILE_SIZE, guard.x + TILE_SIZE, guard.y + TILE_SIZE);
    }
    for (const index of touched) {
      const x = index % grid.width;
      const y = Math.floor(index / grid.width);
      if (!walkable(x, y)) continue;
      const middle = centreOf(x, y);
      if (seen(middle, frameLights, state)) frameCentre[index] = 1;
      if (
        walkable(x + 1, y) &&
        seen({ x: middle.x + TILE_SIZE / 2, y: middle.y }, frameLights, state)
      ) {
        frameEast[index] = 1;
      }
      if (
        walkable(x, y + 1) &&
        seen({ x: middle.x, y: middle.y + TILE_SIZE / 2 }, frameLights, state)
      ) {
        frameSouth[index] = 1;
      }
    }
    const quantum = Math.floor(frame / SOLVER_QUANTUM_FRAMES);
    const alsoClosesPrevious = frame % SOLVER_QUANTUM_FRAMES === 0;
    const previous = (quantum - 1 + quanta) % quanta;
    for (const index of touched) {
      const marks: ReadonlyArray<[Uint8Array, Uint8Array]> = [
        [frameCentre, centre],
        [frameEast, edgeEast],
        [frameSouth, edgeSouth],
      ];
      for (const [frameTable, table] of marks) {
        if (frameTable[index] !== 1) continue;
        table[quantum * tileCount + index] = 1;
        if (alsoClosesPrevious) table[previous * tileCount + index] = 1;
      }
    }
  }
  return { quanta, tileCount, centre, edgeEast, edgeSouth };
}

export interface SolverStep {
  readonly tile: PrisonTile;
  readonly quantum: number;
}

export interface SolverResult {
  readonly found: boolean;
  /** The leader's route, one entry per quantum, from the first start state to the goal. */
  readonly route: ReadonlyArray<SolverStep>;
  /** Every state the goal was reached in, to seed a search onward from it. */
  readonly goalStates: ReadonlyArray<number>;
  /** How long the route takes, in frames. */
  readonly frames: number;
  /** 1 for every tile the leader reached unseen at any moment, for reporting how far a failed search got. */
  readonly reachedTiles: Uint8Array;
}

interface SolverSpace {
  readonly width: number;
  readonly tileCount: number;
  readonly quanta: number;
  readonly walkable: Uint8Array;
}

function spaceOf(
  compiled: CompiledPrison,
  lit: LitTables,
  blocked?: (x: number, y: number) => boolean,
): SolverSpace {
  const { grid } = compiled.parsed;
  const walkable = new Uint8Array(grid.width * grid.height);
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const open = isPrisonCrawlerWalkable(grid, x, y) && !(blocked?.(x, y) ?? false);
      walkable[y * grid.width + x] = open ? 1 : 0;
    }
  }
  return { width: grid.width, tileCount: lit.tileCount, quanta: lit.quanta, walkable };
}

function stateId(space: SolverSpace, quantum: number, tile: number, slot: number): number {
  return (quantum * space.tileCount + tile) * FOLLOWER_SLOTS + slot;
}

/** The start state for a party standing together on `tile` at quantum 0. */
export function startState(compiled: CompiledPrison, lit: LitTables, tile: PrisonTile): number {
  const width = compiled.parsed.grid.width;
  return (0 * lit.tileCount + tile.y * width + tile.x) * FOLLOWER_SLOTS + SAME_TILE;
}

/** The midpoint table entry for the step from `tile` toward neighbour direction `dir`. */
function edgeLit(
  lit: LitTables,
  space: SolverSpace,
  quantum: number,
  tile: number,
  dir: number,
): boolean {
  const base = quantum * lit.tileCount;
  switch (dir) {
    case 0:
      return lit.edgeSouth[base + tile - space.width] === 1;
    case 1:
      return lit.edgeEast[base + tile] === 1;
    case 2:
      return lit.edgeSouth[base + tile] === 1;
    default:
      return lit.edgeEast[base + tile - 1] === 1;
  }
}

function neighbourIndex(space: SolverSpace, tile: number, dir: number): number {
  const step = STEPS[dir];
  return tile + step.y * space.width + step.x;
}

/**
 * Shortest-time search from `starts` to any state whose leader stands on a
 * goal tile, never on a lit position.
 */
export function solve(
  compiled: CompiledPrison,
  lit: LitTables,
  starts: ReadonlyArray<number>,
  goals: ReadonlyArray<PrisonTile>,
  blocked?: (x: number, y: number) => boolean,
): SolverResult {
  const space = spaceOf(compiled, lit, blocked);
  const total = space.quanta * space.tileCount * FOLLOWER_SLOTS;
  const parent = new Int32Array(total).fill(-1);
  const elapsed = new Int32Array(total).fill(-1);
  const goalSet = new Set(goals.map((tile) => tile.y * space.width + tile.x));
  // Dial's algorithm: a wait costs one quantum and a step SOLVER_STEP_QUANTA,
  // so a ring of that many + 1 FIFO buckets pops states in order of elapsed time.
  const ring: number[][] = Array.from({ length: SOLVER_STEP_QUANTA + 1 }, () => []);
  let pending = 0;
  const push = (from: number, to: number, time: number): void => {
    const known = elapsed[to] ?? -1;
    if (known !== -1 && known <= time) return;
    elapsed[to] = time;
    parent[to] = from;
    ring[time % ring.length]?.push(to);
    pending++;
  };
  for (const start of starts) push(start, start, 0);
  const centreLit = (quantum: number, tile: number): boolean =>
    lit.centre[(quantum % space.quanta) * lit.tileCount + tile] === 1;
  const goalStates: number[] = [];
  const reachedTiles = new Uint8Array(space.tileCount);
  let firstGoal = -1;

  for (let now = 0; pending > 0; now++) {
    const bucket = ring[now % ring.length];
    for (const state of bucket) {
      pending--;
      if (elapsed[state] !== now) continue;
      const visit = (to: number, cost: number): void => push(state, to, now + cost);
      const slot = state % FOLLOWER_SLOTS;
      const tileQuantum = (state - slot) / FOLLOWER_SLOTS;
      const tile = tileQuantum % space.tileCount;
      const quantum = (tileQuantum - tile) / space.tileCount;
      reachedTiles[tile] = 1;
      if (goalSet.has(tile)) {
        goalStates.push(state);
        if (firstGoal < 0) firstGoal = state;
        continue;
      }
      const follower = slot === SAME_TILE ? tile : neighbourIndex(space, tile, slot);

      const nextQuantum = (quantum + 1) % space.quanta;
      if (!centreLit(quantum, tile) && !centreLit(quantum, follower)) {
        visit(stateId(space, nextQuantum, tile, slot), 1);
      }

      for (let dir = 0; dir < STEPS.length; dir++) {
        const target = neighbourIndex(space, tile, dir);
        if (space.walkable[target] !== 1) continue;
        let clear = true;
        for (let k = 0; k < SOLVER_STEP_QUANTA && clear; k++) {
          const q = (quantum + k) % space.quanta;
          const firstPart = k < SOLVER_STEP_QUANTA - 1;
          const secondPart = k > 0;
          if (edgeLit(lit, space, q, tile, dir)) clear = false;
          else if (firstPart && centreLit(q, tile)) clear = false;
          else if (secondPart && centreLit(q, target)) clear = false;
          else if (slot === SAME_TILE) {
            if (centreLit(q, tile)) clear = false;
          } else {
            if (edgeLit(lit, space, q, follower, OPPOSITE[slot])) clear = false;
            else if (firstPart && centreLit(q, follower)) clear = false;
            else if (secondPart && centreLit(q, tile)) clear = false;
          }
        }
        if (!clear) continue;
        const arrival = (quantum + SOLVER_STEP_QUANTA) % space.quanta;
        visit(stateId(space, arrival, target, OPPOSITE[dir]), SOLVER_STEP_QUANTA);
      }
    }
    bucket.length = 0;
  }

  const route: SolverStep[] = [];
  if (firstGoal >= 0) {
    let cursor = firstGoal;
    for (;;) {
      const slot = cursor % FOLLOWER_SLOTS;
      const tileQuantum = (cursor - slot) / FOLLOWER_SLOTS;
      const tile = tileQuantum % space.tileCount;
      route.push({
        tile: { x: tile % space.width, y: Math.floor(tile / space.width) },
        quantum: (tileQuantum - tile) / space.tileCount,
      });
      const previous = parent[cursor] ?? cursor;
      if (previous === cursor) break;
      cursor = previous;
    }
    route.reverse();
  }
  const frames = firstGoal >= 0 ? (elapsed[firstGoal] ?? 0) * SOLVER_QUANTUM_FRAMES : 0;
  return { found: firstGoal >= 0, route, goalStates, reachedTiles, frames };
}

/** The fewest-steps walk between two tiles, ignoring every light. */
export function shortestWalk(
  compiled: CompiledPrison,
  from: PrisonTile,
  to: PrisonTile,
  blocked?: (x: number, y: number) => boolean,
): ReadonlyArray<PrisonTile> | null {
  const { grid } = compiled.parsed;
  const width = grid.width;
  const parent = new Int32Array(width * grid.height).fill(-1);
  const startIndex = from.y * width + from.x;
  const goalIndex = to.y * width + to.x;
  parent[startIndex] = startIndex;
  const queue = [startIndex];
  for (const index of queue) {
    if (index === goalIndex) {
      const path: PrisonTile[] = [];
      let cursor = index;
      for (;;) {
        path.push({ x: cursor % width, y: Math.floor(cursor / width) });
        const previous = parent[cursor] ?? cursor;
        if (previous === cursor) break;
        cursor = previous;
      }
      return path.reverse();
    }
    const x = index % width;
    const y = Math.floor(index / width);
    for (const step of STEPS) {
      const nx = x + step.x;
      const ny = y + step.y;
      if (!isPrisonCrawlerWalkable(grid, nx, ny) || (blocked?.(nx, ny) ?? false)) continue;
      const next = ny * width + nx;
      if (parent[next] !== -1) continue;
      parent[next] = index;
      queue.push(next);
    }
  }
  return null;
}

/** A blocker that closes every tile of the named section. */
export function sectionBlocker(
  compiled: CompiledPrison,
  section: PrisonSectionId,
): (x: number, y: number) => boolean {
  return (x, y) => prisonSectionAt(compiled.parsed.layout, x, y) === section;
}

function pointAlongPath(path: ReadonlyArray<PrisonTile>, distance: number): PrisonPoint {
  const clamped = Math.max(0, distance);
  const step = Math.min(path.length - 1, Math.floor(clamped / TILE_SIZE));
  const fraction = Math.min(1, (clamped - step * TILE_SIZE) / TILE_SIZE);
  const a = path[step];
  const b = path[Math.min(path.length - 1, step + 1)];
  const from = centreOf(a.x, a.y);
  const to = centreOf(b.x, b.y);
  return { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction };
}

export interface WalkOutcome {
  readonly caught: boolean;
  /** The frame of the walk the capture started on, or the walk's length when it never did. */
  readonly frame: number;
  readonly by: string | null;
}

/**
 * Walks the party down `path` at full speed from shared-clock frame
 * `startFrame`, with the game's real suspicion fill and drain, and reports
 * whether a capture starts on the way.
 */
export function walkPathWithSuspicion(
  timeline: PrisonTimeline,
  path: ReadonlyArray<PrisonTile>,
  startFrame: number,
): WalkOutcome {
  const { compiled } = timeline;
  const { grid } = compiled.parsed;
  const cycle = compiled.cycleFrames;
  const suspicion = compiled.tuning.suspicion;
  const lengthPx = (path.length - 1) * TILE_SIZE;
  const walkFrames = Math.ceil(lengthPx / PLAYER_SPEED);
  const spacing = PRISON_TRAIL_SPACING_TILES * TILE_SIZE;
  const values = new Map<string, number>();
  for (let k = 0; k <= walkFrames; k++) {
    const clock = (startFrame + k) % cycle;
    const travelled = Math.min(lengthPx, k * PLAYER_SPEED);
    const leader = pointAlongPath(path, travelled);
    const follower = pointAlongPath(path, travelled - spacing);
    const state = timeline.states[clock];
    for (const guard of state.guards) {
      if (bodyTouchesGuard(grid, guard, leader) || bodyTouchesGuard(grid, guard, follower)) {
        return { caught: true, frame: k, by: guard.id };
      }
    }
    for (const light of timeline.lights[clock] ?? []) {
      const weight = Math.max(
        lightSeesBody(grid, light.shape, leader, suspicion.coneEdgeWeight),
        lightSeesBody(grid, light.shape, follower, suspicion.coneEdgeWeight),
      );
      const next = stepSuspicion(
        values.get(light.sourceId) ?? 0,
        light.shape.kind,
        weight,
        suspicion,
      );
      values.set(light.sourceId, next);
      if (next >= SUSPICION_CAPTURE) return { caught: true, frame: k, by: light.sourceId };
    }
  }
  return { caught: false, frame: walkFrames, by: null };
}
