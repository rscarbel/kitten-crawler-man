/**
 * Magnum's review harness.
 *
 * Art has to be judged as an image, by something that only looks at the
 * image: every defect that has ever mattered on a figure in this project was
 * invisible to typecheck, to lint and to reading the drawing code. Cells are
 * painted from the figure the way the runtime cache bakes them, the stage
 * act's cells with the pole drawn behind him exactly as a stage draws it, and
 * the art gates run first, so one command answers both "does it still hold
 * together" and "what does it look like".
 *
 *   npm run render:magnum                                every row
 *   npx tsx scripts/render-magnum.ts --row=act --scale=3  the whole act, phrase by phrase
 *   npx tsx scripts/render-magnum.ts --row=tease --mode=ingame    a routine at 32 px
 *   npx tsx scripts/render-magnum.ts --row=tease --part=hands --scale=6
 *   npx tsx scripts/render-magnum.ts --row=wave --mode=onion|delta|trails
 *   npx tsx scripts/render-magnum.ts --mode=gates        the gates alone
 *
 * `--row` takes a comma list of state names, a routine id (its phrases), or
 * `act` (every phrase).
 */

import { type Canvas, createCanvas } from 'canvas';

import { bakeFigureCell, paintFigureCell } from './figureSheet.js';
import { inkBoxOf, reportFigureGates, type InkBox } from './figureGates.js';
import { magnumGateFailures } from './gates-magnum.js';
import { asGameContext } from './nodeGameContext.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { DANCE_POLE_HEIGHT_TILES, paintDancePole } from '../src/sprites/art/dancePole/dancePole.js';
import { SIDES, buildSkeleton, magnumScreenPoint } from '../src/sprites/art/magnumArt.js';
import { MAGNUM_PHRASES, MAGNUM_POLE_OFFSET_TILES } from '../src/sprites/art/magnumDance.js';
import {
  GROUND_OFFSET_IN_TILE,
  MAGNUM_STAGE_CELL,
  MAGNUM_STAGE_FIGURE,
  TILE_SCALE,
  magnumFrameOf,
  magnumOrigin,
} from '../src/sprites/art/magnumFigure.js';
import {
  GROUND_OFFSET_IN_TILE as HUMAN_GROUND_OFFSET_IN_TILE,
  undressedHumanFigure,
} from '../src/sprites/art/humanFigure.js';
import { activeHumanLook } from '../src/sprites/humanSprite.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';

/** Matches TILE_SIZE in src/core/constants.ts. */
const IN_GAME_TILE = 32;
const IN_GAME_SCALE = IN_GAME_TILE / TILE_SCALE;

const DEFAULT_SCALE = 1.5;
const MIN_SCALE = 0.25;
const MAX_SCALE = 12;
const LABEL_HEIGHT = 20;
const PADDING = 6;
const LABEL_INSET = 3;
/** The grounds he stands on: the club's boards, dungeon stone, grass, dirt. */
const FLOOR_SWATCHES: ReadonlyArray<string> = ['#3a2a30', '#3b3b40', '#637032', '#7a6244'];
const BACKDROP = '#26262b';
const GRID_LINE = 'rgba(255,255,255,0.12)';
const TILE_GUIDE = 'rgba(120,220,255,0.35)';
const LABEL_COLOR = '#e8e2d8';
const LABEL_FONT = '13px sans-serif';
const ONION_ALPHA = 0.18;
/** Floor above the pole's top kept clear in an in-game row, in tiles. */
const POLE_HEADROOM_TILES = 0.1;
const DELTA_GAIN = 4;
const RGBA = 4;
const ALPHA_CHANNEL = 3;
const OPAQUE = 255;
const TRAIL_WIDTH = 1.5;
const TRAIL_DOT = 2;
type Skel = ReturnType<typeof buildSkeleton>;
type Track = 'rightWrist' | 'leftWrist' | 'rightBall' | 'leftBall' | 'pelvis' | 'head';
interface TrackSpec {
  readonly colour: string;
  readonly pick: (skel: Skel) => { x: number; y: number; z: number };
}
const TRACKS: Readonly<Record<Track, TrackSpec>> = {
  rightWrist: { colour: '#ff5a5a', pick: (s) => s.arms.right.end },
  leftWrist: { colour: '#5ab4ff', pick: (s) => s.arms.left.end },
  rightBall: { colour: '#ffb347', pick: (s) => s.feet.right.ball },
  leftBall: { colour: '#7ee08a', pick: (s) => s.feet.left.ball },
  pelvis: { colour: '#ffffff', pick: (s) => s.pelvis },
  head: { colour: '#e47cff', pick: (s) => s.head },
};
/** The human crawler's standing row, for the size comparison. */
const HUMAN_STATE = 'idle';

