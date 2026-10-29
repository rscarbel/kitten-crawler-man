/**
 * The shark of the Kraken's flooded pump room, as one pure model shared by
 * the room's runtime and its headless gate.
 *
 * There is one shark. Every platform in the room (the landing raft, each raft,
 * each pump's raft) has a patrol loop of its own, and the shark swims the loop
 * of the platform the active crawler stands on. When they reach another one,
 * it swims over to that platform's loop and takes it up from the nearest
 * point. The moment the active crawler is in the water it leaves whatever it
 * was doing and chases them at {@link SHARK_CHASE_WADE_MULTIPLE} times their
 * own wading pace; reaching them is a kill. The shark only ever swims through open water ({@link WaterMap}): its
 * loops, its chase and its swim between loops all go round rafts and pumps,
 * never across them.
 *
 * Whether a swim survives is decided by where the shark is at the moment of
 * departure. {@link solvePlatformLoop} shapes each platform's loop so that,
 * for every hop off it, there is a stretch of the loop (the departure window)
 * during which a crawler who leaves arrives just in time, and leaving as the
 * fin passes close is caught; then it paces the fin round the loop so the
 * shortest window lasts the difficulty's share of a lap.
 *
 * Every distance here is in tiles and every time in frames; the runtime
 * converts its pixel positions at the boundary.
 */

import { PLAYER_SPEED, TILE_SIZE, WADE_SPEED_FACTOR } from '../../../core/constants';
import type { Difficulty } from '../../../core/difficulty/difficultyProfiles';
import { KRAKEN_TENTACLE_STUN_FRAMES } from '../../../creatures/krakenTentacleTuning';
import type { DoorSide, TileRect } from '../bossRoomLayout';
import type { PlatformId, TileVec } from './platforms';
import { pointAlong, type WaterMap } from './waterMap';

/**
 * How many times faster than the crawler it hunts, wading, a shark swims at
 * its prey and between loops: much faster than wading, so the water is never
 * outswum, but a little under that crawler's dry walking pace.
 */
const SHARK_CHASE_WADE_MULTIPLE = 2.2;

/**
 * How fast a fin cruises its patrol loop, in pixels per frame. Slow enough to
 * read and time from a raft; the fin lingers in or darts across a loop's
 * windows from this base pace.
 */
const SHARK_PATROL_SPEED = 1;

/** The slowest a fin drifts round its loop, as a multiple of its patrol pace. */
const MIN_PATROL_PACE = 0.4;
/** The fastest a fin swims round its loop: a crawler's walking pace. */
const MAX_PATROL_PACE = PLAYER_SPEED / SHARK_PATROL_SPEED;

/** Half a crawler's footing, in tiles: a quarter tile either side of their centre. */
const CRAWLER_FOOTING_HALF_TILES = 0.25;

/** How close a chasing shark must come to a crawler's centre, by water, to take them. */
const SHARK_CATCH_RADIUS_TILES = 0.75;

/**
 * The share of a lap, in time, during which leaving a platform along a hop is
 * survivable, per difficulty. The hop with the shortest window gets this; the
 * others off the same platform can get longer. Every difficulty still needs
 * timing; easy only leaves more of it.
 */
const SHARK_ESCAPE_WINDOW = {
  easy: 0.25,
  normal: 0.15,
  hard: 0.08,
} as const satisfies Record<Difficulty, number>;

/** The speeds and timings a swim is decided by, all per frame and in tiles. */
export interface SharkTiming {
  /** A crawler's pace standing in the water. */
  readonly wadeTilesPerFrame: number;
  /**
   * The furthest a crawler's centre can already be into the water on the first
   * frame it counts as wet: one dry step, since the step off a raft is taken at
   * the raft's full pace.
   */
  readonly entryStepTiles: number;
  readonly chaseTilesPerFrame: number;
  readonly patrolTilesPerFrame: number;
  readonly catchRadiusTiles: number;
  /** How long a tentacle's whip holds a crawler who stepped off its platform. */
  readonly stunFrames: number;
  /**
   * Half the width of a crawler's footing, in tiles from their centre: while
   * any of it is on a float they are out of the shark's reach.
   */
  readonly footingHalfTiles: number;
}

/**
 * The game's real timing for a crawler moving at `speedMultiplier` of their
 * base pace (`Player.speedMultiplier`: a potion speeds it, a chill slows it),
 * wading at `WADE_SPEED_FACTOR`, and the tentacle's real stun. The chase keeps
 * the same multiple of the crawler's own wading pace at every speed, so a
 * swim's outcome hangs on where the fin is, never on how fast the crawler is:
 * both close and open the gap in proportion. The patrol keeps its pace, since
 * a window is a stretch of the loop, not a length of time.
 */
