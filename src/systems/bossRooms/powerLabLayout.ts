import { POWER_LAB_FLOOR, type TileContent } from '../../map/tileTypes';
import {
  approachLaneTiles,
  findBossRoomDoorways,
  rotateTemplate,
  type BossRoomDoorway,
  type DoorSide,
  type TilePoint,
  type TileRect,
} from './bossRoomLayout';

/**
 * Where everything in the power lab goes.
 *
 * Worked out from the room's own geometry — its bounds, its centre and its
 * doorways — and nothing else, so the room system that stamps the props and the
 * tile painters that bake the floor arrive at the same lab without talking to
 * each other. No seed reaches any of it: where a vat stands and which floor is
 * a puddle the Current Goblin can charge are collision or damage, and a floor's
 * seed must never move either.
 *
 * Wall slots are authored in the frame of a crawler standing in the main
 * doorway looking in: the near wall is the doorway's, the far wall faces it,
 * and left and right are the crawler's. A slot that lands in any doorway's
 * approach lane is skipped for the next candidate, since a gauntlet room has a
 * way out as well as a way in and the far door can be on any wall.
 */
export interface PowerLabLayout {
  readonly bounds: TileRect;
  /** The boss's spawn tile, and the middle of the broken vat bed painted on the floor. */
  readonly centre: TilePoint;
  readonly doorSide: DoorSide;
  readonly doorways: readonly BossRoomDoorway[];
  /** Tiles every doorway's approach needs open. */
  readonly approach: ReadonlySet<number>;
  readonly vats: readonly LabVat[];
  readonly consoles: readonly TilePoint[];
  /** The standing puddles the Current Goblin charges, each a connected patch of plain floor. */
  readonly puddles: readonly LabPuddle[];
}

/** A specimen vat against the wall. */
export interface LabVat {
  readonly tile: TilePoint;
  /** One step from the vat into the room. */
  readonly inward: TilePoint;
}

/** One standing puddle: walkable floor painted wet, charged whole when he plunges his rods in. */
export interface LabPuddle {
  readonly tiles: readonly TilePoint[];
  /** {@link labTileKey} of every tile, for membership tests. */
  readonly keys: ReadonlySet<number>;
  /** The middle of the puddle's core rectangle, in tiles. */
  readonly centre: TilePoint;
}

/** Tile key for a lookup set; valid for any grid narrower than the stride. */
const LAB_TILE_KEY_STRIDE = 65536;
export function labTileKey(x: number, y: number): number {
  return y * LAB_TILE_KEY_STRIDE + x;
}

const HALF_TILE = 0.5;

/** Radius of the broken vat bed painted at the room's centre, in tiles. */
export const VAT_BED_RADIUS_TILES = 2.5;

/** Vats wanted along the walls; the template carries spares for when a doorway takes a slot. */
const MAX_VATS = 8;
/** The fewest vats a lab may be left with once the doorways have taken their slots; gated. */
export const MIN_LAB_VATS = 6;
const MAX_CONSOLES = 3;

/**
 * Each puddle's dry-floor core, in tiles along the doorway wall and into the
 * room. A rim of extra wet tiles rounds each long side, so the whole puddle is
 * larger than this and never smaller.
 */
const PUDDLE_CORE_ALONG_TILES = 6;
const PUDDLE_CORE_DEPTH_TILES = 4;
/** The fewest and most puddles a lab is laid out with; gated. */
export const MIN_LAB_PUDDLES = 2;
const MAX_LAB_PUDDLES = 3;
/** Dry floor kept between a puddle and the wall it sits nearest, so the wall's props stay reachable. */
const PUDDLE_WALL_GAP_TILES = 2;

type Wall = 'near' | 'far' | 'left' | 'right';

/**
 * A slot on a wall. On the near and far walls `offset` runs along the wall from
 * its middle, positive to the crawler's right; on the side walls it counts
 * tiles in from the doorway's wall, and a negative value counts back from the
 * far wall instead, so one template serves a long room and a short one.
 */
interface WallSlot {
  readonly wall: Wall;
  readonly offset: number;
}

const VAT_SLOTS: readonly WallSlot[] = [
  { wall: 'left', offset: -8 },
  { wall: 'right', offset: -8 },
  { wall: 'far', offset: -6 },
  { wall: 'far', offset: 6 },
  { wall: 'left', offset: 5 },
  { wall: 'right', offset: 5 },
  { wall: 'far', offset: -2 },
  { wall: 'far', offset: 2 },
  { wall: 'near', offset: -7 },
  { wall: 'near', offset: 7 },
  { wall: 'left', offset: 3 },
  { wall: 'right', offset: 3 },
];

