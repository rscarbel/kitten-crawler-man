import { ROOM_WALL_OUTWARD, type Point, type Rect, type RoomDoorway } from './roomDoorways';

/**
 * Whether the floor's bathrooms still turn the queue away. One state shared by
 * every copy: a single fix opens them all.
 */
export type BathroomPlumbing = 'broken' | 'fixed';

/**
 * One copy of the clogged bathroom seated halfway along a gauntlet branch, and
 * where everything inside it stands.
 *
 * Every tile is in map tile coordinates. The stalls, the pipe wall and the
 * plumber are all on the north face because that is the only wall face the
 * dungeon draws straight on.
 */
export interface BathroomRoomData {
  bounds: Rect;
  centre: Point;
  /** Which branch of the gauntlet this copy stands on, in the plan's branch order. */
  branchIndex: number;
  /** Middle perimeter tile of the doorway the player arrives through. */
  entranceTile: Point;
  entranceDoorway: RoomDoorway;
  /** Every doorway but the entrance. Blocked while the plumbing is broken. */
  blockedDoorways: RoomDoorway[];
  /**
   * The floor tile in front of each stall door, west to east, on the room's top
   * row. Each stall is {@link STALL_WIDTH_TILES} wide: this tile and the one
   * east of it.
   */
  stallDoorTiles: Point[];
  /** Floor tiles against the side wall nearest the entrance, where the sinks hang. */
  sinkTiles: Point[];
  /** The north wall-face tile the pipe access panel is set into. */
  pipeWallTile: Point;
  /** The floor tile directly below {@link pipeWallTile}, which the pipes are worked from. */
  pipeWallStandTile: Point;
  /** Where the plumber stands: in the aisle in front of the stalls, at the head of the line. */
  plumberTile: Point;
  /**
   * The line, head first: from just behind the plumber, through the room, out
   * through the primary blocked doorway and {@link QUEUE_CORRIDOR_SPILL_TILES}
   * tiles into the corridor beyond. One goblin stands on each.
   */
  queueTiles: Point[];
  /**
   * Packed knots of goblins, one per group of flagged tiles the line does not
   * stand on: the rest of the width of the doorway the line leaves by, when it
   * is wider than one tile, and then each other blocked doorway with the
   * corridor just outside it. Together with {@link queueTiles} they hold every
   * tile `bathroomBlockedTiles` flags, each exactly once.
   */
  doorwayKnots: Point[][];
  /** Standing spots along the walls, off every doorway's path, for after the fix. */
  loiterTiles: Point[];
}

export const STALL_COUNT = 4;
export const STALL_WIDTH_TILES = 2;
export const SINK_COUNT = 2;
/** How far the line runs on into the corridor past the doorway it leaves by. */
export const QUEUE_CORRIDOR_SPILL_TILES = 4;
/** Tiles in a doorway knot, its own doorway tiles included. */
export const DOORWAY_KNOT_TILES = 6;

/** The in-room line is searched for in this length band, head and doorway tiles included. */
const QUEUE_ROOM_TILES_MIN = 14;
const QUEUE_ROOM_TILES_MAX = 22;
/** Search nodes the snaking line may spend before falling back to the shortest line. */
const QUEUE_SEARCH_NODE_BUDGET = 20_000;
/**
 * The top two rows stay free of the line, so walking along them reaches every
 * stall: the stall doors, then the aisle the plumber stands in. The one
 * exception is a line that leaves by a north or corner doorway, which has to
 * cross the aisle to get out.
 */
const STALL_AISLE_ROWS = 2;
/** Chebyshev distance the line keeps from the entrance doorway, so the way in never looks full. */
const ENTRANCE_KEEP_CLEAR_TILES = 2;
/**
 * Chebyshev distance two goblin-held tiles that are not neighbours in line must
 * keep. At one they would touch, and a line that touches itself or a wall can
 * close off a pocket of the room.
 */