export function sharkTimingFor(speedMultiplier: number): SharkTiming {
  const walkTilesPerFrame = (PLAYER_SPEED * speedMultiplier) / TILE_SIZE;
  const wadeTilesPerFrame = walkTilesPerFrame * WADE_SPEED_FACTOR;
  return {
    wadeTilesPerFrame,
    entryStepTiles: walkTilesPerFrame,
    chaseTilesPerFrame: wadeTilesPerFrame * SHARK_CHASE_WADE_MULTIPLE,
    patrolTilesPerFrame: SHARK_PATROL_SPEED / TILE_SIZE,
    catchRadiusTiles: SHARK_CATCH_RADIUS_TILES,
    stunFrames: KRAKEN_TENTACLE_STUN_FRAMES,
    footingHalfTiles: CRAWLER_FOOTING_HALF_TILES,
  };
}

/** A crawler's speed with no potion and no chill, as `Player.speedMultiplier` reads it. */
export const BASE_CRAWLER_PACE = 1;

/** The timing at a crawler's base pace: what the room is laid out and gated on. */
export const SHARK_TIMING: SharkTiming = sharkTimingFor(BASE_CRAWLER_PACE);

function distance(a: TileVec, b: TileVec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ── Departures and swims ─────────────────────────────────────────────────────

/**
 * A crossing a crawler can make: straight across the water between two
 * platforms, along one axis.
 */
export interface SharkDeparture {
  readonly from: PlatformId;
  readonly to: PlatformId;
  /** The platform left, which the fin's way round to the swim mostly bends about. */
  readonly fromRect: TileRect;
  /** Where the crawler's centre leaves `from`: on its edge, at the middle of the crossing. */
  readonly start: TileVec;
  /** Unit step along the crossing; always one of the four axes. */
  readonly heading: TileVec;
  /** Open water between the two edges. */
  readonly swimTiles: number;
  /** Whether a tentacle can be alive on `from` when the crawler leaves it. */
  readonly fromHoldsTentacle: boolean;
}

/**
 * How a swim is played out:
 * - `cross`: straight over at wading pace from the moment the water is entered
 * - `stunned_then_cross`: the tentacle on `from` whips the crawler as they
 *   step in, holds them for the stun, then they swim on
 * - `stunned_then_climb_back`: the same whip, then back onto `from`
 */
export type SwimPlan = 'cross' | 'stunned_then_cross' | 'stunned_then_climb_back';

export type SwimOutcome =
  | { readonly kind: 'safe'; readonly frames: number }
  | { readonly kind: 'caught'; readonly frames: number; readonly at: TileVec };

/**
 * A swim's course, frame by frame, as the runtime moves a crawler: where they
 * are when they enter the water, how long they are held, which way they go,
 * and the last frame they are still wet on, and where.
 */
interface SwimCourse {
  readonly entryProgress: number;
  readonly stunFrames: number;
  readonly direction: 1 | -1;
  readonly lastWetFrame: number;
  readonly lastWetProgress: number;
}

function swimCourse(departure: SharkDeparture, plan: SwimPlan, timing: SharkTiming): SwimCourse {
  const w = timing.wadeTilesPerFrame;
  const footing = timing.footingHalfTiles;
  const ashore = departure.swimTiles - footing;
  switch (plan) {
    case 'cross': {
      const moving = Math.ceil(ashore / w);
      return {
        entryProgress: 0,
        stunFrames: 0,
        direction: 1,
        lastWetFrame: moving - 1,
        lastWetProgress: (moving - 1) * w,
      };
    }
    case 'stunned_then_cross': {
      const moving = Math.ceil((ashore - timing.entryStepTiles) / w);
      return {
        entryProgress: timing.entryStepTiles,
        stunFrames: timing.stunFrames,
        direction: 1,
        lastWetFrame: timing.stunFrames + moving - 1,
        lastWetProgress: timing.entryStepTiles + (moving - 1) * w,
      };
    }
    case 'stunned_then_climb_back': {
      const moving = Math.max(0, Math.ceil((timing.entryStepTiles - footing) / w));
      return {
        entryProgress: timing.entryStepTiles,
        stunFrames: timing.stunFrames,
        direction: -1,
        lastWetFrame: moving === 0 ? -1 : timing.stunFrames + moving - 1,
        lastWetProgress: timing.entryStepTiles - Math.max(0, moving - 1) * w,
      };
    }
    default: {
      const unhandled: never = plan;
      throw new Error(`unhandled swim plan ${String(unhandled)}`);
    }
  }
}

function swimPoint(departure: SharkDeparture, progress: number): TileVec {
  return {
    x: departure.start.x + departure.heading.x * progress,
    y: departure.start.y + departure.heading.y * progress,
  };
}

/**
 * One frame of a shark chasing a crawler at `prey`: it swims its chase speed
 * along the water path to them, and takes them if it is then within its catch
 * radius of them by water. Exactly the runtime's chase.
 */
function chaseStep(
  water: WaterMap,
  shark: TileVec,
  prey: TileVec,
  timing: SharkTiming,
): { readonly at: TileVec; readonly caught: boolean } {
  const target = water.nearestFree(prey);
  const path = water.path(shark, target);
  const at = pointAlong(path, timing.chaseTilesPerFrame);
  const left = Math.max(0, path.lengthTiles - timing.chaseTilesPerFrame) + distance(target, prey);
  return { at, caught: left <= timing.catchRadiusTiles };
}

/**
 * Plays one swim out frame by frame, in the runtime's order: the crawler moves,
 * then the shark hunts them with the runtime's own step ({@link huntShark}),
 * whose catch rule is the one rule: within reach by water, and none of their
 * footing on a float. The swim is over the moment their footing reaches the
 * far float, or climbs back onto the near one. The shark starts at
 * `sharkStart`, where it was the frame before the crawler entered the water,
 * and gives chase on the frame they do.
 *
 * The plans that begin with a whip start the crawler one dry step into the
 * water, the furthest a crawler can be when the whip lands: further from the
 * platform they must climb back onto, and nearer the one they swim on to, so
 * both tests are taken at their hardest.
 */
export function simulateSwim(
  sea: SharkSea,
  departure: SharkDeparture,
  sharkStart: TileVec,
  plan: SwimPlan,
  timing: SharkTiming,
): SwimOutcome {
  const course = swimCourse(departure, plan, timing);
  const footing = timing.footingHalfTiles;
  const ashore = departure.swimTiles - footing;
  let progress = course.entryProgress;
  let stunLeft = course.stunFrames;
  let shark: SharkState = { at: sharkStart, heading: departure.heading, mode: { kind: 'chasing' } };
  if (course.lastWetFrame < 0) return { kind: 'safe', frames: 0 };
  shark = huntShark(sea, shark, swimPoint(departure, progress), timing);
  if (shark.mode.kind === 'feeding') return { kind: 'caught', frames: 0, at: shark.at };
  for (let frame = 1; frame <= course.lastWetFrame + 1; frame++) {
    if (stunLeft > 0) stunLeft--;
    else progress += course.direction * timing.wadeTilesPerFrame;
    const backOnFrom = course.direction < 0 && progress <= footing;
    const reachedTo = course.direction > 0 && progress >= ashore;
    if (backOnFrom || reachedTo) return { kind: 'safe', frames: frame };
    shark = huntShark(sea, shark, swimPoint(departure, progress), timing);
    if (shark.mode.kind === 'feeding') return { kind: 'caught', frames: frame, at: shark.at };
  }
  return { kind: 'safe', frames: course.lastWetFrame + 1 };
}

/** How a fin at a point is measured against a swim: exactly, or by the cheap lower bound. */
type Reach = (from: TileVec, to: TileVec) => number;

/**
 * Whether no shark starting at `shark` could take a crawler on this swim,
 * however it swam. The water path from the shark to a crawler grows by at most
 * their wading pace a frame while the shark closes it by its chase speed, so
 * their gap less the shark's chase is least on the last frame they are wet:
 * if the shark could not have reached that spot by then, it never could.
 */
function swimSurvives(
  reach: Reach,
  departure: SharkDeparture,
  shark: TileVec,
  plan: SwimPlan,
  timing: SharkTiming,
): boolean {
  const course = swimCourse(departure, plan, timing);
  if (course.lastWetFrame < 0) return true;
  const last = swimPoint(departure, course.lastWetProgress);
  return (
    reach(shark, last) - timing.chaseTilesPerFrame * (course.lastWetFrame + 1) >
    timing.catchRadiusTiles
  );
}

// ── Loops ────────────────────────────────────────────────────────────────────

/**
 * A patrol loop: points evenly spaced along it, in the order the fin swims
 * them, the last joining back to the first. A loop that goes all the way round
 * its platform is swum clockwise on screen; one that a wall or a pump cuts is
 * swum out to the cut and back.
 */
export interface SharkLoop {
  readonly points: readonly TileVec[];
  /** Tiles from each point to the next. */
  readonly stepTiles: number;
}

type SideExtents = Record<DoorSide, number>;
const SIDES = ['north', 'south', 'east', 'west'] as const satisfies readonly DoorSide[];

/** The roundest a loop's corners get, in tiles. */
const LOOP_CORNER_RADIUS_TILES = 2;
const HALF = 0.5;
const QUARTER_TURN = Math.PI / 2;

/** The closest a loop runs past its own platform, so open water always shows between edge and fin. */
const LOOP_MIN_CLEARANCE_TILES = 1;
/** Extra room a loop keeps from everything else in the room, beyond the fin's own margin. */
const LOOP_FREE_MARGIN_TILES = 0.2;
/** The shortest a cut loop may be and still be swum back and forth, in tiles. */
const LOOP_MIN_RUN_TILES = 4;
/** How finely a loop is sampled when its windows are measured and it is swum. */
const SHARK_LOOP_SAMPLES = 160;
/** How finely candidate loops are sampled while their shape is searched for. */
const SEARCH_LOOP_SAMPLES = 48;
/** Loop extents are tried every half tile out to here, then every whole tile. */
const FINE_EXTENT_LIMIT_TILES = 4;
const FINE_EXTENT_STEP_TILES = 0.5;
const COARSE_EXTENT_STEP_TILES = 1;
/** The furthest a loop reaches past its platform. */
const MAX_EXTENT_TILES = 7;
/** The extents a loop's sides are tried at, beyond its platform, in tiles. */
const EXTENT_STEPS: readonly number[] = (() => {
  const steps: number[] = [];
  for (let extent = LOOP_MIN_CLEARANCE_TILES; extent <= MAX_EXTENT_TILES;) {
    steps.push(extent);
    extent += extent < FINE_EXTENT_LIMIT_TILES ? FINE_EXTENT_STEP_TILES : COARSE_EXTENT_STEP_TILES;
  }
  return steps;
})();
/** Rounds of pushing one side out before a platform is given up on. */
const GROWTH_ROUNDS = 6;
/**
 * The least share of a loop's length a departure's window must cover. Short
 * enough that the hard difficulty's share can be reached by darting through
 * it, long enough that the easy one's can be reached by lingering.
 */
const MIN_WINDOW_LOOP_SHARE = 0.08;
/** The window share the search aims for: a little over the least, so the finer final loop still has it. */
const SEARCH_WINDOW_HEADROOM = 1.25;
const SEARCH_WINDOW_AIM = MIN_WINDOW_LOOP_SHARE * SEARCH_WINDOW_HEADROOM;

/** The point `along` tiles round the rounded rectangle, clockwise from its top-left straight. */
function roundedRectPoint(
  box: { left: number; top: number; right: number; bottom: number },
  r: number,
  along: number,
): TileVec {
  const straightAcross = box.right - box.left - 2 * r;
  const straightDown = box.bottom - box.top - 2 * r;
  const arc = QUARTER_TURN * r;
  const corner = (cx: number, cy: number, startAngle: number, into: number): TileVec => {
    const angle = startAngle + (r === 0 ? 0 : into / r);
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  };
  let left = along;
  if (left < straightAcross) return { x: box.left + r + left, y: box.top };
  left -= straightAcross;
  if (left < arc) return corner(box.right - r, box.top + r, -QUARTER_TURN, left);
  left -= arc;
  if (left < straightDown) return { x: box.right, y: box.top + r + left };
  left -= straightDown;
  if (left < arc) return corner(box.right - r, box.bottom - r, 0, left);
  left -= arc;
  if (left < straightAcross) return { x: box.right - r - left, y: box.bottom };
  left -= straightAcross;
  if (left < arc) return corner(box.left + r, box.bottom - r, QUARTER_TURN, left);
  left -= arc;
  if (left < straightDown) return { x: box.left, y: box.bottom - r - left };
  left -= straightDown;
  return corner(box.left + r, box.top + r, Math.PI, Math.min(left, arc));
}

function polylineLength(points: readonly TileVec[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
  return total;
}

/** `count` points evenly spaced along the open polyline `points`, swum out and back. */
function outAndBack(points: readonly TileVec[], count: number): SharkLoop {
  const run = polylineLength(points);
  const stepTiles = (2 * run) / count;
  const path = { points, lengthTiles: run };
  const sampled: TileVec[] = [];
  for (let index = 0; index < count; index++) {
    const along = index * stepTiles;
    sampled.push(pointAlong(path, along <= run ? along : 2 * run - along));
  }
  return { points: sampled, stepTiles };
}

/**
 * The loop whose box reaches `extents` past each side of `platform`, sampled
 * at `count` points, cut to the stretch of it in open water and swum out and
 * back where something cuts it; null when too little of it is in open water.
 */
function buildLoop(
  water: WaterMap,
  platform: TileRect,
  extents: SideExtents,
  count: number,
): SharkLoop | null {
  const box = {
    left: platform.x - extents.west,
    top: platform.y - extents.north,
    right: platform.x + platform.w + extents.east,
    bottom: platform.y + platform.h + extents.south,
  };
  const r = Math.min(
    LOOP_CORNER_RADIUS_TILES,
    (box.right - box.left) * HALF,
    (box.bottom - box.top) * HALF,
  );
  const perimeter =
    2 * (box.right - box.left - 2 * r) + 2 * (box.bottom - box.top - 2 * r) + 2 * Math.PI * r;
  const ring: TileVec[] = [];
  for (let index = 0; index < count; index++) {
    ring.push(roundedRectPoint(box, r, (index / count) * perimeter));
  }
  const free = ring.map((p) => water.isFree(p, LOOP_FREE_MARGIN_TILES));
  if (free.every(Boolean)) return { points: ring, stepTiles: perimeter / count };
  const run = longestCyclicRun(free);
  if (run === null) return null;
  const stretch: TileVec[] = [];
  for (let step = 0; step < run.count; step++) stretch.push(ring[(run.first + step) % count]);
  if (polylineLength(stretch) < LOOP_MIN_RUN_TILES) return null;
  return outAndBack(stretch, count);
}

/** The longest cyclic run of `true` in `flags`, or null when there is none or no `false` at all. */
function longestCyclicRun(flags: readonly boolean[]): { first: number; count: number } | null {
  const count = flags.length;
  const firstFalse = flags.indexOf(false);
  if (firstFalse < 0) return null;
  let best: { first: number; count: number } | null = null;
  let runStart = -1;
  let runLength = 0;
  for (let step = 1; step <= count; step++) {
    const index = (firstFalse + step) % count;
    if (flags[index]) {
      if (runLength === 0) runStart = index;
      runLength++;
      continue;
    }
    if (runLength > 0 && (best === null || runLength > best.count)) {
      best = { first: runStart, count: runLength };
    }
    runLength = 0;
  }
  return best;
}

// ── Windows ──────────────────────────────────────────────────────────────────

/**
 * The stretch of a loop during which leaving along `departure` survives: the
 * longest unbroken run of the loop's points from which no shark could catch a
 * crawler swimming straight across, `count` points from `first` (wrapping).
 */
export interface DepartureWindow {
  readonly departure: SharkDeparture;
  readonly first: number;
  readonly count: number;
  /** The middle of the window. */
  readonly centre: number;
  /** The point at which the fin is nearest the departure point. */
  readonly nearest: number;
}

function nearestPointTo(loop: SharkLoop, point: TileVec): number {
  let best = 0;
  for (let index = 1; index < loop.points.length; index++) {
    if (distance(loop.points[index], point) < distance(loop.points[best], point)) best = index;
  }
  return best;
}

function measureWindow(
  reach: Reach,
  loop: SharkLoop,
  departure: SharkDeparture,
  timing: SharkTiming,
): DepartureWindow | null {
  const survives = loop.points.map((shark) =>
    swimSurvives(reach, departure, shark, 'cross', timing),
  );
  const run = longestCyclicRun(survives);
  if (run === null) return null;
  return {
    departure,
    first: run.first,
    count: run.count,
    centre: (run.first + Math.floor((run.count - 1) * HALF)) % loop.points.length,
    nearest: nearestPointTo(loop, departure.start),
  };
}

/** The point of `window` from which the fin is furthest, by water, from where the crawler steps in. */
function farthestInWindow(
  reach: Reach,
  loop: SharkLoop,
  window: DepartureWindow,
  timing: SharkTiming,
): number {
  const entry = swimPoint(window.departure, timing.entryStepTiles);
  let best = window.first;
  let bestReach = -Infinity;
  for (let step = 0; step < window.count; step++) {
    const index = (window.first + step) % loop.points.length;
    const away = reach(loop.points[index], entry);
    if (away > bestReach) {
      bestReach = away;
      best = index;
    }
  }
  return best;
}

/**
 * Why a loop fails the rules every departure must keep, or null when it keeps
 * them all:
 * - it has a window at least {@link MIN_WINDOW_LOOP_SHARE} of its length
 * - leaving when the fin is nearest is caught, played out as the runtime chases
 * - from a platform that can hold a tentacle, a crawler whipped as they step
 *   in and swimming on is caught: no point of the loop that lets an unwhipped
 *   crawler across lets a whipped one finish where the shark could have met
 *   them, and played out from the window's centre and from its point furthest
 *   from them, the shark does take them
 * - and at every point of the window, a whipped crawler who climbs straight
 *   back is safe
 */
function loopViolation(
  sea: SharkSea,
  loop: SharkLoop,
  departures: readonly SharkDeparture[],
  timing: SharkTiming,
): string | null {
  const reach: Reach = (from, to) => sea.water.reachTiles(from, to);
  const count = loop.points.length;
  for (const departure of departures) {
    const label = `${departure.from} -> ${departure.to}`;
    const window = measureWindow(reach, loop, departure, timing);
    if (window === null) return `${label}: no departure window`;
    if (window.count < MIN_WINDOW_LOOP_SHARE * count) return `${label}: window too short`;
    const nearest = loop.points[window.nearest];
    if (simulateSwim(sea, departure, nearest, 'cross', timing).kind !== 'caught') {
      return `${label}: leaving with the fin nearest is not caught`;
    }
    if (!departure.fromHoldsTentacle) continue;
    if (!whipsStayFatal(reach, loop, departure, timing)) {
      return `${label}: a whipped crawler could finish the swim`;
    }
    const played = [window.centre, farthestInWindow(reach, loop, window, timing)];
    for (const index of played) {
      const outcome = simulateSwim(
        sea,
        departure,
        loop.points[index],
        'stunned_then_cross',
        timing,
      );
      if (outcome.kind !== 'caught') return `${label}: a whipped crawler finishes the swim`;
    }
    for (let step = 0; step < window.count; step++) {
      const fin = loop.points[(window.first + step) % count];
      if (!swimSurvives(reach, departure, fin, 'stunned_then_climb_back', timing)) {
        return `${label}: a whipped crawler cannot climb back in time`;
      }
    }
  }
  return null;
}

/**
 * Whether, from every point of `loop` an unwhipped crawler could cross from,
 * the shark could still meet a whipped one before they finish. Points an
 * unwhipped crawler is caught from hold a whipped one all the more.
 */
function whipsStayFatal(
  reach: Reach,
  loop: SharkLoop,
  departure: SharkDeparture,
  timing: SharkTiming,
): boolean {
  return loop.points.every(
    (fin) =>
      !swimSurvives(reach, departure, fin, 'cross', timing) ||
      !swimSurvives(reach, departure, fin, 'stunned_then_cross', timing),
  );
}

/**
 * How many departures `loop` gives a window of at least `share` of its length,
 * or -1 when some whipped crawler could finish their swim from somewhere on it.
 */
function loopScore(
  reach: Reach,
  loop: SharkLoop,
  departures: readonly SharkDeparture[],
  timing: SharkTiming,
  share: number,
): number {
  let windows = 0;
  for (const departure of departures) {
    if (departure.fromHoldsTentacle && !whipsStayFatal(reach, loop, departure, timing)) return -1;
    const window = measureWindow(reach, loop, departure, timing);
    if (window !== null && window.count >= share * loop.points.length) windows++;
  }
  return windows;
}

// ── Pace ─────────────────────────────────────────────────────────────────────

/**
 * How a fin swims its loop on one difficulty: the frames from each point to
 * the next, so it lingers in or darts across the windows to give the shortest
 * the difficulty's share of a lap.
 */
export interface SharkPatrol {
  readonly stretchFrames: readonly number[];
  /** Frames into a lap the fin passes each point. */
  readonly startFrames: readonly number[];
  readonly lapFrames: number;
}

/** Every point some departure's window covers. */
function windowPoints(windows: readonly DepartureWindow[], count: number): boolean[] {
  const covered = new Array<boolean>(count).fill(false);
  for (const window of windows) {
    for (let step = 0; step < window.count; step++) covered[(window.first + step) % count] = true;
  }
  return covered;
}

/**
 * Paces the fin for `share`: points in a window take `w` frames each and the
 * rest `o`, with `w / o` set so the smallest window, of `L` of the loop's
 * points, lasts `share` of a lap: `L w / (U w + O o) = share`, `U` and `O`
 * being the points in some window and the rest. Both paces stay between
 * {@link MIN_PATROL_PACE} and {@link MAX_PATROL_PACE}; a window those cannot
 * bring to the share stays as near it as they allow.
 */
function paceFor(
  loop: SharkLoop,
  windows: readonly DepartureWindow[],
  share: number,
  timing: SharkTiming,
): SharkPatrol {
  const count = loop.points.length;
  const covered = windowPoints(windows, count);
  const inWindows = covered.filter(Boolean).length;
  const outside = count - inWindows;
  const smallest = Math.min(...windows.map((window) => window.count));
  const slowest = MAX_PATROL_PACE / MIN_PATROL_PACE;
  const wanted =
    smallest > share * inWindows ? (share * outside) / (smallest - share * inWindows) : slowest;
  const ratio = Math.min(slowest, Math.max(1 / slowest, outside === 0 ? 1 : wanted));
  let windowPace = 1 / ratio;
  let cruisePace = 1;
  if (windowPace < MIN_PATROL_PACE) {
    windowPace = MIN_PATROL_PACE;
    cruisePace = windowPace * ratio;
  } else if (windowPace > MAX_PATROL_PACE) {
    windowPace = MAX_PATROL_PACE;
    cruisePace = windowPace * ratio;
  }
  const baseFrames = loop.stepTiles / timing.patrolTilesPerFrame;
  const stretchFrames = covered.map((inside) => baseFrames / (inside ? windowPace : cruisePace));
  const startFrames: number[] = [];
  let lapFrames = 0;
  for (const frames of stretchFrames) {
    startFrames.push(lapFrames);
    lapFrames += frames;
  }
  return { stretchFrames, startFrames, lapFrames };
}

/** The share of a lap the fin spends crossing `window` on `patrol`. */
export function windowLapShare(patrol: SharkPatrol, window: DepartureWindow): number {
  const count = patrol.stretchFrames.length;
  let frames = 0;
  for (let step = 0; step < window.count; step++) {
    frames += patrol.stretchFrames[(window.first + step) % count];
  }
  return frames / patrol.lapFrames;
}

/** Where a patrolling fin is `lapFrame` frames into its lap. */
function patrolPoint(loop: SharkLoop, patrol: SharkPatrol, lapFrame: number): TileVec {
  const count = loop.points.length;
  const into = ((lapFrame % patrol.lapFrames) + patrol.lapFrames) % patrol.lapFrames;
  let low = 0;
  let high = count - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) * HALF);
    if (patrol.startFrames[mid] <= into) low = mid;
    else high = mid - 1;
  }
  const a = loop.points[low];
  const b = loop.points[(low + 1) % count];
  const share = (into - patrol.startFrames[low]) / patrol.stretchFrames[low];
  return { x: a.x + (b.x - a.x) * share, y: a.y + (b.y - a.y) * share };
}

