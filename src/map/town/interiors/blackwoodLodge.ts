/**
 * The town's other garrison ground, furnished for a section and held by two
 * men. Double bunks stand in ranks down both side walls, nearly all of them
 * stripped, their mattresses rolled and strapped; the north wall is the
 * post's working face — two spear racks slotted for more spears than they
 * hold, the duty board, and the stove the night watch keeps a kettle on,
 * with a bare stretch of sagging wall beside it. Kessler's own bunk is the one made up
 * square, nearest the briefing table, with the footlocker his log is pushed
 * under.
 *
 * The briefing table carries the pinned map of the row because what the
 * Lodge is actually watching is the drainage under the alley, and the iron
 * cellar lid in the floor south of it is the same lid Kessler's own lines
 * describe — flush with the boards and never opened by an interaction, since
 * the cellar this room sits on is a quest space, not a room this layout owns.
 *
 * The middle of the hall stays open floor on purpose: the cult-hideout
 * encounter fights in this same generated room, spawning its congregation
 * around the room's centre, so everything tall stands against a wall and the
 * floor between them carries only the table and walkable pieces.
 */

import { TOWN_INTERIOR_PROPS } from '../../../sprites/art/townInterior/townInteriorProps';
import { contractTarget, prop, type TownInteriorLayoutEntry } from './types';
import type { ContractAreaRecord } from '../../contractAreas';

/** `lodge_bunk` dressings — see `paintLodgeBunk` for what each tier holds. */
const BUNK_ROLLED = 0;
const BUNK_FOLDED = 1;
const BUNK_KESSLER = 2;
const BUNK_SLEPT = 3;
/** The worn ember mat in front of the stove. */
const STOVE_MAT_COLOURWAY = 2;

const CONTRACT_SITE = 'blackwood_lodge';
/** The east rank's first bunk, well away from Kessler's own and his footlocker. */
const CONTRACT_BUNK_RANK = 0;
const FLOORBOARDS_SPOT_W = 3;
const FLOORBOARDS_SPOT_H = 2;

/**
 * The north wall's run and the briefing table's position: shared by the
 * layout and by the contract rects measured against them.
 */
function lodgeGeometry(w: number) {
  const westCol = 1;
  const northRow = 1;
  // North wall, west to east: spear rack, duty board, stove, a bare stretch,
  // spear rack. The bare stretch is the only floor touching the north wall,
  // so it is where the party stands to work the chimney and the wall.
  const westRackCol = westCol;
  const dutyBoardCol = westRackCol + TOWN_INTERIOR_PROPS.lodge_spear_rack.footprint.w;
  const stoveCol = dutyBoardCol + TOWN_INTERIOR_PROPS.lodge_duty_board.footprint.w;
  const bareWallCol = stoveCol + TOWN_INTERIOR_PROPS.lodge_stove.footprint.w;
  const eastCol = w - 2;
  const eastRackCol = eastCol - TOWN_INTERIOR_PROPS.lodge_spear_rack.footprint.w + 1;
  const bareWallW = eastRackCol - bareWallCol;
  const firstBunkRow = northRow + 2;
  const bunkPitch = 2;
  // The briefing table, centred on the room north of its middle, so the
  // cellar lid sits between it and the door. The bench on its south side
  // and a clear row either side of the lid leave the congregation's spawn
  // tiles (the room's centre and its ring) on open floor.
  const mapTableW = TOWN_INTERIOR_PROPS.lodge_map_table.footprint.w;
  const mapTableCol = Math.floor(w / 2) - mapTableW / 2;
  const mapTableRow = firstBunkRow + bunkPitch;
  const benchRow = mapTableRow + TOWN_INTERIOR_PROPS.lodge_map_table.footprint.h;
  return {
    westCol,
    northRow,
    westRackCol,
    dutyBoardCol,
    stoveCol,
    bareWallCol,
    bareWallW,
    eastCol,
    eastRackCol,
    firstBunkRow,
    bunkPitch,
    mapTableW,
    mapTableCol,
    mapTableRow,
    benchRow,
  };
}

/** Blackwood Lodge's floor and wall rects a construction contract can mark, keyed by spot id. */
export function buildBlackwoodLodgeContractAreas(w: number, _h: number): ContractAreaRecord {
  const { northRow, bareWallCol, bareWallW, stoveCol, mapTableCol, mapTableW, benchRow } =
    lodgeGeometry(w);
  const northWallRow = northRow - 1;
  return {
    // East of the bench, between the table and the east bunks: open boards
    // the congregation fights over, never the cellar lid.
    floorboards: {
      kind: 'floor',
      x: mapTableCol + mapTableW - 1,
      y: benchRow,
      w: FLOORBOARDS_SPOT_W,
      h: FLOORBOARDS_SPOT_H,
    },
    chimney: {
      kind: 'wall',
      x: stoveCol,
      y: northWallRow,
      w: TOWN_INTERIOR_PROPS.lodge_stove.footprint.w,
      h: 1,
    },
    north_wall: {
      kind: 'wall',
      x: bareWallCol,
      y: northWallRow,
      w: bareWallW,
      h: 1,
    },
  };
}

