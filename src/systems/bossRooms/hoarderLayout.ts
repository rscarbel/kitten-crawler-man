/**
 * Where the junk goes in the Hoarder's lair.
 *
 * One template, authored in the doorway frame (`along` the doorway's wall,
 * `depth` into the room) and rotated to whichever wall the room's doorway is
 * on. It is written against the room's own spans rather than as fixed offsets,
 * because a boss room is 22 by 18 and the frame's axes swap with the doorway's
 * side: a layout of fixed offsets fits the long axis or the short one, never
 * both. Nothing in it reads a random seed — collidable junk that moved between
 * floors would move the fight's cover with it.
 *
 * The shape of it: a ragged band of heaps along the walls, broken up so the
 * room's edge is a coastline rather than a wall; four island clusters a third
 * of the way in, far enough apart that she can circle them; teetering towers
 * beside the islands and the band; garbage bags in the open pockets; and her
 * mattress in the far third. Everything is dropped where it would crowd a
 * doorway's approach, the boss's spawn or the mattress, and any floor the
 * junk would wall off is filled in, so every open tile stays reachable.
 */

import type { GameMap } from '../../map/GameMap';
import { HOARD_BAG, HOARD_PILE, HOARD_TOWER, HOARDER_FLOOR, placeProp } from '../../map/tileTypes';
import {
  approachLaneTiles,
  findBossRoomDoorways,
  primaryDoorSide,
  rotateTemplate,
  spawnClearTiles,
  type BossRoomDoorway,
  type DoorSide,
  type TemplateOffset,
  type TilePoint,
  type TileRect,
} from './bossRoomLayout';

export type HoardKind = 'pile' | 'tower' | 'bag';

/** One piece of junk in the template, in the doorway frame. */
interface HoardOffset extends TemplateOffset {
  readonly kind: HoardKind;
  /** Which cluster of heaps it belongs to, for the flies; null for the band and the bags. */
  readonly cluster: number | null;
}

/** One piece of junk placed in the world. */
export interface HoardPlacement extends TilePoint {
  readonly kind: HoardKind;
  readonly cluster: number | null;
}

/** The lair as laid out on one floor. */
export interface HoarderLayout {
  readonly doorSide: DoorSide;
  readonly doorways: readonly BossRoomDoorway[];
  readonly spawn: TilePoint;
  readonly placements: readonly HoardPlacement[];
  /** Tiles of each island cluster, by cluster index: where the flies circle. */
  readonly clusters: ReadonlyArray<readonly TilePoint[]>;
  /** The mattress's top-left tile; it covers {@link NEST_TILES_WIDE} by {@link NEST_TILES_DEEP}. */
  readonly nest: TilePoint;
  /** A loop of open tiles around the islands, in order: the way round she can take. */
  readonly orbit: readonly TilePoint[];
}

export const NEST_TILES_WIDE = 3;
export const NEST_TILES_DEEP = 2;

/** The doorway frame's extent for one room: `along` runs lo..hi, `depth` 0..max. */
interface FrameSpans {
  readonly alongLo: number;
  readonly alongHi: number;
  readonly depthMax: number;
}

/**
 * The spans `rotateTemplate` maps onto a room's bounds for `side` — the ones
 * that land inside the room and no further.
 */
function frameSpans(side: DoorSide, bounds: TileRect): FrameSpans {
  const alongX = side === 'south' || side === 'north';
  const span = alongX ? bounds.w : bounds.h;
  const half = Math.floor(span / 2);
  const flipped = side === 'north' || side === 'east';
  return {
    alongLo: flipped ? -(span - 1 - half) : -half,
    alongHi: flipped ? half : span - 1 - half,
    depthMax: (alongX ? bounds.h : bounds.w) - 1,
  };
}

// ── The template ─────────────────────────────────────────────────────────────

/**
 * The band of heaps along each wall, sampled end to end: `2` is a heap two
 * deep, `1` one deep against the wall, `.` a gap. Read from the doorway's end
 * of each side wall toward the far wall, and left to right across the far and
 * doorway walls as a crawler in the doorway sees them. The side walls thin to
 * one deep where the islands stand, so the lane between an island and the
 * band stays wide enough to run.
 */
const FAR_WALL_BAND = '22.1122..1221.2211..22';
const LEFT_WALL_BAND = '2.1..11.221.1..1122.2';
const RIGHT_WALL_BAND = '1.21..1..1221..11.212';
const DOOR_WALL_BAND = '221.1............1.12';
const BAND_TWO_DEEP = '2';
const BAND_GAP = '.';

