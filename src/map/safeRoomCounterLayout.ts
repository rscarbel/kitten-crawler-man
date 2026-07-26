/**
 * Where a safe room's service counter goes, and how it gets written into the map.
 *
 * Planning is separated from stamping because two callers need the geometry and
 * only one of them may touch tiles: `stampSafeRoomCounters` writes the run, while
 * `safeRoomAnchorTiles` needs the same tiles to keep furniture and townsfolk out
 * of the galley, and runs on maps that may not have been stamped yet.
 *
 * The run is always horizontal, against the room's **north** wall, and always
 * three rows deep:
 *
 *     ▓▓▓▓▓▓▓▓   back bench, against the wall   (not walkable)
 *     ▓······▓   galley strip + side returns    (walkable, sealed)
 *     ▓▓▓▓▓▓▓▓   front bar, the player's side   (not walkable)
 *
 * North specifically, and not "whichever wall is furthest from a door": the
 * game's oblique projection has a fixed viewpoint to the south, so props are
 * drawn as though seen slightly from the front. On the north wall the Bopca is
 * *behind* its counter and the bar's own front face crops it at the waist, which
 * is the entire visual idea. On the south wall the Bopca would stand in front of
 * the bar it is meant to be serving across, and no amount of mirroring fixes
 * that — a mirrored face is not a face. The door logic therefore picks the run's
 * columns rather than its wall.
 *
 * The side returns are what make the strip unreachable: the player, the
 * companion and every mob are all stopped by tile walkability alone, so the
 * galley needs no special-casing anywhere else in the game.
 *
 * The plan's `SAFE_ROOM_COUNTER_MIN_ROOM_WIDTH` has no equivalent here: the run's
 * length is taken from the widest door-free span of columns, not from the room's
 * width, so a wide room with a cut-up wall gets a short counter and there is no
 * single width above which a full-length run is guaranteed.
 */

import type { GameMap } from './GameMap';
import { mordecaiAndBedTiles } from './safeRoomFixtures';
import {
  SAFE_ROOM_COUNTER,
  SAFE_ROOM_COUNTER_BACK,
  SAFE_ROOM_GALLEY_FLOOR,
  placeProp,
} from './tileTypes';

/** Longest counter run laid in a room wide enough to take it. */
const SAFE_ROOM_COUNTER_MAX_TILES = 6;
/**
 * Shortest run worth laying. Two of the tiles are side returns, so this is also
 * the point below which there would be no galley strip left for the Bopca to
 * stand on — hence three rather than the two a purely visual minimum would want.
 */
const SAFE_ROOM_COUNTER_MIN_TILES = 3;
/** Columns left clear between the run and each of the room's side walls. */
const COUNTER_WALL_MARGIN_TILES = 1;
/** Rows the run occupies: back bench, galley strip, front bar. */
const SAFE_ROOM_COUNTER_DEPTH_TILES = 3;
/** Columns east of the Bopca that a finished dish is set down on. */
export const DISH_COLUMN_OFFSET_FROM_BOPCA = 1;

export interface SafeRoomCounterLayout {
  /**
   * Index into `map.safeRooms` of the room this counter belongs to.
   *
   * Carried explicitly because a room can be skipped: the layout list is not
   * index-aligned with `map.safeRooms`, and treating it as though it were put
   * every Bopca after a skipped room in the wrong room.
   */
  safeRoomIndex: number;
  /** The room's own bounds, so consumers need not re-look it up to test presence. */
  roomBounds: { x: number; y: number; w: number; h: number };
  /** The front bar, west to east — the tiles the player orders across. */
  counterTiles: ReadonlyArray<{ x: number; y: number }>;
  /** The back bench against the wall. */
  backTiles: ReadonlyArray<{ x: number; y: number }>;
  /** The walkable strip between them, excluding both side returns. */
  galleyTiles: ReadonlyArray<{ x: number; y: number }>;
  /** Where the Bopca stands: the middle of the galley strip. */
  bopcaHomeTile: { x: number; y: number };
  /**
   * The front-bar tile a finished dish is set down on: one column to the side of
   * the Bopca rather than directly in front of it.
   *
   * A Bopca is dwarf-height, so its face clears the slab by only a few pixels —
   * a bowl set down in its own column landed squarely over the mouth and beard.
   */
  dishTile: { x: number; y: number };
}

/** A room too shallow to hold a three-row run plus a walkway is skipped. */
const MIN_ROOM_HEIGHT_FOR_COUNTER = SAFE_ROOM_COUNTER_DEPTH_TILES + 2;
/**
 * Narrowest room that can hold a run at all: the shortest run plus a clear column
 * against each side wall.
 *
 * Rooms narrower than this get no counter. The plan asked for a two-tile counter
 * instead of a skip, but two tiles are both side returns and leave the Bopca
 * nowhere to stand — and no generator produces a safe room this narrow anyway
 * (`DungeonGenerator` floors at 7 tiles, and both scripted safe rooms are wider),
 * so this is a guard rather than a live branch.
 */
