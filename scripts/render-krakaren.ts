#!/usr/bin/env tsx
/**
 * Review harness for the three Krakaren figures (body, guard tentacle, slam
 * tentacle), and the command that runs their art gates.
 *
 * Art has to be judged as an image, by something that only looks at the image —
 * every defect that has ever mattered on a figure in this project was invisible
 * to `typecheck`, `lint` and a code read. Every cell here is painted and
 * downsampled exactly as the runtime cache admits it.
 *
 *   npx tsx scripts/render-krakaren.ts --out=krakaren-body.png --sheet=body --scale=1.5
 *   npx tsx scripts/render-krakaren.ts --sheet=body --row=swipe_side --scale=4
 *   npx tsx scripts/render-krakaren.ts --sheet=body --mode=parts --row=idle --frame=0 --scale=6
 *   npx tsx scripts/render-krakaren.ts --sheet=body --mode=gore --scale=5
 *   npx tsx scripts/render-krakaren.ts --sheet=slam --row=loom --mode=onion --scale=3
 *   npx tsx scripts/render-krakaren.ts --sheet=body --row=swipe --mode=delta --scale=3
 *   npx tsx scripts/render-krakaren.ts --mode=composite --scale=3
 */

import { type Canvas, type CanvasRenderingContext2D as Ctx, createCanvas } from 'canvas';

import {
  BODY_ROWS,
  GROUND_OFFSET_PX,
  GUARD_ROWS,
  KRAKAREN_FIGURE,
  KRAKAREN_GORE_STATES,
  KRAKAREN_SLAM_FIGURE,
  KRAKAREN_TENTACLE_FIGURE,
  KRAKAREN_TENTACLE_GORE_STATES,
  type RowSpec,
  SLAM_ROWS,
  TILE_SCALE,
} from '../src/sprites/art/krakarenFigure.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import { bakeFigureSheet } from './figureSheet.js';
import { runKrakarenGates } from './gates-krakaren.js';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import {
  KRAKAREN_LAIR_STONE_DARK,
  KRAKAREN_LAIR_STONE_LIGHT,
} from '../src/map/tiles/specialFloorTiles.js';

// A painter that composes on a scratch surface of its own reaches for
// `document.createElement('canvas')`, which a Node process does not have.
installCanvasGlobals();

/** Matches TILE_SIZE in src/core/constants.ts; the sheets are drawn at 2× that. */
const IN_GAME_TILE = 32;
const DEFAULT_SCALE = 1.5;
const MIN_SCALE = 0.25;
const MAX_SCALE = 10;
const LABEL_HEIGHT = 22;
const PADDING = 8;
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '14px sans-serif';
const GRID_LINE = 'rgba(255,255,255,0.12)';
const TILE_GUIDE = 'rgba(120,220,255,0.35)';
const BACKDROP = '#2a1f28';
const ONION_ALPHA = 0.4;
const PARTS_ZOOM = 2.2;

type SheetKey = 'body' | 'tentacle' | 'slam';
type Mode = 'sheet' | 'parts' | 'gore' | 'onion' | 'delta' | 'composite';

/**
 * A row as the contact sheet lays it out.
 *
 * The severed pieces are single-frame states of the figure rather than columns
 * of one shared row, so each gets a display row of its own and the `gore` kind
 * is what groups them back together for `--mode=gore`.
 */
interface DisplayRow {
  readonly name: string;
  readonly frameCount: number;
  readonly kind: RowSpec['kind'] | 'gore';
  readonly view: RowSpec['view'] | null;
}

/** One figure plus the display rows it is reviewed through. */
interface FigureSpec {
  readonly def: FigureDef;
  readonly rows: readonly DisplayRow[];
  readonly goreStates: readonly string[];
}

function figureSpecOf(
  def: FigureDef,
  poseRows: readonly RowSpec[],
  goreStates: readonly string[],
): FigureSpec {
  const rows: DisplayRow[] = poseRows.map((row) => ({
    name: row.name,
    frameCount: row.frameCount,
    kind: row.kind,
    view: row.view,
  }));
  for (const state of goreStates) {
    rows.push({ name: state, frameCount: 1, kind: 'gore', view: null });
  }
  return { def, rows, goreStates };
}

