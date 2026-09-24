import type { Point, Rect, RoomWall } from './roomDoorways';

/**
 * The Grotesque Spider's lab furniture, laid out against the wall its doorway
 * breaks through.
 *
 * Everything here is authored in the doorway's frame — `along` the entrance
 * wall from its middle, positive to the right of a crawler walking in, and
 * `depth` inward from that wall — so one layout serves all four sides. Nothing
 * reads a seed: the layout is collision, and collision must be the same room
 * on every floor that puts the doorway on the same wall.
 *
 * The room reads as a lab you walk into from the front: bench rows in the
 * entrance half where the scientist and the terminal are, specimen shelving
 * pressed to the side walls, and the far end — where the egg sac sat — given
 * over to the webbing and the cocooned staff.
 */

/** A spot in the doorway's frame. */
interface FramePoint {
  along: number;
  depth: number;
}

/** What the layout is laid around: the pieces the generator placed first. */
export interface SpiderLabLayoutInput {
  bounds: Rect;
  entranceWall: RoomWall;
  /** Every tile of the entrance doorway, on the room's own perimeter. */
  doorwayTiles: readonly Point[];
  scientistTile: Point;
  spiderEggTile: Point;
  lifeMachineTiles: readonly Point[];
}

export interface SpiderLabLayout {
  /** The terminal's anchor: the back-middle tile of its bench. */
  computerTile: Point;
  /** The terminal's whole bench, three wide and two deep. */
  computerTableTiles: Point[];
  benchTiles: Point[];
  shelfTiles: Point[];
  webTiles: Point[];
  cocoonTiles: Point[];
}

/** Where the terminal's bench stands: just past the doorway's approach, off the wall's middle. */
const COMPUTER_ALONG = 2;
const COMPUTER_DEPTH = 6;
/** The terminal bench's footprint in world tiles, relative to its anchor. */
const COMPUTER_TABLE_HALF_WIDTH = 1;
const COMPUTER_TABLE_DEPTH_TILES = 2;

/**
 * Bench rows, as depth from the entrance wall. Both sit in the entrance half
 * of the shorter room axis and past the terminal, so the doorway's approach,
 * the scientist's corner and the path between him and the terminal stay open.
 */
const NEAR_BENCH_ROW_DEPTH = 9;
const FAR_BENCH_ROW_DEPTH = 13;
const BENCH_ROW_DEPTHS: readonly number[] = [NEAR_BENCH_ROW_DEPTH, FAR_BENCH_ROW_DEPTH];
/**
 * Bench runs along each row. The gaps between runs are three tiles, never
 * fewer: a one- or two-tile slot between benches is a nook, and a nook is a
 * place her escape rule lets a crawler hide in.
 */
const BENCH_RUNS: ReadonlyArray<{ from: number; to: number }> = [
  { from: -13, to: -10 },
  { from: -6, to: -3 },
  { from: 3, to: 6 },
  { from: 10, to: 13 },
];

/** Shelving runs pressed to each side wall, as depth ranges. Gaps of three or more for the same reason. */
const SHELF_RUNS: ReadonlyArray<{ from: number; to: number }> = [
  { from: 5, to: 8 },
  { from: 13, to: 17 },
];

/** Radius, in tiles, of the web fanning out of each far corner. */
const WEB_CORNER_RADIUS_TILES = 7;
/** How ragged a corner web's edge is, in tiles either side of its radius. */
const WEB_EDGE_RAGGEDNESS_TILES = 1.5;
/** Rows of web laid along the far wall between the corners. */
const WEB_FAR_WALL_ROWS = 2;
/** No web within this many tiles of the doorway, measured tile to tile. */
const WEB_DOORWAY_CLEARANCE_TILES = 6;
/** No web on or right beside the egg sac: it sat in a cleared nest. */
const WEB_EGG_CLEARANCE_TILES = 1;

/** Cocooned staff, hung in the far half, as offsets from the far corners and the far wall. */
const COCOON_SPOTS: ReadonlyArray<{ side: 'min' | 'max' | 'mid'; inset: number; back: number }> = [
  { side: 'min', inset: 5, back: 2 },
  { side: 'max', inset: 5, back: 2 },
  { side: 'min', inset: 1, back: 7 },
  { side: 'max', inset: 1, back: 7 },
  { side: 'mid', inset: -6, back: 3 },
  { side: 'mid', inset: 7, back: 5 },
];

