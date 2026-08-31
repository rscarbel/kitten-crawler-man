#!/usr/bin/env tsx
/**
 * Headless review harness for the goblin sheets.
 *
 * Stills genuinely cannot answer "does this look smooth", which is why the
 * `?goblins` preview scene exists — but stills are the only thing a reviewer
 * with no browser can look at, and most defects are visible in one. This slices
 * a baked sheet into seven panels:
 *
 *   1 contact sheet   every row at review scale, with the tile guide
 *   2 in-game strip   every row at TILE_SIZE / tileScale, where only the
 *                     silhouette survives
 *   3 silhouette      the same strip in solid black — a shape read entirely
 *                     from outline, with no interior linework to lean on
 *   4 part crops      --part=head|ears|hands|weapon|feet|wound
 *   5 onion skin      every frame of a row at low alpha, so the arc the motion
 *                     traces is visible as a shape
 *   6 arc trace       the weapon tip per frame as a polyline plus a spacing bar
 *                     chart. Even spacing is smooth motion; a chart with a cliff
 *                     in it is a hitch, and you can see it without seeing the
 *                     animation.
 *   7 delta chart     per-frame mean pixel delta with the G4 threshold drawn on
 *
 * Row order and frame counts come from the generator module, not from the
 * manifest, so a new row cannot desync the only review path this art has.
 *
 *   npx tsx scripts/render-goblins.ts --variant=axe --out=axe.png
 *   npx tsx scripts/render-goblins.ts --variant=mace --mode=arc --row=attack_light
 *   npx tsx scripts/render-goblins.ts --variant=warhammer --mode=parts --part=head --scale=6
 */

import { createCanvas, type Canvas } from 'canvas';
import {
  GOBLIN_ARCHETYPES,
  GOBLIN_FIGURES,
  GOBLIN_GORE_STATES,
  GOBLIN_STYLES,
  IMPACT_FRAMES,
  ROWS,
  TILE_SCALE,
  goblinPose,
  goblinWeaponTip,
  type GoblinArchetype,
  type RowSpec,
} from '../src/sprites/art/goblinFigure.js';
import { ARCHETYPE_SCALE, figureHeight } from '../src/sprites/art/goblinArt.js';
import { bakeFigureCell } from './figureSheet.js';
import { goblinGateFailures } from './gates-goblins.js';
import { reportFigureGates } from './figureGates.js';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';

// A painter that composes on its own scratch surface reaches
// `document.createElement('canvas')`, which Node does not have.
installCanvasGlobals();

/**
 * Columns a long row wraps at on the review sheet.
 *
 * The layout the deleted PNG used, kept because every panel below indexes into
 * it and because ten columns is what fits a war hammer's 18-frame haul on a
 * screen. Nothing but this harness reads it any more.
 */
const COLS_PER_ROW = 10;

/** The physical review-sheet row each state's frames start on. */
function rowOffsets(): Map<string, number> {
  const offsets = new Map<string, number>();
  let physicalRow = 0;
  for (const row of ROWS) {
    offsets.set(row.name, physicalRow);
    physicalRow += Math.ceil(row.frameCount / COLS_PER_ROW);
  }
  offsets.set(GORE_ROW_NAME, physicalRow);
  return offsets;
}

/** The pseudo-row the nine one-frame gore states are laid out on. */
const GORE_ROW_NAME = 'gore';

/**
 * The gore pieces as one review row.
 *
 * They are nine separate one-frame states in the figure — that is what
 * `BodyPartGoreSystem` asks for — but a reviewer wants them side by side, so
 * the harness lays them out as a row of its own.
 */
const GORE_ROW: RowSpec = {
  name: GORE_ROW_NAME,
  frameCount: GOBLIN_GORE_STATES.length,
  kind: 'oneShot',
};

/** The state one cell of a review row is painted from. */
function stateOf(row: RowSpec, frame: number): string {
  return row.name === GORE_ROW_NAME ? GOBLIN_GORE_STATES[frame] : row.name;
}