const NON_ADJACENT_SPACING = 2;
/** Chebyshev distance loiter spots keep from every doorway tile. */
const DOORWAY_LOITER_CLEARANCE_TILES = 2;
/**
 * Columns of plain wall left between the pipe panel and the first stall where
 * the face is long enough, so the two never read as one fixture.
 */
const PIPE_TO_STALL_GAP_TILES = 1;
/** Rows between the two sinks, so each has its own stretch of wall. */
const SINK_ROW_SPACING = 2;

export interface BathroomLayoutInput {
  bounds: Rect;
  entrance: RoomDoorway;
  /** Every doorway but the entrance. The one farthest from the entrance carries the line. */
  blocked: ReadonlyArray<RoomDoorway>;
  /** Walkable floor anywhere on the map. */
  isOpen: (x: number, y: number) => boolean;
  /** Walkable floor outside every room: the corridors a line or a knot may spill into. */
  isCorridor: (x: number, y: number) => boolean;
  /**
   * Whether the plumber's tile counts as solid. Always true in the game, where
   * he is anchored in place; false only for a gate's self-test.
   */
  plumberBlocks: boolean;
}

export type BathroomLayout = Pick<
  BathroomRoomData,
  | 'stallDoorTiles'
  | 'sinkTiles'
  | 'pipeWallTile'
  | 'pipeWallStandTile'
  | 'plumberTile'
  | 'queueTiles'
  | 'doorwayKnots'
  | 'loiterTiles'
>;

type Side = 'west' | 'east';

interface StallRowPlan {
  pipeX: number;
  stallXs: number[];
  /** Columns the plumber may stand in, best first: in front of the stall farthest from the pipes. */
  plumberXs: number[];
}

const CARDINAL: ReadonlyArray<Point> = ROOM_WALL_OUTWARD.map((side) => ({
  x: side.dx,
  y: side.dy,
}));

