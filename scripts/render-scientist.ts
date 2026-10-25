/**
 * Dr. Moult's review harness. Art has to be judged as an image, by something
 * that only looks at the image; every defect that matters on a figure is
 * invisible to a code read. The gates run first, before anything is baked.
 *
 *   npm run render:scientist                       every row, labelled, at 2×
 *   npx tsx scripts/render-scientist.ts --row=walk_side --scale=4
 *   npx tsx scripts/render-scientist.ts --part=head --scale=8
 *   npx tsx scripts/render-scientist.ts --mode=strip32 [--row=run]
 *   npx tsx scripts/render-scientist.ts --mode=lineup     beside the human at the tile
 *   npx tsx scripts/render-scientist.ts --mode=blind      unlabelled, for a blind reviewer
 *   npx tsx scripts/render-scientist.ts --mode=trails --row=walk_side
 *
 * `--row` takes a state (`walk_side`) or an action (`walk`, all three views).
 */

import { createCanvas, type Canvas, type CanvasRenderingContext2D } from 'canvas';

import { bakeFigureCell, figureStateNames, frameCountOf } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { scientistGateFailures } from './gates-scientist.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { TILE_SIZE } from '../src/core/constants.js';
import { HUMAN_FIGURE } from '../src/sprites/art/humanFigure.js';
import { buildSkeleton } from '../src/sprites/art/scientistArt.js';
import {
  ORIGIN_X,
  ORIGIN_Y,
  PX_PER_UNIT,
  SCIENTIST_FIGURE,
  scientistPoseAt,
  scientistStateKey,
  scientistTravelPerFrameCellPx,
  TILE_SCALE,
} from '../src/sprites/art/scientistFigure.js';

type Mode = 'sheet' | 'strip32' | 'lineup' | 'blind' | 'trails';
const MODES: readonly Mode[] = ['sheet', 'strip32', 'lineup', 'blind', 'trails'];

interface PartWindow {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Crops as fractions of the frame, so they survive the cell being resized. */
const PARTS: Readonly<Record<string, PartWindow>> = {
  head: { x: 0.3, y: 0.1, w: 0.42, h: 0.28 },
  torso: { x: 0.22, y: 0.2, w: 0.56, h: 0.42 },
  hands: { x: 0.12, y: 0.2, w: 0.76, h: 0.5 },
  legs: { x: 0.2, y: 0.55, w: 0.6, h: 0.4 },
};

const DEFAULT_SCALE = 2;
const MIN_SCALE = 0.25;
const MAX_SCALE = 12;
const LABEL_HEIGHT = 22;
const PADDING = 8;
const BACKDROP = '#3b3b40';
const DUNGEON_FLOOR = '#191720';
const GRID_LINE = 'rgba(255,255,255,0.12)';
const TILE_GUIDE = 'rgba(120,220,255,0.35)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '14px sans-serif';
const NEAREST_SCALE = 3;
/** The enlarged copy beside each in-game figure, as a share of the baked cell. */
const BLIND_DETAIL_SCALE = 1;
const BLIND_COLUMNS = 6;
const TRAIL_DOT = 2.5;
const TRAIL_COLOURS: readonly string[] = ['#ff6b6b', '#ffd166', '#06d6a0', '#4cc9f0', '#f72585'];
const ONION_ALPHA = 0.18;
/** The onion and the ground-plane panel side by side: a gap before, between and after. */
const TRAIL_PANEL_GAPS = 3;
const MAX_FRAME_STRIDE = 24;

function parseFlag(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match === undefined ? fallback : match.slice(prefix.length);
}

function parseNumberFlag(name: string, fallback: number, min: number, max: number): number {
  const raw = parseFlag(name, String(fallback));
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`--${name}=${raw} is not a number in [${min}, ${max}]`);
  }
  return value;
}

