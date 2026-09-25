/**
 * Ground a generator pass must leave alone.
 *
 * Every wilderness pass that places something — a river, a forest blob, a ruin
 * shell, a camp, an ambient spawn, a boulder — has to stay off the landmarks laid
 * out before it. Each used to restate its own geometry test ("within the circus
 * radius plus a buffer"), and a restated test is one that drifts. A `KeepOut` is
 * the one shape all of them ask, so adding a landmark is adding a shape rather
 * than editing a dozen passes.
 */

import type { TilePoint, TileRect } from '../town/townPlan';

/** A disc of tiles: every tile whose centre lies within `radiusTiles` of `centre`. */
export interface KeepOutDisc {
  readonly kind: 'disc';
  readonly centre: TilePoint;
  readonly radiusTiles: number;
}

/** A rectangle of tiles, `x`/`y` inclusive and `w`/`h` wide. */
export interface KeepOutRect {
  readonly kind: 'rect';
  readonly rect: TileRect;
}

export type KeepOutShape = KeepOutDisc | KeepOutRect;

/** Whether one shape covers the tile at (x, y). */
function shapeContains(shape: KeepOutShape, x: number, y: number): boolean {
  if (shape.kind === 'disc') {
    return Math.hypot(x - shape.centre.x, y - shape.centre.y) <= shape.radiusTiles;
  }
  const { rect } = shape;
  return x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h;
}

/** How far the tile at (x, y) is from a shape's edge, in tiles; 0 inside it. */
function shapeDistance(shape: KeepOutShape, x: number, y: number): number {
  if (shape.kind === 'disc') {
    return Math.max(0, Math.hypot(x - shape.centre.x, y - shape.centre.y) - shape.radiusTiles);
  }
  const { rect } = shape;
  const dx = Math.max(rect.x - x, 0, x - (rect.x + rect.w - 1));
  const dy = Math.max(rect.y - y, 0, y - (rect.y + rect.h - 1));
  return Math.hypot(dx, dy);
}

/** The smallest disc containing a shape — what a disc-only consumer can steer around. */
function enclosingDisc(shape: KeepOutShape): KeepOutDisc {
  if (shape.kind === 'disc') return shape;
  const { rect } = shape;
  const halfW = rect.w / 2;
  const halfH = rect.h / 2;
  return {
    kind: 'disc',
    centre: { x: rect.x + halfW, y: rect.y + halfH },
    radiusTiles: Math.hypot(halfW, halfH),
  };
}

/** A shape grown outward by `marginTiles` on every side. */
export function grownShape(shape: KeepOutShape, marginTiles: number): KeepOutShape {
  if (shape.kind === 'disc') {
    return { kind: 'disc', centre: shape.centre, radiusTiles: shape.radiusTiles + marginTiles };
  }
  return { kind: 'rect', rect: grownRect(shape.rect, marginTiles) };
}

/** A rectangle grown outward by `marginTiles` on every side. */
export function grownRect(rect: TileRect, marginTiles: number): TileRect {
  return {
    x: rect.x - marginTiles,
    y: rect.y - marginTiles,
    w: rect.w + marginTiles * 2,
    h: rect.h + marginTiles * 2,
  };
}

/** A union of discs and rectangles, asked one tile at a time. */
export class KeepOut {
  static readonly NONE = new KeepOut([]);

  constructor(readonly shapes: ReadonlyArray<KeepOutShape>) {}

  /** True when any shape covers the tile at (x, y). */
  contains(x: number, y: number): boolean {
    for (const shape of this.shapes) {
      if (shapeContains(shape, x, y)) return true;
    }
    return false;
  }

  /**
   * How far the tile at (x, y) is from the nearest shape, in tiles; 0 inside
   * one, and `Infinity` for an empty union. What a disc-shaped landmark (a
   * camp, the circus) compares its own radius against.
   */
  distanceTo(x: number, y: number): number {
    let nearest = Infinity;
    for (const shape of this.shapes) nearest = Math.min(nearest, shapeDistance(shape, x, y));
    return nearest;
  }

  /** The same union with every shape grown by `marginTiles`. */
  grown(marginTiles: number): KeepOut {
    return new KeepOut(this.shapes.map((shape) => grownShape(shape, marginTiles)));
  }

  /** This union together with another. */
  union(other: KeepOut): KeepOut {
    return new KeepOut([...this.shapes, ...other.shapes]);
  }

  /**
   * One enclosing disc per shape.
   *
   * For consumers that steer rather than test — the river router slides a course
   * around the edge of a disc, which has no equivalent for a rectangle's corner —
   * a disc that contains the rectangle keeps the same promise, a little wider.
   */
  enclosingDiscs(): KeepOutDisc[] {
    return this.shapes.map(enclosingDisc);
  }
}