/**
 * The review sheet, painted from the figure rather than loaded from a PNG.
 *
 * Laid out exactly as the deleted sheet was — one physical row per state, wrapped
 * at `COLS_PER_ROW` — so every panel below still addresses a cell by (row,
 * frame). Each cell is baked supersampled and downsampled, the way the runtime
 * cache bakes it, so what a reviewer looks at is what the game blits.
 */
function bakeReviewSheet(archetype: GoblinArchetype): Canvas {
  const def = GOBLIN_FIGURES[archetype];
  const offsets = rowOffsets();
  const physicalRows = [...ROWS, GORE_ROW].reduce(
    (total, row) => total + Math.ceil(row.frameCount / COLS_PER_ROW),
    0,
  );
  const sheet = createCanvas(COLS_PER_ROW * def.frameWidth, physicalRows * def.frameHeight);
  const ctx = sheet.getContext('2d');
  for (const row of [...ROWS, GORE_ROW]) {
    const start = offsets.get(row.name);
    if (start === undefined) throw new Error(`no review-sheet offset for ${row.name}`);
    for (let frame = 0; frame < row.frameCount; frame++) {
      ctx.drawImage(
        bakeFigureCell(def, stateOf(row, frame), row.name === GORE_ROW_NAME ? 0 : frame),
        (frame % COLS_PER_ROW) * def.frameWidth,
        (start + Math.floor(frame / COLS_PER_ROW)) * def.frameHeight,
      );
    }
  }
  return sheet;
}

/** Matches TILE_SIZE in src/core/constants.ts. */
const IN_GAME_TILE = 32;

const DEFAULT_SCALE = 1.5;
const MIN_SCALE = 0.25;
const MAX_SCALE = 10;
const LABEL_HEIGHT = 22;
const PADDING = 8;
const BACKDROP = '#6b6660';
/** The real floor mids a goblin stands on, from `src/map/tilegen/palette.ts`. */
const FLOOR_SWATCHES: readonly string[] = ['#8c8170', '#b09668', '#888e96', '#637032'];
const GRID_LINE = 'rgba(255,255,255,0.14)';
const TILE_GUIDE = 'rgba(120,220,255,0.4)';
const IMPACT_MARK = 'rgba(255,120,90,0.85)';
const LABEL_COLOR = '#f0ece4';
const LABEL_FONT = '13px sans-serif';
const CHART_INK = '#e8dfc8';
const CHART_LIMIT = '#ff8a5c';
/** Floors that stop a flat row dividing by zero and producing an infinite bar. */
const MIN_CHART_PEAK = 0.001;
const MIN_CHART_SPAN = 0.001;

type Mode = 'sheet' | 'parts' | 'onion' | 'arc' | 'delta' | 'gore';

