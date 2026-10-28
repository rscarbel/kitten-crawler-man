#!/usr/bin/env tsx
/**
 * What stays resident while the party stays on a floor: for a scripted route
 * over the real scenes, how many bytes and surfaces each owner holds at each
 * milestone, how much of that is garbage the collector has not yet taken, how
 * much is retained by a live reference, and how much a cache holds on purpose.
 *
 * A report, not a gate: it never fails on a number. Each route runs in its own
 * process, so no cache one route warmed can flatter another, with the world
 * seed, difficulty, render scale and variety tier pinned. At every milestone it
 * reads the surface tallies by owner as they stand and again after forced
 * collections, the painted sheets resident by family, and the figure cache's
 * pinned footprint and largest figures. Every scene and map a route walks away
 * from is held weakly; any still reachable after collection is a survivor, and
 * at the end of the route a heap snapshot is searched for what retains each.
 *
 *   npm run report:residency                           # floor 3: tour and direct, and their difference
 *   npm run report:residency -- --route=direct         # one route
 *   npm run report:residency -- --floor=scaled-city    # the scaled city: walked across vs arrived at its far edge (-- --blocks=N per side)
 *   npm run report:residency -- --no-retainers         # skip the heap snapshot search
 *   npm run report:residency -- --route=tour --interiors=1 --fault=retain-interiors
 *                                                      # must list survivors and name the harness as their retainer
 *
 * A new floor adds its routes to `RESIDENCY_FLOORS` (`residencyRoutes.ts`), a
 * driver module of its own, and a case for it in `runResidencyRouteHere`
 * (`residencyRouteProcess.ts`).
 */

import { writeFileSync } from 'node:fs';

import { runResidencyRouteHere, runRouteInChild } from './residencyRouteProcess.js';
import {
  isResidencyFloor,
  routesOf,
  RESIDENCY_FLOORS,
  SHEET_FAMILIES,
  type OwnerTally,
  type ResidencyFloor,
  type ResidencySnapshot,
  type RouteResult,
} from './residencyRoutes.js';
import { useDevPlayerIdentity } from '../src/dev/devPlayerIdentity.js';

useDevPlayerIdentity();

const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;
const MEGABYTE_PLACES = 1;
const SECONDS_PLACES = 0;
const REPORT_SCRIPT = 'scripts/report-residency.ts';
const OWNER_COLUMN = 20;
const NUMBER_COLUMN = 9;
const LABEL_COLUMN = 34;
/** Owners whose difference between routes is below this are left out of the comparison. */
const NEGLIGIBLE_DIFFERENCE_BYTES = BYTES_PER_KILOBYTE;
/** Route options a parent run hands on to each route's own process. */
const FORWARDED_ARGS: readonly string[] = ['blocks', 'interiors', 'fault'];
/** Figures listed by resident bytes under a route's last milestone. */
const LARGEST_FIGURES_SHOWN = 12;
/** Links of a retainer path printed, counted back from the survivor. */
const RETAINER_LINKS_SHOWN = 14;

function argValue(name: string): string | undefined {
  return process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(`--${name}=`.length);
}

const floorArg = argValue('floor') ?? '3';
if (!isResidencyFloor(floorArg)) {
  throw new Error(
    `unknown --floor=${floorArg}; known: ${Object.keys(RESIDENCY_FLOORS).join(', ')}`,
  );
}
const floor: ResidencyFloor = floorArg;
const routeArg = argValue('route');
const jsonOut = argValue('json');
const findRetainers = !process.argv.includes('--no-retainers');

function megabytes(bytes: number): string {
  return (bytes / BYTES_PER_MEGABYTE).toFixed(MEGABYTE_PLACES);
}

function signedMegabytes(bytes: number): string {
  const text = megabytes(bytes);
  return bytes > 0 ? `+${text}` : text;
}

function total(tallies: Readonly<Record<string, OwnerTally>>): OwnerTally {
  let surfaces = 0;
  let bytes = 0;
  for (const tally of Object.values(tallies)) {
    surfaces += tally.surfaces;
    bytes += tally.bytes;
  }
  return { surfaces, bytes };
}

function familyBytes(snapshot: ResidencySnapshot): Record<string, number> {
  const bytes: Record<string, number> = {};
  for (const family of SHEET_FAMILIES) bytes[family] = 0;
  for (const sheet of snapshot.sheets)
    bytes[sheet.family] = (bytes[sheet.family] ?? 0) + sheet.bytes;
  return bytes;
}

