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

import {
  BOULDER_LARGE,
  BOULDER_SMALL,
  CLIFF,
  FloorTypeValue,
  HIGHLAND_GRASS,
  PEBBLE_SCATTER,
  SCREE,
  TREE,
} from '../tileTypes';
import { isWalkableTileType } from '../walkability';
import type { TileGrid } from '../town/tileGrid';
import type { TilePoint, TownPlan } from '../town/townPlan';
import { isWithinCamp, type CampSite } from './camps';
import type { ElevationBand, ElevationField } from './elevation';
import type { KeepOut } from './keepOut';
import { Reachability } from './reachability';
import { worldRandom } from '../../core/WorldRandom';
import { tileHash01 } from '../tiles/hollowTileHash';
import { DriftField, scatterSalt, type LandformSampler } from './landformScatter';

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
 * that dips under the seeding threshold, and most ledges come out a single tile.
 */
const CLIFF_RUN_GRADIENT_RELAXATION = 0.45;

/** Tiles of clear ground kept between a camp's edge and the nearest ledge. */
const CLIFF_CAMP_CLEARANCE_TILES = 2;

/**
 * The talus fan below a ledge: stone that has fallen from the face and spread
 * as it rolled. It reaches `TALUS_DEPTH_TILES` down the slope and widens by
 * `TALUS_WIDENING` tiles either side per row, and thins with distance from the
 * face. Bare scree lies where it is thickest, near the foot; loose stones on the
 * turf beyond. A drift field breaks the fan up, so neighbouring ledges do not
 * shed identical aprons.
 */
const TALUS_DEPTH_TILES = 4;
const TALUS_WIDENING = 0.5;
/** Fan strength above which the fallen stone has buried the turf entirely. */
const TALUS_SCREE_STRENGTH = 0.55;
const TALUS_SCREE_CHANCE = 0.85;
const TALUS_PEBBLE_CHANCE = 0.5;
/** How much of the fan the drift may take away. */
const TALUS_PATCHINESS = 0.5;
const TALUS_DRIFT_OCTAVES = [
  { periodTiles: 5, weight: 0.7 },
  { periodTiles: 3, weight: 0.3 },
] as const;
/**
 * A boulder at the toe of a fan: the odd big block that rolled furthest. Only
 * where the fan has thinned to this range, and only with open ground all round
 * it, so a rock never closes a gap between ledges.
 */
const TALUS_BOULDER_MIN_STRENGTH = 0.15;
const TALUS_BOULDER_MAX_STRENGTH = 0.45;
const TALUS_BOULDER_CHANCE = 0.03;
const TALUS_DRIFT_SALT = 9401;
const TALUS_CHOICE_SALT = 9411;
const TALUS_BOULDER_SALT = 9421;

/**
 * How many rounds of ramp-cutting are run before the map is left as it is. Each
 * round re-floods the map, so a region opened onto a pocket that is itself
 * still shut is reconsidered from its new, larger border.
 */
const MAX_RAMP_REPAIR_ROUNDS = 6;

/**
 * A marooned region smaller than this is pocket noise, not a severing — the same
 * threshold and the same reasoning as the river repair's.
 */
const MIN_MAROONED_REGION_TILES = 80;

/**
 * What the ramp repair pays to cut through a tile on its way out of a marooned
 * region. A ledge or a boulder is one tile of gully. A tree costs more, so a
 * wood is only thinned where no ledge offers as short a way through, yet a
 * region whose border is mostly forest fringe can still be opened by felling
 * the one tree that closes it.
 */
const RAMP_CUT_COST_ROCK = 1;
const RAMP_CUT_COST_TREE = 2;
/**
 * The dearest single cut the repair makes: a gully through an escarpment six
 * ledges deep, or three trees. Anything costlier is a barrier, not a seam, and
 * is left for the generator's reachability warning to report.
 */
