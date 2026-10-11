/**
 * Being seen in the Goblin High Security Prison, as pure geometry.
 *
 * A light is a polygon cast against the prison grid: a guard's flashlight is a
 * fan of rays from the lens that walls and tall cover stop, and a spotlight is
 * a disc of rays from its floor centre that only walls stop. The polygon
 * {@link castCone} or {@link castDisc} returns is the one object everything
 * reads — the lighting cuts it out of the darkness, and {@link lightSeesBody}
 * decides whether a crawler is caught in it — so the shape on screen and the
 * shape that catches are never two approximations of each other.
 *
 * No scene access: the headless solver in `npm run verify:prison-stealth`
 * calls these exact functions.
 */

import { TILE_SIZE } from '../../core/constants';
import { PRISON_TILE, prisonTileAt, type PrisonGrid } from '../../map/goblinPrisonPlan';
import type { PrisonConeTuning, PrisonSuspicionTuning } from './prisonTuning';

export interface PrisonPoint {
  readonly x: number;
  readonly y: number;
}

/** Which tiles stop a light: a flashlight is stopped by tall cover, a spotlight shines down over it. */
export type PrisonLightKind = 'cone' | 'disc';

export interface PrisonBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

interface LightShapeBase {
  /** Ray end points in pixels, in angular order. */
  readonly ends: ReadonlyArray<PrisonPoint>;
  /** Length of each ray in pixels, parallel to {@link ends}. */
  readonly rayLengths: ReadonlyArray<number>;
  readonly bounds: PrisonBounds;
}

/** A flashlight's lit area: the polygon is the origin followed by {@link LightShapeBase.ends}. */
export interface ConeShape extends LightShapeBase {
  readonly kind: 'cone';
  readonly origin: PrisonPoint;
  /** Radians, 0 = east, π/2 = south. */
  readonly facing: number;
  readonly halfAngle: number;
  readonly range: number;
  readonly softEdge: number;
}

/** A spotlight's floor disc: the polygon is {@link LightShapeBase.ends}, closed. */
export interface DiscShape extends LightShapeBase {
  readonly kind: 'disc';
  readonly centre: PrisonPoint;
  readonly radius: number;
}

export type LightShape = ConeShape | DiscShape;

/** Rays in every flashlight fan. Fixed, so a cone costs the same however it points. */
export const CONE_RAY_COUNT = 33;
/** Rays round every spotlight disc. */
export const DISC_RAY_COUNT = 48;

/**
 * Where a body is sampled, relative to its centre: the centre and both feet.
 * A crawler half behind a corner is seen by the foot that sticks out.
 */
const FOOT_DROP_PX = 10;
const FOOT_SPREAD_PX = 6;

/**
 * How close a crawler may come to a guard's centre before it is a catch. Under
 * a tile, so a crawler can stand in an alcove beside the corridor a guard
 * walks down without brushing it.
 */
export const GUARD_TOUCH_RADIUS_PX = 28;

/**
 * How far in front of a guard a crawler is caught outright, whatever its
 * suspicion: the adjacent tile, measured from the guard's centre.
 */
const GUARD_FRONT_REACH_TILES = 1.5;
export const GUARD_FRONT_REACH_PX = TILE_SIZE * GUARD_FRONT_REACH_TILES;
/** How far either side of a guard's facing "in front" reaches. */
const GUARD_FRONT_HALF_ANGLE_DEG = 25;

const FULL_TURN = Math.PI * 2;
const DEGREES_PER_HALF_TURN = 180;
export const DEGREES_TO_RADIANS = Math.PI / DEGREES_PER_HALF_TURN;

export function blocksLight(
  grid: PrisonGrid,
  tileX: number,
  tileY: number,
  kind: PrisonLightKind,
): boolean {
  const code = prisonTileAt(grid, tileX, tileY);
  switch (code) {
    case PRISON_TILE.floor:
    case PRISON_TILE.holdingFloor:
    case PRISON_TILE.prisonerFloor:
    case PRISON_TILE.pedestal:
      return false;
    case PRISON_TILE.cover:
      return kind === 'cone';
    case PRISON_TILE.wall:
    case PRISON_TILE.bars:
    case PRISON_TILE.holdingDoor:
      return true;
  }
}

