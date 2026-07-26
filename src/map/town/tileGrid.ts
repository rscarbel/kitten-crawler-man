/**
 * Bounds-checked write primitives over an overworld tile grid.
 *
 * The town painters and the generator's wilderness passes all mutate the same
 * grid, so the rules about what may be overwritten (never a wall, a roof, a
 * building sprite or the void border) live here once instead of being restated
 * at every call site.
 */

import type { FenceStyle, TileContent } from '../tileTypes';
import {
  FloorTypeValue,
  VOID_TYPE,
  BUILDING_WALL,
  ROOF_THATCH,
  ROOF_SLATE,
  ROOF_RED,
  ROOF_GREEN,
  ROOF_CIRCUS_RED,
  ROOF_CIRCUS_BLUE,
  ROOF_CIRCUS_PURPLE,
  SPRITE_BUILDING,
  TOWN_WALL,
  COBBLE_STREET,
  DIRT_PATCH,
  FENCE,
  LANE_STREET,
  PLAZA_STONE,
  YARD_GRAVEL,
} from '../tileTypes';
import type { TileRect } from './townPlan';

/**
 * Tiles that block movement and may never be painted over. The void border is
 * included: roads must stop at the map edge rather than run into it.
 */
const SOLID_TILE_TYPES: ReadonlySet<number> = new Set([
  BUILDING_WALL,
  VOID_TYPE,
  ROOF_THATCH,
  ROOF_SLATE,
  ROOF_RED,
  ROOF_GREEN,
  ROOF_CIRCUS_RED,
  ROOF_CIRCUS_BLUE,
  ROOF_CIRCUS_PURPLE,
  SPRITE_BUILDING,
  TOWN_WALL,
  FENCE,
]);

/**
 * Every surface a route may run over — six of them: the packed-earth track used
 * for alleys and for everything outside the walls, the town's four made surfaces
 * (yard, lane, main street and plaza), and `DIRT_PATCH`, a worn patch *of* a track
 * that therefore does not sever one.
 *
 * `VERGE_GRASS` is deliberately absent. It is the town's soft ground — the thing
 * a street is laid *on* — so treating it as paving would make every garden and
 * every wall base count as a route.
 */
const PAVED_TILE_TYPES: ReadonlySet<number> = new Set([
  FloorTypeValue.road,
  DIRT_PATCH,
  YARD_GRAVEL,
  LANE_STREET,
  COBBLE_STREET,
  PLAZA_STONE,
]);

export class TileGrid {
  readonly cells: TileContent[][];

  constructor(
    readonly size: number,
    fillType: number = FloorTypeValue.grass,
  ) {
    this.cells = Array.from({ length: size }, (_, y) =>
      Array.from({ length: size }, (_, x) => ({ tileId: `${x}#${y}`, type: fillType })),
    );
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.size && y >= 0 && y < this.size;
  }

  /** Tile type at (x, y), or `undefined` outside the grid. */
  typeAt(x: number, y: number): number | undefined {
    if (!this.inBounds(x, y)) return undefined;
    return this.cells[y][x].type;
  }

  /**
   * Writes a tile type, ignoring out-of-bounds writes.
   *
   * Clears any recorded ground, because a plain write replaces the thing that
   * recorded it. Without this a later pass leaves a stale record behind: the
   * circus torches are written before `paintForests`, and a `TREE` landing on one
   * inherited its record and became a forest tree claiming to stand on the
   * circus's packed earth — about two per generation, harmless only because
   * nothing consults a record on a tile that has a material of its own.
   */
  set(x: number, y: number, type: number): void {
    if (!this.inBounds(x, y)) return;
    const cell = this.cells[y][x];
    cell.type = type;
    delete cell.groundType;
  }

  /**
   * Writes a tile type together with the sprite key that selects its art.
   *
   * Clears any recorded ground for the same reason `set` does. Unreachable today
   * — the one caller runs before every `setStanding` site — but `floorTypeAt`
   * consults a record *before* rejecting non-floor types, so a record surviving
   * under a building anchor would make that anchor answer "floor" to every
   * neighbouring probe. That is the stale-`TREE` defect one tile type up.
   */
  setSprite(x: number, y: number, type: number, spriteKey: string): void {
    if (!this.inBounds(x, y)) return;
    const cell = this.cells[y][x];
    cell.type = type;
    cell.spriteKey = spriteKey;
    delete cell.groundType;
  }

  /**
   * Writes a prop that stands *on* the ground, remembering the surface it
   * replaced so the renderers do not have to infer it from a neighbour.
   *
   * Inference takes the first cardinal neighbour it finds, and that probe starts
   * to the south — so a prop on the south edge of anything renders as whatever
   * lies outside it. For a fence along a yard's southern perimeter that is the
   * street, and the yard's own surface stops a row short.
   */
  setStanding(x: number, y: number, type: number): void {
    if (!this.inBounds(x, y)) return;
    const cell = this.cells[y][x];
    // Guard against a second prop landing on the first: recording `FENCE` or
    // `TORCH` as a tile's ground would be worse than not recording anything.
    cell.groundType ??= cell.type;
    cell.type = type;
  }

  /**
   * A fence, together with the style it is built in.
   *
   * `setStanding` for the reason that method documents — a fence has to remember
   * the surface it was driven into — plus the style, which the renderer reads off
   * the tile because it is handed a grid and a position, not a plan.
   */
  setFence(x: number, y: number, style: FenceStyle): void {
    if (!this.inBounds(x, y)) return;
    this.setStanding(x, y, FENCE);
    this.cells[y][x].fenceStyle = style;
  }

  /** `setStanding` over a rectangle, for props that occupy more than one tile. */
  fillStanding(rect: TileRect, type: number): void {
    for (let dy = 0; dy < rect.h; dy++) {
      for (let dx = 0; dx < rect.w; dx++) this.setStanding(rect.x + dx, rect.y + dy, type);
    }
  }

  fill(rect: TileRect, type: number): void {
    for (let dy = 0; dy < rect.h; dy++) {
      for (let dx = 0; dx < rect.w; dx++) this.set(rect.x + dx, rect.y + dy, type);
    }
  }

  /** True for out-of-bounds tiles too, so callers can treat the map edge as a wall. */
  isSolid(x: number, y: number): boolean {
    const type = this.typeAt(x, y);
    if (type === undefined) return true;
    return SOLID_TILE_TYPES.has(type);
  }

  /** Lays a paving material unless something solid already stands there. */
  setPaved(x: number, y: number, type: number): void {
    if (this.isSolid(x, y)) return;
    this.set(x, y, type);
  }

  /**
   * True on any of the town's street materials or on an out-of-town track.
   *
   * The bypass router asks this rather than "is this the road type", because
   * under a street plan a route runs over any of the six surfaces above, and a
   * lane severed by a tent is severed just the same as a track would be.
   */
  isPaved(x: number, y: number): boolean {
    const type = this.typeAt(x, y);
    return type !== undefined && PAVED_TILE_TYPES.has(type);
  }
}