export function buildBlackwoodLodgeLayout(w: number, h: number): TownInteriorLayoutEntry[] {
  const {
    westCol,
    northRow,
    westRackCol,
    dutyBoardCol,
    stoveCol,
    eastCol,
    eastRackCol,
    firstBunkRow,
    bunkPitch,
    mapTableW,
    mapTableCol,
    mapTableRow,
    benchRow,
  } = lodgeGeometry(w);
  const southRow = h - 2;

  const stoveMatRow = northRow + 1;

  // Bunk ranks: one bunk every other row, so each rank's upper tier fills
  // the row behind it instead of hiding the bunk there.
  const bunkWidth = TOWN_INTERIOR_PROPS.lodge_bunk.footprint.w;
  const bunksPerWall = 4;
  const westBunkCol = westCol;
  const eastBunkCol = eastCol - bunkWidth + 1;
  const bunkRow = (rank: number): number => firstBunkRow + rank * bunkPitch;
  const westDressings = [BUNK_ROLLED, BUNK_KESSLER, BUNK_FOLDED, BUNK_ROLLED];
  const eastDressings = [BUNK_FOLDED, BUNK_ROLLED, BUNK_SLEPT, BUNK_ROLLED];
  const kesslerBunkRank = westDressings.indexOf(BUNK_KESSLER);
  const slepBunkRank = eastDressings.indexOf(BUNK_SLEPT);
  const westAisleCol = westBunkCol + bunkWidth;
  const eastAisleCol = eastBunkCol - 1;

  const benchCol = mapTableCol + 1;
  const trapdoorCol = mapTableCol;
  const clearRowsAboveLid = 1;
  const trapdoorRow = benchRow + 1 + clearRowsAboveLid;

  // Stores against the corners and the south wall, either side of the door.
  const storeRow = southRow - 1;
  const doorCol = Math.floor(w / 2) - 1;
  const southBenchCol = westAisleCol + 1;
  // One clear column east of the door's own pair, the same as the bench to its west.
  const southEastCratesCol = doorCol + bunkWidth + 1;

  const entries: TownInteriorLayoutEntry[] = [
    prop(westRackCol, northRow, 'lodge_spear_rack', 0, contractTarget(CONTRACT_SITE, 'spear_rack')),
    prop(
      dutyBoardCol,
      northRow,
      'lodge_duty_board',
      0,
      contractTarget(CONTRACT_SITE, 'duty_board'),
    ),
    prop(stoveCol, northRow, 'lodge_stove', 0, contractTarget(CONTRACT_SITE, 'stove')),
    prop(eastRackCol, northRow, 'lodge_spear_rack', 1),
    prop(stoveCol - 1, stoveMatRow, 'rug_medium', STOVE_MAT_COLOURWAY),
  ];

  for (let rank = 0; rank < bunksPerWall; rank++) {
    entries.push(
      prop(westBunkCol, bunkRow(rank), 'lodge_bunk', westDressings[rank]),
      prop(
        eastBunkCol,
        bunkRow(rank),
        'lodge_bunk',
        eastDressings[rank],
        rank === CONTRACT_BUNK_RANK ? contractTarget(CONTRACT_SITE, 'bunk') : {},
      ),
    );
  }
  entries.push(
    prop(westAisleCol, bunkRow(kesslerBunkRank), 'kessler_footlocker'),
    prop(eastAisleCol, bunkRow(slepBunkRank), 'chest', 0, { id: 'lodge_footlocker' }),
    prop(westAisleCol, bunkRow(bunksPerWall - 1), 'drawer_unit'),
  );

  entries.push(
    prop(
      mapTableCol,
      mapTableRow,
      'lodge_map_table',
      0,
      contractTarget(CONTRACT_SITE, 'map_table'),
    ),
    prop(trapdoorCol, trapdoorRow, 'cellar_trapdoor'),
    prop(benchCol, benchRow, 'bench_seat'),
    prop(mapTableCol - 1, mapTableRow, 'stool'),
    prop(mapTableCol + mapTableW, mapTableRow + 1, 'stool', 1),
  );

  entries.push(
    prop(westCol, storeRow, 'crate'),
    prop(westCol + 1, storeRow, 'barrel'),
    prop(westCol, southRow, 'crate'),
    prop(westCol + 1, southRow, 'sack'),
    prop(westAisleCol, southRow, 'barrel', 1),
    prop(southBenchCol, southRow, 'bench_seat'),
    prop(southEastCratesCol, southRow, 'crate'),
    prop(southEastCratesCol + 1, southRow, 'open_crate'),
    prop(eastAisleCol, southRow, 'barrel'),
    prop(eastCol - 1, storeRow, 'barrel', 1),
    prop(eastCol, storeRow, 'crate'),
    prop(eastCol - 1, southRow, 'sack'),
    prop(eastCol, southRow, 'crate'),
  );
  return entries;
}
