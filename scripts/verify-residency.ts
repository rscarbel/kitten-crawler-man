#!/usr/bin/env tsx
/**
 * Memory is given back once the party has left a place, without the stairs.
 *
 * Runs floor 3's two `report:residency` routes, each in its own process:
 * `tour` visits two interiors and walks the streets between them before going
 * to Briar Hollow; `direct` goes straight there. Both then stand at the
 * village for longer than every cache's idle window. Then:
 *
 *  - owner by owner, the route that saw more holds no more than the one that
 *    saw less, within a named tolerance;
 *  - no figure first drawn indoors still has cells in the cache, unless the
 *    direct route holds it too, the street crowd can wear it, or the village
 *    cast's own prewarm keeps it;
 *  - nothing either route walked away from is still reachable after collection.
 *
 * The routes are compared with each other, never with stored megabytes, so a
 * change to what a place costs moves both sides alike. The figure cache's
 * total is not compared: both routes leave the same crowd behind, and what it
 * holds at the village follows the wall clock its rows are baked against and
 * whichever wanderers stand near the village when each route arrives (pinned
 * bytes alone came out 4.6 and 9.1 MB apart in two runs).
 *
 *   npm run verify:residency
 */

import { writeFileSync } from 'node:fs';

import { runResidencyRouteHere, runRouteInChild } from './residencyRouteProcess.js';
import {
  INTERIOR_MILESTONE_PREFIX,
  type OwnerTally,
  type ResidencySnapshot,
  type RouteResult,
} from './residencyRoutes.js';
import type { SurfaceOwner } from '../src/core/rendering/canvasSurface.js';
import type { BuildingId } from '../src/map/buildingIds.js';

const SCRIPT = 'scripts/verify-residency.ts';
/**
 * The inn, whose safe room paints the indoor and dungeon ground sheets, and
 * Miller's Farm, whose furniture is baked into the town-interior prop cache.
 */
const TOUR_BUILDINGS: readonly BuildingId[] = ['taloncrest_inn', 'taloncrest_mill_farm'];
const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;
const MEGABYTE_PLACES = 1;
/**
 * The most an owner may hold after the tour over what it holds after the
 * direct walk. What legitimately stays is small: after a twelve-interior tour
 * the ground-tile part caches held 1.3 MB more (parts of the rooms' floor
 * materials, capped by count and cleared at the stairs) and nothing else
 * above half a megabyte. A lapse in any idle release leaves several megabytes:
 * a chunk is 1 MB, a ground sheet 2.5 MB and up.
 */
const OWNER_TOLERANCE_MEGABYTES = 2;
const OWNER_TOLERANCE_BYTES = OWNER_TOLERANCE_MEGABYTES * BYTES_PER_MEGABYTE;
const FIGURE_CELLS_OWNER = 'figureCells' satisfies SurfaceOwner;
/**
 * Owners every route holds something of at the village. An empty one means
 * the tallies were not read, and every comparison would pass on zeros.
 */
const OWNERS_ALWAYS_HELD: readonly SurfaceOwner[] = [
  'environmentSheets',
  'tileChunks',
  FIGURE_CELLS_OWNER,
];

function argValue(name: string): string | undefined {
  return process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(`--${name}=`.length);
}

function megabytes(bytes: number): string {
  return (bytes / BYTES_PER_MEGABYTE).toFixed(MEGABYTE_PLACES);
}

const routeArg = argValue('route');
if (routeArg !== undefined) {
  const result = await runResidencyRouteHere('3', routeArg, {
    findRetainers: false,
    interiors: TOUR_BUILDINGS.length,
    firstBuildings: TOUR_BUILDINGS,
  });
  const jsonOut = argValue('json');
  if (jsonOut === undefined) throw new Error('a route run needs --json=<file>');
  writeFileSync(jsonOut, JSON.stringify(result));
  process.exit(0);
}

const failures: string[] = [];
// One route at a time: figure bakes are paced by the wall clock, so routes
// sharing the CPU would each bake differently than alone.
const tourRun = await runRouteInChild(SCRIPT, 'tour', []);
const directRun = await runRouteInChild(SCRIPT, 'direct', []);

function finalSnapshot(route: string, result: RouteResult | null): ResidencySnapshot | null {
  if (result === null) return null;
  for (const note of result.notes) failures.push(`${route}: ${note}`);
  return result.snapshots.at(-1) ?? null;
}

function totalBytes(tallies: Readonly<Record<string, OwnerTally>>): number {
  return Object.values(tallies).reduce((sum, tally) => sum + tally.bytes, 0);
}