/** Islands sit this far out from the centre line, as a share of the wall's span. */
const ISLAND_ALONG_SHARE = 0.24;
/** The near and far rows of islands, as shares of the room's depth. */
const ISLAND_NEAR_DEPTH_SHARE = 0.3;
const ISLAND_FAR_DEPTH_SHARE = 0.69;
/** The refuges past the islands, as a share of the wall's span out from the centre line. */
const REFUGE_ALONG_SHARE = 0.38;

/** Each island's tiles, relative to its anchor, in the doorway frame. */
const ISLAND_SHAPES: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [
    [0, 0],
    [-1, 0],
    [0, 1],
  ],
  [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ],
  [
    [0, 0],
    [0, -1],
    [-1, 0],
  ],
  [
    [0, 0],
    [1, 0],
    [0, -1],
  ],
];

/** A tower stands this far from its island's anchor, on the side toward the wall. */
const TOWER_BESIDE_ISLAND_TILES = 2;

/** A tower beside each island, on its outer side, relative to the island's anchor. */
const ISLAND_TOWER_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-TOWER_BESIDE_ISLAND_TILES, 0],
  [TOWER_BESIDE_ISLAND_TILES, 1],
  [-1, 1],
  [TOWER_BESIDE_ISLAND_TILES, 0],
];

/** Towers against the band: along share, depth counted in from the far wall. */
const BAND_TOWERS: ReadonlyArray<{ readonly alongShare: number; readonly depthFromFar: number }> = [
  { alongShare: -0.08, depthFromFar: 2 },
];

/** Garbage bags in the open, as shares of the frame's spans. */
const BAG_SPOTS: ReadonlyArray<{ readonly alongShare: number; readonly depthShare: number }> = [
  { alongShare: -0.14, depthShare: 0.2 },
  { alongShare: 0.36, depthShare: 0.22 },
  { alongShare: -0.38, depthShare: 0.5 },
  { alongShare: 0.2, depthShare: 0.48 },
  { alongShare: 0.38, depthShare: 0.62 },
  { alongShare: 0.02, depthShare: 0.84 },
  { alongShare: 0.1, depthShare: 0.66 },
  { alongShare: 0.24, depthShare: 0.86 },
];

/**
 * Her mattress: in a far corner of the room, past the far islands. Far from
 * the door on purpose — she goes back to it whenever a crawler gives her room,
 * so it is where every fresh chase has to reach.
 */
const NEST_ALONG_SHARE = -0.34;
const NEST_MARGIN_TILES = 1;
const NEST_DEPTH_SHARE = 0.9;

function sampleBand(pattern: string, index: number, length: number): string {
  return pattern[Math.min(pattern.length - 1, Math.floor((index / length) * pattern.length))];
}

function hoarderTemplate(spans: FrameSpans): HoardOffset[] {
  const { alongLo, alongHi, depthMax } = spans;
  const alongSpan = alongHi - alongLo + 1;
  const depthSpan = depthMax + 1;
  const offsets: HoardOffset[] = [];
  const pile = (along: number, depth: number, cluster: number | null = null): void => {
    offsets.push({ along, depth, kind: 'pile', cluster });
  };

  for (let i = 0; i < alongSpan; i++) {
    const along = alongLo + i;
    const far = sampleBand(FAR_WALL_BAND, i, alongSpan);
    if (far !== BAND_GAP) pile(along, depthMax);
    if (far === BAND_TWO_DEEP) pile(along, depthMax - 1);
    const near = sampleBand(DOOR_WALL_BAND, i, alongSpan);
    if (near !== BAND_GAP) pile(along, 0);
    if (near === BAND_TWO_DEEP) pile(along, 1);
  }
  for (let depth = 1; depth < depthMax; depth++) {
    const left = sampleBand(LEFT_WALL_BAND, depth, depthSpan);
    if (left !== BAND_GAP) pile(alongLo, depth);
    if (left === BAND_TWO_DEEP) pile(alongLo + 1, depth);
    const right = sampleBand(RIGHT_WALL_BAND, depth, depthSpan);
    if (right !== BAND_GAP) pile(alongHi, depth);
    if (right === BAND_TWO_DEEP) pile(alongHi - 1, depth);
  }

  const islandAlong = Math.round(alongSpan * ISLAND_ALONG_SHARE);
  const anchors: Array<readonly [number, number]> = [
    [-islandAlong, Math.round(depthSpan * ISLAND_NEAR_DEPTH_SHARE)],
    [islandAlong, Math.round(depthSpan * ISLAND_NEAR_DEPTH_SHARE)],
    [-islandAlong, Math.round(depthSpan * ISLAND_FAR_DEPTH_SHARE)],
    [islandAlong, Math.round(depthSpan * ISLAND_FAR_DEPTH_SHARE)],
  ];
  anchors.forEach(([anchorAlong, anchorDepth], cluster) => {
    for (const [dAlong, dDepth] of ISLAND_SHAPES[cluster]) {
      pile(anchorAlong + dAlong, anchorDepth + dDepth, cluster);
    }
    const [towerAlong, towerDepth] = ISLAND_TOWER_OFFSETS[cluster];
    offsets.push({
      along: anchorAlong + towerAlong,
      depth: anchorDepth + towerDepth,
      kind: 'tower',
      cluster,
    });
  });
  for (const tower of BAND_TOWERS) {
    offsets.push({
      along: Math.round(alongSpan * tower.alongShare),
      depth: depthMax - tower.depthFromFar,
      kind: 'tower',
      cluster: null,
    });
  }
  for (const spot of BAG_SPOTS) {
    offsets.push({
      along: Math.round(alongSpan * spot.alongShare),
      depth: Math.round(depthSpan * spot.depthShare),
      kind: 'bag',
      cluster: null,
    });
  }
  return offsets;
}

