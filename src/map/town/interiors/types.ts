/**
 * The data shape every town building's interior layout file exports.
 *
 * `GameMap.generateInterior` is a generic consumer of this shape: it holds no
 * per-building logic, only the rules for applying whichever entries a
 * building's layout file hands it. A 'prop' entry places an
 * instance from `TOWN_INTERIOR_PROPS` — its footprint is blocked and it
 * joins the room's Y-sorted render pass. A 'tile' entry writes a tile type
 * directly into the grid, for walls, doorway gaps, floor-material overrides
 * (a stone dais, raked drill sand) and the bespoke fixtures the shared prop
 * library has no painted equivalent for (a weapon rack, a muster board, a
 * grinding slab). `smashable: true` on a 'tile' entry routes it through
 * `placeProp`, recording the floor underneath so a later break can restore it.
 *
 * A 'prop' entry's `(x, y)` names the footprint's **north-west** tile: the
 * top-left corner, with the footprint running south across the prop's
 * height and east across its width. `GameMap.applyTownInteriorLayout`'s
 * blocking loop, `drawTownInteriorProp` and `townInteriorPropSortY` all read
 * it this way — the one convention the ink gate's footprint-anchor-agreement
 * check holds them to.
 */

import type { TownInteriorPropId } from '../../../sprites/art/townInterior/townInteriorProps';

export interface TownInteriorPropEntry {
  readonly kind: 'prop';
  readonly x: number;
  readonly y: number;
  readonly propId: TownInteriorPropId;
  readonly variant?: number;
  /**
   * A cross-regeneration-stable id for this exact placed instance, used to
   * key a payout record (a room's `GameMap` — and with it `placedInteriorProps`'
   * array order — is rebuilt fresh every visit). Defaults to `propId@x,y`,
   * which is already stable as long as a building's layout doesn't move the
   * instance; set explicitly only when a layout wants to keep an id fixed
   * across a future position edit.
   */
  readonly id?: string;
  /**
   * Overrides the prop's own `destructible.dropsLootByDefault` for this one
   * placed instance — the same prop id is junk in a storeroom and shop
   * merchandise on a General Store shelf, and only the layout knows which.
   */
  readonly dropsLoot?: boolean;
}

/** The stable id a payout record keys on for one placed prop entry. */
export function stableInteriorPropId(entry: TownInteriorPropEntry): string {
  return entry.id ?? `${entry.propId}@${entry.x},${entry.y}`;
}

export interface TownInteriorTileEntry {
  readonly kind: 'tile';
  readonly x: number;
  readonly y: number;
  readonly tileType: number;
  readonly smashable?: boolean;
}

export type TownInteriorLayoutEntry = TownInteriorPropEntry | TownInteriorTileEntry;

/** A building's whole authored layout: every entry `generateInterior` applies after carving the room's floor. */
export type TownInteriorLayout = ReadonlyArray<TownInteriorLayoutEntry>;

export function tile(x: number, y: number, tileType: number): TownInteriorTileEntry {
  return { kind: 'tile', x, y, tileType };
}

export function smashableTile(x: number, y: number, tileType: number): TownInteriorTileEntry {
  return { kind: 'tile', x, y, tileType, smashable: true };
}

export function prop(
  x: number,
  y: number,
  propId: TownInteriorPropId,
  variant = 0,
  options: { readonly id?: string; readonly dropsLoot?: boolean } = {},
): TownInteriorPropEntry {
  return { kind: 'prop', x, y, propId, variant, id: options.id, dropsLoot: options.dropsLoot };
}

/** A run of the same tile type along a row, inclusive of both ends. */
export function tileRow(
  y: number,
  xStart: number,
  xEnd: number,
  tileType: number,
): TownInteriorTileEntry[] {
  const entries: TownInteriorTileEntry[] = [];
  for (let x = xStart; x <= xEnd; x++) entries.push(tile(x, y, tileType));
  return entries;
}

/** A run of the same tile type down a column, inclusive of both ends. */
export function tileColumn(
  x: number,
  yStart: number,
  yEnd: number,
  tileType: number,
): TownInteriorTileEntry[] {
  const entries: TownInteriorTileEntry[] = [];
  for (let y = yStart; y <= yEnd; y++) entries.push(tile(x, y, tileType));
  return entries;
}

/** A filled rectangle of one tile type, inclusive of both ends. */
export function tileRect(
  xStart: number,
  yStart: number,
  xEnd: number,
  yEnd: number,
  tileType: number,
): TownInteriorTileEntry[] {
  const entries: TownInteriorTileEntry[] = [];
  for (let y = yStart; y <= yEnd; y++)
    for (let x = xStart; x <= xEnd; x++) entries.push(tile(x, y, tileType));
  return entries;
}