const CONSOLE_SLOTS: readonly WallSlot[] = [
  { wall: 'far', offset: -4 },
  { wall: 'far', offset: 4 },
  { wall: 'near', offset: -5 },
  { wall: 'near', offset: 5 },
  { wall: 'left', offset: -3 },
  { wall: 'right', offset: -3 },
];

const CARDINALS: readonly TilePoint[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];
/** Along values tried when measuring a wall's extent in the doorway frame; wider than any room. */
const FRAME_PROBE_REACH = 64;

/** The doorway-frame extent of a room: how far along each wall runs and how deep the room is. */
interface DoorFrame {
  readonly alongMin: number;
  readonly alongMax: number;
  readonly depthMax: number;
}

function measureDoorFrame(side: DoorSide, bounds: TileRect): DoorFrame {
  const probes: Array<{ along: number; depth: number }> = [];
  for (let along = -FRAME_PROBE_REACH; along <= FRAME_PROBE_REACH; along++) {
    probes.push({ along, depth: 0 });
  }
  const insideAlongs = probes
    .filter((probe) => rotateTemplate([probe], side, bounds).length > 0)
    .map((probe) => probe.along);
  let depthMax = 0;
  while (rotateTemplate([{ along: 0, depth: depthMax + 1 }], side, bounds).length > 0) depthMax++;
  return {
    alongMin: insideAlongs.length === 0 ? 0 : Math.min(...insideAlongs),
    alongMax: insideAlongs.length === 0 ? 0 : Math.max(...insideAlongs),
    depthMax,
  };
}

function slotToFrame(slot: WallSlot, frame: DoorFrame): { along: number; depth: number } {
  switch (slot.wall) {
    case 'near':
      return { along: slot.offset, depth: 0 };
    case 'far':
      return { along: slot.offset, depth: frame.depthMax };
    case 'left':
      return { along: frame.alongMin, depth: sideDepth(slot.offset, frame) };
    case 'right':
      return { along: frame.alongMax, depth: sideDepth(slot.offset, frame) };
  }
}

function sideDepth(offset: number, frame: DoorFrame): number {
  return offset >= 0 ? offset : frame.depthMax + offset;
}

/** A doorway-frame point in world tiles, or null when it falls outside the room. */
function frameTile(
  along: number,
  depth: number,
  side: DoorSide,
  bounds: TileRect,
): TilePoint | null {
  const placed = rotateTemplate([{ along, depth }], side, bounds);
  return placed.length === 0 ? null : { x: placed[0].x, y: placed[0].y };
}

/** The step into the room from a tile on the room's edge, or from its centre when it is not on one. */
function inwardFrom(tile: TilePoint, bounds: TileRect): TilePoint {
  if (tile.y === bounds.y) return { x: 0, y: 1 };
  if (tile.y === bounds.y + bounds.h - 1) return { x: 0, y: -1 };
  if (tile.x === bounds.x) return { x: 1, y: 0 };
  return { x: -1, y: 0 };
}

/**
 * Tiles the room reads as its own floor: the room's floor type, or anything
 * stamped over it (a stamped tile remembers the floor it replaced).
 */
function isLabFloor(tile: TileContent | undefined): boolean {
  if (tile === undefined) return false;
  return tile.type === POWER_LAB_FLOOR || tile.groundType === POWER_LAB_FLOOR;
}

/**
 * Lays out the lab in the room at `bounds`, whose boss stands at `centre`.
 *
 * Reads the grid only for the doorways and for which tiles are floor, so it
 * gives the same answer before and after the room's props are stamped.
 */
