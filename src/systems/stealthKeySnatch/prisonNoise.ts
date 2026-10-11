/**
 * What a guard does about a noise, as a pure model.
 *
 * A guard whose flashlight is on the spot when something goes off raises the
 * alarm at once: it watched the crawlers do it. A guard that only hears it —
 * within the noise's radius, with a walk there that is not a long detour —
 * steps off its loop, turns its light toward the noise, walks to the spot,
 * sweeps, then walks back to the nearest tile of its own route and picks the
 * loop up from the moment it would have stood there. Suspicion keeps running
 * the whole time, which is why a noise usually brings a cone onto you.
 *
 * A guard that was hit answers the blow however far off it was thrown from:
 * it felt it, so the radius does not apply to it, only to everyone else.
 */

import { TILE_SIZE } from '../../core/constants';
import {
  isPrisonGuardWalkable,
  type PrisonGrid,
  type PrisonTile,
} from '../../map/goblinPrisonPlan';
import { DEGREES_TO_RADIANS, lightCoversPoint, wrapAngle, type PrisonPoint } from './detection';
import {
  guardCone,
  guardPoseAt,
  poseOnSegments,
  tileCentrePx,
  type CompiledGuard,
  type CompiledPrison,
  type GuardPose,
  type GuardSegment,
} from './prisonPatrols';
import {
  INVESTIGATION_PATH_SLACK,
  INVESTIGATION_SWEEP_FRAMES,
  INVESTIGATION_SWEEP_HALF_ARC_DEG,
  PRISON_NOISE_RADIUS_TILES,
  type PrisonNoiseKind,
} from './prisonTuning';

export interface PrisonNoise {
  readonly kind: PrisonNoiseKind;
  readonly at: PrisonPoint;
  /**
   * The guard a blow landed on, when the noise is that blow heard from where
   * it was thrown. That guard felt it, so it answers however far off the
   * thrower stands; every other guard keeps to the noise's radius.
   */
  readonly struckGuardId?: string;
}

/** A guard's walk to a noise and back onto its loop, timed from the frame the noise was made. */
export interface InvestigationPlan {
  readonly guardId: string;
  readonly segments: ReadonlyArray<GuardSegment>;
  readonly totalFrames: number;
  /** The tile the guard sweeps from. */
  readonly spot: PrisonTile;
  /** The route tile it walks back to. */
  readonly rejoin: PrisonTile;
  /** The loop frame at which the patrol stands on {@link rejoin}; the loop resumes from there. */
  readonly rejoinLoopFrame: number;
}

export type GuardNoiseResponse =
  | { readonly kind: 'alarm' }
  | { readonly kind: 'investigate'; readonly plan: InvestigationPlan }
  | { readonly kind: 'ignore' };

/** The weight passed to coverage checks that only ask yes or no. */
const ANY_COVERAGE_WEIGHT = 1;

const STEPS: ReadonlyArray<PrisonTile> = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

function tileOf(point: PrisonPoint): PrisonTile {
  return { x: Math.floor(point.x / TILE_SIZE), y: Math.floor(point.y / TILE_SIZE) };
}

/**
 * Breadth-first walk over open floor from `start` to the first tile `isGoal`
 * accepts, at most `maxSteps` long. The path includes both ends.
 */
function walkTo(
  grid: PrisonGrid,
  start: PrisonTile,
  isGoal: (tile: PrisonTile) => boolean,
  maxSteps: number,
): ReadonlyArray<PrisonTile> | null {
  const index = (tile: PrisonTile): number => tile.y * grid.width + tile.x;
  const parent = new Int32Array(grid.width * grid.height).fill(-1);
  const depth = new Int32Array(grid.width * grid.height);
  const startIndex = index(start);
  parent[startIndex] = startIndex;
  const queue: PrisonTile[] = [start];
  for (const tile of queue) {
    const tileIndex = index(tile);
    if (isGoal(tile)) {
      const path: PrisonTile[] = [];
      let cursor = tileIndex;
      while (cursor !== startIndex) {
        path.push({ x: cursor % grid.width, y: Math.floor(cursor / grid.width) });
        cursor = parent[cursor] ?? startIndex;
      }
      path.push(start);
      return path.reverse();
    }
    if ((depth[tileIndex] ?? 0) >= maxSteps) continue;
    for (const step of STEPS) {
      const next = { x: tile.x + step.x, y: tile.y + step.y };
      if (!isPrisonGuardWalkable(grid, next.x, next.y)) continue;
      const nextIndex = index(next);
      if ((parent[nextIndex] ?? 0) !== -1) continue;
      parent[nextIndex] = tileIndex;
      depth[nextIndex] = (depth[tileIndex] ?? 0) + 1;
      queue.push(next);
    }
  }
  return null;
}

interface TimelineCursor {
  readonly segments: GuardSegment[];
  clock: number;
  facing: number;
  at: PrisonPoint;
}

function turnTo(cursor: TimelineCursor, target: number, turnRate: number): void {
  const by = wrapAngle(target - cursor.facing);
  if (by === 0) return;
  const frames = Math.ceil(Math.abs(by) / turnRate);
  cursor.segments.push({
    kind: 'turn',
    start: cursor.clock,
    frames,
    at: cursor.at,
    from: cursor.facing,
    by,
  });
  cursor.clock += frames;
  cursor.facing = wrapAngle(cursor.facing + by);
}

function walkPath(
  cursor: TimelineCursor,
  path: ReadonlyArray<PrisonTile>,
  speed: number,
  turnRate: number,
): void {
  for (const tile of path) {
    const to = tileCentrePx(tile);
    const distance = Math.hypot(to.x - cursor.at.x, to.y - cursor.at.y);
    if (distance === 0) continue;
    const heading = Math.atan2(to.y - cursor.at.y, to.x - cursor.at.x);
    turnTo(cursor, heading, turnRate);
    const frames = Math.ceil(distance / speed);
    cursor.segments.push({
      kind: 'move',
      start: cursor.clock,
      frames,
      from: cursor.at,
      to,
      facing: heading,
    });
    cursor.clock += frames;
    cursor.at = to;
  }
}

