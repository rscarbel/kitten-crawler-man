/**
 * The respectable house: one grand hall on flagstones, laid out the way the
 * seating chart in Brend's head says it has always been.
 *
 * The north wall is the house's face — the great fireplace dead centre with
 * the curled horns over it, torchères and trophies of arms either side, the
 * guild's panelled booth in the west corner behind its screen, and Brend's
 * mirrored back bar in the east. The feast table runs down the middle of the
 * hall in walnut sections on a crimson carpet, with a carpet runner from the
 * door up to it. The labourers' end is the four plain trestles along the
 * south half, where the benches are deal and the mugs are clay.
 */

import { prop, type TownInteriorLayoutEntry } from './types';

const ROAST = 0;
const CANDELABRUM = 1;
const FLAGONS = 2;
const TARGE_AND_AXES = 0;
const SHIELD_AND_SWORDS = 1;
const SUPPER_TRESTLE = 0;
const PIPE_AND_HAT_TRESTLE = 1;

export function buildHornedFlagonLayout(w: number, h: number): TownInteriorLayoutEntry[] {
  const westCol = 1;
  const eastCol = w - 2;
  const northRow = 1;
  const southRow = h - 2;
  const doorCol = Math.floor(w / 2);

  // ── The guild corner ────────────────────────────────────────────────────
  const boothWidth = 4;
  const boothTableCol = westCol + 1;
  const boothTableRow = northRow + 2;
  /*
   * The screen closes the booth's east side; the booth stays open to the
   * south at both ends of its table. The torchère on the wall column beside
   * the screen fills the one tile that would otherwise be a pocket between
   * the booth's back, the screen and the trophies.
   */
  const boothScreenCol = westCol + boothWidth;
  const boothScreenRow = northRow + 1;
  const boothTorchereCol = boothScreenCol;

  // ── The fireplace wall ──────────────────────────────────────────────────
  const hearthWidth = 4;
  const hearthCol = doorCol - hearthWidth / 2;
  const hearthRugRow = northRow + 2;
  const westTorchereCol = hearthCol - 1;
  const eastTorchereCol = hearthCol + hearthWidth;
  const westTrophyCol = boothTorchereCol + 1;
  const guildBannerCol = westTrophyCol + 1;
  const eastTrophyCol = eastTorchereCol + 1;
  const honouredChairRow = hearthRugRow;

  // ── Brend's bar ─────────────────────────────────────────────────────────
  /*
   * Back bar against the wall, the barkeep's lane in front of it, the bar
   * two rows down. The lane opens only at its west end, onto the column the
   * tab ledger hangs over: Brend stands at that end of his own bar, where he
   * can see the door.
   */
  const barWidth = 5;
  const barCol = eastCol - barWidth + 1;
  const barRow = northRow + 2;
  const tabLedgerCol = barCol - 1;
  const barStoolRow = barRow + 1;
  const barStoolPitch = 2;

  // ── The feast table ─────────────────────────────────────────────────────
  const carpetWidth = 12;
  const carpetCol = doorCol - carpetWidth / 2;
  /** Clear of the fireside chairs and the bar stools, with a row to walk between. */
  const carpetGapRows = 4;
  const carpetRow = northRow + carpetGapRows;
  const feastSectionWidth = 2;
  const feastSections = 5;
  const feastCol = carpetCol + 1;
  /** One row in from the carpet's north edge: the diners sit on that row, facing the room. */
  const feastRow = carpetRow + 1;
  const feastBenchRow = feastRow + 1;
  const feastCourses = [FLAGONS, CANDELABRUM, ROAST, CANDELABRUM, FLAGONS];
  const entranceRunnerCol = doorCol - 1;
  const carpetDepth = 4;
  const entranceRunnerRow = carpetRow + carpetDepth;

  // ── The labourers' end ──────────────────────────────────────────────────
  const trestleWidth = 2;
  const sideTrestleRow = feastRow;
  /** A table row, its bench row, and a row clear in front of the south wall. */
  const southTrestleRowsFromWall = 3;
  const southTrestleRow = southRow - southTrestleRowsFromWall;
  const westTrestleCol = westCol + 1;
  /** Two tiles between neighbouring trestles, so each bench can be walked round. */
  const trestlePitch = 4;
  const innerWestTrestleCol = westTrestleCol + trestlePitch;
  const eastTrestleCol = eastCol - trestleWidth;
  const innerEastTrestleCol = eastTrestleCol - trestlePitch;
  const trestles = [
    { col: westTrestleCol, row: sideTrestleRow, variant: SUPPER_TRESTLE },
    { col: eastTrestleCol, row: sideTrestleRow, variant: PIPE_AND_HAT_TRESTLE },
    { col: westTrestleCol, row: southTrestleRow, variant: PIPE_AND_HAT_TRESTLE },
    { col: innerWestTrestleCol, row: southTrestleRow, variant: SUPPER_TRESTLE },
    { col: innerEastTrestleCol, row: southTrestleRow, variant: PIPE_AND_HAT_TRESTLE },
    { col: eastTrestleCol, row: southTrestleRow, variant: SUPPER_TRESTLE },
  ];

  /** Against the side walls, between the side trestles and the labourers' end. */
  const sideboardRowsBelowTrestle = 3;
  const sideboardRow = sideTrestleRow + sideboardRowsBelowTrestle;

  // ── By the door ─────────────────────────────────────────────────────────
  const coatRackCol = doorCol - 2;
  const doorTorchereCol = doorCol + 2;

  const entries: TownInteriorLayoutEntry[] = [];
  // Loot-bearing junk first: the payout gate expects the first breakable in
  // placement order to pay out.
  entries.push(
    prop(westCol, southRow, 'barrel'),
    prop(eastCol, southRow, 'barrel', 1),
    prop(westCol, southRow - 1, 'crate'),
  );

  entries.push(
    prop(westCol, northRow, 'guild_booth'),
    prop(boothTableCol, boothTableRow, 'booth_table'),
    prop(boothScreenCol, boothScreenRow, 'booth_screen'),
    prop(boothTorchereCol, northRow, 'torchere'),
    prop(westTrophyCol, northRow, 'flagon_trophy', TARGE_AND_AXES),
    prop(guildBannerCol, northRow, 'trophy_banner'),
    prop(westTorchereCol, northRow, 'torchere'),
    prop(hearthCol, northRow, 'flagon_hearth'),
    prop(hearthCol, hearthRugRow, 'flagon_hearth_rug'),
    prop(eastTorchereCol, northRow, 'torchere'),
    prop(eastTrophyCol, northRow, 'flagon_trophy', SHIELD_AND_SWORDS),
    prop(westTorchereCol, honouredChairRow, 'flagon_chair'),
    prop(eastTorchereCol, honouredChairRow, 'flagon_chair'),
  );

  entries.push(
    prop(tabLedgerCol, northRow, 'tab_ledger'),
    prop(barCol, northRow, 'flagon_back_bar'),
    prop(barCol, barRow, 'flagon_bar'),
  );
  for (let rx = barCol; rx <= eastCol; rx += barStoolPitch)
    entries.push(prop(rx, barStoolRow, 'stool', 1));

  entries.push(
    prop(carpetCol, carpetRow, 'flagon_carpet'),
    prop(entranceRunnerCol, entranceRunnerRow, 'flagon_runner'),
  );
  for (let section = 0; section < feastSections; section++) {
    const col = feastCol + section * feastSectionWidth;
    entries.push(
      prop(col, feastRow, 'feast_table', feastCourses[section]),
      prop(col, feastBenchRow, 'feast_bench'),
    );
  }

  for (const trestle of trestles) {
    entries.push(
      prop(trestle.col, trestle.row, 'trestle_table', trestle.variant),
      prop(trestle.col, trestle.row + 1, 'deal_bench'),
    );
  }

  entries.push(
    prop(westCol, sideboardRow, 'flagon_sideboard'),
    prop(eastCol - 1, sideboardRow, 'flagon_sideboard'),
  );

  entries.push(
    prop(coatRackCol, southRow, 'coat_rack'),
    prop(doorTorchereCol, southRow, 'torchere'),
  );
  return entries;
}
