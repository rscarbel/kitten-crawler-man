/**
 * Where the spider lab's field station keeps its kit.
 *
 * Pure geometry, like `safeRoomDecorLayout`: the generator stamps the result
 * into the grid, and nothing here touches a tile. The station is small, so the
 * one rule that matters is the one the safe room's decor learned the hard way —
 * no prop may cut any doorway, Dave or any floor tile off from the rest of
 * the room. Every placement is tested by flood fill and refused if it strands
 * a tile that was reachable before it.
 *
 * Nothing is random: the same room lays itself out the same way on every
 * rebuild, and the generator's random stream is not drawn from.
 */

import {
  LAB_STATION_BARRICADE,
  LAB_STATION_COT,
  LAB_STATION_FIRST_AID,
  LAB_STATION_HAZMAT_LOCKER,
  LAB_STATION_JERRY_CAN,
  LAB_STATION_LANTERN,
  LAB_STATION_WHITEBOARD,
} from './tileTypes';
import { guideAndBedTiles, SAFE_ROOM_THRESHOLD_DEPTH_TILES } from './safeRoomFixtures';

type Point = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

export interface LabStationProp {
  readonly x: number;
  readonly y: number;
  readonly type: number;
}

export interface LabStationLayoutInput {
  bounds: Rect;
  centre: Point;
  /** Whether the tile just outside the room's wall at `(x, y)` is open floor, which makes the perimeter tile beside it a doorway. */
  isOpenOutside: (x: number, y: number) => boolean;
}

/** Tiles of tipped benches and sandbags in the barricade. */
const BARRICADE_LENGTH_TILES = 2;

const CARDINAL_STEPS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

function keyOf(x: number, y: number): string {
  return `${x},${y}`;
}

/** Every perimeter tile of the room that a corridor opens onto. */
export function labStationDoorwayTiles(input: LabStationLayoutInput): Point[] {
  const { bounds, isOpenOutside } = input;
  const lastX = bounds.x + bounds.w - 1;
  const lastY = bounds.y + bounds.h - 1;
  const tiles: Point[] = [];
  const seen = new Set<string>();
  const note = (x: number, y: number): void => {
    if (seen.has(keyOf(x, y))) return;
    seen.add(keyOf(x, y));
    tiles.push({ x, y });
  };
  for (let x = bounds.x; x <= lastX; x++) {
    if (isOpenOutside(x, bounds.y - 1)) note(x, bounds.y);
    if (isOpenOutside(x, lastY + 1)) note(x, lastY);
  }
  for (let y = bounds.y; y <= lastY; y++) {
    if (isOpenOutside(bounds.x - 1, y)) note(bounds.x, y);
    if (isOpenOutside(lastX + 1, y)) note(lastX, y);
  }
  return tiles;
}

/**
 * The tiles of each doorway's band: the doorway tile and the tile inward of it,
 * on whichever walls it opens through.
 */
export function labStationThresholdTiles(input: LabStationLayoutInput): Point[] {
  const { bounds, isOpenOutside } = input;
  const lastX = bounds.x + bounds.w - 1;
  const lastY = bounds.y + bounds.h - 1;
  const tiles: Point[] = [];
  const seen = new Set<string>();
  const inside = (x: number, y: number): boolean =>
    x >= bounds.x && x <= lastX && y >= bounds.y && y <= lastY;
  const band = (x: number, y: number, inwardX: number, inwardY: number): void => {
    for (let depth = 0; depth < SAFE_ROOM_THRESHOLD_DEPTH_TILES; depth++) {
      const tx = x + inwardX * depth;
      const ty = y + inwardY * depth;
      if (!inside(tx, ty) || seen.has(keyOf(tx, ty))) continue;
      seen.add(keyOf(tx, ty));
      tiles.push({ x: tx, y: ty });
    }
  };
  for (let x = bounds.x; x <= lastX; x++) {
    if (isOpenOutside(x, bounds.y - 1)) band(x, bounds.y, 0, 1);
    if (isOpenOutside(x, lastY + 1)) band(x, lastY, 0, -1);
  }
  for (let y = bounds.y; y <= lastY; y++) {
    if (isOpenOutside(bounds.x - 1, y)) band(bounds.x, y, 1, 0);
    if (isOpenOutside(lastX + 1, y)) band(lastX, y, -1, 0);
  }
  return tiles;
}

class StationPlacer {
  private readonly blocked = new Set<string>();
  private readonly reserved = new Set<string>();
  readonly props: LabStationProp[] = [];
  private readonly baselineStranded: ReadonlySet<string>;

  constructor(
    private readonly bounds: Rect,
    private readonly anchors: ReadonlyArray<Point>,
    reserved: ReadonlyArray<Point>,
  ) {
    for (const tile of reserved) this.reserved.add(keyOf(tile.x, tile.y));
    this.baselineStranded = this.stranded();
  }

  /** Places `type` on the first candidate that is free and strands nothing, and returns it; null when none would take it. */
  placeFirst(candidates: ReadonlyArray<Point>, type: number): Point | null {
    for (const tile of candidates) {
      if (this.tryPlace(tile, type)) return tile;
    }
    return null;
  }

  tryPlace(tile: Point, type: number): boolean {
    const key = keyOf(tile.x, tile.y);
    if (!this.contains(tile.x, tile.y) || this.reserved.has(key) || this.blocked.has(key)) {
      return false;
    }
    this.blocked.add(key);
    if (this.strandsAnything()) {
      this.blocked.delete(key);
      return false;
    }
    this.props.push({ x: tile.x, y: tile.y, type });
    return true;
  }

