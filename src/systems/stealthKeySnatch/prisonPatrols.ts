/**
 * The prison's guards and spotlights as deterministic loops.
 *
 * Each patrol script and spotlight track compiles, per difficulty, into a
 * timeline whose period divides the layout's `cycleFrames`. {@link prisonStateAt}
 * is then a pure function of the frame number: the runtime asks it where every
 * guard stands and every beam lands, and the headless solver asks it the same
 * question for every frame of the cycle. Nothing here keeps state; a noise
 * investigation is the only thing that steps a guard off its loop, and
 * `prisonNoise.ts` hands back the offset that puts it on again.
 */

import { TILE_SIZE } from '../../core/constants';
import type { Difficulty } from '../../core/difficulty/difficultyProfiles';
import type {
  PrisonGuardDef,
  PrisonSpotlightDef,
  StealthGuardDef,
  StealthSpotlightDef,
} from '../../map/goblinPrisonLayouts';
import {
  isPrisonGuardWalkable,
  type ParsedPrisonLayout,
  type PrisonTile,
  type StealthFloor,
} from '../../map/goblinPrisonPlan';
import {
  GOBLIN_GUARD_WALK_GROUND_PER_CYCLE_TILES,
  guardLensAnchor,
  type GoblinGuardState,
} from '../../sprites/goblinGuardSprite';
import { GOBLIN_GUARD_ROWS } from '../../sprites/art/goblinGuardFigure';
import {
  blocksLight,
  castCone,
  castDisc,
  DEGREES_TO_RADIANS,
  lightHasLineOfSight,
  wrapAngle,
  type ConeShape,
  type LightShape,
  type PrisonPoint,
} from './detection';
import { PRISON_TUNING, type PrisonDifficultyTuning } from './prisonTuning';

/** What a guard's timeline has it doing: the kind of segment it stands in. */
export type GuardActivity = GuardSegment['kind'];

/** Where a guard is and which way its light points, at one frame. */
export interface GuardPose {
  readonly id: string;
  /** Body centre, in pixels. */
  readonly x: number;
  readonly y: number;
  /** Radians, 0 = east, π/2 = south. */
  readonly facing: number;
  readonly moving: boolean;
  readonly activity: GuardActivity;
}

/** Where a spotlight's disc lands, and the tower its beam comes from, at one frame. */
export interface SpotPose {
  readonly id: string;
  readonly centre: PrisonPoint;
  readonly anchor: PrisonPoint;
}

/** One stretch of a guard's timeline. Patrol loops and noise investigations are both lists of these. */
export type GuardSegment =
  | {
      readonly kind: 'move';
      readonly start: number;
      readonly frames: number;
      readonly from: PrisonPoint;
      readonly to: PrisonPoint;
      readonly facing: number;
    }
  | {
      readonly kind: 'turn';
      readonly start: number;
      readonly frames: number;
      readonly at: PrisonPoint;
      readonly from: number;
      /** Signed turn in radians, so a half-turn goes the way it was scripted. */
      readonly by: number;
    }
  | {
      readonly kind: 'hold';
      readonly start: number;
      readonly frames: number;
      readonly at: PrisonPoint;
      readonly facing: number;
    }
  | {
      readonly kind: 'sweep';
      readonly start: number;
      readonly frames: number;
      readonly at: PrisonPoint;
      readonly facing: number;
      readonly halfArc: number;
    };

export interface CompiledGuard<D extends StealthGuardDef = StealthGuardDef> {
  readonly def: D;
  /** The loop's own length before it is padded to divide the cycle. */
  readonly naturalFrames: number;
  readonly periodFrames: number;
  readonly segments: ReadonlyArray<GuardSegment>;
  /** Every tile the guard walks through, with the first loop frame it stands centred on it. */
  readonly routeTiles: ReadonlyArray<{ readonly tile: PrisonTile; readonly loopFrame: number }>;
}

export interface CompiledSpotlight<S extends StealthSpotlightDef = StealthSpotlightDef> {
  readonly def: S;
  readonly naturalFrames: number;
  readonly periodFrames: number;
  readonly anchor: PrisonPoint;
  readonly radius: number;
  readonly centreAt: (loopFrame: number) => PrisonPoint;
}