interface PartWindow {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Windows onto one body part, as fractions of the frame, so a reviewer can judge
 * the ears or the hands at a scale where they are actually visible. Whole-figure
 * contact sheets hide exactly the defects that matter most — four rounds of
 * review on Carl only became possible once the face could be looked at alone.
 */
const PART_WINDOWS: Record<string, PartWindow> = {
  head: { x: 0.34, y: 0.02, w: 0.42, h: 0.3 },
  ears: { x: 0.22, y: 0.02, w: 0.4, h: 0.26 },
  hands: { x: 0.28, y: 0.38, w: 0.56, h: 0.34 },
  weapon: { x: 0.4, y: 0.3, w: 0.6, h: 0.55 },
  feet: { x: 0.24, y: 0.72, w: 0.5, h: 0.28 },
  wound: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 },
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

interface Geometry {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
}

/** The cell the figure declares — the same four numbers the runtime places it by. */
function geometryOf(archetype: GoblinArchetype): Geometry {
  const { frameWidth, frameHeight, tileX, tileY } = GOBLIN_FIGURES[archetype];
  return { frameWidth, frameHeight, tileX, tileY };
}

interface FrameSource {
  readonly sx: number;
  readonly sy: number;
}

function frameSource(row: RowSpec, frame: number, geometry: Geometry): FrameSource {
  const start = rowOffsets().get(row.name);
  if (start === undefined) throw new Error(`no offset for ${row.name}`);
  return {
    sx: (frame % COLS_PER_ROW) * geometry.frameWidth,
    sy: (start + Math.floor(frame / COLS_PER_ROW)) * geometry.frameHeight,
  };
}

function impactFrameOf(archetype: GoblinArchetype, row: RowSpec): number | null {
  if (row.name === 'attack_light') return IMPACT_FRAMES[archetype].light;
  if (row.name === 'attack_heavy') return IMPACT_FRAMES[archetype].heavy;
  return null;
}

// ── Panel 1–3: contact sheet, in-game strip, silhouette ──────────────────────

/**
 * The height the goblin is actually drawn at, not its authored height — the rig
 * is authored at one size and shrunk at bake time by `ARCHETYPE_SCALE`.
 */
function drawnHeight(archetype: GoblinArchetype): number {
  return figureHeight(GOBLIN_STYLES[archetype].proportions) * ARCHETYPE_SCALE[archetype];
}

function drawSheetPanels(
  archetype: GoblinArchetype,
  sheet: Canvas,
  geometry: Geometry,
  rows: readonly RowSpec[],
  scale: number,
  out: string,
): void {
  const cell = geometry.frameWidth * scale;
  const cellH = geometry.frameHeight * scale;
  const maxCols = Math.max(...rows.map((row) => Math.min(row.frameCount, COLS_PER_ROW)));
  const inGame = geometry.frameWidth * (IN_GAME_TILE / TILE_SCALE);
  const inGameH = geometry.frameHeight * (IN_GAME_TILE / TILE_SCALE);
  const stripCols = Math.max(...rows.map((row) => row.frameCount));

  const width = Math.max(
    PADDING + maxCols * (cell + PADDING),
    PADDING + stripCols * (inGame + PADDING),
  );
  const rowBlocks = rows.map((row) => Math.ceil(row.frameCount / COLS_PER_ROW));
  const contactHeight = rowBlocks.reduce(
    (sum, blocks) => sum + LABEL_HEIGHT + blocks * (cellH + PADDING),
    0,
  );
  const stripHeight = 2 * (LABEL_HEIGHT + rows.length * (inGameH + PADDING));
  const height = PADDING + contactHeight + stripHeight + LABEL_HEIGHT;

  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, width, height);
  ctx.font = LABEL_FONT;

  let y = PADDING;
  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(
    `goblin_${archetype} — figure height ${drawnHeight(archetype).toFixed(3)} tiles, ` +
      `frame ${geometry.frameWidth}×${geometry.frameHeight}, review scale ${scale}×`,
    PADDING,
    y + LABEL_HEIGHT - PADDING,
  );
  y += LABEL_HEIGHT;

