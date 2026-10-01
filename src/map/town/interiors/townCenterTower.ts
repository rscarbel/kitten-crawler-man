/**
 * The Town Center Tower, storey by storey: the magistrate's seat, and Miss
 * Quill's domain from the public counter at the door to the office at the top.
 *
 * - **Ground floor — the Hall of Petitions.** Dressed flagstones, the town
 *   hearth under the city's arms, the writ board, and the petition counter the
 *   public queues at, with the clerks' desks and the newest records behind it.
 *   Pews for the waiting, either side of a red runner from the door.
 * - **2nd floor — the Records Office.** Boards underfoot, ranks of pigeonholes
 *   and cabinets, and clerks' desks down the aisle where the town's papers are
 *   written out fair.
 * - **3rd floor — Quill's rooms.** Her bed and dresser on boards in the west
 *   half; on bare stone in the east, the workshop where the capacitor was
 *   built: plans, coil benches, charged conduit coils and their scorch marks.
 * - **Top floor — the Magistrate's Office.** A filing wall down each side, the
 *   hearth, and the carpet the Lich fight is fought across. The magistrate
 *   himself, dead at his own desk, is drawn by `QuillConfrontationSystem`, so
 *   the floor where he sits is left open.
 *
 * Every storey keeps clear the stair blocks and the landing rows below them
 * (where a party arriving by those stairs is set down), a lane between the
 * two stairs, the two door columns' tiles on the south row, and — on the
 * ground floor — the two rows inside the door. The top floor is also an arena:
 * the Lich's firewalls sweep the whole room and its orbs rain anywhere, so the
 * only blocking pieces the layout places there are the side walls' filing and
 * the hearth, and everything in the middle is a rug. `verify:lich` fights
 * across exactly this floor.
 */

import { TOWN_INTERIOR_PROPS } from '../../../sprites/art/townInterior/townInteriorProps';
import {
  INTERIOR_BOARD_FLOOR,
  INTERIOR_FLAG_FLOOR,
  INTERIOR_STONE_FLOOR,
  RUG,
} from '../../tileTypes';
import { prop, tileRect, type TownInteriorLayoutEntry } from './types';

/** Where a storey's two staircases start (their north-west tiles), or null where there is none. */
export interface TowerStairOrigins {
  readonly up: { readonly x: number; readonly y: number } | null;
  readonly down: { readonly x: number; readonly y: number } | null;
  /** Tiles a side of each square stair block. */
  readonly span: number;
}

/** The storeys, by index, as `BuildingInteriorScene` climbs them. */
const HALL_OF_PETITIONS_FLOOR = 0;
const RECORDS_OFFICE_FLOOR = 1;
const QUILLS_ROOMS_FLOOR = 2;

/** The teal-bordered ember rug from `RUG_COLORWAYS`. */
const RUG_EMBER_ON_TEAL = 2;

/** Prop variants that change what a piece is doing, named where the layout picks them. */
const CABINET_SHUT = 0;
const CABINET_DRAWER_OPEN = 1;
const DESK_TIDY = 0;
const DESK_HEAPED = 1;
const BOXES_TALL = 0;
const BOXES_OPENED = 1;
const PEW_CLEAR = 0;
const PEW_PAPERS_LEFT = 1;
const STOOL_PLAIN = 0;
const STOOL_WORN = 1;
const JARS_STOPPERED = 0;
const JARS_OPEN = 1;
const SETTEE_DUSTY = 1;
const RAG_RUG_PLAIN = 0;
const GUEST_BED_MADE = 0;
const BOOK_STACK_LEANING = 1;
const SCORCH_SMALL = 0;
const SCORCH_SPREAD = 1;
const SCORCH_SPATTER = 2;