function chebyshev(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function manhattan(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

function rectContains(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x && point.x < rect.x + rect.w && point.y >= rect.y && point.y < rect.y + rect.h
  );
}

function nearAny(point: Point, others: ReadonlyArray<Point>, distance: number): boolean {
  return others.some((other) => chebyshev(point, other) <= distance);
}

function keyOf(point: Point): string {
  return `${point.x},${point.y}`;
}

/** Which half of the room the entrance opens into, west or east. */
function entranceSide(bounds: Rect, entrance: RoomDoorway): Side {
  if (entrance.wall === 'west') return 'west';
  if (entrance.wall === 'east') return 'east';
  const centreX = bounds.x + (bounds.w - 1) / 2;
  return entrance.tile.x <= centreX ? 'west' : 'east';
}

/**
 * Pipe wall and stalls along the north face, in order of preference: the pipe
 * wall at the entrance end, then the far end; a column of wall between the
 * pipes and the first stall where it fits, flush where it does not.
 */
function stallRowPlans(
  bounds: Rect,
  side: Side,
  faceIsWall: (x: number) => boolean,
): StallRowPlan[] {
  const left = bounds.x;
  const right = bounds.x + bounds.w - 1;
  const westToEast: number[] = [];
  for (let x = left; x <= right; x++) westToEast.push(x);
  const eastToWest = [...westToEast].reverse();
  const orders = side === 'west' ? [westToEast, eastToWest] : [eastToWest, westToEast];
  const gaps = [PIPE_TO_STALL_GAP_TILES, 0];

  const plans: StallRowPlan[] = [];
  for (const order of orders) {
    for (const gap of gaps) {
      for (const [pipeIndex, pipeX] of order.entries()) {
        // The panel sits away from the ends of its face, so it is seen straight on.
        if (!faceIsWall(pipeX - 1) || !faceIsWall(pipeX) || !faceIsWall(pipeX + 1)) continue;
        const stallPairs: Array<{ near: number; far: number }> = [];
        let next = pipeIndex + 1 + gap;
        while (next + 1 < order.length && stallPairs.length < STALL_COUNT) {
          const near = order[next];
          const far = order[next + 1];
          if (faceIsWall(near) && faceIsWall(far)) {
            stallPairs.push({ near, far });
            next += STALL_WIDTH_TILES;
          } else {
            next++;
          }
        }
        if (stallPairs.length < STALL_COUNT) continue;
        const farthest = stallPairs[STALL_COUNT - 1];
        const stallXs = stallPairs
          .map((pair) => Math.min(pair.near, pair.far))
          .sort((a, b) => a - b);
        plans.push({
          pipeX,
          stallXs,
          plumberXs: [farthest.far, farthest.near],
        });
        break;
      }
    }
  }
  return plans;
}

/** Sink tiles on the entrance-side wall, falling back to the other side wall. */
function placeSinks(
  bounds: Rect,
  side: Side,
  keepClearOf: ReadonlyArray<Point>,
  isOpen: (x: number, y: number) => boolean,
): Point[] | null {
  const left = bounds.x;
  const right = bounds.x + bounds.w - 1;
  const bottom = bounds.y + bounds.h - 1;
  const walls: ReadonlyArray<{ x: number; outsideX: number }> =
    side === 'west'
      ? [
          { x: left, outsideX: left - 1 },
          { x: right, outsideX: right + 1 },
        ]
      : [
          { x: right, outsideX: right + 1 },
          { x: left, outsideX: left - 1 },
        ];
  for (const wall of walls) {
    const sinks: Point[] = [];
    for (let y = bounds.y + STALL_AISLE_ROWS; y < bottom && sinks.length < SINK_COUNT; y++) {
      const tile = { x: wall.x, y };
      if (isOpen(wall.outsideX, y)) continue;
      if (nearAny(tile, keepClearOf, 1)) continue;
      const tooCloseToLast = sinks.some((sink) => y - sink.y < SINK_ROW_SPACING);
      if (tooCloseToLast) continue;
      sinks.push(tile);
    }
    if (sinks.length === SINK_COUNT) return sinks;
  }
  return null;
}

interface LineExit {
  door: Point;
  inside: Point;
  outward: Point;
}

/**
 * Ways the line can leave by: a doorway tile, the room tile just inside it and
 * the direction out. Tiles nearest the doorway's middle come first, and a tile
 * whose inside neighbour sits on the room's edge (a corner opening) comes after
 * every other, since the line then has to bend straight off the wall.
 */
function lineExits(
  bounds: Rect,
  doorway: RoomDoorway,
  isCorridor: (x: number, y: number) => boolean,
): LineExit[] {
  const byCloseness = [...doorway.tiles].sort(
    (a, b) => manhattan(a, doorway.tile) - manhattan(b, doorway.tile),
  );
  const clear: LineExit[] = [];
  const onEdge: LineExit[] = [];
  for (const door of byCloseness) {
    for (const outward of CARDINAL) {
      const outside = { x: door.x + outward.x, y: door.y + outward.y };
      if (rectContains(bounds, outside) || !isCorridor(outside.x, outside.y)) continue;
      const inside = { x: door.x - outward.x, y: door.y - outward.y };
      if (!rectContains(bounds, inside)) continue;
      const insideOnEdge =
        inside.x <= bounds.x ||
        inside.x >= bounds.x + bounds.w - 1 ||
        inside.y <= bounds.y ||
        inside.y >= bounds.y + bounds.h - 1;
      (insideOnEdge ? onEdge : clear).push({ door, inside, outward });
    }
  }
  return [...clear, ...onEdge];
}

/**
 * The in-room line from its head to the tile inside its doorway, snaking where
 * the room allows. Every tile but its two neighbours in line keeps
 * {@link NON_ADJACENT_SPACING} from every other, and only the tiles at its
 * doorway may touch the room's edge, so the line is a single arc hanging off
 * that doorway: it can never cut one part of the room off from another.
 */
function snakeLine(head: Point, end: Point, allowed: (point: Point) => boolean): Point[] | null {
  if (!allowed(head) || !allowed(end)) return null;
  const path: Point[] = [head];
  let nodes = 0;

  const keepsSpacing = (candidate: Point): boolean => {
    const spacedFrom = path.length - 2;
    for (let index = 0; index < spacedFrom; index++) {
      if (chebyshev(candidate, path[index]) < NON_ADJACENT_SPACING) return false;
    }
    return !path.some((tile) => samePoint(tile, candidate));
  };

  const search = (heading: Point): boolean => {
    nodes++;
    if (nodes > QUEUE_SEARCH_NODE_BUDGET) return false;
    const current = path[path.length - 1];
    if (samePoint(current, end)) return path.length >= QUEUE_ROOM_TILES_MIN;
    const turns = CARDINAL.filter(
      (step) =>
        !(step.x === heading.x && step.y === heading.y) &&
        !(step.x === -heading.x && step.y === -heading.y),
    ).sort(
      (a, b) =>
        manhattan({ x: current.x + a.x, y: current.y + a.y }, end) -
        manhattan({ x: current.x + b.x, y: current.y + b.y }, end),
    );
    for (const step of [heading, ...turns]) {
      const next = { x: current.x + step.x, y: current.y + step.y };
      if (!allowed(next) || !keepsSpacing(next)) continue;
      const lengthWithNext = path.length + 1;
      if (lengthWithNext + manhattan(next, end) > QUEUE_ROOM_TILES_MAX) continue;
      if (samePoint(next, end) && lengthWithNext < QUEUE_ROOM_TILES_MIN) continue;
      path.push(next);
      if (search(step)) return true;
      path.pop();
    }
    return false;
  };

  const awayFromStalls = { x: 0, y: 1 };
  if (search(awayFromStalls)) return path;
  return shortestLine(head, end, allowed);
}

/**
 * Whether every tile of a line keeps {@link NON_ADJACENT_SPACING} from every
 * tile but its two neighbours in line.
 */
function keepsLineSpacing(line: ReadonlyArray<Point>): boolean {
  for (let later = 0; later < line.length; later++) {
    for (let earlier = 0; earlier + NON_ADJACENT_SPACING < later; earlier++) {
      if (chebyshev(line[later], line[earlier]) < NON_ADJACENT_SPACING) return false;
    }
  }
  return true;
}

/**
 * The shortest line from head to end, when the snaking search runs out of
 * budget. Null when it breaks the spacing rule, which a shortest path can do
 * where the allowed region bends round a corner.
 */
function shortestLine(head: Point, end: Point, allowed: (point: Point) => boolean): Point[] | null {
  const cameFrom = new Map<string, Point | null>([[keyOf(head), null]]);
  const queue: Point[] = [head];
  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor];
    cursor++;
    if (samePoint(current, end)) {
      const line: Point[] = [];
      let walk: Point | null = current;
      while (walk !== null) {
        line.push(walk);
        walk = cameFrom.get(keyOf(walk)) ?? null;
      }
      line.reverse();
      return keepsLineSpacing(line) ? line : null;
    }
    for (const step of CARDINAL) {
      const next = { x: current.x + step.x, y: current.y + step.y };
      if (cameFrom.has(keyOf(next)) || !allowed(next)) continue;
      cameFrom.set(keyOf(next), current);
      queue.push(next);
    }
  }
  return null;
}

