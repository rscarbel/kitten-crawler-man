#!/usr/bin/env tsx
/**
 * Headless review harness for the Bugaboo's sprite sheet.
 *
 * The art has to be judgeable from a still, and — more than for any other
 * figure in this game — from a still at the size it actually renders: the
 * creature is near-black on a near-black floor, so a silhouette that reads
 * beautifully at 4× can dissolve completely at 32px. Every mode here exists to
 * catch something a contact sheet alone hides.
 *
 * The art gates run first, before the contact sheet is allocated, so one
 * command answers both "does it still hold together" and "what does it look
 * like".
 *
 *   npm run render:bugaboo
 *   npx tsx scripts/render-bugaboo.ts --row=breach --scale=4
 *   npx tsx scripts/render-bugaboo.ts --part=head --scale=6
 *   npx tsx scripts/render-bugaboo.ts --row=walk_side --mode=onion --scale=3
 */

import { createCanvas } from 'canvas';

// The row order and frame counts come straight from the choreography, so a new
// row cannot desync the only review path this art has.
import { BUGABOO_FIGURE, BUGABOO_ROWS, TILE_SCALE } from '../src/sprites/art/bugabooFigure.js';
import { bakeFigureSheet } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { bugabooGateFailures } from './gates-bugaboo.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';

interface PartWindow {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Windows onto one part of the creature, as fractions of the frame so they
 * survive the generator re-deriving its own cell size. A whole-figure contact
 * sheet hides exactly the defects that matter most at these sizes, and on this
 * creature the face and the hands are where every review has found the most.
 */
const PARTS: Record<string, PartWindow> = {
  head: { x: 0.28, y: 0.24, w: 0.44, h: 0.3 },
  mass: { x: 0.2, y: 0.28, w: 0.6, h: 0.36 },
  hands: { x: 0.06, y: 0.42, w: 0.88, h: 0.34 },
  legs: { x: 0.3, y: 0.58, w: 0.4, h: 0.34 },
  floor: { x: 0.15, y: 0.55, w: 0.7, h: 0.42 },
};

/** Matches TILE_SIZE in src/core/constants.ts; the sheet is drawn at 2× that. */
const IN_GAME_TILE = 32;

const DEFAULT_SCALE = 1.5;
const MIN_SCALE = 0.25;
const MAX_SCALE = 8;
const LABEL_HEIGHT = 22;
const PADDING = 8;
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '14px sans-serif';
const GRID_LINE = 'rgba(255,255,255,0.12)';
const TILE_GUIDE = 'rgba(120,220,255,0.35)';
/**
 * Two backdrops, and both are load-bearing. An obsidian creature judged on grey
 * looks fine and then vanishes on the dungeon floor it actually stands on, so
 * the in-game strip is drawn on the floor's own colour.
 */
const BACKDROP = '#3b3b40';
const DUNGEON_FLOOR = '#191720';

/** Consecutive frames overlaid, so a snap or a pop shows as a doubled edge. */
const ONION_ALPHA = 0.4;

type Mode = 'contact' | 'onion';

function parseFlag(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match === undefined ? fallback : match.slice(prefix.length);
}

/** A bad number here silently produces a blank or NaN-sized contact sheet. */
function parseNumberFlag(name: string, fallback: number, min: number, max: number): number {
  const raw = parseFlag(name, String(fallback));
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`--${name}=${raw} is not a number in [${min}, ${max}]`);
  }
  return value;
}

function parseMode(): Mode {
  const raw = parseFlag('mode', 'contact');
  if (raw === 'contact' || raw === 'onion') return raw;
  throw new Error(`--mode=${raw} is not one of contact, onion`);
}