const MAX_RAMP_CUT_COST = 6;
const UNPRICED = Number.MAX_SAFE_INTEGER;
const NO_PARENT = -1;

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
  landform: LandformSampler,
  camps: ReadonlyArray<CampSite>,
  border: number,
  keepOut: KeepOut,
): void {
  const { elevation } = landform;
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
      // Neither steepness alone nor a band change will do. Every steep upland
      // tile makes *areas* — blobs no run-cap can break, walling off whole
      // regions — and where the *band* drops going south makes specks, because
      // `bandAt` nudges its thresholds off the contour by design.
      //
      // So the ledge reads the **smooth** field: a tile is a ledge when the
      // ground falls away to its south steeply and the tile above it does not,
      // which is the leading edge of the drop and is continuous by construction.
      if (!isSouthFacingDrop(elevation, tx, ty, CLIFF_GRADIENT_THRESHOLD)) continue;
      if (isSouthFacingDrop(elevation, tx, ty - 1, CLIFF_GRADIENT_THRESHOLD)) continue;
      if (!canCarryLedge(grid, camps, keepOut, tx, ty)) continue;
      seeds.push({ x: tx, y: ty });
    }
  }

  // Grown into runs, not placed as found. A seed on its own is a grey box:
  // seeds placed directly are isolated single tiles scattered over the
  // hillside, each with its own drop-shadow, so they read as blocks dropped on
  // the grass rather than as an escarpment. A
  // ledge is a *line*; it has to be built as one.
  const claimed = new Set<number>();
  const placed: TilePoint[] = [];
  for (const seed of seeds) {
    if (claimed.has(seed.y * grid.size + seed.x)) continue;
    for (const tile of growRun(grid, elevation, camps, keepOut, seed, claimed)) {
      grid.setStanding(tile.x, tile.y, CLIFF);
      placed.push(tile);
    }
  }

  breakLongRuns(grid, placed);
  spreadTalus(grid, landform, camps, keepOut, placed);
}

/**
 * Whether the ground falls away steeply to the south of this tile.
 *
 * `gradientAt().dy` is the change in elevation going *down* the screen, so a
 * negative value is ground getting lower southward — which is what a
 * south-facing escarpment is. Read off the smooth field rather than off
 * `bandAt`, whose nudged thresholds exist to make band edges wander and would
 * break this contour into pieces.
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
 * rules. With only the seeds filtered, a run seeded beside a camp grows
 * straight through it: 134 cliff tiles inside camp discs across 800 camps, with
 * the seed filter working perfectly.
 */
