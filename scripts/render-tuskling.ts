/**
 * The Tuskling review harness. Art has to be judged as an image, by something
 * that only looks at the image — every defect that has ever mattered on a
 * figure in this project was invisible to `typecheck`, `lint` and a code read.
 *
 *   npx tsx scripts/render-tuskling.ts --out=tuskling-review.png --scale=2
 *   npx tsx scripts/render-tuskling.ts --row=charge_side --scale=4
 *   npx tsx scripts/render-tuskling.ts --part=head --scale=6
 *   npx tsx scripts/render-tuskling.ts --row=walk_side --mode=onion --scale=3
 *   npx tsx scripts/render-tuskling.ts --fresh    (review the bake, not the file)
 */

import { type Image, createCanvas, loadImage } from 'canvas';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

import { type BakedSheet, ROWS, SHEET_PATH, TILE_SCALE, bake } from './generate-tuskling-sprite.js';

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
const BACKDROP = '#3b3b40';
const DUNGEON_FLOOR = '#191720';
const ONION_ALPHA = 0.4;

type Mode = 'contact' | 'onion';

interface PartWindow {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Fractions of the frame rather than pixels, so the table survives the
 * generator re-deriving its own cell size.
 */
const PARTS: Record<string, PartWindow> = {
  head: { x: 0.24, y: 0.14, w: 0.52, h: 0.36 },
  tusks: { x: 0.28, y: 0.24, w: 0.44, h: 0.26 },
  torso: { x: 0.16, y: 0.34, w: 0.68, h: 0.34 },
  hands: { x: 0.06, y: 0.46, w: 0.88, h: 0.3 },
  legs: { x: 0.24, y: 0.62, w: 0.52, h: 0.3 },
  hooves: { x: 0.24, y: 0.74, w: 0.52, h: 0.22 },
};

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

async function loadSheet(fresh: BakedSheet | null): Promise<Image> {
  if (fresh !== null) return loadImage(fresh.buffer);
  return loadImage(resolve(SHEET_PATH));
}

async function main(): Promise<void> {
  const outPath = parseFlag('out', 'tuskling-review.png');
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  const mode = parseMode();
  const rowFilter = parseFlag('row', '');
  const partName = parseFlag('part', '');

  const part = partName === '' ? null : PARTS[partName];
  if (partName !== '' && part === undefined) {
    throw new Error(`--part=${partName} is not one of ${Object.keys(PARTS).join(', ')}`);
  }

  const rows = rowFilter === '' ? [...ROWS] : ROWS.filter((row) => row.name === rowFilter);
  if (rows.length === 0) {
    throw new Error(`--row=${rowFilter} is not one of ${ROWS.map((row) => row.name).join(', ')}`);
  }

  const baked = bake();
  const sheet = await loadSheet(process.argv.includes('--fresh') ? baked : null);
  const geometry = baked.geometry;
  const columns = Math.max(...ROWS.map((row) => row.frameCount));
  const frameW = Math.round(sheet.width / columns);
  const frameH = Math.round(sheet.height / ROWS.length);
  const geometryMatchesSheet = geometry.frameWidth === frameW && geometry.frameHeight === frameH;
  if (!geometryMatchesSheet) {
    console.warn(
      `${SHEET_PATH} is ${frameW}×${frameH} per cell but the current bake makes ` +
        `${geometry.frameWidth}×${geometry.frameHeight} — the tile guide is omitted. ` +
        `Pass --fresh to review the bake instead of the file.`,
    );
  }

  const srcW = part === null || part === undefined ? frameW : Math.round(part.w * frameW);
  const srcH = part === null || part === undefined ? frameH : Math.round(part.h * frameH);
  const srcOffsetX = part === null || part === undefined ? 0 : Math.round(part.x * frameW);
  const srcOffsetY = part === null || part === undefined ? 0 : Math.round(part.y * frameH);
  const cellW = srcW * scale;
  const cellH = srcH * scale;

  const maxCols = Math.max(...rows.map((row) => row.frameCount));
  const inGameScale = IN_GAME_TILE / TILE_SCALE;
  const inGameW = frameW * inGameScale;
  const inGameH = frameH * inGameScale;
  const stripWidth = PADDING + rows.length * (inGameW + PADDING);
  const width = Math.max(PADDING + maxCols * (cellW + PADDING), stripWidth);
  const height =
    PADDING + rows.length * (cellH + LABEL_HEIGHT + PADDING) + (inGameH + LABEL_HEIGHT + PADDING);

  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;

  let y = PADDING;
  for (const spec of rows) {
    const sheetRow = ROWS.findIndex((row) => row.name === spec.name);
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
      if ((part === null || part === undefined) && geometryMatchesSheet) {
        ctx.strokeStyle = TILE_GUIDE;
        ctx.strokeRect(
          x + geometry.tileX * scale,
          y + geometry.tileY * scale,
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
  ctx.fillRect(0, y, canvas.width, inGameH);
  for (let i = 0; i < rows.length; i++) {
    const sheetRow = ROWS.findIndex((row) => row.name === rows[i].name);
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

  writeFileSync(resolve(outPath), canvas.toBuffer('image/png'));
  console.log(
    `Wrote ${outPath} (${canvas.width}×${canvas.height}px, scale ${scale}×, mode ${mode})`,
  );
}

void main();
