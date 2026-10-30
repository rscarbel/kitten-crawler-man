/**
 * Where a safe room's doctor's corner goes, and how it gets written into the map.
 *
 * Planning is separated from stamping because two callers need the geometry and
 * only one of them may touch tiles: `stampSafeRoomClinics` writes the cabinet,
 * while `safeRoomAnchorTiles` needs the same tiles to keep furniture, townsfolk,
 * Dave and the bed out of the corner, and runs on maps that may not have been
 * stamped yet.
 *
 * The corner is one row deep, against the room's **north** wall:
 *
 *     ▓▓      medicine cabinet, two tiles wide   (not walkable)
 *     b☺      the bag, and the doctor's tile    (room floor, walkable)
 *
 * North specifically, and not "whichever wall is furthest from a door": the
 * game's oblique projection has a fixed viewpoint to the south, so props are
 * drawn as though seen slightly from the front. On the north wall the cabinet
 * shows its glass doors and the doctor stands in front of it facing the room. On
 * the south wall both would be seen from behind, and no amount of mirroring
 * fixes that — a mirrored face is not a face. The door logic therefore picks the
 * corner's columns rather than its wall.
 *
 * The doctor and the bag stand on ordinary floor, so nothing is sealed off and
 * the rest of the room's floor stays open.
 */

import type { GameMap } from './GameMap';
import { isFieldStation, guideAndBedTiles } from './safeRoomFixtures';
import { SAFE_ROOM_MEDICINE_CABINET, placeProp } from './tileTypes';

/** The medicine cabinet's width. */
const CABINET_WIDTH_TILES = 2;
/** Columns left clear between the cabinet and each of the room's side walls. */
const CLINIC_WALL_MARGIN_TILES = 1;
/** Rows the corner occupies: the cabinet, then the doctor's row in front of it. */
const CLINIC_DEPTH_TILES = 2;
/**
 * Which of the cabinet's two columns the doctor stands in front of: the east
 * one, under the lamp, so the bag sits on the floor before the west one.
 */
const DOCTOR_COLUMN_INDEX = 1;
const BAG_COLUMN_INDEX = 0;

type Tile = { x: number; y: number };

export interface SafeRoomClinicLayout {
  /**
   * Index into `map.safeRooms` of the room this corner belongs to.
   *
   * Carried explicitly because a room can be skipped: the layout list is not
   * index-aligned with `map.safeRooms`, and treating it as though it were would
   * put every doctor after a skipped room in the wrong room.
   */
  safeRoomIndex: number;
  /** The room's own bounds, so consumers need not re-look it up to test presence. */
  roomBounds: { x: number; y: number; w: number; h: number };
  /** The cabinet, west tile then east tile. */
  cabinetTiles: readonly [Tile, Tile];
  /** Where the doctor stands: the floor tile in front of the cabinet's east half. */
  doctorTile: Tile;
  /** The floor tile in front of the cabinet's west half, where the doctor's bag sits. */
  bagTile: Tile;
}

/**
 * Rows south of the doctor's tile in which Dave's arrival tile keeps the
 * corner out of his column.
 *
 * A safe room's talk press goes to whichever of the two is nearer. With Dave
 * two rows straight below the doctor, the one tile between them is as near
 * one as the other, so a player walking from the doctor to Dave could never
 * reach a tile beside him that is his. Three rows apart, the tile in front of
 * him is plainly nearer him.
 */
const GUIDE_ROWS_CLEAR_OF_DOCTOR = 2;

/** A room too shallow to hold the corner plus a walkway south of it is skipped. */
const MIN_ROOM_HEIGHT_FOR_CLINIC = CLINIC_DEPTH_TILES + 1;
/**
 * Narrowest room that can hold the corner at all: the cabinet plus a clear
 * column against each side wall.
 *
 * Rooms narrower than this get no corner. No generator produces a safe room
 * this narrow (`DungeonGenerator` floors at 7 tiles, and both scripted safe
 * rooms are wider), so this is a guard rather than a live branch.
 */
const MIN_ROOM_WIDTH_FOR_CLINIC = CABINET_WIDTH_TILES + CLINIC_WALL_MARGIN_TILES * 2;

/**
 * Rows south of the north wall the cabinet may stand on, in order of preference.
 *
 * Against the wall reads best, but a north wall can be so cut up by doorways
 * that no two adjacent columns are free of them. Dropping the cabinet one row
 * south solves that outright: the doorways then open onto the row *above* it,
 * which stays floor, so door columns stop constraining it at all. Every safe
 * room gets a doctor, so there has to be a second option.
 */
const CABINET_ROW_OFFSETS: ReadonlyArray<number> = [0, 1];

/**
 * Columns of the room's north wall that open onto something walkable — the
 * doorways the cabinet must not cover.
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
    if (map.isWalkableIgnoringPermanent(x, bounds.y - 1, 'walker')) columns.add(x);
  }
  return columns;
}

/**
 * The widest run of columns inside the room's usable span that avoids every
 * blocked column, as `{ x0, width }`.
 *
 * Doorway columns are blocked because a cabinet covering one would seal that
 * entrance: the cabinet is solid, so the tile the corridor opens into would stop
 * being walkable and the room could lose its only way in. Avoiding those columns
 * entirely — rather than merely maximising distance from them — is what makes
 * that impossible.
 *
 * Exported so `verify-interiors.ts` can exercise the exclusion directly: the
 * outcome check elsewhere in that script only ever inspects the corner that
 * lands on the town's own current geometry, which says nothing about the
 * mechanism if no door on that geometry happens to fall where the cabinet
 * would go anyway.
 */