/**
 * Where a guard's cone starts. The prison's goblins hold a flashlight out in
 * front of them, read off the art's own lens; a guard with no light of its
 * own looks out from a point just ahead of its face.
 */
export type GuardLens = 'flashlight' | 'eyes';

/** Any stealth floor's patrols and lights compiled for one difficulty: all the runtime and the solver read. */
export interface CompiledStealth {
  readonly parsed: StealthFloor;
  readonly difficulty: Difficulty;
  readonly tuning: PrisonDifficultyTuning;
  readonly lens: GuardLens;
  readonly cycleFrames: number;
  readonly guards: ReadonlyArray<CompiledGuard>;
  readonly spotlights: ReadonlyArray<CompiledSpotlight>;
}

export interface CompiledPrison extends CompiledStealth {
  readonly parsed: ParsedPrisonLayout;
  readonly guards: ReadonlyArray<CompiledGuard<PrisonGuardDef>>;
  readonly spotlights: ReadonlyArray<CompiledSpotlight<PrisonSpotlightDef>>;
}

export class PrisonScriptError extends Error {}

const HALF_TURN = Math.PI;
/** Turns smaller than this are taken as already facing; avoids zero-length turn segments from float noise. */
const FACING_EPSILON = 1e-6;

const COMPASS_FACING: Readonly<Partial<Record<string, number>>> = {
  E: 0,
  S: Math.PI / 2,
  W: Math.PI,
  N: -Math.PI / 2,
};

/** From a tile's corner to its centre, in tiles. */
const TILE_CENTRE_OFFSET = 0.5;

export function tileCentrePx(tile: PrisonTile): PrisonPoint {
  return {
    x: (tile.x + TILE_CENTRE_OFFSET) * TILE_SIZE,
    y: (tile.y + TILE_CENTRE_OFFSET) * TILE_SIZE,
  };
}

/** An element by index, or undefined past either end. */
function elementAt<T>(items: ReadonlyArray<T>, index: number): T | undefined {
  return index >= 0 && index < items.length ? items[index] : undefined;
}

function positiveModulo(value: number, period: number): number {
  return ((value % period) + period) % period;
}

/** The shortest period at least `naturalFrames` long that divides `cycleFrames`. */
export function periodWithinCycle(
  naturalFrames: number,
  cycleFrames: number,
  label: string,
): number {
  if (naturalFrames > cycleFrames) {
    throw new PrisonScriptError(
      `${label} needs ${Math.ceil(naturalFrames)} frames, longer than the ${cycleFrames}-frame cycle`,
    );
  }
  for (let loops = Math.floor(cycleFrames / Math.max(1, naturalFrames)); loops >= 1; loops--) {
    if (cycleFrames % loops === 0) return cycleFrames / loops;
  }
  return cycleFrames;
}

function waypoint(parsed: StealthFloor, name: string, label: string): PrisonTile {
  const tile = parsed.waypoints.get(name);
  if (tile === undefined) throw new PrisonScriptError(`${label}: no point "${name}" in the layout`);
  return tile;
}

interface GuardBuild {
  readonly segments: GuardSegment[];
  readonly endFacing: number;
  readonly end: PrisonTile;
}

