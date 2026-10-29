/**
 * Where everything in the Kraken's flooded pump room goes.
 *
 * Pure and seeded: the room's bounds, its doorways and a seed decide the whole
 * room, so the runtime system, the art and the headless gate arrive at the same
 * room without talking to each other.
 *
 * The whole room is deep water. Nothing in it is dry: the party gathers on a
 * landing raft floating just inside the entrance, a pump is mounted on the
 * middle of each other wall with a small raft moored beside it to haul its
 * valve from, and a scattered field of small rafts between them gives several
 * routes from the landing to every pump, each hop a short swim straight across
 * open water. The Kraken waits on a submerged dais in the middle.
 *
 * One shark patrols a loop round whichever float the active crawler is on,
 * and takes whoever steps off it into the water at the wrong moment. Every
 * float's loop is solved here with the same swims the gate runs, through the
 * room's real water, and a layout whose loops cannot all be solved is thrown
 * away and the room is laid out again from the next seed. So a layout this
 * returns is one every shark rule holds in.
 *
 * The landing and the pumps are placed in the frame of a crawler standing in
 * the entrance looking in (`along` to their right, `depth` away from the
 * entrance wall), since the pumps' walls are named from the entrance; the
 * rafts are floated out in world tiles.
 */

import { PUMP_OUTFALL_OFFSET_TILES } from '../../sprites/art/floodedPumpRoomArt';
import type { ChuteSide } from '../../sprites/floodedPumpRoomSprite';
import { mulberry32, type Rng } from '../../sprites/person/rng';
import {
  approachLaneTiles,
  spawnClearTiles,
  type BossRoomDoorway,
  type DoorSide,
  type TilePoint,
  type TileRect,
} from './bossRoomLayout';
import {
  distanceToRect,
  gapBetweenRects,
  PUMP_WALLS,
  pumpRaftId,
  raftId,
  rectContainsTile,
  type PlatformId,
  type PumpRaftId,
  type PumpWall,
  type RaftId,
  type TileVec,
} from './floodedPumpRoom/platforms';
import {
  isRangedOnlyFromAll,
  RANGED_ONLY_TENTACLE_OFFSET_TILES,
  tentacleCentre,
} from './floodedPumpRoom/raftTentacles';
import {
  SHARK_TIMING,
  solvePlatformLoop,
  type PlatformShark,
  type SharkDeparture,
  type SharkSea,
} from './floodedPumpRoom/sharkModel';
import { WaterMap } from './floodedPumpRoom/waterMap';

// ── Sizes ────────────────────────────────────────────────────────────────────

/**
 * The smallest a raft may be on either side, in tiles: the smallest whose
 * slam footprint (a side short of the raft's own, at most two tiles) always
 * leaves a crawler somewhere to step to.
 */
export const RAFT_MIN_SIZE_TILES = 3;
/** Every float is this size, but a field raft after a long lattice step, which is a tile wider. */
const FLOAT_SIZE_TILES = RAFT_MIN_SIZE_TILES;
/** Open water kept between a field raft and any wall, so the fin can always swim round it. */
const RAFT_WALL_MARGIN_TILES = 2;
/** The share of the lattice's rafts left out, where the field stays connected without them. */
const HOLE_SHARE = 0.15;

/**
 * Rows of water left between the entrance wall and the landing raft. The
 * doorway's own row stays water so the corridor's barrels can float in and
 * bob there.
 */
const LANDING_SET_BACK_ROWS = 1;
/** How far the landing may float off the middle of the doorway to line up with the field. */
const LANDING_MAX_SHIFT_TILES = 4;

/** How far from the middle of its wall a seed may mount a pump, in lattice ranks. */
const PUMP_JITTER_TILES = 3;

/** The painted dais the Kraken waits on, in tiles from her tile. No raft floats over it. */
const DAIS_RADIUS_TILES = 2.5;

// ── Hops ─────────────────────────────────────────────────────────────────────

/** How many times a chasing shark outswims a wading crawler. */
const CHASE_TO_WADE = SHARK_TIMING.chaseTilesPerFrame / SHARK_TIMING.wadeTilesPerFrame;

/**
 * How much further a shark gains on a crawler who is whipped as they step off
 * than on one who swims straight on: it closes the whole stun, and the step
 * back, at full chase speed.
 */
const WHIP_LEAD_TILES =
  SHARK_TIMING.stunFrames * SHARK_TIMING.wadeTilesPerFrame + SHARK_TIMING.entryStepTiles;

/** Slack on the shortest hop for a chase that does not run in a straight line. */
const HOP_TIMING_MARGIN_TILES = 0.1;

/**
 * The shortest swim between two platforms.
 *
 * A shark far enough behind a raft to let a crawler swim a hop of length `h`
 * away from it is `(k - 1) h` tiles behind, where `k` is how many times faster
 * it swims than a crawler wades. A crawler whipped as they step off must be
 * able to climb back before that shark arrives, which takes `k` times the
 * stun's worth of wading plus the step. So every hop must satisfy
 * `(k - 1) h > k × lead`, and this is the shortest whole hop that does, with a
 * little slack.
 */
const HOP_MIN_TILES = Math.ceil(
  (CHASE_TO_WADE / (CHASE_TO_WADE - 1)) * WHIP_LEAD_TILES + HOP_TIMING_MARGIN_TILES,
);
/** How much longer than the shortest a hop may be. */
const HOP_LENGTH_SPREAD_TILES = 2;
const HOP_MAX_TILES = HOP_MIN_TILES + HOP_LENGTH_SPREAD_TILES;
/** The lattice's spacing, raft edge to raft edge: a float plus the shortest or longest hop. */
const LATTICE_PITCH_MIN = FLOAT_SIZE_TILES + HOP_MIN_TILES;
/**
 * How far a whole lattice row may slide along itself, or a whole column along
 * itself, so the field is staggered rather than a grid. Sliding a line leaves
 * every hop along it the same length, and one tile leaves every hop across it
 * the overlap it needs. A line a fixed float hops to stays put.
 */
