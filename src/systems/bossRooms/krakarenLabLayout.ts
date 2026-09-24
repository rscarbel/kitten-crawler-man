import { TILE_SIZE } from '../../core/constants';
import { KRAKAREN_BOSS_ROOM_FLOOR, KRAKAREN_WADE, type TileContent } from '../../map/tileTypes';
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
 * Where everything in Krakaren Clone's flooded clone lab goes.
 *
 * Worked out from the room's own geometry — its bounds, its centre and its
 * doorways — and nothing else, so the room system that stamps the props and the
 * tile painters that bake the floor arrive at the same lab without talking to
 * each other. No seed reaches any of it: which tile is water, where a vat
 * stands and where a cable runs are all collision or damage, and a floor's
 * seed must never move collision.
 *
 * Wall slots are authored in the frame of a crawler standing in the main
 * doorway looking in: the near wall is the doorway's, the far wall faces it,
 * and left and right are the crawler's. A slot that lands in any doorway's
 * approach lane is skipped for the next candidate, since a gauntlet room has a
 * way out as well as a way in and the far door can be on any wall.
 */
export interface KrakarenLabLayout {
  readonly bounds: TileRect;
  /** Her spawn tile, and the middle of the broken vat bed she squats in. */
  readonly centre: TilePoint;
  readonly doorSide: DoorSide;
  readonly doorways: readonly BossRoomDoorway[];
  /** Tiles every doorway's approach needs open and dry. */
  readonly approach: ReadonlySet<number>;
  /** Standing flood water from the start of the fight: the band round her and the two live puddles. */
  readonly wade: readonly TilePoint[];
  readonly vats: readonly LabVat[];
  readonly consoles: readonly TilePoint[];
  readonly livePuddles: readonly LivePuddle[];
  /** Painted drain grates; a guard tentacle coming up beside one comes up through it. */
  readonly drains: readonly TilePoint[];
}

/** A clone vat against the wall, and what it floods when it bursts. */
export interface LabVat {
  readonly tile: TilePoint;
  /** One step from the vat into the room. */
  readonly inward: TilePoint;
  /** The dry floor in front of it that turns to flood water when it bursts. */
  readonly floods: readonly TilePoint[];
}

/** A pool of flood water with a sparking cable run into it. */
export interface LivePuddle {
  readonly tiles: readonly TilePoint[];
  /** Floor tiles along the wall the cable is painted on, from the puddle outward. */
  readonly cable: readonly TilePoint[];
  /** Where the junction box hangs on the wall: the cable run's far end. */
  readonly junction: TilePoint;
  /** One step from the wall into the room, for art that mounts on the wall. */
  readonly inward: TilePoint;
}

/** Tile key for a lookup set; valid for any grid narrower than the stride. */
export const LAB_TILE_KEY_STRIDE = 65536;
export function labTileKey(x: number, y: number): number {
  return y * LAB_TILE_KEY_STRIDE + x;
}

/** Radius of the broken vat bed painted under her, in tiles. */
export const VAT_BED_RADIUS_TILES = 2.5;

/**
 * The flood band: an uneven ring round her. Its inner edge sits just past the
 * vat bed and its outer edge a little under halfway to the walls, so there is
 * dry floor on both sides of it and her three-tile lash reaches only just into it.
 */
const WADE_INNER_RADIUS_TILES = 3.5;
const WADE_OUTER_RADIUS_TILES = 6;
/** How far each edge of the band wanders, so it reads as spilled water rather than a compass ring. */
const WADE_INNER_WOBBLE_TILES = 0.4;
const WADE_OUTER_WOBBLE_TILES = 0.6;
const WADE_OUTER_RIPPLE_TILES = 0.3;
const WADE_INNER_LOBES = 3;
const WADE_OUTER_LOBES = 2;
const WADE_OUTER_RIPPLE_LOBES = 5;
const WADE_INNER_PHASE = 0.7;
const WADE_OUTER_PHASE = 1.9;

