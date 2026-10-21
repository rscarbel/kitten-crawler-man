/**
 * Drives the active crawler along a scripted route for repeatable performance
 * recordings, by pressing and releasing the movement keys the way a player's
 * fingers would. Dev-only: started from `?perfwalk=<scene>` in `devBoot.ts`,
 * which a release build resolves away.
 *
 * A route names places on the map (where the party arrived, a stairwell, a
 * door) rather than key timings, and each leg is walked along a breadth-first
 * path over the floor's own walkability. With the world seed pinned, the same
 * route on the same map is the same walk on every run, whatever the frame rate
 * did to how long each key stayed down.
 */

import { PLAYER_SPEED, TILE_SIZE } from '../core/constants';
import { keybindings, type GameAction } from '../core/Keybindings';
import type { AISceneContext } from '../ai/actions/types';
import type { GameMap } from '../map/GameMap';
import type { MobSpawnRule } from '../levels/types';
import type { Player } from '../Player';
import { doorwaySpan } from '../systems/BuildingSystem';

interface TilePoint {
  readonly x: number;
  readonly y: number;
}

/** A place on the current map a walk leg is measured from. */
export type PerfWalkAnchor =
  /** Where the active crawler stood when the walker first saw this map. */
  | { readonly kind: 'arrival' }
  /** The floor's first stairwell. */
  | { readonly kind: 'stairwell' }
  /** The middle of the circus grounds. */
  | { readonly kind: 'circusCentre' }
  /** The middle of the spider lab. */
  | { readonly kind: 'spiderLab' }
  /** The boss room nearest the safe room that waits before this boss. */
  | { readonly kind: 'bossRoomPast'; readonly bossType: MobSpawnRule['type'] }
  /** A building's door, by its entry name. */
  | { readonly kind: 'buildingDoor'; readonly name: string };

export type PerfWalkStep =
  /**
   * Walk to the reachable tile nearest `anchor` offset by (`dx`, `dy`) tiles.
   * Stairwells, doorways and exits are walked around, so a leg never opens a
   * prompt by accident; `onto` lets the leg end on one, which is how a route
   * asks to go down or in.
   */
  | {
      readonly kind: 'walk';
      readonly anchor: PerfWalkAnchor;
      readonly dx?: number;
      readonly dy?: number;
      readonly onto?: boolean;
    }
  /**
   * Answer every prompt that halts the world with its default button — a
   * door's Enter, the stairwell's Descend, the floor-complete card's Continue —
   * until a different map is bound. Only ever pressed under a halting prompt,
   * where the key cannot reach gameplay and open the chat box instead.
   */
  | { readonly kind: 'acceptUntilNewMap' };

export interface PerfWalkRoute {
  readonly steps: readonly PerfWalkStep[];
  /** The step a finished route starts over from; omitted, the walk ends after the last step. */
  readonly loopFrom?: number;
}

type PerfWalkState = 'waiting' | 'walking' | 'done' | 'failed';

/** What `globalThis.__perfWalk` reports, refreshed every frame. */
interface PerfWalkStatus {
  readonly route: string;
  readonly state: PerfWalkState;
  /** Milliseconds since the walk itself began, after the warm-up delay; 0 before. */
  readonly elapsedMs: number;
  readonly stepIndex: number;
  /** Times the route has wrapped back to its `loopFrom` step. */
  readonly laps: number;
  /** Walk legs given up on: no path, or stuck past every re-plan. */
  readonly skippedSteps: number;
  /** Why the walk failed, when it has. */
  readonly reason: string | null;
}

declare global {
  var __perfWalk: PerfWalkStatus | undefined;
}

interface PerfWalkOptions {
  readonly routeId: string;
  readonly route: PerfWalkRoute;
  /** Waited before the first step, so the scene's caches warm with nobody moving. */
  readonly delayMs: number;
  /** The walk stops here, keys up, even mid-route. */
  readonly durationMs: number;
  /** The scene the walker reads the crawler and the map from, or null between scenes. */
  readonly scene: () => AISceneContext | null;
  /**
   * Whether a menu, dialog or loading screen has the world stopped. The walk
   * does not begin under one, and a crawler standing still under one is not stuck.
   */
  readonly worldHalted: () => boolean;
}