function buildGuardSegments(
  parsed: StealthFloor,
  def: StealthGuardDef,
  tuning: PrisonDifficultyTuning,
  startFacing: number,
): GuardBuild {
  const tokens = def.script.trim().split(/\s+/);
  const [startName, ...commands] = tokens;
  if (startName === '') throw new PrisonScriptError(`${def.id}: empty script`);
  let at = waypoint(parsed, startName, def.id);
  let facing = startFacing;
  let clock = 0;
  const segments: GuardSegment[] = [];
  const turnRate = tuning.turnDegPerFrame * DEGREES_TO_RADIANS;

  const turnBy = (by: number): void => {
    if (Math.abs(by) < FACING_EPSILON) return;
    const frames = Math.ceil(Math.abs(by) / turnRate);
    segments.push({ kind: 'turn', start: clock, frames, at: tileCentrePx(at), from: facing, by });
    clock += frames;
    facing = wrapAngle(facing + by);
  };

  for (const command of commands) {
    const head = command[0];
    const body = command.slice(1);
    if (head === '>') {
      const target = waypoint(parsed, body, def.id);
      if (target.x !== at.x && target.y !== at.y) {
        throw new PrisonScriptError(
          `${def.id}: walk ${startName}…>${body} is not straight along a row or column`,
        );
      }
      const from = tileCentrePx(at);
      const to = tileCentrePx(target);
      const heading = Math.atan2(to.y - from.y, to.x - from.x);
      turnBy(wrapAngle(heading - facing));
      const frames = Math.ceil(
        Math.hypot(to.x - from.x, to.y - from.y) / tuning.patrolSpeedPxPerFrame,
      );
      segments.push({ kind: 'move', start: clock, frames, from, to, facing: heading });
      clock += frames;
      at = target;
    } else if (head === 'p') {
      const frames = Number(body);
      if (!Number.isInteger(frames) || frames <= 0)
        throw new PrisonScriptError(`${def.id}: bad pause "${command}"`);
      segments.push({ kind: 'hold', start: clock, frames, at: tileCentrePx(at), facing });
      clock += frames;
    } else if (head === 's') {
      const [arcText, framesText] = body.split('/');
      const halfArc = Number(arcText) * DEGREES_TO_RADIANS;
      const frames = Number(framesText);
      if (!(halfArc > 0) || !Number.isInteger(frames) || frames <= 0) {
        throw new PrisonScriptError(`${def.id}: bad sweep "${command}"`);
      }
      segments.push({ kind: 'sweep', start: clock, frames, at: tileCentrePx(at), facing, halfArc });
      clock += frames;
    } else if (head === 'l') {
      const frames = Number(body);
      if (!Number.isInteger(frames) || frames <= 0)
        throw new PrisonScriptError(`${def.id}: bad look-back "${command}"`);
      turnBy(HALF_TURN);
      segments.push({ kind: 'hold', start: clock, frames, at: tileCentrePx(at), facing });
      clock += frames;
      turnBy(-HALF_TURN);
    } else if (head === 'f') {
      const target = COMPASS_FACING[body];
      if (target === undefined) throw new PrisonScriptError(`${def.id}: bad facing "${command}"`);
      turnBy(wrapAngle(target - facing));
    } else {
      throw new PrisonScriptError(`${def.id}: unknown command "${command}"`);
    }
  }
  return { segments, endFacing: facing, end: at };
}

function firstMoveHeading(parsed: StealthFloor, def: StealthGuardDef): number {
  const firstWalk = def.script.split(/\s+/).find((token) => token.startsWith('>'));
  const startName = def.script.trim().split(/\s+/)[0] ?? '';
  if (firstWalk === undefined) return 0;
  const from = tileCentrePx(waypoint(parsed, startName, def.id));
  const to = tileCentrePx(waypoint(parsed, firstWalk.slice(1), def.id));
  return Math.atan2(to.y - from.y, to.x - from.x);
}

function routeTilesOf(
  segments: ReadonlyArray<GuardSegment>,
): ReadonlyArray<{ tile: PrisonTile; loopFrame: number }> {
  const seen = new Set<string>();
  const tiles: Array<{ tile: PrisonTile; loopFrame: number }> = [];
  const record = (point: PrisonPoint, loopFrame: number): void => {
    const tile = { x: Math.floor(point.x / TILE_SIZE), y: Math.floor(point.y / TILE_SIZE) };
    const key = `${tile.x},${tile.y}`;
    if (seen.has(key)) return;
    seen.add(key);
    tiles.push({ tile, loopFrame: Math.round(loopFrame) });
  };
  for (const segment of segments) {
    if (segment.kind !== 'move') {
      record(segment.at, segment.start);
      continue;
    }
    const length = Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y);
    const steps = Math.round(length / TILE_SIZE);
    for (let step = 0; step <= steps; step++) {
      const fraction = steps === 0 ? 0 : step / steps;
      record(
        {
          x: segment.from.x + (segment.to.x - segment.from.x) * fraction,
          y: segment.from.y + (segment.to.y - segment.from.y) * fraction,
        },
        segment.start + segment.frames * fraction,
      );
    }
  }
  return tiles;
}

