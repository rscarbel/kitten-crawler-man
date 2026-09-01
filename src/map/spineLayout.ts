import { clamp, normalize, randomInt } from '../utils';
import {
  planCorridorBetween,
  rectCentre,
  rectCentredOn,
  type CorridorKind,
  type SegmentMap,
  type PlannedCorridor,
  type Point,
  type Rect,
} from './gauntletLayout';

/**
 * The spine: one forced, winding chain of rooms between two fixed landmarks,
 * replacing the loopy free-region sprawl on a floor that declares one.
 *
 * Unlike a gauntlet branch, which grows outward from an entry room toward a
 * gateway it is free to approach from any side, both of the spine's endpoints
 * are decided before it is planned — the last gateway boss room at one end and
 * the arena's antechamber at the other. What makes the journey long is therefore
 * not the distance between them, which on a compact floor is only a few dozen
 * tiles, but how far the route winds on the way: the room count is a contract
 * about the walk.
 *
 * Every room and every corridor takes a segment of its own. That is stricter
 * than a gauntlet needs and deliberately so — same-segment tiles are allowed to
 * touch, so two spine corridors sharing a segment could run alongside each other
 * and join two non-consecutive rooms, which is precisely the bypass the spine
 * exists to remove. With one segment each, the carved map's room graph is
 * exactly the planned one.
 */

/**
 * Tightest straight-line spacing between consecutive chain rooms.
 *
 * Set by the rooms themselves: two of the widest, plus the gap every room keeps
 * from every other, need about this much between their centres. A little over
 * that, because the seating jitter can only widen the gap by chance.
 */
const SPINE_ROOM_PITCH = 20;
/**
 * Clearance kept from both endpoints, as a straight-line distance.
 *
 * The boss room is 22×18 and the antechamber is wider still, so a chain room
 * seated much closer than this to either centre simply will not fit beside it.
 */
const SPINE_END_CLEARANCE = 28;

const SPINE_ROOM_W_MIN = 8;
const SPINE_ROOM_W_MAX = 14;
const SPINE_ROOM_H_MIN = 7;
const SPINE_ROOM_H_MAX = 12;

/** Widening jitter applied on each successive attempt to seat one room. */
const SEAT_JITTER_STEP = 3;
const MAX_SEAT_ATTEMPTS = 10;

/**
 * Shortest chain that can carry the quest room without putting it at either end.
 * Exported so the validator holds a built spine to the same floor.
 */
export const MIN_CHAIN_ROOMS = 3;
/** Extra spacing a step may draw on top of the pitch, so the chain is not a lattice. */
const SPINE_PITCH_SLACK = 6;
/**
 * Spare rooms at which the route is free to wander as far sideways as it likes.
 * Below it the freedom tapers off; at zero the chain heads straight at the far
 * endpoint. See {@link allowedDeviation}.
 */
const SLACK_FOR_FULL_WANDER = 4;
/** Widest angle off the bearing to the far endpoint the route may ever take. */
const MAX_DEVIATION_RADIANS = 2;
/** How far the chain turns per room while it is leaning one way. */
const TURN_PER_ROOM_MIN = 0.35;
const TURN_PER_ROOM_MAX = 0.75;
/** Rooms a lean lasts before the chain starts bending back the other way. */
const ROOMS_PER_LEAN_MIN = 2;
const ROOMS_PER_LEAN_MAX = 4;
/** Spread of the initial heading around the straight line to the far endpoint. */
const START_HEADING_JITTER = 1;
/**
 * Headings tried for one room, as offsets from the leaned heading, nearest
 * first. The first is the one the lean asked for; the rest are how the route
 * steps around ground the gauntlet, the arena or the map's edge has taken.
 */
const HEADING_NUDGE_STEP_RADIANS = 0.4;
const HEADING_NUDGE_STEPS = 5;
const HEADING_NUDGES = alternatingOffsets(HEADING_NUDGE_STEP_RADIANS, HEADING_NUDGE_STEPS);
/** Furthest the last chain room may sit from the antechamber it must reach. */
const SPINE_FINAL_GAP_MAX = 55;
/** Sideways offsets a dog-leg corridor's pivot is tried at, when a plain L will not fit. */
const CORRIDOR_PIVOT_STEP_TILES = 7;
const CORRIDOR_PIVOT_STEPS = 4;
const CORRIDOR_PIVOT_OFFSETS = Array.from(
  { length: CORRIDOR_PIVOT_STEPS },
  (_, index) => (index + 1) * CORRIDOR_PIVOT_STEP_TILES,
);

