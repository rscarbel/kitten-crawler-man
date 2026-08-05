import { randomInt, clamp } from '../utils';

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

/** Corridor shapes the layout can plan. Mirrors the generator's hallway kinds. */
export type CorridorKind = 'narrow' | 'standard' | 'nook';

// ── Segments ──────────────────────────────────────────────────────────────────

/** Tile belongs to nothing yet. */
const SEGMENT_NONE = 0;
/** Tile belongs to the free-roam region past the last gateway boss room. */
export const SEGMENT_FREE = -1;
/** Tile belongs to the arena structure and the antechamber guarding its door. */
export const SEGMENT_ARENA = -2;

/**
 * A gauntlet owns two segments: one for the branches and the gateway safe room
 * they converge on, and a sealed one for the boss room and the short corridor
 * leading into it.
 *
 * Splitting them is what makes the gateway safe room unavoidable. Same-segment
 * tiles are allowed to touch — branches are meant to braid together — so if the
 * safe-room-to-boss-room corridor shared a segment with the branches, a chain
 * room could be seated flush against it, or a branch corridor could cross it,
 * and the player would step onto the boss's doorstep without ever entering the
 * safe room.
 */
const SEGMENTS_PER_GAUNTLET = 2;

/** Segment owning gauntlet `index`'s branch chains and its gateway safe room. */
export function gauntletSegment(index: number): number {
  return index * SEGMENTS_PER_GAUNTLET + 1;
}

/** Segment owning gauntlet `index`'s boss room and the sealed corridor into it. */
function gatewaySegment(index: number): number {
  return index * SEGMENTS_PER_GAUNTLET + 2;
}

// ── Geometry constants ────────────────────────────────────────────────────────

/**
 * Tightest centre-to-centre spacing between consecutive chain rooms, which caps
 * how many rooms a branch of a given length can hold. Set by the room sizes
 * themselves: two of the widest chain rooms plus `ROOM_GAP` need about this much
 * between their centres.
 */
const MIN_ROOM_PITCH = 16;
/**
 * Curve length reserved at each end of a branch before the first chain room and
 * after the last, so a chain room never crowds the entry room or the gateway
 * safe room it converges on.
 */
const BRANCH_END_CLEARANCE = 20;

const CHAIN_ROOM_W_MIN = 8;
const CHAIN_ROOM_W_MAX = 14;
const CHAIN_ROOM_H_MIN = 7;
const CHAIN_ROOM_H_MAX = 12;

export const START_ROOM_W_MIN = 12;
export const START_ROOM_W_MAX = 16;
export const START_ROOM_H_MIN = 10;
export const START_ROOM_H_MAX = 14;

/** Largest perpendicular nudge applied to a branch waypoint before placement. */
const WAYPOINT_JITTER = 6;

/**
 * Bézier control-point distance for a branch, drawn per branch.
 *
 * The pull is what makes one branch a short walk and another a long sweep around
 * the flank: it sets how far the curve bows away from the straight line to the
 * gateway, and the curve's length is what decides how many rooms fit. Drawing it
 * per branch rather than fixing it per gauntlet is what puts the upper half of a
 * configured `branchRooms` range within reach.
 */
const BRANCH_EXIT_PULL_MIN = 60;
const BRANCH_EXIT_PULL_MAX = 170;
/** Same, for gauntlets leaving a boss room rather than the start room. */
const BRANCH_EXIT_PULL_LATER_MIN = 110;
const BRANCH_EXIT_PULL_LATER_MAX = 280;

/**
 * Start-centre (or previous boss room) to gateway safe room distance.
 *
 * Chosen by map size and gauntlet index rather than by floor number: a compact
 * floor has to fit its whole gauntlet plus a free region in far less space, and
 * the second gauntlet on a large floor wants a longer, branchier stretch than
 * the first.
 */
const GATEWAY_SAFE_DIST_COMPACT = { min: 50, max: 70 } as const;
const GATEWAY_SAFE_DIST_FIRST = { min: 70, max: 90 } as const;
const GATEWAY_SAFE_DIST_LATER = { min: 90, max: 130 } as const;
/** Maps at or below this side length use the compact gateway distances. */
const COMPACT_MAP_MAX_SIZE = 320;

