/**
 * The floor-3 wilderness's cliff lines.
 *
 * **A cliff grants no height.** There is no z-axis in this game and this pass
 * does not add one: a `CLIFF` tile is a non-walkable decoration that *looks*
 * like a ledge. The illusion is three things — a lit top lip, shade pooling at
 * the foot of the face, and the ground to its south darkened by the ground-AO
 * pass (`GROUND_OCCLUDER_TYPES`), which is where the band onto the neighbouring
 * tile comes from, since a tile may not paint outside itself. Everything else —
 * where a ledge goes, how far it runs — exists to keep that illusion consistent
 * with the ground around it, which is why it reads off the same elevation field
 * the bands, the rivers and the boulders do.
 *
 * Placement is where the field earns its keep. Cliffs go on the *steep* parts of
 * the uplands, so they land along the boundary the highland and scree bands are
 * already drawing, and the rivers — which descend the same field — run below
 * them. Nothing coordinates that; it falls out of there being one field.
 */

import { CLIFF, HIGHLAND_GRASS, SCREE } from '../tileTypes';
import type { TileGrid } from '../town/tileGrid';
import type { TilePoint, TownPlan } from '../town/townPlan';
import type { CampSite } from './camps';
import type { ElevationBand, ElevationField } from './elevation';
import { NO_REGION, Reachability } from './reachability';

/**
 * How steep the ground must be before a ledge shows, in normalised elevation per
 * tile. A step in gentle ground is a slope; only a sharp one is a ledge.
 */
const CLIFF_GRADIENT_THRESHOLD = 0.0075;

/** Only the uplands get ledges: a cliff in a meadow is a wall in a field. */
const CLIFF_BANDS: ReadonlySet<ElevationBand> = new Set<ElevationBand>(['highland', 'ridge']);

/**
 * Longest unbroken run of cliff, and the gap punched through it.
 *
 * A contour of steep ground can run for a hundred tiles, and an unbroken
 * hundred-tile wall is not scenery — it is a barrier that turns half the map
 * into a corridor. The gaps read as the ramps and gullies a real escarpment has,
 * and they are also what makes the reachability gate a backstop rather than the
 * thing keeping the map connected.
 */
const MAX_CLIFF_RUN_TILES = 14;
const CLIFF_RAMP_GAP_TILES = 3;

/**
 * Run lengths are drawn from a range rather than always hitting the cap.
 *
 * With every run the same length and every gap the same width, a hillside of
 * ledges reads at map scale as a page of evenly spaced dashes — an obviously
 * authored motif rather than terrain. The cap is the ceiling; this is the
 * distribution under it.
 */
const MIN_CLIFF_RUN_TILES = 4;
const CLIFF_RUN_LENGTH_RANGE = MAX_CLIFF_RUN_TILES - MIN_CLIFF_RUN_TILES + 1;

/**
 * How much the gradient test is relaxed when extending a run from its seed.
 *
 * The seed marks where the drop is steepest; the rest of the ledge only has to
 * be part of the same fall. Without the relaxation a run stops at the first tile
 * that dips under the seeding threshold, which is what left the first version
 * drawing single tiles.
 */
const CLIFF_RUN_GRADIENT_RELAXATION = 0.45;

/** Tiles of clear ground kept between a camp's edge and the nearest ledge. */
const CLIFF_CAMP_CLEARANCE_TILES = 2;

function campKeepOut(camp: CampSite): number {
  return camp.radiusTiles + CLIFF_CAMP_CLEARANCE_TILES;
}

/** Scree spilling from the foot of a ledge. */
const CLIFF_SPOIL_CHANCE = 0.45;

/**
 * How many rounds of ramp-cutting are run before the map is left as it is.
 *
 * A ledge deeper than one tile was tried and reverted: cutting a gully through
 * every stacked tier sounds right — a gap in the top tier does open onto the
 * face of the next — but it walked all four directions from the tile it found,
 * carving up to two dozen tiles out of an escarpment, and **measurement showed
 * no benefit**: large unreachable regions went from 9 per 2,500 maps to 13. The
 * cases that survive are composite barriers of forest, boulders and cliff, which
 * no amount of cliff-cutting opens.
 */