function canCarryLedge(
  grid: TileGrid,
  camps: ReadonlyArray<CampSite>,
  keepOut: KeepOut,
  tx: number,
  ty: number,
): boolean {
  if (!isOpenUpland(grid, tx, ty)) return false;
  // A camp is cleared ground, and a troglodyte den's disc is cleared *to*
  // `SCREE` — which `isOpenUpland` accepts — so nothing about the tile itself
  // says a ledge does not belong there.
  if (isWithinCamp(camps, tx, ty, CLIFF_CAMP_CLEARANCE_TILES)) return false;
  // Nor across a landmark's ground, nor with its shade falling on one.
  if (keepOut.contains(tx, ty) || keepOut.contains(tx, ty + 1)) return false;
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
  keepOut: KeepOut,
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
  const runLength = MIN_CLIFF_RUN_TILES + Math.floor(worldRandom() * CLIFF_RUN_LENGTH_RANGE);

  for (const step of [-1, 1]) {
    let reach = 1;
    for (; run.length < runLength; reach++) {
      const tx = seed.x + step * reach;
      const ty = seed.y;
      const key = ty * grid.size + tx;
      if (claimed.has(key)) break;
      if (!isSouthFacingDrop(elevation, tx, ty, relaxed)) break;
      if (!canCarryLedge(grid, camps, keepOut, tx, ty)) break;
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

/** Open ground a fan of fallen stone may spread over. */
function canTakeTalus(
  grid: TileGrid,
  camps: ReadonlyArray<CampSite>,
  keepOut: KeepOut,
  tx: number,
  ty: number,
): boolean {
  const type = grid.typeAt(tx, ty);
  const open = type === SCREE || type === HIGHLAND_GRASS || type === FloorTypeValue.grass;
  if (!open || keepOut.contains(tx, ty)) return false;
  return !isWithinCamp(camps, tx, ty, CLIFF_CAMP_CLEARANCE_TILES);
}

/** How thick each tile's talus is, the strongest fan reaching it winning: 1 at a ledge's foot. */
function talusStrength(grid: TileGrid, placed: ReadonlyArray<TilePoint>): Map<number, number> {
  const strength = new Map<number, number>();
  for (const ledge of placed) {
    if (grid.typeAt(ledge.x, ledge.y) !== CLIFF) continue;
    for (let row = 1; row <= TALUS_DEPTH_TILES; row++) {
      const reach = Math.round(row * TALUS_WIDENING);
      const rowStrength = 1 - (row - 1) / TALUS_DEPTH_TILES;
      for (let across = -reach; across <= reach; across++) {
        const lateral = 1 - Math.abs(across) / (reach + 1);
        const key = (ledge.y + row) * grid.size + ledge.x + across;
        strength.set(key, Math.max(strength.get(key) ?? 0, rowStrength * lateral));
      }
    }
  }
  return strength;
}

function isOpenAllRound(grid: TileGrid, tx: number, ty: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (grid.isSolid(tx + dx, ty + dy)) return false;
    }
  }
  return true;
}

/** Fans of fallen stone below every ledge, thickest at its foot. */
function spreadTalus(
  grid: TileGrid,
  landform: LandformSampler,
  camps: ReadonlyArray<CampSite>,
  keepOut: KeepOut,
  placed: ReadonlyArray<TilePoint>,
): void {
  const seed = landform.elevation.seed;
  const drift = new DriftField(seed, TALUS_DRIFT_SALT, grid.size, TALUS_DRIFT_OCTAVES);
  const choiceSalt = scatterSalt(seed, TALUS_CHOICE_SALT);
  const boulderSalt = scatterSalt(seed, TALUS_BOULDER_SALT);
  for (const [key, fanStrength] of talusStrength(grid, placed)) {
    const tx = key % grid.size;
    const ty = Math.floor(key / grid.size);
    if (!canTakeTalus(grid, camps, keepOut, tx, ty)) continue;
    const strength = fanStrength * (1 - TALUS_PATCHINESS * (1 - drift.sample(tx, ty)));
    const roll = tileHash01(tx, ty, choiceSalt);
    if (strength >= TALUS_SCREE_STRENGTH) {
      if (roll < TALUS_SCREE_CHANCE) grid.set(tx, ty, SCREE);
      continue;
    }
    const isToe = strength >= TALUS_BOULDER_MIN_STRENGTH && strength < TALUS_BOULDER_MAX_STRENGTH;
    if (
      isToe &&
      tileHash01(tx, ty, boulderSalt) < TALUS_BOULDER_CHANCE &&
      isOpenAllRound(grid, tx, ty)
    ) {
      grid.setStanding(tx, ty, BOULDER_SMALL);
      continue;
    }
    if (roll < strength * TALUS_PEBBLE_CHANCE) grid.setStanding(tx, ty, PEBBLE_SCATTER);
  }
}

/**
 * Cuts ramps through any cliff line that has marooned a region of the map.
 *
 * The counterpart to the river's `bridgeMaroonedRegions`, and a **repair rather
 * than an assertion** for the same reason: a contour that happens to close on
 * itself would otherwise fail generation outright, and a map that refuses to
 * load is a far worse outcome than a ledge with one more gully in it.
 *
 * Only regions with a ledge on their border are opened, because a ledge is what
 * this pass adds to a map; a pocket a wood closed on its own is pocket noise.
 * Each is opened along the cheapest way out to reached ground, not at the first
 * cliff tile that touches both sides. Escarpments stack — a run seeded on the
 * row below another leaves a ledge two, three or more tiles thick — and a single
 * tile cut from a stack opens onto the next tier rather than onto the far side.
 * The cheapest way runs straight through the whole stack, takes any boulder
 * resting against its foot or lip with it, and may cross other unreached
 * ground and a forest's fringe where those close the rest of the border.
 */
export function openCliffRamps(
  grid: TileGrid,
  plan: TownPlan,
  keepOut: KeepOut,
  camps: readonly CampSite[],
  from: TilePoint,
  border: number,
): void {
  const mayCut = (tx: number, ty: number): boolean =>
    tx >= border &&
    ty >= border &&
    tx < grid.size - border &&
    ty < grid.size - border &&
    !keepOut.contains(tx, ty) &&
    !isWithinCamp(camps, tx, ty) &&
    Math.hypot(tx - plan.centre.x, ty - plan.centre.y) > plan.safeRadiusTiles;

  for (let round = 0; round < MAX_RAMP_REPAIR_ROUNDS; round++) {
    const reachability = new Reachability(grid, from);
    const { labels, counts, touchesCliff } = reachability.marooned();
    const worthOpening: number[] = [];
    counts.forEach((count, label) => {
      if (count >= MIN_MAROONED_REGION_TILES && touchesCliff[label]) worthOpening.push(label);
    });
    if (worthOpening.length === 0) return;

    let openedAny = false;
    for (const label of worthOpening) {
      const cut = cheapestCutOut(grid, reachability, labels, label, mayCut);
      if (cut === null) continue;
      for (const tile of cut) {
        grid.set(tile.x, tile.y, grid.cells[tile.y][tile.x].groundType ?? SCREE);
      }
      openedAny = true;
    }
    // Nothing could be opened this round, so nothing will be in the next: what
    // is left is walled off by more than the repair may cut.
    if (!openedAny) return;
  }
}

/** What stepping onto a tile costs the ramp repair, or undefined where it may not go. */
function rampStepCost(
  grid: TileGrid,
  mayCut: (tx: number, ty: number) => boolean,
  tx: number,
  ty: number,
): number | undefined {
  if (isWalkableTileType(grid.cells[ty][tx])) return 0;
  if (!mayCut(tx, ty)) return undefined;
  const type = grid.typeAt(tx, ty);
  if (type === CLIFF || type === BOULDER_SMALL || type === BOULDER_LARGE) {
    return RAMP_CUT_COST_ROCK;
  }
  if (type === TREE) return RAMP_CUT_COST_TREE;
  return undefined;
}

/**
 * The blocking tiles on the cheapest path from a marooned region to reached
 * ground, or null when every way out costs more than `MAX_RAMP_CUT_COST`.
 *
 * A Dijkstra over small integer costs, so a bucket per cost stands in for the
 * priority queue. Walkable ground that is not reached costs nothing to cross.
 */
function cheapestCutOut(
  grid: TileGrid,
  reachability: Reachability,
  labels: Int32Array,
  label: number,
  mayCut: (tx: number, ty: number) => boolean,
): TilePoint[] | null {
  const size = grid.size;
  const price = new Float64Array(size * size).fill(UNPRICED);
  const parent = new Int32Array(size * size).fill(NO_PARENT);
  const buckets: number[][] = Array.from({ length: MAX_RAMP_CUT_COST + 1 }, () => []);
  labels.forEach((tileLabel, key) => {
    if (tileLabel !== label) return;
    price[key] = 0;
    buckets[0].push(key);
  });

  for (let cost = 0; cost <= MAX_RAMP_CUT_COST; cost++) {
    const bucket = buckets[cost];
    for (let key = bucket.pop(); key !== undefined; key = bucket.pop()) {
      if (price[key] !== cost) continue;
      const tx = key % size;
      const ty = Math.floor(key / size);
      for (const [dx, dy] of CARDINAL_STEPS) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (reachability.reached(nx, ny)) return blockersBack(grid, parent, key);
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const nextKey = ny * size + nx;
        const stepCost = rampStepCost(grid, mayCut, nx, ny);
        if (stepCost === undefined) continue;
        const nextCost = cost + stepCost;
        if (nextCost > MAX_RAMP_CUT_COST || nextCost >= price[nextKey]) continue;
        price[nextKey] = nextCost;
        parent[nextKey] = key;
        buckets[nextCost].push(nextKey);
      }
    }
  }
  return null;
}

/** The tiles the path ending at `key` has to cut, walked back to the region it left. */
function blockersBack(grid: TileGrid, parent: Int32Array, key: number): TilePoint[] {
  const blockers: TilePoint[] = [];
  for (let at = key; at !== NO_PARENT; at = parent[at]) {
    const tx = at % grid.size;
    const ty = Math.floor(at / grid.size);
    if (!isWalkableTileType(grid.cells[ty][tx])) blockers.push({ x: tx, y: ty });
  }
  return blockers;
}
