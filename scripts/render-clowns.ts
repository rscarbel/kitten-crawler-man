/**
 * Headless review harness for the clown sprite sheets.
 *
 * The browser harness cannot drive this project (a hidden tab never clears the
 * level-intro banner and never runs `requestAnimationFrame`), so the art has to
 * be judgeable from a still. This slices each clown sheet into a labelled
 * contact sheet: every animation row at review scale, plus a strip of the same
 * frames blitted at the in-game tile size, where the silhouette is all that
 * survives.
 *
 *   npx tsx scripts/render-clowns.ts --clown=fat --out=fat-review.png --scale=2
 *
 * Regenerate the sheets with `npx tsx scripts/generate-clown-sprites.ts`.
 */

import { createCanvas, loadImage, type Image } from 'canvas';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import manifest from '../src/images/enemies/manifest.json';

// Geometry is read from the manifest rather than restated here: a harness that
// silently slices the wrong rectangles is worse than no harness at all.
const CLOWNS = {
  fat: manifest.fat_clown,
  stilt: manifest.stilt_clown,
  terror: manifest.terror_clown,
};

type ClownName = keyof typeof CLOWNS;

/** Matches TILE_SIZE in src/core/constants.ts; the sheets are drawn at 2× that. */
const IN_GAME_TILE = 32;

const DEFAULT_SCALE = 2;
const LABEL_HEIGHT = 22;
const PADDING = 8;
const BACKDROP = '#3b3b40';
const TILE_GUIDE = 'rgba(120,220,255,0.35)';
const GRID_LINE = 'rgba(255,255,255,0.12)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '14px sans-serif';

interface SheetGeometry {
  readonly path: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
  readonly tileScale: number;
  readonly states: Readonly<Record<string, { readonly row: number; readonly frameCount: number }>>;
}

interface RowSpec {
  readonly name: string;
  readonly row: number;
  readonly frameCount: number;
}

function rowsOf(sheet: SheetGeometry): readonly RowSpec[] {
  return Object.entries(sheet.states)
    .map(([name, state]) => ({ name, row: state.row, frameCount: state.frameCount }))
    .sort((a, b) => a.row - b.row);
}

function parseFlag(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match === undefined ? fallback : match.slice(prefix.length);
}

function isClownName(value: string): value is ClownName {
  return value in CLOWNS;
}

function drawContactSheet(sheet: SheetGeometry, image: Image, scale: number): Buffer {
  const rows = rowsOf(sheet);
  const cellW = sheet.frameWidth * scale;
  const cellH = sheet.frameHeight * scale;
  const maxCols = Math.max(...rows.map((row) => row.frameCount));
  const inGameScale = IN_GAME_TILE / sheet.tileScale;
  const inGameW = sheet.frameWidth * inGameScale;
  const inGameH = sheet.frameHeight * inGameScale;

  const width = PADDING + maxCols * (cellW + PADDING);
  const height =
    PADDING + rows.length * (cellH + LABEL_HEIGHT + PADDING) + (inGameH + LABEL_HEIGHT + PADDING);

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, width, height);
  ctx.font = LABEL_FONT;

  let y = PADDING;
  for (const spec of rows) {
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(`${spec.name} — ${spec.frameCount} frames`, PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;

    for (let col = 0; col < spec.frameCount; col++) {
      const x = PADDING + col * (cellW + PADDING);
      ctx.drawImage(
        image,
        col * sheet.frameWidth,
        spec.row * sheet.frameHeight,
        sheet.frameWidth,
        sheet.frameHeight,
        x,
        y,
        cellW,
        cellH,
      );
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
      // The tile box shows where the mob's collision tile sits inside the frame,
      // so overhang and foot placement can be judged against it.
      ctx.strokeStyle = TILE_GUIDE;
      ctx.strokeRect(
        x + sheet.tileX * scale,
        y + sheet.tileY * scale,
        sheet.tileScale * scale,
        sheet.tileScale * scale,
      );
    }
    y += cellH + PADDING;
  }

  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(`in-game size (${IN_GAME_TILE}px tile)`, PADDING, y + LABEL_HEIGHT - PADDING);
  y += LABEL_HEIGHT;
  rows.forEach((spec, i) => {
    const x = PADDING + i * (inGameW + PADDING);
    ctx.drawImage(
      image,
      0,
      spec.row * sheet.frameHeight,
      sheet.frameWidth,
      sheet.frameHeight,
      x,
      y,
      inGameW,
      inGameH,
    );
  });

  return canvas.toBuffer('image/png');
}

async function main(): Promise<void> {
  const requested = parseFlag('clown', 'fat');
  if (!isClownName(requested)) {
    throw new Error(
      `Unknown clown "${requested}" — expected one of ${Object.keys(CLOWNS).join(', ')}`,
    );
  }
  const sheet: SheetGeometry = CLOWNS[requested];
  const outPath = parseFlag('out', `${requested}-clown-review.png`);
  const scale = Number(parseFlag('scale', String(DEFAULT_SCALE)));
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error(`--scale must be a positive number, got "${parseFlag('scale', '')}"`);
  }
  const image = await loadImage(resolve(`src/images/${sheet.path}`));

  writeFileSync(resolve(outPath), drawContactSheet(sheet, image, scale));
  console.log(`Wrote ${outPath} (${requested}, scale ${scale}×)`);
}

void main();