const MAX_RAMP_REPAIR_ROUNDS = 6;

/**
 * A marooned region smaller than this is pocket noise, not a severing — the same
 * threshold and the same reasoning as the river repair's.
 */
const MIN_MAROONED_REGION_TILES = 80;

const CARDINAL_STEPS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
];

/**
 * Paints cliff lines along the steep contours of the uplands.
 *
 * Runs late — after the camps and the boulders — so it can see everything it
 * must not cut through, and before the reachability repair, which is its
 * backstop. "Everything" includes the camps, which have to be passed in: their
 * discs are cleared ground and a den's is cleared to `SCREE`, so nothing about
 * the tile itself says a ledge does not belong there.
 */
export function paintCliffs(
  grid: TileGrid,
  plan: TownPlan,
  elevation: ElevationField,
  camps: ReadonlyArray<CampSite>,
  border: number,
): void {
  const seeds: TilePoint[] = [];
  for (let ty = border + 1; ty < grid.size - border - 1; ty++) {
    for (let tx = border + 1; tx < grid.size - border - 1; tx++) {
      // Only over open upland ground. A cliff may not eat a road, a river, a
      // camp, a forest or anything the town owns — it is the last natural pass
      // to run and it defers to all of them.
      if (!isOpenUpland(grid, tx, ty)) continue;
      if (Math.hypot(tx - plan.centre.x, ty - plan.centre.y) <= plan.safeRadiusTiles) continue;
      // **The top edge of a south-facing drop** — one tile thick, running along
      // the contour, facing the way its shadow falls.
      //
      // Two earlier rules both failed, in opposite directions. Selecting every
      // steep upland tile produced *areas*: 1,500–6,000 tiles a map, in blobs no
      // run-cap could break and that walled off whole regions. Selecting where
      // the *band* drops going south produced specks — runs of three tiles —
      // because `bandAt` is deliberately dithered per tile, so the boundary it
      // draws is frayed by design.
      //
      // The fix is to read the **smooth** field: a tile is a ledge when the
      // ground falls away to its south steeply and the tile above it does not,
      // which is the leading edge of the drop and is continuous by construction.
      if (!isSouthFacingDrop(elevation, tx, ty, CLIFF_GRADIENT_THRESHOLD)) continue;
      if (isSouthFacingDrop(elevation, tx, ty - 1, CLIFF_GRADIENT_THRESHOLD)) continue;
      if (!canCarryLedge(grid, camps, tx, ty)) continue;
      seeds.push({ x: tx, y: ty });
    }
  }

  // Grown into runs, not placed as found. A seed on its own is a grey box, and
  // the first version that placed seeds directly drew exactly that: isolated
  // single tiles scattered over the hillside, each with its own drop-shadow, so
  // they read as blocks dropped on the grass rather than as an escarpment. A
  // ledge is a *line*; it has to be built as one.
  const claimed = new Set<number>();
  const placed: TilePoint[] = [];
  for (const seed of seeds) {
    if (claimed.has(seed.y * grid.size + seed.x)) continue;
    for (const tile of growRun(grid, elevation, camps, seed, claimed)) {
      grid.setStanding(tile.x, tile.y, CLIFF);
      placed.push(tile);
    }
  }

  breakLongRuns(grid, placed);
  scatterSpoil(grid, camps, placed);
}

/**
 * Whether the ground falls away steeply to the south of this tile.
 *
 * `gradientAt().dy` is the change in elevation going *down* the screen, so a
 * negative value is ground getting lower southward — which is what a
 * south-facing escarpment is. Read off the smooth field rather than off
 * `bandAt`, whose per-tile dither exists to fray band edges and would fray this
 * contour into dots.
 */
function isSouthFacingDrop(
  elevation: ElevationField,
  tx: number,
  ty: number,
  threshold: number,
): boolean {
  if (!CLIFF_BANDS.has(elevation.bandAt(tx, ty))) return false;
  return elevation.gradientAt(tx, ty).dy < -threshold;
}