function selectedStates(): string[] {
  const only = parseFlag('row', '');
  const all = figureStateNames(SCIENTIST_FIGURE);
  if (only === '') return all;
  const matching = all.filter(
    (state) => state === only || scientistStateKey(state)?.action === only,
  );
  if (matching.length === 0) throw new Error(`No row or action named "${only}"`);
  return matching;
}

function labelled(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  ctx.fillStyle = LABEL_COLOR;
  ctx.font = LABEL_FONT;
  ctx.fillText(text, x, y + LABEL_HEIGHT - PADDING);
}

// ── sheet ────────────────────────────────────────────────────────────────────

function renderSheet(states: readonly string[], scale: number, partName: string): Canvas {
  const part = partName === '' ? null : (PARTS[partName] ?? null);
  if (partName !== '' && part === null) {
    throw new Error(`--part=${partName} is not one of ${Object.keys(PARTS).join(', ')}`);
  }
  const { frameWidth: fw, frameHeight: fh } = SCIENTIST_FIGURE;
  const srcX = part === null ? 0 : Math.round(part.x * fw);
  const srcY = part === null ? 0 : Math.round(part.y * fh);
  const srcW = part === null ? fw : Math.round(part.w * fw);
  const srcH = part === null ? fh : Math.round(part.h * fh);
  const cellW = srcW * scale;
  const cellH = srcH * scale;
  const every = parseNumberFlag('every', 1, 1, MAX_FRAME_STRIDE);
  const shown = (state: string): number[] =>
    Array.from({ length: frameCountOf(SCIENTIST_FIGURE, state) }, (_unused, i) => i).filter(
      (i) => i % every === 0,
    );
  const cols = Math.max(...states.map((state) => shown(state).length));
  const canvas = createCanvas(
    Math.ceil(PADDING + cols * (cellW + PADDING)),
    Math.ceil(PADDING + states.length * (cellH + LABEL_HEIGHT + PADDING)),
  );
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let y = PADDING;
  for (const state of states) {
    const frames = frameCountOf(SCIENTIST_FIGURE, state);
    labelled(
      ctx,
      `${state} — ${frames} frames${partName === '' ? '' : `  [${partName}]`}`,
      PADDING,
      y,
    );
    y += LABEL_HEIGHT;
    for (const [slot, frame] of shown(state).entries()) {
      const x = PADDING + slot * (cellW + PADDING);
      ctx.drawImage(
        bakeFigureCell(SCIENTIST_FIGURE, state, frame),
        srcX,
        srcY,
        srcW,
        srcH,
        x,
        y,
        cellW,
        cellH,
      );
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
      if (part === null) {
        ctx.strokeStyle = TILE_GUIDE;
        ctx.strokeRect(
          x + SCIENTIST_FIGURE.tileX * scale,
          y + SCIENTIST_FIGURE.tileY * scale,
          TILE_SCALE * scale,
          TILE_SCALE * scale,
        );
      }
    }
    y += cellH + PADDING;
  }
  return canvas;
}

// ── strip32 ──────────────────────────────────────────────────────────────────

const IN_GAME = TILE_SIZE / TILE_SCALE;

/** A cell downsampled to its true in-game size, the pixels the game draws. */
function inGameCell(state: string, frame: number, def = SCIENTIST_FIGURE): Canvas {
  const cell = createCanvas(
    Math.ceil(def.frameWidth * IN_GAME),
    Math.ceil(def.frameHeight * IN_GAME),
  );
  const ctx = cell.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(bakeFigureCell(def, state, frame), 0, 0, cell.width, cell.height);
  return cell;
}

