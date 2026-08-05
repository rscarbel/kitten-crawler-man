/**
 * Fences and plants the town's block interiors.
 *
 * Runs after the buildings are placed, because a fence has to know what art it
 * would otherwise run through, and before the outdoor ground scatter, because a
 * planted bed is a claim on a tile that the scatter must not then overwrite.
 *
 * Two passes, and they are separate for a reason: the fence is the yard's
 * boundary and is exact, while the planting inside it is random. Deciding both
 * in one sweep would make the fence's continuity depend on a dice roll.
 */

import { GARDEN_PLANTING, VERGE_GRASS, YARD_GRAVEL } from '../tileTypes';
import type { TileGrid } from './tileGrid';
import type { PlannedYard, TileRect, TownPlan, YardKind } from './townPlan';

/** The surface each kind of yard must stand on. */
const YARD_SURFACE: Record<YardKind, number> = {
  garden: VERGE_GRASS,
  workyard: YARD_GRAVEL,
};

function contains(rect: TileRect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}

function containedByAny(rects: ReadonlyArray<TileRect>, x: number, y: number): boolean {
  return rects.some((rect) => contains(rect, x, y));
}

/** Every tile the `TownPlan` deliberately puts a prop on. */
function plannedPropTiles(plan: TownPlan): ReadonlySet<string> {
  const tiles = new Set<string>();
  for (const prop of plan.props) {
    switch (prop.kind) {
      case 'fountain':
        for (let dy = 0; dy < prop.bounds.h; dy++) {
          for (let dx = 0; dx < prop.bounds.w; dx++) {
            tiles.add(`${prop.bounds.x + dx},${prop.bounds.y + dy}`);
          }
        }
        break;
      case 'torch':
      case 'well':
        tiles.add(`${prop.tile.x},${prop.tile.y}`);
        break;
    }
  }
  return tiles;
}

/**
 * Fails generation if a yard has ended up on the wrong surface.
 *
 * Checked against the painted grid rather than against the `TownPlan`'s
 * rectangles, because surfaces are painted in order and a later one wins: a
 * garden stated over ground a lane subsequently claims would look right in the
 * `TownPlan` and be gravel-and-setts on the map. It matters because planting
 * reports the material it is drawn *over*, so a garden on the wrong surface
 * draws verge tufts on that surface's sheet row and is then eroded by its
 * neighbours through the corner masks — the defect that once took the weed
 * scatter off the verge.
 *
 * Two exemptions, both for things the `TownPlan` put there on purpose. A tile
 * under **building art** is fine: an enclosure stated across a whole block
 * legitimately runs behind the facade that closes it. A tile carrying a
 * **planned prop** is fine too: the east side gate's torch stands in the row
 * Miller's kitchen garden occupies, where it reads as a garden lantern and
 * doubles as the enclosure's corner post. Both are stated as exemptions rather
 * than left to a tile-type allowlist, so anything that reaches a yard
 * *without* being declared there still fails.
 */
export function assertYardsStandOnTheirOwnSurface(
  grid: TileGrid,
  plan: TownPlan,
  buildingArt: ReadonlyArray<TileRect>,
): void {
  const propTiles = plannedPropTiles(plan);
  for (const yard of plan.yards) {
    const expected = YARD_SURFACE[yard.kind];
    for (let dy = 0; dy < yard.bounds.h; dy++) {
      for (let dx = 0; dx < yard.bounds.w; dx++) {
        const x = yard.bounds.x + dx;
        const y = yard.bounds.y + dy;
        if (containedByAny(buildingArt, x, y)) continue;
        if (propTiles.has(`${x},${y}`)) continue;
        const type = grid.typeAt(x, y);
        if (type === expected) continue;
        throw new Error(
          `Town yard '${yard.name}' is a ${yard.kind} but stands on tile type ${type} at ` +
            `${x},${y} — it needs ${expected}`,
        );
      }
    }
  }
}

function isOnPerimeter(bounds: TileRect, x: number, y: number): boolean {
  return (
    x === bounds.x ||
    y === bounds.y ||
    x === bounds.x + bounds.w - 1 ||
    y === bounds.y + bounds.h - 1
  );
}