const SHEET_BY_KEY: Record<SheetKey, FigureSpec> = {
  body: figureSpecOf(KRAKAREN_FIGURE, BODY_ROWS, KRAKAREN_GORE_STATES),
  tentacle: figureSpecOf(KRAKAREN_TENTACLE_FIGURE, GUARD_ROWS, KRAKAREN_TENTACLE_GORE_STATES),
  slam: figureSpecOf(KRAKAREN_SLAM_FIGURE, SLAM_ROWS, []),
};

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
const BODY_PARTS: Record<string, PartWindow> = {
  mantle: { x: 0.14, y: 0.02, w: 0.72, h: 0.42 },
  eyes: { x: 0.26, y: 0.06, w: 0.48, h: 0.16 },
  beak: { x: 0.38, y: 0.22, w: 0.24, h: 0.16 },
  tentacle_ring: { x: 0.04, y: 0.36, w: 0.92, h: 0.5 },
  mouth_cluster: { x: 0.1, y: 0.3, w: 0.8, h: 0.42 },
};

const GUARD_PARTS: Record<string, PartWindow> = {
  tip: { x: 0.2, y: 0.0, w: 0.6, h: 0.3 },
  mid: { x: 0.14, y: 0.24, w: 0.72, h: 0.4 },
  root: { x: 0.08, y: 0.56, w: 0.84, h: 0.42 },
};

const SLAM_PARTS: Record<string, PartWindow> = {
  tip: { x: 0.18, y: 0.0, w: 0.64, h: 0.3 },
  midsection: { x: 0.12, y: 0.2, w: 0.76, h: 0.5 },
  base: { x: 0.1, y: 0.55, w: 0.8, h: 0.42 },
};

const PARTS_BY_KEY: Record<SheetKey, Record<string, PartWindow>> = {
  body: BODY_PARTS,
  tentacle: GUARD_PARTS,
  slam: SLAM_PARTS,
};

function parseFlag(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match === undefined ? fallback : match.slice(prefix.length);
}

/** A bad number here silently produces a blank or NaN-sized canvas. */
function parseNumberFlag(name: string, fallback: number, min: number, max: number): number {
  const raw = parseFlag(name, String(fallback));
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`--${name}=${raw} is not a number in [${min}, ${max}]`);
  }
  return value;
}

function parseSheetKey(): SheetKey {
  const raw = parseFlag('sheet', 'body');
  if (raw === 'body' || raw === 'tentacle' || raw === 'slam') return raw;
  throw new Error(`--sheet=${raw} is not one of body, tentacle, slam`);
}

function parseMode(): Mode {
  const raw = parseFlag('mode', 'sheet');
  if (
    raw === 'sheet' ||
    raw === 'parts' ||
    raw === 'gore' ||
    raw === 'onion' ||
    raw === 'delta' ||
    raw === 'composite'
  ) {
    return raw;
  }
  throw new Error(`--mode=${raw} is not one of sheet, parts, gore, onion, delta, composite`);
}

interface LoadedSheet {
  readonly image: Canvas;
  readonly frameW: number;
  readonly frameH: number;
  readonly def: FigureDef;
}

function bakeSheet(spec: FigureSpec): LoadedSheet {
  const sheet = bakeFigureSheet(
    spec.def,
    spec.rows.map((row) => row.name),
  );
  return {
    image: sheet.canvas,
    frameW: sheet.frameWidth,
    frameH: sheet.frameHeight,
    def: spec.def,
  };
}

function rowIndexOf(spec: FigureSpec, name: string): number {
  const index = spec.rows.findIndex((row) => row.name === name);
  if (index === -1) {
    throw new Error(
      `"${name}" is not a row on this figure (${spec.rows.map((r) => r.name).join(', ')})`,
    );
  }
  return index;
}

function selectRows(spec: FigureSpec, rowFilter: string): readonly DisplayRow[] {
  const rows = rowFilter === '' ? spec.rows : spec.rows.filter((row) => row.name === rowFilter);
  if (rows.length === 0) {
    throw new Error(
      `--row=${rowFilter} is not one of ${spec.rows.map((row) => row.name).join(', ')}`,
    );
  }
  return rows;
}

