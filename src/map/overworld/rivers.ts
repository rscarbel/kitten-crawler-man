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
  RIVER_ROCK,
  flowDirFromAngle,
} from '../tileTypes';
import type { BridgeAxis, TileGrid } from '../town/tileGrid';
import type { TilePoint, TownPlan } from '../town/townPlan';
import type { ElevationField } from './elevation';
import { NO_REGION, Reachability } from './reachability';

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
  const sourceSide = Math.floor(Math.random() * EDGE_SIDES) % EDGE_SIDES;
  const mouthSide = (sourceSide + OPPOSITE_SIDE_OFFSET) % EDGE_SIDES;

  let source = edgePoint(sourceSide, Math.random(), size, inset);
  let sourceElevation = -Infinity;
  let mouth = edgePoint(mouthSide, Math.random(), size, inset);
  let mouthElevation = Infinity;

  for (let i = 0; i < EDGE_CANDIDATE_SAMPLES; i++) {
    const sourceCandidate = edgePoint(sourceSide, Math.random(), size, inset);
    const sourceHeight = elevation.elevationAt(sourceCandidate.x, sourceCandidate.y);
    if (sourceHeight > sourceElevation) {
      sourceElevation = sourceHeight;
      source = sourceCandidate;
    }
    const mouthCandidate = edgePoint(mouthSide, Math.random(), size, inset);
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
    // Deflected around the town, not rejected on touching it. Rejection is what
    // it used to be, and it made the router blind: source and mouth sit on
    // opposite edges, so a course runs straight at the keep-out disc in the
    // middle of the map, walks into it, and throws the whole route away —
    // measured at 1 map in 40 shipping with *no river at all*, the entire
    // feature silently absent. Sliding along the disc's edge instead means a
    // course always completes and the river simply goes round the town.
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
    const wobble = (Math.random() - ARC_MIDPOINT) * ARC_FULL_SPAN * RIVER_WOBBLE_RADIANS;
    heading += turn * RIVER_TURN_RATE + wobble;
    x += Math.cos(heading) * RIVER_STEP_TILES;
    y += Math.sin(heading) * RIVER_STEP_TILES;
  }
  return null;
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
function carveChannel(grid: TileGrid, path: ReadonlyArray<TilePoint>, border: number): void {
  path.forEach((point, index) => {
    const progress = index / Math.max(1, path.length - 1);
    const halfWidth = halfWidthAt(progress, index);
    const next = path[Math.min(path.length - 1, index + 1)];
    const flowDir = flowDirFromAngle(Math.atan2(next.y - point.y, next.x - point.x));
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
        grid.setRiverWater(tx, ty, flowDir);
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
  ];

  const rivers: RiverCourse[] = [];
  for (let river = 0; river < NUM_RIVERS; river++) {
    for (let attempt = 0; attempt < MAX_RIVER_ATTEMPTS_PER_RIVER; attempt++) {
      const path = routeRiver(elevation, grid.size, border, keepOut);
      if (path === null) continue;
      carveChannel(grid, path, border);
      rivers.push({ path });
      break;
    }
  }
  return rivers;
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
 * Runs **after every road pass**, including `paintBuildingBypassRoutes` and the
 * circus's approach: `TileGrid.setPaved` will not write over water, so a road
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
      if (Math.random() >= RIVER_ROCK_CHANCE_PER_STEP) continue;
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
