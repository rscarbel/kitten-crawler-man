/**
 * The routes `report:residency` can drive, per floor, and the shape of what a
 * route hands back from its own process. Free of game imports, so the report's
 * parent process can read it before any browser shim exists.
 */

import { z } from 'zod';

/**
 * Every floor the report knows and the routes it can walk there. A new floor
 * adds an entry and a driver; `compare` names the pair of routes whose
 * difference the report prints, the one that saw more first.
 */
export const RESIDENCY_FLOORS = {
  '3': { routes: ['tour', 'direct'], compare: ['tour', 'direct'] },
  'scaled-city': { routes: ['walk', 'arrive'], compare: ['walk', 'arrive'] },
} as const satisfies Record<
  string,
  { readonly routes: readonly string[]; readonly compare: readonly [string, string] }
>;

export type ResidencyFloor = keyof typeof RESIDENCY_FLOORS;

export function isResidencyFloor(value: string): value is ResidencyFloor {
  return Object.keys(RESIDENCY_FLOORS).includes(value);
}

export function routesOf(floor: ResidencyFloor): readonly string[] {
  return RESIDENCY_FLOORS[floor].routes;
}

/** How a route labels a milestone taken inside a building, before the building's name. */
export const INTERIOR_MILESTONE_PREFIX = 'in ';

/** The property a harness stamps on a survivor, so a heap snapshot can find exactly that instance. */
export const ABANDONED_LABEL_PROPERTY = 'residencyProbeAbandoned';

const ownerTallySchema = z.object({ surfaces: z.number(), bytes: z.number() });

export const SHEET_FAMILIES = ['ground', 'facade', 'indoorOnly', 'prop'] as const;
export type SheetFamily = (typeof SHEET_FAMILIES)[number];

const sheetRecordSchema = z.object({
  key: z.string(),
  family: z.enum(SHEET_FAMILIES),
  bytes: z.number(),
});

const figureRecordSchema = z.object({ id: z.string(), bytes: z.number() });

const snapshotSchema = z.object({
  label: z.string(),
  frame: z.number(),
  /** Surface tallies as the route left them. */
  asIs: z.record(z.string(), ownerTallySchema),
  /** The same tallies after forced collections, so garbage awaiting collection is counted out. */
  afterGc: z.record(z.string(), ownerTallySchema),
  sheets: z.array(sheetRecordSchema),
  /** What the environment cache charges itself, to check the per-sheet sizes against. */
  environmentCacheBytes: z.number(),
  figureCacheBytes: z.number(),
  pinnedRows: z.number(),
  pinnedBytes: z.number(),
  /** Every figure with cells in the cache, and the bytes they hold. */
  figures: z.array(figureRecordSchema),
  heapUsedBytes: z.number(),
  /** Labels of scenes and maps nothing plays any more that were still reachable after collection. */
  survivors: z.array(z.string()),
});

const retainerPathSchema = z.object({
  label: z.string(),
  node: z.string(),
  /** Root first, one link per reference, ending at the survivor. */
  path: z.array(z.string()),
});

/** What `heapRetainers.ts` prints. */
export const retainerSearchSchema = z.object({ targets: z.array(retainerPathSchema) });

/** A labelled number a route measured beyond the snapshots, such as a decision's cost. */
const measureSchema = z.object({ label: z.string(), value: z.string() });

export const routeResultSchema = z.object({
  floor: z.string(),
  route: z.string(),
  frames: z.number(),
  seconds: z.number(),
  /** Scenes and maps the route held weakly to find survivors among. */
  tracked: z.number(),
  snapshots: z.array(snapshotSchema),
  retainers: z.array(retainerPathSchema),
  measures: z.array(measureSchema),
  notes: z.array(z.string()),
  /** Ids of every figure row the floor's street crowd can be drawn as. */
  crowdFigureIds: z.array(z.string()),
  /** Ids of every figure a destination's own prewarm keeps resident while the party stands near it. */
  standByFigureIds: z.array(z.string()),
});

export type OwnerTally = z.infer<typeof ownerTallySchema>;
export type SheetRecord = z.infer<typeof sheetRecordSchema>;
export type FigureRecord = z.infer<typeof figureRecordSchema>;
export type ResidencySnapshot = z.infer<typeof snapshotSchema>;
export type RetainerPath = z.infer<typeof retainerPathSchema>;
export type RouteMeasure = z.infer<typeof measureSchema>;
export type RouteResult = z.infer<typeof routeResultSchema>;