/**
 * Compiles one guard's script for a difficulty.
 *
 * The loop starts facing the way it ends, so the first frame of a cycle and
 * the frame after its last are the same pose and the loop never snaps.
 *
 * @throws {PrisonScriptError} on an unknown point or command, a walk that is
 *   not along a row or column, a loop that does not end where it starts, or a
 *   loop longer than the cycle.
 */
function compileGuard<D extends StealthGuardDef>(
  parsed: StealthFloor,
  def: D,
  tuning: PrisonDifficultyTuning,
): CompiledGuard<D> {
  const draft = buildGuardSegments(parsed, def, tuning, firstMoveHeading(parsed, def));
  const build = buildGuardSegments(parsed, def, tuning, draft.endFacing);
  const startName = def.script.trim().split(/\s+/)[0] ?? '';
  const start = waypoint(parsed, startName, def.id);
  if (build.end.x !== start.x || build.end.y !== start.y) {
    throw new PrisonScriptError(`${def.id}: the loop ends away from its start "${startName}"`);
  }
  const last = elementAt(build.segments, build.segments.length - 1);
  const naturalFrames = last === undefined ? 1 : last.start + last.frames;
  const periodFrames = periodWithinCycle(naturalFrames, parsed.layout.cycleFrames, def.id);
  const segments = [...build.segments];
  const padFrames = periodFrames - naturalFrames;
  if (padFrames > 0 || segments.length === 0) {
    segments.push({
      kind: 'hold',
      start: naturalFrames,
      frames: Math.max(1, padFrames),
      at: tileCentrePx(start),
      facing: build.endFacing,
    });
  }
  return { def, naturalFrames, periodFrames, segments, routeTiles: routeTilesOf(segments) };
}

function findSegment(segments: ReadonlyArray<GuardSegment>, loopFrame: number): GuardSegment {
  let low = 0;
  let high = segments.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    const segment = segments[middle];
    if (segment.start <= loopFrame) low = middle;
    else high = middle - 1;
  }
  const found = elementAt(segments, low);
  if (found === undefined) throw new PrisonScriptError('a guard loop with no segments');
  return found;
}

/** A guard's pose `loopFrame` frames into its own loop (any integer; wrapped to the period). */
export function guardPoseAt(guard: CompiledGuard, loopFrame: number): GuardPose {
  return poseOnSegments(
    guard.def.id,
    guard.segments,
    positiveModulo(loopFrame, guard.periodFrames),
  );
}

/** The pose `t` frames into a timeline; past its end, the pose its last segment ends on. */
export function poseOnSegments(
  id: string,
  segments: ReadonlyArray<GuardSegment>,
  t: number,
): GuardPose {
  const segment = findSegment(segments, t);
  const progress = Math.min(1, Math.max(0, (t - segment.start) / segment.frames));
  switch (segment.kind) {
    case 'move':
      return {
        id,
        x: segment.from.x + (segment.to.x - segment.from.x) * progress,
        y: segment.from.y + (segment.to.y - segment.from.y) * progress,
        facing: segment.facing,
        moving: true,
        activity: segment.kind,
      };
    case 'turn':
      return {
        id,
        x: segment.at.x,
        y: segment.at.y,
        facing: wrapAngle(segment.from + segment.by * progress),
        moving: false,
        activity: segment.kind,
      };
    case 'hold':
      return {
        id,
        x: segment.at.x,
        y: segment.at.y,
        facing: segment.facing,
        moving: false,
        activity: segment.kind,
      };
    case 'sweep':
      return {
        id,
        x: segment.at.x,
        y: segment.at.y,
        facing: wrapAngle(segment.facing + segment.halfArc * Math.sin(progress * Math.PI * 2)),
        moving: false,
        activity: segment.kind,
      };
  }
}

function polylineLength(points: ReadonlyArray<PrisonPoint>): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}

function pointAlong(points: ReadonlyArray<PrisonPoint>, distance: number): PrisonPoint {
  let remaining = distance;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const span = Math.hypot(b.x - a.x, b.y - a.y);
    if (remaining <= span && span > 0) {
      const fraction = remaining / span;
      return { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction };
    }
    remaining -= span;
  }
  return elementAt(points, points.length - 1) ?? { x: 0, y: 0 };
}

