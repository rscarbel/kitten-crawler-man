/**
 * A hushed hall built around its sanctuary. A raised stone dais spans the
 * whole north end; on it the long altar stands under the great sky window,
 * framed by iron candelabra, a brazier and a hanging banner either side and
 * a tall roosting perch at each corner, with the eagle lectern at the
 * deacon's elbow and votive racks along the dais' front edge. Four pew ranks
 * face it down the red aisle, candle stands at the aisle ends of the front
 * and back ranks; scripture shelves, banners and perches line the side
 * walls; and the narthex by the door holds the font, the offering table and
 * the waiting benches.
 *
 * The aisle is laid as the raw `RUG` tile type rather than a rug prop:
 * `AnchorInteriorSystem.naveSpawnAnchors` finds where to put the vermin by
 * scanning the grid for `RUG` tiles, and a `'prop'` layout entry never writes
 * a tile type — an all-prop aisle would leave that scan empty and spawn every
 * rat bunched at the door instead of spread down the nave. The dais paints
 * the runner's last stretch up its own step, so the two read as one carpet.
 *
 * Deacon Aviel anchors on the altar (`'table'`, posted north), and an
 * occupant's stand tile is the first walkable tile found in rings round the
 * anchor prop's north-west tile, north row first. The lectern blocks the
 * tile north-west of the altar, so that first free tile is the one directly
 * behind the altar's west end: he stands behind his altar under the window,
 * facing the nave. The tiles behind the altar stay open to the east so that
 * spot is reachable.
 */

import { RUG } from '../../tileTypes';
import { prop, tile, type TownInteriorLayoutEntry } from './types';

/** One pew segment in this many carries a book left on its seat. */
const PEW_BOOK_EVERY = 5;
const PEW_BOOK_VARIANT = 1;
/** Offsets the book pattern rank to rank so the books don't line up in a column. */
const PEW_BOOK_RANK_STRIDE = 2;

function pewVariant(col: number, rank: number): number {
  return (col + rank * PEW_BOOK_RANK_STRIDE) % PEW_BOOK_EVERY === 0 ? PEW_BOOK_VARIANT : 0;
}