/**
 * Post-and-rail perimeters around every fenced yard, with the `TownPlan`'s
 * gates left open.
 *
 * Two tests decide each perimeter tile, and both need the building art rather
 * than the grid alone. **A building's art is not solid on the grid** — only its
 * anchor tile carries `SPRITE_BUILDING`, and every other tile under the facade
 * keeps whatever surface the `TownPlan` painted there — so a fence deciding from tile
 * types alone would happily post itself under a roof and would treat a facade as
 * open ground to fence against.
 *
 * *Can this tile take a post?* Only the yard's own surface qualifies. That rules
 * out, in one test, the two side-gate torches standing in the Low Quarter's back
 * rows and any street a perimeter happens to run along.
 *
 * *Is this side worth fencing?* A fence says "this side is mine", and against the
 * town wall or a neighbouring facade there is already a boundary — doubling it
 * reads as a stockade. Corners lie on two sides at once and take a post if
 * *either* is open, so an enclosure turning from an open side into a walled one
 * still closes.
 */
export function paintYardFences(
  grid: TileGrid,
  plan: TownPlan,
  buildingArt: ReadonlyArray<TileRect>,
): void {
  const isClosed = (x: number, y: number) =>
    grid.isSolid(x, y) || containedByAny(buildingArt, x, y);

  const facesOpenGround = (x: number, y: number, bounds: TileRect) => {
    const outward: Array<{ dx: number; dy: number }> = [];
    if (x === bounds.x) outward.push({ dx: -1, dy: 0 });
    if (x === bounds.x + bounds.w - 1) outward.push({ dx: 1, dy: 0 });
    if (y === bounds.y) outward.push({ dx: 0, dy: -1 });
    if (y === bounds.y + bounds.h - 1) outward.push({ dx: 0, dy: 1 });
    return outward.some((side) => !isClosed(x + side.dx, y + side.dy));
  };

  for (const yard of plan.yards) {
    if (!yard.fenced) continue;
    const surface = YARD_SURFACE[yard.kind];
    for (let dy = 0; dy < yard.bounds.h; dy++) {
      for (let dx = 0; dx < yard.bounds.w; dx++) {
        const x = yard.bounds.x + dx;
        const y = yard.bounds.y + dy;
        if (!isOnPerimeter(yard.bounds, x, y)) continue;
        if (containedByAny(yard.gates, x, y)) continue;
        if (containedByAny(buildingArt, x, y)) continue;
        if (grid.typeAt(x, y) !== surface) continue;
        if (!facesOpenGround(x, y, yard.bounds)) continue;
        // `setFence`, which is `setStanding` plus the style: the fence has to
        // remember the surface it was driven into, or the renderer infers one
        // from its first cardinal neighbour and a southern perimeter takes the
        // street outside the yard.
        grid.setFence(x, y, yard.fence);
      }
    }
  }
}

/**
 * Beds and rows inside every garden, on the tiles the fence left walkable.
 *
 * Workyards get none: a yard is where things are done, and its clutter is props
 * rather than greenery.
 */
export function plantGardens(
  grid: TileGrid,
  plan: TownPlan,
  buildingArt: ReadonlyArray<TileRect>,
): void {
  const density = plan.groundCover.plantingDensityInGardens;
  for (const yard of plan.yards) {
    if (yard.kind !== 'garden') continue;
    for (let dy = 0; dy < yard.bounds.h; dy++) {
      for (let dx = 0; dx < yard.bounds.w; dx++) {
        const x = yard.bounds.x + dx;
        const y = yard.bounds.y + dy;
        if (containedByAny(buildingArt, x, y)) continue;
        if (grid.typeAt(x, y) !== VERGE_GRASS) continue;
        if (Math.random() >= density) continue;
        grid.set(x, y, GARDEN_PLANTING);
      }
    }
  }
}

/**
 * Every tile a yard covers, for the ground scatter to keep off.
 *
 * A yard is a made piece of ground, so the outdoor weed and worn-patch scatter
 * has no more business in it than it has under a roof.
 */
export function yardPlots(plan: TownPlan): ReadonlyArray<TileRect> {
  return plan.yards.map((yard: PlannedYard) => yard.bounds);
}
