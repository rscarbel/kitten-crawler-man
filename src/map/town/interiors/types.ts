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
 * grinding slab).
 *
 * A 'prop' entry's `(x, y)` names the footprint's **north-west** tile: the
 * top-left corner, with the footprint running south across the prop's
 * height and east across its width. `GameMap.applyTownInteriorLayout`'s
 * blocking loop, `drawTownInteriorProp` and `townInteriorPropSortY` all read
 * it this way — the one convention the ink gate's footprint-anchor-agreement
 * check holds them to.
 */

import type {
  KnockableTownInteriorPropId,
  LobbedKnockableTownInteriorPropId,
  StatefulTownInteriorPropId,
  StatelessTownInteriorPropId,
  ToppledKnockableTownInteriorPropId,
} from '../../../sprites/art/townInterior/townInteriorProps';
import type { KnockOffPlacement, LobbedKnockOff, ToppledKnockOff } from '../../interiorMechanisms';
import { contractPropId } from '../../contractAreas';
import type { PlannedBuildingId } from '../../buildingIds';

interface TownInteriorPropEntryBase {
  readonly kind: 'prop';
  readonly x: number;
  readonly y: number;
  readonly variant?: number;
  /**
   * Overrides the prop's own `destructible.dropsLootByDefault` for this one
   * placed instance — the same prop id is junk in a storeroom and shop
   * merchandise on a General Store shelf, and only the layout knows which.
   */
  readonly dropsLoot?: boolean;
}

/**
 * A placed prop the room's save remembers (a breakable's payout, a searched
 * container). Its id is written in the layout, unique within the room, and
 * is what the save keys it by, so moving the prop keeps its state.
 */
interface StatefulTownInteriorPropEntry extends TownInteriorPropEntryBase {
  readonly propId: Exclude<StatefulTownInteriorPropId, KnockableTownInteriorPropId>;
  readonly id: string;
}

/** A prop a cat can knock off a ledge, placed with where it falls and what its landing does. */
interface KnockableTownInteriorPropEntry extends TownInteriorPropEntryBase {
  readonly propId: KnockableTownInteriorPropId;
  readonly id: string;
  readonly knockOff: KnockOffPlacement;
}

/**
 * A placed prop with nothing saved. It needs an id only when something else
 * names it (a construction contract spot, via {@link contractTarget}).
 */
interface StatelessTownInteriorPropEntry extends TownInteriorPropEntryBase {
  readonly propId: StatelessTownInteriorPropId;
  readonly id?: string;
}

export type TownInteriorPropEntry =
  StatefulTownInteriorPropEntry | KnockableTownInteriorPropEntry | StatelessTownInteriorPropEntry;

/**
 * The id a placed prop goes by within its room. A prop without one in its
 * layout is named by its tile; nothing is saved against such an id, so a
 * moved prop loses nothing.
 */
export function placedInteriorPropId(entry: TownInteriorPropEntry): string {
  return entry.id ?? `${entry.propId}@${entry.x},${entry.y}`;
}

export interface TownInteriorTileEntry {
  readonly kind: 'tile';
  readonly x: number;
  readonly y: number;
  readonly tileType: number;
}

export type TownInteriorLayoutEntry = TownInteriorPropEntry | TownInteriorTileEntry;

export function tile(x: number, y: number, tileType: number): TownInteriorTileEntry {
  return { kind: 'tile', x, y, tileType };
}

export function prop(
  x: number,
  y: number,
  propId: StatelessTownInteriorPropId,
  variant = 0,
  options: { readonly id?: string; readonly dropsLoot?: boolean } = {},
): TownInteriorPropEntry {
  return { kind: 'prop', x, y, propId, variant, id: options.id, dropsLoot: options.dropsLoot };
}

/** A small prop a cat can bat off a ledge, under `id`, falling and landing as `knockOff` says. */
export function knockableProp(
  x: number,
  y: number,
  propId: LobbedKnockableTownInteriorPropId,
  id: string,
  knockOff: LobbedKnockOff,
  variant = 0,
): TownInteriorPropEntry {
  return { kind: 'prop', x, y, propId, id, variant, knockOff };
}

/** A long prop a cat can push over where it stands, under `id`, toppling as `knockOff` says. */
export function toppleableProp(
  x: number,
  y: number,
  propId: ToppledKnockableTownInteriorPropId,
  id: string,
  knockOff: ToppledKnockOff,
  variant = 0,
): TownInteriorPropEntry {
  return { kind: 'prop', x, y, propId, id, variant, knockOff };
}

/** A prop the room's save remembers, under `id`: see `StatefulTownInteriorPropId`. */
export function statefulProp(
  x: number,
  y: number,
  propId: Exclude<StatefulTownInteriorPropId, KnockableTownInteriorPropId>,
  id: string,
  variant = 0,
  options: { readonly dropsLoot?: boolean } = {},
): TownInteriorPropEntry {
  return { kind: 'prop', x, y, propId, id, variant, dropsLoot: options.dropsLoot };
}

/**
 * The id that makes an entry the target of a construction contract spot. A
 * contract finds its prop by this id alone, so an entry carrying it can move
 * freely within its layout.
 */
export function contractTargetId(buildingId: PlannedBuildingId, spotId: string): string {
  return contractPropId(buildingId, spotId);
}

/** The `prop` options carrying {@link contractTargetId}. */
export function contractTarget(
  buildingId: PlannedBuildingId,
  spotId: string,
): { readonly id: string } {
  return { id: contractTargetId(buildingId, spotId) };
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