function printMilestones(result: RouteResult): void {
  console.log(
    `\n── floor ${result.floor}, route ${result.route}: ${result.frames} frames in ` +
      `${result.seconds.toFixed(SECONDS_PLACES)} s, ${result.tracked} scenes and maps tracked`,
  );
  console.log(
    [
      'milestone'.padEnd(LABEL_COLUMN),
      'MB as-is',
      'surf',
      'MB gc',
      'surf',
      'sheets',
      'fig MB',
      'pin MB',
      'heap MB',
      'alive',
    ].join('  '),
  );
  for (const snapshot of result.snapshots) {
    const asIs = total(snapshot.asIs);
    const afterGc = total(snapshot.afterGc);
    console.log(
      [
        snapshot.label.slice(0, LABEL_COLUMN).padEnd(LABEL_COLUMN),
        megabytes(asIs.bytes).padStart('MB as-is'.length),
        String(asIs.surfaces).padStart('surf'.length),
        megabytes(afterGc.bytes).padStart('MB gc'.length),
        String(afterGc.surfaces).padStart('surf'.length),
        megabytes(snapshot.environmentCacheBytes).padStart('sheets'.length),
        megabytes(snapshot.figureCacheBytes).padStart('fig MB'.length),
        megabytes(snapshot.pinnedBytes).padStart('pin MB'.length),
        megabytes(snapshot.heapUsedBytes).padStart('heap MB'.length),
        String(snapshot.survivors.length).padStart('alive'.length),
      ].join('  '),
    );
  }
}

function lastOf<T>(items: readonly T[]): T | undefined {
  return items.length === 0 ? undefined : items[items.length - 1];
}

function printFinalDetail(result: RouteResult): void {
  const last = lastOf(result.snapshots);
  if (last === undefined) return;
  console.log(`\nowners at "${last.label}" (MB, surfaces):`);
  const owners = new Set([...Object.keys(last.asIs), ...Object.keys(last.afterGc)]);
  for (const owner of owners) {
    const asIs = last.asIs[owner] ?? { surfaces: 0, bytes: 0 };
    const afterGc = last.afterGc[owner] ?? { surfaces: 0, bytes: 0 };
    if (asIs.bytes === 0 && afterGc.bytes === 0) continue;
    console.log(
      `  ${owner.padEnd(OWNER_COLUMN)} as-is ${megabytes(asIs.bytes).padStart(NUMBER_COLUMN)} ` +
        `${String(asIs.surfaces).padStart(NUMBER_COLUMN)}   after gc ` +
        `${megabytes(afterGc.bytes).padStart(NUMBER_COLUMN)} ${String(afterGc.surfaces).padStart(NUMBER_COLUMN)}`,
    );
  }
  const families = familyBytes(last);
  console.log(
    `  sheets by family (MB): ` +
      SHEET_FAMILIES.map((family) => `${family} ${megabytes(families[family] ?? 0)}`).join(', ') +
      ` — per-sheet sizes sum to ${megabytes(last.sheets.reduce((sum, s) => sum + s.bytes, 0))}, ` +
      `the cache charges ${megabytes(last.environmentCacheBytes)}`,
  );
  console.log(
    `  figure cache ${megabytes(last.figureCacheBytes)} MB, ${last.pinnedRows} pinned rows ` +
      `(${megabytes(last.pinnedBytes)} MB baked); largest: ` +
      [...last.figures]
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, LARGEST_FIGURES_SHOWN)
        .map((figure) => `${figure.id} ${megabytes(figure.bytes)}`)
        .join(', '),
  );
  for (const measure of result.measures) console.log(`  ${measure.label}: ${measure.value}`);
  if (last.survivors.length > 0) {
    console.log(`  still reachable after collection: ${last.survivors.join(', ')}`);
  }
  for (const retainer of result.retainers) {
    console.log(`\n  retained: ${retainer.label} (${retainer.node})`);
    if (retainer.path.length === 0) console.log('    (unreachable in the snapshot)');
    for (const link of retainer.path.slice(-RETAINER_LINKS_SHOWN)) console.log(`    ${link}`);
  }
  for (const note of result.notes) console.log(`  note: ${note}`);
}

