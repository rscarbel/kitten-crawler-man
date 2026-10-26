/**
 * The floor-3 wilderness's rivers: routing, carving, and the bridges that carry
 * the roads over them.
 *
 * **Water here is terrain and nothing else.** It is non-walkable and has no
 * gameplay of its own — no swimming, no drowning, no current. What a river adds
 * is a shape the map did not have: a long soft-edged line that cuts across the
 * grain of the forests, gives the elevation bands something to drain into, and
 * makes a crossing somewhere the player has to walk to.
 *
 * Two passes, deliberately far apart in `generateOverworld`:
 *
 * - `carveRivers` runs **before** the circus, the forests and the ruins, so all
 *   of them see the channel as solid ground they must dodge.
 * - `paintRiverCrossings` runs **after every road pass**, because a road that
 *   arrives at the bank later still needs a bridge, and `TileGrid.setPaved`
 *   refuses to write over water — so an un-bridged crossing is a road with a
 *   hole in it rather than a road that never happened.
 */

import {
  BRIDGE,
  BRIDGE_AXIS_EAST_WEST,
  BRIDGE_AXIS_NORTH_SOUTH,
  FloorTypeValue,
  MAX_WATER_DEPTH,
  PEBBLE_SCATTER,
  RIVER_REEDS,
  RIVER_ROCK,
  VOID_TYPE,
  isRiverChannel,
} from '../tileTypes';
import { tileHash01 } from '../tiles/hollowTileHash';
import type { BridgeAxis, TileGrid } from '../town/tileGrid';
import type { TilePoint, TownPlan } from '../town/townPlan';
import type { ElevationField } from './elevation';
import type { KeepOut } from './keepOut';
import { NO_REGION, Reachability } from './reachability';
import { worldRandom } from '../../core/world/WorldRandom';

/**
 * How many rivers a map gets.
 *
 * Both are routed identically — edge to edge, same minimum length. A shorter
 * tributary joining the first river was considered and rejected: two
 * independent courses already cross often enough to read as a catchment, and a
 * tributary would need join logic, a confluence width rule and its own
 * bridging case for a difference the player would have to be looking for.
 * Recorded here rather than left silent, since the tradeoff isn't obvious from
 * the code alone.
 */
const NUM_RIVERS = 2;

/**
 * How many times **each** river will re-roll a route that strays into the town
 * before the map is shipped with one river fewer.
 *
 * Per river, not per map. Shared, it was a content hole rather than a safety
 * valve: source and mouth are pinned to opposite edges, so a course runs
 * straight at the town's keep-out disc, and a seed with a high rejection rate
 * spent the whole budget on the first river. Measured over 80 maps with a shared
 * budget of 24: **3 maps had no river at all** and 2 had only one.
 *
 * Shipping short is still the right failure when it does happen: a map with one
 * river is a slightly duller map, whereas a loop that will not terminate is a
 * hang on the loading screen.
 */
const MAX_RIVER_ATTEMPTS_PER_RIVER = 24;

/**
 * How hard the town's keep-out disc pushes a course aside.
 *
 * Rejection alone made the router blind: it aimed at the town, hit the disc and
 * gave up, over and over. Steering away from it first means rejection is the
 * backstop it was meant to be rather than the common case.
 */
const TOWN_REPULSION_WEIGHT = 0.06;

/**
 * Tiles of dry ground kept between the town's safe radius and any river.
 *
 * The circus has no matching constant here: the fairground is sited *after*
 * the carve, so there is nothing for the router to avoid when it runs. That
 * clearance is enforced from the circus's own
 * side instead (`pickCircusCentre` in `OverworldGenerator`), which is both
 * equivalent and cheaper — re-rolling a circus is one random draw, re-routing a
 * river is a walk across the whole map.
 */
const RIVER_TOWN_CLEARANCE_TILES = 6;

/** Channel half-widths in tiles, at the source and at the mouth. */
const RIVER_MIN_HALF_WIDTH = 1;
const RIVER_MAX_HALF_WIDTH = 2;
/** Slow along-course wobble in the half-width, so banks are never parallel. */
const RIVER_WIDTH_WOBBLE = 0.45;
const RIVER_WIDTH_WOBBLE_PERIOD_STEPS = 23;

/** One route step, in tiles. Short enough that the carve leaves no gaps. */
const RIVER_STEP_TILES = 0.8;
/** Hard cap on steps, so a route that circles cannot run forever. */
const RIVER_MAX_STEPS = 2400;

/**
 * How the heading is chosen each step.
 *
 * The river is steered by three things at once: it must reach the far edge, it
 * wants to run downhill, and it must not look surveyed. `RIVER_SEARCH_ARC`
 * bounds how far off the current heading it will look, the lookahead samples
 * decide which of those candidates is lowest, and the turn rate keeps it from
 * snapping onto the winner — a river that turns instantly is a zigzag.
 */
