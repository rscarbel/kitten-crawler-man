/**
 * Angel's review harness: her routines as pixels, painted from the figure
 * exactly the way the runtime cache bakes them, with the art gates run first.
 *
 *   npm run render:angel                                   every routine, every frame
 *   npx tsx scripts/render-angel.ts --routine=pole_walk --scale=2
 *   npx tsx scripts/render-angel.ts --mode=crop --routine=roll_wave --frames=0,8 --part=head --scale=6
 *   npx tsx scripts/render-angel.ts --mode=strip32                 every frame at the 32 px tile
 *   npx tsx scripts/render-angel.ts --mode=onion --routine=swing_squat
 *   npx tsx scripts/render-angel.ts --mode=delta --routine=swing_squat
 *   npx tsx scripts/render-angel.ts --mode=trails --routine=pole_walk
 *   npx tsx scripts/render-angel.ts --mode=seams                   every routine's hand-off
 *   npx tsx scripts/render-angel.ts --mode=gates                   the gates alone
 */

import { type Canvas, createCanvas } from 'canvas';

import { bakeFigureCell } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { angelGateFailures } from './gates-angel.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import {
  ANGEL_CELL_PX_PER_UNIT,
  ANGEL_FIGURE,
  ANGEL_POLE_BASE_IN_CELL,
  ANGEL_ROUTINES,
  ANGEL_ROUTINE_FRAMES,
  angelFrameAt,
  type AngelRoutine,
} from '../src/sprites/art/angelFigure.js';
import { FOOT_Y, HIP_JOINT_Y, NECK_TOP_Y } from '../src/sprites/art/angel/proportions.js';
import {
  project,
  type AngelSkeleton,
  type BodySide,
  type V3,
} from '../src/sprites/art/angel/skeleton.js';
import { drawnSideOf } from '../src/sprites/art/angel/dance/pose.js';

/** Matches TILE_SIZE in src/core/constants.ts. */
const IN_GAME_TILE = 32;
const IN_GAME_SCALE = IN_GAME_TILE / ANGEL_FIGURE.tileScale;
const NEAREST_COPY_SCALE = 2;

const DEFAULT_SCALE = 1;
const MIN_SCALE = 0.25;
const MAX_SCALE = 12;
const COLUMNS = 16;
const LABEL_HEIGHT = 16;
const PADDING = 4;
const LABEL_INSET = 3;
/** The club's stage floor and the dungeon stone she may be compared on. */
const STAGE_FLOOR = '#3b3340';
const STAGE_FLOOR_ALT = '#4a3a4e';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '11px sans-serif';
const ONION_ALPHA = 0.18;
const DELTA_GAIN = 4;
const RGBA_STRIDE = 4;
const GREEN = 1;
const BLUE = 2;
const ALPHA = 3;
const OPAQUE = 255;
const TRAIL_DOT_RADIUS = 2.5;
const TRAIL_LINE_WIDTH = 1.5;
const TRAIL_ONION_ALPHA = 0.08;

type Mode = 'sheet' | 'crop' | 'strip32' | 'onion' | 'delta' | 'trails' | 'seams' | 'gates';
const MODES: ReadonlyArray<Mode> = [
  'sheet',
  'crop',
  'strip32',
  'onion',
  'delta',
  'trails',
  'seams',
  'gates',
];

/** Crop windows about her own root, in figure units: (left, top, right, bottom) with y up from the floor negative. */
const PARTS = {
  full: { left: -0.36, top: -1.05, right: 0.36, bottom: 0.08 },
  head: { left: -0.13, top: -0.98, right: 0.13, bottom: -0.68 },
  torso: { left: -0.2, top: -0.82, right: 0.2, bottom: -0.35 },
  hips: { left: -0.18, top: -0.55, right: 0.18, bottom: -0.3 },
  legs: { left: -0.22, top: -0.5, right: 0.22, bottom: 0.06 },
  feet: { left: -0.2, top: -0.12, right: 0.2, bottom: 0.05 },
} as const;
type Part = keyof typeof PARTS;
const PART_NAMES = [
  'full',
  'head',
  'torso',
  'hips',
  'legs',
  'feet',
] as const satisfies readonly Part[];