/** How far the heading turns off the previous gauntlet's, in degrees. */
const GAUNTLET_FLANK_TURN_MIN_DEG = 60;
const GAUNTLET_FLANK_TURN_MAX_DEG = 120;

/** Gateway safe room centre to boss room centre distance. */
const BOSS_ROOM_OFFSET_MIN = 26;
const BOSS_ROOM_OFFSET_MAX = 34;

/** Chebyshev clearance any tile must keep from tiles owned by another segment. */
const FOREIGN_SEGMENT_CLEARANCE = 2;

/** Gap kept between room rectangles, matching the free-roam placement rule. */
const ROOM_GAP = 3;

const MAX_BRANCH_ATTEMPTS = 8;
export const MAX_GAUNTLET_ATTEMPTS = 30;
export const MAX_MAP_ATTEMPTS = 40;

/** Widening jitter applied on each successive attempt to seat a chain room. */
const CHAIN_ROOM_JITTER_STEP = 2;

/** Samples used to approximate a branch curve's arc length. */
const ARC_LENGTH_SAMPLES = 32;

/** Half-spread of a later gauntlet's branch fan around its heading, in degrees. */
const BRANCH_FAN_HALF_SPREAD_DEG = 70;
/** Per-branch angular jitter within a later gauntlet's fan, in degrees. */
const BRANCH_FAN_JITTER_DEG = 10;
/** Fraction of the even spacing used as jitter when branching all the way round. */
const RADIAL_BRANCH_JITTER_FRACTION = 0.25;

const DEGREES_PER_HALF_TURN = 180;
const DEGREES_TO_RADIANS = Math.PI / DEGREES_PER_HALF_TURN;
const FULL_TURN_RADIANS = Math.PI * 2;

/** Half-width of the 5×5 alcove a `nook` corridor carves at its bend. */
const NOOK_HALF_SIZE = 2;

/** Probability of either outcome in a fair coin flip. */
const EVEN_CHANCE = 0.5;

// ── Small geometry helpers ────────────────────────────────────────────────────

function polar(angleRadians: number, distance: number): Point {
  return { x: Math.cos(angleRadians) * distance, y: Math.sin(angleRadians) * distance };
}

function randomSign(): number {
  return Math.random() < EVEN_CHANCE ? -1 : 1;
}

/** Uniform angle in [-spreadRadians, spreadRadians]. */
function angleJitter(spreadRadians: number): number {
  return (Math.random() * 2 - 1) * spreadRadians;
}

function quadraticBezier(p0: Point, p1: Point, p2: Point, t: number): Point {
  const inverse = 1 - t;
  const a = inverse * inverse;
  const b = 2 * inverse * t;
  const c = t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x, y: a * p0.y + b * p1.y + c * p2.y };
}

/**
 * Cumulative arc length at each of `ARC_LENGTH_SAMPLES` evenly-spaced parameter
 * values, so a point can be found by *distance along the curve* rather than by
 * parameter.
 *
 * The two are far apart on a curve with a strong control-point pull, and the
 * chain rooms have to be evenly spaced on the ground, not in parameter space.
 */
function bezierArcTable(p0: Point, p1: Point, p2: Point): number[] {
  const table = [0];
  let length = 0;
  let previous = p0;
  for (let step = 1; step <= ARC_LENGTH_SAMPLES; step++) {
    const point = quadraticBezier(p0, p1, p2, step / ARC_LENGTH_SAMPLES);
    length += Math.hypot(point.x - previous.x, point.y - previous.y);
    table.push(length);
    previous = point;
  }
  return table;
}

/** The curve parameter at a given distance along the curve. */
function parameterAtArcLength(table: ReadonlyArray<number>, distance: number): number {
  const total = table[table.length - 1];
  if (total <= 0) return 0;
  const target = clamp(distance, 0, total);
  for (let i = 1; i < table.length; i++) {
    if (table[i] < target) continue;
    const spanStart = table[i - 1];
    const spanLength = table[i] - spanStart;
    const withinSpan = spanLength > 0 ? (target - spanStart) / spanLength : 0;
    return (i - 1 + withinSpan) / ARC_LENGTH_SAMPLES;
  }
  return 1;
}

function rectContains(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x && point.x < rect.x + rect.w && point.y >= rect.y && point.y < rect.y + rect.h
  );
}

