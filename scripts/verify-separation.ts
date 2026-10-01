#!/usr/bin/env tsx
/**
 * Headless checks for mob separation and the grid that accelerates it.
 *
 * The thing worth guarding here is that swapping strategies changed nothing
 * about how mobs move. A neighbour lookup that under-reports near a cell
 * boundary would not throw, would not fail a typecheck, and would show up in
 * game only as mobs occasionally sliding through each other at the seams
 * between cells — so the checks below drive that case directly rather than
 * trusting the bounding-box arithmetic to be right by inspection.
 *
 * How the pass *feels* at high mob density is still a `[HUMAN]` gate; run the
 * game with `?perf` for the frame-time readout.
 *
 * Run: npx tsx scripts/verify-separation.ts
 */

import { MAX_CELLS_PER_BODY, SeparationGrid } from '../src/core/SeparationGrid';
import { mulberry32 } from '../src/sprites/person/rng';
import { SpatialGrid } from '../src/core/SpatialGrid';
import { MOB_GRID_CELL_SIZE, TILE_SIZE } from '../src/core/constants';
import {
  accumulateFromAllPairs,
  accumulateFromGrid,
  accumulateSeparationForces,
  SEPARATION_GRID_MIN_MOBS,
  SEPARATION_RADIUS,
  separationPushScale,
} from '../src/systems/mobSeparation';

interface TestBody {
  x: number;
  y: number;
  mass: number;
  collisionRadiusPx?: number;
  closesToOrdinaryContact?: boolean;
}

let failures = 0;

function check(condition: boolean, description: string): void {
  if (condition) {
    console.log(`  ok   ${description}`);
    return;
  }
  failures++;
  console.log(`  FAIL ${description}`);
}

/** Deterministic PRNG, so a failure can be reproduced from the output alone. */
const makeRandom = mulberry32;

/**
 * Tolerance on a force comparison. The two strategies sum the same terms in
 * different orders, so they agree to floating-point rounding and not to the bit.
 */
const FORCE_EPSILON = 1e-9;

function forcesFromAllPairs(bodies: readonly TestBody[]): { dx: number[]; dy: number[] } {
  const dx = new Array<number>(bodies.length).fill(0);
  const dy = new Array<number>(bodies.length).fill(0);
  accumulateFromAllPairs(bodies, dx, dy);
  return { dx, dy };
}

function forcesFromGrid(bodies: readonly TestBody[]): { dx: number[]; dy: number[] } {
  const dx = new Array<number>(bodies.length).fill(0);
  const dy = new Array<number>(bodies.length).fill(0);
  const grid = new SeparationGrid<TestBody>();
  grid.build(bodies, SEPARATION_RADIUS);
  accumulateFromGrid(bodies, dx, dy, grid);
  return { dx, dy };
}

function largestDisagreement(bodies: readonly TestBody[]): number {
  const pairs = forcesFromAllPairs(bodies);
  const grid = forcesFromGrid(bodies);
  let worst = 0;
  for (let i = 0; i < bodies.length; i++) {
    worst = Math.max(worst, Math.abs(pairs.dx[i] - grid.dx[i]), Math.abs(pairs.dy[i] - grid.dy[i]));
  }
  return worst;
}

console.log('\nforce math');
{
  const touching = SEPARATION_RADIUS / 2;
  check(separationPushScale(touching * touching) > 0, 'overlapping bodies are pushed apart');
  const beyondContact = SEPARATION_RADIUS + 1;
  check(
    separationPushScale(beyondContact * beyondContact) === 0,
    'bodies further apart than the radius are left alone',
  );
  check(separationPushScale(0) === 0, 'exactly coincident bodies have no direction to be pushed');
  const insideDeadband = SEPARATION_RADIUS - 1;
  check(
    separationPushScale(insideDeadband * insideDeadband) === 0,
    'a contact inside the deadband is not corrected',
  );
}