const MAX_STAGGER_TILES = 1;
/**
 * The longest step between lattice lines. The raft after a long step is a
 * tile wider back toward the one before, so every hop in the lattice is the
 * shortest: a raft hemmed in by neighbours a short hop away on every side has
 * no water behind it for the fin to hang back far enough over a longer swim.
 */
const LATTICE_PITCH_MAX = LATTICE_PITCH_MIN + 1;
/** Where the lattice starts, in from a pump's wall: past the pump's raft and the shortest hop. */
const LATTICE_INSET_TILES = FLOAT_SIZE_TILES + HOP_MIN_TILES;
/** The first lattice row, in from the entrance wall: past the landing and the shortest hop. */
const LATTICE_FIRST_ROW = LANDING_SET_BACK_ROWS + FLOAT_SIZE_TILES + HOP_MIN_TILES;
/** Two platforms must face each other across at least this much edge to be a hop. */
const HOP_MIN_OVERLAP_TILES = 2;
/**
 * Two platforms that are not a hop are at least this far apart, so every
 * short swim in the room is one the shark was solved for.
 */
const NON_HOP_MIN_GAP_TILES = HOP_MIN_TILES;
/** Open water kept between a field raft and a pump, so the fin can pass. */
const PUMP_CLEARANCE_TILES = 2;

// ── Search budgets ───────────────────────────────────────────────────────────

/** Seeds tried before a room is given up on. */
const MAX_LAYOUT_ATTEMPTS = 40;
/** Rounds of dropping the rafts whose loops cannot be solved and solving the rest again. */
const LOOP_SOLVE_ROUNDS = 4;
/** How many of the failed seeds' reasons a room that cannot be laid out reports. */
const REPORTED_REASONS = 3;
/** Each attempt's seed is the room's seed stepped by this, a large odd number so streams never overlap. */
const ATTEMPT_SEED_STRIDE = 0x9e3779b1;

/** Drains, as offsets from the Kraken's tile: a ring she can drag a guard up through anywhere round her. */
const DRAIN_OFFSETS: readonly TilePoint[] = [
  { x: 4, y: 0 },
  { x: -4, y: 0 },
  { x: 0, y: 4 },
  { x: 0, y: -4 },
  { x: 5, y: 5 },
  { x: -5, y: 5 },
  { x: 5, y: -5 },
  { x: -5, y: -5 },
  { x: 9, y: 1 },
  { x: -9, y: -1 },
  { x: 1, y: 8 },
  { x: -1, y: -8 },
];

// ── The layout ───────────────────────────────────────────────────────────────

export interface LandingRaft {
  readonly kind: 'landing';
  readonly id: 'landing';
  readonly rect: TileRect;
  /** Where the party is gathered when the intro ends. */
  readonly gather: TilePoint;
}

export type TentacleReach = 'melee' | 'ranged_only';

export interface RaftPlatform {
  readonly kind: 'raft';
  readonly id: RaftId;
  readonly rect: TileRect;
  /** The water tile its one tentacle rises through. */
  readonly tentacle: TilePoint;
  /** `ranged_only` rises out of every swing and inside the weakest Magic Missile's flight. */
  readonly tentacleReach: TentacleReach;
}

/** A pump mounted on a wall and the raft moored beside it. */
export interface PumpRaft {
  readonly kind: 'pump_raft';
  readonly id: PumpRaftId;
  readonly wall: PumpWall;
  /** The raft a crawler stands on to haul the valve. */
  readonly rect: TileRect;
  /** The pump, mounted at the foot of its wall's middle; blocked. */
  readonly pump: TilePoint;
  /**
   * The water tile the pump's chute pours into, {@link PUMP_OUTFALL_OFFSET_TILES}
   * along the pump's row: into the room off an east or west wall, along the
   * wall toward the room's middle off a north or south one.
   */
  readonly outfall: TilePoint;
  readonly chute: ChuteSide;
  /** Where the pump tentacle rises if this is the second pump shut off; ranged-only from every platform. */
  readonly pumpTentacle: TilePoint;
}

export type Platform = LandingRaft | RaftPlatform | PumpRaft;

/** A swim between two platforms straight across the open water between their facing edges. */
export interface RaftHop {
  readonly a: PlatformId;
  readonly b: PlatformId;
  /** Where a crawler's centre leaves `a`, at the middle of the facing edges. */
  readonly aEdge: TileVec;
  readonly bEdge: TileVec;
  readonly lengthTiles: number;
  /** The water tiles between the facing edges. */
  readonly corridor: TileRect;
}

export interface FloodedPumpRoomLayout {
  readonly bounds: TileRect;
  readonly doorSide: DoorSide;
  readonly entrance: BossRoomDoorway;
  /** The seed the accepted layout was built from: the room's own, or one after it when earlier ones failed. */
  readonly layoutSeed: number;
  /** The Kraken's tile, the middle of the dais. */
  readonly centre: TilePoint;
  readonly landing: LandingRaft;
  readonly rafts: readonly RaftPlatform[];
  readonly pumps: Readonly<Record<PumpWall, PumpRaft>>;
  readonly hops: readonly RaftHop[];
  /** Both ways along every hop. */
  readonly departures: readonly SharkDeparture[];
  /** The room's water and every platform's solved shark loop. */
  readonly sea: SharkSea;
  /** Where guard tentacles come up once the room is drained. */
  readonly drains: readonly TilePoint[];
  /** The entrance doorway's tiles, where the corridor's barrels float in and settle. */
  readonly barrelSlots: readonly TilePoint[];
  /** Every doorway but the entrance: the ways on, each held shut by a barrel until the Kraken dies. */
  readonly exits: readonly BossRoomDoorway[];
}