/**
 * How far a ray from `origin` travels at `angle` before it meets a tile that
 * blocks `kind`, capped at `maxLength`. Zero when the origin itself sits in one.
 */
export function castRay(
  grid: PrisonGrid,
  origin: PrisonPoint,
  angle: number,
  maxLength: number,
  kind: PrisonLightKind,
): number {
  let tileX = Math.floor(origin.x / TILE_SIZE);
  let tileY = Math.floor(origin.y / TILE_SIZE);
  if (blocksLight(grid, tileX, tileY, kind)) return 0;
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  const stepX = dirX > 0 ? 1 : -1;
  const stepY = dirY > 0 ? 1 : -1;
  const nextBoundaryX = dirX > 0 ? (tileX + 1) * TILE_SIZE : tileX * TILE_SIZE;
  const nextBoundaryY = dirY > 0 ? (tileY + 1) * TILE_SIZE : tileY * TILE_SIZE;
  let travelToX = dirX === 0 ? Infinity : (nextBoundaryX - origin.x) / dirX;
  let travelToY = dirY === 0 ? Infinity : (nextBoundaryY - origin.y) / dirY;
  const travelPerTileX = dirX === 0 ? Infinity : TILE_SIZE / Math.abs(dirX);
  const travelPerTileY = dirY === 0 ? Infinity : TILE_SIZE / Math.abs(dirY);
  for (;;) {
    let travelled: number;
    if (travelToX < travelToY) {
      travelled = travelToX;
      tileX += stepX;
      travelToX += travelPerTileX;
    } else {
      travelled = travelToY;
      tileY += stepY;
      travelToY += travelPerTileY;
    }
    if (travelled >= maxLength) return maxLength;
    if (blocksLight(grid, tileX, tileY, kind)) return travelled;
  }
}

/**
 * Whether nothing that blocks `kind` lies between two points. The tiles both
 * points stand in are never tested, so a lens pressed to a wall still lights
 * the room in front of it.
 */
export function lightHasLineOfSight(
  grid: PrisonGrid,
  from: PrisonPoint,
  to: PrisonPoint,
  kind: PrisonLightKind,
): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return true;
  const endTileX = Math.floor(to.x / TILE_SIZE);
  const endTileY = Math.floor(to.y / TILE_SIZE);
  let tileX = Math.floor(from.x / TILE_SIZE);
  let tileY = Math.floor(from.y / TILE_SIZE);
  const dirX = dx / distance;
  const dirY = dy / distance;
  const stepX = dirX > 0 ? 1 : -1;
  const stepY = dirY > 0 ? 1 : -1;
  const nextBoundaryX = dirX > 0 ? (tileX + 1) * TILE_SIZE : tileX * TILE_SIZE;
  const nextBoundaryY = dirY > 0 ? (tileY + 1) * TILE_SIZE : tileY * TILE_SIZE;
  let travelToX = dirX === 0 ? Infinity : (nextBoundaryX - from.x) / dirX;
  let travelToY = dirY === 0 ? Infinity : (nextBoundaryY - from.y) / dirY;
  const travelPerTileX = dirX === 0 ? Infinity : TILE_SIZE / Math.abs(dirX);
  const travelPerTileY = dirY === 0 ? Infinity : TILE_SIZE / Math.abs(dirY);
  for (;;) {
    if (travelToX < travelToY) {
      if (travelToX >= distance) return true;
      tileX += stepX;
      travelToX += travelPerTileX;
    } else {
      if (travelToY >= distance) return true;
      tileY += stepY;
      travelToY += travelPerTileY;
    }
    if (tileX === endTileX && tileY === endTileY) return true;
    if (blocksLight(grid, tileX, tileY, kind)) return false;
  }
}

function boundsOf(points: ReadonlyArray<PrisonPoint>): PrisonBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