/** Just under a quarter turn either side of the current heading. */
const RIVER_SEARCH_ARC_TURNS = 0.42;
const RIVER_SEARCH_ARC_RADIANS = Math.PI * RIVER_SEARCH_ARC_TURNS;
const RIVER_SEARCH_SAMPLES = 9;
const RIVER_LOOKAHEAD_TILES = 7;
const RIVER_TURN_RATE = 0.3;
const RIVER_WOBBLE_RADIANS = 0.16;
/** Centres a 0..1 sweep on 0, then reopens it to its full ±1 span. */
const ARC_MIDPOINT = 0.5;
const ARC_FULL_SPAN = 2;
/**
 * How strongly the pull toward the far edge competes with running downhill.
 * Without it a river finds a basin and stops descending; with it too high the
 * river is a ruled line.
 */
const RIVER_TARGET_PULL = 0.22;

/** Candidate source/mouth points sampled per edge before the best is taken. */
const EDGE_CANDIDATE_SAMPLES = 24;
/** How far in from the void border a river may be born or die. */
const RIVER_EDGE_INSET_TILES = 2;

/**
 * Shortest course worth carving. A route that reaches the far border in fewer
 * steps than this clipped a corner rather than crossing the map, and is re-rolled.
 */
const RIVER_MIN_LENGTH_TILES = 90;

/** Guaranteed crossings per river, and how far apart added ones must be. */
const MIN_RIVER_CROSSINGS = 3;
const MIN_BRIDGE_SPACING_TILES = 40;
/** Ends of a river are near the void border, where a bridge would lead nowhere. */
const CROSSING_END_MARGIN_TILES = 18;

/** How far a plank crossing will search for the far bank before giving up. */
const MAX_CROSSING_SPAN_TILES = 12;

/**
 * Size a marooned region has to reach before it is worth bridging back.
 *
 * A generated map always carries several hundred pockets of one to twenty tiles
 * — the holes a forest blob's ragged edge leaves, the inside of a sealed ruin
 * shell — and every one of them predates the rivers. Bridging those would be
 * meaningless; what this repair exists for is the case a river actually creates,
 * which is a *quarter of the map* with no way across.
 */
const MIN_MAROONED_REGION_TILES = 80;

/**
 * How many repair rounds are run. Each round can only join regions that touch
 * the water, so joining a chain of them takes a round apiece; three is well past
 * anything two rivers have produced.
 */
const MAX_CONNECTIVITY_REPAIR_ROUNDS = 4;

/** One river's course: the polyline its channel was carved along. */
export interface RiverCourse {
  readonly path: ReadonlyArray<TilePoint>;
}

interface RiverSite {
  readonly centreTileX: number;
  readonly centreTileY: number;
  readonly clearanceTiles: number;
}

function distanceTo(site: RiverSite, x: number, y: number): number {
  return Math.hypot(x - site.centreTileX, y - site.centreTileY);
}