/** Widths of the pieces the layouts space against, read from the props themselves. */
const PIGEONHOLE_WIDTH = TOWN_INTERIOR_PROPS.pigeonhole_wall.footprint.w;
const DESK_WIDTH = TOWN_INTERIOR_PROPS.scrivener_desk.footprint.w;
const TOWER_HEARTH_WIDTH = TOWN_INTERIOR_PROPS.tower_hearth.footprint.w;
const TOWER_HEARTH_DEPTH = TOWN_INTERIOR_PROPS.tower_hearth.footprint.h;
const DRESSER_WIDTH = TOWN_INTERIOR_PROPS.inn_dresser.footprint.w;
const POTION_CABINET_WIDTH = TOWN_INTERIOR_PROPS.potion_cabinet.footprint.w;
const DRAFTING_TABLE_WIDTH = TOWN_INTERIOR_PROPS.drafting_table.footprint.w;
const COIL_BENCH_WIDTH = TOWN_INTERIOR_PROPS.coil_bench.footprint.w;
const BOOK_HEAP_WIDTH = TOWN_INTERIOR_PROPS.book_heap.footprint.w;
const GUEST_BED_WIDTH = TOWN_INTERIOR_PROPS.inn_guest_bed.footprint.w;
const GUEST_BED_DEPTH = TOWN_INTERIOR_PROPS.inn_guest_bed.footprint.h;
const PETITION_COUNTER_WIDTH = TOWN_INTERIOR_PROPS.petition_counter.footprint.w;
const HEARTH_RUG_WIDTH = TOWN_INTERIOR_PROPS.flagon_hearth_rug.footprint.w;
const HEARTH_WIDTH = TOWN_INTERIOR_PROPS.hearth_wide.footprint.w;

/** Two tiles of carpet: the runner every storey with one lays down its middle. */
const RUNNER_WIDTH = 2;
/** Rows below a stair block that stay open: the arrival row and the one behind it. */
const LANDING_DEPTH = 2;

interface Shell {
  readonly westCol: number;
  readonly eastCol: number;
  readonly northRow: number;
  readonly southRow: number;
  /** The west of the two door columns in the south wall; the room's middle pair starts here. */
  readonly doorCol: number;
  /** The last row of the stairs' landings, below which each storey's furniture starts. */
  readonly landingRow: number;
}

function shellOf(w: number, h: number, stairs: TowerStairOrigins): Shell {
  const northRow = 1;
  const stairRow = stairs.up?.y ?? stairs.down?.y ?? northRow;
  return {
    westCol: 1,
    eastCol: w - 2,
    northRow,
    southRow: h - 2,
    doorCol: Math.floor(w / 2) - 1,
    landingRow: stairRow + stairs.span + LANDING_DEPTH - 1,
  };
}

/**
 * Every prop and floor write for one storey of the tower. The floor material
 * comes first, so the stairs `GameMap` lays afterwards record it as the floor
 * they stand on.
 */
export function buildTownCenterTowerLayout(
  floor: number,
  w: number,
  h: number,
  stairs: TowerStairOrigins,
): TownInteriorLayoutEntry[] {
  const shell = shellOf(w, h, stairs);
  if (floor === HALL_OF_PETITIONS_FLOOR) return hallOfPetitions(shell, stairs);
  if (floor === RECORDS_OFFICE_FLOOR) return recordsOffice(shell);
  if (floor === QUILLS_ROOMS_FLOOR) return quillsRooms(shell);
  return magistratesOffice(shell);
}

function floorOf(shell: Shell, tileType: number): TownInteriorLayoutEntry[] {
  return tileRect(shell.westCol, shell.northRow, shell.eastCol, shell.southRow, tileType);
}