/** Furniture keeps this many tiles (Chebyshev) off anything the quest stands in the room. */
const FIXTURE_CLEARANCE_TILES = 2;
/** Furniture keeps this many tiles off the scientist, who wanders a little. */
const SCIENTIST_CLEARANCE_TILES = 3;

/** The doorway frame of a room: which way is in, and how far the room reaches each way. */
export interface DoorFrame {
  toWorld(point: FramePoint): Point;
  toFrame(tile: Point): FramePoint;
  alongMin: number;
  alongMax: number;
  depthMax: number;
}

/** The frame of a room whose doorway breaks through `wall`. */
export function doorFrame(bounds: Rect, wall: RoomWall): DoorFrame {
  const lastX = bounds.x + bounds.w - 1;
  const lastY = bounds.y + bounds.h - 1;
  const midX = bounds.x + Math.floor(bounds.w / 2);
  const midY = bounds.y + Math.floor(bounds.h / 2);
  const toWorld = ({ along, depth }: FramePoint): Point => {
    switch (wall) {
      case 'south':
        return { x: midX + along, y: lastY - depth };
      case 'north':
        return { x: midX - along, y: bounds.y + depth };
      case 'east':
        return { x: lastX - depth, y: midY - along };
      case 'west':
        return { x: bounds.x + depth, y: midY + along };
    }
  };
  const toFrame = ({ x, y }: Point): FramePoint => {
    switch (wall) {
      case 'south':
        return { along: x - midX, depth: lastY - y };
      case 'north':
        return { along: midX - x, depth: y - bounds.y };
      case 'east':
        return { along: midY - y, depth: lastX - x };
      case 'west':
        return { along: y - midY, depth: x - bounds.x };
    }
  };
  const corners = [toFrame({ x: bounds.x, y: bounds.y }), toFrame({ x: lastX, y: lastY })];
  return {
    toWorld,
    toFrame,
    alongMin: Math.min(...corners.map((c) => c.along)),
    alongMax: Math.max(...corners.map((c) => c.along)),
    depthMax: Math.max(...corners.map((c) => c.depth)),
  };
}

function chebyshev(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * A deterministic wobble in [-1, 1] from a tile's position in the frame, so a
 * web's edge is ragged but the same on every floor that has this doorway side.
 */
function edgeWobble(along: number, depth: number): number {
  const HASH_ALONG = 374761393;
  const HASH_DEPTH = 668265263;
  const HASH_MIX = 1274126177;
  const HASH_RANGE = 0x10000;
  const MIX_SHIFT = 13;
  const TOP_HALF_SHIFT = 16;
  let h = Math.imul(along, HASH_ALONG) ^ Math.imul(depth, HASH_DEPTH);
  h = Math.imul(h ^ (h >>> MIX_SHIFT), HASH_MIX);
  const unit = ((h >>> TOP_HALF_SHIFT) & (HASH_RANGE - 1)) / (HASH_RANGE - 1);
  return unit * 2 - 1;
}

/** Web tiles need this many web neighbours, orthogonally, to stay: fewer is a stray scrap. */
const WEB_MIN_NEIGHBOURS = 2;
const WEB_PRUNE_PASSES = 2;

/**
 * Drops web tiles left standing alone by a ragged edge. A lone tile of web
 * reads as a smudge rather than as spun silk, and slows a crawler on a spot
 * nothing around it warns of.
 */
function pruneWebStragglers(tiles: readonly Point[]): Point[] {
  let kept = [...tiles];
  for (let pass = 0; pass < WEB_PRUNE_PASSES; pass++) {
    const keys = new Set(kept.map((t) => `${t.x},${t.y}`));
    kept = kept.filter((t) => {
      const neighbours = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].filter(([dx, dy]) => keys.has(`${t.x + dx},${t.y + dy}`)).length;
      return neighbours >= WEB_MIN_NEIGHBOURS;
    });
  }
  return kept;
}