// ── Laying it out ────────────────────────────────────────────────────────────

const tileKey = (tile: TilePoint): string => `${tile.x},${tile.y}`;

/** Floor kept clear around each doorway's approach lane, beyond the lane itself. */
const APPROACH_MARGIN_TILES = 1;
/** Floor kept clear around the spawn, past the shared minimum: she needs room to turn and run. */
const SPAWN_CLEAR_RADIUS_TILES = 3.5;

const CARDINALS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * The lair's layout for a room, computed from the map's doorways and nothing
 * else — so the game, the harness and the gates all get the same room.
 */
export function planHoarderLayout(grid: GameMap['structure'], bounds: TileRect): HoarderLayout {
  const doorways = findBossRoomDoorways(grid, bounds);
  const doorSide = primaryDoorSide(grid, bounds);
  const spans = frameSpans(doorSide, bounds);
  const spawn = {
    x: bounds.x + Math.floor(bounds.w / 2),
    y: bounds.y + Math.floor(bounds.h / 2),
  };

  const [nestCentre] = rotateTemplate(
    [
      {
        along: Math.round((spans.alongHi - spans.alongLo + 1) * NEST_ALONG_SHARE),
        depth: Math.round((spans.depthMax + 1) * NEST_DEPTH_SHARE),
      },
    ],
    doorSide,
    bounds,
  );
  const nest = {
    x: nestCentre.x - Math.floor(NEST_TILES_WIDE / 2),
    y: nestCentre.y - Math.floor(NEST_TILES_DEEP / 2),
  };

  const keepClear = new Set<string>();
  for (const doorway of doorways) {
    const lane = approachLaneTiles(doorway, bounds);
    for (const tile of lane) {
      for (let dy = -APPROACH_MARGIN_TILES; dy <= APPROACH_MARGIN_TILES; dy++) {
        for (let dx = -APPROACH_MARGIN_TILES; dx <= APPROACH_MARGIN_TILES; dx++) {
          keepClear.add(tileKey({ x: tile.x + dx, y: tile.y + dy }));
        }
      }
    }
    // The doorway's own wall row: nothing may sit in an opening.
    for (const tile of doorway.tiles) keepClear.add(tileKey(tile));
  }
  for (const tile of spawnClearTiles(spawn, SPAWN_CLEAR_RADIUS_TILES)) keepClear.add(tileKey(tile));
  // A tile of floor all round the mattress: its blanket hangs past its edge,
  // and junk standing hard against it reads as standing on the bed.
  for (let dy = -NEST_MARGIN_TILES; dy < NEST_TILES_DEEP + NEST_MARGIN_TILES; dy++) {
    for (let dx = -NEST_MARGIN_TILES; dx < NEST_TILES_WIDE + NEST_MARGIN_TILES; dx++)
      keepClear.add(tileKey({ x: nest.x + dx, y: nest.y + dy }));
  }

  const isRoomFloor = (tile: TilePoint): boolean => grid[tile.y]?.[tile.x]?.type === HOARDER_FLOOR;
  const taken = new Set<string>();
  const placements: HoardPlacement[] = [];
  for (const placed of rotateTemplate(hoarderTemplate(spans), doorSide, bounds)) {
    const key = tileKey(placed);
    if (keepClear.has(key) || taken.has(key) || !isRoomFloor(placed)) continue;
    taken.add(key);
    placements.push(placed);
  }

  fillWalledOffFloor(placements, taken, bounds, doorways, isRoomFloor);

  const clusters: TilePoint[][] = [];
  for (const placement of placements) {
    if (placement.cluster === null) continue;
    while (clusters.length <= placement.cluster) clusters.push([]);
    clusters[placement.cluster].push({ x: placement.x, y: placement.y });
  }

  return {
    doorSide,
    doorways,
    spawn,
    placements,
    clusters,
    nest,
    orbit: orbitAround(spans, doorSide, bounds, taken),
  };
}

