/**
 * The gym's exercise balls once Big Rooster kicks them: each rolls at a fixed
 * speed and reflects off walls, solid kit and the room's edge, until he dies
 * and it slows to a stop where it is.
 *
 * Pure: no canvas and no audio. The gym owns the balls, resolves what they
 * hit, and keeps the floor they are about to cross marked for the party's
 * companions.
 */

import { PLAYER_SPEED, TILE_SIZE } from '../../core/constants';
import type { TilePoint, TileRect } from './bossRoomLayout';
import type { ExerciseBallState } from './gymRoomCheckpoint';

/**
 * How fast a kicked ball rolls, as a share of a crawler's walk: just under
 * it, so a crawler who sees one coming can always step out of its line.
 */
const EXERCISE_BALL_SPEED_SHARE_OF_WALK = 0.9;
const EXERCISE_BALL_SPEED = PLAYER_SPEED * EXERCISE_BALL_SPEED_SHARE_OF_WALK;
/** A ball's radius, in tiles: as wide as a crawler is tall. */
const EXERCISE_BALL_RADIUS_TILES = 0.5;
export const EXERCISE_BALL_RADIUS_PX = EXERCISE_BALL_RADIUS_TILES * TILE_SIZE;
/** Frames a ball takes to roll to a stop once he is dead. */
const BALL_STOP_FRAMES = 90;

/** How far ahead of a ball the floor is marked for companions, in frames of its roll. */
const WARN_LOOKAHEAD_FRAMES = 40;
/** A tile is marked once its centre comes this near a ball's path, in tiles past the ball's edge... */
const WARN_ENTER_MARGIN_TILES = 0.6;
/** ...and stays marked until it is this far, so a body at the edge does not flicker in and out. */
const WARN_EXIT_MARGIN_TILES = 1.1;
const TILE_CENTRE = 0.5;

/** The floor a ball rolls on: the room and which of its tiles are open. */
export interface ExerciseBallFloor {
  readonly room: TileRect;
  isWalkable(tileX: number, tileY: number): boolean;
}

/** What happened to the balls in one frame, for the gym's sounds. */
export interface ExerciseBallFrame {
  /** Balls that bounced off a wall or kit this frame, by index. */
  readonly bounced: readonly number[];
}

const key = (x: number, y: number): string => `${x},${y}`;

/** A ball's centre for a resting spot: the middle of its tile. */
function restingBallCentre(spot: TilePoint): { x: number; y: number } {
  return { x: (spot.x + TILE_CENTRE) * TILE_SIZE, y: (spot.y + TILE_CENTRE) * TILE_SIZE };
}

export class ExerciseBalls {
  private states: ExerciseBallState[];
  /** Per ball, the tiles its path is marked on, kept with hysteresis. */
  private readonly warned: Array<Set<string>>;

  constructor(readonly spots: readonly TilePoint[]) {
    this.states = spots.map((): ExerciseBallState => ({ phase: 'resting' }));
    this.warned = spots.map(() => new Set<string>());
  }

  get all(): readonly ExerciseBallState[] {
    return this.states;
  }

  /** Each ball's centre in world pixels, wherever it is. */
  centreOf(index: number): { x: number; y: number } {
    const state = this.states[index];
    if (state.phase === 'resting') return restingBallCentre(this.spots[index]);
    return { x: state.x, y: state.y };
  }

  /** Sends a resting ball rolling at `EXERCISE_BALL_SPEED` along (dx, dy). False if it was not resting. */
  kick(index: number, dx: number, dy: number): boolean {
    if (index < 0 || index >= this.states.length) return false;
    if (this.states[index].phase !== 'resting') return false;
    const length = Math.hypot(dx, dy);
    if (length === 0) return false;
    const centre = restingBallCentre(this.spots[index]);
    this.states[index] = {
      phase: 'rolling',
      x: centre.x,
      y: centre.y,
      vx: (dx / length) * EXERCISE_BALL_SPEED,
      vy: (dy / length) * EXERCISE_BALL_SPEED,
    };
    return true;
  }