/** The key every prompt's default button answers to; see `choiceModal`. */
const ACCEPT_KEY = 'Enter';

/** A path node counts as reached within this many pixels on both axes. */
const NODE_ARRIVE_PX = 8;
/**
 * An axis closer than this to its node is left alone. Half a step, so one
 * correcting step always lands inside it rather than over the far side; any
 * wider and the crawler runs a corridor off-centre enough to catch its corners.
 */
const AXIS_DEADZONE_PX = PLAYER_SPEED / 2;
/** Frames without getting closer to the next node before the leg is re-planned. */
const STUCK_FRAMES = 60;
/** Re-plans a leg may take before it is given up on. */
const MAX_REPLANS = 5;
/** Closer by at least this many pixels counts as progress. */
const PROGRESS_EPSILON_PX = 1;
/** A door or stairwell taken more slowly than this has failed. */
const AWAIT_MAP_TIMEOUT_MS = 20000;
/** Frames an accept key is held, as a tap is. */
const TAP_HOLD_FRAMES = 2;
/**
 * Between accept taps: a prompt's button may not be up yet (the floor-complete
 * card holds its own back for a beat), and a tap before then does nothing.
 */
const ACCEPT_RETRY_MS = 500;

const HALF_TILE = TILE_SIZE / 2;

const NEIGHBOUR_STEPS: readonly TilePoint[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: -1 },
];

type MoveAction = Extract<GameAction, 'moveUp' | 'moveDown' | 'moveLeft' | 'moveRight'>;

/** The grid a leg is planned over: walkable ground, minus tiles that open a prompt. */
interface WalkGrid {
  readonly width: number;
  readonly height: number;
  isOpen(x: number, y: number): boolean;
  /** A stairwell, doorway or exit: walkable, but stepping on one asks a question. */
  isTrip(x: number, y: number): boolean;
}

/**
 * The shortest 8-way path from `start` to the reachable tile nearest `target`,
 * inclusive of both ends; null when `start` is off the grid. A diagonal step needs
 * both of its sides open, so the crawler never clips a wall corner. Trip tiles
 * are never crossed; with `onto` one may end the path.
 *
 * Breadth-first with a fixed neighbour order, so ties always break the same
 * way and the same grid gives the same path on every run.
 */
function planWalkPath(
  grid: WalkGrid,
  start: TilePoint,
  target: TilePoint,
  onto: boolean,
): TilePoint[] | null {
  const { width, height } = grid;
  const inGrid = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height;
  if (!inGrid(start.x, start.y)) return null;
  const passable = (x: number, y: number): boolean =>
    inGrid(x, y) && grid.isOpen(x, y) && !grid.isTrip(x, y);
  const indexOf = (x: number, y: number): number => tileKey(x, y, width);
  const unvisited = -1;
  const parent = new Int32Array(width * height).fill(unvisited);
  const startIndex = indexOf(start.x, start.y);
  parent[startIndex] = startIndex;

  const queue: number[] = [startIndex];
  let bestIndex = startIndex;
  let bestDistanceSq = (start.x - target.x) ** 2 + (start.y - target.y) ** 2;
  // The iterator re-reads `length`, so tiles pushed below are visited by this loop.
  for (const current of queue) {
    const cx = current % width;
    const cy = (current - cx) / width;
    const distanceSq = (cx - target.x) ** 2 + (cy - target.y) ** 2;
    const isTripLeaf = current !== startIndex && grid.isTrip(cx, cy);
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      bestIndex = current;
    }
    if (isTripLeaf) continue;
    for (const step of NEIGHBOUR_STEPS) {
      const x = cx + step.x;
      const y = cy + step.y;
      if (!inGrid(x, y) || parent[indexOf(x, y)] !== unvisited) continue;
      const isDiagonal = step.x !== 0 && step.y !== 0;
      if (isDiagonal && !(passable(cx + step.x, cy) && passable(cx, cy + step.y))) continue;
      const enterable = passable(x, y) || (onto && grid.isOpen(x, y) && grid.isTrip(x, y));
      if (!enterable) continue;
      parent[indexOf(x, y)] = current;
      queue.push(indexOf(x, y));
    }
  }

  const path: TilePoint[] = [];
  for (let index = bestIndex; ; index = parent[index]) {
    const x = index % width;
    path.push({ x, y: (index - x) / width });
    if (index === startIndex) break;
  }
  return path.reverse();
}