/** Rooms an alternate lane may hold. Two paths, never more than two rooms. */
export const SPLIT_LANE_MAX_ROOMS = 2;
/** How far off the chain a lane room is seated, perpendicular to the local heading. */
const LANE_OFFSET_MIN = 20;
const LANE_OFFSET_MAX = 28;
/** How far off the chain a dead-end pocket is seated. */
const POCKET_OFFSET_MIN = 22;
const POCKET_OFFSET_MAX = 30;
/**
 * How far off the chain the spider lab is seated. Far larger than a pocket's
 * because the lab is 40×32: its own half-width plus the chain room's plus the
 * room gap is already most of this.
 */
const LAB_OFFSET_MIN = 34;
const LAB_OFFSET_MAX = 44;
/** Chain rooms the mid-spine station tries before the whole spine is given up on. */
const STATION_HOST_ATTEMPTS = 5;
/** Offsets tried per candidate host before the lab moves on to the next room. */
const LAB_OFFSETS_PER_HOST = 3;
/** The lab hangs off the earlier part of the spine, so the option is seen early. */
const LAB_CHAIN_NUMERATOR = 2;
const LAB_CHAIN_DENOMINATOR = 3;
const LAB_CHAIN_FRACTION = LAB_CHAIN_NUMERATOR / LAB_CHAIN_DENOMINATOR;

/** Perpendicular directions a side room may be seated in, tried in a random order. */
const SIDE_SIGNS = [-1, 1] as const;

/** Whether a corridor leg runs horizontally first. Both orientations are tried. */
const CORRIDOR_LEG_ORDERS = [true, false] as const;

/** Probability of either outcome in a fair coin flip. */
const EVEN_CHANCE = 0.5;

const FULL_TURN_RADIANS = Math.PI * 2;

/**
 * Offsets either side of zero at a fixed step, nearest first: `0, +s, -s, +2s,
 * -2s, …`. The order is the search order — try what was asked for, then the
 * smallest departure from it that works.
 */
function alternatingOffsets(step: number, steps: number): number[] {
  const offsets = [0];
  for (let index = 1; index <= steps; index++) offsets.push(step * index, -step * index);
  return offsets;
}

/** What a room seated on the spine is for. */
export type SpineRoomKind = 'chain' | 'quest';

export interface SpineChainRoom {
  rect: Rect;
  kind: SpineRoomKind;
}

/** One dead end hanging off the chain: a treasure room, or the mid-spine station. */
export interface SpinePocket {
  rect: Rect;
  role: 'safe' | 'regular';
}

/**
 * A second lane between two consecutive chain rooms.
 *
 * The fork and the join stay cut vertices; only the lane's own rooms are
 * bypassable, and only pairwise — which is exactly "at most two paths, never
 * more than two rooms".
 */
export interface SpineLane {
  /** Index into {@link SpinePlan.chain} of the room the lane forks from. */
  forkIndex: number;
  rooms: Rect[];
}

export interface SpinePlan {
  /** The forced chain, in walking order, endpoints exclusive. */
  chain: SpineChainRoom[];
  /**
   * The corridor the player arrives at the quest room through.
   *
   * Named rather than inferred, because every doorway but the way in is a way
   * onward — the goblin mother's to bar for the length of a wave — and a
   * corridor's L can arrive at a wall that faces nowhere near the room it came
   * from.
   */
  questEntryCorridor: PlannedCorridor | null;
  lanes: SpineLane[];
  labRoom: Rect | null;
  pockets: SpinePocket[];
  corridors: PlannedCorridor[];
}

export interface SpinePocketRequest {
  w: number;
  h: number;
  role: 'safe' | 'regular';
}