console.log('\ncell-boundary coverage');
{
  // Two bodies a third of a tile apart, walked across a whole cell so every
  // straddling arrangement is exercised. Sitting in different cells must not
  // change the force by even a rounding step.
  const RADII_PER_GAP = 3;
  const gap = SEPARATION_RADIUS / RADII_PER_GAP;
  const STEPS_ACROSS_CELL = 40;
  const START_TILES = 10;
  const START_PX = TILE_SIZE * START_TILES;
  let worstDelta = 0;
  let unpushedSteps = 0;
  for (let step = 0; step < STEPS_ACROSS_CELL; step++) {
    const offset = (step / STEPS_ACROSS_CELL) * SEPARATION_RADIUS;
    for (const [dx, dy] of [
      [gap, 0],
      [0, gap],
      [gap * Math.SQRT1_2, gap * Math.SQRT1_2],
    ]) {
      const bodies: TestBody[] = [
        { x: START_PX + offset, y: START_PX + offset, mass: 1 },
        { x: START_PX + offset + dx, y: START_PX + offset + dy, mass: 1 },
      ];
      const grid = forcesFromGrid(bodies);
      if (grid.dx[0] === 0 && grid.dy[0] === 0) unpushedSteps++;
      worstDelta = Math.max(worstDelta, largestDisagreement(bodies));
    }
  }
  check(unpushedSteps === 0, 'a touching pair is found at every position across a cell');
  check(worstDelta < FORCE_EPSILON, `boundary forces match all-pairs (max ${worstDelta})`);
}

console.log('\nstrategy equivalence');
{
  const LAYOUTS = 200;
  const BODIES_PER_LAYOUT = 60;
  const SPREAD_TILES = 6;
  const HEAVIEST_MASS = 10;
  const LAYOUT_ORIGIN_TILES = 20;
  let worstDelta = 0;
  let contactedLayouts = 0;
  for (let layout = 0; layout < LAYOUTS; layout++) {
    const random = makeRandom(layout + 1);
    const bodies: TestBody[] = [];
    for (let i = 0; i < BODIES_PER_LAYOUT; i++) {
      bodies.push({
        x: TILE_SIZE * (LAYOUT_ORIGIN_TILES + random() * SPREAD_TILES),
        y: TILE_SIZE * (LAYOUT_ORIGIN_TILES + random() * SPREAD_TILES),
        mass: 1 + random() * (HEAVIEST_MASS - 1),
      });
    }
    const pairs = forcesFromAllPairs(bodies);
    if (pairs.dx.some((force) => force !== 0)) contactedLayouts++;
    worstDelta = Math.max(worstDelta, largestDisagreement(bodies));
  }
  check(contactedLayouts === LAYOUTS, 'every random layout actually produced contacts to compare');
  check(
    worstDelta < FORCE_EPSILON,
    `mass-weighted forces match across ${LAYOUTS} layouts (max ${worstDelta})`,
  );
}

console.log('\ndegenerate layouts');
{
  const LONE_BODY_PX = 100;
  const STACK_TILES = 5;
  const NEAR_KNOT_TILES = 10;
  const SCATTER_SEED = 99;
  const CORRIDOR_ROW_TILES = 5;
  check(largestDisagreement([]) === 0, 'an empty roster is handled');
  check(
    largestDisagreement([{ x: LONE_BODY_PX, y: LONE_BODY_PX, mass: 1 }]) === 0,
    'a lone body is handled',
  );
  const stacked: TestBody[] = Array.from({ length: SEPARATION_GRID_MIN_MOBS }, () => ({
    x: TILE_SIZE * STACK_TILES,
    y: TILE_SIZE * STACK_TILES,
    mass: 1,
  }));
  check(largestDisagreement(stacked) === 0, 'a whole roster stacked on one point is handled');

  // Two tight knots far apart: the bounding box is enormous next to the body
  // count, which is the case the grid coarsens its cells to survive.
  const FAR_APART_TILES = 400;
  const KNOT_SIZE = 30;
  const scattered: TestBody[] = [];
  const random = makeRandom(SCATTER_SEED);
  for (let i = 0; i < KNOT_SIZE; i++) {
    scattered.push({
      x: TILE_SIZE * (NEAR_KNOT_TILES + random()),
      y: TILE_SIZE * (NEAR_KNOT_TILES + random()),
      mass: 1,
    });
    scattered.push({
      x: TILE_SIZE * (FAR_APART_TILES + random()),
      y: TILE_SIZE * (FAR_APART_TILES + random()),
      mass: 1,
    });
  }
  const scatteredDelta = largestDisagreement(scattered);
  check(scatteredDelta < FORCE_EPSILON, `two distant knots agree (max ${scatteredDelta})`);

  // A long thin bounding box — a corridor's worth of mobs strung out on one row.
  // This is the shape that defeats a single coarsening step, since the flat axis
  // contributes a cell count of 1 no matter how much the cells grow.
  const CORRIDOR_LENGTH_TILES = 20000;
  const CORRIDOR_MOBS = 60;
  const corridor: TestBody[] = [];
  for (let i = 0; i < CORRIDOR_MOBS; i++) {
    corridor.push({
      x: TILE_SIZE * ((i / CORRIDOR_MOBS) * CORRIDOR_LENGTH_TILES),
      y: TILE_SIZE * CORRIDOR_ROW_TILES,
      mass: 1,
    });
  }
  const corridorDelta = largestDisagreement(corridor);
  check(corridorDelta < FORCE_EPSILON, `a long thin layout agrees (max ${corridorDelta})`);

  // The grid clears its whole cell array every frame, so a layout whose bounding
  // box dwarfs its body count must coarsen rather than allocate a cell per tile.
  const corridorGrid = new SeparationGrid<TestBody>();
  corridorGrid.build(corridor, SEPARATION_RADIUS);
  const corridorBudget = corridor.length * MAX_CELLS_PER_BODY;
  check(
    corridorGrid.cellCount <= corridorBudget,
    `a long thin layout stays inside its cell budget (${corridorGrid.cellCount} <= ${corridorBudget})`,
  );
}