  for (const row of rows) {
    const impact = impactFrameOf(archetype, row);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(
      `${row.name} — ${row.frameCount} frames, ${row.kind}` +
        (impact === null ? '' : `, impact on frame ${impact}`),
      PADDING,
      y + LABEL_HEIGHT - PADDING,
    );
    y += LABEL_HEIGHT;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const block = Math.floor(frame / COLS_PER_ROW);
      const x = PADDING + (frame % COLS_PER_ROW) * (cell + PADDING);
      const top = y + block * (cellH + PADDING);
      const { sx, sy } = frameSource(row, frame, geometry);
      ctx.drawImage(sheet, sx, sy, geometry.frameWidth, geometry.frameHeight, x, top, cell, cellH);
      ctx.strokeStyle = frame === impact ? IMPACT_MARK : GRID_LINE;
      ctx.lineWidth = frame === impact ? 2 : 1;
      ctx.strokeRect(x, top, cell, cellH);
      ctx.lineWidth = 1;
      ctx.strokeStyle = TILE_GUIDE;
      ctx.strokeRect(
        x + geometry.tileX * scale,
        top + geometry.tileY * scale,
        TILE_SCALE * scale,
        TILE_SCALE * scale,
      );
    }
    y += Math.ceil(row.frameCount / COLS_PER_ROW) * (cellH + PADDING);
  }

  for (const asSilhouette of [false, true]) {
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(
      asSilhouette
        ? 'silhouette at in-game size — name each archetype from this alone'
        : `in-game size (${IN_GAME_TILE}px tile), on the real floor colours`,
      PADDING,
      y + LABEL_HEIGHT - PADDING,
    );
    y += LABEL_HEIGHT;
    for (const row of rows) {
      for (let frame = 0; frame < row.frameCount; frame++) {
        const x = PADDING + frame * (inGame + PADDING);
        const { sx, sy } = frameSource(row, frame, geometry);
        ctx.fillStyle = asSilhouette ? BACKDROP : FLOOR_SWATCHES[frame % FLOOR_SWATCHES.length];
        ctx.fillRect(x, y, inGame, inGameH);
        if (!asSilhouette) {
          ctx.drawImage(
            sheet,
            sx,
            sy,
            geometry.frameWidth,
            geometry.frameHeight,
            x,
            y,
            inGame,
            inGameH,
          );
        } else {
          const shape = createCanvas(Math.ceil(inGame), Math.ceil(inGameH));
          const shapeCtx = shape.getContext('2d');
          shapeCtx.drawImage(
            sheet,
            sx,
            sy,
            geometry.frameWidth,
            geometry.frameHeight,
            0,
            0,
            inGame,
            inGameH,
          );
          const pixels = shapeCtx.getImageData(0, 0, shape.width, shape.height);
          const ALPHA_CUTOFF = 40;
          const CHANNELS = 4;
          const ALPHA = 3;
          for (let i = 0; i < pixels.data.length; i += CHANNELS) {
            pixels.data[i] = 0;
            pixels.data[i + 1] = 0;
            pixels.data[i + 2] = 0;
            pixels.data[i + ALPHA] = pixels.data[i + ALPHA] > ALPHA_CUTOFF ? 255 : 0;
          }
          shapeCtx.putImageData(pixels, 0, 0);
          ctx.drawImage(shape, x, y);
        }
      }
      y += inGameH + PADDING;
    }
  }

  const writtenPath = writePreviewPng(out, canvas.toBuffer('image/png'));
  console.log(`Wrote ${writtenPath} (${canvas.width}×${canvas.height}px)`);
}

// ── Panel 4: part crops ──────────────────────────────────────────────────────

function drawPartPanel(
  archetype: GoblinArchetype,
  sheet: Canvas,
  geometry: Geometry,
  rows: readonly RowSpec[],
  partName: string,
  scale: number,
  out: string,
): void {
  const part = PART_WINDOWS[partName];
  if (part === undefined) {
    throw new Error(`--part must be one of ${Object.keys(PART_WINDOWS).join('|')}`);
  }
  const srcW = geometry.frameWidth * part.w;
  const srcH = geometry.frameHeight * part.h;
  const cell = srcW * scale;
  const cellH = srcH * scale;
  const maxCols = Math.max(...rows.map((row) => Math.min(row.frameCount, COLS_PER_ROW)));

  const width = PADDING + maxCols * (cell + PADDING);
  const height =
    PADDING +
    rows.reduce(
      (sum, row) =>
        sum + LABEL_HEIGHT + Math.ceil(row.frameCount / COLS_PER_ROW) * (cellH + PADDING),
      0,
    );
  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, width, height);
  ctx.font = LABEL_FONT;

  let y = PADDING;
  for (const row of rows) {
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(
      `${archetype} ${row.name} — ${partName} at ${scale}×`,
      PADDING,
      y + LABEL_HEIGHT - PADDING,
    );
    y += LABEL_HEIGHT;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const block = Math.floor(frame / COLS_PER_ROW);
      const x = PADDING + (frame % COLS_PER_ROW) * (cell + PADDING);
      const top = y + block * (cellH + PADDING);
      const { sx, sy } = frameSource(row, frame, geometry);
      ctx.drawImage(
        sheet,
        sx + geometry.frameWidth * part.x,
        sy + geometry.frameHeight * part.y,
        srcW,
        srcH,
        x,
        top,
        cell,
        cellH,
      );
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, top, cell, cellH);
    }
    y += Math.ceil(row.frameCount / COLS_PER_ROW) * (cellH + PADDING);
  }
  const writtenPath = writePreviewPng(out, canvas.toBuffer('image/png'));
  console.log(`Wrote ${writtenPath} (${canvas.width}×${canvas.height}px)`);
}