/**
 * The dry lanes through the band. One points at the main doorway so walking
 * straight in stays dry; the other two split the rest of the ring evenly.
 */
const CAUSEWAY_COUNT = 3;
/**
 * Half the causeway's width, measured square to its line. Over one tile so a
 * diagonal causeway still keeps two tiles side by side all the way across.
 */
export const CAUSEWAY_HALF_WIDTH_TILES = 1.2;

/** Vats wanted along the walls; the template carries spares for when a doorway takes a slot. */
const MAX_VATS = 8;
/** The fewest vats a lab may be left with once the doorways have taken their slots; gated. */
export const MIN_LAB_VATS = 6;
const MAX_CONSOLES = 3;

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

/** In preference order. The first two burst straight into the live puddles. */
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

/**
 * The live puddles' candidate positions on each side wall, in preference
 * order: the puddle's nearer row, counted back from the far wall or in from the
 * doorway's wall, and which way its cable runs from it. The later candidates
 * are for a room whose second door takes the earlier ones — a gauntlet room's
 * way out can be on either side wall.
 */
interface PuddleSlot {
  readonly depth: number;
  readonly fromFar: boolean;
  readonly cableTowardsFar: boolean;
}
const PUDDLE_SLOTS: readonly PuddleSlot[] = [
  { depth: 7, fromFar: true, cableTowardsFar: true },
  { depth: 10, fromFar: true, cableTowardsFar: true },
  { depth: 4, fromFar: false, cableTowardsFar: false },
  { depth: 5, fromFar: false, cableTowardsFar: false },
];
const PUDDLE_SIZE_TILES = 2;
/** The cable stops this far short of the wall it runs towards, so the junction box never sits in a corner. */
const CABLE_END_FROM_FAR = 2;
const CABLE_END_FROM_NEAR = 1;

/** Where the drain grates sit, as offsets from her centre in the doorway frame. */
const DRAIN_OFFSETS: readonly TilePoint[] = [
  { x: 3, y: 0 },
  { x: -3, y: 0 },
  { x: 0, y: 3 },
  { x: 0, y: -3 },
  { x: 4, y: 4 },
  { x: -4, y: 4 },
  { x: 4, y: -4 },
  { x: -4, y: -4 },
  { x: 7, y: 1 },
  { x: -7, y: -1 },
  { x: 1, y: 7 },
  { x: -1, y: -7 },
];

const CARDINALS: readonly TilePoint[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];
const FULL_TURN = Math.PI * 2;
const HALF_TILE = 0.5;
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
  return tile.type === KRAKAREN_BOSS_ROOM_FLOOR || tile.groundType === KRAKAREN_BOSS_ROOM_FLOOR;
}

/**
 * Lays out the lab in the room at `bounds`, whose boss stands at `centre`.
 *
 * Reads the grid only for the doorways and for which tiles are floor, so it
 * gives the same answer before and after the room's props are stamped.
 */