export function widestFreeSpan(
  bounds: { x: number; y: number; w: number; h: number },
  blockedColumns: ReadonlySet<number>,
): { x0: number; width: number } {
  const firstX = bounds.x + CLINIC_WALL_MARGIN_TILES;
  const lastX = bounds.x + bounds.w - 1 - CLINIC_WALL_MARGIN_TILES;

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

function layoutForCorner(
  safeRoomIndex: number,
  bounds: { x: number; y: number; w: number; h: number },
  cabinetRow: number,
  x0: number,
): SafeRoomClinicLayout {
  const floorRow = cabinetRow + 1;
  return {
    safeRoomIndex,
    roomBounds: bounds,
    cabinetTiles: [
      { x: x0, y: cabinetRow },
      { x: x0 + 1, y: cabinetRow },
    ],
    doctorTile: { x: x0 + DOCTOR_COLUMN_INDEX, y: floorRow },
    bagTile: { x: x0 + BAG_COLUMN_INDEX, y: floorRow },
  };
}

/**
 * Plan a doctor's corner for every safe room on the map, without touching a tile.
 *
 * Pure and deterministic for a given map, so it can be called repeatedly — once
 * to stamp, once per interior-occupant pass — and always answer the same thing.
 *
 * The corner takes the west end of the widest door-free span, so it tucks
 * toward the room's north-west corner and leaves the middle of the room open.
 */
export function planSafeRoomClinics(map: GameMap): ReadonlyArray<SafeRoomClinicLayout> {
  const layouts: SafeRoomClinicLayout[] = [];
  for (let safeRoomIndex = 0; safeRoomIndex < map.safeRooms.length; safeRoomIndex++) {
    const safeRoom = map.safeRooms[safeRoomIndex];
    if (isFieldStation(safeRoom)) continue;
    const bounds = safeRoom.bounds;
    if (bounds.h < MIN_ROOM_HEIGHT_FOR_CLINIC || bounds.w < MIN_ROOM_WIDTH_FOR_CLINIC) continue;

    const doorColumns = doorColumnsOnNorthWall(map, bounds);
    const fixtureTiles = guideAndBedTiles(safeRoom);
    const [guideTile] = fixtureTiles;
    // A town building's safe room shares its floor with the building's own
    // furniture — the inn's hearth, its bar — which keeps its tile type as floor
    // and so is invisible to every check above.
    const furnitureTiles = map.placedInteriorPropFootprintTiles();

    for (const rowOffset of CABINET_ROW_OFFSETS) {
      const cabinetRow = bounds.y + rowOffset;
      // Leave at least one row of floor south of the doctor for the player to stand on.
      const lastCornerRow = cabinetRow + CLINIC_DEPTH_TILES - 1;
      if (lastCornerRow >= bounds.y + bounds.h - 1) continue;

      const blockedColumns = new Set<number>(rowOffset === 0 ? doorColumns : []);
      // Dave, the bed and the furniture own their own tiles. Only their *columns*
      // are out of bounds, and only when the corner's rows would reach their row —
      // blocking the whole row instead could cost a narrow room its doctor.
      for (const tile of [...fixtureTiles, ...furnitureTiles]) {
        if (tile.y >= cabinetRow && tile.y <= lastCornerRow) blockedColumns.add(tile.x);
      }
      const guideTooCloseBelow =
        guideTile.y > lastCornerRow && guideTile.y <= lastCornerRow + GUIDE_ROWS_CLEAR_OF_DOCTOR;
      if (guideTooCloseBelow) blockedColumns.add(guideTile.x);

      const span = widestFreeSpan(bounds, blockedColumns);
      if (span.width < CABINET_WIDTH_TILES) continue;
      layouts.push(layoutForCorner(safeRoomIndex, bounds, cabinetRow, span.x0));
      break;
    }
  }
  return layouts;
}

/** Every tile a corner claims: the cabinet, the doctor's tile and the bag's. */
export function clinicCornerTiles(layout: SafeRoomClinicLayout): ReadonlyArray<Tile> {
  return [...layout.cabinetTiles, layout.doctorTile, layout.bagTile];
}

/**
 * Write every safe room's medicine cabinet into the map and return the layouts.
 *
 * Safe to run more than once on the same map: `planSafeRoomClinics` is
 * deterministic, so a second pass targets the same tiles, and `placeProp`
 * records the floor it replaced with `??=` so re-stamping cannot record the
 * cabinet as its own ground. The permanent block mask is deliberately untouched
 * — the cabinet blocks by tile type, which is rebuilt from the structure.
 */
export function stampSafeRoomClinics(map: GameMap): ReadonlyArray<SafeRoomClinicLayout> {
  const layouts = planSafeRoomClinics(map);
  for (const layout of layouts) {
    // Unchecked indexing is safe here: every tile came from a safe room's own
    // bounds, and a room's bounds are carved inside the grid.
    for (const tile of layout.cabinetTiles) {
      placeProp(map.structure[tile.y][tile.x], SAFE_ROOM_MEDICINE_CABINET);
      map.markTileDirty(tile.x, tile.y);
    }
  }
  return layouts;
}
