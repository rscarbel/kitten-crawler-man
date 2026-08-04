/**
 * Headless review harness for the Dark Knight sprite sheet.
 *
 * Art has to be reviewed as an image, by something that only looks at the
 * image: every defect that has ever mattered on a figure in this project was
 * invisible to typecheck, to lint and to reading the drawing code. This slices
 * `src/images/enemies/dark_knight.png` into a labelled contact sheet at review
 * scale, plus a strip of the same frames blitted at the real 32 px tile — the
 * size where "detail does not rescue a wrong outline" gets caught.
 *
 *   npx tsx scripts/render-dark-knight.ts --out=knight.png --scale=2
 *   npx tsx scripts/render-dark-knight.ts --out=knight-slam.png --row=slam,slam_side --scale=4
 *   npx tsx scripts/render-dark-knight.ts --out=knight-helm.png --mode=parts --part=helm
 *   npx tsx scripts/render-dark-knight.ts --out=knight-mace.png --mode=prop
 *   npx tsx scripts/render-dark-knight.ts --out=knight-gore.png --mode=gore
 *
 * Regenerate the sheet itself with `npm run gen:dark-knight`.
 */

import { createCanvas, loadImage, type Image } from 'canvas';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The row order and frame counts come straight from the generator, so a new row
// cannot desync the only review path this art has.
import { GORE_STATES, ROWS, SHEET_PATH, TILE_SCALE, bake } from './generate-dark-knight-sprite.js';

/** Matches TILE_SIZE in src/core/constants.ts; the sheet is drawn at 2× that. */
const IN_GAME_TILE = 32;

const DEFAULT_SCALE = 2;
const MIN_SCALE = 0.25;
const MAX_SCALE = 10;
const LABEL_HEIGHT = 22;
const PADDING = 8;
const BACKDROP = '#3b3b40';
/** The floor tones the knight actually stands on, for the contrast check. */
const FLOOR_SWATCHES: ReadonlyArray<string> = ['#3b3b40', '#6b5c46', '#243021', '#8a8378'];
const GRID_LINE = 'rgba(255,255,255,0.12)';
const TILE_GUIDE = 'rgba(120,220,255,0.35)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '14px sans-serif';

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

interface Geometry {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
}

/**
 * The crops that make a review possible. A whole-figure contact sheet hides
 * exactly the defects that matter most at these sizes — a helm that reads as a
 * bucket, a pauldron that has merged with the arm under it — so each region is
 * pulled out across every frame of a row.
 *
 * Fractions of the cell rather than pixels, because the cell size is measured
 * at bake time and a pixel table here would silently rot.
 */
