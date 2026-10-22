#!/usr/bin/env tsx
/**
 * The Trash Gremlin review harness. Art has to be judged as an image, by
 * something that only looks at the image — every defect that has ever mattered
 * on a figure in this project was invisible to `typecheck`, `lint` and a code
 * read, and obvious in a render within seconds.
 *
 * The cells are painted from `TRASH_GREMLIN_FIGURE` the way the runtime cache
 * bakes them, and its art gates run before anything is baked, so one command
 * answers both "does it still hold together" and "what does it look like".
 *
 *   npm run render:trash-gremlin
 *   npx tsx scripts/render-trash-gremlin.ts --mode=poses --scale=3
 *   npx tsx scripts/render-trash-gremlin.ts --mode=parts --part=head --scale=6
 *   npx tsx scripts/render-trash-gremlin.ts --mode=strip
 *   npx tsx scripts/render-trash-gremlin.ts --mode=gore
 *   npx tsx scripts/render-trash-gremlin.ts --mode=bile
 *   npx tsx scripts/render-trash-gremlin.ts --mode=onion --state=scurry_side
 *   npx tsx scripts/render-trash-gremlin.ts --mode=delta --state=vomit_side
 *   npx tsx scripts/render-trash-gremlin.ts --mode=trails --state=scurry_side
 *   npx tsx scripts/render-trash-gremlin.ts --mode=frame --state=idle --frame=0 --scale=4
 *   npx tsx scripts/render-trash-gremlin.ts --mode=compare --against=<png>
 *
 * Every mode takes `--out=<path>`; `--force` renders even when a gate is red; `--rows=a,b` limits the sheet, strip and
 * part modes to those rows.
 */

import { type Canvas, createCanvas, loadImage } from 'canvas';

import { bakeFigureSheet } from './figureSheet.js';
import { reportFigureGates } from './figureGates.js';
import { gremlinBileGateFailures, trashGremlinGateFailures } from './gates-trash-gremlin.js';
import { PREVIEW_DIR, writePreviewPng } from './previewOut.js';
import { TILE_SIZE } from '../src/core/constants.js';
import { previewInk } from '../src/ui/theme/previewInk.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import {
  GORE_STATES,
  FIGURE_UNIT_PX,
  GROUND_Y_IN_CELL,
  POSE_ORIGIN_X_IN_CELL,
  SCURRY_GROUND_PER_CYCLE,
  TILE_SCALE,
  TRASH_GREMLIN_FIGURE,
  TRASH_GREMLIN_ROWS,
} from '../src/sprites/art/trashGremlinFigure.js';
import { buildSkeleton } from '../src/sprites/art/trashGremlinArt.js';
import { project } from '../src/sprites/art/trashGremlin/rig.js';
import {
  GREMLIN_ACID_FIGURE,
  GREMLIN_BILE_ARC_FIGURE,
} from '../src/sprites/art/gremlinBileFigure.js';

const MODES = [
  'sheet',
  'poses',
  'parts',
  'gore',
  'bile',
  'onion',
  'delta',
  'strip',
  'trails',
  'frame',
  'compare',
] as const;
type Mode = (typeof MODES)[number];

const BACKDROP = '#1b1b20';
const PANEL_INK = '#e8e2d4';
const LABEL_INK = '#9d99a8';
const GUIDE = 'rgba(90,220,255,0.6)';
const GROUND_GUIDE = 'rgba(255,120,120,0.5)';
const EVENT_MARK = 'rgba(255,220,90,0.9)';
/** The lair's linoleum and an unlit floor: the two floors it is judged on. */
const LAIR_FLOOR = previewInk.floor.lairLinoleum;
const DARK_FLOOR = previewInk.floor.unlitCave;

const LABEL_FONT = '13px sans-serif';
/** Where captions sit: the left margin, the title's baseline, and row captions' drop below a row's top. */
const LABEL_X = 8;
const TITLE_Y = 18;
const ROW_LABEL_DROP = 18;
const SMALL_LABEL_DROP = 14;
const FRAME_LABEL_INSET = 4;
const PIECE_LABEL_DROP = 16;
const BLOCK_TITLE_LIFT = 6;
/** Gutters round the strip's 1x and enlarged copies. */
const STRIP_GUTTERS = 3;
const TITLE_FONT = 'bold 15px sans-serif';
const LABEL_GUTTER = 120;
const ROW_GAP = 8;
const TOP_MARGIN = 26;