/** The turn from `from` to `to`, folded into [-π, π]. */
function signedAngleBetween(to: number, from: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/**
 * A point on the map's edge ring, parameterised so a whole edge can be sampled.
 * `side` runs 0..3 clockwise from the north edge.
 */
function edgePoint(side: number, along: number, size: number, inset: number): TilePoint {
  const low = inset;
  const high = size - 1 - inset;
  const span = Math.round(low + along * (high - low));
  const NORTH = 0;
  const EAST = 1;
  const SOUTH = 2;
  if (side === NORTH) return { x: span, y: low };
  if (side === EAST) return { x: high, y: span };
  if (side === SOUTH) return { x: span, y: high };
  return { x: low, y: span };
}

const EDGE_SIDES = 4;
/** Two sides on, so a river crosses the map rather than clipping a corner. */
const OPPOSITE_SIDE_OFFSET = 2;

/**
 * Picks the highest sampled point on one edge and the lowest on the opposite
 * edge, so a river is born on a watershed and dies in a basin. Both are only
 * preferences — the steering below does the real work.
 */
function pickCourseEnds(
  elevation: ElevationField,
  size: number,
  border: number,
): { source: TilePoint; mouth: TilePoint } {
  const inset = border + RIVER_EDGE_INSET_TILES;
  const sourceSide = Math.floor(worldRandom() * EDGE_SIDES) % EDGE_SIDES;
  const mouthSide = (sourceSide + OPPOSITE_SIDE_OFFSET) % EDGE_SIDES;

  let source = edgePoint(sourceSide, worldRandom(), size, inset);
  let sourceElevation = -Infinity;
  let mouth = edgePoint(mouthSide, worldRandom(), size, inset);
  let mouthElevation = Infinity;

  for (let i = 0; i < EDGE_CANDIDATE_SAMPLES; i++) {
    const sourceCandidate = edgePoint(sourceSide, worldRandom(), size, inset);
    const sourceHeight = elevation.elevationAt(sourceCandidate.x, sourceCandidate.y);
    if (sourceHeight > sourceElevation) {
      sourceElevation = sourceHeight;
      source = sourceCandidate;
    }
    const mouthCandidate = edgePoint(mouthSide, worldRandom(), size, inset);
    const mouthHeight = elevation.elevationAt(mouthCandidate.x, mouthCandidate.y);
    if (mouthHeight < mouthElevation) {
      mouthElevation = mouthHeight;
      mouth = mouthCandidate;
    }
  }
  return { source, mouth };
}

/**
 * Walks one course from a source to the far edge, steering downhill inside a
 * forward arc with a pull toward the mouth and a bounded wobble.
 *
 * Returns `null` when the route strays inside a forbidden site or fails to
 * cross the map, so the caller can re-roll rather than carve something wrong.
 */
function routeRiver(
  elevation: ElevationField,
  size: number,
  border: number,
  keepOut: ReadonlyArray<RiverSite>,
): TilePoint[] | null {
  const { source, mouth } = pickCourseEnds(elevation, size, border);
  const path: TilePoint[] = [];
  let x = source.x;
  let y = source.y;
  let heading = Math.atan2(mouth.y - source.y, mouth.x - source.x);

  for (let step = 0; step < RIVER_MAX_STEPS; step++) {
    // Deflected around the town, not rejected on touching it. Source and mouth
    // sit on opposite edges, so a course runs straight at the keep-out disc in
    // the middle of the map; rejecting on touch would throw the whole route
    // away there — measured at 1 map in 40 shipping with *no river at all*, the
    // entire feature silently absent. Sliding along the disc's edge instead
    // means a course always completes and the river simply goes round the town.
    for (const site of keepOut) {
      const awayX = x - site.centreTileX;
      const awayY = y - site.centreTileY;
      const distance = Math.hypot(awayX, awayY);
      if (distance >= site.clearanceTiles || distance === 0) continue;
      const push = site.clearanceTiles / distance;
      x = site.centreTileX + awayX * push;
      y = site.centreTileY + awayY * push;
      // Turn to run along the disc rather than into it, keeping whichever of the
      // two tangents the course was already closer to.
      const outward = Math.atan2(awayY, awayX);
      const clockwise = outward + Math.PI / 2;
      const anticlockwise = outward - Math.PI / 2;
      heading =
        Math.abs(signedAngleBetween(clockwise, heading)) <
        Math.abs(signedAngleBetween(anticlockwise, heading))
          ? clockwise
          : anticlockwise;
    }

    const tx = Math.round(x);
    const ty = Math.round(y);
    path.push({ x: tx, y: ty });

    const reachedEdge =
      step > 0 &&
      (tx <= border || tx >= size - border - 1 || ty <= border || ty >= size - border - 1);
    if (reachedEdge) {
      return path.length >= RIVER_MIN_LENGTH_TILES ? path : null;
    }

    let bestAngle = heading;
    let bestScore = Infinity;
    for (let sample = 0; sample < RIVER_SEARCH_SAMPLES; sample++) {
      const acrossArc = sample / (RIVER_SEARCH_SAMPLES - 1) - ARC_MIDPOINT;
      const offset = acrossArc * ARC_FULL_SPAN * RIVER_SEARCH_ARC_RADIANS;
      const angle = heading + offset;
      const probeX = x + Math.cos(angle) * RIVER_LOOKAHEAD_TILES;
      const probeY = y + Math.sin(angle) * RIVER_LOOKAHEAD_TILES;
      const toMouth = Math.atan2(mouth.y - probeY, mouth.x - probeX);
      // Angular error folded into [0, π]: how far this candidate would leave the
      // river pointing away from the edge it is trying to reach.
      const misalignment = Math.abs(signedAngleBetween(toMouth, angle));
      // Elevation is the river's own preference, the mouth pulls it across the
      // map, and the keep-out discs push it aside before it can walk into one.
      let repulsion = 0;
      for (const site of keepOut) {
        const encroachment = site.clearanceTiles - distanceTo(site, probeX, probeY);
        if (encroachment > 0) repulsion += encroachment;
      }
      const score =
        elevation.elevationAt(probeX, probeY) +
        misalignment * RIVER_TARGET_PULL +
        repulsion * TOWN_REPULSION_WEIGHT;
      if (score < bestScore) {
        bestScore = score;
        bestAngle = angle;
      }
    }

    const turn = signedAngleBetween(bestAngle, heading);
    const wobble = (worldRandom() - ARC_MIDPOINT) * ARC_FULL_SPAN * RIVER_WOBBLE_RADIANS;
    heading += turn * RIVER_TURN_RATE + wobble;
    x += Math.cos(heading) * RIVER_STEP_TILES;
    y += Math.sin(heading) * RIVER_STEP_TILES;
  }
  return null;
}

/**
 * Course steps either side of a point whose run is averaged into its flow.
 * About five tiles each way: long enough that a gently curving river does not
 * snap between compass octants every few tiles, short enough that a real bend
 * still turns the current with it.
 */
const FLOW_SMOOTHING_WINDOW_STEPS = 6;

/**
 * The river's heading at `index`, from the run of the course around it rather
 * than the step to the next point. The points are rounded to tiles, so
 * consecutive ones can coincide or sit at any of eight angles to each other.
 */
function smoothedHeadingAt(path: ReadonlyArray<TilePoint>, index: number): number {
  const before = path[Math.max(0, index - FLOW_SMOOTHING_WINDOW_STEPS)];
  const after = path[Math.min(path.length - 1, index + FLOW_SMOOTHING_WINDOW_STEPS)];
  return Math.atan2(after.y - before.y, after.x - before.x);
}

/** Half-width of the channel at a given fraction along the course. */
function halfWidthAt(progress: number, step: number): number {
  const widening = RIVER_MIN_HALF_WIDTH + (RIVER_MAX_HALF_WIDTH - RIVER_MIN_HALF_WIDTH) * progress;
  const wobble =
    Math.sin((step / RIVER_WIDTH_WOBBLE_PERIOD_STEPS) * Math.PI * 2) * RIVER_WIDTH_WOBBLE;
  return Math.max(RIVER_MIN_HALF_WIDTH, widening + wobble);
}

/**
 * Stamps the channel along a routed course.
 *
 * `setStanding`, never `set`: a plain write deletes the tile's recorded ground,
 * and the river runs across grass, highland turf and scree alike — the record is
 * what a bank tile's fringe and any future un-carving would read back.
 */
function carveChannel(
  grid: TileGrid,
  path: ReadonlyArray<TilePoint>,
  border: number,
  landmarks: KeepOut,
): void {
  path.forEach((point, index) => {
    const progress = index / Math.max(1, path.length - 1);
    const halfWidth = halfWidthAt(progress, index);
    const flowAngle = smoothedHeadingAt(path, index);
    const reach = Math.ceil(halfWidth);
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        if (Math.hypot(dx, dy) > halfWidth) continue;
        const tx = point.x + dx;
        const ty = point.y + dy;
        if (tx < border || tx >= grid.size - border || ty < border || ty >= grid.size - border) {
          continue;
        }
        // The town's own structures are the one thing a river may not eat. The
        // route is already held well clear of them; this is the backstop that
        // makes that a guarantee rather than a tuning assumption.
        if (grid.isSolid(tx, ty)) continue;
        if (landmarks.contains(tx, ty)) continue;
        grid.setRiverWater(tx, ty, flowAngle);
      }
    }
  });
}