// ── Solving a platform's loop ────────────────────────────────────────────────

/** A platform's solved loop: its shape, its windows, and its pace on every difficulty. */
export interface PlatformShark {
  readonly platform: PlatformId;
  readonly loop: SharkLoop;
  readonly windows: readonly DepartureWindow[];
  readonly patrols: Readonly<Record<Difficulty, SharkPatrol>>;
}

export type PlatformSharkSolution =
  | ({ readonly kind: 'solved' } & PlatformShark)
  | { readonly kind: 'unsolvable'; readonly reason: string };

function extentsWith(extents: SideExtents, side: DoorSide, value: number): SideExtents {
  return { ...extents, [side]: value };
}

/**
 * Solves the loop the shark patrols round `platform`, for the departures off
 * it, in `sea`: its water and its floats, the sea the runtime's shark swims.
 * Only the water and the floats are read, so `sea.sharks` may still be filling.
 *
 * The loop is a box reaching some way past each side of the platform, cut
 * short where a wall or anything else in the room stands in its way. Shaping
 * starts close in; while some departure has no window, the side whose push
 * gives the most departures one is pushed out; then each side in turn is
 * pulled back in as far as every window allows, since a loop no bigger than it
 * must be keeps a whipped crawler from swimming on. The search measures swims
 * going round only this platform, which can only make a crawler look safer
 * than they are and is quick; the loop it settles on is then checked against
 * every rule with the room's true water paths, the ones the gate and the
 * runtime use, so a loop that is returned is one the gate passes. Last, the
 * fin is paced for each difficulty.
 */