// ── Panel 5: onion skin ──────────────────────────────────────────────────────

const ONION_ALPHA = 0.22;

function drawOnionPanel(
  archetype: GoblinArchetype,
  sheet: Canvas,
  geometry: Geometry,
  rows: readonly RowSpec[],
  scale: number,
  out: string,
): void {
  const cell = geometry.frameWidth * scale;
  const cellH = geometry.frameHeight * scale;
  const width = PADDING + rows.length * (cell + PADDING);
  const height = PADDING + LABEL_HEIGHT + cellH + PADDING + LABEL_HEIGHT;
  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, width, height);
  ctx.font = LABEL_FONT;
  ctx.fillStyle = LABEL_COLOR;
  ctx.fillText(
    `${archetype} — onion skin: every frame of a row composited, so the arc is a shape`,
    PADDING,
    PADDING + LABEL_HEIGHT - PADDING,
  );

  rows.forEach((row, index) => {
    const x = PADDING + index * (cell + PADDING);
    const top = PADDING + LABEL_HEIGHT;
    ctx.save();
    ctx.globalAlpha = ONION_ALPHA;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const { sx, sy } = frameSource(row, frame, geometry);
      ctx.drawImage(sheet, sx, sy, geometry.frameWidth, geometry.frameHeight, x, top, cell, cellH);
    }
    ctx.restore();
    ctx.strokeStyle = GRID_LINE;
    ctx.strokeRect(x, top, cell, cellH);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(row.name, x + 4, top + cellH + LABEL_HEIGHT - PADDING);
  });

  const writtenPath = writePreviewPng(out, canvas.toBuffer('image/png'));
  console.log(`Wrote ${writtenPath} (${canvas.width}×${canvas.height}px)`);
}

// ── Panel 6: arc trace ───────────────────────────────────────────────────────

interface TracePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * The weapon tip per frame, per row.
 *
 * Computed from the choreography rather than read back from a dumped JSON file.
 * The dump existed because the trace was produced inside a bake and the harness
 * could only see what the bake wrote down; the harness now calls the same pose
 * functions the figure paints from, so there is nothing left to drift.
 */
function arcTraceOf(archetype: GoblinArchetype): Record<string, readonly TracePoint[]> {
  const trace: Record<string, readonly TracePoint[]> = {};
  for (const row of ROWS) {
    const points: TracePoint[] = [];
    for (let frame = 0; frame < row.frameCount; frame++) {
      const tip = goblinWeaponTip(goblinPose(archetype, row, frame), archetype);
      if (tip === null) break;
      points.push({ x: tip.x, y: tip.y });
    }
    trace[row.name] = points;
  }
  return trace;
}

const ARC_PANEL = 320;
const ARC_CHART_HEIGHT = 120;
const ARC_DOT_RADIUS = 3;