const MIN_ROOM_WIDTH_FOR_COUNTER = SAFE_ROOM_COUNTER_MIN_TILES + COUNTER_WALL_MARGIN_TILES * 2;

/**
 * Rows south of the north wall the run may start on, in order of preference.
 *
 * Against the wall reads best — the bench's tiled backsplash passes for wall
 * tiling — but a north wall can be so cut up by doorways that no three adjacent
 * columns are free of them. Dropping the run one row south solves that outright:
 * the doorways then open onto the row *above* the counter, which stays floor, so
 * door columns stop constraining the run at all. Every safe room gets a Bopca, so
 * there has to be a second option.
 */
const RUN_ROW_OFFSETS: ReadonlyArray<number> = [0, 1];

/**
 * Columns of the room's north wall that open onto something walkable — the
 * doorways the run must not cover.
 *
 * Read with `isWalkableIgnoringPermanent` for the reason given on that method:
 * these maps are reused across scene reconstructions, and the permanent block
 * mask only ever accumulates, so consulting it would let the chosen columns
 * drift between two passes over the same room.
 */
function doorColumnsOnNorthWall(
  map: GameMap,
  bounds: { x: number; y: number; w: number; h: number },
): Set<number> {
  const columns = new Set<number>();
  for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
    if (map.isWalkableIgnoringPermanent(x, bounds.y - 1)) columns.add(x);
  }
  return columns;
}

/**
 * The widest run of columns inside the room's usable span that avoids every
 * blocked column, as `{ x0, width }`.
 *
 * Doorway columns are blocked because a run covering one would seal that
 * entrance: the back bench is solid, so the tile the corridor opens into would
 * stop being walkable and the room could lose its only way in. Avoiding those
 * columns entirely — rather than merely maximising distance from them — is what
 * makes that impossible.
 */
function widestFreeSpan(
  bounds: { x: number; y: number; w: number; h: number },
  blockedColumns: ReadonlySet<number>,
): { x0: number; width: number } {
  const firstX = bounds.x + COUNTER_WALL_MARGIN_TILES;
  const lastX = bounds.x + bounds.w - 1 - COUNTER_WALL_MARGIN_TILES;

  let best = { x0: firstX, width: 0 };
  let spanStart = firstX;
  for (let x = firstX; x <= lastX + 1; x++) {
    const isBlocked = x > lastX || blockedColumns.has(x);
    if (!isBlocked) continue;
    const width = x - spanStart;
    if (width > best.width) best = { x0: spanStart, width };
    spanStart = x + 1;
  }
  return best;
}

function layoutForRun(
  safeRoomIndex: number,
  bounds: { x: number; y: number; w: number; h: number },
  backRow: number,
  x0: number,
  runWidth: number,
): SafeRoomCounterLayout {
  const galleyRow = backRow + 1;
  const frontRow = backRow + 2;
  const x1 = x0 + runWidth - 1;

  const counterTiles: Array<{ x: number; y: number }> = [];
  const backTiles: Array<{ x: number; y: number }> = [];
  const galleyTiles: Array<{ x: number; y: number }> = [];
  for (let x = x0; x <= x1; x++) {
    counterTiles.push({ x, y: frontRow });
    backTiles.push({ x, y: backRow });
    // The run's first and last columns are the side returns that seal the
    // strip, so they are counter rather than galley.
    if (x === x0 || x === x1) counterTiles.push({ x, y: galleyRow });
    else galleyTiles.push({ x, y: galleyRow });
  }

  const home = galleyTiles[Math.floor(galleyTiles.length / 2)];
  // The Bopca stands on a galley tile, and the galley never reaches the run's
  // last column — so the column east of it is always part of the front bar.
  const dishColumn = home.x + DISH_COLUMN_OFFSET_FROM_BOPCA;
  return {
    safeRoomIndex,
    roomBounds: bounds,
    counterTiles,
    backTiles,
    galleyTiles,
    bopcaHomeTile: home,
    dishTile: { x: dishColumn, y: frontRow },
  };
}

/**
 * Plan a counter for every safe room on the map, without touching a tile.
 *
 * Pure and deterministic for a given map, so it can be called repeatedly — once
 * to stamp, once per interior-occupant pass — and always answer the same thing.
 */