export function rectCentre(rect: Rect): Point {
  return { x: Math.floor(rect.x + rect.w / 2), y: Math.floor(rect.y + rect.h / 2) };
}

export function rectCentredOn(centre: Point, w: number, h: number): Rect {
  return { x: Math.round(centre.x - w / 2), y: Math.round(centre.y - h / 2), w, h };
}

function gatewayDistanceRange(
  mapSize: number,
  gauntletIndex: number,
): { min: number; max: number } {
  if (mapSize <= COMPACT_MAP_MAX_SIZE) return GATEWAY_SAFE_DIST_COMPACT;
  return gauntletIndex === 0 ? GATEWAY_SAFE_DIST_FIRST : GATEWAY_SAFE_DIST_LATER;
}

// ── Tile ownership map ────────────────────────────────────────────────────────

interface RoomPlacement {
  rect: Rect;
  segment: number;
}

interface SegmentSnapshot {
  ownershipWrites: number;
  roomCount: number;
}

/**
 * Tile-level ownership of everything carved so far, and the placement rules that
 * keep one segment from accidentally opening a shortcut into another.
 *
 * Kept separate from the tile grid because the generator builds a whole
 * `GauntletPlan` before stamping any of it: ownership is claimed as the
 * `GauntletPlan` is built and rolled back wholesale when it fails, so no
 * carved tile ever has to be undone.
 */
export class SegmentMap {
  private readonly segmentOf: Int16Array;
  /** Room index + 1 for every tile inside a placed room, 0 elsewhere. */
  private readonly roomIdAt: Int32Array;
  private readonly ownershipUndo: Array<{ index: number; segment: number; roomId: number }> = [];
  readonly rooms: RoomPlacement[] = [];

  constructor(
    private readonly size: number,
    private readonly border: number,
  ) {
    this.segmentOf = new Int16Array(size * size);
    this.roomIdAt = new Int32Array(size * size);
  }

  private indexOf(x: number, y: number): number {
    return y * this.size + x;
  }

  segmentAt(x: number, y: number): number {
    if (!this.isInsideUsableArea(x, y)) return SEGMENT_NONE;
    return this.segmentOf[this.indexOf(x, y)];
  }

  isInsideUsableArea(x: number, y: number): boolean {
    return (
      x >= this.border &&
      x < this.size - this.border &&
      y >= this.border &&
      y < this.size - this.border
    );
  }

  /** True when a room rectangle fits entirely inside the carvable area. */
  fitsInMap(rect: Rect): boolean {
    return (
      rect.x >= this.border + 1 &&
      rect.y >= this.border + 1 &&
      rect.x + rect.w <= this.size - this.border - 2 &&
      rect.y + rect.h <= this.size - this.border - 2
    );
  }

  private claim(x: number, y: number, segment: number, roomId: number): void {
    const index = this.indexOf(x, y);
    this.ownershipUndo.push({
      index,
      segment: this.segmentOf[index],
      roomId: this.roomIdAt[index],
    });
    this.segmentOf[index] = segment;
    if (roomId !== 0) this.roomIdAt[index] = roomId;
  }

  snapshot(): SegmentSnapshot {
    return { ownershipWrites: this.ownershipUndo.length, roomCount: this.rooms.length };
  }

  rollback(snapshot: SegmentSnapshot): void {
    while (this.ownershipUndo.length > snapshot.ownershipWrites) {
      const entry = this.ownershipUndo[this.ownershipUndo.length - 1];
      this.ownershipUndo.pop();
      this.segmentOf[entry.index] = entry.segment;
      this.roomIdAt[entry.index] = entry.roomId;
    }
    this.rooms.length = snapshot.roomCount;
  }

  /**
   * Whether a room may be seated here: inside the map, on virgin tiles, clear of
   * every other room by `ROOM_GAP`, and clear of foreign-segment tiles by
   * `FOREIGN_SEGMENT_CLEARANCE`.
   */
  canPlaceRoom(rect: Rect, segment: number): boolean {
    if (!this.fitsInMap(rect)) return false;

    for (const other of this.rooms) {
      const r = other.rect;
      if (
        rect.x < r.x + r.w + ROOM_GAP &&
        rect.x + rect.w + ROOM_GAP > r.x &&
        rect.y < r.y + r.h + ROOM_GAP &&
        rect.y + rect.h + ROOM_GAP > r.y
      ) {
        return false;
      }
    }

    const clearance = FOREIGN_SEGMENT_CLEARANCE - 1;
    for (let y = rect.y - clearance; y < rect.y + rect.h + clearance; y++) {
      for (let x = rect.x - clearance; x < rect.x + rect.w + clearance; x++) {
        if (!this.isInsideUsableArea(x, y)) return false;
        const owner = this.segmentOf[this.indexOf(x, y)];
        if (owner === SEGMENT_NONE) continue;
        const insideRect = rectContains(rect, { x, y });
        if (insideRect) return false;
        if (owner !== segment) return false;
      }
    }
    return true;
  }