export function solvePlatformLoop(
  sea: SharkSea,
  platform: TileRect,
  id: PlatformId,
  departures: readonly SharkDeparture[],
  timing: SharkTiming,
): PlatformSharkSolution {
  if (departures.length === 0) return { kind: 'unsolvable', reason: `${id}: no departures` };
  const { water } = sea;
  const bound: Reach = (from, to) => water.reachAroundTiles(from, to, platform);
  const score = (extents: SideExtents): number => {
    const loop = buildLoop(water, platform, extents, SEARCH_LOOP_SAMPLES);
    return loop === null ? -1 : loopScore(bound, loop, departures, timing, SEARCH_WINDOW_AIM);
  };
  const enough = departures.length;

  const tightest = EXTENT_STEPS[0];
  let extents: SideExtents = { north: tightest, south: tightest, east: tightest, west: tightest };
  let current = score(extents);
  for (let round = 0; round < GROWTH_ROUNDS && current < enough; round++) {
    const candidates: SideExtents[] = [];
    for (const side of SIDES) {
      for (const value of EXTENT_STEPS) {
        if (value > extents[side]) candidates.push(extentsWith(extents, side, value));
      }
    }
    for (const value of EXTENT_STEPS) {
      const uniform = { north: value, south: value, east: value, west: value };
      if (SIDES.every((side) => uniform[side] >= extents[side])) candidates.push(uniform);
    }
    let best: { extents: SideExtents; score: number; growth: number } | null = null;
    for (const candidate of candidates) {
      const candidateScore = score(candidate);
      if (candidateScore <= current) continue;
      const growth = SIDES.reduce((sum, side) => sum + candidate[side] - extents[side], 0);
      const better =
        best === null ||
        candidateScore > best.score ||
        (candidateScore === best.score && growth < best.growth);
      if (better) best = { extents: candidate, score: candidateScore, growth };
    }
    if (best === null) break;
    extents = best.extents;
    current = best.score;
  }
  if (current < enough) {
    return { kind: 'unsolvable', reason: `${id}: no loop gives every departure a window` };
  }
  for (const side of SIDES) {
    for (const value of EXTENT_STEPS) {
      if (value >= extents[side]) break;
      const candidate = extentsWith(extents, side, value);
      if (score(candidate) >= enough) {
        extents = candidate;
        break;
      }
    }
  }

  const exact: Reach = (from, to) => water.reachTiles(from, to);
  const loop = buildLoop(water, platform, extents, SHARK_LOOP_SAMPLES);
  if (loop === null) return { kind: 'unsolvable', reason: `${id}: the loop left the water` };
  const violation = loopViolation(sea, loop, departures, timing);
  if (violation !== null) return { kind: 'unsolvable', reason: `${id}: ${violation}` };
  const windows: DepartureWindow[] = [];
  for (const departure of departures) {
    const window = measureWindow(exact, loop, departure, timing);
    if (window === null) return { kind: 'unsolvable', reason: `${id}: a window vanished` };
    windows.push(window);
  }
  return {
    kind: 'solved',
    platform: id,
    loop,
    windows,
    patrols: {
      easy: paceFor(loop, windows, SHARK_ESCAPE_WINDOW.easy, timing),
      normal: paceFor(loop, windows, SHARK_ESCAPE_WINDOW.normal, timing),
      hard: paceFor(loop, windows, SHARK_ESCAPE_WINDOW.hard, timing),
    },
  };
}

