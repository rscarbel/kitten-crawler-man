/**
 * On-screen readout for `perfMonitor`, reached via `?perf` in `devBootScene`.
 *
 * Lives here rather than beside the monitor so a release build has no import
 * edge to it at all — see the module comment on `devBoot.ts`. It exists because
 * spawn-density tuning otherwise has no number to argue with: the separation
 * row shows the cost of mob-separation checks, and the check count next to it
 * shows whether that cost tracks the roster size or the local crowding.
 */

import { PERF_TIMERS, perfMonitor } from '../core/perf/PerfMonitor';
import { viewportWidth } from '../core/rendering/Viewport';
import { BYTES_PER_MEGABYTE } from '../core/rendering/canvasSurface';
import { lastFrameCost } from '../core/perf/frameCost';
import { varietyTier } from '../core/perf/varietyTier';
import { getFigureCacheStats } from '../sprites/figure/figureCacheStats';
import {
  environmentArtBytes,
  environmentArtSheetCount,
  environmentPaintDepth,
  environmentSheetsAwaiting,
  environmentSheetsQueued,
} from '../map/environmentArtCache';
import { buildingSheetsNotYetQueued } from '../sprites/buildinggen/runtimeBuildingSheets';
import { largestMemoryOwners, perfMemorySnapshot } from './perfMemory';
import { inset, type Rect } from '../ui/core/geom';
import { WORLD_TEXT } from '../ui/theme/worldInk';
import { worldPlate } from '../ui/world/worldShapes';
import { worldText } from '../ui/world/worldText';

const PANEL_WIDTH = 190;
const PANEL_MARGIN = 8;
const PANEL_PADDING = 8;
const PANEL_RADIUS = 4;
const ROW_HEIGHT = 14;
const VALUE_COLUMN_OFFSET = 96;

/** Tenths of a millisecond is too coarse for a pass that costs well under one. */
const MS_DECIMALS = 2;
const WORST_MS_DECIMALS = 1;
/** Gauges are per-frame averages, so a burst of one bake in a window shows as a fraction. */
const GAUGE_DECIMALS = 2;
const FPS_DECIMALS = 1;
const MEGABYTE_DECIMALS = 1;
const PERCENT = 100;

/**
 * A hit rate below this means the figure cache is paying to paint rather than
 * to blit — the one number the procedural-creature trade turns on.
 */
const FIGURE_HIT_RATE_WARNING = 90;

/** Below this the frame is missing its budget badly enough to call out in red. */
const FPS_WARNING_THRESHOLD = 50;

interface PerfRow {
  label: string;
  value: string;
  color: string;
}

/** Mean and worst frame side by side: the lag worth chasing is bursts, which a mean hides. */
function formatMeanAndWorst(meanMs: number, worstMs: number): string {
  return `${meanMs.toFixed(MS_DECIMALS)}/${worstMs.toFixed(WORST_MS_DECIMALS)}`;
}

function formatGaugePair(first: number, second: number): string {
  return `${first.toFixed(GAUGE_DECIMALS)}/${second.toFixed(GAUGE_DECIMALS)}`;
}

/**
 * The figure cache's rows, or none at all when nothing painted has been drawn
 * yet — three empty rows in a scene of baked art would read as a fault.
 */
function figureCacheRows(neutral: string): PerfRow[] {
  const stats = getFigureCacheStats();
  const lookups = stats.hits + stats.misses;
  if (lookups === 0 && stats.bytes === 0) return [];
  const hitRate = lookups === 0 ? PERCENT : (stats.hits / lookups) * PERCENT;
  return [
    {
      label: 'fig hit%',
      value: hitRate.toFixed(0),
      color: hitRate < FIGURE_HIT_RATE_WARNING ? WORLD_TEXT.danger.color : WORLD_TEXT.value.color,
    },
    {
      label: 'fig MB/rows',
      value: `${(stats.bytes / BYTES_PER_MEGABYTE).toFixed(MEGABYTE_DECIMALS)}/${stats.rows}`,
      color: neutral,
    },
    {
      label: 'fig total b/d',
      value: `${stats.bakes + stats.prewarmBakes}/${stats.directDraws}`,
      color: stats.directDraws > 0 ? WORLD_TEXT.danger.color : neutral,
    },
  ];
}

/**
 * The runtime-painted environment sheets, or no rows at all before any have been
 * asked for — a scene drawn entirely from baked art has nothing to report here.
 */
function environmentArtRows(neutral: string): PerfRow[] {
  const sheets = environmentArtSheetCount();
  const steps = environmentPaintDepth();
  // Every sheet still to land, not only the ones being painted: a sheet waiting
  // to be repainted after a purge, refused memory, or not yet reached by the
  // facade chain is just as missing from the world.
  const owedSheets =
    environmentSheetsQueued() + environmentSheetsAwaiting() + buildingSheetsNotYetQueued();
  if (sheets === 0 && owedSheets === 0) return [];
  return [
    {
      label: 'env MB/sheets',
      value: `${(environmentArtBytes() / BYTES_PER_MEGABYTE).toFixed(MEGABYTE_DECIMALS)}/${sheets}`,
      color: neutral,
    },
    {
      label: 'env owed sh/st',
      value: `${owedSheets}/${steps}`,
      color: owedSheets > 0 ? WORLD_TEXT.value.color : neutral,
    },
  ];
}