/** A guard's flashlight cone, cast from `origin` along `facing` (radians). */
export function castCone(
  grid: PrisonGrid,
  origin: PrisonPoint,
  facing: number,
  tuning: PrisonConeTuning,
): ConeShape {
  const halfAngle = tuning.halfAngleDeg * DEGREES_TO_RADIANS;
  const range = tuning.rangeTiles * TILE_SIZE;
  const ends: PrisonPoint[] = [];
  const rayLengths: number[] = [];
  const raySpacing = (halfAngle * 2) / (CONE_RAY_COUNT - 1);
  for (let i = 0; i < CONE_RAY_COUNT; i++) {
    const angle = facing - halfAngle + i * raySpacing;
    const length = castRay(grid, origin, angle, range, 'cone');
    rayLengths.push(length);
    ends.push({ x: origin.x + Math.cos(angle) * length, y: origin.y + Math.sin(angle) * length });
  }
  return {
    kind: 'cone',
    origin,
    facing,
    halfAngle,
    range,
    softEdge: tuning.softEdge,
    ends,
    rayLengths,
    bounds: boundsOf([origin, ...ends]),
  };
}

/** A spotlight's floor disc, centred where the beam lands. */
export function castDisc(grid: PrisonGrid, centre: PrisonPoint, radius: number): DiscShape {
  const ends: PrisonPoint[] = [];
  const rayLengths: number[] = [];
  for (let i = 0; i < DISC_RAY_COUNT; i++) {
    const angle = (i / DISC_RAY_COUNT) * FULL_TURN;
    const length = castRay(grid, centre, angle, radius, 'disc');
    rayLengths.push(length);
    ends.push({ x: centre.x + Math.cos(angle) * length, y: centre.y + Math.sin(angle) * length });
  }
  return { kind: 'disc', centre, radius, ends, rayLengths, bounds: boundsOf([centre, ...ends]) };
}

/** Wraps an angle into (-π, π]. */
export function wrapAngle(angle: number): number {
  let wrapped = angle % FULL_TURN;
  if (wrapped > Math.PI) wrapped -= FULL_TURN;
  if (wrapped <= -Math.PI) wrapped += FULL_TURN;
  return wrapped;
}

/** Whether `point` lies on the origin's side of the chord between two ray ends (inside that wedge's triangle). */
function insideWedge(
  origin: PrisonPoint,
  a: PrisonPoint,
  b: PrisonPoint,
  point: PrisonPoint,
): boolean {
  const chordX = b.x - a.x;
  const chordY = b.y - a.y;
  const originSide = chordX * (origin.y - a.y) - chordY * (origin.x - a.x);
  const pointSide = chordX * (point.y - a.y) - chordY * (point.x - a.x);
  return originSide === 0 ? pointSide === 0 : originSide * pointSide >= 0;
}

function fadeWeight(fraction: number, softEdge: number, edgeWeight: number): number {
  const fadeStart = 1 - softEdge;
  if (fraction <= fadeStart || softEdge <= 0) return 1;
  const intoFade = Math.min(1, (fraction - fadeStart) / softEdge);
  return 1 + (edgeWeight - 1) * intoFade;
}

/**
 * How strongly a light sees one point: 0 when the point is outside the
 * polygon or the light's source has no line of sight to it. A cone sees its
 * axis and near range at 1, fading to `edgeWeight` across its soft edge; a
 * disc sees everything inside it at 1.
 */