interface PartCrop {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const PART_CROPS: Record<string, PartCrop> = {
  helm: { x: 0.28, y: 0.14, w: 0.44, h: 0.26 },
  torso: { x: 0.16, y: 0.3, w: 0.68, h: 0.3 },
  hands: { x: 0.06, y: 0.34, w: 0.88, h: 0.3 },
  legs: { x: 0.22, y: 0.55, w: 0.56, h: 0.32 },
  feet: { x: 0.2, y: 0.74, w: 0.6, h: 0.22 },
  mace: { x: 0.45, y: 0.1, w: 0.55, h: 0.45 },
};

function backdropFor(index: number): string {
  return FLOOR_SWATCHES[index % FLOOR_SWATCHES.length];
}

function rowIndexOf(name: string): number {
  const index = ROWS.findIndex((row) => row.name === name);
  if (index < 0) throw new Error(`No row named "${name}"`);
  return index;
}

function renderPartsPanel(
  sheet: Image,
  geometry: Geometry,
  outPath: string,
  partName: string,
  scale: number,
): void {
  const crop = PART_CROPS[partName];
  if (crop === undefined) {
    throw new Error(`--part=${partName} is not one of ${Object.keys(PART_CROPS).join(', ')}`);
  }
  const cropW = geometry.frameWidth * crop.w;
  const cropH = geometry.frameHeight * crop.h;
  const cellW = cropW * scale;
  const cellH = cropH * scale;
  const maxCols = Math.max(...ROWS.map((row) => row.frameCount));

  const canvas = createCanvas(
    Math.ceil(PADDING + maxCols * (cellW + PADDING)),
    Math.ceil(PADDING + ROWS.length * (cellH + LABEL_HEIGHT + PADDING)),
  );
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;

  let y = PADDING;
  ROWS.forEach((row, index) => {
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(`${row.name} — ${partName}`, PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const x = PADDING + frame * (cellW + PADDING);
      ctx.fillStyle = backdropFor(index);
      ctx.fillRect(x, y, cellW, cellH);
      ctx.drawImage(
        sheet,
        frame * geometry.frameWidth + geometry.frameWidth * crop.x,
        index * geometry.frameHeight + geometry.frameHeight * crop.y,
        cropW,
        cropH,
        x,
        y,
        cellW,
        cellH,
      );
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
    }
    y += cellH + PADDING;
  });

  writeFileSync(resolve(outPath), canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, ${partName} crops)`);
}

/**
 * The mace alone, at the three sizes it has to survive. The exit criterion is a
 * blind naming test: shown this strip with no context, the shape has to be
 * called a mace. A distinctness gate proves shapes differ; only a naming test
 * proves they are the right shapes.
 */
const PROP_SCALES: ReadonlyArray<number> = [4, 2, IN_GAME_TILE / TILE_SCALE];

function renderPropPanel(sheet: Image, geometry: Geometry, outPath: string): void {
  const crop = PART_CROPS.mace;
  const cropW = geometry.frameWidth * crop.w;
  const cropH = geometry.frameHeight * crop.h;
  // The carry frame, plus the slam's raise and the sweep's level pass — the
  // three places the head is fully clear of the body.
  const samples: ReadonlyArray<readonly [string, number]> = [
    ['idle_side', 0],
    ['walk_side', 4],
    ['sweep_side', 13],
    ['slam_side', 15],
  ];

  const width = PADDING + samples.length * (cropW * Math.max(...PROP_SCALES) + PADDING);
  const height =
    PADDING + PROP_SCALES.reduce((total, s) => total + cropH * s + LABEL_HEIGHT + PADDING, 0);
  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;

  let y = PADDING;
  for (const scale of PROP_SCALES) {
    const cellW = cropW * scale;
    const cellH = cropH * scale;
    ctx.fillStyle = LABEL_COLOR;
    const caption =
      scale === Math.min(...PROP_SCALES) ? 'at the size it renders in game' : `${scale}×`;
    ctx.fillText(caption, PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;
    samples.forEach(([rowName, frame], index) => {
      const x = PADDING + index * (cellW + PADDING);
      ctx.drawImage(
        sheet,
        frame * geometry.frameWidth + geometry.frameWidth * crop.x,
        rowIndexOf(rowName) * geometry.frameHeight + geometry.frameHeight * crop.y,
        cropW,
        cropH,
        x,
        y,
        cellW,
        cellH,
      );
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
    });
    y += cellH + PADDING;
  }

  writeFileSync(resolve(outPath), canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, prop panel)`);
}