/** Every platform in the room: the landing, the field's rafts and the pumps' rafts. */
export function allPlatforms(layout: FloodedPumpRoomLayout): Platform[] {
  return [layout.landing, ...layout.rafts, ...PUMP_WALLS.map((wall) => layout.pumps[wall])];
}

/** The platform standing on `tile`, or null for water and anything outside the room. */
export function platformAt(layout: FloodedPumpRoomLayout, tile: TilePoint): Platform | null {
  return allPlatforms(layout).find((p) => rectContainsTile(p.rect, tile.x, tile.y)) ?? null;
}

/** The platform nearest `point`, for a crawler on none: the shark patrols round it. */
export function nearestPlatform(layout: FloodedPumpRoomLayout, point: TileVec): Platform {
  let best: Platform = layout.landing;
  for (const platform of allPlatforms(layout)) {
    if (distanceToRect(point, platform.rect) < distanceToRect(point, best.rect)) best = platform;
  }
  return best;
}

/** The solved shark loop round `platform`. */
export function platformShark(layout: FloodedPumpRoomLayout, platform: PlatformId): PlatformShark {
  const shark = layout.sea.sharks.get(platform);
  if (shark === undefined) throw new Error(`no shark loop round ${platform}`);
  return shark;
}

// ── The doorway frame ────────────────────────────────────────────────────────

interface RoomFrame {
  readonly side: DoorSide;
  readonly bounds: TileRect;
  /** Tiles along the entrance wall. */
  readonly width: number;
  /** Tiles from the entrance wall to the far one. */
  readonly depth: number;
}

function roomFrame(side: DoorSide, bounds: TileRect): RoomFrame {
  const acrossX = side === 'north' || side === 'south';
  return {
    side,
    bounds,
    width: acrossX ? bounds.w : bounds.h,
    depth: acrossX ? bounds.h : bounds.w,
  };
}

function frameToWorld(frame: RoomFrame, along: number, depth: number): TilePoint {
  const { bounds } = frame;
  const lastX = bounds.x + bounds.w - 1;
  const lastY = bounds.y + bounds.h - 1;
  switch (frame.side) {
    case 'south':
      return { x: bounds.x + along, y: lastY - depth };
    case 'north':
      return { x: lastX - along, y: bounds.y + depth };
    case 'west':
      return { x: bounds.x + depth, y: bounds.y + along };
    case 'east':
      return { x: lastX - depth, y: lastY - along };
  }
}

function worldToFrameAlong(frame: RoomFrame, tile: TilePoint): number {
  const { bounds } = frame;
  switch (frame.side) {
    case 'south':
      return tile.x - bounds.x;
    case 'north':
      return bounds.x + bounds.w - 1 - tile.x;
    case 'west':
      return tile.y - bounds.y;
    case 'east':
      return bounds.y + bounds.h - 1 - tile.y;
  }
}

function frameRectToWorld(frame: RoomFrame, rect: TileRect): TileRect {
  const a = frameToWorld(frame, rect.x, rect.y);
  const b = frameToWorld(frame, rect.x + rect.w - 1, rect.y + rect.h - 1);
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1 };
}

/** Lookup key for a tile; valid for any non-negative tile in a grid narrower than the stride. */
const TILE_KEY_STRIDE = 65536;
function tileKey(x: number, y: number): number {
  return y * TILE_KEY_STRIDE + x;
}

function rectTouchesKeys(rect: TileRect, keys: ReadonlySet<number>): boolean {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      if (keys.has(tileKey(x, y))) return true;
    }
  }
  return false;
}