  addRoom(rect: Rect, segment: number): void {
    this.rooms.push({ rect, segment });
    const roomId = this.rooms.length;
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        this.claim(x, y, segment, roomId);
      }
    }
  }

  /**
   * Whether a corridor may run along these tiles.
   *
   * The single rule that prevents every bypass: a corridor may only overlap
   * virgin tiles, its two endpoint rooms, and corridor tiles of its own segment,
   * and must stay `FOREIGN_SEGMENT_CLEARANCE` away from any other room and from
   * any tile owned by a different segment.
   */
  canCarveCorridor(
    tiles: ReadonlyArray<Point>,
    segment: number,
    endpoints: ReadonlyArray<Rect>,
  ): boolean {
    const endpointIds = endpoints.map((rect) => {
      const centre = rectCentre(rect);
      return this.roomIdAt[this.indexOf(centre.x, centre.y)];
    });
    const clearance = FOREIGN_SEGMENT_CLEARANCE - 1;

    for (const tile of tiles) {
      if (!this.isInsideUsableArea(tile.x, tile.y)) return false;
      if (endpoints.some((rect) => rectContains(rect, tile))) continue;

      const owner = this.segmentOf[this.indexOf(tile.x, tile.y)];
      if (owner !== SEGMENT_NONE && owner !== segment) return false;

      for (let dy = -clearance; dy <= clearance; dy++) {
        for (let dx = -clearance; dx <= clearance; dx++) {
          const nx = tile.x + dx;
          const ny = tile.y + dy;
          if (!this.isInsideUsableArea(nx, ny)) return false;
          const index = this.indexOf(nx, ny);
          const roomId = this.roomIdAt[index];
          if (roomId !== 0) {
            // An endpoint room's own tiles are legal neighbours whatever segment
            // they belong to — that is exactly how a corridor reaches its door.
            if (!endpointIds.includes(roomId)) return false;
            continue;
          }
          const neighbourSegment = this.segmentOf[index];
          if (neighbourSegment !== SEGMENT_NONE && neighbourSegment !== segment) return false;
        }
      }
    }
    return true;
  }

  claimCorridor(tiles: ReadonlyArray<Point>, segment: number): void {
    for (const tile of tiles) {
      if (!this.isInsideUsableArea(tile.x, tile.y)) continue;
      if (this.roomIdAt[this.indexOf(tile.x, tile.y)] !== 0) continue;
      this.claim(tile.x, tile.y, segment, 0);
    }
  }

  /** Tiles an L-shaped corridor of this kind would carve between two centres. */
  corridorTiles(from: Point, to: Point, kind: CorridorKind, horizontalFirst: boolean): Point[] {
    const halfWidth = kind === 'standard' ? 1 : 0;
    const tiles: Point[] = [];
    const seen = new Set<number>();
    const push = (x: number, y: number): void => {
      if (!this.isInsideUsableArea(x, y)) return;
      const index = this.indexOf(x, y);
      if (seen.has(index)) return;
      seen.add(index);
      tiles.push({ x, y });
    };

    const firstLegAxisValue = horizontalFirst ? from.y : from.x;
    const secondLegAxisValue = horizontalFirst ? to.x : to.y;

    const spanStart = horizontalFirst ? Math.min(from.x, to.x) : Math.min(from.y, to.y);
    const spanEnd = horizontalFirst ? Math.max(from.x, to.x) : Math.max(from.y, to.y);
    for (let along = spanStart; along <= spanEnd; along++) {
      for (let off = -halfWidth; off <= halfWidth; off++) {
        if (horizontalFirst) push(along, firstLegAxisValue + off);
        else push(firstLegAxisValue + off, along);
      }
    }

    const legStart = horizontalFirst ? Math.min(from.y, to.y) : Math.min(from.x, to.x);
    const legEnd = horizontalFirst ? Math.max(from.y, to.y) : Math.max(from.x, to.x);
    for (let along = legStart; along <= legEnd; along++) {
      for (let off = -halfWidth; off <= halfWidth; off++) {
        if (horizontalFirst) push(secondLegAxisValue + off, along);
        else push(along, secondLegAxisValue + off);
      }
    }

    if (kind === 'nook') {
      const bendX = horizontalFirst ? to.x : from.x;
      const bendY = horizontalFirst ? from.y : to.y;
      for (let dy = -NOOK_HALF_SIZE; dy <= NOOK_HALF_SIZE; dy++) {
        for (let dx = -NOOK_HALF_SIZE; dx <= NOOK_HALF_SIZE; dx++) {
          push(bendX + dx, bendY + dy);
        }
      }
    }
    return tiles;
  }
}