/**
 * Compiles one spotlight's track for a difficulty.
 *
 * A path track dwells at both ends for whatever its period has left over, so
 * the beam pauses at the yard wall rather than crawling; a pivot eases in and
 * out of each end of its swing.
 */
function compileSpotlight<S extends StealthSpotlightDef>(
  parsed: StealthFloor,
  def: S,
  tuning: PrisonDifficultyTuning,
): CompiledSpotlight<S> {
  const anchorTile = parsed.anchors.get(def.anchor);
  if (anchorTile === undefined) throw new PrisonScriptError(`${def.id}: no anchor "${def.anchor}"`);
  const anchor = tileCentrePx(anchorTile);
  const radius = tuning.spotlight.radiusTiles * TILE_SIZE;
  const speed = tuning.spotlight.speedPxPerFrame;
  const cycle = parsed.layout.cycleFrames;
  const { track } = def;
  if (track.kind === 'pivot') {
    const pivot = tileCentrePx(waypoint(parsed, track.pivot, def.id));
    const from = track.fromDeg * DEGREES_TO_RADIANS;
    const to = track.toDeg * DEGREES_TO_RADIANS;
    const swingPx = Math.abs(to - from) * track.radiusTiles * TILE_SIZE;
    const easedPeakFactor = Math.PI / 2;
    const naturalFrames = Math.ceil((2 * swingPx * easedPeakFactor) / speed);
    const periodFrames = periodWithinCycle(naturalFrames, cycle, def.id);
    const swingRadius = track.radiusTiles * TILE_SIZE;
    return {
      def,
      naturalFrames,
      periodFrames,
      anchor,
      radius,
      centreAt: (loopFrame) => {
        const t = positiveModulo(loopFrame, periodFrames) / periodFrames;
        const angle = from + (to - from) * ((1 - Math.cos(t * Math.PI * 2)) / 2);
        return {
          x: pivot.x + Math.cos(angle) * swingRadius,
          y: pivot.y + Math.sin(angle) * swingRadius,
        };
      },
    };
  }
  const names = track.points.trim().split(/\s+/);
  const points = names.map((name) => tileCentrePx(waypoint(parsed, name, def.id)));
  const first = elementAt(points, 0);
  if (points.length < 2 || first === undefined) {
    throw new PrisonScriptError(`${def.id}: a path needs two points`);
  }
  const course = track.loop ? [...points, first] : points;
  const length = polylineLength(course);
  const travelFrames = length / speed;
  const naturalFrames = Math.ceil(track.loop ? travelFrames : travelFrames * 2);
  const periodFrames = periodWithinCycle(naturalFrames, cycle, def.id);
  const spareFrames = periodFrames - (track.loop ? travelFrames : travelFrames * 2);
  const startDwell = track.loop ? spareFrames : spareFrames / 2;
  return {
    def,
    naturalFrames,
    periodFrames,
    anchor,
    radius,
    centreAt: (loopFrame) => {
      const t = positiveModulo(loopFrame, periodFrames);
      if (t < startDwell) return first;
      const outbound = t - startDwell;
      if (outbound < travelFrames) return pointAlong(course, outbound * speed);
      if (track.loop) return first;
      const farDwellEnd = travelFrames + spareFrames / 2;
      if (outbound < farDwellEnd) return pointAlong(course, length);
      return pointAlong(course, length - (outbound - farDwellEnd) * speed);
    },
  };
}

/** Compiles every guard and spotlight that stands at this difficulty. */
export function compilePrison(parsed: ParsedPrisonLayout, difficulty: Difficulty): CompiledPrison {
  const tuning = PRISON_TUNING[difficulty];
  return compilePrisonWithTuning(parsed, difficulty, tuning);
}

/** {@link compilePrison} against explicit tuning, for harnesses that perturb it. */
export function compilePrisonWithTuning(
  parsed: ParsedPrisonLayout,
  difficulty: Difficulty,
  tuning: PrisonDifficultyTuning,
): CompiledPrison {
  const { layout } = parsed;
  return {
    parsed,
    difficulty,
    tuning,
    lens: 'flashlight',
    cycleFrames: layout.cycleFrames,
    guards: layout.guards
      .filter((def) => def.tier <= tuning.guardTier)
      .map((def) => compileGuard(parsed, def, tuning)),
    spotlights: layout.spotlights
      .filter((def) => def.tier <= tuning.spotlightTier)
      .map((def) => compileSpotlight(parsed, def, tuning)),
  };
}