export interface SpineRequest {
  /** The room the spine leaves: the last gateway boss room. */
  entryRoom: Rect;
  /** The room the spine arrives at: the arena's antechamber. */
  exitRoom: Rect;
  rooms: { min: number; max: number };
  splits: { min: number; max: number };
  questRoom: { w: number; h: number };
  /** Null on a floor with no spider lab. */
  labRoom: { w: number; h: number } | null;
  /**
   * Dead ends to hang off chain rooms. Best-effort: a pocket that will not seat
   * is dropped rather than failing the spine, because a pocket adds exploration
   * and takes nothing away from the route if it is missing.
   */
  pockets: ReadonlyArray<SpinePocketRequest>;
  /**
   * Centres every safe pocket must keep {@link safeRoomSeparation} away from —
   * the floor's gateway safe rooms and its antechamber. A station seated a dozen
   * tiles from the one the player just left is not a mid-journey anchor.
   */
  safeRoomKeepAway: ReadonlyArray<Point>;
  safeRoomSeparation: number;
  /** First segment id the spine may claim. Each room and corridor takes one. */
  segmentBase: number;
  pickCorridorKind: (isSpecial: boolean, target: Point) => CorridorKind;
}

// ── Route growth ──────────────────────────────────────────────────────────────

/** Uniform angle in [-spread, spread]. */
function angleJitter(spread: number): number {
  return (Math.random() * 2 - 1) * spread;
}

/** Signed angle difference, wrapped into (-π, π]. */
function wrapAngle(radians: number): number {
  return radians - FULL_TURN_RADIANS * Math.round(radians / FULL_TURN_RADIANS);
}

/**
 * How far the next room's heading may deviate from the straight line to the far
 * endpoint, given how many rooms are left and how far there is still to go.
 *
 * This is the whole shape of the route in one number. Early on there are far
 * more rooms left than the remaining distance needs, so the chain is free to
 * wander almost sideways and the walk winds; as the budget is spent the slack
 * closes and the deviation is squeezed to nothing, so the last rooms march
 * straight at the antechamber and the chain always arrives where it was told to.
 *
 * Grown greedily rather than sampled off an analytic curve, and that is the
 * point: a wave laid between two fixed points goes where the equation says,
 * which on this floor is repeatedly through the gauntlet, through the arena's
 * reserve, or off the map. A route that picks its next step can be told to try
 * another direction when the ground it wanted is taken.
 */
function allowedDeviation(roomsLeft: number, distanceLeft: number): number {
  const roomsNeeded = Math.max(0, (distanceLeft - SPINE_END_CLEARANCE) / SPINE_ROOM_PITCH);
  const slack = roomsLeft - roomsNeeded;
  const freedom = Math.min(Math.max(slack / SLACK_FOR_FULL_WANDER, 0), 1);
  return MAX_DEVIATION_RADIANS * freedom;
}

// ── Seating ───────────────────────────────────────────────────────────────────

function seatRoom(
  segments: SegmentMap,
  segment: number,
  waypoint: Point,
  w: number,
  h: number,
  accept?: (centre: Point) => boolean,
): Rect | null {
  for (let attempt = 0; attempt < MAX_SEAT_ATTEMPTS; attempt++) {
    const spread = attempt * SEAT_JITTER_STEP;
    const rect = rectCentredOn(
      { x: waypoint.x + randomInt(-spread, spread), y: waypoint.y + randomInt(-spread, spread) },
      w,
      h,
    );
    if (accept !== undefined && !accept(rectCentre(rect))) continue;
    if (segments.canPlaceRoom(rect, segment)) {
      segments.addRoom(rect, segment);
      return rect;
    }
  }
  return null;
}

/** The unit direction along the chain at a chain index, from its neighbours. */
function chainHeadingAt(centres: ReadonlyArray<Point>, index: number): Point {
  const before = centres[Math.max(index - 1, 0)];
  const after = centres[Math.min(index + 1, centres.length - 1)];
  const dx = after.x - before.x;
  const dy = after.y - before.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { x: 1, y: 0 };
  return { x: dx / length, y: dy / length };
}

/**
 * Seats a room to one side of a point, trying both sides in a random order.
 *
 * Every optional structure on the spine — lanes, pockets, the lab — hangs off
 * the chain this way, so which side of the corridor it lands on is a coin flip
 * rather than always the same flank.
 */