/** Corridor tiles the line runs on into past its doorway, following the corridor's turns. */
function spillTiles(
  bounds: Rect,
  door: Point,
  outward: Point,
  isCorridor: (x: number, y: number) => boolean,
): Point[] {
  const spill: Point[] = [];
  const centre = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
  let current = door;
  let heading = outward;
  while (spill.length < QUEUE_CORRIDOR_SPILL_TILES) {
    const options = [
      heading,
      ...CARDINAL.filter((step) => step.x !== heading.x || step.y !== heading.y),
    ]
      .map((step) => ({ step, tile: { x: current.x + step.x, y: current.y + step.y } }))
      .filter(
        ({ tile }) =>
          !rectContains(bounds, tile) &&
          isCorridor(tile.x, tile.y) &&
          !spill.some((taken) => samePoint(taken, tile)) &&
          manhattan(tile, centre) > manhattan(current, centre),
      );
    if (options.length === 0) break;
    const chosen = options[0];
    spill.push(chosen.tile);
    current = chosen.tile;
    heading = chosen.step;
  }
  return spill;
}

/** A doorway's own tiles, then the nearest corridor tiles outside it. */
function doorwayKnot(
  bounds: Rect,
  doorway: RoomDoorway,
  isCorridor: (x: number, y: number) => boolean,
): Point[] {
  const knot: Point[] = [...doorway.tiles];
  const seen = new Set(knot.map(keyOf));
  const frontier: Point[] = [...doorway.tiles];
  let cursor = 0;
  while (cursor < frontier.length && knot.length < DOORWAY_KNOT_TILES) {
    const current = frontier[cursor];
    cursor++;
    for (const step of CARDINAL) {
      if (knot.length >= DOORWAY_KNOT_TILES) break;
      const next = { x: current.x + step.x, y: current.y + step.y };
      if (seen.has(keyOf(next))) continue;
      seen.add(keyOf(next));
      if (rectContains(bounds, next) || !isCorridor(next.x, next.y)) continue;
      knot.push(next);
      frontier.push(next);
    }
  }
  return knot;
}