/**
 * Compiles any stealth floor's guards and lights that stand at this
 * difficulty, with cones cast from `lens`.
 */
export function compileStealthFloor(
  floor: StealthFloor,
  difficulty: Difficulty,
  tuning: PrisonDifficultyTuning,
  lens: GuardLens,
): CompiledStealth {
  const { layout } = floor;
  return {
    parsed: floor,
    difficulty,
    tuning,
    lens,
    cycleFrames: layout.cycleFrames,
    guards: layout.guards
      .filter((def) => def.tier <= tuning.guardTier)
      .map((def) => compileGuard(floor, def, tuning)),
    spotlights: layout.spotlights
      .filter((def) => def.tier <= tuning.spotlightTier)
      .map((def) => compileSpotlight(floor, def, tuning)),
  };
}

export interface PrisonState {
  /** The shared clock frame the state was taken on; the guards' art, and so their lenses, follow it. */
  readonly frame: number;
  readonly guards: ReadonlyArray<GuardPose>;
  readonly spots: ReadonlyArray<SpotPose>;
}

/** Every guard's pose and every beam's landing point on `frame` of the shared clock. */
export function prisonStateAt(compiled: CompiledStealth, frame: number): PrisonState {
  return {
    frame,
    guards: compiled.guards.map((guard) => guardPoseAt(guard, frame)),
    spots: compiled.spotlights.map((spot) => ({
      id: spot.def.id,
      centre: spot.centreAt(frame),
      anchor: spot.anchor,
    })),
  };
}

/** A lit area and what casts it. */
export interface PrisonLight {
  readonly sourceId: string;
  readonly shape: LightShape;
}

/** Frames each still-standing animation frame of a guard is held for. */
const GUARD_STILL_TICKS_PER_FRAME = 6;
/**
 * A facing this close to due north or south still counts as facing east: the
 * guard art is drawn in profile only, and a light pointing straight up the
 * screen has no side of its own.
 */
const PROFILE_FLIP_EPSILON = 1e-6;
/** How far ahead of a lensless guard's body centre its look starts: a little in front of the face. */
const EYES_AHEAD_OF_BODY_TILES = 0.25;
const EYES_AHEAD_OF_BODY_PX = TILE_SIZE * EYES_AHEAD_OF_BODY_TILES;
/** How many steps the lens is walked back toward the body when it sits in a wall. */
const LENS_PULLBACK_STEPS = 8;

/** Which way a guard's profile art faces for a light pointing along `facing`: +1 right, -1 left. */
export function guardFacingX(facing: number): number {
  return Math.cos(facing) < -PROFILE_FLIP_EPSILON ? -1 : 1;
}

/** The rows a driven guard is shown in; a flinch is the guard's own and plays over them. */
export type GuardArtState = Exclude<GoblinGuardState, 'flinch'>;

/** The art row and frame a patrol guard is drawn in. */
export interface GuardAnimation {
  readonly state: GuardArtState;
  readonly frame: number;
}

function rowFrameCount(state: GuardArtState): number {
  return GOBLIN_GUARD_ROWS.find((row) => row.name === state)?.frameCount ?? 1;
}

/**
 * The row and frame a guard is drawn in on `frame` of the shared clock. A pure
 * function of the pose and the clock, so the lens the runtime draws and the
 * lens the solver casts from are one point. `alert` is the runtime's own
 * state — a guard whose suspicion is rising raises its light.
 */
export function guardAnimation(
  pose: GuardPose,
  frame: number,
  patrolSpeedPxPerFrame: number,
  alert: boolean,
): GuardAnimation {
  const state: GuardArtState = alert
    ? 'alert'
    : pose.activity === 'move'
      ? 'walk'
      : pose.activity === 'sweep'
        ? 'sweep'
        : 'idle';
  const count = rowFrameCount(state);
  const ticksPerFrame =
    state === 'walk'
      ? (GOBLIN_GUARD_WALK_GROUND_PER_CYCLE_TILES * TILE_SIZE) / (count * patrolSpeedPxPerFrame)
      : GUARD_STILL_TICKS_PER_FRAME;
  return { state, frame: positiveModulo(Math.floor(frame / ticksPerFrame), count) };
}