/**
 * Turns any open floor the junk has sealed off into more junk. A pocket nobody
 * can walk into is a heap in all but name, and leaving it floor would put a
 * cockroach or a pool of bile somewhere no crawler can reach.
 */
function fillWalledOffFloor(
  placements: HoardPlacement[],
  taken: Set<string>,
  bounds: TileRect,
  doorways: readonly BossRoomDoorway[],
  isRoomFloor: (tile: TilePoint) => boolean,
): void {
  const inside = (tile: TilePoint): boolean =>
    tile.x >= bounds.x &&
    tile.y >= bounds.y &&
    tile.x < bounds.x + bounds.w &&
    tile.y < bounds.y + bounds.h;
  const open = (tile: TilePoint): boolean =>
    inside(tile) && isRoomFloor(tile) && !taken.has(tileKey(tile));
  const reached = new Set<string>();
  const frontier: TilePoint[] = [];
  for (const doorway of doorways) {
    for (const tile of doorway.tiles) {
      if (!open(tile) || reached.has(tileKey(tile))) continue;
      reached.add(tileKey(tile));
      frontier.push(tile);
    }
  }
  for (let next = frontier.pop(); next !== undefined; next = frontier.pop()) {
    for (const [dx, dy] of CARDINALS) {
      const neighbour = { x: next.x + dx, y: next.y + dy };
      const key = tileKey(neighbour);
      if (reached.has(key) || !open(neighbour)) continue;
      reached.add(key);
      frontier.push(neighbour);
    }
  }
  if (reached.size === 0) return;
  for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
    for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
      const tile = { x, y };
      if (!open(tile) || reached.has(tileKey(tile))) continue;
      taken.add(tileKey(tile));
      placements.push({ x, y, kind: 'pile', cluster: null });
    }
  }
}

/**
 * Open ground she can run for once cornered: four tiles between the islands —
 * in front of the near pair, beside each side pair, behind the far pair — in
 * order round the room, then four refuges out past the islands toward the
 * side walls, so a run for open ground can take her away from the middle as
 * well as round it. A tile the junk covers is left out rather than moved.
 */
function orbitAround(
  spans: FrameSpans,
  side: DoorSide,
  bounds: TileRect,
  taken: ReadonlySet<string>,
): TilePoint[] {
  const alongSpan = spans.alongHi - spans.alongLo + 1;
  const depthSpan = spans.depthMax + 1;
  const islandAlong = Math.round(alongSpan * ISLAND_ALONG_SHARE);
  const nearDepth = Math.round(depthSpan * ISLAND_NEAR_DEPTH_SHARE);
  const farDepth = Math.round(depthSpan * ISLAND_FAR_DEPTH_SHARE);
  const midDepth = Math.round((nearDepth + farDepth) / 2);
  const refugeAlong = Math.round(alongSpan * REFUGE_ALONG_SHARE);
  const ring: TemplateOffset[] = [
    { along: 0, depth: nearDepth },
    { along: islandAlong, depth: midDepth },
    { along: 0, depth: farDepth },
    { along: -islandAlong, depth: midDepth },
    { along: refugeAlong, depth: nearDepth },
    { along: refugeAlong, depth: farDepth },
    { along: -refugeAlong, depth: farDepth },
    { along: -refugeAlong, depth: nearDepth },
  ];
  return rotateTemplate(ring, side, bounds).filter((tile) => !taken.has(tileKey(tile)));
}

/**
 * Writes the layout's junk into the map, onto the lair's own bare floor only.
 * A tile holding anything else is left as the map has it — rubble, say, where
 * a scene rebuilt around the same map finds a tower already toppled. Returns
 * how many tiles were written.
 */
export function stampHoarderLayout(gameMap: GameMap, layout: HoarderLayout): number {
  let stamped = 0;
  for (const placement of layout.placements) {
    if (!gameMap.isWalkable(placement.x, placement.y)) continue;
    const tile = gameMap.structure[placement.y][placement.x];
    if (tile.type !== HOARDER_FLOOR) continue;
    placeProp(tile, HOARD_TYPE_OF[placement.kind]);
    // Its neighbours too: the floor beside a heap is painted darker for it.
    gameMap.markTileDirty(placement.x, placement.y);
    for (const [dx, dy] of CARDINALS) gameMap.markTileDirty(placement.x + dx, placement.y + dy);
    stamped++;
  }
  return stamped;
}

export const HOARD_TYPE_OF: Readonly<Record<HoardKind, number>> = {
  pile: HOARD_PILE,
  tower: HOARD_TOWER,
  bag: HOARD_BAG,
};