/**
 * Routes and carves the map's rivers.
 *
 * Runs after the town, its wall and its gate highways — so a crossing has a road
 * to cross — and before every wilderness pass, so the circus, the forests and
 * the ruins all see the channel as something to keep off.
 */
export function carveRivers(
  grid: TileGrid,
  plan: TownPlan,
  elevation: ElevationField,
  border: number,
  landmarks: KeepOut,
): RiverCourse[] {
  // The clearance is applied to the course's *centre line*, so the channel's own
  // half-width has to be added or the water ends up that much closer than the
  // constant claims — measured at 43.9 tiles against a stated 46.
  const widestBank = Math.ceil(RIVER_MAX_HALF_WIDTH + RIVER_WIDTH_WOBBLE);
  const keepOut: RiverSite[] = [
    {
      centreTileX: plan.centre.x,
      centreTileY: plan.centre.y,
      clearanceTiles: plan.safeRadiusTiles + RIVER_TOWN_CLEARANCE_TILES + widestBank,
    },
    // Landmarks sited before the carve — Briar Hollow — are steered round the
    // same way as the town, by the disc that encloses each of their shapes.
    ...landmarks.enclosingDiscs().map((disc): RiverSite => ({
      centreTileX: disc.centre.x,
      centreTileY: disc.centre.y,
      clearanceTiles: disc.radiusTiles + widestBank,
    })),
  ];

  const rivers: RiverCourse[] = [];
  for (let river = 0; river < NUM_RIVERS; river++) {
    for (let attempt = 0; attempt < MAX_RIVER_ATTEMPTS_PER_RIVER; attempt++) {
      const path = routeRiver(elevation, grid.size, border, keepOut);
      if (path === null) continue;
      carveChannel(grid, path, border, landmarks);
      rivers.push({ path });
      break;
    }
  }
  smoothRiverBanks(grid, rivers, border, landmarks);
  return rivers;
}

/**
 * Cellular passes over the carved banks. Stamping discs onto the tile grid
 * leaves one-tile notches and spurs that read, at map scale, as a stair-stepped
 * edge; two passes take out the ones the stamp left and the ones the first pass
 * exposed.
 */
const BANK_SMOOTHING_PASSES = 2;
/** Dry ground with at least this many water tiles beside it is a notch, and floods. */
const NOTCH_MIN_WATER_NEIGHBOURS = 3;
/** Water with at most this many water tiles beside it is a spur, and dries. */
const SPUR_MAX_WATER_NEIGHBOURS = 1;

const CARDINAL_STEPS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

function cardinalWaterNeighbours(grid: TileGrid, x: number, y: number): number {
  let count = 0;
  for (const [dx, dy] of CARDINAL_STEPS) if (isWater(grid, x + dx, y + dy)) count++;
  return count;
}

/** The mean current of the water beside (x, y), for a notch the smoothing floods. */
function neighbouringFlowAngle(grid: TileGrid, x: number, y: number): number {
  let sumX = 0;
  let sumY = 0;
  for (const [dx, dy] of CARDINAL_STEPS) {
    const angle = grid.cells[y + dy]?.[x + dx]?.flowAngle;
    if (angle === undefined) continue;
    sumX += Math.cos(angle);
    sumY += Math.sin(angle);
  }
  return Math.atan2(sumY, sumX);
}

/**
 * Fills one-tile notches and erodes one-tile spurs along every carved bank.
 *
 * Runs straight after the carve, before anything is laid beside or over the
 * water: the bridges span whatever channel this leaves, and the rocks and
 * crossings keep their invariants because they are placed against the
 * smoothed banks rather than having the banks moved under them. A tile on a
 * course's own line is never eroded, so a narrow reach cannot be cut in two.
 */