type Mode = 'sheet' | 'ingame' | 'onion' | 'delta' | 'trails' | 'gates';
const MODES: ReadonlyArray<Mode> = ['sheet', 'ingame', 'onion', 'delta', 'trails', 'gates'];

/** Body-part crops, as fractions of the cell, so they survive the cell being resized. */
type Part = 'hands' | 'head' | 'torso' | 'legs' | 'feet' | 'whole';
const PARTS: ReadonlyArray<Part> = ['hands', 'head', 'torso', 'legs', 'feet', 'whole'];
interface Window01 {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}
const PART_WINDOWS: Readonly<Record<Part, Window01>> = {
  hands: { x0: 0, y0: 0, x1: 1, y1: 1 },
  head: { x0: 0.25, y0: 0, x1: 0.85, y1: 0.4 },
  torso: { x0: 0.15, y0: 0.15, x1: 0.95, y1: 0.75 },
  legs: { x0: 0.15, y0: 0.5, x1: 0.95, y1: 1 },
  feet: { x0: 0.15, y0: 0.75, x1: 0.95, y1: 1 },
  whole: { x0: 0, y0: 0, x1: 1, y1: 1 },
};
/** Cell pixels round a hand kept in a hands crop. */
const HAND_CROP_RADIUS = 14;

type SheetContext = ReturnType<Canvas['getContext']>;

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

function parseChoice<T extends string>(name: string, choices: readonly T[], fallback: T): T {
  const raw = parseFlag(name, fallback);
  const found = choices.find((choice) => choice === raw);
  if (found === undefined) throw new Error(`--${name}=${raw} is not one of ${choices.join(', ')}`);
  return found;
}

/** The states `--row` names. */
function statesFor(raw: string): string[] {
  return raw.split(',').flatMap((item): string[] => {
    if (item === 'all' || item === 'act') return MAGNUM_PHRASES.map((phrase) => phrase.state);
    const phrases = MAGNUM_PHRASES.filter((phrase) => phrase.routine === item);
    if (phrases.length > 0) return phrases.map((phrase) => phrase.state);
    if (MAGNUM_STAGE_FIGURE.states.has(item)) return [item];
    throw new Error(`--row=${item} names no state or routine of magnum`);
  });
}

function newPanel(width: number, height: number): { canvas: Canvas; ctx: SheetContext } {
  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;
  return { canvas, ctx };
}

/**
 * `--blind` labels each row by its number instead of its state name, so an
 * image handed to a blind reviewer does not name the move it is asking about.
 */
const BLIND = process.argv.includes('--blind');

function rowLabel(state: string, states: readonly string[]): string {
  return BLIND ? `row ${states.indexOf(state) + 1}` : state;
}

function figureFor(state: string): FigureDef {
  if (!MAGNUM_STAGE_FIGURE.states.has(state)) throw new Error(`magnum paints no "${state}"`);
  return MAGNUM_STAGE_FIGURE;
}

const ORIGIN = magnumOrigin(MAGNUM_STAGE_CELL);

function frameCountOf(def: FigureDef, state: string): number {
  const declared = def.states.get(state);
  if (declared === undefined) throw new Error(`${def.id} declares no state "${state}"`);
  return declared.frames;
}

/** The frames `--frames=0,3,6` asks for, or every frame of the row. */
function framesToShow(frameCount: number): number[] {
  const raw = parseFlag('frames', '');
  const all = Array.from({ length: frameCount }, (_unused, frame) => frame);
  if (raw === '') return all;
  return raw
    .split(',')
    .map(Number)
    .filter((frame) => Number.isInteger(frame) && frame >= 0 && frame < frameCount);
}

/**
 * One cell at `density`, on a transparent canvas the cell's size times the
 * density, with the pole painted behind him the way a stage draws it.
 */