/**
 * Where a guard's flashlight cone starts: the lens of the flashlight its art
 * holds, from `guardLensAnchor`. The art is drawn in profile and holds the
 * light out in front, so pressed to a wall the lens would sit inside it and
 * cast nothing; then the origin is walked back toward the guard's body to the
 * last point the light can reach.
 */
export function guardLensPoint(
  compiled: CompiledStealth,
  pose: GuardPose,
  frame: number,
  alert = false,
): PrisonPoint {
  const lens = unclampedLensPoint(compiled, pose, frame, alert);
  const { grid } = compiled.parsed;
  const body = { x: pose.x, y: pose.y };
  for (let step = LENS_PULLBACK_STEPS; step > 0; step--) {
    const share = step / LENS_PULLBACK_STEPS;
    const candidate = {
      x: body.x + (lens.x - body.x) * share,
      y: body.y + (lens.y - body.y) * share,
    };
    const candidateTileX = Math.floor(candidate.x / TILE_SIZE);
    const candidateTileY = Math.floor(candidate.y / TILE_SIZE);
    if (blocksLight(grid, candidateTileX, candidateTileY, 'cone')) continue;
    if (lightHasLineOfSight(grid, body, candidate, 'cone')) return candidate;
  }
  return body;
}

function unclampedLensPoint(
  compiled: CompiledStealth,
  pose: GuardPose,
  frame: number,
  alert: boolean,
): PrisonPoint {
  switch (compiled.lens) {
    case 'flashlight': {
      const animation = guardAnimation(pose, frame, compiled.tuning.patrolSpeedPxPerFrame, alert);
      const anchor = guardLensAnchor(animation.state, animation.frame, guardFacingX(pose.facing));
      const tileLeft = pose.x - TILE_SIZE * TILE_CENTRE_OFFSET;
      const tileTop = pose.y - TILE_SIZE * TILE_CENTRE_OFFSET;
      return { x: tileLeft + anchor.x * TILE_SIZE, y: tileTop + anchor.y * TILE_SIZE };
    }
    case 'eyes':
      return {
        x: pose.x + Math.cos(pose.facing) * EYES_AHEAD_OF_BODY_PX,
        y: pose.y + Math.sin(pose.facing) * EYES_AHEAD_OF_BODY_PX,
      };
    default: {
      const unhandled: never = compiled.lens;
      throw new PrisonScriptError(`unhandled guard lens ${String(unhandled)}`);
    }
  }
}

/** A guard's flashlight cone on `frame` of the shared clock: the one shape that is drawn and that sees. */
export function guardCone(
  compiled: CompiledStealth,
  pose: GuardPose,
  frame: number,
  alert = false,
): ConeShape {
  return castCone(
    compiled.parsed.grid,
    guardLensPoint(compiled, pose, frame, alert),
    pose.facing,
    compiled.tuning.cone,
  );
}

/** Casts every light in a state: one cone per guard, one disc per spotlight. */
export function castPrisonLights(
  compiled: CompiledStealth,
  state: PrisonState,
): ReadonlyArray<PrisonLight> {
  const { grid } = compiled.parsed;
  const lights: PrisonLight[] = state.guards.map((pose) => ({
    sourceId: pose.id,
    shape: guardCone(compiled, pose, state.frame),
  }));
  const radius = compiled.tuning.spotlight.radiusTiles * TILE_SIZE;
  for (const spot of state.spots) {
    lights.push({ sourceId: spot.id, shape: castDisc(grid, spot.centre, radius) });
  }
  return lights;
}

/** Whether every tile a guard's walks cross is open floor. */
export function guardRouteIsWalkable(parsed: StealthFloor, guard: CompiledGuard): boolean {
  return guard.routeTiles.every(({ tile }) => isPrisonGuardWalkable(parsed.grid, tile.x, tile.y));
}