// ── The one shark ────────────────────────────────────────────────────────────

/**
 * What the shark is doing:
 * - `patrol`: swimming `platform`'s loop, `lapFrame` frames into its lap
 * - `transit`: swimming over to `platform`'s loop, which it takes up at point
 *   `join`; no window is open until it gets there
 * - `chasing`: after the active crawler, who is in the water
 * - `feeding`: it has taken them
 */
export type SharkMode =
  | { readonly kind: 'patrol'; readonly platform: PlatformId; readonly lapFrame: number }
  | { readonly kind: 'transit'; readonly platform: PlatformId; readonly join: number }
  | { readonly kind: 'chasing' }
  | { readonly kind: 'feeding' };

export interface SharkState {
  /** Where the fin is, in world tiles. */
  readonly at: TileVec;
  /** The way it last moved, for its art. */
  readonly heading: TileVec;
  readonly mode: SharkMode;
}

/**
 * What the shark knows of the active crawler this frame: in the water at
 * `prey`, or out of it on (or nearest) `platform`.
 */
export type SharkSense =
  | { readonly kind: 'hunt'; readonly prey: TileVec }
  | { readonly kind: 'guard'; readonly platform: PlatformId };

/** The water the shark swims, the floats it cannot take anyone from, and the loops it patrols. */
export interface SharkSea {
  readonly water: WaterMap;
  readonly floats: readonly TileRect[];
  readonly sharks: ReadonlyMap<PlatformId, PlatformShark>;
}