function seatBesideChain(
  segments: SegmentMap,
  segment: number,
  anchor: Point,
  heading: Point,
  offset: number,
  w: number,
  h: number,
  accept?: (centre: Point) => boolean,
): Rect | null {
  const signs = Math.random() < EVEN_CHANCE ? SIDE_SIGNS : [SIDE_SIGNS[1], SIDE_SIGNS[0]];
  for (const sign of signs) {
    const waypoint = {
      x: Math.round(anchor.x - heading.y * offset * sign),
      y: Math.round(anchor.y + heading.x * offset * sign),
    };
    const rect = seatRoom(segments, segment, waypoint, w, h, accept);
    if (rect !== null) return rect;
  }
  return null;
}

// ── Planning ──────────────────────────────────────────────────────────────────

/**
 * Plans one spine, claiming tile ownership as it goes. Returns null when the
 * geometry could not be seated; the caller rolls the `SegmentMap` back and tries
 * again with fresh randomness.
 */
export function planSpine(segments: SegmentMap, request: SpineRequest): SpinePlan | null {
  let nextSegment = request.segmentBase;
  const claimSegment = (): number => {
    const segment = nextSegment;
    nextSegment++;
    return segment;
  };

  const from = rectCentre(request.entryRoom);
  const to = rectCentre(request.exitRoom);
  const roomCount = randomInt(request.rooms.min, request.rooms.max);

  // The quest room is never the first or the last room on the chain: a nursery
  // on the boss room's doorstep, or on the antechamber's, reads as part of that
  // landmark rather than as a room of its own. A chain too short to hold an
  // interior room is refused rather than fudged into breaking that.
  if (roomCount < MIN_CHAIN_ROOMS) return null;
  const questIndex = randomInt(1, roomCount - 2);

  // A turn that persists over several rooms is what makes the route read as a
  // winding passage rather than as a drunk walk: the chain leans one way, then
  // the other, and the lean is what a player feels as a bend.
  let heading = Math.atan2(to.y - from.y, to.x - from.x) + angleJitter(START_HEADING_JITTER);
  let turnSign = Math.random() < EVEN_CHANCE ? -1 : 1;
  let roomsUntilFlip = randomInt(ROOMS_PER_LEAN_MIN, ROOMS_PER_LEAN_MAX);
  let current = from;

  const chain: SpineChainRoom[] = [];
  for (let index = 0; index < roomCount; index++) {
    const distanceLeft = Math.hypot(to.x - current.x, to.y - current.y);
    const bearing = Math.atan2(to.y - current.y, to.x - current.x);
    const deviation = allowedDeviation(roomCount - index, distanceLeft);

    if (roomsUntilFlip <= 0) {
      turnSign = -turnSign;
      roomsUntilFlip = randomInt(ROOMS_PER_LEAN_MIN, ROOMS_PER_LEAN_MAX);
    }
    roomsUntilFlip--;
    heading +=
      turnSign * (TURN_PER_ROOM_MIN + Math.random() * (TURN_PER_ROOM_MAX - TURN_PER_ROOM_MIN));

    const isQuest = index === questIndex;
    const w = isQuest ? request.questRoom.w : randomInt(SPINE_ROOM_W_MIN, SPINE_ROOM_W_MAX);
    const h = isQuest ? request.questRoom.h : randomInt(SPINE_ROOM_H_MIN, SPINE_ROOM_H_MAX);

    let seated: Rect | null = null;
    for (const nudge of HEADING_NUDGES) {
      const candidate =
        bearing + clamp(wrapAngle(heading + nudge - bearing), -deviation, deviation);
      const step = randomInt(SPINE_ROOM_PITCH, SPINE_ROOM_PITCH + SPINE_PITCH_SLACK);
      const waypoint = {
        x: Math.round(current.x + Math.cos(candidate) * step),
        y: Math.round(current.y + Math.sin(candidate) * step),
      };
      seated = seatRoom(segments, claimSegment(), waypoint, w, h);
      if (seated !== null) {
        heading = candidate;
        break;
      }
    }
    if (seated === null) return null;
    chain.push({ rect: seated, kind: isQuest ? 'quest' : 'chain' });
    current = rectCentre(seated);
  }

  // The last room has to end up within a corridor's reach of the antechamber, or
  // the route ends in a long blind run rather than at a door.
  if (Math.hypot(to.x - current.x, to.y - current.y) > SPINE_FINAL_GAP_MAX) return null;

  const centres = chain.map((room) => rectCentre(room.rect));

  // ── Splits ──────────────────────────────────────────────────────────────
  //
  // A lane hangs between two consecutive chain rooms. Neither of them may be the
  // quest room: its onward doorways are the goblin mother's to bar while a wave
  // runs, and a fork there would put the alternate lane behind those boards as
  // well — two paths that are both shut is not two paths.
  const laneCount = randomInt(request.splits.min, request.splits.max);
  const forkCandidates: number[] = [];
  for (let index = 0; index + 1 < roomCount; index++) {
    if (index === questIndex || index + 1 === questIndex) continue;
    forkCandidates.push(index);
  }
  const lanes: SpineLane[] = [];
  const usedForks: number[] = [];
  for (const forkIndex of shuffled(forkCandidates)) {
    if (lanes.length >= laneCount) break;
    // Non-adjacent, so two lanes never share a room and the "at most two paths"
    // rule holds between every consecutive pair rather than only most of them.
    if (usedForks.some((used) => Math.abs(used - forkIndex) <= 1)) continue;
    const laneRooms = seatLane(segments, claimSegment, centres, forkIndex);
    if (laneRooms === null) continue;
    lanes.push({ forkIndex, rooms: laneRooms });
    usedForks.push(forkIndex);
  }
  if (lanes.length < request.splits.min) return null;

  // ── Spider lab ──────────────────────────────────────────────────────────
  let labRoom: Rect | null = null;
  let labHostIndex = 0;
  if (request.labRoom !== null) {
    const labHosts = shuffled(
      chain
        .map((_, index) => index)
        .filter(
          (index) => index !== questIndex && index < Math.floor(roomCount * LAB_CHAIN_FRACTION),
        ),
    );
    for (const hostIndex of labHosts) {
      // Two offsets per host, because the lab is 40×32 and the difference between
      // fitting and not is often a handful of tiles further out.
      for (let attempt = 0; attempt < LAB_OFFSETS_PER_HOST && labRoom === null; attempt++) {
        labRoom = seatBesideChain(
          segments,
          claimSegment(),
          centres[hostIndex],
          chainHeadingAt(centres, hostIndex),
          randomInt(LAB_OFFSET_MIN, LAB_OFFSET_MAX),
          request.labRoom.w,
          request.labRoom.h,
        );
      }
      if (labRoom !== null) {
        labHostIndex = hostIndex;
        break;
      }
    }
    if (labRoom === null) return null;
  }

  // ── Corridors ───────────────────────────────────────────────────────────
  //
  // Planned only once every room is seated: a corridor may not come within a
  // tile of any room but its own two endpoints, so threading them last is what
  // lets the rooms take the positions the curve asked for.
  const corridors: PlannedCorridor[] = [];
  const link = (fromRect: Rect, toRect: Rect, isSpecial: boolean): boolean => {
    const segment = claimSegment();
    const corridor = planSpineCorridor(
      segments,
      segment,
      fromRect,
      toRect,
      request.pickCorridorKind(isSpecial, rectCentre(toRect)),
    );
    if (corridor === null) return false;
    segments.claimCorridor(corridor.tiles, segment);
    corridors.push(corridor);
    return true;
  };

  // The quest room is never chain[0] — it is drawn from the chain's interior —
  // so the corridor that reaches it is always one of the chain's own links.
  let questEntryCorridor: PlannedCorridor | null = null;
  if (!link(request.entryRoom, chain[0].rect, true)) return null;
  for (let index = 0; index + 1 < roomCount; index++) {
    const joinsQuestRoom = chain[index].kind === 'quest' || chain[index + 1].kind === 'quest';
    if (!link(chain[index].rect, chain[index + 1].rect, joinsQuestRoom)) return null;
    if (chain[index + 1].kind === 'quest') questEntryCorridor = corridors[corridors.length - 1];
  }
  if (!link(chain[roomCount - 1].rect, request.exitRoom, true)) return null;

  for (const lane of lanes) {
    const run = [chain[lane.forkIndex].rect, ...lane.rooms, chain[lane.forkIndex + 1].rect];
    for (let index = 0; index + 1 < run.length; index++) {
      if (!link(run[index], run[index + 1], false)) return null;
    }
  }

  if (labRoom !== null) {
    // The host the lab was seated beside, never merely the nearest chain centre:
    // the quest room is excluded from hosting on purpose — its onward doorways
    // go behind boards for the length of a wave — and a corridor drawn to
    // whichever room happened to be closest could strand the lab behind them for
    // a party that accepted the nursery on the way past.
    if (!link(chain[labHostIndex].rect, labRoom, true)) return null;
  }

  // ── Dead-end pockets ────────────────────────────────────────────────────
  //
  // A dead end is not a route to the antechamber, so these buy exploration back
  // without buying a second way through. Seated last, *after* the route's own
  // corridors are threaded, and each one seated and linked inside a snapshot: a
  // pocket is optional, and one that seats but cannot be reached has to give its
  // ground back rather than leaving an invisible claimed blob — plus its
  // clearance halo — in the way of everything still to be placed.
  const pockets: SpinePocket[] = [];
  const usedHosts = new Set<number>([questIndex]);
  const chainMiddle = Math.floor(roomCount / 2);
  const spreadHosts = shuffled(chain.map((_, index) => index));
  for (const pocket of request.pockets) {
    // A safe room takes the middle of the chain, and takes it on the near side
    // of the nursery where it can. The nursery is a real fight in the middle of
    // a one-way journey, and a station the player passes *before* it is what
    // makes losing it a cheap retry rather than a walk back to the boss room.
    const byPreference =
      pocket.role === 'safe'
        ? [...spreadHosts].sort((a, b) => {
            const sideA = a < questIndex ? 0 : 1;
            const sideB = b < questIndex ? 0 : 1;
            if (sideA !== sideB) return sideA - sideB;
            return Math.abs(a - chainMiddle) - Math.abs(b - chainMiddle);
          })
        : spreadHosts;
    const isStation = pocket.role === 'safe';
    // The station gets several hosts before the spine is given up on; a treasure
    // pocket gets one and is dropped, because it is decoration and the station
    // is not. A one-way journey of a dozen rooms with a real fight in the middle
    // needs its mid-journey respawn anchor.
    const hostBudget = isStation ? STATION_HOST_ATTEMPTS : 1;
    const candidates = byPreference.filter((index) => !usedHosts.has(index));
    if (candidates.length === 0) {
      if (isStation) return null;
      break;
    }

    let placed = false;
    for (const hostIndex of candidates.slice(0, hostBudget)) {
      // Spent whether or not the room seats. A chain room with no ground beside
      // it is no better a host for the next pocket than it was for this one, and
      // leaving it in the pool means one cramped room swallows every request.
      usedHosts.add(hostIndex);
      const snapshot = segments.snapshot();
      const corridorCount = corridors.length;
      const seated = seatBesideChain(
        segments,
        claimSegment(),
        centres[hostIndex],
        chainHeadingAt(centres, hostIndex),
        randomInt(POCKET_OFFSET_MIN, POCKET_OFFSET_MAX),
        pocket.w,
        pocket.h,
        isStation
          ? (centre) =>
              request.safeRoomKeepAway.every(
                (other) =>
                  Math.hypot(centre.x - other.x, centre.y - other.y) >= request.safeRoomSeparation,
              )
          : undefined,
      );
      if (seated !== null && link(chain[hostIndex].rect, seated, isStation)) {
        pockets.push({ rect: seated, role: pocket.role });
        placed = true;
        break;
      }
      segments.rollback(snapshot);
      corridors.length = corridorCount;
    }
    if (!placed && isStation) return null;
  }

  return { chain, questEntryCorridor, lanes, labRoom, pockets, corridors };
}