/**
 * Spots for the goblins to drift to after the fix, one each: the ring against
 * the walls first, then each ring further in, kept clear of the doorways. Only
 * if every ring is full does a spot come closer to a doorway than that, and
 * never onto one.
 */
function loiterSpots(
  bounds: Rect,
  avoid: ReadonlyArray<Point>,
  doorwayTiles: ReadonlyArray<Point>,
  wanted: number,
): Point[] {
  const left = bounds.x;
  const right = bounds.x + bounds.w - 1;
  const bottom = bounds.y + bounds.h - 1;
  const firstRow = bounds.y + STALL_AISLE_ROWS;
  const rings: Point[][] = [];
  for (let inset = 0; left + inset <= right - inset && firstRow <= bottom - inset; inset++) {
    const ring: Point[] = [];
    for (let y = firstRow; y <= bottom - inset; y++) ring.push({ x: left + inset, y });
    for (let x = left + inset + 1; x <= right - inset - 1; x++) ring.push({ x, y: bottom - inset });
    for (let y = bottom - inset; y >= firstRow; y--) ring.push({ x: right - inset, y });
    rings.push(ring);
  }
  const candidates = rings.flat();
  const spots: Point[] = [];
  const taken = new Set<string>(avoid.map(keyOf));
  for (const clearance of [DOORWAY_LOITER_CLEARANCE_TILES, 0]) {
    for (const tile of candidates) {
      if (spots.length >= wanted) return spots;
      if (taken.has(keyOf(tile))) continue;
      if (nearAny(tile, doorwayTiles, clearance)) continue;
      taken.add(keyOf(tile));
      spots.push(tile);
    }
  }
  return spots;
}

/**
 * Lays out one bathroom: stalls, sinks, pipe wall, plumber, the line, the
 * doorway knots and the loiter spots. Pure, so the gates can call it on any
 * room shape. Null when the room cannot hold a layout that keeps every stall,
 * the pipe wall and the plumber reachable from the entrance with the line in
 * place.
 */