function renderSheetPanel(
  sheet: Image,
  geometry: Geometry,
  outPath: string,
  scale: number,
  only: string,
): void {
  const wanted = only === '' ? [] : only.split(',');
  const rows =
    wanted.length === 0
      ? ROWS.filter((row) => row.kind !== 'gore')
      : ROWS.filter((row) => wanted.includes(row.name));
  if (rows.length === 0) throw new Error(`No row named "${only}"`);

  const cellW = geometry.frameWidth * scale;
  const cellH = geometry.frameHeight * scale;
  const maxCols = Math.max(...rows.map((row) => row.frameCount));
  const inGameW = geometry.frameWidth * (IN_GAME_TILE / TILE_SCALE);
  const inGameH = geometry.frameHeight * (IN_GAME_TILE / TILE_SCALE);

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
  rows.forEach((spec, index) => {
    const sheetRow = rowIndexOf(spec.name);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(`${spec.name} — ${spec.frameCount} frames`, PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;

    for (let frame = 0; frame < spec.frameCount; frame++) {
      const x = PADDING + frame * (cellW + PADDING);
      ctx.fillStyle = backdropFor(index);
      ctx.fillRect(x, y, cellW, cellH);
      ctx.drawImage(
        sheet,
        frame * geometry.frameWidth,
        sheetRow * geometry.frameHeight,
        geometry.frameWidth,
        geometry.frameHeight,
        x,
        y,
        cellW,
        cellH,
      );
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
      ctx.strokeStyle = TILE_GUIDE;
      ctx.strokeRect(
        x + geometry.tileX * scale,
        y + geometry.tileY * scale,
        TILE_SCALE * scale,
        TILE_SCALE * scale,
      );
    }
    y += cellH + PADDING;
  });

  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(`in-game size (${IN_GAME_TILE}px tile)`, PADDING, y + LABEL_HEIGHT - PADDING);
  y += LABEL_HEIGHT;
  rows.forEach((spec, index) => {
    ctx.drawImage(
      sheet,
      0,
      rowIndexOf(spec.name) * geometry.frameHeight,
      geometry.frameWidth,
      geometry.frameHeight,
      PADDING + index * (inGameW + PADDING),
      y,
      inGameW,
      inGameH,
    );
  });

  writeFileSync(resolve(outPath), canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, scale ${scale}×)`);
}

/**
 * Draws the gore row at the three sizes that matter. The bottom strip is the
 * exit criterion: name all seven pieces from it, or the set has failed.
 */
const GORE_REVIEW_SCALES: ReadonlyArray<number> = [4, 1, IN_GAME_TILE / TILE_SCALE];

function renderGorePanel(sheet: Image, geometry: Geometry, outPath: string): void {
  const goreRow = ROWS.findIndex((row) => row.kind === 'gore');
  if (goreRow < 0) throw new Error('the generator has no gore row');
  const pieceCount = ROWS[goreRow].frameCount;

  const widths = GORE_REVIEW_SCALES.map((scale) => geometry.frameWidth * scale);
  const width = PADDING + Math.max(...widths.map((w) => pieceCount * (w + PADDING)));
  const height =
    PADDING +
    GORE_REVIEW_SCALES.reduce(
      (total, scale) => total + geometry.frameHeight * scale + LABEL_HEIGHT + PADDING,
      0,
    );

  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;

  let y = PADDING;
  for (const scale of GORE_REVIEW_SCALES) {
    const cellW = geometry.frameWidth * scale;
    const cellH = geometry.frameHeight * scale;
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(
      scale === Math.min(...GORE_REVIEW_SCALES)
        ? 'at the size it renders in game — name all seven from this row'
        : `${scale}×`,
      PADDING,
      y + LABEL_HEIGHT - PADDING,
    );
    y += LABEL_HEIGHT;
    for (let piece = 0; piece < pieceCount; piece++) {
      const x = PADDING + piece * (cellW + PADDING);
      ctx.drawImage(
        sheet,
        piece * geometry.frameWidth,
        goreRow * geometry.frameHeight,
        geometry.frameWidth,
        geometry.frameHeight,
        x,
        y,
        cellW,
        cellH,
      );
      if (scale === Math.max(...GORE_REVIEW_SCALES)) {
        ctx.fillStyle = LABEL_COLOR;
        ctx.fillText(GORE_STATES[piece] ?? '?', x, y + cellH + LABEL_HEIGHT - PADDING);
      }
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
    }
    y += cellH + PADDING;
  }

  writeFileSync(resolve(outPath), canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, gore panel)`);
}

async function main(): Promise<void> {
  const mode = parseFlag('mode', 'sheet');
  const outPath = parseFlag('out', `dark-knight-${mode}.png`);
  const sheet = await loadImage(resolve(SHEET_PATH));
  // Re-derived from the generator rather than the manifest, so the harness still
  // works on a bake whose manifest entry has not been pasted in yet.
  const geometry = bake().geometry;
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);

  if (mode === 'parts') {
    renderPartsPanel(sheet, geometry, outPath, parseFlag('part', 'helm'), scale);
    return;
  }
  if (mode === 'gore') {
    renderGorePanel(sheet, geometry, outPath);
    return;
  }
  if (mode === 'prop') {
    renderPropPanel(sheet, geometry, outPath);
    return;
  }
  renderSheetPanel(sheet, geometry, outPath, scale, parseFlag('row', ''));
}

void main();