/** Seats a lane's one or two rooms alongside the chain link it bridges. */
function seatLane(
  segments: SegmentMap,
  claimSegment: () => number,
  centres: ReadonlyArray<Point>,
  forkIndex: number,
): Rect[] | null {
  const forkCentre = centres[forkIndex];
  const joinCentre = centres[forkIndex + 1];
  const heading = {
    x: joinCentre.x - forkCentre.x,
    y: joinCentre.y - forkCentre.y,
  };
  if (heading.x === 0 && heading.y === 0) return null;
  const unit = normalize(heading.x, heading.y);
  const roomCount = randomInt(1, SPLIT_LANE_MAX_ROOMS);
  const offset = randomInt(LANE_OFFSET_MIN, LANE_OFFSET_MAX);
  const sign = Math.random() < EVEN_CHANCE ? -1 : 1;

  // A two-room lane that seats its first room and fails on its second would
  // otherwise leave the first claimed for the rest of the plan — an invisible
  // blob of ground, plus its clearance halo, in the way of the lab, the pockets
  // and every corridor still to be threaded.
  const snapshot = segments.snapshot();
  const rooms: Rect[] = [];
  for (let index = 0; index < roomCount; index++) {
    // Spread evenly along the link so a two-room lane reads as a loop around it
    // rather than as two rooms stacked on one flank.
    const along = (index + 1) / (roomCount + 1);
    const anchor = {
      x: forkCentre.x + heading.x * along - unit.y * offset * sign,
      y: forkCentre.y + heading.y * along + unit.x * offset * sign,
    };
    const rect = seatRoom(
      segments,
      claimSegment(),
      { x: Math.round(anchor.x), y: Math.round(anchor.y) },
      randomInt(SPINE_ROOM_W_MIN, SPINE_ROOM_W_MAX),
      randomInt(SPINE_ROOM_H_MIN, SPINE_ROOM_H_MAX),
    );
    if (rect === null) {
      segments.rollback(snapshot);
      return null;
    }
    rooms.push(rect);
  }
  return rooms;
}