export function buildKrakarenLabLayout(
  structure: TileContent[][],
  bounds: TileRect,
  centre: TilePoint,
): KrakarenLabLayout {
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
  // Props keep a tile apart so each reads as its own object; a vat may still
  // stand right beside a live puddle, which is how a burst floods into one.
  const props = new Set<number>();
  const touchesProp = (t: TilePoint): boolean => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (props.has(labTileKey(t.x + dx, t.y + dy))) return true;
      }
    }
    return false;
  };

  const livePuddles = placeLivePuddles(doorSide, frame, bounds, isFree, claim);

  const vats: LabVat[] = [];
  const vatTiles: TilePoint[] = [];
  for (const slot of VAT_SLOTS) {
    if (vatTiles.length >= MAX_VATS) break;
    const { along, depth } = slotToFrame(slot, frame);
    const tile = frameTile(along, depth, doorSide, bounds);
    if (tile === null || !isFree(tile) || touchesProp(tile)) continue;
    const inward = inwardFrom(tile, bounds);
    const front = { x: tile.x + inward.x, y: tile.y + inward.y };
    if (!isFree(front)) continue;
    claim(tile);
    props.add(labTileKey(tile.x, tile.y));
    vatTiles.push(tile);
    vats.push({ tile, inward, floods: [] });
  }

  const consoles: TilePoint[] = [];
  for (const slot of CONSOLE_SLOTS) {
    if (consoles.length >= MAX_CONSOLES) break;
    const { along, depth } = slotToFrame(slot, frame);
    const tile = frameTile(along, depth, doorSide, bounds);
    if (tile === null || !isFree(tile) || touchesProp(tile)) continue;
    const inward = inwardFrom(tile, bounds);
    if (!isFree({ x: tile.x + inward.x, y: tile.y + inward.y })) continue;
    claim(tile);
    props.add(labTileKey(tile.x, tile.y));
    consoles.push(tile);
  }

  const puddleKeys = new Set<number>();
  for (const puddle of livePuddles) {
    for (const t of puddle.tiles) puddleKeys.add(labTileKey(t.x, t.y));
  }
  const bandKeys = new Set<number>();
  const band = wadeBand(bounds, centre, doorways, doorSide).filter((t) => {
    const free = isFree(t) || puddleKeys.has(labTileKey(t.x, t.y));
    if (free) bandKeys.add(labTileKey(t.x, t.y));
    return free && !puddleKeys.has(labTileKey(t.x, t.y));
  });
  const wade = [...band, ...livePuddles.flatMap((p) => p.tiles)];
  const wet = new Set(wade.map((t) => labTileKey(t.x, t.y)));

  const floodedByBursts = new Set<number>();
  const vatsWithFloods = vats.map((vat) => {
    const floods = vatFloodTiles(vat).filter((t) => {
      const key = labTileKey(t.x, t.y);
      const dry = isFree(t) && !wet.has(key) && !floodedByBursts.has(key);
      if (dry) floodedByBursts.add(key);
      return dry;
    });
    return { ...vat, floods };
  });

  const drains: TilePoint[] = [];
  for (const offset of DRAIN_OFFSETS) {
    const tile = frameTile(
      frameAlongOf(centre, doorSide, bounds) + offset.x,
      frameDepthOf(centre, doorSide, bounds) + offset.y,
      doorSide,
      bounds,
    );
    if (tile === null || !isFree(tile)) continue;
    if (onRoomEdge(tile, bounds)) continue;
    if (Math.hypot(tile.x - centre.x, tile.y - centre.y) <= VAT_BED_RADIUS_TILES) continue;
    if (floodedByBursts.has(labTileKey(tile.x, tile.y))) continue;
    drains.push(tile);
  }

  return {
    bounds,
    centre,
    doorSide,
    doorways,
    approach,
    wade,
    vats: vatsWithFloods,
    consoles,
    livePuddles,
    drains,
  };
}

function onRoomEdge(t: TilePoint, bounds: TileRect): boolean {
  return (
    t.x === bounds.x ||
    t.y === bounds.y ||
    t.x === bounds.x + bounds.w - 1 ||
    t.y === bounds.y + bounds.h - 1
  );
}

/** The doorway-frame `along` of a world tile, found by search since the frame's inverse is not exported. */
function frameAlongOf(tile: TilePoint, side: DoorSide, bounds: TileRect): number {
  return frameCoordinatesOf(tile, side, bounds).along;
}

function frameDepthOf(tile: TilePoint, side: DoorSide, bounds: TileRect): number {
  return frameCoordinatesOf(tile, side, bounds).depth;
}

function frameCoordinatesOf(
  tile: TilePoint,
  side: DoorSide,
  bounds: TileRect,
): { along: number; depth: number } {
  const reach = Math.max(bounds.w, bounds.h);
  for (let depth = 0; depth <= reach; depth++) {
    for (let along = -reach; along <= reach; along++) {
      const placed = frameTile(along, depth, side, bounds);
      if (placed !== null && placed.x === tile.x && placed.y === tile.y) return { along, depth };
    }
  }
  return { along: 0, depth: 0 };
}