/** Enough to name where the memory went without crowding out the timer rows. */
const LARGEST_MEMORY_OWNERS_SHOWN = 3;
/** An owner's name is cut short where it would run into the value column. */
const MEMORY_OWNER_LABEL_CHARS = 15;

/** Every tracked owner's bytes as one total, then the owners holding the most of them. */
function memoryRows(neutral: string): PerfRow[] {
  const snapshot = perfMemorySnapshot();
  const totalMegabytes = snapshot.totalBytes / BYTES_PER_MEGABYTE;
  const ownerRows = largestMemoryOwners(LARGEST_MEMORY_OWNERS_SHOWN).map(({ owner, tally }) => ({
    label: ` ${owner.slice(0, MEMORY_OWNER_LABEL_CHARS)}`,
    value: `${(tally.bytes / BYTES_PER_MEGABYTE).toFixed(MEGABYTE_DECIMALS)}/${tally.surfaces}`,
    color: neutral,
  }));
  return [
    {
      label: 'mem MB/surf',
      value: `${totalMegabytes.toFixed(MEGABYTE_DECIMALS)}/${snapshot.totalSurfaces}`,
      color: WORLD_TEXT.value.color,
    },
    ...ownerRows,
  ];
}

/**
 * The last frame's update, render and bake milliseconds as the release build
 * measures them — the split the quality controller picks its rung by.
 */
function frameCostRow(neutral: string): PerfRow {
  const cost = lastFrameCost();
  return {
    label: 'upd/rnd/bake',
    value: [cost.updateMs, cost.renderMs, cost.bakeMs]
      .map((ms) => ms.toFixed(WORST_MS_DECIMALS))
      .join('/'),
    color: neutral,
  };
}

function buildRows(): PerfRow[] {
  const fps = perfMonitor.fps;
  const neutral = WORLD_TEXT.label.color;
  const timerRows: PerfRow[] = PERF_TIMERS.map((timer) => ({
    label: timer,
    value: formatMeanAndWorst(perfMonitor.msPerFrame(timer), perfMonitor.worstMsPerFrame(timer)),
    color: neutral,
  }));
  const activeMobs = Math.round(perfMonitor.perFrame('activeMobs'));
  const separatedMobs = Math.round(perfMonitor.perFrame('separationMobs'));
  return [
    {
      label: 'fps',
      value: fps.toFixed(FPS_DECIMALS),
      color: fps < FPS_WARNING_THRESHOLD ? WORLD_TEXT.danger.color : WORLD_TEXT.value.color,
    },
    { label: 'ms avg/max', value: '', color: neutral },
    ...timerRows,
    frameCostRow(neutral),
    { label: 'variety tier', value: varietyTier().toString(), color: neutral },
    { label: 'mobs act/sep', value: `${activeMobs}/${separatedMobs}`, color: neutral },
    {
      label: 'sep checks',
      value: Math.round(perfMonitor.perFrame('separationChecks')).toString(),
      color: neutral,
    },
    {
      label: 'chunk bake/dir',
      value: formatGaugePair(
        perfMonitor.perFrame('chunkBakes'),
        perfMonitor.perFrame('chunkDirectDraws'),
      ),
      color: perfMonitor.perFrame('chunkDirectDraws') > 0 ? WORLD_TEXT.danger.color : neutral,
    },
    {
      label: 'chunk patch',
      value: perfMonitor.perFrame('chunkRepaints').toFixed(GAUGE_DECIMALS),
      color: neutral,
    },
    {
      label: 'chunk stale',
      value: perfMonitor.perFrame('staleChunks').toFixed(GAUGE_DECIMALS),
      color: neutral,
    },
    {
      label: 'overlay redraw',
      value: perfMonitor.perFrame('overlayRedraws').toFixed(GAUGE_DECIMALS),
      color: neutral,
    },
    {
      label: 'fig bake/paint',
      value: formatGaugePair(
        perfMonitor.perFrame('figureBakes'),
        perfMonitor.perFrame('figureDirectPaints'),
      ),
      color: perfMonitor.perFrame('figureDirectPaints') > 0 ? WORLD_TEXT.danger.color : neutral,
    },
    ...figureCacheRows(neutral),
    ...environmentArtRows(neutral),
    ...memoryRows(neutral),
  ];
}

declare global {
  var __perfRows: Record<string, string> | undefined;
}

export function drawPerfOverlay(ctx: CanvasRenderingContext2D): void {
  if (!perfMonitor.enabled) return;

  const rows = buildRows();
  // Also published, not only drawn: this readout is the instrument for the
  // frame cache, and browser automation cannot read a canvas.
  globalThis.__perfRows = Object.fromEntries(rows.map((row) => [row.label, row.value]));
  const frame: Rect = {
    x: viewportWidth() - PANEL_WIDTH - PANEL_MARGIN,
    y: PANEL_MARGIN,
    w: PANEL_WIDTH,
    h: rows.length * ROW_HEIGHT + PANEL_PADDING * 2,
  };
  worldPlate(ctx, frame, { style: 'panel', radius: PANEL_RADIUS });
  const inner = inset(frame, PANEL_PADDING);

  rows.forEach((row, index) => {
    const y = inner.y + index * ROW_HEIGHT;
    worldText(ctx, row.label, { x: inner.x, y, style: 'hint' });
    worldText(ctx, row.value, {
      x: inner.x + VALUE_COLUMN_OFFSET,
      y,
      style: 'hint',
      color: row.color,
    });
  });
}