/** The size a player actually sees it at. */
const IN_GAME_TILE = TILE_SIZE;
const STRIP_ZOOM = 2;

const DEFAULT_SCALE = 2;
const MIN_SCALE = 0.25;
const MAX_SCALE = 10;

const BILE_PANEL_SCALE = 0.5;

/**
 * Crops as fractions of the cell rather than pixel boxes: a cell re-sized round
 * a redrawn pose would silently start cropping the wrong thing.
 */
interface PartCrop {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const PART_CROPS = {
  head: { x: 0.22, y: 0.08, w: 0.56, h: 0.36 },
  sac: { x: 0.3, y: 0.28, w: 0.4, h: 0.26 },
  hands: { x: 0.1, y: 0.5, w: 0.8, h: 0.4 },
  feet: { x: 0.18, y: 0.78, w: 0.64, h: 0.22 },
  lid: { x: 0.2, y: 0.25, w: 0.6, h: 0.5 },
  tail: { x: 0.0, y: 0.7, w: 1, h: 0.3 },
  crown: { x: 0.3, y: 0.05, w: 0.4, h: 0.22 },
} as const satisfies Record<string, PartCrop>;
/** Looked up by a name off the command line, which may name no part at all. */
const PARTS: ReadonlyMap<string, PartCrop> = new Map(Object.entries(PART_CROPS));

interface Options {
  readonly mode: Mode;
  readonly out: string;
  readonly scale: number;
  readonly part: string;
  readonly state: string;
  readonly frame: number;
  readonly rows: readonly string[] | null;
  readonly against: string | null;
}

function parseOptions(argv: readonly string[]): Options {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--([a-z]+)=(.*)$/.exec(arg);
    if (match !== null) flags.set(match[1], match[2]);
  }
  const rawMode = flags.get('mode') ?? 'sheet';
  const mode = MODES.find((candidate) => candidate === rawMode);
  if (mode === undefined) throw new Error(`--mode must be one of ${MODES.join(', ')}`);
  const scale = Number(flags.get('scale') ?? DEFAULT_SCALE);
  if (!Number.isFinite(scale) || scale < MIN_SCALE || scale > MAX_SCALE) {
    throw new Error(`--scale must be between ${MIN_SCALE} and ${MAX_SCALE}`);
  }
  const rows = flags.get('rows');
  return {
    mode,
    out: flags.get('out') ?? `${PREVIEW_DIR}/trash-gremlin-${mode}.png`,
    scale,
    part: flags.get('part') ?? 'head',
    state: flags.get('state') ?? 'scurry_side',
    frame: Number(flags.get('frame') ?? 0),
    rows: rows === undefined ? null : rows.split(','),
    against: flags.get('against') ?? null,
  };
}

type Ctx = ReturnType<Canvas['getContext']>;

interface Sheet {
  readonly draw: (
    ctx: Ctx,
    row: number,
    frame: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ) => void;
  readonly states: readonly string[];
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly framesOf: (state: string) => number;
}

function sheetOf(def: FigureDef, states: readonly string[]): Sheet {
  const baked = bakeFigureSheet(def, [...states]);
  return {
    states: baked.states,
    frameWidth: baked.frameWidth,
    frameHeight: baked.frameHeight,
    framesOf: (state) => {
      const declared = def.states.get(state);
      if (declared === undefined) throw new Error(`${def.id} declares no state "${state}"`);
      return declared.frames;
    },
    draw: (ctx, row, frame, dx, dy, dw, dh) => {
      ctx.drawImage(
        baked.canvas,
        frame * baked.frameWidth,
        row * baked.frameHeight,
        baked.frameWidth,
        baked.frameHeight,
        dx,
        dy,
        dw,
        dh,
      );
    },
  };
}