function renderStrip32(states: readonly string[], labels: boolean): Canvas {
  const every = parseNumberFlag('every', 1, 1, MAX_FRAME_STRIDE);
  const w = Math.ceil(SCIENTIST_FIGURE.frameWidth * IN_GAME);
  const h = Math.ceil(SCIENTIST_FIGURE.frameHeight * IN_GAME);
  const cols = Math.max(
    ...states.map((state) => Math.ceil(frameCountOf(SCIENTIST_FIGURE, state) / every)),
  );
  const blockH = (labels ? LABEL_HEIGHT : 0) + h + PADDING + h * NEAREST_SCALE + PADDING;
  const canvas = createCanvas(
    PADDING + cols * (w * NEAREST_SCALE + PADDING),
    PADDING + states.length * blockH,
  );
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  let y = PADDING;
  for (const state of states) {
    if (labels) {
      labelled(ctx, state, PADDING, y);
      y += LABEL_HEIGHT;
    }
    const frames = frameCountOf(SCIENTIST_FIGURE, state);
    ctx.fillStyle = DUNGEON_FLOOR;
    ctx.fillRect(PADDING, y, canvas.width - PADDING * 2, h);
    ctx.fillRect(PADDING, y + h + PADDING, canvas.width - PADDING * 2, h * NEAREST_SCALE);
    for (let frame = 0; frame < frames; frame += every) {
      const small = inGameCell(state, frame);
      const x = PADDING + (frame / every) * (w * NEAREST_SCALE + PADDING);
      ctx.drawImage(small, x, y);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small, x, y + h + PADDING, w * NEAREST_SCALE, h * NEAREST_SCALE);
      ctx.imageSmoothingEnabled = true;
    }
    y += h + PADDING + h * NEAREST_SCALE + PADDING;
  }
  return canvas;
}

// ── lineup: beside the human crawler ─────────────────────────────────────────

const LINEUP_SCALE = 3;
const HUMAN_STATES: readonly string[] = ['idle', 'idle_side', 'idle_away'];
const SCIENTIST_LINEUP: readonly string[] = [
  'idle',
  'idle_side',
  'idle_away',
  'walk_side',
  'run_side',
];

/** Each figure stands on one ground line, its tile bottoms aligned, so the heights compare directly. */
function renderLineup(): Canvas {
  const entries = [
    ...HUMAN_STATES.map((state) => ({ def: HUMAN_FIGURE, state })),
    ...SCIENTIST_LINEUP.map((state) => ({ def: SCIENTIST_FIGURE, state })),
  ];
  const tilePx = TILE_SIZE * LINEUP_SCALE;
  const above = Math.max(...entries.map((e) => e.def.tileY / e.def.tileScale)) * tilePx;
  const below =
    Math.max(...entries.map((e) => (e.def.frameHeight - e.def.tileY) / e.def.tileScale)) * tilePx;
  const widths = entries.map((e) => (e.def.frameWidth / e.def.tileScale) * tilePx);
  const canvas = createCanvas(
    Math.ceil(PADDING + widths.reduce((a, b) => a + b + PADDING, 0)),
    Math.ceil(PADDING + above + below + PADDING),
  );
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = DUNGEON_FLOOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  let x = PADDING;
  entries.forEach((entry, i) => {
    const small = inGameCell(entry.state, 0, entry.def);
    const top = PADDING + above - (entry.def.tileY / entry.def.tileScale) * tilePx;
    ctx.drawImage(small, x, top, small.width * LINEUP_SCALE, small.height * LINEUP_SCALE);
    x += widths[i] + PADDING;
  });
  return canvas;
}

// ── blind: unlabelled actions for a reviewer who sees only the picture ──────

/** One representative frame per row, picked mid-action. */
const BLIND_FRAME_SHARE = 0.4;