/** Whether any of the footing of a crawler centred at `at` is on one of `floats`. */
function footingOnFloat(at: TileVec, floats: readonly TileRect[], timing: SharkTiming): boolean {
  const half = timing.footingHalfTiles;
  return floats.some(
    (rect) =>
      at.x + half > rect.x &&
      at.x - half < rect.x + rect.w &&
      at.y + half > rect.y &&
      at.y - half < rect.y + rect.h,
  );
}

function headingFrom(state: SharkState, at: TileVec): TileVec {
  const dx = at.x - state.at.x;
  const dy = at.y - state.at.y;
  return dx === 0 && dy === 0 ? state.heading : { x: dx, y: dy };
}

/** The shark at the start of `platform`'s loop, patrolling it. */
export function sharkPatrolling(sea: SharkSea, platform: PlatformId): SharkState {
  const shark = sea.sharks.get(platform);
  const at = shark?.loop.points[0] ?? { x: 0, y: 0 };
  return { at, heading: { x: 1, y: 0 }, mode: { kind: 'patrol', platform, lapFrame: 0 } };
}

/** The point of `loop` a fin at `at` takes it up from: the nearest it can swim straight to, else the nearest. */
function joinPoint(water: WaterMap, loop: SharkLoop, at: TileVec): number {
  let best = -1;
  let fallback = 0;
  for (let index = 0; index < loop.points.length; index++) {
    const point = loop.points[index];
    if (distance(point, at) < distance(loop.points[fallback], at)) fallback = index;
    if (best >= 0 && distance(point, at) >= distance(loop.points[best], at)) continue;
    if (water.isClear(at, point)) best = index;
  }
  return best >= 0 ? best : fallback;
}

