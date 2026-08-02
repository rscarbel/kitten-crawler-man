#!/usr/bin/env tsx
/**
 * Headless review harness for the Rat Kin sheet.
 *
 * Art has to be reviewed as an image, by something that only looks at the image:
 * every defect that has ever mattered on a figure in this project was invisible
 * to typecheck, lint and a read of the drawing code, and visible within seconds
 * in a render. This slices the baked sheet into a labelled contact sheet, plus a
 * strip of the same frames blitted at the real tile size so the silhouette is
 * judged at the size players actually see.
 *
 *   npx tsx scripts/render-rat-kin.ts --out=review.png --scale=3
 *   npx tsx scripts/render-rat-kin.ts --out=head.png --part=head --scale=6
 *   npx tsx scripts/render-rat-kin.ts --out=onion.png --mode=onion --row=walk
 *
 * Regenerate the sheet itself with `npm run gen:rat-kin`.
 */

import { createCanvas, loadImage, type Image } from 'canvas';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The row order and frame counts come straight from the generator, so a new row
// cannot desync the only review path this art has.
import { TILE_SIZE } from '../src/core/constants.js';
import {
  GROUND_OFFSET_IN_TILE,
  ROWS,
  TILE_SCALE,
  bake,
  type SheetGeometry,
} from './generate-rat-kin-sprite.js';

/**
 * Windows onto one body part, as fractions of the frame, so a reviewer can judge
 * the muzzle or the hocks at a scale where they are actually visible. A
 * whole-figure contact sheet hides exactly the defects that matter most at these
 * sizes — fractions rather than pixels because the bake measures its own frame.
 */
interface PartWindow {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const PARTS: Record<string, PartWindow> = {
  head: { x: 0.42, y: 0.06, w: 0.5, h: 0.3 },
  torso: { x: 0.28, y: 0.24, w: 0.55, h: 0.34 },
  hands: { x: 0.4, y: 0.38, w: 0.5, h: 0.28 },
  legs: { x: 0.24, y: 0.5, w: 0.55, h: 0.42 },
  feet: { x: 0.24, y: 0.72, w: 0.6, h: 0.26 },
  tail: { x: 0.0, y: 0.3, w: 0.55, h: 0.65 },
};

/** The real tile size, imported rather than retyped so it cannot drift. */
const IN_GAME_TILE = TILE_SIZE;

type Mode = 'contact' | 'onion' | 'delta';

const DEFAULT_SCALE = 2;
const MIN_SCALE = 0.25;
const MAX_SCALE = 10;
const LABEL_HEIGHT = 22;
const PADDING = 8;
const BACKDROP = '#3b3b40';
const GRID_LINE = 'rgba(255,255,255,0.12)';
const TILE_GUIDE = 'rgba(120,220,255,0.35)';
const GROUND_GUIDE = 'rgba(255,200,120,0.4)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '14px sans-serif';
/** Alpha each frame of an onion-skin stack is laid down at. */
const ONION_ALPHA = 0.34;

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
  if (raw === 'contact' || raw === 'onion' || raw === 'delta') return raw;
  throw new Error(`--mode=${raw} is not one of contact, onion, delta`);
}

/**
 * Bakes into memory rather than reading the PNG off disk, so the harness reviews
 * what the current source produces even when the gates refused to write it —
 * which is exactly the moment a picture is most useful. It also means the tile
 * guide is drawn from the geometry the bake measured rather than from a guess.
 */
async function loadSheet(): Promise<{ image: Image; geometry: SheetGeometry }> {
  const sheet = bake();
  return { image: await loadImage(sheet.buffer), geometry: sheet.geometry };
}