/** Which movement keys to hold to close from `from` on `to`, both in world pixels. */
function steerToward(from: TilePoint, to: TilePoint): ReadonlySet<MoveAction> {
  const held = new Set<MoveAction>();
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx > AXIS_DEADZONE_PX) held.add('moveRight');
  if (dx < -AXIS_DEADZONE_PX) held.add('moveLeft');
  if (dy > AXIS_DEADZONE_PX) held.add('moveDown');
  if (dy < -AXIS_DEADZONE_PX) held.add('moveUp');
  return held;
}

/**
 * `list[index]`, or undefined past either end. The compiler types a bare index
 * as always present, which would let an off-the-end read pass unchecked.
 */
function entryAt<T>(list: readonly T[], index: number): T | undefined {
  const position = index < 0 ? list.length + index : index;
  return position >= 0 && position < list.length ? list[position] : undefined;
}

function tileKey(x: number, y: number, width: number): number {
  return y * width + x;
}

/** The walk grid of a map, with its doorways, exits and stairs marked as trips. */
function walkGridOf(gameMap: GameMap): WalkGrid {
  const width = gameMap.structure[0]?.length ?? 0;
  const height = gameMap.structure.length;
  const trips = new Set<number>();
  for (const entry of gameMap.buildingEntries) {
    const { x0, width: doorwayWidth } = doorwaySpan(entry);
    for (let x = x0; x < x0 + doorwayWidth; x++) trips.add(tileKey(x, entry.doorTile.y, width));
  }
  const interiorTrips = [
    ...gameMap._interiorExitTiles,
    ...gameMap._interiorStairUpTiles,
    ...gameMap._interiorStairDownTiles,
  ];
  for (const tile of interiorTrips) trips.add(tileKey(tile.x, tile.y, width));
  return {
    width,
    height,
    isOpen: (x, y) => gameMap.isWalkable(x, y),
    isTrip: (x, y) => trips.has(tileKey(x, y, width)) || gameMap.isStairwellTile(x, y),
  };
}

function nearestTo(points: readonly TilePoint[], from: TilePoint): TilePoint | null {
  let best: TilePoint | null = null;
  let bestDistanceSq = Infinity;
  for (const point of points) {
    const distanceSq = (point.x - from.x) ** 2 + (point.y - from.y) ** 2;
    if (distanceSq >= bestDistanceSq) continue;
    best = point;
    bestDistanceSq = distanceSq;
  }
  return best;
}

function anchorTile(
  anchor: PerfWalkAnchor,
  gameMap: GameMap,
  arrival: TilePoint,
): TilePoint | null {
  switch (anchor.kind) {
    case 'arrival':
      return arrival;
    case 'stairwell':
      return entryAt(gameMap.stairwellTiles, 0) ?? null;
    case 'circusCentre':
      return gameMap.circusCentre ?? null;
    case 'spiderLab':
      return gameMap.spiderLabRoom?.centre ?? null;
    case 'bossRoomPast': {
      const safeRoom = gameMap.safeRoomGuarding(anchor.bossType);
      if (safeRoom === undefined) return null;
      return nearestTo(
        gameMap.bossRooms.map((room) => room.centre),
        safeRoom.centre,
      );
    }
    case 'buildingDoor':
      return gameMap.buildingEntries.find((entry) => entry.name === anchor.name)?.doorTile ?? null;
  }
}

function activeCrawler(scene: AISceneContext): Player {
  const human = scene.getHuman();
  return human.isActive ? human : scene.getCat();
}

function crawlerCentre(crawler: Player): TilePoint {
  return { x: crawler.x + HALF_TILE, y: crawler.y + HALF_TILE };
}