export function buildPowerLabLayout(
  structure: TileContent[][],
  bounds: TileRect,
  centre: TilePoint,
): PowerLabLayout {
  const doorways = findBossRoomDoorways(structure, bounds);
  const doorSide: DoorSide = doorways.length === 0 ? 'south' : doorways[0].side;
  const frame = measureDoorFrame(doorSide, bounds);

  const approach = new Set<number>();
  const doorwayTiles = new Set<number>();
  for (const doorway of doorways) {
    for (const tile of approachLaneTiles(doorway, bounds)) approach.add(labTileKey(tile.x, tile.y));
    for (const tile of doorway.tiles) doorwayTiles.add(labTileKey(tile.x, tile.y));
  }

  const inRoom = (t: TilePoint): boolean =>
    t.x >= bounds.x && t.y >= bounds.y && t.x < bounds.x + bounds.w && t.y < bounds.y + bounds.h;
  const isFloor = (t: TilePoint): boolean => inRoom(t) && isLabFloor(structure[t.y]?.[t.x]);
  const claimed = new Set<number>();
  const isFree = (t: TilePoint): boolean =>
    isFloor(t) &&
    !approach.has(labTileKey(t.x, t.y)) &&
    !doorwayTiles.has(labTileKey(t.x, t.y)) &&
    !claimed.has(labTileKey(t.x, t.y));
  const claim = (t: TilePoint): void => {
    claimed.add(labTileKey(t.x, t.y));
  };

  const puddles = placePuddles(doorSide, frame, bounds, centre, isFree, claim);

  // Props keep a tile apart so each reads as its own object.
  const props = new Set<number>();
  const touchesProp = (t: TilePoint): boolean => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (props.has(labTileKey(t.x + dx, t.y + dy))) return true;
      }
    }
    return false;
  };
  const placeWallProps = (slots: readonly WallSlot[], max: number): TilePoint[] => {
    const placed: TilePoint[] = [];
    for (const slot of slots) {
      if (placed.length >= max) break;
      const { along, depth } = slotToFrame(slot, frame);
      const tile = frameTile(along, depth, doorSide, bounds);
      if (tile === null || !isFree(tile) || touchesProp(tile)) continue;
      const inward = inwardFrom(tile, bounds);
      if (!isFree({ x: tile.x + inward.x, y: tile.y + inward.y })) continue;
      claim(tile);
      props.add(labTileKey(tile.x, tile.y));
      placed.push(tile);
    }
    return placed;
  };

  const vats = placeWallProps(VAT_SLOTS, MAX_VATS).map((tile) => ({
    tile,
    inward: inwardFrom(tile, bounds),
  }));
  const consoles = placeWallProps(CONSOLE_SLOTS, MAX_CONSOLES);

  return { bounds, centre, doorSide, doorways, approach, vats, consoles, puddles };
}

/** A candidate puddle: its core rectangle and the rim of extra water round it. */
interface PuddleCandidate {
  readonly core: readonly TilePoint[];
  readonly rim: readonly TilePoint[];
  readonly centre: TilePoint;
}

/**
 * The puddles, laid one at a time where each lies farthest from the vat bed
 * at the room's centre and from every puddle already laid, so the two or three
 * of them split the room and the boss has one within a walk wherever the fight
 * drifts. A candidate's core must be free floor kept back from the walls and
 * off the vat bed, and it must keep a dry tile from every other puddle. Candidates are tried in the doorway frame's own order and the first
 * of equal score wins, so the same room always gets the same puddles.
 */
function placePuddles(
  side: DoorSide,
  frame: DoorFrame,
  bounds: TileRect,
  centre: TilePoint,
  isFree: (t: TilePoint) => boolean,
  claim: (t: TilePoint) => void,
): LabPuddle[] {
  const candidates = puddleCandidates(side, frame, bounds).filter((c) =>
    // Clear of the vat bed, so the bed is never under water and he never
    // opens the fight standing in a puddle.
    c.core.every(
      (t) => isFree(t) && Math.hypot(t.x - centre.x, t.y - centre.y) > VAT_BED_RADIUS_TILES,
    ),
  );
  const puddles: LabPuddle[] = [];
  const wet = new Set<number>();
  const keepsApart = (t: TilePoint): boolean => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (wet.has(labTileKey(t.x + dx, t.y + dy))) return false;
      }
    }
    return true;
  };
  while (puddles.length < MAX_LAB_PUDDLES) {
    let best: PuddleCandidate | null = null;
    let bestScore = -Infinity;
    for (const candidate of candidates) {
      if (!candidate.core.every(keepsApart)) continue;
      const score = Math.min(
        Math.hypot(candidate.centre.x - centre.x, candidate.centre.y - centre.y),
        ...puddles.map((p) =>
          Math.hypot(candidate.centre.x - p.centre.x, candidate.centre.y - p.centre.y),
        ),
      );
      if (score <= bestScore) continue;
      best = candidate;
      bestScore = score;
    }
    if (best === null) break;
    const tiles = [...best.core, ...best.rim.filter((t) => isFree(t) && keepsApart(t))];
    for (const t of tiles) {
      claim(t);
      wet.add(labTileKey(t.x, t.y));
    }
    puddles.push({
      tiles,
      keys: new Set(tiles.map((t) => labTileKey(t.x, t.y))),
      centre: best.centre,
    });
  }
  return puddles;
}

/**
 * Every place a puddle's core fits in the room, kept back from the walls:
 * a rectangle running along the doorway wall, with a rim of wet tiles along
 * the middle of each long side so it reads as spilled water rather than a
 * painted box.
 */
