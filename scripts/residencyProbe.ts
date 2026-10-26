/**
 * Measurements `report:residency` takes at each milestone of a route: who owns
 * the off-screen pixels, which painted sheets are resident and of what family,
 * what the figure cache holds and pins, and which objects a route abandoned are
 * still reachable after the collector has run.
 *
 * Import only after the browser shim is installed: the modules it reads touch
 * `document` at load time.
 */

import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { writeHeapSnapshot } from 'node:v8';

import {
  surfaceTallies,
  BYTES_PER_MEGABYTE,
  SURFACE_BYTES_PER_PIXEL,
} from '../src/core/rendering/canvasSurface.js';
import { ASSET_GROUPS, type AssetGroup } from '../src/core/spriteAssets/assetGroups.js';
import {
  getManifestEntry,
  sheetSizePx,
  shouldDownscaleForLowEndDevice,
  DOWNSCALE_FACTOR,
  type SpriteKey,
} from '../src/core/spriteAssets/SpriteLoader.js';
import {
  environmentArtBytes,
  residentEnvironmentSheetKeys,
} from '../src/map/environmentArtCache.js';
import { GROUND_SHEET_KEYS } from '../src/map/ground/runtimeGroundSheets.js';
import { GROUND_MASK_SHEET_KEY } from '../src/map/ground/groundFrames.js';
import { BUILDING_KEYS } from '../src/sprites/buildinggen/runtimeBuildingSheets.js';
import { plannedEnvironmentSheetSizes } from '../src/sprites/sheets/environmentSheets.js';
import {
  pinnedFigureFootprint,
  pinnedFigureRowCount,
  residentFigureCells,
} from '../src/sprites/figure/figureFrameCache.js';
import type { LevelDef } from '../src/levels/types.js';
import { PLAYER_SPEED } from '../src/core/constants.js';
import { SPEED_FIZZ_MULTIPLIER } from '../src/Player.js';
import { REFRESHED_SPEED_FACTOR } from '../src/core/combat/StatusEffect.js';
import {
  ABANDONED_LABEL_PROPERTY,
  retainerSearchSchema,
  type FigureRecord,
  type OwnerTally,
  type ResidencySnapshot,
  type RetainerPath,
  type SheetFamily,
  type SheetRecord,
} from './residencyRoutes.js';

/** Collections forced per measurement; finalization callbacks need a turn of the loop after each. */
const GC_ROUNDS = 4;

/** The fastest a crawler walks without cheats, per update: Speed Fizz on top of the stall's boon. */
export const FASTEST_WALK_PX_PER_UPDATE =
  PLAYER_SPEED * SPEED_FIZZ_MULTIPLIER * REFRESHED_SPEED_FACTOR;

function collector(): (() => void) | null {
  const gc: unknown = Reflect.get(globalThis, 'gc');
  if (typeof gc !== 'function') return null;
  return () => {
    Reflect.apply(gc, undefined, []);
  };
}

/** Whether forced collection is available: the report must run under `--expose-gc`. */
export function canForceGc(): boolean {
  return collector() !== null;
}