console.log('\nwide bodies on the grid path');
{
  // One body wider than a tile among enough others that the dispatcher takes
  // the grid path. Its neighbour sits inside its radius but two cells over on
  // a one-tile grid, so a grid built only out to the ordinary radius cannot
  // find it — the case that would let crawlers and mobs walk into a boss's
  // drawn body whenever the room happens to be crowded.
  const WIDE_RADIUS_TILES = 1.5;
  const WIDE_RADIUS_PX = TILE_SIZE * WIDE_RADIUS_TILES;
  const LAYOUT_ORIGIN_TILES = 30;
  const LAYOUT_ORIGIN_PX = TILE_SIZE * LAYOUT_ORIGIN_TILES;
  /** Puts the wide body near the right edge of its own cell. */
  const WIDE_CELL_OFFSET_PX = TILE_SIZE - 1;
  /** How far inside the wide radius the neighbour stands: more than the separation deadband. */
  const NEIGHBOUR_DEPTH_PX = 6;
  /** Inside the wide radius, beyond the ordinary one, and two one-tile cells from the wide body. */
  const NEIGHBOUR_GAP_PX = WIDE_RADIUS_PX - NEIGHBOUR_DEPTH_PX;
  /** Inside the wide radius, beyond the ordinary one: a companion here is not pushed. */
  const COMPANION_GAP_TILES = 1.25;
  const COMPANION_GAP_PX = TILE_SIZE * COMPANION_GAP_TILES;
  /** Lattice spacing for the filler bodies: two tiles, so none of them touch. */
  const FILLER_SPACING_TILES = 2;
  const FILLER_SPACING_PX = TILE_SIZE * FILLER_SPACING_TILES;
  const FILLER_COLUMNS = 8;
  /** Rows start this far below the wide body, out of everything's reach. */
  const FILLER_DROP_TILES = 4;
  const FILLER_DROP_PX = TILE_SIZE * FILLER_DROP_TILES;

  const wide: TestBody = {
    x: LAYOUT_ORIGIN_PX + WIDE_CELL_OFFSET_PX,
    y: LAYOUT_ORIGIN_PX,
    mass: 1,
    collisionRadiusPx: WIDE_RADIUS_PX,
  };
  const neighbour: TestBody = { x: wide.x + NEIGHBOUR_GAP_PX, y: wide.y, mass: 1 };
  const companion: TestBody = {
    x: wide.x,
    y: wide.y - COMPANION_GAP_PX,
    mass: 1,
    closesToOrdinaryContact: true,
  };
  const bodies: TestBody[] = [wide, neighbour, companion];
  const neighbourIndex = bodies.indexOf(neighbour);
  const companionIndex = bodies.indexOf(companion);
  for (let i = 0; bodies.length < SEPARATION_GRID_MIN_MOBS; i++) {
    bodies.push({
      x: LAYOUT_ORIGIN_PX + (i % FILLER_COLUMNS) * FILLER_SPACING_PX,
      y: LAYOUT_ORIGIN_PX + FILLER_DROP_PX + Math.floor(i / FILLER_COLUMNS) * FILLER_SPACING_PX,
      mass: 1,
    });
  }

  const pairs = forcesFromAllPairs(bodies);
  const dispatched = {
    dx: new Array<number>(bodies.length).fill(0),
    dy: new Array<number>(bodies.length).fill(0),
  };
  accumulateSeparationForces(bodies, dispatched.dx, dispatched.dy, new SeparationGrid<TestBody>());
  const narrowGrid = new SeparationGrid<TestBody>();
  narrowGrid.build(bodies, SEPARATION_RADIUS);
  const narrow = {
    dx: new Array<number>(bodies.length).fill(0),
    dy: new Array<number>(bodies.length).fill(0),
  };
  accumulateFromGrid(bodies, narrow.dx, narrow.dy, narrowGrid, WIDE_RADIUS_PX);

  const disagreement = (other: { dx: number[]; dy: number[] }): number => {
    let worst = 0;
    for (let i = 0; i < bodies.length; i++) {
      worst = Math.max(
        worst,
        Math.abs(pairs.dx[i] - other.dx[i]),
        Math.abs(pairs.dy[i] - other.dy[i]),
      );
    }
    return worst;
  };

  check(
    bodies.length >= SEPARATION_GRID_MIN_MOBS,
    `the layout takes the grid path (${bodies.length} bodies)`,
  );
  check(
    pairs.dx[neighbourIndex] > 0,
    'the all-pairs loop pushes a neighbour inside the wide radius away',
  );
  check(
    pairs.dx[companionIndex] === 0 && pairs.dy[companionIndex] === 0,
    'a companion inside the wide radius but beyond one tile is not pushed',
  );
  const dispatchedDelta = disagreement(dispatched);
  check(
    dispatchedDelta < FORCE_EPSILON,
    `the grid path agrees with all pairs when a wide body is present (max ${dispatchedDelta})`,
  );
  const FORCE_PRINT_DIGITS = 3;
  const narrowDelta = disagreement(narrow);
  check(
    narrowDelta > FORCE_EPSILON,
    `negative: a grid built only out to one tile misses the wide body's neighbour (max ${narrowDelta.toFixed(FORCE_PRINT_DIGITS)})`,
  );
}

