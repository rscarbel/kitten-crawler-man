/**
 * Art gates for the thrall, the ghostly ratkin laborer a crawler summons to
 * gather for them. Run with the ratkin cast's gates (`npm run render:ratkin-cast`),
 * since the thrall is painted on the cast's rig and cell.
 *
 *   H1  structure: nothing clipped, nothing blank, in either thrall figure
 *   H2  every row the runtime can draw a thrall in is painted by both figures,
 *       and every painted row is one the runtime can reach
 *   H3  memory: each thrall figure fully warm fits its per-figure ceiling
 *
 *   npx tsx scripts/gates-thrall.ts
 */

import {
  figureStructuralFailures,
  missingStateFailures,
  nothingMeasuredFailures,
} from './figureGates.js';
import { thrallFigure } from '../src/sprites/art/thrallFigure.js';
import { THRALL_STATES } from '../src/sprites/thrallSprite.js';
import { FIGURE_BYTE_BUDGET } from '../src/sprites/figure/figureFrameCache.js';
import type { ToolKind } from '../src/core/toolTiers.js';

const TOOLS: readonly ToolKind[] = ['axe', 'pickaxe'];
const BYTES_PER_PIXEL = 4;
const BYTES_PER_MEGABYTE = 1024 * 1024;
const MEGABYTE_DECIMALS = 1;
/**
 * The thrall stands in the cast's cell, sized for a spear held overhead; its
 * pole tool fills less of it than a spear does, so the floor is the cast's own.
 */
const THRALL_MIN_INK_AREA_SHARE = 0.08;

/** Every thrall gate's failures, one message each. */
export function thrallGateFailures(): string[] {
  const failures: string[] = [];
  const reachable: readonly string[] = THRALL_STATES;
  let statesMeasured = 0;
  for (const tool of TOOLS) {
    const figure = thrallFigure(tool);
    for (const failure of figureStructuralFailures(figure, {
      minInkAreaShare: THRALL_MIN_INK_AREA_SHARE,
    })) {
      failures.push(`H1: ${failure}`);
    }
    for (const failure of missingStateFailures(figure, reachable, 'the thrall sprite')) {
      failures.push(`H2: ${failure}`);
    }
    let allBytes = 0;
    const cellBytes = figure.frameWidth * figure.frameHeight * BYTES_PER_PIXEL;
    for (const [state, declared] of figure.states) {
      statesMeasured++;
      allBytes += declared.frames * cellBytes;
      if (!reachable.includes(state)) {
        failures.push(`H2: ${figure.id} paints "${state}", which a thrall is never drawn in`);
      }
    }
    if (allBytes > FIGURE_BYTE_BUDGET) {
      const megabytes = (allBytes / BYTES_PER_MEGABYTE).toFixed(MEGABYTE_DECIMALS);
      failures.push(`H3: ${figure.id} fully warm is ${megabytes} MB, over its per-figure ceiling`);
    }
  }
  for (const failure of nothingMeasuredFailures(statesMeasured, 'thrall states')) {
    failures.push(`H2: ${failure}`);
  }
  return failures;
}

const invokedDirectly = process.argv[1]?.endsWith('gates-thrall.ts') ?? false;
if (invokedDirectly) {
  const found = thrallGateFailures();
  for (const failure of found) console.error(`  FAIL ${failure}`);
  if (found.length > 0) process.exitCode = 1;
  else console.log('  ok   thrall gates');
}