  private contains(x: number, y: number): boolean {
    const { bounds } = this;
    return x >= bounds.x && x < bounds.x + bounds.w && y >= bounds.y && y < bounds.y + bounds.h;
  }

  private strandsAnything(): boolean {
    for (const key of this.stranded()) {
      if (!this.baselineStranded.has(key)) return true;
    }
    return false;
  }

  /**
   * Open tiles the first anchor cannot walk to. Seeded from one anchor so a
   * doorway sealed into a pocket of its own shows up as stranded rather than
   * as reachable by definition.
   */
  private stranded(): Set<string> {
    const walkable = (x: number, y: number): boolean =>
      this.contains(x, y) && !this.blocked.has(keyOf(x, y));
    const reached = new Set<string>();
    const start = this.anchors.length > 0 ? this.anchors[0] : null;
    if (start !== null && walkable(start.x, start.y)) {
      reached.add(keyOf(start.x, start.y));
      const frontier: Point[] = [start];
      for (let tile = frontier.pop(); tile !== undefined; tile = frontier.pop()) {
        for (const [dx, dy] of CARDINAL_STEPS) {
          const x = tile.x + dx;
          const y = tile.y + dy;
          const key = keyOf(x, y);
          if (reached.has(key) || !walkable(x, y)) continue;
          reached.add(key);
          frontier.push({ x, y });
        }
      }
    }
    const stranded = new Set<string>();
    const { bounds } = this;
    for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
      for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
        if (walkable(x, y) && !reached.has(keyOf(x, y))) stranded.add(keyOf(x, y));
      }
    }
    return stranded;
  }
}

/** Tiles of a room's row, west to east. */
function rowTiles(bounds: Rect, y: number): Point[] {
  const tiles: Point[] = [];
  for (let x = bounds.x; x < bounds.x + bounds.w; x++) tiles.push({ x, y });
  return tiles;
}

/** Tiles of a room's column, north to south. */
function columnTiles(bounds: Rect, x: number, fromY: number): Point[] {
  const tiles: Point[] = [];
  for (let y = fromY; y < bounds.y + bounds.h; y++) tiles.push({ x, y });
  return tiles;
}

/**
 * Lays out the station's kit. The cot takes the tile an ordinary safe room
 * gives its bed, beside Dave's; the two hangings take the north row; the locker,
 * the barricade, the jerry can and the lantern go against whichever walls the
 * corridors left free.
 */
export function planLabStation(input: LabStationLayoutInput): LabStationProp[] {
  const { bounds, centre } = input;
  const lastX = bounds.x + bounds.w - 1;
  const lastY = bounds.y + bounds.h - 1;
  const [dave, bedTile] = guideAndBedTiles({ bounds, centre });
  const doorways = labStationDoorwayTiles(input);
  const thresholds = labStationThresholdTiles(input);
  const placer = new StationPlacer(bounds, [...doorways, dave], [dave, ...doorways, ...thresholds]);

  placer.placeFirst(
    [bedTile, { x: bedTile.x, y: bedTile.y - 1 }, { x: bedTile.x, y: bedTile.y + 1 }],
    LAB_STATION_COT,
  );

  // The two hangings either side of the middle of the north row, so the
  // whiteboard is the first thing seen through either doorway.
  const northRow = rowTiles(bounds, bounds.y);
  const middleOut = [...northRow].sort(
    (a, b) => Math.abs(a.x - centre.x) - Math.abs(b.x - centre.x),
  );
  placer.placeFirst(middleOut, LAB_STATION_WHITEBOARD);
  placer.placeFirst(middleOut, LAB_STATION_FIRST_AID);

  // The tall locker in a north corner, where it hides nothing behind it.
  placer.placeFirst(
    [
      { x: lastX, y: bounds.y },
      { x: bounds.x, y: bounds.y },
      { x: lastX, y: bounds.y + 1 },
      { x: bounds.x, y: bounds.y + 1 },
    ],
    LAB_STATION_HAZMAT_LOCKER,
  );

  // The barricade along a side wall's south half: pushed aside once the team
  // stopped needing to hold the door.
  const southHalf = centre.y;
  const westRun = columnTiles(bounds, bounds.x, southHalf);
  const eastRun = columnTiles(bounds, lastX, southHalf);
  for (const run of [westRun, eastRun]) {
    let laid = 0;
    for (const tile of run) {
      if (laid >= BARRICADE_LENGTH_TILES) break;
      if (placer.tryPlace(tile, LAB_STATION_BARRICADE)) laid++;
    }
    if (laid > 0) break;
  }

  placer.placeFirst(
    [
      { x: bounds.x, y: lastY },
      { x: lastX, y: lastY },
      { x: bounds.x + 1, y: lastY },
      { x: lastX - 1, y: lastY },
    ],
    LAB_STATION_JERRY_CAN,
  );

  // The lantern beside the cot, so its pool falls where Dave rests.
  placer.placeFirst(
    [
      { x: bedTile.x + 1, y: bedTile.y },
      { x: bedTile.x, y: bedTile.y + 1 },
      { x: bedTile.x + 1, y: bedTile.y + 1 },
      { x: bedTile.x + 1, y: bedTile.y - 1 },
      { x: bedTile.x - 1, y: bedTile.y + 1 },
    ],
    LAB_STATION_LANTERN,
  );

  return placer.props;
}