/**
 * Figures that first had cells in the cache at a milestone taken indoors, and
 * that the street crowd cannot wear: the room's own occupants and fixtures.
 *
 * The Briar Hollow cast is left out too. Its prewarm starts as the party nears
 * the palisade, which a tour building near the village can trigger, and keeps
 * re-asking for the cast while the party stands in the village. Whether a
 * member is still held at the end then depends on whether the paced queue got
 * to it, not on anything left behind indoors.
 */
function figuresFirstDrawnIndoors(result: RouteResult): Set<string> {
  const heldOutdoors = new Set([...result.crowdFigureIds, ...result.standByFigureIds]);
  const indoors = new Set<string>();
  result.snapshots.forEach((snapshot, index) => {
    if (!snapshot.label.startsWith(INTERIOR_MILESTONE_PREFIX) || index === 0) return;
    const before = new Set(result.snapshots[index - 1].figures.map((figure) => figure.id));
    for (const figure of snapshot.figures) {
      if (!before.has(figure.id) && !heldOutdoors.has(figure.id)) indoors.add(figure.id);
    }
  });
  return indoors;
}

const tour = finalSnapshot('tour', tourRun.result);
const direct = finalSnapshot('direct', directRun.result);
for (const run of [tourRun, directRun]) {
  if (run.result === null) {
    console.log(run.output);
    failures.push(`the ${run.route} route did not finish`);
  }
}

if (tour !== null && direct !== null && tourRun.result !== null) {
  if (tour.label !== direct.label) {
    failures.push(`the routes ended at different milestones: "${tour.label}", "${direct.label}"`);
  }
  if (totalBytes(direct.afterGc) === 0) {
    failures.push('the direct route read no surfaces at all; every comparison would pass on zeros');
  }
  for (const [route, snapshot] of [
    ['tour', tour],
    ['direct', direct],
  ] as const) {
    if (snapshot.survivors.length > 0) {
      failures.push(`still reachable after leaving: ${snapshot.survivors.join(', ')}`);
    }
    for (const owner of OWNERS_ALWAYS_HELD) {
      if ((snapshot.afterGc[owner]?.bytes ?? 0) === 0) {
        failures.push(`the ${route} route read nothing held by ${owner}, which every route holds`);
      }
    }
  }

  const zero: OwnerTally = { surfaces: 0, bytes: 0 };
  const tallies = [
    { reading: 'as-is', more: tour.asIs, less: direct.asIs },
    { reading: 'after collection', more: tour.afterGc, less: direct.afterGc },
  ] as const;
  const differences: string[] = [];
  for (const { reading, more, less } of tallies) {
    const owners = new Set([...Object.keys(more), ...Object.keys(less)]);
    owners.delete(FIGURE_CELLS_OWNER);
    for (const owner of owners) {
      const extra = (more[owner] ?? zero).bytes - (less[owner] ?? zero).bytes;
      if (reading === 'as-is' && extra !== 0) differences.push(`${owner} ${megabytes(extra)}`);
      if (extra > OWNER_TOLERANCE_BYTES) {
        failures.push(
          `${owner} (${reading}) holds ${megabytes(extra)} MB more after the tour than after ` +
            `the direct walk (tolerance ${OWNER_TOLERANCE_MEGABYTES} MB)`,
        );
      }
    }
  }

  const interiorMilestones = tourRun.result.snapshots.filter((snapshot) =>
    snapshot.label.startsWith(INTERIOR_MILESTONE_PREFIX),
  ).length;
  if (interiorMilestones < TOUR_BUILDINGS.length) {
    failures.push(
      `the tour measured ${interiorMilestones} milestones indoors, fewer than its ` +
        `${TOUR_BUILDINGS.length} buildings`,
    );
  }
  const indoorFigures = figuresFirstDrawnIndoors(tourRun.result);
  if (indoorFigures.size === 0) {
    failures.push('no figure was first drawn indoors, so no indoor figure could be checked');
  }
  const heldAfterDirect = new Set(direct.figures.map((figure) => figure.id));
  const leftIndoors = tour.figures.filter(
    (figure) => indoorFigures.has(figure.id) && !heldAfterDirect.has(figure.id),
  );
  for (const figure of leftIndoors) {
    failures.push(
      `${figure.id}, first drawn indoors, still holds ${megabytes(figure.bytes)} MB at the village`,
    );
  }
  console.log(
    `tour − direct at "${tour.label}" (MB): ${differences.join(', ')}; ` +
      `first drawn indoors: ${[...indoorFigures].join(', ')}; ${leftIndoors.length} still held`,
  );
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}
console.log('verify-residency: ok');
process.exit(0);