function drawGroundGuide(ctx: Ctx, x: number, y: number, scale: number, loaded: LoadedSheet): void {
  ctx.strokeStyle = TILE_GUIDE;
  ctx.strokeRect(
    x + loaded.def.tileX * scale,
    y + loaded.def.tileY * scale,
    TILE_SCALE * scale,
    TILE_SCALE * scale,
  );
}

// ── Contact-sheet renderer, shared by sheet / onion / delta / gore ─────────────

const CHANNELS = 4;
const GREEN_OFFSET = 1;
const BLUE_OFFSET = 2;
const ALPHA_OFFSET = 3;
const MAX_CHANNEL_VALUE = 255;

/** A grayscale heat cell: how much a frame moved from the one before it. */
function diffCanvas(
  image: Canvas,
  frameW: number,
  frameH: number,
  sheetRow: number,
  colA: number,
  colB: number,
): Canvas {
  const sample = (col: number): Uint8ClampedArray => {
    const canvas = createCanvas(frameW, frameH);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, col * frameW, sheetRow * frameH, frameW, frameH, 0, 0, frameW, frameH);
    return ctx.getImageData(0, 0, frameW, frameH).data;
  };
  const a = sample(colA);
  const b = sample(colB);
  const out = createCanvas(frameW, frameH);
  const outCtx = out.getContext('2d');
  const outImage = outCtx.createImageData(frameW, frameH);
  for (let i = 0; i < a.length; i += CHANNELS) {
    const dr = Math.abs(a[i] - b[i]);
    const dg = Math.abs(a[i + GREEN_OFFSET] - b[i + GREEN_OFFSET]);
    const db = Math.abs(a[i + BLUE_OFFSET] - b[i + BLUE_OFFSET]);
    const intensity = Math.min(MAX_CHANNEL_VALUE, dr + dg + db);
    const coverage = Math.max(a[i + ALPHA_OFFSET], b[i + ALPHA_OFFSET]);
    outImage.data[i] = intensity;
    outImage.data[i + GREEN_OFFSET] = intensity;
    outImage.data[i + BLUE_OFFSET] = intensity;
    outImage.data[i + ALPHA_OFFSET] = coverage > 0 ? MAX_CHANNEL_VALUE : 0;
  }
  outCtx.putImageData(outImage, 0, 0);
  return out;
}

/** Previous column for a frame-to-frame comparison: loops wrap, one-shots hold frame 0. */
function previousColumn(row: DisplayRow, col: number): number {
  if (col > 0) return col - 1;
  return row.kind === 'loop' ? row.frameCount - 1 : 0;
}