/** Lays out the lab's furniture, webbing and cocoons around the pieces already placed. */
export function layOutSpiderLab(input: SpiderLabLayoutInput): SpiderLabLayout {
  const frame = doorFrame(input.bounds, input.entranceWall);
  const inside = (tile: Point): boolean =>
    tile.x >= input.bounds.x &&
    tile.y >= input.bounds.y &&
    tile.x < input.bounds.x + input.bounds.w &&
    tile.y < input.bounds.y + input.bounds.h;

  const computerTile = frame.toWorld({ along: COMPUTER_ALONG, depth: COMPUTER_DEPTH });
  const computerTableTiles: Point[] = [];
  for (let dy = 0; dy < COMPUTER_TABLE_DEPTH_TILES; dy++) {
    for (let dx = -COMPUTER_TABLE_HALF_WIDTH; dx <= COMPUTER_TABLE_HALF_WIDTH; dx++) {
      computerTableTiles.push({ x: computerTile.x + dx, y: computerTile.y + dy });
    }
  }

  const fixtures = [...input.lifeMachineTiles, input.spiderEggTile, ...computerTableTiles];
  const clearOfFixtures = (tile: Point): boolean =>
    fixtures.every((fixture) => chebyshev(fixture, tile) > FIXTURE_CLEARANCE_TILES) &&
    chebyshev(input.scientistTile, tile) > SCIENTIST_CLEARANCE_TILES;

  const benchTiles: Point[] = [];
  for (const depth of BENCH_ROW_DEPTHS) {
    for (const run of BENCH_RUNS) {
      for (let along = run.from; along <= run.to; along++) {
        const tile = frame.toWorld({ along, depth });
        if (inside(tile) && clearOfFixtures(tile)) benchTiles.push(tile);
      }
    }
  }

  const shelfTiles: Point[] = [];
  for (const along of [frame.alongMin, frame.alongMax]) {
    for (const run of SHELF_RUNS) {
      for (let depth = run.from; depth <= run.to; depth++) {
        const tile = frame.toWorld({ along, depth });
        if (inside(tile) && clearOfFixtures(tile)) shelfTiles.push(tile);
      }
    }
  }

  const webTiles: Point[] = [];
  const nearDoorway = (tile: Point): boolean =>
    input.doorwayTiles.some((door) => chebyshev(door, tile) <= WEB_DOORWAY_CLEARANCE_TILES);
  const machineKeys = new Set(input.lifeMachineTiles.map((t) => `${t.x},${t.y}`));
  const farCorners: FramePoint[] = [
    { along: frame.alongMin, depth: frame.depthMax },
    { along: frame.alongMax, depth: frame.depthMax },
  ];
  for (let depth = 0; depth <= frame.depthMax; depth++) {
    for (let along = frame.alongMin; along <= frame.alongMax; along++) {
      const inCorner = farCorners.some((corner) => {
        const reach = Math.hypot(along - corner.along, depth - corner.depth);
        const edge = WEB_CORNER_RADIUS_TILES + edgeWobble(along, depth) * WEB_EDGE_RAGGEDNESS_TILES;
        return reach <= edge;
      });
      const onFarWall = depth > frame.depthMax - WEB_FAR_WALL_ROWS;
      if (!inCorner && !onFarWall) continue;
      const tile = frame.toWorld({ along, depth });
      if (!inside(tile) || nearDoorway(tile) || machineKeys.has(`${tile.x},${tile.y}`)) continue;
      if (chebyshev(tile, input.spiderEggTile) <= WEB_EGG_CLEARANCE_TILES) continue;
      webTiles.push(tile);
    }
  }

  const settledWebTiles = pruneWebStragglers(webTiles);

  const cocoonTiles: Point[] = [];
  for (const spot of COCOON_SPOTS) {
    const along =
      spot.side === 'min'
        ? frame.alongMin + spot.inset
        : spot.side === 'max'
          ? frame.alongMax - spot.inset
          : spot.inset;
    const tile = frame.toWorld({ along, depth: frame.depthMax - spot.back });
    const clearOfMachines = input.lifeMachineTiles.every((machine) => chebyshev(machine, tile) > 1);
    const clearOfEgg = chebyshev(input.spiderEggTile, tile) > FIXTURE_CLEARANCE_TILES;
    if (inside(tile) && clearOfMachines && clearOfEgg) cocoonTiles.push(tile);
  }

  return {
    computerTile,
    computerTableTiles,
    benchTiles,
    shelfTiles,
    webTiles: settledWebTiles,
    cocoonTiles,
  };
}