/**
 * The two live puddles: one on each side wall, two tiles square and hard
 * against it, with the cable running from the puddle along the wall towards
 * the far wall and the junction box at its end.
 */
function placeLivePuddles(
  side: DoorSide,
  frame: DoorFrame,
  bounds: TileRect,
  isFree: (t: TilePoint) => boolean,
  claim: (t: TilePoint) => void,
): LivePuddle[] {
  const puddles: LivePuddle[] = [];
  for (const wall of ['left', 'right'] as const) {
    const wallAlong = wall === 'left' ? frame.alongMin : frame.alongMax;
    const inwardAlong = wall === 'left' ? 1 : -1;
    for (const slot of PUDDLE_SLOTS) {
      const nearDepth = slot.fromFar ? frame.depthMax - slot.depth : slot.depth;
      const tiles: TilePoint[] = [];
      for (let d = 0; d < PUDDLE_SIZE_TILES; d++) {
        for (let a = 0; a < PUDDLE_SIZE_TILES; a++) {
          const t = frameTile(wallAlong + a * inwardAlong, nearDepth + d, side, bounds);
          if (t !== null) tiles.push(t);
        }
      }
      const cable: TilePoint[] = [];
      const cableDepths = slot.cableTowardsFar
        ? depthRun(nearDepth + PUDDLE_SIZE_TILES, frame.depthMax - CABLE_END_FROM_FAR)
        : depthRun(nearDepth - 1, CABLE_END_FROM_NEAR);
      for (const depth of cableDepths) {
        const t = frameTile(wallAlong, depth, side, bounds);
        if (t !== null) cable.push(t);
      }
      const complete = tiles.length === PUDDLE_SIZE_TILES * PUDDLE_SIZE_TILES && cable.length > 0;
      if (!complete || ![...tiles, ...cable].every(isFree)) continue;
      for (const t of [...tiles, ...cable]) claim(t);
      const junction = cable[cable.length - 1];
      puddles.push({ tiles, cable, junction, inward: inwardFrom(junction, bounds) });
      break;
    }
  }
  return puddles;
}

/** Every depth from `from` to `to` inclusive, stepping whichever way `to` lies. */
function depthRun(from: number, to: number): number[] {
  const step = to >= from ? 1 : -1;
  const run: number[] = [];
  for (let d = from; step > 0 ? d <= to : d >= to; d += step) run.push(d);
  return run;
}

/**
 * The tiles a burst floods: straight out from the vat two deep, and the tiles
 * either side of the first step, which is the spray fanning out.
 */
function vatFloodTiles(vat: LabVat): TilePoint[] {
  const { tile, inward } = vat;
  const lateral = { x: inward.y, y: inward.x };
  const first = { x: tile.x + inward.x, y: tile.y + inward.y };
  return [
    first,
    { x: first.x + inward.x, y: first.y + inward.y },
    { x: first.x + lateral.x, y: first.y + lateral.y },
    { x: first.x - lateral.x, y: first.y - lateral.y },
  ];
}

/**
 * The flood band's tiles, before props and doorways take their share. Uneven
 * by a fixed shape in her own angle, so it is the same band on every floor.
 */