function tileUnder(crawler: Player): TilePoint {
  const centre = crawlerCentre(crawler);
  return { x: Math.floor(centre.x / TILE_SIZE), y: Math.floor(centre.y / TILE_SIZE) };
}

function tileCentre(tile: TilePoint): TilePoint {
  return { x: tile.x * TILE_SIZE + HALF_TILE, y: tile.y * TILE_SIZE + HALF_TILE };
}

function dispatchKey(type: 'keydown' | 'keyup', key: string): void {
  window.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }));
}

interface LegProgress {
  readonly goal: TilePoint;
  readonly onto: boolean;
  path: TilePoint[];
  nextNode: number;
  closestPx: number;
  framesWithoutProgress: number;
  replans: number;
  /** Tiles the crawler could not get into on this leg: a body standing there, as a rule. */
  readonly refused: Set<number>;
}

/** `grid` with `refused` tiles closed, by {@link tileKey}. */
function withRefused(grid: WalkGrid, refused: ReadonlySet<number>): WalkGrid {
  if (refused.size === 0) return grid;
  return {
    width: grid.width,
    height: grid.height,
    isOpen: (x, y) => !refused.has(tileKey(x, y, grid.width)) && grid.isOpen(x, y),
    isTrip: (x, y) => grid.isTrip(x, y),
  };
}

class PerfWalker {
  private state: PerfWalkState = 'waiting';
  private stepIndex = 0;
  private laps = 0;
  private skippedSteps = 0;
  private reason: string | null = null;
  private readonly bootedAt = performance.now();
  private walkStartedAt: number | null = null;
  private stepStartedAt = 0;
  /** Whether the current step has done its entry work yet. */
  private stepEntered = false;
  private leg: LegProgress | null = null;
  private tapFramesLeft = 0;
  private lastTapAt = Number.NEGATIVE_INFINITY;
  /** Bumped on every map the walker adopts, so a wait can tell a door has been taken. */
  private mapGeneration = 0;
  /** {@link mapGeneration} when the last walk leg began: the map a later wait must see replaced. */
  private generationAtLastLeg = 0;
  private knownMap: GameMap | null = null;
  private knownGrid: WalkGrid | null = null;
  private arrival: TilePoint = { x: 0, y: 0 };
  private readonly heldKeys = new Set<string>();
  private readonly moveKeys: Record<MoveAction, string> | null;

  constructor(private readonly options: PerfWalkOptions) {
    this.moveKeys = PerfWalker.resolveMoveKeys();
    if (this.moveKeys === null) this.fail('a movement action has no key bound');
  }

  private static resolveMoveKeys(): Record<MoveAction, string> | null {
    const up = entryAt(keybindings.keysFor('moveUp'), 0);
    const down = entryAt(keybindings.keysFor('moveDown'), 0);
    const left = entryAt(keybindings.keysFor('moveLeft'), 0);
    const right = entryAt(keybindings.keysFor('moveRight'), 0);
    if (up === undefined || down === undefined || left === undefined || right === undefined) {
      return null;
    }
    return { moveUp: up, moveDown: down, moveLeft: left, moveRight: right };
  }

  frame(now: number): boolean {
    const warmedUp = now - this.bootedAt >= this.options.delayMs;
    if (this.state === 'waiting' && warmedUp && !this.options.worldHalted()) {
      this.state = 'walking';
      this.walkStartedAt = now;
      this.beginStep(now);
    }
    if (this.state === 'walking') this.walk(now);
    this.publish(now);
    return this.state === 'waiting' || this.state === 'walking';
  }

  private walk(now: number): void {
    const startedAt = this.walkStartedAt ?? now;
    if (now - startedAt >= this.options.durationMs) {
      this.finish('done', null);
      return;
    }
    const scene = this.options.scene();
    if (scene === null) {
      this.holdOnly(new Set());
      return;
    }
    const gameMap = scene.getGameMap();
    const crawler = activeCrawler(scene);
    if (gameMap !== this.knownMap) this.adoptMap(gameMap, crawler);
    const step = entryAt(this.options.route.steps, this.stepIndex);
    if (step === undefined) {
      this.finish('done', null);
      return;
    }
    if (!this.stepEntered) {
      this.stepEntered = true;
      if (step.kind === 'walk') {
        this.generationAtLastLeg = this.mapGeneration;
        this.planLeg(step, gameMap, crawler);
      }
    }
    switch (step.kind) {
      case 'walk':
        this.followLeg(crawler, now);
        return;
      case 'acceptUntilNewMap':
        this.acceptUntilNewMap(now);
        return;
    }
  }