function drawArcPanel(archetype: GoblinArchetype, rows: readonly RowSpec[], out: string): void {
  const trace = arcTraceOf(archetype);
  const shown = rows.filter((row) => (trace[row.name] ?? []).length > 1);
  if (shown.length === 0) throw new Error('no arc trace for the requested rows');

  const width = PADDING + shown.length * (ARC_PANEL + PADDING);
  const height = PADDING + LABEL_HEIGHT + ARC_PANEL + LABEL_HEIGHT + ARC_CHART_HEIGHT + PADDING * 2;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, width, height);
  ctx.font = LABEL_FONT;

  shown.forEach((row, index) => {
    const points = trace[row.name];
    const x0 = PADDING + index * (ARC_PANEL + PADDING);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(
      `${archetype} ${row.name} — weapon tip path`,
      x0,
      PADDING + LABEL_HEIGHT - PADDING,
    );

    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    const span = Math.max(maxX - minX, maxY - minY, MIN_CHART_SPAN);
    const project = (point: TracePoint): TracePoint => ({
      x: x0 + PADDING + ((point.x - minX) / span) * (ARC_PANEL - PADDING * 2),
      y: PADDING + LABEL_HEIGHT + PADDING + ((point.y - minY) / span) * (ARC_PANEL - PADDING * 2),
    });

    ctx.strokeStyle = CHART_INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((point, i) => {
      const at = project(point);
      if (i === 0) ctx.moveTo(at.x, at.y);
      else ctx.lineTo(at.x, at.y);
    });
    ctx.stroke();

    const impact = impactFrameOf(archetype, row);
    points.forEach((point, i) => {
      const at = project(point);
      ctx.fillStyle = i === impact ? IMPACT_MARK : CHART_INK;
      ctx.beginPath();
      ctx.arc(at.x, at.y, ARC_DOT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    });

    const steps: number[] = [];
    for (let i = 1; i < points.length; i++) {
      steps.push(Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
    }
    const chartTop = PADDING + LABEL_HEIGHT + ARC_PANEL + LABEL_HEIGHT;
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText('per-frame spacing — a cliff here is a hitch', x0, chartTop - PADDING);
    const peak = Math.max(...steps, MIN_CHART_PEAK);
    const barWidth = (ARC_PANEL - PADDING * 2) / steps.length;
    steps.forEach((step, i) => {
      const barHeight = (step / peak) * ARC_CHART_HEIGHT;
      ctx.fillStyle = impact !== null && i + 1 === impact ? IMPACT_MARK : CHART_INK;
      ctx.fillRect(
        x0 + PADDING + i * barWidth,
        chartTop + ARC_CHART_HEIGHT - barHeight,
        barWidth - 1,
        barHeight,
      );
    });
  });

  const writtenPath = writePreviewPng(out, canvas.toBuffer('image/png'));
  console.log(`Wrote ${writtenPath} (${canvas.width}×${canvas.height}px)`);
}

// ── Panel 7: delta chart ─────────────────────────────────────────────────────

const DELTA_PANEL_WIDTH = 320;
const DELTA_PANEL_HEIGHT = 140;
const G4_SPIKE_RATIO = 2.5;

function drawDeltaPanel(
  archetype: GoblinArchetype,
  sheet: Canvas,
  geometry: Geometry,
  rows: readonly RowSpec[],
  out: string,
): void {
  const width = PADDING + rows.length * (DELTA_PANEL_WIDTH + PADDING);
  const height = PADDING + LABEL_HEIGHT + DELTA_PANEL_HEIGHT + PADDING * 2;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, width, height);
  ctx.font = LABEL_FONT;

  const scratch = createCanvas(geometry.frameWidth, geometry.frameHeight * 2);
  const scratchCtx = scratch.getContext('2d');

  rows.forEach((row, index) => {
    const x0 = PADDING + index * (DELTA_PANEL_WIDTH + PADDING);
    const deltas: number[] = [];
    for (let frame = 1; frame < row.frameCount; frame++) {
      const a = frameSource(row, frame - 1, geometry);
      const b = frameSource(row, frame, geometry);
      scratchCtx.clearRect(0, 0, scratch.width, scratch.height);
      scratchCtx.drawImage(
        sheet,
        a.sx,
        a.sy,
        geometry.frameWidth,
        geometry.frameHeight,
        0,
        0,
        geometry.frameWidth,
        geometry.frameHeight,
      );
      scratchCtx.drawImage(
        sheet,
        b.sx,
        b.sy,
        geometry.frameWidth,
        geometry.frameHeight,
        0,
        geometry.frameHeight,
        geometry.frameWidth,
        geometry.frameHeight,
      );
      const pixels = scratchCtx.getImageData(0, 0, scratch.width, scratch.height);
      const CHANNELS = 4;
      const half = geometry.frameWidth * geometry.frameHeight * CHANNELS;
      let total = 0;
      for (let i = 0; i < half; i++) total += Math.abs(pixels.data[i] - pixels.data[half + i]);
      deltas.push(total / half);
    }
    if (deltas.length === 0) {
      ctx.fillStyle = LABEL_COLOR;
      ctx.fillText(`${archetype} ${row.name} — single frame, no delta`, x0, PADDING + LABEL_HEIGHT);
      return;
    }
    const sorted = [...deltas].sort((a, b) => a - b);
    const limit = sorted[Math.floor(sorted.length / 2)] * G4_SPIKE_RATIO;
    const peak = Math.max(...deltas, limit, MIN_CHART_PEAK);

    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(`${archetype} ${row.name} — frame delta`, x0, PADDING + LABEL_HEIGHT - PADDING);
    const top = PADDING + LABEL_HEIGHT;
    const barWidth = DELTA_PANEL_WIDTH / deltas.length;
    deltas.forEach((delta, i) => {
      const barHeight = (delta / peak) * DELTA_PANEL_HEIGHT;
      ctx.fillStyle = CHART_INK;
      ctx.fillRect(
        x0 + i * barWidth,
        top + DELTA_PANEL_HEIGHT - barHeight,
        barWidth - 1,
        barHeight,
      );
    });
    const limitY = top + DELTA_PANEL_HEIGHT - (limit / peak) * DELTA_PANEL_HEIGHT;
    ctx.strokeStyle = CHART_LIMIT;
    ctx.beginPath();
    ctx.moveTo(x0, limitY);
    ctx.lineTo(x0 + DELTA_PANEL_WIDTH, limitY);
    ctx.stroke();
  });

  const writtenPath = writePreviewPng(out, canvas.toBuffer('image/png'));
  console.log(`Wrote ${writtenPath} (${canvas.width}×${canvas.height}px)`);
}