function rectInside(outer: TileRect, inner: TileRect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

function inflate(rect: TileRect, by: number): TileRect {
  return { x: rect.x - by, y: rect.y - by, w: rect.w + 2 * by, h: rect.h + 2 * by };
}

// ── Hops between rectangles ──────────────────────────────────────────────────

interface HopGeometry {
  readonly aEdge: TileVec;
  readonly bEdge: TileVec;
  readonly lengthTiles: number;
  readonly corridor: TileRect;
}

function isHopLength(gap: number): boolean {
  return gap >= HOP_MIN_TILES && gap <= HOP_MAX_TILES;
}

/** The two rectangles' facing edges as a hop, or null when they do not face each other at hop range. */
function hopBetween(a: TileRect, b: TileRect): HopGeometry | null {
  const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  const half = 0.5;
  if (overlapX >= HOP_MIN_OVERLAP_TILES) {
    const start = Math.max(a.x, b.x);
    const mid = start + overlapX * half;
    const aAbove = a.y + a.h <= b.y;
    const gap = aAbove ? b.y - (a.y + a.h) : a.y - (b.y + b.h);
    if (!isHopLength(gap)) return null;
    const aEdgeY = aAbove ? a.y + a.h : a.y;
    const bEdgeY = aAbove ? b.y : b.y + b.h;
    return {
      aEdge: { x: mid, y: aEdgeY },
      bEdge: { x: mid, y: bEdgeY },
      lengthTiles: gap,
      corridor: { x: start, y: Math.min(aEdgeY, bEdgeY), w: overlapX, h: gap },
    };
  }
  if (overlapY >= HOP_MIN_OVERLAP_TILES) {
    const start = Math.max(a.y, b.y);
    const mid = start + overlapY * half;
    const aLeft = a.x + a.w <= b.x;
    const gap = aLeft ? b.x - (a.x + a.w) : a.x - (b.x + b.w);
    if (!isHopLength(gap)) return null;
    const aEdgeX = aLeft ? a.x + a.w : a.x;
    const bEdgeX = aLeft ? b.x : b.x + b.w;
    return {
      aEdge: { x: aEdgeX, y: mid },
      bEdge: { x: bEdgeX, y: mid },
      lengthTiles: gap,
      corridor: { x: Math.min(aEdgeX, bEdgeX), y: start, w: gap, h: overlapY },
    };
  }
  return null;
}

/** Whether a raft at `rect` keeps its distance from `other`: a hop apart, or well clear. */
function keepsDistance(rect: TileRect, other: TileRect): boolean {
  const gap = gapBetweenRects(rect, other);
  if (gap < HOP_MIN_TILES) return false;
  return hopBetween(rect, other) !== null || gap >= NON_HOP_MIN_GAP_TILES;
}

/**
 * How far either side of a float backed onto a wall the water is kept open.
 * With no water behind it, the fin's far points lie off to its sides, and the
 * window of a hop away from the wall needs the fin this far out.
 */
const WALL_BACKED_SIDE_ROOM_TILES = 7;
/** How far past a wall-backed float's own depth that open water reaches into the room. */
const WALL_BACKED_DEPTH_ROOM_TILES = 2;

/**
 * The water beside a float backed onto the nearest wall that no field raft
 * may cover: a strip along that wall either side of it.
 */
function wallBackedSwimRoom(rect: TileRect, bounds: TileRect): TileRect {
  const gaps = {
    north: rect.y - bounds.y,
    south: bounds.y + bounds.h - (rect.y + rect.h),
    west: rect.x - bounds.x,
    east: bounds.x + bounds.w - (rect.x + rect.w),
  };
  const wall = (['north', 'south', 'west', 'east'] as const).reduce((best, side) =>
    gaps[side] < gaps[best] ? side : best,
  );
  const side = WALL_BACKED_SIDE_ROOM_TILES;
  const deep = WALL_BACKED_DEPTH_ROOM_TILES;
  switch (wall) {
    case 'north':
      return {
        x: rect.x - side,
        y: bounds.y,
        w: rect.w + 2 * side,
        h: rect.y + rect.h + deep - bounds.y,
      };
    case 'south':
      return {
        x: rect.x - side,
        y: rect.y - deep,
        w: rect.w + 2 * side,
        h: bounds.y + bounds.h - rect.y + deep,
      };
    case 'west':
      return {
        x: bounds.x,
        y: rect.y - side,
        w: rect.x + rect.w + deep - bounds.x,
        h: rect.h + 2 * side,
      };
    case 'east':
      return {
        x: rect.x - deep,
        y: rect.y - side,
        w: bounds.x + bounds.w - rect.x + deep,
        h: rect.h + 2 * side,
      };
  }
}

// ── The lattice ──────────────────────────────────────────────────────────────

interface Node {
  readonly id: PlatformId;
  readonly rect: TileRect;
}

function randomInt(rng: Rng, low: number, high: number): number {
  return low + Math.floor(rng() * (high - low + 1));
}

/**
 * `length` split into steps each a raft plus a hop long, at random, or null
 * when no such split exists.
 */
function splitIntoPitches(length: number, rng: Rng): number[] | null {
  if (length === 0) return [];
  const fewest = Math.ceil(length / LATTICE_PITCH_MAX);
  const most = Math.floor(length / LATTICE_PITCH_MIN);
  if (fewest > most) return null;
  const count = randomInt(rng, fewest, most);
  const steps = new Array<number>(count).fill(LATTICE_PITCH_MIN);
  let left = length - count * LATTICE_PITCH_MIN;
  while (left > 0) {
    const index = Math.floor(rng() * count);
    if (steps[index] >= LATTICE_PITCH_MAX) continue;
    steps[index]++;
    left--;
  }
  return steps;
}

/** The positions from `first` through `last` a lattice line stands at, `through` among them. */
function latticeLine(first: number, last: number, through: number, rng: Rng): number[] | null {
  const before = splitIntoPitches(through - first, rng);
  const after = splitIntoPitches(last - through, rng);
  if (before === null || after === null) return null;
  const line = [first];
  for (const step of [...before, ...after]) line.push(line[line.length - 1] + step);
  return line;
}

/** The nearest position to `wanted`, within the shift allowed, that a lattice line can pass through. */
function reachableThrough(first: number, last: number, wanted: number, rng: Rng): number | null {
  const clamped = Math.max(first, Math.min(last, wanted));
  for (let shift = 0; shift <= LANDING_MAX_SHIFT_TILES; shift++) {
    for (const through of [clamped - shift, clamped + shift]) {
      if (through < first || through > last) continue;
      if (latticeLine(first, last, through, rng) !== null) return through;
    }
  }
  return null;
}

/** Positions of `line` nearest the middle of `span` first, with a little seeded shuffle. */
function middleFirst(line: readonly number[], span: number, rng: Rng): number[] {
  const middle = (span - RAFT_MIN_SIZE_TILES) * HALF;
  return line
    .map((at) => ({ at, rank: Math.abs(at - middle) + rng() * PUMP_JITTER_TILES }))
    .sort((p, q) => p.rank - q.rank)
    .map((entry) => entry.at);
}

const HALF = 0.5;

function hopEdges(nodes: readonly Node[]): Array<readonly [PlatformId, PlatformId]> {
  const edges: Array<readonly [PlatformId, PlatformId]> = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (hopBetween(nodes[i].rect, nodes[j].rect) !== null) edges.push([nodes[i].id, nodes[j].id]);
    }
  }
  return edges;
}

function reachableFromLanding(nodes: readonly Node[], without: PlatformId | null): Set<PlatformId> {
  const kept = nodes.filter((node) => node.id !== without);
  const edges = hopEdges(kept);
  const reached = new Set<PlatformId>(['landing']);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [a, b] of edges) {
      if (reached.has(a) && !reached.has(b)) {
        reached.add(b);
        grew = true;
      } else if (reached.has(b) && !reached.has(a)) {
        reached.add(a);
        grew = true;
      }
    }
  }
  return reached;
}