/**
 * Ground a ledge may stand on, with somewhere for its shade to fall.
 *
 * Every rule about *where* a ledge may go lives here rather than in the seed
 * loop, because `growRun` extends a run past its seed and has to apply the same
 * rules. Filtering only the seeds is what the first version did, and a run
 * seeded beside a camp then grew straight through it: 134 cliff tiles inside
 * camp discs across 800 camps, with the seed filter working perfectly.
 */
function canCarryLedge(
  grid: TileGrid,
  camps: ReadonlyArray<CampSite>,
  tx: number,
  ty: number,
): boolean {
  if (!isOpenUpland(grid, tx, ty)) return false;
  // A camp is cleared ground, and a troglodyte den's disc is cleared *to*
  // `SCREE` — which `isOpenUpland` accepts — so nothing about the tile itself
  // says a ledge does not belong there. Goblin camps escaped only incidentally,
  // because their disc is road.
  if (camps.some((camp) => Math.hypot(tx - camp.centre.x, ty - camp.centre.y) <= campKeepOut(camp)))
    return false;
  // The tile below is what the shade falls on, and a ledge with a solid
  // immediately south of it has nothing to stand over.
  return !grid.isSolid(tx, ty + 1);
}

/**
 * Extends a seed east and west along its contour into one continuous ledge.
 *
 * The run follows a **relaxed** gradient threshold — the contour that seeded it
 * only has to still be falling away, not still be at its steepest — which is
 * what turns a scatter of qualifying tiles into the line they are all part of.
 * Capped at `MAX_CLIFF_RUN_TILES` so no single grow can produce a wall.
 */
function growRun(
  grid: TileGrid,
  elevation: ElevationField,
  camps: ReadonlyArray<CampSite>,
  seed: TilePoint,
  claimed: Set<number>,
): TilePoint[] {
  const run: TilePoint[] = [seed];
  claimed.add(seed.y * grid.size + seed.x);
  const relaxed = CLIFF_GRADIENT_THRESHOLD * CLIFF_RUN_GRADIENT_RELAXATION;

  // East-west, always — and that is a constraint of the **art**, not an
  // oversight. The ledge renderer draws a south-facing face: a lit top lip, a
  // rock face below it, and a drop-shadow onto the tile to the south. A run
  // grown along the contour instead — which is the geometrically correct thing,
  // and was tried — puts that same south-facing frame in a vertical column, and
  // a column of stacked ledges reads as a ladder, not a cliff.
  //
  // Placement and art have to agree. `isSouthFacingDrop` selects south-facing
  // drops, so the ledge that marks one runs east-west.
  const runLength = MIN_CLIFF_RUN_TILES + Math.floor(Math.random() * CLIFF_RUN_LENGTH_RANGE);

  for (const step of [-1, 1]) {
    let reach = 1;
    for (; run.length < runLength; reach++) {
      const tx = seed.x + step * reach;
      const ty = seed.y;
      const key = ty * grid.size + tx;
      if (claimed.has(key)) break;
      if (!isSouthFacingDrop(elevation, tx, ty, relaxed)) break;
      if (!canCarryLedge(grid, camps, tx, ty)) break;
      claimed.add(key);
      run.push({ x: tx, y: ty });
    }
    // Claim the gap without placing anything in it, so the *next* seed along
    // this contour cannot start where this run stopped and continue it. Without
    // this the cap is per-grow rather than per-ledge, and two runs meeting end to
    // end are one twenty-eight-tile wall with a cap that never fired.
    for (let gap = 0; gap < CLIFF_RAMP_GAP_TILES; gap++) {
      claimed.add(seed.y * grid.size + (seed.x + step * (reach + gap)));
    }
  }
  return run;
}

/** The two upland surfaces a ledge may be cut from, and spill onto. */
function isOpenUpland(grid: TileGrid, tx: number, ty: number): boolean {
  const type = grid.typeAt(tx, ty);
  return type === SCREE || type === HIGHLAND_GRASS;
}

/**
 * Punches ramps through any cliff run longer than `MAX_CLIFF_RUN_TILES`.
 *
 * Measured in graph distance from wherever the walk enters a run, so a
 * meandering contour is broken as reliably as a straight one — which a
 * bounding-box measure would not be.
 */