// ── Panel 8: gore strip ──────────────────────────────────────────────────────

/**
 * The nine pieces alone, at review scale and at the size they actually render.
 *
 * Gore draws at `TILE_SIZE / tileScale` — half the sheet's own pixels — so the
 * bottom strip here is the real test: a reviewer must be able to *name* all
 * nine pieces from it at that size. Cropped to each piece's own ink, because
 * the cell is sized by a war hammer hauled overhead and a severed jaw floating
 * in the middle of it tells a reviewer nothing about whether the jaw reads.
 */
const GORE_REVIEW_SCALES: ReadonlyArray<number> = [4, 1, 0.5];

function drawGorePanel(
  archetype: GoblinArchetype,
  sheet: Canvas,
  geometry: Geometry,
  out: string,
): void {
  const row = GORE_ROW;
  // Cropped to a centred square rather than shown as a whole cell: gore is
  // centred on the cell centre by construction, and the cell itself is sized by
  // a war hammer hauled overhead, so most of it is empty air.
  const GORE_CROP_FRACTION = 0.62;
  const crop = Math.min(geometry.frameWidth, geometry.frameHeight) * GORE_CROP_FRACTION;
  const cell = crop;
  const width = PADDING + row.frameCount * (cell * GORE_REVIEW_SCALES[0] * 0.5 + PADDING);
  const height =
    PADDING +
    GORE_REVIEW_SCALES.reduce((sum, scale) => sum + LABEL_HEIGHT + cell * scale * 0.5 + PADDING, 0);
  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = FLOOR_SWATCHES[0];
  ctx.fillRect(0, 0, width, height);
  ctx.font = LABEL_FONT;

  let y = PADDING;
  for (const scale of GORE_REVIEW_SCALES) {
    const drawn = cell * scale * 0.5;
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(
      scale === GORE_REVIEW_SCALES[GORE_REVIEW_SCALES.length - 1]
        ? `${archetype} gore at the size it renders in game — name all nine from this row`
        : `${archetype} gore at ${scale}× the in-game size`,
      PADDING,
      y + LABEL_HEIGHT - PADDING,
    );
    y += LABEL_HEIGHT;
    for (let frame = 0; frame < row.frameCount; frame++) {
      const { sx, sy } = frameSource(row, frame, geometry);
      const x = PADDING + frame * (cell * GORE_REVIEW_SCALES[0] * 0.5 + PADDING);
      ctx.drawImage(
        sheet,
        sx + (geometry.frameWidth - crop) / 2,
        sy + (geometry.frameHeight - crop) / 2,
        crop,
        crop,
        x,
        y,
        drawn,
        drawn,
      );
    }
    y += drawn + PADDING;
  }
  const writtenPath = writePreviewPng(out, canvas.toBuffer('image/png'));
  console.log(`Wrote ${writtenPath} (${canvas.width}×${canvas.height}px)`);
}