function allPumpsReached(reached: ReadonlySet<PlatformId>): boolean {
  return PUMP_WALLS.every((wall) => reached.has(pumpRaftId(wall)));
}

function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** The field's rafts renumbered in order, so their ids run without gaps. */
function renumbered(nodes: readonly Node[]): Node[] {
  let next = 0;
  return nodes.map((node) =>
    node.id.startsWith('raft_') ? { id: raftId(next++), rect: node.rect } : node,
  );
}

// ── Building the world layout ────────────────────────────────────────────────

function rectTiles(rect: TileRect): TilePoint[] {
  const tiles: TilePoint[] = [];
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) tiles.push({ x, y });
  }
  return tiles;
}

/** Water tiles `steps` steps straight out from each edge tile of `rect`. */
function tilesOutFrom(rect: TileRect, steps: number): TilePoint[] {
  const out: TilePoint[] = [];
  for (let x = rect.x; x < rect.x + rect.w; x++) {
    out.push({ x, y: rect.y - steps }, { x, y: rect.y + rect.h - 1 + steps });
  }
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    out.push({ x: rect.x - steps, y }, { x: rect.x + rect.w - 1 + steps, y });
  }
  return out;
}

interface WorldPieces {
  readonly bounds: TileRect;
  readonly platformRects: readonly TileRect[];
  /** Pumps and their outfalls: no tentacle rises in them. */
  readonly fixtures: readonly TileRect[];
  /** Hop corridors, kept clear of tentacles so a swim lane is never body-blocked. */
  readonly lanes: readonly TileRect[];
  readonly doorwayLanes: ReadonlySet<number>;
}

/** Whether a tentacle may rise on `tile`: open water in the room, out of every swim lane and doorway. */
function isTentacleWater(pieces: WorldPieces, tile: TilePoint): boolean {
  if (!rectContainsTile(pieces.bounds, tile.x, tile.y)) return false;
  const solid = [...pieces.platformRects, ...pieces.fixtures, ...pieces.lanes];
  if (solid.some((rect) => rectContainsTile(rect, tile.x, tile.y))) return false;
  return !pieces.doorwayLanes.has(tileKey(tile.x, tile.y));
}

/** A melee tentacle sits right beside its raft, a corner included, touching no other platform. */
const MELEE_TENTACLE_STEPS = 1;
/** How close a melee tentacle may stand to a platform other than its own. */
const MELEE_TENTACLE_OTHER_PLATFORM_CLEARANCE = 1.5;

function meleeTentacleSpot(pieces: WorldPieces, raft: TileRect, rng: Rng): TilePoint | null {
  const others = pieces.platformRects.filter((rect) => rect !== raft);
  const spots = rectTiles(inflate(raft, MELEE_TENTACLE_STEPS)).filter(
    (tile) =>
      isTentacleWater(pieces, tile) &&
      others.every(
        (rect) =>
          distanceToRect(tentacleCentre(tile), rect) >= MELEE_TENTACLE_OTHER_PLATFORM_CLEARANCE,
      ),
  );
  return pick(spots, rng);
}

function rangedTentacleSpots(pieces: WorldPieces, platform: TileRect): TilePoint[] {
  return tilesOutFrom(platform, RANGED_ONLY_TENTACLE_OFFSET_TILES).filter(
    (tile) => isTentacleWater(pieces, tile) && isRangedOnlyFromAll(tile, pieces.platformRects),
  );
}

function pick<T>(items: readonly T[], rng: Rng): T | null {
  return items.length === 0 ? null : items[Math.floor(rng() * items.length)];
}

type Attempt =
  | { readonly kind: 'laid_out'; readonly layout: FloodedPumpRoomLayout }
  | { readonly kind: 'rejected'; readonly reason: string };

function rejected(reason: string): Attempt {
  return { kind: 'rejected', reason };
}

function hopsOf(nodes: readonly Node[]): RaftHop[] {
  const hops: RaftHop[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const geometry = hopBetween(nodes[i].rect, nodes[j].rect);
      if (geometry === null) continue;
      hops.push({ a: nodes[i].id, b: nodes[j].id, ...geometry });
    }
  }
  return hops;
}

function departuresOf(
  hops: readonly RaftHop[],
  rectOf: ReadonlyMap<PlatformId, TileRect>,
): SharkDeparture[] {
  const departures: SharkDeparture[] = [];
  for (const hop of hops) {
    const ends = [
      { from: hop.a, to: hop.b, start: hop.aEdge, end: hop.bEdge },
      { from: hop.b, to: hop.a, start: hop.bEdge, end: hop.aEdge },
    ];
    for (const end of ends) {
      const fromRect = rectOf.get(end.from);
      if (fromRect === undefined) continue;
      departures.push({
        from: end.from,
        to: end.to,
        fromRect,
        start: end.start,
        heading: {
          x: Math.sign(end.end.x - end.start.x),
          y: Math.sign(end.end.y - end.start.y),
        },
        swimTiles: hop.lengthTiles,
        fromHoldsTentacle: end.from !== 'landing',
      });
    }
  }
  return departures;
}

interface SolvedField {
  readonly nodes: readonly Node[];
  readonly hops: readonly RaftHop[];
  readonly departures: readonly SharkDeparture[];
  readonly sea: SharkSea;
}

/**
 * Solves a loop round every float, dropping any field raft whose loop cannot
 * be solved and solving the rest again in the water that leaves (a raft gone
 * is open water, which can shorten a fin's way round to a swim). Fails when a
 * fixed float's loop cannot be solved or a pump falls out of reach.
 */