export function planSafeRoomCounters(map: GameMap): ReadonlyArray<SafeRoomCounterLayout> {
  const layouts: SafeRoomCounterLayout[] = [];
  for (let safeRoomIndex = 0; safeRoomIndex < map.safeRooms.length; safeRoomIndex++) {
    const safeRoom = map.safeRooms[safeRoomIndex];
    const bounds = safeRoom.bounds;
    if (bounds.h < MIN_ROOM_HEIGHT_FOR_COUNTER || bounds.w < MIN_ROOM_WIDTH_FOR_COUNTER) continue;

    const doorColumns = doorColumnsOnNorthWall(map, bounds);
    const fixtureTiles = mordecaiAndBedTiles(safeRoom);

    for (const rowOffset of RUN_ROW_OFFSETS) {
      const backRow = bounds.y + rowOffset;
      // Leave at least one row of floor south of the run for the player to stand on.
      const lastRunRow = backRow + SAFE_ROOM_COUNTER_DEPTH_TILES - 1;
      if (lastRunRow >= bounds.y + bounds.h - 1) continue;

      const blockedColumns = new Set<number>(rowOffset === 0 ? doorColumns : []);
      // Mordecai and the bed own their own tiles. Only their *columns* are out of
      // bounds, and only when the run's rows would actually reach their row —
      // blocking the whole row instead cost narrow rooms their counter entirely.
      for (const tile of fixtureTiles) {
        if (tile.y >= backRow && tile.y <= lastRunRow) blockedColumns.add(tile.x);
      }

      const span = widestFreeSpan(bounds, blockedColumns);
      if (span.width < SAFE_ROOM_COUNTER_MIN_TILES) continue;

      const runWidth = Math.min(SAFE_ROOM_COUNTER_MAX_TILES, span.width);
      // Centre the run inside the span it was given, so a short run against a wide
      // wall does not sit hard against the doorway that bounded the span.
      const x0 = span.x0 + Math.floor((span.width - runWidth) / 2);
      layouts.push(layoutForRun(safeRoomIndex, bounds, backRow, x0, runWidth));
      break;
    }
  }
  return layouts;
}

/**
 * Write every safe room's counter into the map and return the layouts.
 *
 * Safe to run more than once on the same map: `planSafeRoomCounters` is
 * deterministic, so a second pass targets the same tiles, and `placeProp`
 * records the floor it replaced with `??=` so re-stamping cannot record the
 * counter as its own ground. The permanent block mask is deliberately untouched
 * — the counter blocks by tile type, which is rebuilt from the structure.
 */
export function stampSafeRoomCounters(map: GameMap): ReadonlyArray<SafeRoomCounterLayout> {
  const layouts = planSafeRoomCounters(map);
  for (const layout of layouts) {
    stampTiles(map, layout.backTiles, SAFE_ROOM_COUNTER_BACK);
    stampTiles(map, layout.counterTiles, SAFE_ROOM_COUNTER);
    stampTiles(map, layout.galleyTiles, SAFE_ROOM_GALLEY_FLOOR);
  }
  return layouts;
}

/**
 * A standalone counter run as a 3×`runTiles` grid of tile types, for the art
 * review harnesses (`?bopca` and `scripts/render-bopca.ts`).
 *
 * They need this rather than hand-written neighbour flags: the front bar's end
 * caps and the side returns are chosen by looking at neighbours, and a harness
 * that fabricates those flags shows a counter the game never draws. That is
 * exactly how the end-cap detail sat broken in-game while the preview looked fine.
 */
export function counterRunStructure(runTiles: number): Array<Array<{ type: number }>> {
  const lastColumn = runTiles - 1;
  return [
    Array.from({ length: runTiles }, () => ({ type: SAFE_ROOM_COUNTER_BACK })),
    Array.from({ length: runTiles }, (_unused, column) => ({
      type: column === 0 || column === lastColumn ? SAFE_ROOM_COUNTER : SAFE_ROOM_GALLEY_FLOOR,
    })),
    Array.from({ length: runTiles }, () => ({ type: SAFE_ROOM_COUNTER })),
  ];
}

/** Row indices within `counterRunStructure`'s grid. */
export const COUNTER_RUN_BACK_ROW = 0;
export const COUNTER_RUN_GALLEY_ROW = 1;
export const COUNTER_RUN_FRONT_ROW = 2;

function stampTiles(
  map: GameMap,
  tiles: ReadonlyArray<{ x: number; y: number }>,
  type: number,
): void {
  // Unchecked indexing is safe here: every tile came from a safe room's own
  // bounds, and a room's bounds are carved inside the grid.
  for (const tile of tiles) {
    placeProp(map.structure[tile.y][tile.x], type);
    map.markTileDirty(tile.x, tile.y);
  }
}