function cellWithPole(state: string, frame: number, density: number): Canvas {
  const def = figureFor(state);
  const figure =
    density === 1 ? bakeFigureCell(def, state, frame) : paintFigureCell(def, state, frame, density);
  const out = createCanvas(figure.width, figure.height);
  const ctx = out.getContext('2d');
  ctx.save();
  ctx.scale(density * TILE_SCALE, density * TILE_SCALE);
  paintDancePole(asGameContext(ctx), {
    x: ORIGIN.x / TILE_SCALE + MAGNUM_POLE_OFFSET_TILES.x,
    y: ORIGIN.y / TILE_SCALE + MAGNUM_POLE_OFFSET_TILES.y,
  });
  ctx.restore();
  ctx.drawImage(figure, 0, 0);
  return out;
}

/** Clear cell pixels kept round a row's ink when the sheet is cropped to it. */
const CROP_PAD = 6;

function rowWindow(def: FigureDef, state: string, frames: readonly number[]): InkBox {
  const boxes = frames
    .map((frame) => inkBoxOf(def, state, frame))
    .filter((box): box is InkBox => box !== null);
  if (boxes.length === 0) return { minX: 0, minY: 0, maxX: def.frameWidth, maxY: def.frameHeight };
  const poleX = ORIGIN.x + MAGNUM_POLE_OFFSET_TILES.x * TILE_SCALE;
  return {
    minX: Math.max(0, Math.min(...boxes.map((b) => b.minX)) - CROP_PAD),
    minY: Math.max(0, Math.min(...boxes.map((b) => b.minY)) - CROP_PAD),
    maxX: Math.min(
      def.frameWidth,
      Math.max(poleX + CROP_PAD, ...boxes.map((b) => b.maxX)) + CROP_PAD,
    ),
    maxY: Math.min(def.frameHeight, Math.max(...boxes.map((b) => b.maxY)) + CROP_PAD),
  };
}

/** The crop for one frame: a body-part window of the row's window, or a box round both hands. */
function partWindow(part: Part, state: string, frame: number, row: InkBox): InkBox {
  if (part === 'hands') {
    const painted = magnumFrameOf(state, frame);
    if (painted === null) return row;
    const skel = buildSkeleton(painted.pose);
    const points = SIDES.map((side) =>
      magnumScreenPoint(painted.pose, painted.view, skel.arms[side].end),
    );
    const xs = points.map((p) => ORIGIN.x + p.x * TILE_SCALE);
    const ys = points.map((p) => ORIGIN.y + p.y * TILE_SCALE);
    return {
      minX: Math.min(...xs) - HAND_CROP_RADIUS,
      minY: Math.min(...ys) - HAND_CROP_RADIUS,
      maxX: Math.max(...xs) + HAND_CROP_RADIUS,
      maxY: Math.max(...ys) + HAND_CROP_RADIUS,
    };
  }
  const w = PART_WINDOWS[part];
  const width = row.maxX - row.minX;
  const height = row.maxY - row.minY;
  return {
    minX: row.minX + width * w.x0,
    minY: row.minY + height * w.y0,
    maxX: row.minX + width * w.x1,
    maxY: row.minY + height * w.y1,
  };
}