function solveField(
  bounds: TileRect,
  initial: readonly Node[],
  pumpTiles: readonly TileRect[],
): SolvedField | string {
  let nodes = renumbered(initial);
  for (let round = 0; round < LOOP_SOLVE_ROUNDS; round++) {
    const reached = reachableFromLanding(nodes, null);
    if (!allPumpsReached(reached)) return 'no raft chain reaches every pump';
    nodes = renumbered(nodes.filter((node) => reached.has(node.id)));
    const hops = hopsOf(nodes);
    const rectOf = new Map(nodes.map((node) => [node.id, node.rect] as const));
    const departures = departuresOf(hops, rectOf);
    const water = new WaterMap(bounds, [...nodes.map((node) => node.rect), ...pumpTiles]);
    const floats = nodes.map((node) => node.rect);
    const sharks = new Map<PlatformId, PlatformShark>();
    const sea: SharkSea = { water, floats, sharks };
    const failed = new Set<PlatformId>();
    let fixedFailure: string | null = null;
    const fixedFirst = [
      ...nodes.filter((node) => !node.id.startsWith('raft_')),
      ...nodes.filter((node) => node.id.startsWith('raft_')),
    ];
    for (const node of fixedFirst) {
      const solution = solvePlatformLoop(
        sea,
        node.rect,
        node.id,
        departures.filter((departure) => departure.from === node.id),
        SHARK_TIMING,
      );
      if (solution.kind === 'solved') {
        sharks.set(node.id, solution);
        continue;
      }
      if (!node.id.startsWith('raft_')) {
        fixedFailure = solution.reason;
        break;
      }
      failed.add(node.id);
    }
    if (fixedFailure !== null) return fixedFailure;
    if (failed.size === 0) return { nodes, hops, departures, sea };
    nodes = nodes.filter((node) => !failed.has(node.id));
  }
  return 'rafts kept failing their loops';
}

/** A pump mounted on a wall and its raft, in world tiles. */
interface PumpPlacement {
  readonly pump: TilePoint;
  readonly outfall: TilePoint;
  readonly chute: ChuteSide;
  readonly raft: TileRect;
}

/**
 * The pump beside the raft `raft`, moored flush against the wall a crawler
 * facing `inward` has at their back. Off an east or west wall the chute pours
 * straight into the room along the pump's row, so the pump is mounted just
 * north of the raft, where its riser climbs the wall above open water rather
 * than standing over the planks; off a north or south wall the chute
 * runs along the wall toward the room's middle, so the pump is mounted at the
 * raft's end toward it, and pours past it.
 */
function mountPumpBeside(raft: TileRect, inward: TilePoint, roomCentre: TilePoint): PumpPlacement {
  const reach = PUMP_OUTFALL_OFFSET_TILES;
  if (inward.x !== 0) {
    const x = inward.x > 0 ? raft.x : raft.x + raft.w - 1;
    const y = raft.y - 1;
    const outfall = { x: x + inward.x * reach, y };
    return { pump: { x, y }, outfall, chute: outfall.x > x ? 'east' : 'west', raft };
  }
  const y = inward.y > 0 ? raft.y : raft.y + raft.h - 1;
  const toward = roomCentre.x >= raft.x + raft.w * HALF ? 1 : -1;
  const x = toward > 0 ? raft.x + raft.w : raft.x - 1;
  const outfall = { x: x + toward * reach, y };
  return { pump: { x, y }, outfall, chute: toward > 0 ? 'east' : 'west', raft };
}

/**
 * How many hops a float backed onto a wall may have, by kind. With no water
 * behind it, the fin's only far points lie off to its sides, which are too few
 * and too near for more than this many windows, or for any hop longer than
 * the shortest.
 */
const WALL_BACKED_HOP_LIMIT = {
  landing: 2,
  pump_raft: 1,
} as const;

function hopLimitOf(id: PlatformId): number {
  if (id === 'landing') return WALL_BACKED_HOP_LIMIT.landing;
  return id.startsWith('raft_') ? Infinity : WALL_BACKED_HOP_LIMIT.pump_raft;
}

/**
 * Whether a field raft at `rect` keeps its distance from every float in
 * `nodes`, and a float backed onto a wall gets from it no hop but one of the
 * shortest length, and no more hops than it can give windows to.
 */
function fitsAmong(rect: TileRect, nodes: readonly Node[]): boolean {
  for (const node of nodes) {
    if (!keepsDistance(rect, node.rect)) return false;
    const limit = hopLimitOf(node.id);
    const hop = hopBetween(rect, node.rect);
    if (hop === null || limit === Infinity) continue;
    if (hop.lengthTiles !== HOP_MIN_TILES) return false;
    const hops = nodes.filter((other) => hopBetween(other.rect, node.rect) !== null).length;
    if (hops >= limit) return false;
  }
  return true;
}