// ── Gauntlet planning ─────────────────────────────────────────────────────────

interface GauntletRoomSizes {
  safeRoomW: number;
  safeRoomH: number;
  bossRoomW: number;
  bossRoomH: number;
}

export interface GauntletRequest {
  index: number;
  mapSize: number;
  entryRoom: Rect;
  /** Heading of the previous gauntlet, or null for the first. */
  previousHeading: number | null;
  /**
   * Exactly how many branches to build.
   *
   * A concrete count rather than the configured range, because the caller retries
   * a failed gauntlet: redrawing the count on every retry biases the result hard
   * toward the smallest one, since fewer branches are likelier to fit. The caller
   * keeps its drawn count across retries and only steps it down once the geometry
   * has genuinely proved impossible.
   */
  branchCount: number;
  branchRooms: { min: number; max: number };
  sizes: GauntletRoomSizes;
  pickCorridorKind: (isSpecial: boolean, target: Point) => CorridorKind;
}

export interface PlannedCorridor {
  tiles: Point[];
  kind: CorridorKind;
  /** Centre of the room the corridor arrives at — drives the corridor's floor. */
  target: Point;
}

export interface GauntletPlan {
  heading: number;
  safeRoom: Rect;
  bossRoom: Rect;
  chainRooms: Rect[];
  corridors: PlannedCorridor[];
  branchRoomCounts: number[];
}

function nextHeading(previousHeading: number | null): number {
  if (previousHeading === null) return Math.random() * FULL_TURN_RADIANS;
  const turnDegrees = randomInt(GAUNTLET_FLANK_TURN_MIN_DEG, GAUNTLET_FLANK_TURN_MAX_DEG);
  return previousHeading + randomSign() * turnDegrees * DEGREES_TO_RADIANS;
}

function branchExitAngles(
  request: GauntletRequest,
  heading: number,
  branchCount: number,
): number[] {
  const angles: number[] = [];
  if (request.index === 0) {
    // Leaving the start room, the player should be able to set off in any
    // direction, so the branches ring the room rather than fanning one way.
    const rotation = Math.random() * FULL_TURN_RADIANS;
    const spacing = FULL_TURN_RADIANS / branchCount;
    for (let i = 0; i < branchCount; i++) {
      angles.push(rotation + i * spacing + angleJitter(spacing * RADIAL_BRANCH_JITTER_FRACTION));
    }
    return angles;
  }

  const halfSpread = BRANCH_FAN_HALF_SPREAD_DEG * DEGREES_TO_RADIANS;
  const jitter = BRANCH_FAN_JITTER_DEG * DEGREES_TO_RADIANS;
  if (branchCount === 1) return [heading + angleJitter(jitter)];
  const step = (halfSpread * 2) / (branchCount - 1);
  for (let i = 0; i < branchCount; i++) {
    angles.push(heading - halfSpread + i * step + angleJitter(jitter));
  }
  return angles;
}