  /** Every rolling ball starts slowing to a stop: he is dead. */
  stopAll(): void {
    this.states = this.states.map((state) =>
      state.phase === 'rolling'
        ? { ...state, phase: 'stopping', framesLeft: BALL_STOP_FRAMES }
        : state,
    );
  }

  /** Every ball back on its spot, unkicked: a fight called off. */
  rest(): void {
    this.states = this.spots.map((): ExerciseBallState => ({ phase: 'resting' }));
    for (const set of this.warned) set.clear();
  }

  restore(states: readonly ExerciseBallState[]): void {
    this.states = this.spots.map(
      (_, index): ExerciseBallState => states[index] ?? { phase: 'resting' },
    );
    for (const set of this.warned) set.clear();
  }

  /** Reflects a rolling ball off something it hit, along the unit normal (nx, ny). */
  reflect(index: number, nx: number, ny: number): void {
    const state = this.states[index];
    if (state.phase !== 'rolling') return;
    const along = state.vx * nx + state.vy * ny;
    // Only a ball moving into the surface turns; one already leaving it keeps going.
    if (along >= 0) return;
    this.states[index] = { ...state, vx: state.vx - 2 * along * nx, vy: state.vy - 2 * along * ny };
  }

  /** One frame of rolling for every ball. */
  tick(floor: ExerciseBallFloor): ExerciseBallFrame {
    const bounced: number[] = [];
    this.states = this.states.map((state, index) => {
      switch (state.phase) {
        case 'resting':
        case 'stopped':
          return state;
        case 'rolling': {
          const moved = roll(state.x, state.y, state.vx, state.vy, floor);
          if (moved.bounced) bounced.push(index);
          return { ...state, ...moved.at };
        }
        case 'stopping': {
          const share = state.framesLeft / BALL_STOP_FRAMES;
          const moved = roll(state.x, state.y, state.vx * share, state.vy * share, floor);
          const framesLeft = state.framesLeft - 1;
          if (framesLeft <= 0) return { phase: 'stopped', x: moved.at.x, y: moved.at.y };
          const flip = moved.at;
          // A bounce while slowing turns the stored velocity too, so it does not run back into the wall.
          const vx = Math.sign(flip.vx) === Math.sign(state.vx) ? state.vx : -state.vx;
          const vy = Math.sign(flip.vy) === Math.sign(state.vy) ? state.vy : -state.vy;
          return { ...state, x: flip.x, y: flip.y, vx, vy, framesLeft };
        }
        default:
          return assertNever(state);
      }
    });
    this.updateWarnings(floor);
    return { bounced };
  }

  /**
   * The way out of a rolling ball's path for a body whose top-left is (x, y),
   * or null when no ball is coming for it: square to the ball's run, toward
   * whichever side the body already stands.
   */
  escapeFrom(x: number, y: number): { dx: number; dy: number } | null {
    const cx = x + TILE_SIZE * TILE_CENTRE;
    const cy = y + TILE_SIZE * TILE_CENTRE;
    const tile = key(Math.floor(cx / TILE_SIZE), Math.floor(cy / TILE_SIZE));
    for (let index = 0; index < this.states.length; index++) {
      const state = this.states[index];
      if (state.phase !== 'rolling' || !this.warned[index].has(tile)) continue;
      const speed = Math.hypot(state.vx, state.vy);
      if (speed === 0) continue;
      const sideX = -state.vy / speed;
      const sideY = state.vx / speed;
      const lean = (cx - state.x) * sideX + (cy - state.y) * sideY;
      const sign = lean >= 0 ? 1 : -1;
      return { dx: sideX * sign, dy: sideY * sign };
    }
    return null;
  }