function hallOfPetitions(shell: Shell, stairs: TowerStairOrigins): TownInteriorLayoutEntry[] {
  const { westCol, eastCol, northRow, southRow, doorCol } = shell;
  const entries = floorOf(shell, INTERIOR_FLAG_FLOOR);

  // North wall, west to east: the newest records, the writs, the town hearth
  // centred on the door, the city's banner and a window, and the stair's own
  // corner left bare.
  const hearthCol = doorCol + RUNNER_WIDTH / 2 - TOWER_HEARTH_WIDTH / 2;
  const pigeonholeCol = westCol + 2;
  const writBoardCol = pigeonholeCol + PIGEONHOLE_WIDTH;
  const eastOfHearthCol = hearthCol + TOWER_HEARTH_WIDTH;
  entries.push(
    prop(westCol, northRow, 'records_cabinet', CABINET_SHUT),
    prop(westCol + 1, northRow, 'records_cabinet', CABINET_DRAWER_OPEN),
    prop(pigeonholeCol, northRow, 'pigeonhole_wall'),
    prop(writBoardCol, northRow, 'writ_board'),
    prop(hearthCol, northRow, 'tower_hearth'),
    prop(eastOfHearthCol, northRow, 'sky_banner'),
    prop(eastOfHearthCol + 1, northRow, 'window_dressing'),
    prop(eastCol, northRow, 'records_cabinet', CABINET_SHUT),
  );

  // The aisle: the town's own red runner, from the hearth to the door.
  const runnerEastCol = doorCol + RUNNER_WIDTH - 1;
  entries.push(...tileRect(doorCol, northRow + TOWER_HEARTH_DEPTH, runnerEastCol, southRow, RUG));

  // The clerks' side: two desks behind the petition counter with the row in
  // front of them left open, and a gap at each end of the counter so the
  // clerks — and anyone who climbs over — can get round it.
  const deskRow = northRow + 1;
  const counterRow = deskRow + 2;
  const counterWestCol = westCol + 1;
  const counterEastCol = counterWestCol + PETITION_COUNTER_WIDTH - 1;
  entries.push(
    prop(counterWestCol, deskRow, 'scrivener_desk', DESK_TIDY),
    prop(counterEastCol - 1, deskRow, 'scrivener_desk', DESK_HEAPED),
    prop(counterWestCol, counterRow, 'petition_counter'),
  );

  // The public gallery: ranks of pews either side of the aisle, one clear
  // column from it, facing the counter and the hearth. A queue's worth of
  // floor is left between the counter and the first rank.
  const pewsPerRank = PETITION_COUNTER_WIDTH - 1;
  const westPewCol = doorCol - 1 - pewsPerRank;
  const eastPewCol = runnerEastCol + 2;
  const queueRows = 2;
  const firstPewRow = counterRow + queueRows + 1;
  const pewPitch = 2;
  const pewRanks = Math.floor((southRow - firstPewRow) / pewPitch);
  for (let rank = 0; rank < pewRanks; rank++) {
    const row = firstPewRow + rank * pewPitch;
    for (let i = 0; i < pewsPerRank; i++) {
      const westHasPapers = i === rank ? PEW_PAPERS_LEFT : PEW_CLEAR;
      const eastHasPapers = i === pewsPerRank - 1 - rank ? PEW_PAPERS_LEFT : PEW_CLEAR;
      entries.push(prop(westPewCol + i, row, 'pew', westHasPapers));
      entries.push(prop(eastPewCol + i, row, 'pew', eastHasPapers));
    }
  }
  const lastPewRow = firstPewRow + (pewRanks - 1) * pewPitch;
  entries.push(
    prop(westCol, firstPewRow - 1, 'torchere'),
    prop(eastCol, firstPewRow - 1, 'torchere'),
    prop(westCol, firstPewRow + pewPitch, 'sky_banner'),
    prop(eastCol, firstPewRow + pewPitch, 'sky_banner'),
    prop(westCol, lastPewRow, 'side_table'),
    prop(doorCol - 1, lastPewRow + pewPitch, 'torchere'),
    prop(runnerEastCol + 1, lastPewRow + pewPitch, 'torchere'),
  );

  // Beside the stair up, the visitors' register on its lectern, clear of the
  // landing and of the lane to it.
  const up = stairs.up;
  if (up !== null) entries.push(prop(up.x - 2, shell.landingRow, 'lectern'));

  // The south wall, either side of the door: coats, and the overflow of a
  // records office that has run out of room upstairs.
  const coatStandSetback = 2;
  entries.push(
    prop(doorCol - 1 - coatStandSetback, southRow, 'coat_stand'),
    prop(runnerEastCol + 1 + coatStandSetback, southRow, 'coat_stand'),
    prop(westCol, southRow, 'archive_boxes', BOXES_TALL),
    prop(westCol + 1, southRow, 'archive_boxes', BOXES_OPENED),
    prop(westCol, southRow - 1, 'chest'),
    prop(eastCol, southRow, 'archive_boxes', BOXES_TALL),
    prop(eastCol - 1, southRow, 'barrel'),
    prop(eastCol, southRow - 1, 'drawer_unit'),
  );
  return entries;
}