function branchWaypoints(
  entryCentre: Point,
  gatewayCentre: Point,
  exitAngle: number,
  pull: number,
  roomRange: { min: number; max: number },
): Point[] {
  const control = {
    x: entryCentre.x + polar(exitAngle, pull).x,
    y: entryCentre.y + polar(exitAngle, pull).y,
  };
  const arcTable = bezierArcTable(entryCentre, control, gatewayCentre);
  const curveLength = arcTable[arcTable.length - 1];

  // Chain rooms start and stop clear of the rooms at either end of the branch.
  // Without this a branch aimed straight at the gateway lands its last room on
  // top of it — which is why a four-branch start, where one branch always points
  // roughly at the gateway, used to be unbuildable.
  const usableLength = Math.max(0, curveLength - BRANCH_END_CLEARANCE * 2);

  // The room count is drawn from the configured range rather than derived from
  // the curve, so two runs of the same floor genuinely differ; the spacing then
  // follows from it. Deriving the count instead pinned every branch to the
  // bottom of its range, because the curve is never long enough to reach the top.
  // The draw is capped by what the curve can actually hold at `MIN_ROOM_PITCH`.
  const roomsThatFit = Math.max(roomRange.min, Math.floor(usableLength / MIN_ROOM_PITCH) + 1);
  const roomCount = randomInt(roomRange.min, Math.min(roomRange.max, roomsThatFit));
  const spacing = roomCount > 1 ? usableLength / (roomCount - 1) : 0;

  const waypoints: Point[] = [];
  for (let i = 0; i < roomCount; i++) {
    const distance =
      roomCount > 1 ? BRANCH_END_CLEARANCE + spacing * i : BRANCH_END_CLEARANCE + usableLength / 2;
    const point = quadraticBezier(
      entryCentre,
      control,
      gatewayCentre,
      parameterAtArcLength(arcTable, distance),
    );
    const jitterAngle = Math.random() * FULL_TURN_RADIANS;
    const jitterDistance = Math.random() * WAYPOINT_JITTER;
    const offset = polar(jitterAngle, jitterDistance);
    waypoints.push({ x: Math.round(point.x + offset.x), y: Math.round(point.y + offset.y) });
  }
  return waypoints;
}

/**
 * Plans one gauntlet — branch chains, gateway safe room, gateway boss room —
 * claiming tile ownership as it goes. Returns null when the geometry could not
 * be seated; the caller rolls the `SegmentMap` back and tries again.
 */
export function planGauntlet(segments: SegmentMap, request: GauntletRequest): GauntletPlan | null {
  const segment = gauntletSegment(request.index);
  const sealed = gatewaySegment(request.index);
  const entryCentre = rectCentre(request.entryRoom);
  const heading = nextHeading(request.previousHeading);

  const gatewayRange = gatewayDistanceRange(request.mapSize, request.index);
  const gatewayOffset = polar(heading, randomInt(gatewayRange.min, gatewayRange.max));
  const safeRoom = rectCentredOn(
    {
      x: Math.round(entryCentre.x + gatewayOffset.x),
      y: Math.round(entryCentre.y + gatewayOffset.y),
    },
    request.sizes.safeRoomW,
    request.sizes.safeRoomH,
  );
  if (!segments.canPlaceRoom(safeRoom, segment)) return null;
  segments.addRoom(safeRoom, segment);

  const safeCentre = rectCentre(safeRoom);
  const bossOffset = polar(heading, randomInt(BOSS_ROOM_OFFSET_MIN, BOSS_ROOM_OFFSET_MAX));
  const bossRoom = rectCentredOn(
    { x: Math.round(safeCentre.x + bossOffset.x), y: Math.round(safeCentre.y + bossOffset.y) },
    request.sizes.bossRoomW,
    request.sizes.bossRoomH,
  );
  if (!segments.canPlaceRoom(bossRoom, sealed)) return null;
  segments.addRoom(bossRoom, sealed);

  const bossCentre = rectCentre(bossRoom);
  const gatewayCorridor = planCorridorBetween(
    segments,
    sealed,
    safeRoom,
    bossRoom,
    request.pickCorridorKind(true, bossCentre),
  );
  if (gatewayCorridor === null) return null;
  segments.claimCorridor(gatewayCorridor.tiles, sealed);

  const exitAngles = branchExitAngles(request, heading, request.branchCount);
  const pullRange =
    request.index === 0
      ? { min: BRANCH_EXIT_PULL_MIN, max: BRANCH_EXIT_PULL_MAX }
      : { min: BRANCH_EXIT_PULL_LATER_MIN, max: BRANCH_EXIT_PULL_LATER_MAX };

  const chainRooms: Rect[] = [];
  const corridors: PlannedCorridor[] = [gatewayCorridor];
  const branchRoomCounts: number[] = [];

  for (const exitAngle of exitAngles) {
    const branch = planBranch(segments, request, {
      segment,
      entryRoom: request.entryRoom,
      entryCentre,
      gatewayRoom: safeRoom,
      gatewayCentre: safeCentre,
      exitAngle,
      pullRange,
    });
    if (branch === null) return null;
    chainRooms.push(...branch.rooms);
    corridors.push(...branch.corridors);
    branchRoomCounts.push(branch.rooms.length);
  }

  return { heading, safeRoom, bossRoom, chainRooms, corridors, branchRoomCounts };
}