async function main(): Promise<void> {
  const outPath = parseFlag('out', 'rat-kin-review.png');
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  const only = parseFlag('row', '');
  const mode = parseMode();
  const { image, geometry } = await loadSheet();
  const { frameWidth, frameHeight, tileX, tileY } = geometry;

  const rows = only === '' ? ROWS : ROWS.filter((row) => row.name === only);
  if (rows.length === 0) throw new Error(`No row named "${only}"`);

  // Checked before the lookup, not after: with `noUncheckedIndexedAccess` off the
  // indexed read is typed as always present, so an `=== undefined` guard on the
  // result is statically dead and `--part=typo` silently renders whole frames.
  const partName = parseFlag('part', '');
  if (partName !== '' && !(partName in PARTS)) {
    throw new Error(`--part=${partName} is not one of ${Object.keys(PARTS).join(', ')}`);
  }
  const part = partName === '' ? null : PARTS[partName];
  const srcOffsetX = part === null ? 0 : Math.round(part.x * frameWidth);
  const srcOffsetY = part === null ? 0 : Math.round(part.y * frameHeight);
  const srcW = part === null ? frameWidth : Math.round(part.w * frameWidth);
  const srcH = part === null ? frameHeight : Math.round(part.h * frameHeight);

  // Onion and delta stack a whole row into one cell, so they show one cell a row.
  const stacked = mode !== 'contact';
  const cellsPerRow = (row: (typeof ROWS)[number]): number => (stacked ? 1 : row.frameCount);
  const cell = srcW * scale;
  const cellH = srcH * scale;
  const maxCols = Math.max(...rows.map(cellsPerRow));
  const inGameScale = IN_GAME_TILE / TILE_SCALE;
  const inGameFrame = frameWidth * inGameScale;
  // A height, not the width. The strip is as tall as the frame is, and reserving
  // its width instead only fits while the two happen to be within one padding of
  // each other — one quantum of extra frame height crops his feet off the very
  // strip whose whole job is judging the silhouette.
  const inGameHeight = frameHeight * inGameScale;

  const stripWidth = PADDING + rows.length * (inGameFrame + PADDING);
  const width = Math.max(PADDING + maxCols * (cell + PADDING), stripWidth);
  const height =
    PADDING +
    rows.length * (cellH + LABEL_HEIGHT + PADDING) +
    (inGameHeight + LABEL_HEIGHT + PADDING);

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, width, height);
  ctx.font = LABEL_FONT;

  let y = PADDING;
  for (const spec of rows) {
    const sheetRow = ROWS.findIndex((row) => row.name === spec.name);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(
      `${spec.name} — ${spec.frameCount} frames, ${mode}`,
      PADDING,
      y + LABEL_HEIGHT - PADDING,
    );
    y += LABEL_HEIGHT;

    const drawFrame = (frame: number, x: number): void => {
      ctx.drawImage(
        image,
        frame * frameWidth + srcOffsetX,
        sheetRow * frameHeight + srcOffsetY,
        srcW,
        srcH,
        x,
        y,
        cell,
        cellH,
      );
    };

    if (stacked) {
      ctx.save();
      // Difference mode locates *where* a continuity gate fired; onion skin shows
      // a snap or a pop as a doubled edge.
      if (mode === 'delta') ctx.globalCompositeOperation = 'difference';
      else ctx.globalAlpha = ONION_ALPHA;
      for (let frame = 0; frame < spec.frameCount; frame++) drawFrame(frame, PADDING);
      ctx.restore();
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(PADDING, y, cell, cellH);
    } else {
      for (let frame = 0; frame < spec.frameCount; frame++) {
        const x = PADDING + frame * (cell + PADDING);
        drawFrame(frame, x);
        ctx.strokeStyle = GRID_LINE;
        ctx.strokeRect(x, y, cell, cellH);
        if (part === null) {
          // The tile the manifest claims he stands on, and the ground line his
          // soles are supposed to meet — the two things an anchor bug moves.
          ctx.strokeStyle = TILE_GUIDE;
          ctx.strokeRect(
            x + tileX * scale,
            y + tileY * scale,
            TILE_SCALE * scale,
            TILE_SCALE * scale,
          );
          const groundY = y + (tileY + TILE_SCALE * GROUND_OFFSET_IN_TILE) * scale;
          ctx.strokeStyle = GROUND_GUIDE;
          ctx.beginPath();
          ctx.moveTo(x, groundY);
          ctx.lineTo(x + cell, groundY);
          ctx.stroke();
        }
      }
    }
    y += cellH + PADDING;
  }

  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(`in-game size (${IN_GAME_TILE}px tile)`, PADDING, y + LABEL_HEIGHT - PADDING);
  y += LABEL_HEIGHT;
  rows.forEach((spec, index) => {
    const sheetRow = ROWS.findIndex((row) => row.name === spec.name);
    ctx.drawImage(
      image,
      0,
      sheetRow * frameHeight,
      frameWidth,
      frameHeight,
      PADDING + index * (inGameFrame + PADDING),
      y,
      inGameFrame,
      inGameHeight,
    );
  });

  writeFileSync(resolve(outPath), canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${width}×${height}px, scale ${scale}×)`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