function smoothRiverBanks(
  grid: TileGrid,
  rivers: ReadonlyArray<RiverCourse>,
  border: number,
  landmarks: KeepOut,
): void {
  const spine = new Set<number>();
  for (const river of rivers) {
    for (const point of river.path) spine.add(point.y * grid.size + point.x);
  }
  for (let pass = 0; pass < BANK_SMOOTHING_PASSES; pass++) {
    const notches: TilePoint[] = [];
    const spurs: TilePoint[] = [];
    for (let y = border; y < grid.size - border; y++) {
      for (let x = border; x < grid.size - border; x++) {
        const waterNeighbours = cardinalWaterNeighbours(grid, x, y);
        if (isWater(grid, x, y)) {
          const onSpine = spine.has(y * grid.size + x);
          if (!onSpine && waterNeighbours <= SPUR_MAX_WATER_NEIGHBOURS) spurs.push({ x, y });
          continue;
        }
        if (waterNeighbours < NOTCH_MIN_WATER_NEIGHBOURS) continue;
        if (grid.isSolid(x, y) || landmarks.contains(x, y)) continue;
        notches.push({ x, y });
      }
    }
    if (notches.length === 0 && spurs.length === 0) return;
    // Decided from one snapshot and applied together, so a pass does not chase
    // its own edits along a bank.
    const notchAngles = notches.map((notch) => neighbouringFlowAngle(grid, notch.x, notch.y));
    notches.forEach((notch, index) => grid.setRiverWater(notch.x, notch.y, notchAngles[index]));
    for (const spur of spurs) grid.clearRiverWater(spur.x, spur.y);
  }
}

/** The two axes a crossing can run along. */
interface CrossingAxis {
  readonly dx: number;
  readonly dy: number;
  /** What a deck laid along this axis records for its renderer. */
  readonly bridgeAxis: BridgeAxis;
}
const CROSSING_AXES: ReadonlyArray<CrossingAxis> = [
  { dx: 1, dy: 0, bridgeAxis: BRIDGE_AXIS_EAST_WEST },
  { dx: 0, dy: 1, bridgeAxis: BRIDGE_AXIS_NORTH_SOUTH },
];

function isWater(grid: TileGrid, x: number, y: number): boolean {
  return grid.typeAt(x, y) === FloorTypeValue.water;
}

/** A channel span, with the two pieces of dry ground a deck would land on. */
interface ChannelSpan {
  readonly tiles: TilePoint[];
  readonly nearBank: TilePoint;
  readonly farBank: TilePoint;
  readonly axis: CrossingAxis;
}

/**
 * Spans the channel at (x, y) along one axis and returns the water tiles
 * crossed, or `null` when the far bank is out of reach or either end is not
 * ground a deck could land on.
 */
function spanChannel(
  grid: TileGrid,
  x: number,
  y: number,
  axis: CrossingAxis,
  requirePavedBanks: boolean,
): ChannelSpan | null {
  if (!isWater(grid, x, y)) return null;

  let backX = x;
  let backY = y;
  let stepsBack = 0;
  while (isWater(grid, backX - axis.dx, backY - axis.dy)) {
    backX -= axis.dx;
    backY -= axis.dy;
    stepsBack++;
    if (stepsBack > MAX_CROSSING_SPAN_TILES) return null;
  }

  const span: TilePoint[] = [];
  let cursorX = backX;
  let cursorY = backY;
  while (isWater(grid, cursorX, cursorY)) {
    span.push({ x: cursorX, y: cursorY });
    if (span.length > MAX_CROSSING_SPAN_TILES) return null;
    cursorX += axis.dx;
    cursorY += axis.dy;
  }

  const nearBank: TilePoint = { x: backX - axis.dx, y: backY - axis.dy };
  const farBank: TilePoint = { x: cursorX, y: cursorY };
  const bankIsUsable = (bank: TilePoint): boolean => {
    const type = grid.typeAt(bank.x, bank.y);
    if (type === undefined) return false;
    if (grid.isSolid(bank.x, bank.y)) return false;
    // A deck is not a bank. `BRIDGE` counts as paved on purpose — that is what
    // lets a later route stitch through a crossing — but a span that *lands on
    // another span* is not a crossing, it is a sliver of channel beside one that
    // already exists. Left in, the scan bridged the one- and two-tile gaps of
    // water flanking every wide road bridge, and did it on the other axis, so a
    // four-tile deck came out with its columns disagreeing about which way it
    // ran.
    if (type === BRIDGE) return false;
    return requirePavedBanks ? grid.isPaved(bank.x, bank.y) : true;
  };
  if (!bankIsUsable(nearBank) || !bankIsUsable(farBank)) return null;
  return { tiles: span, nearBank, farBank, axis };
}

/**
 * Lays a deck over one span, plus one tile onto each bank so the bridge reads as
 * a structure with abutments rather than as a stain on the water.
 */
function layDeck(grid: TileGrid, span: ChannelSpan): void {
  const { bridgeAxis } = span.axis;
  for (const tile of span.tiles) grid.setBridgeDeck(tile.x, tile.y, BRIDGE, bridgeAxis);
  for (const abutment of [span.nearBank, span.farBank]) {
    if (grid.isSolid(abutment.x, abutment.y)) continue;
    if (grid.typeAt(abutment.x, abutment.y) === undefined) continue;
    grid.setBridgeDeck(abutment.x, abutment.y, BRIDGE, bridgeAxis);
  }
}