const POSE_STATES: readonly string[] = TRASH_GREMLIN_ROWS.map((row) => row.name);

function rowSpecOf(state: string): (typeof TRASH_GREMLIN_ROWS)[number] | undefined {
  return TRASH_GREMLIN_ROWS.find((row) => row.name === state);
}

function labelOf(state: string): string {
  const row = rowSpecOf(state);
  if (row === undefined) return `${state} — gore piece`;
  return `${row.name} (${row.view}, ${row.kind})`;
}

function label(ctx: Ctx, text: string, x: number, y: number, font = LABEL_FONT): void {
  ctx.font = font;
  ctx.fillStyle = font === TITLE_FONT ? PANEL_INK : LABEL_INK;
  ctx.fillText(text, x, y);
}

function newPanel(width: number, height: number, fill = BACKDROP): { canvas: Canvas; ctx: Ctx } {
  const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, ctx };
}

function isEventFrame(state: string, frame: number): boolean {
  return rowSpecOf(state)?.eventFrame === frame;
}

function renderSheetPanel(sheet: Sheet, scale: number): Buffer {
  const cellW = sheet.frameWidth * scale;
  const cellH = sheet.frameHeight * scale;
  const columns = Math.max(...sheet.states.map((state) => sheet.framesOf(state)));
  const { canvas, ctx } = newPanel(
    LABEL_GUTTER + columns * cellW,
    TOP_MARGIN + sheet.states.length * (cellH + ROW_GAP),
  );
  label(
    ctx,
    `trash gremlin — ${sheet.frameWidth}x${sheet.frameHeight} cells at ${scale}x`,
    LABEL_X,
    TITLE_Y,
    TITLE_FONT,
  );
  sheet.states.forEach((state, row) => {
    const top = TOP_MARGIN + row * (cellH + ROW_GAP);
    label(ctx, labelOf(state), LABEL_X, top + ROW_LABEL_DROP);
    for (let frame = 0; frame < sheet.framesOf(state); frame++) {
      const left = LABEL_GUTTER + frame * cellW;
      sheet.draw(ctx, row, frame, left, top, cellW, cellH);
      ctx.strokeStyle = GUIDE;
      ctx.lineWidth = 1;
      ctx.strokeRect(
        left + TRASH_GREMLIN_FIGURE.tileX * scale,
        top + TRASH_GREMLIN_FIGURE.tileY * scale,
        TILE_SCALE * scale,
        TILE_SCALE * scale,
      );
      if (isEventFrame(state, frame)) {
        ctx.strokeStyle = EVENT_MARK;
        ctx.lineWidth = 2;
        ctx.strokeRect(left + 1, top + 1, cellW - 2, cellH - 2);
      }
    }
  });
  return canvas.toBuffer('image/png');
}

/**
 * Every frame at the size a player sees, on the lair's own linoleum and on a
 * dark floor, with a nearest-neighbour enlargement beside it. A silhouette that
 * reads at 4x and dissolves at 32 px is a failure, and this is where that shows.
 */
function renderStripPanel(sheet: Sheet): Buffer {
  const inGameScale = IN_GAME_TILE / TILE_SCALE;
  const cellW = sheet.frameWidth * inGameScale;
  const cellH = sheet.frameHeight * inGameScale;
  const columns = Math.max(...sheet.states.map((state) => sheet.framesOf(state)));
  const floors = [LAIR_FLOOR, DARK_FLOOR];
  const blockH = sheet.states.length * cellH;
  const small = createCanvas(
    Math.ceil(LABEL_GUTTER / 2 + columns * cellW),
    Math.ceil(blockH * floors.length + ROW_GAP),
  );
  const sctx = small.getContext('2d');
  sctx.fillStyle = BACKDROP;
  sctx.fillRect(0, 0, small.width, small.height);
  floors.forEach((floor, block) => {
    const blockTop = block * (blockH + ROW_GAP);
    sctx.fillStyle = floor;
    sctx.fillRect(0, blockTop, small.width, blockH);
    sheet.states.forEach((state, row) => {
      for (let frame = 0; frame < sheet.framesOf(state); frame++) {
        sheet.draw(
          sctx,
          row,
          frame,
          LABEL_GUTTER / 2 + frame * cellW,
          blockTop + row * cellH,
          cellW,
          cellH,
        );
      }
    });
  });
  const { canvas, ctx } = newPanel(
    small.width * (STRIP_ZOOM + 1) + ROW_GAP * STRIP_GUTTERS,
    small.height * STRIP_ZOOM + TOP_MARGIN,
  );
  label(
    ctx,
    `trash gremlin at ${IN_GAME_TILE}px (left) and ${STRIP_ZOOM}x nearest (right): ${sheet.states.join(', ')}`,
    LABEL_X,
    TITLE_Y,
    TITLE_FONT,
  );
  ctx.drawImage(small, ROW_GAP, TOP_MARGIN);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    small,
    small.width + ROW_GAP * 2,
    TOP_MARGIN,
    small.width * STRIP_ZOOM,
    small.height * STRIP_ZOOM,
  );
  return canvas.toBuffer('image/png');
}