export function lightCoversPoint(
  grid: PrisonGrid,
  shape: LightShape,
  point: PrisonPoint,
  edgeWeight: number,
): number {
  const { bounds } = shape;
  if (
    point.x < bounds.minX ||
    point.x > bounds.maxX ||
    point.y < bounds.minY ||
    point.y > bounds.maxY
  ) {
    return 0;
  }
  if (shape.kind === 'cone') {
    const dx = point.x - shape.origin.x;
    const dy = point.y - shape.origin.y;
    const distance = Math.hypot(dx, dy);
    if (distance > shape.range) return 0;
    const offAxis = wrapAngle(Math.atan2(dy, dx) - shape.facing);
    if (Math.abs(offAxis) > shape.halfAngle) return 0;
    const raySpacing = (shape.halfAngle * 2) / (CONE_RAY_COUNT - 1);
    const lower = Math.min(
      CONE_RAY_COUNT - 2,
      Math.floor((offAxis + shape.halfAngle) / raySpacing),
    );
    const a = shape.ends[lower];
    const b = shape.ends[lower + 1];
    if (distance > 0 && !insideWedge(shape.origin, a, b, point)) return 0;
    if (!lightHasLineOfSight(grid, shape.origin, point, 'cone')) return 0;
    const axisWeight = fadeWeight(Math.abs(offAxis) / shape.halfAngle, shape.softEdge, edgeWeight);
    const rangeWeight = fadeWeight(distance / shape.range, shape.softEdge, edgeWeight);
    return axisWeight * rangeWeight;
  }
  const dx = point.x - shape.centre.x;
  const dy = point.y - shape.centre.y;
  const distance = Math.hypot(dx, dy);
  if (distance > shape.radius) return 0;
  if (distance > 0) {
    const bearing = (Math.atan2(dy, dx) + FULL_TURN) % FULL_TURN;
    const raySpacing = FULL_TURN / DISC_RAY_COUNT;
    const lower = Math.floor(bearing / raySpacing) % DISC_RAY_COUNT;
    const a = shape.ends[lower];
    const b = shape.ends[(lower + 1) % DISC_RAY_COUNT];
    if (!insideWedge(shape.centre, a, b, point)) return 0;
  }
  if (!lightHasLineOfSight(grid, shape.centre, point, 'disc')) return 0;
  return 1;
}

/** The points a crawler is sampled at, from its body centre: the centre and both feet. */
export function bodySamplePoints(centre: PrisonPoint): ReadonlyArray<PrisonPoint> {
  return [
    centre,
    { x: centre.x - FOOT_SPREAD_PX, y: centre.y + FOOT_DROP_PX },
    { x: centre.x + FOOT_SPREAD_PX, y: centre.y + FOOT_DROP_PX },
  ];
}

/** How strongly a light sees a crawler standing with its body centre at `centre`: the best of its samples. */
export function lightSeesBody(
  grid: PrisonGrid,
  shape: LightShape,
  centre: PrisonPoint,
  edgeWeight: number,
): number {
  let best = 0;
  for (const sample of bodySamplePoints(centre)) {
    best = Math.max(best, lightCoversPoint(grid, shape, sample, edgeWeight));
    if (best >= 1) break;
  }
  return best;
}

/**
 * One frame of a light's suspicion. `seenWeight` is the strongest
 * {@link lightSeesBody} over every crawler, 0 when it sees none.
 */
export function stepSuspicion(
  value: number,
  kind: PrisonLightKind,
  seenWeight: number,
  tuning: PrisonSuspicionTuning,
): number {
  if (seenWeight <= 0) return Math.max(0, value - SUSPICION_CAPTURE / tuning.drainFrames);
  const rise =
    kind === 'cone'
      ? (SUSPICION_CAPTURE / tuning.coneFillFrames) * seenWeight
      : SUSPICION_CAPTURE / tuning.spotFillFrames;
  return Math.min(SUSPICION_CAPTURE, value + rise);
}

/** The suspicion at which a capture starts. */
export const SUSPICION_CAPTURE = 1;

/** A guard as touch sees it: where it stands and which way it faces (radians). */
export interface GuardBody {
  readonly x: number;
  readonly y: number;
  readonly facing: number;
}

/**
 * Whether a crawler is caught by walking into a guard: bumping it from any
 * side, or stepping onto the tile right in front of it with nothing that would
 * stop its flashlight in between, so a guard never catches round a corner.
 */
export function bodyTouchesGuard(
  grid: PrisonGrid,
  guard: GuardBody,
  bodyCentre: PrisonPoint,
): boolean {
  const dx = bodyCentre.x - guard.x;
  const dy = bodyCentre.y - guard.y;
  const distance = Math.hypot(dx, dy);
  if (distance < GUARD_TOUCH_RADIUS_PX) return true;
  if (distance > GUARD_FRONT_REACH_PX) return false;
  const offFacing = Math.abs(wrapAngle(Math.atan2(dy, dx) - guard.facing));
  if (offFacing > GUARD_FRONT_HALF_ANGLE_DEG * DEGREES_TO_RADIANS) return false;
  return lightHasLineOfSight(grid, guard, bodyCentre, 'cone');
}
