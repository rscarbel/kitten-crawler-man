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
import { contractTarget, prop, tile, type TownInteriorLayoutEntry } from './types';
import type { ContractAreaRecord } from '../../contractAreas';

/** One pew segment in this many carries a book left on its seat. */
const PEW_BOOK_EVERY = 5;
const PEW_BOOK_VARIANT = 1;
/** Offsets the book pattern rank to rank so the books don't line up in a column. */
const PEW_BOOK_RANK_STRIDE = 2;

function pewVariant(col: number, rank: number): number {
  return (col + rank * PEW_BOOK_RANK_STRIDE) % PEW_BOOK_EVERY === 0 ? PEW_BOOK_VARIANT : 0;
}

const CONTRACT_SITE = 'temple_of_the_sky';
/** The east end of the third rank: an ordinary pew, clear of the aisle's candle stands. */
const CONTRACT_PEW_RANK = 2;
const NAVE_FLAGS_SPOT_W = 3;
const NAVE_FLAGS_SPOT_H = 2;
const DAIS_STEPS_SPOT_H = 1;

/** The dais, its west fittings, the aisle and the pew ranks, shared by the layout and its contract rects. */
function templeGeometry() {
  const westWallCol = 1;
  const daisCol = westWallCol + 1;
  const westPerchCol = daisCol;
  const westBannerCol = westPerchCol + 1;
  const westBrazierCol = westBannerCol + 1;
  const westVotiveCol = westBrazierCol;
  const daisRow = 1;
  const altarRow = daisRow + 1;
  const daisFrontRow = altarRow + 1;
  const aisleStartCol = 8;
  const aisleEndCol = aisleStartCol + 1;
  const aisleStartRow = daisFrontRow + 1;
  const firstPewRow = aisleStartRow + 1;
  const pewRowPitch = 2;
  const pewRanks = 4;
  const lastPewRow = firstPewRow + (pewRanks - 1) * pewRowPitch;
  const westPewEndCol = aisleStartCol - 1;
  return {
    westWallCol,
    daisCol,
    westPerchCol,
    westBannerCol,
    westBrazierCol,
    westVotiveCol,
    daisRow,
    altarRow,
    daisFrontRow,
    aisleStartCol,
    aisleEndCol,
    aisleStartRow,
    firstPewRow,
    pewRowPitch,
    pewRanks,
    lastPewRow,
    westPewEndCol,
  };
}

/** The Temple of the Sky's floor rects a construction contract can mark, keyed by spot id. */
export function buildTempleOfTheSkyContractAreas(_w: number, _h: number): ContractAreaRecord {
  const { daisCol, daisFrontRow, westVotiveCol, lastPewRow, westPewEndCol } = templeGeometry();
  return {
    // The dais' front step west of its votive rack: clear of the altar and
    // lectern spots, and of the aisle runner that climbs the step.
    dais: {
      kind: 'floor',
      x: daisCol,
      y: daisFrontRow,
      w: westVotiveCol - daisCol,
      h: DAIS_STEPS_SPOT_H,
    },
    // Behind the back rank, west of the aisle and ending a column short of
    // it: `AnchorInteriorSystem.naveSpawnAnchors` reads the aisle's `RUG`
    // tiles, so the flags never touch them.
    nave_flags: {
      kind: 'floor',
      x: westPewEndCol - NAVE_FLAGS_SPOT_W + 1,
      y: lastPewRow + 1,
      w: NAVE_FLAGS_SPOT_W,
      h: NAVE_FLAGS_SPOT_H,
    },
  };
}