function main(): void {
  // Ahead of the contact sheet rather than after it: a sheet is a
  // tens-of-megapixel allocation, and measuring art on the far side of one is
  // how a gate goes red on art nobody touched.
  console.log('Gating the bugaboo…');
  reportFigureGates('bugaboo', bugabooGateFailures());

  const outPath = parseFlag('out', `${PREVIEW_DIR}/bugaboo-review.png`);
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  const only = parseFlag('row', '');
  const mode = parseMode();
  const sheet = bakeFigureSheet(BUGABOO_FIGURE).canvas;

  const frameW = BUGABOO_FIGURE.frameWidth;
  const frameH = BUGABOO_FIGURE.frameHeight;

  const rows = only === '' ? BUGABOO_ROWS : BUGABOO_ROWS.filter((row) => row.name === only);
  if (rows.length === 0) throw new Error(`No row named "${only}"`);

  const partName = parseFlag('part', '');
  const part = PARTS[partName] ?? null;
  if (partName !== '' && part === null) {
    throw new Error(`--part=${partName} is not one of ${Object.keys(PARTS).join(', ')}`);
  }
  const srcW = part === null ? frameW : Math.round(part.w * frameW);
  const srcH = part === null ? frameH : Math.round(part.h * frameH);
  const srcOffsetX = part === null ? 0 : Math.round(part.x * frameW);
  const srcOffsetY = part === null ? 0 : Math.round(part.y * frameH);
  const cellW = srcW * scale;
  const cellH = srcH * scale;
  const maxCols = Math.max(...rows.map((row) => row.frameCount));
  // The whole point of this strip is the art at the size it renders, so the
  // cell keeps the frame's own aspect: squared off, the one view meant to be
  // trusted is the one showing the creature squashed.
  const inGameScale = IN_GAME_TILE / TILE_SCALE;
  const inGameW = frameW * inGameScale;
  const inGameH = frameH * inGameScale;

  const stripWidth = PADDING + rows.length * (inGameW + PADDING);
  const width = Math.max(PADDING + maxCols * (cellW + PADDING), stripWidth);
  const height =
    PADDING + rows.length * (cellH + LABEL_HEIGHT + PADDING) + (inGameH + LABEL_HEIGHT + PADDING);

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, width, height);
  ctx.font = LABEL_FONT;

  let y = PADDING;
  for (const spec of rows) {
    const sheetRow = BUGABOO_ROWS.findIndex((row) => row.name === spec.name);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(
      `${spec.name} — ${spec.frameCount} frames, ${spec.view}, ${spec.kind}`,
      PADDING,
      y + LABEL_HEIGHT - PADDING,
    );
    y += LABEL_HEIGHT;

    for (let col = 0; col < spec.frameCount; col++) {
      const x = PADDING + col * (cellW + PADDING);
      const blit = (frame: number, alpha: number): void => {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.drawImage(
          sheet,
          frame * frameW + srcOffsetX,
          sheetRow * frameH + srcOffsetY,
          srcW,
          srcH,
          x,
          y,
          cellW,
          cellH,
        );
        ctx.restore();
      };
      if (mode === 'onion') blit((col + spec.frameCount - 1) % spec.frameCount, ONION_ALPHA);
      blit(col, 1);
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
      if (part === null) {
        ctx.strokeStyle = TILE_GUIDE;
        ctx.strokeRect(
          x + BUGABOO_FIGURE.tileX * scale,
          y + BUGABOO_FIGURE.tileY * scale,
          TILE_SCALE * scale,
          TILE_SCALE * scale,
        );
      }
    }
    y += cellH + PADDING;
  }

  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(
    'in-game size (32px tile), on the dungeon floor',
    PADDING,
    y + LABEL_HEIGHT - PADDING,
  );
  y += LABEL_HEIGHT;
  ctx.fillStyle = DUNGEON_FLOOR;
  ctx.fillRect(0, y, width, inGameH);
  for (let i = 0; i < rows.length; i++) {
    const sheetRow = BUGABOO_ROWS.findIndex((row) => row.name === rows[i].name);
    ctx.drawImage(
      sheet,
      0,
      sheetRow * frameH,
      frameW,
      frameH,
      PADDING + i * (inGameW + PADDING),
      y,
      inGameW,
      inGameH,
    );
  }

  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${width}×${height}px, scale ${scale}×, mode ${mode})`);
}

main();