export function layOutBathroom(input: BathroomLayoutInput): BathroomLayout | null {
  const { bounds, entrance, blocked, isOpen, isCorridor, plumberBlocks } = input;
  if (blocked.length === 0) return null;
  const top = bounds.y;
  const left = bounds.x;
  const right = bounds.x + bounds.w - 1;
  const bottom = bounds.y + bounds.h - 1;

  const allDoorways = [entrance, ...blocked];
  const doorwayTiles = allDoorways.flatMap((doorway) => doorway.tiles);
  const isDoorwayTile = (x: number, y: number): boolean =>
    doorwayTiles.some((tile) => tile.x === x && tile.y === y);
  const faceIsWall = (x: number): boolean =>
    x >= left && x <= right && !isOpen(x, top - 1) && !isDoorwayTile(x, top);

  const side = entranceSide(bounds, entrance);

  const byDistanceFromEntrance = [...blocked].sort(
    (a, b) => manhattan(b.tile, entrance.tile) - manhattan(a.tile, entrance.tile),
  );
  const primary = byDistanceFromEntrance[0];
  const exits = lineExits(bounds, primary, isCorridor);
  const knotDoorways = byDistanceFromEntrance.slice(1);
  const knotDoorwayTiles = knotDoorways.flatMap((doorway) => doorway.tiles);

  for (const plan of stallRowPlans(bounds, side, faceIsWall)) {
    for (const plumberX of plan.plumberXs) {
      const plumberTile = { x: plumberX, y: top + 1 };
      const head = { x: plumberX, y: top + STALL_AISLE_ROWS };
      for (const exit of exits) {
        const sinks = placeSinks(bounds, side, [...doorwayTiles, head, exit.inside], isOpen);
        if (sinks === null) continue;
        const primaryOtherTiles = primary.tiles.filter((tile) => !samePoint(tile, exit.door));
        // An exit inside the aisle row, from a north doorway or a corner one,
        // can only be reached by crossing the aisle beside it.
        const exitInAisle = exit.inside.y < top + STALL_AISLE_ROWS;
        const allowed = (point: Point): boolean => {
          if (samePoint(point, exit.inside)) return true;
          if (samePoint(point, plumberTile)) return false;
          const besideAisleExit =
            exitInAisle && point.y === exit.inside.y && manhattan(point, exit.inside) === 1;
          if (point.x <= left || point.x >= right) return false;
          if (!besideAisleExit && point.y < top + STALL_AISLE_ROWS) return false;
          if (point.y >= bottom) return false;
          if (nearAny(point, entrance.tiles, ENTRANCE_KEEP_CLEAR_TILES)) return false;
          if (nearAny(point, sinks, NON_ADJACENT_SPACING - 1)) return false;
          if (nearAny(point, knotDoorwayTiles, NON_ADJACENT_SPACING - 1)) return false;
          if (!besideAisleExit && nearAny(point, primaryOtherTiles, NON_ADJACENT_SPACING - 1)) {
            return false;
          }
          return true;
        };
        const line = snakeLine(head, exit.inside, allowed);
        if (line === null) continue;

        const queueTiles = [
          ...line,
          exit.door,
          ...spillTiles(bounds, exit.door, exit.outward, isCorridor),
        ];
        // The line takes one tile of a wide doorway; the rest of its width is
        // flagged too, so it gets a knot of its own or the player would meet a
        // wall in an empty gap.
        const doorwayKnots = withoutRepeats(queueTiles, [
          ...(primaryOtherTiles.length > 0 ? [primaryOtherTiles] : []),
          ...knotDoorways.map((doorway) => doorwayKnot(bounds, doorway, isCorridor)),
        ]);
        const goblinCount =
          queueTiles.length + doorwayKnots.reduce((sum, knot) => sum + knot.length, 0);
        const pipeWallStandTile = { x: plan.pipeX, y: top };
        const stallDoorTiles = plan.stallXs.map((x) => ({ x, y: top }));
        const solid = [
          ...queueTiles,
          ...doorwayKnots.flat(),
          ...blocked.flatMap((doorway) => doorway.tiles),
          ...sinks,
          ...(plumberBlocks ? [plumberTile] : []),
        ];
        const reachable = roomReachableFrom(bounds, entrance.tiles, solid);
        const plumberInReach = plumberTalkTiles(plumberTile).some((tile) =>
          reachable.has(keyOf(tile)),
        );
        const everyPartReachable =
          plumberInReach &&
          reachable.has(keyOf(pipeWallStandTile)) &&
          stallDoorTiles.every((tile) => reachable.has(keyOf(tile)));
        if (!everyPartReachable) continue;
        return {
          stallDoorTiles,
          sinkTiles: sinks,
          pipeWallTile: { x: plan.pipeX, y: top - 1 },
          pipeWallStandTile,
          plumberTile,
          queueTiles,
          doorwayKnots,
          loiterTiles: loiterSpots(
            bounds,
            [...sinks, plumberTile, pipeWallStandTile, ...stallDoorTiles],
            doorwayTiles,
            goblinCount,
          ),
        };
      }
    }
  }
  return null;
}