/**
 * One frame of a shark hunting a crawler in the water at `prey`: the chase,
 * and the one catch rule the runtime, the solver and the gate all share. It
 * takes them when it comes within its catch radius by water, unless any of
 * their footing is on a float.
 */
function huntShark(
  sea: SharkSea,
  state: SharkState,
  prey: TileVec,
  timing: SharkTiming,
): SharkState {
  const step = chaseStep(sea.water, state.at, prey, timing);
  const caught = step.caught && !footingOnFloat(prey, sea.floats, timing);
  return {
    at: step.at,
    heading: headingFrom(state, step.at),
    mode: caught ? { kind: 'feeding' } : { kind: 'chasing' },
  };
}

/**
 * One frame of the shark. Exactly what the runtime does and what the gate
 * plays out: it hunts a crawler in the water, swims to the loop of the
 * platform they are on when they are not, and patrols that loop once there.
 */
export function stepShark(
  sea: SharkSea,
  state: SharkState,
  sense: SharkSense,
  difficulty: Difficulty,
  timing: SharkTiming,
): SharkState {
  const { mode } = state;
  if (mode.kind === 'feeding') return state;
  switch (sense.kind) {
    case 'hunt':
      return huntShark(sea, state, sense.prey, timing);
    case 'guard': {
      const shark = sea.sharks.get(sense.platform);
      if (shark === undefined) return state;
      if (mode.kind === 'patrol' && mode.platform === sense.platform) {
        const patrol = shark.patrols[difficulty];
        const lapFrame = (mode.lapFrame + 1) % patrol.lapFrames;
        const at = patrolPoint(shark.loop, patrol, lapFrame);
        return { at, heading: headingFrom(state, at), mode: { ...mode, lapFrame } };
      }
      const join =
        mode.kind === 'transit' && mode.platform === sense.platform
          ? mode.join
          : joinPoint(sea.water, shark.loop, state.at);
      const target = shark.loop.points[join];
      const path = sea.water.path(state.at, target);
      if (path.lengthTiles <= timing.chaseTilesPerFrame) {
        const lapFrame = shark.patrols[difficulty].startFrames[join];
        return {
          at: target,
          heading: headingFrom(state, target),
          mode: { kind: 'patrol', platform: sense.platform, lapFrame },
        };
      }
      const at = pointAlong(path, timing.chaseTilesPerFrame);
      return {
        at,
        heading: headingFrom(state, at),
        mode: { kind: 'transit', platform: sense.platform, join },
      };
    }
    default: {
      const unhandled: never = sense;
      throw new Error(`unhandled shark sense ${JSON.stringify(unhandled)}`);
    }
  }
}