function recordsOffice(shell: Shell): TownInteriorLayoutEntry[] {
  const { westCol, eastCol, northRow, southRow, doorCol, landingRow } = shell;
  const entries = floorOf(shell, INTERIOR_BOARD_FLOOR);

  // North wall between the two stairs: pigeonholes floor to cornice, a
  // cabinet at either end.
  const westPigeonholeCol = doorCol + RUNNER_WIDTH / 2 - PIGEONHOLE_WIDTH;
  const eastPigeonholeCol = westPigeonholeCol + PIGEONHOLE_WIDTH;
  entries.push(
    prop(westCol, northRow, 'records_cabinet', CABINET_SHUT),
    prop(westPigeonholeCol - 1, northRow, 'records_cabinet', CABINET_DRAWER_OPEN),
    prop(westPigeonholeCol, northRow, 'pigeonhole_wall'),
    prop(eastPigeonholeCol, northRow, 'pigeonhole_wall'),
    prop(eastPigeonholeCol + PIGEONHOLE_WIDTH, northRow, 'records_cabinet', CABINET_SHUT),
    prop(eastCol, northRow, 'records_cabinet', CABINET_DRAWER_OPEN),
  );

  // Two ranks of stacks against each side wall, an open column between each
  // stack and the clerks' desks so the bays behind them can be walked into.
  const firstStackRow = landingRow + 2;
  const stackPitch = 3;
  const stackRanks = 2;
  const cabinetsPerStack = 2;
  const westCabinetCol = westCol + PIGEONHOLE_WIDTH;
  const eastCabinetCol = eastCol - PIGEONHOLE_WIDTH - cabinetsPerStack + 1;
  for (let rank = 0; rank < stackRanks; rank++) {
    const row = firstStackRow + rank * stackPitch;
    const drawerOpen = rank % 2 === 0 ? CABINET_SHUT : CABINET_DRAWER_OPEN;
    const drawerShut = 1 - drawerOpen;
    entries.push(
      prop(westCol, row, 'pigeonhole_wall'),
      prop(westCabinetCol, row, 'records_cabinet', drawerOpen),
      prop(westCabinetCol + 1, row, 'records_cabinet', drawerShut),
      prop(eastCabinetCol, row, 'records_cabinet', drawerShut),
      prop(eastCabinetCol + 1, row, 'records_cabinet', drawerOpen),
      prop(eastCabinetCol + cabinetsPerStack, row, 'pigeonhole_wall'),
    );
  }

  // The copying room down the aisle: a runner from the stairs' lane to the
  // reading corner, with clerks' desks either side of it.
  const runnerEastCol = doorCol + RUNNER_WIDTH - 1;
  entries.push(...tileRect(doorCol, landingRow + 1, runnerEastCol, southRow - 1, RUG));
  const westDeskCol = doorCol - DESK_WIDTH;
  const eastDeskCol = runnerEastCol + 1;
  for (let rank = 0; rank < stackRanks; rank++) {
    const row = firstStackRow + rank * stackPitch;
    const isFirstRank = rank === 0;
    entries.push(
      prop(westDeskCol, row, 'scrivener_desk', isFirstRank ? DESK_TIDY : DESK_HEAPED),
      prop(eastDeskCol, row, 'scrivener_desk', isFirstRank ? DESK_HEAPED : DESK_TIDY),
      prop(westDeskCol + rank, row + 1, 'stool', isFirstRank ? STOOL_PLAIN : STOOL_WORN),
      prop(eastDeskCol + 1 - rank, row + 1, 'stool', isFirstRank ? STOOL_WORN : STOOL_PLAIN),
    );
  }
  entries.push(
    prop(westDeskCol + 1, landingRow + 1, 'lectern'),
    prop(eastDeskCol, landingRow + 1, 'book_stack', BOOK_STACK_LEANING),
  );

  // Boxed overflow and a reading corner along the south wall, the middle
  // left clear where the runner ends.
  const setteeCol = westCol + BOOK_HEAP_WIDTH + 1 + RUNNER_WIDTH;
  entries.push(
    prop(westCol, southRow, 'archive_boxes', BOXES_TALL),
    prop(westCol + 1, southRow, 'archive_boxes', BOXES_OPENED),
    prop(westCol + 2, southRow, 'book_heap'),
    prop(westCol, southRow - 1, 'archive_boxes', BOXES_OPENED),
    prop(setteeCol - 1, southRow, 'torchere'),
    prop(setteeCol, southRow, 'settee'),
    prop(runnerEastCol + 1, southRow, 'side_table'),
    prop(eastCabinetCol - 1, southRow, 'book_heap'),
    prop(eastCol - 2, southRow, 'archive_boxes', BOXES_OPENED),
    prop(eastCol - 1, southRow, 'chest'),
    prop(eastCol, southRow, 'archive_boxes', BOXES_TALL),
    prop(eastCol, southRow - 1, 'archive_boxes', BOXES_TALL),
  );
  return entries;
}