function layOutOnce(
  bounds: TileRect,
  entrance: BossRoomDoorway,
  doorways: readonly BossRoomDoorway[],
  seed: number,
): Attempt {
  const rng = mulberry32(seed);
  const frame = roomFrame(entrance.side, bounds);
  const centre = {
    x: bounds.x + Math.floor(bounds.w / 2),
    y: bounds.y + Math.floor(bounds.h / 2),
  };

  const sameTile = (a: TilePoint, b: TilePoint): boolean => a.x === b.x && a.y === b.y;
  const otherDoorways = doorways.filter((doorway) => !sameTile(doorway.tile, entrance.tile));
  const otherLanes = new Set<number>();
  for (const doorway of otherDoorways) {
    for (const tile of approachLaneTiles(doorway, bounds)) otherLanes.add(tileKey(tile.x, tile.y));
  }
  const doorwayLanes = new Set<number>(otherLanes);
  for (const tile of approachLaneTiles(entrance, bounds)) doorwayLanes.add(tileKey(tile.x, tile.y));

  const lastColumn = frame.width - LATTICE_INSET_TILES - FLOAT_SIZE_TILES;
  const lastRow = frame.depth - LATTICE_INSET_TILES - FLOAT_SIZE_TILES;
  const doorAlongs = entrance.tiles.map((tile) => worldToFrameAlong(frame, tile));
  const doorMiddle = Math.round(
    (Math.min(...doorAlongs) + Math.max(...doorAlongs) + 1 - FLOAT_SIZE_TILES) * HALF,
  );
  const landingAlong = reachableThrough(LATTICE_INSET_TILES, lastColumn, doorMiddle, rng);
  if (landingAlong === null) return rejected('no lattice lines up with the doorway');
  const columns = latticeLine(LATTICE_INSET_TILES, lastColumn, landingAlong, rng);
  const rows = latticeLine(LATTICE_FIRST_ROW, lastRow, LATTICE_FIRST_ROW, rng);
  if (columns === null || rows === null)
    return rejected('the room is the wrong size for a lattice');
  const square = (along: number, depth: number): TileRect =>
    frameRectToWorld(frame, { x: along, y: depth, w: FLOAT_SIZE_TILES, h: FLOAT_SIZE_TILES });
  const landingRect = square(landingAlong, LANDING_SET_BACK_ROWS);

  const inwardOf = (
    along: number,
    depth: number,
    step: { along: number; depth: number },
  ): TilePoint => {
    const from = frameToWorld(frame, along, depth);
    const to = frameToWorld(frame, along + step.along, depth + step.depth);
    return { x: to.x - from.x, y: to.y - from.y };
  };
  const pumpFits = (placement: PumpPlacement): boolean => {
    const tiles = [placement.pump, placement.outfall];
    if (!tiles.every((tile) => rectContainsTile(bounds, tile.x, tile.y))) return false;
    const touched = [placement.raft, ...tiles.map((tile) => ({ ...tile, w: 1, h: 1 }))];
    return !touched.some((rect) => rectTouchesKeys(rect, doorwayLanes));
  };
  const pinnedRows = new Set<number>();
  const pinnedColumns = new Set<number>([landingAlong]);
  const choosePump = (wall: PumpWall): PumpPlacement | null => {
    const spots =
      wall === 'far'
        ? middleFirst(columns, frame.width, rng).map((along) => ({
            along,
            depth: frame.depth - FLOAT_SIZE_TILES,
            inward: { along: 0, depth: -1 },
          }))
        : middleFirst(rows, frame.depth, rng).map((depth) => ({
            along: wall === 'left' ? 0 : frame.width - FLOAT_SIZE_TILES,
            depth,
            inward: { along: wall === 'left' ? 1 : -1, depth: 0 },
          }));
    for (const spot of spots) {
      const raft = square(spot.along, spot.depth);
      const placement = mountPumpBeside(
        raft,
        inwardOf(spot.along, spot.depth, spot.inward),
        centre,
      );
      if (!pumpFits(placement)) continue;
      if (wall === 'far') pinnedColumns.add(spot.along);
      else pinnedRows.add(spot.depth);
      return placement;
    }
    return null;
  };
  const left = choosePump('left');
  const far = choosePump('far');
  const right = choosePump('right');
  if (left === null || far === null || right === null)
    return rejected('no room on a wall for its pump');
  const pumpPlacements: Record<PumpWall, PumpPlacement> = { left, far, right };
  const pumpTiles = PUMP_WALLS.map((wall) => ({ ...pumpPlacements[wall].pump, w: 1, h: 1 }));

  const keepOut = new Set<number>(otherLanes);
  for (const tile of spawnClearTiles(centre, DAIS_RADIUS_TILES))
    keepOut.add(tileKey(tile.x, tile.y));
  for (const wall of PUMP_WALLS) {
    for (const tile of rectTiles(inflate({ ...pumpPlacements[wall].outfall, w: 1, h: 1 }, 1))) {
      keepOut.add(tileKey(tile.x, tile.y));
    }
  }
  for (const rect of [landingRect, ...PUMP_WALLS.map((wall) => pumpPlacements[wall].raft)]) {
    for (const tile of rectTiles(wallBackedSwimRoom(rect, bounds)))
      keepOut.add(tileKey(tile.x, tile.y));
  }

  const fixed: Node[] = [
    { id: 'landing', rect: landingRect },
    ...PUMP_WALLS.map((wall) => ({ id: pumpRaftId(wall), rect: pumpPlacements[wall].raft })),
  ];
  const water = inflate(bounds, -RAFT_WALL_MARGIN_TILES);
  const usable = (rect: TileRect): boolean =>
    rectInside(water, rect) &&
    !rectTouchesKeys(rect, keepOut) &&
    pumpTiles.every((pump) => gapBetweenRects(rect, pump) >= PUMP_CLEARANCE_TILES);

  const widenedBack = (line: readonly number[]): boolean[] =>
    line.map((at, index) => index > 0 && at - line[index - 1] > LATTICE_PITCH_MIN);
  const wideColumns = widenedBack(columns);
  const wideRows = widenedBack(rows);
  const stagger = (line: readonly number[], pinned: ReadonlySet<number>): number[] =>
    line.map((at) => (pinned.has(at) ? 0 : Math.floor(rng() * (MAX_STAGGER_TILES + 1))));
  const rowShifts = stagger(rows, pinnedRows);
  const columnShifts = stagger(columns, pinnedColumns);
  const nodes: Node[] = [...fixed];
  let latticeRafts = 0;
  rows.forEach((depth, row) => {
    columns.forEach((along, column) => {
      const backAlong = wideColumns[column] ? 1 : 0;
      const backDepth = wideRows[row] ? 1 : 0;
      const rect = frameRectToWorld(frame, {
        x: along - backAlong + rowShifts[row],
        y: depth - backDepth + columnShifts[column],
        w: FLOAT_SIZE_TILES + backAlong,
        h: FLOAT_SIZE_TILES + backDepth,
      });
      if (!usable(rect) || !fitsAmong(rect, nodes)) return;
      nodes.push({ id: raftId(latticeRafts++), rect });
    });
  });
  if (!allPumpsReached(reachableFromLanding(nodes, null))) {
    return rejected('no raft chain reaches every pump');
  }
  for (const node of shuffled(nodes.slice(fixed.length), rng)) {
    if (rng() >= HOLE_SHARE) continue;
    if (allPumpsReached(reachableFromLanding(nodes, node.id))) {
      nodes.splice(nodes.indexOf(node), 1);
    }
  }

  const solved = solveField(bounds, nodes, pumpTiles);
  if (typeof solved === 'string') return rejected(solved);
  const { hops, departures, sea } = solved;
  const raftNodes = solved.nodes.filter((node) => node.id.startsWith('raft_'));
  const raftRects = raftNodes.map((node) => node.rect);
  const platformRects = solved.nodes.map((node) => node.rect);

  const pieces: WorldPieces = {
    bounds,
    platformRects,
    fixtures: PUMP_WALLS.flatMap((wall) => [
      { ...pumpPlacements[wall].pump, w: 1, h: 1 },
      inflate({ ...pumpPlacements[wall].outfall, w: 1, h: 1 }, 1),
    ]),
    lanes: hops.map((hop) => hop.corridor),
    doorwayLanes,
  };
  const mandatory = raftNodes
    .map((_, index) => index)
    .filter((index) => !allPumpsReached(reachableFromLanding(solved.nodes, raftNodes[index].id)));
  const rangedCandidates = shuffled(
    mandatory.length > 0 ? mandatory : raftNodes.map((_, i) => i),
    rng,
  );
  const rangedIndex = rangedCandidates.find(
    (index) => rangedTentacleSpots(pieces, raftRects[index]).length > 0,
  );
  if (rangedIndex === undefined) return rejected('no raft has room for a ranged-only tentacle');
  const rafts: RaftPlatform[] = [];
  for (let index = 0; index < raftRects.length; index++) {
    const ranged = index === rangedIndex;
    const tentacle = ranged
      ? pick(rangedTentacleSpots(pieces, raftRects[index]), rng)
      : meleeTentacleSpot(pieces, raftRects[index], rng);
    if (tentacle === null) return rejected(`raft_${index} has no water for its tentacle`);
    rafts.push({
      kind: 'raft',
      id: raftId(index),
      rect: raftRects[index],
      tentacle,
      tentacleReach: ranged ? 'ranged_only' : 'melee',
    });
  }

  const buildPump = (wall: PumpWall): PumpRaft | null => {
    const placement = pumpPlacements[wall];
    const pumpTentacle = pick(rangedTentacleSpots(pieces, placement.raft), rng);
    if (pumpTentacle === null) return null;
    return {
      kind: 'pump_raft',
      id: pumpRaftId(wall),
      wall,
      rect: placement.raft,
      pump: placement.pump,
      outfall: placement.outfall,
      chute: placement.chute,
      pumpTentacle,
    };
  };
  const leftPump = buildPump('left');
  const farPump = buildPump('far');
  const rightPump = buildPump('right');
  if (leftPump === null || farPump === null || rightPump === null) {
    return rejected('a pump has no water for its tentacle');
  }

  const drains = DRAIN_OFFSETS.map((offset) => ({
    x: centre.x + offset.x,
    y: centre.y + offset.y,
  })).filter(
    (tile) =>
      rectContainsTile(inflate(bounds, -1), tile.x, tile.y) &&
      !platformRects.some((rect) => rectContainsTile(rect, tile.x, tile.y)),
  );

  const gatherCentre = {
    x: landingRect.x + Math.floor(landingRect.w / 2),
    y: landingRect.y + Math.floor(landingRect.h / 2),
  };
  return {
    kind: 'laid_out',
    layout: {
      bounds,
      doorSide: entrance.side,
      entrance,
      layoutSeed: seed,
      centre,
      landing: { kind: 'landing', id: 'landing', rect: landingRect, gather: gatherCentre },
      rafts,
      pumps: { left: leftPump, far: farPump, right: rightPump },
      hops,
      departures,
      sea,
      drains,
      barrelSlots: entrance.tiles.map((tile) => ({ x: tile.x, y: tile.y })),
      exits: otherDoorways,
    },
  };
}

/**
 * Lays the flooded pump room out in `bounds`, entered through `entrance`.
 * `doorways` lists every doorway into the room, the entrance among them; the
 * others' approaches are kept clear of pumps and rafts.
 *
 * Tries `seed`, then seeds after it, until a layout passes every rule; throws
 * when none of {@link MAX_LAYOUT_ATTEMPTS} does, which means the room is too
 * small or too crowded with doorways for the fight.
 */
export function planFloodedPumpRoom(
  bounds: TileRect,
  entrance: BossRoomDoorway,
  doorways: readonly BossRoomDoorway[],
  seed: number,
): FloodedPumpRoomLayout {
  const reasons: string[] = [];
  for (let attempt = 0; attempt < MAX_LAYOUT_ATTEMPTS; attempt++) {
    const attemptSeed = (seed + attempt * ATTEMPT_SEED_STRIDE) >>> 0;
    const result = layOutOnce(bounds, entrance, doorways, attemptSeed);
    if (result.kind === 'laid_out') return result.layout;
    reasons.push(result.reason);
  }
  throw new Error(
    `no flooded pump room layout in ${MAX_LAYOUT_ATTEMPTS} seeds from ${seed}: ${reasons.slice(0, REPORTED_REASONS).join('; ')}`,
  );
}