/** Middle tile of a span — what a crossing is recorded as, for spacing checks. */
function spanCentre(span: ChannelSpan): TilePoint {
  return span.tiles[Math.floor(span.tiles.length / 2)];
}

/** Straight-line distance in tiles — the units `MIN_BRIDGE_SPACING_TILES` is in. */
function tileDistance(a: TilePoint, b: TilePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Bridges every place a road meets the river, then tops each river up to
 * `MIN_RIVER_CROSSINGS` with plank crossings at its narrowest points.
 *
 * Runs **after every road pass**, including the circus's approach and the
 * road to Briar Hollow: `TileGrid.setPaved` will not write over water, so a road
 * laid after the carve simply stops at the bank, and only a pass that runs last
 * can see all of them.
 */
export function paintRiverCrossings(
  grid: TileGrid,
  rivers: ReadonlyArray<RiverCourse>,
  border: number,
): void {
  const decks: TilePoint[] = [];
  /**
   * A crossing is recorded once, however many water tiles found it.
   *
   * The scan below tests every water tile, so a four-tile-wide road bridge finds
   * the same span a dozen times over. Pushing one entry per *tile* made
   * `MIN_RIVER_CROSSINGS` satisfied by a single bridge and the top-up loop broke
   * immediately: measured over 50 rivers, 34 of them shipped with fewer than
   * `MIN_RIVER_CROSSINGS`, and the median river had two.
   */
  const recordCrossing = (centre: TilePoint): void => {
    if (decks.some((deck) => tileDistance(deck, centre) < MIN_BRIDGE_SPACING_TILES)) return;
    decks.push(centre);
  };

  for (let y = border; y < grid.size - border; y++) {
    for (let x = border; x < grid.size - border; x++) {
      if (!isWater(grid, x, y)) continue;
      for (const axis of CROSSING_AXES) {
        const span = spanChannel(grid, x, y, axis, true);
        if (span === null) continue;
        layDeck(grid, span);
        recordCrossing(spanCentre(span));
        break;
      }
    }
  }

  for (const river of rivers) {
    // A deck belongs to this river if it sits on its course. Collected once and
    // appended to, rather than re-filtered per candidate: the road-crossing pass
    // above has already run, so the starting set is whatever the roads produced.
    const ownDecks = decks.filter((deck) =>
      river.path.some((point) => tileDistance(point, deck) <= MAX_CROSSING_SPAN_TILES),
    );
    for (
      let index = CROSSING_END_MARGIN_TILES;
      index < river.path.length - CROSSING_END_MARGIN_TILES;
      index++
    ) {
      if (ownDecks.length >= MIN_RIVER_CROSSINGS) break;
      const point = river.path[index];
      if (ownDecks.some((deck) => tileDistance(deck, point) < MIN_BRIDGE_SPACING_TILES)) continue;

      // Both axes are tried and the shorter span wins, so a plank crossing is
      // laid across the channel rather than along it.
      let best: ChannelSpan | null = null;
      for (const axis of CROSSING_AXES) {
        const span = spanChannel(grid, point.x, point.y, axis, false);
        if (span === null) continue;
        if (best === null || span.tiles.length < best.tiles.length) best = span;
      }
      if (best === null) continue;
      layDeck(grid, best);
      layDeckRecorded(decks, ownDecks, spanCentre(best));
    }
  }
}

/** Records a newly laid deck in both the map-wide list and this river's own. */
function layDeckRecorded(all: TilePoint[], own: TilePoint[], centre: TilePoint): void {
  all.push(centre);
  own.push(centre);
}

/**
 * Adds crossings until no large region of the map is cut off from the town.
 *
 * This is a **repair, not an assertion**, and that is the deliberate choice. A
 * river runs edge to edge, so it always cuts the map in two and the bridges are
 * the only thing that puts it back together; measured over eight maps, the
 * road-crossing pass alone left a five-thousand-tile region marooned on one of
 * them. Failing generation there would mean the game refuses to start about one
 * time in eight, which is a far worse outcome than laying one more plank
 * crossing — so the generator's assertion stays as a backstop and this makes
 * sure it has nothing to find.
 *
 * Each round floods from the town square, labels what it could not reach, and
 * bridges one channel per large marooned region — one, not all, because the
 * first crossing usually joins the whole region back and the rest would be
 * bridges to nowhere.
 */
export function bridgeMaroonedRegions(grid: TileGrid, from: TilePoint, border: number): void {
  for (let round = 0; round < MAX_CONNECTIVITY_REPAIR_ROUNDS; round++) {
    const reachability = new Reachability(grid, from);
    const { labels, counts, touchesWater } = reachability.marooned();
    const worthBridging = new Set<number>();
    counts.forEach((count, label) => {
      // No water on its border means no channel to span: a forest blob closed
      // around it, and no number of rounds spent here will ever open it.
      if (count >= MIN_MAROONED_REGION_TILES && touchesWater[label]) worthBridging.add(label);
    });
    if (worthBridging.size === 0) return;

    const joined = new Set<number>();
    for (let y = border; y < grid.size - border && joined.size < worthBridging.size; y++) {
      for (let x = border; x < grid.size - border; x++) {
        if (!isWater(grid, x, y)) continue;
        for (const axis of CROSSING_AXES) {
          const span = spanChannel(grid, x, y, axis, false);
          if (span === null) continue;
          const nearReached = reachability.reached(span.nearBank.x, span.nearBank.y);
          const farReached = reachability.reached(span.farBank.x, span.farBank.y);
          if (nearReached === farReached) continue;
          const strandedBank = nearReached ? span.farBank : span.nearBank;
          const label = labels[strandedBank.y * grid.size + strandedBank.x];
          if (label === NO_REGION || !worthBridging.has(label) || joined.has(label)) continue;
          layDeck(grid, span);
          joined.add(label);
          break;
        }
      }
    }
    // Nothing could be bridged this round, so nothing will be in the next one:
    // whatever is left is walled off by something other than water.
    if (joined.size === 0) return;
  }
}

/**
 * Chance per course step that a rock is stood in the channel.
 *
 * Sparse on purpose: a rock's job is to give the water something to break
 * around, and a channel full of them reads as a boulder field someone flooded.
 */
const RIVER_ROCK_CHANCE_PER_STEP = 0.035;

/**
 * How much water a rock must have around it.
 *
 * Requiring all four neighbours to be water is the mid-channel bias: it keeps
 * rocks out of the one-tile-wide stretches, where a rock is most of the river,
 * and off the banks, where it would read as a boulder that fell in rather than
 * as a rock the water runs past.
 */
const RIVER_ROCK_CLEAR_NEIGHBOURS = 4;

/** Tiles of clear water kept between a rock and any deck. */
const RIVER_ROCK_BRIDGE_CLEARANCE = 3;

/**
 * Stands rocks in the channel.
 *
 * Runs **after every bridging pass**, which is load-bearing rather than tidy: a
 * rock is not water, so `spanChannel` would stop dead at one, and a rock placed
 * before the decks could split a crossing in half or block one from being found
 * at all.
 */
export function scatterRiverRocks(
  grid: TileGrid,
  rivers: ReadonlyArray<RiverCourse>,
  border: number,
): void {
  for (const river of rivers) {
    for (const point of river.path) {
      if (worldRandom() >= RIVER_ROCK_CHANCE_PER_STEP) continue;
      if (
        point.x < border ||
        point.y < border ||
        point.x >= grid.size - border ||
        point.y >= grid.size - border
      ) {
        continue;
      }
      if (!isWater(grid, point.x, point.y)) continue;

      let waterNeighbours = 0;
      for (const [dx, dy] of ROCK_NEIGHBOUR_STEPS) {
        if (isWater(grid, point.x + dx, point.y + dy)) waterNeighbours++;
      }
      if (waterNeighbours < RIVER_ROCK_CLEAR_NEIGHBOURS) continue;
      if (hasDeckWithin(grid, point, RIVER_ROCK_BRIDGE_CLEARANCE)) continue;

      grid.setStanding(point.x, point.y, RIVER_ROCK);
    }
  }
}

const ROCK_NEIGHBOUR_STEPS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

function hasDeckWithin(grid: TileGrid, centre: TilePoint, radiusTiles: number): boolean {
  for (let dy = -radiusTiles; dy <= radiusTiles; dy++) {
    for (let dx = -radiusTiles; dx <= radiusTiles; dx++) {
      if (grid.typeAt(centre.x + dx, centre.y + dy) === BRIDGE) return true;
    }
  }
  return false;
}

const UNVISITED = -1;

/**
 * Records every channel tile's `waterDepth`: its distance in tiles from the
 * nearest dry ground, less one, so the tiles along the bank are 0. Measured in
 * steps along the grid's axes: counting a diagonal as one step leaves a river
 * running diagonally all margin and no channel, because every tile across it
 * then touches a bank corner.
 *
 * Runs once nothing else will change which tiles are water: after the
 * crossings, the connectivity repair and the rocks. The void border is neither
 * water nor bank, so a river running off the map stays deep to its end rather
 * than shoaling against the edge of the world.
 */
export function recordWaterDepth(grid: TileGrid): void {
  const { size } = grid;
  const distance = new Int32Array(size * size).fill(UNVISITED);
  const queue: number[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cell = grid.cells[y][x];
      if (isRiverChannel(cell) || cell.type === VOID_TYPE) continue;
      distance[y * size + x] = 0;
      queue.push(y * size + x);
    }
  }
  // Iterating the queue while appending to it is the breadth-first walk itself:
  // an array's iterator reads its length afresh at every step.
  for (const at of queue) {
    const x = at % size;
    const y = Math.floor(at / size);
    for (const [dx, dy] of CARDINAL_STEPS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const next = ny * size + nx;
      if (distance[next] !== UNVISITED) continue;
      if (!isRiverChannel(grid.cells[ny][nx])) continue;
      distance[next] = distance[at] + 1;
      queue.push(next);
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isRiverChannel(grid.cells[y][x])) continue;
      const reached = distance[y * size + x];
      const depth = reached === UNVISITED ? MAX_WATER_DEPTH : reached - 1;
      grid.setWaterDepth(x, y, Math.min(MAX_WATER_DEPTH, depth));
    }
  }
}