/** A labelled grid, one row per state, at `scale` times the cell. */
function renderRows(states: readonly string[], outPath: string, scale: number, part: Part): void {
  const rows = states.map((state) => {
    const def = figureFor(state);
    const shown = framesToShow(frameCountOf(def, state));
    const window = rowWindow(def, state, shown);
    const windows = shown.map((frame) => partWindow(part, state, frame, window));
    const cellW = Math.max(...windows.map((w) => w.maxX - w.minX)) * scale;
    const cellH = Math.max(...windows.map((w) => w.maxY - w.minY)) * scale;
    return { state, def, shown, windows, cellW, cellH };
  });
  const panelWidth = Math.max(
    ...rows.map((row) => PADDING + row.shown.length * (row.cellW + PADDING)),
  );
  const panelHeight =
    PADDING + rows.reduce((sum, row) => sum + row.cellH + LABEL_HEIGHT + PADDING, 0);
  const { canvas, ctx } = newPanel(panelWidth, panelHeight);
  let y = PADDING;
  rows.forEach(({ state, def, shown, windows, cellW, cellH }, index) => {
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(
      `${state} — ${frameCountOf(def, state)} frames`,
      PADDING,
      y + LABEL_HEIGHT - PADDING,
    );
    y += LABEL_HEIGHT;
    shown.forEach((frame, column) => {
      const x = PADDING + column * (cellW + PADDING);
      const window = windows[column];
      ctx.fillStyle = FLOOR_SWATCHES[index % FLOOR_SWATCHES.length];
      ctx.fillRect(x, y, cellW, cellH);
      const density = Math.max(1, scale);
      const cell = cellWithPole(state, frame, density);
      const k = cell.width / def.frameWidth;
      ctx.drawImage(
        cell,
        window.minX * k,
        window.minY * k,
        (window.maxX - window.minX) * k,
        (window.maxY - window.minY) * k,
        x,
        y,
        (window.maxX - window.minX) * scale,
        (window.maxY - window.minY) * scale,
      );
      ctx.strokeStyle = GRID_LINE;
      ctx.strokeRect(x, y, cellW, cellH);
      if (part === 'whole') {
        ctx.strokeStyle = TILE_GUIDE;
        ctx.strokeRect(
          x + (def.tileX - window.minX) * scale,
          y + (def.tileY - window.minY) * scale,
          TILE_SCALE * scale,
          TILE_SCALE * scale,
        );
      }
      ctx.fillStyle = LABEL_COLOR;
      ctx.fillText(String(frame), x + LABEL_INSET, y + LABEL_HEIGHT - PADDING);
    });
    y += cellH + PADDING;
  });
  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, scale ${scale}×)`);
}

/**
 * Every frame of every requested row at the size the game blits it, on the
 * floors he stands on, with the human crawler at the head of each line for
 * scale, and a nearest-neighbour enlargement of the same pixels beside it.
 */
function renderInGame(states: readonly string[], outPath: string, zoom: number): void {
  const k = IN_GAME_SCALE;
  const humanFigure = undressedHumanFigure(activeHumanLook());
  const humanK = IN_GAME_TILE / humanFigure.tileScale;
  const humanGround = humanFigure.tileY + humanFigure.tileScale * HUMAN_GROUND_OFFSET_IN_TILE;
  const human = bakeFigureCell(humanFigure, HUMAN_STATE, 0);
  const humanWindow = rowWindow(humanFigure, HUMAN_STATE, [0]);
  const rows = states.map((state) => {
    const def = figureFor(state);
    const frames = framesToShow(frameCountOf(def, state));
    const ground = def.tileY + def.tileScale * GROUND_OFFSET_IN_TILE;
    return { state, def, ground, frames, window: rowWindow(def, state, frames) };
  });
  const humanAbove = (humanGround - humanWindow.minY) * humanK;
  const humanWidth = (humanWindow.maxX - humanWindow.minX) * humanK;
  const layout = rows.map((row) => {
    // A row shows the pole at its full height, the way the stage draws it.
    const poleAbove = (DANCE_POLE_HEIGHT_TILES + POLE_HEADROOM_TILES) * IN_GAME_TILE;
    const above = Math.max(humanAbove, poleAbove, (row.ground - row.window.minY) * k);
    const below = Math.max(
      (humanWindow.maxY - humanGround) * humanK,
      (row.window.maxY - row.ground) * k,
    );
    return { ...row, above, height: above + below, width: (row.window.maxX - row.window.minX) * k };
  });
  const stripWidth = Math.max(
    ...layout.map((row) => PADDING * 2 + humanWidth + row.frames.length * (row.width + PADDING)),
  );
  const stripHeight =
    PADDING + layout.reduce((sum, row) => sum + row.height + LABEL_HEIGHT + PADDING, 0);
  const strip = createCanvas(Math.ceil(stripWidth), Math.ceil(stripHeight));
  const ctx = strip.getContext('2d');
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, strip.width, strip.height);
  ctx.font = LABEL_FONT;
  let y = PADDING;
  layout.forEach((row, index) => {
    ctx.fillStyle = FLOOR_SWATCHES[index % FLOOR_SWATCHES.length];
    ctx.fillRect(0, y, strip.width, row.height + LABEL_HEIGHT);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(rowLabel(row.state, states), PADDING, y + LABEL_HEIGHT - PADDING);
    const groundY = y + LABEL_HEIGHT + row.above;
    ctx.drawImage(
      human,
      humanWindow.minX,
      humanWindow.minY,
      humanWindow.maxX - humanWindow.minX,
      humanWindow.maxY - humanWindow.minY,
      PADDING,
      Math.round(groundY - humanAbove),
      humanWidth,
      (humanWindow.maxY - humanWindow.minY) * humanK,
    );
    row.frames.forEach((frame, column) => {
      const x = PADDING * 2 + humanWidth + column * (row.width + PADDING);
      const w = row.window;
      ctx.save();
      ctx.translate(Math.round(x) + (ORIGIN.x - w.minX) * k, groundY);
      ctx.scale(IN_GAME_TILE, IN_GAME_TILE);
      paintDancePole(asGameContext(ctx), MAGNUM_POLE_OFFSET_TILES);
      ctx.restore();
      ctx.drawImage(
        bakeFigureCell(row.def, row.state, frame),
        w.minX,
        w.minY,
        w.maxX - w.minX,
        w.maxY - w.minY,
        Math.round(x),
        Math.round(groundY - (row.ground - w.minY) * k),
        row.width,
        (w.maxY - w.minY) * k,
      );
    });
    y += row.height + LABEL_HEIGHT + PADDING;
  });
  const out = createCanvas(strip.width * (1 + zoom), strip.height * zoom);
  const octx = out.getContext('2d');
  octx.fillStyle = BACKDROP;
  octx.fillRect(0, 0, out.width, out.height);
  octx.drawImage(strip, 0, 0);
  octx.imageSmoothingEnabled = false;
  octx.drawImage(strip, strip.width, 0, strip.width * zoom, strip.height * zoom);
  writePreviewPng(outPath, out.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${out.width}×${out.height}px, in-game with ×${zoom} beside)`);
}