const QUARTER = 0.25;
const HALF = 0.5;
const THREE_QUARTERS = 0.75;
const POSE_SAMPLE_SHARES = [0, QUARTER, HALF, THREE_QUARTERS] as const;

function renderPosePanel(sheet: Sheet, scale: number): Buffer {
  const cellW = sheet.frameWidth * scale;
  const cellH = sheet.frameHeight * scale;
  const rows = sheet.states.filter((state) => POSE_STATES.includes(state));
  const { canvas, ctx } = newPanel(
    LABEL_GUTTER + POSE_SAMPLE_SHARES.length * cellW,
    TOP_MARGIN + rows.length * (cellH + ROW_GAP),
  );
  label(ctx, `trash gremlin — sampled frames at ${scale}x`, LABEL_X, TITLE_Y, TITLE_FONT);
  rows.forEach((state, index) => {
    const top = TOP_MARGIN + index * (cellH + ROW_GAP);
    label(ctx, labelOf(state), LABEL_X, top + ROW_LABEL_DROP);
    const frameCount = sheet.framesOf(state);
    POSE_SAMPLE_SHARES.forEach((share, column) => {
      const frame = Math.min(frameCount - 1, Math.round(share * frameCount));
      const left = LABEL_GUTTER + column * cellW;
      sheet.draw(ctx, sheet.states.indexOf(state), frame, left, top, cellW, cellH);
      ctx.strokeStyle = GROUND_GUIDE;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left, top + GROUND_Y_IN_CELL * scale);
      ctx.lineTo(left + cellW, top + GROUND_Y_IN_CELL * scale);
      ctx.stroke();
      label(ctx, `f${frame}`, left + FRAME_LABEL_INSET, top + SMALL_LABEL_DROP);
    });
  });
  return canvas.toBuffer('image/png');
}

function renderFramePanel(sheet: Sheet, state: string, frame: number, scale: number): Buffer {
  const row = sheet.states.indexOf(state);
  if (row < 0) throw new Error(`--state=${state} is not one of ${sheet.states.join(', ')}`);
  const cellW = sheet.frameWidth * scale;
  const cellH = sheet.frameHeight * scale;
  const { canvas, ctx } = newPanel(cellW * 2, cellH + TOP_MARGIN);
  label(
    ctx,
    `${state}[${frame}] at ${scale}x, on the lair floor at right`,
    LABEL_X,
    TITLE_Y,
    TITLE_FONT,
  );
  sheet.draw(ctx, row, frame, 0, TOP_MARGIN, cellW, cellH);
  ctx.fillStyle = LAIR_FLOOR;
  ctx.fillRect(cellW, TOP_MARGIN, cellW, cellH);
  sheet.draw(ctx, row, frame, cellW, TOP_MARGIN, cellW, cellH);
  return canvas.toBuffer('image/png');
}