  private updateWarnings(floor: ExerciseBallFloor): void {
    const enterPx = EXERCISE_BALL_RADIUS_PX + WARN_ENTER_MARGIN_TILES * TILE_SIZE;
    const exitPx = EXERCISE_BALL_RADIUS_PX + WARN_EXIT_MARGIN_TILES * TILE_SIZE;
    this.states.forEach((state, index) => {
      const warned = this.warned[index];
      if (state.phase !== 'rolling') {
        warned.clear();
        return;
      }
      const endX = state.x + state.vx * WARN_LOOKAHEAD_FRAMES;
      const endY = state.y + state.vy * WARN_LOOKAHEAD_FRAMES;
      const distanceTo = (tileX: number, tileY: number): number =>
        distanceToSegment(
          (tileX + TILE_CENTRE) * TILE_SIZE,
          (tileY + TILE_CENTRE) * TILE_SIZE,
          state.x,
          state.y,
          endX,
          endY,
        );
      for (const marked of [...warned]) {
        const [tileX, tileY] = marked.split(',').map(Number);
        if (distanceTo(tileX, tileY) > exitPx) warned.delete(marked);
      }
      const reachTiles = Math.ceil(enterPx / TILE_SIZE);
      const room = floor.room;
      const minX = Math.max(room.x, Math.floor(Math.min(state.x, endX) / TILE_SIZE) - reachTiles);
      const maxX = Math.min(
        room.x + room.w - 1,
        Math.floor(Math.max(state.x, endX) / TILE_SIZE) + reachTiles,
      );
      const minY = Math.max(room.y, Math.floor(Math.min(state.y, endY) / TILE_SIZE) - reachTiles);
      const maxY = Math.min(
        room.y + room.h - 1,
        Math.floor(Math.max(state.y, endY) / TILE_SIZE) + reachTiles,
      );
      for (let tileY = minY; tileY <= maxY; tileY++) {
        for (let tileX = minX; tileX <= maxX; tileX++) {
          if (distanceTo(tileX, tileY) < enterPx) warned.add(key(tileX, tileY));
        }
      }
    });
  }
}

function assertNever(value: never): never {
  throw new Error(`unhandled exercise ball state ${JSON.stringify(value)}`);
}

function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const lengthSq = abx * abx + aby * aby;
  const t =
    lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lengthSq));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

/**
 * One frame of a ball's roll, each axis on its own: a step that would put the
 * ball's leading edge in a wall, solid kit or past the room's edge turns that
 * axis back instead. An open doorway is the room's edge here, so a ball never
 * rolls off down a corridor.
 */
function roll(
  x: number,
  y: number,
  vx: number,
  vy: number,
  floor: ExerciseBallFloor,
): { at: { x: number; y: number; vx: number; vy: number }; bounced: boolean } {
  const open = (px: number, py: number): boolean => {
    const tileX = Math.floor(px / TILE_SIZE);
    const tileY = Math.floor(py / TILE_SIZE);
    const room = floor.room;
    const inside =
      tileX >= room.x && tileY >= room.y && tileX < room.x + room.w && tileY < room.y + room.h;
    return inside && floor.isWalkable(tileX, tileY);
  };
  let nextVx = vx;
  let nextVy = vy;
  let bounced = false;
  let nextX = x + vx;
  const edgeX = nextX + Math.sign(vx) * EXERCISE_BALL_RADIUS_PX;
  if (vx !== 0 && !open(edgeX, y)) {
    nextVx = -vx;
    nextX = x;
    bounced = true;
  }
  let nextY = y + vy;
  const edgeY = nextY + Math.sign(vy) * EXERCISE_BALL_RADIUS_PX;
  if (vy !== 0 && !open(nextX, edgeY)) {
    nextVy = -vy;
    nextY = y;
    bounced = true;
  }
  if (
    !bounced &&
    !open(
      nextX + Math.sign(vx) * EXERCISE_BALL_RADIUS_PX,
      nextY + Math.sign(vy) * EXERCISE_BALL_RADIUS_PX,
    )
  ) {
    // A corner neither axis met on its own: back the way it came.
    nextVx = -vx;
    nextVy = -vy;
    nextX = x;
    nextY = y;
    bounced = true;
  }
  return { at: { x: nextX, y: nextY, vx: nextVx, vy: nextVy }, bounced };
}