function parseFlag(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match === undefined ? fallback : match.slice(prefix.length);
}

function parseScale(): number {
  const raw = parseFlag('scale', String(DEFAULT_SCALE));
  const value = Number(raw);
  if (!Number.isFinite(value) || value < MIN_SCALE || value > MAX_SCALE) {
    throw new Error(`--scale=${raw} is not a number in [${MIN_SCALE}, ${MAX_SCALE}]`);
  }
  return value;
}

function parseMode(): Mode {
  const raw = parseFlag('mode', 'sheet');
  const mode = MODES.find((candidate) => candidate === raw);
  if (mode === undefined) throw new Error(`--mode=${raw} is not one of ${MODES.join(', ')}`);
  return mode;
}

function parseRoutines(): readonly AngelRoutine[] {
  const raw = parseFlag('routine', 'all');
  if (raw === 'all') return ANGEL_ROUTINES;
  const routine = ANGEL_ROUTINES.find((candidate) => candidate === raw);
  if (routine === undefined) {
    throw new Error(`--routine=${raw} is not one of ${ANGEL_ROUTINES.join(', ')}`);
  }
  return [routine];
}

/** The frames asked for, per routine: every frame by default, else the listed ones each routine has. */
type FramesOf = (routine: AngelRoutine) => readonly number[];

function parseFrames(): FramesOf {
  const raw = parseFlag('frames', 'all');
  if (raw === 'all') {
    return (routine) => Array.from({ length: ANGEL_ROUTINE_FRAMES[routine] }, (_unused, i) => i);
  }
  const frames: number[] = [];
  for (const piece of raw.split(',')) {
    const [from, to] = piece.split('-').map(Number);
    const last = piece.includes('-') ? to : from;
    for (let frame = from; frame <= last; frame++) frames.push(frame);
  }
  if (frames.some((frame) => !Number.isInteger(frame) || frame < 0)) {
    throw new Error(`--frames=${raw} names a negative or fractional frame`);
  }
  return (routine) => frames.filter((frame) => frame < ANGEL_ROUTINE_FRAMES[routine]);
}

function parsePart(): Part {
  const raw = parseFlag('part', 'full');
  const part = PART_NAMES.find((candidate) => candidate === raw);
  if (part === undefined)
    throw new Error(`--part=${raw} is not one of ${Object.keys(PARTS).join(', ')}`);
  return part;
}

type Ctx = ReturnType<Canvas['getContext']>;

/** For blind review: labels carry frame numbers only, never a routine's name. */
const ANONYMOUS = process.argv.includes('--anonymous');

function cellLabel(routine: AngelRoutine, frame: number, suffix = ''): string {
  return ANONYMOUS ? `${frame}${suffix}` : `${routine} ${frame}${suffix}`;
}

function label(ctx: Ctx, text: string, x: number, y: number): void {
  ctx.fillStyle = LABEL_COLOR;
  ctx.font = LABEL_FONT;
  ctx.fillText(text, x + LABEL_INSET, y + LABEL_HEIGHT - LABEL_INSET);
}

const cellCache = new Map<string, Canvas>();
function cellOf(routine: AngelRoutine, frame: number): Canvas {
  const key = `${routine}:${frame}`;
  const cached = cellCache.get(key);
  if (cached !== undefined) return cached;
  const cell = bakeFigureCell(ANGEL_FIGURE, routine, frame);
  cellCache.set(key, cell);
  return cell;
}

/** A grid of cells, `COLUMNS` to a line, each with its label. */
function grid(
  items: ReadonlyArray<{ text: string; paint: (ctx: Ctx, x: number, y: number) => void }>,
  cellWidth: number,
  cellHeight: number,
  background: string,
): Canvas {
  const columns = Math.min(COLUMNS, items.length);
  const rows = Math.ceil(items.length / columns);
  const pitchX = cellWidth + PADDING;
  const pitchY = cellHeight + LABEL_HEIGHT + PADDING;
  const canvas = createCanvas(columns * pitchX + PADDING, rows * pitchY + PADDING);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  items.forEach((item, i) => {
    const x = PADDING + (i % columns) * pitchX;
    const y = PADDING + Math.floor(i / columns) * pitchY;
    label(ctx, item.text, x, y);
    item.paint(ctx, x, y + LABEL_HEIGHT);
  });
  return canvas;
}