function renderPartPanel(sheet: Sheet, part: string, scale: number): Buffer {
  const crop = PARTS.get(part);
  if (crop === undefined) throw new Error(`--part must be one of ${[...PARTS.keys()].join(', ')}`);
  const cropX = crop.x * sheet.frameWidth;
  const cropY = crop.y * sheet.frameHeight;
  const cellW = crop.w * sheet.frameWidth * scale;
  const cellH = crop.h * sheet.frameHeight * scale;
  const rows = sheet.states.filter((state) => POSE_STATES.includes(state));
  const columns = Math.max(...rows.map((state) => sheet.framesOf(state)));
  const { canvas, ctx } = newPanel(
    LABEL_GUTTER + columns * cellW,
    TOP_MARGIN + rows.length * (cellH + ROW_GAP),
  );
  label(ctx, `trash gremlin — ${part} at ${scale}x`, LABEL_X, TITLE_Y, TITLE_FONT);
  rows.forEach((state, index) => {
    const top = TOP_MARGIN + index * (cellH + ROW_GAP);
    label(ctx, state, LABEL_X, top + SMALL_LABEL_DROP);
    for (let frame = 0; frame < sheet.framesOf(state); frame++) {
      const left = LABEL_GUTTER + frame * cellW;
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, top, cellW, cellH);
      ctx.clip();
      ctx.fillStyle = LAIR_FLOOR;
      ctx.fillRect(left, top, cellW, cellH);
      sheet.draw(
        ctx,
        sheet.states.indexOf(state),
        frame,
        left - cropX * scale,
        top - cropY * scale,
        sheet.frameWidth * scale,
        sheet.frameHeight * scale,
      );
      ctx.restore();
    }
  });
  return canvas.toBuffer('image/png');
}

/** The last is what the runtime draws a piece at on a 32 px tile. */
const GORE_IN_GAME_SCALE = IN_GAME_TILE / TILE_SCALE;
const GORE_REVIEW_SCALES = [2, 1, GORE_IN_GAME_SCALE] as const;

/**
 * Every piece at three sizes, the smallest being what the runtime draws them
 * at. A distinctness gate proves the shapes differ; only naming them from this
 * panel proves they are the right shapes. Unlabelled on purpose.
 */
function renderGorePanel(sheet: Sheet): Buffer {
  const width = LABEL_GUTTER + GORE_STATES.length * sheet.frameWidth * GORE_REVIEW_SCALES[0];
  const height =
    TOP_MARGIN * 2 +
    GORE_REVIEW_SCALES.reduce((sum, scale) => sum + sheet.frameHeight * scale + ROW_GAP, 0);
  const { canvas, ctx } = newPanel(width, height);
  label(ctx, `pieces 1-${GORE_STATES.length}`, LABEL_X, TITLE_Y, TITLE_FONT);
  let top = TOP_MARGIN;
  GORE_REVIEW_SCALES.forEach((scale) => {
    const cellW = sheet.frameWidth * scale;
    const cellH = sheet.frameHeight * scale;
    label(ctx, `${scale}x`, LABEL_X, top + SMALL_LABEL_DROP);
    GORE_STATES.forEach((state, index) => {
      ctx.fillStyle = LAIR_FLOOR;
      ctx.fillRect(LABEL_GUTTER + index * cellW + 1, top, cellW - 2, cellH);
      sheet.draw(
        ctx,
        sheet.states.indexOf(state),
        0,
        LABEL_GUTTER + index * cellW,
        top,
        cellW,
        cellH,
      );
      if (scale === GORE_REVIEW_SCALES[0])
        label(
          ctx,
          `${index + 1}`,
          LABEL_GUTTER + index * cellW + FRAME_LABEL_INSET,
          top + PIECE_LABEL_DROP,
        );
    });
    top += cellH + ROW_GAP;
  });
  return canvas.toBuffer('image/png');
}