interface BranchRequest {
  segment: number;
  entryRoom: Rect;
  entryCentre: Point;
  gatewayRoom: Rect;
  gatewayCentre: Point;
  exitAngle: number;
  pullRange: { min: number; max: number };
}

interface BranchPlan {
  rooms: Rect[];
  corridors: PlannedCorridor[];
}

function planBranch(
  segments: SegmentMap,
  request: GauntletRequest,
  branch: BranchRequest,
): BranchPlan | null {
  for (let attempt = 0; attempt < MAX_BRANCH_ATTEMPTS; attempt++) {
    const snapshot = segments.snapshot();
    const plan = attemptBranch(segments, request, branch);
    if (plan !== null) return plan;
    segments.rollback(snapshot);
  }
  return null;
}

function attemptBranch(
  segments: SegmentMap,
  request: GauntletRequest,
  branch: BranchRequest,
): BranchPlan | null {
  const waypoints = branchWaypoints(
    branch.entryCentre,
    branch.gatewayCentre,
    branch.exitAngle,
    randomInt(branch.pullRange.min, branch.pullRange.max),
    request.branchRooms,
  );

  const rooms: Rect[] = [];
  for (const waypoint of waypoints) {
    const room = seatChainRoom(segments, branch.segment, waypoint);
    if (room === null) return null;
    rooms.push(room);
  }

  const chain: Rect[] = [branch.entryRoom, ...rooms, branch.gatewayRoom];
  const corridors: PlannedCorridor[] = [];
  for (let i = 0; i + 1 < chain.length; i++) {
    const from = chain[i];
    const to = chain[i + 1];
    const targetCentre = rectCentre(to);
    const isSpecial = i === 0 || i + 2 === chain.length;
    const corridor = planCorridorBetween(
      segments,
      branch.segment,
      from,
      to,
      request.pickCorridorKind(isSpecial, targetCentre),
    );
    if (corridor === null) return null;
    segments.claimCorridor(corridor.tiles, branch.segment);
    corridors.push(corridor);
  }
  return { rooms, corridors };
}

function seatChainRoom(segments: SegmentMap, segment: number, waypoint: Point): Rect | null {
  for (let attempt = 0; attempt < MAX_BRANCH_ATTEMPTS; attempt++) {
    const spread = attempt * CHAIN_ROOM_JITTER_STEP;
    const centre = {
      x: waypoint.x + randomInt(-spread, spread),
      y: waypoint.y + randomInt(-spread, spread),
    };
    const rect = rectCentredOn(
      centre,
      randomInt(CHAIN_ROOM_W_MIN, CHAIN_ROOM_W_MAX),
      randomInt(CHAIN_ROOM_H_MIN, CHAIN_ROOM_H_MAX),
    );
    if (segments.canPlaceRoom(rect, segment)) {
      segments.addRoom(rect, segment);
      return rect;
    }
  }
  return null;
}

/**
 * Picks whichever L orientation the corridor rule allows, at random when both
 * do. Returns null when neither orientation is legal.
 */
export function planCorridorBetween(
  segments: SegmentMap,
  segment: number,
  from: Rect,
  to: Rect,
  kind: CorridorKind,
): PlannedCorridor | null {
  const fromCentre = rectCentre(from);
  const toCentre = rectCentre(to);
  const orientations = Math.random() < EVEN_CHANCE ? [true, false] : [false, true];
  for (const horizontalFirst of orientations) {
    const tiles = segments.corridorTiles(fromCentre, toCentre, kind, horizontalFirst);
    if (segments.canCarveCorridor(tiles, segment, [from, to])) {
      return { tiles, kind, target: toCentre };
    }
  }
  return null;
}