/** The cell-pixel point of a figure-space point on one frame. */
function cellPoint(
  state: string,
  frame: number,
  pick: TrackSpec['pick'],
): { x: number; y: number } | null {
  const painted = magnumFrameOf(state, frame);
  if (painted === null) return null;
  const at = magnumScreenPoint(painted.pose, painted.view, pick(buildSkeleton(painted.pose)));
  return { x: ORIGIN.x + at.x * TILE_SCALE, y: ORIGIN.y + at.y * TILE_SCALE };
}

/**
 * Onion, delta and trails: one panel per state at `scale`. Onion lays every
 * frame at low alpha (a pop shows as a doubled edge); delta shows each
 * frame's amplified difference from the one before it, the wrap included;
 * trails draws the paths of the wrists, ankles, hips and head over a faint
 * onion, with a dot per frame — a planted foot is one dot.
 */
function renderMotion(states: readonly string[], outPath: string, scale: number, mode: Mode): void {
  const panels = states.map((state) => {
    const def = figureFor(state);
    const frames = Array.from({ length: frameCountOf(def, state) }, (_unused, frame) => frame);
    return { state, def, frames, window: rowWindow(def, state, frames) };
  });
  const widthOf = (p: (typeof panels)[number]): number => (p.window.maxX - p.window.minX) * scale;
  const heightOf = (p: (typeof panels)[number]): number => (p.window.maxY - p.window.minY) * scale;
  const columnsFor = (p: (typeof panels)[number]): number =>
    mode === 'delta' ? p.frames.length : 1;
  const panelWidth = Math.max(
    ...panels.map((p) => PADDING + columnsFor(p) * (widthOf(p) + PADDING)),
  );
  const panelHeight =
    PADDING + panels.reduce((sum, p) => sum + heightOf(p) + LABEL_HEIGHT + PADDING, 0);
  const { canvas, ctx } = newPanel(panelWidth, panelHeight);
  let y = PADDING;
  for (const panel of panels) {
    const { state, def, frames, window } = panel;
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(`${rowLabel(state, states)} — ${mode}`, PADDING, y + LABEL_HEIGHT - PADDING);
    y += LABEL_HEIGHT;
    const w = widthOf(panel);
    const h = heightOf(panel);
    const density = Math.max(1, scale);
    const cells = frames.map((frame) => cellWithPole(state, frame, density));
    const k = cells[0].width / def.frameWidth;
    const blit = (target: SheetContext, cell: Canvas, x: number): void => {
      target.drawImage(
        cell,
        window.minX * k,
        window.minY * k,
        (window.maxX - window.minX) * k,
        (window.maxY - window.minY) * k,
        x,
        y,
        w,
        h,
      );
    };
    if (mode === 'delta') {
      frames.forEach((frame, column) => {
        const x = PADDING + column * (w + PADDING);
        const previous = cells[(frame - 1 + cells.length) % cells.length];
        const a = previous.getContext('2d').getImageData(0, 0, previous.width, previous.height);
        const b = cells[frame].getContext('2d').getImageData(0, 0, previous.width, previous.height);
        const diff = createCanvas(previous.width, previous.height);
        const dctx = diff.getContext('2d');
        const out = dctx.createImageData(previous.width, previous.height);
        for (let i = 0; i < out.data.length; i += RGBA) {
          let delta = 0;
          for (let channel = 0; channel < RGBA; channel++) {
            delta += Math.abs(a.data[i + channel] - b.data[i + channel]);
          }
          const v = Math.min(OPAQUE, delta * DELTA_GAIN);
          out.data[i] = v;
          out.data[i + 1] = v;
          out.data[i + 2] = v;
          out.data[i + ALPHA_CHANNEL] = OPAQUE;
        }
        dctx.putImageData(out, 0, 0);
        blit(ctx, diff, x);
        ctx.fillStyle = LABEL_COLOR;
        ctx.fillText(
          `${(frame - 1 + frames.length) % frames.length}→${frame}`,
          x + LABEL_INSET,
          y + LABEL_HEIGHT - PADDING,
        );
      });
    } else {
      const x = PADDING;
      ctx.fillStyle = FLOOR_SWATCHES[0];
      ctx.fillRect(x, y, w, h);
      ctx.save();
      ctx.globalAlpha = mode === 'trails' ? ONION_ALPHA / 2 : ONION_ALPHA;
      for (const cell of cells) blit(ctx, cell, x);
      ctx.restore();
      if (mode === 'trails') {
        const toPanel = (p: { x: number; y: number }): { x: number; y: number } => ({
          x: x + (p.x - window.minX) * scale,
          y: y + (p.y - window.minY) * scale,
        });
        for (const { colour, pick } of Object.values(TRACKS)) {
          const points = frames
            .map((frame) => cellPoint(state, frame, pick))
            .filter((p): p is { x: number; y: number } => p !== null)
            .map(toPanel);
          ctx.strokeStyle = colour;
          ctx.fillStyle = colour;
          ctx.lineWidth = TRAIL_WIDTH;
          ctx.beginPath();
          points.forEach((p, i) => {
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          });
          ctx.stroke();
          for (const p of points)
            ctx.fillRect(p.x - TRAIL_DOT / 2, p.y - TRAIL_DOT / 2, TRAIL_DOT, TRAIL_DOT);
        }
      }
    }
    y += h + PADDING;
  }
  writePreviewPng(outPath, canvas.toBuffer('image/png'));
  console.log(`Wrote ${outPath} (${canvas.width}×${canvas.height}px, ${mode}, scale ${scale}×)`);
}

function main(): void {
  console.log('Gating Magnum…');
  reportFigureGates('magnum', magnumGateFailures());

  const mode = parseChoice<Mode>('mode', MODES, 'sheet');
  if (mode === 'gates') return;
  const states = statesFor(parseFlag('row', 'all'));
  const suffix = parseFlag('tag', '');
  if (mode === 'ingame') {
    const zoom = parseNumberFlag('zoom', 2, 1, MAX_SCALE);
    renderInGame(states, parseFlag('out', `${PREVIEW_DIR}/magnum-ingame${suffix}.png`), zoom);
    return;
  }
  const scale = parseNumberFlag('scale', DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  if (mode === 'sheet') {
    const part = parseChoice<Part>('part', PARTS, 'whole');
    renderRows(states, parseFlag('out', `${PREVIEW_DIR}/magnum-review${suffix}.png`), scale, part);
    return;
  }
  renderMotion(states, parseFlag('out', `${PREVIEW_DIR}/magnum-${mode}${suffix}.png`), scale, mode);
}

main();