function renderBilePanel(): Buffer {
  const blocks = [GREMLIN_BILE_ARC_FIGURE, GREMLIN_ACID_FIGURE].map((def) => ({
    def,
    sheet: sheetOf(def, [...def.states.keys()]),
  }));
  const blockWidth = ({ sheet }: (typeof blocks)[number]): number =>
    Math.max(...sheet.states.map((state) => sheet.framesOf(state))) *
    sheet.frameWidth *
    BILE_PANEL_SCALE;
  const height =
    TOP_MARGIN +
    blocks.reduce(
      (sum, block) =>
        sum +
        block.sheet.states.length * (block.sheet.frameHeight * BILE_PANEL_SCALE + ROW_GAP) +
        TOP_MARGIN,
      0,
    );
  const { canvas, ctx } = newPanel(
    LABEL_GUTTER + Math.max(...blocks.map(blockWidth)),
    height,
    LAIR_FLOOR,
  );
  let top = TOP_MARGIN;
  for (const { def, sheet } of blocks) {
    label(
      ctx,
      `${def.id} — ${def.frameWidth}x${def.frameHeight} cells`,
      LABEL_X,
      top - BLOCK_TITLE_LIFT,
      TITLE_FONT,
    );
    const cellW = sheet.frameWidth * BILE_PANEL_SCALE;
    const cellH = sheet.frameHeight * BILE_PANEL_SCALE;
    sheet.states.forEach((state, row) => {
      label(ctx, state, LABEL_X, top + SMALL_LABEL_DROP);
      for (let frame = 0; frame < sheet.framesOf(state); frame++) {
        sheet.draw(ctx, row, frame, LABEL_GUTTER + frame * cellW, top, cellW, cellH);
      }
      top += cellH + ROW_GAP;
    });
    top += TOP_MARGIN;
  }
  return canvas.toBuffer('image/png');
}

const ONION_BACKDROP = '#101014';

function renderOnionPanel(sheet: Sheet, state: string, scale: number): Buffer {
  const row = sheet.states.indexOf(state);
  if (row < 0) throw new Error(`--state=${state} is not one of ${sheet.states.join(', ')}`);
  const frameCount = sheet.framesOf(state);
  const { canvas, ctx } = newPanel(
    sheet.frameWidth * scale,
    TOP_MARGIN + sheet.frameHeight * scale,
    ONION_BACKDROP,
  );
  label(ctx, `onion — ${state}`, LABEL_X, TITLE_Y, TITLE_FONT);
  ctx.globalAlpha = 1 / frameCount;
  for (let frame = 0; frame < frameCount; frame++) {
    sheet.draw(ctx, row, frame, 0, TOP_MARGIN, sheet.frameWidth * scale, sheet.frameHeight * scale);
  }
  ctx.globalAlpha = 1;
  return canvas.toBuffer('image/png');
}

function renderDeltaPanel(sheet: Sheet, state: string, scale: number): Buffer {
  const row = sheet.states.indexOf(state);
  if (row < 0) throw new Error(`--state=${state} is not one of ${sheet.states.join(', ')}`);
  const frameCount = sheet.framesOf(state);
  const cellW = sheet.frameWidth * scale;
  const cellH = sheet.frameHeight * scale;
  const { canvas, ctx } = newPanel(
    LABEL_GUTTER + frameCount * cellW,
    TOP_MARGIN + cellH,
    '#000000',
  );
  label(ctx, `delta — ${state}`, LABEL_X, TITLE_Y, TITLE_FONT);
  for (let frame = 0; frame < frameCount; frame++) {
    const previous = (frame - 1 + frameCount) % frameCount;
    const left = LABEL_GUTTER + frame * cellW;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, TOP_MARGIN, cellW, cellH);
    ctx.clip();
    sheet.draw(ctx, row, frame, left, TOP_MARGIN, cellW, cellH);
    ctx.globalCompositeOperation = 'difference';
    sheet.draw(ctx, row, previous, left, TOP_MARGIN, cellW, cellH);
    ctx.restore();
  }
  return canvas.toBuffer('image/png');
}

