#!/usr/bin/env tsx
/**
 * Review gallery for the dungeon's breakable props: every sheet's every row,
 * on a floor-1 and a floor-2 swatch, at in-game size and enlarged, with Carl at
 * the head of each row for scale.
 *
 *   Run: npx tsx scripts/render-breakable-props.ts [--out=<dir>] [--zoom=<n>]
 *
 * Writes one PNG per family (cellars, service level, remains) at in-game size
 * (`-1x.png`) and enlarged (`-<zoom>x.png`). Painted from the same plans the
 * game paints, so the picture is the shipped art.
 */

import { createCanvas, type Canvas } from 'canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadGameSpritesInNode } from './nodeCanvasGlobals.js';
import { bakePropSheet } from './propSheetBake.js';
import { bakeFigureCell } from './figureSheet.js';
import { destructiblePropSheetPlans } from '../src/sprites/sheets/destructiblePropSheets.js';
import { floorTwoPropVariantSheetPlans } from '../src/sprites/sheets/propVariantSheets.js';
import { remainsSheetPlans } from '../src/sprites/sheets/remainsSheets.js';
import { HUMAN_FIGURE } from '../src/sprites/art/humanFigure.js';
import type { PropSheetPlan } from '../src/sprites/sheets/propSheetPlan.js';

/** Matches TILE_SIZE in src/core/constants.ts. */
const IN_GAME_TILE = 32;
const DEFAULT_ZOOM = 3;
const PADDING = 6;
/** A flagstone mid-value and a concrete mid-value: what the props stand on, floor by floor. */
const FLOOR_SWATCHES = ['#4b4339', '#4c5153'] as const;
const BACKDROP = '#202024';

function flag(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

await loadGameSpritesInNode();

const outDir = resolve(flag('out', 'preview/props/breakable-gallery'));
const zoom = Number.parseInt(flag('zoom', String(DEFAULT_ZOOM)), 10);
mkdirSync(outDir, { recursive: true });

const carl = bakeFigureCell(HUMAN_FIGURE, 'idle', 0);
const carlScale = IN_GAME_TILE / HUMAN_FIGURE.tileScale;

interface Row {
  readonly sheet: Canvas;
  readonly plan: PropSheetPlan;
  readonly rowIndex: number;
  readonly frames: number;
}

function rowsOf(plans: ReadonlyArray<PropSheetPlan>): Row[] {
  return plans.flatMap((plan) => {
    const sheet = bakePropSheet(plan).canvas;
    return plan.rows.map((row, rowIndex) => ({
      sheet,
      plan,
      rowIndex,
      frames: row.frames.length,
    }));
  });
}

function render(name: string, plans: ReadonlyArray<PropSheetPlan>, scale: number): void {
  const rows = rowsOf(plans);
  const cellScale = (plan: PropSheetPlan) => (IN_GAME_TILE / plan.tileScale) * scale;
  const carlW = HUMAN_FIGURE.frameWidth * carlScale * scale;
  const carlH = HUMAN_FIGURE.frameHeight * carlScale * scale;
  const rowHeight = (row: Row) => Math.max(row.plan.frameHeight * cellScale(row.plan), carlH);
  const rowWidth = (row: Row) => carlW + row.frames * row.plan.frameWidth * cellScale(row.plan);
  const blockWidth = Math.max(...rows.map(rowWidth)) + PADDING * 2;
  const height = rows.reduce((sum, row) => sum + rowHeight(row) + PADDING, PADDING);
  const canvas = createCanvas(blockWidth * FLOOR_SWATCHES.length, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = scale <= 1;

  FLOOR_SWATCHES.forEach((swatch, swatchIndex) => {
    const left = swatchIndex * blockWidth;
    ctx.fillStyle = swatch;
    ctx.fillRect(left + PADDING / 2, 0, blockWidth - PADDING, height);
    let y = PADDING;
    for (const row of rows) {
      const s = cellScale(row.plan);
      const h = rowHeight(row);
      const groundY = y + h - (row.plan.frameHeight - row.plan.tileY - row.plan.tileScale) * s;
      const carlGround = (HUMAN_FIGURE.tileY + HUMAN_FIGURE.tileScale) * carlScale * scale;
      ctx.drawImage(carl, left + PADDING, groundY - carlGround, carlW, carlH);
      for (let frame = 0; frame < row.frames; frame++) {
        ctx.drawImage(
          row.sheet,
          frame * row.plan.frameWidth,
          row.rowIndex * row.plan.frameHeight,
          row.plan.frameWidth,
          row.plan.frameHeight,
          left + PADDING + carlW + frame * row.plan.frameWidth * s,
          groundY - (row.plan.tileY + row.plan.tileScale) * s,
          row.plan.frameWidth * s,
          row.plan.frameHeight * s,
        );
      }
      y += h + PADDING;
    }
  });
  const path = join(outDir, `${name}-${scale}x.png`);
  writeFileSync(path, canvas.toBuffer('image/png'));
  console.log(`wrote ${path}`);
}

const families: ReadonlyArray<readonly [string, PropSheetPlan[]]> = [
  ['cellars', destructiblePropSheetPlans(0)],
  ['service-level', floorTwoPropVariantSheetPlans()],
  ['remains', remainsSheetPlans()],
];
for (const [name, plans] of families) {
  render(name, plans, 1);
  render(name, plans, zoom);
}