function puddleCandidates(side: DoorSide, frame: DoorFrame, bounds: TileRect): PuddleCandidate[] {
  const inset = 1 + PUDDLE_WALL_GAP_TILES;
  const candidates: PuddleCandidate[] = [];
  const lastAlong = frame.alongMax - inset - (PUDDLE_CORE_ALONG_TILES - 1);
  const lastDepth = frame.depthMax - inset - (PUDDLE_CORE_DEPTH_TILES - 1);
  for (let depth = inset; depth <= lastDepth; depth++) {
    for (let along = frame.alongMin + inset; along <= lastAlong; along++) {
      const core: TilePoint[] = [];
      const rim: TilePoint[] = [];
      for (let d = -1; d <= PUDDLE_CORE_DEPTH_TILES; d++) {
        for (let a = 0; a < PUDDLE_CORE_ALONG_TILES; a++) {
          const outsideDepth = d < 0 || d >= PUDDLE_CORE_DEPTH_TILES;
          const nearAlongEnd = a === 0 || a === PUDDLE_CORE_ALONG_TILES - 1;
          if (outsideDepth && nearAlongEnd) continue;
          const tile = frameTile(along + a, depth + d, side, bounds);
          if (tile === null) continue;
          (outsideDepth ? rim : core).push(tile);
        }
      }
      if (core.length !== PUDDLE_CORE_ALONG_TILES * PUDDLE_CORE_DEPTH_TILES) continue;
      const middle = frameTile(
        along + Math.floor(PUDDLE_CORE_ALONG_TILES * HALF_TILE),
        depth + Math.floor(PUDDLE_CORE_DEPTH_TILES * HALF_TILE),
        side,
        bounds,
      );
      candidates.push({ core, rim, centre: middle ?? core[0] });
    }
  }
  return candidates;
}

/** Tiles 4-connected to `tile`. */
function labNeighbours(tile: TilePoint): TilePoint[] {
  return CARDINALS.map((c) => ({ x: tile.x + c.x, y: tile.y + c.y }));
}

/** The puddle a tile lies in, or null on dry floor. */
export function puddleAt(lab: PowerLabLayout, tx: number, ty: number): LabPuddle | null {
  const key = labTileKey(tx, ty);
  return lab.puddles.find((p) => p.keys.has(key)) ?? null;
}

// ── Finding a lab from the grid alone ────────────────────────────────────────

/**
 * Every lab on a grid, found once per grid. The tile painters are handed a
 * grid and a position and nothing else, so this is how the floor's vat bed
 * and puddles find the room they belong to.
 */
const labsByGrid = new WeakMap<TileContent[][], readonly PowerLabLayout[]>();

/** The lab a tile belongs to, or null when the tile is in no lab. */
export function powerLabAt(
  structure: TileContent[][],
  tx: number,
  ty: number,
): PowerLabLayout | null {
  let labs = labsByGrid.get(structure);
  if (labs === undefined) {
    labs = findLabs(structure);
    labsByGrid.set(structure, labs);
  }
  for (const lab of labs) {
    const b = lab.bounds;
    if (tx >= b.x && ty >= b.y && tx < b.x + b.w && ty < b.y + b.h) return lab;
  }
  return null;
}

/**
 * Registers a lab laid out by its room system, so the painters and the system
 * read one object rather than two computed separately. A grid scanned before
 * any system registered is scanned from its floor tiles instead.
 */
export function registerPowerLab(structure: TileContent[][], lab: PowerLabLayout): void {
  const existing = labsByGrid.get(structure) ?? findLabs(structure);
  const others = existing.filter((l) => l.bounds.x !== lab.bounds.x || l.bounds.y !== lab.bounds.y);
  labsByGrid.set(structure, [...others, lab]);
}

function findLabs(structure: TileContent[][]): PowerLabLayout[] {
  const seen = new Set<number>();
  const labs: PowerLabLayout[] = [];
  for (let y = 0; y < structure.length; y++) {
    const row = structure[y];
    for (let x = 0; x < row.length; x++) {
      if (seen.has(labTileKey(x, y)) || !isLabFloor(row[x])) continue;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      const stack: TilePoint[] = [{ x, y }];
      seen.add(labTileKey(x, y));
      for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
        minX = Math.min(minX, next.x);
        maxX = Math.max(maxX, next.x);
        minY = Math.min(minY, next.y);
        maxY = Math.max(maxY, next.y);
        for (const n of labNeighbours(next)) {
          const key = labTileKey(n.x, n.y);
          if (seen.has(key) || !isLabFloor(structure[n.y]?.[n.x])) continue;
          seen.add(key);
          stack.push(n);
        }
      }
      const bounds = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
      const centre = {
        x: Math.floor(bounds.x + bounds.w / 2),
        y: Math.floor(bounds.y + bounds.h / 2),
      };
      labs.push(buildPowerLabLayout(structure, bounds, centre));
    }
  }
  return labs;
}
