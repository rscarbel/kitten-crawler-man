/**
 * The service level's furniture as map data: which tile types it is, which of
 * them are solid, which are seen past, and how a piece wider than one tile is
 * laid out on the grid.
 *
 * Grouped here so every registry that has to know about them — walkability,
 * sight, the two decoration passes, the floor probe — spreads one set rather
 * than listing fourteen types, and a new piece is added in one place.
 *
 * A multi-tile piece is written as one anchor tile, the south-west tile of its
 * footprint, and `PROP_PART_LOW` or `PROP_PART_TALL` on every other tile. The
 * anchor draws the whole piece and sorts on its foot; the parts only block. A
 * part does not record which piece it belongs to: placement never lets two
 * footprints overlap, so the anchor is always the one whose footprint, laid
 * from the south-west, covers the part.
 */

import {
  BOILER,
  CELLAR_TABLE,
  FALLEN_BEAM,
  RUBBLE_SLOPE,
  SARCOPHAGUS,
  WINE_CASK,
  CABLE_BUNDLE,
  DROPPED_TOWEL,
  FILING_CABINET,
  GAS_CYLINDER,
  LOCKER_BANK,
  LOCKER_BENCH,
  MOP_BUCKET,
  PALLET_STACK,
  PAPER_DRIFT,
  PROP_PART_LOW,
  PROP_PART_TALL,
  SERVICE_DESK,
  VENDING_MACHINE,
  type TileContent,
} from './tileTypes';

/** Solid service-level pieces drawn in the Y-sorted pass. The part tiles are not: their anchor draws them. */
export const SERVICE_PROP_TILE_TYPES: ReadonlySet<number> = new Set([
  GAS_CYLINDER,
  LOCKER_BANK,
  FILING_CABINET,
  MOP_BUCKET,
  PALLET_STACK,
  VENDING_MACHINE,
  SERVICE_DESK,
  LOCKER_BENCH,
  BOILER,
]);

/** The tiles of a multi-tile piece other than its anchor. Solid, and drawn as bare floor. */
export const PROP_PART_TILE_TYPES: ReadonlySet<number> = new Set([PROP_PART_LOW, PROP_PART_TALL]);

/** Every solid service-level tile, anchors and parts. */
export const SERVICE_SOLID_TILE_TYPES: ReadonlySet<number> = new Set([
  ...SERVICE_PROP_TILE_TYPES,
  ...PROP_PART_TILE_TYPES,
]);

/** Walkable service-level clutter, baked flat into the floor. */
export const SERVICE_DECAL_TILE_TYPES: ReadonlySet<number> = new Set([
  CABLE_BUNDLE,
  PAPER_DRIFT,
  DROPPED_TOWEL,
]);

/**
 * Solid pieces low or slim enough to see and shoot past. A crawler crouched
 * behind a mop bucket is not hidden by it, and a gas bottle is a pole.
 */
export const SERVICE_SIGHT_TRANSPARENT_TILE_TYPES: ReadonlySet<number> = new Set([
  GAS_CYLINDER,
  MOP_BUCKET,
  PALLET_STACK,
  SERVICE_DESK,
  LOCKER_BENCH,
  PROP_PART_LOW,
]);

/** Every service-level tile type the tile renderer paints. */
export const SERVICE_LEVEL_TILE_TYPES: ReadonlySet<number> = new Set([
  ...SERVICE_SOLID_TILE_TYPES,
  ...SERVICE_DECAL_TILE_TYPES,
]);

/** Tiles across and down a multi-tile piece covers. */
export interface MultiTileFootprint {
  readonly w: number;
  readonly h: number;
  /** What every non-anchor tile of the piece is written as. */
  readonly partType: number;
}

/** Every multi-tile anchor type and its footprint. A type absent here is one tile. */
export const MULTI_TILE_PROP_FOOTPRINTS: ReadonlyMap<number, MultiTileFootprint> = new Map([
  [SERVICE_DESK, { w: 2, h: 1, partType: PROP_PART_LOW }],
  [LOCKER_BENCH, { w: 2, h: 1, partType: PROP_PART_LOW }],
  [BOILER, { w: 2, h: 2, partType: PROP_PART_TALL }],
  // The cellars' two-tile pieces are laid the same way.
  [WINE_CASK, { w: 2, h: 1, partType: PROP_PART_LOW }],
  [CELLAR_TABLE, { w: 2, h: 1, partType: PROP_PART_LOW }],
  [FALLEN_BEAM, { w: 2, h: 1, partType: PROP_PART_LOW }],
  [RUBBLE_SLOPE, { w: 2, h: 1, partType: PROP_PART_LOW }],
  [SARCOPHAGUS, { w: 2, h: 1, partType: PROP_PART_LOW }],
]);

export interface TilePos {
  readonly x: number;
  readonly y: number;
}

/** The tiles a piece anchored at (anchorX, anchorY) covers, anchor first. */
export function multiTileFootprintTiles(
  anchorX: number,
  anchorY: number,
  footprint: Pick<MultiTileFootprint, 'w' | 'h'>,
): TilePos[] {
  const tiles: TilePos[] = [{ x: anchorX, y: anchorY }];
  for (let dy = 0; dy < footprint.h; dy++) {
    for (let dx = 0; dx < footprint.w; dx++) {
      if (dx === 0 && dy === 0) continue;
      tiles.push({ x: anchorX + dx, y: anchorY - dy });
    }
  }
  return tiles;
}

/**
 * The anchor of the multi-tile piece a part tile belongs to, or null when the
 * tile is not a part or no anchor's footprint covers it.
 */
export function multiTileAnchorOf(
  structure: ReadonlyArray<ReadonlyArray<TileContent>>,
  tx: number,
  ty: number,
): TilePos | null {
  const row = ty >= 0 && ty < structure.length ? structure[ty] : null;
  if (row === null || tx < 0 || tx >= row.length) return null;
  const partType = row[tx].type;
  if (!PROP_PART_TILE_TYPES.has(partType)) return null;
  for (const [anchorType, footprint] of MULTI_TILE_PROP_FOOTPRINTS) {
    if (footprint.partType !== partType) continue;
    for (let dy = 0; dy < footprint.h; dy++) {
      for (let dx = 0; dx < footprint.w; dx++) {
        const anchorX = tx - dx;
        const anchorY = ty + dy;
        if (structure[anchorY]?.[anchorX]?.type === anchorType) return { x: anchorX, y: anchorY };
      }
    }
  }
  return null;
}

/**
 * The tile type each cell of a piece is written as, in the order
 * `cells` lists them: the south-west cell takes `anchorType`, every other the
 * footprint's part type. A one-tile type writes `anchorType` everywhere.
 */
export function multiTilePieceTypes(anchorType: number, cells: ReadonlyArray<TilePos>): number[] {
  const footprint = MULTI_TILE_PROP_FOOTPRINTS.get(anchorType);
  if (footprint === undefined || cells.length === 0) return cells.map(() => anchorType);
  const anchorX = Math.min(...cells.map((cell) => cell.x));
  const anchorY = Math.max(...cells.map((cell) => cell.y));
  return cells.map((cell) =>
    cell.x === anchorX && cell.y === anchorY ? anchorType : footprint.partType,
  );
}