function renderBlind(states: readonly string[]): Canvas {
  const w = Math.ceil(SCIENTIST_FIGURE.frameWidth * IN_GAME);
  const h = Math.ceil(SCIENTIST_FIGURE.frameHeight * IN_GAME);
  const bigW = Math.ceil(SCIENTIST_FIGURE.frameWidth * BLIND_DETAIL_SCALE);
  const bigH = Math.ceil(SCIENTIST_FIGURE.frameHeight * BLIND_DETAIL_SCALE);
  const cellW = w + bigW + PADDING * 2;
  const columns = Math.min(BLIND_COLUMNS, states.length);
  const rows = Math.ceil(states.length / columns);
  const canvas = createCanvas(PADDING + columns * cellW, PADDING + rows * (bigH + PADDING));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = DUNGEON_FLOOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  states.forEach((state, i) => {
    const frame = Math.floor(frameCountOf(SCIENTIST_FIGURE, state) * BLIND_FRAME_SHARE);
    const x = PADDING + (i % columns) * cellW;
    const y = PADDING + Math.floor(i / columns) * (bigH + PADDING);
    ctx.drawImage(inGameCell(state, frame), x, y + bigH - h);
    ctx.drawImage(bakeFigureCell(SCIENTIST_FIGURE, state, frame), x + w + PADDING, y, bigW, bigH);
  });
  return canvas;
}

// ── trails ───────────────────────────────────────────────────────────────────

/**
 * Both ankles, both wrists and the head over a faint onion of the row. In a
 * travelling row each point is also drawn carried back by the ground covered,
 * so a planted foot is a dot and a skating one a smear.
 */
function renderTrails(state: string, scale: number): Canvas {
  const key = scientistStateKey(state);
  if (key === undefined) throw new Error(`No state named "${state}"`);
  const frames = frameCountOf(SCIENTIST_FIGURE, state);
  const { frameWidth: fw, frameHeight: fh } = SCIENTIST_FIGURE;
  const canvas = createCanvas(
    Math.ceil(fw * scale * 2 + PADDING * TRAIL_PANEL_GAPS),
    Math.ceil(fh * scale + PADDING * 2),
  );
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = DUNGEON_FLOOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = ONION_ALPHA;
  for (let frame = 0; frame < frames; frame++) {
    ctx.drawImage(
      bakeFigureCell(SCIENTIST_FIGURE, state, frame),
      PADDING,
      PADDING,
      fw * scale,
      fh * scale,
    );
  }
  ctx.globalAlpha = 1;
  const travel = key.view === 'side' ? scientistTravelPerFrameCellPx(key.action) : 0;
  for (let frame = 0; frame < frames; frame++) {
    const skel = buildSkeleton(scientistPoseAt(key.action, key.view, frame));
    const points = [
      skel.legs.right.end,
      skel.legs.left.end,
      skel.arms.right.end,
      skel.arms.left.end,
      skel.head,
    ];
    points.forEach((p, i) => {
      const cx = ORIGIN_X + p.x * PX_PER_UNIT;
      const cy = ORIGIN_Y + p.y * PX_PER_UNIT;
      ctx.fillStyle = TRAIL_COLOURS[i % TRAIL_COLOURS.length];
      ctx.beginPath();
      ctx.arc(PADDING + cx * scale, PADDING + cy * scale, TRAIL_DOT, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(
        PADDING * 2 + fw * scale + (cx + travel * frame) * scale,
        PADDING + cy * scale,
        TRAIL_DOT,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    });
  }
  return canvas;
}

function main(): void {
  const mode = parseFlag('mode', 'sheet');
  if (!MODES.some((m) => m === mode)) throw new Error(`--mode must be one of ${MODES.join(', ')}`);
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  const states = selectedStates();
  const outPath = parseFlag('out', `${PREVIEW_DIR}/scientist-${mode}.png`);

  console.log('Gating the scientist figure…');
  reportFigureGates('scientist', scientistGateFailures());

  let canvas: Canvas;
  switch (mode) {
    case 'strip32':
      canvas = renderStrip32(states, parseFlag('labels', 'on') !== 'off');
      break;
    case 'lineup':
      canvas = renderLineup();
      break;
    case 'blind':
      canvas = renderBlind(states);
      break;
    case 'trails': {
      canvas = renderTrails(states[0], scale);
      break;
    }
    default:
      canvas = renderSheet(states, scale, parseFlag('part', ''));
  }
  const written = writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${written} (${canvas.width}×${canvas.height}px)`);
}

main();