const TRAIL_COLOURS = {
  leftAnkle: '#5ad1ff',
  rightAnkle: '#ff6a5a',
  leftWrist: '#9cff7a',
  rightWrist: '#ffd45a',
  pelvis: '#ffffff',
  head: '#d08cff',
} as const;
const TRAIL_KEYS = [
  'leftAnkle',
  'rightAnkle',
  'leftWrist',
  'rightWrist',
  'pelvis',
  'head',
] as const;
const TRAIL_DOT = 3;
/** The onion under the trails is dimmed to half, so the paths read over it. */
const TRAIL_ONION_ALPHA = 0.5;
const GROUND_PANEL_GAP = 10;
const GROUND_CAPTION_DROP = 4;
/** The floor panel draws each ankle's lane this far below its caption, the right one a lane lower. */
const GROUND_LANE_TOP = 30;
const GROUND_LANE_SPACING = 40;
/** The floor panel is drawn at half the figure's scale so a whole cycle's travel fits. */
const GROUND_PANEL_SCALE = 0.5;
const GROUND_PANEL_HEIGHT = 140;

/**
 * Per-frame paths of the ankles, wrists, pelvis and head over a faint onion. A
 * travelling row adds a ground-plane panel: each ankle's position over the
 * floor, with the body's travel added back — a planted foot is a dot there, a
 * skating one a smear.
 */
function renderTrailsPanel(sheet: Sheet, state: string, scale: number): Buffer {
  const rowIndex = sheet.states.indexOf(state);
  const spec = rowSpecOf(state);
  if (rowIndex < 0 || spec === undefined) throw new Error(`--state=${state} is not a pose row`);
  const cellW = sheet.frameWidth * scale;
  const cellH = sheet.frameHeight * scale;
  const { canvas, ctx } = newPanel(cellW, TOP_MARGIN + cellH + GROUND_PANEL_HEIGHT, ONION_BACKDROP);
  label(ctx, `trails — ${state}`, LABEL_X, TITLE_Y, TITLE_FONT);
  ctx.globalAlpha = TRAIL_ONION_ALPHA / spec.frameCount;
  for (let frame = 0; frame < spec.frameCount; frame++)
    sheet.draw(ctx, rowIndex, frame, 0, TOP_MARGIN, cellW, cellH);
  ctx.globalAlpha = 1;
  const unit = FIGURE_UNIT_PX * scale;
  const toCell = (p: { x: number; y: number }): { x: number; y: number } => ({
    x: POSE_ORIGIN_X_IN_CELL * scale + p.x * unit,
    y: TOP_MARGIN + GROUND_Y_IN_CELL * scale + p.y * unit,
  });
  const tracks: Record<keyof typeof TRAIL_COLOURS, { x: number; y: number }[]> = {
    leftAnkle: [],
    rightAnkle: [],
    leftWrist: [],
    rightWrist: [],
    pelvis: [],
    head: [],
  };
  for (let frame = 0; frame < spec.frameCount; frame++) {
    const sk = buildSkeleton(spec.pose(frame));
    tracks.leftAnkle.push(toCell(project(sk.leftLeg.end, spec.view)));
    tracks.rightAnkle.push(toCell(project(sk.rightLeg.end, spec.view)));
    tracks.leftWrist.push(toCell(project(sk.leftArm.end, spec.view)));
    tracks.rightWrist.push(toCell(project(sk.rightArm.end, spec.view)));
    tracks.pelvis.push(toCell(project(sk.pelvis, spec.view)));
    tracks.head.push(toCell(project(sk.head, spec.view)));
  }
  for (const key of TRAIL_KEYS) {
    ctx.strokeStyle = TRAIL_COLOURS[key];
    ctx.fillStyle = TRAIL_COLOURS[key];
    ctx.lineWidth = 1;
    ctx.beginPath();
    tracks[key].forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    if (spec.kind === 'loop') ctx.closePath();
    ctx.stroke();
    for (const p of tracks[key])
      ctx.fillRect(p.x - TRAIL_DOT / 2, p.y - TRAIL_DOT / 2, TRAIL_DOT, TRAIL_DOT);
  }
  const groundTop = TOP_MARGIN + cellH + GROUND_PANEL_GAP;
  label(
    ctx,
    spec.locomotion ? 'ankles over the floor (planted = dot)' : 'not a travelling row',
    LABEL_X,
    groundTop + GROUND_CAPTION_DROP,
  );
  if (spec.locomotion) {
    const travelPerFrame = SCURRY_GROUND_PER_CYCLE / spec.frameCount;
    const groundUnit = unit * GROUND_PANEL_SCALE;
    for (const side of ['left', 'right'] as const) {
      ctx.fillStyle = side === 'left' ? TRAIL_COLOURS.leftAnkle : TRAIL_COLOURS.rightAnkle;
      for (let frame = 0; frame < spec.frameCount; frame++) {
        const pose = spec.pose(frame);
        const foot = side === 'left' ? pose.leftFoot : pose.rightFoot;
        const worldForward = foot.z + frame * travelPerFrame;
        const x = cellW / 2 + (worldForward - SCURRY_GROUND_PER_CYCLE / 2) * groundUnit;
        const lane = groundTop + GROUND_LANE_TOP + (side === 'left' ? 0 : GROUND_LANE_SPACING);
        const y = lane + foot.y * groundUnit;
        ctx.fillRect(x - TRAIL_DOT, y - TRAIL_DOT, TRAIL_DOT * 2, TRAIL_DOT * 2);
      }
    }
  }
  return canvas.toBuffer('image/png');
}