function sheet(routines: readonly AngelRoutine[], framesOf: FramesOf, scale: number): Canvas {
  const w = Math.ceil(ANGEL_FIGURE.frameWidth * scale);
  const h = Math.ceil(ANGEL_FIGURE.frameHeight * scale);
  const items = routines.flatMap((routine) =>
    framesOf(routine).map((frame) => ({
      text: cellLabel(routine, frame),
      paint: (ctx: Ctx, x: number, y: number) => {
        ctx.imageSmoothingEnabled = scale < 1;
        ctx.drawImage(cellOf(routine, frame), x, y, w, h);
      },
    })),
  );
  return grid(items, w, h, STAGE_FLOOR);
}

/** Where her floor origin is in the cell, in cell pixels. */
function rootInCell(routine: AngelRoutine, frame: number): { x: number; y: number } {
  const solved = angelFrameAt(routine, frame);
  return {
    x: ANGEL_POLE_BASE_IN_CELL.x + solved.root.x * ANGEL_CELL_PX_PER_UNIT,
    y: ANGEL_POLE_BASE_IN_CELL.y + solved.root.y * ANGEL_CELL_PX_PER_UNIT,
  };
}

function crop(
  routines: readonly AngelRoutine[],
  framesOf: FramesOf,
  part: Part,
  scale: number,
): Canvas {
  const { left, top, right, bottom } = PARTS[part];
  const sw = (right - left) * ANGEL_CELL_PX_PER_UNIT;
  const sh = (bottom - top) * ANGEL_CELL_PX_PER_UNIT;
  const w = Math.ceil(sw * scale);
  const h = Math.ceil(sh * scale);
  const items = routines.flatMap((routine) =>
    framesOf(routine).map((frame) => ({
      text: cellLabel(routine, frame, ` ${part}`),
      paint: (ctx: Ctx, x: number, y: number) => {
        const root = rootInCell(routine, frame);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(
          cellOf(routine, frame),
          root.x + left * ANGEL_CELL_PX_PER_UNIT,
          root.y + top * ANGEL_CELL_PX_PER_UNIT,
          sw,
          sh,
          x,
          y,
          w,
          h,
        );
      },
    })),
  );
  return grid(items, w, h, STAGE_FLOOR);
}

/** Every frame at the 32 px tile on the stage floor, with a nearest-neighbour 2× copy under it. */
function strip32(routines: readonly AngelRoutine[], framesOf: FramesOf): Canvas {
  const w = Math.ceil(ANGEL_FIGURE.frameWidth * IN_GAME_SCALE);
  const h = Math.ceil(ANGEL_FIGURE.frameHeight * IN_GAME_SCALE);
  const items = routines.flatMap((routine) =>
    framesOf(routine).map((frame) => ({
      text: `${frame}`,
      paint: (ctx: Ctx, x: number, y: number) => {
        const small = createCanvas(w, h);
        const smallCtx = small.getContext('2d');
        smallCtx.fillStyle = STAGE_FLOOR_ALT;
        smallCtx.fillRect(0, 0, w, h);
        smallCtx.imageSmoothingEnabled = true;
        smallCtx.drawImage(cellOf(routine, frame), 0, 0, w, h);
        ctx.drawImage(small, x, y);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(small, x, y + h, w * NEAREST_COPY_SCALE, h * NEAREST_COPY_SCALE);
      },
    })),
  );
  return grid(items, w * NEAREST_COPY_SCALE, h * (1 + NEAREST_COPY_SCALE), STAGE_FLOOR);
}