/**
 * A corridor between two spine rooms, as a plain L where one fits and as a
 * dog-leg through an offset pivot where it does not.
 *
 * The straight L is all a gauntlet branch ever needs, because its rooms are
 * strung along one sweeping curve with open ground either side. A spine winds
 * back on itself between an arena and a gauntlet that have already taken the
 * ground, so the corner of an L lands on a neighbouring room often enough to
 * cost most of the layouts that would otherwise have worked — and a route that
 * simply steps around it is the difference.
 */
function planSpineCorridor(
  segments: SegmentMap,
  segment: number,
  fromRect: Rect,
  toRect: Rect,
  kind: CorridorKind,
): PlannedCorridor | null {
  const direct = planCorridorBetween(segments, segment, fromRect, toRect, kind);
  if (direct !== null) return direct;

  const from = rectCentre(fromRect);
  const to = rectCentre(toRect);
  const spanX = to.x - from.x;
  const spanY = to.y - from.y;
  const span = Math.hypot(spanX, spanY);
  if (span === 0) return null;
  const perpX = -spanY / span;
  const perpY = spanX / span;
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;

  for (const offset of CORRIDOR_PIVOT_OFFSETS) {
    for (const sign of SIDE_SIGNS) {
      const pivot = {
        x: Math.round(midX + perpX * offset * sign),
        y: Math.round(midY + perpY * offset * sign),
      };
      if (!segments.isInsideUsableArea(pivot.x, pivot.y)) continue;
      for (const firstLegHorizontal of CORRIDOR_LEG_ORDERS) {
        for (const secondLegHorizontal of CORRIDOR_LEG_ORDERS) {
          const tiles = [
            ...segments.corridorTiles(from, pivot, kind, firstLegHorizontal),
            ...segments.corridorTiles(pivot, to, kind, secondLegHorizontal),
          ];
          if (!segments.canCarveCorridor(tiles, segment, [fromRect, toRect])) continue;
          return { tiles, kind, target: to };
        }
      }
    }
  }
  return null;
}

function shuffled(values: ReadonlyArray<number>): number[] {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index--) {
    const swap = randomInt(0, index);
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}