export function buildTempleOfTheSkyLayout(w: number, h: number): TownInteriorLayoutEntry[] {
  const westWallCol = 1;
  const eastWallCol = w - 2;

  // ── Sanctuary ──
  const daisRow = 1;
  const daisCol = westWallCol + 1;
  const altarRow = daisRow + 1;
  const altarCol = 7;
  const altarWidth = 4;
  const altarEastCol = altarCol + altarWidth - 1;
  const lecternCol = altarCol - 1;
  const westCandelabrumCol = lecternCol - 1;
  const eastCandelabrumCol = altarEastCol + 2;
  const westPerchCol = daisCol;
  const eastPerchCol = eastWallCol - 1;
  const westBannerCol = westPerchCol + 1;
  const eastBannerCol = eastPerchCol - 1;
  const westBrazierCol = westBannerCol + 1;
  const eastBrazierCol = eastBannerCol - 1;
  const daisFrontRow = altarRow + 1;
  const westVotiveCol = westBrazierCol;
  const eastVotiveCol = eastBrazierCol - 1;

  // ── Nave ──
  const aisleStartCol = 8;
  const aisleEndCol = aisleStartCol + 1;
  const aisleStartRow = daisFrontRow + 1;
  const aisleEndRow = h - 2 - 2;
  const firstPewRow = aisleStartRow + 1;
  const pewRowPitch = 2;
  const pewRanks = 4;
  const lastPewRow = firstPewRow + (pewRanks - 1) * pewRowPitch;
  const westPewStartCol = 3;
  const westPewEndCol = aisleStartCol - 1;
  const eastPewStartCol = aisleEndCol + 1;
  const eastPewEndCol = eastWallCol - 2;
  const scriptureStartRow = aisleStartRow;
  const scriptureEndRow = scriptureStartRow + 2;
  // A banner's cloth hangs about two rows above the tile it is mounted on,
  // so it sits far enough below the shelves that it hangs in the bare wall
  // between them rather than over their tops.
  const bannerHangRows = 2;
  const sideBannerRow = scriptureEndRow + bannerHangRows + 1;
  const sidePerchRow = sideBannerRow + 2;
  const lowerScriptureRow = sidePerchRow + 1;

  // ── Narthex ──
  const benchRow = lastPewRow + 2;
  const westBenchCol = westPewStartCol;
  const eastBenchCol = eastPewEndCol - 1;
  const fontRow = benchRow + 1;
  const fontCol = aisleStartCol - 2;
  const offeringTableCol = aisleEndCol + 2;
  const narthexPerchRow = fontRow;
  const narthexVotiveRow = fontRow + 1;
  const doorRow = h - 2;
  const westDoorLightCol = aisleStartCol - 1;
  const eastDoorLightCol = aisleEndCol + 1;

  const entries: TownInteriorLayoutEntry[] = [
    prop(daisCol, daisRow, 'temple_dais'),
    prop(altarCol, daisRow, 'sky_window'),
    prop(altarCol, altarRow, 'altar'),
    prop(lecternCol, daisRow, 'lectern'),
    prop(westCandelabrumCol, daisRow, 'temple_candelabrum'),
    prop(eastCandelabrumCol, daisRow, 'temple_candelabrum'),
    prop(westPerchCol, daisRow, 'perch_stand'),
    prop(eastPerchCol, daisRow, 'perch_stand', 1),
    prop(westBannerCol, daisRow, 'sky_banner'),
    prop(eastBannerCol, daisRow, 'sky_banner'),
    prop(westBrazierCol, daisRow, 'forge_brazier'),
    prop(eastBrazierCol, daisRow, 'forge_brazier'),
    prop(westVotiveCol, daisFrontRow, 'votive_rack'),
    prop(eastVotiveCol, daisFrontRow, 'votive_rack'),
  ];

  for (let ry = aisleStartRow; ry <= aisleEndRow; ry++)
    for (let rx = aisleStartCol; rx <= aisleEndCol; rx++) entries.push(tile(rx, ry, RUG));

  for (let rank = 0; rank < pewRanks; rank++) {
    const pewRow = firstPewRow + rank * pewRowPitch;
    const isEndRank = rank === 0 || rank === pewRanks - 1;
    const westEnd = isEndRank ? westPewEndCol - 1 : westPewEndCol;
    const eastStart = isEndRank ? eastPewStartCol + 1 : eastPewStartCol;
    for (let rx = westPewStartCol; rx <= westEnd; rx++)
      entries.push(prop(rx, pewRow, 'pew', pewVariant(rx, rank)));
    for (let rx = eastStart; rx <= eastPewEndCol; rx++)
      entries.push(prop(rx, pewRow, 'pew', pewVariant(rx, rank)));
    if (isEndRank) {
      entries.push(prop(westPewEndCol, pewRow, 'temple_candelabrum', 1));
      entries.push(prop(eastPewStartCol, pewRow, 'temple_candelabrum', 1));
    }
  }

  for (let ry = scriptureStartRow; ry <= scriptureEndRow; ry++) {
    entries.push(prop(westWallCol, ry, 'scripture_shelf', ry % 2));
    entries.push(prop(eastWallCol, ry, 'scripture_shelf', (ry + 1) % 2));
  }
  entries.push(
    prop(westWallCol, sideBannerRow, 'sky_banner'),
    prop(eastWallCol, sideBannerRow, 'sky_banner'),
    prop(westWallCol, sidePerchRow, 'perch_stand', 1),
    prop(westWallCol, lowerScriptureRow, 'scripture_shelf', 1),
    prop(eastWallCol, lowerScriptureRow, 'scripture_shelf'),
    prop(eastWallCol, sidePerchRow, 'perch_stand'),
    prop(westBenchCol, benchRow, 'pew'),
    prop(westBenchCol + 1, benchRow, 'pew'),
    prop(eastBenchCol, benchRow, 'pew'),
    prop(eastBenchCol + 1, benchRow, 'pew'),
    prop(westBenchCol, narthexVotiveRow, 'votive_rack'),
    prop(eastBenchCol, narthexVotiveRow, 'votive_rack'),
    prop(westDoorLightCol, doorRow, 'temple_candelabrum', 1),
    prop(eastDoorLightCol, doorRow, 'temple_candelabrum', 1),
    prop(fontCol, fontRow, 'sky_font'),
    prop(offeringTableCol, fontRow, 'offering_table'),
    prop(westWallCol, narthexPerchRow + 1, 'perch_stand'),
    prop(eastWallCol, narthexPerchRow + 1, 'perch_stand', 1),
  );
  return entries;
}
