/**
 * A small hand-laid dungeon that holds every wall shape at least once, for
 * reviewing the wall painter (`?tiles`, Walls view, and
 * `scripts/render-wall-cases.ts`) and for the wall gate.
 *
 * What it covers, and where:
 * - a room's inner (back) corners and outer (front) corners — every room;
 * - a corridor leaving through a north wall — the top of the first room;
 * - a corridor leaving through a side wall — the first room's east side;
 * - a one-tile pillar and a two-tile stub standing in a room;
 * - a wall one tile thick between two rooms, north–south (a compressed face) and
 *   east–west (a sliver each side);
 * - a one-tile-wide spur standing on a room's south wall, open at its north end —
 *   the third room — and one standing on the wall whose face looks into the
 *   rooms below, so its foot is that face's upper tile — the room below the first;
 * - a wall two tiles thick with a corridor through it;
 * - a crawler sign hung on a face above a corridor.
 */

import { CRAWLER_SIGN, FloorTypeValue, VOID_TYPE, type TileContent } from '../tileTypes';

/**
 * `#` wall, `.` and `,` two floors, `S` a sign plaque, `~` the void border — three
 * tiles of it, so nothing in the fixture sits where the light gives out at the
 * map's edge.
 */
const WALL_CASE_ROWS: ReadonlyArray<string> = [
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~##################################~~~',
  '~~~######.###########################~~~',
  '~~~######.###########################~~~',
  '~~~##..........####......############~~~',
  '~~~##..........####......############~~~',
  '~~~##...#......####......#####S######~~~',
  '~~~##..........................######~~~',
  '~~~##.....##...####......############~~~',
  '~~~##..........####..#...############~~~',
  '~~~##..........####..#...############~~~',
  '~~~#######.###########.##############~~~',
  '~~~#######.###########.##############~~~',
  '~~~##...#.....#####,,,,,,,,,,########~~~',
  '~~~##...#.....#####,,,,,,,,,,########~~~',
  '~~~##################################~~~',
  '~~~##..........###....#....###....###~~~',
  '~~~##..........###....#....###....###~~~',
  '~~~##..........###....#....###....###~~~',
  '~~~##################################~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
  '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
];

/** The sign's arrow points east along the corridor below it. */
const SIGN_ARROW_EAST_RADIANS = 0;

function tileFor(symbol: string, x: number, y: number): TileContent {
  const tileId = `${x}#${y}`;
  switch (symbol) {
    case '~':
      return { tileId, type: VOID_TYPE };
    case '.':
      return { tileId, type: FloorTypeValue.concrete };
    case ',':
      return { tileId, type: FloorTypeValue.wood };
    case 'S':
      return {
        tileId,
        type: CRAWLER_SIGN,
        groundType: FloorTypeValue.concrete,
        crawlerSignDirection: 'East',
        crawlerSignArrowAngle: SIGN_ARROW_EAST_RADIANS,
      };
    default:
      return { tileId, type: FloorTypeValue.wall };
  }
}

export function buildWallCaseStructure(): TileContent[][] {
  return WALL_CASE_ROWS.map((row, y) =>
    Array.from({ length: row.length }, (_, x) => tileFor(row.charAt(x), x, y)),
  );
}