// ── Entry ────────────────────────────────────────────────────────────────────

function parseVariant(): GoblinArchetype {
  const raw = parseFlag('variant', '');
  const found = GOBLIN_ARCHETYPES.find((archetype) => archetype === raw);
  if (found === undefined) {
    throw new Error(`--variant must be one of ${GOBLIN_ARCHETYPES.join('|')}`);
  }
  return found;
}

function parseMode(): Mode {
  const raw = parseFlag('mode', 'sheet');
  const modes: readonly Mode[] = ['sheet', 'parts', 'onion', 'arc', 'delta', 'gore'];
  const found = modes.find((mode) => mode === raw);
  if (found === undefined) throw new Error(`--mode must be one of ${modes.join('|')}`);
  return found;
}

function renderVariant(archetype: GoblinArchetype, mode: Mode, scale: number, only: string): void {
  const rows = only === '' ? ROWS : ROWS.filter((row) => row.name === only);
  if (rows.length === 0) throw new Error(`No row named "${only}"`);
  const out = parseFlag('out', `${PREVIEW_DIR}/goblin-${archetype}-${mode}.png`);

  if (mode === 'arc') {
    drawArcPanel(archetype, rows, out);
    return;
  }

  const geometry = geometryOf(archetype);
  const sheet = bakeReviewSheet(archetype);
  switch (mode) {
    case 'sheet':
      drawSheetPanels(archetype, sheet, geometry, rows, scale, out);
      return;
    case 'parts':
      drawPartPanel(archetype, sheet, geometry, rows, parseFlag('part', 'head'), scale, out);
      return;
    case 'onion':
      drawOnionPanel(archetype, sheet, geometry, rows, scale, out);
      return;
    case 'delta':
      drawDeltaPanel(archetype, sheet, geometry, rows, out);
      return;
    case 'gore':
      drawGorePanel(archetype, sheet, geometry, out);
      return;
  }
}

function main(): void {
  // Gates first, before any contact sheet is baked. A contact sheet is a
  // tens-of-megapixel allocation, and measuring art on the far side of one has
  // already made a centroid gate report a seam at twice its true width.
  if (!reportFigureGates('goblins', goblinGateFailures())) return;

  const mode = parseMode();
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  const only = parseFlag('row', '');
  // With no `--variant` every build is rendered: five figures share one
  // choreography, and a review that only ever looked at the axe would never see
  // the war hammer outgrow its cell.
  const requested = parseFlag('variant', '');
  const variants = requested === '' ? GOBLIN_ARCHETYPES : [parseVariant()];
  for (const archetype of variants) renderVariant(archetype, mode, scale, only);
}

/**
 * No re-exports from this module: it runs `main()` on import, so anything that
 * imported it for a helper would bake a review sheet as a side effect.
 */
main();