console.log('\nmob grid key packing');
{
  // `SpatialGrid` packs a cell coordinate pair into one integer key, and the
  // separation plan flagged negative world positions as a possible hole in that
  // scheme. Nothing places an entity left of or above the origin today, so this
  // is the check that keeps the claim honest rather than assumed — and if the
  // packing is ever changed, it is what catches a regression.
  const grid = new SpatialGrid<TestBody>(MOB_GRID_CELL_SIZE);
  const CELLS_LEFT_OF_ORIGIN = 3;
  const CELLS_ABOVE_ORIGIN = 7;
  const offOrigin: TestBody = {
    x: -MOB_GRID_CELL_SIZE * CELLS_LEFT_OF_ORIGIN,
    y: -MOB_GRID_CELL_SIZE * CELLS_ABOVE_ORIGIN,
    mass: 1,
  };
  grid.insert(offOrigin);
  check(
    grid.queryCircle(offOrigin.x, offOrigin.y, TILE_SIZE).has(offOrigin),
    'an entity above and left of the origin is found at its own position',
  );
  check(
    !grid.queryCircle(0, 0, MOB_GRID_CELL_SIZE).has(offOrigin),
    'it does not leak into a cell near the origin',
  );

  // Two cells whose keys genuinely do collide — one step apart on x, a full
  // packing range apart on y. They share a bucket, and it does not matter: both
  // query methods re-test every candidate they pull out of a bucket, so a
  // collision can only cost work, never produce a wrong answer.
  const KEY_RANGE_CELLS = 100000;
  const sharesBucketWithOffOrigin: TestBody = {
    x: -MOB_GRID_CELL_SIZE * (CELLS_LEFT_OF_ORIGIN + 1),
    y: MOB_GRID_CELL_SIZE * (KEY_RANGE_CELLS - CELLS_ABOVE_ORIGIN),
    mass: 1,
  };
  grid.insert(sharesBucketWithOffOrigin);
  check(
    !grid.queryCircle(offOrigin.x, offOrigin.y, TILE_SIZE).has(sharesBucketWithOffOrigin),
    'a bucket collision is still filtered out by the exact distance test',
  );

  grid.remove(offOrigin);
  check(
    !grid.queryCircle(offOrigin.x, offOrigin.y, TILE_SIZE).has(offOrigin),
    'a negative-coordinate entity can be removed again',
  );
}

console.log(failures === 0 ? '\nAll separation checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