/** Collects several times, yielding between, so finalization callbacks have run by the end. */
export async function collectGarbage(): Promise<void> {
  const gc = collector();
  if (gc === null) throw new Error('run under --expose-gc');
  for (let round = 0; round < GC_ROUNDS; round++) {
    gc();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

interface TrackedObject {
  readonly label: string;
  readonly ref: WeakRef<object>;
}

/**
 * Holds every scene and map a route passes through, weakly. One still alive
 * after collection that the running scene does not use is a survivor: nothing
 * plays it, yet something keeps it.
 *
 * Whether an object is in use is asked at measurement time rather than decided
 * when a scene is replaced, because a map can outlive the scene that built it
 * legitimately: an overworld exit hands the same map to the scene it builds.
 */
export class ReachabilityTracker {
  private readonly tracked: TrackedObject[] = [];
  private readonly seen = new WeakSet();

  track(label: string, target: object): void {
    if (this.seen.has(target)) return;
    this.seen.add(target);
    this.tracked.push({ label, ref: new WeakRef(target) });
  }

  /**
   * Labels of tracked objects alive and not in `inUse`; call after
   * {@link collectGarbage}. A `deref` keeps its target alive until the current
   * task ends, so a heap snapshot must wait a turn of the event loop after this.
   */
  survivors(inUse: ReadonlySet<object>): string[] {
    return this.tracked
      .filter((tracked) => {
        const target = tracked.ref.deref();
        return target !== undefined && !inUse.has(target);
      })
      .map((tracked) => tracked.label);
  }

  /** Stamps each survivor with its label, so a heap snapshot can find exactly those instances. */
  stampSurvivors(inUse: ReadonlySet<object>): void {
    for (const tracked of this.tracked) {
      const target = tracked.ref.deref();
      if (target !== undefined && !inUse.has(target)) {
        Reflect.set(target, ABANDONED_LABEL_PROPERTY, tracked.label);
      }
    }
  }

  get trackedCount(): number {
    return this.tracked.length;
  }
}

function tallyRecord(): Record<string, OwnerTally> {
  const record: Record<string, OwnerTally> = {};
  for (const [owner, tally] of surfaceTallies()) {
    record[owner] = { surfaces: tally.surfaces, bytes: tally.bytes };
  }
  return record;
}

/**
 * Classifies and sizes resident painted sheets from their plans, without
 * looking a sheet up: a lookup counts as a draw and would keep the sheet the
 * report is measuring from looking idle.
 */
export class SheetCatalogue {
  private readonly bytesByKey = new Map<string, number>();
  private readonly indoorOnlyKeys: ReadonlySet<string>;
  private readonly groundKeys: ReadonlySet<string> = new Set<string>([
    ...GROUND_SHEET_KEYS,
    GROUND_MASK_SHEET_KEY,
  ]);
  private readonly facadeKeys: ReadonlySet<string> = new Set<string>(BUILDING_KEYS);

  constructor(level: Pick<LevelDef, 'spriteGroups' | 'interiorSpriteGroups'>) {
    const allGroups = Object.keys(ASSET_GROUPS).filter(
      (name): name is AssetGroup => name in ASSET_GROUPS,
    );
    const paintScale = shouldDownscaleForLowEndDevice() ? DOWNSCALE_FACTOR : 1;
    const areaScale = paintScale * paintScale;
    for (const size of plannedEnvironmentSheetSizes(allGroups)) {
      this.bytesByKey.set(
        size.key,
        size.widthPx * size.heightPx * SURFACE_BYTES_PER_PIXEL * areaScale,
      );
    }
    const groundKeys: SpriteKey[] = [...GROUND_SHEET_KEYS, GROUND_MASK_SHEET_KEY];
    for (const key of groundKeys) {
      const { widthPx, heightPx } = sheetSizePx(getManifestEntry(key));
      this.bytesByKey.set(key, widthPx * heightPx * SURFACE_BYTES_PER_PIXEL * areaScale);
    }
    const outdoorKeys = new Set<string>(level.spriteGroups.flatMap((group) => ASSET_GROUPS[group]));
    this.indoorOnlyKeys = new Set<string>(
      level.interiorSpriteGroups
        .flatMap((group) => ASSET_GROUPS[group])
        .filter((key) => !outdoorKeys.has(key)),
    );
  }

  familyOf(key: string): SheetFamily {
    if (this.groundKeys.has(key)) return 'ground';
    if (this.facadeKeys.has(key)) return 'facade';
    if (this.indoorOnlyKeys.has(key)) return 'indoorOnly';
    return 'prop';
  }

  bytesOf(key: string): number {
    return this.bytesByKey.get(key) ?? 0;
  }

  resident(): SheetRecord[] {
    return residentEnvironmentSheetKeys().map((key) => ({
      key,
      family: this.familyOf(key),
      bytes: this.bytesOf(key),
    }));
  }
}

function residentFigures(): FigureRecord[] {
  return residentFigureCells().map((figure) => ({ id: figure.figureId, bytes: figure.bytes }));
}

/** Takes one milestone's measurements, forcing collection between the as-is and after-GC tallies. */
export async function takeSnapshot(
  label: string,
  frame: number,
  catalogue: SheetCatalogue,
  tracker: ReachabilityTracker,
  inUse: ReadonlySet<object>,
): Promise<ResidencySnapshot> {
  const asIs = tallyRecord();
  await collectGarbage();
  const afterGc = tallyRecord();
  const pinned = pinnedFigureFootprint();
  const figures = residentFigures();
  return {
    label,
    frame,
    asIs,
    afterGc,
    sheets: catalogue.resident(),
    environmentCacheBytes: environmentArtBytes(),
    figureCacheBytes: figures.reduce((sum, figure) => sum + figure.bytes, 0),
    pinnedRows: pinnedFigureRowCount(),
    pinnedBytes: pinned.bytes,
    figures,
    heapUsedBytes: process.memoryUsage().heapUsed,
    survivors: tracker.survivors(inUse),
  };
}

/** Room for the retainer search's one-line JSON answer, which lists every link of every path. */
const RETAINER_OUTPUT_MEGABYTES = 64;
const RETAINER_OUTPUT_BYTES = RETAINER_OUTPUT_MEGABYTES * BYTES_PER_MEGABYTE;

/**
 * Stamps the tracker's survivors, writes a heap snapshot of this process and
 * searches it, in a process of its own, for what holds each one. The snapshot
 * is deleted afterwards: it runs to hundreds of megabytes.
 */
export async function searchRetainers(
  directory: string,
  tracker: ReachabilityTracker,
  inUse: ReadonlySet<object>,
): Promise<RetainerPath[]> {
  tracker.stampSurvivors(inUse);
  // Lets the task end, so the survivors are no longer kept by the deref that found them.
  await new Promise((resolve) => setImmediate(resolve));
  const file = writeHeapSnapshot(`${directory}/residency-${process.pid}.heapsnapshot`);
  try {
    const search = spawnSync(
      process.execPath,
      [...process.execArgv, 'scripts/heapRetainers.ts', file],
      { encoding: 'utf8', maxBuffer: RETAINER_OUTPUT_BYTES },
    );
    if (search.status !== 0) {
      throw new Error(`the retainer search failed: ${search.stderr}`);
    }
    return retainerSearchSchema.parse(JSON.parse(search.stdout)).targets;
  } finally {
    rmSync(file, { force: true });
  }
}