/**
 * Course steps either side of a point over which a bend is measured: the turn
 * from the run arriving to the run leaving.
 */
const BEND_WINDOW_STEPS = 8;
/** A turn this sharp, in radians over the window, puts the most reeds on its inside bank. */
const BEND_FULL_RADIANS = 0.9;
/** Tiles of bank past the widest channel a bend's inside reaches. */
const BEND_BANK_REACH_TILES = 3;
/** How far from a course point its bend reaches, in tiles: past the widest channel onto the bank. */
const BEND_REACH_TILES = RIVER_MAX_HALF_WIDTH + BEND_BANK_REACH_TILES;

/** Chance that a lowland tile at the water's edge grows reeds, on a straight reach. */
const REED_EDGE_CHANCE = 0.2;
/** Added on the inside of the sharpest bends, where slack water drops its silt. */
const REED_INSIDE_BEND_BONUS = 0.5;
/** Share of that bonus the next tile back from the edge gets, so a bend's stand is deeper. */
const REED_SECOND_ROW_SHARE = 0.45;
/** Chance a bank tile with no reeds gets a few stones instead. */
const BANK_PEBBLE_CHANCE = 0.06;
const REED_SALT = 7331;
const BANK_PEBBLE_SALT = 7337;

/**
 * How much each tile near a course sits on the inside of a bend, 0 on a
 * straight reach or the outside bank, 1 inside the sharpest.
 */