/**
 * The knots with every tile already held by the line or an earlier knot taken
 * out, so each flagged tile has exactly one goblin on it. Knots left empty are
 * dropped.
 */
function withoutRepeats(line: ReadonlyArray<Point>, knots: ReadonlyArray<Point[]>): Point[][] {
  const held = new Set(line.map(keyOf));
  const kept: Point[][] = [];
  for (const knot of knots) {
    const own = knot.filter((tile) => !held.has(keyOf(tile)));
    for (const tile of own) held.add(keyOf(tile));
    if (own.length > 0) kept.push(own);
  }
  return kept;
}

/** Room tiles reachable from the entrance with `solid` tiles stepped round. */
function roomReachableFrom(
  bounds: Rect,
  from: ReadonlyArray<Point>,
  solid: ReadonlyArray<Point>,
): Set<string> {
  const solidKeys = new Set(solid.map(keyOf));
  const reached = new Set<string>();
  const queue = from.filter((tile) => !solidKeys.has(keyOf(tile)));
  for (const tile of queue) reached.add(keyOf(tile));
  // The iterator re-reads `length`, so tiles pushed below are visited by this loop.
  for (const tile of queue) {
    for (const step of CARDINAL) {
      const next = { x: tile.x + step.x, y: tile.y + step.y };
      const key = keyOf(next);
      if (reached.has(key) || solidKeys.has(key) || !rectContains(bounds, next)) continue;
      reached.add(key);
      queue.push(next);
    }
  }
  return reached;
}

/**
 * Every tile no one can walk while the plumbing is broken: the blocked tiles
 * and the plumber's own, since he is anchored in place and always in the way.
 * Anything deciding what the player can reach in a bathroom treats these as
 * solid.
 */
export function bathroomImpassableTiles(
  room: Pick<BathroomRoomData, 'blockedDoorways' | 'queueTiles' | 'doorwayKnots' | 'plumberTile'>,
): Point[] {
  return [...bathroomBlockedTiles(room), room.plumberTile];
}

/**
 * The tiles the plumber can be talked to from: the four beside him. His own
 * tile never counts, because he is standing on it.
 */
export function plumberTalkTiles(plumberTile: Point): Point[] {
  return CARDINAL.map((step) => ({ x: plumberTile.x + step.x, y: plumberTile.y + step.y }));
}

/**
 * Every tile the bathroom block flag covers: the blocked doorways, the line and
 * the knots. Goblins stand on all of them, so the player never walks through
 * a goblin into an invisible wall.
 */
export function bathroomBlockedTiles(
  room: Pick<BathroomRoomData, 'blockedDoorways' | 'queueTiles' | 'doorwayKnots'>,
): Point[] {
  const tiles = new Map<string, Point>();
  for (const tile of [
    ...room.blockedDoorways.flatMap((doorway) => doorway.tiles),
    ...room.queueTiles,
    ...room.doorwayKnots.flat(),
  ]) {
    tiles.set(keyOf(tile), tile);
  }
  return [...tiles.values()];
}