/** Each phrase's sixteen frames laid over one another, one image per phrase. */
function onion(routines: readonly AngelRoutine[], scale: number): Canvas {
  const w = Math.ceil(ANGEL_FIGURE.frameWidth * scale);
  const h = Math.ceil(ANGEL_FIGURE.frameHeight * scale);
  const items = routines.flatMap((routine) =>
    Array.from({ length: ANGEL_ROUTINE_FRAMES[routine] / COLUMNS }, (_unused, phrase) => ({
      text: `${routine} phrase ${phrase + 1}`,
      paint: (ctx: Ctx, x: number, y: number) => {
        ctx.save();
        ctx.globalAlpha = ONION_ALPHA;
        for (let i = 0; i < COLUMNS; i++) {
          ctx.drawImage(cellOf(routine, phrase * COLUMNS + i), x, y, w, h);
        }
        ctx.restore();
      },
    })),
  );
  return grid(items, w, h, STAGE_FLOOR);
}

/** The amplified difference between each frame and the one before it; frame 0 against the last. */
function delta(routines: readonly AngelRoutine[], framesOf: FramesOf, scale: number): Canvas {
  const cw = ANGEL_FIGURE.frameWidth;
  const ch = ANGEL_FIGURE.frameHeight;
  const w = Math.ceil(cw * scale);
  const h = Math.ceil(ch * scale);
  const items = routines.flatMap((routine) =>
    framesOf(routine).map((frame) => ({
      text: `${routine} ${frame}`,
      paint: (ctx: Ctx, x: number, y: number) => {
        const frames = ANGEL_ROUTINE_FRAMES[routine];
        const previous = (frame + frames - 1) % frames;
        const a = cellOf(routine, previous).getContext('2d').getImageData(0, 0, cw, ch).data;
        const b = cellOf(routine, frame).getContext('2d').getImageData(0, 0, cw, ch).data;
        const diff = createCanvas(cw, ch);
        const dctx = diff.getContext('2d');
        const image = dctx.createImageData(cw, ch);
        for (let i = 0; i < a.length; i += RGBA_STRIDE) {
          const d =
            Math.abs(a[i] - b[i]) +
            Math.abs(a[i + GREEN] - b[i + GREEN]) +
            Math.abs(a[i + BLUE] - b[i + BLUE]);
          const v = Math.min(OPAQUE, d * DELTA_GAIN);
          image.data[i] = v;
          image.data[i + GREEN] = v;
          image.data[i + BLUE] = v;
          image.data[i + ALPHA] = OPAQUE;
        }
        dctx.putImageData(image, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(diff, x, y, w, h);
      },
    })),
  );
  return grid(items, w, h, '#000');
}

/** Joint paths across a routine, over a faint onion: ankles, wrists, pelvis and head. */
function trails(routines: readonly AngelRoutine[], scale: number): Canvas {
  const w = Math.ceil(ANGEL_FIGURE.frameWidth * scale);
  const h = Math.ceil(ANGEL_FIGURE.frameHeight * scale);
  /** Pelvis and neck sit on her centreline, so which side is asked for does not matter to them. */
  const CENTRE: BodySide = 1;
  const tracks: ReadonlyArray<{
    name: string;
    color: string;
    side: BodySide;
    at: (s: AngelSkeleton, side: BodySide) => V3;
  }> = [
    { name: 'left ankle', color: '#ff5a5a', side: -1, at: (s, side) => s.legs[side].ankle },
    { name: 'right ankle', color: '#5ab0ff', side: 1, at: (s, side) => s.legs[side].ankle },
    { name: 'left wrist', color: '#ffb35a', side: -1, at: (s, side) => s.arms[side].wrist },
    { name: 'right wrist', color: '#5affb0', side: 1, at: (s, side) => s.arms[side].wrist },
    {
      name: 'pelvis',
      color: '#ffffff',
      side: CENTRE,
      at: (s) => ({ x: s.pelvis.x, y: s.pelvis.y + HIP_JOINT_Y, z: s.pelvis.z }),
    },
    {
      name: 'neck',
      color: '#d07aff',
      side: CENTRE,
      at: (s) => ({ x: s.chest.x, y: s.chest.y + NECK_TOP_Y, z: s.chest.z }),
    },
  ];
  const items = routines.map((routine) => ({
    text: `${routine} trails`,
    paint: (ctx: Ctx, x: number, y: number) => {
      ctx.save();
      ctx.globalAlpha = TRAIL_ONION_ALPHA;
      for (let frame = 0; frame < ANGEL_ROUTINE_FRAMES[routine]; frame++) {
        ctx.drawImage(cellOf(routine, frame), x, y, w, h);
      }
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.beginPath();
      ctx.moveTo(x, y + ANGEL_POLE_BASE_IN_CELL.y * scale);
      ctx.lineTo(x + w, y + ANGEL_POLE_BASE_IN_CELL.y * scale);
      ctx.stroke();
      for (const track of tracks) {
        ctx.strokeStyle = track.color;
        ctx.fillStyle = track.color;
        ctx.lineWidth = TRAIL_LINE_WIDTH;
        ctx.beginPath();
        for (let frame = 0; frame < ANGEL_ROUTINE_FRAMES[routine]; frame++) {
          const solved = angelFrameAt(routine, frame);
          const p = project(
            solved.view,
            track.at(solved.skeleton, drawnSideOf(solved, track.side)),
          );
          const flip = solved.flip ? -1 : 1;
          const px =
            x +
            (ANGEL_POLE_BASE_IN_CELL.x + (solved.root.x + flip * p.x) * ANGEL_CELL_PX_PER_UNIT) *
              scale;
          const py =
            y +
            (ANGEL_POLE_BASE_IN_CELL.y + (solved.root.y + p.y - FOOT_Y) * ANGEL_CELL_PX_PER_UNIT) *
              scale;
          if (frame === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
          ctx.fillRect(
            px - TRAIL_DOT_RADIUS / 2,
            py - TRAIL_DOT_RADIUS / 2,
            TRAIL_DOT_RADIUS,
            TRAIL_DOT_RADIUS,
          );
        }
        ctx.stroke();
      }
    },
  }));
  return grid(items, w, h, STAGE_FLOOR);
}

/** Each routine's last two frames beside the next routine's first two: the hand-offs the loop plays. */
function seams(scale: number): Canvas {
  const w = Math.ceil(ANGEL_FIGURE.frameWidth * scale);
  const h = Math.ceil(ANGEL_FIGURE.frameHeight * scale);
  const items = ANGEL_ROUTINES.flatMap((routine, i) => {
    const next = ANGEL_ROUTINES[(i + 1) % ANGEL_ROUTINES.length];
    const last = ANGEL_ROUTINE_FRAMES[routine] - 1;
    return [
      [routine, last - 1],
      [routine, last],
      [next, 0],
      [next, 1],
    ] as const;
  }).map(([routine, frame]) => ({
    text: `${routine} ${frame}`,
    paint: (ctx: Ctx, x: number, y: number) => ctx.drawImage(cellOf(routine, frame), x, y, w, h),
  }));
  return grid(items, w, h, STAGE_FLOOR);
}

const mode = parseMode();
console.log('Angel art gates:');
const clean = reportFigureGates('angel', angelGateFailures());
if (mode !== 'gates') {
  const scale = parseScale();
  const routines = parseRoutines();
  const framesOf = parseFrames();
  const canvas = (() => {
    switch (mode) {
      case 'sheet':
        return sheet(routines, framesOf, scale);
      case 'crop':
        return crop(routines, framesOf, parsePart(), scale);
      case 'strip32':
        return strip32(routines, framesOf);
      case 'onion':
        return onion(routines, scale);
      case 'delta':
        return delta(routines, framesOf, scale);
      case 'trails':
        return trails(routines, scale);
      case 'seams':
        return seams(scale);
      default: {
        const unhandled: never = mode;
        return unhandled;
      }
    }
  })();
  const out = writePreviewPng(
    parseFlag('out', `${PREVIEW_DIR}/angel-${mode}.png`),
    canvas.toBuffer('image/png'),
  );
  console.log(`wrote ${out} (${canvas.width}×${canvas.height})`);
}
if (!clean) process.exitCode = 1;