function insideBendStrength(grid: TileGrid, rivers: ReadonlyArray<RiverCourse>): Float32Array {
  const { size } = grid;
  const strength = new Float32Array(size * size);
  for (const { path } of rivers) {
    for (let index = 0; index < path.length; index++) {
      const point = path[index];
      const before = path[Math.max(0, index - BEND_WINDOW_STEPS)];
      const after = path[Math.min(path.length - 1, index + BEND_WINDOW_STEPS)];
      const arriving = Math.atan2(point.y - before.y, point.x - before.x);
      const leaving = Math.atan2(after.y - point.y, after.x - point.x);
      const turn = signedAngleBetween(leaving, arriving);
      const bend = Math.min(1, Math.abs(turn) / BEND_FULL_RADIANS);
      if (bend <= 0) continue;
      const heading = smoothedHeadingAt(path, index);
      // A positive turn swings the heading toward its own +90° normal, which is
      // the side the bend's inside lies on.
      const towardInside = Math.sign(turn);
      const insideX = -Math.sin(heading) * towardInside;
      const insideY = Math.cos(heading) * towardInside;
      for (let dy = -BEND_REACH_TILES; dy <= BEND_REACH_TILES; dy++) {
        for (let dx = -BEND_REACH_TILES; dx <= BEND_REACH_TILES; dx++) {
          if (dx * insideX + dy * insideY <= 0) continue;
          const x = point.x + dx;
          const y = point.y + dy;
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          const at = y * size + x;
          if (bend > strength[at]) strength[at] = bend;
        }
      }
    }
  }
  return strength;
}

/** Tiles from (x, y) to the nearest open water, up to `limit`; `limit + 1` when none is that close. */
function tilesToWater(grid: TileGrid, x: number, y: number, limit: number): number {
  for (let ring = 1; ring <= limit; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        if (isWater(grid, x + dx, y + dy)) return ring;
      }
    }
  }
  return limit + 1;
}

const SECOND_ROW_TILES = 2;

/**
 * Grows reeds and rushes along the lowland banks, thickest on the inside of
 * the bends, with a few stones among them.
 *
 * Only on field grass: the upland banks are turf and rock where reeds do not
 * take. Placed by a hash of the world's seed rather than the generator's
 * random stream, so planting a bank does not reshuffle any pass after it.
 * Reeds are walkable cover, so nothing about where a crawler can go changes.
 */
export function plantRiverbanks(
  grid: TileGrid,
  rivers: ReadonlyArray<RiverCourse>,
  border: number,
  landmarks: KeepOut,
  seed: number,
): void {
  const inside = insideBendStrength(grid, rivers);
  const reedSalt = (seed + REED_SALT) | 0;
  const pebbleSalt = (seed + BANK_PEBBLE_SALT) | 0;
  for (let y = border; y < grid.size - border; y++) {
    for (let x = border; x < grid.size - border; x++) {
      if (grid.typeAt(x, y) !== FloorTypeValue.grass) continue;
      const toWater = tilesToWater(grid, x, y, SECOND_ROW_TILES);
      if (toWater > SECOND_ROW_TILES) continue;
      if (landmarks.contains(x, y)) continue;
      const bend = inside[y * grid.size + x];
      const atEdge = toWater === 1;
      const reedChance = atEdge
        ? REED_EDGE_CHANCE + REED_INSIDE_BEND_BONUS * bend
        : REED_INSIDE_BEND_BONUS * REED_SECOND_ROW_SHARE * bend;
      if (tileHash01(x, y, reedSalt) < reedChance) {
        grid.setStanding(x, y, RIVER_REEDS);
      } else if (atEdge && tileHash01(x, y, pebbleSalt) < BANK_PEBBLE_CHANCE) {
        grid.setStanding(x, y, PEBBLE_SCATTER);
      }
    }
  }
}