  private acceptUntilNewMap(now: number): void {
    this.holdOnly(new Set());
    if (this.tapFramesLeft > 0) {
      this.tapFramesLeft -= 1;
      if (this.tapFramesLeft === 0) dispatchKey('keyup', ACCEPT_KEY);
      return;
    }
    if (this.mapGeneration > this.generationAtLastLeg) {
      this.nextStep(now);
      return;
    }
    if (now - this.stepStartedAt >= AWAIT_MAP_TIMEOUT_MS) {
      this.finish('failed', `no new map within ${AWAIT_MAP_TIMEOUT_MS} ms`);
      return;
    }
    if (!this.options.worldHalted() || now - this.lastTapAt < ACCEPT_RETRY_MS) return;
    dispatchKey('keydown', ACCEPT_KEY);
    this.tapFramesLeft = TAP_HOLD_FRAMES;
    this.lastTapAt = now;
  }

  private adoptMap(gameMap: GameMap, crawler: Player): void {
    this.knownMap = gameMap;
    this.mapGeneration += 1;
    this.knownGrid = walkGridOf(gameMap);
    this.arrival = tileUnder(crawler);
    // A leg planned on the map just left means nothing on this one.
    const step = entryAt(this.options.route.steps, this.stepIndex);
    if (step?.kind === 'walk' && this.stepEntered) this.planLeg(step, gameMap, crawler);
  }

  private planLeg(
    step: Extract<PerfWalkStep, { kind: 'walk' }>,
    gameMap: GameMap,
    crawler: Player,
  ): void {
    const grid = this.knownGrid;
    const anchor = anchorTile(step.anchor, gameMap, this.arrival);
    if (grid === null || anchor === null) {
      this.skipLeg(`no ${step.anchor.kind} on this map`);
      return;
    }
    const goal = { x: anchor.x + (step.dx ?? 0), y: anchor.y + (step.dy ?? 0) };
    const onto = step.onto ?? false;
    const path = planWalkPath(grid, tileUnder(crawler), goal, onto);
    if (path === null) {
      this.skipLeg('the crawler stands off the map');
      return;
    }
    this.leg = {
      goal,
      onto,
      path,
      nextNode: 0,
      closestPx: Infinity,
      framesWithoutProgress: 0,
      replans: 0,
      refused: new Set(),
    };
  }

  private replanLeg(crawler: Player): void {
    const leg = this.leg;
    const grid = this.knownGrid;
    if (leg === null || grid === null) return;
    const node = entryAt(leg.path, leg.nextNode);
    if (leg.replans >= MAX_REPLANS) {
      const where = node === undefined ? '' : ` at (${node.x}, ${node.y})`;
      this.skipLeg(`stuck${where} after ${MAX_REPLANS} re-plans`);
      return;
    }
    // Open on the map yet refused underfoot: something stands there, so the
    // next plan goes round it.
    const isPromptTile = leg.onto && node === entryAt(leg.path, -1);
    if (node !== undefined && !isPromptTile) leg.refused.add(tileKey(node.x, node.y, grid.width));
    // Let go first: a key a menu or a reset swallowed has to be pressed afresh to count.
    this.holdOnly(new Set());
    const path = planWalkPath(
      withRefused(grid, leg.refused),
      tileUnder(crawler),
      leg.goal,
      leg.onto,
    );
    if (path === null) {
      this.skipLeg('the crawler stands off the map');
      return;
    }
    leg.path = path;
    leg.nextNode = 0;
    leg.closestPx = Infinity;
    leg.framesWithoutProgress = 0;
    leg.replans += 1;
  }

