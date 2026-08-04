/**
 * On-screen readout for `perfMonitor`, reached via `?perf` in `devBootScene`.
 *
 * Lives here rather than beside the monitor so a release build has no import
 * edge to it at all — see the module comment on `devBoot.ts`. It exists because
 * spawn-density tuning otherwise has no number to argue with: the separation
 * row shows the pass the spatial-partitioning plan rewrote, and the check count
 * next to it shows whether that work is tracking the roster size or the local
 * crowding.
 */

import { PERF_TIMERS, perfMonitor } from '../core/PerfMonitor';
import { viewportWidth } from '../core/Viewport';
import { drawBox, BOX_PRESETS } from '../ui/Box';
import { drawText, TEXT_PRESETS } from '../ui/TextBox';

const PANEL_WIDTH = 190;
const PANEL_MARGIN = 8;
const PANEL_PADDING = 8;
const PANEL_RADIUS = 4;
const ROW_HEIGHT = 14;
const VALUE_COLUMN_OFFSET = 96;

/** Tenths of a millisecond is too coarse for a pass that costs well under one. */
const MS_DECIMALS = 2;
const FPS_DECIMALS = 1;

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

function buildRows(): PerfRow[] {
  const fps = perfMonitor.fps;
  const neutral = TEXT_PRESETS.label.color;
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
      color: fps < FPS_WARNING_THRESHOLD ? TEXT_PRESETS.danger.color : TEXT_PRESETS.value.color,
    },
    ...timerRows,
    { label: 'mobs act/sep', value: `${activeMobs}/${separatedMobs}`, color: neutral },
    {
      label: 'sep checks',
      value: Math.round(perfMonitor.perFrame('separationChecks')).toString(),
      color: neutral,
    },
  ];
}

export function drawPerfOverlay(ctx: CanvasRenderingContext2D): void {
  if (!perfMonitor.enabled) return;

  const rows = buildRows();
  const { inner } = drawBox(ctx, {
    x: viewportWidth() - PANEL_WIDTH - PANEL_MARGIN,
    y: PANEL_MARGIN,
    width: PANEL_WIDTH,
    height: rows.length * ROW_HEIGHT + PANEL_PADDING * 2,
    radius: PANEL_RADIUS,
    padding: PANEL_PADDING,
    ...BOX_PRESETS.panel,
  });

  rows.forEach((row, index) => {
    const y = inner.y + index * ROW_HEIGHT;
    drawText(ctx, row.label, { x: inner.x, y, ...TEXT_PRESETS.hint });
    drawText(ctx, row.value, {
      x: inner.x + VALUE_COLUMN_OFFSET,
      y,
      ...TEXT_PRESETS.hint,
      color: row.color,
    });
  });
}