function quillsRooms(shell: Shell): TownInteriorLayoutEntry[] {
  const { westCol, eastCol, northRow, southRow, doorCol, landingRow } = shell;
  // Boards on her side of the room, bare stone on the workshop's: nothing
  // that burns is laid where the coils are.
  const workshopCol = doorCol;
  const entries: TownInteriorLayoutEntry[] = [
    ...tileRect(westCol, northRow, workshopCol - 1, southRow, INTERIOR_BOARD_FLOOR),
    ...tileRect(workshopCol, northRow, eastCol, southRow, INTERIOR_STONE_FLOOR),
  ];

  // North wall: her dresser and window on the quarters side, her locked
  // cabinet and her specimens on the workshop side.
  entries.push(
    prop(workshopCol - 1 - DRESSER_WIDTH, northRow, 'inn_dresser'),
    prop(workshopCol - 1, northRow, 'window_dressing'),
    prop(workshopCol, northRow, 'potion_cabinet'),
    prop(workshopCol + POTION_CABINET_WIDTH, northRow, 'specimen_case'),
  );

  // The quarters: a made bed beside a rug, a washstand, a reading chair under
  // a lamp, and a coat stand by the stairs.
  const bedRow = landingRow + 2;
  const chairCol = westCol + GUEST_BED_WIDTH + 2;
  entries.push(
    prop(westCol + 1, bedRow + 1, 'rag_rug', RAG_RUG_PLAIN),
    prop(westCol, bedRow, 'inn_guest_bed', GUEST_BED_MADE),
    prop(westCol + GUEST_BED_WIDTH, bedRow, 'side_table'),
    prop(westCol, bedRow + GUEST_BED_DEPTH + 1, 'washstand'),
    prop(chairCol, bedRow + 2, 'good_chair'),
    prop(chairCol, bedRow + 1, 'arm_lamp'),
    prop(chairCol + 1, landingRow, 'coat_stand'),
    prop(westCol, southRow, 'chest'),
    prop(westCol + 1, southRow, 'book_heap'),
  );

  // Between the bed and the workshop, a sitting room's worth of furniture she
  // has stopped using.
  const sittingRow = southRow - 1;
  entries.push(
    prop(chairCol, sittingRow, 'rug_medium', RUG_EMBER_ON_TEAL),
    prop(chairCol, sittingRow, 'settee', SETTEE_DUSTY),
    prop(chairCol + 1, sittingRow + 1, 'low_table'),
  );

  // The workshop: plans at its head, then the coil benches, the charged
  // coils standing among them, and the scorch marks they leave.
  const plansRow = landingRow;
  entries.push(
    prop(workshopCol, plansRow, 'drafting_table'),
    prop(workshopCol + DRAFTING_TABLE_WIDTH, plansRow, 'roll_bin'),
    prop(workshopCol + 1, plansRow + 1, 'stool'),
  );
  const benchPitch = 3;
  const firstBenchRow = plansRow + benchPitch;
  const secondBenchRow = firstBenchRow + benchPitch;
  const westBenchCol = workshopCol + 1;
  const eastBenchCol = westBenchCol + COIL_BENCH_WIDTH + 1;
  entries.push(
    prop(westBenchCol, firstBenchRow, 'coil_bench'),
    prop(eastBenchCol, secondBenchRow, 'coil_bench'),
    prop(westBenchCol - 1, firstBenchRow, 'stool', STOOL_WORN),
    prop(eastBenchCol + COIL_BENCH_WIDTH, secondBenchRow, 'stool', STOOL_PLAIN),
    prop(eastCol, firstBenchRow - 1, 'conduit_coil'),
    prop(eastBenchCol, firstBenchRow, 'conduit_coil'),
    prop(westBenchCol + 1, secondBenchRow, 'conduit_coil'),
    prop(eastCol, southRow - 2, 'conduit_coil'),
    prop(westBenchCol + 1, firstBenchRow + 1, 'floor_stain', SCORCH_SMALL),
    prop(eastBenchCol + 1, firstBenchRow + 1, 'floor_stain', SCORCH_SPREAD),
    prop(westBenchCol + 2, secondBenchRow + 1, 'floor_stain', SCORCH_SPATTER),
    prop(eastBenchCol - 1, secondBenchRow + 2, 'floor_stain', SCORCH_SMALL),
  );

  // Stores along the south wall, the door columns' tiles left clear: wire and
  // glass in crates, jars of something.
  const storesCol = workshopCol + RUNNER_WIDTH;
  const eastStoreCount = 3;
  const eastStoresCol = eastCol - eastStoreCount;
  entries.push(
    prop(storesCol, southRow, 'crate'),
    prop(storesCol + 1, southRow, 'open_crate'),
    prop(storesCol + 2, southRow, 'jars', JARS_OPEN),
    prop(eastStoresCol, southRow, 'archive_boxes', BOXES_OPENED),
    prop(eastStoresCol + 1, southRow, 'jars', JARS_STOPPERED),
    prop(eastStoresCol + 2, southRow, 'crate'),
  );
  return entries;
}