/** Whether a guard standing in `pose` on `frame` of the shared clock has the point in its flashlight. */
export function guardSeesPoint(
  compiled: CompiledPrison,
  pose: GuardPose,
  frame: number,
  point: PrisonPoint,
): boolean {
  const cone = guardCone(compiled, pose, frame);
  return lightCoversPoint(compiled.parsed.grid, cone, point, ANY_COVERAGE_WEIGHT) > 0;
}

/**
 * How one guard answers a noise made while it stands in `pose`.
 *
 * A guard already off its loop is handed in by its current pose; its rejoin
 * is still worked out against its own route. `frame` is the shared clock the
 * noise was made on, which the guard's art and so its lens follow.
 */
export function respondToNoise(
  compiled: CompiledPrison,
  guard: CompiledGuard,
  pose: GuardPose,
  frame: number,
  noise: PrisonNoise,
): GuardNoiseResponse {
  if (guardSeesPoint(compiled, pose, frame, noise.at)) return { kind: 'alarm' };
  const { grid } = compiled.parsed;
  const struck = noise.struckGuardId === guard.def.id;
  const distanceTiles = Math.hypot(noise.at.x - pose.x, noise.at.y - pose.y) / TILE_SIZE;
  const radiusTiles = PRISON_NOISE_RADIUS_TILES[noise.kind];
  if (!struck && distanceTiles > radiusTiles) return { kind: 'ignore' };
  const reachTiles = struck ? Math.max(radiusTiles, distanceTiles) : radiusTiles;
  const maxSteps = Math.ceil(reachTiles * INVESTIGATION_PATH_SLACK);
  const noiseTile = tileOf(noise.at);
  const isNearNoise = (tile: PrisonTile): boolean =>
    Math.abs(tile.x - noiseTile.x) + Math.abs(tile.y - noiseTile.y) <= 1 &&
    (tile.x === noiseTile.x && tile.y === noiseTile.y
      ? true
      : !isPrisonGuardWalkable(grid, noiseTile.x, noiseTile.y));
  const there = walkTo(grid, tileOf(pose), isNearNoise, maxSteps);
  if (there === null) return { kind: 'ignore' };
  const spot = there[there.length - 1] ?? tileOf(pose);
  const routeKeys = new Map(
    guard.routeTiles.map((entry) => [`${entry.tile.x},${entry.tile.y}`, entry.loopFrame]),
  );
  const back = walkTo(
    grid,
    spot,
    (tile) => routeKeys.has(`${tile.x},${tile.y}`),
    grid.width * grid.height,
  );
  if (back === null) return { kind: 'ignore' };
  const rejoin = back[back.length - 1] ?? spot;
  const rejoinLoopFrame = routeKeys.get(`${rejoin.x},${rejoin.y}`) ?? 0;

  const turnRate = compiled.tuning.turnDegPerFrame * DEGREES_TO_RADIANS;
  const speed = compiled.tuning.patrolSpeedPxPerFrame;
  const cursor: TimelineCursor = {
    segments: [],
    clock: 0,
    facing: pose.facing,
    at: { x: pose.x, y: pose.y },
  };
  turnTo(cursor, Math.atan2(noise.at.y - pose.y, noise.at.x - pose.x), turnRate);
  walkPath(cursor, there, speed, turnRate);
  const spotCentre = tileCentrePx(spot);
  const bearingToNoise =
    noise.at.x === spotCentre.x && noise.at.y === spotCentre.y
      ? cursor.facing
      : Math.atan2(noise.at.y - spotCentre.y, noise.at.x - spotCentre.x);
  turnTo(cursor, bearingToNoise, turnRate);
  cursor.segments.push({
    kind: 'sweep',
    start: cursor.clock,
    frames: INVESTIGATION_SWEEP_FRAMES,
    at: cursor.at,
    facing: cursor.facing,
    halfArc: INVESTIGATION_SWEEP_HALF_ARC_DEG * DEGREES_TO_RADIANS,
  });
  cursor.clock += INVESTIGATION_SWEEP_FRAMES;
  walkPath(cursor, back, speed, turnRate);
  turnTo(cursor, guardPoseAt(guard, rejoinLoopFrame).facing, turnRate);
  return {
    kind: 'investigate',
    plan: {
      guardId: guard.def.id,
      segments: cursor.segments,
      totalFrames: cursor.clock,
      spot,
      rejoin,
      rejoinLoopFrame,
    },
  };
}

/** Where an investigating guard stands `framesSinceNoise` frames after the noise, and whether it is back on its loop. */
export function investigationPoseAt(
  plan: InvestigationPlan,
  startPose: GuardPose,
  framesSinceNoise: number,
): { readonly pose: GuardPose; readonly done: boolean } {
  if (plan.segments.length === 0)
    return { pose: startPose, done: framesSinceNoise >= plan.totalFrames };
  return {
    pose: poseOnSegments(plan.guardId, plan.segments, Math.min(framesSinceNoise, plan.totalFrames)),
    done: framesSinceNoise >= plan.totalFrames,
  };
}

/**
 * The loop shift that resumes a guard's patrol after an investigation that
 * began on `noiseFrame`: afterwards its pose on frame `f` is
 * `guardPoseAt(guard, f - shift)`.
 */
export function loopShiftAfter(plan: InvestigationPlan, noiseFrame: number): number {
  return noiseFrame + plan.totalFrames - plan.rejoinLoopFrame;
}
