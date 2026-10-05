/**
 * On-screen readout for `perfMonitor`, reached via `?perf` in `devBootScene`.
 *
 * Lives here rather than beside the monitor so a release build has no import
 * edge to it at all — see the module comment on `devBoot.ts`. It exists because
 * spawn-density tuning otherwise has no number to argue with: the separation
 * row shows the cost of mob-separation checks, and the check count next to it
 * shows whether that cost tracks the roster size or the local crowding.
 */

import { PERF_TIMERS, perfMonitor } from '../core/PerfMonitor';
import { viewportWidth } from '../core/Viewport';
import { BYTES_PER_MEGABYTE, getFigureCacheStats } from '../sprites/figure/figureCacheStats';
import {
  environmentArtBytes,
  environmentArtSheetCount,
  environmentPaintDepth,
} from '../map/environmentArtCache';
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

function formatMs(ms: number): string {
  return `${ms.toFixed(MS_DECIMALS)} ms`;
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
      label: 'fig bake/dir',
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
  const pending = environmentPaintDepth();
  if (sheets === 0 && pending === 0) return [];
  return [
    {
      label: 'env MB/sheets',
      value: `${(environmentArtBytes() / BYTES_PER_MEGABYTE).toFixed(MEGABYTE_DECIMALS)}/${sheets}`,
      color: neutral,
    },
    {
      label: 'env owed',
      value: pending.toString(),
      color: pending > 0 ? WORLD_TEXT.value.color : neutral,
    },
  ];
}

function buildRows(): PerfRow[] {
  const fps = perfMonitor.fps;
  const neutral = WORLD_TEXT.label.color;
  const timerRows: PerfRow[] = PERF_TIMERS.map((timer) => ({
    label: timer,
    value: formatMs(perfMonitor.msPerFrame(timer)),
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
    ...timerRows,
    { label: 'mobs act/sep', value: `${activeMobs}/${separatedMobs}`, color: neutral },
    {
      label: 'sep checks',
      value: Math.round(perfMonitor.perFrame('separationChecks')).toString(),
      color: neutral,
    },
    ...figureCacheRows(neutral),
    ...environmentArtRows(neutral),
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