function magistratesOffice(shell: Shell): TownInteriorLayoutEntry[] {
  const { westCol, eastCol, northRow, southRow, doorCol } = shell;
  const entries = floorOf(shell, INTERIOR_BOARD_FLOOR);

  // The side walls: a filing wall of cabinets, fronted by the boxed files that
  // would not fit in it.
  const sideFirstRow = northRow + 2;
  const sideRows = 6;
  const sideLastRow = sideFirstRow + sideRows - 1;
  for (let row = sideFirstRow; row < sideLastRow; row++) {
    const drawerOpen = row % 2 === 0 ? CABINET_DRAWER_OPEN : CABINET_SHUT;
    entries.push(
      prop(westCol, row, 'records_cabinet', drawerOpen),
      prop(eastCol, row, 'records_cabinet', 1 - drawerOpen),
    );
  }
  entries.push(
    prop(westCol, sideLastRow, 'archive_boxes', BOXES_TALL),
    prop(eastCol, sideLastRow, 'archive_boxes', BOXES_OPENED),
  );

  // The hearth, and the floor east of it left open for the magistrate:
  // `QuillConfrontationSystem` seats his body at its own desk just north of
  // the room's middle and draws it before the room's furniture, so any prop
  // there would be drawn over him. It also makes his desk's tiles solid, the
  // shape the Lich's firewalls are tuned against.
  const hearthCol = doorCol - 1 - HEARTH_WIDTH;
  const hearthRugCol = hearthCol + HEARTH_WIDTH / 2 - HEARTH_RUG_WIDTH / 2;
  const officeTopRow = northRow + 2;
  entries.push(
    prop(hearthCol, northRow, 'hearth_wide'),
    prop(hearthRugCol, northRow + 1, 'flagon_hearth_rug'),
  );

  // The carpet the room is fought across, a clear border of boards round it.
  const carpetInset = 3;
  const carpetNorthRow = officeTopRow + carpetInset;
  entries.push(
    ...tileRect(westCol + carpetInset, carpetNorthRow, eastCol - carpetInset, southRow - 2, RUG),
  );

  // Standing lamps in the two south corners.
  entries.push(prop(westCol, southRow - 1, 'torchere'), prop(eastCol, southRow - 1, 'torchere'));
  return entries;
}