function printComparison(more: RouteResult, less: RouteResult): void {
  const moreLast = lastOf(more.snapshots);
  const lessLast = lastOf(less.snapshots);
  if (moreLast === undefined || lessLast === undefined) return;
  console.log(
    `\n══ ${more.route} − ${less.route} at "${moreLast.label}" (MB; surfaces in brackets) ══`,
  );
  const owners = new Set([
    ...Object.keys(moreLast.asIs),
    ...Object.keys(lessLast.asIs),
    ...Object.keys(moreLast.afterGc),
    ...Object.keys(lessLast.afterGc),
  ]);
  const zero = { surfaces: 0, bytes: 0 };
  const rows: Array<{ owner: string; asIs: OwnerTally; afterGc: OwnerTally }> = [];
  for (const owner of owners) {
    const asIsMore = moreLast.asIs[owner] ?? zero;
    const asIsLess = lessLast.asIs[owner] ?? zero;
    const gcMore = moreLast.afterGc[owner] ?? zero;
    const gcLess = lessLast.afterGc[owner] ?? zero;
    rows.push({
      owner,
      asIs: {
        bytes: asIsMore.bytes - asIsLess.bytes,
        surfaces: asIsMore.surfaces - asIsLess.surfaces,
      },
      afterGc: { bytes: gcMore.bytes - gcLess.bytes, surfaces: gcMore.surfaces - gcLess.surfaces },
    });
  }
  rows.sort((a, b) => Math.abs(b.asIs.bytes) - Math.abs(a.asIs.bytes));
  console.log(
    `  ${'owner'.padEnd(OWNER_COLUMN)} ${'as-is'.padStart(NUMBER_COLUMN)}          after gc`,
  );
  for (const row of rows) {
    const negligible =
      Math.abs(row.asIs.bytes) < NEGLIGIBLE_DIFFERENCE_BYTES &&
      Math.abs(row.afterGc.bytes) < NEGLIGIBLE_DIFFERENCE_BYTES;
    if (negligible) continue;
    console.log(
      `  ${row.owner.padEnd(OWNER_COLUMN)} ${signedMegabytes(row.asIs.bytes).padStart(NUMBER_COLUMN)} ` +
        `(${row.asIs.surfaces})`.padEnd(NUMBER_COLUMN) +
        ` ${signedMegabytes(row.afterGc.bytes).padStart(NUMBER_COLUMN)} (${row.afterGc.surfaces})`,
    );
  }
  const asIsTotal = total(moreLast.asIs).bytes - total(lessLast.asIs).bytes;
  const gcTotal = total(moreLast.afterGc).bytes - total(lessLast.afterGc).bytes;
  console.log(
    `  ${'total'.padEnd(OWNER_COLUMN)} ${signedMegabytes(asIsTotal).padStart(NUMBER_COLUMN)} ` +
      `(${total(moreLast.asIs).surfaces - total(lessLast.asIs).surfaces})`.padEnd(NUMBER_COLUMN) +
      ` ${signedMegabytes(gcTotal).padStart(NUMBER_COLUMN)} ` +
      `(${total(moreLast.afterGc).surfaces - total(lessLast.afterGc).surfaces})`,
  );
  const moreFamilies = familyBytes(moreLast);
  const lessFamilies = familyBytes(lessLast);
  console.log(
    `  sheets by family: ` +
      SHEET_FAMILIES.map(
        (family) =>
          `${family} ${signedMegabytes((moreFamilies[family] ?? 0) - (lessFamilies[family] ?? 0))}`,
      ).join(', '),
  );
  const onlyMore = moreLast.sheets.filter(
    (sheet) => !lessLast.sheets.some((other) => other.key === sheet.key),
  );
  console.log(
    `  sheets resident only after ${more.route}: ` +
      onlyMore
        .map((sheet) => `${sheet.key} (${sheet.family}, ${megabytes(sheet.bytes)})`)
        .join(', '),
  );
  console.log(
    `  figure cache ${signedMegabytes(moreLast.figureCacheBytes - lessLast.figureCacheBytes)}, ` +
      `pinned ${signedMegabytes(moreLast.pinnedBytes - lessLast.pinnedBytes)} ` +
      `(${moreLast.pinnedRows - lessLast.pinnedRows} rows), ` +
      `JS heap ${signedMegabytes(moreLast.heapUsedBytes - lessLast.heapUsedBytes)}`,
  );
}

function printRoute(result: RouteResult): void {
  printMilestones(result);
  printFinalDetail(result);
}

if (typeof Reflect.get(globalThis, 'gc') !== 'function') {
  throw new Error('run under node --expose-gc (npm run report:residency does)');
}

if (routeArg !== undefined) {
  if (!routesOf(floor).includes(routeArg)) {
    throw new Error(
      `floor ${floor} has no route ${routeArg}; known: ${routesOf(floor).join(', ')}`,
    );
  }
  const interiors = argValue('interiors');
  const result = await runResidencyRouteHere(floor, routeArg, {
    findRetainers,
    interiors: interiors === undefined ? undefined : Number(interiors),
    fault: argValue('fault'),
  });
  printRoute(result);
  if (jsonOut !== undefined) writeFileSync(jsonOut, JSON.stringify(result));
  process.exit(0);
}

const results = new Map<string, RouteResult>();
const childArgs = [
  `--floor=${floor}`,
  ...(findRetainers ? [] : ['--no-retainers']),
  ...process.argv.filter((arg) => FORWARDED_ARGS.some((name) => arg.startsWith(`--${name}=`))),
];
// One route at a time: figure bakes are paced by the wall clock, so routes
// sharing the CPU would each bake differently than alone.
for (const route of routesOf(floor)) {
  const run = await runRouteInChild(REPORT_SCRIPT, route, childArgs, true);
  if (run.result === null) console.error(`route ${route} failed`);
  else results.set(route, run.result);
}
const [moreRoute, lessRoute] = RESIDENCY_FLOORS[floor].compare;
const more = results.get(moreRoute);
const less = results.get(lessRoute);
if (more !== undefined && less !== undefined) printComparison(more, less);
process.exit(results.size === routesOf(floor).length ? 0 : 1);