function breakLongRuns(grid: TileGrid, placed: ReadonlyArray<TilePoint>): void {
  const period = MAX_CLIFF_RUN_TILES + CLIFF_RAMP_GAP_TILES;
  const visited = new Set<number>();
  for (const start of placed) {
    const startKey = start.y * grid.size + start.x;
    if (visited.has(startKey) || grid.typeAt(start.x, start.y) !== CLIFF) continue;
    visited.add(startKey);

    const queue: Array<{ readonly point: TilePoint; readonly depth: number }> = [
      { point: start, depth: 0 },
    ];
    while (queue.length > 0) {
      const next = queue.shift();
      if (next === undefined) break;
      const { point, depth } = next;
      if (depth % period >= MAX_CLIFF_RUN_TILES) {
        // Back to the ground it was cut from, so a ramp is walkable upland
        // rather than a hole with no material.
        grid.set(point.x, point.y, grid.cells[point.y][point.x].groundType ?? SCREE);
      }
      for (const [dx, dy] of CARDINAL_STEPS) {
        const nx = point.x + dx;
        const ny = point.y + dy;
        if (grid.typeAt(nx, ny) !== CLIFF) continue;
        const key = ny * grid.size + nx;
        if (visited.has(key)) continue;
        visited.add(key);
        queue.push({ point: { x: nx, y: ny }, depth: depth + 1 });
      }
    }
  }
}

/** Scree spilling from the foot of a ledge, where it would actually collect. */
function scatterSpoil(
  grid: TileGrid,
  camps: ReadonlyArray<CampSite>,
  placed: ReadonlyArray<TilePoint>,
): void {
  for (const tile of placed) {
    if (grid.typeAt(tile.x, tile.y) !== CLIFF) continue;
    if (Math.random() >= CLIFF_SPOIL_CHANCE) continue;
    const belowY = tile.y + 1;
    if (!canCarryLedge(grid, camps, tile.x, belowY)) continue;
    grid.set(tile.x, belowY, SCREE);
  }
}

/**
 * Cuts ramps through any cliff line that has marooned a region of the map.
 *
 * The counterpart to the river's `bridgeMaroonedRegions`, and a **repair rather
 * than an assertion** for the same reason: a contour that happens to close on
 * itself would otherwise fail generation outright, and a map that refuses to
 * load is a far worse outcome than a ledge with one more gully in it.
 */
export function openCliffRamps(grid: TileGrid, from: TilePoint, border: number): void {
  for (let round = 0; round < MAX_RAMP_REPAIR_ROUNDS; round++) {
    const reachability = new Reachability(grid, from);
    const { labels, counts, touchesCliff } = reachability.marooned();
    const worthOpening = new Set<number>();
    counts.forEach((count, label) => {
      if (count >= MIN_MAROONED_REGION_TILES && touchesCliff[label]) worthOpening.add(label);
    });
    if (worthOpening.size === 0) return;

    const opened = new Set<number>();
    for (let ty = border; ty < grid.size - border; ty++) {
      for (let tx = border; tx < grid.size - border; tx++) {
        if (grid.typeAt(tx, ty) !== CLIFF) continue;
        // A cliff tile with the marooned side on one hand and reached ground on
        // the other is exactly where a gully belongs.
        let strandedLabel = NO_REGION;
        let touchesReached = false;
        for (const [dx, dy] of CARDINAL_STEPS) {
          const nx = tx + dx;
          const ny = ty + dy;
          if (reachability.reached(nx, ny)) touchesReached = true;
          const label = labels[ny * grid.size + nx];
          if (label !== NO_REGION && worthOpening.has(label)) strandedLabel = label;
        }
        if (!touchesReached || strandedLabel === NO_REGION) continue;
        if (opened.has(strandedLabel)) continue;
        grid.set(tx, ty, grid.cells[ty][tx].groundType ?? SCREE);
        opened.add(strandedLabel);
      }
    }
    // Nothing could be opened this round, so nothing will be in the next: what
    // is left is walled off by something other than a cliff.
    if (opened.size === 0) return;
  }
}