  private followLeg(crawler: Player, now: number): void {
    const leg = this.leg;
    if (leg === null) return;
    const lastNode = entryAt(leg.path, -1);
    const standing = tileUnder(crawler);
    // A leg onto a prompt tile is over the moment the crawler is on it: the
    // prompt halts the world before they can reach its centre.
    if (leg.onto && lastNode !== undefined) {
      if (standing.x === lastNode.x && standing.y === lastNode.y) {
        this.nextStep(now);
        return;
      }
    }
    const centre = crawlerCentre(crawler);
    let node = entryAt(leg.path, leg.nextNode);
    while (node !== undefined) {
      const target = tileCentre(node);
      const reached =
        Math.abs(target.x - centre.x) <= NODE_ARRIVE_PX &&
        Math.abs(target.y - centre.y) <= NODE_ARRIVE_PX;
      if (!reached) break;
      leg.nextNode += 1;
      leg.closestPx = Infinity;
      leg.framesWithoutProgress = 0;
      node = entryAt(leg.path, leg.nextNode);
    }
    if (node === undefined) {
      this.nextStep(now);
      return;
    }
    if (this.options.worldHalted()) return;
    const target = tileCentre(node);
    const distancePx = Math.hypot(target.x - centre.x, target.y - centre.y);
    if (distancePx < leg.closestPx - PROGRESS_EPSILON_PX) {
      leg.closestPx = distancePx;
      leg.framesWithoutProgress = 0;
    } else {
      leg.framesWithoutProgress += 1;
    }
    if (leg.framesWithoutProgress >= STUCK_FRAMES) {
      this.replanLeg(crawler);
      return;
    }
    this.holdOnly(steerToward(centre, target));
  }

  private skipLeg(why: string): void {
    console.warn(`[perfwalk] ${this.options.routeId} step ${this.stepIndex}: ${why}; skipping it`);
    this.skippedSteps += 1;
    this.leg = null;
    this.nextStep(performance.now());
  }

  private beginStep(now: number): void {
    this.stepStartedAt = now;
    this.stepEntered = false;
    this.leg = null;
  }

  private nextStep(now: number): void {
    this.holdOnly(new Set());
    const { steps, loopFrom } = this.options.route;
    this.stepIndex += 1;
    if (this.stepIndex >= steps.length && loopFrom !== undefined) {
      this.stepIndex = loopFrom;
      this.laps += 1;
    }
    this.beginStep(now);
  }

  /** Presses what `actions` names and releases every other key the walker holds. */
  private holdOnly(actions: ReadonlySet<MoveAction>): void {
    const keys = this.moveKeys;
    if (keys === null) return;
    const wanted = new Set<string>();
    for (const action of actions) wanted.add(keys[action]);
    for (const key of [...this.heldKeys]) {
      if (wanted.has(key)) continue;
      dispatchKey('keyup', key);
      this.heldKeys.delete(key);
    }
    for (const key of wanted) {
      if (this.heldKeys.has(key)) continue;
      dispatchKey('keydown', key);
      this.heldKeys.add(key);
    }
  }

  private finish(state: 'done' | 'failed', reason: string | null): void {
    this.holdOnly(new Set());
    if (this.tapFramesLeft > 0) {
      this.tapFramesLeft = 0;
      dispatchKey('keyup', ACCEPT_KEY);
    }
    this.state = state;
    this.reason = reason;
    if (reason !== null) console.error(`[perfwalk] ${this.options.routeId}: ${reason}`);
  }

  private fail(reason: string): void {
    this.finish('failed', reason);
  }

  private publish(now: number): void {
    globalThis.__perfWalk = {
      route: this.options.routeId,
      state: this.state,
      elapsedMs: this.walkStartedAt === null ? 0 : now - this.walkStartedAt,
      stepIndex: this.stepIndex,
      laps: this.laps,
      skippedSteps: this.skippedSteps,
      reason: this.reason,
    };
  }
}

/**
 * Starts walking `options.route` once its delay has passed, ticking on its own
 * animation frames until the walk is done or has failed.
 */
export function startPerfWalk(options: PerfWalkOptions): void {
  const walker = new PerfWalker(options);
  const tick = (now: number): void => {
    if (walker.frame(now)) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