export function buildTempleOfTheSkyLayout(w: number, h: number): TownInteriorLayoutEntry[] {
  const {
    westWallCol,
    daisCol,
    westPerchCol,
    westBannerCol,
    westBrazierCol,
    westVotiveCol,
    daisRow,
    altarRow,
    daisFrontRow,
    aisleStartCol,
    aisleEndCol,
    aisleStartRow,
    firstPewRow,
    pewRowPitch,
    pewRanks,
    lastPewRow,
    westPewEndCol,
  } = templeGeometry();
  const eastWallCol = w - 2;

  // ── Sanctuary ──
  const altarCol = 7;
  const altarWidth = 4;
  const altarEastCol = altarCol + altarWidth - 1;
  const lecternCol = altarCol - 1;
  const westCandelabrumCol = lecternCol - 1;
  const eastCandelabrumCol = altarEastCol + 2;
  const eastPerchCol = eastWallCol - 1;
  const eastBannerCol = eastPerchCol - 1;
  const eastBrazierCol = eastBannerCol - 1;
  const eastVotiveCol = eastBrazierCol - 1;

  // ── Nave ──
  const aisleEndRow = h - 2 - 2;
  const westPewStartCol = 3;
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
    prop(altarCol, altarRow, 'altar', 0, contractTarget(CONTRACT_SITE, 'altar')),
    prop(lecternCol, daisRow, 'lectern', 0, contractTarget(CONTRACT_SITE, 'lectern')),
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
    for (let rx = eastStart; rx <= eastPewEndCol; rx++) {
      const isContractPew = rank === CONTRACT_PEW_RANK && rx === eastPewEndCol;
      entries.push(
        prop(
          rx,
          pewRow,
          'pew',
          pewVariant(rx, rank),
          isContractPew ? contractTarget(CONTRACT_SITE, 'pew') : {},
        ),
      );
    }
    if (isEndRank) {
      entries.push(prop(westPewEndCol, pewRow, 'temple_candelabrum', 1));
      entries.push(prop(eastPewStartCol, pewRow, 'temple_candelabrum', 1));
    }
  }

  for (let ry = scriptureStartRow; ry <= scriptureEndRow; ry++) {
    const isContractShelf = ry === scriptureStartRow;
    entries.push(
      prop(
        westWallCol,
        ry,
        'scripture_shelf',
        ry % 2,
        isContractShelf ? contractTarget(CONTRACT_SITE, 'scripture_shelf') : {},
      ),
    );
    entries.push(prop(eastWallCol, ry, 'scripture_shelf', (ry + 1) % 2));
  }
  entries.push(
    prop(westWallCol, sideBannerRow, 'sky_banner', 0, contractTarget(CONTRACT_SITE, 'banner')),
    prop(eastWallCol, sideBannerRow, 'sky_banner'),
    prop(westWallCol, sidePerchRow, 'perch_stand', 1, contractTarget(CONTRACT_SITE, 'perches')),
    prop(westWallCol, lowerScriptureRow, 'scripture_shelf', 1),
    prop(eastWallCol, lowerScriptureRow, 'scripture_shelf'),
    prop(eastWallCol, sidePerchRow, 'perch_stand'),
    prop(westBenchCol, benchRow, 'pew'),
    prop(westBenchCol + 1, benchRow, 'pew'),
    prop(eastBenchCol, benchRow, 'pew'),
    prop(eastBenchCol + 1, benchRow, 'pew'),
    prop(
      westBenchCol,
      narthexVotiveRow,
      'votive_rack',
      0,
      contractTarget(CONTRACT_SITE, 'votive_rack'),
    ),
    prop(eastBenchCol, narthexVotiveRow, 'votive_rack'),
    prop(westDoorLightCol, doorRow, 'temple_candelabrum', 1),
    prop(eastDoorLightCol, doorRow, 'temple_candelabrum', 1),
    prop(fontCol, fontRow, 'sky_font', 0, contractTarget(CONTRACT_SITE, 'font')),
    prop(offeringTableCol, fontRow, 'offering_table'),
    prop(westWallCol, narthexPerchRow + 1, 'perch_stand'),
    prop(eastWallCol, narthexPerchRow + 1, 'perch_stand', 1),
  );
  return entries;
}