function wadeBand(
  bounds: TileRect,
  centre: TilePoint,
  doorways: readonly BossRoomDoorway[],
  side: DoorSide,
): TilePoint[] {
  const door = doorways.length > 0 ? doorways[0].tile : doorFallback(side, bounds, centre);
  const causewayBearing = Math.atan2(door.y - centre.y, door.x - centre.x);
  const causeways: TilePoint[] = [];
  for (let i = 0; i < CAUSEWAY_COUNT; i++) {
    const bearing = causewayBearing + (i * FULL_TURN) / CAUSEWAY_COUNT;
    causeways.push({ x: Math.cos(bearing), y: Math.sin(bearing) });
  }
  const tiles: TilePoint[] = [];
  for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
    for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
      const dx = x - centre.x;
      const dy = y - centre.y;
      const radius = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      const inner =
        WADE_INNER_RADIUS_TILES +
        WADE_INNER_WOBBLE_TILES * Math.sin(WADE_INNER_LOBES * angle + WADE_INNER_PHASE);
      const outer =
        WADE_OUTER_RADIUS_TILES +
        WADE_OUTER_WOBBLE_TILES * Math.sin(WADE_OUTER_LOBES * angle + WADE_OUTER_PHASE) +
        WADE_OUTER_RIPPLE_TILES * Math.sin(WADE_OUTER_RIPPLE_LOBES * angle);
      if (radius < inner || radius > outer) continue;
      if (causeways.some((c) => isOnCauseway(dx, dy, c))) continue;
      tiles.push({ x, y });
    }
  }
  return tiles;
}

/** True when the tile offset `(dx, dy)` from her lies on the causeway heading `direction`. */
export function isOnCauseway(dx: number, dy: number, direction: TilePoint): boolean {
  const along = dx * direction.x + dy * direction.y;
  if (along <= 0) return false;
  const across = Math.abs(dx * direction.y - dy * direction.x);
  return across <= CAUSEWAY_HALF_WIDTH_TILES;
}

function doorFallback(side: DoorSide, bounds: TileRect, centre: TilePoint): TilePoint {
  switch (side) {
    case 'south':
      return { x: centre.x, y: bounds.y + bounds.h };
    case 'north':
      return { x: centre.x, y: bounds.y - 1 };
    case 'east':
      return { x: bounds.x + bounds.w, y: centre.y };
    case 'west':
      return { x: bounds.x - 1, y: centre.y };
  }
}

/** Tiles 4-connected to `tile`. */
export function labNeighbours(tile: TilePoint): TilePoint[] {
  return CARDINALS.map((c) => ({ x: tile.x + c.x, y: tile.y + c.y }));
}

/** A tile's centre, in tiles. */
export function labTileCentre(tile: TilePoint): TilePoint {
  return { x: tile.x + HALF_TILE, y: tile.y + HALF_TILE };
}

// ── Finding a lab from the grid alone ────────────────────────────────────────

/**
 * Every lab on a grid, found once per grid. The tile painters are handed a
 * grid and a position and nothing else, so this is how the floor's vat bed,
 * drains and cable runs find the room they belong to.
 */
const labsByGrid = new WeakMap<TileContent[][], readonly KrakarenLabLayout[]>();

/** The lab a tile belongs to, or null when the tile is in no lab. */
export function krakarenLabAt(
  structure: TileContent[][],
  tx: number,
  ty: number,
): KrakarenLabLayout | null {
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
export function registerKrakarenLab(structure: TileContent[][], lab: KrakarenLabLayout): void {
  const existing = labsByGrid.get(structure) ?? findLabs(structure);
  const others = existing.filter((l) => l.bounds.x !== lab.bounds.x || l.bounds.y !== lab.bounds.y);
  labsByGrid.set(structure, [...others, lab]);
}

function findLabs(structure: TileContent[][]): KrakarenLabLayout[] {
  const seen = new Set<number>();
  const labs: KrakarenLabLayout[] = [];
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
      labs.push(buildKrakarenLabLayout(structure, bounds, centre));
    }
  }
  return labs;
}

/** Whether the world pixel `(px, py)` stands in the lab's flood water. */
export function isLabFloodAtPx(structure: TileContent[][], px: number, py: number): boolean {
  const tileX = Math.floor(px / TILE_SIZE);
  const tileY = Math.floor(py / TILE_SIZE);
  return structure[tileY]?.[tileX]?.type === KRAKAREN_WADE;
}