function renderContactSheet(
  spec: FigureSpec,
  loaded: LoadedSheet,
  rows: readonly DisplayRow[],
  scale: number,
  mode: 'plain' | 'onion' | 'delta',
  outPath: string,
): void {
  const { image, frameW, frameH } = loaded;
  const cellW = frameW * scale;
  const cellH = frameH * scale;
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
  for (const row of rows) {
    const sheetRow = rowIndexOf(spec, row.name);
    const label =
      row.kind === 'gore'
        ? `${row.name} — severed piece`
        : `${row.name} — ${row.frameCount} frames, ${row.view ?? 'no view'}, ${row.kind}`;
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(label, PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;

    for (let col = 0; col < row.frameCount; col++) {
      const x = PADDING + col * (cellW + PADDING);
      if (mode === 'delta') {
        const prev = previousColumn(row, col);
        const diff = diffCanvas(image, frameW, frameH, sheetRow, prev, col);
        ctx.drawImage(diff, 0, 0, frameW, frameH, x, y, cellW, cellH);
      } else {
        if (mode === 'onion') {
          ctx.save();
          ctx.globalAlpha = ONION_ALPHA;
          const prev = previousColumn(row, col);
          ctx.drawImage(
            image,
            prev * frameW,
            sheetRow * frameH,
            frameW,
            frameH,
            x,
            y,
            cellW,
            cellH,
          );
          ctx.restore();
        }
        ctx.drawImage(image, col * frameW, sheetRow * frameH, frameW, frameH, x, y, cellW, cellH);
      }
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
      if (row.kind !== 'gore') drawGroundGuide(ctx, x, y, scale, loaded);
    }
    y += cellH + PADDING;
  }

  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText('in-game size (32px tile)', PADDING, y + LABEL_HEIGHT - PADDING);
  y += LABEL_HEIGHT;
  ctx.fillStyle = KRAKAREN_LAIR_STONE_LIGHT;
  ctx.fillRect(0, y, canvas.width, inGameH);
  rows.forEach((row, i) => {
    const sheetRow = rowIndexOf(spec, row.name);
    ctx.drawImage(
      image,
      0,
      sheetRow * frameH,
      frameW,
      frameH,
      PADDING + i * (inGameW + PADDING),
      y,
      inGameW,
      inGameH,
    );
  });

  const resolvedOutPath = writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(
    `Wrote ${resolvedOutPath} (${canvas.width}×${canvas.height}px, scale ${scale}×, mode ${mode})`,
  );
}

// ── Parts mode ───────────────────────────────────────────────────────────────

function renderParts(
  spec: FigureSpec,
  sheetKey: SheetKey,
  loaded: LoadedSheet,
  rowName: string,
  frame: number,
  scale: number,
  outPath: string,
): void {
  const row =
    rowName === ''
      ? spec.rows.find((candidate) => candidate.kind !== 'gore')
      : spec.rows.find((candidate) => candidate.name === rowName);
  if (row === undefined) {
    throw new Error(`--row=${rowName} did not match a non-gore row on this sheet`);
  }
  if (frame < 0 || frame >= row.frameCount) {
    throw new Error(
      `--frame=${frame} is out of range for "${row.name}" (0..${row.frameCount - 1})`,
    );
  }

  const parts = PARTS_BY_KEY[sheetKey];
  const partNames = Object.keys(parts);
  const { image, frameW, frameH } = loaded;
  const sheetRow = rowIndexOf(spec, row.name);
  const zoom = scale * PARTS_ZOOM;

  const cellSizes = partNames.map((name) => {
    const part = parts[name];
    return { w: Math.round(part.w * frameW * zoom), h: Math.round(part.h * frameH * zoom) };
  });
  const maxCellH = Math.max(...cellSizes.map((c) => c.h));
  const totalWidth = PADDING + cellSizes.reduce((sum, c) => sum + c.w + PADDING, 0);
  const height = PADDING + LABEL_HEIGHT + maxCellH + PADDING;

  const canvas = createCanvas(Math.ceil(totalWidth), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;

  let x = PADDING;
  partNames.forEach((name, i) => {
    const part = parts[name];
    const srcX = Math.round(part.x * frameW);
    const srcY = sheetRow * frameH + Math.round(part.y * frameH);
    const srcW = Math.round(part.w * frameW);
    const srcH = Math.round(part.h * frameH);
    const { w: cellW, h: cellH } = cellSizes[i];

    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(name, x, PADDING + LABEL_HEIGHT - PADDING);
    ctx.drawImage(
      image,
      frame * frameW + srcX,
      srcY,
      srcW,
      srcH,
      x,
      PADDING + LABEL_HEIGHT,
      cellW,
      cellH,
    );
    ctx.strokeStyle = GRID_LINE;
    ctx.strokeRect(x, PADDING + LABEL_HEIGHT, cellW, cellH);
    x += cellW + PADDING;
  });

  const resolvedOutPath = writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(
    `Wrote ${resolvedOutPath} (${canvas.width}×${canvas.height}px, ${row.name}[${frame}], scale ${scale}×)`,
  );
}

// ── Composite mode: the whole cast on the lair floor ────────────────────────

const COMPOSITE_FLOOR_TILES_W = 9;
const COMPOSITE_FLOOR_TILES_H = 4;
/** Review-only stage spacing; not the gameplay `SLAM_RISE_OFFSET_TILES`. */
const COMPOSITE_GUARD_OFFSET_TILES = -2.2;
const COMPOSITE_SLAM_OFFSET_TILES = 2.4;
const COMPOSITE_GROUND_ROW_TILES = 3;

/** Where the ground line sits inside a frame, as a fraction from the top. */
function groundFraction(def: FigureDef): number {
  return (def.tileY + GROUND_OFFSET_PX) / def.frameHeight;
}

function renderComposite(scale: number, outPath: string): void {
  const body = bakeSheet(SHEET_BY_KEY.body);
  const guard = bakeSheet(SHEET_BY_KEY.tentacle);
  const slam = bakeSheet(SHEET_BY_KEY.slam);

  const bodyRow = rowIndexOf(SHEET_BY_KEY.body, 'idle');
  const guardRow = rowIndexOf(SHEET_BY_KEY.tentacle, 'idle');
  const slamRow = rowIndexOf(SHEET_BY_KEY.slam, 'loom');

  const inGameScale = (IN_GAME_TILE / TILE_SCALE) * scale;
  const width = COMPOSITE_FLOOR_TILES_W * IN_GAME_TILE * scale;
  const height = COMPOSITE_FLOOR_TILES_H * IN_GAME_TILE * scale;

  const canvas = createCanvas(Math.ceil(width), Math.ceil(height + LABEL_HEIGHT));
  const ctx = canvas.getContext('2d');
  ctx.font = LABEL_FONT;
  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(
    'composite — body idle + guard tentacle idle + slam tentacle loom, on the lair floor',
    PADDING,
    LABEL_HEIGHT - PADDING,
  );

  const floorTile = IN_GAME_TILE * scale;
  const groundRowY = LABEL_HEIGHT + COMPOSITE_GROUND_ROW_TILES * floorTile;
  for (let ty = 0; ty * floorTile < height; ty++) {
    for (let tx = 0; tx * floorTile < width; tx++) {
      ctx.fillStyle = (tx + ty) % 2 === 0 ? KRAKAREN_LAIR_STONE_LIGHT : KRAKAREN_LAIR_STONE_DARK;
      ctx.fillRect(tx * floorTile, LABEL_HEIGHT + ty * floorTile, floorTile, floorTile);
    }
  }

  const centreX = width / 2;

  const place = (loaded: LoadedSheet, sheetRow: number, offsetTiles: number): void => {
    const drawnW = loaded.frameW * inGameScale;
    const drawnH = loaded.frameH * inGameScale;
    const anchorX = centreX + offsetTiles * floorTile;
    const anchorY = groundRowY;
    const groundY = groundFraction(loaded.def) * drawnH;
    ctx.drawImage(
      loaded.image,
      0,
      sheetRow * loaded.frameH,
      loaded.frameW,
      loaded.frameH,
      anchorX - drawnW / 2,
      anchorY - groundY,
      drawnW,
      drawnH,
    );
  };

  place(guard, guardRow, COMPOSITE_GUARD_OFFSET_TILES);
  place(body, bodyRow, 0);
  place(slam, slamRow, COMPOSITE_SLAM_OFFSET_TILES);

  const resolvedOutPath = writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(
    `Wrote ${resolvedOutPath} (${canvas.width}×${canvas.height}px, scale ${scale}×, mode composite)`,
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  // Gates before the contact sheet: a sheet is a tens-of-megapixel allocation,
  // and measuring the art on the far side of one has made a gate report a
  // defect that was not in the art.
  if (!runKrakarenGates()) return;

  const outPath = parseFlag('out', `${PREVIEW_DIR}/krakaren-review.png`);
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  const mode = parseMode();
  const rowFilter = parseFlag('row', '');
  const frame = parseNumberFlag('frame', 0, 0, Number.MAX_SAFE_INTEGER);

  if (mode === 'composite') {
    renderComposite(scale, outPath);
    return;
  }

  const sheetKey = parseSheetKey();
  const spec = SHEET_BY_KEY[sheetKey];
  const loaded = bakeSheet(spec);

  if (mode === 'parts') {
    renderParts(spec, sheetKey, loaded, rowFilter, frame, scale, outPath);
    return;
  }

  if (mode === 'gore') {
    const goreRows = spec.rows.filter((row) => row.kind === 'gore');
    if (goreRows.length === 0) {
      throw new Error(`${spec.def.id} has no gore pieces (the slam tentacle is never killable)`);
    }
    renderContactSheet(spec, loaded, goreRows, scale, 'plain', outPath);
    return;
  }

  const rows = selectRows(spec, rowFilter);
  const contactMode = mode === 'onion' ? 'onion' : mode === 'delta' ? 'delta' : 'plain';
  renderContactSheet(spec, loaded, rows, scale, contactMode, outPath);
}

main();