async function renderComparePanel(sheet: Sheet, against: string, scale: number): Promise<Buffer> {
  const previous = await loadImage(against);
  const now = renderSheetPanel(sheet, scale);
  const nowImage = await loadImage(now);
  const height = Math.max(previous.height, nowImage.height);
  const { canvas, ctx } = newPanel(previous.width + nowImage.width + ROW_GAP, height);
  ctx.drawImage(previous, 0, 0);
  ctx.drawImage(nowImage, previous.width + ROW_GAP, 0);
  return canvas.toBuffer('image/png');
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));

  // Ahead of the contact sheet rather than after it: the sheet is a
  // tens-of-megapixel allocation, and measuring the art on the far side of one
  // has made a centroid gate report a seam at twice its width.
  console.log('Gating the trash gremlin figure…');
  const figureClean = reportFigureGates('trash gremlin', trashGremlinGateFailures());
  console.log('Gating its bile…');
  const bileClean = reportFigureGates('trash gremlin bile', gremlinBileGateFailures());
  // `--force` still bakes the picture after a red gate, for looking at the
  // defect a gate names; the exit code stays failed either way.
  if ((!figureClean || !bileClean) && !process.argv.includes('--force')) return;

  if (options.mode === 'bile') {
    console.log(`wrote ${writePreviewPng(options.out, renderBilePanel())} (bile)`);
    return;
  }
  const poseRows = options.rows ?? POSE_STATES;
  const states =
    options.mode === 'gore'
      ? GORE_STATES
      : options.mode === 'sheet' && options.rows === null
        ? [...POSE_STATES, ...GORE_STATES]
        : poseRows;
  const wanted =
    options.mode === 'onion' ||
    options.mode === 'delta' ||
    options.mode === 'trails' ||
    options.mode === 'frame'
      ? [options.state]
      : states;
  const sheet = sheetOf(TRASH_GREMLIN_FIGURE, wanted);

  let buffer: Buffer;
  if (options.mode === 'poses') buffer = renderPosePanel(sheet, options.scale);
  else if (options.mode === 'parts') buffer = renderPartPanel(sheet, options.part, options.scale);
  else if (options.mode === 'gore') buffer = renderGorePanel(sheet);
  else if (options.mode === 'onion') buffer = renderOnionPanel(sheet, options.state, options.scale);
  else if (options.mode === 'delta') buffer = renderDeltaPanel(sheet, options.state, options.scale);
  else if (options.mode === 'trails')
    buffer = renderTrailsPanel(sheet, options.state, options.scale);
  else if (options.mode === 'frame')
    buffer = renderFramePanel(sheet, options.state, options.frame, options.scale);
  else if (options.mode === 'strip') buffer = renderStripPanel(sheet);
  else if (options.mode === 'compare') {
    if (options.against === null) throw new Error('--mode=compare needs --against=<png>');
    buffer = await renderComparePanel(sheet, options.against, options.scale);
  } else buffer = renderSheetPanel(sheet, options.scale);

  console.log(`wrote ${writePreviewPng(options.out, buffer)} (${options.mode})`);
}

void main();
